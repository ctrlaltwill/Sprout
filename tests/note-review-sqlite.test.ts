import { describe, it, expect, vi, afterEach } from "vitest";
import initSqlJs from "sql.js";
import type LearnKitPlugin from "../src/main";
import type { NoteReviewRow } from "../src/platform/core/note-review-sqlite";

vi.mock("../src/platform/integrations/anki/anki-sql", async () => {
  const SQL = await initSqlJs();
  return { getSqlJs: vi.fn(async () => SQL) };
});

vi.mock("../src/platform/core/sqlite-store", () => ({
  getSchedulingDirPath: vi.fn(() => ".learnkit/scheduling"),
  copyDbToVaultSyncFolder: vi.fn(async () => {}),
  reconcileFromVaultSync: vi.fn(async () => {}),
}));

function makeFakePlugin(): LearnKitPlugin {
  return {
    app: {
      vault: {
        adapter: {
          exists: vi.fn(async () => false),
          mkdir: vi.fn(async () => {}),
          readBinary: vi.fn(async () => new ArrayBuffer(0)),
          writeBinary: vi.fn(async () => {}),
        },
      },
    },
    settings: {},
    manifest: { dir: ".learnkit" },
  } as unknown as LearnKitPlugin;
}

function makeRow(
  overrides: Partial<NoteReviewRow> & { note_id: string; next_review_time: number },
): NoteReviewRow {
  return {
    step_index: 0,
    last_review_time: null,
    weight: 1,
    buried_until: null,
    reps: 0,
    lapses: 0,
    learning_step_index: 0,
    scheduled_days: 0,
    stability_days: null,
    difficulty: null,
    fsrs_state: 0,
    suspended_due: null,
    ...overrides,
  };
}

// Dynamic import so mocks are resolved first.
const { NoteReviewSqlite } = await import("../src/platform/core/note-review-sqlite");

describe("NoteReviewSqlite – in-memory round-trips", () => {
  let store: InstanceType<typeof NoteReviewSqlite>;

  afterEach(() => {
    store?.discard();
  });

  it("open() creates schema without throwing", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await expect(store.open()).resolves.toBeUndefined();
  });

  it("double open() is safe", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();
    await expect(store.open()).resolves.toBeUndefined();
  });

  it("upsertNoteState → getNoteState round-trips all fields", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    const row = makeRow({
      note_id: "abc-123",
      step_index: 2,
      last_review_time: 1000,
      next_review_time: 5000,
      weight: 1.5,
      buried_until: 9000,
      reps: 3,
      lapses: 1,
      learning_step_index: 1,
      scheduled_days: 7,
      stability_days: 14.5,
      difficulty: 0.3,
      fsrs_state: 2,
      suspended_due: 8000,
    });

    store.upsertNoteState(row);
    const result = store.getNoteState("abc-123");

    expect(result).not.toBeNull();
    expect(result!.note_id).toBe("abc-123");
    expect(result!.step_index).toBe(2);
    expect(result!.last_review_time).toBe(1000);
    expect(result!.next_review_time).toBe(5000);
    expect(result!.weight).toBe(1.5);
    expect(result!.buried_until).toBe(9000);
    expect(result!.reps).toBe(3);
    expect(result!.lapses).toBe(1);
    expect(result!.learning_step_index).toBe(1);
    expect(result!.scheduled_days).toBe(7);
    expect(result!.stability_days).toBe(14.5);
    expect(result!.difficulty).toBe(0.3);
    expect(result!.fsrs_state).toBe(2);
    expect(result!.suspended_due).toBe(8000);
  });

  it("round-trips nullable fields as null", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    store.upsertNoteState(makeRow({ note_id: "null-test", next_review_time: 1000 }));
    const result = store.getNoteState("null-test")!;

    expect(result.last_review_time).toBeNull();
    expect(result.buried_until).toBeNull();
    expect(result.stability_days).toBeNull();
    expect(result.difficulty).toBeNull();
    expect(result.suspended_due).toBeNull();
  });

  it("upsert twice updates existing row", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    store.upsertNoteState(makeRow({ note_id: "dup", next_review_time: 1000, reps: 0 }));
    store.upsertNoteState(makeRow({ note_id: "dup", next_review_time: 2000, reps: 5 }));

    const result = store.getNoteState("dup")!;
    expect(result.next_review_time).toBe(2000);
    expect(result.reps).toBe(5);
  });

  it("getNoteState returns null for unknown id", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();
    expect(store.getNoteState("does-not-exist")).toBeNull();
  });

  it("listDueNoteIds filters by next_review_time and buried_until", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    const now = 5000;
    store.upsertNoteState(makeRow({ note_id: "due", next_review_time: 4000 }));
    store.upsertNoteState(makeRow({ note_id: "future", next_review_time: 9000 }));
    store.upsertNoteState(makeRow({ note_id: "buried-future", next_review_time: 3000, buried_until: 8000 }));
    store.upsertNoteState(makeRow({ note_id: "buried-past", next_review_time: 3000, buried_until: 2000 }));

    const ids = store.listDueNoteIds(now, 100);
    expect(ids).toContain("due");
    expect(ids).toContain("buried-past");
    expect(ids).not.toContain("future");
    expect(ids).not.toContain("buried-future");
  });

  it("listDueNoteIds respects limit", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    for (let i = 0; i < 10; i++) {
      store.upsertNoteState(makeRow({ note_id: `n-${i}`, next_review_time: 100 + i }));
    }

    expect(store.listDueNoteIds(Date.now(), 3)).toHaveLength(3);
  });

  it("countDueInRange uses exclusive lower / inclusive upper bound", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    store.upsertNoteState(makeRow({ note_id: "at-lower", next_review_time: 1000 }));
    store.upsertNoteState(makeRow({ note_id: "inside", next_review_time: 1500 }));
    store.upsertNoteState(makeRow({ note_id: "at-upper", next_review_time: 2000 }));
    store.upsertNoteState(makeRow({ note_id: "beyond", next_review_time: 3000 }));

    expect(store.countDueInRange(1000, 2000)).toBe(2);
  });

  it("clearAllNoteState returns count and empties table", async () => {
    store = new NoteReviewSqlite(makeFakePlugin());
    await store.open();

    store.upsertNoteState(makeRow({ note_id: "a", next_review_time: 100 }));
    store.upsertNoteState(makeRow({ note_id: "b", next_review_time: 200 }));

    const cleared = store.clearAllNoteState();
    expect(cleared).toBe(2);
    expect(store.getNoteState("a")).toBeNull();
    expect(store.getNoteState("b")).toBeNull();
  });
});
