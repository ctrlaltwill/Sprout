import { requestStudyAssistantCompletion } from "./study-assistant-provider";
import type { SproutSettings } from "../../types/settings";
import type {
  ExamGeneratorConfig,
  ExamSourceNote,
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

  for (const line of lines) {
    if (isNonEducationalLine(line)) continue;
    kept.push(line);
  }

  const filtered = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return filtered;
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

function normaliseQuestion(candidate: unknown, index: number, fallbackPath: string): GeneratedExamQuestion | null {
  const row = toRecord(candidate);
  if (!row) return null;

  const typeRaw = asText(row.type).trim().toLowerCase();
  const type = typeRaw === "saq" ? "saq" : typeRaw === "mcq" ? "mcq" : null;
  if (!type) return null;

  const prompt = asText(row.prompt).trim();
  if (!prompt) return null;

  const sourcePath = asText(row.sourcePath, fallbackPath).trim() || fallbackPath;
  const baseId = asText(row.id, `q${index + 1}`).trim();
  const id = baseId || `q${index + 1}`;

  if (type === "mcq") {
    const options = asStringArray(row.options).slice(0, 6);
    if (options.length < 2) return null;
    const idx = Number(row.correctIndex);
    const correctIndex = Number.isFinite(idx) ? Math.max(0, Math.min(options.length - 1, Math.floor(idx))) : 0;
    const explanation = asText(row.explanation).trim();
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

function normaliseGeneratedQuestions(
  payload: unknown,
  questionCount: number,
  fallbackPath: string,
): GeneratedExamQuestion[] {
  const obj = toRecord(payload);
  if (!obj || !Array.isArray(obj.questions)) return [];

  const out: GeneratedExamQuestion[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < obj.questions.length; i += 1) {
    const q = normaliseQuestion(obj.questions[i], i, fallbackPath);
    if (!q) continue;
    const uniqueId = seen.has(q.id) ? `${q.id}-${i + 1}` : q.id;
    seen.add(uniqueId);
    out.push({ ...q, id: uniqueId });
    if (out.length >= questionCount) break;
  }

  return out;
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

  const userPrompt = JSON.stringify(
    {
      request: {
        difficulty,
        questionType: requestedType,
        questionCount,
      },
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
    return [];
  }

  return normaliseGeneratedQuestions(parsed, questionCount, fallbackPath).map((q, idx) => ({
    ...q,
    id: `${idPrefix}-${idx + 1}`,
  }));
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

  if (preparedNotes.length === 0 && (!attachedFileDataUrls || attachedFileDataUrls.length === 0)) {
    throw new Error("Select at least one note or attach a file to generate an exam.");
  }

  const requestedType = config.questionMode === "mixed" ? "mixed" : config.questionMode;
  const systemPrompt = [
    "You are LearnKit Exam Generator (beta).",
    "Generate exam questions ONLY from provided notes and attached files.",
    "Do not include facts that are not present in the notes or attachments.",
    "Do not ask questions about vault organization, note names, file paths, table of contents, indexes, navigation sections, or system/admin metadata.",
    "Prioritize educational subject matter (concepts, definitions, mechanisms, diagnosis, management, reasoning, examples, or factual learning content).",
    "Return valid JSON only with this schema:",
    "{\"questions\":[{\"id\":\"q1\",\"type\":\"mcq|saq\",\"prompt\":\"...\",\"sourcePath\":\"...\",\"options\":[\"...\"],\"correctIndex\":0,\"explanation\":\"...\",\"markingGuide\":[\"...\"]}]}",
    "Rules:",
    "- MCQ must have 4 options when possible, with one correctIndex.",
    "- SAQ must include concise markingGuide bullets.",
    "- Keep prompts clear and exam-like.",
  ].join("\n");

  const fallbackPath = preparedNotes[0]?.path || "";
  let questions: GeneratedExamQuestion[] = [];

  if (preparedNotes.length <= EXAM_CHUNK_SIZE) {
    questions = await requestExamChunk({
      settings,
      systemPrompt,
      notes: preparedNotes,
      difficulty: config.difficulty,
      requestedType,
      questionCount: config.questionCount,
      fallbackPath,
      idPrefix: "single",
      attachedFileDataUrls,
    });
  } else {
    const chunks = splitIntoChunks(preparedNotes, EXAM_CHUNK_SIZE);
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

  if (questions.length === 0) {
    throw new Error("Exam generator could not create valid questions.");
  }

  return questions;
}

export async function gradeSaqAnswer(params: {
  settings: SproutSettings["studyAssistant"];
  questionPrompt: string;
  markingGuide: string[];
  userAnswer: string;
  difficulty: ExamGeneratorConfig["difficulty"];
}): Promise<SaqGradeResult> {
  const { settings, questionPrompt, markingGuide, userAnswer, difficulty } = params;

  const systemPrompt = [
    "You are LearnKit Exam Marker (beta).",
    "Grade fairly and consistently against the marking guide.",
    "Do not be sycophantic, but do not be overly harsh.",
    "Prioritize conceptual correctness.",
    "Allow minor spelling/grammar issues and brief wording when meaning is correct.",
    "Award partial credit for partially correct answers and concise but accurate responses.",
    "Return JSON only:",
    "{\"scorePercent\":0-100,\"feedback\":\"...\",\"keyPointsMet\":[\"...\"],\"keyPointsMissed\":[\"...\"],\"conceptuallyCorrect\":true|false}",
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      difficulty,
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
  };
}
