import { describe, expect, it } from "vitest";

import { parseCardsFromText } from "../src/engine/parser/parser";
import { buildHqMarkdownWithAnchor, buildIoMarkdownWithAnchor } from "../src/platform/image-occlusion/io-helpers";

describe("image occlusion markdown builders", () => {
  it("keeps IO occlusions and mask mode out of markdown output", () => {
    const occlusionsJson = JSON.stringify([
      { rectId: "r1", x: 0.1, y: 0.2, w: 0.3, h: 0.4, groupKey: "1", shape: "rect" },
    ]);

    const block = buildIoMarkdownWithAnchor({
      id: "io-parent",
      title: "Brain bleed",
      groups: "neuro",
      ioEmbed: "![[brain.png]]",
      occlusionsJson,
      maskMode: "solo",
      info: "extra",
    }).join("\n");

    const { cards } = parseCardsFromText("note.md", block);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe("io");
    expect(cards[0]?.ioOcclusionsRaw).toBeNull();
    expect(cards[0]?.occlusions).toBeNull();
    expect(cards[0]?.maskMode).toBeNull();
  });

  it("keeps HQ regions and interaction mode out of markdown output", () => {
    const hqRegionsJson = JSON.stringify([
      { rectId: "r1", x: 0.1, y: 0.2, w: 0.3, h: 0.4, groupKey: "1", label: "Subdural", shape: "rect" },
    ]);

    const block = buildHqMarkdownWithAnchor({
      id: "hq-parent",
      title: "Brain bleed hotspot",
      groups: "neuro",
      hqEmbed: "![[brain.png]]",
      hqRegionsJson,
      interactionMode: "click",
      info: "extra",
    }).join("\n");

    const { cards } = parseCardsFromText("note.md", block);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe("hq");
    expect(cards[0]?.hqRegionsRaw).toBeNull();
    expect(cards[0]?.hqRegions).toBeNull();
    expect(cards[0]?.interactionMode).toBeNull();
  });
});