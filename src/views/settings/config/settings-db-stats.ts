/**
 * @file src/views/settings/config/settings-db-stats.ts
 * @summary Module for settings db stats.
 *
 * @exports
 *  - computeSchedulingStats
 *  - getCurrentDbStatsFromStoreData
 */

import { isParentCard } from "../../../platform/core/card-utils";
import type { CardRecord } from "../../../platform/types/card";
import type { CardState } from "../../../platform/types/scheduler";
import type { CurrentDbStats } from "../types/settings-tab-types";

type StoreDataLike = {
  cards?: Record<string, unknown>;
  quarantine?: Record<string, unknown>;
  states?: Record<string, CardState>;
  reviewLog?: unknown[];
  io?: Record<string, unknown>;
};

export function computeSchedulingStats(states: Record<string, CardState>, now: number) {
  const out = { due: 0, learning: 0, review: 0, mature: 0 };
  if (!states || typeof states !== "object") return out;
  for (const st of Object.values(states)) {
    if (!st || typeof st !== "object") continue;
    const stage = String(st.stage ?? "");
    if (stage === "learning" || stage === "relearning") out.learning += 1;
    if (stage === "review") out.review += 1;
    const stability = Number(st.stabilityDays ?? 0);
    if (stage === "review" && Number.isFinite(stability) && stability >= 30) out.mature += 1;

    const buriedUntil = Number(st.buriedUntil ?? 0);
    if (Number.isFinite(buriedUntil) && buriedUntil > now) continue;

    const due = Number(st.due ?? 0);
    const dueEligibleStage = stage === "learning" || stage === "relearning" || stage === "review";
    if (dueEligibleStage && Number.isFinite(due) && due > 0 && due <= now) out.due += 1;
  }
  return out;
}

export function getCurrentDbStatsFromStoreData(data: StoreDataLike, now = Date.now()): CurrentDbStats {
  const cardsObj = data?.cards && typeof data.cards === "object" ? data.cards : {};
  const quarantineObj = data?.quarantine && typeof data.quarantine === "object" ? data.quarantine : {};
  const reviewableIds = new Set<string>();
  for (const [id, card] of Object.entries(cardsObj)) {
    if (!id) continue;
    if (Object.prototype.hasOwnProperty.call(quarantineObj, id)) continue;
    if (!card || typeof card !== "object") continue;
    if (isParentCard(card as CardRecord)) continue;
    reviewableIds.add(id);
  }

  const rawStates = data?.states && typeof data.states === "object" ? data.states : {};
  const liveStates: Record<string, CardState> = {};
  for (const [id, st] of Object.entries(rawStates)) {
    if (!reviewableIds.has(id)) continue;
    liveStates[id] = st;
  }

  const cards = reviewableIds.size;
  const states = Object.keys(liveStates).length;
  const sched = computeSchedulingStats(liveStates, now);
  const reviewLog = Array.isArray(data?.reviewLog) ? data.reviewLog.length : 0;
  const quarantine = Object.keys(quarantineObj).length;
  const io = data?.io && typeof data.io === "object" ? Object.keys(data.io).length : 0;
  return { cards, states, due: sched.due, learning: sched.learning, review: sched.review, mature: sched.mature, reviewLog, quarantine, io };
}