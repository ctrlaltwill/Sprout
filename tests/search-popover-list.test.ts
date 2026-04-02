/**
 * @file tests/search-popover-list.test.ts
 * @summary Unit tests for search popover list.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { buildScopeSearchPlaceholder } from "../src/views/shared/search-popover-list";

describe("search popover placeholder", () => {
  it("uses generic placeholder when no scoped terms are selected", () => {
    expect(buildScopeSearchPlaceholder([])).toBe("Search...");
  });

  it("lists one selected term", () => {
    expect(buildScopeSearchPlaceholder(["folders"])).toBe("Search for folders");
  });

  it("lists two selected terms", () => {
    expect(buildScopeSearchPlaceholder(["folders", "notes"])).toBe("Search for folders and notes");
  });

  it("falls back to generic placeholder when three terms are selected", () => {
    expect(buildScopeSearchPlaceholder(["folders", "notes", "titles"])).toBe("Search...");
  });

  it("falls back to generic placeholder when four terms are selected", () => {
    expect(buildScopeSearchPlaceholder(["folders", "notes", "titles", "types"])).toBe("Search...");
  });
});
