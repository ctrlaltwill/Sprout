/**
 * src/settings/settings-utils.ts
 * ──────────────────────────────
 * Pure utility functions and regex constants used by `SproutSettingsTab`
 * for parsing, formatting, vault path handling, and card-block detection.
 *
 * None of these depend on Obsidian UI classes (Setting, Modal, etc.) so
 * they're safe to import from anywhere.
 */

import { type App, TFolder } from "obsidian";
import type SproutPlugin from "../main";

// ────────────────────────────────────────────
// Regex constants for card-block detection
// ────────────────────────────────────────────

/** Matches a Sprout anchor line, e.g. `^sprout-123456789`. */
export const ANCHOR_LINE_RE = /^\^sprout-(\d{9})\s*$/;

/**
 * Card block detection: matches the opening line of a card block.
 * Covers colon + pipe formats for Q, MCQ, and CQ types.
 */
export const CARD_START_RE = /^(Q|MCQ|CQ)\s*(?::|\|)\s*.*$/;

/**
 * Matches a field line within a card block.
 * Covers T, A, I (colon/pipe), O (colon-only), and C/K (colon or pipe).
 */
export const FIELD_LINE_RE =
  /^(T|A|I)\s*(?::|\|)\s*.*$|^O:\s*.*$|^(C|K)\s*:\s*.*$|^(C|K)\s*\|\s*.*$/;

// ────────────────────────────────────────────
// Numeric parsing / formatting helpers
// ────────────────────────────────────────────

/**
 * Parses a comma-separated string of positive numbers.
 * Returns an array of finite numbers > 0, or an empty array if nothing valid.
 */
export function parsePositiveNumberListCsv(v: string): number[] {
  return v
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Clamps `n` to the range [lo, hi].
 */
export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Coerces a value to a non-negative integer, falling back to `fallback`
 * if the value is not a finite number.
 */
export function toNonNegInt(v: any, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/**
 * Formats a setting value for display in Notices.
 * Handles booleans, numbers, strings, arrays, and nullish values.
 */
export function fmtSettingValue(v: any): string {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(",");
  if (v === null || v === undefined) return "—";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ────────────────────────────────────────────
// Card-block detection helpers
// ────────────────────────────────────────────

/** Returns true if `line` is a Sprout anchor (e.g. `^sprout-123456789`). */
export function isAnchorLine(line: string): boolean {
  return ANCHOR_LINE_RE.test(line.trim());
}

/** Returns true if `line` starts a card block (Q:, MCQ|, CQ:, etc.). */
export function isCardStartLine(line: string): boolean {
  return CARD_START_RE.test(line.trim());
}

/** Returns true if `line` is a card field (T:, A|, O:, I:, C:, K|, etc.). */
export function isFieldLine(line: string): boolean {
  return FIELD_LINE_RE.test(line.trim());
}

/**
 * Heuristic: looks ahead up to 8 lines from `startIdx` to see if the
 * block starting at that index resembles a complete card block
 * (i.e. has an anchor or field line following the start line).
 */
export function looksLikeCardBlock(lines: string[], startIdx: number): boolean {
  const maxLookahead = 8;
  for (let k = 1; k <= maxLookahead && startIdx + k < lines.length; k++) {
    const t = lines[startIdx + k].trim();
    if (!t) continue;
    if (isAnchorLine(t) || isFieldLine(t)) return true;
    return false;
  }
  return false;
}

// ────────────────────────────────────────────
// Deep clone helper
// ────────────────────────────────────────────

/**
 * Deep-clones a plain JSON-serialisable value.
 * Uses `structuredClone` when available, otherwise falls back to
 * JSON round-trip.
 */
export function clonePlain<T>(x: T): T {
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x)) as T;
}

// ────────────────────────────────────────────
// Vault path helpers
// ────────────────────────────────────────────

/**
 * Normalises a vault-relative path:
 * - Converts backslashes to forward slashes
 * - Strips leading slashes
 * - Collapses multiple consecutive slashes
 */
export function normaliseVaultPath(p: string): string {
  let s = String(p ?? "").trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/^\/+/, "");
  s = s.replace(/\/{2,}/g, "/");
  return s;
}

/**
 * Normalises a folder path: same as `normaliseVaultPath` but ensures
 * a trailing slash (unless the result is empty).
 */
export function normaliseFolderPath(p: string): string {
  let s = normaliseVaultPath(p);
  if (!s) return "";
  if (!s.endsWith("/")) s += "/";
  return s;
}

/**
 * Lists all folders in the vault as normalised paths with trailing slashes.
 * Sorted alphabetically.
 */
export function listVaultFolders(app: App): string[] {
  const out: string[] = [];
  const files = app.vault.getAllLoadedFiles?.() ?? [];
  for (const f of files) {
    if (f instanceof TFolder) {
      const path = normaliseFolderPath(f.path || "");
      if (path) out.push(path);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * Fuzzy-matches `rawQuery` against a list of folder paths.
 * Prefers prefix matches, then substring matches.
 * Returns at most `limit` results, sorted by relevance.
 */
export function fuzzyFolderMatches(allFolders: string[], rawQuery: string, limit = 12): string[] {
  const q = normaliseVaultPath(rawQuery || "").toLowerCase();
  if (!q) return allFolders.slice(0, limit);

  const scored: Array<{ p: string; score: number }> = [];
  for (const p of allFolders) {
    const pl = p.toLowerCase();

    // Prefer prefix matches, then substring matches.
    let score = -1;
    if (pl.startsWith(q)) score = 1000 - (pl.length - q.length);
    else {
      const idx = pl.indexOf(q);
      if (idx >= 0) score = 500 - idx;
    }
    if (score >= 0) scored.push({ p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  return scored.slice(0, Math.max(0, limit)).map((x) => x.p);
}

/**
 * Lists all unique source-note paths from the card store.
 * Sorted alphabetically. Used for deck-path autocomplete.
 */
export function listDeckPaths(plugin: SproutPlugin): string[] {
  const out = new Set<string>();
  const cards = plugin.store.getAllCards?.() ?? [];
  for (const card of cards) {
    const raw = String(card?.sourceNotePath ?? "").trim();
    if (raw) out.add(normaliseVaultPath(raw));
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Fuzzy-matches `rawQuery` against a list of deck/note paths.
 * Same scoring logic as `fuzzyFolderMatches`.
 */
export function fuzzyPathMatches(allPaths: string[], rawQuery: string, limit = 12): string[] {
  const q = normaliseVaultPath(rawQuery || "").toLowerCase();
  if (!q) return allPaths.slice(0, limit);

  const scored: Array<{ p: string; score: number }> = [];
  for (const p of allPaths) {
    const pl = p.toLowerCase();
    let score = -1;
    if (pl.startsWith(q)) score = 1000 - (pl.length - q.length);
    else {
      const idx = pl.indexOf(q);
      if (idx >= 0) score = 500 - idx;
    }
    if (score >= 0) scored.push({ p, score });
  }

  scored.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  return scored.slice(0, Math.max(0, limit)).map((x) => x.p);
}
