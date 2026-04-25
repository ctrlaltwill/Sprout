// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { renderClozeFront } from "../src/views/reviewer/question-cloze";

describe("renderClozeFront nested cloze compatibility", () => {
  it("replaces the full outer token on the front without leaving trailing braces", () => {
    const rendered = renderClozeFront(
      "Nested {{c3:: cloze {{c1::test}}}}",
      false,
      3,
      { mode: "typed", typedAnswers: new Map() },
    );

    expect(rendered.textContent).toContain("Nested");
    expect(rendered.querySelectorAll(".learnkit-cloze-typed-input")).toHaveLength(1);
    expect(rendered.textContent).not.toContain("{{c1::test}}");
    expect(rendered.textContent).not.toContain("}}");
  });

  it("reveals the full outer token content on the back without truncating nested braces", () => {
    const rendered = renderClozeFront(
      "Nested {{c3:: cloze {{c1::test}}}}",
      true,
      3,
      { mode: "standard" },
    );

    expect(rendered.textContent).toContain("Nested");
    expect(rendered.textContent).toContain("cloze test");
    expect(rendered.textContent).not.toContain("{{c1::test}}");
  });

  it("renders a nested inner cloze child instead of exposing the raw nested token", () => {
    const front = renderClozeFront(
      "Nested {{c3::cloze {{c1::test}}}}",
      false,
      1,
      { mode: "typed", typedAnswers: new Map() },
    );
    const back = renderClozeFront(
      "Nested {{c3::cloze {{c1::test}}}}",
      true,
      1,
      { mode: "standard" },
    );

    expect(front.textContent).toContain("Nested");
    expect(front.textContent).toContain("cloze");
    expect(front.querySelectorAll(".learnkit-cloze-typed-input")).toHaveLength(1);
    expect(front.textContent).not.toContain("{{c1::test}}");

    expect(back.textContent).toContain("Nested");
    expect(back.textContent).toContain("cloze test");
    expect(back.textContent).not.toContain("{{c1::test}}");
  });
});