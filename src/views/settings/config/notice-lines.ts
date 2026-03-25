import { fmtSettingValue } from "../settings-utils";

type Tx = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

export function createSettingsNoticeLines(tx: Tx) {
  return {
    backupCreateUnavailable: tx(
      "ui.settings.backups.notice.createUnavailable",
      "LearnKit – could not create backup (no scheduling data or adapter cannot write)",
    ),
    backupCreateSuccess: tx("ui.settings.backups.notice.createSuccess", "LearnKit – scheduling data backup created"),
    backupCreateFailed: tx("ui.settings.backups.notice.createFailed", "LearnKit – failed to create scheduling data backup"),
    ttsNotSupported: tx("ui.settings.audio.notice.notSupported", "LearnKit – text-to-speech is not supported in this environment"),
    settingsResetFailed: tx("ui.settings.reset.notice.failed", "LearnKit – could not reset settings"),
    deleteAllSummary: (cardsRemoved: number, anchorsRemoved: number, filesTouched: number, seconds: number) =>
      tx(
        "ui.settings.notice.deleteAllSummary",
        "LearnKit – deleted {cards} cards and {anchors} anchors in {files} files ({seconds}s)",
        { cards: cardsRemoved, anchors: anchorsRemoved, files: filesTouched, seconds },
      ),

    userName: (value: string) => tx("ui.settings.notice.userName", "User name: {value}", {
      value: value || tx("ui.settings.notice.emptyValue", "(empty)"),
    }),
    greetingText: (enabled: boolean) => tx("ui.settings.notice.greetingText", "Greeting text: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    animations: (enabled: boolean) => tx("ui.settings.notice.animations", "Animations: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    interfaceLanguage: (label: string) => tx("settings.general.interfaceLanguage.notice", `Interface language: ${label}`, { language: label }),
    ttsEnabled: (enabled: boolean) => tx("ui.settings.notice.ttsEnabled", "Text to speech: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    clozeMode: (isTyped: boolean) => tx("ui.settings.notice.clozeMode", "Cloze mode: {mode}", {
      mode: isTyped ? tx("ui.settings.cards.cloze.mode.option.typed", "Typed") : tx("ui.settings.cards.cloze.mode.option.standard", "Standard"),
    }),
    clozeBgReset: tx("settings.cards.clozeBgColor.reset", "Cloze background colour reset to default"),
    clozeTextReset: tx("settings.cards.clozeTextColor.reset", "Cloze text colour reset to default"),
    ioDefaultModeUpdated: tx("ui.settings.notice.ioDefaultModeUpdated", "Default reveal mode updated"),
    ioRevealMode: (isGroup: boolean) => tx("ui.settings.notice.ioRevealMode", "Reveal mode: {mode}", {
      mode: isGroup
        ? tx("ui.settings.cards.imageOcclusion.revealMode.option.group", "Reveal group")
        : tx("ui.settings.cards.imageOcclusion.revealMode.option.all", "Reveal all"),
    }),
    randomizeMcqOptions: (enabled: boolean) => tx("ui.settings.notice.randomizeMcqOptions", "Randomise multiple-choice options: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    randomizeOqOrder: (enabled: boolean) => tx("ui.settings.notice.randomizeOqOrder", "Ordered question shuffle: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    readingMacro: (label: string) => tx("ui.settings.notice.readingMacro", "Macro style: {label}", { label }),
    cardStyling: (enabled: boolean) => tx("ui.settings.notice.cardStyling", "Card styling: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    dailyNewLimit: (value: number) => tx("ui.settings.notice.dailyNewLimit", "Daily new limit: {value}", { value: fmtSettingValue(value) }),
    dailyReviewLimit: (value: number) => tx("ui.settings.notice.dailyReviewLimit", "Daily review limit: {value}", { value: fmtSettingValue(value) }),
    autoAdvanceEnabled: (enabled: boolean) => tx("ui.settings.notice.autoAdvanceEnabled", "Auto-advance: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    autoAdvanceSeconds: (value: number) => tx("ui.settings.notice.autoAdvanceSeconds", "Auto-advance: {value}s", { value: fmtSettingValue(value) }),
    remindersEnabled: (enabled: boolean) => tx("ui.settings.notice.remindersEnabled", "Reminders: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    remindersLaunch: (enabled: boolean) => tx("ui.settings.notice.remindersLaunch", "Reminders on launch: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    remindersLaunchDelay: (value: number) => tx("ui.settings.notice.remindersLaunchDelay", "Launch delay: {value}s", { value: fmtSettingValue(value) }),
    remindersRoutine: (enabled: boolean) => tx("ui.settings.notice.remindersRoutine", "Routine reminders: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    remindersRoutineFrequency: (value: number) => tx("ui.settings.notice.remindersRoutineFrequency", "Reminder frequency: {value} min", { value: fmtSettingValue(value) }),
    gatekeeperEnabled: (enabled: boolean) => tx("ui.settings.notice.gatekeeperEnabled", "Gatekeeper popups: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    gatekeeperOnStartup: (enabled: boolean) => tx("ui.settings.notice.gatekeeperOnStartup", "Gatekeeper on launch: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    gatekeeperFrequency: (value: number) => tx("ui.settings.notice.gatekeeperFrequency", "Gatekeeper frequency: {value} min", { value: fmtSettingValue(value) }),
    gatekeeperDueQuestions: (value: number) => tx("ui.settings.notice.gatekeeperDueQuestions", "Gatekeeper due questions: {value}", { value: fmtSettingValue(value) }),
    gatekeeperScope: (label: string) => tx("ui.settings.notice.gatekeeperScope", "Gatekeeper scoping: {label}", { label }),
    gatekeeperPauseWhenStudying: (enabled: boolean) => tx("ui.settings.notice.gatekeeperPauseWhenStudying", "Gatekeeper pause while studying: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    gatekeeperBypass: (enabled: boolean) => tx("ui.settings.notice.gatekeeperBypass", "Gatekeeper bypass: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    gatekeeperBypassWarning: (enabled: boolean) => tx("ui.settings.notice.gatekeeperBypassWarning", "Gatekeeper bypass warning: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    gradingButtons: (fourButtons: boolean) => tx("ui.settings.notice.gradingButtons", "Grading buttons: {count}", {
      count: fourButtons ? tx("ui.settings.study.gradingButtons.option.four", "Four") : tx("ui.settings.study.gradingButtons.option.two", "Two"),
    }),
    skipButton: (enabled: boolean) => tx("ui.settings.notice.skipButton", "Skip button: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    folderNotes: (enabled: boolean) => tx("ui.settings.notice.folderNotes", "Folder notes: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    siblingMode: (label: string) => tx("ui.settings.notice.siblingMode", "Sibling card management: {label}", { label }),
    fsrsPresetCustom: tx("ui.settings.notice.fsrsPresetCustom", "FSRS preset: custom"),
    fsrsPreset: (label: string) => tx("ui.settings.notice.fsrsPreset", "FSRS preset: {label}", { label }),
    learningSteps: (value: number[]) => tx("ui.settings.notice.learningSteps", "Learning steps: {value}", { value: fmtSettingValue(value) }),
    relearningSteps: (value: number[]) => tx("ui.settings.notice.relearningSteps", "Relearning steps: {value}", { value: fmtSettingValue(value) }),
    requestRetention: (value: number) => tx("ui.settings.notice.requestRetention", "Requested retention: {value}", { value: fmtSettingValue(value) }),
    ioAttachmentFolder: (value: string) => tx("ui.settings.notice.ioAttachmentFolder", "IO attachment folder: {value}", { value: fmtSettingValue(value) }),
    deleteOrphanedImages: (enabled: boolean) => tx("ui.settings.notice.deleteOrphanedImages", "Delete orphaned images: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    cardAttachmentFolder: (value: string) => tx("ui.settings.notice.cardAttachmentFolder", "Card attachment folder: {value}", { value: fmtSettingValue(value) }),
    ignoreCodeBlocks: (enabled: boolean) => tx("ui.settings.notice.ignoreCodeBlocks", "Ignore code blocks: {state}", {
      state: enabled ? tx("ui.common.on", "On") : tx("ui.common.off", "Off"),
    }),
    cardDelimiter: (label: string) => tx("ui.settings.notice.cardDelimiter", "Card delimiter: {label}", { label }),
    settingsResetDefaults: tx("ui.settings.reset.notice.defaultsSuccess", "Settings reset to defaults"),
  };
}

export type SettingsNoticeLines = ReturnType<typeof createSettingsNoticeLines>;
