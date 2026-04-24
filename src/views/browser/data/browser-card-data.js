/**
 * @file src/browser/browser-card-data.ts
 * @summary Data filtering, sorting, and field read/write logic for the Flashcard
 * Browser. Provides pure-ish helper functions that take the plugin or store
 * explicitly (rather than relying on view instance state) so the logic is
 * testable in isolation. Handles search-query parsing, type/stage/due filtering,
 * group-based filtering, sort-value computation, cell-value application, field
 * reading, and pre-write validation.
 *
 * @exports
 *   - BrowserRow — interface representing a single row (card + state + due timestamp)
 *   - computeBrowserRows — builds the full filtered and sorted list of rows for the browser table
 *   - browserSortValue — computes a comparable sort value for a card given a sort key
 *   - applyValueToCard — applies an edited cell value back onto a card record (returns a deep clone)
 *   - readCardField — reads the display value for a given column from a card
 *   - validateCardBeforeWrite — validates a card's fields before writing to markdown, throws on failure
 */
import { normalizeCardOptions } from "../../../platform/core/store";
import { getGroupIndex, normaliseGroupPath } from "../../../engine/indexing/group-index";
import { fmtGroups, coerceGroups } from "../../../engine/indexing/group-format";
import { buildAnswerOrOptionsFor, buildQuestionFor, parseMcqOptionsFromCell, validateClozeText, } from "../../reviewer/fields";
import { stageLabel } from "../../reviewer/labels";
import { fmtDue, fmtLocation, parseSearchQuery, searchText, startOfTodayMs, endOfTodayMs, typeLabelBrowser, parseGroupsInput, } from "../browser-helpers";
// ── computeBrowserRows ────────────────────────────────────
/**
 * Build the full, filtered, and sorted list of rows for the browser table.
 *
 * This replaces the old `SproutCardBrowserView.computeRows()` instance
 * method — all view state that used to come from `this` is now passed in
 * as explicit parameters.
 */
export function computeBrowserRows(plugin, query, typeFilter, stageFilter, dueFilter, sortKey, sortAsc) {
    const parsed = parseSearchQuery(query || "");
    const textQ = (parsed.text || "").trim().toLowerCase();
    const groupFilters = parsed.groups || [];
    const typeFiltersFromQuery = (parsed.types || []).map((t) => t.toLowerCase()).filter(Boolean);
    const now = Date.now();
    const sToday = startOfTodayMs();
    const eToday = endOfTodayMs();
    const quarantine = (plugin.store.data.quarantine || {});
    const includeQuarantined = true;
    let baseCards = [];
    if (groupFilters.length) {
        const cardsObj = plugin.store.data.cards || {};
        if (includeQuarantined) {
            const matchesGroups = (card) => {
                const groups = coerceGroups(card.groups)
                    .map((g) => normaliseGroupPath(g) || null)
                    .filter((x) => !!x);
                if (!groups.length)
                    return false;
                return groupFilters.every((g) => groups.some((cg) => cg === g || cg.startsWith(`${g}/`)));
            };
            baseCards = Object.values(cardsObj).filter((c) => matchesGroups(c));
        }
        else {
            const gx = getGroupIndex(plugin);
            let idSet = null;
            for (const g of groupFilters) {
                const ids = gx.getIds(g);
                if (!idSet)
                    idSet = new Set(ids);
                else {
                    const next = new Set();
                    for (const id of idSet)
                        if (ids.has(id))
                            next.add(id);
                    idSet = next;
                }
            }
            for (const id of idSet || []) {
                if (quarantine[String(id)])
                    continue;
                const c = cardsObj[String(id)];
                if (c)
                    baseCards.push(c);
            }
        }
    }
    else {
        if (includeQuarantined)
            baseCards = Object.values(plugin.store.data.cards || {});
        else
            baseCards = plugin.store.getAllCards();
    }
    baseCards = baseCards.filter((c) => !["io-child", "cloze-child", "reversed-child"].includes(String((c === null || c === void 0 ? void 0 : c.type) || "")));
    if (includeQuarantined && groupFilters.length === 0) {
        const seenIds = new Set(baseCards.map((c) => String(c.id)));
        for (const id of Object.keys(quarantine)) {
            if (seenIds.has(String(id)))
                continue;
            const entry = quarantine[String(id)];
            baseCards.push({
                id: String(id),
                type: "basic",
                title: null,
                q: null,
                a: null,
                info: (entry === null || entry === void 0 ? void 0 : entry.reason) ? `Quarantine: ${entry.reason}` : "Quarantined card",
                groups: null,
                sourceNotePath: (entry === null || entry === void 0 ? void 0 : entry.notePath) || "",
                sourceStartLine: Number(entry === null || entry === void 0 ? void 0 : entry.sourceStartLine) || 0,
            });
        }
    }
    let rows = baseCards.map((c) => {
        var _a;
        const st = plugin.store.getState(String(c.id));
        const quarantined = !!quarantine[String(c.id)];
        const stage = quarantined ? "quarantined" : String((st === null || st === void 0 ? void 0 : st.stage) || "new");
        const dueMs = quarantined || stage === "suspended" ? null : ((_a = st === null || st === void 0 ? void 0 : st.due) !== null && _a !== void 0 ? _a : null);
        return { card: c, state: st, dueMs };
    });
    if (!includeQuarantined)
        rows = rows.filter((r) => !quarantine[String(r.card.id)]);
    if (typeFilter !== "all")
        rows = rows.filter((r) => String(r.card.type) === typeFilter);
    if (typeFiltersFromQuery.length) {
        rows = rows.filter((r) => typeFiltersFromQuery.includes(String(r.card.type || "").toLowerCase()));
    }
    if (stageFilter !== "all") {
        if (stageFilter === "quarantined") {
            rows = rows.filter((r) => !!quarantine[String(r.card.id)]);
        }
        else {
            rows = rows.filter((r) => { var _a; return (((_a = r.state) === null || _a === void 0 ? void 0 : _a.stage) || "new") === stageFilter; });
        }
    }
    if (dueFilter !== "all") {
        rows = rows.filter((r) => {
            const due = r.dueMs;
            if (quarantine[String(r.card.id)])
                return false;
            if (due == null || !Number.isFinite(due))
                return dueFilter === "later";
            if (dueFilter === "due")
                return due <= now;
            if (dueFilter === "today")
                return due >= sToday && due <= eToday;
            return due > eToday;
        });
    }
    if (textQ)
        rows = rows.filter((r) => searchText(r.card).includes(textQ));
    const dir = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
        const av = browserSortValue(a.card, a.state, a.dueMs, sortKey, plugin);
        const bv = browserSortValue(b.card, b.state, b.dueMs, sortKey, plugin);
        if (typeof av === "number" && typeof bv === "number")
            return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
}
// ── Sort value ────────────────────────────────────────────
export function browserSortValue(card, state, dueMs, key, plugin) {
    if (key === "due")
        return dueMs !== null && dueMs !== void 0 ? dueMs : Number.POSITIVE_INFINITY;
    if (key === "id")
        return card.id;
    if (key === "type")
        return typeLabelBrowser(card.type);
    if (key === "stage") {
        if (plugin.store.isQuarantined(card.id))
            return "Quarantined";
        return stageLabel(String((state === null || state === void 0 ? void 0 : state.stage) || "new"));
    }
    if (key === "location")
        return card.sourceNotePath || "";
    if (key === "groups")
        return fmtGroups(card.groups);
    if (key === "title")
        return (card.title || "").split(/\r?\n/)[0] || "";
    if (key === "question")
        return buildQuestionFor(card);
    if (key === "answer")
        return card.type === "cloze" ? "" : buildAnswerOrOptionsFor(card);
    if (key === "info")
        return card.info || "";
    return "";
}
// ── applyValueToCard ──────────────────────────────────────
/** Apply an edited cell value back onto a card record (returns a deep clone). */
export function applyValueToCard(card, col, value) {
    var _a;
    const draft = JSON.parse(JSON.stringify(card));
    const v = value !== null && value !== void 0 ? value : "";
    if (col === "title") {
        draft.title = v;
        return draft;
    }
    if (col === "question") {
        if (draft.type === "io")
            return draft;
        if (draft.type === "basic" || draft.type === "reversed")
            draft.q = v;
        else if (draft.type === "mcq")
            draft.stem = v;
        else if (draft.type === "cloze")
            draft.clozeText = v;
        else if (draft.type === "oq")
            draft.q = v;
        return draft;
    }
    if (col === "answer") {
        if (draft.type === "io")
            return draft;
        if (draft.type === "basic" || draft.type === "reversed") {
            draft.a = v;
            return draft;
        }
        if (draft.type === "mcq") {
            const parsed = parseMcqOptionsFromCell(v);
            draft.options = parsed.options;
            draft.correctIndex = parsed.correctIndex;
            draft.correctIndices = (_a = parsed.correctIndices) !== null && _a !== void 0 ? _a : null;
            return draft;
        }
        if (draft.type === "oq") {
            // Parse numbered steps: "1. Step one | 2. Step two" or newline-separated
            const raw = v.replace(/\s*\|\s*/g, "\n");
            const steps = raw.split(/\n/).map((line) => line.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
            draft.oqSteps = steps.length ? steps : [];
            return draft;
        }
        return draft;
    }
    if (col === "info") {
        draft.info = v;
        return draft;
    }
    if (col === "groups") {
        const groups = parseGroupsInput(v);
        draft.groups = groups.length ? groups : null;
        return draft;
    }
    return draft;
}
// ── readCardField ─────────────────────────────────────────
/** Read the display value for a given column from a card. */
export function readCardField(card, col, plugin) {
    if (col === "id")
        return String(card.id);
    if (col === "type")
        return typeLabelBrowser(card.type);
    if (col === "stage") {
        if (plugin.store.isQuarantined(card.id))
            return "Quarantined";
        const st = plugin.store.getState(card.id);
        const stage = (st === null || st === void 0 ? void 0 : st.stage) || "new";
        return stageLabel(String(stage));
    }
    if (col === "due") {
        const st = plugin.store.getState(card.id);
        if (plugin.store.isQuarantined(card.id))
            return "Quarantined";
        if (st && Number.isFinite(st.due)) {
            return fmtDue(st.due);
        }
        return "—";
    }
    if (col === "title")
        return (card.title || "").split(/\r?\n/)[0] || "";
    if (col === "question")
        return buildQuestionFor(card);
    if (col === "answer")
        return card.type === "cloze" ? "" : buildAnswerOrOptionsFor(card);
    if (col === "info")
        return card.info || "";
    if (col === "location")
        return fmtLocation(card.sourceNotePath);
    if (col === "groups")
        return fmtGroups(card.groups);
    return "";
}
// ── validateCardBeforeWrite ───────────────────────────────
/**
 * Validate a card's fields before writing to markdown.
 * Throws a descriptive Error if validation fails.
 */
export function validateCardBeforeWrite(card) {
    if (card.type === "basic" || card.type === "reversed") {
        if (!(card.q || "").trim())
            throw new Error("Q: is required.");
        if (!(card.a || "").trim())
            throw new Error("A: is required.");
    }
    else if (card.type === "cloze") {
        validateClozeText(card.clozeText || "");
    }
    else if (card.type === "mcq") {
        if (!(card.stem || "").trim())
            throw new Error("MCQ: is required.");
        const opts = normalizeCardOptions(card.options)
            .map((x) => (x || "").trim()).filter(Boolean);
        if (opts.length < 2)
            throw new Error("MCQ requires at least 2 options.");
        const ci = card.correctIndices;
        if (Array.isArray(ci) && ci.length > 0) {
            // Multi-answer: every index must be in range
            if (!ci.every((i) => Number.isFinite(i) && i >= 0 && i < opts.length)) {
                throw new Error("MCQ correct indices out of range.");
            }
        }
        else if (!(Number.isFinite(card.correctIndex) &&
            card.correctIndex >= 0 &&
            card.correctIndex < opts.length)) {
            throw new Error("MCQ requires at least one correct option.");
        }
        card.options = opts;
    }
    else if (card.type === "oq") {
        if (!(card.q || "").trim())
            throw new Error("OQ question is required.");
        const steps = Array.isArray(card.oqSteps)
            ? card.oqSteps.map((x) => (x || "").trim()).filter(Boolean)
            : [];
        if (steps.length < 2)
            throw new Error("OQ requires at least 2 steps.");
        if (steps.length > 20)
            throw new Error("OQ supports a maximum of 20 steps.");
        card.oqSteps = steps;
    }
}
