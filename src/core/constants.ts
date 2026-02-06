// src/constants.ts

// NOTE: I recommend KEEPING these IDs stable if you already have users/data,
// because changing view type strings can affect workspace restoration.
// If you are early in development and want to fully rebrand identifiers, use the "sprout-*" values below.

export const VIEW_TYPE_REVIEWER = "sprout-reviewer";
export const VIEW_TYPE_WIDGET = "sprout-widget";
export const VIEW_TYPE_BROWSER = "sprout-browser";
export const VIEW_TYPE_ANALYTICS = "sprout-analytics";
export const VIEW_TYPE_HOME = "sprout-home";

export const BRAND = "Sprout";

// ── Layout ──────────────────────────────────────────────────────────
/** Max content width in normal (non-wide) mode. */
export const MAX_CONTENT_WIDTH = 1080;
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

// Single source of truth for settings + defaults:
export type { SproutSettings } from "./default-settings";
export { DEFAULT_SETTINGS } from "./default-settings";

export function deepMerge<T>(target: T, src: Partial<T>): T {
  const out = Array.isArray(target)
    ? (target as unknown[]).slice()
    : { ...(target as Record<string, unknown>) };
  for (const k of Object.keys(src || {})) {
    const v = (src as Record<string, unknown>)[k];
    if (v && typeof v === "object" && !Array.isArray(v))
      (out as Record<string, unknown>)[k] = deepMerge((out as Record<string, unknown>)[k] || {}, v as Partial<never>);
    else (out as Record<string, unknown>)[k] = v;
  }
  return out as T;
}
