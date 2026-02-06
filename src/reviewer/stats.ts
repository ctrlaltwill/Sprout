/**
 * @file src/reviewer/stats.ts
 * @summary Computes aggregate card stage counts across the entire store for use in the reviewer's deck browser and analytics badges. Excludes IO parent and cloze parent cards from totals.
 *
 * @exports
 *   - getStageCountsAll — Returns an object with counts of new, learning, review, relearning, and suspended cards
 */

import type SproutPlugin from "../main";
import type { CardRecord } from "../types/card";

function ioChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::io::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k ? k : null;
}

function getGroupKey(card: CardRecord): string | null {
  if (!card) return null;
  const raw = typeof card.groupKey === "string" ? card.groupKey.trim() : "";
  return raw ? raw : null;
}

function cardHasIoChildKey(card: CardRecord): boolean {
  if (!card) return false;
  if (getGroupKey(card)) return true;
  const id = String(card.id ?? "");
  return !!ioChildKeyFromId(id);
}

function isIoParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "io-parent" || t === "io_parent" || t === "ioparent") return true;
  if (t === "io") return !cardHasIoChildKey(card);
  return false;
}

function isClozeParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t !== "cloze") return false;
  const children = (card)?.clozeChildren;
  return Array.isArray(children) && children.length > 0;
}

export function getStageCountsAll(plugin: SproutPlugin): {
  new: number;
  learning: number;
  review: number;
  relearning: number;
  suspended: number;
} {
  const counts = { new: 0, learning: 0, review: 0, relearning: 0, suspended: 0 };

  const cards = plugin.store.getAllCards();
  for (const c of cards) {
    if (isIoParentCard(c) || isClozeParentCard(c)) continue;
    const st = plugin.store.getState(String(c.id));
    const stage = st?.stage ?? "new";

    if (stage === "new") counts.new += 1;
    else if (stage === "review") counts.review += 1;
    else if (stage === "relearning") counts.relearning += 1;
    else if (stage === "suspended") counts.suspended += 1;
    else counts.learning += 1;
  }

  return counts;
}
