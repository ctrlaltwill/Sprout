/**
 * @file src/platform/services/undo-service.ts
 * @summary Canonical undo-review workflow: reverts the store mutations made by
 *   a single gradeCard call — restores previous card state, truncates the
 *   review log, truncates analytics events, and persists. Callers own the undo
 *   stack, session bookkeeping, and re-render decisions.
 *
 * @exports
 *   - UndoGradeArgs  — input bag for undoGrade
 *   - undoGrade      — revert one persisted review
 */

import type { IStore } from "../core/store-interface";
import type { CardState } from "../types/scheduler";
import { deepClone } from "../../views/reviewer/utilities";

/* ------------------------------------------------------------------ */
/*  Public contract                                                    */
/* ------------------------------------------------------------------ */

export type UndoGradeArgs = {
  /** Card ID whose grade is being reverted. */
  id: string;
  /** The card's state snapshot taken *before* grading. `null` when only analytics were recorded (practice mode). */
  prevState: CardState | null;
  /** Length of `store.data.reviewLog` before the grade was appended. */
  reviewLogLenBefore: number;
  /** Length of `store.data.analytics.events` before the analytics event was appended. */
  analyticsLenBefore: number;
  /** Whether the grade mutated scheduling state + review log (false for practice-only grades). */
  storeMutated: boolean;
  /** Whether the grade appended an analytics event. */
  analyticsMutated: boolean;
  /** Store instance to revert and persist. */
  store: IStore;
};

export type UndoGradeResult = {
  /** State snapshot *before* revert (i.e. the "graded" state that is being rolled back). `null` when store was not mutated. */
  fromState: CardState | null;
  /** State snapshot *after* revert (i.e. what was restored). `null` when store was not mutated. */
  toState: CardState | null;
};

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Revert one persisted review.
 *
 * Mutation order (must stay stable):
 *   1. Snapshot current state (for FSRS undo logging by caller).
 *   2. Restore previous scheduling state via `upsertState`.
 *   3. Truncate review log to pre-grade length.
 *   4. Truncate analytics events to pre-grade length.
 *   5. `store.persist()`
 *
 * The caller is responsible for:
 *   - undo-stack management (pop, session-stamp validation)
 *   - session bookkeeping (graded map, stats, index)
 *   - FSRS debug logging (via returned fromState/toState)
 *   - UI re-render
 */
export async function undoGrade(args: UndoGradeArgs): Promise<UndoGradeResult> {
  const {
    id,
    prevState,
    reviewLogLenBefore,
    analyticsLenBefore,
    storeMutated,
    analyticsMutated,
    store,
  } = args;

  const needPersist = storeMutated || analyticsMutated;
  let fromState: CardState | null = null;
  let toState: CardState | null = null;

  // 1. Snapshot current (graded) state before reverting
  if (storeMutated) {
    fromState = deepClone(store.getState(id));
  }

  // 2. Restore previous scheduling state
  if (storeMutated && prevState) {
    store.upsertState(deepClone(prevState));
  }

  // 3. Truncate review log
  if (storeMutated) {
    store.truncateReviewLog(reviewLogLenBefore);
  }

  // 4. Truncate analytics events
  if (analyticsMutated) {
    store.truncateAnalyticsEvents(analyticsLenBefore);
  }

  // 5. Persist
  if (needPersist) {
    await store.persist();
  }

  // Capture restored state for caller's debug logging
  if (storeMutated) {
    toState = store.getState(id);
  }

  return { fromState, toState };
}
