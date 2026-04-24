/**
 * @file src/anki/anki-export.ts
 * @summary Export engine: builds an .apkg file from Sprout store data.
 * Gathers cards by scope, creates an in-memory Anki SQLite database with
 * note-type models, decks mapped from Sprout groups, note/card/revlog rows,
 * and optional media — then packages everything as a .apkg ZIP.
 *
 * @exports
 *  - ExportOptions / ExportResult — option and result types
 *  - exportToApkg — main export function → Uint8Array (.apkg bytes)
 */
import { generatorParameters } from "ts-fsrs";
import { clamp } from "../../../views/settings/settings-utils";
import { BASIC_MODEL_ID, CLOZE_MODEL_ID, DEFAULT_DECK_ID, makeBasicModel, makeClozeModel, } from "./anki-constants";
import { log } from "../../core/logger";
import { createEmptyAnkiDb, insertCollection, insertNote, insertCard, insertRevlogEntry, } from "./anki-sql";
import { cardRecordToAnkiNote, cardStateToAnkiCard, reviewLogToAnkiRevlog, } from "./anki-mapper";
import { groupPathToAnkiDeck, generateAnkiId, _resetIdCounter, } from "./anki-utils";
import { collectMediaRefs, resolveVaultMedia, rewriteFieldForAnki } from "./anki-media";
import { packApkg } from "./anki-zip";
// ── Main export function ──────────────────────────────────────────────────────
export async function exportToApkg(plugin, options) {
    var _a, _b;
    _resetIdCounter();
    const store = plugin.store;
    const allCards = store.getAllCards();
    // ── Step 1: Filter cards ──────────────────────────────────────────────────
    let cards = allCards.filter((c) => {
        // Exclude IO types (not supported by this export)
        if (c.type === "io" || c.type === "io-child")
            return false;
        // Exclude cloze children — the parent note generates Anki cards from cloze indices
        if (c.type === "cloze-child")
            return false;
        // Exclude reversed children — the parent reversed card is the export unit
        if (c.type === "reversed-child")
            return false;
        return true;
    });
    // Scope filter
    if (options.scope === "deck" && options.deckPath) {
        const dp = options.deckPath;
        cards = cards.filter((c) => {
            var _a;
            const sp = (_a = c.sourceNotePath) !== null && _a !== void 0 ? _a : "";
            return sp.startsWith(dp + "/") || sp === dp || sp.replace(/\.md$/i, "") === dp;
        });
    }
    else if (options.scope === "group" && ((_a = options.groupKeys) === null || _a === void 0 ? void 0 : _a.length)) {
        const gks = options.groupKeys.map((g) => g.toLowerCase());
        cards = cards.filter((c) => {
            if (!Array.isArray(c.groups))
                return false;
            return gks.some((gk) => c.groups.some((g) => g.toLowerCase() === gk || g.toLowerCase().startsWith(gk + "/")));
        });
    }
    else if (options.scope === "note" && options.noteKey) {
        cards = cards.filter((c) => c.sourceNotePath === options.noteKey);
    }
    // MCQ strategy
    let mcqConverted = 0;
    let mcqSkipped = 0;
    if (options.mcqStrategy === "skip") {
        const before = cards.length;
        cards = cards.filter((c) => c.type !== "mcq");
        mcqSkipped = before - cards.length;
    }
    else {
        mcqConverted = cards.filter((c) => c.type === "mcq").length;
    }
    const ioSkipped = allCards.filter((c) => c.type === "io" || c.type === "io-child").length;
    // ── Step 2: Build deck hierarchy from groups ──────────────────────────────
    const deckMap = new Map(); // deckName → deckId
    deckMap.set(options.defaultDeckName, DEFAULT_DECK_ID);
    const deckObjects = {};
    const now = Math.floor(Date.now() / 1000);
    const makeDeck = (id, name) => ({
        id,
        name,
        mod: now,
        usn: -1,
        collapsed: false,
        browserCollapsed: false,
        desc: "",
        dyn: 0,
        conf: 1,
        extendNew: 10,
        extendRev: 50,
        newToday: [0, 0],
        revToday: [0, 0],
        lrnToday: [0, 0],
        timeToday: [0, 0],
    });
    deckObjects[String(DEFAULT_DECK_ID)] = makeDeck(DEFAULT_DECK_ID, options.defaultDeckName);
    /** Ensure a deck AND all its ancestors exist in the deck map. */
    const ensureDeck = (deckName) => {
        const existing = deckMap.get(deckName);
        if (existing !== undefined)
            return existing;
        // Ensure parent exists first (e.g. "A::B" before "A::B::C")
        const sepIdx = deckName.lastIndexOf("::");
        if (sepIdx > 0) {
            ensureDeck(deckName.substring(0, sepIdx));
        }
        const id = generateAnkiId();
        deckMap.set(deckName, id);
        deckObjects[String(id)] = makeDeck(id, deckName);
        return id;
    };
    const usedDeckIds = new Set();
    const getDeckId = (card) => {
        let deckName = "";
        // Prefer vault folder hierarchy for deck naming
        if (card.sourceNotePath) {
            const cleanPath = card.sourceNotePath.replace(/\\/g, "/").replace(/^\.\//, "");
            const parts = cleanPath.split("/").filter(Boolean);
            if (parts.length > 1) {
                const notePathNoExt = cleanPath.replace(/\.md$/i, "");
                if (notePathNoExt)
                    deckName = groupPathToAnkiDeck(notePathNoExt);
            }
        }
        // Fallback: use first group if present
        if (!deckName && Array.isArray(card.groups) && card.groups.length > 0) {
            deckName = groupPathToAnkiDeck(card.groups[0]);
        }
        if (!deckName) {
            usedDeckIds.add(DEFAULT_DECK_ID);
            return DEFAULT_DECK_ID;
        }
        const id = ensureDeck(deckName);
        usedDeckIds.add(id);
        return id;
    };
    // ── Step 3: Collect media ─────────────────────────────────────────────────
    let mediaBytes = new Map();
    const mediaNames = new Set();
    if (options.includeMedia) {
        const allRefs = new Set();
        const notePaths = new Set();
        for (const card of cards) {
            const refs = collectMediaRefs([card.q, card.a, card.info, card.clozeText, card.stem]);
            for (const ref of refs)
                allRefs.add(ref);
            if (card.sourceNotePath)
                notePaths.add(card.sourceNotePath);
        }
        if (allRefs.size > 0) {
            mediaBytes = await resolveVaultMedia(plugin.app, allRefs, Array.from(notePaths));
            for (const name of mediaBytes.keys())
                mediaNames.add(name);
        }
    }
    // ── Step 4: Create database and insert data ───────────────────────────────
    const db = await createEmptyAnkiDb();
    const collectionCrt = Math.floor(Date.now() / 1000);
    const models = {
        [String(BASIC_MODEL_ID)]: makeBasicModel(),
        [String(CLOZE_MODEL_ID)]: makeClozeModel(),
    };
    // Pre-pass to build full deck list before writing collection metadata
    for (const card of cards) {
        getDeckId(card);
    }
    // Safety: ensure every referenced deck ID exists in the decks JSON
    for (const did of usedDeckIds) {
        if (!deckObjects[String(did)]) {
            deckObjects[String(did)] = makeDeck(did, `Recovered Deck ${did}`);
            log.warn("Anki export: added missing deck", { did });
        }
    }
    const { fsrsParams, desiredRetention } = buildFsrsParamsFromSettings((_b = plugin.settings) === null || _b === void 0 ? void 0 : _b.scheduling);
    insertCollection(db, {
        creationTimestamp: collectionCrt,
        models,
        decks: deckObjects,
        fsrsParams,
        desiredRetention,
    });
    let notesExported = 0;
    let cardsExported = 0;
    let revlogEntries = 0;
    // Build review log index by card ID
    const revlogByCardId = new Map();
    if (options.includeRevlog) {
        const allRevlog = store.data.reviewLog || [];
        for (const entry of allRevlog) {
            const existing = revlogByCardId.get(entry.id) || [];
            existing.push(entry);
            revlogByCardId.set(entry.id, existing);
        }
    }
    for (const card of cards) {
        const deckId = getDeckId(card);
        // Rewrite media refs if needed
        const exportCard = options.includeMedia ? rewriteMediaInCard(card, mediaNames) : card;
        // Create Anki note row
        const noteRow = cardRecordToAnkiNote(exportCard);
        insertNote(db, noteRow);
        notesExported++;
        // Create Anki card row(s)
        const state = store.getState(card.id);
        if (card.type === "cloze") {
            // Cloze: one card per cloze deletion index
            const clozeIndices = extractClozeIndices(card.clozeText || "");
            for (const idx of clozeIndices) {
                const ankiCard = state && options.includeScheduling
                    ? cardStateToAnkiCard(state, noteRow.id, deckId, idx - 1, collectionCrt)
                    : makeNewAnkiCard(noteRow.id, deckId, idx - 1);
                insertCard(db, ankiCard);
                cardsExported++;
                if (options.includeRevlog) {
                    const entries = revlogByCardId.get(card.id) || [];
                    for (const entry of entries) {
                        insertRevlogEntry(db, reviewLogToAnkiRevlog(entry, ankiCard.id));
                        revlogEntries++;
                    }
                }
            }
        }
        else {
            // Basic or MCQ→Basic: single card
            const ankiCard = state && options.includeScheduling
                ? cardStateToAnkiCard(state, noteRow.id, deckId, 0, collectionCrt)
                : makeNewAnkiCard(noteRow.id, deckId, 0);
            insertCard(db, ankiCard);
            cardsExported++;
            if (options.includeRevlog) {
                const entries = revlogByCardId.get(card.id) || [];
                for (const entry of entries) {
                    insertRevlogEntry(db, reviewLogToAnkiRevlog(entry, ankiCard.id));
                    revlogEntries++;
                }
            }
        }
    }
    // ── Step 5: Export as .apkg ───────────────────────────────────────────────
    const sqliteBytes = db.export();
    db.close();
    const apkgBytes = packApkg(new Uint8Array(sqliteBytes), mediaBytes);
    return {
        apkgBytes,
        stats: {
            notesExported,
            cardsExported,
            revlogEntries,
            mediaFiles: mediaBytes.size,
            mcqConverted,
            mcqSkipped,
            ioSkipped,
        },
    };
}
// ── Internal helpers ──────────────────────────────────────────────────────────
function extractClozeIndices(text) {
    const re = /\{\{c(\d+)::/g;
    const indices = new Set();
    let m;
    while ((m = re.exec(text)) !== null) {
        indices.add(Number(m[1]));
    }
    return indices.size > 0 ? Array.from(indices).sort((a, b) => a - b) : [1];
}
function makeNewAnkiCard(noteId, deckId, ord) {
    return {
        id: generateAnkiId(),
        nid: noteId,
        did: deckId,
        ord,
        mod: Math.floor(Date.now() / 1000),
        usn: -1,
        type: 0,
        queue: 0,
        due: 0,
        ivl: 0,
        factor: 0,
        reps: 0,
        lapses: 0,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: "",
    };
}
function rewriteMediaInCard(card, mediaNames) {
    const rw = (s) => s ? rewriteFieldForAnki(s, mediaNames) : s;
    return {
        ...card,
        q: rw(card.q),
        a: rw(card.a),
        info: rw(card.info),
        clozeText: rw(card.clozeText),
        stem: rw(card.stem),
    };
}
function minutesToStepUnit(m) {
    const mm = Math.max(1, Math.round(m));
    if (mm % 1440 === 0)
        return `${mm / 1440}d`;
    if (mm % 60 === 0)
        return `${mm / 60}h`;
    return `${mm}m`;
}
function buildFsrsParamsFromSettings(cfg) {
    var _a, _b, _c, _d, _e;
    const safeCfg = {
        learningStepsMinutes: (_a = cfg === null || cfg === void 0 ? void 0 : cfg.learningStepsMinutes) !== null && _a !== void 0 ? _a : [10],
        relearningStepsMinutes: (_b = cfg === null || cfg === void 0 ? void 0 : cfg.relearningStepsMinutes) !== null && _b !== void 0 ? _b : [],
        requestRetention: (_c = cfg === null || cfg === void 0 ? void 0 : cfg.requestRetention) !== null && _c !== void 0 ? _c : 0.9,
    };
    const learning = ((_d = safeCfg.learningStepsMinutes) !== null && _d !== void 0 ? _d : []).map(minutesToStepUnit);
    const relearningRaw = Array.isArray(safeCfg.relearningStepsMinutes)
        ? safeCfg.relearningStepsMinutes
        : [];
    const relearning = relearningRaw.length > 0
        ? relearningRaw.map(minutesToStepUnit)
        : [(learning.length ? learning[0] : "10m")];
    const desiredRetention = clamp(Number(safeCfg.requestRetention) || 0.9, 0.8, 0.97);
    const params = generatorParameters({
        request_retention: desiredRetention,
        maximum_interval: 36500,
        enable_fuzz: false,
        enable_short_term: true,
        learning_steps: learning.length ? learning : ["10m"],
        relearning_steps: relearning,
    });
    // params is an object with a `.w` property holding the weight array
    // (Array.from(params) returns [] because it's a plain object, not iterable)
    return { fsrsParams: Array.from((_e = params.w) !== null && _e !== void 0 ? _e : []), desiredRetention };
}
