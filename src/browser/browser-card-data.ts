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

import type SproutPlugin from "../main";
import type { CardRecord, CardState, QuarantineEntry } from "../core/store";
import { getGroupIndex, normaliseGroupPath } from "../indexes/group-index";
import { fmtGroups, coerceGroups } from "../indexes/group-format";
import {
  buildAnswerOrOptionsFor,
  buildQuestionFor,
  parseMcqOptionsFromCell,
  validateClozeText,
} from "../reviewer/fields";
import { stageLabel } from "../reviewer/labels";
import {
  type TypeFilter,
  type StageFilter,
  type DueFilter,
  type ColKey,
  type SortKey,
  fmtDue,
  fmtLocation,
  parseSearchQuery,
  searchText,
  startOfTodayMs,
  endOfTodayMs,
  typeLabelBrowser,
  parseGroupsInput,
} from "./browser-helpers";

// ── Row type ──────────────────────────────────────────────

export interface BrowserRow {
  card: CardRecord;
  state: CardState | null;
  dueMs: number | null;
}

// ── computeBrowserRows ────────────────────────────────────

/**
 * Build the full, filtered, and sorted list of rows for the browser table.
 *
 * This replaces the old `SproutCardBrowserView.computeRows()` instance
 * method — all view state that used to come from `this` is now passed in
 * as explicit parameters.
 */
export function computeBrowserRows(
  plugin: SproutPlugin,
  query: string,
  typeFilter: TypeFilter,
  stageFilter: StageFilter,
  dueFilter: DueFilter,
  sortKey: SortKey,
  sortAsc: boolean,
): BrowserRow[] {
  const parsed = parseSearchQuery(query || "");
  const textQ = (parsed.text || "").trim().toLowerCase();
  const groupFilters = parsed.groups || [];
  const typeFiltersFromQuery = (parsed.types || []).map((t) => t.toLowerCase()).filter(Boolean);

  const now = Date.now();
  const sToday = startOfTodayMs();
  const eToday = endOfTodayMs();
  const quarantine = (plugin.store.data.quarantine || {}) as Record<string, QuarantineEntry>;
  const includeQuarantined = true;

  let baseCards: CardRecord[] = [];

  if (groupFilters.length) {
    const cardsObj = plugin.store.data.cards || {};

    if (includeQuarantined) {
      const matchesGroups = (card: CardRecord) => {
        const groups = coerceGroups(card.groups)
          .map((g) => normaliseGroupPath(g) || null)
          .filter((x): x is string => !!x);
        if (!groups.length) return false;
        return groupFilters.every((g) => groups.some((cg) => cg === g || cg.startsWith(`${g}/`)));
      };

      baseCards = Object.values(cardsObj).filter((c) => matchesGroups(c));
    } else {
      const gx = getGroupIndex(plugin);

      let idSet: Set<string> | null = null;
      for (const g of groupFilters) {
        const ids = gx.getIds(g);
        if (!idSet) idSet = new Set<string>(ids);
        else {
          const next = new Set<string>();
          for (const id of idSet) if (ids.has(id)) next.add(id);
          idSet = next;
        }
      }

      for (const id of idSet || []) {
        if (quarantine[String(id)]) continue;
        const c = cardsObj[String(id)];
        if (c) baseCards.push(c);
      }
    }
  } else {
    if (includeQuarantined) baseCards = Object.values(plugin.store.data.cards || {});
    else baseCards = plugin.store.getAllCards();
  }

  baseCards = baseCards.filter(
    (c) => !["io-child", "cloze-child"].includes(String(c?.type || "")),
  );

  if (includeQuarantined && groupFilters.length === 0) {
    const seenIds = new Set(baseCards.map((c) => String(c.id)));
    for (const id of Object.keys(quarantine)) {
      if (seenIds.has(String(id))) continue;
      const entry = quarantine[String(id)];
      baseCards.push({
        id: String(id),
        type: "basic",
        title: null,
        q: null,
        a: null,
        info: entry?.reason ? `Quarantine: ${entry.reason}` : "Quarantined card",
        groups: null,
        sourceNotePath: entry?.notePath || "",
        sourceStartLine: Number(entry?.sourceStartLine) || 0,
      });
    }
  }

  let rows = baseCards.map((c) => {
    const st = plugin.store.getState(String(c.id));
    const quarantined = !!quarantine[String(c.id)];
    const stage = quarantined ? "quarantined" : String(st?.stage || "new");
    const dueMs = quarantined || stage === "suspended" ? null : (st?.due ?? null);
    return { card: c, state: st, dueMs };
  });

  if (!includeQuarantined) rows = rows.filter((r) => !quarantine[String(r.card.id)]);

  if (typeFilter !== "all") rows = rows.filter((r) => String(r.card.type) === typeFilter);

  if (typeFiltersFromQuery.length) {
    rows = rows.filter((r) => typeFiltersFromQuery.includes(String(r.card.type || "").toLowerCase()));
  }

  if (stageFilter !== "all") {
    if (stageFilter === "quarantined") {
      rows = rows.filter((r) => !!quarantine[String(r.card.id)]);
    } else {
      rows = rows.filter((r) => (r.state?.stage || "new") === stageFilter);
    }
  }

  if (dueFilter !== "all") {
    rows = rows.filter((r) => {
      const due = r.dueMs;
      if (quarantine[String(r.card.id)]) return false;
      if (due == null || !Number.isFinite(due)) return dueFilter === "later";
      if (dueFilter === "due") return due <= now;
      if (dueFilter === "today") return due >= sToday && due <= eToday;
      return due > eToday;
    });
  }

  if (textQ) rows = rows.filter((r) => searchText(r.card).includes(textQ));

  const dir = sortAsc ? 1 : -1;
  rows.sort((a, b) => {
    const av = browserSortValue(a.card, a.state, a.dueMs, sortKey, plugin);
    const bv = browserSortValue(b.card, b.state, b.dueMs, sortKey, plugin);

    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  return rows;
}

// ── Sort value ────────────────────────────────────────────

export function browserSortValue(
  card: CardRecord,
  state: CardState | null,
  dueMs: number | null,
  key: SortKey,
  plugin: SproutPlugin,
): string | number {
  if (key === "due") return dueMs ?? Number.POSITIVE_INFINITY;
  if (key === "id") return card.id;
  if (key === "type") return typeLabelBrowser(card.type);
  if (key === "stage") {
    if (plugin.store.isQuarantined(card.id)) return "Quarantined";
    return stageLabel(String(state?.stage || "new"));
  }
  if (key === "location") return card.sourceNotePath || "";
  if (key === "groups") return fmtGroups(card.groups);
  if (key === "title") return (card.title || "").split(/\r?\n/)[0] || "";
  if (key === "question") return buildQuestionFor(card);
  if (key === "answer") return card.type === "cloze" ? "" : buildAnswerOrOptionsFor(card);
  if (key === "info") return card.info || "";
  return "";
}

// ── applyValueToCard ──────────────────────────────────────

/** Apply an edited cell value back onto a card record (returns a deep clone). */
export function applyValueToCard(card: CardRecord, col: ColKey, value: string): CardRecord {
  const draft: CardRecord = JSON.parse(JSON.stringify(card));
  const v = value ?? "";

  if (col === "title") {
    draft.title = v;
    return draft;
  }

  if (col === "question") {
    if (draft.type === "io") return draft;
    if (draft.type === "basic") draft.q = v;
    else if (draft.type === "mcq") draft.stem = v;
    else if (draft.type === "cloze") draft.clozeText = v;
    return draft;
  }

  if (col === "answer") {
    if (draft.type === "io") return draft;

    if (draft.type === "basic") {
      draft.a = v;
      return draft;
    }
    if (draft.type === "mcq") {
      const parsed = parseMcqOptionsFromCell(v);
      draft.options = parsed.options;
      draft.correctIndex = parsed.correctIndex;
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
export function readCardField(card: CardRecord, col: ColKey, plugin: SproutPlugin): string {
  if (col === "id") return String(card.id);
  if (col === "type") return typeLabelBrowser(card.type);
  if (col === "stage") {
    if (plugin.store.isQuarantined(card.id)) return "Quarantined";
    const st = plugin.store.getState(card.id);
    const stage = st?.stage || "new";
    return stageLabel(String(stage));
  }
  if (col === "due") {
    const st = plugin.store.getState(card.id);
    if (plugin.store.isQuarantined(card.id)) return "Quarantined";
    if (st && Number.isFinite(st.due)) {
      return fmtDue(st.due);
    }
    return "—";
  }
  if (col === "title") return (card.title || "").split(/\r?\n/)[0] || "";
  if (col === "question") return buildQuestionFor(card);
  if (col === "answer") return card.type === "cloze" ? "" : buildAnswerOrOptionsFor(card);
  if (col === "info") return card.info || "";
  if (col === "location") return fmtLocation(card.sourceNotePath);
  if (col === "groups") return fmtGroups(card.groups);
  return "";
}

// ── validateCardBeforeWrite ───────────────────────────────

/**
 * Validate a card's fields before writing to markdown.
 * Throws a descriptive Error if validation fails.
 */
export function validateCardBeforeWrite(card: CardRecord): void {
  if (card.type === "basic") {
    if (!(card.q || "").trim()) throw new Error("Q: is required.");
    if (!(card.a || "").trim()) throw new Error("A: is required.");
  } else if (card.type === "cloze") {
    validateClozeText(card.clozeText || "");
  } else if (card.type === "mcq") {
    if (!(card.stem || "").trim()) throw new Error("MCQ: is required.");
    const opts = Array.isArray(card.options)
      ? card.options.map((x) => (x || "").trim()).filter(Boolean)
      : [];
    if (opts.length < 2) throw new Error("MCQ requires at least 2 options.");
    if (
      !(
        Number.isFinite(card.correctIndex) &&
        (card.correctIndex as number) >= 0 &&
        (card.correctIndex as number) < opts.length
      )
    ) {
      throw new Error("MCQ requires exactly one correct option.");
    }
    card.options = opts;
  }
}
