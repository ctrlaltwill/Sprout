/**
 * @file src/anki/anki-media.ts
 * @summary Media file handling for Anki import/export. Collects image references
 * from Sprout card fields, resolves them to vault binary files, rewrites references
 * between Sprout wikilink format and Anki HTML img format, and saves imported
 * media files into the vault.
 *
 * @exports
 *  - collectMediaRefs       — scan fields for image references
 *  - resolveVaultMedia      — read binary content of referenced vault images
 *  - rewriteFieldForAnki    — ![[img]] → <img src="img">
 *  - rewriteFieldForSprout  — <img src="img"> → ![[img]]
 *  - saveMediaToVault       — write imported media bytes to vault folder
 */

import { type App, TFile } from "obsidian";

// ── Reference patterns ────────────────────────────────────────────────────────

const WIKI_IMAGE_RE = /!\[\[([^\]]+)\]\]/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const ANKI_IMG_RE = /<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi;
const ANKI_SOUND_RE = new RegExp("\\[" + "sou" + "nd:([^\\]]+)\\]", "g");

// ── Export helpers ────────────────────────────────────────────────────────────

/** Scan Sprout card fields for image references. Returns a set of file paths/names. */
export function collectMediaRefs(fields: (string | null | undefined)[]): Set<string> {
  const refs = new Set<string>();

  for (const field of fields) {
    if (!field) continue;

    // ![[filename.png]] or ![[path/to/file.png|alias]]
    let m: RegExpExecArray | null;
    const wikiRe = new RegExp(WIKI_IMAGE_RE.source, "g");
    while ((m = wikiRe.exec(field)) !== null) {
      const ref = (m[1] || "").split("|")[0].trim();
      if (ref) refs.add(ref);
    }

    // ![alt](path/to/file.png)
    const mdRe = new RegExp(MD_IMAGE_RE.source, "g");
    while ((m = mdRe.exec(field)) !== null) {
      const ref = (m[2] || "").trim();
      if (ref && !ref.startsWith("http://") && !ref.startsWith("https://")) {
        refs.add(ref);
      }
    }
  }

  return refs;
}

/** Resolve vault media files to their binary content. */
export async function resolveVaultMedia(
  app: App,
  refs: Set<string>,
  fromNotePaths: string[],
): Promise<Map<string, Uint8Array>> {
  const media = new Map<string, Uint8Array>();
  const readBinary = app.vault.readBinary?.bind(app.vault);
  if (!readBinary) return media;
  const resolvedPaths = new Set<string>();

  for (const ref of refs) {
    let resolved = false;

    // Try to resolve from each source note's perspective (Obsidian link resolution)
    for (const notePath of fromNotePaths) {
      const file = app.metadataCache.getFirstLinkpathDest(ref, notePath);
      if (file instanceof TFile && !resolvedPaths.has(file.path)) {
        try {
          const bytes = await readBinary(file);
          media.set(file.name, new Uint8Array(bytes));
          resolvedPaths.add(file.path);
          resolved = true;
          break;
        } catch {
          // File couldn't be read — try next note path
        }
      }
    }

    // Fallback: try as a direct vault path
    if (!resolved) {
      const file = app.vault.getAbstractFileByPath(ref);
      if (file instanceof TFile && !resolvedPaths.has(file.path)) {
        try {
          const bytes = await readBinary(file);
          media.set(file.name, new Uint8Array(bytes));
          resolvedPaths.add(file.path);
        } catch {
          // Skip this media file
        }
      }
    }
  }

  return media;
}

/** Rewrite Sprout wikilink/markdown image refs to Anki HTML img tags. */
export function rewriteFieldForAnki(field: string, _mediaNames: Set<string>): string {
  if (!field) return field;
  let text = field;

  // ![[filename.png]] → <img src="filename.png">
  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_match, ref: string) => {
    const filename = (ref || "").split("|")[0].trim();
    const baseName = filename.split("/").pop() || filename;
    return `<img src="${baseName}">`;
  });

  // ![alt](path) → <img src="filename.png">  (skip http URLs)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, _alt: string, path: string) => {
    if (path.startsWith("http://") || path.startsWith("https://")) return _match;
    const baseName = path.split("/").pop() || path;
    return `<img src="${baseName}">`;
  });

  return text;
}

// ── Import helpers ────────────────────────────────────────────────────────────

/** Rewrite Anki HTML img tags and sound refs to Sprout wikilinks. */
export function rewriteFieldForSprout(
  html: string,
  mediaNameMap: Map<string, string>,
): string {
  if (!html) return html;
  let text = html;

  // <img src="filename.png"> → ![[vault-path.png]]
  text = text.replace(new RegExp(ANKI_IMG_RE.source, "gi"), (_match, src: string) => {
    const vaultPath = mediaNameMap.get(src) || src;
    return `![[${vaultPath}]]`;
  });

  // Anki sound marker → ![[file.mp3]]
  text = text.replace(new RegExp(ANKI_SOUND_RE.source, "g"), (_match, src: string) => {
    const vaultPath = mediaNameMap.get(src) || src;
    return `![[${vaultPath}]]`;
  });

  return text;
}

/** Save extracted media files to the vault. Returns a map of ankiName → vaultPath. */
export async function saveMediaToVault(
  app: App,
  media: Map<string, Uint8Array>,
  targetFolder: string,
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (media.size === 0) return nameMap;
  const createBinary = app.vault.createBinary?.bind(app.vault);
  if (!createBinary) return nameMap;

  const mediaFolder = `${targetFolder}/Attachments`;

  // Ensure the media folder exists
  try {
    if (!app.vault.getAbstractFileByPath(mediaFolder)) {
      await app.vault.createFolder(mediaFolder);
    }
  } catch {
    // Folder may already exist
  }

  for (const [filename, bytes] of media) {
    const vaultPath = `${mediaFolder}/${filename}`;
    try {
      if (!app.vault.getAbstractFileByPath(vaultPath)) {
        await createBinary(vaultPath, bytes.buffer as ArrayBuffer);
      }
      nameMap.set(filename, vaultPath);
    } catch {
      nameMap.set(filename, filename);
    }
  }

  return nameMap;
}
