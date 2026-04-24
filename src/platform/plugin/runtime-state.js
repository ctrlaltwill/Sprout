/**
 * @file src/platform/plugin/runtime-state.ts
 * @summary Module for runtime state.
 *
 * @exports
 *  - ensurePluginRuntimeState
 */
import { VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET, VIEW_TYPE_BROWSER, VIEW_TYPE_NOTE_REVIEW, VIEW_TYPE_ANALYTICS, VIEW_TYPE_HOME, VIEW_TYPE_SETTINGS, VIEW_TYPE_EXAM_GENERATOR, VIEW_TYPE_COACH, } from "../core/constants";
export function ensurePluginRuntimeState(plugin) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    (_a = plugin._basecoatStarted) !== null && _a !== void 0 ? _a : (plugin._basecoatStarted = false);
    (_b = plugin._saving) !== null && _b !== void 0 ? _b : (plugin._saving = null);
    (_c = plugin.isWideMode) !== null && _c !== void 0 ? _c : (plugin.isWideMode = false);
    if (!Array.isArray(plugin._ribbonEls))
        plugin._ribbonEls = [];
    if (!(plugin._hideStatusBarViewTypes instanceof Set)) {
        plugin._hideStatusBarViewTypes = new Set([
            VIEW_TYPE_REVIEWER,
            VIEW_TYPE_NOTE_REVIEW,
            VIEW_TYPE_BROWSER,
            VIEW_TYPE_ANALYTICS,
            VIEW_TYPE_HOME,
            VIEW_TYPE_SETTINGS,
            VIEW_TYPE_EXAM_GENERATOR,
        ]);
    }
    (_d = plugin._sproutZoomValue) !== null && _d !== void 0 ? _d : (plugin._sproutZoomValue = 1);
    (_e = plugin._sproutZoomSaveTimer) !== null && _e !== void 0 ? _e : (plugin._sproutZoomSaveTimer = null);
    (_f = plugin._disposeTooltipPositioner) !== null && _f !== void 0 ? _f : (plugin._disposeTooltipPositioner = null);
    (_g = plugin._reminderEngine) !== null && _g !== void 0 ? _g : (plugin._reminderEngine = null);
    (_h = plugin._assistantPopup) !== null && _h !== void 0 ? _h : (plugin._assistantPopup = null);
    (_j = plugin._coachDb) !== null && _j !== void 0 ? _j : (plugin._coachDb = null);
    (_k = plugin._readingViewRefreshTimer) !== null && _k !== void 0 ? _k : (plugin._readingViewRefreshTimer = null);
    (_l = plugin._readingModeWatcherInterval) !== null && _l !== void 0 ? _l : (plugin._readingModeWatcherInterval = null);
    if (!(plugin._markdownLeafModeSnapshot instanceof WeakMap)) {
        plugin._markdownLeafModeSnapshot = new WeakMap();
    }
    if (!(plugin._markdownLeafContentSnapshot instanceof WeakMap)) {
        plugin._markdownLeafContentSnapshot = new WeakMap();
    }
    if (!Array.isArray(plugin._reminderDevConsoleCommandNames)) {
        plugin._reminderDevConsoleCommandNames = [
            "sproutReminderLaunch",
            "sproutReminderRoutine",
            "sproutReminderGatekeeper",
        ];
    }
    if (!Array.isArray(plugin._refreshableViewTypes)) {
        plugin._refreshableViewTypes = [
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
    }
}
