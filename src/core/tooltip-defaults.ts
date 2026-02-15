/**
 * @file src/core/tooltip-defaults.ts
 * @summary Ensures interactive buttons use Sprout's `data-tooltip` system.
 *
 * Goals:
 * - Avoid native browser tooltips (`title`).
 * - Ensure every <button> (and role="button") has a clear tooltip, even when icon-only.
 * - Preserve existing explicit `data-tooltip` values.
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

function ensureTooltip(el: TooltipTarget): void {
  // Always remove native tooltips.
  if (el.hasAttribute("title")) el.removeAttribute("title");

  if (el.hasAttribute("data-tooltip")) {
    if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
    return;
  }

  const aria = normalizeTooltipText(el.getAttribute("aria-label") ?? "");
  const title = normalizeTooltipText(el.getAttribute("title") ?? "");
  const text = normalizeTooltipText(el.textContent ?? "");

  const tooltip = aria || title || text;
  if (!tooltip) return;

  el.setAttribute("data-tooltip", tooltip);
  if (!el.hasAttribute("data-tooltip-position")) el.setAttribute("data-tooltip-position", "top");
}

function processNode(node: Node): void {
  if (!(node instanceof HTMLElement)) return;

  // Process the node itself
  if (node.matches("button,[role='button']")) ensureTooltip(node as TooltipTarget);

  // Process descendants
  const descendants = node.querySelectorAll<HTMLElement>("button,[role='button']");
  for (const el of descendants) ensureTooltip(el as TooltipTarget);
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
    for (const m of mutations) {
      for (const n of m.addedNodes) processNode(n as Node);
      // If attributes change (e.g., textContent updated later), callers should
      // set `data-tooltip` explicitly; we intentionally don't observe characterData.
    }
  });

  obs.observe(root, { childList: true, subtree: true });
  return () => obs.disconnect();
}
