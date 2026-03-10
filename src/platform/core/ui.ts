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
import { finishRenderMath, renderMath, setIcon } from "obsidian";
import { hydrateCircleFlagsInElement, renderFlagPreviewHtml, replaceCircleFlagTokens, escapeFlagHtml } from "../../platform/flags/flag-tokens";

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
    b.setAttribute("aria-label", title);
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
  b.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
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
  hydrateCircleFlagsInElement(el);
}

const LATEX_INLINE_PARENS_RE = /\\\((.+?)\\\)/g;
const LATEX_DISPLAY_PARENS_RE = /\\\[([\s\S]+?)\\\]/g;
const LATEX_DISPLAY_DOLLAR_RE = /\$\$([\s\S]+?)\$\$/g;
const LATEX_INLINE_DOLLAR_RE = /(?<!\$)\$(?!\$)([^\s$](?:[^$]*[^\s$])?)\$(?!\$)/g;

function hasLatexMarkers(text: string): boolean {
  return /\\\(|\\\[|\$\$|\$/.test(text);
}

function renderLatexInElement(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (!(current instanceof Text)) continue;
    const parent = current.parentElement;
    if (!parent) continue;
    if (parent.closest(".MathJax, mjx-container, .math")) continue;
    const value = current.nodeValue ?? "";
    if (!value || !hasLatexMarkers(value)) continue;
    nodes.push(current);
  }

  let didRenderMath = false;

  for (const node of nodes) {
    const sourceText = node.nodeValue ?? "";
    if (!sourceText) continue;

    type Match = { start: number; end: number; source: string; display: boolean };
    const matches: Match[] = [];

    const collectMatches = (re: RegExp, display: boolean | ((start: number, end: number) => boolean)) => {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(sourceText)) !== null) {
        const full = match[0] ?? "";
        const src = match[1] ?? "";
        if (!full || !src.trim()) continue;
        const start = match.index;
        const end = match.index + full.length;
        const isDisplay = typeof display === "function" ? display(start, end) : display;
        matches.push({
          start,
          end,
          source: src,
          display: isDisplay,
        });
        if (re.lastIndex === match.index) re.lastIndex += 1;
      }
    };

    // Obsidian-style $$...$$ should always render as display math.
    collectMatches(LATEX_DISPLAY_DOLLAR_RE, true);
    collectMatches(LATEX_DISPLAY_PARENS_RE, true);
    collectMatches(LATEX_INLINE_PARENS_RE, false);
    collectMatches(LATEX_INLINE_DOLLAR_RE, false);

    if (!matches.length) continue;

    matches.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return (b.end - b.start) - (a.end - a.start);
    });

    const nonOverlapping: Match[] = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.start < cursor) continue;
      nonOverlapping.push(m);
      cursor = m.end;
    }
    if (!nonOverlapping.length) continue;

    const frag = document.createDocumentFragment();
    let pos = 0;

    for (const m of nonOverlapping) {
      if (m.start > pos) {
        frag.appendChild(document.createTextNode(sourceText.slice(pos, m.start)));
      }

      try {
        const mathEl = renderMath(m.source.trim(), m.display);
        frag.appendChild(mathEl);
        didRenderMath = true;
      } catch {
        // Preserve the original segment if rendering fails.
        frag.appendChild(document.createTextNode(sourceText.slice(m.start, m.end)));
      }

      pos = m.end;
    }

    if (pos < sourceText.length) {
      frag.appendChild(document.createTextNode(sourceText.slice(pos)));
    }

    node.replaceWith(frag);
  }

  if (didRenderMath) {
    void finishRenderMath();
  }
}

export function renderFlagAndLatexPreviewInElement(el: HTMLElement, input: string): void {
  replaceChildrenWithHTML(el, renderFlagPreviewHtml(String(input ?? "")));
  renderLatexInElement(el);
}

export function renderLatexMathInElement(el: HTMLElement): void {
  renderLatexInElement(el);
}

/**
 * Enhanced overlay renderer: renders inline markdown formatting (bold, italic,
 * strikethrough, highlight), markdown lists (ul/ol), wiki links, circle-flag
 * tokens, and LaTeX — giving a live-preview feel when a field is blurred.
 */
export function renderMarkdownPreviewInElement(el: HTMLElement, input: string): void {
  replaceChildrenWithHTML(el, markdownPreviewHtml(String(input ?? "")));
  renderLatexInElement(el);
}

/** Convert raw markdown text into preview HTML with formatting + lists. */
function markdownPreviewHtml(source: string): string {
  if (!source) return "";

  // ── Protect LaTeX blocks from markdown formatting ──
  const mathPlaceholders: string[] = [];
  const MATH_PH = "@@SPROUTMATH";
  const mathBlockRe = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)[^\s$](?:[^$]*[^\s$])?\$(?!\$)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;

  let work = source.replace(mathBlockRe, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `${MATH_PH}${idx}@@`;
  });

  // ── HTML-escape (preserving placeholders) ──
  work = escapeFlagHtml(work);

  // ── Wiki links [[Page]] or [[Page|Display]] ──
  work = work.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, display?: string) => {
    const linkText = display || target;
    return `<a class="internal-link" data-href="${target}">${linkText}</a>`;
  });

  // ── Inline formatting (order: bold before italic) ──
  work = work.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  work = work.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  work = work.replace(/(?<![\w\\])_(.+?)_(?![\w])/g, "<em>$1</em>");
  work = work.replace(/~~(.+?)~~/g, "<s>$1</s>");
  work = work.replace(/==(.+?)==/g, "<mark>$1</mark>");

  // ── Inline code ──
  work = work.replace(/`([^`]+)`/g, '<code>$1</code>');

  // ── Circle-flag tokens ──
  work = replaceCircleFlagTokens(work);

  // ── Markdown lists ──
  work = convertMarkdownLists(work);

  // ── Restore LaTeX placeholders ──
  if (mathPlaceholders.length) {
    work = work.replace(/@@SPROUTMATH(\d+)@@/g, (_m, idx) => mathPlaceholders[Number(idx)] ?? _m);
  }

  return work;
}

/**
 * Convert markdown list lines into proper nested <ul>/<ol> HTML.
 * Non-list lines get \n→<br>. Handles unordered (-, *, +) and ordered (1., 2)) lists
 * with indentation-based nesting (tab or 2-space indent per level).
 */
function convertMarkdownLists(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  // Stack tracks open list types at each nesting depth
  const stack: Array<"ul" | "ol"> = [];

  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      out.push(`</${stack.pop()}>`);
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const ulMatch = line.match(/^([\t ]*)[-+*]\s+(.*)/);
    const olMatch = !ulMatch ? line.match(/^([\t ]*)\d+[.)]\s+(.*)/) : null;

    if (ulMatch || olMatch) {
      const indent = (ulMatch || olMatch)![1];
      const content = (ulMatch || olMatch)![2];
      // Calculate depth: each tab = 1 level, each 2 spaces = 1 level
      const depth = indent.split("\t").length - 1 + Math.floor(indent.replace(/\t/g, "").length / 2);
      const targetDepth = depth + 1; // 1-based (depth 0 = top level list)
      const tag: "ul" | "ol" = ulMatch ? "ul" : "ol";

      if (targetDepth > stack.length) {
        // Open new list(s) to reach target depth
        while (stack.length < targetDepth) {
          out.push(`<${tag}>`);
          stack.push(tag);
        }
      } else {
        // Close lists down to target depth
        closeTo(targetDepth);
        // If the list type changed at this depth, swap it
        if (stack.length > 0 && stack[stack.length - 1] !== tag) {
          out.push(`</${stack.pop()}>`);
          out.push(`<${tag}>`);
          stack.push(tag);
        }
      }
      out.push(`<li>${content}</li>`);
    } else {
      closeTo(0);
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = Math.max(1, Math.min(6, headingMatch[1].length));
        out.push(`<h${level}>${headingMatch[2]}</h${level}>`);
      } else if (line === "") {
        out.push("<br>");
      } else {
        out.push(line);
        if (idx < lines.length - 1) out.push("<br>");
      }
    }
  }
  closeTo(0);

  return out.join("");
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
