/**
 * @file src/modals/image-occlusion-creator-modal.ts
 * @summary Full-featured modal for creating and editing Image Occlusion (IO) cards.
 *
 * @exports
 *   - ImageOcclusionCreatorModal — Obsidian Modal subclass for IO card creation/editing
 */
import { Modal, Notice, setIcon, type App } from "obsidian";
import { t } from "../translations/translator";
import { log } from "../core/logger";
import { setCssProps } from "../core/ui";
import type LearnKitPlugin from "../../main";
import { createGroupPickerField as createGroupPickerFieldImpl, attachFlagPreviewOverlay } from "../card-editor/card-editor";
import { normaliseGroupKey } from "../../platform/image-occlusion/mask-tool";
import { renderOverlay } from "../../platform/image-occlusion/io-overlay-renderer";
import {
  buildToolbar,
  buildCanvasContainer,
  buildFooter,
} from "../../platform/image-occlusion/io-modal-ui";
import { autoDetectTextMasks } from "../../platform/image-occlusion/io-ocr";

import {
  resolveImageFile as resolveIoImageFile,
  mimeFromExt,
} from "../../platform/image-occlusion/io-helpers";
import {
  setModalTitle,
  scopeModalToWorkspace,
  type ClipboardImage,
} from "./modal-utils";

import type { IORect, StageTransform, IOTextBox, IOHistoryEntry } from "../../platform/image-occlusion/io-types";
import {
  rotateImageData,
  cropImageData,
  burnTextBoxesIntoImageData,
  clampTextBgOpacity,
  textBgCss,
} from "../../platform/image-occlusion/io-image-ops";
import { polygonClipPath } from "../../platform/image-occlusion/image-geometry";
import { saveIoCard } from "../../platform/image-occlusion/io-save";

// ──────────────────────────────────────────────────────────────────────────────
// ImageOcclusionCreatorModal
// ──────────────────────────────────────────────────────────────────────────────

export class ImageOcclusionCreatorModal extends Modal {
  private plugin: LearnKitPlugin;
  private cardKind: "io" | "hq";
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

  // DOM elements for canvas
  private viewportEl?: HTMLElement;
  private stageEl?: HTMLElement;
  private overlayEl?: HTMLElement;
  private imgEl?: HTMLImageElement;
  private placeholderEl?: HTMLElement;
  private canvasContainerEl?: HTMLDivElement;
  private btnRectTool?: HTMLButtonElement;
  private btnCircleTool?: HTMLButtonElement;
  private btnCustomTool?: HTMLButtonElement;
  private btnSmartMaskTool?: HTMLButtonElement;
  private btnTransform?: HTMLButtonElement;
  private btnUndo?: HTMLButtonElement;
  private btnRedo?: HTMLButtonElement;
  private btnAutoMask?: HTMLButtonElement;
  private btnResetMasks?: HTMLButtonElement;
  private btnCrop?: HTMLButtonElement;
  private btnText?: HTMLButtonElement;
  private t: StageTransform = { scale: 1, tx: 0, ty: 0 };
  private canvasHeightDefaults = {
    height: "300px",
    minHeight: "240px",
    maxHeight: "450px",
  };

  // Drawing state
  private currentTool: "occlusion-rect" | "occlusion-circle" | "occlusion-freehand" | "occlusion-smart-lasso" | "transform" | "text" | "crop" = "occlusion-rect";
  private drawing = false;
  private drawStart: { x: number; y: number } | null = null;
  private freehandPoints: Array<{ x: number; y: number }> = [];
  private previewEl: HTMLElement | null = null;
  private previewStrokeEl: SVGSVGElement | null = null;
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
  private autoMaskBusy = false;
  private onDocPaste?: (ev: ClipboardEvent) => void;
  private onDocKeyDown?: (ev: KeyboardEvent) => void;
  private fitRetryRaf: number | null = null;

  constructor(app: App, plugin: LearnKitPlugin, cardKind: "io" | "hq" = "io") {
    super(app);
    this.plugin = plugin;
    this.cardKind = cardKind;
  }

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>): string {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  /** Factory: open the modal pre-loaded for editing an existing IO parent. */
  static openForParent(plugin: LearnKitPlugin, parentId: string, opts?: { onClose?: () => void }) {
    const parent = (plugin.store?.data?.cards || {})[String(parentId)];
    const cardKind = String(parent?.type || "").startsWith("hq") ? "hq" : "io";
    const m = new ImageOcclusionCreatorModal(plugin.app, plugin, cardKind);
    m.editParentId = String(parentId);
    m.onCloseCallback = opts?.onClose;
    m.open();
    return m;
  }

  private isHotspotMode(): boolean {
    return this.cardKind === "hq";
  }

  private getCreatorLabel(): string {
    return this.isHotspotMode() ? "Hotspot" : "Image Occlusion";
  }

  private getEffectiveInteractionMode(): "click" | "drag-drop" | null {
    if (!this.isHotspotMode()) return null;
    const rawMode = String(this.plugin.settings?.cards?.hotspotSingleInteractionMode || "smart").trim().toLowerCase();
    if (rawMode === "all" || rawMode === "drag-drop") return "drag-drop";
    if (rawMode === "individual" || rawMode === "click") return "click";
    return this.rects.length > 1 ? "drag-drop" : "click";
  }

  private refreshHotspotInteractionControls(): void {
    // Interaction mode is now driven by card settings + hotspot count.
  }

  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    const editing = !!this.editParentId;
    const creatorLabel = this.getCreatorLabel();
    const headerTitle = editing ? `Edit ${creatorLabel} Card` : `Add ${creatorLabel} Card`;
    setModalTitle(this, headerTitle);

    scopeModalToWorkspace(this);
    this.containerEl.addClass("lk-modal-container");
    this.containerEl.addClass("lk-modal-dim");
    this.containerEl.addClass("learnkit");
    this.modalEl.addClass("lk-modals", "learnkit-io-creator", "learnkit-io-creator-modal");
    this.contentEl.addClass("learnkit-io-creator-content");

    // Escape key behavior: first exits focused input, second closes the modal.
    this.scope.register([], "Escape", () => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInsideModal = !!activeEl && this.modalEl.contains(activeEl);
      const isEditable =
        !!activeEl &&
        (activeEl.matches("input,textarea,select") ||
          activeEl.isContentEditable ||
          activeEl.getAttribute("contenteditable") === "true");

      if (isInsideModal && isEditable) {
        activeEl.blur();
        return false;
      }

      this.close();
      return false;
    });

    const { contentEl } = this;
    contentEl.empty();

    const headerEl = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header");
    if (headerEl) {
      const titleEl = headerEl.querySelector<HTMLElement>(":scope > .modal-title");
      if (titleEl) titleEl.setText(headerTitle);

      const existingCloseBtn = headerEl.querySelector<HTMLElement>(":scope > .learnkit-io-creator-close-btn");
      if (existingCloseBtn) existingCloseBtn.remove();
      const legacyHeaderClose = headerEl.querySelector<HTMLElement>(":scope > .modal-close-button");
      if (legacyHeaderClose) legacyHeaderClose.remove();

      const closeBtn = headerEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn learnkit-io-creator-close-btn learnkit-io-creator-close-btn",
        attr: { type: "button", "aria-label": "Close" },
      });
      closeBtn.setAttr("data-tooltip-position", "top");
      const closeIconWrap = closeBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(closeIconWrap, "x");
      closeBtn.addEventListener("click", () => this.close());
    }

    const legacyRootClose = this.modalEl.querySelector<HTMLElement>(":scope > .modal-close-button");
    if (legacyRootClose) legacyRootClose.remove();

    const existingFooter = this.modalEl.querySelector<HTMLElement>(":scope > .learnkit-io-footer");
    if (existingFooter) existingFooter.remove();

    const modalRoot = contentEl;
    modalRoot.addClass("learnkit-io-creator-root");

    const body = modalRoot.createDiv({ cls: "flex flex-col gap-4" });

    // ── Title field ─────────────────────────────────────────────────────────
    const titleField = body.createDiv({ cls: "flex flex-col gap-1 learnkit-io-title-field learnkit-io-title-field" });
    const titleLabel = titleField.createEl("label", { cls: "text-sm font-medium" });
    titleLabel.textContent = "Title";
    const titleInput = titleField.createEl("textarea", { cls: "textarea w-full learnkit-io-title-input learnkit-io-title-input" });
    titleInput.rows = 1;
    setCssProps(titleInput, "min-height", "60px");
    setCssProps(titleInput, "height", "60px");
    setCssProps(titleInput, "max-height", "150px");
    titleField.appendChild(
      attachFlagPreviewOverlay(titleInput, 60, 150, {
        preferInlineControlHeight: true,
        deferMeasuredHeightUntilInteraction: true,
      }),
    );
    this.titleInput = titleInput;

    // ── Canvas editor label ─────────────────────────────────────────────────
    const canvasSection = body.createDiv({ cls: "flex flex-col gap-2" });
    const canvasLabel = canvasSection.createEl("label", { cls: "text-sm font-medium" });
    canvasLabel.textContent = this.isHotspotMode() ? "Hotspot editor" : "Image occlusion editor";
    canvasLabel.createSpan({ text: "*", cls: "text-destructive ml-1" });

    // ── Toolbar ─────────────────────────────────────────────────────────────
    const toolbarRefs = buildToolbar(body, {
      onFileSelected: (file: File) => {
        if (this.ioImageData) {
          this.deleteLoadedImage();
        }
        void (async () => {
          try {
            const data = await file.arrayBuffer();
            this.ioImageData = { mime: file.type, data };
            await this.loadImageToCanvas();
            this.updatePlaceholderVisibility();
          } catch (e: unknown) {
            new Notice(`Failed to load image (${e instanceof Error ? e.message : String(e)})`);
          }
        })();
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onAutoMask: () => void this.runAutoMask(),
      onResetMasks: () => this.resetMasks(),
      onSetTool: (tool) => this.setTool(tool),
      onRotate: (dir) => void this.rotateImage(dir),
    });
    this.btnUndo = toolbarRefs.btnUndo;
    this.btnRedo = toolbarRefs.btnRedo;
    this.btnAutoMask = toolbarRefs.btnAutoMask;
    this.btnResetMasks = toolbarRefs.btnResetMasks;
    this.btnTransform = toolbarRefs.btnTransform;
    this.btnRectTool = toolbarRefs.btnRectTool;
    this.btnCircleTool = toolbarRefs.btnCircleTool;
    this.btnCustomTool = toolbarRefs.btnCustomTool;
    this.btnSmartMaskTool = toolbarRefs.btnSmartMaskTool;
    this.btnCrop = toolbarRefs.btnCrop;

    if (this.isHotspotMode() && this.btnAutoMask) {
      this.btnAutoMask.remove();
      this.btnAutoMask = undefined;
    }

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
    if (this.canvasContainerEl) this.canvasContainerEl.classList.add("learnkit-io-canvas", "learnkit-io-canvas");
    if (this.canvasContainerEl) this.canvasContainerEl.tabIndex = 0;
    if (this.stageEl) this.stageEl.classList.add("learnkit-io-stage", "learnkit-io-stage");
    if (this.viewportEl) this.viewportEl.tabIndex = 0;

    // Global paste handler
    const handlePaste = async (ev: ClipboardEvent) => {
      const clipData = ev.clipboardData;
      if (!clipData) return;

      const items = Array.from(clipData.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;

      // Capture image pastes while IO modal is open so they never land in text inputs.
      ev.preventDefault();
      ev.stopPropagation();

      if (this.ioImageData) {
        this.deleteLoadedImage();
      }

      try {
        const blob = imageItem.getAsFile();
        if (!blob) return;
        const data = await blob.arrayBuffer();
        this.ioImageData = { mime: imageItem.type, data };
        await this.loadImageToCanvas();
        this.updatePlaceholderVisibility();
      } catch (e: unknown) {
        new Notice(`Failed to load pasted image (${e instanceof Error ? e.message : String(e)})`);
      }
    };

    this.onDocPaste = (ev: ClipboardEvent) => { void handlePaste(ev); };
    document.addEventListener("paste", this.onDocPaste, true);

    // Setup canvas mouse/keyboard interactions
    this.setupCanvasEvents();

    this.updatePlaceholderVisibility();
    this.updateUndoRedoState();
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();

    // ── Extra information field ──────────────────────────────────────────────
    const infoField = body.createDiv({ cls: "flex flex-col gap-1" });
    const infoLabel = infoField.createEl("label", { cls: "text-sm font-medium" });
    infoLabel.textContent = "Extra information";
    const infoInput = infoField.createEl("textarea", { cls: "textarea w-full learnkit-io-info-input learnkit-io-info-input" });
    infoInput.rows = 1;
    setCssProps(infoInput, "min-height", "60px");
    setCssProps(infoInput, "height", "60px");
    setCssProps(infoInput, "max-height", "150px");
    infoField.appendChild(
      attachFlagPreviewOverlay(infoInput, 60, 150, {
        preferInlineControlHeight: true,
        deferMeasuredHeightUntilInteraction: true,
      }),
    );
    this.infoInput = infoInput;

    // ── Groups field ────────────────────────────────────────────────────────
    const groupsField = body.createDiv({ cls: "flex flex-col gap-1" });
    const groupsLabel = groupsField.createEl("label", { cls: "text-sm font-medium" });
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
      if (parent && (String(parent.type) === "io" || String(parent.type) === "hq")) {
        if (this.titleInput) this.titleInput.value = String(parent.title || "");
        if (this.infoInput) this.infoInput.value = String(parent.info || "");

        const def = this.isHotspotMode()
          ? (this.plugin.store?.data?.hq || {})[String(this.editParentId)] || null
          : (this.plugin.store?.data?.io || {})[String(this.editParentId)] || null;
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
          const shape = r.shape === "circle" ? "circle" : r.shape === "polygon" ? "polygon" : "rect";
          const points = shape === "polygon" && Array.isArray(r.points)
            ? r.points
                .map((p) => {
                  if (!p || typeof p !== "object") return null;
                  const point = p as Record<string, unknown>;
                  const x = Number(point.x ?? 0);
                  const y = Number(point.y ?? 0);
                  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
                })
                .filter((p): p is { x: number; y: number } => !!p)
            : [];
          return {
            rectId,
            normX: Number(r.x ?? 0) || 0,
            normY: Number(r.y ?? 0) || 0,
            normW: Number(r.w ?? 0) || 0,
            normH: Number(r.h ?? 0) || 0,
            groupKey: normaliseGroupKey(r.groupKey as string | null | undefined),
            label: typeof r.label === "string" && r.label.trim()
              ? r.label.trim()
              : normaliseGroupKey(r.groupKey as string | null | undefined),
            shape,
            points: points.length >= 3 ? points : undefined,
          };
        });

        this.history = this.rects.length || this.textBoxes.length
          ? [
              {
                rects: this.rects.map((r) => this.cloneRect(r)),
                texts: this.textBoxes.map((t) => ({ ...t })),
                image: this.ioImageData ? { mime: this.ioImageData.mime, data: this.ioImageData.data } : null,
              },
            ]
          : [];
        this.historyIndex = this.history.length ? 0 : -1;
        this.updateUndoRedoState();
        this.updateResetMasksButtonState();

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
            cardKind: this.cardKind,
            editParentId: this.editParentId,
            editImageRef: this.editImageRef,
            titleVal: String(this.titleInput?.value || "").trim(),
            groupsVal: String(this.groupsField?.hiddenInput?.value || "").trim(),
            infoVal: String(this.infoInput?.value || "").trim(),
            interactionMode: this.getEffectiveInteractionMode(),
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
        new Notice(`Add failed (${e instanceof Error ? e.message : String(e)})`);
      }
    };

    // Determine default mode (from settings or existing card)
    let defaultMode: "solo" | "all" = this.plugin.settings?.imageOcclusion?.defaultMaskMode || "solo";
    if (!this.isHotspotMode() && editing && this.editParentId) {
      const ioMap = this.plugin.store?.data?.io || {};
      const def = ioMap[String(this.editParentId)] || null;
      if (def && (def.maskMode === "solo" || def.maskMode === "all")) {
        defaultMode = def.maskMode;
      }
    }

    // ── Footer buttons ──────────────────────────────────────────────────────
    const footerRefs = buildFooter(this.modalEl, {
      onCancel: () => this.close(),
      onSave: (mode) => void saveIo(mode),
    }, defaultMode);

    // Move the mode picker into content so footer contains action buttons only.
    const modeRow = footerRefs.footerEl.firstElementChild;
    if (modeRow) {
      if (this.isHotspotMode()) modeRow.remove();
      else body.appendChild(modeRow);
    }

    // Flatten footer structure to match Add modal: footer directly contains action buttons.
    const footerButtonRow = footerRefs.footerEl.firstElementChild;
    if (footerButtonRow) {
      while (footerButtonRow.firstChild) {
        footerRefs.footerEl.appendChild(footerButtonRow.firstChild);
      }
      footerButtonRow.remove();
    }

    requestAnimationFrame(() => {
      (this.canvasContainerEl ?? this.viewportEl)?.focus();
    });
  }

  // ── Tool management ───────────────────────────────────────────────────────

  private setTool(tool: "occlusion-rect" | "occlusion-circle" | "occlusion-freehand" | "occlusion-smart-lasso" | "transform" | "text" | "crop") {
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
    setActive(this.btnCustomTool ?? undefined, tool === "occlusion-freehand");
    setActive(this.btnSmartMaskTool ?? undefined, tool === "occlusion-smart-lasso");
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
    this.viewportEl.classList.remove("learnkit-cursor-grab", "learnkit-cursor-grab", "learnkit-cursor-crosshair", "learnkit-cursor-crosshair");
    if (this.currentTool === "transform") {
      this.viewportEl.classList.add("learnkit-cursor-grab", "learnkit-cursor-grab");
    } else {
      this.viewportEl.classList.add("learnkit-cursor-crosshair", "learnkit-cursor-crosshair");
    }
  }

  private isFreehandMaskTool(tool: typeof this.currentTool = this.currentTool): boolean {
    return tool === "occlusion-freehand" || tool === "occlusion-smart-lasso";
  }

  // ── Placeholder / canvas sizing ───────────────────────────────────────────

  private updatePlaceholderVisibility() {
    if (!this.placeholderEl || !this.viewportEl) return;
    if (this.ioImageData) {
      this.placeholderEl.classList.remove("learnkit-display-flex", "learnkit-display-flex");
      this.placeholderEl.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
      this.viewportEl.classList.remove("learnkit-is-hidden", "learnkit-is-hidden");
    } else {
      this.placeholderEl.classList.remove("learnkit-is-hidden", "learnkit-is-hidden");
      this.placeholderEl.classList.add("learnkit-display-flex", "learnkit-display-flex");
      this.viewportEl.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
      this.updateCanvasHeightForImage();
    }
  }

  private updateCanvasHeightForImage() {
    if (!this.canvasContainerEl) return;
    if (!this.ioImageData) {
      setCssProps(this.canvasContainerEl, "--learnkit-io-canvas-height", this.canvasHeightDefaults.height);
      setCssProps(this.canvasContainerEl, "--learnkit-io-canvas-min-height", this.canvasHeightDefaults.minHeight);
      setCssProps(this.canvasContainerEl, "--learnkit-io-canvas-max-height", this.canvasHeightDefaults.maxHeight);
      return;
    }
    const width = this.canvasContainerEl.clientWidth || this.canvasContainerEl.getBoundingClientRect().width;
    if (!width || !this.stageW || !this.stageH) return;
    const maxHeight = 450;
    const desired = Math.max(1, Math.round((width * this.stageH) / this.stageW));
    const height = Math.min(desired, maxHeight);
    setCssProps(this.canvasContainerEl, "--learnkit-io-canvas-height", `${height}px`);
    setCssProps(this.canvasContainerEl, "--learnkit-io-canvas-min-height", "0px");
    setCssProps(this.canvasContainerEl, "--learnkit-io-canvas-max-height", `${maxHeight}px`);
  }

  // ── Image limit / delete ──────────────────────────────────────────────────

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
      setCssProps(this.stageEl, "--learnkit-io-stage-w", "1px");
      setCssProps(this.stageEl, "--learnkit-io-stage-h", "1px");
    }
    this.renderRects();
    this.updatePlaceholderVisibility();
    this.updateUndoRedoState();
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();
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
      setCssProps(this.stageEl, "--learnkit-io-stage-w", `${this.stageW}px`);
      setCssProps(this.stageEl, "--learnkit-io-stage-h", `${this.stageH}px`);
    }

    if (this.viewportEl) this.viewportEl.classList.remove("learnkit-is-hidden", "learnkit-is-hidden");
    if (this.placeholderEl) this.placeholderEl.classList.add("learnkit-is-hidden", "learnkit-is-hidden");

    this.updatePlaceholderVisibility();
    this.seedHistoryFromImage();
    this.fitToViewportWhenReady();
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();

  }

  private seedHistoryFromImage() {
    if (!this.ioImageData) return;
    const imgSnapshot = { mime: this.ioImageData.mime, data: this.ioImageData.data };
    if (this.historyIndex === -1 && this.history.length === 0) {
      this.history = [
        {
          rects: this.rects.map((r) => this.cloneRect(r)),
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
        rects: entry.rects.map((r) => this.cloneRect(r)),
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
        new Notice(`Image occlusion file not found for edit.`);
        return;
      }
      const data = await this.app.vault.readBinary?.(file);
      if (!data) throw new Error("readBinary not available");
      const mime = mimeFromExt(file.extension || "");
      this.ioImageData = { mime, data };
      await this.loadImageToCanvas();
    } catch (e: unknown) {
      new Notice(`Failed to load image occlusion image (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  // ── Viewport / transform ──────────────────────────────────────────────────

  private fitToViewport(): boolean {
    if (!this.viewportEl || !this.stageEl) return false;

    const vw = this.viewportEl.clientWidth;
    const vh = this.viewportEl.clientHeight;

    // On first modal open/paste the viewport can report 0x0 briefly.
    // Avoid applying a scale(0) transform and retry on the next frame.
    if (!vw || !vh || vw < 2 || vh < 2 || !this.stageW || !this.stageH) return false;

    const scaleX = vw / this.stageW;
    const scaleY = vh / this.stageH;
    const scale = Math.max(0.0001, Math.min(scaleX, scaleY));
    const tx = (vw - this.stageW * scale) / 2;
    const ty = (vh - this.stageH * scale) / 2;

    this.t = { scale, tx, ty };
    this.applyTransform();
    return true;
  }

  private fitToViewportWhenReady(maxAttempts = 5) {
    if (this.fitRetryRaf != null) {
      cancelAnimationFrame(this.fitRetryRaf);
      this.fitRetryRaf = null;
    }

    const attemptFit = (attempt: number) => {
      this.updateCanvasHeightForImage();
      const fitted = this.fitToViewport();
      this.renderRects();
      if (fitted || attempt >= maxAttempts) {
        this.fitRetryRaf = null;
        return;
      }
      this.fitRetryRaf = requestAnimationFrame(() => attemptFit(attempt + 1));
    };

    attemptFit(0);
  }

  private applyTransform() {
    if (!this.stageEl) return;
    setCssProps(
      this.stageEl,
      "--learnkit-io-stage-transform",
      `translate(${this.t.tx}px, ${this.t.ty}px) scale(${this.t.scale})`,
    );

  }

  private clientToStagePoint(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.stageEl) return { x: 0, y: 0 };

    const rect = this.stageEl.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    const x = ((clientX - rect.left) / width) * this.stageW;
    const y = ((clientY - rect.top) / height) * this.stageH;

    return {
      x: Math.max(0, Math.min(this.stageW, x)),
      y: Math.max(0, Math.min(this.stageH, y)),
    };
  }

  // ── Canvas event handling (mouse / keyboard) ──────────────────────────────

  private setupCanvasEvents() {
    if (!this.viewportEl) return;

    let panning = false;
    let panStart = { x: 0, y: 0, tx: 0, ty: 0 };

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        void this.runAutoMask();
        return;
      }

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

    this.onDocKeyDown = handleKeyDown;
    document.addEventListener("keydown", handleKeyDown);

    this.viewportEl.addEventListener("mousedown", (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const isOnRect = !!targetEl?.closest("[data-rect-id]");
      const isOnText = !!targetEl?.closest("[data-text-id]");
      const isOnForm = !!targetEl?.closest("input,textarea,button,select");
      const isOcclusionTool =
        this.currentTool === "occlusion-rect" ||
        this.currentTool === "occlusion-circle" ||
        this.currentTool === "occlusion-freehand" ||
        this.currentTool === "occlusion-smart-lasso";
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
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
        this.activeTextId = null;
        this.textDrawing = true;
        this.textStart = { x: stageX, y: stageY };
        this.updateTextPreview(stageX, stageY, stageX, stageY);
        e.preventDefault();
        return;
      }

      if (isCropTool) {
        if (isOnForm) return;
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
        this.cropDrawing = true;
        this.cropStart = { x: stageX, y: stageY };
        this.updateCropPreview(stageX, stageY, stageX, stageY);
        e.preventDefault();
        return;
      }

      if (this.currentTool === "transform") {
        if (isOnForm) return;
        panning = true;
        panStart = { x: e.clientX, y: e.clientY, tx: this.t.tx, ty: this.t.ty };
        if (this.viewportEl) {
          this.viewportEl.classList.remove("learnkit-cursor-grab", "learnkit-cursor-grab");
          this.viewportEl.classList.add("learnkit-cursor-grabbing", "learnkit-cursor-grabbing");
        }
        e.preventDefault();
      } else if (isOcclusionTool) {
        if (isOnRect || isOnText || isOnForm) return;
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);

        this.drawing = true;
        this.drawStart = { x: stageX, y: stageY };
        if (this.isFreehandMaskTool()) {
          this.freehandPoints = [{ x: stageX, y: stageY }];
          this.updateFreehandPreview(this.freehandPoints);
        } else {
          this.freehandPoints = [];
        }
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
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
        this.updateCropPreview(this.cropStart.x, this.cropStart.y, stageX, stageY);
      } else if (this.textDrawing && this.textStart) {
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
        this.updateTextPreview(this.textStart.x, this.textStart.y, stageX, stageY);
      } else if (this.drawing && this.drawStart) {
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
        if (this.isFreehandMaskTool()) {
          this.freehandPoints.push({ x: stageX, y: stageY });
          this.updateFreehandPreview(this.freehandPoints);
        } else {
          const shape = this.currentTool === "occlusion-circle" ? "circle" : "rect";
          this.updatePreview(this.drawStart.x, this.drawStart.y, stageX, stageY, shape);
        }
      }
    });

    this.viewportEl.addEventListener("mouseup", (e: MouseEvent) => {
      if (panning) {
        panning = false;
        if (this.viewportEl) {
          this.viewportEl.classList.remove("learnkit-cursor-grabbing", "learnkit-cursor-grabbing");
          this.viewportEl.classList.add("learnkit-cursor-grab", "learnkit-cursor-grab");
        }
      } else if (this.cropDrawing && this.cropStart) {
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
        const start = this.cropStart;
        this.cropDrawing = false;
        this.cropStart = null;
        this.clearCropPreview();
        void this.finalizeCropRect(start.x, start.y, stageX, stageY);
      } else if (this.textDrawing && this.textStart) {
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);
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
        const { x: stageX, y: stageY } = this.clientToStagePoint(e.clientX, e.clientY);

        if (this.isFreehandMaskTool()) {
          this.freehandPoints.push({ x: stageX, y: stageY });
          this.finalizeFreehandRect(this.freehandPoints, this.currentTool === "occlusion-smart-lasso");
        } else {
          this.finalizeRect(this.drawStart.x, this.drawStart.y, stageX, stageY);
        }
        this.drawing = false;
        this.drawStart = null;
        this.freehandPoints = [];
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
        this.freehandPoints = [];
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
      new Notice(`Add an image first.`);
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
    wrap.className = "learnkit-io-text-wrap";
    setCssProps(wrap, "--learnkit-io-text-x", `${useX * this.t.scale + this.t.tx}px`);
    setCssProps(wrap, "--learnkit-io-text-y", `${useY * this.t.scale + this.t.ty}px`);

    const input = document.createElement("textarea");
    input.className = "textarea learnkit-io-text-input";
    input.rows = 1;
    input.placeholder = "Type text";
    setCssProps(input, "--learnkit-io-text-w", `${Math.max(40, textW * this.t.scale)}px`);
    setCssProps(input, "--learnkit-io-text-h", `${Math.max(30, textH * this.t.scale)}px`);
    setCssProps(input, "--learnkit-io-text-size", `${this.textFontSize}px`);
    setCssProps(input, "--learnkit-io-text-color", this.textColor);
    setCssProps(input, "--learnkit-io-text-bg", textBgCss(this.textBgColor, this.textBgOpacity));
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
      this.textPreviewEl.className = "learnkit-io-text-preview";
      this.overlayEl.appendChild(this.textPreviewEl);
    }

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    setCssProps(this.textPreviewEl, "--learnkit-io-preview-x", `${left}px`);
    setCssProps(this.textPreviewEl, "--learnkit-io-preview-y", `${top}px`);
    setCssProps(this.textPreviewEl, "--learnkit-io-preview-w", `${Math.max(1, width)}px`);
    setCssProps(this.textPreviewEl, "--learnkit-io-preview-h", `${Math.max(1, height)}px`);
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
      this.cropPreviewEl.className = "learnkit-io-crop-preview";
      this.overlayEl.appendChild(this.cropPreviewEl);
    }

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    setCssProps(this.cropPreviewEl, "--learnkit-io-crop-x", `${left}px`);
    setCssProps(this.cropPreviewEl, "--learnkit-io-crop-y", `${top}px`);
    setCssProps(this.cropPreviewEl, "--learnkit-io-crop-w", `${width}px`);
    setCssProps(this.cropPreviewEl, "--learnkit-io-crop-h", `${height}px`);
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
      this.previewEl.className = "learnkit-io-mask-preview";
      this.overlayEl.appendChild(this.previewEl);
    }

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    setCssProps(this.previewEl, "--learnkit-io-mask-x", `${left}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-y", `${top}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-w", `${width}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-h", `${height}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-radius", shape === "circle" ? "50%" : "4px");
    setCssProps(this.previewEl, "border", "");
    setCssProps(this.previewEl, "backgroundColor", "");
    setCssProps(this.previewEl, "clipPath", "");
    if (this.previewStrokeEl) {
      this.previewStrokeEl.remove();
      this.previewStrokeEl = null;
    }
  }

  private updateFreehandPreview(points: Array<{ x: number; y: number }>) {
    if (!this.overlayEl || points.length === 0) return;

    if (!this.previewEl) {
      this.previewEl = document.createElement("div");
      this.previewEl.className = "learnkit-io-mask-preview";
      this.overlayEl.appendChild(this.previewEl);
    }

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    setCssProps(this.previewEl, "--learnkit-io-mask-x", `${left}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-y", `${top}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-w", `${width}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-h", `${height}px`);
    setCssProps(this.previewEl, "--learnkit-io-mask-radius", "4px");
    setCssProps(this.previewEl, "border", "none");
    setCssProps(this.previewEl, "backgroundColor", "rgba(59, 130, 246, 0.14)");

    const relativePoints = points.map((point) => ({
      x: Math.max(0, Math.min(1, (point.x - left) / width)),
      y: Math.max(0, Math.min(1, (point.y - top) / height)),
    }));
    this.previewEl.style.clipPath = polygonClipPath(relativePoints);

    if (!this.previewStrokeEl) {
      this.previewStrokeEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.previewStrokeEl.classList.add("learnkit-io-mask-preview-stroke");
      this.overlayEl.appendChild(this.previewStrokeEl);
    }
    this.previewStrokeEl.setAttribute("viewBox", `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
    this.previewStrokeEl.setAttribute("width", `${Math.max(1, width)}`);
    this.previewStrokeEl.setAttribute("height", `${Math.max(1, height)}`);
    this.previewStrokeEl.style.left = `${left}px`;
    this.previewStrokeEl.style.top = `${top}px`;
    this.previewStrokeEl.replaceChildren();

    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute(
      "points",
      points
        .map((point) => `${Math.max(0, Math.min(width, point.x - left))},${Math.max(0, Math.min(height, point.y - top))}`)
        .join(" "),
    );
    polygon.setAttribute("fill", "none");
    polygon.setAttribute("stroke", "#3b82f6");
    polygon.setAttribute("stroke-width", "3");
    polygon.setAttribute("stroke-dasharray", "10 8");
    polygon.setAttribute("stroke-linejoin", "round");
    polygon.setAttribute("stroke-linecap", "round");
    this.previewStrokeEl.appendChild(polygon);
  }

  private clearPreview() {
    if (this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
    }
    if (this.previewStrokeEl) {
      this.previewStrokeEl.remove();
      this.previewStrokeEl = null;
    }
  }

  private getNextGroupNumber(): number {
    const maxGroup = this.rects.reduce((acc, r) => {
      const n = Number.parseInt(String(r.groupKey ?? "").trim(), 10);
      return Number.isFinite(n) && n > 0 ? Math.max(acc, n) : acc;
    }, 0);
    return Math.max(1, maxGroup + 1);
  }

  private cloneRect(rect: IORect): IORect {
    return {
      ...rect,
      points: Array.isArray(rect.points)
        ? rect.points.map((point) => ({ x: point.x, y: point.y }))
        : undefined,
    };
  }

  private finalizeFreehandRect(rawPoints: Array<{ x: number; y: number }>, smartSnap = false) {
    if (!Array.isArray(rawPoints) || rawPoints.length < 3) return;

    const points: Array<{ x: number; y: number }> = [];
    for (const point of rawPoints) {
      if (!point) continue;
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const prev = points[points.length - 1];
      if (!prev || Math.abs(prev.x - x) > 0.5 || Math.abs(prev.y - y) > 0.5) {
        points.push({ x, y });
      }
    }

    if (points.length < 3) return;

    const processedPoints = smartSnap ? this.snapPathPointsToEdges(points) : points;
    if (processedPoints.length < 3) return;

    const xs = processedPoints.map((p) => p.x);
    const ys = processedPoints.map((p) => p.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const width = right - left;
    const height = bottom - top;
    if (width < 5 || height < 5) return;

    const nextGroupNum = this.getNextGroupNumber();
    const polygonPoints = processedPoints.map((point) => ({
      x: Math.max(0, Math.min(1, (point.x - left) / width)),
      y: Math.max(0, Math.min(1, (point.y - top) / height)),
    }));

    const rect: IORect = {
      rectId: `rect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      normX: left / this.stageW,
      normY: top / this.stageH,
      normW: width / this.stageW,
      normH: height / this.stageH,
      groupKey: String(nextGroupNum),
      label: String(nextGroupNum),
      shape: "polygon",
      points: polygonPoints,
    };

    this.rects.push(rect);
    this.selectedRectId = rect.rectId;
    this.selectedTextId = null;
    this.saveHistory();
    this.renderRects();
  }

  private snapPathPointsToEdges(rawPoints: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    const imgEl = this.imgEl;
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return rawPoints;

    const maxPoints = 700;
    const stride = Math.max(1, Math.ceil(rawPoints.length / maxPoints));
    const sampled: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < rawPoints.length; i += stride) sampled.push(rawPoints[i]);
    if (rawPoints.length > 0 && sampled[sampled.length - 1] !== rawPoints[rawPoints.length - 1]) {
      sampled.push(rawPoints[rawPoints.length - 1]);
    }

    const canvas = document.createElement("canvas");
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return rawPoints;

    try {
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      const baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const imageW = baseImageData.width;
      const imageH = baseImageData.height;

      const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
      const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

      const blur3 = (src: Float32Array, width: number, height: number): Float32Array => {
        const tmp = new Float32Array(src.length);
        const out = new Float32Array(src.length);

        for (let y = 0; y < height; y++) {
          const row = y * width;
          for (let x = 0; x < width; x++) {
            const xm1 = Math.max(0, x - 1);
            const xp1 = Math.min(width - 1, x + 1);
            tmp[row + x] = (src[row + xm1] + src[row + x] * 2 + src[row + xp1]) * 0.25;
          }
        }

        for (let y = 0; y < height; y++) {
          const ym1 = Math.max(0, y - 1) * width;
          const yc = y * width;
          const yp1 = Math.min(height - 1, y + 1) * width;
          for (let x = 0; x < width; x++) {
            out[yc + x] = (tmp[ym1 + x] + tmp[yc + x] * 2 + tmp[yp1 + x]) * 0.25;
          }
        }

        return out;
      };

      const imageDataToGray = (imageData: ImageData): Float32Array => {
        const gray = new Float32Array(imageData.width * imageData.height);
        const data = imageData.data;
        for (let y = 0; y < imageData.height; y++) {
          for (let x = 0; x < imageData.width; x++) {
            const idx = (y * imageData.width + x) * 4;
            gray[y * imageData.width + x] = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722;
          }
        }
        return gray;
      };

      const imageDataToColorBoundary = (imageData: ImageData): Float32Array => {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        const boundary = new Float32Array(width * height);

        const rgbAt = (x: number, y: number): [number, number, number] => {
          const idx = (y * width + x) * 4;
          return [data[idx], data[idx + 1], data[idx + 2]];
        };

        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const [rl, gl, bl] = rgbAt(x - 1, y);
            const [rr, gr, br] = rgbAt(x + 1, y);
            const [ru, gu, bu] = rgbAt(x, y - 1);
            const [rd, gd, bd] = rgbAt(x, y + 1);

            const sx = Math.hypot(rr - rl, gr - gl, br - bl);
            const sy = Math.hypot(rd - ru, gd - gu, bd - bu);
            boundary[y * width + x] = Math.hypot(sx, sy);
          }
        }

        const softened = blur3(boundary, width, height);
        let maxBoundary = 0;
        for (let i = 0; i < softened.length; i++) {
          if (softened[i] > maxBoundary) maxBoundary = softened[i];
        }

        const normalized = new Float32Array(softened.length);
        const div = Math.max(maxBoundary * 0.78, 28);
        for (let i = 0; i < normalized.length; i++) {
          normalized[i] = clamp(softened[i] / div, 0, 1);
        }
        return normalized;
      };

      const normalizeContrast = (gray: Float32Array, width: number, height: number): Float32Array => {
        const smoothed = blur3(blur3(gray, width, height), width, height);
        const squared = new Float32Array(gray.length);
        for (let i = 0; i < gray.length; i++) squared[i] = gray[i] * gray[i];
        const mean = blur3(blur3(smoothed, width, height), width, height);
        const meanSq = blur3(blur3(squared, width, height), width, height);

        const normalized = new Float32Array(gray.length);
        for (let i = 0; i < gray.length; i++) {
          const variance = Math.max(1, meanSq[i] - mean[i] * mean[i]);
          const std = Math.sqrt(variance);
          const centered = (smoothed[i] - mean[i]) / (std + 6);
          normalized[i] = clamp(128 + centered * 26, 0, 255);
        }

        return blur3(normalized, width, height);
      };

      const sobel = (gray: Float32Array, width: number, height: number): { gx: Float32Array; gy: Float32Array; mag: Float32Array; maxMag: number } => {
        const gx = new Float32Array(width * height);
        const gy = new Float32Array(width * height);
        const mag = new Float32Array(width * height);
        let maxMag = 0;

        for (let y = 1; y < height - 1; y++) {
          const ym1 = (y - 1) * width;
          const yc = y * width;
          const yp1 = (y + 1) * width;
          for (let x = 1; x < width - 1; x++) {
            const a = gray[ym1 + x - 1];
            const b = gray[ym1 + x];
            const c = gray[ym1 + x + 1];
            const d = gray[yc + x - 1];
            const f = gray[yc + x + 1];
            const g = gray[yp1 + x - 1];
            const h = gray[yp1 + x];
            const i = gray[yp1 + x + 1];

            const sx = -a - d * 2 - g + c + f * 2 + i;
            const sy = -a - b * 2 - c + g + h * 2 + i;
            const m = Math.hypot(sx, sy);
            const idx = yc + x;
            gx[idx] = sx;
            gy[idx] = sy;
            mag[idx] = m;
            if (m > maxMag) maxMag = m;
          }
        }

        return { gx, gy, mag, maxMag };
      };

      const nonMaxSuppression = (
        gx: Float32Array,
        gy: Float32Array,
        mag: Float32Array,
        width: number,
        height: number,
      ): { nms: Float32Array; mean: number; std: number; max: number } => {
        const nms = new Float32Array(width * height);
        let sum = 0;
        let sumSq = 0;
        let count = 0;
        let max = 0;

        for (let y = 1; y < height - 1; y++) {
          const row = y * width;
          for (let x = 1; x < width - 1; x++) {
            const idx = row + x;
            const gxi = gx[idx];
            const gyi = gy[idx];
            const m = mag[idx];
            if (m <= 0) continue;

            let angle = (Math.atan2(gyi, gxi) * 180) / Math.PI;
            if (angle < 0) angle += 180;

            let q = 0;
            let r = 0;
            if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
              q = mag[idx + 1];
              r = mag[idx - 1];
            } else if (angle >= 22.5 && angle < 67.5) {
              q = mag[idx - width + 1];
              r = mag[idx + width - 1];
            } else if (angle >= 67.5 && angle < 112.5) {
              q = mag[idx - width];
              r = mag[idx + width];
            } else {
              q = mag[idx - width - 1];
              r = mag[idx + width + 1];
            }

            if (m >= q && m >= r) {
              nms[idx] = m;
              sum += m;
              sumSq += m * m;
              count++;
              if (m > max) max = m;
            }
          }
        }

        const mean = count > 0 ? sum / count : 0;
        const variance = count > 1 ? Math.max(0, sumSq / count - mean * mean) : 0;
        const std = Math.sqrt(variance);
        return { nms, mean, std, max };
      };

      const hysteresisConfidence = (
        nms: Float32Array,
        width: number,
        height: number,
        mean: number,
        std: number,
        max: number,
      ): { confidence: Float32Array; high: number } => {
        const high = Math.max(mean + std * 0.9, max * 0.16, 8);
        const low = Math.max(high * 0.45, mean * 0.65);
        const edges = new Uint8Array(width * height);
        const stack: number[] = [];

        for (let i = 0; i < nms.length; i++) {
          if (nms[i] >= high) {
            edges[i] = 2;
            stack.push(i);
          }
        }

        while (stack.length) {
          const idx = stack.pop() as number;
          const x = idx % width;
          const y = Math.floor(idx / width);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
              const nIdx = ny * width + nx;
              if (edges[nIdx] !== 0) continue;
              if (nms[nIdx] >= low) {
                edges[nIdx] = 2;
                stack.push(nIdx);
              }
            }
          }
        }

        const confidence = new Float32Array(width * height);
        const confDiv = Math.max(high * 1.6, 1);
        for (let i = 0; i < confidence.length; i++) {
          const base = clamp(nms[i] / confDiv, 0, 1);
          confidence[i] = edges[i] ? Math.max(base, 0.72 + base * 0.28) : base * 0.45;
        }

        return { confidence, high };
      };

      type EdgeField = {
        scale: number;
        width: number;
        height: number;
        conf: Float32Array;
        gx: Float32Array;
        gy: Float32Array;
      };

      const buildEdgeField = (scale: number): EdgeField | null => {
        let imageData: ImageData;
        if (scale === 1) {
          imageData = baseImageData;
        } else {
          const sw = Math.max(24, Math.round(imageW * scale));
          const sh = Math.max(24, Math.round(imageH * scale));
          const scaledCanvas = document.createElement("canvas");
          scaledCanvas.width = sw;
          scaledCanvas.height = sh;
          const sctx = scaledCanvas.getContext("2d", { willReadFrequently: true });
          if (!sctx) return null;
          sctx.drawImage(canvas, 0, 0, sw, sh);
          imageData = sctx.getImageData(0, 0, sw, sh);
        }

        const gray = imageDataToGray(imageData);
        const colorBoundary = imageDataToColorBoundary(imageData);
        const normalized = normalizeContrast(gray, imageData.width, imageData.height);
        const sob = sobel(normalized, imageData.width, imageData.height);
        const nmsStats = nonMaxSuppression(sob.gx, sob.gy, sob.mag, imageData.width, imageData.height);
        const conf = hysteresisConfidence(nmsStats.nms, imageData.width, imageData.height, nmsStats.mean, nmsStats.std, nmsStats.max);

        const fusedConfidence = new Float32Array(conf.confidence.length);
        for (let i = 0; i < fusedConfidence.length; i++) {
          const luma = conf.confidence[i];
          const chroma = colorBoundary[i];
          // Preserve strong luminance edges, but also trust sharp chroma boundaries.
          fusedConfidence[i] = clamp(Math.max(luma, chroma * 0.86, luma * 0.72 + chroma * 0.54), 0, 1);
        }
        const confSmoothed = blur3(fusedConfidence, imageData.width, imageData.height);
        for (let i = 0; i < fusedConfidence.length; i++) {
          fusedConfidence[i] = clamp(fusedConfidence[i] * 0.72 + confSmoothed[i] * 0.28, 0, 1);
        }

        return {
          scale,
          width: imageData.width,
          height: imageData.height,
          conf: fusedConfidence,
          gx: sob.gx,
          gy: sob.gy,
        };
      };

      const fields = [buildEdgeField(1), buildEdgeField(0.5)].filter((field): field is EdgeField => !!field);
      if (!fields.length) return sampled;

      const sampleBilinear = (arr: Float32Array, width: number, height: number, x: number, y: number): number => {
        const sx = clamp(x, 0, width - 1);
        const sy = clamp(y, 0, height - 1);
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const tx = sx - x0;
        const ty = sy - y0;

        const v00 = arr[y0 * width + x0];
        const v10 = arr[y0 * width + x1];
        const v01 = arr[y1 * width + x0];
        const v11 = arr[y1 * width + x1];
        return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
      };

      const sampleEdge = (x: number, y: number): { conf: number; gx: number; gy: number } => {
        let weightedConf = 0;
        let weightTotal = 0;
        let bestConf = -1;
        let bestGx = 0;
        let bestGy = 0;

        for (const field of fields) {
          const sx = x * field.scale;
          const sy = y * field.scale;
          const conf = sampleBilinear(field.conf, field.width, field.height, sx, sy);
          const gx = sampleBilinear(field.gx, field.width, field.height, sx, sy);
          const gy = sampleBilinear(field.gy, field.width, field.height, sx, sy);
          const weight = field.scale === 1 ? 0.65 : 0.35;
          weightedConf += conf * weight;
          weightTotal += weight;
          if (conf > bestConf) {
            bestConf = conf;
            bestGx = gx;
            bestGy = gy;
          }
        }

        const blendedConf = weightTotal > 0 ? weightedConf / weightTotal : Math.max(0, bestConf);
        return {
          conf: clamp(Math.max(blendedConf, bestConf * 0.9), 0, 1),
          gx: bestGx,
          gy: bestGy,
        };
      };

      const clampPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
        x: clamp(point.x, 1, imageW - 2),
        y: clamp(point.y, 1, imageH - 2),
      });

      const snapped = sampled.map((point, i, pts) => {
        const p = clampPoint(point);
        const prev = i > 0 ? pts[i - 1] : pts[Math.min(1, pts.length - 1)];
        const next = i < pts.length - 1 ? pts[i + 1] : pts[Math.max(pts.length - 2, 0)];
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const tLen = Math.hypot(tx, ty) || 1;
        tx /= tLen;
        ty /= tLen;
        const nx = -ty;
        const ny = tx;

        const center = sampleEdge(p.x, p.y);
        const radius = Math.round(3 + (1 - center.conf) * 8);
        const lateralSlack = center.conf < 0.35 ? 2 : center.conf < 0.6 ? 1 : 0;
        const distancePenalty = 0.045 + center.conf * 0.11;

        let best = p;
        let bestConf = center.conf;
        let bestScore = center.conf;

        for (let r = -radius; r <= radius; r++) {
          for (let s = -lateralSlack; s <= lateralSlack; s++) {
            const cx = p.x + nx * r + tx * s;
            const cy = p.y + ny * r + ty * s;
            const cpt = clampPoint({ x: cx, y: cy });
            const edge = sampleEdge(cpt.x, cpt.y);
            const gMag = Math.hypot(edge.gx, edge.gy);
            const align = gMag > 1e-6 ? Math.abs((edge.gx / gMag) * nx + (edge.gy / gMag) * ny) : 0;
            const dist = Math.hypot(r, s * 0.75);
            const score = edge.conf + align * 0.22 - dist * distancePenalty;
            if (score > bestScore) {
              bestScore = score;
              bestConf = edge.conf;
              best = cpt;
            }
          }
        }

        // In low-confidence regions, avoid aggressive drift.
        if (bestConf < Math.max(0.18, center.conf * 1.05)) return p;
        return best;
      });

      const closeContourWithEdgePath = (points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
        if (points.length < 3) return points;
        const first = points[0];
        const last = points[points.length - 1];
        const seamDist = Math.hypot(first.x - last.x, first.y - last.y);
        if (seamDist <= 2) return points;

        const margin = Math.max(10, Math.round(seamDist * 1.2));
        const minX = Math.max(1, Math.floor(Math.min(first.x, last.x) - margin));
        const maxX = Math.min(imageW - 2, Math.ceil(Math.max(first.x, last.x) + margin));
        const minY = Math.max(1, Math.floor(Math.min(first.y, last.y) - margin));
        const maxY = Math.min(imageH - 2, Math.ceil(Math.max(first.y, last.y) + margin));
        if (maxX <= minX + 2 || maxY <= minY + 2) return points;

        const span = Math.max(maxX - minX, maxY - minY);
        const step = span > 260 ? 2 : 1;
        const gw = Math.floor((maxX - minX) / step) + 1;
        const gh = Math.floor((maxY - minY) / step) + 1;
        if (gw * gh > 220000) return points;

        const toGrid = (x: number, y: number): { gx: number; gy: number } => ({
          gx: clamp(Math.round((x - minX) / step), 0, gw - 1),
          gy: clamp(Math.round((y - minY) / step), 0, gh - 1),
        });
        const toWorld = (gx: number, gy: number): { x: number; y: number } => ({
          x: minX + gx * step,
          y: minY + gy * step,
        });

        const start = toGrid(last.x, last.y);
        const goal = toGrid(first.x, first.y);
        const toIndex = (gx: number, gy: number): number => gy * gw + gx;
        const startIdx = toIndex(start.gx, start.gy);
        const goalIdx = toIndex(goal.gx, goal.gy);
        if (startIdx === goalIdx) return points;

        const gScore = new Float32Array(gw * gh);
        const fScore = new Float32Array(gw * gh);
        const prev = new Int32Array(gw * gh);
        const open = new Uint8Array(gw * gh);
        const closed = new Uint8Array(gw * gh);
        for (let i = 0; i < gScore.length; i++) {
          gScore[i] = Number.POSITIVE_INFINITY;
          fScore[i] = Number.POSITIVE_INFINITY;
          prev[i] = -1;
        }

        const heap: Array<{ idx: number; f: number }> = [];
        const heapSwap = (a: number, b: number) => {
          const t = heap[a];
          heap[a] = heap[b];
          heap[b] = t;
        };
        const heapPush = (entry: { idx: number; f: number }) => {
          heap.push(entry);
          let i = heap.length - 1;
          while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (heap[parent].f <= heap[i].f) break;
            heapSwap(parent, i);
            i = parent;
          }
        };
        const heapPop = (): { idx: number; f: number } | null => {
          if (!heap.length) return null;
          const out = heap[0];
          const lastHeap = heap.pop() as { idx: number; f: number };
          if (heap.length) {
            heap[0] = lastHeap;
            let i = 0;
            while (true) {
              const l = i * 2 + 1;
              const r = l + 1;
              let smallest = i;
              if (l < heap.length && heap[l].f < heap[smallest].f) smallest = l;
              if (r < heap.length && heap[r].f < heap[smallest].f) smallest = r;
              if (smallest === i) break;
              heapSwap(i, smallest);
              i = smallest;
            }
          }
          return out;
        };

        const heuristic = (idx: number): number => {
          const gx = idx % gw;
          const gy = Math.floor(idx / gw);
          const dx = gx - goal.gx;
          const dy = gy - goal.gy;
          return Math.hypot(dx, dy);
        };

        gScore[startIdx] = 0;
        fScore[startIdx] = heuristic(startIdx);
        heapPush({ idx: startIdx, f: fScore[startIdx] });
        open[startIdx] = 1;

        const dirs = [
          [-1, -1], [0, -1], [1, -1],
          [-1, 0],            [1, 0],
          [-1, 1],  [0, 1],  [1, 1],
        ];

        let reached = false;
        while (heap.length) {
          const node = heapPop();
          if (!node) break;
          const current = node.idx;
          if (closed[current]) continue;
          closed[current] = 1;
          if (current === goalIdx) {
            reached = true;
            break;
          }

          const cx = current % gw;
          const cy = Math.floor(current / gw);
          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const nIdx = toIndex(nx, ny);
            if (closed[nIdx]) continue;

            const world = toWorld(nx, ny);
            const conf = sampleEdge(world.x, world.y).conf;
            const moveCost = (dx !== 0 && dy !== 0 ? 1.4142 : 1) * (1.05 + (1 - conf) * 2.4);
            const tentativeG = gScore[current] + moveCost;
            if (tentativeG >= gScore[nIdx]) continue;

            prev[nIdx] = current;
            gScore[nIdx] = tentativeG;
            fScore[nIdx] = tentativeG + heuristic(nIdx);
            heapPush({ idx: nIdx, f: fScore[nIdx] });
            open[nIdx] = 1;
          }
        }

        if (!reached) return points;

        const bridge: Array<{ x: number; y: number }> = [];
        let cursor = goalIdx;
        while (cursor !== -1 && cursor !== startIdx) {
          const gx = cursor % gw;
          const gy = Math.floor(cursor / gw);
          bridge.push(clampPoint(toWorld(gx, gy)));
          cursor = prev[cursor];
        }
        bridge.reverse();
        if (!bridge.length) return points;

        return [...points, ...bridge];
      };

      const detectCorners = (points: Array<{ x: number; y: number }>): Set<number> => {
        const corners = new Set<number>();
        if (points.length < 5) return corners;

        const candidates: Array<{ idx: number; turn: number }> = [];
        const minSegmentLen = 1.15;
        const minTurn = 0.84;
        const minEdgeConf = 0.44;

        for (let i = 0; i < points.length; i++) {
          const prev = points[(i - 1 + points.length) % points.length];
          const cur = points[i];
          const next = points[(i + 1) % points.length];
          const ax = cur.x - prev.x;
          const ay = cur.y - prev.y;
          const bx = next.x - cur.x;
          const by = next.y - cur.y;
          const al = Math.hypot(ax, ay);
          const bl = Math.hypot(bx, by);
          if (al < minSegmentLen || bl < minSegmentLen) continue;
          const dot = clamp((ax / al) * (bx / bl) + (ay / al) * (by / bl), -1, 1);
          const turn = Math.acos(dot);
          if (turn < minTurn) continue;
          if (sampleEdge(cur.x, cur.y).conf < minEdgeConf) continue;
          candidates.push({ idx: i, turn });
        }

        if (!candidates.length) return corners;
        candidates.sort((a, b) => a.idx - b.idx);

        const keptTurns = new Map<number, number>();
        const minGap = 3;
        let lastKept = -10000;
        for (const cand of candidates) {
          if (cand.idx - lastKept < minGap) {
            const lastTurn = keptTurns.get(lastKept) ?? 0;
            if (cand.turn > lastTurn) {
              corners.delete(lastKept);
              corners.add(cand.idx);
              keptTurns.delete(lastKept);
              keptTurns.set(cand.idx, cand.turn);
              lastKept = cand.idx;
            }
            continue;
          }
          corners.add(cand.idx);
          keptTurns.set(cand.idx, cand.turn);
          lastKept = cand.idx;
        }

        const sorted = Array.from(corners).sort((a, b) => a - b);
        if (sorted.length > 1) {
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          if (first + points.length - last < minGap) {
            const firstTurn = keptTurns.get(first) ?? 0;
            const lastTurn = keptTurns.get(last) ?? 0;
            if (firstTurn >= lastTurn) corners.delete(last);
            else corners.delete(first);
          }
        }

        return corners;
      };

      const smoothCornerAware = (points: Array<{ x: number; y: number }>, corners: Set<number>): Array<{ x: number; y: number }> => {
        if (points.length < 4) return points;
        return points.map((point, i) => {
          if (i === 0 || i === points.length - 1 || corners.has(i)) return point;
          const nearCorner = corners.has(i - 1) || corners.has(i + 1);
          const edgeConf = sampleEdge(point.x, point.y).conf;
          if (nearCorner && edgeConf > 0.68) return point;
          const a = points[i - 1];
          const b = points[i];
          const c = points[i + 1];
          const centerWeight = edgeConf > 0.72 ? 0.72 : edgeConf > 0.48 ? 0.62 : 0.5;
          const sideWeight = (1 - centerWeight) * 0.5;
          return clampPoint({
            x: a.x * sideWeight + b.x * centerWeight + c.x * sideWeight,
            y: a.y * sideWeight + b.y * centerWeight + c.y * sideWeight,
          });
        });
      };

      const pointLineDistance = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number => {
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const lenSq = vx * vx + vy * vy;
        if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
        const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq, 0, 1);
        const px = a.x + vx * t;
        const py = a.y + vy * t;
        return Math.hypot(p.x - px, p.y - py);
      };

      const rdpIndices = (points: Array<{ x: number; y: number }>, start: number, end: number, epsilon: number): number[] => {
        if (end <= start + 1) return [start, end];
        const a = points[start];
        const b = points[end];
        let maxDist = -1;
        let maxIdx = -1;
        for (let i = start + 1; i < end; i++) {
          const d = pointLineDistance(points[i], a, b);
          if (d > maxDist) {
            maxDist = d;
            maxIdx = i;
          }
        }
        if (maxIdx !== -1 && maxDist > epsilon) {
          const left = rdpIndices(points, start, maxIdx, epsilon);
          const right = rdpIndices(points, maxIdx, end, epsilon);
          return [...left.slice(0, -1), ...right];
        }
        return [start, end];
      };

      const simplifyCornerAware = (
        points: Array<{ x: number; y: number }>,
        corners: Set<number>,
        epsilon: number,
      ): Array<{ x: number; y: number }> => {
        if (points.length < 4) return points;
        const mandatory = new Set<number>([0, points.length - 1]);
        for (const idx of corners) mandatory.add(clamp(idx, 0, points.length - 1));
        const sorted = Array.from(mandatory).sort((a, b) => a - b);
        const keep = new Set<number>();

        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i];
          const b = sorted[i + 1];
          const segment = rdpIndices(points, a, b, epsilon);
          for (const idx of segment) keep.add(idx);
        }

        const indices = Array.from(keep).sort((a, b) => a - b);
        return indices.map((idx) => points[idx]);
      };

      const snappedClosed = closeContourWithEdgePath(snapped);
      if (snappedClosed.length <= 2) return sampled;
      const corners = detectCorners(snappedClosed);
      const smoothedPass1 = smoothCornerAware(snappedClosed, corners);
      const smoothed = smoothCornerAware(smoothedPass1, corners);
      const simplified = simplifyCornerAware(smoothed, corners, 1.82);

      if (simplified.length >= 3) return simplified.map((p) => clampPoint(p));
      if (smoothed.length >= 3) return smoothed.map((p) => clampPoint(p));
      return sampled;
    } catch {
      return rawPoints;
    }
  }

  // ── Rect finalization ─────────────────────────────────────────────────────

  private finalizeRect(x1: number, y1: number, x2: number, y2: number) {
    const shape: "rect" | "circle" = this.currentTool === "occlusion-circle" ? "circle" : "rect";

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const nextGroupNum = this.getNextGroupNumber();

    if (width < 5 || height < 5) return;

    const rect: IORect = {
      rectId: `rect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      normX: left / this.stageW,
      normY: top / this.stageH,
      normW: width / this.stageW,
      normH: height / this.stageH,
      groupKey: String(nextGroupNum),
      label: String(nextGroupNum),
      shape,
    };

    this.rects.push(rect);
    this.selectedRectId = rect.rectId;
    this.selectedTextId = null;
    this.saveHistory();
    this.renderRects();
  }

  // ── History (undo/redo) ───────────────────────────────────────────────────

  private saveHistory() {
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    const snapshot: IOHistoryEntry = {
      rects: this.rects.map((r) => this.cloneRect(r)),
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
    this.rects = snapshot.rects.map((r) => this.cloneRect(r));
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
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();
  }

  private redo() {
    if (this.historyIndex >= this.history.length - 1) return;

    this.historyIndex++;
    const snapshot = this.history[this.historyIndex];
    this.rects = snapshot.rects.map((r) => this.cloneRect(r));
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
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();
  }

  private updateUndoRedoState() {
    const canUndo = this.historyIndex > 0;
    const canRedo = this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
    const setBtnState = (btn: HTMLButtonElement | undefined, enabled: boolean) => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.setAttribute("aria-disabled", enabled ? "false" : "true");
      btn.classList.toggle("learnkit-opacity-35", !enabled);
      btn.classList.toggle("learnkit-pointer-none", !enabled);
    };
    setBtnState(this.btnUndo, canUndo);
    setBtnState(this.btnRedo, canRedo);
  }

  private updateAutoMaskButtonState() {
    const btn = this.btnAutoMask;
    if (!btn) return;
    const enabled = !!this.ioImageData && !this.autoMaskBusy;
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    btn.classList.toggle("learnkit-opacity-35", !enabled);
    btn.classList.toggle("learnkit-pointer-none", !enabled);
  }

  private updateResetMasksButtonState() {
    const btn = this.btnResetMasks;
    if (!btn) return;
    const enabled = this.rects.length > 0;
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    btn.classList.toggle("is-disabled", !enabled);
    btn.classList.toggle("learnkit-opacity-35", !enabled);
    btn.classList.toggle("learnkit-pointer-none", !enabled);
  }

  private resetMasks() {
    if (this.rects.length === 0) return;
    this.rects = [];
    this.selectedRectId = null;
    this.saveHistory();
    this.renderRects();
    this.updateResetMasksButtonState();
  }

  private async runAutoMask() {
    if (this.autoMaskBusy) return;
    if (!this.ioImageData) {
      new Notice("Add an image first.");
      return;
    }
    this.autoMaskBusy = true;
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();

    try {
      const existing = this.rects.map((r) => ({ ...r }));
      const masks = await autoDetectTextMasks(this.ioImageData, {
        stageW: this.stageW,
        stageH: this.stageH,
        existingRects: existing,
        startGroupNumber: this.getNextGroupNumber(),
      });

      if (!masks.length) {
        new Notice(this._tx("ui.io.autoMask.noRegions", "No text regions detected. Try a clearer image."));
        return;
      }

      this.rects.push(...masks);
      this.selectedRectId = null;
      this.selectedTextId = null;
      this.saveHistory();
      this.renderRects();
      this.updateResetMasksButtonState();
      new Notice(this._tx("ui.io.autoMask.added", "Added {count} auto masks.", { count: masks.length }));
    } catch (e: unknown) {
      new Notice(this._tx("ui.io.autoMask.failed", "Auto-detect failed ({error})", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.autoMaskBusy = false;
      this.updateAutoMaskButtonState();
      this.updateResetMasksButtonState();
    }
  }

  /** Rotate the image 90° clockwise or counter-clockwise. */
  private async rotateImage(direction: "cw" | "ccw") {
    if (!this.ioImageData) {
      new Notice(`Add an image first.`);
      return;
    }
    const result = await rotateImageData(this.ioImageData, direction, this.rects, this.textBoxes);
    if (!result) {
      new Notice(`Failed to load image for rotation.`);
      return;
    }
    this.ioImageData = result.imageData;
    this.rects = result.rects;
    this.textBoxes = result.textBoxes;
    this.selectedRectId = null;
    this.selectedTextId = null;
    this.saveHistory();
    await this.loadImageToCanvas();
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();
  }

  /** Crop the image to the specified stage-coordinate rectangle. */
  private async cropToRect(sx: number, sy: number, sw: number, sh: number) {
    if (!this.ioImageData) {
      new Notice(`Add an image first.`);
      return;
    }
    const result = await cropImageData(this.ioImageData, sx, sy, sw, sh, this.rects, this.textBoxes);
    if (!result) {
      new Notice(`Failed to load image for crop.`);
      return;
    }
    this.ioImageData = result.imageData;
    this.rects = result.rects;
    this.selectedRectId = null;
    this.textBoxes = result.textBoxes;
    this.selectedTextId = null;
    this.saveHistory();
    await this.loadImageToCanvas();
    this.updateAutoMaskButtonState();
    this.updateResetMasksButtonState();
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
    this.updateResetMasksButtonState();
  }

  // ── Render overlay (rects + text boxes – delegated to io-overlay-renderer) ─

  private renderRects() {
    if (!this.overlayEl) return;
    this.refreshHotspotInteractionControls();

    renderOverlay({
      overlayEl: this.overlayEl,
      stageW: this.stageW,
      stageH: this.stageH,
      scale: this.t.scale,
      selectedRectId: this.selectedRectId,
      selectedTextId: this.selectedTextId,
      useHotspotLabels: this.isHotspotMode(),
      currentTool: this.currentTool,
      preserveEls: new Set<Element | null>([this.previewEl, this.previewStrokeEl, this.cropPreviewEl]),
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
        deleteRect: (id) => {
          this.rects = this.rects.filter((r) => r.rectId !== id);
          if (this.selectedRectId === id) this.selectedRectId = null;
          this.saveHistory();
          this.renderRects();
          this.updateResetMasksButtonState();
        },
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
    if (this.onDocPaste) {
      document.removeEventListener("paste", this.onDocPaste, true);
      this.onDocPaste = undefined;
    }
    if (this.onDocKeyDown) {
      document.removeEventListener("keydown", this.onDocKeyDown);
      this.onDocKeyDown = undefined;
    }
    if (this.fitRetryRaf != null) {
      cancelAnimationFrame(this.fitRetryRaf);
      this.fitRetryRaf = null;
    }
    this.containerEl.removeClass("lk-modal-container");
    this.containerEl.removeClass("lk-modal-dim");
    this.modalEl.removeClass("lk-modals", "learnkit-io-creator");
    this.contentEl.removeClass("learnkit-io-creator-content");
    this.contentEl.empty();
  }
}
