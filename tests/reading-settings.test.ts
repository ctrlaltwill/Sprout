import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/default-settings";

describe("reading settings defaults", () => {
  it("enables reading styles by default", () => {
    expect(DEFAULT_SETTINGS.general.enableReadingStyles).toBe(true);
  });

  it("defaults active reading macro to flashcards", () => {
    expect(DEFAULT_SETTINGS.readingView.activeMacro).toBe("flashcards");
    expect(DEFAULT_SETTINGS.readingView.preset).toBe("flashcards");
  });

  it("defines per-macro field configs", () => {
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.flashcards.fields.question).toBe(true);
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields.title).toBe(true);
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.fields.answer).toBe(true);
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.markdown.fields.edit).toBe(false);
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.custom.fields.edit).toBe(true);
  });

  it("limits colour config to non-flashcard macros", () => {
    expect("colours" in DEFAULT_SETTINGS.readingView.macroConfigs.flashcards).toBe(false);
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.classic.colours.cardAccentLight).toBe("");
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.colours.cardBorderLight).toBe("");
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.markdown.colours.cardBgLight).toBe("");
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.custom.colours.cardBgLight).toBe("");
    expect(DEFAULT_SETTINGS.readingView.macroConfigs.custom.customCss).toBe("");
  });
});
