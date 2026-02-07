import { describe, it, expect } from "vitest";
import { packApkg, unpackApkg } from "../src/anki/anki-zip";
import { strToU8, strFromU8 } from "fflate";

describe("packApkg / unpackApkg", () => {
  it("round-trips a database with no media", () => {
    const fakeDb = strToU8("fake sqlite data");
    const packed = packApkg(fakeDb);
    expect(packed).toBeInstanceOf(Uint8Array);
    expect(packed.length).toBeGreaterThan(0);

    const { db, media } = unpackApkg(packed);
    expect(strFromU8(db)).toBe("fake sqlite data");
    expect(media.size).toBe(0);
  });

  it("round-trips a database with media files", () => {
    const fakeDb = strToU8("sqlite bytes");
    const mediaMap = new Map<string, Uint8Array>();
    mediaMap.set("image.png", strToU8("png data"));
    mediaMap.set("audio.mp3", strToU8("mp3 data"));

    const packed = packApkg(fakeDb, mediaMap);
    const { db, media } = unpackApkg(packed);

    expect(strFromU8(db)).toBe("sqlite bytes");
    expect(media.size).toBe(2);
    expect(strFromU8(media.get("image.png")!)).toBe("png data");
    expect(strFromU8(media.get("audio.mp3")!)).toBe("mp3 data");
  });

  it("throws on invalid apkg (no .anki2 file)", () => {
    const badZip = new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => unpackApkg(badZip)).toThrow(/no .anki2 database/i);
  });
});
