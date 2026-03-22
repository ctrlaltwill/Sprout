import { Component, ItemView, MarkdownRenderer, Notice, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import { createViewHeader, type SproutHeader } from "../../platform/core/header";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_NOTE_REVIEW } from "../../platform/core/constants";
import { setCssProps } from "../../platform/core/ui";
import { SPROUT_HOME_CONTENT_SHELL_CLASS, SPROUT_TITLE_STRIP_LABEL_CLASS } from "../../platform/core/ui-classes";
import type SproutPlugin from "../../main";
import { t } from "../../platform/translations/translator";
import { initAOS, cascadeAOSOnLoad, resetAOS } from "../../platform/core/aos-loader";
import { NoteReviewSqlite, type NoteReviewRow } from "../../platform/core/note-review-sqlite";
import { computeLkrsLoadFactor, initialLkrsDueTime, reviewWithLkrs } from "../../engine/note-review/lkrs";
import { defaultFsrsNoteRow, gradeNoteFsrs, gradeNoteFsrsPass } from "../../engine/note-review/fsrs";
import { renderStudySessionHeader } from "../reviewer/study-session-header";
import type { Scope } from "../reviewer/types";
import { decodePropertyPair, extractFilePropertyPairs, extractFileTags } from "../shared/scope-metadata";

const SUSPEND_FAR_DAYS = 36500;

export class SproutNoteReviewView extends ItemView {
  plugin: SproutPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  private _titleStripEl: HTMLElement | null = null;
  private _titleTimerHostEl: HTMLElement | null = null;
  private _notesDb: NoteReviewSqlite | null = null;
  private _queue: TFile[] = [];
  private _queueIndex = 0;
  private _mdComponent: Component | null = null;
  private _renderToken = 0;
  private _dockMoreOpen = false;
  private _queueSessionTotal = 0;
  private _queueSessionDone = 0;
  private _hasInitAos = false;
  private _didEntranceAos = false;
  private _practiceMode = false;
  private _practiceQueueCompleted = false;
  private _filteredNotes: TFile[] = [];
  private _coachScope: Scope | null = null;
  private _coachTargetCount: number | null = null;
  private _coachIncludeNotDue = false;
  private _coachNoScheduling = false;
  private _coachTrackProgress = true;
  private _returnToCoach = false;
  private _ignoreDailyReviewLimit = false;
  private _suppressEntranceAosOnce = false;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_NOTE_REVIEW;
  }

  getDisplayText() {
    return t(this.plugin.settings?.general?.interfaceLanguage, "ui.view.noteReview.title", "Notes");
  }

  getIcon() {
    return "notebook-text";
  }

  async onOpen() {
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
    if ((this.plugin.settings?.general?.enableAnimations ?? true) &&
        (this.plugin.settings?.noteReview?.enableSessionAnimations ?? true)) {
      setTimeout(() => {
        initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
      }, 100);
    }
    await Promise.resolve();
  }

  async onClose() {
    this._header?.dispose?.();
    this._header = null;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    this._titleTimerHostEl = null;
    if (this._notesDb) {
      await this._notesDb.close();
    }
    this._mdComponent?.unload();
    this._mdComponent = null;
    this._notesDb = null;
    resetAOS();
    await Promise.resolve();
  }

  onRefresh() {
    this._dockMoreOpen = false;
    void this._refreshQueue(true).then(() => this.render());
  }

  setCoachScope(scope: Scope | null): void {
    this._coachScope = scope;
    if (!scope) {
      this._coachNoScheduling = false;
      this._coachTrackProgress = true;
    }
    void this._refreshQueue(true).then(() => this.render());
  }

  setReturnToCoach(enabled: boolean): void {
    this._returnToCoach = !!enabled;
  }

  setSuppressEntranceAosOnce(enabled: boolean): void {
    this._suppressEntranceAosOnce = !!enabled;
  }

  setIgnoreDailyReviewLimit(enabled: boolean): void {
    this._ignoreDailyReviewLimit = !!enabled;
    void this._refreshQueue(true).then(() => this.render());
  }

  startCoachDueSession(
    scope: Scope,
    options?: {
      targetCount?: number;
      includeNotDue?: boolean;
      noScheduling?: boolean;
      trackCoachProgress?: boolean;
    },
  ): void {
    this._coachScope = scope;
    this._coachTargetCount = Number.isFinite(Number(options?.targetCount))
      ? Math.max(0, Math.floor(Number(options?.targetCount)))
      : null;
    this._coachIncludeNotDue = options?.includeNotDue === true;
    this._coachNoScheduling = options?.noScheduling === true;
    this._coachTrackProgress = options?.trackCoachProgress !== false;
    this._returnToCoach = true;
    this._ignoreDailyReviewLimit = true;
    this._practiceMode = false;
    this._practiceQueueCompleted = false;
    this._queueIndex = 0;
    this._queueSessionDone = 0;
    this._dockMoreOpen = false;
    void this._refreshQueue(true).then(() => this.render());
  }

  private _getNow(): number {
    return Date.now();
  }

  private async _trackNoteReviewAction(file: TFile | null, action: "pass" | "fail" | "read" | "bury" | "suspend" | "skip"): Promise<void> {
    if (!file) return;
    this.plugin.store.appendAnalyticsNoteReview({
      at: Date.now(),
      noteId: file.path,
      sourceNotePath: file.path,
      mode: this._practiceMode || this._coachNoScheduling ? "practice" : "scheduled",
      action,
      algorithm: this.plugin.settings.noteReview?.algorithm === "lkrs" ? "lkrs" : "fsrs",
    });
    if ((action === "pass" || action === "fail" || action === "read") && this._coachScope && this._coachTrackProgress && !this._coachNoScheduling) {
      await this.plugin.recordCoachProgressForScope(this._coachScope, "note", 1);
    }
  }

  private _advanceNoSchedulingQueue(): void {
    this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
    this._queueIndex += 1;
    if (this._queueIndex > this._queue.length) this._queueIndex = this._queue.length;
    this._dockMoreOpen = false;
    this.render();
  }

  private _startOfTomorrowUtc(now: number): number {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.getTime();
  }

  private _farFuture(now: number): number {
    return now + SUSPEND_FAR_DAYS * 24 * 60 * 60 * 1000;
  }

  private _parseFilterQuery(query: string): {
    includePath: string[];
    excludePath: string[];
    includeNote: string[];
    excludeNote: string[];
    includeVault: boolean;
    excludeVault: boolean;
    includeTag: string[];
    excludeTag: string[];
    includeProp: string[];
    excludeProp: string[];
    includeText: string[];
    excludeText: string[];
  } {
    const parts = String(query || "")
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    const includePath: string[] = [];
    const excludePath: string[] = [];
    const includeNote: string[] = [];
    const excludeNote: string[] = [];
    const includeTag: string[] = [];
    const excludeTag: string[] = [];
    const includeProp: string[] = [];
    const excludeProp: string[] = [];
    const includeText: string[] = [];
    const excludeText: string[] = [];
    let includeVault = false;
    let excludeVault = false;

    for (const part of parts) {
      const lowered = part.toLowerCase();
      if (lowered === "scope:vault" || lowered === "vault") {
        includeVault = true;
      } else if (lowered === "-scope:vault" || lowered === "-vault") {
        excludeVault = true;
      } else if (lowered.startsWith("path:")) {
        includePath.push(lowered.slice(5));
      } else if (lowered.startsWith("-path:")) {
        excludePath.push(lowered.slice(6));
      } else if (lowered.startsWith("note:")) {
        includeNote.push(String(part.slice(5)).trim());
      } else if (lowered.startsWith("-note:")) {
        excludeNote.push(String(part.slice(6)).trim());
      } else if (lowered.startsWith("tag:")) {
        includeTag.push(String(lowered.slice(4)).trim().replace(/^#+/, ""));
      } else if (lowered.startsWith("-tag:")) {
        excludeTag.push(String(lowered.slice(5)).trim().replace(/^#+/, ""));
      } else if (lowered.startsWith("prop:")) {
        includeProp.push(String(part.slice(5)).trim().toLowerCase());
      } else if (lowered.startsWith("-prop:")) {
        excludeProp.push(String(part.slice(6)).trim().toLowerCase());
      } else if (lowered.startsWith("-")) {
        excludeText.push(lowered.slice(1));
      } else {
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

  private _matchesFilter(file: TFile, query: string): boolean {
    const p = file.path.toLowerCase();
    const f = this._parseFilterQuery(query);
    const tags = extractFileTags(this.app, file);
    const props = new Set(extractFilePropertyPairs(this.app, file).map((pair) => `${pair.key}=${pair.value}`));

    const hasIncludeCriteria =
      f.includeVault
      || f.includePath.length > 0
      || f.includeNote.length > 0
      || f.includeTag.length > 0
      || f.includeProp.length > 0
      || f.includeText.length > 0;

    const matchesInclude =
      f.includeVault
      || f.includePath.some((token) => token && p.includes(token))
      || f.includeNote.some((token) => token && file.path === token)
      || f.includeTag.some((token) => token && tags.has(token))
      || f.includeProp.some((token) => token && props.has(token))
      || f.includeText.some((token) => token && p.includes(token));

    if (hasIncludeCriteria && !matchesInclude) return false;

    if (f.excludeVault) return false;
    if (f.excludePath.some((token) => token && p.includes(token))) return false;
    if (f.excludeNote.some((token) => token && file.path === token)) return false;
    if (f.excludeTag.some((token) => token && tags.has(token))) return false;
    if (f.excludeProp.some((token) => token && props.has(token))) return false;
    if (f.excludeText.some((token) => token && p.includes(token))) return false;

    return true;
  }

  private _isFolderNote(file: TFile): boolean {
    const path = String(file.path || "").trim();
    if (!path.includes("/")) return false;

    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return false;

    const fileBase = String(file.basename || "").trim().toLowerCase();
    const parentFolder = String(parts[parts.length - 2] || "").trim().toLowerCase();
    if (!fileBase || !parentFolder) return false;
    return fileBase === parentFolder;
  }

  private async _refreshQueue(resetProgress: boolean = false): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const cfg = this.plugin.settings.noteReview;
    const filterQuery = String(cfg?.filterQuery ?? "").trim();
    const shouldAvoidFolderNotes = cfg?.avoidFolderNotes !== false;
    let groupNotePaths: Set<string> | null = null;
    if (this._coachScope?.type === "group") {
      groupNotePaths = new Set<string>();
      for (const card of this.plugin.store.getAllCards()) {
        const groups = Array.isArray(card.groups) ? card.groups : [];
        if (!groups.some((g) => String(g || "") === this._coachScope?.key)) continue;
        const path = String(card.sourceNotePath || "").trim();
        if (path) groupNotePaths.add(path);
      }
    }
    const filtered = files.filter((file) => {
      if (this._coachScope) {
        if (this._coachScope.type === "group" && groupNotePaths && !groupNotePaths.has(file.path)) return false;
        if (this._coachScope.type === "note" && file.path !== this._coachScope.key) return false;
        if (this._coachScope.type === "folder") {
          const key = String(this._coachScope.key || "");
          if (!(file.path === key || file.path.startsWith(`${key}/`))) return false;
        }
        if (this._coachScope.type === "tag") {
          const expected = String(this._coachScope.key || "").trim().toLowerCase().replace(/^#+/, "");
          if (!extractFileTags(this.app, file).has(expected)) return false;
        }
        if (this._coachScope.type === "property") {
          const pair = decodePropertyPair(this._coachScope.key);
          if (!pair) return false;
          const matches = extractFilePropertyPairs(this.app, file)
            .some((entry) => entry.key === pair.key && entry.value === pair.value);
          if (!matches) return false;
        }
      }
      if (shouldAvoidFolderNotes && this._isFolderNote(file)) return false;
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

    const steps = (cfg?.reviewStepsDays?.length ? cfg.reviewStepsDays : [1, 7, 30, 365]).map((n) => Math.max(1, Number(n) || 1));
    const perDay = Math.max(1, Number(cfg?.reviewsPerDay ?? 10));
    const total = filtered.length;
    const now = this._getNow();
    const loadFactor = computeLkrsLoadFactor(total, { reviewsPerDay: perDay, reviewStepsDays: steps });

    for (const file of filtered) {
      const existing = this._notesDb.getNoteState(file.path);
      if (existing) continue;
      const firstStep = steps[0] ?? 1;
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
    let queue = dueIds.map((id) => byPath.get(id)).filter((f): f is TFile => !!f);

    if (this._coachScope && this._coachTargetCount != null) {
      const targetCount = this._coachTargetCount;

      if (targetCount <= 0) {
        queue = [];
      } else {
        if (this._coachIncludeNotDue && queue.length < targetCount) {
          const queuedPaths = new Set(queue.map((f) => f.path));
          const remaining = filtered.filter((f) => !queuedPaths.has(f.path));
          remaining.sort((a, b) => {
            const aDue = this._notesDb?.getNoteState(a.path)?.next_review_time ?? Number.MAX_SAFE_INTEGER;
            const bDue = this._notesDb?.getNoteState(b.path)?.next_review_time ?? Number.MAX_SAFE_INTEGER;
            return Number(aDue) - Number(bDue);
          });
          queue = [...queue, ...remaining.slice(0, Math.max(0, targetCount - queue.length))];
        }
        queue = queue.slice(0, targetCount);
      }
    }

    // When due notes are exhausted, keep the queue empty so the session shows
    // the "No notes are due" screen and offers an explicit practice session.

    this._queue = queue;
    if (this._queueIndex >= this._queue.length) this._queueIndex = 0;
    if (resetProgress) {
      this._queueSessionTotal = this._queue.length;
      this._queueSessionDone = 0;
      this._practiceQueueCompleted = false;
    }
  }

  private _currentNote(): TFile | null {
    if (!this._queue.length) return null;
    const idx = Math.max(0, this._queueIndex);
    if (idx >= this._queue.length) return null;
    return this._queue[idx] ?? null;
  }

  private _shuffleFiles(files: TFile[]): TFile[] {
    const next = files.slice();
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  private _startPracticeSession(): void {
    this._practiceMode = true;
    this._practiceQueueCompleted = false;
    this._queue = this._shuffleFiles(this._filteredNotes);
    this._queueIndex = 0;
    this._queueSessionTotal = this._queue.length;
    this._queueSessionDone = 0;
    this._dockMoreOpen = false;
    this.render();
  }

  private _advancePracticeQueue(): void {
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

  private _renderEmptySessionState(host: HTMLElement): void {
    const lang = this.plugin.settings?.general?.interfaceLanguage;
    const isPracticeComplete = this._practiceMode && this._practiceQueueCompleted;

    const card = host.createDiv({ cls: "sprout-note-review-empty card" });
    this._renderNoteReviewSessionHeader(card, null);

    const isCoachSession = !!this._coachScope;

    card.createDiv({
      cls: "sprout-note-review-empty-title",
      text: isCoachSession
        ? t(lang, "ui.noteReview.session.coachDoneTitle", "All due notes for your study plan have been reviewed for today.")
        : isPracticeComplete
        ? t(lang, "ui.reviewer.session.practiceComplete", "Practice complete")
        : t(lang, "ui.view.noteReview.empty.noNotesDue", "No notes are due"),
    });

    card.createEl("p", {
      cls: "sprout-note-review-empty-body",
      text: isCoachSession
        ? t(lang, "ui.noteReview.session.coachDoneBody", "All due notes for your study plan have been reviewed for today.")
        : isPracticeComplete
        ? t(lang, "ui.reviewer.session.practiceSessionComplete", "Practice session complete")
        : t(lang, "ui.view.noteReview.empty.askStartPractice", "Would you like to start a practice session?"),
    });

    if (!isCoachSession) {
      card.createEl("p", {
        cls: "sprout-note-review-empty-body sprout-settings-text-muted",
        text: isPracticeComplete
          ? t(
              lang,
              "ui.view.noteReview.empty.practiceCompleteDetail",
              "This was a practice session. Scheduling was not changed.",
            )
          : t(
              lang,
              "ui.view.noteReview.empty.practicePrompt",
              "Practice sessions review randomized notes from the active filter and do not affect scheduling.",
            ),
      });
    }

    const actions = card.createDiv({ cls: "sprout-note-review-empty-actions" });
    const homeBtn = actions.createEl("button", {
      cls: "h-9 flex items-center gap-2 equal-height-btn sprout-btn-control",
      text: isCoachSession
        ? t(lang, "ui.reviewer.session.backToCoach", "Back to Coach")
        : t(lang, "ui.reviewer.session.returnToDecks", "Return to Home"),
    });
    homeBtn.setAttr("type", "button");
    homeBtn.setAttr("aria-label", t(lang, "ui.reviewer.session.returnToDecks", "Return to Decks"));
    homeBtn.setAttr("data-tooltip-position", "top");
    homeBtn.addEventListener("click", () => {
      void this._quitToHome();
    });

    if (!isCoachSession && !this._practiceMode && this._filteredNotes.length > 0) {
      const practiceBtn = actions.createEl("button", {
        cls: "bc btn-outline sprout-btn-toolbar sprout-btn-accent h-9 w-full md:w-auto inline-flex items-center gap-2 equal-height-btn",
        text: t(lang, "ui.reviewer.session.startPractice", "Start Practice"),
      });
      practiceBtn.setAttr("type", "button");
      practiceBtn.setAttr("aria-label", t(lang, "ui.reviewer.session.startPractice", "Start Practice"));
      practiceBtn.setAttr("data-tooltip-position", "top");
      practiceBtn.addEventListener("click", () => {
        this._startPracticeSession();
      });
    }
  }

  private async _markCurrentAsRead(): Promise<void> {
    const file = this._currentNote();
    if (!file) return;

    if (this._practiceMode || this._coachNoScheduling) {
      await this._trackNoteReviewAction(file, "read");
      this._advanceNoSchedulingQueue();
      return;
    }

    if (!this._notesDb) return;

    const cfg = this.plugin.settings.noteReview;
    const steps = (cfg?.reviewStepsDays?.length ? cfg.reviewStepsDays : [1, 7, 30, 365]).map((n) => Math.max(1, Number(n) || 1));
    const perDay = Math.max(1, Number(cfg?.reviewsPerDay ?? 10));
    const now = this._getNow();

    const current = this._notesDb.getNoteState(file.path) ?? defaultFsrsNoteRow(file.path, now);

    let nextRow: NoteReviewRow;
    if (cfg?.algorithm === "lkrs") {
      const next = reviewWithLkrs(
        {
          noteId: current.note_id,
          stepIndex: current.step_index,
          lastReviewTime: current.last_review_time ?? undefined,
          nextReviewTime: current.next_review_time,
          weight: current.weight,
        },
        now,
        { reviewsPerDay: perDay, reviewStepsDays: steps },
        Math.max(1, this.app.vault.getMarkdownFiles().length),
      );

      nextRow = {
        note_id: next.noteId,
        step_index: next.stepIndex,
        last_review_time: next.lastReviewTime ?? null,
        next_review_time: next.nextReviewTime,
        weight: next.weight ?? 1,
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
    } else {
      nextRow = gradeNoteFsrsPass(current, now, { scheduling: this.plugin.settings.scheduling });
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

  private async _gradeCurrentFsrs(outcome: "pass" | "fail"): Promise<void> {
    const file = this._currentNote();
    if (!file) return;

    if (this._practiceMode || this._coachNoScheduling) {
      await this._trackNoteReviewAction(file, outcome);
      this._advanceNoSchedulingQueue();
      return;
    }

    if (!this._notesDb) return;

    const now = this._getNow();
    const current = this._notesDb.getNoteState(file.path) ?? defaultFsrsNoteRow(file.path, now);
    const nextRow = gradeNoteFsrs(current, now, { scheduling: this.plugin.settings.scheduling }, outcome);

    this._notesDb.upsertNoteState(nextRow);
    await this._trackNoteReviewAction(file, outcome);
    await this._notesDb.persist();

    this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
    this._queueIndex += 1;
    await this._refreshQueue();
    this._dockMoreOpen = false;
    this.render();
  }

  private async _buryCurrentNote(): Promise<void> {
    const file = this._currentNote();
    if (!file || !this._notesDb) return;

    const now = this._getNow();
    const until = this._startOfTomorrowUtc(now);
    const current = this._notesDb.getNoteState(file.path) ?? {
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

  private _skipCurrent(): void {
    const file = this._currentNote();
    if (!file || !this._queue.length) return;
    void this._trackNoteReviewAction(file, "skip");
    if (this._practiceMode) {
      this._advancePracticeQueue();
      return;
    }
    this._queueSessionDone = Math.min(this._queueSessionDone + 1, Math.max(this._queueSessionTotal, 1));
    this._queueIndex = Math.min(this._queue.length, this._queueIndex + 1);
    if (this._queueIndex >= this._queue.length) this._queueIndex = 0;
    this._dockMoreOpen = false;
    this.render();
  }

  private async _suspendCurrentNote(): Promise<void> {
    const file = this._currentNote();
    if (!file || !this._notesDb) return;

    const now = this._getNow();
    const current = this._notesDb.getNoteState(file.path) ?? defaultFsrsNoteRow(file.path, now);

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

  private async _quitToHome(): Promise<void> {
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

  private _registerHotkeys(): void {
    this.registerDomEvent(document, "keydown", (evt: KeyboardEvent) => {
      if (!this._rootEl || !this.contentEl.isConnected) return;
      const target = evt.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (inEditable) return;
      if (evt.metaKey || evt.ctrlKey || evt.altKey) return;

      const hasCurrent = !!this._currentNote();
      const algorithm = this.plugin.settings.noteReview?.algorithm === "lkrs" ? "lkrs" : "fsrs";
      const key = evt.key.toLowerCase();

      if (key === "q") {
        evt.preventDefault();
        void this._quitToHome();
        return;
      }

      if (key === "m") {
        if (this._practiceMode || this._coachNoScheduling) return;
        evt.preventDefault();
        this._dockMoreOpen = !this._dockMoreOpen;
        this.render();
        return;
      }

      if (key === "escape" && this._dockMoreOpen) {
        evt.preventDefault();
        this._dockMoreOpen = false;
        this.render();
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
        if (this._practiceMode || this._coachNoScheduling) return;
        evt.preventDefault();
        void this._buryCurrentNote().then(() => new Notice("Sprout: note buried until tomorrow."));
        return;
      }

      if (key === "s") {
        if (this._practiceMode || this._coachNoScheduling) return;
        evt.preventDefault();
        void this._suspendCurrentNote().then(() => new Notice("Sprout: note suspended."));
        return;
      }

      if (algorithm === "fsrs") {
        if (key === "1") {
          evt.preventDefault();
          void this._gradeCurrentFsrs("fail").then(() => new Notice("Sprout: rated again."));
          return;
        }
        if (key === "2") {
          evt.preventDefault();
          void this._gradeCurrentFsrs("pass").then(() => new Notice("Sprout: rated good."));
        }
        return;
      }

      if (key === "1") {
        evt.preventDefault();
        this._skipCurrent();
        new Notice("Sprout: skipped.");
        return;
      }

      if (key === "2") {
        evt.preventDefault();
        void this._markCurrentAsRead().then(() => new Notice("Sprout: marked as read."));
      }
    });
  }

  private async _openCurrentNote(): Promise<void> {
    const file = this._currentNote();
    if (!file) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    const strip = this._titleStripEl;
    if (!this._rootEl && !strip) return;
    const maxWidth = this.plugin.isWideMode ? "none" : MAX_CONTENT_WIDTH_PX;
    if (this._rootEl) {
      setCssProps(this._rootEl, "--sprout-home-max-width", maxWidth);
      setCssProps(this._rootEl, "--sprout-note-review-max-width", maxWidth);
    }
    if (strip) setCssProps(strip, "--sprout-home-max-width", maxWidth);
  }

  private _ensureTitleStrip(root: HTMLElement): void {
    const parent = root.parentElement;
    if (!parent) return;

    this._titleStripEl?.remove();
    this._titleTimerHostEl = null;

    const coachShellMode = !!this._coachScope || this._returnToCoach;

    const strip = document.createElement("div");
    strip.className = coachShellMode
      ? "lk-home-title-strip sprout-coach-title-strip"
      : "lk-home-title-strip sprout-note-review-title-strip";

    const row = document.createElement("div");
    row.className = "sprout-inline-sentence w-full flex items-center justify-between gap-[10px] sprout-note-review-title-row";

    const left = document.createElement("div");
    left.className = "min-w-0 flex-1 flex flex-col gap-[2px]";

    const title = document.createElement("div");
    title.className = SPROUT_TITLE_STRIP_LABEL_CLASS;
    title.textContent = coachShellMode
      ? "Coach"
      : t(this.plugin.settings?.general?.interfaceLanguage, "ui.view.noteReview.title", "Notes");

    const total = Math.max(this._queueSessionTotal, this._queue.length);
    const remaining = Math.max(0, total - this._queueSessionDone);
    const subtitle = document.createElement("div");
    subtitle.className = "text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";
    if (coachShellMode) {
      subtitle.textContent = "Build and manage focused study plans.";
    } else if (this._practiceMode) {
      subtitle.textContent = t(
        this.plugin.settings?.general?.interfaceLanguage,
        "ui.noteReview.title.practiceRemaining",
        "{count} note{suffix} left in this practice session",
        { count: remaining, suffix: remaining === 1 ? "" : "s" },
      );
    } else if (remaining === 0) {
      subtitle.textContent = t(
        this.plugin.settings?.general?.interfaceLanguage,
        "ui.noteReview.title.noneDue",
        "No notes are currently due!",
      );
    } else {
      subtitle.textContent = t(
        this.plugin.settings?.general?.interfaceLanguage,
        "ui.noteReview.title.dueRemaining",
        "{count} due note{suffix} remaining",
        { count: remaining, suffix: remaining === 1 ? "" : "s" },
      );
    }

    left.appendChild(title);
    left.appendChild(subtitle);
    row.appendChild(left);

    const timerHost = document.createElement("div");
    timerHost.className = "sprout-note-review-title-timer-host";
    row.appendChild(timerHost);

    strip.appendChild(row);
    root.prepend(strip);
    this._titleStripEl = strip;
    this._titleTimerHostEl = timerHost;
  }

  private _buildSessionLocation(note: TFile | null): string {
    if (!note) return "";
    const parts = String(note.path || "").split("/").filter(Boolean);
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join(" / ");
  }

  private _renderNoteReviewSessionHeader(root: HTMLElement, note: TFile | null): void {
    const header = root.createEl("header", { cls: "bc flex flex-col gap-4 pt-4 p-6" });

    const locationRow = header.createDiv({ cls: "bc flex items-center gap-2 min-w-0" });
    locationRow.createDiv({
      cls: "bc text-muted-foreground sprout-session-location-text",
      text: this._buildSessionLocation(note),
    });

    header.createDiv({
      cls: "bc sprout-question-title",
      text: note?.basename ?? t(this.plugin.settings?.general?.interfaceLanguage, "ui.view.noteReview.title", "Notes"),
    });
  }

  private _syncOverflowLayout(panel: HTMLElement): void {
    const root = this._rootEl;
    if (!root || !panel.isConnected) return;

    requestAnimationFrame(() => {
      if (!root.isConnected || !panel.isConnected) return;
      const rootRect = root.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const shouldUseFlexAuto = panelRect.height > rootRect.height + 1;
      root.classList.toggle("sprout-note-review-overflow", shouldUseFlexAuto);
    });
  }

  private async _renderCurrentNoteContent(host: HTMLElement, note: TFile, token: number): Promise<void> {
    const article = document.createElement("div");
    article.className = "sprout-note-review-article card";
    this._renderNoteReviewSessionHeader(article, note);

    const body = article.createDiv({ cls: "sprout-note-review-note-body markdown-rendered" });

    try {
      const markdown = await this.app.vault.read(note);
      if (token !== this._renderToken) return;

      if (!this._mdComponent) {
        this._mdComponent = new Component();
        this._mdComponent.load();
      }

      await MarkdownRenderer.render(this.app, markdown, body, note.path, this._mdComponent);
      if (token !== this._renderToken) return;

      if (!markdown.trim()) {
        body.createEl("p", {
          cls: "sprout-settings-text-muted",
          text: "This note is empty.",
        });
      }
    } catch {
      if (token !== this._renderToken) return;
      body.empty();
      body.createEl("p", {
        cls: "sprout-settings-text-muted",
        text: "Could not load this note.",
      });
    }

    if (token !== this._renderToken) return;

    host.replaceChildren(article);
    article.classList.add("sprout-note-review-article-enter");
    requestAnimationFrame(() => {
      if (!article.isConnected) return;
      article.classList.add("is-visible");
    });
  }

  render() {
    const root = this.contentEl;
    const suppressEntranceAos = this._suppressEntranceAosOnce;
    this._suppressEntranceAosOnce = false;
    const coachShellMode = !!this._coachScope || this._returnToCoach;
    const preservedCoachStrip = coachShellMode
      ? root.querySelector<HTMLElement>(":scope > .lk-home-title-strip.sprout-coach-title-strip")
      : null;
    if (preservedCoachStrip) preservedCoachStrip.remove();
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    this._titleTimerHostEl = null;

    const existingHeader = root.querySelector<HTMLElement>("[data-study-session-header]");
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
    root.classList.add("bc", "sprout-view-content", "sprout-note-review-root", "flex", "flex-col", "min-h-0");
    this.containerEl.addClass("sprout");
    this.setTitle?.(this.getDisplayText());
    if (!preservedCoachStrip) {
      this._ensureTitleStrip(root);
    }

    const contentShell = root.createDiv({
      cls: `${SPROUT_HOME_CONTENT_SHELL_CLASS} sprout-note-review-content-shell sprout-session-column flex flex-col min-h-0`,
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

    const algorithm = this.plugin.settings.noteReview?.algorithm === "lkrs" ? "lkrs" : "fsrs";
    const totalCount = Math.max(this._queueSessionTotal, this._queue.length);
    const remainingCount = totalCount > 0 ? Math.max(0, totalCount - this._queueSessionDone) : 0;
    const progress = totalCount > 0 ? Math.min(1, Math.max(0, (totalCount - remainingCount) / totalCount)) : 0;
    const animationsEnabled =
      (this.plugin.settings?.general?.enableAnimations ?? true) &&
      (this.plugin.settings?.noteReview?.enableSessionAnimations ?? true);

    if (animationsEnabled && !this._hasInitAos && !suppressEntranceAos) {
      try {
        initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
      } catch {
        // best-effort
      }
      this._hasInitAos = true;
    }

    const current = this._currentNote();
    renderStudySessionHeader(contentShell, this.plugin.settings?.general?.interfaceLanguage, false, {
      titleToken: "ui.noteReview.session.header.title",
      titleFallback: "Notes",
    });

    const clearAos = (el: HTMLElement | null) => {
      if (!el) return;
      el.removeAttribute("data-aos");
      el.removeAttribute("data-aos-delay");
      el.removeAttribute("data-aos-duration");
      el.removeAttribute("data-aos-anchor-placement");
      el.classList.remove("aos-init", "aos-animate", "sprout-aos-fallback");
    };

    const applyAos = (el: HTMLElement | null, delay: number, animation = "fade-up") => {
      if (!el) return;
      if (!animationsEnabled) {
        clearAos(el);
        return;
      }
      clearAos(el);
      el.setAttribute("data-aos", animation);
      el.setAttribute("data-aos-delay", String(delay));
      el.setAttribute("data-aos-duration", String(AOS_DURATION));
      el.setAttribute("data-aos-anchor-placement", "top-top");
    };

    const sessionHeader = contentShell.querySelector<HTMLElement>("[data-study-session-header]");
    clearAos(sessionHeader);
    const sessionTimerRow = sessionHeader?.querySelector<HTMLElement>(".sprout-session-header-left > div:nth-child(2)") ?? null;
    const stripEl = this._titleStripEl;
    const titleTimerHost = this._titleTimerHostEl as HTMLElement | null;
    if (titleTimerHost) {
      while (titleTimerHost.firstChild) titleTimerHost.removeChild(titleTimerHost.firstChild);
      if (sessionTimerRow && !coachShellMode) {
        titleTimerHost.appendChild(sessionTimerRow);
      }
    }
    if (sessionHeader) {
      sessionHeader.classList.add("sprout-note-review-session-header-hidden");
    }
    clearAos(titleTimerHost);
    if (animationsEnabled && !this._didEntranceAos && !coachShellMode && !suppressEntranceAos) {
      applyAos(stripEl, 0, "fade-up");
      applyAos(contentShell, 100, "fade-up");
      const maxDelay = cascadeAOSOnLoad(root, { stepMs: 0, baseDelayMs: 0, durationMs: AOS_DURATION, overwriteDelays: false });
      const fallbackAfterMs = Math.max(600, Math.floor(maxDelay + AOS_DURATION + 250));
      setTimeout(() => {
        root.querySelectorAll("[data-aos]").forEach((el) => {
          if (!(el instanceof HTMLElement) || !el.isConnected) return;
          const style = getComputedStyle(el);
          if (style.opacity === "0" || style.visibility === "hidden") {
            el.classList.add("sprout-aos-fallback");
          }
        });
      }, fallbackAfterMs);
      this._didEntranceAos = true;
    } else if (!animationsEnabled) {
      root.querySelectorAll("[data-aos]").forEach((el) => {
        el.classList.add("sprout-aos-fallback");
      });
    }

    const panel = contentShell.createDiv({ cls: "sprout-note-review-panel" });
    const coachLabel = "Coach";
    const backToCoachLabel = `Back to ${coachLabel}`;
    const quitToCoachLabel = `Quit to ${coachLabel}`;

    const quitBtn = panel.createEl("button");
    if (coachShellMode) {
      quitBtn.classList.add(
        "bc",
        "sprout-btn-toolbar",
        "sprout-btn-filter",
        "h-7",
        "px-3",
        "text-sm",
        "inline-flex",
        "items-center",
        "gap-2",
        "sprout-scope-clear-btn",
        "sprout-btn-top-right",
        "sprout-note-review-quit-coach-btn",
      );
    } else {
      quitBtn.classList.add(
        "sprout-btn-toolbar",
        "h-9",
        "flex",
        "items-center",
        "gap-2",
        "equal-height-btn",
        "sprout-btn-exit-sm",
        "sprout-btn-top-right",
      );
    }
    quitBtn.setAttr("type", "button");
    quitBtn.setAttr("aria-label", coachShellMode ? backToCoachLabel : "Quit study session");
    quitBtn.setAttr("data-tooltip-position", "top");
    const quitIconWrap = quitBtn.createSpan({ cls: coachShellMode ? "bc inline-flex items-center justify-center" : "inline-flex items-center justify-center sprout-btn-icon" });
    setIcon(quitIconWrap, "x");
    if (coachShellMode) {
      quitBtn.createSpan({ cls: "bc", attr: { "data-sprout-label": "true" }, text: backToCoachLabel });
    }
    quitBtn.addEventListener("click", () => {
      void this._quitToHome();
    });

    const stage = panel.createDiv({ cls: "sprout-note-review-stage" });

    const viewport = stage.createDiv({ cls: "sprout-note-review-content" });

    this._renderToken += 1;
    const renderToken = this._renderToken;

    if (current) {
      const loadingArticle = viewport.createDiv({ cls: "sprout-note-review-article card sprout-note-review-article-loading" });
      loadingArticle.createDiv({
        cls: "sprout-note-review-note-body markdown-rendered sprout-note-review-loading-copy",
        text: "Loading note...",
      });
      void this._renderCurrentNoteContent(viewport, current, renderToken).then(() => {
        this._syncOverflowLayout(panel);
      });
    } else {
      this._renderEmptySessionState(viewport);
      this._syncOverflowLayout(panel);
    }

    if (!current) {
      return;
    }

    const controls = stage.createDiv({ cls: "sprout-note-review-dock" });
    const left = controls.createDiv({ cls: "sprout-note-review-dock-left" });
    const countCard = left.createDiv({ cls: "sprout-note-review-queue-count" });
    setCssProps(countCard, "--sprout-note-review-progress", `${Math.round(progress * 100)}%`);
    countCard.createDiv({
      cls: "sprout-note-review-queue-count-label",
      text: `${remainingCount} of ${totalCount} remaining`,
    });

    const buttonGroup = controls.createDiv({ cls: "sprout-note-review-dock-buttons" });
    if (algorithm === "fsrs") {
      const againBtn = buttonGroup.createEl("button");
      againBtn.classList.add("btn-destructive", "sprout-btn-again");
      againBtn.createSpan({ text: "Again" });
      const againKey = againBtn.createEl("kbd", { text: "1" });
      againKey.classList.add("bc", "kbd", "ml-2");
      againBtn.disabled = !current;
      againBtn.setAttr("aria-label", "Grade question as again (1)");
      againBtn.setAttr("data-tooltip-position", "top");
      againBtn.addEventListener("click", () => {
        void this._gradeCurrentFsrs("fail").then(() => new Notice("Sprout: rated again."));
      });

      const goodBtn = buttonGroup.createEl("button");
      goodBtn.classList.add("btn", "sprout-btn-good");
      goodBtn.createSpan({ text: "Good" });
      const goodKey = goodBtn.createEl("kbd", { text: "2" });
      goodKey.classList.add("bc", "kbd", "ml-2");
      goodBtn.disabled = !current;
      goodBtn.setAttr("aria-label", "Grade question as good (2)");
      goodBtn.setAttr("data-tooltip-position", "top");
      goodBtn.addEventListener("click", () => {
        void this._gradeCurrentFsrs("pass").then(() => new Notice("Sprout: rated good."));
      });
    } else {
      const skipBtn = buttonGroup.createEl("button");
      skipBtn.classList.add("sprout-btn-toolbar");
      skipBtn.createSpan({ text: "Skip" });
      const skipKey = skipBtn.createEl("kbd", { text: "1" });
      skipKey.classList.add("bc", "kbd", "ml-2");
      skipBtn.disabled = !current;
      skipBtn.setAttr("aria-label", "Skip note (1)");
      skipBtn.setAttr("data-tooltip-position", "top");
      skipBtn.addEventListener("click", () => {
        this._skipCurrent();
        new Notice("Sprout: skipped.");
      });

      const markBtn = buttonGroup.createEl("button");
      markBtn.classList.add("btn", "sprout-btn-good");
      markBtn.createSpan({ text: "Mark as read" });
      const markKey = markBtn.createEl("kbd", { text: "2" });
      markKey.classList.add("bc", "kbd", "ml-2");
      markBtn.disabled = !current;
      markBtn.setAttr("aria-label", "Mark note as read (2)");
      markBtn.setAttr("data-tooltip-position", "top");
      markBtn.addEventListener("click", () => {
        void this._markCurrentAsRead().then(() => new Notice("Sprout: marked as read."));
      });
    }

    const right = controls.createDiv({ cls: "sprout-note-review-dock-right" });
    const moreWrap = right.createDiv({ cls: "sprout-note-review-more" });
    const moreBtn = moreWrap.createEl("button", { text: "More" });
    moreBtn.disabled = !current || this._practiceMode || this._coachNoScheduling;
    moreBtn.classList.add("sprout-note-review-more-trigger", "bc", "sprout-btn-toolbar");
    moreBtn.setAttr("aria-label", "More actions");
    const moreKbd = moreBtn.createEl("kbd", { text: "M" });
    moreKbd.classList.add("bc", "kbd", "ml-2");
    moreBtn.setAttr("data-tooltip-position", "top");
    moreBtn.addEventListener("click", () => {
      this._dockMoreOpen = !this._dockMoreOpen;
      this.render();
    });

    if (this._dockMoreOpen && current && !this._practiceMode && !this._coachNoScheduling) {
      const popover = moreWrap.createDiv({
        cls: "bc sprout rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 pointer-events-auto sprout-note-review-more-popover",
      });
      const menu = popover.createDiv({ cls: "bc sprout flex flex-col" });
      menu.setAttr("role", "menu");

      const itemClass =
        "bc group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

      const addItem = (label: string, hotkey: string, onClick: () => void) => {
        const item = menu.createDiv({ cls: itemClass });
        item.setAttr("role", "menuitem");
        item.setAttr("tabindex", "0");
        item.createSpan({ cls: "bc", text: label });
        item.createEl("kbd", { cls: "bc kbd ml-auto text-xs text-muted-foreground tracking-widest", text: hotkey });
        item.addEventListener("click", () => onClick());
        item.addEventListener("keydown", (evt: KeyboardEvent) => {
          if (evt.key !== "Enter" && evt.key !== " ") return;
          evt.preventDefault();
          onClick();
        });
      };

      addItem("Open in Note", "O", () => {
        this._dockMoreOpen = false;
        void this._openCurrentNote();
      });

      addItem("bury", "B", () => {
        void this._buryCurrentNote().then(() => new Notice("Note buried until tomorrow."));
      });

      addItem("suspend", "S", () => {
        void this._suspendCurrentNote().then(() => new Notice("Note suspended."));
      });

      const undoDisabled = menu.createDiv({ cls: `${itemClass} sprout-menu-item--disabled` });
      undoDisabled.setAttr("role", "menuitem");
      undoDisabled.setAttr("tabindex", "-1");
      undoDisabled.setAttr("aria-disabled", "true");
      undoDisabled.createSpan({ cls: "bc", text: "Undo last grade" });
      undoDisabled.createEl("kbd", { cls: "bc kbd ml-auto text-xs text-muted-foreground tracking-widest", text: "U" });

      addItem(coachShellMode ? quitToCoachLabel : "Exit to Decks", "Q", () => {
        void this._quitToHome();
      });
    }

    this._syncOverflowLayout(panel);
  }
}
