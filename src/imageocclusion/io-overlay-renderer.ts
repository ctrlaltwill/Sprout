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
    el.style.left = `${normX * stageW}px`;
    el.style.top = `${normY * stageH}px`;
    el.style.width = `${normW * stageW}px`;
    el.style.height = `${normH * stageH}px`;
  };

  // ── Render occlusion rects ──────────────────────────────────────────────

  for (const rect of rects) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.pointerEvents = isCropTool ? "none" : "auto";
    el.setAttribute("data-rect-id", rect.rectId);
    positionEl(el, rect.normX, rect.normY, rect.normW, rect.normH);

    if (rect.shape === "circle") {
      el.style.borderRadius = "50%";
    } else {
      el.style.borderRadius = "4px";
    }

    const isSelected = rect.rectId === selectedRectId;
    if (isSelected) {
      el.style.border = "3px dashed #3b82f6";
      el.style.backgroundColor = "rgba(59, 130, 246, 0.12)";
    } else {
      el.style.border = "3px dashed #ef4444";
      el.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
    }

    // GroupKey input (centred on the rect)
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.value = rect.groupKey || "1";
    groupInput.style.position = "absolute";
    groupInput.style.left = "50%";
    groupInput.style.top = "50%";
    groupInput.style.transform = "translate(-50%, -50%)";
    groupInput.style.width = "60px";
    groupInput.style.padding = "6px 12px";
    groupInput.style.fontSize = "21px";
    groupInput.style.fontWeight = "700";
    groupInput.style.textAlign = "center";
    groupInput.style.border = "2px solid rgba(0, 0, 0, 0.3)";
    groupInput.style.borderRadius = "6px";
    groupInput.style.backgroundColor = "rgba(255, 255, 255, 0.95)";
    groupInput.style.color = "#000";
    groupInput.style.pointerEvents = isCropTool ? "none" : "auto";
    groupInput.style.cursor = "text";
    groupInput.style.zIndex = "10";
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
        c.style.position = "absolute";
        c.style.width = `${cornerSize}px`;
        c.style.height = `${cornerSize}px`;
        c.style.background = "rgba(0,0,0,0.25)";
        c.style.border = "1px solid rgba(255,255,255,0.7)";
        c.style.borderRadius = "3px";
        c.style[cx as "left" | "right"] = "-5px";
        c.style[cy as "top" | "bottom"] = "-5px";
        c.style.pointerEvents = "none";
        c.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.08)";
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
        el.style.cursor = "nwse-resize";
      } else if ((nearRight && nearTop) || (nearLeft && nearBottom)) {
        el.style.cursor = "nesw-resize";
      } else {
        el.style.cursor = "move";
      }
    });
    el.addEventListener("mouseleave", () => {
      el.style.cursor = "move";
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
        ignoreFrom: "input,textarea,button,select",
        listeners: {
          start: () => {
            cb.selectRect(rect.rectId);
          },
          move: (event) => {
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
        edges: { left: true, right: true, top: true, bottom: true },
        listeners: {
          start: () => {
            cb.selectRect(rect.rectId);
          },
          move: (event) => {
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
    el.style.position = "absolute";
    el.style.pointerEvents = isCropTool ? "none" : "auto";
    el.setAttribute("data-text-id", textBox.textId);
    positionEl(el, textBox.normX, textBox.normY, textBox.normW, textBox.normH);

    const isSelected = textBox.textId === selectedTextId;
    const bgCss = textBgCss(textBox.bgColor, textBox.bgOpacity ?? 1);
    const hasBg = bgCss !== "transparent";
    el.style.border = isSelected ? "2px dashed #10b981" : "1px dashed rgba(16, 185, 129, 0.6)";
    el.style.backgroundColor = hasBg ? bgCss : isSelected ? "rgba(16, 185, 129, 0.08)" : "transparent";
    el.style.boxShadow = isSelected ? "0 0 0 2px rgba(16, 185, 129, 0.12)" : "none";
    el.style.borderRadius = "6px";
    el.style.padding = "6px 8px";
    el.style.boxSizing = "border-box";
    el.style.display = "flex";
    el.style.alignItems = "flex-start";
    el.style.justifyContent = "flex-start";

    const textEl = document.createElement("div");
    textEl.textContent = textBox.text;
    textEl.style.whiteSpace = "pre-wrap";
    textEl.style.wordBreak = "break-word";
    textEl.style.fontSize = `${Math.max(8, textBox.fontSize)}px`;
    textEl.style.lineHeight = "1.3";
    textEl.style.color = textBox.color || "#111111";
    textEl.style.pointerEvents = "none";
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
          start: () => {
            cb.selectText(textBox.textId);
          },
          move: (event) => {
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
          start: () => {
            cb.selectText(textBox.textId);
          },
          move: (event) => {
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
