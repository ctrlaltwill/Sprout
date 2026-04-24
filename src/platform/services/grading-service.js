/**
 * @file src/platform/services/grading-service.ts
 * @summary Canonical grading workflow: runs the FSRS scheduler, persists the
 *   resulting state, review-log entry and analytics event to the store in one
 *   atomic sequence. Callers supply timing, scope and metadata; this module
 *   owns the mutation order so it cannot diverge across surfaces.
 *
 * @exports
 *   - GradeCardArgs  — input bag for gradeCard
 *   - GradeCardResult — output bag returned after a successful grade
 *   - gradeCard      — persist one scheduled card review
 */
import { gradeFromRating } from "../../engine/scheduler/scheduler";
/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */
/**
 * Persist one scheduled card review.
 *
 * Mutation order (must stay stable):
 *   1. Run FSRS scheduler → compute next state.
 *   2. `store.upsertState`
 *   3. `store.appendReviewLog`
 *   4. `store.appendAnalyticsReview`
 *   5. `store.persist()`
 *
 * The caller is responsible for:
 *   - guard checks (practice mode, already-graded, etc.)
 *   - undo-frame construction (captures `prevState` before calling us)
 *   - session bookkeeping (graded map, stats, UI state)
 *   - optional side-effects (FSRS debug logging, coach progress)
 */
export async function gradeCard(args) {
    const { id, cardType, rating, now, prevState, settings, store, msToAnswer, scope, meta, } = args;
    // 1. Schedule
    const { nextState, prevDue, nextDue, metrics } = gradeFromRating(prevState, rating, now, settings);
    // 2. State
    store.upsertState(nextState);
    // 3. Review log
    store.appendReviewLog({
        id,
        at: now,
        result: rating,
        prevDue,
        nextDue,
        meta: meta || null,
    });
    // 4. Analytics
    if (typeof store.appendAnalyticsReview === "function") {
        store.appendAnalyticsReview({
            at: now,
            cardId: id,
            cardType,
            result: rating,
            mode: "scheduled",
            msToAnswer,
            prevDue,
            nextDue,
            scope,
            meta: meta || undefined,
        });
    }
    // 5. Persist
    await store.persist();
    return { nextState, prevDue, nextDue, metrics };
}
