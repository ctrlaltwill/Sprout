import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TFile } from "obsidian";
import { JsonStore } from "../src/core/store";
import { syncOneFile, syncQuestionBank } from "../src/sync/sync-engine";

class MemoryVault {
  files = new Map<string, { file: TFile; content: string }>();
  configDir = ".obsidian";
  adapter: unknown = null;

  getAbstractFileByPath(path: string) {
    return this.files.get(path)?.file || null;
  }

  async read(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    return entry.content;
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, { file, content });
  }

  async create(path: string, content: string): Promise<TFile> {
    const file = new TFile();
    file.path = path;
    file.name = path.split("/").pop() || "";
    file.basename = file.name.replace(/\.md$/i, "");
    file.extension = file.name.split(".").pop() || "";
    this.files.set(path, { file, content });
    return file;
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values())
      .map((f) => f.file)
      .filter((f) => f.path.endsWith(".md"));
  }

  getFiles(): TFile[] {
    return Array.from(this.files.values()).map((f) => f.file);
  }
}

function makePlugin(vault: MemoryVault) {
  const fileManager = {
    trashFile: vi.fn(async () => {}),
  };
  const plugin: any = {
    app: { vault, fileManager },
    manifest: { id: "" },
    settings: {
      indexing: { ignoreInCodeFences: false },
      storage: { deleteOrphanedImages: false },
    },
    saveAll: vi.fn(async () => {}),
    loadData: vi.fn(async () => ({})),
  };
  plugin.store = new JsonStore(plugin);
  return plugin;
}

describe("sync engine", () => {
  const setCryptoSequence = (values: number[]) => {
    const seq = [...values];
    if (!globalThis.crypto?.getRandomValues) return;
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      const arr = array as Uint32Array;
      const v = seq.length ? seq.shift()! : 0;
      arr[0] = v;
      return array;
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── syncOneFile: basic ──────────────────────────────────────────────────

  it("syncs a single file and inserts anchors", async () => {
    const vault = new MemoryVault();
    const file = await vault.create("Notes/Test.md", "Q | What is 2+2? |\nA | 4 |");
    const plugin = makePlugin(vault);

    setCryptoSequence([0]);

    const res = await syncOneFile(plugin, file);
    const content = await vault.read(file);

    expect(res.idsInserted).toBe(1);
    expect(res.newCount).toBe(1);
    expect(content).toContain("^sprout-100000000");
    expect(plugin.store.data.cards["100000000"]).toBeDefined();
    expect(plugin.store.data.states["100000000"]).toBeDefined();
  });

  it("creates scheduling state for new cards", async () => {
    const vault = new MemoryVault();
    const file = await vault.create("Notes/Test.md", "Q | Q? |\nA | A! |");
    const plugin = makePlugin(vault);
    setCryptoSequence([0]);

    await syncOneFile(plugin, file);
    const st = plugin.store.data.states["100000000"];

    expect(st).toBeDefined();
    expect(st.stage).toBe("new");
    expect(st.reps).toBe(0);
  });

  it("preserves existing anchor IDs", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Test.md",
      "^sprout-999999999\nQ | Existing card |\nA | Yes |",
    );
    const plugin = makePlugin(vault);

    const res = await syncOneFile(plugin, file);

    expect(res.idsInserted).toBe(0);
    expect(res.newCount).toBe(1);
    expect(plugin.store.data.cards["999999999"]).toBeDefined();
  });

  it("removes orphan anchors from deleted cards", async () => {
    const vault = new MemoryVault();
    // First sync establishes the card
    const file = await vault.create(
      "Notes/Test.md",
      "^sprout-888888888\nQ | Will be removed |\nA | Yes |",
    );
    const plugin = makePlugin(vault);
    await syncOneFile(plugin, file);
    expect(plugin.store.data.cards["888888888"]).toBeDefined();

    // Now update file to remove the card content but keep the anchor
    vault.files.set(file.path, { file, content: "^sprout-888888888\nJust text now" });
    const res2 = await syncOneFile(plugin, file);

    expect(res2.anchorsRemoved).toBe(1);
    const content = await vault.read(file);
    expect(content).not.toContain("^sprout-888888888");
  });

  it("syncs multiple cards in one file", async () => {
    const vault = new MemoryVault();
    const text = [
      "Q | Card 1 |",
      "A | Answer 1 |",
      "",
      "Q | Card 2 |",
      "A | Answer 2 |",
    ].join("\n");
    const file = await vault.create("Notes/Multi.md", text);
    const plugin = makePlugin(vault);
    setCryptoSequence([100000000, 200000000]);

    const res = await syncOneFile(plugin, file);

    expect(res.newCount).toBe(2);
    expect(res.idsInserted).toBe(2);
    expect(Object.keys(plugin.store.data.cards)).toHaveLength(2);
  });

  it("reports updated count when card content changes", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Test.md",
      "^sprout-111111111\nQ | Original Q |\nA | Original A |",
    );
    const plugin = makePlugin(vault);
    await syncOneFile(plugin, file);
    expect(plugin.store.data.cards["111111111"].q).toContain("Original Q");

    // Modify content
    vault.files.set(file.path, {
      file,
      content: "^sprout-111111111\nQ | Updated Q |\nA | Updated A |",
    });
    const res2 = await syncOneFile(plugin, file);

    expect(res2.updatedCount).toBe(1);
    expect(res2.newCount).toBe(0);
  });

  it("reports sameCount for unchanged cards", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Test.md",
      "^sprout-111111111\nQ | Stable Q |\nA | Stable A |",
    );
    const plugin = makePlugin(vault);
    await syncOneFile(plugin, file);

    const res2 = await syncOneFile(plugin, file);
    expect(res2.sameCount).toBe(1);
    expect(res2.newCount).toBe(0);
    expect(res2.updatedCount).toBe(0);
  });

  // ── syncOneFile: cloze children ─────────────────────────────────────────

  it("creates cloze-child records from cloze card", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Cloze.md",
      "^sprout-111111111\nCQ | {{c1::Paris}} is the capital of {{c2::France}}. |",
    );
    const plugin = makePlugin(vault);

    await syncOneFile(plugin, file);

    // Parent cloze + 2 children
    expect(plugin.store.data.cards["111111111"]).toBeDefined();
    expect(plugin.store.data.cards["111111111"].type).toBe("cloze");
    expect(plugin.store.data.cards["111111111::cloze::c1"]).toBeDefined();
    expect(plugin.store.data.cards["111111111::cloze::c2"]).toBeDefined();
    expect(plugin.store.data.cards["111111111::cloze::c1"].type).toBe("cloze-child");

    // Children have scheduling states
    expect(plugin.store.data.states["111111111::cloze::c1"]).toBeDefined();
    expect(plugin.store.data.states["111111111::cloze::c2"]).toBeDefined();
  });

  it("removes cloze children when deletions are removed", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Cloze.md",
      "^sprout-111111111\nCQ | {{c1::A}} and {{c2::B}} and {{c3::C}}. |",
    );
    const plugin = makePlugin(vault);
    await syncOneFile(plugin, file);
    expect(plugin.store.data.cards["111111111::cloze::c3"]).toBeDefined();

    // Remove c3
    vault.files.set(file.path, {
      file,
      content: "^sprout-111111111\nCQ | {{c1::A}} and {{c2::B}}. |",
    });
    await syncOneFile(plugin, file);

    expect(plugin.store.data.cards["111111111::cloze::c1"]).toBeDefined();
    expect(plugin.store.data.cards["111111111::cloze::c2"]).toBeDefined();
    expect(plugin.store.data.cards["111111111::cloze::c3"]).toBeUndefined();
  });

  // ── syncOneFile: reversed children ──────────────────────────────────────

  it("creates reversed-child records (forward + back)", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Rev.md",
      "^sprout-222222222\nRQ | Heart |\nA | Pumps blood |",
    );
    const plugin = makePlugin(vault);

    await syncOneFile(plugin, file);

    expect(plugin.store.data.cards["222222222"]).toBeDefined();
    expect(plugin.store.data.cards["222222222"].type).toBe("reversed");
    expect(plugin.store.data.cards["222222222::reversed::forward"]).toBeDefined();
    expect(plugin.store.data.cards["222222222::reversed::back"]).toBeDefined();
    expect(plugin.store.data.cards["222222222::reversed::forward"].type).toBe("reversed-child");

    // Children have states
    expect(plugin.store.data.states["222222222::reversed::forward"]).toBeDefined();
    expect(plugin.store.data.states["222222222::reversed::back"]).toBeDefined();
  });

  // ── syncOneFile: quarantine ─────────────────────────────────────────────

  it("quarantines cards with parse errors", async () => {
    const vault = new MemoryVault();
    // CQ without cloze tokens → parse error
    const file = await vault.create(
      "Notes/Bad.md",
      "^sprout-333333333\nCQ | No cloze tokens here |",
    );
    const plugin = makePlugin(vault);

    await syncOneFile(plugin, file);

    expect(plugin.store.data.quarantine["333333333"]).toBeDefined();
    expect(plugin.store.data.cards["333333333"]).toBeUndefined();
  });

  // ── syncOneFile: stale removal ──────────────────────────────────────────

  it("removes stale cards that are no longer in the file", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Test.md",
      "^sprout-111111111\nQ | Q1 |\nA | A1 |\n\n^sprout-222222222\nQ | Q2 |\nA | A2 |",
    );
    const plugin = makePlugin(vault);
    await syncOneFile(plugin, file);
    expect(Object.keys(plugin.store.data.cards).length).toBeGreaterThanOrEqual(2);

    // Remove the second card
    vault.files.set(file.path, {
      file,
      content: "^sprout-111111111\nQ | Q1 |\nA | A1 |",
    });
    const res2 = await syncOneFile(plugin, file);

    expect(res2.removed).toBeGreaterThanOrEqual(1);
    expect(plugin.store.data.cards["111111111"]).toBeDefined();
    expect(plugin.store.data.cards["222222222"]).toBeUndefined();
  });

  // ── syncOneFile: TOCTOU re-validation ───────────────────────────────────

  it("skips write when file changes during sync (TOCTOU guard)", async () => {
    const vault = new MemoryVault();
    const file = await vault.create("Notes/Race.md", "Q | Original |\nA | A |");
    const plugin = makePlugin(vault);
    setCryptoSequence([500000000]);

    let readCount = 0;
    const origRead = vault.read.bind(vault);
    vi.spyOn(vault, "read").mockImplementation(async (f: TFile) => {
      readCount++;
      const content = await origRead(f);
      // On the second read (TOCTOU check), simulate external edit
      if (readCount === 2 && f.path === "Notes/Race.md") {
        return content + "\n<!-- edited externally -->";
      }
      return content;
    });

    const modifySpy = vi.spyOn(vault, "modify");
    await syncOneFile(plugin, file);

    // The write should have been skipped because the TOCTOU check detected a change
    expect(modifySpy).not.toHaveBeenCalled();
  });

  // ── syncQuestionBank: basic ─────────────────────────────────────────────

  it("syncs the full question bank", async () => {
    const vault = new MemoryVault();
    await vault.create("Notes/One.md", "^sprout-111111111\nQ | Q1 |\nA | A1 |");
    await vault.create("Notes/Two.md", "Q | Q2 |\nA | A2 |");
    const plugin = makePlugin(vault);

    setCryptoSequence([180000000]);

    const res = await syncQuestionBank(plugin);
    const fileTwo = vault.getAbstractFileByPath("Notes/Two.md") as TFile;
    const contentTwo = await vault.read(fileTwo);

    expect(res.idsInserted).toBe(1);
    expect(res.newCount).toBe(2);
    expect(contentTwo).toContain("^sprout-280000000");
    expect(Object.keys(plugin.store.data.cards)).toHaveLength(2);
  });

  it("skips files with no cards and no orphan anchors", async () => {
    const vault = new MemoryVault();
    await vault.create("Notes/Empty.md", "Just some text\nNo cards here");
    await vault.create("Notes/Card.md", "Q | Q |\nA | A |");
    const plugin = makePlugin(vault);
    setCryptoSequence([0]);

    const res = await syncQuestionBank(plugin);

    expect(res.newCount).toBe(1);
    expect(Object.keys(plugin.store.data.cards)).toHaveLength(1);
  });

  it("handles vault with no markdown files", async () => {
    const vault = new MemoryVault();
    const plugin = makePlugin(vault);

    const res = await syncQuestionBank(plugin);

    expect(res.newCount).toBe(0);
    expect(Object.keys(plugin.store.data.cards)).toHaveLength(0);
  });

  // ── syncQuestionBank: per-file try/catch ────────────────────────────────

  it("continues syncing when one file throws (per-file try/catch)", async () => {
    const vault = new MemoryVault();
    await vault.create("Notes/Good.md", "Q | Works |\nA | Yes |");
    const badFile = await vault.create("Notes/Bad.md", "Q | Fail |\nA | A |");
    const plugin = makePlugin(vault);
    setCryptoSequence([100000000, 200000000]);

    // Make the bad file throw on read
    const origRead = vault.read.bind(vault);
    vi.spyOn(vault, "read").mockImplementation(async (f: TFile) => {
      if (f.path === "Notes/Bad.md") throw new Error("Disk error");
      return origRead(f);
    });

    const res = await syncQuestionBank(plugin);

    // The good file should still have been synced
    expect(res.newCount).toBe(1);
    expect(Object.keys(plugin.store.data.cards)).toHaveLength(1);
  });

  // ── syncQuestionBank: unique IDs across files ───────────────────────────

  it("generates unique anchor IDs across multiple files", async () => {
    const vault = new MemoryVault();
    await vault.create("Notes/A.md", "Q | Q1 |\nA | A1 |");
    await vault.create("Notes/B.md", "Q | Q2 |\nA | A2 |");
    await vault.create("Notes/C.md", "Q | Q3 |\nA | A3 |");
    const plugin = makePlugin(vault);
    setCryptoSequence([100000000, 200000000, 300000000]);

    await syncQuestionBank(plugin);

    const cardIds = Object.keys(plugin.store.data.cards);
    const uniqueIds = new Set(cardIds);
    expect(uniqueIds.size).toBe(cardIds.length);
    expect(cardIds).toHaveLength(3);
  });

  // ── syncQuestionBank: TOCTOU re-read in vault sync ──────────────────────

  it("re-reads file content before write in vault sync", async () => {
    const vault = new MemoryVault();
    await vault.create("Notes/File.md", "Q | Q |\nA | A |");
    const plugin = makePlugin(vault);
    setCryptoSequence([100000000]);

    // Count reads to verify the re-read happens
    let readCount = 0;
    const origRead = vault.read.bind(vault);
    vi.spyOn(vault, "read").mockImplementation(async (f: TFile) => {
      readCount++;
      return origRead(f);
    });

    await syncQuestionBank(plugin);

    // Should read at least twice: initial parse + TOCTOU re-validation
    expect(readCount).toBeGreaterThanOrEqual(2);
  });

  // ── syncOneFile: idempotent re-sync ─────────────────────────────────────

  it("re-syncing the same file is idempotent", async () => {
    const vault = new MemoryVault();
    const file = await vault.create(
      "Notes/Stable.md",
      "Q | Stable card |\nA | Answer |",
    );
    const plugin = makePlugin(vault);
    setCryptoSequence([100000000]);

    const res1 = await syncOneFile(plugin, file);
    expect(res1.newCount).toBe(1);
    expect(res1.idsInserted).toBe(1);

    const res2 = await syncOneFile(plugin, file);
    expect(res2.newCount).toBe(0);
    expect(res2.idsInserted).toBe(0);
    expect(res2.sameCount).toBe(1);

    // Card count doesn't change
    expect(Object.keys(plugin.store.data.cards)).toHaveLength(1);
  });
});
