/**
 * @file src/reviewer/utilities.ts
 * @summary General-purpose utility functions used by the reviewer module, including deep cloning (with structuredClone fallback) and integer clamping.
 *
 * @exports
 *   - deepClone — Deep-clones a value using structuredClone when available, falling back to JSON round-trip
 *   - clampInt — Floors a numeric value and clamps it to the given inclusive range, defaulting to the lower bound on NaN
 */

export function deepClone<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

export function clampInt(n: unknown, lo: number, hi: number): number {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}
