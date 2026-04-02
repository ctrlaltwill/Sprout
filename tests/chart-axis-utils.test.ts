import { describe, it, expect } from "vitest";
import {
  createYAxisTicks,
  createXAxisTicks,
  formatAxisLabel,
} from "../src/views/analytics/chart-axis-utils";

describe("createYAxisTicks", () => {
  it("returns [0, 50, 100] for zero", () => {
    expect(createYAxisTicks(0)).toEqual([0, 50, 100]);
  });

  it("rounds up to nearest 100", () => {
    expect(createYAxisTicks(250)).toEqual([0, 150, 300]);
  });

  it("handles exact 100 boundary", () => {
    expect(createYAxisTicks(100)).toEqual([0, 50, 100]);
  });

  it("handles very large values", () => {
    const ticks = createYAxisTicks(9999);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(10000);
  });

  it("handles negative values (clamps to 100 min)", () => {
    expect(createYAxisTicks(-50)).toEqual([0, 50, 100]);
  });

  it("returns no duplicate ticks", () => {
    const ticks = createYAxisTicks(0);
    const unique = [...new Set(ticks)];
    expect(ticks).toEqual(unique);
  });
});

describe("createXAxisTicks", () => {
  it("includes start, end, mid, and today when today is in range", () => {
    const ticks = createXAxisTicks(0, 10, 5);
    expect(ticks).toContain(0);
    expect(ticks).toContain(10);
    expect(ticks).toContain(5);
  });

  it("excludes today when outside range", () => {
    const ticks = createXAxisTicks(0, 10, 20);
    expect(ticks).not.toContain(20);
  });

  it("returns sorted ticks", () => {
    const ticks = createXAxisTicks(0, 100, 50);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("handles today at start boundary", () => {
    const ticks = createXAxisTicks(5, 15, 5);
    expect(ticks).toContain(5);
  });

  it("handles today at end boundary", () => {
    const ticks = createXAxisTicks(5, 15, 15);
    expect(ticks).toContain(15);
  });

  it("deduplicates when mid equals start or end", () => {
    const ticks = createXAxisTicks(0, 1, 0);
    const unique = [...new Set(ticks)];
    expect(ticks.length).toBe(unique.length);
  });
});

describe("formatAxisLabel", () => {
  const formatter = (dayIndex: number) => `Day ${dayIndex}`;

  it('returns "Today" for the current day index', () => {
    expect(formatAxisLabel(5, 5, formatter)).toBe("Today");
  });

  it("delegates to formatter for non-today index", () => {
    expect(formatAxisLabel(3, 5, formatter)).toBe("Day 3");
  });
});
