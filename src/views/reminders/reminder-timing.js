/**
 * @file src/views/reminders/reminder-timing.ts
 * @summary Module for reminder timing.
 *
 * @exports
 *  - normaliseReminderIntervalMinutes
 *  - minutesToMs
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function normaliseReminderIntervalMinutes(value, fallback = 30) {
    const raw = Number(value);
    if (!Number.isFinite(raw))
        return fallback;
    return Math.round(clamp(raw, 1, 1440));
}
export function minutesToMs(minutes) {
    return Math.max(1 * 60000, Math.round(minutes) * 60000);
}
