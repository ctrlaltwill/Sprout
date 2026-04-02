/**
 * @file src/views/study-assistant/assistant-popup-generation-helpers.ts
 * @summary Module for assistant popup generation helpers.
 *
 * @exports
 *  - allFlashcardsInsertedText
 *  - appendFlashcardDisclaimerIfNeeded
 *  - extractRequestedGenerateCount
 *  - flashcardDisclaimerText
 *  - generateExcessiveCountHintText
 *  - generateNonFlashcardHintText
 */

export {
  allFlashcardsInsertedText,
  appendFlashcardDisclaimerIfNeeded,
  extractRequestedGenerateCount,
  flashcardDisclaimerText,
  generateExcessiveCountHintText,
  generateNonFlashcardHintText,
  isFlashcardRequest,
  isGenerateFlashcardRequest,
  shouldShowAskSwitch,
  shouldShowGenerateSwitch,
} from "./chat/generation-helpers";
