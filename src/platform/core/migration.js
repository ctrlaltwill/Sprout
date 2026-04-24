/**
 * @file src/platform/core/migration.ts
 * @summary Module for migration.
 *
 * @exports
 *  - migrateJsonToSqlite
 */
import { Notice } from "obsidian";
import { log } from "./logger";
import { t } from "../translations/translator";
import { SqliteStore, getFlashcardsDbPath, getSchedulingDirPath, isSqliteDatabasePresent } from "./sqlite-store";
function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
}
async function ensureFolder(adapter, path) {
    if (!adapter.exists || !adapter.mkdir)
        return;
    if (await adapter.exists(path))
        return;
    await adapter.mkdir(path);
}
function joinPath(...parts) {
    return parts
        .filter((p) => typeof p === "string" && p.length)
        .join("/")
        .replace(/\/+/g, "/");
}
function hasLegacyStoreData(root) {
    const store = root.store;
    if (!isPlainObject(store))
        return false;
    return Object.keys(store).length > 0;
}
export async function migrateJsonToSqlite(plugin, rootData) {
    var _a, _b, _c, _d;
    try {
        if (await isSqliteDatabasePresent(plugin))
            return true;
        const loaded = rootData !== null && rootData !== void 0 ? rootData : (await plugin.loadData());
        const root = isPlainObject(loaded) ? loaded : {};
        if (!hasLegacyStoreData(root))
            return true;
        const adapter = (_b = (_a = plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
        if (!adapter)
            return false;
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
        new Notice(t((_d = (_c = plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.interfaceLanguage, "ui.migration.sqliteUpgrade", "LearnKit upgraded scheduling storage to SQLite."));
        log.info(`Migrated scheduling store to SQLite at ${getSchedulingDirPath(plugin)}`);
        return true;
    }
    catch (e) {
        log.error("SQLite migration failed; staying on JSON store.", e);
        return false;
    }
}
