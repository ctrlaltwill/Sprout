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
import { deleteStudyAssistantConversation } from "../../../platform/integrations/ai/study-assistant-provider";
import { log } from "../../../platform/core/logger";
export function setRemoteConversationForMode(remoteConversationsByMode, mode, conversationId, settings) {
    const id = String(conversationId || "").trim();
    if (!id)
        return;
    const provider = settings.provider;
    remoteConversationsByMode[mode] = {
        provider,
        conversationId: id,
        backend: provider === "custom" ? String(settings.endpointOverride || "").trim() : undefined,
    };
}
export function getRemoteConversationForMode(remoteConversationsByMode, mode) {
    var _a;
    return (_a = remoteConversationsByMode[mode]) !== null && _a !== void 0 ? _a : null;
}
export function clearRemoteConversationForMode(remoteConversationsByMode, mode) {
    delete remoteConversationsByMode[mode];
}
export function shouldSyncDeletesToProvider(studyAssistant) {
    var _a;
    return !!((_a = studyAssistant === null || studyAssistant === void 0 ? void 0 : studyAssistant.privacy) === null || _a === void 0 ? void 0 : _a.syncDeletesToProvider);
}
export async function bestEffortDeleteRemoteConversation(settings, ref) {
    const result = await deleteStudyAssistantConversation({
        settings,
        conversationId: ref.conversationId,
    });
    if (!result.deleted && !result.unsupported && result.detail) {
        log.warn(`[study-assistant] Remote delete failed for ${ref.provider}:${ref.conversationId} (${result.detail})`);
    }
}
