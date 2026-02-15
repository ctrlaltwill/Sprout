/**
 * @file src/reviewer/types.ts
 * @summary Type definitions shared across the reviewer module, including scope variants (vault, folder, note, group), the reviewer rating alias, and the Session state object used to track the active study queue.
 *
 * @exports
 *   - Scope — Discriminated union type representing the four scope variants for card filtering
 *   - Rating — Type alias for the scheduler's ReviewRating, used by the reviewer grading logic
 *   - Session — Type representing a study session's full state (queue, index, graded map, stats, options)
 */

import type { CardRecord } from "../core/store";
import type { ReviewRating } from "../types/scheduler";

export type Scope =
  | { type: "vault"; key: string; name: string }
  | { type: "folder"; key: string; name: string }
  | { type: "note"; key: string; name: string }
  | { type: "group"; key: string; name: string };

/** Reviewer rating — alias for the scheduler's ReviewRating. */
export type Rating = ReviewRating;

export type Session = {
  scope: Scope;
  queue: CardRecord[];
  index: number;
  graded: Record<string, { rating: Rating; at: number; meta?: unknown } | undefined>;
  stats: { total: number; done: number };
  /** True when running in free-practice mode (no scheduling changes). */
  practice?: boolean;
  /** Monotonic stamp used to detect stale sessions. */
  _bcStamp?: number;
  /** MCQ shuffled option order, keyed by card ID. */
  mcqOrderMap?: Record<string, number[]>;
  /** OQ shuffled step order, keyed by card ID. */
  oqOrderMap?: Record<string, number[]>;
  /** Skip counts per card ID, used by the skip feature. */
  skipCounts?: Record<string, number>;
  /** Session mode identifier. */
  mode?: string;
};
