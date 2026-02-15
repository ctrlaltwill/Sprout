/**
 * @file src/core/delimiter.ts
 * @summary Centralised delimiter utilities for Sprout's pipe-delimited card format.
 * Every file that reads or writes card fields should import helpers from here
 * instead of hard-coding the `|` character.
 *
 * The active delimiter is configured via `indexing.delimiter` in SproutSettings.
 * Allowed values: `|` (default), `@`, `~`, `;`.
 *
 * **Warning:** changing the delimiter does NOT migrate existing cards.
 * Cards written with the previous delimiter will no longer parse, and their
 * scheduling data will be lost on the next sync.
 *
 * @exports
 *   - DelimiterChar              — union type of allowed delimiter characters
 *   - DELIMITER_OPTIONS          — human-readable labels for the settings dropdown
 *   - getDelimiter               — returns the currently active delimiter character
 *   - setDelimiter               — sets the active delimiter (called from settings load)
 *   - escapeDelimiterRe          — regex-safe escaped version of the active delimiter
 *   - escapeDelimiterText        — escapes `\` and the delimiter in field content
 *   - unescapeDelimiterText      — reverses escapeDelimiterText
 *   - stripClosingDelimiter      — detects & strips an unescaped trailing delimiter
 *   - splitAtDelimiterTerminator — splits a line at the trailing delimiter (reading-view variant)
 *   - splitUnescapedDelimiters   — character-by-character split on unescaped delimiters
 *   - CARD_START_DELIM_RE        — dynamic regex: card-start line
 *   - FIELD_DELIM_RE             — dynamic regex: field line
 *   - TITLE_OUTSIDE_DELIM_RE     — dynamic regex: title outside card
 *   - ANY_HEADER_DELIM_RE        — dynamic regex: any header/field/anchor
 *   - FIELD_START_READING_RE     — dynamic regex: reading-view field-start
 *   - CARD_START_SETTINGS_RE     — dynamic regex: settings-utils card detection
 *   - FIELD_LINE_SETTINGS_RE     — dynamic regex: settings-utils field detection
 *   - FLASHCARD_HEADER_CARD_RE   — dynamic regex: sync-engine card header
 *   - FLASHCARD_HEADER_FIELD_RE  — dynamic regex: sync-engine field header
 */

// ── Types ────────────────────────────────────────────────────────────

export type DelimiterChar = "|" | "@" | "~" | ";";

/** Labels shown in the settings dropdown. */
export const DELIMITER_OPTIONS: Record<DelimiterChar, string> = {
  "|": "|  Pipe (default)",
  "@": "@  At sign",
  "~": "~  Tilde",
  ";": ";  Semicolon",
};

// ── Active delimiter state ───────────────────────────────────────────

let _delim: DelimiterChar = "|";

/** Returns the currently active delimiter character. */
export function getDelimiter(): DelimiterChar {
  return _delim;
}

/**
 * Sets the active delimiter. Called once during plugin load (from settings)
 * and again if the user changes the setting.
 */
export function setDelimiter(d: DelimiterChar) {
  if (d !== "|" && d !== "@" && d !== "~" && d !== ";") d = "|";
  _delim = d;
  // Rebuild all cached regexes
  _rebuildRegexes();
}

// ── Regex-safe escape ────────────────────────────────────────────────

/** Returns the delimiter escaped for use inside a RegExp character class or literal. */
export function escapeDelimiterRe(d: string = _delim): string {
  return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Text escape / unescape ──────────────────────────────────────────

/**
 * Escapes backslashes and the active delimiter in field content so the
 * text can safely appear inside a delimited field.
 *
 * `\`  →  `\\`
 * `<delim>`  →  `\<delim>`
 */
export function escapeDelimiterText(s: string): string {
  const d = _delim;
  let out = String(s ?? "").replace(/\\/g, "\\\\");
  // Only escape the delimiter character itself
  if (d === "|") out = out.replace(/\|/g, "\\|");
  else if (d === "@") out = out.replace(/@/g, "\\@");
  else if (d === "~") out = out.replace(/~/g, "\\~");
  else if (d === ";") out = out.replace(/;/g, "\\;");
  return out;
}

/**
 * Reverses escapeDelimiterText:
 * `\\`  →  `\`
 * `\<delim>`  →  `<delim>`
 */
export function unescapeDelimiterText(s: string): string {
  const d = _delim;
  const escaped = escapeDelimiterRe(d);
  return s
    .replace(/\\\\/g, "\x00")                          // placeholder for literal backslash
    .replace(new RegExp(`\\\\${escaped}`, "g"), d)       // \<delim> → <delim>
    .replace(/\0/g, "\\");                               // placeholder → backslash
}

// ── Closing-delimiter detection ─────────────────────────────────────

/**
 * For delimited fields (KEY <d> ... <d>):
 * Field ends when a line ends with an unescaped delimiter (ignoring trailing whitespace).
 * Returns the text without the closing delimiter, and whether the field closed.
 */
export function stripClosingDelimiter(line: string): { text: string; closed: boolean } {
  const d = _delim;
  const trimmedRight = line.replace(/[ \t]+$/g, "");
  if (!trimmedRight.endsWith(d)) return { text: line, closed: false };

  // Count consecutive backslashes before the final delimiter
  let bs = 0;
  for (let i = trimmedRight.length - 1 - d.length; i >= 0 && trimmedRight[i] === "\\"; i--) bs++;

  // Odd number of backslashes means the delimiter is escaped
  if (bs % 2 === 1) return { text: line, closed: false };

  return { text: trimmedRight.slice(0, -d.length), closed: true };
}

/**
 * Reading-view variant: splits at the trailing (unescaped) delimiter.
 * Returns the content before the delimiter and whether it was terminated.
 */
export function splitAtDelimiterTerminator(line: string): { content: string; terminated: boolean } {
  const d = _delim;
  const trimmedRight = line.replace(/[ \t]+$/g, "");
  if (!trimmedRight.endsWith(d)) return { content: line, terminated: false };

  // Count consecutive backslashes before the final delimiter
  let bs = 0;
  for (let i = trimmedRight.length - 1 - d.length; i >= 0 && trimmedRight[i] === "\\"; i--) bs++;

  // Odd number of backslashes means the delimiter is escaped
  if (bs % 2 === 1) return { content: line, terminated: false };

  return {
    content: trimmedRight.slice(0, -d.length),
    terminated: true,
  };
}

// ── Character-by-character split ────────────────────────────────────

/**
 * Splits a string on unescaped delimiter characters.
 * `\<delim>` is treated as a literal delimiter in the output.
 * `\\` is treated as a literal backslash.
 */
export function splitUnescapedDelimiters(s: string): string[] {
  const d = _delim;
  const out: string[] = [];
  let cur = "";
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === d) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

// ── Dynamic regex cache ─────────────────────────────────────────────
//
// All regexes that depend on the delimiter are rebuilt when setDelimiter()
// is called. Consumers import the getter functions below.

let _CARD_START_DELIM_RE: RegExp;
let _FIELD_DELIM_RE: RegExp;
let _TITLE_OUTSIDE_DELIM_RE: RegExp;
let _ANY_HEADER_DELIM_RE: RegExp;
let _FIELD_START_READING_RE: RegExp;
let _CARD_START_SETTINGS_RE: RegExp;
let _FIELD_LINE_SETTINGS_RE: RegExp;
let _FLASHCARD_HEADER_CARD_RE: RegExp;
let _FLASHCARD_HEADER_FIELD_RE: RegExp;

function _rebuildRegexes() {
  const d = escapeDelimiterRe(_delim);

  // parser.ts — card start: ^(RQ|Q|MCQ|CQ|IO|OQ)\s*<d>\s*(.*)$
  _CARD_START_DELIM_RE = new RegExp(`^(RQ|Q|MCQ|CQ|IO|OQ)\\s*${d}\\s*(.*)$`);

  // parser.ts — field: ^(T|A|O|I|G|C|\d{1,2})\s*<d>\s*(.*)$
  _FIELD_DELIM_RE = new RegExp(`^(T|A|O|I|G|C|\\d{1,2})\\s*${d}\\s*(.*)$`);

  // parser.ts — title outside card: ^T\s*<d>\s*(.*)$
  _TITLE_OUTSIDE_DELIM_RE = new RegExp(`^T\\s*${d}\\s*(.*)$`);

  // parser.ts — any header/anchor: ^(?:\^sprout-\d{9}|(?:RQ|Q|MCQ|CQ|IO|OQ|T|A|O|I|G|C|\d{1,2})\s*<d>)\s*
  _ANY_HEADER_DELIM_RE = new RegExp(
    `^(?:\\^sprout-\\d{9}|(?:RQ|Q|MCQ|CQ|IO|OQ|T|A|O|I|G|C|\\d{1,2})\\s*${d})\\s*`,
  );

  // reading-helpers.ts — field start (relaxed): ^([A-Za-z]+)\s*<d>\s*(.*)$
  _FIELD_START_READING_RE = new RegExp(`^([A-Za-z]+)\\s*${d}\\s*(.*)$`);

  // settings-utils.ts — card start (also accepts colon for legacy):
  //   ^(RQ|Q|MCQ|CQ|OQ)\s*(?::|<d>)\s*.*$|^IO\s*<d>\s*.*$
  _CARD_START_SETTINGS_RE = new RegExp(
    `^(RQ|Q|MCQ|CQ|OQ)\\s*(?::|${d})\\s*.*$|^IO\\s*${d}\\s*.*$`,
  );

  // settings-utils.ts — field line:
  //   ^(T|A|I|O|G|\d{1,2})\s*(?::|<d>)\s*.*$|^(C|K)\s*(?::|<d>)\s*.*$
  _FIELD_LINE_SETTINGS_RE = new RegExp(
    `^(T|A|I|O|G|\\d{1,2})\\s*(?::|${d})\\s*.*$|^(C|K)\\s*(?::|${d})\\s*.*$`,
  );

  // sync-engine.ts — flashcard header (card types):
  //   ^(RQ|Q|MCQ|CQ|IO|OQ)\s*(?::|<d>)\s*
  _FLASHCARD_HEADER_CARD_RE = new RegExp(`^(RQ|Q|MCQ|CQ|IO|OQ)\\s*(?::|${d})\\s*`);

  // sync-engine.ts — flashcard header (field types):
  //   ^(T|A|O|I|G|C|K|L|\d{1,2})\s*(?::|<d>)\s*
  _FLASHCARD_HEADER_FIELD_RE = new RegExp(`^(T|A|O|I|G|C|K|L|\\d{1,2})\\s*(?::|${d})\\s*`);
}

// Initial build with default delimiter
_rebuildRegexes();

// ── Regex getters ────────────────────────────────────────────────────

/** Card-start regex for parser.ts: `^(RQ|Q|MCQ|CQ|IO|OQ)\s*<d>\s*(.*)$` */
export function CARD_START_DELIM_RE(): RegExp { return _CARD_START_DELIM_RE; }

/** Field regex for parser.ts: `^(T|A|O|I|G|C|\d{1,2})\s*<d>\s*(.*)$` */
export function FIELD_DELIM_RE(): RegExp { return _FIELD_DELIM_RE; }

/** Title-outside-card regex for parser.ts: `^T\s*<d>\s*(.*)$` */
export function TITLE_OUTSIDE_DELIM_RE(): RegExp { return _TITLE_OUTSIDE_DELIM_RE; }

/** Any-header regex for parser.ts */
export function ANY_HEADER_DELIM_RE(): RegExp { return _ANY_HEADER_DELIM_RE; }

/** Reading-view field-start regex: `^([A-Za-z]+)\s*<d>\s*(.*)$` */
export function FIELD_START_READING_RE(): RegExp { return _FIELD_START_READING_RE; }

/** Settings-utils card-start regex (includes legacy colon) */
export function CARD_START_SETTINGS_RE(): RegExp { return _CARD_START_SETTINGS_RE; }

/** Settings-utils field-line regex (includes legacy colon) */
export function FIELD_LINE_SETTINGS_RE(): RegExp { return _FIELD_LINE_SETTINGS_RE; }

/** Sync-engine flashcard header — card types */
export function FLASHCARD_HEADER_CARD_RE(): RegExp { return _FLASHCARD_HEADER_CARD_RE; }

/** Sync-engine flashcard header — field types */
export function FLASHCARD_HEADER_FIELD_RE(): RegExp { return _FLASHCARD_HEADER_FIELD_RE; }

// ── Field formatting (write-side) ───────────────────────────────────

/**
 * Push a key-value field to a delimited card block.
 * Handles single-line (`KEY <d> value <d>`) and multi-line formatting.
 */
export function pushDelimitedField(out: string[], key: string, value: string) {
  const d = _delim;
  const raw = String(value ?? "");
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0) {
    out.push(`${key} ${d} ${d}`);
    return;
  }
  if (lines.length === 1) {
    out.push(`${key} ${d} ${escapeDelimiterText(lines[0])} ${d}`);
    return;
  }
  out.push(`${key} ${d} ${escapeDelimiterText(lines[0])}`);
  for (let i = 1; i < lines.length - 1; i++) out.push(escapeDelimiterText(lines[i]));
  out.push(`${escapeDelimiterText(lines[lines.length - 1])} ${d}`);
}

/**
 * Format a single delimited field. Multi-line values are split across
 * multiple output lines (the closing delimiter is on the last line).
 * Used by modal-utils.
 */
export function formatDelimitedField(key: string, value: string): string[] {
  const d = _delim;
  const raw = String(value ?? "");
  const parts = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (parts.length <= 1) {
    return [`${key} ${d} ${escapeDelimiterText(parts[0] ?? "")} ${d}`];
  }

  const out: string[] = [];
  out.push(`${key} ${d} ${escapeDelimiterText(parts[0] ?? "")}`);
  for (let i = 1; i < parts.length - 1; i++) out.push(escapeDelimiterText(parts[i] ?? ""));
  out.push(`${escapeDelimiterText(parts[parts.length - 1] ?? "")} ${d}`);
  return out;
}
