/**
 * @file src/settings/sprout-settings-tab.ts
 * @summary The Obsidian PluginSettingTab for Sprout. Renders the entire Settings panel including user details, general options, image-occlusion settings, card attachments, study/reviewer tweaks, widget options, FSRS scheduling presets, indexing, backups, quarantine list, and the danger zone (delete-all / reset). Confirmation dialogs are in confirm-modals.ts and pure helpers in settings-utils.ts.
 *
 * @exports
 *  - SproutSettingsTab — Obsidian PluginSettingTab subclass that renders and manages all Sprout plugin settings
 */

import {
  PluginSettingTab,
  Setting,
  TFile,
  type App,
  Notice,
  setIcon,
  requestUrl,
} from "obsidian";
import type SproutPlugin from "../../main";
import type { SproutSettings } from "../../platform/types/settings";
import type { CardState } from "../../platform/types/scheduler";
import { log } from "../../platform/core/logger";
import { placePopover, setCssProps } from "../../platform/core/ui";
import { DEFAULT_SETTINGS, VIEW_TYPE_WIDGET } from "../../platform/core/constants";
import { DELIMITER_OPTIONS, setDelimiter, type DelimiterChar } from "../../platform/core/delimiter";
import { isParentCard } from "../../platform/core/card-utils";
import { renderReadingViewPreviewCard, syncReadingViewStyles } from "../reading/reading-view";
import type { SproutCard } from "../reading/reading-helpers";
import {
  getInterfaceLocaleLabel,
  getSupportedInterfaceLocales,
  resolveInterfaceLocale,
} from "../../platform/translations/locale-registry";
import { getCircleFlagFallbackUrl, getCircleFlagUrl } from "../../platform/flags/flag-tokens";
import { t } from "../../platform/translations/translator";
import { getLanguageOptions, getScriptLanguageGroups, getAvailableVoices, getTtsService } from "../../platform/integrations/tts/tts-service";
import {
  listDataJsonBackups,
  getDataJsonBackupStats,
  createDataJsonBackupNow,
  verifyDataJsonBackupIntegrity,
  type DataJsonBackupStats,
} from "../../platform/integrations/sync/backup";

import {
  ConfirmResetSchedulingModal,
  ConfirmResetAnalyticsModal,
  ConfirmDeleteAllFlashcardsModal,
  ConfirmResetDefaultsModal,
  ConfirmRestoreBackupModal,
  ConfirmDeleteBackupModal,
} from "./confirm-modals";

import {
  parsePositiveNumberListCsv,
  clamp,
  toNonNegInt,
  fmtSettingValue,
  isAnchorLine,
  isCardStartLine,
  isFieldLine,
  looksLikeCardBlock,
  clonePlain,
  normaliseFolderPath,
  listVaultFolders,
  fuzzyFolderMatches,
} from "./settings-utils";

type StudyAssistantProvider = SproutSettings["studyAssistant"]["provider"];

type StudyAssistantModelOption = {
  value: string;
  label: string;
  description?: string;
  section?: string;
};

type OpenRouterModel = {
  id: string;
  name: string;
  provider: string;
  isFree: boolean;
};

// ────────────────────────────────────────────
// SproutSettingsTab
// ────────────────────────────────────────────

export class SproutSettingsTab extends PluginSettingTab {
  plugin: SproutPlugin;
  private _audioAdvancedOptionsExpanded = false;
  private _readingCustomCssSaveTimer: number | null = null;
  private _openRouterModelsCache: OpenRouterModel[] | null = null;
  private _openRouterModelsLoading = false;
  private _openRouterModelsError: string | null = null;
  private static readonly TRANSLATIONS_GUIDE_URL = "https://github.com/ctrlaltwill/Sprout/blob/main/CONTRIBUTING.md#translation-policy";

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  private readonly _noticeLines = {
    backupCreateUnavailable: this._tx(
      "ui.settings.backups.notice.createUnavailable",
      "Sprout: could not create backup (no scheduling data or adapter cannot write).",
    ),
    backupCreateSuccess: this._tx("ui.settings.backups.notice.createSuccess", "Scheduling data backup created"),
    backupCreateFailed: this._tx("ui.settings.backups.notice.createFailed", "Sprout: failed to create scheduling data backup (see console)."),
    ttsNotSupported: this._tx("ui.settings.audio.notice.notSupported", "Text-to-speech is not supported in this environment."),
    settingsResetFailed: this._tx("ui.settings.reset.notice.failed", "Sprout: could not reset settings (see console)."),
    deleteAllSummary: (cardsRemoved: number, anchorsRemoved: number, filesTouched: number, seconds: number) =>
      this._tx(
        "ui.settings.notice.deleteAllSummary",
        "Sprout: Deleted {cards} cards and {anchors} anchors in {files} files ({seconds}s)",
        { cards: cardsRemoved, anchors: anchorsRemoved, files: filesTouched, seconds },
      ),

    userName: (value: string) => this._tx("ui.settings.notice.userName", "User name: {value}", {
      value: value || this._tx("ui.settings.notice.emptyValue", "(empty)"),
    }),
    greetingText: (enabled: boolean) => this._tx("ui.settings.notice.greetingText", "Greeting text: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    animations: (enabled: boolean) => this._tx("ui.settings.notice.animations", "Animations: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    interfaceLanguage: (label: string) => this._tx("settings.general.interfaceLanguage.notice", `Interface language: ${label}`, { language: label }),
    ttsEnabled: (enabled: boolean) => this._tx("ui.settings.notice.ttsEnabled", "Text to speech: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    clozeMode: (isTyped: boolean) => this._tx("ui.settings.notice.clozeMode", "Cloze mode: {mode}", {
      mode: isTyped ? this._tx("ui.settings.cards.cloze.mode.option.typed", "Typed") : this._tx("ui.settings.cards.cloze.mode.option.standard", "Standard"),
    }),
    clozeBgReset: this._tx("settings.cards.clozeBgColor.reset", "Cloze background colour reset to default"),
    clozeTextReset: this._tx("settings.cards.clozeTextColor.reset", "Cloze text colour reset to default"),
    ioDefaultModeUpdated: this._tx("ui.settings.notice.ioDefaultModeUpdated", "Default reveal mode updated"),
    ioRevealMode: (isGroup: boolean) => this._tx("ui.settings.notice.ioRevealMode", "Reveal mode: {mode}", {
      mode: isGroup
        ? this._tx("ui.settings.cards.imageOcclusion.revealMode.option.group", "Reveal group")
        : this._tx("ui.settings.cards.imageOcclusion.revealMode.option.all", "Reveal all"),
    }),
    ioTargetColorUpdated: this._tx("ui.settings.notice.ioTargetColorUpdated", "Target mask color updated"),
    ioTargetColorReset: this._tx("ui.settings.cards.imageOcclusion.targetMaskColor.resetTooltip", "Reset to theme accent"),
    ioOtherColorUpdated: this._tx("ui.settings.notice.ioOtherColorUpdated", "Other mask color updated"),
    ioOtherColorReset: this._tx("ui.settings.cards.imageOcclusion.otherMaskColor.resetTooltip", "Reset to theme foreground"),
    randomizeMcqOptions: (enabled: boolean) => this._tx("ui.settings.notice.randomizeMcqOptions", "Randomise multiple-choice options: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    randomizeOqOrder: (enabled: boolean) => this._tx("ui.settings.notice.randomizeOqOrder", "Ordered question shuffle: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    readingMacro: (label: string) => this._tx("ui.settings.notice.readingMacro", "Macro style: {label}", { label }),
    cardStyling: (enabled: boolean) => this._tx("ui.settings.notice.cardStyling", "Card styling: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    dailyNewLimit: (value: number) => this._tx("ui.settings.notice.dailyNewLimit", "Daily new limit: {value}", { value: fmtSettingValue(value) }),
    dailyReviewLimit: (value: number) => this._tx("ui.settings.notice.dailyReviewLimit", "Daily review limit: {value}", { value: fmtSettingValue(value) }),
    autoAdvanceEnabled: (enabled: boolean) => this._tx("ui.settings.notice.autoAdvanceEnabled", "Auto-advance: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    autoAdvanceSeconds: (value: number) => this._tx("ui.settings.notice.autoAdvanceSeconds", "Auto-advance: {value}s", { value: fmtSettingValue(value) }),
    remindersEnabled: (enabled: boolean) => this._tx("ui.settings.notice.remindersEnabled", "Reminders: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    remindersLaunch: (enabled: boolean) => this._tx("ui.settings.notice.remindersLaunch", "Reminders on launch: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    remindersLaunchDelay: (value: number) => this._tx("ui.settings.notice.remindersLaunchDelay", "Launch delay: {value}s", { value: fmtSettingValue(value) }),
    remindersRoutine: (enabled: boolean) => this._tx("ui.settings.notice.remindersRoutine", "Routine reminders: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    remindersRoutineFrequency: (value: number) => this._tx("ui.settings.notice.remindersRoutineFrequency", "Reminder frequency: {value} min", { value: fmtSettingValue(value) }),
    gatekeeperEnabled: (enabled: boolean) => this._tx("ui.settings.notice.gatekeeperEnabled", "Gatekeeper popups: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    gatekeeperOnStartup: (enabled: boolean) => this._tx("ui.settings.notice.gatekeeperOnStartup", "Gatekeeper on launch: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    gatekeeperFrequency: (value: number) => this._tx("ui.settings.notice.gatekeeperFrequency", "Gatekeeper frequency: {value} min", { value: fmtSettingValue(value) }),
    gatekeeperDueQuestions: (value: number) => this._tx("ui.settings.notice.gatekeeperDueQuestions", "Gatekeeper due questions: {value}", { value: fmtSettingValue(value) }),
    gatekeeperScope: (label: string) => this._tx("ui.settings.notice.gatekeeperScope", "Gatekeeper scoping: {label}", { label }),
    gatekeeperPauseWhenStudying: (enabled: boolean) => this._tx("ui.settings.notice.gatekeeperPauseWhenStudying", "Gatekeeper pause while studying: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    gatekeeperBypass: (enabled: boolean) => this._tx("ui.settings.notice.gatekeeperBypass", "Gatekeeper bypass: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    gatekeeperBypassWarning: (enabled: boolean) => this._tx("ui.settings.notice.gatekeeperBypassWarning", "Gatekeeper bypass warning: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    gradingButtons: (fourButtons: boolean) => this._tx("ui.settings.notice.gradingButtons", "Grading buttons: {count}", {
      count: fourButtons ? this._tx("ui.settings.study.gradingButtons.option.four", "Four") : this._tx("ui.settings.study.gradingButtons.option.two", "Two"),
    }),
    skipButton: (enabled: boolean) => this._tx("ui.settings.notice.skipButton", "Skip button: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    folderNotes: (enabled: boolean) => this._tx("ui.settings.notice.folderNotes", "Folder notes: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    siblingMode: (label: string) => this._tx("ui.settings.notice.siblingMode", "Sibling card management: {label}", { label }),
    fsrsPresetCustom: this._tx("ui.settings.notice.fsrsPresetCustom", "FSRS preset: custom"),
    fsrsPreset: (label: string) => this._tx("ui.settings.notice.fsrsPreset", "FSRS preset: {label}", { label }),
    learningSteps: (value: number[]) => this._tx("ui.settings.notice.learningSteps", "Learning steps: {value}", { value: fmtSettingValue(value) }),
    relearningSteps: (value: number[]) => this._tx("ui.settings.notice.relearningSteps", "Relearning steps: {value}", { value: fmtSettingValue(value) }),
    requestRetention: (value: number) => this._tx("ui.settings.notice.requestRetention", "Requested retention: {value}", { value: fmtSettingValue(value) }),
    ioAttachmentFolder: (value: string) => this._tx("ui.settings.notice.ioAttachmentFolder", "IO attachment folder: {value}", { value: fmtSettingValue(value) }),
    deleteOrphanedImages: (enabled: boolean) => this._tx("ui.settings.notice.deleteOrphanedImages", "Delete orphaned images: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    cardAttachmentFolder: (value: string) => this._tx("ui.settings.notice.cardAttachmentFolder", "Card attachment folder: {value}", { value: fmtSettingValue(value) }),
    ignoreCodeBlocks: (enabled: boolean) => this._tx("ui.settings.notice.ignoreCodeBlocks", "Ignore code blocks: {state}", {
      state: enabled ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
    }),
    cardDelimiter: (label: string) => this._tx("ui.settings.notice.cardDelimiter", "Card delimiter: {label}", { label }),
    settingsResetDefaults: this._tx("ui.settings.reset.notice.defaultsSuccess", "Settings reset to defaults"),
  };

  /** Debounce timers for settings-change notices (keyed by setting path). */
  private _noticeTimers = new Map<string, number>();

  /**
   * External callback to re-render the current tab content without a full
   * page reload.  The workspace view sets this so that structural changes
   * (presets, toggles, resets) re-render only the active sub-tab while
   * preserving scroll position and skipping AOS animations.
   */
  onRequestRerender?: () => void;

  private _getSettingsScrollContainer(): HTMLElement | null {
    const local = this.containerEl;
    const localStyle = window.getComputedStyle(local);
    const localScrollable = /(auto|scroll)/.test(localStyle.overflowY) && local.scrollHeight > local.clientHeight;
    if (localScrollable) return local;

    const nativeSettings = local.closest(".vertical-tab-content-container");
    if (nativeSettings instanceof HTMLElement) return nativeSettings;

    let node: HTMLElement | null = local.parentElement;
    while (node) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }

  private _restoreScrollPosition(container: HTMLElement | null, top: number): void {
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = top;
      // Some host layouts settle after one frame; apply once more to avoid jumps.
      requestAnimationFrame(() => {
        container.scrollTop = top;
      });
    });
  }

  /**
   * Re-render the current tab content.  Uses the external callback when
   * available (workspace view), otherwise falls back to the built-in
   * `display()` which re-renders the entire native settings modal.
   */
  private _softRerender() {
    const scrollContainer = this._getSettingsScrollContainer();
    const previousTop = scrollContainer?.scrollTop ?? 0;

    if (this.onRequestRerender) {
      this.onRequestRerender();
    } else {
      this.display();
    }

    this._restoreScrollPosition(scrollContainer, previousTop);
  }

  /**
   * Macro style definitions for Preview card appearance.
   * Each preset maps to a set of readingView setting values.
   */
  private static readonly PREVIEW_MACRO_PRESETS: Record<"flashcards" | "classic" | "markdown" | "custom", {
    labelKey: string;
    descKey: string;
    layout: "masonry" | "vertical";
    cardMode: "full" | "flip";
    visibleFields: {
      title: boolean;
      question: boolean;
      options: boolean;
      answer: boolean;
      info: boolean;
      groups: boolean;
      edit: boolean;
      displayAudioButton: boolean;
      displayEditButton: boolean;
    };
    displayLabels: boolean;
  }> = {
    "flashcards": {
      labelKey: "ui.settings.reading.presets.flashcards.label",
      descKey: "ui.settings.reading.presets.flashcards.desc",
      layout: "masonry",
      cardMode: "flip",
      visibleFields: { title: false, question: true, options: false, answer: true, info: false, groups: false, edit: false, displayAudioButton: true, displayEditButton: true },
      displayLabels: false,
    },
    "classic": {
      labelKey: "ui.settings.reading.presets.classic.label",
      descKey: "ui.settings.reading.presets.classic.desc",
      layout: "masonry",
      cardMode: "flip",
      visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true, displayAudioButton: true, displayEditButton: true },
      displayLabels: true,
    },
    "markdown": {
      labelKey: "ui.settings.reading.presets.markdown.label",
      descKey: "ui.settings.reading.presets.markdown.desc",
      layout: "vertical",
      cardMode: "full",
      visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: false, displayAudioButton: true, displayEditButton: false },
      displayLabels: true,
    },
    "custom": {
      labelKey: "ui.settings.reading.presets.custom.label",
      descKey: "ui.settings.reading.presets.custom.desc",
      layout: "masonry",
      cardMode: "full",
      visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true, displayAudioButton: true, displayEditButton: true },
      displayLabels: true,
    },
  };

  private static readonly CUSTOM_CLASSIC_STARTER_CSS = `.sprout-pretty-card.sprout-macro-custom .sprout-custom-body {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  padding: 14px;
  background: var(--background-primary);
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-section {
  margin-bottom: 10px;
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-label {
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--sprout-font-2xs);
  color: var(--text-muted);
  font-weight: 600;
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-answer,
.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-info,
.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-groups {
  border-top: 1px dashed var(--background-modifier-border);
  padding-top: 8px;
}`;

  constructor(app: App, plugin: SproutPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ── Notice helpers ────────────────────────

  /**
   * Debounced notice: queues a "Settings updated" notice so that rapid
   * slider / text changes don't spam the user.
   */
  private queueSettingsNotice(key: string, line: string, delayMs = 200) {
    const prev = this._noticeTimers.get(key);
    if (prev) window.clearTimeout(prev);

    const handle = window.setTimeout(() => {
      this._noticeTimers.delete(key);
      new Notice(this._tx("ui.settings.notice.prefix", "Sprout: {line}", { line }));
    }, Math.max(0, delayMs));

    this._noticeTimers.set(key, handle);
  }

  // ── View-refresh helpers ──────────────────

  /** Refreshes all open sidebar widget views (summary + counts). */
  private refreshAllWidgetViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET);
    for (const leaf of leaves) {
      const v = leaf.view as unknown as { resetToSummaryAndRender?: () => void; onRefresh?: () => void; render?: () => void };
      try {
        if (typeof v?.resetToSummaryAndRender === "function") v.resetToSummaryAndRender();
        else if (typeof v?.onRefresh === "function") v.onRefresh();
        else if (typeof v?.render === "function") v.render();
      } catch (e) {
        log.error("failed to refresh widget view", e);
      }
    }
  }

  /** Calls the plugin's global view-refresh function if available. */
  private refreshReviewerViewsIfPossible() {
    try {
      this.plugin.refreshAllViews();
    } catch (e) {
      log.warn("failed to refresh open views", e);
    }
  }

  // ── DB statistics helpers ─────────────────

  /**
   * Reads live statistics from the plugin store: card count, state count,
   * how many are due / learning / review / mature, review-log length,
   * quarantine size, and IO map size.
   */
  private getCurrentDbStats(): {
    cards: number;
    states: number;
    due: number;
    learning: number;
    review: number;
    mature: number;
    reviewLog: number;
    quarantine: number;
    io: number;
  } {
    const data = this.plugin.store.data;
    const cardsObj = data?.cards && typeof data.cards === "object" ? data.cards : {};
    const quarantineObj = data?.quarantine && typeof data.quarantine === "object" ? data.quarantine : {};
    const reviewableIds = new Set<string>();
    for (const [id, card] of Object.entries(cardsObj)) {
      if (!id) continue;
      if (Object.prototype.hasOwnProperty.call(quarantineObj, id)) continue;
      if (!card || typeof card !== "object") continue;
      if (isParentCard(card)) continue;
      reviewableIds.add(id);
    }

    const rawStates = data?.states && typeof data.states === "object" ? data.states : {};
    const liveStates: Record<string, CardState> = {};
    for (const [id, st] of Object.entries(rawStates)) {
      if (!reviewableIds.has(id)) continue;
      liveStates[id] = st;
    }

    const cards = reviewableIds.size;
    const states = Object.keys(liveStates).length;
    const sched = this.computeSchedulingStats(liveStates, Date.now());
    const reviewLog = Array.isArray(data?.reviewLog) ? data.reviewLog.length : 0;
    const quarantine = Object.keys(quarantineObj).length;
    const io = data?.io && typeof data.io === "object" ? Object.keys(data.io).length : 0;
    return { cards, states, due: sched.due, learning: sched.learning, review: sched.review, mature: sched.mature, reviewLog, quarantine, io };
  }

  /**
   * Scans all card states to compute scheduling counts:
   *  - `due`:      cards whose due date ≤ now (excluding suspended)
   *  - `learning`: cards in "learning" or "relearning" stage
   *  - `review`:   cards in "review" stage
   *  - `mature`:   review cards with stability ≥ 30 days
   */
  private computeSchedulingStats(states: Record<string, CardState>, now: number) {
    const out = { due: 0, learning: 0, review: 0, mature: 0 };
    if (!states || typeof states !== "object") return out;
    for (const st of Object.values(states)) {
      if (!st || typeof st !== "object") continue;
      const stage = String(st.stage ?? "");
      if (stage === "learning" || stage === "relearning") out.learning += 1;
      if (stage === "review") out.review += 1;
      const stability = Number(st.stabilityDays ?? 0);
      if (stage === "review" && Number.isFinite(stability) && stability >= 30) out.mature += 1;

      const buriedUntil = Number(st.buriedUntil ?? 0);
      if (Number.isFinite(buriedUntil) && buriedUntil > now) continue;

      const due = Number(st.due ?? 0);
      const dueEligibleStage = stage === "learning" || stage === "relearning" || stage === "review";
      if (dueEligibleStage && Number.isFinite(due) && due > 0 && due <= now) out.due += 1;
    }
    return out;
  }

  // ── Backups section ───────────────────────

  /**
   * Renders the "Backups" section of the settings panel.
   * Shows a table of existing backups with restore / delete actions,
   * plus a "Create backup now" button.
   */
  private renderBackupsSection(wrapper: HTMLElement) {
    new Setting(wrapper).setName(this._tx("ui.settings.sections.dataBackup", "Data backup")).setHeading();

    this.plugin.settings.storage ??= clonePlain(DEFAULT_SETTINGS.storage);
    this.plugin.settings.storage.backups ??= clonePlain(DEFAULT_SETTINGS.storage.backups);
    const backupCfg = this.plugin.settings.storage.backups;
    if (typeof backupCfg.rollingDailyEnabled !== "boolean") {
      backupCfg.rollingDailyEnabled = true;
    }

    new Setting(wrapper)
      .setName(this._tx("ui.settings.backups.rollingDaily.name", "Enable rolling daily backup"))
      .setDesc(this._tx("ui.settings.backups.rollingDaily.desc", "Keep one automatic daily backup (daily-backup.db). Manual backups are never auto-deleted."))
      .addToggle((t) =>
        t.setValue(backupCfg.rollingDailyEnabled).onChange(async (v) => {
          backupCfg.rollingDailyEnabled = v;
          await this.plugin.saveAll();
          this.queueSettingsNotice(
            "storage.backups.rollingDailyEnabled",
            this._tx("ui.settings.backups.rollingDaily.notice", "Rolling daily backup: {state}", {
              state: v ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
            }),
          );
        }),
      );

    {
      const createItem = wrapper.createDiv({ cls: "setting-item" });
      const createInfo = createItem.createDiv({ cls: "setting-item-info" });
      createInfo.createDiv({ cls: "setting-item-name", text: this._tx("ui.settings.backups.createBackup.name", "Create manual backup") });
      createInfo.createDiv({
        cls: "setting-item-description",
        text: this._tx("ui.settings.backups.createBackup.desc", "Save a manual restore point. Use this before risky edits or migrations."),
      });
      const createControl = createItem.createDiv({ cls: "setting-item-control" });
      const btnCreate = createControl.createEl("button", { text: this._tx("ui.settings.backups.createBackup.button", "Create manual backup") });

      const tableItem = wrapper.createDiv({ cls: "setting-item" });
      const tableControl = tableItem.createDiv({ cls: "setting-item-control sprout-settings-backup-control" });

      const tableWrap = tableControl.createDiv({ cls: "sprout-settings-table-wrap" });
      let backupPageIndex = 0;
      let backupRowsPerPage = 10;
      const backupRowsPerPageOptions = [5, 10, 25, 50, 100];

      /** Show a placeholder message inside the table wrapper. */
      const renderEmpty = (msg: string) => {
        tableWrap.empty();
        tableWrap.createDiv({ text: msg, cls: "sprout-settings-text-muted" });
      };

      const current = this.getCurrentDbStats();

      const formatCount = (n: number) => Number(n).toLocaleString();

      /** Formats a backup mtime as DD/MM/YYYY (HH:MM). */
      const formatBackupDate = (mtime: number | null | undefined) => {
        if (!mtime) return "—";
        const d = new Date(mtime);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, "0");
        const minutes = String(d.getMinutes()).padStart(2, "0");
        return `${day}/${month}/${year} (${hours}:${minutes})`;
      };

      /**
       * Derives a human-readable label from a backup filename.
       * E.g. "data.json.bak-2024-01-15T12:00:00Z-auto" → "Automatic backup".
       */
      const describeBackup = (name: string) => {
        const raw = String(name ?? "");
        if (raw === "daily-backup.db") {
          return this._tx("ui.settings.backups.label.dailyRolling", "Daily rolling backup");
        }
        if (/^manual-backup-\d{4}-\d{8}\.db$/i.test(raw)) {
          return this._tx("ui.settings.backups.label.manual", "Manual backup");
        }
        const zMatch = /^data\\.json\\.bak-([0-9T-]+Z)(?:-(.+))?$/.exec(raw);
        const labelRaw = zMatch?.[2] ? String(zMatch[2]) : "";
        const label = labelRaw.replace(/[-_]+/g, " ").trim();
        const lower = label.toLowerCase();
        if (lower.includes("auto")) return this._tx("ui.settings.backups.label.automatic", "Automatic backup");
        if (lower.includes("manual")) return this._tx("ui.settings.backups.label.manual", "Manual backup");
        if (lower.includes("before restore")) return this._tx("ui.settings.backups.label.manual", "Manual backup");
        if (label) return this._tx("ui.settings.backups.label.manual", "Manual backup");
        return raw === "data.json"
          ? this._tx("ui.settings.backups.label.currentDataJson", "Current data.json")
          : this._tx("ui.settings.backups.label.manual", "Manual backup");
      };

      /** One-line summary of scheduling data for a backup row. */
      const summaryLabel = (stats: { states: number; due: number; learning: number; review: number; mature: number }) => {
        if (!stats.states) return this._tx("ui.settings.backups.summary.noSchedulingData", "No scheduling data");
        return this._tx(
          "ui.settings.backups.summary.withData",
          "{states} states · {due} due · {learning} learning · {review} review · {mature} mature",
          {
            states: formatCount(stats.states),
            due: formatCount(stats.due),
            learning: formatCount(stats.learning),
            review: formatCount(stats.review),
            mature: formatCount(stats.mature),
          },
        );
      };

      /** Renders the backup table rows. */
      const renderTable = (rows: Array<{ stats: DataJsonBackupStats; ok: boolean; integrity: "verified" | "legacy" | "invalid" }>) => {
        tableWrap.empty();

        const filtered = rows.filter((r) => r.stats?.name !== "data.json");
        if (!filtered.length) {
          renderEmpty(this._tx("ui.settings.backups.empty.noBackups", "No backups found. Click \u201CCreate manual backup\u201D to create one."));
          return;
        }

        const totalRows = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / backupRowsPerPage));
        backupPageIndex = Math.max(0, Math.min(backupPageIndex, totalPages - 1));
        const startRow = backupPageIndex * backupRowsPerPage;
        const endRow = Math.min(totalRows, startRow + backupRowsPerPage);
        const pageRows = filtered.slice(startRow, endRow);

        const table = tableWrap.createEl("table", {
          cls: "table w-full text-sm sprout-backup-table",
        });

        /* ── header ── */
        const thead = table.createEl("thead");
        const headRow = thead.createEl("tr", { cls: "text-left border-b border-border" });
        for (const label of [
          this._tx("ui.settings.backups.table.header.backup", "Backup"),
          this._tx("ui.settings.backups.table.header.date", "Date"),
          this._tx("ui.settings.backups.table.header.schedulingData", "Scheduling data"),
          this._tx("ui.settings.backups.table.header.integrity", "Integrity"),
          this._tx("ui.settings.backups.table.header.actions", "Actions"),
        ]) {
          headRow.createEl("th", { cls: "font-medium sprout-backup-cell", text: label });
        }

        const tbody = table.createEl("tbody");

        /* ── "current data" row ── */
        const currentTr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 sprout-backup-row--current" });
        currentTr.createEl("td", { cls: "sprout-backup-cell sprout-backup-cell--label", text: this._tx("ui.settings.backups.table.currentData", "Current data") });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: this._tx("ui.settings.backups.table.now", "Now") });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: summaryLabel(current) });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: this._tx("ui.settings.backups.table.na", "—") });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: this._tx("ui.settings.backups.table.na", "—") });

        /* ── backup rows ── */
        for (const r of pageRows) {
          const s = r.stats;
          const tr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 last:border-0 sprout-backup-row--list" });

          tr.createEl("td", { cls: "sprout-backup-cell sprout-backup-cell--label", text: describeBackup(s.name) });
          tr.createEl("td", { cls: "sprout-backup-cell", text: formatBackupDate(s.mtime) });

          tr.createEl("td", {
            cls: `sprout-backup-cell${s.states > 0 ? " sprout-backup-cell--active" : ""}`,
            text: summaryLabel(s),
          });

          const integrityLabel = r.integrity === "verified"
            ? this._tx("ui.settings.backups.integrity.verified", "Verified")
            : r.integrity === "legacy"
              ? this._tx("ui.settings.backups.integrity.legacy", "Legacy")
              : this._tx("ui.settings.backups.integrity.invalid", "Invalid");
          tr.createEl("td", {
            cls: `sprout-backup-cell${r.integrity === "invalid" ? " sprout-settings-text-muted" : ""}`,
            text: integrityLabel,
          });

          const actionsTd = tr.createEl("td", { cls: "sprout-backup-cell sprout-backup-actions" });

          /* Restore button */
          const btnRestore = actionsTd.createEl("button", { cls: "sprout-settings-icon-btn" });
          btnRestore.setAttribute(
            "aria-label",
            r.integrity === "invalid"
              ? this._tx("ui.settings.backups.actions.restore.disabledTooltip", "This backup failed integrity checks and cannot be restored.")
              : this._tx("ui.settings.backups.actions.restore.tooltip", "Restore this backup and replace current scheduling data."),
          );
          setIcon(btnRestore, "archive-restore");
          if (r.integrity === "invalid") btnRestore.setAttribute("disabled", "true");
          btnRestore.onclick = () => {
            if (r.integrity === "invalid") return;
            new ConfirmRestoreBackupModal(this.app, this.plugin, s, current, () => {
              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();
              this.plugin.refreshAllViews();
              this._softRerender();
            }).open();
          };

          /* Delete button */
          const btnDelete = actionsTd.createEl("button", { cls: "sprout-settings-icon-btn sprout-settings-icon-btn--danger" });
          btnDelete.setAttribute("aria-label", this._tx("ui.settings.backups.actions.delete.tooltip", "Delete this scheduling data backup."));
          setIcon(btnDelete, "trash-2");
          btnDelete.onclick = () => {
            new ConfirmDeleteBackupModal(this.app, this.plugin, s, () => {
              void scan();
            }).open();
          };
        }

        const pager = tableWrap.createDiv({ cls: "setting-item-control" });
        pager.classList.add("sprout-backup-actions");

        const summary = pager.createEl("span", { cls: "sprout-settings-text-muted" });
        summary.textContent = this._tx("ui.settings.backups.pager.showingRange", "Showing {start}-{end} of {total} backups", {
          start: startRow + 1,
          end: endRow,
          total: totalRows,
        });

        const rowsLabel = pager.createEl("span", { cls: "sprout-settings-text-muted" });
        rowsLabel.textContent = this._tx("ui.settings.backups.pager.rowsPerPage", "Rows per page");

        const rowsSelect = pager.createEl("select", { cls: "dropdown" });
        for (const size of backupRowsPerPageOptions) {
          const opt = rowsSelect.createEl("option", { text: String(size) });
          opt.value = String(size);
          if (size === backupRowsPerPage) opt.selected = true;
        }
        rowsSelect.onchange = () => {
          const next = Number(rowsSelect.value);
          if (!Number.isFinite(next) || next <= 0) return;
          backupRowsPerPage = next;
          backupPageIndex = 0;
          renderTable(rows);
        };

        const btnPrev = pager.createEl("button", { text: this._tx("ui.settings.backups.pager.prev", "Prev"), cls: "sprout-settings-icon-btn" });
        btnPrev.setAttribute("aria-label", this._tx("ui.settings.backups.pager.prevTooltip", "Previous backup page"));
        btnPrev.setAttribute("data-tooltip-position", "top");
        if (backupPageIndex <= 0) btnPrev.setAttribute("disabled", "true");
        btnPrev.onclick = () => {
          if (backupPageIndex <= 0) return;
          backupPageIndex -= 1;
          renderTable(rows);
        };

        const pageLabel = pager.createEl("span", { cls: "sprout-settings-text-muted" });
        pageLabel.textContent = this._tx("ui.settings.backups.pager.pageXofY", "Page {page} / {total}", {
          page: backupPageIndex + 1,
          total: totalPages,
        });

        const btnNext = pager.createEl("button", { text: this._tx("ui.settings.backups.pager.next", "Next"), cls: "sprout-settings-icon-btn" });
        btnNext.setAttribute("aria-label", this._tx("ui.settings.backups.pager.nextTooltip", "Next backup page"));
        btnNext.setAttribute("data-tooltip-position", "top");
        if (backupPageIndex >= totalPages - 1) btnNext.setAttribute("disabled", "true");
        btnNext.onclick = () => {
          if (backupPageIndex >= totalPages - 1) return;
          backupPageIndex += 1;
          renderTable(rows);
        };
      };

      /** Scans the vault for backup files and populates the table. */
      const scan = async () => {
        renderEmpty(this._tx("ui.settings.backups.scan.scanning", "Scanning backups…"));
        try {
          const entries = await listDataJsonBackups(this.plugin);

          const rows: Array<{ stats: DataJsonBackupStats; ok: boolean; integrity: "verified" | "legacy" | "invalid" }> = [];
          for (const e of entries) {
            const st = await getDataJsonBackupStats(this.plugin, e.path);
            if (!st) continue;
            const integrity = await verifyDataJsonBackupIntegrity(this.plugin, e.path);
            const integrityState: "verified" | "legacy" | "invalid" = !integrity.ok
              ? "invalid"
              : integrity.verified
                ? "verified"
                : "legacy";
            rows.push({ stats: st, ok: integrity.ok, integrity: integrityState });
          }
          renderTable(rows);
        } catch (e) {
          log.error(e);
          renderEmpty(this._tx("ui.settings.backups.scan.failed", "Failed to scan backups (see console)."));
        }
      };

      btnCreate.onclick = async () => {
        try {
          const p = await createDataJsonBackupNow(this.plugin, "manual");
          if (!p) {
            new Notice(this._tx("ui.settings.backups.notice.createUnavailable", "Sprout: could not create backup (no scheduling data or adapter cannot write)."));
            return;
          }
          new Notice(this._tx("ui.settings.backups.notice.createSuccess", "Scheduling data backup created"));
          await scan();
        } catch (e) {
          log.error(e);
          new Notice(this._tx("ui.settings.backups.notice.createFailed", "Sprout: failed to create scheduling data backup (see console)."));
        }
      };

      renderEmpty(this._tx("ui.settings.backups.scan.loading", "Loading backups…"));
      void scan();
    }
  }

  // ── Vault-wide card deletion ──────────────

  /**
   * Walks every markdown file in the vault and removes:
   *  - Sprout anchor lines (`^sprout-NNNNNNNNN`)
   *  - Card blocks (Q/MCQ/CQ start lines + following field lines)
   *
   * Returns counts of files modified and lines/anchors/cards removed.
   */
  private async deleteAllSproutDataFromVault(): Promise<{
    filesTouched: number;
    anchorsRemoved: number;
    cardsRemoved: number;
    linesRemoved: number;
  }> {
    const mdFiles = this.app.vault.getMarkdownFiles();
    let filesTouched = 0;
    let anchorsRemoved = 0;
    let cardsRemoved = 0;
    let linesRemoved = 0;

    for (const f of mdFiles) {
      const text = await this.app.vault.read(f);
      const lines = text.split(/\r?\n/);

      const out: string[] = [];
      let changed = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();

        /* Remove standalone anchor lines */
        if (isAnchorLine(t)) {
          anchorsRemoved++;
          linesRemoved++;
          changed = true;
          continue;
        }

        /* Remove card blocks (start line + trailing field/anchor/blank lines) */
        if (isCardStartLine(t) && looksLikeCardBlock(lines, i)) {
          cardsRemoved++;
          linesRemoved++;
          changed = true;

          let j = i + 1;
          for (; j < lines.length; j++) {
            const tj = lines[j].trim();

            if (isCardStartLine(tj) && looksLikeCardBlock(lines, j)) break;

            if (!tj || isAnchorLine(tj) || isFieldLine(tj)) {
              if (isAnchorLine(tj)) anchorsRemoved++;
              linesRemoved++;
              continue;
            }

            break;
          }

          i = j - 1;
          continue;
        }

        out.push(line);
      }

      if (changed) {
        filesTouched++;
        await this.app.vault.modify(f, out.join("\n"));
      }
    }

    return { filesTouched, anchorsRemoved, cardsRemoved, linesRemoved };
  }

  // ── Store clearing ────────────────────────

  /** Clears all card data from the plugin store (cards, states, review log, quarantine). */
  private async clearSproutStore(): Promise<void> {
    const data = this.plugin.store.data;
    if (!data || typeof data !== "object") return;

    data.cards = {};
    data.states = {};
    data.reviewLog = [];
    data.quarantine = {};
    data.version = Math.max(Number(data.version) || 0, 5);

    await this.plugin.store.persist();
  }

  // ── Settings reset ────────────────────────

  /**
   * Attempts to reset plugin settings to defaults by trying several
   * well-known method/property names on the plugin instance.
   */
  private async resetSettingsToDefaults(): Promise<void> {
    await this.plugin.resetSettingsToDefaults();
  }

  // ── Quarantine list ───────────────────────

  /**
   * Renders the list of quarantined (un-parseable) cards at the bottom
   * of the settings panel, each with an "Open note" button.
   */
  private renderQuarantineList(containerEl: HTMLElement) {
    const q = this.plugin.store.data.quarantine || {};
    const ids = Object.keys(q);

    if (!ids.length) {
      const item = containerEl.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: this._tx("ui.settings.quarantine.empty", "No quarantined cards."),
      });
      return;
    }

    ids
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200)
      .forEach((id) => {
        const entry = q[id];

        const item = containerEl.createDiv({ cls: "setting-item" });

        const info = item.createDiv({ cls: "setting-item-info" });
        info.createDiv({
          cls: "setting-item-name",
          text: this._tx("ui.settings.quarantine.idLabel", "ID {id}", { id }),
        });
        info.createDiv({
          cls: "setting-item-description",
          text: entry?.reason || this._tx("ui.settings.quarantine.parseError", "Parse error"),
        });

        const control = item.createDiv({ cls: "setting-item-control" });
        const btn = control.createEl("button", { text: this._tx("ui.settings.quarantine.openNote", "Open note") });
        btn.onclick = async () => {
          const notePath = entry?.notePath;
          if (!notePath) return;

          const anchor = `^sprout-${id}`;
          try {
            void this.app.workspace.openLinkText(`${notePath}#${anchor}`, notePath, false);
            return;
          } catch (e) { log.swallow("open link text", e); }

          const f = this.app.vault.getAbstractFileByPath(notePath);
          if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
        };
      });
  }

  // ────────────────────────────────────────────
  // Teardown
  // ────────────────────────────────────────────

  /**
   * Called by Obsidian when the settings tab is navigated away from.
   * Clears pending timers and removes any body-appended popovers so they
   * don't leak into other views.
   */
  override hide() {
    // Cancel all debounced notice timers.
    for (const handle of this._noticeTimers.values()) {
      window.clearTimeout(handle);
    }
    this._noticeTimers.clear();

    // Cancel the debounced custom-CSS save timer.
    if (this._readingCustomCssSaveTimer != null) {
      window.clearTimeout(this._readingCustomCssSaveTimer);
      this._readingCustomCssSaveTimer = null;
    }

    // Remove any orphaned body-portal popovers created by
    // _addSimpleSelect / _addSearchablePopover.
    document.body
      .querySelectorAll(":scope > .sprout > .sprout-popover-overlay")
      .forEach((el) => el.parentElement?.remove());
  }

  // ────────────────────────────────────────────
  // Main display() method
  // ────────────────────────────────────────────

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // When opened from the native Obsidian settings modal (not embedded in
    // the Sprout workspace view), show a redirect message instead of the
    // full settings UI.
    if (!this.onRequestRerender) {
      const wrapper = containerEl.createDiv({ cls: "sprout-settings-wrapper sprout-settings" });
      new Setting(wrapper).setName(this._tx("ui.settings.sections.sprout", "Sprout")).setHeading();
      const desc = wrapper.createDiv({ cls: "setting-item" });
      const info = desc.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: this._tx(
          "ui.settings.redirect.description",
          "Sprout settings live inside the plugin. Click the button below to open them.",
        ),
      });
      new Setting(wrapper)
        .addButton((b) =>
          b.setButtonText(this._tx("ui.settings.redirect.openButton", "Open settings")).setCta().onClick(() => {
            // Close the Obsidian settings modal
            (this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
            // Open the in-plugin settings view
            void (this.plugin as unknown as { openSettingsTab?: (forceNew?: boolean, targetTab?: string) => Promise<void> })
              .openSettingsTab?.(false, "settings");
          }),
        );
      return;
    }

    // Create a wrapper for all settings (everything should render inside this)
    const wrapper = containerEl.createDiv({ cls: "sprout-settings-wrapper sprout-settings" });

    this.renderAppearanceSection(wrapper);
    this.renderAudioSection(wrapper);
    this.renderCardsSection(wrapper);
    this.renderReadingViewSection(wrapper);
    this.renderStudySection(wrapper);
    this.renderStudyAssistantSection(wrapper);
    this.renderSchedulingSection(wrapper);
    this.renderStorageSection(wrapper);
    this.renderSyncSection(wrapper);
    this.renderResetSection(wrapper);

    this._styleSettingsButtons(wrapper);
  }

  private renderAppearanceSection(wrapper: HTMLElement): void {
    // Appearance title above user details
    new Setting(wrapper).setName(this._tx("ui.settings.sections.appearance", "Appearance")).setHeading();

    // ----------------------------
    // General
    // ----------------------------

    new Setting(wrapper)
      .setName(this._tx("ui.settings.appearance.userName.name", "User name"))
      .setDesc(this._tx("ui.settings.appearance.userName.desc", "Name used in greetings."))
      .addText((t) => {
        t.setPlaceholder(this._tx("ui.settings.appearance.userName.placeholder", "Your name"));
        t.setValue(String(this.plugin.settings.general.userName ?? ""));
        t.onChange(async (v) => {
          const next = v.trim();
          this.plugin.settings.general.userName = next;
          await this.plugin.saveAll();
          this.queueSettingsNotice("general.userName", this._noticeLines.userName(next));
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.appearance.showGreeting.name", "Show greeting text"))
      .setDesc(this._tx("ui.settings.appearance.showGreeting.desc", "Turn off to show only \"home\" on the home page."))
      .addToggle((t) => {
        t.setValue(this.plugin.settings.general.showGreeting !== false);
        t.onChange(async (v) => {
          this.plugin.settings.general.showGreeting = !!v;
          await this.plugin.saveAll();
          this.queueSettingsNotice("general.showGreeting", this._noticeLines.greetingText(v));
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.appearance.enableAnimations.name", "Enable animations"))
      .setDesc(this._tx("ui.settings.appearance.enableAnimations.desc", "Show fade-up animations when pages load."))
      .addToggle((t) =>
        t.setValue(this.plugin.settings?.general?.enableAnimations ?? true).onChange(async (v) => {
          if (!this.plugin.settings.general) this.plugin.settings.general = {} as typeof this.plugin.settings.general;
          this.plugin.settings.general.enableAnimations = v;
          await this.plugin.saveAll();
          this.queueSettingsNotice("general.enableAnimations", this._noticeLines.animations(v));
        }),
      );

    new Setting(wrapper).setName(this._tx("ui.settings.sections.language", "Language")).setHeading();

    const localeOptions = getSupportedInterfaceLocales().map((locale) => ({
      value: locale.code,
      label: locale.label,
      description: locale.nativeLabel,
      flagCode: locale.flagCode,
    }));
    const currentLocale = resolveInterfaceLocale(this.plugin.settings?.general?.interfaceLanguage);

    this._addSearchablePopover(wrapper, {
      name: t(currentLocale, "settings.general.interfaceLanguage.name", "Interface language"),
      description: t(
        currentLocale,
        "settings.general.interfaceLanguage.desc",
        "Choose the language used by Sprout's interface. More languages will appear here as translations are added.",
      ),
      options: localeOptions,
      value: currentLocale,
      onChange: (value: string) => {
        void (async () => {
          const next = resolveInterfaceLocale(value);
          if (!this.plugin.settings.general) this.plugin.settings.general = {} as typeof this.plugin.settings.general;
          this.plugin.settings.general.interfaceLanguage = next;
          await this.plugin.saveAll();
          const selectedLabel = getInterfaceLocaleLabel(next);
          this.queueSettingsNotice("general.interfaceLanguage", this._noticeLines.interfaceLanguage(selectedLabel));
        })();
      },
    });

    new Setting(wrapper)
      .setName(t(currentLocale, "settings.general.translationHelp.name", "Help translate Sprout"))
      .setDesc(
        t(
          currentLocale,
          "settings.general.translationHelp.desc",
          "Sprout translations are crowdsourced. Contribute a language, improve wording, or help review existing translations.",
        ),
      )
      .addButton((b) =>
        b
          .setButtonText(t(currentLocale, "settings.general.translationHelp.cta", "Contribute translations"))
          .setCta()
          .onClick(() => {
            window.open(SproutSettingsTab.TRANSLATIONS_GUIDE_URL, "_blank", "noopener,noreferrer");
          }),
      );
  }

  private renderAudioSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Audio
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.textToSpeech", "Text to speech")).setHeading();

    {
      const descItem = wrapper.createDiv({ cls: "setting-item" });
      const descInfo = descItem.createDiv({ cls: "setting-item-info" });
      descInfo.createDiv({
        cls: "setting-item-description",
        text: this._tx(
          "ui.settings.audio.description",
          "Read flashcard content aloud using your system's built-in text-to-speech. " +
            "Non-Latin scripts are detected automatically and matched to the best available system voice. " +
            "Latin-script text uses your chosen default voice.",
        ),
      });
    }

    const audio = this.plugin.settings.audio;

    new Setting(wrapper)
      .setName(this._tx("ui.settings.audio.enabled.name", "Enable text to speech"))
      .setDesc(
        this._tx(
          "ui.settings.audio.enabled.desc",
          "Enable or disable text to speech for cards that match your audio settings. " +
            "If \"Limit to group\" is set, only that group is read aloud.",
        ),
      )
      .addToggle((t) => {
        t.setValue(audio.enabled);
        t.onChange(async (v) => {
          this.plugin.settings.audio.enabled = v;
          await this.plugin.saveAll();
          audioDetailsContainer.hidden = !v;
          this.queueSettingsNotice("audio.enabled", this._noticeLines.ttsEnabled(v));
        });
      });

    const audioDetailsContainer = wrapper.createDiv({ cls: "sprout-audio-details" });
    audioDetailsContainer.hidden = !audio.enabled;

    {
      const detailsWrapper = audioDetailsContainer;
      audio.scriptLanguages ??= {
        cyrillic: "ru-RU",
        arabic: "ar-SA",
        cjk: "zh-CN",
        devanagari: "hi-IN",
      };
      if (typeof (audio as Record<string, unknown>).useFlagsForVoiceSelection !== "boolean") {
        (audio as Record<string, unknown>).useFlagsForVoiceSelection = true;
      }
      if (typeof (audio as Record<string, unknown>).speakFlagLanguageLabel !== "boolean") {
        (audio as Record<string, unknown>).speakFlagLanguageLabel = false;
      }

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.limitToGroup.name", "Limit to group"))
        .setDesc(
          this._tx("ui.settings.audio.limitToGroup.desc", "Limit read-aloud to one group. Leave blank to include every card."),
        )
        .addText((t) => {
          t.setPlaceholder(this._tx("ui.settings.audio.limitToGroup.placeholder", "Example: tts"));
          t.setValue(audio.limitToGroup || "");
          t.onChange(async (v) => {
            this.plugin.settings.audio.limitToGroup = v.trim();
            await this.plugin.saveAll();
          });
        });

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.autoplay.name", "Autoplay audio"))
        .setDesc(
          this._tx(
            "ui.settings.audio.autoplay.desc",
            "Automatically read the question when a card appears, then the answer when it is revealed.",
          ),
        )
        .addToggle((t) => {
          t.setValue(audio.autoplay ?? true);
          t.onChange(async (v) => {
            this.plugin.settings.audio.autoplay = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.widgetReplay.name", "Read aloud + replay in widget"))
        .setDesc(this._tx("ui.settings.audio.widgetReplay.desc", "Automatically read widget card content and show replay buttons."))
        .addToggle((t) => {
          t.setValue((audio as Record<string, unknown>).widgetReplay !== false);
          t.onChange(async (v) => {
            (this.plugin.settings.audio as Record<string, unknown>).widgetReplay = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.gatekeeperReplay.name", "Read aloud + replay in gatekeeper"))
        .setDesc(this._tx("ui.settings.audio.gatekeeperReplay.desc", "Automatically read gatekeeper question/answer content and show replay buttons."))
        .addToggle((t) => {
          t.setValue((audio as Record<string, unknown>).gatekeeperReplay === true);
          t.onChange(async (v) => {
            (this.plugin.settings.audio as Record<string, unknown>).gatekeeperReplay = v;
            await this.plugin.saveAll();
          });
        });

      this._addSearchablePopover(detailsWrapper, {
        name: this._tx("ui.settings.audio.clozeAnswerMode.name", "Cloze answer read mode"),
        description:
          this._tx(
            "ui.settings.audio.clozeAnswerMode.desc",
            "\"Just the answer\" reads only the cloze answer (for example, \"mitochondria\"). " +
              "\"Full sentence\" reads the full sentence with the answer filled in.",
          ),
        options: [
          { value: "cloze-only", label: this._tx("ui.settings.audio.clozeAnswerMode.option.clozeOnly", "Just the answer") },
          { value: "full-sentence", label: this._tx("ui.settings.audio.clozeAnswerMode.option.fullSentence", "Full sentence") },
        ],
        value: audio.clozeAnswerMode || "cloze-only",
        onChange: (v) => {
          void (async () => {
            this.plugin.settings.audio.clozeAnswerMode = v as "cloze-only" | "full-sentence";
            await this.plugin.saveAll();
          })();
        },
      });

      new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.flagAwareRouting", "Flag-aware routing")).setHeading();

      const flagsRoutingSetting = new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.flagRouting.useFlags.name", "Use flags for language and accent"))
        .setDesc(this._tx("ui.settings.audio.flagRouting.useFlags.desc", "Let flags control language/accent during playback."))
        .addToggle((t) => {
          t.setValue(Boolean((audio as Record<string, unknown>).useFlagsForVoiceSelection));
          t.onChange(async (v) => {
            (this.plugin.settings.audio as Record<string, unknown>).useFlagsForVoiceSelection = v;
            await this.plugin.saveAll();
          });
        });

      flagsRoutingSetting.descEl.appendText(" ");
      const flagsGuideLink = flagsRoutingSetting.descEl.createEl("a", {
        text: this._tx("ui.settings.audio.flagRouting.guide.link", "Click here"),
        href: "#",
      });
      flagsGuideLink.onclick = (evt) => {
        evt.preventDefault();
        void this.app.workspace.openLinkText("Flags", "", false);
      };
      flagsRoutingSetting.descEl.appendText(this._tx("ui.settings.audio.flagRouting.guide.trailing", " for a guide on using flags."));

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.flagRouting.speakLabel.name", "Speak language name before flag segments"))
        .setDesc(
          this._tx(
            "ui.settings.audio.flagRouting.speakLabel.desc",
            "Say the language name before each flag-switched segment (for example: \"spanish\").",
          ),
        )
        .addToggle((t) => {
          t.setValue(Boolean((audio as Record<string, unknown>).speakFlagLanguageLabel));
          t.onChange(async (v) => {
            (this.plugin.settings.audio as Record<string, unknown>).speakFlagLanguageLabel = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.voiceAndAccent", "Voice and accent")).setHeading();

      const langOptions = getLanguageOptions();
      this._addSearchablePopover(detailsWrapper, {
        name: this._tx("ui.settings.audio.defaultVoice.name", "Default voice"),
        description:
          this._tx(
            "ui.settings.audio.defaultVoice.desc",
            "Choose the accent and dialect for Latin-script text (English, Spanish, French, etc.). " +
              "Also sets the word used for \"blank\" on cloze fronts.",
          ),
          options: langOptions.map((o) => ({ value: o.value, label: o.label, flagCode: o.flagCode })),
        value: audio.defaultLanguage || "en-US",
        onChange: (v) => {
          void (async () => {
            this.plugin.settings.audio.defaultLanguage = v;
            await this.plugin.saveAll();
          })();
        },
      });

      {
        const advancedItem = detailsWrapper.createDiv({ cls: "setting-item sprout-settings-advanced-row" });
        const advancedInfo = advancedItem.createDiv({ cls: "setting-item-info" });
        advancedInfo.createDiv({
          cls: "setting-item-name",
          text: this._audioAdvancedOptionsExpanded
            ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
            : this._tx("ui.settings.audio.advanced.show", "Show advanced options"),
        });
        advancedInfo.createDiv({
          cls: "setting-item-description",
          text: this._tx(
            "ui.settings.audio.advanced.description",
            "Choose language defaults for non-Latin scripts when script detection is ambiguous.",
          ),
        });

        const advancedControl = advancedItem.createDiv({ cls: "setting-item-control" });
        const advancedToggle = advancedControl.createEl("button", {
          cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm sprout-settings-action-btn sprout-settings-advanced-toggle",
        });
        advancedToggle.type = "button";
        advancedToggle.setAttribute(
          "aria-label",
          this._audioAdvancedOptionsExpanded
            ? this._tx("ui.settings.audio.advanced.tooltipHide", "Hide advanced voice options")
            : this._tx("ui.settings.audio.advanced.tooltipShow", "Show advanced voice options"),
        );
        advancedToggle.setAttribute("data-tooltip-position", "top");
        advancedToggle.setAttribute("aria-expanded", this._audioAdvancedOptionsExpanded ? "true" : "false");

        const advancedToggleLabel = advancedToggle.createSpan({
          text: this._audioAdvancedOptionsExpanded
            ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
            : this._tx("ui.settings.audio.advanced.show", "Show advanced options"),
        });
        const advancedChevron = advancedToggle.createSpan({ cls: "sprout-settings-advanced-chevron" });
        setIcon(advancedChevron, "chevron-down");
        advancedChevron.classList.toggle("is-expanded", this._audioAdvancedOptionsExpanded);

        const advancedContent = detailsWrapper.createDiv({ cls: "sprout-settings-advanced-content" });
        advancedContent.hidden = !this._audioAdvancedOptionsExpanded;

        for (const group of getScriptLanguageGroups()) {
          this._addSearchablePopover(advancedContent, {
            name: group.label,
            description: group.description,
              options: group.languages.map((o) => ({ value: o.value, label: o.label, flagCode: o.flagCode })),
            value: audio.scriptLanguages[group.key],
            onChange: (v) => {
              void (async () => {
                this.plugin.settings.audio.scriptLanguages[group.key] = v;
                await this.plugin.saveAll();
              })();
            },
          });
        }

        advancedToggle.onclick = () => {
          this._audioAdvancedOptionsExpanded = !this._audioAdvancedOptionsExpanded;
          const expanded = this._audioAdvancedOptionsExpanded;
          advancedContent.hidden = !expanded;
          advancedInfo.querySelector<HTMLElement>(".setting-item-name")!.textContent =
            expanded
              ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
              : this._tx("ui.settings.audio.advanced.show", "Show advanced options");
          advancedToggleLabel.textContent = expanded
            ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
            : this._tx("ui.settings.audio.advanced.show", "Show advanced options");
          advancedToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          advancedToggle.setAttribute(
            "aria-label",
            expanded
              ? this._tx("ui.settings.audio.advanced.tooltipHide", "Hide advanced voice options")
              : this._tx("ui.settings.audio.advanced.tooltipShow", "Show advanced voice options"),
          );
          advancedChevron.classList.toggle("is-expanded", expanded);
        };
      }

      new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.voiceTuning", "Voice tuning")).setHeading();

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.rate.name", "Speech rate"))
        .setDesc(this._tx("ui.settings.audio.rate.desc", "Speech speed (0.5 = slow, 1.0 = normal, 2.0 = fast)."))
        .addSlider((s) => {
          s.setLimits(0.5, 2.0, 0.1);
          s.setValue(audio.rate ?? 1.0);
          s.setDynamicTooltip();
          s.onChange(async (v) => {
            this.plugin.settings.audio.rate = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.pitch.name", "Speech pitch"))
        .setDesc(this._tx("ui.settings.audio.pitch.desc", "Pitch of speech (0.5 = low, 1.0 = normal, 2.0 = high)."))
        .addSlider((s) => {
          s.setLimits(0.5, 2.0, 0.1);
          s.setValue(audio.pitch ?? 1.0);
          s.setDynamicTooltip();
          s.onChange(async (v) => {
            this.plugin.settings.audio.pitch = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(detailsWrapper)
        .setName(this._tx("ui.settings.audio.testVoice.name", "Test voice"))
        .setDesc(this._tx("ui.settings.audio.testVoice.desc", "Play a sample to hear the current voice settings."))
        .addButton((btn) => {
          btn.setButtonText(this._tx("ui.settings.audio.testVoice.playButton", "Play sample"));
          btn.onClick(() => {
            const tts = getTtsService();
            if (!tts.isSupported) {
              new Notice(this._noticeLines.ttsNotSupported);
              return;
            }
            const sampleLang = audio.defaultLanguage || "en-US";
            const primary = sampleLang.split("-")[0];
            const samples: Record<string, string> = {
              en: "This is a sample of the text-to-speech voice.",
              es: "Esta es una muestra de la voz de texto a voz.",
              fr: "Ceci est un échantillon de la voix de synthèse vocale.",
              de: "Dies ist ein Beispiel für die Text-to-Speech-Stimme.",
              it: "Questo è un campione della voce text-to-speech.",
              pt: "Esta é uma amostra da voz de texto para fala.",
              ja: "これはテキスト読み上げ音声のサンプルです。",
              zh: "这是文字转语音的示例。",
              ko: "텍스트 음성 변환의 샘플입니다.",
              ar: "هذه عينة من صوت تحويل النص إلى كلام.",
              ru: "Это пример голоса синтеза речи.",
              hi: "यह टेक्स्ट-टू-स्पीच आवाज़ का एक नमूना है।",
            };
            const sample = samples[primary] ?? samples["en"] ?? "This is a sample of the text-to-speech voice.";
            tts.speak(sample, sampleLang, audio, false, true);
          });
        });

      const voices = getAvailableVoices();
      if (voices.length === 0) {
        new Setting(detailsWrapper)
          .setName(this._tx("ui.settings.audio.availableVoices.name", "Available system voices"))
          .setDesc(
            this._tx(
              "ui.settings.audio.availableVoices.desc",
              "No system voices detected yet. Voices load asynchronously, so try reopening this tab. " +
                "If it is still empty, check your operating system's speech settings.",
            ),
          );
      }
    }
  }

  private renderCardsSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Cards
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.basicCards", "Basic cards")).setHeading();

    // Basic section
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: this._tx("ui.settings.cards.basic.empty", "No settings available yet."),
      });
    }

    // ── Cloze section ──
    new Setting(wrapper).setName(this._tx("ui.settings.sections.cloze", "Cloze")).setHeading();

    const cardsSettings = this.plugin.settings.cards ??
      { clozeMode: "standard" as const, clozeBgColor: "", clozeTextColor: "" };

    if (!this.plugin.settings.cards) {
      (this.plugin.settings as Record<string, unknown>).cards = cardsSettings;
    }

    const colourSettingEls: HTMLElement[] = [];

    const updateColourSettingsState = () => {
      const isTyped = cardsSettings.clozeMode === "typed";
      for (const el of colourSettingEls) {
        el.classList.toggle("sprout-disabled-opacity", isTyped);
        el.querySelectorAll<HTMLInputElement>("input").forEach(inp => {
          inp.disabled = isTyped;
        });
      }
    };

    new Setting(wrapper)
      .setName(this._tx("ui.settings.cards.cloze.mode.name", "Cloze mode"))
      .setDesc(this._tx("ui.settings.cards.cloze.mode.desc", "Choose how cloze cards are answered: standard blanks or typed input."))
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            {
              value: "standard",
              label: this._tx("ui.settings.cards.cloze.mode.option.standard", "Standard"),
            },
            {
              value: "typed",
              label: this._tx("ui.settings.cards.cloze.mode.option.typed", "Typed"),
            },
          ],
          value: cardsSettings.clozeMode ?? "standard",
          onChange: (v) => {
            void (async () => {
              const prev = cardsSettings.clozeMode;
              cardsSettings.clozeMode = v as "standard" | "typed";
              await this.plugin.saveAll();
              this.refreshReviewerViewsIfPossible();
              updateColourSettingsState();

              if (prev !== v) {
                this.queueSettingsNotice("cards.clozeMode", this._noticeLines.clozeMode(v === "typed"));
              }
            })();
          },
        });
      });

    // Cloze background colour
    const bgColourSetting = new Setting(wrapper)
      .setName(this._tx("settings.cards.clozeBgColor.name", "Cloze background colour"))
      .setDesc(this._tx(
        "settings.cards.clozeBgColor.desc",
        "Background colour for revealed cloze pills. Leave empty to use the theme accent. Standard mode only.",
      ));

    const bgRestoreEl = bgColourSetting.controlEl.createDiv({
      cls: "clickable-icon extra-setting-button sprout-colour-restore",
    });
    bgRestoreEl.setAttribute("aria-label", this._tx("ui.settings.cards.cloze.bgColor.restoreTooltip", "Restore default"));
    bgRestoreEl.setAttribute("data-tooltip-position", "top");
    bgRestoreEl.setAttribute("aria-disabled", cardsSettings.clozeBgColor ? "false" : "true");
    setIcon(bgRestoreEl, "rotate-ccw");
    bgRestoreEl.addEventListener("click", () => {
      void (async () => {
        if (bgRestoreEl.getAttribute("aria-disabled") === "true") return;
        cardsSettings.clozeBgColor = "";
        await this.plugin.saveAll();
        this.refreshReviewerViewsIfPossible();
        bgRestoreEl.setAttribute("aria-disabled", "true");
        const picker = bgColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
        if (picker) picker.value = "#7c3aed";
        this.queueSettingsNotice(
          "cards.clozeBgColor",
          this._tx("settings.cards.clozeBgColor.reset", "Cloze background colour reset to default"),
          0,
        );
      })();
    });

    bgColourSetting.controlEl.createEl("input", {
      type: "color",
      value: cardsSettings.clozeBgColor || "#7c3aed",
      cls: "sprout-colour-picker",
    }, (inp) => {
      inp.addEventListener("input", () => {
        cardsSettings.clozeBgColor = inp.value;
        void this.plugin.saveAll().then(() => this.refreshReviewerViewsIfPossible());
        bgRestoreEl.setAttribute("aria-disabled", "false");
      });
    });

    colourSettingEls.push(bgColourSetting.settingEl);

    // Cloze text colour
    const textColourSetting = new Setting(wrapper)
      .setName(this._tx("settings.cards.clozeTextColor.name", "Cloze text colour"))
      .setDesc(this._tx(
        "settings.cards.clozeTextColor.desc",
        "Text colour for revealed cloze pills. Leave empty for automatic contrast. Standard mode only.",
      ));

    const textRestoreEl = textColourSetting.controlEl.createDiv({
      cls: "clickable-icon extra-setting-button sprout-colour-restore",
    });
    textRestoreEl.setAttribute("aria-label", this._tx("ui.settings.cards.cloze.textColor.restoreTooltip", "Restore default"));
    textRestoreEl.setAttribute("data-tooltip-position", "top");
    textRestoreEl.setAttribute("aria-disabled", cardsSettings.clozeTextColor ? "false" : "true");
    setIcon(textRestoreEl, "rotate-ccw");
    textRestoreEl.addEventListener("click", () => {
      void (async () => {
        if (textRestoreEl.getAttribute("aria-disabled") === "true") return;
        cardsSettings.clozeTextColor = "";
        await this.plugin.saveAll();
        this.refreshReviewerViewsIfPossible();
        textRestoreEl.setAttribute("aria-disabled", "true");
        const picker = textColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
        if (picker) picker.value = "#ffffff";
        this.queueSettingsNotice(
          "cards.clozeTextColor",
          this._tx("settings.cards.clozeTextColor.reset", "Cloze text colour reset to default"),
          0,
        );
      })();
    });

    textColourSetting.controlEl.createEl("input", {
      type: "color",
      value: cardsSettings.clozeTextColor || "#ffffff",
      cls: "sprout-colour-picker",
    }, (inp) => {
      inp.addEventListener("input", () => {
        cardsSettings.clozeTextColor = inp.value;
        void this.plugin.saveAll().then(() => this.refreshReviewerViewsIfPossible());
        textRestoreEl.setAttribute("aria-disabled", "false");
      });
    });

    colourSettingEls.push(textColourSetting.settingEl);

    updateColourSettingsState();

    // ── Image occlusion section ──
    new Setting(wrapper).setName(this._tx("ui.settings.sections.imageOcclusion", "Image occlusion")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.cards.imageOcclusion.revealMode.name", "Reveal mode"))
      .setDesc(this._tx("ui.settings.cards.imageOcclusion.revealMode.desc", "For hide-all cards: \"reveal group\" shows only the answer group, and \"reveal all\" shows every group."))
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            {
              value: "group",
              label: this._tx("ui.settings.cards.imageOcclusion.revealMode.option.group", "Reveal group"),
            },
            {
              value: "all",
              label: this._tx("ui.settings.cards.imageOcclusion.revealMode.option.all", "Reveal all"),
            },
          ],
          value: this.plugin.settings.imageOcclusion?.revealMode || "group",
          onChange: (val) => {
            void (async () => {
              if (val === "group" || val === "all") {
                this.plugin.settings.imageOcclusion.revealMode = val;
                await this.plugin.saveAll();
                this.refreshReviewerViewsIfPossible();
                this.refreshAllWidgetViews();
                this.queueSettingsNotice("io-reveal-mode", this._noticeLines.ioRevealMode(val === "group"));
              }
            })();
          },
        });
      });

    const targetColourSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.cards.imageOcclusion.targetMaskColor.name", "Target mask colour"))
      .setDesc(this._tx("ui.settings.cards.imageOcclusion.targetMaskColor.desc", "Background colour for the active mask. Leave empty to use the theme accent."))
      .addText((t) => {
        t.inputEl.type = "color";
        const currentColor = this.plugin.settings.imageOcclusion?.maskTargetColor || "";
        if (currentColor) {
          t.setValue(currentColor);
        }
        t.onChange(async (val) => {
          this.plugin.settings.imageOcclusion.maskTargetColor = val;
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-target-color", this._noticeLines.ioTargetColorUpdated);
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("reset");
        btn.extraSettingsEl.setAttribute(
          "aria-label",
          this._tx("ui.settings.cards.imageOcclusion.targetMaskColor.resetTooltip", "Reset to theme accent"),
        );
        btn.extraSettingsEl.setAttribute("data-tooltip-position", "top");
        btn.onClick(async () => {
          this.plugin.settings.imageOcclusion.maskTargetColor = "";
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-target-color", this._noticeLines.ioTargetColorReset);
          const picker = targetColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
          if (picker) picker.value = "";
        });
      });

    const otherColourSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.cards.imageOcclusion.otherMaskColor.name", "Other mask colour"))
      .setDesc(this._tx("ui.settings.cards.imageOcclusion.otherMaskColor.desc", "Background colour for context masks. Leave empty to use the theme foreground colour."))
      .addText((t) => {
        t.inputEl.type = "color";
        const currentColor = this.plugin.settings.imageOcclusion?.maskOtherColor || "";
        if (currentColor) {
          t.setValue(currentColor);
        }
        t.onChange(async (val) => {
          this.plugin.settings.imageOcclusion.maskOtherColor = val;
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-other-color", this._noticeLines.ioOtherColorUpdated);
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("reset");
        btn.extraSettingsEl.setAttribute(
          "aria-label",
          this._tx("ui.settings.cards.imageOcclusion.otherMaskColor.resetTooltip", "Reset to theme foreground"),
        );
        btn.extraSettingsEl.setAttribute("data-tooltip-position", "top");
        btn.onClick(async () => {
          this.plugin.settings.imageOcclusion.maskOtherColor = "";
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-other-color", this._noticeLines.ioOtherColorReset);
          const picker = otherColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
          if (picker) picker.value = "";
        });
      });

    // Mask icon
    {
      const maskSetting = new Setting(wrapper)
        .setName(this._tx("ui.settings.cards.imageOcclusion.maskIcon.name", "Mask icon"))
        .setDesc(this._tx("ui.settings.cards.imageOcclusion.maskIcon.desc", "Icon shown on the target mask during review."));

      const currentIcon = String(this.plugin.settings.imageOcclusion?.maskIcon ?? "question-circle").trim();
      type IconChoice = "question-circle" | "eye" | "custom" | "none";
      let activeChoice: IconChoice =
        currentIcon === "" ? "none"
        : currentIcon === "question-circle" || currentIcon === "circle-help" ? "question-circle"
        : currentIcon === "eye" || currentIcon === "eye-off" ? "eye"
        : "custom";
      let customText = activeChoice === "custom" ? currentIcon : "";

      const controlEl = maskSetting.controlEl;
      controlEl.empty();
      controlEl.classList.add("sprout-io-icon-picker");

      const choices: { key: IconChoice; icon?: string; label: string }[] = [
        { key: "question-circle", icon: "circle-help", label: "" },
        { key: "eye", icon: "eye", label: "" },
        { key: "none", label: this._tx("ui.settings.cards.imageOcclusion.maskIcon.option.none", "None") },
        { key: "custom", label: this._tx("ui.settings.cards.imageOcclusion.maskIcon.option.custom", "Custom") },
      ];

      const chips: HTMLElement[] = [];
      let customInput: HTMLInputElement | null = null;

      const saveIcon = async () => {
        let val = "";
        if (activeChoice === "question-circle" || activeChoice === "eye") val = activeChoice;
        else if (activeChoice === "custom") val = customText;
        this.plugin.settings.imageOcclusion.maskIcon = val;
        await this.plugin.saveAll();
      };

      const updateState = () => {
        chips.forEach((c) => {
          const key = c.dataset.key as IconChoice;
          c.classList.toggle("is-active", key === activeChoice);
        });
        if (customInput) {
          customInput.hidden = activeChoice !== "custom";
        }
      };

      for (const ch of choices) {
        const chip = controlEl.createEl("button", { cls: "sprout-io-icon-chip" });
        chip.dataset.key = ch.key;
        if (ch.icon) {
          setIcon(chip, ch.icon);
        } else {
          chip.textContent = ch.label;
        }
        chip.addEventListener("click", () => {
          void (async () => {
            activeChoice = ch.key;
            updateState();
            await saveIcon();
          })();
        });
        chips.push(chip);
      }

      customInput = controlEl.createEl("input", {
        type: "text",
        cls: "sprout-io-icon-custom-input",
        placeholder: "?",
        value: customText,
      });
      customInput.addEventListener("input", () => {
        void (async () => {
          if (!customInput) return;
          customText = customInput.value;
          await saveIcon();
        })();
      });

      updateState();
    }

    // Multiple choice section
    new Setting(wrapper).setName(this._tx("ui.settings.sections.multipleChoice", "Multiple choice")).setHeading();
    new Setting(wrapper)
      .setName(this._tx("ui.settings.cards.multipleChoice.shuffle.name", "Shuffle order"))
      .setDesc(this._tx("ui.settings.cards.multipleChoice.shuffle.desc", "Shuffle answer order in multiple-choice and multi-select questions."))
      .addToggle((t) => {
        const cur = !!this.plugin.settings.study.randomizeMcqOptions;
        t.setValue(cur);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.study.randomizeMcqOptions;
          this.plugin.settings.study.randomizeMcqOptions = v;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.randomizeMcqOptions", this._noticeLines.randomizeMcqOptions(v));
          }
        });
      });

    // Ordered questions section
    new Setting(wrapper).setName(this._tx("ui.settings.sections.orderedQuestions", "Ordered questions")).setHeading();
    new Setting(wrapper)
      .setName(this._tx("ui.settings.cards.orderedQuestions.shuffle.name", "Shuffle order"))
      .setDesc(this._tx("ui.settings.cards.orderedQuestions.shuffle.desc", "Shuffle step order each time the question appears."))
      .addToggle((t) => {
        const cur = this.plugin.settings.study.randomizeOqOrder ?? true;
        t.setValue(cur);
        t.onChange(async (v) => {
          const prev = this.plugin.settings.study.randomizeOqOrder ?? true;
          this.plugin.settings.study.randomizeOqOrder = v;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.randomizeOqOrder", this._noticeLines.randomizeOqOrder(v));
          }
        });
      });
  }

  private renderReadingViewSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Reading
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.readingViewStyles", "Reading view styles")).setHeading();

    const rv = this.plugin.settings.readingView ?? clonePlain(DEFAULT_SETTINGS.readingView);
    if (!this.plugin.settings.readingView) {
      (this.plugin.settings as Record<string, unknown>).readingView = rv;
    }

    const normaliseMacro = (raw: unknown): "flashcards" | "classic" | "markdown" | "custom" => {
      const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (key === "minimal-flip") return "flashcards";
      if (key === "full-card") return "classic";
      if (key === "compact") return "markdown";
      if (key === "guidebook") return "classic";
      if (key === "flashcards" || key === "classic" || key === "markdown" || key === "custom") return key;
      return "flashcards";
    };

    const isMacroComingSoon = (key: "flashcards" | "classic" | "markdown" | "custom"): boolean => key === "classic" || key === "custom" || key === "markdown";

    rv.activeMacro = normaliseMacro(rv.activeMacro ?? rv.preset);
    if (isMacroComingSoon(rv.activeMacro)) rv.activeMacro = "flashcards";
    rv.preset = rv.activeMacro;
    rv.macroConfigs ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs);
    rv.macroConfigs.flashcards ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.flashcards);
    rv.macroConfigs.classic ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.classic);
    rv.macroConfigs.guidebook ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.guidebook);
    rv.macroConfigs.markdown ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.markdown);
    rv.macroConfigs.custom ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.custom);

    const normaliseFields = (
      fields: Partial<typeof DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields> | undefined,
      fallback: typeof DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields,
    ) => ({
      title: fields?.title ?? fallback.title,
      question: fields?.question ?? fallback.question,
      options: fields?.options ?? fallback.options,
      answer: fields?.answer ?? fallback.answer,
      info: fields?.info ?? fallback.info,
      groups: fields?.groups ?? fallback.groups,
      edit: fields?.edit ?? fallback.edit,
      labels: fields?.labels ?? fallback.labels,
      displayAudioButton: fields?.displayAudioButton ?? fallback.displayAudioButton,
      displayEditButton: fields?.displayEditButton ?? fallback.displayEditButton,
    });

    rv.macroConfigs.flashcards.fields = normaliseFields(
      rv.macroConfigs.flashcards.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.flashcards.fields,
    );
    rv.macroConfigs.classic.fields = normaliseFields(
      rv.macroConfigs.classic.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields,
    );
    rv.macroConfigs.guidebook.fields = normaliseFields(
      rv.macroConfigs.guidebook.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.fields,
    );
    rv.macroConfigs.markdown.fields = normaliseFields(
      rv.macroConfigs.markdown.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.markdown.fields,
    );
    rv.macroConfigs.markdown.fields.edit = false;
    rv.macroConfigs.markdown.fields.displayEditButton = false;
    rv.macroConfigs.custom.fields = normaliseFields(
      rv.macroConfigs.custom.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.custom.fields,
    );

    const normaliseColours = (
      colours: Partial<typeof DEFAULT_SETTINGS.readingView.macroConfigs.classic.colours> | undefined,
      fallback: typeof DEFAULT_SETTINGS.readingView.macroConfigs.classic.colours,
    ) => ({
      autoDarkAdjust: colours?.autoDarkAdjust ?? fallback.autoDarkAdjust,
      cardBgLight: colours?.cardBgLight ?? fallback.cardBgLight,
      cardBgDark: colours?.cardBgDark ?? fallback.cardBgDark,
      cardBorderLight: colours?.cardBorderLight ?? fallback.cardBorderLight,
      cardBorderDark: colours?.cardBorderDark ?? fallback.cardBorderDark,
      cardAccentLight: colours?.cardAccentLight ?? fallback.cardAccentLight,
      cardAccentDark: colours?.cardAccentDark ?? fallback.cardAccentDark,
      cardTextLight: colours?.cardTextLight ?? fallback.cardTextLight,
      cardTextDark: colours?.cardTextDark ?? fallback.cardTextDark,
      cardMutedLight: colours?.cardMutedLight ?? fallback.cardMutedLight,
      cardMutedDark: colours?.cardMutedDark ?? fallback.cardMutedDark,
      clozeBgLight: colours?.clozeBgLight ?? fallback.clozeBgLight,
      clozeTextLight: colours?.clozeTextLight ?? fallback.clozeTextLight,
      clozeBgDark: colours?.clozeBgDark ?? fallback.clozeBgDark,
      clozeTextDark: colours?.clozeTextDark ?? fallback.clozeTextDark,
    });

    rv.macroConfigs.flashcards.colours = normaliseColours(
      rv.macroConfigs.flashcards.colours,
      DEFAULT_SETTINGS.readingView.macroConfigs.flashcards.colours,
    );

    rv.macroConfigs.classic.colours = normaliseColours(
      rv.macroConfigs.classic.colours,
      DEFAULT_SETTINGS.readingView.macroConfigs.classic.colours,
    );
    rv.macroConfigs.guidebook.colours = normaliseColours(
      rv.macroConfigs.guidebook.colours,
      DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.colours,
    );
    rv.macroConfigs.markdown.colours = normaliseColours(
      rv.macroConfigs.markdown.colours,
      DEFAULT_SETTINGS.readingView.macroConfigs.markdown.colours,
    );
    rv.macroConfigs.custom.colours = normaliseColours(
      rv.macroConfigs.custom.colours,
      DEFAULT_SETTINGS.readingView.macroConfigs.custom.colours,
    );
    rv.macroConfigs.custom.customCss ??= DEFAULT_SETTINGS.readingView.macroConfigs.custom.customCss;

    this.plugin.settings.general.enableReadingStyles ??= this.plugin.settings.general.prettifyCards !== "off";

    const syncStyles = () => {
      try { syncReadingViewStyles(); } catch (e) { log.swallow("syncReadingViewStyles", e); }
    };

    let rerenderLivePreview: (() => void) | null = null;

    const refreshReadingViews = () => {
      syncStyles();
      this.plugin.refreshReadingViewMarkdownLeaves();
    };

    const fullRerenderRV = () => {
      syncStyles();
      this.plugin.refreshReadingViewMarkdownLeaves();
    };

    const syncLegacyMirror = () => {
      const cfg = rv.macroConfigs[rv.activeMacro];
      rv.visibleFields = {
        title: cfg.fields.title,
        question: cfg.fields.question,
        options: cfg.fields.options,
        answer: cfg.fields.answer,
        info: cfg.fields.info,
        groups: cfg.fields.groups,
        edit: cfg.fields.edit,
      };
      rv.displayLabels = cfg.fields.labels;
      const presetKey = rv.activeMacro === "guidebook" ? "classic" : rv.activeMacro;
      const p = SproutSettingsTab.PREVIEW_MACRO_PRESETS[presetKey];
      rv.layout = p.layout;
      rv.cardMode = p.cardMode;
      rv.preset = presetKey;
      if ("colours" in cfg && cfg.colours) {
        rv.cardBgLight = cfg.colours.cardBgLight || "";
        rv.cardBgDark = cfg.colours.cardBgDark || "";
        rv.cardBorderLight = cfg.colours.cardBorderLight || "";
        rv.cardBorderDark = cfg.colours.cardBorderDark || "";
        rv.cardAccentLight = cfg.colours.cardAccentLight || "";
        rv.cardAccentDark = cfg.colours.cardAccentDark || "";
      } else {
        rv.cardBgLight = "";
        rv.cardBgDark = "";
        rv.cardBorderLight = "";
        rv.cardBorderDark = "";
        rv.cardAccentLight = "";
        rv.cardAccentDark = "";
      }
    };

    const applyPreset = async (key: "flashcards" | "classic" | "markdown" | "custom") => {
      const p = SproutSettingsTab.PREVIEW_MACRO_PRESETS[key];
      const presetLabel = this._tx(p.labelKey, key);
      if (isMacroComingSoon(key)) {
        new Notice(this._tx("ui.settings.reading.presets.comingSoon", "{label} is coming in a future release.", { label: presetLabel }));
        return;
      }
      rv.activeMacro = key;
      rv.preset = key;
      rv.layout = p.layout;
      rv.cardMode = p.cardMode;
      rv.macroConfigs[key].fields = {
        title: p.visibleFields.title,
        question: p.visibleFields.question,
        options: p.visibleFields.options,
        answer: p.visibleFields.answer,
        info: p.visibleFields.info,
        groups: p.visibleFields.groups,
        edit: p.visibleFields.edit,
        labels: p.displayLabels,
        displayAudioButton: p.visibleFields.displayAudioButton,
        displayEditButton: p.visibleFields.displayEditButton,
      };
      syncLegacyMirror();
      await this.plugin.saveAll();
      fullRerenderRV();
      rerenderLivePreview?.();
      this.queueSettingsNotice("readingView.activeMacro", this._noticeLines.readingMacro(presetLabel));
      this._softRerender();
    };

    new Setting(wrapper)
      .setName(this._tx("ui.settings.reading.enableCardStyling.name", "Enable card styling"))
      .setDesc(this._tx("ui.settings.reading.enableCardStyling.desc", "Turn off to use native reading view styling."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.general.enableReadingStyles);
        t.onChange(async (enabled) => {
          this.plugin.settings.general.enableReadingStyles = !!enabled;
          this.plugin.settings.general.prettifyCards = enabled ? "accent" : "off";
          if (enabled && !rv.activeMacro) rv.activeMacro = "flashcards";
          syncLegacyMirror();
          await this.plugin.saveAll();
          fullRerenderRV();
          rerenderLivePreview?.();
          this._softRerender();
          this.queueSettingsNotice("general.enableReadingStyles", this._noticeLines.cardStyling(enabled));
        });
      });

    const readingSettingsStartIndex = wrapper.children.length;
    const isReadingStylesEnabled = !!this.plugin.settings.general.enableReadingStyles;

    new Setting(wrapper).setName(this._tx("ui.settings.sections.macroStyles", "Macro styles")).setHeading();

    const presetGridRV = wrapper.createDiv({ cls: "sprout-rv-preset-grid" });
    const rvPresets = SproutSettingsTab.PREVIEW_MACRO_PRESETS;
    const presetOrder: Array<"flashcards" | "markdown" | "classic" | "custom"> = ["flashcards", "markdown", "classic", "custom"];
    for (const key of presetOrder) {
      const p = rvPresets[key];
      const isComingSoon = isMacroComingSoon(key);
      const presetLabel = this._tx(p.labelKey, key);
      const presetDesc = this._tx(p.descKey, "");
      const card = presetGridRV.createDiv({
        cls: `sprout-rv-preset-card${rv.activeMacro === key ? " is-active" : ""}${isComingSoon ? " is-disabled" : ""}`,
      });
      if (isComingSoon) card.setAttribute("aria-disabled", "true");
      card.createDiv({ cls: "sprout-rv-preset-label", text: presetLabel });
      card.createDiv({
        cls: "sprout-rv-preset-desc",
        text: isComingSoon
          ? this._tx("ui.settings.reading.presets.comingSoonDesc", "{desc} Coming in a future release.", { desc: presetDesc })
          : presetDesc,
      });
      card.addEventListener("click", () => {
        if (isComingSoon) {
          new Notice(this._tx("ui.settings.reading.presets.comingSoon", "{label} is coming in a future release.", { label: presetLabel }));
          return;
        }
        void applyPreset(key);
      });
    }

    const activeCfg = rv.macroConfigs[rv.activeMacro];
    const previewWrap = wrapper.createDiv({ cls: "sprout-rv-live-preview" });
    previewWrap.createDiv({
      cls: "sprout-rv-live-preview-title",
      text: this._tx("ui.settings.reading.livePreview.title", "Live preview"),
    });
    previewWrap.createDiv({
      cls: "sprout-rv-live-preview-note",
      text: this._tx(
        "ui.settings.reading.livePreview.note",
        "These 3 demo types (Basic, Cloze, MCQ) use the same renderer as reading view and update live as you change options below.",
      ),
    });

    const previewGrid = previewWrap.createDiv({ cls: "sprout-rv-live-preview-grid" });
    const previewCards: Array<{ label: string; card: SproutCard }> = [
      {
        label: this._tx("ui.settings.reading.livePreview.cardType.basic", "Basic"),
        card: {
          anchorId: "910001",
          type: "basic",
          title: "General Knowledge",
          fields: {
            T: "General Knowledge",
            Q: "What is the capital city of Canada?",
            A: "Ottawa",
            I: "Toronto is the largest city, but Ottawa is the capital.",
            G: ["Pub Quiz/Geography"],
          },
        },
      },
      {
        label: this._tx("ui.settings.reading.livePreview.cardType.cloze", "Cloze"),
        card: {
          anchorId: "910003",
          type: "cloze",
          title: "Science",
          fields: {
            T: "Science",
            CQ: "The chemical symbol for gold is {{c1::Au}}.",
            I: "\"Au\" comes from the Latin word aurum.",
            G: ["Pub Quiz/Science"],
          },
        },
      },
      {
        label: this._tx("ui.settings.reading.livePreview.cardType.mcq", "MCQ"),
        card: {
          anchorId: "910004",
          type: "mcq",
          title: "History",
          fields: {
            T: "History",
            MCQ: "Which year did the first human land on the Moon?",
            O: ["1965", "1969", "1972", "1975"],
            A: "1969",
            I: "Apollo 11 landed on the Moon in July 1969.",
            G: ["Pub Quiz/History"],
          },
        },
      },
    ];

    const renderLivePreviewCards = () => {
      previewGrid.replaceChildren();
      for (const sample of previewCards) {
        const item = previewGrid.createDiv({ cls: "sprout-rv-live-preview-item" });
        item.createDiv({ cls: "sprout-rv-live-preview-cardtype", text: sample.label });
        const demoCard = item.createDiv({ cls: "sprout-rv-demo-card" });
        renderReadingViewPreviewCard(demoCard, sample.card);
      }
    };

    rerenderLivePreview = () => {
      syncStyles();
      renderLivePreviewCards();
    };

    renderLivePreviewCards();

    if ((rv.activeMacro as string) === "custom") {
      new Setting(wrapper).setName(this._tx("ui.settings.sections.customStyleCss", "Custom style CSS")).setHeading();
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: this._tx(
          "ui.settings.reading.customCss.description",
          "Write CSS scoped to .sprout-pretty-card.sprout-macro-custom using the hooks below.",
        ),
      });

      const hooks = item.createDiv({ cls: "sprout-rv-custom-hooks" });
      hooks.createDiv({
        cls: "sprout-rv-custom-hooks-title",
        text: this._tx("ui.settings.reading.customCss.availableHooks", "Available hooks"),
      });
      hooks.createEl("code", {
        cls: "sprout-rv-custom-hooks-code",
        text: ".sprout-custom-root .sprout-custom-header .sprout-custom-title .sprout-custom-body .sprout-custom-section .sprout-custom-section-question .sprout-custom-section-options .sprout-custom-section-answer .sprout-custom-section-info .sprout-custom-section-groups .sprout-custom-label .sprout-custom-content .sprout-custom-groups",
      });

      const control = item.createDiv({ cls: "setting-item-control sprout-rv-custom-css-control" });
      const textarea = control.createEl("textarea", {
        cls: "sprout-rv-custom-css-input",
        attr: {
          rows: "12",
          spellcheck: "false",
        },
      });
      textarea.placeholder = ".sprout-pretty-card.sprout-macro-custom .sprout-custom-body {\n  border: 1px solid var(--background-modifier-border);\n}";
      textarea.value = rv.macroConfigs.custom.customCss ?? "";

      const buttonRow = control.createDiv({ cls: "sprout-rv-custom-css-buttons" });
      const insertStarter = buttonRow.createEl("button", {
        text: this._tx("ui.settings.reading.customCss.insertClassicStarter", "Insert classic starter"),
      });
      const clearCss = buttonRow.createEl("button", {
        text: this._tx("ui.settings.reading.customCss.clearCss", "Clear CSS"),
      });

      const scheduleCustomCssSave = () => {
        if (this._readingCustomCssSaveTimer != null) window.clearTimeout(this._readingCustomCssSaveTimer);
        this._readingCustomCssSaveTimer = window.setTimeout(() => {
          this._readingCustomCssSaveTimer = null;
          void this.plugin.saveAll();
        }, 300);
      };

      textarea.addEventListener("input", () => {
        rv.macroConfigs.custom.customCss = textarea.value;
        syncStyles();
        rerenderLivePreview?.();
        scheduleCustomCssSave();
      });

      insertStarter.addEventListener("click", () => {
        rv.macroConfigs.custom.customCss = SproutSettingsTab.CUSTOM_CLASSIC_STARTER_CSS;
        textarea.value = SproutSettingsTab.CUSTOM_CLASSIC_STARTER_CSS;
        syncStyles();
        rerenderLivePreview?.();
        scheduleCustomCssSave();
      });

      clearCss.addEventListener("click", () => {
        rv.macroConfigs.custom.customCss = "";
        textarea.value = "";
        syncStyles();
        rerenderLivePreview?.();
        scheduleCustomCssSave();
      });
    }

    new Setting(wrapper).setName(this._tx("ui.settings.sections.readingViewFields", "Reading view fields")).setHeading();
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: rv.activeMacro === "flashcards"
          ? this._tx("ui.settings.reading.fields.flashcardsLocked", "Not editable for Flashcards. Layout is fixed to Question + Answer.")
          : this._tx("ui.settings.reading.fields.description", "Choose which fields appear for the selected macro style."),
      });
    }

    const toHex = (value: string): string => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (/^#([0-9a-fA-F]{3})$/.test(raw)) {
        const m = raw.slice(1);
        return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`.toLowerCase();
      }
      if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw.toLowerCase();
      const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*[ ,]\s*(\d{1,3})\s*[ ,]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+)?\s*\)$/i);
      if (!rgb) return "";
      const r = Math.max(0, Math.min(255, Number(rgb[1])));
      const g = Math.max(0, Math.min(255, Number(rgb[2])));
      const b = Math.max(0, Math.min(255, Number(rgb[3])));
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    };

    const resolveThemeHex = (cssVarName: string, mode: "light" | "dark", fallback: string): string => {
      const body = document.body;
      const hadLight = body.classList.contains("theme-light");
      const hadDark = body.classList.contains("theme-dark");

      if (mode === "light") {
        body.classList.add("theme-light");
        body.classList.remove("theme-dark");
      } else {
        body.classList.add("theme-dark");
        body.classList.remove("theme-light");
      }

      const computed = getComputedStyle(body).getPropertyValue(cssVarName).trim();

      body.classList.toggle("theme-light", hadLight);
      body.classList.toggle("theme-dark", hadDark);

      return toHex(computed) || fallback;
    };

    if (rv.activeMacro !== "flashcards") {
      const includeFields: Array<{ key: keyof typeof activeCfg.fields; label: string }> = [
        { key: "title", label: this._tx("ui.settings.reading.fields.title", "Title") },
        { key: "question", label: this._tx("ui.settings.reading.fields.question", "Question") },
        { key: "options", label: this._tx("ui.settings.reading.fields.options", "Options") },
        { key: "answer", label: this._tx("ui.settings.reading.fields.answer", "Answer") },
        { key: "info", label: this._tx("ui.settings.reading.fields.extraInfo", "Extra information") },
        { key: "groups", label: this._tx("ui.settings.reading.fields.groups", "Groups") },
      ];

      if (rv.activeMacro !== "markdown") {
        includeFields.push({ key: "labels", label: this._tx("ui.settings.reading.fields.displayLabels", "Display labels") });
      }

      for (const f of includeFields) {
        new Setting(wrapper)
          .setName(f.label)
          .addToggle((t) => {
            t.setValue(!!activeCfg.fields[f.key]);
            t.onChange(async (v) => {
              activeCfg.fields[f.key] = v;
              syncLegacyMirror();
              await this.plugin.saveAll();
              refreshReadingViews();
              rerenderLivePreview?.();
            });
          });
      }
    }

    if (rv.activeMacro === "flashcards") {
      const flashcardButtons: Array<{ key: "displayAudioButton" | "displayEditButton"; label: string }> = [
        { key: "displayAudioButton", label: this._tx("ui.settings.reading.fields.audioButton", "Audio button") },
        { key: "displayEditButton", label: this._tx("ui.settings.reading.fields.editButton", "Edit button") },
      ];

      for (const btn of flashcardButtons) {
        new Setting(wrapper)
          .setName(btn.label)
          .addToggle((t) => {
            t.setValue(activeCfg.fields[btn.key] !== false);
            t.onChange(async (v) => {
              activeCfg.fields[btn.key] = v;
              syncLegacyMirror();
              await this.plugin.saveAll();
              refreshReadingViews();
              rerenderLivePreview?.();
            });
          });
      }
    }

    new Setting(wrapper).setName(this._tx("ui.settings.sections.readingViewColours", "Reading view colours")).setHeading();
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: rv.activeMacro === "flashcards"
          ? this._tx("ui.settings.reading.colours.flashcardsDescription", "Customize Flashcards colors for Reading view.")
          : rv.activeMacro === "markdown"
            ? this._tx("ui.settings.reading.colours.markdownDescription", "Customize Clean markdown cloze colors for light and dark themes.")
            : this._tx("ui.settings.reading.colours.unsupportedDescription", "Switch to Flashcards or Clean markdown to customize colors."),
      });
    }

    const activeColours = rv.activeMacro === "flashcards" ? rv.macroConfigs.flashcards.colours : null;
    const activeMarkdownColours = rv.activeMacro === "markdown" ? rv.macroConfigs.markdown.colours : null;
    const rvColourRow = (
      label: string,
      desc: string,
      getValue: () => string,
      getDefault: string,
      setValue: (v: string) => void,
      container: HTMLElement = wrapper,
    ) => {
      const setting = new Setting(container).setName(label).setDesc(desc);

      const restoreEl = setting.controlEl.createDiv({
        cls: "clickable-icon extra-setting-button sprout-colour-restore",
      });
      restoreEl.setAttribute("aria-label", this._tx("ui.settings.reading.colours.restoreDefaultTooltip", "Restore default"));
      restoreEl.setAttribute("data-tooltip-position", "top");
      restoreEl.setAttribute("aria-disabled", getValue() ? "false" : "true");
      setIcon(restoreEl, "rotate-ccw");
      restoreEl.addEventListener("click", () => {
        void (async () => {
          if (restoreEl.getAttribute("aria-disabled") === "true") return;
          setValue("");
          syncLegacyMirror();
          await this.plugin.saveAll();
          syncStyles();
          rerenderLivePreview?.();
          restoreEl.setAttribute("aria-disabled", "true");
          const picker = setting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
          if (picker) picker.value = getDefault;
        })();
      });

      setting.controlEl.createEl("input", {
        type: "color",
        value: getValue() || getDefault,
        cls: "sprout-colour-picker",
      }, (inp) => {
        inp.addEventListener("input", () => {
          setValue(inp.value);
          syncLegacyMirror();
          void this.plugin.saveAll().then(() => {
            syncStyles();
            rerenderLivePreview?.();
          });
          restoreEl.setAttribute("aria-disabled", "false");
        });
      });
    };

    if (activeColours) {
      const flashcardsAutoDark = activeColours.autoDarkAdjust !== false;
      const lightSuffix = flashcardsAutoDark ? "" : " (light)";

      rvColourRow(
        this._tx("ui.settings.reading.colours.label.background", "Background colour{suffix}", { suffix: lightSuffix }),
        flashcardsAutoDark
          ? this._tx("ui.settings.reading.colours.desc.sourceBackground", "Source background color. Dark mode is generated from this.")
          : this._tx("ui.settings.reading.colours.desc.flashcardBackgroundLight", "Flashcard background in light mode."),
        () => activeColours.cardBgLight,
        resolveThemeHex("--color-base-05", "light", "#f8f8f8"),
        (v) => { activeColours.cardBgLight = v; },
      );

      rvColourRow(
        this._tx("ui.settings.reading.colours.label.text", "Text colour{suffix}", { suffix: lightSuffix }),
        flashcardsAutoDark
          ? this._tx("ui.settings.reading.colours.desc.sourceText", "Source text color. Dark mode is generated from this.")
          : this._tx("ui.settings.reading.colours.desc.flashcardTextLight", "Primary flashcard text in light mode."),
        () => activeColours.cardTextLight,
        resolveThemeHex("--text-colour", "light", resolveThemeHex("--text-normal", "light", "#1f2937")),
        (v) => { activeColours.cardTextLight = v; },
      );

      rvColourRow(
        this._tx("ui.settings.reading.colours.label.clozeBackground", "Cloze background{suffix}", { suffix: lightSuffix }),
        flashcardsAutoDark
          ? this._tx("ui.settings.reading.colours.desc.sourceClozeBackground", "Source cloze background. Dark mode is generated from this.")
          : this._tx("ui.settings.reading.colours.desc.clozeBackgroundLight", "Revealed cloze background in light mode."),
        () => activeColours.clozeBgLight,
        resolveThemeHex("--interactive-accent", "light", "#7c3aed"),
        (v) => { activeColours.clozeBgLight = v; },
      );

      rvColourRow(
        this._tx("ui.settings.reading.colours.label.clozeText", "Cloze text{suffix}", { suffix: lightSuffix }),
        flashcardsAutoDark
          ? this._tx("ui.settings.reading.colours.desc.sourceClozeText", "Source cloze text color. Dark mode is generated from this.")
          : this._tx("ui.settings.reading.colours.desc.clozeTextLight", "Revealed cloze text in light mode."),
        () => activeColours.clozeTextLight,
        "#ffffff",
        (v) => { activeColours.clozeTextLight = v; },
      );

      new Setting(wrapper)
        .setName(this._tx("ui.settings.reading.flashcards.autoDark.name", "Create corresponding dark theme"))
        .setDesc(this._tx("ui.settings.reading.flashcards.autoDark.desc", "Auto-generate dark colors from light colors."))
        .addToggle((t) => {
          t.setValue(flashcardsAutoDark);
          t.onChange(async (enabled) => {
            activeColours.autoDarkAdjust = enabled;
            syncLegacyMirror();
            await this.plugin.saveAll();
            syncStyles();
            rerenderLivePreview?.();
            this.plugin.refreshReadingViewMarkdownLeaves();
          });
        });

      if (!flashcardsAutoDark) {
        rvColourRow(
          this._tx("ui.settings.reading.colours.label.backgroundDark", "Background colour (dark)"),
          this._tx("ui.settings.reading.colours.desc.flashcardBackgroundDark", "Flashcard background in dark mode."),
          () => activeColours.cardBgDark,
          resolveThemeHex("--color-base-05", "dark", "#1f2937"),
          (v) => { activeColours.cardBgDark = v; },
        );

        rvColourRow(
          this._tx("ui.settings.reading.colours.label.textDark", "Text colour (dark)"),
          this._tx("ui.settings.reading.colours.desc.flashcardTextDark", "Primary flashcard text in dark mode."),
          () => activeColours.cardTextDark,
          resolveThemeHex("--text-colour", "dark", resolveThemeHex("--text-normal", "dark", "#e5e7eb")),
          (v) => { activeColours.cardTextDark = v; },
        );

        rvColourRow(
          this._tx("ui.settings.reading.colours.label.clozeBackgroundDark", "Cloze background (dark)"),
          this._tx("ui.settings.reading.colours.desc.clozeBackgroundDark", "Revealed cloze background in dark mode."),
          () => activeColours.clozeBgDark,
          resolveThemeHex("--interactive-accent", "dark", "#7c3aed"),
          (v) => { activeColours.clozeBgDark = v; },
        );

        rvColourRow(
          this._tx("ui.settings.reading.colours.label.clozeTextDark", "Cloze text (dark)"),
          this._tx("ui.settings.reading.colours.desc.clozeTextDark", "Revealed cloze text in dark mode."),
          () => activeColours.clozeTextDark,
          "#ebebeb",
          (v) => { activeColours.clozeTextDark = v; },
        );
      }
    }

    if (activeMarkdownColours) {
      rvColourRow(
        this._tx("ui.settings.reading.colours.label.markdownClozeBackgroundLight", "Cloze background (light)"),
        this._tx("ui.settings.reading.colours.desc.markdownClozeBackgroundLight", "Background colour for revealed cloze spans in light theme."),
        () => activeMarkdownColours.clozeBgLight,
        "#7c3aed",
        (v) => { activeMarkdownColours.clozeBgLight = v; },
      );

      rvColourRow(
        this._tx("ui.settings.reading.colours.label.markdownClozeTextLight", "Cloze text (light)"),
        this._tx("ui.settings.reading.colours.desc.markdownClozeTextLight", "Text colour for revealed cloze spans in light theme."),
        () => activeMarkdownColours.clozeTextLight,
        resolveThemeHex("--text-colour", "light", resolveThemeHex("--text-normal", "light", "#1f2937")),
        (v) => { activeMarkdownColours.clozeTextLight = v; },
      );

      const markdownDarkRowsContainer = wrapper.createDiv();

      const renderMarkdownDarkRows = () => {
        markdownDarkRowsContainer.replaceChildren();
        if (activeMarkdownColours.autoDarkAdjust !== false) return;

        rvColourRow(
          this._tx("ui.settings.reading.colours.label.markdownClozeBackgroundDark", "Cloze background (dark)"),
          this._tx("ui.settings.reading.colours.desc.markdownClozeBackgroundDark", "Background colour for revealed cloze spans in dark theme."),
          () => activeMarkdownColours.clozeBgDark,
          "#3f2a72",
          (v) => { activeMarkdownColours.clozeBgDark = v; },
          markdownDarkRowsContainer,
        );

        rvColourRow(
          this._tx("ui.settings.reading.colours.label.markdownClozeTextDark", "Cloze text (dark)"),
          this._tx("ui.settings.reading.colours.desc.markdownClozeTextDark", "Text colour for revealed cloze spans in dark theme."),
          () => activeMarkdownColours.clozeTextDark,
          resolveThemeHex("--text-colour", "dark", resolveThemeHex("--text-normal", "dark", "#e5e7eb")),
          (v) => { activeMarkdownColours.clozeTextDark = v; },
          markdownDarkRowsContainer,
        );
      };

      new Setting(wrapper)
        .setName(this._tx("ui.settings.reading.markdown.autoDark.name", "Link dark-mode colours to light"))
        .setDesc(this._tx("ui.settings.reading.markdown.autoDark.desc", "Auto-generate dark cloze colors from light-theme colors."))
        .addToggle((t) => {
          t.setValue(activeMarkdownColours.autoDarkAdjust !== false);
          t.onChange(async (enabled) => {
            activeMarkdownColours.autoDarkAdjust = enabled;
            if (enabled) {
              activeMarkdownColours.clozeBgDark = "";
              activeMarkdownColours.clozeTextDark = "";
            }
            syncLegacyMirror();
            await this.plugin.saveAll();
            syncStyles();
            rerenderLivePreview?.();
            renderMarkdownDarkRows();
          });
        });

      renderMarkdownDarkRows();
    }

    syncLegacyMirror();

    if (!isReadingStylesEnabled) {
      const allChildren = Array.from(wrapper.children);
      for (let i = readingSettingsStartIndex; i < allChildren.length; i++) {
        const child = allChildren[i] as HTMLElement;
        if (child) setCssProps(child, "display", "none");
      }
    }
  }

  private renderStudySection(wrapper: HTMLElement): void {
    new Setting(wrapper).setName(this._tx("ui.settings.sections.studySessions", "Study sessions")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.dailyNewLimit.name", "Daily new limit"))
      .setDesc(this._tx("ui.settings.study.dailyNewLimit.desc", "Maximum new cards per day (per deck). Set 0 to disable new cards."))
      .addText((t) =>
        t.setValue(String(this.plugin.settings.study.dailyNewLimit)).onChange(async (v) => {
          const prev = this.plugin.settings.study.dailyNewLimit;
          const next = toNonNegInt(v, 20);
          this.plugin.settings.study.dailyNewLimit = next;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== next) {
            this.queueSettingsNotice("study.dailyNewLimit", this._noticeLines.dailyNewLimit(next));
          }
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.dailyReviewLimit.name", "Daily review limit"))
      .setDesc(this._tx("ui.settings.study.dailyReviewLimit.desc", "Maximum due cards per day (per deck). Set 0 to disable reviews."))
      .addText((t) =>
        t.setValue(String(this.plugin.settings.study.dailyReviewLimit)).onChange(async (v) => {
          const prev = this.plugin.settings.study.dailyReviewLimit;
          const next = toNonNegInt(v, 200);
          this.plugin.settings.study.dailyReviewLimit = next;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== next) {
            this.queueSettingsNotice("study.dailyReviewLimit", this._noticeLines.dailyReviewLimit(next));
          }
        }),
      );

    let autoAdvanceSecondsSetting: Setting | null = null;

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.autoAdvance.name", "Auto-advance"))
      .setDesc(this._tx("ui.settings.study.autoAdvance.desc", "Automatically marks unanswered cards as failed and advances after the timer."))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.study.autoAdvanceEnabled).onChange(async (v) => {
          const prev = this.plugin.settings.study.autoAdvanceEnabled;
          this.plugin.settings.study.autoAdvanceEnabled = v;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          autoAdvanceSecondsSetting?.setDisabled(!v);

          if (prev !== v) {
            this.queueSettingsNotice("study.autoAdvanceEnabled", this._noticeLines.autoAdvanceEnabled(v));
          }
        }),
      );

    autoAdvanceSecondsSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.autoAdvanceAfter.name", "Auto-advance after"))
      .setDesc(this._tx("ui.settings.study.autoAdvanceAfter.desc", "Delay in seconds (applies to reviewer and widget)."))
      .addSlider((s) =>
        s
          .setLimits(3, 60, 1)
          .setValue(Number(this.plugin.settings.study.autoAdvanceSeconds) || 10)
          .setDynamicTooltip()
          .onChange(async (v) => {
            const prev = this.plugin.settings.study.autoAdvanceSeconds;
            const next = Number(v) || 10;
            this.plugin.settings.study.autoAdvanceSeconds = next;
            await this.plugin.saveAll();
            this.refreshReviewerViewsIfPossible();

            if (prev !== next) {
              this.queueSettingsNotice("study.autoAdvanceSeconds", this._noticeLines.autoAdvanceSeconds(next));
            }
          }),
      );

    autoAdvanceSecondsSetting.setDisabled(!this.plugin.settings.study.autoAdvanceEnabled);

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gradingButtons.name", "Grading buttons"))
      .setDesc(this._tx("ui.settings.study.gradingButtons.desc", "Choose your grading layout."))
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            {
              value: "two",
              label: this._tx("ui.settings.study.gradingButtons.option.two", "Two buttons"),
            },
            {
              value: "four",
              label: this._tx("ui.settings.study.gradingButtons.option.four", "Four buttons"),
            },
          ],
          value: this.plugin.settings.study.fourButtonMode ? "four" : "two",
          onChange: (key) => {
            void (async () => {
              const prevFour = !!this.plugin.settings.study.fourButtonMode;
              const nextFour = key === "four";

              this.plugin.settings.study.fourButtonMode = nextFour;

              await this.plugin.saveAll();
              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();

              if (prevFour !== nextFour) {
                this.queueSettingsNotice("study.gradingSystem", this._noticeLines.gradingButtons(nextFour));
              }
            })();
          },
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gradeIntervals.name", "Show grade intervals"))
      .setDesc(this._tx("ui.settings.study.gradeIntervals.desc", "Show next review times under grade buttons in reviewer and widget."))
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.study.showGradeIntervals).onChange(async (v) => {
          const prev = !!this.plugin.settings.study.showGradeIntervals;
          this.plugin.settings.study.showGradeIntervals = v;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();
          this.refreshAllWidgetViews();

          if (prev !== v) {
            this.queueSettingsNotice(
              "study.showGradeIntervals",
              v
                ? "Showing grade intervals under grading buttons."
                : "Hiding grade intervals under grading buttons.",
            );
          }
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.skipButton.name", "Skip button"))
      .setDesc(this._tx("ui.settings.study.skipButton.desc", "Show a skip button (enter). Skipped cards stay in the current session and do not change scheduling."))
      .addToggle((t) => {
        const cur = !!this.plugin.settings.study.enableSkipButton;
        t.setValue(cur);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.study.enableSkipButton;
          this.plugin.settings.study.enableSkipButton = v;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.enableSkipButton", this._noticeLines.skipButton(v));
          }
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.folderNotesAsDecks.name", "Treat folder notes as decks"))
      .setDesc(this._tx("ui.settings.study.folderNotesAsDecks.desc", "A folder note studies cards from notes in that folder and its subfolders."))
      .addToggle((t) => {
        const current = this.plugin.settings.study.treatFolderNotesAsDecks;
        t.setValue(current !== false);
        t.onChange(async (v) => {
          const prev = this.plugin.settings.study.treatFolderNotesAsDecks;
          this.plugin.settings.study.treatFolderNotesAsDecks = v;

          await this.plugin.saveAll();
          this.refreshAllWidgetViews();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.treatFolderNotesAsDecks", this._noticeLines.folderNotes(v));
          }
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.siblingManagement.name", "Sibling card management"))
      .setDesc(this._tx("ui.settings.study.siblingManagement.desc", "Choose how sibling cards are handled."))
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            {
              value: "standard",
              label: this._tx("ui.settings.study.siblingManagement.option.standard", "Standard queueing"),
            },
            {
              value: "disperse",
              label: this._tx("ui.settings.study.siblingManagement.option.disperse", "Disperse siblings"),
            },
            {
              value: "bury",
              label: this._tx("ui.settings.study.siblingManagement.option.bury", "Bury siblings"),
            },
          ],
          separatorAfterIndex: 0,
          value: this.plugin.settings.study.siblingMode ?? "standard",
          onChange: (v) => {
            void (async () => {
              const prev = this.plugin.settings.study.siblingMode ?? "standard";
              const next = v as "standard" | "disperse" | "bury";
              this.plugin.settings.study.siblingMode = next;
              await this.plugin.saveAll();
              this.refreshReviewerViewsIfPossible();

              if (prev !== next) {
                const labels: Record<string, string> = {
                  standard: this._tx("ui.settings.study.siblingManagement.option.standard", "Standard queueing"),
                  disperse: this._tx("ui.settings.study.siblingManagement.option.disperse", "Disperse siblings"),
                  bury: this._tx("ui.settings.study.siblingManagement.option.bury", "Bury siblings"),
                };
                this.queueSettingsNotice("study.siblingMode", this._noticeLines.siblingMode(labels[next]));
              }
            })();
          },
        });
      });

    let startupDelaySetting: Setting | null = null;
    let repeatIntervalSetting: Setting | null = null;
    let gatekeeperFrequencySetting: Setting | null = null;
    let gatekeeperDueQuestionsSetting: Setting | null = null;
    let gatekeeperScopeSetting: Setting | null = null;
    let gatekeeperPauseSetting: Setting | null = null;
    let gatekeeperBypassSetting: Setting | null = null;
    let gatekeeperBypassWarningSetting: Setting | null = null;

    new Setting(wrapper).setName(this._tx("ui.settings.sections.launchReminders", "Launch reminders")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.launchReminders.enabled.name", "Enable reminders on launch"))
      .setDesc(this._tx("ui.settings.study.launchReminders.enabled.desc", "Show one reminder after Obsidian starts."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.reminders.showOnStartup);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.reminders.showOnStartup;
          this.plugin.settings.reminders.showOnStartup = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          startupDelaySetting?.setDisabled(!v);

          if (prev !== v) {
            this.queueSettingsNotice("reminders.showOnStartup", this._noticeLines.remindersLaunch(v));
          }
        });
      });

    startupDelaySetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.launchReminders.delay.name", "Launch delay"))
      .setDesc(this._tx("ui.settings.study.launchReminders.delay.desc", "Delay before launch reminders appear (seconds)."))
      .addText((t) =>
        t
          .setPlaceholder(this._tx("ui.settings.study.launchReminders.delay.placeholder", "1"))
          .setValue(String(Math.round((Number(this.plugin.settings.reminders.startupDelayMs) || 0) / 1000) || 1))
          .onChange(async (v) => {
            const prevSeconds = Math.round((Number(this.plugin.settings.reminders.startupDelayMs) || 0) / 1000) || 1;
            const nextSeconds = clamp(toNonNegInt(v, 1), 0, 600);
            this.plugin.settings.reminders.startupDelayMs = nextSeconds * 1000;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();

            if (prevSeconds !== nextSeconds) {
              this.queueSettingsNotice("reminders.startupDelayMs", this._noticeLines.remindersLaunchDelay(nextSeconds));
            }
          }),
      );

    new Setting(wrapper).setName(this._tx("ui.settings.sections.routineReminders", "Routine reminders")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.routineReminders.enabled.name", "Enable routine reminders"))
      .setDesc(this._tx("ui.settings.study.routineReminders.enabled.desc", "Show recurring reminders while Obsidian is open."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.reminders.repeatEnabled);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.reminders.repeatEnabled;
          this.plugin.settings.reminders.repeatEnabled = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          repeatIntervalSetting?.setDisabled(!v);

          if (prev !== v) {
            this.queueSettingsNotice("reminders.repeatEnabled", this._noticeLines.remindersRoutine(v));
          }
        });
      });

    repeatIntervalSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.routineReminders.frequency.name", "Reminder frequency"))
      .setDesc(this._tx("ui.settings.study.routineReminders.frequency.desc", "Time between routine reminders (minutes)."))
      .addText((t) =>
        t
          .setPlaceholder(this._tx("ui.settings.study.routineReminders.frequency.placeholder", "30"))
          .setValue(String(Math.max(1, Number(this.plugin.settings.reminders.repeatIntervalMinutes) || 30)))
          .onChange(async (v) => {
            const prev = Math.max(1, Number(this.plugin.settings.reminders.repeatIntervalMinutes) || 30);
            const next = clamp(toNonNegInt(v, 30), 1, 1440);
            this.plugin.settings.reminders.repeatIntervalMinutes = next;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();

            if (prev !== next) {
              this.queueSettingsNotice("reminders.repeatIntervalMinutes", this._noticeLines.remindersRoutineFrequency(next));
            }
          }),
      );

    new Setting(wrapper).setName(this._tx("ui.settings.sections.gatekeeperPopups", "Gatekeeper popups")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperPopups.enabled.name", "Enable gatekeeper popups"))
      .setDesc(this._tx("ui.settings.study.gatekeeperPopups.enabled.desc", "Show recurring gatekeeper popups with due questions."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.reminders.gatekeeperEnabled);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.reminders.gatekeeperEnabled;
          this.plugin.settings.reminders.gatekeeperEnabled = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          gatekeeperFrequencySetting?.setDisabled(!v);
          gatekeeperDueQuestionsSetting?.setDisabled(!v);
          gatekeeperScopeSetting?.setDisabled(!v);
          gatekeeperPauseSetting?.setDisabled(!v);
          gatekeeperBypassSetting?.setDisabled(!v);
          gatekeeperBypassWarningSetting?.setDisabled(!v || !this.plugin.settings.reminders.gatekeeperAllowSkip);

          if (prev !== v) {
            this.queueSettingsNotice("reminders.gatekeeperEnabled", this._noticeLines.gatekeeperEnabled(v));
          }
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperPopups.onLaunch.name", "Enable gatekeeper on launch"))
      .setDesc(this._tx("ui.settings.study.gatekeeperPopups.onLaunch.desc", "Show gatekeeper once after Obsidian starts."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.reminders.gatekeeperOnStartup);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.reminders.gatekeeperOnStartup;
          this.plugin.settings.reminders.gatekeeperOnStartup = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          if (prev !== v) {
            this.queueSettingsNotice("reminders.gatekeeperOnStartup", this._noticeLines.gatekeeperOnStartup(v));
          }
        });
      });

    new Setting(wrapper).setName(this._tx("ui.settings.sections.gatekeeperBehaviour", "Gatekeeper behaviour")).setHeading();

    gatekeeperFrequencySetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperBehaviour.frequency.name", "Gatekeeper frequency"))
      .setDesc(this._tx("ui.settings.study.gatekeeperBehaviour.frequency.desc", "Time between gatekeeper popups (minutes)."))
      .addText((t) =>
        t
          .setPlaceholder(this._tx("ui.settings.study.gatekeeperBehaviour.frequency.placeholder", "30"))
          .setValue(String(Math.max(1, Number(this.plugin.settings.reminders.gatekeeperIntervalMinutes) || 30)))
          .onChange(async (v) => {
            const prev = Math.max(1, Number(this.plugin.settings.reminders.gatekeeperIntervalMinutes) || 30);
            const next = clamp(toNonNegInt(v, 30), 1, 1440);
            this.plugin.settings.reminders.gatekeeperIntervalMinutes = next;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();

            if (prev !== next) {
              this.queueSettingsNotice("reminders.gatekeeperIntervalMinutes", this._noticeLines.gatekeeperFrequency(next));
            }
          }),
      );

    gatekeeperDueQuestionsSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperBehaviour.dueQuestions.name", "Number of due questions"))
      .setDesc(
        this._tx(
          "ui.settings.study.gatekeeperBehaviour.dueQuestions.desc",
          "Number of due questions shown in each gatekeeper popup. If fewer due questions are available, all due cards are shown. If none are due, gatekeeper is skipped.",
        ),
      )
      .addText((t) =>
        t
          .setPlaceholder(this._tx("ui.settings.study.gatekeeperBehaviour.dueQuestions.placeholder", "3"))
          .setValue(String(Math.max(1, Number(this.plugin.settings.reminders.gatekeeperDueQuestionCount) || 3)))
          .onChange(async (v) => {
            const prev = Math.max(1, Number(this.plugin.settings.reminders.gatekeeperDueQuestionCount) || 3);
            const next = clamp(toNonNegInt(v, 3), 1, 200);
            this.plugin.settings.reminders.gatekeeperDueQuestionCount = next;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();

            if (prev !== next) {
              this.queueSettingsNotice("reminders.gatekeeperDueQuestionCount", this._noticeLines.gatekeeperDueQuestions(next));
            }
          }),
      );

    gatekeeperScopeSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperBehaviour.scope.name", "Gatekeeper scope"))
      .setDesc(
        this._tx(
          "ui.settings.study.gatekeeperBehaviour.scope.desc",
          "Choose what gatekeeper blocks: the full workspace or only the current tab.",
        ),
      )
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            {
              value: "workspace",
              label: this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.workspace", "Full workspace"),
            },
            {
              value: "current-tab",
              label: this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.currentTab", "Current tab"),
            },
          ],
          value: this.plugin.settings.reminders.gatekeeperScope ?? "workspace",
          onChange: (v) => {
            void (async () => {
              const prev = this.plugin.settings.reminders.gatekeeperScope ?? "workspace";
              const next = v === "current-tab" ? "current-tab" : "workspace";
              this.plugin.settings.reminders.gatekeeperScope = next;
              await this.plugin.saveAll();
              this.plugin.refreshReminderEngine();

              if (prev !== next) {
                const labels: Record<"workspace" | "current-tab", string> = {
                  workspace: this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.workspace", "Full workspace"),
                  "current-tab": this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.currentTab", "Current tab"),
                };
                this.queueSettingsNotice("reminders.gatekeeperScope", this._noticeLines.gatekeeperScope(labels[next]));
              }
            })();
          },
        });
      });

    gatekeeperPauseSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperBehaviour.pauseWhileStudying.name", "Pause gatekeeper while studying"))
      .setDesc(
        this._tx(
          "ui.settings.study.gatekeeperBehaviour.pauseWhileStudying.desc",
          "Pause gatekeeper while you are in sprout study tabs. The countdown resumes when you leave.",
        ),
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.reminders.gatekeeperPauseWhenStudying ?? true);
        t.onChange(async (v) => {
          const prev = this.plugin.settings.reminders.gatekeeperPauseWhenStudying ?? true;
          this.plugin.settings.reminders.gatekeeperPauseWhenStudying = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          if (prev !== v) {
            this.queueSettingsNotice("reminders.gatekeeperPauseWhenStudying", this._noticeLines.gatekeeperPauseWhenStudying(v));
          }
        });
      });

    new Setting(wrapper).setName(this._tx("ui.settings.sections.gatekeeperBypass", "Gatekeeper bypass")).setHeading();

    gatekeeperBypassSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperBypass.enabled.name", "Enable gatekeeper bypass"))
      .setDesc(this._tx("ui.settings.study.gatekeeperBypass.enabled.desc", "Allow closing gatekeeper before all shown questions are completed."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.reminders.gatekeeperAllowSkip);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.reminders.gatekeeperAllowSkip;
          this.plugin.settings.reminders.gatekeeperAllowSkip = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          gatekeeperBypassWarningSetting?.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled || !v);

          if (prev !== v) {
            this.queueSettingsNotice("reminders.gatekeeperAllowSkip", this._noticeLines.gatekeeperBypass(v));
          }
        });
      });

    gatekeeperBypassWarningSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.study.gatekeeperBypass.warning.name", "Enable bypass warning"))
      .setDesc(this._tx("ui.settings.study.gatekeeperBypass.warning.desc", "Show a confirmation before bypassing gatekeeper."))
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.reminders.gatekeeperBypassWarning);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.reminders.gatekeeperBypassWarning;
          this.plugin.settings.reminders.gatekeeperBypassWarning = v;
          await this.plugin.saveAll();
          this.plugin.refreshReminderEngine();

          if (prev !== v) {
            this.queueSettingsNotice("reminders.gatekeeperBypassWarning", this._noticeLines.gatekeeperBypassWarning(v));
          }
        });
      });

    startupDelaySetting.setDisabled(!this.plugin.settings.reminders.showOnStartup);
    repeatIntervalSetting.setDisabled(!this.plugin.settings.reminders.repeatEnabled);
    gatekeeperFrequencySetting.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled);
    gatekeeperDueQuestionsSetting.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled);
    gatekeeperScopeSetting.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled);
    gatekeeperPauseSetting.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled);
    gatekeeperBypassSetting.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled);
    gatekeeperBypassWarningSetting.setDisabled(!this.plugin.settings.reminders.gatekeeperEnabled || !this.plugin.settings.reminders.gatekeeperAllowSkip);
  }

  private renderStudyAssistantSection(wrapper: HTMLElement): void {
    const dependentSettings: Setting[] = [];
    const provider = this.plugin.settings.studyAssistant.provider;
    const getOpenRouterTier = (): "free" | "paid" =>
      this._normaliseOpenRouterTier(this.plugin.settings.studyAssistant.openRouterTier);
    const modelLikelySupportsVision = (rawModel: string): boolean => {
      const model = String(rawModel || "").toLowerCase();
      if (!model) return false;
      return [
        "vision",
        "vl",
        "gpt-4o",
        "gpt-4.1",
        "gpt-5",
        "o1",
        "o3",
        "o4",
        "claude",
        "sonnet",
        "opus",
        "haiku",
        "gemini",
        "pixtral",
        "llava",
      ].some((token) => model.includes(token));
    };

    const staticModelOptions: Record<Exclude<StudyAssistantProvider, "openrouter" | "custom">, StudyAssistantModelOption[]> = {
      openai: [
        { value: "gpt-5", label: "GPT-5" },
        { value: "gpt-5-mini", label: "GPT-5 Mini" },
        { value: "gpt-5-nano", label: "GPT-5 Nano" },
        { value: "gpt-4.1", label: "GPT-4.1" },
        { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      ],
      deepseek: [
        { value: "deepseek-chat", label: "DeepSeek Chat" },
        { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      ],
      anthropic: [
        { value: "claude-opus-4-1", label: "Claude Opus 4.1" },
        { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
        { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
      ],
      xai: [
        { value: "grok-4", label: "Grok 4" },
        { value: "grok-3", label: "Grok 3" },
        { value: "grok-3-mini", label: "Grok 3 Mini" },
      ],
      google: [
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
      ],
      perplexity: [
        { value: "sonar", label: "Sonar" },
        { value: "sonar-pro", label: "Sonar Pro" },
        { value: "sonar-reasoning", label: "Sonar Reasoning" },
        { value: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
      ],
    };
    const getProviderModelOptions = (selectedProvider: StudyAssistantProvider): StudyAssistantModelOption[] => {
      if (selectedProvider === "custom") return [];
      if (selectedProvider === "openrouter") {
        return this._getOpenRouterModelOptions(getOpenRouterTier());
      }
      return staticModelOptions[selectedProvider];
    };

    const withDependentSetting = (setting: Setting): Setting => {
      dependentSettings.push(setting);
      return setting;
    };

    new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.info", "Info")).setHeading();

    const infoItem = wrapper.createDiv({ cls: "setting-item" });
    const infoInfo = infoItem.createDiv({ cls: "setting-item-info" });
    infoInfo.createDiv({
      cls: "setting-item-description",
      text: this._tx(
        "ui.settings.studyAssistant.info.desc",
        "Sprig uses a bring-your-own-API-key (BYOK) model: you provide your own API key, and usage is billed directly by your selected AI provider. Many AI tools work similarly behind the scenes but bundle API costs into their subscription pricing; Sprig presents this model transparently. API keys are kept in your local plugin settings and sent directly to the provider you choose for each request, and Sprout does not share them with a separate Sprout service. AI output can still be incorrect or hallucinated, so verify important answers before relying on them.",
      ),
    });

    new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.enableSprig", "Enable Sprig")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.studyAssistant.enabled.name", "Enable Sprig"))
      .setDesc(this._tx("ui.settings.studyAssistant.enabled.desc", "Turn Sprig on or off. For functionality, an API key is required below."))
      .addToggle((toggle) =>
        toggle.setValue(!!this.plugin.settings.studyAssistant.enabled).onChange(async (value) => {
          this.plugin.settings.studyAssistant.enabled = !!value;
          await this.plugin.saveAll();
          this.queueSettingsNotice(
            "studyAssistant.enabled",
            this._tx("ui.settings.studyAssistant.notice.enabled", "Sprig: {state}", {
              state: value ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
            }),
          );
          this.onRequestRerender?.();
        }),
      );

    new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.provider", "AI Provider")).setHeading();

    const standardProviderOptionsUnsorted = [
      { value: "anthropic", label: "Anthropic" },
      { value: "deepseek", label: "DeepSeek" },
      { value: "google", label: "Google" },
      { value: "xai", label: "xAI" },
      { value: "openrouter", label: "OpenRouter" },
      { value: "openai", label: "OpenAI" },
      { value: "perplexity", label: "Perplexity" },
    ] satisfies Array<{ value: StudyAssistantProvider; label: string }>;

    const standardProviderOptions: Array<{ value: StudyAssistantProvider; label: string }> = [...standardProviderOptionsUnsorted]
      .sort((a, b) => a.label.localeCompare(b.label));

    const providerOptions: Array<{ value: StudyAssistantProvider; label: string }> = [
      ...standardProviderOptions,
      { value: "custom", label: "Custom" },
    ];

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.provider.name", "AI provider"))
        .setDesc(this._tx("ui.settings.studyAssistant.provider.desc", "Choose which AI provider Sprig should use."))
        .then((setting) => {
          this._addSimpleSelect(setting.controlEl, {
            options: providerOptions,
            value: this.plugin.settings.studyAssistant.provider,
            separatorAfterIndex: standardProviderOptions.length - 1,
            onChange: (value) => {
              const next = value === "openai" || value === "deepseek" || value === "anthropic" || value === "xai" || value === "google" || value === "perplexity" || value === "openrouter" || value === "custom"
                ? value
                : "openai";
              const previousProvider = this.plugin.settings.studyAssistant.provider;
              const previousModel = String(this.plugin.settings.studyAssistant.model || "").trim();
              this.plugin.settings.studyAssistant.provider = next;

              if (next !== "custom") {
                const nextProviderModels = getProviderModelOptions(next);
                const nextValues = nextProviderModels.map((m) => m.value);
                if (!previousModel || previousProvider !== next) {
                  this.plugin.settings.studyAssistant.model = nextValues[0] || "";
                }
                if (this.plugin.settings.studyAssistant.model && !nextValues.includes(this.plugin.settings.studyAssistant.model)) {
                  this.plugin.settings.studyAssistant.model = nextValues[0] || this.plugin.settings.studyAssistant.model;
                }
              }

              void this.plugin.saveAll();
              this._softRerender();
            },
          });
        }),
    );

    if (provider === "openrouter") {
      withDependentSetting(
        new Setting(wrapper)
          .setName(this._tx("ui.settings.studyAssistant.openrouter.tier.name", "OpenRouter model access"))
          .setDesc(this._tx("ui.settings.studyAssistant.openrouter.tier.desc", "Choose Free or Paid catalog filtering. Router options remain pinned at the top."))
          .then((setting) => {
            this._addSimpleSelect(setting.controlEl, {
              options: [
                { value: "free", label: "Free" },
                { value: "paid", label: "Paid" },
              ],
              value: getOpenRouterTier(),
              onChange: (value) => {
                this.plugin.settings.studyAssistant.openRouterTier = value === "paid" ? "paid" : "free";
                const available = this._getOpenRouterModelOptions(getOpenRouterTier());
                if (!available.some((model) => model.value === this.plugin.settings.studyAssistant.model)) {
                  this.plugin.settings.studyAssistant.model = available[0]?.value || "";
                }
                void this.plugin.saveAll();
                this._softRerender();
              },
            });
          }),
      );

      if (!this._openRouterModelsCache && !this._openRouterModelsLoading) {
        void this._loadOpenRouterModels();
      }
    }

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.model.name", "Model"))
        .setDesc(this._tx("ui.settings.studyAssistant.model.desc", "Model name used for the selected provider."))
        .then((setting) => {
          if (provider === "custom") {
            setting.controlEl.empty();
            setting.addText((text) => {
              text.setValue(this.plugin.settings.studyAssistant.model || "");
              text.onChange(async (value) => {
                this.plugin.settings.studyAssistant.model = String(value || "").trim();
                await this.plugin.saveAll();
              });
            });
            return;
          }

          const models = getProviderModelOptions(provider);
          const sortedModels = provider === "openrouter"
            ? [...models]
            : [...models].sort((a, b) => a.label.localeCompare(b.label));
          const currentModel = String(this.plugin.settings.studyAssistant.model || "").trim();
          const modelOptions = [...sortedModels];
          if (currentModel && !sortedModels.some((model) => model.value === currentModel)) {
            modelOptions.push({
              value: currentModel,
              label: `${this._formatModelLabel(currentModel)} (custom)`,
            });
            modelOptions.sort((a, b) => a.label.localeCompare(b.label));
          }

          if (provider === "openrouter") {
            if (!modelOptions.length) {
              setting.setDesc(
                this._openRouterModelsLoading
                  ? this._tx("ui.settings.studyAssistant.openrouter.loading", "Loading OpenRouter models. You can still enter a model ID manually.")
                  : this._openRouterModelsError
                    ? this._tx("ui.settings.studyAssistant.openrouter.loadError", "Could not load OpenRouter models right now. Enter a model ID manually.")
                    : this._tx("ui.settings.studyAssistant.openrouter.model.desc", "Select an OpenRouter model. Display names are user-friendly while IDs remain API-correct."),
              );
              setting.controlEl.empty();
              setting.addText((text) => {
                text.setValue(currentModel);
                text.setPlaceholder("OpenRouter model ID (e.g., openai/gpt-4o-mini)");
                text.onChange(async (value) => {
                  this.plugin.settings.studyAssistant.model = String(value || "").trim();
                  await this.plugin.saveAll();
                });
              });
              return;
            }

            const modelAnchor = setting.settingEl;
            this._addSearchablePopover(wrapper, {
              name: this._tx("ui.settings.studyAssistant.model.name", "Model"),
              description: this._tx("ui.settings.studyAssistant.openrouter.model.desc", "Select an OpenRouter model. Display names are user-friendly while IDs remain API-correct."),
              options: modelOptions,
              value: currentModel || modelOptions[0]?.value || "",
              onChange: (value) => {
                this.plugin.settings.studyAssistant.model = String(value || "").trim();
                void this.plugin.saveAll();
              },
            });

            const inserted = wrapper.lastElementChild;
            if (inserted && inserted !== modelAnchor) {
              wrapper.insertBefore(inserted, modelAnchor.nextSibling);
            }
            modelAnchor.remove();
            return;
          }

          this._addSimpleSelect(setting.controlEl, {
            options: modelOptions,
            value: currentModel || modelOptions[0]?.value || "",
            onChange: (value) => {
              this.plugin.settings.studyAssistant.model = String(value || "").trim();
              void this.plugin.saveAll();
            },
          });
        }),
    );

    if (provider === "custom") {
      withDependentSetting(
        new Setting(wrapper)
          .setName(this._tx("ui.settings.studyAssistant.endpointOverride.name", "Endpoint override"))
          .setDesc(this._tx("ui.settings.studyAssistant.endpointOverride.custom.desc", "Required custom base URL for your endpoint."))
          .addText((text) => {
            text.setValue(this.plugin.settings.studyAssistant.endpointOverride || "");
            text.onChange(async (value) => {
              this.plugin.settings.studyAssistant.endpointOverride = String(value || "").trim();
              await this.plugin.saveAll();
            });
          }),
      );
    }

    const providerKeyField: Record<typeof provider, { key: keyof SproutSettings["studyAssistant"]["apiKeys"]; label: string; placeholder: string }> = {
      openai: { key: "openai", label: "OpenAI API key", placeholder: "sk-..." },
      deepseek: { key: "deepseek", label: "DeepSeek API key", placeholder: "sk-..." },
      anthropic: { key: "anthropic", label: "Anthropic API key", placeholder: "sk-ant-..." },
      xai: { key: "xai", label: "xAI API key", placeholder: "xai-..." },
      google: { key: "google", label: "Google API key", placeholder: "AIza..." },
      perplexity: { key: "perplexity", label: "Perplexity API key", placeholder: "pplx-..." },
      openrouter: { key: "openrouter", label: "OpenRouter API key", placeholder: "sk-or-..." },
      custom: { key: "custom", label: "Custom API key", placeholder: "sk-..." },
    };

    const currentKeyField = providerKeyField[provider];
    const currentKeyToken = String(currentKeyField.key);
    const pluginId = this.plugin.manifest?.id || "sprout";
    const apiKeysPath = `.obsidian/plugins/${pluginId}/configuration/api-keys.json`;

    withDependentSetting(
      new Setting(wrapper)
          .setName(this._tx(`ui.settings.studyAssistant.keys.${currentKeyToken}.name`, currentKeyField.label))
        .setDesc(
          this._tx(
              `ui.settings.studyAssistant.keys.${currentKeyToken}.desc`,
            "Stored in {path}. If you use Git, add only this file to .gitignore so other Sprout settings can still sync across devices.",
            { path: apiKeysPath },
          ),
        )
        .addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.setPlaceholder(currentKeyField.placeholder);
          text.setValue(this.plugin.settings.studyAssistant.apiKeys[currentKeyField.key] || "");
          text.onChange(async (value) => {
            this.plugin.settings.studyAssistant.apiKeys[currentKeyField.key] = String(value || "").trim();
            await this.plugin.saveAll();
          });
        }),
    );

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.privacy.saveChatHistory.name", "Save chat history"))
        .setDesc(this._tx("ui.settings.studyAssistant.privacy.saveChatHistory.desc", "Save conversations for each note so they are restored in future chat sessions."))
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.saveChatHistory).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.saveChatHistory = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );

    new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.askMode", "Ask Mode")).setHeading();

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.prompts.assistant.name", "Custom instructions"))
        .setDesc(this._tx("ui.settings.studyAssistant.prompts.assistant.desc", "Custom instructions for Ask mode."))
        .addTextArea((text) => {
          text.inputEl.placeholder = this._tx("ui.settings.studyAssistant.prompts.placeholder", "Enter custom instructions here");
          text.setValue(this.plugin.settings.studyAssistant.prompts.assistant || "");
          text.onChange(async (value) => {
            this.plugin.settings.studyAssistant.prompts.assistant = String(value || "");
            await this.plugin.saveAll();
          });
        }),
    );

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.ask.includeImages.name", "Include images from note in messages"))
        .setDesc(this._tx("ui.settings.studyAssistant.ask.includeImages.desc", "Include embedded note images in Ask mode messages."))
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeImagesInAsk).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeImagesInAsk = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );

    new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.reviewMode", "Review mode")).setHeading();

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.prompts.review.name", "Custom instructions"))
        .setDesc(this._tx("ui.settings.studyAssistant.prompts.review.desc", "Custom instructions for Review mode."))
        .addTextArea((text) => {
          text.inputEl.placeholder = this._tx("ui.settings.studyAssistant.prompts.placeholder", "Enter custom instructions here");
          text.setValue(this.plugin.settings.studyAssistant.prompts.noteReview || "");
          text.onChange(async (value) => {
            this.plugin.settings.studyAssistant.prompts.noteReview = String(value || "");
            await this.plugin.saveAll();
          });
        }),
    );

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.review.includeImages.name", "Include images from note in messages"))
        .setDesc(this._tx("ui.settings.studyAssistant.review.includeImages.desc", "Include embedded note images in Review mode messages."))
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeImagesInReview).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeImagesInReview = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );

    new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.flashcardMode", "Flashcard mode")).setHeading();

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.prompts.generator.name", "Custom instructions"))
        .setDesc(this._tx("ui.settings.studyAssistant.prompts.generator.desc", "Custom instructions for Flashcard mode."))
        .addTextArea((text) => {
          text.inputEl.placeholder = this._tx("ui.settings.studyAssistant.prompts.placeholder", "Enter custom instructions here");
          text.setValue(this.plugin.settings.studyAssistant.prompts.generator || "");
          text.onChange(async (value) => {
            this.plugin.settings.studyAssistant.prompts.generator = String(value || "");
            await this.plugin.saveAll();
          });
        }),
    );

    const flashcardModelIsVisionCapable = modelLikelySupportsVision(this.plugin.settings.studyAssistant.model);
    const flashcardImagesDesc = flashcardModelIsVisionCapable
      ? this._tx("ui.settings.studyAssistant.flashcard.includeImages.desc", "Include embedded note images in Flashcard mode messages.")
      : this._tx(
        "ui.settings.studyAssistant.flashcard.includeImages.notVisionCapable.desc",
        "Selected model is not vision-capable. Choose a vision-capable model to enable image input for Flashcard mode.",
      );

    const flashcardImagesSetting = withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.flashcard.includeImages.name", "Include images from note in messages"))
        .setDesc(flashcardImagesDesc)
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeImagesInFlashcard).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeImagesInFlashcard = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );
    flashcardImagesSetting.setDisabled(!flashcardModelIsVisionCapable);

    withDependentSetting(new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.flashcardGeneration", "Flashcard generation")).setHeading());

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.generatorTargetCount.name", "Approximate number of cards"))
        .setDesc(this._tx("ui.settings.studyAssistant.generatorTargetCount.desc", "Target 1-10 cards. AI may return +/- 1 around this value."))
        .addSlider((s) =>
          s
            .setLimits(1, 10, 1)
            .setValue(Math.max(1, Math.min(10, Math.round(Number(this.plugin.settings.studyAssistant.generatorTargetCount) || 5)))
            )
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.studyAssistant.generatorTargetCount = Math.max(1, Math.min(10, Math.round(Number(value) || 5)));
              await this.plugin.saveAll();
            }),
        ),
    );

    withDependentSetting(new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.generatorTypes", "What flashcard types to generate")).setHeading());

    type StudyAssistantGeneratorTypeKey = keyof SproutSettings["studyAssistant"]["generatorTypes"];
    const cardTypes: Array<{ key: StudyAssistantGeneratorTypeKey; label: string }> = [
      { key: "basic", label: "Basic" },
      { key: "reversed", label: "Basic (reversed)" },
      { key: "cloze", label: "Cloze" },
      { key: "mcq", label: "Multiple choice" },
      { key: "oq", label: "Ordered question" },
      { key: "io", label: "Image occlusion" },
    ];

    for (const type of cardTypes) {
      if (type.key === "io" && !flashcardModelIsVisionCapable) continue;
      const typeToken = String(type.key);
      const typeDesc = type.key === "io"
        ? this._tx(
          "ui.settings.studyAssistant.generatorTypes.io.desc",
          "If off, Sprig will not generate this type. Some models cannot analyse images. More advanced models can read text in images and turn it into questions. The most advanced models may attempt to generate image occlusion cards, but mask positioning can still be inaccurate. Check generated IO cards in the flashcard editor and adjust masks before studying.",
        )
        : this._tx(`ui.settings.studyAssistant.generatorTypes.${typeToken}.desc`, "If off, Sprig will not generate this type.");
      withDependentSetting(
        new Setting(wrapper)
          .setName(this._tx(`ui.settings.studyAssistant.generatorTypes.${typeToken}.name`, type.label))
          .setDesc(typeDesc)
          .addToggle((toggle) =>
            toggle.setValue(!!this.plugin.settings.studyAssistant.generatorTypes[type.key]).onChange(async (value) => {
              this.plugin.settings.studyAssistant.generatorTypes[type.key] = !!value;
              await this.plugin.saveAll();
            }),
          ),
      );
    }

    withDependentSetting(new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.generatorOutput", "Generated fields")).setHeading());

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.generatorOutput.title.name", "Include title fields"))
        .setDesc(this._tx("ui.settings.studyAssistant.generatorOutput.title.desc", "Allow Sprig to generate `T | ... |` title rows."))
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.generatorOutput.includeTitle).onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorOutput.includeTitle = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.generatorOutput.info.name", "Include extra information fields"))
        .setDesc(this._tx("ui.settings.studyAssistant.generatorOutput.info.desc", "Allow Sprig to generate `I | ... |` rows."))
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.generatorOutput.includeInfo).onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorOutput.includeInfo = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );

    withDependentSetting(
      new Setting(wrapper)
        .setName(this._tx("ui.settings.studyAssistant.generatorOutput.groups.name", "Include groups fields"))
        .setDesc(this._tx("ui.settings.studyAssistant.generatorOutput.groups.desc", "Allow Sprig to generate `G | ... |` rows."))
        .addToggle((toggle) =>
          toggle.setValue(!!this.plugin.settings.studyAssistant.generatorOutput.includeGroups).onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorOutput.includeGroups = !!value;
            await this.plugin.saveAll();
          }),
        ),
    );

    const enabled = !!this.plugin.settings.studyAssistant.enabled;
    for (const setting of dependentSettings) setting.setDisabled(!enabled);
  }

  private _formatModelLabel(rawModel: string): string {
    const input = String(rawModel || "").trim();
    if (!input) return "";
    const base = input.includes("/") ? input.split("/").slice(1).join("/") : input;
    const clean = base.replace(/:free$/i, "");
    const parts = clean.split(/[\s._:/-]+/g).filter(Boolean);
    const acronyms = new Map<string, string>([
      ["gpt", "GPT"],
      ["ai", "AI"],
      ["api", "API"],
      ["r1", "R1"],
      ["vl", "VL"],
      ["llama", "Llama"],
      ["qwen", "Qwen"],
      ["sonnet", "Sonnet"],
      ["opus", "Opus"],
      ["haiku", "Haiku"],
      ["gemini", "Gemini"],
      ["deepseek", "DeepSeek"],
    ]);
    return parts
      .map((part) => {
        const lower = part.toLowerCase();
        const mapped = acronyms.get(lower);
        if (mapped) return mapped;
        if (/^[0-9]+[a-z]?$/i.test(part)) return part.toUpperCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ");
  }

  private _normaliseOpenRouterProviderLabel(rawProvider: string): string {
    const value = String(rawProvider || "").trim().toLowerCase();
    if (value === "openai") return "OpenAI";
    if (value === "anthropic") return "Anthropic";
    if (value === "meta-llama" || value === "meta") return "Meta";
    if (value === "google") return "Google";
    if (value === "deepseek") return "DeepSeek";
    if (value === "mistralai" || value === "mistral") return "Mistral";
    if (value === "qwen") return "Qwen";
    if (value === "x-ai" || value === "xai") return "xAI";
    return this._formatModelLabel(value);
  }

  private _normaliseOpenRouterTier(rawTier: unknown): "free" | "paid" {
    return rawTier === "paid" ? "paid" : "free";
  }

  private _getOpenRouterModelOptions(tier: "free" | "paid"): StudyAssistantModelOption[] {
    const models = this._openRouterModelsCache ?? [];
    if (!models.length) return [];

    const ROUTER_FREE_ID = "openrouter/free";
    const ROUTER_AUTO_ID = "openrouter/auto";
    const ROUTER_SWITCHPOINT_ID = "switchpoint/router";
    const ROUTER_BODYBUILDER_ID = "openrouter/bodybuilder";
    const byId = new Map(models.map((model) => [model.id, model]));

    const routerIds = tier === "free"
      ? [ROUTER_FREE_ID, ROUTER_AUTO_ID, ROUTER_BODYBUILDER_ID]
      : [ROUTER_AUTO_ID, ROUTER_SWITCHPOINT_ID, ROUTER_BODYBUILDER_ID];

    const routerOptions: StudyAssistantModelOption[] = [];
    if (routerIds.includes(ROUTER_FREE_ID) && byId.has(ROUTER_FREE_ID)) {
      routerOptions.push({
        value: ROUTER_FREE_ID,
        label: "Free Models Router",
        description: "Routes across currently available free models",
        section: "Router",
      });
    }
    if (routerIds.includes(ROUTER_AUTO_ID) && byId.has(ROUTER_AUTO_ID)) {
      routerOptions.push({
        value: ROUTER_AUTO_ID,
        label: "Auto Router",
        description: "Automated model selection",
        section: "Router",
      });
    }
    if (routerIds.includes(ROUTER_SWITCHPOINT_ID) && byId.has(ROUTER_SWITCHPOINT_ID)) {
      routerOptions.push({
        value: ROUTER_SWITCHPOINT_ID,
        label: "Switchpoint Router",
        description: "Flat-rate external routing engine",
        section: "Router",
      });
    }
    if (routerIds.includes(ROUTER_BODYBUILDER_ID) && byId.has(ROUTER_BODYBUILDER_ID)) {
      routerOptions.push({
        value: ROUTER_BODYBUILDER_ID,
        label: "Body Builder (beta)",
        description: "Natural language to OpenRouter request builder",
        section: "Router",
      });
    }

    const filtered = models
      .filter((model) => (tier === "free" ? model.isFree : !model.isFree))
      .filter((model) => !routerIds.includes(model.id))
      .sort((a, b) => (a.provider === b.provider ? a.name.localeCompare(b.name) : a.provider.localeCompare(b.provider)));

    const dynamicOptions = filtered.map((model) => ({
      value: model.id,
      label: this._cleanOpenRouterModelDisplayName(model.name || this._formatModelLabel(model.id)),
      description: model.id,
      section: this._normaliseOpenRouterProviderLabel(model.provider),
    }));

    return [...routerOptions, ...dynamicOptions];
  }

  private _cleanOpenRouterModelDisplayName(name: string): string {
    return String(name || "")
      .replace(/\s*\(free\)\s*$/i, "")
      .replace(/:free\s*$/i, "")
      .trim();
  }

  private async _loadOpenRouterModels(): Promise<void> {
    if (this._openRouterModelsLoading) return;
    this._openRouterModelsLoading = true;
    this._openRouterModelsError = null;

    try {
      const res = await requestUrl({
        url: "https://openrouter.ai/api/v1/models",
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`);
      }

      const root = res.json as { data?: unknown };
      const rawModels = Array.isArray(root?.data) ? root.data : [];
      const parsed: OpenRouterModel[] = [];

      for (const entry of rawModels) {
        if (!entry || typeof entry !== "object") continue;
        const model = entry as Record<string, unknown>;
        const idRaw = model.id;
        const id = typeof idRaw === "string"
          ? idRaw.trim()
          : typeof idRaw === "number"
            ? String(idRaw)
            : "";
        if (!id) continue;

        const pricing = model.pricing && typeof model.pricing === "object"
          ? model.pricing as Record<string, unknown>
          : {};
        const promptRaw = pricing.prompt;
        const completionRaw = pricing.completion;
        const promptPrice = Number.parseFloat(
          typeof promptRaw === "string" || typeof promptRaw === "number" ? String(promptRaw) : "0",
        );
        const completionPrice = Number.parseFloat(
          typeof completionRaw === "string" || typeof completionRaw === "number" ? String(completionRaw) : "0",
        );
        const isFreeByPrice = Number.isFinite(promptPrice) && Number.isFinite(completionPrice) && promptPrice <= 0 && completionPrice <= 0;
        const isFree = isFreeByPrice || /:free$/i.test(id);
        const provider = id.includes("/") ? id.split("/")[0] : "openrouter";
        const nameRaw = model.name;
        const displayNameSource = typeof nameRaw === "string" && nameRaw.trim().length > 0
          ? nameRaw
          : this._formatModelLabel(id);
        const displayName = this._cleanOpenRouterModelDisplayName(displayNameSource.trim());

        parsed.push({
          id,
          name: displayName,
          provider,
          isFree,
        });
      }

      const deduped = Array.from(new Map(parsed.map((model) => [model.id, model])).values());
      this._openRouterModelsCache = deduped;

      if (this.plugin.settings.studyAssistant.provider === "openrouter") {
        const options = this._getOpenRouterModelOptions(this._normaliseOpenRouterTier(this.plugin.settings.studyAssistant.openRouterTier));
        if (options.length && !options.some((opt) => opt.value === this.plugin.settings.studyAssistant.model)) {
          this.plugin.settings.studyAssistant.model = options[0].value;
          await this.plugin.saveAll();
        }
      }
    } catch (error) {
      this._openRouterModelsError = error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    } finally {
      this._openRouterModelsLoading = false;
      this._softRerender();
    }
  }

  private renderSchedulingSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Scheduling
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.scheduling", "Scheduling")).setHeading();

    const sched = this.plugin.settings.scheduling;

    /** Rounds a number to 2 decimal places. */
    const round2 = (n: unknown) => {
      const x = Number(n);
      if (!Number.isFinite(x)) return NaN;
      return Number(x.toFixed(2));
    };

    /** Compares two numeric arrays for equality. */
    const arraysEqualNumbers = (a: unknown, b: unknown) => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (Number(a[i]) !== Number(b[i])) return false;
      }
      return true;
    };

    /* ── FSRS scheduling presets ── */
    const presets: Array<{
      key: string;
      label: string;
      desc: string;
      learning: number[];
      relearning: number[];
      retention: number;
    }> = [
      {
        key: "custom",
        label: this._tx("ui.settings.scheduling.preset.option.custom", "Custom"),
        desc: this._tx("ui.settings.scheduling.preset.option.customDesc", "Keep your current values."),
        learning: [],
        relearning: [],
        retention: 0.9,
      },
      {
        key: "relaxed",
        label: this._tx("ui.settings.scheduling.preset.option.relaxed", "Relaxed"),
        desc: this._tx("ui.settings.scheduling.preset.option.relaxedDesc", "Learning: 20m | Relearning: 20m | Retention: 0.88"),
        learning: [20],
        relearning: [20],
        retention: 0.88,
      },
      {
        key: "balanced",
        label: this._tx("ui.settings.scheduling.preset.option.balanced", "Balanced"),
        desc: this._tx("ui.settings.scheduling.preset.option.balancedDesc", "Learning: 10m, 1d | Relearning: 10m | Retention: 0.90"),
        learning: [10, 1440],
        relearning: [10],
        retention: 0.9,
      },
      {
        key: "aggressive",
        label: this._tx("ui.settings.scheduling.preset.option.aggressive", "Aggressive"),
        desc: this._tx("ui.settings.scheduling.preset.option.aggressiveDesc", "Learning: 5m, 30m, 1d | Relearning: 10m | Retention: 0.92"),
        learning: [5, 30, 1440],
        relearning: [10],
        retention: 0.92,
      },
    ];

    /** Detects which preset matches the current scheduling parameters. */
    const detectPresetKey = (): string => {
      const curLearning = sched.learningStepsMinutes ?? [];
      const curRelearning = sched.relearningStepsMinutes ?? [];
      const curRetention = round2(sched.requestRetention);

      for (const p of presets) {
        if (p.key === "custom") continue;
        if (
          arraysEqualNumbers(curLearning, p.learning) &&
          arraysEqualNumbers(curRelearning, p.relearning ?? []) &&
          round2(p.retention) === curRetention
        ) {
          return p.key;
        }
      }
      return "custom";
    };

    let presetHandle: { getValue: () => string; setValue: (v: string) => void } | null = null;
    let isSyncingPreset = false;

    /** Programmatically syncs the preset dropdown to match current values. */
    const syncPresetDropdown = () => {
      if (!presetHandle) return;
      const desired = detectPresetKey();
      const current = presetHandle.getValue();
      if (current === desired) return;

      isSyncingPreset = true;
      try {
        presetHandle.setValue(desired);
      } finally {
        isSyncingPreset = false;
      }
    };

    const schedulingPresetSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.scheduling.preset.name", "Preset"))
      .setDesc(this._tx("ui.settings.scheduling.preset.desc", "Apply a scheduling preset to learning steps, relearning steps, and retention. Choose custom to keep your values."))
      .then((s) => {
        presetHandle = this._addSimpleSelect(s.controlEl, {
          options: presets.map((p) => ({ value: p.key, label: p.label })),
          separatorAfterIndex: 0,
          value: detectPresetKey(),

          onChange: (key) => {
            void (async () => {
              if (isSyncingPreset) return;

              const p = presets.find((x) => x.key === key);
              if (!p) return;

              if (p.key === "custom") {
                this.queueSettingsNotice("scheduling.preset", this._noticeLines.fsrsPresetCustom);
                return;
              }

              const prevLearning = (sched.learningStepsMinutes ?? []).slice();
              const prevRelearning = (sched.relearningStepsMinutes ?? []).slice();
              const prevRetention = sched.requestRetention;

              sched.learningStepsMinutes = p.learning.slice();
              sched.relearningStepsMinutes = (p.relearning ?? []).slice();
              sched.requestRetention = p.retention;

              await this.plugin.saveAll();

              this.queueSettingsNotice("scheduling.preset", this._noticeLines.fsrsPreset(p.label), 0);

              if (!arraysEqualNumbers(prevLearning, sched.learningStepsMinutes)) {
                this.queueSettingsNotice(
                  "scheduler.learningStepsMinutes",
                  this._noticeLines.learningSteps(sched.learningStepsMinutes),
                );
              }
              if (!arraysEqualNumbers(prevRelearning, sched.relearningStepsMinutes)) {
                this.queueSettingsNotice(
                  "scheduler.relearningStepsMinutes",
                  this._noticeLines.relearningSteps(sched.relearningStepsMinutes),
                );
              }
              if (round2(prevRetention) !== round2(sched.requestRetention)) {
                this.queueSettingsNotice(
                  "scheduler.requestRetention",
                  this._noticeLines.requestRetention(sched.requestRetention),
                );
              }
            })();
          },
        });
      });

    schedulingPresetSetting.descEl.appendText(" ");
    const schedulingGuideLink = schedulingPresetSetting.descEl.createEl("a", {
      text: this._tx("ui.settings.scheduling.preset.guide.link", "Click here"),
      href: "#",
    });
    schedulingGuideLink.onclick = (evt) => {
      evt.preventDefault();
      void this.app.workspace.openLinkText("Scheduling", "", false);
    };
    schedulingPresetSetting.descEl.appendText(this._tx("ui.settings.scheduling.preset.guide.trailing", " for a guide to scheduling."));

    new Setting(wrapper)
      .setName(this._tx("ui.settings.scheduling.learningSteps.name", "Learning steps"))
      .setDesc(this._tx("ui.settings.scheduling.learningSteps.desc", "Comma-separated minutes. Examples: 10 or 10,1440."))
      .addText((t) =>
        t.setValue(String((sched.learningStepsMinutes ?? []).join(","))).onChange(async (v) => {
          const prev = (sched.learningStepsMinutes ?? []).slice();
          const arr = parsePositiveNumberListCsv(v);
          if (arr.length) sched.learningStepsMinutes = arr;
          await this.plugin.saveAll();
          syncPresetDropdown();

          if (!arraysEqualNumbers(prev, sched.learningStepsMinutes ?? [])) {
            this.queueSettingsNotice(
              "scheduler.learningStepsMinutes",
              this._noticeLines.learningSteps(sched.learningStepsMinutes),
            );
          }
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.scheduling.relearningSteps.name", "Relearning steps"))
      .setDesc(this._tx("ui.settings.scheduling.relearningSteps.desc", "Comma-separated minutes used after lapses."))
      .addText((t) =>
        t.setValue(String((sched.relearningStepsMinutes ?? []).join(","))).onChange(async (v) => {
          const prev = (sched.relearningStepsMinutes ?? []).slice();
          const arr = parsePositiveNumberListCsv(v);
          if (arr.length) sched.relearningStepsMinutes = arr;
          await this.plugin.saveAll();
          syncPresetDropdown();

          if (!arraysEqualNumbers(prev, sched.relearningStepsMinutes ?? [])) {
            this.queueSettingsNotice(
              "scheduler.relearningStepsMinutes",
              this._noticeLines.relearningSteps(sched.relearningStepsMinutes),
            );
          }
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.scheduling.requestedRetention.name", "Requested retention"))
      .setDesc(this._tx("ui.settings.scheduling.requestedRetention.desc", "Target recall probability at review time. Typical range: 0.85-0.95."))
      .addSlider((s) =>
        s
          .setLimits(0.8, 0.97, 0.01)
          .setValue(clamp(Number(sched.requestRetention) || 0.9, 0.8, 0.97))
          .setDynamicTooltip()
          .onChange(async (v) => {
            const prev = round2(sched.requestRetention);
            sched.requestRetention = Number(Number(v).toFixed(2));
            await this.plugin.saveAll();
            syncPresetDropdown();

            if (prev !== round2(sched.requestRetention)) {
              this.queueSettingsNotice(
                "scheduler.requestRetention",
                this._noticeLines.requestRetention(sched.requestRetention),
              );
            }
          }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.scheduling.reset.name", "Reset scheduling"))
      .setDesc(this._tx("ui.settings.scheduling.reset.desc", "Reset all cards to new and clear scheduling fields. Back up first if you may want to restore."))
      .addButton((b) =>
        b.setButtonText(this._tx("ui.settings.scheduling.reset.button", "Reset…")).onClick(() => {
          new ConfirmResetSchedulingModal(this.app, this.plugin).open();
        }),
      );
  }

  private renderStorageSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Storage
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.attachmentStorage", "Attachment storage")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.storage.imageOcclusionFolder.name", "Image occlusion folder"))
      .setDesc(this._tx("ui.settings.storage.imageOcclusionFolder.desc", "Folder where image occlusion mask images are saved."))
      .addText((t) => {
        const allFolders = listVaultFolders(this.app);

        const cur =
          this.plugin.settings.storage.imageOcclusionFolderPath ?? "Attachments/Image Occlusion/";
        t.setPlaceholder(this._tx("ui.settings.storage.imageOcclusionFolder.placeholder", "Attachments/image occlusion/"));
        t.setValue(String(cur));

        const inputEl = t.inputEl;

        const suggestWrap = inputEl.parentElement?.createDiv({ cls: "sprout-folder-suggest" }) ?? null;

        // Lazy list element: only exists when shown
        let listEl: HTMLDivElement | null = null;

        let activeIdx = -1;
        let lastCommitted = normaliseFolderPath(String(cur));
        let suppressBlurCommit = false;

        const ensureListEl = () => {
          if (!suggestWrap) return null;
          if (!listEl) {
            listEl = suggestWrap.createDiv({ cls: "sprout-folder-suggest-list" });
          }
          return listEl;
        };

        const hideList = () => {
          if (!listEl) return;
          listEl.remove();
          listEl = null;
          activeIdx = -1;
        };

        /** Commits the chosen folder path to settings. */
        const commit = async (rawValue: string, fromPick: boolean) => {
          const prev = String(this.plugin.settings.storage.imageOcclusionFolderPath ?? "");
          const next = normaliseFolderPath(rawValue || "Attachments/Image Occlusion/");

          inputEl.value = next;

          if (next === lastCommitted && next === normaliseFolderPath(prev)) {
            hideList();
            return;
          }

          this.plugin.settings.storage.imageOcclusionFolderPath = next;

          await this.plugin.saveAll();

          lastCommitted = next;
          hideList();

          if (prev !== next) {
            this.queueSettingsNotice(
              "io.attachmentFolderPath",
              this._noticeLines.ioAttachmentFolder(next),
              fromPick ? 0 : 150,
            );
          }
        };

        /** Renders the folder-suggestion dropdown list. */
        const renderList = (items: string[]) => {
          if (!items.length) {
            hideList();
            return;
          }

          const el = ensureListEl();
          if (!el) return;

          el.empty();
          activeIdx = -1;

          for (let i = 0; i < items.length; i++) {
            const p = items[i];

            const btn = el.createEl("button", { cls: "sprout-folder-suggest-item", text: p });
            btn.type = "button";

            // mousedown => selection before blur
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              suppressBlurCommit = true;
              void commit(p, true);
            });
          }
        };

        const updateSuggestions = () => {
          const raw = inputEl.value || "";
          const matches = fuzzyFolderMatches(allFolders, raw, 12);
          renderList(matches);
        };

        inputEl.addEventListener("input", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("focus", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (!listEl) return;

          const items = Array.from(listEl.querySelectorAll<HTMLButtonElement>(".sprout-folder-suggest-item"));
          if (!items.length) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIdx = Math.min(items.length - 1, activeIdx + 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIdx = Math.max(0, activeIdx - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();

            if (activeIdx >= 0 && activeIdx < items.length) {
              const picked = items[activeIdx].textContent || "";
              suppressBlurCommit = true;
              void commit(picked, true);
              return;
            }

            suppressBlurCommit = true;
            void commit(inputEl.value || "", false);
            return;
          } else if (e.key === "Escape") {
            e.preventDefault();
            hideList();
            return;
          } else {
            return;
          }

          items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
          const active = items[activeIdx];
          active?.scrollIntoView?.({ block: "nearest" });
        });

        // Commit on blur (typed value), no per-letter saves
        inputEl.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (suppressBlurCommit) {
              suppressBlurCommit = false;
              return;
            }
            void commit(inputEl.value || "", false);
          }, 120);
        });
      });

    new Setting(wrapper)
      .setName(this._tx("ui.settings.storage.deleteOrphanedImages.name", "Delete orphaned image occlusion images"))
      .setDesc(this._tx("ui.settings.storage.deleteOrphanedImages.desc", "During sync, automatically delete image occlusion files whose cards were removed from notes."))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.storage?.deleteOrphanedImages ?? true).onChange(async (v) => {
          const prev = this.plugin.settings.storage?.deleteOrphanedImages ?? true;
          this.plugin.settings.storage.deleteOrphanedImages = v;
          await this.plugin.saveAll();

          if (prev !== v) {
            this.queueSettingsNotice("io.deleteOrphanedImages", this._noticeLines.deleteOrphanedImages(v));
          }
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.storage.cardAttachmentFolder.name", "Card attachment folder"))
      .setDesc(this._tx("ui.settings.storage.cardAttachmentFolder.desc", "Folder where flashcard images and media are saved."))
      .addText((t) => {
        const allFolders = listVaultFolders(this.app);

        const cur = this.plugin.settings.storage.cardAttachmentFolderPath ?? "Attachments/Cards/";
        t.setPlaceholder(this._tx("ui.settings.storage.cardAttachmentFolder.placeholder", "Attachments/card attachments/"));
        t.setValue(String(cur));

        const inputEl = t.inputEl;

        const suggestWrap = inputEl.parentElement?.createDiv({ cls: "sprout-folder-suggest" }) ?? null;

        // Lazy list element: only exists when shown
        let listEl: HTMLDivElement | null = null;

        let activeIdx = -1;
        let lastCommitted = normaliseFolderPath(String(cur));
        let suppressBlurCommit = false;

        const ensureListEl = () => {
          if (!suggestWrap) return null;
          if (!listEl) {
            listEl = suggestWrap.createDiv({ cls: "sprout-folder-suggest-list" });
          }
          return listEl;
        };

        const hideList = () => {
          if (!listEl) return;
          listEl.remove();
          listEl = null;
          activeIdx = -1;
        };

        /** Commits the chosen folder path to settings. */
        const commit = async (rawValue: string, fromPick: boolean) => {
          const prev = String(this.plugin.settings.storage.cardAttachmentFolderPath ?? "");
          const next = normaliseFolderPath(rawValue || "Attachments/Cards/");

          inputEl.value = next;

          if (next === lastCommitted && next === normaliseFolderPath(prev)) {
            hideList();
            return;
          }

          this.plugin.settings.storage.cardAttachmentFolderPath = next;

          await this.plugin.saveAll();

          lastCommitted = next;
          hideList();

          if (prev !== next) {
            this.queueSettingsNotice(
              "card.attachmentFolderPath",
              this._noticeLines.cardAttachmentFolder(next),
              fromPick ? 0 : 150,
            );
          }
        };

        /** Renders the folder-suggestion dropdown list. */
        const renderList = (items: string[]) => {
          if (!items.length) {
            hideList();
            return;
          }

          const el = ensureListEl();
          if (!el) return;

          el.empty();
          activeIdx = -1;

          for (let i = 0; i < items.length; i++) {
            const p = items[i];

            const btn = el.createEl("button", { cls: "sprout-folder-suggest-item", text: p });
            btn.type = "button";

            // mousedown => selection before blur
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              suppressBlurCommit = true;
              void commit(p, true);
            });
          }
        };

        const updateSuggestions = () => {
          const raw = inputEl.value || "";
          const matches = fuzzyFolderMatches(allFolders, raw, 12);
          renderList(matches);
        };

        inputEl.addEventListener("input", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("focus", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (!listEl) return;

          const items = Array.from(listEl.querySelectorAll<HTMLButtonElement>(".sprout-folder-suggest-item"));
          if (!items.length) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIdx = Math.min(items.length - 1, activeIdx + 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIdx = Math.max(0, activeIdx - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();

            if (activeIdx >= 0 && activeIdx < items.length) {
              const picked = items[activeIdx].textContent || "";
              suppressBlurCommit = true;
              void commit(picked, true);
              return;
            }

            suppressBlurCommit = true;
            void commit(inputEl.value || "", false);
            return;
          } else if (e.key === "Escape") {
            e.preventDefault();
            hideList();
            return;
          } else {
            return;
          }

          items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
          const active = items[activeIdx];
          active?.scrollIntoView?.({ block: "nearest" });
        });

        // Commit on blur (typed value), no per-letter saves
        inputEl.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (suppressBlurCommit) {
              suppressBlurCommit = false;
              return;
            }
            void commit(inputEl.value || "", false);
          }, 120);
        });
      });


    this.renderBackupsSection(wrapper);
  }

  private renderSyncSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Syncing
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.syncing", "Syncing")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.sync.ignoreCodeFences.name", "Ignore fenced code blocks"))
      .setDesc(this._tx("ui.settings.sync.ignoreCodeFences.desc", "Ignore cards inside fenced code blocks (``` ... ```)."))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.indexing.ignoreInCodeFences).onChange(async (v) => {
          const prev = this.plugin.settings.indexing.ignoreInCodeFences;
          this.plugin.settings.indexing.ignoreInCodeFences = v;
          await this.plugin.saveAll();

          if (prev !== v) {
            this.queueSettingsNotice("indexing.ignoreInCodeFences", this._noticeLines.ignoreCodeBlocks(v));
          }
        }),
      );

    const cardDelimiterSetting = new Setting(wrapper)
      .setName(this._tx("ui.settings.sync.cardDelimiter.name", "Card delimiter"))
      .setDesc(
        this._tx("ui.settings.sync.cardDelimiter.desc", "Character used to separate fields in card markup."),
      )
      .then((s) => {
        this._appendSettingWarning(
          s,
          this._tx(
            "ui.settings.sync.cardDelimiter.warning",
            "Changing this will NOT migrate existing cards. Cards written with a previous delimiter will stop parsing and their scheduling data will be lost on the next sync.",
          ),
        );
      })
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: Object.entries(DELIMITER_OPTIONS).map(([value, label]) => ({ value, label })),
          separatorAfterIndex: 0,
          value: this.plugin.settings.indexing.delimiter ?? "|",
          onChange: (v) => {
            void (async () => {
              const prev = this.plugin.settings.indexing.delimiter ?? "|";
              const next = v as DelimiterChar;
              this.plugin.settings.indexing.delimiter = next;
              setDelimiter(next);
              await this.plugin.saveAll();

              if (prev !== next) {
                this.queueSettingsNotice("indexing.delimiter", this._noticeLines.cardDelimiter(DELIMITER_OPTIONS[next]));
              }
            })();
          },
        });
      });

    cardDelimiterSetting.descEl.appendText(" ");
    const delimiterGuideLink = cardDelimiterSetting.descEl.createEl("a", {
      text: this._tx("ui.settings.sync.cardDelimiter.guide.link", "Click here"),
      href: "#",
    });
    delimiterGuideLink.onclick = (evt) => {
      evt.preventDefault();
      void this.app.workspace.openLinkText("Custom-Delimiters", "", false);
    };
    cardDelimiterSetting.descEl.appendText(this._tx("ui.settings.sync.cardDelimiter.guide.trailing", " for the custom delimiters guide."));
  }

  private renderResetSection(wrapper: HTMLElement): void {
    // ----------------------------
    // Reset options
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.reset", "Reset")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.reset.defaults.name", "Reset to defaults"))
      .setDesc(this._tx("ui.settings.reset.defaults.desc", "Reset all settings to defaults. Does not delete cards or change scheduling."))
      .then((s) => {
        this._appendSettingWarning(
          s,
          this._tx("ui.settings.reset.defaults.warning", "This action cannot be undone."),
        );
      })
      .addButton((b) =>
        b.setButtonText(this._tx("ui.settings.reset.defaults.button", "Reset…")).onClick(() => {
          new ConfirmResetDefaultsModal(this.app, this.plugin, async () => {
            const before = clonePlain(this.plugin.settings);
            try {
              await this.resetSettingsToDefaults();

              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();
              this.queueSettingsNotice("settings.resetDefaults", this._noticeLines.settingsResetDefaults, 0);
            } catch (e) {
              this.plugin.settings = before;
              log.error(e);
              new Notice(this._noticeLines.settingsResetFailed);
            }
          }).open();
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.reset.analytics.name", "Reset analytics"))
      .setDesc(this._tx("ui.settings.reset.analytics.desc", "Clear review history, heatmaps, and statistics. Scheduling data is preserved."))
      .then((s) => {
        this._appendSettingWarning(
          s,
          this._tx(
            "ui.settings.reset.analytics.warning",
            "This permanently deletes your analytics history. It can be restored from a backup in Settings. Make one before resetting.",
          ),
        );
      })
      .addButton((b) =>
        b.setButtonText(this._tx("ui.settings.reset.analytics.button", "Reset…")).onClick(() => {
          new ConfirmResetAnalyticsModal(this.app, this.plugin).open();
        }),
      );

    new Setting(wrapper)
      .setName(this._tx("ui.settings.reset.scheduling.name", "Reset scheduling"))
      .setDesc(this._tx("ui.settings.reset.scheduling.desc", "Reset all cards to new and clear scheduling fields."))
      .then((s) => {
        this._appendSettingWarning(
          s,
          this._tx(
            "ui.settings.reset.scheduling.warning",
            "This resets scheduling for every card. It can be restored from a backup in Settings. Make one before resetting.",
          ),
        );
      })
      .addButton((b) =>
        b.setButtonText(this._tx("ui.settings.reset.scheduling.button", "Reset…")).onClick(() => {
          new ConfirmResetSchedulingModal(this.app, this.plugin).open();
        }),
      );

    // ----------------------------
    // Danger zone
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.dangerZone", "Danger zone")).setHeading();

    new Setting(wrapper)
      .setName(this._tx("ui.settings.reset.deleteAllFlashcards.name", "Delete all flashcards"))
      .setDesc(this._tx("ui.settings.reset.deleteAllFlashcards.desc", "Delete flashcards from notes and clear all plugin data. This cannot be undone."))
      .then((s) => {
        this._appendSettingWarning(
          s,
          this._tx(
            "ui.settings.reset.deleteAllFlashcards.warning",
            "This permanently removes flashcards from your notes and clears plugin data. It cannot be restored from Sprout Settings. Ensure you have a full vault backup before continuing.",
          ),
        );
      })
      .addButton((b) =>
        b.setButtonText(this._tx("ui.settings.reset.deleteAllFlashcards.button", "Delete…")).onClick(() => {
          new ConfirmDeleteAllFlashcardsModal(this.app, this.plugin, async () => {
            const before = Date.now();

            const { filesTouched, anchorsRemoved, cardsRemoved } = await this.deleteAllSproutDataFromVault();
            await this.clearSproutStore();

            this.refreshAllWidgetViews();
            this.refreshReviewerViewsIfPossible();

            const secs = Math.max(0, Math.round((Date.now() - before) / 100) / 10);
            new Notice(this._noticeLines.deleteAllSummary(cardsRemoved, anchorsRemoved, filesTouched, secs));
          }).open();
        }),
      );

    // ----------------------------
    // Quarantine
    // ----------------------------
    new Setting(wrapper).setName(this._tx("ui.settings.sections.quarantinedCards", "Quarantined cards")).setHeading();

    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: this._tx(
          "ui.settings.quarantine.description",
          "Cards that could not be parsed. Open the source note to fix them.",
        ),
      });
    }

    this.renderQuarantineList(wrapper);
  }


  private _styleSettingsButtons(root: HTMLElement) {
    const buttonEls = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
    for (const button of buttonEls) {
      if (
        button.classList.contains("sprout-settings-icon-btn") ||
        button.classList.contains("sprout-ss-trigger") ||
        button.classList.contains("sprout-folder-suggest-item") ||
        button.classList.contains("sprout-settings-advanced-toggle")
      ) {
        continue;
      }
      if (button.classList.contains("clickable-icon")) continue;

      button.type = "button";
      button.classList.remove("mod-cta", "mod-warning");
      button.classList.add("bc", "btn-outline", "inline-flex", "items-center", "gap-2", "h-9", "px-3", "text-sm", "sprout-settings-action-btn");
    }
  }

  private _appendSettingWarning(setting: Setting, text: string) {
    const warn = setting.descEl.createDiv({ cls: "sprout-ss-warning" });
    const warnIcon = warn.createSpan({ cls: "sprout-ss-warning-icon" });
    setIcon(warnIcon, "alert-triangle");
    warn.createSpan({ text });
  }

  // ── Helper: simple select popover ──
  private _addSimpleSelect(
    controlEl: HTMLElement,
    args: {
      options: { value: string; label: string; description?: string }[];
      value: string;
      separatorAfterIndex?: number;
      onChange: (value: string) => void;
    },
  ): { getValue: () => string; setValue: (v: string) => void } {
    const id = `sprout-ss-${Math.random().toString(36).slice(2, 9)}`;

    // ── Trigger button ──
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "sprout-ss-trigger bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm sprout-settings-action-btn";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const trigLabel = document.createElement("span");
    trigLabel.className = "sprout-ss-trigger-label";
    trigger.appendChild(trigLabel);

    const chevron = document.createElement("span");
    chevron.className = "sprout-ss-trigger-chevron";
    setIcon(chevron, "chevron-down");
    trigger.appendChild(chevron);

    let current = args.value;
    const labelFor = (v: string) => args.options.find((o) => o.value === v)?.label ?? v;
    trigLabel.textContent = labelFor(current);

    controlEl.appendChild(trigger);

    // ── Body-portal popover ──
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("sprout-popover-overlay", "sprout-ss-popover");

    const panel = document.createElement("div");
    panel.className = "sprout-ss-panel";
    popover.appendChild(panel);
    sproutWrapper.appendChild(popover);

    // ── Options list ──
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.className = "sprout-ss-listbox";
    panel.appendChild(listbox);

    type ItemEntry = { value: string; el: HTMLElement };
    const items: ItemEntry[] = [];

    const buildItems = () => {
      listbox.replaceChildren();
      items.length = 0;

      for (const opt of args.options) {
        const item = document.createElement("div");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", opt.value === current ? "true" : "false");
        item.tabIndex = 0;
        item.className = "sprout-ss-item";

        const dotWrap = document.createElement("div");
        dotWrap.className = "sprout-ss-dot-wrap";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "sprout-ss-dot";
        if (opt.value === current) dot.classList.add("is-selected");
        dotWrap.appendChild(dot);

        const textWrap = document.createElement("div");
        textWrap.className = "sprout-ss-item-text";

        const txt = document.createElement("span");
        txt.className = "sprout-ss-item-label";
        txt.textContent = opt.label;
        textWrap.appendChild(txt);

        item.appendChild(textWrap);

        const activate = () => {
          current = opt.value;
          trigLabel.textContent = labelFor(current);
          for (const it of items) {
            it.el.setAttribute("aria-selected", it.value === current ? "true" : "false");
            const d = it.el.querySelector(".sprout-ss-dot");
            if (d) d.classList.toggle("is-selected", it.value === current);
          }
          args.onChange(current);
          close();
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        });

        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            activate();
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
          }
        });

        listbox.appendChild(item);
        items.push({ value: opt.value, el: item });

        // Insert separator after the specified index
        if (args.separatorAfterIndex != null && items.length - 1 === args.separatorAfterIndex) {
          const sep = document.createElement("div");
          sep.className = "sprout-ss-separator";
          sep.setAttribute("role", "separator");
          listbox.appendChild(sep);
        }
      }
    };

    // ── Positioning ──
    const place = () => {
      const isPhone = document.body.classList.contains("is-mobile") && window.innerWidth < 768;
      placePopover({
        trigger, panel, popoverEl: popover,
        width: isPhone ? undefined : Math.max(220, trigger.getBoundingClientRect().width),
        align: "right",
        gap: 4,
      });
    };

    // ── Open / Close ──
    let cleanup: (() => void) | null = null;

    const close = () => {
      trigger.setAttribute("aria-expanded", "false");
      popover.setAttribute("aria-hidden", "true");
      popover.classList.remove("is-open");
      cleanup?.();
      cleanup = null;
      if (sproutWrapper.parentNode === document.body) {
        document.body.removeChild(sproutWrapper);
      }
    };

    const open = () => {
      buildItems();

      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.classList.add("is-open");

      document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => {
        place();
        const sel = listbox.querySelector<HTMLElement>('[aria-selected="true"]');
        sel?.focus();
      });

      const onResizeOrScroll = () => place();

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (trigger.contains(t) || popover.contains(t)) return;
        close();
      };

      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        trigger.focus();
      };

      window.addEventListener("resize", onResizeOrScroll, true);
      window.addEventListener("scroll", onResizeOrScroll, true);

      const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
      }, 0);

      cleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const isOpen = trigger.getAttribute("aria-expanded") === "true";
      if (isOpen) close();
      else open();
    });

    return {
      getValue: () => current,
      setValue: (v: string) => {
        current = v;
        trigLabel.textContent = labelFor(current);
      },
    };
  }

  // ── Helper: searchable popover dropdown ──
  private _addSearchablePopover(
    container: HTMLElement,
    args: {
      name: string;
      description: string;
      options: { value: string; label: string; description?: string; flagCode?: string; section?: string }[];
      value: string;
      onChange: (value: string) => void;
    },
  ): void {
    const id = `sprout-ss-${Math.random().toString(36).slice(2, 9)}`;

    const setting = new Setting(container).setName(args.name).setDesc(args.description);

    // ── Trigger button ──
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "sprout-ss-trigger bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm sprout-settings-action-btn";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const trigLabel = document.createElement("span");
    trigLabel.className = "sprout-ss-trigger-label";
    trigger.appendChild(trigLabel);

    const chevron = document.createElement("span");
    chevron.className = "sprout-ss-trigger-chevron";
    setIcon(chevron, "chevron-down");
    trigger.appendChild(chevron);

    let current = args.value;
    const optionFor = (v: string) => args.options.find((o) => o.value === v);
    const renderLabel = (target: HTMLElement, label: string, flagCode?: string) => {
      target.replaceChildren();
      if (flagCode) {
        const img = document.createElement("img");
        img.className = "sprout-inline-flag";
        img.alt = flagCode;
        img.src = getCircleFlagUrl(flagCode);
        img.addEventListener(
          "error",
          () => {
            const fallback = getCircleFlagFallbackUrl(flagCode);
            if (img.src !== fallback) img.src = fallback;
          },
          { once: true },
        );
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        target.appendChild(img);
      }
      target.appendChild(document.createTextNode(label));
    };
    {
      const selected = optionFor(current);
      renderLabel(trigLabel, selected?.label ?? current, selected?.flagCode);
    }

    setting.controlEl.appendChild(trigger);

    // ── Body-portal popover ──
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("sprout-popover-overlay", "sprout-ss-popover");

    const panel = document.createElement("div");
    panel.className = "sprout-ss-panel";
    popover.appendChild(panel);
    sproutWrapper.appendChild(popover);

    // ── Search input (only for >7 options) ──
    const showSearch = args.options.length > 7;
    let searchInput: HTMLInputElement | null = null;

    if (showSearch) {
      const searchWrap = document.createElement("div");
      searchWrap.className = "sprout-ss-search-wrap";
      panel.appendChild(searchWrap);

      const searchIcon = document.createElement("span");
      searchIcon.className = "sprout-ss-search-icon";
      setIcon(searchIcon, "search");
      searchWrap.appendChild(searchIcon);

      searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "sprout-ss-search-input";
      searchInput.placeholder = this._tx("ui.settings.searchableSelect.searchPlaceholder", "Search...");
      searchInput.setAttribute("autocomplete", "off");
      searchInput.setAttribute("spellcheck", "false");
      searchWrap.appendChild(searchInput);
    }

    // ── Options list ──
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.className = "sprout-ss-listbox";
    panel.appendChild(listbox);

    // ── Empty state ──
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "sprout-ss-empty";
    emptyMsg.textContent = this._tx("ui.settings.searchableSelect.empty", "No results");
    emptyMsg.hidden = true;
    panel.appendChild(emptyMsg);

    type ItemEntry = { value: string; label: string; el: HTMLElement; lower: string; sectionKey: string };
    type SectionEntry = { titleEl: HTMLElement; separatorEl: HTMLElement | null; visibleCount: number };
    const items: ItemEntry[] = [];
    const sections = new Map<string, SectionEntry>();

    const buildItems = () => {
      listbox.replaceChildren();
      items.length = 0;
      sections.clear();

      let previousSection = "";

      for (const opt of args.options) {
        const sectionKey = String(opt.section || "").trim();
        if (sectionKey && sectionKey !== previousSection) {
          const separatorEl = listbox.children.length
            ? listbox.createDiv({ cls: "sprout-ss-separator" })
            : null;
          if (separatorEl) separatorEl.setAttribute("role", "separator");

          const titleEl = listbox.createDiv({ cls: "sprout-ss-section-title", text: sectionKey });
          sections.set(sectionKey, { titleEl, separatorEl, visibleCount: 0 });
          previousSection = sectionKey;
        }

        const item = document.createElement("div");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", opt.value === current ? "true" : "false");
        item.tabIndex = 0;
        item.className = "sprout-ss-item";

        const dotWrap = document.createElement("div");
        dotWrap.className = "sprout-ss-dot-wrap";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "sprout-ss-dot";
        if (opt.value === current) dot.classList.add("is-selected");
        dotWrap.appendChild(dot);

        const textWrap = document.createElement("div");
        textWrap.className = "sprout-ss-item-text";

        const txt = document.createElement("span");
        txt.className = "sprout-ss-item-label";
        renderLabel(txt, opt.label, opt.flagCode);
        textWrap.appendChild(txt);

        item.appendChild(textWrap);

        const activate = () => {
          current = opt.value;
          renderLabel(trigLabel, opt.label, opt.flagCode);
          for (const it of items) {
            it.el.setAttribute("aria-selected", it.value === current ? "true" : "false");
            const d = it.el.querySelector(".sprout-ss-dot");
            if (d) d.classList.toggle("is-selected", it.value === current);
          }
          args.onChange(current);
          close();
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        });

        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            activate();
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
          }
        });

        listbox.appendChild(item);
        items.push({
          value: opt.value,
          label: opt.label,
          el: item,
          sectionKey,
          lower: `${opt.label} ${opt.description ?? ""} ${opt.value} ${sectionKey}`.toLowerCase(),
        });
      }
    };

    // ── Filter logic ──
    const applyFilter = () => {
      const q = searchInput?.value.toLowerCase().trim() ?? "";
      let visible = 0;

      for (const section of sections.values()) {
        section.visibleCount = 0;
      }

      for (const it of items) {
        const show = !q || it.lower.includes(q);
        it.el.hidden = !show;
        it.el.style.display = show ? "" : "none";
        if (show) {
          visible++;
          if (it.sectionKey) {
            const section = sections.get(it.sectionKey);
            if (section) section.visibleCount += 1;
          }
        }
      }

      for (const section of sections.values()) {
        const hasMatches = section.visibleCount > 0;
        section.titleEl.hidden = !hasMatches;
        section.titleEl.style.display = hasMatches ? "" : "none";
        if (section.separatorEl) {
          section.separatorEl.hidden = !hasMatches;
          section.separatorEl.style.display = hasMatches ? "" : "none";
        }
      }

      emptyMsg.hidden = visible !== 0;
      emptyMsg.style.display = visible === 0 ? "" : "none";
    };

    if (searchInput) {
      searchInput.addEventListener("input", applyFilter);

      searchInput.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Escape") return;
        ev.stopPropagation();
      });

      searchInput.addEventListener("mousedown", (ev) => ev.stopPropagation());
      searchInput.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    }

    // ── Positioning ──
    const place = () => {
      const isPhone = document.body.classList.contains("is-mobile") && window.innerWidth < 768;
      placePopover({
        trigger, panel, popoverEl: popover,
        width: isPhone ? undefined : Math.max(220, trigger.getBoundingClientRect().width),
        align: "right",
        gap: 4,
      });
    };

    // ── Open / Close ──
    let cleanup: (() => void) | null = null;

    const close = () => {
      trigger.setAttribute("aria-expanded", "false");
      popover.setAttribute("aria-hidden", "true");
      popover.classList.remove("is-open");
      cleanup?.();
      cleanup = null;
      if (sproutWrapper.parentNode === document.body) {
        document.body.removeChild(sproutWrapper);
      }
    };

    const open = () => {
      buildItems();
      if (searchInput) searchInput.value = "";
      applyFilter();

      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.classList.add("is-open");

      document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => {
        place();
        if (searchInput) {
          searchInput.focus();
        } else {
          const first = listbox.querySelector<HTMLElement>('[role="option"]');
          first?.focus();
        }
      });

      const onResizeOrScroll = () => place();

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (trigger.contains(t) || popover.contains(t)) return;
        close();
      };

      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        trigger.focus();
      };

      window.addEventListener("resize", onResizeOrScroll, true);
      window.addEventListener("scroll", onResizeOrScroll, true);

      const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
      }, 0);

      cleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const isOpen = trigger.getAttribute("aria-expanded") === "true";
      if (isOpen) close();
      else open();
    });
  }
}
