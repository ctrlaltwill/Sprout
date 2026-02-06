/**
 * imageocclusion/io-helpers.ts
 * ---------------------------------------------------------------------------
 * Shared utility functions for all Image Occlusion code.
 *
 * Owns vault-path helpers, image-resolution, IO-specific ID reservation,
 * and the IO markdown builder.  General-purpose modal utilities remain in
 * `modals/modal-utils.ts`.
 * ---------------------------------------------------------------------------
 */

import { type App, TFile } from "obsidian";
import type SproutPlugin from "../main";
import { generateUniqueId } from "../core/ids";
import { formatPipeField } from "../modals/modal-utils";

// ── Vault-path utilities ────────────────────────────────────────────────────

/** Normalise a vault-relative path (forward slashes, no leading slash). */
export function normaliseVaultPath(p: string): string {
  let s = String(p ?? "").trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/^\/+/, "");
  s = s.replace(/^\.\/+/, "");
  while (s.startsWith("../")) s = s.slice(3);
  s = s.replace(/\/{2,}/g, "/");
  return s;
}

/** Strip `![[…]]` embed syntax and optional `|size` suffix. */
export function stripEmbedSyntax(raw: string): string {
  let s = String(raw ?? "").trim();
  if (s.startsWith("![[") && s.endsWith("]]")) s = s.slice(3, -2).trim();
  if (s.includes("|")) s = s.split("|")[0].trim();
  s = normaliseVaultPath(s);
  return s;
}

/**
 * Resolve an IO image reference (embed syntax or plain path) to a vault TFile.
 * Tries metadataCache link resolution first, then direct path lookup.
 *
 * Canonical implementation – `modal-utils.resolveIoImageFile` is an alias.
 */
export function resolveImageFile(app: App, sourceNotePath: string, imageRef: string): TFile | null {
  const link = stripEmbedSyntax(imageRef);
  if (!link) return null;

  const dest = app.metadataCache.getFirstLinkpathDest(link, sourceNotePath);
  if (dest instanceof TFile) return dest;

  const af = app.vault.getAbstractFileByPath(link);
  if (af instanceof TFile) return af;

  return null;
}

// ── MIME / extension helpers ────────────────────────────────────────────────

/** Map a file extension to its MIME type. */
export function mimeFromExt(ext: string): string {
  const e = String(ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "image/png";
}

// ── DOM utilities ───────────────────────────────────────────────────────────

/** Check if an element is an editable form control (input/textarea/contentEditable). */
export function isEditableTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = String(e.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if (e.isContentEditable) return true;
  return false;
}

/** Empty an element using Obsidian's `.empty()` or `innerHTML`. */
export function emptyEl(el: HTMLElement) {
  if (typeof (el as HTMLElement & { empty?: () => void }).empty === "function") (el as HTMLElement & { empty?: () => void }).empty!();
  else el.innerHTML = "";
}

// ── ID / anchor helpers ─────────────────────────────────────────────────────

/** Generate a unique ID with an optional prefix. */
export function uid(prefix = "sprout-io") {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

/** Collect all `^sprout-NNNNNNNNN` anchor IDs from a text string. */
export function collectAnchorIdsFromText(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\^sprout-(\d{9})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

/**
 * Generate a new unique Sprout card ID that doesn't collide with any
 * existing IDs in the store or in the note's anchor references.
 */
export async function reserveNewBcId(plugin: SproutPlugin, file: TFile): Promise<string> {
  const store = plugin.store;
  const used = new Set<string>();

  try {
    for (const k of Object.keys(store?.data?.cards || {})) used.add(String(k));
    for (const k of Object.keys(store?.data?.quarantine || {})) used.add(String(k));
    for (const k of Object.keys((store?.data as Record<string, unknown>)?.cardById ?? {})) used.add(String(k));
  } catch {
    // ignore
  }

  try {
    const txt = await plugin.app.vault.read(file);
    for (const id of collectAnchorIdsFromText(txt)) used.add(id);
  } catch {
    // ignore
  }

  const id = String(generateUniqueId(used)).trim();
  return id;
}

// ── IO markdown builder ─────────────────────────────────────────────────────

/**
 * Build the markdown block for an IO card (pipe-format lines).
 */
export function buildIoMarkdownWithAnchor(params: {
  id: string;
  title?: string;
  groups?: string;
  ioEmbed: string;
  occlusionsJson?: string | null;
  maskMode?: "solo" | "all" | null;
  info?: string;
}): string[] {
  const out: string[] = [];
  if (params.title?.trim()) out.push(...formatPipeField("T", params.title.trim()));
  if (params.groups?.trim()) out.push(...formatPipeField("G", params.groups.trim()));
  out.push(...formatPipeField("IO", params.ioEmbed));
  // O (occlusions) and C (maskMode) are stored in store.io only, not in markdown
  if (params.info?.trim()) out.push(...formatPipeField("I", params.info.trim()));
  out.push("");
  return out;
}

// ── Types ───────────────────────────────────────────────────────────────────

/** Options accepted by `ImageOcclusionEditorModal.openForParent`. */
export type IoEditorOpenOpts = {
  onClose?: () => void;
};
