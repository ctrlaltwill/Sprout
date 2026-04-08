/**
 * @file src/views/settings/config/reading-presets.ts
 * @summary Module for reading presets.
 *
 * @exports
 *  - ReadingPreviewMacroPresetKey
 *  - ReadingPreviewMacroPreset
 *  - PREVIEW_MACRO_PRESETS
 *  - CUSTOM_CLASSIC_STARTER_CSS
 */

export type ReadingPreviewMacroPresetKey = "flashcards" | "classic" | "markdown" | "custom";

export type ReadingPreviewMacroPreset = {
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
};

export const PREVIEW_MACRO_PRESETS: Record<ReadingPreviewMacroPresetKey, ReadingPreviewMacroPreset> = {
  flashcards: {
    labelKey: "ui.settings.reading.presets.flashcards.label",
    descKey: "ui.settings.reading.presets.flashcards.desc",
    layout: "masonry",
    cardMode: "flip",
    visibleFields: { title: false, question: true, options: false, answer: true, info: false, groups: false, edit: false, displayAudioButton: true, displayEditButton: true },
    displayLabels: false,
  },
  classic: {
    labelKey: "ui.settings.reading.presets.classic.label",
    descKey: "ui.settings.reading.presets.classic.desc",
    layout: "masonry",
    cardMode: "flip",
    visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true, displayAudioButton: true, displayEditButton: true },
    displayLabels: true,
  },
  markdown: {
    labelKey: "ui.settings.reading.presets.markdown.label",
    descKey: "ui.settings.reading.presets.markdown.desc",
    layout: "vertical",
    cardMode: "full",
    visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: false, displayAudioButton: true, displayEditButton: false },
    displayLabels: true,
  },
  custom: {
    labelKey: "ui.settings.reading.presets.custom.label",
    descKey: "ui.settings.reading.presets.custom.desc",
    layout: "masonry",
    cardMode: "full",
    visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true, displayAudioButton: true, displayEditButton: true },
    displayLabels: true,
  },
};

export const CUSTOM_CLASSIC_STARTER_CSS = `.learnkit-pretty-card.learnkit-macro-custom .learnkit-custom-body {
  border: 0.5px solid var(--background-modifier-border);
  border-radius: var(--radius-md);
  padding: 14px;
  background: var(--background-primary);
}

.learnkit-pretty-card.learnkit-macro-custom .learnkit-custom-section {
  margin-bottom: 10px;
}

.learnkit-pretty-card.learnkit-macro-custom .learnkit-custom-label {
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--learnkit-font-2xs);
  color: var(--text-muted);
  font-weight: 600;
}

.learnkit-pretty-card.learnkit-macro-custom .learnkit-custom-section-answer,
.learnkit-pretty-card.learnkit-macro-custom .learnkit-custom-section-info,
.learnkit-pretty-card.learnkit-macro-custom .learnkit-custom-section-groups {
  border-top: 1px dashed var(--background-modifier-border);
  padding-top: 8px;
}`;
