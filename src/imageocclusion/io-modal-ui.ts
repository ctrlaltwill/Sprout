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
 *   - FooterRefs — interface with references to footer DOM elements
 *   - FooterCallbacks — interface defining footer button callbacks
 *   - buildFooter — builds the modal footer with Cancel button, mode dropdown, and Save button
 *   - buildImageLimitDialog — builds a dialog warning that only one image per card is allowed
 *   - buildHeader — builds the modal header row with title and close button
 */

import { setIcon } from "obsidian";
import { setCssProps } from "../core/ui";

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
  toolbar.classList.add("sprout-io-toolbar");
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
  fileInput.classList.add("sprout-io-file-input");
  toolbar.appendChild(fileInput);

  createIconBtn(toolbarGroup, "upload", "Insert from file", () => fileInput.click());

  createSep();

  // Undo / Redo
  const btnUndo = createIconBtn(toolbarGroup, "undo", "Undo (Ctrl+Z)", () => cb.onUndo());
  const btnRedo = createIconBtn(toolbarGroup, "redo", "Redo (Ctrl+Shift+Z)", () => cb.onRedo());

  createSep();

  // Move, Rectangle, Ellipse
  const btnTransform = createIconBtn(toolbarGroup, "move", "Pan / Move", () => cb.onSetTool("transform"));
  const btnRectTool = createIconBtn(toolbarGroup, "square", "Draw rectangle", () => cb.onSetTool("occlusion-rect"));
  const btnCircleTool = createIconBtn(toolbarGroup, "circle", "Draw ellipse", () => cb.onSetTool("occlusion-circle"));

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
  canvasContainer.classList.add("sprout-io-canvas", "sprout-io-canvas-container");
  setCssProps(canvasContainer, "--sprout-io-canvas-height", defaults.height);
  setCssProps(canvasContainer, "--sprout-io-canvas-min-height", defaults.minHeight);
  setCssProps(canvasContainer, "--sprout-io-canvas-max-height", defaults.maxHeight);

  // Placeholder (shown when no image loaded)
  const placeholder = canvasContainer.createDiv({
    cls: "bc flex items-center justify-center text-muted-foreground text-sm",
  });
  placeholder.classList.add("sprout-io-canvas-placeholder");
  placeholder.createSpan({ text: "Insert from file or paste an image " });
  const kbdWrap = placeholder.createSpan({ cls: "bc inline-flex items-center gap-1 ml-1" });
  kbdWrap.createEl("kbd", { cls: "bc kbd", text: "⌘+V" });
  kbdWrap.createSpan({ text: " / " });
  kbdWrap.createEl("kbd", { cls: "bc kbd", text: "Ctrl+V" });
  placeholder.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cb.onEmptyClick();
  });

  // Viewport (scrollable canvas area)
  const viewportEl = canvasContainer.createDiv({ cls: "bc" });
  viewportEl.classList.add("sprout-io-viewport");

  const stageEl = viewportEl.createDiv({ cls: "bc sprout-io-stage" });

  const imgEl = stageEl.createEl("img", { cls: "bc sprout-io-stage-image" });
  imgEl.draggable = false;

  const overlayEl = stageEl.createDiv({ cls: "bc sprout-io-stage-overlay" });

  // Clicking empty canvas area opens file picker when no image loaded
  canvasContainer.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cb.onEmptyClick();
  });

  return { canvasContainerEl: canvasContainer, placeholderEl: placeholder, viewportEl, stageEl, imgEl, overlayEl };
}

// ── Footer ──────────────────────────────────────────────────────────────────

export interface FooterRefs {
  footerEl: HTMLElement;
  getMaskMode(): "solo" | "all";
  cancelBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
}

export interface FooterCallbacks {
  onCancel(): void;
  onSave(mode: "solo" | "all"): void;
}

/** Build the modal footer with Cancel button, mask-mode picker, and Save button. */
export function buildFooter(parent: HTMLElement, cb: FooterCallbacks, defaultMode: "solo" | "all" = "solo"): FooterRefs {
  const footer = parent.createDiv({ cls: "bc flex flex-col items-end gap-3" });
  footer.classList.add("sprout-io-footer", "sprout-modal-footer");

  let selectedMode: "solo" | "all" = defaultMode;
  const options: { value: "solo" | "all"; label: string }[] = [
    { value: "solo", label: "Hide one" },
    { value: "all", label: "Hide all" },
  ];

  // Mode picker row
  const modeRow = footer.createDiv({ cls: "bc flex items-center gap-2 w-full justify-end" });
  modeRow.createEl("label", {
    cls: "bc text-sm font-medium",
    text: "Mask mode",
  });

  // Button-style dropdown (matches other modal dropdowns)
  const dropRoot = modeRow.createDiv({ cls: "bc sprout relative inline-flex" });
  const trigger = dropRoot.createEl("button", {
    cls: "bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2",
    attr: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
  });
  const triggerLabel = trigger.createEl("span", { cls: "bc truncate", text: options.find((o) => o.value === selectedMode)?.label ?? "Hide one" });
  const chevronWrap = trigger.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-3" });
  setIcon(chevronWrap, "chevron-down");

  const menu = dropRoot.createDiv({ cls: "bc sprout-io-mode-menu" });
  menu.classList.add("hidden");

  for (const opt of options) {
    const item = menu.createDiv({ cls: "bc sprout-io-mode-menu-item", text: opt.label });
    if (opt.value === selectedMode) item.classList.add("is-selected");
    item.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectedMode = opt.value;
      triggerLabel.textContent = opt.label;
      menu.querySelectorAll(".sprout-io-mode-menu-item").forEach((el) => el.classList.remove("is-selected"));
      item.classList.add("is-selected");
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  trigger.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const open = !menu.classList.contains("hidden");
    menu.classList.toggle("hidden", open);
    trigger.setAttribute("aria-expanded", String(!open));
  });

  // Close when clicking outside
  document.addEventListener("click", () => {
    menu.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
  });

  // Button row
  const buttonRow = footer.createDiv({ cls: "bc flex items-center gap-2" });

  const cancelBtn = buttonRow.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
  cancelBtn.type = "button";
  const cancelIcon = cancelBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
  setIcon(cancelIcon, "x");
  cancelBtn.createSpan({ text: "Cancel" });
  cancelBtn.onclick = () => cb.onCancel();

  const saveBtn = buttonRow.createEl("button", { cls: "bc btn inline-flex items-center gap-2 h-9 px-3 text-sm" });
  saveBtn.type = "button";
  saveBtn.createSpan({ text: "Save" });
  saveBtn.onclick = () => cb.onSave(selectedMode);

  return { footerEl: footer, getMaskMode: () => selectedMode, cancelBtn, saveBtn };
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
  dlgCancel.classList.add("sprout-io-dlg-cancel");
  dlgCancel.onclick = () => dialog.close();

  const dlgDelete = dlgFooter.createEl("button", {
    cls: "bc btn-outline inline-flex items-center justify-center px-3 h-9 text-sm",
    attr: { type: "button" },
    text: "Delete image",
  });
  dlgDelete.classList.add("sprout-io-dlg-delete");
  dlgDelete.onclick = () => onDelete();

  return dialog;
}

// ── Header ──────────────────────────────────────────────────────────────────

export function buildHeader(parent: HTMLElement, title: string, onClose: () => void): HTMLElement {
  const headerRow = parent.createDiv({ cls: "bc flex items-center justify-between gap-3" });
  headerRow.createDiv({ text: title, cls: "bc text-lg font-semibold" });
  const headerClose = headerRow.createEl("button", {
    cls: "bc inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground focus-visible:text-foreground",
    attr: { type: "button", "data-tooltip": "Close" },
  });
  headerClose.classList.add("sprout-io-close-btn");
  const headerCloseIcon = headerClose.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
  setIcon(headerCloseIcon, "x");
  headerClose.onclick = () => onClose();
  return headerRow;
}
