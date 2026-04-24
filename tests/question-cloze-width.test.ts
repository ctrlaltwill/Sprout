// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderClozeFront } from "../src/views/reviewer/question-cloze";

describe("renderClozeFront cloze widths", () => {
  it("sizes typed cloze inputs from answer length even when hints are single letters", async () => {
    const rendered = renderClozeFront(
      "Short {{c1::renal::R}} and long {{c2::hyperalimentation::H}}.",
      false,
      null,
      { mode: "typed", typedAnswers: new Map() },
    );

    document.body.appendChild(rendered);
    const inputs = Array.from(rendered.querySelectorAll<HTMLInputElement>(".learnkit-cloze-typed-input"));

    expect(inputs).toHaveLength(2);
    expect(inputs[0].style.width).not.toBe(inputs[1].style.width);
  });

  it("keeps hinted standard clozes width-scaled to the answer", async () => {
    const rendered = renderClozeFront(
      "Short {{c1::renal::R}} and long {{c2::hyperalimentation::H}}.",
      false,
      null,
    );

    document.body.appendChild(rendered);
    const hints = Array.from(rendered.querySelectorAll<HTMLElement>(".learnkit-cloze-hint"));

    expect(hints).toHaveLength(2);
    expect(hints[0].style.width).not.toBe(hints[1].style.width);
  });
});