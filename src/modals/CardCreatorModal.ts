/**
 * modals/CardCreatorModal.ts
 * ---------------------------------------------------------------------------
 * Modal for adding a new flashcard (Basic, Cloze, or MCQ) to the active note.
 *
 * Supports:
 *  - Type selection (Basic / Cloze / MCQ)
 *  - Image-paste into question/answer/info fields
 *  - IO image paste + launch of IO editor
 *  - Post-save sync to update the question bank
 * ---------------------------------------------------------------------------
 */

import { Modal, Notice, MarkdownView, TFile, setIcon, type App } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import type { CardType } from "../card-editor/card-editor";
import { ImageOcclusionEditorModal } from "../imageocclusion/ImageMaskRenderer";
import { syncOneFile } from "../sync/sync-engine";

import {
  normaliseVaultPath,
  extFromMime,
  bestEffortAttachmentPath,
  writeBinaryToVault,
  setDisabledUnder,
  parkBehind,
  setVisible,
  nextFrame,
  focusFirstField,
  hasClozeToken,
  formatPipeField,
  createModalCardEditor,
  type ModalCardFieldKey,
  type ModalCardEditorResult,
  type ClipboardImage,
} from "./modal-utils";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** An image pasted into a card field, awaiting vault persistence on save. */
type PendingImage = {
  placeholder: string;
  data: ArrayBuffer;
  mime: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// CardCreatorModal
// ──────────────────────────────────────────────────────────────────────────────

export class CardCreatorModal extends Modal {
  private plugin: SproutPlugin;
  private forcedType?: CardType;
  private pendingImages: Map<string, PendingImage> = new Map();

  constructor(app: App, plugin: SproutPlugin, forcedType?: CardType) {
    super(app);
    this.plugin = plugin;
    this.forcedType = forcedType;
  }

  // ── Image paste handling ──────────────────────────────────────────────────

  /**
   * Intercept paste events on a textarea to capture pasted images.
   * The image data is stored in `pendingImages` until the card is saved.
   */
  private async handleImagePaste(ev: ClipboardEvent, textarea: HTMLTextAreaElement) {
    const clipData = ev.clipboardData;
    if (!clipData) return;

    const items = Array.from(clipData.items);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith("image/")) continue;

      ev.preventDefault();
      ev.stopPropagation();

      try {
        const blob = item.getAsFile();
        if (!blob) continue;

        const data = await blob.arrayBuffer();
        const timestamp = Date.now();
        const ext = extFromMime(item.type);
        const placeholder = `card-img-${timestamp}.${ext}`;

        // Store image data with placeholder reference
        this.pendingImages.set(placeholder, {
          placeholder,
          data,
          mime: item.type,
        });

        // Insert markdown embed at the cursor position
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = textarea.value.substring(0, start);
        const after = textarea.value.substring(end);
        const markdown = `![[${placeholder}]]`;

        textarea.value = before + markdown + after;

        const newPos = start + markdown.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();

        new Notice(`${BRAND}: Image will be saved when you add the card`);
      } catch (e: any) {
        new Notice(`${BRAND}: Failed to process pasted image (${String(e?.message || e)})`);
      }
      return;
    }
  }

  /**
   * Write all pending images to the vault, replacing placeholder references
   * in the card text with the actual vault paths.
   */
  private async savePendingImages(sourceFile: TFile, textContent: string): Promise<string> {
    let updatedContent = textContent;

    for (const [placeholder, imageInfo] of this.pendingImages) {
      try {
        const vaultPath = bestEffortAttachmentPath(this.plugin, sourceFile, placeholder, "card");
        await writeBinaryToVault(this.app, vaultPath, imageInfo.data);

        const actualPath = normaliseVaultPath(vaultPath);
        updatedContent = updatedContent.replace(
          new RegExp(`!\\[\\[${placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g"),
          `![[${actualPath}]]`,
        );
      } catch (e: any) {
        new Notice(`${BRAND}: Failed to save image ${placeholder} (${String(e?.message || e)})`);
      }
    }

    return updatedContent;
  }

  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    this.containerEl.addClass("sprout-modal-container");
    this.containerEl.addClass("sprout-modal-dim");
    this.containerEl.addClass("sprout");
    this.modalEl.addClass("bc", "sprout-modals");
    this.modalEl.style.setProperty("backdrop-filter", "none", "important");
    this.modalEl.style.setProperty("padding", "20px", "important");
    this.modalEl.style.setProperty("gap", "0", "important");
    this.modalEl.style.setProperty("max-width", "90%", "important");
    this.modalEl.style.setProperty("width", "auto", "important");
    this.modalEl.style.setProperty("max-height", "90%", "important");
    this.modalEl.style.setProperty("box-sizing", "border-box", "important");
    this.modalEl.style.setProperty("overflow", "hidden auto", "important");
    this.contentEl.addClass("bc");
    this.contentEl.style.setProperty("padding", "0", "important");
    this.contentEl.style.setProperty("box-sizing", "border-box", "important");
    this.contentEl.style.setProperty("display", "flex", "important");
    this.contentEl.style.setProperty("flex-direction", "column", "important");
    this.modalEl.querySelector(".modal-header")?.remove();
    this.modalEl.querySelector(".modal-close-button")?.remove();


    const { contentEl } = this;
    contentEl.empty();

    const file = this.app.workspace.getActiveFile();
    const path = String(file?.path || "");

    const modalRoot = contentEl;
    modalRoot.style.setProperty("display", "flex", "important");
    modalRoot.style.setProperty("flex-direction", "column", "important");
    modalRoot.style.setProperty("gap", "16px", "important");

    // ── Header ──────────────────────────────────────────────────────────────
    const headerRow = modalRoot.createDiv({ cls: "bc flex items-center justify-between gap-3 mb-1" });
    headerRow.createDiv({ text: "Add Flashcard", cls: "bc text-lg font-semibold" });
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
    body.style.marginTop = "15px";

    // ── Type selector (dropdown + popover menu) ─────────────────────────────
    const typeField = body.createDiv({ cls: "bc flex flex-col gap-1" });
    typeField.style.display = "none";
    const typeId = `sprout-type-${Math.floor(Math.random() * 1e9)}`;

    const typeLabel = typeField.createEl("label", { cls: "bc text-sm font-medium", attr: { for: typeId } });
    typeLabel.textContent = "Question Type";

    const typeSel = typeField.createEl("select", { cls: "bc w-full", attr: { id: typeId } });
    typeSel.createEl("option", { text: "Basic", value: "basic" });
    typeSel.createEl("option", { text: "Cloze", value: "cloze" });
    typeSel.createEl("option", { text: "Multiple Choice", value: "mcq" });

    let cardEditor: (ModalCardEditorResult & any) | null = null;
    let currentType: CardType = this.forcedType || "basic";
    const typeLabelFor = (type: CardType) => {
      if (type === "cloze") return "Cloze";
      if (type === "mcq") return "Multiple Choice";
      return "Basic";
    };
    const isTypeMenuOption = (type: CardType) => type === "basic" || type === "cloze" || type === "mcq";
    let updateTypeMenuLabel: () => void = () => {};
    const setType = (next: CardType) => {
      currentType = next;
      typeSel.value = next;
      renderCardEditor();
      syncVisibility();
      updateTypeMenuLabel();
    };

    if (this.forcedType) {
      typeSel.value = this.forcedType;
    }

    // Popover-based type menu (uses inline popover for compatibility)
    const typeMenuRow = body.createDiv({ cls: "bc flex flex-col gap-1 items-start" });
    typeMenuRow.createEl("label", { cls: "bc text-sm font-medium", text: "Type" });
    const typeMenuWrap = typeMenuRow.createDiv({ cls: "bc sprout relative inline-flex" });
    const typeMenuBtn = typeMenuWrap.createEl("button", {
      cls: "bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2",
    });
    typeMenuBtn.setAttribute("aria-haspopup", "menu");
    typeMenuBtn.setAttribute("aria-expanded", "false");

    const typeMenuBtnText = document.createElement("span");
    typeMenuBtnText.className = "bc truncate";
    typeMenuBtn.appendChild(typeMenuBtnText);

    const typeMenuBtnIcon = document.createElement("span");
    typeMenuBtnIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3";
    setIcon(typeMenuBtnIcon, "chevron-down");
    typeMenuBtn.appendChild(typeMenuBtnIcon);

    const typePopover = document.createElement("div");
    const typeSproutWrapper = document.createElement("div");
    typeSproutWrapper.className = "sprout";
    typePopover.className = "bc";
    typePopover.setAttribute("aria-hidden", "true");
    typePopover.style.setProperty("position", "fixed", "important");
    typePopover.style.setProperty("z-index", "999999", "important");
    typePopover.style.setProperty("display", "none", "important");
    typePopover.style.setProperty("pointer-events", "auto", "important");
    typeSproutWrapper.appendChild(typePopover);

    const typePanel = document.createElement("div");
    typePanel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1";
    typePanel.style.setProperty("pointer-events", "auto", "important");
    typePopover.appendChild(typePanel);

    const typeMenu = document.createElement("div");
    typeMenu.setAttribute("role", "menu");
    typeMenu.className = "bc flex flex-col";
    typePanel.appendChild(typeMenu);

    let typeMenuOpen = false;
    const typeOptions: Array<{ value: CardType; label: string }> = [
      { value: "basic", label: "Basic" },
      { value: "cloze", label: "Cloze" },
      { value: "mcq", label: "Multiple Choice" },
    ];

    updateTypeMenuLabel = () => {
      typeMenuBtnText.textContent = typeLabelFor(currentType);
      const show = isTypeMenuOption(currentType);
      typeMenuRow.style.display = show ? "" : "none";
    };
    updateTypeMenuLabel();

    const closeTypeMenu = () => {
      typeMenuBtn.setAttribute("aria-expanded", "false");
      typePopover.setAttribute("aria-hidden", "true");
      typePopover.style.setProperty("display", "none", "important");
      try {
        typeSproutWrapper.remove();
      } catch {}
      typeMenuOpen = false;
    };

    const placeTypeMenu = () => {
      const r = typeMenuBtn.getBoundingClientRect();
      const margin = 8;
      const width = 180;
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      const panelRect = typePanel.getBoundingClientRect();
      const top = Math.max(margin, r.top - panelRect.height - 6);
      typePopover.style.left = `${left}px`;
      typePopover.style.top = `${top}px`;
      typePopover.style.width = `${width}px`;
    };

    const buildTypeMenu = () => {
      while (typeMenu.firstChild) typeMenu.removeChild(typeMenu.firstChild);

      for (const opt of typeOptions) {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", opt.value === currentType ? "true" : "false");
        item.tabIndex = 0;
        item.className =
          "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

        const dotWrap = document.createElement("div");
        dotWrap.className = "bc size-4 flex items-center justify-center";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
        dot.setAttribute("aria-hidden", "true");
        dotWrap.appendChild(dot);

        const txt = document.createElement("span");
        txt.className = "bc";
        txt.textContent = opt.label;
        item.appendChild(txt);

        const activate = () => {
          setType(opt.value);
          closeTypeMenu();
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        });

        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            activate();
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            closeTypeMenu();
            typeMenuBtn.focus();
          }
        });

        typeMenu.appendChild(item);
      }
    };

    const openTypeMenu = () => {
      if (!isTypeMenuOption(currentType)) return;
      buildTypeMenu();
      typeMenuBtn.setAttribute("aria-expanded", "true");
      typePopover.setAttribute("aria-hidden", "false");
      typePopover.style.setProperty("display", "block", "important");
      if (!typeSproutWrapper.parentElement) document.body.appendChild(typeSproutWrapper);
      requestAnimationFrame(() => placeTypeMenu());

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (typeMenuWrap.contains(t) || typePopover.contains(t)) return;
        closeTypeMenu();
      };

      window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
      }, 0);

      typeMenuOpen = true;
    };

    typeMenuBtn.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (typeMenuOpen) closeTypeMenu();
      else openTypeMenu();
    });

    // ── Card editor area ────────────────────────────────────────────────────
    const editorContainer = body.createDiv({ cls: "bc flex flex-col gap-3" });
    editorContainer.style.width = "80vw";
    editorContainer.style.maxWidth = "450px";

    const renderCardEditor = () => {
      editorContainer.empty();
      try {
        cardEditor = createModalCardEditor({
          type: currentType,
          locationPath: path,
          locationTitle: path ? `Target: ${path}` : "Target: (no active note)",
          plugin: this.plugin,
        });
        editorContainer.appendChild(cardEditor.root);

        // Show a read-only "Location" field above the Groups field
        const formatLocationPath = (p: string) => {
          if (!p) return "";
          const cleaned = p.replace(/\.md$/i, "");
          return cleaned.split("/").filter(Boolean).join(" / ");
        };

        const addLocationField = (root: HTMLElement) => {
          const wrapper = document.createElement("div");
          wrapper.className = "bc flex flex-col gap-1";
          const label = document.createElement("label");
          label.className = "bc text-sm font-medium";
          label.textContent = "Location";
          const input = document.createElement("input");
          input.type = "text";
          input.className = "bc input w-full";
          input.disabled = true;
          const displayPath = path ? formatLocationPath(path) : "";
          input.value = displayPath;
          input.placeholder = "Folder / Note";
          input.title = displayPath;
          input.style.minHeight = "38px";
          input.style.maxHeight = "38px";
          input.style.height = "38px";
          input.style.whiteSpace = "nowrap";
          input.style.overflow = "hidden";
          input.style.textOverflow = "ellipsis";
          input.style.direction = "rtl";
          input.style.textAlign = "left";
          wrapper.appendChild(label);
          wrapper.appendChild(input);

          const children = Array.from(root.children);
          const groupsWrapper = children.find((child) => {
            const lbl = child.querySelector("label");
            return lbl && lbl.textContent?.trim() === "Groups";
          });
          if (groupsWrapper && groupsWrapper.parentElement) {
            groupsWrapper.parentElement.insertBefore(wrapper, groupsWrapper);
          } else {
            root.appendChild(wrapper);
          }
        };

        addLocationField(cardEditor.root);

        // Attach paste listeners for inline image pasting (skip for IO)
        if (currentType !== "io") {
          const questionInput = cardEditor.inputEls.question;
          const answerInput = cardEditor.inputEls.answer;
          const infoInput = cardEditor.inputEls.info;

          if (questionInput && questionInput instanceof HTMLTextAreaElement) {
            questionInput.addEventListener("paste", (ev) => this.handleImagePaste(ev, questionInput));
          }

          // MCQ answer field is handled by the options UI, not a plain textarea
          if (answerInput && answerInput instanceof HTMLTextAreaElement && currentType !== "mcq") {
            answerInput.addEventListener("paste", (ev) => this.handleImagePaste(ev, answerInput));
          }

          if (infoInput && infoInput instanceof HTMLTextAreaElement) {
            infoInput.addEventListener("paste", (ev) => this.handleImagePaste(ev, infoInput));
          }
        }

        focusFirstField(cardEditor.root);
      } catch (e: any) {
        cardEditor = null;
        const msg = `Failed to render card fields (${String(e?.message || e)})`;
        editorContainer.createDiv({ text: msg, cls: "bc text-sm text-destructive" });
        new Notice(`${BRAND}: ${msg}`);
      }
    };

    // ── IO image paste zone ─────────────────────────────────────────────────
    let ioImageData: ClipboardImage | null = null;
    let ioImageFile: TFile | null = null;

    const ioWrap = body.createDiv({ cls: "bc fieldset", attr: { role: "group" } });
    setVisible(ioWrap, false);
    ioWrap.createEl("legend", { text: "Image Occlusion", cls: "bc" });

    const ioPasteZone = ioWrap.createDiv({ cls: "bc flex flex-col gap-3" });

    const ioPastePrompt = ioPasteZone.createDiv({
      text: "Paste an image (Ctrl+V) or drag & drop an image file",
      cls: "bc text-sm text-muted-foreground p-3 rounded-lg border border-dashed border-muted-foreground text-center",
    });

    const ioImagePreview = ioPasteZone.createDiv({ cls: "bc hidden" });
    ioImagePreview.style.display = "none";

    const ioImageContainer = ioImagePreview.createDiv({ cls: "bc flex flex-col gap-2" });
    const ioImgElement = ioImageContainer.createEl("img", { cls: "bc w-full rounded-lg border border-border" });
    ioImgElement.style.maxHeight = "300px";
    ioImgElement.style.objectFit = "contain";

    const ioImageInfo = ioImageContainer.createDiv({ cls: "bc text-xs text-muted-foreground" });
    const ioImageName = ioImageContainer.createDiv({ cls: "bc text-xs font-medium" });

    const ioActionRow = ioImageContainer.createDiv({ cls: "bc flex gap-2" });
    const ioClearBtn = ioActionRow.createEl("button", { text: "Clear", cls: "bc btn-outline flex-1" });
    ioClearBtn.type = "button";

    ioPasteZone.appendChild(ioPastePrompt);
    ioPasteZone.appendChild(ioImagePreview);
    ioWrap.appendChild(ioPasteZone);

    const updateIOPreview = () => {
      if (ioImageData) {
        ioImgElement.src = URL.createObjectURL(new Blob([ioImageData.data], { type: ioImageData.mime }));
        ioImageInfo.textContent = `${ioImageData.mime} • ${(ioImageData.data.byteLength / 1024).toFixed(1)} KB`;
        ioImageName.textContent = "Ready to save and edit occlusions";
        ioImagePreview.style.display = "";
        ioPastePrompt.style.display = "none";
      } else {
        ioImagePreview.style.display = "none";
        ioPastePrompt.style.display = "";
        ioImgElement.src = "";
      }
    };

    ioClearBtn.addEventListener("click", () => {
      ioImageData = null;
      ioImageFile = null;
      updateIOPreview();
    });

    // Global paste handler for IO mode
    const handleIoPaste = async (ev: ClipboardEvent) => {
      if (currentType !== "io") return;
      const clipData = ev.clipboardData;
      if (!clipData) return;

      const items = clipData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith("image/")) continue;
        ev.preventDefault();
        try {
          const blob = item.getAsFile();
          if (!blob) continue;
          const data = await blob.arrayBuffer();
          ioImageData = { mime: item.type, data };
          updateIOPreview();
        } catch (e: any) {
          new Notice(`${BRAND}: Failed to load pasted image (${String(e?.message || e)})`);
        }
        return;
      }
    };

    document.addEventListener("paste", handleIoPaste);

    const syncVisibility = () => {
      const showIo = currentType === "io";
      setVisible(ioWrap, showIo);
    };

    typeSel.addEventListener("change", () => {
      const next = (typeSel.value || "basic") as CardType;
      setType(next);
    });

    renderCardEditor();
    syncVisibility();

    // ── Helpers ──────────────────────────────────────────────────────────────

    const getActiveMarkdownFile = (): TFile | null => {
      const active = this.app.workspace.getActiveFile();
      if (!(active instanceof TFile)) return null;
      return active;
    };

    /** Insert text at the editor cursor, or append to file if not in source view. */
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

    /** Open the IO editor overlay for a newly-created IO parent card. */
    const openIoEditorFor = async (parentId: string) => {
      try {
        setDisabledUnder(modalRoot, true);
        parkBehind(this.modalEl, true);

        await nextFrame();
        await nextFrame();

        (ImageOcclusionEditorModal as any).openForParent(this.plugin, parentId, {
          onClose: () => {
            try {
              parkBehind(this.modalEl, false);
            } catch {
              // ignore
            }
            this.close();
          },
        });
      } catch (e: any) {
        parkBehind(this.modalEl, false);
        setDisabledUnder(modalRoot, false);
        new Notice(`${BRAND}: failed to open IO editor (${String(e?.message || e)})`);
      }
    };

    // ── Footer buttons ──────────────────────────────────────────────────────
    const footer = modalRoot.createDiv({ cls: "bc flex flex-col" });
    footer.style.marginTop = "20px";
    footer.style.paddingBottom = "16px";
    const footerRow = footer.createDiv({ cls: "bc flex items-center justify-end gap-4" });

    const cancelBtn = footerRow.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
    cancelBtn.type = "button";
    const cancelIcon = cancelBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(cancelIcon, "x");
    cancelBtn.createSpan({ text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const addBtn = footerRow.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
    addBtn.type = "button";
    const addIcon = addBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(addIcon, "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.onclick = async () => {
      try {
        const active = getActiveMarkdownFile();
        if (!active) {
          new Notice(`${BRAND}: open a markdown note first`);
          return;
        }

        const type = currentType;

        if (!cardEditor) {
          new Notice(`${BRAND}: select a question type before adding`);
          return;
        }

        const getValue = (key: ModalCardFieldKey) => String((cardEditor!.inputEls as any)[key]?.value ?? "").trim();
        let titleVal = getValue("title");
        let questionVal = getValue("question");
        let answerVal = getValue("answer");
        let infoVal = getValue("info");
        const groupsVal = String(cardEditor.getGroupInputValue() || "").trim();

        const requireNonEmpty = (val: string, message: string) => {
          if (String(val || "").trim().length === 0) {
            new Notice(`${BRAND}: ${message}`);
            focusFirstField(cardEditor!.root);
            return false;
          }
          return true;
        };

        // Build the pipe-format card block
        const block: string[] = [];

        if (type === "basic") {
          if (!requireNonEmpty(questionVal, "Basic requires a question")) return;
          if (!requireNonEmpty(answerVal, "Basic requires an answer")) return;
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("Q", questionVal));
          block.push(...formatPipeField("A", answerVal));
        } else if (type === "cloze") {
          if (!requireNonEmpty(questionVal, "Cloze requires text with at least one {{cN::...}} token")) return;
          if (!hasClozeToken(questionVal)) {
            new Notice(`${BRAND}: Cloze requires at least one {{cN::...}} token`);
            focusFirstField(cardEditor.root);
            return;
          }
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("CQ", questionVal));
        } else if (type === "mcq") {
          if (!requireNonEmpty(questionVal, "Multiple Choice requires a stem")) return;
          const mcqValues = cardEditor.getMcqOptions?.();
          const correct = String(mcqValues?.correct || "").trim();
          const wrongs = (mcqValues?.wrongs || []).map((x: any) => String(x || "").trim()).filter(Boolean);
          if (!requireNonEmpty(correct, "Multiple Choice requires a correct option")) return;
          if (wrongs.length < 1) {
            new Notice(`${BRAND}: Multiple Choice requires at least one wrong option`);
            focusFirstField(cardEditor.root);
            return;
          }
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("MCQ", questionVal));
          for (const wrong of wrongs) block.push(...formatPipeField("O", wrong));
          block.push(...formatPipeField("A", correct));
        } else {
          new Notice(`${BRAND}: unsupported card type`);
          return;
        }

        if (infoVal) block.push(...formatPipeField("I", infoVal));
        if (groupsVal) block.push(...formatPipeField("G", groupsVal));
        block.push("");

        // Persist any pasted images to the vault
        let finalContent = block.join("\n");
        if (this.pendingImages.size > 0) {
          finalContent = await this.savePendingImages(active, finalContent);
        }

        await insertTextAtCursorOrAppend(active, finalContent);
        this.close();

        // Auto-sync after a short delay so the new block gets picked up
        setTimeout(async () => {
          try {
            const res = await syncOneFile(this.plugin, active);
            new Notice(
              `${BRAND}: added + synced — ${res.newCount} new; ${res.updatedCount} updated; ${res.sameCount} unchanged; ${res.idsInserted} IDs inserted.`,
            );
          } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error(e);
            new Notice(`${BRAND}: sync failed (${String(e?.message || e)})`);
          }
        }, 1000);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        new Notice(`${BRAND}: add failed (${String(e?.message || e)})`);
      }
    };

  }

  onClose() {
    // Discard any unsaved pending images
    this.pendingImages.clear();

    this.containerEl.removeClass("sprout-modal-container");
    this.containerEl.removeClass("sprout-modal-dim");
    this.modalEl.removeClass("bc", "sprout-modals");
    this.contentEl.removeClass("bc");
    this.contentEl.empty();
  }
}
