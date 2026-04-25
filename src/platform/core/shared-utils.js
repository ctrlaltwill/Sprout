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
export function clearNode(node) {
    if (!node)
        return;
    while (node.firstChild)
        node.removeChild(node.firstChild);
}
// ────────────────────────────────────────────
// Group-path string helpers
// ────────────────────────────────────────────
/**
 * Title-case a single token (first char uppercase, rest lowercase).
 *
 * @example titleCaseToken("hello") // "Hello"
 */
export function titleCaseToken(token) {
    if (!token)
        return token;
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}
/**
 * Title-case a path segment, preserving internal delimiters (spaces, hyphens,
 * underscores) while capitalising each word.
 *
 * @example titleCaseSegment("hello-world") // "Hello-World"
 */
export function titleCaseSegment(seg) {
    if (!seg)
        return seg;
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
export function normalizeGroupPathInput(path) {
    if (!path)
        return "";
    return path
        .replace(/\\/g, "/")
        .replace(/::/g, "/")
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
export function titleCaseGroupPath(path) {
    const normalized = normalizeGroupPathInput(path);
    if (!normalized)
        return "";
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
export function formatGroupDisplay(path) {
    const canonical = titleCaseGroupPath(path);
    if (!canonical)
        return "";
    return canonical.split("/").join(" / ");
}
/**
 * Return all ancestor paths for a group, from shallowest to deepest.
 *
 * @example expandGroupAncestors("a/b/c") // ["A", "A/B", "A/B/C"]
 */
export function expandGroupAncestors(path) {
    const canonical = titleCaseGroupPath(path);
    if (!canonical)
        return [];
    const parts = canonical.split("/").filter(Boolean);
    const out = [];
    for (let i = 1; i <= parts.length; i++)
        out.push(parts.slice(0, i).join("/"));
    return out;
}
/**
 * Split a comma-separated string into an array of canonical group paths.
 *
 * @example parseGroupsInput("foo, bar/baz") // ["Foo", "Bar/Baz"]
 */
export function parseGroupsInput(raw) {
    return String(raw !== null && raw !== void 0 ? raw : "")
        .split(",")
        .map((s) => titleCaseGroupPath(s.trim()))
        .filter(Boolean);
}
export function sortGroupPathsForDisplay(groups) {
    if (!Array.isArray(groups))
        return [];
    const canonical = groups
        .map((g) => titleCaseGroupPath(String(g).trim()))
        .filter(Boolean);
    return Array.from(new Set(canonical)).sort((a, b) => formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)));
}
/**
 * Convert an array of group paths into a comma-separated display string.
 *
 * @example groupsToInput(["foo", "bar/baz"]) // "Foo, Bar/Baz"
 */
export function groupsToInput(groups) {
    return sortGroupPathsForDisplay(groups).join(", ");
}
export function splitClozeAnswerAndHint(content) {
    const raw = String(content !== null && content !== void 0 ? content : "");
    let hintSeparator = -1;
    let braceDepth = 0;
    for (let index = 0; index < raw.length - 1; index++) {
        const ch = raw[index];
        if (ch === "{") {
            braceDepth += 1;
            continue;
        }
        if (ch === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (braceDepth === 0 && ch === ":" && raw[index + 1] === ":") {
            hintSeparator = index;
            break;
        }
    }
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
function stripInlineMarkdownMarkers(text) {
    return String(text !== null && text !== void 0 ? text : "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/~~(.+?)~~/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .trim();
}
function escapeHtml(text) {
    return String(text !== null && text !== void 0 ? text : "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
// ────────────────────────────────────────────
// Math-aware cloze helpers
// ────────────────────────────────────────────
/**
 * Regex that matches all math delimiter blocks in a string.
 * Used to determine whether a character position is inside a math block.
 */
const MATH_DELIM_RE = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;
/**
 * Build a set of character-position ranges that are inside math blocks.
 * Returns a function that checks whether a given position is inside math.
 */
function buildMathRangeChecker(text) {
    const ranges = [];
    MATH_DELIM_RE.lastIndex = 0;
    let m;
    while ((m = MATH_DELIM_RE.exec(text)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
    }
    if (!ranges.length)
        return () => false;
    return (pos) => ranges.some(([s, e]) => pos >= s && pos < e);
}
/**
 * Match cloze tokens while respecting nested braces inside content.
 *
 * This avoids prematurely closing on `}}` that belong to LaTeX constructs
 * (for example `\frac{a}{b}`) inside `{{cN::...}}`.
 */
function matchClozeTokensBraceAware(source) {
    const out = [];
    const opener = /\{\{c(\d+)::/g;
    let m;
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
            }
            else if (source[i] === '}') {
                if (depth > 0) {
                    depth--;
                }
                else if (i + 1 < source.length && source[i + 1] === '}') {
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
function matchClozeOpeners(source) {
    const out = [];
    const opener = /\{\{c(\d+)::/gi;
    let m;
    while ((m = opener.exec(source)) !== null) {
        out.push({
            index: m.index,
            clozeIndex: Number(m[1]),
        });
    }
    return out;
}
function collectDistinctPositiveClozeIndices(indices) {
    const out = new Set();
    for (const index of indices) {
        if (Number.isFinite(index) && index > 0)
            out.add(index);
    }
    return Array.from(out).sort((a, b) => a - b);
}
function buildNonContiguousNumberingDiagnostic(distinctIndices) {
    if (distinctIndices.length < 2)
        return null;
    const expectedCount = distinctIndices[distinctIndices.length - 1] - distinctIndices[0] + 1;
    if (expectedCount === distinctIndices.length)
        return null;
    return {
        code: "non-contiguous-numbering",
        message: "Cloze numbering is non-contiguous; compatibility mode preserves only the indices currently present.",
        level: "warning",
    };
}
export function parseClozeTokens(text) {
    const source = String(text !== null && text !== void 0 ? text : "");
    const tokenMatches = matchClozeTokensBraceAware(source);
    const openers = matchClozeOpeners(source);
    const matchedStartIndices = new Set(tokenMatches.map((match) => match.index));
    const diagnostics = [];
    const occurrences = new Map();
    const tokens = tokenMatches.map((match) => {
        var _a;
        const occurrence = ((_a = occurrences.get(match.clozeIndex)) !== null && _a !== void 0 ? _a : 0) + 1;
        occurrences.set(match.clozeIndex, occurrence);
        const { answer, hint } = splitClozeAnswerAndHint(match.content);
        return {
            fullMatch: match.fullMatch,
            start: match.index,
            end: match.index + match.fullMatch.length,
            clozeIndex: match.clozeIndex,
            rawContent: match.content,
            answer,
            hint,
            occurrence,
        };
    });
    if (!openers.length) {
        diagnostics.push({
            code: "missing-token",
            message: "Cloze card requires at least one {{cN::...}} token.",
            level: "error",
        });
    }
    for (const opener of openers) {
        if (!Number.isFinite(opener.clozeIndex) || opener.clozeIndex <= 0) {
            diagnostics.push({
                code: "invalid-index",
                message: "Cloze token has invalid number.",
                level: "error",
                start: opener.index,
                clozeIndex: opener.clozeIndex,
            });
        }
        if (!matchedStartIndices.has(opener.index)) {
            diagnostics.push({
                code: "unclosed-token",
                message: "Cloze token is not closed with }}.",
                level: "error",
                start: opener.index,
                clozeIndex: opener.clozeIndex,
            });
        }
    }
    for (const token of tokens) {
        if (!token.answer.trim()) {
            diagnostics.push({
                code: "empty-answer",
                message: "Cloze token content is empty.",
                level: "error",
                start: token.start,
                end: token.end,
                clozeIndex: token.clozeIndex,
            });
        }
    }
    const distinctIndices = collectDistinctPositiveClozeIndices(tokens.map((token) => token.clozeIndex));
    const nonContiguousNumberingDiagnostic = buildNonContiguousNumberingDiagnostic(distinctIndices);
    if (nonContiguousNumberingDiagnostic)
        diagnostics.push(nonContiguousNumberingDiagnostic);
    return {
        tokens,
        diagnostics,
        distinctIndices,
    };
}
export function resolveNestedClozeAnswers(text) {
    const source = String(text !== null && text !== void 0 ? text : "");
    const tokens = parseClozeTokens(source).tokens;
    if (!tokens.length)
        return source;
    let resolved = "";
    let last = 0;
    for (const token of tokens) {
        if (token.start > last) {
            resolved += source.slice(last, token.start);
        }
        resolved += resolveNestedClozeAnswers(token.answer);
        last = token.end;
    }
    if (last < source.length) {
        resolved += source.slice(last);
    }
    return resolved;
}
/**
 * Compatibility extractor for current cloze child identity semantics.
 * This intentionally tracks every detected opener, even if the token is malformed.
 */
export function extractCompatibilityClozeIndices(text) {
    return collectDistinctPositiveClozeIndices(matchClozeOpeners(String(text !== null && text !== void 0 ? text : "")).map((opener) => opener.clozeIndex));
}
export function validateClozeTextCompat(text) {
    const { tokens } = parseClozeTokens(text);
    const errors = [];
    for (const token of tokens) {
        if (!Number.isFinite(token.clozeIndex) || token.clozeIndex <= 0) {
            errors.push("Cloze token has invalid number.");
        }
        if (!token.answer.trim()) {
            errors.push("Cloze token content is empty.");
        }
    }
    if (tokens.length === 0)
        errors.push("Cloze card requires at least one {{cN::...}} token.");
    return errors;
}
export function getClozeRenderOccurrences(text, targetIndex) {
    var _a;
    const isInsideMath = buildMathRangeChecker(text);
    const clozeOccurrences = new Map();
    return matchClozeTokensBraceAware(text).map((match) => {
        const occurrence = ((_a = clozeOccurrences.get(match.clozeIndex)) !== null && _a !== void 0 ? _a : 0) + 1;
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
export function processClozeForMath(text, reveal, targetIndex, options) {
    const isInsideMath = buildMathRangeChecker(text);
    const clozeMatches = matchClozeTokensBraceAware(text);
    const blankClassName = ((options === null || options === void 0 ? void 0 : options.blankClassName) || "sprout-cloze-blank hidden-cloze").trim();
    const useHintText = (options === null || options === void 0 ? void 0 : options.useHintText) !== false;
    const buildBlankHtml = (content, hintText) => {
        const plainContent = stripInlineMarkdownMarkers(content || "");
        const w = Math.max(4, Math.min(40, plainContent.length || 6));
        const widthPx = Math.max(30, (w * 8) - 20);
        if (hintText) {
            return `<span class="learnkit-cloze-hint" style="width:${widthPx}px">${escapeHtml(stripInlineMarkdownMarkers(hintText))}</span>`;
        }
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
        }
        else {
            const inMath = isInsideMath(match.index);
            if (reveal) {
                result += inMath ? `${answer}` : `**${answer}**`;
            }
            else if (hint && useHintText) {
                result += inMath ? stripInlineMarkdownMarkers(hint) : buildBlankHtml(answer, hint);
            }
            else {
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
export function textContainsMath(text) {
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
export function convertInlineDisplayMath(text) {
    const source = String(text !== null && text !== void 0 ? text : "");
    return source.replace(/\$\$([\s\S]+?)\$\$/g, (match, inner, offset, full) => {
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
export function forceSingleLineDisplayMathInline(text) {
    const base = convertInlineDisplayMath(text);
    return base.replace(/\$\$([\s\S]+?)\$\$/g, (_match, inner) => {
        // Support source style where a trailing backslash is used before a source newline.
        // Treat it as a visual line break in most cases, except when the next token starts
        // with "{" (common continuation for commands like \frac{...}\n{...}).
        const source = String(inner !== null && inner !== void 0 ? inner : "");
        const normalizedInner = source.replace(/\\\r?\n\s*/g, (full, offset, all) => {
            const nextChar = String(all !== null && all !== void 0 ? all : "").slice(offset + full.length, offset + full.length + 1);
            return nextChar === "{" ? "" : "\\\\\n";
        });
        const hasExplicitMultiline = /\r?\n/.test(normalizedInner);
        return hasExplicitMultiline ? `$$${normalizedInner}$$` : `$${normalizedInner}$`;
    });
}
