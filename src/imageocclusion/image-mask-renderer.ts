/**
 * @file src/imageocclusion/image-mask-renderer.ts
 * @summary Implements the Image Occlusion editor modal for editing existing IO cards. Provides a full interactive canvas with image display, occlusion rectangle drawing/dragging/resizing via interactjs, pan/zoom controls, group key editing, undo/reset, and save functionality that persists changes to the store and updates the note markdown.
 *
 * @exports
 *   - ImageOcclusionEditorModal — Modal subclass providing the IO mask editor UI for existing IO parent cards
 */

import { type App, Modal, Notice, Platform, TFile, setIcon } from "obsidian";
import interact from "interactjs";

import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import type { IOParentDef, StoredIORect, IOMaskMode } from "./image-occlusion-types";
import { clampRectPx, normToPxRect, pxToNormRect, rectPxFromPoints, type RectPx } from "./image-geometry";
import { applyStageTransform, clientToStage, zoomAt, type StageTransform } from "./image-transform";
import { 
  isMaskMode, 
  makeRectId, 
  nextAutoGroupKey, 
  normaliseGroupKey, 
  stableIoChildId 
} from "./mask-tool";
import {
  resolveImageFile,
  isEditableTarget,
  emptyEl,
  type IoEditorOpenOpts,
} from "./io-helpers";

export class ImageOcclusionEditorModal extends Modal {
  private plugin: SproutPlugin;
  private parentId: string;

  private afterClose?: () => void;

  private sourceNotePath = "";
  private imageRef = "";

  private stageW = 1;
  private stageH = 1;

  private ioDef: IOParentDef | null = null;
  private rects: StoredIORect[] = [];

  private selectedRectId: string | null = null;

  // snapshot for reset
  private initialRects: StoredIORect[] = [];
  private initialMaskMode: IOMaskMode = "solo";

  // DOM
  private viewportEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private imgEl!: HTMLImageElement;

  // top bar controls
  private btnOcclusion!: HTMLButtonElement;
  private btnTransform!: HTMLButtonElement;
  private btnDelete!: HTMLButtonElement;
  private btnReset!: HTMLButtonElement;
  private groupInput!: HTMLInputElement;

  // in-image controls
  private btnZoomIn!: HTMLButtonElement;
  private btnZoomOut!: HTMLButtonElement;
  private btnFit!: HTMLButtonElement;
  private zoomPctEl!: HTMLElement;

  // footer controls
  private btnSaveSolo!: HTMLButtonElement;
  private btnSaveAll!: HTMLButtonElement;

  // transform state
  private t: StageTransform = { scale: 1, tx: 0, ty: 0 };

  // drawing state
  private drawing = false;
  private drawStart: { x: number; y: number } | null = null;
  private previewEl: HTMLElement | null = null;

  // panning state
  private handToggle = false;
  private spaceDown = false;
  private panning = false;
  private panStart: { x: number; y: number; tx: number; ty: number } | null = null;

  // interact handles
  private interactables = new Map<string, ReturnType<typeof interact>>();

  // window listeners (so we can unbind cleanly)
  private onWinMove?: (e: MouseEvent) => void;
  private onWinUp?: (e: MouseEvent) => void;

  // sizing constraint (viewport height = fitted image height, capped)
  private readonly MAX_CANVAS_H = 600;

  constructor(app: App, plugin: SproutPlugin, parentId: string, opts?: IoEditorOpenOpts) {
    super(app);
    this.plugin = plugin;
    this.parentId = String(parentId);
    this.afterClose = opts?.onClose;
  }

  static openForParent(plugin: SproutPlugin, parentId: string, opts?: IoEditorOpenOpts) {
    const m = new ImageOcclusionEditorModal(plugin.app, plugin, parentId, opts);
    m.open();
    return m;
  }

  onOpen() {
    this.modalEl.addClass("sprout-modals", "sprout-io-modal");
    this.containerEl.addClass("sprout-io-editor-modal");

    // IMPORTANT inline sizing (requested): max-width 800px, width 90%
    try {
      const inner = this.containerEl.querySelector(".modal") as HTMLElement | null;
      if (inner) {
        inner.style.setProperty("width", "90%", "important");
        inner.style.setProperty("max-width", "800px", "important");
      }
    } catch {
      // ignore
    }

    try {
      this.containerEl.style.zIndex = "3000";
      const bg = this.containerEl.querySelector(".modal-bg") as HTMLElement | null;
      if (bg) bg.style.zIndex = "2999";
      const inner = this.containerEl.querySelector(".modal") as HTMLElement | null;
      if (inner) inner.style.zIndex = "3000";
    } catch {
      // ignore
    }

    if (Platform.isMobileApp) {
      new Notice("Boot Camp: Image Occlusion editor is desktop-only.");
      this.close();
      return;
    }

    const parent = (this.plugin.store?.data?.cards || {})[this.parentId];
    if (!parent || String(parent.type) !== "io") {
      new Notice("Boot Camp: select an IO parent card to edit.");
      this.close();
      return;
    }

    this.sourceNotePath = String(parent.sourceNotePath || "");
    this.imageRef = String(parent.imageRef || parent.ioSrc || "");

    const ioMap = this.plugin.store?.data?.io || {};
    const existing = ioMap[this.parentId] as IOParentDef | undefined;

    const imageRefFromIo = existing?.imageRef ? String(existing.imageRef) : "";
    const imageRef = (this.imageRef || imageRefFromIo).trim();

    if (!imageRef) {
      new Notice("Boot Camp: IO card is missing an imageRef.");
      this.close();
      return;
    }

    const maskMode: IOMaskMode = isMaskMode(existing?.maskMode) ? existing.maskMode : "solo";

    this.ioDef = {
      imageRef,
      maskMode,
      rects: Array.isArray(existing?.rects) ? existing.rects.map((r) => ({ ...r })) : [],
    };

    this.rects = this.ioDef.rects.map((r) => ({
      ...r,
      groupKey: normaliseGroupKey(r.groupKey),
    }));

    // snapshot for Reset
    this.initialRects = this.rects.map((r) => ({ ...r }));
    this.initialMaskMode = maskMode;

    try {
      this.titleEl?.setText?.("Image Occlusion");
    } catch {
      // ignore
    }

    this.renderUI();
    void this.loadImageAndInit();
  }

  onClose() {
    try {
      for (const it of this.interactables.values()) {
        try {
          it.unset?.();
        } catch {
          // no-op
        }
      }
      this.interactables.clear();
    } catch {
      // no-op
    }

    try {
      if (this.onWinMove) window.removeEventListener("mousemove", this.onWinMove);
      if (this.onWinUp) window.removeEventListener("mouseup", this.onWinUp);
    } catch {
      // no-op
    }

    this.modalEl.removeClass("sprout-io-modal");
    this.contentEl.empty();

    try {
      this.afterClose?.();
    } catch {
      // ignore
    }
  }

  private injectCssOnce() {
    const style = this.contentEl.createEl("style");
    style.textContent = `
/* ======================================================================
   Boot Camp IO — functional positioning only
   ====================================================================== */

.sprout-io-modal .modal-content {
  padding-top: 10px;
  overflow: hidden;
}

.sprout-io-root { display: flex; flex-direction: column; gap: 12px; }

/* Toolbar */
.sprout-io-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Canvas: height set dynamically */
.sprout-io-viewport {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.sprout-io-stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.sprout-io-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
  border: 1px solid var(--border);
  box-sizing: border-box;
}
.sprout-io-overlay {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  pointer-events: auto;
}

.sprout-io-preview {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed var(--interactive-accent);
  border-radius: 6px;
  background: rgba(0,0,0,0.06);
  pointer-events: none;
}
.sprout-io-rect {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--interactive-accent);
  border-radius: 6px;
  background: rgba(0,0,0,0.06);
}
.sprout-io-rect.selected {
  outline: 2px solid var(--text-accent);
  outline-offset: 1px;
}
.sprout-io-rect-label {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-weight: 700;
  font-size: 14px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0,0,0,0.55);
  color: white;
  pointer-events: none;
}

.sprout-io-pan { cursor: grab; }
.sprout-io-pan:active { cursor: grabbing; }

/* In-image controls */
.sprout-io-canvas-controls {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Icons */
.sprout-io-ico svg { width: 16px; height: 16px; }

/* Footer */
.sprout-io-footer { display: flex; justify-content: flex-end; gap: 10px; align-items: center; flex-wrap: wrap; }
`;
  }

  private setTool(mode: "occlusion" | "transform") {
    this.handToggle = mode === "transform";

    const setActive = (btn: HTMLButtonElement, active: boolean) => {
      btn.classList.toggle("btn", active);
      btn.classList.toggle("btn-outline", !active);
      btn.classList.toggle("sprout-is-active", active);
    };

    setActive(this.btnOcclusion, mode === "occlusion");
    setActive(this.btnTransform, mode === "transform");

    this.syncCursor();

    try {
      this.viewportEl?.focus?.();
    } catch {
      // ignore
    }
  }

  private fitAndSizeViewport() {
    if (!this.viewportEl) return;

    const vw = Math.max(1, this.viewportEl.clientWidth || 1);
    const maxH = Math.max(1, this.MAX_CANVAS_H);

    const sW = vw / Math.max(1, this.stageW);
    const sH = maxH / Math.max(1, this.stageH);
    let s = Math.min(sW, sH, 1);

    s = Math.max(0.05, Math.min(8, s));

    const vh = Math.max(1, Math.round(this.stageH * s));
    this.viewportEl.style.height = `${vh}px`;

    const fittedW = this.stageW * s;
    const tx = Math.round((vw - fittedW) / 2);
    const ty = 0;

    this.t = { scale: s, tx, ty };
    applyStageTransform(this.stageEl, this.t);
    this.syncZoomLabel();
  }

  private syncZoomLabel() {
    if (this.zoomPctEl) this.zoomPctEl.textContent = `${Math.round((this.t.scale || 1) * 100)}%`;
  }

  private doZoom(factor: number) {
    const r = this.viewportEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    this.t = zoomAt(this.viewportEl, this.t, factor, cx, cy, 0.05, 8);
    applyStageTransform(this.stageEl, this.t);
    this.syncZoomLabel();
  }

  private resetOcclusionsAndView() {
    this.rects = this.initialRects.map((r) => ({ ...r }));
    if (this.ioDef) this.ioDef.maskMode = this.initialMaskMode;

    this.clearSelection();
    this.renderAllRects();
    this.fitAndSizeViewport();
  }

  private renderUI() {
    const { contentEl } = this;
    contentEl.empty();
    this.injectCssOnce();

    const root = contentEl.createDiv({ cls: "bc sprout-io-root" });

    // -------------------------
    // Top toolbar
    // -------------------------
    const toolbar = root.createDiv({
      cls: "bc sprout-io-toolbar rounded-xl border border-border bg-background shadow-sm px-3 py-2",
    });

    this.btnOcclusion = toolbar.createEl("button", {
      cls: "bc btn",
      attr: { type: "button" },
      text: "Draw Occlusion",
    });
    this.btnOcclusion.onclick = () => this.setTool("occlusion");

    this.btnTransform = toolbar.createEl("button", {
      cls: "bc btn-outline",
      attr: { type: "button" },
      text: "Move Image",
    });
    this.btnTransform.onclick = () => this.setTool("transform");

    // Input + info tooltip
    this.groupInput = toolbar.createEl("input", {
      cls: "bc input flex-1 min-w-[260px]",
    });
    this.groupInput.type = "text";
    this.groupInput.placeholder = "Choose a shape to change its group";
    this.groupInput.disabled = true;

    this.groupInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (e.target as HTMLInputElement).blur();
      }
    });

    this.groupInput.addEventListener("input", () => {
      if (!this.selectedRectId) return;
      const r = this.rects.find((x) => x.rectId === this.selectedRectId);
      if (!r) return;

      r.groupKey = normaliseGroupKey(this.groupInput.value);
      this.updateRectLabel(r.rectId);
    });

    // Basecoat-style tooltip via aria + title (works even if tooltip JS isn't loaded)
    const groupInfo = toolbar.createEl("button", {
      cls: "bc btn-icon-ghost",
      attr: {
        type: "button",
        "data-tooltip": "What does the group field do?",
        title:
          "Group sets which rectangles are hidden together.\nSelect a rectangle, then edit this field to change its group.",
      },
    });
    {
      const ico = groupInfo.createSpan({ cls: "bc sprout-io-ico" });
      setIcon(ico, "info");
    }

    this.btnDelete = toolbar.createEl("button", {
      cls: "bc btn-icon-ghost",
      attr: { type: "button", "data-tooltip": "Delete selected occlusion" },
    });
    {
      const ico = this.btnDelete.createSpan({ cls: "bc sprout-io-ico" });
      setIcon(ico, "trash-2");
    }
    this.btnDelete.onclick = () => this.deleteSelected();

    this.btnReset = toolbar.createEl("button", {
      cls: "bc btn-outline",
      attr: { type: "button" },
      text: "Reset",
    });
    this.btnReset.onclick = () => this.resetOcclusionsAndView();

    // -------------------------
    // Viewport
    // -------------------------
    this.viewportEl = root.createDiv({
      cls: "bc sprout-io-viewport rounded-xl border border-border bg-background shadow-sm",
    });
    this.viewportEl.tabIndex = 0;

    this.stageEl = this.viewportEl.createDiv({ cls: "bc sprout-io-stage" });

    this.imgEl = this.stageEl.createEl("img", { cls: "bc sprout-io-img" });
    this.imgEl.alt = "Image Occlusion";
    this.imgEl.draggable = false;

    this.overlayEl = this.stageEl.createDiv({ cls: "bc sprout-io-overlay" });

    // In-canvas controls: + / - / Fit
    const canvasControls = this.viewportEl.createDiv({
      cls: "bc sprout-io-canvas-controls rounded-xl border border-border bg-background shadow-sm px-2 py-1",
    });

    this.btnZoomIn = canvasControls.createEl("button", {
      cls: "bc btn-icon-outline",
      attr: { type: "button", "data-tooltip": "Zoom in" },
    });
    {
      const ico = this.btnZoomIn.createSpan({ cls: "bc sprout-io-ico" });
      setIcon(ico, "plus");
    }
    this.btnZoomIn.onclick = () => this.doZoom(1.2);

    this.btnZoomOut = canvasControls.createEl("button", {
      cls: "bc btn-icon-outline",
      attr: { type: "button", "data-tooltip": "Zoom out" },
    });
    {
      const ico = this.btnZoomOut.createSpan({ cls: "bc sprout-io-ico" });
      setIcon(ico, "minus");
    }
    this.btnZoomOut.onclick = () => this.doZoom(1 / 1.2);

    this.btnFit = canvasControls.createEl("button", {
      cls: "bc btn-icon-outline",
      attr: { type: "button", "data-tooltip": "Fit" },
    });
    {
      const ico = this.btnFit.createSpan({ cls: "bc sprout-io-ico" });
      setIcon(ico, "maximize-2");
    }
    this.btnFit.onclick = () => this.fitAndSizeViewport();

    this.zoomPctEl = canvasControls.createDiv({
      cls: "bc text-xs text-muted-foreground w-12 text-right",
      text: "100%",
    });

    // -------------------------
    // Footer (bottom-right)
    // -------------------------
    const footer = root.createDiv({ cls: "bc sprout-io-footer" });

    const saveInfo = footer.createEl("button", {
      cls: "bc btn-icon-ghost",
      attr: {
        type: "button",
        "data-tooltip": "What do the save options mean?",
        title:
          "Save (Hide One): each rectangle becomes its own card.\nSave (Hide All): all rectangles in the same group are hidden together.",
      },
    });
    {
      const ico = saveInfo.createSpan({ cls: "bc sprout-io-ico" });
      setIcon(ico, "info");
    }

    const saveWrap = footer.createDiv({
      cls: "bc rounded-xl border border-border bg-background shadow-sm px-3 py-2 flex items-center gap-2",
    });

    this.btnSaveSolo = saveWrap.createEl("button", {
      cls: "bc btn-outline",
      attr: { type: "button" },
      text: "Save (Hide One)",
    });
    this.btnSaveSolo.onclick = () => void this.saveAndClose("solo");

    this.btnSaveAll = saveWrap.createEl("button", {
      cls: "bc btn",
      attr: { type: "button" },
      text: "Save (Hide All)",
    });
    this.btnSaveAll.onclick = () => void this.saveAndClose("all");

    // default tool
    this.setTool("occlusion");

    // events
    this.bindViewportEvents();
  }

  private async loadImageAndInit() {
    const file = resolveImageFile(this.app, this.sourceNotePath, this.ioDef?.imageRef || "");
    if (!(file instanceof TFile)) {
      new Notice("Boot Camp: could not resolve IO image in vault.");
      this.close();
      return;
    }

    const src = this.app.vault.getResourcePath(file);
    this.imgEl.src = src;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (this.imgEl.complete && this.imgEl.naturalWidth > 0) return resolve();
      this.imgEl.addEventListener("load", done, { once: true });
      this.imgEl.addEventListener("error", done, { once: true });
    });

    this.stageW = Math.max(1, this.imgEl.naturalWidth || 1);
    this.stageH = Math.max(1, this.imgEl.naturalHeight || 1);

    this.stageEl.style.width = `${this.stageW}px`;
    this.stageEl.style.height = `${this.stageH}px`;

    requestAnimationFrame(() => {
      this.fitAndSizeViewport();
      this.renderAllRects();
      this.syncCursor();
      this.syncZoomLabel();
      this.viewportEl.focus();
    });
  }

  private bindViewportEvents() {
    this.viewportEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " " && !e.repeat) {
        this.spaceDown = true;
        this.syncCursor();
        e.preventDefault();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (isEditableTarget(document.activeElement)) return;
        if (this.selectedRectId) {
          e.preventDefault();
          this.deleteSelected();
        }
        return;
      }

      if (e.key.startsWith("Arrow")) {
        if (isEditableTarget(document.activeElement)) return;
        if (!this.selectedRectId) return;

        const stepScreen = e.shiftKey ? 10 : 1;
        const stepStage = stepScreen / (this.t.scale || 1);

        let dx = 0;
        let dy = 0;

        if (e.key === "ArrowLeft") dx = -stepStage;
        else if (e.key === "ArrowRight") dx = stepStage;
        else if (e.key === "ArrowUp") dy = -stepStage;
        else if (e.key === "ArrowDown") dy = stepStage;

        e.preventDefault();
        this.nudgeSelected(dx, dy, 8);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        this.doZoom(1.2);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        this.doZoom(1 / 1.2);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        this.fitAndSizeViewport();
      }
    });

    this.viewportEl.addEventListener("keyup", (e: KeyboardEvent) => {
      if (e.key === " ") {
        this.spaceDown = false;
        this.syncCursor();
      }
    });

    this.viewportEl.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      const onRect = !!target?.closest?.(".sprout-io-rect");

      const canPan = (this.spaceDown || this.handToggle) && !onRect;
      if (!canPan) return;

      this.panning = true;
      this.panStart = { x: e.clientX, y: e.clientY, tx: this.t.tx, ty: this.t.ty };
      e.preventDefault();
    });

    this.overlayEl.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;

      if (this.spaceDown || this.handToggle) return;
      if (target?.closest?.(".sprout-io-rect")) return;

      this.clearSelection();

      this.drawing = true;
      const p = clientToStage(this.viewportEl, this.t, e.clientX, e.clientY);
      this.drawStart = p;

      this.previewEl = document.createElement("div");
      this.previewEl.className = "bc sprout-io-preview";
      this.overlayEl.appendChild(this.previewEl);

      e.preventDefault();
    });

    this.onWinMove = (e: MouseEvent) => {
      if (this.panning && this.panStart) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        this.t.tx = this.panStart.tx + dx;
        this.t.ty = this.panStart.ty + dy;
        applyStageTransform(this.stageEl, this.t);
      }

      if (this.drawing && this.drawStart && this.previewEl) {
        const p = clientToStage(this.viewportEl, this.t, e.clientX, e.clientY);
        const r = rectPxFromPoints(this.drawStart, p);

        const minStage = 8 / (this.t.scale || 1);
        const clamped = clampRectPx(r, this.stageW, this.stageH, minStage);

        this.previewEl.style.left = `${clamped.x}px`;
        this.previewEl.style.top = `${clamped.y}px`;
        this.previewEl.style.width = `${clamped.w}px`;
        this.previewEl.style.height = `${clamped.h}px`;
      }
    };

    this.onWinUp = (e: MouseEvent) => {
      if (this.panning) {
        this.panning = false;
        this.panStart = null;
      }

      if (!this.drawing || !this.drawStart) return;

      const p = clientToStage(this.viewportEl, this.t, e.clientX, e.clientY);
      const raw = rectPxFromPoints(this.drawStart, p);

      const minStage = 8 / (this.t.scale || 1);
      const r = clampRectPx(raw, this.stageW, this.stageH, minStage);

      this.previewEl?.remove();
      this.previewEl = null;

      this.drawing = false;
      this.drawStart = null;

      if (r.w < minStage || r.h < minStage) return;

      const rectId = makeRectId();
      const groupKey = nextAutoGroupKey(this.rects);

      const norm = pxToNormRect(rectId, r, this.stageW, this.stageH, groupKey);
      this.rects.push(norm);

      this.renderAllRects();
      this.selectRect(rectId);
    };

    window.addEventListener("mousemove", this.onWinMove);
    window.addEventListener("mouseup", this.onWinUp);

    this.overlayEl.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".sprout-io-rect")) return;
      this.clearSelection();
    });
  }

  private syncCursor() {
    const pan = this.spaceDown || this.handToggle;
    this.viewportEl.toggleClass("sprout-io-pan", pan);
  }

  private clearSelection() {
    this.selectedRectId = null;
    this.groupInput.value = "";
    this.groupInput.disabled = true;
    this.groupInput.placeholder = "Choose a shape to change its group";

    for (const el of Array.from(this.overlayEl.querySelectorAll(".sprout-io-rect"))) {
      el.classList.remove("selected");
    }
  }

  private selectRect(rectId: string) {
    this.selectedRectId = rectId;

    for (const el of Array.from(this.overlayEl.querySelectorAll(".sprout-io-rect"))) {
      const id = (el as HTMLElement).dataset.rectId;
      el.classList.toggle("selected", id === rectId);
    }

    const r = this.rects.find((x) => x.rectId === rectId);
    if (r) {
      this.groupInput.disabled = false;
      this.groupInput.value = String(r.groupKey ?? "");
      this.groupInput.placeholder = "Type a group key (e.g. A, B, 1, 2)…";
    } else {
      this.clearSelection();
    }
  }

  private deleteSelected() {
    const id = this.selectedRectId;
    if (!id) return;

    const idx = this.rects.findIndex((r) => r.rectId === id);
    if (idx >= 0) this.rects.splice(idx, 1);

    const el = this.overlayEl.querySelector(
      `.sprout-io-rect[data-rect-id="${CSS.escape(id)}"]`,
    );
    el?.remove();

    const it = this.interactables.get(id);
    if (it) {
      try {
        it.unset?.();
      } catch {
        // no-op
      }
      this.interactables.delete(id);
    }

    this.clearSelection();
    this.renderAllRects();
  }

  private nudgeSelected(dxStage: number, dyStage: number, minDisplayPx: number) {
    const id = this.selectedRectId;
    if (!id) return;

    const r = this.rects.find((x) => x.rectId === id);
    if (!r) return;

    const px = normToPxRect(r, this.stageW, this.stageH);

    const minStage = (minDisplayPx || 8) / (this.t.scale || 1);
    const moved: RectPx = { x: px.x + dxStage, y: px.y + dyStage, w: px.w, h: px.h };
    const clamped = clampRectPx(moved, this.stageW, this.stageH, minStage);

    const next = pxToNormRect(r.rectId, clamped, this.stageW, this.stageH, r.groupKey);
    Object.assign(r, next);

    this.updateRectElement(r.rectId);
  }

  private updateRectLabel(rectId: string) {
    const el = this.overlayEl.querySelector(`.sprout-io-rect[data-rect-id="${CSS.escape(rectId)}"]`);
    if (!(el instanceof HTMLElement)) return;

    const r = this.rects.find((x) => x.rectId === rectId);
    if (!r) return;

    const label = el.querySelector(".sprout-io-rect-label");
    if (label) (label as HTMLElement).textContent = String(r.groupKey ?? "");
  }

  private updateRectElement(rectId: string) {
    const el = this.overlayEl.querySelector(`.sprout-io-rect[data-rect-id="${CSS.escape(rectId)}"]`);
    if (!(el instanceof HTMLElement)) return;

    const r = this.rects.find((x) => x.rectId === rectId);
    if (!r) return;

    const px = normToPxRect(r, this.stageW, this.stageH);

    el.style.left = `${px.x}px`;
    el.style.top = `${px.y}px`;
    el.style.width = `${px.w}px`;
    el.style.height = `${px.h}px`;

    this.updateRectLabel(rectId);
  }

  private renderAllRects() {
    emptyEl(this.overlayEl);

    for (const it of this.interactables.values()) {
      try {
        it.unset?.();
      } catch {
        // no-op
      }
    }
    this.interactables.clear();

    for (const r of this.rects) {
      const px = normToPxRect(r, this.stageW, this.stageH);
      const el = this.overlayEl.createDiv({ cls: "bc sprout-io-rect" });
      el.dataset.rectId = r.rectId;

      el.style.left = `${px.x}px`;
      el.style.top = `${px.y}px`;
      el.style.width = `${px.w}px`;
      el.style.height = `${px.h}px`;

      const label = el.createDiv({ cls: "bc sprout-io-rect-label", text: String(r.groupKey ?? "") });

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectRect(r.rectId);
      });

      label.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectRect(r.rectId);
        this.groupInput.focus();
        this.groupInput.select();
      });

      this.bindInteractToRect(el, r.rectId);
    }

    if (this.selectedRectId) this.selectRect(this.selectedRectId);
  }

  private bindInteractToRect(el: HTMLElement, rectId: string) {
    const getMinStage = () => 8 / (this.t.scale || 1);

    const it = interact(el)
      .draggable({
        listeners: {
          move: (event: { dx?: number; dy?: number }) => {
            this.selectRect(rectId);

            const r = this.rects.find((x) => x.rectId === rectId);
            if (!r) return;

            const px = normToPxRect(r, this.stageW, this.stageH);

            const dxStage = (Number(event.dx) || 0) / (this.t.scale || 1);
            const dyStage = (Number(event.dy) || 0) / (this.t.scale || 1);

            const moved: RectPx = { x: px.x + dxStage, y: px.y + dyStage, w: px.w, h: px.h };
            const clamped = clampRectPx(moved, this.stageW, this.stageH, getMinStage());

            const next = pxToNormRect(r.rectId, clamped, this.stageW, this.stageH, r.groupKey);
            Object.assign(r, next);

            this.updateRectElement(rectId);
          },
        },
      })
      .resizable({
        edges: { left: true, right: true, top: true, bottom: true },
        listeners: {
          move: (event: { deltaRect?: { left?: number; top?: number }; rect?: { width?: number; height?: number } }) => {
            this.selectRect(rectId);

            const r = this.rects.find((x) => x.rectId === rectId);
            if (!r) return;

            const s = this.t.scale || 1;
            const px = normToPxRect(r, this.stageW, this.stageH);

            const dLeft = (Number(event.deltaRect?.left) || 0) / s;
            const dTop = (Number(event.deltaRect?.top) || 0) / s;

            const wStage = (Number(event.rect?.width) || px.w * s) / s;
            const hStage = (Number(event.rect?.height) || px.h * s) / s;

            const resized: RectPx = {
              x: px.x + dLeft,
              y: px.y + dTop,
              w: wStage,
              h: hStage,
            };

            const clamped = clampRectPx(resized, this.stageW, this.stageH, getMinStage());

            const next = pxToNormRect(r.rectId, clamped, this.stageW, this.stageH, r.groupKey);
            Object.assign(r, next);

            this.updateRectElement(rectId);
          },
        },
      });

    this.interactables.set(rectId, it);
  }

  private async saveAndClose(forceMaskMode?: IOMaskMode) {
    const now = Date.now();

    const parent = (this.plugin.store?.data?.cards || {})[this.parentId];
    if (!parent) {
      new Notice("Boot Camp: IO parent missing.");
      return;
    }

    const imageRef = String(this.ioDef?.imageRef || this.imageRef || "").trim();
    if (!imageRef) {
      new Notice("Boot Camp: IO missing imageRef.");
      return;
    }

    const maskMode: IOMaskMode =
      forceMaskMode === "all" || forceMaskMode === "solo"
        ? forceMaskMode
        : isMaskMode(this.ioDef?.maskMode)
          ? (this.ioDef.maskMode as IOMaskMode)
          : "solo";

    if (this.ioDef) this.ioDef.maskMode = maskMode;

    const ioMap = this.plugin.store.data.io || {};
    this.plugin.store.data.io = ioMap;

    ioMap[this.parentId] = {
      imageRef,
      maskMode,
      rects: this.rects.map((r) => ({
        rectId: String(r.rectId),
        x: Math.max(0, Math.min(1, Number(r.x) || 0)),
        y: Math.max(0, Math.min(1, Number(r.y) || 0)),
        w: Math.max(0, Math.min(1, Number(r.w) || 0)),
        h: Math.max(0, Math.min(1, Number(r.h) || 0)),
        groupKey: normaliseGroupKey(r.groupKey),
      })),
    };

    parent.imageRef = imageRef;
    parent.maskMode = maskMode;
    parent.updatedAt = now;
    parent.lastSeenAt = now;
    this.plugin.store.upsertCard(parent);

    this.syncChildrenFromRects(parent, ioMap[this.parentId], now);

    await this.plugin.store.persist();
    new Notice("Boot Camp: IO saved.");
    this.close();
  }

  private syncChildrenFromRects(parent: CardRecord, def: IOParentDef, now: number) {
    const cards = this.plugin.store.data.cards || {};

    const groupToRectIds = new Map<string, string[]>();
    for (const r of def.rects || []) {
      const g = normaliseGroupKey(r.groupKey);
      const arr = groupToRectIds.get(g) ?? [];
      arr.push(String(r.rectId));
      groupToRectIds.set(g, arr);
    }

    const existingChildren: CardRecord[] = [];
    for (const c of Object.values(cards)) {
      if (!c) continue;
      if (String(c.type) !== "io-child") continue;
      if (String((c as CardRecord).parentId || "") !== String(this.parentId)) continue;
      existingChildren.push(c as CardRecord);
    }

    const keepChildIds = new Set<string>();

    for (const [groupKey, rectIds] of groupToRectIds.entries()) {
      const childId = stableIoChildId(this.parentId, groupKey);
      keepChildIds.add(childId);

      const titleBase = parent?.title ? String(parent.title) : "Image Occlusion";
      const childTitle = titleBase;

      const rec = {
        id: childId,
        type: "io-child",
        title: childTitle,
        parentId: this.parentId,
        groupKey,
        rectIds: rectIds.slice(),
        retired: false,

        prompt: String(parent?.prompt ?? parent?.q ?? "") || null,
        info: parent?.info ?? null,
        groups: parent?.groups ?? null,

        sourceNotePath: String(parent?.sourceNotePath || ""),
        sourceStartLine: Number(parent?.sourceStartLine ?? 0) || 0,

        imageRef: def.imageRef,
        maskMode: def.maskMode,

        updatedAt: now,
        lastSeenAt: now,
      } as CardRecord;

      const prev = cards[childId];
      if (prev && typeof prev === "object") {
        const merged = { ...prev, ...rec };
        cards[childId] = merged;
        this.plugin.store.upsertCard(merged);
      } else {
        cards[childId] = rec;
        this.plugin.store.upsertCard(rec);
      }

      this.plugin.store.ensureState(childId, now, 2.5);
    }

    for (const ch of existingChildren) {
      const id = String(ch.id || "");
      if (!id) continue;
      if (keepChildIds.has(id)) continue;

      ch.retired = true;
      ch.updatedAt = now;
      ch.lastSeenAt = now;
      this.plugin.store.upsertCard(ch);
    }
  }
}
