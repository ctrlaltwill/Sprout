import { describe, expect, it } from "vitest";
import {
  buildInlineDiffSegments,
  classifyEditProposalRender,
} from "../src/views/study-assistant/editor/edit-diff-helpers";

describe("buildInlineDiffSegments", () => {
  it("builds delete and insert segments for a short term replacement", () => {
    expect(buildInlineDiffSegments("MI", "myocardial infarction")).toEqual([
      { kind: "delete", text: "MI" },
      { kind: "insert", text: "myocardial infarction" },
    ]);
  });

  it("preserves shared context around a phrase insertion", () => {
    const original = "High specificity for MI, but may be mildly elevated in other ischemic conditions.";
    const replacement = "High specificity for MI, but may be mildly elevated in other ischemic or inflammatory conditions.";

    expect(buildInlineDiffSegments(original, replacement)).toEqual([
      { kind: "equal", text: "High specificity for MI, but may be mildly elevated in other ischemic " },
      { kind: "insert", text: "or inflammatory " },
      { kind: "equal", text: "conditions." },
    ]);
  });
});

describe("classifyEditProposalRender", () => {
  it("uses block compare for structured multiline markdown edits", () => {
    const result = classifyEditProposalRender("- aspirin\n- nitrates", "- aspirin\n- sublingual nitrates");
    expect(result.mode).toBe("block-compare");
  });

  it("uses inline diff for short single-line replacements", () => {
    const result = classifyEditProposalRender("MI", "myocardial infarction");
    expect(result.mode).toBe("inline-diff");
    expect(result.segments).toEqual([
      { kind: "delete", text: "MI" },
      { kind: "insert", text: "myocardial infarction" },
    ]);
  });

  it("uses inline diff for medium single-line edits with shared context", () => {
    const original = "- **Troponin**: High specificity for MI, but may be mildly elevated in other ischemic conditions.";
    const replacement = "- **Troponin**: High specificity for MI, but may be mildly elevated in other ischemic or inflammatory conditions.";

    const result = classifyEditProposalRender(original, replacement);

    expect(result.mode).toBe("inline-diff");
    expect(result.segments?.some(segment => segment.kind === "insert" && segment.text.includes("or inflammatory"))).toBe(true);
  });

  it("uses inline diff for long single-line edits when only a small phrase changes", () => {
    const original = "Troponin rises within hours of myocardial injury and stays elevated long enough to help with diagnosis when the clinical story already points toward acute coronary syndrome.";
    const replacement = "Troponin rises within hours of myocardial injury and often stays elevated long enough to help with diagnosis when the clinical story already points toward acute coronary syndrome.";

    const result = classifyEditProposalRender(original, replacement);

    expect(result.mode).toBe("inline-diff");
    expect(result.segments?.some(segment => segment.kind === "insert" && segment.text.includes("often"))).toBe(true);
  });

  it("uses inline diff for paragraph-style multiline edits when only a few words change", () => {
    const original = "Troponin release starts soon after myocardial injury,\nand serial testing helps confirm the trend in the right clinical context.";
    const replacement = "Troponin release starts soon after myocardial injury,\nand repeat serial testing helps confirm the trend in the right clinical context.";

    const result = classifyEditProposalRender(original, replacement);

    expect(result.mode).toBe("inline-diff");
    expect(result.segments?.some(segment => segment.kind === "insert" && segment.text.includes("repeat"))).toBe(true);
  });

  it("falls back to the full inline preview for long single-line edits", () => {
    const original = "A".repeat(141);
    const replacement = "B".repeat(141);

    expect(classifyEditProposalRender(original, replacement).mode).toBe("full-inline-preview");
  });

  it("falls back to the full inline preview for moderate rewrites with too little shared context", () => {
    const original = "Severe pleuritic pain worsened by inspiration suggests pulmonary embolism in the right context.";
    const replacement = "Urgent bedside decompression is required because this pattern is more consistent with tension pneumothorax.";

    expect(classifyEditProposalRender(original, replacement).mode).toBe("full-inline-preview");
  });

  it("falls back to the full inline preview when there are too many change clusters", () => {
    const original = "Pain is central and crushing with radiation to the arm.";
    const replacement = "Pain is sudden and tearing with radiation to the back.";

    expect(classifyEditProposalRender(original, replacement).mode).toBe("full-inline-preview");
  });
});
