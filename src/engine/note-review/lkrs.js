/**
 * @file src/engine/note-review/lkrs.ts
 * @summary Module for lkrs.
 *
 * @exports
 *  - LkrsSettings
 *  - LkrsNoteState
 *  - computeLkrsLoadFactor
 *  - scaleLkrsIntervalDays
 *  - initialLkrsDueTime
 *  - reviewWithLkrs
 */
import { MS_DAY } from "../../platform/core/constants";
function avg(values) {
    if (!values.length)
        return 1;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}
function clampMinOne(n) {
    return Number.isFinite(n) && n > 1 ? n : 1;
}
export function computeLkrsLoadFactor(totalActiveNotes, settings) {
    const steps = settings.reviewStepsDays.length ? settings.reviewStepsDays : [1, 7, 30, 365];
    const reviewsPerDay = Math.max(1, Math.floor(settings.reviewsPerDay || 1));
    const meanInterval = avg(steps);
    const idealDailyReviews = totalActiveNotes / Math.max(1, meanInterval);
    return clampMinOne(idealDailyReviews / reviewsPerDay);
}
export function scaleLkrsIntervalDays(stepIntervalDays, loadFactor) {
    return Math.max(1, stepIntervalDays * clampMinOne(loadFactor));
}
export function initialLkrsDueTime(noteId, now, stepIntervalDays, loadFactor) {
    const scaled = scaleLkrsIntervalDays(stepIntervalDays, loadFactor);
    const phaseDays = hashToUnitInterval(noteId) * scaled;
    return now + phaseDays * MS_DAY;
}
export function reviewWithLkrs(state, now, settings, totalActiveNotes, rng = Math.random) {
    const steps = settings.reviewStepsDays.length ? settings.reviewStepsDays : [1, 7, 30, 365];
    const loadFactor = computeLkrsLoadFactor(totalActiveNotes, settings);
    const nextStepIndex = Math.min(state.stepIndex + 1, steps.length - 1);
    const baseDays = scaleLkrsIntervalDays(steps[nextStepIndex], loadFactor);
    const jitter = 0.9 + Math.max(0, Math.min(1, rng())) * 0.2;
    const intervalDays = Math.max(1, baseDays * jitter);
    return {
        ...state,
        stepIndex: nextStepIndex,
        lastReviewTime: now,
        nextReviewTime: now + intervalDays * MS_DAY,
    };
}
function hashToUnitInterval(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    const u32 = hash >>> 0;
    return u32 / 4294967295;
}
