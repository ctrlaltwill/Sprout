/**
 * @file src/modals/anki-import-modal.ts
 * @summary Obsidian modal for importing Anki .apkg files. Provides a multi-step
 * flow: file selection → preview → options → import progress → results summary.
 *
 * @exports
 *  - AnkiImportModal — Obsidian Modal subclass
 */

import { Modal, Notice, setIcon } from "obsidian";
import type LearnKitPlugin from "../../main";
import { log } from "../core/logger";
import { previewApkg, importFromApkg, type ImportOptions, type ImportPreview, type ImportResult, type ModelFieldMapping } from "../../platform/integrations/anki/anki-import";
import { setModalTitle, createThemedDropdown, scopeModalToWorkspace } from "./modal-utils";
import { setCssProps } from "../core/ui";
import { txCommon } from "../translations/ui-common";
import { t } from "../translations/translator";

export class AnkiImportModal extends Modal {
  private plugin: LearnKitPlugin;
  private apkgBytes: Uint8Array | null = null;
  private apkgFileName = "";
  private preview: ImportPreview | null = null;
  private fieldMappings: ModelFieldMapping[] = [];

  private tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  constructor(plugin: LearnKitPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen() {
    setModalTitle(this, "Import from Anki");

    scopeModalToWorkspace(this);
    this.containerEl.addClass("lk-modal-container");
    this.containerEl.addClass("lk-modal-dim");
    this.containerEl.addClass("learnkit");
    this.modalEl.addClass("lk-modals", "learnkit-anki-import-modal");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

    const modalRoot = contentEl;

    this.renderFileStep(modalRoot);
  }

  onClose() {
    this.containerEl.removeClass("lk-modal-container");
    this.containerEl.removeClass("lk-modal-dim");
    this.containerEl.removeClass("learnkit");
    this.modalEl.removeClass("lk-modals", "learnkit-anki-import-modal");
    this.contentEl.empty();
    this.apkgBytes = null;
    this.preview = null;
    this.fieldMappings = [];
  }

  /** Shared footer builder. */
  private buildFooter(root: HTMLElement): HTMLElement {
    return root.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer" });
  }

  /** Shared nav button builder (← Back, Cancel, Next →, Import, etc.). */
  private mkNavBtn(parent: HTMLElement, label: string, icon: string, opts?: { tooltip?: string }): HTMLButtonElement {
    const btn = parent.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": opts?.tooltip || label },
    });
    const ic = btn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(ic, icon);
    btn.createSpan({ text: label });
    return btn;
  }

  /** Helper: label + control row. */
  private mkField(parent: HTMLElement, label: string, hint?: string) {
    const wrapper = parent.createDiv({ cls: "flex flex-col gap-1" });
    const lbl = wrapper.createEl("label", { cls: "text-sm font-medium", text: label });
    if (hint) lbl.setAttribute("aria-label", hint);
    return wrapper;
  }

  // ── Step 1: File selection ──────────────────────────────────────────────────

  private renderFileStep(root: HTMLElement) {
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
    root.empty();
    setModalTitle(this, "Import from Anki");

    const body = root.createDiv({ cls: "flex flex-col gap-4" });

    body.createDiv({
      text: "Select an Anki .apkg file to import. Image occlusion cards will be skipped.",
      cls: "text-sm text-muted-foreground",
    });

    const fileRow = body.createDiv({ cls: "flex items-center gap-3" });

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".apkg";
    fileInput.classList.add("learnkit-hidden-important", "learnkit-hidden-important");
    fileRow.appendChild(fileInput);

    const pickBtn = fileRow.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": "Choose an Anki .apkg file from your computer" },
    });
    const pickIcon = pickBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(pickIcon, "file-up");
    pickBtn.createSpan({ text: this.tx("ui.anki.import.action.chooseApkg", "Choose .apkg file") });

    const fileLabel = fileRow.createEl("span", {
      text: "No file selected",
      cls: "text-sm text-muted-foreground",
    });

    pickBtn.onclick = () => fileInput.click();

    const footer = this.buildFooter(root);
    const cancelBtn = this.mkNavBtn(footer, common.cancel, "x");
    cancelBtn.onclick = () => this.close();

    const nextBtn = this.mkNavBtn(footer, common.next, "arrow-right", { tooltip: "Scan file and preview contents" });
    nextBtn.disabled = true;

    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      this.apkgFileName = file.name;
      fileLabel.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
      const pickSpan = pickBtn.querySelector("span:last-child");
      if (pickSpan) pickSpan.textContent = this.tx("ui.anki.import.action.changeFile", "Change file");

      try {
        const buffer = await file.arrayBuffer();
        this.apkgBytes = new Uint8Array(buffer);
        nextBtn.disabled = false;
      } catch (err) {
        fileLabel.textContent = this.tx("ui.anki.import.error.readingFile", "Error reading file");
        log.error("Failed to read .apkg file", err);
      }
    };

    nextBtn.onclick = async () => {
      if (!this.apkgBytes) return;
      nextBtn.disabled = true;
      const nextSpan = nextBtn.querySelector("span:last-child");
      if (nextSpan) nextSpan.textContent = this.tx("ui.anki.import.status.scanning", "Scanning") + "\u2026";
      try {
        this.preview = await previewApkg(this.apkgBytes);
        this.renderPreviewStep(root);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(this.tx("ui.anki.import.error.readApkg", "Failed to read .apkg — {message}", { message: msg }));
        nextBtn.disabled = false;
        if (nextSpan) nextSpan.textContent = common.next;
      }
    };
  }

  // ── Step 2: Preview ─────────────────────────────────────────────────────────

  private renderPreviewStep(root: HTMLElement) {
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
    if (!this.preview) return;
    const p = this.preview;
    root.empty();
    setModalTitle(this, "Import Preview");

    const body = root.createDiv({ cls: "flex flex-col gap-4" });

    // Stats grid
    const statsGrid = body.createDiv({ cls: "grid grid-cols-1 gap-1 md:grid-cols-2" });

    const addStat = (icon: string, label: string, value: string | number) => {
      const row = statsGrid.createDiv({ cls: "flex items-center gap-2 text-sm py-0.5" });
      const ic = row.createSpan({ cls: "inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground" });
      setIcon(ic, icon);
      row.createSpan({ text: this.tx("ui.anki.import.preview.statLabel", "{label}:", { label }) });
      row.createEl("strong", { text: String(value) });
    };

    addStat("file-text", "Total notes", p.totalNotes);
    addStat("layers", "Total cards", p.totalCards);
    addStat("check-circle", "Basic", p.basicCount);
    addStat("brackets", "Cloze", p.clozeCount);
    if (p.ioCount > 0) addStat("image-off", "Image Occlusion (skipped)", p.ioCount);
    if (p.otherCount > 0) addStat("help-circle", "Other (as Basic)", p.otherCount);
    if (p.mediaCount > 0) addStat("image", "Media files", p.mediaCount);

    if (p.deckNames.length > 0) {
      const deckSection = body.createDiv({ cls: "flex flex-col gap-1" });
      deckSection.createEl("label", { text: this.tx("ui.anki.import.preview.decks", "Decks"), cls: "text-sm font-medium" });
      const deckList = deckSection.createEl("ul", { cls: "text-sm pl-4 m-0" });
      for (const name of p.deckNames.slice(0, 20)) {
        deckList.createEl("li", { text: name });
      }
      if (p.deckNames.length > 20) {
        deckList.createEl("li", {
          text: "\u2026 " + this.tx("ui.anki.import.preview.moreDecks", "and {count} more", { count: p.deckNames.length - 20 }),
          cls: "text-muted-foreground",
        });
      }
    }

    // Warnings
    if (p.warnings.length > 0) {
      const warnBox = body.createDiv({ cls: "rounded-lg p-3 text-sm learnkit-danger-callout learnkit-danger-callout" });
      for (const w of p.warnings) {
        warnBox.createEl("p", { text: "⚠️ " + this.tx("ui.anki.import.preview.warningItem", "{warning}", { warning: w }), cls: "mb-1" });
      }
    }

    const footer = this.buildFooter(root);
    const backBtn = this.mkNavBtn(footer, common.back, "arrow-left", { tooltip: "Go back to file selection" });
    backBtn.onclick = () => this.renderFileStep(root);

    const cancelBtn = this.mkNavBtn(footer, common.cancel, "x");
    cancelBtn.onclick = () => this.close();

    const nextBtn = this.mkNavBtn(footer, common.next, "arrow-right", { tooltip: "Configure import options" });
    nextBtn.onclick = () => this.renderOptionsStep(root);
  }

  // ── Step 3: Options ─────────────────────────────────────────────────────────

  private renderOptionsStep(root: HTMLElement) {
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
    root.empty();
    setModalTitle(this, "Import Options");

    const body = root.createDiv({ cls: "flex flex-col gap-4" });

    // Target folder
    const folderField = this.mkField(body, "Target folder", "Vault folder where deck folders and files will be created");
    const folderInput = folderField.createEl("input", { type: "text", cls: "input w-full", value: "Imported Flashcards" });

    // Scheduling
    const schedField = this.mkField(body, "Scheduling", "Import as new cards or preserve Anki scheduling data");
    const schedDropdown = createThemedDropdown([
      { value: "new", label: "Import as New" },
      { value: "preserve", label: "Preserve scheduling" },
    ], "new");
    schedField.appendChild(schedDropdown.element);

    // Group mapping
    const groupField = this.mkField(body, "Groups", "How to map Anki structure to Sprout groups");
    const groupDropdown = createThemedDropdown([
      { value: "tags-only", label: "Anki tags" },
      { value: "deck-as-group", label: "Deck hierarchy" },
    ], "tags-only");
    groupField.appendChild(groupDropdown.element);

    // Duplicates
    const dupeField = this.mkField(body, "Duplicates", "What to do when a card with the same content already exists");
    const dupeDropdown = createThemedDropdown([
      { value: "skip", label: "Skip duplicates" },
      { value: "import-anyway", label: "Import anyway" },
    ], "skip");
    dupeField.appendChild(dupeDropdown.element);

    const footer = this.buildFooter(root);
    const backBtn = this.mkNavBtn(footer, common.back, "arrow-left", { tooltip: "Go back to preview" });
    backBtn.onclick = () => this.renderPreviewStep(root);

    const cancelBtn = this.mkNavBtn(footer, common.cancel, "x");
    cancelBtn.onclick = () => this.close();

    const importBtn = this.mkNavBtn(footer, this.tx("ui.anki.import.action.import", "Import"), "download", { tooltip: "Start importing cards" });
    importBtn.onclick = () => {
      const opts: ImportOptions = {
        targetFolder: folderInput.value.trim() || "Imported Flashcards",
        preserveScheduling: schedDropdown.getValue() === "preserve",
        groupMapping: groupDropdown.getValue() as ImportOptions["groupMapping"],
        duplicateStrategy: dupeDropdown.getValue() as ImportOptions["duplicateStrategy"],
        fieldMappings: this.fieldMappings.length ? this.fieldMappings : undefined,
      };

      // If there are unknown models the user hasn't mapped yet, show mapping step first
      const unknowns = this.preview?.unknownModels || [];
      if (unknowns.length > 0 && !this.fieldMappings.length) {
        this.renderFieldMappingStep(root, opts);
      } else {
        void this.renderProgressStep(root, opts);
      }
    };
  }

  // ── Step 3b: Field Mapping for unknown note types ───────────────────────────

  private renderFieldMappingStep(root: HTMLElement, opts: ImportOptions) {
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
    const unknowns = this.preview?.unknownModels || [];
    root.empty();
    setModalTitle(this, "Map Custom Note Types");

    const body = root.createDiv({ cls: "flex flex-col gap-4" });

    body.createDiv({
      text: "These note types don't match standard Basic or Cloze. Map their fields to Sprout fields, or skip them.",
      cls: "text-sm text-muted-foreground",
    });

    // Track per-model state: { action, importAs, qIdx, aIdx, iIdx }
    type MappingState = {
      action: "map" | "skip";
      importAs: "basic" | "cloze";
      qIdx: number;
      aIdx: number;
      iIdx: number;
    };
    const states: MappingState[] = unknowns.map((m) => ({
      action: "map",
      importAs: "basic",
      qIdx: 0,
      aIdx: m.fieldNames.length > 1 ? 1 : -1,
      iIdx: m.fieldNames.length > 2 ? 2 : -1,
    }));

    for (let mi = 0; mi < unknowns.length; mi++) {
      const m = unknowns[mi];
      const st = states[mi];

      const card = body.createDiv({ cls: "rounded-lg p-3 flex flex-col gap-2" });

      // Header: model name + note count
      const hdr = card.createDiv({ cls: "flex items-center justify-between" });
      hdr.createEl("strong", { text: m.modelName, cls: "text-sm" });
      hdr.createSpan({
        text: this.tx("ui.anki.import.mapping.noteCount", "{count} note(s)", { count: m.noteCount }),
        cls: "text-xs text-muted-foreground",
      });

      // Fields list
      const fieldsList = card.createDiv({ cls: "text-xs text-muted-foreground" });
      fieldsList.textContent = this.tx("ui.anki.import.mapping.fields", "Fields: {fields}", { fields: m.fieldNames.join(", ") });

      // Action: Map or Skip
      const actionField = this.mkField(card, "Action");
      const actionDropdown = createThemedDropdown([
        { value: "map", label: "Map fields → import" },
        { value: "skip", label: "Skip these notes" },
      ], "map");
      actionField.appendChild(actionDropdown.element);

      // Mapping controls container
      const mapControls = card.createDiv({ cls: "flex flex-col gap-2" });

      const renderMapControls = () => {
        mapControls.empty();
        if (st.action === "skip") {
          mapControls.createDiv({ text: this.tx("ui.anki.import.mapping.skippedNotes", "These notes will be skipped."), cls: "text-xs text-muted-foreground italic" });
          return;
        }

        // Import as
        const typeField = this.mkField(mapControls, "Import as");
        const typeDropdown = createThemedDropdown([
          { value: "basic", label: "Basic (Q/A)" },
          { value: "cloze", label: "Cloze" },
        ], st.importAs);
        typeField.appendChild(typeDropdown.element);
        typeDropdown.onChange((val) => { st.importAs = val as "basic" | "cloze"; });

        const makeFieldDropdown = (parent: HTMLElement, label: string, currentIdx: number, allowNone: boolean, onChange: (idx: number) => void) => {
          const f = this.mkField(parent, label);
          const opts: Array<{ value: string; label: string }> = [];
          if (allowNone) opts.push({ value: "-1", label: "— None —" });
          for (let fi = 0; fi < m.fieldNames.length; fi++) {
            opts.push({ value: String(fi), label: m.fieldNames[fi] });
          }
          const dd = createThemedDropdown(opts, String(currentIdx));
          f.appendChild(dd.element);
          dd.onChange((val) => onChange(Number(val)));
        };

        makeFieldDropdown(mapControls, st.importAs === "cloze" ? "Cloze text field" : "Question field", st.qIdx, false, (v) => { st.qIdx = v; });
        if (st.importAs === "basic") {
          makeFieldDropdown(mapControls, "Answer field", st.aIdx, true, (v) => { st.aIdx = v; });
        }
        makeFieldDropdown(mapControls, "Extra info field", st.iIdx, true, (v) => { st.iIdx = v; });
      };

      actionDropdown.onChange((val) => {
        st.action = val as "map" | "skip";
        renderMapControls();
      });

      renderMapControls();
    }

    const footer = this.buildFooter(root);
    const backBtn = this.mkNavBtn(footer, common.back, "arrow-left", { tooltip: "Go back to options" });
    backBtn.onclick = () => this.renderOptionsStep(root);

    const cancelBtn = this.mkNavBtn(footer, common.cancel, "x");
    cancelBtn.onclick = () => this.close();

    const importBtn = this.mkNavBtn(footer, this.tx("ui.anki.import.action.import", "Import"), "download", { tooltip: "Start importing cards" });
    importBtn.onclick = () => {
      // Build field mappings from user selections
      this.fieldMappings = [];
      for (let mi = 0; mi < unknowns.length; mi++) {
        const st = states[mi];
        if (st.action === "skip") continue;
        this.fieldMappings.push({
          modelId: unknowns[mi].modelId,
          importAs: st.importAs,
          questionFieldIdx: st.qIdx,
          answerFieldIdx: st.aIdx,
          infoFieldIdx: st.iIdx,
        });
      }
      opts.fieldMappings = this.fieldMappings.length ? this.fieldMappings : undefined;
      void this.renderProgressStep(root, opts);
    };
  }

  // ── Step 4: Progress + Results ──────────────────────────────────────────────

  private async renderProgressStep(root: HTMLElement, opts: ImportOptions) {
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
    root.empty();
    setModalTitle(this, "Importing…");

    const body = root.createDiv({ cls: "flex flex-col gap-4" });

    const bar = body.createDiv({ cls: "w-full h-2 rounded-full bg-secondary overflow-hidden" });
    const fill = bar.createDiv({ cls: "h-full bg-primary rounded-full transition-all duration-300 learnkit-anki-import-progress-fill learnkit-anki-import-progress-fill" });
    setCssProps(fill, "--learnkit-anki-import-progress", "2%");

    const statusText = body.createEl("p", {
      text: `Processing ${this.apkgFileName}…`,
      cls: "text-sm text-muted-foreground",
    });

    /** Update the bar and status text, yielding to the browser so the repaint is visible. */
    const setProgress = async (pct: number, phase: string) => {
      setCssProps(fill, "--learnkit-anki-import-progress", `${Math.min(pct, 100)}%`);
      statusText.textContent = phase;
      // Yield so the browser can repaint the bar
      await new Promise((r) => requestAnimationFrame(r));
    };

    try {
      await setProgress(5, "Reading database…");

      // Wire the real progress callback into the import options
      opts.onProgress = async (pct, phase) => {
        await setProgress(pct, phase);
      };

      const result = await importFromApkg(this.plugin, this.apkgBytes!, opts);

      await setProgress(92, "Saving…");
      await this.plugin.saveAll();

      await setProgress(100, "Done!");
      this.renderResultStep(root, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCssProps(fill, "--learnkit-anki-import-progress", "100%");
      setCssProps(fill, "--learnkit-anki-import-progress-color", "var(--text-error)");
      statusText.textContent = this.tx("ui.anki.import.status.error", "Error: {message}", { message: msg });
      log.error("Anki import failed", err);
      new Notice(this.tx("ui.anki.import.error.importFailed", "Import failed — {message}", { message: msg }));

      const footer = this.buildFooter(root);
      const closeBtn = this.mkNavBtn(footer, common.close, "x");
      closeBtn.onclick = () => this.close();
    }
  }

  private renderResultStep(root: HTMLElement, result: ImportResult) {
    const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
    root.empty();
    setModalTitle(this, "Import Complete");

    const body = root.createDiv({ cls: "flex flex-col gap-1" });

    const addRow = (label: string, value: number | string) => {
      const row = body.createDiv({ cls: "flex justify-between text-sm py-1" });
      row.createSpan({ text: label });
      row.createEl("strong", { text: String(value) });
    };

    addRow("Cards imported", result.imported);
    if (result.ioSkipped > 0) addRow("IO cards skipped", result.ioSkipped);
    if (result.otherSkipped > 0) addRow("Custom types skipped", result.otherSkipped);
    if (result.duplicates > 0) addRow("Duplicates skipped", result.duplicates);
    addRow("Files created", result.filesCreated.length);

    if (result.warnings.length > 0) {
      const warnBox = root.createDiv({ cls: "rounded-lg p-3 text-sm mt-3" });
      warnBox.createEl("strong", { text: this.tx("ui.anki.import.result.warnings", "Warnings:") });
      for (const w of result.warnings.slice(0, 10)) {
        warnBox.createEl("p", { text: w, cls: "mb-1" });
      }
    }

    const footer = this.buildFooter(root);
    const doneBtn = this.mkNavBtn(footer, common.close, "check", { tooltip: "Close this dialog" });
    doneBtn.onclick = () => this.close();
  }
}
