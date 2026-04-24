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
import { replaceCircleFlagTokens, hydrateCircleFlagsInElement } from "../../../platform/flags/flag-tokens";
/* ------------------------------------------------------------------ */
/*  HTML escaping                                                      */
/* ------------------------------------------------------------------ */
/** Escapes HTML special characters in a string. */
function toSafeText(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
        return String(value);
    return "";
}
export function escapeHtml(s) {
    return toSafeText(s !== null && s !== void 0 ? s : "")
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
export function processMarkdownFeatures(text) {
    if (!text)
        return "";
    const source = String(text);
    // ── Extract math blocks before applying markdown formatting ──
    // LaTeX delimiters contain characters like _ * ^ that conflict with
    // markdown formatting rules. We replace math blocks with placeholders,
    // apply markdown formatting to non-math text, then restore the math.
    const mathPlaceholders = [];
    const MATH_PH = "@@SPROUTMATH";
    const mathBlockRe = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)[^\s$](?:[^$]*[^\s$])?\$(?!\$)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;
    const withPlaceholders = source.replace(mathBlockRe, (match) => {
        const idx = mathPlaceholders.length;
        mathPlaceholders.push(match);
        return `${MATH_PH}${idx}@@`;
    });
    let result = withPlaceholders;
    // Convert wiki links [[Page]] or [[Page|Display]] to HTML links
    result = result.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, display) => {
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
    result = replaceCircleFlagTokens(result);
    // ── Restore math blocks ──
    if (mathPlaceholders.length) {
        result = result.replace(/@@SPROUTMATH(\d+)@@/g, (_m, idx) => {
            var _a;
            return (_a = mathPlaceholders[Number(idx)]) !== null && _a !== void 0 ? _a : _m;
        });
    }
    return result;
}
/* ------------------------------------------------------------------ */
/*  MathJax rendering                                                  */
/* ------------------------------------------------------------------ */
/** Triggers MathJax typesetting on the given element (no-op if MathJax absent). */
export function renderMathInElement(el) {
    hydrateCircleFlagsInElement(el);
    const MathJax = window.MathJax;
    if (MathJax && typeof MathJax.typesetPromise === "function") {
        try {
            MathJax.typesetPromise([el]).catch((err) => {
                log.warn("MathJax rendering error:", err);
            });
        }
        catch (err) {
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
export function setupInternalLinkHandlers(el, app) {
    const internalLinks = el.querySelectorAll("a.internal-link");
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
