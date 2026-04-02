/**
 * @file src/modals/card-creator-modal.ts
 * @summary Modal for adding new flashcards (Basic, Cloze, MCQ) to the active note.
 *
 * @exports
 *   - CardCreatorModal — Obsidian Modal subclass for card creation
 */
import { Modal, Notice, MarkdownView, TFile, setIcon, type App } from "obsidian";
import type LearnKitPlugin from "../../main";
import { log } from "../core/logger";
import { placePopover, queryFirst, setCssProps } from "../core/ui";
import type { CardType } from "../card-editor/card-editor";

import {
  normaliseVaultPath,
  extFromMime,
  bestEffortAttachmentPath,
  writeBinaryToVault,
  setVisible,
  focusFirstField,
  hasClozeToken,
  formatPipeField,
  createModalCardEditor,
  setModalTitle,
  scopeModalToWorkspace,
  type ModalCardFieldKey,
  type ModalCardEditorResult,
  type ClipboardImage,
  type PipeKey,
} from "./modal-utils";
import { t } from "../translations/translator";
import { txCommon } from "../translations/ui-common";

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
  private plugin: LearnKitPlugin;
  private forcedType?: CardType;
  private pendingImages: Map<string, PendingImage> = new Map();
  private _ioPasteHandler: ((ev: ClipboardEvent) => void) | null = null;
  private _ioBlobUrl: string | null = null;

  private tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  constructor(app: App, plugin: LearnKitPlugin, forcedType?: CardType) {
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

        new Notice(this.tx("ui.cardCreator.notice.imageSavedOnAdd", "Image will be saved when you add the card"));
      } catch (e: unknown) {
        new Notice(this.tx("ui.cardCreator.notice.pasteImageProcessFailed", "Failed to process pasted image ({message})", {
          message: e instanceof Error ? e.message : String(e),
        }));
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
      } catch (e: unknown) {
        new Notice(this.tx("ui.cardCreator.notice.saveImageFailed", "Failed to save image {placeholder} ({message})", {
          placeholder,
          message: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    return updatedContent;
  }

  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    setModalTitle(this, "Add flashcard");

    // Apply all CSS classes and z-index BEFORE scoping to workspace.
    // scopeModalToWorkspace forces a repaint, which only works if the
    // positioning CSS (position:absolute, z-index, etc.) is already active.
    this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "sprout");
    setCssProps(this.containerEl, "z-index", "2147483000");
    this.modalEl.addClass("lk-modals", "learnkit-card-creator-modal");
    setCssProps(this.modalEl, "z-index", "2147483001");
    scopeModalToWorkspace(this);
    this.contentEl.addClass("learnkit-card-creator-content");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

    const headerEl = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header");
    if (headerEl) {
      const titleEl = headerEl.querySelector<HTMLElement>(":scope > .modal-title");
      if (titleEl) titleEl.setText("Add flashcard");

      const existingCloseBtn = headerEl.querySelector<HTMLElement>(":scope > .learnkit-card-creator-close-btn");
      if (existingCloseBtn) existingCloseBtn.remove();

      const closeBtn = headerEl.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-scope-clear-btn learnkit-card-creator-close-btn learnkit-card-creator-close-btn",
        attr: { type: "button", "aria-label": "Close" },
      });
      closeBtn.setAttr("data-tooltip-position", "top");
      const closeIconWrap = closeBtn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(closeIconWrap, "x");
      closeBtn.createSpan({ cls: "", attr: { "data-learnkit-label": "true" }, text: "Close" });
      closeBtn.addEventListener("click", () => this.close());
    }

    const legacyCloseBtn = this.modalEl.querySelector<HTMLElement>(":scope > .modal-close-button");
    if (legacyCloseBtn) legacyCloseBtn.remove();

    const existingFooter = this.modalEl.querySelector<HTMLElement>(":scope > .learnkit-card-creator-footer");
    if (existingFooter) existingFooter.remove();

    const file = this.app.workspace.getActiveFile();
    const path = String(file?.path || "");

    const modalRoot = contentEl;
    modalRoot.classList.add("learnkit-card-creator-root", "learnkit-card-creator-root");

    const body = modalRoot.createDiv({ cls: "flex flex-col gap-4" });
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);

    // ── Type selector (dropdown + popover menu) ─────────────────────────────
    const typeField = body.createDiv({ cls: "flex flex-col gap-1" });
    typeField.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
    const typeId = `sprout-type-${Math.floor(Math.random() * 1e9)}`;

    const typeLabel = typeField.createEl("label", { cls: "text-sm font-medium", attr: { for: typeId } });
    typeLabel.textContent = this.tx("ui.cardCreator.questionType", "Question type");

    const typeSel = typeField.createEl("select", { cls: "w-full", attr: { id: typeId } });
    typeSel.createEl("option", { text: this.tx("ui.cardCreator.type.basic", "Basic"), value: "basic" });
    typeSel.createEl("option", { text: this.tx("ui.cardCreator.type.cloze", "Cloze"), value: "cloze" });
    typeSel.createEl("option", { text: this.tx("ui.cardCreator.type.multipleChoice", "Multiple choice"), value: "mcq" });

    let cardEditor: ModalCardEditorResult | null = null;
    let currentType: CardType = this.forcedType || "basic";
    const typeLabelFor = (type: CardType) => {
      if (type === "reversed") return "Basic (Reversed)";
      if (type === "cloze") return "Cloze";
      if (type === "mcq") return "Multiple choice";
      if (type === "oq") return "Ordered Question";
      return "Basic";
    };
    const isTypeMenuOption = (type: CardType) => type === "basic" || type === "reversed" || type === "cloze" || type === "mcq" || type === "oq";
    let updateTypeMenuLabel: () => void = () => {};
    const setType = (next: CardType) => {
      currentType = next;
      if (next === "reversed") typeSel.value = "basic";
      else typeSel.value = next === "mcq" ? "mcq" : next === "cloze" ? "cloze" : "basic";
      renderCardEditor();
      syncVisibility();
      updateTypeMenuLabel();
    };

    if (this.forcedType) {
      typeSel.value = this.forcedType;
    }

    // Popover-based type menu (uses inline popover for compatibility)
    // Layout requirement: show the card type selector in the left half of a 1x2 grid, with an empty right column.
    const typeMenuGrid = body.createDiv({ cls: "grid grid-cols-2 gap-4 items-start w-full" });
    const typeMenuLeft = typeMenuGrid.createDiv({ cls: "flex flex-col gap-1 items-start" });
    typeMenuGrid.createDiv({ cls: "" });

    typeMenuLeft.createEl("label", { cls: "text-sm font-medium", text: this.tx("ui.cardCreator.type.label", "Type") });
    const typeMenuWrap = typeMenuLeft.createDiv({ cls: "learnkit learnkit relative inline-flex" });
    const typeMenuBtn = typeMenuWrap.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-7 px-2 text-sm inline-flex items-center gap-2",
    });
    typeMenuBtn.setAttribute("aria-haspopup", "menu");
    typeMenuBtn.setAttribute("aria-expanded", "false");

    const typeMenuBtnText = document.createElement("span");
    typeMenuBtnText.className = "truncate";
    typeMenuBtn.appendChild(typeMenuBtnText);

    const typeMenuBtnIcon = document.createElement("span");
    typeMenuBtnIcon.className = "inline-flex items-center justify-center [&_svg]:size-3";
    setIcon(typeMenuBtnIcon, "chevron-down");
    typeMenuBtn.appendChild(typeMenuBtnIcon);

    const typePopover = document.createElement("div");
    const typeSproutWrapper = document.createElement("div");
    typeSproutWrapper.className = "learnkit";
    typePopover.className = "";
    typePopover.setAttribute("aria-hidden", "true");
    typePopover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay", "learnkit-card-creator-type-popover", "learnkit-card-creator-type-popover");
    typeSproutWrapper.appendChild(typePopover);

    const typePanel = document.createElement("div");
    typePanel.className = "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-card-creator-type-panel";
    typePopover.appendChild(typePanel);

    const typeMenu = document.createElement("div");
    typeMenu.setAttribute("role", "menu");
    typeMenu.className = "flex flex-col";
    typePanel.appendChild(typeMenu);

    let typeMenuOpen = false;
    const typeOptions: Array<{ value: CardType; label: string }> = [
      { value: "basic", label: this.tx("ui.cardCreator.type.basic", "Basic") },
      { value: "reversed", label: "Basic (Reversed)" },
      { value: "cloze", label: this.tx("ui.cardCreator.type.cloze", "Cloze") },
      { value: "mcq", label: this.tx("ui.cardCreator.type.multipleChoiceTitle", "Multiple Choice") },
      { value: "oq", label: "Ordered Question" },
    ];

    updateTypeMenuLabel = () => {
      typeMenuBtnText.textContent = typeLabelFor(currentType);
      const show = isTypeMenuOption(currentType);
      typeMenuGrid.classList.toggle("learnkit-is-hidden", !show);
    };
    updateTypeMenuLabel();

    const closeTypeMenu = () => {
      typeMenuBtn.setAttribute("aria-expanded", "false");
      typePopover.setAttribute("aria-hidden", "true");
      typePopover.classList.remove("is-open");
      try {
        typeSproutWrapper.remove();
      } catch (e) { log.swallow("remove type menu wrapper", e); }
      typeMenuOpen = false;
    };

    const placeTypeMenu = () => placePopover({
      trigger: typeMenuBtn,
      panel: typeMenu,
      popoverEl: typePopover,
      width: Math.ceil(typeMenuBtn.getBoundingClientRect().width || 0),
    });

    const buildTypeMenu = () => {
      while (typeMenu.firstChild) typeMenu.removeChild(typeMenu.firstChild);

      for (const opt of typeOptions) {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", opt.value === currentType ? "true" : "false");
        item.tabIndex = 0;
        item.className =
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground learnkit-card-creator-type-item";

        const dotWrap = document.createElement("div");
        dotWrap.className = "size-4 flex items-center justify-center";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
        dot.setAttribute("aria-hidden", "true");
        dotWrap.appendChild(dot);

        const txt = document.createElement("span");
        txt.className = "";
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
      typePopover.classList.add("is-open");
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
    const editorContainer = body.createDiv({ cls: "flex flex-col gap-3 learnkit-card-creator-editor learnkit-card-creator-editor" });

    const renderCardEditor = () => {
      editorContainer.empty();
      try {
        cardEditor = createModalCardEditor({
          type: currentType === "reversed" ? "basic" : currentType,
          locationPath: path,
          locationTitle: path ? `Target: ${path}` : "Target: (no active note)",
          plugin: this.plugin,
          editableFieldHeights: {
            title: { min: 50, max: 150 },
            question: { min: 50, max: 150 },
            answer: { min: 50, max: 150 },
            info: { min: 50, max: 150 },
          },
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
          wrapper.className = "flex flex-col gap-1";
          const label = document.createElement("label");
          label.className = "text-sm font-medium";
          label.textContent = this.tx("ui.cardCreator.location", "Location");
          const input = document.createElement("input");
          input.type = "text";
          input.className = "input w-full";
          input.disabled = true;
          const displayPath = path ? formatLocationPath(path) : "";
          input.value = displayPath;
          input.placeholder = this.tx("ui.cardCreator.location", "Location");
          input.title = displayPath;
          input.classList.add("learnkit-location-input", "learnkit-location-input");
          wrapper.appendChild(label);
          wrapper.appendChild(input);

          const children = Array.from(root.children);
          const groupsWrapper = children.find((child) => {
            const lbl = queryFirst(child, "label");
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
            questionInput.addEventListener("paste", (ev) => void this.handleImagePaste(ev, questionInput));
          }

          // MCQ answer field is handled by the options UI, not a plain textarea
          if (answerInput && answerInput instanceof HTMLTextAreaElement && currentType !== "mcq") {
            answerInput.addEventListener("paste", (ev) => void this.handleImagePaste(ev, answerInput));
          }

          if (infoInput && infoInput instanceof HTMLTextAreaElement) {
            infoInput.addEventListener("paste", (ev) => void this.handleImagePaste(ev, infoInput));
          }
        }

      } catch (e: unknown) {
        cardEditor = null;
        const msg = `Failed to render card fields (${e instanceof Error ? e.message : String(e)})`;
        editorContainer.createDiv({ text: msg, cls: "text-sm text-destructive" });
        new Notice(msg);
      }
    };

    // ── IO image paste zone ─────────────────────────────────────────────────
    let ioImageData: ClipboardImage | null = null;

    const ioWrap = body.createDiv({ cls: "fieldset", attr: { role: "group" } });
    setVisible(ioWrap, false);
    ioWrap.createEl("legend", { text: this.tx("ui.cardCreator.type.imageOcclusion", "Image occlusion"), cls: "" });

    const ioPasteZone = ioWrap.createDiv({ cls: "flex flex-col gap-3" });

    const ioPastePrompt = ioPasteZone.createDiv({
      text: "Paste an image (Ctrl+V) or drag & drop an image file",
      cls: "text-sm text-muted-foreground p-3 rounded-lg border border-dashed border-muted-foreground text-center",
    });

    const ioImagePreview = ioPasteZone.createDiv({ cls: "hidden" });
    ioImagePreview.classList.add("learnkit-is-hidden", "learnkit-is-hidden");

    const ioImageContainer = ioImagePreview.createDiv({ cls: "flex flex-col gap-2" });
    const ioImgElement = ioImageContainer.createEl("img", { cls: "w-full rounded-lg" });
    ioImgElement.classList.add("learnkit-io-preview-image", "learnkit-io-preview-image");

    const ioImageInfo = ioImageContainer.createDiv({ cls: "text-xs text-muted-foreground" });
    const ioImageName = ioImageContainer.createDiv({ cls: "text-xs font-medium" });

    const ioActionRow = ioImageContainer.createDiv({ cls: "flex gap-2" });
    const ioClearBtn = ioActionRow.createEl("button", { text: this.tx("ui.cardCreator.action.clear", "Clear"), cls: "learnkit-btn-toolbar learnkit-btn-toolbar flex-1" });
    ioClearBtn.type = "button";

    ioPasteZone.appendChild(ioPastePrompt);
    ioPasteZone.appendChild(ioImagePreview);
    ioWrap.appendChild(ioPasteZone);

    const updateIOPreview = () => {
      // Revoke previous blob URL to prevent memory leak
      if (this._ioBlobUrl) {
        URL.revokeObjectURL(this._ioBlobUrl);
        this._ioBlobUrl = null;
      }
      if (ioImageData) {
        this._ioBlobUrl = URL.createObjectURL(new Blob([ioImageData.data], { type: ioImageData.mime }));
        ioImgElement.src = this._ioBlobUrl;
        ioImageInfo.textContent = this.tx("ui.cardCreator.io.imageInfo", "{mime} • {sizeKb} KB", {
          mime: ioImageData.mime,
          sizeKb: (ioImageData.data.byteLength / 1024).toFixed(1),
        });
        ioImageName.textContent = this.tx("ui.cardCreator.io.ready", "Ready to save and edit occlusions");
        ioImagePreview.classList.remove("learnkit-is-hidden", "learnkit-is-hidden");
        ioPastePrompt.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
      } else {
        ioImagePreview.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
        ioPastePrompt.classList.remove("learnkit-is-hidden", "learnkit-is-hidden");
        ioImgElement.src = "";
      }
    };

    ioClearBtn.addEventListener("click", () => {
      ioImageData = null;
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
        } catch (e: unknown) {
          new Notice(this.tx("ui.cardCreator.notice.loadPastedImageFailed", "Failed to load pasted image ({message})", {
            message: e instanceof Error ? e.message : String(e),
          }));
        }
        return;
      }
    };

    this._ioPasteHandler = (ev: ClipboardEvent) => { void handleIoPaste(ev); };
    document.addEventListener("paste", this._ioPasteHandler);

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
            const saveable = view as unknown as { save?(): Promise<void> };
            if (typeof saveable?.save === "function") await saveable.save();
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

    // ── Footer buttons ──────────────────────────────────────────────────────
    const footer = this.modalEl.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer learnkit-card-creator-footer learnkit-card-creator-footer" });

    const cancelBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { "aria-label": "Cancel" },
    });
    cancelBtn.type = "button";
    cancelBtn.setAttr("data-tooltip-position", "top");
    cancelBtn.createSpan({ text: common.cancel });
    cancelBtn.onclick = () => this.close();

    const addBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-accent learnkit-btn-accent learnkit-card-creator-add-btn learnkit-card-creator-add-btn h-9 inline-flex items-center gap-2",
      attr: { "aria-label": "Add card to the active note" },
    });
    addBtn.type = "button";
    addBtn.setAttr("data-tooltip-position", "top");
    const addIcon = addBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(addIcon, "plus");
    addBtn.createSpan({ text: this.tx("ui.cardCreator.action.add", "Add") });
    addBtn.onclick = async () => {
      try {
        const active = getActiveMarkdownFile();
        if (!active) {
          new Notice(this.tx("ui.cardCreator.notice.openMarkdownFirst", "Open a Markdown note first"));
          return;
        }

        const type = currentType;

        if (!cardEditor) {
          new Notice(this.tx("ui.cardCreator.notice.selectTypeFirst", "Select a question type before adding"));
          return;
        }

        const getValue = (key: ModalCardFieldKey) => String((cardEditor!.inputEls)[key]?.value ?? "").trim();
        const titleVal = getValue("title");
        const questionVal = getValue("question");
        const answerVal = getValue("answer");
        const infoVal = getValue("info");
        const groupsVal = String(cardEditor.getGroupInputValue() || "").trim();

        const requireNonEmpty = (val: string, message: string) => {
          if (String(val || "").trim().length === 0) {
            new Notice(message);
            focusFirstField(cardEditor!.root);
            return false;
          }
          return true;
        };

        // Build the pipe-format card block
        const block: string[] = [];

        if (type === "basic" || type === "reversed") {
          if (!requireNonEmpty(questionVal, "Basic requires a question.")) return;
          if (!requireNonEmpty(answerVal, "Basic requires an answer.")) return;
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField(currentType === "reversed" ? "RQ" : "Q", questionVal));
          block.push(...formatPipeField("A", answerVal));
        } else if (type === "cloze") {
          if (!requireNonEmpty(questionVal, "Cloze requires text with at least one {{cN::...}} token.")) return;
          if (!hasClozeToken(questionVal)) {
            new Notice(this.tx("ui.cardCreator.notice.clozeRequiresToken", "Cloze requires at least one {{cN::...}} token."));
            focusFirstField(cardEditor.root);
            return;
          }
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("CQ", questionVal));
        } else if (type === "mcq") {
          if (!requireNonEmpty(questionVal, "Multiple choice requires a stem.")) return;
          const mcqValues = cardEditor.getMcqOptions?.();
          const corrects = (mcqValues?.corrects || [])
            .map((x: unknown) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x).trim() : ""))
            .filter(Boolean);
          const wrongs = (mcqValues?.wrongs || [])
            .map((x: unknown) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x).trim() : ""))
            .filter(Boolean);
          if (corrects.length < 1) {
            new Notice(this.tx("ui.cardCreator.notice.mcqNeedsCorrect", "Multiple choice requires at least one correct option"));
            focusFirstField(cardEditor.root);
            return;
          }
          if (wrongs.length < 1) {
            new Notice(this.tx("ui.cardCreator.notice.mcqNeedsWrong", "Multiple choice requires at least one wrong option"));
            focusFirstField(cardEditor.root);
            return;
          }
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("MCQ", questionVal));
          for (const wrong of wrongs) block.push(...formatPipeField("O", wrong));
          for (const c of corrects) block.push(...formatPipeField("A", c));
        } else if (type === "oq") {
          if (!requireNonEmpty(questionVal, "Ordering requires a question.")) return;
          const steps = cardEditor.getOqSteps?.() || [];
          if (steps.length < 2) {
            new Notice(this.tx("ui.cardCreator.notice.orderingMinSteps", "Ordering requires at least 2 steps."));
            focusFirstField(cardEditor.root);
            return;
          }
          if (steps.length > 20) {
            new Notice(this.tx("ui.cardCreator.notice.orderingMaxSteps", "Ordering supports a maximum of 20 steps."));
            focusFirstField(cardEditor.root);
            return;
          }
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("OQ", questionVal));
          for (let i = 0; i < steps.length; i++) {
            block.push(...formatPipeField(String(i + 1) as PipeKey, steps[i]));
          }
        } else {
          new Notice(this.tx("ui.cardCreator.notice.unsupportedType", "Unsupported card type"));
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

        await insertTextAtCursorOrAppend(active, finalContent, true);
        this.close();
        new Notice(this.tx("ui.cardCreator.notice.flashcardAdded", "Flashcard added"));
      } catch (e: unknown) {
        log.error("add failed", e);
        new Notice(this.tx("ui.cardCreator.notice.addFailed", "Add failed ({message})", {
          message: e instanceof Error ? e.message : String(e),
        }));
      }
    };

  }

  onClose() {
    // Remove global IO paste listener
    if (this._ioPasteHandler) {
      document.removeEventListener("paste", this._ioPasteHandler);
      this._ioPasteHandler = null;
    }

    // Revoke any active blob URL
    if (this._ioBlobUrl) {
      URL.revokeObjectURL(this._ioBlobUrl);
      this._ioBlobUrl = null;
    }

    // Discard any unsaved pending images
    this.pendingImages.clear();

    this.containerEl.removeClass("lk-modal-container");
    this.containerEl.removeClass("lk-modal-dim");
    this.modalEl.removeClass("lk-modals");
    const footerEl = this.modalEl.querySelector<HTMLElement>(":scope > .learnkit-card-creator-footer");
    if (footerEl) footerEl.remove();
    const closeBtn = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header .learnkit-card-creator-close-btn");
    if (closeBtn) closeBtn.remove();
    this.contentEl.removeClass("learnkit-card-creator-content");
    this.contentEl.empty();
  }
}
