/**
 * modals/ImageOcclusionCreatorModal.ts
 * ---------------------------------------------------------------------------
 * Full-featured modal for creating and editing Image Occlusion (IO) cards.
 *
 * Features:
 *  - Image loading from clipboard or file picker
 *  - Drawing rectangle / ellipse occlusion masks
 *  - Text annotations (burned into the image on save)
 *  - Undo / redo history for the canvas
 *  - Crop & rotate tools
 *  - Pan & zoom (mouse wheel)
 *  - Edit mode for existing IO parents (pre-fills from store)
 *  - Saves parent + child card records and IO map to the store
 *  - Writes pipe-format markdown block to the active note
 * ---------------------------------------------------------------------------
 */

import { Modal, Notice, type App } from "obsidian";
import { log } from "../core/logger";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import { createGroupPickerField as createGroupPickerFieldImpl } from "../card-editor/card-editor";
import { normaliseGroupKey } from "../imageocclusion/mask-tool";
import { IO_EDITOR_STYLES } from "../imageocclusion/io-editor-styles";
import { renderOverlay } from "../imageocclusion/io-overlay-renderer";
import {
  buildToolbar,
  buildCanvasContainer,
  buildFooter,
  buildHeader,
  buildImageLimitDialog,
} from "../imageocclusion/io-modal-ui";

import {
  resolveImageFile as resolveIoImageFile,
  mimeFromExt,
} from "../imageocclusion/io-helpers";
import {
  setModalTitle,
  type ClipboardImage,
} from "./modal-utils";

import type { IORect, StageTransform, IOTextBox, IOHistoryEntry } from "../imageocclusion/io-types";
import {
  rotateImageData,
  cropImageData,
  burnTextBoxesIntoImageData,
  clampTextBgOpacity,
  textBgCss,
} from "../imageocclusion/io-image-ops";
import { saveIoCard } from "../imageocclusion/io-save";

// ──────────────────────────────────────────────────────────────────────────────
// ImageOcclusionCreatorModal
// ──────────────────────────────────────────────────────────────────────────────

export class ImageOcclusionCreatorModal extends Modal {
  private plugin: SproutPlugin;
  private ioImageData: ClipboardImage | null = null;
  private editParentId: string | null = null;
  private onCloseCallback?: () => void;
  private editImageRef: string | null = null;
  private titleInput?: HTMLTextAreaElement;
  private infoInput?: HTMLTextAreaElement;
  private groupsField?: ReturnType<typeof createGroupPickerFieldImpl>;

  // Canvas state
  private stageW = 1;
  private stageH = 1;
  private rects: IORect[] = [];
  private selectedRectId: string | null = null;
  private textBoxes: IOTextBox[] = [];
  private selectedTextId: string | null = null;

  // Undo/redo history
  private history: IOHistoryEntry[] = [];
  private historyIndex = -1;

  // Auto-increment groupKey counter
  private nextGroupNum = 1;

  // DOM elements for canvas
  private viewportEl?: HTMLElement;
  private stageEl?: HTMLElement;
  private overlayEl?: HTMLElement;
  private imgEl?: HTMLImageElement;
  private placeholderEl?: HTMLElement;
  private canvasContainerEl?: HTMLDivElement;
  private btnRectTool?: HTMLButtonElement;
  private btnCircleTool?: HTMLButtonElement;
  private btnTransform?: HTMLButtonElement;
  private btnUndo?: HTMLButtonElement;
  private btnRedo?: HTMLButtonElement;
  private btnCrop?: HTMLButtonElement;
  private btnText?: HTMLButtonElement;
  private imageLimitDialog?: HTMLDialogElement;
  private t: StageTransform = { scale: 1, tx: 0, ty: 0 };
  private canvasHeightDefaults = {
    height: "240px",
    minHeight: "200px",
    maxHeight: "350px",
  };

  // Drawing state
  private currentTool: "occlusion-rect" | "occlusion-circle" | "transform" | "text" | "crop" = "occlusion-rect";
  private drawing = false;
  private drawStart: { x: number; y: number } | null = null;
  private previewEl: HTMLElement | null = null;
  private cropDrawing = false;
  private cropStart: { x: number; y: number } | null = null;
  private cropPreviewEl: HTMLElement | null = null;
  private activeTextInput: HTMLTextAreaElement | null = null;
  private activeTextWrap: HTMLDivElement | null = null;
  private activeTextPos: { x: number; y: number } | null = null;
  private activeTextId: string | null = null;
  private activeTextDims: { w: number; h: number } | null = null;
  private textFontSize = 16;
  private textColor = "#111111";
  private textBgColor = "transparent";
  private textBgOpacity = 1;
  private textColorInput?: HTMLInputElement;
  private textBgInput?: HTMLInputElement;
  private textBgOpacityInput?: HTMLInputElement;

  private textDrawing = false;
  private textStart: { x: number; y: number } | null = null;
  private textPreviewEl: HTMLElement | null = null;

  constructor(app: App, plugin: SproutPlugin) {
    super(app);
    this.plugin = plugin;
  }

  /** Factory: open the modal pre-loaded for editing an existing IO parent. */
  static openForParent(plugin: SproutPlugin, parentId: string, opts?: { onClose?: () => void }) {
    const m = new ImageOcclusionCreatorModal(plugin.app, plugin);
    m.editParentId = String(parentId);
    m.onCloseCallback = opts?.onClose;
    m.open();
    return m;
  }

  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    const editing = !!this.editParentId;
    const headerTitle = editing ? "Edit Image Occlusion Card" : "Add Image Occlusion Card";
    setModalTitle(this, headerTitle);

    this.containerEl.addClass("sprout-modal-container");
    this.containerEl.addClass("sprout-modal-dim");
    this.containerEl.addClass("sprout");
    this.modalEl.addClass("bc", "sprout-modals", "sprout-io-creator");
    this.contentEl.addClass("bc");
    this.modalEl.querySelector(".modal-header")?.remove();
    this.modalEl.querySelector(".modal-close-button")?.remove();

    // Override default modal constraints for IO editor
    this.modalEl.style.setProperty("width", "min(96vw, 750px)", "important");
    this.modalEl.style.setProperty("max-width", "90%", "important");
    this.modalEl.style.setProperty("height", "auto", "important");
    this.modalEl.style.setProperty("max-height", "90%", "important");
    this.modalEl.style.setProperty("overflow", "hidden", "important");
    this.modalEl.style.setProperty("padding", "0", "important");
    this.modalEl.style.setProperty("border", "none", "important");
    this.modalEl.style.setProperty("background-color", "transparent", "important");

    const { contentEl } = this;
    contentEl.empty();

    const modalRoot = contentEl;
    modalRoot.addClass("bc", "sprout-modal", "rounded-lg", "border", "border-border", "bg-popover", "text-popover-foreground");
    modalRoot.style.setProperty("width", "100%", "important");
    modalRoot.style.setProperty("height", "auto", "important");
    modalRoot.style.setProperty("max-width", "800px", "important");
    modalRoot.style.setProperty("max-height", "90%", "important");
    modalRoot.style.setProperty("overflow-y", "scroll", "important");
    modalRoot.style.setProperty("overflow-x", "hidden", "important");
    modalRoot.style.setProperty("padding", "20px", "important");
    modalRoot.style.setProperty("display", "flex", "important");
    modalRoot.style.setProperty("flex-direction", "column", "important");
    modalRoot.style.setProperty("gap", "16px", "important");
    modalRoot.style.setProperty("box-sizing", "border-box", "important");

    // Inject scoped IO-editor styles
    const ioStyle = modalRoot.createEl("style");
    ioStyle.textContent = IO_EDITOR_STYLES;

    // ── Header ──────────────────────────────────────────────────────────────
    buildHeader(modalRoot, headerTitle, () => this.close());

    const body = modalRoot.createDiv({ cls: "bc flex flex-col gap-3" });

    // ── Image limit dialog ──────────────────────────────────────────────────
    this.imageLimitDialog = buildImageLimitDialog(modalRoot, () => this.deleteLoadedImage());

    // ── Title field ─────────────────────────────────────────────────────────
    const titleField = body.createDiv({ cls: "bc flex flex-col gap-1" });
    titleField.style.paddingTop = "15px";
    const titleLabel = titleField.createEl("label", { cls: "bc text-sm font-medium" });
    titleLabel.textContent = "Title";
    const titleInput = titleField.createEl("textarea", { cls: "bc textarea w-full" });
    titleInput.rows = 2;
    titleInput.style.resize = "none";
    titleInput.style.minHeight = "60px";
    this.titleInput = titleInput;

    // ── Canvas editor label ─────────────────────────────────────────────────
    const canvasSection = body.createDiv({ cls: "bc flex flex-col gap-2" });
    const canvasLabel = canvasSection.createEl("label", { cls: "bc text-sm font-medium" });
    canvasLabel.textContent = "Image Occlusion Editor";
    canvasLabel.createSpan({ text: "*", cls: "bc text-destructive ml-1" });

    // ── Toolbar ─────────────────────────────────────────────────────────────
    const toolbarRefs = buildToolbar(body, {
      onFileSelected: (file: File) => {
        if (this.ioImageData) {
          this.showImageLimitAlert();
          return;
        }
        void (async () => {
          try {
            const data = await file.arrayBuffer();
            this.ioImageData = { mime: file.type, data };
            await this.loadImageToCanvas();
            this.updatePlaceholderVisibility();
          } catch (e: unknown) {
            new Notice(`${BRAND}: Failed to load image (${e instanceof Error ? e.message : String(e)})`);
          }
        })();
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onSetTool: (tool) => this.setTool(tool),
      onRotate: (dir) => void this.rotateImage(dir),
    });
    this.btnUndo = toolbarRefs.btnUndo;
    this.btnRedo = toolbarRefs.btnRedo;
    this.btnTransform = toolbarRefs.btnTransform;
    this.btnRectTool = toolbarRefs.btnRectTool;
    this.btnCircleTool = toolbarRefs.btnCircleTool;
    this.btnCrop = toolbarRefs.btnCrop;

    // Set initial tool highlight
    this.setTool(this.currentTool);

    // ── Canvas container ────────────────────────────────────────────────────
    const canvasRefs = buildCanvasContainer(body, this.canvasHeightDefaults, {
      onEmptyClick: () => {
        if (this.ioImageData) return;
        toolbarRefs.fileInput.click();
      },
    });
    this.canvasContainerEl = canvasRefs.canvasContainerEl;
    this.placeholderEl = canvasRefs.placeholderEl;
    this.viewportEl = canvasRefs.viewportEl;
    this.stageEl = canvasRefs.stageEl;
    this.imgEl = canvasRefs.imgEl;
    this.overlayEl = canvasRefs.overlayEl;

    // Global paste handler
    const handlePaste = async (ev: ClipboardEvent) => {
      const clipData = ev.clipboardData;
      if (!clipData) return;

      if (this.ioImageData) {
        this.showImageLimitAlert();
        return;
      }

      const items = clipData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith("image/")) continue;
        ev.preventDefault();
        try {
          const blob = item.getAsFile();
          if (!blob) continue;
          const data = await blob.arrayBuffer();
          this.ioImageData = { mime: item.type, data };
          await this.loadImageToCanvas();
          this.updatePlaceholderVisibility();
        } catch (e: unknown) {
          new Notice(`${BRAND}: Failed to load pasted image (${e instanceof Error ? e.message : String(e)})`);
        }
        return;
      }
    };

    document.addEventListener("paste", (ev) => { void handlePaste(ev); });

    // Setup canvas mouse/keyboard interactions
    this.setupCanvasEvents();

    this.updatePlaceholderVisibility();
    this.updatePlaceholderVisibility();
    this.updateUndoRedoState();

    // ── Extra information field ──────────────────────────────────────────────
    const infoField = body.createDiv({ cls: "bc flex flex-col gap-1" });
    const infoLabel = infoField.createEl("label", { cls: "bc text-sm font-medium" });
    infoLabel.textContent = "Extra information";
    const infoInput = infoField.createEl("textarea", { cls: "bc textarea w-full" });
    infoInput.rows = 3;
    infoInput.style.resize = "none";
    infoInput.style.minHeight = "80px";
    this.infoInput = infoInput;

    // ── Groups field ────────────────────────────────────────────────────────
    const groupsField = body.createDiv({ cls: "bc flex flex-col gap-1" });
    const groupsLabel = groupsField.createEl("label", { cls: "bc text-sm font-medium" });
    groupsLabel.textContent = "Groups";
    const initialGroups = editing
      ? (this.plugin.store?.data?.cards || {})[String(this.editParentId)]?.groups
      : null;
    const initialGroupsStr = Array.isArray(initialGroups)
      ? initialGroups.join(", ")
      : typeof initialGroups === "string"
        ? initialGroups
        : "";
    const groupPickerResult = createGroupPickerFieldImpl(initialGroupsStr, 1, this.plugin);
    groupsField.appendChild(groupPickerResult.element);
    groupsField.appendChild(groupPickerResult.hiddenInput);
    this.groupsField = groupPickerResult;

    // ── Prefill when editing an existing IO card ────────────────────────────
    if (editing && this.editParentId) {
      const cardsMap = (this.plugin.store?.data?.cards || {});
      const parent = cardsMap[String(this.editParentId)];
      if (parent && String(parent.type) === "io") {
        if (this.titleInput) this.titleInput.value = String(parent.title || "Image Occlusion");
        if (this.infoInput) this.infoInput.value = String(parent.info || "");

        const ioMap = this.plugin.store?.data?.io || {};
        const def = ioMap[String(this.editParentId)] || null;
        const imageRef = String(parent.imageRef || def?.imageRef || "").trim();
        this.editImageRef = imageRef || null;

        const rects = Array.isArray(def?.rects) ? def.rects : [];
        this.rects = rects.map((r: Record<string, unknown>) => {
          const rectIdRaw = r.rectId;
          const rectId =
            typeof rectIdRaw === "string"
              ? rectIdRaw
              : typeof rectIdRaw === "number"
                ? String(rectIdRaw)
                : `rect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          return {
            rectId,
            normX: Number(r.x ?? 0) || 0,
            normY: Number(r.y ?? 0) || 0,
            normW: Number(r.w ?? 0) || 0,
            normH: Number(r.h ?? 0) || 0,
            groupKey: normaliseGroupKey(r.groupKey as string | null | undefined),
            shape: r.shape === "circle" ? "circle" : "rect",
          };
        });

        const maxGroup = this.rects.reduce((acc, r) => {
          const n = Number(String(r.groupKey).replace(/[^0-9]/g, ""));
          return Number.isFinite(n) ? Math.max(acc, n) : acc;
        }, 0);
        this.nextGroupNum = Math.max(1, maxGroup + 1);

        this.history = this.rects.length || this.textBoxes.length
          ? [
              {
                rects: this.rects.map((r) => ({ ...r })),
                texts: this.textBoxes.map((t) => ({ ...t })),
                image: this.ioImageData ? { mime: this.ioImageData.mime, data: this.ioImageData.data } : null,
              },
            ]
          : [];
        this.historyIndex = this.history.length ? 0 : -1;
        this.updateUndoRedoState();

        if (imageRef) {
          void this.loadExistingImageForEdit(imageRef, String(parent.sourceNotePath || ""));
        }
      }
    }

    // ── Save IO (delegates to io-save.ts) ──────────────────────────────────
    const saveIo = async (maskMode: "all" | "solo") => {
      try {
        const shouldClose = await saveIoCard(
          {
            plugin: this.plugin,
            app: this.app,
            editParentId: this.editParentId,
            editImageRef: this.editImageRef,
            titleVal: String(this.titleInput?.value || "").trim(),
            groupsVal: String(this.groupsField?.hiddenInput?.value || "").trim(),
            infoVal: String(this.infoInput?.value || "").trim(),
            getImageData: () => this.ioImageData,
            rects: this.rects,
            hasTextBoxes: this.textBoxes.length > 0,
            burnTextBoxes: () => this.burnTextBoxesIntoImage(),
          },
          maskMode,
        );
        if (shouldClose) this.close();
      } catch (e: unknown) {
        log.error("add failed", e);
        new Notice(`${BRAND}: add failed (${e instanceof Error ? e.message : String(e)})`);
      }
    };


    // ── Footer buttons ──────────────────────────────────────────────────────
    buildFooter(modalRoot, {
      onCancel: () => this.close(),
      onSaveAll: () => void saveIo("all"),
      onSaveSolo: () => void saveIo("solo"),
    });
  }

  // ── Tool management ───────────────────────────────────────────────────────

  private setTool(tool: "occlusion-rect" | "occlusion-circle" | "transform" | "text" | "crop") {
    const prevTool = this.currentTool;
    this.currentTool = tool;
    if (tool !== "text") {
      this.clearTextInput(false);
      this.textDrawing = false;
      this.textStart = null;
      this.clearTextPreview();
    }
    if (tool !== "crop") {
      this.cropDrawing = false;
      this.cropStart = null;
      this.clearCropPreview();
    }
    const setActive = (btn: HTMLButtonElement | undefined, active: boolean) => {
      if (!btn) return;
      btn.classList.toggle("is-active", active);
    };

    setActive(this.btnRectTool ?? undefined, tool === "occlusion-rect");
    setActive(this.btnCircleTool ?? undefined, tool === "occlusion-circle");
    setActive(this.btnTransform ?? undefined, tool === "transform");
    setActive(this.btnText ?? undefined, tool === "text");
    setActive(this.btnCrop ?? undefined, tool === "crop");
    this.updateCursor();
    if ((prevTool === "crop" || tool === "crop") && this.overlayEl) {
      this.renderRects();
    }
  }

  private updateCursor() {
    if (!this.viewportEl) return;
    if (this.currentTool === "transform") {
      this.viewportEl.style.cursor = "grab";
    } else if (this.currentTool === "text") {
      this.viewportEl.style.cursor = "crosshair";
    } else if (this.currentTool === "crop") {
      this.viewportEl.style.cursor = "crosshair";
    } else {
      this.viewportEl.style.cursor = "crosshair";
    }
  }

  // ── Placeholder / canvas sizing ───────────────────────────────────────────

  private updatePlaceholderVisibility() {
    if (!this.placeholderEl || !this.viewportEl) return;
    if (this.ioImageData) {
      this.placeholderEl.style.display = "none";
      this.viewportEl.style.display = "block";
    } else {
      this.placeholderEl.style.display = "flex";
      this.viewportEl.style.display = "none";
      this.updateCanvasHeightForImage();
    }
  }

  private updateCanvasHeightForImage() {
    if (!this.canvasContainerEl) return;
    if (!this.ioImageData) {
      this.canvasContainerEl.style.height = this.canvasHeightDefaults.height;
      this.canvasContainerEl.style.minHeight = this.canvasHeightDefaults.minHeight;
      this.canvasContainerEl.style.maxHeight = this.canvasHeightDefaults.maxHeight;
      return;
    }
    const width = this.canvasContainerEl.clientWidth || this.canvasContainerEl.getBoundingClientRect().width;
    if (!width || !this.stageW || !this.stageH) return;
    const maxHeight = 350;
    const desired = Math.max(1, Math.round((width * this.stageH) / this.stageW));
    const height = Math.min(desired, maxHeight);
    this.canvasContainerEl.style.height = `${height}px`;
    this.canvasContainerEl.style.minHeight = "0px";
    this.canvasContainerEl.style.maxHeight = `${maxHeight}px`;
  }

  // ── Image limit / delete ──────────────────────────────────────────────────

  private showImageLimitAlert() {
    if (!this.imageLimitDialog) return;
    try {
      this.imageLimitDialog.showModal();
    } catch {
      // If dialog already open, ignore
    }
  }

  private deleteLoadedImage() {
    this.ioImageData = null;
    this.rects = [];
    this.selectedRectId = null;
    this.textBoxes = [];
    this.selectedTextId = null;
    this.history = [];
    this.historyIndex = -1;
    if (this.imgEl) this.imgEl.src = "";
    if (this.stageEl) {
      this.stageEl.style.width = "1px";
      this.stageEl.style.height = "1px";
    }
    this.renderRects();
    this.updatePlaceholderVisibility();
    this.updateUndoRedoState();
    if (this.imageLimitDialog?.open) this.imageLimitDialog.close();

  }

  // ── Image loading ─────────────────────────────────────────────────────────

  private async loadImageToCanvas() {
    if (!this.ioImageData || !this.imgEl) return;

    const blob = new Blob([this.ioImageData.data], { type: this.ioImageData.mime });
    const src = URL.createObjectURL(blob);
    this.imgEl.src = src;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (this.imgEl!.complete && this.imgEl!.naturalWidth > 0) return resolve();
      this.imgEl!.addEventListener("load", done, { once: true });
      this.imgEl!.addEventListener("error", done, { once: true });
    });

    this.stageW = Math.max(1, this.imgEl.naturalWidth || 1);
    this.stageH = Math.max(1, this.imgEl.naturalHeight || 1);

    if (this.stageEl) {
      this.stageEl.style.width = `${this.stageW}px`;
      this.stageEl.style.height = `${this.stageH}px`;
    }

    if (this.viewportEl) this.viewportEl.style.display = "block";
    if (this.placeholderEl) this.placeholderEl.style.display = "none";

    this.updateCanvasHeightForImage();
    this.fitToViewport();
    this.updatePlaceholderVisibility();
    this.seedHistoryFromImage();
    this.renderRects();

  }

  private seedHistoryFromImage() {
    if (!this.ioImageData) return;
    const imgSnapshot = { mime: this.ioImageData.mime, data: this.ioImageData.data };
    if (this.historyIndex === -1 && this.history.length === 0) {
      this.history = [
        {
          rects: this.rects.map((r) => ({ ...r })),
          texts: this.textBoxes.map((t) => ({ ...t })),
          image: imgSnapshot,
        },
      ];
      this.historyIndex = 0;
      this.updateUndoRedoState();
      return;
    }
    let updated = false;
    this.history = this.history.map((entry) => {
      if (entry.image) return entry;
      updated = true;
      return {
        rects: entry.rects.map((r) => ({ ...r })),
        texts: entry.texts ? entry.texts.map((t) => ({ ...t })) : [],
        image: imgSnapshot,
      };
    });
    if (updated) this.updateUndoRedoState();
  }

  private async loadExistingImageForEdit(imageRef: string, sourceNotePath: string) {
    try {
      const file = resolveIoImageFile(this.app, sourceNotePath, imageRef);
      if (!file) {
        new Notice(`${BRAND}: IO image file not found for edit.`);
        return;
      }
      const data = await this.app.vault.readBinary?.(file);
      if (!data) throw new Error("readBinary not available");
      const mime = mimeFromExt(file.extension || "");
      this.ioImageData = { mime, data };
      await this.loadImageToCanvas();
    } catch (e: unknown) {
      new Notice(`${BRAND}: Failed to load IO image (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  // ── Viewport / transform ──────────────────────────────────────────────────

  private fitToViewport() {
    if (!this.viewportEl || !this.stageEl) return;

    const vw = this.viewportEl.clientWidth;
    const vh = this.viewportEl.clientHeight;

    const scaleX = vw / this.stageW;
    const scaleY = vh / this.stageH;
    const scale = Math.min(scaleX, scaleY);
    const tx = (vw - this.stageW * scale) / 2;
    const ty = (vh - this.stageH * scale) / 2;

    this.t = { scale, tx, ty };
    this.applyTransform();
  }

  private applyTransform() {
    if (!this.stageEl) return;
    this.stageEl.style.transform = `translate(${this.t.tx}px, ${this.t.ty}px) scale(${this.t.scale})`;

  }

  // ── Canvas event handling (mouse / keyboard) ──────────────────────────────

  private setupCanvasEvents() {
    if (!this.viewportEl) return;

    let panning = false;
    let panStart = { x: 0, y: 0, tx: 0, ty: 0 };

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (this.selectedRectId || this.selectedTextId) {
          e.preventDefault();
          this.deleteSelected();
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    this.viewportEl.addEventListener("mousedown", (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const isOnRect = !!targetEl?.closest("[data-rect-id]");
      const isOnText = !!targetEl?.closest("[data-text-id]");
      const isOnForm = !!targetEl?.closest("input,textarea,button,select");
      const isOcclusionTool = this.currentTool === "occlusion-rect" || this.currentTool === "occlusion-circle";
      const isTextTool = this.currentTool === "text";
      const isCropTool = this.currentTool === "crop";

      // Deselect when clicking on empty canvas
      if (e.target === this.viewportEl || e.target === this.stageEl || e.target === this.overlayEl) {
        this.selectedRectId = null;
        this.selectedTextId = null;
        this.renderRects();
      }

      if (isTextTool) {
        if (isOnRect || isOnText || isOnForm) return;
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        this.activeTextId = null;
        this.textDrawing = true;
        this.textStart = { x: stageX, y: stageY };
        this.updateTextPreview(stageX, stageY, stageX, stageY);
        e.preventDefault();
        return;
      }

      if (isCropTool) {
        if (isOnForm) return;
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        this.cropDrawing = true;
        this.cropStart = { x: stageX, y: stageY };
        this.updateCropPreview(stageX, stageY, stageX, stageY);
        e.preventDefault();
        return;
      }

      if (this.currentTool === "transform") {
        panning = true;
        panStart = { x: e.clientX, y: e.clientY, tx: this.t.tx, ty: this.t.ty };
        if (this.viewportEl) this.viewportEl.style.cursor = "grabbing";
        e.preventDefault();
      } else if (isOcclusionTool) {
        if (isOnRect || isOnText || isOnForm) return;
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;

        this.drawing = true;
        this.drawStart = { x: stageX, y: stageY };
        e.preventDefault();
      }
    });

    this.viewportEl.addEventListener("mousemove", (e: MouseEvent) => {
      if (panning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        this.t.tx = panStart.tx + dx;
        this.t.ty = panStart.ty + dy;
        this.applyTransform();
      } else if (this.cropDrawing && this.cropStart) {
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        this.updateCropPreview(this.cropStart.x, this.cropStart.y, stageX, stageY);
      } else if (this.textDrawing && this.textStart) {
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        this.updateTextPreview(this.textStart.x, this.textStart.y, stageX, stageY);
      } else if (this.drawing && this.drawStart) {
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        const shape = this.currentTool === "occlusion-circle" ? "circle" : "rect";

        this.updatePreview(this.drawStart.x, this.drawStart.y, stageX, stageY, shape);
      }
    });

    this.viewportEl.addEventListener("mouseup", (e: MouseEvent) => {
      if (panning) {
        panning = false;
        if (this.viewportEl) this.viewportEl.style.cursor = "grab";
      } else if (this.cropDrawing && this.cropStart) {
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        const start = this.cropStart;
        this.cropDrawing = false;
        this.cropStart = null;
        this.clearCropPreview();
        void this.finalizeCropRect(start.x, start.y, stageX, stageY);
      } else if (this.textDrawing && this.textStart) {
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;
        const start = this.textStart;
        this.textDrawing = false;
        this.textStart = null;
        this.clearTextPreview();

        const left = Math.min(start.x, stageX);
        const top = Math.min(start.y, stageY);
        let width = Math.abs(stageX - start.x);
        let height = Math.abs(stageY - start.y);
        const minSize = 5;
        if (width < minSize || height < minSize) {
          width = 220;
          height = 64;
        }
        this.openTextInput(left, top, { w: width, h: height });
      } else if (this.drawing && this.drawStart) {
        const rect = this.viewportEl!.getBoundingClientRect();
        const stageX = (e.clientX - rect.left - this.t.tx) / this.t.scale;
        const stageY = (e.clientY - rect.top - this.t.ty) / this.t.scale;

        this.finalizeRect(this.drawStart.x, this.drawStart.y, stageX, stageY);
        this.drawing = false;
        this.drawStart = null;
        this.clearPreview();
      }
    });

    this.viewportEl.addEventListener("mouseleave", () => {
      if (panning) {
        panning = false;
        if (this.viewportEl) this.updateCursor();
      }
      if (this.cropDrawing) {
        this.cropDrawing = false;
        this.cropStart = null;
        this.clearCropPreview();
      }
      if (this.textDrawing) {
        this.textDrawing = false;
        this.textStart = null;
        this.clearTextPreview();
      }
      if (this.drawing) {
        this.drawing = false;
        this.drawStart = null;
        this.clearPreview();
      }
    });

    // Scroll-wheel zoom
    this.viewportEl.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        this.doZoom(factor);
      },
      { passive: false },
    );
  }

  // ── Text background helpers (delegated to io-image-ops.ts) ─────────────

  private syncTextBgOpacityInput() {
    if (!this.textBgOpacityInput) return;
    const pct = Math.round(clampTextBgOpacity(this.textBgOpacity) * 100);
    this.textBgOpacityInput.value = String(pct);
  }

  // ── Text input (inline editing on canvas) ─────────────────────────────────

  private openTextInput(stageX: number, stageY: number, dims?: { w: number; h: number }) {
    if (!this.viewportEl) return;
    if (!this.ioImageData) {
      new Notice(`${BRAND}: add an image first.`);
      return;
    }
    this.clearTextInput(false);

    const defaultW = dims?.w ?? 220;
    const defaultH = dims?.h ?? 64;
    const editingId = this.activeTextId;
    const box = editingId ? this.textBoxes.find((t) => t.textId === editingId) : null;
    if (box) {
      this.textFontSize = box.fontSize || this.textFontSize;
      this.textColor = box.color || this.textColor;
      this.textBgColor = box.bgColor || "transparent";
      this.textBgOpacity = clampTextBgOpacity(box.bgOpacity ?? this.textBgOpacity);
      if (this.textColorInput) this.textColorInput.value = this.textColor;
      if (this.textBgInput) this.textBgInput.value = this.textBgColor !== "transparent" ? this.textBgColor : "#ffffff";
      this.syncTextBgOpacityInput();
    }
    if (!box) this.syncTextBgOpacityInput();
    const textW = box ? box.normW * this.stageW : defaultW;
    const textH = box ? box.normH * this.stageH : defaultH;
    const useX = box ? box.normX * this.stageW : stageX;
    const useY = box ? box.normY * this.stageH : stageY;

    const wrap = document.createElement("div");
    wrap.className = "bc";
    wrap.style.position = "absolute";
    wrap.style.left = `${useX * this.t.scale + this.t.tx}px`;
    wrap.style.top = `${useY * this.t.scale + this.t.ty}px`;
    wrap.style.zIndex = "20";

    const input = document.createElement("textarea");
    input.className = "bc textarea";
    input.rows = 1;
    input.placeholder = "Type text";
    input.style.width = `${Math.max(40, textW * this.t.scale)}px`;
    input.style.height = `${Math.max(30, textH * this.t.scale)}px`;
    input.style.padding = "6px 8px";
    input.style.resize = "none";
    input.style.fontSize = `${this.textFontSize}px`;
    input.style.lineHeight = "1.3";
    input.style.color = this.textColor;
    input.style.border = "1px dashed rgba(16, 185, 129, 0.6)";
    input.style.borderRadius = "6px";
    input.style.outline = "none";
    input.style.background = textBgCss(this.textBgColor, this.textBgOpacity);
    input.style.boxShadow = "0 4px 10px rgba(0,0,0,0.12)";
    wrap.appendChild(input);

    this.viewportEl.appendChild(wrap);
    this.activeTextInput = input;
    this.activeTextWrap = wrap;
    this.activeTextPos = { x: useX, y: useY };
    this.activeTextDims = { w: textW, h: textH };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        void this.commitTextInput();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.clearTextInput(true);
      }
    });
    input.addEventListener("blur", () => {
      void this.commitTextInput();
    });

    if (box) input.value = box.text || "";
    input.focus();
  }

  private clearTextInput(refocus: boolean) {
    const wrap = this.activeTextWrap;
    if (wrap) {
      const parent = wrap.parentElement;
      if (parent && parent.contains(wrap)) {
        try {
          parent.removeChild(wrap);
        } catch {
          // Defensive: blur handlers can race removal.
        }
      }
    }
    this.activeTextWrap = null;
    this.activeTextInput = null;
    this.activeTextPos = null;
    this.activeTextDims = null;
    this.activeTextId = null;
    if (refocus && this.viewportEl) this.viewportEl.focus();
  }

  private commitTextInput() {
    const input = this.activeTextInput;
    const pos = this.activeTextPos;
    if (!input || !pos) {
      this.clearTextInput(false);
      return;
    }
    const text = String(input.value || "").trim();
    const dims = this.activeTextDims || { w: 220, h: 64 };
    const editingId = this.activeTextId;
    this.clearTextInput(false);
    if (!text && editingId) {
      this.textBoxes = this.textBoxes.filter((t) => t.textId !== editingId);
      this.saveHistory();
      this.renderRects();
      return;
    }
    if (!text) return;

    if (editingId) {
      const existing = this.textBoxes.find((t) => t.textId === editingId);
      if (existing) {
        existing.text = text;
        existing.fontSize = this.textFontSize;
        existing.color = this.textColor;
        existing.bgColor = this.textBgColor;
        existing.bgOpacity = this.textBgOpacity;
      }
    } else {
      const textBox: IOTextBox = {
        textId: `text-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        normX: pos.x / this.stageW,
        normY: pos.y / this.stageH,
        normW: dims.w / this.stageW,
        normH: dims.h / this.stageH,
        text,
        fontSize: this.textFontSize,
        color: this.textColor,
        bgColor: this.textBgColor,
        bgOpacity: this.textBgOpacity,
      };
      this.textBoxes.push(textBox);
    }
    this.saveHistory();
    this.renderRects();
  }

  /** Burn all text annotation boxes into the image pixel data. */
  private async burnTextBoxesIntoImage() {
    if (!this.ioImageData || this.textBoxes.length === 0) return;
    this.ioImageData = await burnTextBoxesIntoImageData(this.ioImageData, this.textBoxes);
  }

  // ── Preview overlays (text / crop / occlusion drawing) ────────────────────

  private updateTextPreview(x1: number, y1: number, x2: number, y2: number) {
    if (!this.overlayEl) return;
    if (!this.textPreviewEl) {
      this.textPreviewEl = document.createElement("div");
      this.textPreviewEl.style.position = "absolute";
      this.textPreviewEl.style.border = "2px dashed #10b981";
      this.textPreviewEl.style.backgroundColor = "rgba(16, 185, 129, 0.08)";
      this.textPreviewEl.style.pointerEvents = "none";
      this.textPreviewEl.style.borderRadius = "6px";
      this.overlayEl.appendChild(this.textPreviewEl);
    }

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    this.textPreviewEl.style.left = `${left}px`;
    this.textPreviewEl.style.top = `${top}px`;
    this.textPreviewEl.style.width = `${Math.max(1, width)}px`;
    this.textPreviewEl.style.height = `${Math.max(1, height)}px`;
  }

  private clearTextPreview() {
    if (this.textPreviewEl) {
      this.textPreviewEl.remove();
      this.textPreviewEl = null;
    }
  }

  private updateCropPreview(x1: number, y1: number, x2: number, y2: number) {
    if (!this.overlayEl) return;
    if (!this.cropPreviewEl) {
      this.cropPreviewEl = document.createElement("div");
      this.cropPreviewEl.style.position = "absolute";
      this.cropPreviewEl.style.border = "2px dashed #10b981";
      this.cropPreviewEl.style.backgroundColor = "rgba(16, 185, 129, 0.12)";
      this.cropPreviewEl.style.pointerEvents = "none";
      this.overlayEl.appendChild(this.cropPreviewEl);
    }

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    this.cropPreviewEl.style.left = `${left}px`;
    this.cropPreviewEl.style.top = `${top}px`;
    this.cropPreviewEl.style.width = `${width}px`;
    this.cropPreviewEl.style.height = `${height}px`;
    this.cropPreviewEl.style.borderRadius = "4px";
  }

  private clearCropPreview() {
    if (this.cropPreviewEl) {
      this.cropPreviewEl.remove();
      this.cropPreviewEl = null;
    }
  }

  private async finalizeCropRect(x1: number, y1: number, x2: number, y2: number) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    if (width < 5 || height < 5) return;
    await this.cropToRect(left, top, width, height);
  }

  private updatePreview(x1: number, y1: number, x2: number, y2: number, shape: "rect" | "circle" = "rect") {
    if (!this.overlayEl) return;

    if (!this.previewEl) {
      this.previewEl = document.createElement("div");
      this.previewEl.style.position = "absolute";
      this.previewEl.style.border = "3px dashed #3b82f6";
      this.previewEl.style.backgroundColor = "rgba(59, 130, 246, 0.12)";
      this.previewEl.style.pointerEvents = "none";
      this.overlayEl.appendChild(this.previewEl);
    }

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    this.previewEl.style.left = `${left}px`;
    this.previewEl.style.top = `${top}px`;
    this.previewEl.style.width = `${width}px`;
    this.previewEl.style.height = `${height}px`;
    this.previewEl.style.borderRadius = shape === "circle" ? "50%" : "4px";
  }

  private clearPreview() {
    if (this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
    }
  }

  // ── Rect finalization ─────────────────────────────────────────────────────

  private finalizeRect(x1: number, y1: number, x2: number, y2: number) {
    const shape: "rect" | "circle" = this.currentTool === "occlusion-circle" ? "circle" : "rect";

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    if (width < 5 || height < 5) return;

    const rect: IORect = {
      rectId: `rect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      normX: left / this.stageW,
      normY: top / this.stageH,
      normW: width / this.stageW,
      normH: height / this.stageH,
      groupKey: String(this.nextGroupNum++),
      shape,
    };

    this.rects.push(rect);
    this.saveHistory();
    this.renderRects();
  }

  // ── History (undo/redo) ───────────────────────────────────────────────────

  private saveHistory() {
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    const snapshot: IOHistoryEntry = {
      rects: this.rects.map((r) => ({ ...r })),
      texts: this.textBoxes.map((t) => ({ ...t })),
      image: this.ioImageData ? { mime: this.ioImageData.mime, data: this.ioImageData.data } : null,
    };
    if (this.historyIndex === -1) {
      const base: IOHistoryEntry = { rects: [], texts: [], image: snapshot.image };
      this.history = [base, snapshot];
      this.historyIndex = 1;
    } else {
      this.history.push(snapshot);
      this.historyIndex = this.history.length - 1;
    }

    if (this.history.length > 50) {
      this.history.shift();
      this.historyIndex--;
    }
    this.updateUndoRedoState();
  }

  private undo() {
    if (this.historyIndex <= 0) return;

    this.historyIndex--;
    const snapshot = this.history[this.historyIndex];
    this.rects = snapshot.rects.map((r) => ({ ...r }));
    this.textBoxes = snapshot.texts ? snapshot.texts.map((t) => ({ ...t })) : [];
    this.ioImageData = snapshot.image ? { mime: snapshot.image.mime, data: snapshot.image.data } : null;
    if (this.ioImageData) {
      void this.loadImageToCanvas();
    } else {
      if (this.imgEl) this.imgEl.src = "";
      this.renderRects();
      this.updatePlaceholderVisibility();
    }
    this.updateUndoRedoState();
  }

  private redo() {
    if (this.historyIndex >= this.history.length - 1) return;

    this.historyIndex++;
    const snapshot = this.history[this.historyIndex];
    this.rects = snapshot.rects.map((r) => ({ ...r }));
    this.textBoxes = snapshot.texts ? snapshot.texts.map((t) => ({ ...t })) : [];
    this.ioImageData = snapshot.image ? { mime: snapshot.image.mime, data: snapshot.image.data } : null;
    if (this.ioImageData) {
      void this.loadImageToCanvas();
    } else {
      if (this.imgEl) this.imgEl.src = "";
      this.renderRects();
      this.updatePlaceholderVisibility();
    }
    this.updateUndoRedoState();
  }

  private updateUndoRedoState() {
    const canUndo = this.historyIndex > 0;
    const canRedo = this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
    const setBtnState = (btn: HTMLButtonElement | undefined, enabled: boolean) => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.setAttribute("aria-disabled", enabled ? "false" : "true");
      btn.style.opacity = enabled ? "1" : "0.35";
      btn.style.pointerEvents = enabled ? "auto" : "none";
    };
    setBtnState(this.btnUndo, canUndo);
    setBtnState(this.btnRedo, canRedo);
  }

  /** Rotate the image 90° clockwise or counter-clockwise. */
  private async rotateImage(direction: "cw" | "ccw") {
    if (!this.ioImageData) {
      new Notice(`${BRAND}: add an image first.`);
      return;
    }
    const result = await rotateImageData(this.ioImageData, direction, this.rects, this.textBoxes);
    if (!result) {
      new Notice(`${BRAND}: failed to load image for rotation.`);
      return;
    }
    this.ioImageData = result.imageData;
    this.rects = result.rects;
    this.textBoxes = result.textBoxes;
    this.selectedRectId = null;
    this.selectedTextId = null;
    this.saveHistory();
    await this.loadImageToCanvas();
  }

  /** Crop the image to the specified stage-coordinate rectangle. */
  private async cropToRect(sx: number, sy: number, sw: number, sh: number) {
    if (!this.ioImageData) {
      new Notice(`${BRAND}: add an image first.`);
      return;
    }
    const result = await cropImageData(this.ioImageData, sx, sy, sw, sh, this.rects, this.textBoxes);
    if (!result) {
      new Notice(`${BRAND}: failed to load image for crop.`);
      return;
    }
    this.ioImageData = result.imageData;
    this.rects = result.rects;
    this.selectedRectId = null;
    this.textBoxes = result.textBoxes;
    this.selectedTextId = null;
    this.saveHistory();
    await this.loadImageToCanvas();
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────

  private doZoom(factor: number) {
    if (!this.viewportEl) return;

    const rect = this.viewportEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const newScale = Math.max(0.1, Math.min(8, this.t.scale * factor));

    const dx = cx - rect.left;
    const dy = cy - rect.top;

    const scaleDiff = newScale / this.t.scale;
    this.t.tx = dx - (dx - this.t.tx) * scaleDiff;
    this.t.ty = dy - (dy - this.t.ty) * scaleDiff;
    this.t.scale = newScale;

    this.applyTransform();
  }

  // ── Selection / deletion ──────────────────────────────────────────────────

  private deleteSelected() {
    if (!this.selectedRectId && !this.selectedTextId) return;

    if (this.selectedRectId) {
      this.rects = this.rects.filter((r) => r.rectId !== this.selectedRectId);
      this.selectedRectId = null;
    }
    if (this.selectedTextId) {
      this.textBoxes = this.textBoxes.filter((t) => t.textId !== this.selectedTextId);
      this.selectedTextId = null;
    }
    this.saveHistory();
    this.renderRects();
  }

  // ── Render overlay (rects + text boxes – delegated to io-overlay-renderer) ─

  private renderRects() {
    if (!this.overlayEl) return;

    renderOverlay({
      overlayEl: this.overlayEl,
      stageW: this.stageW,
      stageH: this.stageH,
      scale: this.t.scale,
      selectedRectId: this.selectedRectId,
      selectedTextId: this.selectedTextId,
      currentTool: this.currentTool,
      preserveEls: new Set<Element | null>([this.previewEl, this.cropPreviewEl]),
      rects: this.rects,
      textBoxes: this.textBoxes,
      cb: {
        findRect: (id) => this.rects.find((r) => r.rectId === id),
        findTextBox: (id) => this.textBoxes.find((t) => t.textId === id),
        selectRect: (id) => {
          this.selectedRectId = id;
          this.selectedTextId = null;
          this.renderRects();
        },
        selectText: (id) => {
          this.selectedTextId = id;
          this.selectedRectId = null;
          this.renderRects();
        },
        saveHistory: () => this.saveHistory(),
        rerender: () => this.renderRects(),
        editTextBox: (textBox) => {
          this.selectedTextId = textBox.textId;
          this.selectedRectId = null;
          this.activeTextId = textBox.textId;
          this.textFontSize = textBox.fontSize || this.textFontSize;
          this.textColor = textBox.color || this.textColor;
          this.textBgColor = textBox.bgColor || "transparent";
          this.textBgOpacity = clampTextBgOpacity(textBox.bgOpacity ?? this.textBgOpacity);
          if (this.textColorInput) this.textColorInput.value = this.textColor;
          if (this.textBgInput) this.textBgInput.value = this.textBgColor !== "transparent" ? this.textBgColor : "#ffffff";
          this.syncTextBgOpacityInput();
          this.openTextInput(textBox.normX * (this.stageW || 1), textBox.normY * (this.stageH || 1));
        },
      },
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  onClose() {
    try {
      this.onCloseCallback?.();
    } catch (e) { log.swallow("IO modal onClose callback", e); }
    this.containerEl.removeClass("sprout-modal-container");
    this.containerEl.removeClass("sprout-modal-dim");
    this.modalEl.removeClass("bc", "sprout-modals", "sprout-io-creator");
    this.contentEl.removeClass("bc");
    this.contentEl.empty();
  }
}
