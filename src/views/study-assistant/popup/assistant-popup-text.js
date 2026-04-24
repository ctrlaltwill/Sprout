/**
 * @file src/views/study-assistant/popup/assistant-popup-text.ts
 * @summary Module for assistant popup text.
 *
 * @exports
 *  - trimLine
 *  - trimList
 *  - formatInsertBlock
 */
import { safeText } from "./assistant-popup-helpers";
export function trimLine(value) {
    return safeText(value).replace(/\s+/g, " ").trim();
}
export function trimList(values) {
    return values.map((v) => trimLine(v)).filter(Boolean);
}
export function formatInsertBlock(text) {
    return `${String(text || "").replace(/\s+$/g, "")}\n\n`;
}
