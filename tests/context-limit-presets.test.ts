/**
 * @file tests/context-limit-presets.test.ts
 * @summary Unit tests for context limit presets.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import {
  getLinkedContextLimits,
  getTextAttachmentLimits,
  type ContextLimitPreset,
} from "../src/platform/integrations/ai/study-assistant-types";

describe("getLinkedContextLimits", () => {
  it("returns standard preset by default", () => {
    const limits = getLinkedContextLimits(undefined);
    expect(limits).toEqual({ maxNotes: 6, maxCharsPerNote: 8000, maxCharsTotal: 30000 });
  });

  it("returns conservative preset", () => {
    const limits = getLinkedContextLimits("conservative");
    expect(limits).toEqual({ maxNotes: 3, maxCharsPerNote: 4000, maxCharsTotal: 12000 });
  });

  it("returns standard preset", () => {
    const limits = getLinkedContextLimits("standard");
    expect(limits).toEqual({ maxNotes: 6, maxCharsPerNote: 8000, maxCharsTotal: 30000 });
  });

  it("returns extended preset", () => {
    const limits = getLinkedContextLimits("extended");
    expect(limits).toEqual({ maxNotes: 12, maxCharsPerNote: 16000, maxCharsTotal: 60000 });
  });

  it("returns no-limit preset", () => {
    const limits = getLinkedContextLimits("none");
    expect(limits.maxNotes).toBe(999);
    expect(limits.maxCharsPerNote).toBe(999_999);
    expect(limits.maxCharsTotal).toBe(999_999);
  });

  it("falls back to standard for unknown value", () => {
    const limits = getLinkedContextLimits("bogus" as ContextLimitPreset);
    expect(limits).toEqual({ maxNotes: 6, maxCharsPerNote: 8000, maxCharsTotal: 30000 });
  });
});

describe("getTextAttachmentLimits", () => {
  it("returns standard preset by default", () => {
    const limits = getTextAttachmentLimits(undefined);
    expect(limits).toEqual({ maxFiles: 6, maxCharsPerFile: 12000, maxCharsTotal: 48000 });
  });

  it("returns conservative preset", () => {
    const limits = getTextAttachmentLimits("conservative");
    expect(limits).toEqual({ maxFiles: 3, maxCharsPerFile: 6000, maxCharsTotal: 18000 });
  });

  it("returns standard preset", () => {
    const limits = getTextAttachmentLimits("standard");
    expect(limits).toEqual({ maxFiles: 6, maxCharsPerFile: 12000, maxCharsTotal: 48000 });
  });

  it("returns extended preset", () => {
    const limits = getTextAttachmentLimits("extended");
    expect(limits).toEqual({ maxFiles: 12, maxCharsPerFile: 24000, maxCharsTotal: 96000 });
  });

  it("returns no-limit preset", () => {
    const limits = getTextAttachmentLimits("none");
    expect(limits.maxFiles).toBe(999);
    expect(limits.maxCharsPerFile).toBe(999_999);
    expect(limits.maxCharsTotal).toBe(999_999);
  });

  it("falls back to standard for unknown value", () => {
    const limits = getTextAttachmentLimits("bogus" as ContextLimitPreset);
    expect(limits).toEqual({ maxFiles: 6, maxCharsPerFile: 12000, maxCharsTotal: 48000 });
  });
});
