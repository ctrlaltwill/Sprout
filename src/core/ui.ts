/**
 * @file src/core/ui.ts
 * @summary Lightweight DOM helper utilities used across Sprout views. Provides shorthand
 * functions for creating elements, icon buttons, and toggle buttons without pulling in
 * a full UI framework.
 *
 * @exports
 *   - el — create an HTMLElement with optional class and text content
 *   - iconButton — create a styled button with a Lucide icon and label
 *   - smallToggleButton — create a compact +/− toggle button
 */

import { setIcon } from "obsidian";

export type CssPropValue = string | number | null | undefined;

function applyCssProp(el: HTMLElement, prop: string, value: CssPropValue): void {
  if (value === null || value === undefined) {
    el.style.removeProperty(prop);
    return;
  }
  el.style.setProperty(prop, String(value));
}

export function setCssProps(
  el: HTMLElement,
  prop: string | Record<string, CssPropValue>,
  value?: CssPropValue,
): void {
  if (typeof prop === "string") {
    applyCssProp(el, prop, value);
    return;
  }
  for (const [key, val] of Object.entries(prop)) {
    applyCssProp(el, key, val);
  }
}

export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function iconButton(
  iconName: string,
  labelText: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "sprout-btn";
  b.type = "button";
  b.title = title || "";

  const wrap = el("span");
  wrap.classList.add("sprout-inline-flex", "sprout-items-center", "sprout-gap-8");

  const ic = el("span");
  ic.classList.add("sprout-inline-flex", "sprout-items-center");
  setIcon(ic, iconName);
  wrap.appendChild(ic);

  if (labelText) wrap.appendChild(el("span", undefined, labelText));
  b.appendChild(wrap);
  b.addEventListener("click", onClick);
  return b;
}

export function smallToggleButton(isOpen: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "sprout-toggle";
  b.type = "button";
  b.title = isOpen ? "Collapse" : "Expand";
  b.textContent = isOpen ? "-" : "+";
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

export function createFragmentFromHTML(html: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const safeHtml = String(html ?? "");
  if (!safeHtml) return frag;

  const parser = new DOMParser();
  const doc = parser.parseFromString(safeHtml, "text/html");
  const nodes = Array.from(doc.body.childNodes);
  for (const node of nodes) frag.appendChild(node);
  return frag;
}

export function replaceChildrenWithHTML(el: HTMLElement, html: string): void {
  const frag = createFragmentFromHTML(html);
  el.replaceChildren(frag);
}
