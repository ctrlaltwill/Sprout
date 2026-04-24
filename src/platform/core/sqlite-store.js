/**
 * @file src/platform/core/sqlite-store.ts
 * @summary Module for sqlite store.
 *
 * @exports
 *  - reconcileAllDbsFromVaultSync
 *  - copyAllDbsToVaultSyncFolder
 *  - copyDbToVaultSyncFolder
 *  - reconcileFromVaultSync
 *  - getSchedulingDirPath
 *  - getFlashcardsDbPath
 */
import { defaultStore, JsonStore } from "./store";
import { getSqlJs } from "../integrations/anki/anki-sql";
import { log } from "./logger";
const SCHEDULING_DIR = "scheduling";
const FLASHCARDS_DB = "flashcards.db";
/** All known scheduling .db file names. */
const ALL_DB_FILES = ["flashcards.db", "notes.db", "coach.db", "tests.db"];
/**
 * Reconcile ALL known .db files from the vault sync folder back to the
 * plugin scheduling directory.  Call this once at plugin startup so that
 * databases opened lazily (notes.db, tests.db) still pick up copies that
 * Obsidian Sync delivered while the plugin was not running.
 */
export async function reconcileAllDbsFromVaultSync(plugin) {
    var _a, _b;
    const vs = (_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage) === null || _b === void 0 ? void 0 : _b.vaultSync;
    if (!(vs === null || vs === void 0 ? void 0 : vs.enabled) || !vs.folderPath)
        return;
    const schedDir = getSchedulingDirPath(plugin);
    for (const dbFile of ALL_DB_FILES) {
        try {
            const pluginPath = joinPath(schedDir, dbFile);
            await reconcileFromVaultSync(plugin, dbFile, pluginPath);
        }
        catch (_c) {
            // Best-effort per file
        }
    }
}
/**
 * Copy every existing .db file from the scheduling directory to the vault
 * sync folder.  Call this when vault sync is first enabled or the folder
 * path changes so that databases which haven't been individually persisted
 * yet still appear in the sync folder.
 */
export async function copyAllDbsToVaultSyncFolder(plugin) {
    var _a, _b, _c, _d;
    const vs = (_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage) === null || _b === void 0 ? void 0 : _b.vaultSync;
    if (!(vs === null || vs === void 0 ? void 0 : vs.enabled) || !vs.folderPath)
        return;
    const adapter = (_d = (_c = plugin.app) === null || _c === void 0 ? void 0 : _c.vault) === null || _d === void 0 ? void 0 : _d.adapter;
    if (!adapter)
        return;
    const schedDir = getSchedulingDirPath(plugin);
    for (const dbFile of ALL_DB_FILES) {
        try {
            const srcPath = joinPath(schedDir, dbFile);
            const exists = adapter.exists ? await adapter.exists(srcPath) : false;
            if (!exists)
                continue;
            const bytes = await readBinary(adapter, srcPath);
            if (bytes && bytes.byteLength > 0) {
                await copyDbToVaultSyncFolder(plugin, dbFile, bytes);
            }
        }
        catch (_e) {
            // Best-effort per file
        }
    }
}
/**
 * Best-effort copy of a .db file to the vault-visible sync folder
 * when the user has enabled vault sync storage.
 */
export async function copyDbToVaultSyncFolder(plugin, dbFileName, bytes) {
    var _a, _b, _c, _d;
    const vs = (_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage) === null || _b === void 0 ? void 0 : _b.vaultSync;
    if (!(vs === null || vs === void 0 ? void 0 : vs.enabled) || !vs.folderPath)
        return;
    const adapter = (_d = (_c = plugin.app) === null || _c === void 0 ? void 0 : _c.vault) === null || _d === void 0 ? void 0 : _d.adapter;
    if (!adapter)
        return;
    try {
        const folder = vs.folderPath.replace(/\/+$/, "");
        await ensureDir(adapter, folder);
        const dest = joinPath(folder, dbFileName);
        await writeBinary(adapter, dest, bytes);
    }
    catch (_e) {
        // Best-effort — don't break the primary save path
    }
}
/**
 * If vault sync is enabled, check whether the vault copy of a .db file is
 * newer than the plugin-folder copy. If so, copy it back so we load the
 * most recent data (e.g. synced from another device via Obsidian Sync).
 */
export async function reconcileFromVaultSync(plugin, dbFileName, pluginDbPath) {
    var _a, _b, _c, _d;
    const vs = (_b = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.storage) === null || _b === void 0 ? void 0 : _b.vaultSync;
    if (!(vs === null || vs === void 0 ? void 0 : vs.enabled) || !vs.folderPath)
        return;
    const adapter = (_d = (_c = plugin.app) === null || _c === void 0 ? void 0 : _c.vault) === null || _d === void 0 ? void 0 : _d.adapter;
    if (!(adapter === null || adapter === void 0 ? void 0 : adapter.stat) || !adapter.exists)
        return;
    try {
        const vaultPath = joinPath(vs.folderPath.replace(/\/+$/, ""), dbFileName);
        const [vaultExists, pluginExists] = await Promise.all([
            adapter.exists(vaultPath),
            adapter.exists(pluginDbPath),
        ]);
        if (!vaultExists)
            return;
        // If plugin copy doesn't exist, always use the vault copy
        if (!pluginExists) {
            const bytes = await readBinary(adapter, vaultPath);
            if (bytes && bytes.byteLength > 0) {
                const dir = pluginDbPath.split("/").slice(0, -1).join("/");
                await ensureDir(adapter, dir);
                await writeBinary(adapter, pluginDbPath, bytes);
            }
            return;
        }
        const [vaultStat, pluginStat] = await Promise.all([
            adapter.stat(vaultPath),
            adapter.stat(pluginDbPath),
        ]);
        if (!vaultStat || !pluginStat)
            return;
        // Overwrite if the vault copy is newer or same age (vault takes precedence)
        if (vaultStat.mtime >= pluginStat.mtime) {
            const bytes = await readBinary(adapter, vaultPath);
            if (bytes && bytes.byteLength > 0) {
                await writeBinary(adapter, pluginDbPath, bytes);
            }
        }
    }
    catch (_e) {
        // Best-effort — fall back to the existing plugin-folder copy
    }
}
function joinPath(...parts) {
    return parts
        .filter((p) => typeof p === "string" && p.length)
        .join("/")
        .replace(/\/+/g, "/");
}
function getPluginBaseDir(plugin) {
    return joinPath(plugin.app.vault.configDir, "plugins", plugin.manifest.id);
}
export function getSchedulingDirPath(plugin) {
    return joinPath(getPluginBaseDir(plugin), SCHEDULING_DIR);
}
export function getFlashcardsDbPath(plugin) {
    return joinPath(getSchedulingDirPath(plugin), FLASHCARDS_DB);
}
export async function isSqliteDatabasePresent(plugin) {
    var _a, _b;
    const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
    if (!(adapter === null || adapter === void 0 ? void 0 : adapter.exists))
        return false;
    try {
        return await adapter.exists(getFlashcardsDbPath(plugin));
    }
    catch (_c) {
        return false;
    }
}
async function ensureDir(adapter, path) {
    if (!adapter.exists || !adapter.mkdir)
        return;
    if (await adapter.exists(path))
        return;
    await adapter.mkdir(path);
}
async function readBinary(adapter, path) {
    try {
        if (adapter.readBinary) {
            const buff = await adapter.readBinary(path);
            return new Uint8Array(buff);
        }
        if (adapter.read) {
            const text = await adapter.read(path);
            const arr = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
            return arr;
        }
    }
    catch (_a) {
        return null;
    }
    return null;
}
async function writeBinary(adapter, path, bytes) {
    if (adapter.writeBinary) {
        const output = bytes.slice().buffer;
        await adapter.writeBinary(path, output);
        return;
    }
    if (adapter.write) {
        let out = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            out += String.fromCharCode(...chunk);
        }
        await adapter.write(path, btoa(out));
        return;
    }
    throw new Error("No binary write support in adapter");
}
function runSchema(db) {
    db.run("PRAGMA journal_mode = DELETE;");
    db.run("PRAGMA foreign_keys = ON;");
    db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS store_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
function readSnapshot(db) {
    const stmt = db.prepare("SELECT payload FROM store_snapshot WHERE id = 1");
    try {
        if (!stmt.step())
            return null;
        const row = stmt.getAsObject();
        if (typeof row.payload !== "string")
            return null;
        return JSON.parse(row.payload);
    }
    finally {
        stmt.free();
    }
}
function writeSnapshot(db, payload) {
    const json = JSON.stringify(payload !== null && payload !== void 0 ? payload : defaultStore());
    db.run("INSERT INTO store_snapshot(id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", [json, Date.now()]);
}
export class SqliteStore extends JsonStore {
    constructor() {
        super(...arguments);
        this._db = null;
        this._opened = false;
    }
    async open() {
        var _a, _b;
        if (this._opened)
            return;
        const adapter = (_b = (_a = this.plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
        if (!adapter)
            throw new Error("No vault adapter available");
        const SQL = await getSqlJs();
        const dir = getSchedulingDirPath(this.plugin);
        const path = getFlashcardsDbPath(this.plugin);
        await ensureDir(adapter, dir);
        await reconcileFromVaultSync(this.plugin, FLASHCARDS_DB, path);
        let db;
        const exists = adapter.exists ? await adapter.exists(path) : false;
        if (exists) {
            const bytes = await readBinary(adapter, path);
            db = bytes && bytes.byteLength > 0 ? new SQL.Database(bytes) : new SQL.Database();
            this.loadedFromDisk = !!(bytes && bytes.byteLength > 0);
        }
        else {
            db = new SQL.Database();
            this.loadedFromDisk = false;
        }
        runSchema(db);
        const snapshot = readSnapshot(db);
        if (snapshot && typeof snapshot === "object") {
            super.load({ store: snapshot });
            this.loadedFromDisk = true;
        }
        else {
            this.data = defaultStore();
            writeSnapshot(db, this.data);
            this.loadedFromDisk = false;
        }
        this._db = db;
        this._opened = true;
    }
    load(rootData) {
        // Compatibility shim: allow explicit load during migration/bootstrap tests.
        if (rootData && typeof rootData === "object") {
            super.load(rootData);
        }
    }
    async reloadFromDisk() {
        if (this._db) {
            try {
                this._db.close();
            }
            catch (_a) {
                // noop
            }
        }
        this._db = null;
        this._opened = false;
        await this.open();
    }
    async close() {
        if (!this._opened)
            return;
        await this.persist();
        if (this._db) {
            this._db.close();
        }
        this._db = null;
        this._opened = false;
    }
    async persist() {
        var _a, _b;
        if (!this._opened || !this._db) {
            await this.open();
        }
        if (!this._db)
            return;
        const adapter = (_b = (_a = this.plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
        if (!adapter)
            return;
        const dir = getSchedulingDirPath(this.plugin);
        const path = getFlashcardsDbPath(this.plugin);
        await ensureDir(adapter, dir);
        writeSnapshot(this._db, this.data);
        const bytes = this._db.export();
        await writeBinary(adapter, path, bytes);
        await copyDbToVaultSyncFolder(this.plugin, FLASHCARDS_DB, bytes);
    }
    async runIntegrityCheck() {
        if (!this._db)
            await this.open();
        if (!this._db)
            return { ok: false, message: "Database not available." };
        try {
            const stmt = this._db.prepare("PRAGMA integrity_check;");
            try {
                if (!stmt.step())
                    return { ok: false, message: "integrity_check returned no rows" };
                const row = stmt.getAsObject();
                const raw = row.integrity_check;
                const result = typeof raw === "string"
                    ? raw.toLowerCase()
                    : raw == null
                        ? ""
                        : JSON.stringify(raw).toLowerCase();
                if (result === "ok")
                    return { ok: true, message: "ok" };
                return { ok: false, message: result || "integrity check failed" };
            }
            finally {
                stmt.free();
            }
        }
        catch (e) {
            log.swallow("sqlite integrity_check", e);
            return { ok: false, message: "integrity check failed" };
        }
    }
}
export async function readStoreDataFromSqliteBuffer(buffer) {
    const SQL = await getSqlJs();
    const db = new SQL.Database(buffer);
    try {
        runSchema(db);
        return readSnapshot(db);
    }
    finally {
        db.close();
    }
}
