/**
 * @file src/widget/widget-scope.ts
 * @summary Folder-note and deck-scope helpers and card-data accessors for the Sprout sidebar widget. All functions are pure with no class dependency — they receive the plugin, store, or file as explicit arguments — and handle scope resolution for folder-note decks and active-note card filtering.
 *
 * @exports
 *  - folderNotesAsDecksEnabled — checks whether the "folder notes as decks" setting is active
 *  - getFolderNoteInfo         — resolves folder-note metadata for a given file
 *  - isFolderNote              — returns true if a file is a folder note
 *  - getCardsInActiveNoteOnly  — filters cards to those belonging to the currently open note
 *  - getCardsInActiveScope     — filters cards to those matching the active deck scope
 *  - computeCounts             — computes new/learning/review/due counts for a set of cards
 */
import { filterReviewableCards } from "../core/widget-helpers";
/* ------------------------------------------------------------------ */
/*  Folder-note / deck scope helpers                                   */
/* ------------------------------------------------------------------ */
/** Whether the "treat folder notes as decks" setting is enabled (defaults ON). */
export function folderNotesAsDecksEnabled(settings) {
    var _a;
    const v = (_a = settings === null || settings === void 0 ? void 0 : settings.study) === null || _a === void 0 ? void 0 : _a.treatFolderNotesAsDecks;
    return v !== false; // default ON
}
/**
 * If `file` is a folder note (basename === parent folder name), return
 * its folder path and name.  Otherwise `null`.
 *
 * Example: `Psychiatry/Psychiatry.md` → `{ folderPath: "Psychiatry", folderName: "Psychiatry" }`
 */
export function getFolderNoteInfo(file) {
    var _a;
    const parent = (_a = file.parent) !== null && _a !== void 0 ? _a : null;
    const folderName = parent && typeof parent.name === "string" ? (parent.name) : null;
    const folderPath = parent && typeof parent.path === "string" ? (parent.path) : null;
    if (!folderName || !folderPath)
        return null;
    // "Exact same name as the directory"
    if (file.basename !== folderName)
        return null;
    // Defensive: avoid odd cases where parent is the vault root with empty path.
    if (!folderPath || folderPath === "/")
        return null;
    return { folderPath, folderName };
}
/** Returns `true` when `file` is a folder note. */
export function isFolderNote(file) {
    if (!file)
        return false;
    return getFolderNoteInfo(file) !== null;
}
/* ------------------------------------------------------------------ */
/*  Card data accessors                                                */
/* ------------------------------------------------------------------ */
/** Cards in *this note only* (always available, regardless of folder-deck setting). */
export function getCardsInActiveNoteOnly(store, file) {
    if (!file)
        return [];
    return store.getAllCards().filter((c) => c.sourceNotePath === file.path);
}
/**
 * Returns cards in the active scope based on the setting:
 *  - Normal note → cards whose `sourceNotePath === file.path`
 *  - Folder note (setting enabled) → cards in all descendant notes
 *  - Folder note (setting disabled) → only cards in the folder note file
 */
export function getCardsInActiveScope(store, file, settings) {
    if (!file)
        return [];
    const folder = getFolderNoteInfo(file);
    const all = store.getAllCards();
    if (!folder) {
        return filterReviewableCards(all.filter((c) => c.sourceNotePath === file.path));
    }
    // Folder note – but feature disabled
    if (!folderNotesAsDecksEnabled(settings)) {
        return filterReviewableCards(all.filter((c) => c.sourceNotePath === file.path));
    }
    const prefix = folder.folderPath.endsWith("/") ? folder.folderPath : folder.folderPath + "/";
    return filterReviewableCards(all.filter((c) => typeof c.sourceNotePath === "string" && c.sourceNotePath.startsWith(prefix)));
}
/**
 * Computes summary counts (total, new, learning-due, review-due)
 * for an array of cards.
 */
export function computeCounts(cards, store) {
    var _a;
    const now = Date.now();
    const states = ((_a = store.data) === null || _a === void 0 ? void 0 : _a.states) || {};
    const total = cards.length;
    let nNew = 0, nLearn = 0, nDue = 0;
    for (const c of cards) {
        const st = states[c.id];
        if (!st)
            continue;
        if (st.stage === "new")
            nNew++;
        else if (st.stage === "learning" && st.due <= now)
            nLearn++;
        else if (st.stage === "review" && st.due <= now)
            nDue++;
    }
    return { total, new: nNew, learn: nLearn, due: nDue };
}
