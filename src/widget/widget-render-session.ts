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
import type { ReviewRating } from "../types/scheduler";
import {
  makeTextButton,
  applyWidgetActionButtonStyles,
  applyWidgetHoverDarken,
  attachWidgetMoreMenu,
} from "./widget-buttons";
import { processMarkdownFeatures, setupInternalLinkHandlers } from "./widget-markdown";
import { isFolderNote } from "./widget-scope";

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
  setIcon(backBtn, "arrow-left");
  applyWidgetHoverDarken(backBtn);

  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.backToSummary();
  });

  const studyingWrap = el("div", "bc flex flex-col items-start mr-auto");
  const studyingScope = `${view.session?.scopeName || "Note"} ${isFolderNote(view.activeFile) ? "Folder" : "Note"}`;
  const studyingTitle = el("div", "bc text-xs sprout-widget-study-label", `Studying ${studyingScope}`);

  const remainingCount = Math.max(0, (view.session?.stats.total || 0) - (view.session?.stats.done || 0));
  const remainingLabel = `${remainingCount} Card${remainingCount === 1 ? "" : "s"} Remaining`;
  const remainingLine = el("div", "bc text-xs sprout-widget-remaining-label", remainingLabel);

  studyingWrap.appendChild(studyingTitle);
  studyingWrap.appendChild(remainingLine);
  header.appendChild(studyingWrap);
  header.appendChild(backBtn);
  wrap.appendChild(header);

  // ---- Empty queue (session complete) --------------------------------
  const card = view.currentCard();
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
  let cardTitle =
    card.title ||
    (card.type === "mcq" ? "MCQ" : isClozeLike(card) ? "Cloze" : card.type === "io" ? "Image" : "Basic");
  cardTitle = cardTitle.replace(/\s*[•·-]\s*c\d+\b/gi, "").trim();

  const titleEl = el("div", "bc text-xs font-semibold sprout-widget-text");
  replaceChildrenWithHTML(titleEl, processMarkdownFeatures(cardTitle));
  applySectionStyles(titleEl);
  body.appendChild(titleEl);

  const infoText = String((card)?.info ?? "").trim();

  // ---- Card-type–specific content ------------------------------------
  if (card.type === "basic") {
    renderBasicCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  } else if (isClozeLike(card)) {
    renderClozeCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  } else if (card.type === "mcq") {
    renderMcqCard(view, body, card, graded, infoText, applySectionStyles, makeDivider);
  } else if (card.type === "io" || card.type === "io-child") {
    renderIoCard(view, body, card, graded, infoText, makeDivider, applySectionStyles);
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
  const qText = card.q || "";
  if (qText.includes("$") || qText.includes("[[")) {
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
    const aText = card.a || "";
    if (aText.includes("$") || aText.includes("[[")) {
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
      renderInfoBlock(body, infoText, applySectionStyles);
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

  if (text.includes("$") || text.includes("[[")) {
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
    const clozeEl = renderClozeFront(text, reveal, targetIndex);
    clozeEl.className = "bc sprout-widget-cloze sprout-widget-text w-full";
    applySectionStyles(clozeEl);
    body.appendChild(clozeEl);
  }

  if (reveal && infoText) {
    body.appendChild(makeDivider());
    renderInfoBlock(body, infoText, applySectionStyles);
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

  const options = Array.isArray(card.options) ? card.options : [];
  const chosen = graded?.meta?.mcqChoice;

  // Randomise MCQ options if setting enabled (stable per session)
  const randomize = !!(view.plugin.settings.reviewer?.randomizeMcqOptions);
  const order = getWidgetMcqDisplayOrder(view.session, card, randomize);
  const opts = order.map((i) => options[i]);

  const optsContainer = el("div", "bc flex flex-col gap-2 sprout-widget-section");

  opts.forEach((opt: string, displayIdx: number) => {
    const text = typeof opt === "string" ? opt : opt && typeof (opt as Record<string, unknown>).text === "string" ? (opt as Record<string, unknown>).text as string : "";
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

    if (!graded) d.addEventListener("click", () => void view.answerMcq(origIdx));
    if (graded) {
      if (origIdx === card.correctIndex) d.classList.add("border-green-600", "bg-green-50");
      if (typeof chosen === "number" && chosen === origIdx && origIdx !== card.correctIndex)
        d.classList.add("border-red-600", "bg-red-50");
    }
    optsContainer.appendChild(d);
  });

  body.appendChild(optsContainer);

  if ((view.showAnswer || graded) && infoText) {
    body.appendChild(makeDivider());
    renderInfoBlock(body, infoText, applySectionStyles);
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
    renderInfoBlock(body, infoText, applySectionStyles);
  }
}

/* ================================================================== */
/*  Info block helper                                                  */
/* ================================================================== */

function renderInfoBlock(
  body: HTMLElement,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const infoEl = el("div", "bc sprout-widget-info");
  const infoP = document.createElement("p");
  infoP.className = "bc whitespace-pre-wrap break-words";
  replaceChildrenWithHTML(infoP, processMarkdownFeatures(infoText.replace(/\n/g, "<br>")));
  infoEl.appendChild(infoP);
  applySectionStyles(infoEl);
  body.appendChild(infoEl);
}

/* ================================================================== */
/*  Footer renderers                                                   */
/* ================================================================== */

function renderPracticeFooter(view: WidgetViewLike, footer: HTMLElement, card: CardRecord, ioLike: boolean) {
  if ((card.type === "basic" || isClozeLike(card) || ioLike) && !view.showAnswer) {
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
  if ((card.type === "basic" || isClozeLike(card) || ioLike) && !view.showAnswer && !graded) {
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
    if ((card.type === "basic" || isClozeLike(card) || ioLike) && view.showAnswer) {
      const fourButton = !!view.plugin.settings.reviewer.fourButtonMode;
      let gradingGrid: HTMLElement;
      if (fourButton) {
        gradingGrid = el("div", "bc grid grid-cols-2 gap-2");
      } else {
        gradingGrid = el("div", "bc flex gap-2");
      }

      // Always show Again
      const againBtn = makeTextButton({
        label: "Again",
        className: fourButton ? "bc btn-outline text-xs w-full" : "bc btn-outline text-xs flex-1",
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
          className: "bc btn-outline text-xs w-full",
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
        className: fourButton ? "bc btn-outline text-xs w-full" : "bc btn-outline text-xs flex-1",
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
          className: "bc btn-outline text-xs w-full",
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
      const mcqNote = el("div", "bc text-xs text-muted-foreground w-full text-center");
      mcqNote.textContent = "Select an option";
      footer.appendChild(mcqNote);
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
    className: "bc btn-outline flex-1 text-xs",
    onClick: () => view.openEditModalForCurrentCard(),
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
