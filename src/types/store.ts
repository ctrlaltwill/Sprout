/**
 * @file src/types/store.ts
 * @summary Store-level type definitions. Defines the QuarantineEntry type for cards that
 * failed parsing, and the top-level StoreData shape that wraps all persisted card data,
 * scheduling states, review logs, image-occlusion maps, and analytics events.
 *
 * @exports
 *   - QuarantineEntry — type for a quarantined card entry
 *   - StoreData — root persisted data structure under the "store" key in data.json
 */

import type { CardRecord } from "./card";
import type { CardState } from "./scheduler";
import type { ReviewLogEntry } from "./review";
import type { AnalyticsData } from "./analytics";
import type { IOMap } from "../imageocclusion/image-occlusion-types";

/**
 * A card that failed parsing and has been quarantined.
 * Quarantined cards are excluded from study but kept for diagnostics.
 */
export type QuarantineEntry = {
  id: string;
  notePath: string;
  sourceStartLine: number;
  reason: string;
  lastSeenAt: number;
};

/**
 * Root data structure persisted to `data.json` under `store`.
 * Contains every piece of state the plugin needs across sessions.
 */
export type StoreData = {
  version: number;
  cards: Record<string, CardRecord>;
  states: Record<string, CardState>;
  reviewLog: ReviewLogEntry[];
  quarantine: Record<string, QuarantineEntry>;

  /** Image-occlusion definitions keyed by parent card ID. */
  io: IOMap;

  /** Analytics event storage (reviews, sessions). */
  analytics: AnalyticsData;
};
