/**
 * @file src/views/study-assistant/popup/assistant-popup-normalizers.ts
 * @summary Module for assistant popup normalizers.
 *
 * @exports
 *  - normalizeSuggestionBatches
 *  - normalizeRemoteConversationRefs
 */

import type {
  StudyAssistantConversationRef,
} from "../../../platform/integrations/ai/study-assistant-types";
import {
  type AssistantMode,
  type ChatMessage,
  type GenerateSuggestionBatch,
  type ModeConversationRefs,
} from "../types/assistant-popup-types";
import { ASSISTANT_MODES } from "./assistant-popup-constants";

export function normalizeSuggestionBatches(
  value: unknown,
  assistantMessages: ChatMessage[],
  generateMessages: ChatMessage[],
): GenerateSuggestionBatch[] {
  if (!Array.isArray(value)) return [];

  const out: GenerateSuggestionBatch[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const batch = raw as Partial<GenerateSuggestionBatch>;
    const assistantMessageIndex = Number(batch.assistantMessageIndex);
    if (!Number.isInteger(assistantMessageIndex)) continue;
    const source = batch.source === "assistant" || batch.source === "generate"
      ? batch.source
      : undefined;
    const isAssistantIndexValid =
      assistantMessageIndex >= 0
      && assistantMessageIndex < assistantMessages.length
      && assistantMessages[assistantMessageIndex]?.role === "assistant";
    const isGenerateIndexValid =
      assistantMessageIndex >= 0
      && assistantMessageIndex < generateMessages.length
      && generateMessages[assistantMessageIndex]?.role === "assistant";

    if (source === "assistant" && !isAssistantIndexValid) continue;
    if (source === "generate" && !isGenerateIndexValid) continue;
    if (!source && !isAssistantIndexValid && !isGenerateIndexValid) continue;
    const suggestions = Array.isArray(batch.suggestions)
      ? (batch.suggestions)
      : [];
    if (!suggestions.length) continue;
    out.push({ source, assistantMessageIndex, suggestions });
  }

  out.sort((a, b) => a.assistantMessageIndex - b.assistantMessageIndex);
  return out;
}

export function normalizeRemoteConversationRefs(value: unknown): ModeConversationRefs {
  const out: ModeConversationRefs = {};
  if (!value || typeof value !== "object") return out;

  const source = value as Partial<Record<AssistantMode, Partial<StudyAssistantConversationRef>>>;
  for (const mode of ASSISTANT_MODES) {
    const raw = source[mode];
    if (!raw || typeof raw !== "object") continue;
    const provider = String(raw.provider || "").trim();
    const conversationId = String(raw.conversationId || "").trim();
    if (!provider || !conversationId) continue;
    const normalized: StudyAssistantConversationRef = {
      provider: provider as StudyAssistantConversationRef["provider"],
      conversationId,
    };
    const backend = String(raw.backend || "").trim();
    if (backend) normalized.backend = backend;
    out[mode] = normalized;
  }

  return out;
}
