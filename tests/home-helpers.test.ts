import { describe, it, expect } from "vitest";
import {
  localDayIndex,
  formatCountdownToMidnight,
  scopeFromDeckPath,
  formatDeckLabel,
  formatPinnedDeckLabel,
  getDeckLeafName,
} from "../src/views/home/home-helpers";

// ── localDayIndex ───────────────────────────────────────────────────────────

describe("localDayIndex", () => {
  it("returns the same index for two timestamps on the same UTC day", () => {
    const morning = new Date("2026-04-02T08:00:00Z").getTime();
    const evening = new Date("2026-04-02T20:00:00Z").getTime();
    expect(localDayIndex(morning, "UTC")).toBe(localDayIndex(evening, "UTC"));
  });

  it("returns different indices for timestamps on different UTC days", () => {
    const day1 = new Date("2026-04-01T12:00:00Z").getTime();
    const day2 = new Date("2026-04-02T12:00:00Z").getTime();
    expect(localDayIndex(day1, "UTC")).not.toBe(localDayIndex(day2, "UTC"));
  });

  it("consecutive days differ by 1", () => {
    const day1 = new Date("2026-04-01T12:00:00Z").getTime();
    const day2 = new Date("2026-04-02T12:00:00Z").getTime();
    expect(localDayIndex(day2, "UTC") - localDayIndex(day1, "UTC")).toBe(1);
  });
});

// ── formatCountdownToMidnight ───────────────────────────────────────────────

describe("formatCountdownToMidnight", () => {
  it("returns HH:MM:SS format", () => {
    const result = formatCountdownToMidnight(Date.now());
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("returns a valid countdown at midnight boundary", () => {
    const justBeforeMidnight = new Date();
    justBeforeMidnight.setHours(23, 59, 59, 0);
    const result = formatCountdownToMidnight(justBeforeMidnight.getTime());
    expect(result).toMatch(/^00:00:0[01]$/);
  });
});

// ── scopeFromDeckPath ───────────────────────────────────────────────────────

describe("scopeFromDeckPath", () => {
  it("treats .md path as note scope", () => {
    const scope = scopeFromDeckPath("folder/note.md");
    expect(scope.type).toBe("note");
    expect(scope.key).toBe("folder/note.md");
  });

  it("treats non-.md path as folder scope", () => {
    const scope = scopeFromDeckPath("folder/subfolder");
    expect(scope.type).toBe("folder");
    expect(scope.key).toBe("folder/subfolder");
  });

  it("strips trailing slashes from folder scope key", () => {
    const scope = scopeFromDeckPath("folder/");
    expect(scope.key).toBe("folder");
  });

  it("extracts name from last path segment", () => {
    const scope = scopeFromDeckPath("a/b/c.md");
    expect(scope.name).toBe("c.md");
  });
});

// ── formatDeckLabel ─────────────────────────────────────────────────────────

describe("formatDeckLabel", () => {
  it("returns single-segment label as-is", () => {
    expect(formatDeckLabel("Biology")).toBe("Biology");
  });

  it("shows parent/child for two segments", () => {
    expect(formatDeckLabel("Science/Biology")).toBe("Science / Biology");
  });

  it("shows only last two segments for deep paths", () => {
    expect(formatDeckLabel("A/B/C/D")).toBe("C / D");
  });

  it("strips .md extension", () => {
    expect(formatDeckLabel("folder/note.md")).toBe("folder / note");
  });

  it("returns empty string for empty input", () => {
    expect(formatDeckLabel("")).toBe("");
  });

  it("truncates long labels with ellipsis", () => {
    const long = "A".repeat(50) + "/" + "B".repeat(50);
    const result = formatDeckLabel(long, 36);
    expect(result).toContain("...");
  });
});

// ── formatPinnedDeckLabel ───────────────────────────────────────────────────

describe("formatPinnedDeckLabel", () => {
  it("joins segments with ' / '", () => {
    expect(formatPinnedDeckLabel("a/b/c")).toBe("a / b / c");
  });

  it("strips .md extension", () => {
    expect(formatPinnedDeckLabel("folder/note.md")).toBe("folder / note");
  });
});

// ── getDeckLeafName ─────────────────────────────────────────────────────────

describe("getDeckLeafName", () => {
  it("extracts leaf from path", () => {
    expect(getDeckLeafName("a/b/c")).toBe("c");
  });

  it("strips .md extension", () => {
    expect(getDeckLeafName("folder/note.md")).toBe("note");
  });

  it("returns empty string for empty input", () => {
    expect(getDeckLeafName("")).toBe("");
  });

  it("strips trailing slashes", () => {
    expect(getDeckLeafName("folder/")).toBe("folder");
  });
});
