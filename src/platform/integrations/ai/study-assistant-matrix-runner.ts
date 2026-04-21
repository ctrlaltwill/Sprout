/**
 * @file src/platform/integrations/ai/study-assistant-matrix-runner.ts
 * @summary Console-friendly Study Assistant compatibility runner for model,
 * note, linked-note, and attachment scenario matrices.
 *
 * @exports
 *  - createStudyAssistantMatrixConsoleApi
 *  - runStudyAssistantMatrix
 */

import { TFile } from "obsidian";
import type { LearnKitPluginBase } from "../../plugin/plugin-base";
import { formatInsertBlock } from "../../../views/study-assistant/popup/assistant-popup-text";
import { buildSuggestionMarkdownLines } from "../../../views/study-assistant/popup/assistant-popup-suggestion-rows";
import { validateGeneratedCardBlock } from "../../../views/study-assistant/popup/assistant-popup-validation";
import { mentionsFrontmatter, validateEditProposal } from "../../../views/study-assistant/chat/edit-helpers";
import type { SproutSettings } from "../../types/settings";
import {
  buildStudyAssistantNoteContext,
  resolveStudyAssistantAttachmentRefs,
  type StudyAssistantContextMode,
} from "./study-assistant-note-context";
import {
  generateStudyAssistantChatReply,
  generateStudyAssistantSuggestions,
  parseEditProposal,
} from "./study-assistant-generator";
import {
  providerApiKey,
  providerSupportsNativeDocumentAttachment,
} from "./study-assistant-provider";
import type {
  StudyAssistantAttachmentRoute,
  StudyAssistantCardType,
  StudyAssistantDocumentAttachmentMode,
  StudyAssistantProvider,
} from "./study-assistant-types";

type RunnerHost = Pick<LearnKitPluginBase, "app" | "settings" | "_tx">;

export type StudyAssistantMatrixFeature = "chat" | "review" | "edit" | "flashcards";

export type StudyAssistantMatrixScenario =
  | "core-note"
  | "linked-note-context"
  | "current-note-assets"
  | "explicit-docx"
  | "docx-fallback"
  | "explicit-pptx"
  | "pptx-fallback"
  | "explicit-pdf"
  | "pdf-fallback"
  | "explicit-image"
  | "note-plus-pdf-grounding";

export type StudyAssistantMatrixAttachmentKind = "docx" | "pptx" | "pdf" | "image";

export type StudyAssistantMatrixModelSpec = {
  provider: StudyAssistantProvider;
  model: string;
  label?: string;
};

export type StudyAssistantMatrixRunnerOptions = {
  notePath?: string;
  models?: StudyAssistantMatrixModelSpec[];
  scenarios?: StudyAssistantMatrixScenario[];
  explicitAttachmentRefs?: Partial<Record<StudyAssistantMatrixAttachmentKind, string>>;
  printToConsole?: boolean;
};

export type StudyAssistantMatrixStatus = "pass" | "fail" | "skipped";

export type StudyAssistantMatrixRowResult = {
  provider: StudyAssistantProvider;
  model: string;
  label: string;
  notePath: string;
  scenario: StudyAssistantMatrixScenario;
  scenarioLabel: string;
  feature: StudyAssistantMatrixFeature;
  status: StudyAssistantMatrixStatus;
  detail: string;
  attachmentRoute: StudyAssistantAttachmentRoute;
  attachmentRouting: string;
  linkedNotesIncluded: number;
  rawResponseText: string;
  payloadPreview: string;
  attachmentRefs: string[];
};

export type StudyAssistantMatrixRunResult = {
  startedAt: string;
  finishedAt: string;
  notePath: string;
  rows: StudyAssistantMatrixRowResult[];
  markdownSummary: string;
};

export type StudyAssistantMatrixConsoleApi = {
  lastResult: StudyAssistantMatrixRunResult | null;
  getDefaultOptions: () => StudyAssistantMatrixRunnerOptions;
  runMatrix: (options?: StudyAssistantMatrixRunnerOptions) => Promise<StudyAssistantMatrixRunResult>;
};

type ChatValidationResult = {
  ok: boolean;
  detail: string;
};

type EvidenceRule = {
  label: string;
  patterns: RegExp[];
};

type ScenarioPlan = {
  scenario: StudyAssistantMatrixScenario;
  scenarioLabel: string;
  feature: StudyAssistantMatrixFeature;
  mode: StudyAssistantContextMode;
  userMessage: string;
  attachmentKinds?: StudyAssistantMatrixAttachmentKind[];
  documentAttachmentMode?: StudyAssistantDocumentAttachmentMode;
};

const DEFAULT_NOTE_PATH = "test.md";

const DEFAULT_NOTE_PATH_CANDIDATES = [
  DEFAULT_NOTE_PATH,
  `Test/${DEFAULT_NOTE_PATH}`,
];

const DEFAULT_ATTACHMENT_REFS: Record<StudyAssistantMatrixAttachmentKind, string> = {
  docx: "test.docx",
  pptx: "test.pptx",
  pdf: "test.pdf",
  image: "test.jpg",
};

const DEFAULT_FLASHCARD_TYPES: StudyAssistantCardType[] = ["basic", "cloze", "mcq", "oq"];

const DEFAULT_SCENARIOS: StudyAssistantMatrixScenario[] = [
  "core-note",
  "linked-note-context",
  "explicit-docx",
  "docx-fallback",
  "explicit-pptx",
  "pptx-fallback",
  "explicit-pdf",
  "pdf-fallback",
  "explicit-image",
];

const LINKED_NOTE_EVIDENCE: EvidenceRule[] = [
  {
    label: "desirable difficulty",
    patterns: [/\bdesirable difficulty\b/i, /manageable challenge/i],
  },
  {
    label: "feedback",
    patterns: [/\bfeedback\b/i, /misconception/i],
  },
  {
    label: "metacognition",
    patterns: [/\bmetacognition\b/i, /feels familiar/i, /truly know/i],
  },
  {
    label: "core facts vs commentary",
    patterns: [/core facts/i, /commentary/i],
  },
];

const DOCX_EVIDENCE: EvidenceRule[] = [
  {
    label: "DOCX title",
    patterns: [/learnkit docx attachment test/i],
  },
  {
    label: "mitochondria and ATP",
    patterns: [/mitochondria/i, /\batp\b/i, /cellular respiration/i],
  },
  {
    label: "activation energy",
    patterns: [/activation energy/i, /enzym(?:e|es)/i],
  },
  {
    label: "homeostasis",
    patterns: [/homeostasis/i, /stable internal conditions/i],
  },
];

const PPTX_EVIDENCE: EvidenceRule[] = [
  {
    label: "Wellington",
    patterns: [/\bwellington\b/i, /capital of nz/i, /capital of new zealand/i],
  },
  {
    label: "Canberra",
    patterns: [/\bcanberra\b/i, /capital of au/i, /capital of australia/i],
  },
];

const PDF_EVIDENCE: EvidenceRule[] = [
  {
    label: "PDF title",
    patterns: [/learnkit pdf attachment test/i],
  },
  {
    label: "water boils at 100 C",
    patterns: [/water boils/i, /\b100\s*c\b/i, /sea level/i],
  },
  {
    label: "sodium is Na",
    patterns: [/\bsodium\b/i, /\bna\b/i, /chemical symbol/i],
  },
  {
    label: "active recall",
    patterns: [/active recall/i, /passive rereading/i],
  },
];

const IMAGE_EVIDENCE: EvidenceRule[] = [
  {
    label: "venous anatomy topic",
    patterns: [/\bveins?\b/i, /\bvenous\b/i, /upper limb/i, /arm/i, /upper extremity/i],
  },
  {
    label: "subclavian",
    patterns: [/\bsubclavian\b/i],
  },
  {
    label: "axillary",
    patterns: [/\baxillary\b/i],
  },
  {
    label: "cephalic",
    patterns: [/\bcephalic\b/i],
  },
  {
    label: "basilic",
    patterns: [/\bbasilic\b/i],
  },
  {
    label: "median cubital",
    patterns: [/\bmedian cubital\b/i],
  },
  {
    label: "radial",
    patterns: [/\bradial\b/i],
  },
  {
    label: "ulnar",
    patterns: [/\bulnar\b/i],
  },
  {
    label: "palmar venous arches",
    patterns: [/palmar venous arches/i],
  },
];

function cloneStudyAssistantSettings(
  settings: SproutSettings["studyAssistant"],
): SproutSettings["studyAssistant"] {
  if (typeof structuredClone === "function") return structuredClone(settings);
  return JSON.parse(JSON.stringify(settings)) as SproutSettings["studyAssistant"];
}

function formatFallbackText(template: string, vars?: Record<string, string | number>): string {
  let out = String(template || "");
  for (const [key, value] of Object.entries(vars || {})) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

function txFallback(_token: string, fallback: string, vars?: Record<string, string | number>): string {
  return formatFallbackText(fallback, vars);
}

function normalizeScenarioSettings(
  settings: SproutSettings["studyAssistant"],
  scenario: StudyAssistantMatrixScenario,
): void {
  settings.generatorTypes.basic = true;
  settings.generatorTypes.reversed = false;
  settings.generatorTypes.cloze = true;
  settings.generatorTypes.mcq = true;
  settings.generatorTypes.oq = true;
  settings.generatorTypes.io = false;

  settings.generatorOutput.includeTitle = false;
  settings.generatorOutput.includeInfo = false;
  settings.generatorOutput.includeGroups = false;

  settings.privacy.includeImagesInAsk = false;
  settings.privacy.includeImagesInReview = false;
  settings.privacy.includeImagesInFlashcard = false;
  settings.privacy.includeAttachmentsInCompanion = false;
  settings.privacy.includeLinkedNotesInCompanion = false;
  settings.privacy.includeLinkedAttachmentsInCompanion = false;

  if (scenario === "linked-note-context") {
    settings.privacy.includeLinkedNotesInCompanion = true;
    return;
  }

  if (scenario === "current-note-assets") {
    settings.privacy.includeImagesInAsk = true;
    settings.privacy.includeImagesInReview = true;
    settings.privacy.includeImagesInFlashcard = true;
    settings.privacy.includeAttachmentsInCompanion = true;
    settings.privacy.includeLinkedAttachmentsInCompanion = true;
  }
}

function defaultOptions(host: RunnerHost): StudyAssistantMatrixRunnerOptions {
  return {
    notePath: DEFAULT_NOTE_PATH,
    models: [{
      provider: host.settings.studyAssistant.provider,
      model: host.settings.studyAssistant.model,
    }],
    scenarios: DEFAULT_SCENARIOS,
    explicitAttachmentRefs: { ...DEFAULT_ATTACHMENT_REFS },
    printToConsole: true,
  };
}

function resolveModelSpecs(host: RunnerHost, options: StudyAssistantMatrixRunnerOptions): StudyAssistantMatrixModelSpec[] {
  if (Array.isArray(options.models) && options.models.length) {
    return options.models
      .map((spec) => ({
        provider: spec.provider,
        model: String(spec.model || "").trim(),
        label: String(spec.label || "").trim() || undefined,
      }))
      .filter((spec) => !!spec.model);
  }

  const current = host.settings.studyAssistant;
  return [{ provider: current.provider, model: String(current.model || "").trim() }].filter((spec) => !!spec.model);
}

function resolveScenarioList(options: StudyAssistantMatrixRunnerOptions): StudyAssistantMatrixScenario[] {
  if (Array.isArray(options.scenarios) && options.scenarios.length) return options.scenarios;
  return DEFAULT_SCENARIOS;
}

function resolveNoteFile(host: RunnerHost, notePath?: string): TFile {
  const fallbackPath = String(notePath || DEFAULT_NOTE_PATH || "").trim();
  const candidatePaths = (!notePath || fallbackPath === DEFAULT_NOTE_PATH)
    ? DEFAULT_NOTE_PATH_CANDIDATES
    : [fallbackPath];

  let resolved: unknown = null;
  for (const candidatePath of candidatePaths) {
    resolved = host.app.vault.getAbstractFileByPath(candidatePath);
    if (resolved instanceof TFile && String(resolved.extension || "").toLowerCase() === "md") {
      return resolved;
    }
  }

  if (!fallbackPath) resolved = host.app.workspace.getActiveFile();

  if (!(resolved instanceof TFile) || String(resolved.extension || "").toLowerCase() !== "md") {
    throw new Error(`Could not resolve markdown note: ${candidatePaths.join(" or ")}`);
  }

  return resolved;
}

function parseJsonCandidate(raw: string): unknown {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue to fallback scanning.
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    // Continue to balanced-scan fallback.
  }

  let start = -1;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
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
      const open = stack[stack.length - 1];
      if (!open) continue;
      const okPair = (open === "{" && ch === "}") || (open === "[" && ch === "]");
      if (!okPair) continue;
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1).trim();
        try {
          return JSON.parse(candidate);
        } catch {
          start = -1;
        }
      }
    }
  }

  return null;
}

function extractMarkdownSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentKey = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      currentKey = heading[1].trim().toLowerCase();
      if (!sections.has(currentKey)) sections.set(currentKey, []);
      continue;
    }
    if (!currentKey) continue;
    sections.get(currentKey)?.push(line);
  }
  return sections;
}

function countBullets(lines: string[]): number {
  return lines.filter((line) => /^\s*-\s+\S/.test(line)).length;
}

function validateMarkdownSections(
  reply: string,
  sections: Array<{ heading: string; minBullets: number }>,
): ChatValidationResult {
  const text = String(reply || "").trim();
  if (!text) return { ok: false, detail: "Empty reply." };

  const parsed = extractMarkdownSections(text);
  for (const section of sections) {
    const lines = parsed.get(section.heading.toLowerCase());
    if (!lines) return { ok: false, detail: `Missing section: ${section.heading}` };
    const bullets = countBullets(lines);
    if (bullets < section.minBullets) {
      return {
        ok: false,
        detail: `Section ${section.heading} had ${bullets} bullet(s); expected at least ${section.minBullets}.`,
      };
    }
  }

  return { ok: true, detail: "Reply matched expected markdown structure." };
}

function validateJsonObject(
  reply: string,
  rules: Array<{ key: string; kind: "string" | "array"; minItems?: number }>,
): ChatValidationResult {
  const parsed = parseJsonCandidate(reply);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, detail: "Reply was not valid JSON object output." };
  }

  const obj = parsed as Record<string, unknown>;
  for (const rule of rules) {
    const value = obj[rule.key];
    if (rule.kind === "string") {
      if (typeof value !== "string" || !value.trim()) {
        return { ok: false, detail: `Missing non-empty string field: ${rule.key}` };
      }
      continue;
    }

    if (!Array.isArray(value) || value.length < (rule.minItems ?? 1)) {
      return {
        ok: false,
        detail: `Field ${rule.key} did not contain at least ${rule.minItems ?? 1} item(s).`,
      };
    }
  }

  return { ok: true, detail: "Reply matched expected JSON structure." };
}

function combineValidationResults(
  primary: ChatValidationResult,
  secondary: ChatValidationResult,
): ChatValidationResult {
  if (!primary.ok) return primary;
  if (!secondary.ok) return secondary;
  if (!secondary.detail || secondary.detail === primary.detail) return primary;
  return {
    ok: true,
    detail: `${primary.detail} ${secondary.detail}`,
  };
}

function validateExpectedEvidence(
  reply: string,
  label: string,
  evidence: EvidenceRule[],
  minMatches: number,
): ChatValidationResult {
  const text = String(reply || "");
  if (!text.trim()) return { ok: false, detail: "Empty reply." };

  const matched = evidence
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.label);

  if (matched.length < minMatches) {
    return {
      ok: false,
      detail: `${label} reply matched ${matched.length}/${minMatches} expected fixture detail(s): ${matched.join(", ") || "none"}.`,
    };
  }

  return {
    ok: true,
    detail: `${label} reply matched expected fixture detail(s): ${matched.join(", ")}.`,
  };
}

function buildScenarioPlans(scenarios: StudyAssistantMatrixScenario[]): ScenarioPlan[] {
  const plans: ScenarioPlan[] = [];

  for (const scenario of scenarios) {
    if (scenario === "core-note") {
      plans.push(
        {
          scenario,
          scenarioLabel: "Core note",
          feature: "chat",
          mode: "ask",
          userMessage: [
            "Use note content only.",
            "Return exactly this markdown structure:",
            "## Summary",
            "- bullet one",
            "- bullet two",
            "## Question",
            "- one follow-up study question",
          ].join("\n"),
        },
        {
          scenario,
          scenarioLabel: "Core note",
          feature: "review",
          mode: "review",
          userMessage: [
            "Review this note for clarity, correctness, and study value.",
            "Return exactly this markdown structure:",
            "## Strengths",
            "- item 1",
            "- item 2",
            "- item 3",
            "## Problems",
            "- item 1",
            "- item 2",
            "- item 3",
            "## Fixes",
            "- item 1",
            "- item 2",
            "- item 3",
          ].join("\n"),
        },
        {
          scenario,
          scenarioLabel: "Core note",
          feature: "edit",
          mode: "edit",
          userMessage: "Rewrite this note for exam revision. Keep all facts, improve structure, tighten wording, and propose exact edits rather than generic advice.",
        },
        {
          scenario,
          scenarioLabel: "Core note",
          feature: "flashcards",
          mode: "generate",
          userMessage: "Generate 4 flashcards from this note using note content only: 1 basic, 1 cloze, 1 MCQ, and 1 OQ.",
        },
      );
      continue;
    }

    if (scenario === "linked-note-context") {
      plans.push(
        {
          scenario,
          scenarioLabel: "Linked-note context",
          feature: "chat",
          mode: "ask",
          userMessage: [
            "Use this note and any linked note text context that is included.",
            "At least one bullet must mention a linked-note-only fact when available.",
            "Return exactly this markdown structure:",
            "## Overlap",
            "- one bullet",
            "## Differences",
            "- one bullet",
            "## Missing connections",
            "- one bullet",
          ].join("\n"),
        },
      );
      continue;
    }

    if (scenario === "current-note-assets") {
      plans.push(
        {
          scenario,
          scenarioLabel: "Current-note assets",
          feature: "chat",
          mode: "ask",
          userMessage: [
            "Use this note and any current-note attachments or images that are included.",
            "Return exactly this markdown structure:",
            "## Note facts",
            "- one bullet",
            "## Attachment facts",
            "- one bullet",
            "## Combined takeaway",
            "- one bullet",
          ].join("\n"),
        },
        {
          scenario,
          scenarioLabel: "Current-note assets",
          feature: "review",
          mode: "review",
          userMessage: [
            "Review this note using any current-note attachments or images that are included.",
            "Return exactly this markdown structure:",
            "## Strengths",
            "- item 1",
            "- item 2",
            "- item 3",
            "## Problems",
            "- item 1",
            "- item 2",
            "- item 3",
            "## Fixes",
            "- item 1",
            "- item 2",
            "- item 3",
          ].join("\n"),
        },
        {
          scenario,
          scenarioLabel: "Current-note assets",
          feature: "flashcards",
          mode: "generate",
          userMessage: "Generate 4 flashcards using this note and any current-note attachments or images when useful: 1 basic, 1 cloze, 1 MCQ, and 1 OQ.",
        },
      );
      continue;
    }

    if (scenario === "explicit-docx") {
      plans.push({
        scenario,
        scenarioLabel: "Explicit DOCX",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["docx"],
        userMessage: [
          "Read the attached DOCX file.",
          "Recover the document title and the concrete facts it contains.",
          'Return valid JSON only in this shape: {"status":"ok","docTitle":"title","facts":["fact 1","fact 2"],"summary":"one short paragraph"}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "docx-fallback") {
      plans.push({
        scenario,
        scenarioLabel: "DOCX forced fallback",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["docx"],
        documentAttachmentMode: "force-fallback",
        userMessage: [
          "Use extracted-text fallback for the DOCX content from the start.",
          "Recover the document title and the concrete facts it contains.",
          'Return valid JSON only in this shape: {"status":"ok","docTitle":"title","facts":["fact 1","fact 2"],"summary":"one short paragraph"}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "explicit-pptx") {
      plans.push({
        scenario,
        scenarioLabel: "Explicit PPTX",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["pptx"],
        userMessage: [
          "Read the attached PowerPoint file.",
          "Recover the slide text about the capitals that appear in the deck.",
          'Return valid JSON only in this shape: {"status":"ok","slideTexts":["text 1","text 2"],"summary":"one short sentence"}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "pptx-fallback") {
      plans.push({
        scenario,
        scenarioLabel: "PPTX forced fallback",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["pptx"],
        documentAttachmentMode: "force-fallback",
        userMessage: [
          "Use extracted-text fallback for the PowerPoint content from the start.",
          "Recover the slide text about the capitals that appear in the deck.",
          'Return valid JSON only in this shape: {"status":"ok","slideTexts":["text 1","text 2"],"summary":"one short sentence"}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "explicit-pdf") {
      plans.push({
        scenario,
        scenarioLabel: "Explicit PDF",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["pdf"],
        userMessage: [
          "Read the attached PDF file.",
          "Recover the PDF title and the exact facts it contains.",
          'Return valid JSON only in this shape: {"status":"ok","pdfTitle":"title","facts":["fact 1","fact 2","fact 3"],"summary":"one short paragraph"}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "pdf-fallback") {
      plans.push({
        scenario,
        scenarioLabel: "PDF forced fallback",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["pdf"],
        documentAttachmentMode: "force-fallback",
        userMessage: [
          "Use extracted-text fallback for the PDF content from the start.",
          "Recover the PDF title and the exact facts it contains.",
          'Return valid JSON only in this shape: {"status":"ok","pdfTitle":"title","facts":["fact 1","fact 2","fact 3"],"summary":"one short paragraph"}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "explicit-image") {
      plans.push({
        scenario,
        scenarioLabel: "Explicit image",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["image"],
        userMessage: [
          "Inspect the attached diagram of arm veins.",
          "Name the visible veins or labels you can recover from the image.",
          'Return valid JSON only in this shape: {"status":"ok","topic":"short topic","labels":["label 1","label 2","label 3"]}',
        ].join("\n"),
      });
      continue;
    }

    if (scenario === "note-plus-pdf-grounding") {
      plans.push({
        scenario,
        scenarioLabel: "Note plus PDF grounding",
        feature: "chat",
        mode: "ask",
        attachmentKinds: ["pdf"],
        userMessage: [
          "Use both the note content and the attached PDF file.",
          'Return valid JSON only in this shape: {"status":"ok","noteFacts":["note fact"],"attachmentFacts":["attachment fact"]}',
        ].join("\n"),
      });
    }
  }

  return plans;
}

function validateChatLikeResult(plan: ScenarioPlan, reply: string): ChatValidationResult {
  if (plan.feature === "chat" && plan.scenario === "core-note") {
    return validateMarkdownSections(reply, [
      { heading: "Summary", minBullets: 2 },
      { heading: "Question", minBullets: 1 },
    ]);
  }

  if (plan.feature === "review") {
    return validateMarkdownSections(reply, [
      { heading: "Strengths", minBullets: 3 },
      { heading: "Problems", minBullets: 3 },
      { heading: "Fixes", minBullets: 3 },
    ]);
  }

  if (plan.feature === "chat" && plan.scenario === "linked-note-context") {
    return combineValidationResults(
      validateMarkdownSections(reply, [
        { heading: "Overlap", minBullets: 1 },
        { heading: "Differences", minBullets: 1 },
        { heading: "Missing connections", minBullets: 1 },
      ]),
      validateExpectedEvidence(reply, "Linked-note context", LINKED_NOTE_EVIDENCE, 1),
    );
  }

  if (plan.feature === "chat" && plan.scenario === "current-note-assets") {
    return validateMarkdownSections(reply, [
      { heading: "Note facts", minBullets: 1 },
      { heading: "Attachment facts", minBullets: 1 },
      { heading: "Combined takeaway", minBullets: 1 },
    ]);
  }

  if (plan.scenario === "explicit-docx" || plan.scenario === "docx-fallback") {
    return combineValidationResults(
      validateJsonObject(reply, [
        { key: "status", kind: "string" },
        { key: "docTitle", kind: "string" },
        { key: "facts", kind: "array", minItems: 2 },
        { key: "summary", kind: "string" },
      ]),
      validateExpectedEvidence(reply, "DOCX attachment", DOCX_EVIDENCE, 3),
    );
  }

  if (plan.scenario === "explicit-pptx" || plan.scenario === "pptx-fallback") {
    return combineValidationResults(
      validateJsonObject(reply, [
        { key: "status", kind: "string" },
        { key: "slideTexts", kind: "array", minItems: 2 },
        { key: "summary", kind: "string" },
      ]),
      validateExpectedEvidence(reply, "PPTX attachment", PPTX_EVIDENCE, 2),
    );
  }

  if (plan.scenario === "explicit-pdf" || plan.scenario === "pdf-fallback") {
    return combineValidationResults(
      validateJsonObject(reply, [
        { key: "status", kind: "string" },
        { key: "pdfTitle", kind: "string" },
        { key: "facts", kind: "array", minItems: 3 },
        { key: "summary", kind: "string" },
      ]),
      validateExpectedEvidence(reply, "PDF attachment", PDF_EVIDENCE, 3),
    );
  }

  if (plan.scenario === "explicit-image") {
    return combineValidationResults(
      validateJsonObject(reply, [
        { key: "status", kind: "string" },
        { key: "topic", kind: "string" },
        { key: "labels", kind: "array", minItems: 3 },
      ]),
      validateExpectedEvidence(reply, "Image attachment", IMAGE_EVIDENCE, 4),
    );
  }

  if (plan.scenario === "note-plus-pdf-grounding") {
    return validateJsonObject(reply, [
      { key: "status", kind: "string" },
      { key: "noteFacts", kind: "array", minItems: 1 },
      { key: "attachmentFacts", kind: "array", minItems: 1 },
    ]);
  }

  return { ok: !!String(reply || "").trim(), detail: String(reply || "").trim() ? "Non-empty reply." : "Empty reply." };
}

function attachmentRouteFromUnknown(error: unknown): StudyAssistantAttachmentRoute {
  if (!error || typeof error !== "object") return "none";
  const route = (error as { attachmentRoute?: unknown }).attachmentRoute;
  return route === "native" || route === "retry-fallback" || route === "forced-fallback" || route === "none"
    ? route
    : "none";
}

function attachmentRoutingSummary(
  provider: StudyAssistantProvider,
  imageDataUrls: string[],
  attachedFileDataUrls: string[],
  attachmentRoute: StudyAssistantAttachmentRoute,
): string {
  let imageCount = Array.isArray(imageDataUrls) ? imageDataUrls.length : 0;
  let nativeCount = 0;
  let fallbackTextCount = 0;
  const forceDocumentFallback = attachmentRoute === "retry-fallback" || attachmentRoute === "forced-fallback";

  for (const raw of attachedFileDataUrls) {
    const match = String(raw || "").trim().match(/^data:([^;,]+);base64,/i);
    if (!match?.[1]) continue;
    const mimeType = String(match[1]).toLowerCase();
    if (mimeType.startsWith("image/")) {
      imageCount += 1;
      continue;
    }
    if (forceDocumentFallback) fallbackTextCount += 1;
    else if (providerSupportsNativeDocumentAttachment(provider, mimeType)) nativeCount += 1;
    else fallbackTextCount += 1;
  }

  const parts: string[] = [];
  if (imageCount > 0) parts.push(`image:${imageCount}`);
  if (nativeCount > 0) parts.push(`native:${nativeCount}`);
  if (fallbackTextCount > 0) parts.push(`fallback-text:${fallbackTextCount}`);
  return parts.length ? parts.join(", ") : "none";
}

function buildMarkdownSummary(result: StudyAssistantMatrixRunResult): string {
  const lines: string[] = [
    "# LearnKit AI compatibility summary",
    "",
    `- Note: ${result.notePath}`,
    `- Started: ${result.startedAt}`,
    `- Finished: ${result.finishedAt}`,
    "",
    "| Provider | Model | Scenario | Feature | Status | Route | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of result.rows) {
    const detail = row.detail.replace(/\|/g, "\\|");
    lines.push(`| ${row.provider} | ${row.model} | ${row.scenario} | ${row.feature} | ${row.status.toUpperCase()} | ${row.attachmentRoute} | ${detail} |`);
  }

  return lines.join("\n");
}

function buildTableRows(rows: StudyAssistantMatrixRowResult[]): Array<{
  provider: StudyAssistantProvider;
  model: string;
  scenario: StudyAssistantMatrixScenario;
  feature: StudyAssistantMatrixFeature;
  status: StudyAssistantMatrixStatus;
  route: StudyAssistantAttachmentRoute;
  routing: string;
  linkedNotes: number;
  detail: string;
}> {
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    scenario: row.scenario,
    feature: row.feature,
    status: row.status,
    route: row.attachmentRoute,
    routing: row.attachmentRouting,
    linkedNotes: row.linkedNotesIncluded,
    detail: row.detail,
  }));
}

function logRunResult(result: StudyAssistantMatrixRunResult, title = "LearnKit AI compatibility matrix"): void {
  const tableRows = buildTableRows(result.rows);

  console.debug(title);
  console.debug("%c%s", "font-weight:bold", "Results table:");
  console.debug(tableRows.map((r) => `${r.provider}:${r.model} | ${r.scenario} | ${r.feature} | ${r.status} | ${r.detail}`).join("\n"));

  for (const row of result.rows) {
    console.debug(`${row.label} :: ${row.scenario} :: ${row.feature} :: ${row.status.toUpperCase()}`);
    console.debug("Detail:", row.detail);
    console.debug("Attachment route:", row.attachmentRoute);
    console.debug("Attachment routing:", row.attachmentRouting);
    if (row.attachmentRefs.length) console.debug("Attachment refs:", row.attachmentRefs);
    if (row.payloadPreview) console.debug("Payload preview:\n", row.payloadPreview);
    if (row.rawResponseText) console.debug("Raw response:\n", row.rawResponseText);
  }

  console.debug(result.markdownSummary);
}

async function runScenarioPlan(params: {
  host: RunnerHost;
  noteFile: TFile;
  plan: ScenarioPlan;
  modelSpec: StudyAssistantMatrixModelSpec;
  settings: SproutSettings["studyAssistant"];
  explicitAttachmentRefs: Partial<Record<StudyAssistantMatrixAttachmentKind, string>>;
}): Promise<StudyAssistantMatrixRowResult> {
  const { host, noteFile, plan, modelSpec, settings, explicitAttachmentRefs } = params;
  const attachmentRefs = (plan.attachmentKinds || []).map((kind) => explicitAttachmentRefs[kind] || DEFAULT_ATTACHMENT_REFS[kind]);
  const resolvedAttachments = plan.attachmentKinds?.length
    ? await resolveStudyAssistantAttachmentRefs({
      app: host.app,
      sourceFile: noteFile,
      refs: attachmentRefs,
    })
    : { attachments: [], missingRefs: [] };

  if (resolvedAttachments.missingRefs.length > 0) {
    return {
      provider: modelSpec.provider,
      model: modelSpec.model,
      label: modelSpec.label || `${modelSpec.provider}:${modelSpec.model}`,
      notePath: noteFile.path,
      scenario: plan.scenario,
      scenarioLabel: plan.scenarioLabel,
      feature: plan.feature,
      status: "fail",
      detail: `Missing attachment fixture(s): ${resolvedAttachments.missingRefs.join(", ")}`,
      attachmentRoute: "none",
      attachmentRouting: "none",
      linkedNotesIncluded: 0,
      rawResponseText: "",
      payloadPreview: "",
      attachmentRefs,
    };
  }

  const context = await buildStudyAssistantNoteContext({
    app: host.app,
    file: noteFile,
    settings,
    mode: plan.mode,
    explicitAttachedFileDataUrls: resolvedAttachments.attachments.map((attachment) => attachment.dataUrl),
  });

  const baseRow = {
    provider: modelSpec.provider,
    model: modelSpec.model,
    label: modelSpec.label || `${modelSpec.provider}:${modelSpec.model}`,
    notePath: noteFile.path,
    scenario: plan.scenario,
    scenarioLabel: plan.scenarioLabel,
    feature: plan.feature,
    linkedNotesIncluded: context.linkedContextStats.included,
    attachmentRefs,
  };

  const finalizeRow = (row: {
    status: StudyAssistantMatrixStatus;
    detail: string;
    attachmentRoute: StudyAssistantAttachmentRoute;
    rawResponseText: string;
    payloadPreview: string;
  }): StudyAssistantMatrixRowResult => ({
    ...baseRow,
    status: row.status,
    detail: row.detail,
    attachmentRoute: row.attachmentRoute,
    attachmentRouting: attachmentRoutingSummary(
      modelSpec.provider,
      context.imageDataUrls,
      context.attachedFileDataUrls,
      row.attachmentRoute,
    ),
    rawResponseText: row.rawResponseText,
    payloadPreview: row.payloadPreview,
  });

  if (plan.feature === "flashcards") {
    try {
      const result = await generateStudyAssistantSuggestions({
        settings,
        input: {
          notePath: noteFile.path,
          noteContent: context.noteContentForAi,
          imageRefs: context.imageRefs,
          imageDescriptors: context.imageDescriptors,
          imageDataUrls: context.imageDataUrls,
          attachedFileDataUrls: context.attachedFileDataUrls,
          documentAttachmentMode: plan.documentAttachmentMode,
          includeImages: context.includeImages,
          enabledTypes: DEFAULT_FLASHCARD_TYPES,
          targetSuggestionCount: 4,
          includeTitle: false,
          includeInfo: false,
          includeGroups: false,
          customInstructions: settings.prompts.assistant,
          userRequestText: plan.userMessage,
        },
      });

      if (!Array.isArray(result.suggestions) || result.suggestions.length === 0) {
        return finalizeRow({
          status: "fail",
          detail: "No flashcard suggestions returned.",
          attachmentRoute: result.attachmentRoute,
          rawResponseText: result.rawResponseText,
          payloadPreview: result.payloadPreview,
        });
      }

      const errors: string[] = [];
      for (const suggestion of result.suggestions) {
        const markdown = formatInsertBlock(buildSuggestionMarkdownLines(suggestion, {
          includeTitle: false,
          includeInfo: false,
          includeGroups: false,
        }).join("\n"));
        const validationError = validateGeneratedCardBlock(noteFile.path, suggestion, markdown, txFallback);
        if (validationError) errors.push(validationError);
      }

      return finalizeRow({
        status: errors.length ? "fail" : "pass",
        detail: errors.length
          ? `Flashcard validation failed: ${errors[0]}`
          : `Validated ${result.suggestions.length} parser-valid flashcard suggestion(s).`,
        attachmentRoute: result.attachmentRoute,
        rawResponseText: result.rawResponseText,
        payloadPreview: result.payloadPreview,
      });
    } catch (error) {
      return finalizeRow({
        status: "fail",
        detail: error instanceof Error ? error.message : "Flashcard generation failed.",
        attachmentRoute: attachmentRouteFromUnknown(error),
        rawResponseText: "",
        payloadPreview: "",
      });
    }
  }

  try {
    const result = await generateStudyAssistantChatReply({
      settings,
      input: {
        mode: plan.feature === "review" ? "review" : plan.feature === "edit" ? "edit" : "ask",
        notePath: noteFile.path,
        noteContent: context.noteContentForAi,
        imageRefs: context.imageRefs,
        imageDataUrls: context.imageDataUrls,
        attachedFileDataUrls: context.attachedFileDataUrls,
        documentAttachmentMode: plan.documentAttachmentMode,
        includeImages: context.includeImages,
        userMessage: plan.userMessage,
        customInstructions: settings.prompts.assistant,
        reviewDepth: plan.feature === "review" ? "standard" : undefined,
      },
    });

    if (plan.feature === "edit") {
      const proposal = parseEditProposal(result.reply);
      if (!proposal || !proposal.edits.length) {
        return finalizeRow({
          status: "fail",
          detail: "Reply did not contain a valid edit proposal.",
          attachmentRoute: result.attachmentRoute,
          rawResponseText: result.rawResponseText,
          payloadPreview: result.payloadPreview,
        });
      }

      const validation = validateEditProposal(
        proposal.edits,
        context.noteContent,
        mentionsFrontmatter(plan.userMessage),
      );

      return finalizeRow({
        status: validation.validEdits.length > 0 ? "pass" : "fail",
        detail: validation.validEdits.length > 0
          ? `Validated ${validation.validEdits.length} edit proposal(s).`
          : (validation.rejectionReasons[0] || "All proposed edits were rejected."),
        attachmentRoute: result.attachmentRoute,
        rawResponseText: result.rawResponseText,
        payloadPreview: result.payloadPreview,
      });
    }

    const validation = validateChatLikeResult(plan, result.reply);
    return finalizeRow({
      status: validation.ok ? "pass" : "fail",
      detail: validation.detail,
      attachmentRoute: result.attachmentRoute,
      rawResponseText: result.rawResponseText,
      payloadPreview: result.payloadPreview,
    });
  } catch (error) {
    return finalizeRow({
      status: "fail",
      detail: error instanceof Error ? error.message : "Study Assistant request failed.",
      attachmentRoute: attachmentRouteFromUnknown(error),
      rawResponseText: "",
      payloadPreview: "",
    });
  }
}

export async function runStudyAssistantMatrix(
  host: RunnerHost,
  options: StudyAssistantMatrixRunnerOptions = {},
): Promise<StudyAssistantMatrixRunResult> {
  const startedAt = new Date().toISOString();
  const noteFile = resolveNoteFile(host, options.notePath);
  const explicitAttachmentRefs = { ...DEFAULT_ATTACHMENT_REFS, ...(options.explicitAttachmentRefs || {}) };
  const modelSpecs = resolveModelSpecs(host, options);
  const scenarioPlans = buildScenarioPlans(resolveScenarioList(options));
  const rows: StudyAssistantMatrixRowResult[] = [];

  for (const modelSpec of modelSpecs) {
    const modelStartedAt = new Date().toISOString();
    const settings = cloneStudyAssistantSettings(host.settings.studyAssistant);
    settings.provider = modelSpec.provider;
    settings.model = modelSpec.model;
    const modelLabel = modelSpec.label || `${modelSpec.provider}:${modelSpec.model}`;
    const modelRows: StudyAssistantMatrixRowResult[] = [];

    const apiKey = providerApiKey(settings.provider, settings.apiKeys);
    if (!apiKey) {
      for (const plan of scenarioPlans) {
        const row: StudyAssistantMatrixRowResult = {
          provider: modelSpec.provider,
          model: modelSpec.model,
          label: modelLabel,
          notePath: noteFile.path,
          scenario: plan.scenario,
          scenarioLabel: plan.scenarioLabel,
          feature: plan.feature,
          status: "skipped",
          detail: `Missing API key for provider: ${modelSpec.provider}`,
          attachmentRoute: "none",
          attachmentRouting: "none",
          linkedNotesIncluded: 0,
          rawResponseText: "",
          payloadPreview: "",
          attachmentRefs: (plan.attachmentKinds || []).map((kind) => explicitAttachmentRefs[kind] || DEFAULT_ATTACHMENT_REFS[kind]),
        };
        rows.push(row);
        modelRows.push(row);
      }
      if (options.printToConsole !== false) {
        const modelResult: StudyAssistantMatrixRunResult = {
          startedAt: modelStartedAt,
          finishedAt: new Date().toISOString(),
          notePath: noteFile.path,
          rows: modelRows,
          markdownSummary: "",
        };
        modelResult.markdownSummary = buildMarkdownSummary(modelResult);
        logRunResult(modelResult, `LearnKit AI compatibility matrix (${modelLabel} complete ${rows.length}/${scenarioPlans.length * modelSpecs.length})`);
      }
      continue;
    }

    for (const plan of scenarioPlans) {
      const scenarioSettings = cloneStudyAssistantSettings(settings);
      normalizeScenarioSettings(scenarioSettings, plan.scenario);
      const row = await runScenarioPlan({
        host,
        noteFile,
        plan,
        modelSpec,
        settings: scenarioSettings,
        explicitAttachmentRefs,
      });
      rows.push(row);
      modelRows.push(row);
    }

    if (options.printToConsole !== false) {
      const modelResult: StudyAssistantMatrixRunResult = {
        startedAt: modelStartedAt,
        finishedAt: new Date().toISOString(),
        notePath: noteFile.path,
        rows: modelRows,
        markdownSummary: "",
      };
      modelResult.markdownSummary = buildMarkdownSummary(modelResult);
      logRunResult(modelResult, `LearnKit AI compatibility matrix (${modelLabel} complete ${rows.length}/${scenarioPlans.length * modelSpecs.length})`);
    }
  }

  const result: StudyAssistantMatrixRunResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    notePath: noteFile.path,
    rows,
    markdownSummary: "",
  };
  result.markdownSummary = buildMarkdownSummary(result);

  if (options.printToConsole !== false && modelSpecs.length > 1) logRunResult(result, "LearnKit AI compatibility matrix (all models complete)");
  if (options.printToConsole !== false && modelSpecs.length <= 1) logRunResult(result);
  return result;
}

export function createStudyAssistantMatrixConsoleApi(host: RunnerHost): StudyAssistantMatrixConsoleApi {
  const api: StudyAssistantMatrixConsoleApi = {
    lastResult: null,
    getDefaultOptions: () => defaultOptions(host),
    runMatrix: async (options: StudyAssistantMatrixRunnerOptions = {}) => {
      const result = await runStudyAssistantMatrix(host, options);
      api.lastResult = result;
      return result;
    },
  };
  return api;
}