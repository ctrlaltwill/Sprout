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
