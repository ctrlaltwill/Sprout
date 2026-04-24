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
export function clampRectPx(r, maxW, maxH, min = 1) {
    const x = Math.max(0, Math.min(r.x, maxW - min));
    const y = Math.max(0, Math.min(r.y, maxH - min));
    const w = Math.max(min, Math.min(r.w, maxW - x));
    const h = Math.max(min, Math.min(r.h, maxH - y));
    return { x, y, w, h };
}
export function normToPxRect(norm, stageW, stageH) {
    return {
        x: norm.x * stageW,
        y: norm.y * stageH,
        w: norm.w * stageW,
        h: norm.h * stageH,
    };
}
export function pxToNormRect(rectId, px, stageW, stageH, groupKey) {
    return {
        rectId,
        x: px.x / stageW,
        y: px.y / stageH,
        w: px.w / stageW,
        h: px.h / stageH,
        groupKey,
    };
}
export function rectPxFromPoints(p1, p2) {
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    return { x, y, w, h };
}
