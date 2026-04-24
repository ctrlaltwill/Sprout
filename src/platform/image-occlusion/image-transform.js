/**
 * @file src/imageocclusion/image-transform.ts
 * @summary Provides helper functions for manipulating the stage transform (pan, zoom, coordinate conversion) used in the Image Occlusion canvas editor. Converts between client (screen) and stage (image) coordinate spaces, applies CSS transforms to the stage element, and computes zoom-at-point transforms with clamping.
 *
 * @exports
 *   - StageTransform — re-exported type describing scale and translation state
 *   - applyStageTransform — applies a scale+translate CSS transform to a stage element
 *   - clientToStage — converts client (screen) coordinates to stage (image) coordinates
 *   - zoomAt — computes a new StageTransform after zooming at a given client-space point
 */
import { setCssProps } from "../../platform/core/ui";
/**
 * Applies a transform (scale, translate) to a stage element.
 */
export function applyStageTransform(el, t) {
    el.classList.add("learnkit-stage-transform", "learnkit-stage-transform");
    setCssProps(el, "--learnkit-stage-transform", `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`);
}
/**
 * Converts client (screen) coordinates to stage (image) coordinates.
 */
export function clientToStage(stageEl, _t, clientX, clientY) {
    const rect = stageEl.getBoundingClientRect();
    const renderedW = Math.max(1, rect.width);
    const renderedH = Math.max(1, rect.height);
    const baseW = Math.max(1, stageEl.offsetWidth || 1);
    const baseH = Math.max(1, stageEl.offsetHeight || 1);
    const x = ((clientX - rect.left) / renderedW) * baseW;
    const y = ((clientY - rect.top) / renderedH) * baseH;
    return { x, y };
}
/**
 * Zooms at a given point (cx, cy) in client coordinates.
 */
export function zoomAt(viewportEl, t, factor, cx, cy, minScale = 0.05, maxScale = 8) {
    const rect = viewportEl.getBoundingClientRect();
    const px = cx - rect.left;
    const py = cy - rect.top;
    const scale = Math.max(minScale, Math.min(maxScale, t.scale * factor));
    const tx = px - (px - t.tx) * (scale / t.scale);
    const ty = py - (py - t.ty) * (scale / t.scale);
    return { scale, tx, ty };
}
