/**
 * @file src/platform/core/note-review-sqlite.ts
 * @summary Module for note review sqlite.
 *
 * @exports
 *  - NoteReviewRow
 *  - getNotesDbPath
 *  - NoteReviewSqlite
 */

import type { Database } from "sql.js";
import type LearnKitPlugin from "../../main";
import { getSqlJs } from "../integrations/anki/anki-sql";
import { getSchedulingDirPath, copyDbToVaultSyncFolder, reconcileFromVaultSync } from "./sqlite-store";

const NOTES_DB = "notes.db";

export type NoteReviewRow = {
  note_id: string;
  step_index: number;
  last_review_time: number | null;
  next_review_time: number;
  weight: number;
  buried_until: number | null;
  reps: number;
  lapses: number;
  learning_step_index: number;
  scheduled_days: number;
  stability_days: number | null;
  difficulty: number | null;
  fsrs_state: number;
  suspended_due: number | null;
};

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return fallback;
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => typeof p === "string" && p.length)
    .join("/")
    .replace(/\/+/g, "/");
}

export function getNotesDbPath(plugin: LearnKitPlugin): string {
  return joinPath(getSchedulingDirPath(plugin), NOTES_DB);
}

async function ensureDir(adapter: { exists?: (path: string) => Promise<boolean>; mkdir?: (path: string) => Promise<void> }, path: string): Promise<void> {
  if (!adapter.exists || !adapter.mkdir) return;
  if (await adapter.exists(path)) return;
  await adapter.mkdir(path);
}

async function readBinary(adapter: {
  readBinary?: (path: string) => Promise<ArrayBuffer>;
}, path: string): Promise<Uint8Array | null> {
  if (!adapter.readBinary) return null;
  try {
    const buff = await adapter.readBinary(path);
    return new Uint8Array(buff);
  } catch {
    return null;
  }
}

async function writeBinary(adapter: {
  writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
}, path: string, bytes: Uint8Array): Promise<void> {
  if (!adapter.writeBinary) throw new Error("No binary write support in adapter");
  const output = bytes.slice().buffer;
  await adapter.writeBinary(path, output);
}

function runSchema(db: Database): void {
  const safeRun = (sql: string) => {
    try {
      db.run(sql);
    } catch {
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
  private plugin: LearnKitPlugin;
  private db: Database | null = null;
  private opened = false;

  constructor(plugin: LearnKitPlugin) {
    this.plugin = plugin;
  }

  async open(): Promise<void> {
    if (this.opened) return;

    const adapter = this.plugin.app?.vault?.adapter as {
      exists?: (path: string) => Promise<boolean>;
      mkdir?: (path: string) => Promise<void>;
      readBinary?: (path: string) => Promise<ArrayBuffer>;
      writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
    } | null;

    if (!adapter) throw new Error("No vault adapter available");

    const SQL = await getSqlJs();
    const dir = getSchedulingDirPath(this.plugin);
    const path = getNotesDbPath(this.plugin);

    await ensureDir(adapter, dir);
    await reconcileFromVaultSync(this.plugin, NOTES_DB, path);

    const exists = adapter.exists ? await adapter.exists(path) : false;
    if (exists) {
      const bytes = await readBinary(adapter, path);
      this.db = bytes && bytes.byteLength > 0 ? new SQL.Database(bytes) : new SQL.Database();
    } else {
      this.db = new SQL.Database();
    }

    runSchema(this.db);
    this.opened = true;
  }

  async persist(): Promise<void> {
    if (!this.opened) await this.open();
    if (!this.db) return;

    const adapter = this.plugin.app?.vault?.adapter as {
      mkdir?: (path: string) => Promise<void>;
      exists?: (path: string) => Promise<boolean>;
      writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
    } | null;
    if (!adapter) return;

    const dir = getSchedulingDirPath(this.plugin);
    const path = getNotesDbPath(this.plugin);

    await ensureDir(adapter, dir);

    const bytes = this.db.export();
    await writeBinary(adapter, path, bytes);
    await copyDbToVaultSyncFolder(this.plugin, NOTES_DB, bytes);
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    await this.persist();
    this.db?.close();
    this.db = null;
    this.opened = false;
  }

  /**
   * Close the in-memory database **without** persisting to disk.
   * Use this when you want to discard a stale in-memory snapshot
   * and re-open from disk to pick up writes made by another instance.
   */
  discard(): void {
    if (!this.opened) return;
    this.db?.close();
    this.db = null;
    this.opened = false;
  }

  upsertNoteState(row: NoteReviewRow): void {
    if (!this.db) return;
    const now = Date.now();
    this.db.run(
      `INSERT INTO note_state(
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
         updated_at=excluded.updated_at`,
      [
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
      ],
    );
  }

  getNoteState(noteId: string): NoteReviewRow | null {
    if (!this.db) return null;
    const stmt = this.db.prepare(
            `SELECT note_id, step_index, last_review_time, next_review_time, weight, buried_until,
              reps, lapses, learning_step_index, scheduled_days, stability_days, difficulty, fsrs_state, suspended_due
         FROM note_state
        WHERE note_id = ?`,
    );
    try {
      stmt.bind([noteId]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        note_id: asText(row.note_id),
        step_index: Number(row.step_index ?? 0),
        last_review_time: row.last_review_time == null ? null : Number(row.last_review_time),
        next_review_time: Number(row.next_review_time ?? Date.now()),
        weight: Number(row.weight ?? 1),
        buried_until: row.buried_until == null ? null : Number(row.buried_until),
        reps: Number(row.reps ?? 0),
        lapses: Number(row.lapses ?? 0),
        learning_step_index: Number(row.learning_step_index ?? 0),
        scheduled_days: Number(row.scheduled_days ?? 0),
        stability_days: row.stability_days == null ? null : Number(row.stability_days),
        difficulty: row.difficulty == null ? null : Number(row.difficulty),
        fsrs_state: Number(row.fsrs_state ?? 0),
        suspended_due: row.suspended_due == null ? null : Number(row.suspended_due),
      };
    } finally {
      stmt.free();
    }
  }

  listDueNoteIds(now: number, limit: number): string[] {
    if (!this.db) return [];
    const out: string[] = [];
    const stmt = this.db.prepare(
      `SELECT note_id
         FROM note_state
        WHERE next_review_time <= ?
          AND (buried_until IS NULL OR buried_until <= ?)
        ORDER BY next_review_time ASC
        LIMIT ?`,
    );
    try {
      stmt.bind([now, now, Math.max(1, Math.floor(limit))]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const id = asText(row.note_id).trim();
        if (id) out.push(id);
      }
    } finally {
      stmt.free();
    }
    return out;
  }

  countDueInRange(fromMs: number, toMs: number): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      `SELECT COUNT(*) AS count FROM note_state
       WHERE next_review_time > ? AND next_review_time <= ?
         AND (buried_until IS NULL OR buried_until <= ?)`,
    );
    try {
      stmt.bind([fromMs, toMs, fromMs]);
      if (!stmt.step()) return 0;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return Math.max(0, Math.floor(Number(row.count ?? 0)));
    } finally {
      stmt.free();
    }
  }

  clearAllNoteState(): number {
    if (!this.db) return 0;

    const stmt = this.db.prepare("SELECT COUNT(*) AS count FROM note_state");
    let count = 0;
    try {
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        count = Number(row.count ?? 0);
      }
    } finally {
      stmt.free();
    }

    this.db.run("DELETE FROM note_state");
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }
}
