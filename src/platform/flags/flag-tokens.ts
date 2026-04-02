/**
 * @file src/platform/flags/flag-tokens.ts
 * @summary Module for flag tokens.
 *
 * @exports
 *  - CircleFlagTokenMatch
 *  - escapeFlagHtml
 *  - getCircleFlagTokenMatches
 *  - stripCircleFlagTokens
 *  - getCircleFlagUrl
 *  - getCircleFlagFallbackUrl
 */

import { requestUrl } from "obsidian";

const FLAG_TOKEN_RE = /\{\{([a-z]{2}(?:-[a-z0-9]{2,3})?)\}\}/gi;
const FLAG_CODE_RE = /^[a-z]{2}(?:-[a-z0-9]{2,3})?$/i;
const FLAG_CACHE_KEY = "sprout-circle-flag-cache-v1";
const FLAG_CACHE_MAX_BYTES = 2_500_000;

let memoryCache: Map<string, string> | null = null;
const pendingFetches = new Map<string, Promise<string | null>>();
let persistTimer: number | null = null;

export type CircleFlagTokenMatch = {
  code: string;
  index: number;
  length: number;
};

export function escapeFlagHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFlagCode(raw: string): string | null {
  const code = String(raw ?? "").trim().toLowerCase();
  if (!FLAG_CODE_RE.test(code)) return null;
  return code;
}

export function getCircleFlagTokenMatches(input: string): CircleFlagTokenMatch[] {
  const src = String(input ?? "");
  if (!src) return [];

  FLAG_TOKEN_RE.lastIndex = 0;
  const out: CircleFlagTokenMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = FLAG_TOKEN_RE.exec(src)) !== null) {
    const code = normalizeFlagCode(match[1] ?? "");
    if (!code) continue;
    out.push({
      code,
      index: match.index,
      length: match[0].length,
    });
  }
  return out;
}

export function stripCircleFlagTokens(input: string): string {
  const src = String(input ?? "");
  if (!src) return "";
  FLAG_TOKEN_RE.lastIndex = 0;
  return src.replace(FLAG_TOKEN_RE, " ");
}

export function getCircleFlagUrl(code: string): string {
  const normalized = normalizeFlagCode(code) ?? "";
  if (normalized.includes("-")) {
    return `https://hatscripts.github.io/circle-flags/flags/language/${normalized}.svg`;
  }
  return `https://hatscripts.github.io/circle-flags/flags/${normalized}.svg`;
}

export function getCircleFlagFallbackUrl(code: string): string {
  const normalized = normalizeFlagCode(code) ?? "";
  const region = normalized.includes("-") ? normalized.split("-").pop() ?? normalized : normalized;
  return `https://hatscripts.github.io/circle-flags/flags/${region}.svg`;
}

function buildFlagImgHtml(code: string): string {
  const safeCode = escapeFlagHtml(code);
  const src = escapeFlagHtml(getCircleFlagUrl(code));
  return `<img class="learnkit-inline-flag" data-learnkit-flag-code="${safeCode}" alt="${safeCode}" src="${src}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
}

export function replaceCircleFlagTokens(input: string): string {
  const src = String(input ?? "");
  if (!src) return "";
  return src.replace(FLAG_TOKEN_RE, (match, rawCode: string) => {
    const code = normalizeFlagCode(rawCode);
    if (!code) return match;
    return buildFlagImgHtml(code);
  });
}

export function processCircleFlagsInMarkdown(input: string): string {
  return replaceCircleFlagTokens(String(input ?? ""));
}

export function escapeTextWithCircleFlags(input: string): string {
  return replaceCircleFlagTokens(escapeFlagHtml(String(input ?? "")));
}

export function renderFlagPreviewHtml(input: string): string {
  return escapeTextWithCircleFlags(input).replace(/\r?\n/g, "<br>");
}

function ensureCache(): Map<string, string> {
  if (memoryCache) return memoryCache;
  memoryCache = new Map<string, string>();
  if (typeof window === "undefined") return memoryCache;

  try {
    const raw = window.localStorage.getItem(FLAG_CACHE_KEY);
    if (!raw) return memoryCache;
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed || {})) {
      const code = normalizeFlagCode(k);
      if (!code || typeof v !== "string" || !v.startsWith("data:image/svg+xml")) continue;
      memoryCache.set(code, v);
    }
  } catch {
    return memoryCache;
  }
  return memoryCache;
}

function cacheBytes(map: Map<string, string>): number {
  let total = 0;
  for (const [k, v] of map.entries()) total += k.length + v.length;
  return total;
}

function queuePersistCache() {
  if (typeof window === "undefined") return;
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const map = ensureCache();
    const asObj: Record<string, string> = {};
    for (const [k, v] of map.entries()) asObj[k] = v;
    try {
      window.localStorage.setItem(FLAG_CACHE_KEY, JSON.stringify(asObj));
    } catch {
      return;
    }
  }, 180);
}

function getCachedFlagDataUri(code: string): string | null {
  return ensureCache().get(code) ?? null;
}

function setCachedFlagDataUri(code: string, dataUri: string): void {
  const map = ensureCache();
  map.delete(code);
  map.set(code, dataUri);
  while (cacheBytes(map) > FLAG_CACHE_MAX_BYTES && map.size > 0) {
    const first = map.keys().next().value;
    if (!first) break;
    map.delete(first);
  }
  queuePersistCache();
}

async function fetchFlagDataUri(code: string): Promise<string | null> {
  const url = getCircleFlagUrl(code);
  const response = await requestUrl({
    url,
    method: "GET",
    headers: { Accept: "image/svg+xml" },
  });
  if (response.status !== 200 || !response.text) return null;
  const svgText = response.text;
  if (!svgText || !svgText.includes("<svg")) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
}

async function resolveFlagDataUri(code: string): Promise<string | null> {
  const cached = getCachedFlagDataUri(code);
  if (cached) return cached;
  const inFlight = pendingFetches.get(code);
  if (inFlight) return inFlight;

  const req = (async () => {
    try {
      const dataUri = await fetchFlagDataUri(code);
      if (dataUri) setCachedFlagDataUri(code, dataUri);
      return dataUri;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(code);
    }
  })();

  pendingFetches.set(code, req);
  return req;
}

function applyFlagSrcToDocument(code: string, src: string) {
  if (typeof document === "undefined") return;
  const selector = `img[data-learnkit-flag-code="${code}"]`;
  const images = document.querySelectorAll<HTMLImageElement>(selector);
  images.forEach((img) => {
    img.src = src;
  });
}

function parseFlagCodeFromImage(img: HTMLImageElement): string | null {
  const attrCode = normalizeFlagCode(img.getAttribute("data-learnkit-flag-code") || "");
  if (attrCode) return attrCode;

  const altCode = normalizeFlagCode(img.getAttribute("alt") || "");
  if (altCode) return altCode;

  const src = String(img.getAttribute("src") || "");
  if (!src) return null;
  const m = src.match(/\/flags\/(?:language\/)?([a-z]{2}(?:-[a-z0-9]{2,3})?)\.svg(?:[?#]|$)/i);
  if (!m) return null;
  return normalizeFlagCode(m[1] || "");
}

export function hydrateCircleFlagsInElement(root: ParentNode): void {
  const images: HTMLImageElement[] = [];
  const stack: Node[] = [root as Node];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node instanceof HTMLImageElement && (node.hasAttribute("data-learnkit-flag-code") || node.classList.contains("learnkit-inline-flag"))) {
      images.push(node);
    }

    const children = (node as ParentNode).childNodes;
    if (!children || children.length === 0) continue;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  images.forEach((node) => {
    const img = node;
    const code = parseFlagCodeFromImage(img);
    if (!code) return;

    if (!img.hasAttribute("data-learnkit-flag-code")) {
      img.setAttribute("data-learnkit-flag-code", code);
    }

    const cached = getCachedFlagDataUri(code);
    if (cached) {
      img.src = cached;
      return;
    }

    void resolveFlagDataUri(code).then((dataUri) => {
      if (!dataUri) return;
      applyFlagSrcToDocument(code, dataUri);
    });
  });
}