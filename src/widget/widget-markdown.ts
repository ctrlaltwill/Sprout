/**
 * widget/widget-markdown.ts
 * ─────────────────────────
 * Pure utility functions for markdown / HTML processing used by the
 * Sprout sidebar widget.
 *
 * Exports:
 *  - escapeHtml              – escape HTML special characters
 *  - processMarkdownFeatures – convert wiki-links and preserve LaTeX
 *  - renderMathInElement     – trigger MathJax typesetting on an element
 *  - setupInternalLinkHandlers – wire click handlers for [[wiki-links]]
 */

import { log } from "../core/logger";

/* ------------------------------------------------------------------ */
/*  HTML escaping                                                      */
/* ------------------------------------------------------------------ */

/** Escapes HTML special characters in a string. */
export function escapeHtml(s: string): string {
  return String(s ?? "")
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
 * Process wiki links `[[Link]]` and LaTeX for widget display.
 * Converts wiki links to clickable links and preserves LaTeX for rendering.
 */
export function processMarkdownFeatures(text: string): string {
  if (!text) return "";
  let result = String(text);

  // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
  result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, display) => {
    const linkText = display || target;
    return `<a href="#" class="internal-link" data-href="${escapeHtml(target)}">${escapeHtml(linkText)}</a>`;
  });

  // Preserve LaTeX for MathJax
  return result;
}

/* ------------------------------------------------------------------ */
/*  MathJax rendering                                                  */
/* ------------------------------------------------------------------ */

/** Triggers MathJax typesetting on the given element (no-op if MathJax absent). */
export function renderMathInElement(el: HTMLElement): void {
  const MathJax = window.MathJax;
  if (MathJax && typeof MathJax.typesetPromise === "function") {
    try {
      MathJax.typesetPromise([el]).catch((err: any) => {
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
export function setupInternalLinkHandlers(el: HTMLElement, app: any): void {
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
