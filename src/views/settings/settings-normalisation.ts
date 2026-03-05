/**
 * @file src/settings/settings-normalisation.ts
 * @summary Normalises (validates/defaults) SproutSettings fields after loading or migration.
 * Ensures every expected key exists, clamps numeric values, and fills in missing macro
 * configs. Mutates `settings` in place.
 *
 * @exports
 *   - normaliseSettingsInPlace — fill defaults and clamp values on a SproutSettings object
 */

import { DEFAULT_SETTINGS, type SproutSettings } from "../../platform/core/constants";
import { clamp, cleanPositiveNumberArray, clonePlain } from "../../platform/core/utils";
import { resolveInterfaceLocale } from "../../platform/translations/locale-registry";

/**
 * Normalise a SproutSettings object in place: fill missing keys with defaults,
 * clamp numeric ranges, and remove legacy scheduling keys.
 */
export function normaliseSettingsInPlace(s: SproutSettings): void {
  s.scheduling ??= {} as SproutSettings["scheduling"];
  s.general ??= {} as SproutSettings["general"];
  s.general.enableReadingStyles ??= DEFAULT_SETTINGS.general.enableReadingStyles;
  s.general.interfaceLanguage = resolveInterfaceLocale(
    s.general.interfaceLanguage ?? DEFAULT_SETTINGS.general.interfaceLanguage,
  );
  if (s.general.prettifyCards === "off") s.general.enableReadingStyles = false;
  s.general.pinnedDecks ??= [];
  s.general.workspaceContentZoom = clamp(
    Number(s.general.workspaceContentZoom ?? DEFAULT_SETTINGS.general.workspaceContentZoom ?? 1),
    0.8,
    1.8,
  );
  s.general.githubStars ??= { count: null, fetchedAt: null };

  s.reminders ??= {} as SproutSettings["reminders"];
  s.reminders.showOnStartup ??= DEFAULT_SETTINGS.reminders.showOnStartup;
  s.reminders.startupDelayMs = clamp(
    Number(s.reminders.startupDelayMs ?? DEFAULT_SETTINGS.reminders.startupDelayMs),
    0,
    60_000,
  );
  s.reminders.repeatEnabled ??= DEFAULT_SETTINGS.reminders.repeatEnabled;
  s.reminders.repeatIntervalMinutes = clamp(
    Number(s.reminders.repeatIntervalMinutes ?? DEFAULT_SETTINGS.reminders.repeatIntervalMinutes),
    1,
    1440,
  );
  s.reminders.gatekeeperEnabled ??= DEFAULT_SETTINGS.reminders.gatekeeperEnabled;
  s.reminders.gatekeeperOnStartup ??= DEFAULT_SETTINGS.reminders.gatekeeperOnStartup;
  s.reminders.gatekeeperIntervalMinutes = clamp(
    Number(s.reminders.gatekeeperIntervalMinutes ?? DEFAULT_SETTINGS.reminders.gatekeeperIntervalMinutes),
    1,
    1440,
  );
  s.reminders.gatekeeperDueQuestionCount = clamp(
    Number(s.reminders.gatekeeperDueQuestionCount ?? DEFAULT_SETTINGS.reminders.gatekeeperDueQuestionCount),
    1,
    200,
  );
  const gatekeeperScope = String(s.reminders.gatekeeperScope ?? DEFAULT_SETTINGS.reminders.gatekeeperScope);
  s.reminders.gatekeeperScope =
    gatekeeperScope === "workspace" || gatekeeperScope === "current-tab"
      ? gatekeeperScope
      : DEFAULT_SETTINGS.reminders.gatekeeperScope;
  s.reminders.gatekeeperPauseWhenStudying ??= DEFAULT_SETTINGS.reminders.gatekeeperPauseWhenStudying;
  s.reminders.gatekeeperAllowSkip ??= DEFAULT_SETTINGS.reminders.gatekeeperAllowSkip;
  s.reminders.gatekeeperBypassWarning ??= DEFAULT_SETTINGS.reminders.gatekeeperBypassWarning;
  s.reminders.showWhenNoDue ??= DEFAULT_SETTINGS.reminders.showWhenNoDue;
  s.reminders.message = String(s.reminders.message ?? DEFAULT_SETTINGS.reminders.message);
  const action = String(s.reminders.clickAction ?? DEFAULT_SETTINGS.reminders.clickAction);
  s.reminders.clickAction =
    action === "none" || action === "open-home" || action === "open-reviewer"
      ? action
      : DEFAULT_SETTINGS.reminders.clickAction;

  // Ensure imageOcclusion group exists (may have been deleted by an older migration)
  s.imageOcclusion ??= {} as SproutSettings["imageOcclusion"];
  s.imageOcclusion.defaultMaskMode ??= DEFAULT_SETTINGS.imageOcclusion.defaultMaskMode;
  s.imageOcclusion.revealMode ??= (
    s.imageOcclusion.defaultMaskMode === "all" ? "all" : DEFAULT_SETTINGS.imageOcclusion.revealMode
  );
  s.imageOcclusion.maskTargetColor ??= DEFAULT_SETTINGS.imageOcclusion.maskTargetColor;
  s.imageOcclusion.maskOtherColor ??= DEFAULT_SETTINGS.imageOcclusion.maskOtherColor;
  s.imageOcclusion.maskIcon ??= DEFAULT_SETTINGS.imageOcclusion.maskIcon;

  s.scheduling.learningStepsMinutes = cleanPositiveNumberArray(
    s.scheduling.learningStepsMinutes,
    DEFAULT_SETTINGS.scheduling.learningStepsMinutes,
  );

  s.scheduling.relearningStepsMinutes = cleanPositiveNumberArray(
    s.scheduling.relearningStepsMinutes,
    DEFAULT_SETTINGS.scheduling.relearningStepsMinutes,
  );

  s.scheduling.requestRetention = clamp(
    Number(s.scheduling.requestRetention ?? DEFAULT_SETTINGS.scheduling.requestRetention),
    0.8,
    0.97,
  );

  const legacyKeys = [
    "graduatingIntervalDays",
    "easyBonus",
    "hardFactor",
    "minEase",
    "maxEase",
    "easeDeltaAgain",
    "easeDeltaHard",
    "easeDeltaEasy",
  ];
  for (const k of legacyKeys) {
    if (k in s.scheduling) delete (s.scheduling as Record<string, unknown>)[k];
  }

  s.readingView ??= clonePlain(DEFAULT_SETTINGS.readingView);
  const rv = s.readingView;

  const toMacro = (raw: unknown): SproutSettings["readingView"]["activeMacro"] => {
    const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (key === "minimal-flip") return "flashcards";
    if (key === "full-card") return "classic";
    if (key === "compact") return "markdown";
    if (key === "flashcards" || key === "classic" || key === "guidebook" || key === "markdown" || key === "custom") return key;
    return "flashcards";
  };

  rv.activeMacro = toMacro(rv.activeMacro ?? rv.preset);
  rv.preset = rv.activeMacro;

  const defaultMacroConfigs = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs);
  rv.macroConfigs ??= defaultMacroConfigs;
  rv.macroConfigs.flashcards ??= defaultMacroConfigs.flashcards;
  rv.macroConfigs.classic ??= defaultMacroConfigs.classic;
  rv.macroConfigs.guidebook ??= defaultMacroConfigs.guidebook;
  rv.macroConfigs.markdown ??= defaultMacroConfigs.markdown;
  rv.macroConfigs.custom ??= defaultMacroConfigs.custom;

  const normaliseFields = (
    fields: Partial<SproutSettings["readingView"]["macroConfigs"]["classic"]["fields"]> | undefined,
    fallback: SproutSettings["readingView"]["macroConfigs"]["classic"]["fields"],
  ): SproutSettings["readingView"]["macroConfigs"]["classic"]["fields"] => ({
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

  rv.macroConfigs.flashcards.fields = normaliseFields(rv.macroConfigs.flashcards.fields, defaultMacroConfigs.flashcards.fields);
  rv.macroConfigs.classic.fields = normaliseFields(rv.macroConfigs.classic.fields, defaultMacroConfigs.classic.fields);
  rv.macroConfigs.guidebook.fields = normaliseFields(rv.macroConfigs.guidebook.fields, defaultMacroConfigs.guidebook.fields);
  rv.macroConfigs.markdown.fields = normaliseFields(rv.macroConfigs.markdown.fields, defaultMacroConfigs.markdown.fields);
  rv.macroConfigs.markdown.fields.edit = false;
  rv.macroConfigs.markdown.fields.displayEditButton = false;
  rv.macroConfigs.custom.fields = normaliseFields(rv.macroConfigs.custom.fields, defaultMacroConfigs.custom.fields);

  const normaliseColours = (
    colours: Partial<SproutSettings["readingView"]["macroConfigs"]["classic"]["colours"]> | undefined,
    fallback: SproutSettings["readingView"]["macroConfigs"]["classic"]["colours"],
  ): SproutSettings["readingView"]["macroConfigs"]["classic"]["colours"] => ({
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

  rv.macroConfigs.flashcards.colours = normaliseColours(rv.macroConfigs.flashcards.colours, defaultMacroConfigs.flashcards.colours);
  rv.macroConfigs.classic.colours = normaliseColours(rv.macroConfigs.classic.colours, defaultMacroConfigs.classic.colours);
  rv.macroConfigs.guidebook.colours = normaliseColours(rv.macroConfigs.guidebook.colours, defaultMacroConfigs.guidebook.colours);
  rv.macroConfigs.markdown.colours = normaliseColours(rv.macroConfigs.markdown.colours, defaultMacroConfigs.markdown.colours);
  rv.macroConfigs.custom.colours = normaliseColours(rv.macroConfigs.custom.colours, defaultMacroConfigs.custom.colours);
  rv.macroConfigs.custom.customCss ??= defaultMacroConfigs.custom.customCss;

  rv.visibleFields ??= {
    title: rv.macroConfigs[rv.activeMacro].fields.title,
    question: rv.macroConfigs[rv.activeMacro].fields.question,
    options: rv.macroConfigs[rv.activeMacro].fields.options,
    answer: rv.macroConfigs[rv.activeMacro].fields.answer,
    info: rv.macroConfigs[rv.activeMacro].fields.info,
    groups: rv.macroConfigs[rv.activeMacro].fields.groups,
    edit: rv.macroConfigs[rv.activeMacro].fields.edit,
  };
  rv.displayLabels ??= rv.macroConfigs[rv.activeMacro].fields.labels;

  s.storage ??= {} as SproutSettings["storage"];
  s.storage.backups ??= clonePlain(DEFAULT_SETTINGS.storage.backups);
  s.storage.backups.recentCount = clamp(
    Number(s.storage.backups.recentCount ?? DEFAULT_SETTINGS.storage.backups.recentCount),
    0,
    100,
  );
  s.storage.backups.dailyCount = clamp(
    Number(s.storage.backups.dailyCount ?? DEFAULT_SETTINGS.storage.backups.dailyCount),
    0,
    100,
  );
  s.storage.backups.weeklyCount = clamp(
    Number(s.storage.backups.weeklyCount ?? DEFAULT_SETTINGS.storage.backups.weeklyCount),
    0,
    100,
  );
  s.storage.backups.monthlyCount = clamp(
    Number(s.storage.backups.monthlyCount ?? DEFAULT_SETTINGS.storage.backups.monthlyCount),
    0,
    100,
  );
  s.storage.backups.recentIntervalHours = clamp(
    Number(s.storage.backups.recentIntervalHours ?? DEFAULT_SETTINGS.storage.backups.recentIntervalHours),
    1,
    168,
  );
  s.storage.backups.dailyIntervalDays = clamp(
    Number(s.storage.backups.dailyIntervalDays ?? DEFAULT_SETTINGS.storage.backups.dailyIntervalDays),
    1,
    365,
  );
  s.storage.backups.weeklyIntervalDays = clamp(
    Number(s.storage.backups.weeklyIntervalDays ?? DEFAULT_SETTINGS.storage.backups.weeklyIntervalDays),
    1,
    365,
  );
  s.storage.backups.monthlyIntervalDays = clamp(
    Number(s.storage.backups.monthlyIntervalDays ?? DEFAULT_SETTINGS.storage.backups.monthlyIntervalDays),
    1,
    730,
  );
  s.storage.backups.maxTotalSizeMb = clamp(
    Number(s.storage.backups.maxTotalSizeMb ?? DEFAULT_SETTINGS.storage.backups.maxTotalSizeMb),
    25,
    5000,
  );

  if (!s.general.enableReadingStyles) s.general.prettifyCards = "off";
  else if (!s.general.prettifyCards || s.general.prettifyCards === "off") s.general.prettifyCards = "accent";
}
