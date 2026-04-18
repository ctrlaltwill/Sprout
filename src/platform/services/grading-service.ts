/**
 * @file src/platform/services/grading-service.ts
 * @summary Canonical grading workflow: runs the FSRS scheduler, persists the
 *   resulting state, review-log entry and analytics event to the store in one
 *   atomic sequence. Callers supply timing, scope and metadata; this module
 *   owns the mutation order so it cannot diverge across surfaces.
 *
 * @exports
 *   - GradeCardArgs  — input bag for gradeCard
 *   - GradeCardResult — output bag returned after a successful grade
 *   - gradeCard      — persist one scheduled card review
 */

import { gradeFromRating } from "../../engine/scheduler/scheduler";
import type { IStore } from "../core/store-interface";
import type { CardState, ReviewRating, GradeResult } from "../types/scheduler";
import type { Scope } from "../../views/reviewer/types";
import type { LearnKitSettings } from "../core/constants";

/* ------------------------------------------------------------------ */
/*  Public contract                                                    */
/* ------------------------------------------------------------------ */

export type GradeCardArgs = {
  /** Card ID. */
  id: string;
  /** Card type string ("basic", "cloze-child", etc.). */
  cardType: string;
  /** FSRS rating chosen by the user. */
  rating: ReviewRating;
  /** Epoch ms when the grade was issued. */
  now: number;
  /** Current scheduling state (must already exist in the store). */
  prevState: CardState;
  /** Active plugin settings (passed through to the scheduler). */
  settings: LearnKitSettings;
  /** Store instance to mutate and persist. */
  store: IStore;

  // ── Optional caller-specific fields ──────────────────────────────────

  /** Approximate time-to-answer in ms. */
  msToAnswer?: number;
  /** Scope captured at review time (reviewer only). */
  scope?: Scope;
  /** Freeform metadata (via, gatekeeper, mcq details, etc.). */
  meta?: Record<string, unknown> | null;
};

export type GradeCardResult = {
  /** The new state written to the store. */
  nextState: CardState;
  /** Previous due timestamp (for review-log / analytics). */
  prevDue: number;
  /** Next due timestamp. */
  nextDue: number;
  /** FSRS metrics returned by the scheduler (stability, difficulty, …). */
  metrics: GradeResult["metrics"];
};

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Persist one scheduled card review.
 *
 * Mutation order (must stay stable):
 *   1. Run FSRS scheduler → compute next state.
 *   2. `store.upsertState`
 *   3. `store.appendReviewLog`
 *   4. `store.appendAnalyticsReview`
 *   5. `store.persist()`
 *
 * The caller is responsible for:
 *   - guard checks (practice mode, already-graded, etc.)
 *   - undo-frame construction (captures `prevState` before calling us)
 *   - session bookkeeping (graded map, stats, UI state)
 *   - optional side-effects (FSRS debug logging, coach progress)
 */
export async function gradeCard(args: GradeCardArgs): Promise<GradeCardResult> {
  const {
    id,
    cardType,
    rating,
    now,
    prevState,
    settings,
    store,
    msToAnswer,
    scope,
    meta,
  } = args;

  // 1. Schedule
  const { nextState, prevDue, nextDue, metrics } = gradeFromRating(
    prevState,
    rating,
    now,
    settings,
  );

  // 2. State
  store.upsertState(nextState);

  // 3. Review log
  store.appendReviewLog({
    id,
    at: now,
    result: rating,
    prevDue,
    nextDue,
    meta: meta || null,
  });

  // 4. Analytics
  if (typeof store.appendAnalyticsReview === "function") {
    store.appendAnalyticsReview({
      at: now,
      cardId: id,
      cardType,
      result: rating,
      mode: "scheduled",
      msToAnswer,
      prevDue,
      nextDue,
      scope,
      meta: meta || undefined,
    });
  }

  // 5. Persist
  await store.persist();

  return { nextState, prevDue, nextDue, metrics };
}
