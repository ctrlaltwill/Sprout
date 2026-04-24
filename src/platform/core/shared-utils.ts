/**
 * @file shared-utils.ts
 * @summary Shared DOM and string utility functions used across multiple modules.
 *
 * These helpers were previously duplicated in browser-helpers, card-editor,
 * modal-utils, render-deck, header, and anki-export-modal.  This module is the
 * single source of truth — all other files should import from here.
 *
 * @exports clearNode          — Remove all children from a DOM node.
 * @exports titleCaseToken     — Title-case a single word.
 * @exports titleCaseSegment   — Title-case a path segment (handles hyphens/underscores/spaces).
 * @exports normalizeGroupPathInput — Normalize a slash-delimited group path string.
 * @exports titleCaseGroupPath — Normalize and title-case a full group path.
 * @exports formatGroupDisplay — Format a group path for user-facing display ("A / B / C").
 * @exports expandGroupAncestors — Return all ancestor paths for a group ("A", "A/B", "A/B/C").
 * @exports parseGroupsInput   — Split a comma-separated string into an array of canonical group paths.
 * @exports groupsToInput      — Convert an array of group paths into a comma-separated display string.
 */

// ────────────────────────────────────────────
// DOM helpers
// ────────────────────────────────────────────

/**
 * Remove all child nodes from the given element.
 * A null-safe variant — silently returns if `node` is null or undefined.
 */
export function clearNode(node: HTMLElement | null): void {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ────────────────────────────────────────────
// Group-path string helpers
// ────────────────────────────────────────────

/**
 * Title-case a single token (first char uppercase, rest lowercase).
 *
 * @example titleCaseToken("hello") // "Hello"
 */
export function titleCaseToken(token: string): string {
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Title-case a path segment, preserving internal delimiters (spaces, hyphens,
 * underscores) while capitalising each word.
 *
 * @example titleCaseSegment("hello-world") // "Hello-World"
 */
export function titleCaseSegment(seg: string): string {
  if (!seg) return seg;
  return seg
    .split(/([\s_-]+)/)
    .map((part) => (/^[\s_-]+$/.test(part) ? part : titleCaseToken(part)))
    .join("");
}

/**
 * Normalize a slash-delimited group path: trims segments and drops empties.
 *
 * @example normalizeGroupPathInput("  foo / / bar  ") // "foo/bar"
 */
export function normalizeGroupPathInput(path: string): string {
  if (!path) return "";
  return path
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join("/");
}

/**
 * Normalize and title-case a full group path.
 *
 * @example titleCaseGroupPath("foo/bar baz") // "Foo/Bar Baz"
 */
export function titleCaseGroupPath(path: string): string {
  const normalized = normalizeGroupPathInput(path);
  if (!normalized) return "";
  return normalized
    .split("/")
    .map((seg) => titleCaseSegment(seg.trim()))
    .filter(Boolean)
    .join("/");
}

/**
 * Format a group path for user-facing display by joining segments with " / ".
 *
 * @example formatGroupDisplay("foo/bar") // "Foo / Bar"
 */
export function formatGroupDisplay(path: string): string {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return "";
  return canonical.split("/").join(" / ");
}

/**
 * Return all ancestor paths for a group, from shallowest to deepest.
 *
 * @example expandGroupAncestors("a/b/c") // ["A", "A/B", "A/B/C"]
 */
export function expandGroupAncestors(path: string): string[] {
  const canonical = titleCaseGroupPath(path);
  if (!canonical) return [];
  const parts = canonical.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/**
 * Split a comma-separated string into an array of canonical group paths.
 *
 * @example parseGroupsInput("foo, bar/baz") // ["Foo", "Bar/Baz"]
 */
export function parseGroupsInput(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => titleCaseGroupPath(s.trim()))
    .filter(Boolean);
}

/**
 * Convert an array of group paths into a comma-separated display string.
 *
 * @example groupsToInput(["foo", "bar/baz"]) // "Foo, Bar/Baz"
 */
export function groupsToInput(groups: unknown): string {
  if (!Array.isArray(groups)) return "";
  return groups
    .map((g: unknown) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean)
    .join(", ");
}

export function splitClozeAnswerAndHint(content: string): {
  answer: string;
  hint: string | null;
} {
  const raw = String(content ?? "");
  const hintSeparator = raw.indexOf("::");

  if (hintSeparator === -1) {
    return { answer: raw, hint: null };
  }

  const answer = raw.slice(0, hintSeparator);
  const hintRaw = raw.slice(hintSeparator + 2);
  return {
    answer,
    hint: hintRaw.trim() ? hintRaw : null,
  };
}

function stripInlineMarkdownMarkers(text: string): string {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

// ────────────────────────────────────────────
// Math-aware cloze helpers
// ────────────────────────────────────────────

/**
 * Regex that matches all math delimiter blocks in a string.
 * Used to determine whether a character position is inside a math block.
 */
const MATH_DELIM_RE = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;

interface ClozeTokenMatch {
  index: number;
  fullMatch: string;
  clozeIndex: number;
  content: string;
}

export interface ClozeRenderOccurrence {
  clozeIndex: number;
  occurrence: number;
  answer: string;
  hint: string | null;
  inMath: boolean;
  isTarget: boolean;
}

/**
 * Build a set of character-position ranges that are inside math blocks.
 * Returns a function that checks whether a given position is inside math.
 */
function buildMathRangeChecker(text: string): (pos: number) => boolean {
  const ranges: Array<[number, number]> = [];
  MATH_DELIM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATH_DELIM_RE.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  if (!ranges.length) return () => false;
  return (pos: number) => ranges.some(([s, e]) => pos >= s && pos < e);
}

/**
 * Match cloze tokens while respecting nested braces inside content.
 *
 * This avoids prematurely closing on `}}` that belong to LaTeX constructs
 * (for example `\frac{a}{b}`) inside `{{cN::...}}`.
 */
function matchClozeTokensBraceAware(source: string): ClozeTokenMatch[] {
  const out: ClozeTokenMatch[] = [];
  const opener = /\{\{c(\d+)::/g;
  let m: RegExpExecArray | null;

  while ((m = opener.exec(source)) !== null) {
    const tokenStart = m.index;
    const clozeIndex = Number(m[1]);
    const contentStart = tokenStart + m[0].length;
    let depth = 0;
    let i = contentStart;
    let foundClose = false;

    while (i < source.length) {
      if (source[i] === '{') {
        depth++;
      } else if (source[i] === '}') {
        if (depth > 0) {
          depth--;
        } else if (i + 1 < source.length && source[i + 1] === '}') {
          const content = source.slice(contentStart, i);
          const fullMatch = source.slice(tokenStart, i + 2);
          out.push({ index: tokenStart, fullMatch, clozeIndex, content });
          opener.lastIndex = i + 2;
          foundClose = true;
          break;
        }
      }
      i++;
    }

    if (!foundClose) {
      continue;
    }
  }

  return out;
}

export function getClozeRenderOccurrences(
  text: string,
  targetIndex: number | null | undefined,
): ClozeRenderOccurrence[] {
  const isInsideMath = buildMathRangeChecker(text);
  const clozeOccurrences = new Map<number, number>();

  return matchClozeTokensBraceAware(text).map((match) => {
    const occurrence = (clozeOccurrences.get(match.clozeIndex) ?? 0) + 1;
    clozeOccurrences.set(match.clozeIndex, occurrence);

    const { answer, hint } = splitClozeAnswerAndHint(match.content);
    const isTarget = targetIndex != null ? match.clozeIndex === Number(targetIndex) : true;

    return {
      clozeIndex: match.clozeIndex,
      occurrence,
      answer,
      hint,
      inMath: isInsideMath(match.index),
      isTarget,
    };
  });
}

/**
 * Process cloze tokens in text that may contain math delimiters.
 *
 * When a cloze token `{{c1::answer}}` sits inside a math block (`$$...$$`, `\(...\)`, `\[...\]`),
 * replaces it with LaTeX-safe placeholders that visually match non-typed clozes:
 *   - Front (unrevealed): `\underline{\phantom{answer}}`
 *   - Back (revealed):    `answer` (unboxed math content)
 *
 * When outside math, uses class-based cloze markup:
 *   - Front: `<span class="... learnkit-cloze-blank hidden-cloze"></span>`
 *   - Back:  `**answer**` (bold)
 *
 * @param text        The full cloze text with `{{cN::answer}}` tokens
 * @param reveal      true = back (show answers), false = front (show blanks)
 * @param targetIndex If set, only this cloze index is blanked/revealed; others show plain content
 * @param options     Optional rendering overrides (e.g., blank class name per surface)
 * @returns The processed text ready for `renderMarkdownInto`
 */
export function processClozeForMath(
  text: string,
  reveal: boolean,
  targetIndex: number | null | undefined,
  options?: {
    blankClassName?: string;
    useHintText?: boolean;
  },
): string {
  const isInsideMath = buildMathRangeChecker(text);
  const clozeMatches = matchClozeTokensBraceAware(text);
  const blankClassName = (options?.blankClassName || "sprout-cloze-blank hidden-cloze").trim();
  const useHintText = options?.useHintText !== false;

  const buildBlankHtml = (content: string): string => {
    const w = Math.max(4, Math.min(40, (content || "").trim().length || 6));
    const widthPx = Math.max(30, (w * 8) - 20);
    return `<span class="${blankClassName}" style="--learnkit-cloze-width:${widthPx}px"></span>`;
  };

  let result = '';
  let lastIdx = 0;

  for (const match of clozeMatches) {
    result += text.slice(lastIdx, match.index);
    const idx = match.clozeIndex;
    const content = match.content;
    const { answer, hint } = splitClozeAnswerAndHint(content);
    const isTarget = targetIndex != null ? idx === Number(targetIndex) : true;

    if (!isTarget) {
      result += answer;
    } else {
      const inMath = isInsideMath(match.index);
      if (reveal) {
        result += inMath ? `${answer}` : `**${answer}**`;
      } else if (hint && useHintText) {
        result += inMath ? stripInlineMarkdownMarkers(hint) : hint;
      } else {
        const placeholderSeed = (answer || '').trim() || 'x';
        result += inMath ? `\\underline{\\phantom{${placeholderSeed}}}` : buildBlankHtml(answer);
      }
    }

    lastIdx = match.index + match.fullMatch.length;
  }

  result += text.slice(lastIdx);
  return convertInlineDisplayMath(result);
}

/**
 * Check whether cloze text contains any math delimiters.
 */
export function textContainsMath(text: string): boolean {
  return /\$|\\\(|\\\[/.test(text);
}

/**
 * Convert inline-usage `$$...$$` to `$...$` so Obsidian's MarkdownRenderer
 * renders them as inline math instead of display (block) math.
 *
 * A `$$...$$` is treated as inline when it appears on a line alongside
 * other text (i.e., it's NOT the only content on the line after trimming).
 * Multi-line `$$...$$` blocks are preserved as display math.
 */
export function convertInlineDisplayMath(text: string): string {
  const source = String(text ?? "");
  return source.replace(/\$\$([\s\S]+?)\$\$/g, (match, inner: string, offset: number, full: string) => {
    const hasExplicitMultiline = /\\\r?\n/.test(inner) || /\r?\n/.test(inner);

    const lineStart = full.lastIndexOf("\n", offset - 1) + 1;
    const lineEndRaw = full.indexOf("\n", offset + match.length);
    const lineEnd = lineEndRaw === -1 ? full.length : lineEndRaw;

    const before = full.slice(lineStart, offset).trim();
    const after = full.slice(offset + match.length, lineEnd).trim();

    // If there is surrounding text on the same line, treat this display math as inline
    // only when the math itself is single-line.
    if (!hasExplicitMultiline && (before.length > 0 || after.length > 0)) {
      return `$${inner}$`;
    }

    return match;
  });
}

/**
 * Force single-line display math ($$...$$) to inline math ($...$).
 *
 * Intended for compact UI contexts like MCQ options / OQ steps where
 * display-math line breaks are undesirable.
 */
export function forceSingleLineDisplayMathInline(text: string): string {
  const base = convertInlineDisplayMath(text);
  return base.replace(/\$\$([\s\S]+?)\$\$/g, (_match, inner: string) => {
    // Support source style where a trailing backslash is used before a source newline.
    // Treat it as a visual line break in most cases, except when the next token starts
    // with "{" (common continuation for commands like \frac{...}\n{...}).
    const source = String(inner ?? "");
    const normalizedInner = source.replace(/\\\r?\n\s*/g, (full: string, offset: number, all: string) => {
      const nextChar = String(all ?? "").slice(offset + full.length, offset + full.length + 1);
      return nextChar === "{" ? "" : "\\\\\n";
    });
    const hasExplicitMultiline = /\r?\n/.test(normalizedInner);
    return hasExplicitMultiline ? `$$${normalizedInner}$$` : `$${normalizedInner}$`;
  });
}
