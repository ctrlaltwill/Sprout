/**
 * @file src/platform/core/tooltip-defaults.ts
 * @summary Module for tooltip defaults.
 *
 * @exports
 *  - initButtonTooltipDefaults
 */
function normalizeTooltipText(v) {
    return String(v !== null && v !== void 0 ? v : "")
        .replace(/\s+/g, " ")
        .trim();
}
function shouldSkipAutoTooltip(el) {
    return !!el.closest(".learnkit-mcq-options, .learnkit-oq-step-list, .learnkit-oq-answer-list");
}
function ensureTooltip(el) {
    var _a, _b, _c;
    if (shouldSkipAutoTooltip(el)) {
        if (el.hasAttribute("title"))
            el.removeAttribute("title");
        return;
    }
    // Always remove native tooltips.
    if (el.hasAttribute("title"))
        el.removeAttribute("title");
    if (el.hasAttribute("aria-label")) {
        if (!el.hasAttribute("data-tooltip-position"))
            el.setAttribute("data-tooltip-position", "top");
        return;
    }
    const aria = normalizeTooltipText((_a = el.getAttribute("aria-label")) !== null && _a !== void 0 ? _a : "");
    const title = normalizeTooltipText((_b = el.getAttribute("title")) !== null && _b !== void 0 ? _b : "");
    const text = normalizeTooltipText((_c = el.textContent) !== null && _c !== void 0 ? _c : "");
    const tooltip = aria || title || text;
    if (!tooltip)
        return;
    el.setAttribute("aria-label", tooltip);
    if (!el.hasAttribute("data-tooltip-position"))
        el.setAttribute("data-tooltip-position", "top");
}
function processNode(node) {
    if (!(node instanceof HTMLElement))
        return;
    // Process the node itself
    if (node.matches("button,[role='button']"))
        ensureTooltip(node);
    // Process descendants
    const descendants = node.querySelectorAll("button,[role='button']");
    descendants.forEach((el) => ensureTooltip(el));
}
/**
 * Normalizes tooltips for buttons across the app using a MutationObserver.
 * Returns a cleanup function to call on plugin unload.
 */
export function initButtonTooltipDefaults() {
    if (typeof document === "undefined")
        return () => { };
    const root = document.body;
    if (!root)
        return () => { };
    // Initial pass (Obsidian loads views long after DOMContentLoaded)
    processNode(root);
    const obs = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            m.addedNodes.forEach((n) => processNode(n));
            // If attributes change (e.g., textContent updated later), callers should
            // set `aria-label` explicitly; we intentionally don't observe characterData.
        });
    });
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
}
