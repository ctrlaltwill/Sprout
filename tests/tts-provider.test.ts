/**
 * @file tests/tts-provider.test.ts
 * @summary Unit tests for TTS provider request module.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestUrl } from "obsidian";
import {
  requestExternalTts,
  ttsProviderBaseUrl,
  ttsProviderApiKey,
  formatTtsProviderLabel,
  TtsProviderError,
} from "../src/platform/integrations/tts/tts-provider";
import type { SproutSettings } from "../src/platform/types/settings";

vi.mock("obsidian");

// ── Helpers ──────────────────────────────────────────────────────

function makeAudio(overrides: Partial<SproutSettings["audio"]> = {}): SproutSettings["audio"] {
  return {
    enabled: true,
    speed: 1,
    preferredVoiceURI: "",
    useFlagsForVoiceSelection: true,
    speakFlagLanguageLabel: false,
    scriptLanguages: { cyrillic: "ru-RU", arabic: "ar-SA", cjk: "zh-CN", devanagari: "hi-IN" },
    ttsProvider: "openai",
    ttsVoiceId: "alloy",
    ttsModel: "tts-1",
    ttsEndpointOverride: "",
    ttsCacheEnabled: true,
    ttsApiKeys: { elevenlabs: "", openai: "sk-test", "google-cloud": "", custom: "" },
    ...overrides,
  } as SproutSettings["audio"];
}

// ── Unit tests ───────────────────────────────────────────────────

describe("ttsProviderBaseUrl", () => {
  it("returns ElevenLabs API base", () => {
    const audio = makeAudio({ ttsProvider: "elevenlabs" });
    expect(ttsProviderBaseUrl(audio)).toBe("https://api.elevenlabs.io/v1");
  });

  it("returns OpenAI API base", () => {
    const audio = makeAudio({ ttsProvider: "openai" });
    expect(ttsProviderBaseUrl(audio)).toBe("https://api.openai.com/v1");
  });

  it("returns Google Cloud API base", () => {
    const audio = makeAudio({ ttsProvider: "google-cloud" });
    expect(ttsProviderBaseUrl(audio)).toBe("https://texttospeech.googleapis.com/v1");
  });

  it("returns custom endpoint when valid", () => {
    const audio = makeAudio({
      ttsProvider: "custom",
      ttsEndpointOverride: "https://my-tts.example.com/v1/",
    });
    expect(ttsProviderBaseUrl(audio)).toBe("https://my-tts.example.com/v1");
  });

  it("throws for invalid custom URL", () => {
    const audio = makeAudio({
      ttsProvider: "custom",
      ttsEndpointOverride: "not-a-url",
    });
    expect(() => ttsProviderBaseUrl(audio)).toThrow(TtsProviderError);
  });

  it("returns empty string for browser provider", () => {
    const audio = makeAudio({ ttsProvider: "browser" });
    expect(ttsProviderBaseUrl(audio)).toBe("");
  });
});

describe("ttsProviderApiKey", () => {
  it("returns the correct key per provider", () => {
    const keys = { elevenlabs: "el-key", openai: "oa-key", "google-cloud": "gc-key", custom: "cu-key" };
    expect(ttsProviderApiKey("elevenlabs", keys)).toBe("el-key");
    expect(ttsProviderApiKey("openai", keys)).toBe("oa-key");
    expect(ttsProviderApiKey("google-cloud", keys)).toBe("gc-key");
    expect(ttsProviderApiKey("custom", keys)).toBe("cu-key");
  });

  it("trims whitespace", () => {
    const keys = { elevenlabs: "  key  ", openai: "", "google-cloud": "", custom: "" };
    expect(ttsProviderApiKey("elevenlabs", keys)).toBe("key");
  });
});

describe("formatTtsProviderLabel", () => {
  it("maps each provider to a display label", () => {
    expect(formatTtsProviderLabel("browser")).toBe("System (Web Speech API)");
    expect(formatTtsProviderLabel("elevenlabs")).toBe("ElevenLabs");
    expect(formatTtsProviderLabel("openai")).toBe("OpenAI");
    expect(formatTtsProviderLabel("google-cloud")).toBe("Google Cloud");
    expect(formatTtsProviderLabel("custom")).toBe("Custom endpoint");
  });
});

describe("requestExternalTts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws if called with browser provider", async () => {
    const audio = makeAudio({ ttsProvider: "browser" });
    await expect(
      requestExternalTts({ text: "hello", lang: "en-US", audio }),
    ).rejects.toThrow(TtsProviderError);
  });

  it("throws if no API key is set", async () => {
    const audio = makeAudio({
      ttsProvider: "openai",
      ttsApiKeys: { elevenlabs: "", openai: "", "google-cloud": "", custom: "" },
    });
    await expect(
      requestExternalTts({ text: "hello", lang: "en-US", audio }),
    ).rejects.toThrow(/No API key/);
  });

  it("calls OpenAI /audio/speech endpoint", async () => {
    const fakeBuffer = new ArrayBuffer(16);
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      arrayBuffer: fakeBuffer,
      text: "",
      json: {},
      headers: {},
    } as any);

    const audio = makeAudio({ ttsProvider: "openai", ttsApiKeys: { elevenlabs: "", openai: "sk-test", "google-cloud": "", custom: "" } });
    const result = await requestExternalTts({ text: "Hello world", lang: "en-US", audio });

    expect(result).toBe(fakeBuffer);
    expect(requestUrl).toHaveBeenCalledOnce();
    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(call.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(call.body);
    expect(body.input).toBe("Hello world");
    expect(body.voice).toBe("alloy");
  });

  it("calls ElevenLabs text-to-speech endpoint", async () => {
    const fakeBuffer = new ArrayBuffer(8);
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      arrayBuffer: fakeBuffer,
      text: "",
      json: {},
      headers: {},
    } as any);

    const audio = makeAudio({
      ttsProvider: "elevenlabs",
      ttsVoiceId: "voice123",
      ttsModel: "eleven_multilingual_v2",
      ttsApiKeys: { elevenlabs: "el-key", openai: "", "google-cloud": "", custom: "" },
    });
    const result = await requestExternalTts({ text: "Bonjour", lang: "fr-FR", audio });

    expect(result).toBe(fakeBuffer);
    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123");
    expect(call.headers["xi-api-key"]).toBe("el-key");
  });

  it("calls Google Cloud and decodes base64 audioContent", async () => {
    const audioBytes = new Uint8Array([72, 101, 108, 108, 111]);
    const b64 = btoa(String.fromCharCode(...audioBytes));

    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      arrayBuffer: new ArrayBuffer(0),
      text: JSON.stringify({ audioContent: b64 }),
      json: { audioContent: b64 },
      headers: {},
    } as any);

    const audio = makeAudio({
      ttsProvider: "google-cloud",
      ttsApiKeys: { elevenlabs: "", openai: "", "google-cloud": "gc-key", custom: "" },
    });
    const result = await requestExternalTts({ text: "Hello", lang: "en-US", audio });

    const resultBytes = new Uint8Array(result);
    expect(resultBytes).toEqual(audioBytes);

    const call = vi.mocked(requestUrl).mock.calls[0][0] as any;
    expect(call.url).toContain("texttospeech.googleapis.com/v1/text:synthesize?key=gc-key");
  });

  it("wraps HTTP errors as TtsProviderError", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 401,
      arrayBuffer: new ArrayBuffer(0),
      text: "Unauthorized",
      json: {},
      headers: {},
    } as any);

    const audio = makeAudio({ ttsProvider: "openai", ttsApiKeys: { elevenlabs: "", openai: "sk-bad", "google-cloud": "", custom: "" } });

    await expect(
      requestExternalTts({ text: "hello", lang: "en-US", audio }),
    ).rejects.toThrow(TtsProviderError);
  });
});
