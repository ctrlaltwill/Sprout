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
import { log } from "../core/logger";
import { placePopover, queryFirst, setCssProps } from "../core/ui";
import type { CardType } from "../card-editor/card-editor";
import { syncOneFile } from "../sync/sync-engine";

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
  private _ioPasteHandler: ((ev: ClipboardEvent) => void) | null = null;
  private _ioBlobUrl: string | null = null;

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

        new Notice(`Image will be saved when you add the card`);
      } catch (e: unknown) {
        new Notice(`Failed to process pasted image (${e instanceof Error ? e.message : String(e)})`);
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
        new Notice(`Failed to save image ${placeholder} (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    return updatedContent;
  }

  // ── Modal lifecycle ───────────────────────────────────────────────────────

  onOpen() {
    setModalTitle(this, "Add flashcard");

    scopeModalToWorkspace(this);
    this.containerEl.addClass("sprout-modal-container");
    this.containerEl.addClass("sprout-modal-dim");
    this.containerEl.addClass("sprout");
    setCssProps(this.containerEl, "z-index", "2147483000");
    this.modalEl.addClass("bc", "sprout-modals", "sprout-card-creator-modal");
    setCssProps(this.modalEl, "z-index", "2147483001");
    this.contentEl.addClass("bc", "sprout-card-creator-content");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

    const file = this.app.workspace.getActiveFile();
    const path = String(file?.path || "");

    const modalRoot = contentEl;
    modalRoot.classList.add("sprout-card-creator-root");

    const body = modalRoot.createDiv({ cls: "bc flex flex-col gap-4" });

    // ── Type selector (dropdown + popover menu) ─────────────────────────────
    const typeField = body.createDiv({ cls: "bc flex flex-col gap-1" });
    typeField.classList.add("sprout-is-hidden");
    const typeId = `sprout-type-${Math.floor(Math.random() * 1e9)}`;

    const typeLabel = typeField.createEl("label", { cls: "bc text-sm font-medium", attr: { for: typeId } });
    typeLabel.textContent = "Question type";

    const typeSel = typeField.createEl("select", { cls: "bc w-full", attr: { id: typeId } });
    typeSel.createEl("option", { text: "Basic", value: "basic" });
    typeSel.createEl("option", { text: "Cloze", value: "cloze" });
    typeSel.createEl("option", { text: "Multiple choice", value: "mcq" });

    let cardEditor: ModalCardEditorResult | null = null;
    let currentType: CardType = this.forcedType || "basic";
    const typeLabelFor = (type: CardType) => {
      if (type === "reversed") return "Basic (Reversed)";
      if (type === "cloze") return "Cloze";
      if (type === "mcq") return "Multiple choice";
      if (type === "oq") return "Ordered question";
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
    const typeMenuGrid = body.createDiv({ cls: "bc grid grid-cols-2 gap-4 items-start w-full" });
    const typeMenuLeft = typeMenuGrid.createDiv({ cls: "bc flex flex-col gap-1 items-start" });
    typeMenuGrid.createDiv({ cls: "bc" });

    typeMenuLeft.createEl("label", { cls: "bc text-sm font-medium", text: "Type" });
    const typeMenuWrap = typeMenuLeft.createDiv({ cls: "bc sprout relative inline-flex" });
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
    typePopover.classList.add("sprout-popover-overlay");
    typeSproutWrapper.appendChild(typePopover);

    const typePanel = document.createElement("div");
    typePanel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto";
    typePopover.appendChild(typePanel);

    const typeMenu = document.createElement("div");
    typeMenu.setAttribute("role", "menu");
    typeMenu.className = "bc flex flex-col";
    typePanel.appendChild(typeMenu);

    let typeMenuOpen = false;
    const typeOptions: Array<{ value: CardType; label: string }> = [
      { value: "basic", label: "Basic" },
      { value: "reversed", label: "Basic (Reversed)" },
      { value: "cloze", label: "Cloze" },
      { value: "mcq", label: "Multiple Choice" },
      { value: "oq", label: "Ordered question" },
    ];

    updateTypeMenuLabel = () => {
      typeMenuBtnText.textContent = typeLabelFor(currentType);
      const show = isTypeMenuOption(currentType);
      typeMenuGrid.classList.toggle("sprout-is-hidden", !show);
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
      trigger: typeMenuBtn, panel: typeMenu, popoverEl: typePopover,
      width: 180,
    });

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
    const editorContainer = body.createDiv({ cls: "bc flex flex-col gap-3 sprout-card-creator-editor" });

    const renderCardEditor = () => {
      editorContainer.empty();
      try {
        cardEditor = createModalCardEditor({
          type: currentType === "reversed" ? "basic" : currentType,
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
          input.placeholder = "Location";
          input.title = displayPath;
          input.classList.add("sprout-location-input");
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

        focusFirstField(cardEditor.root);
      } catch (e: unknown) {
        cardEditor = null;
        const msg = `Failed to render card fields (${e instanceof Error ? e.message : String(e)})`;
        editorContainer.createDiv({ text: msg, cls: "bc text-sm text-destructive" });
        new Notice(msg);
      }
    };

    // ── IO image paste zone ─────────────────────────────────────────────────
    let ioImageData: ClipboardImage | null = null;

    const ioWrap = body.createDiv({ cls: "bc fieldset", attr: { role: "group" } });
    setVisible(ioWrap, false);
    ioWrap.createEl("legend", { text: "Image occlusion", cls: "bc" });

    const ioPasteZone = ioWrap.createDiv({ cls: "bc flex flex-col gap-3" });

    const ioPastePrompt = ioPasteZone.createDiv({
      text: "Paste an image (Ctrl+V) or drag & drop an image file",
      cls: "bc text-sm text-muted-foreground p-3 rounded-lg border border-dashed border-muted-foreground text-center",
    });

    const ioImagePreview = ioPasteZone.createDiv({ cls: "bc hidden" });
    ioImagePreview.classList.add("sprout-is-hidden");

    const ioImageContainer = ioImagePreview.createDiv({ cls: "bc flex flex-col gap-2" });
    const ioImgElement = ioImageContainer.createEl("img", { cls: "bc w-full rounded-lg" });
    ioImgElement.classList.add("sprout-io-preview-image");

    const ioImageInfo = ioImageContainer.createDiv({ cls: "bc text-xs text-muted-foreground" });
    const ioImageName = ioImageContainer.createDiv({ cls: "bc text-xs font-medium" });

    const ioActionRow = ioImageContainer.createDiv({ cls: "bc flex gap-2" });
    const ioClearBtn = ioActionRow.createEl("button", { text: "Clear", cls: "bc btn-outline flex-1" });
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
        ioImageInfo.textContent = `${ioImageData.mime} • ${(ioImageData.data.byteLength / 1024).toFixed(1)} KB`;
        ioImageName.textContent = "Ready to save and edit occlusions";
        ioImagePreview.classList.remove("sprout-is-hidden");
        ioPastePrompt.classList.add("sprout-is-hidden");
      } else {
        ioImagePreview.classList.add("sprout-is-hidden");
        ioPastePrompt.classList.remove("sprout-is-hidden");
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
          new Notice(`Failed to load pasted image (${e instanceof Error ? e.message : String(e)})`);
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
    const footer = modalRoot.createDiv({ cls: "bc flex items-center justify-end gap-4 sprout-modal-footer" });

    const cancelBtn = footer.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm", attr: { "data-tooltip": "Cancel" } });
    cancelBtn.type = "button";
    const cancelIcon = cancelBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(cancelIcon, "x");
    cancelBtn.createSpan({ text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const addBtn = footer.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm", attr: { "data-tooltip": "Add card to the active note" } });
    addBtn.type = "button";
    const addIcon = addBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(addIcon, "plus");
    addBtn.createSpan({ text: "Add" });
    addBtn.onclick = async () => {
      try {
        const active = getActiveMarkdownFile();
        if (!active) {
          new Notice("Open a Markdown note first");
          return;
        }

        const type = currentType;

        if (!cardEditor) {
          new Notice(`Select a question type before adding`);
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
            new Notice(`Cloze requires at least one {{cN::...}} token.`);
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
            new Notice(`Multiple choice requires at least one correct option`);
            focusFirstField(cardEditor.root);
            return;
          }
          if (wrongs.length < 1) {
            new Notice(`Multiple choice requires at least one wrong option`);
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
            new Notice("Ordering requires at least 2 steps.");
            focusFirstField(cardEditor.root);
            return;
          }
          if (steps.length > 20) {
            new Notice("Ordering supports a maximum of 20 steps.");
            focusFirstField(cardEditor.root);
            return;
          }
          if (titleVal) block.push(...formatPipeField("T", titleVal));
          block.push(...formatPipeField("OQ", questionVal));
          for (let i = 0; i < steps.length; i++) {
            block.push(...formatPipeField(String(i + 1) as unknown, steps[i]));
          }
        } else {
          new Notice(`Unsupported card type`);
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

        try {
          const res = await syncOneFile(this.plugin, active);
          new Notice(
            `Added + synced — ${res.newCount} new; ${res.updatedCount} updated; ${res.sameCount} unchanged; ${res.idsInserted} IDs inserted.`,
          );
        } catch (e: unknown) {
          log.error("sync failed", e);
          new Notice(`Sync failed (${e instanceof Error ? e.message : String(e)})`);
        }
      } catch (e: unknown) {
        log.error("add failed", e);
        new Notice(`Add failed (${e instanceof Error ? e.message : String(e)})`);
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

    this.containerEl.removeClass("sprout-modal-container");
    this.containerEl.removeClass("sprout-modal-dim");
    this.modalEl.removeClass("bc", "sprout-modals");
    this.contentEl.removeClass("bc", "sprout-card-creator-content");
    this.contentEl.empty();
  }
}
