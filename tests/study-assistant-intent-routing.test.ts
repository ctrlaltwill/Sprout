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
});