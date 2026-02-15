import { describe, it, expect } from "vitest";
import {
  collectMediaRefs,
  rewriteFieldForAnki,
  rewriteFieldForSprout,
} from "../src/anki/anki-media";

describe("collectMediaRefs", () => {
  it("finds ![[...]] wiki-style image refs", () => {
    const refs = collectMediaRefs(["Check this ![[diagram.png]] here"]);
    expect(refs).toContain("diagram.png");
  });

  it("finds ![[...]] with alt text pipe", () => {
    const refs = collectMediaRefs(["![[photo.jpg|300]]"]);
    expect(refs).toContain("photo.jpg");
  });

  it("finds ![alt](path) markdown-style refs", () => {
    const refs = collectMediaRefs(["Look ![alt](images/chart.png) here"]);
    expect(refs).toContain("images/chart.png");
  });

  it("ignores http URLs in markdown images", () => {
    const refs = collectMediaRefs(["![alt](https://example.com/img.png)"]);
    expect(refs.size).toBe(0);
  });

  it("handles null/undefined fields", () => {
    const refs = collectMediaRefs([null, undefined, ""]);
    expect(refs.size).toBe(0);
  });

  it("collects from multiple fields", () => {
    const refs = collectMediaRefs(["![[a.png]]", "![[b.png]]", "![c](c.png)"]);
    expect(refs.size).toBe(3);
  });
});

describe("rewriteFieldForAnki", () => {
  it("converts ![[file.png]] to <img src>", () => {
    const result = rewriteFieldForAnki("Before ![[test.png]] after", new Set(["test.png"]));
    expect(result).toBe('Before <img src="test.png"> after');
  });

  it("strips path from wiki images", () => {
    const result = rewriteFieldForAnki("![[folder/sub/image.jpg]]", new Set());
    expect(result).toBe('<img src="image.jpg">');
  });

  it("converts ![alt](path) to <img src>", () => {
    const result = rewriteFieldForAnki("![diagram](diagrams/chart.png)", new Set());
    expect(result).toBe('<img src="chart.png">');
  });

  it("leaves http URLs alone", () => {
    const result = rewriteFieldForAnki("![alt](https://example.com/img.png)", new Set());
    expect(result).toBe("![alt](https://example.com/img.png)");
  });
});

describe("rewriteFieldForSprout", () => {
  const soundTag = "[sou" + "nd:audio.mp3]";

  it("converts <img src> to ![[...]]", () => {
    const nameMap = new Map([["test.png", "media/test.png"]]);
    const result = rewriteFieldForSprout('<img src="test.png">', nameMap);
    expect(result).toBe("![[media/test.png]]");
  });

  it("converts Anki sound marker to ![[...]]", () => {
    const nameMap = new Map([["audio.mp3", "media/audio.mp3"]]);
    const result = rewriteFieldForSprout(soundTag, nameMap);
    expect(result).toBe("![[media/audio.mp3]]");
  });

  it("falls back to original name when not in map", () => {
    const result = rewriteFieldForSprout('<img src="missing.png">', new Map());
    expect(result).toBe("![[missing.png]]");
  });
});
