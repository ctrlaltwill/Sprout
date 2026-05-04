/**
 * @file src/platform/integrations/ai/study-assistant-generator.ts
 * @summary Module for study assistant generator.
 *
 * @exports
 *  - generateStudyAssistantSuggestions
 *  - generateStudyAssistantSuggestionsStreaming
 *  - generateStudyAssistantChatReply
 *  - generateStudyAssistantChatReplyStreaming
 *  - classifyUserIntent
 *  - parseEditProposal
 */

import type { SproutSettings } from "../../types/settings";
import { extractIoImageRefs } from "../../image-occlusion/io-helpers";
import { requestStudyAssistantCompletionDetailed, requestStudyAssistantStreamingCompletion } from "./study-assistant-provider";
import { buildStudyAssistantHiddenPrompt } from "./study-assistant-hidden-prompts";
import type {
  StudyAssistantAttachmentRoute,
  StudyAssistantChatInput,
  StudyAssistantChatResult,
  StudyAssistantCardType,
  StudyAssistantEditProposal,
  StudyAssistantGeneratorInput,
  StudyAssistantGeneratorResult,
  StudyAssistantSuggestion,
} from "./study-assistant-types";

function combineAttachmentRoutes(...routes: StudyAssistantAttachmentRoute[]): StudyAssistantAttachmentRoute {
  if (routes.includes("retry-fallback")) return "retry-fallback";
  if (routes.includes("forced-fallback")) return "forced-fallback";
  if (routes.includes("native")) return "native";
  return "none";
}

function clampDifficulty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(3, Math.round(n)));
}

function extractFirstJsonObject(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const raw = String(text || "");
  const candidates: string[] = [];

  // Scan for balanced JSON values (objects/arrays) while respecting quoted strings and escapes.
  let start = -1;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (stack.length === 0) start = i;
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length === 0) continue;
      const open = stack[stack.length - 1];
      const isPair = (open === "{" && ch === "}") || (open === "[" && ch === "]");
      if (!isPair) continue;
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1).trim());
        start = -1;
      }
    }
  }

  // Prefer a parseable payload that already includes a suggestions array
  // or is itself an array of suggestions.
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return candidate;
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.suggestions)) return candidate;
      }
    } catch {
      // ignore and continue
    }
  }

  // Otherwise return the first parseable JSON object.
  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // ignore and continue
    }
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return raw.slice(firstBracket, lastBracket + 1).trim();
  }

  return raw.trim();
}

const EDIT_PROPOSAL_START_TAG = "<learnkit-edit-proposal>";
const EDIT_PROPOSAL_END_TAG = "</learnkit-edit-proposal>";

function extractTaggedEditProposal(text: string): string {
  const raw = String(text || "");
  const start = raw.indexOf(EDIT_PROPOSAL_START_TAG);
  if (start === -1) return "";

  const bodyStart = start + EDIT_PROPOSAL_START_TAG.length;
  const end = raw.indexOf(EDIT_PROPOSAL_END_TAG, bodyStart);
  return (end === -1 ? raw.slice(bodyStart) : raw.slice(bodyStart, end)).trim();
}

function trimTrailingMarkerFragment(text: string, marker: string): string {
  const value = String(text || "");
  const maxFragmentLength = Math.min(marker.length - 1, value.length);

  for (let size = maxFragmentLength; size > 0; size -= 1) {
    if (marker.startsWith(value.slice(-size))) {
      return value.slice(0, -size);
    }
  }

  return value;
}

export function extractVisibleEditResponseText(rawText: string): string {
  const raw = String(rawText || "");
  const markerStart = raw.indexOf(EDIT_PROPOSAL_START_TAG);
  let visible = markerStart >= 0 ? raw.slice(0, markerStart) : raw;
  visible = trimTrailingMarkerFragment(visible, EDIT_PROPOSAL_START_TAG);

  const trimmedStart = visible.trimStart();
  if (markerStart === -1 && (/^```(?:json)?/i.test(trimmedStart) || trimmedStart.startsWith("{"))) {
    return "";
  }

  return visible.trimEnd();
}

function coerceString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim();
  }
  return "";
}

function normalizeComparisonText(value: unknown): string {
  const text = coerceString(value)
    .replace(/\{\{c\d+::([\s\S]*?)\}\}/gi, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#]/g, " ")
    .toLowerCase();

  return text
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeComparisonText(value: string): string[] {
  return normalizeComparisonText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function topicsLikelyEquivalent(a: string, b: string): boolean {
  const na = normalizeComparisonText(a);
  const nb = normalizeComparisonText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 20 && longer.includes(shorter)) return true;

  const aTokens = new Set(tokenizeComparisonText(a));
  const bTokens = new Set(tokenizeComparisonText(b));
  if (!aTokens.size || !bTokens.size) return false;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  const minSize = Math.min(aTokens.size, bTokens.size);
  return minSize >= 3 && overlap >= Math.max(3, Math.ceil(minSize * 0.7));
}

function parseDelimitedRow(line: string): { key: string; value: string } | null {
  const m = String(line || "").match(/^\s*([^|]+?)\s*\|\s*(.*?)\s*(?:\|\s*)?$/);
  if (!m) return null;
  const key = String(m[1] || "").trim().toUpperCase();
  const value = coerceString(m[2]);
  if (!key || !value) return null;
  return { key, value };
}

function hasClozeDeletion(value: string): boolean {
  return /\{\{c\d+::[\s\S]+?\}\}/i.test(String(value || ""));
}

function buildExistingFlashcardTopics(noteContent: string): string[] {
  const lines = String(noteContent || "").split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const row = parseDelimitedRow(line);
    if (!row) continue;
    if (!["Q", "RQ", "MCQ", "OQ", "CQ"].includes(row.key)) continue;
    out.push(row.value);
  }

  const deduped: string[] = [];
  for (const topic of out) {
    if (!topic) continue;
    if (deduped.some((existing) => topicsLikelyEquivalent(existing, topic))) continue;
    deduped.push(topic);
  }

  return deduped.slice(0, 60);
}

function extractSuggestionTopics(s: StudyAssistantSuggestion): string[] {
  const out: string[] = [];
  const maybePush = (value: unknown) => {
    const text = coerceString(value);
    if (text) out.push(text);
  };

  const noteRows = Array.isArray(s.noteRows) ? s.noteRows : [];
  for (const rowText of noteRows) {
    const row = parseDelimitedRow(String(rowText || ""));
    if (!row) continue;
    if (["Q", "RQ", "MCQ", "OQ", "CQ"].includes(row.key)) maybePush(row.value);
  }

  maybePush(s.question);
  maybePush(s.clozeText);

  const deduped: string[] = [];
  for (const topic of out) {
    if (deduped.some((existing) => topicsLikelyEquivalent(existing, topic))) continue;
    deduped.push(topic);
  }

  return deduped;
}

function userExplicitlyAllowsRepeatTopics(input: StudyAssistantGeneratorInput): boolean {
  const text = `${coerceString(input.userRequestText)}\n${coerceString(input.customInstructions)}`.toLowerCase();
  if (!text) return false;

  if (/\b(do not|don't|avoid|without)\b[\s\S]{0,30}\b(repeat|duplicate|same topics?)\b/i.test(text)) return false;

  const allowPatterns = [
    /\b(repeat|duplicate|reuse)\b[\s\S]{0,40}\b(card|question|topic)s?\b/i,
    /\b(rephrase|rewrite|variant|variants)\b[\s\S]{0,40}\b(existing|current|same)\b[\s\S]{0,40}\b(card|question|topic)s?\b/i,
    /\bmore\s+of\s+the\s+same\b/i,
  ];

  return allowPatterns.some((re) => re.test(text));
}

export type UserRequestOverrides = {
  count?: number;
  exactCountRequested?: boolean;
  types?: StudyAssistantCardType[];
  perTypeCounts?: Map<StudyAssistantCardType, number>;
  topic?: string;
  clozeHints?: "always" | "never" | "auto";
  comboMode?: "product" | "zip" | "auto";
};

type GenerationIntent = {
  requestedCount: number;
  exactCountRequested: boolean;
  requestedTypes: StudyAssistantCardType[] | null;
  requestedTopic: string;
  allowExternalKnowledge: boolean;
  avoidRepeatingExistingTopics: boolean;
  clozeHints: "always" | "never" | "auto";
  comboMode: "product" | "zip" | "auto";
};

const TYPE_ALIASES: Record<string, StudyAssistantCardType> = {
  basic: "basic",
  "basic card": "basic",
  "basic cards": "basic",
  reversed: "reversed",
  reverse: "reversed",
  "reversed card": "reversed",
  "reversed cards": "reversed",
  cloze: "cloze",
  "cloze card": "cloze",
  "cloze cards": "cloze",
  mcq: "mcq",
  "mcq card": "mcq",
  "mcq cards": "mcq",
  "multiple choice": "mcq",
  "multiple-choice": "mcq",
  "multiple choice question": "mcq",
  "multiple-choice question": "mcq",
  oq: "oq",
  "ordered question": "oq",
  "ordered-question": "oq",
  sequence: "oq",
  "ordered question card": "oq",
  io: "io",
  "image occlusion": "io",
  "image-occlusion": "io",
  "image occlusion card": "io",
  "image-occlusion card": "io",
  combo: "combo",
  "combo card": "combo",
  "combo cards": "combo",
  "combination card": "combo",
  "combination cards": "combo",
};

function wordToNumber(w: string): number {
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  if (/\b(one|a|an|single)\b/i.test(w)) return 1;
  return 0;
}

export function parseUserRequestOverrides(text: string): UserRequestOverrides {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return {};

  const result: UserRequestOverrides = {};

  // Match patterns like "3 MCQs", "one cloze", "a paired combo", "single basic card"
  // Word numbers (one/a/an/single) are converted to 1; optional combo-mode modifier sits between number and type
  const countTypePattern = /\b(\d{1,3}|one|a|an|single)\s+(?:paired|sequential|zip|cross|cartesian|cross[- ]product|product|combinatorial)?\s*(basic|reversed?|clozes?|mcqs?|combos?|multiple[- ]choice(?:\s+questions?)?|oqs?|ordered[- ]questions?|sequences?|ios?|image[- ]occlusions?)\b/gi;
  const typeOnlyPattern = /\b(basic|reversed?|clozes?|mcqs?|combos?|multiple[- ]choice(?:\s+questions?)?|oqs?|ordered[- ]questions?|sequences?|ios?|image[- ]occlusions?)\s*(cards?|questions?|flashcards?)?\b/gi;
  const countOnlyPattern = /\b(\d{1,3})\s+(cards?|questions?|flashcards?)\b/i;

  // Extract count+type pairs first
  const detectedTypes: StudyAssistantCardType[] = [];
  const perTypeCounts = new Map<StudyAssistantCardType, number>();
  let match: RegExpExecArray | null;

  while ((match = countTypePattern.exec(t)) !== null) {
    const n = wordToNumber(match[1]);
    if (n <= 0) continue;
    let typeKey = match[2].toLowerCase().trim();
    if (/^reverses?$/.test(typeKey)) typeKey = "reverse";
    typeKey = typeKey
      .replace(/\bquestions?\b/g, "")
      .replace(/\bcards?\b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/s$/, "");
    const mapped = TYPE_ALIASES[typeKey];
    if (mapped) {
      result.count = (result.count ?? 0) + n;
      result.exactCountRequested = true;
      perTypeCounts.set(mapped, (perTypeCounts.get(mapped) ?? 0) + n);
      if (!detectedTypes.includes(mapped)) detectedTypes.push(mapped);
    }
  }

  // If no count+type pair, look for standalone type mentions
  if (!detectedTypes.length) {
    while ((match = typeOnlyPattern.exec(t)) !== null) {
      let typeKey = match[1].toLowerCase().trim();
      if (/^reverses?$/.test(typeKey)) typeKey = "reverse";
      typeKey = typeKey
        .replace(/\bquestions?\b/g, "")
        .replace(/\bcards?\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/s$/, "");
      const mapped = TYPE_ALIASES[typeKey];
      if (mapped && !detectedTypes.includes(mapped)) detectedTypes.push(mapped);
    }
  }

  // Also check standalone count like "3 cards" and take the max with any summed per-type counts
  const cm = countOnlyPattern.exec(t);
  if (cm) {
    const standaloneCount = parseInt(cm[1], 10);
    if (result.count == null) {
      result.count = standaloneCount;
    } else {
      result.count = Math.max(result.count, standaloneCount);
    }
    result.exactCountRequested = true;
  }
  // If still no count, handle "a card", "a question"
  if (result.count == null) {
    if (/\b(a|an|one|single)\s+(card|question|flashcard)\b/i.test(t)) {
      result.count = 1;
      result.exactCountRequested = true;
    }
    // Handle singular type-only asks like "a cloze on X" / "single basic"
    else if (detectedTypes.length > 0 && /\b(a|an|one|single)\s+(basic|reverse(?:d)?|cloze|combo|mcq|multiple[- ]choice|oq|ordered[- ]question|sequence|io|image[- ]occlusion)\b/i.test(t)) {
      result.count = 1;
      result.exactCountRequested = true;
    }
  }

  if (result.count != null) result.count = Math.max(1, Math.floor(result.count));
  if (detectedTypes.length) result.types = detectedTypes;
  if (perTypeCounts.size > 0) result.perTypeCounts = perTypeCounts;
  result.topic = extractRequestedTopic(t);

  // Detect cloze hint preference from user request
  result.clozeHints = detectClozeHintPreference(t);

  // Detect combo mode preference from user request
  result.comboMode = detectComboModePreference(t);

  return result;
}

function detectClozeHintPreference(text: string): "always" | "never" | "auto" {
  const t = String(text || "").toLowerCase();
  // Explicit "with hints" / "include hints" → always
  if (/\b(with|include|using|has|have)\s+hints?\b/i.test(t)) return "always";
  if (/\bhints?\s+(included|present|added|enabled)\b/i.test(t)) return "always";
  // Explicit "no hints" / "without hints" / "don't include hints" → never
  if (/\b(no|without|don'?t\s+include|never|omit|exclude|skip)\s+hints?\b/i.test(t)) return "never";
  if (/\bhints?\s+(off|disabled|removed|not|never)\b/i.test(t)) return "never";
  // Default: let AI decide
  return "auto";
}

function detectComboModePreference(text: string): "product" | "zip" | "auto" {
  const t = String(text || "").toLowerCase();
  // Sequential / paired / zip
  if (/\b(sequential|paired|pair|zip|one.to.one|1.to.1|strict)\s+(combo|card|flashcard)s?\b/i.test(t)) return "zip";
  if (/\b(combo|card|flashcard)s?\s+(sequential|paired|zip)\b/i.test(t)) return "zip";
  if (/\b(paired|pair|sequential|zip)\s+(combo|card|flashcard)s?\b/i.test(t)) return "zip";
  // Cross / cartesian / cross-product / product
  if (/\b(cross|cross.product|cartesian|product|combinatorial|all.combinations?)\s+(combo|card|flashcard)s?\b/i.test(t)) return "product";
  if (/\b(combo|card|flashcard)s?\s+(cross|cross.product|cartesian|product)\b/i.test(t)) return "product";
  // Default: let AI decide
  return "auto";
}

function extractRequestedTopic(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";

  const patterns = [
    /\b(?:on|about|regarding|focused on|focus on)\s+([^,.;!?\n]+)/i,
    /\b(?:for)\s+([^,.;!?\n]+?)\s+(?:flashcards?|cards?|questions?|mcqs?|clozes?|reversed|basics?)\b/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const topic = m[1]
      .replace(/^the\s+/i, "")
      .replace(/^this\s+/i, "")
      .trim();
    if (!topic) continue;
    if (/^(topic|note|this topic|this note)$/i.test(topic)) continue;
    return topic;
  }

  return "";
}

function userExplicitlyRequestsExternalKnowledge(input: StudyAssistantGeneratorInput): boolean {
  const text = `${coerceString(input.userRequestText)}\n${coerceString(input.customInstructions)}`.toLowerCase();
  if (!text) return false;
  return [
    /\bexternal\s+knowledge\b/i,
    /\boutside\s+(?:the\s+)?note\b/i,
    /\bgeneral\s+knowledge\b/i,
    /\bnot\s+in\s+(?:the\s+)?note\b/i,
  ].some((re) => re.test(text));
}

function buildGenerationIntent(input: StudyAssistantGeneratorInput, overrides: UserRequestOverrides): GenerationIntent {
  const baseTarget = Math.max(1, Math.min(10, Math.round(Number(input.targetSuggestionCount) || 5)));
  const requestedCount = overrides.count ?? baseTarget;
  return {
    requestedCount,
    exactCountRequested: !!overrides.exactCountRequested,
    requestedTypes: overrides.types?.length ? [...new Set(overrides.types)] : null,
    requestedTopic: String(overrides.topic || "").trim(),
    allowExternalKnowledge: userExplicitlyRequestsExternalKnowledge(input),
    avoidRepeatingExistingTopics: !userExplicitlyAllowsRepeatTopics(input),
    clozeHints: overrides.clozeHints || "auto",
    comboMode: overrides.comboMode || "auto",
  };
}

function suggestionTextForRelevance(s: StudyAssistantSuggestion): string {
  const noteRows = Array.isArray(s.noteRows) ? s.noteRows.join(" ") : "";
  return [
    s.title,
    s.question,
    s.answer,
    s.clozeText,
    s.info,
    noteRows,
  ].map((v) => coerceString(v)).filter(Boolean).join(" ");
}

function topicRelevanceScore(topic: string, suggestion: StudyAssistantSuggestion): number {
  const normalizedTopic = normalizeComparisonText(topic);
  if (!normalizedTopic) return 1;

  const haystack = normalizeComparisonText(suggestionTextForRelevance(suggestion));
  if (!haystack) return 0;
  if (haystack.includes(normalizedTopic)) return 1;

  const topicTokens = tokenizeComparisonText(topic).filter((token) => token.length >= 4);
  if (!topicTokens.length) return 1;

  let overlap = 0;
  for (const token of topicTokens) {
    if (haystack.includes(token)) overlap += 1;
  }

  return overlap / topicTokens.length;
}

function topicRelevanceThreshold(topic: string): number {
  const tokens = tokenizeComparisonText(topic).filter((token) => token.length >= 4);
  if (tokens.length <= 1) return 1;
  if (tokens.length === 2) return 0.5;
  return 0.4;
}

function validateAndRepairSuggestions(
  intent: GenerationIntent,
  suggestions: StudyAssistantSuggestion[],
  noteContent: string,
): StudyAssistantSuggestion[] {
  const out: StudyAssistantSuggestion[] = [];
  const existingTopics = buildExistingFlashcardTopics(noteContent);
  const topicThreshold = intent.requestedTopic ? topicRelevanceThreshold(intent.requestedTopic) : 0;

  for (const suggestion of suggestions) {
    if (intent.requestedTypes?.length && !intent.requestedTypes.includes(suggestion.type)) continue;
    if (!intent.allowExternalKnowledge && suggestion.sourceOrigin === "external") continue;

    if (intent.requestedTopic) {
      const score = topicRelevanceScore(intent.requestedTopic, suggestion);
      if (score < topicThreshold) continue;
    }

    const suggestionTopics = extractSuggestionTopics(suggestion);
    if (intent.avoidRepeatingExistingTopics && suggestionTopics.length > 0) {
      const duplicatesExisting = suggestionTopics.some((topic) =>
        existingTopics.some((existing) => topicsLikelyEquivalent(topic, existing)));
      if (duplicatesExisting) continue;
    }

    const duplicatesOutput = out.some((existingSuggestion) => {
      const existingSuggestionTopics = extractSuggestionTopics(existingSuggestion);
      if (!existingSuggestionTopics.length || !suggestionTopics.length) return false;
      return suggestionTopics.some((topic) =>
        existingSuggestionTopics.some((existingTopic) => topicsLikelyEquivalent(topic, existingTopic)));
    });
    if (duplicatesOutput) continue;

    out.push(suggestion);
  }

  return out;
}

function resolveSuggestionsWithFallback(
  intent: GenerationIntent,
  suggestions: StudyAssistantSuggestion[],
  noteContent: string,
): StudyAssistantSuggestion[] {
  const strict = validateAndRepairSuggestions(intent, suggestions, noteContent);
  if (strict.length > 0 || suggestions.length === 0) return strict;

  // Fallback path: keep type/duplicate guards, but relax topic/source strictness
  // so short follow-up requests like "make a cloze on prognosis" do not collapse to zero.
  const relaxedIntent: GenerationIntent = {
    ...intent,
    requestedTopic: "",
    allowExternalKnowledge: true,
  };
  const relaxed = validateAndRepairSuggestions(relaxedIntent, suggestions, noteContent);
  if (relaxed.length > 0) return relaxed;

  // Last-resort fallback: if strict dedupe against existing note cards would produce zero,
  // keep best-effort suggestions so the user gets actionable output instead of an empty run.
  const minimal: StudyAssistantSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (intent.requestedTypes?.length && !intent.requestedTypes.includes(suggestion.type)) continue;

    const suggestionTopics = extractSuggestionTopics(suggestion);
    const duplicatesOutput = minimal.some((existingSuggestion) => {
      const existingSuggestionTopics = extractSuggestionTopics(existingSuggestion);
      if (!existingSuggestionTopics.length || !suggestionTopics.length) return false;
      return suggestionTopics.some((topic) =>
        existingSuggestionTopics.some((existingTopic) => topicsLikelyEquivalent(topic, existingTopic)));
    });
    if (duplicatesOutput) continue;

    minimal.push(suggestion);
  }

  return minimal;
}

function complexityScoreForSuggestion(s: StudyAssistantSuggestion): number {
  const promptText = coerceString(s.question || s.clozeText || s.title || "");
  const answerText = coerceString(s.answer || "");
  const promptTokens = tokenizeComparisonText(promptText).length;
  const answerTokens = tokenizeComparisonText(answerText).length;
  const optionsCount = Array.isArray(s.options) ? s.options.length : 0;
  const stepsCount = Array.isArray(s.steps) ? s.steps.length : 0;
  const clozeCount = (String(s.clozeText || "").match(/\{\{c\d+::/gi) || []).length;

  const typeWeight: Record<StudyAssistantCardType, number> = {
    basic: 1.0,
    reversed: 1.15,
    cloze: 1.2,
    mcq: 1.3,
    oq: 1.35,
    io: 1.25,
    combo: 1.15,
  };

  return (
    (typeWeight[s.type] ?? 1)
    + promptTokens * 0.06
    + answerTokens * 0.03
    + optionsCount * 0.07
    + stepsCount * 0.08
    + clozeCount * 0.12
  );
}

function assignDifficultyLevels(suggestions: StudyAssistantSuggestion[]): StudyAssistantSuggestion[] {
  if (!suggestions.length) return [];

  const scored = suggestions.map((suggestion, idx) => ({
    suggestion,
    idx,
    score: complexityScoreForSuggestion(suggestion),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });

  const n = scored.length;
  const withLevels = scored.map((item, rank) => {
    let difficulty = 2;
    if (n === 1) {
      difficulty = 2;
    } else if (n === 2) {
      difficulty = rank === 0 ? 3 : 1;
    } else {
      const ratio = rank / (n - 1);
      if (ratio <= 0.33) difficulty = 3;
      else if (ratio <= 0.66) difficulty = 2;
      else difficulty = 1;
    }

    return {
      ...item.suggestion,
      difficulty,
    };
  });

  // Keep hardest first, matching current UI expectations.
  withLevels.sort((a, b) => b.difficulty - a.difficulty);
  return withLevels;
}

function wordCount(value: string): number {
  return value.split(/\s+/g).map((token) => token.trim()).filter(Boolean).length;
}

function isLikelyOpenEndedPrompt(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  if (text.includes("?")) return true;
  return /^(who|what|when|where|why|how|which)\b/i.test(text);
}

function isReversedPairSafe(question: string, answer: string): boolean {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return false;

  // Reversed cards should be compact, atomic mappings in both directions.
  if (q.length > 80 || a.length > 56) return false;
  if (wordCount(q) > 10 || wordCount(a) > 8) return false;
  if (isLikelyOpenEndedPrompt(q)) return false;

  return true;
}

function downgradeReversedRowsToBasic(rows: string[]): string[] {
  return rows.map((line) => line.replace(/^(\s*)RQ(\s*\|)/i, "$1Q$2"));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => coerceString(v))
    .filter(Boolean);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.floor(n)));
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const MIN_IO_PLACEMENT_CONFIDENCE = 0.72;
const MIN_IO_OCR_LABEL_MATCH_SCORE = 0.78;
const MAX_IO_OCR_REGION_WIDTH = 0.65;
const MAX_IO_OCR_REGION_HEIGHT = 0.35;
const MAX_IO_OCR_REGION_AREA = 0.12;
const LOW_VALUE_IO_IMAGE_KINDS = new Set([
  "photo",
  "decorative-photo",
  "generic-photo",
  "clinical-photo",
  "screenshot",
  "scan",
  "other",
]);

function normalizeIoMaskMode(value: unknown): "solo" | "all" | undefined {
  const v = coerceString(value).toLowerCase();
  if (v === "solo" || v === "all") return v;
  return undefined;
}

function normalizeIoGroupKey(value: unknown, fallbackIndex: number): string {
  const raw = coerceString(value).toLowerCase();
  if (!raw) return String(fallbackIndex);
  if (/^\d+$/.test(raw)) return String(Math.max(1, parseInt(raw, 10)));

  const m = raw.match(/\d+/);
  if (m?.[0]) return String(Math.max(1, parseInt(m[0], 10)));
  return String(fallbackIndex);
}

function normalizeIoAssessmentImageRef(value: unknown): string | undefined {
  const raw = coerceString(value);
  if (!raw) return undefined;
  const refs = extractIoImageRefs(raw);
  return refs[0] || raw;
}

function normalizeIoImageKind(value: unknown): string | undefined {
  const raw = coerceString(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (!raw) return undefined;
  if (raw.includes("annotated") && raw.includes("photo")) return "annotated-photo";
  if (raw.includes("diagram") || raw.includes("schematic") || raw.includes("illustration") || raw.includes("anatomy")) return "diagram";
  if (raw.includes("flow") || raw.includes("pathway")) return "flowchart";
  if (raw.includes("chart") || raw.includes("graph")) return "chart";
  if (raw.includes("table")) return "table";
  if (raw.includes("map")) return "map";
  if (raw.includes("screen") || raw.includes("screenshot") || raw.includes("ui")) return "screenshot";
  if (raw.includes("scan") || raw.includes("xray") || raw.includes("ct") || raw.includes("mri") || raw.includes("ultrasound")) return "clinical-photo";
  if (raw.includes("photo") || raw.includes("picture") || raw.includes("image")) return "photo";
  return raw;
}

function normalizeIoStudyValue(value: unknown): "high" | "medium" | "low" | "none" | undefined {
  const raw = coerceString(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (!raw) return undefined;
  if (["high", "high-yield", "strong", "useful", "study-worthy"].includes(raw)) return "high";
  if (["medium", "moderate", "possible", "borderline"].includes(raw)) return "medium";
  if (["low", "weak"].includes(raw)) return "low";
  if (["none", "decorative", "skip", "not-useful", "not-study-worthy"].includes(raw)) return "none";
  return undefined;
}

function normalizeIoPlacementConfidence(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return undefined;
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return clamp01(normalized);
}

function normalizeIoAssessment(value: unknown): StudyAssistantSuggestion["ioAssessment"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const targetLabels = toStringArray(rec.targetLabels ?? rec.targets ?? rec.labels)
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 12);
  const assessment: NonNullable<StudyAssistantSuggestion["ioAssessment"]> = {
    imageRef: normalizeIoAssessmentImageRef(rec.imageRef ?? rec.ref ?? rec.image ?? rec.ioSrc),
    imageKind: normalizeIoImageKind(rec.imageKind ?? rec.kind ?? rec.imageType ?? rec.visualType),
    studyValue: normalizeIoStudyValue(rec.studyValue ?? rec.usefulness ?? rec.yield ?? rec.studyUsefulness),
    placementConfidence: normalizeIoPlacementConfidence(
      rec.placementConfidence ?? rec.confidence ?? rec.maskConfidence ?? rec.localizationConfidence,
    ),
    targetLabels: targetLabels.length ? targetLabels : undefined,
    usefulnessReason: coerceString(rec.usefulnessReason ?? rec.reason ?? rec.justification) || undefined,
  };

  if (!assessment.imageRef && !assessment.imageKind && !assessment.studyValue && assessment.placementConfidence === undefined && !assessment.targetLabels?.length && !assessment.usefulnessReason) {
    return undefined;
  }

  return assessment;
}

function isHighYieldIoAssessment(value: StudyAssistantSuggestion["ioAssessment"] | undefined): value is NonNullable<StudyAssistantSuggestion["ioAssessment"]> {
  if (!value) return false;
  if (value.studyValue !== "high") return false;
  if ((value.placementConfidence ?? 0) < MIN_IO_PLACEMENT_CONFIDENCE) return false;
  if (!Array.isArray(value.targetLabels) || value.targetLabels.length === 0) return false;
  if (value.imageKind && LOW_VALUE_IO_IMAGE_KINDS.has(value.imageKind)) return false;
  return true;
}

function normalizeAllowedIoImageRefs(input: StudyAssistantGeneratorInput): Set<string> {
  const maxVisionRefs = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean).length : 0;
  const candidateRefs = maxVisionRefs > 0
    ? input.imageRefs.slice(0, maxVisionRefs)
    : input.imageRefs;

  const normalized = candidateRefs
    .map((ref) => normalizeIoAssessmentImageRef(ref))
    .filter((ref): ref is string => !!ref);

  return new Set(normalized);
}

function normalizeIoTargetLabel(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeIoTargetLabel(value: string): string[] {
  const normalized = normalizeIoTargetLabel(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

type OcrIoRegion = {
  text: string;
  confidence?: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

function normalizeOcrIoRegion(value: unknown): OcrIoRegion | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const text = coerceString(rec.text).trim();
  const x = toFiniteNumber(rec.x);
  const y = toFiniteNumber(rec.y);
  const w = toFiniteNumber(rec.w);
  const h = toFiniteNumber(rec.h);
  if (!text || x === null || y === null || w === null || h === null) return null;
  if (w <= 0 || h <= 0) return null;
  const confidence = toFiniteNumber(rec.confidence ?? rec.score);
  return {
    text,
    confidence: confidence === null ? undefined : clamp01(confidence > 1 && confidence <= 100 ? confidence / 100 : confidence),
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(w),
    h: clamp01(h),
  };
}

function buildIoOcrRegionMap(input: StudyAssistantGeneratorInput): Map<string, OcrIoRegion[]> {
  const descriptors = Array.isArray(input.imageDescriptors) ? input.imageDescriptors : [];
  const out = new Map<string, OcrIoRegion[]>();
  const seenByRef = new Map<string, Set<string>>();

  for (const descriptor of descriptors) {
    const imageRef = normalizeIoAssessmentImageRef(descriptor?.ref);
    if (!imageRef) continue;
    const rawRegions = Array.isArray(descriptor?.ocrTextRegions) ? descriptor.ocrTextRegions : [];
    if (!rawRegions.length) continue;

    let regions = out.get(imageRef);
    if (!regions) {
      regions = [];
      out.set(imageRef, regions);
    }

    let seen = seenByRef.get(imageRef);
    if (!seen) {
      seen = new Set<string>();
      seenByRef.set(imageRef, seen);
    }

    for (const rawRegion of rawRegions) {
      const region = normalizeOcrIoRegion(rawRegion);
      if (!region) continue;
      const key = [
        normalizeIoTargetLabel(region.text),
        region.x.toFixed(4),
        region.y.toFixed(4),
        region.w.toFixed(4),
        region.h.toFixed(4),
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      regions.push(region);
    }
  }

  return out;
}

function scoreIoTargetLabelMatch(label: string, regionText: string): number {
  const normalizedLabel = normalizeIoTargetLabel(label);
  const normalizedRegion = normalizeIoTargetLabel(regionText);
  if (!normalizedLabel || !normalizedRegion) return 0;
  if (normalizedLabel === normalizedRegion) return 1;

  const labelTokens = tokenizeIoTargetLabel(normalizedLabel);
  const regionTokens = tokenizeIoTargetLabel(normalizedRegion);
  if (!labelTokens.length || !regionTokens.length) return 0;

  const regionTokenSet = new Set(regionTokens);
  const overlapCount = labelTokens.filter((token) => regionTokenSet.has(token)).length;
  if (!overlapCount) return 0;

  const recall = overlapCount / labelTokens.length;
  const precision = overlapCount / regionTokens.length;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  let score = f1;
  if (normalizedRegion.includes(normalizedLabel)) score = Math.min(0.96, score + 0.04);
  else if (normalizedLabel.includes(normalizedRegion)) score = Math.min(0.9, score + 0.02);

  return clamp01(score);
}

function ocrRegionArea(region: OcrIoRegion): number {
  return Math.max(0, region.w) * Math.max(0, region.h);
}

function isPlausibleIoOcrRegion(region: OcrIoRegion): boolean {
  const area = ocrRegionArea(region);
  if (region.w > MAX_IO_OCR_REGION_WIDTH || region.h > MAX_IO_OCR_REGION_HEIGHT || area > MAX_IO_OCR_REGION_AREA) {
    return false;
  }

  const touchesEdge = region.x <= 0.01 || region.y <= 0.01 || (region.x + region.w) >= 0.99 || (region.y + region.h) >= 0.99;
  if (touchesEdge && (region.w > 0.28 || region.h > 0.16)) return false;

  return true;
}

function dedupeIoOcclusions(
  rects: NonNullable<StudyAssistantSuggestion["ioOcclusions"]>,
): NonNullable<StudyAssistantSuggestion["ioOcclusions"]> {
  const seen = new Set<string>();
  const out: NonNullable<StudyAssistantSuggestion["ioOcclusions"]> = [];

  for (const rect of rects) {
    const normalized: NonNullable<StudyAssistantSuggestion["ioOcclusions"]>[number] = {
      ...rect,
      x: clamp01(rect.x),
      y: clamp01(rect.y),
      w: clamp01(rect.w),
      h: clamp01(rect.h),
      shape: rect.shape === "circle" ? "circle" : "rect",
    };
    const key = [
      normalized.x.toFixed(4),
      normalized.y.toFixed(4),
      normalized.w.toFixed(4),
      normalized.h.toFixed(4),
      normalized.shape,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out.map((rect, idx) => ({
    ...rect,
    rectId: `r${idx + 1}`,
    groupKey: String(idx + 1),
  }));
}

function applyOcrTextRegionsToIoSuggestion(
  suggestion: StudyAssistantSuggestion,
  ocrRegionsByImageRef: Map<string, OcrIoRegion[]>,
): StudyAssistantSuggestion | null {
  if (suggestion.type !== "io") return suggestion;

  const imageRef = normalizeIoAssessmentImageRef(extractIoImageKey(suggestion));
  if (!imageRef) return suggestion;

  const ocrRegions = ocrRegionsByImageRef.get(imageRef);
  if (!ocrRegions?.length) return suggestion;

  const targetLabels = Array.isArray(suggestion.ioAssessment?.targetLabels)
    ? suggestion.ioAssessment.targetLabels.map((label) => String(label || "").trim()).filter(Boolean)
    : [];
  if (!targetLabels.length) return suggestion;

  const labels = targetLabels
    .map((label, originalIndex) => ({
      label,
      originalIndex,
      tokenCount: Math.max(1, tokenizeIoTargetLabel(label).length),
    }))
    .sort((a, b) => b.tokenCount - a.tokenCount || a.originalIndex - b.originalIndex);

  const usedRegionIndexes = new Set<number>();
  const matches: Array<{ originalIndex: number; region: OcrIoRegion; score: number }> = [];

  for (const label of labels) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let idx = 0; idx < ocrRegions.length; idx += 1) {
      if (usedRegionIndexes.has(idx)) continue;
      const region = ocrRegions[idx];
      if (!isPlausibleIoOcrRegion(region)) continue;
      const score = scoreIoTargetLabelMatch(label.label, region.text);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
        continue;
      }
      if (score === bestScore && bestIndex >= 0) {
        const regionArea = ocrRegionArea(region);
        const currentBestArea = ocrRegionArea(ocrRegions[bestIndex]);
        if (regionArea < currentBestArea - 0.0005) {
          bestIndex = idx;
          continue;
        }
        const regionConfidence = region.confidence ?? 0;
        const currentBestConfidence = ocrRegions[bestIndex]?.confidence ?? 0;
        if (regionConfidence > currentBestConfidence) {
          bestIndex = idx;
        }
      }
    }

    if (bestIndex >= 0 && bestScore >= MIN_IO_OCR_LABEL_MATCH_SCORE) {
      usedRegionIndexes.add(bestIndex);
      matches.push({
        originalIndex: label.originalIndex,
        region: ocrRegions[bestIndex],
        score: bestScore,
      });
    }
  }

  const requiredMatches = targetLabels.length <= 2 ? 1 : Math.ceil(targetLabels.length * 0.5);
  if (matches.length < requiredMatches) return null;

  matches.sort((a, b) => a.originalIndex - b.originalIndex);

  const nextOcclusions = matches.map((match, idx) => ({
    rectId: `r${idx + 1}`,
    x: match.region.x,
    y: match.region.y,
    w: match.region.w,
    h: match.region.h,
    groupKey: String(idx + 1),
    shape: "rect" as const,
  }));
  const averageScore = matches.reduce((sum, match) => sum + match.score, 0) / Math.max(1, matches.length);
  const coverage = matches.length / Math.max(1, targetLabels.length);
  const placementConfidence = Math.max(
    suggestion.ioAssessment?.placementConfidence ?? 0,
    clamp01(averageScore * 0.7 + coverage * 0.3),
  );

  const nextSuggestion: StudyAssistantSuggestion = {
    ...suggestion,
    ioOcclusions: nextOcclusions,
    ioMaskMode: suggestion.ioMaskMode || "solo",
    ioAssessment: suggestion.ioAssessment
      ? {
          ...suggestion.ioAssessment,
          imageRef,
          targetLabels: matches.map((match) => match.region.text),
          placementConfidence,
        }
      : suggestion.ioAssessment,
  };

  if (Array.isArray(nextSuggestion.noteRows) && nextSuggestion.noteRows.length) {
    nextSuggestion.noteRows = upsertIoRows(
      nextSuggestion.noteRows,
      extractIoImageKey(nextSuggestion),
      nextOcclusions,
      nextSuggestion.ioMaskMode,
    );
  }

  return nextSuggestion;
}

function applyOcrTextRegionsToSuggestions(
  suggestions: StudyAssistantSuggestion[],
  input: StudyAssistantGeneratorInput,
): StudyAssistantSuggestion[] {
  const ocrRegionsByImageRef = buildIoOcrRegionMap(input);
  if (!ocrRegionsByImageRef.size) return suggestions;

  return suggestions
    .map((suggestion) => applyOcrTextRegionsToIoSuggestion(suggestion, ocrRegionsByImageRef))
    .filter((suggestion): suggestion is StudyAssistantSuggestion => !!suggestion);
}

function allowRuntimeSuggestion(
  suggestion: StudyAssistantSuggestion,
  canUseVisionForIo: boolean,
  allowedIoImageRefs: Set<string>,
): boolean {
  if (suggestion.type !== "io") return true;
  if (!canUseVisionForIo) return false;

  const imageRef = normalizeIoAssessmentImageRef(extractIoImageKey(suggestion));
  if (!imageRef) return false;
  if (allowedIoImageRefs.size > 0 && !allowedIoImageRefs.has(imageRef)) return false;
  return true;
}

function extractIoImageKey(suggestion: StudyAssistantSuggestion): string {
  const direct = coerceString(suggestion.ioSrc);
  if (direct) return direct;

  const assessedRef = coerceString(suggestion.ioAssessment?.imageRef);
  if (assessedRef) return assessedRef;

  const rows = Array.isArray(suggestion.noteRows) ? suggestion.noteRows : [];
  for (const rowText of rows) {
    const row = parseDelimitedRow(String(rowText || ""));
    if (row?.key === "IO") return coerceString(row.value);
  }
  return "";
}

function canonicalizeIoSuggestionSrc(raw: string): string | null {
  const refs = extractIoImageRefs(raw);
  if (refs.length !== 1) return null;
  return `![[${refs[0]}]]`;
}

function upsertIoRows(
  rows: string[],
  ioSrc: string,
  ioOcclusions: NonNullable<StudyAssistantSuggestion["ioOcclusions"]>,
  ioMaskMode?: "solo" | "all",
): string[] {
  const keptRows = rows.filter((line) => {
    const row = parseDelimitedRow(String(line || ""));
    if (!row) return true;
    return row.key !== "IO" && row.key !== "O" && row.key !== "C";
  });

  if (ioSrc) keptRows.unshift(`IO | ${ioSrc} |`);
  return ensureIoMaskRows(keptRows, ioOcclusions, ioMaskMode);
}

function mergeIoSuggestionsByImage(suggestions: StudyAssistantSuggestion[]): StudyAssistantSuggestion[] {
  const out: StudyAssistantSuggestion[] = [];
  const mergedByImage = new Map<string, StudyAssistantSuggestion>();

  for (const suggestion of suggestions) {
    if (suggestion.type !== "io") {
      out.push(suggestion);
      continue;
    }

    const imageKey = extractIoImageKey(suggestion) || `__io_image_${out.length}`;
    const existing = mergedByImage.get(imageKey);
    if (!existing) {
      const normalizedOcclusions = dedupeIoOcclusions(
        (Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions : [])
          .map((rect, idx) => ({
            ...rect,
            rectId: coerceString(rect.rectId ?? rect.id) || `r${idx + 1}`,
            groupKey: String(idx + 1),
          })),
      );

      const nextSuggestion: StudyAssistantSuggestion = {
        ...suggestion,
        ioOcclusions: normalizedOcclusions,
        ioAssessment: suggestion.ioAssessment
          ? {
              ...suggestion.ioAssessment,
              imageRef: normalizeIoAssessmentImageRef(suggestion.ioAssessment.imageRef) || normalizeIoAssessmentImageRef(imageKey),
            }
          : suggestion.ioAssessment,
      };

      if (Array.isArray(nextSuggestion.noteRows) && nextSuggestion.noteRows.length) {
        nextSuggestion.noteRows = upsertIoRows(
          nextSuggestion.noteRows,
          extractIoImageKey(nextSuggestion),
          normalizedOcclusions,
          nextSuggestion.ioMaskMode,
        );
      }

      mergedByImage.set(imageKey, nextSuggestion);
      out.push(nextSuggestion);
      continue;
    }

    const mergedOcclusions = dedupeIoOcclusions([
      ...(Array.isArray(existing.ioOcclusions) ? existing.ioOcclusions : []),
      ...(Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions : []),
    ]);

    existing.ioOcclusions = mergedOcclusions;
    existing.ioMaskMode = existing.ioMaskMode || suggestion.ioMaskMode || (mergedOcclusions.length ? "solo" : undefined);
    existing.ioAssessment = existing.ioAssessment || suggestion.ioAssessment
      ? {
          ...(existing.ioAssessment || {}),
          ...(suggestion.ioAssessment || {}),
          imageRef: normalizeIoAssessmentImageRef(existing.ioAssessment?.imageRef)
            || normalizeIoAssessmentImageRef(suggestion.ioAssessment?.imageRef)
            || normalizeIoAssessmentImageRef(imageKey),
          placementConfidence: Math.max(
            existing.ioAssessment?.placementConfidence ?? 0,
            suggestion.ioAssessment?.placementConfidence ?? 0,
          ) || undefined,
          targetLabels: Array.from(new Set([
            ...(existing.ioAssessment?.targetLabels || []),
            ...(suggestion.ioAssessment?.targetLabels || []),
          ])).filter(Boolean),
        }
      : undefined;

    if (Array.isArray(existing.noteRows) && existing.noteRows.length) {
      existing.noteRows = upsertIoRows(
        existing.noteRows,
        extractIoImageKey(existing),
        mergedOcclusions,
        existing.ioMaskMode,
      );
    }
  }

  return out;
}

function toIoOcclusionsArray(value: unknown): NonNullable<StudyAssistantSuggestion["ioOcclusions"]> {
  if (!Array.isArray(value)) return [];
  const rawItems: unknown[] = value;
  const out: NonNullable<StudyAssistantSuggestion["ioOcclusions"]> = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item: unknown = rawItems[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const xRaw = toFiniteNumber(rec.x ?? rec.left);
    const yRaw = toFiniteNumber(rec.y ?? rec.top);
    const wRaw = toFiniteNumber(rec.w ?? rec.width);
    const hRaw = toFiniteNumber(rec.h ?? rec.height);
    if (xRaw === null || yRaw === null || wRaw === null || hRaw === null) continue;
    if (wRaw <= 0 || hRaw <= 0) continue;

    const rectId = coerceString(rec.rectId ?? rec.id) || `r${i + 1}`;
    const groupKey = normalizeIoGroupKey(rec.groupKey ?? rec.label ?? rec.name, i + 1);
    const shapeRaw = coerceString(rec.shape).toLowerCase();
    const shape: "rect" | "circle" | undefined = shapeRaw === "circle" ? "circle" : "rect";

    out.push({
      rectId,
      x: clamp01(xRaw),
      y: clamp01(yRaw),
      w: clamp01(wRaw),
      h: clamp01(hRaw),
      groupKey,
      shape,
    });
  }
  return out;
}

function rowHasKey(rows: string[], key: string): boolean {
  const re = new RegExp(`^\\s*${key}\\s*\\|`, "i");
  return rows.some((line) => re.test(String(line ?? "")));
}

function ensureIoMaskRows(
  rows: string[],
  ioOcclusions: NonNullable<StudyAssistantSuggestion["ioOcclusions"]>,
  ioMaskMode?: "solo" | "all",
): string[] {
  const next = rows.slice();
  if (ioOcclusions.length && !rowHasKey(next, "O")) {
    next.push(`O | ${JSON.stringify(ioOcclusions)} |`);
  }
  const mode = ioMaskMode || (ioOcclusions.length ? "solo" : undefined);
  if (mode && !rowHasKey(next, "C")) {
    next.push(`C | ${mode} |`);
  }
  return next;
}

function normalizeType(value: unknown): StudyAssistantCardType | null {
  const t = coerceString(value).toLowerCase();
  if (t === "basic" || t === "reversed" || t === "cloze" || t === "mcq" || t === "oq" || t === "io" || t === "combo") {
    return t;
  }
  return null;
}

function sanitizeSuggestion(raw: unknown): StudyAssistantSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const type = normalizeType(rec.type);
  if (!type) return null;

  let suggestion: StudyAssistantSuggestion = {
    type,
    difficulty: clampDifficulty(rec.difficulty),
    title: coerceString(rec.title),
    question: coerceString(rec.question),
    answer: coerceString(rec.answer),
    clozeText: coerceString(rec.clozeText),
    info: coerceString(rec.info),
    groups: toStringArray(rec.groups),
    options: toStringArray(rec.options),
    correctOptionIndexes: toNumberArray(rec.correctOptionIndexes),
    steps: toStringArray(rec.steps),
    ioSrc: coerceString(rec.ioSrc),
    ioOcclusions: toIoOcclusionsArray(rec.ioOcclusions ?? rec.occlusions ?? rec.ioMasks ?? rec.masks),
    ioMaskMode: normalizeIoMaskMode(rec.ioMaskMode ?? rec.maskMode ?? rec.mode),
    ioAssessment: normalizeIoAssessment(rec.ioAssessment ?? rec.imageAssessment ?? rec.ioAnalysis),
    noteRows: toStringArray(rec.noteRows),
    comboMode: (coerceString(rec.comboMode) === "zip" ? "zip" : "product") as "product" | "zip",
    qVariants: toStringArray(rec.qVariants),
    aVariants: toStringArray(rec.aVariants),
    rationale: coerceString(rec.rationale),
    sourceOrigin: coerceString(rec.sourceOrigin) === "external" ? "external" : "note",
  };

  const hasNoteRows = Array.isArray(suggestion.noteRows) && suggestion.noteRows.length > 0;

  if (type === "reversed") {
    const reverseSafe = isReversedPairSafe(suggestion.question || "", suggestion.answer || "");
    if (!reverseSafe) {
      suggestion = {
        ...suggestion,
        type: "basic",
        noteRows: hasNoteRows ? downgradeReversedRowsToBasic(suggestion.noteRows || []) : suggestion.noteRows,
      };
    }
  }

  if (suggestion.type === "basic" || suggestion.type === "reversed") {
    if (!hasNoteRows && (!suggestion.question || !suggestion.answer)) return null;
  }

  if (suggestion.type === "cloze") {
    if (!hasNoteRows && !suggestion.clozeText) return null;

    const noteRows = hasNoteRows ? (suggestion.noteRows || []) : [];
    const clozeRows = noteRows
      .map((line) => parseDelimitedRow(String(line || "")))
      .filter((row): row is { key: string; value: string } => !!row && row.key === "CQ")
      .map((row) => row.value);

    const hasDeletionInClozeText = hasClozeDeletion(suggestion.clozeText || "");
    const hasDeletionInClozeRows = clozeRows.some((value) => hasClozeDeletion(value));
    const hasInvalidQaRows = noteRows.some((line) => /^\s*(?:Q|A|RQ)\s*\|/i.test(String(line || "")));

    // Cloze cards must be true cloze deletions and use CQ rows when noteRows are provided.
    if (!hasDeletionInClozeText && !hasDeletionInClozeRows) return null;
    if (hasNoteRows && (!clozeRows.length || hasInvalidQaRows)) return null;
  }

  if (suggestion.type === "mcq") {
    if (!hasNoteRows) {
      if (!suggestion.question) return null;
      if (!suggestion.options || suggestion.options.length < 2) return null;
      if (!suggestion.correctOptionIndexes || suggestion.correctOptionIndexes.length < 1) return null;
    }
  }

  if (suggestion.type === "oq") {
    if (!hasNoteRows) {
      if (!suggestion.question) return null;
    }
  }

  if (suggestion.type === "io") {
    const ioSrc = canonicalizeIoSuggestionSrc(extractIoImageKey(suggestion));
    if (!ioSrc) return null;
    if (!Array.isArray(suggestion.ioOcclusions) || suggestion.ioOcclusions.length === 0) return null;

    const ioImageRef = normalizeIoAssessmentImageRef(ioSrc);
    const ioAssessment = suggestion.ioAssessment;
    if (!isHighYieldIoAssessment(ioAssessment)) return null;

    if (ioAssessment.imageRef && normalizeIoAssessmentImageRef(ioAssessment.imageRef) !== ioImageRef) {
      return null;
    }

    suggestion = {
      ...suggestion,
      ioSrc,
      ioAssessment: {
        ...ioAssessment,
        imageRef: ioImageRef,
        targetLabels: Array.from(new Set((ioAssessment.targetLabels || []).map((label) => label.trim()).filter(Boolean))),
      },
    };

    if (hasNoteRows) {
      suggestion = {
        ...suggestion,
        noteRows: upsertIoRows(
          suggestion.noteRows || [],
          ioSrc,
          suggestion.ioOcclusions || [],
          suggestion.ioMaskMode,
        ),
      };
    }
  }

  if (suggestion.type === "combo") {
    const qVariants: string[] = suggestion.qVariants || [];
    const aVariants: string[] = suggestion.aVariants || [];
    const comboMode: "product" | "zip" = suggestion.comboMode === "zip" ? "zip" : "product";

    // If AI provided explicit noteRows, validate they carry combo delimiters
    if (hasNoteRows) {
      const rows = suggestion.noteRows || [];
      const hasComboDelimiters = rows.some((row) => {
        const text = String(row || "");
        return /:{2,3}/.test(text.replace(/^\s*[A-Za-z0-9]+\s*\|/, ""));
      });
      if (hasComboDelimiters) return suggestion;
      // NoteRows exist but lack combo delimiters — try to extract variants from them
      const qRow = rows.find((r) => /^\s*Q\s*\|/i.test(String(r || "")));
      const aRow = rows.find((r) => /^\s*A\s*\|/i.test(String(r || "")));
      if (qRow || aRow) {
        const qVal = qRow ? String(qRow).replace(/^\s*Q\s*\|/i, "").replace(/\|\s*$/, "").trim() : "";
        const aVal = aRow ? String(aRow).replace(/^\s*A\s*\|/i, "").replace(/\|\s*$/, "").trim() : "";
        // Try splitting on semicolons, commas, or newlines
        const qSplit = qVal ? qVal.split(/\s*[;,]\s*/).filter(Boolean) : [];
        const aSplit = aVal ? aVal.split(/\s*[;,]\s*/).filter(Boolean) : [];
        if (qSplit.length >= 2 || aSplit.length >= 2) {
          const useQ = qSplit.length >= 2 ? qSplit : (qVal ? [qVal] : []);
          const useA = aSplit.length >= 2 ? aSplit : (aVal ? [aVal] : []);
          return buildComboNoteRows(suggestion, useQ, useA, comboMode);
        }
        // Single Q and A with no internal structure — cannot be a valid combo
        // Fall through to check qVariants/aVariants
      }
    }

    // Require at least 2 variants total across both sides
    if (qVariants.length < 1 || aVariants.length < 1) return null;
    if (qVariants.length === 1 && aVariants.length === 1) return null;

    if (comboMode === "zip" && qVariants.length !== aVariants.length) return null;

    return buildComboNoteRows(suggestion, qVariants.slice(0, 4), aVariants.slice(0, 4), comboMode);
  }

  return suggestion;
}

function buildComboNoteRows(
  suggestion: StudyAssistantSuggestion,
  qVariants: string[],
  aVariants: string[],
  comboMode: "product" | "zip",
): StudyAssistantSuggestion {
  const sep = comboMode === "zip" ? " ::: " : " :: ";
  const qRow = `Q | ${qVariants.join(sep)} |`;
  const aRow = `A | ${aVariants.join(sep)} |`;
  return { ...suggestion, noteRows: [qRow, aRow] };
}

function parseSuggestions(rawText: string): StudyAssistantSuggestion[] {
  const jsonSource = extractFirstJsonObject(rawText);
  if (!jsonSource) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSource);
  } catch {
    return [];
  }

  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const items = Array.isArray(parsed)
    ? parsed
    : obj && Array.isArray(obj.suggestions)
      ? obj.suggestions
      : obj && Array.isArray(obj.flashcards)
        ? obj.flashcards
        : obj && Array.isArray(obj.cards)
          ? obj.cards
          : [];

  const suggestions: StudyAssistantSuggestion[] = [];
  for (const item of items) {
    const s = sanitizeSuggestion(item);
    if (s) suggestions.push(s);
  }

  const normalizedSuggestions = mergeIoSuggestionsByImage(suggestions);

  normalizedSuggestions.sort((a, b) => b.difficulty - a.difficulty);
  return normalizedSuggestions;
}

function findStreamingSuggestionArrayStart(rawText: string): number {
  const value = String(rawText || "");
  const keyPatterns = [
    /"suggestions"\s*:\s*\[/,
    /"flashcards"\s*:\s*\[/,
    /"cards"\s*:\s*\[/,
  ];

  for (const pattern of keyPatterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const bracketIndex = value.indexOf("[", match.index);
    if (bracketIndex >= 0) return bracketIndex;
  }

  const firstNonWhitespace = value.search(/\S/);
  if (firstNonWhitespace >= 0 && value[firstNonWhitespace] === "[") {
    return firstNonWhitespace;
  }

  return -1;
}

function extractStreamingJsonArrayItems(rawText: string): string[] {
  const value = String(rawText || "");
  const arrayStart = findStreamingSuggestionArrayStart(value);
  if (arrayStart < 0) return [];

  const items: string[] = [];
  let inString = false;
  let escape = false;
  let itemStart = -1;
  let depth = 0;

  for (let i = arrayStart + 1; i < value.length; i += 1) {
    const ch = value[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (itemStart === -1) {
      if (/\s/.test(ch) || ch === ",") continue;
      if (ch === "]") break;

      if (ch !== "{" && ch !== "[") {
        let end = i + 1;
        while (end < value.length && value[end] !== "," && value[end] !== "]") end += 1;
        const candidate = value.slice(i, end).trim();
        if (candidate) items.push(candidate);
        i = end - 1;
        continue;
      }

      itemStart = i;
      depth = 1;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        items.push(value.slice(itemStart, i + 1).trim());
        itemStart = -1;
      }
    }
  }

  return items;
}

function parseStreamingSuggestions(rawText: string): StudyAssistantSuggestion[] {
  const items = extractStreamingJsonArrayItems(rawText);
  if (!items.length) return [];

  const suggestions: StudyAssistantSuggestion[] = [];
  for (const item of items) {
    try {
      const parsed: unknown = JSON.parse(item);
      const suggestion = sanitizeSuggestion(parsed);
      if (suggestion) suggestions.push(suggestion);
    } catch {
      // Ignore incomplete or malformed partial items while streaming.
    }
  }

  return suggestions;
}

function modelLikelySupportsVision(settings: SproutSettings["studyAssistant"]): boolean {
  const model = String(settings.model || "").toLowerCase();
  if (!model) return false;

  return [
    "vision",
    "vl",
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "o1",
    "o3",
    "o4",
    "claude",
    "sonnet",
    "opus",
    "haiku",
    "gemini",
    "pixtral",
    "llava",
  ].some((token) => model.includes(token));
}

function buildSystemPrompt(customInstructions: string, canUseVisionForIo: boolean): string {
  const hiddenPrompt = buildStudyAssistantHiddenPrompt("flashcard");

  const lines = [
    hiddenPrompt,
    "",
    "Public-mode instructions:",
    "You are LearnKit Study Companion, generating flashcards from user notes.",
    "Return strictly valid JSON only with exactly one top-level object: {\"suggestions\":[...]}",
    "Do not output markdown, code fences, explanations, or extra keys outside the documented schema.",
    "Return valid JSON matching this schema:",
    '{"suggestions":[{"type":"basic|reversed|cloze|mcq|oq|io","difficulty":1-3,"sourceOrigin":"note|external","title":"optional","question":"optional","answer":"optional","clozeText":"optional","options":["..."],"correctOptionIndexes":[0],"steps":["..."],"ioSrc":"optional","ioOcclusions":[{"rectId":"r1","x":0.1,"y":0.2,"w":0.2,"h":0.08,"groupKey":"1","shape":"rect"}],"ioMaskMode":"solo|all","ioAssessment":{"imageRef":"optional","imageKind":"diagram|annotated-photo|chart|table|map|flowchart|photo|clinical-photo|screenshot|other","studyValue":"high|medium|low|none","placementConfidence":0.0,"targetLabels":["..."],"usefulnessReason":"optional"},"info":"optional","groups":["optional/group"],"noteRows":["KIND | value |"],"rationale":"optional"}]}',
    "Prefer semantic fields (question/answer/clozeText/options/correctOptionIndexes/steps/ioSrc/ioOcclusions/ioMaskMode).",
    "Include noteRows only when you can guarantee exact parser-safe Sprout row syntax.",
    'Set sourceOrigin to "note" when the card tests content present in the note.',
    'Only use sourceOrigin "external" if the user explicitly asks for external/background knowledge.',
    "MCQ noteRows format (exactly ONE A row for the correct answer, 3-4 O rows for wrong options, NEVER more than one A row): [\"MCQ | question stem |\", \"A | the single correct option |\", \"O | plausible wrong option |\", \"O | plausible wrong option |\", \"O | plausible wrong option |\"]",
    "OQ noteRows format — MANDATORY when user asks for ordered/sequence cards (use numbered rows for ordered steps, NEVER A/O rows): [\"OQ | question prompt |\", \"1 | first step |\", \"2 | second step |\", \"3 | third step |\"]",
    "MCQ uses A/O rows only. OQ uses numbered rows only. Do NOT mix these formats.",
    "For type=cloze, every card must include at least one valid {{cN::...}} deletion and use CQ rows (never Q/A rows).",
    "Cloze rows may contain multiple deletions in a single CQ line (e.g. {{c1::...}}, {{c2::...}}, {{c3::...}}).",
    "Grouped/shared cloze indices are allowed (e.g. {{c1::A}} and {{c1::B}} in the same card).",
    "Never label a question-answer fact card as type=cloze unless it contains explicit cloze deletion markup.",
    "IO rows must include embedded image syntax in IO | ... |.",
    "For IO, ioSrc and any IO row must contain exactly one embedded image reference. Never place multiple images in one IO field.",
    "For IO, include O row with occlusions JSON and C row with mask mode (solo/all).",
    "For IO occlusions, use normalized coordinates x,y,w,h in [0,1] plus rectId and groupKey.",
    "For IO with visual input, emit at most one IO suggestion per image; include all masks for that image in that single suggestion.",
    "For IO groupKey values, use numeric strings only (\"1\", \"2\", \"3\", ...). Do not use prefixes like g1.",
    "For IO placement, each mask should tightly cover the full target label/text block (including multi-word labels), with slight padding and without covering nearby unrelated labels.",
    "For IO, first decide what kind of image it is and whether it is genuinely high-yield for study on this page before creating any masks.",
    "Only emit IO for clearly study-worthy visuals such as labeled diagrams, annotated figures, flowcharts, tables/charts with discrete labels, or annotated photos with explicit target labels.",
    "Do not emit IO for decorative photos, generic unlabeled clinical photos, screenshots, scans, UI captures, or images where the intended labels/targets are ambiguous.",
    "Every IO suggestion must include ioAssessment with imageRef, imageKind, studyValue, placementConfidence in [0,1], targetLabels, and usefulnessReason.",
    "Set ioAssessment.studyValue to high only when the image is clearly worth studying and the intended targets are explicit.",
    "If you cannot name the exact labels or targets you plan to occlude, do not emit IO.",
    "If imageDescriptors include ocrTextRegions, treat those OCR text regions as authoritative label candidates with normalized geometry.",
    "When ocrTextRegions are present, prefer targetLabels that exactly match those OCR texts and use them to ground IO masks rather than guessing freehand coordinates.",
    canUseVisionForIo
      ? "Use OCR/vision reasoning on referenced images and imageDescriptors to decide whether each image is suitable for IO, then locate labels and produce occlusion rectangles only for the suitable images."
      : "Vision input is unavailable for this run, so do not emit IO suggestions or guessed occlusion coordinates.",
    "Use reversed cards only when both sides form a short, unambiguous two-way mapping; otherwise use basic cards.",
    "Flashcard quality rules (apply strictly):",
    "- One concept per card: each card should test a single, clear idea.",
    "- For tightly grouped lists of related items (e.g. 5 symptom clusters, 4 score components, 3 diagnostic criteria), prefer ONE cloze card with multiple deletions ({{c1::...}}, {{c2::...}}, etc.) so the learner sees full context. Only split into separate single-cloze cards if the list is large (>6 items) or cognitively heavy.",
    "- Each cloze deletion should be 1–4 words. Up to ~6 words is acceptable for multi-word technical terms. Never delete an entire sentence or long phrase. HARD CAP: 8 cloze deletions maximum per card. Cards with 9+ clozes will be rejected. If you need more than 8 deletions, split into multiple separate cloze cards.",
    "- For longer definitions or factual prompts, use basic (Q/A) cards rather than cloze.",
    "- Keep answers short and recognisable at a glance: a single term, phrase, or tight list of ≤3 items. Avoid full paragraphs on the answer side.",
    "- Make the tested concept immediately obvious from the question stem — the answer should feel like a clean retrieval, not a summary essay.",
    "- Do not overcrowd: split multi-part answers into separate cards rather than stacking unrelated facts.",
    "- Prioritise high-yield, exam-worthy content: diagnostic criteria, mechanisms, treatment principles, management steps, classifications, prognosis, key values/thresholds, and named processes. De-prioritise low-yield trivia such as historical dates, version numbers, or author names unless the user specifically requests them.",
    "- Distribute cards across different sections and topics of the note rather than clustering on one area, unless the user specifies a particular topic.",
    "- MCQ rules: Use ONLY positive stems. WRONG (never use): \"Which of the following is NOT...\" CORRECT: \"Which of the following is...\" Mark exactly ONE option as correct with exactly one A row in noteRows. All distractors must be plausible but clearly incorrect to someone who understands the material.",
    "- Choose card type by learning objective: CQ for in-context recall and grouped lists, Q for definitions and stemmed questions, RQ for bidirectional associations and language pairs, MCQ for exam-style discrimination, OQ for ordered sequences/steps only.",
    "- OQ (ordered question) CARDS ARE MANDATORY WHEN REQUESTED: If the user asks for ordered questions, sequences, or steps, EVERY returned suggestion must be type=oq with numbered step rows. Never substitute cloze or basic cards when ordered questions are explicitly requested.",
    "- Language flag tokens ({{es}}, {{en}}, etc.) are ONLY for language-learning cards. Do not add them to medical, science, history, or general knowledge cards.",
    "- Do not include markdown formatting (bold, italic, etc.) in card content. Use plain text only.",
    "- Always include a rationale field explaining why you chose this card type and what learning objective it serves.",
    "Do not include markdown code fences.",
    "- Avoid duplicate cards. Within a single response, do not generate multiple cards that test the same fact or concept from different angles. Each card must cover a unique concept not tested by any other card in this response.",
  ];

  const extra = customInstructions.trim();
  if (extra) {
    lines.push("User custom instructions:");
    lines.push(extra);
  }

  return lines.join("\n");
}

function buildChatSystemPrompt(input: StudyAssistantChatInput): string {
  const hiddenPrompt = buildStudyAssistantHiddenPrompt(input.mode);

  const lines = [
    hiddenPrompt,
    "",
    "Public-mode instructions:",
    input.mode === "edit"
      ? "You are LearnKit Study Companion. Edit the note content as the user requested."
      : input.mode === "ask"
        ? "You are LearnKit Study Companion. Answer with note context first, then supplement with external knowledge when needed."
        : "You are LearnKit Study Companion. Review the note content using both note evidence and subject knowledge to provide study-focused quality feedback.",
    "Use a warm, human tone when appropriate. Be motivating and supportive, especially when the user seems discouraged.",
    "Be concise, clear, and practical.",
    "When content is not supported by the note, state that it is external/background knowledge.",
    input.mode === "edit"
      ? `First, write a brief plain-text summary for the user. Then output ${EDIT_PROPOSAL_START_TAG} followed by strictly valid JSON and then ${EDIT_PROPOSAL_END_TAG}.`
      : "",
    input.mode === "edit"
      ? "Inside the tagged block, output JSON only with exactly two keys: summary and edits. Do not use markdown code fences."
      : "",
    input.mode === "edit" ? "" : "Use markdown formatting when useful.",
  ].filter(Boolean);

  const extra = input.customInstructions.trim();
  if (extra) {
    lines.push("User custom instructions:");
    lines.push(extra);
  }

  return lines.join("\n");
}

function buildChatUserPrompt(input: StudyAssistantChatInput): string {
  const reviewDepth = input.mode === "review"
    ? (input.reviewDepth === "quick" || input.reviewDepth === "comprehensive" ? input.reviewDepth : "standard")
    : undefined;

  // Build a concise conversation-history block so the model can see prior turns
  const historyBlock = (input.conversationHistory?.length)
    ? input.conversationHistory
        .slice(-20) // keep last 20 messages to avoid exceeding context limits
        .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n\n")
    : "";

  const payload = {
    notePath: input.notePath,
    includeImages: input.includeImages,
    imageRefs: input.includeImages ? input.imageRefs : [],
    noteContent: input.noteContent,
    conversationHistory: historyBlock || undefined,
    userMessage: input.userMessage,
    reviewDepth,
  };

  if (input.mode === "edit") {
    return [
      "Edit the note content as requested by the user.",
      "Return two parts in this exact order:",
      "1. A short plain-text summary for the user describing the changes you prepared.",
      `2. ${EDIT_PROPOSAL_START_TAG}{"summary":"...","edits":[...]}${EDIT_PROPOSAL_END_TAG}`,
      "The summary inside the tagged JSON must be at most 40 words and should match the visible summary.",
      "Inside the tagged block, return strictly valid JSON only.",
      "Each edit must have an \"original\" field that is an exact verbatim substring of noteContent, and a \"replacement\" field with the new text.",
      JSON.stringify(payload, null, 2),
    ].join("\n\n");
  }

  return [
    input.mode === "ask"
      ? "Answer the user's study question using the note context first, then fill gaps with reliable general knowledge."
      : "Review the note and respond with concrete improvement actions, using both note evidence and reliable general knowledge.",
    input.mode === "review"
      ? "Match response depth to reviewDepth: quick = concise priorities, standard = balanced coverage, comprehensive = detailed audit with concrete rewrites."
      : "",
    "If a point comes from outside the note, label it briefly as external/background knowledge.",
    "Return plain markdown text only.",
    JSON.stringify(payload, null, 2),
  ].filter(Boolean).join("\n\n");
}

function buildUserPrompt(input: StudyAssistantGeneratorInput, canUseVisionForIo: boolean, overrides: UserRequestOverrides): string {
  const baseTarget = Math.max(1, Math.min(10, Math.round(Number(input.targetSuggestionCount) || 5)));
  const exactTarget = overrides.exactCountRequested && overrides.count != null
    ? Math.max(1, Math.min(20, overrides.count))
    : null;
  const target = exactTarget ?? baseTarget;
  const minCount = exactTarget ?? Math.max(1, target - 1);
  const maxCount = exactTarget ?? Math.min(10, target + 1);

  const effectiveTypes = overrides.types?.length
    ? [...new Set(overrides.types)]
    : input.enabledTypes;

  const existingFlashcardTopics = buildExistingFlashcardTopics(input.noteContent);
  const allowRepeatTopics = userExplicitlyAllowsRepeatTopics(input);

  const imageDescriptors = Array.isArray(input.imageDescriptors)
    ? input.imageDescriptors
    : [];
  const visionDescriptorRefs = new Set(
    (Array.isArray(input.imageDataUrls) ? input.imageRefs.slice(0, input.imageDataUrls.filter(Boolean).length) : input.imageRefs)
      .map((ref) => normalizeIoAssessmentImageRef(ref))
      .filter((ref): ref is string => !!ref),
  );

  const preview = {
    notePath: input.notePath,
    includeImages: input.includeImages,
    imageRefs: input.includeImages ? input.imageRefs : [],
    imageDescriptors: input.includeImages
      ? imageDescriptors.filter((descriptor) => !visionDescriptorRefs.size || visionDescriptorRefs.has(normalizeIoAssessmentImageRef(descriptor.ref) || ""))
      : [],
    visionImageCount: canUseVisionForIo ? (Array.isArray(input.imageDataUrls) ? input.imageDataUrls.length : 0) : 0,
    enabledTypes: effectiveTypes,
    targetSuggestionCount: target,
    allowedCountRange: { min: minCount, max: maxCount },
    generationOptions: {
      includeTitle: input.includeTitle,
      includeInfo: input.includeInfo,
      includeGroups: input.includeGroups,
    },
    existingFlashcardTopics,
    avoidRepeatingExistingTopics: !allowRepeatTopics,
    noteContent: input.noteContent,
  };

  const optionalRowsInstructions: string[] = [];
  if (input.includeTitle) {
    optionalRowsInstructions.push("When providing noteRows, include exactly one title row: T | ... |.");
  }
  if (input.includeInfo) {
    optionalRowsInstructions.push("When providing noteRows, include an extra information row: I | ... |.");
  }
  if (input.includeGroups) {
    optionalRowsInstructions.push("When providing noteRows, include a groups row as a comma-separated tag list: G | Parent/Child, Parent2/Child2, Lone, Lone2 |.");
    optionalRowsInstructions.push("Generate smart, study-relevant tags that help group related questions by topic/system/theme; use hierarchical paths (Parent/Child) when helpful, and single-level tags when not.");
    optionalRowsInstructions.push("Do not use JSON arrays for groups in noteRows; keep groups as one comma-separated string inside the G row.");
  }
  optionalRowsInstructions.push("If you omit noteRows, populate semantic fields fully so rows can be generated deterministically.");
  if (!input.includeTitle && !input.includeInfo && !input.includeGroups) {
    optionalRowsInstructions.push("If you include noteRows, do not include optional T/I/G rows for this run.");
  }

  // Build a per-type breakdown instruction when the user specified counts per type
  let countInstruction: string;
  if (exactTarget != null && overrides.perTypeCounts && overrides.perTypeCounts.size > 1) {
    const parts: string[] = [];
    for (const [type, cnt] of overrides.perTypeCounts) {
      parts.push(`${cnt} ${type}`);
    }
    countInstruction = `Generate exactly ${parts.join(", ")} (${target} total) high-quality flashcard ${target === 1 ? "suggestion" : "suggestions"} from this note. You MUST return exactly this many — returning fewer is unacceptable. If you cannot produce ${target} quality cards, still return ${target} by including cards from less-covered sections of the note.`;
  } else if (exactTarget != null) {
    countInstruction = `Generate exactly ${target} high-quality flashcard ${target === 1 ? "suggestion" : "suggestions"} from this note. You MUST return exactly this many — returning fewer is unacceptable. If you cannot produce ${target} quality cards, still return ${target} by including cards from less-covered sections of the note.`;
  } else {
    countInstruction = `Generate approximately ${target} high-quality flashcard suggestions from this note (allowed range: ${minCount}-${maxCount}).`;
  }

  const lines = [
    countInstruction,
    "Sort by difficulty descending (1 = easy recall, 2 = moderate recall, 3 = hard recall).",
    "Respect enabledTypes and generationOptions exactly.",
    "Output must be strictly valid JSON and parse successfully with no non-JSON text.",
    allowRepeatTopics
      ? "User explicitly requested repeats/variants of existing cards, so reusing existing flashcard topics is allowed."
      : "The note already contains flashcards. Avoid proposing cards that test the same topic/question intent as existing cards unless the user explicitly asks for repeats.",
    canUseVisionForIo
      ? "For IO cards, use the provided image inputs and imageDescriptors to decide whether an image is high-yield enough for IO. Emit IO only for clearly suitable images, and emit one IO suggestion per image with multiple masks as needed; do not split one image into multiple single-mask IO suggestions."
      : "Do not generate IO cards in this run because image vision input is unavailable.",
    canUseVisionForIo
      ? "If none of the referenced images is clearly high-yield and targetable, do not emit IO suggestions and spend the output budget on the other enabled card types."
      : "",
    "For cloze requests, return only true cloze cards with {{cN::...}} deletions and CQ rows.",
    "When the user asks for a single cloze card with multiple deletions, return one CQ row containing all requested deletions, and grouped/shared indices are allowed.",
    ...optionalRowsInstructions,
    overrides.clozeHints === "always"
      ? "CLOZE HINT MODE: The user explicitly requested hints on cloze deletions. Every cloze deletion MUST include a hint using {{cN::answer::hint}} syntax. Choose appropriate hint types: category hints for diagnostic/classification answers, first-letter hints for recall prompts, mnemonic-letter hints for mnemonic lists."
      : overrides.clozeHints === "never"
        ? "CLOZE HINT MODE: The user explicitly requested NO hints on cloze deletions. Do NOT include any ::hint suffix on cloze deletions."
        : "CLOZE HINT MODE: Use your judgment for cloze hints. Include {{cN::answer::hint}} hints for long mnemonics, ambiguous categories, or items in known mnemonic lists where a hint genuinely aids recall. Omit hints for straightforward deletions where the answer is obvious from context.",
    overrides.comboMode === "zip"
      ? "COMBO MODE: The user requested sequential/paired combos. CRITICAL: zip/paired mode uses ONLY ::: (triple colon) between variants — NEVER use :: (double colon). REQUIRED: populate qVariants[] and aVariants[] arrays with 2-4 items each (equal counts). Each variant must be a short label or phrase (NOT a full sentence question). CORRECT noteRows: [\"Q | Bupivacaine ::: Lignocaine ::: Lignocaine with adrenaline |\", \"A | 3 mg/kg ::: 4.5 mg/kg ::: 7 mg/kg |\"]. WRONG (forbidden — double colon): [\"Q | Bupivacaine :: Lignocaine |\", \"A | 3 mg/kg :: 4.5 mg/kg |\"]. If you can only think of 1 Q and 1 A, use type=basic instead."
      : overrides.comboMode === "product"
        ? "COMBO MODE: The user requested cross/cartesian combos. CRITICAL: product/cross mode uses ONLY :: (double colon) between variants — NEVER use ::: (triple colon). REQUIRED: populate qVariants[] and aVariants[] arrays with at least 2 variants total. Each variant must be a short label or phrase (NOT a full sentence question). CORRECT noteRows: [\"Q | Bupivacaine :: Lignocaine :: Lignocaine with adrenaline |\", \"A | 3 mg/kg :: 4.5 mg/kg :: 7 mg/kg |\"]. WRONG (forbidden — triple colon): [\"Q | Bupivacaine ::: Lignocaine |\", \"A | 3 mg/kg ::: 4.5 mg/kg |\"]. If you can only think of 1 Q and 1 A, use type=basic instead."
        : "COMBO MODE: The user requested combo cards. CRITICAL: choose delimiter carefully — :: (double colon) for cross/product, ::: (triple colon) for paired/zip. REQUIRED: populate qVariants[] and aVariants[] arrays with at least 2 items on one side. Each variant must be a short label or phrase (NOT a full sentence question). MUST NOT emit type=combo with only 1 Q and 1 A — use type=basic instead.",
    "Keep LaTeX and language flags (e.g. {{es}}) unchanged.",
    'Use note content as the default source of truth for all suggestions.',
    'Use sourceOrigin "external" only when the user explicitly asks for external/background knowledge; otherwise use "note".',
    "Return JSON only.",
    JSON.stringify(preview, null, 2),
  ];

  if (overrides.types?.length) {
    lines.splice(1, 0, `The user specifically requested these card types: ${overrides.types.join(", ")}. Prioritise generating these types even if they are not in the default enabledTypes list.`);
    if (overrides.types.includes("oq")) {
      lines.splice(2, 0, `OQ ENFORCEMENT (HARD REQUIREMENT — NOT OPTIONAL): Every single suggestion MUST have type='oq' with numbered step rows. Do NOT include any basic, cloze, mcq, or other card type. Non-oq cards will be rejected. Before outputting, verify ALL suggestions have type='oq'.`);
    }
  }

  // Terminal enforcement instructions (recency bias — placed at end of prompt)
  if (exactTarget != null && overrides.perTypeCounts && overrides.perTypeCounts.size > 1) {
    const checklist = [...overrides.perTypeCounts].map(([t, n]) => `${n} ${t}`).join(", ");
    lines.push(`SELF-CHECK BEFORE OUTPUT: Your response must contain exactly ${checklist} (${target} total). Count each type one by one. If any count is wrong, revise before returning JSON.`);
  }
  if (overrides.types?.includes("oq")) {
    lines.push(`OQ FINAL VERIFICATION: Confirm every suggestion in your response has type='oq'. If any suggestion has a different type, you MUST revise before returning JSON.`);
  }
  if (exactTarget != null) {
    const s = target === 1 ? "suggestion" : "suggestions";
    lines.push(`FINAL COUNT VERIFICATION: You MUST return exactly ${target} ${s} — no more, no fewer. Before outputting, count the elements in your suggestions array. It must equal ${target}. If wrong, revise now.`);
  }

  return lines.join("\n\n");
}

export async function generateStudyAssistantSuggestions(params: {
  settings: SproutSettings["studyAssistant"];
  input: StudyAssistantGeneratorInput;
}): Promise<StudyAssistantGeneratorResult> {
  const { settings, input } = params;
  const overrides = parseUserRequestOverrides(input.userRequestText || "");
  const intent = buildGenerationIntent(input, overrides);
  const exactRequested = overrides.exactCountRequested && overrides.count != null;
  if (exactRequested && (overrides.count ?? 0) > 20) {
    throw new Error("Requested flashcard count is too high. Please ask for 20 or fewer and break the request into smaller chunks by subtopic or card type.");
  }
  const baseTarget = Math.max(1, Math.min(10, Math.round(Number(input.targetSuggestionCount) || 5)));
  const target = exactRequested ? Math.max(1, Math.min(20, overrides.count ?? 1)) : (overrides.count ?? baseTarget);
  const maxAllowed = exactRequested ? target : Math.min(10, target + 1);
  const effectiveTypes = overrides.types?.length
    ? [...new Set(overrides.types)]
    : input.enabledTypes;
  const imageDataUrls = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean) : [];
  const allowedIoImageRefs = normalizeAllowedIoImageRefs(input);
  const attachedFileDataUrls = Array.isArray(input.attachedFileDataUrls) ? input.attachedFileDataUrls.filter(Boolean) : [];
  const canUseVisionForIo = !!input.includeImages && imageDataUrls.length > 0 && modelLikelySupportsVision(settings);
  const systemPrompt = buildSystemPrompt(input.customInstructions || settings.prompts.assistant || "", canUseVisionForIo);
  const userPrompt = buildUserPrompt(input, canUseVisionForIo, overrides);
  const payloadPreview = `System prompt:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`;

  let resolvedConversationId = input.conversationId;

  const firstResponse = await requestStudyAssistantCompletionDetailed({
    settings,
    systemPrompt,
    userPrompt,
    imageDataUrls: canUseVisionForIo ? imageDataUrls : [],
    attachedFileDataUrls,
    documentAttachmentMode: input.documentAttachmentMode,
    mode: "json",
    conversationId: resolvedConversationId,
  });
  const rawResponseText = firstResponse.text;
  resolvedConversationId = firstResponse.conversationId ?? resolvedConversationId;
  let attachmentRoute = firstResponse.attachmentRoute;

  let suggestions = applyOcrTextRegionsToSuggestions(parseSuggestions(rawResponseText), input)
    .filter((s) => allowRuntimeSuggestion(s, canUseVisionForIo, allowedIoImageRefs))
    .filter((s) => effectiveTypes.includes(s.type));

  suggestions = resolveSuggestionsWithFallback(intent, suggestions, input.noteContent).slice(0, maxAllowed);

  let refillRawResponseText = "";
  if (intent.exactCountRequested && suggestions.length < target) {
    const remaining = target - suggestions.length;
    const existingGeneratedTopics = suggestions
      .flatMap((s) => extractSuggestionTopics(s))
      .filter(Boolean)
      .slice(0, 25);

    const refillInput: StudyAssistantGeneratorInput = {
      ...input,
      targetSuggestionCount: remaining,
      customInstructions: [
        input.customInstructions,
        `Refill mode: Generate exactly ${remaining} additional suggestions to satisfy the requested exact count.`,
        "Do not repeat or paraphrase topics already generated in this request.",
        existingGeneratedTopics.length
          ? `Already generated topics to avoid:\n${existingGeneratedTopics.map((topic, idx) => `${idx + 1}. ${topic}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n\n"),
    };

    const refillOverrides: UserRequestOverrides = {
      ...overrides,
      count: remaining,
      exactCountRequested: true,
    };
    const refillSystemPrompt = buildSystemPrompt(refillInput.customInstructions || settings.prompts.assistant || "", canUseVisionForIo);
    const refillUserPrompt = buildUserPrompt(refillInput, canUseVisionForIo, refillOverrides);

    const refillResponse = await requestStudyAssistantCompletionDetailed({
      settings,
      systemPrompt: refillSystemPrompt,
      userPrompt: refillUserPrompt,
      imageDataUrls: canUseVisionForIo ? imageDataUrls : [],
      attachedFileDataUrls,
      documentAttachmentMode: input.documentAttachmentMode,
      mode: "json",
      conversationId: resolvedConversationId,
    });
    refillRawResponseText = refillResponse.text;
    resolvedConversationId = refillResponse.conversationId ?? resolvedConversationId;
    attachmentRoute = combineAttachmentRoutes(attachmentRoute, refillResponse.attachmentRoute);

    const refillSuggestions = applyOcrTextRegionsToSuggestions(parseSuggestions(refillRawResponseText), refillInput)
      .filter((s) => allowRuntimeSuggestion(s, canUseVisionForIo, allowedIoImageRefs))
      .filter((s) => effectiveTypes.includes(s.type));

    suggestions = resolveSuggestionsWithFallback(
      intent,
      [...suggestions, ...refillSuggestions],
      input.noteContent,
    ).slice(0, target);
  }

  const calibratedSuggestions = assignDifficultyLevels(suggestions);

  return {
    suggestions: calibratedSuggestions,
    payloadPreview,
    attachmentRoute,
    conversationId: resolvedConversationId,
    rawResponseText: refillRawResponseText
      ? `${rawResponseText}\n\n--- refill ---\n${refillRawResponseText}`
      : rawResponseText,
  };
}

export async function generateStudyAssistantSuggestionsStreaming(params: {
  settings: SproutSettings["studyAssistant"];
  input: StudyAssistantGeneratorInput;
  onSuggestion: (suggestion: StudyAssistantSuggestion) => void;
  signal?: AbortSignal;
}): Promise<StudyAssistantGeneratorResult> {
  const { settings, input, onSuggestion, signal } = params;
  const overrides = parseUserRequestOverrides(input.userRequestText || "");
  const intent = buildGenerationIntent(input, overrides);
  const exactRequested = overrides.exactCountRequested && overrides.count != null;
  if (exactRequested && (overrides.count ?? 0) > 20) {
    throw new Error("Requested flashcard count is too high. Please ask for 20 or fewer and break the request into smaller chunks by subtopic or card type.");
  }
  const baseTarget = Math.max(1, Math.min(10, Math.round(Number(input.targetSuggestionCount) || 5)));
  const target = exactRequested ? Math.max(1, Math.min(20, overrides.count ?? 1)) : (overrides.count ?? baseTarget);
  const maxAllowed = exactRequested ? target : Math.min(10, target + 1);
  const effectiveTypes = overrides.types?.length
    ? [...new Set(overrides.types)]
    : input.enabledTypes;
  const imageDataUrls = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean) : [];
  const allowedIoImageRefs = normalizeAllowedIoImageRefs(input);
  const attachedFileDataUrls = Array.isArray(input.attachedFileDataUrls) ? input.attachedFileDataUrls.filter(Boolean) : [];
  const canUseVisionForIo = !!input.includeImages && imageDataUrls.length > 0 && modelLikelySupportsVision(settings);
  const systemPrompt = buildSystemPrompt(input.customInstructions || settings.prompts.assistant || "", canUseVisionForIo);
  const userPrompt = buildUserPrompt(input, canUseVisionForIo, overrides);
  const payloadPreview = `System prompt:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`;

  let resolvedConversationId = input.conversationId;
  let attachmentRoute: StudyAssistantAttachmentRoute = "none";
  let emittedSuggestionCount = 0;

  const filterSuggestions = (suggestions: StudyAssistantSuggestion[]): StudyAssistantSuggestion[] => applyOcrTextRegionsToSuggestions(suggestions, input)
    .filter((suggestion) => allowRuntimeSuggestion(suggestion, canUseVisionForIo, allowedIoImageRefs))
    .filter((suggestion) => effectiveTypes.includes(suggestion.type));

  const emitResolvedSuggestions = (
    baseSuggestions: StudyAssistantSuggestion[],
    streamedSuggestions: StudyAssistantSuggestion[],
    limit: number,
  ): void => {
    const resolved = resolveSuggestionsWithFallback(
      intent,
      [...baseSuggestions, ...filterSuggestions(streamedSuggestions)],
      input.noteContent,
    ).slice(0, limit);

    for (let i = emittedSuggestionCount; i < resolved.length; i += 1) {
      onSuggestion(resolved[i]);
    }
    emittedSuggestionCount = Math.max(emittedSuggestionCount, resolved.length);
  };

  const runStreamingPass = async (args: {
    systemPrompt: string;
    userPrompt: string;
    baseSuggestions: StudyAssistantSuggestion[];
    limit: number;
  }): Promise<{
    rawResponseText: string;
    suggestions: StudyAssistantSuggestion[];
  }> => {
    let streamedRawText = "";

    const response = await requestStudyAssistantStreamingCompletion({
      settings,
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      mode: "json",
      imageDataUrls: canUseVisionForIo ? imageDataUrls : [],
      attachedFileDataUrls,
      documentAttachmentMode: input.documentAttachmentMode,
      conversationId: resolvedConversationId,
      signal,
      onChunk: (token) => {
        streamedRawText += token;
        emitResolvedSuggestions(args.baseSuggestions, parseStreamingSuggestions(streamedRawText), args.limit);
      },
    });

    resolvedConversationId = response.conversationId ?? resolvedConversationId;
    attachmentRoute = combineAttachmentRoutes(attachmentRoute, response.attachmentRoute);

    const resolvedSuggestions = resolveSuggestionsWithFallback(
      intent,
      [...args.baseSuggestions, ...filterSuggestions(parseSuggestions(response.text))],
      input.noteContent,
    ).slice(0, args.limit);

    for (let i = emittedSuggestionCount; i < resolvedSuggestions.length; i += 1) {
      onSuggestion(resolvedSuggestions[i]);
    }
    emittedSuggestionCount = Math.max(emittedSuggestionCount, resolvedSuggestions.length);

    return {
      rawResponseText: response.text,
      suggestions: resolvedSuggestions,
    };
  };

  const firstPass = await runStreamingPass({
    systemPrompt,
    userPrompt,
    baseSuggestions: [],
    limit: maxAllowed,
  });

  let suggestions = firstPass.suggestions;
  const rawResponseText = firstPass.rawResponseText;
  let refillRawResponseText = "";

  if (intent.exactCountRequested && suggestions.length < target) {
    const remaining = target - suggestions.length;
    const existingGeneratedTopics = suggestions
      .flatMap((suggestion) => extractSuggestionTopics(suggestion))
      .filter(Boolean)
      .slice(0, 25);

    const refillInput: StudyAssistantGeneratorInput = {
      ...input,
      targetSuggestionCount: remaining,
      customInstructions: [
        input.customInstructions,
        `Refill mode: Generate exactly ${remaining} additional suggestions to satisfy the requested exact count.`,
        "Do not repeat or paraphrase topics already generated in this request.",
        existingGeneratedTopics.length
          ? `Already generated topics to avoid:\n${existingGeneratedTopics.map((topic, idx) => `${idx + 1}. ${topic}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n\n"),
    };

    const refillOverrides: UserRequestOverrides = {
      ...overrides,
      count: remaining,
      exactCountRequested: true,
    };
    const refillSystemPrompt = buildSystemPrompt(refillInput.customInstructions || settings.prompts.assistant || "", canUseVisionForIo);
    const refillUserPrompt = buildUserPrompt(refillInput, canUseVisionForIo, refillOverrides);

    const refillPass = await runStreamingPass({
      systemPrompt: refillSystemPrompt,
      userPrompt: refillUserPrompt,
      baseSuggestions: suggestions,
      limit: target,
    });

    suggestions = refillPass.suggestions;
    refillRawResponseText = refillPass.rawResponseText;
  }

  const calibratedSuggestions = assignDifficultyLevels(suggestions);

  return {
    suggestions: calibratedSuggestions,
    payloadPreview,
    attachmentRoute,
    conversationId: resolvedConversationId,
    rawResponseText: refillRawResponseText
      ? `${rawResponseText}\n\n--- refill ---\n${refillRawResponseText}`
      : rawResponseText,
  };
}

// ── Intent classification ──

export type UserIntentClassification = "edit" | "review" | "ask" | "generate";

const CLASSIFY_SYSTEM_PROMPT = [
  "You are a request classifier for a study assistant inside Obsidian.",
  "Given a user's message about their note, respond with exactly one word — no explanation, no punctuation.",
  "You may also receive recent conversation history for context.",
  "",
  "Categories:",
  "- Edit: The user wants to modify, change, fix, rewrite, improve, or update the text content of their note. This includes follow-up requests to implement, apply, or 'do' suggestions/recommendations from a previous review.",
  "- Review: The user wants feedback, a review, critique, or quality assessment of their note.",
  "- Generate: The user wants to create flashcards, study cards, quizzes, or tests from their note content.",
  "- Ask: The user has a question, wants an explanation, or any other request that doesn't fit the above.",
  "",
  "Respond with one word only: Edit, Review, Generate, or Ask.",
].join("\n");

export function parseIntentResponse(raw: string): UserIntentClassification {
  const text = String(raw || "").trim().toLowerCase();
  if (text.startsWith("edit")) return "edit";
  if (text.startsWith("review")) return "review";
  if (text.startsWith("generate")) return "generate";
  return "ask";
}

export async function classifyUserIntent(params: {
  settings: SproutSettings["studyAssistant"];
  userMessage: string;
  recentMessages?: { role: "user" | "assistant"; text: string }[];
}): Promise<UserIntentClassification> {
  const { settings, userMessage, recentMessages } = params;

  // Build user prompt with optional conversation context
  let userPrompt = userMessage;
  if (recentMessages && recentMessages.length > 0) {
    const contextLines = recentMessages.slice(-4).map(m => {
      const label = m.role === "user" ? "User" : "Assistant";
      const snippet = m.text.length > 300 ? m.text.slice(0, 300) + "…" : m.text;
      return `${label}: ${snippet}`;
    });
    userPrompt = `Recent conversation:\n${contextLines.join("\n")}\n\nNew message to classify:\n${userMessage}`;
  }

  const response = await requestStudyAssistantCompletionDetailed({
    settings,
    systemPrompt: CLASSIFY_SYSTEM_PROMPT,
    userPrompt,
    mode: "text",
  });

  return parseIntentResponse(response.text);
}

export async function generateStudyAssistantChatReply(params: {
  settings: SproutSettings["studyAssistant"];
  input: StudyAssistantChatInput;
}): Promise<StudyAssistantChatResult> {
  const { settings, input } = params;

  const systemPrompt = buildChatSystemPrompt(input);
  const userPrompt = buildChatUserPrompt(input);
  const payloadPreview = `System prompt:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`;

  const imageDataUrls = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean) : [];
  const attachedFileDataUrls = Array.isArray(input.attachedFileDataUrls) ? input.attachedFileDataUrls.filter(Boolean) : [];

  const response = await requestStudyAssistantCompletionDetailed({
    settings,
    systemPrompt,
    userPrompt,
    imageDataUrls: input.includeImages ? imageDataUrls : [],
    attachedFileDataUrls,
    documentAttachmentMode: input.documentAttachmentMode,
    mode: "text",
    conversationId: input.conversationId,
  });
  const rawResponseText = response.text;

  return {
    reply: String(rawResponseText || "").trim(),
    payloadPreview,
    rawResponseText,
    attachmentRoute: response.attachmentRoute,
    conversationId: response.conversationId ?? input.conversationId,
  };
}

export async function generateStudyAssistantChatReplyStreaming(params: {
  settings: SproutSettings["studyAssistant"];
  input: StudyAssistantChatInput;
  onChunk: (token: string) => void;
  signal?: AbortSignal;
}): Promise<StudyAssistantChatResult> {
  const { settings, input, onChunk, signal } = params;

  const systemPrompt = buildChatSystemPrompt(input);
  const userPrompt = buildChatUserPrompt(input);
  const payloadPreview = `System prompt:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`;

  const imageDataUrls = Array.isArray(input.imageDataUrls) ? input.imageDataUrls.filter(Boolean) : [];
  const attachedFileDataUrls = Array.isArray(input.attachedFileDataUrls) ? input.attachedFileDataUrls.filter(Boolean) : [];

  const response = await requestStudyAssistantStreamingCompletion({
    settings,
    systemPrompt,
    userPrompt,
    imageDataUrls: input.includeImages ? imageDataUrls : [],
    attachedFileDataUrls,
    documentAttachmentMode: input.documentAttachmentMode,
    conversationId: input.conversationId,
    onChunk,
    signal,
  });
  const rawResponseText = response.text;

  return {
    reply: String(rawResponseText || "").trim(),
    payloadPreview,
    rawResponseText,
    attachmentRoute: response.attachmentRoute,
    conversationId: response.conversationId ?? input.conversationId,
  };
}

// ── Edit proposal parsing ──

export function parseEditProposal(rawText: string): StudyAssistantEditProposal | null {
  const jsonSource = extractTaggedEditProposal(rawText) || extractFirstJsonObject(rawText);
  if (!jsonSource) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSource);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!summary) return null;

  const rawEdits = Array.isArray(obj.edits) ? obj.edits : [];
  const edits: StudyAssistantEditProposal["edits"] = [];

  for (const item of rawEdits) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    const original = typeof e.original === "string" ? e.original : "";
    const replacement = typeof e.replacement === "string" ? e.replacement : "";
    if (!original) continue;
    edits.push({ original, replacement });
  }

  return { summary, edits };
}
