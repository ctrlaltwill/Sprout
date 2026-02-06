/**
 * @file src/analytics/chart-axis-utils.ts
 * @summary Shared utility functions for computing axis tick positions and
 * formatting axis labels across multiple Recharts-based analytics charts.
 * Provides consistent Y-axis rounding and X-axis tick placement (start, mid,
 * end, today) as well as a "Today" label formatter.
 *
 * @exports
 *   - createYAxisTicks — computes evenly-spaced Y-axis tick values rounded to the nearest 100
 *   - createXAxisTicks — computes X-axis tick positions including start, midpoint, end, and today
 *   - formatAxisLabel — formats a day-index into a human-readable label, returning "Today" for the current day
 */

export function createYAxisTicks(maxValue: number): number[] {
  const positiveMax = Math.max(0, maxValue);
  const finalMax = Math.max(100, Math.ceil(positiveMax / 100) * 100);
  const half = finalMax / 2;
  const ticks = [0, half, finalMax];
  return ticks.filter((value, index, array) => index === 0 || value !== array[index - 1]);
}

export function createXAxisTicks(startIndex: number, endIndex: number, todayIndex: number): number[] {
  const values = new Set<number>();
  if (Number.isFinite(startIndex)) values.add(startIndex);
  if (Number.isFinite(endIndex)) values.add(endIndex);
  if (todayIndex >= startIndex && todayIndex <= endIndex) values.add(todayIndex);
  if (Number.isFinite(startIndex) && Number.isFinite(endIndex)) {
    const mid = Math.round((startIndex + endIndex) / 2);
    values.add(mid);
  }
  return Array.from(values).sort((a, b) => a - b);
}

export function formatAxisLabel(
  dayIndex: number,
  todayIndex: number,
  labelFormatter: (dayIndex: number) => string,
): string {
  if (dayIndex === todayIndex) return "Today";
  return labelFormatter(dayIndex);
}
