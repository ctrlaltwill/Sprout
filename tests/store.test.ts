// tests/store.test.ts
// ---------------------------------------------------------------------------
// Tests for the data store's pure/static helpers — defaultStore shape,
// and the deepMerge utility that drives settings loading.
//
// Note: JsonStore itself depends on the Obsidian plugin API, so we test only
// the exported pure functions here (no mocking needed).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { defaultStore } from "../src/core/store";
import { deepMerge } from "../src/core/constants";

// ── defaultStore ────────────────────────────────────────────────────────────

describe("defaultStore", () => {
  it("returns a valid StoreData shape", () => {
    const store = defaultStore();

    expect(store.version).toBe(10);
    expect(store.cards).toEqual({});
    expect(store.states).toEqual({});
    expect(store.reviewLog).toEqual([]);
    expect(store.quarantine).toEqual({});
    expect(store.io).toEqual({});
  });

  it("includes an analytics object with correct shape", () => {
    const store = defaultStore();

    expect(store.analytics).toBeDefined();
    expect(store.analytics.version).toBe(1);
    expect(store.analytics.seq).toBe(0);
    expect(store.analytics.events).toEqual([]);
  });

  it("returns a fresh object each call (no shared references)", () => {
    const a = defaultStore();
    const b = defaultStore();

    expect(a).not.toBe(b);
    expect(a.cards).not.toBe(b.cards);
    expect(a.analytics).not.toBe(b.analytics);

    // Mutating one should not affect the other
    a.cards["test"] = {} as any;
    expect(b.cards["test"]).toBeUndefined();
  });
});

// ── deepMerge ───────────────────────────────────────────────────────────────

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const target = { a: 1, b: 2 };
    const result = deepMerge(target, { b: 3, c: 4 } as any);

    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deep merges nested objects", () => {
    const target = { scheduler: { retention: 0.9, steps: [1, 10] } };
    const result = deepMerge(target, { scheduler: { retention: 0.85 } } as any);

    expect(result.scheduler.retention).toBe(0.85);
    expect(result.scheduler.steps).toEqual([1, 10]); // preserved
  });

  it("does not mutate the original target", () => {
    const target = { a: 1, nested: { x: 10 } };
    const result = deepMerge(target, { nested: { y: 20 } } as any);

    expect(target.nested).toEqual({ x: 10 }); // unchanged
    expect(result.nested).toEqual({ x: 10, y: 20 });
  });

  it("replaces arrays (does not merge them)", () => {
    const target = { items: [1, 2, 3] };
    const result = deepMerge(target, { items: [4, 5] });

    expect(result.items).toEqual([4, 5]);
  });

  it("handles empty source gracefully", () => {
    const target = { a: 1 };
    const result = deepMerge(target, {} as any);

    expect(result).toEqual({ a: 1 });
  });
});
