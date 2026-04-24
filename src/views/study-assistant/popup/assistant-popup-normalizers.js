/**
 * @file src/views/study-assistant/popup/assistant-popup-normalizers.ts
 * @summary Module for assistant popup normalizers.
 *
 * @exports
 *  - normalizeSuggestionBatches
 *  - normalizeRemoteConversationRefs
 */
import { ASSISTANT_MODES } from "./assistant-popup-constants";
export function normalizeSuggestionBatches(value, assistantMessages, generateMessages) {
    var _a, _b;
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object")
            continue;
        const batch = raw;
        const assistantMessageIndex = Number(batch.assistantMessageIndex);
        if (!Number.isInteger(assistantMessageIndex))
            continue;
        const source = batch.source === "assistant" || batch.source === "generate"
            ? batch.source
            : undefined;
        const isAssistantIndexValid = assistantMessageIndex >= 0
            && assistantMessageIndex < assistantMessages.length
            && ((_a = assistantMessages[assistantMessageIndex]) === null || _a === void 0 ? void 0 : _a.role) === "assistant";
        const isGenerateIndexValid = assistantMessageIndex >= 0
            && assistantMessageIndex < generateMessages.length
            && ((_b = generateMessages[assistantMessageIndex]) === null || _b === void 0 ? void 0 : _b.role) === "assistant";
        if (source === "assistant" && !isAssistantIndexValid)
            continue;
        if (source === "generate" && !isGenerateIndexValid)
            continue;
        if (!source && !isAssistantIndexValid && !isGenerateIndexValid)
            continue;
        const suggestions = Array.isArray(batch.suggestions)
            ? (batch.suggestions)
            : [];
        if (!suggestions.length)
            continue;
        out.push({ source, assistantMessageIndex, suggestions });
    }
    out.sort((a, b) => a.assistantMessageIndex - b.assistantMessageIndex);
    return out;
}
export function normalizeRemoteConversationRefs(value) {
    const out = {};
    if (!value || typeof value !== "object")
        return out;
    const source = value;
    for (const mode of ASSISTANT_MODES) {
        const raw = source[mode];
        if (!raw || typeof raw !== "object")
            continue;
        const provider = String(raw.provider || "").trim();
        const conversationId = String(raw.conversationId || "").trim();
        if (!provider || !conversationId)
            continue;
        const normalized = {
            provider: provider,
            conversationId,
        };
        const backend = String(raw.backend || "").trim();
        if (backend)
            normalized.backend = backend;
        out[mode] = normalized;
    }
    return out;
}
