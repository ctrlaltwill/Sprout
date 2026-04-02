/**
 * @file src/platform/plugin/reminder-ribbon-methods.ts
 * @summary Module for reminder ribbon methods.
 *
 * @exports
 *  - WithReminderAndRibbonMethods
 */

import { addIcon } from "obsidian";
import { LearnKitPluginBase, type Constructor } from "./plugin-base";
import { BRAND } from "../core/constants";
import {
  LEARNKIT_BRAND_ICON_KEY,
  LEARNKIT_BRAND_HORIZONTAL_ICON_KEY,
  LEARNKIT_WIDGET_STUDY_ICON_KEY,
  LEARNKIT_WIDGET_ASSISTANT_ICON_KEY,
  LEARNKIT_RIBBON_BRAND_ICON,
  LEARNKIT_HORIZONTAL_BRAND_ICON,
  LEARNKIT_STUDY_WIDGET_ICON,
  LEARNKIT_ASSISTANT_WIDGET_ICON,
} from "../core/brand-icons";

export function WithReminderAndRibbonMethods<T extends Constructor<LearnKitPluginBase>>(Base: T) {
  return class WithReminderAndRibbonMethods extends Base {
    refreshReminderEngine(): void {
      this._reminderEngine?.refresh();
    }

    _registerReminderDevConsoleCommands(): void {
      if (typeof window === "undefined") return;

      const target = window as unknown as Record<string, unknown>;

      target.learnKitReminderLaunch = (force = false) => {
        const ok = this._reminderEngine?.triggerStartupReminder(!!force) ?? false;
        return ok ? "startup reminder triggered" : "startup reminder not shown";
      };
      target.sproutReminderLaunch = target.learnKitReminderLaunch;

      target.learnKitReminderRoutine = (force = false) => {
        const ok = this._reminderEngine?.triggerRoutineReminder(!!force) ?? false;
        return ok ? "routine reminder triggered" : "routine reminder not shown";
      };
      target.sproutReminderRoutine = target.learnKitReminderRoutine;

      target.learnKitReminderGatekeeper = (force = false) => {
        const ok = this._reminderEngine?.triggerGatekeeper(!!force) ?? false;
        return ok ? "gatekeeper popup opened" : "gatekeeper popup not opened";
      };
      target.sproutReminderGatekeeper = target.learnKitReminderGatekeeper;
    }

    _unregisterReminderDevConsoleCommands(): void {
      if (typeof window === "undefined") return;
      const target = window as unknown as Record<string, unknown>;
      for (const name of this._reminderDevConsoleCommandNames) {
        delete target[name];
      }
      delete target.learnKitReminderLaunch;
      delete target.learnKitReminderRoutine;
      delete target.learnKitReminderGatekeeper;
    }

    _registerRibbonIcons(): void {
      this._destroyRibbonIcons();

      const add = (icon: string, title: string, onClick: (ev: MouseEvent) => void) => {
        const el = this.addRibbonIcon(icon, title, onClick);
        el.addClass("learnkit-ribbon-action");
        this._ribbonEls.push(el);
        return el;
      };

      add(LEARNKIT_BRAND_ICON_KEY, BRAND, (ev: MouseEvent) => {
        const forceNew = ev.metaKey || ev.ctrlKey;
        void this.openHomeTab(forceNew);
      });
    }

    _registerBrandIcons(): void {
      addIcon(LEARNKIT_BRAND_ICON_KEY, LEARNKIT_RIBBON_BRAND_ICON);
      addIcon(LEARNKIT_BRAND_HORIZONTAL_ICON_KEY, LEARNKIT_HORIZONTAL_BRAND_ICON);
      addIcon(LEARNKIT_WIDGET_STUDY_ICON_KEY, LEARNKIT_STUDY_WIDGET_ICON);
      addIcon(LEARNKIT_WIDGET_ASSISTANT_ICON_KEY, LEARNKIT_ASSISTANT_WIDGET_ICON);
    }
  };
}
