/**
 * @file src/platform/integrations/ai/exam-generator-ai.ts
 * @summary Module for exam generator ai.
 *
 * @exports
 *  - generateExamQuestions
 *  - gradeSaqAnswer
 *  - gradeFullTest
 *  - suggestTestName
 */

import { requestStudyAssistantCompletion } from "./study-assistant-provider";
import type { SproutSettings } from "../../types/settings";
import type {
  ExamGeneratorConfig,
  ExamSourceNote,
  FullTestGradeResult,
  GeneratedExamQuestion,
  SaqGradeResult,
} from "../../../views/exam-generator/exam-generator-types";

const MAX_NOTE_CHARS = 12000;
const MAX_SOURCE_NOTES = 30;
const MAX_TOTAL_CHARS = 90000;
const EXAM_CHUNK_SIZE = 5;

const NON_EDUCATIONAL_PATTERNS: RegExp[] = [
  /^\s*#+\s*(table of contents|toc|contents|index|navigation)\b/i,
  /^\s*(table of contents|toc|contents|index|navigation)\s*:?\s*$/i,
  /^\s*#+\s*(vault|folder|folders|structure|organization|organise|organize|system|attachments|templates)\b/i,
  /^\s*(vault|folder|folders|structure|organization|organise|organize|system|attachments|templates)\s*:?\s*$/i,
];

const EDUCATIONAL_KEYWORDS = [
  "diagnosis",
  "management",
  "treatment",
  "pathophysiology",
  "mechanism",
  "symptom",
  "sign",
  "cause",
  "risk",
  "clinical",
  "definition",
  "criteria",
  "example",
  "indication",
  "contraindication",
  "interpret",
  "compare",
  "evaluate",
];

function looksLikePathOnlyLine(line: string): boolean {
  const value = String(line || "").trim();
  if (!value) return false;
  if (/^(?:[-*+]|\d+\.)\s+/.test(value)) {
    const unbulleted = value.replace(/^(?:[-*+]|\d+\.)\s+/, "");
    if (/^[\w .&()'/-]+(?:\.md)?$/i.test(unbulleted) && (unbulleted.includes("/") || /\.md$/i.test(unbulleted))) {
      return true;
    }
  }
  if (/^\[\[[^\]]+\]\]$/.test(value)) return true;
  if (/^[\w .&()'/-]+(?:\.md)?$/i.test(value) && (value.includes("/") || /\.md$/i.test(value))) return true;
  return false;
}

function isNonEducationalLine(line: string): boolean {
  const value = String(line || "").trim();
  if (!value) return false;
  if (NON_EDUCATIONAL_PATTERNS.some((re) => re.test(value))) return true;
  if (looksLikePathOnlyLine(value)) return true;
  return false;
}

function filterEducationalContent(raw: string): string {
  const lines = String(raw || "").split(/\r?\n/);
  const kept: string[] = [];
  let inTocBlock = false;

  for (const line of lines) {
    const trimmed = String(line || "").trim();
    const isHeading = /^\s*#{1,6}\s+/.test(line);
    const startsTocBlock = /^\s*#{1,6}\s*(table of contents|toc|contents|index|navigation)\b/i.test(line)
      || /^\s*(table of contents|toc|contents|index|navigation)\s*:?\s*$/i.test(trimmed);

    if (startsTocBlock) {
      inTocBlock = true;
      continue;
    }

    // Exit a TOC/navigation block when we reach a non-TOC heading.
    if (inTocBlock && isHeading && !startsTocBlock) {
      inTocBlock = false;
    }

    if (inTocBlock) {
      if (trimmed.length === 0) continue;
      if (looksLikePathOnlyLine(trimmed)) continue;
      if (/^(?:[-*+]\s+|\d+\.\s+)/.test(trimmed)) continue;
      if (trimmed.split(/\s+/).length <= 6 && !/[.!?]/.test(trimmed)) continue;
    }

    if (isNonEducationalLine(line)) continue;
    kept.push(line);
  }

  const filtered = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return filtered;
}

function educationalSignalScore(raw: string): number {
  const text = String(raw || "");
  if (!text.trim()) return 0;

  const lines = text.split(/\r?\n/);
  let sentenceLikeLines = 0;
  let bullets = 0;
  let shortTitleLike = 0;
  let keywordHits = 0;

  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    if (/^(?:[-*+]\s+|\d+\.\s+)/.test(value)) bullets += 1;
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length >= 8 && /[.!?]|:/.test(value)) sentenceLikeLines += 1;
    if (words.length <= 5 && !/[.!?]/.test(value)) shortTitleLike += 1;

    const low = value.toLowerCase();
    for (const kw of EDUCATIONAL_KEYWORDS) {
      if (low.includes(kw)) keywordHits += 1;
    }
  }

  return sentenceLikeLines * 4 + keywordHits * 2 - shortTitleLike - Math.floor(bullets * 0.5);
}

function isEducationallyUseful(raw: string): boolean {
  return educationalSignalScore(raw) >= 4;
}

function clip(text: string, maxChars = MAX_NOTE_CHARS): string {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[Truncated for exam generation]`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractJsonBlock(text: string): string {
  const input = String(text || "").trim();
  const fenced = input.match(/```json\s*([\s\S]*?)```/i) || input.match(/```\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = input.indexOf("{");
  const lastBrace = input.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return input.slice(firstBrace, lastBrace + 1);
  return input;
}

function parseJson<T>(raw: string): T {
  const jsonText = extractJsonBlock(raw);
  return JSON.parse(jsonText) as T;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return fallback;
}

type McqSelectionMode = "single" | "multiple";

const EXPLICIT_MULTI_SELECT_PROMPT_PATTERNS: RegExp[] = [
  /\bselect\s+all\s+that\s+apply\b/i,
  /\ball\s+that\s+apply\b/i,
  /\bidentify\s+all\b/i,
  /\bwhich\s+of\s+the\s+following\s+are\b/i,
  /\bwhich\s+of\s+these\s+are\b/i,
  /\bwhich\s+statements?\s+are\b/i,
  /\bwhich\s+options?\s+are\b/i,
  /\bwhich\s+(?:two|three|four|five|six|\d+)\b/i,
  /\b(?:choose|select|pick|identify)\s+(?:the\s+)?(?:two|three|four|five|six|\d+)\b/i,
];

const EXPLICIT_MULTI_SELECT_INSTRUCTION_PATTERNS: RegExp[] = [
  /\bselect\s+all\s+that\s+apply\b/i,
  /\ball\s+that\s+apply\b/i,
  /\b(?:choose|select|pick|identify)\s+(?:the\s+)?(?:two|three|four|five|six|\d+)\b/i,
];

function normaliseMcqSelectionMode(value: unknown): McqSelectionMode | null {
  const mode = asText(value).trim().toLowerCase();
  if (!mode) return null;
  if (["single", "single-select", "single select", "single_best", "single-best", "one"].includes(mode)) return "single";
  if (["multiple", "multi", "multi-select", "multi select", "multiple-select", "multiple select", "msq", "all-that-apply", "all that apply"].includes(mode)) {
    return "multiple";
  }
  return null;
}

function getMcqSelectionMode(row: Record<string, unknown>): McqSelectionMode | null {
  const candidateKeys = ["selectionMode", "answerMode", "optionMode", "variant", "mcqMode"];
  for (const key of candidateKeys) {
    const mode = normaliseMcqSelectionMode(row[key]);
    if (mode) return mode;
  }
  return null;
}

function promptSignalsMultiSelect(prompt: string): boolean {
  return EXPLICIT_MULTI_SELECT_PROMPT_PATTERNS.some((re) => re.test(prompt));
}

function promptHasExplicitMultiSelectInstruction(prompt: string): boolean {
  return EXPLICIT_MULTI_SELECT_INSTRUCTION_PATTERNS.some((re) => re.test(prompt));
}

function ensureExplicitMultiSelectPrompt(prompt: string): string {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) return trimmed;
  if (promptHasExplicitMultiSelectInstruction(trimmed)) return trimmed;
  return `Select all that apply: ${trimmed}`;
}

function normaliseQuestion(
  candidate: unknown,
  index: number,
  fallbackPath: string,
  issues?: string[],
): GeneratedExamQuestion | null {
  const fail = (reason: string): null => {
    issues?.push(`Question ${index + 1}: ${reason}`);
    return null;
  };

  const row = toRecord(candidate);
  if (!row) return fail("item was not an object.");

  const typeRaw = asText(row.type).trim().toLowerCase();
  const type = typeRaw === "saq" ? "saq" : typeRaw === "mcq" || typeRaw === "msq" ? "mcq" : null;
  if (!type) return fail(`unsupported question type \"${typeRaw || "(empty)"}\".`);

  const prompt = asText(row.prompt).trim();
  if (!prompt) return fail("prompt was empty.");

  const sourcePath = asText(row.sourcePath, fallbackPath).trim() || fallbackPath;
  const baseId = asText(row.id, `q${index + 1}`).trim();
  const id = baseId || `q${index + 1}`;

  if (type === "mcq") {
    const options = asStringArray(row.options).slice(0, 6);
    if (options.length < 2) return fail("MCQ requires at least 2 options.");
    const explanation = asText(row.explanation).trim();
    const selectionMode = typeRaw === "msq" ? "multiple" : getMcqSelectionMode(row);
    const promptRequiresMultiSelect = promptSignalsMultiSelect(prompt);

    const rawIndices = Array.isArray(row.correctIndices) ? row.correctIndices : null;
    const correctIndices = rawIndices
      ? [...new Set(rawIndices
        .map((v: unknown) => Number(v))
        .filter((v: number) => Number.isFinite(v) && v >= 0 && v < options.length)
        .map((v: number) => Math.floor(v)))]
      : [];

    if (correctIndices.length > 1) {
      if (correctIndices.length >= options.length) {
        return fail("multi-select marked every option correct; include at least one wrong distractor.");
      }
      return {
        id,
        type,
        prompt: ensureExplicitMultiSelectPrompt(prompt),
        sourcePath,
        options,
        correctIndices,
        explanation,
      };
    }

    if (selectionMode === "multiple" || promptRequiresMultiSelect) {
      return fail("multi-select stem must use type \"msq\" or selectionMode \"multiple\" with 2+ correctIndices.");
    }

    if (correctIndices.length === 1) {
      return { id, type, prompt, sourcePath, options, correctIndex: correctIndices[0], explanation };
    }

    const idx = Number(row.correctIndex);
    if (!Number.isFinite(idx)) return fail("single-select MCQ requires correctIndex.");
    const correctIndex = Math.max(0, Math.min(options.length - 1, Math.floor(idx)));
    return { id, type, prompt, sourcePath, options, correctIndex, explanation };
  }

  const markingGuide = asStringArray(row.markingGuide).slice(0, 8);
  return {
    id,
    type,
    prompt,
    sourcePath,
    markingGuide,
  };
}

function allowedQuestionTypesForRequest(requestedType: "mcq" | "saq" | "mixed"): Set<"mcq" | "saq"> {
  if (requestedType === "mixed") return new Set(["mcq", "saq"]);
  return new Set([requestedType]);
}

function normaliseGeneratedQuestions(
  payload: unknown,
  questionCount: number,
  fallbackPath: string,
  requestedType: "mcq" | "saq" | "mixed",
): { questions: GeneratedExamQuestion[]; issues: string[] } {
  const obj = toRecord(payload);
  if (!obj || !Array.isArray(obj.questions)) return { questions: [], issues: ["Response did not contain a questions array."] };

  const out: GeneratedExamQuestion[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  const allowedTypes = allowedQuestionTypesForRequest(requestedType);

  for (let i = 0; i < obj.questions.length; i += 1) {
    const q = normaliseQuestion(obj.questions[i], i, fallbackPath, issues);
    if (!q) continue;
    if (!allowedTypes.has(q.type)) {
      issues.push(`Question ${i + 1}: type \"${q.type}\" is not allowed for requested mode \"${requestedType}\".`);
      continue;
    }
    const uniqueId = seen.has(q.id) ? `${q.id}-${i + 1}` : q.id;
    seen.add(uniqueId);
    out.push({ ...q, id: uniqueId });
    if (out.length >= questionCount) break;
  }

  return { questions: out, issues };
}

function splitIntoChunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function allocateQuestionCounts(total: number, chunks: number): number[] {
  if (chunks <= 0) return [];
  if (total <= 0) return Array.from({ length: chunks }, () => 1);
  const base = Math.floor(total / chunks);
  let rem = total % chunks;
  const counts = Array.from({ length: chunks }, () => base);
  for (let i = 0; i < counts.length && rem > 0; i += 1) {
    counts[i] += 1;
    rem -= 1;
  }
  return counts.map((n) => Math.max(1, n));
}

function dedupeQuestions(
  questions: GeneratedExamQuestion[],
  questionCount: number,
): GeneratedExamQuestion[] {
  const seenPrompts = new Set<string>();
  const out: GeneratedExamQuestion[] = [];
  for (const q of questions) {
    const key = q.prompt.trim().toLowerCase();
    if (seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    out.push(q);
    if (out.length >= questionCount) break;
  }
  return out;
}

async function requestExamChunk(params: {
  settings: SproutSettings["studyAssistant"];
  systemPrompt: string;
  notes: Array<{ path: string; title: string; content: string }>;
  difficulty: ExamGeneratorConfig["difficulty"];
  requestedType: "mcq" | "saq" | "mixed";
  questionCount: number;
  fallbackPath: string;
  idPrefix: string;
  attachedFileDataUrls?: string[];
}): Promise<GeneratedExamQuestion[]> {
  const {
    settings,
    systemPrompt,
    notes,
    difficulty,
    requestedType,
    questionCount,
    fallbackPath,
    idPrefix,
    attachedFileDataUrls,
  } = params;

  const maxAttempts = 2;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const userPrompt = JSON.stringify(
      {
        request: {
          difficulty,
          questionType: requestedType,
          questionCount,
        },
        strictRequirements: {
          exactQuestionCount: questionCount,
          allowedQuestionTypes:
            requestedType === "mixed"
              ? ["mcq", "msq", "saq"]
              : requestedType === "mcq"
                ? ["mcq", "msq"]
                : [requestedType],
          mcqContract: {
            singleSelect: {
              type: "mcq",
              requiredField: "correctIndex",
              exactlyOneCorrectOption: true,
            },
            multiSelect: {
              type: "msq",
              requiredField: "correctIndices",
              minCorrectOptions: 2,
              requireAtLeastOneWrongOption: true,
              promptMustClearlyIndicateMultipleAnswers: true,
            },
          },
          rejectMismatchedTypeOutput: true,
          rejectPartialOutput: true,
        },
        ...(attempt > 0
          ? {
            retry: {
              attempt: attempt + 1,
              reason: lastError || "Previous output was invalid.",
              instruction: "Regenerate from scratch and return fully valid JSON that satisfies all strictRequirements.",
            },
          }
          : {}),
        notes,
      },
      null,
      2,
    );

    const raw = await requestStudyAssistantCompletion({
      settings,
      systemPrompt,
      userPrompt,
      attachedFileDataUrls,
      mode: "json",
    });

    let parsed: unknown;
    try {
      parsed = parseJson<unknown>(raw);
    } catch {
      lastError = "Invalid JSON response.";
      continue;
    }

    const { questions: normalized, issues } = normaliseGeneratedQuestions(parsed, questionCount, fallbackPath, requestedType);
    if (normalized.length >= questionCount) {
      return normalized.map((q, idx) => ({
        ...q,
        id: `${idPrefix}-${idx + 1}`,
      }));
    }

    lastError = issues.length > 0
      ? issues.slice(0, 3).join(" ")
      : `Returned ${normalized.length}/${questionCount} valid questions after filtering.`;
  }

  return [];
}

export async function generateExamQuestions(params: {
  settings: SproutSettings["studyAssistant"];
  notes: ExamSourceNote[];
  config: ExamGeneratorConfig;
  attachedFileDataUrls?: string[];
}): Promise<GeneratedExamQuestion[]> {
  const { settings, notes, config, attachedFileDataUrls } = params;
  const candidates = notes.slice(0, MAX_SOURCE_NOTES).map((note) => {
    const educationalContent = filterEducationalContent(note.content);
    return {
      path: note.path,
      title: note.title,
      content: clip(educationalContent || note.content),
    };
  });

  let remainingChars = MAX_TOTAL_CHARS;
  const preparedNotes: Array<{ path: string; title: string; content: string }> = [];
  for (const note of candidates) {
    if (remainingChars <= 0) break;
    const chunk = String(note.content || "").slice(0, remainingChars).trim();
    if (!chunk) continue;
    preparedNotes.push({
      path: note.path,
      title: note.title,
      content: chunk,
    });
    remainingChars -= chunk.length;
  }

  const educationalNotes = preparedNotes.filter((note) => isEducationallyUseful(note.content));
  const notesForGeneration = educationalNotes.length > 0 ? educationalNotes : preparedNotes;

  if (notesForGeneration.length === 0 && (!attachedFileDataUrls || attachedFileDataUrls.length === 0)) {
    throw new Error("Select at least one note or attach a file to generate an exam.");
  }

  const requestedType = config.questionMode === "mixed" ? "mixed" : config.questionMode;
  const appliedModeRules = config.appliedScenarios
    ? [
      "Applied scenario questions mode is ON.",
      "Generate applied problem-solving questions from the note content, not recall-only prompts.",
      "All questions in this mode must be scenario-based.",
      "Each prompt must include concrete context (for example a case, situation, setup, or data conditions) and ask the learner to apply knowledge.",
      "Do NOT output pure theory/definition/identify-style questions in this mode.",
      "Prefer tasks that require interpretation, decision-making, calculation, prioritization, or troubleshooting from context.",
      "Do not include LaTeX notation or Markdown tables in prompts, options, explanations, or marking guides.",
      "For quantitative tasks, include enough data for the learner to calculate an answer.",
      "For SAQ, make markingGuide specific and checkable against the applied scenario (final conclusion plus key reasoning checks).",
      "For MCQ, ensure distractors are plausible application errors rather than random facts.",
      "Use plain text formatting only for numeric expressions (no LaTeX delimiters).",
    ]
    : [
      "Applied scenario questions mode is OFF.",
      "Prefer straightforward conceptual exam questions unless source content is inherently quantitative.",
    ];
  const systemPrompt = [
    "You are LearnKit Exam Generator (beta).",
    "Generate exam questions primarily from provided notes and attached files from the selected scope.",
    "Prioritize the educational content that appears in the selected scope over generic structure, metadata, or site map content.",
    "If tiny amounts of outside knowledge are needed to clarify wording, use only directly relevant background and keep it minimal.",
    "Do not ask the user any follow-up questions.",
    "Do not output planning steps, commentary, or analysis.",
    "Do not ask questions about vault organization, note names, file paths, table of contents, indexes, navigation sections, or system/admin metadata.",
    "Never generate prompts that test folder structure, file structure, TOC headings, document indexing, or note-management workflow.",
    "Prioritize educational subject matter (concepts, definitions, mechanisms, diagnosis, management, reasoning, examples, or factual learning content).",
    "Every question must test domain knowledge from educational content, not document structure.",
    ...appliedModeRules,
    ...(config.includeFlashcards
      ? [
        "Include flashcards mode is ON.",
        "Questions may reuse or adapt the learner's existing flashcard content from the source notes.",
        "Flashcards can be repeated as MCQ (turn the Q/A pair into a multiple-choice question with plausible distractors) or adapted into SAQ format.",
        "Treat flashcard content as high-priority study material worth testing.",
      ]
      : []),
    ...(config.customInstructions?.trim()
      ? [
        "The user has provided additional custom instructions for this exam:",
        config.customInstructions.trim(),
      ]
      : []),
    "Return valid JSON only with this schema:",
    "{\"questions\":[{\"id\":\"q1\",\"type\":\"mcq|msq|saq\",\"prompt\":\"...\",\"sourcePath\":\"...\",\"options\":[\"...\"],\"correctIndex\":0,\"correctIndices\":[0,2],\"selectionMode\":\"single|multiple\",\"explanation\":\"...\",\"markingGuide\":[\"...\"]}]}",
    "Rules:",
    `- Return exactly ${config.questionCount} questions (no more, no fewer).`,
    `- Requested question mode is \"${requestedType}\". ${requestedType === "mixed" ? "Mixed mode: include only mcq, msq, or saq types." : requestedType === "mcq" ? "MCQ mode may include single-select \"mcq\" items and multi-select \"msq\" items only." : `Every question MUST have type \"${requestedType}\".`}`,
    "- MCQ must have 4 options when possible.",
    '- Use type "mcq" only for true single-best-answer questions with exactly one defensibly correct option and one correctIndex.',
    '- Use type "msq" for any question with more than one correct answer. "msq" items must include correctIndices with 2+ correct option indices and at least one wrong distractor.',
    '- If a stem naturally implies multiple answers, such as "Which of the following are...", "Which statements are...", "Identify all...", or "Select two...", it must be an "msq" item, not an "mcq" item.',
    '- Never force a naturally multi-answer stem into single-select just to fit MCQ format. Rewrite it as "msq" or rewrite the stem so exactly one option is correct.',
    '- For multi-select questions, make the multiple-answer instruction explicit. Prefix the prompt with "Select all that apply:" unless the stem already clearly says how many answers to choose.',
    '- Never return a question where every option is correct. Multi-select questions must still include at least one wrong distractor.',
    "- SAQ must include concise markingGuide bullets.",
    "- Keep prompts clear and exam-like.",
    "- Any question with a mismatched type is invalid and must not be returned.",
  ].join("\n");

  const fallbackPath = notesForGeneration[0]?.path || "";
  let questions: GeneratedExamQuestion[] = [];

  if (notesForGeneration.length <= EXAM_CHUNK_SIZE) {
    questions = await requestExamChunk({
      settings,
      systemPrompt,
      notes: notesForGeneration,
      difficulty: config.difficulty,
      requestedType,
      questionCount: config.questionCount,
      fallbackPath,
      idPrefix: "single",
      attachedFileDataUrls,
    });
  } else {
    const chunks = splitIntoChunks(notesForGeneration, EXAM_CHUNK_SIZE);
    const counts = allocateQuestionCounts(config.questionCount, chunks.length);
    const allChunkQuestions: GeneratedExamQuestion[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunkNotes = chunks[i] || [];
      if (!chunkNotes.length) continue;
      const chunkQuestions = await requestExamChunk({
        settings,
        systemPrompt,
        notes: chunkNotes,
        difficulty: config.difficulty,
        requestedType,
        questionCount: counts[i] || 1,
        fallbackPath: chunkNotes[0]?.path || fallbackPath,
        idPrefix: `chunk${i + 1}`,
        attachedFileDataUrls,
      });
      allChunkQuestions.push(...chunkQuestions);
    }

    questions = dedupeQuestions(allChunkQuestions, config.questionCount);
  }

  if (questions.length < config.questionCount) {
    const remaining = config.questionCount - questions.length;
    const topUp = await requestExamChunk({
      settings,
      systemPrompt,
      notes: notesForGeneration,
      difficulty: config.difficulty,
      requestedType,
      questionCount: remaining,
      fallbackPath,
      idPrefix: "topup",
      attachedFileDataUrls,
    });
    questions = dedupeQuestions([...questions, ...topUp], config.questionCount);
  }

  if (questions.length < config.questionCount) {
    throw new Error(`Exam generator could not create the requested ${config.questionCount} valid ${requestedType.toUpperCase()} questions.`);
  }

  return questions;
}

export async function gradeSaqAnswer(params: {
  settings: SproutSettings["studyAssistant"];
  questionPrompt: string;
  markingGuide: string[];
  userAnswer: string;
  difficulty: ExamGeneratorConfig["difficulty"];
  appliedScenarios?: boolean;
}): Promise<SaqGradeResult> {
  const { settings, questionPrompt, markingGuide, userAnswer, difficulty, appliedScenarios } = params;

  const systemPrompt = [
    "You are LearnKit Exam Marker (beta).",
    "Grade fairly and consistently against the marking guide.",
    "Do not be sycophantic, but do not be overly harsh.",
    "Prioritize conceptual correctness.",
    "Allow minor spelling/grammar issues and brief wording when meaning is correct.",
    "Award partial credit for partially correct answers and concise but accurate responses.",
    "Do not expect or require Markdown tables or LaTeX in prompt or answer.",
    "When a prompt includes quantitative scenario data, verify whether the final conclusion/calculation is correct from that data.",
    "Accept mathematically equivalent expressions and equivalent units when contextually appropriate.",
    "Accept valid alternative answers that are factually correct even if not in the marking guide. Note them as accepted alternatives in keyPointsMet.",
    "Anchor scorePercent to the ratio of key points met vs total key points. For example, 3 of 4 met ≈ 75%. Adjust up to ±15 pp for quality of explanation, but never deviate more than that from the ratio.",
    "Classify each marking-guide point as met (addressed correctly), missed (not addressed), or wrong (addressed but factually incorrect). Populate keyPointsMet, keyPointsMissed, and keyPointsWrong accordingly.",
    "Do not penalise for correct information the student added beyond the marking guide; simply ignore it.",
    "Return JSON only:",
    "{\"scorePercent\":0-100,\"feedback\":\"...\",\"keyPointsMet\":[\"...\"],\"keyPointsMissed\":[\"...\"],\"keyPointsWrong\":[\"...\"],\"conceptuallyCorrect\":true|false}",
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      difficulty,
      appliedScenarios: Boolean(appliedScenarios),
      questionPrompt,
      markingGuide,
      answer: String(userAnswer || "").trim(),
    },
    null,
    2,
  );

  const raw = await requestStudyAssistantCompletion({
    settings,
    systemPrompt,
    userPrompt,
    mode: "json",
  });

  let parsed: unknown;
  try {
    parsed = parseJson<unknown>(raw);
  } catch {
    throw new Error("SAQ marker returned invalid JSON.");
  }

  const obj = toRecord(parsed);
  if (!obj) throw new Error("SAQ marker returned invalid result.");

  const rawScore = Number(obj.scorePercent);
  let scorePercent = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  const conceptuallyCorrect = Boolean(obj.conceptuallyCorrect);
  const keyPointsMet = asStringArray(obj.keyPointsMet).slice(0, 8);
  const keyPointsMissed = asStringArray(obj.keyPointsMissed).slice(0, 8);
  const keyPointsWrong = asStringArray(obj.keyPointsWrong).slice(0, 8);

  // Proportional floor: anchor score to keyPointsMet ratio so the model cannot
  // deviate too far from the objective count.  E.g. 3/4 met → base 75.
  const totalPoints = keyPointsMet.length + keyPointsMissed.length + keyPointsWrong.length;
  if (totalPoints > 0) {
    const proportionalBase = Math.round((keyPointsMet.length / totalPoints) * 100);
    if (scorePercent < proportionalBase - 15) {
      scorePercent = proportionalBase - 15;
    }
  }

  // Fairness guardrail: conceptually correct answers should not collapse to near-zero
  // due to brevity or minor language errors.
  if (conceptuallyCorrect && scorePercent < 50) {
    scorePercent = 50;
  }
  if (!conceptuallyCorrect && keyPointsMet.length > 0 && scorePercent < 35) {
    scorePercent = 35;
  }
  const feedback = asText(obj.feedback).trim() || "No feedback returned.";

  return {
    scorePercent,
    feedback,
    keyPointsMet,
    keyPointsMissed,
    ...(keyPointsWrong.length > 0 ? { keyPointsWrong } : {}),
  };
}

export async function gradeFullTest(params: {
  settings: SproutSettings["studyAssistant"];
  questions: GeneratedExamQuestion[];
  userAnswerText: string;
  difficulty: ExamGeneratorConfig["difficulty"];
}): Promise<FullTestGradeResult> {
  const { settings, questions, userAnswerText, difficulty } = params;

  const questionsForPrompt = questions.map((q, i) => {
    const entry: Record<string, unknown> = {
      questionNumber: i + 1,
      type: q.type,
      prompt: q.prompt,
    };
    if (q.type === "mcq" && q.options) {
      entry.options = q.options;
      if (q.correctIndices) {
        entry.correctIndices = q.correctIndices;
      } else if (q.correctIndex != null) {
        entry.correctIndex = q.correctIndex;
      }
    }
    if (q.type === "saq" && q.markingGuide) {
      entry.markingGuide = q.markingGuide;
    }
    if (q.explanation) entry.explanation = q.explanation;
    return entry;
  });

  const systemPrompt = [
    "You are LearnKit Exam Marker.",
    `Difficulty level: ${difficulty}.`,
    "The student was given a test and replied with freeform answers.",
    "Grade each question. For MCQs, check whether the student selected the correct option(s). For SAQs, evaluate against the marking guide and award partial credit where appropriate.",
    "The student may use numbering, bullet points, or prose. Match each part of their response to the corresponding question by number or context.",
    "If a question's answer is missing or unidentifiable, score it 0.",
    "Return JSON only:",
    '{"results":[{"questionNumber":1,"correct":true,"scorePercent":0-100,"feedback":"..."}],"overallScorePercent":0-100}',
    "overallScorePercent should be the average of all question scorePercent values.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    questions: questionsForPrompt,
    studentResponse: String(userAnswerText || "").trim(),
  }, null, 2);

  const raw = await requestStudyAssistantCompletion({
    settings,
    systemPrompt,
    userPrompt,
    mode: "json",
  });

  let parsed: unknown;
  try {
    parsed = parseJson<unknown>(raw);
  } catch {
    throw new Error("Test grader returned invalid JSON.");
  }

  const obj = toRecord(parsed);
  if (!obj) throw new Error("Test grader returned invalid result.");

  const rawResults = Array.isArray(obj.results) ? obj.results : [];
  const results = rawResults.map((r) => {
    const rec = toRecord(r);
    if (!rec) return { questionNumber: 0, correct: false, scorePercent: 0, feedback: "No result." };
    const rawScore = Number(rec.scorePercent);
    const feedback = typeof rec.feedback === "string"
      ? rec.feedback.trim()
      : typeof rec.feedback === "number" || typeof rec.feedback === "boolean"
        ? String(rec.feedback).trim()
        : "";
    return {
      questionNumber: Number(rec.questionNumber) || 0,
      correct: Boolean(rec.correct),
      scorePercent: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0,
      feedback: feedback || "No feedback.",
    };
  });

  const rawOverall = Number(obj.overallScorePercent);
  const overallScorePercent = Number.isFinite(rawOverall)
    ? Math.max(0, Math.min(100, rawOverall))
    : results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.scorePercent, 0) / results.length)
      : 0;

  return { overallScorePercent, results };
}

export async function suggestTestName(params: {
  settings: SproutSettings["studyAssistant"];
  questionPrompts: string[];
  difficulty: ExamGeneratorConfig["difficulty"];
  questionMode: ExamGeneratorConfig["questionMode"];
}): Promise<string> {
  const { settings, questionPrompts, difficulty, questionMode } = params;

  const systemPrompt =
    "Suggest a short (2-5 word) descriptive test name based on the topics covered by the questions below. " +
    "Return only the name. No quotes, no explanation, no punctuation at the end.";

  const userPrompt = JSON.stringify({ difficulty, questionMode, questions: questionPrompts.slice(0, 15) });

  const raw = await requestStudyAssistantCompletion({ settings, systemPrompt, userPrompt });

  let name = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (name.length > 60) name = name.slice(0, 60).trimEnd();
  // Sentence case
  if (name.length > 0) name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  if (!name.toLowerCase().includes("test")) name += " test";
  return name;
}
