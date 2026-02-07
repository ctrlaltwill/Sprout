import { describe, it, expect } from "vitest";
import {
  escapePipes,
  splitUnescapedPipes,
  parseMcqOptionsFromCell,
  validateClozeText,
  buildQuestionFor,
  buildAnswerOrOptionsFor,
} from "../src/reviewer/fields";
import type { CardRecord } from "../src/core/store";

describe("reviewer fields utilities", () => {
  it("escapes pipes and backslashes", () => {
    expect(escapePipes("a|b\\c")).toBe("a\\|b\\\\c");
  });

  it("splits on unescaped pipes", () => {
    expect(splitUnescapedPipes("A\\|B|C")).toEqual(["A|B", "C"]);
  });

  it("parses MCQ options and correct index", () => {
    const parsed = parseMcqOptionsFromCell("**Correct** | Wrong");
    expect(parsed.options).toEqual(["Correct", "Wrong"]);
    expect(parsed.correctIndex).toBe(0);
  });

  it("throws when MCQ has no correct option", () => {
    expect(() => parseMcqOptionsFromCell("A | B")).toThrow();
  });

  it("validates cloze text", () => {
    expect(() => validateClozeText("{{c1::ok}}")).not.toThrow();
    expect(() => validateClozeText("No cloze here")).toThrow();
  });

  it("builds question and answer strings", () => {
    const basic: CardRecord = {
      id: "1",
      type: "basic",
      title: null,
      q: "Q",
      a: "A",
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    };

    const mcq: CardRecord = {
      id: "2",
      type: "mcq",
      title: null,
      stem: "Stem",
      options: ["One", "Two"],
      correctIndex: 1,
      q: null,
      a: null,
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    } as CardRecord;

    expect(buildQuestionFor(basic)).toBe("Q");
    expect(buildAnswerOrOptionsFor(basic)).toBe("A");
    expect(buildQuestionFor(mcq)).toBe("Stem");
    expect(buildAnswerOrOptionsFor(mcq)).toBe("One | **Two**");
  });
});
