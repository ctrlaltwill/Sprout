/**
 * @file src/platform/services/undo-service.ts
 * @summary Canonical undo-review workflow: reverts the store mutations made by
 *   a single gradeCard call — restores previous card state, truncates the
 *   review log, truncates analytics events, and persists. Callers own the undo
 *   stack, session bookkeeping, and re-render decisions.
 *
 * @exports
 *   - UndoGradeArgs  — input bag for undoGrade
 *   - undoGrade      — revert one persisted review
 */
import { deepClone } from "../../views/reviewer/utilities";
/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */
/**
 * Revert one persisted review.
 *
 * Mutation order (must stay stable):
 *   1. Snapshot current state (for FSRS undo logging by caller).
 *   2. Restore previous scheduling state via `upsertState`.
 *   3. Truncate review log to pre-grade length.
 *   4. Truncate analytics events to pre-grade length.
 *   5. `store.persist()`
 *
 * The caller is responsible for:
 *   - undo-stack management (pop, session-stamp validation)
 *   - session bookkeeping (graded map, stats, index)
 *   - FSRS debug logging (via returned fromState/toState)
 *   - UI re-render
 */
export async function undoGrade(args) {
    const { id, prevState, reviewLogLenBefore, analyticsLenBefore, storeMutated, analyticsMutated, store, } = args;
    const needPersist = storeMutated || analyticsMutated;
    let fromState = null;
    let toState = null;
    // 1. Snapshot current (graded) state before reverting
    if (storeMutated) {
        fromState = deepClone(store.getState(id));
    }
    // 2. Restore previous scheduling state
    if (storeMutated && prevState) {
        store.upsertState(deepClone(prevState));
    }
    // 3. Truncate review log
    if (storeMutated) {
        store.truncateReviewLog(reviewLogLenBefore);
    }
    // 4. Truncate analytics events
    if (analyticsMutated) {
        store.truncateAnalyticsEvents(analyticsLenBefore);
    }
    // 5. Persist
    if (needPersist) {
        await store.persist();
    }
    // Capture restored state for caller's debug logging
    if (storeMutated) {
        toState = store.getState(id);
    }
    return { fromState, toState };
}
