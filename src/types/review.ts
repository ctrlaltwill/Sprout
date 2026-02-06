/**
 * @file src/types/review.ts
 * @summary Review outcome types used by both the reviewer UI and the scheduler engine.
 * Defines the grading result union (pass/fail for legacy two-button mode, again/hard/
 * good/easy for four-button mode, and skip) and the ReviewLogEntry structure that
 * captures what happened when a card was graded.
 *
 * @exports
 *   - ReviewResult — union type of all possible grading outcomes
 *   - ReviewLogEntry — type for a single entry in the review log
 */

/** Possible grading outcomes. "pass"/"fail" are legacy two-button mode values. "skip" is used when the user explicitly skips a card. */
export type ReviewResult = "pass" | "fail" | "again" | "hard" | "good" | "easy" | "skip";

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
  meta: Record<string, unknown> | null;
};
