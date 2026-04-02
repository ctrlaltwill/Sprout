/**
 * @file tests/reading-extract-card-source.test.ts
 * @summary Unit tests for reading extract card source.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { extractCardFromSource, parseSproutCard } from "../src/views/reading/reading-helpers";

describe("extractCardFromSource", () => {
  it("keeps multiline heading/list content inside a delimited field until closing delimiter", () => {
    const source = [
      "^sprout-501802774",
      "T | Hi |",
      "Q | # Heading 1",
      "## Heading 2",
      "### Heading 3",
      "#### Heading 4",
      "##### Heading 5",
      "###### Heading 6 |",
      "A | - List Item 1",
      "- List Item 2 |",
      "",
      "## Outside card heading",
    ].join("\n");

    const extracted = extractCardFromSource(source, "501802774");

    expect(extracted).toBe([
      "^sprout-501802774",
      "T | Hi |",
      "Q | # Heading 1",
      "## Heading 2",
      "### Heading 3",
      "#### Heading 4",
      "##### Heading 5",
      "###### Heading 6 |",
      "A | - List Item 1",
      "- List Item 2 |",
    ].join("\n"));
  });
});

describe("parseSproutCard", () => {
  it("preserves nested list indentation inside multiline delimited fields", () => {
    const source = [
      "^sprout-501802774",
      "T | Hi |",
      "Q | # Heading 1",
      "## Heading 2",
      "- Bullet one",
      "\t- Bullet two |",
      "A |",
      "- List Item 1",
      "- List Item 2",
      "\t- Inline |",
    ].join("\n");

    const card = parseSproutCard(source);

    expect(card).not.toBeNull();
    expect(card?.fields.Q).toBe("# Heading 1\n## Heading 2\n- Bullet one\n\t- Bullet two");
    expect(card?.fields.A).toBe("- List Item 1\n- List Item 2\n\t- Inline");
  });
});
