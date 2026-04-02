/**
 * @file src/views/settings/types/settings-tab-types.ts
 * @summary Module for settings tab types.
 *
 * @exports
 *  - StudyAssistantProvider
 *  - StudyAssistantModelOption
 *  - OpenRouterModel
 *  - BackupSchedulingStats
 *  - CurrentDbStats
 *  - BackupIntegrityState
 */

import type { SproutSettings } from "../../../platform/types/settings";

export type StudyAssistantProvider = SproutSettings["studyAssistant"]["provider"];

export type StudyAssistantModelOption = {
  value: string;
  label: string;
  description?: string;
  section?: string;
};

export type OpenRouterModel = {
  id: string;
  name: string;
  provider: string;
  isFree: boolean;
};

export type BackupSchedulingStats = {
  states: number;
  due: number;
  learning: number;
  review: number;
  mature: number;
};

export type CurrentDbStats = BackupSchedulingStats & {
  cards: number;
  reviewLog: number;
  quarantine: number;
  io: number;
};

export type BackupIntegrityState = "verified" | "legacy" | "invalid";
