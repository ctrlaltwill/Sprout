/**
 * @file src/reviewer/review-view.ts
 * @summary The main reviewer view class for Sprout. Extends Obsidian's ItemView to provide the full study experience including deck browsing, session management, card grading (FSRS-based), undo, skip, bury/suspend, practice mode, image occlusion, MCQ randomisation, Markdown rendering, and keyboard navigation.
 *
 * @exports
 *   - SproutReviewerView — ItemView subclass that manages the reviewer's lifecycle, state, rendering, and user interactions
 */
import { ItemView, Notice, TFile, setIcon, } from "obsidian";
import { MAX_CONTENT_WIDTH, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_REVIEWER } from "../../platform/core/constants";
import { log } from "../../platform/core/logger";
import { queryFirst, setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { SPROUT_HOME_CONTENT_SHELL_CLASS } from "../../platform/core/ui-classes";
import { gradeCard } from "../../platform/services/grading-service";
import { undoGrade } from "../../platform/services/undo-service";
import { buryCardAction, suspendCardAction } from "../../platform/services/card-action-service";
import { syncOneFile } from "../../platform/integrations/sync/sync-engine";
import { ParseErrorModal } from "../../platform/modals/parse-error-modal";
import { openBulkEditModalForCards } from "../../platform/modals/bulk-edit";
import { ImageOcclusionCreatorModal } from "../../platform/modals/image-occlusion-creator-modal";
import { getCorrectIndices, isMultiAnswerMcq, normalizeCardOptions } from "../../platform/types/card";
import { buildSession, getNextDueInScope } from "./session";
import { formatCountdown } from "./timers";
import { renderClozeFront } from "./question-cloze";
import { renderDeckMode } from "./render-deck";
import { renderSessionMode } from "./render-session";
import { openSproutImageZoom } from "./zoom";
import { SproutMarkdownHelper } from "./markdown-render";
import { processCircleFlagsInMarkdown, hydrateCircleFlagsInElement } from "../../platform/flags/flag-tokens";
// split-out helpers
import { isSkipEnabled, initSkipState, skipCurrentCard } from "./skip";
import { initMcqOrderState, isMcqOptionRandomisationEnabled, getMcqOptionOrder, } from "./question-mcq";
import { closeMoreMenu as closeMoreMenuImpl, } from "./more-menu";
import { logFsrsIfNeeded, logUndoIfNeeded } from "./fsrs-log";
import { renderTitleMarkdownIfNeeded } from "./title-markdown";
import { findCardBlockRangeById, buildCardBlockMarkdown } from "./markdown-block";
import { getTtsService, markTtsFieldActive } from "../../platform/integrations/tts/tts-service";
import { shouldSkipBackAutoplay } from "../../platform/integrations/tts/autoplay-policy";
import { openCardAnchorInNote } from "../../platform/core/open-card-anchor";
import { t } from "../../platform/translations/translator";
import { isParentCard } from "../../platform/core/card-utils";
import { deepClone, clampInt } from "./utilities";
import { matchesScope } from "../../engine/indexing/scope-match";
import * as IO from "../../platform/image-occlusion/image-occlusion-index";
import { isIoParentCard, isIoRevealableType, renderImageOcclusionReviewInto, } from "../../platform/image-occlusion/image-occlusion-review-render";
// ✅ shared header import (like browser.ts)
import { createViewHeader } from "../../platform/core/header";
function isFourButtonMode(plugin) {
    var _a, _b;
    return !!((_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.study) === null || _b === void 0 ? void 0 : _b.fourButtonMode);
}
export class SproutReviewerView extends ItemView {
    /** Restore keyboard focus after render() rebuilds the DOM. */
    _restoreFocus() {
        const first = this.contentEl.querySelector('button:not([disabled]), [tabindex="0"]');
        if (first)
            first.focus();
        else
            this.containerEl.focus();
    }
    _cardPassesTtsGroupFilter(card, groupFilterRaw) {
        const groupFilter = groupFilterRaw.trim().toLowerCase();
        if (!groupFilter)
            return true;
        const groups = Array.isArray(card.groups) ? card.groups : [];
        return groups.some((g) => g.trim().toLowerCase() === groupFilter);
    }
    _canUseTtsForCard(card) {
        var _a;
        if (!card)
            return false;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!(audio === null || audio === void 0 ? void 0 : audio.enabled))
            return false;
        return this._cardPassesTtsGroupFilter(card, audio.limitToGroup || "");
    }
    constructor(leaf, plugin) {
        super(leaf);
        this.mode = "deck";
        this.expanded = new Set([""]);
        this.session = null;
        this.showAnswer = false;
        this._timer = null;
        this._keysBound = false;
        this._countdownInterval = null;
        this._sessionStamp = 0;
        this._undoStack = [];
        this._firstSessionRender = true;
        this._firstDeckRender = true;
        // time-to-answer proxy
        this._timing = {
            stamp: 0,
            cardId: "",
            startedAt: 0,
        };
        this._moreOpen = false;
        this._moreWrap = null;
        this._moreMenuEl = null;
        this._moreBtnEl = null;
        this._moreOutsideBound = false;
        this._returnToCoach = false;
        // Width toggle (header action)
        // Removed: private _isWideReviewer = false; (now using plugin.isWideMode)
        this._widthToggleActionEl = null;
        this._imgMaxHeightPx = 200;
        this._md = null;
        // Add shared header instance
        this._header = null;
        this._titleStripEl = null;
        this._pendingSessionBuildOptions = null;
        this._isCoachSession = false;
        this._trackCoachProgress = false;
        this._sessionPracticeMode = false;
        this._titleTimerHostEl = null;
        this._suppressEntranceAosOnce = false;
        // Typed cloze state: stores what the user typed for each cloze occurrence on the current card
        this._typedClozeAnswers = new Map();
        this._typedClozeCardId = "";
        // TTS: track what we've already spoken to avoid duplicate reads
        this._ttsLastSpokenKey = "";
        // Multi-answer MCQ: tracks which options the user has toggled
        this._mcqMultiSelected = new Set();
        this._mcqMultiCardId = "";
        this.plugin = plugin;
    }
    tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
    }
    getViewType() {
        return VIEW_TYPE_REVIEWER;
    }
    getDisplayText() {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.reviewer.session.header.title", "Flashcards");
    }
    getIcon() {
        return "star";
    }
    _wideLabel() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const wide = this.plugin.isWideMode;
        if (this.mode === "deck") {
            return wide
                ? t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.study.wide.collapseTable", "Collapse table")
                : t((_d = (_c = this.plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.interfaceLanguage, "ui.study.wide.expandTable", "Expand table");
        }
        return wide
            ? t((_f = (_e = this.plugin.settings) === null || _e === void 0 ? void 0 : _e.general) === null || _f === void 0 ? void 0 : _f.interfaceLanguage, "ui.study.wide.collapseContent", "Collapse content")
            : t((_h = (_g = this.plugin.settings) === null || _g === void 0 ? void 0 : _g.general) === null || _h === void 0 ? void 0 : _h.interfaceLanguage, "ui.study.wide.expandContent", "Expand content");
    }
    _wideIcon() {
        return this.plugin.isWideMode ? "minimize-2" : "maximize-2";
    }
    _applyReviewerWidthMode() {
        var _a, _b;
        const root = this.contentEl;
        if (!root)
            return;
        const strip = this._titleStripEl;
        // Set data-learnkit-wide attribute on containerEl (same as browser.ts)
        if (this.plugin.isWideMode)
            this.containerEl.setAttribute("data-learnkit-wide", "1");
        else
            this.containerEl.removeAttribute("data-learnkit-wide");
        const containerWidth = (_b = (_a = this.containerEl) === null || _a === void 0 ? void 0 : _a.clientWidth) !== null && _b !== void 0 ? _b : 0;
        const hideToggle = containerWidth > 0 ? containerWidth < MAX_CONTENT_WIDTH : typeof window !== "undefined" && window.innerWidth < MAX_CONTENT_WIDTH;
        if (this._widthToggleActionEl) {
            this._widthToggleActionEl.classList.toggle("learnkit-is-hidden", hideToggle);
        }
        if (this.mode === "deck" || this.mode === "session") {
            const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
            setCssProps(root, "--lk-home-max-width", maxWidth);
            if (strip)
                setCssProps(strip, "--lk-home-max-width", maxWidth);
            setCssProps(root, "--lk-review-max-width", maxWidth);
        }
        else if (this.plugin.isWideMode) {
            setCssProps(root, "--lk-review-max-width", "100%");
            if (strip)
                setCssProps(strip, "--learnkit-view-strip-max-width", "100%");
        }
        else {
            setCssProps(root, "--lk-review-max-width", MAX_CONTENT_WIDTH_PX);
            if (strip)
                setCssProps(strip, "--learnkit-view-strip-max-width", MAX_CONTENT_WIDTH_PX);
        }
        const btn = this._widthToggleActionEl;
        if (btn) {
            const label = this._wideLabel();
            btn.setAttribute("aria-label", label);
            btn.setAttribute("title", label);
            btn.classList.toggle("is-active", this.plugin.isWideMode);
            btn.dataset.bcAction = "toggle-browser-width";
            btn.querySelectorAll(".svg-icon, svg").forEach((n) => n.remove());
            setIcon(btn, this._wideIcon());
        }
    }
    _reviewerTitleText() {
        var _a, _b, _c, _d;
        if (this._returnToCoach || this._isCoachSession) {
            return "Coach";
        }
        if (this.mode === "deck") {
            return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.reviewer.deck.title", "Flashcards");
        }
        return t((_d = (_c = this.plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.interfaceLanguage, "ui.reviewer.session.header.title", "Flashcards");
    }
    _reviewerSubtitleText() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        if (this._returnToCoach || this._isCoachSession) {
            return "Build and manage focused study plans.";
        }
        if (this.mode === "deck") {
            return this.tx("ui.reviewer.deck.subtitle.chooseDeck", "Choose a deck to start studying");
        }
        if (this.isPracticeSession()) {
            const totalPractice = Math.max(0, Number((_f = (_c = (_b = (_a = this.session) === null || _a === void 0 ? void 0 : _a.queue) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : (_e = (_d = this.session) === null || _d === void 0 ? void 0 : _d.stats) === null || _e === void 0 ? void 0 : _e.total) !== null && _f !== void 0 ? _f : 0));
            const donePractice = Math.max(0, Number((_j = (_h = (_g = this.session) === null || _g === void 0 ? void 0 : _g.stats) === null || _h === void 0 ? void 0 : _h.done) !== null && _j !== void 0 ? _j : 0));
            const remainingPractice = Math.max(0, totalPractice - donePractice);
            return this.tx("ui.reviewer.title.practiceRemaining", "{count} flashcard{suffix} left in this practice session", {
                count: remainingPractice,
                suffix: remainingPractice === 1 ? "" : "s",
            });
        }
        const total = Math.max(0, Number((_m = (_l = (_k = this.session) === null || _k === void 0 ? void 0 : _k.stats) === null || _l === void 0 ? void 0 : _l.total) !== null && _m !== void 0 ? _m : 0));
        const done = Math.max(0, Number((_q = (_p = (_o = this.session) === null || _o === void 0 ? void 0 : _o.stats) === null || _p === void 0 ? void 0 : _p.done) !== null && _q !== void 0 ? _q : 0));
        const remaining = Math.max(0, total - done + this._pendingSameDayRequeueCount());
        if (remaining === 0) {
            return this.tx("ui.reviewer.title.noneDue", "No flashcards are currently due!");
        }
        return this.tx("ui.reviewer.title.dueRemaining", "{count} due card{suffix} remaining", {
            count: remaining,
            suffix: remaining === 1 ? "" : "s",
        });
    }
    _startOfTomorrowMs(now) {
        const date = new Date(now);
        date.setHours(24, 0, 0, 0);
        return date.getTime();
    }
    _isPendingSameDayRequeue(meta) {
        return (meta === null || meta === void 0 ? void 0 : meta.sameDayRequeue) === true;
    }
    _pendingSameDayRequeueCount() {
        var _a;
        const graded = ((_a = this.session) === null || _a === void 0 ? void 0 : _a.graded) ?? {};
        let count = 0;
        for (const entry of Object.values(graded)) {
            if (entry && this._isPendingSameDayRequeue(entry.meta))
                count += 1;
        }
        return count;
    }
    _shouldRequeueSameDayAgain(rating, nextDue, now) {
        return rating === "again"
            && Number.isFinite(nextDue)
            && Number(nextDue) < this._startOfTomorrowMs(now);
    }
    _requeueCurrentCardToEnd(id) {
        var _a;
        if (!this.session)
            return null;
        const queue = this.session.queue ?? [];
        const index = Number(((_a = this.session) === null || _a === void 0 ? void 0 : _a.index) ?? 0);
        delete this.session.graded[id];
        this.session.stats.done = Object.keys(this.session.graded || {}).length;
        if (queue.length === 0)
            return null;
        if (index < 0 || index >= queue.length)
            return Math.min(index, queue.length - 1);
        if (queue.length === 1)
            return index;
        const originalLastIndex = queue.length - 1;
        const [current] = queue.splice(index, 1);
        if (!current)
            return Math.min(index, queue.length - 1);
        queue.push(current);
        if (index < originalLastIndex)
            return index;
        const nextUngradedIndex = queue.findIndex((queuedCard) => {
            var _a, _b;
            const queuedId = String(((_a = queuedCard) === null || _a === void 0 ? void 0 : _a.id) ?? "");
            return queuedId !== id && !((_b = this.session) === null || _b === void 0 ? void 0 : _b.graded[queuedId]);
        });
        return nextUngradedIndex >= 0 ? nextUngradedIndex : queue.length - 1;
    }
    _ensureTitleStrip(root) {
        var _a;
        const parent = root.parentElement;
        if (!parent)
            return;
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleTimerHostEl = null;
        const coachShellMode = this._returnToCoach || this._isCoachSession;
        const frame = createTitleStripFrame({
            root,
            stripClassName: coachShellMode
                ? "lk-home-title-strip sprout-coach-title-strip"
                : this.mode === "deck"
                    ? "lk-home-title-strip lk-review-title-strip lk-review-title-strip-deck"
                    : "lk-home-title-strip lk-review-title-strip lk-review-title-strip-session",
            rowClassName: "sprout-inline-sentence w-full flex items-center justify-between gap-[10px] lk-review-title-row",
        });
        const { strip, right, title, subtitle } = frame;
        title.textContent = this._reviewerTitleText();
        subtitle.textContent = this._reviewerSubtitleText();
        if (coachShellMode) {
            this._titleStripEl = strip;
            return;
        }
        const timerHost = document.createElement("div");
        timerHost.className = "lk-review-title-timer-host";
        right.appendChild(timerHost);
        this._titleStripEl = strip;
        this._titleTimerHostEl = timerHost;
    }
    _restoreStudySessionTimerRow(root) {
        var _a;
        const studySessionHeader = root.querySelector("[data-study-session-header]");
        const sessionHeaderLeft = (_a = studySessionHeader === null || studySessionHeader === void 0 ? void 0 : studySessionHeader.querySelector(".lk-session-header-left")) !== null && _a !== void 0 ? _a : null;
        const timerRow = root.querySelector("[data-study-session-timer-row]");
        if (!sessionHeaderLeft || !timerRow || timerRow.parentElement === sessionHeaderLeft)
            return;
        sessionHeaderLeft.appendChild(timerRow);
    }
    resetTiming() {
        this._timing = { stamp: 0, cardId: "", startedAt: 0 };
    }
    setReturnToCoach(enabled) {
        this._returnToCoach = !!enabled;
    }
    setSuppressEntranceAosOnce(enabled) {
        this._suppressEntranceAosOnce = !!enabled;
    }
    noteCardPresented(card) {
        var _a, _b, _c;
        if (!this.session)
            return;
        const stamp = this.getSessionStamp();
        const id = String((_b = (_a = (card)) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : "");
        if (!id)
            return;
        // Reset typed cloze answers when a new card is shown
        if (this._typedClozeCardId !== id) {
            this._typedClozeAnswers.clear();
            this._typedClozeCardId = id;
        }
        // If this card is already graded in-session, do not start a timer.
        if ((_c = this.session.graded) === null || _c === void 0 ? void 0 : _c[id]) {
            this._timing = { stamp, cardId: id, startedAt: 0 };
            return;
        }
        if (this._timing.stamp !== stamp || this._timing.cardId !== id) {
            this._timing = { stamp, cardId: id, startedAt: Date.now() };
        }
    }
    // ── TTS helpers ─────────────────────────────
    /**
     * Speak the front (question) side of a card if audio is enabled for that card type.
     * Gated on the autoplay setting — only fires automatically when autoplay is on.
     * Uses a dedup key so re-renders of the same front don't repeat.
     */
    _speakCardFront(card) {
        var _a;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!(audio === null || audio === void 0 ? void 0 : audio.autoplay))
            return;
        this._doSpeakFront(card);
    }
    /**
     * Speak the back (answer) side of a card if audio is enabled for that card type.
     * Called when the answer is revealed. Gated on autoplay.
     */
    _speakCardBack(card) {
        var _a;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!(audio === null || audio === void 0 ? void 0 : audio.autoplay))
            return;
        if (shouldSkipBackAutoplay(card))
            return;
        this._doSpeakBack(card);
    }
    /** Replay the front of the current card (manual, ignores autoplay). */
    _replayFront() {
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (card)
            this._doSpeakFront(card, true);
    }
    /** Replay the back of the current card (manual, ignores autoplay). */
    _replayBack() {
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (card)
            this._doSpeakBack(card, true);
    }
    /** Replay just the MCQ question stem. */
    _replayMcqQuestion() {
        var _a;
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (!card || card.type !== "mcq")
            return;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio || !this._canUseTtsForCard(card))
            return;
        tts.speakMcqStem(card.stem || "", audio, `${card.id}-question`);
    }
    /** Replay just the MCQ numbered options. */
    _replayMcqOptions() {
        var _a;
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (!card || card.type !== "mcq")
            return;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio || !this._canUseTtsForCard(card))
            return;
        const options = normalizeCardOptions(card.options);
        const order = this.session ? getMcqOptionOrder(this.plugin, this.session, card) : options.map((_, i) => i);
        tts.speakMcqOptions(options, order, audio, `${card.id}-options`);
    }
    /** Replay just the MCQ correct answer. */
    _replayMcqAnswer() {
        var _a;
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (!card || card.type !== "mcq")
            return;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio || !this._canUseTtsForCard(card))
            return;
        const options = normalizeCardOptions(card.options);
        const order = this.session ? getMcqOptionOrder(this.plugin, this.session, card) : options.map((_, i) => i);
        tts.speakMcqAnswer(options, order, getCorrectIndices(card), audio, `${card.id}-answer`);
    }
    /** Replay just the OQ question stem. */
    _replayOqQuestion() {
        var _a;
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (!card || card.type !== "oq")
            return;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio || !this._canUseTtsForCard(card))
            return;
        tts.speakOqQuestion(card.q || "", audio, `${card.id}-oq-stem`);
    }
    /** Replay just the OQ steps (unnumbered). */
    _replayOqSteps() {
        var _a;
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (!card || card.type !== "oq")
            return;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio || !this._canUseTtsForCard(card))
            return;
        const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
        const { steps: shuffled, order } = this._getOqDisplayOrder(card, steps);
        tts.speakOqSteps(shuffled, audio, `${card.id}-steps-${order.join("")}`);
    }
    /** Replay the OQ answer with correctness result. */
    _replayOqAnswer() {
        var _a, _b, _c, _d;
        const tts = getTtsService();
        if (tts.isSupported && tts.isSpeaking) {
            tts.stop();
            return;
        }
        const card = this.currentCard();
        if (!card || card.type !== "oq")
            return;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio || !this._canUseTtsForCard(card))
            return;
        const id = String(card.id);
        const graded = (_c = (_b = this.session) === null || _b === void 0 ? void 0 : _b.graded) === null || _c === void 0 ? void 0 : _c[id];
        const pass = !!((_d = graded === null || graded === void 0 ? void 0 : graded.meta) === null || _d === void 0 ? void 0 : _d.oqPass);
        const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
        tts.speakOqAnswer(steps, pass, audio, `${card.id}-answer-${pass ? "pass" : "fail"}`);
    }
    /** Return OQ steps reordered to match the shuffled display order, plus the raw order indices. */
    _getOqDisplayOrder(card, steps) {
        var _a;
        if (!this.session || !steps.length)
            return { steps, order: steps.map((_, i) => i) };
        const s = this.session;
        const order = (_a = s.oqOrderMap) === null || _a === void 0 ? void 0 : _a[String(card.id)];
        if (!Array.isArray(order) || order.length !== steps.length)
            return { steps, order: steps.map((_, i) => i) };
        return { steps: order.map((i) => steps[i]), order };
    }
    /**
     * Internal: actually speak the front of the card.
     * @param force When true, skip the dedup key check (used for replay).
     */
    _doSpeakFront(card, force = false) {
        var _a, _b, _c;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio)
            return;
        if (!this._canUseTtsForCard(card))
            return;
        const tts = getTtsService();
        if (!tts.isSupported)
            return;
        const key = `front:${card.id}`;
        if (!force && this._ttsLastSpokenKey === key)
            return;
        const cid = `${card.id}-question`;
        if (card.type === "basic" && card.q) {
            this._ttsLastSpokenKey = key;
            tts.speakBasicCard(card.q, audio, cid);
        }
        else if ((card.type === "reversed" || card.type === "reversed-child") && (card.q || card.a)) {
            this._ttsLastSpokenKey = key;
            const reversedDirection = card.reversedDirection;
            const isBackDir = card.type === "reversed-child" && reversedDirection === "back";
            const frontText = (isBackDir || card.type === "reversed") ? (card.a || "") : (card.q || "");
            tts.speakBasicCard(frontText, audio, cid);
        }
        else if ((card.type === "cloze" || card.type === "cloze-child") && card.clozeText) {
            this._ttsLastSpokenKey = key;
            const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;
            tts.speakClozeCard(card.clozeText, false, targetIndex, audio, cid);
        }
        else if (card.type === "mcq" && (card.stem || ((_b = card.options) === null || _b === void 0 ? void 0 : _b.length))) {
            this._ttsLastSpokenKey = key;
            const options = normalizeCardOptions(card.options);
            const order = this.session ? getMcqOptionOrder(this.plugin, this.session, card) : options.map((_, i) => i);
            const stem = (card.stem || "").trim();
            if (stem) {
                // Speak stem first, then chain the options after it finishes
                markTtsFieldActive(this.contentEl, "mcq-question");
                tts.speakMcqStem(stem, audio, `${card.id}-question`);
                tts.setContinuation(() => {
                    markTtsFieldActive(this.contentEl, "mcq-options");
                    tts.speakMcqOptions(options, order, audio, `${card.id}-options`);
                });
            }
            else {
                markTtsFieldActive(this.contentEl, "mcq-options");
                tts.speakMcqOptions(options, order, audio, `${card.id}-options`);
            }
        }
        else if (card.type === "oq" && (card.q || ((_c = card.oqSteps) === null || _c === void 0 ? void 0 : _c.length))) {
            this._ttsLastSpokenKey = key;
            const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
            const { steps: shuffled, order } = this._getOqDisplayOrder(card, steps);
            const orderKey = order.join("");
            const question = (card.q || "").trim();
            if (question) {
                // Speak question stem first, then chain the shuffled steps after it finishes
                markTtsFieldActive(this.contentEl, "oq-question");
                tts.speakOqQuestion(question, audio, `${card.id}-oq-stem`);
                tts.setContinuation(() => {
                    markTtsFieldActive(this.contentEl, "oq-steps");
                    tts.speakOqSteps(shuffled, audio, `${card.id}-steps-${orderKey}`);
                });
            }
            else {
                markTtsFieldActive(this.contentEl, "oq-steps");
                tts.speakOqSteps(shuffled, audio, `${card.id}-steps-${orderKey}`);
            }
        }
    }
    /**
     * Internal: actually speak the back of the card.
     * @param force When true, skip the dedup key check (used for replay).
     */
    _doSpeakBack(card, force = false) {
        var _a, _b, _c, _d, _e, _f;
        const audio = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.audio;
        if (!audio)
            return;
        if (!this._canUseTtsForCard(card))
            return;
        const tts = getTtsService();
        if (!tts.isSupported)
            return;
        const key = `back:${card.id}`;
        if (!force && this._ttsLastSpokenKey === key)
            return;
        const cid = `${card.id}-answer`;
        if (card.type === "basic" && card.a) {
            this._ttsLastSpokenKey = key;
            tts.speakBasicCard(card.a, audio, cid);
        }
        else if ((card.type === "reversed" || card.type === "reversed-child") && (card.q || card.a)) {
            this._ttsLastSpokenKey = key;
            const reversedDirection = card.reversedDirection;
            const isBackDir = card.type === "reversed-child" && reversedDirection === "back";
            const backText = (isBackDir || card.type === "reversed") ? (card.q || "") : (card.a || "");
            tts.speakBasicCard(backText, audio, cid);
        }
        else if ((card.type === "cloze" || card.type === "cloze-child") && card.clozeText) {
            this._ttsLastSpokenKey = key;
            const targetIndex = card.type === "cloze-child" ? Number(card.clozeIndex) : null;
            tts.speakClozeCard(card.clozeText, true, targetIndex, audio, cid);
        }
        else if (card.type === "mcq" && (card.stem || ((_b = card.options) === null || _b === void 0 ? void 0 : _b.length))) {
            this._ttsLastSpokenKey = key;
            const options = normalizeCardOptions(card.options);
            const order = this.session ? getMcqOptionOrder(this.plugin, this.session, card) : options.map((_, i) => i);
            tts.speakMcqAnswer(options, order, getCorrectIndices(card), audio, cid);
        }
        else if (card.type === "oq" && (card.q || ((_c = card.oqSteps) === null || _c === void 0 ? void 0 : _c.length))) {
            this._ttsLastSpokenKey = key;
            const id = String(card.id);
            const graded = (_e = (_d = this.session) === null || _d === void 0 ? void 0 : _d.graded) === null || _e === void 0 ? void 0 : _e[id];
            const pass = !!((_f = graded === null || graded === void 0 ? void 0 : graded.meta) === null || _f === void 0 ? void 0 : _f.oqPass);
            const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
            tts.speakOqAnswer(steps, pass, audio, `${cid}-${pass ? "pass" : "fail"}`);
        }
    }
    computeMsToAnswer(now, id) {
        const stamp = this.getSessionStamp();
        if (this._timing.stamp !== stamp)
            return undefined;
        if (this._timing.cardId !== id)
            return undefined;
        if (!this._timing.startedAt)
            return undefined;
        const raw = now - this._timing.startedAt;
        if (!Number.isFinite(raw) || raw <= 0)
            return undefined;
        // Hard cap: prevent pathological overcount if user walks away.
        return Math.max(0, Math.min(raw, 5 * 60 * 1000));
    }
    // -----------------------------
    // Undo
    // -----------------------------
    clearUndo() {
        this._undoStack.length = 0;
    }
    getSessionStamp() {
        var _a, _b;
        return Number((_b = (_a = this.session) === null || _a === void 0 ? void 0 : _a._bcStamp) !== null && _b !== void 0 ? _b : 0);
    }
    canUndo() {
        var _a;
        if (this.mode !== "session" || !this.session)
            return false;
        const u = this._undoStack[this._undoStack.length - 1];
        if (!u)
            return false;
        if (this.getSessionStamp() !== u.sessionStamp)
            return false;
        return !!((_a = this.session.graded) === null || _a === void 0 ? void 0 : _a[u.id]);
    }
    async undoLastGrade() {
        var _a, _b, _c, _d;
        if (this.mode !== "session" || !this.session)
            return;
        const u = this._undoStack[this._undoStack.length - 1];
        if (!u)
            return;
        if (this.getSessionStamp() !== u.sessionStamp) {
            this.clearUndo();
            this.render();
            return;
        }
        if (!((_a = this.session.graded) === null || _a === void 0 ? void 0 : _a[u.id])) {
            this.clearUndo();
            this.render();
            return;
        }
        this._undoStack.pop();
        try {
            const { fromState, toState } = await undoGrade({
                id: u.id,
                prevState: u.prevState,
                reviewLogLenBefore: u.reviewLogLenBefore,
                analyticsLenBefore: u.analyticsLenBefore,
                storeMutated: u.storeMutated,
                analyticsMutated: u.analyticsMutated,
                store: this.plugin.store,
            });
            delete this.session.graded[u.id];
            this.session.stats.done = Object.keys(this.session.graded || {}).length;
            const maxIdx = Math.max(0, Number((_c = (_b = this.session.queue) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0));
            this.session.index = clampInt(u.sessionIndex, 0, maxIdx);
            // Reset to show question (front) to allow restudying
            this.showAnswer = false;
            logUndoIfNeeded({
                id: u.id,
                cardType: u.cardType,
                ratingUndone: u.rating,
                meta: (_d = u.meta) !== null && _d !== void 0 ? _d : undefined,
                storeReverted: u.storeMutated,
                fromState,
                toState,
            });
            this.render();
        }
        catch (e) {
            log.error(`UNDO: failed`, e);
            new Notice(this.tx("ui.reviewer.notice.undoFailedConsole", "LearnKit – undo failed"));
            this.render();
        }
    }
    // -----------------------------
    // Practice session helpers
    // -----------------------------
    isPracticeSession() {
        return !!(this.session && this.session.practice);
    }
    buildPracticeQueue(scope, excludeIds) {
        var _a, _b, _c;
        const cardsObj = (((_a = this.plugin.store.data) === null || _a === void 0 ? void 0 : _a.cards) || {});
        const cards = Object.values(cardsObj);
        const out = [];
        for (const c of cards) {
            if (isParentCard(c))
                continue;
            const id = String((_c = (_b = (c)) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : "");
            if (!id)
                continue;
            if (excludeIds === null || excludeIds === void 0 ? void 0 : excludeIds.has(id))
                continue;
            const st = this.plugin.store.getState(id);
            if (st && String(st.stage || "") === "suspended")
                continue;
            if (scope.type === "group") {
                const groups = Array.isArray(c.groups) ? c.groups : [];
                if (!groups.some((g) => String(g || "") === scope.key))
                    continue;
            }
            else {
                const path = String((c).sourceNotePath || "");
                if (!path)
                    continue;
                if (!matchesScope(scope, path))
                    continue;
            }
            out.push(c);
        }
        out.sort((a, b) => {
            var _a, _b, _c, _d, _e, _f;
            const pathA = String((_a = a === null || a === void 0 ? void 0 : a.sourceNotePath) !== null && _a !== void 0 ? _a : "");
            const pathB = String((_b = b === null || b === void 0 ? void 0 : b.sourceNotePath) !== null && _b !== void 0 ? _b : "");
            const pathCmp = pathA.localeCompare(pathB);
            if (pathCmp !== 0)
                return pathCmp;
            const lineA = Number((_c = a === null || a === void 0 ? void 0 : a.sourceStartLine) !== null && _c !== void 0 ? _c : 0);
            const lineB = Number((_d = b === null || b === void 0 ? void 0 : b.sourceStartLine) !== null && _d !== void 0 ? _d : 0);
            if (lineA !== lineB)
                return lineA - lineB;
            return String((_e = a === null || a === void 0 ? void 0 : a.id) !== null && _e !== void 0 ? _e : "").localeCompare(String((_f = b === null || b === void 0 ? void 0 : b.id) !== null && _f !== void 0 ? _f : ""));
        });
        return out;
    }
    hasCardsInScope(scope) {
        const cards = this.plugin.store.getAllCards();
        for (const card of cards) {
            if (isParentCard(card))
                continue;
            if (scope.type === "group") {
                const groups = Array.isArray(card.groups) ? card.groups : [];
                if (!groups.some((g) => String(g || "") === scope.key))
                    continue;
            }
            else {
                const path = String(card.sourceNotePath || "").trim();
                if (!path)
                    continue;
                if (!matchesScope(scope, path))
                    continue;
                // Ignore stale card records whose source note no longer exists.
                const sourceFile = this.app.vault.getAbstractFileByPath(path);
                if (!(sourceFile instanceof TFile))
                    continue;
            }
            return true;
        }
        return false;
    }
    canStartPractice(scope) {
        if (!this.session)
            return false;
        if (this.isPracticeSession())
            return false;
        const card = this.currentCard();
        if (card)
            return false;
        const exclude = new Set(Object.keys(this.session.graded || {}));
        return (this.buildPracticeQueue(scope, exclude).length > 0 || this.buildPracticeQueue(scope).length > 0);
    }
    startPracticeFromCurrentScope() {
        if (!this.session)
            return;
        if (this.isPracticeSession())
            return;
        const scope = this.session.scope;
        const exclude = new Set(Object.keys(this.session.graded || {}));
        let queue = this.buildPracticeQueue(scope, exclude);
        if (!queue.length)
            queue = this.buildPracticeQueue(scope);
        if (!queue.length) {
            new Notice(this.tx("ui.reviewer.notice.noPracticeCardsInScope", "No cards available for practice in this scope."));
            return;
        }
        this.clearUndo();
        this.resetTiming();
        this.clearTimer();
        this.clearCountdown();
        closeMoreMenuImpl(this);
        const s = {
            scope,
            queue,
            index: 0,
            graded: {},
            stats: { total: queue.length, done: 0 },
        };
        s.practice = true;
        s._bcStamp = ++this._sessionStamp;
        this.mode = "session";
        this.session = s;
        this._firstSessionRender = true;
        initMcqOrderState(this.session);
        initSkipState(this.session);
        this.showAnswer = false;
        this.render();
    }
    skipPracticeCard() {
        var _a;
        if (!this.session)
            return;
        const card = this.currentCard();
        if (!card)
            return;
        const id = String((_a = card.id) !== null && _a !== void 0 ? _a : "");
        if (!id)
            return;
        if (this.session.graded[id])
            return;
        const q = this.session.queue;
        const idx = this.session.index;
        if (idx < 0 || idx >= q.length)
            return;
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
    doSkipCurrentCard(meta) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!this.session)
            return;
        const card = this.currentCard();
        if (!card)
            return;
        const id = String((_a = card.id) !== null && _a !== void 0 ? _a : "");
        if (!id)
            return;
        if (this.session.graded[id])
            return;
        try {
            const extraMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
            logFsrsIfNeeded({
                id,
                cardType: String((_b = card.type) !== null && _b !== void 0 ? _b : "unknown"),
                rating: "skip",
                meta: {
                    action: "skip",
                    via: this.isPracticeSession() ? "practice" : "review",
                    done: Number((_e = (_d = (_c = this.session) === null || _c === void 0 ? void 0 : _c.stats) === null || _d === void 0 ? void 0 : _d.done) !== null && _e !== void 0 ? _e : 0),
                    total: Number((_h = (_g = (_f = this.session) === null || _f === void 0 ? void 0 : _f.stats) === null || _g === void 0 ? void 0 : _g.total) !== null && _h !== void 0 ? _h : 0),
                    ...extraMeta,
                },
            });
        }
        catch (e) {
            log.warn("Sprout: failed to log skip", e);
        }
        if (this.isPracticeSession()) {
            this.skipPracticeCard();
            return;
        }
        void skipCurrentCard(this);
    }
    // -----------------------------
    // Markdown + IO rendering hooks
    // -----------------------------
    ensureMarkdownHelper() {
        if (this._md)
            return;
        this._md = new SproutMarkdownHelper({
            app: this.app,
            owner: this,
            maxHeightPx: this._imgMaxHeightPx,
            onZoom: (src, alt) => openSproutImageZoom(this.app, src, alt),
        });
    }
    // Used by renderSession.ts
    async renderMarkdownInto(containerEl, md, sourcePath) {
        this.ensureMarkdownHelper();
        if (!this._md)
            return;
        const withFlags = processCircleFlagsInMarkdown(md !== null && md !== void 0 ? md : "");
        await this._md.renderInto(containerEl, withFlags, sourcePath !== null && sourcePath !== void 0 ? sourcePath : "");
        hydrateCircleFlagsInElement(containerEl);
    }
    async renderImageOcclusionInto(containerEl, card, sourcePath, reveal) {
        renderImageOcclusionReviewInto({
            app: this.app,
            plugin: this.plugin,
            containerEl,
            card,
            sourcePath,
            reveal,
            ioModule: IO,
            renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
        });
        await Promise.resolve();
    }
    async onOpen() {
        this.containerEl.tabIndex = 0;
        this.ensureMarkdownHelper();
        const focusSelf = (ev) => {
            // Don't steal focus from inputs / textareas / selects / editable elements
            const t = ev === null || ev === void 0 ? void 0 : ev.target;
            if (t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.tagName === "SELECT" ||
                    t.isContentEditable ||
                    t.closest("input, textarea, select, [contenteditable]")))
                return;
            this.containerEl.focus();
        };
        this.containerEl.addEventListener("mousedown", focusSelf);
        this.containerEl.addEventListener("click", focusSelf);
        queueMicrotask(() => focusSelf());
        if (!this._keysBound) {
            this._keysBound = true;
            this.registerDomEvent(this.containerEl, "keydown", (ev) => this.handleKey(ev));
            this.registerDomEvent(window, "keydown", (ev) => this.handleKey(ev), {
                capture: true,
            });
        }
        if (!this._moreOutsideBound) {
            this._moreOutsideBound = true;
            this.registerDomEvent(document, "mousedown", (ev) => {
                if (!this._moreOpen)
                    return;
                if (!this.isActiveLeaf())
                    return;
                const t = ev.target;
                if (!t)
                    return;
                if (this._moreWrap && this._moreWrap.contains(t))
                    return;
                if (this._moreMenuEl && this._moreMenuEl.contains(t))
                    return;
                closeMoreMenuImpl(this);
            }, { capture: true });
        }
        this.render();
        await Promise.resolve();
    }
    async onClose() {
        var _a;
        this.clearTimer();
        this.clearCountdown();
        closeMoreMenuImpl(this);
        this.clearUndo();
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleStripEl = null;
        this._titleTimerHostEl = null;
        // Stop any ongoing TTS
        getTtsService().stop();
        await Promise.resolve();
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
    startCountdown(nextDue, line) {
        this.clearCountdown();
        const update = () => {
            const ms = nextDue - Date.now();
            line.textContent = this.tx("ui.reviewer.nextDueCountdown", "Next card due in: {countdown}", { countdown: formatCountdown(ms) });
        };
        update();
        this._countdownInterval = window.setInterval(update, 1000);
        this.registerInterval(this._countdownInterval);
    }
    armTimer() {
        this.clearTimer();
        if (this.mode !== "session")
            return;
        if (!this.plugin.settings.study.autoAdvanceEnabled)
            return;
        const sec = Number(this.plugin.settings.study.autoAdvanceSeconds);
        if (!Number.isFinite(sec) || sec <= 0)
            return;
        this._timer = window.setTimeout(() => {
            this._timer = null;
            this.onAutoAdvance();
        }, sec * 1000);
        this.registerInterval(this._timer);
    }
    onAutoAdvance() {
        if (this.mode !== "session" || !this.session)
            return;
        const card = this.currentCard();
        if (!card)
            return;
        const graded = this.session.graded[String(card.id)];
        if (graded) {
            void this.nextCard(false);
        }
        else {
            void this.gradeCurrentRating("again", { auto: true }).then(() => void this.nextCard(false));
        }
    }
    buildSession(scope) {
        var _a;
        const options = (_a = this._pendingSessionBuildOptions) !== null && _a !== void 0 ? _a : undefined;
        this._pendingSessionBuildOptions = null;
        return buildSession(this.plugin, scope, options);
    }
    getNextDueInScope(scope) {
        return getNextDueInScope(this.plugin, scope);
    }
    currentCard() {
        if (!this.session)
            return null;
        return this.session.queue[this.session.index] || null;
    }
    async openCurrentCardInNote() {
        const card = this.currentCard();
        if (!card)
            return;
        const id = String(card.id || "");
        const path = String(card.sourceNotePath || "");
        if (!id || !path)
            return;
        await openCardAnchorInNote(this.app, path, id);
    }
    openEditModalForCurrentCard() {
        const card = this.currentCard();
        if (!card)
            return;
        const cardType = String(card.type || "").toLowerCase();
        // Open the IO editor for image-occlusion cards
        if (["io", "io-child"].includes(cardType)) {
            const parentId = cardType === "io" ? card.id : String(card.parentId || "");
            if (!parentId) {
                new Notice(this.tx("ui.reviewer.notice.editIoMissingParent", "Cannot edit image occlusion card - missing parent card"));
                return;
            }
            ImageOcclusionCreatorModal.openForParent(this.plugin, String(parentId), {
                onClose: () => {
                    if (typeof this.plugin.refreshAllViews === "function") {
                        this.plugin.refreshAllViews();
                    }
                    else {
                        this.render();
                    }
                },
            });
            return;
        }
        // If this is a cloze child or reversed child, edit the parent instead so changes persist to the source note
        let targetCard = card;
        if (cardType === "cloze-child" || cardType === "reversed-child") {
            const parentId = String(card.parentId || "");
            if (!parentId) {
                new Notice(this.tx("ui.reviewer.notice.editMissingParent", "Cannot edit {cardType} - missing parent card", { cardType }));
                return;
            }
            const parentCard = (this.plugin.store.data.cards || {})[parentId];
            if (!parentCard) {
                new Notice(this.tx("ui.reviewer.notice.editParentNotFound", "Cannot edit {cardType} - parent card not found", { cardType }));
                return;
            }
            targetCard = parentCard;
        }
        // Use bulk edit modal for basic, cloze, and MCQ (editing parent for cloze-child)
        void openBulkEditModalForCards(this.plugin, [targetCard], async (updatedCards) => {
            if (!updatedCards.length)
                return;
            try {
                const updatedCard = updatedCards[0];
                // Update the card in the session if it exists
                if (this.session) {
                    // For cloze-child or reversed-child, defer replacing the child until after sync so we keep the correct child record
                    if (cardType !== "cloze-child" && cardType !== "reversed-child") {
                        this.session.queue[this.session.index] = updatedCard;
                    }
                }
                // Write the card back to markdown
                const file = this.app.vault.getAbstractFileByPath(updatedCard.sourceNotePath);
                if (!(file instanceof TFile))
                    throw new Error(`Source note not found: ${updatedCard.sourceNotePath}`);
                const text = await this.app.vault.read(file);
                const lines = text.split(/\r?\n/);
                const { start, end } = findCardBlockRangeById(lines, updatedCard.id);
                const block = buildCardBlockMarkdown(updatedCard.id, updatedCard);
                lines.splice(start, end - start, ...block);
                await this.app.vault.modify(file, lines.join("\n"));
                await syncOneFile(this.plugin, file, { pruneGlobalOrphans: false });
                new Notice(this.tx("ui.reviewer.notice.saved", "Saved changes to flashcard"));
                if (this.session) {
                    const refreshId = cardType === "cloze-child" || cardType === "reversed-child"
                        ? String(card.id)
                        : String(updatedCard.id);
                    const refreshed = (this.plugin.store.data.cards || {})[refreshId];
                    if (refreshed)
                        this.session.queue[this.session.index] = refreshed;
                }
                this.render();
            }
            catch (e) {
                log.error(e);
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(this.tx("ui.reviewer.notice.editFailed", "Edit failed ({error})", { error: msg }));
            }
        });
    }
    // --- FSRS grading
    async gradeCurrentRating(rating, meta) {
        var _a, _b, _c, _d;
        const card = this.currentCard();
        if (!card || !this.session)
            return;
        const id = String(card.id);
        if (this.session.graded[id])
            return;
        const now = Date.now();
        const stamp = this.getSessionStamp();
        const store = this.plugin.store;
        const reviewLogLenBefore = Array.isArray((_a = this.plugin.store.data) === null || _a === void 0 ? void 0 : _a.reviewLog)
            ? this.plugin.store.data.reviewLog.length
            : 0;
        const analyticsLenBefore = Array.isArray((_b = store.data.analytics) === null || _b === void 0 ? void 0 : _b.events)
            ? store.data.analytics.events.length
            : 0;
        const msToAnswer = this.computeMsToAnswer(now, id);
        if (this.isPracticeSession()) {
            this._undoStack.push({
                sessionStamp: stamp,
                id,
                cardType: String(card.type || "unknown"),
                rating,
                at: now,
                meta: meta || null,
                sessionIndex: Number((_c = this.session.index) !== null && _c !== void 0 ? _c : 0),
                showAnswer: !!this.showAnswer,
                storeMutated: false,
                analyticsMutated: true,
                reviewLogLenBefore,
                analyticsLenBefore,
                prevState: null,
            });
            if (this._undoStack.length > SproutReviewerView.UNDO_MAX)
                this._undoStack.splice(0, this._undoStack.length - SproutReviewerView.UNDO_MAX);
            // persist analytics for practice
            try {
                if (typeof store.appendAnalyticsReview === "function") {
                    store.appendAnalyticsReview({
                        at: now,
                        cardId: id,
                        cardType: String(card.type || "unknown"),
                        result: rating,
                        mode: "practice",
                        msToAnswer,
                        scope: this.session.scope,
                        meta: meta || undefined,
                    });
                    await store.persist();
                }
            }
            catch (e) {
                log.warn(`failed to persist practice analytics`, e);
            }
            this.session.graded[id] = { rating, at: now, meta: meta || undefined };
            this.session.stats.done = Object.keys(this.session.graded).length;
            this.showAnswer = true;
            this._timing.startedAt = 0;
            return;
        }
        const st = this.plugin.store.getState(id);
        if (!st)
            return;
        this._undoStack.push({
            sessionStamp: stamp,
            id,
            cardType: String(card.type || "unknown"),
            rating,
            at: now,
            meta: meta || null,
            sessionIndex: Number((_d = this.session.index) !== null && _d !== void 0 ? _d : 0),
            showAnswer: !!this.showAnswer,
            storeMutated: true,
            analyticsMutated: true,
            reviewLogLenBefore,
            analyticsLenBefore,
            prevState: deepClone(st),
        });
        if (this._undoStack.length > SproutReviewerView.UNDO_MAX)
            this._undoStack.splice(0, this._undoStack.length - SproutReviewerView.UNDO_MAX);
        try {
            const { nextDue, metrics } = await gradeCard({
                id,
                cardType: String(card.type || "unknown"),
                rating,
                now,
                prevState: st,
                settings: this.plugin.settings,
                store,
                msToAnswer,
                scope: this.session.scope,
                meta: meta || undefined,
            });
            if (this._isCoachSession && this._trackCoachProgress && !this.isPracticeSession()) {
                await this.plugin.recordCoachProgressForScope(this.session.scope, "flashcard", 1);
            }
            const shouldRequeueSameDay = this.mode === "session"
                && this._shouldRequeueSameDayAgain(rating, nextDue, now);
            let gradeMeta = meta && typeof meta === "object" && !Array.isArray(meta)
                ? { ...meta }
                : undefined;
            if (shouldRequeueSameDay) {
                gradeMeta = { ...(gradeMeta || {}), sameDayRequeue: true };
            }
            this.session.graded[id] = { rating, at: now, meta: gradeMeta };
            this.session.stats.done = Object.keys(this.session.graded).length;
            this.showAnswer = true;
            this._timing.startedAt = 0;
            logFsrsIfNeeded({
                id,
                cardType: String(card.type || "unknown"),
                rating,
                metrics,
                nextDue,
                meta: meta || undefined,
            });
        }
        catch (e) {
            this.clearUndo();
            throw e;
        }
    }
    // NOTE: bury/suspend live in the dropdown; keep these methods on the view.
    async buryCurrentCard() {
        if (this.mode !== "session" || !this.session)
            return;
        if (this.isPracticeSession())
            return;
        const card = this.currentCard();
        if (!card)
            return;
        const id = String(card.id);
        if (this.session.graded[id])
            return;
        const st = this.plugin.store.getState(id);
        if (!st)
            return;
        const now = Date.now();
        await buryCardAction({ id, prevState: st, now, store: this.plugin.store });
        this.session.graded[id] = { rating: "again", at: now, meta: { action: "bury" } };
        this.session.stats.done = Object.keys(this.session.graded).length;
        this.showAnswer = false;
        void this.nextCard(true);
    }
    async suspendCurrentCard() {
        if (this.mode !== "session" || !this.session)
            return;
        if (this.isPracticeSession())
            return;
        const card = this.currentCard();
        if (!card)
            return;
        const id = String(card.id);
        if (this.session.graded[id])
            return;
        const st = this.plugin.store.getState(id);
        if (!st)
            return;
        const now = Date.now();
        await suspendCardAction({ id, prevState: st, now, store: this.plugin.store });
        this.session.graded[id] = { rating: "again", at: now, meta: { action: "suspend" } };
        this.session.stats.done = Object.keys(this.session.graded).length;
        this.showAnswer = false;
        void this.nextCard(true);
    }
    /**
     * Answer a single-answer MCQ (legacy: one click selects).
     * Also called by the multi-answer submit path.
     */
    async answerMcq(choiceIdx) {
        const card = this.currentCard();
        if (!card || card.type !== "mcq" || !this.session)
            return;
        const id = String(card.id);
        if (this.session.graded[id])
            return;
        // If this is a multi-answer MCQ, delegate to answerMcqMulti
        if (isMultiAnswerMcq(card))
            return;
        const [correctIdx] = getCorrectIndices(card);
        const pass = Number.isInteger(correctIdx) && choiceIdx === correctIdx;
        const four = isFourButtonMode(this.plugin);
        const rating = pass ? (four ? "easy" : "good") : "again";
        const st = this.plugin.store.getState(id);
        if (!st && !this.isPracticeSession()) {
            log.warn(`MCQ: missing state for id=${id}; cannot grade/FSRS`);
            return;
        }
        await this.gradeCurrentRating(rating, {
            mcqChoice: choiceIdx,
            mcqCorrect: Number.isInteger(correctIdx) ? correctIdx : null,
            mcqPass: pass,
        });
        // TTS: speak correct answer after MCQ is answered
        this._speakCardBack(card);
        this.render();
    }
    /**
     * Answer a multi-answer MCQ. All-or-nothing grading:
     * pass = selected set exactly matches correct set.
     */
    async answerMcqMulti(selectedIndices) {
        const card = this.currentCard();
        if (!card || card.type !== "mcq" || !this.session)
            return;
        const id = String(card.id);
        if (this.session.graded[id])
            return;
        const correctSet = new Set(getCorrectIndices(card));
        const selectedSet = new Set(selectedIndices);
        // All-or-nothing: exact set match required
        const pass = correctSet.size === selectedSet.size &&
            [...correctSet].every(i => selectedSet.has(i));
        const four = isFourButtonMode(this.plugin);
        const rating = pass ? (four ? "easy" : "good") : "again";
        const st = this.plugin.store.getState(id);
        if (!st && !this.isPracticeSession()) {
            log.warn(`MCQ multi: missing state for id=${id}; cannot grade/FSRS`);
            return;
        }
        await this.gradeCurrentRating(rating, {
            mcqChoices: selectedIndices,
            mcqCorrectIndices: [...correctSet],
            mcqPass: pass,
        });
        this._speakCardBack(card);
        this.render();
    }
    async answerOq(userOrder) {
        const card = this.currentCard();
        if (!card || card.type !== "oq" || !this.session)
            return;
        const id = String(card.id);
        if (this.session.graded[id])
            return;
        // Check if the user's order matches the correct order (0, 1, 2, ...)
        const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
        const correctOrder = Array.from({ length: steps.length }, (_, i) => i);
        const pass = userOrder.length === correctOrder.length &&
            userOrder.every((v, i) => v === correctOrder[i]);
        const four = isFourButtonMode(this.plugin);
        const rating = pass ? (four ? "easy" : "good") : "again";
        const st = this.plugin.store.getState(id);
        if (!st && !this.isPracticeSession()) {
            log.warn(`OQ: missing state for id=${id}; cannot grade/FSRS`);
            return;
        }
        await this.gradeCurrentRating(rating, {
            oqUserOrder: userOrder,
            oqPass: pass,
        });
        this.showAnswer = true;
        this.render();
    }
    async nextCard(_userInitiated) {
        if (!this.session)
            return;
        // Stop any ongoing TTS before moving to next card
        getTtsService().stop();
        this._ttsLastSpokenKey = "";
        const card = this.currentCard();
        let requeueTargetIndex = null;
        if (card) {
            const id = String(card.id);
            if (!this.session.graded[id]) {
                await this.gradeCurrentRating("again", { auto: true });
            }
            const gradedEntry = this.session.graded[id];
            if (gradedEntry && this._isPendingSameDayRequeue(gradedEntry.meta)) {
                requeueTargetIndex = this._requeueCurrentCardToEnd(id);
            }
        }
        if (requeueTargetIndex !== null) {
            this.session.index = requeueTargetIndex;
            this.showAnswer = false;
            this.resetTiming();
            this.render();
            return;
        }
        if (this.session.index < this.session.queue.length - 1) {
            this.session.index += 1;
            this.resetTiming();
            const next = this.currentCard();
            this.showAnswer = !!(next && this.session.graded[String(next.id)]);
            this.render();
            return;
        }
        this.session.index = this.session.queue.length;
        this.showAnswer = true;
        this.resetTiming();
        this.render();
    }
    prevCard() {
        if (!this.session)
            return;
        if (this.session.index <= 0)
            return;
        this.session.index -= 1;
        this.resetTiming();
        const card = this.currentCard();
        this.showAnswer = !!(card && this.session.graded[String(card.id)]);
        this.render();
    }
    openSession(scope) {
        var _a;
        try {
            if (typeof this.plugin.store.appendAnalyticsSession === "function") {
                this.plugin.store.appendAnalyticsSession({ at: Date.now(), scope });
            }
        }
        catch (e) {
            log.swallow("review-view appendAnalyticsSession", e);
        }
        this.clearUndo();
        this.resetTiming();
        this.clearTimer();
        this.clearCountdown();
        closeMoreMenuImpl(this);
        this.mode = "session";
        this._firstSessionRender = true;
        this.session = this.buildSession(scope);
        if (this.session) {
            this.session.queue = (this.session.queue || []).filter((c) => !isIoParentCard(c));
            this.session.stats.total = this.session.queue.length;
            this.session.index = clampInt((_a = this.session.index) !== null && _a !== void 0 ? _a : 0, 0, Math.max(0, this.session.queue.length));
            this.session._bcStamp = ++this._sessionStamp;
            initMcqOrderState(this.session);
            initSkipState(this.session);
            this.session.practice = this._sessionPracticeMode;
        }
        this.showAnswer = false;
        this.render();
    }
    openSessionFromScope(scope, options) {
        this._isCoachSession = Number.isFinite(Number(options === null || options === void 0 ? void 0 : options.targetCount));
        this._trackCoachProgress = this._isCoachSession && (options === null || options === void 0 ? void 0 : options.trackCoachProgress) !== false;
        this._sessionPracticeMode = (options === null || options === void 0 ? void 0 : options.practiceMode) === true;
        this._pendingSessionBuildOptions = options !== null && options !== void 0 ? options : null;
        this.openSession(scope);
    }
    openSessionFromWidget(payload) {
        var _a;
        if (!payload || !payload.scope)
            return;
        this._isCoachSession = false;
        this._trackCoachProgress = false;
        this._sessionPracticeMode = false;
        this.openSession(payload.scope);
        if (!this.session)
            return;
        const wantedId = String((_a = payload.currentCardId) !== null && _a !== void 0 ? _a : "").trim();
        if (wantedId) {
            const idx = this.session.queue.findIndex((c) => { var _a; return String((_a = c === null || c === void 0 ? void 0 : c.id) !== null && _a !== void 0 ? _a : "") === wantedId; });
            if (idx >= 0)
                this.session.index = idx;
        }
        const card = this.currentCard();
        const providedOrder = Array.isArray(payload.currentMcqOrder) ? payload.currentMcqOrder.slice() : null;
        if ((card === null || card === void 0 ? void 0 : card.type) === "mcq" && providedOrder) {
            const optionCount = Array.isArray(card.options) ? card.options.length : 0;
            const seen = new Set();
            const valid = providedOrder.length === optionCount &&
                providedOrder.every((x) => Number.isInteger(x) && x >= 0 && x < optionCount && !seen.has(x) && !!seen.add(x));
            if (valid) {
                if (!this.session.mcqOrderMap || typeof this.session.mcqOrderMap !== "object")
                    this.session.mcqOrderMap = {};
                this.session.mcqOrderMap[String(card.id)] = providedOrder;
            }
        }
        this.showAnswer = !!payload.showAnswer;
        this.render();
    }
    backToDecks() {
        this.clearUndo();
        this.resetTiming();
        getTtsService().stop();
        this._ttsLastSpokenKey = "";
        this.clearTimer();
        this.clearCountdown();
        closeMoreMenuImpl(this);
        this.mode = "deck";
        this._firstDeckRender = true;
        this._isCoachSession = false;
        this._trackCoachProgress = false;
        this._sessionPracticeMode = false;
        this.session = null;
        this.showAnswer = false;
        if (this._returnToCoach) {
            this._returnToCoach = false;
            void this.plugin.openCoachTab(false, { suppressEntranceAos: true, refresh: false }, this.leaf);
            return;
        }
        this.render();
    }
    isActiveLeaf() {
        var _a, _b;
        const ws = this.app.workspace;
        const activeLeaf = (_b = (_a = ws === null || ws === void 0 ? void 0 : ws.getMostRecentLeaf) === null || _a === void 0 ? void 0 : _a.call(ws)) !== null && _b !== void 0 ? _b : null;
        return !!activeLeaf && activeLeaf === this.leaf;
    }
    handleKey(ev) {
        if (!this.isActiveLeaf())
            return;
        // Let active zoom modals consume Escape so it closes the modal instead
        // of quitting the study session.
        if (ev.key === "Escape" && document.querySelector(".lk-modals.learnkit-zoom-overlay")) {
            return;
        }
        const t = ev.target;
        if (t &&
            (t.tagName === "INPUT" ||
                t.tagName === "TEXTAREA" ||
                t.tagName === "SELECT" ||
                t.isContentEditable))
            return;
        if (this.mode !== "session" || !this.session)
            return;
        if (ev.key === "Escape" && this._moreOpen) {
            ev.preventDefault();
            ev.stopPropagation();
            closeMoreMenuImpl(this);
            return;
        }
        const isEnter = ev.key === "Enter" || ev.code === "Enter" || ev.code === "NumpadEnter";
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
                if (!this._isCoachSession && this.canStartPractice(this.session.scope)) {
                    this.startPracticeFromCurrentScope();
                    return;
                }
            }
            if (ev.key === "q" || ev.key === "Q" || ev.code === "KeyQ") {
                if (ev.metaKey || ev.ctrlKey)
                    return;
                ev.preventDefault();
                ev.stopPropagation();
                closeMoreMenuImpl(this);
                this.backToDecks();
                return;
            }
            return;
        }
        const id = String(card.id);
        const graded = this.session.graded[id] || null;
        if (ev.key === "q" || ev.key === "Q" || ev.code === "KeyQ") {
            if (ev.metaKey || ev.ctrlKey)
                return;
            ev.preventDefault();
            ev.stopPropagation();
            closeMoreMenuImpl(this);
            this.backToDecks();
            return;
        }
        if (k === "m") {
            ev.preventDefault();
            ev.stopPropagation();
            const trigger = queryFirst(this.contentEl, 'button[data-learnkit-action="reviewer-more-trigger"], button[data-bc-action="reviewer-more-trigger"]');
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
            if (k === "b")
                void this.buryCurrentCard();
            else
                void this.suspendCurrentCard();
            return;
        }
        const isBackward = ev.key === "ArrowLeft";
        if (isBackward) {
            ev.preventDefault();
            ev.stopPropagation();
            closeMoreMenuImpl(this);
            if (((card.type === "basic" ||
                card.type === "reversed" ||
                card.type === "reversed-child" ||
                card.type === "cloze" ||
                card.type === "cloze-child" ||
                isIoRevealableType(card)) &&
                this.showAnswer)) {
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
        if (card.type === "mcq") {
            // Reset multi-select state if card changed
            if (this._mcqMultiCardId !== id) {
                this._mcqMultiSelected.clear();
                this._mcqMultiCardId = id;
            }
            const multiAnswer = isMultiAnswerMcq(card);
            if (multiAnswer) {
                // Multi-answer MCQ: 1-9 toggles selection, Enter submits
                if (/^[1-9]$/.test(ev.key) && !graded) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMoreMenuImpl(this);
                    const displayIdx = Number(ev.key) - 1;
                    const opts = card.options || [];
                    if (displayIdx < 0 || displayIdx >= opts.length)
                        return;
                    const order = getMcqOptionOrder(this.plugin, this.session, card);
                    const origIdx = order[displayIdx];
                    if (!Number.isInteger(origIdx) || origIdx < 0 || origIdx >= opts.length)
                        return;
                    // Toggle selection
                    if (this._mcqMultiSelected.has(origIdx)) {
                        this._mcqMultiSelected.delete(origIdx);
                    }
                    else {
                        this._mcqMultiSelected.add(origIdx);
                    }
                    // In-place DOM update: toggle the button class and update submit button
                    const optionList = this.contentEl.querySelector(".learnkit-mcq-options");
                    if (optionList) {
                        const buttons = optionList.querySelectorAll(":scope > button.learnkit-btn-toolbar");
                        if (buttons[displayIdx]) {
                            buttons[displayIdx].classList.toggle("learnkit-mcq-selected", this._mcqMultiSelected.has(origIdx));
                        }
                        const submitBtnEl = this.contentEl.querySelector(".learnkit-mcq-submit-btn");
                        if (submitBtnEl) {
                            submitBtnEl.disabled = this._mcqMultiSelected.size === 0;
                            submitBtnEl.classList.toggle("opacity-50", this._mcqMultiSelected.size === 0);
                            submitBtnEl.classList.toggle("cursor-not-allowed", this._mcqMultiSelected.size === 0);
                            // Reset empty-attempt counter when selection changes via keyboard
                            if (this._mcqMultiSelected.size > 0) {
                                delete submitBtnEl.dataset.emptyAttempt;
                                submitBtnEl.removeAttribute("aria-label");
                                submitBtnEl.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                            }
                        }
                    }
                }
                else if (isEnter && !graded && this._mcqMultiSelected.size > 0) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMoreMenuImpl(this);
                    void this.answerMcqMulti([...this._mcqMultiSelected]);
                }
                else if (isEnter && !graded && this._mcqMultiSelected.size === 0) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMoreMenuImpl(this);
                    // Shake the submit button and show tooltip on second empty Enter
                    const submitBtnEl = this.contentEl.querySelector(".learnkit-mcq-submit-btn");
                    if (submitBtnEl) {
                        submitBtnEl.classList.add("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
                        submitBtnEl.addEventListener("animationend", () => {
                            submitBtnEl.classList.remove("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
                        }, { once: true });
                        if (submitBtnEl.dataset.emptyAttempt === "1") {
                            submitBtnEl.setAttribute("aria-label", this.tx("ui.reviewer.mcq.chooseOne", "Choose at least one answer to proceed"));
                            submitBtnEl.setAttribute("data-tooltip-position", "top");
                            submitBtnEl.classList.add("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                            setTimeout(() => {
                                submitBtnEl.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                            }, 2500);
                        }
                        submitBtnEl.dataset.emptyAttempt = String(Number(submitBtnEl.dataset.emptyAttempt || "0") + 1);
                    }
                }
                else if (isEnter && graded) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMoreMenuImpl(this);
                    void this.nextCard(true);
                }
            }
            else {
                // Single-answer MCQ: immediate answer on key press
                if (/^[1-9]$/.test(ev.key)) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMoreMenuImpl(this);
                    const displayIdx = Number(ev.key) - 1;
                    const opts = card.options || [];
                    if (displayIdx < 0 || displayIdx >= opts.length)
                        return;
                    const order = getMcqOptionOrder(this.plugin, this.session, card);
                    const origIdx = order[displayIdx];
                    if (Number.isInteger(origIdx) && origIdx >= 0 && origIdx < opts.length) {
                        void this.answerMcq(origIdx);
                    }
                }
            }
            return;
        }
        // OQ: Enter key submits order (ungraded) or acts like "Next" (graded)
        if (card.type === "oq") {
            if (isEnter && !graded) {
                ev.preventDefault();
                ev.stopPropagation();
                closeMoreMenuImpl(this);
                // Read the current order from the session oqOrderMap
                const s = this.session;
                const oqMap = s.oqOrderMap || {};
                const currentOrder = oqMap[id];
                if (Array.isArray(currentOrder) && currentOrder.length > 0) {
                    void this.answerOq(currentOrder.slice());
                }
                return;
            }
            if (isEnter && graded) {
                ev.preventDefault();
                ev.stopPropagation();
                closeMoreMenuImpl(this);
                void this.nextCard(true);
            }
            // Grade keys after reveal
            if (graded) {
                if (isEnter) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMoreMenuImpl(this);
                    void this.nextCard(true);
                }
            }
            return;
        }
        const isRevealable = card.type === "basic" ||
            card.type === "reversed" ||
            card.type === "reversed-child" ||
            card.type === "cloze" ||
            card.type === "cloze-child" ||
            isIoRevealableType(card);
        if (isRevealable) {
            if (isEnter && !graded) {
                ev.preventDefault();
                ev.stopPropagation();
                closeMoreMenuImpl(this);
                if (!this.showAnswer) {
                    this.showAnswer = true;
                    // TTS: speak back of card when answer is revealed via keyboard
                    const revealCard = this.currentCard();
                    if (revealCard)
                        this._speakCardBack(revealCard);
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
                    // TTS: speak back of card when answer is revealed via grade key
                    const gradeCard = this.currentCard();
                    if (gradeCard)
                        this._speakCardBack(gradeCard);
                    this.render();
                    return;
                }
                if (!graded) {
                    let rating;
                    if (!four) {
                        rating = ev.key === "1" ? "again" : "good";
                    }
                    else {
                        if (ev.key === "1")
                            rating = "again";
                        else if (ev.key === "2")
                            rating = "hard";
                        else if (ev.key === "3")
                            rating = "good";
                        else
                            rating = "easy";
                    }
                    void this.gradeCurrentRating(rating, {}).then(() => void this.nextCard(true));
                    return;
                }
                void this.nextCard(true);
                return;
            }
            return;
        }
    }
    async resyncActiveFile() {
        var _a;
        const active = (_a = this.plugin._getActiveMarkdownFile()) !== null && _a !== void 0 ? _a : null;
        if (!active)
            return;
        const res = await syncOneFile(this.plugin, active);
        new Notice(`${res.newCount} new; ${res.updatedCount} updated; ${res.sameCount} unchanged; ${res.idsInserted} IDs inserted.`);
        if (res.quarantinedCount > 0)
            new ParseErrorModal(this.plugin.app, this.plugin, res.quarantinedIds).open();
        this.plugin.notifyWidgetCardsSynced();
    }
    extractInfoField(card) {
        if (!card)
            return null;
        const pick = (v) => {
            if (typeof v === "string" && v.trim())
                return v.trim();
            if (Array.isArray(v)) {
                const s = v.filter((x) => typeof x === "string").join("\n").trim();
                return s ? s : null;
            }
            return null;
        };
        return pick(card.info);
    }
    hasInfoField(card) {
        return !!this.extractInfoField(card);
    }
    render() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        const root = this.contentEl;
        const suppressEntranceAos = this._suppressEntranceAosOnce;
        this._suppressEntranceAosOnce = false;
        const coachShellMode = this._returnToCoach || this._isCoachSession;
        this._restoreStudySessionTimerRow(root);
        const preservedCoachStrip = coachShellMode
            ? root.querySelector(":scope > .lk-home-title-strip.learnkit-coach-title-strip")
            : null;
        if (preservedCoachStrip)
            preservedCoachStrip.remove();
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleStripEl = null;
        this._titleTimerHostEl = null;
        // Preserve the study session header when in session mode
        const studySessionHeader = queryFirst(root, "[data-study-session-header]");
        const headerWillPersist = !!studySessionHeader && this.mode === "session" && !!this.session;
        root.empty();
        if (preservedCoachStrip) {
            root.appendChild(preservedCoachStrip);
            this._titleStripEl = preservedCoachStrip;
        }
        this._moreOpen = false;
        this._moreWrap = null;
        this._moreMenuEl = null;
        this._moreBtnEl = null;
        root.classList.add("learnkit-view-content", "learnkit-view-content");
        root.classList.add("lk-review-root");
        root.setAttribute("data-lk-review-mode", this.mode);
        this.containerEl.addClass("learnkit");
        if (!preservedCoachStrip) {
            this._ensureTitleStrip(root);
        }
        let contentHost = root;
        if (this.mode === "deck" || this.mode === "session") {
            const contentShell = document.createElement("div");
            contentShell.className = `${SPROUT_HOME_CONTENT_SHELL_CLASS} lk-review-content-shell`;
            root.appendChild(contentShell);
            contentHost = contentShell;
        }
        let sessionColumn = null;
        if (this.mode === "session") {
            sessionColumn = document.createElement("div");
            sessionColumn.className = "learnkit-study-column lk-session-column flex flex-col min-h-0";
            contentHost.appendChild(sessionColumn);
        }
        // Re-attach the study session header if it was preserved
        if (headerWillPersist && studySessionHeader) {
            (sessionColumn !== null && sessionColumn !== void 0 ? sessionColumn : contentHost).appendChild(studySessionHeader);
        }
        // --- Use shared SproutHeader ---
        if (!this._header) {
            this._header = createViewHeader({
                view: this,
                plugin: this.plugin,
                onToggleWide: () => this._applyReviewerWidthMode(),
            });
        }
        this._header.install("cards");
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
                container: contentHost,
                applyAOS: false,
                expanded: this.expanded,
                setExpanded: (s) => (this.expanded = s),
                openSession: (scope) => {
                    this._isCoachSession = false;
                    this.openSession(scope);
                },
                resyncActiveFile: () => this.resyncActiveFile(),
                rerender: () => this.render(),
            });
            if (this._firstDeckRender) {
                const animationsEnabled = (_d = (_c = (_b = this.plugin.settings) === null || _b === void 0 ? void 0 : _b.general) === null || _c === void 0 ? void 0 : _c.enableAnimations) !== null && _d !== void 0 ? _d : true;
                if (animationsEnabled && !suppressEntranceAos) {
                    const titleStrip = this._titleStripEl;
                    if (titleStrip) {
                        titleStrip.removeAttribute("data-aos");
                        titleStrip.removeAttribute("data-aos-delay");
                        titleStrip.removeAttribute("data-aos-anchor-placement");
                        titleStrip.removeAttribute("data-aos-duration");
                        titleStrip.classList.remove("lk-review-enter-title");
                        void titleStrip.offsetWidth;
                        titleStrip.classList.add("lk-review-enter-title");
                    }
                    contentHost.removeAttribute("data-aos");
                    contentHost.removeAttribute("data-aos-delay");
                    contentHost.removeAttribute("data-aos-anchor-placement");
                    contentHost.removeAttribute("data-aos-duration");
                    contentHost.classList.remove("lk-review-enter-shell");
                    void contentHost.offsetWidth;
                    contentHost.classList.add("lk-review-enter-shell");
                }
                this._firstDeckRender = false;
            }
            this._restoreFocus();
            return;
        }
        // ---- Session mode ----
        if (!this.session) {
            this._restoreFocus();
            return;
        }
        const activeCard = this.currentCard();
        if (activeCard)
            this.noteCardPresented(activeCard);
        const infoPresent = activeCard ? this.hasInfoField(activeCard) : false;
        const showInfo = !!this.plugin.settings.study.showInfoByDefault || (this.showAnswer && infoPresent);
        const ttsEnabledForCard = this._canUseTtsForCard(activeCard);
        const practiceMode = this.isPracticeSession();
        const canStartPractice = !this._isCoachSession && !practiceMode && !activeCard && this.canStartPractice(this.session.scope);
        const hasCardsInScope = !this._isCoachSession && !practiceMode && !activeCard && this.hasCardsInScope(this.session.scope);
        const buildClozeRenderOptions = () => {
            var _a, _b;
            const clozeSettings = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.cards;
            return {
                mode: (_b = clozeSettings === null || clozeSettings === void 0 ? void 0 : clozeSettings.clozeMode) !== null && _b !== void 0 ? _b : "standard",
                clozeBgColor: (clozeSettings === null || clozeSettings === void 0 ? void 0 : clozeSettings.clozeBgColor) || "",
                clozeTextColor: (clozeSettings === null || clozeSettings === void 0 ? void 0 : clozeSettings.clozeTextColor) || "",
                typedAnswers: this._typedClozeAnswers,
                onTypedInput: (answerKey, _idx, val) => {
                    this._typedClozeAnswers.set(answerKey, val);
                },
                onTypedSubmit: () => {
                    if (!this.showAnswer) {
                        this.showAnswer = true;
                        const typedCard = this.currentCard();
                        if (typedCard)
                            this._speakCardBack(typedCard);
                        this.render();
                    }
                },
            };
        };
        renderSessionMode({
            container: sessionColumn !== null && sessionColumn !== void 0 ? sessionColumn : contentHost,
            interfaceLanguage: (_f = (_e = this.plugin.settings) === null || _e === void 0 ? void 0 : _e.general) === null || _f === void 0 ? void 0 : _f.interfaceLanguage,
            session: this.session,
            showAnswer: this.showAnswer,
            setShowAnswer: (v) => {
                this.showAnswer = v;
                // TTS: speak back of card when answer is revealed
                if (v) {
                    const card = this.currentCard();
                    if (card)
                        this._speakCardBack(card);
                }
            },
            currentCard: () => this.currentCard(),
            backToDecks: () => this.backToDecks(),
            nextCard: (userInitiated) => this.nextCard(userInitiated),
            gradeCurrentRating: (rating, meta) => this.gradeCurrentRating(rating, meta),
            answerMcq: (idx) => this.answerMcq(idx),
            answerMcqMulti: (indices) => this.answerMcqMulti(indices),
            mcqMultiSelected: this._mcqMultiSelected,
            mcqMultiCardId: this._mcqMultiCardId,
            syncMcqMultiSelect: (origIdx, selected) => {
                const card = this.currentCard();
                if (!card)
                    return;
                const id = String(card.id);
                if (this._mcqMultiCardId !== id) {
                    this._mcqMultiSelected.clear();
                    this._mcqMultiCardId = id;
                }
                if (selected) {
                    this._mcqMultiSelected.add(origIdx);
                }
                else {
                    this._mcqMultiSelected.delete(origIdx);
                }
                // No full re-render — the click handler in render-session
                // updates the DOM in-place for instant feedback.
            },
            answerOq: (userOrder) => this.answerOq(userOrder),
            enableSkipButton: isSkipEnabled(this.plugin),
            skipCurrentCard: (meta) => this.doSkipCurrentCard(meta),
            canBurySuspend: !practiceMode && !!activeCard && !this.session.graded[String((_g = activeCard === null || activeCard === void 0 ? void 0 : activeCard.id) !== null && _g !== void 0 ? _g : "")],
            buryCurrentCard: () => void this.buryCurrentCard(),
            suspendCurrentCard: () => void this.suspendCurrentCard(),
            canUndo: this.canUndo(),
            undoLast: () => void this.undoLastGrade(),
            practiceMode,
            canStartPractice,
            hasCardsInScope,
            startPractice: () => this.startPracticeFromCurrentScope(),
            coachSessionMode: this._isCoachSession,
            coachEmptyTitle: this.tx("ui.reviewer.session.coachDoneTitle", "All due flashcards for your study plan have been reviewed for today."),
            coachBackLabel: this.tx("ui.reviewer.session.backToCoach", "Back to Coach"),
            showInfo,
            clearTimer: () => this.clearTimer(),
            clearCountdown: () => this.clearCountdown(),
            getNextDueInScope: (scope) => this.getNextDueInScope(scope),
            startCountdown: (nextDue, lineEl) => this.startCountdown(nextDue, lineEl),
            getClozeRenderOptions: buildClozeRenderOptions,
            renderClozeFront: (text, reveal, targetIndex, opts) => {
                const clozeOpts = {
                    ...buildClozeRenderOptions(),
                    ...opts,
                };
                return renderClozeFront(text, reveal, targetIndex, clozeOpts);
            },
            renderMarkdownInto: (containerEl, md, sourcePath) => this.renderMarkdownInto(containerEl, md, sourcePath),
            renderImageOcclusionInto: (containerEl, card2, sourcePath2, reveal2) => this.renderImageOcclusionInto(containerEl, card2, sourcePath2, reveal2),
            randomizeMcqOptions: isMcqOptionRandomisationEnabled(this.plugin),
            randomizeOqOrder: (_j = (_h = this.plugin.settings.study) === null || _h === void 0 ? void 0 : _h.randomizeOqOrder) !== null && _j !== void 0 ? _j : true,
            fourButtonMode: isFourButtonMode(this.plugin),
            showGradeIntervals: !!((_k = this.plugin.settings.study) === null || _k === void 0 ? void 0 : _k.showGradeIntervals),
            schedulingSettings: this.plugin.settings.scheduling,
            getCardStateForPreview: (cardId, now) => this.plugin.store.ensureState(cardId, now),
            openEditModal: () => this.openEditModalForCurrentCard(),
            applyAOS: false,
            aosDelayMs: this._firstSessionRender ? 100 : 0,
            ttsEnabled: ttsEnabledForCard,
            ttsReplayFront: () => this._replayFront(),
            ttsReplayBack: () => this._replayBack(),
            ttsReplayMcqQuestion: () => this._replayMcqQuestion(),
            ttsReplayMcqOptions: () => this._replayMcqOptions(),
            ttsReplayMcqAnswer: () => this._replayMcqAnswer(),
            ttsReplayOqQuestion: () => this._replayOqQuestion(),
            ttsReplayOqSteps: () => this._replayOqSteps(),
            ttsReplayOqAnswer: () => this._replayOqAnswer(),
            hideSessionTopbar: !!((_l = this.plugin.settings.study) === null || _l === void 0 ? void 0 : _l.hideSessionTopbar),
            rerender: () => this.render(),
        });
        // TTS: speak front after render so OQ shuffled display order is initialized.
        if (activeCard && !this.showAnswer)
            this._speakCardFront(activeCard);
        const renderedSessionHeader = queryFirst(sessionColumn !== null && sessionColumn !== void 0 ? sessionColumn : root, "[data-study-session-header]");
        const renderedSessionTimerRow = (_m = renderedSessionHeader === null || renderedSessionHeader === void 0 ? void 0 : renderedSessionHeader.querySelector("[data-study-session-timer-row]")) !== null && _m !== void 0 ? _m : null;
        const titleTimerHost = this._titleTimerHostEl;
        if (titleTimerHost) {
            while (titleTimerHost.firstChild)
                titleTimerHost.removeChild(titleTimerHost.firstChild);
            if (renderedSessionTimerRow && !coachShellMode) {
                titleTimerHost.appendChild(renderedSessionTimerRow);
            }
        }
        if (renderedSessionHeader) {
            renderedSessionHeader.classList.add("lk-review-session-header-hidden");
        }
        queueMicrotask(() => renderTitleMarkdownIfNeeded({
            rootEl: this.contentEl,
            session: this.session,
            card: this.currentCard(),
            renderMarkdownInto: (el2, md, sp) => this.renderMarkdownInto(el2, md, sp),
        }));
        // Only arm timer on first render of session, not on card/reveal changes
        if (this._firstSessionRender) {
            const animationsEnabled = (_q = (_p = (_o = this.plugin.settings) === null || _o === void 0 ? void 0 : _o.general) === null || _p === void 0 ? void 0 : _p.enableAnimations) !== null && _q !== void 0 ? _q : true;
            // Animate reviewer title strip first, then shell, with Coach-matching timing.
            if (animationsEnabled && !coachShellMode && !suppressEntranceAos) {
                const titleStrip = this._titleStripEl;
                if (titleStrip) {
                    titleStrip.removeAttribute("data-aos");
                    titleStrip.removeAttribute("data-aos-delay");
                    titleStrip.removeAttribute("data-aos-anchor-placement");
                    titleStrip.removeAttribute("data-aos-duration");
                    titleStrip.classList.remove("lk-review-enter-title");
                    void titleStrip.offsetWidth;
                    titleStrip.classList.add("lk-review-enter-title");
                }
                contentHost.removeAttribute("data-aos");
                contentHost.removeAttribute("data-aos-delay");
                contentHost.removeAttribute("data-aos-anchor-placement");
                contentHost.removeAttribute("data-aos-duration");
                contentHost.classList.remove("lk-review-enter-shell");
                void contentHost.offsetWidth;
                contentHost.classList.add("lk-review-enter-shell");
            }
            this._firstSessionRender = false;
            this.armTimer();
        }
        this._restoreFocus();
    }
}
SproutReviewerView.UNDO_MAX = 3;
