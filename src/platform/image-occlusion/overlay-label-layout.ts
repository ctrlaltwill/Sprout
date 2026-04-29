function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampUnit(value: number): number {
  return clampNumber(value, 0, 1);
}

function readPercentStyle(value: string): number {
  const percent = Number.parseFloat(String(value || "").replace("%", ""));
  return Number.isFinite(percent) ? clampUnit(percent / 100) : 0.5;
}

function readLayoutDimension(
  element: HTMLElement,
  axis: "width" | "height",
  transformedRectValue: number,
): number {
  const client = axis === "width" ? element.clientWidth : element.clientHeight;
  if (client > 0) return client;
  const offset = axis === "width" ? element.offsetWidth : element.offsetHeight;
  if (offset > 0) return offset;
  return transformedRectValue;
}

export type AnchoredLabelCollisionOptions = {
  selector?: string;
  draggingClass?: string;
  anchorXDataKey?: string;
  anchorYDataKey?: string;
  edgeMarginPx?: number;
  marginPx?: number;
  maxShiftPx?: number;
  maxIterations?: number;
};

export function resolveAnchoredLabelCollisions(
  overlay: HTMLElement,
  options: AnchoredLabelCollisionOptions = {},
): void {
  const selector = options.selector ?? ".learnkit-hq-attempt-label";
  const draggingClass = options.draggingClass ?? "is-dragging";
  const anchorXDataKey = options.anchorXDataKey ?? "hotspotAnchorX";
  const anchorYDataKey = options.anchorYDataKey ?? "hotspotAnchorY";
  const edgeMarginPx = Math.max(0, Number.isFinite(options.edgeMarginPx) ? Number(options.edgeMarginPx) : 0);
  const marginPx = Number.isFinite(options.marginPx) ? Number(options.marginPx) : 1;
  const maxShiftPx = Number.isFinite(options.maxShiftPx) ? Number(options.maxShiftPx) : 10;
  const maxIterations = Number.isFinite(options.maxIterations) ? Number(options.maxIterations) : 8;

  const labels = Array.from(overlay.querySelectorAll<HTMLElement>(selector)).filter(
    (label) => !draggingClass || !label.classList.contains(draggingClass),
  );
  if (labels.length === 0) return;

  const overlayRect = overlay.getBoundingClientRect();
  const overlayWidth = readLayoutDimension(overlay, "width", overlayRect.width);
  const overlayHeight = readLayoutDimension(overlay, "height", overlayRect.height);
  if (overlayWidth <= 0 || overlayHeight <= 0) return;

  type LabelState = {
    label: HTMLElement;
    x: number;
    y: number;
    w: number;
    h: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };

  const states: LabelState[] = labels.map((label) => {
    const rect = label.getBoundingClientRect();
    const width = Math.max(1, readLayoutDimension(label, "width", rect.width));
    const height = Math.max(1, readLayoutDimension(label, "height", rect.height));

    const rawAnchorX = Number(label.dataset[anchorXDataKey]);
    const rawAnchorY = Number(label.dataset[anchorYDataKey]);
    const anchorX = Number.isFinite(rawAnchorX)
      ? clampUnit(rawAnchorX) * overlayWidth
      : readPercentStyle(label.style.left) * overlayWidth;
    const anchorY = Number.isFinite(rawAnchorY)
      ? clampUnit(rawAnchorY) * overlayHeight
      : readPercentStyle(label.style.top) * overlayHeight;

    const halfW = width / 2;
    const halfH = height / 2;

    let minBoundX = edgeMarginPx + halfW;
    let maxBoundX = overlayWidth - edgeMarginPx - halfW;
    if (minBoundX > maxBoundX) {
      minBoundX = halfW;
      maxBoundX = overlayWidth - halfW;
    }
    if (minBoundX > maxBoundX) {
      const center = overlayWidth / 2;
      minBoundX = center;
      maxBoundX = center;
    }

    let minBoundY = edgeMarginPx + halfH;
    let maxBoundY = overlayHeight - edgeMarginPx - halfH;
    if (minBoundY > maxBoundY) {
      minBoundY = halfH;
      maxBoundY = overlayHeight - halfH;
    }
    if (minBoundY > maxBoundY) {
      const center = overlayHeight / 2;
      minBoundY = center;
      maxBoundY = center;
    }

    const minX = Math.max(minBoundX, anchorX - maxShiftPx);
    const maxX = Math.min(maxBoundX, anchorX + maxShiftPx);
    const minY = Math.max(minBoundY, anchorY - maxShiftPx);
    const maxY = Math.min(maxBoundY, anchorY + maxShiftPx);

    return {
      label,
      x: clampNumber(anchorX, minX, maxX),
      y: clampNumber(anchorY, minY, maxY),
      w: width,
      h: height,
      minX,
      maxX,
      minY,
      maxY,
    };
  });

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (let i = 0; i < states.length; i += 1) {
      const a = states[i];
      for (let j = i + 1; j < states.length; j += 1) {
        const b = states[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const minDx = (a.w + b.w) / 2 + marginPx;
        const minDy = (a.h + b.h) / 2 + marginPx;
        const overlapX = minDx - Math.abs(dx);
        const overlapY = minDy - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        let shiftAX = 0;
        let shiftAY = 0;
        let shiftBX = 0;
        let shiftBY = 0;
        if (overlapX <= overlapY) {
          const dir = dx >= 0 ? 1 : -1;
          const shift = overlapX / 2;
          shiftAX = dir * shift;
          shiftBX = -dir * shift;
        } else {
          const dir = dy >= 0 ? 1 : -1;
          const shift = overlapY / 2;
          shiftAY = dir * shift;
          shiftBY = -dir * shift;
        }

        const nextAX = clampNumber(a.x + shiftAX, a.minX, a.maxX);
        const nextAY = clampNumber(a.y + shiftAY, a.minY, a.maxY);
        const nextBX = clampNumber(b.x + shiftBX, b.minX, b.maxX);
        const nextBY = clampNumber(b.y + shiftBY, b.minY, b.maxY);

        if (nextAX !== a.x || nextAY !== a.y || nextBX !== b.x || nextBY !== b.y) {
          a.x = nextAX;
          a.y = nextAY;
          b.x = nextBX;
          b.y = nextBY;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  states.forEach((state) => {
    state.label.style.left = `${(state.x / overlayWidth) * 100}%`;
    state.label.style.top = `${(state.y / overlayHeight) * 100}%`;
  });
}