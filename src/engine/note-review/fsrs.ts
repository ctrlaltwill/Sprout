/**
 * @file src/engine/note-review/fsrs.ts
 * @summary Module for fsrs.
 *
 * @exports
 *  - defaultFsrsNoteRow
 *  - gradeNoteFsrs
 *  - gradeNoteFsrsPass
 */

import { State } from "ts-fsrs";
import { gradeFromPassFail } from "../scheduler/scheduler";
import type { SchedulerSettings } from "../../platform/types/scheduler";
import type { NoteReviewRow } from "../../platform/core/note-review-sqlite";

type FsrsGradeConfig = { scheduling: SchedulerSettings };
type FsrsOutcome = "pass" | "fail";

function coerceFsrsState(value: number | null | undefined): State {
  if (value === State.New || value === State.Learning || value === State.Review || value === State.Relearning) {
    return value;
  }
  return State.New;
}

export function defaultFsrsNoteRow(noteId: string, now: number): NoteReviewRow {
  return {
    note_id: noteId,
    step_index: 0,
    last_review_time: null,
    next_review_time: now,
    weight: 1,
    buried_until: null,
    reps: 0,
    lapses: 0,
    learning_step_index: 0,
    scheduled_days: 0,
    stability_days: null,
    difficulty: null,
    fsrs_state: State.New,
    suspended_due: null,
  };
}

export function gradeNoteFsrs(
  row: NoteReviewRow,
  now: number,
  config: FsrsGradeConfig,
  outcome: FsrsOutcome,
): NoteReviewRow {
  const current: {
    id: string;
    stage: "new" | "learning" | "review" | "relearning" | "suspended";
    due: number;
    reps: number;
    lapses: number;
    learningStepIndex: number;
    scheduledDays: number;
    fsrsState: State;
    stabilityDays?: number;
    difficulty?: number;
    lastReviewed?: number;
    suspendedDue?: number;
  } = {
    id: row.note_id,
    stage: "suspended" as const,
    due: row.next_review_time,
    reps: Math.max(0, Math.floor(Number(row.reps ?? 0))),
    lapses: Math.max(0, Math.floor(Number(row.lapses ?? 0))),
    learningStepIndex: Math.max(0, Math.floor(Number(row.learning_step_index ?? 0))),
    scheduledDays: Math.max(0, Math.floor(Number(row.scheduled_days ?? 0))),
    fsrsState: coerceFsrsState(row.fsrs_state),
    stabilityDays: row.stability_days == null ? undefined : Number(row.stability_days),
    difficulty: row.difficulty == null ? undefined : Number(row.difficulty),
    lastReviewed: row.last_review_time == null ? undefined : Number(row.last_review_time),
    suspendedDue: row.suspended_due == null ? undefined : Number(row.suspended_due),
  };

  if (current.fsrsState !== State.New && current.stage === "suspended") {
    current.stage =
      current.fsrsState === State.Review
        ? "review"
        : current.fsrsState === State.Relearning
          ? "relearning"
          : "learning";
  } else {
    current.stage = "new";
  }

  const graded = gradeFromPassFail(current, outcome, now, config, "good").nextState;

  return {
    ...row,
    step_index: Math.max(0, Math.floor(Number(row.step_index ?? 0))),
    last_review_time: graded.lastReviewed ?? now,
    next_review_time: graded.due,
    reps: graded.reps,
    lapses: graded.lapses,
    learning_step_index: graded.learningStepIndex,
    scheduled_days: graded.scheduledDays,
    stability_days: graded.stabilityDays ?? null,
    difficulty: graded.difficulty ?? null,
    fsrs_state: graded.fsrsState ?? State.New,
    suspended_due: graded.suspendedDue ?? null,
    buried_until: null,
  };
}

export function gradeNoteFsrsPass(
  row: NoteReviewRow,
  now: number,
  config: FsrsGradeConfig,
): NoteReviewRow {
  return gradeNoteFsrs(row, now, config, "pass");
}
