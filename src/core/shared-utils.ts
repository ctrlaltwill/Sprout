/**
 * @file shared-utils.ts
 * @summary Shared DOM and string utility functions used across multiple modules.
 *
 * These helpers were previously duplicated in browser-helpers, card-editor,
 * modal-utils, render-deck, header, and anki-export-modal.  This module is the
 * single source of truth — all other files should import from here.
 *
 * @exports clearNode          — Remove all children from a DOM node.
 * @exports titleCaseToken     — Title-case a single word.
 * @exports titleCaseSegment   — Title-case a path segment (handles hyphens/underscores/spaces).
 * @exports normalizeGroupPathInput — Normalize a slash-delimited group path string.
 * @exports titleCaseGroupPath — Normalize and title-case a full group path.
 * @exports formatGroupDisplay — Format a group path for user-facing display ("A / B / C").
 * @exports expandGroupAncestors — Return all ancestor paths for a group ("A", "A/B", "A/B/C").
 * @exports parseGroupsInput   — Split a comma-separated string into an array of canonical group paths.
 * @exports groupsToInput      — Convert an array of group paths into a comma-separated display string.
 */

// ────────────────────────────────────────────
// DOM helpers
// ────────────────────────────────────────────

/**
 * Remove all child nodes from the given element.
 * A null-safe variant — silently returns if `node` is null or undefined.
 */
export function clearNode(node: HTMLElement | null): void {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ────────────────────────────────────────────
// Group-path string helpers
// ────────────────────────────────────────────

/**
 * Title-case a single token (first char uppercase, rest lowercase).
 *
 * @example titleCaseToken("hello") // "Hello"
 */
export function titleCaseToken(token: string): string {
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Title-case a path segment, preserving internal delimiters (spaces, hyphens,
 * underscores) while capitalising each word.
 *
 * @example titleCaseSegment("hello-world") // "Hello-World"
 */
export function titleCaseSegment(seg: string): string {
  if (!seg) return seg;
  return seg
    .split(/([\s_-]+)/)
    .map((part) => (/^[\s_-]+$/.test(part) ? part : titleCaseToken(part)))
    .join("");
}

/**
 * Normalize a slash-delimited group path: trims segments and drops empties.
 *
 * @example normalizeGroupPathInput("  foo / / bar  ") // "foo/bar"
 */
export function normalizeGroupPathInput(path: string): string {
  if (!path) return "";
  return path
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join("/");
}

/**
 * Normalize and title-case a full group path.
 *
 * @example titleCaseGroupPath("foo/bar baz") // "Foo/Bar Baz"
 */
export function titleCaseGroupPath(path: string): string {
  const normalized = normalizeGroupPathInput(path);
  if (!normalized) return "";
  return normalized
    .split("/")
    .map((seg) => titleCaseSegment(seg.trim()))
    .filter(Boolean)
    .join("/");
}

/**
 * Format a group path for user-facing display by joining segments with " / ".
 *
 * @example formatGroupDisplay("foo/bar") // "Foo / Bar"
 */
export function formatGroupDisplay(path: string): string {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return "";
  return canonical.split("/").join(" / ");
}

/**
 * Return all ancestor paths for a group, from shallowest to deepest.
 *
 * @example expandGroupAncestors("a/b/c") // ["A", "A/B", "A/B/C"]
 */
export function expandGroupAncestors(path: string): string[] {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return [];
  const parts = canonical.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/**
 * Split a comma-separated string into an array of canonical group paths.
 *
 * @example parseGroupsInput("foo, bar/baz") // ["Foo", "Bar/Baz"]
 */
export function parseGroupsInput(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => titleCaseGroupPath(s.trim()))
    .filter(Boolean);
}

/**
 * Convert an array of group paths into a comma-separated display string.
 *
 * @example groupsToInput(["foo", "bar/baz"]) // "Foo, Bar/Baz"
 */
export function groupsToInput(groups: unknown): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g: unknown) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean)
    .join(", ");
}
