import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import type { AnkiNoteRow, AnkiCardRow, AnkiModel, AnkiDeck } from "../src/anki/anki-constants";

let mockNotes: AnkiNoteRow[] = [];
let mockCards: AnkiCardRow[] = [];
let mockModels = new Map<number, AnkiModel>();
let mockDecks = new Map<number, AnkiDeck>();

const insertCollection = vi.fn();
const insertNote = vi.fn();
const insertCard = vi.fn();
const insertRevlogEntry = vi.fn();

const fakeDb = {
  export: () => new Uint8Array([1, 2, 3]),
  close: vi.fn(),
};

vi.mock("../src/anki/anki-sql", () => {
  return {
    getSqlJs: vi.fn(async () => ({
      Database: class {
        constructor(_bytes: Uint8Array) {}
        close() {}
      },
    })),
    readNotes: vi.fn(() => mockNotes),
    readCards: vi.fn(() => mockCards),
    readModels: vi.fn(() => mockModels),
    readDecks: vi.fn(() => mockDecks),
    readCollectionCrt: vi.fn(() => 1700000000),
    createEmptyAnkiDb: vi.fn(async () => fakeDb),
    insertCollection,
    insertNote,
    insertCard,
    insertRevlogEntry,
  };
});

vi.mock("../src/anki/anki-zip", () => {
  return {
    unpackApkg: vi.fn(() => ({ db: new Uint8Array([9]), media: new Map() })),
    packApkg: vi.fn(() => new Uint8Array([7, 7])),
  };
});

vi.mock("../src/anki/anki-media", () => {
  return {
    saveMediaToVault: vi.fn(async () => new Map()),
    rewriteFieldForSprout: (s: string) => s,
    collectMediaRefs: (_fields: (string | null | undefined)[]) => new Set<string>(),
    resolveVaultMedia: vi.fn(async () => new Map()),
    rewriteFieldForAnki: (s: string) => s,
  };
});

vi.mock("../src/sync/sync-engine", () => {
  return {
    syncOneFile: vi.fn(async () => ({
      idsInserted: 0,
      anchorsRemoved: 0,
      newCount: 1,
      updatedCount: 0,
      sameCount: 0,
      quarantinedCount: 0,
      quarantinedIds: [],
      removed: 0,
      tagsDeleted: 0,
    })),
  };
});

import { importFromApkg } from "../src/anki/anki-import";
import { exportToApkg } from "../src/anki/anki-export";
import { ANKI_FIELD_SEPARATOR, DEFAULT_DECK_ID } from "../src/anki/anki-constants";
import { packApkg } from "../src/anki/anki-zip";

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

  async createFolder(_path: string): Promise<void> {}
}

function makePlugin(vault: MemoryVault) {
  return {
    app: { vault },
    manifest: { id: "" },
    store: {
      getAllCards: () => [],
    },
    settings: { scheduler: { learningStepsMinutes: [10], relearningStepsMinutes: [], requestRetention: 0.9 } },
  } as any;
}

describe("anki import/export pipelines", () => {
  beforeEach(() => {
    mockNotes = [];
    mockCards = [];
    mockModels = new Map<number, AnkiModel>();
    mockDecks = new Map<number, AnkiDeck>();
    insertCollection.mockClear();
    insertNote.mockClear();
    insertCard.mockClear();
    insertRevlogEntry.mockClear();
  });

  it("imports a basic note into markdown", async () => {
    mockNotes = [
      {
        id: 10,
        guid: "g",
        mid: 1,
        mod: 1,
        usn: -1,
        tags: "Tag1",
        flds: ["Front", "Back", "Extra"].join(ANKI_FIELD_SEPARATOR),
        sfld: "Front",
        csum: 0,
        flags: 0,
        data: "",
      },
    ];

    mockCards = [
      {
        id: 20,
        nid: 10,
        did: DEFAULT_DECK_ID,
        ord: 0,
        mod: 1,
        usn: -1,
        type: 0,
        queue: 0,
        due: 0,
        ivl: 0,
        factor: 0,
        reps: 0,
        lapses: 0,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: "",
      },
    ];

    mockModels.set(1, {
      id: 1,
      name: "Basic",
      type: 0,
      flds: [
        { name: "Front", ord: 0 },
        { name: "Back", ord: 1 },
        { name: "Extra", ord: 2 },
      ],
      tmpls: [
        { name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" },
      ],
      css: "",
      did: 1,
      mod: 0,
      usn: -1,
      sortf: 0,
      tags: [],
      vers: [],
    });

    mockDecks.set(DEFAULT_DECK_ID, {
      id: DEFAULT_DECK_ID,
      name: "Deck::Sub",
      mod: 0,
      usn: -1,
      collapsed: false,
      browserCollapsed: false,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
    });

    const vault = new MemoryVault();
    const plugin = makePlugin(vault);

    const res = await importFromApkg(plugin, new Uint8Array([1, 2, 3]), {
      targetFolder: "Anki Import",
      preserveScheduling: false,
      groupMapping: "deck-as-group",
      duplicateStrategy: "skip",
    });

    expect(res.imported).toBe(1);
    expect(res.filesCreated.length).toBe(1);

    const createdPath = res.filesCreated[0];
    const file = vault.getAbstractFileByPath(createdPath) as TFile;
    const content = await vault.read(file);
    expect(content).toContain("Q|");
    expect(content).toContain("A|");
  });

  it("exports cards to apkg bytes", async () => {
    const plugin: any = {
      app: { vault: new MemoryVault() },
      settings: { scheduler: { learningStepsMinutes: [10], relearningStepsMinutes: [], requestRetention: 0.9 } },
      store: {
        getAllCards: () => [
          {
            id: "1",
            type: "basic",
            title: null,
            q: "Q",
            a: "A",
            info: null,
            groups: ["Deck"],
            sourceNotePath: "Notes/Deck.md",
            sourceStartLine: 1,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        getState: () => null,
        data: {
          reviewLog: [
            { id: "1", at: 1000, prevDue: 0, nextDue: 86400000, result: "good", meta: null },
          ],
        },
      },
    };

    const res = await exportToApkg(plugin, {
      scope: "all",
      includeScheduling: false,
      includeRevlog: true,
      mcqStrategy: "convert-to-basic",
      defaultDeckName: "Default",
      includeMedia: false,
    });

    expect(packApkg).toHaveBeenCalled();
    expect(res.apkgBytes).toEqual(new Uint8Array([7, 7]));
    expect(res.stats.notesExported).toBe(1);
    expect(res.stats.cardsExported).toBe(1);
    expect(res.stats.revlogEntries).toBe(1);
  });
});
