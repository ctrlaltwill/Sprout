/**
 * @file src/widget/widget-markdown.ts
 * @summary Pure utility functions for markdown and HTML processing used by the Sprout sidebar widget. Handles HTML escaping, wiki-link and LaTeX conversion, MathJax typesetting, and internal link click-handler wiring.
 *
 * @exports
 *  - escapeHtml                — escapes HTML special characters in a string
 *  - processMarkdownFeatures   — converts [[wiki-links]] and preserves LaTeX delimiters in text
 *  - renderMathInElement       — triggers MathJax typesetting on a DOM element
 *  - setupInternalLinkHandlers — wires click handlers for internal [[wiki-link]] elements
 */

import { log } from "../../../platform/core/logger";
import type { App } from "obsidian";
import { convertInlineDisplayMath } from "../../../platform/core/shared-utils";
import { replaceCircleFlagTokens, hydrateCircleFlagsInElement } from "../../../platform/flags/flag-tokens";

/* ------------------------------------------------------------------ */
/*  HTML escaping                                                      */
/* ------------------------------------------------------------------ */

/** Escapes HTML special characters in a string. */
function toSafeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

export function escapeHtml(s: unknown): string {
  return toSafeText(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ */
/*  Wiki-link / LaTeX processing                                       */
/* ------------------------------------------------------------------ */

/**
 * Process wiki links `[[Link]]`, LaTeX, and inline formatting for widget display.
 * Converts wiki links to clickable links, preserves LaTeX for rendering, and
 * applies standard Obsidian inline markdown formatting.
 *
 *   **text**   → <strong>   (bold)
 *   *text*     → <em>       (italic)
 *   _text_     → <em>       (italic — same as *text* in Obsidian)
 *   ~~text~~   → <s>        (strikethrough)
 *   ==text==   → <mark>     (highlight)
 *   `text`     → <code>text</code>
 *
 * @param text  Raw text to process
 * @param opts  Options: { imageEmbeds?: boolean } — enable ![[image]] → <img> conversion
 */
export function processMarkdownFeatures(text: string, opts?: { imageEmbeds?: boolean }): string {
  if (!text) return "";
  const imageEmbeds = opts?.imageEmbeds === true;
  const source = convertInlineDisplayMath(String(text));

  // ── Extract math blocks before applying markdown formatting ──
  // LaTeX delimiters contain characters like _ * ^ that conflict with
  // markdown formatting rules. We replace math blocks with placeholders,
  // apply markdown formatting to non-math text, then restore the math.
  const mathPlaceholders: string[] = [];
  const MATH_PH = "@@SPROUTMATH";

  const mathBlockRe = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)[^\s$](?:[^$]*[^\s$])?\$(?!\$)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;
  const withPlaceholders = source.replace(mathBlockRe, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `${MATH_PH}${idx}@@`;
  });

  // ── HTML-escape all text content BEFORE any tag-generating processing ──
  // This ensures literal < and > (e.g. "git reset <commit-sha>") survive
  // innerHTML insertion instead of being silently dropped as unknown tags.
  let result = escapeHtml(withPlaceholders);

  // ── Image embeds ![[image.ext|alt]] → <img> (reading view only) ──
  // Must come BEFORE [[link]] handling to avoid partial matches.
  if (imageEmbeds) {
    result = result.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g, (_match: string, target: string, alt?: string) => {
      const altText = alt || target.split("/").pop() || target;
      // target / altText already HTML-escaped by escapeHtml() above
      return `<img class="learnkit-reading-embed-img" data-embed-path="${target.trim()}" alt="${altText}" />`;
    });
  }

  // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
  result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, target: string, display?: string) => {
    const linkText = display || target;
    // target / linkText already HTML-escaped by escapeHtml() above
    return `<a href="#" class="internal-link" data-href="${target}">${linkText}</a>`;
  });

  // ── Inline formatting (standard Obsidian markdown) ──
  // Order matters: code before bold, bold before italic

  // Inline code: `text` → <code>text</code>
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **text** → <strong>text</strong>
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text* → <em>text</em>
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Italic: _text_ → <em>text</em>  (Obsidian standard)
  result = result.replace(/(?<![\w\\])_(.+?)_(?![\w])/g, "<em>$1</em>");

  // Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Highlight: ==text== → <mark>text</mark>
  result = result.replace(/==(.+?)==/g, "<mark>$1</mark>");

  result = replaceCircleFlagTokens(result);

  // ── Restore math blocks ──
  if (mathPlaceholders.length) {
    result = result.replace(/@@SPROUTMATH(\d+)@@/g, (_m, idx) => {
      return mathPlaceholders[Number(idx)] ?? _m;
    });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  MathJax rendering                                                  */
/* ------------------------------------------------------------------ */

/** Triggers MathJax typesetting on the given element (no-op if MathJax absent). */
export function renderMathInElement(el: HTMLElement): void {
  hydrateCircleFlagsInElement(el);
  const MathJax = (window as unknown as { MathJax?: { typesetPromise?: (els: HTMLElement[]) => Promise<unknown> } }).MathJax;
  if (MathJax && typeof MathJax.typesetPromise === "function") {
    try {
      MathJax.typesetPromise([el]).catch((err: unknown) => {
        log.warn("MathJax rendering error:", err);
      });
    } catch (err) {
      log.warn("MathJax rendering error:", err);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Internal link click handlers                                       */
/* ------------------------------------------------------------------ */

/**
 * Wires `click` handlers on all `a.internal-link` elements inside `el`
 * so they open the target note inside Obsidian.
 *
 * @param el  – container element to scan
 * @param app – the Obsidian `App` instance
 */
export function setupInternalLinkHandlers(el: HTMLElement, app: App): void {
  const internalLinks = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");
  internalLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = link.getAttribute("data-href");
      if (href) {
        void app.workspace.openLinkText(href, "", true);
      }
    });
  });
}