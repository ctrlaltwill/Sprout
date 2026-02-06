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

// Single source of truth for settings + defaults:
export type { SproutSettings } from "./defaultSettings";
export { DEFAULT_SETTINGS } from "./defaultSettings";

export function deepMerge<T>(target: T, src: Partial<T>): T {
  const out: any = Array.isArray(target) ? (target as any[]).slice() : { ...(target as any) };
  for (const k of Object.keys(src || {})) {
    const v: any = (src as any)[k];
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(out[k] || {}, v);
    else out[k] = v;
  }
  return out as T;
}
