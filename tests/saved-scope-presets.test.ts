/**
 * @file tests/saved-scope-presets.test.ts
 * @summary Unit tests for saved scope presets.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import {
  parseScopesJson,
  scopeIdKeyFromIds,
  selectionMatchesPreset,
  serializeScopes,
  toScopeId,
  type SavedScopePreset,
} from "../src/views/shared/saved-scope-presets";

describe("saved scope presets helpers", () => {
  it("serializes and parses scope arrays", () => {
    const scopes = [
      { type: "folder", key: "folder/a", name: "folder/a" },
      { type: "tag", key: "med", name: "#med" },
    ] as const;

    const encoded = serializeScopes([...scopes]);
    const decoded = parseScopesJson(encoded);

    expect(decoded).toEqual(scopes);
  });

  it("builds order-insensitive scope keys", () => {
    const left = scopeIdKeyFromIds(["folder::a", "tag::x", "note::n"]);
    const right = scopeIdKeyFromIds(["note::n", "folder::a", "tag::x"]);
    expect(left).toBe(right);
  });

  it("detects when current selection matches preset", () => {
    const preset: SavedScopePreset = {
      id: "1",
      name: "Math Source",
      scopes: [
        { type: "folder", key: "school/math", name: "school/math" },
        { type: "property", key: "course=math", name: "course: math" },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const selected = [
      toScopeId({ type: "property", key: "course=math", name: "course: math" }),
      toScopeId({ type: "folder", key: "school/math", name: "school/math" }),
    ];

    expect(selectionMatchesPreset(selected, preset)).toBe(true);
  });

  it("rejects invalid scopes JSON", () => {
    expect(parseScopesJson("not json")).toEqual([]);
    expect(parseScopesJson('{"a":1}')).toEqual([]);
  });
});
