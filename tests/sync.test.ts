// tests/sync.test.ts
// ---------------------------------------------------------------------------
// Tests for the sync engine's pure/exported helpers — formatSyncNotice,
// and the re-exported backup utilities (countObjectKeys, joinPath,
// likelySproutStateKey, extractStatesFromDataJsonObject).
//
// NOTE: syncOneFile and syncQuestionBank depend heavily on the Obsidian
// plugin API (vault, adapter, TFile, etc.), so we test only the
// pure/deterministic functions here — no mocking of the full plugin.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { formatSyncNotice } from "../src/sync/sync-engine";
import {
  countObjectKeys,
  joinPath,
  likelySproutStateKey,
  extractStatesFromDataJsonObject,
  isPlainObject,
} from "../src/sync/backup";

// ── formatSyncNotice ────────────────────────────────────────────────────────

describe("formatSyncNotice", () => {
  it("returns 'no changes' for zero counts", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 0,
      updatedCount: 0,
    });

    expect(result).toBe("Sync complete: no changes.");
  });

  it("shows singular form for 1 new card", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 1,
      updatedCount: 0,
    });

    expect(result).toBe("Sync complete: 1 new card");
  });

  it("shows plural form for multiple new cards", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 5,
      updatedCount: 0,
    });

    expect(result).toBe("Sync complete: 5 new cards");
  });

  it("shows singular form for 1 updated card", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 0,
      updatedCount: 1,
    });

    expect(result).toBe("Sync complete: 1 updated card");
  });

  it("shows plural form for multiple updated cards", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 0,
      updatedCount: 3,
    });

    expect(result).toBe("Sync complete: 3 updated cards");
  });

  it("combines new and updated counts", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 2,
      updatedCount: 4,
    });

    expect(result).toBe("Sync complete: 2 new cards; 4 updated cards");
  });

  it("includes deleted count when option is enabled", () => {
    const result = formatSyncNotice(
      "Sync complete",
      { newCount: 1, updatedCount: 0, removed: 3 },
      { includeDeleted: true },
    );

    expect(result).toBe("Sync complete: 1 new card; 3 cards deleted");
  });

  it("shows singular deleted form", () => {
    const result = formatSyncNotice(
      "Sync complete",
      { newCount: 0, updatedCount: 0, removed: 1 },
      { includeDeleted: true },
    );

    expect(result).toBe("Sync complete: 1 card deleted");
  });

  it("does not include deleted count when option is false", () => {
    const result = formatSyncNotice(
      "Sync complete",
      { newCount: 1, updatedCount: 0, removed: 5 },
      { includeDeleted: false },
    );

    expect(result).toBe("Sync complete: 1 new card");
  });

  it("includes IDs inserted by default", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 0,
      updatedCount: 0,
      idsInserted: 3,
    });

    expect(result).toBe("Sync complete: 3 IDs inserted");
  });

  it("shows singular ID inserted form", () => {
    const result = formatSyncNotice("Sync complete", {
      newCount: 0,
      updatedCount: 0,
      idsInserted: 1,
    });

    expect(result).toBe("Sync complete: 1 ID inserted");
  });

  it("hides IDs inserted when option is disabled", () => {
    const result = formatSyncNotice(
      "Sync complete",
      { newCount: 0, updatedCount: 0, idsInserted: 3 },
      { includeIdsInserted: false },
    );

    expect(result).toBe("Sync complete: no changes.");
  });

  it("combines all parts in a full sync scenario", () => {
    const result = formatSyncNotice(
      "Full sync",
      { newCount: 10, updatedCount: 3, removed: 2, idsInserted: 5 },
      { includeDeleted: true, includeIdsInserted: true },
    );

    expect(result).toBe("Full sync: 10 new cards; 3 updated cards; 2 cards deleted; 5 IDs inserted");
  });

  it("uses the provided prefix string", () => {
    const result = formatSyncNotice("My custom prefix", {
      newCount: 0,
      updatedCount: 0,
    });

    expect(result).toContain("My custom prefix");
  });

  it("handles zero removed and idsInserted with options enabled", () => {
    const result = formatSyncNotice(
      "Sync",
      { newCount: 0, updatedCount: 0, removed: 0, idsInserted: 0 },
      { includeDeleted: true, includeIdsInserted: true },
    );

    expect(result).toBe("Sync: no changes.");
  });
});

// ── countObjectKeys ─────────────────────────────────────────────────────────

describe("countObjectKeys", () => {
  it("counts keys of a plain object", () => {
    expect(countObjectKeys({ a: 1, b: 2, c: 3 })).toBe(3);
  });

  it("returns 0 for an empty object", () => {
    expect(countObjectKeys({})).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(countObjectKeys(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(countObjectKeys(undefined)).toBe(0);
  });

  it("returns 0 for a non-object", () => {
    expect(countObjectKeys("string")).toBe(0);
    expect(countObjectKeys(42)).toBe(0);
    expect(countObjectKeys(true)).toBe(0);
  });

  it("returns 0 for an array (not a plain object)", () => {
    expect(countObjectKeys([1, 2, 3])).toBe(0);
  });
});

// ── isPlainObject ───────────────────────────────────────────────────────────

describe("isPlainObject", () => {
  it("returns true for a plain object", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isPlainObject([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isPlainObject("str")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// ── joinPath ────────────────────────────────────────────────────────────────

describe("joinPath", () => {
  it("joins two simple path segments", () => {
    expect(joinPath("a", "b")).toBe("a/b");
  });

  it("joins multiple segments", () => {
    expect(joinPath(".obsidian", "plugins", "sprout")).toBe(".obsidian/plugins/sprout");
  });

  it("collapses duplicate slashes", () => {
    expect(joinPath("a/", "/b")).toBe("a/b");
    expect(joinPath("a//", "//b//", "//c")).toBe("a/b/c");
  });

  it("handles a single segment", () => {
    expect(joinPath("only")).toBe("only");
  });

  it("ignores empty segments", () => {
    expect(joinPath("a", "", "b")).toBe("a/b");
    expect(joinPath("", "a")).toBe("a");
  });

  it("builds a plugin data.json path correctly", () => {
    expect(joinPath(".obsidian/plugins", "sprout", "data.json")).toBe(
      ".obsidian/plugins/sprout/data.json",
    );
  });
});

// ── likelySproutStateKey ────────────────────────────────────────────────────

describe("likelySproutStateKey", () => {
  it("matches a 9-digit parent key", () => {
    expect(likelySproutStateKey("123456789")).toBe(true);
    expect(likelySproutStateKey("000000001")).toBe(true);
  });

  it("matches a cloze child key (parent::cloze::cN)", () => {
    expect(likelySproutStateKey("123456789::cloze::c1")).toBe(true);
    expect(likelySproutStateKey("999999999::cloze::c12")).toBe(true);
  });

  it("matches other child patterns (parent::*)", () => {
    expect(likelySproutStateKey("123456789::io::rect1")).toBe(true);
    expect(likelySproutStateKey("123456789::group::a")).toBe(true);
  });

  it("rejects keys that are not 9 digits", () => {
    expect(likelySproutStateKey("12345678")).toBe(false); // 8 digits
    expect(likelySproutStateKey("1234567890")).toBe(false); // 10 digits
    expect(likelySproutStateKey("abc")).toBe(false);
    expect(likelySproutStateKey("")).toBe(false);
  });

  it("rejects non-numeric prefixes", () => {
    expect(likelySproutStateKey("abcdefghi")).toBe(false);
    expect(likelySproutStateKey("card-123")).toBe(false);
  });
});

// ── extractStatesFromDataJsonObject ─────────────────────────────────────────

describe("extractStatesFromDataJsonObject", () => {
  it("extracts states from top-level { states: {...} }", () => {
    const obj = {
      states: { "123456789": { stage: "review", due: 1000 } },
      cards: {},
    };

    const result = extractStatesFromDataJsonObject(obj);
    expect(result).toBeDefined();
    expect(result!["123456789"]).toEqual({ stage: "review", due: 1000 });
  });

  it("extracts states nested under { data: { states: {...} } }", () => {
    const obj = {
      data: {
        states: { "111111111": { stage: "new", due: 500 } },
        cards: {},
      },
    };

    const result = extractStatesFromDataJsonObject(obj);
    expect(result).toBeDefined();
    expect(result!["111111111"]).toEqual({ stage: "new", due: 500 });
  });

  it("returns null for null input", () => {
    expect(extractStatesFromDataJsonObject(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractStatesFromDataJsonObject(undefined)).toBeNull();
  });

  it("returns null for empty object (no states)", () => {
    expect(extractStatesFromDataJsonObject({})).toBeNull();
  });

  it("returns null when states is not a plain object", () => {
    expect(extractStatesFromDataJsonObject({ states: "not-an-object" })).toBeNull();
    expect(extractStatesFromDataJsonObject({ states: [1, 2, 3] })).toBeNull();
    expect(extractStatesFromDataJsonObject({ states: null })).toBeNull();
  });

  it("prefers data.states over top-level states when data is a plain object", () => {
    const obj = {
      data: {
        states: { "111111111": { stage: "review", due: 1700000000000, reps: 5 } },
      },
      states: { "222222222": { stage: "new", due: 1700000000000, reps: 0 } },
    };

    const result = extractStatesFromDataJsonObject(obj);
    // The function checks `obj.data` first, so nested should win
    expect(result).toBeDefined();
    expect(result!["111111111"]).toEqual({ stage: "review", due: 1700000000000, reps: 5 });
    expect(result!["222222222"]).toBeUndefined(); // top-level states should be ignored
  });

  it("handles a realistic data.json structure", () => {
    const obj = {
      version: 10,
      data: {
        version: 10,
        cards: {
          "111111111": { id: "111111111", type: "basic", title: "Test" },
          "222222222": { id: "222222222", type: "cloze", title: "Cloze" },
        },
        states: {
          "111111111": { id: "111111111", stage: "review", due: 1700000000000, reps: 5 },
          "222222222": { id: "222222222", stage: "new", due: 1700000000000, reps: 0 },
        },
        reviewLog: [],
        quarantine: {},
        io: {},
      },
    };

    const result = extractStatesFromDataJsonObject(obj);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toHaveLength(2);
    expect(result!["111111111"].stage).toBe("review");
    expect(result!["222222222"].stage).toBe("new");
  });
});
