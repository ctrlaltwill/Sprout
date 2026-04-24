/**
 * @file src/core/constants.ts
 * @summary Central constants and shared utilities for the LearnKit plugin. Defines view-type
 * identifiers, branding, layout dimensions, z-index tokens, timing values, and animation
 * defaults. Also re-exports the LearnKitSettings type and DEFAULT_SETTINGS from
 * default-settings.ts and provides a generic deepMerge utility used for settings hydration.
 *
 * @exports
 *   - VIEW_TYPE_REVIEWER — view type string for the reviewer view
 *   - VIEW_TYPE_WIDGET — view type string for the sidebar widget
 *   - VIEW_TYPE_BROWSER — view type string for the card browser view
 *   - VIEW_TYPE_ANALYTICS — view type string for the analytics view
 *   - VIEW_TYPE_HOME — view type string for the home view
 *   - MAX_CONTENT_WIDTH — max content width in normal mode (px number)
 *   - MAX_CONTENT_WIDTH_PX — MAX_CONTENT_WIDTH as a CSS px string
 *   - POPOVER_Z_INDEX — z-index string for popovers and overlays
 *   - MS_DAY — milliseconds in one day
 *   - AOS_DURATION — default AOS animation duration in ms
 *   - AOS_CASCADE_STEP — cascade step between staggered AOS items in ms
 *   - LearnKitSettings (re-exported type) — full plugin settings shape
 *   - SproutSettings (re-exported alias) — compatibility type alias
 *   - DEFAULT_SETTINGS (re-exported) — factory-default settings object
 *   - deepMerge — recursively merge a partial object into a target
 */
export const VIEW_TYPE_REVIEWER = "learnkit-reviewer";
export const VIEW_TYPE_WIDGET = "learnkit-widget";
export const VIEW_TYPE_STUDY_ASSISTANT = "learnkit-study-assistant";
export const VIEW_TYPE_BROWSER = "learnkit-browser";
export const VIEW_TYPE_NOTE_REVIEW = "learnkit-note-review";
export const VIEW_TYPE_ANALYTICS = "learnkit-analytics";
export const VIEW_TYPE_HOME = "learnkit-home";
export const VIEW_TYPE_SETTINGS = "learnkit-settings";
export const VIEW_TYPE_EXAM_GENERATOR = "learnkit-exam-generator";
export const VIEW_TYPE_COACH = "learnkit-coach";
export const LEGACY_VIEW_TYPE_REVIEWER = "sprout-reviewer";
export const LEGACY_VIEW_TYPE_WIDGET = "sprout-widget";
export const LEGACY_VIEW_TYPE_STUDY_ASSISTANT = "sprout-study-assistant";
export const LEGACY_VIEW_TYPE_BROWSER = "sprout-browser";
export const LEGACY_VIEW_TYPE_ANALYTICS = "sprout-analytics";
export const LEGACY_VIEW_TYPE_HOME = "sprout-home";
export const LEGACY_VIEW_TYPE_SETTINGS = "sprout-settings";
export const LEGACY_VIEW_TYPE_EXAM_GENERATOR = "sprout-exam-generator";
export const LEGACY_VIEW_TYPE_COACH = "sprout-coach";
export const LEGACY_TO_CURRENT_VIEW_TYPES = {
    [LEGACY_VIEW_TYPE_REVIEWER]: VIEW_TYPE_REVIEWER,
    [LEGACY_VIEW_TYPE_WIDGET]: VIEW_TYPE_WIDGET,
    [LEGACY_VIEW_TYPE_STUDY_ASSISTANT]: VIEW_TYPE_STUDY_ASSISTANT,
    [LEGACY_VIEW_TYPE_BROWSER]: VIEW_TYPE_BROWSER,
    [LEGACY_VIEW_TYPE_ANALYTICS]: VIEW_TYPE_ANALYTICS,
    [LEGACY_VIEW_TYPE_HOME]: VIEW_TYPE_HOME,
    [LEGACY_VIEW_TYPE_SETTINGS]: VIEW_TYPE_SETTINGS,
    [LEGACY_VIEW_TYPE_EXAM_GENERATOR]: VIEW_TYPE_EXAM_GENERATOR,
    [LEGACY_VIEW_TYPE_COACH]: VIEW_TYPE_COACH,
};
export const BRAND = "LearnKit";
// ── Layout ──────────────────────────────────────────────────────────
/** Max content width in normal (non-wide) mode. */
export const MAX_CONTENT_WIDTH = 1280;
export const MAX_CONTENT_WIDTH_PX = `${MAX_CONTENT_WIDTH}px`;
// ── Z-index ─────────────────────────────────────────────────────────
/** Z-index for popovers, dropdown menus, and overlay panels. */
export const POPOVER_Z_INDEX = "999999";
// ── Time ────────────────────────────────────────────────────────────
/** Milliseconds in one day (24 × 60 × 60 × 1000). */
export const MS_DAY = 24 * 60 * 60 * 1000;
// ── Animation ───────────────────────────────────────────────────────
/** Default AOS fade-in duration in ms. */
export const AOS_DURATION = 600;
/** Cascade step between staggered AOS items in ms. */
export const AOS_CASCADE_STEP = 120;
export { DEFAULT_SETTINGS } from "./default-settings";
export function deepMerge(target, src) {
    const out = Array.isArray(target)
        ? target.slice()
        : { ...target };
    for (const k of Object.keys(src || {})) {
        const v = src[k];
        if (v && typeof v === "object" && !Array.isArray(v))
            out[k] = deepMerge(out[k] || {}, v);
        else
            out[k] = v;
    }
    return out;
}
