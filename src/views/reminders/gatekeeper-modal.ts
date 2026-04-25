/**
 * @file src/views/reminders/gatekeeper-modal.ts
 * @summary Module for gatekeeper modal.
 *
 * @exports
 *  - GatekeeperModal
 */

import { Modal, setIcon, type App, type Component } from "obsidian";
import type { CardRecord } from "../../platform/core/store";
import type LearnKitPlugin from "../../main";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import { createOqReorderPreviewController } from "../../platform/core/oq-reorder-preview";
import { replaceChildrenWithHTML, setCssProps } from "../../platform/core/ui";
import { hydrateRenderedMathCloze, renderClozeFront } from "../../views/reviewer/question-cloze";
import { SproutMarkdownHelper } from "../../views/reviewer/markdown-render";
import { openSproutImageZoom } from "../../views/reviewer/zoom";
import { gradeCard } from "../../platform/services/grading-service";
import type { ReviewRating } from "../../platform/types/scheduler";
import { logFsrsIfNeeded } from "../../views/reviewer/fsrs-log";
import { log } from "../../platform/core/logger";
import { processMarkdownFeatures, setupInternalLinkHandlers } from "../../views/widget/view/markdown";
import { getRatingIntervalPreview } from "../../platform/core/grade-intervals";
import { processClozeForMath, convertInlineDisplayMath, forceSingleLineDisplayMathInline } from "../../platform/core/shared-utils";
import { processCircleFlagsInMarkdown, hydrateCircleFlagsInElement } from "../../platform/flags/flag-tokens";
import { getCorrectIndices, isMultiAnswerMcq, normalizeCardOptions } from "../../platform/types/card";
import { renderImageOcclusionReviewInto } from "../../platform/image-occlusion/image-occlusion-review-render";
import * as IO from "../../platform/image-occlusion/image-occlusion-index";
import { getTtsService, bindTtsPlayingState, markTtsButtonActive } from "../../platform/integrations/tts/tts-service";
import { shouldSkipBackAutoplay } from "../../platform/integrations/tts/autoplay-policy";
import { t } from "../../platform/translations/translator";

type GatekeeperModalArgs = {
  app: App;
  plugin: LearnKitPlugin;
  cards: CardRecord[];
  allowBypass: boolean;
  scope: "workspace" | "current-tab";
};

export class GatekeeperModal extends Modal {
  private readonly plugin: LearnKitPlugin;
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
  private _progressEl: HTMLElement | null = null;

  constructor(args: GatekeeperModalArgs) {
    super(args.app);
    this.plugin = args.plugin;
    this.cards = args.cards;
    this.allowBypass = args.allowBypass;
    this.modalScope = args.scope;
  }

  override onOpen(): void {
    this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "learnkit");
    this.modalEl.addClass("lk-modals", "learnkit-gatekeeper-modal");
    this.contentEl.addClass("learnkit-gatekeeper-content");
    setCssProps(this.containerEl, "z-index", "2147483000");
    setCssProps(this.modalEl, "z-index", "2147483001");
    if (this.modalScope === "current-tab") {
      scopeModalToWorkspace(this);
    }

    this.setupHeader();

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

  private setupHeader() {
    const headerEl = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header");
    if (!headerEl) return;

    const titleEl = headerEl.querySelector<HTMLElement>(":scope > .modal-title");
    if (titleEl) {
      titleEl.empty();
      // Separate strings avoid sentence-case lint trigger
      titleEl.createSpan({ text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.gatekeeper.title.learn", "Learn") });
      titleEl.createSpan({ text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.gatekeeper.title.kit", "Kit") });
      titleEl.createSpan({ text: " " });
      titleEl.createSpan({ text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.gatekeeper.title.gatekeeper", "Gatekeeper") });
    }

    // Progress indicator (top-right, like close button position on other modals)
    const progressEl = headerEl.createDiv({ cls: "text-sm text-muted-foreground learnkit-gatekeeper-progress learnkit-gatekeeper-progress" });
    progressEl.setText(`${this.index + 1} of ${this.cards.length}`);
    this._progressEl = progressEl;

    // Remove Obsidian's default close button
    this.modalEl.querySelector<HTMLElement>(":scope > .modal-close-button")?.remove();

    // Add bypass button into header (replaces old top-row)
    const existingBypass = headerEl.querySelector<HTMLElement>(".learnkit-gatekeeper-bypass-btn");
    if (existingBypass) existingBypass.remove();

    if (this.allowBypass) {
      const bypassBtn = headerEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-gatekeeper-bypass-btn learnkit-gatekeeper-bypass-btn",
        attr: { type: "button", "aria-label": "Bypass this round" },
      });
      bypassBtn.setAttr("data-tooltip-position", "top");
      const iconWrap = bypassBtn.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-4" });
      setIcon(iconWrap, "shield-off");
      bypassBtn.createSpan({ text: "Bypass", cls: "", attr: { "data-learnkit-label": "true" } });
      bypassBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.requestBypass();
      });
    }
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

    // Update header progress indicator
    if (this._progressEl) {
      this._progressEl.setText(`${this.index + 1} of ${this.cards.length}`);
    }

    if (this._showBypassWarning) {
      this.renderBypassWarning(contentEl);
      return;
    }

    // ── Content: study-style card section ──
    const section = contentEl.createEl("section", { cls: "flex flex-col gap-3 learnkit-gatekeeper-qa-section learnkit-gatekeeper-qa-section" });

    // Question row
    section.appendChild(this.makeLabelRow("Question", card, false));
    this.renderQuestionBlock(section, card);

    // Answer + extra info (only when revealed)
    if (this.reveal) {
      this.renderAnswerBlock(section, card);
      this.renderExtraInfoBlock(section, card);
    }

    // ── Footer: review buttons ──
    const footer = contentEl.createDiv({ cls: "flex flex-col items-center gap-3 lk-modal-footer learnkit-gatekeeper-footer learnkit-gatekeeper-footer" });

    if (!this.reveal) {
      const mainActionRow = footer.createDiv({ cls: "flex items-center justify-center gap-2 w-full" });
      const revealBtn = this.makeButtonWithKbd(mainActionRow, {
        text: "Reveal answer",
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter",
        kbd: "↵",
      });
      revealBtn.addEventListener("click", () => {
        this.reveal = true;
        this.render();
      });

      return;
    }

    const fourButtonMode = !!this.plugin.settings.study?.fourButtonMode;
    const showIntervals = !!this.plugin.settings.study?.showGradeIntervals;
    const previewNow = Date.now();
    const previewState = showIntervals ? this.plugin.store.ensureState(String(card.id), previewNow) : null;
    const getSubtitle = (rating: ReviewRating): string | undefined => {
      if (!previewState || !showIntervals) return undefined;
      return (
        getRatingIntervalPreview({
          state: previewState,
          rating,
          now: previewNow,
          scheduling: this.plugin.settings.scheduling,
        }) ?? undefined
      );
    };

    const gradeRow = footer.createDiv({ cls: fourButtonMode ? "grid grid-cols-2 gap-2 w-full" : "flex flex-wrap justify-center gap-2 w-full" });
    const grades = fourButtonMode
      ? ([
          { rating: "again", label: "Again", subtitle: getSubtitle("again"), kbd: "1", tooltip: "Not recalled easily (1)", cls: "btn-destructive learnkit-btn-again learnkit-btn-again learnkit-grade-btn-with-interval learnkit-grade-btn-with-interval" },
          { rating: "hard", label: "Hard", subtitle: getSubtitle("hard"), kbd: "2", tooltip: "Recalled with difficulty (2)", cls: "btn learnkit-btn-hard learnkit-btn-hard learnkit-grade-btn-with-interval learnkit-grade-btn-with-interval" },
          { rating: "good", label: "Good", subtitle: getSubtitle("good"), kbd: "3", tooltip: "Recalled with effort (3)", cls: "btn learnkit-btn-good learnkit-btn-good learnkit-grade-btn-with-interval learnkit-grade-btn-with-interval" },
          { rating: "easy", label: "Easy", subtitle: getSubtitle("easy"), kbd: "4", tooltip: "Recalled easily (4)", cls: "btn learnkit-btn-easy learnkit-btn-easy learnkit-grade-btn-with-interval learnkit-grade-btn-with-interval" },
        ] as const)
      : ([
          { rating: "again", label: "Again", subtitle: getSubtitle("again"), kbd: "1", tooltip: "Not recalled easily (1)", cls: "btn-destructive learnkit-btn-again learnkit-btn-again learnkit-grade-btn-with-interval learnkit-grade-btn-with-interval" },
          { rating: "good", label: "Good", subtitle: getSubtitle("good"), kbd: "2", tooltip: "Recalled easily (2)", cls: "btn learnkit-btn-good learnkit-btn-good learnkit-grade-btn-with-interval learnkit-grade-btn-with-interval" },
        ] as const);

    for (const grade of grades) {
      const btn = this.makeButtonWithKbd(gradeRow, {
        text: grade.label,
        subtitle: grade.subtitle,
        cls: `${grade.cls}${fourButtonMode ? " w-full" : ""}`,
        kbd: grade.kbd,
        tooltip: grade.tooltip,
      });
      btn.addEventListener("click", () => {
        void this.gradeCurrentCard(grade.rating);
      });
    }

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
    this.modalEl.addClass("learnkit-gatekeeper-warning-mode");
  }

  private exitWarningMode() {
    this.modalEl.removeClass("learnkit-gatekeeper-warning-mode");
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
    const wrap = contentEl.createDiv({ cls: "learnkit-gatekeeper-warning-wrap learnkit-gatekeeper-warning-wrap" });
    wrap.createDiv({ cls: "learnkit-gatekeeper-warning-text learnkit-gatekeeper-warning-text", text: "Bypass this round?" });
    wrap.createDiv({
      cls: "text-muted-foreground text-sm learnkit-gatekeeper-warning-subtext learnkit-gatekeeper-warning-subtext",
      text: "You've got cards due today — continuing may weaken your long-term retention!",
    });

    const actions = wrap.createDiv({ cls: "flex items-center justify-center gap-2" });
    const goBack = actions.createEl("button", { cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-9 px-3 text-sm", type: "button" });
    goBack.createSpan({ text: "Go back" });
    goBack.removeAttribute("aria-label");
    goBack.removeAttribute("data-tooltip-position");
    goBack.addEventListener("click", () => {
      this.exitWarningMode();
      this.render();
    });

    const continueBtn = actions.createEl("button", { cls: "learnkit-gatekeeper-bypass-btn learnkit-gatekeeper-bypass-btn h-9 px-3 text-sm", type: "button" });
    continueBtn.createSpan({ text: "Continue" });
    continueBtn.removeAttribute("aria-label");
    continueBtn.removeAttribute("data-tooltip-position");
    continueBtn.addEventListener("click", () => this.close());
  }

  private makeButtonWithKbd(parent: HTMLElement, args: { text: string; subtitle?: string; cls: string; kbd?: string; tooltip?: string }) {
    const btn = parent.createEl("button", { cls: args.cls, type: "button" });
    if (args.subtitle) {
      const labelWrap = btn.createSpan({ cls: "learnkit-grade-btn-label-wrap learnkit-grade-btn-label-wrap" });
      labelWrap.createSpan({ cls: "learnkit-grade-btn-label learnkit-grade-btn-label", text: args.text });
      labelWrap.createSpan({ cls: "learnkit-grade-btn-subtitle learnkit-grade-btn-subtitle", text: args.subtitle });
    } else {
      btn.createSpan({ text: args.text });
    }
    btn.setAttribute("aria-label", args.tooltip || (args.kbd ? `${args.text} (${args.kbd})` : args.text));
    btn.setAttribute("data-tooltip-position", "top");
    if (args.kbd) {
      btn.createEl("kbd", { cls: "kbd ml-2", text: args.kbd });
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

      const { metrics, nextDue } = await gradeCard({
        id,
        cardType: String(card.type || "unknown"),
        rating,
        now,
        prevState: st,
        settings: this.plugin.settings,
        store: this.plugin.store,
        msToAnswer,
        meta,
      });

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

  /** Build a label row matching the study session style ("Question", "Answer", etc.) */
  private makeLabelRow(text: string, card?: CardRecord, answerSide?: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between learnkit-label-row";
    const label = document.createElement("div");
    label.className = "text-muted-foreground text-sm font-medium";
    label.textContent = text;
    row.appendChild(label);
    if (card && answerSide !== undefined) {
      this.appendTtsReplayButton(row, card, answerSide);
    }
    return row;
  }

  /** Render the question block into a section element, based on type. */
  private renderQuestionBlock(section: HTMLElement, card: CardRecord) {
    const type = String(card.type || "").toLowerCase();

    if (type === "basic" || type === "reversed" || type === "reversed-child") {
      const isBackDirection = type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
      const isOldReversed = type === "reversed";
      const qText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
      section.appendChild(this.renderMdBlock("learnkit-q", qText, card));
    } else if (type === "cloze" || type === "cloze-child") {
      this.renderClozeCard(section, card);
    } else if (type === "mcq") {
      this.renderMcqCard(section, card);
    } else if (type === "oq") {
      this.renderOqCard(section, card);
    } else if (type === "io" || type === "io-child") {
      this.renderIoCard(section, card);
    } else {
      const maybeQuestion = (card as unknown as Record<string, unknown>).q;
      const text = typeof maybeQuestion === "string" ? maybeQuestion : "(No question text)";
      section.appendChild(this.renderMdBlock("learnkit-q", text, card));
    }
  }

  /** Render the answer block into the section on reveal. */
  private renderAnswerBlock(section: HTMLElement, card: CardRecord) {
    const type = String(card.type || "").toLowerCase();

    if (type === "basic" || type === "reversed" || type === "reversed-child") {
      const isBackDirection = type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
      const isOldReversed = type === "reversed";
      const aText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
      section.appendChild(this.makeLabelRow("Answer", card, true));
      section.appendChild(this.renderMdBlock("learnkit-a", aText, card));
    } else if (type === "io" || type === "io-child") {
      // IO answer is part of the reveal render, handled inside renderIoCard
    } else {
      // cloze / mcq / oq answer reveal is handled inline by their own renders
    }
  }

  /** Render extra info block if the card has one. */
  private renderExtraInfoBlock(section: HTMLElement, card: CardRecord) {
    const infoText = this.extractInfoField(card);
    if (!infoText) return;
    section.appendChild(this.makeLabelRow("Extra information"));
    section.appendChild(this.renderMdBlock("learnkit-info", infoText, card));
  }

  /** Extract the extra-info field from a card record (mirrors reviewer logic). */
  private extractInfoField(card: CardRecord): string | null {
    if (!card) return null;
    const v = card.info;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const s = (v as unknown[]).filter((x) => typeof x === "string").join("\n").trim();
      return s || null;
    }
    return null;
  }

  /** Create a styled markdown block matching the study session pattern. */
  private renderMdBlock(cls: string, text: string, card: CardRecord): HTMLElement {
    const block = document.createElement("div");
    block.className = `bc ${cls} whitespace-pre-wrap break-words learnkit-md-block`;
    this.renderTextBlock(block, text, card);
    return block;
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
      cls: "btn-icon learnkit-tts-replay-btn",
      type: "button",
    });
    btn.setAttribute("aria-label", answerSide ? "Read answer aloud" : "Read question aloud");
    btn.setAttribute("data-tooltip-position", "top");
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      markTtsButtonActive(btn);
      this.speakCardSide(card, answerSide);
    });
    bindTtsPlayingState(btn);
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
    const cid = `${card.id}-${answerSide ? "answer" : "question"}`;

    if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
      const questionText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
      const answerText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
      tts.speakBasicCard(answerSide ? answerText : questionText, audio, cid);
      return;
    }

    if (card.type === "cloze" || card.type === "cloze-child") {
      const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;
      tts.speakClozeCard(card.clozeText || "", answerSide, targetIndex, audio, cid);
      return;
    }

    if (card.type === "mcq") {
      const options = normalizeCardOptions(card.options);
      const order = options.map((_, i) => i);
      tts.speakMcqCard(card.stem || "", options, order, answerSide, getCorrectIndices(card), audio, cid);
      return;
    }

    if (card.type === "oq") {
      const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
      const text = [card.q || "", ...steps].filter(Boolean).join(". ");
      tts.speakBasicCard(text, audio, cid);
      return;
    }

    if (card.type === "io" || card.type === "io-child") {
      tts.speakBasicCard(answerSide ? (card.a || "") : (card.q || ""), audio, cid);
    }
  }

  private renderClozeCard(body: HTMLElement, card: CardRecord) {
    const text = card.clozeText || "";
    const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : undefined;

    if (text.includes("$") || text.includes("\\(") || text.includes("\\[") || text.includes("[[") || this.hasMarkdownList(text)) {
      const clozeEl = document.createElement("div");
      clozeEl.className = "learnkit-widget-cloze learnkit-widget-text w-full whitespace-pre-wrap break-words";
      const sourcePath = String(card.sourceNotePath || "");
      const clozeMode = this.plugin.settings.cards?.clozeMode ?? "standard";
      const clozeBgColor = this.plugin.settings.cards?.clozeBgColor ?? "";
      const clozeTextColor = this.plugin.settings.cards?.clozeTextColor ?? "";
      const clozeOpts = {
        mode: clozeMode,
        clozeBgColor,
        clozeTextColor,
      };
      const processedText = processClozeForMath(text, this.reveal, targetIndex, {
        blankClassName: "learnkit-cloze-blank hidden-cloze",
        useHintText: clozeMode !== "typed",
      });
      void this.renderMarkdownInto(clozeEl, processedText, sourcePath).then(() => {
        hydrateRenderedMathCloze(clozeEl, text, this.reveal, targetIndex, clozeOpts);
      });
      body.appendChild(clozeEl);
    } else {
      const clozeMode = this.plugin.settings.cards?.clozeMode ?? "standard";
      const clozeBgColor = this.plugin.settings.cards?.clozeBgColor ?? "";
      const clozeTextColor = this.plugin.settings.cards?.clozeTextColor ?? "";

      const clozeEl = renderClozeFront(text, this.reveal, targetIndex, {
        mode: clozeMode,
        clozeBgColor,
        clozeTextColor,
      });
      clozeEl.className = "learnkit-widget-cloze learnkit-widget-text w-full";
      body.appendChild(clozeEl);
    }
  }

  private renderMcqCard(body: HTMLElement, card: CardRecord) {
    const stemText = card.stem || "";
    const sourcePath = String(card.sourceNotePath || "");
    const cardId = String(card.id || "");
    const stemEl = body.createDiv({ cls: "whitespace-pre-wrap break-words learnkit-gatekeeper-question-block learnkit-gatekeeper-question-block" });
    if (stemText.includes("$") || stemText.includes("\\(") || stemText.includes("\\[") || stemText.includes("[[") || this.hasMarkdownList(stemText)) {
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

    const optsContainer = body.createDiv({ cls: "flex flex-col gap-2 learnkit-widget-section learnkit-widget-section" });

    options.forEach((opt: string, idx: number) => {
      const d = body.ownerDocument.createElement("div");
      d.className = "px-3 py-1 rounded border border-border hover:bg-secondary learnkit-widget-text learnkit-widget-mcq-option";
      if (!this.reveal) d.classList.add("cursor-pointer");

      const left = body.ownerDocument.createElement("span");
      left.className = "inline-flex items-center gap-2 min-w-0";

      const key = body.ownerDocument.createElement("kbd");
      key.className = "kbd";
      key.textContent = String(idx + 1);
      left.appendChild(key);

      const textEl = body.ownerDocument.createElement("span");
      textEl.className = "min-w-0 whitespace-pre-wrap break-words learnkit-widget-mcq-text";
      const optText = typeof opt === "string" ? opt : "";
      if (optText.includes("$") || optText.includes("\\(") || optText.includes("\\[") || optText.includes("[[") || this.hasMarkdownList(optText)) {
        void this.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(optText), sourcePath);
      } else {
        replaceChildrenWithHTML(textEl, processMarkdownFeatures(optText));
      }
      left.appendChild(textEl);
      d.appendChild(left);

      if (!this.reveal) {
        if (isMulti) {
          if (chosenMulti.has(idx)) d.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
          d.addEventListener("click", () => {
            const current = this._mcqMultiSelection.get(cardId) ?? new Set<number>();
            if (current.has(idx)) current.delete(idx);
            else current.add(idx);
            this._mcqMultiSelection.set(cardId, current);
            this.render();
          });
        } else {
          if (chosenSingle === idx) d.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
          d.addEventListener("click", () => {
            this._mcqSingleSelection.set(cardId, idx);
            this.render();
          });
        }
      } else {
        if (isMulti) {
          const isCorrect = correctSet.has(idx);
          const wasChosen = chosenMulti.has(idx);
          if (isCorrect) d.classList.add("learnkit-mcq-correct-highlight", "learnkit-mcq-correct-highlight");
          else if (wasChosen) d.classList.add("learnkit-mcq-wrong-highlight", "learnkit-mcq-wrong-highlight");
        } else {
          if (idx === card.correctIndex) d.classList.add("learnkit-mcq-correct-highlight", "learnkit-mcq-correct-highlight");
          if (typeof chosenSingle === "number" && chosenSingle === idx && idx !== card.correctIndex) {
            d.classList.add("learnkit-mcq-wrong-highlight", "learnkit-mcq-wrong-highlight");
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
    const qEl = body.createDiv({ cls: "whitespace-pre-wrap break-words learnkit-gatekeeper-question-block learnkit-gatekeeper-question-block" });
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
      const listWrap = body.createDiv({ cls: "flex flex-col gap-2 learnkit-oq-step-list learnkit-oq-step-list" });
      const currentOrder = this._oqOrderMap[cardId].slice();

      const previewController = createOqReorderPreviewController(listWrap);

      const commitReorder = (fromIdx: number, toIdx: number) => {
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const item = currentOrder[fromIdx];
        currentOrder.splice(fromIdx, 1);
        currentOrder.splice(toIdx, 0, item);
        this._oqOrderMap[cardId] = currentOrder.slice();
        renderSteps();
      };

      listWrap.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        previewController.updatePointer(e.clientY);
      });

      listWrap.addEventListener("drop", (e) => {
        e.preventDefault();
        const pending = previewController.getPendingMove();
        previewController.endDrag();
        if (!pending) return;
        commitReorder(pending.fromIdx, pending.toIdx);
      });

      const renderSteps = () => {
        listWrap.empty();
        currentOrder.forEach((origIdx, displayIdx) => {
          const stepText = steps[origIdx] || "";
          const row = body.ownerDocument.createElement("div");
          row.className = "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 learnkit-oq-step-row";
          row.draggable = true;

          const grip = body.ownerDocument.createElement("span");
          grip.className = "learnkit-oq-grip inline-flex items-center justify-center text-muted-foreground cursor-grab";
          setIcon(grip, "grip-vertical");
          row.appendChild(grip);

          const badge = body.ownerDocument.createElement("kbd");
          badge.className = "kbd";
          badge.textContent = String(displayIdx + 1);
          row.appendChild(badge);

          const textEl = body.ownerDocument.createElement("span");
          textEl.className = "min-w-0 whitespace-pre-wrap break-words flex-1 learnkit-oq-step-text learnkit-widget-text";
          if (stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[") || stepText.includes("[[") || this.hasMarkdownList(stepText)) {
            void this.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath);
          } else {
            replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
          }
          row.appendChild(textEl);

          row.addEventListener("dragstart", (e) => {
            previewController.beginDrag({
              fromIdx: displayIdx,
              row,
              dataTransfer: e.dataTransfer,
              setDragImage: true,
            });
          });

          row.addEventListener("dragend", () => {
            previewController.endDrag();
          });

          row.addEventListener("touchstart", (e) => {
            const touch = e.touches[0];
            if (!touch) return;
            previewController.beginDrag({
              fromIdx: displayIdx,
              row,
            });
            previewController.updatePointer(touch.clientY);
          }, { passive: true });

          row.addEventListener("touchmove", (e) => {
            const touch = e.touches[0];
            if (!touch) return;
            e.preventDefault();
            previewController.updatePointer(touch.clientY);
          }, { passive: false });

          row.addEventListener("touchend", () => {
            const pending = previewController.getPendingMove();
            previewController.endDrag();
            if (!pending) return;
            commitReorder(pending.fromIdx, pending.toIdx);
          });

          row.addEventListener("touchcancel", () => {
            previewController.endDrag();
          });

          listWrap.appendChild(row);
        });
      };

      renderSteps();
      return;
    }

    body.createEl("h3", { text: "Your order", cls: "text-sm font-medium learnkit-gatekeeper-section-label learnkit-gatekeeper-section-label" });
    const answerList = body.createDiv({ cls: "flex flex-col gap-2 learnkit-oq-answer-list learnkit-oq-answer-list" });
    const identity = Array.from({ length: steps.length }, (_, i) => i);
    const userOrder = Array.isArray(this._oqOrderMap[cardId]) && this._oqOrderMap[cardId].length === steps.length
      ? this._oqOrderMap[cardId]
      : identity;

    userOrder.forEach((origIdx, displayIdx) => {
      const stepText = steps[origIdx] || "";
      const wasInCorrectPosition = origIdx === displayIdx;
      const row = body.ownerDocument.createElement("div");
      row.className = "flex items-center gap-2 rounded-lg border px-3 py-1 learnkit-oq-answer-row";
      if (wasInCorrectPosition) {
        row.classList.add("learnkit-oq-correct", "learnkit-oq-correct", "learnkit-oq-correct-highlight", "learnkit-oq-correct-highlight");
      } else {
        row.classList.add("learnkit-oq-wrong", "learnkit-oq-wrong", "learnkit-oq-wrong-highlight", "learnkit-oq-wrong-highlight");
      }

      const badge = body.ownerDocument.createElement("kbd");
      badge.className = "kbd";
      badge.textContent = String(origIdx + 1);
      row.appendChild(badge);

      const textEl = body.ownerDocument.createElement("span");
      textEl.className = "min-w-0 whitespace-pre-wrap break-words flex-1 learnkit-widget-text learnkit-oq-step-text";
      if (stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[") || stepText.includes("[[") || this.hasMarkdownList(stepText)) {
        void this.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath);
      } else {
        replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
      }
      row.appendChild(textEl);

      answerList.appendChild(row);
    });
  }

  private renderIoCard(body: HTMLElement, card: CardRecord) {
    const ioContainer = body.createDiv({ cls: "rounded border border-border bg-muted overflow-auto learnkit-widget-io-container learnkit-widget-io-container" });
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
    if (this.hasMarkdownTable(text) || this.hasMarkdownList(text) || text.includes("[[") || text.includes("$") || text.includes("\\(") || text.includes("\\[")) {
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

  private hasMarkdownList(text: string): boolean {
    return /^[ \t]*(?:[-+*]|\d+[.)])\s/m.test(String(text || ""));
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
