/**
 * @file src/indexes/group-format.ts
 * @summary Coerces and formats group (deck/tag) values between their raw input representations and normalised string arrays. Handles comma-, semicolon-, and pipe-delimited strings as well as arrays.
 *
 * @exports
 *  - coerceGroups — accepts a raw groups value (string, string[], or unknown) and returns a normalised string array
 *  - formatGroups — formats an array of group paths into a human-readable display string
 *  - fmtGroups    — compatibility alias for formatGroups
 */

import { normaliseGroupPath } from "./group-index";
import { escapeDelimiterRe } from "../core/delimiter";

/**
 * Accept groups as:
 * - string[] (preferred)
 * - string (comma/delimiter delimited)
 */
export function coerceGroups(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x ?? ""));
  if (typeof raw === "string") {
    const delimRe = new RegExp(`[,${escapeDelimiterRe()}]+`, "g");
    return raw
      .split(delimRe)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function formatGroups(groups: unknown): string {
  const normalizedGroups = coerceGroups(groups)
    .map((g) => normaliseGroupPath(g) || null)
    .filter((x): x is string => !!x);

  if (!normalizedGroups.length) return "—";
  return normalizedGroups.join(", ");
}

export function fmtGroups(groups: unknown): string {
  return formatGroups(groups);
}
