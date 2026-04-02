/**
 * @file tests/note-review-fsrs.test.ts
 * @summary Unit tests for note review fsrs.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { defaultFsrsNoteRow, gradeNoteFsrsPass } from "../src/engine/note-review/fsrs";

const NOW = new Date("2026-04-01T10:00:00Z").getTime();

const SCHEDULING = {
  scheduling: {
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    requestRetention: 0.9,
  },
};

describe("note-review fsrs grading", () => {
  it("creates a default fsrs row for new notes", () => {
    const row = defaultFsrsNoteRow("note-a", NOW);
    expect(row.note_id).toBe("note-a");
    expect(row.fsrs_state).toBe(State.New);
    expect(row.reps).toBe(0);
    expect(row.next_review_time).toBe(NOW);
  });

  it("advances note state on pass and persists fsrs fields", () => {
    const row = defaultFsrsNoteRow("note-b", NOW);
    const next = gradeNoteFsrsPass(row, NOW, SCHEDULING);

    expect(next.next_review_time).toBeGreaterThan(NOW);
    expect(next.last_review_time).not.toBeNull();
    expect(next.reps).toBeGreaterThanOrEqual(1);
    expect(next.fsrs_state).not.toBe(State.New);
    expect(next.scheduled_days).toBeGreaterThanOrEqual(0);
  });

  it("continues progression from persisted review state", () => {
    const row = {
      ...defaultFsrsNoteRow("note-c", NOW),
      fsrs_state: State.Review,
      reps: 6,
      lapses: 1,
      learning_step_index: 0,
      scheduled_days: 8,
      stability_days: 9.5,
      difficulty: 5.5,
      last_review_time: NOW - 8 * 24 * 60 * 60 * 1000,
      next_review_time: NOW,
    };

    const next = gradeNoteFsrsPass(row, NOW, SCHEDULING);

    expect(next.reps).toBeGreaterThan(row.reps);
    expect(next.next_review_time).toBeGreaterThan(NOW);
    expect(next.fsrs_state).toBe(State.Review);
  });
});
