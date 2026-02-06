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

import { Modal, Notice, MarkdownView, TFile, setIcon, type App } from "obsidian";
import interact from "interactjs";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import { createGroupPickerField as createGroupPickerFieldImpl } from "../card-editor/card-editor";
import type { CardRecord } from "../core/store";
import { normaliseGroupKey, stableIoChildId } from "../imageocclusion/MaskTool";
import { syncOneFile } from "../sync/sync-engine";
import { findCardBlockRangeById } from "../reviewer/MarkdownBlock";

import {
  normaliseVaultPath,
  resolveIoImageFile,
  mimeFromExt,
  extFromMime,
  bestEffortAttachmentPath,
  writeBinaryToVault,
  reserveNewBcId,
  setModalTitle,
  setVisible,
  formatPipeField,
  buildIoMarkdownWithAnchor,
  type ClipboardImage,
} from "./modal-utils";

// ──────────────────────────────────────────────────────────────────────────────
// Local types (canvas geometry)
// ──────────────────────────────────────────────────────────────────────────────

type IORect = {
  rectId: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  groupKey: string;
  shape?: "rect" | "circle";
};

type StageTransform = { scale: number; tx: number; ty: number };

type IOTextBox = {
  textId: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  text: string;
  fontSize: number;
  color: string;
  bgColor?: string | null;
  bgOpacity?: number;
};

type IOHistoryEntry = { rects: IORect[]; texts: IOTextBox[]; image: ClipboardImage | null };

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
  private btnRotateLeft?: HTMLButtonElement;
  private btnRotateRight?: HTMLButtonElement;
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

  // Zoom slider (may be set dynamically)
  private zoomSlider?: HTMLInputElement;
  private zoomMin = 0.1;
  private zoomMax = 8;

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
    ioStyle.textContent = `
      [data-sprout-toolbar] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px;
        border-radius: 6px;
        background: var(--background);
        border: 1px solid var(--background-modifier-border);
        box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent);
        width: fit-content;
        max-width: 100%;
      }

      .sprout-io-toolbar-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
      }

      .sprout-io-toolbar-sep {
        width: 1px;
        height: 18px;
        background: var(--background-modifier-border);
        margin: 0 2px;
      }

      .sprout-io-btn {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid transparent;
        background: transparent;
        color: var(--foreground);
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
      }

      .sprout-io-btn:hover {
        background: var(--background-modifier-hover);
      }

      .sprout-io-btn.is-active {
        background: color-mix(in srgb, var(--theme-accent) 18%, transparent);
        border-color: color-mix(in srgb, var(--theme-accent) 40%, transparent);
        color: var(--theme-accent);
      }

      .sprout-io-btn.is-disabled {
        opacity: 0.4;
        pointer-events: none;
      }

      .sprout-io-btn svg {
        width: 17px;
        height: 17px;
      }

      .sprout-io-field {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background);
      }

      .sprout-io-toolbar-label {
        font-size: 11px;
        color: var(--muted-foreground);
      }

      .sprout-io-input {
        height: 26px;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 7px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background);
        color: var(--foreground);
      }

      .sprout-io-input[type="number"] {
        appearance: textfield;
      }
      .sprout-io-input[type="number"]::-webkit-outer-spin-button,
      .sprout-io-input[type="number"]::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      .sprout-io-color {
        width: 26px;
        height: 26px;
        padding: 2px;
        border-radius: 7px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background);
        cursor: pointer;
      }

      .sprout-io-zoom-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 70px;
        height: 12px;
        cursor: pointer;
        background: transparent;
        margin: 0;
        transform: rotate(-90deg);
        transform-origin: center;
      }

      .sprout-io-zoom-slider::-webkit-slider-runnable-track {
        background: color-mix(in srgb, var(--background) 70%, transparent);
        width: 70px;
        height: 12px;
        border-radius: 999px;
        border: 1px solid var(--background-modifier-border);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent);
      }

      .sprout-io-zoom-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 24px;
        height: 24px;
        border-radius: 999px;
        background: var(--background);
        border: 2px solid var(--theme-accent);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
        margin-left: -7px;
      }

      .sprout-io-zoom-slider::-moz-range-track {
        background: color-mix(in srgb, var(--background) 70%, transparent);
        width: 70px;
        height: 12px;
        border-radius: 999px;
        border: 1px solid var(--background-modifier-border);
      }

      .sprout-io-zoom-slider::-moz-range-thumb {
        width: 24px;
        height: 24px;
        border-radius: 999px;
        background: var(--background);
        border: 2px solid var(--theme-accent);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
      }

      .sprout-io-zoom-slider:focus-visible {
        outline: none;
      }

      .sprout-io-text-icon {
        position: relative;
        width: 20px;
        height: 20px;
      }

      .sprout-io-text-icon-svg {
        width: 18px;
        height: 18px;
        display: block;
      }

      .sprout-io-text-icon-letter {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        color: var(--foreground);
      }
    `;

    // ── Header ──────────────────────────────────────────────────────────────
    const headerRow = modalRoot.createDiv({ cls: "bc flex items-center justify-between gap-3 mb-1" });
    headerRow.createDiv({ text: headerTitle, cls: "bc text-lg font-semibold" });
    const headerClose = headerRow.createEl("button", {
      cls: "bc inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground focus-visible:text-foreground",
      attr: { type: "button", "data-tooltip": "Close" },
    });
    headerClose.style.setProperty("border", "none", "important");
    headerClose.style.setProperty("background", "transparent", "important");
    headerClose.style.setProperty("box-shadow", "none", "important");
    headerClose.style.setProperty("padding", "0", "important");
    headerClose.style.setProperty("cursor", "pointer", "important");
    const headerCloseIcon = headerClose.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(headerCloseIcon, "x");
    headerClose.onclick = () => this.close();

    const body = modalRoot.createDiv({ cls: "bc flex flex-col gap-3" });

    // ── Image limit dialog ──────────────────────────────────────────────────
    this.imageLimitDialog = modalRoot.createEl("dialog", { cls: "bc dialog" });
    const dlgInner = this.imageLimitDialog.createDiv({ cls: "bc flex flex-col gap-3" });
    const dlgHeader = dlgInner.createDiv({ cls: "bc" });
    dlgHeader.createEl("h2", { cls: "bc text-lg font-semibold", text: "Image already loaded" });
    dlgHeader.createEl("p", {
      cls: "bc text-sm text-muted-foreground",
      text: "Only one image per card. Remove the current image before adding another.",
    });
    const dlgFooter = dlgInner.createDiv({ cls: "bc flex justify-end gap-2" });
    const dlgCancel = dlgFooter.createEl("button", {
      cls: "bc btn inline-flex items-center justify-center px-3 h-9 text-sm",
      attr: { type: "button" },
      text: "Cancel",
    });
    dlgCancel.style.backgroundColor = "#000";
    dlgCancel.style.color = "#fff";
    dlgCancel.style.border = "1px solid #000";
    dlgCancel.onclick = () => this.imageLimitDialog?.close();

    const dlgDelete = dlgFooter.createEl("button", {
      cls: "bc btn-outline inline-flex items-center justify-center px-3 h-9 text-sm",
      attr: { type: "button" },
      text: "Delete image",
    });
    dlgDelete.style.backgroundColor = "#fff";
    dlgDelete.style.color = "var(--foreground)";
    dlgDelete.onclick = () => this.deleteLoadedImage();

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
    const toolbar = body.createDiv();
    toolbar.removeAttribute("class");
    toolbar.setAttr("role", "toolbar");
    toolbar.style.setProperty("width", "fit-content");
    toolbar.style.setProperty("max-width", "100%");
    toolbar.style.setProperty("align-self", "flex-start");
    toolbar.dataset.sproutToolbar = "1";
    toolbar.dataset.sproutToolbar = "1";

    const toolbarGroup = toolbar.createDiv({ cls: "bc sprout-io-toolbar-group" });

    const createToolbarSeparator = () => {
      return toolbarGroup.createDiv({ cls: "bc sprout-io-toolbar-sep" });
    };

    /** Helper to create icon buttons for the toolbar. */
    const createIconBtn = (
      parent: HTMLElement,
      iconName: string,
      tooltip: string,
      onClick: () => void,
      opts: { disabled?: boolean } = {},
    ) => {
      const btn = parent.createEl("button", { cls: "bc sprout-io-btn" }) as HTMLButtonElement;
      btn.type = "button";
      btn.setAttribute("data-tooltip", tooltip);

      const iconWrapper = btn.createEl("span", { cls: "bc inline-flex items-center justify-center" });
      setIcon(iconWrapper, iconName);

      btn.addEventListener("click", (ev) => {
        if (btn.disabled) return;
        ev.preventDefault();
        ev.stopPropagation();
        onClick();
      });

      if (opts.disabled) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
        btn.classList.add("is-disabled");
      }

      return btn;
    };

    // File upload button
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    toolbar.appendChild(fileInput);

    createIconBtn(toolbarGroup, "upload", "Insert from file", () => fileInput.click());

    createToolbarSeparator();

    // Undo/Redo
    this.btnUndo = createIconBtn(toolbarGroup, "undo", "Undo (Ctrl+Z)", () => this.undo()) as HTMLButtonElement;
    this.btnRedo = createIconBtn(toolbarGroup, "redo", "Redo (Ctrl+Shift+Z)", () => this.redo()) as HTMLButtonElement;

    createToolbarSeparator();

    // Move, Rectangle, Ellipse
    this.btnTransform = createIconBtn(toolbarGroup, "move", "Pan / Move", () => this.setTool("transform")) as HTMLButtonElement;
    this.btnRectTool = createIconBtn(toolbarGroup, "square", "Draw Rectangle", () => this.setTool("occlusion-rect")) as HTMLButtonElement;
    this.btnCircleTool = createIconBtn(toolbarGroup, "circle", "Draw Ellipse", () => this.setTool("occlusion-circle")) as HTMLButtonElement;

    createToolbarSeparator();

    // Crop, Rotate
    this.btnCrop = createIconBtn(toolbarGroup, "crop", "Crop image", () => this.setTool("crop")) as HTMLButtonElement;
    this.btnRotateLeft = createIconBtn(toolbarGroup, "rotate-ccw-square", "Rotate 90° left", () => void this.rotateImage("ccw")) as HTMLButtonElement;
    this.btnRotateRight = createIconBtn(toolbarGroup, "rotate-cw-square", "Rotate 90° right", () => void this.rotateImage("cw")) as HTMLButtonElement;

    // Set initial tool highlight
    this.setTool(this.currentTool);

    fileInput.addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (this.ioImageData) {
        this.showImageLimitAlert();
        return;
      }
      try {
        const data = await file.arrayBuffer();
        this.ioImageData = { mime: file.type, data };
        await this.loadImageToCanvas();
        this.updatePlaceholderVisibility();
      } catch (e: any) {
        new Notice(`${BRAND}: Failed to load image (${String(e?.message || e)})`);
      }
    });

    // ── Canvas container ────────────────────────────────────────────────────
    const canvasContainer = body.createDiv({ cls: "bc rounded-lg border border-border bg-background" });
    this.canvasContainerEl = canvasContainer;
    canvasContainer.style.position = "relative";
    canvasContainer.style.width = "100%";
    canvasContainer.style.maxWidth = "1500px";
    canvasContainer.style.height = this.canvasHeightDefaults.height;
    canvasContainer.style.minHeight = this.canvasHeightDefaults.minHeight;
    canvasContainer.style.maxHeight = this.canvasHeightDefaults.maxHeight;
    canvasContainer.style.overflow = "hidden";
    canvasContainer.style.flexShrink = "0";

    // Placeholder (shown when no image loaded)
    const placeholder = canvasContainer.createDiv({
      cls: "bc flex items-center justify-center text-muted-foreground text-sm",
    });
    placeholder.innerHTML = `Insert from file or paste an image <span class="bc inline-flex items-center gap-1 ml-1"><kbd class="bc kbd">⌘+V</kbd> / <kbd class="bc kbd">Ctrl+V</kbd></span>`;
    placeholder.style.position = "absolute";
    placeholder.style.inset = "0";
    placeholder.style.display = "flex";
    placeholder.style.alignItems = "center";
    placeholder.style.justifyContent = "center";
    placeholder.style.pointerEvents = "auto";
    placeholder.style.cursor = "pointer";
    this.placeholderEl = placeholder;
    placeholder.addEventListener("click", (e) => {
      if (this.ioImageData) return;
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });

    // Viewport (scrollable canvas area)
    this.viewportEl = canvasContainer.createDiv({ cls: "bc" });
    this.viewportEl.style.position = "absolute";
    this.viewportEl.style.top = "0";
    this.viewportEl.style.left = "0";
    this.viewportEl.style.width = "100%";
    this.viewportEl.style.height = "100%";
    this.viewportEl.style.overflow = "hidden";
    this.viewportEl.style.display = "none";

    this.stageEl = this.viewportEl.createDiv({ cls: "bc" });
    this.stageEl.style.position = "absolute";
    this.stageEl.style.top = "0";
    this.stageEl.style.left = "0";
    this.stageEl.style.transformOrigin = "0 0";

    this.imgEl = this.stageEl.createEl("img", { cls: "bc" });
    this.imgEl.style.display = "block";
    this.imgEl.style.userSelect = "none";
    this.imgEl.style.border = "1px solid var(--border)";
    this.imgEl.style.boxSizing = "border-box";
    this.imgEl.draggable = false;

    this.overlayEl = this.stageEl.createDiv({ cls: "bc" });
    this.overlayEl.style.position = "absolute";
    this.overlayEl.style.top = "0";
    this.overlayEl.style.left = "0";
    this.overlayEl.style.width = "100%";
    this.overlayEl.style.height = "100%";
    this.overlayEl.style.pointerEvents = "none";

    // Clicking empty canvas area opens file picker when no image loaded
    canvasContainer.addEventListener("click", (e) => {
      if (this.ioImageData) return;
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });

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
        } catch (e: any) {
          new Notice(`${BRAND}: Failed to load pasted image (${String(e?.message || e)})`);
        }
        return;
      }
    };

    document.addEventListener("paste", handlePaste);

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
      ? ((this.plugin.store?.data?.cards || {}) as any)?.[String(this.editParentId)]?.groups
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
      const cardsMap = (this.plugin.store?.data?.cards || {}) as Record<string, any>;
      const parent = cardsMap[String(this.editParentId)];
      if (parent && String(parent.type) === "io") {
        if (this.titleInput) this.titleInput.value = String(parent.title || "Image Occlusion");
        if (this.infoInput) this.infoInput.value = String(parent.info || "");

        const ioMap: any = (this.plugin.store?.data as any)?.io || {};
        const def = ioMap[String(this.editParentId)] || null;
        const imageRef = String(parent.imageRef || def?.imageRef || "").trim();
        this.editImageRef = imageRef || null;

        const rects = Array.isArray(def?.rects) ? def.rects : [];
        this.rects = rects.map((r: any) => ({
          rectId: String(r.rectId || `rect-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          normX: Number(r.x ?? 0) || 0,
          normY: Number(r.y ?? 0) || 0,
          normW: Number(r.w ?? 0) || 0,
          normH: Number(r.h ?? 0) || 0,
          groupKey: normaliseGroupKey(r.groupKey),
          shape: r.shape === "circle" ? "circle" : "rect",
        }));

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

    // ── Insert-at-cursor helper ─────────────────────────────────────────────
    const insertTextAtCursorOrAppend = async (active: TFile, textToInsert: string, forcePersist = false) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.file?.path === active.path && view.editor) {
        const ed = view.editor;
        const cur = ed.getCursor();
        ed.replaceRange(textToInsert, cur);

        if (forcePersist) {
          try {
            const anyView: any = view as any;
            if (typeof anyView?.save === "function") await anyView.save();
          } catch {
            // ignore
          }
          try {
            if (typeof ed.getValue === "function") {
              await this.app.vault.modify(active, ed.getValue());
            }
          } catch {
            // ignore
          }
        }
      } else {
        const txt = await this.app.vault.read(active);
        const out = (txt.endsWith("\n") ? txt : txt + "\n") + textToInsert;
        await this.app.vault.modify(active, out);
      }
    };

    // ── Save IO (maskMode: "all" = Hide All, "solo" = Hide One) ─────────────
    const saveIo = async (maskMode: "all" | "solo") => {
      try {
        const isEdit = !!this.editParentId;

        const titleVal = String(this.titleInput?.value || "").trim();
        const groupsVal = String(this.groupsField?.hiddenInput?.value || "").trim();
        const infoVal = String(this.infoInput?.value || "").trim();

        const groupsArr = groupsVal
          ? groupsVal
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean)
          : null;

        // Burn text boxes into the image before saving
        if (this.textBoxes.length) {
          await this.burnTextBoxesIntoImage();
        }

        if (isEdit) {
          const parentId = String(this.editParentId || "");
          const cardsMap = (this.plugin.store?.data?.cards || {}) as Record<string, any>;
          const parent = cardsMap[parentId];
          if (!parent || String(parent.type) !== "io") {
            new Notice(`${BRAND}: could not find IO parent to edit.`);
            return;
          }

          const ioMap: any = (this.plugin.store.data as any).io || {};
          (this.plugin.store.data as any).io = ioMap;

          const currentImageRef = String(parent.imageRef || ioMap[parentId]?.imageRef || this.editImageRef || "").trim();
          let imagePath = currentImageRef;

          if (this.ioImageData) {
            const ext = extFromMime(this.ioImageData.mime);
            if (!imagePath) {
              const baseName = `sprout-io-${parentId}.${ext}`;
              const srcFile = this.app.vault.getAbstractFileByPath(String(parent.sourceNotePath || ""));
              if (srcFile instanceof TFile) imagePath = bestEffortAttachmentPath(this.plugin, srcFile, baseName);
              else {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile instanceof TFile) imagePath = bestEffortAttachmentPath(this.plugin, activeFile, baseName);
              }
            }
            try {
              await writeBinaryToVault(this.app, imagePath, this.ioImageData.data);
            } catch (e: any) {
              new Notice(`${BRAND}: failed to save image (${String(e?.message || e)})`);
              return;
            }
          }

          if (!imagePath) {
            new Notice(`${BRAND}: IO card is missing an image.`);
            return;
          }

          const now = Date.now();
          const mask = this.rects.length > 0 ? maskMode : null;

          const parentRec: CardRecord = {
            ...parent,
            id: parentId,
            type: "io",
            title: titleVal || parent.title || "Image Occlusion",
            prompt: parent.prompt ?? null,
            info: infoVal || null,
            groups: groupsArr && groupsArr.length ? groupsArr : null,
            imageRef: normaliseVaultPath(imagePath),
            maskMode: mask,
            updatedAt: now,
            lastSeenAt: now,
          };

          this.plugin.store.upsertCard(parentRec);

          const normRects = this.rects.map((r) => ({
            rectId: String(r.rectId),
            x: Math.max(0, Math.min(1, r.normX)),
            y: Math.max(0, Math.min(1, r.normY)),
            w: Math.max(0, Math.min(1, r.normW)),
            h: Math.max(0, Math.min(1, r.normH)),
            groupKey: normaliseGroupKey(r.groupKey),
            shape: r.shape || "rect",
          }));

          ioMap[parentId] = {
            imageRef: normaliseVaultPath(imagePath),
            maskMode: mask,
            rects: normRects,
          };

          // Create/update child IO cards per group
          const groupToRectIds = new Map<string, string[]>();
          for (const r of normRects) {
            const g = normaliseGroupKey(r.groupKey);
            const arr = groupToRectIds.get(g) ?? [];
            arr.push(String(r.rectId));
            groupToRectIds.set(g, arr);
          }

          const cards = (this.plugin.store.data.cards || {}) as any;
          const keepChildIds = new Set<string>();
          const titleBase = parentRec.title || "Image Occlusion";

          for (const [groupKey, rectIds] of groupToRectIds.entries()) {
            const childId = stableIoChildId(parentId, groupKey);
            keepChildIds.add(childId);

            const rec: CardRecord = {
              id: childId,
              type: "io-child",
              title: titleBase,
              parentId,
              groupKey,
              rectIds: rectIds.slice(),
              retired: false,
              prompt: null,
              info: parentRec.info,
              groups: parentRec.groups || null,
              sourceNotePath: String(parentRec.sourceNotePath || ""),
              sourceStartLine: Number(parentRec.sourceStartLine ?? 0) || 0,
              imageRef: normaliseVaultPath(imagePath),
              maskMode: mask,
              createdAt: Number((cards[childId] as any)?.createdAt ?? now),
              updatedAt: now,
              lastSeenAt: now,
            };

            const prev = cards[childId];
            if (prev && typeof prev === "object") {
              cards[childId] = { ...prev, ...rec };
              this.plugin.store.upsertCard(cards[childId]);
            } else {
              cards[childId] = rec;
              this.plugin.store.upsertCard(rec);
            }

            this.plugin.store.ensureState(childId, now, 2.5);
          }

          // Retire stale children that no longer have a matching group
          for (const c of Object.values(cards) as any[]) {
            if (!c || c.type !== "io-child") continue;
            if (String(c.parentId) !== parentId) continue;
            if (keepChildIds.has(String(c.id))) continue;
            c.retired = true;
            c.updatedAt = now;
            c.lastSeenAt = now;
            this.plugin.store.upsertCard(c as any);
          }

          await this.plugin.store.persist();

          // Update the markdown block in the note
          try {
            const srcPath = String(parentRec.sourceNotePath || "");
            const file = this.app.vault.getAbstractFileByPath(srcPath);
            if (file instanceof TFile) {
              const text = await this.app.vault.read(file);
              const lines = text.split(/\r?\n/);
              const { start, end } = findCardBlockRangeById(lines, parentId);
              const embed = `![[${normaliseVaultPath(imagePath)}]]`;
              const ioBlock = [
                `^sprout-${parentId}`,
                ...buildIoMarkdownWithAnchor({
                  id: parentId,
                  title: titleVal || parentRec.title || undefined,
                  groups: groupsVal || undefined,
                  ioEmbed: embed,
                  info: infoVal || undefined,
                }),
              ];
              lines.splice(start, end - start, ...ioBlock);
              await this.app.vault.modify(file, lines.join("\n"));
            }
          } catch (e: any) {
            console.warn(`${BRAND}: Failed to update IO markdown`, e);
          }

          new Notice(`${BRAND}: IO updated.`);
          this.close();
          return;
        }

        // ── New IO card (not editing) ─────────────────────────────────────────

        const active = this.app.workspace.getActiveFile();
        if (!(active instanceof TFile)) {
          new Notice(`${BRAND}: open a markdown note first`);
          return;
        }

        if (!this.ioImageData) {
          new Notice(`${BRAND}: paste an image to create an IO card`);
          return;
        }

        if (this.textBoxes.length) {
          await this.burnTextBoxesIntoImage();
        }

        // Save image to vault
        const id = await reserveNewBcId(this.plugin, active);
        const ext = extFromMime(this.ioImageData.mime);
        const baseName = `sprout-io-${id}.${ext}`;
        const vaultPath = bestEffortAttachmentPath(this.plugin, active, baseName);

        try {
          await writeBinaryToVault(this.app, vaultPath, this.ioImageData.data);
        } catch (e: any) {
          new Notice(`${BRAND}: failed to save image (${String(e?.message || e)})`);
          return;
        }

        const imagePath = normaliseVaultPath(vaultPath);
        const now = Date.now();
        const mask = this.rects.length > 0 ? maskMode : null;

        // Persist parent IO card in store
        const parentRec: CardRecord = {
          id,
          type: "io",
          title: titleVal || "Image Occlusion",
          prompt: null,
          info: infoVal || null,
          groups: groupsArr && groupsArr.length ? groupsArr : null,
          imageRef: imagePath,
          maskMode: mask,
          sourceNotePath: active.path,
          sourceStartLine: 0,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
        };

        this.plugin.store.upsertCard(parentRec);

        // Persist IO definition in store.io
        const ioMap: any = (this.plugin.store.data as any).io || {};
        (this.plugin.store.data as any).io = ioMap;

        const normRects = this.rects.map((r) => ({
          rectId: String(r.rectId),
          x: Math.max(0, Math.min(1, r.normX)),
          y: Math.max(0, Math.min(1, r.normY)),
          w: Math.max(0, Math.min(1, r.normW)),
          h: Math.max(0, Math.min(1, r.normH)),
          groupKey: normaliseGroupKey(r.groupKey),
          shape: r.shape || "rect",
        }));

        ioMap[id] = {
          imageRef: imagePath,
          maskMode: mask,
          rects: normRects,
        };

        // Create child IO cards per group
        const groupToRectIds = new Map<string, string[]>();
        for (const r of normRects) {
          const g = normaliseGroupKey(r.groupKey);
          const arr = groupToRectIds.get(g) ?? [];
          arr.push(String(r.rectId));
          groupToRectIds.set(g, arr);
        }

        const cards = (this.plugin.store.data.cards || {}) as any;
        const keepChildIds = new Set<string>();
        const titleBase = parentRec.title || "Image Occlusion";

        for (const [groupKey, rectIds] of groupToRectIds.entries()) {
          const childId = stableIoChildId(id, groupKey);
          keepChildIds.add(childId);

          const rec: CardRecord = {
            id: childId,
            type: "io-child",
            title: titleBase,
            parentId: id,
            groupKey,
            rectIds: rectIds.slice(),
            retired: false,
            prompt: null,
            info: parentRec.info,
            groups: parentRec.groups || null,
            sourceNotePath: active.path,
            sourceStartLine: 0,
            imageRef: imagePath,
            maskMode: mask,
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
          };

          const prev = cards[childId];
          if (prev && typeof prev === "object") {
            cards[childId] = { ...prev, ...rec };
            this.plugin.store.upsertCard(cards[childId]);
          } else {
            cards[childId] = rec;
            this.plugin.store.upsertCard(rec);
          }

          this.plugin.store.ensureState(childId, now, 2.5);
        }

        // Retire stale children
        for (const c of Object.values(cards) as any[]) {
          if (!c || c.type !== "io-child") continue;
          if (String(c.parentId) !== id) continue;
          if (keepChildIds.has(String(c.id))) continue;
          c.retired = true;
          c.updatedAt = now;
          c.lastSeenAt = now;
          this.plugin.store.upsertCard(c as any);
        }

        await this.plugin.store.persist();

        // Write markdown block to the note
        const embed = `![[${imagePath}]]`;
        const occlusionsJson =
          normRects.length > 0
            ? JSON.stringify(
                normRects.map((r: any) => ({
                  rectId: r.rectId,
                  x: r.x,
                  y: r.y,
                  w: r.w,
                  h: r.h,
                  groupKey: r.groupKey,
                  shape: r.shape || "rect",
                })),
              )
            : null;

        const ioBlock = buildIoMarkdownWithAnchor({
          id,
          title: titleVal || undefined,
          groups: groupsVal || undefined,
          ioEmbed: embed,
          occlusionsJson,
          maskMode: mask,
          info: infoVal || undefined,
        });

        try {
          await insertTextAtCursorOrAppend(active, ioBlock.join("\n"), true);
        } catch (e: any) {
          console.warn(`${BRAND}: Failed to insert IO markdown, but card saved to store`, e);
        }

        new Notice(`${BRAND}: IO saved.`);
        this.close();
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        new Notice(`${BRAND}: add failed (${String(e?.message || e)})`);
      }
    };

    // ── Footer buttons ──────────────────────────────────────────────────────
    const footer = modalRoot.createDiv({ cls: "bc flex items-center justify-end gap-4" });
    footer.style.paddingTop = "15px";

    const cancelBtn = footer.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
    cancelBtn.type = "button";
    const cancelIcon = cancelBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(cancelIcon, "x");
    cancelBtn.createSpan({ text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const hideAllBtn = footer.createEl("button", {
      cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { "data-tooltip": "Hide All: study with all masks hidden; no context clues." },
    });
    hideAllBtn.type = "button";
    hideAllBtn.style.setProperty("background", "var(--foreground)", "important");
    hideAllBtn.style.setProperty("color", "var(--background)", "important");
    hideAllBtn.style.setProperty("border-color", "var(--foreground)", "important");
    hideAllBtn.createSpan({ text: "Hide All" });
    hideAllBtn.onclick = () => void saveIo("all");

    const hideOneBtn = footer.createEl("button", {
      cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { "data-tooltip": "Hide One: hide only the active mask; keeps context visible." },
    });
    hideOneBtn.type = "button";
    hideOneBtn.createSpan({ text: "Hide One" });
    hideOneBtn.onclick = () => void saveIo("solo");
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

    this.stageW = Math.max(1, this.imgEl!.naturalWidth || 1);
    this.stageH = Math.max(1, this.imgEl!.naturalHeight || 1);

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
      const data = await (this.app.vault as any).readBinary(file);
      const mime = mimeFromExt(String((file as any).extension || ""));
      this.ioImageData = { mime, data };
      await this.loadImageToCanvas();
    } catch (e: any) {
      new Notice(`${BRAND}: Failed to load IO image (${String(e?.message || e)})`);
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

  // ── Zoom helpers ──────────────────────────────────────────────────────────

  private setZoomScale(target: number) {
    if (!this.viewportEl) return;
    const clamped = this.clampZoomValue(target);
    if (Math.abs(clamped - this.t.scale) < 0.001) {
      this.syncZoomSlider();
      return;
    }
    const factor = clamped / this.t.scale;
    this.doZoom(factor);
  }

  private clampZoomValue(value: number) {
    return Math.max(this.zoomMin, Math.min(this.zoomMax, value));
  }

  private syncZoomSlider() {
    if (!this.zoomSlider) return;
    const current = this.clampZoomValue(this.t.scale);
    this.zoomSlider.value = current.toFixed(2);
  }

  // ── Text background helpers ───────────────────────────────────────────────

  private clampTextBgOpacity(value: number) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(1, value));
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    let s = String(hex || "").trim();
    if (!s || s === "transparent") return null;
    if (s.startsWith("#")) s = s.slice(1);
    if (s.length === 3) s = `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
    if (s.length !== 6) return null;
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    return { r, g, b };
  }

  private textBgCss(color: string | null | undefined, opacity: number | null | undefined) {
    const c = String(color || "").trim();
    if (!c || c === "transparent") return "transparent";
    const o = this.clampTextBgOpacity(opacity ?? 1);
    const rgb = this.hexToRgb(c);
    if (!rgb) return c;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${o})`;
  }

  private syncTextBgOpacityInput() {
    if (!this.textBgOpacityInput) return;
    const pct = Math.round(this.clampTextBgOpacity(this.textBgOpacity) * 100);
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
      this.textBgOpacity = this.clampTextBgOpacity(box.bgOpacity ?? this.textBgOpacity);
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
    input.style.background = this.textBgCss(this.textBgColor, this.textBgOpacity);
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

  private async commitTextInput() {
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

  // ── Text rendering on image (drawTextOnImage / burnTextBoxesIntoImage) ────

  private async drawTextOnImage(text: string, stageX: number, stageY: number, fontSize: number) {
    if (!this.ioImageData) return;
    const img = await this.loadImageElementFromData();
    if (!img) {
      new Notice(`${BRAND}: failed to load image for text.`);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const fill = this.textColor || "#111111";
    const hex = fill.replace("#", "").trim();
    let r = 255;
    let g = 255;
    let b = 255;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const stroke = luminance > 0.6 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)";
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, Math.round(fontSize / 8));

    const lines = text.split(/\r?\n/);
    const lineHeight = Math.round(fontSize * 1.3);
    let x = stageX;
    let y = stageY;
    for (const line of lines) {
      ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
      y += lineHeight;
    }

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob()), this.ioImageData?.mime || "image/png");
    });
    const data = await blob.arrayBuffer();
    this.ioImageData = { mime: this.ioImageData.mime, data };
    this.saveHistory();
    await this.loadImageToCanvas();
  }

  /** Burn all text annotation boxes into the image pixel data. */
  private async burnTextBoxesIntoImage() {
    if (!this.ioImageData || this.textBoxes.length === 0) return;
    const img = await this.loadImageElementFromData();
    if (!img) {
      new Notice(`${BRAND}: failed to load image for text.`);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);

    const wrapText = (text: string, maxWidth: number, fontSize: number) => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : [text];
    };

    for (const t of this.textBoxes) {
      const x = t.normX * img.naturalWidth;
      const y = t.normY * img.naturalHeight;
      const w = t.normW * img.naturalWidth;
      const h = t.normH * img.naturalHeight;
      if (w <= 2 || h <= 2 || !t.text.trim()) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      const bg = this.textBgCss(t.bgColor, t.bgOpacity ?? 1);
      if (bg && bg !== "transparent") {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, w, h);
      }

      const fontSize = Math.max(8, Math.round(t.fontSize || 14));
      ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      const fill = t.color || "#111111";
      const hex = fill.replace("#", "").trim();
      let r = 255;
      let g = 255;
      let b = 255;
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const stroke = luminance > 0.6 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)";
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, Math.round(fontSize / 8));

      const padding = 6;
      const maxWidth = Math.max(1, w - padding * 2);
      const lines = t.text.split(/\r?\n/);
      let cursorY = y + padding;
      for (const rawLine of lines) {
        const wrapped = wrapText(rawLine, maxWidth, fontSize);
        for (const line of wrapped) {
          ctx.strokeText(line, x + padding, cursorY);
          ctx.fillText(line, x + padding, cursorY);
          cursorY += Math.round(fontSize * 1.3);
          if (cursorY > y + h) break;
        }
        if (cursorY > y + h) break;
      }

      ctx.restore();
    }

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob()), this.ioImageData?.mime || "image/png");
    });
    const data = await blob.arrayBuffer();
    this.ioImageData = { mime: this.ioImageData.mime, data };
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

  // ── Image utilities ───────────────────────────────────────────────────────

  private async loadImageElementFromData() {
    if (!this.ioImageData) return null;
    const blob = new Blob([this.ioImageData.data], { type: this.ioImageData.mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      img.onload = done;
      img.onerror = done;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return img;
  }

  /** Rotate the image 90° clockwise or counter-clockwise. */
  private async rotateImage(direction: "cw" | "ccw") {
    if (!this.ioImageData) {
      new Notice(`${BRAND}: add an image first.`);
      return;
    }

    const img = await this.loadImageElementFromData();
    if (!img) {
      new Notice(`${BRAND}: failed to load image for rotation.`);
      return;
    }

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = srcH;
    canvas.height = srcW;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (direction === "cw") {
      ctx.translate(srcH, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, srcW);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob()), this.ioImageData?.mime || "image/png");
    });
    const data = await blob.arrayBuffer();
    this.ioImageData = { mime: this.ioImageData.mime, data };

    // Transform occlusion rects to match the new orientation
    const dstW = srcH;
    const dstH = srcW;
    this.rects = this.rects
      .map((r) => {
        const x = r.normX * srcW;
        const y = r.normY * srcH;
        const w = r.normW * srcW;
        const h = r.normH * srcH;
        let nx = 0;
        let ny = 0;
        let nw = h;
        let nh = w;

        if (direction === "cw") {
          nx = srcH - (y + h);
          ny = x;
        } else {
          nx = y;
          ny = srcW - (x + w);
        }

        return {
          ...r,
          normX: nx / dstW,
          normY: ny / dstH,
          normW: nw / dstW,
          normH: nh / dstH,
        };
      })
      .filter((r) => r.normW > 0 && r.normH > 0);

    this.textBoxes = this.textBoxes
      .map((t) => {
        const x = t.normX * srcW;
        const y = t.normY * srcH;
        const w = t.normW * srcW;
        const h = t.normH * srcH;
        let nx = 0;
        let ny = 0;
        let nw = h;
        let nh = w;

        if (direction === "cw") {
          nx = srcH - (y + h);
          ny = x;
        } else {
          nx = y;
          ny = srcW - (x + w);
        }

        return {
          ...t,
          normX: nx / dstW,
          normY: ny / dstH,
          normW: nw / dstW,
          normH: nh / dstH,
        };
      })
      .filter((t) => t.normW > 0 && t.normH > 0);

    this.selectedRectId = null;
    this.selectedTextId = null;
    this.saveHistory();
    await this.loadImageToCanvas();
  }

  private async cropToSelection() {
    if (!this.selectedRectId) {
      new Notice(`${BRAND}: select a shape to crop.`);
      return;
    }
    const selected = this.rects.find((r) => r.rectId === this.selectedRectId);
    if (!selected) return;
    await this.cropToRect(selected.normX * this.stageW, selected.normY * this.stageH, selected.normW * this.stageW, selected.normH * this.stageH);
  }

  /** Crop the image to the specified stage-coordinate rectangle. */
  private async cropToRect(sx: number, sy: number, sw: number, sh: number) {
    if (!this.ioImageData) {
      new Notice(`${BRAND}: add an image first.`);
      return;
    }
    const img = await this.loadImageElementFromData();
    if (!img) {
      new Notice(`${BRAND}: failed to load image for crop.`);
      return;
    }

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const cropX = Math.max(0, Math.min(srcW - 1, sx));
    const cropY = Math.max(0, Math.min(srcH - 1, sy));
    const cropW = Math.max(1, Math.min(srcW - cropX, sw));
    const cropH = Math.max(1, Math.min(srcH - cropY, sh));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cropW);
    canvas.height = Math.round(cropH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob()), this.ioImageData?.mime || "image/png");
    });
    const data = await blob.arrayBuffer();
    this.ioImageData = { mime: this.ioImageData.mime, data };

    const dstW = canvas.width;
    const dstH = canvas.height;
    const nextRects: IORect[] = [];
    const nextTexts: IOTextBox[] = [];

    // Remap rects to cropped coordinates (clip to crop bounds)
    for (const r of this.rects) {
      const x = r.normX * srcW;
      const y = r.normY * srcH;
      const w = r.normW * srcW;
      const h = r.normH * srcH;

      const ix0 = Math.max(cropX, x);
      const iy0 = Math.max(cropY, y);
      const ix1 = Math.min(cropX + cropW, x + w);
      const iy1 = Math.min(cropY + cropH, y + h);
      const iw = ix1 - ix0;
      const ih = iy1 - iy0;

      if (iw <= 1 || ih <= 1) continue;

      nextRects.push({
        ...r,
        normX: (ix0 - cropX) / dstW,
        normY: (iy0 - cropY) / dstH,
        normW: iw / dstW,
        normH: ih / dstH,
      });
    }

    for (const t of this.textBoxes) {
      const x = t.normX * srcW;
      const y = t.normY * srcH;
      const w = t.normW * srcW;
      const h = t.normH * srcH;

      const ix0 = Math.max(cropX, x);
      const iy0 = Math.max(cropY, y);
      const ix1 = Math.min(cropX + cropW, x + w);
      const iy1 = Math.min(cropY + cropH, y + h);
      const iw = ix1 - ix0;
      const ih = iy1 - iy0;

      if (iw <= 1 || ih <= 1) continue;

      nextTexts.push({
        ...t,
        normX: (ix0 - cropX) / dstW,
        normY: (iy0 - cropY) / dstH,
        normW: iw / dstW,
        normH: ih / dstH,
      });
    }

    this.rects = nextRects;
    this.selectedRectId = null;
    this.textBoxes = nextTexts;
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

  // ── Render overlay (rects + text boxes with interactjs drag/resize) ───────

  private renderRects() {
    if (!this.overlayEl) return;
    const stageW = this.stageW || 1;
    const stageH = this.stageH || 1;
    const scale = this.t.scale || 1;

    // Clear existing elements (preserve active previews)
    const children = Array.from(this.overlayEl.children);
    for (const child of children) {
      if (child !== this.previewEl && child !== this.cropPreviewEl) {
        try {
          interact(child as HTMLElement).unset();
        } catch {
          // ignore
        }
        child.remove();
      }
    }

    const applyStyle = (el: HTMLElement, r: IORect) => {
      el.style.left = `${r.normX * stageW}px`;
      el.style.top = `${r.normY * stageH}px`;
      el.style.width = `${r.normW * stageW}px`;
      el.style.height = `${r.normH * stageH}px`;
    };

    // Render occlusion rects
    for (const rect of this.rects) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = this.currentTool === "crop" ? "none" : "auto";
      el.setAttribute("data-rect-id", rect.rectId);
      applyStyle(el, rect);

      if (rect.shape === "circle") {
        el.style.borderRadius = "50%";
      } else {
        el.style.borderRadius = "4px";
      }

      const isSelected = rect.rectId === this.selectedRectId;
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
      groupInput.style.pointerEvents = this.currentTool === "crop" ? "none" : "auto";
      groupInput.style.cursor = "text";
      groupInput.style.zIndex = "10";
      groupInput.setAttribute("data-group-input", rect.rectId);

      groupInput.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      const getRectRef = () => this.rects.find((r) => r.rectId === rect.rectId);

      groupInput.addEventListener("change", () => {
        const r = getRectRef();
        if (r) {
          r.groupKey = groupInput.value.trim() || "1";
          this.saveHistory();
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
        this.selectedRectId = rect.rectId;
        this.selectedTextId = null;
        this.renderRects();
      });

      this.overlayEl.appendChild(el);

      const syncStyle = () => {
        const r = getRectRef();
        if (!r) return;
        applyStyle(el, r);
      };

      // Interactjs: drag + resize
      interact(el)
        .draggable({
          ignoreFrom: "input,textarea,button,select",
          listeners: {
            start: () => {
              this.selectedRectId = rect.rectId;
              this.selectedTextId = null;
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
              this.saveHistory();
              this.renderRects();
            },
          },
        })
        .resizable({
          edges: { left: true, right: true, top: true, bottom: true },
          listeners: {
            start: () => {
              this.selectedRectId = rect.rectId;
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
              this.saveHistory();
              this.renderRects();
            },
          },
        })
        .styleCursor(false);
    }

    // Render text boxes
    const applyTextStyle = (el: HTMLElement, t: IOTextBox) => {
      el.style.left = `${t.normX * stageW}px`;
      el.style.top = `${t.normY * stageH}px`;
      el.style.width = `${t.normW * stageW}px`;
      el.style.height = `${t.normH * stageH}px`;
    };

    for (const textBox of this.textBoxes) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = this.currentTool === "crop" ? "none" : "auto";
      el.setAttribute("data-text-id", textBox.textId);
      applyTextStyle(el, textBox);

      const isSelected = textBox.textId === this.selectedTextId;
      const bgCss = this.textBgCss(textBox.bgColor, textBox.bgOpacity ?? 1);
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
        this.selectedTextId = textBox.textId;
        this.selectedRectId = null;
        this.renderRects();
      });

      el.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedTextId = textBox.textId;
        this.selectedRectId = null;
        this.activeTextId = textBox.textId;
        this.textFontSize = textBox.fontSize || this.textFontSize;
        this.textColor = textBox.color || this.textColor;
        this.textBgColor = textBox.bgColor || "transparent";
        this.textBgOpacity = this.clampTextBgOpacity(textBox.bgOpacity ?? this.textBgOpacity);
        if (this.textColorInput) this.textColorInput.value = this.textColor;
        if (this.textBgInput) this.textBgInput.value = this.textBgColor !== "transparent" ? this.textBgColor : "#ffffff";
        this.syncTextBgOpacityInput();
        this.openTextInput(textBox.normX * stageW, textBox.normY * stageH);
      });

      const getTextRef = () => this.textBoxes.find((t) => t.textId === textBox.textId);

      interact(el)
        .draggable({
          listeners: {
            start: () => {
              this.selectedTextId = textBox.textId;
              this.selectedRectId = null;
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
              applyTextStyle(el, t);
            },
            end: () => {
              this.saveHistory();
              this.renderRects();
            },
          },
        })
        .resizable({
          edges: { left: true, right: true, top: true, bottom: true },
          listeners: {
            start: () => {
              this.selectedTextId = textBox.textId;
              this.selectedRectId = null;
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
              applyTextStyle(el, t);
            },
            end: () => {
              this.saveHistory();
              this.renderRects();
            },
          },
        })
        .styleCursor(false);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  onClose() {
    try {
      this.onCloseCallback?.();
    } catch {}
    this.containerEl.removeClass("sprout-modal-container");
    this.containerEl.removeClass("sprout-modal-dim");
    this.modalEl.removeClass("bc", "sprout-modals", "sprout-io-creator");
    this.contentEl.removeClass("bc");
    this.contentEl.empty();
  }
}
