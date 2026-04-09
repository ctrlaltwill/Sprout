/**
 * @file src/views/exam-generator/exam-generator-view.ts
 * @summary Module for exam generator view.
 *
 * @exports
 *  - SproutExamGeneratorView
 */

import { ItemView, Notice, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import { createViewHeader, type SproutHeader } from "../../platform/core/header";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_EXAM_GENERATOR } from "../../platform/core/constants";
import { renderMarkdownPreviewInElement, setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { ExamTestsSqlite, type SavedExamTestSummary } from "../../platform/core/exam-tests-sqlite";
import { CoachPlanSqlite } from "../../platform/core/coach-plan-sqlite";
import { initAOS } from "../../platform/core/aos-loader";
import type LearnKitPlugin from "../../main";
import { t } from "../../platform/translations/translator";
import type { Scope } from "../reviewer/types";
import {
  generateExamQuestions,
  gradeSaqAnswer,
  suggestTestName,
} from "../../platform/integrations/ai/exam-generator-ai";
import type {
  ExamDifficulty,
  ExamGeneratorConfig,
  ExamQuestionMode,
  GeneratedExamQuestion,
  SaqGradeResult,
} from "./exam-generator-types";
import type { AttachedFile } from "../../platform/integrations/ai/attachment-helpers";
import {
  isSupportedAttachmentExt,
  MAX_ATTACHMENTS,
  readVaultFileAsAttachment,
  readFileInputAsAttachment,
  SUPPORTED_FILE_ACCEPT,
} from "../../platform/integrations/ai/attachment-helpers";
import { resolveImageFile } from "../../platform/image-occlusion/io-helpers";
import { getLinkedContextLimits } from "../../platform/integrations/ai/study-assistant-types";
import { mountSearchPopoverList, type SearchPopoverOption } from "../shared/search-popover-list";
import { collectVaultTagAndPropertyPairs, decodePropertyPair, extractFilePropertyPairs, extractFileTags } from "../shared/scope-metadata";
import { formatAttachmentChipLabel } from "../shared/attachment-chip-label";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import {
  rowToSavedScopePreset,
  selectionMatchesPreset,
  serializeScopes,
  toScopeId,
} from "../shared/saved-scope-presets";

type ExamViewMode = "setup" | "generating" | "taking" | "grading" | "results" | "review";

type SetupStage = "source" | "config";

type StoredAnswer = string | number | number[];

type QuestionResult = {
  questionId: string;
  prompt: string;
  questionType: "mcq" | "saq";
  scorePercent: number;
  feedback: string;
  correct?: boolean;
  userAnswer?: string;
  expectedAnswer?: string;
  saq?: SaqGradeResult;
};

const MAX_SELECTABLE_NOTES = 5;
const DEFAULT_MAX_FOLDER_NOTES = 20;

export class SproutExamGeneratorView extends ItemView {
  plugin: LearnKitPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  private _shellEl: HTMLElement | null = null;
  private _aosInitialized = false;
  private _titleStripAnimatedOnce = false;
  private _suppressEntranceAosOnce = false;
  private _testsDb: ExamTestsSqlite | null = null;
  private _coachDb: CoachPlanSqlite | null = null;
  private _savedTests: SavedExamTestSummary[] = [];
  private _activeTestId: string | null = null;
  private _savedTestsPopoverOpen = false;
  private _savedTestsSearchQuery = "";
  private _savedTestsPopoverCleanup: (() => void) | null = null;

  private _mode: ExamViewMode = "setup";
  private _setupStage: SetupStage = "source";
  private _wizardSlide: "next" | "back" | null = null;
  private _notes: TFile[] = [];
  private _folders: string[] = [];
  private _selectedPaths = new Set<string>();
  private _selectedFolders = new Set<string>();
  private _selectedVault = false;
  private _selectedTags = new Set<string>();
  private _selectedProperties = new Set<string>();
  private _noteSearchQuery = "";
  private _folderPreviewExpanded = false;
  private _coachScopePrefilled = false;

  private _config: ExamGeneratorConfig = {
    difficulty: "medium",
    questionMode: "mixed",
    questionCount: 5,
    testName: "",
    appliedScenarios: false,
    timed: false,
    durationMinutes: 20,
    customInstructions: "",
    includeFlashcards: false,
    sourceMode: "selected",
    folderPath: "",
    includeSubfolders: true,
    maxFolderNotes: DEFAULT_MAX_FOLDER_NOTES,
  };

  private _questions: GeneratedExamQuestion[] = [];
  private _answers = new Map<string, StoredAnswer>();
  private _questionResults: QuestionResult[] = [];
  private _currentIndex = 0;

  private _examStartMs = 0;
  private _timerInterval: number | null = null;
  private _timerTextEl: HTMLElement | null = null;
  private _titleTimerEl: HTMLElement | null = null;
  private _untimedPaused = false;
  private _elapsedSec = 0;
  private _submitted = false;
  private _autoSubmitted = false;

  private _autoSubmitGrace: number | null = null;
  private _autoSubmitGraceInterval: number | null = null;
  private _autoSubmitWarningCountdownEl: HTMLElement | null = null;
  private _loadingWordInterval: number | null = null;
  private _loadingWordSwapTimeout: number | null = null;

  private _finalPercent: number | null = null;
  private _reviewWrongOnly = true;

  private _attachedFiles: AttachedFile[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_EXAM_GENERATOR;
  }

  getDisplayText(): string {
    return "Tests";
  }

  getIcon(): string {
    return "clipboard-check";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.containerEl.addClass("learnkit");

    this._rootEl = this.contentEl;
    this._rootEl.classList.add("learnkit-view-content", "learnkit-view-content", "learnkit-exam-generator-root", "learnkit-exam-generator-root");

    this._header = createViewHeader({
      view: this,
      plugin: this.plugin,
      onToggleWide: () => this._applyMaxWidth(),
    });
    this._header.install("exam");
    this._testsDb = new ExamTestsSqlite(this.plugin);
    await this._testsDb.open();
    this._coachDb = new CoachPlanSqlite(this.plugin);
    await this._coachDb.open();
    this._savedTests = this._testsDb.listTests(25);

    this._reloadNotes();
    this._applyMaxWidth();
    this._render();
  }

  async onClose(): Promise<void> {
    this._stopTimer();
    this._stopLoadingWordAnimation();
    this._clearAutoSubmitGrace();
    this._savedTestsPopoverCleanup?.();
    this._savedTestsPopoverCleanup = null;
    if (this._testsDb) {
      await this._testsDb.close();
      this._testsDb = null;
    }
    if (this._coachDb) {
      await this._coachDb.close();
      this._coachDb = null;
    }
    this._header?.dispose();
    this._header = null;
    this._rootEl = null;
    this._shellEl = null;
    this._aosInitialized = false;
    this._titleStripAnimatedOnce = false;
  }

  onRefresh(): void {
    this._reloadNotes();
    this._savedTests = this._testsDb?.listTests(25) ?? [];
    this._render();
  }

  setSuppressEntranceAosOnce(enabled: boolean): void {
    this._suppressEntranceAosOnce = !!enabled;
  }

  setCoachScope(scope: Scope | null): void {
    if (!scope) return;
    this._applyCoachScopes([scope]);
  }

  setCoachScopes(scopes: Scope[] | null): void {
    const normalized = Array.isArray(scopes)
      ? scopes.filter((scope): scope is Scope => !!scope)
      : [];
    if (!normalized.length) return;
    this._applyCoachScopes(normalized);
  }

  loadSavedTestById(testId: string): void {
    this._savedTests = this._testsDb?.listTests(25) ?? [];
    this._loadSavedTest(testId);
  }

  private _tx(token: string, fallback: string): string {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);
  }

  private _applyMaxWidth(): void {
    if (!this._rootEl) return;
    const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
    setCssProps(this._rootEl, "--lk-home-max-width", maxWidth);
    setCssProps(this._rootEl, "--learnkit-exam-generator-max-width", maxWidth);
  }

  private _applyCoachScope(scope: Scope): void {
    this._applyCoachScopes([scope]);
  }

  private _applyCoachScopes(scopes: Scope[]): void {
    const normalized = scopes.filter((scope): scope is Scope => !!scope);
    if (!normalized.length) return;

    this._reloadNotes();

    this._mode = "setup";
    this._setupStage = "source";
    this._wizardSlide = null;
    this._noteSearchQuery = "";
    this._folderPreviewExpanded = false;
    this._selectedPaths.clear();
    this._selectedFolders.clear();
    this._selectedVault = false;
    this._selectedTags.clear();
    this._selectedProperties.clear();
    this._coachScopePrefilled = true;

    this._config.sourceMode = "selected";
    this._applySavedScopes(normalized);

    const groupScopes = normalized.filter((scope) => scope.type === "group");
    if (groupScopes.length > 0) {
      const groupPaths = new Set<string>();
      for (const scope of groupScopes) {
        for (const card of this.plugin.store.getAllCards()) {
          const groups = Array.isArray(card.groups) ? card.groups : [];
          if (!groups.some((g) => String(g || "") === scope.key)) continue;
          const path = String(card.sourceNotePath || "").trim();
          if (path) groupPaths.add(path);
        }
      }

      const selected = Array.from(groupPaths)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_SELECTABLE_NOTES);

      for (const path of selected) {
        this._selectedPaths.add(path);
      }

      if (groupPaths.size > MAX_SELECTABLE_NOTES) {
        new Notice(`Selected first ${MAX_SELECTABLE_NOTES} notes for this group. Refine in Source if needed.`);
      }
    }

    this._config.sourceMode = "selected";
    this._render();
  }

  private _reloadNotes(): void {
    const files = this.app.vault.getMarkdownFiles();
    this._notes = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const folderSet = new Set<string>();
    for (const file of this._notes) {
      const slash = file.path.lastIndexOf("/");
      const folder = slash >= 0 ? file.path.slice(0, slash) : "";
      folderSet.add(folder);
    }
    this._folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b));
    if (!this._folders.includes(this._config.folderPath)) {
      this._config.folderPath = this._folders[0] || "";
    }

    const nextSelected = new Set<string>();
    for (const path of this._selectedPaths) {
      if (this._notes.some((file) => file.path === path)) nextSelected.add(path);
    }
    this._selectedPaths = nextSelected;

    const nextSelectedFolders = new Set<string>();
    for (const folder of this._selectedFolders) {
      if (!folder || this._folders.includes(folder)) nextSelectedFolders.add(folder);
    }
    this._selectedFolders = nextSelectedFolders;

    const metadata = collectVaultTagAndPropertyPairs(this.app, this._notes);
    const availableTags = new Set(metadata.tags.map((tag) => tag.token));
    const availableProps = new Set(metadata.properties.map((pair) => `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`));

    const nextTags = new Set<string>();
    for (const token of this._selectedTags) {
      if (availableTags.has(token)) nextTags.add(token);
    }
    this._selectedTags = nextTags;

    const nextProps = new Set<string>();
    for (const encoded of this._selectedProperties) {
      if (availableProps.has(encoded)) nextProps.add(encoded);
    }
    this._selectedProperties = nextProps;
  }

  private _getFolderCandidates(): TFile[] {
    const folder = this._config.folderPath;
    return this._notes.filter((n) => {
      if (!folder) return true;
      if (this._config.includeSubfolders) return n.path.startsWith(`${folder}/`);
      const slash = n.path.lastIndexOf("/");
      const noteFolder = slash >= 0 ? n.path.slice(0, slash) : "";
      return noteFolder === folder;
    });
  }

  private _searchRank(note: TFile, query: string): number {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const base = note.basename.toLowerCase();
    const path = note.path.toLowerCase();
    if (base.startsWith(q)) return 400;
    if (base.includes(q)) return 280;
    if (path.startsWith(q)) return 180;
    if (path.includes(q)) return 120;
    return 0;
  }

  private _folderSearchRank(folder: string, query: string): number {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const label = this._formatFolderLabel(folder).toLowerCase();
    const path = folder.toLowerCase();
    if (label.startsWith(q)) return 380;
    if (label.includes(q)) return 260;
    if (path.startsWith(q)) return 180;
    if (path.includes(q)) return 120;
    if (folder === "" && "home".startsWith(q)) return 160;
    return 0;
  }

  private _folderIncludesPath(folder: string, path: string): boolean {
    if (!folder) return true;
    return path.startsWith(`${folder}/`);
  }

  private _selectedModeCandidates(): TFile[] {
    if (this._selectedVault) {
      return [...this._notes].sort((a, b) => a.path.localeCompare(b.path));
    }

    const byPath = new Map<string, TFile>();
    for (const note of this._notes) {
      if (this._selectedPaths.has(note.path)) byPath.set(note.path, note);
    }
    for (const folder of this._selectedFolders) {
      for (const note of this._notes) {
        if (this._folderIncludesPath(folder, note.path)) byPath.set(note.path, note);
      }
    }

    if (this._selectedTags.size > 0 || this._selectedProperties.size > 0) {
      for (const note of this._notes) {
        const tags = extractFileTags(this.app, note);
        const propPairs = extractFilePropertyPairs(this.app, note);
        const propSet = new Set(propPairs.map((pair) => `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`));

        const tagMatch = this._selectedTags.size > 0
          ? Array.from(this._selectedTags).some((tag) => tags.has(tag))
          : false;

        const propMatch = this._selectedProperties.size > 0
          ? Array.from(this._selectedProperties).some((pair) => propSet.has(pair))
          : false;

        if (tagMatch || propMatch) byPath.set(note.path, note);
      }
    }
    return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  private _selectedScopesForPresets(): Scope[] {
    const scopes: Scope[] = [];
    if (this._selectedVault) {
      scopes.push({ type: "vault", key: "", name: this.app.vault.getName() || "Vault" });
    }

    const folderScopes = Array.from(this._selectedFolders)
      .map((folder) => String(folder || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((folder) => ({ type: "folder" as const, key: folder, name: folder }));
    scopes.push(...folderScopes);

    const noteScopes = this._notes
      .filter((note) => this._selectedPaths.has(note.path))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((note) => ({ type: "note" as const, key: note.path, name: note.basename }));
    scopes.push(...noteScopes);

    const metadata = collectVaultTagAndPropertyPairs(this.app, this._notes);
    const tagScopes = metadata.tags
      .filter((tag) => this._selectedTags.has(tag.token))
      .sort((a, b) => a.token.localeCompare(b.token))
      .map((tag) => ({ type: "tag" as const, key: tag.token, name: `#${tag.token}` }));
    scopes.push(...tagScopes);

    const propertyScopes = metadata.properties
      .filter((pair) => this._selectedProperties.has(`${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`))
      .sort((a, b) => `${a.key}::${a.value}`.localeCompare(`${b.key}::${b.value}`))
      .map((pair) => ({
        type: "property" as const,
        key: `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`,
        name: `${pair.displayKey}: ${pair.displayValue}`,
      }));
    scopes.push(...propertyScopes);
    return scopes;
  }

  private _applySavedScopes(scopes: Scope[]): void {
    this._selectedVault = false;
    this._selectedPaths.clear();
    this._selectedFolders.clear();
    this._selectedTags.clear();
    this._selectedProperties.clear();

    const notePathSet = new Set(this._notes.map((note) => note.path));
    const folderSet = new Set(this._folders);
    const metadata = collectVaultTagAndPropertyPairs(this.app, this._notes);
    const tagSet = new Set(metadata.tags.map((tag) => tag.token));
    const propertySet = new Set(metadata.properties.map((pair) => `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`));

    for (const scope of scopes) {
      if (scope.type === "vault") {
        this._selectedVault = true;
        continue;
      }
      if (scope.type === "folder") {
        if (folderSet.has(scope.key)) this._selectedFolders.add(scope.key);
        continue;
      }
      if (scope.type === "note") {
        if (notePathSet.has(scope.key)) this._selectedPaths.add(scope.key);
        continue;
      }
      if (scope.type === "tag") {
        if (tagSet.has(scope.key)) this._selectedTags.add(scope.key);
        continue;
      }
      if (scope.type === "property") {
        if (propertySet.has(scope.key)) this._selectedProperties.add(scope.key);
      }
    }
  }

  private _noteFolderPath(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash >= 0 ? path.slice(0, slash) : "";
  }

  private _formatFolderLabel(path: string): string {
    return path.trim() || "Home";
  }

  private _formatFolderChipLabel(path: string): string {
    const normalized = path.trim();
    if (!normalized) return "Home";
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || normalized;
  }

  private _previewFolderSelection(candidates: TFile[]): TFile[] {
    const educationalTokens = [
      "study",
      "medicine",
      "psychiatry",
      "clinical",
      "theory",
      "treatment",
      "disorder",
      "exam",
      "history",
      "diagnosis",
    ];
    const score = (file: TFile) => {
      const base = file.basename.toLowerCase();
      const path = file.path.toLowerCase();
      let s = 0;
      for (const token of educationalTokens) {
        if (base.includes(token)) s += 18;
        if (path.includes(token)) s += 8;
      }
      if (base.length >= 6 && base.length <= 60) s += 6;
      if (/\b(index|toc|contents|navigation|system|template|attachment)\b/i.test(base)) s -= 28;
      return s;
    };

    return [...candidates]
      .sort((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.path.localeCompare(b.path);
      })
      .slice(0, this._config.maxFolderNotes);
  }

  private _educationalDensityScore(content: string, path: string): number {
    const text = String(content || "");
    const lines = text.split(/\r?\n/);
    let headings = 0;
    let educationalHits = 0;
    let tocLike = 0;
    let wordCount = 0;
    let sentences = 0;

    const educationalKeywords = [
      "definition",
      "mechanism",
      "symptom",
      "diagnosis",
      "management",
      "treatment",
      "cause",
      "risk",
      "presentation",
      "clinical",
      "example",
      "pathophysiology",
      "therapy",
      "investigation",
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^#{1,4}\s+/.test(trimmed)) headings += 1;
      if (/^(?:[-*+]|\d+\.)\s+/.test(trimmed) && (/\.md$/.test(trimmed) || trimmed.includes("/"))) tocLike += 1;
      const low = trimmed.toLowerCase();
      for (const kw of educationalKeywords) {
        if (low.includes(kw)) educationalHits += 1;
      }
      const words = trimmed.split(/\s+/).filter(Boolean);
      wordCount += words.length;
      sentences += Math.max(1, trimmed.split(/[.!?]+/).filter(Boolean).length);
    }

    const avgSentenceWords = sentences > 0 ? wordCount / sentences : 0;
    const pathPenalty = /\b(system|template|attachment|toc|index|navigation)\b/i.test(path) ? 35 : 0;

    return (
      headings * 4
      + educationalHits * 3
      + Math.min(40, wordCount / 80)
      + Math.min(18, avgSentenceWords)
      - tocLike * 6
      - pathPenalty
    );
  }

  private _rankNotesByEducationalDensity(
    notes: Array<{ path: string; title: string; content: string }>,
  ): Array<{ path: string; title: string; content: string }> {
    return [...notes].sort((a, b) => {
      const diff = this._educationalDensityScore(b.content, b.path) - this._educationalDensityScore(a.content, a.path);
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    });
  }

  private _render(): void {
    if (!this._rootEl) return;
    this._stopLoadingWordAnimation();
    this._timerTextEl = null;
    this._titleTimerEl = null;
    this._autoSubmitWarningCountdownEl = null;
    this._savedTestsPopoverCleanup?.();
    this._savedTestsPopoverCleanup = null;

    if (!this._shellEl) {
      this._rootEl.empty();
      this._shellEl = this._rootEl.createDiv({ cls: "learnkit-view-content-shell learnkit-view-content-shell learnkit-exam-generator-content-shell learnkit-exam-generator-content-shell" });
    }

    const shell = this._shellEl;
    this._rootEl.querySelector(":scope > .lk-home-title-strip")?.remove();
    shell.empty();

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    const suppressEntranceAos = this._suppressEntranceAosOnce;
    this._suppressEntranceAosOnce = false;
    const coachShellMode = this._coachScopePrefilled;

    const titleFrame = createTitleStripFrame({
      root: this._rootEl,
      stripClassName: "lk-home-title-strip learnkit-exam-generator-title-strip",
      rowClassName: "sprout-inline-sentence w-full flex items-center justify-between gap-[10px]",
      leftClassName: "min-w-0 flex-1 flex flex-col gap-[2px]",
      rightClassName: "flex items-center gap-2",
      prepend: true,
    });

    const animateTitleStripNow =
      animationsEnabled && !this._titleStripAnimatedOnce && this._mode === "setup" && !coachShellMode && !suppressEntranceAos;
    if (animateTitleStripNow) {
      titleFrame.strip.setAttribute("data-aos", "fade-up");
      titleFrame.strip.setAttribute("data-aos-anchor-placement", "top-top");
      titleFrame.strip.setAttribute("data-aos-duration", String(AOS_DURATION));
      titleFrame.strip.setAttribute("data-aos-delay", "0");
    }
    titleFrame.title.classList.add("text-xl", "font-semibold", "tracking-tight");
    titleFrame.title.textContent = coachShellMode ? "Coach" : "Tests";
    titleFrame.subtitle.classList.add("flex", "items-center", "gap-1", "min-w-0");
    titleFrame.subtitle.textContent = coachShellMode
      ? "Build and manage focused study plans."
      : this._tx(
        "ui.view.examGenerator.subtitle",
        "Turn notes and media into focused practice tests.",
      );

    const savedTestsWrap = document.createElement("div");
    savedTestsWrap.className = "learnkit-exam-generator-saved-tests-wrap";

    const savedTestsBtn = document.createElement("button");
    savedTestsBtn.className = "learnkit-btn-accent inline-flex items-center gap-2 learnkit-exam-generator-saved-tests-btn";
    savedTestsBtn.type = "button";
    savedTestsBtn.setAttribute("aria-label", "Saved tests");
    savedTestsBtn.createSpan({ text: "Saved tests" });
    const chevronWrap = savedTestsBtn.createSpan({
      cls: "learnkit-exam-generator-saved-tests-chevron learnkit-exam-generator-saved-tests-chevron inline-flex items-center justify-center [&_svg]:size-3.5",
    });
    setIcon(chevronWrap, "chevron-down");

    const savedTestsPanel = savedTestsWrap.createDiv({
      cls: "learnkit-popover-dropdown learnkit-popover-dropdown learnkit-popover-dropdown-below learnkit-popover-dropdown-below learnkit-exam-generator-saved-tests-popover learnkit-exam-generator-saved-tests-popover",
    });
    const panel = savedTestsPanel.createDiv({ cls: "rounded-md border border-border bg-popover text-popover-foreground p-1 flex flex-col learnkit-pointer-auto learnkit-pointer-auto learnkit-exam-generator-saved-tests-panel learnkit-exam-generator-saved-tests-panel" });
    const searchWrap = panel.createDiv({ cls: "learnkit-ss-search-wrap learnkit-ss-search-wrap learnkit-scope-preset-create learnkit-scope-preset-create learnkit-exam-generator-saved-tests-search-wrap learnkit-exam-generator-saved-tests-search-wrap" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "learnkit-ss-search-input learnkit-ss-search-input learnkit-exam-generator-saved-tests-search learnkit-exam-generator-saved-tests-search",
      attr: { placeholder: "Search saved tests", autocomplete: "off", spellcheck: "false" },
    });
    const savedSearchIcon = searchWrap.createSpan({ cls: "learnkit-exam-generator-saved-tests-search-icon-right learnkit-exam-generator-saved-tests-search-icon-right" });
    setIcon(savedSearchIcon, "search");
    searchInput.value = this._savedTestsSearchQuery;
    panel.createDiv({ cls: "my-1 h-px bg-border learnkit-exam-generator-saved-tests-divider learnkit-exam-generator-saved-tests-divider" });
    const savedTestsSubtitle = panel.createDiv({
      cls: "px-2 py-1.5 text-sm text-muted-foreground learnkit-exam-generator-popover-subtitle learnkit-exam-generator-popover-subtitle",
      text: "Saved tests",
    });
    savedTestsSubtitle.setAttr("role", "presentation");
    const savedList = panel.createDiv({ cls: "learnkit-ss-listbox learnkit-ss-listbox flex flex-col max-h-60 overflow-auto learnkit-exam-generator-saved-tests-list learnkit-exam-generator-saved-tests-list" });
    savedList.setAttr("role", "listbox");
    let savedTestsPanelLockedWidthPx: number | null = null;

    savedTestsBtn.setAttribute("aria-haspopup", "dialog");
    savedTestsBtn.setAttribute("aria-expanded", this._savedTestsPopoverOpen ? "true" : "false");

    const formatSavedDate = (timestamp: number): string => {
      const d = new Date(timestamp);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = String(d.getFullYear());
      return `${day}/${month}/${year}`;
    };

    const formatSavedDifficulty = (test: SavedExamTestSummary): string => {
      const raw = (test.difficulty || "").trim().toLowerCase();
      if (raw === "easy" || raw === "medium" || raw === "hard") {
        return raw.charAt(0).toUpperCase() + raw.slice(1);
      }
      const label = (test.label || "").toLowerCase();
      if (label.includes("easy")) return "Easy";
      if (label.includes("hard")) return "Hard";
      if (label.includes("medium")) return "Medium";
      return "Medium";
    };

    const formatSavedName = (test: SavedExamTestSummary): string => {
      const raw = (test.label || "Untitled test").trim();
      const withoutDateTime = raw.replace(/\s+-\s+\d{1,2}\/\d{1,2}\/\d{4},\s*\d{2}:\d{2}:\d{2}\s*$/u, "").trim();
      return withoutDateTime || "Untitled test";
    };

    const formatSavedTestLine = (test: SavedExamTestSummary): string => {
      const name = formatSavedName(test);
      const createdAt = formatSavedDate(test.createdAt);
      const count = Math.max(0, Number(test.questionCount || 0));
      const questions = `${count} question${count === 1 ? "" : "s"}`;
      return `${name} • ${createdAt} • ${questions}`;
    };

    const applySavedTestsPanelWidth = () => {
      if (savedTestsPanelLockedWidthPx != null && this._savedTestsPopoverOpen) {
        const lockedPx = `${savedTestsPanelLockedWidthPx}px`;
        panel.style.width = lockedPx;
        panel.style.minWidth = lockedPx;
        savedTestsPanel.style.width = lockedPx;
        savedTestsPanel.style.minWidth = lockedPx;
        return;
      }

      if (!this._savedTests.length) {
        const buttonWidth = Math.ceil(savedTestsBtn.getBoundingClientRect().width);
        const compactPx = `${Math.max(200, buttonWidth)}px`;
        panel.style.width = compactPx;
        panel.style.minWidth = compactPx;
        savedTestsPanel.style.width = compactPx;
        savedTestsPanel.style.minWidth = compactPx;
        return;
      }

      const probe = panel.createSpan({
        cls: "learnkit-coach-scope-item-label learnkit-coach-scope-item-label learnkit-exam-generator-width-probe learnkit-exam-generator-width-probe",
      });
      const lines = this._savedTests.map((test) => formatSavedTestLine(test));
      lines.push("Search saved tests");
      let widestLabelPx = 0;
      for (const line of lines) {
        probe.textContent = line;
        const width = Math.ceil(probe.getBoundingClientRect().width);
        if (width > widestLabelPx) widestLabelPx = width;
      }
      probe.remove();

      // Label width + left icon/gaps/paddings + right delete affordance.
      const targetPx = widestLabelPx + 92;
      const clampedPx = Math.max(220, Math.min(400, targetPx));
      const widthPx = `${clampedPx}px`;
      panel.style.width = widthPx;
      panel.style.minWidth = widthPx;
      savedTestsPanel.style.width = widthPx;
      savedTestsPanel.style.minWidth = widthPx;
    };

    const filteredSavedTests = () => {
      const q = this._savedTestsSearchQuery.trim().toLowerCase();
      if (!q) return this._savedTests;
      return this._savedTests.filter((test) => {
        const name = formatSavedName(test).toLowerCase();
        const createdAt = formatSavedDate(test.createdAt).toLowerCase();
        const difficulty = formatSavedDifficulty(test).toLowerCase();
        const questionCount = String(test.questionCount || "");
        return name.includes(q) || createdAt.includes(q) || difficulty.includes(q) || questionCount.includes(q);
      });
    };

    const renderSavedTestsList = () => {
      applySavedTestsPanelWidth();
      const hasSavedTests = this._savedTests.length > 0;
      searchWrap.classList.toggle("hidden", !hasSavedTests);
      savedTestsSubtitle.classList.toggle("hidden", !hasSavedTests);
      panel.querySelector(".learnkit-exam-generator-saved-tests-divider")?.classList.toggle("hidden", !hasSavedTests);
      savedList.classList.toggle("learnkit-ss-listbox", hasSavedTests);
      savedList.empty();
      const results = filteredSavedTests();
      if (results.length === 0) {
        const emptyMsg = savedList.createDiv({ cls: "learnkit-exam-generator-saved-tests-empty-message learnkit-exam-generator-saved-tests-empty-message learnkit-settings-text-muted learnkit-settings-text-muted" });
        if (this._savedTests.length === 0) {
          emptyMsg.createDiv({ cls: "learnkit-exam-generator-saved-tests-empty-title learnkit-exam-generator-saved-tests-empty-title", text: "No saved tests yet." });
          emptyMsg.createDiv({ cls: "learnkit-exam-generator-saved-tests-empty-body learnkit-exam-generator-saved-tests-empty-body", text: "Generate a test and it will be saved here automatically." });
        } else {
          emptyMsg.createDiv({ cls: "learnkit-exam-generator-saved-tests-empty-body learnkit-exam-generator-saved-tests-empty-body", text: "No saved tests match your search." });
        }
        return;
      }
      for (const test of results) {
        const row = savedList.createDiv({ cls: "learnkit-coach-scope-row learnkit-coach-scope-row learnkit-exam-generator-saved-tests-item learnkit-exam-generator-saved-tests-item" });
        row.setAttr("role", "option");
        const lineBtn = row.createEl("button", {
          cls: "learnkit-scope-preset-apply learnkit-scope-preset-apply learnkit-exam-generator-saved-tests-line learnkit-exam-generator-saved-tests-line",
          attr: { type: "button" },
        });
        const lineIcon = lineBtn.createSpan({ cls: "learnkit-exam-generator-saved-tests-line-icon learnkit-exam-generator-saved-tests-line-icon" });
        setIcon(lineIcon, "file-question-mark");
        const lineText = formatSavedTestLine(test);
        const textWrap = lineBtn.createSpan({ cls: "learnkit-scope-preset-item-text learnkit-scope-preset-item-text learnkit-exam-generator-saved-tests-line-text learnkit-exam-generator-saved-tests-line-text" });
        textWrap.createSpan({ cls: "learnkit-coach-scope-item-label learnkit-coach-scope-item-label", text: lineText });
        lineBtn.setAttribute("aria-label", lineText);
        lineBtn.addEventListener("click", () => {
          this._savedTestsPopoverOpen = false;
          this._savedTestsSearchQuery = "";
          this._loadSavedTest(test.testId);
        });

        const deleteBtn = row.createSpan({
          cls: "learnkit-scope-preset-remove learnkit-scope-preset-remove learnkit-exam-generator-saved-tests-delete learnkit-exam-generator-saved-tests-delete",
        });
        deleteBtn.setAttribute("aria-label", `Delete ${test.label || "saved test"}`);
        deleteBtn.setAttribute("role", "button");
        deleteBtn.setAttribute("tabindex", "0");
        deleteBtn.setAttribute("data-tooltip-position", "top");
        setIcon(deleteBtn, "x");
        const runDelete = async () => {
          if (deleteBtn.getAttribute("aria-disabled") === "true") return;
          deleteBtn.setAttribute("aria-disabled", "true");
          deleteBtn.addClass("is-busy");
          const deleted = await this._deleteSavedTest(test.testId);
          if (!deleted) {
            deleteBtn.removeAttribute("aria-disabled");
            deleteBtn.removeClass("is-busy");
            return;
          }
          renderSavedTestsList();
        };
        deleteBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void runDelete();
        });
        deleteBtn.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          ev.stopPropagation();
          void runDelete();
        });
      }
    };

    const syncSavedPopoverState = () => {
      savedTestsPanel.toggleClass("is-open", this._savedTestsPopoverOpen);
      savedTestsPanel.setAttr("aria-hidden", this._savedTestsPopoverOpen ? "false" : "true");
      savedTestsBtn.setAttribute("aria-expanded", this._savedTestsPopoverOpen ? "true" : "false");
      chevronWrap.classList.toggle("is-open", this._savedTestsPopoverOpen);

      if (this._savedTestsPopoverOpen) {
        // Lock width while the popover stays open so deletes don't cause jumps.
        if (savedTestsPanelLockedWidthPx == null) {
          applySavedTestsPanelWidth();
          savedTestsPanelLockedWidthPx = Math.max(200, Math.ceil(panel.getBoundingClientRect().width));
        }
      } else {
        savedTestsPanelLockedWidthPx = null;
      }

      renderSavedTestsList();
    };

    savedTestsBtn.addEventListener("click", () => {
      this._savedTestsPopoverOpen = !this._savedTestsPopoverOpen;
      syncSavedPopoverState();
      if (this._savedTestsPopoverOpen && !searchWrap.classList.contains("hidden")) searchInput.focus();
    });
    searchInput.addEventListener("input", () => {
      this._savedTestsSearchQuery = searchInput.value;
      renderSavedTestsList();
    });
    searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this._savedTestsPopoverOpen = false;
        syncSavedPopoverState();
      }
    });

    const onDocPointerDown = (ev: Event) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (!savedTestsWrap.contains(target)) {
        this._savedTestsPopoverOpen = false;
        syncSavedPopoverState();
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    this._savedTestsPopoverCleanup = () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };

    savedTestsWrap.appendChild(savedTestsBtn);
    syncSavedPopoverState();

    if (this._mode === "taking") {
      this._renderTitleTimer(titleFrame.right);
      this._savedTestsPopoverOpen = false;
      savedTestsWrap.classList.add("hidden");
    } else if (coachShellMode) {
      this._savedTestsPopoverOpen = false;
      savedTestsWrap.classList.add("hidden");
    } else {
      savedTestsWrap.classList.remove("hidden");
    }

    titleFrame.right.appendChild(savedTestsWrap);

    if (animationsEnabled && !coachShellMode && !suppressEntranceAos) {
      shell.setAttribute("data-aos", "fade-up");
      shell.setAttribute("data-aos-anchor-placement", "top-top");
      shell.setAttribute("data-aos-duration", String(AOS_DURATION));
      shell.setAttribute("data-aos-delay", "100");

      if (!this._aosInitialized) {
        try {
          initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
          this._aosInitialized = true;
        } catch {
          // best-effort
        }
      }

      shell.classList.remove("aos-animate");
      window.requestAnimationFrame(() => {
        if (animateTitleStripNow) {
          titleFrame.strip.classList.add("aos-animate");
          this._titleStripAnimatedOnce = true;
        }
        shell.classList.add("aos-animate");
      });
    } else {
      shell.removeAttribute("data-aos");
      shell.removeAttribute("data-aos-anchor-placement");
      shell.removeAttribute("data-aos-duration");
      shell.removeAttribute("data-aos-delay");
      shell.classList.add("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
      this._titleStripAnimatedOnce = true;
    }

    if (this._mode === "setup") {
      this._renderSetup(shell);
      return;
    }

    if (this._mode === "generating") {
      this._renderGenerating(shell);
      return;
    }

    if (this._mode === "taking") {
      this._renderExamRunner(shell);
      return;
    }

    if (this._mode === "grading") {
      this._renderGrading(shell);
      return;
    }

    if (this._mode === "review") {
      this._renderReview(shell);
      return;
    }

    this._renderResults(shell);
  }

  private _renderSetup(host: HTMLElement): void {
    const slide = this._wizardSlide;
    this._wizardSlide = null;

    const card = host.createDiv({ cls: "card learnkit-coach-wizard-card learnkit-coach-wizard-card learnkit-exam-generator-card learnkit-exam-generator-card learnkit-exam-generator-setup-card learnkit-exam-generator-setup-card" });

    const setupTopline = card.createDiv({ cls: "learnkit-exam-generator-setup-topline learnkit-exam-generator-setup-topline" });
    const stepLabels = ["Source", "Settings"];
    const currentStep = this._setupStage === "source" ? 0 : 1;
    const stepper = setupTopline.createDiv({ cls: "learnkit-coach-stepper learnkit-coach-stepper" });
    stepLabels.forEach((label, idx) => {
      const item = stepper.createDiv({ cls: "learnkit-coach-step-item learnkit-coach-step-item" });
      const dot = item.createDiv({ cls: "learnkit-coach-step-dot learnkit-coach-step-dot" });
      if (idx < currentStep) dot.classList.add("is-done");
      else if (idx === currentStep) dot.classList.add("is-active");
      item.createDiv({ cls: "learnkit-coach-step-label learnkit-coach-step-label", text: label });
      if (idx < stepLabels.length - 1) {
        const line = item.createDiv({ cls: "learnkit-coach-step-line learnkit-coach-step-line" });
        if (idx < currentStep) line.classList.add("is-done");
      }
    });

    if (this._coachScopePrefilled) {
      const coachLabel = "Coach";
      const backToCoachLabel = `Back to ${coachLabel}`;
      const setupToplineRight = setupTopline.createDiv({ cls: "learnkit-exam-generator-setup-topline-right learnkit-exam-generator-setup-topline-right" });
      const backToCoachBtn = setupToplineRight.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
        attr: { type: "button", "aria-label": backToCoachLabel, "data-tooltip-position": "top" },
      });
      const iconWrap = backToCoachBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(iconWrap, "x");
      backToCoachBtn.addEventListener("click", () => {
        void this.plugin.openCoachTab(false, { suppressEntranceAos: true, refresh: false }, this.leaf);
      });
    }

    const page = card.createDiv({ cls: "learnkit-coach-wizard-page learnkit-coach-wizard-page" });
    if (slide === "next") page.classList.add("is-enter-next");
    if (slide === "back") page.classList.add("is-enter-back");

    const folderCandidateCount = (): number => this._getFolderCandidates().length;
    const selectedCandidateCount = (): number => this._selectedModeCandidates().length;
    const selectedScopeCount = (): number => selectedCandidateCount();

    const canGenerateNow = (): boolean => {
      if (this._attachedFiles.length > 0) return true;
      if (this._config.sourceMode === "selected") {
          return selectedCandidateCount() > 0;
      }
      return folderCandidateCount() > 0;
    };

    if (this._setupStage === "source") {
      const sourceHeading = this._coachScopePrefilled
        ? "Use or expand your Coach scope"
        : "Choose your source content";
      const sourceCopy = this._coachScopePrefilled
        ? "Your Coach scope is already included for this test. You can keep it as-is, add or remove source content, and attach files to expand the test."
        : "Choose the content for this test, then optionally add files as reference material.";

      page.createEl("h3", { text: sourceHeading });
      page.createEl("p", {
        cls: "learnkit-coach-step-copy learnkit-coach-step-copy",
        text: sourceCopy,
      });

      let nextBtn: HTMLButtonElement | null = null;
      const syncFooter = () => {
        if (nextBtn) nextBtn.disabled = !canGenerateNow();
      };

      if (this._config.sourceMode === "folder") {
        const switchWrap = page.createDiv({ cls: "learnkit-exam-generator-actions learnkit-exam-generator-actions" });
        const useSelectedBtn = switchWrap.createEl("button", {
          cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-9 inline-flex items-center gap-2",
          text: "Switch to note selection",
        });
        useSelectedBtn.type = "button";
        useSelectedBtn.addEventListener("click", () => {
          this._config.sourceMode = "selected";
          this._render();
        });

        const footer = page.createDiv({ cls: "learnkit-coach-wizard-footer learnkit-coach-wizard-footer" });
        nextBtn = footer.createEl("button", {
          cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent h-9 inline-flex items-center gap-2",
        });
        nextBtn.type = "button";
        nextBtn.createSpan({ text: "Next" });
        const nextBtnIcon = nextBtn.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-3.5" });
        setIcon(nextBtnIcon, "arrow-right");
        nextBtn.disabled = !canGenerateNow();
        nextBtn.addEventListener("click", () => {
          this._wizardSlide = "next";
          this._setupStage = "config";
          this._render();
        });
        return;
      }

      page.createDiv({ cls: "learnkit-coach-field-label learnkit-coach-field-label", text: "Content sources" });
      const searchWrap = page.createDiv({ cls: "learnkit-coach-search-wrap learnkit-coach-search-wrap" });
      const searchIcon = searchWrap.createSpan({ cls: "learnkit-coach-search-icon learnkit-coach-search-icon" });
      setIcon(searchIcon, "search");
      const search = searchWrap.createEl("input", {
        cls: "input h-9",
        attr: { type: "search", placeholder: "Search notes, folders, tags, or properties..." },
      });
      search.value = this._noteSearchQuery;
      const popover = searchWrap.createDiv({ cls: "learnkit-coach-scope-popover learnkit-coach-scope-popover dropdown-menu hidden" });
      const scopeList = popover.createDiv({
        cls: "learnkit-coach-scope-list learnkit-coach-scope-list min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto learnkit-header-menu-panel learnkit-header-menu-panel",
      });
      scopeList.setAttr("role", "menu");
      scopeList.setAttr("aria-label", "Source matches");

      const chipsWrap = page.createDiv({ cls: "learnkit-coach-selected-wrap learnkit-coach-selected-wrap" });
      const selectedTitle = chipsWrap.createDiv({ cls: "learnkit-coach-selected-title learnkit-coach-selected-title" });
      const chips = chipsWrap.createDiv({ cls: "learnkit-coach-selected-chips learnkit-coach-selected-chips" });
      const actionsGrid = chipsWrap.createDiv({ cls: "learnkit-coach-scope-actions-grid learnkit-coach-scope-actions-grid" });
      const presetWrap = actionsGrid.createDiv({ cls: "learnkit-coach-scope-action learnkit-coach-scope-action" });
      const presetBtn = presetWrap.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-preset-btn learnkit-scope-preset-btn",
        attr: {
          type: "button",
          "aria-haspopup": "listbox",
          "aria-expanded": "false",
          "aria-label": "Saved presets",
        },
      });
      const presetBtnIcon = presetBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(presetBtnIcon, "bookmark");
      const presetBtnLabel = presetBtn.createSpan({ cls: "", text: "Saved presets" });

      const presetPopover = presetWrap.createDiv({ cls: "learnkit-scope-preset-popover learnkit-scope-preset-popover dropdown-menu hidden" });
      const presetList = presetPopover.createDiv({
        cls: "learnkit-coach-scope-list learnkit-coach-scope-list min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto learnkit-header-menu-panel learnkit-header-menu-panel",
      });
      presetList.setAttr("role", "listbox");
      presetList.setAttr("aria-label", "Saved presets");
      let presetOutsideAttached = false;

      const closePresetPopover = (): void => {
        presetPopover.classList.add("hidden");
        presetBtn.setAttr("aria-expanded", "false");
        if (presetOutsideAttached) {
          document.removeEventListener("pointerdown", handlePresetOutsidePointerDown, true);
          presetOutsideAttached = false;
        }
      };

      const openPresetPopover = (): void => {
        presetPopover.classList.remove("hidden");
        presetBtn.setAttr("aria-expanded", "true");
        if (!presetOutsideAttached) {
          document.addEventListener("pointerdown", handlePresetOutsidePointerDown, true);
          presetOutsideAttached = true;
        }
      };

      const handlePresetOutsidePointerDown = (evt: PointerEvent): void => {
        const target = evt.target;
        if (target instanceof Node && presetWrap.contains(target)) return;
        closePresetPopover();
      };

      const clearWrap = actionsGrid.createDiv({ cls: "learnkit-coach-scope-action learnkit-coach-scope-action hidden" });
      const clearBtn = clearWrap.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
        attr: {
          type: "button",
          "aria-label": "Clear selection",
        },
      });
      const clearBtnIcon = clearBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(clearBtnIcon, "x");
      clearBtn.createSpan({ cls: "", text: "Clear selection" });

      const buildSearchOptions = (): SearchPopoverOption[] => {
        const metadata = collectVaultTagAndPropertyPairs(this.app, this._notes);
        const vaultOption = {
          type: "vault" as const,
          id: "vault::",
          label: `Vault: ${this.app.vault.getName()} (${this._notes.length})`,
          selected: this._selectedVault,
          searchTexts: [this.app.vault.getName(), "vault", "all notes", "all content"],
        } satisfies SearchPopoverOption;

        const folderOptions = this._folders
          .map((folder) => {
            const folderLabel = this._formatFolderLabel(folder);
            const noteCount = this._notes.filter((n) => this._folderIncludesPath(folder, n.path)).length;
            return {
              type: "folder",
              id: `folder::${folder}`,
              label: `Folder: ${folderLabel} (${noteCount})`,
              selected: this._selectedFolders.has(folder),
              searchTexts: [folderLabel, folder],
            } satisfies SearchPopoverOption;
          });

        const noteOptions = this._notes
          .map((note) => ({
            type: "note",
            id: `note::${note.path}`,
            label: `Note: ${note.basename}`,
            selected: this._selectedPaths.has(note.path),
            searchTexts: [note.basename, note.path],
          } satisfies SearchPopoverOption));

        const tagOptions = metadata.tags.map((tag) => ({
          type: "tag",
          id: `tag::${tag.token}`,
          label: `Tag: ${tag.display} (${tag.count})`,
          selected: this._selectedTags.has(tag.token),
          searchTexts: [`#${tag.token}`, `tag:${tag.token}`, tag.display],
        } satisfies SearchPopoverOption));

        const propertyOptions = metadata.properties.map((pair) => ({
          type: "property",
          id: `prop::${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`,
          label: `${pair.displayKey}: ${pair.displayValue} (${pair.count})`,
          selected: this._selectedProperties.has(`${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`),
          propertyKey: pair.displayKey,
          propertyValue: pair.displayValue,
          searchTexts: [
            `${pair.key}:${pair.value}`,
            `${pair.displayKey}:${pair.displayValue}`,
            `prop:${pair.key}=${pair.value}`,
          ],
        } satisfies SearchPopoverOption));

        return [vaultOption, ...folderOptions, ...noteOptions, ...tagOptions, ...propertyOptions];
      };

      const toggleVault = (): void => {
        this._selectedVault = !this._selectedVault;
        renderSelected();
        scopePicker.render();
        syncFooter();
      };

      const toggleNote = (path: string): void => {
        if (this._selectedPaths.has(path)) {
          this._selectedPaths.delete(path);
        } else {
          if (this._selectedPaths.size >= MAX_SELECTABLE_NOTES) {
            new Notice(`You can select up to ${MAX_SELECTABLE_NOTES} notes.`);
            return;
          }
          this._selectedPaths.add(path);
        }
        renderSelected();
        scopePicker.render();
        syncFooter();
      };

      const toggleFolder = (folder: string): void => {
        if (this._selectedFolders.has(folder)) this._selectedFolders.delete(folder);
        else this._selectedFolders.add(folder);
        renderSelected();
        scopePicker.render();
        syncFooter();
      };

      const toggleTag = (tagToken: string): void => {
        const token = String(tagToken || "").trim().toLowerCase().replace(/^#+/, "");
        if (!token) return;
        if (this._selectedTags.has(token)) this._selectedTags.delete(token);
        else this._selectedTags.add(token);
        renderSelected();
        scopePicker.render();
        syncFooter();
      };

      const toggleProperty = (encodedPair: string): void => {
        if (!decodePropertyPair(encodedPair)) return;
        if (this._selectedProperties.has(encodedPair)) this._selectedProperties.delete(encodedPair);
        else this._selectedProperties.add(encodedPair);
        renderSelected();
        scopePicker.render();
        syncFooter();
      };

      const clearSelection = (): void => {
        this._selectedVault = false;
        this._selectedFolders.clear();
        this._selectedPaths.clear();
        this._selectedTags.clear();
        this._selectedProperties.clear();
      };

      const scopePicker = mountSearchPopoverList({
        searchInput: search,
        popoverEl: popover,
        listEl: scopeList,
        getQuery: () => this._noteSearchQuery,
        setQuery: (query) => {
          this._noteSearchQuery = query;
        },
        getOptions: buildSearchOptions,
        onToggle: (id) => {
          if (id === "vault::") toggleVault();
          else if (id.startsWith("note::")) toggleNote(id.slice("note::".length));
          else if (id.startsWith("folder::")) toggleFolder(id.slice("folder::".length));
          else if (id.startsWith("tag::")) toggleTag(id.slice("tag::".length));
          else if (id.startsWith("prop::")) toggleProperty(id.slice("prop::".length));
        },
        emptyTextWhenQuery: "No matching scope items found.",
        emptyTextWhenIdle: "Type to search notes, folders, tags, or properties.",
        typeFilters: [
          { type: "folder", label: "Folders" },
          { type: "note", label: "Notes" },
          { type: "tag", label: "Tags" },
          { type: "property", label: "Properties" },
        ],
      });

      const listPresets = () => (this._coachDb?.listSavedScopePresets() ?? [])
        .map(rowToSavedScopePreset)
        .filter((preset) => preset.scopes.length > 0);

      const isSelectionSaved = (): boolean => {
        const selectedScopes = this._selectedScopesForPresets();
        if (!selectedScopes.length) return false;
        return listPresets().some((preset) => selectionMatchesPreset(selectedScopes.map(toScopeId), preset));
      };

      const renderPresetList = (preserveOpen = false): void => {
        const presets = listPresets();
        const selectedScopeIds = this._selectedScopesForPresets().map(toScopeId);
        const hasSelection = selectedScopeIds.length > 0;
        const wasOpen = !presetPopover.classList.contains("hidden");
        const keepOpen = preserveOpen && wasOpen;
        presetList.empty();
        presetBtnLabel.setText("Saved presets");
        if (!keepOpen) closePresetPopover();

        const matchingPreset = hasSelection
          ? (presets.find((preset) => selectionMatchesPreset(selectedScopeIds, preset)) ?? null)
          : null;
        const duplicate = !!matchingPreset;

        let nameInput: HTMLInputElement | null = null;
        let addBtn: HTMLSpanElement | null = null;
        let hasTopSection = false;
        if (hasSelection && !duplicate) {
          const createRow = presetList.createDiv({
            cls: "learnkit-ss-search-wrap learnkit-ss-search-wrap learnkit-scope-preset-create learnkit-scope-preset-create",
          });
          hasTopSection = true;
          nameInput = createRow.createEl("input", {
            cls: "learnkit-ss-search-input learnkit-ss-search-input",
            attr: {
              type: "text",
              placeholder: "Preset name",
              "aria-label": "Preset name",
              autocomplete: "off",
              spellcheck: "false",
            },
          });
          addBtn = createRow.createSpan({
            cls: "learnkit-scope-preset-add learnkit-scope-preset-add hidden",
            text: "+",
            attr: {
              role: "button",
              tabindex: "0",
              "aria-label": "Save preset",
            },
          });
        } else if (matchingPreset) {
          hasTopSection = true;
          const status = presetList.createDiv({ cls: "learnkit-scope-preset-status learnkit-scope-preset-status" });
          status.createSpan({ text: "Selection saved as " });
          status.createEl("strong", { text: matchingPreset.name });
        }

        const saveCurrentSelection = async (): Promise<void> => {
          const scopes = this._selectedScopesForPresets();
          if (!this._coachDb || !scopes.length || isSelectionSaved()) return;

          const suggestedName = `Preset ${presets.length + 1}`;
          const name = String(nameInput?.value || "").trim() || suggestedName;
          const now = Date.now();
          const presetId = globalThis.crypto?.randomUUID?.() ?? `preset-${now}-${Math.random().toString(36).slice(2, 8)}`;
          this._coachDb.upsertSavedScopePreset({
            preset_id: presetId,
            name,
            scopes_json: serializeScopes(scopes),
            created_at: now,
            updated_at: now,
          });
          await this._coachDb.persist();
          renderSelected(true);
        };

        if (nameInput && addBtn) {
          const syncAddVisibility = (): void => {
            const canAdd = String(nameInput?.value || "").trim().length > 0;
            addBtn?.classList.toggle("hidden", !canAdd);
          };
          syncAddVisibility();

          addBtn.addEventListener("click", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void saveCurrentSelection();
          });
          addBtn.addEventListener("keydown", (evt) => {
            if (evt.key !== "Enter" && evt.key !== " ") return;
            evt.preventDefault();
            evt.stopPropagation();
            void saveCurrentSelection();
          });
          nameInput.addEventListener("input", () => {
            syncAddVisibility();
          });
          nameInput.addEventListener("keydown", (evt) => {
            if (evt.key !== "Enter") return;
            evt.preventDefault();
            void saveCurrentSelection();
          });
        }

        if (hasTopSection) {
          presetList.createDiv({ cls: "my-1 h-px bg-border" });
        }

        const presetSubtitle = presetList.createDiv({
          cls: "px-2 py-1.5 text-sm text-muted-foreground learnkit-exam-generator-popover-subtitle learnkit-exam-generator-popover-subtitle",
          text: "Saved presets",
        });
        presetSubtitle.setAttr("role", "presentation");

        if (!presets.length) return;

        for (const preset of presets) {
          const selected = selectionMatchesPreset(this._selectedScopesForPresets().map(toScopeId), preset);
          const row = presetList.createDiv({ cls: "learnkit-coach-scope-row learnkit-coach-scope-row" });
          row.setAttr("role", "option");
          row.setAttr("aria-selected", selected ? "true" : "false");
          const applyBtn = row.createEl("button", {
            cls: "learnkit-scope-preset-apply learnkit-scope-preset-apply",
          });
          applyBtn.type = "button";
          if (selected) {
            row.classList.add("is-selected");
            applyBtn.classList.add("is-selected");
          }
          const itemText = applyBtn.createSpan({ cls: "learnkit-scope-preset-item-text learnkit-scope-preset-item-text" });
          itemText.createSpan({ cls: "learnkit-coach-scope-item-label learnkit-coach-scope-item-label", text: `${preset.name} (${preset.scopes.length})` });
          applyBtn.addEventListener("click", () => {
            this._applySavedScopes(preset.scopes);
            closePresetPopover();
            renderSelected();
            scopePicker.render();
            syncFooter();
          });

          const deleteBtn = row.createSpan({
            cls: "learnkit-scope-preset-remove learnkit-scope-preset-remove",
            attr: { "aria-label": `Delete ${preset.name}` },
          });
          setIcon(deleteBtn, "x");
          deleteBtn.setAttr("role", "button");
          deleteBtn.setAttr("tabindex", "0");
          const deletePreset = () => {
            void (async () => {
              if (!this._coachDb) return;
              this._coachDb.deleteSavedScopePreset(preset.id);
              await this._coachDb.persist();
              renderSelected(true);
            })();
          };
          deleteBtn.addEventListener("click", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            deletePreset();
          });
          deleteBtn.addEventListener("keydown", (evt) => {
            if (evt.key !== "Enter" && evt.key !== " ") return;
            evt.preventDefault();
            evt.stopPropagation();
            deletePreset();
          });
        }

        if (keepOpen) openPresetPopover();
      };

      const syncScopeActionState = (): void => {
        const presets = listPresets();
        const hasSelection = selectedScopeCount() > 0;
        const canOpen = hasSelection || presets.length > 0;
        clearWrap.classList.toggle("hidden", !hasSelection);
        presetBtn.disabled = !canOpen;
        if (!canOpen) presetBtn.setAttr("aria-label", "Select content to save a preset");
        else if (!presets.length) presetBtn.setAttr("aria-label", "Save preset");
        else presetBtn.setAttr("aria-label", "Saved presets");

        if (!canOpen) closePresetPopover();
      };

      const syncSaveButtonState = (): void => {
        // Legacy helper name retained; this now only keeps preset CTA state in sync.
        syncScopeActionState();
      };

      presetBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (presetBtn.disabled) return;
        const isOpen = !presetPopover.classList.contains("hidden");
        if (isOpen) closePresetPopover();
        else openPresetPopover();
      });

      presetPopover.addEventListener("click", (evt) => {
        evt.stopPropagation();
      });

      clearBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        clearSelection();
        renderSelected();
        scopePicker.render();
        syncFooter();
      });

      const renderSelected = (preservePresetPopover = false): void => {
        selectedTitle.setText(`Selected (${selectedScopeCount()})`);
        chips.empty();
        if (!selectedScopeCount()) {
          chips.createDiv({ cls: "text-muted-foreground", text: "No content selected yet." });
        } else {
          if (this._selectedVault) {
            const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
            chip.createSpan({ text: `Vault: ${this.app.vault.getName()} (${this._notes.length})` });
            const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
            remove.type = "button";
            remove.setAttr("aria-label", "Remove");
            setIcon(remove, "x");
            remove.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._selectedVault = false;
              renderSelected();
              scopePicker.render();
              syncFooter();
            });
          }

          const selectedFolders = Array.from(this._selectedFolders).sort((a, b) => a.localeCompare(b));
          for (const folder of selectedFolders) {
            const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
            const folderLabel = this._formatFolderChipLabel(folder);
            const count = this._notes.filter((n) => this._folderIncludesPath(folder, n.path)).length;
            chip.createSpan({ text: `Folder: ${folderLabel} (${count})` });
            const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
            remove.type = "button";
            remove.setAttr("aria-label", "Remove");
            setIcon(remove, "x");
            remove.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._selectedFolders.delete(folder);
              renderSelected();
              scopePicker.render();
              syncFooter();
            });
          }

          const selectedNotes = this._notes
            .filter((n) => this._selectedPaths.has(n.path))
            .sort((a, b) => a.path.localeCompare(b.path));
          for (const note of selectedNotes) {
            const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
            chip.createSpan({ text: `Note: ${note.basename}` });
            const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
            remove.type = "button";
            remove.setAttr("aria-label", "Remove");
            setIcon(remove, "x");
            remove.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._selectedPaths.delete(note.path);
              renderSelected();
              scopePicker.render();
              syncFooter();
            });
          }

          const metadata = collectVaultTagAndPropertyPairs(this.app, this._notes);

          const selectedTags = metadata.tags
            .filter((tag) => this._selectedTags.has(tag.token))
            .sort((a, b) => a.token.localeCompare(b.token));

          for (const tag of selectedTags) {
            const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
            chip.createSpan({ text: `Tag: ${tag.display} (${tag.count})` });
            const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
            remove.type = "button";
            remove.setAttr("aria-label", "Remove");
            setIcon(remove, "x");
            remove.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._selectedTags.delete(tag.token);
              renderSelected();
              scopePicker.render();
              syncFooter();
            });
          }

          const selectedProperties = metadata.properties
            .filter((pair) => this._selectedProperties.has(`${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`))
            .sort((a, b) => {
              const keyCmp = a.key.localeCompare(b.key);
              if (keyCmp !== 0) return keyCmp;
              return a.value.localeCompare(b.value);
            });

          for (const pair of selectedProperties) {
            const encoded = `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`;
            const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
            chip.createSpan({ text: `${pair.displayKey}: ${pair.displayValue} (${pair.count})` });
            const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
            remove.type = "button";
            remove.setAttr("aria-label", "Remove");
            setIcon(remove, "x");
            remove.addEventListener("click", (evt) => {
              evt.stopPropagation();
              this._selectedProperties.delete(encoded);
              renderSelected();
              scopePicker.render();
              syncFooter();
            });
          }
        }
        renderPresetList(preservePresetPopover);
        syncSaveButtonState();
      };

      renderSelected();
      scopePicker.render();

      // ---- Attachments (optional) ----
      const attachArea = page.createDiv({ cls: "learnkit-exam-generator-attachments learnkit-exam-generator-attachments" });
      const attachWrap = attachArea.createDiv({ cls: "learnkit-coach-selected-wrap learnkit-coach-selected-wrap" });
      const attachmentsTitle = attachWrap.createDiv({ cls: "learnkit-coach-selected-title learnkit-coach-selected-title" });
      const attachChips = attachWrap.createDiv({ cls: "learnkit-coach-selected-chips learnkit-coach-selected-chips" });
      const attachActions = attachWrap.createDiv({ cls: "learnkit-coach-scope-actions-grid learnkit-coach-scope-actions-grid" });
      const attachAction = attachActions.createDiv({ cls: "learnkit-coach-scope-action learnkit-coach-scope-action" });
      const clearAttachAction = attachActions.createDiv({ cls: "learnkit-coach-scope-action learnkit-coach-scope-action learnkit-exam-generator-hidden learnkit-exam-generator-hidden" });

      const clearAttachBtn = clearAttachAction.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
        attr: {
          type: "button",
          "aria-label": "Clear attachments",
        },
      });
      const clearAttachIcon = clearAttachBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(clearAttachIcon, "x");
      clearAttachBtn.createSpan({ cls: "", text: "Clear attachments" });

      const renderAttachChips = () => {
        attachmentsTitle.setText(`Attachments (${this._attachedFiles.length})`);
        clearAttachAction.classList.toggle("learnkit-exam-generator-hidden", this._attachedFiles.length <= 0);
        attachChips.empty();
        if (this._attachedFiles.length === 0) {
          attachChips.createDiv({ cls: "text-muted-foreground", text: "No content attached yet." });
          return;
        }
        for (let i = 0; i < this._attachedFiles.length; i++) {
          const af = this._attachedFiles[i];
          const chip = attachChips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip learnkit-assistant-popup-attachment-chip learnkit-assistant-popup-attachment-chip" });
          chip.createSpan({ text: formatAttachmentChipLabel(af.name, af.extension), cls: "learnkit-assistant-popup-attachment-name learnkit-assistant-popup-attachment-name" });
          const removeBtn = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove learnkit-assistant-popup-attachment-remove learnkit-assistant-popup-attachment-remove" });
          removeBtn.type = "button";
          removeBtn.setAttribute("aria-label", "Remove");
          setIcon(removeBtn, "x");
          removeBtn.addEventListener("click", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this._attachedFiles.splice(i, 1);
            renderAttachChips();
            syncFooter();
          });
        }
      };

      clearAttachBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (this._attachedFiles.length === 0) return;
        this._attachedFiles = [];
        renderAttachChips();
        syncFooter();
      });
      renderAttachChips();

      const addBtn = attachAction.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2",
      });
      addBtn.type = "button";
      const addBtnIcon = addBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(addBtnIcon, "paperclip");
      addBtn.createSpan({ cls: "", text: "Attach file" });
      addBtn.addEventListener("click", () => {
        if (this._attachedFiles.length >= MAX_ATTACHMENTS) {
          new Notice(`Maximum ${MAX_ATTACHMENTS} attachments.`);
          return;
        }
        const allFiles = this.app.vault.getFiles().filter((f: TFile) => isSupportedAttachmentExt(f.extension));
        const modal = new ExamAttachmentPickerModal(this.app, allFiles, (file: TFile) => {
          void (async () => {
            if (this._attachedFiles.length >= MAX_ATTACHMENTS) {
              new Notice(`Maximum ${MAX_ATTACHMENTS} attachments.`);
              return;
            }
            if (this._attachedFiles.some(af => af.name === file.name)) return;
            const attached = await readVaultFileAsAttachment(this.app, file);
            if (!attached) {
              new Notice("Failed to read file or file too large.");
              return;
            }
            this._attachedFiles.push(attached);
            renderAttachChips();
            syncFooter();
          })();
        }, (attached) => {
          if (this._attachedFiles.length >= MAX_ATTACHMENTS) {
            new Notice(`Maximum ${MAX_ATTACHMENTS} attachments.`);
            return;
          }
          if (this._attachedFiles.some(af => af.name === attached.name)) return;
          this._attachedFiles.push(attached);
          renderAttachChips();
          syncFooter();
        });
        modal.open();
      });

      const footer = page.createDiv({ cls: "learnkit-coach-wizard-footer learnkit-coach-wizard-footer" });
      nextBtn = footer.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent h-9 inline-flex items-center gap-2",
      });
      nextBtn.type = "button";
      nextBtn.createSpan({ text: "Next" });
      const nextBtnIcon = nextBtn.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-3.5" });
      setIcon(nextBtnIcon, "arrow-right");
      nextBtn.disabled = !canGenerateNow();
      nextBtn.addEventListener("click", () => {
        this._wizardSlide = "next";
        this._setupStage = "config";
        this._render();
      });
      return;
    }

    page.createEl("h3", { text: "Test settings" });
    page.createEl("p", {
      cls: "learnkit-coach-step-copy learnkit-coach-step-copy",
      text: "Set difficulty, question type, count, and timing.",
    });

    const options = page.createDiv({ cls: "learnkit-exam-generator-options learnkit-exam-generator-options" });

    this._renderSelectOption(options, "Difficulty", ["easy", "medium", "hard"], this._config.difficulty, (value) => {
      this._config.difficulty = value as ExamDifficulty;
    }, { easy: "Easy", medium: "Medium", hard: "Hard" });

    this._renderSelectOption(options, "Question type", ["mixed", "mcq", "saq"], this._config.questionMode, (value) => {
      this._config.questionMode = value as ExamQuestionMode;
    }, { mixed: "Mixed questions", mcq: "Multiple choice questions", saq: "Short answer questions" });

    this._renderSelectOption(options, "Question count", ["5", "10", "15", "20"], String(this._config.questionCount), (value) => {
      this._config.questionCount = Math.max(1, Number(value) || 5);
    });

    const testNameRow = options.createDiv({ cls: "learnkit-exam-generator-row learnkit-exam-generator-row" });
    testNameRow.createDiv({ cls: "learnkit-exam-generator-label learnkit-exam-generator-label", text: "Test name (optional)" });
    const testNameInput = testNameRow.createEl("input", {
      type: "text",
      cls: "input h-9 learnkit-exam-generator-input learnkit-exam-generator-input",
      attr: { maxlength: "120" },
    });
    testNameInput.value = this._config.testName;
    testNameInput.addEventListener("input", () => {
      this._config.testName = testNameInput.value;
    });

    type ExamOptionValue = "timed" | "appliedScenarios" | "customInstructions" | "includeFlashcards";
    const selectedExamOptions = new Set<ExamOptionValue>();
    if (this._config.timed) selectedExamOptions.add("timed");
    if (this._config.appliedScenarios) selectedExamOptions.add("appliedScenarios");
    if (this._config.customInstructions.trim()) selectedExamOptions.add("customInstructions");
    if (this._config.includeFlashcards) selectedExamOptions.add("includeFlashcards");

    // Dynamic conditional rows container — only checked options show their inputs, no gaps.
    const conditionalContainer = options.createDiv({ cls: "learnkit-exam-generator-row learnkit-exam-generator-row learnkit-exam-generator-conditional-rows learnkit-exam-generator-conditional-rows" });

    const durationRow = conditionalContainer.createDiv({ cls: "learnkit-exam-generator-conditional-item learnkit-exam-generator-conditional-item" });
    durationRow.classList.toggle("learnkit-exam-generator-hidden", !this._config.timed);
    durationRow.createDiv({ cls: "learnkit-exam-generator-label learnkit-exam-generator-label", text: "Time limit" });
    const durationInputWrap = durationRow.createDiv({ cls: "learnkit-exam-generator-input-wrap learnkit-exam-generator-input-wrap" });
    const durationInput = durationInputWrap.createEl("input", {
      type: "number",
      cls: "input h-9 learnkit-exam-generator-input learnkit-exam-generator-input",
      attr: { min: "1", step: "1", inputmode: "numeric", placeholder: "20" },
    });
    const durationUnit = durationInputWrap.createSpan({
      cls: "learnkit-exam-generator-input-suffix learnkit-exam-generator-input-suffix learnkit-exam-generator-hidden learnkit-exam-generator-hidden",
      text: "minutes",
    });
    durationInput.value = String(this._config.durationMinutes);

    const syncDurationSuffix = () => {
      durationUnit.classList.toggle("learnkit-exam-generator-hidden", !durationInput.value.trim());
    };

    durationInput.addEventListener("input", () => {
      syncDurationSuffix();
    });

    durationInput.addEventListener("change", () => {
      const raw = durationInput.value.trim();
      if (!raw) {
        this._config.durationMinutes = 20;
        syncDurationSuffix();
        return;
      }
      this._config.durationMinutes = Math.max(1, Number(raw) || 20);
      durationInput.value = String(this._config.durationMinutes);
      syncDurationSuffix();
    });
    syncDurationSuffix();

    const customInstructionsRow = conditionalContainer.createDiv({ cls: "learnkit-exam-generator-conditional-item learnkit-exam-generator-conditional-item" });
    customInstructionsRow.classList.toggle("learnkit-exam-generator-hidden", !selectedExamOptions.has("customInstructions"));
    customInstructionsRow.createDiv({ cls: "learnkit-exam-generator-label learnkit-exam-generator-label", text: "Custom instructions" });
    const customInstructionsInput = customInstructionsRow.createEl("textarea", {
      cls: "input learnkit-exam-generator-input learnkit-exam-generator-input learnkit-exam-generator-custom-instructions learnkit-exam-generator-custom-instructions",
      attr: { maxlength: "500", placeholder: "Add additional instructions for the exam generator\u2026", rows: "3" },
    });
    customInstructionsInput.value = this._config.customInstructions;
    customInstructionsInput.addEventListener("input", () => {
      this._config.customInstructions = customInstructionsInput.value;
    });

    const syncConditionalVisibility = () => {
      const timedEnabled = selectedExamOptions.has("timed");
      const customEnabled = selectedExamOptions.has("customInstructions");
      durationRow.classList.toggle("learnkit-exam-generator-hidden", !timedEnabled);
      customInstructionsRow.classList.toggle("learnkit-exam-generator-hidden", !customEnabled);
      // Hide the entire container when no conditional rows are visible
      const anyVisible = timedEnabled || customEnabled;
      conditionalContainer.classList.toggle("learnkit-exam-generator-hidden", !anyVisible);
    };
    syncConditionalVisibility();

    this._renderMultiSelectOption(
      options,
      "Exam options",
      ["timed", "appliedScenarios", "customInstructions", "includeFlashcards"],
      selectedExamOptions,
      (selectedValues) => {
        selectedExamOptions.clear();
        for (const value of selectedValues) selectedExamOptions.add(value);

        this._config.timed = selectedExamOptions.has("timed");
        this._config.appliedScenarios = selectedExamOptions.has("appliedScenarios");
        this._config.includeFlashcards = selectedExamOptions.has("includeFlashcards");

        if (!selectedExamOptions.has("customInstructions")) {
          this._config.customInstructions = "";
          customInstructionsInput.value = "";
        }

        syncConditionalVisibility();
      },
      {
        timed: "Enable time limit",
        appliedScenarios: "Applied scenarios",
        customInstructions: "Custom instructions",
        includeFlashcards: "Include flashcards",
      },
    );

    const footer = page.createDiv({ cls: "learnkit-coach-wizard-footer learnkit-coach-wizard-footer learnkit-exam-generator-settings-footer learnkit-exam-generator-settings-footer" });
    const backBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2",
    });
    backBtn.type = "button";
    const backBtnIcon = backBtn.createSpan({ cls: "inline-flex items-center justify-center" });
    setIcon(backBtnIcon, "chevron-left");
    backBtn.createSpan({ cls: "", text: "Back" });
    backBtn.addEventListener("click", () => {
      this._wizardSlide = "back";
      this._setupStage = "source";
      this._render();
    });

    const generateBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent h-9 inline-flex items-center gap-2",
    });
    generateBtn.type = "button";
    const generateBtnIcon = generateBtn.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-3.5" });
    setIcon(generateBtnIcon, "wand-sparkles");
    generateBtn.createSpan({ text: "Generate test" });
    generateBtn.setAttr("aria-label", "Generate test");
    generateBtn.disabled = !canGenerateNow();
    generateBtn.addEventListener("click", () => {
      this._mode = "generating";
      this._render();
      void this._generateExam();
    });
  }

  private _renderSelectOption(
    host: HTMLElement,
    label: string,
    values: string[],
    current: string,
    onChange: (value: string) => void,
    labels?: Record<string, string>,
  ): void {
    const row = host.createDiv({ cls: "learnkit-exam-generator-row learnkit-exam-generator-row" });
    row.createDiv({ cls: "learnkit-exam-generator-label learnkit-exam-generator-label", text: label });
    const getTextForValue = (value: string): string => labels?.[value] ?? value
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const wrap = row.createDiv({ cls: "learnkit-exam-generator-select-wrap learnkit-exam-generator-select-wrap" });
    const id = `sprout-dd-${Math.random().toString(36).slice(2, 9)}`;
    const trigger = wrap.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-pointer-auto learnkit-pointer-auto learnkit-exam-generator-select-trigger learnkit-exam-generator-select-trigger",
      attr: {
        type: "button",
        id: `${id}-trigger`,
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        "aria-label": label,
      },
    });
    const triggerText = trigger.createSpan({ cls: "truncate", text: getTextForValue(current) });
    const chevron = trigger.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    chevron.setAttr("aria-hidden", "true");
    setIcon(chevron, "chevron-down");

    const popover = wrap.createDiv({ cls: "learnkit-exam-generator-select-popover learnkit-exam-generator-select-popover dropdown-menu hidden" });
    const panel = popover.createDiv({
      cls: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto learnkit-exam-generator-select-panel learnkit-exam-generator-select-panel",
    });
    const menu = panel.createDiv({ cls: "flex flex-col" });
    menu.setAttr("role", "menu");
    menu.setAttr("id", `${id}-menu`);

    let currentValue = current;

    const close = (): void => {
      popover.classList.add("hidden");
      trigger.setAttr("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    };

    const open = (): void => {
      popover.classList.remove("hidden");
      trigger.setAttr("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
    };

    const onOutsidePointerDown = (evt: PointerEvent): void => {
      const target = evt.target;
      if (target instanceof Node && wrap.contains(target)) return;
      close();
    };

    const setChecked = (item: HTMLElement, checked: boolean): void => {
      item.setAttr("aria-checked", checked ? "true" : "false");
    };

    const items: Array<{ value: string; item: HTMLElement }> = [];

    for (const value of values) {
      const item = menu.createDiv({
        cls: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground learnkit-exam-generator-select-item",
      });
      item.setAttr("role", "menuitemradio");
      item.setAttr("tabindex", "0");
      setChecked(item, value === currentValue);

      const dotWrap = item.createDiv({ cls: "size-4 flex items-center justify-center learnkit-exam-generator-select-item-dot-wrap" });
      dotWrap.createDiv({ cls: "size-2 rounded-full learnkit-exam-generator-select-item-dot" });
      item.createSpan({ cls: "learnkit-exam-generator-select-item-label", text: getTextForValue(value) });

      const activate = (): void => {
        currentValue = value;
        triggerText.setText(getTextForValue(value));
        for (const entry of items) setChecked(entry.item, entry.value === value);
        onChange(value);
        close();
      };

      item.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        activate();
      });

      item.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          evt.stopPropagation();
          activate();
          return;
        }
        if (evt.key === "Escape") {
          evt.preventDefault();
          evt.stopPropagation();
          close();
          trigger.focus();
        }
      });

      items.push({ value, item });
    }

    trigger.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const isOpen = !popover.classList.contains("hidden");
      if (isOpen) close();
      else open();
    });

    popover.addEventListener("click", (evt) => {
      evt.stopPropagation();
    });
  }

  private _renderMultiSelectOption<T extends string>(
    host: HTMLElement,
    label: string,
    values: T[],
    selected: Set<T>,
    onChange: (values: T[]) => void,
    labels?: Record<string, string>,
  ): void {
    const row = host.createDiv({ cls: "learnkit-exam-generator-row learnkit-exam-generator-row" });
    row.createDiv({ cls: "learnkit-exam-generator-label learnkit-exam-generator-label", text: label });

    const getTextForValue = (value: string): string => labels?.[value] ?? value
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const getTriggerText = (): string => {
      const selectedValues = values.filter((value) => selected.has(value));
      if (selectedValues.length === 0) return "None";
      if (selectedValues.length <= 2) return selectedValues.map(getTextForValue).join(", ");
      return `${selectedValues.length} selected`;
    };

    const wrap = row.createDiv({ cls: "learnkit-exam-generator-select-wrap learnkit-exam-generator-select-wrap" });
    const id = `sprout-dd-${Math.random().toString(36).slice(2, 9)}`;
    const trigger = wrap.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-pointer-auto learnkit-pointer-auto learnkit-exam-generator-select-trigger learnkit-exam-generator-select-trigger",
      attr: {
        type: "button",
        id: `${id}-trigger`,
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        "aria-label": label,
      },
    });
    const triggerText = trigger.createSpan({ cls: "truncate", text: getTriggerText() });
    const chevron = trigger.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    chevron.setAttr("aria-hidden", "true");
    setIcon(chevron, "chevron-down");

    const popover = wrap.createDiv({ cls: "learnkit-exam-generator-select-popover learnkit-exam-generator-select-popover dropdown-menu hidden" });
    const panel = popover.createDiv({
      cls: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto learnkit-exam-generator-select-panel learnkit-exam-generator-select-panel",
    });
    const menu = panel.createDiv({ cls: "flex flex-col" });
    menu.setAttr("role", "menu");
    menu.setAttr("id", `${id}-menu`);

    const close = (): void => {
      popover.classList.add("hidden");
      trigger.setAttr("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    };

    const open = (): void => {
      popover.classList.remove("hidden");
      trigger.setAttr("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
    };

    const onOutsidePointerDown = (evt: PointerEvent): void => {
      const target = evt.target;
      if (target instanceof Node && wrap.contains(target)) return;
      close();
    };

    const setChecked = (item: HTMLElement, checked: boolean): void => {
      item.setAttr("aria-checked", checked ? "true" : "false");
    };

    const items = new Map<T, HTMLElement>();

    const syncUi = (): void => {
      for (const value of values) {
        const item = items.get(value);
        if (!item) continue;
        setChecked(item, selected.has(value));
      }
      triggerText.setText(getTriggerText());
    };

    for (const value of values) {
      const item = menu.createDiv({
        cls: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground learnkit-exam-generator-select-item",
      });
      item.setAttr("role", "menuitemcheckbox");
      item.setAttr("tabindex", "0");
      setChecked(item, selected.has(value));

      const dotWrap = item.createDiv({ cls: "size-4 flex items-center justify-center learnkit-exam-generator-select-item-dot-wrap" });
      dotWrap.createDiv({ cls: "size-2 rounded-full learnkit-exam-generator-select-item-dot" });
      item.createSpan({ cls: "learnkit-exam-generator-select-item-label", text: getTextForValue(value) });

      const toggle = (): void => {
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        syncUi();
        onChange(values.filter((entry) => selected.has(entry)));
      };

      item.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        toggle();
      });

      item.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          evt.stopPropagation();
          toggle();
          return;
        }
        if (evt.key === "Escape") {
          evt.preventDefault();
          evt.stopPropagation();
          close();
          trigger.focus();
        }
      });

      items.set(value, item);
    }

    trigger.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const isOpen = !popover.classList.contains("hidden");
      if (isOpen) close();
      else open();
    });

    popover.addEventListener("click", (evt) => {
      evt.stopPropagation();
    });

    syncUi();
  }

  private _collectSourceFiles(): TFile[] {
    if (this._config.sourceMode === "selected") {
      return this._selectedModeCandidates();
    }
    return this._getFolderCandidates();
  }

  private _extractEmbedRefs(markdown: string): string[] {
    const refs = new Set<string>();
    const wikiRe = /!\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = wikiRe.exec(markdown)) !== null) {
      const raw = String(m[1] || "").trim();
      if (!raw) continue;
      const filePart = raw.split("|")[0]?.split("#")[0]?.trim();
      if (filePart) refs.add(filePart);
    }
    const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    while ((m = mdRe.exec(markdown)) !== null) {
      const raw = String(m[1] || "").trim();
      if (!raw) continue;
      refs.add(raw.replace(/^<|>$/g, ""));
    }
    return Array.from(refs);
  }

  private _extractLinkedRefs(markdown: string): string[] {
    const refs = new Set<string>();
    let m: RegExpExecArray | null;

    const wikiRe = /(^|[^!])\[\[([^\]]+)\]\]/g;
    while ((m = wikiRe.exec(markdown)) !== null) {
      const raw = String(m[2] || "").trim();
      if (!raw) continue;
      const filePart = raw.split("|")[0]?.split("#")[0]?.trim();
      if (filePart) refs.add(filePart);
    }

    const mdRe = /(^|[^!])\[[^\]]*\]\(([^)]+)\)/g;
    while ((m = mdRe.exec(markdown)) !== null) {
      const raw = String(m[2] || "").trim();
      if (!raw) continue;
      const normalized = raw.replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|obsidian:|file:)/i.test(normalized)) continue;
      refs.add(normalized);
    }

    return Array.from(refs);
  }

  private async _buildLinkedNotesContext(file: TFile, markdown: string): Promise<string> {
    const linkedRefs = this._extractLinkedRefs(markdown);
    if (!linkedRefs.length) return "";

    const sections: string[] = [];
    const seen = new Set<string>();
    const limits = getLinkedContextLimits(this.plugin.settings.studyAssistant.privacy.linkedContextLimit);
    const { maxNotes, maxCharsPerNote, maxCharsTotal } = limits;
    let totalChars = 0;

    for (const ref of linkedRefs) {
      if (sections.length >= maxNotes || totalChars >= maxCharsTotal) break;
      const resolved = resolveImageFile(this.app, file.path, ref);
      if (!(resolved instanceof TFile)) continue;
      if (String(resolved.extension || "").toLowerCase() !== "md") continue;
      if (resolved.path === file.path) continue;
      if (seen.has(resolved.path)) continue;
      seen.add(resolved.path);

      let linked = "";
      try {
        linked = String(await this.app.vault.cachedRead(resolved) || "").trim();
      } catch {
        linked = "";
      }
      if (!linked) continue;

      const allowed = Math.min(maxCharsPerNote, maxCharsTotal - totalChars);
      if (allowed <= 0) break;
      const clipped = linked.slice(0, allowed);
      totalChars += clipped.length;
      sections.push(`### ${resolved.path}\n${clipped}`);
    }

    if (!sections.length) return "";
    return [
      "Children page additional, secondary context:",
      ...sections,
    ].join("\n\n");
  }

  private async _generateExam(): Promise<void> {
    let selectedFiles = this._collectSourceFiles();
    selectedFiles = Array.from(new Map(selectedFiles.map((file) => [file.path, file])).values());
    const hasAttachments = this._attachedFiles.length > 0;
    if (selectedFiles.length === 0 && !hasAttachments) {
      new Notice(this._config.sourceMode === "folder" ? "No notes found in that folder." : "Select at least one note or attach a file.");
      return;
    }

    if (this._config.sourceMode === "folder") {
      const folder = this._config.folderPath || "vault root";
      const available = this._config.folderPath
        ? this._notes.filter((n) => this._config.includeSubfolders ? n.path.startsWith(`${this._config.folderPath}/`) : (n.path.slice(0, Math.max(0, n.path.lastIndexOf("/"))) === this._config.folderPath)).length
        : this._notes.length;
      if (available > this._config.maxFolderNotes) {
        new Notice(`Using ${Math.min(this._config.maxFolderNotes, available)} of ${available} notes from ${folder}.`);
      }
    }

    try {
      const includeLinkedNotes = !!this.plugin.settings.studyAssistant.privacy.includeLinkedNotesInExam;
      const testsCustomInstructions = String(this.plugin.settings.studyAssistant.prompts.tests || "").trim();
      const notes = await Promise.all(selectedFiles.map(async (file) => {
        const rawContent = await this.app.vault.cachedRead(file);
        const linkedContext = includeLinkedNotes
          ? await this._buildLinkedNotesContext(file, rawContent)
          : "";
        const baseContent = linkedContext ? `${rawContent}\n\n${linkedContext}` : rawContent;
        const customInstructionBlock = testsCustomInstructions
          ? `\n\nAdditional Tests custom instructions (plain text context):\n${testsCustomInstructions}`
          : "";
        return {
          path: file.path,
          title: file.basename,
          rawContent,
          content: `${baseContent}${customInstructionBlock}`,
        };
      }));

      const rankedNotes = this._config.sourceMode === "folder"
        ? this._rankNotesByEducationalDensity(notes).slice(0, this._config.maxFolderNotes)
        : notes;

      // Auto-include embedded/linked attachments (images, PDFs, docs, code files) from source notes.
      const noteEmbedUrls: string[] = [];
      const includeEmbeddedAttachments = !!this.plugin.settings.studyAssistant.privacy.includeAttachmentsInExam;
      const includeLinkedAttachments = !!this.plugin.settings.studyAssistant.privacy.includeLinkedAttachmentsInExam;
      if (includeEmbeddedAttachments || includeLinkedAttachments) {
        for (const note of rankedNotes) {
          const refs = new Set<string>();
          const sourceContent = String((note as { rawContent?: string }).rawContent || note.content || "");
          if (includeEmbeddedAttachments) {
            for (const ref of this._extractEmbedRefs(sourceContent)) refs.add(ref);
          }
          if (includeLinkedAttachments) {
            for (const ref of this._extractLinkedRefs(sourceContent)) refs.add(ref);
          }

          for (const ref of refs) {
            const resolved = resolveImageFile(this.app, note.path, ref);
            if (!(resolved instanceof TFile)) continue;
            const ext = String(resolved.extension || "").toLowerCase();
            if (ext === "md") continue;
            if (!isSupportedAttachmentExt(ext)) continue;
            try {
              const attached = await readVaultFileAsAttachment(this.app, resolved);
              if (attached) noteEmbedUrls.push(attached.dataUrl);
            } catch {
              // Skip unreadable embedded files.
            }
          }
        }
      }

      const dedupedAttachmentUrls = Array.from(new Set([...this._attachedFiles.map(f => f.dataUrl), ...noteEmbedUrls]));

      const questions = await generateExamQuestions({
        settings: this.plugin.settings.studyAssistant,
        notes: rankedNotes,
        config: this._config,
        attachedFileDataUrls: dedupedAttachmentUrls,
      });

      this._attachedFiles = [];

      this._questions = questions;
      this._answers = new Map();
      this._questionResults = [];
      this._currentIndex = 0;
      this._finalPercent = null;
      this._submitted = false;
      this._autoSubmitted = false;
      this._elapsedSec = 0;
      this._examStartMs = Date.now();
      this._activeTestId = this._persistGeneratedTest(rankedNotes);
      this._mode = "taking";

      // Background AI naming (fire-and-forget) — only for unnamed tests
      if (this._activeTestId && !this._config.testName.trim()) {
        const testId = this._activeTestId;
        const prompts = this._questions.map((q) => q.prompt);
        suggestTestName({
          settings: this.plugin.settings.studyAssistant,
          questionPrompts: prompts,
          difficulty: this._config.difficulty,
          questionMode: this._config.questionMode,
        })
          .then((aiName) => {
            if (!this._testsDb) return;
            const newLabel = `${aiName} - ${new Date().toLocaleString()}`;
            if (this._testsDb.updateTestLabel(testId, newLabel)) {
              void this._testsDb.persist();
              this._savedTests = this._testsDb.listTests(25);
            }
          })
          .catch(() => {/* silently ignore — fallback label remains */});
      }

      this._startTimer();
      this._render();
    } catch (err) {
      const message = err instanceof Error ? err.message : (typeof err === "string" ? err : "Unknown error");
      new Notice(`Test generation failed: ${message}`);
      this._mode = "setup";
      this._setupStage = "config";
      this._render();
    }
  }

  private _renderGenerating(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card learnkit-exam-generator-card learnkit-exam-generator-card learnkit-exam-generator-card-loading learnkit-exam-generator-card-loading" });
    const center = card.createDiv({ cls: "learnkit-exam-generator-loading-center learnkit-exam-generator-loading-center" });

    const loader = center.createDiv({ cls: "learnkit-exam-generator-loading-loader learnkit-exam-generator-loading-loader" });
    const firstSlot = loader.createSpan({ cls: "learnkit-exam-generator-loading-word-slot learnkit-exam-generator-loading-word-slot is-first" });
    const secondSlot = loader.createSpan({ cls: "learnkit-exam-generator-loading-word-slot learnkit-exam-generator-loading-word-slot is-second" });
    const firstCurrent = firstSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word current", text: "" });
    const firstNext = firstSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word next", text: "" });
    const secondCurrent = secondSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word current", text: "" });
    const secondNext = secondSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word next", text: "" });

    const loadingPairs: Array<[string, string]> = [
      ["Untangling", "Spaghetti"],
      ["Brewing", "Questions"],
      ["Aligning", "Neurons"],
      ["Organising", "Knowledge"],
      ["Generating", "Homework"],
      ["Calculating", "Difficulty"],
      ["Inducing", "Panic"],
      ["Summoning", "Concepts"],
      ["Assembling", "Questions"],
      ["Reviewing", "Textbooks"],
      ["Compressing", "Information"],
      ["Checking", "Understanding"],
      ["Increasing", "Difficulty"],
      ["Inventing", "Homework"],
      ["Evaluating", "Confidence"],
      ["Pretending", "Easy"],
    ];

    const SWAP_MS = 420;
    const HOLD_MS = 900;
    const STEP_MS = SWAP_MS + HOLD_MS;

    this._startLoadingWordSwapAnimation({
      mode: "generating",
      loadingPairs,
      firstSlot,
      secondSlot,
      firstCurrent,
      firstNext,
      secondCurrent,
      secondNext,
      swapMs: SWAP_MS,
      stepMs: STEP_MS,
      fallbackPair: ["Loading", "Content"],
    });
  }

  private _startLoadingWordSwapAnimation(args: {
    mode: ExamViewMode;
    loadingPairs: Array<[string, string]>;
    firstSlot: HTMLElement;
    secondSlot: HTMLElement;
    firstCurrent: HTMLElement;
    firstNext: HTMLElement;
    secondCurrent: HTMLElement;
    secondNext: HTMLElement;
    swapMs: number;
    stepMs: number;
    fallbackPair: [string, string];
  }): void {
    const {
      mode,
      loadingPairs,
      firstSlot,
      secondSlot,
      firstCurrent,
      firstNext,
      secondCurrent,
      secondNext,
      swapMs,
      stepMs,
      fallbackPair,
    } = args;

    // Ensure only one loader loop runs at a time for this view instance.
    this._stopLoadingWordAnimation();

    const sourcePairs = loadingPairs.length > 0 ? [...loadingPairs] : [fallbackPair];
    const pairKey = (pair: [string, string]): string => `${pair[0]}|||${pair[1]}`;
    const shufflePairs = (pairs: Array<[string, string]>): Array<[string, string]> => {
      const next = [...pairs];
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    };

    let lastShownPairKey = "";
    const buildQueue = (): Array<[string, string]> => {
      const queue = shufflePairs(sourcePairs);
      if (queue.length > 1 && lastShownPairKey && pairKey(queue[0]) === lastShownPairKey) {
        const swapIndex = queue.findIndex((pair) => pairKey(pair) !== lastShownPairKey);
        if (swapIndex > 0) {
          [queue[0], queue[swapIndex]] = [queue[swapIndex], queue[0]];
        }
      }
      return queue;
    };

    let pairQueue = buildQueue();
    let queueIndex = 0;

    const applyCurrentPair = (pair: [string, string]) => {
      const [first, second] = pair;
      firstCurrent.textContent = first;
      secondCurrent.textContent = second;
    };

    const initialPair = pairQueue[queueIndex] ?? fallbackPair;
    applyCurrentPair(initialPair);
    lastShownPairKey = pairKey(initialPair);

    this._loadingWordInterval = window.setInterval(() => {
      if (this._mode !== mode) return;
      if (this._loadingWordSwapTimeout != null) return;

      let nextIndex = queueIndex + 1;
      if (nextIndex >= pairQueue.length) {
        pairQueue = buildQueue();
        nextIndex = 0;
      }

      const nextPair = pairQueue[nextIndex] ?? fallbackPair;
      const [nextFirst, nextSecond] = nextPair;
      firstNext.textContent = nextFirst;
      secondNext.textContent = nextSecond;

      firstSlot.classList.add("is-swapping");
      secondSlot.classList.add("is-swapping");

      this._loadingWordSwapTimeout = window.setTimeout(() => {
        queueIndex = nextIndex;
        lastShownPairKey = pairKey(nextPair);

        // Snap to post-transition baseline without animating back.
        firstSlot.classList.add("is-resetting");
        secondSlot.classList.add("is-resetting");
        applyCurrentPair(nextPair);
        firstNext.textContent = "";
        secondNext.textContent = "";
        firstSlot.classList.remove("is-swapping");
        secondSlot.classList.remove("is-swapping");
        void firstSlot.getBoundingClientRect();
        void secondSlot.getBoundingClientRect();
        firstSlot.classList.remove("is-resetting");
        secondSlot.classList.remove("is-resetting");
        this._loadingWordSwapTimeout = null;
      }, swapMs);
    }, stepMs);
  }

  private _stopLoadingWordAnimation(): void {
    if (this._loadingWordInterval != null) {
      window.clearInterval(this._loadingWordInterval);
      this._loadingWordInterval = null;
    }
    if (this._loadingWordSwapTimeout != null) {
      window.clearTimeout(this._loadingWordSwapTimeout);
      this._loadingWordSwapTimeout = null;
    }
  }

  private _startTimer(): void {
    this._stopTimer();

    if (this._config.timed) {
      this._timerInterval = window.setInterval(() => {
        if (this._mode !== "taking") return;
        this._elapsedSec = Math.max(0, Math.floor((Date.now() - this._examStartMs) / 1000));
        const remaining = this._remainingSec();
        if (this._titleTimerEl) {
          this._titleTimerEl.textContent = this._formatTime(remaining);
        }
        if (remaining <= 0 && this._autoSubmitGrace === null) {
          this._triggerAutoSubmitWarning();
        }
      }, 1000);
    } else {
      // Count-up timer for untimed mode
      this._untimedPaused = false;
      this._timerInterval = window.setInterval(() => {
        if (this._mode !== "taking" || this._untimedPaused) return;
        this._elapsedSec++;
        if (this._titleTimerEl) {
          this._titleTimerEl.textContent = this._formatTime(this._elapsedSec);
        }
      }, 1000);
    }
  }

  private _stopTimer(): void {
    if (this._timerInterval != null) {
      window.clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  private _triggerAutoSubmitWarning(): void {
    this._stopTimer();
    this._autoSubmitGrace = 30;
    this._render();
    this._autoSubmitGraceInterval = window.setInterval(() => {
      if (this._autoSubmitGrace === null) return;
      this._autoSubmitGrace = Math.max(0, this._autoSubmitGrace - 1);
      if (this._autoSubmitWarningCountdownEl) {
        this._autoSubmitWarningCountdownEl.textContent = String(this._autoSubmitGrace);
      }
      if (this._autoSubmitGrace <= 0) {
        this._clearAutoSubmitGrace();
        this._autoSubmitted = true;
        void this._submitExam(true);
      }
    }, 1000);
  }

  private _clearAutoSubmitGrace(): void {
    if (this._autoSubmitGraceInterval !== null) {
      window.clearInterval(this._autoSubmitGraceInterval);
      this._autoSubmitGraceInterval = null;
    }
    this._autoSubmitGrace = null;
    this._autoSubmitWarningCountdownEl = null;
  }

  private _renderTitleTimer(container: HTMLElement): void {
    const timerGroup = document.createElement("div");
    timerGroup.className = "flex items-center gap-2 lk-session-timer-group";

    const timerDisplay = document.createElement("button");
    timerDisplay.type = "button";
    timerDisplay.disabled = true;
    timerDisplay.className =
      "learnkit-btn-toolbar learnkit-btn-accent h-9 inline-flex items-center gap-2 equal-height-btn learnkit-btn-timer-display";
    timerDisplay.setAttribute("aria-label", this._config.timed ? "Time remaining" : "Elapsed time");

    const timerText = document.createElement("span");
    timerText.className = "truncate lk-exam-timer-text";
    timerText.textContent = this._config.timed
      ? this._formatTime(this._remainingSec())
      : this._formatTime(this._elapsedSec);
    timerDisplay.appendChild(timerText);
    timerGroup.appendChild(timerDisplay);
    this._titleTimerEl = timerText;

    if (!this._config.timed) {
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "h-9 flex items-center gap-2 equal-height-btn learnkit-btn-outline-muted";
      playBtn.setAttribute("aria-label", "Resume timer");
      playBtn.disabled = !this._untimedPaused;
      const playIconWrap = document.createElement("span");
      playIconWrap.className = "inline-flex items-center justify-center learnkit-btn-icon";
      setIcon(playIconWrap, "play");
      playBtn.appendChild(playIconWrap);
      playBtn.appendChild(Object.assign(document.createElement("span"), { textContent: "Resume" }));
      playBtn.addEventListener("click", () => {
        this._untimedPaused = false;
        playBtn.disabled = true;
        pauseBtn.disabled = false;
      });
      timerGroup.appendChild(playBtn);

      const pauseBtn = document.createElement("button");
      pauseBtn.type = "button";
      pauseBtn.className = "h-9 flex items-center gap-2 equal-height-btn learnkit-btn-outline-muted";
      pauseBtn.setAttribute("aria-label", "Pause timer");
      pauseBtn.disabled = this._untimedPaused;
      const pauseIconWrap = document.createElement("span");
      pauseIconWrap.className = "inline-flex items-center justify-center learnkit-btn-icon";
      setIcon(pauseIconWrap, "pause");
      pauseBtn.appendChild(pauseIconWrap);
      pauseBtn.appendChild(Object.assign(document.createElement("span"), { textContent: "Pause" }));
      pauseBtn.addEventListener("click", () => {
        this._untimedPaused = true;
        pauseBtn.disabled = true;
        playBtn.disabled = false;
      });
      timerGroup.appendChild(pauseBtn);
    }

    container.appendChild(timerGroup);
  }

  private _remainingSec(): number {
    if (!this._config.timed) return Number.POSITIVE_INFINITY;
    return Math.max(0, this._config.durationMinutes * 60 - this._elapsedSec);
  }

  private _renderExamRunner(host: HTMLElement): void {
    if (this._questions.length === 0) {
      this._mode = "setup";
      this._render();
      return;
    }

    const q = this._questions[this._currentIndex];
    const card = host.createDiv({ cls: "card learnkit-exam-generator-card learnkit-exam-generator-card" });

    // Auto-submit warning banner (shown when timed grace period is active)
    if (this._autoSubmitGrace !== null) {
      const banner = card.createDiv({ cls: "learnkit-exam-autosubmit-warning learnkit-exam-autosubmit-warning" });
      const messageEl = banner.createDiv({ cls: "learnkit-exam-autosubmit-message learnkit-exam-autosubmit-message" });
      messageEl.createEl("strong", { text: "Time's up! " });
      const countdownSpan = messageEl.createSpan({ text: String(this._autoSubmitGrace) });
      this._autoSubmitWarningCountdownEl = countdownSpan;
      messageEl.createSpan({ text: " seconds until auto-submit." });
      const actionsEl = banner.createDiv({ cls: "learnkit-exam-autosubmit-actions learnkit-exam-autosubmit-actions" });
      const extendBtn = actionsEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-8 inline-flex items-center gap-2",
        text: "Extend +5 min",
        attr: { type: "button" },
      });
      extendBtn.addEventListener("click", () => {
        this._clearAutoSubmitGrace();
        this._config.durationMinutes += 5;
        this._startTimer();
        this._render();
      });
      const cancelBtn = actionsEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-8 inline-flex items-center gap-2",
        text: "Cancel auto-submit",
        attr: { type: "button" },
      });
      cancelBtn.addEventListener("click", () => {
        this._clearAutoSubmitGrace();
        this._render();
      });
      const submitNowBtn = actionsEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent h-8 inline-flex items-center gap-2",
        text: "Submit now",
        attr: { type: "button" },
      });
      submitNowBtn.addEventListener("click", () => {
        this._clearAutoSubmitGrace();
        void this._submitExam(false);
      });
    }

    const top = card.createDiv({ cls: "learnkit-exam-generator-topline learnkit-exam-generator-topline" });
    top.createDiv({ text: `Question ${this._currentIndex + 1} of ${this._questions.length}` });

    const topRight = top.createDiv({ cls: "learnkit-exam-generator-topline-right learnkit-exam-generator-topline-right" });

    const quitBtn = topRight.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
      attr: { type: "button", "aria-label": this._coachScopePrefilled ? "Back to Coach" : "Quit test" },
    });
    quitBtn.setAttr("data-tooltip-position", "top");
    const quitIconWrap = quitBtn.createSpan({ cls: "inline-flex items-center justify-center" });
    setIcon(quitIconWrap, "x");
    quitBtn.addEventListener("click", () => {
      if (this._coachScopePrefilled) {
        void this.plugin.openCoachTab(false, { suppressEntranceAos: true, refresh: false }, this.leaf);
        return;
      }
      this._resetToSetup();
    });

    const promptEl = card.createEl("h3", { cls: "learnkit-exam-generator-question-prompt learnkit-exam-generator-question-prompt" });
    renderMarkdownPreviewInElement(promptEl, q.prompt);

    if (q.type === "mcq") {
      const options = q.options || [];
      const isMultiSelect = Array.isArray(q.correctIndices) && q.correctIndices.length > 1;
      const optionList = card.createDiv({ cls: "learnkit-mcq-options learnkit-mcq-options" });

      if (isMultiSelect) {
        // Multi-select: toggle each option independently
        const currentSelections: Set<number> = new Set(
          Array.isArray(this._answers.get(q.id)) ? (this._answers.get(q.id) as number[]) : [],
        );

        for (let i = 0; i < options.length; i += 1) {
          const btn = optionList.createEl("button", { cls: "learnkit-btn-toolbar learnkit-btn-toolbar w-full justify-start text-left h-auto py-2 mb-2", type: "button" });
          if (currentSelections.has(i)) btn.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
          const left = btn.createSpan({ cls: "inline-flex items-center gap-2 min-w-0" });
          left.createEl("kbd", { cls: "kbd", text: String(i + 1) });
          const optionText = left.createSpan({ cls: "min-w-0 whitespace-pre-wrap break-words learnkit-mcq-option-text learnkit-mcq-option-text" });
          renderMarkdownPreviewInElement(optionText, options[i]);
          btn.addEventListener("click", () => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) return;
            if (currentSelections.has(i)) {
              currentSelections.delete(i);
              btn.classList.remove("learnkit-mcq-selected", "learnkit-mcq-selected");
            } else {
              currentSelections.add(i);
              btn.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
            }
            this._answers.set(q.id, [...currentSelections].sort((a, b) => a - b));
          });
        }
      } else {
        // Single-select: exclusive selection
        const selected = this._answers.has(q.id) ? Number(this._answers.get(q.id)) : -1;

        for (let i = 0; i < options.length; i += 1) {
          const btn = optionList.createEl("button", { cls: "learnkit-btn-toolbar learnkit-btn-toolbar w-full justify-start text-left h-auto py-2 mb-2", type: "button" });
          if (selected === i) btn.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
          const left = btn.createSpan({ cls: "inline-flex items-center gap-2 min-w-0" });
          left.createEl("kbd", { cls: "kbd", text: String(i + 1) });
          const optionText = left.createSpan({ cls: "min-w-0 whitespace-pre-wrap break-words learnkit-mcq-option-text learnkit-mcq-option-text" });
          renderMarkdownPreviewInElement(optionText, options[i]);
          btn.addEventListener("click", () => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) return;
            this._answers.set(q.id, i);
            optionList.querySelectorAll(".learnkit-btn-toolbar").forEach((el) => el.classList.remove("learnkit-mcq-selected", "learnkit-mcq-selected"));
            btn.classList.add("learnkit-mcq-selected", "learnkit-mcq-selected");
          });
        }
      }
    } else {
      const area = card.createEl("textarea", {
        cls: "learnkit-exam-generator-textarea learnkit-exam-generator-textarea",
      });
      area.value = String(this._answers.get(q.id) || "");
      area.placeholder = "Write your answer...";
      area.addEventListener("input", () => {
        this._answers.set(q.id, area.value);
      });
    }

    const actions = card.createDiv({ cls: "learnkit-exam-generator-actions learnkit-exam-generator-actions" });
    const prev = actions.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2",
      attr: { type: "button", "aria-label": "Previous", "data-tooltip-position": "top" },
    });
    const prevIcon = prev.createSpan({ cls: "inline-flex items-center justify-center" });
    setIcon(prevIcon, "chevron-left");
    prev.createSpan({ cls: "", text: "Previous" });
    prev.disabled = this._currentIndex <= 0;
    prev.addEventListener("click", () => {
      this._currentIndex = Math.max(0, this._currentIndex - 1);
      this._render();
    });

    const isLastQuestion = this._currentIndex >= this._questions.length - 1;
    if (isLastQuestion) {
      const submit = actions.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent h-9 inline-flex items-center gap-2 learnkit-exam-generator-actions-advance learnkit-exam-generator-actions-advance",
        attr: { type: "button", "aria-label": "Submit exam", "data-tooltip-position": "top" },
      });
      submit.createSpan({ text: "Submit exam" });
      const submitIcon = submit.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-3.5" });
      setIcon(submitIcon, "arrow-right");
      submit.addEventListener("click", () => {
        void this._submitExam(false);
      });
    } else {
      const next = actions.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-exam-generator-actions-advance learnkit-exam-generator-actions-advance",
        attr: { type: "button", "aria-label": "Next", "data-tooltip-position": "top" },
      });
      next.createSpan({ text: "Next" });
      const nextIcon = next.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(nextIcon, "chevron-right");
      next.addEventListener("click", () => {
        this._currentIndex = Math.min(this._questions.length - 1, this._currentIndex + 1);
        this._render();
      });
    }
  }

  private async _submitExam(autoSubmitted: boolean): Promise<void> {
    if (this._submitted || this._mode !== "taking") return;
    this._submitted = true;
    this._autoSubmitted = autoSubmitted;
    this._stopTimer();
    this._clearAutoSubmitGrace();
    this._mode = "grading";
    this._render();

    let totalScore = 0;
    const totalPossible = this._questions.length * 100;
    const results: QuestionResult[] = [];

    for (const q of this._questions) {
      const rawAnswer = this._answers.get(q.id);
      if (q.type === "mcq") {
        const isMultiSelect = Array.isArray(q.correctIndices) && q.correctIndices.length > 1;

        if (isMultiSelect) {
          // Multi-select MCQ: proportional marking
          const correctSet = new Set(q.correctIndices);
          const selectedArr = Array.isArray(rawAnswer) ? rawAnswer : [];
          const selectedSet = new Set(selectedArr);
          const totalCorrect = correctSet.size;
          let hits = 0;
          let penalties = 0;
          for (const s of selectedSet) {
            if (correctSet.has(s)) hits += 1;
            else penalties += 1;
          }
          // Proportional: each correct selection earns 1/totalCorrect, each incorrect selection deducts 1/totalCorrect, floor 0
          const score = Math.max(0, Math.round(((hits - penalties) / totalCorrect) * 100));
          const correct = score === 100;
          const expectedOptions = (q.correctIndices ?? []).map((i) => q.options?.[i] || "").filter(Boolean);
          const userOptions = selectedArr.map((i) => q.options?.[i] || "").filter(Boolean);
          totalScore += score;
          results.push({
            questionId: q.id,
            prompt: q.prompt,
            questionType: "mcq",
            scorePercent: score,
            feedback: correct ? "Correct" : hits > 0 ? "Partly correct" : "Incorrect",
            correct,
            userAnswer: userOptions.join("; ") || "(none selected)",
            expectedAnswer: expectedOptions.join("; "),
          });
        } else {
          // Single-select MCQ: binary marking
          const selected = typeof rawAnswer === "number" ? rawAnswer : -1;
          const correct = selected === Number(q.correctIndex);
          const score = correct ? 100 : 0;
          const expected = q.options?.[Number(q.correctIndex)] || "";
          const user = selected >= 0 && q.options?.[selected] ? q.options[selected] : "";
          totalScore += score;
          results.push({
            questionId: q.id,
            prompt: q.prompt,
            questionType: "mcq",
            scorePercent: score,
            feedback: correct ? "Correct" : "Incorrect",
            correct,
            userAnswer: user,
            expectedAnswer: expected,
          });
        }
      } else {
        const answerText = String(rawAnswer || "").trim();
        if (!answerText) {
          results.push({
            questionId: q.id,
            prompt: q.prompt,
            questionType: "saq",
            scorePercent: 0,
            feedback: "No answer submitted.",
            userAnswer: "",
            expectedAnswer: (q.markingGuide || []).join("; "),
            saq: {
              scorePercent: 0,
              feedback: "No answer submitted.",
              keyPointsMet: [],
              keyPointsMissed: q.markingGuide || [],
            },
          });
          continue;
        }

        try {
          const saq = await gradeSaqAnswer({
            settings: this.plugin.settings.studyAssistant,
            questionPrompt: q.prompt,
            markingGuide: q.markingGuide || [],
            userAnswer: answerText,
            difficulty: this._config.difficulty,
            appliedScenarios: this._config.appliedScenarios,
          });
          totalScore += saq.scorePercent;
          results.push({
            questionId: q.id,
            prompt: q.prompt,
            questionType: "saq",
            scorePercent: saq.scorePercent,
            feedback: saq.feedback,
            userAnswer: answerText,
            expectedAnswer: (q.markingGuide || []).join("; "),
            saq,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : (typeof err === "string" ? err : "Failed to grade");
          results.push({
            questionId: q.id,
            prompt: q.prompt,
            questionType: "saq",
            scorePercent: 0,
            feedback: `AI grading failed: ${message}`,
            userAnswer: answerText,
            expectedAnswer: (q.markingGuide || []).join("; "),
          });
        }
      }
    }

    const percent = totalPossible > 0 ? (totalScore / totalPossible) * 100 : 0;
    this._questionResults = results;
    this._finalPercent = Math.round(percent * 10) / 10;
    this._persistAttempt();
    this._savedTests = this._testsDb?.listTests(25) ?? [];
    this._mode = "results";
    this._render();
  }

  private _renderGrading(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card learnkit-exam-generator-card learnkit-exam-generator-card learnkit-exam-generator-card-loading learnkit-exam-generator-card-loading" });
    const center = card.createDiv({ cls: "learnkit-exam-generator-loading-center learnkit-exam-generator-loading-center" });

    const loader = center.createDiv({ cls: "learnkit-exam-generator-loading-loader learnkit-exam-generator-loading-loader" });
    const firstSlot = loader.createSpan({ cls: "learnkit-exam-generator-loading-word-slot learnkit-exam-generator-loading-word-slot is-first" });
    const secondSlot = loader.createSpan({ cls: "learnkit-exam-generator-loading-word-slot learnkit-exam-generator-loading-word-slot is-second" });
    const firstCurrent = firstSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word current", text: "" });
    const firstNext = firstSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word next", text: "" });
    const secondCurrent = secondSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word current", text: "" });
    const secondNext = secondSlot.createSpan({ cls: "learnkit-exam-generator-loading-word learnkit-exam-generator-loading-word next", text: "" });

    const gradingPairs: Array<[string, string]> = [
      ["Scoring", "Answers"],
      ["Checking", "Reasoning"],
      ["Reviewing", "Evidence"],
      ["Validating", "Concepts"],
      ["Measuring", "Accuracy"],
      ["Comparing", "Criteria"],
      ["Marking", "Responses"],
      ["Finalizing", "Grades"],
    ];

    const SWAP_MS = 420;
    const HOLD_MS = 900;
    const STEP_MS = SWAP_MS + HOLD_MS;

    this._startLoadingWordSwapAnimation({
      mode: "grading",
      loadingPairs: gradingPairs,
      firstSlot,
      secondSlot,
      firstCurrent,
      firstNext,
      secondCurrent,
      secondNext,
      swapMs: SWAP_MS,
      stepMs: STEP_MS,
      fallbackPair: ["Marking", "Answers"],
    });
  }

  private _renderResults(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card learnkit-exam-generator-card learnkit-exam-generator-card" });
    const score = this._finalPercent == null ? "0" : `${this._finalPercent.toFixed(1)}%`;

    const resultsHeader = card.createDiv({ cls: "learnkit-exam-generator-results-header learnkit-exam-generator-results-header" });
    resultsHeader.createEl("h3", { text: `Final score: ${score}` });

    if (this._autoSubmitted) {
      card.createDiv({ cls: "learnkit-settings-text-muted learnkit-settings-text-muted", text: "Timed exam auto-submitted when the timer reached zero." });
    }

    const list = card.createDiv({ cls: "learnkit-exam-generator-results learnkit-exam-generator-results" });
    for (let i = 0; i < this._questions.length; i += 1) {
      const q = this._questions[i];
      const r = this._questionResults.find((item) => item.questionId === q.id);
      const row = list.createDiv({ cls: "learnkit-exam-generator-result-row learnkit-exam-generator-result-row" });
      const scorePercent = Math.round(r?.scorePercent ?? 0);
      const scoreTone = scorePercent > 80 ? "is-strong" : scorePercent >= 50 ? "is-mid" : "is-weak";
      const status = scorePercent > 80 ? "Correct" : scorePercent >= 50 ? "Partly correct" : "Wrong";

      const header = row.createDiv({ cls: "learnkit-exam-generator-result-header learnkit-exam-generator-result-header" });
      header.createDiv({ cls: "learnkit-exam-generator-result-title learnkit-exam-generator-result-title", text: `Question ${i + 1}:` });
      header.createDiv({
        cls: `learnkit-exam-generator-result-score ${scoreTone}`,
        text: `${scorePercent}%`,
      });

      const body = row.createDiv({ cls: "learnkit-exam-generator-result-body learnkit-exam-generator-result-body" });
      body.createDiv({ cls: "learnkit-exam-generator-result-detail learnkit-exam-generator-result-detail", text: status });
    }

    const actions = card.createDiv({ cls: "learnkit-exam-generator-actions learnkit-exam-generator-actions" });
    const review = actions.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
      text: "Review mistakes",
    });
    review.setAttribute("aria-label", "Review mistakes");
    review.setAttribute("data-tooltip-position", "top");
    review.disabled = !this._questionResults.some((r) => (r.scorePercent ?? 0) < 100);
    review.addEventListener("click", () => {
      this._reviewWrongOnly = true;
      this._mode = "review";
      this._render();
    });

    const reviewAll = actions.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
      text: "Review all answers",
    });
    reviewAll.setAttribute("aria-label", "Review all answers");
    reviewAll.setAttribute("data-tooltip-position", "top");
    reviewAll.addEventListener("click", () => {
      this._reviewWrongOnly = false;
      this._mode = "review";
      this._render();
    });

    const setup = actions.createEl("button", {
      cls: "learnkit-btn-accent learnkit-btn-accent inline-flex items-center gap-2 learnkit-exam-generator-saved-tests-btn learnkit-exam-generator-saved-tests-btn learnkit-exam-generator-actions-advance learnkit-exam-generator-actions-advance",
      text: "Back to tests",
    });
    setup.setAttribute("aria-label", "Back to tests");
    setup.setAttribute("data-tooltip-position", "top");
    const setupIcon = setup.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-3.5" });
    setIcon(setupIcon, "clipboard-check");
    setup.insertBefore(setupIcon, setup.firstChild);
    setup.addEventListener("click", () => {
      this._resetToSetup();
    });
  }

  private _renderReview(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card learnkit-exam-generator-card learnkit-exam-generator-card" });
    card.createEl("h3", {
      cls: "learnkit-exam-generator-review-title learnkit-exam-generator-review-title",
      text: this._reviewWrongOnly ? "Review mistakes" : "Review all answers",
    });

    const rows = this._questionResults
      .map((result, i) => ({ result, index: i }))
      .filter(({ result }) => (this._reviewWrongOnly ? result.scorePercent < 100 : true));

    if (rows.length === 0) {
      card.createDiv({ cls: "learnkit-settings-text-muted learnkit-settings-text-muted", text: "No mistakes to review." });
    } else {
      const list = card.createDiv({ cls: "learnkit-exam-generator-results learnkit-exam-generator-results" });
      for (const { result, index } of rows) {
        const row = list.createDiv({ cls: "learnkit-exam-generator-result-row learnkit-exam-generator-result-row" });
        const scorePercent = Math.round(result.scorePercent);
        const scoreTone = scorePercent > 80 ? "is-strong" : scorePercent >= 50 ? "is-mid" : "is-weak";

        const header = row.createDiv({ cls: "learnkit-exam-generator-result-header learnkit-exam-generator-result-header" });
        header.createDiv({ cls: "learnkit-exam-generator-result-title learnkit-exam-generator-result-title", text: `Question ${index + 1}:` });
        header.createDiv({
          cls: `learnkit-exam-generator-result-score ${scoreTone}`,
          text: `${scorePercent}%`,
        });

        const body = row.createDiv({ cls: "learnkit-exam-generator-result-body learnkit-exam-generator-result-body" });
        const prompt = body.createDiv({ cls: "learnkit-exam-generator-result-prompt learnkit-exam-generator-result-prompt" });
        renderMarkdownPreviewInElement(prompt, result.prompt);

        const userAnswerLine = body.createDiv({ cls: "learnkit-exam-generator-result-detail learnkit-exam-generator-result-detail" });
        userAnswerLine.createEl("strong", { text: "Your answer: " });
        const userAnswerValue = userAnswerLine.createSpan();
        renderMarkdownPreviewInElement(userAnswerValue, result.userAnswer?.trim() || "(blank)");

        const expectedLine = body.createDiv({ cls: "learnkit-exam-generator-result-detail learnkit-exam-generator-result-detail" });
        const expectedLabel = result.questionType === "mcq" ? "Correct option: " : "Model answer: ";
        expectedLine.createEl("strong", { text: expectedLabel });
        const expectedValue = expectedLine.createSpan();
        renderMarkdownPreviewInElement(expectedValue, this._formatModelAnswer(result.expectedAnswer));

        const feedback = result.feedback?.trim();
        if (feedback) {
          const statusOnly = feedback === "Correct" || feedback === "Partly correct" || feedback === "Incorrect" || feedback === "Wrong";
          if (!statusOnly) {
            const feedbackLine = body.createDiv({ cls: "learnkit-exam-generator-result-feedback learnkit-exam-generator-result-feedback" });
            feedbackLine.createEl("strong", { text: "Feedback: " });
            const feedbackValue = feedbackLine.createSpan();
            renderMarkdownPreviewInElement(feedbackValue, feedback);
          }
        }

        // SAQ key-point breakdown: wrong, missed
        if (result.saq) {
          const wrongPoints = result.saq.keyPointsWrong ?? [];
          const missedPoints = result.saq.keyPointsMissed ?? [];
          if (wrongPoints.length > 0) {
            const wrongSection = body.createDiv({ cls: "learnkit-exam-generator-result-missed learnkit-exam-generator-result-missed" });
            wrongSection.createDiv({ cls: "learnkit-exam-generator-result-missed-label learnkit-exam-generator-result-missed-label", text: "Incorrect" });
            const wrongList = wrongSection.createEl("ul", { cls: "learnkit-exam-generator-result-missed-list learnkit-exam-generator-result-missed-list" });
            for (const point of wrongPoints) {
              wrongList.createEl("li", { text: point });
            }
          }
          if (missedPoints.length > 0) {
            const missedSection = body.createDiv({ cls: "learnkit-exam-generator-result-missed learnkit-exam-generator-result-missed" });
            missedSection.createDiv({ cls: "learnkit-exam-generator-result-missed-label learnkit-exam-generator-result-missed-label", text: "Missed" });
            const missedList = missedSection.createEl("ul", { cls: "learnkit-exam-generator-result-missed-list learnkit-exam-generator-result-missed-list" });
            for (const point of missedPoints) {
              missedList.createEl("li", { text: point });
            }
          }
        }

      }
    }

    const actions = card.createDiv({ cls: "learnkit-exam-generator-actions learnkit-exam-generator-actions" });
    const back = actions.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn",
      text: "Back to results",
    });
    back.setAttribute("aria-label", "Back to results");
    back.setAttribute("data-tooltip-position", "top");
    back.addEventListener("click", () => {
      this._mode = "results";
      this._render();
    });
    const setup = actions.createEl("button", {
      cls: "learnkit-btn-accent learnkit-btn-accent inline-flex items-center gap-2 learnkit-exam-generator-saved-tests-btn learnkit-exam-generator-saved-tests-btn learnkit-exam-generator-actions-advance learnkit-exam-generator-actions-advance",
      text: "Back to tests",
    });
    setup.setAttribute("aria-label", "Back to tests");
    setup.setAttribute("data-tooltip-position", "top");
    const setupIcon = setup.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-3.5" });
    setIcon(setupIcon, "clipboard-check");
    setup.insertBefore(setupIcon, setup.firstChild);
    setup.addEventListener("click", () => {
      this._resetToSetup();
    });
  }

  private _formatModelAnswer(raw: string | null | undefined): string {
    const source = String(raw || "").trim();
    if (!source) return "(not provided)";

    const chunks = source
      .split(";")
      .map((part) => part.trim())
      .map((part) => part.replace(/\.+$/g, "").trim())
      .filter(Boolean);

    if (chunks.length <= 1) return source;

    const normalized = chunks.map((part) => part.replace(/^lists?\s+/i, "").trim());
    const joined = normalized.length === 2
      ? `${normalized[0]} and ${normalized[1]}`
      : `${normalized.slice(0, -1).join(", ")}, and ${normalized[normalized.length - 1]}`;

    return `The model answer includes ${joined}.`;
  }

  private _formatTime(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const min = Math.floor(safe / 60);
    const sec = safe % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  private _persistGeneratedTest(notes: Array<{ path: string; title: string; content: string }>): string | null {
    if (!this._testsDb) return null;
    const customName = this._config.testName.trim();
    const diffLabel = this._config.difficulty.charAt(0).toUpperCase() + this._config.difficulty.slice(1).toLowerCase();
    const label = customName || `${diffLabel} test - ${new Date().toLocaleString()}`;
    try {
      const id = this._testsDb.saveTest({
        label,
        sourceSummary: notes.map((n) => n.path).slice(0, 3).join(", "),
        configJson: JSON.stringify(this._config),
        questionsJson: JSON.stringify(this._questions),
      });
      void this._testsDb.persist();
      this._savedTests = this._testsDb.listTests(25);
      return id;
    } catch {
      return null;
    }
  }

  private _persistAttempt(): void {
    if (!this._testsDb || !this._activeTestId || this._finalPercent == null) return;
    try {
      const attemptId = this._testsDb.saveAttempt({
        testId: this._activeTestId,
        finalPercent: this._finalPercent,
        autoSubmitted: this._autoSubmitted,
        answersJson: JSON.stringify(Object.fromEntries(this._answers.entries())),
        resultsJson: JSON.stringify({ results: this._questionResults, elapsedSec: this._elapsedSec }),
      });
      const mcqCount = this._questionResults.filter((row) => row.questionType === "mcq").length;
      const saqCount = this._questionResults.filter((row) => row.questionType === "saq").length;
      this.plugin.store.appendAnalyticsExamAttempt({
        at: Date.now(),
        testId: this._activeTestId,
        attemptId,
        label: this._testsDb.getTest(this._activeTestId)?.label,
        sourceSummary: this._testsDb.getTest(this._activeTestId)?.sourceSummary,
        finalPercent: this._finalPercent,
        autoSubmitted: this._autoSubmitted,
        elapsedSec: this._elapsedSec,
        mcqCount,
        saqCount,
      });
      void this._testsDb.persist();
    } catch {
      // Ignore persistence failures to avoid blocking the test flow.
    }
  }

  private _loadSavedTest(id: string): void {
    const saved = this._testsDb?.getTest(id);
    if (!saved) {
      new Notice("Saved test no longer exists.");
      return;
    }
    let parsedConfig: Partial<ExamGeneratorConfig> = {};
    let parsedQuestions: GeneratedExamQuestion[] = [];
    try {
      parsedConfig = JSON.parse(saved.configJson || "{}") as Partial<ExamGeneratorConfig>;
    } catch {
      parsedConfig = {};
    }
    try {
      const q = JSON.parse(saved.questionsJson || "[]") as GeneratedExamQuestion[];
      parsedQuestions = Array.isArray(q) ? q : [];
    } catch {
      parsedQuestions = [];
    }
    this._config = {
      ...this._config,
      ...parsedConfig,
      testName: String(parsedConfig?.testName || saved.label || ""),
      appliedScenarios: Boolean(parsedConfig?.appliedScenarios ?? false),
      customInstructions: String(parsedConfig?.customInstructions || ""),
      includeFlashcards: Boolean(parsedConfig?.includeFlashcards ?? false),
      sourceMode: parsedConfig?.sourceMode === "folder" ? "folder" : "selected",
      folderPath: String(parsedConfig?.folderPath || ""),
      includeSubfolders: Boolean(parsedConfig?.includeSubfolders ?? true),
      maxFolderNotes: Math.max(1, Number(parsedConfig?.maxFolderNotes || DEFAULT_MAX_FOLDER_NOTES)),
    };
    this._questions = parsedQuestions;
    this._answers.clear();
    this._questionResults = [];
    this._currentIndex = 0;
    this._finalPercent = null;
    this._submitted = false;
    this._autoSubmitted = false;
    this._elapsedSec = 0;
    this._examStartMs = Date.now();
    this._activeTestId = saved.testId;
    this._mode = "taking";
    this._startTimer();
    this._render();
  }

  private async _deleteSavedTest(id: string): Promise<boolean> {
    if (!this._testsDb) return false;
    try {
      const deleted = this._testsDb.deleteTest(id);
      if (!deleted) {
        new Notice("Saved test no longer exists.");
        return false;
      }
      await this._testsDb.persist();
      if (this._activeTestId === id) this._activeTestId = null;
      this._savedTests = this._testsDb.listTests(25);
      this._savedTestsSearchQuery = this._savedTestsSearchQuery.trim();
      return true;
    } catch {
      new Notice("Failed to delete saved test.");
      return false;
    }
  }

  private _resetToSetup(): void {
    this._stopTimer();
    this._clearAutoSubmitGrace();
    this._mode = "setup";
    this._setupStage = "source";
    this._questions = [];
    this._answers.clear();
    this._questionResults = [];
    this._currentIndex = 0;
    this._finalPercent = null;
    this._submitted = false;
    this._autoSubmitted = false;
    this._activeTestId = null;
    this._savedTests = this._testsDb?.listTests(25) ?? this._savedTests;
    this._render();
  }
}

// ---------------------------------------------------------------------------
//  ExamAttachmentPickerModal – file picker for exam attachments
// ---------------------------------------------------------------------------
import { Modal } from "obsidian";

class ExamAttachmentPickerModal extends Modal {
  private _files: TFile[];
  private _onPick: (file: TFile) => void;
  private _onPickExternal: (attached: AttachedFile) => void;
  private _filteredFiles: TFile[] = [];
  private _listEl: HTMLDivElement | null = null;
  private _selectedFilePath: string | null = null;
  private _addBtnEl: HTMLButtonElement | null = null;

  constructor(
    app: InstanceType<typeof Modal>["app"],
    files: TFile[],
    onPick: (file: TFile) => void,
    onPickExternal: (attached: AttachedFile) => void,
  ) {
    super(app);
    this._files = files.sort((a, b) => a.path.localeCompare(b.path));
    this._onPick = onPick;
    this._onPickExternal = onPickExternal;
    this._filteredFiles = [...this._files];
  }

  onOpen(): void {
    this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "learnkit", "mod-dim");
    this.modalEl.addClass("lk-modals", "learnkit-attachment-picker");
    scopeModalToWorkspace(this);

    const headerEl = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header");
    if (headerEl) {
      const titleEl = headerEl.querySelector<HTMLElement>(":scope > .modal-title");
      if (titleEl) titleEl.setText("Add attachment");

      const existingCloseBtn = headerEl.querySelector<HTMLElement>(":scope > .learnkit-attachment-picker-close-btn");
      if (existingCloseBtn) existingCloseBtn.remove();

      const closeBtn = headerEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn learnkit-attachment-picker-close-btn learnkit-attachment-picker-close-btn",
        attr: { type: "button", "aria-label": "Close" },
      });
      closeBtn.setAttr("data-tooltip-position", "top");
      const closeIconWrap = closeBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(closeIconWrap, "x");
      closeBtn.addEventListener("click", () => this.close());
    }

    const legacyCloseBtn = this.modalEl.querySelector<HTMLElement>(":scope > .modal-close-button");
    if (legacyCloseBtn) legacyCloseBtn.remove();

    const existingFooter = this.modalEl.querySelector<HTMLElement>(":scope > .learnkit-attachment-picker-footer");
    if (existingFooter) existingFooter.remove();

    const root = this.contentEl.createDiv({ cls: "learnkit-attachment-picker-root learnkit-attachment-picker-root" });
    const body = root.createDiv({ cls: "learnkit-attachment-picker-body learnkit-attachment-picker-body" });

    // ---- "Choose from computer" button ----
    const systemBtn = body.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-attachment-picker-system-btn learnkit-attachment-picker-system-btn",
      text: "Choose from computer",
    });
    setIcon(systemBtn.createSpan({ cls: "learnkit-attachment-picker-system-icon learnkit-attachment-picker-system-icon" }), "hard-drive");
    systemBtn.addEventListener("click", () => this._pickSystemFile());

    // ---- Divider ----
    body.createEl("div", { cls: "learnkit-attachment-picker-divider learnkit-attachment-picker-divider", text: "Or choose from vault" });

    const search = body.createEl("input", {
      cls: "input w-full learnkit-attachment-picker-search learnkit-attachment-picker-search",
      attr: { type: "text", placeholder: "Search vault files..." },
    });

    this._listEl = body.createDiv({ cls: "learnkit-attachment-picker-list learnkit-attachment-picker-list" });
    this._renderList();

    search.addEventListener("input", () => {
      const q = search.value.toLowerCase().trim();
      this._filteredFiles = q
        ? this._files.filter(f => f.path.toLowerCase().includes(q))
        : [...this._files];
      this._renderList();
    });

    const footer = this.modalEl.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer learnkit-attachment-picker-footer learnkit-attachment-picker-footer" });

    const cancelBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": "Cancel" },
    });
    cancelBtn.setAttr("data-tooltip-position", "top");
    const cancelIcon = cancelBtn.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(cancelIcon, "x");
    cancelBtn.createSpan({ text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const addBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent h-9 inline-flex items-center gap-2",
      attr: { type: "button", "aria-label": "Add selected attachment" },
    });
    addBtn.setAttr("data-tooltip-position", "top");
    const addIcon = addBtn.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(addIcon, "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.disabled = true;
    addBtn.addEventListener("click", () => this._submitSelectedVaultFile());
    this._addBtnEl = addBtn;

    search.focus();
  }

  onClose(): void {
    this.containerEl.removeClass("lk-modal-container", "lk-modal-dim", "learnkit", "mod-dim");
    this.modalEl.removeClass("lk-modals", "learnkit-attachment-picker");
    const footerEl = this.modalEl.querySelector<HTMLElement>(":scope > .learnkit-attachment-picker-footer");
    if (footerEl) footerEl.remove();
    const closeBtn = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header .learnkit-attachment-picker-close-btn");
    if (closeBtn) closeBtn.remove();
    this.contentEl.empty();
    this._addBtnEl = null;
    this._listEl = null;
    this._selectedFilePath = null;
  }

  private _pickSystemFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = SUPPORTED_FILE_ACCEPT;
    setCssProps(input, "display", "none");
    input.addEventListener("change", () => {
      void (async () => {
        const files = Array.from(input.files ?? []);
        if (!files.length) return;

        let rejectedCount = 0;
        for (const file of files) {
          const attached = await readFileInputAsAttachment(file);
          if (!attached) {
            rejectedCount += 1;
            continue;
          }
          this._onPickExternal(attached);
        }

        if (rejectedCount > 0) {
          new Notice(rejectedCount === 1 ? "1 file was unsupported or too large." : `${rejectedCount} files were unsupported or too large.`);
        }
        this.close();
      })();
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  private _renderList(): void {
    if (!this._listEl) return;
    this._listEl.empty();
    const max = 100;
    const shown = this._filteredFiles.slice(0, max);
    for (const file of shown) {
      const item = this._listEl.createDiv({ cls: "learnkit-attachment-picker-item learnkit-attachment-picker-item" });
      if (file.path === this._selectedFilePath) item.addClass("is-selected");
      item.createSpan({ text: file.path });
      item.addEventListener("click", () => {
        this._selectedFilePath = file.path;
        this._syncSelectionState();
        this._renderList();
      });
      item.addEventListener("dblclick", () => {
        this._selectedFilePath = file.path;
        this._submitSelectedVaultFile();
      });
    }
    if (this._filteredFiles.length > max) {
      this._listEl.createDiv({
        cls: "learnkit-attachment-picker-overflow learnkit-attachment-picker-overflow",
        text: `… and ${this._filteredFiles.length - max} more`,
      });
    }
    if (!shown.length) {
      this._listEl.createDiv({
        cls: "learnkit-attachment-picker-empty learnkit-attachment-picker-empty",
        text: "No matching files",
      });
    }

    this._syncSelectionState();
  }

  private _syncSelectionState(): void {
    if (!this._addBtnEl) return;
    this._addBtnEl.disabled = !this._selectedFilePath;
  }

  private _submitSelectedVaultFile(): void {
    if (!this._selectedFilePath) return;
    const selected = this._files.find((file) => file.path === this._selectedFilePath);
    if (!selected) {
      new Notice("Selected file is no longer available.");
      this._selectedFilePath = null;
      this._syncSelectionState();
      this._renderList();
      return;
    }

    this._onPick(selected);
    this.close();
  }
}
