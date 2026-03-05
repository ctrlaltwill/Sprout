/**
 * @file src/core/utils.ts
 * @summary Generic utility functions shared across the Sprout plugin. Provides numeric
 * clamping, positive-number-array sanitisation, deep-clone, and plain-object type guard.
 *
 * @exports
 *   - clamp              — clamp a number between lo and hi
 *   - cleanPositiveNumberArray — sanitise an unknown value into a positive number array
 *   - clonePlain          — deep-clone a value via structuredClone / JSON round-trip
 *   - isPlainObject       — type guard for Record<string, unknown>
 *   - FlashcardType       — union type for supported flashcard kinds
 */

/** Clamp `n` between `lo` and `hi` (inclusive). */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Coerce an unknown value into an array of positive finite numbers.
 * Returns `fallback` if the result would be empty.
 */
export function cleanPositiveNumberArray(v: unknown, fallback: number[]): number[] {
  const arr = Array.isArray(v) ? v : [];
  const out = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  return out.length ? out : fallback;
}

/** Deep-clone a plain JSON-safe value. Prefers `structuredClone` when available. */
export function clonePlain<T>(x: T): T {
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Type guard: returns true if `v` is a non-null, non-array object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Supported flashcard types. */
export type FlashcardType = "basic" | "reversed" | "cloze" | "mcq" | "oq" | "io";
