/**
 * @file src/tts/tts-service.ts
 * @summary Text-to-Speech service using the Web Speech API (system TTS).
 * Provides speak/stop helpers, voice selection with automatic language detection,
 * and cloze-aware text preparation that replaces blanks with a spoken word.
 *
 * @exports
 *   - TtsService — Singleton-style service class for TTS operations
 *   - getAvailableVoices — Returns the list of system TTS voices
 *   - getLanguageOptions — Returns a curated list of BCP-47 language options for the settings UI
 */

import { detectLanguage, getBlankWord } from "./language-detect";
import { requestExternalTts } from "./tts-provider";
import { ttsCacheKey, getCachedAudio, cacheAudio } from "./tts-cache";
import { Platform } from "obsidian";
import { log } from "../../core/logger";
import type { SproutSettings } from "../../types/settings";
import { getCircleFlagTokenMatches, stripCircleFlagTokens } from "../../../platform/flags/flag-tokens";

// ── TTS debug mode ─────────────────────────────────────────────
// Type  sproutTtsDebug()       in the dev console to enable.
// Type  sproutTtsDebug(false)  to disable.
// Type  sproutTtsVoices()      to dump all system voices + scores.
let _ttsDebug = false;

function ttsLog(...args: unknown[]) {
  if (_ttsDebug) log.debug("[TTS]", ...args);
}

/** Ensure voices are loaded (Electron/Chrome load them async). */
function ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) { resolve(voices); return; }
    // Wait for the async load
    const onchange = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onchange);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", onchange);
    // Safety timeout — some environments never fire the event
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 2000);
  });
}

function dumpVoiceTable(voices: SpeechSynthesisVoice[]) {
  const platform = detectPlatform();
  log.debug("[TTS] Platform report", { platform, voiceCount: voices.length });
  if (!voices.length) {
    log.warn("[TTS] No voices found. Check system spoken-content voices.");
    return;
  }
  const rows = voices
    .map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      default: v.default,
      local: v.localService,
      score: voiceQualityScore(v),
    }))
    .sort((a, b) => b.score - a.score);
  log.debug("[TTS] Voice table", rows);
}

if (typeof window !== "undefined") {
  // ── sproutTtsDebug() ──────────────────────────────────────────
  (window as unknown as Record<string, unknown>).sproutTtsDebug = (on = true) => {
    _ttsDebug = !!on;
    if (_ttsDebug) {
      log.debug("[TTS] Debug ON — voice selection will be logged for speak() calls.");
      void ensureVoicesLoaded().then((voices) => dumpVoiceTable(voices)).catch((error: unknown) => {
        log.debug("[TTS] Failed loading voices for debug table", error);
      });
      return "debug enabled — voice table loading…";
    }
    log.debug("[TTS] Debug OFF");
    return "debug disabled";
  };

  // ── sproutTtsVoices() ─────────────────────────────────────────
  (window as unknown as Record<string, unknown>).sproutTtsVoices = () => {
    void ensureVoicesLoaded().then((voices) => dumpVoiceTable(voices)).catch((error: unknown) => {
      log.debug("[TTS] Failed loading voices", error);
    });
    return "loading voices…";
  };
}

// ── Available language options for settings dropdown ────────────

export type LanguageOption = { value: string; label: string; flagCode?: string };

/** Curated list of Latin-script languages for the default language dropdown. */
export function getLanguageOptions(): LanguageOption[] {
  return [
    { value: "en-US", label: "English (US)", flagCode: "en-us" },
    { value: "en-GB", label: "English (UK)", flagCode: "en-gb" },
    { value: "en-AU", label: "English (Australia)", flagCode: "en-au" },
    { value: "es-ES", label: "Spanish (Spain)", flagCode: "es-es" },
    { value: "es-MX", label: "Spanish (Mexico)", flagCode: "es-mx" },
    { value: "fr-FR", label: "French", flagCode: "fr-fr" },
    { value: "de-DE", label: "German", flagCode: "de-de" },
    { value: "it-IT", label: "Italian", flagCode: "it-it" },
    { value: "pt-BR", label: "Portuguese (Brazil)", flagCode: "pt-br" },
    { value: "pt-PT", label: "Portuguese (Portugal)", flagCode: "pt-pt" },
    { value: "nl-NL", label: "Dutch", flagCode: "nl-nl" },
    { value: "pl-PL", label: "Polish", flagCode: "pl-pl" },
    { value: "cs-CZ", label: "Czech", flagCode: "cs-cz" },
    { value: "vi-VN", label: "Vietnamese", flagCode: "vi-vn" },
    { value: "tr-TR", label: "Turkish", flagCode: "tr-tr" },
    { value: "sv-SE", label: "Swedish", flagCode: "sv-se" },
    { value: "da-DK", label: "Danish", flagCode: "da-dk" },
    { value: "nb-NO", label: "Norwegian", flagCode: "nb-no" },
    { value: "fi-FI", label: "Finnish", flagCode: "fi-fi" },
    { value: "hu-HU", label: "Hungarian", flagCode: "hu-hu" },
    { value: "ro-RO", label: "Romanian", flagCode: "ro-ro" },
    { value: "id-ID", label: "Indonesian", flagCode: "id-id" },
    { value: "ms-MY", label: "Malay", flagCode: "ms-my" },
  ];
}

/** Script key → options for the per-script language dropdown in settings. */
export type ScriptKey = "cyrillic" | "arabic" | "cjk" | "devanagari";

export interface ScriptGroupOption {
  key: ScriptKey;
  label: string;
  description: string;
  languages: LanguageOption[];
}

/** Returns the configurable script-language groups for the settings UI. */
export function getScriptLanguageGroups(): ScriptGroupOption[] {
  return [
    {
      key: "arabic",
      label: "Arabic script — عربي",
      description: "Choose the accent and pronunciation for Arabic-script text.",
      languages: [
        { value: "ar-SA", label: "Arabic (العربية)", flagCode: "ar-sa" },
        { value: "fa-IR", label: "Persian / Farsi (فارسی)", flagCode: "fa-ir" },
        { value: "ur-PK", label: "Urdu (اردو)", flagCode: "ur-pk" },
      ],
    },
    {
      key: "cjk",
      label: "Chinese characters — 汉字 / 漢字",
      description: "Choose the accent and pronunciation for Chinese characters.",
      languages: [
        { value: "zh-CN", label: "Simplified Chinese (简体中文)", flagCode: "zh-cn" },
        { value: "zh-TW", label: "Traditional Chinese (繁體中文)", flagCode: "zh-tw" },
      ],
    },
    {
      key: "cyrillic",
      label: "Cyrillic script — Кирилица",
      description: "Choose the accent and pronunciation for Cyrillic text.",
      languages: [
        { value: "ru-RU", label: "Russian (Русский)", flagCode: "ru-ru" },
        { value: "uk-UA", label: "Ukrainian (Українська)", flagCode: "uk-ua" },
        { value: "bg-BG", label: "Bulgarian (Български)", flagCode: "bg-bg" },
        { value: "sr-RS", label: "Serbian (Српски)", flagCode: "sr-rs" },
        { value: "mk-MK", label: "Macedonian (Македонски)", flagCode: "mk-mk" },
        { value: "be-BY", label: "Belarusian (Беларуская)", flagCode: "be-by" },
      ],
    },
    {
      key: "devanagari",
      label: "Devanagari script — देवनागरी",
      description: "Choose the accent and pronunciation for Devanagari text.",
      languages: [
        { value: "hi-IN", label: "Hindi (हिन्दी)", flagCode: "hi-in" },
        { value: "mr-IN", label: "Marathi (मराठी)", flagCode: "mr-in" },
        { value: "ne-NP", label: "Nepali (नेपाली)", flagCode: "ne-np" },
      ],
    },
  ];
}

// ── Voice cache ──────────────────────────────────────────────────
// Electron loads voices asynchronously. We cache them so pickVoice always has data.
let _voiceCache: SpeechSynthesisVoice[] = [];

function _refreshVoiceCache(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) _voiceCache = voices;
  return _voiceCache;
}

// Warm-up: listen for voiceschanged to populate cache early
if (typeof window !== "undefined" && window.speechSynthesis) {
  _refreshVoiceCache();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    _refreshVoiceCache();
    ttsLog(`Voice cache refreshed: ${_voiceCache.length} voice(s)`);
  });
}

// ── Voice helpers ───────────────────────────────────────────────

/** Returns all system voices (from cache, with a sync refresh attempt). */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  return _refreshVoiceCache();
}

/**
 * Detect the current platform from Obsidian Platform flags.
 * Returns 'mac', 'ios', 'android', 'windows', or 'other'.
 */
function detectPlatform(): "mac" | "ios" | "android" | "windows" | "other" {
  if (Platform.isMacOS) return "mac";
  if (Platform.isIosApp) return "ios";
  if (Platform.isAndroidApp) return "android";
  if (Platform.isWin) return "windows";
  return "other";
}

// ── Per-language preferred voice names per platform ─────────────
// Each entry maps a BCP-47 primary language to an ordered list of preferred
// voice *name fragments* (case-insensitive substring match). The first match wins.
// This ensures the best native voice is always picked for each language.

type VoicePreferenceMap = Record<string, string[]>;

/**
 * macOS & iOS — Apple ships named character voices.
 * Preference order: Premium/Enhanced neural voices (best), then Siri, then
 * well-known named voices per language. Compact/legacy are penalised separately.
 */
const APPLE_VOICE_PREFS: VoicePreferenceMap = {
  // English — regional variants
  en: ["samantha (premium)", "samantha (enhanced)", "siri", "samantha", "alex"],
  "en-us": ["samantha (premium)", "samantha (enhanced)", "siri", "samantha", "alex"],
  "en-gb": ["daniel (premium)", "daniel (enhanced)", "siri", "daniel", "kate", "serena"],
  "en-au": ["karen (premium)", "karen (enhanced)", "siri", "karen", "lee"],
  // Chinese — Mandarin vs Cantonese
  zh: ["tingting (premium)", "tingting (enhanced)", "siri", "tingting", "sinji", "meijia"],
  "zh-cn": ["tingting (premium)", "tingting (enhanced)", "siri", "tingting", "lili"],
  "zh-tw": ["meijia (premium)", "meijia (enhanced)", "siri", "meijia"],
  // Japanese
  ja: ["kyoko (premium)", "kyoko (enhanced)", "siri", "kyoko", "otoya"],
  // Korean
  ko: ["yuna (premium)", "yuna (enhanced)", "siri", "yuna"],
  // Spanish — Spain vs Latin America
  es: ["marisol (premium)", "marisol (enhanced)", "monica (premium)", "monica (enhanced)", "siri", "marisol", "monica", "paulina", "jorge"],
  "es-es": ["jimena (premium)", "jimena (enhanced)", "marisol (premium)", "marisol (enhanced)", "jorge (premium)", "jorge (enhanced)", "siri", "jimena", "marisol", "jorge"],
  "es-mx": ["paulina (premium)", "paulina (enhanced)", "monica (premium)", "monica (enhanced)", "siri", "paulina", "monica", "juan"],
  // French
  fr: ["thomas (premium)", "thomas (enhanced)", "amelie (premium)", "amelie (enhanced)", "siri", "thomas", "amelie", "audrey"],
  // German
  de: ["anna (premium)", "anna (enhanced)", "siri", "anna", "petra", "markus"],
  // Italian
  it: ["alice (premium)", "alice (enhanced)", "siri", "alice", "luca", "federica"],
  // Portuguese — Brazil vs Portugal
  pt: ["luciana (premium)", "luciana (enhanced)", "siri", "luciana", "joana", "felipe"],
  "pt-br": ["luciana (premium)", "luciana (enhanced)", "siri", "luciana", "felipe"],
  "pt-pt": ["joana (premium)", "joana (enhanced)", "siri", "joana", "catarina"],
  // Russian
  ru: ["milena (premium)", "milena (enhanced)", "siri", "milena", "katya", "yuri"],
  // Arabic
  ar: ["maged (premium)", "maged (enhanced)", "siri", "maged", "mariam"],
  // Hindi
  hi: ["lekha (premium)", "lekha (enhanced)", "siri", "lekha"],
  // Dutch
  nl: ["xander (premium)", "xander (enhanced)", "siri", "xander", "claire"],
  // Polish
  pl: ["zosia (premium)", "zosia (enhanced)", "siri", "zosia", "ewa"],
  // Turkish
  tr: ["yelda (premium)", "yelda (enhanced)", "siri", "yelda", "cem"],
  // Swedish
  sv: ["alva (premium)", "alva (enhanced)", "siri", "alva", "klara"],
  // Danish
  da: ["sara (premium)", "sara (enhanced)", "siri", "sara", "magnus"],
  // Norwegian
  nb: ["nora (premium)", "nora (enhanced)", "siri", "nora", "henrik"],
  no: ["nora (premium)", "nora (enhanced)", "siri", "nora", "henrik"],
  // Finnish
  fi: ["satu (premium)", "satu (enhanced)", "siri", "satu", "onni"],
  // Czech
  cs: ["zuzana (premium)", "zuzana (enhanced)", "siri", "zuzana", "iveta"],
  // Greek
  el: ["melina (premium)", "melina (enhanced)", "siri", "melina", "nikos"],
  // Hebrew
  he: ["carmit (premium)", "carmit (enhanced)", "siri", "carmit"],
  // Hungarian
  hu: ["tünde (premium)", "tünde (enhanced)", "siri", "tünde", "mariska"],
  // Romanian
  ro: ["ioana (premium)", "ioana (enhanced)", "siri", "ioana"],
  // Thai
  th: ["kanya (premium)", "kanya (enhanced)", "siri", "kanya", "narisa"],
  // Vietnamese
  vi: ["linh (premium)", "linh (enhanced)", "siri", "linh"],
  // Indonesian / Malay
  id: ["damayanti (premium)", "damayanti (enhanced)", "siri", "damayanti"],
  ms: ["amira (premium)", "amira (enhanced)", "siri", "amira"],
  // Ukrainian
  uk: ["lesya (premium)", "lesya (enhanced)", "siri", "lesya"],
  // Bengali
  bn: ["siri"],
  // Tamil
  ta: ["siri"],
  // Telugu
  te: ["siri"],
  // Persian / Farsi
  fa: ["siri"],
  // Urdu
  ur: ["siri"],
  // Bulgarian
  bg: ["siri", "daria"],
  // Serbian
  sr: ["siri"],
  // Macedonian
  mk: ["siri"],
  // Belarusian
  be: ["siri"],
  // Marathi
  mr: ["siri"],
  // Nepali
  ne: ["siri"],
};

/**
 * Windows — Microsoft names voices "Microsoft <Name> Online (Natural)".
 * Natural/Online voices are neural-quality. Standard OneCore voices are fallback.
 */
const WINDOWS_VOICE_PREFS: VoicePreferenceMap = {
  en: ["jenny", "aria", "guy", "michelle", "steffan", "ryan", "sonia", "libby"],
  "en-us": ["jenny", "aria", "guy", "michelle", "steffan"],
  "en-gb": ["sonia", "ryan", "libby", "thomas"],
  "en-au": ["natasha", "william"],
  zh: ["xiaoxiao", "xiaoyi", "yunjian", "yunxi", "yunhao", "yunyang", "huihui"],
  "zh-cn": ["xiaoxiao", "xiaoyi", "yunjian", "yunxi", "yunhao", "yunyang", "huihui"],
  "zh-tw": ["hsiaochan", "hsiaoyu", "yunjhe"],
  ja: ["nanami", "keita", "ayumi", "ichiro", "haruka"],
  ko: ["sunhi", "innjoon", "heami"],
  es: ["elvira", "jorge", "dalia", "laura", "pablo"],
  "es-es": ["elvira", "alvaro"],
  "es-mx": ["dalia", "jorge", "laura"],
  fr: ["denise", "henri", "eloise", "sylvie", "antoine"],
  de: ["katja", "conrad", "amala", "stefan", "hedda"],
  it: ["elsa", "isabella", "diego", "giuseppe", "cosimo"],
  pt: ["francisca", "antonio", "maria", "daniel"],
  "pt-br": ["francisca", "antonio", "thalita"],
  "pt-pt": ["raquel", "duarte"],
  ru: ["svetlana", "dmitry", "dariya", "irina", "pavel"],
  ar: ["hoda", "salma", "zariyah", "naayf"],
  hi: ["swara", "madhur", "hemant", "kalpana"],
  nl: ["colette", "fenna", "maarten"],
  pl: ["agnieszka", "marek", "zofia", "paulina"],
  tr: ["emel", "ahmet"],
  sv: ["sofie", "mattias", "hillevi"],
  da: ["christel", "jeppe", "helle"],
  nb: ["pernille", "finn", "iselin"],
  no: ["pernille", "finn", "iselin"],
  fi: ["noora", "selma", "harri", "heidi"],
  cs: ["vlasta", "antonin", "jakub"],
  el: ["athina", "nestoras", "stefanos"],
  he: ["hila", "avri", "asaf"],
  hu: ["noemi", "tamas", "szabolcs"],
  ro: ["alina", "emil"],
  th: ["premwadee", "niwat", "achara"],
  vi: ["hoaimy", "namminh"],
  id: ["gadis", "ardi"],
  ms: ["yasmin", "osman"],
  uk: ["polina", "ostap"],
  bn: ["nabanita", "bashkar", "tanishaa"],
  ta: ["pallavi", "valluvar"],
  te: ["mohan", "shruti"],
  // Persian / Farsi
  fa: ["dilara", "farid"],
  // Urdu
  ur: ["uzma", "asad"],
  // Bulgarian
  bg: ["borislav", "kalina"],
  // Serbian
  sr: ["nicholas", "sophie"],
  // Marathi
  mr: ["aarohi", "manohar"],
  // Nepali
  ne: ["hemkala", "sagar"],
};

/**
 * Android — Google TTS engine voices.
 * Google names most voices by locale (e.g. "Google 日本語").
 * We match on substrings. Network/neural variants are preferred.
 */
const ANDROID_VOICE_PREFS: VoicePreferenceMap = {
  en: ["google us english", "google uk english", "google english"],
  zh: ["google 普通话", "google 中文", "google mandarin", "google chinese"],
  ja: ["google 日本語", "google japanese"],
  ko: ["google 한국어", "google korean"],
  es: ["google español", "google spanish"],
  fr: ["google français", "google french"],
  de: ["google deutsch", "google german"],
  it: ["google italiano", "google italian"],
  pt: ["google português", "google portuguese"],
  ru: ["google русский", "google russian"],
  ar: ["google العربية", "google arabic"],
  hi: ["google हिन्दी", "google hindi"],
  nl: ["google nederlands", "google dutch"],
  pl: ["google polski", "google polish"],
  tr: ["google türkçe", "google turkish"],
  sv: ["google svenska", "google swedish"],
  da: ["google dansk", "google danish"],
  nb: ["google norsk", "google norwegian"],
  no: ["google norsk", "google norwegian"],
  fi: ["google suomi", "google finnish"],
  cs: ["google čeština", "google czech"],
  el: ["google ελληνικά", "google greek"],
  he: ["google עברית", "google hebrew"],
  hu: ["google magyar", "google hungarian"],
  ro: ["google română", "google romanian"],
  th: ["google ไทย", "google thai"],
  vi: ["google tiếng việt", "google vietnamese"],
  id: ["google bahasa indonesia", "google indonesian"],
  ms: ["google bahasa melayu", "google malay"],
  uk: ["google українська", "google ukrainian"],
  bn: ["google বাংলা", "google bengali"],
  ta: ["google தமிழ்", "google tamil"],
  te: ["google తెలుగு", "google telugu"],
  fa: ["google فارسی", "google persian"],
  ur: ["google اردو", "google urdu"],
  bg: ["google български", "google bulgarian"],
  sr: ["google српски", "google serbian"],
  mr: ["google मराठी", "google marathi"],
  ne: ["google नेपाली", "google nepali"],
};

// ── Script-to-language resolution ───────────────────────────────
// Maps the default BCP-47 tag returned by detectLanguage() for ambiguous scripts
// to the corresponding key in settings.audio.scriptLanguages.
const DETECTED_LANG_TO_SCRIPT: Record<string, "cyrillic" | "arabic" | "cjk" | "devanagari"> = {
  ru: "cyrillic",
  ar: "arabic",
  "zh-cn": "cjk",
  hi: "devanagari",
};

/**
 * Resolve a detected language through the user's script-language preferences.
 * If the detected language maps to an ambiguous script, return the user's chosen
 * language for that script. Otherwise return the detected language unchanged.
 */
function resolveDetectedLanguage(
  detected: string,
  scriptLangs?: SproutSettings["audio"]["scriptLanguages"],
): string {
  if (!scriptLangs) return detected;
  const key = DETECTED_LANG_TO_SCRIPT[detected.toLowerCase()];
  if (key) {
    return scriptLangs[key] || detected;
  }
  return detected;
}

const FLAG_CODE_TO_LOCALE: Record<string, string> = {
  us: "en-US",
  gb: "en-GB",
  uk: "en-GB",
  au: "en-AU",
  mx: "es-MX",
  es: "es-ES",
  br: "pt-BR",
  pt: "pt-PT",
  cn: "zh-CN",
  tw: "zh-TW",
  jp: "ja-JP",
  kr: "ko-KR",
  ru: "ru-RU",
  sa: "ar-SA",
  in: "hi-IN",
};

const PRIMARY_LANG_DEFAULT_LOCALE: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-BR",
  nl: "nl-NL",
  pl: "pl-PL",
  cs: "cs-CZ",
  vi: "vi-VN",
  tr: "tr-TR",
  sv: "sv-SE",
  da: "da-DK",
  nb: "nb-NO",
  fi: "fi-FI",
  hu: "hu-HU",
  ro: "ro-RO",
  id: "id-ID",
  ms: "ms-MY",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  ru: "ru-RU",
  ar: "ar-SA",
  hi: "hi-IN",
  ur: "ur-PK",
  fa: "fa-IR",
  uk: "uk-UA",
  bg: "bg-BG",
  sr: "sr-RS",
  mr: "mr-IN",
  ne: "ne-NP",
};

const SPOKEN_LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  cs: "Czech",
  vi: "Vietnamese",
  tr: "Turkish",
  sv: "Swedish",
  da: "Danish",
  nb: "Norwegian",
  fi: "Finnish",
  hu: "Hungarian",
  ro: "Romanian",
  id: "Indonesian",
  ms: "Malay",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  ur: "Urdu",
  fa: "Persian",
  uk: "Ukrainian",
  bg: "Bulgarian",
  sr: "Serbian",
  mr: "Marathi",
  ne: "Nepali",
};

function normaliseLocaleTag(tag: string): string {
  const raw = String(tag ?? "").trim();
  if (!raw) return "";
  const [primary, region] = raw.split("-");
  if (!primary) return "";
  const p = primary.toLowerCase();
  if (!region) return p;
  return `${p}-${region.toUpperCase()}`;
}

function languageFromFlagCode(flagCode: string, fallbackLanguage: string): string | null {
  const code = String(flagCode ?? "").trim().toLowerCase();
  if (!code) return null;

  if (FLAG_CODE_TO_LOCALE[code]) return FLAG_CODE_TO_LOCALE[code];

  if (code.includes("-")) {
    const [primary, region] = code.split("-");
    if (!primary || !region) return null;
    return `${primary.toLowerCase()}-${region.toUpperCase()}`;
  }

  const [fallbackPrimary] = normaliseLocaleTag(fallbackLanguage).split("-");
  if (fallbackPrimary && fallbackPrimary === code) {
    return normaliseLocaleTag(fallbackLanguage);
  }

  return PRIMARY_LANG_DEFAULT_LOCALE[code] ?? null;
}

function spokenLanguageLabel(lang: string): string {
  const primary = normaliseLocaleTag(lang).split("-")[0] || "";
  return SPOKEN_LANGUAGE_LABELS[primary] ?? lang;
}

/**
 * Score a voice for quality, factoring in the **target language**.
 * Higher = better.
 *
 * The scoring system works in two layers:
 *
 * 1. **Language-specific preferred voice bonus (0–200)**
 *    Each platform has a curated ordered list of known best voices per language.
 *    The first match in the list gets the highest bonus (200), decreasing by 10
 *    for each subsequent entry. This ensures e.g. Tingting is picked for Mandarin,
 *    Kyoko for Japanese, Alice for Italian on macOS.
 *
 * 2. **Generic quality signals (±small values)**
 *    Premium/Enhanced/Natural keywords, system default, local service, etc.
 *    These act as tiebreakers when no preferred voice name matches.
 *
 * This approach guarantees the best native voice per language while still handling
 * unknown / newly-added voices gracefully.
 */
function voiceQualityScore(v: SpeechSynthesisVoice, targetLang?: string): number {
  let score = 0;
  const name = v.name.toLowerCase();
  const uri = (v.voiceURI ?? "").toLowerCase();
  const platform = detectPlatform();

  // ── Language-specific preferred voice matching ──────────────────
  if (targetLang) {
    const full = targetLang.toLowerCase(); // e.g. "es-es"
    const primary = full.split("-")[0];     // e.g. "es"
    let prefs: string[] | undefined;

    if (platform === "mac" || platform === "ios") {
      prefs = APPLE_VOICE_PREFS[full] ?? APPLE_VOICE_PREFS[primary];
    } else if (platform === "windows") {
      prefs = WINDOWS_VOICE_PREFS[full] ?? WINDOWS_VOICE_PREFS[primary];
    } else if (platform === "android") {
      prefs = ANDROID_VOICE_PREFS[full] ?? ANDROID_VOICE_PREFS[primary];
    }

    if (prefs) {
      for (let i = 0; i < prefs.length; i++) {
        if (name.includes(prefs[i]) || uri.includes(prefs[i])) {
          score += 200 - i * 10; // First choice = 200, second = 190, etc.
          break;
        }
      }
    }
  }

  // ── Apple (macOS & iOS) generic quality ────────────────────────
  if (platform === "mac" || platform === "ios") {
    if (name.includes("premium") || uri.includes("premium")) score += 60;
    if (name.includes("enhanced") || uri.includes("enhanced")) score += 50;
    if (name.includes("siri")) score += 45;
    if (name.includes("personal")) score += 40;
    if (name.includes("compact") || uri.includes("compact")) score -= 30;
    if (!name.includes("enhanced") && !name.includes("premium") && !name.includes("siri")) {
      score -= 5;
    }
  }

  // ── Windows generic quality ────────────────────────────────────
  if (platform === "windows") {
    if (name.includes("online") && name.includes("natural")) score += 60;
    if (name.includes("neural")) score += 55;
    if (name.includes("online")) score += 40;
    if (name.includes("microsoft") && !name.includes("desktop")) score += 20;
    if (name.includes("desktop")) score -= 20;
  }

  // ── Android generic quality ────────────────────────────────────
  if (platform === "android") {
    if (name.includes("neural") || name.includes("natural")) score += 50;
    if (name.includes("google")) score += 30;
    if (name.includes("network") || uri.includes("network")) score += 25;
    if (name.includes("samsung")) score += 10;
  }

  // ── Cross-platform bonuses ─────────────────────────────────────
  if (name.includes("neural") || name.includes("natural")) score += 15;
  if (name.includes("cloud")) score += 10;
  if (v.default) score += 8;
  if (v.localService) score += 2;

  return score;
}

/**
 * Try to find the best system voice matching the given BCP-47 language tag.
 * Preference order:
 *  1. Exact lang match — pick the highest-quality voice
 *  2. Primary subtag match — pick the highest-quality voice
 *  3. null (let speechSynthesis use its default)
 *
 * Within each tier, voices are ranked by language-aware quality scoring so the
 * best native voice is always selected per language (e.g. Tingting for Mandarin,
 * Kyoko for Japanese, Alice for Italian on macOS).
 */
function pickVoice(lang: string, preferredURI?: string): SpeechSynthesisVoice | null {
  const voices = getAvailableVoices();
  if (!voices.length || !lang) {
    ttsLog("pickVoice — no voices available or no lang provided");
    return null;
  }

  // ── 1. Honour the user’s explicit preferred voice if set ─────────
  if (preferredURI) {
    const preferred = voices.find((v) => v.voiceURI === preferredURI);
    if (preferred) {
      ttsLog(`pickVoice(“${lang}”) — using preferred voice: "${preferred.name}" (URI: ${preferred.voiceURI})`);
      return preferred;
    }
    ttsLog(`pickVoice(“${lang}”) — preferred URI "${preferredURI}" not found, falling back to auto-select.`);
  }

  const target = lang.toLowerCase();
  const primary = target.split("-")[0];

  // Language-aware scorer
  const scoreFor = (v: SpeechSynthesisVoice) => voiceQualityScore(v, lang);

  const scoredAll = _ttsDebug
    ? voices.map((v) => ({ voice: v, score: scoreFor(v) }))
    : [];

  // Collect exact matches
  const exact = voices.filter((v) => v.lang.toLowerCase() === target);
  // Collect primary-subtag matches (e.g. "es" matches both "es-ES" and "es-MX")
  const partial = voices.filter((v) => v.lang.toLowerCase().startsWith(primary) && v.lang.toLowerCase() !== target);

  if (exact.length) {
    const sorted = exact.sort((a, b) => scoreFor(b) - scoreFor(a));
    const winner = sorted[0];
    const winnerScore = scoreFor(winner);

    // If the best exact match is low-quality (no premium/enhanced/siri voice found),
    // check whether a closely-related regional voice is significantly better.
    // This prevents picking e.g. a robotic es-ES voice when a premium es-MX voice
    // is available, since both are mutually intelligible.
    const QUALITY_FLOOR = 100;
    if (winnerScore < QUALITY_FLOOR && partial.length) {
      const partialSorted = partial.sort((a, b) => scoreFor(b) - scoreFor(a));
      const partialBest = partialSorted[0];
      const partialBestScore = scoreFor(partialBest);
      if (partialBestScore >= QUALITY_FLOOR) {
        ttsLog(
          `pickVoice("${lang}") — exact winner "${winner.name}" scored ${winnerScore} (below ${QUALITY_FLOOR}). ` +
          `Using higher-quality regional voice "${partialBest.name}" (score ${partialBestScore}) instead.`,
        );
        if (_ttsDebug) {
          log.debug(
            "[TTS] Exact + partial ranked voices",
            [...sorted, ...partialSorted].map((v) => ({ name: v.name, lang: v.lang, score: scoreFor(v), uri: v.voiceURI })),
          );
        }
        return partialBest;
      }
    }

    ttsLog(`pickVoice("${lang}") — ${exact.length} exact match(es). Winner: "${winner.name}" (score ${winnerScore})`);
    if (_ttsDebug) {
      log.debug(
        "[TTS] Exact-match ranked voices",
        sorted.map((v) => ({ name: v.name, lang: v.lang, score: scoreFor(v), uri: v.voiceURI })),
      );
    }
    return winner;
  }

  if (partial.length) {
    const sorted = partial.sort((a, b) => scoreFor(b) - scoreFor(a));
    const winner = sorted[0];
    ttsLog(`pickVoice("${lang}") — no exact match; ${partial.length} partial match(es) for "${primary}". Winner: "${winner.name}" (score ${scoreFor(winner)})`);
    if (_ttsDebug) {
      log.debug(
        "[TTS] Partial-match ranked voices",
        sorted.map((v) => ({ name: v.name, lang: v.lang, score: scoreFor(v), uri: v.voiceURI })),
      );
    }
    return winner;
  }

  ttsLog(`pickVoice("${lang}") — no matching voices found. Falling back to speechSynthesis default.`);
  if (_ttsDebug && scoredAll.length) {
    log.debug("[TTS] All voices scored", 
      scoredAll
        .sort((a, b) => b.score - a.score)
        .map(({ voice: v, score }) => ({ name: v.name, lang: v.lang, score, uri: v.voiceURI })),
    );
  }
  return null;
}

// ── Text preparation ────────────────────────────────────────────

/**
 * Map of symbols / special characters → spoken words.
 * Applied after HTML is stripped so we catch literal characters.
 */
const SYMBOL_SPEECH_MAP: Array<[RegExp, string]> = [
  // Arrows
  [/→|➜|➔|⟶|⇒/g, " yields "],
  [/←|⟵|⇐/g, " from "],
  [/↔|⟷|⇔/g, " reversible with "],
  [/↑/g, " up "],
  [/↓/g, " down "],
  // Math operators (multi-char first)
  [/≥|⩾/g, " greater than or equal to "],
  [/≤|⩽/g, " less than or equal to "],
  [/≠|≢/g, " not equal to "],
  [/≈/g, " approximately equal to "],
  [/±/g, " plus or minus "],
  [/∓/g, " minus or plus "],
  [/×/g, " times "],
  [/÷/g, " divided by "],
  [/∞/g, " infinity "],
  [/√/g, " square root of "],
  [/∑/g, " sum of "],
  [/∏/g, " product of "],
  [/∫/g, " integral of "],
  [/∂/g, " partial "],
  [/Δ/g, " delta "],
  [/∇/g, " nabla "],
  // Comparison / equality — only standalone, not inside words
  [/(^|\s)=(?=\s|$)/g, "$1equals "],
  [/(^|\s)\+(?=\s|$)/g, "$1plus "],
  [/(^|\s)-(?=\s|$)/g, "$1minus "],
  [/(^|\s)<(?=\s|$)/g, "$1less than "],
  [/(^|\s)>(?=\s|$)/g, "$1greater than "],
  // Subscript / superscript markers (common in chemistry)
  [/₂/g, "2"],
  [/₃/g, "3"],
  [/₄/g, "4"],
  [/²/g, " squared"],
  [/³/g, " cubed"],
  // Greek letters commonly found in science cards
  [/α/g, " alpha "],
  [/β/g, " beta "],
  [/γ/g, " gamma "],
  [/δ/g, " delta "],
  [/ε/g, " epsilon "],
  [/θ/g, " theta "],
  [/λ/g, " lambda "],
  [/μ/g, " mu "],
  [/π/g, " pi "],
  [/σ/g, " sigma "],
  [/τ/g, " tau "],
  [/φ/g, " phi "],
  [/ω/g, " omega "],
  // Misc
  [/°/g, " degrees "],
  [/‰/g, " per mille "],
  [/%/g, " percent "],
  [/&/g, " and "],
  [/\|/g, ", "],
];

/** Replace symbols and special characters with spoken equivalents. */
function replaceSymbolsForSpeech(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SYMBOL_SPEECH_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Convert common LaTeX expressions to natural language for TTS.
 * Handles fractions, superscripts, subscripts, roots, and common commands.
 */
function latexToSpeech(latex: string): string {
  let result = latex;

  // Fractions: \frac{a}{b} → "a over b"
  result = result.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1 over $2");
  
  // Square root: \sqrt{x} → "square root of x"
  result = result.replace(/\\sqrt\{([^}]*)\}/g, "square root of $1");
  
  // N-th root: \sqrt[n]{x} → "n-th root of x"
  result = result.replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, "$1-th root of $2");
  
  // Superscripts: x^{2} or x^2 → "x squared" (special cases), otherwise "x to the power of 2"
  result = result.replace(/\^2(?![0-9])/g, " squared");
  result = result.replace(/\^3(?![0-9])/g, " cubed");
  result = result.replace(/\^\{([^}]*)\}/g, " to the power of $1");
  result = result.replace(/\^(\w)/g, " to the power of $1");
  
  // Subscripts: x_{n} or x_n → "x sub n"
  result = result.replace(/_\{([^}]*)\}/g, " sub $1");
  result = result.replace(/_(\w)/g, " sub $1");
  
  // Sum: \sum → "sum"
  result = result.replace(/\\sum/g, " sum ");
  
  // Product: \prod → "product"
  result = result.replace(/\\prod/g, " product ");
  
  // Integral: \int → "integral"
  result = result.replace(/\\int/g, " integral ");
  
  // Limits: \lim → "limit"
  result = result.replace(/\\lim/g, " limit ");
  
  // Infinity: \infty → "infinity"
  result = result.replace(/\\infty/g, " infinity ");
  
  // Greek letters (common ones)
  result = result.replace(/\\alpha/g, " alpha ");
  result = result.replace(/\\beta/g, " beta ");
  result = result.replace(/\\gamma/g, " gamma ");
  result = result.replace(/\\delta/g, " delta ");
  result = result.replace(/\\epsilon/g, " epsilon ");
  result = result.replace(/\\theta/g, " theta ");
  result = result.replace(/\\lambda/g, " lambda ");
  result = result.replace(/\\mu/g, " mu ");
  result = result.replace(/\\pi/g, " pi ");
  result = result.replace(/\\sigma/g, " sigma ");
  result = result.replace(/\\tau/g, " tau ");
  result = result.replace(/\\phi/g, " phi ");
  result = result.replace(/\\omega/g, " omega ");
  result = result.replace(/\\Delta/g, " Delta ");
  result = result.replace(/\\Gamma/g, " Gamma ");
  result = result.replace(/\\Sigma/g, " Sigma ");
  result = result.replace(/\\Omega/g, " Omega ");
  
  // Common functions
  result = result.replace(/\\sin/g, " sine ");
  result = result.replace(/\\cos/g, " cosine ");
  result = result.replace(/\\tan/g, " tangent ");
  result = result.replace(/\\log/g, " log ");
  result = result.replace(/\\ln/g, " natural log ");
  result = result.replace(/\\exp/g, " exponential ");
  
  // Common symbols
  result = result.replace(/\\times/g, " times ");
  result = result.replace(/\\div/g, " divided by ");
  result = result.replace(/\\pm/g, " plus or minus ");
  result = result.replace(/\\mp/g, " minus or plus ");
  result = result.replace(/\\approx/g, " approximately ");
  result = result.replace(/\\neq/g, " not equal to ");
  result = result.replace(/\\leq/g, " less than or equal to ");
  result = result.replace(/\\geq/g, " greater than or equal to ");
  result = result.replace(/\\equiv/g, " equivalent to ");
  result = result.replace(/\\in/g, " in ");
  result = result.replace(/\\subset/g, " subset of ");
  result = result.replace(/\\subseteq/g, " subset or equal to ");
  result = result.replace(/\\cup/g, " union ");
  result = result.replace(/\\cap/g, " intersection ");
  result = result.replace(/\\to/g, " to ");
  result = result.replace(/\\rightarrow/g, " to ");
  result = result.replace(/\\leftarrow/g, " from ");
  result = result.replace(/\\Rightarrow/g, " implies ");
  result = result.replace(/\\Leftarrow/g, " implied by ");
  result = result.replace(/\\iff/g, " if and only if ");
  result = result.replace(/\\exists/g, " there exists ");
  result = result.replace(/\\forall/g, " for all ");
  result = result.replace(/\\partial/g, " partial ");
  result = result.replace(/\\nabla/g, " nabla ");
  
  // Text commands: \text{stuff} → "stuff"
  result = result.replace(/\\text\{([^}]*)\}/g, "$1");
  result = result.replace(/\\mathrm\{([^}]*)\}/g, "$1");
  result = result.replace(/\\mathbf\{([^}]*)\}/g, "$1");
  result = result.replace(/\\mathit\{([^}]*)\}/g, "$1");
  
  // Remove remaining backslashes and braces
  result = result.replace(/\\/g, " ");
  result = result.replace(/[{}]/g, " ");
  
  // Clean up spacing
  result = result.replace(/\s+/g, " ").trim();
  
  return result;
}

/** Strip markdown / HTML to plain text for TTS. */
function stripToPlainText(md: string): string {
  let text = md;
  
  // Extract and speak alt text from images, or remove if no alt text
  // Markdown images: ![alt](url) → "alt" (or remove if no alt)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match: string, alt: string) => {
    const altText = alt.trim();
    return altText ? ` ${altText} ` : " ";
  });
  
  // Wikilink images: ![[image.png|alt]] → "alt" (or remove if no alt)
  text = text.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match: string, _path: string, alt?: string) => {
    const altText = (alt ?? "").trim();
    return altText ? ` ${altText} ` : " ";
  });
  
  // Process LaTeX expressions before removing delimiters
  // Block math: $$...$$ or \[...\]
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match: string, latex: string) => {
    return " " + latexToSpeech(latex) + " ";
  });
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match: string, latex: string) => {
    return " " + latexToSpeech(latex) + " ";
  });
  
  // Inline math: $...$ or \(...\)
  text = text.replace(/\$([^$]+)\$/g, (_match: string, latex: string) => {
    return " " + latexToSpeech(latex) + " ";
  });
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_match: string, latex: string) => {
    return " " + latexToSpeech(latex) + " ";
  });
  
  // Now strip remaining markdown/HTML
  text = text
    .replace(/<[^>]+>/g, "")                         // HTML tags
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")          // links → text
    .replace(/\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g, (_match: string, target: string, alias?: string) => alias ?? target) // wikilinks
    .replace(/```[\s\S]*?```/g, "")                   // code blocks
    .replace(/`([^`]+)`/g, "$1")                      // inline code
    .replace(/[*_~#>]+/g, "");                        // formatting chars

  // Convert symbols to spoken words (after LaTeX processing, before collapsing whitespace)
  text = replaceSymbolsForSpeech(text);

  return text
    .replace(/\n{2,}/g, ". ")                         // paragraph breaks → pause
    .replace(/\n/g, " ")                              // single newlines
    .replace(/\s{2,}/g, " ")                          // collapse whitespace
    .trim();
}

type FlagSpeechSegment = {
  text: string;
  lang: string;
  fromFlag: boolean;
};

function buildFlagSpeechSegments(
  rawText: string,
  fallbackLang: string,
  settings: SproutSettings["audio"],
  autoDetect: boolean,
): FlagSpeechSegment[] {
  const flagEnabled = (settings as Record<string, unknown>)["useFlagsForVoiceSelection"];
  if (flagEnabled === false) return [];

  const sourceText = String(rawText ?? "");
  const matches = getCircleFlagTokenMatches(sourceText);
  if (!matches.length) return [];

  const firstLang = languageFromFlagCode(matches[0]?.code ?? "", fallbackLang);
  const cleanedAll = stripToPlainText(stripCircleFlagTokens(sourceText));

  if (matches.length === 1 && firstLang && cleanedAll) {
    return [{ text: cleanedAll, lang: firstLang, fromFlag: true }];
  }

  const segments: FlagSpeechSegment[] = [];
  let cursor = 0;
  let activeFlagLang: string | null = null;

  for (const match of matches) {
    const rawChunk = sourceText.slice(cursor, match.index);
    const chunk = stripToPlainText(rawChunk);

    if (chunk) {
      let lang = fallbackLang;
      let fromFlag = false;

      if (activeFlagLang) {
        lang = activeFlagLang;
        fromFlag = true;
      } else if (autoDetect) {
        const detected = detectLanguage(rawChunk);
        if (detected) {
          lang = resolveDetectedLanguage(detected, settings.scriptLanguages);
        }
      }

      segments.push({ text: chunk, lang, fromFlag });
    }

    activeFlagLang = languageFromFlagCode(match.code, fallbackLang);
    cursor = match.index + match.length;
  }

  const tailRaw = sourceText.slice(cursor);
  const tailText = stripToPlainText(tailRaw);
  if (tailText) {
    let lang = fallbackLang;
    let fromFlag = false;

    if (activeFlagLang) {
      lang = activeFlagLang;
      fromFlag = true;
    } else if (autoDetect) {
      const detected = detectLanguage(tailRaw);
      if (detected) {
        lang = resolveDetectedLanguage(detected, settings.scriptLanguages);
      }
    }

    segments.push({ text: tailText, lang, fromFlag });
  }

  return segments;
}

/**
 * Prepare cloze text for TTS.
 * - On the **front** (reveal=false): replaces the target cloze(s) with the "blank" word
 *   in the user's default language. Non-target clozes show their answer text.
 * - On the **back** (reveal=true): replaces all cloze tokens with their answer text.
 *
 * Handles the hint syntax `{{c1::answer::hint}}` by stripping the hint portion.
 */
export function prepareClozeTextForTts(
  clozeText: string,
  reveal: boolean,
  targetIndex: number | null,
  defaultLanguage: string,
): string {
  const blankWord = getBlankWord(defaultLanguage);
  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

  const result = clozeText.replace(re, (_match, idxStr: string, content: string) => {
    const idx = Number(idxStr);
    const isTarget = targetIndex === null || idx === targetIndex;
    // Strip hint: "answer::hint" → "answer"
    const answer = content.split("::")[0];

    if (reveal) {
      return answer;
    }

    if (isTarget) {
      return blankWord;
    }

    return answer;
  });

  // Safety net: strip any surviving cloze-like syntax that the regex missed
  const cleaned = result.replace(/\{\{[^}]*\}\}/g, "");

  return stripToPlainText(cleaned);
}

/**
 * Extract just the cloze deletion answer text for TTS.
 * Returns only the answer(s) of the target cloze(s), stripped to plain text.
 * For example, if the cloze is "The {{c1::mitochondria}} is the powerhouse",
 * this returns "mitochondria".
 *
 * Handles the hint syntax `{{c1::answer::hint}}` by stripping the hint portion.
 */
export function extractClozeAnswerForTts(
  clozeText: string,
  targetIndex: number | null,
): string {
  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  const answers: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(clozeText)) !== null) {
    const idx = Number(match[1]);
    // Strip hint: "answer::hint" → "answer"
    const answer = match[2].split("::")[0];
    const isTarget = targetIndex === null || idx === targetIndex;
    if (isTarget && answer.trim()) {
      answers.push(answer.trim());
    }
  }

  return stripToPlainText(answers.join(", "));
}

// ── TTS Service ─────────────────────────────────────────────────

export class TtsService {
  private _speaking = false;
  private _speakSession = 0;
  private _resumeKeepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private _activeAudioElement: HTMLAudioElement | null = null;
  private _activeObjectUrl: string | null = null;

  /** Vault adapter for cache reads/writes. Set externally by the plugin at init. */
  vaultAdapter: {
    exists(path: string): Promise<boolean>;
    readBinary?(path: string): Promise<ArrayBuffer>;
    writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
    remove?(path: string): Promise<void>;
    mkdir?(path: string): Promise<void>;
    list?(path: string): Promise<{ files: string[]; folders: string[] }>;
  } | null = null;

  /** Resolved tts-cache directory path. Set externally by the plugin at init. */
  ttsCacheDirPath: string | null = null;

  private _clearResumeKeepAliveInterval(): void {
    if (this._resumeKeepAliveInterval) {
      clearInterval(this._resumeKeepAliveInterval);
      this._resumeKeepAliveInterval = null;
    }
  }

  private _stopAudioElement(): void {
    if (this._activeAudioElement) {
      this._activeAudioElement.pause();
      this._activeAudioElement.removeAttribute("src");
      this._activeAudioElement = null;
    }
    if (this._activeObjectUrl) {
      URL.revokeObjectURL(this._activeObjectUrl);
      this._activeObjectUrl = null;
    }
  }

  /** Whether the browser supports the Web Speech API. */
  get isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  /** Whether TTS is currently speaking. */
  get isSpeaking(): boolean {
    return this._speaking;
  }

  /** Cancel any ongoing speech. */
  stop(): void {
    this._speakSession += 1;
    this._clearResumeKeepAliveInterval();
    this._stopAudioElement();
    if (this.isSupported) {
      window.speechSynthesis.cancel();
    }
    this._speaking = false;
  }

  private shouldAutoDetectLanguage(settings: SproutSettings["audio"]): boolean {
    const raw = (settings as Record<string, unknown>)["autoDetectLanguage"];
    return typeof raw === "boolean" ? raw : true;
  }

  /**
   * Speak the given text using the system TTS.
   *
   * **Workarounds applied:**
   * - Chromium drops utterances if `speak()` is called synchronously after `cancel()`.
   *   We insert a microtask yield between cancel and speak.
   * - Chromium pauses speech after ~15 s. We run a periodic `resume()` poke.
   *
   * @param text       Plain text to speak.
   * @param lang       BCP-47 language tag. If autoDetect is true this may be overridden.
   * @param settings   Audio settings from the plugin for rate/pitch.
   * @param autoDetect Whether to auto-detect language from text content.
   * @param bypassEnabled If true, skip the `enabled` check (used for Play Sample).
   */
  speak(
    text: string,
    lang: string,
    settings: SproutSettings["audio"],
    autoDetect = true,
    bypassEnabled = false,
    cacheId?: string,
  ): void {
    // Respect the master TTS toggle (unless bypassed for test playback)
    if (!bypassEnabled && !settings.enabled) return;
    if (!text.trim()) return;

    // Cancel any ongoing utterance
    this.stop();

    // ── External TTS provider branch ──
    const provider = settings.ttsProvider ?? "browser";
    if (provider !== "browser") {
      this._speakExternal(text, lang, settings, cacheId);
      return;
    }

    // ── Web Speech API (browser provider) ──
    if (!this.isSupported) return;

    const defaultLang = normaliseLocaleTag(lang || settings.defaultLanguage || "en-US") || "en-US";
    const includeLanguageLabel = Boolean((settings as Record<string, unknown>)["speakFlagLanguageLabel"]);

    const flagSegments = buildFlagSpeechSegments(text, defaultLang, settings, autoDetect);

    let segments: FlagSpeechSegment[];
    if (flagSegments.length) {
      segments = flagSegments;
    } else {
      const plainText = stripToPlainText(text);
      if (!plainText) return;

      let effectiveLang = defaultLang;
      if (autoDetect) {
        const detected = detectLanguage(text);
        if (detected) {
          const resolved = resolveDetectedLanguage(detected, settings.scriptLanguages);
          ttsLog(`Auto-detected language: "${detected}" → resolved to "${resolved}" (was "${effectiveLang}")`);
          effectiveLang = resolved;
        }
      }

      segments = [{ text: plainText, lang: normaliseLocaleTag(effectiveLang) || defaultLang, fromFlag: false }];
    }

    if (!segments.length) return;

    const rate = Math.max(0.5, Math.min(2.0, settings.rate ?? 1.0));
    const pitch = Math.max(0.5, Math.min(2.0, settings.pitch ?? 1.0));
    const preferredVoiceURI = settings.preferredVoiceURI || undefined;
    const session = this._speakSession;

    const speakSegmentAt = (index: number) => {
      if (session !== this._speakSession) return;
      if (index >= segments.length) {
        this._speaking = false;
        ttsLog("⏹ Speaking ended.");
        return;
      }

      const segment = segments[index];
      const segmentLang = normaliseLocaleTag(segment.lang) || defaultLang;
      const spokenText = includeLanguageLabel && segment.fromFlag
        ? `${spokenLanguageLabel(segmentLang)}. ${segment.text}`
        : segment.text;
      if (!spokenText.trim()) {
        speakSegmentAt(index + 1);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = segmentLang;
      utterance.rate = rate;
      utterance.pitch = pitch;

      const preferredForThisSegment =
        !segment.fromFlag && preferredVoiceURI && segmentLang.toLowerCase() === defaultLang.toLowerCase()
          ? preferredVoiceURI
          : undefined;

      const voice = pickVoice(segmentLang, preferredForThisSegment);
      if (voice) {
        utterance.voice = voice;
        ttsLog(`Using voice: "${voice.name}" (${voice.lang}, local=${voice.localService})`);
      } else {
        ttsLog("No voice matched — using speechSynthesis default.");
      }

      utterance.onstart = () => {
        this._speaking = true;
        this._clearResumeKeepAliveInterval();
        this._resumeKeepAliveInterval = setInterval(() => {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }, 10_000);
        if (_ttsDebug) {
          const actualVoice = utterance.voice;
          log.debug("[TTS] Speaking started", {
            assignedVoice: actualVoice ? `${actualVoice.name} (${actualVoice.lang})` : "<browser default>",
            voiceURI: actualVoice?.voiceURI ?? "n/a",
            lang: utterance.lang,
            rate: utterance.rate,
            pitch: utterance.pitch,
            textLength: utterance.text.length,
            segmentIndex: index,
            segmentCount: segments.length,
            fromFlag: segment.fromFlag,
          });
        }
      };

      const cleanupInterval = () => {
        this._clearResumeKeepAliveInterval();
      };

      utterance.onend = () => {
        cleanupInterval();
        speakSegmentAt(index + 1);
      };

      utterance.onerror = (ev) => {
        cleanupInterval();
        if (_ttsDebug) {
          log.error("[TTS] Utterance error", {
            error: ev.error,
            charIndex: ev.charIndex,
            elapsedTime: ev.elapsedTime,
            utteranceLang: utterance.lang,
            utteranceVoice: utterance.voice?.name ?? "<default>",
            segmentIndex: index,
          });
        }
        speakSegmentAt(index + 1);
      };

      ttsLog(
        `speak() — segment ${index + 1}/${segments.length}, lang="${segmentLang}", fromFlag=${segment.fromFlag}, text="${spokenText.slice(0, 80)}…"`,
      );

      setTimeout(() => {
        if (session !== this._speakSession) return;
        window.speechSynthesis.speak(utterance);
      }, 50);
    };

    speakSegmentAt(0);
  }

  /**
   * Speak text using an external TTS provider (ElevenLabs, OpenAI, Google Cloud, custom).
   * Handles caching: checks cache first, falls back to API, stores result in cache.
   * Falls back to Web Speech API on error if the browser supports it.
   */
  private _speakExternal(text: string, lang: string, settings: SproutSettings["audio"], cacheId?: string): void {
    // Detect circle-flag tokens (e.g. {{es}}) and use them for language selection
    const flagMatches = getCircleFlagTokenMatches(text);
    const plainText = stripToPlainText(stripCircleFlagTokens(text));
    if (!plainText) return;

    const session = this._speakSession;
    this._speaking = true;

    // If a flag was found and flag-based voice selection is enabled, use its language
    const flagEnabled = (settings as Record<string, unknown>)["useFlagsForVoiceSelection"] !== false;
    let effectiveLang: string;
    if (flagEnabled && flagMatches.length > 0) {
      const flagLang = languageFromFlagCode(flagMatches[0].code, lang || settings.defaultLanguage || "en-US");
      effectiveLang = normaliseLocaleTag(flagLang || lang || settings.defaultLanguage || "en-US") || "en-US";
    } else {
      effectiveLang = normaliseLocaleTag(lang || settings.defaultLanguage || "en-US") || "en-US";
    }

    const doSpeak = async () => {
      try {
        const adapter = this.vaultAdapter;
        const cacheDirPath = this.ttsCacheDirPath;
        const cacheEnabled = settings.ttsCacheEnabled !== false && adapter && cacheDirPath;

        let audioData: ArrayBuffer | null = null;

        // Check cache first
        if (cacheEnabled) {
          const key = ttsCacheKey(
            plainText,
            settings.ttsProvider,
            settings.ttsVoiceId || "",
            settings.ttsModel || "",
            cacheId,
            effectiveLang,
          );
          audioData = await getCachedAudio(adapter, cacheDirPath, key);
          if (audioData) {
            ttsLog("Cache hit — playing cached audio");
          }
        }

        // Fetch from provider if not cached
        if (!audioData) {
          ttsLog(`Requesting audio from ${settings.ttsProvider} provider…`);
          audioData = await requestExternalTts({ text: plainText, lang: effectiveLang, audio: settings });

          // Store in cache
          if (cacheEnabled && audioData) {
            const key = ttsCacheKey(
              plainText,
              settings.ttsProvider,
              settings.ttsVoiceId || "",
              settings.ttsModel || "",
              cacheId,
              effectiveLang,
            );
            void cacheAudio(adapter, cacheDirPath, key, audioData);
          }
        }

        // Check session is still current
        if (session !== this._speakSession) return;

        // Play via HTMLAudioElement
        const blob = new Blob([audioData], { type: "audio/mpeg" });
        const objectUrl = URL.createObjectURL(blob);
        const audioEl = new Audio(objectUrl);

        this._activeAudioElement = audioEl;
        this._activeObjectUrl = objectUrl;

        audioEl.onended = () => {
          this._speaking = false;
          this._stopAudioElement();
          ttsLog("⏹ External TTS playback ended.");
        };

        audioEl.onerror = () => {
          this._speaking = false;
          this._stopAudioElement();
          ttsLog("External TTS audio element error.");
        };

        await audioEl.play();
        ttsLog(`▶ Playing external TTS audio (${(audioData.byteLength / 1024).toFixed(1)} KB)`);
      } catch (e) {
        if (session !== this._speakSession) return;
        this._speaking = false;
        log.warn("[TTS] External provider failed, falling back to Web Speech API", e);

        // Fallback to browser TTS
        if (this.isSupported) {
          const fallbackSettings: SproutSettings["audio"] = {
            ...settings,
            ttsProvider: "browser",
          };
          this.speak(plainText, effectiveLang, fallbackSettings, false, true);
        }
      }
    };

    void doSpeak();
  }

  /**
   * Convenience: speak a basic card's question or answer.
   */
  speakBasicCard(
    text: string,
    settings: SproutSettings["audio"],
    cacheId?: string,
  ): void {
    this.speak(text, settings.defaultLanguage, settings, this.shouldAutoDetectLanguage(settings), false, cacheId);
  }

  /**
   * Convenience: speak a cloze card (front or back).
   * Handles cloze token replacement.
   *
   * When `reveal` is true the `answerMode` controls what is spoken:
   * - "full-sentence" — the whole sentence with blanks filled in
   * - "cloze-only"   — just the cloze deletion answer text(s)
   */
  speakClozeCard(
    clozeText: string,
    reveal: boolean,
    targetIndex: number | null,
    settings: SproutSettings["audio"],
    cacheId?: string,
  ): void {
    let prepared: string;
    const isClozeOnly = reveal && settings.clozeAnswerMode === "cloze-only";
    if (isClozeOnly) {
      prepared = extractClozeAnswerForTts(clozeText, targetIndex);
    } else {
      prepared = prepareClozeTextForTts(
        clozeText,
        reveal,
        targetIndex,
        settings.defaultLanguage,
      );
    }

    // Differentiate cache entries by cloze answer mode so switching
    // between "Just the answer" / "Full sentence" triggers a new request
    // rather than replaying stale audio.
    let effectiveCacheId = cacheId;
    if (effectiveCacheId && reveal) {
      effectiveCacheId += isClozeOnly ? "-short" : "-full";
    }

    this.speak(prepared, settings.defaultLanguage, settings, this.shouldAutoDetectLanguage(settings), false, effectiveCacheId);
  }

  /**
   * Convenience: speak an MCQ card's question or answer.
   *
   * On the front (reveal=false) reads: "Stem. 1. Option A. 2. Option B. …"
   * On the back (reveal=true)  reads: "The answer is: Option X" (or multiple answers).
   *
   * `displayOrder` is the shuffled index array so numbering matches what the
   * user sees on screen.  When absent, options are read in original order.
   *
   * The cache key encodes the display order so different shuffles produce
   * different cached audio files.
   */
  speakMcqCard(
    stem: string,
    options: string[],
    displayOrder: number[],
    reveal: boolean,
    correctIndices: number[],
    settings: SproutSettings["audio"],
    cacheId?: string,
  ): void {
    const text = formatMcqTextForTts(stem, options, displayOrder, reveal, correctIndices);
    if (!text) return;

    // Encode the display order into the cache key so each unique shuffle
    // produces its own cached mp3.
    let effectiveCacheId = cacheId;
    if (effectiveCacheId) {
      effectiveCacheId += `-${displayOrder.join("")}`;
    }

    this.speak(text, settings.defaultLanguage, settings, this.shouldAutoDetectLanguage(settings), false, effectiveCacheId);
  }

  /** Speak only the MCQ question stem. */
  speakMcqStem(
    stem: string,
    settings: SproutSettings["audio"],
    cacheId?: string,
  ): void {
    if (!stem.trim()) return;
    this.speak(stem, settings.defaultLanguage, settings, this.shouldAutoDetectLanguage(settings), false, cacheId);
  }

  /** Speak only the MCQ options (numbered, in display order). */
  speakMcqOptions(
    options: string[],
    displayOrder: number[],
    settings: SproutSettings["audio"],
    cacheId?: string,
  ): void {
    const text = formatMcqOptionsForTts(options, displayOrder);
    if (!text) return;
    let effectiveCacheId = cacheId;
    if (effectiveCacheId) effectiveCacheId += `-${displayOrder.join("")}`;
    this.speak(text, settings.defaultLanguage, settings, this.shouldAutoDetectLanguage(settings), false, effectiveCacheId);
  }

  /** Speak only the MCQ answer (correct option(s)). */
  speakMcqAnswer(
    options: string[],
    displayOrder: number[],
    correctIndices: number[],
    settings: SproutSettings["audio"],
    cacheId?: string,
  ): void {
    const text = formatMcqAnswerForTts(options, displayOrder, correctIndices);
    if (!text) return;
    let effectiveCacheId = cacheId;
    if (effectiveCacheId) effectiveCacheId += `-${displayOrder.join("")}`;
    this.speak(text, settings.defaultLanguage, settings, this.shouldAutoDetectLanguage(settings), false, effectiveCacheId);
  }
}

/**
 * Format MCQ card content for TTS.
 *
 * Front (reveal=false): "Stem. 1. Option A. 2. Option B. 3. Option C."
 * Back  (reveal=true):  "The answer is: Option X" or "The answers are: 1. X, 2. Y"
 */
export function formatMcqTextForTts(
  stem: string,
  options: string[],
  displayOrder: number[],
  reveal: boolean,
  correctIndices: number[],
): string {
  const order = displayOrder.length === options.length ? displayOrder : options.map((_, i) => i);

  if (!reveal) {
    // Front side: stem + numbered options in display order
    const numbered = order.map((origIdx, displayIdx) => `${displayIdx + 1}. ${options[origIdx] ?? ""}`);
    return [stem, ...numbered].filter(Boolean).join(". ");
  }

  // Back side: announce the correct answer(s)
  const correctSet = new Set(correctIndices);
  if (correctSet.size <= 1) {
    // Single answer — find the displayed number for the correct option
    const correctOrig = correctIndices[0] ?? 0;
    const displayNum = order.indexOf(correctOrig) + 1;
    const answerText = options[correctOrig] ?? "";
    return displayNum > 0
      ? `The answer is ${displayNum}. ${answerText}`
      : `The answer is ${answerText}`;
  }

  // Multiple correct answers
  const answers = order
    .map((origIdx, displayIdx) => ({ origIdx, displayIdx }))
    .filter(({ origIdx }) => correctSet.has(origIdx))
    .map(({ origIdx, displayIdx }) => `${displayIdx + 1}. ${options[origIdx] ?? ""}`);
  return `The answers are: ${answers.join(". ")}`;
}

/** Format just the MCQ options as a numbered list for TTS. */
export function formatMcqOptionsForTts(
  options: string[],
  displayOrder: number[],
): string {
  const order = displayOrder.length === options.length ? displayOrder : options.map((_, i) => i);
  const numbered = order.map((origIdx, displayIdx) => `${displayIdx + 1}. ${options[origIdx] ?? ""}`);
  return numbered.filter(Boolean).join(". ");
}

/** Format just the MCQ answer (correct option(s)) for TTS. */
export function formatMcqAnswerForTts(
  options: string[],
  displayOrder: number[],
  correctIndices: number[],
): string {
  const order = displayOrder.length === options.length ? displayOrder : options.map((_, i) => i);
  const correctSet = new Set(correctIndices);
  if (correctSet.size <= 1) {
    const correctOrig = correctIndices[0] ?? 0;
    const displayNum = order.indexOf(correctOrig) + 1;
    const answerText = options[correctOrig] ?? "";
    return displayNum > 0
      ? `The answer is ${displayNum}. ${answerText}`
      : `The answer is ${answerText}`;
  }
  const answers = order
    .map((origIdx, displayIdx) => ({ origIdx, displayIdx }))
    .filter(({ origIdx }) => correctSet.has(origIdx))
    .map(({ origIdx, displayIdx }) => `${displayIdx + 1}. ${options[origIdx] ?? ""}`);
  return `The answers are: ${answers.join(". ")}`;
}

/** Shared singleton instance. */
let _instance: TtsService | null = null;

export function getTtsService(): TtsService {
  if (!_instance) _instance = new TtsService();
  return _instance;
}
