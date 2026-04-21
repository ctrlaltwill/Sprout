/**
 * @file src/imageocclusion/io-ocr.ts
 * @summary OCR-powered auto-mask detection for Image Occlusion. Uses Tesseract.js to detect
 * text boxes, groups words into lines, vertically merges adjacent lines, filters noisy
 * detections, and returns normalised IORect masks ready for the IO editor overlay.
 *
 * @exports
 *   - AutoMaskOptions — options controlling OCR and post-processing behaviour
 *   - autoDetectTextMasks — detect and return IO masks from image text regions
 */

import type { ClipboardImage, IORect } from "./io-types";

export type OcrTextRegion = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AutoMaskOptions = {
  stageW: number;
  stageH: number;
  existingRects?: readonly IORect[];
  startGroupNumber?: number;
  language?: string;
  minConfidence?: number;
  minAreaPercent?: number;
  verticalMergeFactor?: number;
  maskBufferPx?: number;
};

type PxRect = { x: number; y: number; w: number; h: number };
type OcrWord = PxRect & { confidence: number; text: string };
type OcrRegion = PxRect & { confidence: number; text: string };

type RecognizeFn = (
  image: Blob | HTMLImageElement | HTMLCanvasElement,
  lang: string,
  options: Record<string, unknown>,
) => Promise<{
  data?: {
    words?: Array<{
      text?: string;
      confidence?: number;
      bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
    }>;
  };
}>;

const DEFAULT_MIN_CONFIDENCE = 48;
const DEFAULT_MIN_AREA_PERCENT = 0.00008;
const DEFAULT_VERTICAL_MERGE_FACTOR = 0.65;
const DEFAULT_MASK_BUFFER_PX = 4;

function normalizeChannelValue(value: number, minLum: number, maxLum: number): number {
  const denom = Math.max(1, maxLum - minLum);
  const t = (value - minLum) / denom;
  return Math.max(0, Math.min(255, Math.round(t * 255)));
}

function preprocessRgbaInPlace(data: Uint8ClampedArray): void {
  if (!data.length) return;

  const luma: number[] = [];
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Perceptual grayscale to stabilise OCR across colored diagram labels.
    luma[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  const sorted = [...luma].sort((a, b) => a - b);
  const lowIdx = Math.floor(sorted.length * 0.02);
  const highIdx = Math.floor(sorted.length * 0.98);
  const minLum = sorted[Math.max(0, Math.min(sorted.length - 1, lowIdx))] ?? 0;
  const maxLum = sorted[Math.max(0, Math.min(sorted.length - 1, highIdx))] ?? 255;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const norm = normalizeChannelValue(luma[p], minLum, maxLum);
    const boosted = norm <= 64 ? 0 : norm >= 220 ? 255 : norm;
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
}

async function preprocessForOcr(imageData: ClipboardImage): Promise<Blob | HTMLCanvasElement> {
  const blob = new Blob([imageData.data], { type: imageData.mime || "image/png" });

  if (typeof document === "undefined") {
    return blob;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return blob;

  const drawFromImageBitmap = async (): Promise<boolean> => {
    if (typeof createImageBitmap !== "function") return false;
    const bitmap = await createImageBitmap(blob);
    try {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      return true;
    } finally {
      bitmap.close();
    }
  };

  const drawFromImageElement = async (): Promise<boolean> => {
    if (typeof Image === "undefined") return false;

    const image = new Image();
    const imageUrl = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Failed to decode image for OCR preprocessing."));
        image.src = imageUrl;
      });
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      if (canvas.width < 1 || canvas.height < 1) return false;
      ctx.drawImage(image, 0, 0);
      return true;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  try {
    let drawn = false;
    try {
      drawn = await drawFromImageBitmap();
    } catch {
      drawn = false;
    }

    if (!drawn) {
      drawn = await drawFromImageElement();
    }

    if (!drawn || canvas.width < 1 || canvas.height < 1) {
      return blob;
    }

    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    preprocessRgbaInPlace(frame.data);
    ctx.putImageData(frame, 0, 0);
    return canvas;
  } catch {
    return blob;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rectArea(r: PxRect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

function toPxRectFromWord(raw: {
  text?: string;
  confidence?: number;
  bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
}): OcrWord | null {
  const text = String(raw.text || "").trim();
  if (!text) return null;

  const conf = Number(raw.confidence ?? 0);
  const x0 = Number(raw.bbox?.x0 ?? 0);
  const y0 = Number(raw.bbox?.y0 ?? 0);
  const x1 = Number(raw.bbox?.x1 ?? 0);
  const y1 = Number(raw.bbox?.y1 ?? 0);

  if (![x0, y0, x1, y1].every((n) => Number.isFinite(n))) return null;

  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.max(0, Math.abs(x1 - x0));
  const h = Math.max(0, Math.abs(y1 - y0));
  if (w < 2 || h < 2) return null;

  return { text, confidence: conf, x, y, w, h };
}

function lineMerge(words: OcrWord[]): PxRect[] {
  return lineMergeWithText(words).map(({ x, y, w, h }) => ({ x, y, w, h }));
}

function lineMergeWithText(words: OcrWord[]): OcrRegion[] {
  if (!words.length) return [];

  const sorted = [...words].sort((a, b) => {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    if (Math.abs(ay - by) > 0.001) return ay - by;
    return a.x - b.x;
  });

  const medianHeight = [...sorted].map((w) => w.h).sort((a, b) => a - b)[Math.floor(sorted.length / 2)] || 12;
  const lineThreshold = Math.max(6, medianHeight * 0.6);

  const lines: OcrWord[][] = [];
  for (const word of sorted) {
    const cy = word.y + word.h / 2;
    const target = lines.find((line) => {
      if (!line.length) return false;
      const avgCy = line.reduce((sum, w) => sum + (w.y + w.h / 2), 0) / line.length;
      return Math.abs(cy - avgCy) <= lineThreshold;
    });
    if (target) target.push(word);
    else lines.push([word]);
  }

  return lines
    .map((line) => {
      const sortedLine = [...line].sort((a, b) => a.x - b.x);
      const minX = Math.min(...sortedLine.map((w) => w.x));
      const minY = Math.min(...sortedLine.map((w) => w.y));
      const maxX = Math.max(...sortedLine.map((w) => w.x + w.w));
      const maxY = Math.max(...sortedLine.map((w) => w.y + w.h));
      const confidence = sortedLine.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, sortedLine.length);
      const text = sortedLine.map((word) => word.text.trim()).filter(Boolean).join(" ").trim();
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, text, confidence };
    })
    .filter((r) => r.w >= 4 && r.h >= 4 && !!r.text);
}

function verticalMerge(rects: PxRect[], factor: number): PxRect[] {
  return verticalMergeWithText(
    rects.map((rect) => ({ ...rect, text: "", confidence: 0 })),
    factor,
  ).map(({ x, y, w, h }) => ({ x, y, w, h }));
}

function shouldVerticallyMergeOcrRegions(a: OcrRegion, b: OcrRegion, factor: number): boolean {
  const horizontalOverlap = Math.max(
    0,
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
  );
  const minWidth = Math.min(a.w, b.w);
  const hasHorizontalTie = minWidth > 0 && horizontalOverlap / minWidth >= 0.2;

  const gap = b.y - (a.y + a.h);
  const mergeGap = Math.max(2, Math.min(a.h, b.h) * factor);
  if (!hasHorizontalTie || gap > mergeGap) return false;

  const centerA = a.x + a.w / 2;
  const centerB = b.x + b.w / 2;
  const centerDelta = Math.abs(centerA - centerB);
  const maxWidth = Math.max(a.w, b.w);
  const centerAligned = centerDelta <= Math.max(12, maxWidth * 0.28);
  if (!centerAligned) return false;

  const mergedWidth = Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x);
  const widthExpansionOk = mergedWidth <= maxWidth * 1.35;
  return widthExpansionOk;
}

function verticalMergeWithText(rects: OcrRegion[], factor: number): OcrRegion[] {
  if (rects.length < 2) return rects;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: OcrRegion[] = [];

  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...current });
      continue;
    }

    if (shouldVerticallyMergeOcrRegions(last, current, factor)) {
      const x = Math.min(last.x, current.x);
      const y = Math.min(last.y, current.y);
      const maxX = Math.max(last.x + last.w, current.x + current.w);
      const maxY = Math.max(last.y + last.h, current.y + current.h);
      const ordered = [last, current].sort((a, b) => a.y - b.y || a.x - b.x);
      last.x = x;
      last.y = y;
      last.w = maxX - x;
      last.h = maxY - y;
      last.text = ordered.map((item) => item.text.trim()).filter(Boolean).join(" ").trim();
      last.confidence = Math.max(last.confidence, current.confidence);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function toNormalizedTextRegion(rect: OcrRegion, stageW: number, stageH: number): OcrTextRegion {
  return {
    text: rect.text,
    confidence: rect.confidence,
    x: clamp01(rect.x / stageW),
    y: clamp01(rect.y / stageH),
    w: clamp01(rect.w / stageW),
    h: clamp01(rect.h / stageH),
  };
}

function toNormRect(rect: PxRect, stageW: number, stageH: number, rectId: string, groupKey: string): IORect {
  return {
    rectId,
    normX: clamp01(rect.x / stageW),
    normY: clamp01(rect.y / stageH),
    normW: clamp01(rect.w / stageW),
    normH: clamp01(rect.h / stageH),
    groupKey,
    shape: "rect",
  };
}

function iou(a: PxRect, b: PxRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  if (!inter) return 0;
  const union = rectArea(a) + rectArea(b) - inter;
  if (!union) return 0;
  return inter / union;
}

function normToPxRect(rect: IORect, stageW: number, stageH: number): PxRect {
  return {
    x: rect.normX * stageW,
    y: rect.normY * stageH,
    w: rect.normW * stageW,
    h: rect.normH * stageH,
  };
}

function expandRect(rect: PxRect, bufferPx: number, stageW: number, stageH: number): PxRect {
  const safeBuffer = Math.max(0, Number(bufferPx) || 0);
  const x = Math.max(0, rect.x - safeBuffer);
  const y = Math.max(0, rect.y - safeBuffer);
  const maxX = Math.min(stageW, rect.x + rect.w + safeBuffer);
  const maxY = Math.min(stageH, rect.y + rect.h + safeBuffer);

  return {
    x,
    y,
    w: Math.max(0, maxX - x),
    h: Math.max(0, maxY - y),
  };
}

export const __test = {
  toPxRectFromWord,
  lineMerge,
  lineMergeWithText,
  verticalMerge,
  verticalMergeWithText,
  shouldVerticallyMergeOcrRegions,
  iou,
  expandRect,
  preprocessRgbaInPlace,
};

async function collectOcrTextRegions(imageData: ClipboardImage, opts: AutoMaskOptions): Promise<OcrRegion[]> {
  const stageW = Math.max(1, Number(opts.stageW || 1));
  const stageH = Math.max(1, Number(opts.stageH || 1));
  const imageArea = stageW * stageH;

  const minConfidence = Number.isFinite(opts.minConfidence) ? Number(opts.minConfidence) : DEFAULT_MIN_CONFIDENCE;
  const minAreaPercent = Number.isFinite(opts.minAreaPercent) ? Number(opts.minAreaPercent) : DEFAULT_MIN_AREA_PERCENT;
  const verticalMergeFactor = Number.isFinite(opts.verticalMergeFactor)
    ? Number(opts.verticalMergeFactor)
    : DEFAULT_VERTICAL_MERGE_FACTOR;
  const maskBufferPx = Number.isFinite(opts.maskBufferPx) ? Number(opts.maskBufferPx) : DEFAULT_MASK_BUFFER_PX;
  const language = String(opts.language || "eng").trim() || "eng";

  const words = await runTesseractWords(imageData, language);
  const filteredWords = words.filter((w) => {
    if (w.confidence < minConfidence) return false;
    const areaPct = rectArea(w) / imageArea;
    return areaPct >= minAreaPercent;
  });

  if (!filteredWords.length) return [];

  const lineRects = lineMergeWithText(filteredWords);
  const mergedRects = verticalMergeWithText(lineRects, Math.max(0, verticalMergeFactor));

  return mergedRects
    .map((rect) => {
      const buffered = expandRect(rect, maskBufferPx, stageW, stageH);
      return {
        ...buffered,
        text: rect.text,
        confidence: rect.confidence,
      };
    })
    .filter((rect) => {
      if (rect.w < 5 || rect.h < 5) return false;
      const areaPct = rectArea(rect) / imageArea;
      return areaPct >= minAreaPercent && !!String(rect.text || "").trim();
    });
}

export async function detectOcrTextRegions(imageData: ClipboardImage, opts: AutoMaskOptions): Promise<OcrTextRegion[]> {
  const stageW = Math.max(1, Number(opts.stageW || 1));
  const stageH = Math.max(1, Number(opts.stageH || 1));
  const regions = await collectOcrTextRegions(imageData, opts);
  return regions.map((rect) => toNormalizedTextRegion(rect, stageW, stageH));
}

async function runTesseractWords(imageData: ClipboardImage, lang: string): Promise<OcrWord[]> {
  const hasWorkerSupport = typeof Worker !== "undefined";
  if (!hasWorkerSupport) {
    throw new Error("Auto-detect requires Web Worker support on this platform.");
  }

  // Use the browser build so Obsidian renderer runtime does not resolve node worker_threads.
  const tesseract = (await import("tesseract.js/dist/tesseract.esm.min.js")) as {
    default?: { recognize?: RecognizeFn };
    recognize?: RecognizeFn;
  };
  const recognize = tesseract.recognize || tesseract.default?.recognize;
  if (typeof recognize !== "function") {
    throw new Error("OCR engine could not be initialized.");
  }

  const preprocessedInput = await preprocessForOcr(imageData);
  const result = await recognize(preprocessedInput, lang || "eng", {
    tessedit_pageseg_mode: "12",
  });

  const words = Array.isArray(result?.data?.words) ? result.data.words : [];
  return words
    .map((w) => toPxRectFromWord(w))
    .filter((w): w is OcrWord => !!w);
}

export async function autoDetectTextMasks(imageData: ClipboardImage, opts: AutoMaskOptions): Promise<IORect[]> {
  const stageW = Math.max(1, Number(opts.stageW || 1));
  const stageH = Math.max(1, Number(opts.stageH || 1));
  const mergedRects = await collectOcrTextRegions(imageData, opts);

  const existingPx = (opts.existingRects || []).map((r) => normToPxRect(r, stageW, stageH));
  const accepted: PxRect[] = [];

  for (const rect of mergedRects) {
    const collidesExisting = existingPx.some((existing) => iou(existing, rect) >= 0.5);
    if (collidesExisting) continue;

    const collidesAccepted = accepted.some((existing) => iou(existing, rect) >= 0.5);
    if (collidesAccepted) continue;

    accepted.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  }

  const startGroup = Math.max(1, Number(opts.startGroupNumber ?? 1));
  return accepted.map((rect, i) => {
    const group = String(startGroup + i);
    const rectId = `rect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return toNormRect(rect, stageW, stageH, rectId, group);
  });
}
