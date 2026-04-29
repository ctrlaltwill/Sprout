/**
 * @file src/views/widget/widget-view.ts
 * @summary The Sprout sidebar widget — an Obsidian ItemView that displays a lightweight flashcard review session for the currently-open note. Manages summary mode (card counts and "Start Studying" button), session mode (one-at-a-time card review with grading, undo, bury, suspend), keyboard shortcuts, folder-note deck support, and inline card editing. Most logic is delegated to sibling modules (widget-markdown, widget-scope, widget-session-actions, widget-render-summary, widget-render-session).
 *
 * @exports
 *  - SproutWidgetView — Obsidian ItemView subclass implementing the sidebar flashcard-review widget
 */

import { ItemView, Notice, type TFile, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../../platform/core/constants";
import { SproutMarkdownHelper } from "../reviewer/markdown-render";
import { openSproutImageZoom } from "../reviewer/zoom";
import { buildSession as buildReviewerSession } from "../reviewer/session";
import { processCircleFlagsInMarkdown, hydrateCircleFlagsInElement } from "../../platform/flags/flag-tokens";
import type { Scope } from "../reviewer/types";
import * as IO from "../../platform/image-occlusion/image-occlusion-index";
import { renderImageOcclusionReviewInto } from "../../platform/image-occlusion/image-occlusion-review-render";
import type LearnKitPlugin from "../../main";

import type { Session, UndoFrame, ReviewMeta } from "./core/widget-helpers";
import type { CardRecord } from "../../platform/types/card";
import { isMultiAnswerMcq } from "../../platform/types/card";
import { filterReviewableCards, getWidgetMcqDisplayOrder, isClozeLike, mergeQueueOnSync } from "./core/widget-helpers";
import { getCardsInActiveScope, getFolderNoteInfo, folderNotesAsDecksEnabled } from "./scope/scope-helpers";
import {
  gradeCurrentRating as _gradeCurrentRating,
  canUndo as _canUndo,
  undoLastGrade as _undoLastGrade,
  buryCurrentCard as _buryCurrentCard,
  suspendCurrentCard as _suspendCurrentCard,
  answerMcq as _answerMcq,
  answerMcqMulti as _answerMcqMulti,
  answerOq as _answerOq,
  nextCard as _nextCard,
  openEditModalForCurrentCard as _openEditModalForCurrentCard,
} from "./session/session-actions";
import { renderWidgetSummary } from "./view/render-summary";
import { renderWidgetSession } from "./view/render-session";
import { t } from "../../platform/translations/translator";

type HotspotAttemptState = {
  cardId: string;
  mode: "click" | "drag-drop";
  x: number;
  y: number;
  correct: boolean;
  label?: string;
  removed?: boolean;
};

/* ================================================================== */
/*  SproutWidgetView                                                   */
/* ================================================================== */

export class SproutWidgetView extends ItemView {
  plugin: LearnKitPlugin;
  activeFile: TFile | null = null;

  mode: "summary" | "session" = "summary";
  session: Session | null = null;

  showAnswer = false;
  /** @internal */ _timer: number | null = null;
  /** @internal */ _timing: { cardId: string; startedAt: number } | null = null;
  /** @internal */ _undoStack: UndoFrame[] = [];
  /** @internal */ _sessionStamp = 0;
  /** @internal */ _moreMenuToggle: (() => void) | null = null;
  private _mdHelper: SproutMarkdownHelper | null = null;
  private _pendingManualGrade: { cardId: string; meta: ReviewMeta } | null = null;
  private _pendingHotspotAttempts = new Map<string, HotspotAttemptState[]>();

  /** Stores user-typed cloze answers by cloze occurrence key for typed-mode cloze cards. */
  _typedClozeAnswers = new Map<string, string>();
  /** Tracks the current card ID to reset typed answers when card changes. */
  _typedClozeCardId = "";
  /** Tracks multi-answer MCQ selections. */
  _mcqMultiSelected = new Set<number>();
  _mcqMultiCardId = "";
  _lastTtsKey = "";

  private _keysBound = false;

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
    // Expose instance globally for readingView integration
    window.SproutWidgetView = this;
  }

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  getViewType() {
    return VIEW_TYPE_WIDGET;
  }

  getDisplayText() {
    return "Open study widget";
  }

  getIcon() {
    return "learnkit-widget-study";
  }

  async onOpen() {
    this.activeFile = this.app.workspace.getActiveFile();

    // Keep the container focusable so keyboard events work from anywhere in the leaf.
    this.containerEl.tabIndex = 0;
    const focusSelf = (ev?: Event) => {
      const t = ev?.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable ||
          t.closest("input, textarea, select, [contenteditable]"))
      )
        return;
      this.containerEl.focus();
    };
    this.containerEl.addEventListener("mousedown", focusSelf);
    this.containerEl.addEventListener("click", focusSelf);
    queueMicrotask(() => focusSelf());

    if (!this._keysBound) {
      this._keysBound = true;
      // Listen on the container (natural focus path) …
      this.containerEl.addEventListener("keydown", (ev) => this.handleKey(ev));
      // … and on window capture so shortcuts still work when focus lingers
      // on child elements (rendered markdown, images, etc.).
      window.addEventListener(
        "keydown",
        (ev) => {
          if (!this.isWidgetLeafActive()) return;
          this.handleKey(ev);
        },
        { capture: true },
      );
    }

    this.render();
    await Promise.resolve();
  }

  /** Returns true when this widget's leaf is the visible sidebar leaf. */
  private isWidgetLeafActive(): boolean {
    // The widget container must be connected and visible.
    if (!this.containerEl?.isConnected) return false;
    if (this.containerEl.offsetParent === null) return false;
    // Make sure focus is within the widget's leaf (avoids stealing keys from
    // the main editing area or other sidebar panels).
    const active = document.activeElement;
    return !!active && this.containerEl.contains(active);
  }

  onRefresh() {
    this.render();
  }

  /**
   * Called after card sync operations complete.
   * Summary mode rerenders immediately; session mode updates the upcoming queue
   * while keeping the current card stable to avoid visible resets.
   */
  onCardsSynced() {
    if (this.mode !== "session" || !this.session) {
      this.render();
      return;
    }

    const previousSession = this.session;
    const previousQueue = Array.isArray(previousSession.queue) ? previousSession.queue : [];
    const previousIndex = Math.max(0, Math.min(previousSession.index, previousQueue.length));

    const rebuilt = previousSession.mode === "practice"
      ? this.buildPracticeSessionForActiveNote()
      : this.buildSessionForActiveNote();
    if (!rebuilt) return;

    const merged = mergeQueueOnSync(previousQueue, previousIndex, rebuilt.queue || []);

    previousSession.queue = merged.queue;
    previousSession.index = merged.index;
    if (previousSession.stats) {
      previousSession.stats.total = merged.queue.length;
      previousSession.stats.done = Math.min(previousSession.stats.done, merged.queue.length);
    }
  }

  onFileOpen(file: TFile | null) {
    this.activeFile = file || null;
    if (this.mode === "session") {
      if (this.isSessionComplete()) {
        this.backToSummary();
        return;
      }
      return;
    }
    this.render();
  }

  private isSessionComplete(): boolean {
    if (!this.session) return true;
    return this.session.index >= this.session.queue.length;
  }

  /* ---------------------------------------------------------------- */
  /*  Markdown / rendering helpers                                     */
  /* ---------------------------------------------------------------- */

  private ensureMarkdownHelper() {
    if (this._mdHelper) return;
    this._mdHelper = new SproutMarkdownHelper({
      app: this.app,
      owner: this,
      maxHeightPx: 200,
      onZoom: (src, alt) => openSproutImageZoom(this.app, src, alt),
    });
  }

  /** Render Obsidian markdown into a container element. */
  async renderMarkdownInto(containerEl: HTMLElement, md: string, sourcePath: string) {
    this.ensureMarkdownHelper();
    if (!this._mdHelper) return;
    const withFlags = processCircleFlagsInMarkdown(md ?? "");
    await this._mdHelper.renderInto(containerEl, withFlags, sourcePath ?? "");
    hydrateCircleFlagsInElement(containerEl);
  }

  /** Render an image-occlusion card into a container. */
  async renderImageOcclusionInto(
    containerEl: HTMLElement,
    card: CardRecord,
    sourcePath: string,
    reveal: boolean,
  ) {
    const cardId = String(card.id || "");
    const isHotspot = card.type === "hq" || card.type === "hq-child";
    const hotspotAttempts = isHotspot ? this._peekPendingHotspotAttempts(cardId) : null;
    const hotspotAttempt = hotspotAttempts && hotspotAttempts.length > 0
      ? hotspotAttempts[hotspotAttempts.length - 1]
      : null;

    renderImageOcclusionReviewInto({
      app: this.app,
      plugin: this.plugin,
      containerEl,
      card,
      sourcePath,
      reveal,
      ioModule: IO,
      renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
      hotspotReview: isHotspot
        ? {
            attempt: hotspotAttempt
              ? {
                  mode: hotspotAttempt.mode,
                  x: hotspotAttempt.x,
                  y: hotspotAttempt.y,
                  correct: hotspotAttempt.correct,
                  label: String(hotspotAttempt.label || "").trim(),
                  removed: !!hotspotAttempt.removed,
                }
              : null,
            attempts: hotspotAttempts
              ? hotspotAttempts.map((entry) => ({
                  mode: entry.mode,
                  x: entry.x,
                  y: entry.y,
                  correct: entry.correct,
                  label: String(entry.label || "").trim(),
                  removed: !!entry.removed,
                }))
              : undefined,
            showDropLocationHint: this.plugin.settings?.cards?.hotspotShowDropLocationHint ?? true,
            onAttempt: reveal || !!this.session?.graded?.[cardId]
              ? undefined
              : (attempt) => this.handleHotspotAttempt(card, attempt),
          }
        : undefined,
    });
    await Promise.resolve();
  }

  private _setPendingManualGradeMeta(cardId: string, meta: ReviewMeta): void {
    this._pendingManualGrade = { cardId: String(cardId), meta };
  }

  private _peekPendingManualGradeMeta(cardId: string): ReviewMeta | null {
    if (!this._pendingManualGrade) return null;
    if (this._pendingManualGrade.cardId !== String(cardId)) return null;
    return this._pendingManualGrade.meta;
  }

  private _clearPendingManualGradeMeta(cardId?: string): void {
    if (!this._pendingManualGrade) return;
    if (cardId != null && this._pendingManualGrade.cardId !== String(cardId)) return;
    this._pendingManualGrade = null;
  }

  private _setPendingHotspotAttempt(cardId: string, attempt: Omit<HotspotAttemptState, "cardId">): void {
    const key = String(cardId);
    const next: HotspotAttemptState = { cardId: key, ...attempt };

    if (attempt.removed) {
      const existing = this._pendingHotspotAttempts.get(key) || [];
      const normalizedLabel = String(next.label || "").trim().toLowerCase();
      const kept = normalizedLabel
        ? existing.filter((entry) => String(entry.label || "").trim().toLowerCase() !== normalizedLabel)
        : existing;
      if (kept.length > 0) this._pendingHotspotAttempts.set(key, kept);
      else this._pendingHotspotAttempts.delete(key);
      return;
    }

    if (attempt.mode === "drag-drop") {
      const existing = this._pendingHotspotAttempts.get(key) || [];
      const normalizedLabel = String(next.label || "").trim().toLowerCase();
      const merged = existing.slice();
      if (normalizedLabel) {
        const idx = merged.findIndex((entry) => String(entry.label || "").trim().toLowerCase() === normalizedLabel);
        if (idx >= 0) merged[idx] = next;
        else merged.push(next);
      } else {
        merged.push(next);
      }
      this._pendingHotspotAttempts.set(key, merged);
      return;
    }

    this._pendingHotspotAttempts.set(key, [next]);
  }

  private _peekPendingHotspotAttempts(cardId: string): HotspotAttemptState[] | null {
    const attempts = this._pendingHotspotAttempts.get(String(cardId)) || null;
    if (!attempts || attempts.length === 0) return null;
    return attempts;
  }

  private _peekPendingHotspotAttempt(cardId: string): HotspotAttemptState | null {
    const attempts = this._peekPendingHotspotAttempts(cardId);
    return attempts && attempts.length > 0 ? attempts[attempts.length - 1] : null;
  }

  private _clearPendingHotspotAttempt(cardId?: string): void {
    if (cardId != null) {
      this._pendingHotspotAttempts.delete(String(cardId));
      return;
    }
    this._pendingHotspotAttempts.clear();
  }

  consumePendingManualGradeMeta(cardId: string): ReviewMeta | null {
    const id = String(cardId || "");
    const meta = this._peekPendingManualGradeMeta(id);
    this._clearPendingManualGradeMeta(id);
    return meta;
  }

  private handleHotspotAttempt(
    card: CardRecord,
    attempt: Omit<HotspotAttemptState, "cardId">,
  ): void {
    const id = String(card.id || "");
    if (!id) return;

    this._setPendingHotspotAttempt(id, attempt);
    const attempts = this._peekPendingHotspotAttempts(id) || [];
    const latest = attempts.length > 0 ? attempts[attempts.length - 1] : { cardId: id, ...attempt };
    this._setPendingManualGradeMeta(id, {
      hotspotCorrect: latest.correct,
      hotspotAttemptX: latest.x,
      hotspotAttemptY: latest.y,
      hotspotInteractionMode: latest.mode,
      hotspotAttemptLabel: String(latest.label || "").trim(),
      hotspotAttempts: attempts.map((entry) => ({
        x: entry.x,
        y: entry.y,
        correct: entry.correct,
        mode: entry.mode,
        label: String(entry.label || "").trim(),
      })),
    });
    if (attempt.mode === "drag-drop") {
      // Keep hotspot drag mode on the front until the user explicitly advances,
      // but refresh controls so placement-dependent UI stays in sync.
      this.render();
      return;
    }
    this.showAnswer = true;
    this.render();
  }

  private async gradePendingManualRating(rating: "again" | "hard" | "good" | "easy"): Promise<void> {
    const card = this.currentCard();
    if (!card) return;
    const id = String(card.id || "");
    const meta = this._peekPendingManualGradeMeta(id) ?? {};
    this._clearPendingManualGradeMeta(id);
    await this.gradeCurrentRating(rating, meta);
  }

  /* ---------------------------------------------------------------- */
  /*  Timer management                                                 */
  /* ---------------------------------------------------------------- */

  clearTimer() {
    if (this._timer) {
      window.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  armTimer() {
    this.clearTimer();
    if (this.mode !== "session" || !this.session) {
      return;
    }
    if (!this.plugin.settings.study.autoAdvanceEnabled) return;

    const sec = Number(this.plugin.settings.study.autoAdvanceSeconds);
    if (!Number.isFinite(sec) || sec <= 0) return;

    this._timer = window.setTimeout(() => {
      void (async () => {
        this._timer = null;
        await this.nextCard();
      })();
    }, sec * 1000);
    this.registerInterval(this._timer);
  }

  /* ---------------------------------------------------------------- */
  /*  Session builders                                                 */
  /* ---------------------------------------------------------------- */

  private getStudyScopeForActiveFile(): Scope | null {
    const f = this.activeFile;
    if (!f) return null;

    const folderInfo = getFolderNoteInfo(f);
    if (folderInfo && folderNotesAsDecksEnabled(this.plugin.settings)) {
      return {
        type: "folder",
        key: folderInfo.folderPath,
        name: folderInfo.folderName,
      };
    }

    return {
      type: "note",
      key: f.path,
      name: f.basename,
    };
  }

  private _getNormalizedHotspotStudyMode(): "individual" | "all" | "smart" {
    const rawStudyMode = String(this.plugin.settings?.cards?.hotspotSingleInteractionMode || "smart").trim().toLowerCase();
    if (rawStudyMode === "click" || rawStudyMode === "individual") return "individual";
    if (rawStudyMode === "drag-drop" || rawStudyMode === "all") return "all";
    return "smart";
  }

  private _normalizeHotspotQueue(queue: CardRecord[]): CardRecord[] {
    const normalizedStudyMode = this._getNormalizedHotspotStudyMode();
    const hqMap = this.plugin.store?.data?.hq || {};
    const childCountByParent = new Map<string, number>();
    const hqParentIdsInQueue = new Set<string>();
    const storedHotspotChildCountByParent = new Map<string, number>();

    const allCards = Object.values(this.plugin.store?.data?.cards || {});
    for (const card of allCards) {
      if (String(card?.type || "").toLowerCase() !== "hq-child") continue;
      const parentId = String(card?.parentId || "");
      if (!parentId) continue;
      storedHotspotChildCountByParent.set(parentId, (storedHotspotChildCountByParent.get(parentId) || 0) + 1);
    }

    const hotspotChildCountForParent = (parentId: string): number => {
      if (!parentId) return 0;
      return Math.max(
        childCountByParent.get(parentId) || 0,
        storedHotspotChildCountByParent.get(parentId) || 0,
      );
    };

    for (const card of queue) {
      const type = String(card?.type || "").toLowerCase();
      if (type === "hq") {
        const parentId = String(card?.id || "");
        if (parentId) hqParentIdsInQueue.add(parentId);
        continue;
      }
      if (type !== "hq-child") continue;
      const parentId = String(card?.parentId || "");
      if (!parentId) continue;
      childCountByParent.set(parentId, (childCountByParent.get(parentId) || 0) + 1);
    }

    const dragFallbackChildByParent = new Set<string>();

    const resolveHotspotPromptLabel = (card: CardRecord): string => {
      const type = String(card?.type || "").toLowerCase();
      const parentId = type === "hq"
        ? String(card?.id || "")
        : type === "hq-child"
          ? String(card?.parentId || "")
          : "";
      const def = parentId ? hqMap[parentId] : null;
      const rects = Array.isArray(def?.rects) ? def.rects : [];
      const rawRectIds = Array.isArray((card as { rectIds?: unknown }).rectIds)
        ? (card as { rectIds?: unknown[] }).rectIds ?? []
        : [];
      const rectIdSet = new Set(rawRectIds.map((id) => {
        if (typeof id === 'string') return id;
        if (typeof id === 'number' || typeof id === 'boolean') return String(id);
        return "";
      }).filter(Boolean));
      const candidates = rectIdSet.size > 0
        ? rects.filter((rect) => rectIdSet.has(String(rect.rectId || "")))
        : rects;
      const labeled = candidates.find((rect) => {
        const labelValue = (rect as { label?: unknown }).label;
        let label: string;
        if (typeof labelValue === 'string') {
          label = labelValue;
        } else if (typeof labelValue === 'number' || typeof labelValue === 'boolean') {
          label = String(labelValue);
        } else {
          label = "";
        }
        return label.trim();
      });
      if (labeled) {
        const labelValue = (labeled as { label?: unknown }).label;
        let label: string;
        if (typeof labelValue === 'string') {
          label = labelValue;
        } else if (typeof labelValue === 'number' || typeof labelValue === 'boolean') {
          label = String(labelValue);
        } else {
          label = "";
        }
        return label.trim();
      }
      const grouped = candidates.find((rect) => String(rect?.groupKey || "").trim());
      if (grouped) {
        const groupKey = String(grouped.groupKey || "").trim();
        return groupKey;
      }
      const cardGroupKey = String(card?.groupKey || "").trim();
      return cardGroupKey;
    };

    const resolveHotspotMode = (card: CardRecord): "click" | "drag-drop" => {
      if (normalizedStudyMode === "individual") return "click";
      if (normalizedStudyMode === "all") return "drag-drop";
      const type = String(card?.type || "").toLowerCase();
      const parentId = type === "hq"
        ? String(card?.id || "")
        : type === "hq-child"
          ? String(card?.parentId || "")
          : "";
      const siblingCount = parentId ? hotspotChildCountForParent(parentId) : 0;
      return siblingCount > 1 ? "drag-drop" : "click";
    };

    return queue.filter((card) => {
      if (!card) return false;
      const type = String(card.type || "").toLowerCase();

      if (type === "io") return false;

      if (type === "hq") {
        const mode = resolveHotspotMode(card);
        (card as unknown as Record<string, unknown>).hotspotInteractionModeOverride = mode;
        if (mode === "click") {
          (card as unknown as Record<string, unknown>).hotspotPromptLabel = resolveHotspotPromptLabel(card);
        } else {
          delete (card as unknown as Record<string, unknown>).hotspotPromptLabel;
        }
        (card as unknown as Record<string, unknown>).hotspotTargetCount = Math.max(1, hotspotChildCountForParent(String(card.id || "")));
        if (mode === "drag-drop") return true;
        // Fallback: keep parent if child cards are missing.
        return hotspotChildCountForParent(String(card.id || "")) === 0;
      }

      if (type === "hq-child") {
        const mode = resolveHotspotMode(card);
        (card as unknown as Record<string, unknown>).hotspotInteractionModeOverride = mode;
        if (mode === "click") {
          (card as unknown as Record<string, unknown>).hotspotPromptLabel = resolveHotspotPromptLabel(card);
        } else {
          delete (card as unknown as Record<string, unknown>).hotspotPromptLabel;
        }
        const parentId = String(card.parentId || "");
        (card as unknown as Record<string, unknown>).hotspotTargetCount = Math.max(1, hotspotChildCountForParent(parentId));
        if (mode !== "drag-drop") return true;

        // Drag-drop mode normally uses the parent card (all hotspots together).
        // If no parent card is queued, keep exactly one child as a proxy card and
        // force rendering/all-target behavior from the parent definition.
        if (!parentId || hqParentIdsInQueue.has(parentId)) return false;
        if (dragFallbackChildByParent.has(parentId)) return false;
        dragFallbackChildByParent.add(parentId);
        (card as unknown as Record<string, unknown>).hotspotForceAllTargets = true;
        return true;
      }

      return true;
    });
  }

  buildSessionForActiveNote(): Session | null {
    const f = this.activeFile;
    if (!f) return null;

    const scope = this.getStudyScopeForActiveFile();
    if (!scope) return null;

    const reviewSession = buildReviewerSession(this.plugin, scope);
    const queue = this._normalizeHotspotQueue(reviewSession.queue || []);

    return {
      scopeName: scope.name || f.basename,
      scopeType: scope.type === "folder" ? "folder" : "note",
      scopeKey: scope.key,
      queue,
      index: Math.max(0, Math.min(Number(reviewSession.index ?? 0), queue.length)),
      graded: {},
      stats: { total: queue.length, done: 0 },
      mode: "scheduled",
    };
  }

  private buildPracticeSessionForActiveNote(): Session | null {
    const f = this.activeFile;
    if (!f) return null;
    const scope = this.getStudyScopeForActiveFile();
    if (!scope) return null;

    const cards = getCardsInActiveScope(this.plugin.store, f, this.plugin.settings);
    const queue = this._normalizeHotspotQueue(filterReviewableCards(cards).sort((a, b) => {
      const pathA = String(a?.sourceNotePath ?? "");
      const pathB = String(b?.sourceNotePath ?? "");
      const pathCmp = pathA.localeCompare(pathB);
      if (pathCmp !== 0) return pathCmp;
      const lineA = Number(a?.sourceStartLine ?? 0);
      const lineB = Number(b?.sourceStartLine ?? 0);
      if (lineA !== lineB) return lineA - lineB;
      return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
    }));

    return {
      scopeName: scope.name || f.basename,
      scopeType: scope.type === "folder" ? "folder" : "note",
      scopeKey: scope.key,
      queue,
      index: 0,
      graded: {},
      stats: { total: queue.length, done: 0 },
      mode: "practice",
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Session navigation                                               */
  /* ---------------------------------------------------------------- */

  currentCard() {
    if (!this.session) return null;
    return this.session.queue[this.session.index] || null;
  }

  /* ---------------------------------------------------------------- */
  /*  Delegated session actions                                        */
  /* ---------------------------------------------------------------- */

  async gradeCurrentRating(rating: "again" | "hard" | "good" | "easy", meta: ReviewMeta | null) {
    return _gradeCurrentRating(this, rating, meta);
  }
  canUndo(): boolean {
    return _canUndo(this);
  }
  async undoLastGrade(): Promise<void> {
    return _undoLastGrade(this);
  }
  async buryCurrentCard() {
    return _buryCurrentCard(this);
  }
  async suspendCurrentCard() {
    return _suspendCurrentCard(this);
  }
  async answerMcq(choiceIdx: number) {
    return _answerMcq(this, choiceIdx);
  }
  async answerMcqMulti(selectedIndices: number[]) {
    return _answerMcqMulti(this, selectedIndices);
  }
  async answerOq(userOrder: number[]) {
    return _answerOq(this, userOrder);
  }
  async nextCard() {
    const card = this.currentCard();
    if (card) {
      const id = String(card.id || "");
      this._clearPendingManualGradeMeta(id);
      this._clearPendingHotspotAttempt(id);
    }
    return _nextCard(this);
  }
  openEditModalForCurrentCard() {
    return _openEditModalForCurrentCard(this);
  }

  /* ---------------------------------------------------------------- */
  /*  Session lifecycle                                                */
  /* ---------------------------------------------------------------- */

  startSession() {
    this.clearTimer();
    this.session = this.buildSessionForActiveNote();
    this.mode = "session";
    this.showAnswer = false;
    this._undoStack.length = 0;
    this._lastTtsKey = "";
    this._pendingManualGrade = null;
    this._pendingHotspotAttempts = new Map();
    this._sessionStamp = Date.now();
    this.render();
  }

  startPracticeSession() {
    this.clearTimer();
    this.session = this.buildPracticeSessionForActiveNote();
    this.mode = "session";
    this.showAnswer = false;
    this._undoStack.length = 0;
    this._lastTtsKey = "";
    this._pendingManualGrade = null;
    this._pendingHotspotAttempts = new Map();
    this._sessionStamp = Date.now();
    this.render();
  }

  backToSummary() {
    this.clearTimer();
    this.mode = "summary";
    this.session = null;
    this.showAnswer = false;
    this._undoStack.length = 0;
    this._lastTtsKey = "";
    this._pendingManualGrade = null;
    this._pendingHotspotAttempts = new Map();
    this._moreMenuToggle = null;
    this.render();
  }

  async openCurrentInStudyView(): Promise<void> {
    const scope = this.getStudyScopeForActiveFile();
    if (!scope) return;

    const card = this.currentCard();
    const currentCardId = card ? String(card.id ?? "") : "";

    const currentMcqOrder = (() => {
      if (!card || card.type !== "mcq") return undefined;
      const id = String(card.id ?? "");
      const order = this.session?.mcqOrderMap?.[id];
      return Array.isArray(order) ? order.slice() : undefined;
    })();

    type StudyHandoff = {
      scope: Scope;
      currentCardId?: string;
      showAnswer?: boolean;
      currentMcqOrder?: number[];
    };

    type ReviewerViewLike = {
      openSessionFromWidget?: (payload: StudyHandoff) => void;
      openSession?: (scope: Scope) => void;
    };

    try {
      await this.plugin.openReviewerTab();
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEWER)[0];
      const view = leaf?.view as ReviewerViewLike | undefined;

      const payload: StudyHandoff = {
        scope,
        currentCardId: currentCardId || undefined,
        showAnswer: !!this.showAnswer,
        currentMcqOrder,
      };

      if (view && typeof view.openSessionFromWidget === "function") {
        view.openSessionFromWidget(payload);
        return;
      }

      if (view && typeof view.openSession === "function") {
        view.openSession(scope);
        return;
      }

      new Notice(this._tx("ui.widget.notice.studyViewNotReady", "Study view not ready yet. Try again."));
    } catch {
      new Notice(this._tx("ui.widget.notice.unableToOpenStudy", "Unable to open study."));
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Keyboard handler                                                 */
  /* ---------------------------------------------------------------- */

  private handleKey(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    )
      return;

    const key = ev.key.toLowerCase();
    const isCtrl = ev.ctrlKey || ev.metaKey;

    if (this.mode === "summary") {
      if (ev.key === "Enter" && !isCtrl) {
        ev.preventDefault();
        const cards = getCardsInActiveScope(this.plugin.store, this.activeFile, this.plugin.settings);
        if (!cards.length) return;
        const queueCount = this.buildSessionForActiveNote()?.queue?.length ?? 0;
        if (queueCount > 0) this.startSession();
        else this.startPracticeSession();
      }
      return;
    }

    if (this.mode !== "session" || !this.session) return;

    const card = this.currentCard();
    if (!card) return;

    const graded = this.session.graded[String(card.id)] || null;
    const isPractice = this.session.mode === "practice";

    if (key === "e" && !isCtrl) {
      ev.preventDefault();
      this.openEditModalForCurrentCard();
      return;
    }
    if (key === "m" && !isCtrl) {
      ev.preventDefault();
      this._moreMenuToggle?.();
      return;
    }
    if (key === "b" && !isCtrl) {
      ev.preventDefault();
      if (isPractice) return;
      void this.buryCurrentCard();
      return;
    }
    if (key === "t" && !isCtrl) {
      ev.preventDefault();
      void this.openCurrentInStudyView();
      return;
    }
    if (key === "s" && !isCtrl) {
      ev.preventDefault();
      if (isPractice) return;
      void this.suspendCurrentCard();
      return;
    }
    if (key === "u" && !isCtrl) {
      ev.preventDefault();
      if (isPractice) return;
      void this.undoLastGrade();
      return;
    }

    const ioLike = card.type === "io" || card.type === "io-child" || card.type === "hq" || card.type === "hq-child";
    const hotspotCard = card.type === "hq" || card.type === "hq-child";

    if (ev.key === "Enter" || ev.key === " " || ev.code === "Space" || ev.key === "ArrowRight") {
      ev.preventDefault();
      if (card.type === "mcq") {
        if (graded) { void this.nextCard(); return; }
        // Multi-answer: Enter submits the selection
        if (isMultiAnswerMcq(card) && this._mcqMultiSelected.size > 0) {
          void this.answerMcqMulti([...this._mcqMultiSelected]);
          return;
        }
        // Multi-answer: shake + tooltip on empty submit
        if (isMultiAnswerMcq(card) && this._mcqMultiSelected.size === 0) {
          const submitBtnEl = this.containerEl.querySelector<HTMLButtonElement>(".learnkit-mcq-submit-btn");
          if (submitBtnEl) {
            submitBtnEl.classList.add("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
            submitBtnEl.addEventListener("animationend", () => {
              submitBtnEl.classList.remove("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
            }, { once: true });
            if (submitBtnEl.dataset.emptyAttempt === "1") {
              submitBtnEl.setAttribute("aria-label", this._tx("ui.reviewer.mcq.chooseOne", "Choose at least one answer to proceed"));
              submitBtnEl.setAttribute("data-tooltip-position", "top");
              submitBtnEl.classList.add("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
              setTimeout(() => {
                submitBtnEl.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
              }, 2500);
            }
            submitBtnEl.dataset.emptyAttempt = String(Number(submitBtnEl.dataset.emptyAttempt || "0") + 1);
          }
        }
        return;
      }
      if (card.type === "oq") {
        if (graded) { void this.nextCard(); return; }
        // Enter submits the current order
        const s = this.session as unknown as { oqOrderMap?: Record<string, number[]> };
        const oqMap = s?.oqOrderMap || {};
        const oqCurrentOrder = oqMap[String(card.id)];
        if (Array.isArray(oqCurrentOrder) && oqCurrentOrder.length > 0) {
          void this.answerOq(oqCurrentOrder.slice());
        }
        return;
      }
      if (hotspotCard) {
        if (graded) {
          void this.nextCard();
        }
        return;
      }
      if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) {
        if (!this.showAnswer) {
          this.showAnswer = true;
          this.render();
          return;
        }
        void this.nextCard();
        return;
      }
      void this.nextCard();
      return;
    }

    if (ev.key === "1" || ev.key === "2" || ev.key === "3" || ev.key === "4") {
      ev.preventDefault();
      if (card.type === "mcq") {
        const options = Array.isArray(card.options) ? card.options : [];
        const displayIdx = Number(ev.key) - 1;
        if (displayIdx < 0 || displayIdx >= options.length) return;

        const randomize = !!(this.plugin.settings.study?.randomizeMcqOptions);
        const order = getWidgetMcqDisplayOrder(this.session, card, randomize);
        const origIdx = order[displayIdx];
        if (!Number.isInteger(origIdx)) return;

        if (isMultiAnswerMcq(card)) {
          // Multi-answer: toggle selection
          if (this._mcqMultiCardId !== String(card.id)) {
            this._mcqMultiSelected = new Set<number>();
            this._mcqMultiCardId = String(card.id);
          }
          if (this._mcqMultiSelected.has(origIdx)) this._mcqMultiSelected.delete(origIdx);
          else this._mcqMultiSelected.add(origIdx);
          this.render();
        } else {
          void this.answerMcq(origIdx);
        }
        return;
      }
      if (isPractice) return;

      if (hotspotCard) {
        if (!this.showAnswer) return;
        if (!graded) {
          const ratingMap: Record<string, "again" | "hard" | "good" | "easy"> = {
            "1": "again",
            "2": "hard",
            "3": "good",
            "4": "easy",
          };
          const rating = ratingMap[ev.key];
          if (rating) {
            void this.gradePendingManualRating(rating).then(() => void this.nextCard());
          }
          return;
        }
        void this.nextCard();
        return;
      }

      if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) {
        if (!this.showAnswer) {
          this.showAnswer = true;
          this.render();
          return;
        }

        if (!graded) {
          const ratingMap: Record<string, "again" | "hard" | "good" | "easy"> = {
            "1": "again",
            "2": "hard",
            "3": "good",
            "4": "easy",
          };
          const rating = ratingMap[ev.key];
          if (rating) {
            void this.gradeCurrentRating(rating, {}).then(() => void this.nextCard());
          }
          return;
        }

        void this.nextCard();
        return;
      }

      void this.nextCard();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Top-level render dispatch                                        */
  /* ---------------------------------------------------------------- */

  render() {
    const root = this.containerEl;
    const hadFocusWithin = !!document.activeElement && root.contains(document.activeElement);
    root.empty();
    root.removeClass("learnkit");

    if (this.mode === "session") renderWidgetSession(this, root);
    else renderWidgetSummary(this, root);

    // Preserve keyboard control after rerenders (e.g. reveal -> next transitions).
    if (hadFocusWithin) {
      queueMicrotask(() => {
        if (!root.isConnected || root.offsetParent === null) return;
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            active.isContentEditable ||
            !!active.closest("input, textarea, select, [contenteditable]"))
        )
          return;
        root.focus();
      });
    }
  }

  onunload() {
    this.clearTimer();
    this._mdHelper = null;
    this._timing = null;
    this.session = null;
    this._undoStack.length = 0;
    this._pendingManualGrade = null;
    this._pendingHotspotAttempts = new Map();
    this._moreMenuToggle = null;

    // Remove global reference set in constructor
    const globalWindow = window as unknown as Record<string, unknown>;
    if (globalWindow.SproutWidgetView === this) {
      delete globalWindow.SproutWidgetView;
    }
  }
}
