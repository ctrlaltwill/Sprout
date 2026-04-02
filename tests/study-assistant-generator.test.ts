/**
 * @file tests/study-assistant-generator.test.ts
 * @summary Unit tests for study assistant generator.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateStudyAssistantSuggestions } from "../src/platform/integrations/ai/study-assistant-generator";
import type { SproutSettings } from "../src/platform/types/settings";
import { requestStudyAssistantCompletionDetailed } from "../src/platform/integrations/ai/study-assistant-provider";

vi.mock("../src/platform/integrations/ai/study-assistant-provider", () => ({
  requestStudyAssistantCompletionDetailed: vi.fn(),
}));

const mockedCompletion = vi.mocked(requestStudyAssistantCompletionDetailed);

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
    mockedCompletion.mockResolvedValue({
      text: JSON.stringify({ suggestions: [] }),
      conversationId: "fallback",
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
});
