/**
 * @file src/platform/core/note-review-sqlite.ts
 * @summary Module for note review sqlite.
 *
 * @exports
 *  - NoteReviewRow
 *  - getNotesDbPath
 *  - NoteReviewSqlite
 */
import { getSqlJs } from "../integrations/anki/anki-sql";
import { getSchedulingDirPath, copyDbToVaultSyncFolder, reconcileFromVaultSync } from "./sqlite-store";
const NOTES_DB = "notes.db";
function asText(value, fallback = "") {
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
        return String(value);
    return fallback;
}
function joinPath(...parts) {
    return parts
        .filter((p) => typeof p === "string" && p.length)
        .join("/")
        .replace(/\/+/g, "/");
}
export function getNotesDbPath(plugin) {
    return joinPath(getSchedulingDirPath(plugin), NOTES_DB);
}
async function ensureDir(adapter, path) {
    if (!adapter.exists || !adapter.mkdir)
        return;
    if (await adapter.exists(path))
        return;
    await adapter.mkdir(path);
}
async function readBinary(adapter, path) {
    if (!adapter.readBinary)
        return null;
    try {
        const buff = await adapter.readBinary(path);
        return new Uint8Array(buff);
    }
    catch (_a) {
        return null;
    }
}
async function writeBinary(adapter, path, bytes) {
    if (!adapter.writeBinary)
        throw new Error("No binary write support in adapter");
    const output = bytes.slice().buffer;
    await adapter.writeBinary(path, output);
}
function runSchema(db) {
    const safeRun = (sql) => {
        try {
            db.run(sql);
        }
        catch (_a) {
            // sql.js throws on duplicate-column ALTERs; ignore for idempotent migrations.
        }
    };
    db.run("PRAGMA journal_mode = DELETE;");
    db.run("PRAGMA foreign_keys = ON;");
    db.run(`
    CREATE TABLE IF NOT EXISTS note_state (
      note_id TEXT PRIMARY KEY,
      step_index INTEGER NOT NULL DEFAULT 0,
      last_review_time INTEGER,
      next_review_time INTEGER NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      buried_until INTEGER,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      learning_step_index INTEGER NOT NULL DEFAULT 0,
      scheduled_days INTEGER NOT NULL DEFAULT 0,
      stability_days REAL,
      difficulty REAL,
      fsrs_state INTEGER NOT NULL DEFAULT 0,
      suspended_due INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
    // Backward-compatible migrations for existing notes.db files.
    safeRun("ALTER TABLE note_state ADD COLUMN reps INTEGER NOT NULL DEFAULT 0;");
    safeRun("ALTER TABLE note_state ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;");
    safeRun("ALTER TABLE note_state ADD COLUMN learning_step_index INTEGER NOT NULL DEFAULT 0;");
    safeRun("ALTER TABLE note_state ADD COLUMN scheduled_days INTEGER NOT NULL DEFAULT 0;");
    safeRun("ALTER TABLE note_state ADD COLUMN stability_days REAL;");
    safeRun("ALTER TABLE note_state ADD COLUMN difficulty REAL;");
    safeRun("ALTER TABLE note_state ADD COLUMN fsrs_state INTEGER NOT NULL DEFAULT 0;");
    safeRun("ALTER TABLE note_state ADD COLUMN suspended_due INTEGER;");
    db.run("CREATE INDEX IF NOT EXISTS idx_note_state_next_review_time ON note_state(next_review_time);");
    db.run("CREATE INDEX IF NOT EXISTS idx_note_state_buried_until ON note_state(buried_until);");
}
export class NoteReviewSqlite {
    constructor(plugin) {
        this.db = null;
        this.opened = false;
        this.plugin = plugin;
    }
    async open() {
        var _a, _b;
        if (this.opened)
            return;
        const adapter = (_b = (_a = this.plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
        if (!adapter)
            throw new Error("No vault adapter available");
        const SQL = await getSqlJs();
        const dir = getSchedulingDirPath(this.plugin);
        const path = getNotesDbPath(this.plugin);
        await ensureDir(adapter, dir);
        await reconcileFromVaultSync(this.plugin, NOTES_DB, path);
        const exists = adapter.exists ? await adapter.exists(path) : false;
        if (exists) {
            const bytes = await readBinary(adapter, path);
            this.db = bytes && bytes.byteLength > 0 ? new SQL.Database(bytes) : new SQL.Database();
        }
        else {
            this.db = new SQL.Database();
        }
        runSchema(this.db);
        this.opened = true;
    }
    async persist() {
        var _a, _b;
        if (!this.opened)
            await this.open();
        if (!this.db)
            return;
        const adapter = (_b = (_a = this.plugin.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter;
        if (!adapter)
            return;
        const dir = getSchedulingDirPath(this.plugin);
        const path = getNotesDbPath(this.plugin);
        await ensureDir(adapter, dir);
        const bytes = this.db.export();
        await writeBinary(adapter, path, bytes);
        await copyDbToVaultSyncFolder(this.plugin, NOTES_DB, bytes);
    }
    async close() {
        var _a;
        if (!this.opened)
            return;
        await this.persist();
        (_a = this.db) === null || _a === void 0 ? void 0 : _a.close();
        this.db = null;
        this.opened = false;
    }
    /**
     * Close the in-memory database **without** persisting to disk.
     * Use this when you want to discard a stale in-memory snapshot
     * and re-open from disk to pick up writes made by another instance.
     */
    discard() {
        var _a;
        if (!this.opened)
            return;
        (_a = this.db) === null || _a === void 0 ? void 0 : _a.close();
        this.db = null;
        this.opened = false;
    }
    upsertNoteState(row) {
        if (!this.db)
            return;
        const now = Date.now();
        this.db.run(`INSERT INTO note_state(
         note_id, step_index, last_review_time, next_review_time, weight, buried_until,
         reps, lapses, learning_step_index, scheduled_days, stability_days, difficulty, fsrs_state, suspended_due,
         created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         step_index=excluded.step_index,
         last_review_time=excluded.last_review_time,
         next_review_time=excluded.next_review_time,
         weight=excluded.weight,
         buried_until=excluded.buried_until,
         reps=excluded.reps,
         lapses=excluded.lapses,
         learning_step_index=excluded.learning_step_index,
         scheduled_days=excluded.scheduled_days,
         stability_days=excluded.stability_days,
         difficulty=excluded.difficulty,
         fsrs_state=excluded.fsrs_state,
         suspended_due=excluded.suspended_due,
         updated_at=excluded.updated_at`, [
            row.note_id,
            row.step_index,
            row.last_review_time,
            row.next_review_time,
            row.weight,
            row.buried_until,
            row.reps,
            row.lapses,
            row.learning_step_index,
            row.scheduled_days,
            row.stability_days,
            row.difficulty,
            row.fsrs_state,
            row.suspended_due,
            now,
            now,
        ]);
    }
    getNoteState(noteId) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!this.db)
            return null;
        const stmt = this.db.prepare(`SELECT note_id, step_index, last_review_time, next_review_time, weight, buried_until,
              reps, lapses, learning_step_index, scheduled_days, stability_days, difficulty, fsrs_state, suspended_due
         FROM note_state
        WHERE note_id = ?`);
        try {
            stmt.bind([noteId]);
            if (!stmt.step())
                return null;
            const row = stmt.getAsObject();
            return {
                note_id: asText(row.note_id),
                step_index: Number((_a = row.step_index) !== null && _a !== void 0 ? _a : 0),
                last_review_time: row.last_review_time == null ? null : Number(row.last_review_time),
                next_review_time: Number((_b = row.next_review_time) !== null && _b !== void 0 ? _b : Date.now()),
                weight: Number((_c = row.weight) !== null && _c !== void 0 ? _c : 1),
                buried_until: row.buried_until == null ? null : Number(row.buried_until),
                reps: Number((_d = row.reps) !== null && _d !== void 0 ? _d : 0),
                lapses: Number((_e = row.lapses) !== null && _e !== void 0 ? _e : 0),
                learning_step_index: Number((_f = row.learning_step_index) !== null && _f !== void 0 ? _f : 0),
                scheduled_days: Number((_g = row.scheduled_days) !== null && _g !== void 0 ? _g : 0),
                stability_days: row.stability_days == null ? null : Number(row.stability_days),
                difficulty: row.difficulty == null ? null : Number(row.difficulty),
                fsrs_state: Number((_h = row.fsrs_state) !== null && _h !== void 0 ? _h : 0),
                suspended_due: row.suspended_due == null ? null : Number(row.suspended_due),
            };
        }
        finally {
            stmt.free();
        }
    }
    listDueNoteIds(now, limit) {
        if (!this.db)
            return [];
        const out = [];
        const stmt = this.db.prepare(`SELECT note_id
         FROM note_state
        WHERE next_review_time <= ?
          AND (buried_until IS NULL OR buried_until <= ?)
        ORDER BY next_review_time ASC
        LIMIT ?`);
        try {
            stmt.bind([now, now, Math.max(1, Math.floor(limit))]);
            while (stmt.step()) {
                const row = stmt.getAsObject();
                const id = asText(row.note_id).trim();
                if (id)
                    out.push(id);
            }
        }
        finally {
            stmt.free();
        }
        return out;
    }
    countDueInRange(fromMs, toMs) {
        var _a;
        if (!this.db)
            return 0;
        const stmt = this.db.prepare(`SELECT COUNT(*) AS count FROM note_state
       WHERE next_review_time > ? AND next_review_time <= ?
         AND (buried_until IS NULL OR buried_until <= ?)`);
        try {
            stmt.bind([fromMs, toMs, fromMs]);
            if (!stmt.step())
                return 0;
            const row = stmt.getAsObject();
            return Math.max(0, Math.floor(Number((_a = row.count) !== null && _a !== void 0 ? _a : 0)));
        }
        finally {
            stmt.free();
        }
    }
    clearAllNoteState() {
        var _a;
        if (!this.db)
            return 0;
        const stmt = this.db.prepare("SELECT COUNT(*) AS count FROM note_state");
        let count = 0;
        try {
            if (stmt.step()) {
                const row = stmt.getAsObject();
                count = Number((_a = row.count) !== null && _a !== void 0 ? _a : 0);
            }
        }
        finally {
            stmt.free();
        }
        this.db.run("DELETE FROM note_state");
        return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    }
}
