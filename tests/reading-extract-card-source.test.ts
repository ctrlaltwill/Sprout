/**
 * @file tests/reading-extract-card-source.test.ts
 * @summary Unit tests for reading extract card source.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, expect, it } from "vitest";
import { extractCardFromSource, parseLearnKitCard } from "../src/views/reading/reading-helpers";

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

  it("keeps trailing I field after multiline cloze list content", () => {
    const source = [
      "^learnkit-260783268",
      "T | Delta Ratio Interpretation for Metabolic Acidosis |",
      "CQ | Delta ratio = $( \\text{Anion Gap} - 12 ) / ( 24 - \\text{HCO}_3^- )$.",
      "- Value <0.4 indicates {{c1::NAGMA}}.",
      "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}. |",
      "I | Use only when a HAGMA is present (AG >12). |",
      "",
      "## Outside heading",
    ].join("\n");

    const extracted = extractCardFromSource(source, "260783268");

    expect(extracted).toBe([
      "^learnkit-260783268",
      "T | Delta Ratio Interpretation for Metabolic Acidosis |",
      "CQ | Delta ratio = $( \\text{Anion Gap} - 12 ) / ( 24 - \\text{HCO}_3^- )$.",
      "- Value <0.4 indicates {{c1::NAGMA}}.",
      "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}. |",
      "I | Use only when a HAGMA is present (AG >12). |",
    ].join("\n"));
  });
});

describe("parseLearnKitCard", () => {
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

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.fields.Q).toBe("# Heading 1\n## Heading 2\n- Bullet one\n\t- Bullet two");
    expect(card?.fields.A).toBe("- List Item 1\n- List Item 2\n\t- Inline");
  });

  it("parses cloze list blocks and trailing I fields from a single card", () => {
    const source = [
      "^learnkit-260783268",
      "T | Delta Ratio Interpretation for Metabolic Acidosis |",
      "CQ | Delta ratio = formula",
      "- Value <0.4 indicates {{c1::NAGMA}}.",
      "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}. |",
      "I | Use only when a HAGMA is present (AG >12). |",
    ].join("\n");

    const card = parseLearnKitCard(source);

    expect(card).not.toBeNull();
    expect(card?.fields.CQ).toBe(
      [
        "Delta ratio = formula",
        "- Value <0.4 indicates {{c1::NAGMA}}.",
        "- Over 2.0 indicates {{c1::HAGMA and concurrent metabolic alkalosis or respiratory acidosis}}.",
      ].join("\n"),
    );
    expect(card?.fields.I).toBe("Use only when a HAGMA is present (AG >12).");
  });
});
