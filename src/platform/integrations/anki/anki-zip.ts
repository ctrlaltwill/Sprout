/**
 * @file src/anki/anki-zip.ts
 * @summary ZIP pack/unpack for Anki .apkg files using fflate.
 *
 * An .apkg is a ZIP archive containing:
 *   - `collection.anki2`  — the SQLite database
 *   - `media`             — a JSON file mapping numeric keys to filenames
 *   - `0`, `1`, `2`, …   — the actual media files, named by index
 *
 * @exports
 *  - packApkg   — build a .apkg from SQLite bytes + media
 *  - unpackApkg — extract SQLite bytes + media from a .apkg
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

/**
 * Pack an Anki .apkg file from SQLite database bytes and optional media files.
 */
export function packApkg(
  sqliteBytes: Uint8Array,
  media: Map<string, Uint8Array> = new Map(),
): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  files["collection.anki2"] = sqliteBytes;

  // Build the media manifest and add media files
  const mediaManifest: Record<string, string> = {};
  let idx = 0;
  for (const [filename, bytes] of media) {
    const key = String(idx);
    mediaManifest[key] = filename;
    files[key] = bytes;
    idx++;
  }

  files["media"] = strToU8(JSON.stringify(mediaManifest));

  return zipSync(files, { level: 6 });
}

/**
 * Unpack an .apkg file into SQLite database bytes and a media file map.
 */
export function unpackApkg(
  apkgBytes: Uint8Array,
): { db: Uint8Array; media: Map<string, Uint8Array> } {
  const filesRaw = unzipSync(apkgBytes) as unknown;
  if (!filesRaw || typeof filesRaw !== "object") {
    throw new Error("Invalid .apkg file: unzip failed");
  }
  const files = filesRaw as Record<string, Uint8Array>;

  // Locate the SQLite database (usually collection.anki2 or collection.anki21)
  const dbKey = Object.keys(files).find(
    (k) => k.endsWith(".anki2") || k.endsWith(".anki21") || k === "collection.anki2",
  );
  if (!dbKey) {
    throw new Error("Invalid .apkg file: no .anki2 database found");
  }
  const db = files[dbKey];

  // Parse the media manifest and collect media blobs
  const media = new Map<string, Uint8Array>();
  const mediaManifestBytes = files["media"];
  if (mediaManifestBytes) {
    try {
      const manifest = JSON.parse(strFromU8(mediaManifestBytes)) as Record<string, string>;
      for (const [numKey, filename] of Object.entries(manifest)) {
        const mediaBytes = files[numKey];
        if (mediaBytes) {
          media.set(filename, mediaBytes);
        }
      }
    } catch {
      // Malformed media manifest — skip media
    }
  }

  return { db, media };
}
