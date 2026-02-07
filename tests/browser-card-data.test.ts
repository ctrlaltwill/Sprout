import { describe, it, expect } from "vitest";
import { applyValueToCard } from "../src/browser/browser-card-data";
import type { CardRecord } from "../src/core/store";

describe("browser card data", () => {
  it("applies edits without mutating original", () => {
    const original: CardRecord = {
      id: "1",
      type: "basic",
      title: "Title",
      q: "Old Q",
      a: "Old A",
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    };

    const updated = applyValueToCard(original, "question", "New Q");
    expect(updated.q).toBe("New Q");
    expect(original.q).toBe("Old Q");
  });

  it("applies MCQ answer edits", () => {
    const original: CardRecord = {
      id: "2",
      type: "mcq",
      title: null,
      stem: "Stem",
      options: ["A", "B"],
      correctIndex: 0,
      q: null,
      a: null,
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    } as CardRecord;

    const updated = applyValueToCard(original, "answer", "Option 1 | **Option 2** | Option 3");
    expect(updated.options).toEqual(["Option 1", "Option 2", "Option 3"]);
    expect(updated.correctIndex).toBe(1);
  });

  it("parses group edits", () => {
    const original: CardRecord = {
      id: "3",
      type: "basic",
      title: null,
      q: "Q",
      a: "A",
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    };

    const updated = applyValueToCard(original, "groups", "math/algebra, science");
    expect(updated.groups).toEqual(["Math/Algebra", "Science"]);
  });
});
