/**
 * @file src/imageocclusion/io-helpers.ts
 * @summary Shared utility functions for all Image Occlusion code. Provides vault-path normalisation, embed-syntax stripping, image file resolution via the metadata cache, MIME type mapping, DOM helper utilities, unique ID generation, anchor ID collection from note text, new card ID reservation, and the IO markdown block builder.
 *
 * @exports
 *   - normaliseVaultPath — normalises a vault-relative path (forward slashes, no leading slash)
 *   - extractIoImageRefs — extracts embedded IO image refs from a raw IO field in source order
 *   - selectPreferredIoImageRef — chooses the first resolvable IO image ref, else the first extracted ref
 *   - stripEmbedSyntax — strips ![[…]] embed syntax and optional |size suffix from a string
 *   - resolveImageFile — resolves an IO image reference to a vault TFile
 *   - mimeFromExt — maps a file extension to its MIME type
 *   - isEditableTarget — checks if a DOM element is an editable form control
 *   - emptyEl — empties an HTML element using Obsidian's .empty() or innerHTML
 *   - uid — generates a unique ID with an optional prefix
 *   - collectAnchorIdsFromText — collects all ^sprout-NNNNNNNNN anchor IDs from text
 *   - reserveNewBcId — generates a new unique Sprout card ID avoiding collisions
 *   - buildIoMarkdownWithAnchor — builds the markdown block lines for an IO card
 *   - IoEditorOpenOpts — type for options accepted by the IO editor modal
 */
import { TFile } from "obsidian";
import { generateUniqueId } from "../../platform/core/ids";
import { createCardAnchorGlobalRe } from "../../platform/core/identity";
import { formatPipeField } from "../../platform/modals/modal-utils";
// ── Vault-path utilities ────────────────────────────────────────────────────
/** Normalise a vault-relative path (forward slashes, no leading slash). */
export function normaliseVaultPath(p) {
    let s = String(p !== null && p !== void 0 ? p : "").trim();
    s = s.replace(/\\/g, "/");
    s = s.replace(/^\/+/, "");
    s = s.replace(/^\.\/+/, "");
    while (s.startsWith("../"))
        s = s.slice(3);
    s = s.replace(/\/{2,}/g, "/");
    return s;
}
function normalizePlainIoImageRef(raw) {
    return normaliseVaultPath(String(raw !== null && raw !== void 0 ? raw : "").trim());
}
function extractMarkdownImagePath(raw) {
    let s = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!s)
        return "";
    if (s.startsWith("<") && s.endsWith(">"))
        s = s.slice(1, -1).trim();
    const titledMatch = s.match(/^(.+?)(?:\s+(?:"[^"]*"|'[^']*'))$/);
    if (titledMatch === null || titledMatch === void 0 ? void 0 : titledMatch[1])
        s = titledMatch[1].trim();
    return normalizePlainIoImageRef(s);
}
export function extractIoImageRefs(raw) {
    var _a, _b, _c;
    const text = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!text)
        return [];
    const refs = [];
    const wikiRegex = /!\[\[([^\]]+)\]\]/g;
    let wikiMatch;
    while ((wikiMatch = wikiRegex.exec(text)) !== null) {
        const inside = String((_a = wikiMatch[1]) !== null && _a !== void 0 ? _a : "").trim();
        const linkpath = normalizePlainIoImageRef(String((_b = inside.split("|")[0]) !== null && _b !== void 0 ? _b : ""));
        if (!linkpath)
            continue;
        refs.push({ ref: linkpath, start: wikiMatch.index });
    }
    const markdownRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    let markdownMatch;
    while ((markdownMatch = markdownRegex.exec(text)) !== null) {
        const linkpath = extractMarkdownImagePath(String((_c = markdownMatch[1]) !== null && _c !== void 0 ? _c : ""));
        if (!linkpath)
            continue;
        refs.push({ ref: linkpath, start: markdownMatch.index });
    }
    if (refs.length) {
        refs.sort((a, b) => a.start - b.start);
        return refs.map((entry) => entry.ref);
    }
    if (/!\[\[|!\[[^\]]*\]\(/.test(text))
        return [];
    const plain = normalizePlainIoImageRef(text);
    return plain ? [plain] : [];
}
/** Strip `![[…]]` embed syntax and optional `|size` suffix. */
export function stripEmbedSyntax(raw) {
    var _a;
    return (_a = extractIoImageRefs(raw)[0]) !== null && _a !== void 0 ? _a : "";
}
function resolveSingleImageFile(app, sourceNotePath, imageRef) {
    const link = normalizePlainIoImageRef(imageRef);
    if (!link)
        return null;
    const dest = app.metadataCache.getFirstLinkpathDest(link, sourceNotePath);
    if (dest instanceof TFile)
        return dest;
    const af = app.vault.getAbstractFileByPath(link);
    if (af instanceof TFile)
        return af;
    return null;
}
export function selectPreferredIoImageRef(app, sourceNotePath, imageRef) {
    var _a;
    const refs = extractIoImageRefs(imageRef);
    if (!refs.length)
        return null;
    for (const ref of refs) {
        if (resolveSingleImageFile(app, sourceNotePath, ref) instanceof TFile)
            return ref;
    }
    return (_a = refs[0]) !== null && _a !== void 0 ? _a : null;
}
/**
 * Resolve an IO image reference (embed syntax or plain path) to a vault TFile.
 * Tries metadataCache link resolution first, then direct path lookup.
 *
 * Canonical implementation – `modal-utils.resolveIoImageFile` is an alias.
 */
export function resolveImageFile(app, sourceNotePath, imageRef) {
    const refs = extractIoImageRefs(imageRef);
    for (const ref of refs) {
        const file = resolveSingleImageFile(app, sourceNotePath, ref);
        if (file instanceof TFile)
            return file;
    }
    return null;
}
// ── MIME / extension helpers ────────────────────────────────────────────────
/** Map a file extension to its MIME type. */
export function mimeFromExt(ext) {
    const e = String(ext || "").toLowerCase();
    if (e === "png")
        return "image/png";
    if (e === "jpg" || e === "jpeg")
        return "image/jpeg";
    if (e === "webp")
        return "image/webp";
    if (e === "gif")
        return "image/gif";
    return "image/png";
}
// ── DOM utilities ───────────────────────────────────────────────────────────
/** Check if an element is an editable form control (input/textarea/contentEditable). */
export function isEditableTarget(el) {
    const e = el;
    if (!e)
        return false;
    const tag = String(e.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea")
        return true;
    if (e.isContentEditable)
        return true;
    return false;
}
/** Empty an element using Obsidian's `.empty()` or `innerHTML`. */
export function emptyEl(el) {
    if (typeof el.empty === "function")
        el.empty();
    else
        el.replaceChildren();
}
// ── ID / anchor helpers ─────────────────────────────────────────────────────
/** Generate a unique ID with an optional prefix. */
export function uid(prefix = "sprout-io") {
    return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}
/** Collect all `^sprout-NNNNNNNNN` anchor IDs from a text string. */
export function collectAnchorIdsFromText(text) {
    const out = new Set();
    const re = createCardAnchorGlobalRe();
    let m;
    while ((m = re.exec(text))) {
        if (m[1])
            out.add(m[1]);
    }
    return out;
}
/**
 * Generate a new unique Sprout card ID that doesn't collide with any
 * existing IDs in the store or in the note's anchor references.
 */
export async function reserveNewBcId(plugin, file) {
    var _a, _b, _c, _d;
    const store = plugin.store;
    const used = new Set();
    try {
        for (const k of Object.keys(((_a = store === null || store === void 0 ? void 0 : store.data) === null || _a === void 0 ? void 0 : _a.cards) || {}))
            used.add(String(k));
        for (const k of Object.keys(((_b = store === null || store === void 0 ? void 0 : store.data) === null || _b === void 0 ? void 0 : _b.quarantine) || {}))
            used.add(String(k));
        for (const k of Object.keys((_d = (_c = store === null || store === void 0 ? void 0 : store.data) === null || _c === void 0 ? void 0 : _c.cardById) !== null && _d !== void 0 ? _d : {}))
            used.add(String(k));
    }
    catch (_e) {
        // ignore
    }
    try {
        const txt = await plugin.app.vault.read(file);
        for (const id of collectAnchorIdsFromText(txt))
            used.add(id);
    }
    catch (_f) {
        // ignore
    }
    const id = String(generateUniqueId(used)).trim();
    return id;
}
// ── IO markdown builder ─────────────────────────────────────────────────────
/**
 * Build the markdown block for an IO card (pipe-format lines).
 */
export function buildIoMarkdownWithAnchor(params) {
    var _a, _b, _c;
    const out = [];
    if ((_a = params.title) === null || _a === void 0 ? void 0 : _a.trim())
        out.push(...formatPipeField("T", params.title.trim()));
    if ((_b = params.groups) === null || _b === void 0 ? void 0 : _b.trim())
        out.push(...formatPipeField("G", params.groups.trim()));
    out.push(...formatPipeField("IO", params.ioEmbed));
    // O (occlusions) and C (maskMode) are stored in store.io only, not in markdown
    if ((_c = params.info) === null || _c === void 0 ? void 0 : _c.trim())
        out.push(...formatPipeField("I", params.info.trim()));
    out.push("");
    return out;
}
