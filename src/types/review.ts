// src/types/review.ts
// ---------------------------------------------------------------------------
// Review outcome types — grading results and the review-log entry format.
// These are used by both the reviewer UI and the scheduler engine.
// ---------------------------------------------------------------------------

/** Possible grading outcomes. "pass"/"fail" are legacy two-button mode values. */
export type ReviewResult = "pass" | "fail" | "again" | "hard" | "good" | "easy";

/**
 * Single entry in the review log.
 * Captures what happened when a card was graded, for undo support
 * and analytics reconstruction.
 */
export type ReviewLogEntry = {
  id: string;
  at: number;
  result: ReviewResult;
  prevDue: number;
  nextDue: number;
  meta: any;
};
