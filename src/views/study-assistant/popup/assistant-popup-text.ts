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

export function trimLine(value: unknown): string {
  return safeText(value).replace(/\s+/g, " ").trim();
}

export function trimList(values: unknown[]): string[] {
  return values.map((v) => trimLine(v)).filter(Boolean);
}

export function formatInsertBlock(text: string): string {
  return `${String(text || "").replace(/\s+$/g, "")}\n\n`;
}
