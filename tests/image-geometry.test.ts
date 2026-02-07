import { describe, it, expect } from "vitest";
import { clampRectPx, normToPxRect, pxToNormRect, rectPxFromPoints } from "../src/imageocclusion/image-geometry";

describe("image geometry", () => {
  it("clamps a rect within bounds", () => {
    const clamped = clampRectPx({ x: -5, y: -2, w: 500, h: 400 }, 200, 100, 1);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
    expect(clamped.w).toBe(200);
    expect(clamped.h).toBe(100);
  });

  it("converts between normalised and pixel rects", () => {
    const px = normToPxRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 200, 100);
    expect(px).toEqual({ x: 20, y: 20, w: 100, h: 25 });

    const norm = pxToNormRect("r1", px, 200, 100, "1");
    expect(norm).toMatchObject({ rectId: "r1", groupKey: "1", x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
  });

  it("builds a rect from two points", () => {
    const rect = rectPxFromPoints({ x: 30, y: 10 }, { x: 10, y: 40 });
    expect(rect).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});
