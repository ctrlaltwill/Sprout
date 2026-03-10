/**
 * @file src/card-editor/card-editor.ts
 * @summary Shared card-editor factory used by modals and inline editors. Provides the core form-building logic for editing flashcard fields (title, question, answer, extra info, groups) across all card types (basic, cloze, MCQ, IO), including column-key definitions, card-type aliases, and the group-picker field builder.
 *
 * @exports
 *  - ColKey                 — type alias for column keys used in card-editor field layouts
 *  - CardType               — type alias for card type identifiers (basic, cloze, mcq, io)
 *  - CardEditorResult       — interface for the value returned by createCardEditor
 *  - createCardEditor       — builds a card-editing form with typed fields and validation
 *  - createGroupPickerField — creates a tag-picker input field for card group assignment
 */

import { Notice, Platform, setIcon } from "obsidian";
import type SproutPlugin from "../../main";
import type { CardRecord } from "../../platform/core/store";
import { normalizeCardOptions } from "../../platform/core/store";
import { getCorrectIndices } from "../../platform/types/card";
import { buildAnswerOrOptionsFor, escapePipes } from "../../views/reviewer/fields";
import { escapeDelimiterText, getDelimiter } from "../../platform/core/delimiter";
import { renderMarkdownPreviewInElement, setCssProps } from "../../platform/core/ui";
import {
  clearNode,
  titleCaseGroupPath,
  formatGroupDisplay,
  expandGroupAncestors,
  parseGroupsInput,
  groupsToInput,
} from "../../platform/core/shared-utils";

export type ColKey =
  | "id"
  | "type"
  | "stage"
  | "due"
  | "title"
  | "question"
  | "answer"
  | "info"
  | "location"
  | "groups";

export type CardType = "basic" | "reversed" | "reversed-child" | "cloze" | "mcq" | "io" | "oq";

const CLOZE_TOOLTIP =
  "Use cloze syntax to hide text in your prompt.\n{{c1::text}} creates the first blank.\nUse {{c2::text}} for a different blank, or reuse {{c1::text}} to reveal together.\nShortcuts: Cmd/Ctrl+Shift+C (new blank), Cmd/Ctrl+Shift+Alt/Option+C (same blank number).";
const FORMAT_TOOLTIP =
  "Formatting: Cmd+B (bold), Cmd+I (italic).";
const OQ_TOOLTIP =
  "Write the steps in the correct order.\nYou must have at least 2 steps.\nDrag the grip handles to reorder steps.\nSteps are shuffled during review.";
const PLACEHOLDER_TITLE = "Enter a descriptive title for this flashcard";
const PLACEHOLDER_CLOZE =
  "Type your text and wrap parts to hide with {{c1::text}}. Use {{c2::text}} for separate deletions, or {{c1::text}} again to hide together.";
const PLACEHOLDER_QUESTION = "Enter the question you want to answer";
const PLACEHOLDER_ANSWER = "Enter the answer to your question";
const PLACEHOLDER_INFO = "Optional: Add extra context or explanation shown on the back of the card";

type ClozeShortcut = "new" | "same";

const DEV_CLOZE_FLAG_KEY = "__SPROUT_DEV_SHOW_CLOZE_BUTTONS__";
const DEV_CLOZE_HELPER_KEY = "sproutDevClozeButtons";

function installDevClozeConsoleHelper() {
  const globalObj = globalThis as unknown as Record<string, unknown>;
  if (typeof globalObj[DEV_CLOZE_HELPER_KEY] === "function") return;

  const helper = (enabled?: boolean) => {
    const next = enabled ?? true;
    globalObj[DEV_CLOZE_FLAG_KEY] = Boolean(next);
    return globalObj[DEV_CLOZE_FLAG_KEY];
  };

  globalObj[DEV_CLOZE_HELPER_KEY] = helper;
}

installDevClozeConsoleHelper();

export function shouldShowMobileClozeButtons(): boolean {
  installDevClozeConsoleHelper();
  const globalObj = globalThis as unknown as Record<string, unknown>;
  const devForced = globalObj[DEV_CLOZE_FLAG_KEY] === true;
  return Platform.isMobileApp || devForced;
}

function isMacLike(): boolean {
  return Platform.isMacOS;
}

function getClozeShortcut(ev: KeyboardEvent): ClozeShortcut | null {
  const key = String(ev.key || "").toLowerCase();
  if (key !== "c" && ev.code !== "KeyC") return null;
  const primary = isMacLike() ? ev.metaKey : ev.ctrlKey;
  if (!primary || !ev.shiftKey) return null;
  return ev.altKey ? "same" : "new";
}

export function getClozeIndices(text: string): number[] {
  const out: number[] = [];
  const re = /\{\{c(\d+)::/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text))) {
    const idx = Number(match[1]);
    if (Number.isFinite(idx)) out.push(idx);
  }
  return out;
}

export function applyClozeShortcut(textarea: HTMLTextAreaElement, mode: ClozeShortcut) {
  const value = String(textarea.value ?? "");
  const start = Number.isFinite(textarea.selectionStart) ? (textarea.selectionStart) : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? (textarea.selectionEnd) : value.length;
  const indices = getClozeIndices(value);
  const maxIdx = indices.length ? Math.max(...indices) : 0;
  const lastIdx = indices.length ? indices[indices.length - 1] : maxIdx;
  const clozeIdx = mode === "same" ? (lastIdx || 1) : maxIdx + 1;

  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);

  if (selected.length > 0) {
    const wrapped = `{{c${clozeIdx}::${selected}}}`;
    textarea.value = before + wrapped + after;
    const pos = before.length + wrapped.length;
    textarea.setSelectionRange(pos, pos);
  } else {
    const token = `{{c${clozeIdx}::}}`;
    textarea.value = before + token + after;
    const pos = before.length + `{{c${clozeIdx}::`.length;
    textarea.setSelectionRange(pos, pos);
  }

  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function attachClozeShortcuts(textarea: HTMLTextAreaElement) {
  textarea.addEventListener("keydown", (ev: KeyboardEvent) => {
    const shortcut = getClozeShortcut(ev);
    if (!shortcut) return;
    ev.preventDefault();
    ev.stopPropagation();
    applyClozeShortcut(textarea, shortcut);
  });
}

export function createMobileClozeButtons(textarea: HTMLTextAreaElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "bc sprout-cloze-mobile-actions";

  const repeatBtn = document.createElement("button");
  repeatBtn.type = "button";
  repeatBtn.className = "bc btn-outline h-7 px-2 text-sm inline-flex items-center justify-center sprout-cloze-mobile-btn sprout-is-hidden";
  repeatBtn.textContent = "Repeat cloze";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "bc btn-outline h-7 px-2 text-sm inline-flex items-center justify-center sprout-cloze-mobile-btn";
  addBtn.textContent = "Add cloze";

  const refreshState = () => {
    const hasCloze = getClozeIndices(String(textarea.value ?? "")).length > 0;
    repeatBtn.classList.toggle("sprout-is-hidden", !hasCloze);
  };

  addBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    applyClozeShortcut(textarea, "new");
    textarea.focus();
    refreshState();
  });

  repeatBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    applyClozeShortcut(textarea, "same");
    textarea.focus();
    refreshState();
  });

  textarea.addEventListener("input", refreshState);
  refreshState();

  wrap.appendChild(repeatBtn);
  wrap.appendChild(addBtn);
  return wrap;
}

function remToPx(rem: number): number {
  const rootFontPx = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize || "16");
  return Math.max(1, Math.round(rem * (Number.isFinite(rootFontPx) ? rootFontPx : 16)));
}

function fieldMinHeightPx(field: "title" | "question" | "answer" | "info"): number {
  return remToPx(4.5);
}

function attachFlagPreviewOverlay(control: HTMLInputElement | HTMLTextAreaElement, minControlHeight = 38): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `bc sprout-flag-editor-wrap${control instanceof HTMLTextAreaElement ? " sprout-flag-editor-wrap--multiline" : ""}`;

  const overlay = document.createElement("div");
  overlay.className = `bc sprout-flag-editor-overlay${control instanceof HTMLTextAreaElement ? " sprout-flag-editor-overlay--multiline" : ""}`;

  control.classList.add("sprout-flag-editor-control");

  if (control instanceof HTMLTextAreaElement) {
    // Let actual content drive height instead of keeping a fixed multi-row baseline.
    control.rows = 1;
  }

  const measureControlHeight = () => {
    if (control instanceof HTMLTextAreaElement) {
      setCssProps(control, "height", "auto");
      return Math.max(minControlHeight, Math.ceil(control.scrollHeight || 0));
    }
    return Math.max(minControlHeight, Math.ceil(control.getBoundingClientRect().height || 0));
  };

  const applyControlHeight = (height: number) => {
    setCssProps(control, "min-height", `${height}px`);
    setCssProps(control, "height", `${height}px`);
    if (control instanceof HTMLInputElement) {
      setCssProps(control, "max-height", `${height}px`);
    }
  };

  let pendingSyncRaf = 0;
  let lastPreviewHeight = 0;

  const syncPreviewHeight = () => {
    const scrollbarFudgePx = 5;
    const controlHeight = measureControlHeight();
    const overlayHeight = Math.ceil(overlay.scrollHeight || 0);
    const previewHeight = Math.max(
      minControlHeight,
      controlHeight + scrollbarFudgePx,
      overlayHeight,
    );
    if (previewHeight === lastPreviewHeight) return;
    lastPreviewHeight = previewHeight;
    wrap.style.setProperty("--sprout-flag-preview-height", `${previewHeight}px`);
    applyControlHeight(previewHeight);
  };

  const queueSyncPreviewHeight = () => {
    if (pendingSyncRaf) return;
    pendingSyncRaf = window.requestAnimationFrame(() => {
      pendingSyncRaf = 0;
      syncPreviewHeight();
    });
  };

  const renderOverlay = () => {
    renderMarkdownPreviewInElement(overlay, String(control.value ?? ""));
    syncPreviewHeight();
    window.requestAnimationFrame(syncPreviewHeight);
    window.setTimeout(syncPreviewHeight, 80);
  };

  overlay.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    control.focus();
  }, true);

  overlay.addEventListener("click", () => control.focus());

  control.addEventListener("focus", () => {
    wrap.classList.add("sprout-flag-editor--focused");
    syncPreviewHeight();
  });

  control.addEventListener("blur", () => {
    wrap.classList.remove("sprout-flag-editor--focused");
    renderOverlay();
  });

  control.addEventListener("input", () => {
    syncPreviewHeight();
    if (!wrap.classList.contains("sprout-flag-editor--focused")) renderOverlay();
  });

  let ro: ResizeObserver | null = null;
  let detachObserver: MutationObserver | null = null;
  const cleanup = () => {
    if (pendingSyncRaf) {
      window.cancelAnimationFrame(pendingSyncRaf);
      pendingSyncRaf = 0;
    }
    ro?.disconnect();
    ro = null;
    detachObserver?.disconnect();
    detachObserver = null;
  };

  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      queueSyncPreviewHeight();
    });
    ro.observe(overlay);
  }

  if (document.body) {
    detachObserver = new MutationObserver(() => {
      if (!wrap.isConnected) cleanup();
    });
    detachObserver.observe(document.body, { childList: true, subtree: true });
  }

  renderOverlay();
  wrap.appendChild(control);
  wrap.appendChild(overlay);
  return wrap;
}

// ── Inline formatting shortcuts ────────────────────────────────────────────
// Wrap selected text (or insert empty markers) for standard Obsidian markdown:
//   Cmd/Ctrl+B  → **bold**
//   Cmd/Ctrl+I  → *italic*

type FormatMarker = { marker: string };

const FORMAT_SHORTCUTS: Array<{
  key: string;
  shift: boolean;
  marker: string;
}> = [
  { key: "b", shift: false, marker: "**" },
  { key: "i", shift: false, marker: "*" },
];

function getFormatShortcut(ev: KeyboardEvent): FormatMarker | null {
  const key = String(ev.key || "").toLowerCase();
  const primary = isMacLike() ? ev.metaKey : ev.ctrlKey;
  if (!primary) return null;
  for (const s of FORMAT_SHORTCUTS) {
    if (key === s.key && ev.shiftKey === s.shift) return { marker: s.marker };
  }
  return null;
}

function applyFormatShortcut(textarea: HTMLTextAreaElement, fmt: FormatMarker) {
  const value = String(textarea.value ?? "");
  const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : value.length;

  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);
  const m = fmt.marker;

  if (selected.length > 0) {
    // If already wrapped, unwrap; otherwise wrap
    if (selected.startsWith(m) && selected.endsWith(m) && selected.length > m.length * 2) {
      const unwrapped = selected.slice(m.length, -m.length);
      textarea.value = before + unwrapped + after;
      textarea.setSelectionRange(start, start + unwrapped.length);
    } else {
      const wrapped = m + selected + m;
      textarea.value = before + wrapped + after;
      textarea.setSelectionRange(start, start + wrapped.length);
    }
  } else {
    // No selection — insert empty markers and place cursor between them
    textarea.value = before + m + m + after;
    const pos = start + m.length;
    textarea.setSelectionRange(pos, pos);
  }

  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── List-marker regex helpers ──────────────────────────────────────────────
const LIST_LINE_RE = /^([\t ]*)([-+*]|\d+[.)])\s(.*)/;

/** Parse the current line under the cursor. */
function currentLineInfo(textarea: HTMLTextAreaElement) {
  const val = textarea.value;
  const pos = textarea.selectionStart;
  const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
  const lineEndIdx = val.indexOf("\n", pos);
  const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
  const line = val.slice(lineStart, lineEnd);
  const cursorCol = pos - lineStart;
  return { val, pos, lineStart, lineEnd, line, cursorCol };
}

/**
 * Handle markdown editing keys inside a textarea:
 *   Tab        → indent whole line(s) by one tab; re-number ordered lists
 *   Shift-Tab  → outdent whole line(s); re-number ordered lists
 *   Enter      → continue list with next marker (or exit list if empty)
 *   Backspace  → at start of list marker, remove it (or outdent if indented)
 *
 * Returns true if the event was handled (and should not propagate).
 */
export function handleTabInTextarea(textarea: HTMLTextAreaElement, ev: KeyboardEvent): boolean {
  // Enforce tab-only indentation for markdown lists.
  if (ev.key === " " && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    const { line, cursorCol } = currentLineInfo(textarea);
    const m = line.match(LIST_LINE_RE);
    if (m) {
      const indent = m[1];
      const markerStart = indent.length;
      const markerEnd = markerStart + m[2].length + 1;
      // Do not allow inserting spaces before or inside the list marker prefix.
      if (cursorCol <= markerEnd) {
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      }
    }
  }

  // ── Tab / Shift-Tab: whole-line indent/outdent ──
  if (ev.key === "Tab") {
    ev.preventDefault();
    ev.stopPropagation();

    const val = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // Find ALL lines that overlap the selection (or the cursor line)
    const lineStart = val.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = val.indexOf("\n", end);
    const blockEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
    const block = val.slice(lineStart, blockEnd);
    const lines = block.split("\n");

    if (ev.shiftKey) {
      // Outdent each line
      const outdented = lines.map((l) => {
        const listMatch = l.match(LIST_LINE_RE);
        if (listMatch) {
          const indent = listMatch[1];
          // At root list depth, Shift+Tab removes list marker entirely.
          if (!indent) {
            return listMatch[3] ?? "";
          }
        }
        return l.replace(/^(\t| {1,2})/, "");
      });
      const newBlock = outdented.join("\n");
      const firstLineRemoved = lines[0].length - outdented[0].length;
      const totalRemoved = block.length - newBlock.length;
      textarea.value = val.slice(0, lineStart) + newBlock + val.slice(blockEnd);
      textarea.setSelectionRange(
        Math.max(lineStart, start - firstLineRemoved),
        Math.max(lineStart, end - totalRemoved),
      );
    } else {
      // Indent each line
      const indented = lines.map(l => "\t" + l);
      const newBlock = indented.join("\n");
      textarea.value = val.slice(0, lineStart) + newBlock + val.slice(blockEnd);
      textarea.setSelectionRange(start + 1, end + lines.length);
    }

    // Re-number ordered lists after indent change
    renumberOrderedLists(textarea);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // ── Enter: list continuation ──
  if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
    const { val, pos, lineStart, line, cursorCol } = currentLineInfo(textarea);
    const m = line.match(LIST_LINE_RE);
    if (!m) return false; // not on a list line — let default Enter happen

    const [, indent, marker, content] = m;
    const markerEnd = indent.length + marker.length + 1; // position after "- " or "1. "

    // If cursor is before the marker content, let default Enter happen
    if (cursorCol < markerEnd) return false;

    ev.preventDefault();
    ev.stopPropagation();

    // If the content after the marker is empty → remove the marker (exit list)
    if (content.trim() === "") {
      // Replace this line's marker with empty line (or just the indent)
      const end = textarea.selectionEnd;
      const lineEndIdx = val.indexOf("\n", end);
      const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
      textarea.value = val.slice(0, lineStart) + val.slice(lineEnd);
      textarea.setSelectionRange(lineStart, lineStart);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    // Build next marker
    let nextMarker: string;
    if (/^\d+[.)]$/.test(marker)) {
      const num = parseInt(marker, 10);
      const suffix = marker.slice(-1); // '.' or ')'
      nextMarker = `${num + 1}${suffix}`;
    } else {
      nextMarker = marker; // -, *, +
    }

    // Split current line at cursor and insert new list item
    const beforeCursor = val.slice(0, pos);
    const afterCursor = val.slice(pos);
    const insertion = `\n${indent}${nextMarker} `;
    textarea.value = beforeCursor + insertion + afterCursor;
    const newPos = pos + insertion.length;
    textarea.setSelectionRange(newPos, newPos);

    renumberOrderedLists(textarea);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // ── Backspace: remove list marker / outdent ──
  if (ev.key === "Backspace" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
    const { val, pos, lineStart, line, cursorCol } = currentLineInfo(textarea);
    const m = line.match(LIST_LINE_RE);
    if (!m) return false; // not a list line

    const [, indent, marker] = m;
    const markerEnd = indent.length + marker.length + 1; // after "- " or "1. "

    // Only act when cursor is at the start of content (right after marker+space)
    if (cursorCol !== markerEnd) return false;

    ev.preventDefault();
    ev.stopPropagation();

    if (indent.length > 0) {
      // Outdent: remove one tab or up to 2 spaces from start
      const outdented = line.replace(/^(\t| {1,2})/, "");
      const removed = line.length - outdented.length;
      const lineEndIdx = val.indexOf("\n", pos);
      const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
      textarea.value = val.slice(0, lineStart) + outdented + val.slice(lineEnd);
      textarea.setSelectionRange(pos - removed, pos - removed);
    } else {
      // Remove list marker entirely, keep content
      const content = line.slice(markerEnd);
      const lineEndIdx = val.indexOf("\n", pos);
      const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
      textarea.value = val.slice(0, lineStart) + content + val.slice(lineEnd);
      textarea.setSelectionRange(lineStart, lineStart);
    }

    renumberOrderedLists(textarea);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
}

/**
 * Re-number ordered list items in a textarea so each independent run
 * at the same indent depth counts sequentially from 1.
 * Preserves cursor position.
 */
function renumberOrderedLists(textarea: HTMLTextAreaElement) {
  const pos = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const lines = textarea.value.split("\n");
  // Track counts per indent level; reset when broken by non-list or different indent
  const counters = new Map<string, number>();
  let prevIndent: string | null = null;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LIST_LINE_RE);
    if (!m) {
      counters.clear();
      prevIndent = null;
      continue;
    }
    const [, indent, marker, content] = m;
    // Reset deeper counters when we return to shallower indent
    if (prevIndent !== null && indent.length < prevIndent.length) {
      for (const [k] of counters) {
        if (k.length > indent.length) counters.delete(k);
      }
    }
    prevIndent = indent;

    if (/^\d+[.)]$/.test(marker)) {
      const suffix = marker.slice(-1);
      const count = (counters.get(indent) ?? 0) + 1;
      counters.set(indent, count);
      const newLine = `${indent}${count}${suffix} ${content}`;
      if (newLine !== lines[i]) {
        lines[i] = newLine;
        changed = true;
      }
    } else {
      // Unordered list — just track that this indent had items (don't number)
      // but reset ordered counter at this indent since it's now unordered
      counters.delete(indent);
    }
  }

  if (changed) {
    textarea.value = lines.join("\n");
    textarea.setSelectionRange(pos, end);
  }
}

function attachFormatShortcuts(textarea: HTMLTextAreaElement) {
  textarea.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (handleTabInTextarea(textarea, ev)) return;
    const fmt = getFormatShortcut(ev);
    if (!fmt) return;
    ev.preventDefault();
    ev.stopPropagation();
    applyFormatShortcut(textarea, fmt);
  });
}



// Delegate to shared delimiter utility
const escapePipeText = escapeDelimiterText;

interface CardEditorConfig {
  plugin: SproutPlugin;
  cards: CardRecord[];
  locationTitle?: string;
  locationPath?: string;
  showReadOnlyFields?: boolean;
  forceType?: CardType;
}

export interface CardEditorResult {
  root: HTMLElement;
  inputEls: Partial<Record<ColKey, HTMLInputElement | HTMLTextAreaElement>>;
  buildMcqValue?: () => string | null;
  getGroupInputValue: () => string;
  fields: Array<{ key: ColKey; editable: boolean }>;
  isSingleMcq: boolean;
  isSingleOq: boolean;
  mcqOriginalString?: string;
  getMcqOptions?: () => { correct: string; corrects: string[]; wrongs: string[] };
  getOqSteps?: () => string[];
}

export function createCardEditor(config: CardEditorConfig): CardEditorResult {
  const { cards, plugin } = config;
  const safeCards = Array.isArray(cards) ? cards : [];
  const normalizedTypes = safeCards.map((card) => String(card?.type ?? "").toLowerCase());
  if (!normalizedTypes.length && config.forceType) normalizedTypes.push(config.forceType);
  const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
  const hasMcq = normalizedTypes.some((type) => type === "mcq");
  const answerLabel = hasMcq ? "Answer / Options" : "Answer";
  const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");

  const isSingleMcq = safeCards.length === 1 && normalizedTypes[0] === "mcq";
  const isSingleOq = safeCards.length === 1 && normalizedTypes[0] === "oq";
  const isSingleBasicOrReversed =
    safeCards.length === 1 && (normalizedTypes[0] === "basic" || normalizedTypes[0] === "reversed");
  const showReadOnlyFields = config.showReadOnlyFields ?? true;

  const root = document.createElement("div");
  root.className = "bc flex flex-col gap-3";

  const formFields: Array<{ key: ColKey; label: string; editable: boolean }> = [];

  if (showReadOnlyFields) {
    formFields.push({ key: "id", label: "ID", editable: false });
    formFields.push({ key: "type", label: "Type", editable: false });
    formFields.push({ key: "location", label: "Location", editable: false });
    formFields.push({ key: "stage", label: "Stage", editable: false });
    formFields.push({ key: "due", label: "Due", editable: false });
  }

  formFields.push({ key: "title", label: "Title", editable: true });

  // Skip question/answer for IO cards
  const isIoCard = normalizedTypes.length === 1 && normalizedTypes[0] === "io";
  if (!isIoCard) {
    formFields.push({ key: "question", label: "Question", editable: true });
    if (hasNonCloze) {
      formFields.push({ key: "answer", label: answerLabel, editable: true });
    }
  }

  formFields.push({ key: "info", label: "Extra information", editable: true });
  formFields.push({ key: "groups", label: "Groups", editable: true });

  if (isSingleMcq || isSingleOq) {
    const answerIdx = formFields.findIndex((f) => f.key === "answer");
    if (answerIdx >= 0) formFields.splice(answerIdx, 1);
  }

  const inputEls: Partial<Record<ColKey, HTMLInputElement | HTMLTextAreaElement>> = {};

  const sharedValue = (key: ColKey, predicate?: (card: CardRecord) => boolean) => {
    const matches = safeCards.filter((card) => (predicate ? predicate(card) : true));
    if (!matches.length) return "";
    const values = matches.map((card) => getFieldValue(card, key));
    const candidate = values[0];
    if (values.every((val) => val === candidate)) return candidate;
    return "";
  };

  const appendField = (field: { key: ColKey; label: string; editable: boolean }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "bc flex flex-col gap-1";

    const label = document.createElement("label");
    label.className = "bc text-sm font-medium";
    label.textContent = field.label;
    if (field.key === "question") {
      const required = document.createElement("span");
      required.className = "bc text-destructive ml-1";
      required.textContent = "*";
      label.appendChild(required);
    }
    if (field.key === "answer" && !isSingleMcq) {
      const required = document.createElement("span");
      required.className = "bc text-destructive ml-1";
      required.textContent = "*";
      label.appendChild(required);
    }
    const suppressGenericInfoIcons = isSingleBasicOrReversed || isSingleMcq || isSingleOq || isClozeOnly;
    if (field.key === "question" && isClozeOnly) {
      label.className = "bc text-sm font-medium inline-flex items-center gap-1";
      const infoIcon = document.createElement("span");
      infoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
      infoIcon.setAttribute("aria-label", CLOZE_TOOLTIP);
      infoIcon.setAttribute("data-tooltip-position", "top");
      setIcon(infoIcon, "info");
      label.appendChild(infoIcon);
    } else if (!suppressGenericInfoIcons && field.editable && ["title", "question", "answer", "info"].includes(field.key)) {
      label.className = "bc text-sm font-medium inline-flex items-center gap-1";
      const infoIcon = document.createElement("span");
      infoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
      infoIcon.setAttribute("aria-label", FORMAT_TOOLTIP);
      infoIcon.setAttribute("data-tooltip-position", "top");
      setIcon(infoIcon, "info");
      label.appendChild(infoIcon);
    }
    wrapper.appendChild(label);

    if (field.key === "groups") {
      const groupField = createGroupPickerField(sharedValue(field.key), cards.length, plugin);
      wrapper.appendChild(groupField.element);
      wrapper.appendChild(groupField.hiddenInput);
      inputEls[field.key] = groupField.hiddenInput;
      root.appendChild(wrapper);
      return;
    }

    let input: HTMLInputElement | HTMLTextAreaElement;
    const predicate =
      field.key === "answer"
        ? (card: CardRecord) => String(card.type ?? "").toLowerCase() !== "cloze"
        : undefined;
    const value = sharedValue(field.key, predicate);

    if (field.editable && ["title", "question", "answer", "info"].includes(field.key)) {
      const textarea = document.createElement("textarea");
      textarea.className = "bc textarea w-full sprout-textarea-fixed";
      textarea.rows = 3;
      textarea.value = value;
      if (field.key === "title") textarea.placeholder = PLACEHOLDER_TITLE;
      if (field.key === "question") textarea.placeholder = isClozeOnly ? PLACEHOLDER_CLOZE : PLACEHOLDER_QUESTION;
      if (field.key === "answer") textarea.placeholder = PLACEHOLDER_ANSWER;
      if (field.key === "info") textarea.placeholder = PLACEHOLDER_INFO;
      input = textarea;
    } else {
      const txt = document.createElement("input");
      txt.type = "text";
      txt.className = "bc input w-full";
      txt.value = value;
      txt.disabled = !field.editable;
      input = txt;
    }

    if (cards.length > 1 && field.editable) {
      const overwriteNotice = document.createElement("div");
      overwriteNotice.className = "bc text-xs text-muted-foreground";
      const cardCount = cards.length;
      const cardLabel = cardCount === 1 ? "card" : "cards";
      overwriteNotice.textContent = `You have selected ${cardCount} ${cardLabel}. Any input in this field will overwrite all ${cardCount} ${cardLabel}. To leave all cards in their current form, leave this field blank.`;
      overwriteNotice.classList.add("sprout-is-hidden");

      const updateOverwriteNotice = () => {
        const value = String(input.value ?? "").trim();
        overwriteNotice.classList.toggle("sprout-is-hidden", !value.length);
      };
      input.addEventListener("input", updateOverwriteNotice);
      updateOverwriteNotice();
      wrapper.appendChild(overwriteNotice);
    }

    const shouldPreviewFlags = field.editable && ["title", "question", "answer", "info"].includes(field.key);
    const modalFieldMin =
      field.editable && (field.key === "title" || field.key === "question" || field.key === "answer" || field.key === "info")
        ? fieldMinHeightPx(field.key)
        : 38;

    wrapper.appendChild(shouldPreviewFlags ? attachFlagPreviewOverlay(input, modalFieldMin) : input);
    inputEls[field.key] = input;
    if (input instanceof HTMLTextAreaElement) {
      attachFormatShortcuts(input);
      if (field.key === "question" && isClozeOnly) {
        attachClozeShortcuts(input);
        if (shouldShowMobileClozeButtons()) {
          wrapper.appendChild(createMobileClozeButtons(input));
        }
      }
    }
    root.appendChild(wrapper);
  };

  // Track field wrappers by key for insertion ordering
  const fieldWrappers = new Map<string, HTMLElement>();
  formFields.forEach((field) => {
    appendField(field);
    // The last child of root is the wrapper just appended
    fieldWrappers.set(field.key, root.lastElementChild as HTMLElement);
  });

  let buildMcqValue: (() => string | null) | undefined;
  let getMcqOptions: (() => { correct: string; corrects: string[]; wrongs: string[] }) | undefined;
  let getOqSteps: (() => string[]) | undefined;
  if (isSingleMcq) {
    const mcqSection = createMcqEditor(safeCards[0]);
    if (mcqSection) {
      // Insert MCQ section right after the question field
      const questionWrapper = fieldWrappers.get("question");
      if (questionWrapper && questionWrapper.nextSibling) {
        root.insertBefore(mcqSection.element, questionWrapper.nextSibling);
      } else {
        root.appendChild(mcqSection.element);
      }
      buildMcqValue = mcqSection.buildValue;
      getMcqOptions = mcqSection.getOptions;
    }
  }
  if (isSingleOq) {
    const oqSection = createOqEditor(safeCards[0]);
    if (oqSection) {
      const questionWrapper = fieldWrappers.get("question");
      if (questionWrapper && questionWrapper.nextSibling) {
        root.insertBefore(oqSection.element, questionWrapper.nextSibling);
      } else {
        root.appendChild(oqSection.element);
      }
      getOqSteps = oqSection.getSteps;
    }
  }

  return {
    root,
    inputEls,
    buildMcqValue,
    getMcqOptions,
    getOqSteps,
    getGroupInputValue: () => {
      const el = inputEls.groups;
      return el ? (el.value ?? "") : "";
    },
    fields: formFields.map((field) => ({ key: field.key, editable: field.editable })),
    isSingleMcq,
    isSingleOq,
    mcqOriginalString: isSingleMcq ? buildAnswerOrOptionsFor(safeCards[0]) : undefined,
  };
}

function getFieldValue(card: CardRecord, key: ColKey): string {
  switch (key) {
    case "id":
      return String(card.id);
    case "type":
      return String(card.type ?? "");
    case "stage": {
      const stage = (card as unknown as Record<string, unknown>).stage;
      return typeof stage === "string" ? stage : typeof stage === "number" ? String(stage) : "";
    }
    case "due": {
      const due = (card as unknown as Record<string, unknown>).due;
      return typeof due === "string" ? due : typeof due === "number" ? String(due) : "";
    }
    case "title":
      return (card.title || "").split(/\r?\n/)[0] || "";
    case "question":
      if (card.type === "basic" || card.type === "reversed") return card.q || "";
      if (card.type === "mcq") return card.stem || "";
      if (card.type === "oq") return card.q || "";
      return card.clozeText || "";
    case "answer":
      if (card.type === "basic" || card.type === "reversed") return card.a || "";
      if (card.type === "mcq") {
        const options = normalizeCardOptions(card.options);
        const correct = Number.isFinite(card.correctIndex) ? (card.correctIndex as number) : -1;
        return options
          .map((opt, idx) => {
            const t = escapePipes((opt || "").trim());
            return idx === correct ? `**${t}**` : t;
          })
          .join(` ${getDelimiter()} `);
      }
      if (card.type === "oq") {
        const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
        return steps.map((s, i) => `${i + 1}. ${(s || "").trim()}`).join("\n");
      }
      return "";
    case "info":
      return card.info || "";
    case "location":
      return String(card.sourceNotePath || "");
    case "groups":
      return card.groups
        ? Array.isArray(card.groups)
          ? card.groups.join(", ")
          : String(card.groups)
        : "";
    default:
      return "";
  }
}

export function createGroupPickerField(initialValue: string, cardsCount: number, plugin: SproutPlugin) {
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.value = initialValue;

  const container = document.createElement("div");
  container.className = "bc relative sprout-group-picker";

  const tagBox = document.createElement("div");
  tagBox.className = "bc textarea w-full sprout-tag-box";
  container.appendChild(tagBox);

  let overwriteNotice: HTMLDivElement | null = null;
  if (cardsCount > 1) {
    overwriteNotice = document.createElement("div");
    overwriteNotice.className = "bc text-xs text-muted-foreground";
    overwriteNotice.textContent =
      "Typing here will overwrite this field for every selected card; leave it blank to keep existing values.";
    overwriteNotice.classList.add("sprout-is-hidden");
    container.appendChild(overwriteNotice);
  }

  let selected = parseGroupsInput(initialValue);

  const optionSet = new Set<string>();
  for (const c of plugin.store.getAllCards() || []) {
    const groups = Array.isArray(c?.groups) ? c.groups : [];
    for (const g of groups.map((path: string) => titleCaseGroupPath(String(path).trim())).filter(Boolean)) {
      for (const ancestor of expandGroupAncestors(g)) optionSet.add(ancestor);
    }
  }
  let allOptions = Array.from(optionSet).sort((a, b) =>
    formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
  );

  const list = document.createElement("div");
  list.className = "bc flex flex-col max-h-60 overflow-auto p-1";

  const searchWrap = document.createElement("div");
  searchWrap.className = "bc flex items-center gap-1 border-b border-border pl-1 pr-0 w-full min-h-[38px]";

  const searchIcon = document.createElement("span");
  searchIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-search-icon";
  searchIcon.setAttribute("aria-hidden", "true");
  setIcon(searchIcon, "search");
  searchWrap.appendChild(searchIcon);

  const search = document.createElement("input");
  search.type = "text";
  search.className = "bc bg-transparent text-sm flex-1 h-9 sprout-search-naked";
  search.placeholder = "Search or add group";
  searchWrap.appendChild(search);

  const panel = document.createElement("div");
  panel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground p-0 flex flex-col sprout-pointer-auto";
  panel.appendChild(searchWrap);
  panel.appendChild(list);

  const popover = document.createElement("div");
  popover.className = "sprout-popover-dropdown";
  popover.setAttribute("aria-hidden", "true");
  popover.appendChild(panel);
  container.appendChild(popover);

  const renderBadges = () => {
    clearNode(tagBox);
    if (!selected.length) {
      const placeholder = document.createElement("span");
      placeholder.className = "bc badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 sprout-badge-placeholder";
      placeholder.textContent = "No groups";
      tagBox.appendChild(placeholder);
      return;
    }
    for (const tag of selected) {
      const badge = document.createElement("span");
      badge.className = "bc badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 sprout-badge-inline";

      const txt = document.createElement("span");
      txt.textContent = formatGroupDisplay(tag);
      badge.appendChild(txt);

      const removeBtn = document.createElement("span");
      removeBtn.className =
        "bc ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white";
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = selected.filter((t) => t !== tag);
        renderBadges();
        renderList();
        commit();
      });
      badge.appendChild(removeBtn);
      tagBox.appendChild(badge);
    }
  };

  const updateOverwriteNotice = () => {
    const value = groupsToInput(selected).trim();
    if (overwriteNotice) overwriteNotice.classList.toggle("sprout-is-hidden", !(cardsCount > 1 && value));
  };

  const commit = () => {
    hiddenInput.value = groupsToInput(selected);
    updateOverwriteNotice();
  };

  const toggleTag = (tag: string) => {
    const next = titleCaseGroupPath(tag);
    if (!next) return;
    if (selected.includes(next)) selected = selected.filter((t) => t !== next);
    else selected = [...selected, next];
    renderBadges();
    renderList();
    commit();
  };

  const renderList = () => {
    clearNode(list);
    const raw = search.value.trim();
    const rawTitle = titleCaseGroupPath(raw);
    const rawDisplay = formatGroupDisplay(rawTitle);
    const q = raw.toLowerCase();
    const options = allOptions.filter((t) => formatGroupDisplay(t).toLowerCase().includes(q));
    const exact =
      raw && allOptions.some((t) => formatGroupDisplay(t).toLowerCase() === rawDisplay.toLowerCase());

    const addRow = (label: string, value: string, isAdd = false) => {
      const row = document.createElement("div");
      row.setAttribute("role", "menuitem");
      row.setAttribute("aria-checked", selected.includes(value) ? "true" : "false");
      row.tabIndex = 0;
      row.className =
        "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";

      const text = document.createElement("span");
      text.textContent = label;
      row.appendChild(text);

      if (selected.includes(value) && !isAdd) {
        const check = document.createElement("span");
        check.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
        setIcon(check, "check");
        row.appendChild(check);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "bc inline-flex items-center justify-center [&_svg]:size-3 opacity-0";
        setIcon(spacer, "check");
        row.appendChild(spacer);
      }

      const handleActivate = () => {
        if (isAdd) {
          const next = titleCaseGroupPath(value);
          toggleTag(next);
          if (next) {
            allOptions = Array.from(new Set([...allOptions, next])).sort((a, b) =>
              formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
            );
          }
          search.value = "";
          renderList();
          return;
        }
        toggleTag(value);
      };

      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        handleActivate();
      });
      row.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          handleActivate();
        }
      });

      list.appendChild(row);
    };

    if (raw && !exact) addRow(`Add “${rawDisplay || rawTitle}”`, rawTitle || raw, true);
    if (allOptions.length === 0 && !raw && selected.length === 0) {
      list.classList.add("sprout-list-unbounded");
      const empty = document.createElement("div");
      empty.className = "bc px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
      empty.textContent = "Type a keyword above to save this flashcard to a group.";
      list.appendChild(empty);
      return;
    }

    for (const opt of options) addRow(formatGroupDisplay(opt), opt);
  };

  const commitSearch = () => {
    const raw = search.value.trim();
    if (!raw) return;
    toggleTag(raw);
    search.value = "";
    renderList();
  };

  search.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      commitSearch();
    }
  });

  search.addEventListener("blur", () => {
    commitSearch();
  });

  const openPopover = () => {
    renderList();
    popover.setAttribute("aria-hidden", "false");
    popover.classList.add("is-open");
  };

  const closePopover = () => {
    popover.setAttribute("aria-hidden", "true");
    popover.classList.remove("is-open");
  };

  renderBadges();
  renderList();

  const onDocPointerDown = (ev: PointerEvent) => {
    if (!container.contains(ev.target as Node)) closePopover();
  };
  document.addEventListener("pointerdown", onDocPointerDown);

  const cleanup = () => {
    document.removeEventListener("pointerdown", onDocPointerDown);
    detachObserver.disconnect();
  };

  const detachObserver = new MutationObserver(() => {
    if (!container.isConnected) cleanup();
  });
  if (document.body) {
    detachObserver.observe(document.body, { childList: true, subtree: true });
  }

  container.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openPopover();
  });

  return {
    element: container,
    hiddenInput,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// OQ editor (reorderable numbered steps)
// ──────────────────────────────────────────────────────────────────────────────

function createOqEditor(card: CardRecord) {
  const initialSteps = Array.isArray(card.oqSteps) ? [...card.oqSteps] : ["", ""];

  const container = document.createElement("div");
  container.className = "bc flex flex-col gap-1";

  const label = document.createElement("label");
  label.className = "bc text-sm font-medium inline-flex items-center gap-1";
  label.textContent = "Steps (correct order)";
  label.appendChild(Object.assign(document.createElement("span"), { className: "bc text-destructive", textContent: "*" }));
  const stepsInfoIcon = document.createElement("span");
  stepsInfoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
  stepsInfoIcon.setAttribute("aria-label", OQ_TOOLTIP);
  stepsInfoIcon.setAttribute("data-tooltip-position", "top");
  setIcon(stepsInfoIcon, "info");
  label.appendChild(stepsInfoIcon);
  container.appendChild(label);

  const hint = document.createElement("div");
  hint.className = "bc text-xs text-muted-foreground";
  hint.textContent = "Enter the steps in their correct order. Drag the grip handles to reorder. Steps are shuffled during review.";
  container.appendChild(hint);

  const listContainer = document.createElement("div");
  listContainer.className = "bc flex flex-col gap-2 sprout-oq-editor-list";
  container.appendChild(listContainer);

  const stepRows: Array<{ row: HTMLElement; input: HTMLTextAreaElement; badge: HTMLElement }> = [];

  const renumber = () => {
    stepRows.forEach((entry, i) => {
      entry.badge.textContent = String(i + 1);
    });
  };

  const updateRemoveButtons = () => {
    const disable = stepRows.length <= 2;
    for (const entry of stepRows) {
      const delBtn = entry.row.querySelector<HTMLButtonElement>(".sprout-oq-del-btn");
      if (delBtn) {
        delBtn.disabled = disable;
        delBtn.setAttribute("aria-disabled", disable ? "true" : "false");
        delBtn.classList.toggle("is-disabled", disable);
      }
    }
  };

  const addStepRow = (value: string) => {
    const idx = stepRows.length;

    const row = document.createElement("div");
    row.className = "bc flex items-center gap-2 sprout-oq-editor-row";
    row.draggable = false;

    // Drag grip
    const grip = document.createElement("span");
    grip.className = "bc inline-flex items-center justify-center text-muted-foreground cursor-grab sprout-oq-grip";
    grip.draggable = true;
    setIcon(grip, "grip-vertical");
    row.appendChild(grip);

    // Number badge
    const badge = document.createElement("span");
    badge.className = "bc inline-flex items-center justify-center text-xs font-medium text-muted-foreground w-5 h-9 leading-none shrink-0";
    badge.textContent = String(idx + 1);
    row.appendChild(badge);

    // Text input
    const input = document.createElement("textarea");
    input.className = "bc textarea flex-1 text-sm sprout-oq-step-input";
    input.rows = 1;
    input.placeholder = `Step ${idx + 1}`;
    input.value = value;
    const autoGrow = () => {
      setCssProps(input, "height", "auto");
      setCssProps(input, "height", `${Math.max(38, input.scrollHeight)}px`);
    };
    input.addEventListener("input", autoGrow);
    autoGrow();
    row.appendChild(attachFlagPreviewOverlay(input));

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "bc inline-flex items-center justify-center p-0 sprout-remove-btn-ghost sprout-oq-del-btn";
    delBtn.setAttribute("aria-label", "Remove step");
    delBtn.setAttribute("data-tooltip-position", "top");
    const xIcon = document.createElement("span");
    xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(xIcon, "x");
    delBtn.appendChild(xIcon);
    delBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (stepRows.length <= 2) return;
      const pos = stepRows.findIndex((e) => e.input === input);
      if (pos < 0) return;
      stepRows[pos].row.remove();
      stepRows.splice(pos, 1);
      renumber();
      updateRemoveButtons();
    });
    row.appendChild(delBtn);

    // HTML5 DnD for reordering
    let dragIdx = -1;
    row.addEventListener("dragstart", (ev) => {
      dragIdx = stepRows.findIndex((e) => e.row === row);
      ev.dataTransfer?.setData("text/plain", String(dragIdx));
      row.classList.add("sprout-oq-row-dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("sprout-oq-row-dragging");
    });
    row.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = "move";
    });
    row.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const fromStr = ev.dataTransfer?.getData("text/plain");
      if (fromStr === undefined || fromStr === null) return;
      const fromIdx = parseInt(fromStr, 10);
      const toIdx = stepRows.findIndex((e) => e.row === row);
      if (isNaN(fromIdx) || fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

      // Reorder array
      const [moved] = stepRows.splice(fromIdx, 1);
      stepRows.splice(toIdx, 0, moved);

      // Reorder DOM
      listContainer.innerHTML = "";
      for (const entry of stepRows) listContainer.appendChild(entry.row);
      renumber();
    });

    listContainer.appendChild(row);
    const entry = { row, input, badge };
    stepRows.push(entry);
    updateRemoveButtons();

    return entry;
  };

  // Seed with existing steps or 2 empty rows
  const seed = initialSteps.length >= 2 ? initialSteps : ["", ""];
  for (const s of seed) addStepRow(s);
  renumber();
  updateRemoveButtons();

  // "Add step" button
  const addRow = document.createElement("div");
  addRow.className = "bc flex items-center gap-2";
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = "bc input flex-1 text-sm sprout-input-fixed";
  addInput.placeholder = "Add another step (press enter)";
  addInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      const val = addInput.value.trim();
      if (!val) return;
      if (stepRows.length >= 20) { new Notice("Maximum 20 steps."); return; }
      addStepRow(val);
      renumber();
      addInput.value = "";
    }
  });
  addInput.addEventListener("blur", () => {
    const val = addInput.value.trim();
    if (!val) return;
    if (stepRows.length >= 20) return;
    addStepRow(val);
    renumber();
    addInput.value = "";
  });
  addRow.appendChild(attachFlagPreviewOverlay(addInput));
  container.appendChild(addRow);

  const getSteps = (): string[] => {
    return stepRows.map((e) => String(e.input.value || "").trim()).filter(Boolean);
  };

  return {
    element: container,
    getSteps,
  };
}

function createMcqEditor(card: CardRecord) {
  const options = normalizeCardOptions(card.options);
  const correctSet = new Set(getCorrectIndices(card));

  const container = document.createElement("div");
  container.className = "bc flex flex-col gap-1";

  const label = document.createElement("label");
  label.className = "bc text-sm font-medium inline-flex items-center gap-1";
  label.textContent = "Answers and options";
  const mcqInfoIcon = document.createElement("span");
  mcqInfoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
  mcqInfoIcon.setAttribute("aria-label", "Check the box next to each correct answer. At least one correct and one incorrect option required.");
  mcqInfoIcon.setAttribute("data-tooltip-position", "top");
  setIcon(mcqInfoIcon, "info");
  label.appendChild(mcqInfoIcon);
  container.appendChild(label);

  const optionsContainer = document.createElement("div");
  optionsContainer.className = "bc flex flex-col gap-2";
  container.appendChild(optionsContainer);

  type OptionRowEntry = { row: HTMLElement; input: HTMLInputElement; checkbox: HTMLInputElement; removeBtn: HTMLButtonElement };
  const optionRows: OptionRowEntry[] = [];

  const updateRemoveButtons = () => {
    const disable = optionRows.length <= 2;
    for (const entry of optionRows) {
      entry.removeBtn.disabled = disable;
      entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
      entry.removeBtn.classList.toggle("is-disabled", disable);
    }
  };

  const addOptionRow = (value: string, isCorrect: boolean) => {
    const row = document.createElement("div");
    row.className = "bc flex items-center gap-2 sprout-edit-mcq-option-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isCorrect;
    checkbox.className = "bc sprout-mcq-correct-checkbox";
    checkbox.setAttribute("aria-label", "Mark as correct answer");
    checkbox.setAttribute("data-tooltip-position", "top");
    row.appendChild(checkbox);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "bc input flex-1 text-sm sprout-input-fixed";
    input.placeholder = "Enter an answer option";
    input.value = value;
    row.appendChild(attachFlagPreviewOverlay(input));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "bc inline-flex items-center justify-center p-0 sprout-remove-btn-ghost";
    removeBtn.setAttribute("aria-label", "Remove option");
    removeBtn.setAttribute("data-tooltip-position", "top");
    const xIcon = document.createElement("span");
    xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(xIcon, "x");
    removeBtn.appendChild(xIcon);
    removeBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (optionRows.length <= 2) return;
      const idx = optionRows.findIndex((entry) => entry.input === input);
      if (idx === -1) return;
      optionRows[idx].row.remove();
      optionRows.splice(idx, 1);
      updateRemoveButtons();
    });
    row.appendChild(removeBtn);

    optionsContainer.appendChild(row);
    optionRows.push({ row, input, checkbox, removeBtn });
    updateRemoveButtons();
  };

  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = "bc input flex-1 text-sm sprout-input-fixed";
  addInput.placeholder = "Add another option (press enter)";
  addInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      const value = addInput.value.trim();
      if (!value) return;
      addOptionRow(value, false);
      addInput.value = "";
    }
  });
  addInput.addEventListener("blur", () => {
    const value = addInput.value.trim();
    if (!value) return;
    addOptionRow(value, false);
    addInput.value = "";
  });

  const addInputWrap = document.createElement("div");
  addInputWrap.className = "bc flex items-center gap-2";
  addInputWrap.appendChild(attachFlagPreviewOverlay(addInput));
  container.appendChild(addInputWrap);

  // Populate from existing card
  if (options.length > 0) {
    options.forEach((opt, idx) => {
      addOptionRow(opt, correctSet.has(idx));
    });
  } else {
    // At least two empty rows
    addOptionRow("", true);
    addOptionRow("", false);
  }
  updateRemoveButtons();

  const buildValue = () => {
    const allOpts = optionRows
      .map((entry) => ({ text: entry.input.value.trim(), isCorrect: entry.checkbox.checked }))
      .filter((opt) => opt.text.length > 0);
    const corrects = allOpts.filter((o) => o.isCorrect);
    const wrongs = allOpts.filter((o) => !o.isCorrect);

    if (corrects.length < 1) {
      new Notice("Multiple-choice cards require at least one correct option (checked).");
      return null;
    }
    if (wrongs.length < 1) {
      new Notice("Multiple-choice cards require at least one wrong option (unchecked).");
      return null;
    }

    const rendered = allOpts.map((opt) =>
      opt.isCorrect ? `**${escapePipeText(opt.text)}**` : escapePipeText(opt.text)
    );
    return rendered.join(` ${getDelimiter()} `);
  };

  const getOptions = () => {
    const allOpts = optionRows
      .map((entry) => ({ text: String(entry.input.value || "").trim(), isCorrect: entry.checkbox.checked }))
      .filter((opt) => opt.text.length > 0);
    const corrects = allOpts.filter((o) => o.isCorrect).map((o) => o.text);
    const wrongs = allOpts.filter((o) => !o.isCorrect).map((o) => o.text);
    return {
      correct: corrects[0] || "",
      corrects,
      wrongs,
    };
  };

  return {
    element: container,
    buildValue,
    getOptions,
  };
}
