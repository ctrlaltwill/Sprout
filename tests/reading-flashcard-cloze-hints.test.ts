import { describe, expect, it } from "vitest";
import { buildReadingFlashcardCloze } from "../src/views/reading/reading-flashcard-cloze.ts";

describe("reading view flashcard cloze hints", () => {
  it("shows hint text on the hidden side and omits hint syntax on reveal", () => {
    const input = "Mnemonic: {{c1::Psoriatic arthritis::**P**}}.";

    const front = buildReadingFlashcardCloze(input, "front");
    const back = buildReadingFlashcardCloze(input, "back");

    expect(front).toBe('Mnemonic: <span class="learnkit-cloze-hint" style="width:132px">P</span>.');
    expect(back).toBe('Mnemonic: <span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">Psoriatic arthritis</span></span>.');
    expect(back).not.toContain("::");
  });
});