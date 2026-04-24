/**
 * @file src/imageocclusion/image-mask-renderer.ts
 * @summary Implements the Image Occlusion editor modal for editing existing IO cards. Provides a full interactive canvas with image display, occlusion rectangle drawing/dragging/resizing via interactjs, pan/zoom controls, group key editing, undo/reset, and save functionality that persists changes to the store and updates the note markdown.
 *
 * @exports
 *   - ImageOcclusionEditorModal — Modal subclass providing the IO mask editor UI for existing IO parent cards
 */
import { Modal, Notice, Platform, TFile, setIcon } from "obsidian";
import interact from "interactjs";
import { t } from "../../platform/translations/translator";
import { clampRectPx, normToPxRect, pxToNormRect, rectPxFromPoints } from "./image-geometry";
import { applyStageTransform, clientToStage, zoomAt } from "./image-transform";
import { queryFirst, setCssProps } from "../../platform/core/ui";
import { isMaskMode, makeRectId, nextAutoGroupKey, normaliseGroupKey, stableIoChildId } from "./mask-tool";
import { resolveImageFile, isEditableTarget, emptyEl, } from "./io-helpers";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
export class ImageOcclusionEditorModal extends Modal {
    constructor(app, plugin, parentId, opts) {
        super(app);
        this.sourceNotePath = "";
        this.imageRef = "";
        this.stageW = 1;
        this.stageH = 1;
        this.ioDef = null;
        this.rects = [];
        this.selectedRectId = null;
        // snapshot for reset
        this.initialRects = [];
        this.initialMaskMode = "solo";
        // footer controls
        this.selectedMaskMode = "solo";
        // transform state
        this.t = { scale: 1, tx: 0, ty: 0 };
        // drawing state
        this.drawing = false;
        this.drawStart = null;
        this.previewEl = null;
        // panning state
        this.handToggle = false;
        this.spaceDown = false;
        this.panning = false;
        this.panStart = null;
        // interact handles
        this.interactables = new Map();
        // sizing constraint (viewport height = fitted image height, capped)
        this.MAX_CANVAS_H = 600;
        this.plugin = plugin;
        this.parentId = String(parentId);
        this.afterClose = opts === null || opts === void 0 ? void 0 : opts.onClose;
    }
    _tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
    }
    static openForParent(plugin, parentId, opts) {
        const m = new ImageOcclusionEditorModal(plugin.app, plugin, parentId, opts);
        m.open();
        return m;
    }
    onOpen() {
        var _a, _b, _c, _d;
        scopeModalToWorkspace(this);
        this.modalEl.addClass("lk-modals", "learnkit-io-modal");
        this.containerEl.addClass("learnkit-io-editor-modal");
        if (Platform.isMobileApp) {
            new Notice(this._tx("ui.io.desktopOnly", "Image occlusion editor is desktop-only"));
            this.close();
            return;
        }
        const parent = (((_b = (_a = this.plugin.store) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.cards) || {})[this.parentId];
        if (!parent || String(parent.type) !== "io") {
            new Notice("Select an image occlusion parent card to edit.");
            this.close();
            return;
        }
        this.sourceNotePath = String(parent.sourceNotePath || "");
        this.imageRef = String(parent.imageRef || "");
        const ioMap = ((_d = (_c = this.plugin.store) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.io) || {};
        const existing = ioMap[this.parentId];
        const imageRefFromIo = (existing === null || existing === void 0 ? void 0 : existing.imageRef) ? String(existing.imageRef) : "";
        const imageRef = (this.imageRef || imageRefFromIo).trim();
        if (!imageRef) {
            new Notice("Image occlusion card is missing an image reference.");
            this.close();
            return;
        }
        const maskMode = isMaskMode(existing === null || existing === void 0 ? void 0 : existing.maskMode) ? existing.maskMode : "solo";
        this.ioDef = {
            imageRef,
            maskMode,
            rects: Array.isArray(existing === null || existing === void 0 ? void 0 : existing.rects) ? existing.rects.map((r) => ({ ...r })) : [],
        };
        this.rects = this.ioDef.rects.map((r) => ({
            ...r,
            groupKey: normaliseGroupKey(r.groupKey),
        }));
        // snapshot for Reset
        this.initialRects = this.rects.map((r) => ({ ...r }));
        this.initialMaskMode = maskMode;
        try {
            if (this.titleEl)
                this.titleEl.hidden = true;
        }
        catch (_e) {
            // ignore
        }
        this.renderUI();
        void this.loadImageAndInit();
    }
    onClose() {
        var _a, _b, _c;
        try {
            for (const it of this.interactables.values()) {
                try {
                    (_a = it.unset) === null || _a === void 0 ? void 0 : _a.call(it);
                }
                catch (_d) {
                    // no-op
                }
            }
            this.interactables.clear();
        }
        catch (_e) {
            // no-op
        }
        try {
            if (this.onWinMove)
                window.removeEventListener("mousemove", this.onWinMove);
            if (this.onWinUp)
                window.removeEventListener("mouseup", this.onWinUp);
            (_b = this.cleanupModeMenuListener) === null || _b === void 0 ? void 0 : _b.call(this);
            this.cleanupModeMenuListener = undefined;
        }
        catch (_f) {
            // no-op
        }
        this.modalEl.removeClass("learnkit-io-modal");
        this.contentEl.empty();
        try {
            (_c = this.afterClose) === null || _c === void 0 ? void 0 : _c.call(this);
        }
        catch (_g) {
            // ignore
        }
    }
    setTool(mode) {
        var _a, _b;
        this.handToggle = mode === "transform";
        const setActive = (btn, active) => {
            btn.classList.toggle("btn", active);
            btn.classList.toggle("learnkit-btn-toolbar", !active);
            btn.classList.toggle("learnkit-is-active", active);
        };
        setActive(this.btnOcclusion, mode === "occlusion");
        setActive(this.btnTransform, mode === "transform");
        this.syncCursor();
        try {
            (_b = (_a = this.viewportEl) === null || _a === void 0 ? void 0 : _a.focus) === null || _b === void 0 ? void 0 : _b.call(_a);
        }
        catch (_c) {
            // ignore
        }
    }
    fitAndSizeViewport() {
        if (!this.viewportEl)
            return;
        const vw = Math.max(1, this.viewportEl.clientWidth || 1);
        const maxH = Math.max(1, this.MAX_CANVAS_H);
        const sW = vw / Math.max(1, this.stageW);
        const sH = maxH / Math.max(1, this.stageH);
        let s = Math.min(sW, sH, 1);
        s = Math.max(0.05, Math.min(8, s));
        const vh = Math.max(1, Math.round(this.stageH * s));
        setCssProps(this.viewportEl, "--learnkit-io-viewport-h", `${vh}px`);
        const fittedW = this.stageW * s;
        const tx = Math.round((vw - fittedW) / 2);
        const ty = 0;
        this.t = { scale: s, tx, ty };
        applyStageTransform(this.stageEl, this.t);
        this.syncZoomLabel();
    }
    syncZoomLabel() {
        if (this.zoomPctEl)
            this.zoomPctEl.textContent = `${Math.round((this.t.scale || 1) * 100)}%`;
    }
    doZoom(factor) {
        const r = this.viewportEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        this.t = zoomAt(this.viewportEl, this.t, factor, cx, cy, 0.05, 8);
        applyStageTransform(this.stageEl, this.t);
        this.syncZoomLabel();
    }
    resetOcclusionsAndView() {
        this.rects = this.initialRects.map((r) => ({ ...r }));
        if (this.ioDef)
            this.ioDef.maskMode = this.initialMaskMode;
        this.clearSelection();
        this.renderAllRects();
        this.fitAndSizeViewport();
    }
    renderUI() {
        var _a, _b, _c;
        const { contentEl } = this;
        contentEl.empty();
        const root = contentEl.createDiv({ cls: "learnkit-io-root learnkit-io-root" });
        // -------------------------
        // Top toolbar
        // -------------------------
        const toolbar = root.createDiv({
            cls: "learnkit-io-toolbar learnkit-io-toolbar rounded-xl border border-border bg-background shadow-sm px-3 py-2",
        });
        this.btnOcclusion = toolbar.createEl("button", {
            cls: "btn",
            attr: { type: "button" },
            text: "Draw occlusion",
        });
        this.btnOcclusion.onclick = () => this.setTool("occlusion");
        this.btnTransform = toolbar.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar",
            attr: { type: "button" },
            text: "Move image",
        });
        this.btnTransform.onclick = () => this.setTool("transform");
        // Input + info tooltip
        this.groupInput = toolbar.createEl("input", {
            cls: "input flex-1 min-w-[260px]",
        });
        this.groupInput.type = "text";
        this.groupInput.placeholder = "Choose a shape to change its group";
        this.groupInput.disabled = true;
        this.groupInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.target.blur();
            }
        });
        this.groupInput.addEventListener("input", () => {
            if (!this.selectedRectId)
                return;
            const r = this.rects.find((x) => x.rectId === this.selectedRectId);
            if (!r)
                return;
            r.groupKey = normaliseGroupKey(this.groupInput.value);
            this.updateRectLabel(r.rectId);
        });
        // Basecoat-style tooltip via aria + title (works even if tooltip JS isn't loaded)
        const groupInfo = toolbar.createEl("button", {
            cls: "btn-icon-ghost",
            attr: {
                type: "button",
                "aria-label": "What does the group field do?",
                title: "Group sets which rectangles are hidden together.\nSelect a rectangle, then edit this field to change its group.",
            },
        });
        {
            const ico = groupInfo.createSpan({ cls: "learnkit-io-ico learnkit-io-ico" });
            setIcon(ico, "info");
        }
        this.btnDelete = toolbar.createEl("button", {
            cls: "btn-icon-ghost",
            attr: { type: "button", "aria-label": "Delete selected occlusion" },
        });
        {
            const ico = this.btnDelete.createSpan({ cls: "learnkit-io-ico learnkit-io-ico" });
            setIcon(ico, "trash-2");
        }
        this.btnDelete.onclick = () => this.deleteSelected();
        this.btnReset = toolbar.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar",
            attr: { type: "button" },
            text: "Reset",
        });
        this.btnReset.onclick = () => this.resetOcclusionsAndView();
        // -------------------------
        // Viewport
        // -------------------------
        this.viewportEl = root.createDiv({
            cls: "learnkit-io-viewport learnkit-io-viewport rounded-xl border border-border bg-background shadow-sm",
        });
        this.viewportEl.tabIndex = 0;
        this.stageEl = this.viewportEl.createDiv({ cls: "learnkit-io-stage learnkit-io-stage" });
        this.imgEl = this.stageEl.createEl("img", { cls: "learnkit-io-img learnkit-io-img" });
        this.imgEl.alt = "Card image";
        this.imgEl.draggable = false;
        this.overlayEl = this.stageEl.createDiv({ cls: "learnkit-io-overlay learnkit-io-overlay" });
        // In-canvas controls: + / - / Fit
        const canvasControls = this.viewportEl.createDiv({
            cls: "learnkit-io-canvas-controls learnkit-io-canvas-controls rounded-xl border border-border bg-background shadow-sm px-2 py-1",
        });
        this.btnZoomIn = canvasControls.createEl("button", {
            cls: "btn-icon-outline",
            attr: { type: "button", "aria-label": "Zoom in" },
        });
        {
            const ico = this.btnZoomIn.createSpan({ cls: "learnkit-io-ico learnkit-io-ico" });
            setIcon(ico, "plus");
        }
        this.btnZoomIn.onclick = () => this.doZoom(1.2);
        this.btnZoomOut = canvasControls.createEl("button", {
            cls: "btn-icon-outline",
            attr: { type: "button", "aria-label": "Zoom out" },
        });
        {
            const ico = this.btnZoomOut.createSpan({ cls: "learnkit-io-ico learnkit-io-ico" });
            setIcon(ico, "minus");
        }
        this.btnZoomOut.onclick = () => this.doZoom(1 / 1.2);
        this.btnFit = canvasControls.createEl("button", {
            cls: "btn-icon-outline",
            attr: { type: "button", "aria-label": "Fit" },
        });
        {
            const ico = this.btnFit.createSpan({ cls: "learnkit-io-ico learnkit-io-ico" });
            setIcon(ico, "maximize-2");
        }
        this.btnFit.onclick = () => this.fitAndSizeViewport();
        this.zoomPctEl = canvasControls.createDiv({
            cls: "text-xs text-muted-foreground w-12 text-right",
            text: "100%",
        });
        // -------------------------
        // Footer (bottom-right)
        // -------------------------
        const footer = root.createDiv({ cls: "learnkit-io-footer learnkit-io-footer flex flex-col items-end gap-3" });
        // Mask mode picker row
        const modeRow = footer.createDiv({ cls: "flex flex-col gap-1 items-start w-full" });
        modeRow.createEl("label", {
            cls: "text-sm font-medium",
            text: "Type",
        });
        const modeOptions = [
            { value: "solo", label: "Basic" },
            { value: "all", label: "Hide all" },
        ];
        this.selectedMaskMode = this.initialMaskMode;
        const dropRoot = modeRow.createDiv({ cls: "learnkit learnkit relative inline-flex" });
        const trigger = dropRoot.createEl("button", {
            cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-7 px-2 text-sm inline-flex items-center gap-2",
            attr: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
        });
        const triggerLabel = trigger.createEl("span", {
            cls: "truncate",
            text: (_b = (_a = modeOptions.find((o) => o.value === this.selectedMaskMode)) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : "Basic",
        });
        const chevronWrap = trigger.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-3" });
        setIcon(chevronWrap, "chevron-down");
        const modeMenu = dropRoot.createDiv({ cls: "learnkit-io-mode-menu learnkit-io-mode-menu" });
        modeMenu.classList.add("hidden");
        for (const opt of modeOptions) {
            const item = modeMenu.createDiv({ cls: "learnkit-io-mode-menu-item learnkit-io-mode-menu-item", text: opt.label });
            if (opt.value === this.selectedMaskMode)
                item.classList.add("is-selected");
            item.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.selectedMaskMode = opt.value;
                triggerLabel.textContent = opt.label;
                modeMenu.querySelectorAll(".learnkit-io-mode-menu-item").forEach((el) => el.classList.remove("is-selected"));
                item.classList.add("is-selected");
                modeMenu.classList.add("hidden");
                trigger.setAttribute("aria-expanded", "false");
            });
        }
        trigger.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const open = !modeMenu.classList.contains("hidden");
            modeMenu.classList.toggle("hidden", open);
            trigger.setAttribute("aria-expanded", String(!open));
        });
        (_c = this.cleanupModeMenuListener) === null || _c === void 0 ? void 0 : _c.call(this);
        const onDocClick = () => {
            modeMenu.classList.add("hidden");
            trigger.setAttribute("aria-expanded", "false");
        };
        document.addEventListener("click", onDocClick);
        this.cleanupModeMenuListener = () => {
            document.removeEventListener("click", onDocClick);
        };
        // Button row
        const buttonRow = footer.createDiv({ cls: "flex items-center gap-2" });
        this.btnSave = buttonRow.createEl("button", {
            cls: "btn",
            attr: { type: "button" },
            text: "Save",
        });
        this.btnSave.onclick = () => {
            void this.saveAndClose(this.selectedMaskMode);
        };
        // default tool
        this.setTool("occlusion");
        // events
        this.bindViewportEvents();
    }
    async loadImageAndInit() {
        var _a;
        const file = resolveImageFile(this.app, this.sourceNotePath, ((_a = this.ioDef) === null || _a === void 0 ? void 0 : _a.imageRef) || "");
        if (!(file instanceof TFile)) {
            new Notice("Could not resolve image occlusion image in vault.");
            this.close();
            return;
        }
        const src = this.app.vault.getResourcePath(file);
        this.imgEl.src = src;
        await new Promise((resolve) => {
            const done = () => resolve();
            if (this.imgEl.complete && this.imgEl.naturalWidth > 0)
                return resolve();
            this.imgEl.addEventListener("load", done, { once: true });
            this.imgEl.addEventListener("error", done, { once: true });
        });
        this.stageW = Math.max(1, this.imgEl.naturalWidth || 1);
        this.stageH = Math.max(1, this.imgEl.naturalHeight || 1);
        setCssProps(this.stageEl, "--learnkit-io-stage-w", `${this.stageW}px`);
        setCssProps(this.stageEl, "--learnkit-io-stage-h", `${this.stageH}px`);
        requestAnimationFrame(() => {
            this.fitAndSizeViewport();
            this.renderAllRects();
            this.syncCursor();
            this.syncZoomLabel();
            this.viewportEl.focus();
        });
    }
    bindViewportEvents() {
        this.viewportEl.addEventListener("keydown", (e) => {
            if (e.key === " " && !e.repeat) {
                this.spaceDown = true;
                this.syncCursor();
                e.preventDefault();
                return;
            }
            if (e.key === "Delete" || e.key === "Backspace") {
                if (isEditableTarget(document.activeElement))
                    return;
                if (this.selectedRectId) {
                    e.preventDefault();
                    this.deleteSelected();
                }
                return;
            }
            if (e.key.startsWith("Arrow")) {
                if (isEditableTarget(document.activeElement))
                    return;
                if (!this.selectedRectId)
                    return;
                const stepScreen = e.shiftKey ? 10 : 1;
                const stepStage = stepScreen / (this.t.scale || 1);
                let dx = 0;
                let dy = 0;
                if (e.key === "ArrowLeft")
                    dx = -stepStage;
                else if (e.key === "ArrowRight")
                    dx = stepStage;
                else if (e.key === "ArrowUp")
                    dy = -stepStage;
                else if (e.key === "ArrowDown")
                    dy = stepStage;
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
        this.viewportEl.addEventListener("keyup", (e) => {
            if (e.key === " ") {
                this.spaceDown = false;
                this.syncCursor();
            }
        });
        this.viewportEl.addEventListener("mousedown", (e) => {
            var _a;
            if (e.button !== 0)
                return;
            const target = e.target;
            const onRect = !!((_a = target === null || target === void 0 ? void 0 : target.closest) === null || _a === void 0 ? void 0 : _a.call(target, ".learnkit-io-rect"));
            const canPan = (this.spaceDown || this.handToggle) && !onRect;
            if (!canPan)
                return;
            this.panning = true;
            this.panStart = { x: e.clientX, y: e.clientY, tx: this.t.tx, ty: this.t.ty };
            e.preventDefault();
        });
        this.overlayEl.addEventListener("mousedown", (e) => {
            var _a;
            if (e.button !== 0)
                return;
            const target = e.target;
            if (this.spaceDown || this.handToggle)
                return;
            if ((_a = target === null || target === void 0 ? void 0 : target.closest) === null || _a === void 0 ? void 0 : _a.call(target, ".learnkit-io-rect"))
                return;
            this.clearSelection();
            this.drawing = true;
            const p = clientToStage(this.stageEl, this.t, e.clientX, e.clientY);
            this.drawStart = p;
            this.previewEl = document.createElement("div");
            this.previewEl.className = "learnkit-io-preview";
            this.overlayEl.appendChild(this.previewEl);
            e.preventDefault();
        });
        this.onWinMove = (e) => {
            if (this.panning && this.panStart) {
                const dx = e.clientX - this.panStart.x;
                const dy = e.clientY - this.panStart.y;
                this.t.tx = this.panStart.tx + dx;
                this.t.ty = this.panStart.ty + dy;
                applyStageTransform(this.stageEl, this.t);
            }
            if (this.drawing && this.drawStart && this.previewEl) {
                const p = clientToStage(this.stageEl, this.t, e.clientX, e.clientY);
                const r = rectPxFromPoints(this.drawStart, p);
                const minStage = 8 / (this.t.scale || 1);
                const clamped = clampRectPx(r, this.stageW, this.stageH, minStage);
                setCssProps(this.previewEl, "--learnkit-io-left", `${clamped.x}px`);
                setCssProps(this.previewEl, "--learnkit-io-top", `${clamped.y}px`);
                setCssProps(this.previewEl, "--learnkit-io-width", `${clamped.w}px`);
                setCssProps(this.previewEl, "--learnkit-io-height", `${clamped.h}px`);
            }
        };
        this.onWinUp = (e) => {
            var _a;
            if (this.panning) {
                this.panning = false;
                this.panStart = null;
            }
            if (!this.drawing || !this.drawStart)
                return;
            const p = clientToStage(this.stageEl, this.t, e.clientX, e.clientY);
            const raw = rectPxFromPoints(this.drawStart, p);
            const minStage = 8 / (this.t.scale || 1);
            const r = clampRectPx(raw, this.stageW, this.stageH, minStage);
            (_a = this.previewEl) === null || _a === void 0 ? void 0 : _a.remove();
            this.previewEl = null;
            this.drawing = false;
            this.drawStart = null;
            if (r.w < minStage || r.h < minStage)
                return;
            const rectId = makeRectId();
            const groupKey = nextAutoGroupKey(this.rects);
            const norm = pxToNormRect(rectId, r, this.stageW, this.stageH, groupKey);
            this.rects.push(norm);
            this.renderAllRects();
            this.selectRect(rectId);
        };
        window.addEventListener("mousemove", this.onWinMove);
        window.addEventListener("mouseup", this.onWinUp);
        this.overlayEl.addEventListener("click", (e) => {
            var _a;
            const target = e.target;
            if ((_a = target === null || target === void 0 ? void 0 : target.closest) === null || _a === void 0 ? void 0 : _a.call(target, ".learnkit-io-rect"))
                return;
            this.clearSelection();
        });
    }
    syncCursor() {
        const pan = this.spaceDown || this.handToggle;
        this.viewportEl.toggleClass("learnkit-io-pan", pan);
    }
    clearSelection() {
        this.selectedRectId = null;
        this.groupInput.value = "";
        this.groupInput.disabled = true;
        this.groupInput.placeholder = "Choose a shape to change its group";
        for (const el of Array.from(this.overlayEl.querySelectorAll(".learnkit-io-rect"))) {
            el.classList.remove("selected");
        }
    }
    selectRect(rectId) {
        var _a;
        this.selectedRectId = rectId;
        for (const el of Array.from(this.overlayEl.querySelectorAll(".learnkit-io-rect"))) {
            const id = el.dataset.rectId;
            el.classList.toggle("selected", id === rectId);
        }
        const r = this.rects.find((x) => x.rectId === rectId);
        if (r) {
            this.groupInput.disabled = false;
            this.groupInput.value = String((_a = r.groupKey) !== null && _a !== void 0 ? _a : "");
            this.groupInput.placeholder = "Type a group key (e.g. 1, 2, 3)…";
        }
        else {
            this.clearSelection();
        }
    }
    deleteSelected() {
        var _a;
        const id = this.selectedRectId;
        if (!id)
            return;
        const idx = this.rects.findIndex((r) => r.rectId === id);
        if (idx >= 0)
            this.rects.splice(idx, 1);
        const el = queryFirst(this.overlayEl, `.learnkit-io-rect[data-rect-id="${CSS.escape(id)}"]`);
        el === null || el === void 0 ? void 0 : el.remove();
        const it = this.interactables.get(id);
        if (it) {
            try {
                (_a = it.unset) === null || _a === void 0 ? void 0 : _a.call(it);
            }
            catch (_b) {
                // no-op
            }
            this.interactables.delete(id);
        }
        this.clearSelection();
        this.renderAllRects();
    }
    nudgeSelected(dxStage, dyStage, minDisplayPx) {
        const id = this.selectedRectId;
        if (!id)
            return;
        const r = this.rects.find((x) => x.rectId === id);
        if (!r)
            return;
        const px = normToPxRect(r, this.stageW, this.stageH);
        const minStage = (minDisplayPx || 8) / (this.t.scale || 1);
        const moved = { x: px.x + dxStage, y: px.y + dyStage, w: px.w, h: px.h };
        const clamped = clampRectPx(moved, this.stageW, this.stageH, minStage);
        const next = pxToNormRect(r.rectId, clamped, this.stageW, this.stageH, r.groupKey);
        Object.assign(r, next);
        this.updateRectElement(r.rectId);
    }
    updateRectLabel(rectId) {
        var _a;
        const el = queryFirst(this.overlayEl, `.learnkit-io-rect[data-rect-id="${CSS.escape(rectId)}"]`);
        if (!(el instanceof HTMLElement))
            return;
        const r = this.rects.find((x) => x.rectId === rectId);
        if (!r)
            return;
        const label = queryFirst(el, ".learnkit-io-rect-label");
        if (label)
            label.textContent = String((_a = r.groupKey) !== null && _a !== void 0 ? _a : "");
    }
    updateRectElement(rectId) {
        const el = queryFirst(this.overlayEl, `.learnkit-io-rect[data-rect-id="${CSS.escape(rectId)}"]`);
        if (!(el instanceof HTMLElement))
            return;
        const r = this.rects.find((x) => x.rectId === rectId);
        if (!r)
            return;
        const px = normToPxRect(r, this.stageW, this.stageH);
        setCssProps(el, "--learnkit-io-left", `${px.x}px`);
        setCssProps(el, "--learnkit-io-top", `${px.y}px`);
        setCssProps(el, "--learnkit-io-width", `${px.w}px`);
        setCssProps(el, "--learnkit-io-height", `${px.h}px`);
        this.updateRectLabel(rectId);
    }
    renderAllRects() {
        var _a, _b;
        emptyEl(this.overlayEl);
        for (const it of this.interactables.values()) {
            try {
                (_a = it.unset) === null || _a === void 0 ? void 0 : _a.call(it);
            }
            catch (_c) {
                // no-op
            }
        }
        this.interactables.clear();
        for (const r of this.rects) {
            const px = normToPxRect(r, this.stageW, this.stageH);
            const el = this.overlayEl.createDiv({ cls: "learnkit-io-rect learnkit-io-rect" });
            el.dataset.rectId = r.rectId;
            setCssProps(el, "--learnkit-io-left", `${px.x}px`);
            setCssProps(el, "--learnkit-io-top", `${px.y}px`);
            setCssProps(el, "--learnkit-io-width", `${px.w}px`);
            setCssProps(el, "--learnkit-io-height", `${px.h}px`);
            const label = el.createDiv({ cls: "learnkit-io-rect-label learnkit-io-rect-label", text: String((_b = r.groupKey) !== null && _b !== void 0 ? _b : "") });
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
        if (this.selectedRectId)
            this.selectRect(this.selectedRectId);
    }
    bindInteractToRect(el, rectId) {
        const getMinStage = () => 8 / (this.t.scale || 1);
        const it = interact(el)
            .draggable({
            listeners: {
                move: (event) => {
                    this.selectRect(rectId);
                    const r = this.rects.find((x) => x.rectId === rectId);
                    if (!r)
                        return;
                    const px = normToPxRect(r, this.stageW, this.stageH);
                    const dxStage = (Number(event.dx) || 0) / (this.t.scale || 1);
                    const dyStage = (Number(event.dy) || 0) / (this.t.scale || 1);
                    const moved = { x: px.x + dxStage, y: px.y + dyStage, w: px.w, h: px.h };
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
                move: (event) => {
                    var _a, _b, _c, _d;
                    this.selectRect(rectId);
                    const r = this.rects.find((x) => x.rectId === rectId);
                    if (!r)
                        return;
                    const s = this.t.scale || 1;
                    const px = normToPxRect(r, this.stageW, this.stageH);
                    const dLeft = (Number((_a = event.deltaRect) === null || _a === void 0 ? void 0 : _a.left) || 0) / s;
                    const dTop = (Number((_b = event.deltaRect) === null || _b === void 0 ? void 0 : _b.top) || 0) / s;
                    const wStage = (Number((_c = event.rect) === null || _c === void 0 ? void 0 : _c.width) || px.w * s) / s;
                    const hStage = (Number((_d = event.rect) === null || _d === void 0 ? void 0 : _d.height) || px.h * s) / s;
                    const resized = {
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
    async saveAndClose(forceMaskMode) {
        var _a, _b, _c, _d;
        const now = Date.now();
        const parent = (((_b = (_a = this.plugin.store) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.cards) || {})[this.parentId];
        if (!parent) {
            new Notice("Image occlusion parent missing.");
            return;
        }
        const imageRef = String(((_c = this.ioDef) === null || _c === void 0 ? void 0 : _c.imageRef) || this.imageRef || "").trim();
        if (!imageRef) {
            new Notice("Image occlusion missing image reference.");
            return;
        }
        const maskMode = forceMaskMode === "all" || forceMaskMode === "solo"
            ? forceMaskMode
            : isMaskMode((_d = this.ioDef) === null || _d === void 0 ? void 0 : _d.maskMode)
                ? this.ioDef.maskMode
                : "solo";
        if (this.ioDef)
            this.ioDef.maskMode = maskMode;
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
        new Notice("Image occlusion saved.");
        this.close();
    }
    syncChildrenFromRects(parent, def, now) {
        var _a, _b, _c, _d, _e, _f;
        const cards = this.plugin.store.data.cards || {};
        const groupToRectIds = new Map();
        for (const r of def.rects || []) {
            const g = normaliseGroupKey(r.groupKey);
            const arr = (_a = groupToRectIds.get(g)) !== null && _a !== void 0 ? _a : [];
            arr.push(String(r.rectId));
            groupToRectIds.set(g, arr);
        }
        const existingChildren = [];
        for (const c of Object.values(cards)) {
            if (!c)
                continue;
            if (String(c.type) !== "io-child")
                continue;
            if (String((c).parentId || "") !== String(this.parentId))
                continue;
            existingChildren.push(c);
        }
        const keepChildIds = new Set();
        for (const [groupKey, rectIds] of groupToRectIds.entries()) {
            const childId = stableIoChildId(this.parentId, groupKey);
            keepChildIds.add(childId);
            const titleBase = (parent === null || parent === void 0 ? void 0 : parent.title) ? String(parent.title) : null;
            const childTitle = titleBase;
            const rec = {
                id: childId,
                type: "io-child",
                title: childTitle,
                parentId: this.parentId,
                groupKey,
                rectIds: rectIds.slice(),
                retired: false,
                prompt: String((_c = (_b = parent === null || parent === void 0 ? void 0 : parent.prompt) !== null && _b !== void 0 ? _b : parent === null || parent === void 0 ? void 0 : parent.q) !== null && _c !== void 0 ? _c : "") || null,
                info: (_d = parent === null || parent === void 0 ? void 0 : parent.info) !== null && _d !== void 0 ? _d : null,
                groups: (_e = parent === null || parent === void 0 ? void 0 : parent.groups) !== null && _e !== void 0 ? _e : null,
                sourceNotePath: String((parent === null || parent === void 0 ? void 0 : parent.sourceNotePath) || ""),
                sourceStartLine: Number((_f = parent === null || parent === void 0 ? void 0 : parent.sourceStartLine) !== null && _f !== void 0 ? _f : 0) || 0,
                imageRef: def.imageRef,
                maskMode: def.maskMode,
                updatedAt: now,
                lastSeenAt: now,
            };
            const prev = cards[childId];
            if (prev && typeof prev === "object") {
                const merged = { ...prev, ...rec };
                cards[childId] = merged;
                this.plugin.store.upsertCard(merged);
            }
            else {
                cards[childId] = rec;
                this.plugin.store.upsertCard(rec);
            }
            this.plugin.store.ensureState(childId, now, 2.5);
        }
        for (const ch of existingChildren) {
            const id = String(ch.id || "");
            if (!id)
                continue;
            if (keepChildIds.has(id))
                continue;
            delete cards[id];
            if (this.plugin.store.data.states)
                delete this.plugin.store.data.states[id];
        }
    }
}
