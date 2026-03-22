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

import { Platform, setIcon } from "obsidian";
import { placePopover, setCssProps } from "../../platform/core/ui";

function isMobileLikePlatform(): boolean {
  if (Platform.isMobileApp || Platform.isIosApp || Platform.isAndroidApp) return true;
  if (typeof document !== "undefined" && document.body?.classList.contains("is-mobile")) return true;
  return false;
}

function getPlatformShortcut(key: string): string | null {
  if (isMobileLikePlatform()) return null;
  return Platform.isMacOS ? `⌘${key}` : `Ctrl+${key}`;
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

export interface ToolbarRefs {
  toolbarEl: HTMLElement;
  fileInput: HTMLInputElement;
  btnUndo: HTMLButtonElement;
  btnRedo: HTMLButtonElement;
  btnAutoMask: HTMLButtonElement;
  btnResetMasks: HTMLButtonElement;
  btnTransform: HTMLButtonElement;
  btnRectTool: HTMLButtonElement;
  btnCrop: HTMLButtonElement;
  btnRotateLeft: HTMLButtonElement;
  btnRotateRight: HTMLButtonElement;
}

export interface ToolbarCallbacks {
  onFileSelected(file: File): void;
  onUndo(): void;
  onRedo(): void;
  onAutoMask(): void;
  onResetMasks(): void;
  onSetTool(tool: "occlusion-rect" | "occlusion-circle" | "transform" | "text" | "crop"): void;
  onRotate(dir: "cw" | "ccw"): void;
}

/** Build the IO-editor toolbar and return element references. */
export function buildToolbar(parent: HTMLElement, cb: ToolbarCallbacks): ToolbarRefs {
  const findShortcut = getPlatformShortcut("F");

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
    opts: { disabled?: boolean; label?: string; hotkeyHint?: string } = {},
  ): HTMLButtonElement => {
    const btn = iconParent.createEl("button", { cls: "bc sprout-io-btn" });
    btn.type = "button";
    btn.setAttribute("aria-label", tooltip);

    const iconWrapper = btn.createEl("span", { cls: "bc inline-flex items-center justify-center" });
    setIcon(iconWrapper, iconName);

    if (opts.label) {
      btn.classList.add("sprout-io-btn-text");
      btn.createSpan({ cls: "bc sprout-io-btn-label", text: opts.label });
    }
    if (opts.hotkeyHint) {
      const hintWrap = btn.createSpan({ cls: "bc sprout-io-btn-hotkeys" });
      hintWrap.createEl("kbd", { cls: "bc kbd", text: opts.hotkeyHint.trim() });
    }

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

  // Undo / Redo / Move / Crop / Rotate
  const btnUndo = createIconBtn(toolbarGroup, "undo", "Undo (Ctrl+Z)", () => cb.onUndo());
  const btnRedo = createIconBtn(toolbarGroup, "redo", "Redo (Ctrl+Shift+Z)", () => cb.onRedo());
  const btnTransform = createIconBtn(toolbarGroup, "move", "Pan / Move", () => cb.onSetTool("transform"));
  const btnCrop = createIconBtn(toolbarGroup, "crop", "Crop image", () => cb.onSetTool("crop"));
  const btnRotateLeft = createIconBtn(toolbarGroup, "rotate-ccw", "Rotate 90° left", () => cb.onRotate("ccw"));
  const btnRotateRight = createIconBtn(toolbarGroup, "rotate-cw", "Rotate 90° right", () => cb.onRotate("cw"));

  createSep();

  // Rectangle, auto-detect
  const btnRectTool = createIconBtn(
    toolbarGroup,
    "square",
    "Add Mask",
    () => cb.onSetTool("occlusion-rect"),
    { label: "Add Mask" },
  );
  const btnAutoMask = createIconBtn(
    toolbarGroup,
    "wand-sparkles",
    findShortcut ? `Auto-Mask (${findShortcut})` : "Auto-Mask",
    () => cb.onAutoMask(),
    { label: "Auto-Mask" },
  );
  const btnResetMasks = createIconBtn(
    toolbarGroup,
    "eraser",
    "Reset Masks",
    () => cb.onResetMasks(),
    { label: "Reset Masks", disabled: true },
  );

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
    btnAutoMask,
    btnResetMasks,
    btnTransform,
    btnRectTool,
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
  const pasteShortcut = getPlatformShortcut("V");

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
  placeholder.createSpan({ text: "Insert from file or paste an image" });
  if (pasteShortcut) {
    const kbdWrap = placeholder.createSpan({ cls: "bc inline-flex items-center gap-1 ml-1" });
    kbdWrap.createEl("kbd", { cls: "bc kbd", text: pasteShortcut });
  }
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
  const footer = parent.createDiv({ cls: "bc flex items-center justify-end gap-4" });
  footer.classList.add("sprout-io-footer", "lk-modal-footer");

  let selectedMode: "solo" | "all" = defaultMode;
  const options: { value: "solo" | "all"; label: string }[] = [
    { value: "solo", label: "Hide group" },
    { value: "all", label: "Hide all" },
  ];

  // Mode picker row
  const modeRow = footer.createDiv({ cls: "bc flex flex-col gap-1 items-start w-full" });
  const modeLabel = modeRow.createEl("label", {
    cls: "bc text-sm font-medium inline-flex items-center gap-1",
    text: "Mask behavior",
  });
  const modeHelp = modeRow.createDiv({
    cls: "bc text-xs text-muted-foreground",
    text: "Hide group hides only masks the by group when studying, other masks will not be present. Hide all hides every group when studying. Reveal settings are available in the plugin settings.",
  });

  // Button-style dropdown (matches other modal dropdowns)
  const dropRoot = modeRow.createDiv({ cls: "bc sprout relative inline-flex" });
  const trigger = dropRoot.createEl("button", {
    cls: "bc sprout-btn-toolbar h-7 px-2 text-sm inline-flex items-center gap-2 sprout-io-mode-trigger",
    attr: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
  });
  const triggerLabel = trigger.createEl("span", { cls: "bc", text: options.find((o) => o.value === selectedMode)?.label ?? "Hide group" });
  trigger.setAttribute("aria-label", triggerLabel.textContent || "Hide group");
  const chevronWrap = trigger.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-3" });
  setIcon(chevronWrap, "chevron-down");

  const popover = document.createElement("div");
  const sproutWrapper = document.createElement("div");
  sproutWrapper.className = "sprout";
  popover.className = "bc";
  popover.setAttribute("aria-hidden", "true");
  popover.classList.add("sprout-popover-overlay", "sprout-card-creator-type-popover");
  sproutWrapper.appendChild(popover);

  const panel = document.createElement("div");
  panel.className = "bc rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto sprout-card-creator-type-panel";
  popover.appendChild(panel);

  const menuList = document.createElement("div");
  menuList.className = "bc flex flex-col";
  menuList.setAttribute("role", "menu");
  panel.appendChild(menuList);

  let menuOpen = false;
  let onDocPointerDown: ((ev: PointerEvent) => void) | null = null;

  const closeMenu = () => {
    trigger.setAttribute("aria-expanded", "false");
    popover.setAttribute("aria-hidden", "true");
    popover.classList.remove("is-open");
    if (onDocPointerDown) {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      onDocPointerDown = null;
    }
    try {
      sproutWrapper.remove();
    } catch {
      // no-op
    }
    menuOpen = false;
  };

  const placeModeMenu = () =>
    placePopover({
      trigger,
      panel: menuList,
      popoverEl: popover,
      width: Math.ceil(trigger.getBoundingClientRect().width || 0),
    });

  const openMenu = () => {
    if (menuOpen) return;
    trigger.setAttribute("aria-expanded", "true");
    popover.setAttribute("aria-hidden", "false");
    popover.classList.add("is-open");
    if (!sproutWrapper.parentElement) document.body.appendChild(sproutWrapper);
    requestAnimationFrame(() => placeModeMenu());

    onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (dropRoot.contains(t) || popover.contains(t)) return;
      closeMenu();
    };

    window.setTimeout(() => {
      if (onDocPointerDown) document.addEventListener("pointerdown", onDocPointerDown, true);
    }, 0);

    menuOpen = true;
  };

  for (const opt of options) {
    const item = menuList.createEl("div", {
      cls: "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground sprout-card-creator-type-item",
      text: "",
    });
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", opt.value === selectedMode ? "true" : "false");
    item.tabIndex = 0;
    const dotWrap = item.createEl("div", { cls: "bc size-4 flex items-center justify-center" });
    dotWrap.createEl("div", { cls: "bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible", attr: { "aria-hidden": "true" } });
    item.createEl("span", { cls: "bc", text: opt.label });

    const choose = (ev?: Event) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      selectedMode = opt.value;
      triggerLabel.textContent = opt.label;
      trigger.setAttribute("aria-label", opt.label);
      menuList.querySelectorAll("[role=menuitemradio]").forEach((el) => el.setAttribute("aria-checked", "false"));
      item.setAttribute("aria-checked", "true");
      closeMenu();
    };

    item.addEventListener("click", choose);
    item.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") choose(ev);
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu();
        trigger.focus();
      }
    });
  }

  const onWindowResize = () => {
    if (!menuOpen) return;
    placeModeMenu();
  };

  const cleanup = () => {
    closeMenu();
    window.removeEventListener("resize", onWindowResize);
    observer.disconnect();
    try {
      sproutWrapper.remove();
    } catch {
      // no-op
    }
  };

  const observer = new MutationObserver(() => {
    if (!footer.isConnected) cleanup();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (menuOpen) closeMenu();
    else openMenu();
  });

  window.addEventListener("resize", onWindowResize);

  // Button row
  const buttonRow = footer.createDiv({ cls: "bc flex items-center justify-end gap-4" });

  const cancelBtn = buttonRow.createEl("button", { cls: "bc sprout-btn-toolbar sprout-btn-filter inline-flex items-center gap-2 h-9 px-3 text-sm" });
  cancelBtn.type = "button";
  cancelBtn.createSpan({ text: "Cancel" });
  cancelBtn.onclick = () => {
    cleanup();
    cb.onCancel();
  };

  const saveBtn = buttonRow.createEl("button", { cls: "bc sprout-btn-toolbar sprout-btn-accent sprout-io-save-btn h-9 inline-flex items-center gap-2" });
  saveBtn.type = "button";
  saveBtn.createSpan({ text: "Save" });
  saveBtn.onclick = () => {
    cleanup();
    cb.onSave(selectedMode);
  };

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
    cls: "bc sprout-btn-toolbar inline-flex items-center justify-center px-3 h-9 text-sm",
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
    attr: { type: "button", "aria-label": "Close" },
  });
  headerClose.classList.add("sprout-io-close-btn");
  const headerCloseIcon = headerClose.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
  setIcon(headerCloseIcon, "x");
  headerClose.onclick = () => onClose();
  return headerRow;
}
