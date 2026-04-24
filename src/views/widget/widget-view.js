/**
 * @file src/views/widget/widget-view.ts
 * @summary The Sprout sidebar widget — an Obsidian ItemView that displays a lightweight flashcard review session for the currently-open note. Manages summary mode (card counts and "Start Studying" button), session mode (one-at-a-time card review with grading, undo, bury, suspend), keyboard shortcuts, folder-note deck support, and inline card editing. Most logic is delegated to sibling modules (widget-markdown, widget-scope, widget-session-actions, widget-render-summary, widget-render-session).
 *
 * @exports
 *  - SproutWidgetView — Obsidian ItemView subclass implementing the sidebar flashcard-review widget
 */
import { ItemView, Notice } from "obsidian";
import { VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../../platform/core/constants";
import { SproutMarkdownHelper } from "../reviewer/markdown-render";
import { openSproutImageZoom } from "../reviewer/zoom";
import { buildSession as buildReviewerSession } from "../reviewer/session";
import { processCircleFlagsInMarkdown, hydrateCircleFlagsInElement } from "../../platform/flags/flag-tokens";
import * as IO from "../../platform/image-occlusion/image-occlusion-index";
import { renderImageOcclusionReviewInto } from "../../platform/image-occlusion/image-occlusion-review-render";
import { isMultiAnswerMcq } from "../../platform/types/card";
import { filterReviewableCards, getWidgetMcqDisplayOrder, isClozeLike, mergeQueueOnSync } from "./core/widget-helpers";
import { getCardsInActiveScope, getFolderNoteInfo, folderNotesAsDecksEnabled } from "./scope/scope-helpers";
import { gradeCurrentRating as _gradeCurrentRating, canUndo as _canUndo, undoLastGrade as _undoLastGrade, buryCurrentCard as _buryCurrentCard, suspendCurrentCard as _suspendCurrentCard, answerMcq as _answerMcq, answerMcqMulti as _answerMcqMulti, answerOq as _answerOq, nextCard as _nextCard, openEditModalForCurrentCard as _openEditModalForCurrentCard, } from "./session/session-actions";
import { renderWidgetSummary } from "./view/render-summary";
import { renderWidgetSession } from "./view/render-session";
import { t } from "../../platform/translations/translator";
/* ================================================================== */
/*  SproutWidgetView                                                   */
/* ================================================================== */
export class SproutWidgetView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.activeFile = null;
        this.mode = "summary";
        this.session = null;
        this.showAnswer = false;
        /** @internal */ this._timer = null;
        /** @internal */ this._timing = null;
        /** @internal */ this._undoStack = [];
        /** @internal */ this._sessionStamp = 0;
        /** @internal */ this._moreMenuToggle = null;
        this._mdHelper = null;
        /** Stores user-typed cloze answers by cloze occurrence key for typed-mode cloze cards. */
        this._typedClozeAnswers = new Map();
        /** Tracks the current card ID to reset typed answers when card changes. */
        this._typedClozeCardId = "";
        /** Tracks multi-answer MCQ selections. */
        this._mcqMultiSelected = new Set();
        this._mcqMultiCardId = "";
        this._lastTtsKey = "";
        this._keysBound = false;
        this.plugin = plugin;
        // Expose instance globally for readingView integration
        window.SproutWidgetView = this;
    }
    _tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
    }
    getViewType() {
        return VIEW_TYPE_WIDGET;
    }
    getDisplayText() {
        return "Open study widget";
    }
    getIcon() {
        return "learnkit-widget-study";
    }
    async onOpen() {
        this.activeFile = this.app.workspace.getActiveFile();
        // Keep the container focusable so keyboard events work from anywhere in the leaf.
        this.containerEl.tabIndex = 0;
        const focusSelf = (ev) => {
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
            // Listen on the container (natural focus path) …
            this.containerEl.addEventListener("keydown", (ev) => this.handleKey(ev));
            // … and on window capture so shortcuts still work when focus lingers
            // on child elements (rendered markdown, images, etc.).
            window.addEventListener("keydown", (ev) => {
                if (!this.isWidgetLeafActive())
                    return;
                this.handleKey(ev);
            }, { capture: true });
        }
        this.render();
        await Promise.resolve();
    }
    /** Returns true when this widget's leaf is the visible sidebar leaf. */
    isWidgetLeafActive() {
        var _a;
        // The widget container must be connected and visible.
        if (!((_a = this.containerEl) === null || _a === void 0 ? void 0 : _a.isConnected))
            return false;
        if (this.containerEl.offsetParent === null)
            return false;
        // Make sure focus is within the widget's leaf (avoids stealing keys from
        // the main editing area or other sidebar panels).
        const active = document.activeElement;
        return !!active && this.containerEl.contains(active);
    }
    onRefresh() {
        this.render();
    }
    /**
     * Called after card sync operations complete.
     * Summary mode rerenders immediately; session mode updates the upcoming queue
     * while keeping the current card stable to avoid visible resets.
     */
    onCardsSynced() {
        if (this.mode !== "session" || !this.session) {
            this.render();
            return;
        }
        const previousSession = this.session;
        const previousQueue = Array.isArray(previousSession.queue) ? previousSession.queue : [];
        const previousIndex = Math.max(0, Math.min(previousSession.index, previousQueue.length));
        const rebuilt = previousSession.mode === "practice"
            ? this.buildPracticeSessionForActiveNote()
            : this.buildSessionForActiveNote();
        if (!rebuilt)
            return;
        const merged = mergeQueueOnSync(previousQueue, previousIndex, rebuilt.queue || []);
        previousSession.queue = merged.queue;
        previousSession.index = merged.index;
        if (previousSession.stats) {
            previousSession.stats.total = merged.queue.length;
            previousSession.stats.done = Math.min(previousSession.stats.done, merged.queue.length);
        }
    }
    onFileOpen(file) {
        this.activeFile = file || null;
        if (this.mode === "session") {
            if (this.isSessionComplete()) {
                this.backToSummary();
                return;
            }
            return;
        }
        this.render();
    }
    isSessionComplete() {
        if (!this.session)
            return true;
        return this.session.index >= this.session.queue.length;
    }
    /* ---------------------------------------------------------------- */
    /*  Markdown / rendering helpers                                     */
    /* ---------------------------------------------------------------- */
    ensureMarkdownHelper() {
        if (this._mdHelper)
            return;
        this._mdHelper = new SproutMarkdownHelper({
            app: this.app,
            owner: this,
            maxHeightPx: 200,
            onZoom: (src, alt) => openSproutImageZoom(this.app, src, alt),
        });
    }
    /** Render Obsidian markdown into a container element. */
    async renderMarkdownInto(containerEl, md, sourcePath) {
        this.ensureMarkdownHelper();
        if (!this._mdHelper)
            return;
        const withFlags = processCircleFlagsInMarkdown(md !== null && md !== void 0 ? md : "");
        await this._mdHelper.renderInto(containerEl, withFlags, sourcePath !== null && sourcePath !== void 0 ? sourcePath : "");
        hydrateCircleFlagsInElement(containerEl);
    }
    /** Render an image-occlusion card into a container. */
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
    /* ---------------------------------------------------------------- */
    /*  Timer management                                                 */
    /* ---------------------------------------------------------------- */
    clearTimer() {
        if (this._timer) {
            window.clearTimeout(this._timer);
            this._timer = null;
        }
    }
    armTimer() {
        this.clearTimer();
        if (this.mode !== "session" || !this.session) {
            return;
        }
        if (!this.plugin.settings.study.autoAdvanceEnabled)
            return;
        const sec = Number(this.plugin.settings.study.autoAdvanceSeconds);
        if (!Number.isFinite(sec) || sec <= 0)
            return;
        this._timer = window.setTimeout(() => {
            void (async () => {
                this._timer = null;
                await this.nextCard();
            })();
        }, sec * 1000);
        this.registerInterval(this._timer);
    }
    /* ---------------------------------------------------------------- */
    /*  Session builders                                                 */
    /* ---------------------------------------------------------------- */
    getStudyScopeForActiveFile() {
        const f = this.activeFile;
        if (!f)
            return null;
        const folderInfo = getFolderNoteInfo(f);
        if (folderInfo && folderNotesAsDecksEnabled(this.plugin.settings)) {
            return {
                type: "folder",
                key: folderInfo.folderPath,
                name: folderInfo.folderName,
            };
        }
        return {
            type: "note",
            key: f.path,
            name: f.basename,
        };
    }
    buildSessionForActiveNote() {
        var _a;
        const f = this.activeFile;
        if (!f)
            return null;
        const scope = this.getStudyScopeForActiveFile();
        if (!scope)
            return null;
        const reviewSession = buildReviewerSession(this.plugin, scope);
        const queue = reviewSession.queue || [];
        return {
            scopeName: scope.name || f.basename,
            scopeType: scope.type === "folder" ? "folder" : "note",
            scopeKey: scope.key,
            queue,
            index: Math.max(0, Math.min(Number((_a = reviewSession.index) !== null && _a !== void 0 ? _a : 0), queue.length)),
            graded: {},
            stats: { total: queue.length, done: 0 },
            mode: "scheduled",
        };
    }
    buildPracticeSessionForActiveNote() {
        const f = this.activeFile;
        if (!f)
            return null;
        const scope = this.getStudyScopeForActiveFile();
        if (!scope)
            return null;
        const cards = getCardsInActiveScope(this.plugin.store, f, this.plugin.settings);
        const queue = filterReviewableCards(cards).sort((a, b) => {
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
        return {
            scopeName: scope.name || f.basename,
            scopeType: scope.type === "folder" ? "folder" : "note",
            scopeKey: scope.key,
            queue,
            index: 0,
            graded: {},
            stats: { total: queue.length, done: 0 },
            mode: "practice",
        };
    }
    /* ---------------------------------------------------------------- */
    /*  Session navigation                                               */
    /* ---------------------------------------------------------------- */
    currentCard() {
        if (!this.session)
            return null;
        return this.session.queue[this.session.index] || null;
    }
    /* ---------------------------------------------------------------- */
    /*  Delegated session actions                                        */
    /* ---------------------------------------------------------------- */
    async gradeCurrentRating(rating, meta) {
        return _gradeCurrentRating(this, rating, meta);
    }
    canUndo() {
        return _canUndo(this);
    }
    async undoLastGrade() {
        return _undoLastGrade(this);
    }
    async buryCurrentCard() {
        return _buryCurrentCard(this);
    }
    async suspendCurrentCard() {
        return _suspendCurrentCard(this);
    }
    async answerMcq(choiceIdx) {
        return _answerMcq(this, choiceIdx);
    }
    async answerMcqMulti(selectedIndices) {
        return _answerMcqMulti(this, selectedIndices);
    }
    async answerOq(userOrder) {
        return _answerOq(this, userOrder);
    }
    async nextCard() {
        return _nextCard(this);
    }
    openEditModalForCurrentCard() {
        return _openEditModalForCurrentCard(this);
    }
    /* ---------------------------------------------------------------- */
    /*  Session lifecycle                                                */
    /* ---------------------------------------------------------------- */
    startSession() {
        this.clearTimer();
        this.session = this.buildSessionForActiveNote();
        this.mode = "session";
        this.showAnswer = false;
        this._undoStack.length = 0;
        this._lastTtsKey = "";
        this._sessionStamp = Date.now();
        this.render();
    }
    startPracticeSession() {
        this.clearTimer();
        this.session = this.buildPracticeSessionForActiveNote();
        this.mode = "session";
        this.showAnswer = false;
        this._undoStack.length = 0;
        this._lastTtsKey = "";
        this._sessionStamp = Date.now();
        this.render();
    }
    backToSummary() {
        this.clearTimer();
        this.mode = "summary";
        this.session = null;
        this.showAnswer = false;
        this._undoStack.length = 0;
        this._lastTtsKey = "";
        this._moreMenuToggle = null;
        this.render();
    }
    async openCurrentInStudyView() {
        var _a;
        const scope = this.getStudyScopeForActiveFile();
        if (!scope)
            return;
        const card = this.currentCard();
        const currentCardId = card ? String((_a = card.id) !== null && _a !== void 0 ? _a : "") : "";
        const currentMcqOrder = (() => {
            var _a, _b, _c;
            if (!card || card.type !== "mcq")
                return undefined;
            const id = String((_a = card.id) !== null && _a !== void 0 ? _a : "");
            const order = (_c = (_b = this.session) === null || _b === void 0 ? void 0 : _b.mcqOrderMap) === null || _c === void 0 ? void 0 : _c[id];
            return Array.isArray(order) ? order.slice() : undefined;
        })();
        try {
            await this.plugin.openReviewerTab();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEWER)[0];
            const view = leaf === null || leaf === void 0 ? void 0 : leaf.view;
            const payload = {
                scope,
                currentCardId: currentCardId || undefined,
                showAnswer: !!this.showAnswer,
                currentMcqOrder,
            };
            if (view && typeof view.openSessionFromWidget === "function") {
                view.openSessionFromWidget(payload);
                return;
            }
            if (view && typeof view.openSession === "function") {
                view.openSession(scope);
                return;
            }
            new Notice(this._tx("ui.widget.notice.studyViewNotReady", "Study view not ready yet. Try again."));
        }
        catch (_b) {
            new Notice(this._tx("ui.widget.notice.unableToOpenStudy", "Unable to open study."));
        }
    }
    /* ---------------------------------------------------------------- */
    /*  Keyboard handler                                                 */
    /* ---------------------------------------------------------------- */
    handleKey(ev) {
        var _a, _b, _c, _d, _e;
        const t = ev.target;
        if (t &&
            (t.tagName === "INPUT" ||
                t.tagName === "TEXTAREA" ||
                t.tagName === "SELECT" ||
                t.isContentEditable))
            return;
        const key = ev.key.toLowerCase();
        const isCtrl = ev.ctrlKey || ev.metaKey;
        if (this.mode === "summary") {
            if (ev.key === "Enter" && !isCtrl) {
                ev.preventDefault();
                const cards = getCardsInActiveScope(this.plugin.store, this.activeFile, this.plugin.settings);
                if (!cards.length)
                    return;
                const queueCount = (_c = (_b = (_a = this.buildSessionForActiveNote()) === null || _a === void 0 ? void 0 : _a.queue) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0;
                if (queueCount > 0)
                    this.startSession();
                else
                    this.startPracticeSession();
            }
            return;
        }
        if (this.mode !== "session" || !this.session)
            return;
        const card = this.currentCard();
        if (!card)
            return;
        const graded = this.session.graded[String(card.id)] || null;
        const isPractice = this.session.mode === "practice";
        if (key === "e" && !isCtrl) {
            ev.preventDefault();
            this.openEditModalForCurrentCard();
            return;
        }
        if (key === "m" && !isCtrl) {
            ev.preventDefault();
            (_d = this._moreMenuToggle) === null || _d === void 0 ? void 0 : _d.call(this);
            return;
        }
        if (key === "b" && !isCtrl) {
            ev.preventDefault();
            if (isPractice)
                return;
            void this.buryCurrentCard();
            return;
        }
        if (key === "t" && !isCtrl) {
            ev.preventDefault();
            void this.openCurrentInStudyView();
            return;
        }
        if (key === "s" && !isCtrl) {
            ev.preventDefault();
            if (isPractice)
                return;
            void this.suspendCurrentCard();
            return;
        }
        if (key === "u" && !isCtrl) {
            ev.preventDefault();
            if (isPractice)
                return;
            void this.undoLastGrade();
            return;
        }
        const ioLike = card.type === "io" || card.type === "io-child";
        if (ev.key === "Enter" || ev.key === " " || ev.code === "Space" || ev.key === "ArrowRight") {
            ev.preventDefault();
            if (card.type === "mcq") {
                if (graded) {
                    void this.nextCard();
                    return;
                }
                // Multi-answer: Enter submits the selection
                if (isMultiAnswerMcq(card) && this._mcqMultiSelected.size > 0) {
                    void this.answerMcqMulti([...this._mcqMultiSelected]);
                    return;
                }
                // Multi-answer: shake + tooltip on empty submit
                if (isMultiAnswerMcq(card) && this._mcqMultiSelected.size === 0) {
                    const submitBtnEl = this.containerEl.querySelector(".learnkit-mcq-submit-btn");
                    if (submitBtnEl) {
                        submitBtnEl.classList.add("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
                        submitBtnEl.addEventListener("animationend", () => {
                            submitBtnEl.classList.remove("learnkit-mcq-submit-shake", "learnkit-mcq-submit-shake");
                        }, { once: true });
                        if (submitBtnEl.dataset.emptyAttempt === "1") {
                            submitBtnEl.setAttribute("aria-label", this._tx("ui.reviewer.mcq.chooseOne", "Choose at least one answer to proceed"));
                            submitBtnEl.setAttribute("data-tooltip-position", "top");
                            submitBtnEl.classList.add("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                            setTimeout(() => {
                                submitBtnEl.classList.remove("learnkit-mcq-submit-tooltip-visible", "learnkit-mcq-submit-tooltip-visible");
                            }, 2500);
                        }
                        submitBtnEl.dataset.emptyAttempt = String(Number(submitBtnEl.dataset.emptyAttempt || "0") + 1);
                    }
                }
                return;
            }
            if (card.type === "oq") {
                if (graded) {
                    void this.nextCard();
                    return;
                }
                // Enter submits the current order
                const s = this.session;
                const oqMap = (s === null || s === void 0 ? void 0 : s.oqOrderMap) || {};
                const oqCurrentOrder = oqMap[String(card.id)];
                if (Array.isArray(oqCurrentOrder) && oqCurrentOrder.length > 0) {
                    void this.answerOq(oqCurrentOrder.slice());
                }
                return;
            }
            if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) {
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
        if (ev.key === "1" || ev.key === "2" || ev.key === "3" || ev.key === "4") {
            ev.preventDefault();
            if (card.type === "mcq") {
                const options = Array.isArray(card.options) ? card.options : [];
                const displayIdx = Number(ev.key) - 1;
                if (displayIdx < 0 || displayIdx >= options.length)
                    return;
                const randomize = !!((_e = this.plugin.settings.study) === null || _e === void 0 ? void 0 : _e.randomizeMcqOptions);
                const order = getWidgetMcqDisplayOrder(this.session, card, randomize);
                const origIdx = order[displayIdx];
                if (!Number.isInteger(origIdx))
                    return;
                if (isMultiAnswerMcq(card)) {
                    // Multi-answer: toggle selection
                    if (this._mcqMultiCardId !== String(card.id)) {
                        this._mcqMultiSelected = new Set();
                        this._mcqMultiCardId = String(card.id);
                    }
                    if (this._mcqMultiSelected.has(origIdx))
                        this._mcqMultiSelected.delete(origIdx);
                    else
                        this._mcqMultiSelected.add(origIdx);
                    this.render();
                }
                else {
                    void this.answerMcq(origIdx);
                }
                return;
            }
            if (isPractice)
                return;
            if (card.type === "basic" || card.type === "reversed" || card.type === "reversed-child" || isClozeLike(card) || ioLike) {
                if (!this.showAnswer) {
                    this.showAnswer = true;
                    this.render();
                    return;
                }
                if (!graded) {
                    const ratingMap = {
                        "1": "again",
                        "2": "hard",
                        "3": "good",
                        "4": "easy",
                    };
                    const rating = ratingMap[ev.key];
                    if (rating) {
                        void this.gradeCurrentRating(rating, {}).then(() => void this.nextCard());
                    }
                    return;
                }
                void this.nextCard();
                return;
            }
            void this.nextCard();
        }
    }
    /* ---------------------------------------------------------------- */
    /*  Top-level render dispatch                                        */
    /* ---------------------------------------------------------------- */
    render() {
        const root = this.containerEl;
        const hadFocusWithin = !!document.activeElement && root.contains(document.activeElement);
        root.empty();
        root.removeClass("learnkit");
        if (this.mode === "session")
            renderWidgetSession(this, root);
        else
            renderWidgetSummary(this, root);
        // Preserve keyboard control after rerenders (e.g. reveal -> next transitions).
        if (hadFocusWithin) {
            queueMicrotask(() => {
                if (!root.isConnected || root.offsetParent === null)
                    return;
                const active = document.activeElement;
                if (active &&
                    (active.tagName === "INPUT" ||
                        active.tagName === "TEXTAREA" ||
                        active.tagName === "SELECT" ||
                        active.isContentEditable ||
                        !!active.closest("input, textarea, select, [contenteditable]")))
                    return;
                root.focus();
            });
        }
    }
    onunload() {
        this.clearTimer();
        this._mdHelper = null;
        this._timing = null;
        this.session = null;
        this._undoStack.length = 0;
        this._moreMenuToggle = null;
        // Remove global reference set in constructor
        const globalWindow = window;
        if (globalWindow.SproutWidgetView === this) {
            delete globalWindow.SproutWidgetView;
        }
    }
}
