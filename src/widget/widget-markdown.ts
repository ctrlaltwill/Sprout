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

import { log } from "../core/logger";
import type { App } from "obsidian";

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
 */
export function processMarkdownFeatures(text: string): string {
  if (!text) return "";
  let result = String(text);

  // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
  result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, target: string, display?: string) => {
    const linkText = display || target;
    return `<a href="#" class="internal-link" data-href="${escapeHtml(target)}">${escapeHtml(linkText)}</a>`;
  });

  // ── Inline formatting (standard Obsidian markdown) ──
  // Order matters: bold (**) before italic (*)

  // Bold: **text** → <strong>text</strong>
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text* → <em>text</em>
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Italic: _text_ → <em>text</em>  (Obsidian standard)
  result = result.replace(/(?<![\w\\])_(.+?)_(?![\w])/g, '<em>$1</em>');

  // Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Highlight: ==text== → <mark>text</mark>
  result = result.replace(/==(.+?)==/g, '<mark>$1</mark>');

  // Preserve LaTeX for MathJax
  return result;
}

/* ------------------------------------------------------------------ */
/*  MathJax rendering                                                  */
/* ------------------------------------------------------------------ */

/** Triggers MathJax typesetting on the given element (no-op if MathJax absent). */
export function renderMathInElement(el: HTMLElement): void {
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
