/**
 * widget/widget-render-session.ts
 * ────────────────────────────────
 * Renders the "session" mode of the Sprout sidebar widget – the screen
 * the user sees while studying flashcards one at a time.
 *
 * Extracted from `SproutWidgetView.renderSession` to keep the main
 * view file lean.
 */

import { setIcon } from "obsidian";

import { el } from "../core/ui";
import { renderClozeFront } from "../reviewer/question-cloze";

import { isClozeLike } from "./widget-helpers";
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

/**
 * Build and append the session-mode DOM tree into `root`.
 *
 * @param view – the `SproutWidgetView` instance (typed loosely to avoid
 *               circular imports)
 * @param root – container element to render into
 */
export function renderWidgetSession(view: any, root: HTMLElement): void {
  if (!view.session) return;
  const wrap = el("div", "bc bg-background");
  wrap.classList.add("sprout-widget", "sprout");

  // ---- Header -------------------------------------------------------
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
    view.backToSummary();
  });

  const studyingWrap = el("div", "bc flex flex-col items-start");
  const studyingScope = `${view.session?.scopeName || "Note"} ${isFolderNote(view.activeFile) ? "Folder" : "Note"}`;
  const studyingTitle = el("div", "bc text-xs", `Studying ${studyingScope}`);
  studyingTitle.style.setProperty("color", "var(--foreground)", "important");
  studyingTitle.style.setProperty("font-weight", "600", "important");

  const remainingCount = Math.max(0, (view.session?.stats.total || 0) - (view.session?.stats.done || 0));
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
  const body = el("div", "bc card px-4 py-4 flex-1 overflow-y-auto");
  body.style.setProperty("margin", "10px auto 20px auto", "important");
  body.style.setProperty("gap", "0", "important");
  body.style.setProperty("border-radius", "var(--input-radius)", "important");
  body.style.setProperty("border", "var(--border-width) solid var(--background-modifier-border)", "important");
  body.style.setProperty("padding", "20px 20px 20px 20px", "important");
  body.style.setProperty("max-width", "90%", "important");
  body.style.setProperty("box-shadow", "none", "important");

  const applySectionStyles = (e: HTMLElement) => {
    e.style.setProperty("padding", "6px 0", "important");
    e.style.setProperty("margin", "0", "important");
  };

  const makeDivider = () => {
    const hr = el("div", "bc");
    hr.style.setProperty("border-top", "1px solid var(--foreground)", "important");
    hr.style.setProperty("opacity", "0.3", "important");
    hr.style.setProperty("margin", "6px 0", "important");
    return hr;
  };

  // ---- Card title ----------------------------------------------------
  let cardTitle =
    card.title ||
    (card.type === "mcq" ? "MCQ" : isClozeLike(card) ? "Cloze" : card.type === "io" ? "Image" : "Basic");
  cardTitle = cardTitle.replace(/\s*[•·-]\s*c\d+\b/gi, "").trim();

  const titleEl = el("div", "bc text-xs font-semibold");
  titleEl.innerHTML = processMarkdownFeatures(cardTitle);
  titleEl.style.setProperty("color", "var(--foreground)", "important");
  titleEl.style.setProperty("font-size", "11px", "important");
  titleEl.style.setProperty("margin-bottom", "0", "important");
  titleEl.style.setProperty("line-height", "1.75", "important");
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
  const footer = el("div", "bc px-4 py-3 space-y-2 border-t border-border");
  footer.style.setProperty("border", "none", "important");
  footer.style.setProperty("max-width", "90%", "important");
  footer.style.setProperty("margin", "10px auto", "important");
  footer.style.setProperty("padding", "0 0 15px 0", "important");

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
  view: any,
  body: HTMLElement,
  card: any,
  graded: any,
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
    qP.innerHTML = processMarkdownFeatures(qText.replace(/\n/g, "<br>"));
    qEl.appendChild(qP);
  }
  qEl.style.lineHeight = "1.75";
  qEl.style.fontSize = "11px";
  qEl.style.setProperty("color", "var(--foreground)", "important");
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
      aP.innerHTML = processMarkdownFeatures(aText.replace(/\n/g, "<br>"));
      aEl.appendChild(aP);
    }
    aEl.style.lineHeight = "1.75";
    aEl.style.fontSize = "11px";
    aEl.style.setProperty("color", "var(--foreground)", "important");
    applySectionStyles(aEl);
    body.appendChild(aEl);

    if (infoText) {
      renderInfoBlock(body, infoText, applySectionStyles);
    }
  }
}

function renderClozeCard(
  view: any,
  body: HTMLElement,
  card: any,
  graded: any,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
  makeDivider: () => HTMLElement,
) {
  const text = card.clozeText || "";
  const reveal = view.showAnswer || !!graded;
  const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : undefined;

  if (text.includes("$") || text.includes("[[")) {
    const clozeEl = el("div", "bc sprout-widget-cloze");
    clozeEl.style.lineHeight = "1.75";
    clozeEl.style.fontSize = "11px";
    clozeEl.style.setProperty("color", "var(--foreground)", "important");
    clozeEl.style.setProperty("width", "100%", "important");
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
    renderInfoBlock(body, infoText, applySectionStyles);
  }
}

function renderMcqCard(
  view: any,
  body: HTMLElement,
  card: any,
  graded: any,
  infoText: string,
  applySectionStyles: (e: HTMLElement) => void,
  makeDivider: () => HTMLElement,
) {
  const stemEl = el("div", "bc");
  stemEl.innerHTML = processMarkdownFeatures(card.stem || "");
  stemEl.style.lineHeight = "1.75";
  stemEl.style.fontSize = "11px";
  stemEl.style.setProperty("color", "var(--foreground)", "important");
  applySectionStyles(stemEl);
  body.appendChild(stemEl);

  let opts = card.options || [];
  const chosen = graded?.meta?.mcqChoice;

  // Randomise MCQ options if setting enabled
  const randomize = !!(view.plugin.settings.reviewer?.randomizeMcqOptions);
  const order = opts.map((_: any, i: number) => i);
  if (randomize) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    opts = order.map((i: number) => opts[i]);
  }

  const optsContainer = el("div", "bc flex flex-col gap-2");
  optsContainer.style.setProperty("padding", "6px 0", "important");
  optsContainer.style.setProperty("margin", "0", "important");

  opts.forEach((opt: any, idx: number) => {
    const text = typeof opt === "string" ? opt : opt && typeof opt.text === "string" ? opt.text : "";
    const d = el("div", "bc px-3 py-2 rounded border border-border cursor-pointer hover:bg-secondary");
    d.style.lineHeight = "1.75";
    d.style.fontSize = "11px";
    d.style.setProperty("color", "var(--foreground)", "important");
    d.style.setProperty("margin-bottom", "8px", "important");

    const left = el("span", "bc inline-flex items-center gap-2 min-w-0");
    const key = el("kbd", "bc kbd");
    key.textContent = String(idx + 1);
    left.appendChild(key);

    const textEl = el("span", "bc min-w-0 whitespace-pre-wrap break-words");
    textEl.style.lineHeight = "1.75";
    textEl.style.display = "block";
    if (text && text.includes("\n")) {
      text.split(/\n+/).forEach((line: string) => {
        const p = document.createElement("div");
        p.innerHTML = processMarkdownFeatures(line);
        p.style.lineHeight = "1.75";
        p.style.marginBottom = "2px";
        textEl.appendChild(p);
      });
    } else {
      textEl.innerHTML = processMarkdownFeatures(text);
    }
    left.appendChild(textEl);
    d.appendChild(left);

    if (!graded) d.addEventListener("click", () => void view.answerMcq(idx));
    if (graded) {
      const origIdx = randomize ? order[idx] : idx;
      if (origIdx === card.correctIndex) d.classList.add("border-green-600", "bg-green-50");
      if (typeof chosen === "number" && chosen === idx && origIdx !== card.correctIndex)
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
  view: any,
  body: HTMLElement,
  card: any,
  graded: any,
  infoText: string,
  makeDivider: () => HTMLElement,
  applySectionStyles: (e: HTMLElement) => void,
) {
  const reveal = view.showAnswer || !!graded;
  const ioContainer = el("div", "bc rounded border border-border bg-muted overflow-auto");
  ioContainer.style.setProperty("width", "100%", "important");
  ioContainer.style.setProperty("padding", "0", "important");
  ioContainer.style.setProperty("margin", "6px 0", "important");
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
  const infoEl = el("div", "bc");
  const infoP = document.createElement("p");
  infoP.className = "bc whitespace-pre-wrap break-words";
  infoP.style.setProperty("margin", "0", "important");
  infoP.style.setProperty("margin-block", "0", "important");
  infoP.innerHTML = processMarkdownFeatures(infoText.replace(/\n/g, "<br>"));
  infoEl.appendChild(infoP);
  infoEl.style.lineHeight = "1.75";
  infoEl.style.fontSize = "11px";
  infoEl.style.setProperty("color", "var(--foreground)", "important");
  infoEl.style.setProperty("opacity", "0.6", "important");
  applySectionStyles(infoEl);
  body.appendChild(infoEl);
}

/* ================================================================== */
/*  Footer renderers                                                   */
/* ================================================================== */

function renderPracticeFooter(view: any, footer: HTMLElement, card: any, ioLike: boolean) {
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

function renderScheduledFooter(view: any, footer: HTMLElement, card: any, graded: any, ioLike: boolean) {
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

function renderActionRow(view: any, footer: HTMLElement, graded: any) {
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

  const canBurySuspend = view.session.mode !== "practice" && !graded;
  const moreMenu = attachWidgetMoreMenu({
    trigger: moreBtn,
    canUndo: view.session.mode !== "practice" && view.canUndo(),
    onUndo: () => void view.undoLastGrade(),
    canBurySuspend,
    onBury: () => void view.buryCurrentCard(),
    onSuspend: () => void view.suspendCurrentCard(),
    openNote: () => {
      const c = view.currentCard?.();
      if (!c) return;
      const filePath = c.sourceNotePath || view.activeFile?.path;
      if (!filePath) return;
      const anchor = c.anchor || c.blockId || c.id;
      const anchorStr = anchor ? `#^${anchor}` : "";
      void view.app.workspace.openLinkText(filePath + anchorStr, filePath, true);
    },
  });
  view._moreMenuToggle = () => moreMenu.toggle();

  footer.appendChild(actionRow);
}

function renderProgressBar(view: any, wrap: HTMLElement) {
  const progressBar = el("div", "bc px-4 py-2 border-b border-border");
  progressBar.style.setProperty("border", "none", "important");
  progressBar.style.setProperty("border-radius", "0", "important");
  progressBar.style.setProperty("margin", "0 auto", "important");
  progressBar.style.setProperty("max-width", "200px", "important");
  progressBar.style.setProperty("width", "80%", "important");

  const progressPercent = ((view.session!.index + 1) / view.session!.stats.total) * 100;
  const barBg = el("div", "bc w-full rounded-full overflow-hidden");
  barBg.style.setProperty("height", "1.5px", "important");
  barBg.style.setProperty(
    "background-color",
    "color-mix(in srgb, var(--foreground) 10%, transparent)",
    "important",
  );

  const barFill = el("div", "bc h-full transition-all");
  barFill.style.setProperty("background-color", "var(--theme-accent)", "important");
  barFill.style.width = `${progressPercent}%`;
  barBg.appendChild(barFill);
  progressBar.appendChild(barBg);
  wrap.appendChild(progressBar);
}
