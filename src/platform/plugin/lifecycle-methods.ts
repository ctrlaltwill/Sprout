/**
 * @file src/platform/plugin/lifecycle-methods.ts
 * @summary Module for lifecycle methods.
 *
 * @exports
 *  - WithLifecycleMethods
 */

import { Notice, TAbstractFile, TFile, Platform, type WorkspaceLeaf } from "obsidian";
import { LearnKitPluginBase, type Constructor } from "./plugin-base";

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
  LEGACY_VIEW_TYPE_REVIEWER,
  LEGACY_VIEW_TYPE_WIDGET,
  LEGACY_VIEW_TYPE_STUDY_ASSISTANT,
  LEGACY_VIEW_TYPE_BROWSER,
  LEGACY_VIEW_TYPE_ANALYTICS,
  LEGACY_VIEW_TYPE_HOME,
  LEGACY_VIEW_TYPE_SETTINGS,
  LEGACY_VIEW_TYPE_EXAM_GENERATOR,
  LEGACY_VIEW_TYPE_COACH,
  LEGACY_TO_CURRENT_VIEW_TYPES,
  BRAND,
  DEFAULT_SETTINGS,
  deepMerge,
  type SproutSettings,
} from "../core/constants";
import { log } from "../core/logger";
import { isPlainObject, type FlashcardType } from "../core/utils";
import { registerReadingViewPrettyCards, teardownReadingView } from "../../views/reading/reading-view";
import { removeAosErrorHandler } from "../core/aos-loader";
import { initTooltipPositioner } from "../core/tooltip-positioner";
import { initMobileKeyboardHandler, cleanupMobileKeyboardHandler } from "../core/mobile-keyboard-handler";

import { JsonStore } from "../core/store";
import { SqliteStore, isSqliteDatabasePresent, reconcileAllDbsFromVaultSync } from "../core/sqlite-store";
import { migrateJsonToSqlite } from "../core/migration";
import { SproutReviewerView } from "../../views/reviewer/review-view";
import { SproutWidgetView } from "../../views/widget/view/widget-view";
import { SproutAssistantPopup } from "../../views/study-assistant/popup/assistant-popup";
import { SproutStudyAssistantView } from "../../views/study-assistant/view/study-assistant-view";
import { SproutCardBrowserView } from "../../views/browser/card-browser-view";
import { SproutAnalyticsView } from "../../views/analytics/analytics-view";
import { SproutHomeView } from "../../views/home/home-view";
import { LearnKitSettingsTab } from "../../views/settings/settings-tab";
import { LearnKitSettingsView } from "../../views/settings/view/settings-view";
import { SproutNoteReviewView } from "../../views/note-review/view/note-review-view";
import { SproutExamGeneratorView } from "../../views/exam-generator/exam-generator-view";
import { SproutCoachView } from "../../views/coach";
import { CoachPlanSqlite } from "../core/coach-plan-sqlite";
import { syncQuestionBank } from "../integrations/sync/sync-engine";
import { CardCreatorModal } from "../modals/card-creator-modal";
import { ParseErrorModal } from "../modals/parse-error-modal";
import { setDelimiter } from "../core/delimiter";
import {
  initialiseDedicatedApiKeyStorage,
  migrateLegacyConfigFiles,
} from "../core/settings-storage";
import { ReminderEngine } from "../../views/reminders/reminder-engine";
import { ensurePluginRuntimeState } from "./runtime-state";

export function WithLifecycleMethods<T extends Constructor<LearnKitPluginBase>>(Base: T) {
  return class WithLifecycleMethods extends Base {
    _registerCommands(): void {
      this._addCommand("sync-flashcards-current-note", "Sync flashcards from current note", async () => this._runSyncCurrentNote());
      this._addCommand("sync-flashcards", "Sync all flashcards from the vault", async () => this._runSync());
      this._addCommand("open", "Open home", async () => this.openHomeTab());
      this._addCommand("open-widget", "Open flashcard study widget", async () => this.openWidgetSafe());
      this.addCommand({
        id: "open-assistant-widget",
        name: "Open study companion widget",
        checkCallback: (checking: boolean) => {
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
        const { AnkiImportModal } = await import("../modals/anki-import-modal");
        new AnkiImportModal(this).open();
      });

      this._addCommand("export-anki", "Export to Anki (.apkg)", async () => {
        const { AnkiExportModal } = await import("../modals/anki-export-modal");
        new AnkiExportModal(this).open();
      });
    }

    async onload(): Promise<void> {
      ensurePluginRuntimeState(this);
      try {
        this._initBasecoatRuntime();

        this._disposeTooltipPositioner?.();
        this._disposeTooltipPositioner = initTooltipPositioner();

        this._initButtonTooltipDefaults();

        initMobileKeyboardHandler();

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
          LearnKitSettingsView,
          LearnKitSettingsTab,
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
        await migrateLegacyConfigFiles({
          adapter: this.app?.vault?.adapter,
          getConfigFilePath: (filename: string) => this._getConfigFilePath(filename),
          settings: this.settings,
        });
        this._migrateSettingsInPlace();
        this._normaliseSettingsInPlace();
        this._applySproutThemePreset();
        this._applySproutThemeAccentOverride();
        await initialiseDedicatedApiKeyStorage({
          adapter: this.app?.vault?.adapter,
          dirPath: this._getConfigDirPath(),
          filePath: this._getApiKeysFilePath(),
          settings: this.settings,
        });
        this._registerSproutPinchZoom();

        setDelimiter(this.settings.indexing.delimiter ?? "|");

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

        if (!(this.store instanceof SqliteStore) && !this.store.loadedFromDisk && isPlainObject(root)) {
          log.warn(
            "data.json existed but contained no .store - initial save will be guarded by assessPersistSafety.",
          );
        }

        registerReadingViewPrettyCards(this);

        this.registerView(VIEW_TYPE_REVIEWER, (leaf: WorkspaceLeaf) => new SproutReviewerView(leaf, this));
        this.registerView(VIEW_TYPE_NOTE_REVIEW, (leaf: WorkspaceLeaf) => new SproutNoteReviewView(leaf, this));
        this.registerView(VIEW_TYPE_WIDGET, (leaf: WorkspaceLeaf) => new SproutWidgetView(leaf, this));
        this.registerView(VIEW_TYPE_STUDY_ASSISTANT, (leaf: WorkspaceLeaf) => new SproutStudyAssistantView(leaf, this));
        this.registerView(VIEW_TYPE_BROWSER, (leaf: WorkspaceLeaf) => new SproutCardBrowserView(leaf, this));
        this.registerView(VIEW_TYPE_ANALYTICS, (leaf: WorkspaceLeaf) => new SproutAnalyticsView(leaf, this));
        this.registerView(VIEW_TYPE_HOME, (leaf: WorkspaceLeaf) => new SproutHomeView(leaf, this));
        this.registerView(VIEW_TYPE_SETTINGS, (leaf: WorkspaceLeaf) => new LearnKitSettingsView(leaf, this));
        this.registerView(VIEW_TYPE_EXAM_GENERATOR, (leaf: WorkspaceLeaf) => new SproutExamGeneratorView(leaf, this));
        this.registerView(VIEW_TYPE_COACH, (leaf: WorkspaceLeaf) => new SproutCoachView(leaf, this));

        // Legacy view-type aliases keep existing workspace tabs functional after renaming IDs.
        this.registerView(LEGACY_VIEW_TYPE_REVIEWER, (leaf: WorkspaceLeaf) => new SproutReviewerView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_WIDGET, (leaf: WorkspaceLeaf) => new SproutWidgetView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_STUDY_ASSISTANT, (leaf: WorkspaceLeaf) => new SproutStudyAssistantView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_BROWSER, (leaf: WorkspaceLeaf) => new SproutCardBrowserView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_ANALYTICS, (leaf: WorkspaceLeaf) => new SproutAnalyticsView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_HOME, (leaf: WorkspaceLeaf) => new SproutHomeView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_SETTINGS, (leaf: WorkspaceLeaf) => new LearnKitSettingsView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_EXAM_GENERATOR, (leaf: WorkspaceLeaf) => new SproutExamGeneratorView(leaf, this));
        this.registerView(LEGACY_VIEW_TYPE_COACH, (leaf: WorkspaceLeaf) => new SproutCoachView(leaf, this));

        this._coachDb = new CoachPlanSqlite(this);
        await this._coachDb.open();

        this.addSettingTab(new LearnKitSettingsTab(this.app, this));

        this._registerCommands();

        this._registerBrandIcons();

        this._registerRibbonIcons();
        this._registerEditorContextMenu();
        this._registerMarkdownSourceClozeShortcuts();

        this.registerEvent(
          this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
            this._updateStatusBarVisibility(leaf ?? null);
            this._assistantPopup?.onActiveLeafChange();
          }),
        );

        this.registerEvent(
          this.app.workspace.on("file-open", (file: TFile | null) => {
            const f = file instanceof TFile ? file : null;
            this._assistantPopup?.onFileOpen(f);
            this.app.workspace
              .getLeavesOfType(VIEW_TYPE_WIDGET)
              .forEach((leaf: WorkspaceLeaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
            this.app.workspace
              .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
              .forEach((leaf: WorkspaceLeaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
          }),
        );

        this.registerEvent(
          this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile && file.path.toLowerCase().endsWith(".md")) {
              void this._assistantPopup?.onFileRename(oldPath, file);
            }
          }),
        );

        this.app.workspace.onLayoutReady(() => {
          void (async () => {
            // Migrate open leaves to canonical LearnKit view IDs so future lookups use one namespace.
            for (const [legacyType, currentType] of Object.entries(LEGACY_TO_CURRENT_VIEW_TYPES)) {
              const leaves = this.app.workspace.getLeavesOfType(legacyType);
              for (const leaf of leaves) {
                try {
                  const state = leaf.getViewState();
                  await leaf.setViewState({ ...state, type: currentType, active: state.active });
                } catch (e) {
                  log.swallow(`migrate legacy view type ${legacyType} -> ${currentType}`, e);
                }
              }
            }
          })();

          this._updateStatusBarVisibility(null);

          this._assistantPopup = new SproutAssistantPopup(this);
          this._assistantPopup.mount();
          this._assistantPopup.onActiveLeafChange();
          this.refreshAssistantPopupFromSettings();
          this._startMarkdownModeWatcher();

          this._reminderEngine?.start();
        });

        await this.saveAll();
        void this.refreshGithubStars();
        log.info("loaded");
      } catch (e) {
        log.error("failed to load", e);
        new Notice(this._tx("ui.main.notice.loadFailed", "LearnKit - failed to load"));
      }
    }

    onunload(): void {
      const pending = this._saving ?? Promise.resolve();
      void pending
        .then(() => this._doSave())
        .catch((e: unknown) => log.swallow("save all on unload", e));

      if (this.store instanceof SqliteStore) {
        void this.store.close().catch((e: unknown) => log.swallow("close sqlite store", e));
      }
      if (this._coachDb) {
        void this._coachDb.close().catch((e: unknown) => log.swallow("close coach sqlite", e));
        this._coachDb = null;
      }

      this._bc = null;
      this._destroyRibbonIcons();
      document.body.classList.remove("learnkit-hide-status-bar", "learnkit-hide-status-bar");
      document.body.classList.remove("is-phone");
      document.body.style.removeProperty("--learnkit-theme-accent-override");
      document.body.style.removeProperty("--learnkit-leaf-zoom");
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

      teardownReadingView();

      removeAosErrorHandler();

      cleanupMobileKeyboardHandler();

      this._assistantPopup?.destroy();
      this._assistantPopup = null;

      this._stopBasecoatRuntime();
    }
  };
}
