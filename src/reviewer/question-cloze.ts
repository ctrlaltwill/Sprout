/**
 * @file src/reviewer/question-cloze.ts
 * @summary Renders cloze-deletion flashcard fronts for the reviewer. Parses {{cN::answer}} tokens
 *   in the card text and replaces them with styled blanks (standard mode) or typed inputs (typed mode).
 *
 * @exports
 *   - renderClozeFront — Creates a DOM element rendering a cloze card's text with blanks or revealed answers
 *   - ClozeRenderOptions — Options for cloze rendering (mode, colours, typed-answer state)
 */

import { el, setCssProps } from "../core/ui";
import { applyInlineMarkdown } from "../anki/anki-mapper";

/** Options bag for cloze rendering. */
export type ClozeRenderOptions = {
  /** "standard" = normal blanks/reveals; "typed" = text input on front, result on back. */
  mode?: "standard" | "typed";
  /** Custom bg colour for standard-mode revealed cloze (empty = theme accent). */
  clozeBgColor?: string;
  /** Custom text colour for standard-mode revealed cloze (empty = auto-contrast). */
  clozeTextColor?: string;
  /**
   * Map of cloze-index → user-typed string. Shared between front and back renders so
   * the back can read what the user typed on the front. Keyed by cloze index (number).
   */
  typedAnswers?: Map<number, string>;
  /** Callback fired whenever a typed input value changes. */
  onTypedInput?: (clozeIndex: number, value: string) => void;
  /** Callback fired when a typed input receives Enter key. */
  onTypedSubmit?: () => void;
};

/**
 * Strips inline-markdown markers to produce plain text for comparison.
 * Removes bold, italic, code, and strikethrough formatting.
 */
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

export function renderClozeFront(
  text: string,
  reveal: boolean,
  targetIndex?: number | null,
  opts?: ClozeRenderOptions,
): HTMLElement {
  const mode = opts?.mode ?? "standard";
  const typedAnswers = opts?.typedAnswers ?? new Map<number, string>();

  const container = el("div", "");
  container.className = "bc whitespace-pre-wrap break-words";

  // Wrap cloze content in a <p dir="auto"> so it matches MarkdownRenderer output
  // (and therefore matches spacing/margins between basic vs cloze cards).
  const p = document.createElement("p");
  p.setAttribute("dir", "auto");
  p.className = "bc whitespace-pre-wrap break-words";
  container.appendChild(p);

  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const measureChPx = (): number => {
    const probe = document.createElement("span");
    probe.className = "bc sprout-cloze-probe";
    probe.textContent = "0000000000";
    p.appendChild(probe);
    const px = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return px || 8;
  };

  const chPx = measureChPx();
  const subtractCh = Math.max(0, Math.round(20 / chPx)); // ~20px in ch units

  const ensureSpaceBeforeBlank = () => {
    const lastNode = p.lastChild;
    if (lastNode && lastNode.nodeType === Node.TEXT_NODE) {
      const t = lastNode.textContent ?? "";
      if (/\s$/.test(t)) return;
      lastNode.textContent = t + " ";
      return;
    }
    if (lastNode) p.appendChild(document.createTextNode(" "));
  };

  /** Append a text segment with inline markdown formatting (bold, italic, etc.) */
  const appendFormattedText = (parent: HTMLElement, text: string) => {
    const span = document.createElement("span");
    applyInlineMarkdown(span, text);
    parent.appendChild(span);
  };

  /** Track first typed input for auto-focus */
  let firstTypedInput: HTMLInputElement | null = null;

  while ((m = re.exec(text))) {
    if (m.index > last) {
      appendFormattedText(p, text.slice(last, m.index));
    }

    const idx = Number(m[1]);
    const ans = m[2] ?? "";
    const plainAns = stripInlineMarkdown(ans);
    const isTarget = typeof targetIndex === "number" ? idx === targetIndex : true;

    if (!isTarget) {
      // Non-target clozes: always show answer text inline
      appendFormattedText(p, ans);
    } else if (reveal) {
      // ── BACK (revealed) ──────────────────────────────

      if (mode === "typed") {
        // Typed mode back: compare what was typed to the expected answer
        const typed = (typedAnswers.get(idx) ?? "").trim();
        const isCorrect = typed.toLowerCase() === plainAns.toLowerCase();

        if (isCorrect) {
          // Correct: green pill with answer text
          const span = document.createElement("span");
          span.className = "sprout-cloze-revealed sprout-cloze-typed-correct";
          applyInlineMarkdown(span, ans);
          p.appendChild(span);
        } else {
          // Wrong: red pill with strikethrough showing what was typed, then green pill with correct
          if (typed) {
            const wrongSpan = document.createElement("span");
            wrongSpan.className = "sprout-cloze-revealed sprout-cloze-typed-wrong";
            wrongSpan.textContent = typed;
            p.appendChild(wrongSpan);
            p.appendChild(document.createTextNode(" "));
          }
          const correctSpan = document.createElement("span");
          correctSpan.className = "sprout-cloze-revealed sprout-cloze-typed-correct";
          applyInlineMarkdown(correctSpan, ans);
          p.appendChild(correctSpan);
        }
      } else {
        // Standard mode back: normal accent-coloured reveal
        const answerSpan = document.createElement("span");
        answerSpan.className = "sprout-cloze-revealed";
        applyInlineMarkdown(answerSpan, ans);

        // Apply custom colours if provided (standard mode only)
        if (opts?.clozeBgColor) {
          setCssProps(answerSpan, "background-color", opts.clozeBgColor);
        }
        if (opts?.clozeTextColor) {
          setCssProps(answerSpan, "--sprout-cloze-color", opts.clozeTextColor);
        } else {
          // Auto-contrast detection
          setTimeout(() => {
            const bg = getComputedStyle(answerSpan).backgroundColor;
            const rgb = bg.match(/\d+/g)?.map(Number);
            if (rgb && rgb.length >= 3) {
              const [r, g, b] = rgb;
              const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
              setCssProps(answerSpan, "--sprout-cloze-color", luminance > 0.7 ? "#111" : "#fff");
            }
          }, 0);
        }
        p.appendChild(answerSpan);
      }
    } else {
      // ── FRONT (unrevealed) ───────────────────────────

      ensureSpaceBeforeBlank();

      if (mode === "typed") {
        // Typed mode: render a text input
        const wrap = document.createElement("span");
        wrap.className = "sprout-cloze-typed-wrap";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "sprout-cloze-typed-input";
        input.setAttribute("autocomplete", "off");
        input.setAttribute("autocorrect", "off");
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("spellcheck", "false");
        input.setAttribute("data-cloze-index", String(idx));

        // Size input to match the revealed back span exactly.
        // Use Canvas measureText — reliable regardless of DOM layout state.
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = `500 14px ${getComputedStyle(p).fontFamily}`;
        const textW = ctx.measureText(plainAns).width;
        // Answer width + padding/border + 50px extra so length doesn't reveal the answer
        setCssProps(input, "width", `${Math.max(60, Math.ceil(textW) + 68)}px`);

        // Restore any previously typed value
        const prev = typedAnswers.get(idx);
        if (prev) {
          input.value = prev;
          updateTypedInputState(input, prev, plainAns);
        }

        // Live validation as user types
        input.addEventListener("input", () => {
          const v = input.value;
          typedAnswers.set(idx, v);
          opts?.onTypedInput?.(idx, v);
          updateTypedInputState(input, v, plainAns);
        });

        // Enter key to reveal
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            opts?.onTypedSubmit?.();
          }
        });

        wrap.appendChild(input);
        p.appendChild(wrap);

        if (!firstTypedInput) firstTypedInput = input;
      } else {
        // Standard mode: blank underline
        const blank = document.createElement("span");
        blank.className = "bc sprout-cloze-blank hidden-cloze";

        const w = Math.max(4, Math.min(40, ans.length));
        const wAdj = Math.max(1, w - subtractCh);
        blank.textContent = "";
        setCssProps(blank, "--sprout-cloze-width", `${Math.max(30, wAdj * chPx)}px`);

        p.appendChild(blank);
      }
    }

    last = m.index + m[0].length;
  }

  if (last < text.length) {
    appendFormattedText(p, text.slice(last));
  }

  // Auto-focus the first typed input when in typed mode
  if (firstTypedInput) {
    const inputToFocus = firstTypedInput;
    setTimeout(() => inputToFocus.focus(), 50);
  }

  return container;
}

/**
 * Updates the visual state of a typed cloze input based on current value vs expected answer.
 * - Empty: neutral (no state class)
 * - Partial match from start: yellow ("partial")
 * - Full match: green ("correct")
 * - Mismatch: red ("wrong")
 */
function updateTypedInputState(input: HTMLInputElement, typed: string, expected: string) {
  input.classList.remove(
    "sprout-cloze-typed--partial",
    "sprout-cloze-typed--correct",
    "sprout-cloze-typed--wrong",
  );

  if (!typed) return; // empty → neutral

  const tLower = typed.toLowerCase();
  const eLower = expected.toLowerCase();

  if (tLower === eLower) {
    input.classList.add("sprout-cloze-typed--correct");
  } else if (eLower.startsWith(tLower)) {
    input.classList.add("sprout-cloze-typed--partial");
  } else {
    input.classList.add("sprout-cloze-typed--wrong");
  }
}
