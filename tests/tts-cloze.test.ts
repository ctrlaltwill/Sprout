/**
 * @file tests/tts-cloze.test.ts
 * @summary Unit tests for cloze TTS text preparation functions.
 */

import { describe, expect, it } from "vitest";
import {
  prepareClozeTextForTts,
  extractClozeAnswerForTts,
} from "../src/platform/integrations/tts/tts-service";

// ── prepareClozeTextForTts ──────────────────────────────────────

describe("prepareClozeTextForTts", () => {
  // ── Front side (reveal = false) ───────────────────────────────

  describe("front side (reveal=false)", () => {
    it("replaces a single target cloze with 'blank'", () => {
      const input = "Struvite stones form due to infection with {{c1::urease-producing}} bacteria";
      const result = prepareClozeTextForTts(input, false, 1, "en-US");
      expect(result).toContain("blank");
      expect(result).not.toContain("urease-producing");
      expect(result).not.toContain("{{");
      expect(result).not.toContain("}}");
    });

    it("replaces all clozes with 'blank' when targetIndex is null", () => {
      const input = "{{c1::first}} and {{c2::second}}";
      const result = prepareClozeTextForTts(input, false, null, "en-US");
      expect(result).toBe("blank and blank");
    });

    it("replaces only the target cloze; non-target shows answer", () => {
      const input = "{{c1::first}} and {{c2::second}}";
      const result = prepareClozeTextForTts(input, false, 1, "en-US");
      expect(result).toBe("blank and second");
    });

    it("handles hint syntax: strips hint from non-target answer", () => {
      const input = "{{c1::answer1::hint1}} and {{c2::answer2::hint2}}";
      const result = prepareClozeTextForTts(input, false, 1, "en-US");
      expect(result).toBe("blank and answer2");
      expect(result).not.toContain("hint");
      expect(result).not.toContain("::");
    });

    it("uses localised blank word for non-English languages", () => {
      const input = "{{c1::Antwort}} ist richtig";
      const result = prepareClozeTextForTts(input, false, 1, "de-DE");
      expect(result).not.toContain("Antwort");
      expect(result).not.toContain("{{");
    });
  });

  // ── Back side (reveal = true) ─────────────────────────────────

  describe("back side (reveal=true)", () => {
    it("fills in the answer text", () => {
      const input = "Struvite stones form due to infection with {{c1::urease-producing}} bacteria";
      const result = prepareClozeTextForTts(input, true, 1, "en-US");
      expect(result).toContain("urease-producing");
      expect(result).not.toContain("{{");
      expect(result).not.toContain("}}");
      expect(result).not.toContain("blank");
    });

    it("fills in multiple cloze answers", () => {
      const input = "{{c1::first}} and {{c2::second}}";
      const result = prepareClozeTextForTts(input, true, null, "en-US");
      expect(result).toBe("first and second");
    });

    it("strips hint from answer on back side", () => {
      const input = "The {{c1::mitochondria::powerhouse organelle}} is important";
      const result = prepareClozeTextForTts(input, true, 1, "en-US");
      expect(result).toContain("mitochondria");
      expect(result).not.toContain("powerhouse organelle");
      expect(result).not.toContain("::");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns plain text when there are no cloze tokens", () => {
      const input = "Just plain text with no cloze";
      const result = prepareClozeTextForTts(input, false, null, "en-US");
      expect(result).toBe("Just plain text with no cloze");
    });

    it("strips markdown formatting from the result", () => {
      const input = "**Bold** {{c1::answer}} *italic*";
      const result = prepareClozeTextForTts(input, false, 1, "en-US");
      expect(result).toContain("Bold");
      expect(result).toContain("blank");
      expect(result).not.toContain("**");
      expect(result).not.toContain("*");
    });

    it("handles empty cloze content gracefully", () => {
      const input = "Text with {{c1::}} empty cloze";
      const result = prepareClozeTextForTts(input, false, 1, "en-US");
      expect(result).toContain("blank");
      expect(result).not.toContain("{{");
    });

    it("handles cloze with multiline content", () => {
      const input = "Start {{c1::line1\nline2}} end";
      const result = prepareClozeTextForTts(input, true, 1, "en-US");
      expect(result).toContain("line1");
      expect(result).toContain("line2");
      expect(result).not.toContain("{{");
    });

    it("safety net strips any surviving brace syntax", () => {
      // Construct a case where a malformed token might survive
      const input = "Text with {{unknown}} leftover";
      const result = prepareClozeTextForTts(input, false, null, "en-US");
      expect(result).not.toContain("{{");
      expect(result).not.toContain("}}");
    });

    it("handles many clozes in one card", () => {
      const input = "{{c1::a}}, {{c2::b}}, {{c3::c}}, {{c4::d}}";
      const result = prepareClozeTextForTts(input, false, 2, "en-US");
      expect(result).toBe("a, blank, c, d");
    });
  });
});

// ── extractClozeAnswerForTts ────────────────────────────────────

describe("extractClozeAnswerForTts", () => {
  it("extracts a single target answer", () => {
    const input = "The {{c1::mitochondria}} is the powerhouse";
    const result = extractClozeAnswerForTts(input, 1);
    expect(result).toBe("mitochondria");
  });

  it("extracts all answers when targetIndex is null", () => {
    const input = "{{c1::first}} and {{c2::second}}";
    const result = extractClozeAnswerForTts(input, null);
    expect(result).toBe("first, second");
  });

  it("extracts only the target answer", () => {
    const input = "{{c1::alpha}} {{c2::beta}} {{c3::gamma}}";
    const result = extractClozeAnswerForTts(input, 2);
    expect(result).toBe("beta");
  });

  it("strips hint from extracted answer", () => {
    const input = "{{c1::urease-producing::enzyme type}} bacteria";
    const result = extractClozeAnswerForTts(input, 1);
    expect(result).toBe("urease-producing");
    expect(result).not.toContain("enzyme type");
    expect(result).not.toContain("::");
  });

  it("returns empty string when no cloze matches target", () => {
    const input = "{{c1::answer}}";
    const result = extractClozeAnswerForTts(input, 5);
    expect(result).toBe("");
  });

  it("returns empty string for text with no cloze tokens", () => {
    const input = "Just plain text";
    const result = extractClozeAnswerForTts(input, null);
    expect(result).toBe("");
  });

  it("skips empty cloze content", () => {
    const input = "{{c1::}} and {{c2::real}}";
    const result = extractClozeAnswerForTts(input, null);
    expect(result).toBe("real");
  });

  it("handles multiple clozes with same index", () => {
    const input = "{{c1::alpha}} and {{c1::beta}}";
    const result = extractClozeAnswerForTts(input, 1);
    expect(result).toBe("alpha, beta");
  });
});
