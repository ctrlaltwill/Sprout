/**
 * @file src/platform/plugin/navigation-methods.ts
 * @summary Module for navigation methods.
 *
 * @exports
 *  - WithNavigationMethods
 */
import { Notice } from "obsidian";
import { LearnKitSettingsView } from "../../views/settings/view/settings-view";
import { VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET, VIEW_TYPE_STUDY_ASSISTANT, VIEW_TYPE_BROWSER, VIEW_TYPE_NOTE_REVIEW, VIEW_TYPE_ANALYTICS, VIEW_TYPE_HOME, VIEW_TYPE_SETTINGS, VIEW_TYPE_EXAM_GENERATOR, VIEW_TYPE_COACH, } from "../core/constants";
import { CoachPlanSqlite } from "../core/coach-plan-sqlite";
import { log } from "../core/logger";
export function WithNavigationMethods(Base) {
    return class WithNavigationMethods extends Base {
        async openReviewerTab(forceNew = false) {
            var _a;
            const leaf = await this._openSingleTabView(VIEW_TYPE_REVIEWER, forceNew);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setReturnToCoach) === null || _a === void 0 ? void 0 : _a.call(view, false);
        }
        async openNoteReviewTab(forceNew = false) {
            var _a, _b, _c;
            const leaf = await this._openSingleTabView(VIEW_TYPE_NOTE_REVIEW, forceNew);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setReturnToCoach) === null || _a === void 0 ? void 0 : _a.call(view, false);
            (_b = view === null || view === void 0 ? void 0 : view.setCoachScope) === null || _b === void 0 ? void 0 : _b.call(view, null);
            (_c = view === null || view === void 0 ? void 0 : view.setIgnoreDailyReviewLimit) === null || _c === void 0 ? void 0 : _c.call(view, false);
        }
        async openHomeTab(forceNew = false) {
            var _a, _b;
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
                    ws.moveLeaf(leaf, ws.getGroup(activeLeaf), ((_b = (_a = ws.getGroup(activeLeaf)) === null || _a === void 0 ? void 0 : _a.index) !== null && _b !== void 0 ? _b : 0) + 1);
                }
            }
            catch (e) {
                log.swallow("move leaf after active tab", e);
            }
            void ws.revealLeaf(leaf);
        }
        async openBrowserTab(forceNew = false) {
            await this._openSingleTabView(VIEW_TYPE_BROWSER, forceNew);
        }
        async openAnalyticsTab(forceNew = false) {
            await this._openSingleTabView(VIEW_TYPE_ANALYTICS, forceNew);
        }
        async openSettingsTab(forceNew = false, targetTab) {
            const resolvedTargetTab = targetTab !== null && targetTab !== void 0 ? targetTab : "settings";
            if (!forceNew) {
                const existing = this._ensureSingleLeafOfType(VIEW_TYPE_SETTINGS);
                if (existing) {
                    void this.app.workspace.revealLeaf(existing);
                    const view = existing.view;
                    if (view && typeof view.navigateToTab === "function") {
                        view.navigateToTab(resolvedTargetTab, { reanimateEntrance: true });
                    }
                    return;
                }
            }
            const leaf = this.app.workspace.getLeaf("tab");
            if (resolvedTargetTab !== "settings") {
                LearnKitSettingsView.pendingInitialTab = resolvedTargetTab;
            }
            await leaf.setViewState({ type: VIEW_TYPE_SETTINGS, active: true });
            void this.app.workspace.revealLeaf(leaf);
        }
        async openExamGeneratorTab(forceNew = false) {
            await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, forceNew);
        }
        async openExamGeneratorTest(testId) {
            var _a;
            const leaf = await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.loadSavedTestById) === null || _a === void 0 ? void 0 : _a.call(view, testId);
        }
        async openExamGeneratorScope(scope) {
            var _a, _b;
            const leaf = await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setSuppressEntranceAosOnce) === null || _a === void 0 ? void 0 : _a.call(view, true);
            if (view === null || view === void 0 ? void 0 : view.setCoachScopes) {
                view.setCoachScopes([scope]);
                return;
            }
            (_b = view === null || view === void 0 ? void 0 : view.setCoachScope) === null || _b === void 0 ? void 0 : _b.call(view, scope);
        }
        async openExamGeneratorScopes(scopes, targetLeaf) {
            var _a, _b, _c;
            const normalized = Array.isArray(scopes)
                ? scopes.filter((scope) => !!scope)
                : [];
            if (!normalized.length)
                return;
            const leaf = targetLeaf
                ? await (async () => {
                    await targetLeaf.setViewState({ type: VIEW_TYPE_EXAM_GENERATOR, active: true });
                    void this.app.workspace.revealLeaf(targetLeaf);
                    return targetLeaf;
                })()
                : await this._openSingleTabView(VIEW_TYPE_EXAM_GENERATOR, false);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setSuppressEntranceAosOnce) === null || _a === void 0 ? void 0 : _a.call(view, true);
            if (view === null || view === void 0 ? void 0 : view.setCoachScopes) {
                view.setCoachScopes(normalized);
                return;
            }
            (_b = view === null || view === void 0 ? void 0 : view.setCoachScope) === null || _b === void 0 ? void 0 : _b.call(view, (_c = normalized[0]) !== null && _c !== void 0 ? _c : null);
        }
        async openCoachTab(forceNew = false, options, targetLeaf) {
            var _a, _b;
            const leaf = targetLeaf
                ? await (async () => {
                    await targetLeaf.setViewState({ type: VIEW_TYPE_COACH, active: true });
                    void this.app.workspace.revealLeaf(targetLeaf);
                    return targetLeaf;
                })()
                : await this._openSingleTabView(VIEW_TYPE_COACH, forceNew);
            const view = leaf.view;
            if (options === null || options === void 0 ? void 0 : options.suppressEntranceAos) {
                (_a = view === null || view === void 0 ? void 0 : view.setSuppressEntranceAosOnce) === null || _a === void 0 ? void 0 : _a.call(view, true);
            }
            if ((options === null || options === void 0 ? void 0 : options.refresh) !== false) {
                (_b = view === null || view === void 0 ? void 0 : view.onRefresh) === null || _b === void 0 ? void 0 : _b.call(view);
            }
        }
        async openReviewerScope(scope) {
            var _a, _b;
            const leaf = await this._openSingleTabView(VIEW_TYPE_REVIEWER, false);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setReturnToCoach) === null || _a === void 0 ? void 0 : _a.call(view, false);
            (_b = view === null || view === void 0 ? void 0 : view.openSessionFromScope) === null || _b === void 0 ? void 0 : _b.call(view, scope);
        }
        async openReviewerScopeWithOptions(scope, options, targetLeaf) {
            var _a, _b, _c;
            const leaf = targetLeaf
                ? await (async () => {
                    await targetLeaf.setViewState({ type: VIEW_TYPE_REVIEWER, active: true });
                    void this.app.workspace.revealLeaf(targetLeaf);
                    return targetLeaf;
                })()
                : await this._openSingleTabView(VIEW_TYPE_REVIEWER, false);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setSuppressEntranceAosOnce) === null || _a === void 0 ? void 0 : _a.call(view, true);
            (_b = view === null || view === void 0 ? void 0 : view.setReturnToCoach) === null || _b === void 0 ? void 0 : _b.call(view, true);
            (_c = view === null || view === void 0 ? void 0 : view.openSessionFromScope) === null || _c === void 0 ? void 0 : _c.call(view, scope, options);
        }
        async openNoteReviewScope(scope) {
            return this.openNoteReviewScopeWithOptions(scope, {});
        }
        async openNoteReviewScopeWithOptions(scope, options, targetLeaf) {
            var _a, _b, _c, _d;
            const leaf = targetLeaf
                ? await (async () => {
                    await targetLeaf.setViewState({ type: VIEW_TYPE_NOTE_REVIEW, active: true });
                    void this.app.workspace.revealLeaf(targetLeaf);
                    return targetLeaf;
                })()
                : await this._openSingleTabView(VIEW_TYPE_NOTE_REVIEW, false);
            const view = leaf.view;
            (_a = view === null || view === void 0 ? void 0 : view.setSuppressEntranceAosOnce) === null || _a === void 0 ? void 0 : _a.call(view, true);
            (_b = view === null || view === void 0 ? void 0 : view.setReturnToCoach) === null || _b === void 0 ? void 0 : _b.call(view, true);
            if (typeof (view === null || view === void 0 ? void 0 : view.startCoachDueSession) === "function") {
                view.startCoachDueSession(scope, options);
                window.setTimeout(() => {
                    var _a;
                    const mountedView = leaf.view;
                    const activeScope = mountedView === null || mountedView === void 0 ? void 0 : mountedView._coachScope;
                    const scopeAlreadyApplied = !!activeScope &&
                        activeScope.type === scope.type &&
                        activeScope.key === scope.key;
                    if (!scopeAlreadyApplied) {
                        (_a = mountedView === null || mountedView === void 0 ? void 0 : mountedView.startCoachDueSession) === null || _a === void 0 ? void 0 : _a.call(mountedView, scope, options);
                    }
                }, 0);
                return;
            }
            (_c = view === null || view === void 0 ? void 0 : view.setCoachScope) === null || _c === void 0 ? void 0 : _c.call(view, scope);
            (_d = view === null || view === void 0 ? void 0 : view.setIgnoreDailyReviewLimit) === null || _d === void 0 ? void 0 : _d.call(view, true);
        }
        async recordCoachProgressForScope(scope, kind, by = 1) {
            if (!this._coachDb) {
                this._coachDb = new CoachPlanSqlite(this);
                await this._coachDb.open();
            }
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            const dayUtc = d.getTime();
            const scopeKey = scope.type === "vault" ? "" : String(scope.key || "");
            this._coachDb.incrementProgress(dayUtc, scope.type, scopeKey, kind, by);
            await this._coachDb.persist();
        }
        openPluginSettingsInObsidian() {
            var _a;
            const settings = this.app.setting;
            if (!settings) {
                new Notice(this._tx("ui.main.notice.obsidianSettingsUnavailable", "Obsidian settings are unavailable."));
                return;
            }
            settings.open();
            const pluginId = ((_a = this.manifest) === null || _a === void 0 ? void 0 : _a.id) || "sprout";
            try {
                if (typeof settings.openTabById === "function")
                    settings.openTabById(pluginId);
                else if (typeof settings.openTab === "function")
                    settings.openTab(pluginId);
            }
            catch (e) {
                log.warn("failed to open plugin settings tab", e);
            }
        }
        async openWidgetSafe() {
            try {
                await this.openWidget();
            }
            catch (e) {
                log.error("failed to open widget", e);
                new Notice(this._tx("ui.main.notice.widgetOpenFailed", "LearnKit - failed to open widget"));
            }
        }
        async openWidget() {
            var _a;
            const ws = this.app.workspace;
            let leaf = ws.getRightLeaf(false);
            if (leaf) {
                ws.setActiveLeaf(leaf, { focus: false });
                leaf = (_a = ws.getLeaf(false)) !== null && _a !== void 0 ? _a : leaf;
            }
            else {
                leaf = ws.getRightLeaf(true);
                if (leaf)
                    ws.setActiveLeaf(leaf, { focus: false });
            }
            if (!leaf)
                return;
            await leaf.setViewState({ type: VIEW_TYPE_WIDGET, active: true, state: {} });
            void ws.revealLeaf(leaf);
        }
        async openAssistantWidgetSafe() {
            try {
                await this.openAssistantWidget();
            }
            catch (e) {
                log.error("failed to open companion widget", e);
                new Notice(this._tx("ui.main.notice.assistantWidgetOpenFailed", "LearnKit - failed to open companion widget"));
            }
        }
        async openAssistantWidget() {
            var _a;
            const ws = this.app.workspace;
            let leaf = ws.getRightLeaf(false);
            if (leaf) {
                ws.setActiveLeaf(leaf, { focus: false });
                leaf = (_a = ws.getLeaf(false)) !== null && _a !== void 0 ? _a : leaf;
            }
            else {
                leaf = ws.getRightLeaf(true);
                if (leaf)
                    ws.setActiveLeaf(leaf, { focus: false });
            }
            if (!leaf)
                return;
            await leaf.setViewState({ type: VIEW_TYPE_STUDY_ASSISTANT, active: true, state: {} });
            void ws.revealLeaf(leaf);
        }
    };
}
