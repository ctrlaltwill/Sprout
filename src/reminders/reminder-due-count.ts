import type { CardRecord, CardState } from "../core/store";
import { isParentCard } from "../core/card-utils";

type ReminderStoreLike = {
  getAllCards(): CardRecord[];
  data?: {
    states?: Record<string, CardState | undefined>;
  };
};

export function getDueCardsNow(store: ReminderStoreLike, nowMs: number = Date.now()): CardRecord[] {
  const cards = store.getAllCards?.() ?? [];
  const states = store.data?.states ?? {};
  const dueCards: Array<{ card: CardRecord; due: number }> = [];

  for (const card of cards) {
    if (!card?.id) continue;
    if (isParentCard(card)) continue;

    const state = states[String(card.id)];
    if (!state || String(state.stage ?? "") === "suspended") continue;

    const due = Number(state.due);
    if (!Number.isFinite(due) || due > nowMs) continue;
    dueCards.push({ card, due });
  }

  dueCards.sort((a, b) => {
    if (a.due !== b.due) return a.due - b.due;
    return String(a.card.id).localeCompare(String(b.card.id));
  });

  return dueCards.map((x) => x.card);
}

export function countDueCardsNow(store: ReminderStoreLike, nowMs: number = Date.now()): number {
  return getDueCardsNow(store, nowMs).length;
}
