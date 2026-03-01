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
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  VIEW_TYPE_SETTINGS,
  BRAND,
  DEFAULT_SETTINGS,
  deepMerge,
  type SproutSettings,
} from "./core/constants";

import { log } from "./core/logger";
import { clamp, clonePlain, isPlainObject, type FlashcardType } from "./core/utils";
import { getBasecoatApi } from "./core/basecoat";
import { migrateSettingsInPlace } from "./settings/settings-migration";
import { normaliseSettingsInPlace } from "./settings/settings-normalisation";
import { registerReadingViewPrettyCards, teardownReadingView } from "./reading/reading-view";
import { removeAosErrorHandler } from "./core/aos-loader";
import { initTooltipPositioner } from "./core/tooltip-positioner";
import { initButtonTooltipDefaults } from "./core/tooltip-defaults";
import { initMobileKeyboardHandler, cleanupMobileKeyboardHandler } from "./core/mobile-keyboard-handler";

import { JsonStore } from "./core/store";
import { queryFirst } from "./core/ui";
import { SproutReviewerView } from "./reviewer/review-view";
import { SproutWidgetView } from "./widget/sprout-widget-view";
import { SproutCardBrowserView } from "./browser/sprout-card-browser-view";
import { SproutAnalyticsView } from "./analytics/analytics-view";
import { SproutHomeView } from "./home/sprout-home-view";
import { SproutSettingsTab } from "./settings/sprout-settings-tab";
import { SproutSettingsView } from "./settings/sprout-settings-view";
import { formatSyncNotice, syncQuestionBank } from "./sync/sync-engine";
import { joinPath, safeStatMtime, createDataJsonBackupNow } from "./sync/backup";
import { CardCreatorModal } from "./modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "./modals/image-occlusion-creator-modal";
import { ParseErrorModal } from "./modals/parse-error-modal";
import { setDelimiter } from "./core/delimiter";
// Anki modals are lazy-loaded to defer sql.js WASM parsing until needed
// import { AnkiImportModal } from "./modals/anki-import-modal";
// import { AnkiExportModal } from "./modals/anki-export-modal";
import { resetCardScheduling, type CardState } from "./scheduler/scheduler";
import { WhatsNewModal, hasReleaseNotes } from "./modals/whats-new-modal";
import { checkForVersionUpgrade, loadVersionTracking, getVersionTrackingData } from "./core/version-manager";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import React from "react";


const SPROUT_RIBBON_BRAND_ICON = `<svg viewBox="0 0 1536 1536" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="matrix(13.970297,0,0,13.970297,-11267.410891,-2326.950495)"><path fill="currentColor" d="M857.924,173.62C857.924,173.606 857.924,173.591 857.924,173.576C857.924,171.603 859.526,170 861.5,170C863.474,170 865.076,171.603 865.076,173.576C865.076,173.591 865.076,173.606 865.076,173.62L864.621,210.894L886.162,180.471C886.171,180.459 886.179,180.448 886.188,180.436C887.348,178.839 889.586,178.484 891.183,179.645C892.78,180.805 893.135,183.043 891.974,184.64C891.966,184.652 891.957,184.664 891.948,184.675L869.671,214.563L904.98,202.612C904.994,202.608 905.008,202.603 905.022,202.598C906.899,201.988 908.918,203.017 909.528,204.895C910.138,206.772 909.109,208.791 907.232,209.401C907.218,209.406 907.204,209.41 907.191,209.414L871.6,220.5L907.191,231.586C907.204,231.59 907.218,231.594 907.232,231.599C909.109,232.209 910.138,234.228 909.528,236.105C908.918,237.983 906.899,239.012 905.022,238.402C905.008,238.397 904.994,238.392 904.98,238.388L869.671,226.437L891.948,256.325C891.957,256.336 891.966,256.348 891.974,256.36C893.135,257.957 892.78,260.195 891.183,261.355C889.586,262.516 887.348,262.161 886.188,260.564C886.179,260.552 886.171,260.541 886.162,260.529L864.621,230.106L865.076,267.38C865.076,267.394 865.076,267.409 865.076,267.424C865.076,269.397 863.474,271 861.5,271C859.526,271 857.924,269.397 857.924,267.424C857.924,267.409 857.924,267.394 857.924,267.38L858.379,230.106L836.838,260.529C836.829,260.541 836.821,260.552 836.812,260.564C835.652,262.161 833.414,262.516 831.817,261.355C830.22,260.195 829.865,257.957 831.026,256.36C831.034,256.348 831.043,256.336 831.052,256.325L853.329,226.437L818.02,238.388C818.006,238.392 817.992,238.397 817.978,238.402C816.101,239.012 814.082,237.983 813.472,236.105C812.862,234.228 813.891,232.209 815.768,231.599C815.782,231.594 815.796,231.59 815.809,231.586L851.4,220.5L815.809,209.414C815.796,209.41 815.782,209.406 815.768,209.401C813.891,208.791 812.862,206.772 813.472,204.895C814.082,203.017 816.101,201.988 817.978,202.598C817.992,202.603 818.006,202.608 818.02,202.612L853.329,214.563L831.052,184.675C831.043,184.664 831.034,184.652 831.026,184.64C829.865,183.043 830.22,180.805 831.817,179.645C833.414,178.484 835.652,178.839 836.812,180.436C836.821,180.448 836.829,180.459 836.838,180.471L858.379,210.894L857.924,173.62Z"/></g></svg>`;



export default class SproutPlugin extends Plugin {
  settings!: SproutSettings;
  store!: JsonStore;
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
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    VIEW_TYPE_SETTINGS,
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

  private readonly _refreshableViewTypes = [
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_WIDGET,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    VIEW_TYPE_SETTINGS,
  ];

  private _addCommand(
    id: string,
    name: string,
    callback: () => void | Promise<void>,
  ) {
    this.addCommand({ id, name, callback });
  }

  private _registerCommands() {
    this._addCommand("sync-flashcards", "Sync flashcards", async () => this._runSync());
    this._addCommand("open", "Open home", async () => this.openHomeTab());
    this._addCommand("open-widget", "Open widget", async () => this.openWidgetSafe());
    this._addCommand("open-analytics", "Open analytics", async () => this.openAnalyticsTab());
    this._addCommand("open-settings", "Open plugin settings", () => this.openPluginSettingsInObsidian());
    this._addCommand("open-guide", "Open guide", async () => this.openSettingsTab(false, "guide"));
    this._addCommand("edit-flashcards", "Edit flashcards", async () => this.openBrowserTab());
    this._addCommand("new-study-session", "New study session", async () => this.openReviewerTab());

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
      const { AnkiImportModal } = await import("./modals/anki-import-modal");
      new AnkiImportModal(this).open();
    });

    this._addCommand("export-anki", "Export to Anki (.apkg)", async () => {
      const { AnkiExportModal } = await import("./modals/anki-export-modal");
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

      // Ensure all buttons use `data-tooltip` and never rely on native `title` tooltips.
      this.register(initButtonTooltipDefaults());

      // Initialize mobile keyboard handler for adaptive bottom padding
      initMobileKeyboardHandler();

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
      this._migrateSettingsInPlace();
      this._normaliseSettingsInPlace();
      this._registerSproutPinchZoom();

      // Activate the user's chosen delimiter before any parsing occurs
      setDelimiter(this.settings.indexing.delimiter ?? "|");

      this.store = new JsonStore(this);
      this.store.load(rootObj);

      // Load version tracking from data.json
      loadVersionTracking(rootObj);

      if (!this.store.loadedFromDisk && isPlainObject(root)) {
        log.warn(
          "data.json existed but contained no .store — " +
          "initial save will be guarded by assessPersistSafety.",
        );
      }

      registerReadingViewPrettyCards(this);

      this.registerView(VIEW_TYPE_REVIEWER, (leaf) => new SproutReviewerView(leaf, this));
      this.registerView(VIEW_TYPE_WIDGET, (leaf) => new SproutWidgetView(leaf, this));
      this.registerView(VIEW_TYPE_BROWSER, (leaf) => new SproutCardBrowserView(leaf, this));
      this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new SproutAnalyticsView(leaf, this));
      this.registerView(VIEW_TYPE_HOME, (leaf) => new SproutHomeView(leaf, this));
      this.registerView(VIEW_TYPE_SETTINGS, (leaf) => new SproutSettingsView(leaf, this));

      this.addSettingTab(new SproutSettingsTab(this.app, this));

      // Commands (hotkeys default to none; users can bind in Settings → Hotkeys)
      this._registerCommands();

      // Register custom branded ribbon icon from branding/Sprout Icon.svg artwork.
      addIcon("sprout-ribbon-brand", SPROUT_RIBBON_BRAND_ICON);

      // Replace dropdown with separate ribbon icons (desktop + mobile)
      this._registerRibbonIcons();
      this._registerEditorContextMenu();
      this._registerMarkdownSourceClozeShortcuts();

      // Hide status bar when Sprout views are active
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          this._updateStatusBarVisibility(leaf ?? null);
        }),
      );

      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          const f = file instanceof TFile ? file : null;
          this.app.workspace
            .getLeavesOfType(VIEW_TYPE_WIDGET)
            .forEach((leaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
        }),
      );

      this.app.workspace.onLayoutReady(() => {
        // Ensure status bar class matches the active view after layout settles
        this._updateStatusBarVisibility(null);
        
        // Check for version upgrades and show What's New modal if needed
        this._checkAndShowWhatsNewModal();
      });

      await this.saveAll();
      void this.refreshGithubStars();
      log.info(`loaded`);
    } catch (e) {
      log.error(`failed to load`, e);
      new Notice(`Failed to load. See console for details.`);
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

    this._bc = null;
    this._destroyRibbonIcons();
    document.body.classList.remove("sprout-hide-status-bar");
    document.body.style.removeProperty("--sprout-leaf-zoom");
    if (this._sproutZoomSaveTimer != null) {
      window.clearTimeout(this._sproutZoomSaveTimer);
      this._sproutZoomSaveTimer = null;
    }

    this._disposeTooltipPositioner?.();
    this._disposeTooltipPositioner = null;

    // Clean up What's New modal
    this._closeWhatsNewModal();

    // Tear down reading-view observers + window listeners
    teardownReadingView();

    // Remove global AOS error suppression handler
    removeAosErrorHandler();

    // Clean up mobile keyboard handler
    cleanupMobileKeyboardHandler();

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
      
      if (shouldShow && version && hasReleaseNotes(version)) {
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
      new Notice("Must be editing a note to add a flashcard");
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
          item.setTitle("Add flashcard").setIcon("plus");

          // Create submenu
          const submenu = item.setSubmenu?.();
          if (submenu) {
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Basic").setIcon("file-text").onClick(() => this.openAddFlashcardModal("basic"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Basic (reversed)").setIcon("file-text").onClick(() => this.openAddFlashcardModal("reversed"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Cloze").setIcon("file-minus").onClick(() => this.openAddFlashcardModal("cloze"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Multiple choice").setIcon("list").onClick(() => this.openAddFlashcardModal("mcq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Ordered question").setIcon("list-ordered").onClick(() => this.openAddFlashcardModal("oq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Image occlusion").setIcon("image").onClick(() => this.openAddFlashcardModal("io"));
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

  public refreshReadingViewMarkdownLeaves(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const container = leaf.view?.containerEl ?? null;
      if (!(container instanceof HTMLElement)) continue;

      const content = queryFirst(
        container,
        ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
      );
      if (!(content instanceof HTMLElement)) continue;

      const scrollHost =
        content.closest(".markdown-reading-view, .markdown-preview-view, .markdown-rendered") ??
        content;
      const prevTop = Number(scrollHost.scrollTop || 0);
      const prevLeft = Number(scrollHost.scrollLeft || 0);

      try {
        content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", { bubbles: true }));
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
            content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", { bubbles: true }));
          } catch (e) {
            log.swallow("dispatch reading view refresh (post-rerender)", e);
          }
        });
      });
    }
  }

  async _runSync() {
    const res = await syncQuestionBank(this);

    const notice = formatSyncNotice("Sync complete", res, { includeDeleted: true });
    new Notice(notice);

    const tagsDeleted = Number((res as { tagsDeleted?: number }).tagsDeleted ?? 0);
    if (tagsDeleted > 0) {
      new Notice(`Deleted ${tagsDeleted}, unused tag${tagsDeleted === 1 ? "" : "s"}`);
    }

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }
    // Do not refresh or update views; sync runs in background and only shows notice when done.
  }

  async saveAll() {
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

  private async _doSave() {
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

      root.settings = this.settings;
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
    root.settings = this.settings;
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

  private _resetCardStateMapInPlace(map: Record<string, unknown>, now: number): number {
    let count = 0;

    for (const [id, raw] of Object.entries(map)) {
      if (!this._isCardStateLike(raw)) continue;

      const prev: CardState = { id, ...(raw as Record<string, unknown>) } as CardState;
      map[id] = resetCardScheduling(prev, now);
      count++;
    }

    return count;
  }

  private _looksLikeCardStateMap(node: unknown): node is Record<string, unknown> {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return false;

    for (const v of Object.values(node)) {
      if (this._isCardStateLike(v)) return true;
    }
    return false;
  }

  async resetAllCardScheduling(): Promise<void> {
    const now = Date.now();
    let total = 0;

    const visited = new Set<object>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      if (this._looksLikeCardStateMap(node)) {
        total += this._resetCardStateMapInPlace(node, now);
      }

      for (const v of Object.values(node)) walk(v);
    };

    walk(this.store.data);

    await this.saveAll();
    this._refreshOpenViews();

    new Notice(`Reset scheduling for ${total} cards.`);
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

    new Notice("Analytics data cleared.");
  }

  async openReviewerTab(forceNew: boolean = false) {
    await this._openSingleTabView(VIEW_TYPE_REVIEWER, forceNew);
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
          view.navigateToTab(resolvedTargetTab);
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
        view.navigateToTab(resolvedTargetTab);
      }
    }, 50);
  }

  openPluginSettingsInObsidian() {
    const settings = this.app.setting;
    if (!settings) {
      new Notice("Obsidian settings are unavailable.");
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
      new Notice(`Failed to open widget. See console for details.`);
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
    add("sprout-ribbon-brand", BRAND, (ev: MouseEvent) => {
      const forceNew = ev.metaKey || ev.ctrlKey;
      void this.openHomeTab(forceNew);
    });
  }
}
