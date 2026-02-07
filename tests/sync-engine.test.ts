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
    return this.files.get(file.path)?.content || "";
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
}

function makePlugin(vault: MemoryVault) {
  const plugin: any = {
    app: { vault },
    manifest: { id: "" },
    settings: { indexing: { ignoreInCodeFences: false } },
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
});
