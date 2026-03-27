import type SproutPlugin from "../../main";
import type { Database } from "sql.js";
import { defaultStore, JsonStore } from "./store";
import { getSqlJs } from "../integrations/anki/anki-sql";
import { log } from "./logger";

const SCHEDULING_DIR = "scheduling";
const FLASHCARDS_DB = "flashcards.db";

/** All known scheduling .db file names. */
const ALL_DB_FILES = ["flashcards.db", "notes.db", "coach.db", "tests.db"] as const;

/**
 * Copy every existing .db file from the scheduling directory to the vault
 * sync folder.  Call this when vault sync is first enabled or the folder
 * path changes so that databases which haven't been individually persisted
 * yet still appear in the sync folder.
 */
export async function copyAllDbsToVaultSyncFolder(
  plugin: SproutPlugin,
): Promise<void> {
  const vs = plugin.settings?.storage?.vaultSync;
  if (!vs?.enabled || !vs.folderPath) return;

  const adapter = plugin.app?.vault?.adapter as {
    exists?: (path: string) => Promise<boolean>;
    readBinary?: (path: string) => Promise<ArrayBuffer>;
    writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
    write?: (path: string, data: string) => Promise<void>;
    mkdir?: (path: string) => Promise<void>;
  } | null;
  if (!adapter) return;

  const schedDir = getSchedulingDirPath(plugin);

  for (const dbFile of ALL_DB_FILES) {
    try {
      const srcPath = joinPath(schedDir, dbFile);
      const exists = adapter.exists ? await adapter.exists(srcPath) : false;
      if (!exists) continue;
      const bytes = await readBinary(adapter, srcPath);
      if (bytes && bytes.byteLength > 0) {
        await copyDbToVaultSyncFolder(plugin, dbFile, bytes);
      }
    } catch {
      // Best-effort per file
    }
  }
}

/**
 * Best-effort copy of a .db file to the vault-visible sync folder
 * when the user has enabled vault sync storage.
 */
export async function copyDbToVaultSyncFolder(
  plugin: SproutPlugin,
  dbFileName: string,
  bytes: Uint8Array,
): Promise<void> {
  const vs = plugin.settings?.storage?.vaultSync;
  if (!vs?.enabled || !vs.folderPath) return;

  const adapter = plugin.app?.vault?.adapter as {
    exists?: (path: string) => Promise<boolean>;
    mkdir?: (path: string) => Promise<void>;
    writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
    write?: (path: string, data: string) => Promise<void>;
  } | null;
  if (!adapter) return;

  try {
    const folder = vs.folderPath.replace(/\/+$/, "");
    await ensureDir(adapter, folder);
    const dest = joinPath(folder, dbFileName);
    await writeBinary(adapter, dest, bytes);
  } catch {
    // Best-effort — don't break the primary save path
  }
}

/**
 * If vault sync is enabled, check whether the vault copy of a .db file is
 * newer than the plugin-folder copy. If so, copy it back so we load the
 * most recent data (e.g. synced from another device via Obsidian Sync).
 */
export async function reconcileFromVaultSync(
  plugin: SproutPlugin,
  dbFileName: string,
  pluginDbPath: string,
): Promise<void> {
  const vs = plugin.settings?.storage?.vaultSync;
  if (!vs?.enabled || !vs.folderPath) return;

  const adapter = plugin.app?.vault?.adapter as {
    exists?: (path: string) => Promise<boolean>;
    stat?: (path: string) => Promise<{ mtime: number } | null>;
    readBinary?: (path: string) => Promise<ArrayBuffer>;
    read?: (path: string) => Promise<string>;
    writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
    write?: (path: string, data: string) => Promise<void>;
    mkdir?: (path: string) => Promise<void>;
  } | null;
  if (!adapter?.stat || !adapter.exists) return;

  try {
    const vaultPath = joinPath(vs.folderPath.replace(/\/+$/, ""), dbFileName);
    const [vaultExists, pluginExists] = await Promise.all([
      adapter.exists(vaultPath),
      adapter.exists(pluginDbPath),
    ]);
    if (!vaultExists) return;

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
    if (!vaultStat || !pluginStat) return;

    // Only overwrite if the vault copy is strictly newer
    if (vaultStat.mtime > pluginStat.mtime) {
      const bytes = await readBinary(adapter, vaultPath);
      if (bytes && bytes.byteLength > 0) {
        await writeBinary(adapter, pluginDbPath, bytes);
      }
    }
  } catch {
    // Best-effort — fall back to the existing plugin-folder copy
  }
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => typeof p === "string" && p.length)
    .join("/")
    .replace(/\/+/g, "/");
}

function getPluginBaseDir(plugin: SproutPlugin): string {
  return joinPath(plugin.app.vault.configDir, "plugins", plugin.manifest.id);
}

export function getSchedulingDirPath(plugin: SproutPlugin): string {
  return joinPath(getPluginBaseDir(plugin), SCHEDULING_DIR);
}

export function getFlashcardsDbPath(plugin: SproutPlugin): string {
  return joinPath(getSchedulingDirPath(plugin), FLASHCARDS_DB);
}

export async function isSqliteDatabasePresent(plugin: SproutPlugin): Promise<boolean> {
  const adapter = plugin.app?.vault?.adapter;
  if (!adapter?.exists) return false;
  try {
    return await adapter.exists(getFlashcardsDbPath(plugin));
  } catch {
    return false;
  }
}

async function ensureDir(adapter: { exists?: (path: string) => Promise<boolean>; mkdir?: (path: string) => Promise<void> }, path: string): Promise<void> {
  if (!adapter.exists || !adapter.mkdir) return;
  if (await adapter.exists(path)) return;
  await adapter.mkdir(path);
}

async function readBinary(adapter: {
  readBinary?: (path: string) => Promise<ArrayBuffer>;
  read?: (path: string) => Promise<string>;
}, path: string): Promise<Uint8Array | null> {
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
  } catch {
    return null;
  }
  return null;
}

async function writeBinary(adapter: {
  writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
  write?: (path: string, data: string) => Promise<void>;
}, path: string, bytes: Uint8Array): Promise<void> {
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

function runSchema(db: Database): void {
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

function readSnapshot(db: Database): unknown {
  const stmt = db.prepare("SELECT payload FROM store_snapshot WHERE id = 1");
  try {
    if (!stmt.step()) return null;
    const row = stmt.getAsObject() as { payload?: unknown };
    if (typeof row.payload !== "string") return null;
    return JSON.parse(row.payload);
  } finally {
    stmt.free();
  }
}

function writeSnapshot(db: Database, payload: unknown): void {
  const json = JSON.stringify(payload ?? defaultStore());
  db.run(
    "INSERT INTO store_snapshot(id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
    [json, Date.now()],
  );
}

export class SqliteStore extends JsonStore {
  private _db: Database | null = null;
  private _opened = false;

  async open(): Promise<void> {
    if (this._opened) return;

    const adapter = this.plugin.app?.vault?.adapter as {
      exists?: (path: string) => Promise<boolean>;
      readBinary?: (path: string) => Promise<ArrayBuffer>;
      read?: (path: string) => Promise<string>;
      writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
      write?: (path: string, data: string) => Promise<void>;
      mkdir?: (path: string) => Promise<void>;
    } | null;

    if (!adapter) throw new Error("No vault adapter available");

    const SQL = await getSqlJs();
    const dir = getSchedulingDirPath(this.plugin);
    const path = getFlashcardsDbPath(this.plugin);

    await ensureDir(adapter, dir);
    await reconcileFromVaultSync(this.plugin, FLASHCARDS_DB, path);

    let db: Database;
    const exists = adapter.exists ? await adapter.exists(path) : false;
    if (exists) {
      const bytes = await readBinary(adapter, path);
      db = bytes && bytes.byteLength > 0 ? new SQL.Database(bytes) : new SQL.Database();
      this.loadedFromDisk = !!(bytes && bytes.byteLength > 0);
    } else {
      db = new SQL.Database();
      this.loadedFromDisk = false;
    }

    runSchema(db);

    const snapshot = readSnapshot(db);
    if (snapshot && typeof snapshot === "object") {
      super.load({ store: snapshot });
      this.loadedFromDisk = true;
    } else {
      this.data = defaultStore();
      writeSnapshot(db, this.data);
      this.loadedFromDisk = false;
    }

    this._db = db;
    this._opened = true;
  }

  override load(rootData: unknown): void {
    // Compatibility shim: allow explicit load during migration/bootstrap tests.
    if (rootData && typeof rootData === "object") {
      super.load(rootData);
    }
  }

  async reloadFromDisk(): Promise<void> {
    if (this._db) {
      try {
        this._db.close();
      } catch {
        // noop
      }
    }
    this._db = null;
    this._opened = false;
    await this.open();
  }

  async close(): Promise<void> {
    if (!this._opened) return;
    await this.persist();
    if (this._db) {
      this._db.close();
    }
    this._db = null;
    this._opened = false;
  }

  override async persist(): Promise<void> {
    if (!this._opened || !this._db) {
      await this.open();
    }
    if (!this._db) return;

    const adapter = this.plugin.app?.vault?.adapter as {
      writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
      write?: (path: string, data: string) => Promise<void>;
      mkdir?: (path: string) => Promise<void>;
      exists?: (path: string) => Promise<boolean>;
    } | null;
    if (!adapter) return;

    const dir = getSchedulingDirPath(this.plugin);
    const path = getFlashcardsDbPath(this.plugin);

    await ensureDir(adapter, dir);

    writeSnapshot(this._db, this.data);
    const bytes = this._db.export();
    await writeBinary(adapter, path, bytes);
    await copyDbToVaultSyncFolder(this.plugin, FLASHCARDS_DB, bytes);
  }

  async runIntegrityCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this._db) await this.open();
    if (!this._db) return { ok: false, message: "Database not available." };

    try {
      const stmt = this._db.prepare("PRAGMA integrity_check;");
      try {
        if (!stmt.step()) return { ok: false, message: "integrity_check returned no rows" };
        const row = stmt.getAsObject() as { integrity_check?: unknown };
        const raw = row.integrity_check;
        const result =
          typeof raw === "string"
            ? raw.toLowerCase()
            : raw == null
              ? ""
              : JSON.stringify(raw).toLowerCase();
        if (result === "ok") return { ok: true, message: "ok" };
        return { ok: false, message: result || "integrity check failed" };
      } finally {
        stmt.free();
      }
    } catch (e) {
      log.swallow("sqlite integrity_check", e);
      return { ok: false, message: "integrity check failed" };
    }
  }
}

export async function readStoreDataFromSqliteBuffer(buffer: Uint8Array): Promise<unknown> {
  const SQL = await getSqlJs();
  const db = new SQL.Database(buffer);
  try {
    runSchema(db);
    return readSnapshot(db);
  } finally {
    db.close();
  }
}
