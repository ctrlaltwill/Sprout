/**
 * @file src/modals/bulk-edit.ts
 * @summary Full-screen "Edit flashcard" modal used by the Reviewer, Reading, and Widget views.
 * Extends Obsidian's Modal class for consistent lifecycle, z-index, and paint behaviour.
 * Supports single-card editing for basic, reversed, cloze, MCQ, and OQ types with read-only
 * metadata fields and editable content fields including a dynamic MCQ options list, OQ step
 * reordering, and group tag-picker.
 *
 * @exports
 *  - BulkEditCardModal — Obsidian Modal subclass for editing card records
 *  - openBulkEditModalForCards — convenience wrapper that creates and opens BulkEditCardModal
 */

import { Modal, Notice, setIcon, type App } from "obsidian";

import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import { normalizeCardOptions, getCorrectIndices } from "../core/store";
import {
  buildAnswerOrOptionsFor,
  escapePipes,
  parseMcqOptionsFromCell,
} from "../reviewer/fields";
import { stageLabel } from "../reviewer/labels";
import { createGroupPickerField as createGroupPickerFieldImpl } from "../card-editor/card-editor";

import {
  typeLabelBrowser,
  fmtDue,
  fmtLocation,
  parseGroupsInput,
  createThemedDropdown,
  setModalTitle,
  scopeModalToWorkspace,
} from "./modal-utils";
import { coerceGroups } from "../indexes/group-format";

type GroupPickerFieldFactory = (
  initialValue: string,
  cardsCount: number,
  plugin: SproutPlugin,
) => { element: HTMLElement; hiddenInput: HTMLInputElement };

const CLOZE_TOOLTIP =
  "Use cloze syntax to hide text in your prompt.\n{{c1::text}} creates the first blank.\nUse {{c2::text}} for a different blank, or reuse {{c1::text}} to reveal together.\nShortcuts: Cmd/Ctrl+Shift+C (new blank), Cmd/Ctrl+Shift+Alt/Option+C (same blank number).";
const MCQ_TOOLTIP = "Check the box next to each correct answer. At least one correct and one incorrect option required.";
const OQ_TOOLTIP =
  "Write the steps in the correct order.\nYou must have at least 2 steps.\nDrag the grip handles to reorder steps.\nSteps are shuffled during review.";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (private to this module)
// ──────────────────────────────────────────────────────────────────────────────

/** Convert a groups value (string | string[] | null) to a display string. */
function formatGroupsForInput(groups: string[]): string {
  if (!groups || !groups.length) return "";
  return groups.join(" / ");
}

type EditableField = "title" | "question" | "answer" | "info" | "groups";

function getSharedEditableFieldValue(cards: CardRecord[], field: EditableField): string {
  const cardsForField = cards.filter((card) => {
    if (field === "answer") return String(card.type ?? "").toLowerCase() !== "cloze";
    return true;
  });
  if (!cardsForField.length) return "";

  const values = cardsForField.map((card) => {
    if (field === "title") return String(card.title || "");
    if (field === "question") {
      if (card.type === "basic" || card.type === "reversed") return String(card.q || "");
      if (card.type === "mcq") return String(card.stem || "");
      if (card.type === "oq") return String(card.q || "");
      if (card.type === "cloze") return String(card.clozeText || "");
    }
    if (field === "answer") {
      if (card.type === "basic" || card.type === "reversed") return String(card.a || "");
      if (card.type === "mcq") return buildAnswerOrOptionsFor(card);
    }
    if (field === "info") return String(card.info || "");
    if (field === "groups") return formatGroupsForInput(coerceGroups(card.groups));
    return "";
  });

  const firstValue = values[0];
  return values.every((value) => value === firstValue) ? firstValue : "";
}

// ──────────────────────────────────────────────────────────────────────────────
// BulkEditCardModal
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Obsidian Modal subclass for editing one or more card records in review mode.
 * Supports basic, reversed, cloze, MCQ, and OQ cards. IO cards are excluded.
 */
export class BulkEditCardModal extends Modal {
  private plugin: SproutPlugin;
  private cards: CardRecord[];
  private onSaveCallback: (updatedCards: CardRecord[]) => Promise<void>;

  constructor(app: App, plugin: SproutPlugin, cards: CardRecord[], onSave: (updatedCards: CardRecord[]) => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.cards = cards.filter((c) => !["io", "io-child"].includes(String(c.type || "")));
    this.onSaveCallback = onSave;
  }

  onOpen() {
    const { plugin, cards, onSaveCallback: onSave } = this;
    if (!cards.length) { this.close(); return; }

    // ── Modal chrome ──────────────────────────────────────────────────────
    setModalTitle(this, "Edit flashcard");

    // Apply all CSS classes and z-index BEFORE scoping to workspace.
    // scopeModalToWorkspace forces a repaint, which only works if the
    // positioning CSS (position:absolute, z-index, etc.) is already active.
    this.containerEl.addClass("sprout-modal-container", "sprout-modal-dim", "sprout");
    this.containerEl.style.setProperty("z-index", "2147483000", "important");
    this.modalEl.addClass("bc", "sprout-modals", "sprout-bulk-edit-panel");
    this.modalEl.style.setProperty("z-index", "2147483001", "important");
    scopeModalToWorkspace(this);
    this.contentEl.addClass("bc", "sprout-bulk-edit-content");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

  // ── Form body ─────────────────────────────────────────────────────────────
  const form = document.createElement("div");
  form.className = "bc flex flex-col gap-4";

  const normalizedTypes = cards.map((c) => String(c?.type ?? "").toLowerCase());
  const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
  const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");
  const isSingleMcq = cards.length === 1 && normalizedTypes[0] === "mcq";
  const isSingleOq = cards.length === 1 && normalizedTypes[0] === "oq";

  // Map of input elements by field key
  const inputEls: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};

  /** Creates a label + textarea pair for an editable field. */
  const createEditableTextareaField = (label: string, field: "title" | "question" | "answer" | "info") => {
    const wrapper = document.createElement("div");
    wrapper.className = "bc flex flex-col gap-1";

    const labelEl = document.createElement("label");
    labelEl.className = "bc text-sm font-medium";
    labelEl.textContent = label;
    if (field === "question" && isClozeOnly) {
      labelEl.className = "bc text-sm font-medium inline-flex items-center gap-1";
      const infoIcon = document.createElement("span");
      infoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
      infoIcon.setAttribute("data-tooltip", CLOZE_TOOLTIP);
      infoIcon.setAttribute("data-tooltip-position", "top");
      setIcon(infoIcon, "info");
      labelEl.appendChild(infoIcon);
    }
    wrapper.appendChild(labelEl);

    const textarea = document.createElement("textarea");
    textarea.className = "bc textarea w-full sprout-textarea-fixed";
    textarea.rows = 3;
    textarea.value = getSharedEditableFieldValue(cards, field);
    wrapper.appendChild(textarea);
    inputEls[field] = textarea;

    return wrapper;
  };

  /** Creates a label + disabled input pair for a read-only field. */
  const createReadonlyField = (label: string, value: string) => {
    const wrapper = document.createElement("div");
    wrapper.className = "bc flex flex-col gap-1";

    const labelEl = document.createElement("label");
    labelEl.className = "bc text-sm font-medium";
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "bc input w-full";
    input.value = value;
    input.disabled = true;
    wrapper.appendChild(input);

    return wrapper;
  };

  // ── Top metadata grid (read-only) ───────────────────────────────────────
  const topGrid = document.createElement("div");
  topGrid.className = "bc grid grid-cols-1 gap-3 md:grid-cols-2";

  const card0 = cards[0];
  const state0 = plugin.store.getState(card0.id);

  topGrid.appendChild(createReadonlyField("ID", card0.id));

  // For basic/reversed cards, allow toggling between the two types
  const isBasicOrReversed = card0.type === "basic" || card0.type === "reversed";
  let selectedType: string = card0.type;

  if (isBasicOrReversed) {
    const typeWrapper = document.createElement("div");
    typeWrapper.className = "bc flex flex-col gap-1";

    const typeLabelEl = document.createElement("label");
    typeLabelEl.className = "bc text-sm font-medium";
    typeLabelEl.textContent = "Type";
    typeWrapper.appendChild(typeLabelEl);

    const typeDropdown = createThemedDropdown(
      [
        { value: "basic", label: "Basic" },
        { value: "reversed", label: "Basic (Reversed)" },
      ],
      card0.type,
      undefined,
      {
        fullWidth: false,
        buttonSize: "sm",
        buttonJustify: "start",
        buttonClassName: "cursor-pointer",
      },
    );
    typeDropdown.onChange((value) => { selectedType = value; });
    typeWrapper.appendChild(typeDropdown.element);
    topGrid.appendChild(typeWrapper);
  } else {
    topGrid.appendChild(createReadonlyField("Type", typeLabelBrowser(card0.type)));
  }

  topGrid.appendChild(createReadonlyField("Stage", stageLabel(String(state0?.stage || "new"))));
  topGrid.appendChild(
    createReadonlyField("Due", state0 && Number.isFinite(state0.due) ? fmtDue(state0.due) : "—"),
  );

  form.appendChild(topGrid);

  // ── Editable fields ───────────────────────────────────────────────────────
  form.appendChild(createEditableTextareaField("Title", "title"));
  form.appendChild(createEditableTextareaField("Question", "question"));

  // Answer field (only for non-cloze, skip for MCQ/OQ which have their own editors)
  if (hasNonCloze && !isSingleMcq && !isSingleOq) {
    form.appendChild(createEditableTextareaField("Answer", "answer"));
  }

  // ── MCQ-specific editor ─────────────────────────────────────────────────
  let mcqSection: HTMLElement | null = null;
  type McqOptionRowEntry = { row: HTMLElement; input: HTMLInputElement; checkbox: HTMLInputElement; removeBtn: HTMLButtonElement };
  const mcqOptionRows: McqOptionRowEntry[] = [];
  if (isSingleMcq) {
    const mcqCard = cards[0];
    const options = normalizeCardOptions(mcqCard.options);
    const correctIdxSet = new Set(getCorrectIndices(mcqCard));

    mcqSection = document.createElement("div");
    mcqSection.className = "bc flex flex-col gap-1";

    const mcqLabel = document.createElement("label");
    mcqLabel.className = "bc text-sm font-medium inline-flex items-center gap-1";
    mcqLabel.textContent = "Answers and options";
    const mcqInfoIcon = document.createElement("span");
    mcqInfoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
    mcqInfoIcon.setAttribute("data-tooltip", MCQ_TOOLTIP);
    mcqInfoIcon.setAttribute("data-tooltip-position", "top");
    setIcon(mcqInfoIcon, "info");
    mcqLabel.appendChild(mcqInfoIcon);
    mcqSection.appendChild(mcqLabel);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "bc flex flex-col gap-2";
    mcqSection.appendChild(optionsContainer);

    const updateRemoveButtons = () => {
      const disable = mcqOptionRows.length <= 2;
      for (const entry of mcqOptionRows) {
        entry.removeBtn.disabled = disable;
        entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
        entry.removeBtn.classList.toggle("is-disabled", disable);
      }
    };

    const addOptionRow = (value: string, isCorrect: boolean) => {
      const row = document.createElement("div");
      row.className = "bc flex items-center gap-2 sprout-edit-mcq-option-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isCorrect;
      checkbox.className = "bc sprout-mcq-correct-checkbox";
      checkbox.setAttribute("data-tooltip", "Mark as correct answer");
      checkbox.setAttribute("data-tooltip-position", "top");
      row.appendChild(checkbox);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "bc input flex-1 text-sm sprout-input-fixed";
      input.placeholder = "Enter an answer option";
      input.value = value;
      row.appendChild(input);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "bc inline-flex items-center justify-center h-9 w-9 p-0 sprout-remove-btn-ghost";
      removeBtn.setAttribute("data-tooltip", "Remove option");
      removeBtn.setAttribute("data-tooltip-position", "top");
      const xIcon = document.createElement("span");
      xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(xIcon, "x");
      removeBtn.appendChild(xIcon);
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (mcqOptionRows.length <= 2) return;
        const idx = mcqOptionRows.findIndex((entry) => entry.input === input);
        if (idx === -1) return;
        mcqOptionRows[idx].row.remove();
        mcqOptionRows.splice(idx, 1);
        updateRemoveButtons();
      });
      row.appendChild(removeBtn);

      optionsContainer.appendChild(row);
      mcqOptionRows.push({ row, input, checkbox, removeBtn });
      updateRemoveButtons();
    };

    // Seed with existing options
    for (let i = 0; i < options.length; i++) {
      addOptionRow(options[i] || "", correctIdxSet.has(i));
    }
    // Ensure at least 2 rows
    if (options.length < 2) {
      const seeded = options.length;
      if (seeded === 0) { addOptionRow("", true); addOptionRow("", false); }
      else if (seeded === 1) { addOptionRow("", !correctIdxSet.has(0)); }
    }

    // "Add another option" input
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "bc input flex-1 text-sm sprout-input-fixed";
    addInput.placeholder = "Add another option (press enter)";
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        const value = addInput.value.trim();
        if (!value) return;
        addOptionRow(value, false);
        addInput.value = "";
      }
    });
    addInput.addEventListener("blur", () => {
      const value = addInput.value.trim();
      if (!value) return;
      addOptionRow(value, false);
      addInput.value = "";
    });
    const addInputWrap = document.createElement("div");
    addInputWrap.className = "bc flex items-center gap-2";
    addInputWrap.appendChild(addInput);
    mcqSection.appendChild(addInputWrap);

    form.appendChild(mcqSection);
  }

  // ── OQ-specific editor (reorderable steps) ──────────────────────────────
  let oqListContainer: HTMLElement | null = null;
  const oqStepRows: Array<{ row: HTMLElement; input: HTMLInputElement; badge: HTMLElement }> = [];
  if (isSingleOq) {
    const oqCard = cards[0];
    const initialSteps = Array.isArray(oqCard.oqSteps) ? [...oqCard.oqSteps] : ["" , ""];

    const oqSection = document.createElement("div");
    oqSection.className = "bc flex flex-col gap-1";

    const oqLabel = document.createElement("label");
    oqLabel.className = "bc text-sm font-medium inline-flex items-center gap-1";
    oqLabel.textContent = "Steps (correct order)";
    oqLabel.appendChild(Object.assign(document.createElement("span"), { className: "bc text-destructive", textContent: "*" }));
    const oqInfoIcon = document.createElement("span");
    oqInfoIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-info-icon-elevated";
    oqInfoIcon.setAttribute("data-tooltip", OQ_TOOLTIP);
    oqInfoIcon.setAttribute("data-tooltip-position", "top");
    setIcon(oqInfoIcon, "info");
    oqLabel.appendChild(oqInfoIcon);
    oqSection.appendChild(oqLabel);

    const oqHint = document.createElement("div");
    oqHint.className = "bc text-xs text-muted-foreground";
    oqHint.textContent = "Enter the steps in their correct order. Drag the grip handles to reorder. Steps are shuffled during review.";
    oqSection.appendChild(oqHint);

    oqListContainer = document.createElement("div");
    oqListContainer.className = "bc flex flex-col gap-2 sprout-oq-editor-list";
    oqSection.appendChild(oqListContainer);

    const renumberOq = () => {
      oqStepRows.forEach((entry, i) => {
        entry.badge.textContent = String(i + 1);
      });
    };

    const updateOqRemoveButtons = () => {
      const disable = oqStepRows.length <= 2;
      for (const entry of oqStepRows) {
        const delBtn = entry.row.querySelector<HTMLButtonElement>(".sprout-oq-del-btn");
        if (delBtn) {
          delBtn.disabled = disable;
          delBtn.setAttribute("aria-disabled", disable ? "true" : "false");
          delBtn.classList.toggle("is-disabled", disable);
        }
      }
    };

    const addOqStepRow = (value: string) => {
      const idx = oqStepRows.length;

      const row = document.createElement("div");
      row.className = "bc flex items-center gap-2 sprout-oq-editor-row";
      row.draggable = true;

      // Drag grip
      const grip = document.createElement("span");
      grip.className = "bc inline-flex items-center justify-center text-muted-foreground cursor-grab sprout-oq-grip";
      setIcon(grip, "grip-vertical");
      row.appendChild(grip);

      // Number badge
      const badge = document.createElement("span");
      badge.className = "bc inline-flex items-center justify-center text-xs font-medium text-muted-foreground w-5 h-9 leading-none shrink-0";
      badge.textContent = String(idx + 1);
      row.appendChild(badge);

      // Text input
      const input = document.createElement("input");
      input.type = "text";
      input.className = "bc input flex-1 text-sm sprout-input-fixed";
      input.placeholder = `Step ${idx + 1}`;
      input.value = value;
      row.appendChild(input);

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "bc inline-flex items-center justify-center p-0 sprout-remove-btn-ghost sprout-oq-del-btn";
      delBtn.setAttribute("data-tooltip", "Remove step");
      delBtn.setAttribute("data-tooltip-position", "top");
      const xIcon = document.createElement("span");
      xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(xIcon, "x");
      delBtn.appendChild(xIcon);
      delBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (oqStepRows.length <= 2) return;
        const pos = oqStepRows.findIndex((e) => e.input === input);
        if (pos < 0) return;
        oqStepRows[pos].row.remove();
        oqStepRows.splice(pos, 1);
        renumberOq();
        updateOqRemoveButtons();
      });
      row.appendChild(delBtn);

      // HTML5 DnD for reordering
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer?.setData("text/plain", String(oqStepRows.findIndex((e) => e.row === row)));
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
        const fromStr = ev.dataTransfer?.getData("text/plain");
        if (fromStr === undefined || fromStr === null) return;
        const fromIdx = parseInt(fromStr, 10);
        const toIdx = oqStepRows.findIndex((e) => e.row === row);
        if (isNaN(fromIdx) || fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const [moved] = oqStepRows.splice(fromIdx, 1);
        oqStepRows.splice(toIdx, 0, moved);
        oqListContainer!.innerHTML = "";
        for (const entry of oqStepRows) oqListContainer!.appendChild(entry.row);
        renumberOq();
      });

      oqListContainer!.appendChild(row);
      oqStepRows.push({ row, input, badge });
      updateOqRemoveButtons();
    };

    const seed = initialSteps.length >= 2 ? initialSteps : ["", ""];
    for (const s of seed) addOqStepRow(s);
    renumberOq();
    updateOqRemoveButtons();

    // "Add step" input
    const addOqRow = document.createElement("div");
    addOqRow.className = "bc flex items-center gap-2";
    const addOqInput = document.createElement("input");
    addOqInput.type = "text";
    addOqInput.className = "bc input flex-1 text-sm sprout-input-fixed";
    addOqInput.placeholder = "Add another step (press enter)";
    addOqInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        const val = addOqInput.value.trim();
        if (!val) return;
        if (oqStepRows.length >= 20) { new Notice("Maximum 20 steps."); return; }
        addOqStepRow(val);
        renumberOq();
        addOqInput.value = "";
      }
    });
    addOqInput.addEventListener("blur", () => {
      const val = addOqInput.value.trim();
      if (!val) return;
      if (oqStepRows.length >= 20) return;
      addOqStepRow(val);
      renumberOq();
      addOqInput.value = "";
    });
    addOqRow.appendChild(addOqInput);
    oqSection.appendChild(addOqRow);

    form.appendChild(oqSection);
  }

  // Extra information
  form.appendChild(createEditableTextareaField("Extra information", "info"));

  // ── Groups field (Basecoat tag picker) ────────────────────────────────────
  const groupsWrapper = document.createElement("div");
  groupsWrapper.className = "bc flex flex-col gap-1";

  const groupsLabel = document.createElement("label");
  groupsLabel.className = "bc text-sm font-medium";
  groupsLabel.textContent = "Groups";
  groupsWrapper.appendChild(groupsLabel);

  const createGroupPickerField = createGroupPickerFieldImpl as GroupPickerFieldFactory;
  const groupField = createGroupPickerField(getSharedEditableFieldValue(cards, "groups"), cards.length, plugin);
  groupsWrapper.appendChild(groupField.element);
  groupsWrapper.appendChild(groupField.hiddenInput);
  inputEls["groups"] = groupField.hiddenInput;

  form.appendChild(groupsWrapper);

  // Location (read-only)
  form.appendChild(createReadonlyField("Location", fmtLocation(card0.sourceNotePath)));

  contentEl.appendChild(form);

  // ── Footer buttons ────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "bc flex items-center justify-end gap-4 sprout-modal-footer";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm";
  const cancelIcon = document.createElement("span");
  cancelIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(cancelIcon, "x");
  const cancelText = document.createElement("span");
  cancelText.textContent = "Cancel";
  cancel.appendChild(cancelIcon);
  cancel.appendChild(cancelText);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm";
  const saveIcon = document.createElement("span");
  saveIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(saveIcon, "check");
  const saveText = document.createElement("span");
  saveText.textContent = "Save";
  save.appendChild(saveIcon);
  save.appendChild(saveText);

  footer.appendChild(cancel);
  footer.appendChild(save);
  contentEl.appendChild(footer);

  cancel.addEventListener("click", () => this.close());

  // ── Save handler ──────────────────────────────────────────────────────────
  save.addEventListener("click", () => { void (async () => {
    const updates: Partial<Record<string, string>> = {};

    // Collect editable field values
    for (const field of ["title", "question", "answer", "info", "groups"] as const) {
      const el = inputEls[field];
      if (!el) continue;
      const val = String(el.value ?? "").trim();

      // Optional fields should be cleared when empty
      if (field === "info" || field === "groups") {
        updates[field] = val;
        continue;
      }

      if (val) updates[field] = val;
    }

    // Handle MCQ if single MCQ selected
    if (isSingleMcq) {
      const allOpts = mcqOptionRows
        .map((entry) => ({ text: String(entry.input.value || "").trim(), isCorrect: entry.checkbox.checked }))
        .filter((opt) => opt.text.length > 0);
      const corrects = allOpts.filter((o) => o.isCorrect).map((o) => o.text);
      const wrongs = allOpts.filter((o) => !o.isCorrect).map((o) => o.text);

      if (corrects.length < 1) {
        new Notice("At least one correct answer is required.");
        return;
      }
      if (wrongs.length < 1) {
        new Notice("Multiple-choice cards require at least one wrong option.");
        return;
      }

      // Reconstruct legacy pipe-format answer string (bold = correct)
      const rendered = allOpts.map((opt) =>
        opt.isCorrect ? `**${escapePipes(opt.text)}**` : escapePipes(opt.text),
      );
      updates.answer = rendered.join(" | ");
    }

    // Handle OQ if single OQ selected
    let oqStepsResult: string[] | null = null;
    if (isSingleOq) {
      const steps = oqStepRows.map((e) => String(e.input.value || "").trim()).filter(Boolean);
      if (steps.length < 2) {
        new Notice("Ordering requires at least 2 steps.");
        return;
      }
      if (steps.length > 20) {
        new Notice("Ordering supports a maximum of 20 steps.");
        return;
      }
      oqStepsResult = steps;
    }

    if (!Object.keys(updates).length && !oqStepsResult && !(isBasicOrReversed && selectedType !== card0.type)) {
      new Notice("Enter a value for at least one field.");
      return;
    }

    try {
      // Apply updates to card records
      const updatedCards: CardRecord[] = [];
      for (const card of cards) {
        const updated = JSON.parse(JSON.stringify(card)) as CardRecord;

        // Apply type change (only basic ↔ reversed)
        if (isBasicOrReversed && selectedType !== updated.type) {
          (updated as Record<string, unknown>).type = selectedType;
        }

        if (updates.title !== undefined) updated.title = updates.title;

        if (updates.question !== undefined) {
          if (updated.type === "basic" || updated.type === "reversed") updated.q = updates.question;
          else if (updated.type === "mcq") updated.stem = updates.question;
          else if (updated.type === "oq") updated.q = updates.question;
          else if (updated.type === "cloze") updated.clozeText = updates.question;
        }

        if (oqStepsResult && updated.type === "oq") {
          updated.oqSteps = oqStepsResult;
        }

        if (updates.answer !== undefined) {
          if (updated.type === "basic" || updated.type === "reversed") {
            updated.a = updates.answer;
          } else if (updated.type === "mcq") {
            const parsed = parseMcqOptionsFromCell(updates.answer);
            updated.options = parsed.options;
            updated.correctIndex = parsed.correctIndex;
          }
        }

        if (updates.info !== undefined) updated.info = updates.info || null;

        if (updates.groups !== undefined) {
          const groups = parseGroupsInput(updates.groups);
          updated.groups = groups.length ? groups : null;
        }

        updatedCards.push(updated);
      }

      await onSave(updatedCards);
      this.close();
    } catch (err: unknown) {
      new Notice(`${err instanceof Error ? err.message : String(err)}`);
    }
  })(); });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Convenience wrapper ────────────────────────────────────

/**
 * Creates and opens a BulkEditCardModal for the given cards.
 * Drop-in replacement for the old function-based overlay.
 */
export function openBulkEditModalForCards(
  plugin: SproutPlugin,
  cards: CardRecord[],
  onSave: (updatedCards: CardRecord[]) => Promise<void>,
) {
  if (!cards.length) return;
  const filtered = cards.filter((c) => !["io", "io-child"].includes(String(c.type || "")));
  if (!filtered.length) return;
  new BulkEditCardModal(plugin.app, plugin, filtered, onSave).open();
}
