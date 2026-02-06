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

import { log } from "../core/logger";

/* -----------------------
   Constants
   ----------------------- */

/** Zero-width space + BOM stripper */
export const INVIS_RE = /[\u200B\uFEFF]/g;

/** Relaxed anchor regex (match anywhere on a line) */
export const ANCHOR_RE = /\^sprout-(\d{6,12})/;

export const FIELD_START_RE = /^([A-Za-z]+)\s*\|\s*(.*)$/;

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
 * Unescape pipe-delimited field text.
 * Converts \\ → \ and \| → |
 * This matches the parser.ts logic.
 */
export function unescapePipeText(s: string): string {
  return s.replace(/\\\\/g, "\\").replace(/\\\|/g, "|");
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
 * Process wiki links [[Link]] and LaTeX $...$ and $$...$$ for reading view.
 * Converts wiki links to clickable links and preserves LaTeX for rendering.
 */
export function processMarkdownFeatures(text: string): string {
  if (!text) return '';
  let result = String(text);
  
  // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
  result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, target: string, display?: string) => {
    const linkText = display || target;
    // Create a data attribute for Obsidian to handle the click
    return `<a href="#" class="internal-link" data-href="${escapeHtml(target)}">${escapeHtml(linkText)}</a>`;
  });
  
  // Preserve LaTeX by escaping the content but keeping delimiters
  // This allows MathJax or similar to process it later
  return result;
}

export function splitAtPipeTerminator(line: string): { content: string; terminated: boolean } {
  // Match trailing pipe: not preceded by backslash, optionally followed by whitespace
  // Handles: "content |" or "$$ |" or "text|" but NOT "\|" (escaped pipe in LaTeX)
  const match = line.match(/(?<!\\)\|\s*$/);
  if (!match || match.index === undefined) {
    return { content: line, terminated: false };
  }

  return {
    content: line.slice(0, match.index).trimEnd(),
    terminated: true,
  };
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
  const inlineScript = mathEl.querySelector('script[type="math/tex"]');
  if (inlineScript) {
    return inlineScript.textContent || '';
  }
  
  // Method 3: Obsidian might store it in a data attribute
  const dataAttr = mathEl.getAttribute('data-latex') || mathEl.getAttribute('data-tex') || mathEl.getAttribute('data-formula');
  if (dataAttr) return dataAttr;
  
  // Method 4: Try to reconstruct from MathJax's internal structure
  // The mjx-math element might have the LaTeX classes that hint at structure
  const mjxMath = mathEl.querySelector('mjx-math');
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
  const pTag = el.querySelector('p[dir="auto"]');
  if (!pTag) {
    return extractTextWithLaTeX(el);
  }
  
  // Get the innerHTML and convert <br> tags to newlines
  let html = pTag.innerHTML;
  
  // Replace <br> and <br/> with newlines
  html = html.replace(/<br\s*\/?>/gi, '\n');
  
  // Now we need to extract text while handling <span class="math"> elements
  // Create a temporary div to parse the HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
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
  
  // Find the line with ^sprout-{anchorId}
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`^sprout-${anchorId}`)) {
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
    
    // Stop if we hit a markdown header
    if (trimmed.match(/^#{1,6}\s/)) break;
    
    // Check if this line starts a new field
    if (trimmed.match(FIELD_START_RE)) {
      inPipeField = true;
      lastFieldHadClosingPipe = false;
      
      // Check if the field closes on the same line
      if (trimmed.endsWith('|') && trimmed.indexOf('|') !== trimmed.lastIndexOf('|')) {
        inPipeField = false;
        lastFieldHadClosingPipe = true;
      }
      cardLines.push(line);
      continue;
    }
    
    // If we're in a pipe field, continue until we find the closing pipe
    if (inPipeField) {
      cardLines.push(line);
      if (trimmed.endsWith('|')) {
        inPipeField = false;
        lastFieldHadClosingPipe = true;
      }
      continue;
    }
    
    // If the last field had a closing pipe and this line is empty, check next line
    if (lastFieldHadClosingPipe && !trimmed) {
      // Peek at next line
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        // If next line is a header, another anchor, or doesn't start a field, we're done
        if (nextLine.match(/^#{1,6}\s/) || nextLine.match(ANCHOR_RE) || !nextLine.match(FIELD_START_RE)) {
          break;
        }
      }
      cardLines.push(line);
      continue;
    }
    
    // If we're not in a field and hit a non-empty line that isn't a field start, we're done
    if (trimmed && !trimmed.match(FIELD_START_RE)) {
      break;
    }
    
    cardLines.push(line);
  }
  
  return cardLines.join('\n');
}

export interface SproutCard {
  anchorId: string;
  type: "basic" | "cloze" | "mcq" | "io";
  title: string;
  fields: {
    T?: string | string[];
    Q?: string | string[];
    A?: string | string[];
    CQ?: string | string[];
    MCQ?: string | string[];
    O?: string | string[];
    I?: string | string[];
    G?: string | string[];
    IO?: string | string[];
  };
}

export function parseSproutCard(text: string): SproutCard | null {
  // Don't filter empty lines - they're significant for multi-line LaTeX blocks
  const lines = text.split('\n').map(l => clean(l).trim());
  if (lines.every(l => l.length === 0)) return null;

  let anchorLineIndex = -1;
  let anchorId = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANCHOR_RE);
    if (m) { anchorId = m[1]; anchorLineIndex = i; break; }
  }
  if (!anchorId) return null;

  const fields: Record<string, string | string[]> = {};
  let currentField: string | null = null;
  let currentContent: string[] = [];
  const parseFrom = anchorLineIndex + 1 < lines.length ? anchorLineIndex + 1 : 0;

  for (let i = parseFrom; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(FIELD_START_RE);
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
      currentContent.push(content.trim());

      if (terminated) {
        saveField(fields, currentField, currentContent);
        currentField = null;
        currentContent = [];
      }
    } else if (line) {
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
  else if (fields.Q) type = "basic";

  // Use full T field (join if multiple lines) to ensure full title displayed
  let title = `Card ${anchorId}`;
  if (fields.T) {
    title = Array.isArray(fields.T) ? fields.T.join(' ') : String(fields.T);
    title = title.trim();
  }

  return { anchorId, type, title, fields };
}

export function saveField(fields: Record<string, string | string[]>, fieldName: string, content: string[]) {
  if (!fields[fieldName]) fields[fieldName] = [];
  const arr = fields[fieldName];
  const filtered = content.map(c => String(c).trim()).filter(c => c.length > 0);
  if (filtered.length > 0 && Array.isArray(arr)) arr.push(...filtered);
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
    const answer = Array.isArray(card.fields.A) ? card.fields.A.join('\n') : card.fields.A;
    contentHTML += buildMCQSectionHTML(question, options, answer);
  } else if (card.type === "basic" && card.fields.Q) {
    const question = Array.isArray(card.fields.Q) ? card.fields.Q.join('\n') : card.fields.Q;
    const answer = Array.isArray(card.fields.A) ? card.fields.A.join('\n') : card.fields.A;
    contentHTML += buildBasicSectionHTML(question, answer);
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
  let lastIndex = 0;
  let processedHtml = '';
  const clozeRegex = /\{\{c\d+::(.*?)\}\}/g;
  let match;
  while ((match = clozeRegex.exec(clozeContent)) !== null) {
    if (match.index > lastIndex) {
      const nonCloze = clozeContent.slice(lastIndex, match.index) || '';
      processedHtml += `<span class="sprout-text-muted">${processMarkdownFeatures(nonCloze)}</span>`;
    }
    const answer = match[1];
    if (answer && answer.trim().length > 0) {
      processedHtml += `<span class="sprout-reading-view-cloze"><span class="sprout-cloze-text">${processMarkdownFeatures(answer)}</span></span>`;
    } else {
      processedHtml += `<span class="sprout-cloze-blank"></span>`;
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < clozeContent.length) {
    const nonCloze = clozeContent.slice(lastIndex) || '';
    processedHtml += `<span class="sprout-text-muted">${processMarkdownFeatures(nonCloze)}</span>`;
  }

  return `
    <div class="sprout-card-section sprout-section-cloze">
      <div class="sprout-section-label">Question</div>
      <div class="sprout-section-content" style="--p-spacing: 0px;">${processedHtml}</div>
    </div>
  `;
}

export function buildMCQSectionHTML(question: string, options: string[], answer?: string): string {
  // Shuffle options and insert answer at random position
  function shuffleAndInsertAnswer(opts: string[], ans: string): { options: string[], answerIdx: number } {
    const arr = opts.filter(opt => opt.trim() !== ans.trim());
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const answerIdx = Math.floor(Math.random() * (arr.length + 1));
    arr.splice(answerIdx, 0, ans);
    return { options: arr, answerIdx };
  }

  const shuffled = answer ? shuffleAndInsertAnswer(options, answer) : { options, answerIdx: -1 };
  const allOptions = shuffled.options;
  const answerIdx = shuffled.answerIdx;

  // Render options as ABCD list with full stop and 6px gap, styled
  const optionsHTML = allOptions.map((opt, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const isAnswer = idx === answerIdx;
    return `<div class="sprout-option">
      <span class="sprout-option-bullet">${letter}.</span>
      ${isAnswer
        ? `<span class="sprout-reading-view-cloze"><span class="sprout-cloze-text">${processMarkdownFeatures(opt)}</span></span>`
        : `<span class="sprout-option-text">${processMarkdownFeatures(opt)}</span>`}
    </div>`;
  }).join('');

  // Collapsible options section only
  const optionsSection = buildCollapsibleSectionHTML('Options', `.sprout-options-${Math.random().toString(36).slice(2,8)}`, `<div class="sprout-options-list">${optionsHTML}</div>`);

  return `
    <div class="sprout-card-section">
      <div class="sprout-section-label">Question</div>
      <div class="sprout-section-content sprout-text-muted" style="--p-spacing: 0px;">${processMarkdownFeatures(question)}</div>
    </div>
    ${optionsSection}
  `;
}

export function buildBasicSectionHTML(question: string, answer?: string): string {
  const qId = `sprout-q-${Math.random().toString(36).slice(2,8)}`;
  const aId = `sprout-a-${Math.random().toString(36).slice(2,8)}`;
  
  const q = question ? `
    <div class="sprout-card-section">
      <div class="sprout-section-label">Question</div>
      <div class="sprout-section-content sprout-text-muted" id="${qId}" style="--p-spacing: 0px;"></div>
    </div>` : '';

  const a = answer ? buildCollapsibleSectionHTML('Answer', `.sprout-answer-${Math.random().toString(36).slice(2,8)}`, `<div class="sprout-answer" id="${aId}" style="--p-spacing: 0px;"></div>`, aId) : '';

  return q + a;
}

export function buildIOSectionHTML(ioContent: string): string {
  return `
    <div class="sprout-card-section sprout-section-io">
      <div class="sprout-section-label">Image Occlusion</div>
      <div class="sprout-section-content" style="--p-spacing: 0px;">${processMarkdownFeatures(ioContent)}</div>
    </div>
  `;
}

export function buildInfoSectionHTML(_infoContent: string): string {
  const iId = `sprout-i-${Math.random().toString(36).slice(2,8)}`;
  return buildCollapsibleSectionHTML('Extra Information', `.sprout-info-${Math.random().toString(36).slice(2,8)}`, `<div class="sprout-info" id="${iId}" style="--p-spacing: 0px;"></div>`, iId);
}

export function buildCollapsibleSectionHTML(label: string, targetSelector: string, innerHtml: string, _markdownId?: string) {
  // targetSelector should be unique per card instance; caller supplies a selector string starting with '.'
  const contentId = targetSelector.startsWith('.') ? targetSelector.slice(1) : targetSelector.replace('#','');

  // inline Lucide chevron-down SVG; collapsed => rotated right, expanded => down
  const chevronSvg = `<!--lucide:chevron-down--><svg class="sprout-toggle-chevron sprout-toggle-chevron-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>`;

  return `
    <div class="sprout-card-section">
      <div class="sprout-section-label">
        <span>${escapeHtml(label)}</span>
        <button class="sprout-toggle-btn" data-target=".${contentId}" aria-expanded="false" title="Toggle ${escapeHtml(label)}" style="padding:0px!important;">
          ${chevronSvg}
        </button>
      </div>
      <div class="${contentId} sprout-collapsible collapsed" style="--p-spacing: 0px;">${innerHtml}</div>
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
    wrapper.setAttribute('data-sprout-extracted', 'true');
    
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
    wrapper.setAttribute('data-sprout-extracted', 'true');
    
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
    wrapper.setAttribute('data-sprout-extracted', 'true');
    
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
    wrapper.setAttribute('data-sprout-extracted', 'true');
    
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
  // Pattern: anything | followed by markdown content (e.g., # Header, list items, etc.)
  // Extract EVERYTHING after the pipe so we can recreate proper DOM elements
  const pipeMatch = text.match(/\|\s*(#{1,6}\s+.+)/s);
  if (pipeMatch) {
    debugLog('[Hide Siblings] Found content after pipe:', pipeMatch[1].substring(0, 80));
    return { hasNonCardContent: true, contentAfterPipe: pipeMatch[1].trim() };
  }
  
  // Check for standalone header syntax at start of text (after trimming)
  const trimmed = text.trim();
  if (/^#\s+\S/.test(trimmed)) {
    debugLog('[Hide Siblings] Element starts with header:', trimmed.substring(0, 80));
    return { hasNonCardContent: true, contentAfterPipe: trimmed };
  }
  
  // Check if MathJax error contains header-like content after pipe
  const mjxError = el.querySelector('mjx-merror');
  if (mjxError) {
    const errorText = mjxError.textContent || '';
    // Match pipe followed by ANY content starting with header - capture everything
    // Use 's' flag to make . match newlines
    const errorPipeMatch = errorText.match(/\|\s*(#{1,6}\s+[\s\S]*)/);
    if (errorPipeMatch) {
      debugLog('[Hide Siblings] MathJax error has content after pipe:', errorPipeMatch[1].substring(0, 80));
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
