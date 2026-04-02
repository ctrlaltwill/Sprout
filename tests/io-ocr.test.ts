/**
 * @file tests/io-ocr.test.ts
 * @summary Unit tests for io ocr.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { __test } from "../src/platform/image-occlusion/io-ocr";

describe("io ocr post-processing", () => {
  it("parses OCR word boxes", () => {
    const word = __test.toPxRectFromWord({
      text: "Label",
      confidence: 91,
      bbox: { x0: 10, y0: 20, x1: 70, y1: 40 },
    });

    expect(word).toMatchObject({ text: "Label", confidence: 91, x: 10, y: 20, w: 60, h: 20 });
  });

  it("groups words into line rectangles", () => {
    const lines = __test.lineMerge([
      { text: "A", confidence: 90, x: 10, y: 10, w: 20, h: 12 },
      { text: "B", confidence: 92, x: 35, y: 11, w: 18, h: 12 },
      { text: "C", confidence: 95, x: 10, y: 40, w: 16, h: 12 },
    ]);

    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ x: 10, y: 10, w: 43, h: 13 });
    expect(lines[1]).toMatchObject({ x: 10, y: 40, w: 16, h: 12 });
  });

  it("merges vertically stacked lines when close", () => {
    const merged = __test.verticalMerge(
      [
        { x: 10, y: 10, w: 80, h: 16 },
        { x: 12, y: 28, w: 76, h: 16 },
      ],
      0.7,
    );

    expect(merged.length).toBe(1);
    expect(merged[0]).toMatchObject({ x: 10, y: 10, w: 80, h: 34 });
  });

  it("computes IoU correctly", () => {
    const val = __test.iou(
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 5, y: 5, w: 10, h: 10 },
    );

    expect(val).toBeCloseTo(25 / 175, 5);
  });

  it("expands OCR mask rectangles with boundary clamping", () => {
    const expanded = __test.expandRect({ x: 5, y: 6, w: 10, h: 8 }, 2, 100, 100);
    expect(expanded).toMatchObject({ x: 3, y: 4, w: 14, h: 12 });

    const clamped = __test.expandRect({ x: 1, y: 1, w: 5, h: 5 }, 4, 8, 8);
    expect(clamped).toMatchObject({ x: 0, y: 0, w: 8, h: 8 });
  });

  it("preprocesses pixels into higher-contrast grayscale", () => {
    const pixels = new Uint8ClampedArray([
      40,
      20,
      20,
      255,
      210,
      220,
      230,
      255,
    ]);

    __test.preprocessRgbaInPlace(pixels);

    expect(pixels[0]).toBe(0);
    expect(pixels[1]).toBe(0);
    expect(pixels[2]).toBe(0);
    expect(pixels[4]).toBe(255);
    expect(pixels[5]).toBe(255);
    expect(pixels[6]).toBe(255);
  });
});
