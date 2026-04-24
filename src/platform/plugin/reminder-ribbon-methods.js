/**
 * @file src/platform/plugin/reminder-ribbon-methods.ts
 * @summary Module for reminder ribbon methods.
 *
 * @exports
 *  - WithReminderAndRibbonMethods
 */
import { addIcon } from "obsidian";
import { BRAND } from "../core/constants";
import { createStudyAssistantMatrixConsoleApi } from "../integrations/ai/study-assistant-matrix-runner";
import { LEARNKIT_BRAND_ICON_KEY, LEARNKIT_BRAND_HORIZONTAL_ICON_KEY, LEARNKIT_WIDGET_STUDY_ICON_KEY, LEARNKIT_WIDGET_ASSISTANT_ICON_KEY, LEARNKIT_RIBBON_BRAND_ICON, LEARNKIT_HORIZONTAL_BRAND_ICON, LEARNKIT_STUDY_WIDGET_ICON, LEARNKIT_ASSISTANT_WIDGET_ICON, } from "../core/brand-icons";
export function WithReminderAndRibbonMethods(Base) {
    return class WithReminderAndRibbonMethods extends Base {
        constructor() {
            super(...arguments);
            this.refreshReminderEngine = () => {
                var _a;
                (_a = this._reminderEngine) === null || _a === void 0 ? void 0 : _a.refresh();
            };
            this._registerReminderDevConsoleCommands = () => {
                if (typeof window === "undefined")
                    return;
                const target = window;
                target.learnKitReminderLaunch = (force = false) => {
                    var _a, _b;
                    const ok = (_b = (_a = this._reminderEngine) === null || _a === void 0 ? void 0 : _a.triggerStartupReminder(!!force)) !== null && _b !== void 0 ? _b : false;
                    return ok ? "startup reminder triggered" : "startup reminder not shown";
                };
                target.sproutReminderLaunch = target.learnKitReminderLaunch;
                target.learnKitReminderRoutine = (force = false) => {
                    var _a, _b;
                    const ok = (_b = (_a = this._reminderEngine) === null || _a === void 0 ? void 0 : _a.triggerRoutineReminder(!!force)) !== null && _b !== void 0 ? _b : false;
                    return ok ? "routine reminder triggered" : "routine reminder not shown";
                };
                target.sproutReminderRoutine = target.learnKitReminderRoutine;
                target.learnKitReminderGatekeeper = (force = false) => {
                    var _a, _b;
                    const ok = (_b = (_a = this._reminderEngine) === null || _a === void 0 ? void 0 : _a.triggerGatekeeper(!!force)) !== null && _b !== void 0 ? _b : false;
                    return ok ? "gatekeeper popup opened" : "gatekeeper popup not opened";
                };
                target.sproutReminderGatekeeper = target.learnKitReminderGatekeeper;
            };
            this._unregisterReminderDevConsoleCommands = () => {
                if (typeof window === "undefined")
                    return;
                const target = window;
                for (const name of this._reminderDevConsoleCommandNames) {
                    delete target[name];
                }
                delete target.learnKitReminderLaunch;
                delete target.learnKitReminderRoutine;
                delete target.learnKitReminderGatekeeper;
            };
            this._registerStudyAssistantDevConsoleCommands = () => {
                if (typeof window === "undefined")
                    return;
                const target = window;
                const api = createStudyAssistantMatrixConsoleApi(this);
                target.learnKitAi = api;
                target.sproutAi = api;
                target.learnKitAiMatrixRun = api.runMatrix;
                target.sproutAiMatrixRun = api.runMatrix;
            };
            this._unregisterStudyAssistantDevConsoleCommands = () => {
                if (typeof window === "undefined")
                    return;
                const target = window;
                delete target.learnKitAi;
                delete target.sproutAi;
                delete target.learnKitAiMatrixRun;
                delete target.sproutAiMatrixRun;
            };
            this._registerRibbonIcons = () => {
                this._destroyRibbonIcons();
                const add = (icon, title, onClick) => {
                    const el = this.addRibbonIcon(icon, title, onClick);
                    el.addClass("learnkit-ribbon-action");
                    this._ribbonEls.push(el);
                    return el;
                };
                add(LEARNKIT_BRAND_ICON_KEY, BRAND, (ev) => {
                    const forceNew = ev.metaKey || ev.ctrlKey;
                    void this.openHomeTab(forceNew);
                });
            };
            this._registerBrandIcons = () => {
                addIcon(LEARNKIT_BRAND_ICON_KEY, LEARNKIT_RIBBON_BRAND_ICON);
                addIcon(LEARNKIT_BRAND_HORIZONTAL_ICON_KEY, LEARNKIT_HORIZONTAL_BRAND_ICON);
                addIcon(LEARNKIT_WIDGET_STUDY_ICON_KEY, LEARNKIT_STUDY_WIDGET_ICON);
                addIcon(LEARNKIT_WIDGET_ASSISTANT_ICON_KEY, LEARNKIT_ASSISTANT_WIDGET_ICON);
            };
        }
    };
}
