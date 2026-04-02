import { describe, it, expect } from "vitest";
import { typeLabel, stageLabel } from "../src/views/reviewer/labels";
import { formatCountdown } from "../src/views/reviewer/timers";

// ── typeLabel ───────────────────────────────────────────────────────────────

describe("typeLabel", () => {
  it("maps basic", () => expect(typeLabel("basic")).toBe("Basic"));
  it("maps reversed", () => expect(typeLabel("reversed")).toBe("Basic (Reversed)"));
  it("maps reversed-child", () => expect(typeLabel("reversed-child")).toBe("Basic (Reversed)"));
  it("maps mcq", () => expect(typeLabel("mcq")).toBe("Multiple choice"));
  it("maps cloze", () => expect(typeLabel("cloze")).toBe("Cloze"));
  it("maps cloze-child", () => expect(typeLabel("cloze-child")).toBe("Cloze"));
  it("maps io-child", () => expect(typeLabel("io-child")).toBe("Image occlusion"));
  it("maps oq", () => expect(typeLabel("oq")).toBe("Ordered question"));
  it("passes through unknown type", () => expect(typeLabel("custom")).toBe("custom"));
});

// ── stageLabel ──────────────────────────────────────────────────────────────

describe("stageLabel", () => {
  it("maps new", () => expect(stageLabel("new")).toBe("New"));
  it("maps learning", () => expect(stageLabel("learning")).toBe("Learning"));
  it("maps relearning", () => expect(stageLabel("relearning")).toBe("Relearning"));
  it("maps review", () => expect(stageLabel("review")).toBe("Review"));
  it("maps suspended", () => expect(stageLabel("suspended")).toBe("Suspended"));
  it("passes through unknown stage", () => expect(stageLabel("custom")).toBe("custom"));
});

// ── formatCountdown ────────────────────────────────────────────────────────

describe("formatCountdown", () => {
  it("formats seconds", () => {
    expect(formatCountdown(30_000)).toBe("30 secs");
  });

  it("singular second", () => {
    expect(formatCountdown(1_000)).toBe("1 sec");
  });

  it("formats minutes", () => {
    expect(formatCountdown(5 * 60_000)).toBe("5 mins");
  });

  it("singular minute", () => {
    expect(formatCountdown(60_000)).toBe("1 min");
  });

  it("formats hours", () => {
    expect(formatCountdown(2 * 3600_000)).toBe("2 hours");
  });

  it("singular hour", () => {
    expect(formatCountdown(3600_000)).toBe("1 hour");
  });

  it("formats days", () => {
    expect(formatCountdown(3 * 86400_000)).toBe("3 days");
  });

  it("singular day", () => {
    expect(formatCountdown(86400_000)).toBe("1 day");
  });

  it("zero ms returns 0 secs", () => {
    expect(formatCountdown(0)).toBe("0 secs");
  });

  it("negative ms clamps to 0 secs", () => {
    expect(formatCountdown(-5000)).toBe("0 secs");
  });
});
