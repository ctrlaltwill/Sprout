/**
 * @file src/deck/deck-tree.ts
 * @summary Builds a hierarchical deck tree from the flat group paths stored on card records. Each node in the tree carries aggregate counts (total, new, learning, review, relearning) and child references, enabling the Home view and other consumers to render nested deck structures.
 *
 * @exports
 *  - DeckCounts    — type describing per-state card counts for a single deck node
 *  - DeckNode      — type representing a node in the deck tree (name, counts, children)
 *  - buildDeckTree — constructs a DeckNode tree from an iterable of card records
 */
import { State } from "ts-fsrs";
import { isParentCard } from "../../platform/core/card-utils";
function emptyCounts() {
    return { total: 0, new: 0, learning: 0, review: 0, relearning: 0, due: 0, learn: 0 };
}
function filenameNoExt(path) {
    const base = path.split("/").pop() || path;
    return base.replace(/\.md$/i, "");
}
function folderName(path) {
    const p = path.split("/").filter(Boolean);
    return p.length ? p[p.length - 1] : path;
}
/**
 * Best-effort FSRS state inference for legacy data:
 * - Prefer fsrsState when present
 * - Else infer from stage + lapses
 */
function inferFsrsState(st) {
    var _a, _b;
    if (!st)
        return State.New;
    if (st.fsrsState !== undefined)
        return st.fsrsState;
    // Legacy fallback
    const stage = (_a = st.stage) !== null && _a !== void 0 ? _a : "new";
    if (stage === "new")
        return State.New;
    if (stage === "review")
        return State.Review;
    if (stage === "relearning")
        return State.Relearning;
    // stage === "learning" or unknown: use lapses heuristic
    return ((_b = st.lapses) !== null && _b !== void 0 ? _b : 0) > 0 ? State.Relearning : State.Learning;
}
function addOne(counts, fs, isDue) {
    counts.total += 1;
    if (fs === State.New) {
        counts.new += 1;
    }
    else if (fs === State.Review) {
        counts.review += 1;
        if (isDue)
            counts.due += 1;
    }
    else if (fs === State.Relearning) {
        counts.relearning += 1;
        if (isDue)
            counts.learn += 1;
    }
    else {
        counts.learning += 1; // Learning or any other/unknown -> learning bucket
        if (isDue)
            counts.learn += 1;
    }
}
function ensureChildFolder(parent, folderKey) {
    const existing = parent.children.get(folderKey);
    if (existing)
        return existing;
    const node = {
        type: "folder",
        key: folderKey,
        name: folderName(folderKey),
        children: new Map(),
        counts: emptyCounts(),
    };
    parent.children.set(folderKey, node);
    return node;
}
function ensureChildNote(parent, notePath) {
    const existing = parent.children.get(notePath);
    if (existing)
        return existing;
    const node = {
        type: "note",
        key: notePath,
        name: filenameNoExt(notePath),
        children: new Map(),
        counts: emptyCounts(),
    };
    parent.children.set(notePath, node);
    return node;
}
/**
 * Build a tree:
 * - root is a synthetic folder with key "" and name vaultName
 * - folder keys are folder paths (no trailing slash), e.g. "Psychiatry", "Psychiatry/Anxiety"
 * - note keys are full note paths, e.g. "Psychiatry/Anxiety.md"
 *
 * Signature preserved for compatibility with your caller.
 */
export function buildDeckTree(cards, states, _nowMs, vaultName) {
    const root = {
        type: "folder",
        key: "",
        name: vaultName,
        children: new Map(),
        counts: emptyCounts(),
    };
    for (const c of cards) {
        const notePath = String(c.sourceNotePath || "");
        if (!notePath)
            continue;
        // Skip parent cards — only children (the ones actually studied) should be counted
        if (isParentCard(c))
            continue;
        const st = states[String(c.id)] || null;
        const fs = inferFsrsState(st);
        // Determine whether this card is "due right now":
        // - New cards are NOT counted as due (they are shown separately)
        // - Suspended / buried cards are excluded
        // - Learning/relearning/review cards due at or before now are due
        let isDue = false;
        if (st && st.stage !== "suspended" && st.stage !== "new") {
            if (typeof st.buriedUntil === "number" && Number.isFinite(st.buriedUntil) && st.buriedUntil > _nowMs) {
                isDue = false;
            }
            else if (typeof st.due !== "number" || !Number.isFinite(st.due)) {
                isDue = true; // missing due → treat as available
            }
            else {
                isDue = st.due <= _nowMs;
            }
        }
        // Walk folders
        const parts = notePath.split("/").filter(Boolean);
        const folderParts = parts.slice(0, Math.max(0, parts.length - 1));
        let cur = root;
        let runningKey = "";
        // root counts
        addOne(cur.counts, fs, isDue);
        for (const fp of folderParts) {
            runningKey = runningKey ? `${runningKey}/${fp}` : fp;
            cur = ensureChildFolder(cur, runningKey);
            // aggregate into folder
            addOne(cur.counts, fs, isDue);
        }
        // Note node
        const noteNode = ensureChildNote(cur, notePath);
        addOne(noteNode.counts, fs, isDue);
    }
    return root;
}
