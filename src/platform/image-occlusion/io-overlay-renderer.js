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
import { textBgCss } from "./io-image-ops";
import { setCssProps } from "../../platform/core/ui";
const SVG_NS = "http://www.w3.org/2000/svg";
function createDeleteIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", "svg-icon lucide-x");
    const pathA = document.createElementNS(SVG_NS, "path");
    pathA.setAttribute("d", "M18 6 6 18");
    const pathB = document.createElementNS(SVG_NS, "path");
    pathB.setAttribute("d", "m6 6 12 12");
    svg.appendChild(pathA);
    svg.appendChild(pathB);
    return svg;
}
// ── Main entry point ────────────────────────────────────────────────────────
export function renderOverlay(opts) {
    var _a;
    const { overlayEl, stageW: rawStageW, stageH: rawStageH, scale: rawScale, selectedRectId, selectedTextId, currentTool, preserveEls, rects, textBoxes, cb, } = opts;
    const stageW = rawStageW || 1;
    const stageH = rawStageH || 1;
    const scale = rawScale || 1;
    const uiInverseScale = 1 / Math.max(0.0001, scale);
    const isCropTool = currentTool === "crop";
    // ── Clear existing overlay children (preserve active previews) ──────────
    const children = Array.from(overlayEl.children);
    for (const child of children) {
        if (preserveEls.has(child))
            continue;
        try {
            interact(child).unset();
        }
        catch (_b) {
            // ignore
        }
        child.remove();
    }
    // ── Helpers ─────────────────────────────────────────────────────────────
    const positionEl = (el, normX, normY, normW, normH) => {
        setCssProps(el, "--learnkit-io-left", `${normX * stageW}px`);
        setCssProps(el, "--learnkit-io-top", `${normY * stageH}px`);
        setCssProps(el, "--learnkit-io-width", `${normW * stageW}px`);
        setCssProps(el, "--learnkit-io-height", `${normH * stageH}px`);
    };
    // ── Render occlusion rects ──────────────────────────────────────────────
    for (const rect of rects) {
        const el = document.createElement("div");
        el.className = "learnkit-io-overlay-item learnkit-io-rect learnkit-cursor-move";
        el.classList.toggle("learnkit-pointer-none", isCropTool);
        el.setAttribute("data-rect-id", rect.rectId);
        positionEl(el, rect.normX, rect.normY, rect.normW, rect.normH);
        if (rect.shape === "circle") {
            el.classList.add("is-circle");
        }
        const isSelected = rect.rectId === selectedRectId;
        el.classList.toggle("is-selected", isSelected);
        // GroupKey input controls (centered on rect, visually unscaled from canvas zoom)
        const inputUi = document.createElement("div");
        inputUi.className = "learnkit-io-group-ui";
        setCssProps(inputUi, "--learnkit-io-ui-inverse-scale", `${uiInverseScale}`);
        const groupInput = document.createElement("input");
        groupInput.type = "text";
        groupInput.value = rect.groupKey || "1";
        groupInput.className = "learnkit-io-group-input";
        groupInput.classList.toggle("learnkit-pointer-none", isCropTool);
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
        inputUi.appendChild(groupInput);
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "learnkit-assistant-popup-close learnkit-io-mask-delete";
        deleteBtn.setAttribute("aria-label", "Delete mask");
        deleteBtn.setAttribute("data-tooltip-position", "top");
        deleteBtn.appendChild(createDeleteIcon());
        deleteBtn.addEventListener("mousedown", (e) => {
            // Keep input focus behavior stable while clicking the delete affordance.
            e.preventDefault();
            e.stopPropagation();
        });
        deleteBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            cb.deleteRect(rect.rectId);
        });
        inputUi.appendChild(deleteBtn);
        el.appendChild(inputUi);
        // Corner resize affordances (rectangles only)
        if (rect.shape !== "circle") {
            const cornerSize = 10;
            const addCorner = (cx, cy) => {
                const c = document.createElement("div");
                c.className = "learnkit-io-corner";
                c.classList.add(cx === "left" ? "is-left" : "is-right");
                c.classList.add(cy === "top" ? "is-top" : "is-bottom");
                setCssProps(c, "--learnkit-io-corner-size", `${cornerSize}px`);
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
                el.classList.remove("learnkit-cursor-nesw-resize", "learnkit-cursor-nesw-resize", "learnkit-cursor-move", "learnkit-cursor-move");
                el.classList.add("learnkit-cursor-nwse-resize", "learnkit-cursor-nwse-resize");
            }
            else if ((nearRight && nearTop) || (nearLeft && nearBottom)) {
                el.classList.remove("learnkit-cursor-nwse-resize", "learnkit-cursor-nwse-resize", "learnkit-cursor-move", "learnkit-cursor-move");
                el.classList.add("learnkit-cursor-nesw-resize", "learnkit-cursor-nesw-resize");
            }
            else {
                el.classList.remove("learnkit-cursor-nwse-resize", "learnkit-cursor-nwse-resize", "learnkit-cursor-nesw-resize", "learnkit-cursor-nesw-resize");
                el.classList.add("learnkit-cursor-move", "learnkit-cursor-move");
            }
        });
        el.addEventListener("mouseleave", () => {
            el.classList.remove("learnkit-cursor-nwse-resize", "learnkit-cursor-nwse-resize", "learnkit-cursor-nesw-resize", "learnkit-cursor-nesw-resize");
            el.classList.add("learnkit-cursor-move", "learnkit-cursor-move");
        });
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            cb.selectRect(rect.rectId);
        });
        overlayEl.appendChild(el);
        const syncStyle = () => {
            const r = getRectRef();
            if (!r)
                return;
            positionEl(el, r.normX, r.normY, r.normW, r.normH);
        };
        // Interactjs: drag + resize
        interact(el)
            .draggable({
            ignoreFrom: "input,textarea,button,select,.learnkit-io-corner,.learnkit-io-mask-delete",
            listeners: {
                move: (event) => {
                    const r = getRectRef();
                    if (!r)
                        return;
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
                    left: ".learnkit-io-corner.is-left",
                    right: ".learnkit-io-corner.is-right",
                    top: ".learnkit-io-corner.is-top",
                    bottom: ".learnkit-io-corner.is-bottom",
                }
                : { left: true, right: true, top: true, bottom: true },
            listeners: {
                move: (event) => {
                    const r = getRectRef();
                    if (!r)
                        return;
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
                    if (x + w > stageW)
                        w = stageW - x;
                    if (y + h > stageH)
                        h = stageH - y;
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
        el.className = "learnkit-io-overlay-item learnkit-io-text-box";
        el.classList.toggle("learnkit-pointer-none", isCropTool);
        el.setAttribute("data-text-id", textBox.textId);
        positionEl(el, textBox.normX, textBox.normY, textBox.normW, textBox.normH);
        const isSelected = textBox.textId === selectedTextId;
        const bgCss = textBgCss(textBox.bgColor, (_a = textBox.bgOpacity) !== null && _a !== void 0 ? _a : 1);
        const hasBg = bgCss !== "transparent";
        setCssProps(el, "--learnkit-io-text-border", isSelected ? "2px dashed #10b981" : "1px dashed rgba(16, 185, 129, 0.6)");
        setCssProps(el, "--learnkit-io-text-bg", hasBg ? bgCss : isSelected ? "rgba(16, 185, 129, 0.08)" : "transparent");
        setCssProps(el, "--learnkit-io-text-shadow", isSelected ? "0 0 0 2px rgba(16, 185, 129, 0.12)" : "none");
        const textEl = document.createElement("div");
        textEl.textContent = textBox.text;
        textEl.className = "learnkit-io-text-content";
        setCssProps(textEl, "--learnkit-io-text-size", `${Math.max(8, textBox.fontSize)}px`);
        setCssProps(textEl, "--learnkit-io-text-color", textBox.color || "#111111");
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
                move: (event) => {
                    const t = getTextRef();
                    if (!t)
                        return;
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
                move: (event) => {
                    const t = getTextRef();
                    if (!t)
                        return;
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
                    if (x + w > stageW)
                        w = stageW - x;
                    if (y + h > stageH)
                        h = stageH - y;
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
