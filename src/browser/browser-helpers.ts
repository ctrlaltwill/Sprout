/**
 * @file src/browser/browser-helpers.ts
 * @summary Shared types, constants, and pure helper functions used across all
 * Flashcard Browser modules. Includes filter/column type aliases, default column
 * widths, placeholder strings, DOM utilities (clearNode, forceWrapStyles,
 * forceCellClip, applyStickyThStyles), date/display formatters, group-path
 * utilities, pipe-delimited card-block builder, Image Occlusion HTML renderers,
 * and full-text search helpers. All exports are stateless and testable in
 * isolation.
 *
 * @exports
 *   - TypeFilter — type alias for card-type filter values
 *   - StageFilter — type alias for card-stage filter values
 *   - DueFilter — type alias for due-date filter values
 *   - ColKey — type alias for table column key identifiers
 *   - SortKey — type alias for sortable column keys (same as ColKey)
 *   - ParsedSearch — type for parsed search query results
 *   - DropdownOption — generic type for dropdown menu option items
 *   - DropdownMenuController — type for dropdown menu controller instances
 *   - DEFAULT_COL_WIDTHS — default pixel widths for each table column
 *   - PLACEHOLDER_TITLE — placeholder text for the title field
 *   - PLACEHOLDER_CLOZE — placeholder text for the cloze field
 *   - PLACEHOLDER_QUESTION — placeholder text for the question field
 *   - PLACEHOLDER_ANSWER — placeholder text for the answer field
 *   - PLACEHOLDER_INFO — placeholder text for the info field
 *   - CLOZE_ANSWER_HELP — help text shown in the answer column for cloze cards
 *   - clearNode — removes all child nodes from an element
 *   - forceWrapStyles — sets inline styles to override nowrap defaults on table cells
 *   - forceCellClip — clips overflow for fixed-row-height table cells
 *   - applyStickyThStyles — applies sticky positioning and styling to table header cells
 *   - fmtDue — formats a due-date timestamp for display
 *   - fmtLocation — formats a source note path for display
 *   - titleCaseToken — title-cases a single word token
 *   - titleCaseSegment — title-cases a path segment preserving separators
 *   - titleCaseGroupPath — title-cases an entire slash-delimited group path
 *   - normalizeGroupPathInput — normalises a group path by trimming and collapsing empty segments
 *   - formatGroupDisplay — formats a group path for display with spaced slashes
 *   - expandGroupAncestors — expands a group path to all ancestor paths
 *   - parseGroupsInput — parses a comma-delimited string into normalised group path array
 *   - groupsToInput — converts a group array back to a comma-delimited input string
 *   - escapePipeText — escapes pipe characters for pipe-delimited card block syntax
 *   - pushPipeField — pushes a key-value field to a pipe-delimited card block
 *   - buildCardBlockPipeMarkdown — builds the full pipe-markdown block for writing a card to a note
 *   - startOfTodayMs — returns midnight of today in milliseconds since epoch
 *   - endOfTodayMs — returns 23:59:59.999 of today in milliseconds since epoch
 *   - typeLabelBrowser — returns a human-readable label for a card type
 *   - escapeHtml — escapes HTML special characters
 *   - stripWikiImageSyntax — parses wikilink image syntax into linkpath and display reference
 *   - tryResolveToResourceSrc — attempts to resolve a link/path to a vault resource URL
 *   - getIoResolvedImage — gets a resolved image URL and display reference for IO cards
 *   - extractOcclusionLabels — extracts occlusion labels from a card's mask data for badge rendering
 *   - renderOcclusionBadgesHtml — renders occlusion badge chips as an HTML string
 *   - buildIoImgHtml — builds HTML for an IO image preview without occlusions
 *   - buildIoOccludedHtml — builds HTML for an IO image preview with occlusion overlays
 *   - searchText — builds a searchable text blob from all card fields
 *   - parseSearchQuery — parses a search query string extracting group and type filters
 */

import type { CardRecord } from "../core/store";
import type { App, TFile } from "obsidian";
import { log } from "../core/logger";
import { setCssProps } from "../core/ui";
import { normaliseGroupPath } from "../indexes/group-index";
import { fmtGroups, coerceGroups } from "../indexes/group-format";
import { buildAnswerOrOptionsFor, buildQuestionFor } from "../reviewer/fields";

// ─── Filter / column types ──────────────────────────────────────────

export type TypeFilter = "all" | "basic" | "mcq" | "cloze" | "io";
export type StageFilter = "all" | "new" | "learning" | "relearning" | "review" | "suspended" | "quarantined";
export type DueFilter = "all" | "due" | "today" | "later";

export type ColKey =
  | "id"
  | "type"
  | "stage"
  | "due"
  | "title"
  | "question"
  | "answer"
  | "info"
  | "location"
  | "groups";

export type SortKey = ColKey;

export type ParsedSearch = { text: string; groups: string[]; types: string[] };

export type DropdownOption<T extends string> = { v: T; label: string; hint?: string };
export type DropdownMenuController<T extends string> = {
  root: HTMLElement;
  setValue: (v: T) => void;
  dispose: () => void;
};

// ─── Constants ───────────────────────────────────────────────────────

export const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  id: 130,
  type: 110,
  stage: 80,
  due: 90,
  title: 240,
  question: 240,
  answer: 240,
  info: 250,
  location: 150,
  groups: 250,
};

export const PLACEHOLDER_TITLE = "Flashcard title (optional)";
export const PLACEHOLDER_CLOZE =
  "Example: This is a {{c1::cloze}} and this is the same {{c1::group}}. This {{c2::cloze}} is hidden separately.";
export const PLACEHOLDER_QUESTION = "Write the question prompt";
export const PLACEHOLDER_ANSWER = "Write the answer";
export const PLACEHOLDER_INFO = "Extra information shown on the back to add context";

export const CLOZE_ANSWER_HELP =
  "There is no answer field for Cloze deletion cards. See the question field to adjust hidden fields.";

// ─── DOM utilities ───────────────────────────────────────────────────

/** Remove all child nodes from an element. */
export function clearNode(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Basecoat table defaults enforce `white-space: nowrap !important` on td/th.
 * To beat that, we MUST set inline styles with priority "important".
 */
export function forceWrapStyles(el: HTMLElement) {
  el.classList.add("sprout-force-wrap");
}

/** Fixed-row tables: clip extra lines (still wraps, but won't grow row height). */
export function forceCellClip(el: HTMLElement) {
  el.classList.add("sprout-cell-clip");
}

/** Sticky headers (th). */
export function applyStickyThStyles(th: HTMLTableCellElement, topPx = 0) {
  th.classList.add("sprout-sticky-th");
  setCssProps(th, "--sprout-sticky-top", `${topPx}px`);

  forceCellClip(th);
  forceWrapStyles(th);
}

// ─── Formatting helpers ──────────────────────────────────────────────

/** Format a due-date timestamp for display. */
export function fmtDue(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  const pad2 = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${y}/${m}/${day}, ${h}:${min}`;
}

/**
 * Display-only formatter:
 *   Directory/Subdirectory/Note.md  ->  Directory / Subdirectory / Note
 */
export function fmtLocation(path: string | null | undefined): string {
  const p = (path || "").trim();
  if (!p) return "—";
  const noExt = p.replace(/\.md$/i, "");
  return noExt.split("/").filter(Boolean).join(" / ");
}

/** Title-case a single word token. */
export function titleCaseToken(token: string): string {
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Title-case a path segment (preserving separators). */
export function titleCaseSegment(seg: string): string {
  if (!seg) return seg;
  return seg
    .split(/([\s_-]+)/)
    .map((part) => (/^[\s_-]+$/.test(part) ? part : titleCaseToken(part)))
    .join("");
}

/** Title-case an entire slash-delimited group path. */
export function titleCaseGroupPath(path: string): string {
  const normalized = normalizeGroupPathInput(path);
  if (!normalized) return "";
  return normalized
    .split("/")
    .map((seg) => titleCaseSegment(seg.trim()))
    .filter(Boolean)
    .join("/");
}

/** Normalise a group path (trim segments, collapse empty). */
export function normalizeGroupPathInput(path: string): string {
  if (!path) return "";
  return path
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join("/");
}

/** Format a group path for display: "A/B/C" → "A / B / C" (title-cased). */
export function formatGroupDisplay(path: string): string {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return "";
  return canonical.split("/").join(" / ");
}

/** Expand a group path to all ancestor paths (for hierarchy). */
export function expandGroupAncestors(path: string): string[] {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return [];
  const parts = canonical.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** Parse a comma-delimited input string into an array of normalised group paths. */
export function parseGroupsInput(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => titleCaseGroupPath(s.trim()))
    .filter(Boolean);
}

/** Convert an array of groups back to a comma-delimited input string. */
export function groupsToInput(groups: unknown): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g: unknown) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean)
    .join(", ");
}

// ─── Pipe-delimited card block building ──────────────────────────────

/** Escape pipe characters for pipe-delimited card block syntax. */
export function escapePipeText(s: string): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Push a key-value field to a pipe-delimited card block (handles multi-line). */
export function pushPipeField(out: string[], key: string, value: string) {
  const raw = String(value ?? "");
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0) {
    out.push(`${key} | |`);
    return;
  }
  if (lines.length === 1) {
    out.push(`${key} | ${escapePipeText(lines[0])} |`);
    return;
  }
  out.push(`${key} | ${escapePipeText(lines[0])}`);
  for (let i = 1; i < lines.length - 1; i++) out.push(escapePipeText(lines[i]));
  out.push(`${escapePipeText(lines[lines.length - 1])} |`);
}

/**
 * Build the full pipe-markdown block for a card (used when writing
 * edits back to the note file).
 */
export function buildCardBlockPipeMarkdown(id: string, rec: CardRecord): string[] {
  const out: string[] = [];
  out.push(`^sprout-${id}`);

  const title = (rec.title || "").trim();
  if (title) pushPipeField(out, "T", title);

  if (rec.type === "basic") {
    pushPipeField(out, "Q", (rec.q || "").trim());
    pushPipeField(out, "A", (rec.a || "").trim());
  } else if (rec.type === "cloze") {
    pushPipeField(out, "CQ", (rec.clozeText || "").trim());
  } else if (rec.type === "mcq") {
    pushPipeField(out, "MCQ", (rec.stem || "").trim());
    const options = Array.isArray(rec.options) ? rec.options : [];
    const correct = Number.isFinite(rec.correctIndex) ? (rec.correctIndex as number) : -1;
    options.forEach((opt, idx) => {
      const txt = (opt || "").trim();
      if (!txt) return;
      if (idx === correct) pushPipeField(out, "A", txt);
      else pushPipeField(out, "O", txt);
    });
  } else if (rec.type === "io") {
    const src = String(rec.imageRef || "");
    pushPipeField(out, "IO", src.trim());
    const prompt = String(rec.prompt || "").trim();
    if (prompt) pushPipeField(out, "Q", prompt);
    const mask = String(rec.maskMode || "").trim();
    if (mask) pushPipeField(out, "C", mask);
  }

  const info = (rec.info || "").trim();
  if (info) pushPipeField(out, "I", info);

  const groups = Array.isArray(rec.groups)
    ? rec.groups
        .map((g) => normaliseGroupPath(g) || null)
        .filter((x): x is string => !!x)
    : [];
  if (groups.length) pushPipeField(out, "G", groups.join(", "));

  out.push("");
  return out;
}

// ─── Date helpers ────────────────────────────────────────────────────

/** Midnight (start) of today, in ms since epoch. */
export function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 23:59:59.999 (end) of today, in ms since epoch. */
export function endOfTodayMs(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// ─── Display helpers ─────────────────────────────────────────────────

/** Browser display label for card type. */
export function typeLabelBrowser(t: string): string {
  const tt = String(t || "").toLowerCase();
  if (tt === "basic") return "Basic";
  if (tt === "mcq") return "Multiple choice";
  if (tt === "cloze" || tt === "cloze-child") return "Cloze";
  if (tt === "io") return "Image occlusion";
  if (tt === "io-child") return "Image occlusion";
  return tt || "—";
}

/** Escape HTML special characters. */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Image Occlusion rendering ───────────────────────────────────────

/**
 * Accepts wikilink image syntax (![[path]], [[path|alias]]) or raw paths/urls.
 * Returns { linkpath, displayRef }.
 */
export function stripWikiImageSyntax(raw: string): { linkpath: string; displayRef: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { linkpath: "", displayRef: "" };

  const m = /^!?\[\[([\s\S]+?)\]\]$/.exec(s);
  if (!m) return { linkpath: s, displayRef: s };

  const inside = String(m[1] ?? "").trim();
  const linkpath = String(inside.split("|")[0] ?? "").trim();
  return { linkpath, displayRef: s };
}

/** Attempt to resolve a link/path to a vault resource URL. */
export function tryResolveToResourceSrc(app: App, linkpathOrPath: string, fromNotePath: string): string | null {
  const p = String(linkpathOrPath ?? "").trim();
  if (!p) return null;

  // Already a URL?
  if (/^(https?:)?\/\//i.test(p) || /^data:/i.test(p)) return p;

  // Obsidian link resolver (best for wikilinks and relative paths)
  try {
    const file = app?.metadataCache?.getFirstLinkpathDest?.(p, fromNotePath);
    if (file) {
      const src = app?.vault?.getResourcePath?.(file);
      if (typeof src === "string" && src) return src;
    }
  } catch (e) { log.swallow("resolve link path to resource", e); }

  // Fallback: direct vault path lookup
  try {
    const af = app?.vault?.getAbstractFileByPath?.(p);
    if (af instanceof TFile && app?.vault?.getResourcePath) {
      const src = app.vault.getResourcePath(af);
      if (typeof src === "string" && src) return src;
    }
  } catch (e) { log.swallow("resolve vault path to resource", e); }

  return null;
}

/**
 * Get a resolved `<img src>` URL + a display reference for IO cards.
 */
export function getIoResolvedImage(app: App, card: CardRecord): { src: string | null; displayRef: string | null } {
  const raw =
    typeof card?.imageRef === "string"
      ? card.imageRef
      : null;

  if (!raw || !String(raw).trim()) return { src: null, displayRef: null };

  const fromNotePath = String(card?.sourceNotePath || "");
  const { linkpath, displayRef } = stripWikiImageSyntax(raw);

  const src = tryResolveToResourceSrc(app, linkpath, fromNotePath) || tryResolveToResourceSrc(app, raw, fromNotePath);

  return { src: src || null, displayRef: (displayRef || String(raw)).trim() || null };
}

/**
 * Extract small occlusion labels from a card's mask data
 * (for badge rendering in the IO preview).
 */
export function extractOcclusionLabels(card: CardRecord | Record<string, unknown>, max = 8): string[] {
  const out: string[] = [];

  const push = (v: unknown) => {
    if (v == null) return;
    const s = (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "").trim();
    if (!s) return;
    out.push(s);
  };

  const c = card as Record<string, unknown>;
  const list: unknown[] = Array.isArray(c?.occlusions)
    ? c.occlusions
    : Array.isArray(c?.rects)
      ? c.rects
      : [];

  for (const r of list) {
    const item = r as Record<string, unknown>;
    push(item.groupKey);
    push(item.key);
    push(item.label);
    if (out.length >= max) break;
  }

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const x of out) {
    if (seen.has(x)) continue;
    seen.add(x);
    uniq.push(x);
  }
  return uniq.slice(0, max);
}

/** Render small occlusion badge chips as an HTML string. */
export function renderOcclusionBadgesHtml(card: CardRecord | Record<string, unknown>): string {
  const labels = extractOcclusionLabels(card, 10);
  if (!labels.length) return "";

  const chips = labels
    .map((l) => {
      const safe = escapeHtml(l);
      return `<span class="bc inline-flex items-center justify-center px-2 text-[11px] leading-[18px] h-[18px] rounded-full border border-white/20 bg-black/55 text-white/90 backdrop-blur-sm">${safe}</span>`;
    })
    .join("");

  return `<div class="bc absolute left-2 top-2 flex gap-1 flex-wrap pointer-events-none z-[2]">${chips}</div>`;
}

/** Build HTML for an IO image preview (no occlusions). */
export function buildIoImgHtml(resolvedSrc: string, _displayRef: string, title: string): string {
  const safeSrc = escapeHtml(resolvedSrc);
  const safeTitle = escapeHtml(title);

  return `
<div class="bc flex items-center" title="${safeTitle}">
  <img
    src="${safeSrc}"
    alt="${safeTitle}"
    class="sprout-browser-io-img"
  />
</div>
`.trim();
}

/** Build HTML for an IO image preview with occlusion overlays. */
export function buildIoOccludedHtml(
  resolvedSrc: string,
  _displayRef: string,
  occlusions: unknown[] | null,
  title: string,
  cardForLabels?: CardRecord | { rects: unknown[] },
): string {
  const safeSrc = escapeHtml(resolvedSrc);
  const safeTitle = escapeHtml(title);

  const rects = Array.isArray(occlusions) ? occlusions : [];
  const overlays = rects
    .map((r) => {
      const rect = r as Record<string, unknown>;
      const x = Number.isFinite(rect.x)
        ? Number(rect.x)
        : Number.isFinite(rect.x1)
          ? Number(rect.x1)
          : 0;
      const y = Number.isFinite(rect.y)
        ? Number(rect.y)
        : Number.isFinite(rect.y1)
          ? Number(rect.y1)
          : 0;

      let w = Number.isFinite(rect.w) ? Number(rect.w) : null;
      let h = Number.isFinite(rect.h) ? Number(rect.h) : null;

      if (w == null && Number.isFinite(rect.x2)) w = Number(rect.x2) - x;
      if (h == null && Number.isFinite(rect.y2)) h = Number(rect.y2) - y;

      w = w == null ? 0 : w;
      h = h == null ? 0 : h;

      const left = Math.max(0, Math.min(1, x)) * 100;
      const top = Math.max(0, Math.min(1, y)) * 100;
      const width = Math.max(0, Math.min(1, w)) * 100;
      const height = Math.max(0, Math.min(1, h)) * 100;

      return `<div class="bc" style="
        --sprout-io-left:${left}%;
        --sprout-io-top:${top}%;
        --sprout-io-width:${width}%;
        --sprout-io-height:${height}%;
      " class="sprout-browser-io-overlay"></div>`;
    })
    .join("");

  const badges = cardForLabels ? renderOcclusionBadgesHtml(cardForLabels) : "";

  return `
<div class="bc sprout-browser-io-wrap" title="${safeTitle}">
  <div class="bc sprout-browser-io-frame">
    ${badges}
    <img class="bc sprout-browser-io-img-inner" src="${safeSrc}" alt="${safeTitle}" />
    ${overlays}
  </div>
</div>
`.trim();
}

// ─── Search helpers ──────────────────────────────────────────────────

/** Build a searchable text blob from all card fields. */
export function searchText(card: CardRecord): string {
  const id = String(card.id ?? "").toLowerCase();
  const title = (card.title || "").toLowerCase();

  const t = String(card.type ?? "").toLowerCase();
  const tLabel = typeLabelBrowser(t).toLowerCase();

  const typeAliases = t === "io" ? ["io", "image", "image occlusion", "occlusion"] : [t];

  const prompt = buildQuestionFor(card).toLowerCase();
  const answer = buildAnswerOrOptionsFor(card).toLowerCase();
  const info = (card.info || "").toLowerCase();

  const groups = fmtGroups(card.groups).toLowerCase();
  const rawGroups = coerceGroups(card.groups).map((g) => String(g).toLowerCase());
  const location = fmtLocation(card.sourceNotePath).toLowerCase();
  const sourcePath = String(card.sourceNotePath || "").toLowerCase();

  return `${id}\n${t}\n${tLabel}\n${typeAliases.join(" ")}\n${title}\n${prompt}\n${answer}\n${info}\n${groups}\n${rawGroups.join(" ")}\n${location}\n${sourcePath}`;
}

/** Parse a search query string, extracting `g:` group filters and `type:` type filters. */
export function parseSearchQuery(raw: string): ParsedSearch {
  const src = String(raw ?? "").trim();
  if (!src) return { text: "", groups: [], types: [] };

  const toks = src.split(/\s+/g).filter(Boolean);

  const groups: string[] = [];
  const types: string[] = [];
  const textToks: string[] = [];

  for (const tok of toks) {
    const lower = tok.toLowerCase();

    if (lower.startsWith("g:")) {
      const rest = tok.slice(2);
      const parts = rest
        .split(/[,;|]+/g)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const p of parts) {
        const g = normaliseGroupPath(p);
        if (g) groups.push(g);
      }
      continue;
    }

    if (lower.startsWith("type:")) {
      const rest = tok.slice(5);
      const parts = rest
        .split(/[,;|]+/g)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      for (const p of parts) {
        if (p === "image" || p === "imageocclusion" || p === "image-occlusion" || p === "occlusion")
          types.push("io");
        else types.push(p);
      }
      continue;
    }

    textToks.push(tok);
  }

  const uniqGroups = Array.from(new Set(groups));
  const uniqTypes = Array.from(new Set(types));
  return { text: textToks.join(" "), groups: uniqGroups, types: uniqTypes };
}
