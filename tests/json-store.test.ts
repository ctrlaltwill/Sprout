import { describe, it, expect, vi } from "vitest";
import { JsonStore } from "../src/core/store";
import { State } from "ts-fsrs";

type MockPlugin = {
  app: { vault: { configDir: string; adapter: unknown; getAbstractFileByPath: (path: string) => unknown } };
  manifest: { id: string };
  saveAll: () => Promise<void>;
  loadData: () => Promise<unknown>;
  store?: JsonStore;
};

function makePlugin(): MockPlugin {
  return {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter: null,
        getAbstractFileByPath: vi.fn(),
      },
    },
    manifest: { id: "" },
    saveAll: vi.fn(async () => {}),
    loadData: vi.fn(async () => ({})),
  };
}

describe("JsonStore", () => {
  it("loads and migrates data safely", () => {
    const plugin = makePlugin();
    const store = new JsonStore(plugin as any);

    const root = {
      store: {
        version: 0,
        cards: {
          "1": { id: "1", updatedAt: 1234 },
        },
        states: {
          "1": { stage: "review", intervalDays: 3, reps: "2", lapses: null, learningStepIndex: "1" },
        },
        reviewLog: [],
        quarantine: {},
        io: {},
        analytics: {
          version: 1,
          seq: 0,
          events: [null, { kind: "review" }],
        },
      },
    };

    store.load(root);

    expect(store.data.version).toBe(10);
    expect(store.data.cards["1"].createdAt).toBe(1234);
    expect(store.data.analytics.events.length).toBe(1);

    const st = store.data.states["1"] as any;
    expect(st.fsrsState).toBe(State.Review);
    expect(st.scheduledDays).toBe(3);
    expect(st.intervalDays).toBeUndefined();
    expect(store.getRevision()).toBeGreaterThan(0);
  });

  it("supports CRUD helpers and revision bumps", async () => {
    const plugin = makePlugin();
    const store = new JsonStore(plugin as any);

    store.upsertCard({
      id: "c1",
      type: "basic",
      title: "Title",
      q: "Q",
      a: "A",
      info: null,
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
    });

    store.upsertState({
      id: "c1",
      stage: "new",
      due: 123,
      reps: 0,
      lapses: 0,
      learningStepIndex: 0,
      fsrsState: State.New,
      scheduledDays: 0,
    });

    store.appendReviewLog({
      id: "c1",
      at: 1000,
      prevDue: 0,
      nextDue: 2000,
      result: "good",
      meta: null,
    });

    store.truncateReviewLog(0);
    expect(store.data.reviewLog).toHaveLength(0);

    store.data.quarantine["c1"] = { id: "c1" } as any;
    expect(store.getAllCards()).toHaveLength(0);

    const st = store.ensureState("c2", 5000, 2.5);
    expect(st.stage).toBe("new");
    expect(st.fsrsState).toBe(State.New);

    const revBefore = store.getRevision();
    await store.persist();
    expect(plugin.saveAll).toHaveBeenCalledTimes(1);
    expect(store.getRevision()).toBeGreaterThan(revBefore);
  });
});
