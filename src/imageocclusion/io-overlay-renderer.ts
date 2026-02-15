/**
 * @file src/imageocclusion/io-overlay-renderer.ts
 * @summary Renders occlusion-rectangle and text-box overlays on the Image Occlusion creator canvas. Handles all DOM creation, interactjs drag/resize wiring, selection highlighting, group-key input controls, and text-box inline editing for both rect and text overlays.
 *
 * @exports
 *   - OverlayCallbacks — interface defining callback hooks for rect/text interaction events
 *   - RenderOverlayOptions — interface describing all options accepted by renderOverlay
 *   - renderOverlay — main entry point that renders all occlusion rects and text boxes onto the overlay element
 */

import interact from "interactjs";
import type { IORect, IOTextBox } from "./io-types";
import { textBgCss } from "./io-image-ops";
import { setCssProps } from "../core/ui";

type DragMoveEvent = {
  dx: number;
  dy: number;
};

type ResizeMoveEvent = {
  deltaRect?: { left: number; top: number; width: number; height: number };
};

// ── Public callback interface ───────────────────────────────────────────────

export interface OverlayCallbacks {
  /** Return the *live* reference to a rect so drag/resize can mutate it. */
  findRect(rectId: string): IORect | undefined;
  /** Return the *live* reference to a text box. */
  findTextBox(textId: string): IOTextBox | undefined;
  /** Called when a rect is clicked / drag-started. */
  selectRect(rectId: string): void;
  /** Called when a text box is clicked / drag-started. */
  selectText(textId: string): void;
  /** Persist an undo-able snapshot. */
  saveHistory(): void;
  /** Trigger a full re-render of the overlay. */
  rerender(): void;
  /** Called on double-click of a text box (open inline editor). */
  editTextBox(textBox: IOTextBox): void;
}

export interface RenderOverlayOptions {
  overlayEl: HTMLElement;
  stageW: number;
  stageH: number;
  scale: number;
  selectedRectId: string | null;
  selectedTextId: string | null;
  currentTool: string;
  /** Elements to preserve when clearing (e.g. active preview divs). */
  preserveEls: Set<Element | null>;
  rects: readonly IORect[];
  textBoxes: readonly IOTextBox[];
  cb: OverlayCallbacks;
}

// ── Main entry point ────────────────────────────────────────────────────────

export function renderOverlay(opts: RenderOverlayOptions): void {
  const {
    overlayEl,
    stageW: rawStageW,
    stageH: rawStageH,
    scale: rawScale,
    selectedRectId,
    selectedTextId,
    currentTool,
    preserveEls,
    rects,
    textBoxes,
    cb,
  } = opts;

  const stageW = rawStageW || 1;
  const stageH = rawStageH || 1;
  const scale = rawScale || 1;
  const isCropTool = currentTool === "crop";

  // ── Clear existing overlay children (preserve active previews) ──────────
  const children = Array.from(overlayEl.children);
  for (const child of children) {
    if (preserveEls.has(child)) continue;
    try {
      interact(child as HTMLElement).unset();
    } catch {
      // ignore
    }
    child.remove();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  const positionEl = (el: HTMLElement, normX: number, normY: number, normW: number, normH: number) => {
    setCssProps(el, "--sprout-io-left", `${normX * stageW}px`);
    setCssProps(el, "--sprout-io-top", `${normY * stageH}px`);
    setCssProps(el, "--sprout-io-width", `${normW * stageW}px`);
    setCssProps(el, "--sprout-io-height", `${normH * stageH}px`);
  };

  // ── Render occlusion rects ──────────────────────────────────────────────

  for (const rect of rects) {
    const el = document.createElement("div");
    el.className = "sprout-io-overlay-item sprout-io-rect sprout-cursor-move";
    el.classList.toggle("sprout-pointer-none", isCropTool);
    el.setAttribute("data-rect-id", rect.rectId);
    positionEl(el, rect.normX, rect.normY, rect.normW, rect.normH);

    if (rect.shape === "circle") {
      el.classList.add("is-circle");
    }

    const isSelected = rect.rectId === selectedRectId;
    el.classList.toggle("is-selected", isSelected);

    // GroupKey input (centred on the rect)
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.value = rect.groupKey || "1";
    groupInput.className = "sprout-io-group-input";
    groupInput.classList.toggle("sprout-pointer-none", isCropTool);
    groupInput.setAttribute("data-group-input", rect.rectId);

    groupInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    const getRectRef = () => cb.findRect(rect.rectId);

    groupInput.addEventListener("change", () => {
      const r = getRectRef();
      if (r) {
        r.groupKey = groupInput.value.trim() || "1";
        cb.saveHistory();
      }
    });

    groupInput.addEventListener("input", () => {
      const r = getRectRef();
      if (r) {
        r.groupKey = groupInput.value.trim() || "1";
      }
    });

    el.appendChild(groupInput);

    // Corner resize affordances (rectangles only)
    if (rect.shape !== "circle") {
      const cornerSize = 10;
      const addCorner = (cx: string, cy: string) => {
        const c = document.createElement("div");
        c.className = "sprout-io-corner";
        c.classList.add(cx === "left" ? "is-left" : "is-right");
        c.classList.add(cy === "top" ? "is-top" : "is-bottom");
        setCssProps(c, "--sprout-io-corner-size", `${cornerSize}px`);
        el.appendChild(c);
      };
      addCorner("left", "top");
      addCorner("right", "top");
      addCorner("left", "bottom");
      addCorner("right", "bottom");
    }

    // Cursor hints near corners
    el.addEventListener("mousemove", (evt) => {
      const bounds = el.getBoundingClientRect();
      const px = evt.clientX - bounds.left;
      const py = evt.clientY - bounds.top;
      const nearLeft = px <= 12;
      const nearRight = px >= bounds.width - 12;
      const nearTop = py <= 12;
      const nearBottom = py >= bounds.height - 12;
      if ((nearLeft && nearTop) || (nearRight && nearBottom)) {
        el.classList.remove("sprout-cursor-nesw-resize", "sprout-cursor-move");
        el.classList.add("sprout-cursor-nwse-resize");
      } else if ((nearRight && nearTop) || (nearLeft && nearBottom)) {
        el.classList.remove("sprout-cursor-nwse-resize", "sprout-cursor-move");
        el.classList.add("sprout-cursor-nesw-resize");
      } else {
        el.classList.remove("sprout-cursor-nwse-resize", "sprout-cursor-nesw-resize");
        el.classList.add("sprout-cursor-move");
      }
    });
    el.addEventListener("mouseleave", () => {
      el.classList.remove("sprout-cursor-nwse-resize", "sprout-cursor-nesw-resize");
      el.classList.add("sprout-cursor-move");
    });

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      cb.selectRect(rect.rectId);
    });

    overlayEl.appendChild(el);

    const syncStyle = () => {
      const r = getRectRef();
      if (!r) return;
      positionEl(el, r.normX, r.normY, r.normW, r.normH);
    };

    // Interactjs: drag + resize
    interact(el)
      .draggable({
        ignoreFrom: "input,textarea,button,select,.sprout-io-corner",
        listeners: {
          move: (event: DragMoveEvent) => {
            const r = getRectRef();
            if (!r) return;
            const dx = event.dx / scale;
            const dy = event.dy / scale;
            const w = r.normW * stageW;
            const h = r.normH * stageH;
            let x = r.normX * stageW + dx;
            let y = r.normY * stageH + dy;
            x = Math.max(0, Math.min(stageW - w, x));
            y = Math.max(0, Math.min(stageH - h, y));
            r.normX = x / stageW;
            r.normY = y / stageH;
            syncStyle();
          },
          end: () => {
            cb.saveHistory();
            cb.rerender();
          },
        },
      })
      .resizable({
        edges: rect.shape !== "circle"
          ? {
              left: ".sprout-io-corner.is-left",
              right: ".sprout-io-corner.is-right",
              top: ".sprout-io-corner.is-top",
              bottom: ".sprout-io-corner.is-bottom",
            }
          : { left: true, right: true, top: true, bottom: true },
        listeners: {
          move: (event: ResizeMoveEvent) => {
            const r = getRectRef();
            if (!r) return;
            const delta = event.deltaRect || { left: 0, top: 0, width: 0, height: 0 };
            let x = r.normX * stageW + delta.left / scale;
            let y = r.normY * stageH + delta.top / scale;
            let w = r.normW * stageW + delta.width / scale;
            let h = r.normH * stageH + delta.height / scale;
            const minSize = 5;
            w = Math.max(minSize, w);
            h = Math.max(minSize, h);
            if (x < 0) {
              w += x;
              x = 0;
            }
            if (y < 0) {
              h += y;
              y = 0;
            }
            if (x + w > stageW) w = stageW - x;
            if (y + h > stageH) h = stageH - y;
            w = Math.max(minSize, w);
            h = Math.max(minSize, h);
            r.normX = x / stageW;
            r.normY = y / stageH;
            r.normW = w / stageW;
            r.normH = h / stageH;
            syncStyle();
          },
          end: () => {
            cb.saveHistory();
            cb.rerender();
          },
        },
      })
      .styleCursor(false);
  }

  // ── Render text boxes ───────────────────────────────────────────────────

  for (const textBox of textBoxes) {
    const el = document.createElement("div");
    el.className = "sprout-io-overlay-item sprout-io-text-box";
    el.classList.toggle("sprout-pointer-none", isCropTool);
    el.setAttribute("data-text-id", textBox.textId);
    positionEl(el, textBox.normX, textBox.normY, textBox.normW, textBox.normH);

    const isSelected = textBox.textId === selectedTextId;
    const bgCss = textBgCss(textBox.bgColor, textBox.bgOpacity ?? 1);
    const hasBg = bgCss !== "transparent";
    setCssProps(
      el,
      "--sprout-io-text-border",
      isSelected ? "2px dashed #10b981" : "1px dashed rgba(16, 185, 129, 0.6)",
    );
    setCssProps(
      el,
      "--sprout-io-text-bg",
      hasBg ? bgCss : isSelected ? "rgba(16, 185, 129, 0.08)" : "transparent",
    );
    setCssProps(
      el,
      "--sprout-io-text-shadow",
      isSelected ? "0 0 0 2px rgba(16, 185, 129, 0.12)" : "none",
    );

    const textEl = document.createElement("div");
    textEl.textContent = textBox.text;
    textEl.className = "sprout-io-text-content";
    setCssProps(textEl, "--sprout-io-text-size", `${Math.max(8, textBox.fontSize)}px`);
    setCssProps(textEl, "--sprout-io-text-color", textBox.color || "#111111");
    el.appendChild(textEl);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      cb.selectText(textBox.textId);
    });

    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cb.editTextBox(textBox);
    });

    const getTextRef = () => cb.findTextBox(textBox.textId);

    interact(el)
      .draggable({
        listeners: {
          move: (event: DragMoveEvent) => {
            const t = getTextRef();
            if (!t) return;
            const dx = event.dx / scale;
            const dy = event.dy / scale;
            const w = t.normW * stageW;
            const h = t.normH * stageH;
            let x = t.normX * stageW + dx;
            let y = t.normY * stageH + dy;
            x = Math.max(0, Math.min(stageW - w, x));
            y = Math.max(0, Math.min(stageH - h, y));
            t.normX = x / stageW;
            t.normY = y / stageH;
            positionEl(el, t.normX, t.normY, t.normW, t.normH);
          },
          end: () => {
            cb.saveHistory();
            cb.rerender();
          },
        },
      })
      .resizable({
        edges: { left: true, right: true, top: true, bottom: true },
        listeners: {
          move: (event: ResizeMoveEvent) => {
            const t = getTextRef();
            if (!t) return;
            const delta = event.deltaRect || { left: 0, top: 0, width: 0, height: 0 };
            let x = t.normX * stageW + delta.left / scale;
            let y = t.normY * stageH + delta.top / scale;
            let w = t.normW * stageW + delta.width / scale;
            let h = t.normH * stageH + delta.height / scale;
            const minSize = 40;
            w = Math.max(minSize, w);
            h = Math.max(minSize, h);
            if (x < 0) {
              w += x;
              x = 0;
            }
            if (y < 0) {
              h += y;
              y = 0;
            }
            if (x + w > stageW) w = stageW - x;
            if (y + h > stageH) h = stageH - y;
            w = Math.max(minSize, w);
            h = Math.max(minSize, h);
            t.normX = x / stageW;
            t.normY = y / stageH;
            t.normW = w / stageW;
            t.normH = h / stageH;
            positionEl(el, t.normX, t.normY, t.normW, t.normH);
          },
          end: () => {
            cb.saveHistory();
            cb.rerender();
          },
        },
      })
      .styleCursor(false);
  }
}
