/**
 * @file src/views/study-assistant/popup/assistant-popup-helpers.ts
 * @summary Module for assistant popup helpers.
 *
 * @exports
 *  - safeText
 */

export function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}