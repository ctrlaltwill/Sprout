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

import type LearnKitPlugin from "../../main";
import type { Scope, Session } from "./types";
import type { CardRecord } from "../../platform/core/store";
import type { ReviewLogEntry } from "../../platform/types/review";
import type { CardState } from "../../platform/types/scheduler";
import { getGroupIndex, normaliseGroupPath } from "../../engine/indexing/group-index";

export type SessionBuildOptions = {
  ignoreDailyReviewLimit?: boolean;
  ignoreDailyNewLimit?: boolean;
  dueOnly?: boolean;
  targetCount?: number;
  trackCoachProgress?: boolean;
  practiceMode?: boolean;
};

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

  // group scope is resolved by resolveCardsInScope(); path-based match N/A
  if (scope.type === "group") return false;

  // Unknown scope type — fail closed
  return false;
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

// --- Parent-card exclusion (parents are not reviewable) ----------------------

import { isParentCard } from "../../platform/core/card-utils";

function filterReviewable(cards: CardRecord[]): CardRecord[] {
  return (cards || []).filter((c) => !isParentCard(c));
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
  plugin: LearnKitPlugin,
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

  // Buried cards are excluded until the bury expires
  if (typeof st.buriedUntil === "number" && Number.isFinite(st.buriedUntil) && st.buriedUntil > now) {
    return false;
  }

  if (st.stage === "new") return true;

  if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") {
    if (typeof st.due !== "number" || !Number.isFinite(st.due)) return true;
    return st.due <= now;
  }

  return false;
}

function resolveCardsInScope(plugin: LearnKitPlugin, scope: Scope): CardRecord[] {
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

export function buildSession(plugin: LearnKitPlugin, scope: Scope, options?: SessionBuildOptions): Session {
  const now = Date.now();
  const startToday = startOfTodayMs(now);

  const settings = plugin.settings;
  const study = settings?.study ?? {};

  const dailyNewLimit = options?.ignoreDailyNewLimit
    ? Number.POSITIVE_INFINITY
    : toNonNegIntOrInfinity(study.dailyNewLimit);
  const dailyReviewLimit = options?.ignoreDailyReviewLimit
    ? Number.POSITIVE_INFINITY
    : toNonNegIntOrInfinity(study.dailyReviewLimit);
  const dueOnly = options?.dueOnly === true;
  const siblingMode: string = (study as Record<string, unknown>).siblingMode as string ?? "standard";

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

  // Filter to available now (respects buriedUntil)
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

  // Sort new by id (stable)
  news.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Apply daily limits
  const dueTake =
    remainingReview === Number.POSITIVE_INFINITY ? dueLike : dueLike.slice(0, remainingReview);

  const newTake = dueOnly
    ? []
    : (remainingNew === Number.POSITIVE_INFINITY ? news : news.slice(0, remainingNew));

  // ── Combine and apply sibling mode ─────────────────────────────────────
  let queue: CardRecord[];

  if (siblingMode === "disperse") {
    queue = disperseSiblings([...dueTake, ...newTake]);
  } else if (siblingMode === "bury") {
    queue = collapseSiblingFamilies(cards, [...dueTake, ...newTake], states, now);
  } else {
    // "standard"
    queue = [...dueTake, ...newTake];
  }

  return {
    scope,
    queue,
    index: 0,
    graded: {},
    stats: { total: queue.length, done: 0 },
  };
}

// ── Sibling helpers ───────────────────────────────────────────────────────────

/** Returns true for child card types that have siblings. */
function isChildCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "cloze-child" || t === "io-child" || t === "hq-child" || t === "reversed-child" || t === "combo-child";
}

/** Resolves the parent key for a child card. */
function getParentKey(card: CardRecord): string {
  if (card.parentId) return card.parentId;
  const id = String(card.id || "");
  const clozeMatch = id.match(/^(.*)::cloze::/);
  if (clozeMatch) return clozeMatch[1];
  const ioMatch = id.match(/^(.*)::io::/);
  if (ioMatch) return ioMatch[1];
  const hqMatch = id.match(/^(.*)::hq::/);
  if (hqMatch) return hqMatch[1];
  const reversedMatch = id.match(/^(.*)::reversed::/);
  if (reversedMatch) return reversedMatch[1];
  if (card.groupKey) return card.groupKey;
  return id;
}

function isTemporarilyBuried(st: CardState | undefined, now: number): boolean {
  return !!(
    st &&
    typeof st.buriedUntil === "number" &&
    Number.isFinite(st.buriedUntil) &&
    st.buriedUntil > now
  );
}

function isSiblingStillActive(st: CardState | undefined, now: number): boolean {
  if (!st) return false;
  if (st.stage === "suspended") return false;
  void now;

  if (st.stage === "new") {
    return true;
  }

  return false;
}

function compareSiblingPriority(a: CardRecord, b: CardRecord, states: Record<string, CardState>): number {
  const sa = states[a.id];
  const sb = states[b.id];

  const rank = (st: CardState | undefined): number => {
    if (!st) return 3;
    if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") return 0;
    if (st.stage === "new") return 1;
    return 2;
  };

  const rankDiff = rank(sa) - rank(sb);
  if (rankDiff !== 0) return rankDiff;

  const dueValue = (st: CardState | undefined): number => {
    if (!st) return Number.POSITIVE_INFINITY;
    if (st.stage === "new") return Number.POSITIVE_INFINITY;
    if (typeof st.due === "number" && Number.isFinite(st.due)) return st.due;
    return Number.NEGATIVE_INFINITY;
  };

  const dueDiff = dueValue(sa) - dueValue(sb);
  if (dueDiff !== 0) return dueDiff;

  return String(a.id).localeCompare(String(b.id));
}

/**
 * Bury mode collapses each sibling family to a single active child until the
 * current child is no longer new, then the next sibling can appear.
 */
function collapseSiblingFamilies(
  cardsInScope: CardRecord[],
  queueCards: CardRecord[],
  states: Record<string, CardState>,
  now: number,
): CardRecord[] {
  const blockedParents = new Set<string>();

  for (const c of cardsInScope) {
    if (!isChildCard(c)) continue;

    const st = states[c.id];
    if (!st) continue;
    if (st.stage === "suspended") continue;
    if (isTemporarilyBuried(st, now)) continue;
    if (isAvailableNow(st, now)) continue;
    if (!isSiblingStillActive(st, now)) continue;

    blockedParents.add(getParentKey(c));
  }

  const groups = new Map<string, CardRecord[]>();
  for (const c of queueCards) {
    if (!isChildCard(c)) continue;
    const key = getParentKey(c);
    if (blockedParents.has(key)) continue;
    const existing = groups.get(key);
    if (existing) existing.push(c);
    else groups.set(key, [c]);
  }

  const keepIds = new Set<string>();
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => compareSiblingPriority(a, b, states));
    keepIds.add(String(siblings[0].id));
  }

  return queueCards.filter((c) => !isChildCard(c) || keepIds.has(String(c.id)));
}

/**
 * Disperse mode: spreads sibling child cards evenly across the queue.
 *
 * 1. Separate children from non-children.
 * 2. Group children by parent and round-robin across parent groups to produce
 *    an interleaved sequence where same-parent siblings are maximally spaced.
 * 3. Insert children at evenly-spaced positions among the non-child cards.
 */
function disperseSiblings(cards: CardRecord[]): CardRecord[] {
  const children: CardRecord[] = [];
  const others: CardRecord[] = [];

  for (const c of cards) {
    if (isChildCard(c)) children.push(c);
    else others.push(c);
  }

  if (children.length === 0) return cards;

  // Group by parent
  const groups: Record<string, CardRecord[]> = {};
  for (const c of children) {
    const key = getParentKey(c);
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  // Round-robin across parents so siblings from the same parent are maximally apart
  const parentKeys = Object.keys(groups);
  const interleaved: CardRecord[] = [];
  let added: boolean;
  do {
    added = false;
    for (const key of parentKeys) {
      if (groups[key].length > 0) {
        interleaved.push(groups[key].shift()!);
        added = true;
      }
    }
  } while (added);

  // Insert interleaved children at evenly-spaced positions among others
  if (others.length === 0) return interleaved;

  const result: CardRecord[] = [];
  const totalSlots = others.length + interleaved.length;
  // Evenly distribute: place each child at position i * (total / childCount)
  const step = totalSlots / interleaved.length;
  const childPositions = new Set<number>();
  for (let i = 0; i < interleaved.length; i++) {
    childPositions.add(Math.round(i * step));
  }

  let ci = 0;
  let oi = 0;
  for (let pos = 0; pos < totalSlots; pos++) {
    if (childPositions.has(pos) && ci < interleaved.length) {
      result.push(interleaved[ci++]);
    } else if (oi < others.length) {
      result.push(others[oi++]);
    } else if (ci < interleaved.length) {
      result.push(interleaved[ci++]);
    }
  }

  return result;
}

export function getNextDueInScope(plugin: LearnKitPlugin, scope: Scope): number | null {
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
