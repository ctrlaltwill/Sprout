import { Notice, type WorkspaceLeaf } from "obsidian";
import { LearnKitPluginBase } from "./plugin-base";
import type { Scope } from "../../views/reviewer/types";
import type { SproutSettingsView } from "../../views/settings/view/settings-view";
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
} from "../core/constants";
import { CoachPlanSqlite, type CoachScopeType } from "../core/coach-plan-sqlite";
import { log } from "../core/logger";

export function installNavigationMethods(pluginClass: typeof LearnKitPluginBase): void {
  Object.assign(pluginClass.prototype, {
    async openReviewerTab(this: LearnKitPluginBase, forceNew: boolean = false): Promise<void> {
      const leaf = await this._openSingleTabView(VIEW_TYPE_REVIEWER, forceNew);
      const view = leaf.view as { setReturnToCoach?: (enabled: boolean) => void } | undefined;
      view?.setReturnToCoach?.(false);
    },

    async openNoteReviewTab(this: LearnKitPluginBase, forceNew: boolean = false): Promise<void> {
      const leaf = await this._openSingleTabView(VIEW_TYPE_NOTE_REVIEW, forceNew);
      const view = leaf.view as {
        setReturnToCoach?: (enabled: boolean) => void;
        setCoachScope?: (s: Scope | null) => void;
        setIgnoreDailyReviewLimit?: (enabled: boolean) => void;
      } | undefined;
      view?.setReturnToCoach?.(false);
      view?.setCoachScope?.(null);
      view?.setIgnoreDailyReviewLimit?.(false);
    },

    async openHomeTab(this: LearnKitPluginBase, forceNew: boolean = false): Promise<void> {
      if (!forceNew) {
        const existing = this._ensureSingleLeafOfType(VIEW_TYPE_HOME);
        if (existing) {
          void this.app.workspace.revealLeaf(existing);
          return;
        }
      }

      const ws = this.app.workspace;
      const activeLeaf = ws.getLeaf(false);
      const leaf = ws.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_HOME, active: true });
      try {
        if (activeLeaf && activeLeaf !== leaf && typeof ws.moveLeaf === "function") {
          ws.moveLeaf(leaf, ws.getGroup(activeLeaf), (ws.getGroup(activeLeaf)?.index ?? 0) + 1);
        }
      } catch (e) {
        log.swallow("move leaf after active tab", e);
      }
      void ws.revealLeaf(leaf);
    },

    async openBrowserTab(this: LearnKitPluginBase, forceNew: boolean = false): Promise<void> {
      await this._openSingleTabView(VIEW_TYPE_BROWSER, forceNew);
    },

    async openAnalyticsTab(this: LearnKitPluginBase, forceNew: boolean = false): Promise<void> {
      await this._openSingleTabView(VIEW_TYPE_ANALYTICS, forceNew);
    },

    async openSettingsTab(this: LearnKitPluginBase, forceNew: boolean = false, targetTab?: string): Promise<void> {
      const resolvedTargetTab = targetTab ?? "settings";

      if (!forceNew) {
        const existing = this._ensureSingleLeafOfType(VIEW_TYPE_SETTINGS);
        if (existing) {
          void this.app.workspace.revealLeaf(existing);
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

      setTimeout(() => {
        const view = leaf.view as SproutSettingsView | undefined;
        if (view && typeof view.navigateToTab === "function") {
          view.navigateToTab(resolvedTargetTab, { reanimateEntrance: true });
        }
      }, 50);
    },

    async openExamGeneratorTab(this: LearnKitPluginBase, forceNew: boolean = false): Promise<void> {
      await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, forceNew);
    },

    async openExamGeneratorTest(this: LearnKitPluginBase, testId: string): Promise<void> {
      const leaf = await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
      const view = leaf.view as { loadSavedTestById?: (id: string) => void } | undefined;
      view?.loadSavedTestById?.(testId);
    },

    async openExamGeneratorScope(this: LearnKitPluginBase, scope: Scope): Promise<void> {
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
    },

    async openExamGeneratorScopes(this: LearnKitPluginBase, scopes: Scope[], targetLeaf?: WorkspaceLeaf): Promise<void> {
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
    },

    async openCoachTab(
      this: LearnKitPluginBase,
      forceNew: boolean = false,
      options?: { suppressEntranceAos?: boolean; refresh?: boolean },
      targetLeaf?: WorkspaceLeaf,
    ): Promise<void> {
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
    },

    async openReviewerScope(this: LearnKitPluginBase, scope: Scope): Promise<void> {
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
    },

    async openReviewerScopeWithOptions(
      this: LearnKitPluginBase,
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
    },

    async openNoteReviewScope(this: LearnKitPluginBase, scope: Scope): Promise<void> {
      return this.openNoteReviewScopeWithOptions(scope, {});
    },

    async openNoteReviewScopeWithOptions(
      this: LearnKitPluginBase,
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
    },

    async recordCoachProgressForScope(
      this: LearnKitPluginBase,
      scope: Scope,
      kind: "flashcard" | "note",
      by = 1,
    ): Promise<void> {
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
    },

    openPluginSettingsInObsidian(this: LearnKitPluginBase): void {
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
    },

    async openWidgetSafe(this: LearnKitPluginBase): Promise<void> {
      try {
        await this.openWidget();
      } catch (e) {
        log.error("failed to open widget", e);
        new Notice(this._tx("ui.main.notice.widgetOpenFailed", "LearnKit - failed to open widget"));
      }
    },

    async openWidget(this: LearnKitPluginBase): Promise<void> {
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
    },

    async openAssistantWidgetSafe(this: LearnKitPluginBase): Promise<void> {
      try {
        await this.openAssistantWidget();
      } catch (e) {
        log.error("failed to open companion widget", e);
        new Notice(this._tx("ui.main.notice.assistantWidgetOpenFailed", "LearnKit - failed to open companion widget"));
      }
    },

    async openAssistantWidget(this: LearnKitPluginBase): Promise<void> {
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
    },
  });
}
