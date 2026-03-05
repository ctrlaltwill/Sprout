/**
 * @file src/tts/language-detect.ts
 * @summary Lightweight, fully local language detection using Unicode script analysis.
 * Detects the dominant script in a text sample and maps it to a BCP-47 language tag.
 * For Latin-script text (Spanish, French, German, etc.) detection is ambiguous,
 * so the function returns null and lets the caller fall back to the user's default language.
 *
 * @exports
 *   - detectLanguage — Analyse text and return a BCP-47 language tag or null
 *   - BLANK_WORD_MAP  — Map of language codes to the word "blank" in that language
 */

/** Unicode-range rule: regex pattern → BCP-47 tag. Order matters — more specific first. */
const SCRIPT_RULES: Array<{ re: RegExp; lang: string }> = [
  // Japanese kana (hiragana + katakana) — checked before CJK since Japanese also uses kanji
  { re: /[\u3040-\u309f\u30a0-\u30ff]/,        lang: "ja" },
  // Korean Hangul syllables + Jamo
  { re: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/, lang: "ko" },
  // CJK Unified Ideographs (Chinese if no Japanese kana detected)
  { re: /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/, lang: "zh-CN" },
  // Arabic
  { re: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/, lang: "ar" },
  // Hebrew
  { re: /[\u0590-\u05ff]/,                      lang: "he" },
  // Cyrillic
  { re: /[\u0400-\u04ff\u0500-\u052f]/,         lang: "ru" },
  // Devanagari (Hindi)
  { re: /[\u0900-\u097f]/,                      lang: "hi" },
  // Bengali
  { re: /[\u0980-\u09ff]/,                      lang: "bn" },
  // Tamil
  { re: /[\u0b80-\u0bff]/,                      lang: "ta" },
  // Telugu
  { re: /[\u0c00-\u0c7f]/,                      lang: "te" },
  // Thai
  { re: /[\u0e00-\u0e7f]/,                      lang: "th" },
  // Georgian
  { re: /[\u10a0-\u10ff]/,                      lang: "ka" },
  // Armenian
  { re: /[\u0530-\u058f]/,                      lang: "hy" },
  // Greek
  { re: /[\u0370-\u03ff\u1f00-\u1fff]/,         lang: "el" },
  // Vietnamese (Latin with specific diacritics — đ, ơ, ư, ă, ê, ô)
  { re: /[\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u0102\u0103]/, lang: "vi" },
];

/**
 * Analyses the dominant non-Latin script in `text` and returns a BCP-47 language tag.
 * Returns `null` for purely Latin / ASCII text (caller should use default language).
 *
 * The function counts matching characters for each script rule and returns the
 * language with the highest match count (minimum 1 character).
 */
export function detectLanguage(text: string): string | null {
  if (!text || typeof text !== "string") return null;

  // Strip markdown formatting, HTML tags, and cloze tokens so they don't skew detection
  const clean = text
    .replace(/\{\{c\d+::([\s\S]*?)\}\}/g, "$1")  // cloze → answer text
    .replace(/<[^>]+>/g, "")                        // HTML tags
    .replace(/[*_~`#()!]|\[|\]/g, "")               // markdown punctuation
    .trim();

  if (!clean) return null;

  let bestLang: string | null = null;
  let bestCount = 0;

  for (const rule of SCRIPT_RULES) {
    const matches = clean.match(new RegExp(rule.re.source, "g"));
    const count = matches?.length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestLang = rule.lang;
    }
  }

  return bestLang;
}

/**
 * Map of BCP-47 primary language tags → the word "blank" in that language.
 * Used when reading cloze card fronts aloud — the hidden answer is spoken as this word.
 */
export const BLANK_WORD_MAP: Record<string, string> = {
  en: "blank",
  es: "espacio en blanco",
  fr: "blanc",
  de: "Lücke",
  it: "spazio",
  pt: "espaço em branco",
  nl: "blanco",
  ru: "пробел",
  uk: "пробіл",
  pl: "puste miejsce",
  cs: "prázdné místo",
  ja: "空白",
  zh: "空白",
  ko: "빈칸",
  ar: "فراغ",
  he: "ריק",
  hi: "रिक्त",
  bn: "ফাঁকা",
  ta: "வெற்றிடம்",
  te: "ఖాళీ",
  th: "ช่องว่าง",
  vi: "chỗ trống",
  el: "κενό",
  tr: "boşluk",
  sv: "tomt",
  da: "tom plads",
  no: "blank",
  fi: "tyhjä",
  hu: "üres hely",
  ro: "gol",
  ka: "ცარიელი",
  hy: "դատարկ",
  id: "kosong",
  ms: "kosong",
};

/**
 * Returns the word "blank" in the given language.
 * Falls back to "blank" (English) for unknown languages.
 */
export function getBlankWord(lang: string): string {
  if (!lang) return "blank";
  // Try exact match first, then primary subtag (e.g. "en-US" → "en")
  const primary = lang.split("-")[0].toLowerCase();
  return BLANK_WORD_MAP[primary] ?? "blank";
}
