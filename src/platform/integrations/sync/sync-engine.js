/**
 * @file src/sync/sync-engine.ts
 * @summary Core sync engine for Sprout flashcards. Synchronises parsed card data from markdown files with the in-memory store and data.json on disk. Handles markdown prefix stripping, scheduling-state safety, recovery from lost scheduling data, card-signature diffing, anchor ID insertion and orphan removal, IO/cloze child management, and MCQ option conversion.
 *
 * @exports
 *  - formatSyncNotice  — formats a human-readable notice string summarising sync results
 *  - syncOneFile       — syncs a single markdown file's cards with the question bank
 *  - syncQuestionBank  — runs a full vault-wide sync across all markdown files
 */
import { TFile } from "obsidian";
import { parseCardsFromText } from "../../../engine/parser/parser";
import { generateUniqueId } from "../../../platform/core/ids";
import { normalizeCardOptions } from "../../../platform/types/card";
import { FLASHCARD_HEADER_CARD_RE, FLASHCARD_HEADER_FIELD_RE, BASIC_SHORTHAND_RE, CLOZE_SHORTHAND_RE, getDelimiter, escapeDelimiterText, } from "../../../platform/core/delimiter";
import { loadSchedulingFromDataJson } from "../../../platform/core/store";
import { expandGroupPrefixes, normaliseGroupPath } from "../../../engine/indexing/group-index";
import { log } from "../../../platform/core/logger";
import { stableIoChildId, normaliseGroupKey } from "../../../platform/image-occlusion/mask-tool";
import { resolveImageFile, selectPreferredIoImageRef } from "../../../platform/image-occlusion/io-helpers";
import { buildPrimaryCardAnchor, extractCardAnchorId, } from "../../../platform/core/identity";
import { countObjectKeys, joinPath, likelySproutStateKey, extractStatesFromDataJsonObject, tryReadJson, ensureRoutineBackupIfNeeded, listDataJsonBackups, readValidatedBackupStates, } from "./backup";
import { deleteTtsCacheForCardIds, getTtsCacheDirPath } from "../../../platform/integrations/tts/tts-cache";
const FILE_SYNC_LOCKS = new Map();
const VAULT_SYNC_LOCKS = new Map();
const VAULT_LOCK_KEY = "__sprout-vault-sync__";
async function withLock(lockMap, key, fn) {
    var _a;
    const prev = (_a = lockMap.get(key)) !== null && _a !== void 0 ? _a : Promise.resolve();
    let release = null;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    const chained = prev.then(() => current);
    lockMap.set(key, chained);
    await prev;
    try {
        return await fn();
    }
    finally {
        if (release)
            release();
        if (lockMap.get(key) === chained)
            lockMap.delete(key);
    }
}
async function waitForLock(lockMap, key) {
    const pending = lockMap.get(key);
    if (pending)
        await pending;
}
async function withFileSyncLock(filePath, fn) {
    await waitForLock(VAULT_SYNC_LOCKS, VAULT_LOCK_KEY);
    return withLock(FILE_SYNC_LOCKS, filePath, fn);
}
async function withVaultSyncLock(fn) {
    return withLock(VAULT_SYNC_LOCKS, VAULT_LOCK_KEY, async () => {
        if (FILE_SYNC_LOCKS.size > 0)
            await Promise.all([...FILE_SYNC_LOCKS.values()]);
        return fn();
    });
}
// ────────────────────────────────────────────
// formatSyncNotice (exported)
// ────────────────────────────────────────────
/**
 * Builds a human-readable sync summary string.
 *
 * Example output: "Sync complete - 3 new cards; 1 updated card; 2 cards deleted"
 */
export function formatSyncNotice(prefix, res, options = {}) {
    var _a, _b, _c;
    const plural = (n, one, many) => (n === 1 ? one : many);
    const parts = [];
    const deletedCount = Number((_a = res.removed) !== null && _a !== void 0 ? _a : 0);
    const idsInserted = Number((_b = res.idsInserted) !== null && _b !== void 0 ? _b : 0);
    if (res.newCount > 0)
        parts.push(`${res.newCount} ${plural(res.newCount, "new card", "new cards")}`);
    if (res.updatedCount > 0)
        parts.push(`${res.updatedCount} ${plural(res.updatedCount, "updated card", "updated cards")}`);
    if (options.includeDeleted && deletedCount > 0)
        parts.push(`${deletedCount} ${plural(deletedCount, "card deleted", "cards deleted")}`);
    if (((_c = options.includeIdsInserted) !== null && _c !== void 0 ? _c : true) && idsInserted > 0)
        parts.push(`${idsInserted} ${plural(idsInserted, "ID inserted", "IDs inserted")}`);
    if (!parts.length)
        return `${prefix} - no changes`;
    return `${prefix} - ${parts.join("; ")}`;
}
// ────────────────────────────────────────────
// Helpers: prefix handling (lists / blockquotes / indentation)
// ────────────────────────────────────────────
/** Splits leading Markdown list / blockquote / indent prefix from content. */
const PREFIX_RE = /^(\s*(?:(?:>\s*)|(?:[-*+]\s+)|(?:\d+\.\s+))*)(.*)$/;
function splitMdPrefix(line) {
    var _a, _b;
    const m = PREFIX_RE.exec(String(line !== null && line !== void 0 ? line : ""));
    if (!m)
        return { prefix: "", rest: String(line !== null && line !== void 0 ? line : "") };
    return { prefix: (_a = m[1]) !== null && _a !== void 0 ? _a : "", rest: (_b = m[2]) !== null && _b !== void 0 ? _b : "" };
}
/** Returns `true` if `rest` (after prefix strip) resembles a flashcard header/field/anchor. */
function looksLikeFlashcardHeader(rest) {
    const s = String(rest !== null && rest !== void 0 ? rest : "");
    if (extractCardAnchorId(s) !== null)
        return true;
    if (FLASHCARD_HEADER_CARD_RE().test(s))
        return true;
    if (FLASHCARD_HEADER_FIELD_RE().test(s))
        return true;
    if (/^\d+(?:\.\d+)?\s*\|\s*/.test(s))
        return true;
    if (CLOZE_SHORTHAND_RE.test(s))
        return true;
    if (BASIC_SHORTHAND_RE.test(s))
        return true;
    return false;
}
/**
 * Produces parse-friendly text while preserving line numbers:
 * strips Markdown prefixes from flashcard header/field lines only.
 */
function normaliseTextForParsing(originalText) {
    const lines = String(originalText !== null && originalText !== void 0 ? originalText : "").split(/\r?\n/);
    const out = lines.map((ln) => {
        const { rest } = splitMdPrefix(ln);
        return looksLikeFlashcardHeader(rest) ? rest : ln;
    });
    return out.join("\n");
}
/** Matches a Sprout anchor ID even inside list/quote prefixes. */
function matchAnchorId(line) {
    const { rest } = splitMdPrefix(line);
    return extractCardAnchorId(rest);
}
/** Infers the Markdown prefix at a given line index (for anchor insertion). */
function inferPrefixAt(lines, lineIndex) {
    const idx = Math.max(0, Math.min(lines.length, lineIndex));
    if (idx >= lines.length)
        return "";
    const { prefix, rest } = splitMdPrefix(lines[idx] || "");
    return looksLikeFlashcardHeader(rest) ? prefix : "";
}
// ────────────────────────────────────────────
// Scheduling safety / recovery
// ────────────────────────────────────────────
/** Checks whether a scheduling state already exists for `id`. */
function hasState(plugin, id) {
    const states = plugin.store.data.states;
    return !!(states && Object.prototype.hasOwnProperty.call(states, id));
}
/**
 * Create-only wrapper around `plugin.store.ensureState`.
 * Never resets an existing state — only creates if missing.
 */
function ensureStateIfMissing(plugin, id, now, defaultDifficulty) {
    if (hasState(plugin, id))
        return;
    plugin.store.ensureState(id, now, defaultDifficulty);
}
/**
 * Restores a card's scheduling state from a snapshot (e.g. a backup).
 * Returns `true` if the state was found and restored.
 */
function upsertStateIfPresent(plugin, snapshot, id) {
    if (!snapshot)
        return false;
    const st = snapshot[id];
    if (!st || typeof st !== "object")
        return false;
    plugin.store.upsertState({ ...st, id });
    return true;
}
/**
 * Scans on-disk data.json files (current + legacy plugin folders) to
 * find the best available scheduling snapshot for recovery.
 *
 * Used when the in-memory store has zero states but cards exist in notes.
 */
async function loadBestSchedulingSnapshot(plugin) {
    var _a, _b, _c, _d;
    const inMem = plugin.store.data.states;
    if (countObjectKeys(inMem) > 0)
        return inMem;
    // Try store helper first (may already do the right thing)
    try {
        const prev = await loadSchedulingFromDataJson(plugin);
        if (prev && typeof prev === "object" && Object.keys(prev).length > 0)
            return prev;
    }
    catch (_e) {
        // ignore
    }
    // Try direct disk read for current plugin folder
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    const pluginId = String((_d = (_c = plugin.manifest) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : "").trim() || null;
    const candidateFiles = ["data.json", "data.json.bak", "data.json.prev", "data.json.old", "data.json.backup"];
    const configDir = plugin.app.vault.configDir;
    if (pluginId) {
        for (const name of candidateFiles) {
            const p = joinPath(configDir, "plugins", pluginId, name);
            const obj = await tryReadJson(adapter, p);
            const states = extractStatesFromDataJsonObject(obj);
            if (!states || Object.keys(states).length === 0)
                continue;
            const keys = Object.keys(states);
            const validKeyCount = keys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
            if (keys.length > 0 && validKeyCount / keys.length < 0.7)
                continue;
            return states;
        }
    }
    // Scan backups within this plugin's folder (newest first) and pick the first valid snapshot.
    if (pluginId) {
        const entries = await listDataJsonBackups(plugin);
        for (const entry of entries) {
            const p = entry.path;
            const validated = await readValidatedBackupStates(plugin, p);
            if (!(validated === null || validated === void 0 ? void 0 : validated.states))
                continue;
            const keys = Object.keys(validated.states);
            const validKeyCount = keys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
            if (keys.length > 0 && validKeyCount / keys.length < 0.7)
                continue;
            return validated.states;
        }
    }
    // NOTE: Only scans this plugin's own data.json variants and backup folder.
    // extractStatesFromDataJsonObject() validates state structure to prevent
    // loading corrupted or foreign data (checks for FSRS fields, Sprout key patterns).
    return null;
}
/**
 * Decides if the current run should use "recovery mode":
 * store has zero scheduling, but parsed cards exist in markdown.
 */
function isLikelyRecoveryScenario(plugin, parsedCardCount) {
    const stateCount = countObjectKeys(plugin.store.data.states);
    const cardCount = countObjectKeys(plugin.store.data.cards);
    if (stateCount > 0)
        return false;
    return cardCount === 0 && parsedCardCount > 0;
}
// ────────────────────────────────────────────
// Card signature (for updatedCount detection)
// ────────────────────────────────────────────
/**
 * Produces a deterministic JSON string representing a card's content.
 * Used to detect whether a card's content has changed since last sync.
 */
function cardSignature(rec) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    if (!rec)
        return "";
    const base = {
        type: rec.type,
        title: rec.title || "",
        info: rec.info || "",
        groups: Array.isArray(rec.groups) ? rec.groups : [],
    };
    if (rec.type === "basic" || rec.type === "reversed") {
        base.q = rec.q || "";
        base.a = rec.a || "";
    }
    else if (rec.type === "mcq") {
        base.stem = rec.stem || "";
        base.options = normalizeCardOptions(rec.options);
        base.correctIndex = Number.isFinite(rec.correctIndex) ? rec.correctIndex : -1;
        base.correctIndices = Array.isArray(rec.correctIndices) ? rec.correctIndices : [];
        base.a = rec.a || "";
    }
    else if (rec.type === "cloze") {
        base.clozeText = rec.clozeText || "";
        base.clozeChildren = Array.isArray(rec.clozeChildren) ? rec.clozeChildren : [];
    }
    else if (rec.type === "io") {
        const legacy = rec;
        base.imageRef = (_c = (_b = (_a = rec.imageRef) !== null && _a !== void 0 ? _a : legacy.ioSrc) !== null && _b !== void 0 ? _b : legacy.src) !== null && _c !== void 0 ? _c : "";
        base.occlusions = ((_f = (_e = (_d = legacy.occlusions) !== null && _d !== void 0 ? _d : legacy.rects) !== null && _e !== void 0 ? _e : legacy.masks) !== null && _f !== void 0 ? _f : []);
        base.maskMode = (_h = (_g = rec.maskMode) !== null && _g !== void 0 ? _g : legacy.mode) !== null && _h !== void 0 ? _h : null;
    }
    else if (rec.type === "io-child") {
        base.parentId = rec.parentId || "";
        base.groupKey = rec.groupKey || "";
        base.rectIds = Array.isArray(rec.rectIds) ? rec.rectIds : [];
        base.imageRef = (_j = rec.imageRef) !== null && _j !== void 0 ? _j : "";
        base.maskMode = (_k = rec.maskMode) !== null && _k !== void 0 ? _k : null;
        base.retired = !!rec.retired;
    }
    else if (rec.type === "cloze-child") {
        base.parentId = rec.parentId || "";
        base.clozeIndex = Number.isFinite(rec.clozeIndex) ? rec.clozeIndex : -1;
        base.clozeText = rec.clozeText || "";
    }
    else if (rec.type === "reversed-child") {
        base.parentId = rec.parentId || "";
        base.reversedDirection = rec.reversedDirection || "forward";
        base.q = rec.q || "";
        base.a = rec.a || "";
    }
    else if (rec.type === "oq") {
        base.q = rec.q || "";
        base.oqSteps = Array.isArray(rec.oqSteps) ? rec.oqSteps : [];
    }
    return JSON.stringify(base);
}
// ────────────────────────────────────────────
// Deprecated type cleanup
// ────────────────────────────────────────────
/** Removes cards with legacy types ("lq", "fq") from cards + quarantine. */
function purgeDeprecatedTypes(plugin) {
    var _a;
    const cards = plugin.store.data.cards || {};
    const states = plugin.store.data.states || {};
    for (const [id, rec] of Object.entries(cards)) {
        const t = String((_a = rec === null || rec === void 0 ? void 0 : rec.type) !== null && _a !== void 0 ? _a : "").toLowerCase();
        if (t === "lq" || t === "fq") {
            delete cards[id];
            delete (states)[id];
        }
    }
    const quarantine = plugin.store.data.quarantine || {};
    for (const [id, rec] of Object.entries(quarantine)) {
        const rawType = rec === null || rec === void 0 ? void 0 : rec.type;
        const t = (typeof rawType === "string" ? rawType : "").toLowerCase();
        if (t === "lq" || t === "fq")
            delete quarantine[id];
    }
}
/** Quarantines IO cards whose referenced image file is missing from the vault. */
function quarantineIoCardsWithMissingImages(plugin) {
    const cards = plugin.store.data.cards || {};
    const now = Date.now();
    let count = 0;
    for (const [id, rec] of Object.entries(cards)) {
        if (!rec || String(rec.type) !== "io")
            continue;
        const sourceNotePath = String(rec.sourceNotePath || "");
        const legacyIoSrc = rec.ioSrc;
        const rawImageRef = typeof rec.imageRef === "string"
            ? rec.imageRef
            : typeof legacyIoSrc === "string"
                ? legacyIoSrc
                : "";
        const imageRef = selectPreferredIoImageRef(plugin.app, sourceNotePath, rawImageRef);
        if (!imageRef)
            continue;
        const imageFile = resolveImageFile(plugin.app, sourceNotePath, rawImageRef || imageRef);
        if (!imageFile || !(imageFile instanceof TFile)) {
            plugin.store.data.quarantine[id] = {
                id,
                notePath: rec.sourceNotePath || "",
                sourceStartLine: rec.sourceStartLine || 0,
                reason: `Image file not found: ${imageRef}`,
                lastSeenAt: now,
            };
            delete plugin.store.data.cards[id];
            count += 1;
        }
    }
    return count;
}
// ────────────────────────────────────────────
// Anchor / edit utilities
// ────────────────────────────────────────────
/** Finds the contiguous non-blank block around `cardStartLine`. */
function getBlockBounds(lines, cardStartLine) {
    const isBlank = (s) => (s || "").trim().length === 0;
    const start = Math.max(0, Math.min(lines.length - 1, cardStartLine));
    let lo = start;
    while (lo > 0 && !isBlank(lines[lo - 1]))
        lo--;
    let hi = start;
    while (hi < lines.length && !isBlank(lines[hi]))
        hi++;
    return { lo, hi };
}
/**
 * Finds the line index where a card anchor should be inserted.
 * Places it directly before the first flashcard row in the contiguous block.
 */
function findAnchorInsertLineIndex(lines, cardStartLine) {
    const { lo: blockLo, hi: blockHi } = getBlockBounds(lines, cardStartLine);
    const start = Math.max(0, Math.min(lines.length - 1, cardStartLine));
    for (let i = blockLo; i < blockHi; i++) {
        const { rest } = splitMdPrefix(lines[i] || "");
        if (looksLikeFlashcardHeader(rest))
            return i;
    }
    return start;
}
/** Collects all Sprout anchor IDs found in the line array. */
function collectAnchorIdsFromLines(lines) {
    const out = new Set();
    for (const ln of lines) {
        const id = matchAnchorId(ln);
        if (id)
            out.add(id);
    }
    return out;
}
/** Returns line indices of anchors whose IDs are NOT in `keepIds`. */
function collectAnchorLineIndicesToDelete(lines, keepIds) {
    const dels = [];
    for (let i = 0; i < lines.length; i++) {
        const id = matchAnchorId(lines[i] || "");
        if (!id)
            continue;
        if (!keepIds.has(id))
            dels.push(i);
    }
    return dels;
}
/**
 * Applies a batch of text edits (insertions + deletions) to a line array.
 * Processes edits from bottom to top to preserve earlier line indices.
 */
function applyEditsToLines(lines, edits) {
    var _a, _b;
    const byIdx = new Map();
    for (const e of edits) {
        const idx = Math.max(0, Math.min(lines.length, e.lineIndex));
        const arr = (_a = byIdx.get(idx)) !== null && _a !== void 0 ? _a : [];
        arr.push({ ...e, lineIndex: idx });
        byIdx.set(idx, arr);
    }
    const indices = Array.from(byIdx.keys()).sort((a, b) => b - a);
    for (const idx of indices) {
        const ops = (_b = byIdx.get(idx)) !== null && _b !== void 0 ? _b : [];
        const dels = ops.filter((o) => o.deleteLine);
        const ins = ops.filter((o) => typeof o.insertText === "string" && o.insertText.length);
        for (let i = 0; i < dels.length; i++) {
            if (idx >= 0 && idx < lines.length)
                lines.splice(idx, 1);
        }
        for (const o of ins) {
            const parts = String(o.insertText || "").split("\n");
            lines.splice(idx, 0, ...parts);
        }
    }
    return lines;
}
// ────────────────────────────────────────────
// IO cleanup helpers
// ────────────────────────────────────────────
/** Deletes the image file associated with an IO card. */
async function deleteIoImage(plugin, imageRef, sourceNotePath) {
    const preferredRef = selectPreferredIoImageRef(plugin.app, sourceNotePath, imageRef);
    if (!preferredRef)
        return;
    try {
        const file = resolveImageFile(plugin.app, sourceNotePath, imageRef);
        if (file && file instanceof TFile)
            await plugin.app.fileManager.trashFile(file);
    }
    catch (e) {
        log.warn(`Failed to delete IO image ${preferredRef}:`, e);
    }
}
// ────────────────────────────────────────────
// Shared child-record helpers
// ────────────────────────────────────────────
/** Deletes all child records (and their states) of `childType` for a given `parentId`. */
function deleteChildrenByType(plugin, parentId, childType) {
    let deleted = 0;
    const pid = String(parentId || "");
    for (const id of Object.keys(plugin.store.data.cards || {})) {
        const rec = plugin.store.data.cards[id];
        if (!rec)
            continue;
        if (String(rec.type) !== childType)
            continue;
        if (String(rec.parentId || "") !== pid)
            continue;
        delete plugin.store.data.cards[id];
        if (plugin.store.data.states)
            delete (plugin.store.data.states)[id];
        deleted += 1;
    }
    // Defensive: clean child entries from quarantine too.
    for (const id of Object.keys(plugin.store.data.quarantine || {})) {
        const q = plugin.store.data.quarantine[id];
        if (!q)
            continue;
        const qRec = q;
        const qType = typeof qRec.type === "string" ? qRec.type : "";
        const qParentId = typeof qRec.parentId === "string" ? qRec.parentId : "";
        if (qType !== childType)
            continue;
        if (qParentId !== pid)
            continue;
        delete plugin.store.data.quarantine[id];
        if (plugin.store.data.states)
            delete (plugin.store.data.states)[id];
        deleted += 1;
    }
    return deleted;
}
/** Sweep: deletes child cards of `childType` whose parentId no longer exists as a `parentType` card. */
function deleteOrphanChildren(plugin, parentType, childType) {
    var _a;
    const liveParents = new Set();
    for (const id of Object.keys(plugin.store.data.cards || {})) {
        const rec = plugin.store.data.cards[id];
        if (!rec)
            continue;
        if (String(rec.type) === parentType)
            liveParents.add(String((_a = rec.id) !== null && _a !== void 0 ? _a : id));
    }
    let removed = 0;
    for (const id of Object.keys(plugin.store.data.cards || {})) {
        const rec = plugin.store.data.cards[id];
        if (!rec)
            continue;
        if (String(rec.type) !== childType)
            continue;
        const pid = String(rec.parentId || "");
        if (!pid || !liveParents.has(pid)) {
            delete plugin.store.data.cards[id];
            if (plugin.store.data.states)
                delete (plugin.store.data.states)[id];
            removed += 1;
        }
    }
    return removed;
}
/** Collects existing child records of `childType` for a given `parentId`. */
function collectExistingChildren(plugin, parentId, childType) {
    const out = [];
    for (const c of Object.values(plugin.store.data.cards || {})) {
        if (!c)
            continue;
        if (c.type !== childType)
            continue;
        if (String(c.parentId || "") !== parentId)
            continue;
        out.push(c);
    }
    return out;
}
/** Resolves the createdAt timestamp for a child record (preserves existing, falls back to parent, then now). */
function resolveChildCreatedAt(prev, parent, now) {
    if (prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0)
        return Number(prev.createdAt);
    if (Number.isFinite(parent === null || parent === void 0 ? void 0 : parent.createdAt) && Number(parent.createdAt) > 0)
        return Number(parent.createdAt);
    return now;
}
/** Upserts a child card record, merging with previous if it exists, and ensures scheduling state. */
function upsertChildRecord(plugin, childId, rec, now, schedulingSnapshot, stateHook) {
    var _a;
    const prev = (_a = plugin.store.data.cards) === null || _a === void 0 ? void 0 : _a[childId];
    if (prev && typeof prev === "object") {
        const merged = { ...prev, ...rec };
        plugin.store.data.cards[childId] = merged;
        plugin.store.upsertCard(merged);
    }
    else {
        plugin.store.data.cards[childId] = rec;
        plugin.store.upsertCard(rec);
    }
    if (!hasState(plugin, childId)) {
        // Allow callers to inject custom state logic (e.g., reversed migration)
        if (stateHook && stateHook(childId))
            return;
        const restored = upsertStateIfPresent(plugin, schedulingSnapshot, childId);
        if (!restored)
            ensureStateIfMissing(plugin, childId, now, 2.5);
    }
}
/** Removes child records not in `keepChildIds`. */
function pruneStaleChildren(plugin, existingChildren, keepChildIds) {
    for (const ch of existingChildren) {
        const id = String(ch.id || "");
        if (!id)
            continue;
        if (keepChildIds.has(id))
            continue;
        delete plugin.store.data.cards[id];
        if (plugin.store.data.states)
            delete (plugin.store.data.states)[id];
    }
}
/**
 * Removes scheduling states that no longer correspond to any live card or quarantine entry.
 * This keeps backup/state counts aligned with studyable data and prevents stale carry-over.
 */
function sanitizeOrphanStates(plugin) {
    const states = plugin.store.data.states || {};
    const liveIds = new Set([
        ...Object.keys(plugin.store.data.cards || {}),
        ...Object.keys(plugin.store.data.quarantine || {}),
    ]);
    let removed = 0;
    for (const id of Object.keys(states)) {
        if (liveIds.has(id))
            continue;
        delete states[id];
        removed += 1;
    }
    return removed;
}
// Convenience wrappers (preserve call-site readability)
function deleteIoChildren(plugin, parentId) { return deleteChildrenByType(plugin, parentId, "io-child"); }
function deleteClozeChildren(plugin, parentId) { return deleteChildrenByType(plugin, parentId, "cloze-child"); }
function deleteReversedChildren(plugin, parentId) { return deleteChildrenByType(plugin, parentId, "reversed-child"); }
function deleteOrphanIoChildren(plugin) { return deleteOrphanChildren(plugin, "io", "io-child"); }
function deleteOrphanClozeChildren(plugin) { return deleteOrphanChildren(plugin, "cloze", "cloze-child"); }
function deleteOrphanReversedChildren(plugin) { return deleteOrphanChildren(plugin, "reversed", "reversed-child"); }
// ────────────────────────────────────────────
// Child-type-specific utilities
// ────────────────────────────────────────────
/** Extracts cloze deletion indices (e.g. `{{c1::…}}`) from raw text. */
function extractClozeIndices(text) {
    const raw = String(text !== null && text !== void 0 ? text : "");
    const re = /\{\{c(\d+)::/gi;
    const out = new Set();
    let m;
    while ((m = re.exec(raw))) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0)
            out.add(n);
    }
    return Array.from(out).sort((a, b) => a - b);
}
/** Stable deterministic ID for a cloze child: `${parentId}::cloze::c${idx}`. */
function stableClozeChildId(parentId, idx) {
    return `${parentId}::cloze::c${idx}`;
}
/** Stable deterministic ID for a reversed child: `${parentId}::reversed::${dir}`. */
function stableReversedChildId(parentId, dir) {
    return `${parentId}::reversed::${dir}`;
}
/**
 * Synchronises reversed-child records with a parent reversed card.
 * Creates two children: "forward" (Q→A) and "back" (A→Q), each with
 * independent scheduling.
 */
function syncReversedChildren(plugin, parent, now, schedulingSnapshot) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const parentId = String((_a = parent === null || parent === void 0 ? void 0 : parent.id) !== null && _a !== void 0 ? _a : "");
    if (!parentId)
        return;
    const directions = ["forward", "back"];
    const keepChildIds = new Set();
    const existingChildren = collectExistingChildren(plugin, parentId, "reversed-child");
    const titleBase = String((_b = parent === null || parent === void 0 ? void 0 : parent.title) !== null && _b !== void 0 ? _b : "").trim();
    for (const dir of directions) {
        const childId = stableReversedChildId(parentId, dir);
        keepChildIds.add(childId);
        const prev = (_c = plugin.store.data.cards) === null || _c === void 0 ? void 0 : _c[childId];
        const dirLabel = dir === "forward" ? "Q→A" : "A→Q";
        const childTitle = titleBase ? `${titleBase} • ${dirLabel}` : null;
        const rec = {
            id: childId,
            type: "reversed-child",
            title: childTitle,
            parentId,
            reversedDirection: dir,
            q: (_d = parent === null || parent === void 0 ? void 0 : parent.q) !== null && _d !== void 0 ? _d : null,
            a: (_e = parent === null || parent === void 0 ? void 0 : parent.a) !== null && _e !== void 0 ? _e : null,
            info: (_f = parent === null || parent === void 0 ? void 0 : parent.info) !== null && _f !== void 0 ? _f : null,
            groups: (_g = parent === null || parent === void 0 ? void 0 : parent.groups) !== null && _g !== void 0 ? _g : null,
            sourceNotePath: String((parent === null || parent === void 0 ? void 0 : parent.sourceNotePath) || ""),
            sourceStartLine: Number((_h = parent === null || parent === void 0 ? void 0 : parent.sourceStartLine) !== null && _h !== void 0 ? _h : 0) || 0,
            createdAt: resolveChildCreatedAt(prev, parent, now),
            updatedAt: now,
            lastSeenAt: now,
        };
        // Custom state hook: Basic → Reversed migration for the forward child
        const stateHook = (cid) => {
            var _a;
            if (dir === "forward" && hasState(plugin, parentId)) {
                const parentState = (_a = plugin.store.data.states) === null || _a === void 0 ? void 0 : _a[parentId];
                if (parentState && typeof parentState === "object") {
                    plugin.store.upsertState({ ...parentState, id: cid });
                    delete plugin.store.data.states[parentId];
                }
                return true;
            }
            return false;
        };
        upsertChildRecord(plugin, childId, rec, now, schedulingSnapshot, stateHook);
    }
    pruneStaleChildren(plugin, existingChildren, keepChildIds);
}
/** Collects all normalised group keys (including prefixes) across cards. */
function collectGroupKeys(cards) {
    const out = new Set();
    for (const card of Object.values(cards || {})) {
        if (!card)
            continue;
        const groups = Array.isArray(card.groups) ? card.groups : [];
        for (const raw of groups) {
            const norm = normaliseGroupPath(raw);
            if (!norm)
                continue;
            for (const k of expandGroupPrefixes(norm))
                out.add(k);
        }
    }
    return out;
}
/** Returns the number of group keys removed between two snapshots. */
function countRemovedGroups(before, after) {
    let removed = 0;
    for (const k of before)
        if (!after.has(k))
            removed += 1;
    return removed;
}
/**
 * Deletes orphaned IO images from the vault.
 * An image is orphaned if it matches `sprout-io-*` but no IO card references it.
 */
async function deleteOrphanedIoImages(plugin) {
    var _a, _b;
    if (!((_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage) === null || _b === void 0 ? void 0 : _b.deleteOrphanedImages))
        return 0;
    const vault = plugin.app.vault;
    const allFiles = vault.getFiles();
    const referencedIoIds = new Set();
    // Collect IO card IDs and unique file paths containing IO cards
    const ioCardIds = new Set();
    const ioFilePaths = new Set();
    for (const id of Object.keys(plugin.store.data.cards || {})) {
        const card = plugin.store.data.cards[id];
        if (card && String(card.type) === "io") {
            ioCardIds.add(String(id));
            if (card.sourceNotePath) {
                ioFilePaths.add(card.sourceNotePath);
            }
        }
    }
    // Only scan markdown files that contain IO cards
    const re = /sprout-io-(\d{9})/g;
    for (const filePath of ioFilePaths) {
        const md = vault.getAbstractFileByPath(filePath);
        if (!(md instanceof TFile))
            continue;
        try {
            const text = await vault.read(md);
            let match;
            while ((match = re.exec(text))) {
                if (match[1])
                    referencedIoIds.add(match[1]);
            }
        }
        catch (_c) {
            // ignore
        }
        re.lastIndex = 0;
    }
    let deleted = 0;
    for (const file of allFiles) {
        if (!(file instanceof TFile))
            continue;
        const match = /sprout-io-(\d{9})/.exec(file.name);
        if (!match)
            continue;
        const ioId = match[1];
        if (referencedIoIds.has(ioId))
            continue;
        if (ioCardIds.has(ioId))
            continue;
        try {
            await plugin.app.fileManager.trashFile(file);
            deleted += 1;
        }
        catch (e) {
            log.warn(`Failed to delete orphaned IO image ${file.path}:`, e);
        }
    }
    return deleted;
}
/**
 * Synchronises cloze-child records with a parent cloze card.
 * Creates new children for added deletions, preserves existing ones,
 * and removes children for deletions that no longer exist.
 */
function syncClozeChildren(plugin, parent, now, schedulingSnapshot) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const parentId = String((_a = parent === null || parent === void 0 ? void 0 : parent.id) !== null && _a !== void 0 ? _a : "");
    if (!parentId)
        return;
    const clozeIndices = extractClozeIndices((_b = parent === null || parent === void 0 ? void 0 : parent.clozeText) !== null && _b !== void 0 ? _b : "");
    const keepChildIds = new Set();
    const existingChildren = collectExistingChildren(plugin, parentId, "cloze-child");
    const titleBase = String((_c = parent === null || parent === void 0 ? void 0 : parent.title) !== null && _c !== void 0 ? _c : "").trim();
    for (const idx of clozeIndices) {
        const childId = stableClozeChildId(parentId, idx);
        keepChildIds.add(childId);
        const prev = (_d = plugin.store.data.cards) === null || _d === void 0 ? void 0 : _d[childId];
        const childTitle = titleBase ? `${titleBase} • c${idx}` : null;
        const rec = {
            id: childId,
            type: "cloze-child",
            title: childTitle,
            parentId,
            clozeIndex: idx,
            clozeText: (_e = parent === null || parent === void 0 ? void 0 : parent.clozeText) !== null && _e !== void 0 ? _e : null,
            info: (_f = parent === null || parent === void 0 ? void 0 : parent.info) !== null && _f !== void 0 ? _f : null,
            groups: (_g = parent === null || parent === void 0 ? void 0 : parent.groups) !== null && _g !== void 0 ? _g : null,
            sourceNotePath: String((parent === null || parent === void 0 ? void 0 : parent.sourceNotePath) || ""),
            sourceStartLine: Number((_h = parent === null || parent === void 0 ? void 0 : parent.sourceStartLine) !== null && _h !== void 0 ? _h : 0) || 0,
            createdAt: resolveChildCreatedAt(prev, parent, now),
            updatedAt: now,
            lastSeenAt: now,
        };
        upsertChildRecord(plugin, childId, rec, now, schedulingSnapshot);
    }
    pruneStaleChildren(plugin, existingChildren, keepChildIds);
}
// ────────────────────────────────────────────
// IO child sync (analogous to syncClozeChildren)
// ────────────────────────────────────────────
/**
 * Ensures io-child records exist for an IO parent card.
 * Reads rect data from store.data.io[parentId]; if that entry is missing
 * but the parent record has an `occlusions` array, rebuilds the IO map entry
 * from that data so children can be created.
 */
function syncIoChildren(plugin, parent, now, schedulingSnapshot) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    const parentId = String((_a = parent === null || parent === void 0 ? void 0 : parent.id) !== null && _a !== void 0 ? _a : "");
    if (!parentId)
        return;
    // Ensure the IO map exists
    if (!plugin.store.data.io)
        plugin.store.data.io = {};
    const ioMap = plugin.store.data.io;
    // If no IO map entry, rebuild from parent.occlusions (parsed from markdown)
    if (!ioMap[parentId]) {
        const legacy = parent;
        const rawOcclusions = legacy.occlusions;
        const imageRef = normalizeIoImageRef(legacy.imageRef);
        const maskMode = (_b = legacy.maskMode) !== null && _b !== void 0 ? _b : null;
        if (Array.isArray(rawOcclusions) && rawOcclusions.length > 0 && imageRef) {
            const rects = [];
            for (const r of rawOcclusions) {
                if (!r || typeof r !== "object")
                    continue;
                const rect = r;
                const rectIdRaw = (_c = rect.rectId) !== null && _c !== void 0 ? _c : rect.id;
                let rectId;
                if (typeof rectIdRaw === 'string') {
                    rectId = rectIdRaw;
                }
                else if (typeof rectIdRaw === 'number' || typeof rectIdRaw === 'boolean') {
                    rectId = String(rectIdRaw);
                }
                else {
                    rectId = `r-${Math.random().toString(16).slice(2)}`;
                }
                rects.push({
                    rectId,
                    x: Number((_d = rect.x) !== null && _d !== void 0 ? _d : 0),
                    y: Number((_e = rect.y) !== null && _e !== void 0 ? _e : 0),
                    w: Number((_g = (_f = rect.w) !== null && _f !== void 0 ? _f : rect.width) !== null && _g !== void 0 ? _g : 0),
                    h: Number((_j = (_h = rect.h) !== null && _h !== void 0 ? _h : rect.height) !== null && _j !== void 0 ? _j : 0),
                    groupKey: normaliseGroupKey(rect.groupKey),
                    shape: (rect.shape === "circle" ? "circle" : "rect"),
                });
            }
            if (rects.length > 0) {
                ioMap[parentId] = { imageRef, maskMode, rects };
            }
        }
    }
    const ioDef = ioMap[parentId];
    if (!ioDef || !Array.isArray(ioDef.rects) || ioDef.rects.length === 0)
        return;
    // Group rects by groupKey
    const groupToRectIds = new Map();
    for (const r of ioDef.rects) {
        const g = normaliseGroupKey(r.groupKey);
        const arr = (_k = groupToRectIds.get(g)) !== null && _k !== void 0 ? _k : [];
        arr.push(String(r.rectId));
        groupToRectIds.set(g, arr);
    }
    const existingChildren = collectExistingChildren(plugin, parentId, "io-child");
    const keepChildIds = new Set();
    const titleBase = String((_l = parent === null || parent === void 0 ? void 0 : parent.title) !== null && _l !== void 0 ? _l : "").trim();
    const legacy = parent;
    for (const [groupKey, rectIds] of groupToRectIds.entries()) {
        const childId = stableIoChildId(parentId, groupKey);
        keepChildIds.add(childId);
        const prev = (_m = plugin.store.data.cards) === null || _m === void 0 ? void 0 : _m[childId];
        const rec = {
            id: childId,
            type: "io-child",
            title: titleBase || null,
            parentId,
            groupKey,
            rectIds: rectIds.slice(),
            retired: false,
            prompt: (_o = legacy.prompt) !== null && _o !== void 0 ? _o : null,
            info: (_p = parent === null || parent === void 0 ? void 0 : parent.info) !== null && _p !== void 0 ? _p : null,
            groups: (_q = parent === null || parent === void 0 ? void 0 : parent.groups) !== null && _q !== void 0 ? _q : null,
            sourceNotePath: String((parent === null || parent === void 0 ? void 0 : parent.sourceNotePath) || ""),
            sourceStartLine: Number((_r = parent === null || parent === void 0 ? void 0 : parent.sourceStartLine) !== null && _r !== void 0 ? _r : 0) || 0,
            imageRef: ioDef.imageRef || null,
            maskMode: ioDef.maskMode || null,
            createdAt: resolveChildCreatedAt(prev, parent, now),
            updatedAt: now,
            lastSeenAt: now,
        };
        upsertChildRecord(plugin, childId, rec, now, schedulingSnapshot);
    }
    // Remove orphan io-children for this parent
    pruneStaleChildren(plugin, existingChildren, keepChildIds);
}
// ────────────────────────────────────────────
// MCQ option conversion (parser → store legacy fields)
// ────────────────────────────────────────────
/**
 * Converts parsed MCQ data into store fields (`options[]` + `correctIndex` + `correctIndices`).
 */
function mcqLegacyFromParsed(c) {
    var _a;
    if (c.type === "mcq") {
        // Collect all options preserving order (corrects first, then wrongs — as set by parser)
        const allOpts = Array.isArray(c.options) ? c.options : [];
        const options = [];
        const correctIndices = [];
        for (const opt of allOpts) {
            const text = String((_a = opt.text) !== null && _a !== void 0 ? _a : "").trim();
            if (!text)
                continue;
            if (opt.isCorrect)
                correctIndices.push(options.length);
            options.push(text);
        }
        // Legacy compat: if no options but c.a exists, build from c.a + wrong options
        if (options.length === 0) {
            const correct = typeof c.a === "string" ? c.a.trim() : null;
            let wrongs = Array.isArray(c.options) ? c.options.map((o) => { var _a; return String((_a = o.text) !== null && _a !== void 0 ? _a : "").trim(); }) : [];
            if (correct) {
                wrongs = wrongs.filter(w => w !== correct);
                return { options: [correct, ...wrongs], correctIndex: 0, correctIndices: [0] };
            }
            return { options: wrongs, correctIndex: null, correctIndices: [] };
        }
        const correctIndex = correctIndices.length > 0 ? correctIndices[0] : null;
        return { options, correctIndex, correctIndices };
    }
    // fallback legacy
    const opts = Array.isArray(c.options) ? c.options : [];
    const options = opts.map((o) => { var _a; return String((_a = o === null || o === void 0 ? void 0 : o.text) !== null && _a !== void 0 ? _a : ""); }).map((s) => s.trim());
    let correctIndex = Number.isFinite(c.correctIndex) && c.correctIndex !== null ? c.correctIndex : null;
    if (correctIndex === null) {
        const idx = opts.findIndex((o) => !!(o === null || o === void 0 ? void 0 : o.isCorrect));
        correctIndex = idx >= 0 ? idx : null;
    }
    const correctIndices = correctIndex !== null ? [correctIndex] : [];
    return { options, correctIndex, correctIndices };
}
// ────────────────────────────────────────────
// IO extraction (tolerant)
// ────────────────────────────────────────────
/**
 * Normalises an IO image reference: handles `![[embed]]`, `![alt](url)`,
 * and plain path strings. Returns `null` for empty/invalid refs.
 */
function normalizeIoImageRef(raw) {
    var _a, _b;
    const text = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (!text)
        return null;
    const embedMatch = text.match(/!\[\[([^\]]+)\]\]/);
    if (embedMatch === null || embedMatch === void 0 ? void 0 : embedMatch[1]) {
        const inner = embedMatch[1].trim();
        return ((_a = inner.split("|")[0]) === null || _a === void 0 ? void 0 : _a.trim()) || null;
    }
    const mdMatch = text.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (mdMatch === null || mdMatch === void 0 ? void 0 : mdMatch[1]) {
        const inner = mdMatch[1].trim();
        return ((_b = inner.split(" ")[0]) === null || _b === void 0 ? void 0 : _b.trim()) || null;
    }
    return text;
}
/** Extracts IO-specific fields from a parsed card. */
function ioFieldsFromParsed(plugin, c) {
    var _a, _b, _c, _d, _e;
    const legacy = c;
    const rawImageRef = typeof (legacy === null || legacy === void 0 ? void 0 : legacy.imageRef) === "string"
        ? legacy.imageRef
        : typeof (c === null || c === void 0 ? void 0 : c.ioSrc) === "string"
            ? c.ioSrc
            : null;
    const imageRef = (_a = selectPreferredIoImageRef(plugin.app, c.sourceNotePath, rawImageRef !== null && rawImageRef !== void 0 ? rawImageRef : "")) !== null && _a !== void 0 ? _a : normalizeIoImageRef(rawImageRef);
    const occlusionsRaw = (_b = c === null || c === void 0 ? void 0 : c.occlusions) !== null && _b !== void 0 ? _b : null;
    const occlusions = Array.isArray(occlusionsRaw) ? occlusionsRaw : null;
    const maskMode = ((_e = (_d = (_c = c === null || c === void 0 ? void 0 : c.maskMode) !== null && _c !== void 0 ? _c : legacy === null || legacy === void 0 ? void 0 : legacy.mode) !== null && _d !== void 0 ? _d : legacy === null || legacy === void 0 ? void 0 : legacy.ioMode) !== null && _e !== void 0 ? _e : null);
    return { imageRef, occlusions, maskMode };
}
/** Regex to extract a Sprout IO image ID from a filename. */
const IO_IMAGE_ID_RE = /sprout-io-(\d{9})/i;
/** Attempts to infer the card ID from an IO card's image reference. */
function inferIoIdFromCard(c) {
    var _a, _b;
    if (!c || c.type !== "io")
        return null;
    const raw = String((_a = c === null || c === void 0 ? void 0 : c.ioSrc) !== null && _a !== void 0 ? _a : "");
    if (!raw)
        return null;
    const match = IO_IMAGE_ID_RE.exec(raw);
    return (_b = match === null || match === void 0 ? void 0 : match[1]) !== null && _b !== void 0 ? _b : null;
}
/** Collect all card IDs currently linked to a given note path (including child cards). */
function collectCardIdsForNote(plugin, notePath) {
    const out = new Set();
    for (const [id, rec] of Object.entries(plugin.store.data.cards || {})) {
        if (!rec)
            continue;
        if (String(rec.sourceNotePath || "") !== notePath)
            continue;
        out.add(String(id));
    }
    return out;
}
/** Best-effort cleanup of external TTS cache files for removed or updated card IDs. */
async function pruneTtsCacheForCards(plugin, cardIds, reason) {
    var _a, _b, _c, _d, _e;
    if (!cardIds.length)
        return;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    const configDir = (_d = (_c = plugin.app) === null || _c === void 0 ? void 0 : _c.vault) === null || _d === void 0 ? void 0 : _d.configDir;
    const pluginId = (_e = plugin.manifest) === null || _e === void 0 ? void 0 : _e.id;
    if (!adapter || !configDir || !pluginId)
        return;
    const cacheDirPath = getTtsCacheDirPath(configDir, pluginId);
    const removedCount = await deleteTtsCacheForCardIds(adapter, cacheDirPath, cardIds);
    if (removedCount > 0) {
        log.info(`sync: removed ${removedCount} cached TTS file(s) for ${reason} card(s)`);
    }
}
// ────────────────────────────────────────────
// syncOneFile (exported)
// ────────────────────────────────────────────
/**
 * Syncs a single markdown file with the Sprout card database.
 *
 * Steps:
 *  1. Ensures a routine backup exists (throttled)
 *  2. Parses flashcard blocks from the file
 *  3. Assigns anchor IDs to cards that lack them
 *  4. Removes orphan anchors
 *  5. Upserts card records in the store
 *  6. Removes stale cards no longer in the file
 *  7. Manages IO / cloze child records
 */
export async function syncOneFile(plugin, file, options) {
    return withFileSyncLock(file.path, async () => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        const vault = plugin.app.vault;
        const now = Date.now();
        const noteCardIdsBefore = collectCardIdsForNote(plugin, file.path);
        const groupsBefore = collectGroupKeys(plugin.store.data.cards || {});
        // Routine backups are throttled + capped; manual backups live in Settings → Backups.
        await ensureRoutineBackupIfNeeded(plugin);
        purgeDeprecatedTypes(plugin);
        quarantineIoCardsWithMissingImages(plugin);
        const originalText = await vault.cachedRead(file);
        const lines = originalText.split(/\r?\n/);
        const pruneGlobalOrphans = (_a = options === null || options === void 0 ? void 0 : options.pruneGlobalOrphans) !== null && _a !== void 0 ? _a : true;
        const parseText = normaliseTextForParsing(originalText);
        const { cards } = parseCardsFromText(file.path, parseText, plugin.settings.indexing.ignoreInCodeFences);
        // If store is empty but we parsed cards, attempt recovery of scheduling snapshot BEFORE we start creating states.
        const schedulingSnapshot = isLikelyRecoveryScenario(plugin, cards.length) ? await loadBestSchedulingSnapshot(plugin) : null;
        // Mark existing cards/quarantine from this note as unseen for this run
        for (const id of Object.keys(plugin.store.data.cards || {})) {
            const rec = plugin.store.data.cards[id];
            if (!rec)
                continue;
            if (rec.sourceNotePath !== file.path)
                continue;
            if (String(rec.type) === "io-child" || String(rec.type) === "cloze-child" || String(rec.type) === "reversed-child")
                continue;
            rec.lastSeenAt = 0;
        }
        for (const id of Object.keys(plugin.store.data.quarantine || {})) {
            const q = plugin.store.data.quarantine[id];
            if (q && q.notePath === file.path)
                q.lastSeenAt = 0;
        }
        const usedIds = new Set([
            ...Object.keys(plugin.store.data.cards || {}),
            ...Object.keys(plugin.store.data.quarantine || {}),
            ...collectAnchorIdsFromLines(lines),
        ]);
        const existingAnchorIds = collectAnchorIdsFromLines(lines);
        const edits = [];
        const keepIds = new Set();
        let idsInserted = 0;
        let anchorsRemoved = 0;
        // 1) Ensure every parsed card has an anchor ID
        for (const c of cards) {
            let id = c.id ? String(c.id) : null;
            if (!id) {
                const inferred = inferIoIdFromCard(c);
                if (inferred) {
                    const existing = (_c = (_b = plugin.store.data.cards) === null || _b === void 0 ? void 0 : _b[inferred]) !== null && _c !== void 0 ? _c : (_d = plugin.store.data.quarantine) === null || _d === void 0 ? void 0 : _d[inferred];
                    const sameNote = existing && String(existing.sourceNotePath || existing.notePath || "") === file.path;
                    id = !usedIds.has(inferred) || sameNote ? inferred : generateUniqueId(usedIds);
                }
                else {
                    id = generateUniqueId(usedIds);
                }
                c.assignedId = id;
            }
            usedIds.add(id);
            keepIds.add(id);
            if (c.isShorthand) {
                // Shorthand card: replace the ::: line with canonical format.
                // sourceEndLine is the actual ::: line (sourceStartLine may point to an anchor line above it).
                const shorthandLine = c.sourceEndLine;
                const prefix = inferPrefixAt(lines, shorthandLine);
                const d = getDelimiter();
                const canonicalLines = [];
                if (!existingAnchorIds.has(id)) {
                    canonicalLines.push(`${prefix}${buildPrimaryCardAnchor(id)}`);
                    idsInserted += 1;
                }
                if (c.type === "cloze") {
                    const cqEsc = escapeDelimiterText((_e = c.clozeText) !== null && _e !== void 0 ? _e : "");
                    canonicalLines.push(`${prefix}CQ ${d} ${cqEsc} ${d}`);
                }
                else {
                    const qEsc = escapeDelimiterText((_f = c.q) !== null && _f !== void 0 ? _f : "");
                    const aEsc = escapeDelimiterText((_g = c.a) !== null && _g !== void 0 ? _g : "");
                    canonicalLines.push(`${prefix}Q ${d} ${qEsc} ${d}`);
                    canonicalLines.push(`${prefix}A ${d} ${aEsc} ${d}`);
                }
                edits.push({ lineIndex: shorthandLine, deleteLine: true });
                edits.push({ lineIndex: shorthandLine, insertText: canonicalLines.join("\n") });
                existingAnchorIds.add(id);
            }
            else if (!existingAnchorIds.has(id)) {
                const insertAt = findAnchorInsertLineIndex(lines, c.sourceStartLine);
                const prefix = inferPrefixAt(lines, insertAt);
                edits.push({ lineIndex: insertAt, insertText: `${prefix}${buildPrimaryCardAnchor(id)}` });
                idsInserted += 1;
                existingAnchorIds.add(id);
            }
        }
        // 2) Remove orphan anchors
        const orphanLineIdxs = collectAnchorLineIndicesToDelete(lines, keepIds);
        for (const idx of orphanLineIdxs) {
            edits.push({ lineIndex: idx, deleteLine: true });
            anchorsRemoved += 1;
        }
        // 3) Apply file edits (with TOCTOU re-validation)
        //    Use vault.process() instead of vault.modify() so Obsidian applies the
        //    change through the editor layer, preserving scroll position & cursor.
        if (edits.length) {
            await vault.process(file, (data) => {
                if (data !== originalText) {
                    // File was modified while we were computing edits — re-parse from
                    // the live content so the upsert / deletion passes below reflect
                    // the editor's current state (mirrors syncQuestionBank behaviour).
                    log.warn(`syncOneFile: file "${file.path}" changed during sync; re-parsing from live content`);
                    const freshParseText = normaliseTextForParsing(data);
                    const { cards: freshCards } = parseCardsFromText(file.path, freshParseText, plugin.settings.indexing.ignoreInCodeFences);
                    cards.length = 0;
                    cards.push(...freshCards);
                    keepIds.clear();
                    for (const c of freshCards) {
                        if (c.id)
                            keepIds.add(String(c.id));
                    }
                    return data;
                }
                applyEditsToLines(lines, edits);
                return lines.join("\n");
            });
        }
        // Recovery: if we found a snapshot, attach states for known IDs before we create defaults.
        if (schedulingSnapshot && Object.keys(schedulingSnapshot).length) {
            for (const id of keepIds) {
                if (!hasState(plugin, id))
                    upsertStateIfPresent(plugin, schedulingSnapshot, id);
            }
        }
        // 4) Upsert DB records for parsed cards
        let newCount = 0;
        let updatedCount = 0;
        let sameCount = 0;
        let quarantinedCount = 0;
        const quarantinedIds = [];
        const updatedCardIds = [];
        for (const c of cards) {
            const id = String(c.id || c.assignedId || "");
            if (!id)
                continue;
            if (c.errors && c.errors.length) {
                plugin.store.data.quarantine[id] = {
                    id,
                    notePath: c.sourceNotePath,
                    sourceStartLine: c.sourceStartLine,
                    reason: c.errors.join("; "),
                    lastSeenAt: now,
                };
                delete plugin.store.data.cards[id];
                ensureStateIfMissing(plugin, id, now, 2.5);
                quarantinedCount += 1;
                quarantinedIds.push(id);
                continue;
            }
            if (plugin.store.data.quarantine && plugin.store.data.quarantine[id])
                delete plugin.store.data.quarantine[id];
            const prev = plugin.store.data.cards[id];
            const createdAt = prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0 ? Number(prev.createdAt) : now;
            const clozeChildren = c.type === "cloze" ? extractClozeIndices((_h = c.clozeText) !== null && _h !== void 0 ? _h : "") : null;
            const record = {
                id,
                type: c.type,
                title: (_j = c.title) !== null && _j !== void 0 ? _j : null,
                q: (c.type === "basic" || c.type === "reversed" || c.type === "oq") ? ((_k = c.q) !== null && _k !== void 0 ? _k : null) : null,
                a: (c.type === "basic" || c.type === "reversed") ? ((_l = c.a) !== null && _l !== void 0 ? _l : null) : c.type === "mcq" ? ((_m = c.a) !== null && _m !== void 0 ? _m : null) : null,
                stem: c.type === "mcq" ? ((_o = c.stem) !== null && _o !== void 0 ? _o : null) : null,
                ...(c.type === "mcq"
                    ? (() => {
                        const { options, correctIndex, correctIndices } = mcqLegacyFromParsed(c);
                        return { options: options.length ? options : [], correctIndex, correctIndices };
                    })()
                    : {}),
                clozeText: c.type === "cloze" ? ((_p = c.clozeText) !== null && _p !== void 0 ? _p : null) : null,
                clozeChildren: c.type === "cloze" ? clozeChildren : null,
                ...(c.type === "io"
                    ? (() => {
                        var _a;
                        const { imageRef, occlusions, maskMode } = ioFieldsFromParsed(plugin, c);
                        return {
                            imageRef: imageRef !== null && imageRef !== void 0 ? imageRef : null,
                            occlusions: occlusions !== null && occlusions !== void 0 ? occlusions : null,
                            maskMode: maskMode !== null && maskMode !== void 0 ? maskMode : null,
                            prompt: (_a = c.prompt) !== null && _a !== void 0 ? _a : null,
                        };
                    })()
                    : {}),
                oqSteps: c.type === "oq" ? ((_q = c.oqSteps) !== null && _q !== void 0 ? _q : []) : undefined,
                info: (_r = c.info) !== null && _r !== void 0 ? _r : null,
                groups: (_s = c.groups) !== null && _s !== void 0 ? _s : null,
                sourceNotePath: c.sourceNotePath,
                sourceStartLine: c.sourceStartLine,
                createdAt,
                updatedAt: now,
                lastSeenAt: now,
            };
            if (!prev)
                newCount += 1;
            else if (cardSignature(prev) !== cardSignature(record))
                updatedCount += 1;
            else
                sameCount += 1;
            plugin.store.upsertCard(record);
            if (!hasState(plugin, id)) {
                // Reversed → Basic migration: if a forward child state exists, transfer it to the
                // now-basic parent (same Q→A direction). Orphan cleanup will remove the children.
                const fwdChildId = `${id}::reversed::forward`;
                if (c.type === "basic" && hasState(plugin, fwdChildId)) {
                    const fwdState = (_t = plugin.store.data.states) === null || _t === void 0 ? void 0 : _t[fwdChildId];
                    if (fwdState && typeof fwdState === "object") {
                        plugin.store.upsertState({ ...fwdState, id });
                    }
                }
                else {
                    const restored = upsertStateIfPresent(plugin, schedulingSnapshot, id);
                    if (!restored)
                        ensureStateIfMissing(plugin, id, now, 2.5);
                }
            }
            if (c.type === "cloze")
                syncClozeChildren(plugin, record, now, schedulingSnapshot);
            if (c.type === "reversed")
                syncReversedChildren(plugin, record, now, schedulingSnapshot);
            // IO: verify image exists, else quarantine; sync children if image present
            if (c.type === "io") {
                let ioQuarantined = false;
                const imageRef = normalizeIoImageRef(record.imageRef);
                if (imageRef) {
                    const imageFile = resolveImageFile(plugin.app, c.sourceNotePath, record.imageRef || imageRef);
                    if (!imageFile || !(imageFile instanceof TFile)) {
                        plugin.store.data.quarantine[id] = {
                            id,
                            notePath: c.sourceNotePath,
                            sourceStartLine: c.sourceStartLine,
                            reason: `Image file not found: ${imageRef}`,
                            lastSeenAt: now,
                        };
                        delete plugin.store.data.cards[id];
                        quarantinedCount += 1;
                        quarantinedIds.push(id);
                        ioQuarantined = true;
                        ensureStateIfMissing(plugin, id, now, 2.5);
                    }
                }
                if (!ioQuarantined) {
                    syncIoChildren(plugin, record, now, schedulingSnapshot);
                }
            }
        }
        // 5) Remove stale cards/quarantine entries no longer present in this note
        let removed = 0;
        const removedIoParentData = [];
        const removedClozeParents = [];
        const removedReversedParents = [];
        for (const id of Object.keys(plugin.store.data.cards || {})) {
            const rec = plugin.store.data.cards[id];
            if (!rec)
                continue;
            if (rec.sourceNotePath !== file.path)
                continue;
            if (String(rec.type) === "io-child" || String(rec.type) === "cloze-child" || String(rec.type) === "reversed-child")
                continue;
            if (rec.lastSeenAt === 0) {
                if (String(rec.type) === "io")
                    removedIoParentData.push({ id: String(id), imageRef: rec.imageRef || null, sourceNotePath: String(rec.sourceNotePath || "") });
                if (String(rec.type) === "cloze")
                    removedClozeParents.push(String(id));
                if (String(rec.type) === "reversed")
                    removedReversedParents.push(String(id));
                delete plugin.store.data.cards[id];
                if (plugin.store.data.states)
                    delete (plugin.store.data.states)[id];
                removed += 1;
            }
        }
        for (const ioData of removedIoParentData) {
            removed += deleteIoChildren(plugin, ioData.id);
            if (ioData.imageRef)
                await deleteIoImage(plugin, ioData.imageRef, ioData.sourceNotePath);
            const ioMap = plugin.store.data.io || {};
            if (ioMap[ioData.id])
                delete ioMap[ioData.id];
        }
        for (const parentId of removedClozeParents)
            removed += deleteClozeChildren(plugin, parentId);
        for (const parentId of removedReversedParents)
            removed += deleteReversedChildren(plugin, parentId);
        for (const id of Object.keys(plugin.store.data.quarantine || {})) {
            const q = plugin.store.data.quarantine[id];
            if (q && q.notePath === file.path && q.lastSeenAt === 0) {
                delete plugin.store.data.quarantine[id];
                if (plugin.store.data.states)
                    delete (plugin.store.data.states)[id];
                removed += 1;
            }
        }
        if (pruneGlobalOrphans) {
            removed += deleteOrphanIoChildren(plugin);
            removed += deleteOrphanClozeChildren(plugin);
            removed += deleteOrphanReversedChildren(plugin);
            const sanitizedStates = sanitizeOrphanStates(plugin);
            if (sanitizedStates > 0) {
                log.info(`syncOneFile: pruned ${sanitizedStates} orphaned scheduling state(s)`);
            }
        }
        const noteCardIdsAfter = collectCardIdsForNote(plugin, file.path);
        const removedCardIdsForCache = [];
        for (const id of noteCardIdsBefore) {
            if (!noteCardIdsAfter.has(id))
                removedCardIdsForCache.push(id);
        }
        await pruneTtsCacheForCards(plugin, removedCardIdsForCache, "deleted");
        await pruneTtsCacheForCards(plugin, updatedCardIds, "edited");
        const groupsAfter = collectGroupKeys(plugin.store.data.cards || {});
        const tagsDeleted = countRemovedGroups(groupsBefore, groupsAfter);
        await plugin.store.persist();
        return {
            idsInserted,
            anchorsRemoved,
            newCount,
            updatedCount,
            sameCount,
            quarantinedCount,
            quarantinedIds,
            removed,
            tagsDeleted,
        };
    });
}
// ────────────────────────────────────────────
// syncQuestionBank (exported)
// ────────────────────────────────────────────
/**
 * Full vault-wide sync: parses every markdown file, reconciles the
 * card database, inserts missing anchors, removes stale entries,
 * and cleans up orphaned IO images.
 */
export async function syncQuestionBank(plugin) {
    return withVaultSyncLock(async () => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const now = Date.now();
        const groupsBefore = collectGroupKeys(plugin.store.data.cards || {});
        const allCardIdsBefore = new Set(Object.keys(plugin.store.data.cards || {}));
        // NOTE: Backups are no longer created automatically here. Use Settings → Backups.
        purgeDeprecatedTypes(plugin);
        quarantineIoCardsWithMissingImages(plugin);
        const vault = plugin.app.vault;
        const mdFiles = vault.getMarkdownFiles();
        const schedulingSnapshot = await loadBestSchedulingSnapshot(plugin);
        for (const id of Object.keys(plugin.store.data.cards || {})) {
            const c = plugin.store.data.cards[id];
            if (!c)
                continue;
            if (String(c.type) === "io-child" || String(c.type) === "cloze-child" || String(c.type) === "reversed-child")
                continue;
            c.lastSeenAt = 0;
        }
        for (const id of Object.keys(plugin.store.data.quarantine || {})) {
            const q = plugin.store.data.quarantine[id];
            if (q)
                q.lastSeenAt = 0;
        }
        let idsInserted = 0;
        let anchorsRemoved = 0;
        let newCount = 0;
        let updatedCount = 0;
        let sameCount = 0;
        let quarantinedCount = 0;
        const quarantinedIds = [];
        const updatedCardIds = [];
        let removed = 0;
        const usedIds = new Set([
            ...Object.keys(plugin.store.data.cards || {}),
            ...Object.keys(plugin.store.data.quarantine || {}),
        ]);
        const parsedAll = [];
        const buildFilePlan = (file, text) => {
            var _a, _b, _c, _d, _e, _f;
            const addedIds = [];
            const lines = text.split(/\r?\n/);
            const parseText = normaliseTextForParsing(text);
            const { cards } = parseCardsFromText(file.path, parseText, plugin.settings.indexing.ignoreInCodeFences);
            const existingAnchorIds = collectAnchorIdsFromLines(lines);
            // Even when no cards parse, we still need to clean up orphaned anchors
            if (!cards.length) {
                const orphanIdxs = collectAnchorLineIndicesToDelete(lines, new Set());
                const orphanEdits = [];
                for (const idx of orphanIdxs)
                    orphanEdits.push({ lineIndex: idx, deleteLine: true });
                return { cards: [], edits: orphanEdits, lines, keepIds: new Set(), idsInserted: 0, anchorsRemoved: orphanEdits.length, addedIds };
            }
            for (const id of existingAnchorIds) {
                if (!usedIds.has(id)) {
                    usedIds.add(id);
                    addedIds.push(id);
                }
            }
            for (const c of cards) {
                if (c.id) {
                    const id = String(c.id);
                    if (!usedIds.has(id)) {
                        usedIds.add(id);
                        addedIds.push(id);
                    }
                }
            }
            const keepIds = new Set();
            const edits = [];
            let planInserted = 0;
            let planRemoved = 0;
            for (const c of cards) {
                let id = c.id ? String(c.id) : null;
                if (!id) {
                    const inferred = inferIoIdFromCard(c);
                    if (inferred) {
                        const existing = (_b = (_a = plugin.store.data.cards) === null || _a === void 0 ? void 0 : _a[inferred]) !== null && _b !== void 0 ? _b : (_c = plugin.store.data.quarantine) === null || _c === void 0 ? void 0 : _c[inferred];
                        const sameNote = existing && String(existing.sourceNotePath || existing.notePath || "") === file.path;
                        id = !usedIds.has(inferred) || sameNote ? inferred : generateUniqueId(usedIds);
                    }
                    else {
                        id = generateUniqueId(usedIds);
                    }
                    c.assignedId = id;
                }
                if (!usedIds.has(id)) {
                    usedIds.add(id);
                    addedIds.push(id);
                }
                keepIds.add(id);
                if (c.isShorthand) {
                    // Shorthand card: replace the ::: line with canonical format.
                    const shorthandLine = c.sourceEndLine;
                    const prefix = inferPrefixAt(lines, shorthandLine);
                    const d = getDelimiter();
                    const canonicalLines = [];
                    if (!existingAnchorIds.has(id)) {
                        canonicalLines.push(`${prefix}${buildPrimaryCardAnchor(id)}`);
                        planInserted += 1;
                    }
                    if (c.type === "cloze") {
                        const cqEsc = escapeDelimiterText((_d = c.clozeText) !== null && _d !== void 0 ? _d : "");
                        canonicalLines.push(`${prefix}CQ ${d} ${cqEsc} ${d}`);
                    }
                    else {
                        const qEsc = escapeDelimiterText((_e = c.q) !== null && _e !== void 0 ? _e : "");
                        const aEsc = escapeDelimiterText((_f = c.a) !== null && _f !== void 0 ? _f : "");
                        canonicalLines.push(`${prefix}Q ${d} ${qEsc} ${d}`);
                        canonicalLines.push(`${prefix}A ${d} ${aEsc} ${d}`);
                    }
                    edits.push({ lineIndex: shorthandLine, deleteLine: true });
                    edits.push({ lineIndex: shorthandLine, insertText: canonicalLines.join("\n") });
                    existingAnchorIds.add(id);
                }
                else if (!existingAnchorIds.has(id)) {
                    const insertAt = findAnchorInsertLineIndex(lines, c.sourceStartLine);
                    const prefix = inferPrefixAt(lines, insertAt);
                    edits.push({ lineIndex: insertAt, insertText: `${prefix}${buildPrimaryCardAnchor(id)}` });
                    planInserted += 1;
                    existingAnchorIds.add(id);
                }
            }
            const orphanIdxs = collectAnchorLineIndicesToDelete(lines, keepIds);
            for (const idx of orphanIdxs) {
                edits.push({ lineIndex: idx, deleteLine: true });
                planRemoved += 1;
            }
            return { cards, edits, lines, keepIds, idsInserted: planInserted, anchorsRemoved: planRemoved, addedIds };
        };
        for (const file of mdFiles) {
            try {
                let text = await vault.cachedRead(file);
                let plan = buildFilePlan(file, text);
                if (!plan.cards.length && !plan.edits.length)
                    continue;
                if (plan.edits.length) {
                    await vault.process(file, (data) => {
                        if (data !== text) {
                            for (const id of plan.addedIds)
                                usedIds.delete(id);
                            text = data;
                            plan = buildFilePlan(file, text);
                        }
                        if (plan.edits.length) {
                            const lines = plan.lines.slice();
                            applyEditsToLines(lines, plan.edits);
                            return lines.join("\n");
                        }
                        return data;
                    });
                }
                idsInserted += plan.idsInserted;
                anchorsRemoved += plan.anchorsRemoved;
                parsedAll.push(...plan.cards);
            }
            catch (err) {
                log.warn(`syncQuestionBank: skipping file "${file.path}" due to read/write error`, err);
            }
        }
        for (const c of parsedAll) {
            const id = String(c.id || c.assignedId || "");
            if (!id)
                continue;
            if (c.errors && c.errors.length) {
                plugin.store.data.quarantine[id] = {
                    id,
                    notePath: c.sourceNotePath,
                    sourceStartLine: c.sourceStartLine,
                    reason: c.errors.join("; "),
                    lastSeenAt: now,
                };
                delete plugin.store.data.cards[id];
                ensureStateIfMissing(plugin, id, now, 2.5);
                quarantinedCount += 1;
                quarantinedIds.push(id);
                continue;
            }
            if (plugin.store.data.quarantine && plugin.store.data.quarantine[id])
                delete plugin.store.data.quarantine[id];
            const prev = plugin.store.data.cards[id];
            const createdAt = prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0 ? Number(prev.createdAt) : now;
            const record = {
                id,
                type: c.type,
                title: (_a = c.title) !== null && _a !== void 0 ? _a : null,
                q: (c.type === "basic" || c.type === "reversed" || c.type === "oq") ? ((_b = c.q) !== null && _b !== void 0 ? _b : null) : null,
                a: (c.type === "basic" || c.type === "reversed") ? ((_c = c.a) !== null && _c !== void 0 ? _c : null) : c.type === "mcq" ? ((_d = c.a) !== null && _d !== void 0 ? _d : null) : null,
                stem: c.type === "mcq" ? ((_e = c.stem) !== null && _e !== void 0 ? _e : null) : null,
                ...(c.type === "mcq"
                    ? (() => {
                        const { options, correctIndex, correctIndices } = mcqLegacyFromParsed(c);
                        return { options: options.length ? options : [], correctIndex, correctIndices };
                    })()
                    : {}),
                clozeText: c.type === "cloze" ? ((_f = c.clozeText) !== null && _f !== void 0 ? _f : null) : null,
                ...(c.type === "io"
                    ? (() => {
                        var _a;
                        const { imageRef, occlusions, maskMode } = ioFieldsFromParsed(plugin, c);
                        return {
                            imageRef: imageRef !== null && imageRef !== void 0 ? imageRef : null,
                            occlusions: occlusions !== null && occlusions !== void 0 ? occlusions : null,
                            maskMode: maskMode !== null && maskMode !== void 0 ? maskMode : null,
                            prompt: (_a = c.prompt) !== null && _a !== void 0 ? _a : null,
                        };
                    })()
                    : {}),
                oqSteps: c.type === "oq" ? ((_g = c.oqSteps) !== null && _g !== void 0 ? _g : []) : undefined,
                info: (_h = c.info) !== null && _h !== void 0 ? _h : null,
                groups: (_j = c.groups) !== null && _j !== void 0 ? _j : null,
                sourceNotePath: c.sourceNotePath,
                sourceStartLine: c.sourceStartLine,
                createdAt,
                updatedAt: now,
                lastSeenAt: now,
            };
            if (!prev)
                newCount += 1;
            else if (cardSignature(prev) !== cardSignature(record)) {
                updatedCount += 1;
                updatedCardIds.push(id);
            }
            else
                sameCount += 1;
            plugin.store.upsertCard(record);
            if (!hasState(plugin, id)) {
                // Reversed → Basic migration: if a forward child state exists, transfer it to the
                // now-basic parent (same Q→A direction). Orphan cleanup will remove the children.
                const fwdChildId = `${id}::reversed::forward`;
                if (c.type === "basic" && hasState(plugin, fwdChildId)) {
                    const fwdState = (_k = plugin.store.data.states) === null || _k === void 0 ? void 0 : _k[fwdChildId];
                    if (fwdState && typeof fwdState === "object") {
                        plugin.store.upsertState({ ...fwdState, id });
                    }
                }
                else {
                    const restored = upsertStateIfPresent(plugin, schedulingSnapshot, id);
                    if (!restored)
                        ensureStateIfMissing(plugin, id, now, 2.5);
                }
            }
            if (c.type === "cloze")
                syncClozeChildren(plugin, record, now, schedulingSnapshot);
            if (c.type === "reversed")
                syncReversedChildren(plugin, record, now, schedulingSnapshot);
            if (c.type === "io") {
                let ioQuarantined = false;
                const imageRef = normalizeIoImageRef(record.imageRef);
                if (imageRef) {
                    const imageFile = resolveImageFile(plugin.app, c.sourceNotePath, record.imageRef || imageRef);
                    if (!imageFile || !(imageFile instanceof TFile)) {
                        plugin.store.data.quarantine[id] = {
                            id,
                            notePath: c.sourceNotePath,
                            sourceStartLine: c.sourceStartLine,
                            reason: `Image file not found: ${imageRef}`,
                            lastSeenAt: now,
                        };
                        delete plugin.store.data.cards[id];
                        quarantinedCount += 1;
                        quarantinedIds.push(id);
                        ioQuarantined = true;
                        ensureStateIfMissing(plugin, id, now, 2.5);
                    }
                }
                if (!ioQuarantined) {
                    syncIoChildren(plugin, record, now, schedulingSnapshot);
                }
            }
        }
        const removedIoParentData = [];
        const removedClozeParents = [];
        const removedReversedParents = [];
        for (const id of Object.keys(plugin.store.data.cards || {})) {
            const card = plugin.store.data.cards[id];
            if (!card)
                continue;
            if (String(card.type) === "io-child" || String(card.type) === "cloze-child" || String(card.type) === "reversed-child")
                continue;
            if (card.lastSeenAt !== now) {
                if (String(card.type) === "io")
                    removedIoParentData.push({ id: String(id), imageRef: card.imageRef || null, sourceNotePath: String(card.sourceNotePath || "") });
                if (String(card.type) === "cloze")
                    removedClozeParents.push(String(id));
                if (String(card.type) === "reversed")
                    removedReversedParents.push(String(id));
                delete plugin.store.data.cards[id];
                if (plugin.store.data.states)
                    delete (plugin.store.data.states)[id];
                removed += 1;
            }
        }
        for (const ioData of removedIoParentData) {
            removed += deleteIoChildren(plugin, ioData.id);
            if (ioData.imageRef)
                await deleteIoImage(plugin, ioData.imageRef, ioData.sourceNotePath);
            const ioMap = plugin.store.data.io || {};
            if (ioMap[ioData.id])
                delete ioMap[ioData.id];
        }
        for (const parentId of removedClozeParents)
            removed += deleteClozeChildren(plugin, parentId);
        for (const parentId of removedReversedParents)
            removed += deleteReversedChildren(plugin, parentId);
        for (const id of Object.keys(plugin.store.data.quarantine || {})) {
            const q = plugin.store.data.quarantine[id];
            if (q && q.lastSeenAt !== now) {
                delete plugin.store.data.quarantine[id];
                if (plugin.store.data.states)
                    delete (plugin.store.data.states)[id];
                removed += 1;
            }
        }
        removed += deleteOrphanIoChildren(plugin);
        removed += deleteOrphanClozeChildren(plugin);
        removed += deleteOrphanReversedChildren(plugin);
        const sanitizedStates = sanitizeOrphanStates(plugin);
        if (sanitizedStates > 0) {
            log.info(`syncQuestionBank: pruned ${sanitizedStates} orphaned scheduling state(s)`);
        }
        const groupsAfter = collectGroupKeys(plugin.store.data.cards || {});
        const tagsDeleted = countRemovedGroups(groupsBefore, groupsAfter);
        const deletedImages = await deleteOrphanedIoImages(plugin);
        if (deletedImages > 0)
            log.info(`Deleted ${deletedImages} orphaned IO image(s)`);
        // Prune TTS cache for cards that were removed or edited during full sync
        const allCardIdsAfter = new Set(Object.keys(plugin.store.data.cards || {}));
        const removedCardIdsForCache = [];
        for (const id of allCardIdsBefore) {
            if (!allCardIdsAfter.has(id))
                removedCardIdsForCache.push(id);
        }
        await pruneTtsCacheForCards(plugin, removedCardIdsForCache, "deleted");
        await pruneTtsCacheForCards(plugin, updatedCardIds, "edited");
        await plugin.store.persist();
        return {
            idsInserted,
            anchorsRemoved,
            newCount,
            updatedCount,
            sameCount,
            quarantinedCount,
            quarantinedIds,
            removed,
            tagsDeleted,
        };
    });
}
