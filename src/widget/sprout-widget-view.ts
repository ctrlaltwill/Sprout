/**
 * widget/SproutWidgetView.ts
 * ──────────────────────────
 * The Sprout sidebar widget – an Obsidian `ItemView` that displays a
 * lightweight flashcard review session for the currently-open note.
 *
 * Responsibilities:
 *  - Summary mode: shows card counts, due count, and a "Start Studying" button
 *  - Session mode: presents cards one at a time with grading, undo, bury, suspend
 *  - Keyboard shortcuts (Enter, 1-4, E, M, B, S, U)
 *  - Folder-note "deck" support (treat folder notes as aggregate decks)
 *  - Inline card editing via the bulk-edit modal
 *
 * Renamed from `BootCampWidgetView` to `SproutWidgetView` as part of the
 * Boot Camp → Sprout naming migration.
 */

import { ItemView, TFile, type WorkspaceLeaf, setIcon, Notice } from "obsidian";

import { VIEW_TYPE_WIDGET } from "../core/constants";
import { el } from "../core/ui";
import { shuffleCardsWithParentAwareness } from "../scheduler/scheduler";
import { gradeFromRating } from "../scheduler/scheduler";
import type SproutPlugin from "../main";
import { renderClozeFront } from "../reviewer/question-cloze";
import { SproutMarkdownHelper } from "../reviewer/markdown-render";
import { openSproutImageZoom } from "../reviewer/zoom";
import * as IO from "../imageocclusion/image-occlusion-index";
import { renderImageOcclusionReviewInto } from "../imageocclusion/image-occlusion-review-render";
import { deepClone, clampInt } from "../reviewer/utilities";
import { initAOS, refreshAOS, resetAOS } from "../core/aos-loader";
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import { findCardBlockRangeById, buildCardBlockMarkdown } from "../reviewer/markdown-block";
import { syncOneFile } from "../sync/sync-engine";

import type { Session, UndoFrame } from "./widget-helpers";
import {
  filterReviewableCards,
  toTitleCase,
  isClozeLike,
} from "./widget-helpers";

import {
  makeIconButton,
  makeTextButton,
  applyWidgetActionButtonStyles,
  applyWidgetHoverDarken,
  attachWidgetMoreMenu,
} from "./widget-buttons";

/* ================================================================== */
/*  SproutWidgetView                                                   */
/* ================================================================== */

export class SproutWidgetView extends ItemView {
  plugin: SproutPlugin;
  activeFile: TFile | null = null;

  mode: "summary" | "session" = "summary";
  session: Session | null = null;

  showAnswer = false;
  private _timer: number | null = null;
  private _timing: { cardId: string; startedAt: number } | null = null;
  private _undo: UndoFrame | null = null;
  private _sessionStamp = 0;
  private _moreMenuToggle: (() => void) | null = null;
  private _mdHelper: SproutMarkdownHelper | null = null;

  private _keysBound = false;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
    // Expose instance globally for readingView integration
    (window as any).SproutWidgetView = this;
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

  private async renderMarkdownInto(containerEl: HTMLElement, md: string, sourcePath: string) {
    this.ensureMarkdownHelper();
    if (!this._mdHelper) return;
    await this._mdHelper.renderInto(containerEl, md ?? "", sourcePath ?? "");
  }

  private escapeHtml(s: string): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Process wiki links [[Link]] and LaTeX for widget display.
   * Converts wiki links to clickable links and preserves LaTeX for rendering.
   */
  private processMarkdownFeatures(text: string): string {
    if (!text) return "";
    let result = String(text);

    // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
    result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, display) => {
      const linkText = display || target;
      return `<a href="#" class="internal-link" data-href="${this.escapeHtml(target)}">${this.escapeHtml(linkText)}</a>`;
    });

    // Preserve LaTeX for MathJax
    return result;
  }

  private renderMathInElement(el: HTMLElement) {
    const MathJax = (window as any).MathJax;
    if (MathJax && typeof MathJax.typesetPromise === "function") {
      try {
        MathJax.typesetPromise([el]).catch((err: any) => {
          console.warn("[Sprout Widget] MathJax rendering error:", err);
        });
      } catch (err) {
        console.warn("[Sprout Widget] MathJax rendering error:", err);
      }
    }
  }

  private setupInternalLinkHandlers(el: HTMLElement) {
    const internalLinks = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");
    internalLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const href = link.getAttribute("data-href");
        if (href) {
          this.app.workspace.openLinkText(href, "", true);
        }
      });
    });
  }

  private async renderImageOcclusionInto(
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

  /* ---------------------------------------------------------------- */
  /*  Timer management                                                 */
  /* ---------------------------------------------------------------- */

  private clearTimer() {
    if (this._timer) {
      window.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private armTimer() {
    this.clearTimer();
    if (this.mode !== "session" || !this.session) {
      if (this.mode === "summary" && ev.key === "Enter" && !isCtrl) {
        ev.preventDefault();
        this.startSession();
      }
      return;
    }
    if (!this.plugin.settings.reviewer.autoAdvanceEnabled) return;

    const sec = Number(this.plugin.settings.reviewer.autoAdvanceSeconds);
    if (!Number.isFinite(sec) || sec <= 0) return;

    this._timer = window.setTimeout(async () => {
      this._timer = null;
      await this.nextCard();
    }, sec * 1000);
  }

  /* ---------------------------------------------------------------- */
  /*  Folder-note / deck scope helpers                                 */
  /* ---------------------------------------------------------------- */

  private folderNotesAsDecksEnabled(): boolean {
    const v = (this.plugin.settings as any)?.widget?.treatFolderNotesAsDecks;
    return v !== false; // default ON
  }

  /**
   * Folder note = note whose basename exactly equals its parent folder name.
   * Example: Psychiatry/Psychiatry.md represents the Psychiatry folder "deck".
   */
  private getFolderNoteInfo(file: TFile): { folderPath: string; folderName: string } | null {
    const parent: any = (file as any).parent ?? null;
    const folderName: string | null = parent && typeof parent.name === "string" ? (parent.name as string) : null;
    const folderPath: string | null = parent && typeof parent.path === "string" ? (parent.path as string) : null;

    if (!folderName || !folderPath) return null;

    // "Exact same name as the directory"
    if (file.basename !== folderName) return null;

    // Defensive: avoid odd cases where parent is the vault root with empty path.
    if (!folderPath || folderPath === "/") return null;

    return { folderPath, folderName };
  }

  private isFolderNote(file: TFile | null): boolean {
    if (!file) return false;
    return this.getFolderNoteInfo(file) !== null;
  }

  /* ---------------------------------------------------------------- */
  /*  Card data accessors                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Cards in *this note only* (always available, regardless of folder-deck setting).
   */
  private getCardsInActiveNoteOnly() {
    const f = this.activeFile;
    if (!f) return [];
    return this.plugin.store.getAllCards().filter((c: any) => c.sourceNotePath === f.path);
  }

  /**
   * Returns cards in the active scope based on the setting:
   * - Normal note: cards whose sourceNotePath === active file path
   * - Folder note (setting enabled): cards in all descendant notes under that folder
   * - Folder note (setting disabled): ONLY cards in the folder note file itself
   */
  private getCardsInActiveScope() {
    const f = this.activeFile;
    if (!f) return [];

    const folder = this.getFolderNoteInfo(f);
    const all = this.plugin.store.getAllCards();

    if (!folder) {
      return filterReviewableCards(all.filter((c: any) => c.sourceNotePath === f.path));
    }

    // Folder note
    if (!this.folderNotesAsDecksEnabled()) {
      return filterReviewableCards(all.filter((c: any) => c.sourceNotePath === f.path));
    }

    const prefix = folder.folderPath.endsWith("/") ? folder.folderPath : folder.folderPath + "/";
    return filterReviewableCards(
      all.filter((c: any) => typeof c.sourceNotePath === "string" && c.sourceNotePath.startsWith(prefix)),
    );
  }

  private computeCounts(cards: any[]) {
    const now = Date.now();
    const states = this.plugin.store.data.states || {};
    let total = cards.length,
      nNew = 0,
      nLearn = 0,
      nDue = 0;

    for (const c of cards) {
      const st = states[c.id];
      if (!st) continue;
      if (st.stage === "new") nNew++;
      else if (st.stage === "learning" && st.due <= now) nLearn++;
      else if (st.stage === "review" && st.due <= now) nDue++;
    }
    return { total, new: nNew, learn: nLearn, due: nDue };
  }

  /* ---------------------------------------------------------------- */
  /*  Session builders                                                 */
  /* ---------------------------------------------------------------- */

  private buildSessionForActiveNote(): Session | null {
    const f = this.activeFile;
    if (!f) return null;

    const now = Date.now();
    const cards = this.getCardsInActiveScope();
    const states = this.plugin.store.data.states || {};

    const learnDue = cards.filter(
      (c: any) => states[c.id] && states[c.id].stage === "learning" && states[c.id].due <= now,
    );
    const reviewDue = cards.filter(
      (c: any) => states[c.id] && states[c.id].stage === "review" && states[c.id].due <= now,
    );
    const news = cards.filter((c: any) => states[c.id] && states[c.id].stage === "new");

    const reviewLimit = this.plugin.settings.reviewer.dailyReviewLimit ?? 200;
    const newLimit = this.plugin.settings.reviewer.dailyNewLimit ?? 20;

    const learnSorted = learnDue
      .sort(
        (a: any, b: any) => states[a.id].due - states[b.id].due || String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, reviewLimit);
    const reviewSorted = reviewDue
      .sort(
        (a: any, b: any) => states[a.id].due - states[b.id].due || String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, reviewLimit);
    const newSorted = news.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))).slice(0, newLimit);

    const queue = learnSorted.concat(reviewSorted).concat(newSorted);

    return { scopeName: f.basename, queue, index: 0, graded: {}, stats: { total: queue.length, done: 0 }, mode: "scheduled" };
  }

  private buildPracticeSessionForActiveNote(): Session | null {
    const f = this.activeFile;
    if (!f) return null;

    const cards = this.getCardsInActiveScope();
    const queue = filterReviewableCards(cards).sort((a: any, b: any) => {
      const pathA = String(a?.sourceNotePath ?? "");
      const pathB = String(b?.sourceNotePath ?? "");
      const pathCmp = pathA.localeCompare(pathB);
      if (pathCmp !== 0) return pathCmp;
      const lineA = Number(a?.sourceStartLine ?? 0);
      const lineB = Number(b?.sourceStartLine ?? 0);
      if (lineA !== lineB) return lineA - lineB;
      return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
    });

    return { scopeName: f.basename, queue, index: 0, graded: {}, stats: { total: queue.length, done: 0 }, mode: "practice" };
  }

  /* ---------------------------------------------------------------- */
  /*  Session navigation                                               */
  /* ---------------------------------------------------------------- */

  private currentCard() {
    if (!this.session) return null;
    return this.session.queue[this.session.index] || null;
  }

  private computeMsToAnswer(now: number, id: string) {
    if (!this._timing) return undefined;
    if (this._timing.cardId !== id) return undefined;
    if (!this._timing.startedAt) return undefined;

    const raw = now - this._timing.startedAt;
    if (!Number.isFinite(raw) || raw <= 0) return undefined;

    // Hard cap: prevent pathological overcount if user walks away.
    return Math.max(0, Math.min(raw, 5 * 60 * 1000));
  }

  /* ---------------------------------------------------------------- */
  /*  Grading, undo, bury, suspend                                     */
  /* ---------------------------------------------------------------- */

  private async gradeCurrentRating(rating: "again" | "hard" | "good" | "easy", meta: any) {
    const card = this.currentCard();
    if (!card || !this.session) return;
    if (this.session.mode === "practice") return;

    const id = String(card.id);
    const ioLike = card.type === "io" || card.type === "io-child";
    if (this.session.graded[id]) return;

    const now = Date.now();
    const store = this.plugin.store as any;
    const reviewLogLenBefore = Array.isArray(this.plugin.store.data?.reviewLog)
      ? this.plugin.store.data.reviewLog.length
      : 0;
    const analyticsLenBefore = Array.isArray(store?.data?.analytics?.events)
      ? store.data.analytics.events.length
      : 0;

    const st = this.plugin.store.getState(id);
    if (!st) return;

    // Compute time-to-answer before grading
    const msToAnswer = this.computeMsToAnswer(now, id);

    this._undo = {
      sessionStamp: this._sessionStamp,
      id,
      cardType: String(card.type || "unknown"),
      rating,
      at: now,
      meta: meta || null,
      sessionIndex: Number(this.session.index ?? 0),
      showAnswer: !!this.showAnswer,
      reviewLogLenBefore,
      analyticsLenBefore,
      prevState: deepClone(st),
    };

    const { nextState, prevDue, nextDue } = gradeFromRating(st, rating, now, this.plugin.settings);

    this.plugin.store.upsertState(nextState);
    this.plugin.store.appendReviewLog({ id, at: now, result: rating, prevDue, nextDue, meta: meta || null });

    // Append analytics review with timing
    if (typeof this.plugin.store.appendAnalyticsReview === "function") {
      this.plugin.store.appendAnalyticsReview({
        at: now,
        cardId: id,
        cardType: String(card.type || "unknown"),
        result: rating,
        mode: "scheduled",
        msToAnswer,
        prevDue,
        nextDue,
      });
    }

    await this.plugin.store.persist();

    this.session.graded[id] = { rating, at: now, meta: meta || null };
    this.session.stats.done = Object.keys(this.session.graded).length;
    this.showAnswer = true;
  }

  private canUndo(): boolean {
    if (this.mode !== "session" || !this.session) return false;
    if (this.session.mode === "practice") return false;
    const u = this._undo;
    if (!u) return false;
    if (u.sessionStamp !== this._sessionStamp) return false;
    return !!this.session.graded?.[u.id];
  }

  private async undoLastGrade(): Promise<void> {
    const key = ev.key.toLowerCase();
    const isCtrl = ev.ctrlKey || ev.metaKey;
    if (this.mode === "summary") {
      if (ev.key === "Enter" && !isCtrl) {
        ev.preventDefault();
        const cards = this.getCardsInActiveScope();
        if (!cards.length) return;
        const queueCount = this.buildSessionForActiveNote()?.queue?.length ?? 0;
        if (queueCount > 0) this.startSession();
        else this.startPracticeSession();
      }
      return;
    }

    if (this.mode !== "session" || !this.session) return;
    const u = this._undo;
    if (!u) return;
    if (u.sessionStamp !== this._sessionStamp) {
      this._undo = null;
      this.render();
      return;
    }
    if (!this.session.graded?.[u.id]) {
      this._undo = null;
      this.render();
      return;
    }

    this._undo = null;
    const store = this.plugin.store as any;

    try {
      if (u.prevState) store.upsertState(deepClone(u.prevState));

      if (typeof store.truncateReviewLog === "function") {
        store.truncateReviewLog(u.reviewLogLenBefore);
      } else if (Array.isArray(store.data?.reviewLog)) {
        store.data.reviewLog.length = Math.max(0, Math.floor(u.reviewLogLenBefore));
      }

      if (typeof store.truncateAnalyticsEvents === "function") {
        store.truncateAnalyticsEvents(u.analyticsLenBefore);
      } else {
        const a: any = store.data?.analytics;
        if (a && Array.isArray(a.events)) a.events.length = Math.max(0, Math.floor(u.analyticsLenBefore));
      }

      await store.persist();

      delete (this.session.graded as any)[u.id];
      this.session.stats.done = Object.keys(this.session.graded || {}).length;

      const maxIdx = Math.max(0, Number(this.session.queue?.length ?? 0));
      this.session.index = clampInt(u.sessionIndex, 0, maxIdx);
      this.showAnswer = false;

      this.render();
    } catch (e) {
      new Notice("Undo failed.");
      this.render();
    }
  }

  private async buryCurrentCard() {
    if (this.mode !== "session" || !this.session) return;
    if (this.session.mode === "practice") return;
    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id);
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
    await this.nextCard();
  }

  private async suspendCurrentCard() {
    if (this.mode !== "session" || !this.session) return;
    if (this.session.mode === "practice") return;
    const card = this.currentCard();
    if (!card) return;

    const id = String(card.id);
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
    await this.nextCard();
  }

  private async answerMcq(choiceIdx: number) {
    const card = this.currentCard();
    if (!card || card.type !== "mcq" || !this.session) return;

    const id = String(card.id);
    if (this.session.graded[id]) return;

    const pass = choiceIdx === card.correctIndex;

    if (this.session.mode === "practice") {
      this.session.graded[id] = {
        rating: pass ? "good" : "again",
        at: Date.now(),
        meta: { mcqChoice: choiceIdx, mcqCorrect: card.correctIndex, practice: true },
      };
      this.session.stats.done = Object.keys(this.session.graded).length;
      this.showAnswer = true;
      this.render();
      return;
    }

    // Keep existing behavior: MCQ still maps to Good/Again internally.
    await this.gradeCurrentRating(pass ? "good" : "again", { mcqChoice: choiceIdx, mcqCorrect: card.correctIndex });
    this.render();
  }

  private async nextCard() {
    if (!this.session) return;

    const card = this.currentCard();
    if (this.session.mode === "practice") {
      if (card) {
        const id = String(card.id);
        if (!this.session.graded[id]) {
          this.session.graded[id] = { rating: "good", at: Date.now(), meta: { practice: true, auto: true } };
          this.session.stats.done = Object.keys(this.session.graded).length;
        }
      }

      if (this.session.index < this.session.queue.length - 1) {
        this.session.index += 1;
        this.showAnswer = false;
        this.render();
        return;
      }

      this.session.index = this.session.queue.length;
      this.showAnswer = true;
      this.render();
      return;
    }

    if (card) {
      const id = String(card.id);
      if (!this.session.graded[id]) {
        // Auto-grade unanswered as AGAIN
        await this.gradeCurrentRating("again", { auto: true, via: "next" });
      }
    }

    if (this.session.index < this.session.queue.length - 1) {
      this.session.index += 1;
      const next = this.currentCard();
      this.showAnswer = !!(next && this.session.graded[String(next.id)]);
      this.render();
      return;
    }

    this.session.index = this.session.queue.length;
    this.showAnswer = true;
    this.render();
  }

  /* ---------------------------------------------------------------- */
  /*  Session lifecycle                                                */
  /* ---------------------------------------------------------------- */

  private startSession() {
    this.clearTimer();
    this.session = this.buildSessionForActiveNote();
    this.mode = "session";
    this.showAnswer = false;
    this._undo = null;
    this._sessionStamp = Date.now();
    this.render();
  }

  private startPracticeSession() {
    this.clearTimer();
    this.session = this.buildPracticeSessionForActiveNote();
    this.mode = "session";
    this.showAnswer = false;
    this._undo = null;
    this._sessionStamp = Date.now();
    this.render();
  }

  private backToSummary() {
    this.clearTimer();
    this.mode = "summary";
    this.session = null;
    this.showAnswer = false;
    this._undo = null;
    this._moreMenuToggle = null;
    this.render();
  }

  /* ---------------------------------------------------------------- */
  /*  Keyboard handler                                                 */
  /* ---------------------------------------------------------------- */

  private handleKey(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t as any).isContentEditable)
    )
      return;

    const key = ev.key.toLowerCase();
    const isCtrl = ev.ctrlKey || ev.metaKey;

    if (this.mode === "summary") {
      if (ev.key === "Enter" && !isCtrl) {
        ev.preventDefault();
        const cards = this.getCardsInActiveScope();
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

    // Handle Edit (E)
    if (key === "e" && !isCtrl) {
      ev.preventDefault();
      this.openEditModalForCurrentCard();
      return;
    }

    // Handle More menu (M)
    if (key === "m" && !isCtrl) {
      ev.preventDefault();
      this._moreMenuToggle?.();
      return;
    }

    // Handle Bury/Suspend/Undo (B/S/U)
    if (key === "b" && !isCtrl) {
      ev.preventDefault();
      if (isPractice) return;
      void this.buryCurrentCard();
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

    // Handle Reveal/Enter
    if (ev.key === "Enter" || ev.key === " " || (ev as any).code === "Space" || ev.key === "ArrowRight") {
      ev.preventDefault();
      if (card.type === "basic" || isClozeLike(card) || ioLike) {
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

    // Handle Grading: 1, 2, 3, 4
    if (ev.key === "1" || ev.key === "2" || ev.key === "3" || ev.key === "4") {
      ev.preventDefault();
      if (isPractice) return;

      // Only grade when answer is visible for basic/cloze, consistent with reviewer.
      if (card.type === "basic" || isClozeLike(card) || ioLike) {
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
            this.gradeCurrentRating(rating, {}).then(() => void this.nextCard());
          }
          return;
        }

        void this.nextCard();
        return;
      }

      // For MCQ/non-basic types: just advance
      void this.nextCard();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Inline card editing                                              */
  /* ---------------------------------------------------------------- */

  private openEditModalForCurrentCard() {
    const card = this.currentCard();
    if (!card || !this.session) return;

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
        new Notice(`Error saving card: ${e.message || String(e)}`);
      }
    });
  }             

  /* ---------------------------------------------------------------- */
  /*  Render: Summary mode                                             */
  /* ---------------------------------------------------------------- */

  private renderSummary(root: HTMLElement) {
    const wrap = el("div", "bc bg-background");
    wrap.classList.add("sprout-widget", "sprout");

    const f = this.activeFile;
    const noteName = f ? f.basename : "No note open";

    const cards = f ? this.getCardsInActiveScope() : [];
    const counts = this.computeCounts(cards);

    // Header: study title with open button
    const header = el("div", "bc flex items-center justify-between px-4 py-3 gap-2");
    header.style.setProperty("border", "none", "important");
    header.style.setProperty("border-radius", "0", "important");
    header.style.setProperty("margin", "0 20px", "important");
    header.style.setProperty("padding", "15px 0 10px 0", "important");

    // Create title (not a button)
    const isFolder = this.isFolderNote(f);
    const titleText = noteName.replace(/\.md$/, ""); // Remove .md extension
    const titleCased = toTitleCase(titleText);
    const studyTitle = f ? `Study ${titleCased} ${isFolder ? "Folder" : "Note"}` : "No Note Open";

    const summaryLabelWrap = el("div", "bc flex flex-col items-start");
    const summaryScope = `${titleCased} ${isFolder ? "Folder" : "Note"}`;
    const summaryTitle = el("div", "bc text-xs", `Study ${summaryScope}`);
    summaryTitle.style.setProperty("color", "var(--foreground)", "important");
    summaryTitle.style.setProperty("font-weight", "600", "important");
    summaryLabelWrap.appendChild(summaryTitle);

    const remainingCount = counts.total;
    const remainingLabel = `${remainingCount} Flashcard${remainingCount === 1 ? "" : "s"}`;
    const remainingLine = el("div", "bc text-xs", remainingLabel);
    remainingLine.style.setProperty("color", "var(--foreground)", "important");
    remainingLine.style.setProperty("font-weight", "400", "important");
    remainingLine.style.setProperty("margin-top", "3px", "important");
    summaryLabelWrap.appendChild(remainingLine);

    header.appendChild(summaryLabelWrap);

    wrap.appendChild(header);

    if (!f) {
      const body = el("div", "bc px-4 py-6 text-center");
      const msg = el("div", "bc text-muted-foreground text-sm", "Open a note to see flashcards.");
      body.appendChild(msg);
      wrap.appendChild(body);
      root.appendChild(wrap);
      return;
    }

    // cards + counts already computed above

    if (!cards.length) {
      const body = el("div", "bc px-4 py-6");
      body.style.setProperty("border-radius", "0", "important");
      body.style.setProperty("margin", "0 10px", "important");
      body.style.setProperty("padding", "15px 5px", "important");
      body.style.setProperty("text-align", "center", "important");
      const isFolder = this.isFolderNote(f);
      const folderDecksEnabled = this.folderNotesAsDecksEnabled();

      let msg = "No flashcards found in this note.";
      if (isFolder && folderDecksEnabled) {
        msg = "No flashcards found in this note or folder.";
      } else if (isFolder && !folderDecksEnabled) {
        msg = "No flashcards found. Enable 'Treat folder notes as decks' in settings.";
      }

      const msgEl = el("div", "bc text-muted-foreground mt-3 text-sm", msg);
      body.appendChild(msgEl);
      wrap.appendChild(body);
      root.appendChild(wrap);
      return;
    }

    // Teaser card: summary + next up preview
    const teaser = el("div", "bc card px-4 py-4 space-y-3");
    teaser.style.setProperty("margin", "10px auto 20px", "important");
    teaser.style.setProperty("gap", "0", "important");
    teaser.style.setProperty("border-radius", "var(--input-radius)", "important");
    teaser.style.setProperty("border", "var(--border-width) solid var(--background-modifier-border)", "important");
    teaser.style.setProperty("padding", "20px", "important");
    teaser.style.setProperty("max-width", "90%", "important");
    teaser.style.setProperty("box-shadow", "none", "important");

    const teaserTitle = el("div", "bc text-xs font-semibold", `${titleCased} ${isFolder ? "Folder" : "Note"}`);
    teaserTitle.style.setProperty("color", "var(--foreground)", "important");
    teaserTitle.style.setProperty("font-size", "11px", "important");
    teaserTitle.style.setProperty("margin-bottom", "0", "important");
    teaser.appendChild(teaserTitle);

    const previewSession = this.buildSessionForActiveNote();
    const queueCount = previewSession?.queue?.length ?? 0;
    const events = this.plugin.store.getAnalyticsEvents?.() ?? [];
    const nowMs = Date.now();
    const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    let timeTotalMs = 0;
    let timeCount = 0;
    for (const ev of events) {
      if (!ev || (ev as any).kind !== "review") continue;
      const at = Number((ev as any).at);
      if (!Number.isFinite(at) || at < weekAgo) continue;
      const ms = Number((ev as any).msToAnswer);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      timeTotalMs += ms;
      timeCount += 1;
    }
    const avgMs = timeCount > 0 ? timeTotalMs / timeCount : 60_000;
    const roundedAvgMs = Math.ceil(avgMs / 10_000) * 10_000;
    const estTotalMs = queueCount * roundedAvgMs;
    const estMinutes = queueCount > 0 ? Math.max(1, Math.round(estTotalMs / 60_000)) : 0;
    const dueLabel = queueCount > 0 ? `${queueCount} Cards Due` : "No Cards Due";
    const countsLine = el("div", "bc text-xs", `${dueLabel}  •  ${counts.total} Cards Total`);
    countsLine.style.setProperty("color", "var(--foreground)", "important");
    countsLine.style.setProperty("opacity", "0.7", "important");
    countsLine.style.setProperty("margin-top", "10.5px", "important");
    teaser.appendChild(countsLine);

    if (queueCount > 0) {
      const timeLine = el("div", "bc text-xs", `Estimated Time: ${estMinutes} min`);
      timeLine.style.setProperty("color", "var(--foreground)", "important");
      timeLine.style.setProperty("opacity", "0.7", "important");
      teaser.appendChild(timeLine);
    } else {
      const practiceLine = el(
        "div",
        "bc text-xs",
        "Would you like to start a practice session? This won't count towards card scheduling and you cannot bury cards or undo answers in this mode.",
      );
      practiceLine.style.setProperty("color", "var(--foreground)", "important");
      practiceLine.style.setProperty("opacity", "0.7", "important");
      teaser.appendChild(practiceLine);
    }

    wrap.appendChild(teaser);

    // Footer: Study button
    const footer = el("div", "bc px-4 py-3 flex gap-2");
    footer.style.setProperty("border", "none", "important");
    footer.style.setProperty("border-radius", "0", "important");
    footer.style.setProperty("max-width", "90%", "important");
    footer.style.setProperty("margin", "10px auto", "important");
    footer.style.setProperty("padding", "0 0 15px 0", "important");
    const studyLabel = queueCount > 0 ? "Start Studying" : "Start A Practice Session";
    const studyBtn = makeTextButton({
      label: studyLabel,
      className: "bc btn-outline w-full text-xs flex items-center justify-center gap-2",
      onClick: () => (queueCount > 0 ? this.startSession() : this.startPracticeSession()),
    });
    applyWidgetActionButtonStyles(studyBtn);

    const studyKbd = document.createElement("kbd");
    studyKbd.className = "bc kbd ml-2 text-xs";
    studyKbd.textContent = "↵";
    studyBtn.appendChild(studyKbd);

    footer.appendChild(studyBtn);
    wrap.appendChild(footer);

    root.appendChild(wrap);
  }

  /* ---------------------------------------------------------------- */
  /*  Render: Session mode                                             */
  /* ---------------------------------------------------------------- */

/**
 * Render a flashcard study session for the current note.
 *
 * The session UI consists of:
 * - Header: Back button + scope + progress
 * - Body: Card content + progress bar
 * - Footer: Controls (Reveal button, Grading buttons row, Edit and More menu buttons row)
 *
 * The Grading buttons row is a 2x2 grid layout for Again, Hard, Good, Easy.
 * The Edit and More menu buttons row is a flex row with Edit and More buttons.
 *
 * This function is called when the user clicks the "Study" button in the summary view.
 */
  private renderSession(root: HTMLElement) {
    const wrap = el("div", "bc bg-background");
    wrap.classList.add("sprout-widget", "sprout");

    // Header: Back button + scope + progress
    const header = el("div", "bc flex items-center justify-between px-4 py-3 gap-2");
    header.style.setProperty("border", "none", "important");
    header.style.setProperty("border-radius", "0", "important");
    header.style.setProperty("margin", "0 20px", "important");
    header.style.setProperty("padding", "15px 0 10px 0", "important");
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "bc btn-outline sprout-widget-back-btn";
    setIcon(backBtn, "arrow-left");
    applyWidgetHoverDarken(backBtn);

    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.backToSummary();
    });
    const studyingWrap = el("div", "bc flex flex-col items-start");
    const studyingScope = `${this.session?.scopeName || "Note"} ${this.isFolderNote(this.activeFile) ? "Folder" : "Note"}`;
    const studyingTitle = el("div", "bc text-xs", `Studying ${studyingScope}`);
    studyingTitle.style.setProperty("color", "var(--foreground)", "important");
    studyingTitle.style.setProperty("font-weight", "600", "important");
    const remainingCount = Math.max(0, (this.session?.stats.total || 0) - (this.session?.stats.done || 0));
    const remainingLabel = `${remainingCount} Card${remainingCount === 1 ? "" : "s"} Remaining`;
    const remainingLine = el("div", "bc text-xs", remainingLabel);
    remainingLine.style.setProperty("color", "var(--foreground)", "important");
    remainingLine.style.setProperty("font-weight", "400", "important");
    remainingLine.style.setProperty("margin-top", "3px", "important");
    studyingWrap.appendChild(studyingTitle);
    studyingWrap.appendChild(remainingLine);
    studyingWrap.style.setProperty("margin-right", "auto", "important");
    header.appendChild(studyingWrap);
    header.appendChild(backBtn);
    wrap.appendChild(header);

    const card = this.currentCard();
    if (!card) {
      const body = el("div", "bc px-4 py-6 text-center space-y-2");
      body.appendChild(el("div", "bc text-lg font-semibold text-foreground", "Session Complete!"));
      body.appendChild(
        el(
          "div",
          "bc text-sm text-muted-foreground",
          `Reviewed: ${this.session?.stats?.done || 0}/${this.session?.stats?.total || 0}`,
        ),
      );
      wrap.appendChild(body);
      root.appendChild(wrap);
      this.clearTimer();
      return;
    }

    const id = String(card.id);
    const ioLike = card.type === "io" || card.type === "io-child";

    // Track timing for this card
    if (!this._timing || this._timing.cardId !== id) {
      this._timing = { cardId: id, startedAt: Date.now() };
    }

    const graded = this.session?.graded[id] || null;

    // Body: card content
    const body = el("div", "bc card px-4 py-4 flex-1 overflow-y-auto");
    body.style.setProperty("margin", "10px auto 20px auto", "important");
    body.style.setProperty("gap", "0", "important");
    body.style.setProperty("border-radius", "var(--input-radius)", "important");
    body.style.setProperty("border", "var(--border-width) solid var(--background-modifier-border)", "important");
    body.style.setProperty("padding", "20px 20px 20px 20px", "important");
    body.style.setProperty("max-width", "90%", "important");
    body.style.setProperty("box-shadow", "none", "important");

    const applySectionStyles = (el: HTMLElement) => {
      el.style.setProperty("padding", "6px 0", "important");
      el.style.setProperty("margin", "0", "important");
    };

    const makeDivider = () => {
      const hr = el("div", "bc");
      hr.style.setProperty("border-top", "1px solid var(--foreground)", "important");
      hr.style.setProperty("opacity", "0.3", "important");
      hr.style.setProperty("margin", "6px 0", "important");
      return hr;
    };

    // Card title (not uppercase, smaller) - no child numbers
    let cardTitle =
      card.title ||
      (card.type === "mcq" ? "MCQ" : isClozeLike(card) ? "Cloze" : card.type === "io" ? "Image" : "Basic");
    // Remove bullet + child index like "• c2" anywhere in the title
    cardTitle = cardTitle.replace(/\s*[•·-]\s*c\d+\b/gi, "").trim();
    const titleEl = el("div", "bc text-xs font-semibold");
    titleEl.innerHTML = this.processMarkdownFeatures(cardTitle);
    titleEl.style.setProperty("color", "var(--foreground)", "important");
    titleEl.style.setProperty("font-size", "11px", "important");
    titleEl.style.setProperty("margin-bottom", "0", "important");
    titleEl.style.setProperty("line-height", "1.75", "important");
    applySectionStyles(titleEl);
    body.appendChild(titleEl);

    const infoText = String((card as any)?.info ?? "").trim();

    if (card.type === "basic") {
      const qEl = el("div", "bc");
      const qText = card.q || "";
      // Use renderMarkdownInto if there's LaTeX or wiki links
      if (qText.includes('$') || qText.includes('[[')) {
        const qContainer = document.createElement("div");
        qContainer.className = "bc whitespace-pre-wrap break-words";
        const sourcePath = String(card.sourceNotePath || this.activeFile?.path || "");
        void this.renderMarkdownInto(qContainer, qText, sourcePath);
        qEl.appendChild(qContainer);
      } else {
        const qP = document.createElement("p");
        qP.className = "bc whitespace-pre-wrap break-words";
        qP.innerHTML = this.processMarkdownFeatures(qText.replace(/\n/g, "<br>"));
        qEl.appendChild(qP);
      }
      qEl.style.lineHeight = "1.75";
      qEl.style.fontSize = "11px";
      qEl.style.setProperty("color", "var(--foreground)", "important");
      applySectionStyles(qEl);
      body.appendChild(qEl);
      if (this.showAnswer || graded) {
        body.appendChild(makeDivider());
        const aEl = el("div", "bc");
        const aText = card.a || "";
        // Use renderMarkdownInto if there's LaTeX or wiki links
        if (aText.includes('$') || aText.includes('[[')) {
          const aContainer = document.createElement("div");
          aContainer.className = "bc whitespace-pre-wrap break-words";
          const sourcePath = String(card.sourceNotePath || this.activeFile?.path || "");
          void this.renderMarkdownInto(aContainer, aText, sourcePath);
          aEl.appendChild(aContainer);
        } else {
          const aP = document.createElement("p");
          aP.className = "bc whitespace-pre-wrap break-words";
          aP.innerHTML = this.processMarkdownFeatures(aText.replace(/\n/g, "<br>"));
          aEl.appendChild(aP);
        }
        aEl.style.lineHeight = "1.75";
        aEl.style.fontSize = "11px";
        aEl.style.setProperty("color", "var(--foreground)", "important");
        applySectionStyles(aEl);
        body.appendChild(aEl);

        if (infoText) {
          const infoEl = el("div", "bc");
          const infoP = document.createElement("p");
          infoP.className = "bc whitespace-pre-wrap break-words";
          infoP.innerHTML = this.processMarkdownFeatures(infoText.replace(/\n/g, "<br>"));
          infoEl.appendChild(infoP);
          infoEl.style.lineHeight = "1.75";
          infoEl.style.fontSize = "11px";
          infoEl.style.setProperty("color", "var(--foreground)", "important");
          infoEl.style.setProperty("opacity", "0.6", "important");
          applySectionStyles(infoEl);
          body.appendChild(infoEl);
        }
      }
    } else if (isClozeLike(card)) {
      const text = card.clozeText || "";
      const reveal = this.showAnswer || !!graded;
      const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : undefined;
      
      // If cloze contains LaTeX or wiki links, use renderMarkdownInto
      if (text.includes('$') || text.includes('[[')) {
        const clozeEl = el("div", "bc sprout-widget-cloze");
        clozeEl.style.lineHeight = "1.75";
        clozeEl.style.fontSize = "11px";
        clozeEl.style.setProperty("color", "var(--foreground)", "important");
        clozeEl.style.setProperty("width", "100%", "important");
        applySectionStyles(clozeEl);
        
        const sourcePath = String(card.sourceNotePath || this.activeFile?.path || "");
        // Convert cloze syntax to reveal format for markdown rendering
        let processedText = text;
        if (reveal) {
          // Show answers: wrap revealed parts in bold
          processedText = text.replace(/\{\{c(\d+)::([^}]+)\}\}/g, (match, num, content) => {
            const idx = Number(num);
            const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;
            return isTarget ? `**${content}**` : content;
          });
        } else {
          // Hide answers: replace with blanks
          processedText = text.replace(/\{\{c(\d+)::([^}]+)\}\}/g, (match, num, content) => {
            const idx = Number(num);
            const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;
            return isTarget ? `______` : content;
          });
        }
        
        void this.renderMarkdownInto(clozeEl, processedText, sourcePath);
        body.appendChild(clozeEl);
      } else {
        // No LaTeX/links - use standard cloze rendering
        const clozeEl = renderClozeFront(text, reveal, targetIndex);
        clozeEl.className = "bc sprout-widget-cloze";
        clozeEl.style.lineHeight = "1.75";
        clozeEl.style.fontSize = "11px";
        clozeEl.style.setProperty("color", "var(--foreground)", "important");
        clozeEl.style.setProperty("width", "100%", "important");
        applySectionStyles(clozeEl);
        body.appendChild(clozeEl);
      }
      if (reveal && infoText) {
        body.appendChild(makeDivider());
        const infoEl = el("div", "bc");
        const infoP = document.createElement("p");
        infoP.className = "bc whitespace-pre-wrap break-words";
        infoP.style.setProperty("margin", "0", "important");
        infoP.style.setProperty("margin-block", "0", "important");
        infoP.innerHTML = this.processMarkdownFeatures(infoText.replace(/\n/g, "<br>"));
        infoEl.appendChild(infoP);
        infoEl.style.lineHeight = "1.75";
        infoEl.style.fontSize = "11px";
        infoEl.style.setProperty("color", "var(--foreground)", "important");
        infoEl.style.setProperty("opacity", "0.6", "important");
        applySectionStyles(infoEl);
        body.appendChild(infoEl);
      }
    } else if (card.type === "mcq") {
      const stemEl = el("div", "bc");
      stemEl.innerHTML = this.processMarkdownFeatures(card.stem || "");
      stemEl.style.lineHeight = "1.75";
      stemEl.style.fontSize = "11px";
      stemEl.style.setProperty("color", "var(--foreground)", "important");
      applySectionStyles(stemEl);
      body.appendChild(stemEl);
      let opts = card.options || [];
      const chosen = graded?.meta?.mcqChoice;

      // Randomise MCQ options if setting enabled
      const randomize = !!(this.plugin.settings.reviewer?.randomizeMcqOptions);
      let order = opts.map((_, i) => i);
      if (randomize) {
        // Fisher-Yates shuffle
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        opts = order.map(i => opts[i]);
      }

      const optsContainer = el("div", "bc flex flex-col gap-2");
      optsContainer.style.setProperty("padding", "6px 0", "important");
      optsContainer.style.setProperty("margin", "0", "important");
      opts.forEach((opt: any, idx: number) => {
        const text = typeof opt === "string" ? opt : (opt && typeof opt.text === "string" ? opt.text : "");
        const d = el("div", "bc px-3 py-2 rounded border border-border cursor-pointer hover:bg-secondary");
        d.style.lineHeight = "1.75";
        d.style.fontSize = "11px";
        d.style.setProperty("color", "var(--foreground)", "important");
        d.style.setProperty("margin-bottom", "8px", "important");
        // Add kbd for number
        const left = el("span", "bc inline-flex items-center gap-2 min-w-0");
        const key = el("kbd", "bc kbd");
        key.textContent = String(idx + 1);
        left.appendChild(key);
        // Render option text as paragraphs/lines
        const textEl = el("span", "bc min-w-0 whitespace-pre-wrap break-words");
        textEl.style.lineHeight = "1.75";
        textEl.style.display = "block";
        if (text && text.includes("\n")) {
          text.split(/\n+/).forEach(line => {
            const p = document.createElement("div");
            p.innerHTML = this.processMarkdownFeatures(line);
            p.style.lineHeight = "1.75";
            p.style.marginBottom = "2px";
            textEl.appendChild(p);
          });
        } else {
          textEl.innerHTML = this.processMarkdownFeatures(text);
        }
        left.appendChild(textEl);
        d.appendChild(left);
        if (!graded) d.addEventListener("click", () => this.answerMcq(idx));
        if (graded) {
          // Map idx back to original for correctIndex
          const origIdx = randomize ? order[idx] : idx;
          if (origIdx === card.correctIndex) d.classList.add("border-green-600", "bg-green-50");
          if (typeof chosen === "number" && chosen === idx && origIdx !== card.correctIndex)
            d.classList.add("border-red-600", "bg-red-50");
        }
        optsContainer.appendChild(d);
      });
      body.appendChild(optsContainer);
      if ((this.showAnswer || graded) && infoText) {
        body.appendChild(makeDivider());
        const infoEl = el("div", "bc");
        const infoP = document.createElement("p");
        infoP.className = "bc whitespace-pre-wrap break-words";
        infoP.style.setProperty("margin", "0", "important");
        infoP.style.setProperty("margin-block", "0", "important");
        infoP.innerHTML = this.processMarkdownFeatures(infoText.replace(/\n/g, "<br>"));
        infoEl.appendChild(infoP);
        infoEl.style.lineHeight = "1.75";
        infoEl.style.fontSize = "11px";
        infoEl.style.setProperty("color", "var(--foreground)", "important");
        infoEl.style.setProperty("opacity", "0.6", "important");
        applySectionStyles(infoEl);
        body.appendChild(infoEl);
      }
    } else if (card.type === "io" || card.type === "io-child") {
      const reveal = this.showAnswer || !!graded;
      const ioContainer = el("div", "bc rounded border border-border bg-muted overflow-auto");
      ioContainer.style.setProperty("width", "100%", "important");
      ioContainer.style.setProperty("padding", "0", "important");
      ioContainer.style.setProperty("margin", "6px 0", "important");
      ioContainer.dataset.sproutIoWidget = "1";
      body.appendChild(ioContainer);
      const sourcePath = String(card.sourceNotePath || this.activeFile?.path || "");
      void this.renderImageOcclusionInto(ioContainer, card, sourcePath, reveal);
      // Always show info (extra) only on the back, below cloze answer
      if (reveal && infoText) {
        body.appendChild(makeDivider());
        const infoEl = el("div", "bc");
        const infoP = document.createElement("p");
        infoP.className = "bc whitespace-pre-wrap break-words";
        infoP.style.setProperty("margin", "0", "important");
        infoP.style.setProperty("margin-block", "0", "important");
        infoP.innerHTML = this.processMarkdownFeatures(infoText.replace(/\n/g, "<br>"));
        infoEl.appendChild(infoP);
        infoEl.style.lineHeight = "1.75";
        infoEl.style.fontSize = "11px";
        infoEl.style.setProperty("color", "var(--foreground)", "important");
        infoEl.style.setProperty("opacity", "0.6", "important");
        applySectionStyles(infoEl);
        body.appendChild(infoEl);
      }
    }

    // Setup link handlers for processMarkdownFeatures content
    this.setupInternalLinkHandlers(body);
    
    wrap.appendChild(body);

    // Footer: Controls
    const footer = el("div", "bc px-4 py-3 space-y-2 border-t border-border");
    footer.style.setProperty("border", "none", "important");
    footer.style.setProperty("max-width", "90%", "important");
    footer.style.setProperty("margin", "10px auto", "important");
    footer.style.setProperty("padding", "0 0 15px 0", "important");

    if (this.session.mode === "practice") {
      // Practice mode: Show reveal then next, no grading
      if ((card.type === "basic" || isClozeLike(card) || ioLike) && !this.showAnswer) {
        const revealBtn = makeTextButton({
          label: "Show Answer",
          className: "bc btn-outline w-full text-sm",
          onClick: () => {
            this.showAnswer = true;
            this.render();
            this.containerEl.focus();
          },
          kbd: "↵",
        });
        applyWidgetActionButtonStyles(revealBtn);
        footer.appendChild(revealBtn);
      } else {
        const nextBtn = makeTextButton({
          label: "Next",
          className: "bc btn-outline w-full text-sm",
          onClick: async () => {
            await this.nextCard();
          },
          kbd: "↵",
        });
        applyWidgetActionButtonStyles(nextBtn);
        footer.appendChild(nextBtn);
      }
    } else {
      // Reveal button (for basic/cloze when hidden)
    if ((card.type === "basic" || isClozeLike(card) || ioLike) && !this.showAnswer && !graded) {
      const revealBtn = makeTextButton({
        label: "Reveal Answer",
        className: "bc btn-outline w-full text-sm",
          onClick: () => {
            this.showAnswer = true;
            this.render();
            this.containerEl.focus();
          },
          kbd: "↵",
        });
        applyWidgetActionButtonStyles(revealBtn);
        footer.appendChild(revealBtn);
      }

      // Grading buttons row - 2x2 grid layout (Again+Hard, Good+Easy)
      if (!graded) {
        if ((card.type === "basic" || isClozeLike(card) || ioLike) && this.showAnswer) {
          const fourButton = !!this.plugin.settings.reviewer.fourButtonMode;
          let gradingGrid;
          if (fourButton) {
            gradingGrid = el("div", "bc grid grid-cols-2 gap-2");
          } else {
            gradingGrid = el("div", "bc flex gap-2");
          }

          // Always show Again
          const againBtn = makeTextButton({
            label: "Again",
            className: fourButton ? "bc btn-outline text-xs w-full" : "bc btn-outline text-xs flex-1",
            onClick: async () => {
              await this.gradeCurrentRating("again", {});
              this.render();
            },
            kbd: fourButton ? "1" : "1",
          });
          applyWidgetActionButtonStyles(againBtn);
          gradingGrid.appendChild(againBtn);

          if (fourButton) {
            // Hard button (only in four-button mode)
            const hardBtn = makeTextButton({
              label: "Hard",
              className: "bc btn-outline text-xs w-full",
              onClick: async () => {
                await this.gradeCurrentRating("hard", {});
                this.render();
              },
              kbd: "2",
            });
            applyWidgetActionButtonStyles(hardBtn);
            gradingGrid.appendChild(hardBtn);
          }

          // Always show Good
          const goodBtn = makeTextButton({
            label: "Good",
            className: fourButton ? "bc btn-outline text-xs w-full" : "bc btn-outline text-xs flex-1",
            onClick: async () => {
              await this.gradeCurrentRating("good", {});
              this.render();
            },
            kbd: fourButton ? "3" : "2",
          });
          applyWidgetActionButtonStyles(goodBtn);
          gradingGrid.appendChild(goodBtn);

          if (fourButton) {
            // Easy button (only in four-button mode)
            const easyBtn = makeTextButton({
              label: "Easy",
              className: "bc btn-outline text-xs w-full",
              onClick: async () => {
                await this.gradeCurrentRating("easy", {});
                this.render();
              },
              kbd: "4",
            });
            applyWidgetActionButtonStyles(easyBtn);
            gradingGrid.appendChild(easyBtn);
          }

          footer.appendChild(gradingGrid);
        } else if (card.type === "mcq") {
          const mcqNote = el("div", "bc text-xs text-muted-foreground w-full text-center");
          mcqNote.textContent = "Select an option";
          footer.appendChild(mcqNote);
        }
      } else {
        const nextBtn = makeTextButton({
          label: "Next",
          className: "bc btn-outline w-full text-sm",
          onClick: async () => {
            await this.nextCard();
          },
          kbd: "↵",
        });
        applyWidgetActionButtonStyles(nextBtn);
        footer.appendChild(nextBtn);
      }
    }

    // Edit and More menu buttons row
    const actionRow = el("div", "bc flex gap-2");

    const editBtn = makeTextButton({
      label: "Edit",
      className: "bc btn-outline flex-1 text-xs",
      onClick: () => this.openEditModalForCurrentCard(),
      kbd: "E",
    });
    applyWidgetActionButtonStyles(editBtn);
    actionRow.appendChild(editBtn);

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "bc btn-outline flex-1 text-xs flex items-center justify-center gap-2";
    applyWidgetHoverDarken(moreBtn);
    const moreText = document.createElement("span");
    moreText.textContent = "More";
    const moreKbd = document.createElement("kbd");
    moreKbd.className = "bc kbd ml-2 text-xs";
    moreKbd.textContent = "M";
    moreBtn.appendChild(moreText);
    moreBtn.appendChild(moreKbd);
    applyWidgetActionButtonStyles(moreBtn);
    actionRow.appendChild(moreBtn);

    const canBurySuspend = this.session.mode !== "practice" && !graded;
    const moreMenu = attachWidgetMoreMenu({
      trigger: moreBtn,
      canUndo: this.session.mode !== "practice" && this.canUndo(),
      onUndo: () => void this.undoLastGrade(),
      canBurySuspend,
      onBury: () => void this.buryCurrentCard(),
      onSuspend: () => void this.suspendCurrentCard(),
      openNote: () => {
        const card = this.currentCard && this.currentCard();
        if (!card) return;
        const filePath = card.sourceNotePath || (this.activeFile && this.activeFile.path);
        if (!filePath) return;
        const anchor = card.anchor || card.blockId || card.id;
        const anchorStr = anchor ? `#^${anchor}` : "";
        this.app.workspace.openLinkText(filePath + anchorStr, filePath, true);
      },
    });
    this._moreMenuToggle = () => moreMenu.toggle();

    footer.appendChild(actionRow);
    wrap.appendChild(footer);

    // Progress bar (below buttons)
    const progressBar = el("div", "bc px-4 py-2 border-b border-border");
    progressBar.style.setProperty("border", "none", "important");
    progressBar.style.setProperty("border-radius", "0", "important");
    progressBar.style.setProperty("margin", "0 auto", "important");
    progressBar.style.setProperty("max-width", "200px", "important");
    progressBar.style.setProperty("width", "80%", "important");
    const progressPercent = ((this.session!.index + 1) / this.session!.stats.total) * 100;
    const barBg = el("div", "bc w-full rounded-full overflow-hidden");
    barBg.style.setProperty("height", "1.5px", "important");
    barBg.style.setProperty(
      "background-color",
      "color-mix(in srgb, var(--foreground) 10%, transparent)",
      "important",
    );
    const barFill = el("div", "bc h-full transition-all");
    barFill.style.setProperty("background-color", "var(--theme-accent)", "important");
    (barFill as any).style.width = `${progressPercent}%`;
    barBg.appendChild(barFill);
    progressBar.appendChild(barBg);
    wrap.appendChild(progressBar);

    root.appendChild(wrap);
    this.armTimer();
  }

  /* ---------------------------------------------------------------- */
  /*  Top-level render dispatch                                        */
  /* ---------------------------------------------------------------- */

  render() {
    const root = this.containerEl;
    root.empty();
    root.removeClass("sprout");

    if (this.mode === "session") this.renderSession(root);
    else this.renderSummary(root);
  }

  onunload() {
    this.clearTimer();
  }
}
