/**
 * @file src/types/card.ts
 * @summary Core card record types. Defines CardRecordType (the supported card formats:
 * basic, mcq, cloze, cloze-child, io, io-child) and the full CardRecord shape that
 * represents a single flashcard persisted in the store, including fields for every card
 * type, source-location metadata, image-occlusion data, and legacy backward-compat aliases.
 *
 * @exports
 *   - CardRecordType — union type of all supported card format identifiers
 *   - CardRecord — type for a single persistent flashcard record
 *   - normalizeCardOptions — coerces McqOption[] | string[] | null → string[]
 */
export function normalizeCardOptions(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((item) => {
        if (typeof item === "string")
            return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
            return item.text;
        }
        if (typeof item === "number" || typeof item === "boolean" || typeof item === "bigint") {
            return String(item);
        }
        return "";
    });
}
/**
 * Returns the set of correct option indices for an MCQ card.
 * Uses `correctIndices` when available, otherwise falls back to `correctIndex`.
 * Always returns a sorted array of unique non-negative integers.
 */
export function getCorrectIndices(card) {
    if (Array.isArray(card.correctIndices) && card.correctIndices.length > 0) {
        return [...new Set(card.correctIndices.filter(i => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
    }
    const maybeOptions = card.options;
    if (Array.isArray(maybeOptions) && maybeOptions.length > 0) {
        const inferred = [];
        for (let i = 0; i < maybeOptions.length; i += 1) {
            const opt = maybeOptions[i];
            if (opt && typeof opt === "object" && "isCorrect" in opt && opt.isCorrect === true) {
                inferred.push(i);
            }
        }
        if (inferred.length > 0)
            return inferred;
    }
    if (Number.isFinite(card.correctIndex) && card.correctIndex >= 0) {
        return [card.correctIndex];
    }
    return [];
}
/**
 * Returns true when an MCQ card has multiple correct answers.
 */
export function isMultiAnswerMcq(card) {
    return getCorrectIndices(card).length > 1;
}
