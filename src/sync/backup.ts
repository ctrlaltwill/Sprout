/**
 * src/sync/backup.ts
 * ──────────────────
 * Backup management for the Sprout data store (data.json).
 *
 * Provides:
 *  - Types:     DataJsonBackupEntry, DataJsonBackupStats
 *  - CRUD:      listDataJsonBackups, getDataJsonBackupStats,
 *               createDataJsonBackupNow, restoreFromDataJsonBackup
 *  - Routine:   ensureRoutineBackupIfNeeded (called by sync engine)
 *  - Helpers:   Low-level adapter/filesystem utilities (also used by
 *               the sync engine via re-export)
 */

import type SproutPlugin from "../main";
import { MS_DAY } from "../core/constants";

// ────────────────────────────────────────────
// Module-level constants & mutable state
// ────────────────────────────────────────────

/** Maximum number of automatic backup files to keep on disk. */
const BACKUP_MAX_COUNT = 12;

/** Minimum interval between automatic (routine) backups. */
const ROUTINE_BACKUP_MIN_INTERVAL_MS = MS_DAY;

/** Cooldown to avoid re-checking backup necessity on every sync. */
const ROUTINE_CHECK_COOLDOWN_MS = 5 * 60 * 1000;

/** Tracks the last time we checked whether a routine backup was needed. */
let lastRoutineBackupCheck = 0;

// ────────────────────────────────────────────
// Generic low-level utilities
// (exported so sync-engine.ts can re-use them)
// ────────────────────────────────────────────

/** Returns `true` if `v` is a non-null, non-array plain object. */
export function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Safely counts the number of own keys on a plain object. */
export function countObjectKeys(v: any): number {
  return isPlainObject(v) ? Object.keys(v).length : 0;
}

/** Joins path segments with `/`, collapsing duplicate slashes. */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => typeof p === "string" && p.length)
    .join("/")
    .replace(/\/+/g, "/");
}

/**
 * Heuristic: returns `true` if `k` looks like a Sprout-generated
 * card-state key (9-digit parent or `parent::cloze::cN` child).
 */
export function likelySproutStateKey(k: string): boolean {
  return /^\d{9}$/.test(k) || /^\d{9}::cloze::c\d+$/.test(k) || /^\d{9}::/.test(k);
}

/**
 * Tries to extract a `states` object from a parsed data.json structure.
 * Supports both `{ states: {...} }` and `{ data: { states: {...} } }`.
 */
export function extractStatesFromDataJsonObject(obj: any): Record<string, any> | null {
  if (!obj) return null;
  const root = isPlainObject(obj.data) ? obj.data : obj;
  const states = (root)?.states;
  if (!isPlainObject(states)) return null;
  return states;
}

// ────────────────────────────────────────────
// Vault adapter helpers
// ────────────────────────────────────────────

/**
 * Attempts to read and parse a JSON file from the vault adapter.
 * Returns `null` on any failure (missing file, bad JSON, etc.).
 */
export async function tryReadJson(adapter: any, path: string): Promise<any | null> {
  try {
    if (!adapter) return null;
    if (typeof adapter.exists === "function") {
      const exists = await adapter.exists(path);
      if (!exists) return null;
    }
    if (typeof adapter.read !== "function") return null;
    const text = await adapter.read(path);
    if (!text || !String(text).trim()) return null;
    try {
      return JSON.parse(String(text));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** Lists sub-folders inside `path` using the vault adapter. */
export async function safeListFolders(adapter: any, path: string): Promise<string[]> {
  try {
    if (!adapter) return [];
    if (typeof adapter.list === "function") {
      const res = await adapter.list(path);
      const folders = Array.isArray(res?.folders) ? res.folders : [];
      return folders.map((p: string) => String(p)).filter(Boolean);
    }
    if (typeof adapter.readdir === "function") {
      const res = await adapter.readdir(path);
      const folders = Array.isArray(res?.folders) ? res.folders : [];
      return folders.map((p: string) => String(p)).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

/** Lists files inside `path` using the vault adapter. */
export async function safeListFiles(adapter: any, path: string): Promise<string[]> {
  try {
    if (!adapter) return [];
    if (typeof adapter.list === "function") {
      const res = await adapter.list(path);
      const files = Array.isArray(res?.files) ? res.files : [];
      return files.map((p: string) => String(p)).filter(Boolean);
    }
    if (typeof adapter.readdir === "function") {
      const res = await adapter.readdir(path);
      const files = Array.isArray(res?.files) ? res.files : [];
      return files.map((p: string) => String(p)).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

/** Returns the mtime of a file (0 on failure). */
export async function safeStatMtime(adapter: any, path: string): Promise<number> {
  try {
    if (adapter && typeof adapter.stat === "function") {
      const st = await adapter.stat(path);
      const m = Number((st)?.mtime ?? 0);
      return Number.isFinite(m) ? m : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

/** Returns the size of a file in bytes (0 on failure). */
async function safeStatSize(adapter: any, path: string): Promise<number> {
  try {
    if (adapter && typeof adapter.stat === "function") {
      const st = await adapter.stat(path);
      const s = Number((st)?.size ?? 0);
      return Number.isFinite(s) ? s : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

/** Deletes a file using the adapter's `remove()` or `trash()`. */
async function safeRemoveFile(adapter: any, path: string): Promise<boolean> {
  try {
    if (!adapter || !path) return false;
    if (typeof adapter.remove === "function") {
      await adapter.remove(path);
      return true;
    }
    if (typeof adapter.trash === "function") {
      await adapter.trash(path);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

// ────────────────────────────────────────────
// Backup file detection & pruning
// ────────────────────────────────────────────

/** Returns `true` if the filename matches the backup naming pattern. */
function isBackupFileName(name: string): boolean {
  return /^data\.json\.bak-/.test(String(name ?? ""));
}

/**
 * Prunes old backup files, keeping at most `maxCount` (sorted by mtime desc).
 */
async function pruneDataJsonBackups(plugin: SproutPlugin, maxCount = BACKUP_MAX_COUNT): Promise<void> {
  const adapter = plugin.app?.vault?.adapter;
  const pluginId = getPluginId(plugin);
  if (!adapter || !pluginId) return;

  const folder = joinPath(".obsidian/plugins", pluginId);
  const files = await safeListFiles(adapter, folder);
  const backups = files
    .filter((p) => isBackupFileName(String(p).split("/").pop() || ""))
    .map((p) => String(p));

  if (backups.length <= maxCount) return;

  const entries = [];
  for (const p of backups) {
    const mtime = await safeStatMtime(adapter, p);
    entries.push({ path: p, mtime });
  }

  entries.sort((a, b) => b.mtime - a.mtime);
  const remove = entries.slice(maxCount);
  for (const entry of remove) {
    await safeRemoveFile(adapter, entry.path);
  }
}

// ────────────────────────────────────────────
// Plugin ID helper
// ────────────────────────────────────────────

/** Reads the plugin manifest ID (e.g. "sprout-flashcards"). */
export function getPluginId(plugin: SproutPlugin): string | null {
  const id = String(plugin.manifest?.id ?? "").trim();
  return id ? id : null;
}

// ────────────────────────────────────────────
// Backup stats helpers
// ────────────────────────────────────────────

/**
 * Locates the "store-like root" inside a parsed data.json object.
 * Looks for `{ cards, states, reviewLog, quarantine }` either at
 * top level or nested under `.data`, `.store`, or `.db`.
 */
function getStoreLikeRoot(obj: any): any | null {
  if (!obj || typeof obj !== "object") return null;

  const candidates = [obj?.data, obj?.store, obj?.db, obj] as unknown[];
  for (const c of candidates) {
    if (!isPlainObject(c)) continue;

    const rec = c as Record<string, unknown>;
    const hasCards = isPlainObject(rec.cards);
    const hasStates = isPlainObject(rec.states);
    const hasReviewLog = Array.isArray(rec.reviewLog);
    const hasQuarantine = isPlainObject(rec.quarantine);

    if (hasCards || hasStates || hasReviewLog || hasQuarantine) return c;
  }

  return null;
}

/**
 * Computes scheduling summary stats from a `states` object.
 * Returns counts for states, due, learning, review, and mature cards.
 */
function computeSchedulingStats(states: any, now: number) {
  const out = { states: 0, due: 0, learning: 0, review: 0, mature: 0 };
  if (!isPlainObject(states)) return out;
  const values = Object.values(states);
  out.states = values.length;
  for (const st of values) {
    if (!st || typeof st !== "object") continue;
    const stage = String((st).stage ?? "");
    if (stage === "learning" || stage === "relearning") out.learning += 1;
    if (stage === "review") out.review += 1;
    const stability = Number((st).stabilityDays ?? 0);
    if (stage === "review" && Number.isFinite(stability) && stability >= 30) out.mature += 1;
    const due = Number((st).due ?? 0);
    if (stage !== "suspended" && Number.isFinite(due) && due > 0 && due <= now) out.due += 1;
  }
  return out;
}

/**
 * Deep-clones a plain JSON-serialisable value.
 * Uses `structuredClone` when available, otherwise falls back to
 * JSON round-trip.
 */
function clonePlain<T>(x: T): T {
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x)) as T;
}

/**
 * Replaces all keys in `target` with those from `source`.
 * Mutates in-place to preserve existing object references (important
 * for `plugin.store.data`).
 */
function replaceObjectContents(target: any, source: any) {
  if (!target || typeof target !== "object") return;
  for (const k of Object.keys(target)) delete target[k];
  for (const k of Object.keys(source || {})) target[k] = source[k];
}

// ────────────────────────────────────────────
// Exported types
// ────────────────────────────────────────────

/** A single backup file entry (path + filesystem metadata). */
export type DataJsonBackupEntry = {
  path: string;
  name: string;
  mtime: number;
  size: number;
};

/** Extended backup entry with parsed scheduling/stat data. */
export type DataJsonBackupStats = DataJsonBackupEntry & {
  version: number;
  cards: number;
  states: number;
  due: number;
  learning: number;
  review: number;
  mature: number;
  reviewLog: number;
  quarantine: number;
  io: number;
  sproutishStateKeys: number;
};

// ────────────────────────────────────────────
// Backup CRUD functions
// ────────────────────────────────────────────

/**
 * Lists all data.json backup files in the plugin folder.
 * Sorted newest-first by mtime.
 */
export async function listDataJsonBackups(plugin: SproutPlugin): Promise<DataJsonBackupEntry[]> {
  const adapter = plugin.app?.vault?.adapter;
  const pluginId = getPluginId(plugin);
  if (!adapter || !pluginId) return [];

  const folder = joinPath(".obsidian/plugins", pluginId);
  const files = await safeListFiles(adapter, folder);

  // Include data.json and any data.json.* (bak-*, prev, old, etc.)
  const cand = files.filter((p) => /(^|\/)data\.json(\..+)?$/.test(String(p)));

  const out: DataJsonBackupEntry[] = [];
  for (const p of cand) {
    const path = String(p);
    const name = path.split("/").pop() || path;
    const mtime = await safeStatMtime(adapter, path);
    const size = await safeStatSize(adapter, path);
    out.push({ path, name, mtime, size });
  }

  out.sort((a, b) => b.mtime - a.mtime || b.size - a.size || a.name.localeCompare(b.name));
  return out;
}

/**
 * Reads and parses a backup file to extract scheduling/card statistics.
 * Returns `null` if the file can't be read or doesn't contain valid data.
 */
export async function getDataJsonBackupStats(plugin: SproutPlugin, path: string): Promise<DataJsonBackupStats | null> {
  const adapter = plugin.app?.vault?.adapter;
  if (!adapter || !path) return null;

  const obj = await tryReadJson(adapter, path);
  const root = getStoreLikeRoot(obj);
  if (!root) return null;

  const cards = (root).cards;
  const states = (root).states;
  const reviewLog = (root).reviewLog;
  const quarantine = (root).quarantine;
  const io = (root).io;

  const cardCount = countObjectKeys(cards);
  const stateKeys = isPlainObject(states) ? Object.keys(states) : [];
  const stateCount = stateKeys.length;
  const sproutishStateKeys = stateKeys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
  const sched = computeSchedulingStats(states, Date.now());

  const reviewCount = Array.isArray(reviewLog) ? reviewLog.length : 0;
  const quarantineCount = countObjectKeys(quarantine);
  const ioCount = countObjectKeys(io);

  const entry: DataJsonBackupEntry = {
    path,
    name: String(path).split("/").pop() || String(path),
    mtime: await safeStatMtime(adapter, path),
    size: await safeStatSize(adapter, path),
  };

  return {
    ...entry,
    version: Number((root).version ?? 0) || 0,
    cards: cardCount,
    states: stateCount,
    due: sched.due,
    learning: sched.learning,
    review: sched.review,
    mature: sched.mature,
    reviewLog: reviewCount,
    quarantine: quarantineCount,
    io: ioCount,
    sproutishStateKeys,
  };
}

/**
 * Creates a timestamped backup of the current data.json on disk.
 * Returns the backup file path, or `null` on failure.
 */
export async function createDataJsonBackupNow(plugin: SproutPlugin, label?: string): Promise<string | null> {
  const adapter = plugin.app?.vault?.adapter;
  const pluginId = getPluginId(plugin);
  if (!adapter || !pluginId) return null;

  const dataPath = joinPath(".obsidian/plugins", pluginId, "data.json");
  if (typeof adapter.exists !== "function" || typeof adapter.read !== "function" || typeof adapter.write !== "function") return null;

  try {
    const exists = await adapter.exists(dataPath);
    if (!exists) return null;

    const text = await adapter.read(dataPath);
    if (!text || !String(text).trim()) return null;
    if (String(text).trim() === "{}") return null;

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const cleanLabel = String(label ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const suffix = cleanLabel ? `-${cleanLabel}` : "";
    const backupPath = joinPath(".obsidian/plugins", pluginId, `data.json.bak-${ts}${suffix}`);
    await adapter.write(backupPath, String(text));
    await pruneDataJsonBackups(plugin, BACKUP_MAX_COUNT);
    return backupPath;
  } catch {
    return null;
  }
}

/**
 * Restores the Sprout database from a backup file on disk.
 * Optionally creates a safety backup before overwriting.
 *
 * Mutates `plugin.store.data` in-place and persists.
 */
export async function restoreFromDataJsonBackup(
  plugin: SproutPlugin,
  backupPath: string,
  opts: { makeSafetyBackup?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  const adapter = plugin.app?.vault?.adapter;
  if (!adapter) return { ok: false, message: "No vault adapter available." };
  if (!backupPath) return { ok: false, message: "No backup path provided." };

  try {
    if (opts.makeSafetyBackup) {
      await createDataJsonBackupNow(plugin, "before-restore");
    }

    const obj = await tryReadJson(adapter, backupPath);
    const root = getStoreLikeRoot(obj);
    if (!root) return { ok: false, message: "Backup JSON did not contain a recognisable store/database structure." };

    // Only restore the store-like root (cards/states/reviewLog/quarantine/io/version/etc.)
    const snapshot = clonePlain(root);

    // Ensure required keys exist (avoid undefined holes)
    (snapshot).cards ??= {};
    (snapshot).states ??= {};
    (snapshot).reviewLog ??= [];
    (snapshot).quarantine ??= {};
    (snapshot).io ??= (snapshot).io ?? {};
    (snapshot).version = Math.max(Number((snapshot).version ?? 0) || 0, 1);

    // Mutate-in-place to preserve references to plugin.store.data
    replaceObjectContents(plugin.store.data, snapshot);

    // Persist through the store
    await plugin.store.persist();

    return { ok: true, message: "Restore completed." };
  } catch (e: any) {
    return { ok: false, message: `Restore failed: ${String(e?.message ?? e ?? "unknown error")}` };
  }
}

// ────────────────────────────────────────────
// Routine backup (called by sync engine)
// ────────────────────────────────────────────

/**
 * Checks whether enough time has elapsed since the last automatic backup
 * and creates one if needed.  Throttled by `ROUTINE_CHECK_COOLDOWN_MS`
 * and `ROUTINE_BACKUP_MIN_INTERVAL_MS`.
 */
export async function ensureRoutineBackupIfNeeded(plugin: SproutPlugin): Promise<void> {
  const now = Date.now();
  if (now - lastRoutineBackupCheck < ROUTINE_CHECK_COOLDOWN_MS) return;
  lastRoutineBackupCheck = now;

  const adapter = plugin.app?.vault?.adapter;
  const pluginId = getPluginId(plugin);
  if (!adapter || !pluginId) return;

  const folder = joinPath(".obsidian/plugins", pluginId);
  const files = await safeListFiles(adapter, folder);
  const backupFiles = files.filter((p) => isBackupFileName(String(p).split("/").pop() || ""));
  if (!backupFiles.length) {
    const created = await createDataJsonBackupNow(plugin, "auto");
    if (created) await pruneDataJsonBackups(plugin, BACKUP_MAX_COUNT);
    return;
  }

  let newest = 0;
  for (const p of backupFiles) {
    const mtime = await safeStatMtime(adapter, String(p));
    if (mtime > newest) newest = mtime;
  }

  if (newest && now - newest < ROUTINE_BACKUP_MIN_INTERVAL_MS) return;

  const created = await createDataJsonBackupNow(plugin, "auto");
  if (created) await pruneDataJsonBackups(plugin, BACKUP_MAX_COUNT);
}
