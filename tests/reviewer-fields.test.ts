/**
 * @file tests/reviewer-fields.test.ts
 * @summary Unit tests for reviewer fields.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, it, expect } from "vitest";
import {
  escapePipes,
  splitUnescapedPipes,
  parseMcqOptionsFromCell,
  validateClozeText,
  buildQuestionFor,
  buildAnswerOrOptionsFor,
} from "../src/views/reviewer/fields";
import { getCorrectIndices, isMultiAnswerMcq } from "../src/platform/types/card";
import type { CardRecord } from "../src/platform/core/store";

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

  it("parses multi-answer MCQ with multiple bold options", () => {
    const parsed = parseMcqOptionsFromCell("**Red** | Green | **Blue** | Purple");
    expect(parsed.options).toEqual(["Red", "Green", "Blue", "Purple"]);
    expect(parsed.correctIndex).toBe(0);
    expect(parsed.correctIndices).toEqual([0, 2]);
  });

  it("throws when MCQ has no correct option", () => {
    expect(() => parseMcqOptionsFromCell("A | B")).toThrow();
  });

  it("validates cloze text", () => {
    expect(() => validateClozeText("{{c1::ok}}")).not.toThrow();
    expect(() => validateClozeText("No cloze here")).toThrow();
    expect(() => validateClozeText("{{c0::ok}}")) .not.toThrow();
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

  it("builds answer string for multi-answer MCQ", () => {
    const mcqMulti: CardRecord = {
      id: "3",
      type: "mcq",
      title: null,
      stem: "Pick evens",
      options: ["One", "Two", "Three", "Four"],
      correctIndex: 1,
      correctIndices: [1, 3],
      q: null,
      a: null,
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    } as CardRecord;

    expect(buildAnswerOrOptionsFor(mcqMulti)).toBe("One | **Two** | Three | **Four**");
  });

  it("infers correct indices from object-style options when index fields are missing", () => {
    const legacyLike = {
      options: [
        { text: "A", isCorrect: false },
        { text: "B", isCorrect: true },
        { text: "C", isCorrect: true },
      ],
      correctIndex: null,
      correctIndices: null,
    };

    expect(getCorrectIndices(legacyLike)).toEqual([1, 2]);
    expect(isMultiAnswerMcq(legacyLike)).toBe(true);
  });
});
