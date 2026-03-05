import { Modal, setIcon, type App, type Component } from "obsidian";
import type { CardRecord } from "../../platform/core/store";
import type SproutPlugin from "../../main";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import { replaceChildrenWithHTML, setCssProps } from "../../platform/core/ui";
import { renderClozeFront } from "../../views/reviewer/question-cloze";
import { SproutMarkdownHelper } from "../../views/reviewer/markdown-render";
import { openSproutImageZoom } from "../../views/reviewer/zoom";
import { gradeFromRating } from "../../engine/scheduler/scheduler";
import type { ReviewRating } from "../../platform/types/scheduler";
import { logFsrsIfNeeded } from "../../views/reviewer/fsrs-log";
import { log } from "../../platform/core/logger";
import { processMarkdownFeatures, setupInternalLinkHandlers } from "../../views/widget/widget-markdown";
import { processClozeForMath, textContainsMath, convertInlineDisplayMath, forceSingleLineDisplayMathInline } from "../../platform/core/shared-utils";
import { processCircleFlagsInMarkdown, hydrateCircleFlagsInElement } from "../../platform/flags/flag-tokens";
import { getCorrectIndices, isMultiAnswerMcq, normalizeCardOptions } from "../../platform/types/card";
import { renderImageOcclusionReviewInto } from "../../platform/image-occlusion/image-occlusion-review-render";
import * as IO from "../../platform/image-occlusion/image-occlusion-index";
import { getTtsService } from "../../platform/integrations/tts/tts-service";
import { shouldSkipBackAutoplay } from "../../platform/integrations/tts/autoplay-policy";

type GatekeeperModalArgs = {
  app: App;
  plugin: SproutPlugin;
  cards: CardRecord[];
  allowBypass: boolean;
  scope: "workspace" | "current-tab";
};

export class GatekeeperModal extends Modal {
  private readonly plugin: SproutPlugin;
  private readonly cards: CardRecord[];
  private readonly allowBypass: boolean;
  private readonly modalScope: "workspace" | "current-tab";
  private index = 0;
  private reveal = false;
  private completed = false;
  private _md: SproutMarkdownHelper | null = null;
  private _oqOrderMap: Record<string, number[]> = {};
  private _mcqSingleSelection = new Map<string, number>();
  private _mcqMultiSelection = new Map<string, Set<number>>();
  private _cardStartedAt = Date.now();
  private _grading = false;
  private _lastTtsKey = "";
  private _keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  private _showBypassWarning = false;
  private _frozenModalSize: { width: number; height: number } | null = null;

  constructor(args: GatekeeperModalArgs) {
    super(args.app);
    this.plugin = args.plugin;
    this.cards = args.cards;
    this.allowBypass = args.allowBypass;
    this.modalScope = args.scope;
  }

  override onOpen(): void {
    this.containerEl.addClass("sprout-modal-container", "sprout-modal-dim", "sprout");
    this.modalEl.addClass("bc", "sprout-modals", "sprout-gatekeeper-modal");
    this.contentEl.addClass("bc", "sprout-gatekeeper-content");
    setCssProps(this.containerEl, "z-index", "2147483000");
    setCssProps(this.modalEl, "z-index", "2147483001");
    if (this.modalScope === "current-tab") {
      scopeModalToWorkspace(this);
    }

    this.setupTopRow();
    this.applyModalTitle();

    if (this.allowBypass) {
      this.scope.register([], "Escape", () => {
        this.requestBypass();
        return false;
      });
    } else {
      this.scope.register([], "Escape", () => false);
    }

    this.registerKeyboardShortcuts();

    this.render();
  }

  private registerKeyboardShortcuts() {
    if (this._keyHandler) {
      window.removeEventListener("keydown", this._keyHandler, true);
    }

    this._keyHandler = (ev: KeyboardEvent) => {
      if (!this.modalEl.isConnected) return;
      if (!this.isFromGatekeeperContext(ev)) return;
      if (this.isEditableTarget(ev.target)) return;

      const key = this.getNormalizedHotkey(ev);
      const card = this.cards[this.index];
      if (!card) return;

      if (!this.reveal && key === "enter") {
        ev.preventDefault();
        ev.stopPropagation();
        this.reveal = true;
        this.render();
        return;
      }

      if (!this.reveal || this._grading) return;

      const fourButtonMode = !!this.plugin.settings.study?.fourButtonMode;
      let rating: ReviewRating | null = null;
      if (key === "1") rating = "again";
      else if (fourButtonMode && key === "2") rating = "hard";
      else if (fourButtonMode && key === "3") rating = "good";
      else if (fourButtonMode && key === "4") rating = "easy";
      else if (!fourButtonMode && key === "2") rating = "good";

      if (!rating) return;
      ev.preventDefault();
      ev.stopPropagation();
      void this.gradeCurrentCard(rating);
    };

    window.addEventListener("keydown", this._keyHandler, true);
  }

  override onClose(): void {
    if (this._keyHandler) {
      window.removeEventListener("keydown", this._keyHandler, true);
      this._keyHandler = null;
    }
    this.exitWarningMode();
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest("input, textarea, select")) return true;
    return !!target.closest("[contenteditable='true']");
  }

  private isFromGatekeeperContext(ev: KeyboardEvent): boolean {
    const target = ev.target instanceof Node ? ev.target : null;
    if (target && (this.modalEl.contains(target) || this.containerEl.contains(target))) {
      return true;
    }

    const active = this.modalEl.ownerDocument?.activeElement;
    return !!(active && (this.modalEl.contains(active) || this.containerEl.contains(active)));
  }

  private getNormalizedHotkey(ev: KeyboardEvent): string {
    const code = String(ev.code || "");
    if (code === "Enter" || code === "NumpadEnter") return "enter";
    if (code === "Digit1" || code === "Numpad1") return "1";
    if (code === "Digit2" || code === "Numpad2") return "2";
    if (code === "Digit3" || code === "Numpad3") return "3";
    if (code === "Digit4" || code === "Numpad4") return "4";

    const key = String(ev.key || "").toLowerCase();
    if (key === "return") return "enter";
    return key;
  }

  private setupTopRow() {
    const header = this.modalEl.querySelector(".modal-header");
    const existingTopRow = this.modalEl.querySelector(".sprout-gatekeeper-top-row");
    if (existingTopRow) existingTopRow.remove();

    const topRow = this.modalEl.ownerDocument.createElement("div");
    topRow.className = "bc flex items-center justify-end sprout-gatekeeper-top-row";

    this.modalEl.querySelector(".modal-close-button")?.remove();
    if (this.allowBypass) {
      const bypassBtn = topRow.createEl("button", {
        cls: "bc sprout-gatekeeper-bypass-btn inline-flex items-center h-9 px-2 text-sm",
        type: "button",
      });
      const iconWrap = bypassBtn.createSpan({ cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
      setIcon(iconWrap, "shield-off");
      bypassBtn.createSpan({ text: "Bypass", cls: "sprout-gatekeeper-bypass-label" });
      bypassBtn.setAttribute("data-tooltip", "Bypass this round");
      bypassBtn.setAttribute("data-tooltip-position", "top");
      bypassBtn.onclick = (ev) => {
        ev.preventDefault();
        this.requestBypass();
      };
    }

    this.modalEl.insertBefore(topRow, header ?? this.modalEl.firstChild);
  }

  private applyModalTitle() {
    const titleEl = this.modalEl.querySelector(".modal-title");
    if (!titleEl) return;
    titleEl.empty();
    titleEl.addClass("flex", "items-center", "gap-2");

    const iconWrap = titleEl.createSpan({ cls: "bc inline-flex items-center justify-center" });
    setIcon(iconWrap, "sprout-brand");

    titleEl.createSpan({ text: "Sprout Gatekeeper", cls: "font-semibold" });
  }

  override close(): void {
    if (!this.allowBypass && !this.completed) return;
    super.close();
  }

  private render(): void {
    const card = this.cards[this.index];
    if (!card) {
      this.completed = true;
      super.close();
      return;
    }

    const { contentEl } = this;
    contentEl.empty();

    if (this._showBypassWarning) {
      this.renderBypassWarning(contentEl);
      return;
    }

    const qaSection = contentEl.createDiv({ cls: "bc sprout-gatekeeper-qa-section" });

    const qHeading = qaSection.createDiv({ cls: "bc flex items-center justify-between gap-2" });
    qHeading.createEl("h3", { text: "Question", cls: "text-sm font-medium sprout-gatekeeper-section-label" });
    this.appendTtsReplayButton(qHeading, card, false);
    const body = qaSection.createDiv({ cls: "sprout-gatekeeper-body" });
    this.renderCardBody(body, card);

    const footer = contentEl.createDiv({ cls: "bc flex flex-col items-center gap-3 sprout-modal-footer sprout-gatekeeper-footer" });

    if (!this.reveal) {
      const mainActionRow = footer.createDiv({ cls: "bc flex items-center justify-center gap-2 w-full" });
      const revealBtn = this.makeButtonWithKbd(mainActionRow, {
        text: "Reveal answer",
        cls: "bc btn-primary inline-flex items-center gap-2 h-9 px-3 text-sm",
        kbd: "↵",
      });
      revealBtn.addEventListener("click", () => {
        this.reveal = true;
        this.render();
      });

      const progressRow = footer.createDiv({ cls: "bc flex items-center justify-center w-full sprout-gatekeeper-progress-row" });
      progressRow.createDiv({ text: `${this.index + 1} of ${this.cards.length}`, cls: "text-sm text-muted-foreground" });

      return;
    }

    const fourButtonMode = !!this.plugin.settings.study?.fourButtonMode;
    const gradeRow = footer.createDiv({ cls: fourButtonMode ? "bc grid grid-cols-2 gap-2 w-full" : "bc flex items-center justify-center gap-2 w-full" });
    const grades = fourButtonMode
      ? ([
          { rating: "again", label: "Again", kbd: "1", tooltip: "Grade question as again (1)", cls: "bc btn-destructive sprout-btn-again inline-flex items-center gap-2 h-9 px-3 text-sm" },
          { rating: "hard", label: "Hard", kbd: "2", tooltip: "Grade question as hard (2)", cls: "bc btn sprout-btn-hard inline-flex items-center gap-2 h-9 px-3 text-sm" },
          { rating: "good", label: "Good", kbd: "3", tooltip: "Grade question as good (3)", cls: "bc btn sprout-btn-good inline-flex items-center gap-2 h-9 px-3 text-sm" },
          { rating: "easy", label: "Easy", kbd: "4", tooltip: "Grade question as easy (4)", cls: "bc btn sprout-btn-easy inline-flex items-center gap-2 h-9 px-3 text-sm" },
        ] as const)
      : ([
          { rating: "again", label: "Again", kbd: "1", tooltip: "Grade question as again (1)", cls: "bc btn-destructive sprout-btn-again inline-flex items-center gap-2 h-9 px-3 text-sm" },
          { rating: "good", label: "Good", kbd: "2", tooltip: "Grade question as good (2)", cls: "bc btn sprout-btn-good inline-flex items-center gap-2 h-9 px-3 text-sm" },
        ] as const);

    for (const grade of grades) {
      const btn = this.makeButtonWithKbd(gradeRow, {
        text: grade.label,
        cls: `${grade.cls}${fourButtonMode ? " w-full" : ""}`,
        kbd: grade.kbd,
        tooltip: grade.tooltip,
      });
      btn.addEventListener("click", () => {
        void this.gradeCurrentCard(grade.rating);
      });
    }

    const progressRow = footer.createDiv({ cls: "bc flex items-center justify-center w-full sprout-gatekeeper-progress-row" });
    progressRow.createDiv({ text: `${this.index + 1} of ${this.cards.length}`, cls: "text-sm text-muted-foreground" });
  }

  private requestBypass() {
    if (!this.allowBypass) return;
    const showWarning = this.plugin.settings.reminders?.gatekeeperBypassWarning ?? true;
    if (showWarning && !this._showBypassWarning) {
      this.enterWarningMode();
      this._showBypassWarning = true;
      this.render();
      return;
    }
    this.close();
  }

  private enterWarningMode() {
    if (!this._frozenModalSize) {
      const rect = this.modalEl.getBoundingClientRect();
      this._frozenModalSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    const frozen = this._frozenModalSize;
    if (frozen && frozen.width > 0 && frozen.height > 0) {
      setCssProps(this.modalEl, "width", `${frozen.width}px`);
      setCssProps(this.modalEl, "min-width", `${frozen.width}px`);
      setCssProps(this.modalEl, "max-width", `${frozen.width}px`);
      setCssProps(this.modalEl, "height", `${frozen.height}px`);
      setCssProps(this.modalEl, "min-height", `${frozen.height}px`);
      setCssProps(this.modalEl, "max-height", `${frozen.height}px`);
    }
    this.modalEl.addClass("sprout-gatekeeper-warning-mode");
  }

  private exitWarningMode() {
    this.modalEl.removeClass("sprout-gatekeeper-warning-mode");
    this._showBypassWarning = false;
    this._frozenModalSize = null;
    setCssProps(this.modalEl, "width", "");
    setCssProps(this.modalEl, "min-width", "");
    setCssProps(this.modalEl, "max-width", "");
    setCssProps(this.modalEl, "height", "");
    setCssProps(this.modalEl, "min-height", "");
    setCssProps(this.modalEl, "max-height", "");
  }

  private renderBypassWarning(contentEl: HTMLElement) {
    const wrap = contentEl.createDiv({ cls: "bc sprout-gatekeeper-warning-wrap" });
    wrap.createDiv({ cls: "bc sprout-gatekeeper-warning-text", text: "Bypass this round?" });
    wrap.createDiv({
      cls: "bc text-muted-foreground text-sm sprout-gatekeeper-warning-subtext",
      text: "You've got cards due today — continuing may weaken your long-term retention!",
    });

    const actions = wrap.createDiv({ cls: "bc flex items-center justify-center gap-2" });
    const goBack = actions.createEl("button", { cls: "bc btn-outline h-9 px-3 text-sm", type: "button" });
    goBack.createSpan({ text: "Go back" });
    goBack.removeAttribute("data-tooltip");
    goBack.removeAttribute("data-tooltip-position");
    goBack.addEventListener("click", () => {
      this.exitWarningMode();
      this.render();
    });

    const continueBtn = actions.createEl("button", { cls: "bc sprout-gatekeeper-bypass-btn h-9 px-3 text-sm", type: "button" });
    continueBtn.createSpan({ text: "Continue" });
    continueBtn.removeAttribute("data-tooltip");
    continueBtn.removeAttribute("data-tooltip-position");
    continueBtn.addEventListener("click", () => this.close());
  }

  private getCardLocationText(card: CardRecord): string {
    const raw = String(card.sourceNotePath || "").trim();
    if (!raw) return "";
    const clean = raw.replace(/\\/g, "/").replace(/\.md$/i, "");
    return clean.split("/").filter(Boolean).join(" / ");
  }

  private getCardTitleText(card: CardRecord): string {
    const explicit = String(card.title || "").trim();
    if (explicit) return explicit;

    const type = String(card.type || "").toLowerCase();
    const fallback =
      type === "mcq"
        ? String(card.stem || "").trim()
        : type === "cloze" || type === "cloze-child"
          ? String(card.clozeText || "").trim()
          : type === "io" || type === "io-child"
            ? String(card.prompt || "").trim()
            : String(card.q || "").trim();

    const oneLine = fallback.replace(/\s+/g, " ").trim();
    if (!oneLine) return "Flashcard";
    return oneLine.length > 90 ? `${oneLine.slice(0, 87)}...` : oneLine;
  }

  private makeButtonWithKbd(parent: HTMLElement, args: { text: string; cls: string; kbd?: string; tooltip?: string }) {
    const btn = parent.createEl("button", { cls: args.cls, type: "button" });
    btn.createSpan({ text: args.text });
    btn.setAttribute("data-tooltip", args.tooltip || (args.kbd ? `${args.text} (${args.kbd})` : args.text));
    btn.setAttribute("data-tooltip-position", "top");
    if (args.kbd) {
      btn.createEl("kbd", { cls: "bc kbd", text: args.kbd });
    }
    return btn;
  }

  private async gradeCurrentCard(rating: ReviewRating): Promise<void> {
    if (this._grading) return;
    const card = this.cards[this.index];
    if (!card) return;

    const id = String(card.id || "");
    if (!id) return;

    this._grading = true;
    try {
      const now = Date.now();
      const msToAnswer = Math.max(0, now - this._cardStartedAt);
      const st = this.plugin.store.getState(id) ?? this.plugin.store.ensureState(id, now);

      const meta = {
        via: "gatekeeper",
        gatekeeper: true,
        gatekeeperIndex: this.index + 1,
        gatekeeperTotal: this.cards.length,
      } as Record<string, unknown>;

      const { nextState, prevDue, nextDue, metrics } = gradeFromRating(st, rating, now, this.plugin.settings);

      this.plugin.store.upsertState(nextState);
      this.plugin.store.appendReviewLog({
        id,
        at: now,
        result: rating,
        prevDue,
        nextDue,
        meta,
      });

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
          meta,
        });
      }

      await this.plugin.store.persist();

      logFsrsIfNeeded({
        id,
        cardType: String(card.type || "unknown"),
        rating,
        metrics,
        nextDue,
        meta,
      });

      this.index += 1;
      this.reveal = false;
      this.exitWarningMode();
      this._cardStartedAt = Date.now();

      if (this.index >= this.cards.length) {
        this.completed = true;
        super.close();
        return;
      }

      this.render();
    } catch (e) {
      log.swallow("gatekeeper grade", e);
    } finally {
      this._grading = false;
    }
  }

  private ensureMarkdownHelper() {
    if (this._md) return;
    this._md = new SproutMarkdownHelper({
      app: this.app,
      owner: this as unknown as Component,
      maxHeightPx: 260,
      onZoom: (src, alt) => openSproutImageZoom(this.app, src, alt),
    });
  }

  private async renderMarkdownInto(containerEl: HTMLElement, md: string, sourcePath: string) {
    this.ensureMarkdownHelper();
    if (!this._md) return;
    const withFlags = processCircleFlagsInMarkdown(md ?? "");
    await this._md.renderInto(containerEl, withFlags, sourcePath ?? "");
    hydrateCircleFlagsInElement(containerEl);
  }

  private renderCardBody(body: HTMLElement, card: CardRecord) {
    const type = String(card.type || "").toLowerCase();

    if (type === "basic" || type === "reversed" || type === "reversed-child") {
      this.renderBasicCard(body, card);
    } else if (type === "cloze" || type === "cloze-child") {
      this.renderClozeCard(body, card);
    } else if (type === "mcq") {
      this.renderMcqCard(body, card);
    } else if (type === "oq") {
      this.renderOqCard(body, card);
    } else if (type === "io" || type === "io-child") {
      this.renderIoCard(body, card);
    } else {
      const q = body.createDiv({ cls: "whitespace-pre-wrap" });
      const maybeQuestion = (card as unknown as Record<string, unknown>).q;
      q.textContent = typeof maybeQuestion === "string" ? maybeQuestion : "(No question text)";
      if (this.reveal) {
        const a = body.createDiv({ cls: "whitespace-pre-wrap mt-3" });
        const maybeAnswer = (card as unknown as Record<string, unknown>).a;
        a.textContent = typeof maybeAnswer === "string" ? maybeAnswer : "(No answer text)";
      }
    }
  }

  private renderBasicCard(body: HTMLElement, card: CardRecord) {
    const isBackDirection = card.type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
    const isOldReversed = card.type === "reversed";
    const qText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
    const qEl = body.createDiv({ cls: "whitespace-pre-wrap break-words" });
    this.renderTextBlock(qEl, qText, card);

    if (!this.reveal) return;

    const aHeading = body.createDiv({ cls: "bc flex items-center justify-between gap-2" });
    aHeading.createEl("h3", { text: "Answer", cls: "text-sm font-medium sprout-gatekeeper-section-label" });
    this.appendTtsReplayButton(aHeading, card, true);
    const aText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
    const aEl = body.createDiv({ cls: "whitespace-pre-wrap break-words" });
    this.renderTextBlock(aEl, aText, card);
  }

  private isGatekeeperTtsEnabled(): boolean {
    const audio = this.plugin.settings.audio;
    if (!audio?.enabled) return false;
    return (audio as Record<string, unknown>).gatekeeperReplay === true;
  }

  private appendTtsReplayButton(parent: HTMLElement, card: CardRecord, answerSide: boolean): void {
    if (!this.isGatekeeperTtsEnabled()) return;

    const tts = getTtsService();
    if (!tts.isSupported) return;

    const btn = parent.createEl("button", {
      cls: "bc btn-icon sprout-tts-replay-btn",
      type: "button",
    });
    btn.setAttribute("data-tooltip", answerSide ? "Read answer aloud" : "Read question aloud");
    btn.setAttribute("data-tooltip-position", "top");
    setIcon(btn, "volume-2");
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.speakCardSide(card, answerSide);
    });
  }

  private maybeAutoSpeakCurrentCard(card: CardRecord): void {
    const audio = this.plugin.settings.audio;
    if (!this.isGatekeeperTtsEnabled()) return;
    if (audio.autoplay === false) return;

    if (this.reveal && shouldSkipBackAutoplay(card)) return;

    const sideKey = this.reveal ? "back" : "front";
    const cardId = String(card.id ?? "");
    const nextKey = `${cardId}:${sideKey}`;
    if (this._lastTtsKey === nextKey) return;

    this._lastTtsKey = nextKey;
    this.speakCardSide(card, this.reveal);
  }

  private speakCardSide(card: CardRecord, answerSide: boolean): void {
    const tts = getTtsService();
    const audio = this.plugin.settings.audio;
    if (!audio?.enabled || (audio as Record<string, unknown>).gatekeeperReplay !== true || !tts.isSupported) return;

    const isBackDirection = card.type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
    const isOldReversed = card.type === "reversed";

    if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
      const questionText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
      const answerText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
      tts.speakBasicCard(answerSide ? answerText : questionText, audio);
      return;
    }

    if (card.type === "cloze" || card.type === "cloze-child") {
      const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;
      tts.speakClozeCard(card.clozeText || "", answerSide, targetIndex, audio);
      return;
    }

    if (card.type === "mcq") {
      const text = [card.stem || "", ...normalizeCardOptions(card.options)].filter(Boolean).join(". ");
      tts.speakBasicCard(text, audio);
      return;
    }

    if (card.type === "oq") {
      const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
      const text = [card.q || "", ...steps].filter(Boolean).join(". ");
      tts.speakBasicCard(text, audio);
      return;
    }

    if (card.type === "io" || card.type === "io-child") {
      tts.speakBasicCard(answerSide ? (card.a || "") : (card.q || ""), audio);
    }
  }

  private renderClozeCard(body: HTMLElement, card: CardRecord) {
    const text = card.clozeText || "";
    const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : undefined;

    if (text.includes("$") || text.includes("\\(") || text.includes("\\[") || text.includes("[[")) {
      const clozeEl = document.createElement("div");
      clozeEl.className = "bc sprout-widget-cloze sprout-widget-text w-full whitespace-pre-wrap break-words";
      const sourcePath = String(card.sourceNotePath || "");
      const processedText = processClozeForMath(text, this.reveal, targetIndex);
      void this.renderMarkdownInto(clozeEl, processedText, sourcePath);
      body.appendChild(clozeEl);
    } else {
      const clozeMode = this.plugin.settings.cards?.clozeMode ?? "standard";
      const clozeBgColor = this.plugin.settings.cards?.clozeBgColor ?? "";
      const clozeTextColor = this.plugin.settings.cards?.clozeTextColor ?? "";

      const hasMath = textContainsMath(text);

      const clozeEl = renderClozeFront(text, this.reveal, targetIndex, {
        mode: hasMath ? "standard" : clozeMode,
        clozeBgColor,
        clozeTextColor,
      });
      clozeEl.className = "bc sprout-widget-cloze sprout-widget-text w-full";
      body.appendChild(clozeEl);
    }
  }

  private renderMcqCard(body: HTMLElement, card: CardRecord) {
    const stemText = card.stem || "";
    const sourcePath = String(card.sourceNotePath || "");
    const cardId = String(card.id || "");
    const stemEl = body.createDiv({ cls: "whitespace-pre-wrap break-words sprout-gatekeeper-question-block" });
    if (stemText.includes("$") || stemText.includes("\\(") || stemText.includes("\\[") || stemText.includes("[[")) {
      void this.renderMarkdownInto(stemEl, convertInlineDisplayMath(stemText), sourcePath);
    } else {
      replaceChildrenWithHTML(stemEl, processMarkdownFeatures(stemText));
    }

    const options = normalizeCardOptions(card.options);
    const isMulti = isMultiAnswerMcq(card);
    const correctSet = new Set(getCorrectIndices(card));
    const chosenSingle = this._mcqSingleSelection.get(cardId);
    if (!this._mcqMultiSelection.has(cardId)) {
      this._mcqMultiSelection.set(cardId, new Set<number>());
    }
    const chosenMulti = this._mcqMultiSelection.get(cardId) as Set<number>;

    const optsContainer = body.createDiv({ cls: "bc flex flex-col gap-2 sprout-widget-section" });

    options.forEach((opt: string, idx: number) => {
      const d = body.ownerDocument.createElement("div");
      d.className = "bc px-3 py-2 rounded border border-border hover:bg-secondary sprout-widget-text sprout-widget-mcq-option";
      if (!this.reveal) d.classList.add("cursor-pointer");

      const left = body.ownerDocument.createElement("span");
      left.className = "bc inline-flex items-center gap-2 min-w-0";

      const key = body.ownerDocument.createElement("kbd");
      key.className = "bc kbd";
      key.textContent = String(idx + 1);
      left.appendChild(key);

      const textEl = body.ownerDocument.createElement("span");
      textEl.className = "bc min-w-0 whitespace-pre-wrap break-words sprout-widget-mcq-text";
      const optText = typeof opt === "string" ? opt : "";
      if (optText.includes("$") || optText.includes("\\(") || optText.includes("\\[") || optText.includes("[[")) {
        void this.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(optText), sourcePath);
      } else {
        replaceChildrenWithHTML(textEl, processMarkdownFeatures(optText));
      }
      left.appendChild(textEl);
      d.appendChild(left);

      if (!this.reveal) {
        if (isMulti) {
          if (chosenMulti.has(idx)) d.classList.add("sprout-mcq-selected");
          d.addEventListener("click", () => {
            const current = this._mcqMultiSelection.get(cardId) ?? new Set<number>();
            if (current.has(idx)) current.delete(idx);
            else current.add(idx);
            this._mcqMultiSelection.set(cardId, current);
            this.render();
          });
        } else {
          if (chosenSingle === idx) d.classList.add("sprout-mcq-selected");
          d.addEventListener("click", () => {
            this._mcqSingleSelection.set(cardId, idx);
            this.render();
          });
        }
      } else {
        if (isMulti) {
          const isCorrect = correctSet.has(idx);
          const wasChosen = chosenMulti.has(idx);
          if (isCorrect && wasChosen) d.classList.add("sprout-mcq-correct-highlight");
          else if (isCorrect && !wasChosen) d.classList.add("sprout-mcq-missed-correct");
          else if (!isCorrect && wasChosen) d.classList.add("sprout-mcq-wrong-highlight");
        } else {
          if (idx === card.correctIndex) d.classList.add("sprout-mcq-correct-highlight");
          if (typeof chosenSingle === "number" && chosenSingle === idx && idx !== card.correctIndex) {
            d.classList.add("sprout-mcq-wrong-highlight");
          }
        }
      }

      optsContainer.appendChild(d);
    });

    if (!this.reveal) {
      const hint = body.createDiv({ cls: "text-muted-foreground mt-2 text-sm" });
      hint.textContent = isMulti ? "Select all correct answers" : "Select the correct answer";
    }

    setupInternalLinkHandlers(optsContainer, this.app);
    setupInternalLinkHandlers(stemEl, this.app);
  }

  private renderOqCard(body: HTMLElement, card: CardRecord) {
    const qEl = body.createDiv({ cls: "whitespace-pre-wrap break-words sprout-gatekeeper-question-block" });
    this.renderTextBlock(qEl, card.q || "", card);

    const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
    const cardId = String(card.id || "");
    const sourcePath = String(card.sourceNotePath || "");
    const shouldShuffle = this.plugin.settings.study?.randomizeOqOrder ?? true;

    if (!this._oqOrderMap[cardId]) {
      const identity = Array.from({ length: steps.length }, (_, i) => i);
      const next = identity.slice();
      if (shouldShuffle) this.shuffleInPlace(next);
      if (steps.length >= 2 && next.every((v, i) => v === i)) {
        const tmp = next[0];
        next[0] = next[1];
        next[1] = tmp;
      }
      this._oqOrderMap[cardId] = next;
    }

    if (!this.reveal) {
      const listWrap = body.createDiv({ cls: "flex flex-col gap-2 sprout-oq-step-list" });
      const currentOrder = this._oqOrderMap[cardId].slice();

      const renderSteps = () => {
        listWrap.empty();
        currentOrder.forEach((origIdx, displayIdx) => {
          const stepText = steps[origIdx] || "";
          const row = body.ownerDocument.createElement("div");
          row.className = "bc flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 sprout-oq-step-row";
          row.draggable = true;

          const grip = body.ownerDocument.createElement("span");
          grip.className = "bc sprout-oq-grip inline-flex items-center justify-center text-muted-foreground cursor-grab";
          setIcon(grip, "grip-vertical");
          row.appendChild(grip);

          const badge = body.ownerDocument.createElement("kbd");
          badge.className = "bc kbd";
          badge.textContent = String(displayIdx + 1);
          row.appendChild(badge);

          const textEl = body.ownerDocument.createElement("span");
          textEl.className = "bc min-w-0 whitespace-pre-wrap break-words flex-1 sprout-oq-step-text sprout-widget-text";
          if (stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[") || stepText.includes("[[")) {
            void this.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath);
          } else {
            replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
          }
          row.appendChild(textEl);

          row.addEventListener("dragstart", (e) => {
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(displayIdx));
            }
          });

          row.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          });

          row.addEventListener("drop", (e) => {
            e.preventDefault();
            const fromIdx = Number(e.dataTransfer?.getData("text/plain") || "-1");
            if (fromIdx === -1 || fromIdx === displayIdx) return;
            const item = currentOrder[fromIdx];
            currentOrder.splice(fromIdx, 1);
            currentOrder.splice(displayIdx, 0, item);
            this._oqOrderMap[cardId] = currentOrder.slice();
            renderSteps();
          });

          listWrap.appendChild(row);
        });
      };

      renderSteps();
      return;
    }

    body.createEl("h3", { text: "Your order", cls: "text-sm font-medium sprout-gatekeeper-section-label" });
    const answerList = body.createDiv({ cls: "flex flex-col gap-2 sprout-oq-answer-list" });
    const identity = Array.from({ length: steps.length }, (_, i) => i);
    const userOrder = Array.isArray(this._oqOrderMap[cardId]) && this._oqOrderMap[cardId].length === steps.length
      ? this._oqOrderMap[cardId]
      : identity;

    userOrder.forEach((origIdx, displayIdx) => {
      const stepText = steps[origIdx] || "";
      const wasInCorrectPosition = origIdx === displayIdx;
      const row = body.ownerDocument.createElement("div");
      row.className = "bc flex items-center gap-2 rounded-lg border px-3 py-2 sprout-oq-answer-row";
      if (wasInCorrectPosition) {
        row.classList.add("sprout-oq-correct", "sprout-oq-correct-highlight");
      } else {
        row.classList.add("sprout-oq-wrong", "sprout-oq-wrong-highlight");
      }

      const badge = body.ownerDocument.createElement("kbd");
      badge.className = "bc kbd";
      badge.textContent = String(origIdx + 1);
      row.appendChild(badge);

      const textEl = body.ownerDocument.createElement("span");
      textEl.className = "bc min-w-0 whitespace-pre-wrap break-words flex-1 sprout-widget-text sprout-oq-step-text";
      if (stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[") || stepText.includes("[[")) {
        void this.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath);
      } else {
        replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
      }
      row.appendChild(textEl);

      answerList.appendChild(row);
    });
  }

  private renderIoCard(body: HTMLElement, card: CardRecord) {
    const ioContainer = body.createDiv({ cls: "rounded border border-border bg-muted overflow-auto sprout-widget-io-container" });
    ioContainer.dataset.sproutIoWidget = "1";

    const sourcePath = String(card.sourceNotePath || "");
    renderImageOcclusionReviewInto({
      app: this.app,
      plugin: this.plugin,
      containerEl: ioContainer,
      card,
      sourcePath,
      reveal: this.reveal,
      ioModule: IO,
      renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
    });
  }

  private renderTextBlock(el: HTMLElement, text: string, card: CardRecord) {
    if (this.hasMarkdownTable(text) || text.includes("[[") || text.includes("$") || text.includes("\\(") || text.includes("\\[")) {
      const sourcePath = String(card.sourceNotePath || "");
      void this.renderMarkdownInto(el, convertInlineDisplayMath(text), sourcePath);
      return;
    }

    replaceChildrenWithHTML(el, processMarkdownFeatures(String(text || "").replace(/\n/g, "<br>")));
    setupInternalLinkHandlers(el, this.app);
  }

  private hasMarkdownTable(text: string): boolean {
    return /^\|.+\|\s*\n\|[\s:|-]+\|/m.test(String(text || ""));
  }

  private shuffleInPlace(a: number[]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
  }

}
