import { describe, it, expect } from "vitest";
import {
  formatOqFrontForTts,
  formatOqStepsForTts,
  formatOqAnswerForTts,
} from "../src/platform/integrations/tts/tts-service";

describe("formatOqFrontForTts", () => {
  const question = "Put these events in chronological order";
  const steps = ["World War I", "French Revolution", "Moon Landing"];

  it("formats question + steps without numbers", () => {
    const result = formatOqFrontForTts(question, steps);
    expect(result).toBe(
      "Put these events in chronological order. World War I. French Revolution. Moon Landing",
    );
  });

  it("handles empty question", () => {
    const result = formatOqFrontForTts("", steps);
    expect(result).toBe("World War I. French Revolution. Moon Landing");
  });

  it("handles empty steps", () => {
    const result = formatOqFrontForTts(question, []);
    expect(result).toBe("Put these events in chronological order");
  });

  it("handles both empty", () => {
    const result = formatOqFrontForTts("", []);
    expect(result).toBe("");
  });

  it("trims whitespace from steps", () => {
    const result = formatOqFrontForTts(question, ["  Step A  ", "Step B"]);
    expect(result).toBe(
      "Put these events in chronological order. Step A. Step B",
    );
  });

  it("filters out blank steps", () => {
    const result = formatOqFrontForTts(question, ["Step A", "", "  ", "Step B"]);
    expect(result).toBe(
      "Put these events in chronological order. Step A. Step B",
    );
  });

  it("handles single step", () => {
    const result = formatOqFrontForTts(question, ["Only step"]);
    expect(result).toBe("Put these events in chronological order. Only step");
  });
});

describe("formatOqStepsForTts", () => {
  it("joins steps without numbers", () => {
    const result = formatOqStepsForTts(["Alpha", "Beta", "Gamma"]);
    expect(result).toBe("Alpha. Beta. Gamma");
  });

  it("returns empty string for empty array", () => {
    expect(formatOqStepsForTts([])).toBe("");
  });

  it("filters blank entries", () => {
    const result = formatOqStepsForTts(["A", "", "  ", "B"]);
    expect(result).toBe("A. B");
  });
});

describe("formatOqAnswerForTts", () => {
  const steps = ["Step A", "Step B", "Step C"];

  it("announces correct with numbered order", () => {
    const result = formatOqAnswerForTts(steps, true);
    expect(result).toBe("Correct. 1) Step A. 2) Step B. 3) Step C");
  });

  it("announces incorrect with numbered order", () => {
    const result = formatOqAnswerForTts(steps, false);
    expect(result).toBe(
      "Incorrect, the correct order is. 1) Step A. 2) Step B. 3) Step C",
    );
  });

  it("handles single step — correct", () => {
    const result = formatOqAnswerForTts(["Only"], true);
    expect(result).toBe("Correct. 1) Only");
  });

  it("handles single step — incorrect", () => {
    const result = formatOqAnswerForTts(["Only"], false);
    expect(result).toBe("Incorrect, the correct order is. 1) Only");
  });

  it("returns empty for no steps", () => {
    expect(formatOqAnswerForTts([], true)).toBe("");
    expect(formatOqAnswerForTts([], false)).toBe("");
  });

  it("trims whitespace in steps", () => {
    const result = formatOqAnswerForTts(["  X  ", "Y"], true);
    expect(result).toBe("Correct. 1) X. 2) Y");
  });
});
