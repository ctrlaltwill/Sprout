import { addIcon } from "obsidian";
import { LearnKitPluginBase } from "./plugin-base";
import { BRAND } from "../core/constants";
import {
  SPROUT_BRAND_ICON_KEY,
  SPROUT_BRAND_HORIZONTAL_ICON_KEY,
  SPROUT_WIDGET_STUDY_ICON_KEY,
  SPROUT_WIDGET_ASSISTANT_ICON_KEY,
  SPROUT_RIBBON_BRAND_ICON,
  SPROUT_HORIZONTAL_BRAND_ICON,
  SPROUT_STUDY_WIDGET_ICON,
  SPROUT_ASSISTANT_WIDGET_ICON,
} from "../core/brand-icons";

export function installReminderAndRibbonMethods(pluginClass: typeof LearnKitPluginBase): void {
  Object.assign(pluginClass.prototype, {
    refreshReminderEngine(this: LearnKitPluginBase): void {
      this._reminderEngine?.refresh();
    },

    _registerReminderDevConsoleCommands(this: LearnKitPluginBase): void {
      if (typeof window === "undefined") return;

      const target = window as unknown as Record<string, unknown>;

      target.sproutReminderLaunch = (force = false) => {
        const ok = this._reminderEngine?.triggerStartupReminder(!!force) ?? false;
        return ok ? "startup reminder triggered" : "startup reminder not shown";
      };

      target.sproutReminderRoutine = (force = false) => {
        const ok = this._reminderEngine?.triggerRoutineReminder(!!force) ?? false;
        return ok ? "routine reminder triggered" : "routine reminder not shown";
      };

      target.sproutReminderGatekeeper = (force = false) => {
        const ok = this._reminderEngine?.triggerGatekeeper(!!force) ?? false;
        return ok ? "gatekeeper popup opened" : "gatekeeper popup not opened";
      };
    },

    _unregisterReminderDevConsoleCommands(this: LearnKitPluginBase): void {
      if (typeof window === "undefined") return;
      const target = window as unknown as Record<string, unknown>;
      for (const name of this._reminderDevConsoleCommandNames) {
        delete target[name];
      }
    },

    _registerRibbonIcons(this: LearnKitPluginBase): void {
      this._destroyRibbonIcons();

      const add = (icon: string, title: string, onClick: (ev: MouseEvent) => void) => {
        const el = this.addRibbonIcon(icon, title, onClick);
        el.addClass("sprout-ribbon-action");
        el.addClass("bc");
        this._ribbonEls.push(el);
        return el;
      };

      add(SPROUT_BRAND_ICON_KEY, BRAND, (ev: MouseEvent) => {
        const forceNew = ev.metaKey || ev.ctrlKey;
        void this.openHomeTab(forceNew);
      });
    },

    _registerBrandIcons(this: LearnKitPluginBase): void {
      addIcon(SPROUT_BRAND_ICON_KEY, SPROUT_RIBBON_BRAND_ICON);
      addIcon(SPROUT_BRAND_HORIZONTAL_ICON_KEY, SPROUT_HORIZONTAL_BRAND_ICON);
      addIcon(SPROUT_WIDGET_STUDY_ICON_KEY, SPROUT_STUDY_WIDGET_ICON);
      addIcon(SPROUT_WIDGET_ASSISTANT_ICON_KEY, SPROUT_ASSISTANT_WIDGET_ICON);
    },
  });
}
