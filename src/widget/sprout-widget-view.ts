/**
 * @file src/widget/sprout-widget-view.ts
 * @summary The Sprout sidebar widget — an Obsidian ItemView that displays a lightweight flashcard review session for the currently-open note. Manages summary mode (card counts and "Start Studying" button), session mode (one-at-a-time card review with grading, undo, bury, suspend), keyboard shortcuts, folder-note deck support, and inline card editing. Most logic is delegated to sibling modules (widget-markdown, widget-scope, widget-session-actions, widget-render-summary, widget-render-session).
 *
 * @exports
 *  - SproutWidgetView — Obsidian ItemView subclass implementing the sidebar flashcard-review widget
 */

import { ItemView, Notice, type TFile, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../core/constants";
import { SproutMarkdownHelper } from "../reviewer/markdown-render";
import { openSproutImageZoom } from "../reviewer/zoom";
import { buildSession as buildReviewerSession } from "../reviewer/session";
import type { Scope } from "../reviewer/types";
import * as IO from "../imageocclusion/image-occlusion-index";
import { renderImageOcclusionReviewInto } from "../imageocclusion/image-occlusion-review-render";
import type SproutPlugin from "../main";

import type { Session, UndoFrame, ReviewMeta } from "./widget-helpers";
import type { CardRecord } from "../types/card";
import { isMultiAnswerMcq } from "../types/card";
import { filterReviewableCards, getWidgetMcqDisplayOrder, isClozeLike } from "./widget-helpers";
import { getCardsInActiveScope, getFolderNoteInfo, folderNotesAsDecksEnabled } from "./widget-scope";
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
} from "./widget-session-actions";
import { renderWidgetSummary } from "./widget-render-summary";
import { renderWidgetSession } from "./widget-render-session";

/* ================================================================== */
/*  SproutWidgetView                                                   */
/* ================================================================== */

export class SproutWidgetView extends ItemView {
  plugin: SproutPlugin;
  activeFile: TFile | null = null;

  mode: "summary" | "session" = "summary";
  session: Session | null = null;

  showAnswer = false;
  /** @internal */ _timer: number | null = null;
  /** @internal */ _timing: { cardId: string; startedAt: number } | null = null;
  /** @internal */ _undo: UndoFrame | null = null;
  /** @internal */ _sessionStamp = 0;
  /** @internal */ _moreMenuToggle: (() => void) | null = null;
  private _mdHelper: SproutMarkdownHelper | null = null;

  /** Stores user-typed cloze answers by cloze index for typed-mode cloze cards. */
  private _typedClozeAnswers = new Map<number, string>();
  /** Tracks the current card ID to reset typed answers when card changes. */
  private _typedClozeCardId = "";
  /** Tracks multi-answer MCQ selections. */
  _mcqMultiSelected = new Set<number>();
  _mcqMultiCardId = "";

  private _keysBound = false;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
    // Expose instance globally for readingView integration
    window.SproutWidgetView = this;
  }

  getViewType() {
    return VIEW_TYPE_WIDGET;
  }

  getDisplayText() {
    return "Sprout";
  }

  getIcon() {
    return "lucide-sprout";
  }

  async onOpen() {
    this.activeFile = this.app.workspace.getActiveFile();

    // Keyboard shortcuts only when this view has focus
    this.containerEl.tabIndex = 0;
    this.containerEl.addEventListener("mousedown", () => this.containerEl.focus());

    if (!this._keysBound) {
      this._keysBound = true;
      this.containerEl.addEventListener("keydown", (ev) => this.handleKey(ev));
    }

    this.render();
    await Promise.resolve();
  }

  onRefresh() {
    this.render();
  }

  onFileOpen(file: TFile | null) {
    this.activeFile = file || null;
    if (this.mode === "session") {
      this.mode = "summary";
      this.session = null;
      this.showAnswer = false;
    }
    this.render();
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
    await this._mdHelper.renderInto(containerEl, md ?? "", sourcePath ?? "");
  }

  /** Render an image-occlusion card into a container. */
  async renderImageOcclusionInto(
    containerEl: HTMLElement,
    card: CardRecord,
    sourcePath: string,
    reveal: boolean,
  ) {
    renderImageOcclusionReviewInto({
      app: this.app,
      plugin: this.plugin,
      containerEl,
      card,
      sourcePath,
      reveal,
      ioModule: IO,
      renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
    });
    await Promise.resolve();
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

  buildSessionForActiveNote(): Session | null {
    const f = this.activeFile;
    if (!f) return null;

    const scope = this.getStudyScopeForActiveFile();
    if (!scope) return null;

    const reviewSession = buildReviewerSession(this.plugin, scope);
    const queue = reviewSession.queue || [];

    return {
      scopeName: scope.name || f.basename,
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

    const cards = getCardsInActiveScope(this.plugin.store, f, this.plugin.settings);
    const queue = filterReviewableCards(cards).sort((a, b) => {
      const pathA = String(a?.sourceNotePath ?? "");
      const pathB = String(b?.sourceNotePath ?? "");
      const pathCmp = pathA.localeCompare(pathB);
      if (pathCmp !== 0) return pathCmp;
      const lineA = Number(a?.sourceStartLine ?? 0);
      const lineB = Number(b?.sourceStartLine ?? 0);
      if (lineA !== lineB) return lineA - lineB;
      return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
    });

    return {
      scopeName: f.basename,
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
    this._undo = null;
    this._sessionStamp = Date.now();
    this.render();
  }

  startPracticeSession() {
    this.clearTimer();
    this.session = this.buildPracticeSessionForActiveNote();
    this.mode = "session";
    this.showAnswer = false;
    this._undo = null;
    this._sessionStamp = Date.now();
    this.render();
  }

  backToSummary() {
    this.clearTimer();
    this.mode = "summary";
    this.session = null;
    this.showAnswer = false;
    this._undo = null;
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

      new Notice("Study view not ready yet. Try again.");
    } catch {
      new Notice("Unable to open study.");
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
    if (key === "y" && !isCtrl) {
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

    const ioLike = card.type === "io" || card.type === "io-child";

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
          const submitBtnEl = this.containerEl.querySelector<HTMLButtonElement>(".sprout-mcq-submit-btn");
          if (submitBtnEl) {
            submitBtnEl.classList.add("sprout-mcq-submit-shake");
            submitBtnEl.addEventListener("animationend", () => {
              submitBtnEl.classList.remove("sprout-mcq-submit-shake");
            }, { once: true });
            if (submitBtnEl.dataset.emptyAttempt === "1") {
              submitBtnEl.setAttribute("data-tooltip", "Choose at least one answer to proceed");
              submitBtnEl.setAttribute("data-tooltip-position", "top");
              submitBtnEl.classList.add("sprout-mcq-submit-tooltip-visible");
              setTimeout(() => {
                submitBtnEl.classList.remove("sprout-mcq-submit-tooltip-visible");
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
    root.empty();
    root.removeClass("sprout");

    if (this.mode === "session") renderWidgetSession(this, root);
    else renderWidgetSummary(this, root);
  }

  onunload() {
    this.clearTimer();
    this._mdHelper = null;
    this._timing = null;
    this.session = null;
    this._undo = null;
    this._moreMenuToggle = null;

    // Remove global reference set in constructor
    if ((window as Record<string, unknown>).SproutWidgetView === this) {
      delete (window as Record<string, unknown>).SproutWidgetView;
    }
  }
}
