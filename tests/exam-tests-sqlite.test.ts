import { describe, it, expect, vi, afterEach } from "vitest";
import initSqlJs from "sql.js";
import type LearnKitPlugin from "../src/main";

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

const { ExamTestsSqlite } = await import("../src/platform/core/exam-tests-sqlite");

describe("ExamTestsSqlite – in-memory round-trips", () => {
  let store: InstanceType<typeof ExamTestsSqlite>;

  afterEach(async () => {
    // close() persists to the mock adapter (no-op writeBinary), then frees the db.
    await store?.close();
  });

  it("open() creates schema without throwing", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await expect(store.open()).resolves.toBeUndefined();
  });

  it("saveTest returns a test-* id", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    const id = store.saveTest({
      label: "Unit 1 Quiz",
      sourceSummary: "Chapter 1",
      configJson: JSON.stringify({ difficulty: "hard" }),
      questionsJson: JSON.stringify([{ q: "Q1" }, { q: "Q2" }]),
    });

    expect(id).toMatch(/^test-/);
  });

  it("saveTest → getTest round-trips all fields", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    const input = {
      label: "Quiz A",
      sourceSummary: "Notes page 5",
      configJson: JSON.stringify({ difficulty: "easy", timed: true }),
      questionsJson: JSON.stringify([{ q: "What is 2+2?", a: "4" }]),
    };

    const testId = store.saveTest(input);
    const result = store.getTest(testId);

    expect(result).not.toBeNull();
    expect(result!.testId).toBe(testId);
    expect(result!.label).toBe("Quiz A");
    expect(result!.sourceSummary).toBe("Notes page 5");
    expect(result!.configJson).toBe(input.configJson);
    expect(result!.questionsJson).toBe(input.questionsJson);
    expect(result!.createdAt).toBeGreaterThan(0);
  });

  it("getTest returns null for unknown id", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();
    expect(store.getTest("nonexistent")).toBeNull();
  });

  it("listTests returns summary with questionCount and difficulty", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    store.saveTest({
      label: "Hard Quiz",
      sourceSummary: "Ch3",
      configJson: JSON.stringify({ difficulty: "hard" }),
      questionsJson: JSON.stringify([{ q: "A" }, { q: "B" }, { q: "C" }]),
    });

    const list = store.listTests();
    expect(list).toHaveLength(1);
    expect(list[0].questionCount).toBe(3);
    expect(list[0].difficulty).toBe("hard");
    expect(list[0].lastAttemptAt).toBeNull();
    expect(list[0].lastScorePercent).toBeNull();
  });

  it("listTests and listAttempts are empty on fresh db", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();
    expect(store.listTests()).toHaveLength(0);
    expect(store.listAttempts()).toHaveLength(0);
  });

  it("saveAttempt → listAttempts round-trips all fields", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    const testId = store.saveTest({
      label: "Quiz B",
      sourceSummary: "Src",
      configJson: "{}",
      questionsJson: "[]",
    });

    const attemptId = store.saveAttempt({
      testId,
      finalPercent: 85.5,
      autoSubmitted: true,
      answersJson: JSON.stringify({ "1": "A" }),
      resultsJson: JSON.stringify({ correct: 1, total: 1 }),
    });

    expect(attemptId).toMatch(/^attempt-/);

    const attempts = store.listAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptId).toBe(attemptId);
    expect(attempts[0].testId).toBe(testId);
    expect(attempts[0].finalPercent).toBe(85.5);
    expect(attempts[0].autoSubmitted).toBe(true);
    expect(attempts[0].answersJson).toBe(JSON.stringify({ "1": "A" }));
    expect(attempts[0].resultsJson).toBe(JSON.stringify({ correct: 1, total: 1 }));
  });

  it("listTests reflects latest attempt score", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    const testId = store.saveTest({
      label: "Quiz C",
      sourceSummary: "Src",
      configJson: "{}",
      questionsJson: JSON.stringify([{ q: "Q" }]),
    });

    store.saveAttempt({
      testId,
      finalPercent: 70,
      autoSubmitted: false,
      answersJson: "{}",
      resultsJson: "{}",
    });

    const list = store.listTests();
    expect(list[0].lastAttemptAt).not.toBeNull();
    expect(list[0].lastScorePercent).toBe(70);
  });

  it("deleteTest removes test and cascades to attempts", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    const testId = store.saveTest({
      label: "Doomed",
      sourceSummary: "x",
      configJson: "{}",
      questionsJson: "[]",
    });

    store.saveAttempt({
      testId,
      finalPercent: 50,
      autoSubmitted: false,
      answersJson: "{}",
      resultsJson: "{}",
    });

    const deleted = store.deleteTest(testId);
    expect(deleted).toBe(true);
    expect(store.getTest(testId)).toBeNull();
    expect(store.listAttempts()).toHaveLength(0);
  });

  it("deleteTest returns false for unknown id", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();
    expect(store.deleteTest("nope")).toBe(false);
  });

  it("saveAttempt with null finalPercent round-trips", async () => {
    store = new ExamTestsSqlite(makeFakePlugin());
    await store.open();

    const testId = store.saveTest({
      label: "Incomplete",
      sourceSummary: "x",
      configJson: "{}",
      questionsJson: "[]",
    });

    store.saveAttempt({
      testId,
      finalPercent: null,
      autoSubmitted: false,
      answersJson: "{}",
      resultsJson: "{}",
    });

    const attempts = store.listAttempts();
    expect(attempts[0].finalPercent).toBeNull();
  });
});
