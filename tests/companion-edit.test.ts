import { describe, it, expect } from "vitest";
import {
  isTestGenerationRequest,
} from "../src/views/study-assistant/chat/generation-helpers";
import { parseEditProposal, parseIntentResponse } from "../src/platform/integrations/ai/study-assistant-generator";
import { validateEditProposal, mentionsFrontmatter } from "../src/views/study-assistant/chat/edit-helpers";

// ── parseIntentResponse ─────────────────────────────────────────────────────

describe("parseIntentResponse", () => {
  it("parses 'Edit'", () => {
    expect(parseIntentResponse("Edit")).toBe("edit");
  });

  it("parses 'edit' (lowercase)", () => {
    expect(parseIntentResponse("edit")).toBe("edit");
  });

  it("parses 'EDIT' (uppercase)", () => {
    expect(parseIntentResponse("EDIT")).toBe("edit");
  });

  it("parses 'Review'", () => {
    expect(parseIntentResponse("Review")).toBe("review");
  });

  it("parses 'Generate'", () => {
    expect(parseIntentResponse("Generate")).toBe("generate");
  });

  it("parses 'Ask'", () => {
    expect(parseIntentResponse("Ask")).toBe("ask");
  });

  it("defaults to 'ask' for unrecognised text", () => {
    expect(parseIntentResponse("Something unexpected")).toBe("ask");
  });

  it("defaults to 'ask' for empty string", () => {
    expect(parseIntentResponse("")).toBe("ask");
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseIntentResponse("  Edit  ")).toBe("edit");
    expect(parseIntentResponse("\nReview\n")).toBe("review");
  });

  it("handles response with trailing explanation (e.g. 'Edit.')", () => {
    expect(parseIntentResponse("Edit.")).toBe("edit");
  });

  it("handles verbose response starting with the keyword", () => {
    expect(parseIntentResponse("Generate - user wants flashcards")).toBe("generate");
  });
});

// ── parseEditProposal ───────────────────────────────────────────────────────

describe("parseEditProposal", () => {
  it("parses valid JSON with summary and edits", () => {
    const raw = JSON.stringify({
      summary: "Fixed grammar issues",
      edits: [
        { original: "teh cat", replacement: "the cat" },
        { original: "recieve", replacement: "receive" },
      ],
    });
    const result = parseEditProposal(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Fixed grammar issues");
    expect(result!.edits).toHaveLength(2);
    expect(result!.edits[0].original).toBe("teh cat");
    expect(result!.edits[0].replacement).toBe("the cat");
  });

  it("parses JSON wrapped in markdown code fence", () => {
    const raw = '```json\n{"summary":"Fixed","edits":[{"original":"a","replacement":"b"}]}\n```';
    const result = parseEditProposal(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Fixed");
    expect(result!.edits).toHaveLength(1);
  });

  it("returns null for plain text", () => {
    expect(parseEditProposal("I cannot make any edits to this note.")).toBeNull();
  });

  it("returns null for empty summary", () => {
    const raw = JSON.stringify({ summary: "", edits: [] });
    expect(parseEditProposal(raw)).toBeNull();
  });

  it("filters out edits with missing original", () => {
    const raw = JSON.stringify({
      summary: "Some fixes",
      edits: [
        { original: "", replacement: "hello" },
        { original: "world", replacement: "world!" },
      ],
    });
    const result = parseEditProposal(raw);
    expect(result).not.toBeNull();
    expect(result!.edits).toHaveLength(1);
    expect(result!.edits[0].original).toBe("world");
  });

  it("returns null for malformed JSON", () => {
    expect(parseEditProposal("{definitely not json")).toBeNull();
  });

  it("handles empty edits array", () => {
    const raw = JSON.stringify({ summary: "Nothing to change", edits: [] });
    const result = parseEditProposal(raw);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Nothing to change");
    expect(result!.edits).toHaveLength(0);
  });
});

// ── validateEditProposal ────────────────────────────────────────────────────

describe("validateEditProposal", () => {
  const noteContent = `---
title: My Note
tags: [biology]
---

# Heading

This is a paragraph about biology. It has teh wrong spelling.

Another paragraph with good content.`;

  it("accepts edits where original is an exact substring", () => {
    const result = validateEditProposal(
      [{ original: "teh wrong", replacement: "the wrong" }],
      noteContent,
      false,
    );
    expect(result.validEdits).toHaveLength(1);
    expect(result.rejectedEdits).toHaveLength(0);
  });

  it("rejects edits where original is not found", () => {
    const result = validateEditProposal(
      [{ original: "this text does not exist", replacement: "foo" }],
      noteContent,
      false,
    );
    expect(result.validEdits).toHaveLength(0);
    expect(result.rejectedEdits).toHaveLength(1);
    expect(result.rejectionReasons[0]).toContain("not found");
  });

  it("rejects no-op edits", () => {
    const result = validateEditProposal(
      [{ original: "biology", replacement: "biology" }],
      noteContent,
      false,
    );
    expect(result.validEdits).toHaveLength(0);
    expect(result.rejectedEdits).toHaveLength(1);
    expect(result.rejectionReasons[0]).toContain("No-op");
  });

  it("rejects frontmatter edits when not allowed", () => {
    const result = validateEditProposal(
      [{ original: "title: My Note", replacement: "title: Better Title" }],
      noteContent,
      false,
    );
    expect(result.validEdits).toHaveLength(0);
    expect(result.rejectedEdits).toHaveLength(1);
    expect(result.rejectionReasons[0]).toContain("frontmatter");
  });

  it("allows frontmatter edits when allowed", () => {
    const result = validateEditProposal(
      [{ original: "title: My Note", replacement: "title: Better Title" }],
      noteContent,
      true,
    );
    expect(result.validEdits).toHaveLength(1);
    expect(result.rejectedEdits).toHaveLength(0);
  });

  it("handles mixed valid and invalid edits", () => {
    const result = validateEditProposal(
      [
        { original: "teh wrong", replacement: "the wrong" },
        { original: "nonexistent text", replacement: "foo" },
        { original: "biology", replacement: "biology" }, // no-op
      ],
      noteContent,
      false,
    );
    expect(result.validEdits).toHaveLength(1);
    expect(result.rejectedEdits).toHaveLength(2);
  });

  it("handles note without frontmatter", () => {
    const simplNote = "# Simple Note\n\nJust some content.";
    const result = validateEditProposal(
      [{ original: "Just some", replacement: "Only some" }],
      simplNote,
      false,
    );
    expect(result.validEdits).toHaveLength(1);
  });
});

// ── mentionsFrontmatter ─────────────────────────────────────────────────────

describe("mentionsFrontmatter", () => {
  it("detects 'frontmatter'", () => {
    expect(mentionsFrontmatter("Update the frontmatter")).toBe(true);
  });

  it("detects 'metadata'", () => {
    expect(mentionsFrontmatter("Fix the metadata")).toBe(true);
  });

  it("detects 'properties'", () => {
    expect(mentionsFrontmatter("Change the properties")).toBe(true);
  });

  it("detects 'tags'", () => {
    expect(mentionsFrontmatter("Update the tags")).toBe(true);
  });

  it("detects 'yaml'", () => {
    expect(mentionsFrontmatter("Fix the yaml block")).toBe(true);
  });

  it("returns false for normal text", () => {
    expect(mentionsFrontmatter("Fix the grammar")).toBe(false);
  });
});
