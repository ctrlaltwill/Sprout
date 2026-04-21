/**
 * @file tests/study-assistant-generator.test.ts
 * @summary Unit tests for study assistant generator.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateStudyAssistantSuggestions,
  generateStudyAssistantSuggestionsStreaming,
  parseUserRequestOverrides,
} from "../src/platform/integrations/ai/study-assistant-generator";
import type { SproutSettings } from "../src/platform/types/settings";
import {
  requestStudyAssistantCompletionDetailed,
  requestStudyAssistantStreamingCompletion,
} from "../src/platform/integrations/ai/study-assistant-provider";

vi.mock("../src/platform/integrations/ai/study-assistant-provider", () => ({
  requestStudyAssistantCompletionDetailed: vi.fn(),
  requestStudyAssistantStreamingCompletion: vi.fn(),
}));

const mockedCompletion = vi.mocked(requestStudyAssistantCompletionDetailed);
const mockedStreamingCompletion = vi.mocked(requestStudyAssistantStreamingCompletion);

function makeSettings(): SproutSettings["studyAssistant"] {
  return {
    enabled: true,
    location: "modal",
    modalButtonVisibility: "always",
    voiceChat: false,
    provider: "openrouter",
    openRouterTier: "free",
    model: "openrouter/auto",
    endpointOverride: "",
    apiKeys: {
      openai: "",
      anthropic: "",
      deepseek: "",
      xai: "",
      google: "",
      perplexity: "",
      openrouter: "test-key",
      custom: "",
    },
    prompts: {
      assistant: "",
      noteReview: "",
      generator: "",
    },
    generatorTypes: {
      basic: true,
      reversed: true,
      cloze: true,
      mcq: true,
      oq: true,
      io: false,
    },
    generatorTargetCount: 5,
    generatorOutput: {
      includeTitle: false,
      includeInfo: false,
      includeGroups: false,
    },
    privacy: {
      autoSendOnOpen: false,
      includeImagesInAsk: false,
      includeImagesInReview: false,
      includeImagesInFlashcard: false,
      previewPayload: false,
      saveChatHistory: false,
      syncDeletesToProvider: false,
      linkedContextLimit: "standard",
      textAttachmentContextLimit: "standard",
    },
  };
}

describe("study assistant generator", () => {
  beforeEach(() => {
    mockedCompletion.mockReset();
    mockedStreamingCompletion.mockReset();
    mockedCompletion.mockResolvedValue({
      text: JSON.stringify({ suggestions: [] }),
      conversationId: "fallback",
      attachmentRoute: "none",
    });
    mockedStreamingCompletion.mockResolvedValue({
      text: JSON.stringify({ suggestions: [] }),
      conversationId: "fallback",
      attachmentRoute: "none",
    });
  });

  it("parses suggestions from alternate cards key", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        cards: [
          {
            type: "basic",
            difficulty: 2,
            question: "What is acute stress disorder?",
            answer: "A trauma-related condition after a stressor",
          },
        ],
      }),
      conversationId: "c1",
    });

    const result = await generateStudyAssistantSuggestions({
      settings: makeSettings(),
      input: {
        notePath: "Acute Stress Disorder.md",
        noteContent: "",
        imageRefs: [],
        includeImages: false,
        enabledTypes: ["basic", "cloze", "mcq", "oq"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 basic card",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.type).toBe("basic");
  });

  it("parses top-level array payloads", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          type: "cloze",
          difficulty: 2,
          clozeText: "ASD symptoms can include {{c1::intrusive memories}}.",
        },
      ]),
      conversationId: "c2",
    });

    const result = await generateStudyAssistantSuggestions({
      settings: makeSettings(),
      input: {
        notePath: "Acute Stress Disorder.md",
        noteContent: "",
        imageRefs: [],
        includeImages: false,
        enabledTypes: ["cloze"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate cloze flashcards",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.type).toBe("cloze");
  });

  it("extracts json from noisy wrapped output", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: [
        "Here you go:",
        JSON.stringify({
          suggestions: [
            {
              type: "basic",
              difficulty: 2,
              question: "What learning process declines when threat is absent?",
              answer: "Extinction learning",
            },
          ],
        }),
        "Thanks!",
      ].join("\n"),
      conversationId: "c3",
    });

    const result = await generateStudyAssistantSuggestions({
      settings: makeSettings(),
      input: {
        notePath: "Acute Stress Disorder.md",
        noteContent: "",
        imageRefs: [],
        includeImages: false,
        enabledTypes: ["basic"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 basic card",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.question).toContain("threat is absent");
  });

  it("returns best-effort suggestions when strict duplicate filtering would otherwise return empty", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "basic",
            difficulty: 2,
            question: "What is acute stress disorder?",
            answer: "A trauma-related condition after a stressor",
          },
        ],
      }),
      conversationId: "c4",
    });

    const result = await generateStudyAssistantSuggestions({
      settings: makeSettings(),
      input: {
        notePath: "Acute Stress Disorder.md",
        noteContent: [
          "Q | What is acute stress disorder? |",
          "A | A trauma-related condition after a stressor |",
        ].join("\n"),
        imageRefs: [],
        includeImages: false,
        enabledTypes: ["basic"],
        targetSuggestionCount: 3,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate flashcards",
      },
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.type).toBe("basic");
  });

  it("rejects AI IO suggestions that embed multiple images in one IO field", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "io",
            difficulty: 2,
            ioSrc: "![[Schrober Test.png]] ![[Faber Test.png]]",
            ioOcclusions: [
              { rectId: "r1", x: 0.2, y: 0.2, w: 0.1, h: 0.1, groupKey: "1", shape: "rect" },
            ],
            ioMaskMode: "all",
            rationale: "Image occlusion recall",
          },
        ],
      }),
      conversationId: "c-io-invalid",
    });

    const settings = makeSettings();
    settings.model = "gpt-4.1";
    settings.generatorTypes.io = true;

    const result = await generateStudyAssistantSuggestions({
      settings,
      input: {
        notePath: "Ankylosing Spondylitis.md",
        noteContent: "",
        imageRefs: ["Schrober Test.png", "Faber Test.png"],
        imageDataUrls: ["data:image/png;base64,AAAA"],
        includeImages: true,
        enabledTypes: ["io"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 io card",
      },
    });

    expect(result.suggestions).toHaveLength(0);
  });

  it("accepts high-yield IO suggestions with explicit assessment", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "io",
            difficulty: 2,
            ioSrc: "![[Arm veins diagram.png]]",
            ioOcclusions: [
              { rectId: "r1", x: 0.18, y: 0.24, w: 0.16, h: 0.05, groupKey: "1", shape: "rect" },
            ],
            ioMaskMode: "solo",
            ioAssessment: {
              imageRef: "Arm veins diagram.png",
              imageKind: "diagram",
              studyValue: "high",
              placementConfidence: 0.93,
              targetLabels: ["basilic vein"],
              usefulnessReason: "Labelled anatomy diagram with discrete targets.",
            },
            rationale: "Tests labelled venous anatomy from the diagram.",
          },
        ],
      }),
      conversationId: "c-io-valid",
    });

    const settings = makeSettings();
    settings.model = "gpt-4.1";
    settings.generatorTypes.io = true;

    const result = await generateStudyAssistantSuggestions({
      settings,
      input: {
        notePath: "Upper Limb.md",
        noteContent: "# Upper limb\n\n![[Arm veins diagram.png]]",
        imageRefs: ["Arm veins diagram.png"],
        imageDescriptors: [
          {
            ref: "Arm veins diagram.png",
            order: 1,
            heading: "Upper limb",
            headingPath: "Upper limb",
            contextSnippet: "Labelled upper-limb venous anatomy diagram.",
          },
        ],
        imageDataUrls: ["data:image/png;base64,AAAA"],
        includeImages: true,
        enabledTypes: ["io"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 io card",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.type).toBe("io");
    expect(result.suggestions[0]?.ioAssessment?.studyValue).toBe("high");
  });

  it("drops low-yield IO suggestions and keeps non-IO fallbacks", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "io",
            difficulty: 2,
            ioSrc: "![[Decorative photo.png]]",
            ioOcclusions: [
              { rectId: "r1", x: 0.15, y: 0.2, w: 0.2, h: 0.2, groupKey: "1", shape: "rect" },
            ],
            ioMaskMode: "solo",
            ioAssessment: {
              imageRef: "Decorative photo.png",
              imageKind: "photo",
              studyValue: "low",
              placementConfidence: 0.94,
              targetLabels: ["car door"],
              usefulnessReason: "General photo.",
            },
            rationale: "Image occlusion recall.",
          },
          {
            type: "basic",
            difficulty: 2,
            question: "What test assesses lumbar flexion in ankylosing spondylitis?",
            answer: "Schober test",
            rationale: "High-yield named clinical test.",
          },
        ],
      }),
      conversationId: "c-io-low-yield",
    });

    const settings = makeSettings();
    settings.model = "gpt-4.1";
    settings.generatorTypes.io = true;

    const result = await generateStudyAssistantSuggestions({
      settings,
      input: {
        notePath: "Clinical tests.md",
        noteContent: "# Clinical tests\n\n![[Decorative photo.png]]",
        imageRefs: ["Decorative photo.png"],
        imageDescriptors: [
          {
            ref: "Decorative photo.png",
            order: 1,
            heading: "Clinical tests",
            headingPath: "Clinical tests",
            contextSnippet: "Photo near discussion of clinical tests.",
          },
        ],
        imageDataUrls: ["data:image/png;base64,AAAA"],
        includeImages: true,
        enabledTypes: ["basic", "io"],
        targetSuggestionCount: 2,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 2 flashcards",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.type).toBe("basic");
  });

  it("replaces guessed IO masks with OCR-matched label geometry", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "io",
            difficulty: 3,
            ioSrc: "![[Veins diagram.png]]",
            ioOcclusions: [
              { rectId: "r1", x: 0.1, y: 0.05, w: 0.3, h: 0.3, groupKey: "1", shape: "rect" },
              { rectId: "r2", x: 0.55, y: 0.18, w: 0.15, h: 0.12, groupKey: "2", shape: "rect" },
            ],
            ioMaskMode: "solo",
            ioAssessment: {
              imageRef: "Veins diagram.png",
              imageKind: "diagram",
              studyValue: "high",
              placementConfidence: 0.74,
              targetLabels: ["Pulmonary circuit", "Pulmonary vein"],
              usefulnessReason: "Labelled circulation diagram with explicit target labels.",
            },
            rationale: "Tests key labelled structures on the diagram.",
          },
        ],
      }),
      conversationId: "c-ocr-snap",
    });

    const settings = makeSettings();
    settings.model = "gpt-4.1";
    settings.generatorTypes.io = true;

    const result = await generateStudyAssistantSuggestions({
      settings,
      input: {
        notePath: "Veins.md",
        noteContent: "# Veins\n\n![[Veins diagram.png]]",
        imageRefs: ["Veins diagram.png"],
        imageDescriptors: [
          {
            ref: "Veins diagram.png",
            order: 1,
            heading: "Veins",
            headingPath: "Veins",
            contextSnippet: "Labelled vein diagram.",
            ocrTextRegions: [
              { text: "Pulmonary circuit", confidence: 0.95, x: 0.46, y: 0.11, w: 0.28, h: 0.06 },
              { text: "Pulmonary vein", confidence: 0.93, x: 0.78, y: 0.16, w: 0.15, h: 0.10 },
            ],
          },
        ],
        imageDataUrls: ["data:image/png;base64,AAAA"],
        includeImages: true,
        enabledTypes: ["io"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 io card",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.ioOcclusions).toEqual([
      { rectId: "r1", x: 0.46, y: 0.11, w: 0.28, h: 0.06, groupKey: "1", shape: "rect" },
      { rectId: "r2", x: 0.78, y: 0.16, w: 0.15, h: 0.10, groupKey: "2", shape: "rect" },
    ]);
    expect(result.suggestions[0]?.ioAssessment?.targetLabels).toEqual(["Pulmonary circuit", "Pulmonary vein"]);
  });

  it("prefers compact OCR label boxes over broader OCR spans", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "io",
            difficulty: 3,
            ioSrc: "![[Veins diagram.png]]",
            ioOcclusions: [
              { rectId: "r1", x: 0.10, y: 0.05, w: 0.30, h: 0.30, groupKey: "1", shape: "rect" },
            ],
            ioMaskMode: "solo",
            ioAssessment: {
              imageRef: "Veins diagram.png",
              imageKind: "diagram",
              studyValue: "high",
              placementConfidence: 0.8,
              targetLabels: ["Pulmonary vein"],
              usefulnessReason: "Labelled circulation diagram.",
            },
            rationale: "Tests labelled vessel anatomy.",
          },
        ],
      }),
      conversationId: "c-ocr-compact",
    });

    const settings = makeSettings();
    settings.model = "gpt-4.1";
    settings.generatorTypes.io = true;

    const result = await generateStudyAssistantSuggestions({
      settings,
      input: {
        notePath: "Veins.md",
        noteContent: "# Veins\n\n![[Veins diagram.png]]",
        imageRefs: ["Veins diagram.png"],
        imageDescriptors: [
          {
            ref: "Veins diagram.png",
            order: 1,
            heading: "Veins",
            headingPath: "Veins",
            contextSnippet: "Labelled vein diagram.",
            ocrTextRegions: [
              { text: "Pulmonary circuit Pulmonary vein", confidence: 0.97, x: 0.45, y: 0.10, w: 0.50, h: 0.18 },
              { text: "Pulmonary vein", confidence: 0.91, x: 0.78, y: 0.16, w: 0.15, h: 0.10 },
            ],
          },
        ],
        imageDataUrls: ["data:image/png;base64,AAAA"],
        includeImages: true,
        enabledTypes: ["io"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 io card",
      },
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.ioOcclusions).toEqual([
      { rectId: "r1", x: 0.78, y: 0.16, w: 0.15, h: 0.10, groupKey: "1", shape: "rect" },
    ]);
    expect(result.suggestions[0]?.ioAssessment?.targetLabels).toEqual(["Pulmonary vein"]);
  });

  it("rejects IO suggestions when OCR cannot match the claimed targets", async () => {
    mockedCompletion.mockResolvedValueOnce({
      text: JSON.stringify({
        suggestions: [
          {
            type: "io",
            difficulty: 2,
            ioSrc: "![[Veins diagram.png]]",
            ioOcclusions: [
              { rectId: "r1", x: 0.2, y: 0.2, w: 0.1, h: 0.1, groupKey: "1", shape: "rect" },
            ],
            ioMaskMode: "solo",
            ioAssessment: {
              imageRef: "Veins diagram.png",
              imageKind: "diagram",
              studyValue: "high",
              placementConfidence: 0.82,
              targetLabels: ["Inferior vena cava"],
              usefulnessReason: "Labelled circulation diagram.",
            },
            rationale: "Tests the diagram.",
          },
        ],
      }),
      conversationId: "c-ocr-reject",
    });

    const settings = makeSettings();
    settings.model = "gpt-4.1";
    settings.generatorTypes.io = true;

    const result = await generateStudyAssistantSuggestions({
      settings,
      input: {
        notePath: "Veins.md",
        noteContent: "# Veins\n\n![[Veins diagram.png]]",
        imageRefs: ["Veins diagram.png"],
        imageDescriptors: [
          {
            ref: "Veins diagram.png",
            order: 1,
            heading: "Veins",
            headingPath: "Veins",
            contextSnippet: "Labelled vein diagram.",
            ocrTextRegions: [
              { text: "Pulmonary circuit", confidence: 0.95, x: 0.46, y: 0.11, w: 0.28, h: 0.06 },
              { text: "Pulmonary vein", confidence: 0.93, x: 0.78, y: 0.16, w: 0.15, h: 0.10 },
            ],
          },
        ],
        imageDataUrls: ["data:image/png;base64,AAAA"],
        includeImages: true,
        enabledTypes: ["io"],
        targetSuggestionCount: 1,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 1 io card",
      },
    });

    expect(result.suggestions).toHaveLength(0);
  });

  it("streams suggestions as complete JSON items arrive", async () => {
    const streamedPrompts: string[] = [];
    const chunks = [
      '{"suggestions":[{"type":"basic","difficulty":2,"question":"What is acute stress disorder?"',
      ',"answer":"A trauma-related condition after a stressor"},{"type":"cloze","difficulty":2',
      ',"clozeText":"Symptoms can include {{c1::intrusive memories}}."}]}',
    ];

    mockedStreamingCompletion.mockImplementationOnce(async ({ onChunk }) => {
      onChunk(chunks[0]);
      expect(streamedPrompts).toEqual([]);

      onChunk(chunks[1]);
      expect(streamedPrompts).toEqual(["What is acute stress disorder?"]);

      onChunk(chunks[2]);
      expect(streamedPrompts).toEqual([
        "What is acute stress disorder?",
        "Symptoms can include {{c1::intrusive memories}}.",
      ]);

      return {
        text: chunks.join(""),
        conversationId: "stream-1",
        attachmentRoute: "native",
      };
    });

    const result = await generateStudyAssistantSuggestionsStreaming({
      settings: makeSettings(),
      input: {
        notePath: "Acute Stress Disorder.md",
        noteContent: "",
        imageRefs: [],
        includeImages: false,
        enabledTypes: ["basic", "cloze"],
        targetSuggestionCount: 2,
        includeTitle: false,
        includeInfo: false,
        includeGroups: false,
        customInstructions: "",
        userRequestText: "generate 2 flashcards",
      },
      onSuggestion: (suggestion) => {
        streamedPrompts.push(String(suggestion.question || suggestion.clozeText || ""));
      },
    });

    expect(streamedPrompts).toEqual([
      "What is acute stress disorder?",
      "Symptoms can include {{c1::intrusive memories}}.",
    ]);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.map((suggestion) => suggestion.type)).toEqual(expect.arrayContaining(["basic", "cloze"]));
  });
});

describe("parseUserRequestOverrides", () => {
  it("sums per-type counts for multi-type requests", () => {
    const r = parseUserRequestOverrides("Generate 3 flashcards from this note: 1 basic, 1 cloze, and 1 MCQ");
    expect(r.count).toBe(3);
    expect(r.exactCountRequested).toBe(true);
    expect(r.types).toEqual(expect.arrayContaining(["basic", "cloze", "mcq"]));
    expect(r.types).toHaveLength(3);
  });

  it("sums counts when only per-type counts are given", () => {
    const r = parseUserRequestOverrides("1 basic and 1 cloze");
    expect(r.count).toBe(2);
    expect(r.types).toEqual(expect.arrayContaining(["basic", "cloze"]));
  });

  it("uses standalone count when no per-type counts exist", () => {
    const r = parseUserRequestOverrides("5 flashcards");
    expect(r.count).toBe(5);
    expect(r.exactCountRequested).toBe(true);
  });

  it("takes max of summed per-type and standalone count", () => {
    const r = parseUserRequestOverrides("Generate 5 flashcards: 1 basic, 1 cloze");
    expect(r.count).toBe(5);
  });

  it("handles single type+count correctly", () => {
    const r = parseUserRequestOverrides("3 basic");
    expect(r.count).toBe(3);
    expect(r.types).toEqual(["basic"]);
  });

  it("populates perTypeCounts map", () => {
    const r = parseUserRequestOverrides("2 basic, 3 cloze, 1 mcq");
    expect(r.count).toBe(6);
    expect(r.perTypeCounts?.get("basic")).toBe(2);
    expect(r.perTypeCounts?.get("cloze")).toBe(3);
    expect(r.perTypeCounts?.get("mcq")).toBe(1);
  });

  it("handles a/an/one/single patterns", () => {
    const r = parseUserRequestOverrides("a flashcard");
    expect(r.count).toBe(1);
    expect(r.exactCountRequested).toBe(true);
  });
});
