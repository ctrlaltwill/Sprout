/**
 * @file src/reading/reading-helpers.ts
 * @summary Pure, stateless helper functions extracted from reading-view.ts. Covers regex constants, text-cleaning utilities, card parsing from raw markdown, card-content HTML builders for every card type (basic, cloze, MCQ, IO, info), collapsible sections, markdown-element parsing, and non-card-content detection. Nothing here depends on module-level mutable state or Obsidian lifecycle hooks.
 *
 * @exports
 *  - INVIS_RE                    — regex stripping zero-width spaces and BOM characters
 *  - ANCHOR_RE                   — regex matching a ^sprout-<id> anchor
 *  - FIELD_START_RE              — regex matching a field-start line (FieldKey | value)
 *  - FieldKey                    — type alias for valid field keys (T, Q, A, I, MCQ, CQ, O, G, IO)
 *  - clean                       — strips invisible characters and trims whitespace
 *  - unescapePipeText            — unescapes pipe characters in card field text
 *  - normalizeMathSignature      — normalises LaTeX math delimiters for consistent rendering
 *  - escapeHtml                  — escapes HTML special characters in a string
 *  - processMarkdownFeatures     — converts wiki-links and preserves LaTeX delimiters
 *  - splitAtPipeTerminator       — splits a line at the pipe terminator character
 *  - extractLaTeXFromMathJax     — extracts raw LaTeX source from a MathJax-rendered element
 *  - extractRawTextFromParagraph — extracts plain text from a paragraph element
 *  - extractTextWithLaTeX        — extracts text preserving inline LaTeX from an element
 *  - extractCardFromSource       — extracts a card's raw source block by anchor ID from a markdown string
 *  - SproutCard                  — interface describing a parsed Sprout card with typed fields
 *  - parseSproutCard             — parses a raw text block into a SproutCard object
 *  - saveField                   — appends a field value to a fields record (handles multi-line)
 *  - renderMathInElement         — triggers MathJax typesetting on a DOM element
 *  - buildCardContentHTML        — builds the full HTML string for a card's content section
 *  - buildClozeSectionHTML       — builds the HTML for a cloze-deletion card section
 *  - buildMCQSectionHTML         — builds the HTML for an MCQ card section
 *  - buildBasicSectionHTML       — builds the HTML for a basic Q&A card section
 *  - buildIOSectionHTML          — builds the HTML for an image-occlusion card section
 *  - buildInfoSectionHTML        — builds the HTML for an info-only card section
 *  - buildCollapsibleSectionHTML — builds a collapsible/expandable HTML section
 *  - ParsedMarkdownElement       — interface describing a parsed markdown element (type, content, metadata)
 *  - parseMarkdownToElements     — parses a markdown string into an array of ParsedMarkdownElement objects
 *  - createMarkdownElement       — creates an HTMLElement from a ParsedMarkdownElement
 *  - checkForNonCardContent      — checks whether an element contains non-card content after a pipe
 *  - containsNonCardContent      — returns true if an element has any non-card content
 */

import { log } from "../../platform/core/logger";
import { queryFirst } from "../../platform/core/ui";
import { convertInlineDisplayMath, parseClozeTokens } from "../../platform/core/shared-utils";
import { replaceCircleFlagTokens } from "../../platform/flags/flag-tokens";
import {
  FIELD_START_READING_RE,
  unescapeDelimiterText,
  splitAtDelimiterTerminator,
  escapeDelimiterRe,
} from "../../platform/core/delimiter";
import { CARD_ANCHOR_INLINE_RE } from "../../platform/core/identity";

/* -----------------------
   Constants
   ----------------------- */

/** Zero-width space + BOM stripper */
export const INVIS_RE = /[\u200B\uFEFF]/g;

/** Relaxed anchor regex (match anywhere on a line) */
export const ANCHOR_RE = CARD_ANCHOR_INLINE_RE;

/** Dynamic field-start regex that uses the active delimiter. */
export const FIELD_START_RE = { test: (s: string) => FIELD_START_READING_RE().test(s), exec: (s: string) => FIELD_START_READING_RE().exec(s) };

/** Match a string against the field-start regex. Works as a drop-in for `str.match(FIELD_START_RE)`. */
function matchFieldStart(s: string): RegExpMatchArray | null {
  return s.match(FIELD_START_READING_RE());
}

function isKnownReadingFieldKey(key: string): boolean {
  const normalized = String(key || '').trim().toUpperCase();
  if (!normalized) return false;

  if (/^\d{1,2}$/.test(normalized)) {
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 1 && n <= 20;
  }

  return (
    normalized === 'T' ||
    normalized === 'Q' ||
    normalized === 'RQ' ||
    normalized === 'A' ||
    normalized === 'I' ||
    normalized === 'MCQ' ||
    normalized === 'CQ' ||
    normalized === 'O' ||
    normalized === 'G' ||
    normalized === 'IO' ||
    normalized === 'OQ'
  );
}

function matchKnownFieldStart(s: string): RegExpMatchArray | null {
  const m = matchFieldStart(s);
  if (!m) return null;
  return isKnownReadingFieldKey(m[1] || '') ? m : null;
}

export type FieldKey = "T" | "Q" | "A" | "I" | "MCQ" | "CQ" | "O" | "G" | "IO";

/* -----------------------
   Internal-only helpers
   ----------------------- */

// No-op logger so extracted functions that previously called debugLog
// keep their exact implementation without depending on mutable DEBUG state.
 
function debugLog(..._args: unknown[]) {
  /* intentionally empty */
}

/* -----------------------
   Pure utility functions
   ----------------------- */

export function clean(s: string): string {
  return (s ?? "").replace(INVIS_RE, "");
}

/**
 * Unescape delimited field text.
 * Converts \\ → \ and \<delim> → <delim>
 * Delegates to the shared delimiter utility.
 */
export function unescapePipeText(s: string): string {
  return unescapeDelimiterText(s);
}

export function normalizeMathSignature(s: string): string {
  let out = (s ?? "").toLowerCase();
  out = out.replace(/\\([a-zA-Z]+)/g, "$1");
  out = out
    .replace(/π/g, "pi")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/δ/g, "delta")
    .replace(/θ/g, "theta")
    .replace(/λ/g, "lambda")
    .replace(/μ/g, "mu")
    .replace(/σ/g, "sigma")
    .replace(/φ/g, "phi")
    .replace(/ω/g, "omega")
    .replace(/≤/g, "le")
    .replace(/≥/g, "ge")
    .replace(/×/g, "x");
  out = out.replace(/[^a-z0-9]+/g, "");
  return out;
}

function toSafeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

export function escapeHtml(text: unknown): string {
  if (text === undefined || text === null) return '';
  return toSafeText(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Process wiki links [[Link]], image embeds ![[image]], and inline formatting
 * for reading view.
 *
 * Inline formatting uses standard Obsidian markdown conventions:
 *   **text**   → <strong>   (bold)
 *   *text*     → <em>       (italic)
 *   _text_     → <em>       (italic — same as *text* in Obsidian)
 *   ~~text~~   → <s>        (strikethrough)
 *   ==text==   → <mark>     (highlight)
 */
export function processMarkdownFeatures(text: string): string {
  if (!text) return '';
  const source = convertInlineDisplayMath(String(text));

  // ── Extract math blocks before applying markdown formatting ──
  // LaTeX delimiters contain characters like _ * ^ that conflict with
  // markdown formatting rules. We replace math blocks with placeholders,
  // apply markdown formatting to non-math text, then restore the math.
  const mathPlaceholders: string[] = [];
  const MATH_PH = "@@SPROUTMATH";

  // Match math blocks: $$...$$, $...$, \(...\), \[...\]
  const mathBlockRe = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)[^\s$](?:[^$]*[^\s$])?\$(?!\$)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;
  const withPlaceholders = source.replace(mathBlockRe, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `${MATH_PH}${idx}@@`;
  });

  let result = withPlaceholders;

  // Convert image embeds ![[image.ext]] or ![[path/image.ext|alt]] to placeholder <img> tags
  // Must come BEFORE [[link]] handling to avoid partial matches
  result = result.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g, (_match: string, target: string, alt?: string) => {
    const altText = alt || target.split('/').pop() || target;
    return `<img class="learnkit-reading-embed-img" data-embed-path="${escapeHtml(target.trim())}" alt="${escapeHtml(altText)}" />`;
  });

  // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
  result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, target: string, display?: string) => {
    const linkText = display || target;
    // Create a data attribute for Obsidian to handle the click
    return `<a href="#" class="internal-link" data-href="${escapeHtml(target)}">${escapeHtml(linkText)}</a>`;
  });
  
  // ── Inline formatting (standard Obsidian markdown) ──
  // Order matters: bold (**) before italic (*)

  // Convert bold **text** to <strong>text</strong>
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert italic *text* to <em>text</em>  (single asterisk)
  // Must come AFTER bold to avoid partial matches
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Convert italic _text_ to <em>text</em>  (underscore — standard Obsidian italic)
  // Only match underscores at word boundaries to avoid matching things like variable_names
  result = result.replace(/(?<![\w\\])_(.+?)_(?![\w])/g, '<em>$1</em>');

  // Convert strikethrough ~~text~~ to <s>text</s>
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Convert highlight ==text== to <mark>text</mark>
  result = result.replace(/==(.+?)==/g, '<mark>$1</mark>');

  result = replaceCircleFlagTokens(result);

  // ── Restore math blocks ──
  if (mathPlaceholders.length) {
    result = result.replace(/@@SPROUTMATH(\d+)@@/g, (_m, idx) => {
      return mathPlaceholders[Number(idx)] ?? _m;
    });
  }

  return result;
}

export function splitAtPipeTerminator(line: string): { content: string; terminated: boolean } {
  return splitAtDelimiterTerminator(line);
}

/* -----------------------
   Text extraction functions
   ----------------------- */

/**
 * Extract LaTeX source from MathJax container.
 * Obsidian/MathJax may store the original LaTeX in script tags or we need to reconstruct it.
 */
export function extractLaTeXFromMathJax(mathEl: Element): string {
  // Method 1: Look for script tag with original LaTeX (some MathJax configurations use this)
  const scriptTag = mathEl.previousElementSibling;
  if (scriptTag && scriptTag.tagName === 'SCRIPT' && scriptTag.getAttribute('type') === 'math/tex') {
    return scriptTag.textContent || '';
  }
  
  // Method 2: Check the mathEl itself for a script child
  const inlineScript = queryFirst(mathEl, 'script[type="math/tex"]');
  if (inlineScript) {
    return inlineScript.textContent || '';
  }
  
  // Method 3: Obsidian might store it in a data attribute
  const dataAttr = mathEl.getAttribute('data-latex') || mathEl.getAttribute('data-tex') || mathEl.getAttribute('data-formula');
  if (dataAttr) return dataAttr;
  
  // Method 4: Try to reconstruct from MathJax's internal structure
  // The mjx-math element might have the LaTeX classes that hint at structure
  const mjxMath = queryFirst(mathEl, 'mjx-math');
  if (mjxMath && mjxMath.classList.contains('MJX-TEX')) {
    // This is rendered TeX - try to extract structure
    // For simple cases like variables, textContent works
    const text = mjxMath.textContent || '';
    if (text && text.length < 50 && !/[<>{}]/.test(text)) {
      // Simple text, likely a variable or simple expression
      return text;
    }
  }
  
  // Method 5: LAST RESORT - parse the entire parent's raw HTML to find the original
  // This will be handled by looking at the paragraph before MathJax processing
  // For now, return textContent as fallback
  return mathEl.textContent || '';
}

/**
 * Extract raw text from paragraph element by looking at innerHTML before MathJax
 * Obsidian renders markdown with <br> tags, and LaTeX is inline in the HTML
 */
export function extractRawTextFromParagraph(el: HTMLElement): string {
  // Look for the <p> tag that contains the actual card content
  const pTag = queryFirst(el, 'p[dir="auto"]');
  if (!pTag) {
    return extractTextWithLaTeX(el);
  }
  
  // Get the innerHTML and convert <br> tags to newlines
  let html = pTag.innerHTML;
  
  // Replace <br> and <br/> with newlines
  html = html.replace(/<br\s*\/?>/gi, '\n');
  
  // Now we need to extract text while handling <span class="math"> elements
  // Parse HTML without writing via innerHTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const temp = doc.body;
  
  // Replace math elements with LaTeX delimiters
  temp.querySelectorAll('.math.math-inline').forEach((mathEl) => {
    const latexSource = extractLaTeXFromMathJax(mathEl);
    mathEl.replaceWith(document.createTextNode(`$${latexSource}$`));
  });
  
  temp.querySelectorAll('.math.math-block').forEach((mathEl) => {
    const latexSource = extractLaTeXFromMathJax(mathEl);
    mathEl.replaceWith(document.createTextNode(`$$${latexSource}$$`));
  });
  
  // Convert any remaining HTML entities and tags to text
  const textContent = temp.textContent || '';
  
  return textContent;
}

/**
 * Extract text from an element while preserving LaTeX from .math elements.
 * Converts <span class="math math-inline">...</span> back to $...$
 * and <div class="math math-block">...</div> back to $$...$$
 */
export function extractTextWithLaTeX(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  
  // Replace inline math spans with $ delimiters
  clone.querySelectorAll('.math.math-inline').forEach((mathEl) => {
    const latexSource = extractLaTeXFromMathJax(mathEl);
    const textNode = document.createTextNode(`$${latexSource}$`);
    mathEl.replaceWith(textNode);
  });
  
  // Replace block math divs with $$ delimiters
  clone.querySelectorAll('.math.math-block').forEach((mathEl) => {
    const latexSource = extractLaTeXFromMathJax(mathEl);
    const textNode = document.createTextNode(`$$${latexSource}$$`);
    mathEl.replaceWith(textNode);
  });
  
  return clone.innerText || clone.textContent || '';
}

/* -----------------------
   Card parsing
   ----------------------- */

/**
 * Extract card content from source markdown by finding the anchor and parsing the following lines
 */
export function extractCardFromSource(sourceContent: string, anchorId: string): string | null {
  const lines = sourceContent.split('\n');
  let anchorLineIndex = -1;
  
  // Find the line with ^learnkit-{anchorId} or ^sprout-{anchorId}
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`^learnkit-${anchorId}`) || lines[i].includes(`^sprout-${anchorId}`)) {
      anchorLineIndex = i;
      break;
    }
  }
  
  if (anchorLineIndex === -1) return null;
  
  // Collect lines from anchor until we hit the next anchor, header, or end of card
  const cardLines: string[] = [lines[anchorLineIndex]];
  let inPipeField = false;
  let lastFieldHadClosingPipe = false;
  
  for (let i = anchorLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Stop if we hit another anchor
    if (trimmed.match(ANCHOR_RE)) break;

    // If we're in a delimited field, keep consuming until the closing delimiter.
    // This must run before header/non-field checks so markdown headings/lists
    // inside Q/A/I/etc do not terminate extraction early.
    if (inPipeField) {
      cardLines.push(line);
      const { terminated } = splitAtPipeTerminator(line);
      if (terminated) {
        inPipeField = false;
        lastFieldHadClosingPipe = true;
      }
      continue;
    }
    
    // Stop if we hit a markdown header
    if (trimmed.match(/^#{1,6}\s/)) break;
    
    // Check if this line starts a new field
    if (matchKnownFieldStart(trimmed)) {
      inPipeField = true;
      lastFieldHadClosingPipe = false;
      
      // Check if the field closes on the same line
      const fm = matchKnownFieldStart(trimmed);
      const initialContent = fm?.[2] || '';
      const { terminated } = splitAtPipeTerminator(initialContent);
      if (terminated) {
        inPipeField = false;
        lastFieldHadClosingPipe = true;
      }
      cardLines.push(line);
      continue;
    }
    
    // If the last field had a closing pipe and this line is empty, check next line
    if (lastFieldHadClosingPipe && !trimmed) {
      // Peek at next line
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        // If next line is a header, another anchor, or doesn't start a field, we're done
        if (nextLine.match(/^#{1,6}\s/) || nextLine.match(ANCHOR_RE) || !matchKnownFieldStart(nextLine)) {
          break;
        }
      }
      cardLines.push(line);
      continue;
    }
    
    // If we're not in a field and hit a non-empty line that isn't a field start, we're done
    if (trimmed && !matchKnownFieldStart(trimmed)) {
      break;
    }
    
    cardLines.push(line);
  }
  
  return cardLines.join('\n');
}

export interface SproutCard {
  anchorId: string;
  type: "basic" | "reversed" | "cloze" | "mcq" | "io" | "oq";
  title: string;
  fields: {
    T?: string | string[];
    Q?: string | string[];
    RQ?: string | string[];
    A?: string | string[];
    CQ?: string | string[];
    MCQ?: string | string[];
    OQ?: string | string[];
    O?: string | string[];
    I?: string | string[];
    G?: string | string[];
    IO?: string | string[];
  };
}

export function parseSproutCard(text: string): SproutCard | null {
  // Don't filter empty lines - they're significant for multi-line LaTeX blocks
  const lines = text.split('\n').map((l) => clean(l));
  if (lines.every((l) => l.trim().length === 0)) return null;

  let anchorLineIndex = -1;
  let anchorId = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(ANCHOR_RE);
    if (m) { anchorId = m[1]; anchorLineIndex = i; break; }
  }
  if (!anchorId) return null;

  const fields: Record<string, string | string[]> = {};
  let currentField: string | null = null;
  let currentContent: string[] = [];
  const parseFrom = anchorLineIndex + 1 < lines.length ? anchorLineIndex + 1 : 0;

  for (let i = parseFrom; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const fm = matchKnownFieldStart(trimmed);
    if (fm) {
      const raw = fm[1].toUpperCase();
      if (currentField && currentContent.length > 0) saveField(fields, currentField, currentContent);
      const { content, terminated } = splitAtPipeTerminator(fm[2] || '');
      const cleaned = content.trim();
      if (terminated) {
        if (cleaned) saveField(fields, raw, [cleaned]);
        currentField = null;
        currentContent = [];
      } else {
        currentField = raw;
        currentContent = cleaned ? [cleaned] : [];
      }
    } else if (currentField) {
      const { content, terminated } = splitAtPipeTerminator(line);
      // Preserve empty lines for LaTeX block spacing (don't skip empty content)
      currentContent.push(content.replace(/[ \t]+$/g, ''));

      if (terminated) {
        saveField(fields, currentField, currentContent);
        currentField = null;
        currentContent = [];
      }
    } else if (trimmed) {
      // ignore stray lines
    }
  }

  if (currentField && currentContent.length > 0) saveField(fields, currentField, currentContent);

  // normalize
  if (fields.G) {
    const allGroups = Array.isArray(fields.G) ? fields.G.join(' ') : String(fields.G);
    const groups = allGroups.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    fields.G = groups;
  }

  // Join multi-line fields with newlines to preserve formatting (especially for LaTeX)
  // Then unescape pipe-delimited content (convert \\ to \ and \| to |)
  Object.keys(fields).forEach(k => {
    if (Array.isArray(fields[k])) {
      if (fields[k].length === 1) {
        fields[k] = unescapePipeText(fields[k][0]);
      } else {
        // Join with newlines to preserve multi-line content like LaTeX blocks
        fields[k] = unescapePipeText(fields[k].join('\n'));
      }
    }
  });

  let type: SproutCard["type"] = "basic";
  if (fields.CQ) type = "cloze";
  else if (fields.MCQ) type = "mcq";
  else if (fields.IO) type = "io";
  else if (fields.OQ) type = "oq";
  else if (fields.RQ) type = "reversed";
  else if (fields.Q) type = "basic";

  // Only show an explicit title when the card defines a T field.
  let title = "";
  if (fields.T) {
    title = Array.isArray(fields.T) ? fields.T.join(' ') : String(fields.T);
    title = title.trim();
  }

  return { anchorId, type, title, fields };
}

export function saveField(fields: Record<string, string | string[]>, fieldName: string, content: string[]) {
  if (!fields[fieldName]) fields[fieldName] = [];
  const arr = fields[fieldName];
  const normalized = content
    .map((c) => String(c).replace(/\r/g, '').replace(/[ \t]+$/g, ''));

  while (normalized.length > 0 && normalized[0].trim().length === 0) normalized.shift();
  while (normalized.length > 0 && normalized[normalized.length - 1].trim().length === 0) normalized.pop();

  const joined = normalized.join('\n');
  if (joined.length > 0 && Array.isArray(arr)) arr.push(joined);
}

/* -----------------------
   Card rendering / HTML builders
   ----------------------- */

export function renderMathInElement(el: HTMLElement) {
  // Check if MathJax is available (Obsidian loads it)
  const MathJax = (window as unknown as { MathJax?: { typesetPromise?: (els: HTMLElement[]) => Promise<unknown> } }).MathJax;
  if (MathJax && typeof MathJax.typesetPromise === 'function') {
    try {
      MathJax.typesetPromise([el]).catch((err: unknown) => {
        log.warn('MathJax rendering error:', err);
      });
    } catch (err) {
      log.warn('MathJax rendering error:', err);
    }
  }
}

export function buildCardContentHTML(card: SproutCard): string {
  let contentHTML = '';
  if (card.type === "cloze" && card.fields.CQ) {
    const clozeContent = Array.isArray(card.fields.CQ) ? card.fields.CQ.join('\n') : card.fields.CQ;
    contentHTML += buildClozeSectionHTML(clozeContent);
  } else if (card.type === "mcq" && card.fields.MCQ) {
    const question = Array.isArray(card.fields.MCQ) ? card.fields.MCQ.join('\n') : card.fields.MCQ;
    const options = Array.isArray(card.fields.O)
      ? card.fields.O
      : (typeof card.fields.O === 'string' ? card.fields.O.split('\n').filter(s => s.trim()) : []);
    const answers = Array.isArray(card.fields.A) ? card.fields.A : (card.fields.A ? [card.fields.A] : []);
    contentHTML += buildMCQSectionHTML(question, options, answers);
  } else if ((card.type === "basic" || card.type === "reversed") && (card.fields.Q || card.fields.RQ)) {
    const qField = card.type === "reversed" ? card.fields.RQ : card.fields.Q;
    const question = Array.isArray(qField) ? qField.join('\n') : qField;
    const answer = Array.isArray(card.fields.A) ? card.fields.A.join('\n') : card.fields.A;
    contentHTML += buildBasicSectionHTML(question, answer);
  } else if (card.type === "oq" && card.fields.OQ) {
    const question = Array.isArray(card.fields.OQ) ? card.fields.OQ.join('\n') : card.fields.OQ;
    // Collect numbered step fields (1, 2, 3, ...)
    const steps: string[] = [];
    const fieldsAny = card.fields as Record<string, string | string[] | undefined>;
    for (let i = 1; i <= 20; i++) {
      const key = String(i);
      const val = fieldsAny[key];
      if (val !== undefined) {
        steps.push(Array.isArray(val) ? val.join('\n') : String(val));
      }
    }
    contentHTML += buildOQSectionHTML(question, steps);
  } else if (card.type === "io" && card.fields.IO) {
    const ioContent = Array.isArray(card.fields.IO) ? card.fields.IO.join('\n') : card.fields.IO;
    contentHTML += buildIOSectionHTML(ioContent);
  }

  if (card.fields.I) {
    const infoContent = Array.isArray(card.fields.I) ? card.fields.I.join('\n') : card.fields.I;
    contentHTML += buildInfoSectionHTML(infoContent);
  }

  return contentHTML;
}

export function buildClozeSectionHTML(clozeContent: string): string {
  function renderNestedReadingViewClozeHtml(answer: string): string {
    const source = String(answer ?? "").trim();
    if (!source) return "";

    const clozeMatches = parseClozeTokens(source).tokens;
    if (!clozeMatches.length) {
      return processMarkdownFeatures(source);
    }

    let out = "";
    let last = 0;

    for (const match of clozeMatches) {
      if (match.start > last) {
        out += processMarkdownFeatures(source.slice(last, match.start));
      }

      const nestedHtml = renderNestedReadingViewClozeHtml(match.answer);
      out += nestedHtml
        ? `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${nestedHtml}</span></span>`
        : `<span class="learnkit-cloze-blank"></span>`;
      last = match.end;
    }

    if (last < source.length) {
      out += processMarkdownFeatures(source.slice(last));
    }

    return out;
  }

  let lastIndex = 0;
  let processedHtml = '';
  const clozeMatches = parseClozeTokens(clozeContent).tokens;
  for (const cm of clozeMatches) {
    if (cm.start > lastIndex) {
      const nonCloze = clozeContent.slice(lastIndex, cm.start) || '';
      processedHtml += `<span class="learnkit-text-muted">${processMarkdownFeatures(nonCloze)}</span>`;
    }
    const answer = renderNestedReadingViewClozeHtml(cm.answer);
    if (answer && answer.trim().length > 0) {
      processedHtml += `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${answer}</span></span>`;
    } else {
      processedHtml += `<span class="learnkit-cloze-blank"></span>`;
    }
    lastIndex = cm.end;
  }
  if (lastIndex < clozeContent.length) {
    const nonCloze = clozeContent.slice(lastIndex) || '';
    processedHtml += `<span class="learnkit-text-muted">${processMarkdownFeatures(nonCloze)}</span>`;
  }

  return `
    <div class="learnkit-card-section learnkit-section-question learnkit-section-cloze">
      <div class="learnkit-section-label">Question</div>
      <div class="learnkit-section-content learnkit-p-spacing-none">${processedHtml}</div>
    </div>
  `;
}

export function buildMCQSectionHTML(question: string, options: string[], answers?: string | string[]): string {
  // Normalise answers to an array of trimmed strings
  const ansArr: string[] = Array.isArray(answers)
    ? answers.map(a => a.trim()).filter(Boolean)
    : (answers ? [answers.trim()] : []);
  const ansSet = new Set(ansArr.map(a => a.trim()));

  // Shuffle options and insert answers at random positions
  function shuffleAndInsertAnswers(opts: string[], ans: string[]): { options: string[], answerIdxs: Set<number> } {
    const arr = opts.filter(opt => !ansSet.has(opt.trim()));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const answerIdxs = new Set<number>();
    for (const a of ans) {
      const idx = Math.floor(Math.random() * (arr.length + 1));
      arr.splice(idx, 0, a);
      // Recalculate indices since array shifted
    }
    // Find final answer positions
    arr.forEach((opt, idx) => {
      if (ansSet.has(opt.trim())) answerIdxs.add(idx);
    });
    return { options: arr, answerIdxs };
  }

  const shuffled = ansArr.length > 0 ? shuffleAndInsertAnswers(options, ansArr) : { options, answerIdxs: new Set<number>() };
  const allOptions = shuffled.options;
  const answerIdxs = shuffled.answerIdxs;

  // Render options as ABCD list with full stop and 6px gap, styled
  const optionsHTML = allOptions.map((opt, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const isAnswer = answerIdxs.has(idx);
    return `<div class="learnkit-option">
      <span class="learnkit-option-bullet">${letter}.</span>
      ${isAnswer
        ? `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${processMarkdownFeatures(opt)}</span></span>`
        : `<span class="learnkit-option-text">${processMarkdownFeatures(opt)}</span>`}
    </div>`;
  }).join('');

  // Collapsible options section only
  const optionsSection = buildCollapsibleSectionHTML('Options', `.learnkit-options-${Math.random().toString(36).slice(2,8)}`, `<div class="learnkit-options-list">${optionsHTML}</div>`, undefined, 'learnkit-section-options');

  return `
    <div class="learnkit-card-section learnkit-section-question">
      <div class="learnkit-section-label">Question</div>
      <div class="learnkit-section-content learnkit-text-muted learnkit-p-spacing-none">${processMarkdownFeatures(question)}</div>
    </div>
    ${optionsSection}
  `;
}

export function buildOQSectionHTML(question: string, steps: string[]): string {
  const aId = `sprout-oq-${Math.random().toString(36).slice(2,8)}`;

  const stepsHTML = steps.map((step, idx) => {
    return `<div class="learnkit-oq-answer-row">
      <span class="learnkit-option-bullet">${idx + 1}.</span>
      <span class="learnkit-option-text">${processMarkdownFeatures(step)}</span>
    </div>`;
  }).join('');

  const answerSection = buildCollapsibleSectionHTML(
    'Sequence',
    `.${aId}`,
    `<div class="learnkit-oq-answer-list">${stepsHTML}</div>`,
    undefined,
    'learnkit-section-answer'
  );

  return `
    <div class="learnkit-card-section learnkit-section-question">
      <div class="learnkit-section-label">Question</div>
      <div class="learnkit-section-content learnkit-text-muted learnkit-p-spacing-none">${processMarkdownFeatures(question)}</div>
    </div>
    ${answerSection}
  `;
}

export function buildBasicSectionHTML(question?: string, answer?: string): string {
  const qId = `sprout-q-${Math.random().toString(36).slice(2,8)}`;
  const aId = `sprout-a-${Math.random().toString(36).slice(2,8)}`;
  
  const q = question ? `
    <div class="learnkit-card-section learnkit-section-question">
      <div class="learnkit-section-label">Question</div>
      <div class="learnkit-section-content learnkit-text-muted learnkit-p-spacing-none" id="${qId}"></div>
    </div>` : '';

  const a = answer ? buildCollapsibleSectionHTML('Answer', `.learnkit-answer-${Math.random().toString(36).slice(2,8)}`, `<div class="learnkit-answer learnkit-p-spacing-none" id="${aId}"></div>`, aId, 'learnkit-section-answer') : '';

  return q + a;
}

export function buildIOSectionHTML(_ioContent: string): string {
  const ioQuestionId = `sprout-io-question-${Math.random().toString(36).slice(2,8)}`;
  const ioAnswerId = `sprout-io-answer-${Math.random().toString(36).slice(2,8)}`;

  const answerSection = buildCollapsibleSectionHTML(
    'Answer (full image)',
    `.learnkit-io-answer-${Math.random().toString(36).slice(2,8)}`,
    `<div class="learnkit-io-answer-wrap learnkit-p-spacing-none" id="${ioAnswerId}"></div>`,
    ioAnswerId,
    'learnkit-section-answer',
  );

  return `
    <div class="learnkit-card-section learnkit-section-io">
      <div class="learnkit-section-label">Image Occlusion</div>
      <div class="learnkit-section-content learnkit-p-spacing-none" id="${ioQuestionId}"></div>
    </div>
    ${answerSection}
  `;
}

export function buildInfoSectionHTML(_infoContent: string): string {
  const iId = `sprout-i-${Math.random().toString(36).slice(2,8)}`;
  return buildCollapsibleSectionHTML('Extra Information', `.learnkit-info-${Math.random().toString(36).slice(2,8)}`, `<div class="learnkit-info learnkit-p-spacing-none" id="${iId}"></div>`, iId, 'learnkit-section-info');
}

export function buildCollapsibleSectionHTML(label: string, targetSelector: string, innerHtml: string, _markdownId?: string, sectionClass = '') {
  // targetSelector should be unique per card instance; caller supplies a selector string starting with '.'
  const contentId = targetSelector.startsWith('.') ? targetSelector.slice(1) : targetSelector.replace('#','');

  // inline Lucide chevron-down SVG; collapsed => rotated right, expanded => down
  const chevronSvg = `<!--lucide:chevron-down--><svg class="learnkit-toggle-chevron learnkit-toggle-chevron-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>`;

  return `
    <div class="learnkit-card-section ${escapeHtml(sectionClass).trim()}">
      <div class="learnkit-section-label">
        <span>${escapeHtml(label)}</span>
        <button class="learnkit-toggle-btn learnkit-toggle-btn-compact" data-target=".${contentId}" aria-expanded="false" aria-label="Toggle ${escapeHtml(label)}" data-tooltip-position="top">
          ${chevronSvg}
        </button>
      </div>
      <div class="${contentId} learnkit-collapsible collapsed learnkit-p-spacing-none">${innerHtml}</div>
    </div>
  `;
}

/* -----------------------
   Markdown parsing
   ----------------------- */

export interface ParsedMarkdownElement {
  type: 'header' | 'ordered-list' | 'unordered-list' | 'paragraph';
  level?: number; // for headers (1-6)
  content: string; // header text, list items joined, or paragraph text
  items?: string[]; // for lists
}

/**
 * Parse markdown text into separate element structures
 * Handles: headers, ordered lists, unordered lists, and paragraphs
 */
export function parseMarkdownToElements(text: string): ParsedMarkdownElement[] {
  const elements: ParsedMarkdownElement[] = [];
  
  // Normalize whitespace - MathJax errors often have everything on one line
  // Split on patterns that indicate new elements
  let remaining = text.trim();
  
  // First, try to extract header at the start
  const headerMatch = remaining.match(/^(#{1,6})\s+([^\d[\]]+?)(?=\s*\d+\.\s|\s*[-*]\s|$)/);
  if (headerMatch) {
    elements.push({
      type: 'header',
      level: headerMatch[1].length,
      content: headerMatch[2].trim()
    });
    remaining = remaining.slice(headerMatch[0].length).trim();
  }
  
  // Look for ordered list items (1. 2. etc)
  const orderedListRegex = /(\d+)\.\s*(\[[^\]]*\]\([^)]*\)|[^\d]+?)(?=\s*\d+\.\s|$)/g;
  const orderedItems: string[] = [];
  let orderedMatch;
  while ((orderedMatch = orderedListRegex.exec(remaining)) !== null) {
    orderedItems.push(orderedMatch[2].trim());
  }
  
  if (orderedItems.length > 0) {
    elements.push({
      type: 'ordered-list',
      content: orderedItems.join('\n'),
      items: orderedItems
    });
    // Remove matched list from remaining
    remaining = remaining.replace(orderedListRegex, '').trim();
  }
  
  // Look for unordered list items (- or *)
  const unorderedListRegex = /[-*]\s+(.+?)(?=\s*[-*]\s|$)/g;
  const unorderedItems: string[] = [];
  let unorderedMatch;
  while ((unorderedMatch = unorderedListRegex.exec(remaining)) !== null) {
    unorderedItems.push(unorderedMatch[1].trim());
  }
  
  if (unorderedItems.length > 0) {
    elements.push({
      type: 'unordered-list',
      content: unorderedItems.join('\n'),
      items: unorderedItems
    });
    remaining = remaining.replace(unorderedListRegex, '').trim();
  }
  
  // Any remaining content becomes a paragraph
  if (remaining.length > 0 && !remaining.match(/^[\s\d.\-*#]+$/)) {
    elements.push({
      type: 'paragraph',
      content: remaining
    });
  }
  
  return elements;
}

/**
 * Create a DOM element from parsed markdown structure
 * Matches Obsidian's DOM structure for proper styling
 */
export function createMarkdownElement(data: ParsedMarkdownElement): HTMLElement | null {
  if (data.type === 'header' && data.level) {
    const wrapper = document.createElement('div');
    wrapper.className = `el-h${data.level}`;
    wrapper.setAttribute('data-learnkit-extracted', 'true');
    
    const header = document.createElement(`h${data.level}`);
    header.setAttribute('data-heading', data.content);
    header.setAttribute('dir', 'auto');
    header.textContent = data.content;
    
    wrapper.appendChild(header);
    return wrapper;
  }
  
  if (data.type === 'ordered-list' && data.items) {
    const wrapper = document.createElement('div');
    wrapper.className = 'el-ol';
    wrapper.setAttribute('data-learnkit-extracted', 'true');
    
    const ol = document.createElement('ol');
    ol.className = 'has-list-bullet';
    
    for (const item of data.items) {
      const li = document.createElement('li');
      li.setAttribute('data-line', '0');
      li.setAttribute('dir', 'auto');
      
      // Parse links in the item text
      const linkMatch = item.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const linkText = linkMatch[1];
        const linkUrl = linkMatch[2];
        
        const span = document.createElement('span');
        span.className = 'list-bullet';
        li.appendChild(span);
        
        const link = document.createElement('a');
        link.href = linkUrl;
        link.className = 'external-link';
        link.setAttribute('rel', 'noopener');
        link.setAttribute('target', '_blank');
        link.textContent = linkText;
        li.appendChild(link);
      } else {
        const span = document.createElement('span');
        span.className = 'list-bullet';
        li.appendChild(span);
        li.appendChild(document.createTextNode(item));
      }
      
      ol.appendChild(li);
    }
    
    wrapper.appendChild(ol);
    return wrapper;
  }
  
  if (data.type === 'unordered-list' && data.items) {
    const wrapper = document.createElement('div');
    wrapper.className = 'el-ul';
    wrapper.setAttribute('data-learnkit-extracted', 'true');
    
    const ul = document.createElement('ul');
    ul.className = 'has-list-bullet';
    
    for (const item of data.items) {
      const li = document.createElement('li');
      li.setAttribute('data-line', '0');
      li.setAttribute('dir', 'auto');
      
      const span = document.createElement('span');
      span.className = 'list-bullet';
      li.appendChild(span);
      li.appendChild(document.createTextNode(item));
      
      ul.appendChild(li);
    }
    
    wrapper.appendChild(ul);
    return wrapper;
  }
  
  if (data.type === 'paragraph') {
    const wrapper = document.createElement('div');
    wrapper.className = 'el-p';
    wrapper.setAttribute('data-learnkit-extracted', 'true');
    
    const p = document.createElement('p');
    p.setAttribute('dir', 'auto');
    p.textContent = data.content;
    wrapper.appendChild(p);
    
    return wrapper;
  }
  
  return null;
}

/* -----------------------
   Content detection
   ----------------------- */

/**
 * Check if an element contains content that should NOT be hidden
 * (e.g., markdown headers that got merged into LaTeX blocks)
 * Returns: { hasNonCardContent: boolean, contentAfterPipe?: string }
 */
export function checkForNonCardContent(el: Element): { hasNonCardContent: boolean; contentAfterPipe?: string } {
  const text = el.textContent || '';
  
  // Check for markdown content after pipe delimiter
  // Pattern: anything <delim> followed by markdown content (e.g., # Header, list items, etc.)
  // Extract EVERYTHING after the delimiter so we can recreate proper DOM elements
  const delimRe = escapeDelimiterRe();
  const pipeMatch = text.match(new RegExp(`${delimRe}\\s*(#{1,6}\\s+.+)`, "s"));
  if (pipeMatch) {
    debugLog('[Hide Siblings] Found content after delimiter:', pipeMatch[1].substring(0, 80));
    return { hasNonCardContent: true, contentAfterPipe: pipeMatch[1].trim() };
  }
  
  // Check for standalone header syntax at start of text (after trimming)
  const trimmed = text.trim();
  if (/^#\s+\S/.test(trimmed)) {
    debugLog('[Hide Siblings] Element starts with header:', trimmed.substring(0, 80));
    return { hasNonCardContent: true, contentAfterPipe: trimmed };
  }
  
  // Check if MathJax error contains header-like content after pipe
  const mjxError = queryFirst(el, 'mjx-merror');
  if (mjxError) {
    const errorText = mjxError.textContent || '';
    // Match delimiter followed by ANY content starting with header - capture everything
    // Use 's' flag to make . match newlines
    const errorPipeMatch = errorText.match(new RegExp(`${delimRe}\\s*(#{1,6}\\s+[\\s\\S]*)`));
    if (errorPipeMatch) {
      debugLog('[Hide Siblings] MathJax error has content after delimiter:', errorPipeMatch[1].substring(0, 80));
      return { hasNonCardContent: true, contentAfterPipe: errorPipeMatch[1].trim() };
    }
  }
  
  return { hasNonCardContent: false };
}

/**
 * Legacy wrapper for backward compatibility
 */
export function containsNonCardContent(el: Element): boolean {
  return checkForNonCardContent(el).hasNonCardContent;
}
