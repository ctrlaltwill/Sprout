// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { processClozeForMath } from "../src/platform/core/shared-utils";
import { hydrateRenderedMathCloze } from "../src/views/reviewer/question-cloze";

describe("hydrateRenderedMathCloze", () => {
  it("hydrates a typed input for clozes outside math blocks", () => {
    const text = "Delta ratio = $( \\text{Anion Gap} - 12 ) / ( 24 - \\text{HCO}_3^- )$. Value <0.4 indicates {{c1::normal anion gap metabolic acidosis (NAGMA)::NAGMA}}.";
    const container = document.createElement("div");

    container.innerHTML = processClozeForMath(text, false, 1, {
      blankClassName: "learnkit-cloze-blank hidden-cloze",
      useHintText: false,
    });

    hydrateRenderedMathCloze(container, text, false, 1, {
      mode: "typed",
      typedAnswers: new Map(),
    });

    const input = container.querySelector<HTMLInputElement>(".learnkit-cloze-typed-input");
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe("NAGMA");
  });

  it("does not hydrate typed inputs for clozes inside math blocks", () => {
    const text = "$$x = {{c1::\\frac{-b}{2a}}}$$";
    const container = document.createElement("div");

    container.innerHTML = processClozeForMath(text, false, 1, {
      blankClassName: "learnkit-cloze-blank hidden-cloze",
      useHintText: false,
    });

    hydrateRenderedMathCloze(container, text, false, 1, {
      mode: "typed",
      typedAnswers: new Map(),
    });

    expect(container.querySelector(".learnkit-cloze-typed-input")).toBeNull();
    expect(container.innerHTML).toContain("\\underline{\\phantom");
  });
});