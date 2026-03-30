/**
 * @file src/main.ts
 * @summary Entry point for the Sprout Obsidian plugin. Extends the Obsidian Plugin class
 * to register views (Reviewer, Widget, Browser, Analytics, Home), commands, ribbon icons,
 * editor context-menu items, settings, and the Basecoat UI runtime. Handles plugin lifecycle
 * (load/unload), settings normalisation, data persistence, sync orchestration, GitHub star
 * fetching, and scheduling/analytics reset utilities.
 *
 * @exports
 *   - SproutPlugin (default) — main plugin class extending Obsidian's Plugin
 */

import "basecoat-css/all";

import {
  Plugin,
  Notice,
  TFile,
  addIcon,
  type ItemView,
  type MenuItem,
  type Editor,
  MarkdownView,
  type Menu,
  type WorkspaceLeaf,
  Platform,
  requestUrl,
} from "obsidian";

import {
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_STUDY_ASSISTANT,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_NOTE_REVIEW,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  VIEW_TYPE_SETTINGS,
  VIEW_TYPE_EXAM_GENERATOR,
  VIEW_TYPE_COACH,
  BRAND,
  DEFAULT_SETTINGS,
  deepMerge,
  type SproutSettings,
} from "./platform/core/constants";

import { log } from "./platform/core/logger";
import { clamp, clonePlain, isPlainObject, type FlashcardType } from "./platform/core/utils";
import { getBasecoatApi, patchBasecoatNullGuards } from "./platform/core/basecoat";
import { migrateSettingsInPlace } from "./views/settings/config/settings-migration";
import { normaliseSettingsInPlace } from "./views/settings/config/settings-normalisation";
import { registerReadingViewPrettyCards, teardownReadingView } from "./views/reading/reading-view";
import { removeAosErrorHandler } from "./platform/core/aos-loader";
import { initTooltipPositioner } from "./platform/core/tooltip-positioner";
import { initButtonTooltipDefaults } from "./platform/core/tooltip-defaults";
import { initMobileKeyboardHandler, cleanupMobileKeyboardHandler } from "./platform/core/mobile-keyboard-handler";

import { JsonStore } from "./platform/core/store";
import type { IStore } from "./platform/core/store-interface";
import { NoteReviewSqlite } from "./platform/core/note-review-sqlite";
import { SqliteStore, isSqliteDatabasePresent, reconcileAllDbsFromVaultSync } from "./platform/core/sqlite-store";
import { migrateJsonToSqlite } from "./platform/core/migration";
import { queryFirst } from "./platform/core/ui";
import { SproutReviewerView } from "./views/reviewer/review-view";
import { SproutWidgetView } from "./views/widget/view/widget-view";
import { SproutAssistantPopup } from "./views/study-assistant/popup/assistant-popup";
import { SproutStudyAssistantView } from "./views/study-assistant/view/study-assistant-view";
import { SproutCardBrowserView } from "./views/browser/card-browser-view";
import { SproutAnalyticsView } from "./views/analytics/analytics-view";
import { SproutHomeView } from "./views/home/home-view";
import { SproutSettingsTab } from "./views/settings/settings-tab";
import { SproutSettingsView } from "./views/settings/view/settings-view";
import { SproutNoteReviewView } from "./views/note-review/view/note-review-view";
import { SproutExamGeneratorView } from "./views/exam-generator/exam-generator-view";
import { SproutCoachView } from "./views/coach";
import { CoachPlanSqlite, type CoachScopeType } from "./platform/core/coach-plan-sqlite";
import { formatSyncNotice, syncOneFile, syncQuestionBank } from "./platform/integrations/sync/sync-engine";
import { joinPath, safeStatMtime, createDataJsonBackupNow } from "./platform/integrations/sync/backup";
import { CardCreatorModal } from "./platform/modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "./platform/modals/image-occlusion-creator-modal";
import { ParseErrorModal } from "./platform/modals/parse-error-modal";
import { setDelimiter } from "./platform/core/delimiter";
// Anki modals are lazy-loaded to defer sql.js WASM parsing until needed
// import { AnkiImportModal } from "./platform/modals/anki-import-modal";
// import { AnkiExportModal } from "./platform/modals/anki-export-modal";
import { resetCardScheduling, type CardState } from "./engine/scheduler/scheduler";
import { WhatsNewModal } from "./platform/modals/whats-new-modal";
import { checkForVersionUpgrade, loadVersionTracking, getVersionTrackingData } from "./platform/core/version-manager";
import { ReminderEngine } from "./views/reminders/reminder-engine";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import React from "react";
import { t } from "./platform/translations/translator";
import learnkitBrandIconRaw from "../site/branding/LearnKit Icon.svg";
import learnkitStudyWidgetIconRaw from "../site/branding/Learnkit Study Widget.svg";
import learnkitAssistantWidgetIconRaw from "../site/branding/Learnkit Chat Widget.svg";
import learnkitHorizontalIconRaw from "../site/branding/Learnkit Horizontal Icon.svg";
import type { Scope } from "./views/reviewer/types";

function normalizeBrandIconSvg(rawSvg: string): string {
  const cleaned = rawSvg
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .trim();

  const forceThemeColor = (value: string): string => {
    return value
      .replace(/\bstroke\s*=\s*(['"])(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\1/gi, 'stroke="currentColor"')
      .replace(/\bfill\s*=\s*(['"])(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\1/gi, 'fill="currentColor"')
      .replace(/style\s*=\s*(['"])([\s\S]*?)\1/gi, (_m, quote: string, styleText: string) => {
        const nextStyle = styleText
          .replace(/(^|;)\s*stroke\s*:\s*(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\s*(?=;|$)/gi, "$1stroke:currentColor")
          .replace(/(^|;)\s*fill\s*:\s*(?:#(?:000|000000)|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))\s*(?=;|$)/gi, "$1fill:currentColor");
        return `style=${quote}${nextStyle}${quote}`;
      });
  };

  const themed = forceThemeColor(cleaned);

  return themed.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let nextAttrs = attrs;
    if (!/\baria-hidden\s*=/.test(nextAttrs)) nextAttrs += ' aria-hidden="true"';
    if (!/\bfill\s*=/.test(nextAttrs)) nextAttrs += ' fill="currentColor"';
    return `<svg${nextAttrs}>`;
  });
}

const SPROUT_RIBBON_BRAND_ICON = normalizeBrandIconSvg(learnkitBrandIconRaw);
const SPROUT_BRAND_ICON_KEY = "sprout-brand";
const SPROUT_BRAND_HORIZONTAL_ICON_KEY = "sprout-brand-horizontal";
const SPROUT_WIDGET_STUDY_ICON_KEY = "sprout-widget-study";
const SPROUT_WIDGET_ASSISTANT_ICON_KEY = "sprout-widget-assistant";

const SPROUT_HORIZONTAL_BRAND_ICON = normalizeBrandIconSvg(learnkitHorizontalIconRaw);
const SPROUT_STUDY_WIDGET_ICON = normalizeBrandIconSvg(learnkitStudyWidgetIconRaw);
const SPROUT_ASSISTANT_WIDGET_ICON = normalizeBrandIconSvg(learnkitAssistantWidgetIconRaw);

type StudyAssistantApiKeys = SproutSettings["studyAssistant"]["apiKeys"];

/**
 * Legacy configuration files that were previously used for partitioned
 * settings storage.  Kept only so we can migrate them back into data.json
 * on first load after the update, then delete them.
 * `api-keys.json` is intentionally excluded — it stays separate.
 */
const LEGACY_CONFIG_FILES: ReadonlyArray<{
  readonly file: string;
  readonly keys: readonly (keyof SproutSettings)[];
}> = [
  { file: "general.json", keys: ["general"] },
  { file: "study.json", keys: ["study"] },
  { file: "assistant.json", keys: ["studyAssistant"] },
  { file: "reminders.json", keys: ["reminders"] },
  { file: "scheduling.json", keys: ["scheduling"] },
  { file: "indexing.json", keys: ["indexing"] },
  { file: "cards.json", keys: ["cards", "imageOcclusion"] },
  { file: "reading-view.json", keys: ["readingView"] },
  { file: "storage.json", keys: ["storage"] },
  { file: "audio.json", keys: ["audio"] },
];

export default class SproutPlugin extends Plugin {
  settings!: SproutSettings;
  store!: IStore;
  _bc: unknown;

  private _basecoatStarted = false;

  // Save mutex to prevent concurrent read-modify-write races
  private _saving: Promise<void> | null = null;

  // Shared wide mode state across all views
  isWideMode = false;

  readonly DEFAULT_SETTINGS: SproutSettings = DEFAULT_SETTINGS;

  // Ribbon icons (desktop + mobile)
  private _ribbonEls: HTMLElement[] = [];

  // Hide Obsidian global status bar when these views are active
  private readonly _hideStatusBarViewTypes = new Set<string>([
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_NOTE_REVIEW,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    VIEW_TYPE_SETTINGS,
    VIEW_TYPE_EXAM_GENERATOR,
    // If you also want it hidden in the sidebar widget, uncomment:
    // VIEW_TYPE_WIDGET,
  ]);

  // What's New modal state
  private _whatsNewModalContainer: HTMLElement | null = null;
  private _whatsNewModalRoot: ReactRoot | null = null;

  // Sprout-scoped zoom (only Sprout leaves + widget, never other plugins)
  private _sproutZoomValue = 1;
  private _sproutZoomSaveTimer: number | null = null;

  private _disposeTooltipPositioner: (() => void) | null = null;
  private _reminderEngine: ReminderEngine | null = null;
  private _assistantPopup: SproutAssistantPopup | null = null;
  private _coachDb: CoachPlanSqlite | null = null;
  private _readingViewRefreshTimer: number | null = null;
  private _readingModeWatcherInterval: number | null = null;
  private readonly _markdownLeafModeSnapshot = new WeakMap<WorkspaceLeaf, "source" | "preview">();
  private readonly _markdownLeafContentSnapshot = new WeakMap<WorkspaceLeaf, string>();
  private readonly _reminderDevConsoleCommandNames = [
    "sproutReminderLaunch",
    "sproutReminderRoutine",
    "sproutReminderGatekeeper",
  ] as const;

  private readonly _refreshableViewTypes = [
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_NOTE_REVIEW,
    VIEW_TYPE_WIDGET,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    VIEW_TYPE_SETTINGS,
    VIEW_TYPE_EXAM_GENERATOR,
    VIEW_TYPE_COACH,
    VIEW_TYPE_COACH,
  ];

  private _addCommand(
    id: string,
    name: string,
    callback: () => void | Promise<void>,
  ) {
    this.addCommand({ id, name, callback });
  }

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  refreshAssistantPopupFromSettings(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (this.settings?.studyAssistant?.enabled) {
      // Re-mount if previously skipped because companion was disabled
      this._assistantPopup?.mount();
    }
    this._assistantPopup?.onActiveLeafChange();
    this._assistantPopup?.onFileOpen(activeFile);
    if (!this.settings?.studyAssistant?.enabled) {
      this._closeAllAssistantWidgetInstances();
    }
  }

  private _closeAllAssistantWidgetInstances(): void {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
      .forEach((leaf) => {
        try {
          leaf.detach();
        } catch (e) {
          log.swallow("close assistant widget leaf", e);
        }
      });
  }

  private _registerCommands() {
    this._addCommand("sync-flashcards-current-note", "Sync flashcards from current note", async () => this._runSyncCurrentNote());
    this._addCommand("sync-flashcards", "Sync all flashcards from the vault", async () => this._runSync());
    this._addCommand("open", "Open home", async () => this.openHomeTab());
    this._addCommand("open-widget", "Open flashcard study widget", async () => this.openWidgetSafe());
    this.addCommand({
      id: "open-assistant-widget",
      name: "Open study companion widget",
      checkCallback: (checking) => {
        if (!this.settings?.studyAssistant?.enabled) return false;
        if (!checking) void this.openAssistantWidgetSafe();
        return true;
      },
    });
    this._addCommand("open-analytics", "Open analytics", async () => this.openAnalyticsTab());
    this._addCommand("open-settings", "Open plugin settings", () => this.openPluginSettingsInObsidian());
    this._addCommand("open-guide", "Open guide", async () => this.openSettingsTab(false, "guide"));
    this._addCommand("edit-flashcards", "Edit flashcards", async () => this.openBrowserTab());
    this._addCommand("new-study-session", "New study session", async () => this.openReviewerTab());
    this._addCommand("open-note-review", "Open note review", async () => this.openNoteReviewTab());
    this._addCommand("open-exam-generator", "Open Tests", async () => this.openExamGeneratorTab());
    this._addCommand("open-coach", "Open Coach", async () => this.openCoachTab());

    const flashcardCommands: Array<{ id: string; name: string; type: FlashcardType }> = [
      { id: "add-basic-flashcard", name: "Add basic flashcard to note", type: "basic" },
      { id: "add-basic-reversed-flashcard", name: "Add basic (reversed) flashcard to note", type: "reversed" },
      { id: "add-cloze-flashcard", name: "Add cloze flashcard to note", type: "cloze" },
      { id: "add-multiple-choice-flashcard", name: "Add multiple choice flashcard to note", type: "mcq" },
      { id: "add-ordered-question-flashcard", name: "Add ordered question flashcard to note", type: "oq" },
      { id: "add-image-occlusion-flashcard", name: "Add image occlusion flashcard to note", type: "io" },
    ];

    for (const command of flashcardCommands) {
      this._addCommand(command.id, command.name, () => this.openAddFlashcardModal(command.type));
    }

    this._addCommand("import-anki", "Import from Anki (.apkg)", async () => {
      const { AnkiImportModal } = await import("./platform/modals/anki-import-modal");
      new AnkiImportModal(this).open();
    });

    this._addCommand("export-anki", "Export to Anki (.apkg)", async () => {
      const { AnkiExportModal } = await import("./platform/modals/anki-export-modal");
      new AnkiExportModal(this).open();
    });
  }

  private async _openSingleTabView(viewType: string, forceNew = false): Promise<WorkspaceLeaf> {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(viewType);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return existing;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: viewType, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private _initBasecoatRuntime() {
    const bc = getBasecoatApi();
    if (!bc) {
      log.warn(`Basecoat API not found on window.basecoat (dropdowns may not work).`);
      return;
    }

    try {
      // Patch known null-dereference issues in bundled Basecoat runtime before init/start.
      patchBasecoatNullGuards(bc);

      // If hot-reloading or reloading the plugin, avoid multiple observers.
      bc.stop?.();

      // Initialize any already-rendered components (Obsidian loads long after DOMContentLoaded).
      bc.initAll?.();

      // Start observing future DOM changes (for views created later).
      // Mobile page transitions can expose transient/partial DOM nodes that
      // trigger noisy Basecoat runtime errors; keep observer desktop-only.
      if (!Platform.isMobileApp) {
        bc.start?.();
        this._basecoatStarted = true;
      } else {
        this._basecoatStarted = false;
      }

      (this as unknown as { _basecoatApi: unknown })._basecoatApi = bc;
      log.info(`Basecoat initAll OK${Platform.isMobileApp ? " (observer disabled on mobile)" : " + start OK"}`);
    } catch (e) {
      log.warn(`Basecoat init failed`, e);
    }
  }

  private _stopBasecoatRuntime() {
    if (!this._basecoatStarted) return;
    try {
      const bc = getBasecoatApi();
      bc?.stop?.();
    } catch (e) { log.swallow("stop basecoat runtime", e); }
    this._basecoatStarted = false;
  }

  private _isActiveHiddenViewType(): boolean {
    const ws = this.app.workspace;
    const activeLeaf = ws?.getMostRecentLeaf?.() ?? null;
    const viewType = activeLeaf?.view?.getViewType?.();
    return viewType ? this._hideStatusBarViewTypes.has(viewType) : false;
  }

  private _updateStatusBarVisibility(leaf: WorkspaceLeaf | null) {
    const viewType = leaf?.view?.getViewType?.();
    const hide = viewType
      ? this._hideStatusBarViewTypes.has(viewType)
      : this._isActiveHiddenViewType();
    document.body.classList.toggle("sprout-hide-status-bar", hide);
  }

  /** Migrate legacy settings keys (delegates to settings-migration module). */
  private _migrateSettingsInPlace() {
    migrateSettingsInPlace(this.settings as Record<string, unknown>);
  }

  /** Normalise settings (delegates to settings-normalisation module). */
  private _normaliseSettingsInPlace() {
    normaliseSettingsInPlace(this.settings);
  }

  private _applySproutThemeAccentOverride() {
    const raw = String(this.settings?.general?.themeAccentOverride ?? "").trim();
    const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw);
    if (isHex) {
      document.body.style.setProperty("--sprout-theme-accent-override", raw);
      return;
    }
    document.body.style.removeProperty("--sprout-theme-accent-override");
  }

  private _applySproutThemePreset() {
    const preset = String(this.settings?.general?.themePreset ?? "glass").trim() || "glass";
    document.body.setAttribute("data-sprout-theme-preset", preset);
  }

  // ── Sprout-scoped pinch zoom ───────────────────────────────────────────────

  private _applySproutZoom(value: number) {
    const next = clamp(Number(value || 1), 0.8, 1.8);
    this._sproutZoomValue = next;
    document.body.style.setProperty("--sprout-leaf-zoom", next.toFixed(3));
  }

  private _queueSproutZoomSave() {
    if (this._sproutZoomSaveTimer != null) window.clearTimeout(this._sproutZoomSaveTimer);
    this._sproutZoomSaveTimer = window.setTimeout(() => {
      this._sproutZoomSaveTimer = null;
      void this.saveAll();
    }, 250);
  }

  /**
   * Register a Ctrl+Scroll / trackpad-pinch listener that only fires inside
   * Sprout-owned views (`.workspace-leaf-content.sprout` or `.sprout-widget.sprout`).
   * Events over non-Sprout leaves pass through untouched.
   */
  private _registerSproutPinchZoom() {
    this._applySproutZoom(this.settings.general.workspaceContentZoom ?? 1);

    this.registerDomEvent(
      document,
      "wheel",
      (ev: WheelEvent) => {
        if (!ev.ctrlKey) return;

        const target = ev.target as HTMLElement | null;
        if (!target) return;

        // Don't intercept inside modals, menus, popovers, or suggestion lists
        if (target.closest(".modal-container, .menu, .popover, .suggestion-container")) return;

        // Only intercept within Sprout-owned leaves or the Sprout widget
        const sproutEl = target.closest<HTMLElement>(
          ".workspace-leaf-content.sprout, .sprout-widget.sprout",
        );
        if (!sproutEl) return;

        ev.preventDefault();
        ev.stopPropagation();

        const factor = Math.exp(-ev.deltaY * 0.006);
        const next = clamp(this._sproutZoomValue * factor, 0.8, 1.8);
        if (Math.abs(next - this._sproutZoomValue) < 0.001) return;

        this._applySproutZoom(next);
        this.settings.general.workspaceContentZoom = Number(next.toFixed(3));
        this._queueSproutZoomSave();
      },
      { capture: true, passive: false },
    );
  }

  /**
   * Ensures exactly one leaf exists for a given view type.
   * If multiple exist, detaches the extras and returns the kept leaf.
   */
  private _ensureSingleLeafOfType(viewType: string): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (!leaves.length) return null;

    const [keep, ...extras] = leaves;

    for (const l of extras) {
      try {
        l.detach();
      } catch (e) { log.swallow("detach extra leaf", e); }
    }

    return keep;
  }

  async onload() {
    try {
      // ✅ IMPORTANT: Basecoat runtime init for Obsidian (DOMContentLoaded already happened)
      this._initBasecoatRuntime();

      // Initialize tooltip positioner for dynamic positioning
      this._disposeTooltipPositioner?.();
      this._disposeTooltipPositioner = initTooltipPositioner();

      // Ensure all buttons use `aria-label` and never rely on native `title` tooltips.
      this.register(initButtonTooltipDefaults());

      // Initialize mobile keyboard handler for adaptive bottom padding
      initMobileKeyboardHandler();

      // Add phone-specific body class for CSS targeting (survives orientation changes)
      if (Platform.isPhone) document.body.classList.add("is-phone");

      this._bc = {
        VIEW_TYPE_REVIEWER,
        VIEW_TYPE_WIDGET,
        VIEW_TYPE_BROWSER,
        VIEW_TYPE_ANALYTICS,
        VIEW_TYPE_HOME,
        VIEW_TYPE_SETTINGS,
        BRAND,
        DEFAULT_SETTINGS,
        deepMerge,
        SproutReviewerView,
        SproutWidgetView,
        SproutCardBrowserView,
        SproutAnalyticsView,
        SproutHomeView,
        SproutSettingsView,
        SproutSettingsTab,
        syncQuestionBank,
        CardCreatorModal,
        ParseErrorModal,
      };

      const root = (await this.loadData()) as unknown;
      const rootObj = isPlainObject(root) ? root : {};
      const rootSettings = isPlainObject(rootObj.settings)
        ? (rootObj.settings as Partial<SproutSettings>)
        : {};
      this.settings = deepMerge(DEFAULT_SETTINGS, rootSettings);
      await this._migrateLegacyConfigFiles();
      this._migrateSettingsInPlace();
      this._normaliseSettingsInPlace();
      this._applySproutThemePreset();
      this._applySproutThemeAccentOverride();
      await this._initialiseDedicatedApiKeyStorage();
      this._registerSproutPinchZoom();

      // Activate the user's chosen delimiter before any parsing occurs
      setDelimiter(this.settings.indexing.delimiter ?? "|");

      // When vault sync is enabled, reconcile all .db files from the vault
      // folder before any stores are opened.  This ensures databases that
      // are opened lazily (notes.db, tests.db) still pick up copies that
      // Obsidian Sync delivered while the plugin was not running.
      await reconcileAllDbsFromVaultSync(this);

      const hasSqlite = await isSqliteDatabasePresent(this);
      const hasLegacyStore = isPlainObject(rootObj.store);

      if (hasSqlite) {
        const sqliteStore = new SqliteStore(this);
        await sqliteStore.open();
        this.store = sqliteStore;
      } else if (hasLegacyStore) {
        const migrated = await migrateJsonToSqlite(this, rootObj);
        if (migrated) {
          const sqliteStore = new SqliteStore(this);
          await sqliteStore.open();
          this.store = sqliteStore;
        } else {
          this.store = new JsonStore(this);
          this.store.load(rootObj);
        }
      } else {
        const sqliteStore = new SqliteStore(this);
        await sqliteStore.open();
        this.store = sqliteStore;
      }

      this._reminderEngine = new ReminderEngine(this);
      this._registerReminderDevConsoleCommands();

      // Load version tracking from data.json
      loadVersionTracking(rootObj);

      if (!(this.store instanceof SqliteStore) && !this.store.loadedFromDisk && isPlainObject(root)) {
        log.warn(
          "data.json existed but contained no .store — " +
          "initial save will be guarded by assessPersistSafety.",
        );
      }

      registerReadingViewPrettyCards(this);

      this.registerView(VIEW_TYPE_REVIEWER, (leaf) => new SproutReviewerView(leaf, this));
      this.registerView(VIEW_TYPE_NOTE_REVIEW, (leaf) => new SproutNoteReviewView(leaf, this));
      this.registerView(VIEW_TYPE_WIDGET, (leaf) => new SproutWidgetView(leaf, this));
      this.registerView(VIEW_TYPE_STUDY_ASSISTANT, (leaf) => new SproutStudyAssistantView(leaf, this));
      this.registerView(VIEW_TYPE_BROWSER, (leaf) => new SproutCardBrowserView(leaf, this));
      this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new SproutAnalyticsView(leaf, this));
      this.registerView(VIEW_TYPE_HOME, (leaf) => new SproutHomeView(leaf, this));
      this.registerView(VIEW_TYPE_SETTINGS, (leaf) => new SproutSettingsView(leaf, this));
      this.registerView(VIEW_TYPE_EXAM_GENERATOR, (leaf) => new SproutExamGeneratorView(leaf, this));
      this.registerView(VIEW_TYPE_COACH, (leaf) => new SproutCoachView(leaf, this));

      this._coachDb = new CoachPlanSqlite(this);
      await this._coachDb.open();

      this.addSettingTab(new SproutSettingsTab(this.app, this));

      // Commands (hotkeys default to none; users can bind in Settings → Hotkeys)
      this._registerCommands();

      // Register custom branded ribbon icon from site/branding/Sprout Icon.svg artwork.
      addIcon(SPROUT_BRAND_ICON_KEY, SPROUT_RIBBON_BRAND_ICON);
      addIcon(SPROUT_BRAND_HORIZONTAL_ICON_KEY, SPROUT_HORIZONTAL_BRAND_ICON);
      addIcon(SPROUT_WIDGET_STUDY_ICON_KEY, SPROUT_STUDY_WIDGET_ICON);
      addIcon(SPROUT_WIDGET_ASSISTANT_ICON_KEY, SPROUT_ASSISTANT_WIDGET_ICON);

      // Replace dropdown with separate ribbon icons (desktop + mobile)
      this._registerRibbonIcons();
      this._registerEditorContextMenu();
      this._registerMarkdownSourceClozeShortcuts();

      // Hide status bar when Sprout views are active
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          this._updateStatusBarVisibility(leaf ?? null);
          this._assistantPopup?.onActiveLeafChange();
        }),
      );

      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          const f = file instanceof TFile ? file : null;
          this._assistantPopup?.onFileOpen(f);
          this.app.workspace
            .getLeavesOfType(VIEW_TYPE_WIDGET)
            .forEach((leaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
          this.app.workspace
            .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
            .forEach((leaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
        }),
      );

      // Rename assistant chat files when notes are renamed
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file instanceof TFile && file.path.toLowerCase().endsWith(".md")) {
            void this._assistantPopup?.onFileRename(oldPath, file);
          }
        }),
      );

      this.app.workspace.onLayoutReady(() => {
        // Ensure status bar class matches the active view after layout settles
        this._updateStatusBarVisibility(null);

        // Check for version upgrades and show What's New modal if needed
        this._checkAndShowWhatsNewModal();

        // Mount per-leaf assistant popup triggers
        this._assistantPopup = new SproutAssistantPopup(this);
        this._assistantPopup.mount();
        this._assistantPopup.onActiveLeafChange();
        this.refreshAssistantPopupFromSettings();
        this._startMarkdownModeWatcher();

        this._reminderEngine?.start();
      });

      await this.saveAll();
      void this.refreshGithubStars();
      log.info(`loaded`);
    } catch (e) {
      log.error(`failed to load`, e);
      new Notice(this._tx("ui.main.notice.loadFailed", "LearnKit – failed to load"));
    }
  }

  onunload() {
    // Best-effort save: await pending save, then fire one last save.
    // Obsidian calls onunload synchronously so we can't truly await,
    // but we kick it off so the microtask completes before the process exits.
    const pending = this._saving ?? Promise.resolve();
    void pending
      .then(() => this._doSave())
      .catch((e) => log.swallow("save all on unload", e));

    if (this.store instanceof SqliteStore) {
      void this.store.close().catch((e) => log.swallow("close sqlite store", e));
    }
    if (this._coachDb) {
      void this._coachDb.close().catch((e) => log.swallow("close coach sqlite", e));
      this._coachDb = null;
    }

    this._bc = null;
    this._destroyRibbonIcons();
    document.body.classList.remove("sprout-hide-status-bar");
    document.body.classList.remove("is-phone");
    document.body.style.removeProperty("--sprout-theme-accent-override");
    document.body.style.removeProperty("--sprout-leaf-zoom");
    if (this._sproutZoomSaveTimer != null) {
      window.clearTimeout(this._sproutZoomSaveTimer);
      this._sproutZoomSaveTimer = null;
    }
    if (this._readingViewRefreshTimer != null) {
      window.clearTimeout(this._readingViewRefreshTimer);
      this._readingViewRefreshTimer = null;
    }
    if (this._readingModeWatcherInterval != null) {
      window.clearInterval(this._readingModeWatcherInterval);
      this._readingModeWatcherInterval = null;
    }

    this._disposeTooltipPositioner?.();
    this._disposeTooltipPositioner = null;
    this._unregisterReminderDevConsoleCommands();
    this._reminderEngine?.stop();
    this._reminderEngine = null;

    // Clean up What's New modal
    this._closeWhatsNewModal();

    // Tear down reading-view observers + window listeners
    teardownReadingView();

    // Remove global AOS error suppression handler
    removeAosErrorHandler();

    // Clean up mobile keyboard handler
    cleanupMobileKeyboardHandler();

    // Clean up floating assistant popup
    this._assistantPopup?.destroy();
    this._assistantPopup = null;

    // ✅ stop Basecoat observer on unload (helps plugin reload / dev)
    this._stopBasecoatRuntime();
  }

  private _destroyRibbonIcons() {
    for (const el of this._ribbonEls) {
      try {
        el.remove();
      } catch (e) { log.swallow("remove ribbon icon", e); }
    }
    this._ribbonEls = [];
  }

  /**
   * Check if the plugin was upgraded and show the What's New modal if needed.
   */
  private _checkAndShowWhatsNewModal() {
    try {
      const currentVersion = this.manifest.version;
      const { shouldShow, version } = checkForVersionUpgrade(currentVersion);
      
      if (shouldShow && version) {
        this._showWhatsNewModal(version);
      }
    } catch (e) {
      log.swallow("check version upgrade", e);
    }
  }

  /**
   * Display the What's New modal for a specific version.
   */
  private _showWhatsNewModal(version: string) {
    // Clean up any existing modal
    this._closeWhatsNewModal();

    // Create modal container
    const container = document.body.createDiv();
    this._whatsNewModalContainer = container;

    // Create React root and render modal
    const root = createRoot(container);
    this._whatsNewModalRoot = root;

    const modalElement = React.createElement(WhatsNewModal, {
      version,
      onClose: () => this._closeWhatsNewModal(),
    });
    
    root.render(modalElement);
  }

  /**
   * Close and clean up the What's New modal.
   */
  private _closeWhatsNewModal() {
    if (this._whatsNewModalRoot) {
      this._whatsNewModalRoot.unmount();
      this._whatsNewModalRoot = null;
    }
    if (this._whatsNewModalContainer) {
      this._whatsNewModalContainer.remove();
      this._whatsNewModalContainer = null;
    }
  }

  _getActiveMarkdownFile(): TFile | null {
    const f = this.app.workspace.getActiveFile();
    return f instanceof TFile ? f : null;
  }

  private _ensureEditingNoteEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    if (view.getMode() !== "source") return null;
    const editor = view.editor;
    if (!editor) return null;
    return { view, editor };
  }

  private _applyClozeShortcutToEditor(editor: Editor, clozeIndex = 1) {
    const selection = String(editor.getSelection?.() ?? "");
    const tokenStart = `{{c${clozeIndex}::`;

    if (selection.length > 0) {
      editor.replaceSelection(`${tokenStart}${selection}}}`);
      return;
    }

    const cursor = editor.getCursor();
    editor.replaceSelection(`{{c${clozeIndex}::}}`);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + tokenStart.length });
  }

  private _registerMarkdownSourceClozeShortcuts() {
    this.registerDomEvent(
      document,
      "keydown",
      (ev: KeyboardEvent) => {
        const key = String(ev.key || "").toLowerCase();
        if (key !== "c" && ev.code !== "KeyC") return;

        const primary = Platform.isMacOS ? ev.metaKey : ev.ctrlKey;
        if (!primary || !ev.shiftKey) return;

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "source" || !view.editor) return;

        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (!view.contentEl?.contains(target)) return;
        if (!target.closest(".cm-editor")) return;

        ev.preventDefault();
        ev.stopPropagation();
        this._applyClozeShortcutToEditor(view.editor, 1);
      },
      { capture: true },
    );
  }

  openAddFlashcardModal(forcedType?: FlashcardType) {
    const ok = this._ensureEditingNoteEditor();
    if (!ok) {
      new Notice(this._tx("ui.main.notice.mustEditNote", "Must be editing a note to add a flashcard"));
      return;
    }

    if (forcedType === "io") {
      new ImageOcclusionCreatorModal(this.app, this).open();
    } else {
      new CardCreatorModal(this.app, this, forcedType).open();
    }
  }

  // -----------------------
  // Editor right-click menu
  // -----------------------

  private _registerEditorContextMenu() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, _editor, view) => {
        if (!(view instanceof MarkdownView)) return;

        const mode = view.getMode();
        if (mode !== "source") return;

        if (!(view.file instanceof TFile)) return;

        // Add the item with submenu
        let itemDom: HTMLElement | null = null;

        menu.addItem((item) => {
          item.setTitle(this._tx("ui.main.menu.addFlashcard", "Add flashcard")).setIcon("plus");

          // Create submenu
          const submenu = item.setSubmenu?.();
          if (submenu) {
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.basic", "Basic")).setIcon("file-text").onClick(() => this.openAddFlashcardModal("basic"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.basicReversed", "Basic (reversed)")).setIcon("file-text").onClick(() => this.openAddFlashcardModal("reversed"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.cloze", "Cloze")).setIcon("file-minus").onClick(() => this.openAddFlashcardModal("cloze"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.multipleChoice", "Multiple choice")).setIcon("list").onClick(() => this.openAddFlashcardModal("mcq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.orderedQuestion", "Ordered question")).setIcon("list-ordered").onClick(() => this.openAddFlashcardModal("oq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle(this._tx("ui.main.menu.imageOcclusion", "Image occlusion")).setIcon("image").onClick(() => this.openAddFlashcardModal("io"));
            });
          }

          itemDom = item?.dom ?? null;
        });

        const positionAfterExternalLink = () => {
          try {
            const menuDom: HTMLElement | null = menu?.dom ?? null;
            if (!menuDom || !itemDom) return;

            let node: HTMLElement | null = itemDom;
            while (node && node.parentElement && node.parentElement !== menuDom) {
              node = node.parentElement;
            }
            if (!node || node.parentElement !== menuDom) return;

            // Find "Add external link" menu item
            const menuItems = Array.from(menuDom.children);
            let externalLinkItem: Element | null = null;

            for (const item of menuItems) {
              const titleEl = queryFirst(item, ".menu-item-title");
              if (titleEl && titleEl.textContent?.includes("Add external link")) {
                externalLinkItem = item;
                break;
              }
            }

            // Position after external link, or at top if not found
            if (externalLinkItem && externalLinkItem.nextSibling) {
              menuDom.insertBefore(node, externalLinkItem.nextSibling);
            } else if (externalLinkItem) {
              menuDom.appendChild(node);
            } else {
              // Fallback: insert after first item (likely "Add link")
              if (menuDom.children.length > 1 && menuDom.children[1]) {
                menuDom.insertBefore(node, menuDom.children[1]);
              }
            }
          } catch (e) { log.swallow("reposition menu item", e); }
        };

        positionAfterExternalLink();
        setTimeout(positionAfterExternalLink, 0);
      }),
    );
  }

  public async syncBank(): Promise<void> {
    await this._runSync();
  }

  public refreshAllViews(): void {
    this._refreshOpenViews();
  }

  public notifyWidgetCardsSynced(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET).forEach((leaf) => {
      const view = leaf.view as ItemView & { onCardsSynced?(): void; onRefresh?(): void };
      if (typeof view.onCardsSynced === "function") {
        view.onCardsSynced();
        return;
      }
      view.onRefresh?.();
    });
  }

  public async refreshReadingViewMarkdownLeaves(): Promise<void> {
    const leaves = this.app.workspace
      .getLeavesOfType("markdown")
      .filter((leaf) => this._isMainWorkspaceMarkdownLeaf(leaf));
    await Promise.all(leaves.map(async (leaf) => {
      const container = leaf.view?.containerEl ?? null;
      if (!(container instanceof HTMLElement)) return;

      const content = queryFirst(
        container,
        ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
      );
      if (!(content instanceof HTMLElement)) return;

      const scrollHost =
        content.closest(".markdown-reading-view, .markdown-preview-view, .markdown-rendered") ??
        content;
      const prevTop = Number(scrollHost.scrollTop || 0);
      const prevLeft = Number(scrollHost.scrollLeft || 0);
      const sourcePayload = await this._getMarkdownLeafSource(leaf);

      try {
        content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
          bubbles: true,
          detail: sourcePayload,
        }));
      } catch (e) {
        log.swallow("dispatch reading view refresh", e);
      }

      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode?.() === "preview") {
        try {
          view.previewMode?.rerender?.();
        } catch (e) {
          log.swallow("rerender markdown preview", e);
        }
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          try {
            scrollHost.scrollTo({ top: prevTop, left: prevLeft });
          } catch {
            scrollHost.scrollTop = prevTop;
            scrollHost.scrollLeft = prevLeft;
          }

          try {
            content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
              bubbles: true,
              detail: sourcePayload,
            }));
          } catch (e) {
            log.swallow("dispatch reading view refresh (post-rerender)", e);
          }
        });
      });
    }));
  }

  private _scheduleReadingViewRefresh(delayMs = 90): void {
    if (this._readingViewRefreshTimer != null) {
      window.clearTimeout(this._readingViewRefreshTimer);
      this._readingViewRefreshTimer = null;
    }

    this._readingViewRefreshTimer = window.setTimeout(() => {
      this._readingViewRefreshTimer = null;
      try {
        void this.refreshReadingViewMarkdownLeaves();
      } catch (e) {
        log.swallow("schedule reading view refresh", e);
      }
    }, Math.max(0, Number(delayMs) || 0));
  }

  private _isMainWorkspaceMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return false;

    const container = view.containerEl;
    if (!(container instanceof HTMLElement)) return false;

    // Ignore leaves docked in sidebars; only central note workspace leaves
    // should drive reading refresh scheduling.
    const inSidebar = !!container.closest(
      ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
    );

    return !inSidebar;
  }

  private _computeContentSignature(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }

  private async _getMarkdownLeafSource(leaf: WorkspaceLeaf): Promise<{ sourceContent: string; sourcePath: string }> {
    try {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return { sourceContent: "", sourcePath: "" };

      const sourcePath = view.file instanceof TFile ? view.file.path : "";
      const mode = view.getMode?.();
      if (mode === "source") {
        const liveViewData =
          typeof (view as unknown as { getViewData?: () => string }).getViewData === "function"
            ? String((view as unknown as { getViewData: () => string }).getViewData() ?? "")
            : "";

        if (liveViewData.trim()) {
          return { sourceContent: liveViewData, sourcePath };
        }
      }

      if (view.file instanceof TFile && view.file.extension === "md") {
        const fileContent = await this.app.vault.read(view.file);
        return { sourceContent: String(fileContent ?? ""), sourcePath };
      }
    } catch (e) {
      log.swallow("get markdown leaf source", e);
    }

    return { sourceContent: "", sourcePath: "" };
  }

  private _startMarkdownModeWatcher(): void {
    if (this._readingModeWatcherInterval != null) return;

    const scanModes = () => {
      try {
        const leaves = this.app.workspace
          .getLeavesOfType("markdown")
          .filter((leaf) => this._isMainWorkspaceMarkdownLeaf(leaf));
        let sawModeChange = false;

        for (const leaf of leaves) {
          const view = leaf.view;
          if (!(view instanceof MarkdownView)) continue;

          const mode = view.getMode?.();
          if (mode !== "source" && mode !== "preview") continue;

          const prev = this._markdownLeafModeSnapshot.get(leaf);
          if (prev !== mode) {
            this._markdownLeafModeSnapshot.set(leaf, mode);
            // Ignore first-seen snapshot to avoid startup noise.
            if (prev) sawModeChange = true;
          }

          // Track source text changes as well, so field edits (including
          // multi-line blocks) in source mode trigger reading refresh.
          const sourcePath = view.file instanceof TFile ? view.file.path : "";
          const liveViewData =
            typeof (view as unknown as { getViewData?: () => string }).getViewData === "function"
              ? String((view as unknown as { getViewData: () => string }).getViewData() ?? "")
              : "";
          const signature = `${sourcePath}|${this._computeContentSignature(liveViewData)}`;
          const prevSignature = this._markdownLeafContentSnapshot.get(leaf);
          if (prevSignature !== signature) {
            this._markdownLeafContentSnapshot.set(leaf, signature);
            if (prevSignature) sawModeChange = true;
          }
        }

        if (sawModeChange) {
          this._scheduleReadingViewRefresh(40);
        }
      } catch (e) {
        log.swallow("scan markdown mode changes", e);
      }
    };

    // Prime snapshots before starting interval.
    scanModes();
    this._readingModeWatcherInterval = window.setInterval(scanModes, 180);
    this.registerInterval(this._readingModeWatcherInterval);
  }

  async _runSync() {
    const res = await syncQuestionBank(this);

    const notice = formatSyncNotice("Sync complete", res, { includeDeleted: true });
    new Notice(notice);

    const tagsDeleted = Number((res as { tagsDeleted?: number }).tagsDeleted ?? 0);
    if (tagsDeleted > 0) {
      new Notice(this._tx("ui.main.notice.deletedUnusedTags", "Deleted {count}, unused tag{suffix}", {
        count: tagsDeleted,
        suffix: tagsDeleted === 1 ? "" : "s",
      }));
    }

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }
    this.notifyWidgetCardsSynced();
  }

  private _formatCurrentNoteSyncNotice(pageTitle: string, res: { newCount?: number; updatedCount?: number; removed?: number }): string {
    const updated = Number(res.updatedCount ?? 0);
    const created = Number(res.newCount ?? 0);
    const deleted = Number(res.removed ?? 0);
    const parts: string[] = [];

    if (updated > 0) parts.push(`${updated} updated`);
    if (created > 0) parts.push(`${created} new`);
    if (deleted > 0) parts.push(`${deleted} deleted`);

    if (parts.length === 0) return `Flashcards updated for page - ${pageTitle} - no changes`;
    return `Flashcards updated for page - ${pageTitle} - ${parts.join(", ")}`;
  }

  async _runSyncCurrentNote() {
    const file = this._getActiveMarkdownFile();
    if (!(file instanceof TFile)) {
      new Notice("No note is open");
      return;
    }

    const res = await syncOneFile(this, file, { pruneGlobalOrphans: false });
    new Notice(this._formatCurrentNoteSyncNotice(file.basename, res));

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }

    this.notifyWidgetCardsSynced();
  }

  async saveAll() {
    this._applySproutThemePreset();
    this._applySproutThemeAccentOverride();
    // Queue through mutex to prevent concurrent read-modify-write races
    while (this._saving) await this._saving;
    this._saving = this._doSave();
    try { await this._saving; } finally { this._saving = null; }
  }

  private _getDataJsonPath(): string | null {
    const configDir = this.app?.vault?.configDir;
    const pluginId = this.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "data.json");
  }

  private _getConfigDirPath(): string | null {
    const configDir = this.app?.vault?.configDir;
    const pluginId = this.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "configuration");
  }

  private _getConfigFilePath(filename: string): string | null {
    const dir = this._getConfigDirPath();
    return dir ? joinPath(dir, filename) : null;
  }

  private _getApiKeysFilePath(): string | null {
    return this._getConfigFilePath("api-keys.json");
  }

  private _normaliseApiKeys(raw: unknown): StudyAssistantApiKeys {
    const obj = isPlainObject(raw) ? raw : {};
    const asApiKey = (value: unknown): string => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value).trim();
      }
      return "";
    };
    return {
      openai: asApiKey(obj.openai),
      anthropic: asApiKey(obj.anthropic),
      deepseek: asApiKey(obj.deepseek),
      xai: asApiKey(obj.xai ?? obj.groq),
      google: asApiKey(obj.google),
      perplexity: asApiKey(obj.perplexity),
      openrouter: asApiKey(obj.openrouter),
      custom: asApiKey(obj.custom),
    };
  }

  private _hasAnyApiKey(apiKeys: StudyAssistantApiKeys): boolean {
    return Object.values(apiKeys).some((value) => String(value || "").trim().length > 0);
  }

  private _settingsWithoutApiKeys(): SproutSettings {
    const snapshot = clonePlain(this.settings);
    snapshot.studyAssistant.apiKeys = { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
    return snapshot;
  }

  private async _loadApiKeysFromDedicatedFile(): Promise<boolean> {
    const adapter = this.app?.vault?.adapter;
    const filePath = this._getApiKeysFilePath();
    if (!adapter || !filePath) return false;
    try {
      if (!(await adapter.exists(filePath))) return false;
      const raw = await adapter.read(filePath);
      const parsed = JSON.parse(raw) as unknown;
      this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(parsed);
      return true;
    } catch (e) {
      log.warn("Failed to read dedicated API key file; continuing with settings payload.", e);
      return false;
    }
  }

  private async _persistApiKeysToDedicatedFile(apiKeys: StudyAssistantApiKeys): Promise<boolean> {
    const adapter = this.app?.vault?.adapter;
    const dirPath = this._getConfigDirPath();
    const filePath = this._getApiKeysFilePath();
    if (!adapter || !dirPath || !filePath) return false;
    try {
      const hasAny = this._hasAnyApiKey(apiKeys);
      if (!hasAny) {
        if (await adapter.exists(filePath)) {
          await (adapter as { remove?: (path: string) => Promise<void> }).remove?.(filePath);
        }
        return true;
      }
      if (!(await adapter.exists(dirPath))) {
        await (adapter as { mkdir?: (path: string) => Promise<void> }).mkdir?.(dirPath);
      }
      await adapter.write(filePath, `${JSON.stringify(apiKeys, null, 2)}\n`);
      return true;
    } catch (e) {
      log.warn("Failed to write dedicated API key file.", e);
      return false;
    }
  }

  private async _initialiseDedicatedApiKeyStorage(): Promise<void> {
    this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
    const loadedFromDedicatedFile = await this._loadApiKeysFromDedicatedFile();
    if (loadedFromDedicatedFile) return;
    if (!this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) return;
    const migrated = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);
    if (migrated) log.info("Migrated study assistant API keys to configuration/api-keys.json");
  }

  // ── Legacy config-file migration ────────────────────────────────────

  /**
   * One-time migration: merge any legacy `configuration/*.json` files
   * into `this.settings` (so they feed into the next data.json write),
   * then delete the files.  `api-keys.json` is preserved.
   */
  private async _migrateLegacyConfigFiles(): Promise<void> {
    const adapter = this.app?.vault?.adapter;
    if (!adapter) return;

    const remove = (adapter as { remove?: (path: string) => Promise<void> }).remove;

    for (const entry of LEGACY_CONFIG_FILES) {
      const filePath = this._getConfigFilePath(entry.file);
      if (!filePath) continue;
      try {
        if (!(await adapter.exists(filePath))) continue;
        const raw = await adapter.read(filePath);
        const parsed = JSON.parse(raw) as unknown;
        if (!isPlainObject(parsed)) continue;

        const parsedObj = parsed;
        const s = this.settings as Record<string, unknown>;

        if (entry.keys.length === 1) {
          const key = entry.keys[0];
          s[key] = deepMerge(s[key] ?? {}, parsedObj);
        } else {
          for (const key of entry.keys) {
            if (isPlainObject(parsedObj[key])) {
                s[key] = deepMerge(s[key] ?? {}, parsedObj[key]);
            }
          }
        }

        // Delete the legacy file now that its values are in settings
        if (remove) {
          try { await remove(filePath); } catch { /* best effort */ }
        }
      } catch (e) {
        log.warn(`Failed to migrate legacy config file ${entry.file}.`, e);
      }
    }
  }

  private async _doSave() {
    if (this.store instanceof SqliteStore) {
      const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;

      this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
      const apiKeyWriteOk = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);

      // Always write all settings to data.json so Obsidian Sync can transfer them.
      const syncSettings = clonePlain(this.settings) as Record<string, unknown>;
      if (isPlainObject(syncSettings.studyAssistant)) {
        syncSettings.studyAssistant.apiKeys =
          { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
      }

      if (!apiKeyWriteOk && this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
        log.error("Api key dedicated file write failed; keys were not persisted this save.");
        new Notice("Could not save keys securely. Check file permissions", 8000);
      }

      root.settings = syncSettings;
      delete root.store;
      root.versionTracking = getVersionTrackingData();

      await this.saveData(root);
      await this.store.persist();
      return;
    }

    const adapter = this.app?.vault?.adapter ?? null;
    const dataPath = this._getDataJsonPath();
    const canStat = !!(adapter && dataPath);
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const mtimeBefore = canStat ? await safeStatMtime(adapter, dataPath) : 0;
      const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;

      // ── Persist-safety check ────────────────────────────────────────
      const diskStore = root?.store as Record<string, unknown> | undefined;
      const safety = this.store.assessPersistSafety(diskStore ?? null);

      if (!safety.allow) {
        log.warn(`_doSave: aborting — ${safety.reason}`);
        try { await createDataJsonBackupNow(this, "safety-before-empty-write"); } catch { /* best effort */ }
        return;
      }

      if (safety.backupFirst) {
        log.warn(`_doSave: ${safety.reason} Creating safety backup before writing.`);
        try { await createDataJsonBackupNow(this, "safety-regression"); } catch { /* best effort */ }
      }

      // ── Persist API keys to dedicated file ──────────────────────────
      this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
      const apiKeyWriteOk = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);

      // Always write all settings to data.json so Obsidian Sync can transfer them.
      const syncSettings = clonePlain(this.settings) as Record<string, unknown>;
      if (isPlainObject(syncSettings.studyAssistant)) {
        syncSettings.studyAssistant.apiKeys =
          { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
      }
      if (!apiKeyWriteOk && this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
        log.error("Api key dedicated file write failed; keys were not persisted this save.");
        new Notice("Could not save keys securely. Check file permissions", 8000);
      }

      root.settings = syncSettings;
      root.store = this.store.data;
      root.versionTracking = getVersionTrackingData();

      if (canStat) {
        const mtimeBeforeWrite = await safeStatMtime(adapter, dataPath);
        if (mtimeBefore && mtimeBeforeWrite && mtimeBeforeWrite !== mtimeBefore) {
          // data.json changed during our read; retry with latest snapshot
          continue;
        }
      }

      await this.saveData(root);
      return;
    }

    // Last resort: write latest snapshot even if the file is churny.
    const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;
    this.settings.studyAssistant.apiKeys = this._normaliseApiKeys(this.settings.studyAssistant.apiKeys);
    const apiKeyWriteOk = await this._persistApiKeysToDedicatedFile(this.settings.studyAssistant.apiKeys);
    const syncSettings = clonePlain(this.settings) as Record<string, unknown>;
    if (isPlainObject(syncSettings.studyAssistant)) {
      syncSettings.studyAssistant.apiKeys =
        { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
    }
    if (!apiKeyWriteOk && this._hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
      log.error("Api key dedicated file write failed; keys were not persisted this save.");
      new Notice("Could not save keys securely. Check file permissions", 8000);
    }
    root.settings = syncSettings;
    root.store = this.store.data;
    root.versionTracking = getVersionTrackingData();
    await this.saveData(root);
  }

  private _refreshOpenViews() {
    for (const type of this._refreshableViewTypes) {
      this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
        const view = leaf.view as ItemView & { onRefresh?(): void };
        view.onRefresh?.();
      });
    }
  }

  async refreshGithubStars(force = false) {
    const s = this.settings;
    s.general ??= {} as SproutSettings["general"];
    s.general.githubStars ??= { count: null, fetchedAt: null };

    const lastAt = Number(s.general.githubStars.fetchedAt || 0);
    const staleMs = 6 * 60 * 60 * 1000;
    if (!force && lastAt && Date.now() - lastAt < staleMs) return;

    try {
      const res = await requestUrl({
        url: "https://api.github.com/repos/ctrlaltwill/sprout",
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      });
      const json: unknown = res?.json;
      const jsonObj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      const countRaw = jsonObj?.stargazers_count;
      const count = Number(countRaw);
      if (Number.isFinite(count)) {
        s.general.githubStars.count = count;
        s.general.githubStars.fetchedAt = Date.now();
        await this.saveAll();
        this._refreshOpenViews();
      }
    } catch {
      // offline or rate-limited; keep last known value
    }
  }

  public async resetSettingsToDefaults(): Promise<void> {
    this.settings = clonePlain(DEFAULT_SETTINGS);
    this._normaliseSettingsInPlace();
    await this.saveAll();
    this._refreshOpenViews();
  }

  private _isCardStateLike(v: unknown): v is CardState {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;

    const stageOk =
      o.stage === "new" ||
      o.stage === "learning" ||
      o.stage === "review" ||
      o.stage === "relearning" ||
      o.stage === "suspended";

    if (!stageOk) return false;

    const numsOk =
      typeof o.due === "number" &&
      typeof o.scheduledDays === "number" &&
      typeof o.reps === "number" &&
      typeof o.lapses === "number" &&
      typeof o.learningStepIndex === "number";

    return numsOk;
  }

  async resetAllCardScheduling(): Promise<void> {
    const now = Date.now();
    let cardTotal = 0;

    // Restrict reset scope to scheduling states only.
    // This avoids touching analytics, review history, or any other store branches.
    const states = this.store?.data?.states;
    if (states && typeof states === "object" && !Array.isArray(states)) {
      for (const [id, raw] of Object.entries(states as Record<string, unknown>)) {
        if (!this._isCardStateLike(raw)) continue;
        const prev: CardState = { id, ...(raw as Record<string, unknown>) } as CardState;
        (states as Record<string, unknown>)[id] = resetCardScheduling(prev, now);
        cardTotal++;
      }
    }

    await this.saveAll();
    const noteTotal = await this._clearAllNoteSchedulingState();
    this._refreshOpenViews();

    new Notice(
      this._tx("ui.main.notice.resetScheduling", "Reset scheduling for {cardCount} cards and {noteCount} notes.", {
        cardCount: cardTotal,
        noteCount: noteTotal,
      }),
    );
  }

  private async _clearAllNoteSchedulingState(): Promise<number> {
    const db = new NoteReviewSqlite(this);
    let total = 0;

    try {
      await db.open();
      total = db.clearAllNoteState();
      await db.persist();
    } finally {
      await db.close().catch((e) => log.swallow("close note review sqlite after reset", e));
    }

    return total;
  }

  async resetAllNoteScheduling(): Promise<void> {
    const total = await this._clearAllNoteSchedulingState();

    this._refreshOpenViews();
    new Notice(this._tx("ui.main.notice.resetNoteScheduling", "Reset scheduling for {count} notes.", { count: total }));
  }

  async resetAllAnalyticsData(): Promise<void> {
    // Clear analytics events and review log
    if (this.store.data.analytics) {
      this.store.data.analytics.events = [];
      this.store.data.analytics.seq = 0;
    }

    if (Array.isArray(this.store.data.reviewLog)) {
      this.store.data.reviewLog = [];
    }

    await this.saveAll();
    this._refreshOpenViews();

    new Notice(this._tx("ui.main.notice.analyticsCleared", "Analytics data cleared."));
  }

  async openReviewerTab(forceNew: boolean = false) {
    const leaf = await this._openSingleTabView(VIEW_TYPE_REVIEWER, forceNew);
    const view = leaf.view as { setReturnToCoach?: (enabled: boolean) => void } | undefined;
    view?.setReturnToCoach?.(false);
  }

  async openNoteReviewTab(forceNew: boolean = false) {
    const leaf = await this._openSingleTabView(VIEW_TYPE_NOTE_REVIEW, forceNew);
    const view = leaf.view as {
      setReturnToCoach?: (enabled: boolean) => void;
      setCoachScope?: (s: Scope | null) => void;
      setIgnoreDailyReviewLimit?: (enabled: boolean) => void;
    } | undefined;
    view?.setReturnToCoach?.(false);
    view?.setCoachScope?.(null);
    view?.setIgnoreDailyReviewLimit?.(false);
  }

  async openHomeTab(forceNew: boolean = false) {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_HOME);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return;
      }
    }

    // Fix: Open new tab after current active tab, then select it
    const ws = this.app.workspace;
    const activeLeaf = ws.getLeaf(false);
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_HOME, active: true });
    // If possible, move the new tab after the active tab
    try {
      if (activeLeaf && activeLeaf !== leaf && typeof ws.moveLeaf === "function") {
        ws.moveLeaf(leaf, ws.getGroup(activeLeaf), (ws.getGroup(activeLeaf)?.index ?? 0) + 1);
      }
    } catch (e) { log.swallow("move leaf after active tab", e); }
    void ws.revealLeaf(leaf);
  }

  async openBrowserTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_BROWSER, forceNew);
  }

  async openAnalyticsTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_ANALYTICS, forceNew);
  }

  async openSettingsTab(forceNew: boolean = false, targetTab?: string) {
    const resolvedTargetTab = targetTab ?? "settings";

    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_SETTINGS);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        // Navigate to the target tab if specified
        const view = existing.view as SproutSettingsView | undefined;
        if (view && typeof view.navigateToTab === "function") {
          view.navigateToTab(resolvedTargetTab, { reanimateEntrance: true });
        }
        return;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_SETTINGS, active: true });
    void this.app.workspace.revealLeaf(leaf);

    // Navigate to the target tab after the view opens
    setTimeout(() => {
      const view = leaf.view as SproutSettingsView | undefined;
      if (view && typeof view.navigateToTab === "function") {
        view.navigateToTab(resolvedTargetTab, { reanimateEntrance: true });
      }
    }, 50);
  }

  async openExamGeneratorTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, forceNew);
  }

  async openExamGeneratorTest(testId: string): Promise<void> {
    const leaf = await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
    const view = leaf.view as { loadSavedTestById?: (id: string) => void } | undefined;
    view?.loadSavedTestById?.(testId);
  }

  async openExamGeneratorScope(scope: Scope): Promise<void> {
    const leaf = await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
    const view = leaf.view as {
      setCoachScope?: (s: Scope | null) => void;
      setCoachScopes?: (scopes: Scope[] | null) => void;
      setSuppressEntranceAosOnce?: (enabled: boolean) => void;
    } | undefined;
    view?.setSuppressEntranceAosOnce?.(true);
    if (view?.setCoachScopes) {
      view.setCoachScopes([scope]);
      return;
    }
    view?.setCoachScope?.(scope);
  }

  async openExamGeneratorScopes(scopes: Scope[], targetLeaf?: WorkspaceLeaf): Promise<void> {
    const normalized = Array.isArray(scopes)
      ? scopes.filter((scope): scope is Scope => !!scope)
      : [];
    if (!normalized.length) return;

    const leaf = targetLeaf
      ? await (async () => {
        await targetLeaf.setViewState({ type: VIEW_TYPE_EXAM_GENERATOR, active: true });
        void this.app.workspace.revealLeaf(targetLeaf);
        return targetLeaf;
      })()
      : await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
    const view = leaf.view as {
      setCoachScope?: (s: Scope | null) => void;
      setCoachScopes?: (items: Scope[] | null) => void;
      setSuppressEntranceAosOnce?: (enabled: boolean) => void;
    } | undefined;
    view?.setSuppressEntranceAosOnce?.(true);

    if (view?.setCoachScopes) {
      view.setCoachScopes(normalized);
      return;
    }

    view?.setCoachScope?.(normalized[0] ?? null);
  }

  async openCoachTab(
    forceNew: boolean = false,
    options?: { suppressEntranceAos?: boolean; refresh?: boolean },
    targetLeaf?: WorkspaceLeaf,
  ) {
    const leaf = targetLeaf
      ? await (async () => {
        await targetLeaf.setViewState({ type: VIEW_TYPE_COACH, active: true });
        void this.app.workspace.revealLeaf(targetLeaf);
        return targetLeaf;
      })()
      : await this._openSingleTabView(VIEW_TYPE_COACH, forceNew);
    const view = leaf.view as {
      onRefresh?: () => void;
      setSuppressEntranceAosOnce?: (enabled: boolean) => void;
    } | undefined;
    if (options?.suppressEntranceAos) {
      view?.setSuppressEntranceAosOnce?.(true);
    }
    if (options?.refresh !== false) {
      view?.onRefresh?.();
    }
  }

  async openReviewerScope(scope: Scope): Promise<void> {
    const leaf = await this._openSingleTabView(VIEW_TYPE_REVIEWER, false);
    const view = leaf.view as {
      setReturnToCoach?: (enabled: boolean) => void;
      openSessionFromScope?: (
        s: Scope,
        options?: { ignoreDailyReviewLimit?: boolean; ignoreDailyNewLimit?: boolean; dueOnly?: boolean },
      ) => void;
    } | undefined;
    view?.setReturnToCoach?.(false);
    view?.openSessionFromScope?.(scope);
  }

  async openReviewerScopeWithOptions(
    scope: Scope,
    options: {
      ignoreDailyReviewLimit?: boolean;
      ignoreDailyNewLimit?: boolean;
      dueOnly?: boolean;
      includeNotDue?: boolean;
      targetCount?: number;
      practiceMode?: boolean;
      trackCoachProgress?: boolean;
    },
    targetLeaf?: WorkspaceLeaf,
  ): Promise<void> {
    const leaf = targetLeaf
      ? await (async () => {
        await targetLeaf.setViewState({ type: VIEW_TYPE_REVIEWER, active: true });
        void this.app.workspace.revealLeaf(targetLeaf);
        return targetLeaf;
      })()
      : await this._openSingleTabView(VIEW_TYPE_REVIEWER, false);
    const view = leaf.view as {
      setReturnToCoach?: (enabled: boolean) => void;
      setSuppressEntranceAosOnce?: (enabled: boolean) => void;
      openSessionFromScope?: (
        s: Scope,
        opts?: {
          ignoreDailyReviewLimit?: boolean;
          ignoreDailyNewLimit?: boolean;
          dueOnly?: boolean;
          includeNotDue?: boolean;
          targetCount?: number;
          practiceMode?: boolean;
          trackCoachProgress?: boolean;
        },
      ) => void;
    } | undefined;
    view?.setSuppressEntranceAosOnce?.(true);
    view?.setReturnToCoach?.(true);
    view?.openSessionFromScope?.(scope, options);
  }

  async openNoteReviewScope(scope: Scope): Promise<void> {
    return this.openNoteReviewScopeWithOptions(scope, {});
  }

  async openNoteReviewScopeWithOptions(
    scope: Scope,
    options: {
      targetCount?: number;
      includeNotDue?: boolean;
      noScheduling?: boolean;
      trackCoachProgress?: boolean;
    },
    targetLeaf?: WorkspaceLeaf,
  ): Promise<void> {
    const leaf = targetLeaf
      ? await (async () => {
        await targetLeaf.setViewState({ type: VIEW_TYPE_NOTE_REVIEW, active: true });
        void this.app.workspace.revealLeaf(targetLeaf);
        return targetLeaf;
      })()
      : await this._openSingleTabView(VIEW_TYPE_NOTE_REVIEW, false);
    const view = leaf.view as {
      setReturnToCoach?: (enabled: boolean) => void;
      setSuppressEntranceAosOnce?: (enabled: boolean) => void;
      setCoachScope?: (s: Scope | null) => void;
      setIgnoreDailyReviewLimit?: (enabled: boolean) => void;
      startCoachDueSession?: (
        s: Scope,
        opts?: {
          targetCount?: number;
          includeNotDue?: boolean;
          noScheduling?: boolean;
          trackCoachProgress?: boolean;
        },
      ) => void;
    } | undefined;
    view?.setSuppressEntranceAosOnce?.(true);
    view?.setReturnToCoach?.(true);
    if (typeof view?.startCoachDueSession === "function") {
      view.startCoachDueSession(scope, options);
      // On first open, Note Review can still be mounting; rerun once on next tick
      // only if scope did not stick, to avoid a second full re-render flicker.
      window.setTimeout(() => {
        const mountedView = leaf.view as {
          startCoachDueSession?: (
            s: Scope,
            opts?: {
              targetCount?: number;
              includeNotDue?: boolean;
              noScheduling?: boolean;
              trackCoachProgress?: boolean;
            },
          ) => void;
          _coachScope?: Scope | null;
        } | undefined;
        const activeScope = mountedView?._coachScope;
        const scopeAlreadyApplied =
          !!activeScope &&
          activeScope.type === scope.type &&
          activeScope.key === scope.key;
        if (!scopeAlreadyApplied) {
          mountedView?.startCoachDueSession?.(scope, options);
        }
      }, 0);
      return;
    }
    view?.setCoachScope?.(scope);
    view?.setIgnoreDailyReviewLimit?.(true);
  }

  async recordCoachProgressForScope(scope: Scope, kind: "flashcard" | "note", by = 1): Promise<void> {
    if (!this._coachDb) {
      this._coachDb = new CoachPlanSqlite(this);
      await this._coachDb.open();
    }
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    const dayUtc = d.getTime();
    const scopeKey = scope.type === "vault" ? "" : String(scope.key || "");
    this._coachDb.incrementProgress(dayUtc, scope.type as CoachScopeType, scopeKey, kind, by);
    await this._coachDb.persist();
  }

  openPluginSettingsInObsidian() {
    const settings = this.app.setting;
    if (!settings) {
      new Notice(this._tx("ui.main.notice.obsidianSettingsUnavailable", "Obsidian settings are unavailable."));
      return;
    }

    settings.open();
    const pluginId = this.manifest?.id || "sprout";

    try {
      if (typeof settings.openTabById === "function") settings.openTabById(pluginId);
      else if (typeof settings.openTab === "function") settings.openTab(pluginId);
    } catch (e) {
      log.warn("failed to open plugin settings tab", e);
    }
  }

  private async openWidgetSafe(): Promise<void> {
    try {
      await this.openWidget();
    } catch (e) {
      log.error(`failed to open widget`, e);
      new Notice(this._tx("ui.main.notice.widgetOpenFailed", "LearnKit – failed to open widget"));
    }
  }

  async openWidget() {
    const ws = this.app.workspace;
    let leaf: WorkspaceLeaf | null = ws.getRightLeaf(false);

    if (leaf) {
      ws.setActiveLeaf(leaf, { focus: false });
      leaf = ws.getLeaf(false) ?? leaf;
    } else {
      leaf = ws.getRightLeaf(true);
      if (leaf) ws.setActiveLeaf(leaf, { focus: false });
    }

    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_WIDGET, active: true, state: {} });
    void ws.revealLeaf(leaf);
  }

  private async openAssistantWidgetSafe(): Promise<void> {
    try {
      await this.openAssistantWidget();
    } catch (e) {
      log.error("failed to open companion widget", e);
      new Notice(this._tx("ui.main.notice.assistantWidgetOpenFailed", "LearnKit – failed to open companion widget"));
    }
  }

  async openAssistantWidget(): Promise<void> {
    const ws = this.app.workspace;
    let leaf: WorkspaceLeaf | null = ws.getRightLeaf(false);

    if (leaf) {
      ws.setActiveLeaf(leaf, { focus: false });
      leaf = ws.getLeaf(false) ?? leaf;
    } else {
      leaf = ws.getRightLeaf(true);
      if (leaf) ws.setActiveLeaf(leaf, { focus: false });
    }

    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_STUDY_ASSISTANT, active: true, state: {} });
    void ws.revealLeaf(leaf);
  }

  refreshReminderEngine() {
    this._reminderEngine?.refresh();
  }

  private _registerReminderDevConsoleCommands() {
    if (typeof window === "undefined") return;

    const target = window as unknown as Record<string, unknown>;

    target.sproutReminderLaunch = (force = false) => {
      const ok = this._reminderEngine?.triggerStartupReminder(!!force) ?? false;
      return ok ? "startup reminder triggered" : "startup reminder not shown";
    };

    target.sproutReminderRoutine = (force = false) => {
      const ok = this._reminderEngine?.triggerRoutineReminder(!!force) ?? false;
      return ok ? "routine reminder triggered" : "routine reminder not shown";
    };

    target.sproutReminderGatekeeper = (force = false) => {
      const ok = this._reminderEngine?.triggerGatekeeper(!!force) ?? false;
      return ok ? "gatekeeper popup opened" : "gatekeeper popup not opened";
    };
  }

  private _unregisterReminderDevConsoleCommands() {
    if (typeof window === "undefined") return;
    const target = window as unknown as Record<string, unknown>;
    for (const name of this._reminderDevConsoleCommandNames) {
      delete target[name];
    }
  }

  // --------------------------------
  // Ribbon icons (desktop + mobile)
  // --------------------------------

  private _registerRibbonIcons() {
    // Always use separate icons now (desktop and mobile).
    // Also: keep the editor context-menu for "Insert Flashcard".

    this._destroyRibbonIcons();

    const add = (icon: string, title: string, onClick: (ev: MouseEvent) => void) => {
      const el = this.addRibbonIcon(icon, title, onClick);
      el.addClass("sprout-ribbon-action");
      el.addClass("bc");
      this._ribbonEls.push(el);
      return el;
    };

    // 1) Home - single instance by default, multiple with Cmd/Ctrl+Click
    add(SPROUT_BRAND_ICON_KEY, BRAND, (ev: MouseEvent) => {
      const forceNew = ev.metaKey || ev.ctrlKey;
      void this.openHomeTab(forceNew);
    });
  }
}
