// src/types/settings.ts
// ---------------------------------------------------------------------------
// Plugin settings type — the shape of user-configurable preferences.
// The DEFAULT_SETTINGS object lives in defaultSettings.ts; only the
// *type* is defined here so it can be imported without pulling in values.
// ---------------------------------------------------------------------------

/**
 * Full settings structure for the Sprout plugin.
 * Each top-level key groups settings by feature area.
 */
export type SproutSettings = {
  reviewer: {
    /** Whether the Info field is expanded by default on the card back. */
    showInfoByDefault: boolean;

    /** Maximum new cards introduced per day. */
    dailyNewLimit: number;
    /** Maximum review cards shown per day. */
    dailyReviewLimit: number;

    /** Whether auto-advance is active after revealing the answer. */
    autoAdvanceEnabled: boolean;
    /** Seconds to wait before auto-advancing (when enabled). */
    autoAdvanceSeconds: number;

    /** true = Again/Hard/Good/Easy; false = Pass/Fail two-button mode. */
    fourButtonMode: boolean;

    enableSkipButton: boolean;
    randomizeMcqOptions: boolean;
  };

  widget: {
    /** Treat folder notes (same name as parent folder) as deck roots. */
    treatFolderNotesAsDecks: boolean;
  };

  scheduler: {
    learningStepsMinutes: number[];
    relearningStepsMinutes: number[];
    /** Target recall probability (0.80 – 0.97). */
    requestRetention: number;
  };

  indexing: {
    /** Skip flashcard markers inside fenced code blocks. */
    ignoreInCodeFences: boolean;
    /** Place the ^sprout-ID anchor above or below the card block. */
    idPlacement: "above" | "below";
  };

  imageOcclusion: {
    /** Vault-relative folder path for IO mask images. */
    attachmentFolderPath: string;
    /** Delete orphaned mask images when their IO cards are removed. */
    deleteOrphanedImages: boolean;
  };

  cardAttachments: {
    /** Vault-relative folder path for images pasted into Q/A/Info fields. */
    attachmentFolderPath: string;
  };

  home: {
    userName: string;
    showGreeting: boolean;
    hideSproutInfo: boolean;
    hasOpenedHome: boolean;
    pinnedDecks: string[];
    githubStars: {
      count: number | null;
      fetchedAt: number | null;
    };
  };

  appearance: {
    enableAnimations: boolean;
    /** "accent" uses theme accent colour; "theme" uses background/text alt colours. */
    prettifyCards: string;
  };
};
