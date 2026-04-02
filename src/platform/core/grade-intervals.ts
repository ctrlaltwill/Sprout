/**
 * @file src/platform/core/grade-intervals.ts
 * @summary Module for grade intervals.
 *
 * @exports
 *  - formatCompactInterval
 *  - getRatingIntervalPreview
 */

import { gradeFromRating } from "../../engine/scheduler/scheduler";
import type { SchedulerSettings, CardState, ReviewRating } from "../types/scheduler";

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

function formatDaysWithHalfStep(days: number): string {
  const roundedHalf = Math.max(0.5, Math.round(days * 2) / 2);
  const asText = Number.isInteger(roundedHalf) ? String(roundedHalf) : roundedHalf.toFixed(1);
  return `${asText}d`;
}

/**
 * Formats a review interval using compact units similar to Anki's grade hints.
 */
export function formatCompactInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "<1m";

  if (ms < MS_HOUR) {
    const minutes = Math.max(1, Math.round(ms / MS_MINUTE));
    return `${minutes}m`;
  }

  if (ms < MS_DAY) {
    const hours = Math.max(1, Math.round(ms / MS_HOUR));
    return `${hours}h`;
  }

  const days = ms / MS_DAY;
  if (days < 10) return formatDaysWithHalfStep(days);
  if (days < 365) return `${Math.max(1, Math.round(days))}d`;

  const years = Math.max(1, Math.round(days / 365));
  return `${years}y`;
}

export function getRatingIntervalPreview(args: {
  state: CardState;
  rating: ReviewRating;
  now: number;
  scheduling: SchedulerSettings;
}): string | null {
  try {
    const graded = gradeFromRating(args.state, args.rating, args.now, {
      scheduling: args.scheduling,
    });
    return formatCompactInterval(graded.nextDue - args.now);
  } catch {
    return null;
  }
}
