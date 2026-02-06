/**
 * @file src/reviewer/timers.ts
 * @summary Provides a human-readable countdown formatter that converts milliseconds into a friendly string (e.g. "30 secs", "5 mins", "2 hours", "3 days").
 *
 * @exports
 *   - formatCountdown — Converts a millisecond duration to a short human-readable countdown string
 */

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} secs`;

  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mins`;

  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hours`;

  const d = Math.floor(h / 24);
  return `${d} days`;
}
