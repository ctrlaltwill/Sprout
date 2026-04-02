/**
 * @file src/platform/core/tooltip-defaults.ts
 * @summary Module for tooltip defaults.
 *
 * @exports
 *  - initButtonTooltipDefaults
 */

type TooltipTarget = HTMLElement & {
  textContent: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

function normalizeTooltipText(v: string): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSkipAutoTooltip(el: HTMLElement): boolean {
  return !!el.closest(".learnkit-mcq-options, .learnkit-oq-step-list, .learnkit-oq-answer-list");
}

function ensureTooltip(el: TooltipTarget): void {
  if (shouldSkipAutoTooltip(el)) {
    if (el.hasAttribute("title")) el.removeAttribute("title");
    return;
  }

  // Always remove native tooltips.
  if (el.hasAttribute("title")) el.removeAttribute("title");

  if (el.hasAttribute("aria-label")) {
    if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
    return;
  }

  const aria = normalizeTooltipText(el.getAttribute("aria-label") ?? "");
  const title = normalizeTooltipText(el.getAttribute("title") ?? "");
  const text = normalizeTooltipText(el.textContent ?? "");

  const tooltip = aria || title || text;
  if (!tooltip) return;

  el.setAttribute("aria-label", tooltip);
  if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
}

function processNode(node: Node): void {
  if (!(node instanceof HTMLElement)) return;

  // Process the node itself
  if (node.matches("button,[role='button']")) ensureTooltip(node as TooltipTarget);

  // Process descendants
  const descendants = node.querySelectorAll<HTMLElement>("button,[role='button']");
  descendants.forEach((el) => ensureTooltip(el as TooltipTarget));
}

/**
 * Normalizes tooltips for buttons across the app using a MutationObserver.
 * Returns a cleanup function to call on plugin unload.
 */
export function initButtonTooltipDefaults(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.body;
  if (!root) return () => {};

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
