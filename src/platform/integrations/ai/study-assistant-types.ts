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
