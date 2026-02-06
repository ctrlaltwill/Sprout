// Geometry helpers for image occlusion

export type RectPx = { x: number; y: number; w: number; h: number };

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
): any {
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
