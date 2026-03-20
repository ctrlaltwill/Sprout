import { ItemView, Notice, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import { createViewHeader, type SproutHeader } from "../../platform/core/header";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_EXAM_GENERATOR } from "../../platform/core/constants";
import { setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { ExamTestsSqlite, type SavedExamTestSummary } from "../../platform/core/exam-tests-sqlite";
import { initAOS } from "../../platform/core/aos-loader";
import type SproutPlugin from "../../main";
import { t } from "../../platform/translations/translator";
import type { Scope } from "../reviewer/types";
import {
  generateExamQuestions,
  gradeSaqAnswer,
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
import { mountSearchPopoverList, type SearchPopoverOption } from "../shared/search-popover-list";
import { collectVaultTagAndPropertyPairs, decodePropertyPair, extractFilePropertyPairs, extractFileTags } from "../shared/scope-metadata";
import { formatAttachmentChipLabel } from "../shared/attachment-chip-label";

type ExamViewMode = "setup" | "generating" | "taking" | "grading" | "results" | "review";

type SetupStage = "source" | "config";

type StoredAnswer = string | number;

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
  plugin: SproutPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  private _testsDb: ExamTestsSqlite | null = null;
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

  private _config: ExamGeneratorConfig = {
    difficulty: "medium",
    questionMode: "mixed",
    questionCount: 5,
    timed: false,
    durationMinutes: 20,
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

  private _finalPercent: number | null = null;
  private _reviewWrongOnly = true;

  private _attachedFiles: AttachedFile[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
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
    this.containerEl.addClass("sprout");

    this._rootEl = this.contentEl.createDiv({
      cls: "bc sprout-view-content sprout-exam-generator-root flex flex-col min-h-0",
    });

    this._header = createViewHeader({
      view: this,
      plugin: this.plugin,
      onToggleWide: () => this._applyMaxWidth(),
    });
    this._header.install("exam");
    this._testsDb = new ExamTestsSqlite(this.plugin);
    await this._testsDb.open();
    this._savedTests = this._testsDb.listTests(25);

    this._reloadNotes();
    this._applyMaxWidth();
    this._render();
  }

  async onClose(): Promise<void> {
    this._stopTimer();
    this._clearAutoSubmitGrace();
    this._savedTestsPopoverCleanup?.();
    this._savedTestsPopoverCleanup = null;
    if (this._testsDb) {
      await this._testsDb.close();
      this._testsDb = null;
    }
    this._header?.dispose();
    this._header = null;
    this._rootEl = null;
  }

  onRefresh(): void {
    this._reloadNotes();
    this._savedTests = this._testsDb?.listTests(25) ?? [];
    this._render();
  }

  setCoachScope(scope: Scope | null): void {
    if (!scope) return;
    this._applyCoachScope(scope);
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
    setCssProps(this._rootEl, "--sprout-exam-generator-max-width", maxWidth);
  }

  private _applyCoachScope(scope: Scope): void {
    this._reloadNotes();

    this._mode = "setup";
    this._setupStage = "source";
    this._noteSearchQuery = "";
    this._folderPreviewExpanded = false;
    this._selectedPaths.clear();
    this._selectedFolders.clear();
    this._selectedVault = false;
    this._selectedTags.clear();
    this._selectedProperties.clear();

    if (scope.type === "vault") {
      this._config.sourceMode = "folder";
      this._config.folderPath = "";
      this._config.includeSubfolders = true;
      this._render();
      return;
    }

    if (scope.type === "folder") {
      this._config.sourceMode = "folder";
      this._config.folderPath = String(scope.key || "");
      this._config.includeSubfolders = true;
      this._render();
      return;
    }

    this._config.sourceMode = "selected";

    if (scope.type === "note") {
      this._selectedPaths.add(String(scope.key || ""));
      this._render();
      return;
    }

    if (scope.type === "tag") {
      this._selectedTags.add(String(scope.key || "").trim().toLowerCase().replace(/^#+/, ""));
      this._render();
      return;
    }

    if (scope.type === "property") {
      this._selectedProperties.add(String(scope.key || "").trim());
      this._render();
      return;
    }

    const groupPaths = new Set<string>();
    for (const card of this.plugin.store.getAllCards()) {
      const groups = Array.isArray(card.groups) ? card.groups : [];
      if (!groups.some((g) => String(g || "") === scope.key)) continue;
      const path = String(card.sourceNotePath || "").trim();
      if (path) groupPaths.add(path);
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
    this._timerTextEl = null;
    this._titleTimerEl = null;
    this._autoSubmitWarningCountdownEl = null;
    this._savedTestsPopoverCleanup?.();
    this._savedTestsPopoverCleanup = null;
    this._rootEl.empty();

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;

    const titleFrame = createTitleStripFrame({
      root: this._rootEl,
      stripClassName: "lk-home-title-strip sprout-exam-generator-title-strip",
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
    titleFrame.title.textContent = "Tests";
    titleFrame.subtitle.classList.add("flex", "items-center", "gap-1", "min-w-0");
    titleFrame.subtitle.textContent = this._tx(
      "ui.view.examGenerator.subtitle",
      "Generate focused tests from your notes and track your progress with every retake.",
    );

    const savedTestsWrap = document.createElement("div");
    savedTestsWrap.className = "sprout-exam-generator-saved-tests-wrap";

    const savedTestsBtn = document.createElement("button");
    savedTestsBtn.className = "bc sprout-btn-accent inline-flex items-center gap-2 sprout-exam-generator-saved-tests-btn";
    savedTestsBtn.type = "button";
    savedTestsBtn.setAttribute("aria-label", "Saved tests");
    savedTestsBtn.createSpan({ text: "Saved tests" });
    const chevronWrap = savedTestsBtn.createSpan({
      cls: "sprout-exam-generator-saved-tests-chevron inline-flex items-center justify-center [&_svg]:size-3.5",
    });
    setIcon(chevronWrap, "chevron-down");

    const savedTestsPanel = savedTestsWrap.createDiv({
      cls: "sprout-popover-dropdown sprout-popover-dropdown-below sprout-exam-generator-saved-tests-popover",
    });
    const panel = savedTestsPanel.createDiv({ cls: "bc rounded-md border border-border bg-popover text-popover-foreground p-1 flex flex-col sprout-pointer-auto sprout-exam-generator-saved-tests-panel" });
    const searchWrap = panel.createDiv({ cls: "sprout-exam-generator-saved-tests-search-wrap" });
    const searchIcon = searchWrap.createSpan({ cls: "sprout-exam-generator-saved-tests-search-icon" });
    setIcon(searchIcon, "search");
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "bc input h-9 sprout-exam-generator-saved-tests-search",
      attr: { placeholder: "Search saved tests", autocomplete: "off", spellcheck: "false" },
    });
    searchInput.value = this._savedTestsSearchQuery;
    const savedList = panel.createDiv({ cls: "bc flex flex-col max-h-60 overflow-auto sprout-exam-generator-saved-tests-list" });
    savedList.setAttr("role", "listbox");

    savedTestsBtn.setAttribute("aria-haspopup", "dialog");
    savedTestsBtn.setAttribute("aria-expanded", this._savedTestsPopoverOpen ? "true" : "false");

    const formatSavedDate = (timestamp: number): string => {
      const d = new Date(timestamp);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = String(d.getFullYear()).slice(-2);
      return `${day}/${month}/${year}`;
    };

    const filteredSavedTests = () => {
      const q = this._savedTestsSearchQuery.trim().toLowerCase();
      if (!q) return this._savedTests;
      return this._savedTests.filter((test) => {
        const label = (test.label || "").toLowerCase();
        const createdAt = formatSavedDate(test.createdAt).toLowerCase();
        const questionCount = String(test.questionCount || "");
        return label.includes(q) || createdAt.includes(q) || questionCount.includes(q);
      });
    };

    const renderSavedTestsList = () => {
      savedList.empty();
      const results = filteredSavedTests();
      if (results.length === 0) {
        const emptyMsg = savedList.createDiv({ cls: "px-2 py-2 text-sm sprout-settings-text-muted" });
        if (this._savedTests.length === 0) {
          emptyMsg.createDiv({ text: "No saved tests yet." });
          emptyMsg.createDiv({ cls: "mt-1", text: "Generate a test and it will be saved here automatically." });
        } else {
          emptyMsg.textContent = "No saved tests match your search.";
        }
        return;
      }
      for (const test of results) {
        const row = savedList.createDiv({
          cls: "sprout-exam-generator-saved-tests-item",
        });
        row.setAttr("role", "option");
        const lineBtn = row.createEl("button", {
          cls: "bc sprout-exam-generator-saved-tests-line",
          attr: { type: "button" },
        });
        lineBtn.createSpan({
          cls: "sprout-exam-generator-saved-tests-line-text",
          text: `${test.label || "Saved test"} . ${formatSavedDate(test.createdAt)}`,
        });
        lineBtn.addEventListener("click", () => {
          this._savedTestsPopoverOpen = false;
          this._savedTestsSearchQuery = "";
          this._loadSavedTest(test.testId);
        });

        const deleteBtn = row.createEl("button", {
          cls: "bc sprout-exam-generator-saved-tests-delete",
          attr: { type: "button", "aria-label": `Delete ${test.label || "saved test"}` },
        });
        setIcon(deleteBtn, "x");
        deleteBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void this._deleteSavedTest(test.testId);
        });
      }
    };

    const syncSavedPopoverState = () => {
      savedTestsPanel.toggleClass("is-open", this._savedTestsPopoverOpen);
      savedTestsPanel.setAttr("aria-hidden", this._savedTestsPopoverOpen ? "false" : "true");
      savedTestsBtn.setAttribute("aria-expanded", this._savedTestsPopoverOpen ? "true" : "false");
      chevronWrap.classList.toggle("is-open", this._savedTestsPopoverOpen);
      renderSavedTestsList();
    };

    savedTestsBtn.addEventListener("click", () => {
      this._savedTestsPopoverOpen = !this._savedTestsPopoverOpen;
      syncSavedPopoverState();
      if (this._savedTestsPopoverOpen) searchInput.focus();
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

    syncSavedPopoverState();
    savedTestsWrap.appendChild(savedTestsBtn);

    if (this._mode === "taking") {
      this._renderTitleTimer(titleFrame.right);
    }

    titleFrame.right.appendChild(savedTestsWrap);

    const shell = this._rootEl.createDiv({ cls: "sprout-view-content-shell sprout-exam-generator-content-shell" });
    if (animationsEnabled) {
      shell.setAttribute("data-aos", "fade-up");
      shell.setAttribute("data-aos-anchor-placement", "top-top");
      shell.setAttribute("data-aos-duration", String(AOS_DURATION));
      shell.setAttribute("data-aos-delay", "100");
      try {
        initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
      } catch {
        // best-effort
      }
      window.requestAnimationFrame(() => {
        titleFrame.strip.classList.add("aos-animate");
        shell.classList.add("aos-animate");
      });
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

    const card = host.createDiv({ cls: "card sprout-coach-wizard-card sprout-exam-generator-card sprout-exam-generator-setup-card" });

    const stepLabels = ["Source", "Settings"];
    const currentStep = this._setupStage === "source" ? 0 : 1;
    const stepper = card.createDiv({ cls: "sprout-coach-stepper" });
    stepLabels.forEach((label, idx) => {
      const item = stepper.createDiv({ cls: "sprout-coach-step-item" });
      const dot = item.createDiv({ cls: "sprout-coach-step-dot" });
      if (idx < currentStep) dot.classList.add("is-done");
      else if (idx === currentStep) dot.classList.add("is-active");
      item.createDiv({ cls: "sprout-coach-step-label", text: label });
      if (idx < stepLabels.length - 1) {
        const line = item.createDiv({ cls: "sprout-coach-step-line" });
        if (idx < currentStep) line.classList.add("is-done");
      }
    });

    const page = card.createDiv({ cls: "sprout-coach-wizard-page" });
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
      page.createEl("h3", { text: "Choose your source content" });
      page.createEl("p", {
        cls: "sprout-coach-step-copy",
        text: "Choose the content for this test, then optionally add files as reference material.",
      });

      let nextBtn: HTMLButtonElement | null = null;
      const syncFooter = () => {
        if (nextBtn) nextBtn.disabled = !canGenerateNow();
      };

      if (this._config.sourceMode === "folder") {
        const switchWrap = page.createDiv({ cls: "sprout-exam-generator-actions" });
        const useSelectedBtn = switchWrap.createEl("button", {
          cls: "bc sprout-btn-toolbar h-9 inline-flex items-center gap-2",
          text: "Switch to note selection",
        });
        useSelectedBtn.type = "button";
        useSelectedBtn.addEventListener("click", () => {
          this._config.sourceMode = "selected";
          this._render();
        });

        const footer = page.createDiv({ cls: "sprout-coach-wizard-footer" });
        nextBtn = footer.createEl("button", {
          cls: "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2",
          text: "Next",
        });
        nextBtn.type = "button";
        nextBtn.disabled = !canGenerateNow();
        nextBtn.addEventListener("click", () => {
          this._wizardSlide = "next";
          this._setupStage = "config";
          this._render();
        });
        return;
      }

      page.createDiv({ cls: "sprout-coach-field-label", text: "Content sources" });
      const searchWrap = page.createDiv({ cls: "sprout-coach-search-wrap" });
      const searchIcon = searchWrap.createSpan({ cls: "sprout-coach-search-icon" });
      setIcon(searchIcon, "search");
      const search = searchWrap.createEl("input", {
        cls: "bc input h-9",
        attr: { type: "search", placeholder: "Search notes, folders, tags, or properties..." },
      });
      search.value = this._noteSearchQuery;
      const popover = searchWrap.createDiv({ cls: "sprout-coach-scope-popover dropdown-menu hidden" });
      const scopeList = popover.createDiv({
        cls: "sprout-coach-scope-list min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto",
      });
      scopeList.setAttr("role", "menu");
      scopeList.setAttr("aria-label", "Source matches");

      const chipsWrap = page.createDiv({ cls: "sprout-coach-selected-wrap" });
      const selectedTitle = chipsWrap.createDiv({ cls: "sprout-coach-selected-title" });
      const chips = chipsWrap.createDiv({ cls: "sprout-coach-selected-chips" });

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

      const renderSelected = (): void => {
        selectedTitle.setText(`Selected (${selectedScopeCount()})`);
        chips.empty();
        if (!selectedScopeCount()) {
          chips.createDiv({ cls: "text-xs text-muted-foreground", text: "No content selected yet." });
        } else {
          if (this._selectedVault) {
            const chip = chips.createDiv({ cls: "sprout-coach-chip" });
            chip.createSpan({ text: `Vault: ${this.app.vault.getName()} (${this._notes.length})` });
            const remove = chip.createEl("button", { cls: "sprout-coach-chip-remove" });
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
            const chip = chips.createDiv({ cls: "sprout-coach-chip" });
            const folderLabel = this._formatFolderChipLabel(folder);
            const count = this._notes.filter((n) => this._folderIncludesPath(folder, n.path)).length;
            chip.createSpan({ text: `Folder: ${folderLabel} (${count})` });
            const remove = chip.createEl("button", { cls: "sprout-coach-chip-remove" });
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
            const chip = chips.createDiv({ cls: "sprout-coach-chip" });
            chip.createSpan({ text: `Note: ${note.basename}` });
            const remove = chip.createEl("button", { cls: "sprout-coach-chip-remove" });
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
            const chip = chips.createDiv({ cls: "sprout-coach-chip" });
            chip.createSpan({ text: `Tag: ${tag.display} (${tag.count})` });
            const remove = chip.createEl("button", { cls: "sprout-coach-chip-remove" });
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
            const chip = chips.createDiv({ cls: "sprout-coach-chip" });
            chip.createSpan({ text: `${pair.displayKey}: ${pair.displayValue} (${pair.count})` });
            const remove = chip.createEl("button", { cls: "sprout-coach-chip-remove" });
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
      };

      renderSelected();
      scopePicker.render();

      // ---- Attachments (optional) ----
      const attachArea = page.createDiv({ cls: "sprout-exam-generator-attachments" });
      const attachmentsLabel = attachArea.createDiv({ cls: "sprout-coach-field-label" });
      attachArea.createEl("p", {
        cls: "sprout-coach-step-copy",
        text: "Attach files, for example PowerPoint or PDF documents, to use as reference material for test generation.",
      });
      const attachChips = attachArea.createDiv({ cls: "sprout-exam-generator-attachment-chips" });
      const renderAttachChips = () => {
        attachmentsLabel.setText(`Attachments (${this._attachedFiles.length})`);
        attachChips.empty();
        for (let i = 0; i < this._attachedFiles.length; i++) {
          const af = this._attachedFiles[i];
          const chip = attachChips.createDiv({ cls: "sprout-coach-chip sprout-assistant-popup-attachment-chip" });
          chip.createSpan({ text: formatAttachmentChipLabel(af.name, af.extension), cls: "sprout-assistant-popup-attachment-name" });
          const removeBtn = chip.createEl("button", { cls: "sprout-coach-chip-remove sprout-assistant-popup-attachment-remove" });
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
      renderAttachChips();

      const addBtn = attachArea.createEl("button", {
        cls: "bc sprout-btn-toolbar sprout-btn-outline-muted h-9 px-3 text-sm inline-flex items-center gap-2",
      });
      addBtn.type = "button";
      const addBtnIcon = addBtn.createSpan({ cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
      setIcon(addBtnIcon, "paperclip");
      addBtn.createSpan({ text: "Attach file" });
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

      const footer = page.createDiv({ cls: "sprout-coach-wizard-footer" });
      nextBtn = footer.createEl("button", {
        cls: "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2",
        text: "Next",
      });
      nextBtn.type = "button";
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
      cls: "sprout-coach-step-copy",
      text: "Set difficulty, question type, count, and timing.",
    });

    const options = page.createDiv({ cls: "sprout-exam-generator-options" });

    this._renderSelectOption(options, "Difficulty", ["easy", "medium", "hard"], this._config.difficulty, (value) => {
      this._config.difficulty = value as ExamDifficulty;
    }, { easy: "Easy", medium: "Medium", hard: "Hard" });

    this._renderSelectOption(options, "Question type", ["mixed", "mcq", "saq"], this._config.questionMode, (value) => {
      this._config.questionMode = value as ExamQuestionMode;
    }, { mixed: "Mixed", mcq: "Multiple choice (MCQ)", saq: "Short answer (SAQ)" });

    this._renderSelectOption(options, "Question count", ["5", "10", "15", "20"], String(this._config.questionCount), (value) => {
      this._config.questionCount = Math.max(1, Number(value) || 5);
    });

    const timedRow = options.createDiv({ cls: "sprout-exam-generator-row" });
    const timedLabel = timedRow.createEl("label", { cls: "sprout-exam-generator-inline" });
    const timedInput = timedLabel.createEl("input", { type: "checkbox" });
    timedInput.checked = this._config.timed;
    timedInput.addEventListener("change", () => {
      this._config.timed = timedInput.checked;
      this._render();
    });
    timedLabel.createSpan({ text: "Timed mode" });

    if (this._config.timed) {
      this._renderSelectOption(options, "Duration (minutes)", ["10", "20", "30", "45", "60"], String(this._config.durationMinutes), (value) => {
        this._config.durationMinutes = Math.max(1, Number(value) || 20);
      });
    }

    const footer = page.createDiv({ cls: "sprout-coach-wizard-footer" });
    const backBtn = footer.createEl("button", {
      cls: "bc sprout-btn-toolbar h-9 inline-flex items-center gap-2",
      text: "Back",
    });
    backBtn.type = "button";
    backBtn.addEventListener("click", () => {
      this._wizardSlide = "back";
      this._setupStage = "source";
      this._render();
    });

    const generateBtn = footer.createEl("button", {
      cls: "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2",
      text: "Generate test",
    });
    generateBtn.type = "button";
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
    const row = host.createDiv({ cls: "sprout-exam-generator-row" });
    row.createDiv({ cls: "sprout-exam-generator-label", text: label });
    const select = row.createEl("select", { cls: "sprout-exam-generator-select" });
    for (const value of values) {
      const text = labels?.[value] ?? value
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const option = select.createEl("option", { text, value });
      option.selected = value === current;
    }
    select.value = current;
    select.addEventListener("change", () => {
      onChange(select.value);
    });
  }

  private _collectSourceFiles(): TFile[] {
    if (this._config.sourceMode === "selected") {
      return this._selectedModeCandidates();
    }
    return this._getFolderCandidates();
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
      const notes = await Promise.all(selectedFiles.map(async (file) => ({
        path: file.path,
        title: file.basename,
        content: await this.app.vault.cachedRead(file),
      })));

      const rankedNotes = this._config.sourceMode === "folder"
        ? this._rankNotesByEducationalDensity(notes).slice(0, this._config.maxFolderNotes)
        : notes;

      // Auto-include embedded attachments (images, PDFs, docs) from source notes.
      const noteEmbedUrls: string[] = [];
      if (this.plugin.settings.studyAssistant.privacy.includeAttachmentsInExam) {
        for (const note of rankedNotes) {
          const refs = new Set<string>();
          const wikiRe = /!\[\[([^\]]+)\]\]/g;
          let m: RegExpExecArray | null;
          while ((m = wikiRe.exec(note.content)) !== null) {
            const raw = String(m[1] || "").trim();
            if (!raw) continue;
            const filePart = raw.split("|")[0]?.split("#")[0]?.trim();
            if (filePart) refs.add(filePart);
          }
          const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
          while ((m = mdRe.exec(note.content)) !== null) {
            const raw = String(m[1] || "").trim();
            if (!raw) continue;
            refs.add(raw.replace(/^<|>$/g, ""));
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

      const questions = await generateExamQuestions({
        settings: this.plugin.settings.studyAssistant,
        notes: rankedNotes,
        config: this._config,
        attachedFileDataUrls: [...this._attachedFiles.map(f => f.dataUrl), ...noteEmbedUrls],
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
    const card = host.createDiv({ cls: "card sprout-exam-generator-card" });
    card.createEl("h3", { text: "Generating test..." });
    card.createDiv({
      cls: "sprout-settings-text-muted",
      text: "Building questions from your selected source. This may take a moment.",
    });
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
    timerGroup.className = "bc flex items-center gap-2 lk-session-timer-group";

    const timerDisplay = document.createElement("button");
    timerDisplay.type = "button";
    timerDisplay.disabled = true;
    timerDisplay.className =
      "bc sprout-btn-toolbar sprout-btn-accent h-9 inline-flex items-center gap-2 equal-height-btn sprout-btn-timer-display";
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
      playBtn.className = "h-9 flex items-center gap-2 equal-height-btn sprout-btn-outline-muted";
      playBtn.setAttribute("aria-label", "Resume timer");
      playBtn.disabled = !this._untimedPaused;
      const playIconWrap = document.createElement("span");
      playIconWrap.className = "inline-flex items-center justify-center sprout-btn-icon";
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
      pauseBtn.className = "h-9 flex items-center gap-2 equal-height-btn sprout-btn-outline-muted";
      pauseBtn.setAttribute("aria-label", "Pause timer");
      pauseBtn.disabled = this._untimedPaused;
      const pauseIconWrap = document.createElement("span");
      pauseIconWrap.className = "inline-flex items-center justify-center sprout-btn-icon";
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
    const card = host.createDiv({ cls: "card sprout-exam-generator-card" });

    // Auto-submit warning banner (shown when timed grace period is active)
    if (this._autoSubmitGrace !== null) {
      const banner = card.createDiv({ cls: "sprout-exam-autosubmit-warning" });
      const messageEl = banner.createDiv({ cls: "sprout-exam-autosubmit-message" });
      messageEl.createEl("strong", { text: "Time's up! " });
      const countdownSpan = messageEl.createSpan({ text: String(this._autoSubmitGrace) });
      this._autoSubmitWarningCountdownEl = countdownSpan;
      messageEl.createSpan({ text: " seconds until auto-submit." });
      const actionsEl = banner.createDiv({ cls: "sprout-exam-autosubmit-actions" });
      const extendBtn = actionsEl.createEl("button", {
        cls: "bc sprout-btn-toolbar h-8 inline-flex items-center gap-2",
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
        cls: "bc sprout-btn-toolbar h-8 inline-flex items-center gap-2",
        text: "Cancel auto-submit",
        attr: { type: "button" },
      });
      cancelBtn.addEventListener("click", () => {
        this._clearAutoSubmitGrace();
        this._render();
      });
      const submitNowBtn = actionsEl.createEl("button", {
        cls: "bc sprout-btn-toolbar sprout-btn-accent h-8 inline-flex items-center gap-2",
        text: "Submit now",
        attr: { type: "button" },
      });
      submitNowBtn.addEventListener("click", () => {
        this._clearAutoSubmitGrace();
        void this._submitExam(false);
      });
    }

    const top = card.createDiv({ cls: "sprout-exam-generator-topline" });
    top.createDiv({ text: `Question ${this._currentIndex + 1} of ${this._questions.length}` });

    const topRight = top.createDiv({ cls: "sprout-exam-generator-topline-right" });

    const quitBtn = topRight.createEl("button", {
      cls: "sprout-btn-toolbar sprout-btn-exit-sm",
      attr: { type: "button", "aria-label": "Quit test" },
    });
    quitBtn.setAttr("data-tooltip-position", "top");
    const quitIconWrap = quitBtn.createSpan({ cls: "inline-flex items-center justify-center sprout-btn-icon" });
    setIcon(quitIconWrap, "x");
    quitBtn.addEventListener("click", () => {
      this._resetToSetup();
    });

    card.createEl("h3", { text: q.prompt });

    if (q.type === "mcq") {
      const options = q.options || [];
      const selected = this._answers.has(q.id) ? Number(this._answers.get(q.id)) : -1;
      const optionList = card.createDiv({ cls: "sprout-mcq-options" });
      for (let i = 0; i < options.length; i += 1) {
        const btn = optionList.createEl("button", { cls: "sprout-btn-toolbar w-full justify-start text-left h-auto py-2 mb-2", type: "button" });
        if (selected === i) btn.classList.add("sprout-mcq-selected");
        const left = btn.createSpan({ cls: "inline-flex items-center gap-2 min-w-0" });
        left.createEl("kbd", { cls: "kbd", text: String(i + 1) });
        left.createSpan({ cls: "min-w-0 whitespace-pre-wrap break-words sprout-mcq-option-text", text: options[i] });
        btn.addEventListener("click", () => {
          this._answers.set(q.id, i);
          optionList.querySelectorAll(".sprout-btn-toolbar").forEach((el) => el.classList.remove("sprout-mcq-selected"));
          btn.classList.add("sprout-mcq-selected");
        });
      }
    } else {
      const area = card.createEl("textarea", {
        cls: "sprout-exam-generator-textarea",
      });
      area.value = String(this._answers.get(q.id) || "");
      area.placeholder = "Write your answer...";
      area.addEventListener("input", () => {
        this._answers.set(q.id, area.value);
      });
    }

    const actions = card.createDiv({ cls: "sprout-exam-generator-actions" });
    const prev = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Previous" });
    prev.disabled = this._currentIndex <= 0;
    prev.addEventListener("click", () => {
      this._currentIndex = Math.max(0, this._currentIndex - 1);
      this._render();
    });

    const isLastQuestion = this._currentIndex >= this._questions.length - 1;
    if (isLastQuestion) {
      const submit = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Submit exam" });
      submit.addEventListener("click", () => {
        void this._submitExam(false);
      });
    } else {
      const next = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Next" });
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
    const card = host.createDiv({ cls: "card sprout-exam-generator-card" });
    card.createEl("h3", { text: "Marking exam..." });
    card.createDiv({ cls: "sprout-settings-text-muted", text: "Please wait while SAQ answers are graded." });
  }

  private _renderResults(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card sprout-exam-generator-card" });
    const score = this._finalPercent == null ? "0" : `${this._finalPercent.toFixed(1)}%`;

    card.createEl("h3", { text: `Final score: ${score}` });

    if (this._autoSubmitted) {
      card.createDiv({ cls: "sprout-settings-text-muted", text: "Timed exam auto-submitted when the timer reached zero." });
    }

    const list = card.createDiv({ cls: "sprout-exam-generator-results" });
    for (let i = 0; i < this._questions.length; i += 1) {
      const q = this._questions[i];
      const r = this._questionResults.find((item) => item.questionId === q.id);
      const row = list.createDiv({ cls: "sprout-exam-generator-result-row" });
      row.createDiv({ cls: "sprout-exam-generator-result-title", text: `Q${i + 1} (${q.type.toUpperCase()})` });
      row.createDiv({ cls: "sprout-exam-generator-result-score", text: `${Math.round(r?.scorePercent ?? 0)}%` });
      row.createDiv({ cls: "sprout-settings-text-muted", text: r?.feedback || "No feedback." });
      if (r?.saq?.keyPointsMissed?.length) {
        row.createDiv({
          cls: "sprout-settings-text-muted",
          text: `Missed: ${r.saq.keyPointsMissed.join("; ")}`,
        });
      }
    }

    const actions = card.createDiv({ cls: "sprout-exam-generator-actions" });
    const review = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Review mistakes" });
    review.disabled = !this._questionResults.some((r) => (r.scorePercent ?? 0) < 100);
    review.addEventListener("click", () => {
      this._reviewWrongOnly = true;
      this._mode = "review";
      this._render();
    });

    const reviewAll = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Review all" });
    reviewAll.addEventListener("click", () => {
      this._reviewWrongOnly = false;
      this._mode = "review";
      this._render();
    });

    const retake = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Retake setup" });
    retake.addEventListener("click", () => {
      this._resetToSetup();
    });
  }

  private _renderReview(host: HTMLElement): void {
    const card = host.createDiv({ cls: "card sprout-exam-generator-card" });
    card.createEl("h3", { text: this._reviewWrongOnly ? "Review mistakes" : "Review test" });

    const rows = this._questionResults
      .map((result, i) => ({ result, index: i }))
      .filter(({ result }) => (this._reviewWrongOnly ? result.scorePercent < 100 : true));

    if (rows.length === 0) {
      card.createDiv({ cls: "sprout-settings-text-muted", text: "No mistakes to review." });
    } else {
      const list = card.createDiv({ cls: "sprout-exam-generator-results" });
      for (const { result, index } of rows) {
        const row = list.createDiv({ cls: "sprout-exam-generator-result-row" });
        row.createDiv({ cls: "sprout-exam-generator-result-title", text: `Q${index + 1} (${result.questionType.toUpperCase()})` });
        row.createDiv({ cls: "sprout-exam-generator-result-score", text: `${Math.round(result.scorePercent)}%` });
        row.createDiv({ text: result.prompt });
        row.createDiv({ cls: "sprout-settings-text-muted", text: `Your answer: ${result.userAnswer || "(blank)"}` });
        row.createDiv({ cls: "sprout-settings-text-muted", text: `Expected: ${result.expectedAnswer || "(not provided)"}` });
        row.createDiv({ cls: "sprout-settings-text-muted", text: result.feedback || "No feedback." });
      }
    }

    const actions = card.createDiv({ cls: "sprout-exam-generator-actions" });
    const back = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Back to results" });
    back.addEventListener("click", () => {
      this._mode = "results";
      this._render();
    });
    const setup = actions.createEl("button", { cls: "sprout-btn-toolbar", text: "Back to setup" });
    setup.addEventListener("click", () => {
      this._resetToSetup();
    });
  }

  private _formatTime(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const min = Math.floor(safe / 60);
    const sec = safe % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  private _persistGeneratedTest(notes: Array<{ path: string; title: string; content: string }>): string | null {
    if (!this._testsDb) return null;
    const label = `${this._config.difficulty.toUpperCase()} test - ${new Date().toLocaleString()}`;
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

  private async _deleteSavedTest(id: string): Promise<void> {
    if (!this._testsDb) return;
    try {
      const deleted = this._testsDb.deleteTest(id);
      if (!deleted) {
        new Notice("Saved test no longer exists.");
        return;
      }
      await this._testsDb.persist();
      if (this._activeTestId === id) this._activeTestId = null;
      this._savedTests = this._testsDb.listTests(25);
      this._savedTestsSearchQuery = this._savedTestsSearchQuery.trim();
      this._render();
    } catch {
      new Notice("Failed to delete saved test.");
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
    this.containerEl.addClass("sprout");
    this.modalEl.addClass("bc", "sprout-attachment-picker");
    this.contentEl.addClass("bc");

    // ---- "Choose from computer" button ----
    const systemBtn = this.contentEl.createEl("button", {
      cls: "bc sprout-attachment-picker-system-btn",
      text: "Choose from computer",
    });
    setIcon(systemBtn.createSpan({ cls: "sprout-attachment-picker-system-icon" }), "hard-drive");
    systemBtn.addEventListener("click", () => this._pickSystemFile());

    // ---- Divider ----
    this.contentEl.createEl("div", { cls: "sprout-attachment-picker-divider", text: "Or choose from vault" });

    const search = this.contentEl.createEl("input", {
      cls: "bc input w-full sprout-attachment-picker-search",
      attr: { type: "text", placeholder: "Search vault files..." },
    });

    this._listEl = this.contentEl.createDiv({ cls: "sprout-attachment-picker-list" });
    this._renderList();

    search.addEventListener("input", () => {
      const q = search.value.toLowerCase().trim();
      this._filteredFiles = q
        ? this._files.filter(f => f.path.toLowerCase().includes(q))
        : [...this._files];
      this._renderList();
    });

    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
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
      const item = this._listEl.createDiv({ cls: "sprout-attachment-picker-item" });
      item.createSpan({ text: file.path });
      item.addEventListener("click", () => {
        this._onPick(file);
        this.close();
      });
    }
    if (this._filteredFiles.length > max) {
      this._listEl.createDiv({
        cls: "sprout-attachment-picker-overflow",
        text: `… and ${this._filteredFiles.length - max} more`,
      });
    }
    if (!shown.length) {
      this._listEl.createDiv({
        cls: "sprout-attachment-picker-empty",
        text: "No matching files",
      });
    }
  }
}
