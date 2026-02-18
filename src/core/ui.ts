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

import createDOMPurify from "dompurify";
import { setIcon } from "obsidian";

export type CssPropValue = string | number | null | undefined;

const hasDom = typeof window !== "undefined" && typeof document !== "undefined";
let domPurify: ReturnType<typeof createDOMPurify> | null = hasDom ? createDOMPurify(window) : null;

function getDomPurify() {
  if (!domPurify && hasDom) domPurify = createDOMPurify(window);
  return domPurify;
}

type CssDecls = Record<string, string>;

const DYNAMIC_PROPS = new Set<string>([
  "--sprout-ana-x",
  "--sprout-ana-y",
  "--sprout-deck-row-translate",
  "--sprout-oq-translate",
  "--sprout-popover-left",
  "--sprout-popover-top",
]);

let sharedStyleSheet: CSSStyleSheet | null = null;
let dynamicStyleSheet: CSSStyleSheet | null = null;

function supportsConstructedSheets(): boolean {
  return hasDom
    && typeof CSSStyleSheet !== "undefined"
    && Array.isArray((document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets);
}

const sharedRuleByKey = new Map<string, { className: string; rule: string }>();
let sharedCssDirty = false;

type DynEntry = { className: string; el: HTMLElement; decls: Map<string, string> };
const dynByClass = new Map<string, DynEntry>();
const dynClassByEl = new WeakMap<HTMLElement, string>();
let dynCounter = 1;
let dynCssDirty = false;
let flushScheduled = false;

type AppliedProp = { kind: "shared" | "dynamic"; className: string };
const appliedByEl = new WeakMap<HTMLElement, Map<string, AppliedProp>>();

function ensureStyleEls(): void {
  if (!supportsConstructedSheets()) return;
  const doc = document as Document & { adoptedStyleSheets: CSSStyleSheet[] };

  if (!sharedStyleSheet) sharedStyleSheet = new CSSStyleSheet();
  if (!dynamicStyleSheet) dynamicStyleSheet = new CSSStyleSheet();

  if (!doc.adoptedStyleSheets.includes(sharedStyleSheet)) {
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sharedStyleSheet];
  }
  if (!doc.adoptedStyleSheets.includes(dynamicStyleSheet)) {
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, dynamicStyleSheet];
  }
}

function hashString(input: string): string {
  // Small, stable hash (djb2) → base36
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function normalizeDecls(decls: Record<string, CssPropValue>): CssDecls {
  const out: CssDecls = {};
  for (const [k, v] of Object.entries(decls)) {
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  return out;
}

function buildRule(className: string, decls: CssDecls): string {
  const keys = Object.keys(decls).sort();
  const body = keys.map((k) => `${k}:${decls[k]};`).join("");
  return `.${className}{${body}}`;
}

export function cssClassForProps(decls: Record<string, CssPropValue>): string {
  if (!hasDom) return "";
  if (!supportsConstructedSheets()) return "";
  ensureStyleEls();

  const norm = normalizeDecls(decls);
  const keys = Object.keys(norm).sort();
  if (!keys.length) return "";

  const key = keys.map((k) => `${k}:${norm[k]}`).join("|");
  const existing = sharedRuleByKey.get(key);
  if (existing) return existing.className;

  const className = `sprout-css-${hashString(key)}`;
  const rule = buildRule(className, norm);
  sharedRuleByKey.set(key, { className, rule });
  sharedCssDirty = true;
  scheduleFlush();
  return className;
}

function scheduleFlush(): void {
  if (!hasDom) return;
  if (flushScheduled) return;
  flushScheduled = true;
  window.requestAnimationFrame(() => {
    flushScheduled = false;
    flushCss();
  });
}

function flushCss(): void {
  ensureStyleEls();

  if (sharedCssDirty && sharedStyleSheet) {
    sharedCssDirty = false;
    sharedStyleSheet.replaceSync(Array.from(sharedRuleByKey.values()).map((x) => x.rule).join("\n"));
  }

  if (dynCssDirty && dynamicStyleSheet) {
    dynCssDirty = false;
    // prune disconnected refs while building
    const rules: string[] = [];
    for (const [cls, entry] of dynByClass) {
      const el = entry.el;
      if (!el || !el.isConnected) {
        dynByClass.delete(cls);
        continue;
      }
      const obj: CssDecls = {};
      for (const [k, v] of entry.decls) obj[k] = v;
      rules.push(buildRule(entry.className, obj));
    }
    dynamicStyleSheet.replaceSync(rules.join("\n"));
  }
}

function getAppliedMap(el: HTMLElement): Map<string, AppliedProp> {
  let m = appliedByEl.get(el);
  if (!m) {
    m = new Map();
    appliedByEl.set(el, m);
  }
  return m;
}

function ensureDynEntry(el: HTMLElement): DynEntry {
  let cls = dynClassByEl.get(el);
  if (!cls) {
    cls = `sprout-dyn-${dynCounter++}`;
    dynClassByEl.set(el, cls);
    el.classList.add(cls);
  }
  let entry = dynByClass.get(cls);
  if (!entry) {
    entry = { className: cls, el, decls: new Map() };
    dynByClass.set(cls, entry);
  }
  return entry;
}

function applyCssProp(el: HTMLElement, prop: string, value: CssPropValue): void {
  if (!hasDom) return;
  if (!supportsConstructedSheets()) {
    const nextVal = value === null || value === undefined ? null : String(value);
    if (nextVal === null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, nextVal);
    return;
  }
  ensureStyleEls();

  const applied = getAppliedMap(el);
  const prev = applied.get(prop);

  const nextVal = value === null || value === undefined ? null : String(value);

  if (DYNAMIC_PROPS.has(prop)) {
    // One stable class per element, updated as values change (prevents class explosion).
    const entry = ensureDynEntry(el);
    if (nextVal === null) entry.decls.delete(prop);
    else entry.decls.set(prop, nextVal);

    if (!prev || prev.kind !== "dynamic") applied.set(prop, { kind: "dynamic", className: entry.className });
    dynCssDirty = true;
    scheduleFlush();
    return;
  }

  // Shared class per prop/value pair.
  if (prev && prev.kind === "shared") el.classList.remove(prev.className);
  if (nextVal === null) {
    applied.delete(prop);
    return;
  }
  const cls = cssClassForProps({ [prop]: nextVal });
  if (cls) el.classList.add(cls);
  applied.set(prop, { kind: "shared", className: cls });
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
  if (title) {
    b.setAttribute("data-tooltip", title);
    b.setAttribute("data-tooltip-position", "top");
  }

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
  b.setAttribute("data-tooltip", isOpen ? "Collapse" : "Expand");
  b.setAttribute("data-tooltip-position", "top");
  b.textContent = isOpen ? "-" : "+";
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

export function createFragmentFromHTML(html: string): DocumentFragment {
  const safeHtml = String(html ?? "");
  if (!safeHtml) return hasDom ? document.createDocumentFragment() : ({} as DocumentFragment);

  if (!hasDom) return {} as DocumentFragment;

  const sanitizer = getDomPurify();
  if (!sanitizer) return document.createDocumentFragment();

  const sanitized = sanitizer.sanitize(safeHtml, { RETURN_DOM_FRAGMENT: true });
  if (sanitized instanceof DocumentFragment) return sanitized;

  const frag = document.createDocumentFragment();
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(sanitized ?? ""), "text/html");
  const nodes = Array.from(doc.body.childNodes);
  for (const node of nodes) frag.appendChild(node);
  return frag;
}

export function replaceChildrenWithHTML(el: HTMLElement, html: string): void {
  const frag = createFragmentFromHTML(html);
  el.replaceChildren(frag);
}

export function queryFirst<T extends Element = Element>(root: ParentNode, selector: string): T | null {
  const matches = root.querySelectorAll<T>(selector);
  return matches.length ? matches[0] : null;
}

// ── Popover positioning ──────────────────────────────────────────

export interface PlacePopoverOpts {
  /** The button / element that triggered the popover. */
  trigger: HTMLElement;
  /** The inner panel whose measured size determines overflow. */
  panel: HTMLElement;
  /** The root overlay element on which CSS custom-props are set. */
  popoverEl: HTMLElement;
  /** Explicit popover width (px). Falls back to panel/trigger width. */
  width?: number;
  /** Open above the trigger instead of below. */
  dropUp?: boolean;
  /** Gap between trigger and popover edge (default 3). */
  gap?: number;
  /** Whether to set --sprout-popover-width (default true). */
  setWidth?: boolean;
  /** Horizontal alignment relative to the trigger (default 'left'). */
  align?: 'left' | 'right';
}

/**
 * Position a body-portalled popover relative to its trigger.
 *
 * Rules:
 *  1. Place **below** the trigger by `gap` px (or **above** when `dropUp`).
 *  2. Align horizontally using `align` with no fallback/clamping.
 */
export function placePopover(opts: PlacePopoverOpts): void {
  const {
    trigger,
    panel,
    popoverEl,
    dropUp = false,
    gap = 3,
    setWidth = true,
    align = 'left',
  } = opts;

  const r = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const popW = opts.width ?? Math.max(panelRect.width || 0, r.width);
  const popH = Math.max(1, panelRect.height || 1);

  const zoomRaw = Number.parseFloat(window.getComputedStyle(popoverEl).zoom || "1");
  const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;

  const leftRaw = align === 'right' ? (r.right - popW) : r.left;
  const topRaw = dropUp ? (r.top - popH - gap) : (r.bottom + gap);

  const left = leftRaw / zoom;
  const top = topRaw / zoom;
  const width = popW / zoom;

  setCssProps(popoverEl, "--sprout-popover-left", `${left}px`);
  setCssProps(popoverEl, "--sprout-popover-top", `${top}px`);
  if (setWidth) {
    setCssProps(popoverEl, "--sprout-popover-width", `${width}px`);
  }
}
