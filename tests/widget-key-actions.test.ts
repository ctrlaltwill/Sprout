import { describe, it, expect } from "vitest";
import { resolveWidgetKeyAction, type WidgetKeyContext } from "../src/views/widget/core/widget-helpers";

function ctx(overrides: Partial<WidgetKeyContext> = {}): WidgetKeyContext {
  return {
    key: "",
    isCtrl: false,
    mode: "session",
    hasSession: true,
    hasCard: true,
    isPractice: false,
    isGraded: false,
    showingAnswer: false,
    cardType: "basic",
    ...overrides,
  };
}

describe("resolveWidgetKeyAction", () => {
  // ── Summary mode ──────────────────────────────────────────────────
  it("returns start-session on Enter in summary mode", () => {
    expect(resolveWidgetKeyAction(ctx({ mode: "summary", key: "enter" }))).toBe("start-session");
  });

  it("ignores non-Enter keys in summary mode", () => {
    expect(resolveWidgetKeyAction(ctx({ mode: "summary", key: "e" }))).toBeNull();
  });

  it("ignores Ctrl+Enter in summary mode", () => {
    expect(resolveWidgetKeyAction(ctx({ mode: "summary", key: "enter", isCtrl: true }))).toBeNull();
  });

  // ── Session — guard conditions ────────────────────────────────────
  it("returns null when there is no session", () => {
    expect(resolveWidgetKeyAction(ctx({ hasSession: false, key: "e" }))).toBeNull();
  });

  it("returns null when there is no card", () => {
    expect(resolveWidgetKeyAction(ctx({ hasCard: false, key: "e" }))).toBeNull();
  });

  // ── Session — single-key actions ─────────────────────────────────
  it("e → edit", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "e" }))).toBe("edit");
  });

  it("m → more-menu", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "m" }))).toBe("more-menu");
  });

  it("t → study-view", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "t" }))).toBe("study-view");
  });

  it("b → bury (not in practice)", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "b" }))).toBe("bury");
  });

  it("b → null in practice mode", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "b", isPractice: true }))).toBeNull();
  });

  it("s → suspend (not in practice)", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "s" }))).toBe("suspend");
  });

  it("s → null in practice mode", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "s", isPractice: true }))).toBeNull();
  });

  it("u → undo (not in practice)", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "u" }))).toBe("undo");
  });

  it("u → null in practice mode", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "u", isPractice: true }))).toBeNull();
  });

  // ── Session — flip/next on basic card ─────────────────────────────
  it("Enter flips a basic card when answer is hidden", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter" }))).toBe("flip");
  });

  it("Enter advances when answer is shown", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", showingAnswer: true }))).toBe("next");
  });

  it("Space flips", () => {
    expect(resolveWidgetKeyAction(ctx({ key: " " }))).toBe("flip");
  });

  it("ArrowRight flips", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "arrowright" }))).toBe("flip");
  });

  // ── Session — flip/next on cloze card ─────────────────────────────
  it("Enter flips a cloze card", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "cloze-child" }))).toBe("flip");
  });

  it("Enter advances a cloze card when answer shown", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "cloze-child", showingAnswer: true }))).toBe("next");
  });

  // ── Session — MCQ cards ───────────────────────────────────────────
  it("Enter on MCQ after grading → next", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "mcq", isGraded: true }))).toBe("next");
  });

  it("Enter on MCQ before grading → null (handled separately)", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "mcq", isGraded: false }))).toBeNull();
  });

  // ── Session — number keys for grading ─────────────────────────────
  it("1 grades again when answer is shown and not yet graded", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "1", showingAnswer: true }))).toBe("grade-again");
  });

  it("2 grades hard", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "2", showingAnswer: true }))).toBe("grade-hard");
  });

  it("3 grades good", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "3", showingAnswer: true }))).toBe("grade-good");
  });

  it("4 grades easy", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "4", showingAnswer: true }))).toBe("grade-easy");
  });

  it("number keys ignored when answer is not shown", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "1" }))).toBeNull();
  });

  it("number keys ignored in practice mode", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "1", showingAnswer: true, isPractice: true }))).toBeNull();
  });

  it("number keys ignored when already graded", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "1", showingAnswer: true, isGraded: true }))).toBeNull();
  });

  // ── Session — IO card flip/next ───────────────────────────────────
  it("Enter flips IO card", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "io-child" }))).toBe("flip");
  });

  it("Enter advances IO card when answer shown", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "io-child", showingAnswer: true }))).toBe("next");
  });

  it("Enter flips hotspot card", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "hq-child" }))).toBe("flip");
  });

  it("Enter advances hotspot card when answer shown", () => {
    expect(resolveWidgetKeyAction(ctx({ key: "enter", cardType: "hq-child", showingAnswer: true }))).toBe("next");
  });
});
