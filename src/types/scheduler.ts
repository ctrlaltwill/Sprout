/**
 * @file src/types/scheduler.ts
 * @summary Scheduler type definitions for the FSRS-based spaced-repetition engine. Defines
 * the card lifecycle stages, mutable per-card scheduling state (CardState), scheduler
 * settings, four-button rating values, and the GradeResult returned after grading a card.
 *
 * @exports
 *   - CardStage — union type of card lifecycle stages (new, learning, review, relearning, suspended)
 *   - CardState — mutable scheduling state for a single card
 *   - SchedulerSettings — FSRS scheduler configuration (steps, retention target)
 *   - ReviewRating — four-button rating values (again, hard, good, easy)
 *   - GradeResult — result returned by the scheduler after grading, including next state and metrics
 */

import type { State as FsrsState } from "ts-fsrs";

/** Lifecycle stage a card can be in. */
export type CardStage = "new" | "learning" | "review" | "relearning" | "suspended";

/**
 * Mutable scheduling state for a single card.
 *
 * Updated by the FSRS scheduler whenever a card is graded.
 * Persisted in `StoreData.states`.
 */
export type CardState = {
  id: string;
  stage: CardStage;

  /** Next due timestamp (epoch ms). */
  due: number;

  /** Total number of reviews. */
  reps: number;
  /** Number of times the card lapsed back to learning. */
  lapses: number;
  /** Current position in the learning/relearning step sequence. */
  learningStepIndex: number;

  // ── FSRS memory model ─────────────────────────────────────────────────
  stabilityDays?: number;
  difficulty?: number;
  lastReviewed?: number;

  /** FSRS scheduled interval in days (ts-fsrs `card.scheduled_days`). */
  scheduledDays: number;

  /** FSRS state-machine value (New / Learning / Review / Relearning). */
  fsrsState?: FsrsState;

  // ── Suspension bookkeeping ────────────────────────────────────────────
  /** Original `due` value stored when the card is suspended, so unsuspend can restore it. */
  suspendedDue?: number;

  // ── Sibling burying ───────────────────────────────────────────────────
  /** Epoch ms. When set and > now, the card is temporarily buried and excluded from sessions. */
  buriedUntil?: number;
};

/**
 * Settings that control the FSRS scheduler behaviour.
 * Stored inside `SproutSettings.scheduler`.
 */
export type SchedulerSettings = {
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
  /** Target recall probability at review time (e.g. 0.90). */
  requestRetention: number;
};

/** Four-button rating values used by the reviewer UI. */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/**
 * Result returned by the scheduler after grading a card.
 * Contains the next state to persist plus diagnostic metrics.
 */
export type GradeResult = {
  nextState: CardState;
  prevDue: number;
  nextDue: number;
  metrics: {
    retrievabilityNow: number | null;
    retrievabilityTarget: number | null;
    elapsedDays: number;
    stabilityDays: number;
    difficulty: number;
    /** FSRS state enum before grading. */
    stateBefore: FsrsState;
    /** FSRS state enum after grading. */
    stateAfter: FsrsState;
  };
};
