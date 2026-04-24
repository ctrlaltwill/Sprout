/**
 * @file tests/tts-external-playback.test.ts
 * @summary Unit tests for external TTS local playback tuning.
 */

import { describe, expect, it } from "vitest";
import { applyExternalPlaybackSettings } from "../src/platform/integrations/tts/tts-service";
import type { SproutSettings } from "../src/platform/types/settings";

function makeAudio(overrides: Partial<SproutSettings["audio"]> = {}): SproutSettings["audio"] {
  return {
    enabled: true,
    autoplay: true,
    limitToGroup: "",
    widgetReplay: true,
    gatekeeperReplay: false,
    basicQuestion: true,
    basicAnswer: true,
    reversedQuestion: true,
    reversedAnswer: true,
    clozeFront: true,
    clozeRevealed: true,
    clozeAnswerMode: "cloze-only",
    defaultLanguage: "en-US",
    autoDetectLanguage: true,
    scriptLanguages: { cyrillic: "ru-RU", arabic: "ar-SA", cjk: "zh-CN", devanagari: "hi-IN" },
    useFlagsForVoiceSelection: true,
    speakFlagLanguageLabel: false,
    rate: 1,
    pitch: 1,
    preferredVoiceURI: "",
    ttsProvider: "openai",
    ttsVoiceId: "alloy",
    ttsModel: "gpt-4o-mini-tts",
    ttsEndpointOverride: "",
    ttsCacheEnabled: true,
    ttsApiKeys: { elevenlabs: "", openai: "sk-test", "google-cloud": "", custom: "" },
    ...overrides,
  };
}

describe("applyExternalPlaybackSettings", () => {
  it("applies rate as playback speed and keeps pitch preservation enabled in fallback mode", () => {
    const audioEl = {
      playbackRate: 1,
    } as unknown as HTMLAudioElement;

    const profile = applyExternalPlaybackSettings(audioEl, makeAudio({ rate: 1.25, pitch: 1.2 }));

    expect(profile.playbackRate).toBeCloseTo(1.25, 5);
    expect(audioEl.playbackRate).toBeCloseTo(1.25, 5);
  });

  it("keeps rate-only fallback playback unchanged when pitch is normal", () => {
    const audioEl = {
      playbackRate: 1,
    } as unknown as HTMLAudioElement;

    const profile = applyExternalPlaybackSettings(audioEl, makeAudio({ rate: 1.3, pitch: 1 }));

    expect(profile.playbackRate).toBeCloseTo(1.3, 5);
    expect(audioEl.playbackRate).toBeCloseTo(1.3, 5);
  });

  it("clamps out-of-range values", () => {
    const audioEl = {
      playbackRate: 1,
    } as unknown as HTMLAudioElement;

    const profile = applyExternalPlaybackSettings(audioEl, makeAudio({ rate: 2, pitch: 2 }));

    expect(profile.playbackRate).toBe(2);
    expect(audioEl.playbackRate).toBe(2);
  });
});
