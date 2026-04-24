/**
 * @file src/anki/anki-constants.ts
 * @summary Constants, type definitions, and note-type model blueprints for Anki interop.
 * Defines the Anki SQLite schema version, field separator, model IDs, card/queue/ease
 * enumerations, SQL row types, and factory functions for building the Basic and Cloze
 * note-type models embedded in exported .apkg files.
 *
 * @exports
 *  - Schema & separator constants
 *  - Card type, queue, revlog, and ease constants
 *  - AnkiNoteRow, AnkiCardRow, AnkiRevlogRow, AnkiModel, AnkiDeck — row types
 *  - makeBasicModel, makeClozeModel — full model JSON builders
 */
// ── Anki schema ────────────────────────────────────────────────────────────────
export const ANKI_SCHEMA_VERSION = 11;
/** Anki separates fields within a note using the Unit Separator (U+001F). */
export const ANKI_FIELD_SEPARATOR = "\x1f";
// ── Stable model IDs (arbitrary but deterministic) ─────────────────────────────
export const BASIC_MODEL_ID = 1704067200000; // 2024-01-01T00:00:00Z
export const CLOZE_MODEL_ID = 1704067200001;
// ── Default deck ───────────────────────────────────────────────────────────────
export const DEFAULT_DECK_ID = 1;
export const DEFAULT_DECK_NAME = "Default";
// ── Anki card type integers ────────────────────────────────────────────────────
export const ANKI_CARD_TYPE_NEW = 0;
export const ANKI_CARD_TYPE_LEARNING = 1;
export const ANKI_CARD_TYPE_REVIEW = 2;
export const ANKI_CARD_TYPE_RELEARNING = 3;
// ── Anki queue integers ────────────────────────────────────────────────────────
export const ANKI_QUEUE_SUSPENDED = -1;
export const ANKI_QUEUE_NEW = 0;
export const ANKI_QUEUE_LEARNING = 1;
export const ANKI_QUEUE_REVIEW = 2;
// ── Anki ease (button) integers ────────────────────────────────────────────────
export const ANKI_EASE_AGAIN = 1;
export const ANKI_EASE_HARD = 2;
export const ANKI_EASE_GOOD = 3;
export const ANKI_EASE_EASY = 4;
// ── Model factories ────────────────────────────────────────────────────────────
const LATEX_PRE = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";
const LATEX_POST = "\\end{document}";
const BASE_CSS = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.extra { font-size: 16px; color: #555; }";
function makeField(name, ord) {
    return { name, ord, font: "Arial", media: [], rtl: false, size: 20, sticky: false };
}
/** Full Basic note-type model (Front / Back / Explanation). */
export function makeBasicModel(id = BASIC_MODEL_ID) {
    return {
        id,
        name: "Sprout Basic",
        type: 0,
        flds: [makeField("Front", 0), makeField("Back", 1), makeField("Explanation", 2)],
        tmpls: [
            {
                name: "Card 1",
                ord: 0,
                qfmt: "{{Front}}",
                afmt: '{{FrontSide}}<hr id=answer>{{Back}}<br><br><div class="extra">{{Explanation}}</div>',
                bafmt: "",
                bqfmt: "",
                did: null,
            },
        ],
        css: BASE_CSS,
        did: DEFAULT_DECK_ID,
        mod: Math.floor(Date.now() / 1000),
        usn: -1,
        sortf: 0,
        tags: [],
        vers: [],
        latexPre: LATEX_PRE,
        latexPost: LATEX_POST,
    };
}
/** Full Cloze note-type model (Cloze / Explanation). */
export function makeClozeModel(id = CLOZE_MODEL_ID) {
    return {
        id,
        name: "Sprout Cloze",
        type: 1,
        flds: [makeField("Cloze", 0), makeField("Explanation", 1)],
        tmpls: [
            {
                name: "Cloze",
                ord: 0,
                qfmt: "{{cloze:Cloze}}",
                afmt: '{{cloze:Cloze}}<br><br><div class="extra">{{Explanation}}</div>',
                bafmt: "",
                bqfmt: "",
                did: null,
            },
        ],
        css: BASE_CSS + "\n.cloze { font-weight: bold; color: blue; }",
        did: DEFAULT_DECK_ID,
        mod: Math.floor(Date.now() / 1000),
        usn: -1,
        sortf: 0,
        tags: [],
        vers: [],
        latexPre: LATEX_PRE,
        latexPost: LATEX_POST,
    };
}
