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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = {}> = new (...args: any[]) => T;
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
}

/**
 * Method stubs provided by the mixin chain (Core → DataSync → Navigation →
 * ReminderRibbon → Lifecycle). Declaration-merged with the class so that
 * cross-mixin `this` references resolve correctly.
 */
export interface LearnKitPluginBase {
  // -- Core methods --
  _addCommand(id: string, name: string, callback: () => void | Promise<void>): void;
  _tx(token: string, fallback: string, vars?: Record<string, string | number>): string;
  refreshAssistantPopupFromSettings(): void;
  _closeAllAssistantWidgetInstances(): void;
  _openSingleTabView(viewType: string, forceNew?: boolean): Promise<WorkspaceLeaf>;
  _initBasecoatRuntime(): void;
  _stopBasecoatRuntime(): void;
  _isActiveHiddenViewType(): boolean;
  _updateStatusBarVisibility(leaf: WorkspaceLeaf | null): void;
  _migrateSettingsInPlace(): void;
  _normaliseSettingsInPlace(): void;
  _applySproutThemeAccentOverride(): void;
  _applySproutThemePreset(): void;
  _applySproutZoom(value: number): void;
  _queueSproutZoomSave(): void;
  _registerSproutPinchZoom(): void;
  _ensureSingleLeafOfType(viewType: string): WorkspaceLeaf | null;
  _destroyRibbonIcons(): void;
  _getActiveMarkdownFile(): TFile | null;
  _ensureEditingNoteEditor(): { view: MarkdownView; editor: Editor } | null;
  _applyClozeShortcutToEditor(editor: Editor, clozeIndex?: number): void;
  _registerMarkdownSourceClozeShortcuts(): void;
  openAddFlashcardModal(forcedType?: FlashcardType): void;
  _registerEditorContextMenu(): void;
  syncBank(): Promise<void>;
  refreshAllViews(): void;
  notifyWidgetCardsSynced(): void;
  refreshReadingViewMarkdownLeaves(): Promise<void>;
  _scheduleReadingViewRefresh(delayMs?: number): void;
  _isMainWorkspaceMarkdownLeaf(leaf: WorkspaceLeaf): boolean;
  _computeContentSignature(text: string): string;
  _getMarkdownLeafSource(leaf: WorkspaceLeaf): Promise<{ sourceContent: string; sourcePath: string }>;
  _startMarkdownModeWatcher(): void;
  _refreshOpenViews(): void;
  _initButtonTooltipDefaults(): void;

  // -- Data-sync methods --
  _runSync(): Promise<void>;
  _formatCurrentNoteSyncNotice(
    pageTitle: string,
    res: { newCount?: number; updatedCount?: number; removed?: number },
  ): string;
  _runSyncCurrentNote(): Promise<void>;
  saveAll(): Promise<void>;
  _getDataJsonPath(): string | null;
  _getConfigDirPath(): string | null;
  _getConfigFilePath(filename: string): string | null;
  _getApiKeysFilePath(): string | null;
  _doSave(): Promise<void>;
  refreshGithubStars(force?: boolean): Promise<void>;
  resetSettingsToDefaults(): Promise<void>;
  _isCardStateLike(v: unknown): v is CardState;
  resetAllCardScheduling(): Promise<void>;
  _clearAllNoteSchedulingState(): Promise<number>;
  resetAllNoteScheduling(): Promise<void>;
  resetAllAnalyticsData(): Promise<void>;

  // -- Navigation methods --
  openReviewerTab(forceNew?: boolean): Promise<void>;
  openNoteReviewTab(forceNew?: boolean): Promise<void>;
  openHomeTab(forceNew?: boolean): Promise<void>;
  openBrowserTab(forceNew?: boolean): Promise<void>;
  openAnalyticsTab(forceNew?: boolean): Promise<void>;
  openSettingsTab(forceNew?: boolean, targetTab?: string): Promise<void>;
  openExamGeneratorTab(forceNew?: boolean): Promise<void>;
  openExamGeneratorTest(testId: string): Promise<void>;
  openExamGeneratorScope(scope: Scope): Promise<void>;
  openExamGeneratorScopes(scopes: Scope[], targetLeaf?: WorkspaceLeaf): Promise<void>;
  openCoachTab(
    forceNew?: boolean,
    options?: { suppressEntranceAos?: boolean; refresh?: boolean },
    targetLeaf?: WorkspaceLeaf,
  ): Promise<void>;
  openReviewerScope(scope: Scope): Promise<void>;
  openReviewerScopeWithOptions(
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
  ): Promise<void>;
  openNoteReviewScope(scope: Scope): Promise<void>;
  openNoteReviewScopeWithOptions(
    scope: Scope,
    options: {
      targetCount?: number;
      includeNotDue?: boolean;
      noScheduling?: boolean;
      trackCoachProgress?: boolean;
    },
    targetLeaf?: WorkspaceLeaf,
  ): Promise<void>;
  recordCoachProgressForScope(scope: Scope, kind: "flashcard" | "note", by?: number): Promise<void>;
  openPluginSettingsInObsidian(): void;
  openWidgetSafe(): Promise<void>;
  openWidget(): Promise<void>;
  openAssistantWidgetSafe(): Promise<void>;
  openAssistantWidget(): Promise<void>;

  // -- Reminder & ribbon methods --
  refreshReminderEngine(): void;
  _registerReminderDevConsoleCommands(): void;
  _unregisterReminderDevConsoleCommands(): void;
  _registerRibbonIcons(): void;
  _registerBrandIcons(): void;

  // -- Lifecycle methods --
  _registerCommands(): void;
  onload(): Promise<void>;
  onunload(): void;
}

// Backwards-compatible alias retained for Phase 1 rename safety.
export { LearnKitPluginBase as SproutPluginBase };
