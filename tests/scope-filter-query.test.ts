/**
 * @file tests/scope-filter-query.test.ts
 * @summary Unit tests for scope filter query.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";

/**
 * Mirrors the `toToken` helper inside `renderNoteReviewSection` (settings-tab.ts).
 * URI-encodes values so tokens survive space-delimited round-trips.
 */
const encodeTokenValue = (v: string): string => {
  try { return encodeURIComponent(v); } catch { return v; }
};

function toToken(id: string, negate: boolean): string | null {
  const prefix = negate ? "-" : "";
  if (id === "vault::") return `${prefix}scope:vault`;
  if (id.startsWith("folder::")) return `${prefix}path:${encodeTokenValue(id.slice("folder::".length))}`;
  if (id.startsWith("note::")) return `${prefix}note:${encodeTokenValue(id.slice("note::".length))}`;
  if (id.startsWith("tag::")) return `${prefix}tag:${encodeTokenValue(id.slice("tag::".length))}`;
  if (id.startsWith("prop::")) {
    const raw = id.slice("prop::".length);
    const eq = raw.indexOf("=");
    if (eq <= 0) return null;
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    return `${prefix}prop:${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
  return null;
}

/**
 * Mirrors the `parseStoredQuery` helper inside `renderNoteReviewSection` (settings-tab.ts).
 * URI-decodes values to reconstruct the internal IDs.
 *
 * @param notePathSet – The set of vault note paths (used to distinguish `path:` → note vs folder).
 */
function parseStoredQuery(
  query: string,
  notePathSet: Set<string>,
): { include: Set<string>; exclude: Set<string>; passthrough: string[] } {
  const safeDecodeURI = (v: string): string => {
    try { return decodeURIComponent(v); } catch { return v; }
  };
  const include = new Set<string>();
  const exclude = new Set<string>();
  const passthrough: string[] = [];
  const parts = String(query || "")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const lowered = part.toLowerCase();
    if (lowered === "scope:vault" || lowered === "vault") { include.add("vault::"); continue; }
    if (lowered === "-scope:vault" || lowered === "-vault") { exclude.add("vault::"); continue; }
    if (lowered.startsWith("path:")) {
      const path = safeDecodeURI(String(part.slice(5)).trim());
      if (!path) continue;
      include.add(notePathSet.has(path) ? `note::${path}` : `folder::${path}`);
      continue;
    }
    if (lowered.startsWith("-path:")) {
      const path = safeDecodeURI(String(part.slice(6)).trim());
      if (!path) continue;
      exclude.add(notePathSet.has(path) ? `note::${path}` : `folder::${path}`);
      continue;
    }
    if (lowered.startsWith("note:")) {
      const path = safeDecodeURI(String(part.slice(5)).trim());
      if (!path) continue;
      include.add(`note::${path}`);
      continue;
    }
    if (lowered.startsWith("-note:")) {
      const path = safeDecodeURI(String(part.slice(6)).trim());
      if (!path) continue;
      exclude.add(`note::${path}`);
      continue;
    }
    if (lowered.startsWith("tag:")) {
      const token = safeDecodeURI(String(part.slice(4)).trim()).toLowerCase().replace(/^#+/, "");
      if (!token) continue;
      include.add(`tag::${token}`);
      continue;
    }
    if (lowered.startsWith("-tag:")) {
      const token = safeDecodeURI(String(part.slice(5)).trim()).toLowerCase().replace(/^#+/, "");
      if (!token) continue;
      exclude.add(`tag::${token}`);
      continue;
    }
    if (lowered.startsWith("prop:")) {
      const token = safeDecodeURI(String(part.slice(5)).trim()).toLowerCase();
      if (!token) continue;
      include.add(`prop::${token}`);
      continue;
    }
    if (lowered.startsWith("-prop:")) {
      const token = safeDecodeURI(String(part.slice(6)).trim()).toLowerCase();
      if (!token) continue;
      exclude.add(`prop::${token}`);
      continue;
    }
    passthrough.push(part);
  }

  return { include, exclude, passthrough };
}

/** Mirrors `_parseFilterQuery` in note-review-view.ts. */
function parseFilterQuery(query: string) {
  const safeDecodeURI = (v: string): string => {
    try { return decodeURIComponent(v); } catch { return v; }
  };
  const parts = String(query || "").split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const includePath: string[] = [];
  const excludePath: string[] = [];
  const includeNote: string[] = [];
  const excludeNote: string[] = [];
  const includeTag: string[] = [];
  const excludeTag: string[] = [];
  const includeProp: string[] = [];
  const excludeProp: string[] = [];
  let includeVault = false;
  let excludeVault = false;

  for (const part of parts) {
    const lowered = part.toLowerCase();
    if (lowered === "scope:vault" || lowered === "vault") { includeVault = true; }
    else if (lowered === "-scope:vault" || lowered === "-vault") { excludeVault = true; }
    else if (lowered.startsWith("path:")) { includePath.push(safeDecodeURI(lowered.slice(5))); }
    else if (lowered.startsWith("-path:")) { excludePath.push(safeDecodeURI(lowered.slice(6))); }
    else if (lowered.startsWith("note:")) { includeNote.push(safeDecodeURI(String(part.slice(5)).trim())); }
    else if (lowered.startsWith("-note:")) { excludeNote.push(safeDecodeURI(String(part.slice(6)).trim())); }
    else if (lowered.startsWith("tag:")) { includeTag.push(safeDecodeURI(String(lowered.slice(4)).trim()).replace(/^#+/, "")); }
    else if (lowered.startsWith("-tag:")) { excludeTag.push(safeDecodeURI(String(lowered.slice(5)).trim()).replace(/^#+/, "")); }
    else if (lowered.startsWith("prop:")) { includeProp.push(safeDecodeURI(String(part.slice(5)).trim()).toLowerCase()); }
    else if (lowered.startsWith("-prop:")) { excludeProp.push(safeDecodeURI(String(part.slice(6)).trim()).toLowerCase()); }
  }
  return { includePath, excludePath, includeNote, excludeNote, includeTag, excludeTag, includeProp, excludeProp, includeVault, excludeVault };
}

/** Simulate the persist flow: includeSet + excludeSet → filterQuery string → parse back. */
function roundTrip(
  includeIds: string[],
  excludeIds: string[],
  notePathSet: Set<string>,
) {
  const includeTokens = includeIds.map((id) => toToken(id, false)).filter(Boolean) as string[];
  const excludeTokens = excludeIds.map((id) => toToken(id, true)).filter(Boolean) as string[];
  const filterQuery = [...includeTokens, ...excludeTokens].filter(Boolean).join(" ").trim();
  return { filterQuery, parsed: parseStoredQuery(filterQuery, notePathSet) };
}

describe("scope filter query round-trip", () => {
  it("round-trips simple note path", () => {
    const notePathSet = new Set(["Notes/MyNote.md"]);
    const { parsed } = roundTrip(["note::Notes/MyNote.md"], [], notePathSet);
    expect(parsed.include).toEqual(new Set(["note::Notes/MyNote.md"]));
    expect(parsed.exclude.size).toBe(0);
  });

  it("round-trips note path with spaces", () => {
    const notePathSet = new Set(["My Notes/Important File.md"]);
    const { parsed } = roundTrip(["note::My Notes/Important File.md"], [], notePathSet);
    expect(parsed.include).toEqual(new Set(["note::My Notes/Important File.md"]));
    expect(parsed.exclude.size).toBe(0);
  });

  it("round-trips folder path with spaces", () => {
    const notePathSet = new Set<string>();
    const { parsed } = roundTrip(["folder::My Study Material"], [], notePathSet);
    expect(parsed.include).toEqual(new Set(["folder::My Study Material"]));
  });

  it("round-trips exclude note with spaces", () => {
    const notePathSet = new Set(["Home/My Note.md"]);
    const { parsed } = roundTrip([], ["note::Home/My Note.md"], notePathSet);
    expect(parsed.exclude).toEqual(new Set(["note::Home/My Note.md"]));
    expect(parsed.include.size).toBe(0);
  });

  it("round-trips tags", () => {
    const notePathSet = new Set<string>();
    const { parsed } = roundTrip(["tag::study"], ["-tag::draft"], notePathSet);
    // Note: the exclude IDs shouldn't have the - prefix internally
    // the `-` is only in the serialised token, handled by negate parameter
    // Correcting: exclude IDs should be `tag::draft` not `-tag::draft`
  });

  it("round-trips tags (corrected)", () => {
    const notePathSet = new Set<string>();
    const { parsed } = roundTrip(["tag::study"], ["tag::draft"], notePathSet);
    expect(parsed.include).toEqual(new Set(["tag::study"]));
    expect(parsed.exclude).toEqual(new Set(["tag::draft"]));
  });

  it("round-trips scope:vault", () => {
    const { parsed } = roundTrip(["vault::"], [], new Set());
    expect(parsed.include).toEqual(new Set(["vault::"]));
  });

  it("round-trips mixed include and exclude", () => {
    const notePathSet = new Set(["Lectures/Organic Chemistry.md"]);
    const { parsed } = roundTrip(
      ["note::Lectures/Organic Chemistry.md", "folder::My Folder/Sub Folder"],
      ["tag::draft", "note::Lectures/Organic Chemistry.md"],
      notePathSet,
    );
    expect(parsed.include.has("note::Lectures/Organic Chemistry.md")).toBe(true);
    expect(parsed.include.has("folder::My Folder/Sub Folder")).toBe(true);
    expect(parsed.exclude.has("tag::draft")).toBe(true);
    expect(parsed.exclude.has("note::Lectures/Organic Chemistry.md")).toBe(true);
  });

  it("round-trips property pair", () => {
    const notePathSet = new Set<string>();
    const { parsed } = roundTrip(["prop::course=math"], [], notePathSet);
    expect(parsed.include).toEqual(new Set(["prop::course=math"]));
  });

  it("round-trips property pair with spaces", () => {
    const notePathSet = new Set<string>();
    const { parsed } = roundTrip(["prop::my key=my value"], [], notePathSet);
    expect(parsed.include).toEqual(new Set(["prop::my key=my value"]));
  });

  it("backward compat: parses old unencoded note paths", () => {
    const notePathSet = new Set(["Simple/Path.md"]);
    const parsed = parseStoredQuery("note:Simple/Path.md", notePathSet);
    expect(parsed.include).toEqual(new Set(["note::Simple/Path.md"]));
  });

  it("backward compat: parses old unencoded folder paths", () => {
    const notePathSet = new Set<string>();
    const parsed = parseStoredQuery("path:MyFolder", notePathSet);
    expect(parsed.include).toEqual(new Set(["folder::MyFolder"]));
  });
});

describe("_parseFilterQuery (note-review-view) round-trip", () => {
  it("decodes encoded note paths with spaces", () => {
    const token = toToken("note::My Notes/Important File.md", false)!;
    expect(token).toBe("note:My%20Notes%2FImportant%20File.md");
    const result = parseFilterQuery(token);
    expect(result.includeNote).toEqual(["My Notes/Important File.md"]);
  });

  it("decodes encoded folder paths with spaces", () => {
    const token = toToken("folder::My Study Material", false)!;
    expect(token).toBe("path:My%20Study%20Material");
    const result = parseFilterQuery(token);
    // _parseFilterQuery lowercases path tokens and now decodes them
    expect(result.includePath).toEqual(["my study material"]);
  });

  it("decodes exclude note paths with spaces", () => {
    const token = toToken("note::Home/My Note.md", true)!;
    const result = parseFilterQuery(token);
    expect(result.excludeNote).toEqual(["Home/My Note.md"]);
  });

  it("handles backward-compat unencoded simple paths", () => {
    const result = parseFilterQuery("note:Simple/Path.md -tag:draft");
    expect(result.includeNote).toEqual(["Simple/Path.md"]);
    expect(result.excludeTag).toEqual(["draft"]);
  });
});
