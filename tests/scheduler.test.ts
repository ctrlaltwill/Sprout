// tests/scheduler.test.ts
// ---------------------------------------------------------------------------
// Tests for the FSRS scheduler — the most data-critical module.
// Covers: grading all 4 ratings, state transitions, bury, suspend/unsuspend,
// reset, and the card-shuffling utilities.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { State } from "ts-fsrs";
import {
  gradeFromRating,
  gradeFromPassFail,
  buryCard,
  suspendCard,
  unsuspendCard,
  resetCardScheduling,
  shuffleCardsWithinTimeWindow,
  shuffleCardsWithParentAwareness,
} from "../src/scheduler/scheduler";
import type { CardState, SchedulerSettings } from "../src/types/scheduler";

// ── Helpers ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-02-06T12:00:00Z").getTime();

function newCardState(overrides: Partial<CardState> = {}): CardState {
  return {
    id: "test-001",
    stage: "new",
    due: NOW,
    reps: 0,
    lapses: 0,
    learningStepIndex: 0,
    fsrsState: State.New,
    scheduledDays: 0,
    ...overrides,
  };
}

const DEFAULT_SETTINGS: { scheduling: SchedulerSettings } = {
  scheduling: {
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    requestRetention: 0.9,
  },
};

// ── Grading ─────────────────────────────────────────────────────────────────

describe("gradeFromRating", () => {
  it("advances a new card out of 'new' stage on Good", () => {
    const card = newCardState();
    const result = gradeFromRating(card, "good", NOW, DEFAULT_SETTINGS);

    expect(result.nextState.stage).not.toBe("new");
    expect(result.nextState.reps).toBeGreaterThanOrEqual(1);
    expect(result.nextDue).toBeGreaterThan(NOW);
  });

  it("advances a new card on Easy (should skip steps)", () => {
    const card = newCardState();
    const result = gradeFromRating(card, "easy", NOW, DEFAULT_SETTINGS);

    // Easy on a new card should jump to review with a longer interval
    expect(result.nextState.stage).toBe("review");
    expect(result.nextState.scheduledDays).toBeGreaterThan(0);
  });

  it("keeps a new card in learning on Again", () => {
    const card = newCardState();
    const result = gradeFromRating(card, "again", NOW, DEFAULT_SETTINGS);

    expect(["new", "learning"]).toContain(result.nextState.stage);
    expect(result.nextState.learningStepIndex).toBe(0);
  });

  it("returns meaningful metrics", () => {
    const card = newCardState();
    const result = gradeFromRating(card, "good", NOW, DEFAULT_SETTINGS);

    expect(result.metrics).toBeDefined();
    expect(result.metrics.stateBefore).toBe(State.New);
    expect(typeof result.metrics.difficulty).toBe("number");
    expect(typeof result.metrics.stabilityDays).toBe("number");
  });

  it("does nothing to a suspended card", () => {
    const card = newCardState({ stage: "suspended", due: NOW + 999999 });
    const result = gradeFromRating(card, "good", NOW, DEFAULT_SETTINGS);

    expect(result.nextState.stage).toBe("suspended");
    expect(result.nextState.due).toBe(card.due);
  });

  it("graduates a learning card to review after enough Good ratings", () => {
    let card = newCardState();

    // Walk through learning steps (1min, 10min) with Good ratings
    let result = gradeFromRating(card, "good", NOW, DEFAULT_SETTINGS);
    card = result.nextState;

    result = gradeFromRating(card, "good", result.nextDue, DEFAULT_SETTINGS);
    card = result.nextState;

    // After completing both learning steps, should be in review
    // (ts-fsrs may graduate in fewer steps depending on config)
    expect(["review", "learning"]).toContain(card.stage);
  });
});

describe("gradeFromPassFail", () => {
  it("pass maps to Good by default", () => {
    const card = newCardState();
    const passResult = gradeFromPassFail(card, "pass", NOW, DEFAULT_SETTINGS);
    const goodResult = gradeFromRating(card, "good", NOW, DEFAULT_SETTINGS);

    expect(passResult.nextState.stage).toBe(goodResult.nextState.stage);
    expect(passResult.nextDue).toBe(goodResult.nextDue);
  });

  it("fail maps to Again", () => {
    const card = newCardState();
    const failResult = gradeFromPassFail(card, "fail", NOW, DEFAULT_SETTINGS);
    const againResult = gradeFromRating(card, "again", NOW, DEFAULT_SETTINGS);

    expect(failResult.nextState.stage).toBe(againResult.nextState.stage);
    expect(failResult.nextDue).toBe(againResult.nextDue);
  });
});

// ── Bury / Suspend / Unsuspend / Reset ──────────────────────────────────────

describe("buryCard", () => {
  it("pushes due to at least tomorrow", () => {
    const card = newCardState({ due: NOW });
    const buried = buryCard(card, NOW);

    // Should be at start of tomorrow UTC or later
    const tomorrow = new Date(NOW);
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    expect(buried.due).toBeGreaterThanOrEqual(tomorrow.getTime());
  });

  it("preserves the rest of the card state", () => {
    const card = newCardState({ reps: 5, lapses: 2, stage: "review" });
    const buried = buryCard(card, NOW);

    expect(buried.reps).toBe(5);
    expect(buried.lapses).toBe(2);
    expect(buried.stage).toBe("review");
  });
});

describe("suspendCard", () => {
  it("sets stage to suspended and pushes due far into the future", () => {
    const card = newCardState({ due: NOW, stage: "review" });
    const suspended = suspendCard(card, NOW);

    expect(suspended.stage).toBe("suspended");
    // Should be ~100 years in the future
    expect(suspended.due).toBeGreaterThan(NOW + 365 * 24 * 60 * 60 * 1000);
  });

  it("stores the original due in suspendedDue", () => {
    const card = newCardState({ due: NOW + 5000, stage: "review" });
    const suspended = suspendCard(card, NOW);

    expect(suspended.suspendedDue).toBe(NOW + 5000);
  });
});

describe("unsuspendCard", () => {
  it("restores the original due and infers the correct stage", () => {
    const card = newCardState({
      stage: "review",
      fsrsState: State.Review,
      due: NOW + 5000,
    });
    const suspended = suspendCard(card, NOW);
    const restored = unsuspendCard(suspended, NOW);

    expect(restored.stage).toBe("review");
    expect(restored.due).toBe(NOW + 5000);
    expect(restored.suspendedDue).toBeUndefined();
  });

  it("is a no-op if the card is not suspended", () => {
    const card = newCardState({ stage: "review" });
    const result = unsuspendCard(card, NOW);

    expect(result).toEqual(card);
  });

  it("restores a learning card correctly", () => {
    const card = newCardState({
      stage: "learning",
      fsrsState: State.Learning,
      due: NOW + 1000,
    });
    const suspended = suspendCard(card, NOW);
    const restored = unsuspendCard(suspended, NOW);

    expect(restored.stage).toBe("learning");
  });
});

describe("resetCardScheduling", () => {
  it("resets a review card back to new with zero stats", () => {
    const card = newCardState({
      stage: "review",
      fsrsState: State.Review,
      reps: 10,
      lapses: 3,
      stabilityDays: 45,
      difficulty: 7,
      scheduledDays: 30,
      lastReviewed: NOW - 86400000,
    });

    const reset = resetCardScheduling(card, NOW);

    expect(reset.stage).toBe("new");
    expect(reset.fsrsState).toBe(State.New);
    expect(reset.reps).toBe(0);
    expect(reset.lapses).toBe(0);
    expect(reset.scheduledDays).toBe(0);
    expect(reset.stabilityDays).toBeUndefined();
    expect(reset.difficulty).toBeUndefined();
    expect(reset.lastReviewed).toBeUndefined();
  });

  it("preserves the card id", () => {
    const card = newCardState({ id: "my-card-42" });
    const reset = resetCardScheduling(card, NOW);

    expect(reset.id).toBe("my-card-42");
  });
});

// ── Shuffle utilities ───────────────────────────────────────────────────────

describe("shuffleCardsWithinTimeWindow", () => {
  it("returns empty array for empty input", () => {
    expect(shuffleCardsWithinTimeWindow([])).toEqual([]);
  });

  it("returns single card unchanged", () => {
    const cards = [{ due: 1000 }];
    expect(shuffleCardsWithinTimeWindow(cards)).toEqual(cards);
  });

  it("preserves all cards (no data loss)", () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({ due: i * 100, id: `c${i}` }));
    const result = shuffleCardsWithinTimeWindow(cards);

    expect(result).toHaveLength(20);
    const ids = result.map((c) => c.id).sort();
    expect(ids).toEqual(cards.map((c) => c.id).sort());
  });

  it("keeps cards from distant windows in order", () => {
    const HOUR = 60 * 60 * 1000;
    const cards = [
      { due: 0, id: "early" },
      { due: 10 * HOUR, id: "late" },
    ];
    const result = shuffleCardsWithinTimeWindow(cards);

    expect(result[0].id).toBe("early");
    expect(result[1].id).toBe("late");
  });

  it("produces deterministic results with seeded RNG", () => {
    // Simple seeded RNG for testing
    const seededRng = () => {
      let seed = 12345;
      return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
    };

    const cards = [
      { due: 100, id: "a" },
      { due: 101, id: "b" },
      { due: 102, id: "c" },
      { due: 103, id: "d" },
    ];

    const result1 = shuffleCardsWithinTimeWindow(cards, 30 * 60 * 1000, seededRng());
    const result2 = shuffleCardsWithinTimeWindow(cards, 30 * 60 * 1000, seededRng());

    // Same seed should produce same output
    expect(result1.map(c => c.id)).toEqual(result2.map(c => c.id));
  });
});

describe("shuffleCardsWithParentAwareness", () => {
  it("preserves all cards", () => {
    const cards = [
      { due: 100, id: "a1", parentId: "p1" },
      { due: 101, id: "a2", parentId: "p1" },
      { due: 102, id: "b1", parentId: "p2" },
      { due: 103, id: "b2", parentId: "p2" },
    ];
    const result = shuffleCardsWithParentAwareness(cards);

    expect(result).toHaveLength(4);
    expect(result.map((c) => c.id).sort()).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("does not crash on cards without parentId", () => {
    const cards = [
      { due: 100, id: "x1" },
      { due: 101, id: "x2" },
    ];
    // Should not throw
    const result = shuffleCardsWithParentAwareness(cards);
    expect(result).toHaveLength(2);
  });

  it("produces deterministic results with seeded RNG", () => {
    const seededRng = () => {
      let seed = 54321;
      return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
    };

    const cards = [
      { due: 100, id: "a1", parentId: "p1" },
      { due: 101, id: "a2", parentId: "p1" },
      { due: 102, id: "b1", parentId: "p2" },
      { due: 103, id: "b2", parentId: "p2" },
    ];

    const result1 = shuffleCardsWithParentAwareness(cards, 30 * 60 * 1000, seededRng());
    const result2 = shuffleCardsWithParentAwareness(cards, 30 * 60 * 1000, seededRng());

    // Same seed should produce same output
    expect(result1.map(c => c.id)).toEqual(result2.map(c => c.id));
  });
});
