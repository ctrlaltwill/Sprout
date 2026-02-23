import { describe, it, expect } from "vitest";
import { buildCardBlockPipeMarkdown } from "../src/browser/browser-helpers";
import type { CardRecord } from "../src/core/store";

describe("browser helpers markdown builder", () => {
  it("serializes multi-answer MCQ using A/O markers for all correct options", () => {
    const card: CardRecord = {
      id: "mcq-1",
      type: "mcq",
      title: "Sample",
      stem: "Pick evens",
      options: ["1", "2", "3", "4"],
      correctIndex: 1,
      correctIndices: [1, 3],
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    } as CardRecord;

    const lines = buildCardBlockPipeMarkdown(card.id, card);

    expect(lines).toContain("A | 2 |");
    expect(lines).toContain("A | 4 |");
    expect(lines).toContain("O | 1 |");
    expect(lines).toContain("O | 3 |");
  });

  it("falls back to single correctIndex when correctIndices is absent", () => {
    const card: CardRecord = {
      id: "mcq-2",
      type: "mcq",
      title: null,
      stem: "Pick prime",
      options: ["4", "5"],
      correctIndex: 1,
      correctIndices: null,
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    } as CardRecord;

    const lines = buildCardBlockPipeMarkdown(card.id, card);

    expect(lines).toContain("O | 4 |");
    expect(lines).toContain("A | 5 |");
  });

  it("serializes ordered-question steps with sequential numbering in current order", () => {
    const card: CardRecord = {
      id: "oq-1",
      type: "oq",
      title: "Order flow",
      q: "Arrange in order",
      oqSteps: ["Third", "First", "Second"],
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    } as CardRecord;

    const lines = buildCardBlockPipeMarkdown(card.id, card);

    expect(lines).toContain("1 | Third |");
    expect(lines).toContain("2 | First |");
    expect(lines).toContain("3 | Second |");
  });
});
