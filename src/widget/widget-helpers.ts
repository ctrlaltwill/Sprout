/**
 * widget/widget-helpers.ts
 * ────────────────────────
 * Shared types and pure helper functions for the Sprout sidebar widget.
 *
 * Exports:
 *  - Session              – widget review-session state
 *  - UndoFrame            – snapshot for undo-last-grade
 *  - ioChildKeyFromId     – extract IO child key from a card ID
 *  - cardHasIoChildKey    – whether a card has an IO child key
 *  - isIoParentCard       – detect IO parent cards
 *  - isClozeParentCard    – detect cloze parent cards
 *  - filterReviewableCards – filter out non-reviewable (parent) cards
 *  - toTitleCase          – convert string to Title Case
 *  - isClozeLike          – detect cloze or cloze-child cards
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** State of a widget study session. */
export type Session = {
  scopeName: string;
  queue: any[];
  index: number;
  graded: Record<string, { rating: "again" | "hard" | "good" | "easy"; at: number; meta: any }>;
  stats: { total: number; done: number };
  mode: "scheduled" | "practice";
};

/** Snapshot saved before grading so the user can undo. */
export type UndoFrame = {
  sessionStamp: number;
  id: string;
  cardType: string;
  rating: "again" | "hard" | "good" | "easy";
  at: number;
  meta: any;
  sessionIndex: number;
  showAnswer: boolean;
  reviewLogLenBefore: number;
  analyticsLenBefore: number;
  prevState: any;
};

/* ------------------------------------------------------------------ */
/*  IO child key helpers                                               */
/* ------------------------------------------------------------------ */

/** Extract the IO child key from a card ID string (e.g. `"…::io::mask1"` → `"mask1"`). */
export function ioChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::io::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k ? k : null;
}

/** Returns `true` if the card has an IO child key in any known property. */
export function cardHasIoChildKey(card: any): boolean {
  if (!card) return false;
  if (typeof card.groupKey === "string" && card.groupKey.trim()) return true;
  if (typeof card.ioGroupKey === "string" && card.ioGroupKey.trim()) return true;
  if (typeof card.key === "string" && card.key.trim()) return true;
  const id = String(card.id ?? "");
  return !!ioChildKeyFromId(id);
}

/* ------------------------------------------------------------------ */
/*  Card-type predicates                                               */
/* ------------------------------------------------------------------ */

/** Returns `true` if the card is an IO *parent* (not a child). */
export function isIoParentCard(card: any): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "io-parent" || t === "io_parent" || t === "ioparent") return true;
  if (t === "io") return !cardHasIoChildKey(card);
  return false;
}

/** Returns `true` if the card is a cloze parent with child deletions. */
export function isClozeParentCard(card: any): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t !== "cloze") return false;
  const children = (card)?.clozeChildren;
  return Array.isArray(children) && children.length > 0;
}

/** Returns `true` if the card's type is `"cloze"` or `"cloze-child"`. */
export function isClozeLike(card: any): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "cloze" || t === "cloze-child";
}

/* ------------------------------------------------------------------ */
/*  Filtering                                                          */
/* ------------------------------------------------------------------ */

/**
 * Filters out non-reviewable cards (parents that are represented by
 * their children during review: cloze parents, IO parents).
 */
export function filterReviewableCards(cards: any[]): any[] {
  return (cards || []).filter((c) => {
    const t = String(c?.type ?? "").toLowerCase();
    if (t === "cloze" || t === "io" || t === "io-parent") return false;
    return !isClozeParentCard(c) && !isIoParentCard(c);
  });
}

/* ------------------------------------------------------------------ */
/*  Text helpers                                                       */
/* ------------------------------------------------------------------ */

/** Converts a string to Title Case (capitalises the first letter of each word). */
export function toTitleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
