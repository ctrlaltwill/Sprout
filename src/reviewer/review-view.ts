// src/reviewer.ts
// NOTE: This is the top-level file, so ui import MUST be "./ui" (not "../ui").

import {
  ItemView,
  Notice,
  type WorkspaceLeaf,
  MarkdownView,
  TFile,
  setIcon,
} from "obsidian";

import { BRAND, VIEW_TYPE_REVIEWER } from "../core/constants";
import { el } from "../core/ui";
import { gradeFromRating } from "../scheduler/scheduler";
import { syncOneFile } from "../sync/sync-engine";
import { ParseErrorModal } from "../modals/parse-error-modal";
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import type SproutPlugin from "../main";

import type { Scope, Session, Rating } from "./types";
import { buildSession, getNextDueInScope } from "./session";
import { formatCountdown } from "./timers";
import { renderClozeFront } from "./question-cloze";
import { renderDeckMode } from "./render-deck";
import { renderSessionMode } from "./render-session";
import { initAOS } from "../core/aos-loader";

import { openSproutImageZoom } from "./zoom";
import { SproutMarkdownHelper } from "./markdown-render";

// split-out helpers
import { getStageCountsAll } from "./stats";
import { isSkipEnabled, initSkipState, skipCurrentCard } from "./skip";
import {
  initMcqOrderState,
  isMcqOptionRandomisationEnabled,
  getMcqOptionOrder,
} from "./question-mcq";
import {
  closeMoreMenu as closeMoreMenuImpl,
  toggleMoreMenu as toggleMoreMenuImpl,
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
import { SproutHeader, type SproutHeaderPage } from "../components/header";

function isFourButtonMode(plugin: SproutPlugin): boolean {
  return !!((plugin.settings?.reviewer as any)?.fourButtonMode);
}

type UndoFrame = {
  sessionStamp: number;

  id: string;
  cardType: string;
  rating: Rating;
  at: number;
  meta: any;

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
  private _sessionStartTime = 0;

  // time-to-answer proxy
  private _timing: { stamp: number; cardId: string; startedAt: number } = {
    stamp: 0,
    cardId: "",
    startedAt: 0,
  };

  _moreOpen = false;
  _moreWrap: HTMLElement | null = null;
  _moreMenuEl: HTMLElement | null = null;
  _moreBtnEl: HTMLButtonElement | null = null;
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
    const hideToggle = containerWidth > 0 ? containerWidth < 1080 : typeof window !== "undefined" && window.innerWidth < 1080;
    if (this._widthToggleActionEl) {
      this._widthToggleActionEl.style.display = hideToggle ? "none" : "";
    }

    if (this.plugin.isWideMode) {
      root.style.setProperty("max-width", "none", "important");
      root.style.setProperty("width", "100%", "important");
      root.style.setProperty("margin-left", "auto", "important");
      root.style.setProperty("margin-right", "auto", "important");
    } else {
      root.style.setProperty("max-width", "1080px", "important");
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

  private noteCardPresented(card: any) {
    if (!this.session) return;

    const stamp = this.getSessionStamp();
    const id = String((card as any)?.id ?? "");
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
    return Number((this.session as any)?._bcStamp ?? 0);
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

    const fromState = u.storeMutated ? deepClone(store.getState(u.id) as any) : null;

    try {
      const needPersist = u.storeMutated || u.analyticsMutated;

      if (u.storeMutated) {
        if (u.prevState) store.upsertState(deepClone(u.prevState));

        if (typeof (store as any).truncateReviewLog === "function") {
          (store as any).truncateReviewLog(u.reviewLogLenBefore);
        } else if (Array.isArray((store as any).data?.reviewLog)) {
          (store as any).data.reviewLog.length = Math.max(0, Math.floor(u.reviewLogLenBefore));
        }
      }

      if (u.analyticsMutated) {
        if (typeof (store as any).truncateAnalyticsEvents === "function") {
          (store as any).truncateAnalyticsEvents(u.analyticsLenBefore);
        } else {
          const a: any = (store as any).data?.analytics;
          if (a && Array.isArray(a.events)) a.events.length = Math.max(0, Math.floor(u.analyticsLenBefore));
        }
      }

      if (needPersist) await store.persist();

      delete (this.session.graded as any)[u.id];
      this.session.stats.done = Object.keys(this.session.graded || {}).length;

      const maxIdx = Math.max(0, Number(this.session.queue?.length ?? 0));
      this.session.index = clampInt(u.sessionIndex, 0, maxIdx);

      // Reset to show question (front) to allow restudying
      this.showAnswer = false;

      const toState = u.storeMutated ? store.getState(u.id) : null;

      logUndoIfNeeded({
        id: u.id,
        cardType: u.cardType,
        ratingUndone: u.rating as any,
        meta: u.meta ?? null,
        storeReverted: u.storeMutated,
        fromState,
        toState,
      });

      this.render();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`${BRAND} UNDO: failed`, e);
      new Notice(`${BRAND}: undo failed. See console.`);
      this.render();
    }
  }

  // -----------------------------
  // Practice session helpers
  // -----------------------------

  private isPracticeSession(): boolean {
    return !!(this.session && (this.session as any).practice);
  }

  private buildPracticeQueue(scope: Scope, excludeIds?: Set<string>): any[] {
    const now = Date.now();

    const cardsObj = (this.plugin.store.data?.cards || {}) as Record<string, any>;
    const cards = Object.values(cardsObj);

    const out: any[] = [];

    for (const c of cards) {
      if (isIoParentCard(c)) continue;

      const id = String((c as any)?.id ?? "");
      if (!id) continue;
      if (excludeIds?.has(id)) continue;

      const st: any = this.plugin.store.getState(id);
      if (!st) continue;

      if (String(st.stage || "") === "suspended") continue;

      const due = Number(st.due ?? 0);
      if (!Number.isFinite(due)) continue;
      if (due <= now) continue;

      const path = String(
        (c as any).sourceNotePath || (c as any).sourcePath || (c as any).location || "",
      );
      if (!path) continue;
      if (!matchesScope(scope, path)) continue;

      out.push(c);
    }

    out.sort((a, b) => {
      const da = Number(
        this.plugin.store.getState(String((a as any).id))?.due ?? Number.POSITIVE_INFINITY,
      );
      const db = Number(
        this.plugin.store.getState(String((b as any).id))?.due ?? Number.POSITIVE_INFINITY,
      );
      if (da !== db) return da - db;
      return String((a as any).id).localeCompare(String((b as any).id));
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

    (s as any).practice = true;
    (s as any)._bcStamp = ++this._sessionStamp;

    this.mode = "session";
    this.session = s;
    this._firstSessionRender = true;
    this._sessionStartTime = Date.now();
    this._firstSessionRender = true;
    this._sessionStartTime = Date.now();

    initMcqOrderState(this.session);
    initSkipState(this.session);

    this.showAnswer = false;
    this.render();
  }

  private skipPracticeCard() {
    if (!this.session) return;
    const card = this.currentCard();
    if (!card) return;

    const id = String((card as any).id ?? "");
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

  private doSkipCurrentCard(meta?: any) {
    if (!this.session) return;

    const card = this.currentCard();
    if (!card) return;

    const id = String((card as any).id ?? "");
    if (!id) return;

    if (this.session.graded[id]) return;

    try {
      const extraMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};

      logFsrsIfNeeded({
        id,
        cardType: String((card as any).type ?? "unknown"),
        rating: "skip" as any,
        meta: {
          action: "skip",
          via: this.isPracticeSession() ? "practice" : "review",
          done: Number(this.session?.stats?.done ?? 0),
          total: Number(this.session?.stats?.total ?? 0),
          ...extraMeta,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Boot Camp: failed to log skip", e);
    }

    if (this.isPracticeSession()) {
      this.skipPracticeCard();
      return;
    }

    void skipCurrentCard(this);
  }

  private stripBurySuspendFromMoreMenuIfPractice() {
    if (!this.isPracticeSession()) return;

    const root = this.contentEl;

    const menu =
      (root.querySelector('[data-sprout-action="more-menu"]') as HTMLElement | null) ||
      (root.querySelector(".sprout-more-menu") as HTMLElement | null) ||
      null;

    const scopeEl = menu || root;

    const buttons = Array.from(scopeEl.querySelectorAll("button")) as HTMLButtonElement[];
    for (const b of buttons) {
      const left = (b.querySelector(".sprout-btn-left") as HTMLElement | null)?.textContent?.trim();
      const txt = (left || b.textContent || "").trim().toLowerCase();
      if (txt === "bury" || txt === "suspend") b.remove();
    }
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
    card: any,
    sourcePath: string,
    reveal: boolean,
  ) {
    await renderImageOcclusionReviewInto({
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
      this.gradeCurrentRating("again", { auto: true }).then(() => void this.nextCard(false));
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

    const id = String((card as any).id || "");
    const path = String((card as any).sourceNotePath || "");
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
      const parentId = String((card as any).parentId || "");
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
    openBulkEditModalForCards(this.plugin, [targetCard], async (updatedCards) => {
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
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        new Notice(`${BRAND}: edit failed (${String(e?.message || e)})`);
      }
    });
  }

  // --- FSRS grading
  async gradeCurrentRating(rating: Rating, meta: any) {
    const card = this.currentCard();
    if (!card || !this.session) return;

    const id = String(card.id);
    if (this.session.graded[id]) return;

    const now = Date.now();

    const stamp = this.getSessionStamp();

    const store = this.plugin.store as any;

    const reviewLogLenBefore = Array.isArray(this.plugin.store.data?.reviewLog)
      ? this.plugin.store.data.reviewLog.length
      : 0;

    const analyticsLenBefore = Array.isArray(store?.data?.analytics?.events)
      ? store.data.analytics.events.length
      : 0;

    const msToAnswer = this.computeMsToAnswer(now, id);

    if (this.isPracticeSession()) {
      this._undo = {
        sessionStamp: stamp,
        id,
        cardType: String((card as any).type || "unknown"),
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
            cardType: String((card as any).type || "unknown"),
            result: rating as any,
            mode: "practice",
            msToAnswer,
            scope: this.session.scope,
            meta: meta || null,
          });
          await store.persist();
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`${BRAND}: failed to persist practice analytics`, e);
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
      cardType: String((card as any).type || "unknown"),
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
        rating as any,
        now,
        this.plugin.settings,
      );

      this.plugin.store.upsertState(nextState);
      this.plugin.store.appendReviewLog({
        id,
        at: now,
        result: rating as any,
        prevDue,
        nextDue,
        meta: meta || null,
      });

      if (typeof store.appendAnalyticsReview === "function") {
        store.appendAnalyticsReview({
          at: now,
          cardId: id,
          cardType: String((card as any).type || "unknown"),
          result: rating as any,
          mode: "scheduled",
          msToAnswer,
          prevDue,
          nextDue,
          scope: this.session.scope,
          meta: meta || null,
        });
      }

      await this.plugin.store.persist();

      this.session.graded[id] = { rating, at: now, meta: meta || null };
      this.session.stats.done = Object.keys(this.session.graded).length;

      this.showAnswer = true;
      this._timing.startedAt = 0;

      logFsrsIfNeeded({
        id,
        cardType: String((card as any).type || "unknown"),
        rating,
        metrics,
        nextDue,
        meta: meta || null,
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

    const id = String((card as any).id);
    if (this.session.graded[id]) return;

    const st = this.plugin.store.getState(id);
    if (!st) return;

    const now = Date.now();
    const nextState = { ...st, due: now + 24 * 60 * 60 * 1000 };

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

    const id = String((card as any).id);
    if (this.session.graded[id]) return;

    const st = this.plugin.store.getState(id);
    if (!st) return;

    const now = Date.now();
    const nextState = { ...st, stage: "suspended" };

    this.plugin.store.upsertState(nextState);
    await this.plugin.store.persist();

    this.session.graded[id] = { rating: "again", at: now, meta: { action: "suspend" } };
    this.session.stats.done = Object.keys(this.session.graded).length;

    this.showAnswer = false;
    void this.nextCard(true);
  }


  private async answerMcq(choiceIdx: number) {
    const card = this.currentCard();
    if (!card || (card as any).type !== "mcq" || !this.session) return;

    const id = String((card as any).id);
    if (this.session.graded[id]) return;

    const pass = choiceIdx === (card as any).correctIndex;

    const four = isFourButtonMode(this.plugin);
    const rating: any = pass ? (four ? "easy" : "good") : "again";

    const st = this.plugin.store.getState(id);
    if (!st && !this.isPracticeSession()) {
      // eslint-disable-next-line no-console
      console.warn(`${BRAND} MCQ: missing state for id=${id}; cannot grade/FSRS`);
      return;
    }

    await this.gradeCurrentRating(rating as any, {
      mcqChoice: choiceIdx,
      mcqCorrect: (card as any).correctIndex,
      mcqPass: pass,
    });

    this.render();
  }

  private async nextCard(_userInitiated: boolean) {
    if (!this.session) return;

    const card = this.currentCard();
    if (card) {
      const id = String((card as any).id);
      if (!this.session.graded[id]) {
        await this.gradeCurrentRating("again", { auto: true });
      }
    }

    if (this.session.index < this.session.queue.length - 1) {
      this.session.index += 1;
      this.resetTiming();

      const next = this.currentCard();
      this.showAnswer = !!(next && this.session.graded[String((next as any).id)]);
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
    this.showAnswer = !!(card && this.session.graded[String((card as any).id)]);
    this.render();
  }

  private openSession(scope: Scope) {
    try {
      if (typeof this.plugin.store.appendAnalyticsSession === "function") {
        this.plugin.store.appendAnalyticsSession({ at: Date.now(), scope });
      }
    } catch {}

    this.clearUndo();
    this.resetTiming();

    this.clearTimer();
    this.clearCountdown();
    closeMoreMenuImpl(this);

    this.mode = "session";
    this.session = this.buildSession(scope);

    if (this.session) {
      this.session.queue = (this.session.queue || []).filter((c: any) => !isIoParentCard(c));
      this.session.stats.total = this.session.queue.length;
      this.session.index = clampInt(
        this.session.index ?? 0,
        0,
        Math.max(0, this.session.queue.length),
      );

      (this.session as any)._bcStamp = ++this._sessionStamp;

      initMcqOrderState(this.session);
      initSkipState(this.session);
      (this.session as any).practice = false;
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
    const ws: any = this.app.workspace as any;
    const active = ws?.activeLeaf ?? ws?.getMostRecentLeaf?.() ?? ws?.getLeaf?.(false) ?? null;
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
        (t as any).isContentEditable)
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
      ev.key === "Enter" || (ev as any).code === "Enter" || (ev as any).code === "NumpadEnter";

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
      if (ev.key === "Escape" || ev.key === "q" || ev.key === "Q" || (ev as any).code === "KeyQ") {
        if (ev.metaKey || ev.ctrlKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);
        this.backToDecks();
        return;
      }
      return;
    }

    const id = String((card as any).id);
    const graded = this.session.graded[id] || null;

    if (ev.key === "Escape" || ev.key === "q" || ev.key === "Q" || (ev as any).code === "KeyQ") {
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
      ) as HTMLButtonElement | null;
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
        (((card as any).type === "basic" ||
          (card as any).type === "cloze" ||
          (card as any).type === "cloze-child" ||
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

    if ((card as any).type === "mcq") {
      if (/^[1-9]$/.test(ev.key)) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenuImpl(this);

        const displayIdx = Number(ev.key) - 1;
        const opts = (card as any).options || [];
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
      (card as any).type === "basic" ||
      (card as any).type === "cloze" ||
      (card as any).type === "cloze-child" ||
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
          let rating: any;
          if (!four) {
            rating = ev.key === "1" ? "again" : "good";
          } else {
            if (ev.key === "1") rating = "again";
            else if (ev.key === "2") rating = "hard";
            else if (ev.key === "3") rating = "good";
            else rating = "easy";
          }

          this.gradeCurrentRating(rating as any, {}).then(() => void this.nextCard(true));
          return;
        }

        void this.nextCard(true);
        return;
      }

      return;
    }
  }

  private async resyncActiveFile() {
    const active = (this.plugin as any)._getActiveMarkdownFile?.() ?? null;
    if (!active) return;

    const res = await syncOneFile(this.plugin, active);
    new Notice(
      `${BRAND}: ${res.newCount} new; ${res.updatedCount} updated; ${res.sameCount} unchanged; ${res.idsInserted} IDs inserted.`,
    );
    if (res.quarantinedCount > 0)
      new ParseErrorModal(this.plugin.app, this.plugin, res.quarantinedIds).open();

    (this.plugin as any)._refreshOpenViews?.();
  }

  private renderHeaderActions() {
    const actionsEl =
      (this.containerEl.querySelector(":scope > .view-header .view-actions") as HTMLElement | null) ??
      (this.containerEl.querySelector(".view-header .view-actions") as HTMLElement | null);

    if (actionsEl) actionsEl.replaceChildren();

    const moreEl = this.addAction("more-vertical", "More options", () => {
      toggleMoreMenuImpl(this);
    }) as HTMLElement;

    this._moreBtnEl = moreEl as any;

    const syncEl = this.addAction("refresh-cw", "Sync Flashcards", () => {
      const anyPlugin = this.plugin as any;
      if (typeof anyPlugin._runSync === "function") void anyPlugin._runSync();
      else if (typeof anyPlugin.syncBank === "function") void anyPlugin.syncBank();
      else void this.resyncActiveFile();
    }) as HTMLElement;

    const widthEl = this.addAction(this._wideIcon(), this._wideLabel(), () => {
      this.plugin.isWideMode = !this.plugin.isWideMode;
      this._applyReviewerWidthMode();
    }) as HTMLElement;

    widthEl.dataset.bcAction = "toggle-browser-width";
    this._widthToggleActionEl = widthEl;

    if (actionsEl) {
      const dir = window.getComputedStyle(actionsEl).flexDirection;
      if (dir === "row-reverse") {
        actionsEl.replaceChildren(moreEl, syncEl, widthEl);
      } else {
        actionsEl.replaceChildren(widthEl, syncEl, moreEl);
      }
    }

    this._applyReviewerWidthMode();
  }

  private extractInfoField(card: any): string | null {
    if (!card) return null;

    const pick = (v: any): string | null => {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (Array.isArray(v)) {
        const s = v.filter((x) => typeof x === "string").join("\n").trim();
        return s ? s : null;
      }
      return null;
    };

    const direct =
      pick((card as any).info) ??
      pick((card as any).information) ??
      pick((card as any).i) ??
      pick((card as any).I);
    if (direct) return direct;

    const fields = (card as any).fields;
    if (fields && typeof fields === "object") {
      const fromFields =
        pick((fields as any).info) ??
        pick((fields as any).information) ??
        pick((fields as any).i) ??
        pick((fields as any).I);
      if (fromFields) return fromFields;
    }

    return null;
  }

  private hasInfoField(card: any): boolean {
    return !!this.extractInfoField(card);
  }

  render() {
    const root = this.contentEl;
    
    // Preserve the study session header when in session mode
    const studySessionHeader = root.querySelector("[data-study-session-header]") as HTMLElement | null;
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
      const leaf = this.leaf ?? this.app.workspace.getLeaf(false);

      this._header = new SproutHeader({
        app: this.app,
        leaf,
        containerEl: this.containerEl,

        getIsWide: () => this.plugin.isWideMode,
        toggleWide: () => {
          this.plugin.isWideMode = !this.plugin.isWideMode;
          this._applyReviewerWidthMode();
        },

        runSync: () => {
          const anyPlugin = this.plugin as any;
          if (typeof anyPlugin._runSync === "function") void anyPlugin._runSync();
          else if (typeof anyPlugin.syncBank === "function") void anyPlugin.syncBank();
          else new Notice("Sync not available (no sync method found).");
        },

        moreItems: [
          {
            label: "Back to decks",
            icon: "arrow-left",
            onActivate: () => {
              this.backToDecks();
            },
          },
        ],
      } as any);
    }

    // Tell header we are on the Study page
    (this._header as any).install?.("study" as SproutHeaderPage);

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

    const infoPresent = this.hasInfoField(activeCard);
    const showInfo =
      !!(this.plugin.settings.reviewer as any).showInfoByDefault || (this.showAnswer && infoPresent);

    const practiceMode = this.isPracticeSession();
    const canStartPractice = !practiceMode && !activeCard && this.canStartPractice(this.session.scope);

    renderSessionMode({
      container: sessionColumn ?? root,

      session: this.session,
      showAnswer: this.showAnswer,
      setShowAnswer: (v) => (this.showAnswer = v),

      currentCard: () => this.currentCard(),

      backToDecks: () => this.backToDecks(),
      nextCard: (userInitiated) => this.nextCard(userInitiated),

      gradeCurrentRating: (rating: Rating, meta: any) => this.gradeCurrentRating(rating, meta),
      answerMcq: (idx: number) => this.answerMcq(idx),

      enableSkipButton: isSkipEnabled(this.plugin),
      skipCurrentCard: (meta?: any) => this.doSkipCurrentCard(meta),

      canBurySuspend: !practiceMode && !!activeCard && !this.session.graded[String((activeCard as any)?.id ?? "")],
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
        card2: any,
        sourcePath2: string,
        reveal2: boolean,
      ) => this.renderImageOcclusionInto(containerEl, card2, sourcePath2, reveal2),

      keybox,
      makePlainButton,
      appendKeyboxRight,

      randomizeMcqOptions: isMcqOptionRandomisationEnabled(this.plugin),

      fourButtonMode: isFourButtonMode(this.plugin),

      openEditModal: () => this.openEditModalForCurrentCard(),

      applyAOS: this.plugin.settings?.appearance?.enableAnimations ?? true,
      aosDelayMs: this._firstSessionRender ? 100 : 0,

      rerender: () => this.render(),
    } as any);

    queueMicrotask(() =>
      renderTitleMarkdownIfNeeded({
        rootEl: this.contentEl,
        session: this.session!,
        card: this.currentCard(),
        renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
      }),
    );

    // Only arm timer on first render of session, not on card/reveal changes
    if (this._firstSessionRender) {
      const animationsEnabled = this.plugin.settings?.appearance?.enableAnimations ?? true;
      // Initialize AOS animations for reviewer cards
      if (animationsEnabled) {
        try {
          initAOS({ duration: 600, easing: "ease-out", once: true, offset: 50 });
        } catch {}
      }
      this._firstSessionRender = false;
      this.armTimer();
    }
  }
}
