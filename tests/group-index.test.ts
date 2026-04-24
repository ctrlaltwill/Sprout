import { describe, expect, it } from "vitest";
import { GroupIndex, normalizeGroupPath } from "../src/engine/indexing/group-index";
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
});