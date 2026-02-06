// src/reviewer/session.ts
import type SproutPlugin from "../main";
import type { Scope, Session } from "./types";
import type { CardRecord } from "../core/store";
// src/reviewer/session.ts
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

function toNonNegIntOrInfinity(x: any): number {
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

function cardHasIoChildKey(card: any): boolean {
  if (!card) return false;
  if (typeof card.groupKey === "string" && card.groupKey.trim()) return true;
  if (typeof card.ioGroupKey === "string" && card.ioGroupKey.trim()) return true;
  if (typeof card.key === "string" && card.key.trim()) return true;

  const id = String(card.id ?? "");
  return !!ioChildKeyFromId(id);
}

function isIoParentCard(card: any): boolean {
  const t = String(card?.type ?? "").toLowerCase();

  if (t === "io-parent" || t === "io_parent" || t === "ioparent") return true;

  // If your project uses type "io" for both parent + children, detect parent by absence of a child key.
  if (t === "io") {
    return !cardHasIoChildKey(card);
  }

  return false;
}

function isClozeParentCard(card: any): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t !== "cloze") return false;
  const children = (card as any)?.clozeChildren;
  return Array.isArray(children) && children.length > 0;
}

function filterReviewable(cards: any[]): any[] {
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
  const log = (plugin.store?.data?.reviewLog || []) as any[];

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
export function isAvailableNow(st: any, now: number): boolean {
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
    return filterReviewable(plugin.store.getAllCards() as any) as any;
  }

  if (scope.type === "group") {
    const rawKey = String(scope.key || "").trim();
    if (!rawKey) return [];

    const keys = rawKey
      .split(",")
      .map((k) => normaliseGroupPath(k) || String(k || "").trim())
      .filter((k) => !!k);
    if (!keys.length) return [];

    const gx = getGroupIndex(plugin as any);
    const ids = new Set<string>();
    for (const key of keys) {
      for (const id of gx.getIds(key)) ids.add(String(id));
    }

    const cardsObj = (plugin.store?.data?.cards || {}) as Record<string, CardRecord>;
    const quarantine = (plugin.store?.data?.quarantine || {}) as Record<string, any>;

    const out: CardRecord[] = [];
    for (const id of ids) {
      if (quarantine[String(id)]) continue;
      const c = cardsObj[String(id)];
      if (c) out.push(c);
    }
    return filterReviewable(out) as any;
  }

  // folder/note
  const raw = (plugin.store.getAllCards() as any[]).filter((c: any) => inScope(scope, c.sourceNotePath));
  return filterReviewable(raw) as any;
}

export function buildSession(plugin: SproutPlugin, scope: Scope): Session {
  const now = Date.now();
  const startToday = startOfTodayMs(now);

  const settings: any = (plugin as any)?.settings ?? {};
  const reviewer = settings.reviewer ?? {};

  const dailyNewLimit = toNonNegIntOrInfinity(reviewer.dailyNewLimit);
  const dailyReviewLimit = toNonNegIntOrInfinity(reviewer.dailyReviewLimit);

  const cards = resolveCardsInScope(plugin, scope);
  const states = plugin.store.data.states || {};

  // Scope IDs for today-count accounting
  const idsInScope = new Set<string>(cards.map((c: any) => String(c.id)));

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
  const available = cards.filter((c: any) => {
    const st = states[c.id];
    return isAvailableNow(st, now);
  });

  // Partition into due-like vs new
  const dueLike: any[] = [];
  const news: any[] = [];

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
  dueLike.sort((a: any, b: any) => {
    const sa = states[a.id];
    const sb = states[b.id];
    const da = sa && typeof sa.due === "number" && Number.isFinite(sa.due) ? Number(sa.due) : -1;
    const db = sb && typeof sb.due === "number" && Number.isFinite(sb.due) ? Number(sb.due) : -1;
    return da - db;
  });

  // Round-robin interleaving for cloze/IO children by parent
  function isChildCard(card: any) {
    const t = String(card?.type ?? "").toLowerCase();
    return t === "cloze-child" || t === "io-child";
  }
  function getParentKey(card: any) {
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
  const parentGroups: Record<string, any[]> = {};
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
  const rrChildCards: any[] = [];
  let added;
  do {
    added = false;
    for (const key of parentKeys) {
      if (parentGroups[key].length) {
        rrChildCards.push(parentGroups[key].shift());
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
  const shuffledDueLike: any[] = [];
  let i = 0, j = 0;
  while (i < otherCards.length || j < rrChildCards.length) {
    if (i < otherCards.length) shuffledDueLike.push(otherCards[i++]);
    if (j < rrChildCards.length) shuffledDueLike.push(rrChildCards[j++]);
  }

  // Sort new by id (stable)
  news.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));

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

  for (const c of cards as any[]) {
    const st = states[(c as any).id];
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
