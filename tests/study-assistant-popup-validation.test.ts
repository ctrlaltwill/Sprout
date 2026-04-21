import { describe, expect, it } from "vitest";

import { validateGeneratedCardBlock } from "../src/views/study-assistant/popup/assistant-popup-validation";
import type { StudyAssistantSuggestion } from "../src/platform/integrations/ai/study-assistant-types";

const tx = (_token: string, fallback: string) => fallback;

function buildIoSuggestion(overrides: Partial<StudyAssistantSuggestion> = {}): StudyAssistantSuggestion {
  return {
    type: "io",
    difficulty: 2,
    ioSrc: "![[Arm veins diagram.png]]",
    ioOcclusions: [
      { rectId: "r1", x: 0.18, y: 0.24, w: 0.16, h: 0.05, groupKey: "1", shape: "rect" },
    ],
    ioMaskMode: "solo",
    ioAssessment: {
      imageRef: "Arm veins diagram.png",
      imageKind: "diagram",
      studyValue: "high",
      placementConfidence: 0.93,
      targetLabels: ["basilic vein"],
      usefulnessReason: "Labelled anatomy diagram.",
    },
    rationale: "Tests labelled venous anatomy.",
    sourceOrigin: "note",
    ...overrides,
  };
}

describe("study assistant popup validation", () => {
  it("accepts a high-yield IO card with plausible masks", () => {
    const suggestion = buildIoSuggestion();
    const text = [
      "IO | ![[Arm veins diagram.png]] |",
      `O | ${JSON.stringify(suggestion.ioOcclusions)} |`,
      "C | solo |",
    ].join("\n");

    expect(validateGeneratedCardBlock("Arm.md", suggestion, text, tx)).toBeNull();
  });

  it("rejects IO cards that are not rated high-yield", () => {
    const suggestion = buildIoSuggestion({
      ioAssessment: {
        imageRef: "Arm veins diagram.png",
        imageKind: "photo",
        studyValue: "low",
        placementConfidence: 0.95,
        targetLabels: ["car door"],
        usefulnessReason: "Decorative photo.",
      },
    });
    const text = [
      "IO | ![[Arm veins diagram.png]] |",
      `O | ${JSON.stringify(suggestion.ioOcclusions)} |`,
      "C | solo |",
    ].join("\n");

    expect(validateGeneratedCardBlock("Arm.md", suggestion, text, tx)).toContain("classified as low-yield for IO");
  });

  it("rejects IO cards whose masks are implausibly large", () => {
    const suggestion = buildIoSuggestion({
      ioOcclusions: [
        { rectId: "r1", x: 0.02, y: 0.08, w: 0.82, h: 0.42, groupKey: "1", shape: "rect" },
      ],
    });
    const text = [
      "IO | ![[Arm veins diagram.png]] |",
      `O | ${JSON.stringify(suggestion.ioOcclusions)} |`,
      "C | solo |",
    ].join("\n");

    expect(validateGeneratedCardBlock("Arm.md", suggestion, text, tx)).toContain("too large to plausibly cover a label");
  });
});