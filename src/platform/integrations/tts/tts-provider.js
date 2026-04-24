/**
 * @file src/platform/integrations/tts/tts-provider.ts
 * @summary External TTS provider abstraction. Routes text-to-speech requests
 * to ElevenLabs, OpenAI, Google Cloud TTS, or a custom HTTP endpoint.
 * Returns raw audio bytes (mp3) for playback or caching.
 *
 * @exports
 *  - requestExternalTts   — unified TTS request function returning audio ArrayBuffer
 *  - ttsProviderBaseUrl   — base URL for a given TTS provider
 *  - ttsProviderApiKey    — API key lookup for a given TTS provider
 *  - TtsProviderError     — typed error class for TTS provider failures
 */
import { requestUrl } from "obsidian";
// ── Helpers ─────────────────────────────────────────────────────
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    }
    catch (_a) {
        return false;
    }
}
// ── Error type ──────────────────────────────────────────────────
export class TtsProviderError extends Error {
    constructor(message, provider, status, detail) {
        super(message);
        this.name = "TtsProviderError";
        this.provider = provider;
        this.status = status;
        this.detail = detail;
    }
}
// ── Provider routing ────────────────────────────────────────────
export function ttsProviderBaseUrl(audio) {
    const provider = audio.ttsProvider;
    if (provider === "custom") {
        const override = String(audio.ttsEndpointOverride || "").trim();
        if (!override)
            return "";
        if (!isValidHttpUrl(override)) {
            throw new TtsProviderError("Invalid custom TTS endpoint URL: must start with https:// or http://", "custom");
        }
        return trimTrailingSlash(override);
    }
    if (provider === "elevenlabs")
        return "https://api.elevenlabs.io/v1";
    if (provider === "openai")
        return "https://api.openai.com/v1";
    if (provider === "google-cloud")
        return "https://texttospeech.googleapis.com/v1";
    return "";
}
export function ttsProviderApiKey(provider, apiKeys) {
    if (provider === "elevenlabs")
        return String(apiKeys.elevenlabs || "").trim();
    if (provider === "openai")
        return String(apiKeys.openai || "").trim();
    if (provider === "google-cloud")
        return String(apiKeys["google-cloud"] || "").trim();
    return String(apiKeys.custom || "").trim();
}
// ── Provider display labels ─────────────────────────────────────
export function formatTtsProviderLabel(provider) {
    if (provider === "browser")
        return "System (Web Speech API)";
    if (provider === "elevenlabs")
        return "ElevenLabs";
    if (provider === "openai")
        return "OpenAI";
    if (provider === "google-cloud")
        return "Google Cloud";
    if (provider === "custom")
        return "Custom endpoint";
    return provider;
}
// ── Unified request function ────────────────────────────────────
/**
 * Request audio from an external TTS provider.
 *
 * @returns Raw audio bytes as ArrayBuffer (mp3 format).
 * @throws {TtsProviderError} on configuration or HTTP errors.
 */
export async function requestExternalTts(params) {
    const { text, lang, audio } = params;
    const provider = audio.ttsProvider;
    if (provider === "browser") {
        throw new TtsProviderError("Cannot call requestExternalTts with browser provider", "browser");
    }
    const baseUrl = ttsProviderBaseUrl(audio);
    if (!baseUrl) {
        throw new TtsProviderError(provider === "custom"
            ? "Custom TTS endpoint URL is required"
            : `No base URL for TTS provider "${provider}"`, provider);
    }
    const apiKey = ttsProviderApiKey(provider, audio.ttsApiKeys);
    if (!apiKey) {
        throw new TtsProviderError(`No API key configured for TTS provider "${formatTtsProviderLabel(provider)}"`, provider);
    }
    if (provider === "elevenlabs")
        return requestElevenLabsTts(baseUrl, apiKey, text, lang, audio);
    if (provider === "openai")
        return requestOpenAiTts(baseUrl, apiKey, text, lang, audio);
    if (provider === "google-cloud")
        return requestGoogleCloudTts(baseUrl, apiKey, text, lang, audio);
    return requestCustomTts(baseUrl, apiKey, text, lang, audio);
}
// ── ElevenLabs ──────────────────────────────────────────────────
async function requestElevenLabsTts(baseUrl, apiKey, text, lang, audio) {
    var _a;
    const voiceId = audio.ttsVoiceId || "21m00Tcm4TlvDq8ikWAM"; // "Rachel" default
    const model = audio.ttsModel || "eleven_multilingual_v2";
    const url = `${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}`;
    const payload = {
        text,
        model_id: model,
        output_format: "mp3_44100_128",
    };
    // Pass language_code so ElevenLabs uses the correct accent/pronunciation
    const langCode = lang ? (_a = lang.split("-")[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase() : "";
    if (langCode)
        payload.language_code = langCode;
    const body = JSON.stringify(payload);
    try {
        const response = await requestUrl({
            url,
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            body,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new TtsProviderError(`ElevenLabs TTS request failed (HTTP ${response.status})`, "elevenlabs", response.status, typeof response.text === "string" ? response.text.slice(0, 500) : undefined);
        }
        return response.arrayBuffer;
    }
    catch (e) {
        if (e instanceof TtsProviderError)
            throw e;
        throw new TtsProviderError(`ElevenLabs TTS request failed: ${e instanceof Error ? e.message : String(e)}`, "elevenlabs");
    }
}
// ── OpenAI ──────────────────────────────────────────────────────
/** Human-readable language names used to steer OpenAI TTS pronunciation. */
const OPENAI_LANG_NAMES = {
    es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese",
    nl: "Dutch", pl: "Polish", cs: "Czech", vi: "Vietnamese", tr: "Turkish",
    sv: "Swedish", da: "Danish", nb: "Norwegian", fi: "Finnish", hu: "Hungarian",
    ro: "Romanian", id: "Indonesian", ms: "Malay", zh: "Chinese", ja: "Japanese",
    ko: "Korean", ru: "Russian", ar: "Arabic", hi: "Hindi", ur: "Urdu",
    fa: "Persian", uk: "Ukrainian", bg: "Bulgarian", sr: "Serbian",
    mr: "Marathi", ne: "Nepali", th: "Thai", el: "Greek", he: "Hebrew",
    ca: "Catalan", hr: "Croatian", sk: "Slovak", lt: "Lithuanian",
    lv: "Latvian", et: "Estonian", sl: "Slovenian", ta: "Tamil", te: "Telugu",
    bn: "Bengali", gu: "Gujarati", kn: "Kannada", ml: "Malayalam",
};
async function requestOpenAiTts(baseUrl, apiKey, text, lang, audio) {
    var _a, _b, _c;
    const voice = audio.ttsVoiceId || "alloy";
    const model = audio.ttsModel || "gpt-4o-mini-tts";
    const url = `${baseUrl}/audio/speech`;
    // Use the `instructions` field to steer language / accent without
    // adding anything to the spoken text.
    let instructions;
    if (lang) {
        const primary = (_b = (_a = lang.split("-")[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : "";
        if (primary && primary !== "en") {
            const langName = (_c = OPENAI_LANG_NAMES[primary]) !== null && _c !== void 0 ? _c : lang;
            instructions = `Speak in ${langName} with native pronunciation and accent.`;
        }
    }
    const payload = {
        model,
        input: text,
        voice,
        response_format: "mp3",
    };
    if (instructions)
        payload.instructions = instructions;
    const body = JSON.stringify(payload);
    try {
        const response = await requestUrl({
            url,
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new TtsProviderError(`OpenAI TTS request failed (HTTP ${response.status})`, "openai", response.status, typeof response.text === "string" ? response.text.slice(0, 500) : undefined);
        }
        return response.arrayBuffer;
    }
    catch (e) {
        if (e instanceof TtsProviderError)
            throw e;
        throw new TtsProviderError(`OpenAI TTS request failed: ${e instanceof Error ? e.message : String(e)}`, "openai");
    }
}
// ── Google Cloud ────────────────────────────────────────────────
async function requestGoogleCloudTts(baseUrl, apiKey, text, lang, audio) {
    const voiceName = audio.ttsVoiceId || "";
    const url = `${baseUrl}/text:synthesize?key=${encodeURIComponent(apiKey)}`;
    const voiceConfig = {
        languageCode: lang || "en-US",
    };
    if (voiceName)
        voiceConfig.name = voiceName;
    const body = JSON.stringify({
        input: { text },
        voice: voiceConfig,
        audioConfig: { audioEncoding: "MP3" },
    });
    try {
        const response = await requestUrl({
            url,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new TtsProviderError(`Google Cloud TTS request failed (HTTP ${response.status})`, "google-cloud", response.status, typeof response.text === "string" ? response.text.slice(0, 500) : undefined);
        }
        // Google returns { audioContent: "<base64>" }
        const json = response.json;
        if (!(json === null || json === void 0 ? void 0 : json.audioContent)) {
            throw new TtsProviderError("Google Cloud TTS returned no audioContent", "google-cloud", response.status);
        }
        const binaryStr = atob(json.audioContent);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return bytes.buffer;
    }
    catch (e) {
        if (e instanceof TtsProviderError)
            throw e;
        throw new TtsProviderError(`Google Cloud TTS request failed: ${e instanceof Error ? e.message : String(e)}`, "google-cloud");
    }
}
// ── Custom endpoint ─────────────────────────────────────────────
async function requestCustomTts(baseUrl, apiKey, text, lang, audio) {
    const body = JSON.stringify({
        text,
        lang,
        voice: audio.ttsVoiceId || undefined,
        model: audio.ttsModel || undefined,
        format: "mp3",
    });
    try {
        const response = await requestUrl({
            url: baseUrl,
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            body,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new TtsProviderError(`Custom TTS request failed (HTTP ${response.status})`, "custom", response.status, typeof response.text === "string" ? response.text.slice(0, 500) : undefined);
        }
        return response.arrayBuffer;
    }
    catch (e) {
        if (e instanceof TtsProviderError)
            throw e;
        throw new TtsProviderError(`Custom TTS request failed: ${e instanceof Error ? e.message : String(e)}`, "custom");
    }
}
