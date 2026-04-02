/**
 * @file src/platform/core/migration.ts
 * @summary Module for migration.
 *
 * @exports
 *  - migrateJsonToSqlite
 */

import { Notice } from "obsidian";
import type LearnKitPlugin from "../../main";
import { log } from "./logger";
import { SqliteStore, getFlashcardsDbPath, getSchedulingDirPath, isSqliteDatabasePresent } from "./sqlite-store";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function ensureFolder(adapter: {
  exists?: (path: string) => Promise<boolean>;
  mkdir?: (path: string) => Promise<void>;
}, path: string): Promise<void> {
  if (!adapter.exists || !adapter.mkdir) return;
  if (await adapter.exists(path)) return;
  await adapter.mkdir(path);
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => typeof p === "string" && p.length)
    .join("/")
    .replace(/\/+/g, "/");
}

function hasLegacyStoreData(root: Record<string, unknown>): boolean {
  const store = root.store;
  if (!isPlainObject(store)) return false;
  return Object.keys(store).length > 0;
}

export async function migrateJsonToSqlite(
  plugin: LearnKitPlugin,
  rootData?: unknown,
): Promise<boolean> {
  try {
    if (await isSqliteDatabasePresent(plugin)) return true;

    const loaded = rootData ?? ((await plugin.loadData()) as unknown);
    const root = isPlainObject(loaded) ? loaded : {};

    if (!hasLegacyStoreData(root)) return true;

    const adapter = plugin.app?.vault?.adapter as {
      exists?: (path: string) => Promise<boolean>;
      mkdir?: (path: string) => Promise<void>;
      write?: (path: string, data: string) => Promise<void>;
      remove?: (path: string) => Promise<void>;
    } | null;
    if (!adapter) return false;

    const backupDir = joinPath(plugin.app.vault.configDir, "plugins", plugin.manifest.id, "backups");
    await ensureFolder(adapter, backupDir);

    const legacyStore = root.store;

    const sqliteStore = new SqliteStore(plugin);
    await sqliteStore.open();
    sqliteStore.load({ store: legacyStore });
    await sqliteStore.persist();
    await sqliteStore.close();

    const dbPath = getFlashcardsDbPath(plugin);
    if (adapter.exists && !(await adapter.exists(dbPath))) {
      return false;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = joinPath(backupDir, `pre-sqlite-data-${ts}.json`);
    if (adapter.write) {
      await adapter.write(backupPath, JSON.stringify({ store: legacyStore }, null, 2));
    }

    delete root.store;
    await plugin.saveData(root);

    // eslint-disable-next-line obsidianmd/ui/sentence-case
    new Notice("LearnKit upgraded scheduling storage to SQLite.");
    log.info(`Migrated scheduling store to SQLite at ${getSchedulingDirPath(plugin)}`);
    return true;
  } catch (e) {
    log.error("SQLite migration failed; staying on JSON store.", e);
    return false;
  }
}
