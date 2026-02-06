/**
 * @file src/imageocclusion/io-modal-ui.ts
 * @summary DOM-construction helpers for the Image Occlusion creator modal. Each builder function creates a self-contained section of the modal UI (toolbar, canvas container, footer, header, image-limit dialog) and returns element references the caller needs to wire up event handling and state management.
 *
 * @exports
 *   - ToolbarRefs — interface with references to toolbar DOM elements
 *   - ToolbarCallbacks — interface defining toolbar action callbacks
 *   - buildToolbar — builds the IO editor toolbar with file upload, undo/redo, drawing tools, crop, and rotate buttons
 *   - CanvasContainerRefs — interface with references to canvas container DOM elements
 *   - CanvasContainerCallbacks — interface defining canvas container callbacks
 *   - buildCanvasContainer — builds the canvas container with placeholder, viewport, stage, image, and overlay elements
 *   - FooterCallbacks — interface defining footer button callbacks
 *   - buildFooter — builds the modal footer with Cancel, Hide All, and Hide One buttons
 *   - buildImageLimitDialog — builds a dialog warning that only one image per card is allowed
 *   - buildHeader — builds the modal header row with title and close button
 */

import { setIcon } from "obsidian";

// ── Toolbar ─────────────────────────────────────────────────────────────────

export interface ToolbarRefs {
  toolbarEl: HTMLElement;
  fileInput: HTMLInputElement;
  btnUndo: HTMLButtonElement;
  btnRedo: HTMLButtonElement;
  btnTransform: HTMLButtonElement;
  btnRectTool: HTMLButtonElement;
  btnCircleTool: HTMLButtonElement;
  btnCrop: HTMLButtonElement;
  btnRotateLeft: HTMLButtonElement;
  btnRotateRight: HTMLButtonElement;
}

export interface ToolbarCallbacks {
  onFileSelected(file: File): void;
  onUndo(): void;
  onRedo(): void;
  onSetTool(tool: "occlusion-rect" | "occlusion-circle" | "transform" | "text" | "crop"): void;
  onRotate(dir: "cw" | "ccw"): void;
}

/** Build the IO-editor toolbar and return element references. */
export function buildToolbar(parent: HTMLElement, cb: ToolbarCallbacks): ToolbarRefs {
  const toolbar = parent.createDiv();
  toolbar.removeAttribute("class");
  toolbar.setAttr("role", "toolbar");
  toolbar.style.setProperty("width", "fit-content");
  toolbar.style.setProperty("max-width", "100%");
  toolbar.style.setProperty("align-self", "flex-start");
  toolbar.dataset.sproutToolbar = "1";

  const toolbarGroup = toolbar.createDiv({ cls: "bc sprout-io-toolbar-group" });

  const createSep = () => toolbarGroup.createDiv({ cls: "bc sprout-io-toolbar-sep" });

  const createIconBtn = (
    iconParent: HTMLElement,
    iconName: string,
    tooltip: string,
    onClick: () => void,
    opts: { disabled?: boolean } = {},
  ): HTMLButtonElement => {
    const btn = iconParent.createEl("button", { cls: "bc sprout-io-btn" });
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

  createSep();

  // Undo / Redo
  const btnUndo = createIconBtn(toolbarGroup, "undo", "Undo (Ctrl+Z)", () => cb.onUndo());
  const btnRedo = createIconBtn(toolbarGroup, "redo", "Redo (Ctrl+Shift+Z)", () => cb.onRedo());

  createSep();

  // Move, Rectangle, Ellipse
  const btnTransform = createIconBtn(toolbarGroup, "move", "Pan / Move", () => cb.onSetTool("transform"));
  const btnRectTool = createIconBtn(toolbarGroup, "square", "Draw Rectangle", () => cb.onSetTool("occlusion-rect"));
  const btnCircleTool = createIconBtn(toolbarGroup, "circle", "Draw Ellipse", () => cb.onSetTool("occlusion-circle"));

  createSep();

  // Crop, Rotate
  const btnCrop = createIconBtn(toolbarGroup, "crop", "Crop image", () => cb.onSetTool("crop"));
  const btnRotateLeft = createIconBtn(toolbarGroup, "rotate-ccw-square", "Rotate 90° left", () => cb.onRotate("ccw"));
  const btnRotateRight = createIconBtn(toolbarGroup, "rotate-cw-square", "Rotate 90° right", () => cb.onRotate("cw"));

  fileInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    cb.onFileSelected(file);
  });

  return {
    toolbarEl: toolbar,
    fileInput,
    btnUndo,
    btnRedo,
    btnTransform,
    btnRectTool,
    btnCircleTool,
    btnCrop,
    btnRotateLeft,
    btnRotateRight,
  };
}

// ── Canvas container ────────────────────────────────────────────────────────

export interface CanvasContainerRefs {
  canvasContainerEl: HTMLDivElement;
  placeholderEl: HTMLElement;
  viewportEl: HTMLElement;
  stageEl: HTMLElement;
  imgEl: HTMLImageElement;
  overlayEl: HTMLElement;
}

export interface CanvasContainerCallbacks {
  onEmptyClick(): void;
}

/** Build the canvas container (placeholder + viewport + stage + overlay). */
export function buildCanvasContainer(
  parent: HTMLElement,
  defaults: { height: string; minHeight: string; maxHeight: string },
  cb: CanvasContainerCallbacks,
): CanvasContainerRefs {
  const canvasContainer = parent.createDiv({ cls: "bc rounded-lg border border-border bg-background" });
  canvasContainer.style.position = "relative";
  canvasContainer.style.width = "100%";
  canvasContainer.style.maxWidth = "1500px";
  canvasContainer.style.height = defaults.height;
  canvasContainer.style.minHeight = defaults.minHeight;
  canvasContainer.style.maxHeight = defaults.maxHeight;
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
  placeholder.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cb.onEmptyClick();
  });

  // Viewport (scrollable canvas area)
  const viewportEl = canvasContainer.createDiv({ cls: "bc" });
  viewportEl.style.position = "absolute";
  viewportEl.style.top = "0";
  viewportEl.style.left = "0";
  viewportEl.style.width = "100%";
  viewportEl.style.height = "100%";
  viewportEl.style.overflow = "hidden";
  viewportEl.style.display = "none";

  const stageEl = viewportEl.createDiv({ cls: "bc" });
  stageEl.style.position = "absolute";
  stageEl.style.top = "0";
  stageEl.style.left = "0";
  stageEl.style.transformOrigin = "0 0";

  const imgEl = stageEl.createEl("img", { cls: "bc" });
  imgEl.style.display = "block";
  imgEl.style.userSelect = "none";
  imgEl.style.border = "1px solid var(--border)";
  imgEl.style.boxSizing = "border-box";
  imgEl.draggable = false;

  const overlayEl = stageEl.createDiv({ cls: "bc" });
  overlayEl.style.position = "absolute";
  overlayEl.style.top = "0";
  overlayEl.style.left = "0";
  overlayEl.style.width = "100%";
  overlayEl.style.height = "100%";
  overlayEl.style.pointerEvents = "none";

  // Clicking empty canvas area opens file picker when no image loaded
  canvasContainer.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cb.onEmptyClick();
  });

  return { canvasContainerEl: canvasContainer, placeholderEl: placeholder, viewportEl, stageEl, imgEl, overlayEl };
}

// ── Footer ──────────────────────────────────────────────────────────────────

export interface FooterCallbacks {
  onCancel(): void;
  onSaveAll(): void;
  onSaveSolo(): void;
}

/** Build the modal footer with Cancel / Hide All / Hide One buttons. */
export function buildFooter(parent: HTMLElement, cb: FooterCallbacks): HTMLElement {
  const footer = parent.createDiv({ cls: "bc flex items-center justify-end gap-4" });
  footer.style.paddingTop = "15px";

  const cancelBtn = footer.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
  cancelBtn.type = "button";
  const cancelIcon = cancelBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
  setIcon(cancelIcon, "x");
  cancelBtn.createSpan({ text: "Cancel" });
  cancelBtn.onclick = () => cb.onCancel();

  const hideAllBtn = footer.createEl("button", {
    cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
    attr: { "data-tooltip": "Hide All: study with all masks hidden; no context clues." },
  });
  hideAllBtn.type = "button";
  hideAllBtn.style.setProperty("background", "var(--foreground)", "important");
  hideAllBtn.style.setProperty("color", "var(--background)", "important");
  hideAllBtn.style.setProperty("border-color", "var(--foreground)", "important");
  hideAllBtn.createSpan({ text: "Hide All" });
  hideAllBtn.onclick = () => cb.onSaveAll();

  const hideOneBtn = footer.createEl("button", {
    cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
    attr: { "data-tooltip": "Hide One: hide only the active mask; keeps context visible." },
  });
  hideOneBtn.type = "button";
  hideOneBtn.createSpan({ text: "Hide One" });
  hideOneBtn.onclick = () => cb.onSaveSolo();

  return footer;
}

// ── Image-limit dialog ──────────────────────────────────────────────────────

export function buildImageLimitDialog(
  parent: HTMLElement,
  onDelete: () => void,
): HTMLDialogElement {
  const dialog = parent.createEl("dialog", { cls: "bc dialog" });
  const dlgInner = dialog.createDiv({ cls: "bc flex flex-col gap-3" });
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
  dlgCancel.onclick = () => dialog.close();

  const dlgDelete = dlgFooter.createEl("button", {
    cls: "bc btn-outline inline-flex items-center justify-center px-3 h-9 text-sm",
    attr: { type: "button" },
    text: "Delete image",
  });
  dlgDelete.style.backgroundColor = "#fff";
  dlgDelete.style.color = "var(--foreground)";
  dlgDelete.onclick = () => onDelete();

  return dialog;
}

// ── Header ──────────────────────────────────────────────────────────────────

export function buildHeader(parent: HTMLElement, title: string, onClose: () => void): HTMLElement {
  const headerRow = parent.createDiv({ cls: "bc flex items-center justify-between gap-3 mb-1" });
  headerRow.createDiv({ text: title, cls: "bc text-lg font-semibold" });
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
  headerClose.onclick = () => onClose();
  return headerRow;
}
