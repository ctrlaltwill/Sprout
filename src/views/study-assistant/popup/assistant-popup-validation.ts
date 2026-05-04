/**
 * @file src/views/study-assistant/popup/assistant-popup-validation.ts
 * @summary Module for assistant popup validation.
 *
 * @exports
 *  - validateGeneratedCardBlock
 */

import { parseCardsFromText, type ParsedCard } from "../../../engine/parser/parser";
import type { StudyAssistantSuggestion } from "../../../platform/integrations/ai/study-assistant-types";

type Tx = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

type NormalizedIoRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const MIN_IO_MASK_WIDTH = 0.015;
const MIN_IO_MASK_HEIGHT = 0.012;
const MIN_IO_MASK_AREA = 0.0002;
const MAX_IO_MASK_WIDTH = 0.65;
const MAX_IO_MASK_HEIGHT = 0.35;
const MAX_IO_MASK_AREA = 0.12;
const MAX_IO_TOTAL_AREA = 0.35;
const MAX_IO_MASK_IOU = 0.75;
const MIN_IO_PLACEMENT_CONFIDENCE = 0.72;
const LOW_VALUE_IO_IMAGE_KINDS = new Set([
  "photo",
  "decorative-photo",
  "generic-photo",
  "clinical-photo",
  "screenshot",
  "scan",
  "other",
]);

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeIoRects(value: unknown): NormalizedIoRect[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      const x = toFiniteNumber(rec.x ?? rec.normX);
      const y = toFiniteNumber(rec.y ?? rec.normY);
      const w = toFiniteNumber(rec.w ?? rec.normW);
      const h = toFiniteNumber(rec.h ?? rec.normH);
      if (x === null || y === null || w === null || h === null) return null;
      if (w <= 0 || h <= 0) return null;
      return {
        x: clamp01(x),
        y: clamp01(y),
        w: clamp01(w),
        h: clamp01(h),
      };
    })
    .filter((rect): rect is NormalizedIoRect => !!rect);
}

function rectArea(rect: NormalizedIoRect): number {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function rectIou(a: NormalizedIoRect, b: NormalizedIoRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const intersection = iw * ih;
  if (!intersection) return 0;
  const union = rectArea(a) + rectArea(b) - intersection;
  if (!union) return 0;
  return intersection / union;
}

function validateIoSuggestionQuality(
  suggestion: StudyAssistantSuggestion,
  card: ParsedCard,
  tx: Tx,
): string | null {
  const assessment = suggestion.ioAssessment;
  if (!assessment) {
    return tx(
      "ui.studyAssistant.generator.validation.ioAssessmentMissing",
      "Generated IO card was rejected by quality validation (the model did not explain why this image was suitable for IO).",
    );
  }

  if (assessment.imageKind && LOW_VALUE_IO_IMAGE_KINDS.has(assessment.imageKind)) {
    return tx(
      "ui.studyAssistant.generator.validation.ioLowYieldImage",
      "Generated IO card was rejected by quality validation (the image was classified as low-yield for IO).",
    );
  }

  if (assessment.studyValue !== "high") {
    return tx(
      "ui.studyAssistant.generator.validation.ioNotHighYield",
      "Generated IO card was rejected by quality validation (the image was not rated high-yield enough for IO).",
    );
  }

  if ((assessment.placementConfidence ?? 0) < MIN_IO_PLACEMENT_CONFIDENCE) {
    return tx(
      "ui.studyAssistant.generator.validation.ioLowConfidence",
      "Generated IO card was rejected by quality validation (mask placement confidence was too low).",
    );
  }

  const targetLabels = Array.isArray(assessment.targetLabels)
    ? assessment.targetLabels.map((label) => String(label || "").trim()).filter(Boolean)
    : [];
  if (!targetLabels.length) {
    return tx(
      "ui.studyAssistant.generator.validation.ioMissingTargets",
      "Generated IO card was rejected by quality validation (no explicit target labels were identified).",
    );
  }

  const rects = normalizeIoRects(card.occlusions ?? suggestion.ioOcclusions ?? []);
  if (!rects.length) {
    return tx(
      "ui.studyAssistant.generator.validation.ioOcclusions",
      "Generated IO card was rejected by parser validation (occlusion masks were not parsed successfully).",
    );
  }

  let totalArea = 0;
  for (const rect of rects) {
    const area = rectArea(rect);
    totalArea += area;

    if (rect.w < MIN_IO_MASK_WIDTH || rect.h < MIN_IO_MASK_HEIGHT || area < MIN_IO_MASK_AREA) {
      return tx(
        "ui.studyAssistant.generator.validation.ioMaskTooSmall",
        "Generated IO card was rejected by quality validation (at least one mask was too small to be useful).",
      );
    }

    if (rect.w > MAX_IO_MASK_WIDTH || rect.h > MAX_IO_MASK_HEIGHT || area > MAX_IO_MASK_AREA) {
      return tx(
        "ui.studyAssistant.generator.validation.ioMaskTooLarge",
        "Generated IO card was rejected by quality validation (at least one mask was too large to plausibly cover a label).",
      );
    }

    const touchesEdge = rect.x <= 0.01 || rect.y <= 0.01 || (rect.x + rect.w) >= 0.99 || (rect.y + rect.h) >= 0.99;
    if (touchesEdge && (rect.w > 0.28 || rect.h > 0.16)) {
      return tx(
        "ui.studyAssistant.generator.validation.ioMaskEdge",
        "Generated IO card was rejected by quality validation (a mask was implausibly large while pressed against the image edge).",
      );
    }
  }

  if (totalArea > MAX_IO_TOTAL_AREA) {
    return tx(
      "ui.studyAssistant.generator.validation.ioMaskCoverage",
      "Generated IO card was rejected by quality validation (the masks covered too much of the image overall).",
    );
  }

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectIou(rects[i], rects[j]) >= MAX_IO_MASK_IOU) {
        return tx(
          "ui.studyAssistant.generator.validation.ioMaskOverlap",
          "Generated IO card was rejected by quality validation (multiple masks overlapped too heavily to be distinct targets).",
        );
      }
    }
  }

  if (Math.abs(rects.length - targetLabels.length) > 1) {
    return tx(
      "ui.studyAssistant.generator.validation.ioTargetCountMismatch",
      "Generated IO card was rejected by quality validation (the number of masks did not match the identified target labels closely enough).",
    );
  }

  return null;
}

export function validateGeneratedCardBlock(
  notePath: string,
  suggestion: StudyAssistantSuggestion,
  text: string,
  tx: Tx,
): string | null {
  const parsed = parseCardsFromText(notePath, text, false);
  if (!Array.isArray(parsed.cards) || parsed.cards.length !== 1) {
    return tx(
      "ui.studyAssistant.generator.validation.cardCount",
      "Generated card was rejected by parser validation (expected exactly one card block).",
    );
  }

  const card = parsed.cards[0];
  const errors = Array.isArray(card.errors) ? card.errors.filter(Boolean) : [];
  if (errors.length) {
    return tx(
      "ui.studyAssistant.generator.validation.cardErrors",
      "Generated card was rejected by parser validation: {msg}",
      { msg: errors.join("; ") },
    );
  }

  if (card.type !== suggestion.type) {
    // Combo cards are a subtype of basic in the parser — the parser detects
    // :: / ::: delimiters and sets qVariants/aVariants/comboMode but never
    // upgrades the card type from "basic" to "combo".
    const isComboAsBasic =
      suggestion.type === "combo" &&
      card.type === "basic" &&
      Array.isArray(card.qVariants) && card.qVariants.length > 0 &&
      Array.isArray(card.aVariants) && card.aVariants.length > 0 &&
      (card.qVariants.length > 1 || card.aVariants.length > 1);
    if (!isComboAsBasic) {
      return tx(
        "ui.studyAssistant.generator.validation.typeMismatch",
        "Generated card was rejected by parser validation (type mismatch: expected {expected}, got {actual}).",
        { expected: suggestion.type, actual: card.type },
      );
    }
  }

  if (suggestion.type === "io") {
    const expectedOcclusions = Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions.length : 0;
    const parsedOcclusions = Array.isArray(card.occlusions) ? card.occlusions.length : 0;
    if (expectedOcclusions > 0 && parsedOcclusions === 0) {
      return tx(
        "ui.studyAssistant.generator.validation.ioOcclusions",
        "Generated IO card was rejected by parser validation (occlusion masks were not parsed successfully).",
      );
    }

    const ioQualityError = validateIoSuggestionQuality(suggestion, card, tx);
    if (ioQualityError) return ioQualityError;
  }

  return null;
}
