/**
 * @file src/widget/widget-render-session.ts
 * @summary Renders the "session" mode of the Sprout sidebar widget — the screen the user sees while studying flashcards one at a time. Extracted from SproutWidgetView.renderSession to keep the main view file lean. Builds the card front/back DOM, wires grading buttons and keyboard shortcuts, and handles answer reveal transitions.
 *
 * @exports
 *  - renderWidgetSession — builds and mounts the session-mode DOM into the widget container
 */

import { setIcon } from "obsidian";

import { el, replaceChildrenWithHTML, setCssProps } from "../core/ui";
import { renderClozeFront } from "../reviewer/question-cloze";

import { getWidgetMcqDisplayOrder, isClozeLike } from "./widget-helpers";
import type { WidgetViewLike, ReviewMeta } from "./widget-helpers";
import type { CardRecord } from "../types/card";
import { normalizeCardOptions, getCorrectIndices, isMultiAnswerMcq } from "../types/card";
import type { ReviewRating } from "../types/scheduler";
import {
  makeTextButton,
  applyWidgetActionButtonStyles,
  applyWidgetHoverDarken,
  attachWidgetMoreMenu,
} from "./widget-buttons";
import { processMarkdownFeatures, setupInternalLinkHandlers } from "./widget-markdown";
import { isFolderNote } from "./widget-scope";

/** Returns true if the text contains a markdown table (pipe-delimited with a separator row). */
function hasMarkdownTable(text: string): boolean {
  return /^\|.+\|\s*\n\|[\s:|-]+\|/m.test(text);
}

/* ------------------------------------------------------------------ */
/*  renderWidgetSession                                                */
/* ------------------------------------------------------------------ */

function buildCardAnchorFragment(cardId: string | null | undefined): string {
  const raw = String(cardId ?? "").trim();
  if (!raw) return "";
  const cleaned = raw.startsWith("^") ? raw.slice(1) : raw;
  const normalized = cleaned.startsWith("sprout-")
    ? cleaned
    : /^\d{9}$/.test(cleaned)
      ? `sprout-${cleaned}`
      : cleaned;
  return `#^${normalized}`;
}

/**
 * Build and append the session-mode DOM tree into `root`.
 *
 * @param view – the `SproutWidgetView` instance (typed loosely to avoid
 *               circular imports)
 * @param root – container element to render into
 */
export function renderWidgetSession(view: WidgetViewLike, root: HTMLElement): void {
  if (!view.session) return;
  const wrap = el("div", "bc bg-background");
  wrap.classList.add("sprout-widget", "sprout");

  // ---- Header -------------------------------------------------------
  const header = el("div", "bc flex items-center justify-between px-4 py-3 gap-2 sprout-widget-header");

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "bc btn-outline sprout-widget-back-btn";
  backBtn.setAttribute("data-tooltip", "Back to summary");
  backBtn.setAttribute("data-tooltip-position", "top");
  setIcon(backBtn, "arrow-left");
  applyWidgetHoverDarken(backBtn);

  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.backToSummary();
  });

  const studyingWrap = el("div", "bc flex flex-col items-start mr-auto sprout-widget-header-labels");
  const studyingScope = `${view.session?.scopeName || "Note"} ${isFolderNote(view.activeFile) ? "Folder" : "Note"}`;
  const studyingTitle = el("div", "bc sprout-widget-study-label", `Studying ${studyingScope}`);

  const remainingCount = Math.max(0, (view.session?.stats.total || 0) - (view.session?.stats.done || 0));
  const remainingLabel = `${remainingCount} Card${remainingCount === 1 ? "" : "s"} Remaining`;
  const remainingLine = el("div", "bc sprout-widget-remaining-label", remainingLabel);

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
    const body = el("div", "bc px-4 py-6 text-center space-y-2");
    body.appendChild(el("div", "bc text-lg font-semibold text-foreground", "Session Complete!"));
    body.appendChild(
      el(
        "div",
        "bc text-sm text-muted-foreground",
        `Reviewed: ${view.session?.stats?.done || 0}/${view.session?.stats?.total || 0}`,
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
  const body = el("div", "bc card px-4 py-4 flex-1 overflow-y-auto sprout-widget-card-body");

  const applySectionStyles = (e: HTMLElement) => {
    e.classList.add("sprout-widget-section");
  };

  const makeDivider = () => {
    const hr = el("div", "bc sprout-widget-divider");
    return hr;
  };

  // ---- Card title ----------------------------------------------------
  let cardTitle = card.title || "";
  cardTitle = cardTitle.replace(/\s*[•·-]\s*c\d+\b/gi, "").trim();
  // Remove direction suffix (e.g., " • Q→A", " • A→Q") from reversed-child cards
  if (card.type === "reversed-child") {
    cardTitle = cardTitle.replace(/\s*•\s*[AQ]\u2192[AQ]\s*$/, "").trim();
  }

  const titleEl = el("div", "bc font-semibold sprout-widget-text");
  if (!cardTitle) titleEl.hidden = true;
  replaceChildrenWithHTML(titleEl, processMarkdownFeatures(cardTitle));
  applySectionStyles(titleEl);
  body.appendChild(titleEl);

  const infoText = String((card)?.info ?? "").trim();

  // ---- Card-type–specific content ------------------------------------
  if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child") {
    renderBasicCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  } else if (isClozeLike(card)) {
    renderClozeCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  } else if (card.type === "mcq") {
    renderMcqCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  } else if (card.type === "io" || card.type === "io-child") {
    renderIoCard(view, body, card, graded, infoText, makeDivider, applySectionStyles);
  } else if (card.type === "oq") {
    renderOqCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  }

  // Setup link handlers for processMarkdownFeatures content
  setupInternalLinkHandlers(body, view.app);
  wrap.appendChild(body);

  // ---- Footer: controls ---------------------------------------------
  const footer = el("div", "bc px-4 py-3 space-y-2 border-t border-border sprout-widget-footer");

  if (view.session.mode === "practice") {
    renderPracticeFooter(view, footer, card, ioLike);
  } else {
    renderScheduledFooter(view, footer, card, graded, ioLike);
  }

  // Edit and More menu buttons row
  renderActionRow(view, footer, graded);
  wrap.appendChild(footer);

  // ---- Progress bar --------------------------------------------------
  renderProgressBar(view, wrap);

  root.appendChild(wrap);
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
  makeDivider: () => HTMLElement,
) {
  const qEl = el("div", "bc");
  // For reversed-child cards, use reversedDirection to swap content
  const isBackDirection = card.type === "reversed-child" && (card as unknown as Record<string, unknown>).reversedDirection === "back";
  const isOldReversed = card.type === "reversed";
  const qText = (isBackDirection || isOldReversed) ? (card.a || "") : (card.q || "");
  if (qText.includes("$") || qText.includes("[[") || hasMarkdownTable(qText)) {
    const qContainer = document.createElement("div");
    qContainer.className = "bc whitespace-pre-wrap break-words";
    const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
    void view.renderMarkdownInto(qContainer, qText, sourcePath);
    qEl.appendChild(qContainer);
  } else {
    const qP = document.createElement("p");
    qP.className = "bc whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(qP, processMarkdownFeatures(qText.replace(/\n/g, "<br>")));
    qEl.appendChild(qP);
  }
  qEl.classList.add("sprout-widget-text");
  applySectionStyles(qEl);
  body.appendChild(qEl);

  if (view.showAnswer || graded) {
    body.appendChild(makeDivider());
    const aEl = el("div", "bc");
    const aText = (isBackDirection || isOldReversed) ? (card.q || "") : (card.a || "");
    if (aText.includes("$") || aText.includes("[[") || hasMarkdownTable(aText)) {
      const aContainer = document.createElement("div");
      aContainer.className = "bc whitespace-pre-wrap break-words";
      const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
      void view.renderMarkdownInto(aContainer, aText, sourcePath);
      aEl.appendChild(aContainer);
    } else {
      const aP = document.createElement("p");
      aP.className = "bc whitespace-pre-wrap break-words";
      replaceChildrenWithHTML(aP, processMarkdownFeatures(aText.replace(/\n/g, "<br>")));
      aEl.appendChild(aP);
    }
    aEl.classList.add("sprout-widget-text");
    applySectionStyles(aEl);
    body.appendChild(aEl);

    if (infoText) {
      renderInfoBlock(body, infoText, applySectionStyles, view, card);
    }
  }
}

function renderClozeCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
  makeDivider: () => HTMLElement,
) {
  const text = card.clozeText || "";
  const reveal = view.showAnswer || !!graded;
  const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : undefined;

  if (text.includes("$") || text.includes("[[") || hasMarkdownTable(text)) {
    const clozeEl = el("div", "bc sprout-widget-cloze sprout-widget-text w-full");
    applySectionStyles(clozeEl);

    const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
    let processedText = text;
    if (reveal) {
      processedText = text.replace(/\{\{c(\d+)::([^}]+)\}\}/g, (_match: string, num: string, content: string) => {
        const idx = Number(num);
        const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;
        return isTarget ? `**${content}**` : content;
      });
    } else {
      processedText = text.replace(/\{\{c(\d+)::([^}]+)\}\}/g, (_match: string, num: string, _content: string) => {
        const idx = Number(num);
        const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;
        return isTarget ? `______` : _content;
      });
    }

    void view.renderMarkdownInto(clozeEl, processedText, sourcePath);
    body.appendChild(clozeEl);
  } else {
    const clozeMode = view.plugin.settings.cards?.clozeMode ?? "standard";
    const clozeBgColor = view.plugin.settings.cards?.clozeBgColor ?? "";
    const clozeTextColor = view.plugin.settings.cards?.clozeTextColor ?? "";

    const clozeEl = renderClozeFront(text, reveal, targetIndex, {
      mode: clozeMode,
      clozeBgColor,
      clozeTextColor,
      typedAnswers: view._typedClozeAnswers,
      onTypedInput: (clozeIndex: number, value: string) => {
        view._typedClozeAnswers.set(clozeIndex, value);
      },
      onTypedSubmit: () => {
        if (!view.showAnswer) {
          view.showAnswer = true;
          view.render();
        }
      },
    });
    clozeEl.className = "bc sprout-widget-cloze sprout-widget-text w-full";
    applySectionStyles(clozeEl);
    body.appendChild(clozeEl);
  }

  if (reveal && infoText) {
    body.appendChild(makeDivider());
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
  makeDivider: () => HTMLElement,
) {
  const stemEl = el("div", "bc sprout-widget-text");
  replaceChildrenWithHTML(stemEl, processMarkdownFeatures(card.stem || ""));
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
    const hint = el("div", "bc text-muted-foreground mb-1 text-center sprout-widget-info");
    hint.textContent = "Select all correct answers";
    body.appendChild(hint);
  }

  const optsContainer = el("div", "bc flex flex-col gap-2 sprout-widget-section");

  opts.forEach((opt: string, displayIdx: number) => {
    const text = typeof opt === "string" ? opt : "";
    const d = el("div", "bc px-3 py-2 rounded border border-border cursor-pointer hover:bg-secondary sprout-widget-text sprout-widget-mcq-option");
    const origIdx = order[displayIdx];

    const left = el("span", "bc inline-flex items-center gap-2 min-w-0");
    const key = el("kbd", "bc kbd");
    key.textContent = String(displayIdx + 1);
    left.appendChild(key);

    const textEl = el("span", "bc min-w-0 whitespace-pre-wrap break-words sprout-widget-mcq-text");
    if (text && text.includes("\n")) {
      text.split(/\n+/).forEach((line: string) => {
        const p = document.createElement("div");
        replaceChildrenWithHTML(p, processMarkdownFeatures(line));
        p.classList.add("sprout-widget-mcq-line");
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
          d.classList.add("sprout-mcq-selected");
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
        // Smart highlighting for multi-answer
        const isCorrect = correctSet.has(origIdx);
        const wasChosen = chosenMulti.has(origIdx);
        if (isCorrect && wasChosen) d.classList.add("border-green-600", "bg-green-50");
        else if (isCorrect && !wasChosen) d.classList.add("sprout-mcq-missed-correct");
        else if (!isCorrect && wasChosen) d.classList.add("border-red-600", "bg-red-50");
      } else {
        if (origIdx === card.correctIndex) d.classList.add("border-green-600", "bg-green-50");
        if (typeof chosen === "number" && chosen === origIdx && origIdx !== card.correctIndex)
          d.classList.add("border-red-600", "bg-red-50");
      }
    }
    optsContainer.appendChild(d);
  });

  body.appendChild(optsContainer);

  // Submit button for multi-answer (when not graded)
  if (isMulti && !graded) {
    const submitBtn = el("button", "bc btn-primary w-full text-sm mt-2 sprout-mcq-submit-btn");

    const submitLabel = document.createElement("span");
    submitLabel.textContent = "Submit";
    submitBtn.appendChild(submitLabel);

    const submitKbd = document.createElement("kbd");
    submitKbd.className = "bc kbd ml-2";
    submitKbd.textContent = "\u21B5";
    submitBtn.appendChild(submitKbd);

    submitBtn.addEventListener("click", () => {
      if (view._mcqMultiSelected.size > 0) {
        void view.answerMcqMulti([...view._mcqMultiSelected]);
      } else {
        submitBtn.classList.add("sprout-mcq-submit-shake");
        submitBtn.addEventListener("animationend", () => {
          submitBtn.classList.remove("sprout-mcq-submit-shake");
        }, { once: true });
        // Show tooltip on second empty attempt
        if (submitBtn.dataset.emptyAttempt === "1") {
          submitBtn.setAttribute("data-tooltip", "Choose at least one answer to proceed");
          submitBtn.setAttribute("data-tooltip-position", "top");
          submitBtn.classList.add("sprout-mcq-submit-tooltip-visible");
          setTimeout(() => {
            submitBtn.classList.remove("sprout-mcq-submit-tooltip-visible");
          }, 2500);
        }
        submitBtn.dataset.emptyAttempt = String(Number(submitBtn.dataset.emptyAttempt || "0") + 1);
      }
    });
    body.appendChild(submitBtn);
  }

  if ((view.showAnswer || graded) && infoText) {
    body.appendChild(makeDivider());
    renderInfoBlock(body, infoText, applySectionStyles, view, card);
  }
}

function renderIoCard(
  view: WidgetViewLike,
  body: HTMLElement,
  card: CardRecord,
  graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null,
  infoText: string,
  makeDivider: () => HTMLElement,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const reveal = view.showAnswer || !!graded;
  const ioContainer = el("div", "bc rounded border border-border bg-muted overflow-auto sprout-widget-io-container");
  ioContainer.dataset.sproutIoWidget = "1";
  body.appendChild(ioContainer);

  const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
  void view.renderImageOcclusionInto(ioContainer, card, sourcePath, reveal);

  if (reveal && infoText) {
    body.appendChild(makeDivider());
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
  makeDivider: () => HTMLElement,
) {
  const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
  const reveal = view.showAnswer || !!graded;
  const oqMeta = (graded?.meta || {}) as Record<string, unknown>;
  const userOrder: number[] = Array.isArray(oqMeta.oqUserOrder) ? oqMeta.oqUserOrder as number[] : [];

  // Question text
  const qEl = el("div", "bc sprout-widget-text");
  const qText = card.q || "";
  if (qText.includes("$") || qText.includes("[[") || hasMarkdownTable(qText)) {
    const qContainer = document.createElement("div");
    qContainer.className = "bc whitespace-pre-wrap break-words";
    const sourcePath = String(card.sourceNotePath || view.activeFile?.path || "");
    void view.renderMarkdownInto(qContainer, qText, sourcePath);
    qEl.appendChild(qContainer);
  } else {
    const qP = document.createElement("p");
    qP.className = "bc whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(qP, processMarkdownFeatures(qText.replace(/\n/g, "<br>")));
    qEl.appendChild(qP);
  }
  applySectionStyles(qEl);
  body.appendChild(qEl);

  if (!reveal) {
    // ── Front: drag-to-reorder interface ──
    const shouldShuffle = view.plugin.settings.study?.randomizeOqOrder ?? true;
    const shuffled = getWidgetOqShuffledOrder(view.session as unknown as Record<string, unknown>, card, shouldShuffle);
    const currentOrder = shuffled.slice();

    const listWrap = el("div", "bc flex flex-col gap-2 sprout-oq-step-list");
    body.appendChild(listWrap);

    const renderSteps = () => {
      listWrap.innerHTML = "";
      currentOrder.forEach((origIdx, displayIdx) => {
        const stepText = steps[origIdx] || "";
        const row = document.createElement("div");
        row.className = "bc flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 sprout-oq-step-row";
        row.draggable = true;
        row.dataset.oqIdx = String(displayIdx);

        // Grip handle
        const grip = document.createElement("span");
        grip.className = "bc sprout-oq-grip inline-flex items-center justify-center text-muted-foreground cursor-grab";
        setIcon(grip, "grip-vertical");
        row.appendChild(grip);

        // Step number badge
        const badge = document.createElement("kbd");
        badge.className = "bc kbd";
        badge.textContent = String(displayIdx + 1);
        row.appendChild(badge);

        // Step text
        const textEl = document.createElement("span");
        textEl.className = "bc min-w-0 whitespace-pre-wrap break-words flex-1 sprout-oq-step-text sprout-widget-text";
        replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
        row.appendChild(textEl);

        // ── Drag and drop ──
        let dragOffset = 40;
        row.addEventListener("dragstart", (e) => {
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(displayIdx));
          }
          row.classList.add("sprout-oq-row-dragging");
          const allStepRows = listWrap.querySelectorAll<HTMLElement>(".sprout-oq-step-row");
          const first = allStepRows[0];
          if (first) {
            const gap = parseFloat(getComputedStyle(listWrap).rowGap || "0");
            dragOffset = Math.round(first.getBoundingClientRect().height + gap);
          }
          allStepRows.forEach((r) => {
            r.classList.add("sprout-oq-row-anim");
            setCssProps(r, "--sprout-oq-translate", "0px");
          });
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("sprout-oq-row-dragging");
          listWrap.querySelectorAll<HTMLElement>(".sprout-oq-step-row").forEach((r) => {
            setCssProps(r, "--sprout-oq-translate", "0px");
            r.classList.remove("sprout-oq-row-anim");
          });
        });
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          const fromStr = e.dataTransfer?.getData("text/plain");
          const fromIdx = fromStr ? Number(fromStr) : -1;
          if (fromIdx === -1 || fromIdx === displayIdx) return;
          listWrap.querySelectorAll<HTMLElement>(".sprout-oq-step-row").forEach((r, idx) => {
            if (idx === fromIdx) {
              setCssProps(r, "--sprout-oq-translate", `${(displayIdx - fromIdx) * dragOffset}px`);
            } else {
              let offset = 0;
              if (fromIdx < displayIdx) { if (idx > fromIdx && idx <= displayIdx) offset = -dragOffset; }
              else { if (idx >= displayIdx && idx < fromIdx) offset = dragOffset; }
              setCssProps(r, "--sprout-oq-translate", `${offset}px`);
            }
          });
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          const fromIdx = Number(e.dataTransfer?.getData("text/plain") || "-1");
          if (fromIdx === -1 || fromIdx === displayIdx) return;
          listWrap.querySelectorAll<HTMLElement>(".sprout-oq-step-row").forEach((r) => setCssProps(r, "--sprout-oq-translate", "0px"));
          const item = currentOrder[fromIdx];
          currentOrder.splice(fromIdx, 1);
          currentOrder.splice(displayIdx, 0, item);
          const oqMap = ensureWidgetOqOrderMap(view.session as unknown as Record<string, unknown>);
          oqMap[String(card.id)] = currentOrder.slice();
          renderSteps();
        });

        // Touch drag support
        let touchStartY = 0;
        let touchCurrentIdx = displayIdx;
        row.addEventListener("touchstart", (e) => {
          const touch = e.touches[0]; if (!touch) return;
          touchStartY = touch.clientY;
          touchCurrentIdx = displayIdx;
          row.classList.add("sprout-oq-row-dragging");
        }, { passive: true });
        row.addEventListener("touchmove", (e) => {
          const touch = e.touches[0]; if (!touch) return;
          e.preventDefault();
          const deltaY = touch.clientY - touchStartY;
          const moveSteps = Math.round(deltaY / dragOffset);
          const targetIdx = Math.max(0, Math.min(currentOrder.length - 1, displayIdx + moveSteps));
          listWrap.querySelectorAll<HTMLElement>(".sprout-oq-step-row").forEach((r, idx) => {
            if (idx === displayIdx) {
              setCssProps(r, "--sprout-oq-translate", `${(targetIdx - displayIdx) * dragOffset}px`);
            } else {
              let offset = 0;
              if (displayIdx < targetIdx) { if (idx > displayIdx && idx <= targetIdx) offset = -dragOffset; }
              else { if (idx >= targetIdx && idx < displayIdx) offset = dragOffset; }
              setCssProps(r, "--sprout-oq-translate", `${offset}px`);
            }
          });
          touchCurrentIdx = targetIdx;
        }, { passive: false });
        row.addEventListener("touchend", () => {
          row.classList.remove("sprout-oq-row-dragging");
          listWrap.querySelectorAll<HTMLElement>(".sprout-oq-step-row").forEach((r) => {
            setCssProps(r, "--sprout-oq-translate", "0px");
            r.classList.remove("sprout-oq-row-anim");
          });
          if (touchCurrentIdx !== displayIdx) {
            const item = currentOrder[displayIdx];
            currentOrder.splice(displayIdx, 1);
            currentOrder.splice(touchCurrentIdx, 0, item);
            const oqMap = ensureWidgetOqOrderMap(view.session as unknown as Record<string, unknown>);
            oqMap[String(card.id)] = currentOrder.slice();
            renderSteps();
          }
        });

        listWrap.appendChild(row);
      });
    };

    renderSteps();

    // Submit button
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "bc btn-outline w-full text-sm mt-2 sprout-oq-submit-btn";

    const submitLabel = document.createElement("span");
    submitLabel.textContent = "Submit order";
    submitBtn.appendChild(submitLabel);

    const submitKbd = document.createElement("kbd");
    submitKbd.className = "bc kbd ml-2";
    submitKbd.textContent = "\u21B5";
    submitBtn.appendChild(submitKbd);

    applyWidgetHoverDarken(submitBtn);
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void view.answerOq(currentOrder.slice());
    });
    body.appendChild(submitBtn);

  } else {
    // ── Back: correct order with highlights ──
    body.appendChild(makeDivider());
    const answerList = el("div", "bc flex flex-col gap-2 sprout-oq-answer-list");
    body.appendChild(answerList);

    steps.forEach((stepText, correctIdx) => {
      const wasCorrect = userOrder.length > 0 && userOrder[correctIdx] === correctIdx;
      const row = document.createElement("div");
      row.className = "bc flex items-center gap-2 rounded-lg border px-3 py-2 sprout-oq-answer-row";
      if (wasCorrect) {
        row.classList.add("sprout-oq-correct", "sprout-oq-correct-highlight");
      } else if (userOrder.length > 0) {
        row.classList.add("sprout-oq-wrong", "sprout-oq-wrong-highlight");
      }

      const badge = document.createElement("kbd");
      badge.className = "bc kbd";
      badge.textContent = String(correctIdx + 1);
      row.appendChild(badge);

      const textEl = document.createElement("span");
      textEl.className = "bc min-w-0 whitespace-pre-wrap break-words flex-1 sprout-widget-text sprout-oq-step-text";
      replaceChildrenWithHTML(textEl, processMarkdownFeatures(stepText));
      row.appendChild(textEl);

      answerList.appendChild(row);
    });

    if (infoText) {
      body.appendChild(makeDivider());
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
  view?: WidgetViewLike,
  card?: CardRecord,
) {
  const infoEl = el("div", "bc sprout-widget-info");
  if (view && hasMarkdownTable(infoText)) {
    const infoContainer = document.createElement("div");
    infoContainer.className = "bc whitespace-pre-wrap break-words";
    const sourcePath = String(card?.sourceNotePath || view.activeFile?.path || "");
    void view.renderMarkdownInto(infoContainer, infoText, sourcePath);
    infoEl.appendChild(infoContainer);
  } else {
    const infoP = document.createElement("p");
    infoP.className = "bc whitespace-pre-wrap break-words";
    replaceChildrenWithHTML(infoP, processMarkdownFeatures(infoText.replace(/\n/g, "<br>")));
    infoEl.appendChild(infoP);
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
      label: "Show Answer",
      className: "bc btn-outline w-full text-sm",
      onClick: () => {
        view.showAnswer = true;
        view.render();
        view.containerEl.focus();
      },
      kbd: "↵",
    });
    applyWidgetActionButtonStyles(revealBtn);
    footer.appendChild(revealBtn);
  } else {
    const nextBtn = makeTextButton({
      label: "Next",
      className: "bc btn-outline w-full text-sm",
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
      label: "Reveal Answer",
      className: "bc btn-outline w-full text-sm",
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
      let gradingGrid: HTMLElement;
      if (fourButton) {
        gradingGrid = el("div", "bc grid grid-cols-2 gap-2");
      } else {
        gradingGrid = el("div", "bc flex gap-2");
      }

      // Always show Again
      const againBtn = makeTextButton({
        label: "Again",
        className: fourButton ? "bc btn-outline w-full" : "bc btn-outline flex-1",
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
          label: "Hard",
          className: "bc btn-outline w-full",
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
        label: "Good",
        className: fourButton ? "bc btn-outline w-full" : "bc btn-outline flex-1",
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
          label: "Easy",
          className: "bc btn-outline w-full",
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
      const mcqNote = el("div", "bc text-muted-foreground w-full text-center sprout-widget-info");
      mcqNote.textContent = isMultiAnswerMcq(card) ? "Select all correct answers, then submit" : "Select an option";
      footer.appendChild(mcqNote);
    } else if (card.type === "oq") {
      const oqNote = el("div", "bc text-muted-foreground w-full text-center sprout-widget-info");
      oqNote.textContent = "Drag to reorder, then submit";
      footer.appendChild(oqNote);
    }
  } else {
    const nextBtn = makeTextButton({
      label: "Next",
      className: "bc btn-outline w-full text-sm",
      onClick: () => void view.nextCard(),
      kbd: "↵",
    });
    applyWidgetActionButtonStyles(nextBtn);
    footer.appendChild(nextBtn);
  }
}

function renderActionRow(view: WidgetViewLike, footer: HTMLElement, graded: { rating: ReviewRating; at: number; meta: ReviewMeta | null } | null) {
  const actionRow = el("div", "bc flex gap-2");

  const editBtn = makeTextButton({
    label: "Edit",
    className: "bc btn-outline flex-1",
    onClick: () => view.openEditModalForCurrentCard(),
    kbd: "E",
  });
  applyWidgetActionButtonStyles(editBtn);
  actionRow.appendChild(editBtn);

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "bc btn-outline flex-1 flex items-center justify-center gap-2";
  moreBtn.setAttribute("data-tooltip", "More actions (M)");
  moreBtn.setAttribute("data-tooltip-position", "top");
  applyWidgetHoverDarken(moreBtn);

  const moreText = document.createElement("span");
  moreText.textContent = "More";
  const moreKbd = document.createElement("kbd");
  moreKbd.className = "bc kbd ml-2";
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
    openNote: () => {
      const c = view.currentCard?.();
      if (!c) return;
      const filePath = c.sourceNotePath || view.activeFile?.path;
      if (!filePath) return;
      const anchorStr = buildCardAnchorFragment(c.id);
      void view.app.workspace.openLinkText(filePath + anchorStr, filePath, true);
    },
  });
  view._moreMenuToggle = () => moreMenu.toggle();

  footer.appendChild(actionRow);
}

function renderProgressBar(view: WidgetViewLike, wrap: HTMLElement) {
  const progressBar = el("div", "bc px-4 py-2 border-b border-border sprout-widget-progress");

  const progressPercent = ((view.session!.index + 1) / view.session!.stats.total) * 100;
  const barBg = el("div", "bc w-full rounded-full overflow-hidden sprout-widget-progress-track");

  const barFill = el("div", "bc h-full transition-all sprout-widget-progress-fill");
  setCssProps(barFill, "--sprout-progress", `${progressPercent}%`);
  barBg.appendChild(barFill);
  progressBar.appendChild(barBg);
  wrap.appendChild(progressBar);
}
