/**
 * @file src/widget/widget-render-summary.ts
 * @summary Renders the "summary" mode of the Sprout sidebar widget — the screen the user sees before starting a study session. Extracted from SproutWidgetView.renderSummary to keep the main view file lean. Displays card counts, due-card statistics, and the "Start Studying" button.
 *
 * @exports
 *  - renderWidgetSummary — builds and mounts the summary-mode DOM into the widget container
 */
import { MS_DAY } from "../../../platform/core/constants";
import { el } from "../../../platform/core/ui";
import { toTitleCase } from "../core/widget-helpers";
import { makeTextButton, applyWidgetActionButtonStyles } from "../ui/widget-buttons";
import { isFolderNote, getCardsInActiveScope, computeCounts, folderNotesAsDecksEnabled } from "../scope/scope-helpers";
import { t } from "../../../platform/translations/translator";
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
export function renderWidgetSummary(view, root) {
    var _a, _b, _c, _d, _e;
    const tx = (token, fallback, vars) => { var _a, _b; return t((_b = (_a = view.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars); };
    const wrap = el("div", "bg-background");
    wrap.classList.add("learnkit-widget", "learnkit-widget", "learnkit", "learnkit");
    const f = view.activeFile;
    const noteName = f ? f.basename : tx("ui.widget.summary.noNoteOpen", "No note open");
    const cards = f ? getCardsInActiveScope(view.plugin.store, f, view.plugin.settings) : [];
    const counts = computeCounts(cards, view.plugin.store);
    // Header: study title with open button
    const header = el("div", "sprout-widget-summary-header");
    // Create title (not a button)
    const isFolder = isFolderNote(f);
    const folderDecksEnabled = folderNotesAsDecksEnabled(view.plugin.settings);
    const studyingAsFolder = isFolder && folderDecksEnabled;
    const titleText = noteName.replace(/\.md$/, ""); // Remove .md extension
    const titleCased = toTitleCase(titleText);
    const summaryLabelWrap = el("div", "sprout-widget-summary-labels");
    const learnWord = tx("ui.widget.summary.headerLearn", "Learn");
    const kitWord = tx("ui.widget.summary.headerKit", "Kit");
    const summaryTitle = el("div", "sprout-widget-summary-title", `${learnWord}${kitWord}`);
    summaryLabelWrap.appendChild(summaryTitle);
    const scopeKind = studyingAsFolder
        ? tx("ui.widget.scope.folder", "Folder")
        : tx("ui.widget.scope.note", "Note");
    const remainingLabel = tx("ui.widget.summary.studyScopeWithKind", "Study {scope} {kind}", {
        scope: titleText,
        kind: scopeKind,
    });
    const remainingLine = el("div", "sprout-widget-remaining-line", remainingLabel);
    summaryLabelWrap.appendChild(remainingLine);
    header.appendChild(summaryLabelWrap);
    if (!f) {
        const body = el("div", "px-4 py-6 text-center");
        const msg = el("div", "text-muted-foreground text-sm", tx("ui.widget.summary.openNote", "Open a note to see flashcards."));
        body.appendChild(msg);
        wrap.appendChild(body);
        root.appendChild(wrap);
        return;
    }
    wrap.appendChild(header);
    if (!cards.length) {
        const body = el("div", "text-center rounded-none mx-[10px] px-[5px] py-[15px]");
        let msg = tx("ui.widget.summary.noFlashcardsInNote", "No flashcards found in this note.");
        if (isFolder && folderDecksEnabled) {
            msg = tx("ui.widget.summary.noFlashcardsInFolder", "No flashcards found in this note or folder.");
        }
        else if (isFolder && !folderDecksEnabled) {
            msg = tx("ui.widget.summary.enableFolderDecks", "No flashcards found. Enable 'Treat folder notes as decks' in settings.");
        }
        const msgEl = el("div", "sprout-widget-empty-message", msg);
        body.appendChild(msgEl);
        wrap.appendChild(body);
        root.appendChild(wrap);
        return;
    }
    // Teaser card: summary + next up preview
    const teaser = el("div", "sprout-widget-teaser");
    const teaserTitle = el("div", "sprout-widget-teaser-title", titleCased);
    teaser.appendChild(teaserTitle);
    const previewSession = view.buildSessionForActiveNote();
    const queueCount = (_b = (_a = previewSession === null || previewSession === void 0 ? void 0 : previewSession.queue) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    const events = (_e = (_d = (_c = view.plugin.store).getAnalyticsEvents) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : [];
    const nowMs = Date.now();
    const weekAgo = nowMs - 7 * MS_DAY;
    let timeTotalMs = 0;
    let timeCount = 0;
    for (const ev of events) {
        if (!ev || ev.kind !== "review")
            continue;
        const at = Number(ev.at);
        if (!Number.isFinite(at) || at < weekAgo)
            continue;
        const ms = Number(ev.msToAnswer);
        if (!Number.isFinite(ms) || ms <= 0)
            continue;
        timeTotalMs += ms;
        timeCount += 1;
    }
    const avgMs = timeCount > 0 ? timeTotalMs / timeCount : 60000;
    const roundedAvgMs = Math.ceil(avgMs / 10000) * 10000;
    const estTotalMs = queueCount * roundedAvgMs;
    const estMinutes = queueCount > 0 ? Math.max(1, Math.round(estTotalMs / 60000)) : 0;
    const dueLabel = queueCount > 0
        ? tx("ui.widget.summary.cardsDue", "{count} Cards Due", { count: queueCount })
        : tx("ui.widget.summary.noCardsDue", "No Cards Due");
    const countsLine = el("div", "sprout-widget-counts-line", `${dueLabel}  •  ${counts.total} Cards Total`);
    teaser.appendChild(countsLine);
    if (queueCount > 0) {
        const timeLine = el("div", "sprout-widget-info-line", tx("ui.widget.summary.estimatedTime", "Estimated Time: {minutes} min", { minutes: estMinutes }));
        teaser.appendChild(timeLine);
    }
    else {
        const practiceLine = el("div", "sprout-widget-info-line", tx("ui.widget.summary.practicePrompt", "Would you like to start a practice session? This won't count towards card scheduling and you cannot bury cards or undo answers in this mode."));
        teaser.appendChild(practiceLine);
    }
    wrap.appendChild(teaser);
    // Footer: Study button
    const footer = el("div", "sprout-widget-summary-footer");
    const studyLabel = queueCount > 0
        ? tx("ui.widget.summary.startStudying", "Start Studying")
        : tx("ui.widget.summary.startPractice", "Start A Practice Session");
    const studyBtn = makeTextButton({
        label: studyLabel,
        className: "learnkit-btn-toolbar sprout-widget-btn sprout-widget-btn-full",
        onClick: () => (queueCount > 0 ? view.startSession() : view.startPracticeSession()),
    });
    applyWidgetActionButtonStyles(studyBtn);
    const studyKbd = document.createElement("kbd");
    studyKbd.className = "kbd sprout-widget-kbd";
    studyKbd.textContent = "↵";
    studyBtn.appendChild(studyKbd);
    footer.appendChild(studyBtn);
    wrap.appendChild(footer);
    root.appendChild(wrap);
}
