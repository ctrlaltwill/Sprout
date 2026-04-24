/**
 * @file src/platform/services/card-action-service.ts
 * @summary Canonical non-grade card actions (bury, suspend) for a single card
 *   within a review session. Applies the state mutation and persists. Callers
 *   own session bookkeeping, queue advancement, and re-render.
 *
 * @exports
 *   - BuryCardArgs    — input bag for buryCardAction
 *   - SuspendCardArgs — input bag for suspendCardAction
 *   - buryCardAction  — bury one card for 24 h and persist
 *   - suspendCardAction — suspend one card indefinitely and persist
 */
import { buryCard, suspendCard } from "../../engine/scheduler/scheduler";
/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */
/**
 * Bury one card for 24 hours and persist.
 *
 * Uses the scheduler's `buryCard` for state derivation so bury semantics
 * are owned in one place.
 *
 * The caller is responsible for:
 *   - guard checks (practice mode, already-graded)
 *   - session bookkeeping (graded map, stats, queue advancement)
 *   - UI re-render / navigation
 */
export async function buryCardAction(args) {
    const { prevState, now, store } = args;
    const nextState = buryCard(prevState, now);
    store.upsertState(nextState);
    await store.persist();
    return nextState;
}
/**
 * Suspend one card indefinitely and persist.
 *
 * Uses the scheduler's `suspendCard` for state derivation so suspend semantics
 * (far-future due, suspendedDue bookkeeping) are owned in one place.
 *
 * The caller is responsible for:
 *   - guard checks (practice mode, already-graded)
 *   - session bookkeeping (graded map, stats, queue advancement)
 *   - UI re-render / navigation
 */
export async function suspendCardAction(args) {
    const { prevState, now, store } = args;
    const nextState = suspendCard(prevState, now);
    store.upsertState(nextState);
    await store.persist();
    return nextState;
}
