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
 *   - extractImageRefs — parses markdown for image references (both ![[wiki]] and ![alt](path))
 *   - renderMarkdownWithImages — builds HTML string with images resolved and plain text preserved
 */
import { getCorrectIndices } from "../../platform/core/store";
import { TFile } from "obsidian";
import { log } from "../../platform/core/logger";
import { cssClassForProps, setCssProps } from "../../platform/core/ui";
import { normaliseGroupPath } from "../../engine/indexing/group-index";
import { fmtGroups, coerceGroups, normalizeGroups } from "../../engine/indexing/group-format";
import { buildAnswerOrOptionsFor, buildQuestionFor } from "../reviewer/fields";
import { escapeTextWithCircleFlags } from "../../platform/flags/flag-tokens";
import { escapeDelimiterText, pushDelimitedField, } from "../../platform/core/delimiter";
import { buildPrimaryCardAnchor } from "../../platform/core/identity";
// ─── Constants ───────────────────────────────────────────────────────
export const DEFAULT_COL_WIDTHS = {
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
export const PLACEHOLDER_CLOZE = "Example: This is a {{c1::cloze}} and this is the same {{c1::group}}. This {{c2::cloze}} is hidden separately.";
export const PLACEHOLDER_QUESTION = "Write the question prompt";
export const PLACEHOLDER_ANSWER = "Write the answer";
export const PLACEHOLDER_INFO = "Extra information shown on the back to add context";
export const CLOZE_ANSWER_HELP = "There is no answer field for Cloze deletion cards. See the question field to adjust hidden fields.";
// ─── DOM utilities ───────────────────────────────────────────────────
export { clearNode } from "../../platform/core/shared-utils";
/**
 * Basecoat table defaults enforce `white-space: nowrap !important` on td/th.
 * To beat that, we MUST set inline styles with priority "important".
 */
export function forceWrapStyles(el) {
    el.classList.add("learnkit-force-wrap", "learnkit-force-wrap");
}
/** Fixed-row tables: clip extra lines (still wraps, but won't grow row height). */
export function forceCellClip(el) {
    el.classList.add("learnkit-cell-clip", "learnkit-cell-clip");
}
/** Sticky headers (th). */
export function applyStickyThStyles(th, topPx = 0) {
    th.classList.add("learnkit-sticky-th", "learnkit-sticky-th");
    setCssProps(th, "--learnkit-sticky-top", `${topPx}px`);
    forceCellClip(th);
    forceWrapStyles(th);
}
// ─── Formatting helpers ──────────────────────────────────────────────
/** Format a due-date timestamp for display. */
export function fmtDue(ts) {
    if (!ts || !Number.isFinite(ts))
        return "—";
    const d = new Date(ts);
    const pad2 = (n) => String(Math.floor(n)).padStart(2, "0");
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
export function fmtLocation(path) {
    const p = (path || "").trim();
    if (!p)
        return "—";
    const noExt = p.replace(/\.md$/i, "");
    return noExt.split("/").filter(Boolean).join(" / ");
}
export { titleCaseToken, titleCaseSegment, titleCaseGroupPath, normalizeGroupPathInput, formatGroupDisplay, expandGroupAncestors, parseGroupsInput, sortGroupPathsForDisplay, groupsToInput, } from "../../platform/core/shared-utils";
// ─── Delimited card block building ───────────────────────────────────
/** Escape delimiter characters for delimited card block syntax. */
export function escapePipeText(s) {
    return escapeDelimiterText(s);
}
/** Push a key-value field to a delimited card block (handles multi-line). */
export function pushPipeField(out, key, value) {
    pushDelimitedField(out, key, value);
}
/**
 * Build the full pipe-markdown block for a card (used when writing
 * edits back to the note file).
 */
export function buildCardBlockPipeMarkdown(id, rec) {
    const out = [];
    out.push(buildPrimaryCardAnchor(id));
    const title = (rec.title || "").trim();
    if (title)
        pushPipeField(out, "T", title);
    if (rec.type === "basic" || rec.type === "reversed") {
        pushPipeField(out, rec.type === "reversed" ? "RQ" : "Q", (rec.q || "").trim());
        pushPipeField(out, "A", (rec.a || "").trim());
    }
    else if (rec.type === "cloze") {
        pushPipeField(out, "CQ", (rec.clozeText || "").trim());
    }
    else if (rec.type === "mcq") {
        pushPipeField(out, "MCQ", (rec.stem || "").trim());
        const options = Array.isArray(rec.options) ? rec.options : [];
        const correctSet = new Set(getCorrectIndices(rec));
        options.forEach((opt, idx) => {
            const txt = (opt || "").trim();
            if (!txt)
                return;
            if (correctSet.has(idx))
                pushPipeField(out, "A", txt);
            else
                pushPipeField(out, "O", txt);
        });
    }
    else if (rec.type === "io") {
        const src = String(rec.imageRef || "");
        pushPipeField(out, "IO", src.trim());
        const prompt = String(rec.prompt || "").trim();
        if (prompt)
            pushPipeField(out, "Q", prompt);
        const mask = String(rec.maskMode || "").trim();
        if (mask)
            pushPipeField(out, "C", mask);
    }
    else if (rec.type === "oq") {
        pushPipeField(out, "OQ", (rec.q || "").trim());
        const steps = Array.isArray(rec.oqSteps) ? rec.oqSteps : [];
        steps.forEach((step, idx) => {
            const txt = (step || "").trim();
            if (txt)
                pushPipeField(out, String(idx + 1), txt);
        });
    }
    const info = (rec.info || "").trim();
    if (info)
        pushPipeField(out, "I", info);
    const groups = normalizeGroups(rec.groups);
    if (groups.length)
        pushPipeField(out, "G", groups.join(", "));
    out.push("");
    return out;
}
// ─── Date helpers ────────────────────────────────────────────────────
/** Midnight (start) of today, in ms since epoch. */
export function startOfTodayMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
/** 23:59:59.999 (end) of today, in ms since epoch. */
export function endOfTodayMs() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
}
// ─── Display helpers ─────────────────────────────────────────────────
/** Browser display label for card type. */
export function typeLabelBrowser(t) {
    const tt = String(t || "").toLowerCase();
    if (tt === "basic")
        return "Basic";
    if (tt === "reversed" || tt === "reversed-child")
        return "Basic (reversed)";
    if (tt === "mcq")
        return "Multiple choice";
    if (tt === "cloze" || tt === "cloze-child")
        return "Cloze";
    if (tt === "io")
        return "Image occlusion";
    if (tt === "io-child")
        return "Image occlusion";
    if (tt === "oq")
        return "Ordered question";
    return tt || "—";
}
/** Escape HTML special characters. */
export function escapeHtml(s) {
    return String(s !== null && s !== void 0 ? s : "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
export function renderFlagPreviewHtml(text) {
    return escapeTextWithCircleFlags(String(text !== null && text !== void 0 ? text : "")).replace(/\r?\n/g, "<br>");
}
// ─── Image Occlusion rendering ───────────────────────────────────────
/**
 * Accepts wikilink image syntax (![[path]], [[path|alias]]) or raw paths/urls.
 * Returns { linkpath, displayRef }.
 */
export function stripWikiImageSyntax(raw) {
    var _a, _b;
    const s = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!s)
        return { linkpath: "", displayRef: "" };
    const m = /^!?\[\[([\s\S]+?)\]\]$/.exec(s);
    if (!m)
        return { linkpath: s, displayRef: s };
    const inside = String((_a = m[1]) !== null && _a !== void 0 ? _a : "").trim();
    const linkpath = String((_b = inside.split("|")[0]) !== null && _b !== void 0 ? _b : "").trim();
    return { linkpath, displayRef: s };
}
/** Attempt to resolve a link/path to a vault resource URL. */
export function tryResolveToResourceSrc(app, linkpathOrPath, fromNotePath) {
    var _a, _b, _c, _d, _e, _f, _g;
    const p = String(linkpathOrPath !== null && linkpathOrPath !== void 0 ? linkpathOrPath : "").trim();
    if (!p)
        return null;
    // Already a URL?
    if (/^(https?:)?\/\//i.test(p) || /^data:/i.test(p))
        return p;
    // Obsidian link resolver (best for wikilinks and relative paths)
    try {
        const file = (_b = (_a = app === null || app === void 0 ? void 0 : app.metadataCache) === null || _a === void 0 ? void 0 : _a.getFirstLinkpathDest) === null || _b === void 0 ? void 0 : _b.call(_a, p, fromNotePath);
        if (file) {
            const src = (_d = (_c = app === null || app === void 0 ? void 0 : app.vault) === null || _c === void 0 ? void 0 : _c.getResourcePath) === null || _d === void 0 ? void 0 : _d.call(_c, file);
            if (typeof src === "string" && src)
                return src;
        }
    }
    catch (e) {
        log.swallow("resolve link path to resource", e);
    }
    // Fallback: direct vault path lookup
    try {
        const af = (_f = (_e = app === null || app === void 0 ? void 0 : app.vault) === null || _e === void 0 ? void 0 : _e.getAbstractFileByPath) === null || _f === void 0 ? void 0 : _f.call(_e, p);
        if (af instanceof TFile && ((_g = app === null || app === void 0 ? void 0 : app.vault) === null || _g === void 0 ? void 0 : _g.getResourcePath)) {
            const src = app.vault.getResourcePath(af);
            if (typeof src === "string" && src)
                return src;
        }
    }
    catch (e) {
        log.swallow("resolve vault path to resource", e);
    }
    return null;
}
/**
 * Get a resolved `<img src>` URL + a display reference for IO cards.
 */
export function getIoResolvedImage(app, card) {
    const raw = typeof (card === null || card === void 0 ? void 0 : card.imageRef) === "string"
        ? card.imageRef
        : null;
    if (!raw || !String(raw).trim())
        return { src: null, displayRef: null };
    const fromNotePath = String((card === null || card === void 0 ? void 0 : card.sourceNotePath) || "");
    const { linkpath, displayRef } = stripWikiImageSyntax(raw);
    const src = tryResolveToResourceSrc(app, linkpath, fromNotePath) || tryResolveToResourceSrc(app, raw, fromNotePath);
    return { src: src || null, displayRef: (displayRef || String(raw)).trim() || null };
}
/**
 * Extract small occlusion labels from a card's mask data
 * (for badge rendering in the IO preview).
 */
export function extractOcclusionLabels(card, max = 8) {
    const out = [];
    const push = (v) => {
        if (v == null)
            return;
        const s = (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "").trim();
        if (!s)
            return;
        out.push(s);
    };
    const c = card;
    const list = Array.isArray(c === null || c === void 0 ? void 0 : c.occlusions)
        ? c.occlusions
        : Array.isArray(c === null || c === void 0 ? void 0 : c.rects)
            ? c.rects
            : [];
    for (const r of list) {
        const item = r;
        push(item.groupKey);
        push(item.key);
        push(item.label);
        if (out.length >= max)
            break;
    }
    const seen = new Set();
    const uniq = [];
    for (const x of out) {
        if (seen.has(x))
            continue;
        seen.add(x);
        uniq.push(x);
    }
    return uniq.slice(0, max);
}
/** Render small occlusion badge chips as an HTML string. */
export function renderOcclusionBadgesHtml(card) {
    const labels = extractOcclusionLabels(card, 10);
    if (!labels.length)
        return "";
    const chips = labels
        .map((l) => {
        const safe = escapeHtml(l);
        return `<span class="inline-flex items-center justify-center px-2 text-[11px] leading-[18px] h-[18px] rounded-full border border-white/20 bg-black/55 text-white/90 backdrop-blur-sm">${safe}</span>`;
    })
        .join("");
    return `<div class="absolute left-2 top-2 flex gap-1 flex-wrap pointer-events-none z-[2]">${chips}</div>`;
}
/** Build HTML for an IO image preview (no occlusions). */
export function buildIoImgHtml(resolvedSrc, _displayRef, title) {
    const safeSrc = escapeHtml(resolvedSrc);
    const safeTitle = escapeHtml(title);
    return `
<div class="flex items-center" title="${safeTitle}">
  <img
    src="${safeSrc}"
    alt="${safeTitle}"
    class="lk-browser-io-img"
  />
</div>
`.trim();
}
/** Build HTML for an IO image preview with occlusion overlays. */
export function buildIoOccludedHtml(resolvedSrc, _displayRef, occlusions, title) {
    const safeSrc = escapeHtml(resolvedSrc);
    const safeTitle = escapeHtml(title);
    const rects = Array.isArray(occlusions) ? occlusions : [];
    const overlays = rects
        .map((r) => {
        const rect = r;
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
        if (w == null && Number.isFinite(rect.x2))
            w = Number(rect.x2) - x;
        if (h == null && Number.isFinite(rect.y2))
            h = Number(rect.y2) - y;
        w = w == null ? 0 : w;
        h = h == null ? 0 : h;
        const left = Math.max(0, Math.min(1, x)) * 100;
        const top = Math.max(0, Math.min(1, y)) * 100;
        const width = Math.max(0, Math.min(1, w)) * 100;
        const height = Math.max(0, Math.min(1, h)) * 100;
        const cls = cssClassForProps({
            "--learnkit-io-left": `${left}%`,
            "--learnkit-io-top": `${top}%`,
            "--learnkit-io-width": `${width}%`,
            "--learnkit-io-height": `${height}%`,
        });
        return `<div class="lk-browser-io-overlay${cls ? ` ${cls}` : ""}"></div>`;
    })
        .join("");
    return `
<div class="lk-browser-io-wrap" title="${safeTitle}">
  <div class="lk-browser-io-frame">
    <img class="lk-browser-io-img-inner" src="${safeSrc}" alt="${safeTitle}" />
    ${overlays}
  </div>
</div>
`.trim();
}
// ─── Search helpers ──────────────────────────────────────────────────
/** Build a searchable text blob from all card fields. */
export function searchText(card) {
    var _a, _b;
    const id = String((_a = card.id) !== null && _a !== void 0 ? _a : "").toLowerCase();
    const title = (card.title || "").toLowerCase();
    const t = String((_b = card.type) !== null && _b !== void 0 ? _b : "").toLowerCase();
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
export function parseSearchQuery(raw) {
    const src = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!src)
        return { text: "", groups: [], types: [] };
    const toks = src.split(/\s+/g).filter(Boolean);
    const groups = [];
    const types = [];
    const textToks = [];
    for (const tok of toks) {
        const lower = tok.toLowerCase();
        if (lower.startsWith("g:")) {
            const rest = tok.slice(2);
            const parts = rest
                .split(/[,|]+/g)
                .map((s) => s.trim())
                .filter(Boolean);
            for (const p of parts) {
                const g = normaliseGroupPath(p);
                if (g)
                    groups.push(g);
            }
            continue;
        }
        if (lower.startsWith("type:")) {
            const rest = tok.slice(5);
            const parts = rest
                .split(/[,|]+/g)
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            for (const p of parts) {
                if (p === "image" || p === "imageocclusion" || p === "image-occlusion" || p === "occlusion")
                    types.push("io");
                else
                    types.push(p);
            }
            continue;
        }
        textToks.push(tok);
    }
    const uniqGroups = Array.from(new Set(groups));
    const uniqTypes = Array.from(new Set(types));
    return { text: textToks.join(" "), groups: uniqGroups, types: uniqTypes };
}
// ─── Image parsing and rendering ─────────────────────────────────────
/** Parse markdown for image references (both ![[wiki]] and ![alt](path)). */
export function extractImageRefs(markdown) {
    const results = [];
    const s = String(markdown !== null && markdown !== void 0 ? markdown : "");
    // Match ![[wikilink]] or ![[wikilink|display]]
    const wikiRegex = /!\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    let m;
    while ((m = wikiRegex.exec(s)) !== null) {
        results.push({
            match: m[0],
            linkpath: m[1].trim(),
            alt: (m[2] || m[1]).trim(),
            start: m.index,
            end: m.index + m[0].length,
        });
    }
    // Match ![alt](path) markdown images
    const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = mdRegex.exec(s)) !== null) {
        results.push({
            match: m[0],
            linkpath: m[2].trim(),
            alt: m[1].trim(),
            start: m.index,
            end: m.index + m[0].length,
        });
    }
    // Sort by position
    results.sort((a, b) => a.start - b.start);
    return results;
}
/** Build HTML string with images resolved and plain text preserved. */
export function renderMarkdownWithImages(app, markdown, sourcePath) {
    const images = extractImageRefs(markdown);
    if (images.length === 0) {
        return escapeTextWithCircleFlags(markdown);
    }
    let html = "";
    let lastEnd = 0;
    for (const img of images) {
        // Add text before the image
        const beforeText = markdown.substring(lastEnd, img.start);
        if (beforeText) {
            html += escapeTextWithCircleFlags(beforeText);
        }
        // Resolve and add the image
        const resolvedSrc = tryResolveToResourceSrc(app, img.linkpath, sourcePath);
        if (resolvedSrc) {
            const safeAlt = escapeHtml(img.alt);
            const safeSrc = escapeHtml(resolvedSrc);
            html += `<img src="${safeSrc}" alt="${safeAlt}" class="lk-browser-inline-img" data-img-ref="${escapeHtml(img.match)}" />`;
        }
        else {
            // Image couldn't be resolved, keep as text
            html += escapeTextWithCircleFlags(img.match);
        }
        lastEnd = img.end;
    }
    // Add remaining text
    if (lastEnd < markdown.length) {
        html += escapeTextWithCircleFlags(markdown.substring(lastEnd));
    }
    return html;
}
