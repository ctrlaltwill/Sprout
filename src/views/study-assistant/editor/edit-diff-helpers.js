const INLINE_DIFF_SHORT_MAX_CHARS = 48;
const INLINE_DIFF_MEDIUM_MAX_CHARS = 140;
const INLINE_DIFF_LONG_MAX_CHARS = 320;
const INLINE_DIFF_MAX_CHANGE_CLUSTERS = 2;
const INLINE_DIFF_MIN_SHARED_CONTEXT_CHARS = 12;
const INLINE_DIFF_LONG_MIN_SHARED_CONTEXT_CHARS = 24;
const INLINE_DIFF_LONG_MAX_CHANGED_CHARS = 56;
const INLINE_DIFF_MAX_MULTILINE_INLINE_LINES = 4;
const INLINE_DIFF_MAX_TOKEN_PRODUCT = 4096;
const TOKEN_RE = /(\s+|[^\p{L}\p{N}_\s]+|[\p{L}\p{N}_]+)/gu;
export function classifyEditProposalRender(original, replacement) {
    const isMultiline = original.includes("\n") || replacement.includes("\n");
    if (isMultiline && isStructuredMultilineEdit(original, replacement)) {
        return { mode: "block-compare" };
    }
    const maxLength = Math.max(original.length, replacement.length);
    if (maxLength > INLINE_DIFF_LONG_MAX_CHARS) {
        return { mode: "full-inline-preview" };
    }
    const segments = buildInlineDiffSegments(original, replacement);
    const metrics = measureInlineDiffSegments(segments);
    const lineCount = Math.max(countLines(original), countLines(replacement));
    if (!metrics.hasChanges) {
        return { mode: "full-inline-preview" };
    }
    const qualifiesAsShortInline = maxLength <= INLINE_DIFF_SHORT_MAX_CHARS
        && metrics.changeClusters <= INLINE_DIFF_MAX_CHANGE_CLUSTERS;
    const qualifiesAsMediumInline = maxLength <= INLINE_DIFF_MEDIUM_MAX_CHARS
        && metrics.changeClusters <= INLINE_DIFF_MAX_CHANGE_CLUSTERS
        && metrics.sharedChars >= INLINE_DIFF_MIN_SHARED_CONTEXT_CHARS;
    const qualifiesAsLongInline = maxLength <= INLINE_DIFF_LONG_MAX_CHARS
        && metrics.changeClusters <= INLINE_DIFF_MAX_CHANGE_CLUSTERS
        && metrics.sharedChars >= INLINE_DIFF_LONG_MIN_SHARED_CONTEXT_CHARS
        && metrics.changedChars <= INLINE_DIFF_LONG_MAX_CHANGED_CHARS
        && (!isMultiline || lineCount <= INLINE_DIFF_MAX_MULTILINE_INLINE_LINES);
    if (qualifiesAsShortInline || qualifiesAsMediumInline || qualifiesAsLongInline) {
        return { mode: "inline-diff", segments };
    }
    return { mode: "full-inline-preview" };
}
export function buildInlineDiffSegments(original, replacement) {
    const originalTokens = tokenizeDiffText(original);
    const replacementTokens = tokenizeDiffText(replacement);
    if (!originalTokens.length
        || !replacementTokens.length
        || (originalTokens.length * replacementTokens.length) > INLINE_DIFF_MAX_TOKEN_PRODUCT) {
        return buildSimpleReplaceSegments(original, replacement);
    }
    const matrix = buildLcsMatrix(originalTokens, replacementTokens);
    const segments = [];
    let originalIndex = 0;
    let replacementIndex = 0;
    while (originalIndex < originalTokens.length && replacementIndex < replacementTokens.length) {
        if (originalTokens[originalIndex] === replacementTokens[replacementIndex]) {
            segments.push({ kind: "equal", text: originalTokens[originalIndex] });
            originalIndex += 1;
            replacementIndex += 1;
            continue;
        }
        if (matrix[originalIndex + 1][replacementIndex] >= matrix[originalIndex][replacementIndex + 1]) {
            segments.push({ kind: "delete", text: originalTokens[originalIndex] });
            originalIndex += 1;
            continue;
        }
        segments.push({ kind: "insert", text: replacementTokens[replacementIndex] });
        replacementIndex += 1;
    }
    while (originalIndex < originalTokens.length) {
        segments.push({ kind: "delete", text: originalTokens[originalIndex] });
        originalIndex += 1;
    }
    while (replacementIndex < replacementTokens.length) {
        segments.push({ kind: "insert", text: replacementTokens[replacementIndex] });
        replacementIndex += 1;
    }
    return mergeAdjacentSegments(segments);
}
function tokenizeDiffText(text) {
    var _a;
    if (!text.length)
        return [];
    return (_a = text.match(TOKEN_RE)) !== null && _a !== void 0 ? _a : [text];
}
function buildLcsMatrix(originalTokens, replacementTokens) {
    const matrix = Array.from({ length: originalTokens.length + 1 }, () => Array(replacementTokens.length + 1).fill(0));
    for (let originalIndex = originalTokens.length - 1; originalIndex >= 0; originalIndex -= 1) {
        for (let replacementIndex = replacementTokens.length - 1; replacementIndex >= 0; replacementIndex -= 1) {
            matrix[originalIndex][replacementIndex] = originalTokens[originalIndex] === replacementTokens[replacementIndex]
                ? matrix[originalIndex + 1][replacementIndex + 1] + 1
                : Math.max(matrix[originalIndex + 1][replacementIndex], matrix[originalIndex][replacementIndex + 1]);
        }
    }
    return matrix;
}
function buildSimpleReplaceSegments(original, replacement) {
    return mergeAdjacentSegments([
        original ? { kind: "delete", text: original } : null,
        replacement ? { kind: "insert", text: replacement } : null,
    ].filter((segment) => segment !== null));
}
function mergeAdjacentSegments(segments) {
    const merged = [];
    for (const segment of segments) {
        if (!segment.text)
            continue;
        const previous = merged[merged.length - 1];
        if (previous && previous.kind === segment.kind) {
            previous.text += segment.text;
            continue;
        }
        merged.push({ ...segment });
    }
    return merged;
}
function measureInlineDiffSegments(segments) {
    let hasChanges = false;
    let sharedChars = 0;
    let changeClusters = 0;
    let changedChars = 0;
    let inChangeCluster = false;
    for (const segment of segments) {
        if (segment.kind === "equal") {
            sharedChars += segment.text.replace(/\s+/g, "").length;
            inChangeCluster = false;
            continue;
        }
        hasChanges = true;
        changedChars += segment.text.replace(/\s+/g, "").length;
        if (!inChangeCluster) {
            changeClusters += 1;
            inChangeCluster = true;
        }
    }
    return {
        hasChanges,
        sharedChars,
        changeClusters,
        changedChars,
    };
}
function countLines(text) {
    return text.length ? text.split(/\r?\n/).length : 1;
}
function isStructuredMultilineEdit(original, replacement) {
    return [original, replacement].some((value) => value.split(/\r?\n/).some(isStructuredMarkdownLine));
}
function isStructuredMarkdownLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return false;
    return /^(?:#{1,6}\s|>\s|```|~~~|(?:[-*+]\s)(?:\[[ xX]\]\s)?|\d+[.)]\s)/.test(trimmed)
        || /^\|(?:[^\n|]*\|)+\s*$/.test(trimmed)
        || /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*$/.test(trimmed)
        || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}
