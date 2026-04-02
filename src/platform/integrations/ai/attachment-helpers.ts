/**
 * @file src/platform/integrations/ai/attachment-helpers.ts
 * @summary Module for attachment helpers.
 *
 * @exports
 *  - SUPPORTED_FILE_ACCEPT
 *  - MAX_ATTACHMENTS
 *  - AttachedFile
 *  - isSupportedAttachmentExt
 *  - isImageExt
 *  - isPdfExt
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
  html: "text/html",
  htm: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  ts: "application/typescript",
  jsx: "text/jsx",
  tsx: "text/tsx",
  css: "text/css",
  py: "text/x-python",
  java: "text/x-java-source",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++src",
  hpp: "text/x-c++hdr",
  cs: "text/x-csharp",
  go: "text/x-go",
  rs: "text/x-rustsrc",
  php: "text/x-php",
  rb: "text/x-ruby",
  sh: "application/x-sh",
  bash: "application/x-sh",
  zsh: "application/x-sh",
  sql: "application/sql",
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

type ParsedDataUrl = {
  mimeType: string;
  base64: string;
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
  return e === "docx" || e === "pptx" || e === "xlsx" || e === "csv" || e === "txt" || e === "md"
    || e === "html" || e === "htm" || e === "json" || e === "xml" || e === "yaml" || e === "yml"
    || e === "js" || e === "mjs" || e === "cjs" || e === "ts" || e === "jsx" || e === "tsx" || e === "css"
    || e === "py" || e === "java" || e === "c" || e === "h" || e === "cpp" || e === "hpp" || e === "cs"
    || e === "go" || e === "rs" || e === "php" || e === "rb" || e === "sh" || e === "bash" || e === "zsh"
    || e === "sql";
}

function parseDataUrl(url: string): ParsedDataUrl | null {
  const raw = String(url || "").trim();
  const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), base64: match[2] };
}

function base64ToUtf8(base64: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

export function isTextLikeMimeType(mimeType: string): boolean {
  const mime = String(mimeType || "").toLowerCase();
  if (!mime) return false;
  if (mime.startsWith("text/")) return true;
  return mime === "application/json"
    || mime === "application/xml"
    || mime === "application/javascript"
    || mime === "application/typescript"
    || mime === "application/x-yaml"
    || mime === "application/x-sh"
    || mime === "application/sql";
}

export function splitTextLikeAttachmentDataUrls(dataUrls: string[]): {
  binaryDataUrls: string[];
  textBlocks: Array<{ mimeType: string; text: string }>;
} {
  const binaryDataUrls: string[] = [];
  const textBlocks: Array<{ mimeType: string; text: string }> = [];

  for (const value of dataUrls || []) {
    const parsed = parseDataUrl(value);
    if (!parsed) {
      binaryDataUrls.push(String(value || ""));
      continue;
    }
    if (!isTextLikeMimeType(parsed.mimeType)) {
      binaryDataUrls.push(String(value || ""));
      continue;
    }

    const decodedText = base64ToUtf8(parsed.base64);
    const text = decodedText.split("\u0000").join("").trim();
    if (!text) continue;
    textBlocks.push({ mimeType: parsed.mimeType, text });
  }

  return { binaryDataUrls, textBlocks };
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
