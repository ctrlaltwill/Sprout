import { describe, it, expect } from "vitest";
import { mergeQueueOnSync } from "../src/views/widget/core/widget-helpers";

type MinCard = { id: string; type: string; [k: string]: unknown };

function card(id: string): MinCard {
  return { id, type: "basic", title: null, sourceNotePath: "note.md", sourceStartLine: 1 } as MinCard;
}

describe("mergeQueueOnSync", () => {
  it("preserves completed prefix and current card", () => {
    const prev = [card("a"), card("b"), card("c")];
    const rebuilt = [card("a"), card("b"), card("c"), card("d")];
    // index 2 means a,b completed; c is current
    const result = mergeQueueOnSync(prev as any, 2, rebuilt as any);
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.index).toBe(2);
  });

  it("removes duplicates of completed cards from rebuilt queue", () => {
    const prev = [card("a"), card("b"), card("c")];
    const rebuilt = [card("a"), card("b"), card("c"), card("d")];
    const result = mergeQueueOnSync(prev as any, 1, rebuilt as any);
    // a completed, b current, c and d upcoming (no duplicate a or b)
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.index).toBe(1);
  });

  it("handles empty rebuilt queue — only completed + current remain", () => {
    const prev = [card("a"), card("b"), card("c")];
    const result = mergeQueueOnSync(prev as any, 1, []);
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.index).toBe(1);
  });

  it("handles index at 0 (no completed cards, first card is current)", () => {
    const prev = [card("a"), card("b")];
    const rebuilt = [card("a"), card("b"), card("c")];
    const result = mergeQueueOnSync(prev as any, 0, rebuilt as any);
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.index).toBe(0);
  });

  it("handles index past end of queue (all completed)", () => {
    const prev = [card("a"), card("b")];
    const rebuilt = [card("a"), card("b"), card("c")];
    const result = mergeQueueOnSync(prev as any, 2, rebuilt as any);
    // index clamped to queue length; no current card
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.index).toBe(2);
  });

  it("handles empty previous queue", () => {
    const rebuilt = [card("a"), card("b")];
    const result = mergeQueueOnSync([] as any, 0, rebuilt as any);
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.index).toBe(0);
  });

  it("deduplicates current card from rebuilt queue", () => {
    const prev = [card("a"), card("b")];
    // b is current (index 1), rebuilt also includes b
    const rebuilt = [card("b"), card("c")];
    const result = mergeQueueOnSync(prev as any, 1, rebuilt as any);
    expect(result.queue.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("clamps index to merged queue length", () => {
    const prev = [card("a"), card("b"), card("c")];
    // rebuilt returns nothing new, and all 3 were completed
    const result = mergeQueueOnSync(prev as any, 3, []);
    expect(result.index).toBeLessThanOrEqual(result.queue.length);
  });
});
