import { describe, expect, it } from "vitest";
import { buildReadingFlashcardCloze } from "../src/views/reading/reading-flashcard-cloze.ts";
import { buildClozeSectionHTML } from "../src/views/reading/reading-helpers.ts";

describe("reading view flashcard cloze hints", () => {
  it("shows hint text on the hidden side and omits hint syntax on reveal", () => {
    const input = "Mnemonic: {{c1::Psoriatic arthritis::**P**}}.";

    const front = buildReadingFlashcardCloze(input, "front");
    const back = buildReadingFlashcardCloze(input, "back");

    expect(front).toBe('Mnemonic: <span class="learnkit-cloze-hint" style="width:132px">P</span>.');
    expect(back).toBe('Mnemonic: <span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">Psoriatic arthritis</span></span>.');
    expect(back).not.toContain("::");
  });

  it("reveals nested cloze answers without leaving raw nested syntax", () => {
    const input = "Nested {{c3::cloze {{c1::test}}}}";

    const back = buildReadingFlashcardCloze(input, "back");

    expect(back).toContain("Nested");
    expect((back.match(/learnkit-reading-view-cloze/g) ?? []).length).toBe(2);
    expect(back).toContain("cloze <span class=\"learnkit-reading-view-cloze\"><span class=\"learnkit-cloze-text\">test</span></span>");
    expect(back).not.toContain("{{c1::test}}");
  });

  it("preserves nested reading-view cloze spans in section HTML", () => {
    const html = buildClozeSectionHTML("Nested {{c2:: cloze {{c1::test}}}} |");

    expect((html.match(/learnkit-reading-view-cloze/g) ?? []).length).toBe(2);
    expect(html).toContain("cloze <span class=\"learnkit-reading-view-cloze\"><span class=\"learnkit-cloze-text\">test</span></span>");
    expect(html).not.toContain("{{c1::test}}");
  });
});