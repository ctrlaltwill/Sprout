import { describe, expect, it } from "vitest";

import { inferStudyAssistantIntentHeuristically } from "../src/views/study-assistant/chat/intent-routing";

describe("inferStudyAssistantIntentHeuristically", () => {
  it("routes obvious ask prompts without classifier fallback", () => {
    expect(inferStudyAssistantIntentHeuristically({ text: "What does this paragraph mean?" })).toEqual({
      intent: "ask",
      requiresClassifierFallback: false,
    });
  });

  it("routes review prompts directly", () => {
    expect(inferStudyAssistantIntentHeuristically({ text: "Quick review this note" })).toEqual({
      intent: "review",
      requiresClassifierFallback: false,
    });
  });

  it("routes edit prompts directly", () => {
    expect(inferStudyAssistantIntentHeuristically({ text: "Rewrite this paragraph to be clearer" })).toEqual({
      intent: "edit",
      requiresClassifierFallback: false,
    });
  });

  it("routes generate prompts directly", () => {
    expect(inferStudyAssistantIntentHeuristically({ text: "Generate 5 flashcards from this note" })).toEqual({
      intent: "generate",
      requiresClassifierFallback: false,
    });
  });

  it("flags ambiguous edit follow-ups for classifier fallback", () => {
    expect(inferStudyAssistantIntentHeuristically({
      text: "Do it",
      recentMessages: [
        { role: "user", text: "Review this note" },
        { role: "assistant", text: "Main issues: shorten the intro and tighten the summary." },
      ],
    })).toEqual({
      intent: "ask",
      requiresClassifierFallback: true,
    });
  });

  it("flags short pronoun-heavy follow-ups for classifier fallback", () => {
    expect(inferStudyAssistantIntentHeuristically({
      text: "Can you do that?",
      recentMessages: [
        { role: "user", text: "Review this note" },
        { role: "assistant", text: "The explanation is too long and repetitive." },
      ],
    })).toEqual({
      intent: "ask",
      requiresClassifierFallback: true,
    });
  });

  it("routes insert-and-tighten follow-ups as edits even with prior generate context", () => {
    expect(inferStudyAssistantIntentHeuristically({
      text: "Can you edit them into the page? Make key points more concise",
      recentMessages: [
        { role: "user", text: "Can you add in key points and a summary?" },
        { role: "assistant", text: "Summary: ... Key Points: ..." },
      ],
      hasPriorGenerateContext: true,
    })).toEqual({
      intent: "edit",
      requiresClassifierFallback: false,
    });
  });

  it("routes add-it-to-my-note follow-ups directly to edit", () => {
    expect(inferStudyAssistantIntentHeuristically({
      text: "add it to my note",
      recentMessages: [
        { role: "user", text: "Please rewrite the key points." },
        { role: "assistant", text: "Here is a refined rewrite of the key points section." },
      ],
    })).toEqual({
      intent: "edit",
      requiresClassifierFallback: false,
    });
  });

  it("routes bare assent to edit when the assistant just offered a rewrite", () => {
    expect(inferStudyAssistantIntentHeuristically({
      text: "please",
      recentMessages: [
        { role: "user", text: "Can you improve these key points?" },
        { role: "assistant", text: "If you want, I can provide a direct rewrite of the Key Points section." },
      ],
    })).toEqual({
      intent: "edit",
      requiresClassifierFallback: false,
    });
  });

  it("keeps flashcard-specific rephrase follow-ups on generate", () => {
    expect(inferStudyAssistantIntentHeuristically({
      text: "Rephrase the flashcards",
      hasPriorGenerateContext: true,
    })).toEqual({
      intent: "generate",
      requiresClassifierFallback: false,
    });
  });
});