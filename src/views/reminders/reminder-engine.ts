import { log } from "../../platform/core/logger";
import {
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_HOME,
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_SETTINGS,
} from "../../platform/core/constants";
import type SproutPlugin from "../../main";
import { countDueCardsNow, getDueCardsNow } from "./reminder-due-count";
import { showReminderNotice } from "./reminder-notice";
import { minutesToMs, normaliseReminderIntervalMinutes } from "./reminder-timing";
import { GatekeeperModal } from "./gatekeeper-modal";

type ReminderSource = "startup" | "interval";

export class ReminderEngine {
  private readonly plugin: SproutPlugin;
  private static readonly GATEKEEPER_TICK_MS = 1000;
  private static readonly STUDY_VIEW_TYPES = new Set<string>([
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_HOME,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_SETTINGS,
  ]);
  private _startupTimer: number | null = null;
  private _gatekeeperStartupTimer: number | null = null;
  private _intervalTimer: number | null = null;
  private _gatekeeperTickTimer: number | null = null;
  private _gatekeeperIntervalMs = 0;
  private _gatekeeperRemainingMs = 0;
  private _gatekeeperLastTickAt = 0;
  private _gatekeeperModal: GatekeeperModal | null = null;

  constructor(plugin: SproutPlugin) {
    this.plugin = plugin;
  }

  start(includeStartupTriggers = true) {
    this.stop();

    const cfg = this.plugin.settings?.reminders;
    if (!cfg) return;

    const hasAnyReminderEnabled = !!cfg.showOnStartup || !!cfg.repeatEnabled || !!cfg.gatekeeperEnabled || !!cfg.gatekeeperOnStartup;
    if (!hasAnyReminderEnabled) return;

    const startupDelayMs = Math.max(0, Number(cfg.startupDelayMs) || 0);

    if (includeStartupTriggers && cfg.showOnStartup) {
      this._startupTimer = window.setTimeout(() => {
        this._startupTimer = null;
        this._emit("startup");
      }, startupDelayMs);
    }

    if (includeStartupTriggers && cfg.gatekeeperOnStartup) {
      this._gatekeeperStartupTimer = window.setTimeout(() => {
        this._gatekeeperStartupTimer = null;
        this._openGatekeeperIfNeeded();
      }, startupDelayMs);
    }

    if (cfg.repeatEnabled) {
      const intervalMinutes = normaliseReminderIntervalMinutes(cfg.repeatIntervalMinutes, 30);
      this._intervalTimer = window.setInterval(() => {
        this._emit("interval");
      }, minutesToMs(intervalMinutes));
    }

    if (cfg.gatekeeperEnabled) {
      const gatekeeperInterval = normaliseReminderIntervalMinutes(cfg.gatekeeperIntervalMinutes, 30);
      this._gatekeeperIntervalMs = minutesToMs(gatekeeperInterval);
      this._gatekeeperRemainingMs = this._gatekeeperIntervalMs;
      this._gatekeeperLastTickAt = Date.now();
      this._gatekeeperTickTimer = window.setInterval(() => {
        this._tickGatekeeperTimer();
      }, ReminderEngine.GATEKEEPER_TICK_MS);
    }
  }

  stop() {
    if (this._startupTimer != null) {
      window.clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }

    if (this._gatekeeperStartupTimer != null) {
      window.clearTimeout(this._gatekeeperStartupTimer);
      this._gatekeeperStartupTimer = null;
    }

    if (this._intervalTimer != null) {
      window.clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }

    if (this._gatekeeperTickTimer != null) {
      window.clearInterval(this._gatekeeperTickTimer);
      this._gatekeeperTickTimer = null;
    }
    this._gatekeeperIntervalMs = 0;
    this._gatekeeperRemainingMs = 0;
    this._gatekeeperLastTickAt = 0;

    if (this._gatekeeperModal) {
      try {
        this._gatekeeperModal.close();
      } catch {
        // ignore teardown close failures
      }
      this._gatekeeperModal = null;
    }
  }

  refresh() {
    this.start(false);
  }

  triggerStartupReminder(force = false): boolean {
    return this._emit("startup", force);
  }

  triggerRoutineReminder(force = false): boolean {
    return this._emit("interval", force);
  }

  triggerGatekeeper(force = false): boolean {
    return this._openGatekeeperIfNeeded(force);
  }

  private _emit(source: ReminderSource, force = false): boolean {
    const cfg = this.plugin.settings?.reminders;
    if (!cfg) return false;

    try {
      const dueCount = countDueCardsNow(this.plugin.store);
      if (!force && !cfg.showWhenNoDue && dueCount <= 0) return false;

      showReminderNotice({
        dueCount,
        customMessage: cfg.message,
        onClick: this._buildClickAction(cfg.clickAction),
      });
      return true;
    } catch (e) {
      log.swallow(`reminder emit (${source})`, e);
      return false;
    }
  }

  private _buildClickAction(action: "none" | "open-home" | "open-reviewer"): (() => void) | null {
    if (action === "open-home") {
      return () => {
        void this.plugin.openHomeTab();
      };
    }

    if (action === "open-reviewer") {
      return () => {
        void this.plugin.openReviewerTab();
      };
    }

    return null;
  }

  private _isActiveStudyTabInSprout(): boolean {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf?.() ?? null;
    const viewType = leaf?.view?.getViewType?.();
    return typeof viewType === "string" && ReminderEngine.STUDY_VIEW_TYPES.has(viewType);
  }

  private _tickGatekeeperTimer(): void {
    const cfg = this.plugin.settings?.reminders;
    if (!cfg || !cfg.gatekeeperEnabled) return;
    if (this._gatekeeperIntervalMs <= 0) return;

    const now = Date.now();
    if (!this._gatekeeperLastTickAt) {
      this._gatekeeperLastTickAt = now;
      return;
    }

    const elapsedMs = Math.max(0, now - this._gatekeeperLastTickAt);
    this._gatekeeperLastTickAt = now;

    const shouldPause = !!cfg.gatekeeperPauseWhenStudying && this._isActiveStudyTabInSprout();
    if (shouldPause) return;

    this._gatekeeperRemainingMs -= elapsedMs;
    if (this._gatekeeperRemainingMs > 0) return;

    this._openGatekeeperIfNeeded();
    this._gatekeeperRemainingMs = this._gatekeeperIntervalMs;
  }

  private _openGatekeeperIfNeeded(force = false): boolean {
    const cfg = this.plugin.settings?.reminders;
    if (!cfg) return false;
    if (!force && !cfg.gatekeeperEnabled) return false;
    if (this._gatekeeperModal) return false;

    try {
      const dueCards = getDueCardsNow(this.plugin.store);
      if (!dueCards.length) return false;

      const configuredCount = Math.max(1, Number(cfg.gatekeeperDueQuestionCount) || 1);
      const cards = dueCards.slice(0, configuredCount);
      const modal = new GatekeeperModal({
        app: this.plugin.app,
        plugin: this.plugin,
        cards,
        allowBypass: !!cfg.gatekeeperAllowSkip,
        scope: cfg.gatekeeperScope ?? "workspace",
      });

      const clearRef = () => {
        if (this._gatekeeperModal === modal) this._gatekeeperModal = null;
      };

      const originalOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        clearRef();
        originalOnClose();
      };

      this._gatekeeperModal = modal;
      modal.open();
      return true;
    } catch (e) {
      log.swallow("open gatekeeper modal", e);
      return false;
    }
  }
}
