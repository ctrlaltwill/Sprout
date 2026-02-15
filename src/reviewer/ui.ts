/**
 * @file src/reviewer/ui.ts
 * @summary Small UI utility functions for the reviewer, providing keyboard-shortcut badge elements and plain button construction.
 *
 * @exports
 *   - keySymbol — Converts a key label to its symbol representation (e.g. "Enter" → "⏎")
 *   - keybox — Creates a styled keyboard-shortcut badge element
 *   - appendKeyboxRight — Appends a right-aligned keyboard badge to a button element
 *   - makePlainButton — Creates a plain button element with a label and click handler
 */

import { el } from "../core/ui";

export function keySymbol(label: string): string {
  if (label.toLowerCase() === "enter") return "⏎";
  return label;
}

export function keybox(label: string, extraClass = ""): HTMLElement {
  const outer = el("span", `sprout-keywrap${extraClass ? " " + extraClass : ""}`);
  const k = el("span", "sprout-keybox");
  k.textContent = keySymbol(label);
  outer.appendChild(k);
  return outer;
}

export function appendKeyboxRight(btn: HTMLElement, label: string) {
  const wrap = el("span", "sprout-btn-right");
  wrap.appendChild(keybox(label));
  btn.appendChild(wrap);
}

export function makePlainButton(
  label: string,
  onClick: () => void,
  className = "sprout-btn",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.setAttribute("data-tooltip", label);
  b.setAttribute("data-tooltip-position", "top");
  b.addEventListener("click", onClick);

  const left = el("span", "sprout-btn-left");
  left.textContent = label;
  b.appendChild(left);

  return b;
}
