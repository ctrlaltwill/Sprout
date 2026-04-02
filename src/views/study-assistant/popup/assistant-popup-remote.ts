/**
 * @file src/views/study-assistant/popup/assistant-popup-remote.ts
 * @summary Module for assistant popup remote.
 *
 * @exports
 *  - setRemoteConversationForMode
 *  - getRemoteConversationForMode
 *  - clearRemoteConversationForMode
 *  - shouldSyncDeletesToProvider
 *  - bestEffortDeleteRemoteConversation
 */

import type { SproutSettings } from "../../../platform/types/settings";
import { deleteStudyAssistantConversation } from "../../../platform/integrations/ai/study-assistant-provider";
import type { StudyAssistantConversationRef } from "../../../platform/integrations/ai/study-assistant-types";
import { log } from "../../../platform/core/logger";
import type { AssistantMode, ModeConversationRefs } from "../types/assistant-popup-types";

export function setRemoteConversationForMode(
  remoteConversationsByMode: ModeConversationRefs,
  mode: AssistantMode,
  conversationId: string | undefined,
  settings: SproutSettings["studyAssistant"],
): void {
  const id = String(conversationId || "").trim();
  if (!id) return;
  const provider = settings.provider;
  remoteConversationsByMode[mode] = {
    provider,
    conversationId: id,
    backend: provider === "custom" ? String(settings.endpointOverride || "").trim() : undefined,
  };
}

export function getRemoteConversationForMode(
  remoteConversationsByMode: ModeConversationRefs,
  mode: AssistantMode,
): StudyAssistantConversationRef | null {
  return remoteConversationsByMode[mode] ?? null;
}

export function clearRemoteConversationForMode(
  remoteConversationsByMode: ModeConversationRefs,
  mode: AssistantMode,
): void {
  delete remoteConversationsByMode[mode];
}

export function shouldSyncDeletesToProvider(
  studyAssistant: SproutSettings["studyAssistant"] | undefined,
): boolean {
  return !!studyAssistant?.privacy?.syncDeletesToProvider;
}

export async function bestEffortDeleteRemoteConversation(
  settings: SproutSettings["studyAssistant"],
  ref: StudyAssistantConversationRef,
): Promise<void> {
  const result = await deleteStudyAssistantConversation({
    settings,
    conversationId: ref.conversationId,
  });

  if (!result.deleted && !result.unsupported && result.detail) {
    log.warn(`[study-assistant] Remote delete failed for ${ref.provider}:${ref.conversationId} (${result.detail})`);
  }
}
