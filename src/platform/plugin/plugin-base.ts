/**
 * @file src/platform/plugin/plugin-base.ts
 * @summary Module for plugin base.
 *
 * @exports
 *  - LearnKitPluginBase
 *  - SproutPluginBase
 */

import { Plugin, type Editor, type MarkdownView, type TFile, type WorkspaceLeaf } from "obsidian";

import { DEFAULT_SETTINGS, type LearnKitSettings } from "../core/constants";

export type Constructor<T = NonNullable<unknown>> = new (...args: any[]) => T;
import type { IStore } from "../core/store-interface";
import type { FlashcardType } from "../core/utils";
import type { BasecoatApi } from "../core/basecoat";
import type { Scope } from "../../views/reviewer/types";
import type { ReminderEngine } from "../../views/reminders/reminder-engine";
import type { SproutAssistantPopup } from "../../views/study-assistant/popup/assistant-popup";
import type { CoachPlanSqlite } from "../core/coach-plan-sqlite";
import type { CardState } from "../../engine/scheduler/scheduler";

export class LearnKitPluginBase extends Plugin {
  declare settings: LearnKitSettings;
  declare store: IStore;
  _bc: unknown = null;
  declare _basecoatApi: BasecoatApi | null;
  isWideMode = false;
  readonly DEFAULT_SETTINGS: LearnKitSettings = DEFAULT_SETTINGS;

  declare _basecoatStarted: boolean;
  declare _saving: Promise<void> | null;
  declare _ribbonEls: HTMLElement[];
  declare _hideStatusBarViewTypes: Set<string>;
  declare _sproutZoomValue: number;
  declare _sproutZoomSaveTimer: number | null;
  declare _disposeTooltipPositioner: (() => void) | null;
  declare _reminderEngine: ReminderEngine | null;
  declare _assistantPopup: SproutAssistantPopup | null;
  declare _coachDb: CoachPlanSqlite | null;
  declare _readingViewRefreshTimer: number | null;
  declare _readingModeWatcherInterval: number | null;
  declare _markdownLeafModeSnapshot: WeakMap<WorkspaceLeaf, "source" | "preview">;
  declare _markdownLeafContentSnapshot: WeakMap<WorkspaceLeaf, string>;
  declare _reminderDevConsoleCommandNames: readonly string[];
  declare _refreshableViewTypes: string[];

  // -- Core methods (provided by mixin chain) --
  declare _addCommand: (id: string, name: string, callback: () => void | Promise<void>) => void;
  declare _tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string;
  declare refreshAssistantPopupFromSettings: () => void;
  declare _closeAllAssistantWidgetInstances: () => void;
  declare _openSingleTabView: (viewType: string, forceNew?: boolean) => Promise<WorkspaceLeaf>;
  declare _initBasecoatRuntime: () => void;
  declare _stopBasecoatRuntime: () => void;
  declare _isActiveHiddenViewType: () => boolean;
  declare _updateStatusBarVisibility: (leaf: WorkspaceLeaf | null) => void;
  declare _migrateSettingsInPlace: () => void;
  declare _normaliseSettingsInPlace: () => void;
  declare _applySproutThemeAccentOverride: () => void;
  declare _applySproutThemePreset: () => void;
  declare _applySproutZoom: (value: number) => void;
  declare _queueSproutZoomSave: () => void;
  declare _registerSproutPinchZoom: () => void;
  declare _ensureSingleLeafOfType: (viewType: string) => WorkspaceLeaf | null;
  declare _destroyRibbonIcons: () => void;
  declare _getActiveMarkdownFile: () => TFile | null;
  declare _ensureEditingNoteEditor: () => { view: MarkdownView; editor: Editor } | null;
  declare _applyClozeShortcutToEditor: (editor: Editor, clozeIndex?: number) => void;
  declare _registerMarkdownSourceClozeShortcuts: () => void;
  declare openAddFlashcardModal: (forcedType?: FlashcardType) => void;
  declare _registerEditorContextMenu: () => void;
  declare syncBank: () => Promise<void>;
  declare refreshAllViews: () => void;
  declare notifyWidgetCardsSynced: () => void;
  declare refreshReadingViewMarkdownLeaves: () => Promise<void>;
  declare _scheduleReadingViewRefresh: (delayMs?: number) => void;
  declare _isMainWorkspaceMarkdownLeaf: (leaf: WorkspaceLeaf) => boolean;
  declare _computeContentSignature: (text: string) => string;
  declare _getMarkdownLeafSource: (leaf: WorkspaceLeaf) => Promise<{ sourceContent: string; sourcePath: string }>;
  declare _startMarkdownModeWatcher: () => void;
  declare _refreshOpenViews: () => void;
  declare _initButtonTooltipDefaults: () => void;

  // -- Data-sync methods --
  declare _runSync: () => Promise<void>;
  declare _formatCurrentNoteSyncNotice: (
    pageTitle: string,
    res: { newCount?: number; updatedCount?: number; removed?: number },
  ) => string;
  declare _runSyncCurrentNote: () => Promise<void>;
  declare saveAll: () => Promise<void>;
  declare _getDataJsonPath: () => string | null;
  declare _getConfigDirPath: () => string | null;
  declare _getConfigFilePath: (filename: string) => string | null;
  declare _getApiKeysFilePath: () => string | null;
  declare _getTtsApiKeysFilePath: () => string | null;
  declare _doSave: () => Promise<void>;
  declare refreshGithubStars: (force?: boolean) => Promise<void>;
  declare resetSettingsToDefaults: () => Promise<void>;
  declare _isCardStateLike: (v: unknown) => v is CardState;
  declare resetAllCardScheduling: () => Promise<void>;
  declare _clearAllNoteSchedulingState: () => Promise<number>;
  declare resetAllNoteScheduling: () => Promise<void>;
  declare resetAllAnalyticsData: () => Promise<void>;

  // -- Navigation methods --
  declare openReviewerTab: (forceNew?: boolean) => Promise<void>;
  declare openNoteReviewTab: (forceNew?: boolean) => Promise<void>;
  declare openHomeTab: (forceNew?: boolean) => Promise<void>;
  declare openBrowserTab: (forceNew?: boolean) => Promise<void>;
  declare openAnalyticsTab: (forceNew?: boolean) => Promise<void>;
  declare openSettingsTab: (forceNew?: boolean, targetTab?: string) => Promise<void>;
  declare openExamGeneratorTab: (forceNew?: boolean) => Promise<void>;
  declare openExamGeneratorTest: (testId: string) => Promise<void>;
  declare openExamGeneratorScope: (scope: Scope) => Promise<void>;
  declare openExamGeneratorScopes: (scopes: Scope[], targetLeaf?: WorkspaceLeaf) => Promise<void>;
  declare openCoachTab: (
    forceNew?: boolean,
    options?: { suppressEntranceAos?: boolean; refresh?: boolean },
    targetLeaf?: WorkspaceLeaf,
  ) => Promise<void>;
  declare openReviewerScope: (scope: Scope) => Promise<void>;
  declare openReviewerScopeWithOptions: (
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
  ) => Promise<void>;
  declare openNoteReviewScope: (scope: Scope) => Promise<void>;
  declare openNoteReviewScopeWithOptions: (
    scope: Scope,
    options: {
      targetCount?: number;
      includeNotDue?: boolean;
      noScheduling?: boolean;
      trackCoachProgress?: boolean;
    },
    targetLeaf?: WorkspaceLeaf,
  ) => Promise<void>;
  declare recordCoachProgressForScope: (scope: Scope, kind: "flashcard" | "note", by?: number) => Promise<void>;
  declare openPluginSettingsInObsidian: () => void;
  declare openWidgetSafe: () => Promise<void>;
  declare openWidget: () => Promise<void>;
  declare openAssistantWidgetSafe: () => Promise<void>;
  declare openAssistantWidget: () => Promise<void>;

  // -- Reminder & ribbon methods --
  declare refreshReminderEngine: () => void;
  declare _registerReminderDevConsoleCommands: () => void;
  declare _unregisterReminderDevConsoleCommands: () => void;
  declare _registerRibbonIcons: () => void;
  declare _registerBrandIcons: () => void;

  // -- Lifecycle methods --
  declare _registerCommands: () => void;

  // Narrow Plugin's `onload(): Promise<void> | void` so that the
  // mixin chain sees a consistent `Promise<void>` return type.
  async onload(): Promise<void> {}
}

// Backwards-compatible alias retained for Phase 1 rename safety.
export { LearnKitPluginBase as SproutPluginBase };
