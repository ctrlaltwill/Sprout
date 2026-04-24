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
const hasDom = typeof window !== "undefined" && typeof document !== "undefined";
let domPurify = hasDom ? createDOMPurify(window) : null;
function getDomPurify() {
    if (!domPurify && hasDom)
        domPurify = createDOMPurify(window);
    return domPurify;
}
const DYNAMIC_PROPS = new Set([
    "--learnkit-ana-x",
    "--learnkit-ana-y",
    "--learnkit-deck-row-translate",
    "--learnkit-oq-translate",
    "--learnkit-popover-left",
    "--learnkit-popover-top",
]);
let sharedStyleSheet = null;
let dynamicStyleSheet = null;
function supportsConstructedSheets() {
    return hasDom
        && typeof CSSStyleSheet !== "undefined"
        && Array.isArray(document.adoptedStyleSheets);
}
const sharedRuleByKey = new Map();
let sharedCssDirty = false;
const dynByClass = new Map();
const dynClassByEl = new WeakMap();
let dynCounter = 1;
let dynCssDirty = false;
let flushScheduled = false;
const appliedByEl = new WeakMap();
function ensureStyleEls() {
    if (!supportsConstructedSheets())
        return;
    const doc = document;
    if (!sharedStyleSheet)
        sharedStyleSheet = new CSSStyleSheet();
    if (!dynamicStyleSheet)
        dynamicStyleSheet = new CSSStyleSheet();
    if (!doc.adoptedStyleSheets.includes(sharedStyleSheet)) {
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sharedStyleSheet];
    }
    if (!doc.adoptedStyleSheets.includes(dynamicStyleSheet)) {
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, dynamicStyleSheet];
    }
}
function hashString(input) {
    // Small, stable hash (djb2) → base36
    let h = 5381;
    for (let i = 0; i < input.length; i++)
        h = ((h << 5) + h) ^ input.charCodeAt(i);
    return (h >>> 0).toString(36);
}
function normalizeDecls(decls) {
    const out = {};
    for (const [k, v] of Object.entries(decls)) {
        if (v === null || v === undefined)
            continue;
        out[k] = String(v);
    }
    return out;
}
function buildRule(className, decls) {
    const keys = Object.keys(decls).sort();
    const body = keys.map((k) => `${k}:${decls[k]};`).join("");
    return `.${className}{${body}}`;
}
export function cssClassForProps(decls) {
    if (!hasDom)
        return "";
    if (!supportsConstructedSheets())
        return "";
    ensureStyleEls();
    const norm = normalizeDecls(decls);
    const keys = Object.keys(norm).sort();
    if (!keys.length)
        return "";
    const key = keys.map((k) => `${k}:${norm[k]}`).join("|");
    const existing = sharedRuleByKey.get(key);
    if (existing)
        return existing.className;
    const className = `learnkit-css-${hashString(key)}`;
    const rule = buildRule(className, norm);
    sharedRuleByKey.set(key, { className, rule });
    sharedCssDirty = true;
    scheduleFlush();
    return className;
}
function scheduleFlush() {
    if (!hasDom)
        return;
    if (flushScheduled)
        return;
    flushScheduled = true;
    window.requestAnimationFrame(() => {
        flushScheduled = false;
        flushCss();
    });
}
function flushCss() {
    ensureStyleEls();
    if (sharedCssDirty && sharedStyleSheet) {
        sharedCssDirty = false;
        sharedStyleSheet.replaceSync(Array.from(sharedRuleByKey.values()).map((x) => x.rule).join("\n"));
    }
    if (dynCssDirty && dynamicStyleSheet) {
        dynCssDirty = false;
        // prune disconnected refs while building
        const rules = [];
        for (const [cls, entry] of dynByClass) {
            const el = entry.el;
            if (!el || !el.isConnected) {
                dynByClass.delete(cls);
                continue;
            }
            const obj = {};
            for (const [k, v] of entry.decls)
                obj[k] = v;
            rules.push(buildRule(entry.className, obj));
        }
        dynamicStyleSheet.replaceSync(rules.join("\n"));
    }
}
function getAppliedMap(el) {
    let m = appliedByEl.get(el);
    if (!m) {
        m = new Map();
        appliedByEl.set(el, m);
    }
    return m;
}
function ensureDynEntry(el) {
    let cls = dynClassByEl.get(el);
    if (!cls) {
        cls = `learnkit-dyn-${dynCounter++}`;
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
function applyCssProp(el, prop, value) {
    if (!hasDom)
        return;
    if (!supportsConstructedSheets()) {
        const nextVal = value === null || value === undefined ? null : String(value);
        if (nextVal === null)
            el.style.removeProperty(prop);
        else
            el.style.setProperty(prop, nextVal);
        return;
    }
    ensureStyleEls();
    const applied = getAppliedMap(el);
    const prev = applied.get(prop);
    const nextVal = value === null || value === undefined ? null : String(value);
    if (DYNAMIC_PROPS.has(prop)) {
        // One stable class per element, updated as values change (prevents class explosion).
        const entry = ensureDynEntry(el);
        if (nextVal === null)
            entry.decls.delete(prop);
        else
            entry.decls.set(prop, nextVal);
        if (!prev || prev.kind !== "dynamic")
            applied.set(prop, { kind: "dynamic", className: entry.className });
        dynCssDirty = true;
        scheduleFlush();
        return;
    }
    // Shared class per prop/value pair.
    if (prev && prev.kind === "shared")
        el.classList.remove(prev.className);
    if (nextVal === null) {
        applied.delete(prop);
        return;
    }
    const cls = cssClassForProps({ [prop]: nextVal });
    if (cls)
        el.classList.add(cls);
    applied.set(prop, { kind: "shared", className: cls });
}
export function setCssProps(el, prop, value) {
    if (typeof prop === "string") {
        applyCssProp(el, prop, value);
        return;
    }
    for (const [key, val] of Object.entries(prop)) {
        applyCssProp(el, key, val);
    }
}
export function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)
        e.className = cls;
    if (text !== undefined)
        e.textContent = text;
    return e;
}
export function iconButton(iconName, labelText, title, onClick) {
    const b = document.createElement("button");
    b.className = "learnkit-btn";
    b.type = "button";
    if (title) {
        b.setAttribute("aria-label", title);
        b.setAttribute("data-tooltip-position", "top");
    }
    const wrap = el("span");
    wrap.classList.add("learnkit-inline-flex", "learnkit-inline-flex", "learnkit-items-center", "learnkit-items-center", "learnkit-gap-8", "learnkit-gap-8");
    const ic = el("span");
    ic.classList.add("learnkit-inline-flex", "learnkit-inline-flex", "learnkit-items-center", "learnkit-items-center");
    setIcon(ic, iconName);
    wrap.appendChild(ic);
    if (labelText)
        wrap.appendChild(el("span", undefined, labelText));
    b.appendChild(wrap);
    b.addEventListener("click", onClick);
    return b;
}
export function smallToggleButton(isOpen, onClick) {
    const b = document.createElement("button");
    b.className = "learnkit-toggle";
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
export function createFragmentFromHTML(html) {
    const safeHtml = String(html !== null && html !== void 0 ? html : "");
    if (!safeHtml)
        return hasDom ? document.createDocumentFragment() : {};
    if (!hasDom)
        return {};
    const sanitizer = getDomPurify();
    if (!sanitizer)
        return document.createDocumentFragment();
    const sanitized = sanitizer.sanitize(safeHtml, { RETURN_DOM_FRAGMENT: true });
    if (sanitized instanceof DocumentFragment)
        return sanitized;
    const frag = document.createDocumentFragment();
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(sanitized !== null && sanitized !== void 0 ? sanitized : ""), "text/html");
    const nodes = Array.from(doc.body.childNodes);
    for (const node of nodes)
        frag.appendChild(node);
    return frag;
}
export function replaceChildrenWithHTML(el, html) {
    const frag = createFragmentFromHTML(html);
    el.replaceChildren(frag);
    hydrateCircleFlagsInElement(el);
}
const LATEX_INLINE_PARENS_RE = /\\\((.+?)\\\)/g;
const LATEX_DISPLAY_PARENS_RE = /\\\[([\s\S]+?)\\\]/g;
const LATEX_DISPLAY_DOLLAR_RE = /\$\$([\s\S]+?)\$\$/g;
const LATEX_INLINE_DOLLAR_RE = /(?<!\$)\$(?!\$)([^\s$](?:[^$]*[^\s$])?)\$(?!\$)/g;
function hasLatexMarkers(text) {
    return /\\\(|\\\[|\$\$|\$/.test(text);
}
function renderLatexInElement(container) {
    var _a, _b;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
        if (!(current instanceof Text))
            continue;
        const parent = current.parentElement;
        if (!parent)
            continue;
        if (parent.closest(".MathJax, mjx-container, .math"))
            continue;
        const value = (_a = current.nodeValue) !== null && _a !== void 0 ? _a : "";
        if (!value || !hasLatexMarkers(value))
            continue;
        nodes.push(current);
    }
    let didRenderMath = false;
    for (const node of nodes) {
        const sourceText = (_b = node.nodeValue) !== null && _b !== void 0 ? _b : "";
        if (!sourceText)
            continue;
        const matches = [];
        const collectMatches = (re, display) => {
            var _a, _b;
            re.lastIndex = 0;
            let match;
            while ((match = re.exec(sourceText)) !== null) {
                const full = (_a = match[0]) !== null && _a !== void 0 ? _a : "";
                const src = (_b = match[1]) !== null && _b !== void 0 ? _b : "";
                if (!full || !src.trim())
                    continue;
                const start = match.index;
                const end = match.index + full.length;
                const isDisplay = typeof display === "function" ? display(start, end) : display;
                matches.push({
                    start,
                    end,
                    source: src,
                    display: isDisplay,
                });
                if (re.lastIndex === match.index)
                    re.lastIndex += 1;
            }
        };
        // Obsidian-style $$...$$ should always render as display math.
        collectMatches(LATEX_DISPLAY_DOLLAR_RE, true);
        collectMatches(LATEX_DISPLAY_PARENS_RE, true);
        collectMatches(LATEX_INLINE_PARENS_RE, false);
        collectMatches(LATEX_INLINE_DOLLAR_RE, false);
        if (!matches.length)
            continue;
        matches.sort((a, b) => {
            if (a.start !== b.start)
                return a.start - b.start;
            return (b.end - b.start) - (a.end - a.start);
        });
        const nonOverlapping = [];
        let cursor = 0;
        for (const m of matches) {
            if (m.start < cursor)
                continue;
            nonOverlapping.push(m);
            cursor = m.end;
        }
        if (!nonOverlapping.length)
            continue;
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
            }
            catch (_c) {
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
export function renderFlagAndLatexPreviewInElement(el, input) {
    replaceChildrenWithHTML(el, renderFlagPreviewHtml(String(input !== null && input !== void 0 ? input : "")));
    renderLatexInElement(el);
}
export function renderLatexMathInElement(el) {
    renderLatexInElement(el);
}
/**
 * Enhanced overlay renderer: renders inline markdown formatting (bold, italic,
 * strikethrough, highlight), markdown lists (ul/ol), wiki links, circle-flag
 * tokens, and LaTeX — giving a live-preview feel when a field is blurred.
 */
export function renderMarkdownPreviewInElement(el, input) {
    replaceChildrenWithHTML(el, markdownPreviewHtml(String(input !== null && input !== void 0 ? input : "")));
    renderLatexInElement(el);
}
/** Convert raw markdown text into preview HTML with formatting + lists. */
function markdownPreviewHtml(source) {
    if (!source)
        return "";
    // ── Protect LaTeX blocks from markdown formatting ──
    const mathPlaceholders = [];
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
    work = work.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, display) => {
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
    // ── Markdown tables ──
    work = convertMarkdownTables(work);
    // ── Markdown lists ──
    work = convertMarkdownLists(work);
    // ── Restore LaTeX placeholders ──
    if (mathPlaceholders.length) {
        work = work.replace(/@@SPROUTMATH(\d+)@@/g, (_m, idx) => { var _a; return (_a = mathPlaceholders[Number(idx)]) !== null && _a !== void 0 ? _a : _m; });
    }
    return work;
}
/**
 * Convert markdown list lines into proper nested <ul>/<ol> HTML.
 * Non-list lines get \n→<br>. Handles unordered (-, *, +) and ordered (1., 2)) lists
 * with indentation-based nesting (tab or 2-space indent per level).
 */
function convertMarkdownLists(text) {
    const lines = text.split("\n");
    const out = [];
    const stack = [];
    const closeItemAt = (depth) => {
        const state = stack[depth];
        if (!(state === null || state === void 0 ? void 0 : state.hasOpenItem))
            return;
        out.push("</li>");
        state.hasOpenItem = false;
    };
    const closeTo = (depth) => {
        while (stack.length > depth) {
            closeItemAt(stack.length - 1);
            out.push(`</${stack.pop().tag}>`);
        }
    };
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const ulMatch = line.match(/^([\t ]*)[-+*]\s+(.*)/);
        const olMatch = !ulMatch ? line.match(/^([\t ]*)\d+[.)]\s+(.*)/) : null;
        if (ulMatch || olMatch) {
            const indent = (ulMatch || olMatch)[1];
            const content = (ulMatch || olMatch)[2];
            // Calculate depth: each tab = 1 level, each 2 spaces = 1 level
            const depth = indent.split("\t").length - 1 + Math.floor(indent.replace(/\t/g, "").length / 2);
            const targetDepth = depth + 1; // 1-based (depth 0 = top level list)
            const tag = ulMatch ? "ul" : "ol";
            if (targetDepth > stack.length) {
                while (stack.length < targetDepth) {
                    out.push(`<${tag}>`);
                    stack.push({ tag, hasOpenItem: false });
                }
            }
            else {
                closeTo(targetDepth);
                closeItemAt(targetDepth - 1);
                if (stack.length > 0 && stack[stack.length - 1].tag !== tag) {
                    out.push(`</${stack.pop().tag}>`);
                    out.push(`<${tag}>`);
                    stack.push({ tag, hasOpenItem: false });
                }
            }
            out.push(`<li>${content}`);
            stack[targetDepth - 1].hasOpenItem = true;
        }
        else {
            closeTo(0);
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = Math.max(1, Math.min(6, headingMatch[1].length));
                out.push(`<h${level}>${headingMatch[2]}</h${level}>`);
            }
            else if (line === "") {
                out.push("<br>");
            }
            else {
                out.push(line);
                if (idx < lines.length - 1)
                    out.push("<br>");
            }
        }
    }
    closeTo(0);
    return out.join("");
}
function convertMarkdownTables(text) {
    const lines = text.split("\n");
    const out = [];
    const splitRow = (line) => {
        const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
        return trimmed.split("|").map((cell) => cell.trim());
    };
    const isSeparator = (line) => {
        const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
        if (!raw)
            return false;
        const cols = raw.split("|").map((part) => part.trim());
        if (!cols.length)
            return false;
        return cols.every((col) => /^:?-{3,}:?$/.test(col));
    };
    let i = 0;
    while (i < lines.length) {
        const headerLine = lines[i];
        const separatorLine = i + 1 < lines.length ? lines[i + 1] : "";
        const looksLikeHeader = headerLine.includes("|");
        if (!looksLikeHeader || !isSeparator(separatorLine)) {
            out.push(headerLine);
            i += 1;
            continue;
        }
        const headers = splitRow(headerLine);
        const rows = [];
        i += 2;
        while (i < lines.length) {
            const rowLine = lines[i];
            if (!rowLine.trim() || !rowLine.includes("|"))
                break;
            rows.push(splitRow(rowLine));
            i += 1;
        }
        const th = headers.map((h) => `<th>${h}</th>`).join("");
        const bodyRows = rows
            .map((row) => {
            const cells = headers.map((_, idx) => { var _a; return `<td>${(_a = row[idx]) !== null && _a !== void 0 ? _a : ""}</td>`; }).join("");
            return `<tr>${cells}</tr>`;
        })
            .join("");
        out.push(`<table><thead><tr>${th}</tr></thead><tbody>${bodyRows}</tbody></table>`);
    }
    return out.join("\n");
}
export function queryFirst(root, selector) {
    const matches = root.querySelectorAll(selector);
    return matches.length ? matches[0] : null;
}
/**
 * Position a body-portalled popover relative to its trigger.
 *
 * Rules:
 *  1. Place **below** the trigger by `gap` px (or **above** when `dropUp`).
 *  2. Align horizontally using `align` with no fallback/clamping.
 */
export function placePopover(opts) {
    var _a;
    const { trigger, panel, popoverEl, dropUp = false, gap = 3, setWidth = true, align = 'left', } = opts;
    const r = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const popW = (_a = opts.width) !== null && _a !== void 0 ? _a : Math.max(panelRect.width || 0, r.width);
    const popH = Math.max(1, panelRect.height || 1);
    const zoomRaw = Number.parseFloat(window.getComputedStyle(popoverEl).zoom || "1");
    const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;
    const leftRaw = align === 'right' ? (r.right - popW) : r.left;
    const topRaw = dropUp ? (r.top - popH - gap) : (r.bottom + gap);
    const left = leftRaw / zoom;
    const top = topRaw / zoom;
    const width = popW / zoom;
    setCssProps(popoverEl, "--learnkit-popover-left", `${left}px`);
    setCssProps(popoverEl, "--learnkit-popover-top", `${top}px`);
    if (setWidth) {
        setCssProps(popoverEl, "--learnkit-popover-width", `${width}px`);
    }
}
