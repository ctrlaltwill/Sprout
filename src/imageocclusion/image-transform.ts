// ImageTransform.ts - image stage transform helpers

export type StageTransform = { scale: number; tx: number; ty: number };

/**
 * Applies a transform (scale, translate) to a stage element.
 */
export function applyStageTransform(el: HTMLElement, t: StageTransform) {
  el.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;
}

/**
 * Converts client (screen) coordinates to stage (image) coordinates.
 */
export function clientToStage(
  viewportEl: HTMLElement,
  t: StageTransform,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = viewportEl.getBoundingClientRect();
  const x = (clientX - rect.left - t.tx) / t.scale;
  const y = (clientY - rect.top - t.ty) / t.scale;
  return { x, y };
}

/**
 * Zooms at a given point (cx, cy) in client coordinates.
 */
export function zoomAt(
  viewportEl: HTMLElement,
  t: StageTransform,
  factor: number,
  cx: number,
  cy: number,
  minScale = 0.05,
  maxScale = 8,
): StageTransform {
  const rect = viewportEl.getBoundingClientRect();
  const px = cx - rect.left;
  const py = cy - rect.top;

  const scale = Math.max(minScale, Math.min(maxScale, t.scale * factor));
  const tx = px - (px - t.tx) * (scale / t.scale);
  const ty = py - (py - t.ty) * (scale / t.scale);

  return { scale, tx, ty };
}
