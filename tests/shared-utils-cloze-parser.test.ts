import { describe, expect, it } from "vitest";

import {
  extractCompatibilityClozeIndices,
  parseClozeTokens,
  validateClozeTextCompat,
} from "../src/platform/core/shared-utils";

describe("parseClozeTokens", () => {
  it("captures hints and occurrence order without changing sparse numbering", () => {
    const result = parseClozeTokens("Alpha {{c1::beta::b}} then {{c3::gamma}} and {{c1::delta}}.");

    expect(result.tokens).toEqual([
      {
        fullMatch: "{{c1::beta::b}}",
        start: 6,
        end: 21,
        clozeIndex: 1,
        rawContent: "beta::b",
        answer: "beta",
        hint: "b",
        occurrence: 1,
      },
      {
        fullMatch: "{{c3::gamma}}",
        start: 27,
        end: 40,
        clozeIndex: 3,
        rawContent: "gamma",
        answer: "gamma",
        hint: null,
        occurrence: 1,
      },
      {
        fullMatch: "{{c1::delta}}",
        start: 45,
        end: 58,
        clozeIndex: 1,
        rawContent: "delta",
        answer: "delta",
        hint: null,
        occurrence: 2,
      },
    ]);
    expect(result.distinctIndices).toEqual([1, 3]);
    expect(result.diagnostics).toContainEqual({
      code: "non-contiguous-numbering",
      message: "Cloze numbering is non-contiguous; compatibility mode preserves only the indices currently present.",
      level: "warning",
    });
  });

  it("parses clozes containing nested braces without treating them as malformed", () => {
    const result = parseClozeTokens("$$x = {{c2::\\frac{-b}{2a}}}$$");

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      clozeIndex: 2,
      answer: "\\frac{-b}{2a}",
      hint: null,
      occurrence: 1,
    });
    expect(result.distinctIndices).toEqual([2]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat nested cloze separators as outer hints", () => {
    const result = parseClozeTokens("Nested {{c3:: cloze {{c1::test}}}}");

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      clozeIndex: 3,
      answer: " cloze {{c1::test}}",
      hint: null,
    });
  });

  it("reports an unclosed token without inventing a parsed child token", () => {
    const result = parseClozeTokens("Broken {{c1::answer");

    expect(result.tokens).toEqual([]);
    expect(result.distinctIndices).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      code: "unclosed-token",
      message: "Cloze token is not closed with }}.",
      level: "error",
      start: 7,
      clozeIndex: 1,
    });
  });
});

describe("extractCompatibilityClozeIndices", () => {
  it("preserves current opener-based index semantics for sparse and malformed text", () => {
    expect(extractCompatibilityClozeIndices("{{c3::gamma}} {{c1::alpha}} {{c3::delta}} {{c2::open"))
      .toEqual([1, 2, 3]);
  });
});

describe("validateClozeTextCompat", () => {
  it("returns compatibility errors without changing current validation wording", () => {
    expect(validateClozeTextCompat("{{c0::ok}} {{c1::   }} plain {{c2::open"))
      .toEqual([
        "Cloze token has invalid number.",
        "Cloze token content is empty.",
      ]);
  });
});