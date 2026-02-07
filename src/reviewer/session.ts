/**
 * @file src/reviewer/session.ts
 * @summary Core session-building logic for the reviewer. Resolves which cards are in scope (vault, folder, note, or group), applies daily new/review limits, filters for currently-available cards, shuffles and interleaves cloze/IO children with round-robin scheduling, and assembles the study queue.
 *
 * @exports
 *   - inScope — Predicate that checks whether a note path falls within a given scope
 *   - isAvailableNow — Determines if a card's state makes it eligible for study right now
 *   - buildSession — Constructs a full Session object (queue, stats, graded map) for a given scope
 *   - getNextDueInScope — Returns the earliest future due timestamp among cards in the given scope, or null
 */

import type SproutPlugin from "../main";
import type { Scope, Session } from "./types";
import type { CardRecord } from "../core/store";
import type { ReviewLogEntry } from "../types/review";
import type { CardState } from "../types/scheduler";
import { getGroupIndex, normaliseGroupPath } from "../indexes/group-index";


/** Scope predicate used by deck/session logic (note-path based scopes). */
export function inScope(scope: Scope | null, notePath: string) {
  if (!scope) return true;
  if (scope.type === "vault") return true;

  if (scope.type === "folder") {
    const folder = notePath.includes("/")
      ? notePath.split("/").slice(0, -1).join("/")
      : "";
    return folder === scope.key || folder.startsWith(scope.key + "/");
  }

  if (scope.type === "note") return notePath === scope.key;

  // group scope is handled by resolveCardsInScope()
  return true;
}

function startOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toNonNegIntOrInfinity(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(n));
}

// --- IO parent exclusion -----------------------------------------------------

function ioChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::io::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k ? k : null;
}

function cardHasIoChildKey(card: CardRecord): boolean {
  if (!card) return false;
  if (typeof card.groupKey === "string" && card.groupKey.trim()) return true;
  const id = String(card.id ?? "");
  return !!ioChildKeyFromId(id);
}

function isIoParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();

  if (t === "io-parent" || t === "io_parent" || t === "ioparent") return true;

  // If your project uses type "io" for both parent + children, detect parent by absence of a child key.
  if (t === "io") {
    return !cardHasIoChildKey(card);
  }

  return false;
}

function isClozeParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t !== "cloze") return false;
  const children = card?.clozeChildren;
  return Array.isArray(children) && children.length > 0;
}

function filterReviewable(cards: CardRecord[]): CardRecord[] {
  return (cards || []).filter((c) => {
    const t = String(c?.type ?? "").toLowerCase();
    if (t === "cloze") return false;
    return !isIoParentCard(c) && !isClozeParentCard(c);
  });
}

/**
 * Returns how many NEW cards and REVIEW cards have already been *studied today* in this scope.
 *
 * Definitions:
 * - "New studied today" = cards whose first-ever review log entry is today (per scope).
 * - "Review studied today" = cards reviewed today whose first-ever review log entry is before today.
 *
 * Counts are per-card (distinct IDs), not per-review-event.
 */
function getTodayCountsInScope(
  plugin: SproutPlugin,
  idsInScope: Set<string>,
  startToday: number,
) {
  const log: ReviewLogEntry[] = plugin.store?.data?.reviewLog || [];

  const earliestAtById = new Map<string, number>();
  const reviewedToday = new Set<string>();

  for (const e of log) {
    const id = String(e?.id ?? "");
    if (!id) continue;
    if (!idsInScope.has(id)) continue;

    const at = Number(e?.at);
    if (!Number.isFinite(at)) continue;

    // Track earliest-ever review timestamp for this id
    const prevEarliest = earliestAtById.get(id);
    if (prevEarliest === undefined || at < prevEarliest) earliestAtById.set(id, at);

    // Track if reviewed today
    if (at >= startToday) reviewedToday.add(id);
  }

  let newDoneToday = 0;
  let reviewDoneToday = 0;

  for (const id of reviewedToday) {
    const firstAt = earliestAtById.get(id);
    if (firstAt === undefined) continue;

    if (firstAt >= startToday) newDoneToday += 1;
    else reviewDoneToday += 1;
  }

  return { newDoneToday, reviewDoneToday };
}

/**
 * Cards eligible for the active study queue.
 *
 * Intended behaviour:
 * - include "due" learning/relearning/review cards (due <= now)
 * - include "new" cards (common after a reset)
 * - exclude "suspended" cards
 * - be robust to missing/invalid due timestamps (treat as available so users don't get "No cards left")
 */
export function isAvailableNow(st: CardState | undefined, now: number): boolean {
  if (!st) return false;

  if (st.stage === "suspended") return false;
  if (st.stage === "new") return true;

  if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") {
    if (typeof st.due !== "number" || !Number.isFinite(st.due)) return true;
    return st.due <= now;
  }

  return false;
}

function resolveCardsInScope(plugin: SproutPlugin, scope: Scope): CardRecord[] {
  if (!scope || scope.type === "vault") {
    return filterReviewable(plugin.store.getAllCards());
  }

  if (scope.type === "group") {
    const rawKey = String(scope.key || "").trim();
    if (!rawKey) return [];

    const keys = rawKey
      .split(",")
      .map((k) => normaliseGroupPath(k) || String(k || "").trim())
      .filter((k) => !!k);
    if (!keys.length) return [];

    const gx = getGroupIndex(plugin);
    const ids = new Set<string>();
    for (const key of keys) {
      for (const id of gx.getIds(key)) ids.add(String(id));
    }

    const cardsObj = (plugin.store?.data?.cards || {});
    const quarantine = plugin.store?.data?.quarantine || {};

    const out: CardRecord[] = [];
    for (const id of ids) {
      if (quarantine[String(id)]) continue;
      const c = cardsObj[String(id)];
      if (c) out.push(c);
    }
    return filterReviewable(out);
  }

  // folder/note
  const raw = plugin.store.getAllCards().filter((c) => inScope(scope, c.sourceNotePath));
  return filterReviewable(raw);
}

export function buildSession(plugin: SproutPlugin, scope: Scope): Session {
  const now = Date.now();
  const startToday = startOfTodayMs(now);

  const settings = plugin.settings;
  const study = settings?.study ?? {};

  const dailyNewLimit = toNonNegIntOrInfinity(study.dailyNewLimit);
  const dailyReviewLimit = toNonNegIntOrInfinity(study.dailyReviewLimit);

  const cards = resolveCardsInScope(plugin, scope);
  const states = plugin.store.data.states || {};

  // Scope IDs for today-count accounting
  const idsInScope = new Set<string>(cards.map((c) => String(c.id)));

  // How many have we already done today in this scope?
  const { newDoneToday, reviewDoneToday } = getTodayCountsInScope(plugin, idsInScope, startToday);

  const remainingNew =
    dailyNewLimit === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, dailyNewLimit - newDoneToday);

  const remainingReview =
    dailyReviewLimit === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, dailyReviewLimit - reviewDoneToday);

  // Filter to available now
  const available = cards.filter((c) => {
    const st = states[c.id];
    return isAvailableNow(st, now);
  });

  // Partition into due-like vs new
  const dueLike: CardRecord[] = [];
  const news: CardRecord[] = [];

  for (const c of available) {
    const st = states[c.id];
    if (!st) continue;

    if (st.stage === "new") {
      news.push(c);
    } else if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") {
      dueLike.push(c);
    } else {
      // Unknown stage: treat as available (but put at end)
      dueLike.push(c);
    }
  }


  // Sort due-like by due (invalid due sorts first)
  dueLike.sort((a, b) => {
    const sa = states[a.id];
    const sb = states[b.id];
    const da = sa && typeof sa.due === "number" && Number.isFinite(sa.due) ? Number(sa.due) : -1;
    const db = sb && typeof sb.due === "number" && Number.isFinite(sb.due) ? Number(sb.due) : -1;
    return da - db;
  });

  // Round-robin interleaving for cloze/IO children by parent
  function isChildCard(card: CardRecord) {
    const t = String(card?.type ?? "").toLowerCase();
    return t === "cloze-child" || t === "io-child";
  }
  function getParentKey(card: CardRecord) {
    // For cloze-child: parentId or id up to ::cloze::
    if (card.parentId) return card.parentId;
    const id = String(card.id || "");
    const clozeMatch = id.match(/^(.*)::cloze::/);
    if (clozeMatch) return clozeMatch[1];
    // For io-child: parentId or groupKey
    if (card.groupKey) return card.groupKey;
    return id;
  }
  const childCards = dueLike.filter(isChildCard);
  const otherCards = dueLike.filter((c) => !isChildCard(c));
  // Group child cards by parent
  const parentGroups: Record<string, CardRecord[]> = {};
  for (const card of childCards) {
    const key = getParentKey(card);
    if (!parentGroups[key]) parentGroups[key] = [];
    parentGroups[key].push(card);
  }
  // Shuffle each parent group
  for (const key in parentGroups) {
    const arr = parentGroups[key];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  // Round-robin pick from each parent group
  const parentKeys = Object.keys(parentGroups);
  // Shuffle parentKeys for more mixing
  for (let i = parentKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parentKeys[i], parentKeys[j]] = [parentKeys[j], parentKeys[i]];
  }
  const rrChildCards: CardRecord[] = [];
  let added;
  do {
    added = false;
    for (const key of parentKeys) {
      if (parentGroups[key].length) {
        const shifted = parentGroups[key].shift();
        if (shifted) rrChildCards.push(shifted);
        added = true;
      }
    }
  } while (added);
  // Shuffle other cards (optional, for more mixing)
  for (let i = otherCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherCards[i], otherCards[j]] = [otherCards[j], otherCards[i]];
  }
  // Interleave round-robin child cards and others
  const shuffledDueLike: CardRecord[] = [];
  let i = 0, j = 0;
  while (i < otherCards.length || j < rrChildCards.length) {
    if (i < otherCards.length) shuffledDueLike.push(otherCards[i++]);
    if (j < rrChildCards.length) shuffledDueLike.push(rrChildCards[j++]);
  }

  // Sort new by id (stable)
  news.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const dueTake =
    remainingReview === Number.POSITIVE_INFINITY ? shuffledDueLike : shuffledDueLike.slice(0, remainingReview);

  const newTake =
    remainingNew === Number.POSITIVE_INFINITY ? news : news.slice(0, remainingNew);

  const queue = [...dueTake, ...newTake];

  return {
    scope,
    queue,
    index: 0,
    graded: {},
    stats: { total: queue.length, done: 0 },
  };
}

export function getNextDueInScope(plugin: SproutPlugin, scope: Scope): number | null {
  const now = Date.now();
  const cards = resolveCardsInScope(plugin, scope);

  const states = plugin.store.data.states || {};
  let next: number | null = null;

  for (const c of cards) {
    const st = states[c.id];
    if (!st) continue;
    if (st.stage === "suspended") continue;

    if (
      (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") &&
      typeof st.due === "number" &&
      Number.isFinite(st.due) &&
      st.due > now
    ) {
      if (next === null || st.due < next) next = st.due;
    }
  }

  return next;
}
