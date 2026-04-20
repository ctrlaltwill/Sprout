import type { UserIntentClassification } from "../../../platform/integrations/ai/study-assistant-generator";
import { isGenerateFlashcardRequest, isTestGenerationRequest } from "./generation-helpers";

export type StudyAssistantIntentContextMessage = {
  role: "user" | "assistant";
  text: string;
};

export type StudyAssistantIntentRoutingResult = {
  intent: UserIntentClassification;
  requiresClassifierFallback: boolean;
};

function looksLikeReviewRequest(value: string): boolean {
  if (!value) return false;
  if (/^(quick|standard|comprehensive)\s+review\b/.test(value)) return true;
  if (/\breview\b/.test(value) && /\b(note|draft|section|paragraph|text|content|summary|this|it)\b/.test(value)) {
    return true;
  }
  if (/\b(?:critique|feedback|assess|evaluate|audit)\b/.test(value)
    && /\b(note|draft|section|paragraph|text|content|writing|summary|this|it)\b/.test(value)) {
    return true;
  }
  return /\bwhat can i improve\b/.test(value)
    || /\bhow can i improve (?:this|my|it) (?:note|draft|section|paragraph|writing|summary)?\b/.test(value);
}

function looksLikeEditRequest(value: string): boolean {
  if (!value) return false;
  if (/\b(?:apply|make|do|implement|use)\b[\s\S]{0,40}\b(?:changes|edits|suggestions|recommendations|revisions)\b/.test(value)) {
    return true;
  }
  if (/\bmake\s+(?:it|this|that|them)\s+(?:shorter|longer|clearer|cleaner|better|more concise|more detailed|more formal)\b/.test(value)) {
    return true;
  }

  const hasEditVerb = /\b(?:rewrite|rephrase|edit|fix|correct|polish|refine|tighten|shorten|expand|clarify|improve|update|change)\b/.test(value);
  if (!hasEditVerb) return false;
  if (/(?:\b(?:note|draft|paragraph|section|sentence|wording|text|content|summary|intro|introduction|conclusion|bullet|bullets)\b)/.test(value)) {
    return true;
  }

  return /^(?:rewrite|rephrase|edit|fix|correct|polish|refine|tighten|shorten|expand|clarify|improve|update|change)\b[\s\S]{0,40}\b(?:this|my|it)\b/.test(value);
}

function needsIntentClassifierFallback(value: string, recentMessages: StudyAssistantIntentContextMessage[]): boolean {
  if (!value || !recentMessages.length) return false;

  const compact = value.replace(/\s+/g, " ").trim();
  const words = compact ? compact.split(" ") : [];
  const hasRecentAssistantContext = recentMessages.slice(-6).some((message) => message.role === "assistant" && String(message.text || "").trim());
  if (!hasRecentAssistantContext) return false;

  if (/^(?:do it|do that|apply it|apply them|make the changes|go ahead|yes please|sounds good|use that|implement that|fix it|rewrite it|rephrase it|shorten it|expand it|clarify it|improve it|review it|generate more)\b/.test(compact)) {
    return true;
  }

  return words.length <= 7
    && /\b(?:it|that|this|them|those)\b/.test(compact)
    && /\b(?:apply|do|implement|make|fix|rewrite|rephrase|shorten|expand|clarify|improve|review|generate|turn|change|update)\b/.test(compact);
}

export function inferStudyAssistantIntentHeuristically(params: {
  text: string;
  recentMessages?: StudyAssistantIntentContextMessage[];
  hasPriorGenerateContext?: boolean;
}): StudyAssistantIntentRoutingResult {
  const value = String(params.text || "").trim().toLowerCase();
  const recentMessages = Array.isArray(params.recentMessages) ? params.recentMessages : [];
  const hasPriorGenerateContext = !!params.hasPriorGenerateContext;

  if (!value) return { intent: "ask", requiresClassifierFallback: false };
  if (isTestGenerationRequest(value) || isGenerateFlashcardRequest(value, hasPriorGenerateContext)) {
    return { intent: "generate", requiresClassifierFallback: false };
  }
  if (looksLikeReviewRequest(value)) return { intent: "review", requiresClassifierFallback: false };
  if (looksLikeEditRequest(value)) return { intent: "edit", requiresClassifierFallback: false };

  return {
    intent: "ask",
    requiresClassifierFallback: needsIntentClassifierFallback(value, recentMessages),
  };
}