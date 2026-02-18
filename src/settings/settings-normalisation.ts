/**
 * @file src/settings/settings-normalisation.ts
 * @summary Normalises (validates/defaults) SproutSettings fields after loading or migration.
 * Ensures every expected key exists, clamps numeric values, and fills in missing macro
 * configs. Mutates `settings` in place.
 *
 * @exports
 *   - normaliseSettingsInPlace — fill defaults and clamp values on a SproutSettings object
 */

import { DEFAULT_SETTINGS, type SproutSettings } from "../core/constants";
import { clamp, cleanPositiveNumberArray, clonePlain } from "../core/utils";

/**
 * Normalise a SproutSettings object in place: fill missing keys with defaults,
 * clamp numeric ranges, and remove legacy scheduling keys.
 */
export function normaliseSettingsInPlace(s: SproutSettings): void {
  s.scheduling ??= {} as SproutSettings["scheduling"];
  s.general ??= {} as SproutSettings["general"];
  s.general.enableReadingStyles ??= DEFAULT_SETTINGS.general.enableReadingStyles;
  if (s.general.prettifyCards === "off") s.general.enableReadingStyles = false;
  s.general.pinnedDecks ??= [];
  s.general.workspaceContentZoom = clamp(
    Number(s.general.workspaceContentZoom ?? DEFAULT_SETTINGS.general.workspaceContentZoom ?? 1),
    0.8,
    1.8,
  );
  s.general.githubStars ??= { count: null, fetchedAt: null };

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

  if (!s.general.enableReadingStyles) s.general.prettifyCards = "off";
  else if (!s.general.prettifyCards || s.general.prettifyCards === "off") s.general.prettifyCards = "accent";
}
