/**
 * @file src/reviewer/question-mcq.ts
 * @summary Manages MCQ option randomisation for the reviewer. Provides functions to check if randomisation is enabled, initialise per-session order maps, and compute or retrieve a shuffled display order for each MCQ card's options.
 *
 * @exports
 *   - isMcqOptionRandomisationEnabled — Checks whether MCQ option shuffling is enabled in plugin settings
 *   - initMcqOrderState — Initialises the per-session MCQ order map if not already present
 *   - getMcqOptionOrder — Returns a (possibly shuffled) permutation of option indices for a given MCQ card
 */
export function isMcqOptionRandomisationEnabled(plugin) {
    var _a;
    return !!((_a = plugin.settings.study) === null || _a === void 0 ? void 0 : _a.randomizeMcqOptions);
}
export function initMcqOrderState(session) {
    if (!session.mcqOrderMap || typeof session.mcqOrderMap !== "object")
        session.mcqOrderMap = {};
}
function isPermutation(arr, n) {
    if (!Array.isArray(arr) || arr.length !== n)
        return false;
    const seen = new Array(n).fill(false);
    for (const x of arr) {
        if (!Number.isInteger(x) || x < 0 || x >= n)
            return false;
        if (seen[x])
            return false;
        seen[x] = true;
    }
    return true;
}
function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
}
export function getMcqOptionOrder(plugin, session, card) {
    var _a;
    const opts = (card === null || card === void 0 ? void 0 : card.options) || [];
    const n = Array.isArray(opts) ? opts.length : 0;
    const identity = Array.from({ length: n }, (_, i) => i);
    if ((card === null || card === void 0 ? void 0 : card.type) !== "mcq")
        return identity;
    if (!isMcqOptionRandomisationEnabled(plugin))
        return identity;
    const id = String((_a = card === null || card === void 0 ? void 0 : card.id) !== null && _a !== void 0 ? _a : "");
    if (!id)
        return identity;
    if (!session.mcqOrderMap || typeof session.mcqOrderMap !== "object")
        session.mcqOrderMap = {};
    const map = session.mcqOrderMap;
    const existing = map[id];
    if (isPermutation(existing, n))
        return existing;
    const next = identity.slice();
    shuffleInPlace(next);
    if (n >= 2) {
        let same = true;
        for (let i = 0; i < n; i++) {
            if (next[i] !== i) {
                same = false;
                break;
            }
        }
        if (same) {
            const tmp = next[0];
            next[0] = next[1];
            next[1] = tmp;
        }
    }
    map[id] = next;
    return next;
}
