import { describe, it, expect } from "vitest";
import {
  isFlashcardRequest,
  isGenerateFlashcardRequest,
  extractRequestedGenerateCount,
  appendFlashcardDisclaimerIfNeeded,
  flashcardDisclaimerText,
  generateExcessiveCountHintText,
  shouldShowGenerateSwitch,
  shouldShowAskSwitch,
  generateNonFlashcardHintText,
} from "../src/views/study-assistant/chat/generation-helpers";

const tx = (_token: string, fallback: string, vars?: Record<string, string | number>) => {
  if (!vars) return fallback;
  let result = fallback;
  for (const [k, v] of Object.entries(vars)) result = result.replace(`{${k}}`, String(v));
  return result;
};

// ── isFlashcardRequest ──────────────────────────────────────────────────────

describe("isFlashcardRequest", () => {
  it("detects 'flashcards'", () => {
    expect(isFlashcardRequest("Make 5 flashcards")).toBe(true);
  });

  it("detects 'anki'", () => {
    expect(isFlashcardRequest("Create anki cards")).toBe(true);
  });

  it("detects pipe-delimited field patterns", () => {
    expect(isFlashcardRequest("Q | What is X?")).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(isFlashcardRequest("Tell me about biology")).toBe(false);
  });

  it("handles empty string", () => {
    expect(isFlashcardRequest("")).toBe(false);
  });
});

// ── isGenerateFlashcardRequest ──────────────────────────────────────────────

describe("isGenerateFlashcardRequest", () => {
  it("detects explicit flashcard request", () => {
    expect(isGenerateFlashcardRequest("make 5 clozes", false)).toBe(true);
  });

  it("detects 'another' with prior context", () => {
    expect(isGenerateFlashcardRequest("another one please", true)).toBe(true);
  });

  it("does not detect 'another' without prior context", () => {
    expect(isGenerateFlashcardRequest("another one please", false)).toBe(false);
  });

  it("detects 'generate cards about X'", () => {
    expect(isGenerateFlashcardRequest("generate cards about mitosis", false)).toBe(true);
  });

  it("handles empty string", () => {
    expect(isGenerateFlashcardRequest("", false)).toBe(false);
  });
});

// ── extractRequestedGenerateCount ───────────────────────────────────────────

describe("extractRequestedGenerateCount", () => {
  it("extracts count from 'make 12 clozes'", () => {
    expect(extractRequestedGenerateCount("make 12 clozes")).toBe(12);
  });

  it("extracts count from 'create 5 flashcards'", () => {
    expect(extractRequestedGenerateCount("create 5 flashcards")).toBe(5);
  });

  it("returns null when no count present", () => {
    expect(extractRequestedGenerateCount("make some flashcards")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractRequestedGenerateCount("")).toBeNull();
  });
});

// ── appendFlashcardDisclaimerIfNeeded ────────────────────────────────────────

describe("appendFlashcardDisclaimerIfNeeded", () => {
  it("appends disclaimer for flashcard requests", () => {
    const result = appendFlashcardDisclaimerIfNeeded(tx, "Here are your cards.", "make flashcards");
    expect(result).toContain(flashcardDisclaimerText(tx));
  });

  it("does not append for non-flashcard requests", () => {
    const result = appendFlashcardDisclaimerIfNeeded(tx, "Answer.", "what is biology");
    expect(result).not.toContain(flashcardDisclaimerText(tx));
  });

  it("does not double-append disclaimer", () => {
    const disclaimer = flashcardDisclaimerText(tx);
    const result = appendFlashcardDisclaimerIfNeeded(tx, `Here.\n\n${disclaimer}`, "make flashcards");
    const count = result.split(disclaimer).length - 1;
    expect(count).toBe(1);
  });
});

// ── generateExcessiveCountHintText ──────────────────────────────────────────

describe("generateExcessiveCountHintText", () => {
  it("includes the count in the message", () => {
    const result = generateExcessiveCountHintText(tx, 50);
    expect(result).toContain("50");
  });
});

// ── shouldShowGenerateSwitch / shouldShowAskSwitch ──────────────────────────

describe("shouldShowGenerateSwitch", () => {
  it("returns true when text contains the disclaimer", () => {
    const disclaimer = flashcardDisclaimerText(tx);
    expect(shouldShowGenerateSwitch(tx, `prefix ${disclaimer} suffix`)).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(shouldShowGenerateSwitch(tx, "Hello world")).toBe(false);
  });
});

describe("shouldShowAskSwitch", () => {
  it("returns true when text contains the non-flashcard hint", () => {
    const hint = generateNonFlashcardHintText(tx);
    expect(shouldShowAskSwitch(tx, `prefix ${hint} suffix`)).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(shouldShowAskSwitch(tx, "Hello world")).toBe(false);
  });
});
