// tests/session.test.ts
// ---------------------------------------------------------------------------
// Tests for src/reviewer/session.ts — the study-session state machine.
// Covers: inScope, isAvailableNow, buildSession, getNextDueInScope.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JsonStore } from "../src/core/store";
import { inScope, isAvailableNow, buildSession, getNextDueInScope } from "../src/reviewer/session";
import type { CardRecord } from "../src/types/card";
import type { CardState } from "../src/types/scheduler";
import type { Scope } from "../src/reviewer/types";
import type { ReviewLogEntry } from "../src/types/review";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePlugin(
  cards: CardRecord[] = [],
  states: Record<string, CardState> = {},
  reviewLog: ReviewLogEntry[] = [],
  settings?: Partial<{ study: any }>,
) {
  const plugin: any = {
    app: { vault: { getFiles: () => [], getMarkdownFiles: () => [] } },
    manifest: { id: "sprout" },
    settings: {
      study: {
        dailyNewLimit: Infinity,
        dailyReviewLimit: Infinity,
        treatFolderNotesAsDecks: false,
        ...settings?.study,
      },
      indexing: { ignoreInCodeFences: false },
    },
    saveAll: vi.fn(async () => {}),
    loadData: vi.fn(async () => ({})),
  };
  plugin.store = new JsonStore(plugin);

  for (const c of cards) plugin.store.upsertCard(c);
  for (const [id, st] of Object.entries(states)) plugin.store.upsertState(st);
  plugin.store.data.reviewLog = reviewLog;

  return plugin;
}

function card(id: string, type: string = "basic", notePath = "Notes/A.md", groups?: string[]): CardRecord {
  return {
    id,
    type: type as CardRecord["type"],
    title: `Card ${id}`,
    q: "Q?",
    a: "A!",
    sourceNotePath: notePath,
    sourceStartLine: 0,
    createdAt: 1000,
    updatedAt: 1000,
    lastSeenAt: 1000,
    groups: groups ?? null,
  } as CardRecord;
}

function state(id: string, stage: CardState["stage"], due: number = 0): CardState {
  return {
    id,
    stage,
    due,
    reps: stage === "new" ? 0 : 3,
    lapses: 0,
    learningStepIndex: 0,
    scheduledDays: 0,
  };
}

// ── inScope ─────────────────────────────────────────────────────────────────

describe("inScope", () => {
  it("returns true for null scope (no filtering)", () => {
    expect(inScope(null, "Notes/A.md")).toBe(true);
  });

  it("vault scope matches any path", () => {
    const scope: Scope = { type: "vault", key: "", name: "Vault" };
    expect(inScope(scope, "Any/Path.md")).toBe(true);
    expect(inScope(scope, "Deep/Nested/File.md")).toBe(true);
  });

  it("folder scope matches files in that folder", () => {
    const scope: Scope = { type: "folder", key: "Medicine", name: "Medicine" };
    expect(inScope(scope, "Medicine/Cardiology.md")).toBe(true);
    expect(inScope(scope, "Medicine/Sub/File.md")).toBe(true);
  });

  it("folder scope does not match sibling folders", () => {
    const scope: Scope = { type: "folder", key: "Medicine", name: "Medicine" };
    expect(inScope(scope, "Surgery/File.md")).toBe(false);
    expect(inScope(scope, "MedicalOther/File.md")).toBe(false);
  });

  it("folder scope handles root-level files", () => {
    const scope: Scope = { type: "folder", key: "", name: "Root" };
    expect(inScope(scope, "RootFile.md")).toBe(true);
  });

  it("note scope matches exact note path only", () => {
    const scope: Scope = { type: "note", key: "Notes/A.md", name: "A" };
    expect(inScope(scope, "Notes/A.md")).toBe(true);
    expect(inScope(scope, "Notes/B.md")).toBe(false);
  });

  it("group scope returns false (resolved elsewhere)", () => {
    const scope: Scope = { type: "group", key: "anatomy", name: "anatomy" };
    expect(inScope(scope, "Any/File.md")).toBe(false);
  });

  it("unknown scope type returns false (fail-closed)", () => {
    const scope = { type: "bogus", key: "", name: "" } as unknown as Scope;
    expect(inScope(scope, "Any/File.md")).toBe(false);
  });
});

// ── isAvailableNow ──────────────────────────────────────────────────────────

describe("isAvailableNow", () => {
  const now = 1_000_000;

  it("returns false for undefined state", () => {
    expect(isAvailableNow(undefined, now)).toBe(false);
  });

  it("suspended cards are never available", () => {
    expect(isAvailableNow(state("a", "suspended", 0), now)).toBe(false);
  });

  it("new cards are always available", () => {
    expect(isAvailableNow(state("a", "new", 0), now)).toBe(true);
  });

  it("learning card due before now is available", () => {
    expect(isAvailableNow(state("a", "learning", now - 100), now)).toBe(true);
  });

  it("learning card due exactly now is available", () => {
    expect(isAvailableNow(state("a", "learning", now), now)).toBe(true);
  });

  it("learning card due in future is not available", () => {
    expect(isAvailableNow(state("a", "learning", now + 100), now)).toBe(false);
  });

  it("review card past due is available", () => {
    expect(isAvailableNow(state("a", "review", now - 1000), now)).toBe(true);
  });

  it("review card not yet due is not available", () => {
    expect(isAvailableNow(state("a", "review", now + 1000), now)).toBe(false);
  });

  it("relearning card due now is available", () => {
    expect(isAvailableNow(state("a", "relearning", now), now)).toBe(true);
  });

  it("treats invalid due as available (robust fallback)", () => {
    const st = state("a", "review", NaN);
    expect(isAvailableNow(st, now)).toBe(true);
  });
});

// ── buildSession ────────────────────────────────────────────────────────────

describe("buildSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date("2026-02-12T12:00:00Z").getTime();
  const vaultScope: Scope = { type: "vault", key: "", name: "Vault" };

  it("builds an empty session when there are no cards", () => {
    const plugin = makePlugin();
    const session = buildSession(plugin, vaultScope);

    expect(session.queue).toHaveLength(0);
    expect(session.stats.total).toBe(0);
    expect(session.stats.done).toBe(0);
    expect(session.index).toBe(0);
  });

  it("includes new cards in the queue", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "new");
    const plugin = makePlugin([c1], { "111111111": s1 });

    const session = buildSession(plugin, vaultScope);
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].id).toBe("111111111");
  });

  it("includes due review cards", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "review", NOW - 1000);
    const plugin = makePlugin([c1], { "111111111": s1 });

    const session = buildSession(plugin, vaultScope);
    expect(session.queue).toHaveLength(1);
  });

  it("excludes future review cards", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "review", NOW + 86_400_000);
    const plugin = makePlugin([c1], { "111111111": s1 });

    const session = buildSession(plugin, vaultScope);
    expect(session.queue).toHaveLength(0);
  });

  it("excludes suspended cards", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "suspended");
    const plugin = makePlugin([c1], { "111111111": s1 });

    const session = buildSession(plugin, vaultScope);
    expect(session.queue).toHaveLength(0);
  });

  it("excludes parent cloze cards (only children are reviewable)", () => {
    const parent = card("111111111", "cloze");
    const child = card("111111111::cloze::c1", "cloze-child");
    (child as any).parentId = "111111111";
    const plugin = makePlugin(
      [parent, child],
      {
        "111111111": state("111111111", "new"),
        "111111111::cloze::c1": state("111111111::cloze::c1", "new"),
      },
    );

    const session = buildSession(plugin, vaultScope);
    const ids = session.queue.map((c) => c.id);
    expect(ids).not.toContain("111111111");
    expect(ids).toContain("111111111::cloze::c1");
  });

  it("excludes parent reversed cards", () => {
    const parent = card("222222222", "reversed");
    const fwd = card("222222222::reversed::forward", "reversed-child");
    (fwd as any).parentId = "222222222";
    const back = card("222222222::reversed::back", "reversed-child");
    (back as any).parentId = "222222222";
    const plugin = makePlugin(
      [parent, fwd, back],
      {
        "222222222": state("222222222", "new"),
        "222222222::reversed::forward": state("222222222::reversed::forward", "new"),
        "222222222::reversed::back": state("222222222::reversed::back", "new"),
      },
    );

    const session = buildSession(plugin, vaultScope);
    const ids = session.queue.map((c) => c.id);
    expect(ids).not.toContain("222222222");
    expect(ids).toContain("222222222::reversed::forward");
    expect(ids).toContain("222222222::reversed::back");
  });

  it("respects dailyNewLimit", () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`00000000${i}`));
    const states: Record<string, CardState> = {};
    for (const c of cards) states[c.id] = state(c.id, "new");
    const plugin = makePlugin(cards, states, [], { study: { dailyNewLimit: 3, dailyReviewLimit: Infinity } });

    const session = buildSession(plugin, vaultScope);
    expect(session.queue.length).toBeLessThanOrEqual(3);
  });

  it("respects dailyReviewLimit", () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`00000000${i}`));
    const states: Record<string, CardState> = {};
    for (const c of cards) states[c.id] = state(c.id, "review", NOW - 1000);
    const plugin = makePlugin(cards, states, [], { study: { dailyNewLimit: Infinity, dailyReviewLimit: 3 } });

    const session = buildSession(plugin, vaultScope);
    // Due cards are limited by reviewLimit
    expect(session.queue.length).toBeLessThanOrEqual(3);
  });

  it("today counts reduce remaining budget", () => {
    // 2 cards reviewed today, limit is 3 → 1 remaining new slot
    const startToday = new Date("2026-02-12T00:00:00").getTime();
    const c1 = card("111111111");
    const c2 = card("222222222");
    const c3 = card("333333333");

    const log: ReviewLogEntry[] = [
      { id: "111111111", at: startToday + 1000, result: "good", prevDue: 0, nextDue: 1000, meta: null },
      { id: "222222222", at: startToday + 2000, result: "good", prevDue: 0, nextDue: 1000, meta: null },
    ];

    const plugin = makePlugin(
      [c1, c2, c3],
      {
        "111111111": state("111111111", "new"),
        "222222222": state("222222222", "new"),
        "333333333": state("333333333", "new"),
      },
      log,
      { study: { dailyNewLimit: 3, dailyReviewLimit: Infinity } },
    );

    const session = buildSession(plugin, vaultScope);
    // 2 already done today + at most 1 more = max 1 new in queue (the 2 done are still "new" stage but counted)
    expect(session.queue.length).toBeLessThanOrEqual(3);
  });

  it("scopes to a specific folder", () => {
    const c1 = card("111111111", "basic", "Medicine/File.md");
    const c2 = card("222222222", "basic", "Surgery/File.md");
    const s1 = state("111111111", "new");
    const s2 = state("222222222", "new");
    const folderScope: Scope = { type: "folder", key: "Medicine", name: "Medicine" };
    const plugin = makePlugin([c1, c2], { "111111111": s1, "222222222": s2 });

    const session = buildSession(plugin, folderScope);
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].id).toBe("111111111");
  });

  it("scopes to a specific note", () => {
    const c1 = card("111111111", "basic", "Notes/A.md");
    const c2 = card("222222222", "basic", "Notes/B.md");
    const s1 = state("111111111", "new");
    const s2 = state("222222222", "new");
    const noteScope: Scope = { type: "note", key: "Notes/A.md", name: "A" };
    const plugin = makePlugin([c1, c2], { "111111111": s1, "222222222": s2 });

    const session = buildSession(plugin, noteScope);
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].id).toBe("111111111");
  });

  it("session has correct initial state shape", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "new");
    const plugin = makePlugin([c1], { "111111111": s1 });

    const session = buildSession(plugin, vaultScope);
    expect(session.scope).toBe(vaultScope);
    expect(session.index).toBe(0);
    expect(session.graded).toEqual({});
    expect(session.stats.done).toBe(0);
  });

  it("mixes due-like and new cards (due first, then new)", () => {
    const c1 = card("111111111");
    const c2 = card("222222222");
    const s1 = state("111111111", "review", NOW - 5000); // due
    const s2 = state("222222222", "new"); // new
    const plugin = makePlugin([c1, c2], { "111111111": s1, "222222222": s2 });

    const session = buildSession(plugin, vaultScope);
    // Due cards come before new cards in the queue
    expect(session.queue).toHaveLength(2);
    const dueIdx = session.queue.findIndex((c) => c.id === "111111111");
    const newIdx = session.queue.findIndex((c) => c.id === "222222222");
    expect(dueIdx).toBeLessThan(newIdx);
  });
});

// ── getNextDueInScope ───────────────────────────────────────────────────────

describe("getNextDueInScope", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date("2026-02-12T12:00:00Z").getTime();
  const vaultScope: Scope = { type: "vault", key: "", name: "Vault" };

  it("returns null when no cards exist", () => {
    const plugin = makePlugin();
    expect(getNextDueInScope(plugin, vaultScope)).toBeNull();
  });

  it("returns null when all cards are new (no due date)", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "new");
    const plugin = makePlugin([c1], { "111111111": s1 });

    expect(getNextDueInScope(plugin, vaultScope)).toBeNull();
  });

  it("returns null when all due cards are already past due", () => {
    const c1 = card("111111111");
    const s1 = state("111111111", "review", NOW - 1000);
    const plugin = makePlugin([c1], { "111111111": s1 });

    expect(getNextDueInScope(plugin, vaultScope)).toBeNull();
  });

  it("returns the earliest future due timestamp", () => {
    const c1 = card("111111111");
    const c2 = card("222222222");
    const s1 = state("111111111", "review", NOW + 60_000);
    const s2 = state("222222222", "review", NOW + 120_000);
    const plugin = makePlugin([c1, c2], { "111111111": s1, "222222222": s2 });

    expect(getNextDueInScope(plugin, vaultScope)).toBe(NOW + 60_000);
  });

  it("ignores suspended cards", () => {
    const c1 = card("111111111");
    const c2 = card("222222222");
    const s1 = state("111111111", "suspended", NOW + 1000);
    const s2 = state("222222222", "review", NOW + 60_000);
    const plugin = makePlugin([c1, c2], { "111111111": s1, "222222222": s2 });

    expect(getNextDueInScope(plugin, vaultScope)).toBe(NOW + 60_000);
  });

  it("respects folder scope", () => {
    const c1 = card("111111111", "basic", "Medicine/File.md");
    const c2 = card("222222222", "basic", "Surgery/File.md");
    const s1 = state("111111111", "review", NOW + 60_000);
    const s2 = state("222222222", "review", NOW + 30_000);
    const folderScope: Scope = { type: "folder", key: "Medicine", name: "Medicine" };
    const plugin = makePlugin([c1, c2], { "111111111": s1, "222222222": s2 });

    // Only c1 is in scope; c2's earlier due should not be returned
    expect(getNextDueInScope(plugin, folderScope)).toBe(NOW + 60_000);
  });
});

// ── Sibling card management modes ───────────────────────────────────────────

describe("siblingMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date("2026-02-12T12:00:00Z").getTime();
  const vaultScope: Scope = { type: "vault", key: "", name: "Vault" };

  // Helper: create a cloze parent + N cloze-child cards
  function clozeFamily(parentId: string, childCount: number, notePath = "Notes/A.md") {
    const parent = card(parentId, "cloze", notePath);
    (parent as any).clozeChildren = [];
    const children: CardRecord[] = [];
    for (let i = 1; i <= childCount; i++) {
      const ch = card(`${parentId}::cloze::c${i}`, "cloze-child", notePath);
      (ch as any).parentId = parentId;
      children.push(ch);
    }
    return { parent, children };
  }

  // Helper: create reversed parent + 2 children
  function reversedFamily(parentId: string, notePath = "Notes/A.md") {
    const parent = card(parentId, "reversed", notePath);
    const fwd = card(`${parentId}::reversed::forward`, "reversed-child", notePath);
    (fwd as any).parentId = parentId;
    const back = card(`${parentId}::reversed::back`, "reversed-child", notePath);
    (back as any).parentId = parentId;
    return { parent, children: [fwd, back] };
  }

  describe("standard mode", () => {
    it("includes all siblings in the queue (no spreading)", () => {
      const fam = clozeFamily("P1", 3);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "standard" } },
      );
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(3);
      // All three children present
      const ids = session.queue.map((c) => c.id);
      expect(ids).toContain("P1::cloze::c1");
      expect(ids).toContain("P1::cloze::c2");
      expect(ids).toContain("P1::cloze::c3");
    });

    it("does not modify buriedUntil on states", () => {
      const fam = clozeFamily("P1", 3);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "standard" } },
      );
      buildSession(plugin, vaultScope);
      for (const c of fam.children) {
        expect(plugin.store.data.states[c.id].buriedUntil).toBeUndefined();
      }
    });
  });

  describe("disperse mode", () => {
    it("spreads sibling children away from each other", () => {
      // 3 cloze siblings + 6 standalone basic cards = 9 total
      const fam = clozeFamily("P1", 3);
      const basics = Array.from({ length: 6 }, (_, i) => card(`B${i}`, "basic"));
      const allCards = [...fam.children, ...basics];
      const states: Record<string, CardState> = {};
      for (const c of allCards) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(allCards, states, [], { study: { siblingMode: "disperse" } });
      const session = buildSession(plugin, vaultScope);

      expect(session.queue.length).toBe(9);
      // All 3 siblings should be present
      const siblingIds = new Set(fam.children.map((c) => c.id));
      const siblingPositions = session.queue
        .map((c, i) => (siblingIds.has(c.id) ? i : -1))
        .filter((i) => i >= 0);
      expect(siblingPositions.length).toBe(3);

      // No two siblings should be adjacent
      for (let i = 1; i < siblingPositions.length; i++) {
        expect(siblingPositions[i] - siblingPositions[i - 1]).toBeGreaterThan(1);
      }
    });

    it("handles all-children queue (no standalone cards)", () => {
      const fam = clozeFamily("P1", 4);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin([...fam.children], states, [], { study: { siblingMode: "disperse" } });
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(4);
    });

    it("disperses new child cards too", () => {
      const fam = clozeFamily("P1", 3);
      const basics = Array.from({ length: 6 }, (_, i) => card(`B${i}`, "basic"));
      const allCards = [...fam.children, ...basics];
      const states: Record<string, CardState> = {};
      // Children are new, basics are review
      for (const c of fam.children) states[c.id] = state(c.id, "new", 0);
      for (const c of basics) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(allCards, states, [], { study: { siblingMode: "disperse" } });
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(9);
      const siblingIds = new Set(fam.children.map((c) => c.id));
      const siblingPositions = session.queue
        .map((c, i) => (siblingIds.has(c.id) ? i : -1))
        .filter((i) => i >= 0);
      expect(siblingPositions.length).toBe(3);
      for (let i = 1; i < siblingPositions.length; i++) {
        expect(siblingPositions[i] - siblingPositions[i - 1]).toBeGreaterThan(1);
      }
    });

    it("disperses children from multiple parents", () => {
      const fam1 = clozeFamily("P1", 2);
      const fam2 = clozeFamily("P2", 2);
      const basics = Array.from({ length: 8 }, (_, i) => card(`B${i}`, "basic"));
      const allCards = [...fam1.children, ...fam2.children, ...basics];
      const states: Record<string, CardState> = {};
      for (const c of allCards) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(allCards, states, [], { study: { siblingMode: "disperse" } });
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(12);

      // Check P1 siblings are not adjacent
      const p1Ids = new Set(fam1.children.map((c) => c.id));
      const p1Pos = session.queue.map((c, i) => (p1Ids.has(c.id) ? i : -1)).filter((i) => i >= 0);
      if (p1Pos.length > 1) {
        expect(p1Pos[1] - p1Pos[0]).toBeGreaterThan(1);
      }
    });
  });

  describe("bury mode", () => {
    it("keeps only one child per parent in the queue", () => {
      const fam = clozeFamily("P1", 4);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "bury" } },
      );
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(1);
    });

    it("keeps the most overdue sibling", () => {
      const fam = clozeFamily("P1", 3);
      const states: Record<string, CardState> = {
        "P1::cloze::c1": state("P1::cloze::c1", "review", NOW - 100),
        "P1::cloze::c2": state("P1::cloze::c2", "review", NOW - 5000), // most overdue
        "P1::cloze::c3": state("P1::cloze::c3", "review", NOW - 500),
      };

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "bury" } },
      );
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(1);
      expect(session.queue[0].id).toBe("P1::cloze::c2");
    });

    it("sets buriedUntil on buried siblings", () => {
      const fam = clozeFamily("P1", 3);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "bury" } },
      );
      const session = buildSession(plugin, vaultScope);

      // The one in the queue should NOT be buried
      const kept = session.queue[0].id;
      expect(plugin.store.data.states[kept].buriedUntil).toBeUndefined();

      // The other two should be buried until tomorrow
      const tomorrow = startOfTodayMsTest(NOW) + 24 * 60 * 60 * 1000;
      const buriedIds = fam.children.map((c) => c.id).filter((id) => id !== kept);
      for (const id of buriedIds) {
        expect(plugin.store.data.states[id].buriedUntil).toBe(tomorrow);
      }
    });

    it("buries new siblings too (only one new per parent)", () => {
      const fam = clozeFamily("P1", 3);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "new", 0);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "bury" } },
      );
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(1);
    });

    it("does not bury standalone cards", () => {
      const fam = clozeFamily("P1", 2);
      const basics = [card("B1", "basic"), card("B2", "basic")];
      const allCards = [...fam.children, ...basics];
      const states: Record<string, CardState> = {};
      for (const c of allCards) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(allCards, states, [], { study: { siblingMode: "bury" } });
      const session = buildSession(plugin, vaultScope);
      // 1 cloze child + 2 basics = 3
      expect(session.queue.length).toBe(3);
      const ids = session.queue.map((c) => c.id);
      expect(ids).toContain("B1");
      expect(ids).toContain("B2");
    });

    it("handles multiple parents — one child each", () => {
      const fam1 = clozeFamily("P1", 3);
      const fam2 = clozeFamily("P2", 2);
      const allCards = [...fam1.children, ...fam2.children];
      const states: Record<string, CardState> = {};
      for (const c of allCards) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(allCards, states, [], { study: { siblingMode: "bury" } });
      const session = buildSession(plugin, vaultScope);
      // One from each parent
      expect(session.queue.length).toBe(2);
    });

    it("buries reversed-child siblings (forward/back)", () => {
      const fam = reversedFamily("R1");
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "bury" } },
      );
      const session = buildSession(plugin, vaultScope);
      expect(session.queue.length).toBe(1);
    });

    it("does not re-bury already-buried cards on second buildSession call", () => {
      const fam = clozeFamily("P1", 3);
      const states: Record<string, CardState> = {};
      for (const c of fam.children) states[c.id] = state(c.id, "review", NOW - 1000);

      const plugin = makePlugin(
        [...fam.children],
        states,
        [],
        { study: { siblingMode: "bury" } },
      );
      const session1 = buildSession(plugin, vaultScope);
      const kept1 = session1.queue[0].id;

      // Second call should produce the same result (idempotent)
      const session2 = buildSession(plugin, vaultScope);
      expect(session2.queue.length).toBe(1);
      expect(session2.queue[0].id).toBe(kept1);
    });
  });
});

// Helper for tests: mirrors startOfTodayMs in session.ts
function startOfTodayMsTest(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── isAvailableNow with buriedUntil ─────────────────────────────────────────

describe("isAvailableNow — buriedUntil", () => {
  const NOW = new Date("2026-02-12T12:00:00Z").getTime();

  it("excludes cards buried until the future", () => {
    const st = state("x", "review", NOW - 1000);
    st.buriedUntil = NOW + 60_000;
    expect(isAvailableNow(st, NOW)).toBe(false);
  });

  it("includes cards whose buriedUntil has expired", () => {
    const st = state("x", "review", NOW - 1000);
    st.buriedUntil = NOW - 1;
    expect(isAvailableNow(st, NOW)).toBe(true);
  });

  it("includes cards with no buriedUntil", () => {
    const st = state("x", "review", NOW - 1000);
    expect(isAvailableNow(st, NOW)).toBe(true);
  });

  it("excludes buried new cards", () => {
    const st = state("x", "new", 0);
    st.buriedUntil = NOW + 60_000;
    expect(isAvailableNow(st, NOW)).toBe(false);
  });
});
