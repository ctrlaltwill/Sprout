/**
 * @file src/widget/widget-render-summary.ts
 * @summary Renders the "summary" mode of the Sprout sidebar widget — the screen the user sees before starting a study session. Extracted from SproutWidgetView.renderSummary to keep the main view file lean. Displays card counts, due-card statistics, and the "Start Studying" button.
 *
 * @exports
 *  - renderWidgetSummary — builds and mounts the summary-mode DOM into the widget container
 */

import { MS_DAY } from "../core/constants";
import { el } from "../core/ui";

import { toTitleCase } from "./widget-helpers";
import type { WidgetViewLike } from "./widget-helpers";
import { makeTextButton, applyWidgetActionButtonStyles } from "./widget-buttons";
import { isFolderNote, getCardsInActiveScope, computeCounts, folderNotesAsDecksEnabled } from "./widget-scope";

/* ------------------------------------------------------------------ */
/*  renderWidgetSummary                                                */
/* ------------------------------------------------------------------ */

/**
 * Build and append the summary-mode DOM tree into `root`.
 *
 * @param view – the `SproutWidgetView` instance (typed loosely to avoid
 *               circular imports)
 * @param root – container element to render into
 */
export function renderWidgetSummary(view: WidgetViewLike, root: HTMLElement): void {
  const wrap = el("div", "bc bg-background");
  wrap.classList.add("sprout-widget", "sprout");

  const f = view.activeFile;
  const noteName = f ? f.basename : "No note open";

  const cards = f ? getCardsInActiveScope(view.plugin.store, f, view.plugin.settings) : [];
  const counts = computeCounts(cards, view.plugin.store);

  // Header: study title with open button
  const header = el("div", "bc flex items-center justify-between px-4 py-3 gap-2 sprout-widget-summary-header");

  // Create title (not a button)
  const isFolder = isFolderNote(f);
  const titleText = noteName.replace(/\.md$/, ""); // Remove .md extension
  const titleCased = toTitleCase(titleText);

  const summaryLabelWrap = el("div", "bc flex flex-col items-start");
  const summaryScope = titleCased;
  const summaryTitle = el("div", "bc text-xs sprout-widget-summary-title", `Study ${summaryScope}`);
  summaryLabelWrap.appendChild(summaryTitle);

  const remainingCount = counts.total;
  const remainingLabel = `${remainingCount} Flashcard${remainingCount === 1 ? "" : "s"}`;
  const remainingLine = el("div", "bc text-xs sprout-widget-remaining-line", remainingLabel);
  summaryLabelWrap.appendChild(remainingLine);

  header.appendChild(summaryLabelWrap);

  if (!f) {
    const body = el("div", "bc px-4 py-6 text-center");
    const msg = el("div", "bc text-muted-foreground text-sm", "Open a note to see flashcards.");
    body.appendChild(msg);
    wrap.appendChild(body);
    root.appendChild(wrap);
    return;
  }

  wrap.appendChild(header);

  if (!cards.length) {
    const body = el("div", "bc px-4 py-6 sprout-widget-empty-body");
    const folderDecksEnabled = folderNotesAsDecksEnabled(view.plugin.settings);

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
  const teaser = el("div", "bc card px-4 py-4 space-y-3 sprout-widget-teaser");

  const teaserTitle = el("div", "bc text-xs font-semibold sprout-widget-teaser-title", titleCased);
  teaser.appendChild(teaserTitle);

  const previewSession = view.buildSessionForActiveNote();
  const queueCount = previewSession?.queue?.length ?? 0;
  const events = view.plugin.store.getAnalyticsEvents?.() ?? [];
  const nowMs = Date.now();
  const weekAgo = nowMs - 7 * MS_DAY;
  let timeTotalMs = 0;
  let timeCount = 0;
  for (const ev of events) {
    if (!ev || ev.kind !== "review") continue;
    const at = Number(ev.at);
    if (!Number.isFinite(at) || at < weekAgo) continue;
    const ms = Number(ev.msToAnswer);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    timeTotalMs += ms;
    timeCount += 1;
  }
  const avgMs = timeCount > 0 ? timeTotalMs / timeCount : 60_000;
  const roundedAvgMs = Math.ceil(avgMs / 10_000) * 10_000;
  const estTotalMs = queueCount * roundedAvgMs;
  const estMinutes = queueCount > 0 ? Math.max(1, Math.round(estTotalMs / 60_000)) : 0;
  const dueLabel = queueCount > 0 ? `${queueCount} Cards Due` : "No Cards Due";
  const countsLine = el("div", "bc text-xs sprout-widget-counts-line", `${dueLabel}  •  ${counts.total} Cards Total`);
  teaser.appendChild(countsLine);

  if (queueCount > 0) {
    const timeLine = el("div", "bc text-xs sprout-widget-info-line", `Estimated Time: ${estMinutes} min`);
    teaser.appendChild(timeLine);
  } else {
    const practiceLine = el(
      "div",
      "bc text-xs",
      "Would you like to start a practice session? This won't count towards card scheduling and you cannot bury cards or undo answers in this mode.",
    );
    practiceLine.classList.add("sprout-widget-info-line");
    teaser.appendChild(practiceLine);
  }

  wrap.appendChild(teaser);

  // Footer: Study button
  const footer = el("div", "bc px-4 py-3 flex gap-2 sprout-widget-summary-footer");
  const studyLabel = queueCount > 0 ? "Start Studying" : "Start A Practice Session";
  const studyBtn = makeTextButton({
    label: studyLabel,
    className: "bc btn-outline w-full text-xs flex items-center justify-center gap-2",
    onClick: () => (queueCount > 0 ? view.startSession() : view.startPracticeSession()),
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
