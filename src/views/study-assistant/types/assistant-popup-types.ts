/**
 * @file src/views/study-assistant/types/assistant-popup-types.ts
 * @summary Module for assistant popup types.
 *
 * @exports
 *  - AssistantMode
 *  - StudyAssistantLocation
 *  - StudyAssistantModalButtonVisibility
 *  - ChatMessage
 *  - GenerateSuggestionBatch
 *  - SuggestionValidationResult
 */

import type { TFile, WorkspaceLeaf } from "obsidian";
import type { SproutSettings } from "../../../platform/types/settings";
import type {
  StudyAssistantConversationRef,
  StudyAssistantEditChange,
  StudyAssistantReviewDepth,
  StudyAssistantSuggestion,
} from "../../../platform/integrations/ai/study-assistant-types";

export type AssistantMode = "assistant" | "review" | "generate";
export type StudyAssistantLocation = SproutSettings["studyAssistant"]["location"];
export type StudyAssistantModalButtonVisibility = SproutSettings["studyAssistant"]["modalButtonVisibility"];

export type EditProposalStatus = "pending" | "accepted" | "rejected" | "partial" | "expired";

export type ChatMessageEditProposal = {
  summary: string;
  edits: Array<StudyAssistantEditChange & { status?: "pending" | "accepted" | "rejected" }>;
  status: EditProposalStatus;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  attachmentNames?: string[];
  editProposal?: ChatMessageEditProposal;
};

export type GenerateSuggestionBatch = {
  source?: "assistant" | "generate";
  assistantMessageIndex: number;
  suggestions: StudyAssistantSuggestion[];
};

export type SuggestionValidationResult = {
  validSuggestions: StudyAssistantSuggestion[];
  rejectedReasons: string[];
};

export type ModeConversationRefs = Partial<Record<AssistantMode, StudyAssistantConversationRef>>;
export type PendingReplyByMode = Partial<Record<AssistantMode, boolean>>;

export type IoSuggestionRect = {
  rectId?: string;
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  groupKey?: string;
  shape?: "rect" | "circle";
};

export type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export type SpeechRecognitionErrorEventLike = {
  error?: string;
};

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
};

export type SpeechRecognitionConstructorLike = {
  new (): SpeechRecognitionLike;
  available?: (langs: string[]) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install?: (langs: string[]) => Promise<boolean>;
};

export type AssistantLeafSession = {
  activeFile: TFile | null;
  isOpen: boolean;
  mode: AssistantMode;
  chatMessages: ChatMessage[];
  chatDraft: string;
  chatError: string;
  reviewDepth: StudyAssistantReviewDepth;
  reviewMessages: ChatMessage[];
  reviewDraft: string;
  reviewError: string;
  generateMessages: ChatMessage[];
  generateDraft: string;
  generateSuggestionBatches: GenerateSuggestionBatch[];
  pendingReplyByMode: PendingReplyByMode;
  remoteConversationsByMode: ModeConversationRefs;
  generatorError: string;
  insertingSuggestionKey: string | null;
  isInsertingSuggestion: boolean;
};

export type ChatLogSyncEventDetail = {
  sourceId: string;
  filePath: string;
};

export type AssistantLeafSessionMap = WeakMap<WorkspaceLeaf, AssistantLeafSession>;
