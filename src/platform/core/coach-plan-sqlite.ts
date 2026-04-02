/**
 * @file src/platform/core/coach-plan-sqlite.ts
 * @summary Module for coach plan sqlite.
 *
 * @exports
 *  - CoachScopeType
 *  - CoachIntensity
 *  - CoachPlanRow
 *  - CoachProgressRow
 *  - SavedScopePresetScope
 *  - SavedScopePresetRow
 */

import type { Database } from "sql.js";
import type LearnKitPlugin from "../../main";
import { getSqlJs } from "../integrations/anki/anki-sql";
import { getSchedulingDirPath, copyDbToVaultSyncFolder, reconcileFromVaultSync } from "./sqlite-store";

const COACH_DB = "coach.db";

export type CoachScopeType = "vault" | "folder" | "note" | "group" | "tag" | "property";
export type CoachIntensity = "relaxed" | "balanced" | "aggressive";

export type CoachPlanRow = {
  plan_id: string;
  scope_type: CoachScopeType;
  scope_key: string;
  scope_name: string;
  plan_name: string;
  scope_data: string;
  exam_date_utc: number;
  intensity: CoachIntensity;
  daily_flashcard_target: number;
  daily_note_target: number;
  status: "on-track" | "at-risk" | "behind";
  updated_at: number;
};

export type CoachProgressRow = {
  day_utc: number;
  scope_type: CoachScopeType;
  scope_key: string;
  kind: "flashcard" | "note";
  count: number;
};

export type SavedScopePresetScope = {
  type: "vault" | "folder" | "note" | "group" | "tag" | "property";
  key: string;
  name: string;
};

export type SavedScopePresetRow = {
  preset_id: string;
  name: string;
  scopes_json: string;
  created_at: number;
  updated_at: number;
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

function getCoachDbPath(plugin: LearnKitPlugin): string {
  return joinPath(getSchedulingDirPath(plugin), COACH_DB);
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
  await adapter.writeBinary(path, bytes.slice().buffer);
}

function runSchema(db: Database): void {
  db.run("PRAGMA journal_mode = DELETE;");
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE IF NOT EXISTS coach_plan (
      plan_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      scope_name TEXT NOT NULL,
      plan_name TEXT NOT NULL DEFAULT '',
      scope_data TEXT NOT NULL DEFAULT '',
      exam_date_utc INTEGER NOT NULL,
      intensity TEXT NOT NULL DEFAULT 'balanced',
      daily_flashcard_target INTEGER NOT NULL DEFAULT 0,
      daily_note_target INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'on-track',
      updated_at INTEGER NOT NULL
    );
  `);

  // Legacy schema compatibility: older installs may not have these columns.
  try {
    db.run("ALTER TABLE coach_plan ADD COLUMN plan_name TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists or table already migrated.
  }

  try {
    db.run("ALTER TABLE coach_plan ADD COLUMN scope_data TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists or table already migrated.
  }

  const colsRes = db.exec("PRAGMA table_info(coach_plan)");
  const cols = colsRes[0]?.values?.map((row) => asText(row?.[1])) ?? [];
  const hasPlanId = cols.includes("plan_id");

  if (!hasPlanId && cols.length > 0) {
    db.run("ALTER TABLE coach_plan RENAME TO coach_plan_legacy");
    db.run(`
      CREATE TABLE coach_plan (
        plan_id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        scope_name TEXT NOT NULL,
        plan_name TEXT NOT NULL DEFAULT '',
        scope_data TEXT NOT NULL DEFAULT '',
        exam_date_utc INTEGER NOT NULL,
        intensity TEXT NOT NULL DEFAULT 'balanced',
        daily_flashcard_target INTEGER NOT NULL DEFAULT 0,
        daily_note_target INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'on-track',
        updated_at INTEGER NOT NULL
      );
    `);
    db.run(`
      INSERT INTO coach_plan(
        plan_id,
        scope_type,
        scope_key,
        scope_name,
        plan_name,
        scope_data,
        exam_date_utc,
        intensity,
        daily_flashcard_target,
        daily_note_target,
        status,
        updated_at
      )
      SELECT
        lower(hex(randomblob(16))),
        scope_type,
        scope_key,
        scope_name,
        COALESCE(plan_name, ''),
        COALESCE(scope_data, ''),
        exam_date_utc,
        intensity,
        daily_flashcard_target,
        daily_note_target,
        status,
        updated_at
      FROM coach_plan_legacy;
    `);
    db.run("DROP TABLE coach_plan_legacy");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS coach_progress (
      day_utc INTEGER NOT NULL,
      scope_type TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day_utc, scope_type, scope_key, kind)
    );
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_coach_plan_exam ON coach_plan(exam_date_utc);");
  db.run("CREATE INDEX IF NOT EXISTS idx_coach_progress_day ON coach_progress(day_utc);");

  db.run(`
    CREATE TABLE IF NOT EXISTS saved_scope_presets (
      preset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_saved_scope_presets_updated ON saved_scope_presets(updated_at DESC);");
}

export class CoachPlanSqlite {
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
    const path = getCoachDbPath(this.plugin);

    await ensureDir(adapter, dir);
    await reconcileFromVaultSync(this.plugin, COACH_DB, path);

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
    const path = getCoachDbPath(this.plugin);

    await ensureDir(adapter, dir);

    const bytes = this.db.export();
    await writeBinary(adapter, path, bytes);
    await copyDbToVaultSyncFolder(this.plugin, COACH_DB, bytes);
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

  listPlans(): CoachPlanRow[] {
    if (!this.db) return [];
    const out: CoachPlanRow[] = [];
    const stmt = this.db.prepare(
      `SELECT plan_id, scope_type, scope_key, scope_name, plan_name, scope_data, exam_date_utc, intensity,
              daily_flashcard_target, daily_note_target, status, updated_at
         FROM coach_plan
        ORDER BY exam_date_utc ASC, scope_name ASC`,
    );

    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        out.push({
          plan_id: asText(row.plan_id),
          scope_type: asText(row.scope_type, "vault") as CoachScopeType,
          scope_key: asText(row.scope_key),
          scope_name: asText(row.scope_name),
          plan_name: asText(row.plan_name),
          scope_data: asText(row.scope_data),
          exam_date_utc: Number(row.exam_date_utc || 0),
          intensity: asText(row.intensity, "balanced") as CoachIntensity,
          daily_flashcard_target: Number(row.daily_flashcard_target || 0),
          daily_note_target: Number(row.daily_note_target || 0),
          status: asText(row.status, "on-track") as CoachPlanRow["status"],
          updated_at: Number(row.updated_at || 0),
        });
      }
    } finally {
      stmt.free();
    }

    return out;
  }

  upsertPlan(row: CoachPlanRow): void {
    if (!this.db) return;
    this.db.run(
      `INSERT INTO coach_plan(
         plan_id, scope_type, scope_key, scope_name, plan_name, scope_data, exam_date_utc, intensity,
         daily_flashcard_target, daily_note_target, status, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plan_id) DO UPDATE SET
         scope_name=excluded.scope_name,
         plan_name=excluded.plan_name,
         scope_data=excluded.scope_data,
         exam_date_utc=excluded.exam_date_utc,
         intensity=excluded.intensity,
         daily_flashcard_target=excluded.daily_flashcard_target,
         daily_note_target=excluded.daily_note_target,
         status=excluded.status,
         updated_at=excluded.updated_at`,
      [
        row.plan_id,
        row.scope_type,
        row.scope_key,
        row.scope_name,
        row.plan_name,
        row.scope_data,
        row.exam_date_utc,
        row.intensity,
        row.daily_flashcard_target,
        row.daily_note_target,
        row.status,
        row.updated_at,
      ],
    );
  }

  deletePlan(planId: string): void {
    if (!this.db) return;
    this.db.run("DELETE FROM coach_plan WHERE plan_id = ?", [planId]);
  }

  incrementProgress(dayUtc: number, scopeType: CoachScopeType, scopeKey: string, kind: CoachProgressRow["kind"], by = 1): void {
    if (!this.db) return;
    const delta = Math.max(1, Math.floor(Number(by) || 1));
    this.db.run(
      `INSERT INTO coach_progress(day_utc, scope_type, scope_key, kind, count)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(day_utc, scope_type, scope_key, kind) DO UPDATE SET
         count = count + excluded.count`,
      [dayUtc, scopeType, scopeKey, kind, delta],
    );
  }

  getProgress(dayUtc: number, scopeType: CoachScopeType, scopeKey: string): { flashcard: number; note: number } {
    if (!this.db) return { flashcard: 0, note: 0 };

    let flashcard = 0;
    let note = 0;

    const stmt = this.db.prepare(
      `SELECT kind, count
         FROM coach_progress
        WHERE day_utc = ? AND scope_type = ? AND scope_key = ?`,
    );

    try {
      stmt.bind([dayUtc, scopeType, scopeKey]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const kind = asText(row.kind);
        const count = Number(row.count || 0);
        if (kind === "flashcard") flashcard += count;
        if (kind === "note") note += count;
      }
    } finally {
      stmt.free();
    }

    return { flashcard, note };
  }

  countProgressDays(scopeType: CoachScopeType, scopeKey: string): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      `SELECT COUNT(DISTINCT day_utc) AS cnt
         FROM coach_progress
        WHERE scope_type = ? AND scope_key = ? AND count > 0`,
    );
    try {
      stmt.bind([scopeType, scopeKey]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        return Number(row.cnt || 0);
      }
    } finally {
      stmt.free();
    }
    return 0;
  }

  currentStreakDays(scopeType: CoachScopeType, scopeKey: string, todayUtc?: number): number {
    if (!this.db) return 0;

    const days: number[] = [];
    const stmt = this.db.prepare(
      `SELECT DISTINCT day_utc
         FROM coach_progress
        WHERE scope_type = ? AND scope_key = ? AND count > 0
        ORDER BY day_utc DESC`,
    );

    try {
      stmt.bind([scopeType, scopeKey]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const day = Number(row.day_utc || 0);
        if (Number.isFinite(day) && day > 0) days.push(day);
      }
    } finally {
      stmt.free();
    }

    if (!days.length) return 0;

    const MS_DAY = 24 * 60 * 60 * 1000;
    const anchor = Number.isFinite(todayUtc) ? Number(todayUtc) : (() => {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      return now.getTime();
    })();

    const daySet = new Set(days);
    let cursor = anchor;
    let streak = 0;

    if (!daySet.has(cursor)) {
      const yesterday = cursor - MS_DAY;
      if (!daySet.has(yesterday)) return 0;
      cursor = yesterday;
    }

    while (daySet.has(cursor)) {
      streak += 1;
      cursor -= MS_DAY;
    }

    return streak;
  }

  latestProgressDayUtc(scopeType: CoachScopeType, scopeKey: string): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare(
      `SELECT MAX(day_utc) AS day_utc
         FROM coach_progress
        WHERE scope_type = ? AND scope_key = ? AND count > 0`,
    );
    try {
      stmt.bind([scopeType, scopeKey]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        return Number(row.day_utc || 0);
      }
    } finally {
      stmt.free();
    }
    return 0;
  }

  listSavedScopePresets(): SavedScopePresetRow[] {
    if (!this.db) return [];
    const out: SavedScopePresetRow[] = [];
    const stmt = this.db.prepare(
      `SELECT preset_id, name, scopes_json, created_at, updated_at
         FROM saved_scope_presets
        ORDER BY updated_at DESC, name COLLATE NOCASE ASC`,
    );

    try {
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        out.push({
          preset_id: asText(row.preset_id),
          name: asText(row.name),
          scopes_json: asText(row.scopes_json, "[]"),
          created_at: Number(row.created_at || 0),
          updated_at: Number(row.updated_at || 0),
        });
      }
    } finally {
      stmt.free();
    }

    return out;
  }

  upsertSavedScopePreset(row: SavedScopePresetRow): void {
    if (!this.db) return;
    this.db.run(
      `INSERT INTO saved_scope_presets(
         preset_id, name, scopes_json, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(preset_id) DO UPDATE SET
         name=excluded.name,
         scopes_json=excluded.scopes_json,
         updated_at=excluded.updated_at`,
      [row.preset_id, row.name, row.scopes_json, row.created_at, row.updated_at],
    );
  }

  deleteSavedScopePreset(presetId: string): void {
    if (!this.db) return;
    this.db.run("DELETE FROM saved_scope_presets WHERE preset_id = ?", [presetId]);
  }
}
