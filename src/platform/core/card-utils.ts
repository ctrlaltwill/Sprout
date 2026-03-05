/**
 * @file src/core/card-utils.ts
 * @summary Centralised parent-card detection utilities. Parent cards (cloze,
 * reversed, and IO parents) are container cards whose children are the ones
 * actually studied. These helpers are used throughout the codebase to exclude
 * parent cards from due counts, analytics, and review queues.
 *
 * @exports
 *   - ioChildKeyFromId   — extracts the IO child key from a card ID string
 *   - cardHasIoChildKey  — checks whether a card record has an IO child key
 *   - isIoParentCard     — detects IO parent cards
 *   - isClozeParentCard  — detects cloze parent cards
 *   - isParentCard       — master check: returns true for any non-reviewable parent card
 */

import type { CardRecord } from "../types/card";

/** Extract the IO child key from a card ID string (e.g. `"…::io::mask1"` → `"mask1"`). */
export function ioChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::io::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k || null;
}

/** Returns `true` if the card has an IO child key (groupKey field or `::io::` suffix in ID). */
export function cardHasIoChildKey(card: CardRecord): boolean {
  if (!card) return false;
  if (typeof card.groupKey === "string" && card.groupKey.trim()) return true;
  return !!ioChildKeyFromId(String(card.id ?? ""));
}

/** Returns `true` if the card is an IO *parent* (not a child). */
export function isIoParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "io-parent" || t === "io_parent" || t === "ioparent") return true;
  if (t === "io") return !cardHasIoChildKey(card);
  return false;
}

/** Returns `true` if the card is a cloze parent with child deletions. */
export function isClozeParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t !== "cloze") return false;
  const children = card?.clozeChildren;
  return Array.isArray(children) && children.length > 0;
}

/**
 * Returns `true` if the card is any kind of parent card (cloze parent,
 * IO parent, or reversed parent). Parent cards are not studied directly —
 * only their children are — so they should be excluded from due counts,
 * analytics, and review queues.
 */
export function isParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "cloze" || t === "reversed") return true;
  return isIoParentCard(card) || isClozeParentCard(card);
}
