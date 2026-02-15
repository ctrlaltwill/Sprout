/**
 * @file src/reviewer/stats.ts
 * @summary Computes aggregate card stage counts across the entire store for use in the reviewer's deck browser and analytics badges. Excludes IO parent and cloze parent cards from totals.
 *
 * @exports
 *   - getStageCountsAll — Returns an object with counts of new, learning, review, relearning, and suspended cards
 */

import type SproutPlugin from "../main";
import { isParentCard } from "../core/card-utils";

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
    // Skip all parent cards — reversed, cloze, and IO parents
    if (isParentCard(c)) continue;
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
