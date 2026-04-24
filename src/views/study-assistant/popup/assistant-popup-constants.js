/**
 * @file src/views/study-assistant/popup/assistant-popup-constants.ts
 * @summary Module for assistant popup constants.
 *
 * @exports
 *  - ASSISTANT_MODES
 *  - ASSISTANT_REVIEW_DEPTHS
 *  - isAssistantReviewDepth
 *  - CHAT_LOG_SYNC_EVENT_NAME
 */
export const ASSISTANT_MODES = ["assistant", "review", "generate"];
export const ASSISTANT_REVIEW_DEPTHS = [
    "quick",
    "standard",
    "comprehensive",
];
export function isAssistantReviewDepth(value) {
    return typeof value === "string" && ASSISTANT_REVIEW_DEPTHS.includes(value);
}
export const CHAT_LOG_SYNC_EVENT_NAME = "sprout-study-assistant-chatlog-synced";
