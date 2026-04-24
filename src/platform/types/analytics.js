/**
 * @file src/types/analytics.ts
 * @summary Analytics event type definitions. Structures recorded when a user reviews cards
 * or completes a study session, consumed by charts, heatmaps, and KPI displays. Includes
 * per-card review events, session-level events, a discriminated union of all event types,
 * and the top-level AnalyticsData storage shape.
 *
 * @exports
 *   - AnalyticsMode — type for scheduled vs practice review mode
 *   - AnalyticsReviewEvent — type for a single card-review analytics event
 *   - AnalyticsSessionEvent — type for a study-session analytics event
 *   - AnalyticsExamAttemptEvent — type for a saved exam/test attempt
 *   - AnalyticsNoteReviewEvent — type for a note-review grading/action event
 *   - AnalyticsEvent — discriminated union of all analytics event types
 *   - AnalyticsData — top-level analytics storage structure (version, seq, events)
 */
export {};
