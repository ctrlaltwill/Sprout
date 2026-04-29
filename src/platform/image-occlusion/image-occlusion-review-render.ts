/**
 * @file src/imageocclusion/image-occlusion-review-render.ts
 * @summary Renders the Image Occlusion review overlay shown during study sessions and in the home widget. Produces a masked image with coloured occlusion rectangles, handles reveal state, supports zoom-in modals for both the review session and widget contexts, and manages overlay sizing synchronisation with the underlying image element.
 *
 * @exports
 *   - isIoParentCard — checks whether a CardRecord is an IO parent card
 *   - isIoRevealableType — checks whether a CardRecord is an IO or IO-child card eligible for reveal
 *   - renderImageOcclusionReviewInto — renders the masked IO image into a container element
 */

import { type App, Modal, setIcon } from "obsidian";
import type LearnKitPlugin from "../../main";
import type { CardRecord } from "../../platform/types/card";
import type { StoredIORect } from "./image-occlusion-types";
import { pointInPolygon } from "./image-geometry";
import { resolveAnchoredLabelCollisions } from "./overlay-label-layout";
import { resolveImageFile } from "./io-helpers";
import type * as IoModule from "./image-occlusion-index";
import { queryFirst, setCssProps } from "../../platform/core/ui";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import { t } from "../../platform/translations/translator";

const SVG_NS = "http://www.w3.org/2000/svg";
const POLYGON_STROKE_PAD = 1;
const POLYGON_VIEWBOX_SIZE = 100 + POLYGON_STROKE_PAD * 2;

function polygonCoordForStroke(value: number): number {
  const v = clampUnit(Number(value));
  return v * POLYGON_VIEWBOX_SIZE - POLYGON_STROKE_PAD;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type HotspotAttemptResult = {
  mode: "click" | "drag-drop";
  x: number;
  y: number;
  correct: boolean;
  label?: string;
  removed?: boolean;
};

type HotspotTargetGroup = {
  key: string;
  label: string;
};

type HotspotReviewOptions = {
  attempt?: HotspotAttemptResult | null;
  attempts?: HotspotAttemptResult[] | null;
  onAttempt?: (attempt: HotspotAttemptResult) => void;
  showDropLocationHint?: boolean;
};

type ImagePoint = {
  x: number;
  y: number;
  inside: boolean;
};

function resolveHotspotInteractionMode(rawMode: string, hotspotCount: number): "click" | "drag-drop" {
  const mode = String(rawMode || "").trim().toLowerCase();
  if (mode === "individual" || mode === "click") return "click";
  if (mode === "all" || mode === "drag-drop") return "drag-drop";
  return hotspotCount > 1 ? "drag-drop" : "click";
}

function clampUnit(value: number): number {
  return clampNumber(value, 0, 1);
}

function getImagePoint(img: HTMLImageElement, clientX: number, clientY: number): ImagePoint | null {
  const rect = img.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const rawX = (clientX - rect.left) / rect.width;
  const rawY = (clientY - rect.top) / rect.height;
  return {
    x: clampUnit(rawX),
    y: clampUnit(rawY),
    inside: rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1,
  };
}

function pointHitsRect(
  point: ImagePoint,
  rect: StoredIORect,
  options?: { strict?: boolean },
): boolean {
  const x = Number(rect.x ?? 0);
  const y = Number(rect.y ?? 0);
  const w = Math.max(0, Number(rect.w ?? 0));
  const h = Math.max(0, Number(rect.h ?? 0));
  const strict = options?.strict === true;
  const padX = strict ? 0 : Math.min(0.035, Math.max(0.012, w * 0.18));
  const padY = strict ? 0 : Math.min(0.035, Math.max(0.012, h * 0.18));

  if (rect.shape === "polygon" && Array.isArray(rect.points) && rect.points.length >= 3) {
    const relX = w > 0 ? (point.x - x) / w : 0;
    const relY = h > 0 ? (point.y - y) / h : 0;
    return pointInPolygon({ x: relX, y: relY }, rect.points as Array<{ x: number; y: number }>);
  }

  if (rect.shape === "circle") {
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const radiusX = Math.max(0.0001, w / 2 + padX);
    const radiusY = Math.max(0.0001, h / 2 + padY);
    const dx = (point.x - centerX) / radiusX;
    const dy = (point.y - centerY) / radiusY;
    return dx * dx + dy * dy <= 1;
  }

  return point.x >= x - padX && point.x <= x + w + padX && point.y >= y - padY && point.y <= y + h + padY;
}

function findMatchingHotspot(
  point: ImagePoint,
  rects: StoredIORect[],
  options?: { strict?: boolean },
): StoredIORect | null {
  for (const rect of rects) {
    if (pointHitsRect(point, rect, options)) return rect;
  }
  return null;
}

function getHotspotRectKey(rect: StoredIORect, fallbackIndex: number): string {
  const base = String(rect.groupKey || rect.label || rect.rectId || `hotspot-${fallbackIndex + 1}`).trim();
  return base || `hotspot-${fallbackIndex + 1}`;
}

function getHotspotRectLabel(rect: StoredIORect, fallbackIndex: number): string {
  const label = String(rect.label || rect.groupKey || `Hotspot ${fallbackIndex + 1}`).trim();
  return label || `Hotspot ${fallbackIndex + 1}`;
}

function normalizeHotspotTargetKey(value: unknown): string {
  let stringValue: string;
  if (typeof value === 'string') {
    stringValue = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    stringValue = String(value);
  } else {
    stringValue = "";
  }
  return stringValue
    .replace(/\.+$/, "")
    .trim()
    .toLowerCase();
}

function collectHotspotTargetGroups(rects: StoredIORect[]): HotspotTargetGroup[] {
  const out: HotspotTargetGroup[] = [];
  const seen = new Set<string>();
  rects.forEach((rect, index) => {
    const key = getHotspotRectKey(rect, index);
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ key, label: getHotspotRectLabel(rect, index) });
  });
  return out;
}

function getHotspotRectCenter(rect: StoredIORect): { x: number; y: number } {
  const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
  const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
  const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
  const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;
  return {
    x: clampUnit(x + w / 2),
    y: clampUnit(y + h / 2),
  };
}

function findHotspotRectForAttempt(attempt: HotspotAttemptResult, rects: StoredIORect[]): StoredIORect | null {
  if (!Array.isArray(rects) || rects.length === 0) return null;

  const point: ImagePoint = {
    x: clampUnit(attempt.x),
    y: clampUnit(attempt.y),
    inside: true,
  };
  const byPoint = findMatchingHotspot(point, rects, { strict: true });
  if (attempt.mode === "drag-drop") {
    // For drag-drop, preserve exactly where the user dropped.
    return byPoint;
  }

  if (byPoint) return byPoint;

  const attemptLabel = String(attempt.label || "").trim().toLowerCase();
  if (attemptLabel) {
    const byLabel = rects.find((rect, index) => {
      const key = getHotspotRectKey(rect, index).trim().toLowerCase();
      const label = getHotspotRectLabel(rect, index).trim().toLowerCase();
      return attemptLabel === key || attemptLabel === label;
    });
    if (byLabel) return byLabel;
  }

  return null;
}

function findHotspotAttemptForRect(
  rect: StoredIORect,
  rectIndex: number,
  attempts: HotspotAttemptResult[],
): HotspotAttemptResult | null {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;

  const rectKey = getHotspotRectKey(rect, rectIndex).trim().toLowerCase();
  const rectLabel = getHotspotRectLabel(rect, rectIndex).trim().toLowerCase();

  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const attempt = attempts[i];
    if (!attempt || attempt.removed) continue;

    const point: ImagePoint = {
      x: clampUnit(Number(attempt.x)),
      y: clampUnit(Number(attempt.y)),
      inside: true,
    };
    const hitByPoint = pointHitsRect(point, rect, { strict: true });
    if (attempt.mode === "drag-drop") {
      if (hitByPoint) return attempt;
      continue;
    }

    if (hitByPoint) return attempt;

    const attemptLabel = String(attempt.label || "").trim().toLowerCase();
    if (attemptLabel && (attemptLabel === rectKey || attemptLabel === rectLabel)) {
      return attempt;
    }
  }

  return null;
}

function appendHotspotMarker(overlay: HTMLElement, attempt: HotspotAttemptResult): void {
  const marker = document.createElement("div");
  marker.className = `learnkit-hq-attempt-marker ${attempt.correct ? "is-correct" : "is-incorrect"}`;
  marker.style.left = `${clampUnit(attempt.x) * 100}%`;
  marker.style.top = `${clampUnit(attempt.y) * 100}%`;
  overlay.appendChild(marker);
}

function appendHotspotAttemptLabel(
  overlay: HTMLElement,
  attempt: HotspotAttemptResult,
  anchorRect?: StoredIORect | null,
  opts?: { pending?: boolean; attemptKey?: string; draggable?: boolean },
): HTMLElement | null {
  const label = String(attempt.label || "").trim();
  if (!label) {
    appendHotspotMarker(overlay, attempt);
    return null;
  }

  const anchor = anchorRect ? getHotspotRectCenter(anchorRect) : { x: clampUnit(attempt.x), y: clampUnit(attempt.y) };
  const normalizedKey = normalizeHotspotTargetKey(opts?.attemptKey || label);
  let chip: HTMLElement | null = null;
  if (normalizedKey) {
    overlay.querySelectorAll<HTMLElement>(".learnkit-hq-attempt-label").forEach((el) => {
      if (chip) return;
      if (String(el.dataset.hotspotKey || "").trim().toLowerCase() === normalizedKey) {
        chip = el;
      }
    });
  }

  if (!chip) {
    chip = document.createElement("div");
    overlay.appendChild(chip);
  }

  const pending = !!opts?.pending;
  chip.className = pending
    ? "learnkit-hq-attempt-label is-pending"
    : `learnkit-hq-attempt-label ${attempt.correct ? "is-correct" : "is-incorrect"}`;
  if (pending && opts?.draggable) chip.classList.add("is-draggable");
  chip.dataset.hotspotKey = normalizedKey;
  chip.dataset.hotspotAnchorX = String(anchor.x);
  chip.dataset.hotspotAnchorY = String(anchor.y);
  chip.textContent = label;
  chip.style.left = `${anchor.x * 100}%`;
  chip.style.top = `${anchor.y * 100}%`;
  return chip;
}

function resolveHotspotLabelCollisions(overlay: HTMLElement): void {
  resolveAnchoredLabelCollisions(overlay, {
    selector: ".learnkit-hq-attempt-label",
    draggingClass: "is-dragging",
    anchorXDataKey: "hotspotAnchorX",
    anchorYDataKey: "hotspotAnchorY",
    edgeMarginPx: 2,
    marginPx: 1,
    maxShiftPx: 10,
    maxIterations: 8,
  });
}

function appendPolygonMaskStroke(
  overlay: HTMLElement,
  rect: StoredIORect,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: "target" | "other" | "hq-correct" | "hq-incorrect" | "hint",
): SVGSVGElement | null {
  if (!Array.isArray(rect.points) || rect.points.length < 3) return null;

  const stroke = document.createElementNS(SVG_NS, "svg");
  stroke.classList.add("learnkit-io-mask-polygon-stroke", `is-${tone}`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-x", `${Math.max(0, Math.min(1, x)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-y", `${Math.max(0, Math.min(1, y)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-w", `${Math.max(0, Math.min(1, w)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-h", `${Math.max(0, Math.min(1, h)) * 100}%`);
  stroke.setAttribute("viewBox", `${-POLYGON_STROKE_PAD} ${-POLYGON_STROKE_PAD} ${POLYGON_VIEWBOX_SIZE} ${POLYGON_VIEWBOX_SIZE}`);
  stroke.setAttribute("preserveAspectRatio", "none");

  const polygon = document.createElementNS(SVG_NS, "polygon");
  polygon.setAttribute(
    "points",
    rect.points
      .map((point) => `${polygonCoordForStroke(point.x)},${polygonCoordForStroke(point.y)}`)
      .join(" "),
  );
  if (tone === "hint") {
    polygon.setAttribute("fill", "transparent");
    polygon.setAttribute("stroke", "var(--theme-accent, var(--interactive-accent))");
    polygon.setAttribute("stroke-dasharray", "6 4");
  } else if (tone === "target") {
    polygon.setAttribute("fill", "var(--color-base-70)");
    polygon.setAttribute("stroke", "var(--color-base-100)");
  } else if (tone === "other") {
    polygon.setAttribute("fill", "var(--color-base-20)");
    polygon.setAttribute("stroke", "var(--color-base-30)");
  } else if (tone === "hq-correct") {
    polygon.setAttribute("fill", "rgba(34, 197, 94, 0.18)");
    polygon.setAttribute("stroke", "rgba(34, 197, 94, 0.92)");
  } else {
    polygon.setAttribute("fill", "rgba(239, 68, 68, 0.2)");
    polygon.setAttribute("stroke", "rgba(239, 68, 68, 0.94)");
  }
  stroke.appendChild(polygon);
  overlay.appendChild(stroke as unknown as HTMLElement);
  return stroke;
}

function appendCircleMaskStroke(
  overlay: HTMLElement,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: "target" | "other" | "hq-correct" | "hq-incorrect" | "hint",
): SVGSVGElement {
  const stroke = document.createElementNS(SVG_NS, "svg");
  stroke.classList.add("learnkit-io-mask-circle-stroke", `is-${tone}`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-x", `${Math.max(0, Math.min(1, x)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-y", `${Math.max(0, Math.min(1, y)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-w", `${Math.max(0, Math.min(1, w)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-h", `${Math.max(0, Math.min(1, h)) * 100}%`);
  stroke.setAttribute("viewBox", `${-POLYGON_STROKE_PAD} ${-POLYGON_STROKE_PAD} ${POLYGON_VIEWBOX_SIZE} ${POLYGON_VIEWBOX_SIZE}`);
  stroke.setAttribute("preserveAspectRatio", "none");

  const ellipse = document.createElementNS(SVG_NS, "ellipse");
  ellipse.setAttribute("cx", "50");
  ellipse.setAttribute("cy", "50");
  ellipse.setAttribute("rx", "50");
  ellipse.setAttribute("ry", "50");
  if (tone === "hint") {
    ellipse.setAttribute("fill", "transparent");
    ellipse.setAttribute("stroke", "var(--theme-accent, var(--interactive-accent))");
    ellipse.setAttribute("stroke-dasharray", "6 4");
  } else if (tone === "target") {
    ellipse.setAttribute("fill", "var(--color-base-70)");
    ellipse.setAttribute("stroke", "var(--color-base-100)");
  } else if (tone === "other") {
    ellipse.setAttribute("fill", "var(--color-base-20)");
    ellipse.setAttribute("stroke", "var(--color-base-30)");
  } else if (tone === "hq-correct") {
    ellipse.setAttribute("fill", "rgba(34, 197, 94, 0.18)");
    ellipse.setAttribute("stroke", "rgba(34, 197, 94, 0.92)");
  } else {
    ellipse.setAttribute("fill", "rgba(239, 68, 68, 0.2)");
    ellipse.setAttribute("stroke", "rgba(239, 68, 68, 0.94)");
  }
  stroke.appendChild(ellipse);
  overlay.appendChild(stroke as unknown as HTMLElement);
  return stroke;
}

function appendRectMaskStroke(
  overlay: HTMLElement,
  x: number,
  y: number,
  w: number,
  h: number,
  tone: "target" | "other" | "hq-correct" | "hq-incorrect" | "hint",
): SVGSVGElement {
  const stroke = document.createElementNS(SVG_NS, "svg");
  stroke.classList.add("learnkit-io-mask-rect-stroke", `is-${tone}`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-x", `${Math.max(0, Math.min(1, x)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-y", `${Math.max(0, Math.min(1, y)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-w", `${Math.max(0, Math.min(1, w)) * 100}%`);
  setCssProps(stroke as unknown as HTMLElement, "--learnkit-io-h", `${Math.max(0, Math.min(1, h)) * 100}%`);
  stroke.setAttribute("viewBox", `${-POLYGON_STROKE_PAD} ${-POLYGON_STROKE_PAD} ${POLYGON_VIEWBOX_SIZE} ${POLYGON_VIEWBOX_SIZE}`);
  stroke.setAttribute("preserveAspectRatio", "none");

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", "100");
  rect.setAttribute("height", "100");
  rect.setAttribute("rx", "3");
  rect.setAttribute("ry", "3");
  if (tone === "hint") {
    rect.setAttribute("fill", "transparent");
    rect.setAttribute("stroke", "var(--theme-accent, var(--interactive-accent))");
    rect.setAttribute("stroke-dasharray", "6 4");
  } else if (tone === "target") {
    rect.setAttribute("fill", "var(--color-base-70)");
    rect.setAttribute("stroke", "var(--color-base-100)");
  } else if (tone === "other") {
    rect.setAttribute("fill", "var(--color-base-20)");
    rect.setAttribute("stroke", "var(--color-base-30)");
  } else if (tone === "hq-correct") {
    rect.setAttribute("fill", "rgba(34, 197, 94, 0.18)");
    rect.setAttribute("stroke", "rgba(34, 197, 94, 0.92)");
  } else {
    rect.setAttribute("fill", "rgba(239, 68, 68, 0.2)");
    rect.setAttribute("stroke", "rgba(239, 68, 68, 0.94)");
  }
  stroke.appendChild(rect);
  overlay.appendChild(stroke as unknown as HTMLElement);
  return stroke;
}

function installSmoothZoomInteractions(host: HTMLElement, zoomLayer: HTMLElement) {
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let isDragging = false;
  let pointerId: number | null = null;
  let startClientX = 0;
  let startClientY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  const minScale = 1;
  const absoluteMaxScale = 4;
  let movedSincePointerDown = false;

  const applyTransform = () => {
    const baseWidth = Math.max(1, zoomLayer.offsetWidth);
    const baseHeight = Math.max(1, zoomLayer.offsetHeight);
    const maxViewportWidth = window.innerWidth * 0.95;
    const maxViewportHeight = window.innerHeight * 0.95;
    const maxScaleByViewport = Math.max(
      1,
      Math.min(maxViewportWidth / baseWidth, maxViewportHeight / baseHeight),
    );
    const maxScale = Math.min(absoluteMaxScale, maxScaleByViewport);

    scale = clampNumber(scale, minScale, maxScale);

    if (scale <= 1) {
      offsetX = 0;
      offsetY = 0;
    } else {
      const maxX = Math.max(0, (baseWidth * scale - host.clientWidth) / 2);
      const maxY = Math.max(0, (baseHeight * scale - host.clientHeight) / 2);
      offsetX = clampNumber(offsetX, -maxX, maxX);
      offsetY = clampNumber(offsetY, -maxY, maxY);
    }

    setCssProps(zoomLayer, "--learnkit-zoom-scale", String(scale));
    setCssProps(zoomLayer, "--learnkit-zoom-x", `${offsetX}px`);
    setCssProps(zoomLayer, "--learnkit-zoom-y", `${offsetY}px`);
    host.classList.toggle("is-zoomed", scale > 1);
  };

  host.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const next = Math.max(minScale, scale * factor);
      if (next === scale) return;
      scale = next;
      applyTransform();
    },
    { passive: false },
  );

  zoomLayer.addEventListener("click", (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest(".learnkit-zoom-close")) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (movedSincePointerDown) return;
    const prev = scale;
    const next = scale * 1.5;
    // Apply clamping in applyTransform (includes 95vw/95vh cap).
    scale = next <= 1.001 ? 1.5 : next;
    applyTransform();
    if (scale <= prev + 0.001) {
      // Already at cap -> reset to default on subsequent click.
      scale = 1;
      applyTransform();
    }
  });

  host.addEventListener("pointerdown", (ev: PointerEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest(".learnkit-zoom-close")) return;
    if (ev.button !== 0 || scale <= 1) return;
    movedSincePointerDown = false;
    isDragging = true;
    pointerId = ev.pointerId;
    startClientX = ev.clientX;
    startClientY = ev.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    host.classList.add("is-dragging");
    host.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  host.addEventListener("pointermove", (ev: PointerEvent) => {
    if (!isDragging || pointerId !== ev.pointerId) return;
    movedSincePointerDown = true;
    offsetX = startOffsetX + (ev.clientX - startClientX);
    offsetY = startOffsetY + (ev.clientY - startClientY);
    applyTransform();
    ev.preventDefault();
  });

  const endDrag = (ev: PointerEvent) => {
    if (!isDragging || pointerId !== ev.pointerId) return;
    isDragging = false;
    pointerId = null;
    host.classList.remove("is-dragging");
    if (host.hasPointerCapture(ev.pointerId)) {
      host.releasePointerCapture(ev.pointerId);
    }
  };

  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);

  applyTransform();
}

export function isIoParentCard(card: CardRecord): boolean {
  return card && (card.type === "io" || card.type === "hq");
}

export function isIoRevealableType(card: CardRecord): boolean {
  return card && (card.type === "io" || card.type === "io-child" || card.type === "hq" || card.type === "hq-child");
}

export function renderImageOcclusionReviewInto(args: {
  app: App;
  plugin: LearnKitPlugin;
  containerEl: HTMLElement;
  card: CardRecord;
  sourcePath: string;
  reveal: boolean;
  ioModule: typeof IoModule;
  renderMarkdownInto: (el: HTMLElement, md: string, sp: string) => Promise<void>;
  enableWidgetModal?: boolean;
  hotspotReview?: HotspotReviewOptions;
}) {
  const { app, plugin, containerEl, card, sourcePath, reveal, ioModule } = args;
  const widgetMode = containerEl?.dataset?.sproutIoWidget === "1";
  const enableWidgetModal = args.enableWidgetModal !== false;
  const isHotspot = card.type === "hq" || card.type === "hq-child";
  const hotspotReview = args.hotspotReview;

  // Clear container
  containerEl.replaceChildren();
  containerEl.classList.add("learnkit-io-container", "learnkit-io-container");
  if (widgetMode) {
    containerEl.classList.add("learnkit-io-container--clip", "learnkit-io-container--clip");
  }

  // Get image reference
  const imageRef = String(card.imageRef || "").trim();
  if (!imageRef) {
    const msg = document.createElement("div");
    msg.className = "text-muted-foreground text-sm";
    msg.textContent = "Image occlusion card missing image reference.";
    containerEl.appendChild(msg);
    return;
  }

  // Resolve image file
  const imageFile = resolveImageFile(app, sourcePath, imageRef);
  if (!imageFile) {
    const msg = document.createElement("div");
    msg.className = "text-muted-foreground text-sm";
    msg.textContent = `Image not found: ${imageRef}`;
    containerEl.appendChild(msg);
    return;
  }

  const imageSrc = app.vault.getResourcePath(imageFile);

  // Load IO definition from store
  let occlusions: StoredIORect[] = [];
  const defs = isHotspot ? (plugin.store.data.hq || {}) : (plugin.store.data.io || {});
  const parentId = card.type === "io-child" || card.type === "hq-child" ? String(card.parentId || "") : String(card.id || "");
  const ioDef = parentId ? defs[parentId] : null;

  if (ioDef && Array.isArray(ioDef.rects)) {
    occlusions = ioDef.rects;
  } else if (Array.isArray((card as unknown as Record<string, unknown>).occlusions)) {
    occlusions = (card as unknown as Record<string, unknown>).occlusions as StoredIORect[];
  } else if (Array.isArray((card as unknown as Record<string, unknown>).rects)) {
    occlusions = (card as unknown as Record<string, unknown>).rects as StoredIORect[];
  }

  // For io-child cards, filter to only show the relevant masks
  let masksToShow = occlusions;
  if (card.type === "io-child" || card.type === "hq-child") {
    const groupKey = String(card.groupKey || "");
    const rectIds = Array.isArray(card.rectIds) ? card.rectIds : [];
    
    if (rectIds.length > 0) {
      // Filter by rectIds
      masksToShow = occlusions.filter((r) => rectIds.includes(String(r.rectId || "")));
    } else if (groupKey) {
      // Filter by groupKey
      masksToShow = occlusions.filter((r) => String(r.groupKey || "") === groupKey);
    }
  }

  const host = widgetMode ? containerEl : document.createElement("div");
  if (!widgetMode) {
    host.className = "learnkit-io-host-card";
  }

  const img = document.createElement("img");
  img.src = imageSrc;
  img.alt = card.title || "Card image";
  img.classList.add("learnkit-io-image", "learnkit-io-image");
  // Modal mode: larger image, zoom-out cursor, fit modal
  if (args.enableWidgetModal) {
    img.classList.add("learnkit-io-image-zoomed", "learnkit-io-image-zoomed");
  } else {
    img.classList.add("learnkit-io-image-inline", "learnkit-io-image-inline");
  }
  if (widgetMode) {
    img.classList.add("learnkit-io-image-widget", "learnkit-io-image-widget");
  }
  if (isHotspot) {
    host.classList.add("learnkit-io-no-zoom", "learnkit-io-no-zoom");
    img.classList.add("learnkit-io-no-zoom", "learnkit-io-no-zoom");
  }
  host.appendChild(img);

  // Add masks if not revealed
  const openZoomModal = () => {
    const modal = new (class extends Modal {
      onOpen() {
        scopeModalToWorkspace(this);
        this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "learnkit");
        this.modalEl.addClass("lk-modals", "learnkit-zoom-overlay");
        queryFirst(this.modalEl, ".modal-header")?.remove();
        queryFirst(this.modalEl, ".modal-close-button")?.remove();

        // Clicking overlay chrome (outside content/image) should close.
        this.modalEl.addEventListener("click", (ev) => {
          if (ev.target !== this.modalEl) return;
          this.close();
        });

        // Backdrop click should dismiss zoom modal.
        const modalBg = queryFirst(this.containerEl, ".modal-bg");
        if (modalBg) {
          modalBg.addEventListener("click", () => this.close(), { once: true });
        }

        this.contentEl.empty();
        this.contentEl.classList.add("learnkit-zoom-content", "learnkit-zoom-content");
        this.contentEl.addEventListener("click", (ev) => {
          if (ev.target !== this.contentEl) return;
          this.close();
        });

        const zoomHost = this.contentEl.createDiv({ cls: "learnkit-zoom-host learnkit-zoom-host" });
        const zoomCanvas = zoomHost.createDiv({ cls: "learnkit-zoom-canvas learnkit-zoom-canvas" });
        const zoomSurface = zoomCanvas.createDiv({ cls: "learnkit-zoom-surface learnkit-zoom-surface" });
        zoomSurface.dataset.sproutIoWidget = "1";

        const closeIfOutsideSurface = (ev: MouseEvent) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target.closest(".learnkit-zoom-surface")) return;
          if (target.closest(".learnkit-zoom-close")) return;
          this.close();
        };
        zoomHost.addEventListener("click", closeIfOutsideSurface);
        zoomCanvas.addEventListener("click", closeIfOutsideSurface);

        renderImageOcclusionReviewInto({
          app,
          plugin,
          containerEl: zoomSurface,
          card,
          sourcePath,
          reveal,
          ioModule,
          renderMarkdownInto: args.renderMarkdownInto,
          enableWidgetModal: false,
          hotspotReview,
        });

        const zoomImg = queryFirst(zoomSurface, "img");
        if (zoomImg instanceof HTMLImageElement) {
          zoomImg.classList.add("learnkit-zoom-img", "learnkit-zoom-img", "learnkit-io-image-zoomed", "learnkit-io-image-zoomed");
          installSmoothZoomInteractions(zoomHost, zoomSurface);
        }

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", t(plugin.settings?.general?.interfaceLanguage, "ui.common.close", "Close"));
        closeBtn.setAttribute("data-learnkit-expand-collapse", "true");
        closeBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-toolbar",
          "learnkit-btn-filter", "learnkit-btn-filter",
          "h-7",
          "px-3",
          "text-sm",
          "inline-flex",
          "items-center",
          "gap-2",
          "learnkit-zoom-close", "learnkit-zoom-close",
        );

        const closeIcon = document.createElement("span");
        closeIcon.className = "inline-flex items-center justify-center";
        setIcon(closeIcon, "x");
        closeBtn.appendChild(closeIcon);

        closeBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        });
        zoomSurface.appendChild(closeBtn);
      }

      onClose() {
        this.contentEl.empty();
        this.modalEl.removeClass("lk-modals", "learnkit-zoom-overlay");
        this.containerEl.removeClass("lk-modal-container", "lk-modal-dim", "learnkit");
      }
    })(app);

    modal.open();
  };

  const maskMode = !isHotspot && ioDef && typeof (ioDef as { maskMode?: string }).maskMode === "string"
    ? String((ioDef as { maskMode?: string }).maskMode)
    : "";
  const showAllMasks = maskMode === "all";
  const revealMode = plugin.settings?.imageOcclusion?.revealMode === "all" ? "all" : "group";
  const hotspotForceAllTargets =
    isHotspot &&
    card.type === "hq-child" &&
    (card as unknown as Record<string, unknown>).hotspotForceAllTargets === true;
  let targetIds: Set<string> | null = null;
  let targetGroup: string | null = null;
  if ((card.type === "io-child" || card.type === "hq-child") && !hotspotForceAllTargets) {
    const rectIds = Array.isArray(card.rectIds) ? card.rectIds.map((v) => String(v)) : [];
    if (rectIds.length > 0) targetIds = new Set(rectIds);
    else if (card.groupKey) targetGroup = String(card.groupKey || "");
  }
  const renderMasks = showAllMasks && card.type === "io-child" ? occlusions : masksToShow;
  const isTargetRect = (rect: StoredIORect): boolean => {
    const rectId = String(rect.rectId || "");
    const rectGroup = String(rect.groupKey || "");
    if (hotspotForceAllTargets) return true;
    if (card.type !== "io-child" && card.type !== "hq-child") return true;
    if (!targetIds && !targetGroup) return true;
    if (targetIds) return targetIds.has(rectId);
    return rectGroup === targetGroup;
  };
  const hotspotBaseTargets = isHotspot ? occlusions.filter((rect) => isTargetRect(rect)) : [];
  const hotspotBaseTargetGroups = collectHotspotTargetGroups(hotspotBaseTargets);
  const interactionOverrideValue = (card as unknown as Record<string, unknown>).hotspotInteractionModeOverride;
  let interactionOverride: string;
  if (typeof interactionOverrideValue === 'string') {
    interactionOverride = interactionOverrideValue;
  } else if (typeof interactionOverrideValue === 'number' || typeof interactionOverrideValue === 'boolean') {
    interactionOverride = String(interactionOverrideValue);
  } else {
    interactionOverride = "";
  }
  interactionOverride = interactionOverride.trim();
  const configuredMode = String(plugin.settings?.cards?.hotspotSingleInteractionMode || "smart").trim();
  const hotspotInteractionMode: "click" | "drag-drop" = resolveHotspotInteractionMode(
    interactionOverride || configuredMode,
    hotspotBaseTargetGroups.length,
  );
  const hotspotPromptLabelValue = (card as unknown as Record<string, unknown>).hotspotPromptLabel;
  let hotspotPromptLabelStr: string;
  if (typeof hotspotPromptLabelValue === 'string') {
    hotspotPromptLabelStr = hotspotPromptLabelValue;
  } else if (typeof hotspotPromptLabelValue === 'number' || typeof hotspotPromptLabelValue === 'boolean') {
    hotspotPromptLabelStr = String(hotspotPromptLabelValue);
  } else {
    hotspotPromptLabelStr = "";
  }
  const hotspotPromptTargetKey = isHotspot
    ? normalizeHotspotTargetKey(hotspotPromptLabelStr)
    : "";
  const hotspotPromptLabel = isHotspot
    ? hotspotPromptLabelStr.trim()
    : "";
  const hotspotTargets = isHotspot && hotspotInteractionMode === "click" && hotspotPromptTargetKey
    ? (() => {
        const promptTargets = hotspotBaseTargets.filter((rect, index) => {
          const key = normalizeHotspotTargetKey(getHotspotRectKey(rect, index));
          const label = normalizeHotspotTargetKey(getHotspotRectLabel(rect, index));
          return hotspotPromptTargetKey === key || hotspotPromptTargetKey === label;
        });
        return promptTargets.length > 0 ? promptTargets : hotspotBaseTargets;
      })()
    : hotspotBaseTargets;
  const hotspotTargetGroups = collectHotspotTargetGroups(hotspotTargets);
  const interactiveHotspotFront =
    isHotspot &&
    !reveal &&
    hotspotTargets.length > 0 &&
    typeof hotspotReview?.onAttempt === "function";
  const showDragDropHintMasks = interactiveHotspotFront && hotspotInteractionMode === "drag-drop";
  const hotspotAttempts = Array.isArray(hotspotReview?.attempts)
    ? hotspotReview?.attempts.filter((attempt): attempt is HotspotAttemptResult => !!attempt)
    : hotspotReview?.attempt
      ? [hotspotReview.attempt]
      : [];
  const hotspotAttempt = hotspotAttempts.length > 0 ? hotspotAttempts[hotspotAttempts.length - 1] : null;

  if (!widgetMode && !isHotspot) {
    img.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openZoomModal();
    });
  }

  const revealGroupOnly =
    reveal &&
    card.type === "io-child" &&
    maskMode === "all" &&
    revealMode === "group";

  const masksForOverlay = isHotspot
    ? (reveal
        ? (hotspotInteractionMode === "click"
            ? hotspotTargets
            : card.type === "hq-child" && !hotspotForceAllTargets
              ? occlusions.filter((rect) => isTargetRect(rect))
              : occlusions)
        : showDragDropHintMasks
          ? hotspotTargets
          : [])
    : !reveal
      ? renderMasks
      : revealGroupOnly
        ? occlusions.filter((rect) => !isTargetRect(rect))
        : [];

  let hotspotControlTray: HTMLElement | null = null;

  if (masksForOverlay.length > 0 || interactiveHotspotFront) {
    const overlay = document.createElement("div");
    overlay.classList.add("learnkit-io-overlay", "learnkit-io-overlay");
    const hintSizeUpdaters: Array<() => void> = [];

    if (interactiveHotspotFront) {
      overlay.classList.add("learnkit-hq-review-overlay", "learnkit-hq-review-overlay");
      if (!widgetMode) {
        const instruction = document.createElement("div");
        instruction.className = "learnkit-hq-review-pill";
        instruction.textContent = hotspotInteractionMode === "drag-drop"
          ? t(
              plugin.settings?.general?.interfaceLanguage,
              "ui.hotspot.review.drag",
              "Drag all labels on to the image.",
            )
          : t(
              plugin.settings?.general?.interfaceLanguage,
              "ui.hotspot.review.clickTarget",
              hotspotPromptLabel ? "Click on {label}." : "Click on image to reveal the answer.",
              hotspotPromptLabel ? { label: hotspotPromptLabel } : undefined,
            );
        overlay.appendChild(instruction);
      }
    }

    function updateOverlay() {
      const left = img.offsetLeft;
      const top = img.offsetTop;
      const imgStyles = getComputedStyle(img);
      setCssProps(overlay, "--learnkit-io-left", `${left}px`);
      setCssProps(overlay, "--learnkit-io-top", `${top}px`);
      setCssProps(overlay, "--learnkit-io-width", `${img.offsetWidth}px`);
      setCssProps(overlay, "--learnkit-io-height", `${img.offsetHeight}px`);
      setCssProps(overlay, "--learnkit-io-max-width", imgStyles.maxWidth);
      setCssProps(overlay, "--learnkit-io-max-height", imgStyles.maxHeight);
      setCssProps(overlay, "--learnkit-io-radius", imgStyles.borderRadius);
    }

    for (const rect of masksForOverlay) {
      const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
      const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
      const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
      const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;
      const isTarget = isTargetRect(rect);
      const hotspotRectIndex = Math.max(0, hotspotTargets.indexOf(rect));
      const attemptForRect = isHotspot ? findHotspotAttemptForRect(rect, hotspotRectIndex, hotspotAttempts) : null;
      const hotspotAttemptCorrect = attemptForRect ? !!attemptForRect.correct : false;
      const hotspotDragDropReveal = isHotspot && reveal && hotspotInteractionMode === "drag-drop";
      const clickRevealAttemptState =
        isHotspot &&
        reveal &&
        hotspotInteractionMode === "click" &&
        !!hotspotAttempt;
      const hasHotspotRevealState = !!attemptForRect || clickRevealAttemptState;
      const hotspotRevealIsCorrect = hotspotDragDropReveal
        ? hotspotAttemptCorrect
        : attemptForRect
          ? hotspotAttemptCorrect
          : !!hotspotAttempt?.correct;
      const hotspotRevealTone = hotspotDragDropReveal
        ? (hotspotAttemptCorrect ? "hq-correct" : "hq-incorrect")
        : hasHotspotRevealState
          ? (hotspotRevealIsCorrect ? "hq-correct" : "hq-incorrect")
          : null;
      const showHotspotOutline = showDragDropHintMasks && !reveal;
      const hotspotRectKey = isHotspot ? getHotspotRectKey(rect, hotspotRectIndex) : "";

      const mask = document.createElement("div");
      mask.classList.add("learnkit-io-mask", "learnkit-io-mask");
      setCssProps(mask, "--learnkit-io-x", `${Math.max(0, Math.min(1, x)) * 100}%`);
      setCssProps(mask, "--learnkit-io-y", `${Math.max(0, Math.min(1, y)) * 100}%`);
      setCssProps(mask, "--learnkit-io-w", `${Math.max(0, Math.min(1, w)) * 100}%`);
      setCssProps(mask, "--learnkit-io-h", `${Math.max(0, Math.min(1, h)) * 100}%`);
      if (showHotspotOutline) {
        if (rect.shape !== "polygon" && rect.shape !== "circle") {
          mask.classList.add("learnkit-io-mask-hotspot-outline", "learnkit-io-mask-hotspot-outline");
        }
        if (hotspotRectKey) {
          mask.dataset.hotspotMaskKey = normalizeHotspotTargetKey(hotspotRectKey);
          mask.dataset.hotspotCenterX = String(clampUnit(x + w / 2));
          mask.dataset.hotspotCenterY = String(clampUnit(y + h / 2));
        }
      } else if (isHotspot && reveal) {
        if (hotspotRevealTone) {
          const isCorrectTone = hotspotRevealTone === "hq-correct";
          const shape = String(rect.shape || "");
          const useShapeStroke = shape === "polygon" || shape === "circle";
          if (useShapeStroke) {
            mask.style.removeProperty("background");
            mask.style.removeProperty("border");
            setCssProps(mask, "background", "transparent");
            setCssProps(mask, "border", "none");
          } else {
            mask.style.background = isCorrectTone
              ? "rgba(34, 197, 94, 0.18)"
              : "rgba(239, 68, 68, 0.2)";
            mask.style.border = isCorrectTone
              ? "2px solid rgba(34, 197, 94, 0.9)"
              : "2px solid rgba(239, 68, 68, 0.92)";
          }
        } else {
          mask.classList.add("learnkit-io-mask-other", "learnkit-io-mask-other");
        }
      } else if (reveal) {
        mask.classList.add("learnkit-io-mask-other", "learnkit-io-mask-other");
      } else if (isTarget) {
        mask.classList.add("learnkit-io-mask-target", "learnkit-io-mask-target");
      } else {
        mask.classList.add("learnkit-io-mask-other", "learnkit-io-mask-other");
      }
      if (rect.shape === "circle") {
        mask.classList.add("learnkit-io-mask-circle", "learnkit-io-mask-circle");
        if (showHotspotOutline) {
          setCssProps(mask, "background", "transparent");
          setCssProps(mask, "border", "none");
          const circleStroke = appendCircleMaskStroke(overlay, x, y, w, h, "hint");
          circleStroke.classList.add("learnkit-io-mask-shape-hit", "learnkit-io-mask-shape-hit");
          if (hotspotRectKey) {
            circleStroke.dataset.hotspotMaskKey = normalizeHotspotTargetKey(hotspotRectKey);
            circleStroke.dataset.hotspotCenterX = String(clampUnit(x + w / 2));
            circleStroke.dataset.hotspotCenterY = String(clampUnit(y + h / 2));
          }
        } else if (isHotspot && reveal) {
          setCssProps(mask, "background", "transparent");
          setCssProps(mask, "border", "none");
          appendCircleMaskStroke(
            overlay,
            x,
            y,
            w,
            h,
            hotspotRevealTone ?? "other",
          );
        }
      } else if (rect.shape === "polygon" && Array.isArray(rect.points) && rect.points.length >= 3) {
        mask.classList.add("learnkit-io-mask-rect", "learnkit-io-mask-rect", "learnkit-io-mask-polygon", "learnkit-io-mask-polygon");
        setCssProps(mask, "clipPath", "");
        // Polygon tones are rendered by SVG; clear any previously applied rect styles.
        mask.style.removeProperty("background");
        mask.style.removeProperty("border");
        setCssProps(mask, "background", "transparent");
        setCssProps(mask, "border", "none");
        const polygonStroke = appendPolygonMaskStroke(
          overlay,
          rect,
          x,
          y,
          w,
          h,
          showHotspotOutline
            ? "hint"
            : isHotspot && reveal
            ? (hotspotRevealTone ?? "other")
            : isTarget
              ? "target"
              : "other",
        );
        if (showHotspotOutline && polygonStroke) {
          polygonStroke.classList.add("learnkit-io-mask-shape-hit", "learnkit-io-mask-shape-hit");
          if (hotspotRectKey) {
            polygonStroke.dataset.hotspotMaskKey = normalizeHotspotTargetKey(hotspotRectKey);
            polygonStroke.dataset.hotspotCenterX = String(clampUnit(x + w / 2));
            polygonStroke.dataset.hotspotCenterY = String(clampUnit(y + h / 2));
          }
        }
      } else {
        mask.classList.add("learnkit-io-mask-rect", "learnkit-io-mask-rect");
        setCssProps(mask, "clipPath", "");
        if (showHotspotOutline) {
          setCssProps(mask, "background", "transparent");
          setCssProps(mask, "border", "none");
          const rectStroke = appendRectMaskStroke(overlay, x, y, w, h, "hint");
          rectStroke.classList.add("learnkit-io-mask-shape-hit", "learnkit-io-mask-shape-hit");
          if (hotspotRectKey) {
            rectStroke.dataset.hotspotMaskKey = normalizeHotspotTargetKey(hotspotRectKey);
            rectStroke.dataset.hotspotCenterX = String(clampUnit(x + w / 2));
            rectStroke.dataset.hotspotCenterY = String(clampUnit(y + h / 2));
          }
        }
      }

      overlay.appendChild(mask);
    }

    const revealHotspotLabeledKeys = new Set<string>();
    if (isHotspot && hotspotAttempts.length > 0) {
      for (const attempt of hotspotAttempts) {
        const anchoredRect = findHotspotRectForAttempt(attempt, hotspotTargets);
        const showDragDropPlacement = attempt.mode === "drag-drop" && (reveal || interactiveHotspotFront);
        if (showDragDropPlacement) {
          const anchoredRectIndex = anchoredRect ? Math.max(0, hotspotTargets.indexOf(anchoredRect)) : -1;
          const fallbackKey = anchoredRect && anchoredRectIndex >= 0
            ? getHotspotRectKey(anchoredRect, anchoredRectIndex)
            : "";
          const fallbackLabel = anchoredRect && anchoredRectIndex >= 0
            ? getHotspotRectLabel(anchoredRect, anchoredRectIndex)
            : "";
          const rawAttemptLabel = String(attempt.label || "").trim();
          const displayAttempt = reveal && !rawAttemptLabel && fallbackLabel
            ? { ...attempt, label: fallbackLabel }
            : attempt;

          const resolvedAttemptKey = (() => {
            const raw = normalizeHotspotTargetKey(rawAttemptLabel);
            if (raw) {
              const matchedGroup = hotspotTargetGroups.find((group) => {
                const groupKey = normalizeHotspotTargetKey(group.key);
                const groupLabel = normalizeHotspotTargetKey(group.label);
                return raw === groupKey || raw === groupLabel;
              });
              if (matchedGroup) return normalizeHotspotTargetKey(matchedGroup.key);
            }
            return normalizeHotspotTargetKey(fallbackKey || fallbackLabel || rawAttemptLabel);
          })();

          const chip = appendHotspotAttemptLabel(overlay, displayAttempt, anchoredRect, {
            pending: !reveal && interactiveHotspotFront,
            attemptKey: resolvedAttemptKey,
            draggable: !reveal && interactiveHotspotFront,
          });
          if (reveal && chip) {
            const key = String(chip.dataset.hotspotKey || "").trim().toLowerCase();
            if (key) revealHotspotLabeledKeys.add(key);
          }
        } else if (reveal) {
          appendHotspotMarker(overlay, attempt);
        }
      }
    }

    if (isHotspot && reveal && hotspotInteractionMode === "drag-drop" && hotspotTargets.length > 0) {
      hotspotTargets.forEach((rect, index) => {
        const key = getHotspotRectKey(rect, index).trim().toLowerCase();
        if (!key || revealHotspotLabeledKeys.has(key)) return;

        const center = getHotspotRectCenter(rect);
        appendHotspotAttemptLabel(
          overlay,
          {
            mode: "drag-drop",
            x: center.x,
            y: center.y,
            correct: false,
            label: getHotspotRectLabel(rect, index),
          },
          rect,
          { attemptKey: key },
        );
        revealHotspotLabeledKeys.add(key);
      });
    }

    let cleanupHotspotInteraction: (() => void) | null = null;
    if (interactiveHotspotFront) {
      const submitAttempt = (point: ImagePoint) => {
        hotspotReview?.onAttempt?.({
          mode: hotspotInteractionMode,
          x: point.x,
          y: point.y,
          correct: !!findMatchingHotspot(point, hotspotTargets, { strict: true }),
        });
      };

      if (hotspotInteractionMode === "click") {
        const onOverlayClick = (ev: MouseEvent) => {
          const point = getImagePoint(img, ev.clientX, ev.clientY);
          if (!point?.inside) return;
          ev.preventDefault();
          ev.stopPropagation();
          submitAttempt(point);
        };
        overlay.addEventListener("click", onOverlayClick);
        cleanupHotspotInteraction = () => {
          overlay.removeEventListener("click", onOverlayClick);
        };
      } else {
        const preview = document.createElement("div");
        preview.className = "learnkit-hq-drop-preview is-floating";
        const previewHost = document.body || overlay;
        previewHost.appendChild(preview);

        const removeChip = document.createElement("button");
        removeChip.type = "button";
        removeChip.className = "learnkit-hq-remove-chip";
        removeChip.textContent = "×";
        overlay.appendChild(removeChip);

        const setPreview = (point: ImagePoint | null, clientX?: number, clientY?: number) => {
          const visible = !!(dragging && activeTarget);
          preview.classList.toggle("is-visible", visible);
          if (!visible) return;
          const activeTargetLabel = String(activeTarget?.label || buttonLabelFallback);
          preview.textContent = activeTargetLabel;
          if (typeof clientX === "number" && typeof clientY === "number") {
            setCssProps(preview, "left", `${clientX}px`);
            setCssProps(preview, "top", `${clientY}px`);
            return;
          }
          if (!point) return;
          const imgRect = img.getBoundingClientRect();
          setCssProps(preview, "left", `${imgRect.left + point.x * imgRect.width}px`);
          setCssProps(preview, "top", `${imgRect.top + point.y * imgRect.height}px`);
        };

        const setRemoveChip = (visible: boolean, key?: string, centerX?: number, centerY?: number) => {
          removeChip.classList.toggle("is-visible", visible);
          if (!visible) {
            delete removeChip.dataset.hotspotKey;
            return;
          }
          removeChip.dataset.hotspotKey = String(key || "").trim().toLowerCase();
          setCssProps(removeChip, "left", `${clampUnit(Number(centerX ?? 0.5)) * 100}%`);
          setCssProps(removeChip, "top", `${clampUnit(Number(centerY ?? 0.5)) * 100}%`);
        };

        hotspotControlTray = document.createElement("div");
        hotspotControlTray.className = "learnkit-hq-drop-tray";

        const buttonLabelFallback = t(
          plugin.settings?.general?.interfaceLanguage,
          "ui.hotspot.review.dragButton",
          "Drag label",
        );

        let activeTarget: HotspotTargetGroup | null = null;
        const buildTargetButton = (target: HotspotTargetGroup) => {
          const dragButton = document.createElement("button");
          dragButton.type = "button";
          dragButton.className = "learnkit-hq-drop-button";
          dragButton.textContent = target.label || buttonLabelFallback;
          return dragButton;
        };

        const dragButtons: Array<{ button: HTMLButtonElement; target: HotspotTargetGroup; handler: (ev: PointerEvent) => void }> = [];
        const targetByKey = new Map<string, HotspotTargetGroup>();
        const buttonByKey = new Map<string, HTMLButtonElement>();
        const hotspotRectByKey = new Map<string, StoredIORect>();
        const placedTargetKeys = new Set<string>();
        hotspotTargetGroups.forEach((target) => {
          const key = normalizeHotspotTargetKey(target.key);
          if (key) targetByKey.set(key, target);
        });
        hotspotTargets.forEach((rect, index) => {
          const key = normalizeHotspotTargetKey(getHotspotRectKey(rect, index));
          if (key && !hotspotRectByKey.has(key)) hotspotRectByKey.set(key, rect);
        });
        hotspotAttempts.forEach((attempt) => {
          const attemptKey = normalizeHotspotTargetKey(attempt.label);
          if (!attemptKey) return;
          const matchedGroup = hotspotTargetGroups.find((group) => {
            const groupKey = normalizeHotspotTargetKey(group.key);
            const groupLabel = normalizeHotspotTargetKey(group.label);
            return attemptKey === groupKey || attemptKey === groupLabel;
          });
          const resolvedKey = matchedGroup ? normalizeHotspotTargetKey(matchedGroup.key) : attemptKey;
          if (resolvedKey) placedTargetKeys.add(resolvedKey);
        });

        const getTargetFromKeyOrLabel = (keyOrLabel: unknown, fallbackLabel?: string): HotspotTargetGroup | null => {
          const normalized = normalizeHotspotTargetKey(keyOrLabel);
          if (normalized) {
            const direct = targetByKey.get(normalized);
            if (direct) return direct;
            const byGroup = hotspotTargetGroups.find((group) => {
              const groupKey = normalizeHotspotTargetKey(group.key);
              const groupLabel = normalizeHotspotTargetKey(group.label);
              return normalized === groupKey || normalized === groupLabel;
            });
            if (byGroup) {
              return { key: byGroup.key, label: byGroup.label };
            }
          }

          const fallback = String(fallbackLabel || "").trim();
          if (!fallback && !normalized) return null;
          const syntheticKey = normalized || normalizeHotspotTargetKey(fallback) || "hotspot";
          const keyOrLabelText =
            typeof keyOrLabel === "string"
              ? keyOrLabel.trim()
              : typeof keyOrLabel === "number"
                ? String(keyOrLabel)
                : "";
          return {
            key: syntheticKey,
            label: fallback || keyOrLabelText || syntheticKey,
          };
        };

        const setButtonPlacedState = (key: string, placed: boolean) => {
          const normalized = normalizeHotspotTargetKey(key);
          if (!normalized) return;
          const button = buttonByKey.get(normalized);
          if (!button) return;
          button.disabled = placed;
          button.classList.toggle("is-placed", placed);
        };

        let dragging = false;
        let activeDragChip: HTMLElement | null = null;
        let activeDragSourceMaskKey = "";
        const getMaskKeyForPoint = (x: number, y: number): string => {
          const match = findMatchingHotspot({ x: clampUnit(x), y: clampUnit(y), inside: true }, hotspotTargets, { strict: true });
          if (!match) return "";
          return normalizeHotspotTargetKey(getHotspotRectKey(match, hotspotTargets.indexOf(match)));
        };
        const getChipMaskKey = (chip: HTMLElement): string => {
          const x = Number(chip.dataset.hotspotAnchorX || "0");
          const y = Number(chip.dataset.hotspotAnchorY || "0");
          return getMaskKeyForPoint(x, y);
        };
        const findPlacedChipForMaskKey = (maskKey: string, excludeHotspotKey?: string): HTMLElement | null => {
          const normalizedMask = normalizeHotspotTargetKey(maskKey);
          const excluded = normalizeHotspotTargetKey(excludeHotspotKey);
          if (!normalizedMask) return null;
          const chips = Array.from(overlay.querySelectorAll<HTMLElement>(".learnkit-hq-attempt-label.is-pending"));
          for (const chip of chips) {
            const chipKey = normalizeHotspotTargetKey(chip.dataset.hotspotKey);
            if (!chipKey || (excluded && chipKey === excluded)) continue;
            if (getChipMaskKey(chip) === normalizedMask) return chip;
          }
          return null;
        };
        const removePlacedLabel = (labelKey: string, sourceChip?: HTMLElement | null): void => {
          const normalized = normalizeHotspotTargetKey(labelKey);
          if (!normalized) return;
          const removedX = sourceChip
            ? clampUnit(Number(sourceChip.dataset.hotspotAnchorX || "0.5"))
            : 0.5;
          const removedY = sourceChip
            ? clampUnit(Number(sourceChip.dataset.hotspotAnchorY || "0.5"))
            : 0.5;
          if (sourceChip) {
            sourceChip.remove();
          } else {
            overlay.querySelectorAll<HTMLElement>(".learnkit-hq-attempt-label").forEach((chip) => {
              if (String(chip.dataset.hotspotKey || "").trim().toLowerCase() === normalized) {
                chip.remove();
              }
            });
          }
          placedTargetKeys.delete(normalized);
          setButtonPlacedState(normalized, false);
          const target = targetByKey.get(normalized) || null;
          hotspotReview?.onAttempt?.({
            mode: hotspotInteractionMode,
            x: removedX,
            y: removedY,
            correct: false,
            label: String(target?.label || target?.key || normalized),
            removed: true,
          });
          resolveHotspotLabelCollisions(overlay);
        };
        const onPointerMove = (ev: PointerEvent) => {
          if (!dragging) return;
          setPreview(getImagePoint(img, ev.clientX, ev.clientY), ev.clientX, ev.clientY);
        };
        const finishDrag = (ev: PointerEvent) => {
          if (!dragging) return;
          const draggedTarget = activeTarget;
          const draggedChip = activeDragChip;
          const sourceMaskKey = activeDragSourceMaskKey;
          dragging = false;
          hotspotControlTray?.querySelectorAll(".learnkit-hq-drop-button.is-dragging").forEach((btn) => {
            btn.classList.remove("is-dragging");
          });
          activeDragChip?.classList.remove("is-dragging");
          activeDragChip = null;
          activeDragSourceMaskKey = "";
          const point = getImagePoint(img, ev.clientX, ev.clientY);
          setPreview(null);
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", finishDrag);
          document.removeEventListener("pointercancel", finishDrag);
          const trayRect = hotspotControlTray?.getBoundingClientRect();
          const trayHitPadding = 12;
          const eventTarget = ev.target;
          const droppedViaTarget = !!hotspotControlTray && eventTarget instanceof Node && hotspotControlTray.contains(eventTarget);
          const droppedViaRect = !!trayRect &&
            ev.clientX >= trayRect.left - trayHitPadding &&
            ev.clientX <= trayRect.right + trayHitPadding &&
            ev.clientY >= trayRect.top - trayHitPadding &&
            ev.clientY <= trayRect.bottom + trayHitPadding;
          const droppedInTray = droppedViaTarget || droppedViaRect;
          const activeKey = normalizeHotspotTargetKey(draggedChip?.dataset.hotspotKey || draggedTarget?.key);

          if (droppedInTray && draggedChip && activeKey) {
            ev.preventDefault();
            removePlacedLabel(activeKey, draggedChip);
            setRemoveChip(false);
            activeTarget = null;
            return;
          }

          if (!point?.inside) return;
          ev.preventDefault();
          setRemoveChip(false);
          const match = findMatchingHotspot(point, hotspotTargets, { strict: true });
          if (!match) {
            // Ignore drops outside any actual mask shape (prevents cheating).
            activeTarget = null;
            return;
          }
          const matchKey = match
            ? getHotspotRectKey(match, hotspotTargets.indexOf(match))
            : "";
          const destinationMaskKey = normalizeHotspotTargetKey(matchKey);
          const destinationRect = destinationMaskKey ? hotspotRectByKey.get(destinationMaskKey) || null : null;

          const destinationChip = destinationMaskKey
            ? findPlacedChipForMaskKey(destinationMaskKey, activeKey)
            : null;
          if (destinationChip) {
            const destinationLabelKey = normalizeHotspotTargetKey(destinationChip.dataset.hotspotKey);
            if (sourceMaskKey) {
              const sourceRect = hotspotRectByKey.get(sourceMaskKey) || null;
              const destinationTarget = destinationLabelKey ? targetByKey.get(destinationLabelKey) || null : null;
              if (sourceRect && destinationTarget) {
                const sourceCenter = getHotspotRectCenter(sourceRect);
                const destinationCorrect = sourceMaskKey === destinationLabelKey;
                appendHotspotAttemptLabel(
                  overlay,
                  {
                    mode: hotspotInteractionMode,
                    x: sourceCenter.x,
                    y: sourceCenter.y,
                    correct: destinationCorrect,
                    label: String(destinationTarget.label || destinationTarget.key || destinationLabelKey).trim(),
                  },
                  sourceRect,
                  {
                    pending: true,
                    attemptKey: destinationLabelKey,
                    draggable: true,
                  },
                );
                hotspotReview?.onAttempt?.({
                  mode: hotspotInteractionMode,
                  x: sourceCenter.x,
                  y: sourceCenter.y,
                  correct: destinationCorrect,
                  label: String(destinationTarget.label || destinationTarget.key || destinationLabelKey).trim(),
                });
              }
            } else {
              removePlacedLabel(destinationLabelKey, destinationChip);
            }
          }

          const correct = !!destinationRect && !!activeKey && destinationMaskKey === activeKey;
          const draggedLabel = String(
            targetByKey.get(activeKey)?.label || draggedTarget?.label || draggedTarget?.key || draggedChip?.textContent || "",
          ).trim();
          const result: HotspotAttemptResult = {
            mode: hotspotInteractionMode,
            x: point.x,
            y: point.y,
            correct,
            label: draggedLabel,
          };

          appendHotspotAttemptLabel(overlay, result, destinationRect, {
            pending: true,
            attemptKey: activeKey,
            draggable: true,
          });
          resolveHotspotLabelCollisions(overlay);

          if (activeKey) {
            placedTargetKeys.add(activeKey);
            setButtonPlacedState(activeKey, true);
          }

          hotspotReview?.onAttempt?.(result);
          activeTarget = null;
        };
        const startDrag = (target: HotspotTargetGroup, dragButton: HTMLButtonElement) => (ev: PointerEvent) => {
          if (ev.button !== 0) return;
          const key = normalizeHotspotTargetKey(target.key);
          if (placedTargetKeys.has(key)) return;
          activeTarget = target;
          dragging = true;
          activeDragSourceMaskKey = "";
          dragButton.classList.add("is-dragging");
          setRemoveChip(false);
          setPreview(getImagePoint(img, ev.clientX, ev.clientY), ev.clientX, ev.clientY);
          document.addEventListener("pointermove", onPointerMove);
          document.addEventListener("pointerup", finishDrag);
          document.addEventListener("pointercancel", finishDrag);
          ev.preventDefault();
          ev.stopPropagation();
        };
        const sourceTargets = hotspotTargetGroups.length > 0
          ? hotspotTargetGroups
          : [{ key: "hotspot", label: buttonLabelFallback }];
        sourceTargets.forEach((target) => {
          const dragButton = buildTargetButton(target);
          const key = normalizeHotspotTargetKey(target.key);
          const handler = startDrag(target, dragButton);
          dragButton.addEventListener("pointerdown", handler);
          dragButtons.push({ button: dragButton, target, handler });
          if (key) buttonByKey.set(key, dragButton);
          hotspotControlTray?.appendChild(dragButton);
        });

        placedTargetKeys.forEach((key) => setButtonPlacedState(key, true));

        const onOverlayPointerDown = (ev: PointerEvent) => {
          const targetEl = ev.target as HTMLElement | null;
          if (!targetEl) return;
          if (targetEl.closest(".learnkit-hq-remove-chip")) return;

          const labelChip = targetEl.closest(".learnkit-hq-attempt-label.is-pending");
          if (labelChip && labelChip instanceof HTMLElement) {
            const key = normalizeHotspotTargetKey(labelChip.dataset.hotspotKey);
            const labelText = String(labelChip.textContent || "").trim();
            const target = getTargetFromKeyOrLabel(key || labelText, labelText);
            if (!target || ev.button !== 0) return;
            activeTarget = target;
            dragging = true;
            activeDragChip = labelChip;
            activeDragSourceMaskKey = getChipMaskKey(labelChip);
            labelChip.classList.add("is-dragging");
            setRemoveChip(false);
            setPreview(getImagePoint(img, ev.clientX, ev.clientY), ev.clientX, ev.clientY);
            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", finishDrag);
            document.addEventListener("pointercancel", finishDrag);
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }

          const maskEl = targetEl.closest(".learnkit-io-mask-hotspot-outline, .learnkit-io-mask-shape-hit");
          const maskKey = maskEl instanceof HTMLElement ? normalizeHotspotTargetKey(maskEl.dataset.hotspotMaskKey) : "";
          if (!maskEl || !maskKey || !placedTargetKeys.has(maskKey)) {
            setRemoveChip(false);
            return;
          }
          if (!(maskEl instanceof HTMLElement)) return;

          const cx = Number(maskEl.dataset.hotspotCenterX || "0.5");
          const cy = Number(maskEl.dataset.hotspotCenterY || "0.5");
          setRemoveChip(true, maskKey, cx, cy);
          ev.preventDefault();
          ev.stopPropagation();
        };

        const onRemoveChipClick = (ev: MouseEvent) => {
          const key = normalizeHotspotTargetKey(removeChip.dataset.hotspotKey);
          if (!key) return;
          ev.preventDefault();
          ev.stopPropagation();
          const target = targetByKey.get(key) || null;
          overlay.querySelectorAll<HTMLElement>(".learnkit-hq-attempt-label").forEach((chip) => {
            if (normalizeHotspotTargetKey(chip.dataset.hotspotKey) === key) {
              chip.remove();
            }
          });
          placedTargetKeys.delete(key);
          setButtonPlacedState(key, false);
          const x = clampUnit(Number(removeChip.style.left.replace("%", "")) / 100 || 0.5);
          const y = clampUnit(Number(removeChip.style.top.replace("%", "")) / 100 || 0.5);
          hotspotReview?.onAttempt?.({
            mode: hotspotInteractionMode,
            x,
            y,
            correct: false,
            label: String(target?.label || target?.key || key),
            removed: true,
          });
          resolveHotspotLabelCollisions(overlay);
          setRemoveChip(false);
        };

        overlay.addEventListener("pointerdown", onOverlayPointerDown);
        removeChip.addEventListener("click", onRemoveChipClick);

        cleanupHotspotInteraction = () => {
          dragging = false;
          activeTarget = null;
          activeDragChip = null;
          activeDragSourceMaskKey = "";
          setPreview(null);
          setRemoveChip(false);
          dragButtons.forEach(({ button, handler }) => {
            button.removeEventListener("pointerdown", handler);
          });
          overlay.removeEventListener("pointerdown", onOverlayPointerDown);
          removeChip.removeEventListener("click", onRemoveChipClick);
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", finishDrag);
          document.removeEventListener("pointercancel", finishDrag);
          preview.remove();
        };
      }
    }

    function syncOverlay() {
      updateOverlay();
      resolveHotspotLabelCollisions(overlay);
      if (hintSizeUpdaters.length > 0) {
        hintSizeUpdaters.forEach((fn) => fn());
      }
    }

    function syncOverlayAfterLayout() {
      requestAnimationFrame(() => {
        syncOverlay();
        setTimeout(syncOverlay, 50);
      });
    }

    if (img.complete) {
      syncOverlayAfterLayout();
    } else {
      img.addEventListener("load", syncOverlayAfterLayout, { once: true });
    }
    const onResize = () => syncOverlay();
    window.addEventListener("resize", onResize);

    let overlayResizeObserver: ResizeObserver | null = null;
    let resizeRafId = 0;
    if (typeof ResizeObserver !== "undefined") {
      overlayResizeObserver = new ResizeObserver(() => {
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = 0;
          syncOverlay();
        });
      });
      overlayResizeObserver.observe(host);
      overlayResizeObserver.observe(img);
    }

    let detachedObserver: MutationObserver | null = null;
    const cleanupOverlayListeners = () => {
      cleanupHotspotInteraction?.();
      cleanupHotspotInteraction = null;
      window.removeEventListener("resize", onResize);
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      resizeRafId = 0;
      overlayResizeObserver?.disconnect();
      overlayResizeObserver = null;
      detachedObserver?.disconnect();
      detachedObserver = null;
    };

    if (document.body) {
      detachedObserver = new MutationObserver(() => {
        if (!host.isConnected) cleanupOverlayListeners();
      });
      detachedObserver.observe(document.body, { childList: true, subtree: true });
    }

    host.appendChild(overlay);
  }

  if (widgetMode && enableWidgetModal && !isHotspot) {
    host.classList.add("learnkit-io-zoom-in", "learnkit-io-zoom-in");
    img.classList.add("learnkit-io-zoom-in", "learnkit-io-zoom-in");
    host.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openZoomModal();
    };
  }

  if (!widgetMode) {
    containerEl.appendChild(host);
    if (hotspotControlTray) {
      containerEl.appendChild(hotspotControlTray);
    }
  } else if (hotspotControlTray) {
    const parent = containerEl.parentElement;
    if (parent) {
      parent.insertBefore(hotspotControlTray, containerEl.nextSibling);
    } else {
      host.appendChild(hotspotControlTray);
    }
  }
}
