/**
 * @file src/views/study-assistant/popup/assistant-popup-validation.ts
 * @summary Module for assistant popup validation.
 *
 * @exports
 *  - validateGeneratedCardBlock
 */

import { parseCardsFromText } from "../../../engine/parser/parser";
import type { StudyAssistantSuggestion } from "../../../platform/integrations/ai/study-assistant-types";

type Tx = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

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
    return tx(
      "ui.studyAssistant.generator.validation.typeMismatch",
      "Generated card was rejected by parser validation (type mismatch: expected {expected}, got {actual}).",
      { expected: suggestion.type, actual: card.type },
    );
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
  }

  return null;
}
