/**
 * @file src/types/scheduler.ts
 * @summary Scheduler type definitions for the FSRS-based spaced-repetition engine. Defines
 * the card lifecycle stages, mutable per-card scheduling state (CardState), scheduler
 * settings, four-button rating values, and the GradeResult returned after grading a card.
 *
 * @exports
 *   - CardStage — union type of card lifecycle stages (new, learning, review, relearning, suspended)
 *   - CardState — mutable scheduling state for a single card
 *   - SchedulerSettings — FSRS scheduler configuration (steps, retention target)
 *   - ReviewRating — four-button rating values (again, hard, good, easy)
 *   - GradeResult — result returned by the scheduler after grading, including next state and metrics
 */
export {};
