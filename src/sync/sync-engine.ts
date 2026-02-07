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
import { parseCardsFromText, type ParsedCard } from "../parser/parser";
import { generateUniqueId } from "../core/ids";
import type SproutPlugin from "../main";
import type { CardRecord } from "../types/card";
import type { CardState } from "../types/scheduler";
import { loadSchedulingFromDataJson } from "../core/store";
import { expandGroupPrefixes, normaliseGroupPath } from "../indexes/group-index";
import { log } from "../core/logger";

import {
  countObjectKeys,
  joinPath,
  likelySproutStateKey,
  extractStatesFromDataJsonObject,
  tryReadJson,
  safeListFolders,
  safeListFiles,
  safeStatMtime,
  ensureRoutineBackupIfNeeded,
  listDataJsonBackups,
} from "./backup";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

/** Counts returned from sync operations for user-facing notices. */
type SyncNoticeCounts = {
  newCount: number;
  updatedCount: number;
  sameCount?: number;
  idsInserted?: number;
  removed?: number;
  tagsDeleted?: number;
};

/** Options controlling which parts of the notice are shown. */
type SyncNoticeOptions = {
  includeDeleted?: boolean;
  includeIdsInserted?: boolean;
};

/** Scheduling state keyed by card ID. */
type StateMap = Record<string, unknown>;

/** A pending text edit to be applied to a note's line array. */
type TextEdit = {
  lineIndex: number;
  deleteLine?: boolean;
  insertText?: string;
};

// ────────────────────────────────────────────
// Concurrency guards (per-file + vault)
// ────────────────────────────────────────────

type LockQueue = Map<string, Promise<void>>;

const FILE_SYNC_LOCKS: LockQueue = new Map();
const VAULT_SYNC_LOCKS: LockQueue = new Map();
const VAULT_LOCK_KEY = "__sprout-vault-sync__";

async function withLock<T>(lockMap: LockQueue, key: string, fn: () => Promise<T>): Promise<T> {
  const prev = lockMap.get(key) ?? Promise.resolve();
  let release: (() => void) | null = null;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => current);

  lockMap.set(key, chained);

  await prev;
  try {
    return await fn();
  } finally {
    if (release) (release as () => void)();
    if (lockMap.get(key) === chained) lockMap.delete(key);
  }
}

async function waitForLock(lockMap: LockQueue, key: string): Promise<void> {
  const pending = lockMap.get(key);
  if (pending) await pending;
}

async function withFileSyncLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await waitForLock(VAULT_SYNC_LOCKS, VAULT_LOCK_KEY);
  return withLock(FILE_SYNC_LOCKS, filePath, fn);
}

async function withVaultSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  return withLock(VAULT_SYNC_LOCKS, VAULT_LOCK_KEY, async () => {
    if (FILE_SYNC_LOCKS.size > 0) await Promise.all([...FILE_SYNC_LOCKS.values()]);
    return fn();
  });
}

// ────────────────────────────────────────────
// formatSyncNotice (exported)
// ────────────────────────────────────────────

/**
 * Builds a human-readable sync summary string.
 *
 * Example output: "Sync complete: 3 new cards; 1 updated card; 2 cards deleted"
 */
export function formatSyncNotice(prefix: string, res: SyncNoticeCounts, options: SyncNoticeOptions = {}): string {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const parts: string[] = [];
  const deletedCount = Number(res.removed ?? 0);
  const idsInserted = Number(res.idsInserted ?? 0);

  if (res.newCount > 0) parts.push(`${res.newCount} ${plural(res.newCount, "new card", "new cards")}`);
  if (res.updatedCount > 0) parts.push(`${res.updatedCount} ${plural(res.updatedCount, "updated card", "updated cards")}`);
  if (options.includeDeleted && deletedCount > 0) parts.push(`${deletedCount} ${plural(deletedCount, "card deleted", "cards deleted")}`);
  if ((options.includeIdsInserted ?? true) && idsInserted > 0) parts.push(`${idsInserted} ${plural(idsInserted, "ID inserted", "IDs inserted")}`);

  if (!parts.length) return `${prefix}: no changes.`;
  return `${prefix}: ${parts.join("; ")}`;
}

// ────────────────────────────────────────────
// Helpers: prefix handling (lists / blockquotes / indentation)
// ────────────────────────────────────────────

/** Splits leading Markdown list / blockquote / indent prefix from content. */
const PREFIX_RE = /^(\s*(?:(?:>\s*)|(?:[-*+]\s+)|(?:\d+\.\s+))*)(.*)$/;

function splitMdPrefix(line: string): { prefix: string; rest: string } {
  const m = PREFIX_RE.exec(String(line ?? ""));
  if (!m) return { prefix: "", rest: String(line ?? "") };
  return { prefix: m[1] ?? "", rest: m[2] ?? "" };
}

/** Returns `true` if `rest` (after prefix strip) resembles a flashcard header/field/anchor. */
function looksLikeFlashcardHeader(rest: string): boolean {
  const s = String(rest ?? "");
  if (/^\^sprout-\d{9}\s*$/.test(s.trim())) return true;
  if (/^(Q|MCQ|CQ|IO)\s*(?::|\|)\s*/.test(s)) return true;
  if (/^(T|A|O|I|G|C|K|L)\s*(?::|\|)\s*/.test(s)) return true;
  if (/^\d+(?:\.\d+)?\s*\|\s*/.test(s)) return true;
  return false;
}

/**
 * Produces parse-friendly text while preserving line numbers:
 * strips Markdown prefixes from flashcard header/field lines only.
 */
function normaliseTextForParsing(originalText: string): string {
  const lines = String(originalText ?? "").split(/\r?\n/);
  const out = lines.map((ln) => {
    const { rest } = splitMdPrefix(ln);
    return looksLikeFlashcardHeader(rest) ? rest : ln;
  });
  return out.join("\n");
}

/** Matches a Sprout anchor ID even inside list/quote prefixes. */
function matchAnchorId(line: string): string | null {
  const { rest } = splitMdPrefix(line);
  const m = /^\^sprout-(\d{9})\s*$/.exec(String(rest ?? "").trim());
  return m ? m[1] : null;
}

/** Infers the Markdown prefix at a given line index (for anchor insertion). */
function inferPrefixAt(lines: string[], lineIndex: number): string {
  const idx = Math.max(0, Math.min(lines.length, lineIndex));
  if (idx >= lines.length) return "";
  const { prefix, rest } = splitMdPrefix(lines[idx] || "");
  return looksLikeFlashcardHeader(rest) ? prefix : "";
}

// ────────────────────────────────────────────
// Scheduling safety / recovery
// ────────────────────────────────────────────

/** Checks whether a scheduling state already exists for `id`. */
function hasState(plugin: SproutPlugin, id: string): boolean {
  const states = plugin.store.data.states;
  return !!(states && Object.prototype.hasOwnProperty.call(states, id));
}

/**
 * Create-only wrapper around `plugin.store.ensureState`.
 * Never resets an existing state — only creates if missing.
 */
function ensureStateIfMissing(plugin: SproutPlugin, id: string, now: number, defaultDifficulty: number) {
  if (hasState(plugin, id)) return;
  plugin.store.ensureState(id, now, defaultDifficulty);
}

/**
 * Restores a card's scheduling state from a snapshot (e.g. a backup).
 * Returns `true` if the state was found and restored.
 */
function upsertStateIfPresent(plugin: SproutPlugin, snapshot: StateMap | null | undefined, id: string): boolean {
  if (!snapshot) return false;
  const st = snapshot[id];
  if (!st || typeof st !== "object") return false;
  plugin.store.upsertState({ ...(st as Record<string, unknown>), id } as CardState);
  return true;
}

/**
 * Scans on-disk data.json files (current + legacy plugin folders) to
 * find the best available scheduling snapshot for recovery.
 *
 * Used when the in-memory store has zero states but cards exist in notes.
 */
async function loadBestSchedulingSnapshot(plugin: SproutPlugin): Promise<StateMap | null> {
  const inMem = plugin.store.data.states;
  if (countObjectKeys(inMem) > 0) return inMem as StateMap;

  // Try store helper first (may already do the right thing)
  try {
    const prev = await loadSchedulingFromDataJson(plugin);
    if (prev && typeof prev === "object" && Object.keys(prev).length > 0) return prev as StateMap;
  } catch {
    // ignore
  }

  // Try direct disk read for current plugin folder
  const adapter = plugin.app?.vault?.adapter;
  const pluginId: string | null = String(plugin.manifest?.id ?? "").trim() || null;

  const candidateFiles = ["data.json", "data.json.bak", "data.json.prev", "data.json.old", "data.json.backup"];

  const configDir = plugin.app.vault.configDir;

  if (pluginId) {
    for (const name of candidateFiles) {
      const p = joinPath(configDir, "plugins", pluginId, name);
      const obj = await tryReadJson(adapter, p);
      const states = extractStatesFromDataJsonObject(obj);
      if (states && Object.keys(states).length > 0) return states;
    }
  }

  // Scan backups within this plugin's folder
  type Cand = { states: StateMap; score: number; mtime: number; path: string };
  const cands: Cand[] = [];

  if (pluginId) {
    const entries = await listDataJsonBackups(plugin);
    for (const entry of entries) {
      const p = entry.path;
      const obj = await tryReadJson(adapter, p);
      const states = extractStatesFromDataJsonObject(obj);
      if (!states) continue;

      const keys = Object.keys(states);
      const stateCount = keys.length;
      if (stateCount <= 0) continue;

      const sproutish = keys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
      if (sproutish <= 0) continue;

      const mtime = entry.mtime || (await safeStatMtime(adapter, p));
      const score = stateCount * 10 + sproutish * 5 + Math.min(1000, mtime / 1000);
      cands.push({ states, score, mtime, path: p });
    }
  }

  // Scan foreign plugin data.json files for recovery
  try {
    const pluginsRoot = joinPath(configDir, "plugins");
    const pluginFolders = await safeListFolders(adapter, pluginsRoot);
    for (const folderPath of pluginFolders) {
      const folderId = String(folderPath).split("/").pop() || "";
      if (!folderId || folderId === pluginId) continue;

      const files = await safeListFiles(adapter, String(folderPath));
      const candidates = files.filter((p) => /(^|\/)data\.json(\..+)?$/.test(String(p)));
      if (!candidates.length) continue;

      for (const p of candidates) {
        const obj = await tryReadJson(adapter, p);
        const states = extractStatesFromDataJsonObject(obj);
        if (!states) continue;

        const keys = Object.keys(states);
        const stateCount = keys.length;
        if (stateCount <= 0) continue;

        const sproutish = keys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
        if (sproutish <= 0) continue;

        const mtime = await safeStatMtime(adapter, p);
        const score = stateCount * 10 + sproutish * 5 + Math.min(1000, mtime / 1000);
        cands.push({ states, score, mtime, path: p });
      }
    }
  } catch {
    // ignore
  }

  if (!cands.length) return null;

  cands.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return cands[0].states;
}

/**
 * Decides if the current run should use "recovery mode":
 * store has zero scheduling, but parsed cards exist in markdown.
 */
function isLikelyRecoveryScenario(plugin: SproutPlugin, parsedCardCount: number): boolean {
  const stateCount = countObjectKeys(plugin.store.data.states);
  const cardCount = countObjectKeys(plugin.store.data.cards);
  if (stateCount > 0) return false;
  return cardCount === 0 && parsedCardCount > 0;
}

// ────────────────────────────────────────────
// Card signature (for updatedCount detection)
// ────────────────────────────────────────────

/**
 * Produces a deterministic JSON string representing a card's content.
 * Used to detect whether a card's content has changed since last sync.
 */
function cardSignature(rec: CardRecord | null): string {
  if (!rec) return "";

  const base: Record<string, unknown> = {
    type: rec.type,
    title: rec.title || "",
    info: rec.info || "",
    groups: Array.isArray(rec.groups) ? rec.groups : [],
  };

  if (rec.type === "basic") {
    base.q = rec.q || "";
    base.a = rec.a || "";
  } else if (rec.type === "mcq") {
    base.stem = rec.stem || "";
    base.options = Array.isArray(rec.options) ? rec.options : [];
    base.correctIndex = Number.isFinite(rec.correctIndex) ? rec.correctIndex : -1;
    base.a = rec.a || "";
  } else if (rec.type === "cloze") {
    base.clozeText = rec.clozeText || "";
    base.clozeChildren = Array.isArray(rec.clozeChildren) ? rec.clozeChildren : [];
  } else if (rec.type === "io") {
    const legacy = rec as unknown as Record<string, unknown>;
    base.imageRef = rec.imageRef ?? (legacy.ioSrc as string | undefined) ?? (legacy.src as string | undefined) ?? "";
    base.occlusions = (legacy.occlusions ?? legacy.rects ?? legacy.masks ?? []) as string[];
    base.maskMode = rec.maskMode ?? (legacy.mode as typeof rec.maskMode) ?? null;
  } else if (rec.type === "io-child") {
    base.parentId = rec.parentId || "";
    base.groupKey = rec.groupKey || "";
    base.rectIds = Array.isArray(rec.rectIds) ? rec.rectIds : [];
    base.imageRef = rec.imageRef ?? "";
    base.maskMode = rec.maskMode ?? null;
    base.retired = !!rec.retired;
  } else if (rec.type === "cloze-child") {
    base.parentId = rec.parentId || "";
    base.clozeIndex = Number.isFinite(rec.clozeIndex) ? rec.clozeIndex : -1;
    base.clozeText = rec.clozeText || "";
  }

  return JSON.stringify(base);
}

// ────────────────────────────────────────────
// Deprecated type cleanup
// ────────────────────────────────────────────

/** Removes cards with legacy types ("lq", "fq") from cards + quarantine. */
function purgeDeprecatedTypes(plugin: SproutPlugin) {
  const cards = plugin.store.data.cards || {};
  const states = plugin.store.data.states || {};
  for (const [id, rec] of Object.entries(cards)) {
    const t = String(rec?.type ?? "").toLowerCase();
    if (t === "lq" || t === "fq") {
      delete cards[id];
      delete (states)[id];
    }
  }
  const quarantine = plugin.store.data.quarantine || {};
  for (const [id, rec] of Object.entries(quarantine)) {
    const rawType = (rec as Record<string, unknown>)?.type;
    const t = (typeof rawType === "string" ? rawType : "").toLowerCase();
    if (t === "lq" || t === "fq") delete quarantine[id];
  }
}

/** Quarantines IO cards whose referenced image file is missing from the vault. */
function quarantineIoCardsWithMissingImages(plugin: SproutPlugin): number {
  const cards = plugin.store.data.cards || {};
  const now = Date.now();
  let count = 0;

  for (const [id, rec] of Object.entries(cards)) {
    if (!rec || String(rec.type) !== "io") continue;

    const imageRef = normalizeIoImageRef(rec.imageRef || (rec as unknown as Record<string, unknown>).ioSrc as string | undefined);
    if (!imageRef) continue;

    const imageFile = plugin.app.vault.getAbstractFileByPath(imageRef);
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
function getBlockBounds(lines: string[], cardStartLine: number): { lo: number; hi: number } {
  const isBlank = (s: string) => (s || "").trim().length === 0;
  const start = Math.max(0, Math.min(lines.length - 1, cardStartLine));

  let lo = start;
  while (lo > 0 && !isBlank(lines[lo - 1])) lo--;

  let hi = start;
  while (hi < lines.length && !isBlank(lines[hi])) hi++;

  return { lo, hi };
}

/**
 * Finds the line index where a `^sprout-*` anchor should be inserted.
 * Prefers placing it directly before the first title line (`T:` or `T|`).
 */
function findAnchorInsertLineIndex(lines: string[], cardStartLine: number): number {
  const { lo: blockLo, hi: blockHi } = getBlockBounds(lines, cardStartLine);
  const start = Math.max(0, Math.min(lines.length - 1, cardStartLine));

  const T_RE = /^\s*T\s*(?::|\|)\s*/;

  for (let i = blockLo; i < start; i++) {
    const { rest } = splitMdPrefix(lines[i] || "");
    if (T_RE.test(rest)) return i;
  }

  for (let i = start; i < blockHi; i++) {
    const { rest } = splitMdPrefix(lines[i] || "");
    if (T_RE.test(rest)) return i;
  }

  return start;
}

/** Collects all Sprout anchor IDs found in the line array. */
function collectAnchorIdsFromLines(lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const ln of lines) {
    const id = matchAnchorId(ln);
    if (id) out.add(id);
  }
  return out;
}

/** Returns line indices of anchors whose IDs are NOT in `keepIds`. */
function collectAnchorLineIndicesToDelete(lines: string[], keepIds: Set<string>): number[] {
  const dels: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const id = matchAnchorId(lines[i] || "");
    if (!id) continue;
    if (!keepIds.has(id)) dels.push(i);
  }
  return dels;
}

/**
 * Applies a batch of text edits (insertions + deletions) to a line array.
 * Processes edits from bottom to top to preserve earlier line indices.
 */
function applyEditsToLines(lines: string[], edits: TextEdit[]): string[] {
  const byIdx = new Map<number, TextEdit[]>();
  for (const e of edits) {
    const idx = Math.max(0, Math.min(lines.length, e.lineIndex));
    const arr = byIdx.get(idx) ?? [];
    arr.push({ ...e, lineIndex: idx });
    byIdx.set(idx, arr);
  }

  const indices = Array.from(byIdx.keys()).sort((a, b) => b - a);

  for (const idx of indices) {
    const ops = byIdx.get(idx) ?? [];
    const dels = ops.filter((o) => o.deleteLine);
    const ins = ops.filter((o) => typeof o.insertText === "string" && o.insertText.length);

    for (let i = 0; i < dels.length; i++) {
      if (idx >= 0 && idx < lines.length) lines.splice(idx, 1);
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
async function deleteIoImage(plugin: SproutPlugin, imageRef: string): Promise<void> {
  const normalized = normalizeIoImageRef(imageRef);
  if (!normalized) return;

  try {
    const vault = plugin.app.vault;
    const file = vault.getAbstractFileByPath(normalized);
    if (file && file instanceof TFile) await plugin.app.fileManager.trashFile(file);
  } catch (e) {
    log.warn(`Failed to delete IO image ${normalized}:`, e);
  }
}

/** Deletes all io-child records (and their states) for a given `parentId`. */
function deleteIoChildren(plugin: SproutPlugin, parentId: string): number {
  let deleted = 0;

  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) !== "io-child") continue;
    if (String(rec.parentId || "") !== String(parentId || "")) continue;

    delete plugin.store.data.cards[id];
    if (plugin.store.data.states) delete (plugin.store.data.states)[id];
    deleted += 1;
  }

  // Defensive: clean io-child entries from quarantine too.
  for (const id of Object.keys(plugin.store.data.quarantine || {})) {
    const q = plugin.store.data.quarantine[id];
    if (!q) continue;
    const qRec = q as Record<string, unknown>;
    const qType = typeof qRec.type === "string" ? qRec.type : "";
    const qParentId = typeof qRec.parentId === "string" ? qRec.parentId : "";
    if (qType !== "io-child") continue;
    if (qParentId !== String(parentId || "")) continue;

    delete plugin.store.data.quarantine[id];
    if (plugin.store.data.states) delete (plugin.store.data.states)[id];
    deleted += 1;
  }

  return deleted;
}

/** Sweep: deletes io-child cards whose parentId no longer exists as an IO card. */
function deleteOrphanIoChildren(plugin: SproutPlugin): number {
  const liveParents = new Set<string>();

  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) === "io") liveParents.add(String(rec.id ?? id));
  }

  let removed = 0;
  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) !== "io-child") continue;

    const pid = String(rec.parentId || "");
    if (!pid || !liveParents.has(pid)) {
      delete plugin.store.data.cards[id];
      if (plugin.store.data.states) delete (plugin.store.data.states)[id];
      removed += 1;
    }
  }

  return removed;
}

// ────────────────────────────────────────────
// Cloze child helpers
// ────────────────────────────────────────────

/** Extracts cloze deletion indices (e.g. `{{c1::…}}`) from raw text. */
function extractClozeIndices(text: string): number[] {
  const raw = String(text ?? "");
  const re = /\{\{c(\d+)::/gi;
  const out = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** Stable deterministic ID for a cloze child: `${parentId}::cloze::c${idx}`. */
function stableClozeChildId(parentId: string, idx: number): string {
  return `${parentId}::cloze::c${idx}`;
}

/** Deletes all cloze-child records (and their states) for a given `parentId`. */
function deleteClozeChildren(plugin: SproutPlugin, parentId: string): number {
  let deleted = 0;

  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) !== "cloze-child") continue;
    if (String(rec.parentId || "") !== String(parentId || "")) continue;

    delete plugin.store.data.cards[id];
    if (plugin.store.data.states) delete (plugin.store.data.states)[id];
    deleted += 1;
  }

  for (const id of Object.keys(plugin.store.data.quarantine || {})) {
    const q = plugin.store.data.quarantine[id];
    if (!q) continue;
    const qRec = q as Record<string, unknown>;
    const qType = typeof qRec.type === "string" ? qRec.type : "";
    const qParentId = typeof qRec.parentId === "string" ? qRec.parentId : "";
    if (qType !== "cloze-child") continue;
    if (qParentId !== String(parentId || "")) continue;

    delete plugin.store.data.quarantine[id];
    if (plugin.store.data.states) delete (plugin.store.data.states)[id];
    deleted += 1;
  }

  return deleted;
}

/** Removes cloze-child cards whose parent no longer exists as a cloze card. */
function deleteOrphanClozeChildren(plugin: SproutPlugin): number {
  const liveParents = new Set<string>();

  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) === "cloze") liveParents.add(String(rec.id ?? id));
  }

  let removed = 0;
  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) !== "cloze-child") continue;

    const pid = String(rec.parentId || "");
    if (!pid || !liveParents.has(pid)) {
      delete plugin.store.data.cards[id];
      if (plugin.store.data.states) delete (plugin.store.data.states)[id];
      removed += 1;
    }
  }

  return removed;
}

/** Collects all normalised group keys (including prefixes) across cards. */
function collectGroupKeys(cards: Record<string, CardRecord> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const card of Object.values(cards || {})) {
    if (!card) continue;
    const groups = Array.isArray(card.groups) ? card.groups : [];
    for (const raw of groups) {
      const norm = normaliseGroupPath(raw);
      if (!norm) continue;
      for (const k of expandGroupPrefixes(norm)) out.add(k);
    }
  }
  return out;
}

/** Returns the number of group keys removed between two snapshots. */
function countRemovedGroups(before: Set<string>, after: Set<string>): number {
  let removed = 0;
  for (const k of before) if (!after.has(k)) removed += 1;
  return removed;
}

/**
 * Deletes orphaned IO images from the vault.
 * An image is orphaned if it matches `sprout-io-*` but no IO card references it.
 */
async function deleteOrphanedIoImages(plugin: SproutPlugin): Promise<number> {
  if (!plugin.settings?.storage?.deleteOrphanedImages) return 0;

  const vault = plugin.app.vault;
  const allFiles = vault.getFiles();

  const referencedIoIds = new Set<string>();
  const mdFiles = vault.getMarkdownFiles();
  const re = /sprout-io-(\d{9})/g;

  for (const md of mdFiles) {
    try {
      const text = await vault.read(md);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        if (match[1]) referencedIoIds.add(match[1]);
      }
    } catch {
      // ignore
    }
    re.lastIndex = 0;
  }

  const ioCardIds = new Set<string>();
  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const card = plugin.store.data.cards[id];
    if (card && String(card.type) === "io") ioCardIds.add(String(id));
  }

  let deleted = 0;

  for (const file of allFiles) {
    if (!(file instanceof TFile)) continue;
    const match = /sprout-io-(\d{9})/.exec(file.name);
    if (!match) continue;

    const ioId = match[1];
    if (referencedIoIds.has(ioId)) continue;
    if (ioCardIds.has(ioId)) continue;

    try {
      await plugin.app.fileManager.trashFile(file);
      deleted += 1;
    } catch (e) {
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
function syncClozeChildren(plugin: SproutPlugin, parent: CardRecord, now: number, schedulingSnapshot?: StateMap | null) {
  const parentId = String(parent?.id ?? "");
  if (!parentId) return;

  const clozeIndices = extractClozeIndices(parent?.clozeText ?? "");
  const keepChildIds = new Set<string>();

  const existingChildren: CardRecord[] = [];
  for (const c of Object.values(plugin.store.data.cards || {})) {
    if (!c) continue;
    if (c.type !== "cloze-child") continue;
    if (String(c.parentId || "") !== parentId) continue;
    existingChildren.push(c);
  }

  const titleBase = parent?.title ? String(parent.title) : "Cloze";

  for (const idx of clozeIndices) {
    const childId = stableClozeChildId(parentId, idx);
    keepChildIds.add(childId);

    const prev = plugin.store.data.cards?.[childId];
    const createdAt = (() => {
      if (prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0) return Number(prev.createdAt);
      if (Number.isFinite(parent?.createdAt) && Number(parent.createdAt) > 0) return Number(parent.createdAt);
      return now;
    })();

    const rec: CardRecord = {
      id: childId,
      type: "cloze-child",
      title: `${titleBase} • c${idx}`,
      parentId,
      clozeIndex: idx,
      clozeText: parent?.clozeText ?? null,

      info: parent?.info ?? null,
      groups: parent?.groups ?? null,

      sourceNotePath: String(parent?.sourceNotePath || ""),
      sourceStartLine: Number(parent?.sourceStartLine ?? 0) || 0,

      createdAt,
      updatedAt: now,
      lastSeenAt: now,
    };

    if (prev && typeof prev === "object") {
      const merged = { ...prev, ...rec };
      plugin.store.data.cards[childId] = merged;
      plugin.store.upsertCard(merged);
    } else {
      plugin.store.data.cards[childId] = rec;
      plugin.store.upsertCard(rec);
    }

    // Restore scheduling if it exists; otherwise create state if missing (never reset).
    if (!hasState(plugin, childId)) {
      const restored = upsertStateIfPresent(plugin, schedulingSnapshot, childId);
      if (!restored) ensureStateIfMissing(plugin, childId, now, 2.5);
    }
  }

  for (const ch of existingChildren) {
    const id = String(ch.id || "");
    if (!id) continue;
    if (keepChildIds.has(id)) continue;
    delete plugin.store.data.cards[id];
    if (plugin.store.data.states) delete (plugin.store.data.states)[id];
  }
}

// ────────────────────────────────────────────
// MCQ option conversion (parser → store legacy fields)
// ────────────────────────────────────────────

/**
 * Converts parsed MCQ data into legacy store fields (`options[]` + `correctIndex`).
 */
function mcqLegacyFromParsed(c: ParsedCard): { options: string[]; correctIndex: number | null } {
  if (c.type === "mcq") {
    const correct = typeof c.a === "string" ? c.a.trim() : null;
    let wrongs = Array.isArray(c.options) ? c.options.map((o) => String(o.text ?? "").trim()) : [];
    if (correct) {
      wrongs = wrongs.filter(w => w !== correct);
    }
    const options = correct ? [correct, ...wrongs] : wrongs;
    const correctIndex = correct ? 0 : null;
    return { options, correctIndex };
  }
  // fallback legacy
  const opts = Array.isArray(c.options) ? c.options : [];
  const options = opts.map((o) => String(o?.text ?? "")).map((s) => s.trim());
  let correctIndex: number | null =
    Number.isFinite(c.correctIndex) && c.correctIndex !== null ? c.correctIndex : null;
  if (correctIndex === null) {
    const idx = opts.findIndex((o) => !!o?.isCorrect);
    correctIndex = idx >= 0 ? idx : null;
  }
  return { options, correctIndex };
}

// ────────────────────────────────────────────
// IO extraction (tolerant)
// ────────────────────────────────────────────

/**
 * Normalises an IO image reference: handles `![[embed]]`, `![alt](url)`,
 * and plain path strings. Returns `null` for empty/invalid refs.
 */
function normalizeIoImageRef(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const embedMatch = text.match(/!\[\[([^\]]+)\]\]/);
  if (embedMatch?.[1]) {
    const inner = embedMatch[1].trim();
    return inner.split("|")[0]?.trim() || null;
  }

  const mdMatch = text.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (mdMatch?.[1]) {
    const inner = mdMatch[1].trim();
    return inner.split(" ")[0]?.trim() || null;
  }

  return text;
}

/** Extracts IO-specific fields from a parsed card. */
function ioFieldsFromParsed(c: ParsedCard): { imageRef: string | null; occlusions: unknown[] | null; maskMode: "solo" | "all" | null } {
  const legacy = c as unknown as Record<string, unknown>;
  const rawImageRef =
    typeof legacy?.imageRef === "string"
      ? legacy.imageRef
      : typeof c?.ioSrc === "string"
        ? c.ioSrc
        : null;

  const imageRef = normalizeIoImageRef(rawImageRef);

  const occlusionsRaw = c?.occlusions ?? null;
  const occlusions = Array.isArray(occlusionsRaw) ? occlusionsRaw : null;

  const maskMode = (c?.maskMode ?? legacy?.mode ?? legacy?.ioMode ?? null) as "solo" | "all" | null;

  return { imageRef, occlusions, maskMode };
}

/** Regex to extract a Sprout IO image ID from a filename. */
const IO_IMAGE_ID_RE = /sprout-io-(\d{9})/i;

/** Attempts to infer the card ID from an IO card's image reference. */
function inferIoIdFromCard(c: ParsedCard): string | null {
  if (!c || c.type !== "io") return null;
  const raw = String(c?.ioSrc ?? "");
  if (!raw) return null;
  const match = IO_IMAGE_ID_RE.exec(raw);
  return match?.[1] ?? null;
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
export async function syncOneFile(plugin: SproutPlugin, file: TFile) {
  return withFileSyncLock(file.path, async () => {
    const vault = plugin.app.vault;
    const now = Date.now();

    const groupsBefore = collectGroupKeys(plugin.store.data.cards || {});

    // Routine backups are throttled + capped; manual backups live in Settings → Backups.
    await ensureRoutineBackupIfNeeded(plugin);

    purgeDeprecatedTypes(plugin);
    quarantineIoCardsWithMissingImages(plugin);

    const originalText = await vault.read(file);
    const lines = originalText.split(/\r?\n/);

    const parseText = normaliseTextForParsing(originalText);
    const { cards } = parseCardsFromText(file.path, parseText, plugin.settings.indexing.ignoreInCodeFences);

    // If store is empty but we parsed cards, attempt recovery of scheduling snapshot BEFORE we start creating states.
    const schedulingSnapshot = isLikelyRecoveryScenario(plugin, cards.length) ? await loadBestSchedulingSnapshot(plugin) : null;

    // Mark existing cards/quarantine from this note as unseen for this run
    for (const id of Object.keys(plugin.store.data.cards || {})) {
      const rec = plugin.store.data.cards[id];
      if (!rec) continue;
      if (rec.sourceNotePath !== file.path) continue;
      if (String(rec.type) === "io-child" || String(rec.type) === "cloze-child") continue;
      rec.lastSeenAt = 0;
    }
    for (const id of Object.keys(plugin.store.data.quarantine || {})) {
      const q = plugin.store.data.quarantine[id];
      if (q && q.notePath === file.path) q.lastSeenAt = 0;
    }

    const usedIds = new Set<string>([
      ...Object.keys(plugin.store.data.cards || {}),
      ...Object.keys(plugin.store.data.quarantine || {}),
      ...collectAnchorIdsFromLines(lines),
    ]);

    const existingAnchorIds = collectAnchorIdsFromLines(lines);

    const edits: TextEdit[] = [];
    const keepIds = new Set<string>();

    let idsInserted = 0;
    let anchorsRemoved = 0;

    // 1) Ensure every parsed card has an anchor ID
    for (const c of cards as Array<ParsedCard & { assignedId?: string }>) {
      let id: string | null = c.id ? String(c.id) : null;

      if (!id) {
        const inferred = inferIoIdFromCard(c);
        if (inferred) {
          const existing = plugin.store.data.cards?.[inferred] ?? plugin.store.data.quarantine?.[inferred];
          const sameNote = existing && String((existing as { sourceNotePath?: string }).sourceNotePath || (existing as { notePath?: string }).notePath || "") === file.path;
          id = !usedIds.has(inferred) || sameNote ? inferred : generateUniqueId(usedIds);
        } else {
          id = generateUniqueId(usedIds);
        }
        c.assignedId = id;
      }

      usedIds.add(id);
      keepIds.add(id);

      if (!existingAnchorIds.has(id)) {
        const insertAt = findAnchorInsertLineIndex(lines, c.sourceStartLine);
        const prefix = inferPrefixAt(lines, insertAt);
        edits.push({ lineIndex: insertAt, insertText: `${prefix}^sprout-${id}` });
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

    // 3) Apply file edits
    if (edits.length) {
      applyEditsToLines(lines, edits);
      await vault.modify(file, lines.join("\n"));
    }

    // Recovery: if we found a snapshot, attach states for known IDs before we create defaults.
    if (schedulingSnapshot && Object.keys(schedulingSnapshot).length) {
      for (const id of keepIds) {
        if (!hasState(plugin, id)) upsertStateIfPresent(plugin, schedulingSnapshot, id);
      }
    }

    // 4) Upsert DB records for parsed cards
    let newCount = 0;
    let updatedCount = 0;
    let sameCount = 0;
    let quarantinedCount = 0;
    const quarantinedIds: string[] = [];

    for (const c of cards as Array<ParsedCard & { assignedId?: string }>) {
      const id = String(c.id || c.assignedId || "");
      if (!id) continue;

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

      if (plugin.store.data.quarantine && plugin.store.data.quarantine[id]) delete plugin.store.data.quarantine[id];

      const prev = plugin.store.data.cards[id];
      const createdAt = prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0 ? Number(prev.createdAt) : now;

      const clozeChildren = c.type === "cloze" ? extractClozeIndices(c.clozeText ?? "") : null;

      const record: CardRecord = {
        id,
        type: c.type,

        title: c.title ?? null,

        q: c.type === "basic" ? (c.q ?? null) : null,
        a: c.type === "basic" ? (c.a ?? null) : c.type === "mcq" ? (c.a ?? null) : null,

        stem: c.type === "mcq" ? (c.stem ?? null) : null,
        ...(c.type === "mcq"
          ? (() => {
              const { options, correctIndex } = mcqLegacyFromParsed(c);
              return { options: options.length ? options : [], correctIndex };
            })()
          : {}),

        clozeText: c.type === "cloze" ? (c.clozeText ?? null) : null,
        clozeChildren: c.type === "cloze" ? clozeChildren : null,

        ...(c.type === "io"
          ? (() => {
              const { imageRef, occlusions, maskMode } = ioFieldsFromParsed(c);
              return {
                imageRef: imageRef ?? null,
                occlusions: occlusions ?? null,
                maskMode: maskMode ?? null,
                prompt: c.prompt ?? null,
              };
            })()
          : {}),

        info: c.info ?? null,
        groups: c.groups ?? null,

        sourceNotePath: c.sourceNotePath,
        sourceStartLine: c.sourceStartLine,

        createdAt,
        updatedAt: now,
        lastSeenAt: now,
      };

      if (!prev) newCount += 1;
      else if (cardSignature(prev) !== cardSignature(record)) updatedCount += 1;
      else sameCount += 1;

      plugin.store.upsertCard(record);

      if (!hasState(plugin, id)) {
        const restored = upsertStateIfPresent(plugin, schedulingSnapshot, id);
        if (!restored) ensureStateIfMissing(plugin, id, now, 2.5);
      }

      if (c.type === "cloze") syncClozeChildren(plugin, record, now, schedulingSnapshot);

      // IO: verify image exists, else quarantine
      if (c.type === "io") {
        const imageRef = normalizeIoImageRef(record.imageRef);
        if (imageRef) {
          const imageFile = plugin.app.vault.getAbstractFileByPath(imageRef);
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

            ensureStateIfMissing(plugin, id, now, 2.5);
          }
        }
      }
    }

    // 5) Remove stale cards/quarantine entries no longer present in this note
    let removed = 0;
    const removedIoParentData: Array<{ id: string; imageRef: string | null }> = [];
    const removedClozeParents: string[] = [];

    for (const id of Object.keys(plugin.store.data.cards || {})) {
      const rec = plugin.store.data.cards[id];
      if (!rec) continue;
      if (rec.sourceNotePath !== file.path) continue;
      if (String(rec.type) === "io-child" || String(rec.type) === "cloze-child") continue;

      if (rec.lastSeenAt === 0) {
        if (String(rec.type) === "io") removedIoParentData.push({ id: String(id), imageRef: rec.imageRef || null });
        if (String(rec.type) === "cloze") removedClozeParents.push(String(id));

        delete plugin.store.data.cards[id];
        if (plugin.store.data.states) delete (plugin.store.data.states)[id];
        removed += 1;
      }
    }

    for (const ioData of removedIoParentData) {
      removed += deleteIoChildren(plugin, ioData.id);
      if (ioData.imageRef) await deleteIoImage(plugin, ioData.imageRef);
      const ioMap = plugin.store.data.io || {};
      if (ioMap[ioData.id]) delete ioMap[ioData.id];
    }

    for (const parentId of removedClozeParents) removed += deleteClozeChildren(plugin, parentId);

    for (const id of Object.keys(plugin.store.data.quarantine || {})) {
      const q = plugin.store.data.quarantine[id];
      if (q && q.notePath === file.path && q.lastSeenAt === 0) {
        delete plugin.store.data.quarantine[id];
        if (plugin.store.data.states) delete (plugin.store.data.states)[id];
        removed += 1;
      }
    }

    removed += deleteOrphanIoChildren(plugin);
    removed += deleteOrphanClozeChildren(plugin);

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
export async function syncQuestionBank(plugin: SproutPlugin) {
  return withVaultSyncLock(async () => {
    const now = Date.now();

    const groupsBefore = collectGroupKeys(plugin.store.data.cards || {});

    // NOTE: Backups are no longer created automatically here. Use Settings → Backups.

    purgeDeprecatedTypes(plugin);
    quarantineIoCardsWithMissingImages(plugin);

    const vault = plugin.app.vault;
    const mdFiles = vault.getMarkdownFiles();

    const schedulingSnapshot = await loadBestSchedulingSnapshot(plugin);

    for (const id of Object.keys(plugin.store.data.cards || {})) {
      const c = plugin.store.data.cards[id];
      if (!c) continue;
      if (String(c.type) === "io-child" || String(c.type) === "cloze-child") continue;
      c.lastSeenAt = 0;
    }
    for (const id of Object.keys(plugin.store.data.quarantine || {})) {
      const q = plugin.store.data.quarantine[id];
      if (q) q.lastSeenAt = 0;
    }

    let idsInserted = 0;
    let anchorsRemoved = 0;

    let newCount = 0;
    let updatedCount = 0;
    let sameCount = 0;
    let quarantinedCount = 0;
    const quarantinedIds: string[] = [];

    let removed = 0;

    const usedIds = new Set<string>([
      ...Object.keys(plugin.store.data.cards || {}),
      ...Object.keys(plugin.store.data.quarantine || {}),
    ]);

    const parsedAll: Array<ParsedCard & { assignedId?: string }> = [];

    const buildFilePlan = (file: TFile, text: string) => {
      const addedIds: string[] = [];
      const lines = text.split(/\r?\n/);

      const parseText = normaliseTextForParsing(text);
      const { cards } = parseCardsFromText(file.path, parseText, plugin.settings.indexing.ignoreInCodeFences);
      if (!cards.length) {
        return { cards: [], edits: [], lines, keepIds: new Set<string>(), idsInserted: 0, anchorsRemoved: 0, addedIds };
      }

      const existingAnchorIds = collectAnchorIdsFromLines(lines);
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

      const keepIds = new Set<string>();
      const edits: TextEdit[] = [];
      let planInserted = 0;
      let planRemoved = 0;

      for (const c of cards as Array<ParsedCard & { assignedId?: string }>) {
        let id: string | null = c.id ? String(c.id) : null;

        if (!id) {
          const inferred = inferIoIdFromCard(c);
          if (inferred) {
            const existing = plugin.store.data.cards?.[inferred] ?? plugin.store.data.quarantine?.[inferred];
            const sameNote = existing && String((existing as { sourceNotePath?: string }).sourceNotePath || (existing as { notePath?: string }).notePath || "") === file.path;
            id = !usedIds.has(inferred) || sameNote ? inferred : generateUniqueId(usedIds);
          } else {
            id = generateUniqueId(usedIds);
          }
          c.assignedId = id;
        }

        if (!usedIds.has(id)) {
          usedIds.add(id);
          addedIds.push(id);
        }
        keepIds.add(id);

        if (!existingAnchorIds.has(id)) {
          const insertAt = findAnchorInsertLineIndex(lines, c.sourceStartLine);
          const prefix = inferPrefixAt(lines, insertAt);
          edits.push({ lineIndex: insertAt, insertText: `${prefix}^sprout-${id}` });
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
      let text = await vault.read(file);
      let plan = buildFilePlan(file, text);
      if (!plan.cards.length) continue;

      if (plan.edits.length) {
        const latestText = await vault.read(file);
        if (latestText !== text) {
          for (const id of plan.addedIds) usedIds.delete(id);
          text = latestText;
          plan = buildFilePlan(file, text);
        }

        if (plan.edits.length) {
          const lines = plan.lines.slice();
          applyEditsToLines(lines, plan.edits);
          await vault.modify(file, lines.join("\n"));
        }
      }

      idsInserted += plan.idsInserted;
      anchorsRemoved += plan.anchorsRemoved;
      parsedAll.push(...plan.cards);
    }

    for (const c of parsedAll) {
      const id = String(c.id || c.assignedId || "");
      if (!id) continue;

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

      if (plugin.store.data.quarantine && plugin.store.data.quarantine[id]) delete plugin.store.data.quarantine[id];

      const prev = plugin.store.data.cards[id];
      const createdAt = prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0 ? Number(prev.createdAt) : now;

      const record: CardRecord = {
        id,
        type: c.type,

        title: c.title ?? null,

        q: c.type === "basic" ? (c.q ?? null) : null,
        a: c.type === "basic" ? (c.a ?? null) : c.type === "mcq" ? (c.a ?? null) : null,

        stem: c.type === "mcq" ? (c.stem ?? null) : null,
        ...(c.type === "mcq"
          ? (() => {
              const { options, correctIndex } = mcqLegacyFromParsed(c);
              return { options: options.length ? options : [], correctIndex };
            })()
          : {}),

        clozeText: c.type === "cloze" ? (c.clozeText ?? null) : null,

        ...(c.type === "io"
          ? (() => {
              const { imageRef, occlusions, maskMode } = ioFieldsFromParsed(c);
              return {
                imageRef: imageRef ?? null,
                occlusions: occlusions ?? null,
                maskMode: maskMode ?? null,
                prompt: c.prompt ?? null,
              };
            })()
          : {}),

        info: c.info ?? null,
        groups: c.groups ?? null,

        sourceNotePath: c.sourceNotePath,
        sourceStartLine: c.sourceStartLine,

        createdAt,
        updatedAt: now,
        lastSeenAt: now,
      };

      if (!prev) newCount += 1;
      else if (cardSignature(prev) !== cardSignature(record)) updatedCount += 1;
      else sameCount += 1;

      plugin.store.upsertCard(record);

      if (!hasState(plugin, id)) {
        const restored = upsertStateIfPresent(plugin, schedulingSnapshot, id);
        if (!restored) ensureStateIfMissing(plugin, id, now, 2.5);
      }

      if (c.type === "cloze") syncClozeChildren(plugin, record, now, schedulingSnapshot);

      if (c.type === "io") {
        const imageRef = normalizeIoImageRef(record.imageRef);
        if (imageRef) {
          const imageFile = plugin.app.vault.getAbstractFileByPath(imageRef);
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

            ensureStateIfMissing(plugin, id, now, 2.5);
          }
        }
      }
    }

    const removedIoParentData: Array<{ id: string; imageRef: string | null }> = [];
    const removedClozeParents: string[] = [];

    for (const id of Object.keys(plugin.store.data.cards || {})) {
      const card = plugin.store.data.cards[id];
      if (!card) continue;

      if (String(card.type) === "io-child" || String(card.type) === "cloze-child") continue;

      if (card.lastSeenAt !== now) {
        if (String(card.type) === "io") removedIoParentData.push({ id: String(id), imageRef: card.imageRef || null });
        if (String(card.type) === "cloze") removedClozeParents.push(String(id));

        delete plugin.store.data.cards[id];
        if (plugin.store.data.states) delete (plugin.store.data.states)[id];
        removed += 1;
      }
    }

    for (const ioData of removedIoParentData) {
      removed += deleteIoChildren(plugin, ioData.id);
      if (ioData.imageRef) await deleteIoImage(plugin, ioData.imageRef);
      const ioMap = plugin.store.data.io || {};
      if (ioMap[ioData.id]) delete ioMap[ioData.id];
    }

    for (const parentId of removedClozeParents) removed += deleteClozeChildren(plugin, parentId);

    for (const id of Object.keys(plugin.store.data.quarantine || {})) {
      const q = plugin.store.data.quarantine[id];
      if (q && q.lastSeenAt !== now) {
        delete plugin.store.data.quarantine[id];
        if (plugin.store.data.states) delete (plugin.store.data.states)[id];
        removed += 1;
      }
    }

    removed += deleteOrphanIoChildren(plugin);
    removed += deleteOrphanClozeChildren(plugin);

    const groupsAfter = collectGroupKeys(plugin.store.data.cards || {});
    const tagsDeleted = countRemovedGroups(groupsBefore, groupsAfter);

    const deletedImages = await deleteOrphanedIoImages(plugin);
    if (deletedImages > 0) log.info(`Deleted ${deletedImages} orphaned IO image(s)`);

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
