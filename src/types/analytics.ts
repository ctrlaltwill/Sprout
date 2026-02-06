// src/types/analytics.ts
// ---------------------------------------------------------------------------
// Analytics event types — structures recorded when a user reviews cards
// or completes a study session. Fed into charts, heatmaps, and KPIs.
// ---------------------------------------------------------------------------

import type { ReviewResult } from "./review";

/** Whether a review happened in scheduled mode or free-practice mode. */
export type AnalyticsMode = "scheduled" | "practice";

/**
 * Recorded when a single card is graded.
 * Contains the outcome, timing, and optional scope for filtering.
 */
export type AnalyticsReviewEvent = {
  kind: "review";
  eventId: string;

  /** Timestamp of the review. */
  at: number;

  cardId: string;
  cardType: string;

  result: ReviewResult;
  mode: AnalyticsMode;

  /** Approximate time-to-answer in ms (for heatmaps / KPIs). */
  msToAnswer?: number;

  /** Only for scheduled grading — mirrors the reviewLog entry. */
  prevDue?: number;
  nextDue?: number;

  /** Optional scope captured at review time (deck/note) for later filtering. */
  scope?: any;

  /** Freeform metadata (MCQ choice details, pass/fail etc.). */
  meta?: any;
};

/**
 * Recorded when a study session starts or ends.
 * Used for session-level analytics (duration, frequency).
 */
export type AnalyticsSessionEvent = {
  kind: "session";
  eventId: string;
  at: number;
  scope?: any;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
};

/** Discriminated union of all analytics event types. */
export type AnalyticsEvent = AnalyticsReviewEvent | AnalyticsSessionEvent;

/**
 * Top-level analytics storage structure.
 * `seq` is a monotonically-increasing ID seed for new events.
 */
export type AnalyticsData = {
  version: number;
  seq: number;
  events: AnalyticsEvent[];
};
