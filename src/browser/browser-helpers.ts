/**
 * browser/browser-helpers.ts
 * ──────────────────────────
 * Types, constants, and standalone helper functions used by
 * SproutCardBrowserView.  All exported items are pure
 * (no Obsidian view state) so they can be tested in isolation.
 */

import type { CardRecord } from "../core/store";
import { log } from "../core/logger";
import { normaliseGroupPath } from "../indexes/group-index";
import { fmtGroups, coerceGroups } from "../indexes/group-format";
import { buildAnswerOrOptionsFor, buildQuestionFor } from "../reviewer/fields";
import { stageLabel } from "../reviewer/labels";

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
  id: 100,
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
  el.style.setProperty("white-space", "normal", "important");
  el.style.setProperty("overflow-wrap", "anywhere", "important");
  el.style.setProperty("word-break", "keep-all", "important");
  el.style.setProperty("hyphens", "auto", "important");
}

/** Fixed-row tables: clip extra lines (still wraps, but won't grow row height). */
export function forceCellClip(el: HTMLElement) {
  el.style.setProperty("overflow", "hidden", "important");
  el.style.setProperty("text-overflow", "clip", "important");
}

/** Sticky headers (th). */
export function applyStickyThStyles(th: HTMLTableCellElement, topPx = 0) {
  th.style.setProperty("position", "sticky", "important");
  th.style.setProperty("top", `${topPx}px`, "important");
  th.style.setProperty("z-index", "10", "important");
  th.style.setProperty("background", "var(--background)", "important");
  th.style.setProperty("box-shadow", "0 1px 0 var(--background-modifier-border)", "important");

  // ✅ stable header height + vertical centring via inner flex wrapper
  th.style.setProperty("height", "44px", "important");
  th.style.setProperty("vertical-align", "middle", "important");
  th.style.setProperty("padding", "0", "important");

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
export function groupsToInput(groups: any): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g) => titleCaseGroupPath(String(g).trim()))
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
    const src = String((rec as any).imageRef || (rec as any).ioSrc || "");
    pushPipeField(out, "IO", src.trim());
    const prompt = String((rec as any).prompt || "").trim();
    if (prompt) pushPipeField(out, "Q", prompt);
    const mask = String((rec as any).maskMode || "").trim();
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
  if (tt === "mcq") return "MCQ";
  if (tt === "cloze" || tt === "cloze-child") return "Cloze";
  if (tt === "io") return "Image Occlusion";
  if (tt === "io-child") return "Image Occlusion";
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
export function tryResolveToResourceSrc(app: any, linkpathOrPath: string, fromNotePath: string): string | null {
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
    if (af && (af).path && app?.vault?.getResourcePath) {
      const src = app.vault.getResourcePath(af);
      if (typeof src === "string" && src) return src;
    }
  } catch (e) { log.swallow("resolve vault path to resource", e); }

  return null;
}

/**
 * Get a resolved `<img src>` URL + a display reference for IO cards.
 */
export function getIoResolvedImage(app: any, card: any): { src: string | null; displayRef: string | null } {
  const raw =
    typeof card?.imageRef === "string"
      ? card.imageRef
      : typeof card?.ioSrc === "string"
        ? card.ioSrc
        : typeof card?.src === "string"
          ? card.src
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
export function extractOcclusionLabels(card: any, max = 8): string[] {
  const out: string[] = [];

  const push = (v: any) => {
    const s = String(v ?? "").trim();
    if (!s) return;
    out.push(s);
  };

  const list: any[] = Array.isArray(card?.occlusions)
    ? card.occlusions
    : Array.isArray(card?.rects)
      ? card.rects
      : [];

  for (const r of list) {
    push((r).groupKey);
    push((r).key);
    push((r).label);
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
export function renderOcclusionBadgesHtml(card: any): string {
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
export function buildIoImgHtml(resolvedSrc: string, displayRef: string, title: string): string {
  const safeSrc = escapeHtml(resolvedSrc);
  const safeTitle = escapeHtml(title);

  return `
<div class="bc flex items-center" title="${safeTitle}">
  <img
    src="${safeSrc}"
    alt="${safeTitle}"
    style="max-width:100%; max-height:140px; object-fit:contain; border-radius:10px; border:1px solid var(--background-modifier-border); background: var(--background-secondary);"
  />
</div>
`.trim();
}

/** Build HTML for an IO image preview with occlusion overlays. */
export function buildIoOccludedHtml(
  resolvedSrc: string,
  displayRef: string,
  occlusions: any[] | null,
  title: string,
  cardForLabels?: any,
): string {
  const safeSrc = escapeHtml(resolvedSrc);
  const safeTitle = escapeHtml(title);
  const safeDisplay = escapeHtml(displayRef);

  const rects = Array.isArray(occlusions) ? occlusions : [];
  const overlays = rects
    .map((r) => {
      const x = Number.isFinite((r).x)
        ? Number((r).x)
        : Number.isFinite((r).x1)
          ? Number((r).x1)
          : 0;
      const y = Number.isFinite((r).y)
        ? Number((r).y)
        : Number.isFinite((r).y1)
          ? Number((r).y1)
          : 0;

      let w = Number.isFinite((r).w) ? Number((r).w) : null;
      let h = Number.isFinite((r).h) ? Number((r).h) : null;

      if (w == null && Number.isFinite((r).x2)) w = Number((r).x2) - x;
      if (h == null && Number.isFinite((r).y2)) h = Number((r).y2) - y;

      w = w == null ? 0 : w;
      h = h == null ? 0 : h;

      const left = Math.max(0, Math.min(1, x)) * 100;
      const top = Math.max(0, Math.min(1, y)) * 100;
      const width = Math.max(0, Math.min(1, w)) * 100;
      const height = Math.max(0, Math.min(1, h)) * 100;

      return `<div class="bc" style="
        position:absolute;
        left:${left}%;
        top:${top}%;
        width:${width}%;
        height:${height}%;
        background: rgba(0,0,0,0.55);
        border: 1px solid rgba(0,0,0,0.25);
        border-radius: 6px;
        pointer-events:none;
        z-index: 1;
      "></div>`;
    })
    .join("");

  const badges = cardForLabels ? renderOcclusionBadgesHtml(cardForLabels) : "";

  return `
<div class="bc" title="${safeTitle}" style="display:inline-block;">
  <div class="bc" style="position:relative; display:inline-block; border-radius:10px; overflow:hidden; border:1px solid var(--background-modifier-border); background: var(--background-secondary);">
    ${badges}
    <img class="bc" src="${safeSrc}" alt="${safeTitle}" style="display:block; max-width:100%; max-height:140px; object-fit:contain;" />
    ${overlays}
  </div>
</div>
`.trim();
}

// ─── Search helpers ──────────────────────────────────────────────────

/** Build a searchable text blob from all card fields. */
export function searchText(card: CardRecord): string {
  const id = String((card as any)?.id ?? "").toLowerCase();
  const title = (card.title || "").toLowerCase();

  const t = String((card as any)?.type ?? "").toLowerCase();
  const tLabel = typeLabelBrowser(t).toLowerCase();

  const typeAliases = t === "io" ? ["io", "image", "image occlusion", "occlusion"] : [t];

  const prompt = buildQuestionFor(card).toLowerCase();
  const answer = buildAnswerOrOptionsFor(card).toLowerCase();
  const info = (card.info || "").toLowerCase();

  const groups = fmtGroups((card as any).groups).toLowerCase();
  const rawGroups = coerceGroups((card as any).groups).map((g) => String(g).toLowerCase());
  const location = fmtLocation(card.sourceNotePath).toLowerCase();
  const sourcePath = String(card.sourceNotePath || "").toLowerCase();
  const stage = stageLabel(String((card as any)?.stage || "")).toLowerCase();
  const dueText = fmtDue((card as any)?.due ?? null).toLowerCase();

  return `${id}\n${t}\n${tLabel}\n${typeAliases.join(" ")}\n${title}\n${prompt}\n${answer}\n${info}\n${groups}\n${rawGroups.join(" ")}\n${location}\n${sourcePath}\n${stage}\n${dueText}`;
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
