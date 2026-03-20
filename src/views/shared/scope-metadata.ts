import type { App, TFile } from "obsidian";

export type PropertyPair = {
  key: string;
  value: string;
};

export type ScopedTag = {
  token: string;
  display: string;
  count: number;
};

export type ScopedProperty = {
  key: string;
  value: string;
  displayKey: string;
  displayValue: string;
  count: number;
};

function titleCaseWords(input: string): string {
  return String(input || "")
    .split(/\s+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toNormalizedPrimitive(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw);
  return "";
}

function normalizeTagToken(raw: unknown): string {
  return toNormalizedPrimitive(raw).trim().toLowerCase().replace(/^#+/, "");
}

function normalizePropertyKey(raw: unknown): string {
  return toNormalizedPrimitive(raw).trim().toLowerCase();
}

function normalizePropertyValue(raw: unknown): string {
  return toNormalizedPrimitive(raw).trim().toLowerCase();
}

function addTag(tags: Set<string>, raw: unknown): void {
  const normalized = normalizeTagToken(raw);
  if (normalized) tags.add(normalized);
}

export function extractFileTags(app: App, file: TFile): Set<string> {
  const tags = new Set<string>();
  const cache = app.metadataCache.getFileCache(file);

  for (const tagRef of cache?.tags ?? []) {
    addTag(tags, tagRef.tag);
  }

  const frontmatter = cache?.frontmatter;
  if (frontmatter && typeof frontmatter === "object") {
    const entries = Object.entries(frontmatter as Record<string, unknown>);
    for (const [key, value] of entries) {
      const normalizedKey = String(key || "").trim().toLowerCase();
      if (normalizedKey !== "tag" && normalizedKey !== "tags") continue;

      if (typeof value === "string") {
        const split = value.split(/[\s,]+/g).filter(Boolean);
        if (split.length > 1) {
          for (const token of split) addTag(tags, token);
        } else {
          addTag(tags, value);
        }
      } else if (Array.isArray(value)) {
        for (const tag of value) addTag(tags, tag);
      }
    }
  }

  return tags;
}

function pushPropertyPair(out: PropertyPair[], rawKey: unknown, rawValue: unknown): void {
  const key = normalizePropertyKey(rawKey);
  const value = normalizePropertyValue(rawValue);
  if (!key || !value) return;
  out.push({ key, value });
}

export function extractFilePropertyPairs(app: App, file: TFile): PropertyPair[] {
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;
  if (!frontmatter || typeof frontmatter !== "object") return [];

  const out: PropertyPair[] = [];
  const entries = Object.entries(frontmatter as Record<string, unknown>);

  for (const [rawKey, rawValue] of entries) {
    const key = normalizePropertyKey(rawKey);
    if (!key || key === "position" || key === "tags") continue;

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (item == null) continue;
        if (typeof item === "object") continue;
        pushPropertyPair(out, key, item);
      }
      continue;
    }

    if (rawValue == null) continue;
    if (typeof rawValue === "object") continue;
    pushPropertyPair(out, key, rawValue);
  }

  return out;
}

export function encodePropertyPair(pair: PropertyPair): string {
  return `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`;
}

export function decodePropertyPair(raw: string): PropertyPair | null {
  const source = String(raw || "");
  const eq = source.indexOf("=");
  if (eq <= 0 || eq >= source.length - 1) return null;
  const key = normalizePropertyKey(decodeURIComponent(source.slice(0, eq)));
  const value = normalizePropertyValue(decodeURIComponent(source.slice(eq + 1)));
  if (!key || !value) return null;
  return { key, value };
}

export function collectVaultTagAndPropertyPairs(app: App, files: TFile[]): {
  tags: ScopedTag[];
  properties: ScopedProperty[];
} {
  const tagCount = new Map<string, number>();
  const propMap = new Map<string, ScopedProperty>();

  for (const file of files) {
    for (const tag of extractFileTags(app, file)) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
    for (const pair of extractFilePropertyPairs(app, file)) {
      const id = `${pair.key}\u0000${pair.value}`;
      if (!propMap.has(id)) {
        propMap.set(id, {
          key: pair.key,
          value: pair.value,
          displayKey: titleCaseWords(pair.key.replace(/[_-]+/g, " ")),
          displayValue: titleCaseWords(pair.value.replace(/[_-]+/g, " ")),
          count: 1,
        });
      } else {
        const existing = propMap.get(id);
        if (existing) existing.count += 1;
      }
    }
  }

  const tags = Array.from(tagCount.entries())
    .map(([token, count]) => ({
      token,
      display: titleCaseWords(token.replace(/[_-]+/g, " ")),
      count,
    }))
    .sort((a, b) => a.token.localeCompare(b.token));

  const properties = Array.from(propMap.values()).sort((a, b) => {
    const keyCmp = a.key.localeCompare(b.key);
    if (keyCmp !== 0) return keyCmp;
    return a.value.localeCompare(b.value);
  });

  return { tags, properties };
}
