import { describe, it, expect } from "vitest";
import { inScope, isAvailableNow } from "../src/views/reviewer/session";
import type { CardState } from "../src/platform/types/scheduler";

// ── inScope ─────────────────────────────────────────────────────────────────

describe("inScope", () => {
  it("null scope matches everything", () => {
    expect(inScope(null, "any/path.md")).toBe(true);
  });

  it("vault scope matches everything", () => {
    expect(inScope({ type: "vault", key: "", name: "Vault" }, "deep/nested/note.md")).toBe(true);
  });

  it("folder scope matches note in that folder", () => {
    expect(inScope({ type: "folder", key: "biology", name: "Biology" }, "biology/cells.md")).toBe(true);
  });

  it("folder scope matches note in nested subfolder", () => {
    expect(inScope({ type: "folder", key: "biology", name: "Biology" }, "biology/cell/mitosis.md")).toBe(true);
  });

  it("folder scope rejects note in different folder", () => {
    expect(inScope({ type: "folder", key: "biology", name: "Biology" }, "chemistry/atoms.md")).toBe(false);
  });

  it("folder scope rejects note in root when scope is a subfolder", () => {
    expect(inScope({ type: "folder", key: "biology", name: "Biology" }, "note.md")).toBe(false);
  });

  it("folder scope handles root-level notes (empty folder)", () => {
    expect(inScope({ type: "folder", key: "", name: "Root" }, "note.md")).toBe(true);
  });

  it("note scope matches exact path", () => {
    expect(inScope({ type: "note", key: "biology/cells.md", name: "Cells" }, "biology/cells.md")).toBe(true);
  });

  it("note scope rejects different note", () => {
    expect(inScope({ type: "note", key: "biology/cells.md", name: "Cells" }, "biology/atoms.md")).toBe(false);
  });

  it("group scope always returns false (resolved separately)", () => {
    expect(inScope({ type: "group", key: "my-group", name: "Group" }, "any/path.md")).toBe(false);
  });

  it("unknown scope type fails closed (returns false)", () => {
    expect(inScope({ type: "unknown" as any, key: "", name: "" }, "any/path.md")).toBe(false);
  });
});

// ── isAvailableNow ──────────────────────────────────────────────────────────

const NOW = new Date("2026-04-02T12:00:00Z").getTime();

function makeState(overrides: Partial<CardState>): CardState {
  return {
    id: "test-1",
    stage: "new",
    due: NOW,
    reps: 0,
    lapses: 0,
    learningStepIndex: 0,
    scheduledDays: 0,
    ...overrides,
  } as CardState;
}

describe("isAvailableNow", () => {
  it("returns false for undefined state", () => {
    expect(isAvailableNow(undefined, NOW)).toBe(false);
  });

  it("returns false for suspended cards", () => {
    expect(isAvailableNow(makeState({ stage: "suspended" }), NOW)).toBe(false);
  });

  it("returns true for new cards", () => {
    expect(isAvailableNow(makeState({ stage: "new" }), NOW)).toBe(true);
  });

  it("returns true for review card that is due", () => {
    expect(isAvailableNow(makeState({ stage: "review", due: NOW - 1000 }), NOW)).toBe(true);
  });

  it("returns false for review card due in the future", () => {
    expect(isAvailableNow(makeState({ stage: "review", due: NOW + 60000 }), NOW)).toBe(false);
  });

  it("returns true for learning card that is due", () => {
    expect(isAvailableNow(makeState({ stage: "learning", due: NOW }), NOW)).toBe(true);
  });

  it("returns false for card buried until future", () => {
    expect(isAvailableNow(makeState({ stage: "review", due: NOW - 1000, buriedUntil: NOW + 60000 }), NOW)).toBe(false);
  });

  it("returns true for card whose bury has expired", () => {
    expect(isAvailableNow(makeState({ stage: "review", due: NOW - 1000, buriedUntil: NOW - 1 }), NOW)).toBe(true);
  });

  it("returns true when due is missing/invalid (robust fallback)", () => {
    expect(isAvailableNow(makeState({ stage: "review", due: NaN }), NOW)).toBe(true);
  });

  it("returns true for relearning card that is due", () => {
    expect(isAvailableNow(makeState({ stage: "relearning", due: NOW - 500 }), NOW)).toBe(true);
  });

  it("returns false for unknown stage", () => {
    expect(isAvailableNow(makeState({ stage: "whatever" as any }), NOW)).toBe(false);
  });
});
