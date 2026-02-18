/**
 * @file src/reviewer/card-editor.ts
 * @summary Provides the in-reviewer card editing modal and the logic to persist card edits back to the source Markdown note. Supports editing basic, cloze, and MCQ card types with field-aware block rewriting using pipe-delimited format.
 *
 * @exports
 *   - CardEditPayload — Type describing the editable fields of a card (title, Q/A, cloze text, MCQ stem/options, info)
 *   - CardEditModal — Modal class that renders a quick-edit form for a flashcard and invokes a save callback
 *   - saveCardEdits — Async function that writes edited card fields back to the source Markdown file and re-syncs
 */

import { Modal, Notice, TFile, setIcon, type App } from "obsidian";
import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import { normalizeCardOptions } from "../core/store";
import { queryFirst } from "../core/ui";
import { setModalTitle, scopeModalToWorkspace } from "../modals/modal-utils";
import { syncOneFile } from "../sync/sync-engine";
import { log } from "../core/logger";
import { escapeDelimiterRe } from "../core/delimiter";
import { findCardBlockRangeById } from "./markdown-block";

export type CardEditPayload = {
  title?: string;
  q?: string;
  a?: string;

  clozeText?: string;

  stem?: string;
  options?: string[]; // plain options (no **)
  correctIndex?: number; // 0-based, -1 allowed

  oqSteps?: string[]; // ordered steps for OQ

  info?: string;
};

const ANCHOR_RE = /^\^sprout-(\d{9})$/;
const ID_COMMENT_RE = /^<!--ID:(\d{9})-->$/;

// Recognised field starts for "continuation line" handling (supports both pipe and legacy colon)
const FIELD_START_PIPE_RE =
  /^(T|Title|Q|Question|A|Answer|I|Info|MCQ|O|Options|CQ|Cloze|C|K|IO|OQ|\d{1,2})\s*\|/;
const FIELD_START_COLON_RE =
  /^(T|Title|Q|Question|A|Answer|I|Info|MCQ|O|Options|CQ|Cloze|C|K|IO|OQ|\d{1,2}):/;

function isMarkerLine(line: string): boolean {
  const t = (line || "").trim();
  return ANCHOR_RE.test(t) || ID_COMMENT_RE.test(t);
}

function isFieldStart(line: string): boolean {
  const t = (line || "").trim();
  return isMarkerLine(t) || FIELD_START_PIPE_RE.test(t) || FIELD_START_COLON_RE.test(t);
}

function normaliseNewlines(s: string): string[] {
  const raw = String(s ?? "");
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  // Keep intentional blank lines; trim only trailing whitespace
  return lines.map((x) => x.replace(/\s+$/g, ""));
}

function setTaggedSection(
  block: string[],
  tagCandidates: string[],
  newValue: string | undefined,
): string[] {
  const valueLines = newValue === undefined ? null : normaliseNewlines(newValue);
  // Match both delimiter and colon formats when finding existing fields
  const delimEsc = escapeDelimiterRe();
  const tagResPipe = tagCandidates.map((t) => new RegExp(`^${t}\\s*${delimEsc}`, "i"));
  const tagResColon = tagCandidates.map((t) => new RegExp(`^${t}:\\s*`, "i"));

  let tagIdx = -1;
  let usedTag = tagCandidates[0];

  for (let i = 0; i < block.length; i++) {
    const line = (block[i] || "").trim();
    if (isMarkerLine(line)) continue;

    // Check pipe format first (preferred)
    for (let k = 0; k < tagResPipe.length; k++) {
      if (tagResPipe[k].test(block[i] || "")) {
        tagIdx = i;
        usedTag = tagCandidates[k];
        break;
      }
    }
    if (tagIdx >= 0) break;

    // Check colon format (legacy)
    for (let k = 0; k < tagResColon.length; k++) {
      if (tagResColon[k].test(block[i] || "")) {
        tagIdx = i;
        usedTag = tagCandidates[k];
        break;
      }
    }
    if (tagIdx >= 0) break;
  }

  // If no change requested, return block unchanged
  if (valueLines === null) return block;

  // If value is empty -> remove the section if present
  const shouldRemove = valueLines.join("\n").trim() === "";

  if (tagIdx < 0) {
    if (shouldRemove) return block;

    // Insert after initial marker stack (anchors/comments)
    let insertAt = 0;
    while (
      insertAt < block.length &&
      isMarkerLine((block[insertAt] || "").trim())
    )
      insertAt++;

    // Always use pipe format for new fields
    const isSingleLine = valueLines.length === 1;
    let toInsert: string[];
    
    if (isSingleLine) {
      // Single line: KEY | value |
      const head = `${usedTag} | ${valueLines[0] ?? ""} |`.replace(/\s+\|$/g, " |");
      toInsert = [head];
    } else {
      // Multi-line: KEY | first line
      //             continuation lines
      //             last line |
      const head = `${usedTag} | ${valueLines[0] ?? ""}`;
      const middle = valueLines.slice(1, -1);
      const last = `${valueLines[valueLines.length - 1] ?? ""} |`;
      toInsert = [head, ...middle, last];
    }

    return [...block.slice(0, insertAt), ...toInsert, ...block.slice(insertAt)];
  }

  // Identify section end (continuation lines until next field/marker)
  let end = tagIdx + 1;
  while (end < block.length) {
    const t = (block[end] || "").trim();
    if (isFieldStart(t)) break;
    end++;
  }

  if (shouldRemove) {
    return [...block.slice(0, tagIdx), ...block.slice(end)];
  }

  // Always output in pipe format (convert from colon if needed)
  const isSingleLine = valueLines.length === 1;
  let replacement: string[];
  
  if (isSingleLine) {
    // Single line: KEY | value |
    const head = `${usedTag} | ${valueLines[0] ?? ""} |`.replace(/\s+\|$/g, " |");
    replacement = [head];
  } else {
    // Multi-line: KEY | first line
    //             continuation lines
    //             last line |
    const head = `${usedTag} | ${valueLines[0] ?? ""}`;
    const middle = valueLines.slice(1, -1);
    const last = `${valueLines[valueLines.length - 1] ?? ""} |`;
    replacement = [head, ...middle, last];
  }

  return [...block.slice(0, tagIdx), ...replacement, ...block.slice(end)];
}

function mkSectionTitle(parent: HTMLElement, text: string) {
  parent.createEl("label", { text, cls: "text-sm font-medium" });
}

export class CardEditModal extends Modal {
  private card: CardRecord;
  private onSave: (payload: CardEditPayload) => void | Promise<void>;

  constructor(
    app: App,
    card: CardRecord,
    onSave: (payload: CardEditPayload) => void | Promise<void>,
  ) {
    super(app);
    this.card = card;
    this.onSave = onSave;
  }

  onOpen() {
    scopeModalToWorkspace(this);
    this.containerEl.addClass("sprout-modal-container", "sprout-modal-dim", "sprout");
    this.modalEl.addClass("bc", "sprout-modals", "sprout-edit-modal");
    this.contentEl.addClass("bc");

    setModalTitle(this, "Quick edit flashcard");

    const { contentEl } = this;
    contentEl.empty();

    const type = String((this.card).type || "basic");
    const id = String((this.card).id || "");

    const mkInput = (value: string) => {
      const input = contentEl.createEl("input");
      input.type = "text";
      input.value = value || "";
      input.classList.add("input", "w-full");
      return input;
    };

    const mkTextarea = (value: string, rows = 4) => {
      const ta = contentEl.createEl("textarea");
      ta.value = value || "";
      ta.rows = rows;
      ta.classList.add("textarea", "w-full", "sprout-textarea-fixed");
      return ta;
    };

    // ---- Title (always first) ----
    mkSectionTitle(contentEl, "Title");
    const titleEl = mkInput(String((this.card).title || ""));

    // ---- Per-type fields ----
    let qEl: HTMLTextAreaElement | null = null;
    let aEl: HTMLTextAreaElement | null = null;

    let clozeEl: HTMLTextAreaElement | null = null;

    // MCQ UI state
    let mcqStemEl: HTMLTextAreaElement | null = null;
    const optionRows: Array<{
      wrap: HTMLElement;
      input: HTMLInputElement;
      radio: HTMLInputElement;
      delBtn: HTMLButtonElement;
    }> = [];
    let correctIndex = -1;

    const addMcqOptionRow = (initialValue = "", makeCorrect = false) => {
      const idx = optionRows.length;

      const row = contentEl.createDiv({ cls: "sprout-edit-mcq-option-row" });

      row.createEl("div", { text: `Option ${idx + 1}`, cls: "sprout-muted sprout-edit-mcq-option-label" });

      const input = row.createEl("input");
      input.type = "text";
      input.value = initialValue || "";
      input.classList.add("sprout-edit-mcq-option-input");

      const radio = row.createEl("input");
      radio.type = "radio";
      radio.name = `sprout-mcq-correct-${id}`;
      radio.title = "Correct answer";
      radio.checked = makeCorrect;

      const delBtn = row.createEl("button", { text: "−" });
      delBtn.type = "button";

      const rec = { wrap: row, input, radio, delBtn };
      optionRows.push(rec);

      const syncCorrectFromRadios = () => {
        correctIndex = optionRows.findIndex((r) => r.radio.checked);
      };

      radio.addEventListener("change", () => {
        // native radios already enforce single selection, but keep state mirrored
        syncCorrectFromRadios();
      });

      delBtn.addEventListener("click", () => {
        const pos = optionRows.indexOf(rec);
        if (pos < 0) return;

        // Remove DOM + array entry
        rec.wrap.remove();
        optionRows.splice(pos, 1);

        // If we deleted the selected one, clear selection
        const prevCorrect = correctIndex;
        syncCorrectFromRadios();
        if (prevCorrect === pos) {
          correctIndex = optionRows.findIndex((r) => r.radio.checked);
        }

        // Renumber option labels
        optionRows.forEach((r, i) => {
          const labelEl = queryFirst(r.wrap, "div");
          if (labelEl) labelEl.textContent = `Option ${i + 1}`;
        });
      });

      if (makeCorrect) {
        correctIndex = idx;
      }
    };

    if (type === "cloze") {
      mkSectionTitle(contentEl, "Cloze");
      clozeEl = mkTextarea(String((this.card).clozeText || ""), 5);

      mkSectionTitle(contentEl, "Extra information");
      const infoEl = mkTextarea(String((this.card).info || ""), 4);

      this.renderButtons(type, titleEl, {
        clozeEl,
        infoEl,
        getMcq: () => null,
        qEl: null,
        aEl: null,
      });

      return;
    }

    if (type === "basic" || type === "reversed") {
      mkSectionTitle(contentEl, "Question");
      qEl = mkTextarea(String((this.card).q || ""), 4);

      mkSectionTitle(contentEl, "Answer");
      aEl = mkTextarea(String((this.card).a || ""), 4);

      mkSectionTitle(contentEl, "Extra information");
      const infoEl = mkTextarea(String((this.card).info || ""), 4);

      this.renderButtons(type, titleEl, {
        qEl,
        aEl,
        infoEl,
        getMcq: () => null,
        clozeEl: null,
      });

      return;
    }

    if (type === "oq") {
      mkSectionTitle(contentEl, "Question");
      qEl = mkTextarea(String((this.card).q || ""), 4);

      mkSectionTitle(contentEl, "Steps (correct order)");

      const oqHint = contentEl.createDiv({ cls: "text-xs text-muted-foreground" });
      oqHint.textContent = "Drag the grip handles to reorder steps. Steps are shuffled during review.";

      const oqListContainer = contentEl.createDiv({ cls: "sprout-oq-editor-list" });

      const oqStepRows: Array<{ row: HTMLElement; input: HTMLInputElement; badge: HTMLElement }> = [];

      const oqRenumber = () => {
        oqStepRows.forEach((entry, i) => {
          entry.badge.textContent = String(i + 1);
        });
      };

      const oqUpdateRemove = () => {
        const disable = oqStepRows.length <= 2;
        for (const entry of oqStepRows) {
          const btn = entry.row.querySelector<HTMLButtonElement>(".sprout-oq-del-btn");
          if (btn) {
            btn.disabled = disable;
            btn.classList.toggle("is-disabled", disable);
          }
        }
      };

      const addOqStepRow = (value: string) => {
        const row = contentEl.createDiv({ cls: "sprout-edit-mcq-option-row" });
        row.draggable = true;

        // Grip handle
        const grip = document.createElement("span");
        grip.className = "inline-flex items-center justify-center text-muted-foreground cursor-grab sprout-oq-grip";
        setIcon(grip, "grip-vertical");
        row.appendChild(grip);

        // Number badge
        const badge = document.createElement("span");
        badge.className = "inline-flex items-center justify-center text-xs font-medium text-muted-foreground w-5 shrink-0";
        badge.textContent = String(oqStepRows.length + 1);
        row.appendChild(badge);

        const input = row.createEl("input");
        input.type = "text";
        input.value = value || "";
        input.classList.add("sprout-edit-mcq-option-input");
        input.placeholder = `Step ${oqStepRows.length + 1}`;

        const delBtn = row.createEl("button", { text: "−", cls: "sprout-oq-del-btn" });
        delBtn.type = "button";
        delBtn.addEventListener("click", () => {
          if (oqStepRows.length <= 2) return;
          const pos = oqStepRows.findIndex((e) => e.input === input);
          if (pos < 0) return;
          oqStepRows[pos].row.remove();
          oqStepRows.splice(pos, 1);
          oqRenumber();
          oqUpdateRemove();
        });

        // DnD reorder
        row.addEventListener("dragstart", (ev) => {
          const idx = oqStepRows.findIndex((e) => e.row === row);
          ev.dataTransfer?.setData("text/plain", String(idx));
          row.classList.add("sprout-oq-row-dragging");
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("sprout-oq-row-dragging");
        });
        row.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          ev.dataTransfer!.dropEffect = "move";
        });
        row.addEventListener("drop", (ev) => {
          ev.preventDefault();
          const fromIdx = parseInt(ev.dataTransfer?.getData("text/plain") || "-1", 10);
          const toIdx = oqStepRows.findIndex((e) => e.row === row);
          if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
          const [moved] = oqStepRows.splice(fromIdx, 1);
          oqStepRows.splice(toIdx, 0, moved);
          oqListContainer.innerHTML = "";
          for (const entry of oqStepRows) oqListContainer.appendChild(entry.row);
          oqRenumber();
        });

        oqListContainer.appendChild(row);
        const entry = { row, input, badge };
        oqStepRows.push(entry);
        oqUpdateRemove();
        return entry;
      };

      const currentSteps = Array.isArray((this.card).oqSteps) ? (this.card).oqSteps : [];
      const seedSteps = currentSteps.length >= 2 ? currentSteps : ["", ""];
      for (const s of seedSteps) addOqStepRow(s);
      oqRenumber();
      oqUpdateRemove();

      // Add step button
      const oqAddRow = contentEl.createDiv({ cls: "sprout-edit-mcq-add-row" });
      const oqPlusBtn = oqAddRow.createEl("button", { text: "+" });
      oqPlusBtn.type = "button";
      oqPlusBtn.onclick = () => {
        if (oqStepRows.length >= 20) { new Notice("Maximum 20 steps."); return; }
        addOqStepRow("");
        oqRenumber();
      };

      mkSectionTitle(contentEl, "Extra information");
      const infoEl = mkTextarea(String((this.card).info || ""), 4);

      this.renderButtons(type, titleEl, {
        qEl,
        aEl: null,
        clozeEl: null,
        infoEl,
        getMcq: () => null,
        getOqSteps: () => oqStepRows.map((r) => (r.input.value || "").trim()).filter(Boolean),
      });

      return;
    }

    // MCQ
    mkSectionTitle(contentEl, "Question");
    mcqStemEl = mkTextarea(String((this.card).stem || ""), 4);

    mkSectionTitle(contentEl, "Options");

    // Seed options + correct
    const currentOpts: string[] = normalizeCardOptions((this.card).options);
    const currentCorrect = Number.isFinite((this.card).correctIndex)
      ? Number((this.card).correctIndex)
      : -1;

    // default to at least 2 options if none
    const seedOpts = currentOpts.length ? currentOpts : ["", ""];
    seedOpts.forEach((opt, i) => addMcqOptionRow(opt, i === currentCorrect));
    correctIndex = currentCorrect;

    // + button row
    const addRow = contentEl.createDiv({ cls: "sprout-edit-mcq-add-row" });

    const plusBtn = addRow.createEl("button", { text: "+" });
    plusBtn.type = "button";
    plusBtn.onclick = () => addMcqOptionRow("", false);

    mkSectionTitle(contentEl, "Extra information");
    const infoEl = mkTextarea(String((this.card).info || ""), 4);

    this.renderButtons(type, titleEl, {
      qEl: null,
      aEl: null,
      clozeEl: null,
      infoEl,
      getMcq: () => {
        const options = optionRows.map((r) => (r.input.value || "").trim()).filter(Boolean);

        const rowCorrect = optionRows.findIndex((r) => r.radio.checked);
        const finalCorrect = rowCorrect >= 0 ? rowCorrect : -1;

        return {
          stem: mcqStemEl?.value ?? "",
          options,
          correctIndex: finalCorrect,
        };
      },
    });
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderButtons(
    type: string,
    titleEl: HTMLInputElement,
    args: {
      qEl: HTMLTextAreaElement | null;
      aEl: HTMLTextAreaElement | null;
      clozeEl: HTMLTextAreaElement | null;
      infoEl: HTMLTextAreaElement;
      getMcq: () =>
        | {
            stem: string;
            options: string[];
            correctIndex: number;
          }
        | null;
      getOqSteps?: () => string[];
    },
  ) {
    const { contentEl } = this;

    const footer = contentEl.createDiv({ cls: "bc flex items-center justify-end gap-4 sprout-modal-footer" });

    const cancel = footer.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
    cancel.type = "button";
    const cancelIcon = cancel.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(cancelIcon, "x");
    cancel.createSpan({ text: "Cancel" });
    cancel.onclick = () => this.close();

    const save = footer.createEl("button", { cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm" });
    save.type = "button";
    const saveIcon = save.createEl("span", { cls: "bc inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(saveIcon, "save");
    save.createSpan({ text: "Save" });
    save.onclick = async () => {
      try {
        const payload: CardEditPayload = {
          title: titleEl.value ?? "",
          info: args.infoEl.value ?? "",
        };

        if (type === "basic" || type === "reversed") {
          payload.q = args.qEl?.value ?? "";
          payload.a = args.aEl?.value ?? "";
        } else if (type === "cloze") {
          payload.clozeText = args.clozeEl?.value ?? "";
        } else if (type === "mcq") {
          const m = args.getMcq();
          payload.stem = m?.stem ?? "";
          payload.options = m?.options ?? [];
          payload.correctIndex = m?.correctIndex ?? -1;
        } else if (type === "oq") {
          payload.q = args.qEl?.value ?? "";
          payload.oqSteps = args.getOqSteps?.() ?? [];
        }

        await this.onSave(payload);
        this.close();
      } catch (e: unknown) {
        log.error("edit failed", e);
        new Notice(`Edit failed (${e instanceof Error ? e.message : String(e)})`);
      }
    };
  }
}


export async function saveCardEdits(
  plugin: SproutPlugin,
  card: CardRecord,
  payload: CardEditPayload,
): Promise<void> {
  const id = String((card).id || "");
  const path = String((card).sourceNotePath || "");
  const type = String((card).type || "basic");

  if (!id || !path) throw new Error("Missing card id or sourceNotePath.");

  const af = plugin.app.vault.getAbstractFileByPath(path);
  if (!(af instanceof TFile)) throw new Error(`Note not found: ${path}`);

  const txt = await plugin.app.vault.read(af);
  const lines = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const { start, end } = findCardBlockRangeById(lines, id);
  let block = lines.slice(start, end);

  // Ensure we have an anchor line at/near the start; if not, do nothing risky.
  if (
    !block.some((l) => (l || "").trim() === `^sprout-${id}`) &&
    !block.some((l) => (l || "").trim() === `<!--ID:${id}-->`)
  ) {
    throw new Error(
      `Block found for ${id} does not contain anchor/comment marker; aborting.`,
    );
  }

  const norm = (v: string | undefined) => String(v ?? "").trim();

  // Apply canonical fields, per card type
  block = setTaggedSection(block, ["T", "Title"], norm(payload.title));
  block = setTaggedSection(block, ["I", "Info"], norm(payload.info));

  if (type === "basic" || type === "reversed") {
    block = setTaggedSection(block, [type === "reversed" ? "RQ" : "Q", "Question"], norm(payload.q));
    block = setTaggedSection(block, ["A", "Answer"], norm(payload.a));
  } else if (type === "cloze") {
    block = setTaggedSection(block, ["CQ", "Cloze", "C"], norm(payload.clozeText));
  } else if (type === "mcq") {
    block = setTaggedSection(block, ["MCQ"], norm(payload.stem));

    const opts = Array.isArray(payload.options) ? payload.options : [];
    const correctIndex = Number.isFinite(payload.correctIndex)
      ? Number(payload.correctIndex)
      : -1;

    // Replace all existing O lines with new format
    // First, remove all existing O/Options lines
    block = block.filter((line) => {
      const trimmed = line.trim();
      return !(/^O\s*\|/.test(trimmed) || /^O:/.test(trimmed) || /^Options\s*\|/.test(trimmed) || /^Options:/.test(trimmed));
    });

    // Then insert new O | option | lines after MCQ line
    if (opts.length > 0) {
      let mcqIdx = -1;
      for (let i = 0; i < block.length; i++) {
        if (/^MCQ\s*\|/.test(block[i]) || /^MCQ:/.test(block[i])) {
          mcqIdx = i;
          break;
        }
      }

      // Find end of MCQ field (including continuation lines)
      let insertIdx = mcqIdx + 1;
      if (mcqIdx >= 0) {
        while (insertIdx < block.length) {
          const t = block[insertIdx].trim();
          if (isFieldStart(t) || isMarkerLine(t)) break;
          insertIdx++;
        }
      } else {
        // MCQ not found, insert after markers
        insertIdx = 0;
        while (insertIdx < block.length && isMarkerLine(block[insertIdx].trim())) {
          insertIdx++;
        }
      }

      // Insert O | option | lines
      const oLines = opts.map((opt, idx) => {
        const content = idx === correctIndex ? opt : opt;
        return `O | ${content} |`;
      });
      
      // Insert A | correctOption | after O lines
      if (correctIndex >= 0 && correctIndex < opts.length) {
        oLines.push(`A | ${opts[correctIndex]} |`);
      }

      block = [...block.slice(0, insertIdx), ...oLines, ...block.slice(insertIdx)];
    }
  } else if (type === "oq") {
    block = setTaggedSection(block, ["OQ"], norm(payload.q));

    const steps = Array.isArray(payload.oqSteps) ? payload.oqSteps : [];

    // Remove all existing numbered step lines (1-20)
    block = block.filter((line) => {
      const trimmed = line.trim();
      return !/^\d{1,2}\s*\|/.test(trimmed);
    });

    // Insert new numbered step lines after OQ field
    if (steps.length > 0) {
      let oqIdx = -1;
      for (let i = 0; i < block.length; i++) {
        if (/^OQ\s*\|/.test(block[i])) {
          oqIdx = i;
          break;
        }
      }

      let insertIdx = oqIdx + 1;
      if (oqIdx >= 0) {
        while (insertIdx < block.length) {
          const t = block[insertIdx].trim();
          if (isFieldStart(t) || isMarkerLine(t)) break;
          insertIdx++;
        }
      } else {
        insertIdx = 0;
        while (insertIdx < block.length && isMarkerLine(block[insertIdx].trim())) {
          insertIdx++;
        }
      }

      const stepLines = steps.map((step, idx) => `${idx + 1} | ${step} |`);
      block = [...block.slice(0, insertIdx), ...stepLines, ...block.slice(insertIdx)];
    }
  }

  const outLines = [...lines.slice(0, start), ...block, ...lines.slice(end)];
  const out = outLines.join("\n");

  await plugin.app.vault.modify(af, out);

  // Resync that note so store + rendered card reflect changes
  const res = await syncOneFile(plugin, af);
  new Notice(
    `Synced after edit — ${res.newCount} new; ${res.updatedCount} updated; ${res.sameCount} unchanged; ${res.idsInserted} IDs inserted.`,
  );
}
