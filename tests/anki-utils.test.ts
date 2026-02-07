import { describe, it, expect, beforeEach } from "vitest";
import {
  ankiDeckToGroupPath,
  groupPathToAnkiDeck,
  deckToFolderAndFile,
  generateAnkiId,
  generateAnkiGuid,
  sproutRatingToAnkiEase,
  ankiEaseToSproutRating,
  sproutStageToAnkiTypeQueue,
  ankiTypeQueueToSproutStage,
  fsrsDifficultyToAnkiFactor,
  ankiFactorToFsrsDifficulty,
  sproutDueToAnkiReviewDue,
  ankiReviewDueToSproutDue,
  sproutDueToAnkiLearningDue,
  ankiLearningDueToSproutDue,
  computeFieldChecksum,
  sproutGroupsToAnkiTags,
  ankiTagsToSproutGroups,
  _resetIdCounter,
} from "../src/anki/anki-utils";

// ── Deck ↔ Group path ──

describe("ankiDeckToGroupPath", () => {
  it("converts :: to /", () => {
    expect(ankiDeckToGroupPath("A::B::C")).toBe("A/B/C");
  });
  it("handles single segment", () => {
    expect(ankiDeckToGroupPath("Medicine")).toBe("Medicine");
  });
  it("trims whitespace", () => {
    expect(ankiDeckToGroupPath(" A :: B :: C ")).toBe("A/B/C");
  });
  it("handles empty string", () => {
    expect(ankiDeckToGroupPath("")).toBe("");
  });
  it("handles null/undefined", () => {
    expect(ankiDeckToGroupPath(null as unknown as string)).toBe("");
    expect(ankiDeckToGroupPath(undefined as unknown as string)).toBe("");
  });
});

describe("groupPathToAnkiDeck", () => {
  it("converts / to ::", () => {
    expect(groupPathToAnkiDeck("A/B/C")).toBe("A::B::C");
  });
  it("handles single segment", () => {
    expect(groupPathToAnkiDeck("Medicine")).toBe("Medicine");
  });
  it("round-trips with ankiDeckToGroupPath", () => {
    const original = "Medicine::Paediatrics::Cardiology";
    expect(groupPathToAnkiDeck(ankiDeckToGroupPath(original))).toBe(original);
  });
});

// ── deckToFolderAndFile ──

describe("deckToFolderAndFile", () => {
  it("creates nested folder structure", () => {
    const result = deckToFolderAndFile("Medicine::Paediatrics", "Anki Import");
    expect(result.folder).toBe("Anki Import/Medicine/Paediatrics");
    expect(result.file).toBe("Anki Import/Medicine/Paediatrics/Paediatrics.md");
  });
  it("handles single deck", () => {
    const result = deckToFolderAndFile("Medicine", "Anki Import");
    expect(result.folder).toBe("Anki Import/Medicine");
    expect(result.file).toBe("Anki Import/Medicine/Medicine.md");
  });
  it("handles empty deck", () => {
    const result = deckToFolderAndFile("", "Anki Import");
    expect(result.folder).toBe("Anki Import");
    expect(result.file).toBe("Anki Import/Cards.md");
  });
  it("strips trailing slash from root", () => {
    const result = deckToFolderAndFile("French", "Anki Import/");
    expect(result.folder).toBe("Anki Import/French");
    expect(result.file).toBe("Anki Import/French/French.md");
  });
  it("handles deeply nested decks", () => {
    const result = deckToFolderAndFile("A::B::C::D", "root");
    expect(result.folder).toBe("root/A/B/C/D");
    expect(result.file).toBe("root/A/B/C/D/D.md");
  });
});

// ── ID generation ──

describe("generateAnkiId", () => {
  beforeEach(() => _resetIdCounter());

  it("returns a positive integer", () => {
    const id = generateAnkiId();
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });
  it("returns monotonically increasing IDs", () => {
    const a = generateAnkiId();
    const b = generateAnkiId();
    const c = generateAnkiId();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("generateAnkiGuid", () => {
  it("returns a 10-character string", () => {
    const guid = generateAnkiGuid();
    expect(guid).toHaveLength(10);
  });
  it("returns different values each call", () => {
    const a = generateAnkiGuid();
    const b = generateAnkiGuid();
    expect(a).not.toBe(b);
  });
});

// ── Rating ↔ Ease ──

describe("sproutRatingToAnkiEase / ankiEaseToSproutRating", () => {
  it("maps again → 1", () => {
    expect(sproutRatingToAnkiEase("again")).toBe(1);
  });
  it("maps hard → 2", () => {
    expect(sproutRatingToAnkiEase("hard")).toBe(2);
  });
  it("maps good → 3", () => {
    expect(sproutRatingToAnkiEase("good")).toBe(3);
  });
  it("maps easy → 4", () => {
    expect(sproutRatingToAnkiEase("easy")).toBe(4);
  });
  it("round-trips each rating", () => {
    for (const r of ["again", "hard", "good", "easy"] as const) {
      expect(ankiEaseToSproutRating(sproutRatingToAnkiEase(r))).toBe(r);
    }
  });
});

// ── Stage ↔ Type/Queue ──

describe("sproutStageToAnkiTypeQueue / ankiTypeQueueToSproutStage", () => {
  it("maps new → type 0, queue 0", () => {
    const { type, queue } = sproutStageToAnkiTypeQueue("new");
    expect(type).toBe(0);
    expect(queue).toBe(0);
  });
  it("maps learning → type 1, queue 1", () => {
    const { type, queue } = sproutStageToAnkiTypeQueue("learning");
    expect(type).toBe(1);
    expect(queue).toBe(1);
  });
  it("maps review → type 2, queue 2", () => {
    const { type, queue } = sproutStageToAnkiTypeQueue("review");
    expect(type).toBe(2);
    expect(queue).toBe(2);
  });
  it("maps relearning → type 3, queue 1", () => {
    const { type, queue } = sproutStageToAnkiTypeQueue("relearning");
    expect(type).toBe(3);
    expect(queue).toBe(1);
  });
  it("maps suspended → queue -1", () => {
    const { queue } = sproutStageToAnkiTypeQueue("suspended");
    expect(queue).toBe(-1);
  });
  it("round-trips main stages", () => {
    for (const stage of ["new", "learning", "review"] as const) {
      const { type, queue } = sproutStageToAnkiTypeQueue(stage);
      expect(ankiTypeQueueToSproutStage(type, queue)).toBe(stage);
    }
  });
  it("suspended detected from queue -1 regardless of type", () => {
    expect(ankiTypeQueueToSproutStage(0, -1)).toBe("suspended");
    expect(ankiTypeQueueToSproutStage(2, -1)).toBe("suspended");
  });
});

// ── FSRS difficulty ↔ Anki factor ──

describe("fsrsDifficultyToAnkiFactor / ankiFactorToFsrsDifficulty", () => {
  it("converts 5.0 → 600", () => {
    expect(fsrsDifficultyToAnkiFactor(5.0)).toBe(600);
  });
  it("converts 0.0 → 100", () => {
    expect(fsrsDifficultyToAnkiFactor(0.0)).toBe(100);
  });
  it("converts 10.0 → 1100", () => {
    expect(fsrsDifficultyToAnkiFactor(10.0)).toBe(1100);
  });
  it("handles undefined → 0", () => {
    expect(fsrsDifficultyToAnkiFactor(undefined)).toBe(0);
  });
  it("round-trips integer difficulties", () => {
    for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(ankiFactorToFsrsDifficulty(fsrsDifficultyToAnkiFactor(d))).toBeCloseTo(d, 5);
    }
  });
  it("defaults to 5.0 for zero or negative factor", () => {
    expect(ankiFactorToFsrsDifficulty(0)).toBe(5.0);
    expect(ankiFactorToFsrsDifficulty(-100)).toBe(5.0);
  });
});

// ── Due date conversions ──

describe("due date conversions", () => {
  const crt = 1700000000; // ~Nov 2023

  it("review due round-trips", () => {
    const sproutDue = 1700864000000; // 10 days later in ms
    const ankiDue = sproutDueToAnkiReviewDue(sproutDue, crt);
    expect(ankiDue).toBe(10);
    const back = ankiReviewDueToSproutDue(ankiDue, crt);
    expect(back).toBe(1700864000000);
  });

  it("learning due round-trips", () => {
    const sproutDue = 1700001000000; // some ms timestamp
    const ankiDue = sproutDueToAnkiLearningDue(sproutDue);
    expect(ankiDue).toBe(1700001000);
    const back = ankiLearningDueToSproutDue(ankiDue);
    expect(back).toBe(1700001000000);
  });
});

// ── Checksum ──

describe("computeFieldChecksum", () => {
  it("returns a positive integer", () => {
    const csum = computeFieldChecksum("hello");
    expect(csum).toBeGreaterThan(0);
    expect(Number.isInteger(csum)).toBe(true);
  });
  it("returns consistent results", () => {
    expect(computeFieldChecksum("test")).toBe(computeFieldChecksum("test"));
  });
  it("returns different values for different inputs", () => {
    expect(computeFieldChecksum("a")).not.toBe(computeFieldChecksum("b"));
  });
});

// ── Tag conversion ──

describe("sproutGroupsToAnkiTags", () => {
  it("converts groups to space-separated :: tags", () => {
    const result = sproutGroupsToAnkiTags(["Medicine/Paediatrics", "Important"]);
    expect(result).toBe(" Medicine::Paediatrics Important ");
  });
  it("replaces spaces with underscores", () => {
    const result = sproutGroupsToAnkiTags(["My Group"]);
    expect(result).toBe(" My_Group ");
  });
  it("returns empty string for null/empty", () => {
    expect(sproutGroupsToAnkiTags(null)).toBe("");
    expect(sproutGroupsToAnkiTags([])).toBe("");
  });
});

describe("ankiTagsToSproutGroups", () => {
  it("converts space-separated tags to groups", () => {
    const result = ankiTagsToSproutGroups(" Medicine::Paediatrics Important ");
    expect(result).toEqual(["Medicine/Paediatrics", "Important"]);
  });
  it("converts underscores to spaces", () => {
    const result = ankiTagsToSproutGroups("My_Group");
    expect(result).toEqual(["My Group"]);
  });
  it("handles empty string", () => {
    expect(ankiTagsToSproutGroups("")).toEqual([]);
  });
});
