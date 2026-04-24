/**
 * @file src/platform/integrations/ai/study-assistant-types.ts
 * @summary Module for study assistant types.
 *
 * @exports
 *  - StudyAssistantProvider
 *  - StudyAssistantConversationRef
 *  - StudyAssistantCardType
 *  - StudyAssistantGeneratorInput
 *  - StudyAssistantSuggestion
 *  - StudyAssistantGeneratorResult
 *  - StudyAssistantEditChange
 *  - StudyAssistantEditProposal
 */
const LINKED_CONTEXT_PRESETS = {
    conservative: { maxNotes: 3, maxCharsPerNote: 4000, maxCharsTotal: 12000 },
    standard: { maxNotes: 6, maxCharsPerNote: 8000, maxCharsTotal: 30000 },
    extended: { maxNotes: 12, maxCharsPerNote: 16000, maxCharsTotal: 60000 },
    none: { maxNotes: 999, maxCharsPerNote: 999999, maxCharsTotal: 999999 },
};
export function getLinkedContextLimits(preset) {
    var _a;
    return (_a = LINKED_CONTEXT_PRESETS[preset !== null && preset !== void 0 ? preset : "standard"]) !== null && _a !== void 0 ? _a : LINKED_CONTEXT_PRESETS.standard;
}
const TEXT_ATTACHMENT_PRESETS = {
    conservative: { maxFiles: 3, maxCharsPerFile: 6000, maxCharsTotal: 18000 },
    standard: { maxFiles: 6, maxCharsPerFile: 12000, maxCharsTotal: 48000 },
    extended: { maxFiles: 12, maxCharsPerFile: 24000, maxCharsTotal: 96000 },
    none: { maxFiles: 999, maxCharsPerFile: 999999, maxCharsTotal: 999999 },
};
export function getTextAttachmentLimits(preset) {
    var _a;
    return (_a = TEXT_ATTACHMENT_PRESETS[preset !== null && preset !== void 0 ? preset : "standard"]) !== null && _a !== void 0 ? _a : TEXT_ATTACHMENT_PRESETS.standard;
}
