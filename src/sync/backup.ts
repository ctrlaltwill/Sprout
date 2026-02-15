/**
 * @file src/sync/backup.ts
 * @summary Backup management for the Sprout data store (data.json). Provides CRUD operations for listing, creating, restoring, and deleting backup snapshots, routine backup scheduling invoked by the sync engine, and low-level adapter/filesystem utilities shared with the sync engine. Backups include scheduling data (states, reviewLog) and analytics data (review events, session events) to preserve heatmaps, streaks, and answer-button history.
 *
 * @exports
 *  - isPlainObject                 — type guard that checks if a value is a plain object
 *  - countObjectKeys               — returns the number of own enumerable keys on an object
 *  - joinPath                      — joins path segments with forward slashes
 *  - likelySproutStateKey          — heuristic check for whether a key looks like a Sprout card state key
 *  - extractStatesFromDataJsonObject — extracts card-state entries from a parsed data.json object
 *  - tryReadJson                   — safely reads and parses a JSON file from the vault adapter
 *  - safeListFolders               — lists subfolders with error handling for missing paths
 *  - safeListFiles                 — lists files in a folder with error handling
 *  - safeStatMtime                 — returns a file's mtime or null on error
 *  - getPluginId                   — returns the plugin's ID from the manifest
 *  - DataJsonBackupEntry           — type describing a single backup file entry (path, timestamp, size)
 *  - DataJsonBackupStats           — type describing aggregate backup statistics
 *  - listDataJsonBackups           — lists all available data.json backup files
 *  - getDataJsonBackupStats        — computes summary statistics for existing backups
 *  - createDataJsonBackupNow       — creates a new backup of the current data.json immediately
 *  - restoreFromDataJsonBackup     — restores scheduling data (states, reviewLog) from a backup, preserving card content
 *  - ensureRoutineBackupIfNeeded   — creates a routine backup if enough time has elapsed since the last one
 */

import type SproutPlugin from "../main";
import type { DataAdapter } from "obsidian";
// No longer using MS_DAY — backup interval is now 15 minutes

/**
 * Minimal adapter-like interface for low-level vault filesystem access.
 * Matches the subset of Obsidian's DataAdapter that backup/sync helpers
 * actually touch, allowing feature-detection for optional methods.
 */
type AdapterLike = Partial<Pick<DataAdapter, "read" | "write" | "exists" | "remove" | "rename" | "list" | "stat">>;

// ────────────────────────────────────────────
// Module-level constants & mutable state
// ────────────────────────────────────────────

/** Maximum number of scheduling data backup files to keep on disk. */
const BACKUP_MAX_COUNT = 5;

/** Minimum interval between automatic (routine) scheduling data backups (15 minutes). */
const ROUTINE_BACKUP_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** Cooldown to avoid re-checking backup necessity on every sync. */
const ROUTINE_CHECK_COOLDOWN_MS = 2 * 60 * 1000;

/** Tracks the last time we checked whether a routine backup was needed. */
let lastRoutineBackupCheck = 0;

// ────────────────────────────────────────────
// Generic low-level utilities
// (exported so sync-engine.ts can re-use them)
// ────────────────────────────────────────────

/** Returns `true` if `v` is a non-null, non-array plain object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Safely counts the number of own keys on a plain object. */
export function countObjectKeys(v: unknown): number {
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
 * This is intentionally strict to avoid false positives from other plugins.
 */
export function likelySproutStateKey(k: string): boolean {
  // Match 9-digit parent keys: "123456789"
  if (/^\d{9}$/.test(k)) return true;
  // Match cloze child keys: "123456789::cloze::c1"
  if (/^\d{9}::cloze::c\d+$/.test(k)) return true;
  // Match other child patterns: "123456789::io::rect1", "123456789::rev::forward", etc.
  if (/^\d{9}::[a-z]+::.+$/.test(k)) return true;
  return false;
}

/**
 * Validates whether a state object looks like a legitimate Sprout CardState.
 * Checks for presence of FSRS scheduling fields to avoid loading unrelated data.
 */
function isValidSproutState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  
  // Check for FSRS fields (mature/review states)
  const hasStabilityDays = typeof s.stabilityDays === "number";
  const hasDifficulty = typeof s.difficulty === "number";
  
  // Check for basic scheduling fields (all states)
  const hasDue = typeof s.due === "number";
  const hasStage = typeof s.stage === "string" || typeof s.stage === "number";
  const hasLapses = typeof s.lapses === "number";
  const hasReps = typeof s.reps === "number";
  
  // Accept if it has FSRS fields OR has stage (Sprout-specific) + any other scheduling field
  const hasFSRS = hasStabilityDays || hasDifficulty;
  const hasBasicScheduling = hasStage && (hasDue || hasReps || hasLapses);
  
  // Also accept if it only has stage (for minimal/edge cases, but stage is Sprout-specific)
  return hasFSRS || hasBasicScheduling || hasStage;
}

/**
 * Tries to extract a `states` object from a parsed data.json structure.
 * Supports both `{ states: {...} }` and `{ data: { states: {...} } }`.
 * Validates state objects to prevent loading foreign plugin data.
 */
export function extractStatesFromDataJsonObject(obj: unknown): Record<string, unknown> | null {
  if (!obj) return null;
  const o = obj as Record<string, unknown>;
  const root = isPlainObject(o.data) ? o.data : o;
  const states = (root)?.states;
  if (!isPlainObject(states)) return null;
  
  // Additional safety: verify at least some states are valid Sprout scheduling states
  const stateEntries = Object.entries(states);
  if (stateEntries.length === 0) return null;
  
  // Sample first few entries to validate structure
  const sampleSize = Math.min(5, stateEntries.length);
  let validCount = 0;
  let sproutKeyCount = 0;
  
  for (let i = 0; i < sampleSize; i++) {
    const [key, value] = stateEntries[i];
    const keyMatchesSprout = likelySproutStateKey(key);
    const stateIsValid = isValidSproutState(value);
    
    // Count how many keys match Sprout pattern
    if (keyMatchesSprout) sproutKeyCount++;
    
    // Count valid Sprout states (both key pattern AND state structure must match)
    if (keyMatchesSprout && stateIsValid) {
      validCount++;
    }
  }
  
  // If we found at least one Sprout-patterned key, require those to have valid states
  // If no Sprout-patterned keys found in sample, this is likely not Sprout data
  if (sproutKeyCount === 0) return null;
  
  // At least 60% of Sprout-patterned keys should have valid state structures
  if (validCount < sproutKeyCount * 0.6) return null;
  
  return states;
}

// ────────────────────────────────────────────
// Vault adapter helpers
// ────────────────────────────────────────────

/**
 * Attempts to read and parse a JSON file from the vault adapter.
 * Returns `null` on any failure (missing file, bad JSON, etc.).
 */
export async function tryReadJson(adapter: AdapterLike | null, path: string): Promise<unknown> {
  try {
    if (!adapter) return null;
    if (adapter.exists) {
      const exists = await adapter.exists(path);
      if (!exists) return null;
    }
    if (!adapter.read) return null;
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
export async function safeListFolders(adapter: AdapterLike | null, path: string): Promise<string[]> {
  try {
    if (!adapter) return [];
    if (adapter.list) {
      const res = await adapter.list(path);
      const folders = Array.isArray(res?.folders) ? res.folders : [];
      return folders.map((p) => String(p)).filter(Boolean);
    }
    const readdir = (adapter as unknown as Record<string, unknown>).readdir as ((p: string) => Promise<{ folders?: string[] }>) | undefined;
    if (readdir) {
      const res = await readdir(path);
      const folders = Array.isArray(res?.folders) ? res.folders : [];
      return folders.map((p) => String(p)).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

/** Lists files inside `path` using the vault adapter. */
export async function safeListFiles(adapter: AdapterLike | null, path: string): Promise<string[]> {
  try {
    if (!adapter) return [];
    if (adapter.list) {
      const res = await adapter.list(path);
      const files = Array.isArray(res?.files) ? res.files : [];
      return files.map((p) => String(p)).filter(Boolean);
    }
    const readdir = (adapter as unknown as Record<string, unknown>).readdir as ((p: string) => Promise<{ files?: string[] }>) | undefined;
    if (readdir) {
      const res = await readdir(path);
      const files = Array.isArray(res?.files) ? res.files : [];
      return files.map((p) => String(p)).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

/** Returns the mtime of a file (0 on failure). */
export async function safeStatMtime(adapter: AdapterLike | null, path: string): Promise<number> {
  try {
    if (adapter?.stat) {
      const st = await adapter.stat(path);
      const m = Number(st?.mtime ?? 0);
      return Number.isFinite(m) ? m : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

/** Returns the size of a file in bytes (0 on failure). */
async function safeStatSize(adapter: AdapterLike | null, path: string): Promise<number> {
  try {
    if (adapter?.stat) {
      const st = await adapter.stat(path);
      const s = Number(st?.size ?? 0);
      return Number.isFinite(s) ? s : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

/** Deletes a file using the adapter's `remove()` or `trash()`. */
async function safeRemoveFile(adapter: AdapterLike | null, path: string): Promise<boolean> {
  try {
    if (!adapter || !path) return false;
    if (adapter.remove) {
      await adapter.remove(path);
      return true;
    }
    const trash = (adapter as unknown as Record<string, unknown>).trash as ((p: string) => Promise<void>) | undefined;
    if (trash) {
      await trash(path);
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

  const folder = joinPath(plugin.app.vault.configDir, "plugins", pluginId);
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

/** Reads the plugin manifest ID (e.g. "sprout"). */
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
function getStoreLikeRoot(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const candidates = [o?.data, o?.store, o?.db, obj] as unknown[];
  for (const c of candidates) {
    if (!isPlainObject(c)) continue;

    const rec = c;
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
function computeSchedulingStats(states: unknown, now: number) {
  const out = { states: 0, due: 0, learning: 0, review: 0, mature: 0 };
  if (!isPlainObject(states)) return out;
  const values = Object.values(states);
  out.states = values.length;
  for (const st of values) {
    if (!st || typeof st !== "object") continue;
    const entry = st as Record<string, unknown>;
    const stageRaw = entry.stage;
    const stage =
      typeof stageRaw === "string"
        ? stageRaw
        : typeof stageRaw === "number"
          ? String(stageRaw)
          : "";
    if (stage === "learning" || stage === "relearning") out.learning += 1;
    if (stage === "review") out.review += 1;
    const stability = Number(entry.stabilityDays ?? 0);
    if (stage === "review" && Number.isFinite(stability) && stability >= 30) out.mature += 1;
    const due = Number(entry.due ?? 0);
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
  analyticsEvents: number;
  analyticsReviewEvents: number;
  analyticsSessionEvents: number;
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

  const folder = joinPath(plugin.app.vault.configDir, "plugins", pluginId);
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

  const cards = root.cards;
  const states = root.states;
  const reviewLog = root.reviewLog;
  const quarantine = root.quarantine;
  const io = root.io;

  const cardCount = countObjectKeys(cards);
  const stateKeys = isPlainObject(states) ? Object.keys(states) : [];
  const stateCount = stateKeys.length;
  const sproutishStateKeys = stateKeys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
  const sched = computeSchedulingStats(states, Date.now());

  const reviewCount = Array.isArray(reviewLog) ? reviewLog.length : 0;
  const quarantineCount = countObjectKeys(quarantine);
  const ioCount = countObjectKeys(io);

  // Analytics stats
  const analyticsRaw = root.analytics;
  const analyticsEvents: unknown[] =
    isPlainObject(analyticsRaw) && Array.isArray((analyticsRaw).events)
      ? (analyticsRaw).events as unknown[]
      : [];
  const analyticsEventCount = analyticsEvents.length;
  const analyticsReviewCount = analyticsEvents.filter(
    (e) => isPlainObject(e) && (e).kind === "review",
  ).length;
  const analyticsSessionCount = analyticsEvents.filter(
    (e) => isPlainObject(e) && (e).kind === "session",
  ).length;

  const entry: DataJsonBackupEntry = {
    path,
    name: String(path).split("/").pop() || String(path),
    mtime: await safeStatMtime(adapter, path),
    size: await safeStatSize(adapter, path),
  };

  return {
    ...entry,
    version: Number(root.version ?? 0) || 0,
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
    analyticsEvents: analyticsEventCount,
    analyticsReviewEvents: analyticsReviewCount,
    analyticsSessionEvents: analyticsSessionCount,
  };
}

/**
 * Creates a timestamped backup of the current scheduling and analytics data on disk.
 * Saves states, reviewLog, and analytics events — not card content, IO maps, or quarantine.
 * Returns the backup file path, or `null` on failure.
 */
export async function createDataJsonBackupNow(plugin: SproutPlugin, label?: string): Promise<string | null> {
  const adapter = plugin.app?.vault?.adapter;
  const pluginId = getPluginId(plugin);
  if (!adapter || !pluginId) return null;

  if (typeof adapter.exists !== "function" || typeof adapter.write !== "function") return null;

  try {
    const data = plugin.store?.data;
    if (!data) return null;

    const states = data.states;
    const reviewLog = data.reviewLog;
    const analytics = data.analytics;
    if (!isPlainObject(states) && !Array.isArray(reviewLog)) return null;

    // Persist scheduling data (states + reviewLog) and analytics events
    const schedulingSnapshot: Record<string, unknown> = {
      _backupType: "scheduling-and-analytics",
      _createdAt: Date.now(),
      version: Number(data.version ?? 0) || 0,
      states: states ?? {},
      reviewLog: reviewLog ?? [],
      analytics: analytics ?? { version: 1, seq: 0, events: [] },
    };

    const text = JSON.stringify(schedulingSnapshot);
    if (!text || text === "{}") return null;

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const cleanLabel = String(label ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const suffix = cleanLabel ? `-${cleanLabel}` : "";
    const backupPath = joinPath(plugin.app.vault.configDir, "plugins", pluginId, `data.json.bak-${ts}${suffix}`);
    await adapter.write(backupPath, text);
    await pruneDataJsonBackups(plugin, BACKUP_MAX_COUNT);
    return backupPath;
  } catch {
    return null;
  }
}

/**
 * Restores scheduling data (states, reviewLog) and analytics data from a backup file.
 * Does NOT restore card content (cards, io) to preserve markdown changes.
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

    // Only restore scheduling data (states, reviewLog) — NOT card content (cards, io)
    // This prevents overwriting question wording/content changes made in markdown
    const snapshot = clonePlain(root);

    // Selectively restore scheduling-related data and analytics
    if (snapshot.states && typeof snapshot.states === "object") {
      plugin.store.data.states = snapshot.states as typeof plugin.store.data.states;
    }
    if (Array.isArray(snapshot.reviewLog)) {
      plugin.store.data.reviewLog = snapshot.reviewLog as typeof plugin.store.data.reviewLog;
    }
    // Restore analytics events (answer buttons, heatmap, streaks, etc.)
    if (isPlainObject(snapshot.analytics)) {
      const a = snapshot.analytics;
      const eventsArr = Array.isArray(a.events) ? a.events : [];
      plugin.store.data.analytics = {
        version: Number(a.version ?? 1) || 1,
        seq: Number(a.seq ?? 0) || 0,
        events: eventsArr as typeof plugin.store.data.analytics.events,
      };
    }
    // Note: cards, io, and quarantine are NOT restored to preserve markdown changes

    // Persist through the store
    await plugin.store.persist();

    return { ok: true, message: "Restore completed." };
  } catch (e: unknown) {
    const errMsg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "unknown error";
    return { ok: false, message: `Restore failed: ${errMsg}` };
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

  const folder = joinPath(plugin.app.vault.configDir, "plugins", pluginId);
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
