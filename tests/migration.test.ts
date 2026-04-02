// tests/migration.test.ts
// ---------------------------------------------------------------------------
// Unit tests for src/platform/core/migration.ts — the JSON→SQLite migration
// path. Because SqliteStore depends on sql.js and the Obsidian vault adapter,
// we mock the entire sqlite-store module and test the orchestration logic of
// migrateJsonToSqlite: guard checks, backup creation, store deletion, and
// error handling.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockOpen = vi.fn().mockResolvedValue(undefined);
const mockLoad = vi.fn();
const mockPersist = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/platform/core/sqlite-store", () => ({
  SqliteStore: vi.fn().mockImplementation(function (this: any) {
    this.open = mockOpen;
    this.load = mockLoad;
    this.persist = mockPersist;
    this.close = mockClose;
  }),
  isSqliteDatabasePresent: vi.fn().mockResolvedValue(false),
  getFlashcardsDbPath: vi.fn().mockReturnValue(".obsidian/plugins/learnkit/scheduling/flashcards.db"),
  getSchedulingDirPath: vi.fn().mockReturnValue(".obsidian/plugins/learnkit/scheduling"),
}));

vi.mock("../src/platform/core/logger", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { migrateJsonToSqlite } from "../src/platform/core/migration";
import {
  isSqliteDatabasePresent,
  SqliteStore,
} from "../src/platform/core/sqlite-store";

// ── Helpers ─────────────────────────────────────────────────────────────────

type MockAdapter = {
  exists: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function makeAdapter(overrides?: Partial<MockAdapter>): MockAdapter {
  return {
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePlugin(adapter: MockAdapter | null, rootData?: unknown) {
  const savedData: { value: unknown } = { value: undefined };
  return {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter,
      },
    },
    manifest: { id: "learnkit" },
    loadData: vi.fn().mockResolvedValue(rootData ?? {}),
    saveData: vi.fn().mockImplementation(async (d: unknown) => { savedData.value = d; }),
    _savedData: savedData,
  } as any;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("migrateJsonToSqlite", () => {
  beforeEach(() => {
    // Re-establish mock implementations after each clear — vi.clearAllMocks
    // can discard mockResolvedValue/mockImplementation on factory-created fns.
    mockOpen.mockReset().mockResolvedValue(undefined);
    mockLoad.mockReset();
    mockPersist.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);

    vi.mocked(SqliteStore).mockImplementation(function (this: any) {
      this.open = mockOpen;
      this.load = mockLoad;
      this.persist = mockPersist;
      this.close = mockClose;
    } as any);

    vi.mocked(isSqliteDatabasePresent).mockReset().mockResolvedValue(false);
  });

  // ── No-op paths ──────────────────────────────────────────────────────────

  describe("no-op paths", () => {
    it("returns true immediately when SQLite database already exists", async () => {
      vi.mocked(isSqliteDatabasePresent).mockResolvedValueOnce(true);
      const plugin = makePlugin(makeAdapter());

      const result = await migrateJsonToSqlite(plugin);

      expect(result).toBe(true);
      expect(mockOpen).not.toHaveBeenCalled();
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("returns true when rootData is null (no legacy store)", async () => {
      const plugin = makePlugin(makeAdapter());

      const result = await migrateJsonToSqlite(plugin, null);

      expect(result).toBe(true);
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("returns true when root.store is missing", async () => {
      const plugin = makePlugin(makeAdapter());

      const result = await migrateJsonToSqlite(plugin, { settings: {} });

      expect(result).toBe(true);
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("returns true when root.store is an empty object", async () => {
      const plugin = makePlugin(makeAdapter());

      const result = await migrateJsonToSqlite(plugin, { store: {} });

      expect(result).toBe(true);
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("returns true when root.store is not a plain object (array)", async () => {
      const plugin = makePlugin(makeAdapter());

      const result = await migrateJsonToSqlite(plugin, { store: [1, 2, 3] });

      expect(result).toBe(true);
      expect(mockOpen).not.toHaveBeenCalled();
    });
  });

  // ── Adapter guard ────────────────────────────────────────────────────────

  describe("adapter guard", () => {
    it("returns false when adapter is null", async () => {
      const plugin = makePlugin(null);

      const result = await migrateJsonToSqlite(plugin, { store: { cards: {} } });

      expect(result).toBe(false);
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("migrates legacy store to SQLite, creates backup, and strips root.store", async () => {
      const adapter = makeAdapter({
        exists: vi.fn().mockResolvedValue(true),
      });
      const legacyStore = {
        cards: { "card-1": { id: "card-1", q: "Q?", a: "A" } },
        states: { "card-1": { due: 1000 } },
      };
      const rootData = { store: legacyStore, settings: { theme: "dark" } };
      const plugin = makePlugin(adapter, rootData);

      const result = await migrateJsonToSqlite(plugin, rootData);

      expect(result).toBe(true);

      // SqliteStore was created, opened, loaded, persisted, and closed
      expect(mockOpen).toHaveBeenCalledOnce();
      expect(mockLoad).toHaveBeenCalledWith({ store: legacyStore });
      expect(mockPersist).toHaveBeenCalledOnce();
      expect(mockClose).toHaveBeenCalledOnce();

      // Backup was written
      expect(adapter.write).toHaveBeenCalledOnce();
      const [backupPath, backupContent] = adapter.write.mock.calls[0];
      expect(backupPath).toContain("backups/pre-sqlite-data-");
      expect(backupPath).toMatch(/\.json$/);
      const parsed = JSON.parse(backupContent);
      expect(parsed.store).toEqual(legacyStore);

      // root.store was deleted and remaining data saved
      expect(plugin.saveData).toHaveBeenCalledOnce();
      const saved = plugin.saveData.mock.calls[0][0];
      expect(saved.store).toBeUndefined();
      expect(saved.settings).toEqual({ theme: "dark" });
    });

    it("calls loadData when rootData is not provided", async () => {
      const adapter = makeAdapter({
        exists: vi.fn().mockResolvedValue(true),
      });
      const legacyData = { store: { cards: { x: {} } } };
      const plugin = makePlugin(adapter, legacyData);

      await migrateJsonToSqlite(plugin);

      expect(plugin.loadData).toHaveBeenCalledOnce();
    });

    it("creates backup directory if it does not exist", async () => {
      const adapter = makeAdapter({
        exists: vi.fn()
          .mockResolvedValueOnce(false)   // ensureFolder: backupDir does not exist
          .mockResolvedValueOnce(true),    // db verification: db exists
      });
      const plugin = makePlugin(adapter);

      await migrateJsonToSqlite(plugin, { store: { cards: {} } });

      expect(adapter.mkdir).toHaveBeenCalled();
    });
  });

  // ── DB verification failure ──────────────────────────────────────────────

  describe("DB verification", () => {
    it("returns false if database file is not found after persist", async () => {
      const adapter = makeAdapter({
        exists: vi.fn()
          .mockResolvedValueOnce(false)   // ensureFolder: backupDir
          .mockResolvedValueOnce(false),  // db verification: db does NOT exist
      });
      const plugin = makePlugin(adapter);

      const result = await migrateJsonToSqlite(plugin, { store: { cards: {} } });

      expect(result).toBe(false);
      // Backup and saveData should NOT have been called since we bailed early
      expect(adapter.write).not.toHaveBeenCalled();
      expect(plugin.saveData).not.toHaveBeenCalled();
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns false and does not modify store when SqliteStore.open() throws", async () => {
      mockOpen.mockRejectedValueOnce(new Error("sql.js init failed"));
      const adapter = makeAdapter();
      const rootData = { store: { cards: { a: {} } } };
      const plugin = makePlugin(adapter, rootData);

      const result = await migrateJsonToSqlite(plugin, rootData);

      expect(result).toBe(false);
      // root.store should still be intact (not deleted)
      expect(rootData.store).toBeDefined();
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("returns false when SqliteStore.persist() throws", async () => {
      mockPersist.mockRejectedValueOnce(new Error("disk full"));
      const adapter = makeAdapter();
      const rootData = { store: { cards: { a: {} } } };
      const plugin = makePlugin(adapter, rootData);

      const result = await migrateJsonToSqlite(plugin, rootData);

      expect(result).toBe(false);
      expect(plugin.saveData).not.toHaveBeenCalled();
    });
  });

  // ── Data shape edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("treats non-object rootData as empty root (returns true, no migration)", async () => {
      const plugin = makePlugin(makeAdapter());

      expect(await migrateJsonToSqlite(plugin, "not-an-object")).toBe(true);
      expect(await migrateJsonToSqlite(plugin, 42)).toBe(true);
      expect(await migrateJsonToSqlite(plugin, true)).toBe(true);
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it("handles root.store with nested data correctly", async () => {
      const adapter = makeAdapter({
        exists: vi.fn().mockResolvedValue(true),
      });
      const deepStore = {
        cards: {
          "card-1": { id: "card-1", q: "What is 2+2?", a: "4", type: "basic" },
          "card-2": { id: "card-2", q: "Capital of France?", a: "Paris", type: "basic" },
        },
        states: {
          "card-1": { due: 1000, stage: "review" },
          "card-2": { due: 2000, stage: "learning" },
        },
        reviewLog: [{ id: "card-1", at: 500, result: "good" }],
      };
      const rootData = { store: deepStore, settings: { retention: 0.9 } };
      const plugin = makePlugin(adapter);

      const result = await migrateJsonToSqlite(plugin, rootData);

      expect(result).toBe(true);

      // Verify backup contains the exact original store
      const backupContent = JSON.parse(adapter.write.mock.calls[0][1]);
      expect(backupContent.store).toEqual(deepStore);

      // Verify settings are preserved when store is stripped
      const saved = plugin.saveData.mock.calls[0][0];
      expect(saved.settings).toEqual({ retention: 0.9 });
      expect(saved.store).toBeUndefined();
    });
  });
});
