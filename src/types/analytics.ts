/**
 * @file src/types/analytics.ts
 * @summary Analytics event type definitions. Structures recorded when a user reviews cards
 * or completes a study session, consumed by charts, heatmaps, and KPI displays. Includes
 * per-card review events, session-level events, a discriminated union of all event types,
 * and the top-level AnalyticsData storage shape.
 *
 * @exports
 *   - AnalyticsMode — type for scheduled vs practice review mode
 *   - AnalyticsReviewEvent — type for a single card-review analytics event
 *   - AnalyticsSessionEvent — type for a study-session analytics event
 *   - AnalyticsEvent — discriminated union of all analytics event types
 *   - AnalyticsData — top-level analytics storage structure (version, seq, events)
 */

import type { ReviewResult } from "./review";
import type { Scope } from "../reviewer/types";

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
  scope?: Scope;

  /** Freeform metadata (MCQ choice details, pass/fail etc.). */
  meta?: Record<string, unknown>;
};

/**
 * Recorded when a study session starts or ends.
 * Used for session-level analytics (duration, frequency).
 */
export type AnalyticsSessionEvent = {
  kind: "session";
  eventId: string;
  at: number;
  scope?: Scope;
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
