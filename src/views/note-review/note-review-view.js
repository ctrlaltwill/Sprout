/**
 * @file src/views/note-review/note-review-view.ts
 * @summary Module for note review view.
 *
 * @exports
 *  - SproutNoteReviewView
 */
import { Component, ItemView, MarkdownRenderer, Notice, setIcon } from "obsidian";
import { createViewHeader } from "../../platform/core/header";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_NOTE_REVIEW } from "../../platform/core/constants";
import { setCssProps } from "../../platform/core/ui";
import { SPROUT_HOME_CONTENT_SHELL_CLASS, SPROUT_TITLE_STRIP_LABEL_CLASS } from "../../platform/core/ui-classes";
import { t } from "../../platform/translations/translator";
import { initAOS, resetAOS } from "../../platform/core/aos-loader";
import { NoteReviewSqlite } from "../../platform/core/note-review-sqlite";
import { computeLkrsLoadFactor, initialLkrsDueTime, reviewWithLkrs } from "../../engine/note-review/lkrs";
import { defaultFsrsNoteRow, gradeNoteFsrs, gradeNoteFsrsPass } from "../../engine/note-review/fsrs";
import { renderStudySessionHeader } from "../reviewer/study-session-header";
import { decodePropertyPair, extractFilePropertyPairs, extractFileTags } from "../shared/scope-metadata";
const SUSPEND_FAR_DAYS = 36500;
export class SproutNoteReviewView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this._header = null;
        this._rootEl = null;
        this._titleStripEl = null;
        this._titleTimerHostEl = null;
        this._notesDb = null;
        this._queue = [];
        this._queueIndex = 0;
        this._mdComponent = null;
        this._renderToken = 0;
        this._dockMoreOpen = false;
        this._queueSessionTotal = 0;
        this._queueSessionDone = 0;
        this._queueDueCount = 0;
        this._hasInitAos = false;
        this._didEntranceAos = false;
        this._practiceMode = false;
        this._practiceQueueCompleted = false;
        this._filteredNotes = [];
        this._coachScope = null;
        this._coachTargetCount = null;
        this._coachIncludeNotDue = false;
        this._coachNoScheduling = false;
        this._coachTrackProgress = true;
        this._returnToCoach = false;
        this._ignoreDailyReviewLimit = false;
        this._suppressEntranceAosOnce = false;
        this._moreWrapEl = null;
        this._morePopoverEl = null;
        this._moreCleanup = null;
        this.plugin = plugin;
    }
    getViewType() {
        return VIEW_TYPE_NOTE_REVIEW;
    }
    getDisplayText() {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.view.noteReview.title", "Notes");
    }
    getIcon() {
        return "notebook-text";
    }
    async onOpen() {
        var _a, _b, _c, _d, _e, _f;
        if (!this._mdComponent) {
            this._mdComponent = new Component();
            this._mdComponent.load();
        }
        this._notesDb = new NoteReviewSqlite(this.plugin);
        await this._notesDb.open();
        await this._refreshQueue(true);
        this._didEntranceAos = false;
        this._registerHotkeys();
        this.render();
        if (((_c = (_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.enableAnimations) !== null && _c !== void 0 ? _c : true) &&
            ((_f = (_e = (_d = this.plugin.settings) === null || _d === void 0 ? void 0 : _d.noteReview) === null || _e === void 0 ? void 0 : _e.enableSessionAnimations) !== null && _f !== void 0 ? _f : true)) {
            setTimeout(() => {
                initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
            }, 100);
        }
        await Promise.resolve();
    }
    async onClose() {
        var _a, _b, _c, _d;
        (_b = (_a = this._header) === null || _a === void 0 ? void 0 : _a.dispose) === null || _b === void 0 ? void 0 : _b.call(_a);
        this._header = null;
        (_c = this._titleStripEl) === null || _c === void 0 ? void 0 : _c.remove();
        this._titleStripEl = null;
        this._titleTimerHostEl = null;
        if (this._notesDb) {
            await this._notesDb.close();
        }
        (_d = this._mdComponent) === null || _d === void 0 ? void 0 : _d.unload();
        this._mdComponent = null;
        this._notesDb = null;
        resetAOS();
        await Promise.resolve();
    }
    onRefresh() {
        this._dockMoreOpen = false;
        void this._refreshQueue(true).then(() => this.render());
    }
    setCoachScope(scope) {
        this._coachScope = scope;
        if (!scope) {
            this._coachNoScheduling = false;
            this._coachTrackProgress = true;
        }
        void this._refreshQueue(true).then(() => this.render());
    }
    setReturnToCoach(enabled) {
        this._returnToCoach = !!enabled;
    }
    setSuppressEntranceAosOnce(enabled) {
        this._suppressEntranceAosOnce = !!enabled;
    }
    setIgnoreDailyReviewLimit(enabled) {
        this._ignoreDailyReviewLimit = !!enabled;
        void this._refreshQueue(true).then(() => this.render());
    }
    startCoachDueSession(scope, options) {
        this._coachScope = scope;
        this._coachTargetCount = Number.isFinite(Number(options === null || options === void 0 ? void 0 : options.targetCount))
            ? Math.max(0, Math.floor(Number(options === null || options === void 0 ? void 0 : options.targetCount)))
            : null;
        this._coachIncludeNotDue = (options === null || options === void 0 ? void 0 : options.includeNotDue) === true;
        this._coachNoScheduling = (options === null || options === void 0 ? void 0 : options.noScheduling) === true;
        this._coachTrackProgress = (options === null || options === void 0 ? void 0 : options.trackCoachProgress) !== false;
        this._returnToCoach = true;
        this._ignoreDailyReviewLimit = true;
        this._practiceMode = false;
        this._practiceQueueCompleted = false;
        this._queueIndex = 0;
        this._queueSessionDone = 0;
        this._dockMoreOpen = false;
        void this._refreshQueue(true).then(() => this.render());
    }
    _getNow() {
        return Date.now();
    }
    async _trackNoteReviewAction(file, action) {
        var _a;
        if (!file)
            return;
        this.plugin.store.appendAnalyticsNoteReview({
            at: Date.now(),
            noteId: file.path,
            sourceNotePath: file.path,
            mode: this._practiceMode || this._coachNoScheduling ? "practice" : "scheduled",
            action,
            algorithm: ((_a = this.plugin.settings.noteReview) === null || _a === void 0 ? void 0 : _a.algorithm) === "lkrs" ? "lkrs" : "fsrs",
        });
        if ((action === "pass" || action === "fail" || action === "read") && this._coachScope && this._coachTrackProgress && !this._coachNoScheduling) {
            await this.plugin.recordCoachProgressForScope(this._coachScope, "note", 1);
        }
    }
    _advanceNoSchedulingQueue() {
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex += 1;
        if (this._queueIndex > this._queue.length)
            this._queueIndex = this._queue.length;
        this._dockMoreOpen = false;
        this.render();
    }
    _startOfTomorrowUtc(now) {
        const d = new Date(now);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.getTime();
    }
    _farFuture(now) {
        return now + SUSPEND_FAR_DAYS * 24 * 60 * 60 * 1000;
    }
    _parseFilterQuery(query) {
        const safeDecodeURI = (v) => {
            try {
                return decodeURIComponent(v);
            }
            catch (_a) {
                return v;
            }
        };
        const parts = String(query || "")
            .split(/\s+/)
            .map((x) => x.trim())
            .filter(Boolean);
        const includePath = [];
        const excludePath = [];
        const includeNote = [];
        const excludeNote = [];
        const includeTag = [];
        const excludeTag = [];
        const includeProp = [];
        const excludeProp = [];
        const includeText = [];
        const excludeText = [];
        let includeVault = false;
        let excludeVault = false;
        for (const part of parts) {
            const lowered = part.toLowerCase();
            if (lowered === "scope:vault" || lowered === "vault") {
                includeVault = true;
            }
            else if (lowered === "-scope:vault" || lowered === "-vault") {
                excludeVault = true;
            }
            else if (lowered.startsWith("path:")) {
                includePath.push(safeDecodeURI(lowered.slice(5)));
            }
            else if (lowered.startsWith("-path:")) {
                excludePath.push(safeDecodeURI(lowered.slice(6)));
            }
            else if (lowered.startsWith("note:")) {
                includeNote.push(safeDecodeURI(String(part.slice(5)).trim()));
            }
            else if (lowered.startsWith("-note:")) {
                excludeNote.push(safeDecodeURI(String(part.slice(6)).trim()));
            }
            else if (lowered.startsWith("tag:")) {
                includeTag.push(safeDecodeURI(String(lowered.slice(4)).trim()).replace(/^#+/, ""));
            }
            else if (lowered.startsWith("-tag:")) {
                excludeTag.push(safeDecodeURI(String(lowered.slice(5)).trim()).replace(/^#+/, ""));
            }
            else if (lowered.startsWith("prop:")) {
                includeProp.push(safeDecodeURI(String(part.slice(5)).trim()).toLowerCase());
            }
            else if (lowered.startsWith("-prop:")) {
                excludeProp.push(safeDecodeURI(String(part.slice(6)).trim()).toLowerCase());
            }
            else if (lowered.startsWith("-")) {
                excludeText.push(lowered.slice(1));
            }
            else {
                includeText.push(lowered);
            }
        }
        return {
            includePath,
            excludePath,
            includeNote: includeNote.filter(Boolean),
            excludeNote: excludeNote.filter(Boolean),
            includeVault,
            excludeVault,
            includeTag: includeTag.filter(Boolean),
            excludeTag: excludeTag.filter(Boolean),
            includeProp: includeProp.filter(Boolean),
            excludeProp: excludeProp.filter(Boolean),
            includeText,
            excludeText,
        };
    }
    _matchesFilter(file, query) {
        const p = file.path.toLowerCase();
        const f = this._parseFilterQuery(query);
        const tags = extractFileTags(this.app, file);
        const props = new Set(extractFilePropertyPairs(this.app, file).map((pair) => `${pair.key}=${pair.value}`));
        const hasIncludeCriteria = f.includeVault
            || f.includePath.length > 0
            || f.includeNote.length > 0
            || f.includeTag.length > 0
            || f.includeProp.length > 0
            || f.includeText.length > 0;
        const matchesInclude = f.includeVault
            || f.includePath.some((token) => token && p.includes(token))
            || f.includeNote.some((token) => token && file.path === token)
            || f.includeTag.some((token) => token && tags.has(token))
            || f.includeProp.some((token) => token && props.has(token))
            || f.includeText.some((token) => token && p.includes(token));
        if (hasIncludeCriteria && !matchesInclude)
            return false;
        if (f.excludeVault)
            return false;
        if (f.excludePath.some((token) => token && p.includes(token)))
            return false;
        if (f.excludeNote.some((token) => token && file.path === token))
            return false;
        if (f.excludeTag.some((token) => token && tags.has(token)))
            return false;
        if (f.excludeProp.some((token) => token && props.has(token)))
            return false;
        if (f.excludeText.some((token) => token && p.includes(token)))
            return false;
        return true;
    }
    _isFolderNote(file) {
        const path = String(file.path || "").trim();
        if (!path.includes("/"))
            return false;
        const parts = path.split("/").filter(Boolean);
        if (parts.length < 2)
            return false;
        const fileBase = String(file.basename || "").trim().toLowerCase();
        const parentFolder = String(parts[parts.length - 2] || "").trim().toLowerCase();
        if (!fileBase || !parentFolder)
            return false;
        return fileBase === parentFolder;
    }
    async _refreshQueue(resetProgress = false) {
        var _a, _b, _c, _d, _e;
        const files = this.app.vault.getMarkdownFiles();
        const cfg = this.plugin.settings.noteReview;
        const filterQuery = String((_a = cfg === null || cfg === void 0 ? void 0 : cfg.filterQuery) !== null && _a !== void 0 ? _a : "").trim();
        const shouldAvoidFolderNotes = (cfg === null || cfg === void 0 ? void 0 : cfg.avoidFolderNotes) !== false;
        let groupNotePaths = null;
        if (((_b = this._coachScope) === null || _b === void 0 ? void 0 : _b.type) === "group") {
            groupNotePaths = new Set();
            for (const card of this.plugin.store.getAllCards()) {
                const groups = Array.isArray(card.groups) ? card.groups : [];
                if (!groups.some((g) => { var _a; return String(g || "") === ((_a = this._coachScope) === null || _a === void 0 ? void 0 : _a.key); }))
                    continue;
                const path = String(card.sourceNotePath || "").trim();
                if (path)
                    groupNotePaths.add(path);
            }
        }
        const filtered = files.filter((file) => {
            if (this._coachScope) {
                if (this._coachScope.type === "group" && groupNotePaths && !groupNotePaths.has(file.path))
                    return false;
                if (this._coachScope.type === "note" && file.path !== this._coachScope.key)
                    return false;
                if (this._coachScope.type === "folder") {
                    const key = String(this._coachScope.key || "");
                    if (!(file.path === key || file.path.startsWith(`${key}/`)))
                        return false;
                }
                if (this._coachScope.type === "tag") {
                    const expected = String(this._coachScope.key || "").trim().toLowerCase().replace(/^#+/, "");
                    if (!extractFileTags(this.app, file).has(expected))
                        return false;
                }
                if (this._coachScope.type === "property") {
                    const pair = decodePropertyPair(this._coachScope.key);
                    if (!pair)
                        return false;
                    const matches = extractFilePropertyPairs(this.app, file)
                        .some((entry) => entry.key === pair.key && entry.value === pair.value);
                    if (!matches)
                        return false;
                }
            }
            if (shouldAvoidFolderNotes && this._isFolderNote(file))
                return false;
            return this._matchesFilter(file, filterQuery);
        });
        this._filteredNotes = filtered;
        if (this._practiceMode) {
            this._queue = this._shuffleFiles(filtered);
            this._queueIndex = 0;
            this._practiceQueueCompleted = false;
            if (resetProgress) {
                this._queueSessionTotal = this._queue.length;
                this._queueSessionDone = 0;
            }
            return;
        }
        if (!this._notesDb) {
            this._queue = filtered;
            this._queueIndex = 0;
            return;
        }
        const steps = (((_c = cfg === null || cfg === void 0 ? void 0 : cfg.reviewStepsDays) === null || _c === void 0 ? void 0 : _c.length) ? cfg.reviewStepsDays : [1, 7, 30, 365]).map((n) => Math.max(1, Number(n) || 1));
        const perDay = Math.max(1, Number((_d = cfg === null || cfg === void 0 ? void 0 : cfg.reviewsPerDay) !== null && _d !== void 0 ? _d : 10));
        const total = filtered.length;
        const now = this._getNow();
        const loadFactor = computeLkrsLoadFactor(total, { reviewsPerDay: perDay, reviewStepsDays: steps });
        for (const file of filtered) {
            const existing = this._notesDb.getNoteState(file.path);
            if (existing)
                continue;
            const firstStep = (_e = steps[0]) !== null && _e !== void 0 ? _e : 1;
            const next = initialLkrsDueTime(file.path, now, firstStep, loadFactor);
            this._notesDb.upsertNoteState({
                note_id: file.path,
                step_index: 0,
                last_review_time: null,
                next_review_time: next,
                weight: 1,
                buried_until: null,
                reps: 0,
                lapses: 0,
                learning_step_index: 0,
                scheduled_days: 0,
                stability_days: null,
                difficulty: null,
                fsrs_state: 0,
                suspended_due: null,
            });
        }
        await this._notesDb.persist();
        const dueLimit = this._ignoreDailyReviewLimit ? Number.MAX_SAFE_INTEGER : perDay;
        const dueIds = this._notesDb.listDueNoteIds(now, dueLimit);
        const byPath = new Map(filtered.map((f) => [f.path, f]));
        let queue = dueIds.map((id) => byPath.get(id)).filter((f) => !!f);
        const actualDueCount = queue.length;
        // For fillFromFuture / coach includeNotDue: exclude notes already reviewed
        // today so they don't reappear after the session ends or the app restarts.
        const startOfTodayUtc = this._startOfTomorrowUtc(now) - 24 * 60 * 60 * 1000;
        const isReviewedToday = (path) => {
            var _a;
            const st = (_a = this._notesDb) === null || _a === void 0 ? void 0 : _a.getNoteState(path);
            return st != null && st.last_review_time != null && st.last_review_time >= startOfTodayUtc;
        };
        if (this._coachScope && this._coachTargetCount != null) {
            const targetCount = this._coachTargetCount;
            if (targetCount <= 0) {
                queue = [];
            }
            else {
                if (this._coachIncludeNotDue && queue.length < targetCount) {
                    const queuedPaths = new Set(queue.map((f) => f.path));
                    const remaining = filtered.filter((f) => !queuedPaths.has(f.path) && !isReviewedToday(f.path));
                    remaining.sort((a, b) => {
                        var _a, _b, _c, _d, _e, _f;
                        const aDue = (_c = (_b = (_a = this._notesDb) === null || _a === void 0 ? void 0 : _a.getNoteState(a.path)) === null || _b === void 0 ? void 0 : _b.next_review_time) !== null && _c !== void 0 ? _c : Number.MAX_SAFE_INTEGER;
                        const bDue = (_f = (_e = (_d = this._notesDb) === null || _d === void 0 ? void 0 : _d.getNoteState(b.path)) === null || _e === void 0 ? void 0 : _e.next_review_time) !== null && _f !== void 0 ? _f : Number.MAX_SAFE_INTEGER;
                        return Number(aDue) - Number(bDue);
                    });
                    queue = [...queue, ...remaining.slice(0, Math.max(0, targetCount - queue.length))];
                }
                queue = queue.slice(0, targetCount);
            }
        }
        else if ((cfg === null || cfg === void 0 ? void 0 : cfg.fillFromFutureWhenUnderLimit) !== false && queue.length < dueLimit) {
            const queuedPaths = new Set(queue.map((f) => f.path));
            const remaining = filtered.filter((f) => !queuedPaths.has(f.path) && !isReviewedToday(f.path));
            remaining.sort((a, b) => {
                var _a, _b, _c, _d, _e, _f;
                const aDue = (_c = (_b = (_a = this._notesDb) === null || _a === void 0 ? void 0 : _a.getNoteState(a.path)) === null || _b === void 0 ? void 0 : _b.next_review_time) !== null && _c !== void 0 ? _c : Number.MAX_SAFE_INTEGER;
                const bDue = (_f = (_e = (_d = this._notesDb) === null || _d === void 0 ? void 0 : _d.getNoteState(b.path)) === null || _e === void 0 ? void 0 : _e.next_review_time) !== null && _f !== void 0 ? _f : Number.MAX_SAFE_INTEGER;
                return Number(aDue) - Number(bDue);
            });
            queue = [...queue, ...remaining.slice(0, Math.max(0, dueLimit - queue.length))];
        }
        // When due notes are exhausted and fillFromFuture is off, the queue stays
        // empty so the session shows the "No notes are due" screen and offers
        // an explicit practice session.
        this._queue = queue;
        if (this._queueIndex >= this._queue.length)
            this._queueIndex = 0;
        if (resetProgress) {
            this._queueSessionTotal = this._queue.length;
            this._queueSessionDone = 0;
            this._queueDueCount = actualDueCount;
            this._practiceQueueCompleted = false;
        }
    }
    _currentNote() {
        var _a;
        if (!this._queue.length)
            return null;
        const idx = Math.max(0, this._queueIndex);
        if (idx >= this._queue.length)
            return null;
        return (_a = this._queue[idx]) !== null && _a !== void 0 ? _a : null;
    }
    _shuffleFiles(files) {
        const next = files.slice();
        for (let i = next.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [next[i], next[j]] = [next[j], next[i]];
        }
        return next;
    }
    _startPracticeSession() {
        this._practiceMode = true;
        this._practiceQueueCompleted = false;
        this._queue = this._shuffleFiles(this._filteredNotes);
        this._queueIndex = 0;
        this._queueSessionTotal = this._queue.length;
        this._queueSessionDone = 0;
        this._dockMoreOpen = false;
        this.render();
    }
    _advancePracticeQueue() {
        if (!this._queue.length) {
            this._practiceQueueCompleted = true;
            this.render();
            return;
        }
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex += 1;
        if (this._queueIndex >= this._queue.length) {
            this._practiceQueueCompleted = true;
        }
        this._dockMoreOpen = false;
        this.render();
    }
    _renderEmptySessionState(host) {
        var _a, _b;
        const lang = (_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage;
        const isPracticeComplete = this._practiceMode && this._practiceQueueCompleted;
        const isCoachSession = !!this._coachScope;
        const isPhoneMobile = document.body.classList.contains("is-phone");
        const coachLabel = "Coach";
        const backToCoachLabel = `${t(lang, "ui.reviewer.session.backTo", "Back to")} ${coachLabel}`;
        const exitToHomeLabel = `${t(lang, "ui.reviewer.session.exitTo", "Exit to")} ${t(lang, "ui.reviewer.session.scope.home", "Home")}`;
        const card = host.createDiv({ cls: "card w-full learnkit-session-card lk-session-card m-0 learnkit-note-review-empty learnkit-note-review-empty" });
        const topBar = card.createDiv({ cls: "learnkit-note-review-topbar learnkit-note-review-topbar" });
        topBar.createDiv({
            cls: "learnkit-note-review-topbar-title learnkit-note-review-topbar-title",
            text: t(lang, "ui.view.noteReview.title", "Notes"),
        });
        const topBarActions = topBar.createDiv({ cls: "learnkit-note-review-topbar-actions learnkit-note-review-topbar-actions" });
        const quitBtn = topBarActions.createEl("button");
        if (isCoachSession) {
            quitBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-toolbar", "learnkit-btn-filter", "learnkit-btn-filter", "h-7", "px-3", "text-sm", "inline-flex", "items-center", "gap-2", "learnkit-scope-clear-btn", "learnkit-scope-clear-btn", "learnkit-note-review-quit-coach-btn", "learnkit-note-review-quit-coach-btn");
        }
        else {
            quitBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-toolbar", "learnkit-btn-filter", "learnkit-btn-filter", "h-7", "px-3", "text-sm", "inline-flex", "items-center", "gap-2", "learnkit-scope-clear-btn", "learnkit-scope-clear-btn", "learnkit-note-review-quit-btn", "learnkit-note-review-quit-btn");
        }
        quitBtn.setAttr("type", "button");
        quitBtn.setAttr("aria-label", isCoachSession ? backToCoachLabel : exitToHomeLabel);
        quitBtn.setAttr("data-tooltip-position", "top");
        const quitIconWrap = quitBtn.createSpan({ cls: "inline-flex items-center justify-center" });
        setIcon(quitIconWrap, "x");
        quitBtn.addEventListener("click", () => {
            void this._quitToHome();
        });
        const section = card.createEl("section", { cls: "flex flex-col gap-3 learnkit-session-practice-prompt learnkit-session-practice-prompt" });
        if (isCoachSession) {
            section.createDiv({
                cls: "text-base text-center",
                text: t(lang, "ui.noteReview.session.coachDoneBody", "All due notes for your study plan have been reviewed for today."),
            });
        }
        else if (isPracticeComplete) {
            section.createDiv({
                cls: "text-base text-center",
                text: t(lang, "ui.reviewer.session.practiceSessionComplete", "Practice session complete"),
            });
            section.createDiv({
                cls: "text-sm text-center learnkit-session-practice-prompt-subtext learnkit-session-practice-prompt-subtext",
                text: t(lang, "ui.view.noteReview.empty.practiceCompleteDetail", "This was a practice session. Scheduling was not changed. You cannot bury or suspend notes in this mode."),
            });
        }
        else {
            section.createDiv({
                cls: "text-base text-center",
                text: t(lang, "ui.view.noteReview.empty.askStartPractice", "Would you like to start a practice session?"),
            });
            section.createDiv({
                cls: "text-sm text-center learnkit-session-practice-prompt-subtext learnkit-session-practice-prompt-subtext",
                text: t(lang, "ui.view.noteReview.empty.practicePrompt", "Practice session reviews all notes in this deck, including ones that are not due. It does not affect scheduling. You cannot bury or suspend notes while in this mode"),
            });
        }
        // Footer
        const footer = card.createEl("footer", { cls: "learnkit-session-study-dock learnkit-session-study-dock" });
        const footerLeft = footer.createDiv({ cls: "flex items-center gap-2 learnkit-session-study-dock-left learnkit-session-study-dock-left" });
        const footerCenter = footer.createDiv({ cls: "flex flex-wrap gap-2 items-center justify-center learnkit-session-study-dock-center learnkit-session-study-dock-center" });
        const footerRight = footer.createDiv({ cls: "flex items-center gap-2 learnkit-session-study-dock-right learnkit-session-study-dock-right" });
        const homeBtn = document.createElement("button");
        homeBtn.className = "learnkit-btn-toolbar learnkit-btn-filter";
        homeBtn.setAttr("type", "button");
        homeBtn.setAttr("aria-label", isCoachSession
            ? t(lang, "ui.reviewer.session.backToCoach", "Back to Coach")
            : t(lang, "ui.reviewer.session.returnToHome", "Return to Home"));
        homeBtn.setAttr("data-tooltip-position", "top");
        homeBtn.textContent = isCoachSession
            ? t(lang, "ui.reviewer.session.backToCoach", "Back to Coach")
            : t(lang, "ui.reviewer.session.returnToHome", "Return to Home");
        if (!isPhoneMobile) {
            homeBtn.createEl("kbd", { text: "Q", cls: "kbd ml-2" });
        }
        homeBtn.addEventListener("click", () => {
            void this._quitToHome();
        });
        const canShowPractice = !isCoachSession && !this._practiceMode && this._filteredNotes.length > 0;
        if (canShowPractice) {
            const practiceBtn = document.createElement("button");
            practiceBtn.className = "learnkit-btn-toolbar learnkit-btn-filter";
            practiceBtn.setAttr("type", "button");
            practiceBtn.setAttr("aria-label", t(lang, "ui.reviewer.session.startPractice", "Start Practice"));
            practiceBtn.setAttr("data-tooltip-position", "top");
            practiceBtn.textContent = t(lang, "ui.reviewer.session.startPractice", "Start Practice");
            if (!isPhoneMobile) {
                practiceBtn.createEl("kbd", { text: "↵", cls: "kbd ml-2" });
            }
            practiceBtn.addEventListener("click", () => {
                this._startPracticeSession();
            });
            footerLeft.appendChild(homeBtn);
            footerRight.appendChild(practiceBtn);
        }
        else {
            footerCenter.appendChild(homeBtn);
        }
    }
    async _markCurrentAsRead() {
        var _a, _b, _c, _d, _e, _f;
        const file = this._currentNote();
        if (!file)
            return;
        if (this._practiceMode || this._coachNoScheduling) {
            await this._trackNoteReviewAction(file, "read");
            this._advanceNoSchedulingQueue();
            return;
        }
        if (!this._notesDb)
            return;
        const cfg = this.plugin.settings.noteReview;
        const steps = (((_a = cfg === null || cfg === void 0 ? void 0 : cfg.reviewStepsDays) === null || _a === void 0 ? void 0 : _a.length) ? cfg.reviewStepsDays : [1, 7, 30, 365]).map((n) => Math.max(1, Number(n) || 1));
        const perDay = Math.max(1, Number((_b = cfg === null || cfg === void 0 ? void 0 : cfg.reviewsPerDay) !== null && _b !== void 0 ? _b : 10));
        const now = this._getNow();
        const current = (_c = this._notesDb.getNoteState(file.path)) !== null && _c !== void 0 ? _c : defaultFsrsNoteRow(file.path, now);
        let nextRow;
        if ((cfg === null || cfg === void 0 ? void 0 : cfg.algorithm) === "lkrs") {
            const next = reviewWithLkrs({
                noteId: current.note_id,
                stepIndex: current.step_index,
                lastReviewTime: (_d = current.last_review_time) !== null && _d !== void 0 ? _d : undefined,
                nextReviewTime: current.next_review_time,
                weight: current.weight,
            }, now, { reviewsPerDay: perDay, reviewStepsDays: steps }, Math.max(1, this.app.vault.getMarkdownFiles().length));
            nextRow = {
                note_id: next.noteId,
                step_index: next.stepIndex,
                last_review_time: (_e = next.lastReviewTime) !== null && _e !== void 0 ? _e : null,
                next_review_time: next.nextReviewTime,
                weight: (_f = next.weight) !== null && _f !== void 0 ? _f : 1,
                buried_until: null,
                reps: current.reps,
                lapses: current.lapses,
                learning_step_index: current.learning_step_index,
                scheduled_days: current.scheduled_days,
                stability_days: current.stability_days,
                difficulty: current.difficulty,
                fsrs_state: current.fsrs_state,
                suspended_due: current.suspended_due,
            };
        }
        else {
            nextRow = gradeNoteFsrsPass(current, now, { scheduling: this._noteReviewFsrsConfig() });
        }
        this._notesDb.upsertNoteState(nextRow);
        await this._trackNoteReviewAction(file, "read");
        await this._notesDb.persist();
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex += 1;
        await this._refreshQueue();
        this._dockMoreOpen = false;
        this.render();
    }
    _noteReviewFsrsConfig() {
        var _a, _b, _c, _d;
        const nr = this.plugin.settings.noteReview;
        const fallback = this.plugin.settings.scheduling;
        return {
            learningStepsMinutes: (_a = nr.fsrsLearningStepsMinutes) !== null && _a !== void 0 ? _a : fallback.learningStepsMinutes,
            relearningStepsMinutes: (_b = nr.fsrsRelearningStepsMinutes) !== null && _b !== void 0 ? _b : fallback.relearningStepsMinutes,
            requestRetention: (_c = nr.fsrsRetention) !== null && _c !== void 0 ? _c : fallback.requestRetention,
            enableFuzz: (_d = nr.fsrsEnableFuzz) !== null && _d !== void 0 ? _d : fallback.enableFuzz,
        };
    }
    async _gradeCurrentFsrs(outcome) {
        var _a;
        const file = this._currentNote();
        if (!file)
            return;
        if (this._practiceMode || this._coachNoScheduling) {
            await this._trackNoteReviewAction(file, outcome);
            this._advanceNoSchedulingQueue();
            return;
        }
        if (!this._notesDb)
            return;
        const now = this._getNow();
        const current = (_a = this._notesDb.getNoteState(file.path)) !== null && _a !== void 0 ? _a : defaultFsrsNoteRow(file.path, now);
        const nextRow = gradeNoteFsrs(current, now, { scheduling: this._noteReviewFsrsConfig() }, outcome);
        this._notesDb.upsertNoteState(nextRow);
        await this._trackNoteReviewAction(file, outcome);
        await this._notesDb.persist();
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex += 1;
        await this._refreshQueue();
        this._dockMoreOpen = false;
        this.render();
    }
    async _buryCurrentNote() {
        var _a;
        const file = this._currentNote();
        if (!file || !this._notesDb)
            return;
        const now = this._getNow();
        const until = this._startOfTomorrowUtc(now);
        const current = (_a = this._notesDb.getNoteState(file.path)) !== null && _a !== void 0 ? _a : {
            note_id: file.path,
            step_index: 0,
            last_review_time: null,
            next_review_time: until,
            weight: 1,
            buried_until: until,
            reps: 0,
            lapses: 0,
            learning_step_index: 0,
            scheduled_days: 0,
            stability_days: null,
            difficulty: null,
            fsrs_state: 0,
            suspended_due: null,
        };
        this._notesDb.upsertNoteState({
            ...current,
            next_review_time: Math.max(current.next_review_time, until),
            buried_until: until,
        });
        await this._trackNoteReviewAction(file, "bury");
        await this._notesDb.persist();
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex += 1;
        await this._refreshQueue();
        this.render();
    }
    _skipCurrent() {
        const file = this._currentNote();
        if (!file || !this._queue.length)
            return;
        void this._trackNoteReviewAction(file, "skip");
        if (this._practiceMode) {
            this._advancePracticeQueue();
            return;
        }
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex = Math.min(this._queue.length, this._queueIndex + 1);
        if (this._queueIndex >= this._queue.length)
            this._queueIndex = 0;
        this._dockMoreOpen = false;
        this.render();
    }
    async _suspendCurrentNote() {
        var _a;
        const file = this._currentNote();
        if (!file || !this._notesDb)
            return;
        const now = this._getNow();
        const current = (_a = this._notesDb.getNoteState(file.path)) !== null && _a !== void 0 ? _a : defaultFsrsNoteRow(file.path, now);
        this._notesDb.upsertNoteState({
            ...current,
            suspended_due: current.next_review_time,
            next_review_time: this._farFuture(now),
            buried_until: null,
        });
        await this._trackNoteReviewAction(file, "suspend");
        await this._notesDb.persist();
        this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
        this._queueIndex += 1;
        await this._refreshQueue();
        this._dockMoreOpen = false;
        this.render();
    }
    async _quitToHome() {
        this._dockMoreOpen = false;
        this._practiceMode = false;
        this._practiceQueueCompleted = false;
        if (this._returnToCoach) {
            this._returnToCoach = false;
            await this.plugin.openCoachTab(false, { suppressEntranceAos: true, refresh: false }, this.leaf);
            return;
        }
        await this.plugin.openHomeTab();
    }
    _registerHotkeys() {
        this.registerDomEvent(document, "keydown", (evt) => {
            var _a;
            if (!this._rootEl || !this.contentEl.isConnected)
                return;
            const target = evt.target;
            const inEditable = !!target &&
                (target.isContentEditable ||
                    target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT");
            if (inEditable)
                return;
            if (evt.metaKey || evt.ctrlKey || evt.altKey)
                return;
            const hasCurrent = !!this._currentNote();
            const algorithm = ((_a = this.plugin.settings.noteReview) === null || _a === void 0 ? void 0 : _a.algorithm) === "lkrs" ? "lkrs" : "fsrs";
            const key = evt.key.toLowerCase();
            if (key === "q") {
                evt.preventDefault();
                void this._quitToHome();
                return;
            }
            if (key === "m") {
                if (this._practiceMode || this._coachNoScheduling)
                    return;
                evt.preventDefault();
                this._toggleDockMore();
                return;
            }
            if (key === "escape" && this._dockMoreOpen) {
                evt.preventDefault();
                this._closeDockMore();
                return;
            }
            if (!hasCurrent) {
                if (key === "enter" && !this._coachScope && !this._practiceMode && this._filteredNotes.length > 0) {
                    evt.preventDefault();
                    this._startPracticeSession();
                }
                return;
            }
            if (key === "o") {
                evt.preventDefault();
                this._dockMoreOpen = false;
                void this._openCurrentNote();
                return;
            }
            if (key === "b") {
                if (this._practiceMode || this._coachNoScheduling)
                    return;
                evt.preventDefault();
                void this._buryCurrentNote();
                return;
            }
            if (key === "s") {
                if (this._practiceMode || this._coachNoScheduling)
                    return;
                evt.preventDefault();
                void this._suspendCurrentNote();
                return;
            }
            // Practice / no-scheduling: Enter continues, grading keys are no-ops
            if (this._practiceMode || this._coachNoScheduling) {
                if (key === "enter") {
                    evt.preventDefault();
                    this._advanceNoSchedulingQueue();
                }
                return;
            }
            if (algorithm === "fsrs") {
                if (key === "1") {
                    evt.preventDefault();
                    void this._gradeCurrentFsrs("fail");
                    return;
                }
                if (key === "2") {
                    evt.preventDefault();
                    void this._gradeCurrentFsrs("pass");
                }
                return;
            }
            if (key === "1") {
                evt.preventDefault();
                this._skipCurrent();
                return;
            }
            if (key === "2") {
                evt.preventDefault();
                void this._markCurrentAsRead();
            }
        });
    }
    async _openCurrentNote() {
        const file = this._currentNote();
        if (!file)
            return;
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file, { active: true });
        void this.app.workspace.revealLeaf(leaf);
    }
    _applyWidthMode() {
        if (this.plugin.isWideMode)
            this.containerEl.setAttribute("data-learnkit-wide", "1");
        else
            this.containerEl.removeAttribute("data-learnkit-wide");
        const strip = this._titleStripEl;
        if (!this._rootEl && !strip)
            return;
        const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
        if (this._rootEl) {
            setCssProps(this._rootEl, "--lk-home-max-width", maxWidth);
            setCssProps(this._rootEl, "--learnkit-home-max-width", maxWidth);
            setCssProps(this._rootEl, "--learnkit-note-review-max-width", maxWidth);
        }
        if (strip) {
            setCssProps(strip, "--lk-home-max-width", maxWidth);
            setCssProps(strip, "--learnkit-home-max-width", maxWidth);
        }
    }
    _ensureTitleStrip(root) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const parent = root.parentElement;
        if (!parent)
            return;
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleTimerHostEl = null;
        const coachShellMode = !!this._coachScope || this._returnToCoach;
        const strip = document.createElement("div");
        strip.className = coachShellMode
            ? "lk-home-title-strip sprout-coach-title-strip"
            : "lk-home-title-strip learnkit-note-review-title-strip";
        const row = document.createElement("div");
        row.className = "learnkit-inline-sentence w-full flex items-center justify-between gap-[10px] learnkit-note-review-title-row";
        const left = document.createElement("div");
        left.className = "min-w-0 flex-1 flex flex-col gap-[2px]";
        const title = document.createElement("div");
        title.className = SPROUT_TITLE_STRIP_LABEL_CLASS;
        title.textContent = coachShellMode
            ? t((_c = (_b = this.plugin.settings) === null || _b === void 0 ? void 0 : _b.general) === null || _c === void 0 ? void 0 : _c.interfaceLanguage, "ui.view.coach.title", "Coach")
            : t((_e = (_d = this.plugin.settings) === null || _d === void 0 ? void 0 : _d.general) === null || _e === void 0 ? void 0 : _e.interfaceLanguage, "ui.view.noteReview.title", "Notes");
        const total = Math.max(this._queueSessionTotal, this._queue.length);
        const remaining = Math.max(0, total - this._queueSessionDone);
        const subtitle = document.createElement("div");
        subtitle.className = "text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";
        if (coachShellMode) {
            subtitle.textContent = t((_g = (_f = this.plugin.settings) === null || _f === void 0 ? void 0 : _f.general) === null || _g === void 0 ? void 0 : _g.interfaceLanguage, "ui.view.coach.subtitle", "Build and manage focused study plans.");
        }
        else if (this._practiceMode) {
            subtitle.textContent = t((_j = (_h = this.plugin.settings) === null || _h === void 0 ? void 0 : _h.general) === null || _j === void 0 ? void 0 : _j.interfaceLanguage, "ui.noteReview.title.practiceRemaining", "{count} note{suffix} left in this practice session", { count: remaining, suffix: remaining === 1 ? "" : "s" });
        }
        else if (remaining === 0) {
            subtitle.textContent = t((_l = (_k = this.plugin.settings) === null || _k === void 0 ? void 0 : _k.general) === null || _l === void 0 ? void 0 : _l.interfaceLanguage, "ui.noteReview.title.noneDue", "No notes are currently due!");
        }
        else {
            subtitle.textContent = t((_o = (_m = this.plugin.settings) === null || _m === void 0 ? void 0 : _m.general) === null || _o === void 0 ? void 0 : _o.interfaceLanguage, "ui.noteReview.title.dueRemaining", "{count} due note{suffix} remaining", { count: remaining, suffix: remaining === 1 ? "" : "s" });
        }
        left.appendChild(title);
        left.appendChild(subtitle);
        row.appendChild(left);
        const timerHost = document.createElement("div");
        timerHost.className = "learnkit-note-review-title-timer-host";
        row.appendChild(timerHost);
        strip.appendChild(row);
        root.prepend(strip);
        this._titleStripEl = strip;
        this._titleTimerHostEl = timerHost;
    }
    _buildSessionLocation(note) {
        if (!note)
            return "";
        const parts = String(note.path || "").split("/").filter(Boolean);
        if (parts.length <= 1)
            return "";
        return parts.slice(0, -1).join(" / ");
    }
    _renderNoteReviewSessionHeader(root, note) {
        const locationText = this._buildSessionLocation(note);
        if (!locationText)
            return;
        const header = root.createEl("header", { cls: "px-6 pt-4 pb-2 learnkit-note-review-session-header learnkit-note-review-session-header" });
        const locationRow = header.createDiv({ cls: "flex items-center gap-2 min-w-0" });
        locationRow.createDiv({
            cls: "text-muted-foreground learnkit-session-location-text learnkit-session-location-text",
            text: locationText,
        });
    }
    _syncOverflowLayout(panel) {
        const root = this._rootEl;
        if (!root || !panel.isConnected)
            return;
        requestAnimationFrame(() => {
            if (!root.isConnected || !panel.isConnected)
                return;
            const rootRect = root.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            const shouldUseFlexAuto = panelRect.height > rootRect.height + 1;
            root.classList.toggle("learnkit-note-review-overflow", shouldUseFlexAuto);
        });
    }
    async _renderCurrentNoteContent(host, note, token) {
        var _a, _b, _c, _d;
        const article = document.createElement("div");
        article.className = "learnkit-note-review-article card";
        const body = article.createDiv({ cls: "learnkit-note-review-note-body learnkit-note-review-note-body markdown-rendered" });
        this._renderNoteReviewSessionHeader(body, note);
        try {
            const markdown = await this.app.vault.read(note);
            if (token !== this._renderToken)
                return;
            if (!this._mdComponent) {
                this._mdComponent = new Component();
                this._mdComponent.load();
            }
            await MarkdownRenderer.render(this.app, markdown, body, note.path, this._mdComponent);
            if (token !== this._renderToken)
                return;
            if (!markdown.trim()) {
                body.createEl("p", {
                    cls: "learnkit-settings-text-muted learnkit-settings-text-muted",
                    text: t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.noteReview.note.empty", "This note is empty."),
                });
            }
        }
        catch (_e) {
            if (token !== this._renderToken)
                return;
            body.empty();
            body.createEl("p", {
                cls: "learnkit-settings-text-muted learnkit-settings-text-muted",
                text: t((_d = (_c = this.plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.interfaceLanguage, "ui.noteReview.note.loadFailed", "Could not load this note."),
            });
        }
        if (token !== this._renderToken)
            return;
        host.replaceChildren(article);
        article.classList.add("learnkit-note-review-article-enter", "learnkit-note-review-article-enter");
        requestAnimationFrame(() => {
            if (!article.isConnected)
                return;
            article.classList.add("is-visible");
        });
    }
    _closeDockMore() {
        var _a;
        this._dockMoreOpen = false;
        (_a = this._morePopoverEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._morePopoverEl = null;
        if (this._moreCleanup) {
            this._moreCleanup();
            this._moreCleanup = null;
        }
    }
    _positionDockMorePopover(moreWrap, popover) {
        const gapPx = 8;
        const stage = popover.parentElement;
        if (!stage)
            return;
        const stageRect = stage.getBoundingClientRect();
        const triggerRect = moreWrap.getBoundingClientRect();
        // Right-align with moreWrap
        setCssProps(popover, {
            left: "auto",
            right: `${stageRect.right - triggerRect.right}px`,
        });
        // Default: open above
        setCssProps(popover, {
            top: "auto",
            bottom: `${stageRect.bottom - triggerRect.top + gapPx}px`,
        });
        const popoverRect = popover.getBoundingClientRect();
        const spaceAbove = triggerRect.top - stageRect.top;
        const spaceBelow = stageRect.bottom - triggerRect.bottom;
        const shouldOpenBelow = spaceAbove < popoverRect.height + gapPx && spaceBelow > spaceAbove;
        if (shouldOpenBelow) {
            setCssProps(popover, {
                bottom: "auto",
                top: `${triggerRect.bottom - stageRect.top + gapPx}px`,
            });
        }
    }
    _toggleDockMore() {
        var _a, _b, _c;
        if (this._dockMoreOpen) {
            this._closeDockMore();
            return;
        }
        const current = (_a = this._queue[this._queueIndex]) !== null && _a !== void 0 ? _a : null;
        if (!current || this._practiceMode || this._coachNoScheduling)
            return;
        this._dockMoreOpen = true;
        const moreWrap = this._moreWrapEl;
        if (!moreWrap)
            return;
        const coachShellMode = !!this._coachScope || this._returnToCoach;
        const coachLabel = "Coach";
        const backToCoachLabel = `Back to ${coachLabel}`;
        const lang = (_c = (_b = this.plugin.settings) === null || _b === void 0 ? void 0 : _b.general) === null || _c === void 0 ? void 0 : _c.interfaceLanguage;
        const popover = document.createElement("div");
        popover.className =
            "learnkit rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 pointer-events-auto learnkit-note-review-more-popover learnkit-header-menu-panel";
        const menu = document.createElement("div");
        menu.className = "learnkit flex flex-col";
        menu.setAttribute("role", "menu");
        popover.appendChild(menu);
        const itemClass = "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
        const addItem = (label, hotkey, onClick) => {
            const item = document.createElement("div");
            item.className = itemClass;
            item.setAttribute("role", "menuitem");
            item.tabIndex = 0;
            const span = document.createElement("span");
            span.className = "";
            span.textContent = label;
            item.appendChild(span);
            const kbd = document.createElement("kbd");
            kbd.className = "kbd ml-auto text-xs text-muted-foreground tracking-widest";
            kbd.textContent = hotkey;
            item.appendChild(kbd);
            item.addEventListener("click", () => {
                this._closeDockMore();
                onClick();
            });
            item.addEventListener("keydown", (evt) => {
                if (evt.key !== "Enter" && evt.key !== " ")
                    return;
                evt.preventDefault();
                this._closeDockMore();
                onClick();
            });
            menu.appendChild(item);
        };
        addItem(t(lang, "ui.noteReview.menu.openInNote", "Open in Note"), "O", () => void this._openCurrentNote());
        addItem(t(lang, "ui.noteReview.menu.bury", "Bury"), "B", () => void this._buryCurrentNote().then(() => new Notice(t(lang, "ui.noteReview.notice.buried", "Note buried until tomorrow."))));
        addItem(t(lang, "ui.noteReview.menu.suspend", "Suspend"), "S", () => void this._suspendCurrentNote().then(() => new Notice(t(lang, "ui.noteReview.notice.suspended", "Note suspended."))));
        const undoItem = document.createElement("div");
        undoItem.className = `${itemClass} learnkit-menu-item--disabled`;
        undoItem.setAttribute("role", "menuitem");
        undoItem.tabIndex = -1;
        undoItem.setAttribute("aria-disabled", "true");
        const undoSpan = document.createElement("span");
        undoSpan.className = "";
        undoSpan.textContent = t(lang, "ui.noteReview.menu.undo", "Undo last grade");
        undoItem.appendChild(undoSpan);
        const undoKbd = document.createElement("kbd");
        undoKbd.className = "kbd ml-auto text-xs text-muted-foreground tracking-widest";
        undoKbd.textContent = t(lang, "ui.noteReview.menu.undoHotkey", "U");
        undoItem.appendChild(undoKbd);
        menu.appendChild(undoItem);
        addItem(coachShellMode ? backToCoachLabel : t(lang, "ui.noteReview.menu.exitToDecks", "Exit to Decks"), "Q", () => void this._quitToHome());
        const stage = moreWrap.closest(".learnkit-note-review-stage");
        (stage !== null && stage !== void 0 ? stage : moreWrap).appendChild(popover);
        this._morePopoverEl = popover;
        const positionPopover = () => this._positionDockMorePopover(moreWrap, popover);
        positionPopover();
        const rafId = window.requestAnimationFrame(positionPopover);
        const onDocPointerDown = (ev) => {
            const t = ev.target;
            if (!t)
                return;
            if (moreWrap.contains(t) || popover.contains(t))
                return;
            this._closeDockMore();
        };
        const onDocKeydown = (ev) => {
            if (ev.key !== "Escape")
                return;
            ev.preventDefault();
            ev.stopPropagation();
            this._closeDockMore();
        };
        const onWindowResize = () => {
            if (!this._dockMoreOpen)
                return;
            positionPopover();
        };
        const tid = window.setTimeout(() => {
            document.addEventListener("pointerdown", onDocPointerDown, true);
            document.addEventListener("keydown", onDocKeydown, true);
            window.addEventListener("resize", onWindowResize);
        }, 0);
        this._moreCleanup = () => {
            window.clearTimeout(tid);
            window.cancelAnimationFrame(rafId);
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            document.removeEventListener("keydown", onDocKeydown, true);
            window.removeEventListener("resize", onWindowResize);
        };
        const firstItem = popover.querySelector("[role='menuitem']");
        firstItem === null || firstItem === void 0 ? void 0 : firstItem.focus();
    }
    render() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        this._closeDockMore();
        const root = this.contentEl;
        const suppressEntranceAos = this._suppressEntranceAosOnce;
        this._suppressEntranceAosOnce = false;
        const coachShellMode = !!this._coachScope || this._returnToCoach;
        const preservedCoachStrip = coachShellMode
            ? root.querySelector(":scope > .lk-home-title-strip.learnkit-coach-title-strip")
            : null;
        if (preservedCoachStrip)
            preservedCoachStrip.remove();
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleStripEl = null;
        this._titleTimerHostEl = null;
        const existingHeader = root.querySelector("[data-study-session-header]");
        if (existingHeader) {
            existingHeader.remove();
        }
        root.empty();
        if (preservedCoachStrip) {
            root.appendChild(preservedCoachStrip);
            this._titleStripEl = preservedCoachStrip;
        }
        if (existingHeader) {
            root.appendChild(existingHeader);
        }
        this._rootEl = root;
        root.classList.add("learnkit-view-content", "learnkit-view-content", "learnkit-note-review-root", "learnkit-note-review-root");
        this.containerEl.addClass("learnkit");
        (_b = this.setTitle) === null || _b === void 0 ? void 0 : _b.call(this, this.getDisplayText());
        if (!preservedCoachStrip) {
            this._ensureTitleStrip(root);
        }
        const contentShell = root.createDiv({
            cls: `${SPROUT_HOME_CONTENT_SHELL_CLASS} learnkit-note-review-content-shell learnkit-session-column flex flex-col min-h-0`,
        });
        if (!this._header) {
            this._header = createViewHeader({
                view: this,
                plugin: this.plugin,
                onToggleWide: () => this._applyWidthMode(),
            });
        }
        this._header.install("notes");
        this._applyWidthMode();
        const algorithm = ((_c = this.plugin.settings.noteReview) === null || _c === void 0 ? void 0 : _c.algorithm) === "lkrs" ? "lkrs" : "fsrs";
        const totalCount = Math.max(this._queueSessionTotal, this._queue.length);
        const remainingCount = totalCount > 0 ? Math.max(0, totalCount - this._queueSessionDone) : 0;
        const progress = totalCount > 0 ? Math.min(1, Math.max(0, (totalCount - remainingCount) / totalCount)) : 0;
        const animationsEnabled = ((_f = (_e = (_d = this.plugin.settings) === null || _d === void 0 ? void 0 : _d.general) === null || _e === void 0 ? void 0 : _e.enableAnimations) !== null && _f !== void 0 ? _f : true) &&
            ((_j = (_h = (_g = this.plugin.settings) === null || _g === void 0 ? void 0 : _g.noteReview) === null || _h === void 0 ? void 0 : _h.enableSessionAnimations) !== null && _j !== void 0 ? _j : true);
        if (animationsEnabled && !this._hasInitAos && !suppressEntranceAos) {
            try {
                initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
            }
            catch (_q) {
                // best-effort
            }
            this._hasInitAos = true;
        }
        const current = this._currentNote();
        const dueSessionComplete = !this._practiceMode && !coachShellMode &&
            remainingCount <= 0 && this._queueSessionTotal > 0;
        const effectiveCurrent = dueSessionComplete ? null : current;
        renderStudySessionHeader(contentShell, (_l = (_k = this.plugin.settings) === null || _k === void 0 ? void 0 : _k.general) === null || _l === void 0 ? void 0 : _l.interfaceLanguage, false, {
            titleToken: "ui.noteReview.session.header.title",
            titleFallback: "Notes",
        });
        const clearAos = (el) => {
            if (!el)
                return;
            el.removeAttribute("data-aos");
            el.removeAttribute("data-aos-delay");
            el.removeAttribute("data-aos-duration");
            el.removeAttribute("data-aos-anchor-placement");
            el.classList.remove("aos-init", "aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
        };
        const sessionHeader = contentShell.querySelector("[data-study-session-header]");
        clearAos(sessionHeader);
        const sessionTimerRow = (_m = sessionHeader === null || sessionHeader === void 0 ? void 0 : sessionHeader.querySelector(".learnkit-session-header-left > div:nth-child(2)")) !== null && _m !== void 0 ? _m : null;
        const stripEl = this._titleStripEl;
        const titleTimerHost = this._titleTimerHostEl;
        if (titleTimerHost) {
            while (titleTimerHost.firstChild)
                titleTimerHost.removeChild(titleTimerHost.firstChild);
            if (sessionTimerRow && !coachShellMode) {
                titleTimerHost.appendChild(sessionTimerRow);
            }
        }
        if (sessionHeader) {
            sessionHeader.classList.add("learnkit-note-review-session-header-hidden", "learnkit-note-review-session-header-hidden");
        }
        clearAos(titleTimerHost);
        if (animationsEnabled && !this._didEntranceAos && !coachShellMode && !suppressEntranceAos) {
            if (stripEl) {
                clearAos(stripEl);
                stripEl.classList.remove("learnkit-note-review-enter-title", "learnkit-note-review-enter-title");
                void stripEl.offsetWidth;
                stripEl.classList.add("learnkit-note-review-enter-title", "learnkit-note-review-enter-title");
            }
            clearAos(contentShell);
            contentShell.classList.remove("learnkit-note-review-enter-shell", "learnkit-note-review-enter-shell");
            void contentShell.offsetWidth;
            contentShell.classList.add("learnkit-note-review-enter-shell", "learnkit-note-review-enter-shell");
            this._didEntranceAos = true;
        }
        else if (!animationsEnabled) {
            root.querySelectorAll("[data-aos]").forEach((el) => {
                el.classList.add("learnkit-aos-fallback", "learnkit-aos-fallback");
            });
        }
        const panel = contentShell.createDiv({ cls: "learnkit-note-review-panel learnkit-note-review-panel" });
        const lang = (_p = (_o = this.plugin.settings) === null || _o === void 0 ? void 0 : _o.general) === null || _p === void 0 ? void 0 : _p.interfaceLanguage;
        const isMobile = document.body.classList.contains("is-mobile");
        const coachLabel = "Coach";
        const backToCoachLabel = `Back to ${coachLabel}`;
        const exitToHomeLabel = `${t(lang, "ui.reviewer.session.exitTo", "Exit to")} ${t(lang, "ui.reviewer.session.scope.home", "Home")}`;
        if (effectiveCurrent) {
            const topBar = panel.createDiv({ cls: "learnkit-note-review-topbar learnkit-note-review-topbar" });
            topBar.createDiv({
                cls: "learnkit-note-review-topbar-title learnkit-note-review-topbar-title",
                text: isMobile ? effectiveCurrent.basename : `Note: ${effectiveCurrent.basename}`,
            });
            const topBarActions = topBar.createDiv({ cls: "learnkit-note-review-topbar-actions learnkit-note-review-topbar-actions" });
            const quitBtn = topBarActions.createEl("button");
            if (coachShellMode) {
                quitBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-toolbar", "learnkit-btn-filter", "learnkit-btn-filter", "h-7", "px-3", "text-sm", "inline-flex", "items-center", "gap-2", "learnkit-scope-clear-btn", "learnkit-scope-clear-btn", "learnkit-note-review-quit-coach-btn", "learnkit-note-review-quit-coach-btn");
            }
            else {
                quitBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-toolbar", "learnkit-btn-filter", "learnkit-btn-filter", "h-7", "px-3", "text-sm", "inline-flex", "items-center", "gap-2", "learnkit-scope-clear-btn", "learnkit-scope-clear-btn", "learnkit-note-review-quit-btn", "learnkit-note-review-quit-btn");
            }
            quitBtn.setAttr("type", "button");
            quitBtn.setAttr("aria-label", coachShellMode ? backToCoachLabel : exitToHomeLabel);
            quitBtn.setAttr("data-tooltip-position", "top");
            const quitIconWrap = quitBtn.createSpan({ cls: "inline-flex items-center justify-center" });
            setIcon(quitIconWrap, "x");
            quitBtn.addEventListener("click", () => {
                void this._quitToHome();
            });
        }
        const stage = panel.createDiv({ cls: "learnkit-note-review-stage learnkit-note-review-stage" });
        const viewport = stage.createDiv({ cls: "learnkit-note-review-content learnkit-note-review-content" });
        this._renderToken += 1;
        const renderToken = this._renderToken;
        if (effectiveCurrent) {
            const loadingArticle = viewport.createDiv({ cls: "learnkit-note-review-article learnkit-note-review-article card learnkit-note-review-article-loading learnkit-note-review-article-loading" });
            loadingArticle.createDiv({
                cls: "learnkit-note-review-note-body learnkit-note-review-note-body markdown-rendered learnkit-note-review-loading-copy learnkit-note-review-loading-copy",
                text: t(lang, "ui.noteReview.note.loading", "Loading note..."),
            });
            void this._renderCurrentNoteContent(viewport, effectiveCurrent, renderToken).then(() => {
                this._syncOverflowLayout(panel);
            });
        }
        else {
            this._renderEmptySessionState(viewport);
            this._syncOverflowLayout(panel);
        }
        if (!effectiveCurrent) {
            return;
        }
        const controls = stage.createDiv({ cls: "learnkit-note-review-dock learnkit-note-review-dock" });
        const left = controls.createDiv({ cls: "learnkit-note-review-dock-left learnkit-note-review-dock-left" });
        const countCard = left.createDiv({ cls: "learnkit-note-review-queue-count learnkit-note-review-queue-count" });
        setCssProps(countCard, "--learnkit-note-review-progress", `${Math.round(progress * 100)}%`);
        countCard.createDiv({
            cls: "learnkit-note-review-queue-count-label learnkit-note-review-queue-count-label",
            text: isMobile
                ? t(lang, "ui.noteReview.session.remainingOnly", "{count} remaining", { count: remainingCount })
                : t(lang, "ui.noteReview.session.remainingOfTotal", "{remaining} out of {total} remaining", {
                    remaining: remainingCount,
                    total: totalCount,
                }),
        });
        const buttonGroup = controls.createDiv({ cls: "learnkit-note-review-dock-buttons learnkit-note-review-dock-buttons" });
        if (this._practiceMode || this._coachNoScheduling) {
            // Practice / no-scheduling mode: single Next button (matches flashcard practice)
            const nextBtn = buttonGroup.createEl("button");
            nextBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-filter");
            nextBtn.setAttr("type", "button");
            nextBtn.textContent = t(lang, "ui.common.next", "Next");
            const nextKey = nextBtn.createEl("kbd", { text: "↵" });
            nextKey.classList.add("kbd", "ml-2");
            nextBtn.disabled = !current;
            nextBtn.setAttr("aria-label", t(lang, "ui.common.next", "Next"));
            nextBtn.setAttr("data-tooltip-position", "top");
            nextBtn.addEventListener("click", () => {
                this._advanceNoSchedulingQueue();
            });
        }
        else if (algorithm === "fsrs") {
            const againBtn = buttonGroup.createEl("button");
            againBtn.classList.add("btn-destructive", "learnkit-btn-again", "learnkit-btn-again");
            againBtn.createSpan({ text: t(lang, "ui.noteReview.grade.deferred", "Deferred") });
            const againKey = againBtn.createEl("kbd", { text: "1" });
            againKey.classList.add("kbd", "ml-2");
            againBtn.disabled = !current;
            againBtn.setAttr("aria-label", t(lang, "ui.noteReview.grade.deferAria", "Defer note (1)"));
            againBtn.setAttr("data-tooltip-position", "top");
            againBtn.addEventListener("click", () => {
                void this._gradeCurrentFsrs("fail");
            });
            const goodBtn = buttonGroup.createEl("button");
            goodBtn.classList.add("btn", "learnkit-btn-good", "learnkit-btn-good");
            goodBtn.createSpan({ text: t(lang, "ui.noteReview.grade.completed", "Completed") });
            const goodKey = goodBtn.createEl("kbd", { text: "2" });
            goodKey.classList.add("kbd", "ml-2");
            goodBtn.disabled = !current;
            goodBtn.setAttr("aria-label", t(lang, "ui.noteReview.grade.completedAria", "Mark note as completed (2)"));
            goodBtn.setAttr("data-tooltip-position", "top");
            goodBtn.addEventListener("click", () => {
                void this._gradeCurrentFsrs("pass");
            });
        }
        else {
            const skipBtn = buttonGroup.createEl("button");
            skipBtn.classList.add("btn-destructive", "learnkit-btn-again", "learnkit-btn-again");
            skipBtn.createSpan({ text: t(lang, "ui.noteReview.grade.deferred", "Deferred") });
            const skipKey = skipBtn.createEl("kbd", { text: "1" });
            skipKey.classList.add("kbd", "ml-2");
            skipBtn.disabled = !current;
            skipBtn.setAttr("aria-label", t(lang, "ui.noteReview.grade.deferAria", "Defer note (1)"));
            skipBtn.setAttr("data-tooltip-position", "top");
            skipBtn.addEventListener("click", () => {
                this._skipCurrent();
            });
            const markBtn = buttonGroup.createEl("button");
            markBtn.classList.add("btn", "learnkit-btn-good", "learnkit-btn-good");
            markBtn.createSpan({ text: t(lang, "ui.noteReview.grade.completed", "Completed") });
            const markKey = markBtn.createEl("kbd", { text: "2" });
            markKey.classList.add("kbd", "ml-2");
            markBtn.disabled = !current;
            markBtn.setAttr("aria-label", t(lang, "ui.noteReview.grade.completedAria", "Mark note as completed (2)"));
            markBtn.setAttr("data-tooltip-position", "top");
            markBtn.addEventListener("click", () => {
                void this._markCurrentAsRead();
            });
        }
        if (!isMobile) {
            const right = controls.createDiv({ cls: "learnkit-note-review-dock-right learnkit-note-review-dock-right" });
            const moreWrap = right.createDiv({ cls: "learnkit-note-review-more learnkit-note-review-more" });
            this._moreWrapEl = moreWrap;
            const moreBtn = moreWrap.createEl("button");
            moreBtn.disabled = !current || this._practiceMode || this._coachNoScheduling;
            moreBtn.classList.add("learnkit-note-review-more-trigger", "learnkit-note-review-more-trigger", "learnkit-btn-toolbar", "learnkit-btn-toolbar");
            moreBtn.setAttr("aria-label", t(lang, "ui.noteReview.menu.moreAria", "More actions"));
            const moreIconWrap = moreBtn.createSpan({ cls: "inline-flex items-center justify-center" });
            setIcon(moreIconWrap, "ellipsis");
            moreBtn.createSpan({
                cls: "learnkit-note-review-more-label learnkit-note-review-more-label",
                text: t(lang, "ui.noteReview.menu.more", "More"),
            });
            const moreKbd = moreBtn.createEl("kbd", { text: "M" });
            moreKbd.classList.add("kbd", "ml-2");
            moreBtn.setAttr("data-tooltip-position", "top");
            moreBtn.addEventListener("click", () => {
                this._toggleDockMore();
            });
        }
        else {
            this._moreWrapEl = null;
        }
        this._syncOverflowLayout(panel);
    }
}
