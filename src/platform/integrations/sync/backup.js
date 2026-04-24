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
import { isParentCard } from "../../core/card-utils";
import { SqliteStore, getFlashcardsDbPath, isSqliteDatabasePresent, readStoreDataFromSqliteBuffer, } from "../../core/sqlite-store";
import { getSqlJs } from "../anki/anki-sql";
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
const BACKUP_SUBFOLDER = "backups";
const DAILY_SQLITE_BACKUP = "daily-backup.db";
const SQLITE_MANUAL_PREFIX = "manual-backup-";
const DEFAULT_BACKUP_POLICY = {
    recentCount: 8,
    dailyCount: 7,
    weeklyCount: 4,
    monthlyCount: 1,
    recentIntervalHours: 6,
    dailyIntervalDays: 1,
    weeklyIntervalDays: 7,
    monthlyIntervalDays: 30,
    maxTotalSizeMb: 250,
};
/** Cooldown to avoid re-checking backup necessity on every sync. */
const ROUTINE_CHECK_COOLDOWN_MS = 2 * 60 * 1000;
/** Tracks the last time we checked whether a routine backup was needed. */
let lastRoutineBackupCheck = 0;
function clampInt(n, fallback, min, max) {
    const value = Number(n);
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
}
function getBackupPolicy(plugin) {
    var _a;
    const raw = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage;
    const backups = raw === null || raw === void 0 ? void 0 : raw.backups;
    return {
        recentCount: clampInt(backups === null || backups === void 0 ? void 0 : backups.recentCount, DEFAULT_BACKUP_POLICY.recentCount, 0, 100),
        dailyCount: clampInt(backups === null || backups === void 0 ? void 0 : backups.dailyCount, DEFAULT_BACKUP_POLICY.dailyCount, 0, 100),
        weeklyCount: clampInt(backups === null || backups === void 0 ? void 0 : backups.weeklyCount, DEFAULT_BACKUP_POLICY.weeklyCount, 0, 100),
        monthlyCount: clampInt(backups === null || backups === void 0 ? void 0 : backups.monthlyCount, DEFAULT_BACKUP_POLICY.monthlyCount, 0, 100),
        recentIntervalHours: clampInt(backups === null || backups === void 0 ? void 0 : backups.recentIntervalHours, DEFAULT_BACKUP_POLICY.recentIntervalHours, 1, 168),
        dailyIntervalDays: clampInt(backups === null || backups === void 0 ? void 0 : backups.dailyIntervalDays, DEFAULT_BACKUP_POLICY.dailyIntervalDays, 1, 365),
        weeklyIntervalDays: clampInt(backups === null || backups === void 0 ? void 0 : backups.weeklyIntervalDays, DEFAULT_BACKUP_POLICY.weeklyIntervalDays, 1, 365),
        monthlyIntervalDays: clampInt(backups === null || backups === void 0 ? void 0 : backups.monthlyIntervalDays, DEFAULT_BACKUP_POLICY.monthlyIntervalDays, 1, 730),
        maxTotalSizeMb: clampInt(backups === null || backups === void 0 ? void 0 : backups.maxTotalSizeMb, DEFAULT_BACKUP_POLICY.maxTotalSizeMb, 25, 5000),
    };
}
function computeFNV1a32Hex(text) {
    let hash = 0x811c9dc5;
    const src = String(text !== null && text !== void 0 ? text : "");
    for (let i = 0; i < src.length; i++) {
        hash ^= src.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
async function computeSha256Hex(text) {
    var _a;
    try {
        const src = String(text !== null && text !== void 0 ? text : "");
        if (!((_a = globalThis.crypto) === null || _a === void 0 ? void 0 : _a.subtle))
            return null;
        const bytes = new TextEncoder().encode(src);
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        const out = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        return out;
    }
    catch (_b) {
        return null;
    }
}
function utf8ByteLength(text) {
    try {
        return new TextEncoder().encode(String(text !== null && text !== void 0 ? text : "")).length;
    }
    catch (_a) {
        return String(text !== null && text !== void 0 ? text : "").length;
    }
}
function backupManifestPathFor(backupPath) {
    return `${String(backupPath)}.manifest.json`;
}
function isBackupManifestFileName(name) {
    const s = String(name !== null && name !== void 0 ? name : "");
    return s.startsWith("data.json.bak-") && s.endsWith(".manifest.json");
}
function parseBackupManifest(raw) {
    var _a, _b, _c;
    if (!isPlainObject(raw))
        return null;
    const obj = raw;
    const schemaVersion = Number((_a = obj.schemaVersion) !== null && _a !== void 0 ? _a : 0);
    const createdAt = Number((_b = obj.createdAt) !== null && _b !== void 0 ? _b : 0);
    const backupFileName = typeof obj.backupFileName === "string" ? obj.backupFileName.trim() : "";
    const byteSize = Number((_c = obj.byteSize) !== null && _c !== void 0 ? _c : 0);
    const checksumAlgorithm = typeof obj.checksumAlgorithm === "string" ? obj.checksumAlgorithm.trim() : "";
    const checksum = typeof obj.checksum === "string" ? obj.checksum.trim().toLowerCase() : "";
    if (!Number.isFinite(schemaVersion) || schemaVersion < 1)
        return null;
    if (!Number.isFinite(createdAt) || createdAt <= 0)
        return null;
    if (!backupFileName)
        return null;
    if (!Number.isFinite(byteSize) || byteSize < 0)
        return null;
    if (checksumAlgorithm !== "fnv1a-32" && checksumAlgorithm !== "sha256")
        return null;
    if (checksumAlgorithm === "fnv1a-32" && !/^[0-9a-f]{8}$/.test(checksum))
        return null;
    if (checksumAlgorithm === "sha256" && !/^[0-9a-f]{64}$/.test(checksum))
        return null;
    return {
        schemaVersion,
        createdAt,
        backupFileName,
        byteSize,
        checksumAlgorithm,
        checksum,
        appVersion: typeof obj.appVersion === "string" ? obj.appVersion : undefined,
        dataVersion: Number.isFinite(Number(obj.dataVersion)) ? Number(obj.dataVersion) : undefined,
    };
}
function validateSproutStatesObject(states, requireNonEmpty) {
    if (!isPlainObject(states))
        return null;
    const entries = Object.entries(states);
    if (!entries.length)
        return requireNonEmpty ? null : states;
    const sampleSize = Math.min(20, entries.length);
    let sproutKeyCount = 0;
    let validCount = 0;
    for (let i = 0; i < sampleSize; i++) {
        const [key, value] = entries[i];
        if (!likelySproutStateKey(key))
            continue;
        sproutKeyCount += 1;
        if (isValidSproutState(value))
            validCount += 1;
    }
    if (sproutKeyCount === 0)
        return null;
    if (validCount < sproutKeyCount * 0.6)
        return null;
    return states;
}
function extractSchedulingSnapshot(obj) {
    var _a, _b;
    const root = getStoreLikeRoot(obj);
    if (!root)
        return null;
    const states = validateSproutStatesObject(root.states, false);
    if (!states)
        return null;
    const reviewLogRaw = root.reviewLog;
    if (reviewLogRaw != null && !Array.isArray(reviewLogRaw))
        return null;
    const reviewLog = Array.isArray(reviewLogRaw) ? reviewLogRaw : [];
    const analyticsRaw = root.analytics;
    if (analyticsRaw != null && !isPlainObject(analyticsRaw))
        return null;
    const analyticsObj = isPlainObject(analyticsRaw) ? analyticsRaw : {};
    const eventsRaw = analyticsObj.events;
    if (eventsRaw != null && !Array.isArray(eventsRaw))
        return null;
    return {
        states,
        reviewLog,
        analytics: {
            version: Number((_a = analyticsObj.version) !== null && _a !== void 0 ? _a : 1) || 1,
            seq: Number((_b = analyticsObj.seq) !== null && _b !== void 0 ? _b : 0) || 0,
            events: Array.isArray(eventsRaw) ? eventsRaw : [],
        },
    };
}
// ────────────────────────────────────────────
// Generic low-level utilities
// (exported so sync-engine.ts can re-use them)
// ────────────────────────────────────────────
/** Returns `true` if `v` is a non-null, non-array plain object. */
export function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
}
/** Safely counts the number of own keys on a plain object. */
export function countObjectKeys(v) {
    return isPlainObject(v) ? Object.keys(v).length : 0;
}
/** Joins path segments with `/`, collapsing duplicate slashes. */
export function joinPath(...parts) {
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
export function likelySproutStateKey(k) {
    // Match 9-digit parent keys: "123456789"
    if (/^\d{9}$/.test(k))
        return true;
    // Match cloze child keys: "123456789::cloze::c1"
    if (/^\d{9}::cloze::c\d+$/.test(k))
        return true;
    // Match other child patterns: "123456789::io::rect1", "123456789::rev::forward", etc.
    if (/^\d{9}::[a-z]+::.+$/.test(k))
        return true;
    return false;
}
/**
 * Validates whether a state object looks like a legitimate Sprout CardState.
 * Checks for presence of FSRS scheduling fields to avoid loading unrelated data.
 */
function isValidSproutState(state) {
    if (!state || typeof state !== "object")
        return false;
    const s = state;
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
export function extractStatesFromDataJsonObject(obj) {
    if (!obj)
        return null;
    const o = obj;
    const root = isPlainObject(o.data) ? o.data : o;
    return validateSproutStatesObject(root === null || root === void 0 ? void 0 : root.states, true);
}
// ────────────────────────────────────────────
// Vault adapter helpers
// ────────────────────────────────────────────
/**
 * Attempts to read and parse a JSON file from the vault adapter.
 * Returns `null` on any failure (missing file, bad JSON, etc.).
 */
export async function tryReadJson(adapter, path) {
    try {
        if (!adapter)
            return null;
        if (adapter.exists) {
            const exists = await adapter.exists(path);
            if (!exists)
                return null;
        }
        if (!adapter.read)
            return null;
        const text = await adapter.read(path);
        if (!text || !String(text).trim())
            return null;
        try {
            return JSON.parse(String(text));
        }
        catch (_a) {
            return null;
        }
    }
    catch (_b) {
        return null;
    }
}
/** Lists sub-folders inside `path` using the vault adapter. */
export async function safeListFolders(adapter, path) {
    try {
        if (!adapter)
            return [];
        if (adapter.list) {
            const res = await adapter.list(path);
            const folders = Array.isArray(res === null || res === void 0 ? void 0 : res.folders) ? res.folders : [];
            return folders.map((p) => String(p)).filter(Boolean);
        }
        const readdir = adapter.readdir;
        if (readdir) {
            const res = await readdir(path);
            const folders = Array.isArray(res === null || res === void 0 ? void 0 : res.folders) ? res.folders : [];
            return folders.map((p) => String(p)).filter(Boolean);
        }
    }
    catch (_a) {
        // ignore
    }
    return [];
}
/** Lists files inside `path` using the vault adapter. */
export async function safeListFiles(adapter, path) {
    try {
        if (!adapter)
            return [];
        if (adapter.list) {
            const res = await adapter.list(path);
            const files = Array.isArray(res === null || res === void 0 ? void 0 : res.files) ? res.files : [];
            return files.map((p) => String(p)).filter(Boolean);
        }
        const readdir = adapter.readdir;
        if (readdir) {
            const res = await readdir(path);
            const files = Array.isArray(res === null || res === void 0 ? void 0 : res.files) ? res.files : [];
            return files.map((p) => String(p)).filter(Boolean);
        }
    }
    catch (_a) {
        // ignore
    }
    return [];
}
/** Returns the mtime of a file (0 on failure). */
export async function safeStatMtime(adapter, path) {
    var _a;
    try {
        if (adapter === null || adapter === void 0 ? void 0 : adapter.stat) {
            const st = await adapter.stat(path);
            const m = Number((_a = st === null || st === void 0 ? void 0 : st.mtime) !== null && _a !== void 0 ? _a : 0);
            return Number.isFinite(m) ? m : 0;
        }
    }
    catch (_b) {
        // ignore
    }
    return 0;
}
/** Returns the size of a file in bytes (0 on failure). */
async function safeStatSize(adapter, path) {
    var _a;
    try {
        if (adapter === null || adapter === void 0 ? void 0 : adapter.stat) {
            const st = await adapter.stat(path);
            const s = Number((_a = st === null || st === void 0 ? void 0 : st.size) !== null && _a !== void 0 ? _a : 0);
            return Number.isFinite(s) ? s : 0;
        }
    }
    catch (_b) {
        // ignore
    }
    return 0;
}
async function readBinaryFile(adapter, path) {
    try {
        const binaryAdapter = adapter;
        if (binaryAdapter === null || binaryAdapter === void 0 ? void 0 : binaryAdapter.readBinary) {
            const buff = await binaryAdapter.readBinary(path);
            return new Uint8Array(buff);
        }
        if (adapter === null || adapter === void 0 ? void 0 : adapter.read) {
            const text = await adapter.read(path);
            const raw = atob(String(text !== null && text !== void 0 ? text : ""));
            const out = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++)
                out[i] = raw.charCodeAt(i);
            return out;
        }
    }
    catch (_a) {
        // ignore
    }
    return null;
}
async function writeBinaryFile(adapter, path, bytes) {
    try {
        const binaryAdapter = adapter;
        if (binaryAdapter === null || binaryAdapter === void 0 ? void 0 : binaryAdapter.writeBinary) {
            const output = bytes.slice().buffer;
            await binaryAdapter.writeBinary(path, output);
            return true;
        }
        if (adapter === null || adapter === void 0 ? void 0 : adapter.write) {
            let out = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
                out += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            await adapter.write(path, btoa(out));
            return true;
        }
    }
    catch (_a) {
        // ignore
    }
    return false;
}
function isSqliteBackupFileName(name) {
    const s = String(name !== null && name !== void 0 ? name : "");
    if (s === DAILY_SQLITE_BACKUP)
        return true;
    return /^manual-backup-\d{4}-\d{8}\.db$/i.test(s);
}
/** Deletes a file using the adapter's `remove()` or `trash()`. */
async function safeRemoveFile(adapter, path) {
    try {
        if (!adapter || !path)
            return false;
        if (adapter.remove) {
            await adapter.remove(path);
            return true;
        }
        const trash = adapter.trash;
        if (trash) {
            await trash(path);
            return true;
        }
    }
    catch (_a) {
        // ignore
    }
    return false;
}
async function ensureFolder(adapter, path) {
    try {
        if (!adapter || !path)
            return false;
        if (adapter.exists) {
            const exists = await adapter.exists(path);
            if (exists)
                return true;
        }
        if (!adapter.mkdir)
            return false;
        await adapter.mkdir(path);
        return true;
    }
    catch (_a) {
        try {
            return !!((adapter === null || adapter === void 0 ? void 0 : adapter.exists) && (await adapter.exists(path)));
        }
        catch (_b) {
            return false;
        }
    }
}
function getPluginFolder(plugin) {
    const pluginId = getPluginId(plugin);
    if (!pluginId)
        return null;
    return joinPath(plugin.app.vault.configDir, "plugins", pluginId);
}
function getPreferredBackupFolder(plugin) {
    const pluginFolder = getPluginFolder(plugin);
    if (!pluginFolder)
        return null;
    return joinPath(pluginFolder, BACKUP_SUBFOLDER);
}
// ────────────────────────────────────────────
// Backup file detection & pruning
// ────────────────────────────────────────────
/** Returns `true` if the filename matches the backup naming pattern. */
function isBackupFileName(name) {
    const s = String(name !== null && name !== void 0 ? name : "");
    if (!s.startsWith("data.json.bak-"))
        return false;
    if (isBackupManifestFileName(s))
        return false;
    return true;
}
function backupKindFromPath(path) {
    const name = String(path).split("/").pop() || String(path);
    const lower = name.toLowerCase();
    if (lower.includes("-auto"))
        return "auto";
    if (lower.includes("-manual") || lower.includes("-before-restore"))
        return "manual";
    return "other";
}
/**
 * Prunes old backup files, keeping at most `maxCount` (sorted by mtime desc).
 */
async function pruneDataJsonBackups(plugin) {
    var _a, _b;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    const folder = getPluginFolder(plugin);
    if (!adapter || !folder)
        return;
    const policy = getBackupPolicy(plugin);
    const backupFolder = getPreferredBackupFolder(plugin);
    const rootFiles = await safeListFiles(adapter, folder);
    const nestedFiles = backupFolder ? await safeListFiles(adapter, backupFolder) : [];
    const files = [...new Set([...rootFiles, ...nestedFiles])];
    const manifestFiles = files
        .filter((p) => isBackupManifestFileName(String(p).split("/").pop() || ""))
        .map((p) => String(p));
    const backups = files
        .filter((p) => isBackupFileName(String(p).split("/").pop() || ""))
        .map((p) => String(p));
    const entries = [];
    for (const p of backups) {
        const mtime = await safeStatMtime(adapter, p);
        const size = await safeStatSize(adapter, p);
        entries.push({ path: p, mtime, size, tier: "other", kind: backupKindFromPath(p) });
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    if (!entries.length)
        return;
    const now = Date.now();
    const recentMs = policy.recentIntervalHours * MS_HOUR;
    const dailyMs = policy.dailyIntervalDays * MS_DAY;
    const weeklyMs = policy.weeklyIntervalDays * MS_DAY;
    const monthlyMs = policy.monthlyIntervalDays * MS_DAY;
    const recentMaxAgeMs = policy.recentCount > 0 ? policy.recentCount * recentMs : 0;
    const dailyMaxAgeMs = recentMaxAgeMs + (policy.dailyCount > 0 ? policy.dailyCount * dailyMs : 0);
    const weeklyMaxAgeMs = dailyMaxAgeMs + (policy.weeklyCount > 0 ? policy.weeklyCount * weeklyMs : 0);
    const keepPaths = new Set();
    const newest = entries[0];
    keepPaths.add(newest.path);
    newest.tier = "latest";
    const selectTier = (tier, count, spacingMs, minAgeMs, maxAgeMs) => {
        if (count <= 0)
            return;
        let lastPicked = Number.POSITIVE_INFINITY;
        let kept = 0;
        for (const e of entries) {
            if (keepPaths.has(e.path))
                continue;
            const age = now - e.mtime;
            if (age < minAgeMs)
                continue;
            if (maxAgeMs != null && age > maxAgeMs)
                continue;
            // Respect spacing only for automatic backups; user/manual backups should
            // not be suppressed when clicked repeatedly.
            if (e.kind === "auto" && lastPicked !== Number.POSITIVE_INFINITY && Math.abs(lastPicked - e.mtime) < spacingMs)
                continue;
            keepPaths.add(e.path);
            e.tier = tier;
            if (e.kind === "auto")
                lastPicked = e.mtime;
            kept += 1;
            if (kept >= count)
                break;
        }
    };
    selectTier("recent", policy.recentCount, recentMs, 0, recentMaxAgeMs || null);
    selectTier("daily", policy.dailyCount, dailyMs, recentMaxAgeMs, dailyMaxAgeMs || null);
    selectTier("weekly", policy.weeklyCount, weeklyMs, dailyMaxAgeMs, weeklyMaxAgeMs || null);
    selectTier("monthly", policy.monthlyCount, monthlyMs, weeklyMaxAgeMs, null);
    const capBytes = policy.maxTotalSizeMb * 1024 * 1024;
    if (capBytes > 0) {
        const keptEntries = entries.filter((e) => keepPaths.has(e.path));
        let totalBytes = keptEntries.reduce((sum, e) => sum + Math.max(0, e.size), 0);
        if (totalBytes > capBytes) {
            const tierRank = {
                monthly: 4,
                weekly: 3,
                daily: 2,
                recent: 1,
                other: 1,
                latest: 0,
            };
            const candidates = keptEntries
                .filter((e) => e.tier !== "latest")
                .sort((a, b) => {
                const rankDiff = (tierRank[b.tier] || 0) - (tierRank[a.tier] || 0);
                if (rankDiff !== 0)
                    return rankDiff;
                return a.mtime - b.mtime;
            });
            for (const e of candidates) {
                if (totalBytes <= capBytes)
                    break;
                if (!keepPaths.has(e.path))
                    continue;
                keepPaths.delete(e.path);
                totalBytes -= Math.max(0, e.size);
            }
        }
    }
    // Never auto-prune explicit user/safety snapshots; these are deliberate checkpoints.
    const remove = entries.filter((e) => !keepPaths.has(e.path) && e.kind !== "manual");
    for (const entry of remove) {
        await safeRemoveFile(adapter, entry.path);
        await safeRemoveFile(adapter, backupManifestPathFor(entry.path));
    }
    if (manifestFiles.length) {
        const backupSet = new Set(backups);
        for (const mp of manifestFiles) {
            const owner = mp.replace(/\.manifest\.json$/, "");
            if (!backupSet.has(owner)) {
                await safeRemoveFile(adapter, mp);
            }
        }
    }
}
// ────────────────────────────────────────────
// Plugin ID helper
// ────────────────────────────────────────────
/** Reads the plugin manifest ID (e.g. "sprout"). */
export function getPluginId(plugin) {
    var _a, _b;
    const id = String((_b = (_a = plugin.manifest) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : "").trim();
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
function getStoreLikeRoot(obj) {
    if (!obj || typeof obj !== "object")
        return null;
    const o = obj;
    const candidates = [o === null || o === void 0 ? void 0 : o.data, o === null || o === void 0 ? void 0 : o.store, o === null || o === void 0 ? void 0 : o.db, obj];
    for (const c of candidates) {
        if (!isPlainObject(c))
            continue;
        const rec = c;
        const hasCards = isPlainObject(rec.cards);
        const hasStates = isPlainObject(rec.states);
        const hasReviewLog = Array.isArray(rec.reviewLog);
        const hasQuarantine = isPlainObject(rec.quarantine);
        if (hasCards || hasStates || hasReviewLog || hasQuarantine)
            return c;
    }
    return null;
}
/**
 * Computes scheduling summary stats from a `states` object.
 * Returns counts for states, due, learning, review, and mature cards.
 */
function computeSchedulingStats(states, now) {
    var _a, _b, _c;
    const out = { states: 0, due: 0, learning: 0, review: 0, mature: 0 };
    if (!isPlainObject(states))
        return out;
    const values = Object.values(states);
    out.states = values.length;
    for (const st of values) {
        if (!st || typeof st !== "object")
            continue;
        const entry = st;
        const stageRaw = entry.stage;
        const stage = typeof stageRaw === "string"
            ? stageRaw
            : typeof stageRaw === "number"
                ? String(stageRaw)
                : "";
        if (stage === "learning" || stage === "relearning")
            out.learning += 1;
        if (stage === "review")
            out.review += 1;
        const stability = Number((_a = entry.stabilityDays) !== null && _a !== void 0 ? _a : 0);
        if (stage === "review" && Number.isFinite(stability) && stability >= 30)
            out.mature += 1;
        const buriedUntil = Number((_b = entry.buriedUntil) !== null && _b !== void 0 ? _b : 0);
        if (Number.isFinite(buriedUntil) && buriedUntil > now)
            continue;
        const due = Number((_c = entry.due) !== null && _c !== void 0 ? _c : 0);
        const dueEligibleStage = stage === "learning" || stage === "relearning" || stage === "review";
        if (dueEligibleStage && Number.isFinite(due) && due > 0 && due <= now)
            out.due += 1;
    }
    return out;
}
function collectReviewableCardIds(cards, quarantine) {
    const out = new Set();
    if (!isPlainObject(cards))
        return out;
    const quarantined = isPlainObject(quarantine) ? quarantine : {};
    for (const [id, rawCard] of Object.entries(cards)) {
        if (!id)
            continue;
        if (Object.prototype.hasOwnProperty.call(quarantined, id))
            continue;
        if (!rawCard || typeof rawCard !== "object")
            continue;
        const card = rawCard;
        if (isParentCard(card))
            continue;
        out.add(id);
    }
    return out;
}
/**
 * Deep-clones a plain JSON-serialisable value.
 * Uses `structuredClone` when available, otherwise falls back to
 * JSON round-trip.
 */
function clonePlain(x) {
    if (typeof structuredClone === "function")
        return structuredClone(x);
    return JSON.parse(JSON.stringify(x));
}
// ────────────────────────────────────────────
// Backup CRUD functions
// ────────────────────────────────────────────
/**
 * Lists all data.json backup files in the plugin folder.
 * Sorted newest-first by mtime.
 */
export async function listDataJsonBackups(plugin) {
    var _a, _b;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    const folder = getPluginFolder(plugin);
    if (!adapter || !folder)
        return [];
    if (await isSqliteDatabasePresent(plugin)) {
        const backupFolder = getPreferredBackupFolder(plugin);
        if (!backupFolder)
            return [];
        const files = await safeListFiles(adapter, backupFolder);
        const out = [];
        for (const p of files) {
            const path = String(p);
            const name = path.split("/").pop() || path;
            if (!isSqliteBackupFileName(name))
                continue;
            out.push({
                path,
                name,
                mtime: await safeStatMtime(adapter, path),
                size: await safeStatSize(adapter, path),
            });
        }
        out.sort((a, b) => b.mtime - a.mtime || b.size - a.size || a.name.localeCompare(b.name));
        return out;
    }
    const backupFolder = getPreferredBackupFolder(plugin);
    const rootFiles = await safeListFiles(adapter, folder);
    const nestedFiles = backupFolder ? await safeListFiles(adapter, backupFolder) : [];
    // Include data.json and any data.json.* (bak-*, prev, old, etc.) from root and backups.
    const cand = [...new Set([...rootFiles, ...nestedFiles])].filter((p) => {
        const file = String(p);
        if (!/(^|\/)data\.json(\..+)?$/.test(file))
            return false;
        return !/\.manifest\.json$/i.test(file);
    });
    const out = [];
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
async function readBackupRawText(plugin, path) {
    var _a, _b;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    try {
        if (!adapter || !adapter.read)
            return null;
        const text = await adapter.read(path);
        const s = String(text !== null && text !== void 0 ? text : "");
        return s.trim() ? s : null;
    }
    catch (_c) {
        return null;
    }
}
export async function verifyDataJsonBackupIntegrity(plugin, backupPath) {
    var _a, _b;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    if (!adapter || !backupPath)
        return { ok: false, verified: false, reason: "Missing adapter or backup path." };
    if (await isSqliteDatabasePresent(plugin)) {
        const bytes = await readBinaryFile(adapter, backupPath);
        if (!bytes || bytes.byteLength === 0) {
            return { ok: false, verified: true, reason: "Backup DB is missing or unreadable." };
        }
        try {
            const SQL = await getSqlJs();
            const db = new SQL.Database(bytes);
            try {
                const stmt = db.prepare("PRAGMA integrity_check;");
                try {
                    if (!stmt.step())
                        return { ok: false, verified: true, reason: "integrity_check returned no rows." };
                    const row = stmt.getAsObject();
                    const raw = row.integrity_check;
                    const result = typeof raw === "string"
                        ? raw.toLowerCase()
                        : raw == null
                            ? ""
                            : JSON.stringify(raw).toLowerCase();
                    if (result === "ok")
                        return { ok: true, verified: true };
                    return { ok: false, verified: true, reason: result || "integrity_check failed." };
                }
                finally {
                    stmt.free();
                }
            }
            finally {
                db.close();
            }
        }
        catch (_c) {
            return { ok: false, verified: true, reason: "Failed to open SQLite backup." };
        }
    }
    const text = await readBackupRawText(plugin, backupPath);
    if (!text)
        return { ok: false, verified: false, reason: "Backup file is missing or unreadable." };
    const manifestPath = backupManifestPathFor(backupPath);
    const manifestRaw = await tryReadJson(adapter, manifestPath);
    if (!manifestRaw) {
        return { ok: true, verified: false };
    }
    const manifest = parseBackupManifest(manifestRaw);
    if (!manifest) {
        return { ok: false, verified: true, reason: "Manifest exists but is invalid." };
    }
    const fileName = String(backupPath).split("/").pop() || String(backupPath);
    if (manifest.backupFileName !== fileName) {
        return { ok: false, verified: true, reason: "Manifest file name does not match backup file." };
    }
    const bytes = utf8ByteLength(text);
    if (bytes !== manifest.byteSize) {
        return { ok: false, verified: true, reason: "Backup size does not match manifest." };
    }
    const checksum = manifest.checksumAlgorithm === "sha256"
        ? await computeSha256Hex(text)
        : computeFNV1a32Hex(text);
    if (!checksum) {
        return { ok: false, verified: true, reason: "Unable to compute backup checksum." };
    }
    if (checksum !== manifest.checksum) {
        return { ok: false, verified: true, reason: "Backup checksum mismatch." };
    }
    return { ok: true, verified: true };
}
export async function readValidatedBackupStates(plugin, backupPath) {
    var _a, _b, _c;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    if (!adapter || !backupPath)
        return null;
    const integrity = await verifyDataJsonBackupIntegrity(plugin, backupPath);
    if (!integrity.ok)
        return null;
    const obj = await tryReadJson(adapter, backupPath);
    const snapshot = extractSchedulingSnapshot(obj);
    const states = (_c = snapshot === null || snapshot === void 0 ? void 0 : snapshot.states) !== null && _c !== void 0 ? _c : null;
    if (!states || Object.keys(states).length === 0)
        return null;
    return { states, verified: integrity.verified };
}
export async function deleteDataJsonBackup(plugin, backupPath) {
    var _a, _b;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    if (!adapter || !backupPath)
        return false;
    const removedPrimary = await safeRemoveFile(adapter, backupPath);
    await safeRemoveFile(adapter, backupManifestPathFor(backupPath));
    return removedPrimary;
}
/**
 * Reads and parses a backup file to extract scheduling/card statistics.
 * Returns `null` if the file can't be read or doesn't contain valid data.
 */
export async function getDataJsonBackupStats(plugin, path) {
    var _a, _b, _c;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    if (!adapter || !path)
        return null;
    let obj;
    if (await isSqliteDatabasePresent(plugin)) {
        const bytes = await readBinaryFile(adapter, path);
        if (!bytes)
            return null;
        obj = await readStoreDataFromSqliteBuffer(bytes);
    }
    else {
        obj = await tryReadJson(adapter, path);
    }
    const root = getStoreLikeRoot(obj);
    if (!root)
        return null;
    const cards = root.cards;
    const states = root.states;
    const reviewLog = root.reviewLog;
    const quarantine = root.quarantine;
    const io = root.io;
    const cardCount = countObjectKeys(cards);
    const stateKeys = isPlainObject(states) ? Object.keys(states) : [];
    const reviewableIds = collectReviewableCardIds(cards, quarantine);
    const liveStateKeys = stateKeys.filter((id) => reviewableIds.has(id));
    const stateCount = liveStateKeys.length;
    const sproutishStateKeys = stateKeys.reduce((acc, k) => acc + (likelySproutStateKey(k) ? 1 : 0), 0);
    const liveStates = {};
    if (isPlainObject(states)) {
        for (const key of liveStateKeys) {
            const entry = states[key];
            if (entry && typeof entry === "object")
                liveStates[key] = entry;
        }
    }
    const sched = computeSchedulingStats(liveStates, Date.now());
    const reviewCount = Array.isArray(reviewLog) ? reviewLog.length : 0;
    const quarantineCount = countObjectKeys(quarantine);
    const ioCount = countObjectKeys(io);
    // Analytics stats
    const analyticsRaw = root.analytics;
    const analyticsEvents = isPlainObject(analyticsRaw) && Array.isArray((analyticsRaw).events)
        ? (analyticsRaw).events
        : [];
    const analyticsEventCount = analyticsEvents.length;
    const analyticsReviewCount = analyticsEvents.filter((e) => isPlainObject(e) && (e).kind === "review").length;
    const analyticsSessionCount = analyticsEvents.filter((e) => isPlainObject(e) && (e).kind === "session").length;
    const entry = {
        path,
        name: String(path).split("/").pop() || String(path),
        mtime: await safeStatMtime(adapter, path),
        size: await safeStatSize(adapter, path),
    };
    return {
        ...entry,
        version: Number((_c = root.version) !== null && _c !== void 0 ? _c : 0) || 0,
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
export async function createDataJsonBackupNow(plugin, label) {
    var _a, _b, _c, _d, _e, _f;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    const pluginFolder = getPluginFolder(plugin);
    if (!adapter || !pluginFolder)
        return null;
    if (await isSqliteDatabasePresent(plugin)) {
        const backupFolder = getPreferredBackupFolder(plugin);
        if (!backupFolder)
            return null;
        await ensureFolder(adapter, backupFolder);
        const srcPath = getFlashcardsDbPath(plugin);
        const bytes = await readBinaryFile(adapter, srcPath);
        if (!bytes || bytes.byteLength === 0)
            return null;
        const kind = String(label !== null && label !== void 0 ? label : "").toLowerCase().includes("manual") ? "manual" : "daily";
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const mon = String(now.getMonth() + 1).padStart(2, "0");
        const yyyy = String(now.getFullYear());
        const dstName = kind === "manual"
            ? `${SQLITE_MANUAL_PREFIX}${hh}${mm}-${dd}${mon}${yyyy}.db`
            : DAILY_SQLITE_BACKUP;
        const dstPath = joinPath(backupFolder, dstName);
        const ok = await writeBinaryFile(adapter, dstPath, bytes);
        return ok ? dstPath : null;
    }
    if (typeof adapter.write !== "function")
        return null;
    try {
        const data = (_c = plugin.store) === null || _c === void 0 ? void 0 : _c.data;
        if (!data)
            return null;
        const states = data.states;
        const reviewLog = data.reviewLog;
        const analytics = data.analytics;
        if (!isPlainObject(states) || !Array.isArray(reviewLog))
            return null;
        // Persist scheduling data (states + reviewLog) and analytics events
        const schedulingSnapshot = {
            _backupType: "scheduling-and-analytics",
            _createdAt: Date.now(),
            version: Number((_d = data.version) !== null && _d !== void 0 ? _d : 0) || 0,
            states: states !== null && states !== void 0 ? states : {},
            reviewLog: reviewLog !== null && reviewLog !== void 0 ? reviewLog : [],
            analytics: analytics !== null && analytics !== void 0 ? analytics : { version: 1, seq: 0, events: [] },
        };
        const text = JSON.stringify(schedulingSnapshot);
        if (!text || text === "{}")
            return null;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const cleanLabel = String(label !== null && label !== void 0 ? label : "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        const suffix = cleanLabel ? `-${cleanLabel}` : "";
        // Add a nonce so creation does not depend on adapter.exists() correctness.
        const nonce = Math.random().toString(36).slice(2, 8);
        const baseName = `data.json.bak-${ts}${suffix}-${nonce}`;
        const preferredBackupFolder = getPreferredBackupFolder(plugin);
        let backupPath = null;
        if (preferredBackupFolder && (await ensureFolder(adapter, preferredBackupFolder))) {
            const candidate = joinPath(preferredBackupFolder, baseName);
            try {
                await adapter.write(candidate, text);
                backupPath = candidate;
            }
            catch (_g) {
                // Fall through to root folder write attempt.
            }
        }
        if (!backupPath) {
            const candidate = joinPath(pluginFolder, baseName);
            await adapter.write(candidate, text);
            backupPath = candidate;
        }
        // Best-effort sidecar manifest for integrity verification (non-breaking for legacy backups).
        try {
            const sha256 = await computeSha256Hex(text);
            const checksumAlgorithm = sha256 ? "sha256" : "fnv1a-32";
            const manifest = {
                schemaVersion: 1,
                createdAt: Date.now(),
                backupFileName: String(backupPath).split("/").pop() || backupPath,
                byteSize: utf8ByteLength(text),
                checksumAlgorithm,
                checksum: sha256 || computeFNV1a32Hex(text),
                appVersion: String((_f = (_e = plugin.manifest) === null || _e === void 0 ? void 0 : _e.version) !== null && _f !== void 0 ? _f : "") || undefined,
                dataVersion: Number.isFinite(Number(data.version)) ? Number(data.version) : undefined,
            };
            await adapter.write(backupManifestPathFor(backupPath), JSON.stringify(manifest));
        }
        catch (_h) {
            // Ignore manifest write failure to preserve backup behavior.
        }
        await pruneDataJsonBackups(plugin);
        return backupPath;
    }
    catch (_j) {
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
export async function restoreFromDataJsonBackup(plugin, backupPath, opts = {}) {
    var _a, _b, _c, _d;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    if (!adapter)
        return { ok: false, message: "No vault adapter available." };
    if (!backupPath)
        return { ok: false, message: "No backup path provided." };
    if (await isSqliteDatabasePresent(plugin)) {
        try {
            if (opts.makeSafetyBackup) {
                await createDataJsonBackupNow(plugin, "manual-before-restore");
            }
            const integrity = await verifyDataJsonBackupIntegrity(plugin, backupPath);
            if (!integrity.ok) {
                return { ok: false, message: integrity.reason || "Backup integrity check failed." };
            }
            const bytes = await readBinaryFile(adapter, backupPath);
            if (!bytes || bytes.byteLength === 0) {
                return { ok: false, message: "Backup DB is unreadable." };
            }
            const dbPath = getFlashcardsDbPath(plugin);
            const written = await writeBinaryFile(adapter, dbPath, bytes);
            if (!written) {
                return { ok: false, message: "Failed to write flashcards.db." };
            }
            if (plugin.store instanceof SqliteStore) {
                await plugin.store.reloadFromDisk();
                const check = await plugin.store.runIntegrityCheck();
                if (!check.ok) {
                    return { ok: false, message: `Restore completed but integrity check failed: ${check.message}` };
                }
            }
            return { ok: true, message: "Restore completed." };
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
            return { ok: false, message: `Restore failed: ${errMsg}` };
        }
    }
    try {
        if (opts.makeSafetyBackup) {
            await createDataJsonBackupNow(plugin, "before-restore");
        }
        const integrity = await verifyDataJsonBackupIntegrity(plugin, backupPath);
        if (!integrity.ok) {
            return { ok: false, message: integrity.reason || "Backup integrity check failed." };
        }
        const obj = await tryReadJson(adapter, backupPath);
        const snapshot = extractSchedulingSnapshot(obj);
        if (!snapshot) {
            return { ok: false, message: "Backup JSON did not contain a valid scheduling snapshot." };
        }
        // Only restore scheduling data (states, reviewLog) — NOT card content (cards, io)
        // This prevents overwriting question wording/content changes made in markdown
        const clone = clonePlain(snapshot);
        // Selectively restore scheduling-related data and analytics
        plugin.store.data.states = clone.states;
        plugin.store.data.reviewLog = clone.reviewLog;
        plugin.store.data.analytics = {
            version: Number((_c = clone.analytics.version) !== null && _c !== void 0 ? _c : 1) || 1,
            seq: Number((_d = clone.analytics.seq) !== null && _d !== void 0 ? _d : 0) || 0,
            events: Array.isArray(clone.analytics.events)
                ? clone.analytics.events
                : [],
        };
        // Note: cards, io, and quarantine are NOT restored to preserve markdown changes
        // Persist through the store
        await plugin.store.persist();
        return { ok: true, message: "Restore completed." };
    }
    catch (e) {
        const errMsg = e instanceof Error
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
export async function ensureRoutineBackupIfNeeded(plugin) {
    var _a, _b, _c, _d;
    const now = Date.now();
    if (now - lastRoutineBackupCheck < ROUTINE_CHECK_COOLDOWN_MS)
        return;
    lastRoutineBackupCheck = now;
    if (await isSqliteDatabasePresent(plugin)) {
        const rollingEnabled = (_d = (_c = (_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage) === null || _b === void 0 ? void 0 : _b.backups) === null || _c === void 0 ? void 0 : _c.rollingDailyEnabled) !== null && _d !== void 0 ? _d : true;
        if (!rollingEnabled)
            return;
        const entries = await listDataJsonBackups(plugin);
        const daily = entries.find((e) => e.name === DAILY_SQLITE_BACKUP);
        if (!daily || now - Number(daily.mtime || 0) >= MS_DAY) {
            await createDataJsonBackupNow(plugin, "daily");
        }
        return;
    }
    const policy = getBackupPolicy(plugin);
    const routineIntervalMs = Math.max(1, policy.recentIntervalHours) * MS_HOUR;
    const entries = await listDataJsonBackups(plugin);
    const backupEntries = entries.filter((e) => isBackupFileName(e.name));
    if (!backupEntries.length) {
        const created = await createDataJsonBackupNow(plugin, "auto");
        if (created)
            await pruneDataJsonBackups(plugin);
        return;
    }
    const newest = backupEntries.reduce((max, e) => Math.max(max, Number(e.mtime || 0)), 0);
    if (newest && now - newest < routineIntervalMs)
        return;
    const created = await createDataJsonBackupNow(plugin, "auto");
    if (created)
        await pruneDataJsonBackups(plugin);
}
