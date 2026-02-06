// tests/parser.test.ts
// ---------------------------------------------------------------------------
// Tests for the card parser — ensures all card formats (basic, MCQ, cloze, IO)
// parse correctly and that errors are caught for malformed input.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseCardsFromText } from "../src/parser/parser";
import type { ParsedCard } from "../src/parser/parser";

// ── Helpers ─────────────────────────────────────────────────────────────────

function parse(text: string): ParsedCard[] {
  return parseCardsFromText("test-note.md", text).cards;
}

function parseOne(text: string): ParsedCard {
  const cards = parse(text);
  expect(cards).toHaveLength(1);
  return cards[0];
}

// ── Basic cards ─────────────────────────────────────────────────────────────

describe("basic cards (Q/A)", () => {
  it("parses a simple Q/A card", () => {
    const card = parseOne(
      `Q | What is 2+2? |
A | 4 |`
    );

    expect(card.type).toBe("basic");
    expect(card.q).toBe("What is 2+2?");
    expect(card.a).toBe("4");
    expect(card.errors).toHaveLength(0);
  });

  it("parses multiline question and answer", () => {
    const card = parseOne(
      `Q | What is the capital
of France? |
A | Paris is the capital
of France. |`
    );

    expect(card.q).toContain("France");
    expect(card.a).toContain("Paris");
    expect(card.errors).toHaveLength(0);
  });

  it("errors on missing answer", () => {
    const card = parseOne(`Q | What is 2+2? |`);

    expect(card.type).toBe("basic");
    expect(card.errors.length).toBeGreaterThan(0);
    expect(card.errors.some((e) => /missing.*a/i.test(e))).toBe(true);
  });

  it("attaches an anchor id when present", () => {
    const card = parseOne(
      `^sprout-123456789
Q | Question |
A | Answer |`
    );

    expect(card.id).toBe("123456789");
    expect(card.errors).toHaveLength(0);
  });

  it("parses title field", () => {
    const card = parseOne(
      `T | My Title |
Q | Question |
A | Answer |`
    );

    expect(card.title).toBe("My Title");
  });

  it("parses groups field", () => {
    const card = parseOne(
      `Q | Question |
A | Answer |
G | Math/Algebra, Science |`
    );

    expect(card.groups).toEqual(["Math/Algebra", "Science"]);
  });
});

// ── MCQ cards ───────────────────────────────────────────────────────────────

describe("MCQ cards", () => {
  it("parses a well-formed MCQ with wrong/correct options", () => {
    const card = parseOne(
      `MCQ | What color is the sky? |
A | Blue |
O | Red |
O | Green |`
    );

    expect(card.type).toBe("mcq");
    expect(card.stem).toBe("What color is the sky?");
    expect(card.errors).toHaveLength(0);
    expect(card.options).toBeDefined();
    expect(card.options!.length).toBe(3);
    expect(card.options!.find((o) => o.isCorrect)?.text).toBe("Blue");
  });

  it("errors when no correct answer is provided", () => {
    const card = parseOne(
      `MCQ | Stem? |
O | Wrong1 |
O | Wrong2 |`
    );

    expect(card.errors.length).toBeGreaterThan(0);
  });

  it("errors when no wrong options are provided", () => {
    const card = parseOne(
      `MCQ | Stem? |
A | Correct |`
    );

    expect(card.errors.length).toBeGreaterThan(0);
  });
});

// ── Cloze cards ─────────────────────────────────────────────────────────────

describe("cloze cards", () => {
  it("parses a single cloze deletion", () => {
    const card = parseOne(`CQ | The {{c1::sun}} rises in the east. |`);

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("{{c1::sun}}");
    expect(card.errors).toHaveLength(0);
  });

  it("parses multiple cloze deletions", () => {
    const card = parseOne(
      `CQ | {{c1::Paris}} is the capital of {{c2::France}}. |`
    );

    expect(card.type).toBe("cloze");
    expect(card.clozeText).toContain("{{c1::Paris}}");
    expect(card.clozeText).toContain("{{c2::France}}");
    expect(card.errors).toHaveLength(0);
  });

  it("errors when no cloze tokens are present", () => {
    const card = parseOne(`CQ | No cloze here. |`);

    expect(card.errors.length).toBeGreaterThan(0);
    expect(card.errors.some((e) => /cloze/i.test(e))).toBe(true);
  });

  it("errors on empty cloze content", () => {
    const card = parseOne(`CQ | The {{c1::}} is empty. |`);

    expect(card.errors.length).toBeGreaterThan(0);
  });
});

// ── IO cards ────────────────────────────────────────────────────────────────

describe("IO cards", () => {
  it("parses a basic IO card with image embed", () => {
    const card = parseOne(`IO | ![[diagram.png]] |`);

    expect(card.type).toBe("io");
    expect(card.ioSrc).toContain("![[diagram.png]]");
    expect(card.errors).toHaveLength(0);
  });

  it("errors when no image embed is present", () => {
    const card = parseOne(`IO | just some text |`);

    expect(card.errors.length).toBeGreaterThan(0);
    expect(card.errors.some((e) => /image/i.test(e))).toBe(true);
  });

  it("parses IO with a prompt", () => {
    const card = parseOne(
      `IO | ![[diagram.png]] |
Q | Label the parts |`
    );

    expect(card.prompt).toBe("Label the parts");
    expect(card.errors).toHaveLength(0);
  });
});

// ── Multiple cards in one block ─────────────────────────────────────────────

describe("multiple cards", () => {
  it("parses multiple cards separated by blank lines", () => {
    const cards = parse(
      `Q | Question 1 |
A | Answer 1 |

Q | Question 2 |
A | Answer 2 |

CQ | The {{c1::sun}} sets. |`
    );

    expect(cards).toHaveLength(3);
    expect(cards[0].type).toBe("basic");
    expect(cards[1].type).toBe("basic");
    expect(cards[2].type).toBe("cloze");
  });

  it("assigns different anchors to different cards", () => {
    const cards = parse(
      `^sprout-111111111
Q | Q1 |
A | A1 |

^sprout-222222222
Q | Q2 |
A | A2 |`
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe("111111111");
    expect(cards[1].id).toBe("222222222");
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty array for empty text", () => {
    expect(parse("")).toHaveLength(0);
  });

  it("returns empty array for text with no cards", () => {
    expect(parse("Just some regular markdown notes.\n\nNothing to see here.")).toHaveLength(0);
  });

  it("ignores content inside fenced code blocks", () => {
    const cards = parse(
      `\`\`\`
Q | This is inside a fence |
A | Should be ignored |
\`\`\`

Q | Real card |
A | Real answer |`
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe("Real card");
  });
});
