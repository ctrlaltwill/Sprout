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
    githubStars: {
      count: null,
      fetchedAt: null,
    },
    enableAnimations: true,
    prettifyCards: "accent", // default to 'accent', options: 'accent' | 'theme'
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
    randomizeMcqOptions: false,

    treatFolderNotesAsDecks: true,
  },

  // Reasonable “Balanced” defaults matching your UI copy
  scheduling: {
    learningStepsMinutes: [10, 1440],
    relearningStepsMinutes: [10],
    requestRetention: 0.9,
  },

  indexing: {
    ignoreInCodeFences: true,
    idPlacement: "above",
  },

  storage: {
    imageOcclusionFolderPath: "Attachments/Image Occlusion/",
    deleteOrphanedImages: true,
    cardAttachmentFolderPath: "Attachments/Cards/",
  },
};
