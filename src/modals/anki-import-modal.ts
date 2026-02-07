/**
 * @file src/modals/anki-import-modal.ts
 * @summary Obsidian modal for importing Anki .apkg files. Provides a multi-step
 * flow: file selection → preview → options → import progress → results summary.
 *
 * @exports
 *  - AnkiImportModal — Obsidian Modal subclass
 */

import { Modal, Notice, setIcon } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import { log } from "../core/logger";
import { previewApkg, importFromApkg, type ImportOptions, type ImportPreview, type ImportResult, type ModelFieldMapping } from "../anki/anki-import";
import { setModalTitle, createThemedDropdown } from "./modal-utils";

export class AnkiImportModal extends Modal {
  private plugin: SproutPlugin;
  private apkgBytes: Uint8Array | null = null;
  private apkgFileName = "";
  private preview: ImportPreview | null = null;
  private fieldMappings: ModelFieldMapping[] = [];

  constructor(plugin: SproutPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen() {
    setModalTitle(this, "Import from Anki");

    this.containerEl.addClass("sprout-modal-container");
    this.containerEl.addClass("sprout-modal-dim");
    this.containerEl.addClass("sprout");
    this.modalEl.addClass("bc", "sprout-modals", "sprout-anki-import-modal");
    this.contentEl.addClass("bc");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

    const modalRoot = contentEl;

    this.renderFileStep(modalRoot);
  }

  onClose() {
    this.containerEl.removeClass("sprout-modal-container");
    this.containerEl.removeClass("sprout-modal-dim");
    this.containerEl.removeClass("sprout");
    this.modalEl.removeClass("bc", "sprout-modals", "sprout-anki-import-modal");
    this.contentEl.removeClass("bc");
    this.contentEl.empty();
    this.apkgBytes = null;
    this.preview = null;
    this.fieldMappings = [];
  }

  /** Shared footer builder. */
  private buildFooter(root: HTMLElement): HTMLElement {
    return root.createDiv({ cls: "bc flex items-center justify-end gap-4 sprout-modal-footer" });
  }

  /** Shared nav button builder (← Back, Cancel, Next →, Import, etc.). */
  private mkNavBtn(parent: HTMLElement, label: string, icon: string, opts?: { tooltip?: string }): HTMLButtonElement {
    const btn = parent.createEl("button", {
      cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "data-tooltip": opts?.tooltip || label },
    });
    const ic = btn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(ic, icon);
    btn.createSpan({ text: label });
    return btn;
  }

  /** Helper: label + control row. */
  private mkField(parent: HTMLElement, label: string, hint?: string) {
    const wrapper = parent.createDiv({ cls: "bc flex flex-col gap-1" });
    const lbl = wrapper.createEl("label", { cls: "bc text-sm font-medium", text: label });
    if (hint) lbl.setAttribute("data-tooltip", hint);
    return wrapper;
  }

  // ── Step 1: File selection ──────────────────────────────────────────────────

  private renderFileStep(root: HTMLElement) {
    root.empty();
    setModalTitle(this, "Import from Anki");

    const body = root.createDiv({ cls: "bc flex flex-col gap-4" });

    body.createDiv({
      text: "Select an Anki .apkg file to import. Image Occlusion cards will be skipped.",
      cls: "bc text-sm text-muted-foreground",
    });

    const fileRow = body.createDiv({ cls: "bc flex items-center gap-3" });

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".apkg";
    fileInput.style.display = "none";
    fileRow.appendChild(fileInput);

    const pickBtn = fileRow.createEl("button", {
      cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "data-tooltip": "Choose an Anki .apkg file from your computer" },
    });
    const pickIcon = pickBtn.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(pickIcon, "file-up");
    pickBtn.createSpan({ text: "Choose .apkg file" });

    const fileLabel = fileRow.createEl("span", {
      text: "No file selected",
      cls: "bc text-sm text-muted-foreground",
    });

    pickBtn.onclick = () => fileInput.click();

    const footer = this.buildFooter(root);
    const cancelBtn = this.mkNavBtn(footer, "Cancel", "x");
    cancelBtn.onclick = () => this.close();

    const nextBtn = this.mkNavBtn(footer, "Next", "arrow-right", { tooltip: "Scan file and preview contents" });
    nextBtn.disabled = true;

    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      this.apkgFileName = file.name;
      fileLabel.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
      const pickSpan = pickBtn.querySelector("span:last-child");
      if (pickSpan) pickSpan.textContent = "Change file";

      try {
        const buffer = await file.arrayBuffer();
        this.apkgBytes = new Uint8Array(buffer);
        nextBtn.disabled = false;
      } catch (err) {
        fileLabel.textContent = "Error reading file";
        log.error("Failed to read .apkg file", err);
      }
    };

    nextBtn.onclick = async () => {
      if (!this.apkgBytes) return;
      nextBtn.disabled = true;
      const nextSpan = nextBtn.querySelector("span:last-child");
      if (nextSpan) nextSpan.textContent = "Scanning…";
      try {
        this.preview = await previewApkg(this.apkgBytes);
        this.renderPreviewStep(root);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`${BRAND}: Failed to read .apkg — ${msg}`);
        nextBtn.disabled = false;
        if (nextSpan) nextSpan.textContent = "Next";
      }
    };
  }

  // ── Step 2: Preview ─────────────────────────────────────────────────────────

  private renderPreviewStep(root: HTMLElement) {
    if (!this.preview) return;
    const p = this.preview;
    root.empty();
    setModalTitle(this, "Import Preview");

    const body = root.createDiv({ cls: "bc flex flex-col gap-4" });

    // Stats grid
    const statsGrid = body.createDiv({ cls: "bc grid grid-cols-1 gap-1 md:grid-cols-2" });

    const addStat = (icon: string, label: string, value: string | number) => {
      const row = statsGrid.createDiv({ cls: "bc flex items-center gap-2 text-sm py-0.5" });
      const ic = row.createSpan({ cls: "bc inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground" });
      setIcon(ic, icon);
      row.createSpan({ text: `${label}: ` });
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
      const deckSection = body.createDiv({ cls: "bc flex flex-col gap-1" });
      deckSection.createEl("label", { text: "Decks", cls: "bc text-sm font-medium" });
      const deckList = deckSection.createEl("ul", { cls: "bc text-sm pl-4 m-0" });
      for (const name of p.deckNames.slice(0, 20)) {
        deckList.createEl("li", { text: name });
      }
      if (p.deckNames.length > 20) {
        deckList.createEl("li", { text: `… and ${p.deckNames.length - 20} more`, cls: "bc text-muted-foreground" });
      }
    }

    // Warnings
    if (p.warnings.length > 0) {
      const warnBox = body.createDiv({ cls: "bc rounded-lg p-3 text-sm sprout-danger-callout" });
      for (const w of p.warnings) {
        warnBox.createEl("p", { text: `⚠️ ${w}`, cls: "bc mb-1" });
      }
    }

    const footer = this.buildFooter(root);
    const backBtn = this.mkNavBtn(footer, "Back", "arrow-left", { tooltip: "Go back to file selection" });
    backBtn.onclick = () => this.renderFileStep(root);

    const cancelBtn = this.mkNavBtn(footer, "Cancel", "x");
    cancelBtn.onclick = () => this.close();

    const nextBtn = this.mkNavBtn(footer, "Next", "arrow-right", { tooltip: "Configure import options" });
    nextBtn.onclick = () => this.renderOptionsStep(root);
  }

  // ── Step 3: Options ─────────────────────────────────────────────────────────

  private renderOptionsStep(root: HTMLElement) {
    root.empty();
    setModalTitle(this, "Import Options");

    const body = root.createDiv({ cls: "bc flex flex-col gap-4" });

    // Target folder
    const folderField = this.mkField(body, "Target folder", "Vault folder where deck folders and files will be created");
    const folderInput = folderField.createEl("input", { type: "text", cls: "bc input w-full", value: "Imported Flashcards" });

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
    const backBtn = this.mkNavBtn(footer, "Back", "arrow-left", { tooltip: "Go back to preview" });
    backBtn.onclick = () => this.renderPreviewStep(root);

    const cancelBtn = this.mkNavBtn(footer, "Cancel", "x");
    cancelBtn.onclick = () => this.close();

    const importBtn = this.mkNavBtn(footer, "Import", "download", { tooltip: "Start importing cards" });
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
    const unknowns = this.preview?.unknownModels || [];
    root.empty();
    setModalTitle(this, "Map Custom Note Types");

    const body = root.createDiv({ cls: "bc flex flex-col gap-4" });

    body.createDiv({
      text: "These note types don't match standard Basic or Cloze. Map their fields to Sprout fields, or skip them.",
      cls: "bc text-sm text-muted-foreground",
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

      const card = body.createDiv({ cls: "bc rounded-lg p-3 flex flex-col gap-2" });

      // Header: model name + note count
      const hdr = card.createDiv({ cls: "bc flex items-center justify-between" });
      hdr.createEl("strong", { text: m.modelName, cls: "bc text-sm" });
      hdr.createSpan({ text: `${m.noteCount} note(s)`, cls: "bc text-xs text-muted-foreground" });

      // Fields list
      const fieldsList = card.createDiv({ cls: "bc text-xs text-muted-foreground" });
      fieldsList.textContent = `Fields: ${m.fieldNames.join(", ")}`;

      // Action: Map or Skip
      const actionField = this.mkField(card, "Action");
      const actionDropdown = createThemedDropdown([
        { value: "map", label: "Map fields → import" },
        { value: "skip", label: "Skip these notes" },
      ], "map");
      actionField.appendChild(actionDropdown.element);

      // Mapping controls container
      const mapControls = card.createDiv({ cls: "bc flex flex-col gap-2" });

      const renderMapControls = () => {
        mapControls.empty();
        if (st.action === "skip") {
          mapControls.createDiv({ text: "These notes will be skipped.", cls: "bc text-xs text-muted-foreground italic" });
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
    const backBtn = this.mkNavBtn(footer, "Back", "arrow-left", { tooltip: "Go back to options" });
    backBtn.onclick = () => this.renderOptionsStep(root);

    const cancelBtn = this.mkNavBtn(footer, "Cancel", "x");
    cancelBtn.onclick = () => this.close();

    const importBtn = this.mkNavBtn(footer, "Import", "download", { tooltip: "Start importing cards" });
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
    root.empty();
    setModalTitle(this, "Importing…");

    const body = root.createDiv({ cls: "bc flex flex-col gap-4" });

    const bar = body.createDiv({ cls: "bc w-full h-2 rounded-full bg-secondary overflow-hidden" });
    const fill = bar.createDiv({ cls: "bc h-full bg-primary rounded-full transition-all duration-300" });
    fill.style.width = "2%";

    const statusText = body.createEl("p", {
      text: `Processing ${this.apkgFileName}…`,
      cls: "bc text-sm text-muted-foreground",
    });

    /** Update the bar and status text, yielding to the browser so the repaint is visible. */
    const setProgress = async (pct: number, phase: string) => {
      fill.style.width = `${Math.min(pct, 100)}%`;
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
      fill.style.width = "100%";
      fill.style.backgroundColor = "var(--text-error)";
      statusText.textContent = `Error: ${msg}`;
      log.error("Anki import failed", err);
      new Notice(`${BRAND}: Import failed — ${msg}`);

      const footer = this.buildFooter(root);
      const closeBtn = this.mkNavBtn(footer, "Close", "x");
      closeBtn.onclick = () => this.close();
    }
  }

  private renderResultStep(root: HTMLElement, result: ImportResult) {
    root.empty();
    setModalTitle(this, "Import Complete");

    const body = root.createDiv({ cls: "bc flex flex-col gap-1" });

    const addRow = (label: string, value: number | string) => {
      const row = body.createDiv({ cls: "bc flex justify-between text-sm py-1" });
      row.createSpan({ text: label });
      row.createEl("strong", { text: String(value) });
    };

    addRow("Cards imported", result.imported);
    if (result.ioSkipped > 0) addRow("IO cards skipped", result.ioSkipped);
    if (result.otherSkipped > 0) addRow("Custom types skipped", result.otherSkipped);
    if (result.duplicates > 0) addRow("Duplicates skipped", result.duplicates);
    addRow("Files created", result.filesCreated.length);

    if (result.warnings.length > 0) {
      const warnBox = root.createDiv({ cls: "bc rounded-lg p-3 text-sm mt-3" });
      warnBox.createEl("strong", { text: "Warnings:" });
      for (const w of result.warnings.slice(0, 10)) {
        warnBox.createEl("p", { text: w, cls: "bc mb-1" });
      }
    }

    const footer = this.buildFooter(root);
    const doneBtn = this.mkNavBtn(footer, "Done", "check", { tooltip: "Close this dialog" });
    doneBtn.onclick = () => this.close();
  }
}
