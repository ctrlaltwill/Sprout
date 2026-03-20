import { ItemView, Notice, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import type SproutPlugin from "../../main";
import { createViewHeader, type SproutHeader } from "../../platform/core/header";
import { log } from "../../platform/core/logger";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_COACH } from "../../platform/core/constants";
import { setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import type { Scope } from "../reviewer/types";
import { matchesScope } from "../../engine/indexing/scope-match";
import { CoachPlanSqlite, type CoachIntensity, type CoachPlanRow } from "../../platform/core/coach-plan-sqlite";
import { NoteReviewSqlite } from "../../platform/core/note-review-sqlite";
import { isParentCard } from "../../platform/core/card-utils";
import { cascadeAOSOnLoad, initAOS, resetAOS } from "../../platform/core/aos-loader";
import { CoachHealthPanel, CoachReadinessPanel, type ExamReadinessPoint } from "./coach-charts";
import { mountSearchPopoverList, type SearchPopoverOption } from "../shared/search-popover-list";
import {
  collectVaultTagAndPropertyPairs,
  decodePropertyPair,
  encodePropertyPair,
  extractFilePropertyPairs,
  extractFileTags,
} from "../shared/scope-metadata";
import { forgetting_curve, generatorParameters } from "ts-fsrs";

const MS_DAY = 24 * 60 * 60 * 1000;

type PlannerStats = {
  dueCards: number;
  newCards: number;
  dueNotes: number;
};

type AggregateStats = PlannerStats & {
  totalCards: number;
};

type HealthStatus = {
  score: number;
  label: "ready" | "on-track" | "at-risk" | "behind";
  toneClass: string;
};



type WizardSlideDirection = "next" | "back" | null;

type ScopeOption = {
  label: string;
  scope: Scope;
};

function startOfDayUtc(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function daysLeftToExam(examDateUtc: number, now: number): number {
  const today = startOfDayUtc(now);
  const exam = startOfDayUtc(examDateUtc);
  return Math.max(1, Math.ceil((exam - today) / MS_DAY));
}

function intensityMultiplier(intensity: CoachIntensity): number {
  if (intensity === "relaxed") return 0.9;
  if (intensity === "aggressive") return 1.15;
  return 1;
}

function computeStatus(targetFlash: number, targetNote: number, doneFlash: number, doneNote: number): CoachPlanRow["status"] {
  const flashRatio = targetFlash > 0 ? doneFlash / targetFlash : 1;
  const noteRatio = targetNote > 0 ? doneNote / targetNote : 1;
  const ratio = Math.min(flashRatio, noteRatio);
  if (ratio >= 1) return "on-track";
  if (ratio >= 0.65) return "at-risk";
  return "behind";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function toTone(score: number): HealthStatus["toneClass"] {
  if (score >= 85) return "text-emerald-600";
  if (score >= 65) return "text-green-600";
  if (score >= 45) return "text-amber-600";
  return "text-red-600";
}

function toLabel(score: number): HealthStatus["label"] {
  if (score >= 85) return "ready";
  if (score >= 65) return "on-track";
  if (score >= 45) return "at-risk";
  return "behind";
}

function toScopeId(scope: Scope): string {
  return `${scope.type}::${scope.key}`;
}

function fromScopeId(scopeId: string, lookup: Map<string, Scope>): Scope | null {
  return lookup.get(scopeId) ?? null;
}

function titleCaseIntensity(intensity: CoachIntensity): string {
  if (intensity === "balanced") return "Balanced";
  if (intensity === "aggressive") return "Aggressive";
  return "Relaxed";
}

function formatDateForInput(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function planScopeId(plan: CoachPlanRow): string {
  return `${plan.scope_type}::${plan.scope_key}`;
}

function formatScopePlanTitle(scopeName: string): { title: string; hierarchy: string } {
  const raw = String(scopeName || "").trim();
  if (!raw) return { title: "Study Plan", hierarchy: "" };
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  const leaf = parts[parts.length - 1] || raw;
  const title = /study\s*plan$/i.test(leaf) ? leaf : `${leaf} Study Plan`;
  return {
    title,
    hierarchy: parts.join(" / "),
  };
}

function formatFolderChipLabel(path: string): string {
  const normalized = String(path || "").trim();
  if (!normalized) return "Home";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export class SproutCoachView extends ItemView {
  plugin: SproutPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  private _coachDb: CoachPlanSqlite | null = null;
  private _notesDb: NoteReviewSqlite | null = null;
  private _chartsRoot: ReactRoot | null = null;
  private _readinessRoot: ReactRoot | null = null;

  private _wizardVisible = false;
  private _wizardStep = 0;
  private _wizardSlide: WizardSlideDirection = null;
  private _wizardCardEl: HTMLElement | null = null;
  private _wizardStepperEl: HTMLElement | null = null;
  private _wizardPageEl: HTMLElement | null = null;
  private _searchQuery = "";
  private _selectedScopeIds = new Set<string>();
  private _scopeLookup = new Map<string, Scope>();
  private _examDateInput = "";
  private _intensity: CoachIntensity = "balanced";
  private _planName = "";
  private _selectedPlanScopeId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_COACH;
  }

  getDisplayText(): string {
    return "Coach";
  }

  getIcon(): string {
    return "target";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.containerEl.addClass("sprout");

    this._header = createViewHeader({
      view: this,
      plugin: this.plugin,
      onToggleWide: () => this._applyMaxWidth(),
    });
    this._header.install("coach");

    this._coachDb = new CoachPlanSqlite(this.plugin);
    await this._coachDb.open();

    this._notesDb = new NoteReviewSqlite(this.plugin);
    await this._notesDb.open();

    const defaultExamDate = Date.now() + (21 * MS_DAY);
    this._examDateInput = formatDateForInput(defaultExamDate);

    await this._render();

    // Auto-refresh when the user switches back to this tab so stale
    // progress / due-note counts are replaced with fresh disk data.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view === this) this.onRefresh();
      }),
    );

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    if (animationsEnabled) {
      setTimeout(() => {
        initAOS({
          duration: AOS_DURATION,
          easing: "ease-out",
          once: true,
          offset: 50,
        });
      }, 100);
    }
  }

  async onClose(): Promise<void> {
    this._header?.dispose();
    this._header = null;

    try {
      this._chartsRoot?.unmount();
    } catch {
      // no-op
    }
    this._chartsRoot = null;

    try {
      this._readinessRoot?.unmount();
    } catch {
      // no-op
    }
    this._readinessRoot = null;

    // Use discard() — NOT close() — so we never persist a stale
    // in-memory snapshot that would overwrite real progress written
    // by main.ts / note-review while this view was in the background.
    if (this._coachDb) this._coachDb.discard();
    this._coachDb = null;

    if (this._notesDb) this._notesDb.discard();
    this._notesDb = null;

    this._rootEl = null;
    resetAOS();
    await Promise.resolve();
  }

  onRefresh(): void {
    void this._reloadDbs().then(() => this._render());
  }

  /**
   * Close and re-open both SQLite databases so we pick up any
   * changes written by the note-review or main plugin while
   * this view was in the background.
   */
  private async _reloadDbs(): Promise<void> {
    try {
      // Use discard() instead of close() so we do NOT persist the stale
      // in-memory snapshot back to disk — we want to READ the fresh
      // bytes that main.ts / note-review wrote while this view was away.
      if (this._notesDb) { this._notesDb.discard(); this._notesDb = null; }
      this._notesDb = new NoteReviewSqlite(this.plugin);
      await this._notesDb.open();
    } catch (e: unknown) { log.swallow("reload notesDb", e); }
    try {
      if (this._coachDb) { this._coachDb.discard(); this._coachDb = null; }
      this._coachDb = new CoachPlanSqlite(this.plugin);
      await this._coachDb.open();
    } catch (e: unknown) { log.swallow("reload coachDb", e); }
  }

  private _applyMaxWidth(): void {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    if (!this._rootEl) return;
    const maxWidth = this.plugin.isWideMode ? "none" : MAX_CONTENT_WIDTH_PX;
    if (this._rootEl) setCssProps(this._rootEl, "--lk-home-max-width", maxWidth);
  }

  private _allFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  private _scopeFromParts(scopeType: string, scopeKey: string, scopeName: string): Scope {
    if (scopeType === "folder") return { type: "folder", key: scopeKey, name: scopeName || scopeKey || "Folder" };
    if (scopeType === "note") return { type: "note", key: scopeKey, name: scopeName || scopeKey || "Note" };
    if (scopeType === "group") return { type: "group", key: scopeKey, name: scopeName || scopeKey || "Group" };
    if (scopeType === "tag") return { type: "tag", key: scopeKey, name: scopeName || `#${scopeKey}` || "Tag" };
    if (scopeType === "property") return { type: "property", key: scopeKey, name: scopeName || scopeKey || "Property" };
    return { type: "vault", key: "", name: scopeName || this.app.vault.getName() || "Vault" };
  }

  private _scopeOptions(): ScopeOption[] {
    const options: ScopeOption[] = [];
    const allFiles = this._allFiles();

    options.push({
      label: `Vault: ${this.app.vault.getName()} (${allFiles.length})`,
      scope: { type: "vault", key: "", name: this.app.vault.getName() || "Vault" },
    });

    const folderSet = new Set<string>();
    for (const file of allFiles) {
      const slash = file.path.lastIndexOf("/");
      if (slash >= 0) folderSet.add(file.path.slice(0, slash));
    }

    for (const folder of Array.from(folderSet).sort((a, b) => a.localeCompare(b))) {
      const count = allFiles.filter((file) => file.path.startsWith(`${folder}/`)).length;
      options.push({
        label: `Folder: ${folder} (${count})`,
        scope: { type: "folder", key: folder, name: folder },
      });
    }

    for (const file of allFiles.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 2500)) {
      options.push({
        label: `Note: ${file.basename}`,
        scope: { type: "note", key: file.path, name: file.basename },
      });
    }

    const metadata = collectVaultTagAndPropertyPairs(this.app, allFiles);
    for (const tag of metadata.tags.slice(0, 1500)) {
      options.push({
        label: `Tag: ${tag.display} (${tag.count})`,
        scope: { type: "tag", key: tag.token, name: `#${tag.token}` },
      });
    }

    for (const pair of metadata.properties.slice(0, 2000)) {
      options.push({
        label: `${pair.displayKey}: ${pair.displayValue} (${pair.count})`,
        scope: {
          type: "property",
          key: encodePropertyPair({ key: pair.key, value: pair.value }),
          name: `${pair.displayKey}: ${pair.displayValue}`,
        },
      });
    }

    this._scopeLookup.clear();
    for (const option of options) {
      this._scopeLookup.set(toScopeId(option.scope), option.scope);
    }

    return options;
  }

  private _cardsInScope(scope: Scope): Array<{ id: string; sourceNotePath: string; stage: string; due: number; buriedUntil?: number | null }> {
    const cards = this.plugin.store.getAllCards().filter((c) => !isParentCard(c));
    const states = this.plugin.store.data.states || {};

    return cards
      .filter((card) => {
        if (scope.type === "group") {
          const groups = Array.isArray(card.groups) ? card.groups : [];
          return groups.some((g) => String(g || "") === scope.key);
        }
        if (scope.type === "tag" || scope.type === "property") {
          return this._pathMatchesMetadataScope(String(card.sourceNotePath || ""), scope);
        }
        return matchesScope(scope, String(card.sourceNotePath || ""));
      })
      .map((card) => {
        const st = states[String(card.id)] || { stage: "new", due: 0 };
        return {
          id: String(card.id),
          sourceNotePath: String(card.sourceNotePath || ""),
          stage: String(st.stage || "new"),
          due: Number(st.due || 0),
          buriedUntil: typeof st.buriedUntil === "number" ? st.buriedUntil : null,
        };
      });
  }

  private _dueNoteIdsInScope(scope: Scope, now: number): string[] {
    if (!this._notesDb) return [];
    const ids = this._notesDb.listDueNoteIds(now, 1000000);
    if (scope.type === "vault") return ids;

    if (scope.type === "group") {
      const groupPaths = new Set<string>();
      for (const card of this.plugin.store.getAllCards()) {
        const groups = Array.isArray(card.groups) ? card.groups : [];
        if (!groups.some((g) => String(g || "") === scope.key)) continue;
        const path = String(card.sourceNotePath || "").trim();
        if (path) groupPaths.add(path);
      }
      return ids.filter((path) => groupPaths.has(path));
    }

    return ids.filter((path) => {
      if (scope.type === "note") return path === scope.key;
      if (scope.type === "folder") return path === scope.key || path.startsWith(`${scope.key}/`);
      if (scope.type === "tag" || scope.type === "property") return this._pathMatchesMetadataScope(path, scope);
      return false;
    });
  }

  private _pathMatchesMetadataScope(path: string, scope: Scope): boolean {
    const abs = this.app.vault.getAbstractFileByPath(path);
    if (!(abs instanceof TFile)) return false;
    return this._fileMatchesMetadataScope(abs, scope);
  }

  private _fileMatchesMetadataScope(file: TFile, scope: Scope): boolean {
    if (scope.type === "tag") {
      const expected = String(scope.key || "").trim().toLowerCase().replace(/^#+/, "");
      if (!expected) return false;
      const tags = extractFileTags(this.app, file);
      return tags.has(expected);
    }

    if (scope.type === "property") {
      const target = decodePropertyPair(scope.key);
      if (!target) return false;
      const pairs = extractFilePropertyPairs(this.app, file);
      return pairs.some((pair) => pair.key === target.key && pair.value === target.value);
    }

    return false;
  }

  private _computeStats(scope: Scope, now: number): PlannerStats {
    const cards = this._cardsInScope(scope);
    let dueCards = 0;
    let newCards = 0;

    for (const c of cards) {
      if (c.stage === "suspended") continue;
      if (c.stage === "new") {
        newCards += 1;
        continue;
      }

      const buried = typeof c.buriedUntil === "number" && c.buriedUntil > now;
      if (buried) continue;

      if (Number.isFinite(c.due) && c.due <= now) dueCards += 1;
    }

    const dueNotes = this._dueNoteIdsInScope(scope, now).length;
    return { dueCards, newCards, dueNotes };
  }

  private _computeAggregateStats(scopes: Scope[], now: number): AggregateStats {
    const cardMap = new Map<string, { stage: string; due: number; buriedUntil: number | null }>();
    const dueNotes = new Set<string>();

    for (const scope of scopes) {
      for (const card of this._cardsInScope(scope)) {
        if (!cardMap.has(card.id)) {
          cardMap.set(card.id, {
            stage: card.stage,
            due: card.due,
            buriedUntil: typeof card.buriedUntil === "number" ? card.buriedUntil : null,
          });
        }
      }
      for (const noteId of this._dueNoteIdsInScope(scope, now)) dueNotes.add(noteId);
    }

    let dueCards = 0;
    let newCards = 0;

    for (const card of cardMap.values()) {
      if (card.stage === "suspended") continue;
      if (card.stage === "new") {
        newCards += 1;
        continue;
      }
      const buried = typeof card.buriedUntil === "number" && card.buriedUntil > now;
      if (buried) continue;
      if (Number.isFinite(card.due) && card.due <= now) dueCards += 1;
    }

    return {
      dueCards,
      newCards,
      dueNotes: dueNotes.size,
      totalCards: cardMap.size,
    };
  }

  private _computeHealth(
    stats: AggregateStats,
    daysLeft: number,
    dailyFlashTarget: number,
    dailyNoteTarget: number,
    avgRetention: number,
    totalNotes: number,
    reviewedNoteCount: number,
    avgNoteRetention: number,
  ) {
    // Flashcard health: blend studied-card mastery with time-feasibility
    // for unstudied cards.  Studied portion weighted by FSRS retrievability;
    // unstudied portion weighted by whether there is enough time to learn
    // them before exam day (dampened by 0.75 because capacity ≠ knowledge).
    const studiedCards = Math.max(0, stats.totalCards - stats.newCards);
    const studiedFrac = clamp01(studiedCards / Math.max(1, stats.totalCards));
    const unstudiedFrac = 1 - studiedFrac;
    const workLeft = Math.max(1, stats.dueCards + stats.newCards);
    const flashCapacity = daysLeft * Math.max(1, dailyFlashTarget);
    const flashFeasibility = clamp01(flashCapacity / workLeft);
    const flashScore = Math.round(
      clamp01(studiedFrac * avgRetention + unstudiedFrac * flashFeasibility * 0.75) * 100,
    );

    // Note health: same structure — reviewed-note mastery + feasibility
    // for unreviewed notes.
    const reviewedNoteFrac = clamp01(reviewedNoteCount / Math.max(1, totalNotes));
    const unreviewedNoteFrac = 1 - reviewedNoteFrac;
    const unreviewedNotes = Math.max(1, totalNotes - reviewedNoteCount);
    const noteCapacity = daysLeft * Math.max(1, dailyNoteTarget);
    const noteFeasibility = clamp01(noteCapacity / unreviewedNotes);
    const noteScore = Math.round(
      clamp01(reviewedNoteFrac * avgNoteRetention + unreviewedNoteFrac * noteFeasibility * 0.75) * 100,
    );

    // Exam health: weighted composite of flash and note health.
    const examScore = Math.round(
      clamp01((flashScore / 100) * 0.55 + (noteScore / 100) * 0.45) * 100,
    );

    const flash: HealthStatus = { score: flashScore, label: toLabel(flashScore), toneClass: toTone(flashScore) };
    const note: HealthStatus = { score: noteScore, label: toLabel(noteScore), toneClass: toTone(noteScore) };
    const exam: HealthStatus = { score: examScore, label: toLabel(examScore), toneClass: toTone(examScore) };

    return { flash, note, exam };
  }

  private async _upsertPlan(scope: Scope, examDateUtc: number, intensity: CoachIntensity, planName = "", scopes: Scope[] = []): Promise<void> {
    if (!this._coachDb) return;

    const allScopes = scopes.length > 0 ? scopes : [scope];
    const now = Date.now();
    const stats = this._computeAggregateStats(allScopes, now);
    const days = daysLeftToExam(examDateUtc, now);
    const mul = intensityMultiplier(intensity);

    const dailyFlashcardTarget = Math.max(0, Math.ceil(((stats.dueCards + stats.newCards) / days) * mul));
    const dailyNoteTarget = Math.max(0, Math.ceil((stats.dueNotes / days) * mul));

    const dayUtc = startOfDayUtc(now);
    const progress = this._coachDb.getProgress(dayUtc, scope.type, scope.key);
    const status = computeStatus(dailyFlashcardTarget, dailyNoteTarget, progress.flashcard, progress.note);

    const scopeData = allScopes.length > 1
      ? JSON.stringify(allScopes.map((s) => ({ type: s.type, key: s.key, name: s.name })))
      : "";

    this._coachDb.upsertPlan({
      scope_type: scope.type,
      scope_key: scope.key,
      scope_name: scope.name,
      plan_name: planName,
      scope_data: scopeData,
      exam_date_utc: examDateUtc,
      intensity,
      daily_flashcard_target: dailyFlashcardTarget,
      daily_note_target: dailyNoteTarget,
      status,
      updated_at: now,
    });

    await this._coachDb.persist();
  }

  private _scopesForPlan(plan: CoachPlanRow): Scope[] {
    if (plan.scope_data) {
      try {
        const parsed = JSON.parse(plan.scope_data) as Array<{ type: string; key: string; name: string }>;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s) => this._scopeFromParts(s.type, s.key, s.name));
        }
      } catch {
        // fall through
      }
    }
    return [this._scopeFromParts(plan.scope_type, plan.scope_key, plan.scope_name)];
  }

  private _renderEmptyCta(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card sprout-coach-cta-card" });
    card.createEl("h3", { text: "Create your first exam plan" });
    card.createEl("p", {
      text: "Build a custom study plan with focused targets on notes and folders within your vault. Study coach will develop a unique, tailored plan to ensure you are ready for exam day.",
    });

    const cta = card.createEl("button", {
      cls: "bc sprout-btn-toolbar sprout-btn-accent",
      text: "Get started",
    });
    cta.type = "button";
    cta.addEventListener("click", () => {
      this._wizardVisible = true;
      this._wizardStep = 0;
      void this._render();
    });
  }

  private _renderWizard(shell: HTMLElement, options: ScopeOption[], hasExistingPlans: boolean): void {
    const card = shell.createDiv({ cls: "card sprout-coach-wizard-card" });

    if (hasExistingPlans) {
      const exitBtn = card.createEl("button", { cls: "sprout-btn-toolbar h-9 flex items-center gap-2 equal-height-btn sprout-btn-exit-sm sprout-btn-top-right" });
      exitBtn.type = "button";
      exitBtn.ariaLabel = "Exit plan creator";
      const exitIcon = exitBtn.createSpan({ cls: "inline-flex items-center justify-center sprout-btn-icon" });
      setIcon(exitIcon, "x");
      exitBtn.addEventListener("click", () => {
        this._wizardVisible = false;
        this._wizardStep = 0;
        this._wizardSlide = "back";
        void this._render();
      });
    }

    const stepper = card.createDiv({ cls: "sprout-coach-stepper" });
    this._wizardCardEl = card;
    this._wizardStepperEl = stepper;
    ["Topics", "Schedule", "Review"].forEach((label, idx) => {
      const step = stepper.createDiv({ cls: "sprout-coach-step-item" });
      const dot = step.createDiv({ cls: "sprout-coach-step-dot" });
      if (idx < this._wizardStep) dot.classList.add("is-done");
      else if (idx === this._wizardStep) dot.classList.add("is-active");
      step.createDiv({ cls: "sprout-coach-step-label", text: label });
      if (idx < 2) {
        const line = step.createDiv({ cls: "sprout-coach-step-line" });
        if (idx < this._wizardStep) line.classList.add("is-done");
      }
    });

    const page = card.createDiv({ cls: "sprout-coach-wizard-page" });
    this._wizardPageEl = page;
    if (this._wizardSlide === "next") page.classList.add("is-enter-next");
    if (this._wizardSlide === "back") page.classList.add("is-enter-back");

    if (this._wizardStep === 0) {
      this._renderWizardScopeStep(page, options);
      return;
    }

    if (this._wizardStep === 1) {
      this._renderWizardScheduleStep(page);
      return;
    }

    this._renderWizardReviewStep(page);
  }

  private _transitionWizardPage(newStep: number, direction: "next" | "back"): void {
    const card = this._wizardCardEl;
    const stepper = this._wizardStepperEl;
    const oldPage = this._wizardPageEl;
    if (!card || !stepper || !oldPage) {
      this._wizardStep = newStep;
      this._wizardSlide = direction;
      void this._render();
      return;
    }

    this._wizardStep = newStep;

    const dots = stepper.querySelectorAll<HTMLElement>(".sprout-coach-step-dot");
    const lines = stepper.querySelectorAll<HTMLElement>(".sprout-coach-step-line");
    dots.forEach((dot, idx) => {
      dot.classList.toggle("is-done", idx < newStep);
      dot.classList.toggle("is-active", idx === newStep);
    });
    lines.forEach((line, idx) => {
      line.classList.toggle("is-done", idx < newStep);
    });

    const exitClass = direction === "next" ? "is-exit-next" : "is-exit-back";
    oldPage.classList.add(exitClass);

    const onExitDone = (): void => {
      oldPage.removeEventListener("animationend", onExitDone);
      oldPage.remove();

      const newPage = card.createDiv({ cls: "sprout-coach-wizard-page" });
      this._wizardPageEl = newPage;
      const enterClass = direction === "next" ? "is-enter-next" : "is-enter-back";
      newPage.classList.add(enterClass);

      const options = this._scopeOptions();
      if (newStep === 0) this._renderWizardScopeStep(newPage, options);
      else if (newStep === 1) this._renderWizardScheduleStep(newPage);
      else this._renderWizardReviewStep(newPage);

      this._wizardSlide = null;
    };

    oldPage.addEventListener("animationend", onExitDone);
  }

  private _renderWizardScopeStep(card: HTMLElement, options: ScopeOption[]): void {
    card.createEl("h3", { text: "Select what you are studying" });
    card.createEl("p", {
      cls: "sprout-coach-step-copy",
      text: "Choose the content to include in your study plan, such as the notes or folders you need to revise.",
    });

    card.createDiv({ cls: "sprout-coach-field-label", text: "Plan name" });
    const nameInput = card.createEl("input", { cls: "bc input h-9", attr: { type: "text", placeholder: "Biology finals" } });
    nameInput.value = this._planName;
    nameInput.addEventListener("input", () => {
      this._planName = String(nameInput.value || "").trim();
    });

    card.createDiv({ cls: "sprout-coach-field-label sprout-coach-field-label-gap", text: "Content" });
    const searchWrap = card.createDiv({ cls: "sprout-coach-search-wrap" });
    const searchIcon = searchWrap.createSpan({ cls: "sprout-coach-search-icon" });
    setIcon(searchIcon, "search");
    const search = searchWrap.createEl("input", { cls: "bc input h-9", attr: { type: "search", placeholder: "Search notes, folders, tags, or properties..." } });
    search.value = this._searchQuery;
    const popover = searchWrap.createDiv({ cls: "sprout-coach-scope-popover dropdown-menu hidden" });
    const list = popover.createDiv({ cls: "sprout-coach-scope-list min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto" });
    list.setAttr("role", "menu");
    list.setAttr("aria-label", "Content matches");

    const chipsWrap = card.createDiv({ cls: "sprout-coach-selected-wrap" });
    const selectedTitle = chipsWrap.createDiv({ cls: "sprout-coach-selected-title", text: `Study content (${this._selectedScopeIds.size})` });
    const chips = chipsWrap.createDiv({ cls: "sprout-coach-selected-chips" });

    const footer = card.createDiv({ cls: "sprout-coach-wizard-footer" });
    const cancel = footer.createEl("button", { cls: "h-9 flex items-center gap-2 equal-height-btn sprout-btn-control", text: "Cancel" });
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      this._wizardVisible = false;
      this._wizardStep = 0;
      this._wizardSlide = "back";
      void this._render();
    });

    const next = footer.createEl("button", { cls: "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2", text: "Next" });
    next.type = "button";
    next.disabled = !this._selectedScopeIds.size;
    next.addEventListener("click", () => {
      this._transitionWizardPage(1, "next");
    });

    const toggleScopeSelection = (scopeId: string): void => {
      if (this._selectedScopeIds.has(scopeId)) this._selectedScopeIds.delete(scopeId);
      else this._selectedScopeIds.add(scopeId);
      next.disabled = !this._selectedScopeIds.size;
      renderSelected();
      scopePicker.render();
    };

    const renderSelected = (): void => {
      selectedTitle.setText(`Selected (${this._selectedScopeIds.size})`);
      chips.empty();
      if (!this._selectedScopeIds.size) {
        chips.createDiv({ cls: "text-xs text-muted-foreground", text: "No content selected yet." });
      } else {
        for (const scopeId of this._selectedScopeIds) {
          const option = options.find((entry) => toScopeId(entry.scope) === scopeId);
          if (!option) continue;
          const chip = chips.createDiv({ cls: "sprout-coach-chip" });
          if (option.scope.type === "folder") {
            const folderPath = String(option.scope.key || option.scope.name || "").trim();
            const count = this._allFiles().filter((file) => file.path.startsWith(`${folderPath}/`)).length;
            chip.createSpan({ text: `Folder: ${formatFolderChipLabel(folderPath)} (${count})` });
          } else {
            chip.createSpan({ text: option.label });
          }
          const remove = chip.createEl("button", { cls: "sprout-coach-chip-remove" });
          remove.type = "button";
          remove.setAttr("aria-label", "Remove");
          setIcon(remove, "x");
          remove.addEventListener("click", (evt) => {
            evt.stopPropagation();
            this._selectedScopeIds.delete(scopeId);
            next.disabled = !this._selectedScopeIds.size;
            renderSelected();
            scopePicker.render();
          });
        }
      }
    };

    const scopePicker = mountSearchPopoverList({
      searchInput: search,
      popoverEl: popover,
      listEl: list,
      getQuery: () => this._searchQuery,
      setQuery: (query) => {
        this._searchQuery = query;
      },
      getOptions: (): SearchPopoverOption[] => options.map((option) => {
        const scopeId = toScopeId(option.scope);
        const propertyParts = option.scope.type === "property" ? String(option.scope.name || "").split(":") : [];
        const propertyKey = propertyParts.length ? propertyParts[0]?.trim() : undefined;
        const propertyValue = propertyParts.length > 1 ? propertyParts.slice(1).join(":").trim() : undefined;
        return {
          id: scopeId,
          label: option.label,
          selected: this._selectedScopeIds.has(scopeId),
          type: option.scope.type === "vault" || option.scope.type === "folder" || option.scope.type === "note" || option.scope.type === "tag" || option.scope.type === "property"
            ? option.scope.type
            : undefined,
          propertyKey,
          propertyValue,
          searchTexts: [option.scope.name, option.scope.key],
        };
      }),
      onToggle: toggleScopeSelection,
      emptyTextWhenQuery: "No matching notes, folders, tags, or properties.",
      emptyTextWhenIdle: "Type to search notes, folders, tags, or properties.",
      typeFilters: [
        { type: "folder", label: "Folders" },
        { type: "note", label: "Notes" },
        { type: "tag", label: "Tags" },
        { type: "property", label: "Properties" },
      ],
    });

    renderSelected();
    scopePicker.render();
  }

  private _renderWizardScheduleStep(card: HTMLElement): void {
    card.createEl("h3", { text: "Set timeline and intensity" });
    card.createEl("p", {
      cls: "sprout-coach-step-copy",
      text: "Choose your exam date and study pressure level. Targets update dynamically as your workload changes.",
    });

    card.createDiv({ cls: "sprout-coach-field-label", text: "Exam date" });
    const dateInput = card.createEl("input", { cls: "bc input" });
    dateInput.type = "date";
    dateInput.value = this._examDateInput;
    dateInput.addEventListener("change", () => {
      this._examDateInput = String(dateInput.value || "").trim();
    });

    card.createDiv({ cls: "sprout-coach-field-label", text: "Intensity" });
    const optionsWrap = card.createDiv({ cls: "sprout-coach-intensity-grid" });
    const intensityMeta: Array<{ value: CoachIntensity; title: string; desc: string }> = [
      {
        value: "relaxed",
        title: "Relaxed",
        desc: "10% fewer daily tasks. Better for consistency and avoiding burnout.",
      },
      {
        value: "balanced",
        title: "Balanced",
        desc: "Default pace. Strong exam progress while staying sustainable.",
      },
      {
        value: "aggressive",
        title: "Aggressive",
        desc: "15% higher daily load for focused exam cramming periods.",
      },
    ];

    for (const entry of intensityMeta) {
      const option = optionsWrap.createDiv({ cls: "sprout-coach-intensity-option" });
      const btn = option.createEl("button", { cls: "sprout-coach-intensity-btn" });
      btn.type = "button";
      if (entry.value === this._intensity) btn.classList.add("is-active");
      btn.createDiv({ cls: "sprout-coach-intensity-title", text: entry.title });
      option.createDiv({ cls: "sprout-coach-intensity-desc", text: entry.desc });
      btn.addEventListener("click", () => {
        this._intensity = entry.value;
        optionsWrap.querySelectorAll<HTMLElement>(".sprout-coach-intensity-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    const footer = card.createDiv({ cls: "sprout-coach-wizard-footer" });
    const back = footer.createEl("button", { cls: "bc sprout-btn-toolbar h-9 inline-flex items-center gap-2", text: "Back" });
    back.type = "button";
    back.addEventListener("click", () => {
      this._transitionWizardPage(0, "back");
    });

    const next = footer.createEl("button", { cls: "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2", text: "Next" });
    next.type = "button";
    next.addEventListener("click", () => {
      if (!this._examDateInput) {
        new Notice("Select an exam date.");
        return;
      }
      this._transitionWizardPage(2, "next");
    });
  }

  private _renderWizardReviewStep(card: HTMLElement): void {
    const selectedScopes = Array.from(this._selectedScopeIds)
      .map((id) => fromScopeId(id, this._scopeLookup))
      .filter((scope): scope is Scope => !!scope);

    card.createEl("h3", { text: "Review and start plan" });
    card.createEl("p", {
      cls: "sprout-coach-step-copy",
      text: "Targets will update dynamically each day to track readiness and keep studying within your chosen scope.",
    });

    const rawDate = String(this._examDateInput || "").trim();
    const examDateUtc = startOfDayUtc(new Date(`${rawDate}T00:00:00.000Z`).getTime());
    const now = Date.now();
    const daysLeft = Number.isFinite(examDateUtc) ? daysLeftToExam(examDateUtc, now) : 1;
    const stats = this._computeAggregateStats(selectedScopes, now);
    const dailyFlash = Math.max(0, Math.ceil(((stats.dueCards + stats.newCards) / daysLeft) * intensityMultiplier(this._intensity)));
    const dailyNote = Math.max(0, Math.ceil((stats.dueNotes / daysLeft) * intensityMultiplier(this._intensity)));

    const summary = card.createDiv({ cls: "sprout-coach-summary" });
    const list = summary.createDiv({ cls: "sprout-coach-summary-list" });
    for (const scope of selectedScopes.slice(0, 8)) {
      const row = list.createDiv({ cls: "sprout-coach-summary-row" });
      const icon = row.createSpan({ cls: "sprout-coach-summary-icon" });
      setIcon(icon, scope.type === "note" ? "file-text" : scope.type === "folder" ? "folder" : "layers");
      row.createSpan({ cls: "sprout-coach-summary-text", text: scope.name });
    }

    const meta = summary.createDiv({ cls: "sprout-coach-summary-meta" });
    if (this._planName) meta.createDiv({ text: `Plan Name: ${this._planName}` });
    meta.createDiv({ text: `Exam Date: ${formatShortDate(examDateUtc)}` });
    meta.createDiv({ text: `Intensity: ${titleCaseIntensity(this._intensity)}` });
    meta.createDiv({ text: `Estimated Daily Target: ${dailyFlash} flashcards + ${dailyNote} notes` });

    const footer = card.createDiv({ cls: "sprout-coach-wizard-footer" });
    const back = footer.createEl("button", { cls: "bc sprout-btn-toolbar h-9 inline-flex items-center gap-2", text: "Back" });
    back.type = "button";
    back.addEventListener("click", () => {
      this._transitionWizardPage(1, "back");
    });

    const start = footer.createEl("button", { cls: "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2", text: "Start plan" });
    start.type = "button";
    start.addEventListener("click", () => {
      void (async () => {
        if (!selectedScopes.length) {
          new Notice("Select at least one scope.");
          return;
        }
        if (!Number.isFinite(examDateUtc)) {
          new Notice("Invalid exam date.");
          return;
        }

        const existingPlans = this._coachDb?.listPlans() ?? [];
        const primaryScope = selectedScopes[0];
        const isNew = !existingPlans.some((p) => planScopeId(p) === toScopeId(primaryScope));
        if (isNew && existingPlans.length >= 4) {
          new Notice("You can have up to 4 plans. Delete one to add another.");
          return;
        }

        await this._upsertPlan(primaryScope, examDateUtc, this._intensity, this._planName, selectedScopes);
        this._wizardVisible = false;
        this._wizardStep = 0;
        this._wizardSlide = "back";
        this._searchQuery = "";
        this._planName = "";
        this._selectedScopeIds.clear();
        new Notice("Exam plan saved.");
        await this._render();
      })();
    });
  }

  private _buildReadinessTimeline(plan: CoachPlanRow, scope: Scope, now: number): {
    points: ExamReadinessPoint[];
    todayIndex: number;
    startLabel: string;
    endLabel: string;
    totalDays: number;
  } {
    const empty = { points: [], todayIndex: 0, startLabel: "", endLabel: "", totalDays: 0 };
    if (!this._coachDb) return empty;

    const todayUtc = startOfDayUtc(now);
    const planStartUtc = startOfDayUtc(plan.updated_at);
    const examUtc = startOfDayUtc(plan.exam_date_utc);

    const startUtc = Math.min(planStartUtc, todayUtc);
    const endUtc = Math.max(examUtc, todayUtc);
    const totalDays = Math.max(1, Math.round((endUtc - startUtc) / MS_DAY));
    const todayIndex = Math.max(0, Math.round((todayUtc - startUtc) / MS_DAY));
    const dailyTarget = Math.max(1, plan.daily_flashcard_target + plan.daily_note_target);

    const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const startLabel = fmt(startUtc);
    const endLabel = fmt(endUtc);

    // Compute current aggregate retention from FSRS card states
    const states = this.plugin.store.data.states || {};
    const scopeCards = this._cardsInScope(scope);
    const schedulingCfg = this.plugin.settings?.scheduling;
    const requestRetention = Math.max(0.8, Math.min(0.97, Number(schedulingCfg?.requestRetention) || 0.9));
    const fsrsParams = generatorParameters({ request_retention: requestRetention });

    const computeRetention = (atMs: number): number => {
      let sum = 0;
      let count = 0;
      for (const sc of scopeCards) {
        const st = states[sc.id];
        if (!st) continue;
        if (st.stage === "new" || st.stage === "suspended") continue;
        const stability = Number(st.stabilityDays ?? 0);
        const lastReviewed = Number(st.lastReviewed ?? 0);
        if (stability <= 0 || lastReviewed <= 0) continue;
        const elapsed = Math.max(0, (atMs - lastReviewed) / MS_DAY);
        sum += forgetting_curve(fsrsParams.w, elapsed, stability);
        count += 1;
      }
      return count > 0 ? sum / count : requestRetention;
    };

    // Compute card coverage at a point in time for readiness scoring
    const totalScopeCards = Math.max(1, scopeCards.length);
    const newCardCount = scopeCards.filter((c) => {
      const st = states[c.id];
      return !st || st.stage === "new";
    }).length;

    // Build past points
    const points: ExamReadinessPoint[] = [];
    let cumulativeActual = 0;

    for (let i = 0; i <= todayIndex; i++) {
      const dayUtc = startUtc + i * MS_DAY;
      const progress = this._coachDb.getProgress(dayUtc, plan.scope_type, plan.scope_key);
      cumulativeActual += progress.flashcard + progress.note;

      // Readiness = studied-card mastery + time-feasibility for the rest,
      // matching the health model so the chart is consistent with the bars.
      const retention = computeRetention(dayUtc);
      const daysRemaining = Math.max(1, totalDays - i);
      const studiedFrac = clamp01((totalScopeCards - newCardCount + Math.min(cumulativeActual, newCardCount)) / totalScopeCards);
      const unstudiedFrac = 1 - studiedFrac;
      const capacity = daysRemaining * dailyTarget;
      const feasibility = clamp01(capacity / Math.max(1, totalScopeCards * unstudiedFrac));
      const les = Math.round(clamp01(studiedFrac * retention + unstudiedFrac * feasibility * 0.75) * 100);

      points.push({
        dayIndex: i,
        label: fmt(dayUtc),
        readiness: les,
        projected: i === todayIndex ? les : null,
      });
    }

    // Project future points using FSRS memory model + plan targets
    // As user studies, cards move from unstudied → studied, shifting the\n    // blend toward mastery.  Retention models FSRS decay + review recovery.
    const avgStability = (() => {
      let sum = 0, count = 0;
      for (const sc of scopeCards) {
        const st = states[sc.id];
        if (!st || st.stage === "new" || st.stage === "suspended") continue;
        const s = Number(st.stabilityDays ?? 0);
        if (s > 0) { sum += s; count += 1; }
      }
      return count > 0 ? sum / count : 7;
    })();

    for (let i = todayIndex + 1; i <= totalDays; i++) {
      const dayUtc = startUtc + i * MS_DAY;
      const daysFromToday = i - todayIndex;
      const daysRemaining = Math.max(1, totalDays - i);

      // Model FSRS decay + review recovery for retention projection
      const decayedRetention = forgetting_curve(fsrsParams.w, daysFromToday, avgStability);
      const reviewCoverage = clamp01(daysFromToday * dailyTarget / Math.max(1, scopeCards.length));
      const projectedRetention = decayedRetention * (1 - reviewCoverage) + requestRetention * reviewCoverage;

      // Projected coverage: assume user studies dailyTarget items per day
      const projectedStudied = cumulativeActual + daysFromToday * dailyTarget;
      const projectedStudiedFrac = clamp01((totalScopeCards - newCardCount + Math.min(projectedStudied, newCardCount)) / totalScopeCards);
      const projectedUnstudiedFrac = 1 - projectedStudiedFrac;
      const projectedCapacity = daysRemaining * dailyTarget;
      const projectedFeasibility = clamp01(projectedCapacity / Math.max(1, totalScopeCards * projectedUnstudiedFrac));

      const les = Math.round(clamp01(
        projectedStudiedFrac * projectedRetention + projectedUnstudiedFrac * projectedFeasibility * 0.75,
      ) * 100);

      points.push({
        dayIndex: i,
        label: fmt(dayUtc),
        readiness: null,
        projected: les,
      });
    }

    return { points, todayIndex, startLabel, endLabel, totalDays };
  }

  private _mountHealthPanel(
    host: HTMLElement,
    health: { flash: HealthStatus; note: HealthStatus; exam: HealthStatus },
  ): void {
    try {
      this._chartsRoot?.unmount();
    } catch {
      // no-op
    }

    this._chartsRoot = createRoot(host);
    this._chartsRoot.render(
      React.createElement(CoachHealthPanel, {
        flash: { score: health.flash.score, label: health.flash.label },
        note: { score: health.note.score, label: health.note.label },
        exam: { score: health.exam.score, label: health.exam.label },
      }),
    );
  }

  private _mountReadinessChart(
    host: HTMLElement,
    readiness: ExamReadinessPoint[],
    todayIndex: number,
    startLabel: string,
    endLabel: string,
    totalDays: number,
  ): void {
    try {
      this._readinessRoot?.unmount();
    } catch {
      // no-op
    }

    this._readinessRoot = createRoot(host);
    this._readinessRoot.render(
      React.createElement(CoachReadinessPanel, {
        readiness,
        todayIndex,
        startLabel,
        endLabel,
        totalDays,
      }),
    );
  }

  private _renderScopeCard(host: HTMLElement, plan: CoachPlanRow, now: number): void {
    if (!this._coachDb) return;

    const scope = this._scopeFromParts(plan.scope_type, plan.scope_key, plan.scope_name);
    const dayUtc = startOfDayUtc(now);
    const progress = this._coachDb.getProgress(dayUtc, plan.scope_type, plan.scope_key);
    const daysLeft = daysLeftToExam(plan.exam_date_utc, now);
    const dailyFlashTarget = Math.max(0, plan.daily_flashcard_target);
    const dailyNoteTarget = Math.max(0, plan.daily_note_target);
    const totalTarget = Math.max(1, dailyFlashTarget + dailyNoteTarget);
    const donePct = Math.round(clamp01((progress.flashcard + progress.note) / totalTarget) * 100);

    const card = host.createDiv({ cls: "card sprout-coach-plan-card" });
    const header = card.createDiv({ cls: "sprout-coach-progress-header" });
    const headerLeft = header.createDiv();
    const headingRow = headerLeft.createDiv({ cls: "sprout-coach-health-heading-row" });
    const heroTitle = formatScopePlanTitle(plan.plan_name || plan.scope_name || scope.name);
    headingRow.createDiv({ cls: "sprout-coach-health-title", text: heroTitle.title });
    const subtitleParts = [heroTitle.hierarchy, `Exam in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`].filter(Boolean);
    headerLeft.createDiv({ cls: "sprout-coach-step-copy", text: subtitleParts.join(" • ") || scope.type });

    // Daily progress bar
    const progressSection = card.createDiv({ cls: "sprout-coach-daily-progress" });
    const progressMeta = progressSection.createDiv({ cls: "sprout-coach-daily-progress-meta" });
    progressMeta.createSpan({ cls: "sprout-coach-daily-progress-label", text: `${donePct}% of today's target` });
    const doneCount = progress.flashcard + progress.note;
    progressMeta.createSpan({ cls: "sprout-coach-daily-progress-count", text: `${doneCount} / ${totalTarget}` });
    const progressTrack = progressSection.createDiv({ cls: "sprout-coach-daily-progress-track" });
    const progressFill = progressTrack.createDiv({ cls: "sprout-coach-daily-progress-fill" });
    setCssProps(progressFill, "--sprout-daily-progress-width", `${Math.min(100, donePct)}%`);
    if (donePct >= 100) progressFill.classList.add("is-complete");

    // Remaining today line
    const remainingFlash = Math.max(0, dailyFlashTarget - progress.flashcard);
    const remainingNotes = Math.max(0, dailyNoteTarget - progress.note);
    const remainingParts: string[] = [];
    if (remainingFlash > 0) remainingParts.push(`${remainingFlash} flashcard${remainingFlash === 1 ? "" : "s"}`);
    if (remainingNotes > 0) remainingParts.push(`${remainingNotes} note${remainingNotes === 1 ? "" : "s"}`);
    const remainingText = remainingParts.length ? remainingParts.join(" + ") + " remaining" : "All done for today ✓";
    const remainingLine = card.createDiv({ cls: "sprout-coach-remaining-line" });
    remainingLine.createSpan({ text: remainingText });

    const actions = card.createDiv({ cls: "sprout-coach-actions" });

    const studyBtn = actions.createEl("button", {
      cls: "bc sprout-btn-control h-9 inline-flex items-center gap-2",
      text: "Study flashcards",
    });
    studyBtn.type = "button";
    studyBtn.addEventListener("click", () => {
      void this.plugin.openReviewerScopeWithOptions(scope, {
        ignoreDailyReviewLimit: true,
        ignoreDailyNewLimit: true,
        dueOnly: true,
      });
    });

    const notesBtn = actions.createEl("button", {
      cls: "bc sprout-btn-outline-muted h-9 inline-flex items-center gap-2",
      text: "Review notes",
    });
    notesBtn.type = "button";
    notesBtn.addEventListener("click", () => {
      void this.plugin.openNoteReviewScope(scope);
    });

    const testBtn = actions.createEl("button", {
      cls: "bc sprout-btn-outline-muted h-9 inline-flex items-center gap-2",
      text: "Generate practice test",
    });
    testBtn.type = "button";
    testBtn.addEventListener("click", () => {
      void this.plugin.openExamGeneratorScope(scope);
    });
  }

  private async _renderDashboard(shell: HTMLElement, plans: CoachPlanRow[]): Promise<void> {
    if (!this._coachDb) return;

    const now = Date.now();

    // Keep targets and status dynamic, no manual recompute button.
    for (const plan of plans) {
      const scope = this._scopeFromParts(plan.scope_type, plan.scope_key, plan.scope_name);
      const scopes = this._scopesForPlan(plan);
      await this._upsertPlan(scope, plan.exam_date_utc, plan.intensity, plan.plan_name, scopes);
    }

    const freshPlans = this._coachDb.listPlans();
    const maxPlans = 4;
    const shownPlans = [...freshPlans].sort((a, b) => a.exam_date_utc - b.exam_date_utc || a.scope_name.localeCompare(b.scope_name)).slice(0, maxPlans);
    const shownIds = new Set(shownPlans.map((plan) => planScopeId(plan)));
    if (!this._selectedPlanScopeId || !shownIds.has(this._selectedPlanScopeId)) {
      this._selectedPlanScopeId = shownPlans[0] ? planScopeId(shownPlans[0]) : null;
    }

    const switcherCard = shell.createDiv({ cls: "sprout-coach-switcher-card" });
    const switcherHeader = switcherCard.createDiv({ cls: "sprout-coach-switcher-header" });
    switcherHeader.createDiv({ cls: "sprout-coach-switcher-heading", text: "Your Study Plans" });

    const switcherGrid = switcherCard.createDiv({ cls: "sprout-coach-switcher-grid" });
    const selectorCards: HTMLButtonElement[] = [];
    const firstEmptySlot = shownPlans.length < maxPlans ? shownPlans.length : -1;

    const refreshSelectedCardState = () => {
      for (const card of selectorCards) {
        const scopeId = card.dataset.scopeId || "";
        card.setAttribute("aria-pressed", scopeId === this._selectedPlanScopeId ? "true" : "false");
      }
    };

    const dashboardBody = shell.createDiv({ cls: "sprout-coach-dashboard-body" });

    const renderSelectedPlanBody = () => {
      const activePlan = shownPlans.find((plan) => planScopeId(plan) === this._selectedPlanScopeId) ?? shownPlans[0] ?? null;
      refreshSelectedCardState();
      dashboardBody.empty();
      if (!activePlan) return;
      this._renderSelectedPlanBody(dashboardBody, activePlan, now);
    };

    for (let idx = 0; idx < maxPlans; idx += 1) {
      const slot = switcherGrid.createDiv({ cls: "sprout-coach-switcher-slot" });
      const plan = shownPlans[idx] ?? null;

      if (plan) {
        const id = planScopeId(plan);
        const scopeMeta = formatScopePlanTitle(plan.plan_name || plan.scope_name || "Plan");
        const days = daysLeftToExam(plan.exam_date_utc, now);
        slot.classList.add("is-filled");

        const planCard = slot.createEl("button", { cls: "card sprout-coach-switcher-plan-card" });
        planCard.type = "button";
        planCard.dataset.scopeId = id;
        planCard.setAttr("aria-label", `${scopeMeta.title} ${days}d left`);
        selectorCards.push(planCard);

        const titleRow = planCard.createDiv({ cls: "sprout-coach-switcher-plan-top" });
        titleRow.createSpan({ cls: "sprout-coach-switcher-plan-title", text: scopeMeta.title });
        titleRow.createSpan({ cls: "sprout-coach-switcher-plan-days", text: `${days}d` });

        planCard.createDiv({ cls: "sprout-coach-switcher-plan-date", text: `Exam ${formatShortDate(plan.exam_date_utc)}` });
        planCard.createDiv({
          cls: "sprout-coach-switcher-plan-overview",
          text: `${titleCaseIntensity(plan.intensity)} intensity${scopeMeta.hierarchy ? ` • ${scopeMeta.hierarchy}` : ""}`,
        });

        planCard.addEventListener("click", () => {
          this._selectedPlanScopeId = id;
          renderSelectedPlanBody();
        });

        const deleteBtn = slot.createEl("button", {
          cls: "bc sprout-btn-outline-muted sprout-btn-danger sprout-coach-switcher-delete",
        });
        deleteBtn.type = "button";
        deleteBtn.setAttr("aria-label", `Remove ${scopeMeta.title}`);
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          void (async () => {
            this._coachDb?.deletePlan(plan.scope_type, plan.scope_key);
            await this._coachDb?.persist();
            await this._render();
          })();
        });
        continue;
      }

      if (idx === firstEmptySlot && freshPlans.length < maxPlans) {
        const addCard = slot.createEl("button", {
          cls: "card sprout-coach-switcher-plan-card is-create",
        });
        addCard.type = "button";
        addCard.setAttr("aria-label", "Add plan");
        addCard.createSpan({ cls: "sprout-coach-switcher-slot-badge is-create", text: "Start here" });
        const plus = addCard.createSpan({ cls: "sprout-coach-switcher-create-plus", text: "+" });
        plus.setAttr("aria-hidden", "true");
        addCard.createDiv({ cls: "sprout-coach-switcher-create-title", text: "Add plan" });
        addCard.createDiv({ cls: "sprout-coach-switcher-create-copy", text: "Create a focused exam plan" });
        addCard.addEventListener("click", () => {
          this._wizardVisible = true;
          this._wizardStep = 0;
          this._wizardSlide = "next";
          void this._render();
        });
        continue;
      }

      const placeholder = slot.createDiv({ cls: "card sprout-coach-switcher-plan-card is-placeholder" });
      placeholder.createSpan({ cls: "sprout-coach-switcher-slot-badge is-available", text: "Available" });
      placeholder.createDiv({ cls: "sprout-coach-switcher-placeholder-title", text: "Unused slot" });
      placeholder.createDiv({ cls: "sprout-coach-switcher-placeholder-copy", text: "Add a plan to fill this card" });
    }

    refreshSelectedCardState();

    renderSelectedPlanBody();
  }

  private _renderSelectedPlanBody(host: HTMLElement, selectedPlan: CoachPlanRow, now: number): void {
    if (!this._coachDb) return;

    const selectedScope = this._scopeFromParts(selectedPlan.scope_type, selectedPlan.scope_key, selectedPlan.scope_name);
    const allScopes = this._scopesForPlan(selectedPlan);
    const selectedStats = allScopes.length > 1
      ? this._computeAggregateStats(allScopes, now)
      : this._computeStats(selectedScope, now);
    const daysLeft = daysLeftToExam(selectedPlan.exam_date_utc, now);
    const dayUtc = startOfDayUtc(now);
    const progress = this._coachDb.getProgress(dayUtc, selectedPlan.scope_type, selectedPlan.scope_key);
    const dailyFlashTarget = Math.max(0, selectedPlan.daily_flashcard_target);
    const dailyNoteTarget = Math.max(0, selectedPlan.daily_note_target);
    const totalCards = allScopes.length > 1
      ? allScopes.reduce((sum, s) => sum + this._cardsInScope(s).length, 0)
      : this._cardsInScope(selectedScope).length;

    const aggregate: AggregateStats = {
      dueCards: selectedStats.dueCards,
      newCards: selectedStats.newCards,
      dueNotes: selectedStats.dueNotes,
      totalCards: Math.max(1, totalCards),
    };

    // Compute average FSRS retrievability for in-scope cards
    const states = this.plugin.store.data.states || {};
    const schedulingCfg = this.plugin.settings?.scheduling;
    const requestRetention = Math.max(0.8, Math.min(0.97, Number(schedulingCfg?.requestRetention) || 0.9));
    const fsrsParams = generatorParameters({ request_retention: requestRetention });
    const scopeCards = allScopes.length > 1
      ? allScopes.flatMap((s) => this._cardsInScope(s))
      : this._cardsInScope(selectedScope);
    let retSum = 0;
    let retCount = 0;
    for (const sc of scopeCards) {
      const st = states[sc.id];
      if (!st || st.stage === "new" || st.stage === "suspended") continue;
      const stability = Number(st.stabilityDays ?? 0);
      const lastReviewed = Number(st.lastReviewed ?? 0);
      if (stability <= 0 || lastReviewed <= 0) continue;
      const elapsed = Math.max(0, (now - lastReviewed) / MS_DAY);
      retSum += forgetting_curve(fsrsParams.w, elapsed, stability);
      retCount += 1;
    }
    const avgRetention = retCount > 0 ? retSum / retCount : 0;

    // Compute note review coverage + average note retention
    const allNoteIds = allScopes.length > 1
      ? [...new Set(allScopes.flatMap((s) => this._dueNoteIdsInScope(s, now)))]
      : this._dueNoteIdsInScope(selectedScope, now);
    const totalNotes = Math.max(1, allNoteIds.length + (this._notesDb ? 0 : 0));
    // Notes that have been reviewed today count as reviewed
    const reviewedNoteCount = progress.note;
    const avgNoteRetention = reviewedNoteCount > 0 ? requestRetention : 0;

    const health = this._computeHealth(
      aggregate,
      daysLeft,
      dailyFlashTarget,
      dailyNoteTarget,
      avgRetention,
      totalNotes,
      reviewedNoteCount,
      avgNoteRetention,
    );

    try {
      this._chartsRoot?.unmount();
    } catch {
      // no-op
    }
    this._chartsRoot = null;

    try {
      this._readinessRoot?.unmount();
    } catch {
      // no-op
    }
    this._readinessRoot = null;

    const topRow = host.createDiv({ cls: "sprout-coach-dashboard-top-row" });
    this._renderScopeCard(topRow, selectedPlan, now);

    const healthHost = topRow.createDiv({ cls: "sprout-coach-health-host" });
    this._mountHealthPanel(healthHost, health);

    const readinessHost = host.createDiv({ cls: "sprout-coach-recharts-host" });
    const { points, todayIndex, startLabel, endLabel, totalDays } = this._buildReadinessTimeline(selectedPlan, selectedScope, now);
    this._mountReadinessChart(readinessHost, points, todayIndex, startLabel, endLabel, totalDays);
  }

  private async _render(): Promise<void> {
    if (!this._coachDb) return;

    const root = this.contentEl;
    this._rootEl = root;

    try {
      this._chartsRoot?.unmount();
    } catch {
      // no-op
    }
    this._chartsRoot = null;

    try {
      this._readinessRoot?.unmount();
    } catch {
      // no-op
    }
    this._readinessRoot = null;

    root.empty();
    root.classList.add("bc", "sprout-view-content", "flex", "flex-col", "lk-home-root");
    this.containerEl.addClass("sprout");

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    root.classList.toggle("sprout-no-animate", !animationsEnabled);
    root.classList.remove("lk-home-root-enter");
    if (animationsEnabled) {
      void root.offsetWidth;
      root.classList.add("lk-home-root-enter");
    }

    this._applyMaxWidth();

    const plans = this._coachDb.listPlans();
    if (!plans.length && !this._wizardVisible) this._wizardVisible = false;

    const titleFrame = createTitleStripFrame({
      root,
      stripClassName: "lk-home-title-strip sprout-coach-title-strip",
      rowClassName: "sprout-inline-sentence w-full flex items-center justify-between gap-[10px]",
      leftClassName: "min-w-0 flex-1 flex flex-col gap-[2px]",
      rightClassName: "flex items-center gap-2",
      prepend: true,
    });
    if (animationsEnabled) {
      titleFrame.strip.setAttribute("data-aos", "fade-up");
      titleFrame.strip.setAttribute("data-aos-anchor-placement", "top-top");
      titleFrame.strip.setAttribute("data-aos-duration", String(AOS_DURATION));
      titleFrame.strip.setAttribute("data-aos-delay", "0");
    }
    titleFrame.title.classList.add("text-xl", "font-semibold", "tracking-tight");
    titleFrame.title.textContent = "Coach";
    titleFrame.subtitle.classList.add("text-[0.95rem]", "font-normal", "leading-[1.3]", "text-muted-foreground");
    titleFrame.subtitle.textContent = "Build and manage focused study plans.";

    const shell = root.createDiv({ cls: "sprout-view-content-shell lk-home-content-shell flex flex-col gap-4 sprout-coach-shell" });

    if (animationsEnabled) {
      shell.setAttribute("data-aos", "fade-up");
      shell.setAttribute("data-aos-anchor-placement", "top-top");
      shell.setAttribute("data-aos-delay", "100");
    }

    const scopeOptions = this._scopeOptions();

    if (this._wizardVisible) {
      this._renderWizard(shell, scopeOptions, plans.length > 0);
    } else {
      await this._renderDashboard(shell, plans);
    }

    this._wizardSlide = null;

    if (animationsEnabled) {
      const maxDelay = cascadeAOSOnLoad(root, {
        stepMs: 0,
        baseDelayMs: 0,
        durationMs: AOS_DURATION,
        overwriteDelays: false,
      });
      const fallbackAfterMs = Math.max(600, Math.floor(maxDelay + AOS_DURATION + 250));
      setTimeout(() => {
        const aosElements = root.querySelectorAll("[data-aos]");
        aosElements.forEach((el) => {
          if (!el.isConnected) return;
          const style = getComputedStyle(el);
          if (style.opacity === "0" || style.visibility === "hidden") {
            el.classList.add("sprout-aos-fallback");
          }
        });
      }, fallbackAfterMs);
    } else {
      const aosElements = root.querySelectorAll("[data-aos]");
      aosElements.forEach((el) => {
        el.classList.add("sprout-aos-fallback");
      });
    }
  }
}
