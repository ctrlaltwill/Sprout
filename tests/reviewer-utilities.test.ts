import { describe, it, expect } from "vitest";
import { deepClone, clampInt } from "../src/views/reviewer/utilities";

describe("deepClone", () => {
  it("deeply clones an object", () => {
    const obj = { a: 1, b: { c: [2, 3] } };
    const clone = deepClone(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.b).not.toBe(obj.b);
    expect(clone.b.c).not.toBe(obj.b.c);
  });

  it("clones arrays", () => {
    const arr = [1, [2, 3]];
    const clone = deepClone(arr);
    expect(clone).toEqual(arr);
    expect(clone).not.toBe(arr);
  });

  it("handles primitives", () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone("hello")).toBe("hello");
    expect(deepClone(null)).toBe(null);
  });
});

describe("clampInt", () => {
  it("floors and clamps within range", () => {
    expect(clampInt(5.9, 0, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clampInt(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clampInt(15, 0, 10)).toBe(10);
  });

  it("returns lo for NaN", () => {
    expect(clampInt(NaN, 0, 10)).toBe(0);
  });

  it("returns lo for non-numeric string", () => {
    expect(clampInt("abc", 0, 10)).toBe(0);
  });

  it("handles exact boundary values", () => {
    expect(clampInt(0, 0, 10)).toBe(0);
    expect(clampInt(10, 0, 10)).toBe(10);
  });
});
