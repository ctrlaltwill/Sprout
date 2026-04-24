/**
 * @file src/anki/anki-sql.ts
 * @summary SQLite operations for Anki database files using sql.js (WASM).
 * Provides lazy sql.js initialisation (bundled WASM, no CDN),
 * empty Anki DB creation with the full schema v11, insert/read helpers for
 * notes, cards, revlog, models, decks, and collection metadata.
 *
 * @exports
 *  - getSqlJs            — lazy-load sql.js WASM, cached for reuse
 *  - createEmptyAnkiDb   — new SQLite DB with Anki schema v11
 *  - insertCollection    — write the single `col` row
 *  - insertNote / insertCard / insertRevlogEntry — insert rows
 *  - readNotes / readCards / readRevlog — read all rows
 *  - readModels / readDecks / readCollectionCrt — read collection metadata
 */
import initSqlJs from "sql.js";
import wasmBinary from "sql.js/dist/sql-wasm.wasm";
import { ANKI_SCHEMA_VERSION, DEFAULT_DECK_ID, DEFAULT_DECK_NAME, makeBasicModel, makeClozeModel, } from "./anki-constants";
// ── Lazy sql.js loader ────────────────────────────────────────────────────────
let _sqlJs = null;
let _sqlJsPromise = null;
/**
 * Lazily initialise sql.js. Uses the bundled sql.js package and embedded WASM
 * binary (no CDN fetch). Subsequent calls return the cached instance.
 */
export async function getSqlJs() {
    if (_sqlJs)
        return _sqlJs;
    if (_sqlJsPromise)
        return _sqlJsPromise;
    _sqlJsPromise = (async () => {
        const wasmArray = wasmBinary instanceof Uint8Array
            ? wasmBinary
            : new Uint8Array(wasmBinary);
        const wasmBuffer = wasmArray.slice().buffer;
        _sqlJs = await initSqlJs({ wasmBinary: wasmBuffer });
        return _sqlJs;
    })().catch((err) => {
        // Reset so the next call retries instead of returning a stale rejected promise
        _sqlJsPromise = null;
        throw err;
    });
    return _sqlJsPromise;
}
// ── Database creation ─────────────────────────────────────────────────────────
/** Create a new empty Anki database with the full schema v11. */
export async function createEmptyAnkiDb() {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    db.run(`
    CREATE TABLE col (
      id integer primary key,
      crt integer not null,
      mod integer not null,
      scm integer not null,
      ver integer not null,
      dty integer not null,
      usn integer not null,
      ls integer not null,
      conf text not null,
      models text not null,
      decks text not null,
      dconf text not null,
      tags text not null
    );
  `);
    db.run(`
    CREATE TABLE notes (
      id integer primary key,
      guid text not null,
      mid integer not null,
      mod integer not null,
      usn integer not null,
      tags text not null,
      flds text not null,
      sfld integer not null,
      csum integer not null,
      flags integer not null,
      data text not null
    );
  `);
    db.run(`
    CREATE TABLE cards (
      id integer primary key,
      nid integer not null,
      did integer not null,
      ord integer not null,
      mod integer not null,
      usn integer not null,
      type integer not null,
      queue integer not null,
      due integer not null,
      ivl integer not null,
      factor integer not null,
      reps integer not null,
      lapses integer not null,
      left integer not null,
      odue integer not null,
      odid integer not null,
      flags integer not null,
      data text not null
    );
  `);
    db.run(`
    CREATE TABLE revlog (
      id integer primary key,
      cid integer not null,
      usn integer not null,
      ease integer not null,
      ivl integer not null,
      lastIvl integer not null,
      factor integer not null,
      time integer not null,
      type integer not null
    );
  `);
    db.run(`
    CREATE TABLE graves (
      usn integer not null,
      oid integer not null,
      type integer not null
    );
  `);
    db.run("CREATE INDEX ix_cards_nid ON cards (nid);");
    db.run("CREATE INDEX ix_cards_sched ON cards (did, queue, due);");
    db.run("CREATE INDEX ix_cards_usn ON cards (usn);");
    db.run("CREATE INDEX ix_notes_csum ON notes (csum);");
    db.run("CREATE INDEX ix_notes_usn ON notes (usn);");
    db.run("CREATE INDEX ix_revlog_cid ON revlog (cid);");
    db.run("CREATE INDEX ix_revlog_usn ON revlog (usn);");
    return db;
}
function makeDefaultDeck() {
    return {
        id: DEFAULT_DECK_ID,
        name: DEFAULT_DECK_NAME,
        mod: Math.floor(Date.now() / 1000),
        usn: -1,
        collapsed: false,
        browserCollapsed: false,
        desc: "",
        dyn: 0,
        conf: 1,
        extendNew: 10,
        extendRev: 50,
    };
}
function clampRetention(value) {
    if (!Number.isFinite(value))
        return 0.9;
    return Math.min(0.97, Math.max(0.8, value));
}
/** Insert the single `col` row with models, decks, and deck-options configuration. */
export function insertCollection(db, opts = {}) {
    var _a, _b, _c, _d;
    const now = Math.floor(Date.now() / 1000);
    const crt = (_a = opts.creationTimestamp) !== null && _a !== void 0 ? _a : now;
    const models = (_b = opts.models) !== null && _b !== void 0 ? _b : {
        [String(makeBasicModel().id)]: makeBasicModel(),
        [String(makeClozeModel().id)]: makeClozeModel(),
    };
    const decks = (_c = opts.decks) !== null && _c !== void 0 ? _c : {
        [String(DEFAULT_DECK_ID)]: makeDefaultDeck(),
    };
    const desiredRetention = clampRetention((_d = opts.desiredRetention) !== null && _d !== void 0 ? _d : 0.9);
    const fsrsParams = Array.isArray(opts.fsrsParams) ? opts.fsrsParams : undefined;
    // Keys must match Anki's DeckConfSchema11 serde format (camelCase).
    // See: rslib/src/deckconfig/schema11.rs
    //   fsrsWeights → fsrs_params_4  (FSRS-4, 17 params)
    //   fsrsParams5 → fsrs_params_5  (FSRS-5, 19 params)
    //   fsrsParams6 → fsrs_params_6  (FSRS-6, 21 params)
    //   desiredRetention → desired_retention
    const dconf = {
        "1": {
            autoplay: true,
            dyn: false,
            id: 1,
            lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
            maxTaken: 60,
            mod: 0,
            name: "Default",
            new: {
                bury: false,
                delays: [1, 10],
                initialFactor: 2500,
                ints: [1, 4, 0],
                order: 1,
                perDay: 20,
                separate: true,
            },
            replayq: true,
            rev: {
                bury: false,
                ease4: 1.3,
                fuzz: 0.05,
                ivlFct: 1,
                maxIvl: 36500,
                minSpace: 1,
                perDay: 200,
            },
            // FSRS parameters — correct schema11 key names
            desiredRetention,
            fsrsWeights: [], // FSRS-4 (empty → unused)
            fsrsParams5: [], // FSRS-5 (empty → unused)
            fsrsParams6: fsrsParams !== null && fsrsParams !== void 0 ? fsrsParams : [], // FSRS-6 (21 weights from ts-fsrs)
            sm2Retention: 0.9, // historicalRetention
            easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
            timer: 0,
            usn: -1,
        },
    };
    const conf = JSON.stringify({
        activeDecks: [1],
        curDeck: 1,
        newSpread: 0,
        collapseTime: 1200,
        timeLim: 0,
        estTimes: true,
        dueCounts: true,
        curModel: String(makeBasicModel().id),
        nextPos: 1,
        sortType: "noteFld",
        sortBackwards: false,
        addToCur: true,
    });
    db.run(`INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        1,
        crt,
        now * 1000,
        now * 1000,
        ANKI_SCHEMA_VERSION,
        0,
        -1,
        0,
        conf,
        JSON.stringify(models),
        JSON.stringify(decks),
        JSON.stringify(dconf),
        "{}",
    ]);
}
// ── Insert helpers ────────────────────────────────────────────────────────────
export function insertNote(db, note) {
    db.run(`INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        note.id,
        note.guid,
        note.mid,
        note.mod,
        note.usn,
        note.tags,
        note.flds,
        note.sfld,
        note.csum,
        note.flags,
        note.data,
    ]);
}
export function insertCard(db, card) {
    db.run(`INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        card.id, card.nid, card.did, card.ord, card.mod, card.usn,
        card.type, card.queue, card.due, card.ivl, card.factor,
        card.reps, card.lapses, card.left, card.odue, card.odid,
        card.flags, card.data,
    ]);
}
export function insertRevlogEntry(db, entry) {
    db.run(`INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        entry.id, entry.cid, entry.usn, entry.ease, entry.ivl,
        entry.lastIvl, entry.factor, entry.time, entry.type,
    ]);
}
// ── Read helpers ──────────────────────────────────────────────────────────────
export function readNotes(db) {
    const results = db.exec("SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes");
    if (!results.length)
        return [];
    return results[0].values.map((row) => ({
        id: Number(row[0]),
        guid: String(row[1]),
        mid: Number(row[2]),
        mod: Number(row[3]),
        usn: Number(row[4]),
        tags: String(row[5]),
        flds: String(row[6]),
        sfld: String(row[7]),
        csum: Number(row[8]),
        flags: Number(row[9]),
        data: String(row[10]),
    }));
}
export function readCards(db) {
    const results = db.exec("SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards");
    if (!results.length)
        return [];
    return results[0].values.map((row) => ({
        id: Number(row[0]),
        nid: Number(row[1]),
        did: Number(row[2]),
        ord: Number(row[3]),
        mod: Number(row[4]),
        usn: Number(row[5]),
        type: Number(row[6]),
        queue: Number(row[7]),
        due: Number(row[8]),
        ivl: Number(row[9]),
        factor: Number(row[10]),
        reps: Number(row[11]),
        lapses: Number(row[12]),
        left: Number(row[13]),
        odue: Number(row[14]),
        odid: Number(row[15]),
        flags: Number(row[16]),
        data: String(row[17]),
    }));
}
export function readRevlog(db) {
    const results = db.exec("SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog");
    if (!results.length)
        return [];
    return results[0].values.map((row) => ({
        id: Number(row[0]),
        cid: Number(row[1]),
        usn: Number(row[2]),
        ease: Number(row[3]),
        ivl: Number(row[4]),
        lastIvl: Number(row[5]),
        factor: Number(row[6]),
        time: Number(row[7]),
        type: Number(row[8]),
    }));
}
function parseJsonObject(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return parsed;
    }
    catch (_a) {
        return {};
    }
}
/** Read note-type models from the collection. */
export function readModels(db) {
    const results = db.exec("SELECT models FROM col LIMIT 1");
    if (!results.length || !results[0].values.length)
        return new Map();
    const modelsJson = String(results[0].values[0][0]);
    const models = parseJsonObject(modelsJson);
    const map = new Map();
    for (const [key, model] of Object.entries(models)) {
        if (!model || typeof model !== "object" || Array.isArray(model))
            continue;
        const id = Number(key);
        if (!Number.isFinite(id))
            continue;
        map.set(id, model);
    }
    return map;
}
/** Read decks from the collection. */
export function readDecks(db) {
    const results = db.exec("SELECT decks FROM col LIMIT 1");
    if (!results.length || !results[0].values.length)
        return new Map();
    const decksJson = String(results[0].values[0][0]);
    const decks = parseJsonObject(decksJson);
    const map = new Map();
    for (const [key, deck] of Object.entries(decks)) {
        if (!deck || typeof deck !== "object" || Array.isArray(deck))
            continue;
        const id = Number(key);
        if (!Number.isFinite(id))
            continue;
        map.set(id, deck);
    }
    return map;
}
/** Read the collection creation timestamp (epoch seconds). */
export function readCollectionCrt(db) {
    const results = db.exec("SELECT crt FROM col LIMIT 1");
    if (!results.length || !results[0].values.length)
        return Math.floor(Date.now() / 1000);
    return Number(results[0].values[0][0]);
}
