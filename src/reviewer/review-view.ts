/**
 * @file src/reviewer/review-view.ts
 * @summary The main reviewer view class for Sprout. Extends Obsidian's ItemView to provide the full study experience including deck browsing, session management, card grading (FSRS-based), undo, skip, bury/suspend, practice mode, image occlusion, MCQ randomisation, Markdown rendering, and keyboard navigation.
 *
 * @exports
 *   - SproutReviewerView — ItemView subclass that manages the reviewer's lifecycle, state, rendering, and user interactions
 */

import {
  ItemView,
  Notice,
  type WorkspaceLeaf,
  MarkdownView,
  TFile,
  setIcon,
} from "obsidian";

import { AOS_DURATION, BRAND, MAX_CONTENT_WIDTH, MAX_CONTENT_WIDTH_PX, MS_DAY, VIEW_TYPE_REVIEWER } from "../core/constants";
import { log } from "../core/logger";
import { gradeFromRating } from "../scheduler/scheduler";
import { syncOneFile } from "../sync/sync-engine";
import { ParseErrorModal } from "../modals/parse-error-modal";
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import type SproutPlugin from "../main";

import type { Scope, Session, Rating } from "./types";
import type { CardRecord } from "../types/card";
import { buildSession, getNextDueInScope } from "./session";
import { formatCountdown } from "./timers";
import { renderClozeFront } from "./question-cloze";
import { renderDeckMode } from "./render-deck";
import { renderSessionMode } from "./render-session";
import { initAOS } from "../core/aos-loader";

import { openSproutImageZoom } from "./zoom";
import { SproutMarkdownHelper } from "./markdown-render";

// split-out helpers
import { isSkipEnabled, initSkipState, skipCurrentCard } from "./skip";
import {
  initMcqOrderState,
  isMcqOptionRandomisationEnabled,
  getMcqOptionOrder,
} from "./question-mcq";
import {
  closeMoreMenu as closeMoreMenuImpl,
} from "./more-menu";
import { logFsrsIfNeeded, logUndoIfNeeded } from "./fsrs-log";
import { renderTitleMarkdownIfNeeded } from "./title-markdown";
import { keybox, makePlainButton, appendKeyboxRight } from "./ui";
import { findCardBlockRangeById, buildCardBlockMarkdown } from "./markdown-block";

import type { CardState } from "../core/store";

import { deepClone, clampInt } from "./utilities";
import { matchesScope } from "../indexes/scope-match";

import * as IO from "../imageocclusion/image-occlusion-index";
import {
  isIoParentCard,
  isIoRevealableType,
  renderImageOcclusionReviewInto,
} from "../imageocclusion/image-occlusion-review-render";

// ✅ shared header import (like browser.ts)
import { type SproutHeader, createViewHeader } from "../core/header";

function isFourButtonMode(plugin: SproutPlugin): boolean {
  return !!(plugin.settings?.reviewer?.fourButtonMode);
}

type UndoFrame = {
  sessionStamp: number;

  id: string;
  cardType: string;
  rating: Rating;
  at: number;
  meta: Record<string, unknown> | null;

  sessionIndex: number;
  showAnswer: boolean;

  storeMutated: boolean;
  analyticsMutated: boolean;

  reviewLogLenBefore: number;
  analyticsLenBefore: number;

  prevState: CardState | null;
};

export class SproutReviewerView extends ItemView {
  plugin: SproutPlugin;

  mode: "deck" | "session" = "deck";
  expanded = new Set<string>([""]);
  session: Session | null = null;

  showAnswer = false;
  private _timer: number | null = null;
  private _keysBound = false;

  private _countdownInterval: number | null = null;

  private _sessionStamp = 0;
  private _undo: UndoFrame | null = null;
  private _firstSessionRender = true;

  // time-to-answer proxy
  private _timing: { stamp: number; cardId: string; startedAt: number } = {
    stamp: 0,
    cardId: "",
    startedAt: 0,
  };

  _moreOpen = false;
  _moreWrap: HTMLElement | null = null;
  _moreMenuEl: HTMLElement | null = null;
  _moreBtnEl: HTMLElement | null = null;
  _moreOutsideBound = false;

  // Width toggle (header action)
  // Removed: private _isWideReviewer = false; (now using plugin.isWideMode)
  private _widthToggleActionEl: HTMLElement | null = null;

  private readonly _imgMaxHeightPx = 200;
  private _md: SproutMarkdownHelper | null = null;

  // Add shared header instance
  private _header: SproutHeader | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_REVIEWER;
  }
  getDisplayText() {
    return "Study";
  }
  getIcon() {
    return "star";
  }

  private _wideLabel(): string {
    const wide = this.plugin.isWideMode;
    if (this.mode === "deck") return wide ? "Collapse table" : "Expand table";
    return wide ? "Collapse content" : "Expand content";
  }

  private _wideIcon(): string {
    return this.plugin.isWideMode ? "minimize-2" : "maximize-2";
  }

  private _applyReviewerWidthMode() {
    const root = this.contentEl as HTMLElement | null;
    if (!root) return;

    // Set data-sprout-wide attribute on containerEl (same as browser.ts)
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    const containerWidth = this.containerEl?.clientWidth ?? 0;
    const hideToggle = containerWidth > 0 ? containerWidth < MAX_CONTENT_WIDTH : typeof window !== "undefined" && window.innerWidth < MAX_CONTENT_WIDTH;
    if (this._widthToggleActionEl) {
      this._widthToggleActionEl.style.display = hideToggle ? "none" : "";
    }

    if (this.plugin.isWideMode) {
      root.style.setProperty("max-width", "none", "important");
      root.style.setProperty("width", "100%", "important");
      root.style.setProperty("margin-left", "auto", "important");
      root.style.setProperty("margin-right", "auto", "important");
    } else {
      root.style.setProperty("max-width", MAX_CONTENT_WIDTH_PX, "important");
      root.style.setProperty("width", "100%", "important");
      root.style.setProperty("margin-left", "auto", "important");
      root.style.setProperty("margin-right", "auto", "important");
    }

    const btn = this._widthToggleActionEl;
    if (btn) {
      const label = this._wideLabel();
      btn.setAttribute("data-tooltip", label);
      btn.setAttribute("title", label);

      btn.classList.toggle("is-active", this.plugin.isWideMode);
      btn.dataset.bcAction = "toggle-browser-width";

      btn.querySelectorAll(".svg-icon, svg").forEach((n) => n.remove());
      setIcon(btn, this._wideIcon());
    }
  }

  private resetTiming() {
    this._timing = { stamp: 0, cardId: "", startedAt: 0 };
  }

  private noteCardPresented(card: CardRecord) {
    if (!this.session) return;

    const stamp = this.getSessionStamp();
    const id = String((card)?.id ?? "");
    if (!id) return;

    // If this card is already graded in-session, do not start a timer.
    if (this.session.graded?.[id]) {
      this._timing = { stamp, cardId: id, startedAt: 0 };
      return;
    }

    if (this._timing.stamp !== stamp || this._timing.cardId !== id) {
      this._timing = { stamp, cardId: id, startedAt: Date.now() };
    }
  }

  private computeMsToAnswer(now: number, id: string) {
    const stamp = this.getSessionStamp();
    if (this._timing.stamp !== stamp) return undefined;
    if (this._timing.cardId !== id) return undefined;
    if (!this._timing.startedAt) return undefined;

    const raw = now - this._timing.startedAt;
    if (!Number.isFinite(raw) || raw <= 0) return undefined;

    // Hard cap: prevent pathological overcount if user walks away.
    return Math.max(0, Math.min(raw, 5 * 60 * 1000));
  }

  // -----------------------------
  // Undo
  // -----------------------------

  private clearUndo() {
    this._undo = null;
  }

  private getSessionStamp(): number {
    return Number(this.session?._bcStamp ?? 0);
  }

  canUndo(): boolean {
    if (this.mode !== "session" || !this.session) return false;
    const u = this._undo;
    if (!u) return false;
    if (this.getSessionStamp() !== u.sessionStamp) return false;
    return !!this.session.graded?.[u.id];
  }

  async undoLastGrade(): Promise<void> {
    if (this.mode !== "session" || !this.session) return;

    const u = this._undo;
    if (!u) return;

    if (this.getSessionStamp() !== u.sessionStamp) {
      this.clearUndo();
      this.render();
      return;
    }

    if (!this.session.graded?.[u.id]) {
      this.clearUndo();
      this.render();
      return;
    }

    this._undo = null;

    const store = this.plugin.store;

    const fromState = u.storeMutated ? deepClone(store.getState(u.id)) : null;

    try {
      const needPersist = u.storeMutated || u.analyticsMutated;

      if (u.storeMutated) {
        if (u.prevState) store.upsertState(deepClone(u.prevState));
        store.truncateReviewLog(u.reviewLogLenBefore);
      }

      if (u.analyticsMutated) {
        store.truncateAnalyticsEvents(u.analyticsLenBefore);
      }

      if (needPersist) await store.persist();

      delete this.session.graded[u.id];
      this.session.stats.done = Object.keys(this.session.graded || {}).length;

      const maxIdx = Math.max(0, Number(this.session.queue?.length ?? 0));
      this.session.index = clampInt(u.sessionIndex, 0, maxIdx);

      // Reset to show question (front) to allow restudying
      this.showAnswer = false;

      const toState = u.storeMutated ? store.getState(u.id) : null;

      logUndoIfNeeded({
        id: u.id,
        cardType: u.cardType,
        ratingUndone: u.rating,
        meta: u.meta ?? undefined,
        storeReverted: u.storeMutated,
        fromState,
        toState,
      });

      this.render();
    } catch (e) {
      log.error(`UNDO: failed`, e);
      new Notice(`${BRAND}: undo failed. See console.`);
      this.render();
    }
  }

  // -----------------------------
  // Practice session helpers
  // -----------------------------

  private isPracticeSession(): boolean {
    return !!(this.session && this.session.practice);
  }

  private buildPracticeQueue(scope: Scope, excludeIds?: Set<string>): CardRecord[] {
    const now = Date.now();

    const cardsObj = (this.plugin.store.data?.cards || {}) as Record<string, CardRecord>;
    const cards = Object.values(cardsObj);

    const out: CardRecord[] = [];

    for (const c of cards) {
      if (isIoParentCard(c)) continue;

      const id = String((c)?.id ?? "");
      if (!id) continue;
      if (excludeIds?.has(id)) continue;

      const st = this.plugin.store.getState(id);
      if (!st) continue;

      if (String(st.stage || "") === "suspended") continue;

      const due = Number(st.due ?? 0);
      if (!Number.isFinite(due)) continue;
      if (due <= now) continue;

      const path = String(
        (c).sourceNotePath || (c).sourcePath || (c).location || "",
      );
      if (!path) continue;
      if (!matchesScope(scope, path)) continue;

      out.push(c);
    }

    out.sort((a, b) => {
      const da = Number(
        this.plugin.store.getState(String((a).id))?.due ?? Number.POSITIVE_INFINITY,
      );
      const db = Number(
        this.plugin.store.getState(String((b).id))?.due ?? Number.POSITIVE_INFINITY,
      );
      if (da !== db) return da - db;
      return String((a).id).localeCompare(String((b).id));
    });

    return out;
  }

  private canStartPractice(scope: Scope): boolean {
    if (!this.session) return false;
    if (this.isPracticeSession()) return false;

    const card = this.currentCard();
    if (card) return false;

    const exclude = new Set<string>(Object.keys(this.session.graded || {}));

    return (
      this.buildPracticeQueue(scope, exclude).length > 0 || this.buildPracticeQueue(scope).length > 0
    );
  }

  private startPracticeFromCurrentScope() {
    if (!this.session) return;
    if (this.isPracticeSession()) return;

    const scope = this.session.scope;

    const exclude = new Set<string>(Object.keys(this.session.graded || {}));

    let queue = this.buildPracticeQueue(scope, exclude);
    if (!queue.length) queue = this.buildPracticeQueue(scope);

    if (!queue.length) {
      new Notice(`${BRAND}: no cards available for practice in this scope.`);
      return;
    }

    this.clearUndo();
    this.resetTiming();

    this.clearTimer();
    this.clearCountdown();
    closeMoreMenuImpl(this);

    const s: Session = {
      scope,
      queue,
      index: 0,
      graded: {},
      stats: { total: queue.length, done: 0 },
    };

    s.practice = true;
    s._bcStamp = ++this._sessionStamp;

    this.mode = "session";
    this.session = s;
    this._firstSessionRender = true;

    initMcqOrderState(this.session);
    initSkipState(this.session);

    this.showAnswer = false;
    this.render();
  }

  private skipPracticeCard() {
    if (!this.session) return;
    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id ?? "");
    if (!id) return;
    if (this.session.graded[id]) return;

    const q = this.session.queue;
    const idx = this.session.index;
    if (idx < 0 || idx >= q.length) return;

    if (q.length <= 1) {
      this.showAnswer = false;
      this.render();
      return;
    }

    const [removed] = q.splice(idx, 1);
    q.push(removed);

    this.showAnswer = false;
    this.render();
  }

  private doSkipCurrentCard(meta?: Record<string, unknown>) {
    if (!this.session) return;

    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id ?? "");
    if (!id) return;

    if (this.session.graded[id]) return;

    try {
      const extraMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};

      logFsrsIfNeeded({
        id,
        cardType: String(card.type ?? "unknown"),
        rating: "skip",
        meta: {
          action: "skip",
          via: this.isPracticeSession() ? "practice" : "review",
          done: Number(this.session?.stats?.done ?? 0),
          total: Number(this.session?.stats?.total ?? 0),
          ...extraMeta,
        },
      });
    } catch (e) {
      log.warn("Boot Camp: failed to log skip", e);
    }

    if (this.isPracticeSession()) {
      this.skipPracticeCard();
      return;
    }

    void skipCurrentCard(this);
  }



  // -----------------------------
  // Markdown + IO rendering hooks
  // -----------------------------

  private ensureMarkdownHelper() {
    if (this._md) return;
    this._md = new SproutMarkdownHelper({
      app: this.app,
      owner: this,
      maxHeightPx: this._imgMaxHeightPx,
      onZoom: (src, alt) => openSproutImageZoom(this.app, src, alt),
    });
  }

  // Used by renderSession.ts
  async renderMarkdownInto(containerEl: HTMLElement, md: string, sourcePath: string) {
    this.ensureMarkdownHelper();
    if (!this._md) return;
    await this._md.renderInto(containerEl, md ?? "", sourcePath ?? "");
  }

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
  }

  async onOpen() {
    this.containerEl.tabIndex = 0;
    this.ensureMarkdownHelper();

    const focusSelf = () => this.containerEl.focus();
    this.containerEl.addEventListener("mousedown", focusSelf);
    this.containerEl.addEventListener("click", focusSelf);
    queueMicrotask(() => focusSelf());

    if (!this._keysBound) {
      this._keysBound = true;

      this.registerDomEvent(this.containerEl, "keydown", (ev: KeyboardEvent) => this.handleKey(ev));

      this.registerDomEvent(window, "keydown", (ev: KeyboardEvent) => this.handleKey(ev), {
        capture: true,
      });
    }

    if (!this._moreOutsideBound) {
      this._moreOutsideBound = true;

      this.registerDomEvent(
        document,
        "mousedown",
        (ev: MouseEvent) => {
          if (!this._moreOpen) return;
          if (!this.isActiveLeaf()) return;

          const t = ev.target as Node | null;
          if (!t) return;

          if (this._moreWrap && this._moreWrap.contains(t)) return;
          if (this._moreMenuEl && this._moreMenuEl.contains(t)) return;
          closeMoreMenuImpl(this);
        },
        { capture: true },
      );
    }

    this.render();
  }

  async onClose() {
    this.clearTimer();
    this.clearCountdown();
    closeMoreMenuImpl(this);
    this.clearUndo();
  }

  onRefresh() {
    this.render();
  }

  clearTimer() {
    if (this._timer) {
      window.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  clearCountdown() {
    if (this._countdownInterval) {
      window.clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
  }

  private startCountdown(nextDue: number, line: HTMLElement) {
    this.clearCountdown();

    const update = () => {
      const ms = nextDue - Date.now();
      line.textContent = `Next card due in: ${formatCountdown(ms)}`;
    };

    update();
    this._countdownInterval = window.setInterval(update, 1000);
  }

  private armTimer() {
    this.clearTimer();
    if (this.mode !== "session") return;
    if (!this.plugin.settings.reviewer.autoAdvanceEnabled) return;

    const sec = Number(this.plugin.settings.reviewer.autoAdvanceSeconds);
    if (!Number.isFinite(sec) || sec <= 0) return;

    this._timer = window.setTimeout(() => {
      this._timer = null;
      this.onAutoAdvance();
    }, sec * 1000);
  }

  private onAutoAdvance() {
    if (this.mode !== "session" || !this.session) return;

    const card = this.currentCard();
    if (!card) return;

    const graded = this.session.graded[String(card.id)];
    if (graded) {
      void this.nextCard(false);
    } else {
      void this.gradeCurrentRating("again", { auto: true }).then(() => void this.nextCard(false));
    }
  }

  private buildSession(scope: Scope): Session {
    return buildSession(this.plugin, scope);
  }

  private getNextDueInScope(scope: Scope): number | null {
    return getNextDueInScope(this.plugin, scope);
  }

  currentCard() {
    if (!this.session) return null;
    return this.session.queue[this.session.index] || null;
  }

  async openCurrentCardInNote() {
    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id || "");
    const path = String(card.sourceNotePath || "");
    if (!id || !path) return;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const leaf = this.app.workspace.getLeaf(true);

    await leaf.setViewState(
      {
        type: "markdown",
        state: { file: file.path, mode: "source" },
        active: true,
      },
      { focus: true },
    );

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;

    const waitForEditor = async () => {
      for (let i = 0; i < 30; i++) {
        const ed = view.editor;
        if (ed) return ed;
        await new Promise((r) => setTimeout(r, 25));
      }
      return null;
    };

    const ed = await waitForEditor();
    if (!ed) return;

    const needle = `^sprout-${id}`;
    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);

    let lineNo = lines.findIndex((l) => l.includes(needle));
    if (lineNo < 0) return;

    if (lines[lineNo].trim() === needle) {
      let t = lineNo + 1;
      while (t < lines.length && lines[t].trim() === "") t++;
      if (t < lines.length) lineNo = t;
    }

    ed.setCursor({ line: lineNo, ch: 0 });
    ed.scrollIntoView({ from: { line: lineNo, ch: 0 }, to: { line: lineNo, ch: 0 } }, true);
    ed.focus();
  }

  openEditModalForCurrentCard() {
    const card = this.currentCard();
    if (!card) return;

    const cardType = String(card.type || "").toLowerCase();
    
    // Skip IO cards - they have their own editor
    if (["io", "io-child"].includes(cardType)) return;

    // If this is a cloze child, edit the parent cloze instead so changes persist to the source note
    let targetCard = card;
    if (cardType === "cloze-child") {
      const parentId = String(card.parentId || "");
      if (!parentId) {
        new Notice("Cannot edit cloze child: missing parent card.");
        return;
      }

      const parentCard = (this.plugin.store.data.cards || {})[parentId];
      if (!parentCard) {
        new Notice("Cannot edit cloze child: parent card not found.");
        return;
      }

      targetCard = parentCard;
    }

    // Use bulk edit modal for basic, cloze, and MCQ (editing parent for cloze-child)
    void openBulkEditModalForCards(this.plugin, [targetCard], async (updatedCards) => {
      if (!updatedCards.length) return;
      
      try {
        const updatedCard = updatedCards[0];
        
        // Update the card in the session if it exists
        if (this.session) {
          // For cloze-child, defer replacing the child until after sync so we keep the correct child record
          if (cardType !== "cloze-child") {
            this.session.queue[this.session.index] = updatedCard;
          }
        }

        // Write the card back to markdown
        const file = this.app.vault.getAbstractFileByPath(updatedCard.sourceNotePath);
        if (!(file instanceof TFile)) throw new Error(`Source note not found: ${updatedCard.sourceNotePath}`);

        const text = await this.app.vault.read(file);
        const lines = text.split(/\r?\n/);

        const { start, end } = findCardBlockRangeById(lines, updatedCard.id);
        const block = buildCardBlockMarkdown(updatedCard.id, updatedCard);
        lines.splice(start, end - start, ...block);

        await this.app.vault.modify(file, lines.join("\n"));

        // Sync the file to update store
        const res = await syncOneFile(this.plugin, file);

        if (res.quarantinedCount > 0) {
          new Notice(`Saved changes to flashcard (but ${res.quarantinedCount} card(s) quarantined).`);
        } else {
          new Notice("Saved changes to flashcard");
        }

        // If we edited a cloze parent, refresh the current child from the store so session stays in sync
        if (this.session && cardType === "cloze-child") {
          const refreshed = (this.plugin.store.data.cards || {})[String(card.id)];
          if (refreshed) this.session.queue[this.session.index] = refreshed;
        }

        this.render();
      } catch (e: unknown) {
        log.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        new Notice(`${BRAND}: edit failed (${msg})`);
      }
    });
  }

  // --- FSRS grading
  async gradeCurrentRating(rating: Rating, meta: Record<string, unknown> | null) {
    const card = this.currentCard();
    if (!card || !this.session) return;

    const id = String(card.id);
    if (this.session.graded[id]) return;

    const now = Date.now();

    const stamp = this.getSessionStamp();

    const store = this.plugin.store;

    const reviewLogLenBefore = Array.isArray(this.plugin.store.data?.reviewLog)
      ? this.plugin.store.data.reviewLog.length
      : 0;

    const analyticsLenBefore = Array.isArray(store.data.analytics?.events)
      ? store.data.analytics.events.length
      : 0;

    const msToAnswer = this.computeMsToAnswer(now, id);

    if (this.isPracticeSession()) {
      this._undo = {
        sessionStamp: stamp,
        id,
        cardType: String(card.type || "unknown"),
        rating,
        at: now,
        meta: meta || null,

        sessionIndex: Number(this.session.index ?? 0),
        showAnswer: !!this.showAnswer,

        storeMutated: false,
        analyticsMutated: true,

        reviewLogLenBefore,
        analyticsLenBefore,

        prevState: null,
      };

      // persist analytics for practice
      try {
        if (typeof store.appendAnalyticsReview === "function") {
          store.appendAnalyticsReview({
            at: now,
            cardId: id,
            cardType: String(card.type || "unknown"),
            result: rating,
            mode: "practice",
            msToAnswer,
            scope: this.session.scope,
            meta: meta || undefined,
          });
          await store.persist();
        }
      } catch (e) {
        log.warn(`failed to persist practice analytics`, e);
      }

      this.session.graded[id] = { rating, at: now, meta: meta || null };
      this.session.stats.done = Object.keys(this.session.graded).length;

      this.showAnswer = true;
      this._timing.startedAt = 0;
      return;
    }

    const st = this.plugin.store.getState(id);
    if (!st) return;

    this._undo = {
      sessionStamp: stamp,
      id,
      cardType: String(card.type || "unknown"),
      rating,
      at: now,
      meta: meta || null,

      sessionIndex: Number(this.session.index ?? 0),
      showAnswer: !!this.showAnswer,

      storeMutated: true,
      analyticsMutated: true,

      reviewLogLenBefore,
      analyticsLenBefore,

      prevState: deepClone(st),
    };

    try {
      const { nextState, prevDue, nextDue, metrics } = gradeFromRating(
        st,
        rating,
        now,
        this.plugin.settings,
      );

      this.plugin.store.upsertState(nextState);
      this.plugin.store.appendReviewLog({
        id,
        at: now,
        result: rating,
        prevDue,
        nextDue,
        meta: meta || null,
      });

      if (typeof store.appendAnalyticsReview === "function") {
        store.appendAnalyticsReview({
          at: now,
          cardId: id,
          cardType: String(card.type || "unknown"),
          result: rating,
          mode: "scheduled",
          msToAnswer,
          prevDue,
          nextDue,
          scope: this.session.scope,
          meta: meta || undefined,
        });
      }

      await this.plugin.store.persist();

      this.session.graded[id] = { rating, at: now, meta: meta || null };
      this.session.stats.done = Object.keys(this.session.graded).length;

      this.showAnswer = true;
      this._timing.startedAt = 0;

      logFsrsIfNeeded({
        id,
        cardType: String(card.type || "unknown"),
        rating,
        metrics,
        nextDue,
        meta: meta || undefined,
      });
    } catch (e) {
      this.clearUndo();
      throw e;
    }
  }

  // NOTE: bury/suspend live in the dropdown; keep these methods on the view.
  async buryCurrentCard() {
    if (this.mode !== "session" || !this.session) return;
    if (this.isPracticeSession()) return;

    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id);
    if (this.session.graded[id]) return;

    const st = this.plugin.store.getState(id);
    if (!st) return;

    const now = Date.now();
    const nextState = { ...st, due: now + MS_DAY };

    this.plugin.store.upsertState(nextState);
    await this.plugin.store.persist();

    this.session.graded[id] = { rating: "again", at: now, meta: { action: "bury" } };
    this.session.stats.done = Object.keys(this.session.graded).length;

    this.showAnswer = false;
    void this.nextCard(true);
  }

  async suspendCurrentCard() {
    if (this.mode !== "session" || !this.session) return;
    if (this.isPracticeSession()) return;

    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id);
    if (this.session.graded[id]) return;

    const st = this.plugin.store.getState(id);
    if (!st) return;

    const now = Date.now();
    const nextState = { ...st, stage: "suspended" as const };

    this.plugin.store.upsertState(nextState);
    await this.plugin.store.persist();

    this.session.graded[id] = { rating: "again", at: now, meta: { action: "suspend" } };
    this.session.stats.done = Object.keys(this.session.graded).length;

    this.showAnswer = false;
    void this.nextCard(true);
  }


  private async answerMcq(choiceIdx: number) {
    const card = this.currentCard();
    if (!card || card.type !== "mcq" || !this.session) return;

    const id = String(card.id);
    if (this.session.graded[id]) return;

    const pass = choiceIdx === card.correctIndex;

    const four = isFourButtonMode(this.plugin);
    const rating: Rating = pass ? (four ? "easy" : "good") : "again";

    const st = this.plugin.store.getState(id);
    if (!st && !this.isPracticeSession()) {
      log.warn(`MCQ: missing state for id=${id}; cannot grade/FSRS`);
      return;
    }

    await this.gradeCurrentRating(rating, {
      mcqChoice: choiceIdx,
      mcqCorrect: card.correctIndex,
      mcqPass: pass,
    });

    this.render();
  }

  private async nextCard(_userInitiated: boolean) {
    if (!this.session) return;

    const card = this.currentCard();
    if (card) {
      const id = String(card.id);
      if (!this.session.graded[id]) {
        await this.gradeCurrentRating("again", { auto: true });
      }
    }

    if (this.session.index < this.session.queue.length - 1) {
      this.session.index += 1;
      this.resetTiming();

      const next = this.currentCard();
      this.showAnswer = !!(next && this.session.graded[String(next.id)]);
      this.render();
      return;
    }

    this.session.index = this.session.queue.length;
    this.showAnswer = true;
    this.resetTiming();
    this.render();
  }

  private prevCard() {
    if (!this.session) return;
    if (this.session.index <= 0) return;

    this.session.index -= 1;
    this.resetTiming();

    const card = this.currentCard();
    this.showAnswer = !!(card && this.session.graded[String(card.id)]);
    this.render();
  }

  private openSession(scope: Scope) {
    try {
      if (typeof this.plugin.store.appendAnalyticsSession === "function") {
        this.plugin.store.appendAnalyticsSession({ at: Date.now(), scope });
      }
    } catch (e) { log.swallow("review-view appendAnalyticsSession", e); }

    this.clearUndo();
    this.resetTiming();

    this.clearTimer();
    this.clearCountdown();
    closeMoreMenuImpl(this);

    this.mode = "session";
    this.session = this.buildSession(scope);

    if (this.session) {
      this.session.queue = (this.session.queue || []).filter((c) => !isIoParentCard(c));
      this.session.stats.total = this.session.queue.length;
      this.session.index = clampInt(
        this.session.index ?? 0,
        0,
        Math.max(0, this.session.queue.length),
      );

      this.session._bcStamp = ++this._sessionStamp;

      initMcqOrderState(this.session);
      initSkipState(this.session);
      this.session.practice = false;
    }

    this.showAnswer = false;
    this.render();
  }

  private backToDecks() {
    this.clearUndo();
    this.resetTiming();

    this.clearTimer();
    this.clearCountdown();
    closeMoreMenuImpl(this);

    this.mode = "deck";
    this.session = null;
    this.showAnswer = false;
    this.render();
  }

  isActiveLeaf(): boolean {
    const ws = this.app.workspace;
    const active = ws?.activeLeaf ?? ws?.getActiveLeaf?.() ?? null;
    return !!active && active === this.leaf;
  }

  private handleKey(ev: KeyboardEvent) {
    if (!this.isActiveLeaf()) return;

    const t = ev.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    )
      return;

    if (this.mode !== "session" || !this.session) return;

    if (ev.key === "Escape" && this._moreOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);
      return;
    }

    const isEnter =
      ev.key === "Enter" || ev.code === "Enter" || ev.code === "NumpadEnter";

    const k = (ev.key || "").toLowerCase();

    if (k === "u") {
      if (this.canUndo()) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);
        void this.undoLastGrade();
      }
      return;
    }

    const card = this.currentCard();

    if (!card) {
      if (isEnter) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);

        if (this.isPracticeSession()) {
          this.backToDecks();
          return;
        }

        if (this.canStartPractice(this.session.scope)) {
          this.startPracticeFromCurrentScope();
          return;
        }
      }
      if (ev.key === "Escape" || ev.key === "q" || ev.key === "Q" || ev.code === "KeyQ") {
        if (ev.metaKey || ev.ctrlKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);
        this.backToDecks();
        return;
      }
      return;
    }

    const id = String(card.id);
    const graded = this.session.graded[id] || null;

    if (ev.key === "Escape" || ev.key === "q" || ev.key === "Q" || ev.code === "KeyQ") {
      if (ev.metaKey || ev.ctrlKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);
      this.backToDecks();
      return;
    }

    if (k === "m") {
      ev.preventDefault();
      ev.stopPropagation();
      const trigger = this.contentEl.querySelector(
        'button[data-sprout-action="reviewer-more-trigger"]',
      );
      if (trigger) {
        trigger.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
      }
      return;
    }

    if (k === "o") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);
      void this.openCurrentCardInNote();
      return;
    }

    if (k === "e") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);
      this.openEditModalForCurrentCard();
      return;
    }

    if (!graded && !this.isPracticeSession() && (k === "b" || k === "s")) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);

      if (k === "b") void this.buryCurrentCard();
      else void this.suspendCurrentCard();

      return;
    }

    const isBackward = ev.key === "ArrowLeft";

    if (isBackward) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);

      if (
        ((card.type === "basic" ||
          card.type === "cloze" ||
          card.type === "cloze-child" ||
          isIoRevealableType(card)) &&
          this.showAnswer)
      ) {
        this.showAnswer = false;
        this.render();
        return;
      }

      this.prevCard();
      return;
    }

    if (isEnter && graded) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMoreMenuImpl(this);
      void this.nextCard(true);
      return;
    }

    if (card.type === "mcq") {
      if (/^[1-9]$/.test(ev.key)) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);

        const displayIdx = Number(ev.key) - 1;
        const opts = card.options || [];
        if (displayIdx < 0 || displayIdx >= opts.length) return;

        const order = getMcqOptionOrder(this.plugin, this.session, card);
        const origIdx = order[displayIdx];
        if (Number.isInteger(origIdx) && origIdx >= 0 && origIdx < opts.length) {
          void this.answerMcq(origIdx);
        }
      }
      return;
    }

    const isRevealable =
      card.type === "basic" ||
      card.type === "cloze" ||
      card.type === "cloze-child" ||
      isIoRevealableType(card);

    if (isRevealable) {
      if (isEnter && !graded) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);

        if (!this.showAnswer) {
          this.showAnswer = true;
          this.render();
          return;
        }

        if (this.showAnswer && this.isPracticeSession()) {
          void this.nextCard(true);
          return;
        }

        if (this.showAnswer && isSkipEnabled(this.plugin)) {
          this.doSkipCurrentCard({
            uiSource: "kbd-enter",
            uiKey: 13,
            uiButtons: isFourButtonMode(this.plugin) ? 4 : 2,
          });
          return;
        }

        return;
      }

      const four = isFourButtonMode(this.plugin);
      const isGradeKey = four
        ? ev.key === "1" || ev.key === "2" || ev.key === "3" || ev.key === "4"
        : ev.key === "1" || ev.key === "2";

      if (isGradeKey) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);

        if (!this.showAnswer) {
          this.showAnswer = true;
          this.render();
          return;
        }

        if (!graded) {
          let rating: Rating;
          if (!four) {
            rating = ev.key === "1" ? "again" : "good";
          } else {
            if (ev.key === "1") rating = "again";
            else if (ev.key === "2") rating = "hard";
            else if (ev.key === "3") rating = "good";
            else rating = "easy";
          }

          void this.gradeCurrentRating(rating, {}).then(() => void this.nextCard(true));
          return;
        }

        void this.nextCard(true);
        return;
      }

      return;
    }
  }

  private async resyncActiveFile() {
    const active = this.plugin._getActiveMarkdownFile() ?? null;
    if (!active) return;

    const res = await syncOneFile(this.plugin, active);
    new Notice(
      `${BRAND}: ${res.newCount} new; ${res.updatedCount} updated; ${res.sameCount} unchanged; ${res.idsInserted} IDs inserted.`,
    );
    if (res.quarantinedCount > 0)
      new ParseErrorModal(this.plugin.app, this.plugin, res.quarantinedIds).open();

    this.plugin.refreshAllViews();
  }

  private extractInfoField(card: CardRecord | null): string | null {
    if (!card) return null;

    const pick = (v: unknown): string | null => {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (Array.isArray(v)) {
        const s = v.filter((x) => typeof x === "string").join("\n").trim();
        return s ? s : null;
      }
      return null;
    };

    const direct =
      pick((card).info) ??
      pick((card).information) ??
      pick((card).i) ??
      pick((card).I);
    if (direct) return direct;

    const fields = (card).fields;
    if (fields && typeof fields === "object") {
      const fromFields =
        pick((fields).info) ??
        pick((fields).information) ??
        pick((fields).i) ??
        pick((fields).I);
      if (fromFields) return fromFields;
    }

    return null;
  }

  private hasInfoField(card: CardRecord): boolean {
    return !!this.extractInfoField(card);
  }

  render() {
    const root = this.contentEl;
    
    // Preserve the study session header when in session mode
    const studySessionHeader = root.querySelector("[data-study-session-header]");
    const headerWillPersist = !!studySessionHeader && this.mode === "session" && !!this.session;
    
    root.empty();

    this._moreOpen = false;
    this._moreWrap = null;
    this._moreMenuEl = null;
    this._moreBtnEl = null;

    root.classList.add("sprout-view-content");
    this.containerEl.addClass("sprout");

    let sessionColumn: HTMLElement | null = null;
    if (this.mode === "session") {
      sessionColumn = document.createElement("div");
      sessionColumn.className = "sprout-study-column flex flex-col min-h-0";
      sessionColumn.style.gap = "10px";
      root.appendChild(sessionColumn);
    }

    // Re-attach the study session header if it was preserved
    if (headerWillPersist && studySessionHeader) {
      (sessionColumn ?? root).appendChild(studySessionHeader);
    }

    // --- Use shared SproutHeader ---
    if (!this._header) {
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyReviewerWidthMode(),
      });
    }

    this._header.install("study");

    // Apply width rules again after mode-specific DOM is present
    this._applyReviewerWidthMode();

    // ---- Browser mode: NO title row (your deck UI already has its own header/badges) ----
    if (this.mode === "deck") {
      this.clearTimer();
      this.clearCountdown();
      closeMoreMenuImpl(this);

      renderDeckMode({
        app: this.app,
        plugin: this.plugin,
        container: root,
        expanded: this.expanded,
        setExpanded: (s) => (this.expanded = s),
        openSession: (scope) => this.openSession(scope),
        resyncActiveFile: () => this.resyncActiveFile(),
        rerender: () => this.render(),
      });

      return;
    }

    // ---- Session mode ----
    if (!this.session) return;

    const activeCard = this.currentCard();
    if (activeCard) this.noteCardPresented(activeCard);

    const infoPresent = activeCard ? this.hasInfoField(activeCard) : false;
    const showInfo =
      !!this.plugin.settings.reviewer.showInfoByDefault || (this.showAnswer && infoPresent);

    const practiceMode = this.isPracticeSession();
    const canStartPractice = !practiceMode && !activeCard && this.canStartPractice(this.session.scope);

    renderSessionMode({
      container: sessionColumn ?? root,

      session: this.session,
      showAnswer: this.showAnswer,
      setShowAnswer: (v: boolean) => (this.showAnswer = v),

      currentCard: () => this.currentCard(),

      backToDecks: () => this.backToDecks(),
      nextCard: (userInitiated: boolean) => this.nextCard(userInitiated),

      gradeCurrentRating: (rating: Rating, meta: Record<string, unknown> | null) => this.gradeCurrentRating(rating, meta),
      answerMcq: (idx: number) => this.answerMcq(idx),

      enableSkipButton: isSkipEnabled(this.plugin),
      skipCurrentCard: (meta?: Record<string, unknown>) => this.doSkipCurrentCard(meta),

      canBurySuspend: !practiceMode && !!activeCard && !this.session.graded[String(activeCard?.id ?? "")],
      buryCurrentCard: () => void this.buryCurrentCard(),
      suspendCurrentCard: () => void this.suspendCurrentCard(),

      canUndo: this.canUndo(),
      undoLast: () => void this.undoLastGrade(),

      practiceMode,
      canStartPractice,
      startPractice: () => this.startPracticeFromCurrentScope(),

      showInfo,
      clearTimer: () => this.clearTimer(),
      clearCountdown: () => this.clearCountdown(),
      getNextDueInScope: (scope: Scope) => this.getNextDueInScope(scope),
      startCountdown: (nextDue: number, lineEl: HTMLElement) => this.startCountdown(nextDue, lineEl),

      renderClozeFront: (text: string, reveal: boolean, targetIndex?: number | null) => renderClozeFront(text, reveal, targetIndex),

      renderMarkdownInto: (containerEl: HTMLElement, md: string, sourcePath: string) =>
        this.renderMarkdownInto(containerEl, md, sourcePath),

      renderImageOcclusionInto: (
        containerEl: HTMLElement,
        card2: CardRecord,
        sourcePath2: string,
        reveal2: boolean,
      ) => this.renderImageOcclusionInto(containerEl, card2, sourcePath2, reveal2),

      randomizeMcqOptions: isMcqOptionRandomisationEnabled(this.plugin),

      fourButtonMode: isFourButtonMode(this.plugin),

      openEditModal: () => this.openEditModalForCurrentCard(),

      applyAOS: this.plugin.settings?.appearance?.enableAnimations ?? true,
      aosDelayMs: this._firstSessionRender ? 100 : 0,

      rerender: () => this.render(),
    });

    queueMicrotask(() =>
      renderTitleMarkdownIfNeeded({
        rootEl: this.contentEl,
        session: this.session!,
        card: this.currentCard()!,
        renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
      }),
    );

    // Only arm timer on first render of session, not on card/reveal changes
    if (this._firstSessionRender) {
      const animationsEnabled = this.plugin.settings?.appearance?.enableAnimations ?? true;
      // Initialize AOS animations for reviewer cards
      if (animationsEnabled) {
        try {
          initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
        } catch (e) { log.swallow("review-view initAOS", e); }
      }
      this._firstSessionRender = false;
      this.armTimer();
    }
  }
}
