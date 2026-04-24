/**
 * @file src/views/reminders/reminder-engine.ts
 * @summary Module for reminder engine.
 *
 * @exports
 *  - ReminderEngine
 */
import { log } from "../../platform/core/logger";
import { VIEW_TYPE_ANALYTICS, VIEW_TYPE_BROWSER, VIEW_TYPE_HOME, VIEW_TYPE_REVIEWER, VIEW_TYPE_SETTINGS, } from "../../platform/core/constants";
import { countDueCardsNow, getDueCardsNow } from "./reminder-due-count";
import { showReminderNotice } from "./reminder-notice";
import { minutesToMs, normaliseReminderIntervalMinutes } from "./reminder-timing";
import { GatekeeperModal } from "./gatekeeper-modal";
export class ReminderEngine {
    constructor(plugin) {
        this._startupTimer = null;
        this._gatekeeperStartupTimer = null;
        this._intervalTimer = null;
        this._gatekeeperTickTimer = null;
        this._gatekeeperIntervalMs = 0;
        this._gatekeeperRemainingMs = 0;
        this._gatekeeperLastTickAt = 0;
        this._gatekeeperModal = null;
        this.plugin = plugin;
    }
    start(includeStartupTriggers = true) {
        var _a;
        this.stop();
        const cfg = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.reminders;
        if (!cfg)
            return;
        const hasAnyReminderEnabled = !!cfg.showOnStartup || !!cfg.repeatEnabled || !!cfg.gatekeeperEnabled || !!cfg.gatekeeperOnStartup;
        if (!hasAnyReminderEnabled)
            return;
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
            }
            catch (_a) {
                // ignore teardown close failures
            }
            this._gatekeeperModal = null;
        }
    }
    refresh() {
        this.start(false);
    }
    triggerStartupReminder(force = false) {
        return this._emit("startup", force);
    }
    triggerRoutineReminder(force = false) {
        return this._emit("interval", force);
    }
    triggerGatekeeper(force = false) {
        return this._openGatekeeperIfNeeded(force);
    }
    _emit(source, force = false) {
        var _a;
        const cfg = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.reminders;
        if (!cfg)
            return false;
        try {
            const dueCount = countDueCardsNow(this.plugin.store);
            if (!force && !cfg.showWhenNoDue && dueCount <= 0)
                return false;
            showReminderNotice({
                dueCount,
                customMessage: cfg.message,
                onClick: this._buildClickAction(cfg.clickAction),
            });
            return true;
        }
        catch (e) {
            log.swallow(`reminder emit (${source})`, e);
            return false;
        }
    }
    _buildClickAction(action) {
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
    _isActiveStudyTabInSprout() {
        var _a, _b, _c, _d, _e;
        const leaf = (_c = (_b = (_a = this.plugin.app.workspace).getMostRecentLeaf) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null;
        const viewType = (_e = (_d = leaf === null || leaf === void 0 ? void 0 : leaf.view) === null || _d === void 0 ? void 0 : _d.getViewType) === null || _e === void 0 ? void 0 : _e.call(_d);
        return typeof viewType === "string" && ReminderEngine.STUDY_VIEW_TYPES.has(viewType);
    }
    _tickGatekeeperTimer() {
        var _a;
        const cfg = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.reminders;
        if (!cfg || !cfg.gatekeeperEnabled)
            return;
        if (this._gatekeeperIntervalMs <= 0)
            return;
        const now = Date.now();
        if (!this._gatekeeperLastTickAt) {
            this._gatekeeperLastTickAt = now;
            return;
        }
        const elapsedMs = Math.max(0, now - this._gatekeeperLastTickAt);
        this._gatekeeperLastTickAt = now;
        const shouldPause = !!cfg.gatekeeperPauseWhenStudying && this._isActiveStudyTabInSprout();
        if (shouldPause)
            return;
        this._gatekeeperRemainingMs -= elapsedMs;
        if (this._gatekeeperRemainingMs > 0)
            return;
        this._openGatekeeperIfNeeded();
        this._gatekeeperRemainingMs = this._gatekeeperIntervalMs;
    }
    _openGatekeeperIfNeeded(force = false) {
        var _a, _b;
        const cfg = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.reminders;
        if (!cfg)
            return false;
        if (!force && !cfg.gatekeeperEnabled)
            return false;
        if (this._gatekeeperModal)
            return false;
        try {
            const dueCards = getDueCardsNow(this.plugin.store);
            if (!dueCards.length)
                return false;
            const configuredCount = Math.max(1, Number(cfg.gatekeeperDueQuestionCount) || 1);
            const cards = dueCards.slice(0, configuredCount);
            const modal = new GatekeeperModal({
                app: this.plugin.app,
                plugin: this.plugin,
                cards,
                allowBypass: !!cfg.gatekeeperAllowSkip,
                scope: (_b = cfg.gatekeeperScope) !== null && _b !== void 0 ? _b : "workspace",
            });
            const clearRef = () => {
                if (this._gatekeeperModal === modal)
                    this._gatekeeperModal = null;
            };
            const originalOnClose = modal.onClose.bind(modal);
            modal.onClose = () => {
                clearRef();
                originalOnClose();
            };
            this._gatekeeperModal = modal;
            modal.open();
            return true;
        }
        catch (e) {
            log.swallow("open gatekeeper modal", e);
            return false;
        }
    }
}
ReminderEngine.GATEKEEPER_TICK_MS = 1000;
ReminderEngine.STUDY_VIEW_TYPES = new Set([
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_HOME,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_SETTINGS,
]);
