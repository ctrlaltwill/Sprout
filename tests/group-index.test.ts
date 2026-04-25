import { describe, expect, it } from "vitest";
import { GroupIndex, normalizeGroupPath } from "../src/engine/indexing/group-index";
import { normalizeGroups } from "../src/engine/indexing/group-format";
import type { CardRecord } from "../src/platform/core/store";

describe("group index hierarchy", () => {
  it("treats :: and / as the same parent-child separator", () => {
    const cards = [
      {
        id: "1",
        type: "basic",
        groups: ["A/B"],
        sourceNotePath: "one.md",
        sourceStartLine: 1,
      },
      {
        id: "2",
        type: "basic",
        groups: ["A::C"],
        sourceNotePath: "two.md",
        sourceStartLine: 1,
      },
    ] as CardRecord[];

    const index = new GroupIndex().build(cards);

    expect(normalizeGroupPath("A::C")).toBe("A/C");
    expect(index.getAllGroups()).toEqual(["A", "A/B", "A/C"]);
    expect(Array.from(index.getIds("A")).sort()).toEqual(["1", "2"]);
    expect(Array.from(index.getIds("A/B"))).toEqual(["1"]);
    expect(Array.from(index.getIds("A::C"))).toEqual(["2"]);
  });

  it("deduplicates case-insensitively while keeping the most common casing", () => {
    expect(normalizeGroups(["AnKing", "anking", "AnKing", "Anking"])).toEqual(["AnKing"]);
    expect(normalizeGroups(["Emergency Medicine", "Emergency medicine", "Emergency Medicine"])).toEqual([
      "Emergency Medicine",
    ]);
  });

  it("uses the most common casing for indexed group labels", () => {
    const cards = [
      {
        id: "1",
        type: "basic",
        groups: ["AnKing", "Emergency Medicine"],
        sourceNotePath: "one.md",
        sourceStartLine: 1,
      },
      {
        id: "2",
        type: "basic",
        groups: ["anking", "Emergency Medicine"],
        sourceNotePath: "two.md",
        sourceStartLine: 1,
      },
      {
        id: "3",
        type: "basic",
        groups: ["AnKing", "Emergency medicine"],
        sourceNotePath: "three.md",
        sourceStartLine: 1,
      },
      {
        id: "4",
        type: "basic",
        groups: ["Anking"],
        sourceNotePath: "four.md",
        sourceStartLine: 1,
      },
    ] as CardRecord[];

    const index = new GroupIndex().build(cards);

    expect(index.getAllGroups()).toEqual(["AnKing", "Emergency Medicine"]);
  });
});