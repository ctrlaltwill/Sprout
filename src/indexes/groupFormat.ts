// src/indexes/groupFormat.ts
import { normaliseGroupPath } from "./groupIndex";

/**
 * Accept groups as:
 * - string[] (preferred)
 * - string (comma/semicolon/pipe delimited)
 */
export function coerceGroups(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x ?? ""));
  if (typeof raw === "string") {
    return raw
      .split(/[,;|]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function fmtGroups(groups: any): string {
  const norm = coerceGroups(groups)
    .map((g) => normaliseGroupPath(g) || null)
    .filter((x): x is string => !!x);

  if (!norm.length) return "—";
  return norm.join(", ");
}
