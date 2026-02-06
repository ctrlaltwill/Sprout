// src/reviewer/stats.ts
import type SproutPlugin from "../main";

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
  if (t === "io") return !cardHasIoChildKey(card);
  return false;
}

function isClozeParentCard(card: any): boolean {
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
    const stage = (st as any)?.stage ?? "new";

    if (stage === "new") counts.new += 1;
    else if (stage === "review") counts.review += 1;
    else if (stage === "relearning") counts.relearning += 1;
    else if (stage === "suspended") counts.suspended += 1;
    else counts.learning += 1;
  }

  return counts;
}
