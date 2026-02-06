/**
 * io-helpers.ts
 *
 * Shared utility functions used by ImageOcclusionEditorModal
 * (ImageMaskRenderer) and ImageOcclusionReviewRender.
 *
 * Extracted to eliminate duplication across IO files.
 */

import { App, TFile } from "obsidian";

/* -----------------------
   Vault path utilities
   ----------------------- */

/** Normalise a vault-relative path (forward slashes, no leading slash). */
export function normaliseVaultPath(p: string): string {
  let s = String(p ?? "").trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/^\/+/, "");
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

/** Resolve an image reference to a TFile via metadata cache or direct path. */
export function resolveImageFile(app: App, sourceNotePath: string, imageRef: string): TFile | null {
  const link = stripEmbedSyntax(imageRef);
  if (!link) return null;

  const cache: any = (app as any).metadataCache;
  const dest = cache?.getFirstLinkpathDest?.(link, sourceNotePath);
  if (dest instanceof TFile) return dest;

  const af = app.vault.getAbstractFileByPath(link);
  if (af instanceof TFile) return af;

  return null;
}

/* -----------------------
   DOM utilities
   ----------------------- */

/** Check if an element is an editable form control (input/textarea/contentEditable). */
export function isEditableTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = String((e as any).tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if ((e as any).isContentEditable) return true;
  return false;
}

/** Empty an element using Obsidian's `.empty()` or `innerHTML`. */
export function emptyEl(el: HTMLElement) {
  const anyEl: any = el as any;
  if (typeof anyEl?.empty === "function") anyEl.empty();
  else el.innerHTML = "";
}

/* -----------------------
   Misc
   ----------------------- */

/** Generate a unique ID with an optional prefix. */
export function uid(prefix = "sprout-io") {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

/** Options accepted by `ImageOcclusionEditorModal.openForParent`. */
export type IoEditorOpenOpts = {
  onClose?: () => void;
};
