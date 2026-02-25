/**
 * @file src/types/settings.ts
 * @summary Plugin settings type definition. Describes the full shape of user-configurable
 * preferences grouped by feature area (general, study, scheduling, indexing, storage).
 * Only the type is defined here; the DEFAULT_SETTINGS constant lives in
 * src/core/default-settings.ts.
 *
 * @exports
 *   - SproutSettings — type describing the complete plugin settings structure
 */

/**
 * Full settings structure for the Sprout plugin.
 * Each top-level key groups settings by feature area.
 */
export type SproutSettings = {
  // General — user identity, greeting, appearance
  general: {
    userName: string;
    showGreeting: boolean;
    hasOpenedHome: boolean;
    pinnedDecks: string[];
    /** Sprout-scoped zoom level (only Sprout leaves + widget). 1.0 = 100%. */
    workspaceContentZoom: number;
    githubStars: {
      count: number | null;
      fetchedAt: number | null;
    };
    enableAnimations: boolean;
    /** Master switch for Sprout card styling in Reading View. false = native Obsidian rendering. */
    enableReadingStyles: boolean;
    /** "off" disables card styling; "accent" uses theme accent colour; "theme" uses background/text alt colours. */
    prettifyCards: string;
  };

  // Study — reviewer behaviour, limits, deck scope
  study: {
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
    randomizeOqOrder: boolean;

    /**
     * How sibling child cards (from the same parent note) are handled during a session.
     * - "standard"  — no special sibling logic; cards appear in natural order
     * - "disperse"  — siblings are spread evenly across the queue at session build time
     * - "bury"      — only one sibling per parent is shown; the rest are buried until tomorrow
     */
    siblingMode: "standard" | "disperse" | "bury";

    /** Treat folder notes (same name as parent folder) as deck roots. */
    treatFolderNotesAsDecks: boolean;
  };

  // Scheduling — FSRS algorithm parameters
  scheduling: {
    learningStepsMinutes: number[];
    relearningStepsMinutes: number[];
    /** Target recall probability (0.80 – 0.97). */
    requestRetention: number;
  };

  // Indexing — card detection & anchor placement
  indexing: {
    /** Skip flashcard markers inside fenced code blocks. */
    ignoreInCodeFences: boolean;
    /** Place the ^sprout-ID anchor above or below the card block. */
    idPlacement: "above" | "below";
    /**
     * The character used to delimit card fields.
     * Default is `|` (pipe). Advanced users may change this to avoid conflicts
     * with LaTeX, Markdown tables, or code blocks.
     *
     * **Warning:** changing this does NOT convert existing cards. Cards written
     * with the previous delimiter will no longer be parsed and their scheduling
     * data will be lost on the next sync.
     */
    delimiter: "|" | "@" | "~" | ";";
  };

  // Cards — card-type-specific settings
  cards: {
    /** Cloze mode: "standard" shows normal blanks; "typed" shows a text input. */
    clozeMode: "standard" | "typed";
    /** Custom background colour for revealed cloze pills (standard mode only). */
    clozeBgColor: string;
    /** Custom text colour for revealed cloze pills (standard mode only). */
    clozeTextColor: string;
  };

  // Image Occlusion — mask appearance and behavior
  imageOcclusion: {
    /** Default mask mode when creating new IO cards: "solo" (hide one) or "all" (hide all). */
    defaultMaskMode: "solo" | "all";
    /** Back-side reveal behavior for IO cards using Hide all mode. */
    revealMode: "group" | "all";
    /** Background color for the target (active) mask. */
    maskTargetColor: string;
    /** Background color for other (context) masks. */
    maskOtherColor: string;
    /** Icon/text shown on the target mask (e.g., "?"). Leave empty for no icon. */
    maskIcon: string;
  };

  // Reading View — card appearance in reading/preview mode
  readingView: {
    /**
     * Macro style preset. Presets override individual settings below.
     * "custom" means the user has manually configured values.
     */
    preset: "classic" | "guidebook" | "flashcards" | "markdown" | "custom";

    /** Whether advanced style controls are shown/enabled in settings. */
    advancedEnabled: boolean;

    /** Layout mode: masonry (CSS multi-column) or vertical (single column). */
    layout: "masonry" | "vertical";

    /** Card display mode: "full" shows all fields expanded; "flip" shows Q with collapsible A. */
    cardMode: "full" | "flip";

    /** Which fields are visible on full cards (only applies when cardMode is "full"). */
    visibleFields: {
      title: boolean;
      question: boolean;
      options: boolean;
      answer: boolean;
      info: boolean;
      groups: boolean;
      edit: boolean;
    };

    /** Whether section labels (Question/Answer/Info) are shown. */
    displayLabels: boolean;

    /** Card background color (light theme). Empty string = use theme default. */
    cardBgLight: string;
    /** Card background color (dark theme). Empty string = auto-derived from light. */
    cardBgDark: string;
    /** Card border color (light theme). Empty string = use theme default. */
    cardBorderLight: string;
    /** Card border color (dark theme). Empty string = auto-derived from light. */
    cardBorderDark: string;
    /** Card title/accent text color (light theme). Empty string = use theme default. */
    cardAccentLight: string;
    /** Card title/accent text color (dark theme). Empty string = auto-derived from light. */
    cardAccentDark: string;

    /** Font size for section content in rem. Defaults to 0.9. */
    fontSize: number;

    /** Active reading macro style. */
    activeMacro: "flashcards" | "classic" | "guidebook" | "markdown" | "custom";

    /** Per-macro field visibility and colour customisation. */
    macroConfigs: {
      flashcards: {
        fields: {
          title: boolean;
          question: boolean;
          options: boolean;
          answer: boolean;
          info: boolean;
          groups: boolean;
          edit: boolean;
          labels: boolean;
          displayAudioButton: boolean;
          displayEditButton: boolean;
        };
        colours: {
          autoDarkAdjust: boolean;
          cardBgLight: string;
          cardBgDark: string;
          cardBorderLight: string;
          cardBorderDark: string;
          cardAccentLight: string;
          cardAccentDark: string;
          cardTextLight: string;
          cardTextDark: string;
          cardMutedLight: string;
          cardMutedDark: string;
          clozeBgLight: string;
          clozeTextLight: string;
          clozeBgDark: string;
          clozeTextDark: string;
        };
      };
      classic: {
        fields: {
          title: boolean;
          question: boolean;
          options: boolean;
          answer: boolean;
          info: boolean;
          groups: boolean;
          edit: boolean;
          labels: boolean;
          displayAudioButton: boolean;
          displayEditButton: boolean;
        };
        colours: {
          autoDarkAdjust: boolean;
          cardBgLight: string;
          cardBgDark: string;
          cardBorderLight: string;
          cardBorderDark: string;
          cardAccentLight: string;
          cardAccentDark: string;
          cardTextLight: string;
          cardTextDark: string;
          cardMutedLight: string;
          cardMutedDark: string;
          clozeBgLight: string;
          clozeTextLight: string;
          clozeBgDark: string;
          clozeTextDark: string;
        };
      };
      guidebook: {
        fields: {
          title: boolean;
          question: boolean;
          options: boolean;
          answer: boolean;
          info: boolean;
          groups: boolean;
          edit: boolean;
          labels: boolean;
          displayAudioButton: boolean;
          displayEditButton: boolean;
        };
        colours: {
          autoDarkAdjust: boolean;
          cardBgLight: string;
          cardBgDark: string;
          cardBorderLight: string;
          cardBorderDark: string;
          cardAccentLight: string;
          cardAccentDark: string;
          cardTextLight: string;
          cardTextDark: string;
          cardMutedLight: string;
          cardMutedDark: string;
          clozeBgLight: string;
          clozeTextLight: string;
          clozeBgDark: string;
          clozeTextDark: string;
        };
      };
      markdown: {
        fields: {
          title: boolean;
          question: boolean;
          options: boolean;
          answer: boolean;
          info: boolean;
          groups: boolean;
          edit: boolean;
          labels: boolean;
          displayAudioButton: boolean;
          displayEditButton: boolean;
        };
        colours: {
          autoDarkAdjust: boolean;
          cardBgLight: string;
          cardBgDark: string;
          cardBorderLight: string;
          cardBorderDark: string;
          cardAccentLight: string;
          cardAccentDark: string;
          cardTextLight: string;
          cardTextDark: string;
          cardMutedLight: string;
          cardMutedDark: string;
          clozeBgLight: string;
          clozeTextLight: string;
          clozeBgDark: string;
          clozeTextDark: string;
        };
      };
      custom: {
        fields: {
          title: boolean;
          question: boolean;
          options: boolean;
          answer: boolean;
          info: boolean;
          groups: boolean;
          edit: boolean;
          labels: boolean;
          displayAudioButton: boolean;
          displayEditButton: boolean;
        };
        colours: {
          autoDarkAdjust: boolean;
          cardBgLight: string;
          cardBgDark: string;
          cardBorderLight: string;
          cardBorderDark: string;
          cardAccentLight: string;
          cardAccentDark: string;
          cardTextLight: string;
          cardTextDark: string;
          cardMutedLight: string;
          cardMutedDark: string;
          clozeBgLight: string;
          clozeTextLight: string;
          clozeBgDark: string;
          clozeTextDark: string;
        };
        /** User-authored CSS injected only when custom macro is active in reading view. */
        customCss: string;
      };
    };

  };

  // Storage — attachment folder paths & cleanup
  storage: {
    /** Vault-relative folder path for IO mask images. */
    imageOcclusionFolderPath: string;
    /** Delete orphaned mask images when their IO cards are removed. */
    deleteOrphanedImages: boolean;
    /** Vault-relative folder path for images pasted into Q/A/Info fields. */
    cardAttachmentFolderPath: string;
  };

  // Audio — text-to-speech settings for card review
  audio: {
    /** Master switch — when false, all TTS is disabled regardless of per-card-type toggles. */
    enabled: boolean;
    /**
     * When true, cards are read aloud automatically when presented/revealed.
     * When false, TTS is only triggered via the replay button on the card.
     */
    autoplay: boolean;
    /**
     * When non-empty, only cards whose `groups` array includes this value (case-insensitive)
     * will be read aloud. Untagged cards and cards with other groups are silently skipped.
     * When empty (""), all cards are eligible for TTS based on the per-card-type toggles below.
     */
    limitToGroup: string;
    /** Read aloud the front (question) of basic cards. */
    basicFront: boolean;
    /** Read aloud the back (answer) of basic cards. */
    basicBack: boolean;
    /** Read aloud the front of cloze cards (with blanks spoken as "blank" in the default language). */
    clozeFront: boolean;
    /** Read aloud the revealed cloze answer. */
    clozeRevealed: boolean;
    /**
     * What to read aloud when a cloze answer is revealed:
     * - "cloze-only"  — speak just the cloze deletion text (e.g. "mitochondria")
     * - "full-sentence" — speak the whole sentence with the blank filled in
     */
    clozeAnswerMode: "cloze-only" | "full-sentence";
    /**
     * The user's native / default language (BCP-47 tag, e.g. "en-US").
     * Used for the "blank" word in cloze fronts and as TTS fallback.
     */
    defaultLanguage: string;
    /**
     * Automatically detect the card content language from script analysis
     * and select a matching system voice. Falls back to defaultLanguage.
     * @deprecated Kept for backward compatibility — script detection is now always on.
     */
    autoDetectLanguage: boolean;
    /**
     * Per-script language preferences for non-Latin writing systems.
     * Some scripts (Cyrillic, Arabic, CJK, Devanagari) can represent multiple
     * languages. These settings let the user choose the correct language for each.
     * Unambiguous scripts (Japanese kana, Korean Hangul, Thai, etc.) are detected
     * automatically and do not need a user preference.
     */
    scriptLanguages: {
      /** Language for Cyrillic text (Russian, Ukrainian, Bulgarian, Serbian, etc.) */
      cyrillic: string;
      /** Language for Arabic-script text (Arabic, Persian/Farsi, Urdu, etc.) */
      arabic: string;
      /** Language for CJK ideographs when no Japanese kana is present (Simplified / Traditional Chinese) */
      cjk: string;
      /** Language for Devanagari-script text (Hindi, Marathi, Nepali, etc.) */
      devanagari: string;
    };
    /** Speech rate (0.5 – 2.0, default 1.0). */
    rate: number;
    /** Speech pitch (0.5 – 2.0, default 1.0). */
    pitch: number;
    /**
     * The `voiceURI` of the user’s preferred TTS voice. When set (non-empty),
     * this voice is used for the default language instead of auto-selection.
     * Set to "" (auto) to let the scoring algorithm pick the best voice.
     */
    preferredVoiceURI: string;
  };
};
