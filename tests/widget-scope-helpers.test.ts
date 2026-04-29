import { describe, expect, it } from "vitest";
import { getCardsInActiveScope } from "../src/views/widget/scope/scope-helpers";

function makeStore(cards: Array<Record<string, unknown>>) {
  return {
    getAllCards: () => cards as any,
  };
}

function makeSettings(treatFolderNotesAsDecks: boolean) {
  return {
    study: {
      treatFolderNotesAsDecks,
    },
  } as any;
}

function makeFolderNote(path: string, folderName: string) {
  return {
    path,
    basename: folderName,
    parent: {
      name: folderName,
      path: path.split("/").slice(0, -1).join("/"),
    },
  } as any;
}

describe("getCardsInActiveScope", () => {
  it("includes cards from the folder note file itself when folder decks are enabled", () => {
    const cards = getCardsInActiveScope(
      makeStore([
        { id: "hq-1", type: "hq-child", groupKey: "1", sourceNotePath: "Biology/Biology.md" },
        { id: "io-1", type: "io-child", groupKey: "1", sourceNotePath: "Biology/Cells.md" },
        { id: "outside", type: "basic", sourceNotePath: "Chemistry/Atoms.md" },
      ]),
      makeFolderNote("Biology/Biology.md", "Biology"),
      makeSettings(true),
    );

    expect(cards.map((card) => card.id)).toEqual(["hq-1", "io-1"]);
  });

  it("still scopes to the folder note file only when folder decks are disabled", () => {
    const cards = getCardsInActiveScope(
      makeStore([
        { id: "hq-1", type: "hq-child", groupKey: "1", sourceNotePath: "Biology/Biology.md" },
        { id: "io-1", type: "io-child", groupKey: "1", sourceNotePath: "Biology/Cells.md" },
      ]),
      makeFolderNote("Biology/Biology.md", "Biology"),
      makeSettings(false),
    );

    expect(cards.map((card) => card.id)).toEqual(["hq-1"]);
  });
});