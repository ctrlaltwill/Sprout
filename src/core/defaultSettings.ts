// src/defaultSettings.ts
// ---------------------------------------------------------------------------
// Default plugin settings — provides the SproutSettings type (re-exported
// from types/settings.ts) and the DEFAULT_SETTINGS constant used to seed a
// fresh installation or reset to factory defaults.
// ---------------------------------------------------------------------------

// Re-export the type so existing `import { SproutSettings } from "./defaultSettings"` still works
export type { SproutSettings } from "../types/settings";
import type { SproutSettings } from "../types/settings";

/** Factory-default values for every plugin setting. */
export const DEFAULT_SETTINGS: SproutSettings = {

  reviewer: {
    showInfoByDefault: false,

    dailyNewLimit: 20,
    dailyReviewLimit: 200,

    // DEFAULTS requested:
    autoAdvanceEnabled: false,
    autoAdvanceSeconds: 60,

    // DEFAULT = two-button
    fourButtonMode: false,

    enableSkipButton: false,
    randomizeMcqOptions: false,
  },

  widget: {
    treatFolderNotesAsDecks: true,
  },

  // Reasonable “Balanced” defaults matching your UI copy
  scheduler: {
    learningStepsMinutes: [10, 1440],
    relearningStepsMinutes: [10],
    requestRetention: 0.9,
  },

  indexing: {
    ignoreInCodeFences: true,
    idPlacement: "above",
  },

  imageOcclusion: {
    attachmentFolderPath: "Attachments/Image Occlusion/",
    deleteOrphanedImages: true,
  },

  cardAttachments: {
    attachmentFolderPath: "Attachments/Cards/",
  },

  home: {
    pinnedDecks: [],
    githubStars: {
      count: null,
      fetchedAt: null,
    },
  },

  appearance: {
     enableAnimations: true,
     prettifyCards: "accent", // default to 'accent', options: 'accent' | 'theme'
  },
};
