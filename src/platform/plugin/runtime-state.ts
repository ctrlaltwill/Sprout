import {
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_NOTE_REVIEW,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  VIEW_TYPE_SETTINGS,
  VIEW_TYPE_EXAM_GENERATOR,
  VIEW_TYPE_COACH,
} from "../core/constants";

import { LearnKitPluginBase } from "./plugin-base";

export function ensurePluginRuntimeState(plugin: LearnKitPluginBase): void {
  plugin._basecoatStarted ??= false;
  plugin._saving ??= null;
  plugin.isWideMode ??= false;

  if (!Array.isArray(plugin._ribbonEls)) plugin._ribbonEls = [];

  if (!(plugin._hideStatusBarViewTypes instanceof Set)) {
    plugin._hideStatusBarViewTypes = new Set<string>([
      VIEW_TYPE_REVIEWER,
      VIEW_TYPE_NOTE_REVIEW,
      VIEW_TYPE_BROWSER,
      VIEW_TYPE_ANALYTICS,
      VIEW_TYPE_HOME,
      VIEW_TYPE_SETTINGS,
      VIEW_TYPE_EXAM_GENERATOR,
    ]);
  }

  plugin._whatsNewModalContainer ??= null;
  plugin._whatsNewModalRoot ??= null;

  plugin._sproutZoomValue ??= 1;
  plugin._sproutZoomSaveTimer ??= null;

  plugin._disposeTooltipPositioner ??= null;
  plugin._reminderEngine ??= null;
  plugin._assistantPopup ??= null;
  plugin._coachDb ??= null;
  plugin._readingViewRefreshTimer ??= null;
  plugin._readingModeWatcherInterval ??= null;

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
