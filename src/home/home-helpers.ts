/**
 * home/home-helpers.ts
 * ────────────────────
 * Pure helper functions and constants used by the Sprout Home view.
 *
 * These are all side-effect-free and have no Obsidian dependencies,
 * so they can be tested in isolation.
 */

import type { Scope } from "../reviewer/types";

// ─── Constants ───────────────────────────────────────────────────────

/** Milliseconds in one day. */
export const MS_DAY = 24 * 60 * 60 * 1000;

// ─── Date / time helpers ─────────────────────────────────────────────

/**
 * Return a UTC-based day index for a given timestamp, respecting the
 * user's timezone.  Two timestamps on the same calendar day (in the
 * given timezone) produce the same index.
 */
export function localDayIndex(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}

/**
 * Format a timestamp as a human-readable relative string
 * (e.g. "Just now", "5m ago", "2h ago", "3d ago").
 */
export function formatTimeAgo(ts: number): string {
  if (!Number.isFinite(ts)) return "Unknown";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Build a countdown string to the next local midnight.
 * Returns "HH:MM:SS".
 */
export function formatCountdownToMidnight(now: number): string {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const diff = Math.max(0, next.getTime() - now);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ─── Deck / scope helpers ────────────────────────────────────────────

/**
 * Convert a vault-relative deck path to a Scope descriptor.
 * Paths ending in `.md` are treated as single-note scopes;
 * everything else becomes a folder scope.
 */
export function scopeFromDeckPath(path: string): Scope {
  const clean = String(path || "").trim();
  const name = clean.split("/").pop() || clean;
  if (clean.toLowerCase().endsWith(".md")) {
    return { type: "note", key: clean, name };
  }
  return { type: "folder", key: clean.replace(/\/+$/, ""), name };
}

/**
 * Truncate a deck label for display.
 * Shows at most the last two path segments, trimmed to `tailChars`.
 */
export function formatDeckLabel(label: string, tailChars = 36): string {
  const parts = label
    .replace(/\.md$/i, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return "";

  const child = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const cleaned = parent ? `${parent} / ${child}` : child;

  if (cleaned.length <= tailChars) return cleaned;

  if (!parent) {
    return `...${child.slice(-tailChars)}`;
  }

  const availableForParent = tailChars - (child.length + 3); // " / "
  if (availableForParent <= 3) return `... / ${child}`;
  const parentTail = parent.slice(-(availableForParent - 3));
  return `...${parentTail} / ${child}`;
}

/**
 * Format a pinned-deck label: strip `.md`, split by `/`,
 * and rejoin with ` / ` separators.
 */
export function formatPinnedDeckLabel(label: string): string {
  return label
    .replace(/\.md$/i, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
}
