import { describe, it, expect } from "vitest";
import {
  cardRecordToAnkiNote,
  cardStateToAnkiCard,
  reviewLogToAnkiRevlog,
  ankiNoteToCardRecord,
  ankiCardToCardState,
  markdownToHtml,
  cleanHtmlToMarkdown,
} from "../src/anki/anki-mapper";
import {
  ANKI_FIELD_SEPARATOR,
  BASIC_MODEL_ID,
  type AnkiNoteRow,
  type AnkiCardRow,
  type AnkiModel,
} from "../src/anki/anki-constants";
import type { CardRecord } from "../src/types/card";
import { State as FsrsState } from "ts-fsrs";

describe("anki mapper", () => {
  it("maps basic card to Anki note", () => {
    const card: CardRecord = {
      id: "1",
      type: "basic",
      title: "T",
      q: "Q",
      a: "A",
      info: "I",
      groups: ["Group/Sub"],
      sourceNotePath: "note.md",
      sourceStartLine: 1,
      createdAt: 1,
      updatedAt: 2,
    };

    const note = cardRecordToAnkiNote(card);
    expect(note.mid).toBe(BASIC_MODEL_ID);
    expect(note.flds).toBe(["Q", "A", "I"].join(ANKI_FIELD_SEPARATOR));
    expect(note.tags).toContain("Group::Sub");
  });

  it("maps MCQ card to Anki note", () => {
    const card: CardRecord = {
      id: "2",
      type: "mcq",
      title: null,
      stem: "Color?",
      options: ["Red", "Blue"],
      correctIndex: 1,
      q: null,
      a: null,
      info: "Because",
      groups: null,
      sourceNotePath: "note.md",
      sourceStartLine: 1,
      createdAt: 1,
      updatedAt: 2,
    } as CardRecord;

    const note = cardRecordToAnkiNote(card);
    const fields = note.flds.split(ANKI_FIELD_SEPARATOR);
    expect(fields[0]).toContain("A) Red");
    expect(fields[0]).toContain("B) Blue");
    expect(fields[1]).toContain("B) Blue");
  });

  it("maps card state to Anki card", () => {
    const card = cardStateToAnkiCard(
      {
        id: "1",
        stage: "review",
        due: 1700864000000,
        reps: 3,
        lapses: 0,
        learningStepIndex: 0,
        fsrsState: FsrsState.Review,
        scheduledDays: 10,
      },
      10,
      20,
      0,
      1700000000,
    );

    expect(card.type).toBe(2);
    expect(card.queue).toBe(2);
    expect(card.due).toBe(10);
  });

  it("maps review log entry to Anki revlog", () => {
    const rev = reviewLogToAnkiRevlog(
      { id: "1", at: 1000, prevDue: 0, nextDue: 86400000, result: "good", meta: null },
      99,
    );
    expect(rev.cid).toBe(99);
    expect(rev.ivl).toBe(1);
  });

  it("maps Anki note to Sprout card", () => {
    const note: AnkiNoteRow = {
      id: 10,
      guid: "g",
      mid: 1,
      mod: 1,
      usn: -1,
      tags: "Tag1 Tag2",
      flds: ["Front", "Back", "Extra"].join(ANKI_FIELD_SEPARATOR),
      sfld: "Front",
      csum: 0,
      flags: 0,
      data: "",
    };

    const model: AnkiModel = {
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
    };

    const card = ankiNoteToCardRecord(note, model, "Deck::Sub", "Notes/Deck.md", 1);
    expect(card.type).toBe("basic");
    expect(card.q).toBe("Front");
    expect(card.a).toBe("Back");
    expect(card.info).toBe("Extra");
    expect(card.groups).toEqual(expect.arrayContaining(["Deck/Sub", "Tag1", "Tag2"]));
  });

  it("maps Anki card to Sprout state", () => {
    const ankiCard: AnkiCardRow = {
      id: 20,
      nid: 10,
      did: 1,
      ord: 0,
      mod: 1,
      usn: -1,
      type: 2,
      queue: 2,
      due: 10,
      ivl: 5,
      factor: 0,
      reps: 1,
      lapses: 0,
      left: 0,
      odue: 0,
      odid: 0,
      flags: 0,
      data: "",
    };

    const st = ankiCardToCardState(ankiCard, "sprout-1", 1700000000);
    expect(st.stage).toBe("review");
    expect(st.due).toBe(1700864000000);
    expect(st.fsrsState).toBe(FsrsState.Review);
    expect(st.scheduledDays).toBe(5);
  });

  it("converts markdown and HTML", () => {
    const html = markdownToHtml("**Bold**\n*Ital*");
    expect(html).toContain("<b>Bold</b>");
    expect(html).toContain("<br>");

    const md = cleanHtmlToMarkdown("<b>Bold</b><br>Line");
    expect(md).toContain("**Bold**");
    expect(md).toContain("Line");
  });
});
