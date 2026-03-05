function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normaliseReminderIntervalMinutes(value: unknown, fallback = 30): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.round(clamp(raw, 1, 1440));
}

export function minutesToMs(minutes: number): number {
  return Math.max(1 * 60_000, Math.round(minutes) * 60_000);
}
