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
 */

import type { SproutSettings } from "../../types/settings";

export type StudyAssistantProvider = SproutSettings["studyAssistant"]["provider"];

export type StudyAssistantConversationRef = {
  provider: StudyAssistantProvider;
  conversationId: string;
  backend?: string;
};

export type StudyAssistantCardType = keyof SproutSettings["studyAssistant"]["generatorTypes"];

export type StudyAssistantGeneratorInput = {
  notePath: string;
  noteContent: string;
  imageRefs: string[];
  imageDataUrls?: string[];
  attachedFileDataUrls?: string[];
  includeImages: boolean;
  enabledTypes: StudyAssistantCardType[];
  targetSuggestionCount: number;
  includeTitle: boolean;
  includeInfo: boolean;
  includeGroups: boolean;
  customInstructions: string;
  userRequestText?: string;
  conversationId?: string;
};

export type StudyAssistantSuggestion = {
  type: StudyAssistantCardType;
  difficulty: number;
  title?: string;
  question?: string;
  answer?: string;
  clozeText?: string;
  info?: string;
  groups?: string[];
  options?: string[];
  correctOptionIndexes?: number[];
  steps?: string[];
  ioSrc?: string;
  ioOcclusions?: Array<{
    rectId?: string;
    id?: string;
    x: number;
    y: number;
    w: number;
    h: number;
    groupKey?: string;
    shape?: "rect" | "circle";
  }>;
  ioMaskMode?: "solo" | "all";
  noteRows?: string[];
  rationale?: string;
  sourceOrigin?: "note" | "external";
};

export type StudyAssistantGeneratorResult = {
  suggestions: StudyAssistantSuggestion[];
  payloadPreview: string;
  rawResponseText: string;
  conversationId?: string;
};

export type StudyAssistantChatMode = "ask" | "review";

export type StudyAssistantReviewDepth = "quick" | "standard" | "comprehensive";

export type StudyAssistantChatInput = {
  mode: StudyAssistantChatMode;
  notePath: string;
  noteContent: string;
  imageRefs: string[];
  imageDataUrls?: string[];
  attachedFileDataUrls?: string[];
  includeImages: boolean;
  userMessage: string;
  customInstructions: string;
  reviewDepth?: StudyAssistantReviewDepth;
  conversationId?: string;
};

export type StudyAssistantChatResult = {
  reply: string;
  payloadPreview: string;
  rawResponseText: string;
  conversationId?: string;
};

// ── Linked-context limit presets ──

export type ContextLimitPreset = "conservative" | "standard" | "extended" | "none";

export type ContextLimitValues = {
  maxNotes: number;
  maxCharsPerNote: number;
  maxCharsTotal: number;
};

const LINKED_CONTEXT_PRESETS: Record<ContextLimitPreset, ContextLimitValues> = {
  conservative: { maxNotes: 3, maxCharsPerNote: 4000, maxCharsTotal: 12000 },
  standard:     { maxNotes: 6, maxCharsPerNote: 8000, maxCharsTotal: 30000 },
  extended:     { maxNotes: 12, maxCharsPerNote: 16000, maxCharsTotal: 60000 },
  none:         { maxNotes: 999, maxCharsPerNote: 999_999, maxCharsTotal: 999_999 },
};

export function getLinkedContextLimits(preset: ContextLimitPreset | undefined): ContextLimitValues {
  return LINKED_CONTEXT_PRESETS[preset ?? "standard"] ?? LINKED_CONTEXT_PRESETS.standard;
}

export type TextAttachmentLimitValues = {
  maxFiles: number;
  maxCharsPerFile: number;
  maxCharsTotal: number;
};

const TEXT_ATTACHMENT_PRESETS: Record<ContextLimitPreset, TextAttachmentLimitValues> = {
  conservative: { maxFiles: 3, maxCharsPerFile: 6000, maxCharsTotal: 18000 },
  standard:     { maxFiles: 6, maxCharsPerFile: 12000, maxCharsTotal: 48000 },
  extended:     { maxFiles: 12, maxCharsPerFile: 24000, maxCharsTotal: 96000 },
  none:         { maxFiles: 999, maxCharsPerFile: 999_999, maxCharsTotal: 999_999 },
};

export function getTextAttachmentLimits(preset: ContextLimitPreset | undefined): TextAttachmentLimitValues {
  return TEXT_ATTACHMENT_PRESETS[preset ?? "standard"] ?? TEXT_ATTACHMENT_PRESETS.standard;
}
