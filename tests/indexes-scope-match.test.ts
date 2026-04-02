/**
 * @file tests/indexes-scope-match.test.ts
 * @summary Unit tests for indexes scope match.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, it, expect } from "vitest";
import { normPath, matchesScope } from "../src/engine/indexing/scope-match";
import type { Scope } from "../src/views/reviewer/types";

describe("scope matching", () => {
  it("normalises paths", () => {
    expect(normPath("./A\\B/C.md")).toBe("A/B/C.md");
  });

  it("matches vault scope", () => {
    const scope: Scope = { type: "vault", key: "", name: "Vault" };
    expect(matchesScope(scope, "Any/Path.md")).toBe(true);
  });

  it("matches note scope exactly", () => {
    const scope: Scope = { type: "note", key: "Notes/One.md", name: "One" };
    expect(matchesScope(scope, "Notes/One.md")).toBe(true);
    expect(matchesScope(scope, "Notes/Two.md")).toBe(false);
  });

  it("matches folder scope", () => {
    const scope: Scope = { type: "folder", key: "Decks/Sub", name: "Sub" };
    expect(matchesScope(scope, "Decks/Sub/Card.md")).toBe(true);
    expect(matchesScope(scope, "Decks/Other/Card.md")).toBe(false);
  });

  it("group scope returns false (resolved elsewhere)", () => {
    const scope: Scope = { type: "group", key: "anatomy", name: "anatomy" };
    expect(matchesScope(scope, "Any/Path.md")).toBe(false);
  });

  it("unknown scope type returns false (fail-closed)", () => {
    const scope = { type: "nonsense", key: "", name: "" } as unknown as Scope;
    expect(matchesScope(scope, "Any/Path.md")).toBe(false);
  });
});
