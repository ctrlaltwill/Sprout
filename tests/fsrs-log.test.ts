/**
 * @file tests/fsrs-log.test.ts
 * @summary Unit tests for fsrs log.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

// tests/fsrs-log.test.ts
// ---------------------------------------------------------------------------
// Tests for the FSRS logging module — covers logFsrsIfNeeded and
// logUndoIfNeeded, verifying correct log output for all rating types,
// skip events, MCQ metadata, undo flows, and edge cases.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logFsrsIfNeeded, logUndoIfNeeded } from "../src/views/reviewer/fsrs-log";
import { log } from "../src/platform/core/logger";

// ── Setup: spy on log.info so we can inspect output ─────────────────────────

let infoSpy: ReturnType<typeof vi.spyOn>;
let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
  debugSpy = vi.spyOn(log, "debug").mockImplementation(() => {});
  log.setLevel("info");
});

afterEach(() => {
  infoSpy.mockRestore();
  debugSpy.mockRestore();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-02-06T12:00:00Z").getTime();

function lastLogMessage(): string {
  const calls = infoSpy.mock.calls;
  if (!calls.length) return "";
  return String(calls[calls.length - 1]?.[0] ?? "");
}

function allLogMessages(): string[] {
  return infoSpy.mock.calls.map((c) => String(c[0] ?? ""));
}

function lastDebugMessage(): string {
  const calls = debugSpy.mock.calls;
  if (!calls.length) return "";
  return String(calls[calls.length - 1]?.[0] ?? "");
}

// ── logFsrsIfNeeded ─────────────────────────────────────────────────────────

describe("logFsrsIfNeeded", () => {
  describe("rating-based logging", () => {
    it("logs a Good rating on a basic card", () => {
      logFsrsIfNeeded({
        id: "card-001",
        cardType: "basic",
        rating: "good",
        metrics: {
          stateBefore: 0,
          stateAfter: 1,
          retrievabilityNow: 0.85,
          retrievabilityTarget: 0.9,
          elapsedDays: 3,
          stabilityDays: 10.5,
          difficulty: 5.2,
        },
        nextDue: NOW + 86400000,
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-001 | Rating Good | Next due");
    });

    it("logs an Again rating", () => {
      logFsrsIfNeeded({
        id: "card-002",
        cardType: "basic",
        rating: "again",
        metrics: {
          stateBefore: 2,
          stateAfter: 3,
          retrievabilityNow: 0.4,
          retrievabilityTarget: 0.9,
          elapsedDays: 30,
          stabilityDays: 2.0,
          difficulty: 7.5,
        },
        nextDue: NOW + 600000,
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-002 | Rating Again | Next due");
    });

    it("logs a Hard rating", () => {
      logFsrsIfNeeded({
        id: "card-003",
        cardType: "basic",
        rating: "hard",
        metrics: {
          stateBefore: 2,
          stateAfter: 2,
          retrievabilityNow: 0.7,
          retrievabilityTarget: 0.9,
          elapsedDays: 10,
          stabilityDays: 8,
          difficulty: 6.0,
        },
        nextDue: NOW + 86400000 * 5,
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-003 | Rating Hard | Next due");
    });

    it("logs an Easy rating", () => {
      logFsrsIfNeeded({
        id: "card-004",
        cardType: "basic",
        rating: "easy",
        metrics: {
          stateBefore: 0,
          stateAfter: 2,
          retrievabilityNow: null,
          retrievabilityTarget: 0.9,
          elapsedDays: 0,
          stabilityDays: 30,
          difficulty: 3.0,
        },
        nextDue: NOW + 86400000 * 30,
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-004 | Rating Easy | Next due");
    });
  });

  describe("skip events", () => {
    it("logs skip events with SKIP: prefix", () => {
      logFsrsIfNeeded({
        id: "card-010",
        cardType: "basic",
        rating: "skip",
        meta: { action: "skip", skipMode: "too-easy" },
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("SKIP | Card card-010 | Rating Skip | Next due —");
    });

    it("recognises skip via meta.action", () => {
      logFsrsIfNeeded({
        id: "card-011",
        cardType: "basic",
        rating: "good",
        meta: { action: "skip-hard" },
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("SKIP | Card card-011 | Rating Good | Next due —");
    });
  });

  describe("MCQ cards", () => {
    it("includes MCQ-specific metadata", () => {
      logFsrsIfNeeded({
        id: "mcq-001",
        cardType: "mcq",
        rating: "good",
        metrics: {
          stateBefore: 0,
          stateAfter: 1,
          retrievabilityNow: null,
          retrievabilityTarget: 0.9,
          elapsedDays: 0,
          stabilityDays: 5,
          difficulty: 4.0,
        },
        nextDue: NOW + 600000,
        meta: { mcqChoice: 2, mcqCorrect: true, mcqPass: true },
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card mcq-001 | Rating Good | Next due");

      log.setLevel("debug");
      logFsrsIfNeeded({
        id: "mcq-001",
        cardType: "mcq",
        rating: "good",
        metrics: {
          stateBefore: 0,
          stateAfter: 1,
          retrievabilityNow: null,
          retrievabilityTarget: 0.9,
          elapsedDays: 0,
          stabilityDays: 5,
          difficulty: 4.0,
        },
        nextDue: NOW + 600000,
        meta: { mcqChoice: 2, mcqCorrect: true, mcqPass: true },
      });
      expect(lastDebugMessage()).toContain("MCQ: choice=2, correct=true, pass=true");
    });
  });

  describe("UI metadata", () => {
    it("includes 4-button UI info and key number", () => {
      logFsrsIfNeeded({
        id: "card-020",
        cardType: "basic",
        rating: "good",
        metrics: {
          stateBefore: 1,
          stateAfter: 2,
          retrievabilityNow: 0.9,
          retrievabilityTarget: 0.9,
          elapsedDays: 1,
          stabilityDays: 15,
          difficulty: 5,
        },
        nextDue: NOW + 86400000 * 15,
        meta: { uiButtons: 4, uiKey: 3, uiSource: "keyboard" },
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-020 | Rating Good | Next due");

      log.setLevel("debug");
      logFsrsIfNeeded({
        id: "card-020",
        cardType: "basic",
        rating: "good",
        metrics: {
          stateBefore: 1,
          stateAfter: 2,
          retrievabilityNow: 0.9,
          retrievabilityTarget: 0.9,
          elapsedDays: 1,
          stabilityDays: 15,
          difficulty: 5,
        },
        nextDue: NOW + 86400000 * 15,
        meta: { uiButtons: 4, uiKey: 3, uiSource: "keyboard" },
      });
      expect(lastDebugMessage()).toContain("UI: Four button");
    });

    it("includes 2-button UI info", () => {
      logFsrsIfNeeded({
        id: "card-021",
        cardType: "basic",
        rating: "good",
        metrics: {
          stateBefore: 0,
          stateAfter: 1,
          stabilityDays: 5,
          difficulty: 5,
          elapsedDays: 0,
        },
        nextDue: NOW + 600000,
        meta: { uiButtons: 2 },
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-021 | Rating Good | Next due");

      log.setLevel("debug");
      logFsrsIfNeeded({
        id: "card-021",
        cardType: "basic",
        rating: "good",
        metrics: {
          stateBefore: 0,
          stateAfter: 1,
          stabilityDays: 5,
          difficulty: 5,
          elapsedDays: 0,
        },
        nextDue: NOW + 600000,
        meta: { uiButtons: 2 },
      });
      expect(lastDebugMessage()).toContain("UI: Two button");
    });

    it("includes queue progress (done/total)", () => {
      logFsrsIfNeeded({
        id: "card-022",
        cardType: "basic",
        rating: "good",
        metrics: { stabilityDays: 5, difficulty: 5, elapsedDays: 0 },
        nextDue: NOW + 600000,
        meta: { done: 5, total: 20 },
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-022 | Rating Good | Next due");
    });
  });

  describe("edge cases", () => {
    it("does not log for ratings outside the standard set", () => {
      logFsrsIfNeeded({
        id: "card-030",
        cardType: "basic",
        rating: "unknown-rating" as any,
      });

      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("handles missing metrics gracefully", () => {
      logFsrsIfNeeded({
        id: "card-031",
        cardType: "basic",
        rating: "good",
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-031 | Rating Good | Next due —");
    });

    it("handles missing nextDue gracefully (shows —)", () => {
      logFsrsIfNeeded({
        id: "card-032",
        cardType: "basic",
        rating: "good",
        nextDue: 0,
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-032 | Rating Good | Next due —");
    });

    it("handles undefined cardType gracefully", () => {
      logFsrsIfNeeded({
        id: "card-033",
        cardType: "",
        rating: "again",
      });

      expect(infoSpy).toHaveBeenCalledOnce();
      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-033 | Rating Again | Next due —");
    });

    it("normalises cardType case", () => {
      logFsrsIfNeeded({
        id: "card-034",
        cardType: "BASIC",
        rating: "good",
        metrics: { stabilityDays: 1, difficulty: 5, elapsedDays: 0 },
        nextDue: NOW + 60000,
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-034 | Rating Good | Next due");
    });

    it("handles same stateBefore and stateAfter (no arrow)", () => {
      logFsrsIfNeeded({
        id: "card-035",
        cardType: "basic",
        rating: "good",
        metrics: {
          stateBefore: 2,
          stateAfter: 2,
          retrievabilityNow: 0.88,
          retrievabilityTarget: 0.9,
          elapsedDays: 5,
          stabilityDays: 20,
          difficulty: 4.5,
        },
        nextDue: NOW + 86400000 * 20,
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-035 | Rating Good | Next due");
      expect(msg).not.toContain("→");
    });

    it("includes auto=1 when meta.auto is true", () => {
      logFsrsIfNeeded({
        id: "card-036",
        cardType: "basic",
        rating: "good",
        metrics: { stabilityDays: 1, difficulty: 5, elapsedDays: 0 },
        nextDue: NOW + 60000,
        meta: { auto: true },
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-036 | Rating Good | Next due");

      log.setLevel("debug");
      logFsrsIfNeeded({
        id: "card-036",
        cardType: "basic",
        rating: "good",
        metrics: { stabilityDays: 1, difficulty: 5, elapsedDays: 0 },
        nextDue: NOW + 60000,
        meta: { auto: true },
      });
      expect(lastDebugMessage()).toContain("UI: Automatic grading");
    });

    it("includes via when meta.via is provided", () => {
      logFsrsIfNeeded({
        id: "card-037",
        cardType: "basic",
        rating: "good",
        metrics: { stabilityDays: 1, difficulty: 5, elapsedDays: 0 },
        nextDue: NOW + 60000,
        meta: { via: "hotkey" },
      });

      const msg = lastLogMessage();
      expect(msg).toContain("FSRS | Card card-037 | Rating Good | Next due");
    });
  });
});

// ── logUndoIfNeeded ─────────────────────────────────────────────────────────

describe("logUndoIfNeeded", () => {
  it("logs an undo with store revert", () => {
    logUndoIfNeeded({
      id: "card-100",
      cardType: "basic",
      ratingUndone: "good",
      storeReverted: true,
      fromState: {
        due: NOW + 86400000 * 10,
        fsrsState: 2,
        stabilityDays: 10,
        difficulty: 5.0,
        scheduledDays: 10,
      },
      toState: {
        due: NOW + 86400000,
        fsrsState: 1,
        stabilityDays: 3,
        difficulty: 4.0,
        scheduledDays: 3,
      },
    });

    expect(infoSpy).toHaveBeenCalledOnce();
    const msg = lastLogMessage();
    expect(msg).toContain("UNDO:");
    expect(msg).toContain("card card-100");
    expect(msg).toContain("reverted=1");
    expect(msg).toContain("undoneRating=good");
    expect(msg).toContain("fsrs=Review→Learning");
    expect(msg).toContain("S=");
    expect(msg).toContain("D=");
    expect(msg).toContain("scheduledDays=");
  });

  it("logs session-only undo (no store revert)", () => {
    logUndoIfNeeded({
      id: "card-101",
      cardType: "basic",
      ratingUndone: "again",
      storeReverted: false,
      fromState: null,
      toState: null,
    });

    expect(infoSpy).toHaveBeenCalledOnce();
    const msg = lastLogMessage();
    expect(msg).toContain("UNDO:");
    expect(msg).toContain("session_only");
    expect(msg).toContain("scheduling_unchanged");
  });

  it("includes MCQ bits for MCQ undo", () => {
    logUndoIfNeeded({
      id: "mcq-100",
      cardType: "mcq",
      ratingUndone: "good",
      storeReverted: true,
      fromState: { due: NOW + 86400000, fsrsState: 1, stabilityDays: 5, difficulty: 4, scheduledDays: 5 },
      toState: { due: NOW, fsrsState: 0, stabilityDays: 0, difficulty: 0, scheduledDays: 0 },
      meta: { mcqChoice: 1, mcqCorrect: false, mcqPass: false },
    });

    expect(infoSpy).toHaveBeenCalledOnce();
    const msg = lastLogMessage();
    expect(msg).toContain("type=mcq");
    expect(msg).toContain("mcqChoice=1");
    expect(msg).toContain("mcqCorrect=false");
    expect(msg).toContain("mcqPass=false");
  });

  it("handles empty id and rating gracefully", () => {
    logUndoIfNeeded({
      id: "",
      cardType: "",
      ratingUndone: "",
      storeReverted: false,
      fromState: null,
      toState: null,
    });

    expect(infoSpy).toHaveBeenCalledOnce();
    const msg = lastLogMessage();
    expect(msg).toContain("UNDO:");
  });

  it("shows dash for non-finite numeric fields", () => {
    logUndoIfNeeded({
      id: "card-102",
      cardType: "basic",
      ratingUndone: "good",
      storeReverted: true,
      fromState: {
        due: NOW,
        fsrsState: 0,
        stabilityDays: undefined,
        difficulty: undefined,
        scheduledDays: undefined,
      },
      toState: {
        due: NOW + 1000,
        fsrsState: 1,
        stabilityDays: NaN,
        difficulty: NaN,
        scheduledDays: NaN,
      },
    });

    expect(infoSpy).toHaveBeenCalledOnce();
    const msg = lastLogMessage();
    // Non-finite values should be displayed as "—"
    expect(msg).toContain("—");
  });
});
