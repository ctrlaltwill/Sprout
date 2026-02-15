/**
 * @file src/core/default-settings.ts
 * @summary Provides the factory-default values for every Sprout plugin setting. Re-exports
 * the SproutSettings type from src/types/settings.ts so downstream code can import both
 * the type and the defaults from one location. Used to seed fresh installations and to
 * reset settings to factory defaults.
 *
 * @exports
 *   - SproutSettings (re-exported type) — full plugin settings shape
 *   - DEFAULT_SETTINGS — constant object with factory-default values for all settings
 */

// Re-export the type so existing `import { SproutSettings } from "./default-settings"` still works
export type { SproutSettings } from "../types/settings";
import type { SproutSettings } from "../types/settings";

/** Factory-default values for every plugin setting. */
export const DEFAULT_SETTINGS: SproutSettings = {

  general: {
    userName: "",
    showGreeting: true,
    hideSproutInfo: false,
    hasOpenedHome: false,
    pinnedDecks: [],
    workspaceContentZoom: 1,
    githubStars: {
      count: null,
      fetchedAt: null,
    },
    enableAnimations: true,
    enableReadingStyles: true,
    prettifyCards: "accent", // default to 'accent', options: 'off' | 'accent' | 'theme'
  },

  study: {
    showInfoByDefault: false,

    dailyNewLimit: 20,
    dailyReviewLimit: 200,

    autoAdvanceEnabled: false,
    autoAdvanceSeconds: 60,

    // DEFAULT = two-button
    fourButtonMode: false,

    enableSkipButton: false,
    randomizeMcqOptions: true,
    randomizeOqOrder: true,

    siblingMode: "standard" as const,

    treatFolderNotesAsDecks: true,
  },

  // Reasonable “Balanced” defaults matching your UI copy
  scheduling: {
    learningStepsMinutes: [10, 1440],
    relearningStepsMinutes: [10],
    requestRetention: 0.9,
  },

  cards: {
    clozeMode: "standard",
    clozeBgColor: "",
    clozeTextColor: "",
  },

  indexing: {
    ignoreInCodeFences: true,
    idPlacement: "above",
    delimiter: "|",
  },

  imageOcclusion: {
    defaultMaskMode: "solo",
    maskTargetColor: "",
    maskOtherColor: "",
    maskIcon: "circle-help",
  },

  readingView: {
    preset: "flashcards",
    advancedEnabled: false,
    layout: "masonry",
    cardMode: "flip",
    visibleFields: {
      title: true,
      question: true,
      options: false,
      answer: true,
      info: false,
      groups: true,
      edit: true,
    },
    displayLabels: true,
    cardBgLight: "",
    cardBgDark: "",
    cardBorderLight: "",
    cardBorderDark: "",
    cardAccentLight: "",
    cardAccentDark: "",
    fontSize: 0.9,
    activeMacro: "flashcards",
    macroConfigs: {
      flashcards: {
        fields: {
          title: false,
          question: true,
          options: false,
          answer: true,
          info: false,
          groups: false,
          edit: false,
          labels: false,
        },
      },
      classic: {
        fields: {
          title: true,
          question: true,
          options: true,
          answer: true,
          info: true,
          groups: true,
          edit: true,
          labels: true,
        },
        colours: {
          cardBgLight: "",
          cardBgDark: "",
          cardBorderLight: "",
          cardBorderDark: "",
          cardAccentLight: "",
          cardAccentDark: "",
        },
      },
      guidebook: {
        fields: {
          title: true,
          question: true,
          options: true,
          answer: true,
          info: true,
          groups: true,
          edit: true,
          labels: true,
        },
        colours: {
          cardBgLight: "",
          cardBgDark: "",
          cardBorderLight: "",
          cardBorderDark: "",
          cardAccentLight: "",
          cardAccentDark: "",
        },
      },
      markdown: {
        fields: {
          title: false,
          question: true,
          options: true,
          answer: true,
          info: true,
          groups: true,
          edit: false,
          labels: true,
        },
        colours: {
          cardBgLight: "",
          cardBgDark: "",
          cardBorderLight: "",
          cardBorderDark: "",
          cardAccentLight: "",
          cardAccentDark: "",
        },
      },
      custom: {
        fields: {
          title: true,
          question: true,
          options: true,
          answer: true,
          info: true,
          groups: true,
          edit: true,
          labels: true,
        },
        colours: {
          cardBgLight: "",
          cardBgDark: "",
          cardBorderLight: "",
          cardBorderDark: "",
          cardAccentLight: "",
          cardAccentDark: "",
        },
        customCss: "",
      },
    },
  },

  storage: {
    imageOcclusionFolderPath: "Attachments/Image Occlusion/",
    deleteOrphanedImages: true,
    cardAttachmentFolderPath: "Attachments/Cards/",
  },

  audio: {
    enabled: false,
    autoplay: true,
    limitToGroup: "",
    basicFront: false,
    basicBack: false,
    clozeFront: false,
    clozeRevealed: false,
    clozeAnswerMode: "cloze-only" as const,
    defaultLanguage: "en-US",
    autoDetectLanguage: true,
    scriptLanguages: {
      cyrillic: "ru-RU",
      arabic: "ar-SA",
      cjk: "zh-CN",
      devanagari: "hi-IN",
    },
    rate: 1.0,
    pitch: 1.0,
    preferredVoiceURI: "",
  },
};
