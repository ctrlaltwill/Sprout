/**
 * @file src/platform/core/exam-tests-sqlite.ts
 * @summary Module for exam tests sqlite.
 *
 * @exports
 *  - SavedExamTestSummary
 *  - SavedExamTestRecord
 *  - SavedExamAttemptRecord
 *  - getExamTestsDbPath
 *  - ExamTestsSqlite
 */

import type { Database } from "sql.js";
import type LearnKitPlugin from "../../main";
import { getSqlJs } from "../integrations/anki/anki-sql";
import { getSchedulingDirPath, copyDbToVaultSyncFolder, reconcileFromVaultSync } from "./sqlite-store";

const EXAMS_DB = "tests.db";

type AdapterLike = {
  exists?: (path: string) => Promise<boolean>;
  mkdir?: (path: string) => Promise<void>;
  readBinary?: (path: string) => Promise<ArrayBuffer>;
  writeBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
};

export type SavedExamTestSummary = {
  testId: string;
  label: string;
  difficulty: string;
  sourceSummary: string;
  questionCount: number;
  createdAt: number;
  lastAttemptAt: number | null;
  lastScorePercent: number | null;
};

export type SavedExamTestRecord = {
  testId: string;
  label: string;
  sourceSummary: string;
  configJson: string;
  questionsJson: string;
  createdAt: number;
};

export type SavedExamAttemptRecord = {
  attemptId: string;
  testId: string;
  label: string;
  sourceSummary: string;
  finalPercent: number | null;
  autoSubmitted: boolean;
  answersJson: string;
  resultsJson: string;
  createdAt: number;
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
    .replace(/\/+/, "/");
}

export function getExamTestsDbPath(plugin: LearnKitPlugin): string {
  return joinPath(getSchedulingDirPath(plugin), EXAMS_DB);
}

async function ensureDir(adapter: AdapterLike, path: string): Promise<void> {
  if (!adapter.exists || !adapter.mkdir) return;
  if (await adapter.exists(path)) return;
  await adapter.mkdir(path);
}

async function readBinary(adapter: AdapterLike, path: string): Promise<Uint8Array | null> {
  if (!adapter.readBinary) return null;
  try {
    const buff = await adapter.readBinary(path);
    return new Uint8Array(buff);
  } catch {
    return null;
  }
}

async function writeBinary(adapter: AdapterLike, path: string, bytes: Uint8Array): Promise<void> {
  if (!adapter.writeBinary) throw new Error("No binary write support in adapter");
  await adapter.writeBinary(path, bytes.slice().buffer);
}

function runSchema(db: Database): void {
  db.run("PRAGMA journal_mode = DELETE;");
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE IF NOT EXISTS tests (
      test_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      source_summary TEXT NOT NULL,
      config_json TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attempts (
      attempt_id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      final_percent REAL,
      auto_submitted INTEGER NOT NULL DEFAULT 0,
      answers_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(test_id) REFERENCES tests(test_id) ON DELETE CASCADE
    );
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_attempts_test_id_created_at ON attempts(test_id, created_at DESC);");
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ExamTestsSqlite {
  private plugin: LearnKitPlugin;
  private db: Database | null = null;
  private opened = false;

  constructor(plugin: LearnKitPlugin) {
    this.plugin = plugin;
  }

  async open(): Promise<void> {
    if (this.opened) return;

    const adapter = this.plugin.app?.vault?.adapter as AdapterLike | null;
    if (!adapter) throw new Error("No vault adapter available");

    const SQL = await getSqlJs();
    const dir = getSchedulingDirPath(this.plugin);
    const path = getExamTestsDbPath(this.plugin);

    await ensureDir(adapter, dir);
    await reconcileFromVaultSync(this.plugin, EXAMS_DB, path);

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

    const adapter = this.plugin.app?.vault?.adapter as AdapterLike | null;
    if (!adapter) return;

    const dir = getSchedulingDirPath(this.plugin);
    const path = getExamTestsDbPath(this.plugin);

    await ensureDir(adapter, dir);
    const bytes = this.db.export();
    await writeBinary(adapter, path, bytes);
    await copyDbToVaultSyncFolder(this.plugin, EXAMS_DB, bytes);
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    await this.persist();
    this.db?.close();
    this.db = null;
    this.opened = false;
  }

  saveTest(input: {
    label: string;
    sourceSummary: string;
    configJson: string;
    questionsJson: string;
  }): string {
    if (!this.db) return "";
    const testId = randomId("test");
    const now = Date.now();
    this.db.run(
      `INSERT INTO tests(test_id, label, source_summary, config_json, questions_json, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [
        testId,
        input.label,
        input.sourceSummary,
        input.configJson,
        input.questionsJson,
        now,
        now,
      ],
    );
    return testId;
  }

  saveAttempt(input: {
    testId: string;
    finalPercent: number | null;
    autoSubmitted: boolean;
    answersJson: string;
    resultsJson: string;
  }): string {
    if (!this.db) return "";
    const attemptId = randomId("attempt");
    const now = Date.now();
    this.db.run(
      `INSERT INTO attempts(attempt_id, test_id, final_percent, auto_submitted, answers_json, results_json, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [
        attemptId,
        input.testId,
        input.finalPercent,
        input.autoSubmitted ? 1 : 0,
        input.answersJson,
        input.resultsJson,
        now,
      ],
    );
    return attemptId;
  }

  listTests(limit = 20): SavedExamTestSummary[] {
    if (!this.db) return [];
    const out: SavedExamTestSummary[] = [];
    const stmt = this.db.prepare(
      `SELECT
         t.test_id,
         t.label,
         t.config_json,
         t.source_summary,
         t.questions_json,
         t.created_at,
         (
           SELECT a.created_at
           FROM attempts a
           WHERE a.test_id = t.test_id
           ORDER BY a.created_at DESC
           LIMIT 1
         ) AS last_attempt_at,
         (
           SELECT a.final_percent
           FROM attempts a
           WHERE a.test_id = t.test_id
           ORDER BY a.created_at DESC
           LIMIT 1
         ) AS last_score_percent
       FROM tests t
       ORDER BY t.created_at DESC
       LIMIT ?`,
    );

    try {
      stmt.bind([Math.max(1, Math.floor(limit))]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        let questionCount = 0;
        let difficulty = "";
        try {
          const arr = JSON.parse(asText(row.questions_json, "[]")) as unknown;
          if (Array.isArray(arr)) questionCount = arr.length;
        } catch {
          questionCount = 0;
        }
        try {
          const config = JSON.parse(asText(row.config_json, "{}")) as Record<string, unknown>;
          const rawDifficulty = asText(config?.difficulty, "").trim().toLowerCase();
          if (rawDifficulty === "easy" || rawDifficulty === "medium" || rawDifficulty === "hard") {
            difficulty = rawDifficulty;
          }
        } catch {
          difficulty = "";
        }

        out.push({
          testId: asText(row.test_id),
          label: asText(row.label, "Saved test"),
          difficulty,
          sourceSummary: asText(row.source_summary),
          questionCount,
          createdAt: Number(row.created_at ?? Date.now()),
          lastAttemptAt: row.last_attempt_at == null ? null : Number(row.last_attempt_at),
          lastScorePercent: row.last_score_percent == null ? null : Number(row.last_score_percent),
        });
      }
    } finally {
      stmt.free();
    }

    return out;
  }

  getTest(testId: string): SavedExamTestRecord | null {
    if (!this.db) return null;
    const stmt = this.db.prepare(
      `SELECT test_id, label, source_summary, config_json, questions_json, created_at
       FROM tests
       WHERE test_id = ?`,
    );
    try {
      stmt.bind([testId]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        testId: asText(row.test_id),
        label: asText(row.label, "Saved test"),
        sourceSummary: asText(row.source_summary),
        configJson: asText(row.config_json, "{}"),
        questionsJson: asText(row.questions_json, "[]"),
        createdAt: Number(row.created_at ?? Date.now()),
      };
    } finally {
      stmt.free();
    }
  }

  deleteTest(testId: string): boolean {
    if (!this.db) return false;
    this.db.run("DELETE FROM tests WHERE test_id = ?", [testId]);
    return this.db.getRowsModified() > 0;
  }

  listAttempts(limit = 500): SavedExamAttemptRecord[] {
    if (!this.db) return [];
    const out: SavedExamAttemptRecord[] = [];
    const stmt = this.db.prepare(
      `SELECT
         a.attempt_id,
         a.test_id,
         t.label,
         t.source_summary,
         a.final_percent,
         a.auto_submitted,
         a.answers_json,
         a.results_json,
         a.created_at
       FROM attempts a
       LEFT JOIN tests t ON t.test_id = a.test_id
       ORDER BY a.created_at DESC
       LIMIT ?`,
    );

    try {
      stmt.bind([Math.max(1, Math.floor(limit))]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        out.push({
          attemptId: asText(row.attempt_id),
          testId: asText(row.test_id),
          label: asText(row.label, "Saved test"),
          sourceSummary: asText(row.source_summary),
          finalPercent: row.final_percent == null ? null : Number(row.final_percent),
          autoSubmitted: Number(row.auto_submitted ?? 0) > 0,
          answersJson: asText(row.answers_json, "{}"),
          resultsJson: asText(row.results_json, "{}"),
          createdAt: Number(row.created_at ?? Date.now()),
        });
      }
    } finally {
      stmt.free();
    }

    return out;
  }
}
