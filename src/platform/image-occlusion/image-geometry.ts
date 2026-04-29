/**
 * @file src/imageocclusion/image-geometry.ts
 * @summary Geometry helper types and functions for the Image Occlusion system. Provides pixel and normalised rectangle types, conversion between normalised (0–1) and pixel coordinate spaces, rectangle clamping to image bounds, and construction of axis-aligned rectangles from two corner points.
 *
 * @exports
 *   - RectPx — type representing a rectangle in pixel coordinates (x, y, w, h)
 *   - NormRect — type representing a normalised rectangle with rectId and groupKey
 *   - clampRectPx — clamps a pixel rectangle to fit within image dimensions
 *   - normToPxRect — converts a normalised rect to pixel coordinates given stage size
 *   - pxToNormRect — converts a pixel rect to normalised coordinates given stage size
 *   - rectPxFromPoints — builds an axis-aligned pixel rectangle from two corner points
 */

// Geometry helpers for image occlusion

export type RectPx = { x: number; y: number; w: number; h: number };
export type NormPoint = { x: number; y: number };

export type NormRect = {
  rectId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  groupKey: string;
};

export function clampRectPx(
  r: RectPx,
  maxW: number,
  maxH: number,
  min: number = 1
): RectPx {
  const x = Math.max(0, Math.min(r.x, maxW - min));
  const y = Math.max(0, Math.min(r.y, maxH - min));
  const w = Math.max(min, Math.min(r.w, maxW - x));
  const h = Math.max(min, Math.min(r.h, maxH - y));
  return { x, y, w, h };
}

export function normToPxRect(
  norm: { x: number; y: number; w: number; h: number },
  stageW: number,
  stageH: number
): RectPx {
  return {
    x: norm.x * stageW,
    y: norm.y * stageH,
    w: norm.w * stageW,
    h: norm.h * stageH,
  };
}

export function pxToNormRect(
  rectId: string,
  px: RectPx,
  stageW: number,
  stageH: number,
  groupKey: string
): NormRect {
  return {
    rectId,
    x: px.x / stageW,
    y: px.y / stageH,
    w: px.w / stageW,
    h: px.h / stageH,
    groupKey,
  };
}

export function rectPxFromPoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): RectPx {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  return { x, y, w, h };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function polygonClipPath(points: NormPoint[] | null | undefined): string {
  if (!Array.isArray(points) || points.length < 3) return "";
  return `polygon(${points.map((point) => `${clampUnit(point.x) * 100}% ${clampUnit(point.y) * 100}%`).join(", ")})`;
}

export function pointInPolygon(point: NormPoint, polygon: NormPoint[] | null | undefined): boolean {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.x ?? 0);
    const yi = Number(polygon[i]?.y ?? 0);
    const xj = Number(polygon[j]?.x ?? 0);
    const yj = Number(polygon[j]?.y ?? 0);
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) inside = !inside;
  }

  return inside;
}
