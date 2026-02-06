import { setIcon } from "obsidian";

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
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";

  const ic = el("span");
  ic.style.display = "inline-flex";
  ic.style.alignItems = "center";
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
