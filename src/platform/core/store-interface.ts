/**
 * @file src/platform/core/store-interface.ts
 * @summary Module for store interface.
 *
 * @exports
 *  - PersistSafetyResult
 *  - IStore
 */

import type LearnKitPlugin from "../../main";
import type { CardRecord } from "../types/card";
import type { ReviewLogEntry } from "../types/review";
import type {
  AnalyticsEvent,
  AnalyticsExamAttemptEvent,
  AnalyticsNoteReviewEvent,
  AnalyticsReviewEvent,
  AnalyticsSessionEvent,
} from "../types/analytics";
import type { CardState } from "../types/scheduler";
import type { QuarantineEntry, StoreData } from "../types/store";

export type PersistSafetyResult = {
  allow: boolean;
  backupFirst: boolean;
  reason?: string;
};

export interface IStore {
  plugin: LearnKitPlugin;
  data: StoreData;
  loadedFromDisk: boolean;
  load(rootData: unknown): void;
  persist(): Promise<void>;
  getRevision(): number;
  getAllCards(): CardRecord[];
  getAllStates(): Record<string, CardState>;
  getCardsByNote(notePath: string): CardRecord[];
  getQuarantine(): Record<string, QuarantineEntry>;
  isQuarantined(id: string): boolean;
  getState(id: string): CardState | null;
  upsertCard(card: CardRecord): void;
  upsertState(state: CardState): void;
  appendReviewLog(entry: ReviewLogEntry): void;
  truncateReviewLog(toLength: number): void;
  ensureState(id: string, now: number, defaultEase?: number): CardState;
  getAnalyticsEvents(): AnalyticsEvent[];
  appendAnalyticsReview(args: Omit<AnalyticsReviewEvent, "kind" | "eventId">): AnalyticsReviewEvent;
  appendAnalyticsSession(args: Omit<AnalyticsSessionEvent, "kind" | "eventId">): AnalyticsSessionEvent;
  appendAnalyticsExamAttempt(args: Omit<AnalyticsExamAttemptEvent, "kind" | "eventId">): AnalyticsExamAttemptEvent;
  appendAnalyticsNoteReview(args: Omit<AnalyticsNoteReviewEvent, "kind" | "eventId">): AnalyticsNoteReviewEvent;
  truncateAnalyticsEvents(toLength: number): void;
  dataWeight(): number;
  assessPersistSafety(diskStore: Record<string, unknown> | null | undefined): PersistSafetyResult;
}
