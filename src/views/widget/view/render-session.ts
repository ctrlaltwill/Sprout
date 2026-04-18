/**
 * @file src/widget/widget-render-session.ts
 * @summary Renders the "session" mode of the Sprout sidebar widget — the screen the user sees while studying flashcards one at a time. Extracted from SproutWidgetView.renderSession to keep the main view file lean. Builds the card front/back DOM, wires grading buttons and keyboard shortcuts, and handles answer reveal transitions.
 *
 * @exports
 *  - renderWidgetSession — builds and mounts the session-mode DOM into the widget container
 */

import { setIcon } from "obsidian";

import { createOqReorderPreviewController } from "../../../platform/core/oq-reorder-preview";
import { el, replaceChildrenWithHTML, setCssProps } from "../../../platform/core/ui";
import { renderClozeFront } from "../../reviewer/question-cloze";

import { getWidgetMcqDisplayOrder, isClozeLike } from "../core/widget-helpers";
import type { WidgetViewLike, ReviewMeta } from "../core/widget-helpers";
import type { CardRecord } from "../../../platform/types/card";
import { normalizeCardOptions, getCorrectIndices, isMultiAnswerMcq } from "../../../platform/types/card";
import type { ReviewRating } from "../../../platform/types/scheduler";
import {
  makeTextButton,
  applyWidgetActionButtonStyles,
  applyWidgetHoverDarken,
  attachWidgetMoreMenu,
} from "../ui/widget-buttons";
import { processMarkdownFeatures, setupInternalLinkHandlers } from "./markdown";
import { openCardAnchorInNote } from "../../../platform/core/open-card-anchor";
import { processClozeForMath, textContainsMath, convertInlineDisplayMath, forceSingleLineDisplayMathInline } from "../../../platform/core/shared-utils";
import { MarkdownView } from "obsidian";
import { getTtsService } from "../../../platform/integrations/tts/tts-service";
import { shouldSkipBackAutoplay } from "../../../platform/integrations/tts/autoplay-policy";
import { t } from "../../../platform/translations/translator";
import { getRatingIntervalPreview } from "../../../platform/core/grade-intervals";

const tx = (
  view: WidgetViewLike,
  token: string,
  fallback: string,
  vars?: Record<string, string | number>,
) => t(view.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);

/** Returns true if the text contains a markdown table (pipe-delimited with a separator row). */
function hasMarkdownTable(text: string): boolean {
  return /^\|.+\|\s*\n\|[\s:|-]+\|/m.test(text);
}

/** Returns true if the text contains a markdown list (unordered or ordered). */
function hasMarkdownList(text: string): boolean {
  return /^[ \t]*(?:[-+*]|\d+[.)])\s/m.test(text);
}

const QUESTION_NUMBER_WORDS: string[] = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
  "Twenty",
];

function toQuestionOrdinalWord(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  return QUESTION_NUMBER_WORDS[safe] ?? String(safe);
}

function pageNameFromSourcePath(sourcePath: string): string {
  const clean = String(sourcePath || "").trim().replace(/\\/g, "/");
  if (!clean) return "Page";
  const leaf = clean
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .pop() || "";
  const noExt = leaf.replace(/\.md$/i, "").trim();
  return noExt || "Page";
}

function questionNumberWithinNote(view: WidgetViewLike, card: CardRecord): number {
  const currentId = String(card.id || "");
  const sourcePath = String(card.sourceNotePath || "").trim().toLowerCase();
  if (!sourcePath) return 1;

  const noteCards = (view.session?.queue || [])
    .filter((entry) => String(entry?.sourceNotePath || "").trim().toLowerCase() === sourcePath)
    .slice()
    .sort((a, b) => {
      const lineDelta = (Number(a?.sourceStartLine) || 0) - (Number(b?.sourceStartLine) || 0);
      if (lineDelta !== 0) return lineDelta;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });

  const idx = noteCards.findIndex((entry) => String(entry?.id || "") === currentId);
  return idx >= 0 ? idx + 1 : 1;
}

function fallbackWidgetTitle(view: WidgetViewLike, card: CardRecord): string {
  const page = pageNameFromSourcePath(String(card.sourceNotePath || view.activeFile?.path || ""));
  const questionWord = toQuestionOrdinalWord(questionNumberWithinNote(view, card));
  return `${page} \u2013 Question ${questionWord}`;
}

/* ------------------------------------------------------------------ */
/*  renderWidgetSession                                                */
/* ------------------------------------------------------------------ */

/**
 * Build and append the session-mode DOM tree into `root`.
 *
 * @param view – the `SproutWidgetView` instance (typed loosely to avoid
 *               circular imports)
 * @param root – container element to render into
 */
export function renderWidgetSession(view: WidgetViewLike, root: HTMLElement): void {
  if (!view.session) return;
  const wrap = el("div", "bg-background");
  wrap.classList.add("learnkit-widget", "learnkit-widget", "learnkit", "learnkit");
  // ---- Header -------------------------------------------------------
  const header = el("div", "sprout-widget-header");

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "learnkit-widget-back-btn";
  setIcon(backBtn, "arrow-left");
  applyWidgetHoverDarken(backBtn);

  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.backToSummary();
  });

  const studyingWrap = el("div", "sprout-widget-header-labels");
  const scopeLabel = view.session?.scopeType === "folder"
    ? tx(view, "ui.widget.scope.folder", "Folder")
    : tx(view, "ui.widget.scope.note", "Note");
  const studyingScope = `${view.session?.scopeName || tx(view, "ui.widget.scope.note", "Note")} ${scopeLabel}`;
  const studyingTitle = el("div", "sprout-widget-study-label", tx(view, "ui.widget.studyingScope", "Studying {scope}", { scope: studyingScope }));

  const remainingCount = Math.max(0, (view.session?.stats.total || 0) - (view.session?.stats.done || 0));
  const remainingLabel = tx(view, "ui.widget.remainingCards", "{count} Card{suffix} Remaining", {
    count: remainingCount,
    suffix: remainingCount === 1 ? "" : "s",
  });
  const remainingLine = el("div", "sprout-widget-remaining-label", remainingLabel);

  studyingWrap.appendChild(studyingTitle);
  studyingWrap.appendChild(remainingLine);
  header.appendChild(studyingWrap);
  header.appendChild(backBtn);
  wrap.appendChild(header);

  // ---- Empty queue (session complete) --------------------------------
  const card = view.currentCard();

  // Reset typed cloze answers when a new card is shown
  const cardId = String((card)?.id ?? "");
  if (view._typedClozeCardId !== cardId) {
    view._typedClozeAnswers.clear();
    view._typedClozeCardId = cardId;
  }

  if (!card) {
    const body = el("div", "px-4 py-6 text-center space-y-2");
    body.appendChild(
      el(
        "div",
        "text-lg font-semibold text-foreground sprout-widget-session-complete-title",
        tx(view, "ui.widget.sessionComplete", "Session Complete!"),
      ),
    );
    body.appendChild(
      el(
        "div",
        "text-sm text-muted-foreground sprout-widget-session-complete-meta",
        tx(view, "ui.widget.reviewedProgress", "Reviewed: {done}/{total}", {
          done: view.session?.stats?.done || 0,
          total: view.session?.stats?.total || 0,
        }),
      ),
    );
    wrap.appendChild(body);
    root.appendChild(wrap);
    view.clearTimer();
    return;
  }

  const id = String(card.id);
  const ioLike = card.type === "io" || card.type === "io-child";

  // Track timing for this card
  if (!view._timing || view._timing.cardId !== id) {
    view._timing = { cardId: id, startedAt: Date.now() };
  }

  const graded = view.session?.graded[id] || null;

  // ---- Body: card content -------------------------------------------
  const body = el("div", "card sprout-widget-card-body");

  const applySectionStyles = (e: HTMLElement) => {
    e.classList.add("learnkit-widget-section", "learnkit-widget-section");
  };

  // ---- Card title ----------------------------------------------------
  let cardTitle = card.title || "";
  cardTitle = cardTitle.replace(/\s*[•·-]\s*c\d+\b/gi, "").trim();
  // Remove direction suffix (e.g., " • Q→A", " • A→Q") from reversed-child cards
  if (card.type === "reversed-child") {
    cardTitle = cardTitle.replace(/\s*•\s*[AQ]\u2192[AQ]\s*$/, "").trim();
  }
  // Hide title if it is just the card-type label (not a real user-provided title)
  const TYPE_LABELS = new Set(["basic", "basic (reversed)", "cloze", "multiple choice", "image occlusion", "ordered question", "flashcard"]);
  if (TYPE_LABELS.has(cardTitle.toLowerCase())) cardTitle = "";

  const titleText = cardTitle || fallbackWidgetTitle(view, card);
  const titleEl = el("div", "sprout-widget-note-title sprout-widget-text learnkit-widget-section");
  replaceChildrenWithHTML(titleEl, processMarkdownFeatures(titleText));
  applySectionStyles(titleEl);
  wrap.appendChild(titleEl);
  setupInternalLinkHandlers(titleEl, view.app);

  const infoText = String((card)?.info ?? "").trim();

  // ---- Card-type–specific content ------------------------------------
  if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
    renderBasicCard(view, body, card, graded, infoText, applySectionStyles);
  } else if (isClozeLike(card)) {
    renderClozeCard(view, body, card, graded, infoText, applySectionStyles);
  } else if (card.type === "mcq") {
    renderMcqCard(view, body, card, graded, infoText, applySectionStyles);
  } else if (card.type === "io" || card.type === "io-child") {
    renderIoCard(view, body, card, graded, infoText, applySectionStyles);
  } else if (card.type === "oq") {
    renderOqCard(view, body, card, graded, infoText, applySectionStyles);
  }

  // Setup link handlers for processMarkdownFeatures content
  setupInternalLinkHandlers(body, view.app);
  wrap.appendChild(body);

  // ---- Footer: controls ---------------------------------------------
  const footer = el("div", "sprout-widget-footer");

  if (view.session.mode === "practice") {
    renderPracticeFooter(view, footer, card, ioLike);
  } else {
    renderScheduledFooter(view, footer, card, graded, ioLike);
  }

  // Edit and More menu buttons row
  renderActionRow(view, footer, card, graded);
  wrap.appendChild(footer);

  // ---- Progress bar --------------------------------------------------
  renderProgressBar(view, wrap);

  root.appendChild(wrap);

  maybeAutoSpeakWidgetCard(view, card, graded);
  view.armTimer();
}

/* ================================================================== */
/*  Card-type renderers (private to this module)                       */
/* ================================================================== */

function renderBasicCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const qActions = el("div", "flex items-center justify-end gap-2");
  appendWidgetTtsReplayButton(view, qActions, card, graded, false);
  if (qActions.childElementCount > 0) body.appendChild(qActions);

  const qEl = el("div", "widget-question");
  const questionLabel = document.createElement("div");
  questionLabel.className = "sprout-widget-question-label";
  questionLabel.textContent = tx(view, "ui.widget.label.question", "Question:");
  qEl.appendChild(questionLabel);

  // For reversed-child cards, use reversedDirection to swap content
  const isBackDirection = card.type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
  const isOldReversed = card.type === "reversed";
  const qText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
  if (qText.includes("$") || qText.includes("[[") || qText.includes("\\(") || qText.includes("\\[") || hasMarkdownTable(qText) || hasMarkdownList(qText)) {
    const qContainer = document.createElement("div");
    qContainer.className = "whitespace-pre-wrap break-words";
    const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
    void view.renderMarkdownInto(qContainer, convertInlineDisplayMath(qText), sourcePath);
    qEl.appendChild(qContainer);
  } else {
    const qDiv = document.createElement("div");
    qDiv.className = "whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(qDiv, processMarkdownFeatures(qText.replace(/\n/g, "<br>")));
    qEl.appendChild(qDiv);
  }
  qEl.classList.add("learnkit-widget-text", "learnkit-widget-text");
  applySectionStyles(qEl);
  body.appendChild(qEl);

  if (view.showAnswer || graded) {
    const aActions = el("div", "flex items-center justify-end gap-2");
    appendWidgetTtsReplayButton(view, aActions, card, graded, true);
    if (aActions.childElementCount > 0) body.appendChild(aActions);

    const aEl = el("div", "widget-answer");
    const answerLabel = document.createElement("div");
    answerLabel.className = "sprout-widget-answer-label";
    answerLabel.textContent = tx(view, "ui.widget.label.answer", "Answer:");
    aEl.appendChild(answerLabel);

    const rawAnswerText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
    const aText = rawAnswerText.trim().replace(/^\s*Answer:\s*/i, "");
    if (aText.includes("$") || aText.includes("[[") || aText.includes("\\(") || aText.includes("\\[") || hasMarkdownTable(aText) || hasMarkdownList(aText)) {
      const aContainer = document.createElement("div");
      aContainer.className = "whitespace-pre-wrap break-words";
      const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
      void view.renderMarkdownInto(aContainer, convertInlineDisplayMath(aText), sourcePath);
      aEl.appendChild(aContainer);
    } else {
      const aDiv = document.createElement("div");
      aDiv.className = "whitespace-pre-wrap break-words";
      replaceChildrenWithHTML(aDiv, processMarkdownFeatures(aText.replace(/\n/g, "<br>")));
      aEl.appendChild(aDiv);
    }
    aEl.classList.add("learnkit-widget-text", "learnkit-widget-text");
    applySectionStyles(aEl);
    body.appendChild(aEl);

    if (infoText) {
      renderInfoBlock(body, infoText, applySectionStyles, view, card);
    }
  }
}

function isWidgetTtsEnabled(view: WidgetViewLike): boolean {
  const audio = view.plugin.settings.audio;
  if (!audio?.enabled) return false;
  if ((audio as Record<string, unknown>).widgetReplay === false) return false;
  return getTtsService().isSupported;
}

function appendWidgetTtsReplayButton(
  view: WidgetViewLike,
  parent: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  answerSide: boolean,
): void {
  if (!isWidgetTtsEnabled(view)) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon learnkit-tts-replay-btn";
  btn.setAttribute("aria-label", answerSide ? "Read answer aloud" : "Read question aloud");
  btn.setAttribute("data-tooltip-position", "top");
  setIcon(btn, "volume-2");
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    speakWidgetCard(view, card, graded, answerSide);
  });
  parent.appendChild(btn);
}

function renderClozeCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const text = card.clozeText || "";
  const reveal = view.showAnswer || !!graded;
  const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : undefined;
  const clozeLabelText = reveal
    ? tx(view, "ui.widget.label.answer", "Answer:")
    : tx(view, "ui.widget.label.question", "Question:");
  const clozeSectionClass = reveal ? "widget-answer" : "widget-question";

  if (text.includes("$") || text.includes("\\(") || text.includes("\\[") || text.includes("[[") || hasMarkdownTable(text) || hasMarkdownList(text)) {
    const clozeEl = el("div", `sprout-widget-cloze sprout-widget-text w-full ${clozeSectionClass}`);
    const clozeLabel = document.createElement("div");
    clozeLabel.className = reveal ? "sprout-widget-answer-label" : "sprout-widget-question-label";
    clozeLabel.textContent = clozeLabelText;
    clozeEl.appendChild(clozeLabel);

    const clozeContent = document.createElement("div");
    clozeEl.appendChild(clozeContent);
    applySectionStyles(clozeEl);

    const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
    const processedText = processClozeForMath(text, reveal, targetIndex);

    void view.renderMarkdownInto(clozeContent, processedText, sourcePath);
    body.appendChild(clozeEl);
  } else {
    const clozeMode = view.plugin.settings.cards?.clozeMode ?? "standard";
    const clozeBgColor = view.plugin.settings.cards?.clozeBgColor ?? "";
    const clozeTextColor = view.plugin.settings.cards?.clozeTextColor ?? "";
    const hasMath = textContainsMath(text);

    const clozeEl = renderClozeFront(text, reveal, targetIndex, {
      mode: hasMath ? "standard" : clozeMode,
      clozeBgColor,
      clozeTextColor,
      typedAnswers: view._typedClozeAnswers,
      onTypedInput: (answerKey: string, _clozeIndex: number, value: string) => {
        view._typedClozeAnswers.set(answerKey, value);
      },
      onTypedSubmit: () => {
        if (!view.showAnswer) {
          view.showAnswer = true;
          view.render();
        }
      },
    });
    const clozeLabel = document.createElement("div");
    clozeLabel.className = reveal ? "sprout-widget-answer-label" : "sprout-widget-question-label";
    clozeLabel.textContent = clozeLabelText;
    clozeEl.prepend(clozeLabel);

    clozeEl.className = `learnkit-widget-cloze learnkit-widget-text w-full ${clozeSectionClass}`;
    applySectionStyles(clozeEl);
    body.appendChild(clozeEl);
  }

  if (reveal && infoText) {
    renderInfoBlock(body, infoText, applySectionStyles, view, card);
  }
}

function renderMcqCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const stemText = card.stem || "";
  const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
  const stemEl = el("div", "sprout-widget-text widget-question");
  const mcqQuestionLabel = document.createElement("div");
  mcqQuestionLabel.className = "sprout-widget-question-label";
  mcqQuestionLabel.textContent = tx(view, "ui.widget.label.question", "Question:");
  stemEl.appendChild(mcqQuestionLabel);
  if (stemText.includes("$") || stemText.includes("\\(") || stemText.includes("\\[") || stemText.includes("[[")) {
    const stemContent = document.createElement("div");
    stemContent.className = "whitespace-pre-wrap break-words";
    void view.renderMarkdownInto(stemContent, convertInlineDisplayMath(stemText), sourcePath);
    stemEl.appendChild(stemContent);
  } else {
    const stemContent = document.createElement("div");
    stemContent.className = "whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(stemContent, processMarkdownFeatures(stemText));
    stemEl.appendChild(stemContent);
  }
  applySectionStyles(stemEl);
  body.appendChild(stemEl);

  const options = normalizeCardOptions(card.options);
  const chosen = graded?.meta?.mcqChoice;
  const chosenMulti: Set<number> = graded?.meta?.mcqChoices
    ? new Set(graded.meta.mcqChoices as number[])
    : new Set<number>();
  const isMulti = isMultiAnswerMcq(card);
  const correctSet = new Set(getCorrectIndices(card));

  // Randomise MCQ options if setting enabled (stable per session)
  const randomize = !!(view.plugin.settings.study?.randomizeMcqOptions);
  const order = getWidgetMcqDisplayOrder(view.session, card, randomize);
  const opts = order.map((i) => options[i]);

  // Multi-answer: track selection state
  if (isMulti && view._mcqMultiCardId !== String(card.id)) {
    view._mcqMultiSelected = new Set<number>();
    view._mcqMultiCardId = String(card.id);
  }

  // Label for multi-answer
  if (isMulti && !graded) {
    const hint = el("div", "sprout-widget-info sprout-widget-mcq-hint");
    hint.textContent = tx(view, "ui.widget.mcq.selectAllCorrect", "Select all correct answers");
    body.appendChild(hint);
  }

  const optsContainer = el("div", "sprout-widget-section sprout-widget-mcq-options");

  const mcqSectionLabel = document.createElement("div");
  mcqSectionLabel.className = (view.showAnswer || graded) ? "sprout-widget-answer-label" : "sprout-widget-question-label";
  mcqSectionLabel.textContent = (view.showAnswer || graded)
    ? tx(view, "ui.widget.label.answer", "Answer:")
    : tx(view, "ui.widget.label.options", "Options:");
  optsContainer.appendChild(mcqSectionLabel);

  const mcqOptionsList = el("div", "sprout-widget-mcq-options-list");

  opts.forEach((opt: string, displayIdx: number) => {
    const text = typeof opt === "string" ? opt : "";
    const d = el("div", "sprout-widget-text sprout-widget-mcq-option");
    const origIdx = order[displayIdx];

    const left = el("span", "sprout-widget-mcq-option-content");
    const key = el("kbd", "kbd");
    key.textContent = String(displayIdx + 1);
    left.appendChild(key);

    const textEl = el("span", "sprout-widget-mcq-text");
    if (text && (text.includes("$") || text.includes("\\(") || text.includes("\\[") || text.includes("[["))) {
      void view.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(text), sourcePath);
    } else if (text && text.includes("\n")) {
      text.split(/\n+/).forEach((line: string) => {
        const p = document.createElement("div");
        replaceChildrenWithHTML(p, processMarkdownFeatures(line));
        p.classList.add("learnkit-widget-mcq-line", "learnkit-widget-mcq-line");
        textEl.appendChild(p);
      });
    } else {
      replaceChildrenWithHTML(textEl, processMarkdownFeatures(text));
    }
    left.appendChild(textEl);
    d.appendChild(left);

    if (!graded) {
      if (isMulti) {
        // Multi-answer: toggle selection on click
        if (view._mcqMultiSelected.has(origIdx)) {
          d.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
        }
        d.addEventListener("click", () => {
          if (view._mcqMultiSelected.has(origIdx)) view._mcqMultiSelected.delete(origIdx);
          else view._mcqMultiSelected.add(origIdx);
          view.render();
        });
      } else {
        d.addEventListener("click", () => void view.answerMcq(origIdx));
      }
    }
    if (graded) {
      if (isMulti) {
        // Multi-answer highlighting on reveal:
        // - Any correct option is green
        // - Any incorrect selected option is red
        const isCorrect = correctSet.has(origIdx);
        const wasChosen = chosenMulti.has(origIdx);
        if (isCorrect) d.classList.add("learnkit-mcq-correct-highlight", "learnkit-mcq-correct-highlight");
        else if (wasChosen) d.classList.add("learnkit-mcq-wrong-highlight", "learnkit-mcq-wrong-highlight");
      } else {
        if (origIdx === card.correctIndex) d.classList.add("learnkit-mcq-correct-highlight", "learnkit-mcq-correct-highlight");
        if (typeof chosen === "number" && chosen === origIdx && origIdx !== card.correctIndex)
          d.classList.add("learnkit-mcq-wrong-highlight", "learnkit-mcq-wrong-highlight");
      }
    }
    mcqOptionsList.appendChild(d);
  });

  optsContainer.appendChild(mcqOptionsList);
  body.appendChild(optsContainer);

  // Submit button for multi-answer (when not graded)
  if (isMulti && !graded) {
    const submitBtn = el("button", "btn-primary sprout-widget-btn sprout-widget-btn-full sprout-mcq-submit-btn");

    const submitLabel = document.createElement("span");
    submitLabel.textContent = tx(view, "ui.widget.submit", "Submit");
    submitBtn.appendChild(submitLabel);

    const submitKbd = document.createElement("kbd");
    submitKbd.className = "kbd sprout-widget-kbd";
    submitKbd.textContent = "\u21B5";
    submitBtn.appendChild(submitKbd);

    submitBtn.addEventListener("click", () => {
      if (view._mcqMultiSelected.size > 0) {
        void view.answerMcqMulti([...view._mcqMultiSelected]);
      } else {
        submitBtn.classList.add("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
        submitBtn.addEventListener("animationend", () => {
          submitBtn.classList.remove("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
        }, { once: true });
        // Show tooltip on second empty attempt
        if (submitBtn.dataset.emptyAttempt === "1") {
          submitBtn.setAttribute("aria-label", tx(view, "ui.widget.mcq.chooseOne", "Choose at least one answer to proceed"));
          submitBtn.setAttribute("data-tooltip-position", "top");
          submitBtn.classList.add("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
          setTimeout(() => {
            submitBtn.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
          }, 2500);
        }
        submitBtn.dataset.emptyAttempt = String(Number(submitBtn.dataset.emptyAttempt || "0") + 1);
      }
    });
    body.appendChild(submitBtn);
  }

  if ((view.showAnswer || graded) && infoText) {
    renderInfoBlock(body, infoText, applySectionStyles, view, card);
  }
}

function renderIoCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const reveal = view.showAnswer || !!graded;

  // Label switches from "Question:" to "Answer:" on reveal
  const sectionClass = reveal ? "widget-answer" : "widget-question";
  const qEl = el("div", sectionClass);
  const ioLabel = document.createElement("div");
  ioLabel.className = (reveal ? "sprout-widget-answer-label" : "sprout-widget-question-label") + " sprout-widget-io-label";
  ioLabel.textContent = reveal
    ? tx(view, "ui.widget.label.answer", "Answer:")
    : tx(view, "ui.widget.label.question", "Question:");
  qEl.appendChild(ioLabel);

  const ioContainer = el("div", "rounded border border-border bg-muted overflow-auto sprout-widget-io-container");
  ioContainer.dataset.sproutIoWidget = "1";
  qEl.appendChild(ioContainer);
  qEl.classList.add("learnkit-widget-text");
  applySectionStyles(qEl);
  body.appendChild(qEl);

  const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
  void view.renderImageOcclusionInto(ioContainer, card, sourcePath, reveal);

  if (reveal && infoText) {
    renderInfoBlock(body, infoText, applySectionStyles, view, card);
  }
}

/* ================================================================== */
/*  OQ (Ordering Question) renderer                                    */
/* ================================================================== */

/** Ensure session has an oqOrderMap, typed loosely to avoid extending the Session type. */
function ensureWidgetOqOrderMap(session: Record<string, unknown>): Record<string, number[]> {
  if (!session.oqOrderMap || typeof session.oqOrderMap !== "object") session.oqOrderMap = {};
  return session.oqOrderMap as Record<string, number[]>;
}

function shuffleInPlace(a: number[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
}

function getWidgetOqShuffledOrder(session: Record<string, unknown>, card: CardRecord, enabled: boolean): number[] {
  const steps = card?.oqSteps || [];
  const n = Array.isArray(steps) ? steps.length : 0;
  const identity = Array.from({ length: n }, (_, i) => i);
  if (!session || !n) return identity;
  const id = String(card?.id ?? "");
  if (!id) return identity;

  const map = ensureWidgetOqOrderMap(session);
  if (!enabled) {
    map[id] = identity;
    return identity;
  }

  const next = identity.slice();
  shuffleInPlace(next);
  if (n >= 2) {
    let same = true;
    for (let i = 0; i < n; i++) if (next[i] !== i) { same = false; break; }
    if (same) { const tmp = next[0]; next[0] = next[1]; next[1] = tmp; }
  }
  map[id] = next;
  return next;
}

function renderOqCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
  const reveal = view.showAnswer || !!graded;
  const oqMeta = (graded?.meta || {}) as Record<string, unknown>;
  const userOrder: number[] = Array.isArray(oqMeta.oqUserOrder) ? oqMeta.oqUserOrder as number[] : [];
  const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");

  // Question text
  const qEl = el("div", "sprout-widget-text widget-question");
  const oqQuestionLabel = document.createElement("div");
  oqQuestionLabel.className = "sprout-widget-question-label";
  oqQuestionLabel.textContent = tx(view, "ui.widget.label.question", "Question:");
  qEl.appendChild(oqQuestionLabel);
  const qText = card.q || "";
  if (qText.includes("$") || qText.includes("\\(") || qText.includes("\\[") || qText.includes("[[") || hasMarkdownTable(qText) || hasMarkdownList(qText)) {
    const qContainer = document.createElement("div");
    qContainer.className = "whitespace-pre-wrap break-words";
    void view.renderMarkdownInto(qContainer, convertInlineDisplayMath(qText), sourcePath);
    qEl.appendChild(qContainer);
  } else {
    const qDiv = document.createElement("div");
    qDiv.className = "whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(qDiv, processMarkdownFeatures(qText.replace(/\n/g, "<br>")));
    qEl.appendChild(qDiv);
  }
  applySectionStyles(qEl);
  body.appendChild(qEl);

  if (!reveal) {
    // ── Front: drag-to-reorder interface ──
    const shouldShuffle = view.plugin.settings.study?.randomizeOqOrder ?? true;
    const shuffled = getWidgetOqShuffledOrder(view.session as unknown as Record<string, unknown>, card, shouldShuffle);
    const currentOrder = shuffled.slice();

    const orderSection = el("div", "sprout-widget-text");
    applySectionStyles(orderSection);

    const orderLabel = document.createElement("div");
    orderLabel.className = "sprout-widget-question-label";
    orderLabel.textContent = tx(view, "ui.widget.label.order", "Order:");
    orderSection.appendChild(orderLabel);

    const listWrap = el("div", "flex flex-col gap-2 sprout-oq-step-list");
    orderSection.appendChild(listWrap);

    body.appendChild(orderSection);

    const previewController = createOqReorderPreviewController(listWrap);

    const commitReorder = (fromIdx: number, toIdx: number) => {
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      const item = currentOrder[fromIdx];
      currentOrder.splice(fromIdx, 1);
      currentOrder.splice(toIdx, 0, item);
      const oqMap = ensureWidgetOqOrderMap(view.session as unknown as Record<string, unknown>);
      oqMap[String(card.id)] = currentOrder.slice();
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
      listWrap.innerHTML = "";
      currentOrder.forEach((origIdx, displayIdx) => {
        const stepText = steps[origIdx] || "";
        const row = document.createElement("div");
        row.className = "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 learnkit-oq-step-row";
        row.draggable = true;
        row.dataset.oqIdx = String(displayIdx);

        // Grip handle
        const grip = document.createElement("span");
        grip.className = "learnkit-oq-grip inline-flex items-center justify-center text-muted-foreground cursor-grab";
        setIcon(grip, "grip-vertical");
        row.appendChild(grip);

        // Step number badge
        const badge = document.createElement("kbd");
        badge.className = "kbd";
        badge.textContent = String(displayIdx + 1);
        row.appendChild(badge);

        // Step text
        const textEl = document.createElement("span");
        textEl.className = "min-w-0 whitespace-pre-wrap break-words flex-1 learnkit-oq-step-text learnkit-widget-text";
        if (stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[") || stepText.includes("[[")) {
          void view.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath);
        } else {
          replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
        }
        row.appendChild(textEl);

        // ── Drag and drop ──
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

        // Touch drag support
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

  } else {
    // ── Back: user order with highlights ──
    const answerSection = el("div", "sprout-widget-text");
    applySectionStyles(answerSection);

    const oqAnswerLabel = document.createElement("div");
    oqAnswerLabel.className = "sprout-widget-answer-label";
    oqAnswerLabel.textContent = tx(view, "ui.widget.label.answer", "Answer:");
    answerSection.appendChild(oqAnswerLabel);

    const answerList = el("div", "flex flex-col gap-2 sprout-oq-answer-list");
    answerSection.appendChild(answerList);

    const identity = Array.from({ length: steps.length }, (_, i) => i);
    const displayOrder = userOrder.length === steps.length ? userOrder : identity;

    displayOrder.forEach((origIdx, displayIdx) => {
      const stepText = steps[origIdx] || "";
      const wasCorrect = origIdx === displayIdx;
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 rounded-lg border px-3 py-1 learnkit-oq-answer-row";
      if (wasCorrect) {
        row.classList.add("learnkit-oq-correct", "learnkit-oq-correct", "learnkit-oq-correct-highlight", "learnkit-oq-correct-highlight");
      } else {
        row.classList.add("learnkit-oq-wrong", "learnkit-oq-wrong", "learnkit-oq-wrong-highlight", "learnkit-oq-wrong-highlight");
      }

      const badge = document.createElement("kbd");
      badge.className = "kbd";
      badge.textContent = String(origIdx + 1);
      row.appendChild(badge);

      const textEl = document.createElement("span");
      textEl.className = "min-w-0 whitespace-pre-wrap break-words flex-1 learnkit-widget-text learnkit-oq-step-text";
      if (stepText.includes("$") || stepText.includes("\\(") || stepText.includes("\\[") || stepText.includes("[[")) {
        void view.renderMarkdownInto(textEl, forceSingleLineDisplayMathInline(stepText), sourcePath);
      } else {
        replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
      }
      row.appendChild(textEl);

      answerList.appendChild(row);
    });

    body.appendChild(answerSection);

    if (infoText) {
      renderInfoBlock(body, infoText, applySectionStyles, view, card);
    }
  }
}

/* ================================================================== */
/*  Info block helper                                                  */
/* ================================================================== */

function renderInfoBlock(
  body: HTMLElement,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
  view: WidgetViewLike,
  card?: CardRecord,
) {
  const infoEl = el("div", "sprout-widget-info sprout-widget-extra-info widget-information");
  const rawInfoText = infoText.trim();
  const normalizedInfoText = rawInfoText.replace(/^\s*Extra Information:\s*/i, "");

  const infoLabel = document.createElement("div");
  infoLabel.className = "sprout-widget-extra-info-label";
  infoLabel.textContent = tx(view, "ui.widget.label.extraInformation", "Extra Information:");
  infoEl.appendChild(infoLabel);

  if (view && (hasMarkdownTable(normalizedInfoText) || hasMarkdownList(normalizedInfoText))) {
    const infoContainer = document.createElement("div");
    infoContainer.className = "whitespace-pre-wrap break-words";
    const sourcePath = String(card?.sourceNotePath || view.activeFile?.path || "");
    void view.renderMarkdownInto(infoContainer, normalizedInfoText, sourcePath);
    infoEl.appendChild(infoContainer);
  } else {
    const infoDiv = document.createElement("div");
    infoDiv.className = "whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(infoDiv, processMarkdownFeatures(normalizedInfoText.replace(/\n/g, "<br>")));
    infoEl.appendChild(infoDiv);
  }
  applySectionStyles(infoEl);
  body.appendChild(infoEl);
}

/* ================================================================== */
/*  Footer renderers                                                   */
/* ================================================================== */

function renderPracticeFooter(view: WidgetViewLike, footer: HTMLElement, card: CardRecord, ioLike: boolean) {
  if ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) && !view.showAnswer) {
    const revealBtn = makeTextButton({
      label: tx(view, "ui.widget.showAnswer", "Show Answer"),
      className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
      onClick: () => {
        view.showAnswer = true;
        view.render();
        view.containerEl.focus();
      },
      kbd: "↵",
    });
    applyWidgetActionButtonStyles(revealBtn);
    footer.appendChild(revealBtn);
  } else if (card.type === "oq" && !view.showAnswer) {
    const oqSubmitBtn = makeTextButton({
      label: tx(view, "ui.widget.oq.submitOrder", "Submit order"),
      className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
      onClick: () => {
        const oqMap = ensureWidgetOqOrderMap(view.session as unknown as Record<string, unknown>);
        const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
        const currentOrder = oqMap[String(card.id)] || Array.from({ length: steps.length }, (_, i) => i);
        void view.answerOq(currentOrder.slice());
      },
      kbd: "\u21B5",
    });
    applyWidgetActionButtonStyles(oqSubmitBtn);
    footer.appendChild(oqSubmitBtn);
  } else if (card.type === "mcq" && !view.showAnswer) {
    // MCQ: no footer button on front — user progresses by selecting an option
  } else {
    const nextBtn = makeTextButton({
      label: tx(view, "ui.widget.next", "Next"),
      className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
      onClick: () => void view.nextCard(),
      kbd: "↵",
    });
    applyWidgetActionButtonStyles(nextBtn);
    footer.appendChild(nextBtn);
  }
}

function renderScheduledFooter(view: WidgetViewLike, footer: HTMLElement, card: CardRecord, graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null, ioLike: boolean) {
  // Reveal button (for basic/cloze when hidden)
  if ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) && !view.showAnswer && !graded) {
    const revealBtn = makeTextButton({
      label: tx(view, "ui.widget.revealAnswer", "Reveal Answer"),
      className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
      onClick: () => {
        view.showAnswer = true;
        view.render();
        view.containerEl.focus();
      },
      kbd: "↵",
    });
    applyWidgetActionButtonStyles(revealBtn);
    footer.appendChild(revealBtn);
  }

  // Grading buttons row – 2×2 grid layout (Again+Hard, Good+Easy)
  if (!graded) {
    if ((card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) && view.showAnswer) {
      const fourButton = !!view.plugin.settings.study.fourButtonMode;
      const showIntervals = !!view.plugin.settings.study.showGradeIntervals;
      const previewNow = Date.now();
      const previewState = showIntervals
        ? view.plugin.store.ensureState(String(card.id), previewNow)
        : null;
      const getSubtitle = (rating: ReviewRating): string | undefined => {
        if (!previewState || !showIntervals) return undefined;
        return (
          getRatingIntervalPreview({
            state: previewState,
            rating,
            now: previewNow,
            scheduling: view.plugin.settings.scheduling,
          }) ?? undefined
        );
      };
      let gradingGrid: HTMLElement;
      if (fourButton) {
        gradingGrid = el("div", "sprout-widget-grading-grid");
      } else {
        gradingGrid = el("div", "sprout-widget-grading-row");
      }

      // Always show Again
      const againBtn = makeTextButton({
        label: tx(view, "ui.widget.grade.again", "Again"),
        subtitle: getSubtitle("again"),
        title: tx(view, "ui.widget.grade.againTooltip", "Grade question as again (1)"),
        className: fourButton
          ? "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full"
          : "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-half",
        onClick: () => {
          void (async () => {
            await view.gradeCurrentRating("again", {});
            view.render();
          })();
        },
        kbd: fourButton ? "1" : "1",
      });
      applyWidgetActionButtonStyles(againBtn);
      gradingGrid.appendChild(againBtn);

      if (fourButton) {
        const hardBtn = makeTextButton({
          label: tx(view, "ui.widget.grade.hard", "Hard"),
          subtitle: getSubtitle("hard"),
          title: tx(view, "ui.widget.grade.hardTooltip", "Grade question as hard (2)"),
          className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
          onClick: () => {
            void (async () => {
              await view.gradeCurrentRating("hard", {});
              view.render();
            })();
          },
          kbd: "2",
        });
        applyWidgetActionButtonStyles(hardBtn);
        gradingGrid.appendChild(hardBtn);
      }

      // Always show Good
      const goodBtn = makeTextButton({
        label: tx(view, "ui.widget.grade.good", "Good"),
        subtitle: getSubtitle("good"),
        title: fourButton
          ? tx(view, "ui.widget.grade.goodTooltipFour", "Grade question as good (3)")
          : tx(view, "ui.widget.grade.goodTooltipTwo", "Grade question as good (2)"),
        className: fourButton
          ? "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full"
          : "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-half",
        onClick: () => {
          void (async () => {
            await view.gradeCurrentRating("good", {});
            view.render();
          })();
        },
        kbd: fourButton ? "3" : "2",
      });
      applyWidgetActionButtonStyles(goodBtn);
      gradingGrid.appendChild(goodBtn);

      if (fourButton) {
        const easyBtn = makeTextButton({
          label: tx(view, "ui.widget.grade.easy", "Easy"),
          subtitle: getSubtitle("easy"),
          title: tx(view, "ui.widget.grade.easyTooltip", "Grade question as easy (4)"),
          className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
          onClick: () => {
            void (async () => {
              await view.gradeCurrentRating("easy", {});
              view.render();
            })();
          },
          kbd: "4",
        });
        applyWidgetActionButtonStyles(easyBtn);
        gradingGrid.appendChild(easyBtn);
      }

      footer.appendChild(gradingGrid);
    } else if (card.type === "mcq") {
      const mcqNote = el("div", "text-muted-foreground w-full text-center sprout-widget-info");
      mcqNote.textContent = isMultiAnswerMcq(card)
        ? tx(view, "ui.widget.mcq.selectAllThenSubmit", "Select all correct answers, then submit")
        : tx(view, "ui.widget.mcq.selectOption", "Select an option");
      footer.appendChild(mcqNote);
    } else if (card.type === "oq") {
      const oqSubmitBtn = makeTextButton({
        label: tx(view, "ui.widget.oq.submitOrder", "Submit order"),
        className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
        onClick: () => {
          const oqMap = ensureWidgetOqOrderMap(view.session as unknown as Record<string, unknown>);
          const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
          const currentOrder = oqMap[String(card.id)] || Array.from({ length: steps.length }, (_, i) => i);
          void view.answerOq(currentOrder.slice());
        },
        kbd: "\u21B5",
      });
      applyWidgetActionButtonStyles(oqSubmitBtn);
      footer.appendChild(oqSubmitBtn);
    }
  } else {
    const nextBtn = makeTextButton({
      label: tx(view, "ui.widget.next", "Next"),
      className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
      onClick: () => void view.nextCard(),
      kbd: "↵",
    });
    applyWidgetActionButtonStyles(nextBtn);
    footer.appendChild(nextBtn);
  }
}

function speakWidgetCard(
  view: WidgetViewLike,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  forceAnswerSide?: boolean,
): void {
  const tts = getTtsService();
  const audio = view.plugin.settings.audio;
  if (!audio?.enabled || (audio as Record<string, unknown>).widgetReplay === false || !tts.isSupported) return;

  const reveal = typeof forceAnswerSide === "boolean" ? forceAnswerSide : (view.showAnswer || !!graded);
  const isBackDirection = card.type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
  const isOldReversed = card.type === "reversed";
  const cid = `${card.id}-${reveal ? "answer" : "question"}`;

  if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
    const qText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
    const aText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
    const text = reveal ? aText : qText;
    tts.speakBasicCard(text, audio, cid);
    return;
  }

  if (isClozeLike(card)) {
    const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;
    tts.speakClozeCard(card.clozeText || "", reveal, targetIndex, audio, cid);
    return;
  }

  if (card.type === "mcq") {
    const options = normalizeCardOptions(card.options);
    const randomize = !!(view.plugin.settings.study?.randomizeMcqOptions);
    const order = getWidgetMcqDisplayOrder(view.session, card, randomize);
    tts.speakMcqCard(card.stem || "", options, order, reveal, getCorrectIndices(card), audio, cid);
    return;
  }

  if (card.type === "oq") {
    const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
    const text = [card.q || "", ...steps].filter(Boolean).join(". ");
    tts.speakBasicCard(text, audio, cid);
    return;
  }

  if (card.type === "io" || card.type === "io-child") {
    const qText = card.q || "";
    const aText = card.a || "";
    tts.speakBasicCard(reveal ? aText : qText, audio, cid);
  }
}

function maybeAutoSpeakWidgetCard(view: WidgetViewLike, card: CardRecord, graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null): void {
  const audio = view.plugin.settings.audio;
  if (!audio?.enabled) return;
  if ((audio as Record<string, unknown>).widgetReplay === false) return;
  if (audio.autoplay === false) return;

  const isBack = view.showAnswer || !!graded;
  if (isBack && shouldSkipBackAutoplay(card)) return;

  const sideKey = isBack ? "back" : "front";
  const cardId = String(card.id ?? "");
  const nextKey = `${cardId}:${sideKey}`;
  if (view._lastTtsKey === nextKey) return;

  view._lastTtsKey = nextKey;
  speakWidgetCard(view, card, graded);
}

function renderActionRow(view: WidgetViewLike, footer: HTMLElement, card: CardRecord, graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null) {
  const actionRow = el("div", "sprout-widget-action-row");

  const editBtn = makeTextButton({
    label: tx(view, "ui.widget.edit", "Edit"),
    className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-half",
    onClick: () => view.openEditModalForCurrentCard(),
    kbd: "E",
  });
  applyWidgetActionButtonStyles(editBtn);
  actionRow.appendChild(editBtn);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-half";
  moreBtn.setAttribute("aria-label", tx(view, "ui.widget.more.tooltip", "More actions (M)"));
  moreBtn.setAttribute("data-tooltip-position", "top");
  applyWidgetHoverDarken(moreBtn);

  const moreText = document.createElement("span");
  moreText.textContent = tx(view, "ui.widget.more.label", "More");
  const moreKbd = document.createElement("kbd");
  moreKbd.className = "kbd sprout-widget-kbd";
  moreKbd.textContent = "M";
  moreBtn.appendChild(moreText);
  moreBtn.appendChild(moreKbd);
  applyWidgetActionButtonStyles(moreBtn);
  actionRow.appendChild(moreBtn);

  const canBurySuspend = view.session!.mode !== "practice" && !graded;
  const moreMenu = attachWidgetMoreMenu({
    trigger: moreBtn,
    canUndo: view.session!.mode !== "practice" && view.canUndo(),
    onUndo: () => void view.undoLastGrade(),
    canBurySuspend,
    onBury: () => void view.buryCurrentCard(),
    onSuspend: () => void view.suspendCurrentCard(),
    openStudy: () => void view.openCurrentInStudyView(),
    openNote: () => {
      const c = view.currentCard?.();
      if (!c) return;
      const isFolderScope = view.session?.scopeType === "folder";
      const filePath = (isFolderScope ? c.sourceNotePath : view.session?.scopeKey) || c.sourceNotePath || view.activeFile?.path;
      if (!filePath) return;

      if (isFolderScope) {
        void openCardAnchorInNote(view.app, filePath, String(c.id ?? ""));
        return;
      }

      const markdownLeaves = view.app.workspace.getLeavesOfType("markdown");
      const preferredLeaf = markdownLeaves.find((leaf) => {
        const markdownView = leaf.view;
        return markdownView instanceof MarkdownView && markdownView.file?.path === filePath;
      });

      void openCardAnchorInNote(view.app, filePath, String(c.id ?? ""), {
        openInNewLeaf: false,
        preferredLeaf,
      });
    },
  });
  view._moreMenuToggle = () => moreMenu.toggle();

  footer.appendChild(actionRow);
}

function renderProgressBar(view: WidgetViewLike, wrap: HTMLElement) {
  const progressBar = el("div", "sprout-widget-progress");

  const total = Math.max(0, view.session?.stats?.total || 0);
  const done = Math.max(0, view.session?.stats?.done || 0);
  const progressPercent = total > 0 ? (Math.min(done, total) / total) * 100 : 0;
  const barBg = el("div", "sprout-widget-progress-track");

  const barFill = el("div", "sprout-widget-progress-fill");
  setCssProps(barFill, "--learnkit-progress", `${progressPercent}%`);
  barBg.appendChild(barFill);
  progressBar.appendChild(barBg);
  wrap.appendChild(progressBar);
}
