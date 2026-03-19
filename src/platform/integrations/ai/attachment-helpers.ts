/**
 * @file src/platform/integrations/ai/attachment-helpers.ts
 * @summary Helpers for reading vault files and converting them to base64 data
 *          URLs suitable for AI provider multimodal content blocks.
 */

import type { App, TFile } from "obsidian";

/** MIME types we support as native AI attachments. */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_MIME));

/** Accept attribute value for a `<input type="file">` restricted to supported types. */
export const SUPPORTED_FILE_ACCEPT = Object.keys(EXT_MIME).map(e => `.${e}`).join(",");

/** Max bytes per attached image. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Max bytes per attached PDF. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** Max bytes per attached document (docx, pptx, xlsx, csv, txt, md). */
const MAX_DOC_BYTES = 25 * 1024 * 1024;

/** Max total attachment count per request. */
export const MAX_ATTACHMENTS = 5;

export type AttachedFile = {
  name: string;
  extension: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

export function isSupportedAttachmentExt(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(String(ext || "").toLowerCase());
}

export function isImageExt(ext: string): boolean {
  const e = String(ext || "").toLowerCase();
  return e === "png" || e === "jpg" || e === "jpeg" || e === "webp" || e === "gif";
}

export function isPdfExt(ext: string): boolean {
  return String(ext || "").toLowerCase() === "pdf";
}

export function isDocumentExt(ext: string): boolean {
  const e = String(ext || "").toLowerCase();
  return e === "docx" || e === "pptx" || e === "xlsx" || e === "csv" || e === "txt" || e === "md";
}

function maxBytesForExt(ext: string): number {
  if (isImageExt(ext)) return MAX_IMAGE_BYTES;
  if (isPdfExt(ext)) return MAX_PDF_BYTES;
  return MAX_DOC_BYTES;
}

function mimeForExt(ext: string): string {
  return EXT_MIME[String(ext || "").toLowerCase()] || "application/octet-stream";
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  if (!bytes.length) return "";
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Read a vault file and return it as an {@link AttachedFile} with a base64
 * data URL. Returns `null` if the file is too large, unsupported, or
 * unreadable.
 */
export async function readVaultFileAsAttachment(app: App, file: TFile): Promise<AttachedFile | null> {
  const ext = String(file.extension || "").toLowerCase();
  if (!isSupportedAttachmentExt(ext)) return null;

  const maxBytes = maxBytesForExt(ext);

  let data: ArrayBuffer;
  try {
    const vault = app.vault;
    if (typeof vault.readBinary === "function") {
      data = await vault.readBinary(file);
    } else {
      const adapter = vault.adapter as { readBinary?: (path: string) => Promise<ArrayBuffer> };
      if (typeof adapter.readBinary === "function") {
        data = await adapter.readBinary(file.path);
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }

  if (!data.byteLength || data.byteLength > maxBytes) return null;

  const mime = mimeForExt(ext);
  const base64 = arrayBufferToBase64(data);
  if (!base64) return null;

  return {
    name: file.name,
    extension: ext,
    mimeType: mime,
    dataUrl: `data:${mime};base64,${base64}`,
    size: data.byteLength,
  };
}

/**
 * Read a browser {@link File} (from an `<input type="file">`) and return it as
 * an {@link AttachedFile}. Returns `null` if unsupported or oversized.
 */
export async function readFileInputAsAttachment(file: File): Promise<AttachedFile | null> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!isSupportedAttachmentExt(ext)) return null;

  const maxBytes = maxBytesForExt(ext);
  if (file.size > maxBytes) return null;

  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    return null;
  }
  if (!data.byteLength) return null;

  const mime = mimeForExt(ext);
  const base64 = arrayBufferToBase64(data);
  if (!base64) return null;

  return {
    name: file.name,
    extension: ext,
    mimeType: mime,
    dataUrl: `data:${mime};base64,${base64}`,
    size: data.byteLength,
  };
}
