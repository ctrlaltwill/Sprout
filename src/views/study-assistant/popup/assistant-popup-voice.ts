/**
 * @file src/views/study-assistant/popup/assistant-popup-voice.ts
 * @summary Module for assistant popup voice.
 *
 * @exports
 *  - formatVoiceInputError
 */

type Tx = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

export function formatVoiceInputError(code: string, tx: Tx): string {
  if (code === "network") {
    return tx(
      "ui.studyAssistant.chat.voiceNetworkError",
      "Voice dictation backend is unreachable. In this runtime, speech recognition may require an online service. If available, use OS Dictation as fallback.",
    );
  }
  if (code === "not-allowed" || code === "service-not-allowed") {
    return tx(
      "ui.studyAssistant.chat.voicePermissionError",
      "Microphone access is blocked. Allow microphone access for Obsidian in macOS System Settings.",
    );
  }
  return tx(
    "ui.studyAssistant.chat.voiceGenericError",
    "Voice input failed ({code}).",
    { code },
  );
}
