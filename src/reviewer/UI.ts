// src/reviewer/uiBits.ts
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
  b.addEventListener("click", onClick);

  const left = el("span", "sprout-btn-left");
  left.textContent = label;
  b.appendChild(left);

  return b;
}
