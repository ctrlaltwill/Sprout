/**
 * imageocclusion/io-image-ops.ts
 * ---------------------------------------------------------------------------
 * Pure image-manipulation functions for the Image Occlusion creator modal.
 *
 *  • loadImageElement      – decode a ClipboardImage into an HTMLImageElement
 *  • rotateImageData       – rotate 90° CW/CCW, remap rects & text boxes
 *  • cropImageData         – crop to a stage-coordinate rectangle
 *  • burnTextBoxesIntoImageData – render text annotations into the image
 *  • drawTextOnImageData   – render a single text string onto the image
 *  • hexToRgb / textBgCss / clampTextBgOpacity – colour helpers
 * ---------------------------------------------------------------------------
 */

import type { ClipboardImage, IORect, IOTextBox } from "./io-types";

// ── Colour / background helpers ─────────────────────────────────────────────

export function clampTextBgOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let s = String(hex || "").trim();
  if (!s || s === "transparent") return null;
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) s = `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;
  return { r, g, b };
}

export function textBgCss(color: string | null | undefined, opacity: number | null | undefined): string {
  const c = String(color || "").trim();
  if (!c || c === "transparent") return "transparent";
  const o = clampTextBgOpacity(opacity ?? 1);
  const rgb = hexToRgb(c);
  if (!rgb) return c;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${o})`;
}

// ── Image element loading ───────────────────────────────────────────────────

export async function loadImageElement(imageData: ClipboardImage): Promise<HTMLImageElement | null> {
  const blob = new Blob([imageData.data], { type: imageData.mime });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    img.onload = done;
    img.onerror = done;
    img.src = url;
  });
  URL.revokeObjectURL(url);
  if (!img.naturalWidth || !img.naturalHeight) return null;
  return img;
}

// ── Rotate ──────────────────────────────────────────────────────────────────

export async function rotateImageData(
  imageData: ClipboardImage,
  direction: "cw" | "ccw",
  rects: IORect[],
  textBoxes: IOTextBox[],
): Promise<{ imageData: ClipboardImage; rects: IORect[]; textBoxes: IOTextBox[] } | null> {
  const img = await loadImageElement(imageData);
  if (!img) return null;

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = srcH;
  canvas.height = srcW;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (direction === "cw") {
    ctx.translate(srcH, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, srcW);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), imageData.mime || "image/png");
  });
  const data = await blob.arrayBuffer();
  const newImageData: ClipboardImage = { mime: imageData.mime, data };

  const dstW = srcH;
  const dstH = srcW;

  const newRects = rects
    .map((r) => {
      const x = r.normX * srcW;
      const y = r.normY * srcH;
      const w = r.normW * srcW;
      const h = r.normH * srcH;
      let nx = 0;
      let ny = 0;
      const nw = h;
      const nh = w;

      if (direction === "cw") {
        nx = srcH - (y + h);
        ny = x;
      } else {
        nx = y;
        ny = srcW - (x + w);
      }

      return { ...r, normX: nx / dstW, normY: ny / dstH, normW: nw / dstW, normH: nh / dstH };
    })
    .filter((r) => r.normW > 0 && r.normH > 0);

  const newTextBoxes = textBoxes
    .map((t) => {
      const x = t.normX * srcW;
      const y = t.normY * srcH;
      const w = t.normW * srcW;
      const h = t.normH * srcH;
      let nx = 0;
      let ny = 0;
      const nw = h;
      const nh = w;

      if (direction === "cw") {
        nx = srcH - (y + h);
        ny = x;
      } else {
        nx = y;
        ny = srcW - (x + w);
      }

      return { ...t, normX: nx / dstW, normY: ny / dstH, normW: nw / dstW, normH: nh / dstH };
    })
    .filter((t) => t.normW > 0 && t.normH > 0);

  return { imageData: newImageData, rects: newRects, textBoxes: newTextBoxes };
}

// ── Crop ────────────────────────────────────────────────────────────────────

export async function cropImageData(
  imageData: ClipboardImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  rects: IORect[],
  textBoxes: IOTextBox[],
): Promise<{ imageData: ClipboardImage; rects: IORect[]; textBoxes: IOTextBox[] } | null> {
  const img = await loadImageElement(imageData);
  if (!img) return null;

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const cropX = Math.max(0, Math.min(srcW - 1, sx));
  const cropY = Math.max(0, Math.min(srcH - 1, sy));
  const cropW = Math.max(1, Math.min(srcW - cropX, sw));
  const cropH = Math.max(1, Math.min(srcH - cropY, sh));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropW);
  canvas.height = Math.round(cropH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), imageData.mime || "image/png");
  });
  const data = await blob.arrayBuffer();
  const newImageData: ClipboardImage = { mime: imageData.mime, data };

  const dstW = canvas.width;
  const dstH = canvas.height;

  const newRects: IORect[] = [];
  for (const r of rects) {
    const x = r.normX * srcW;
    const y = r.normY * srcH;
    const w = r.normW * srcW;
    const h = r.normH * srcH;

    const ix0 = Math.max(cropX, x);
    const iy0 = Math.max(cropY, y);
    const ix1 = Math.min(cropX + cropW, x + w);
    const iy1 = Math.min(cropY + cropH, y + h);
    const iw = ix1 - ix0;
    const ih = iy1 - iy0;

    if (iw <= 1 || ih <= 1) continue;

    newRects.push({
      ...r,
      normX: (ix0 - cropX) / dstW,
      normY: (iy0 - cropY) / dstH,
      normW: iw / dstW,
      normH: ih / dstH,
    });
  }

  const newTextBoxes: IOTextBox[] = [];
  for (const t of textBoxes) {
    const x = t.normX * srcW;
    const y = t.normY * srcH;
    const w = t.normW * srcW;
    const h = t.normH * srcH;

    const ix0 = Math.max(cropX, x);
    const iy0 = Math.max(cropY, y);
    const ix1 = Math.min(cropX + cropW, x + w);
    const iy1 = Math.min(cropY + cropH, y + h);
    const iw = ix1 - ix0;
    const ih = iy1 - iy0;

    if (iw <= 1 || ih <= 1) continue;

    newTextBoxes.push({
      ...t,
      normX: (ix0 - cropX) / dstW,
      normY: (iy0 - cropY) / dstH,
      normW: iw / dstW,
      normH: ih / dstH,
    });
  }

  return { imageData: newImageData, rects: newRects, textBoxes: newTextBoxes };
}

// ── Burn text boxes into image ──────────────────────────────────────────────

export async function burnTextBoxesIntoImageData(
  imageData: ClipboardImage,
  textBoxes: IOTextBox[],
): Promise<ClipboardImage> {
  if (textBoxes.length === 0) return imageData;

  const img = await loadImageElement(imageData);
  if (!img) return imageData;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageData;
  ctx.drawImage(img, 0, 0);

  const wrapText = (text: string, maxWidth: number) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [text];
  };

  for (const t of textBoxes) {
    const x = t.normX * img.naturalWidth;
    const y = t.normY * img.naturalHeight;
    const w = t.normW * img.naturalWidth;
    const h = t.normH * img.naturalHeight;
    if (w <= 2 || h <= 2 || !t.text.trim()) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const bg = textBgCss(t.bgColor, t.bgOpacity ?? 1);
    if (bg && bg !== "transparent") {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, h);
    }

    const fontSize = Math.max(8, Math.round(t.fontSize || 14));
    ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const fill = t.color || "#111111";
    const hex = fill.replace("#", "").trim();
    let r = 255;
    let g = 255;
    let b = 255;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const stroke = luminance > 0.6 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)";
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, Math.round(fontSize / 8));

    const padding = 6;
    const maxWidth = Math.max(1, w - padding * 2);
    const lines = t.text.split(/\r?\n/);
    let cursorY = y + padding;
    for (const rawLine of lines) {
      const wrapped = wrapText(rawLine, maxWidth);
      for (const line of wrapped) {
        ctx.strokeText(line, x + padding, cursorY);
        ctx.fillText(line, x + padding, cursorY);
        cursorY += Math.round(fontSize * 1.3);
        if (cursorY > y + h) break;
      }
      if (cursorY > y + h) break;
    }

    ctx.restore();
  }

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), imageData.mime || "image/png");
  });
  const data = await blob.arrayBuffer();
  return { mime: imageData.mime, data };
}

// ── Draw single text on image ───────────────────────────────────────────────

export async function drawTextOnImageData(
  imageData: ClipboardImage,
  text: string,
  stageX: number,
  stageY: number,
  fontSize: number,
  textColor: string,
): Promise<ClipboardImage | null> {
  const img = await loadImageElement(imageData);
  if (!img) return null;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const fill = textColor || "#111111";
  const hex = fill.replace("#", "").trim();
  let r = 255;
  let g = 255;
  let b = 255;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const stroke = luminance > 0.6 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)";
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, Math.round(fontSize / 8));

  const lines = text.split(/\r?\n/);
  const lineHeight = Math.round(fontSize * 1.3);
  const x = stageX;
  let y = stageY;
  for (const line of lines) {
    ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
    y += lineHeight;
  }

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), imageData.mime || "image/png");
  });
  const data = await blob.arrayBuffer();
  return { mime: imageData.mime, data };
}
