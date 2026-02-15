/**
 * @file src/modals/bulk-edit.ts
 * @summary Full-screen "Edit flashcard" overlay used by the Card Browser and Reviewer views. Unlike the other modals (which extend Obsidian's Modal class), this builds a manual overlay appended to document.body so it can sit above Obsidian's own modal z-index. Supports single-card editing for basic, cloze, and MCQ types with read-only metadata fields and editable content fields including a dynamic MCQ options list and group tag-picker.
 *
 * @exports
 *  - openBulkEditModalForCards — opens the bulk-edit overlay for one or more card records, returning a promise that resolves when the user saves or cancels
 */

import { Notice, setIcon } from "obsidian";
import { log } from "../core/logger";
import { setCssProps } from "../core/ui";
import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
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
} from "./modal-utils";

const CLOZE_TOOLTIP =
  "Use cloze syntax to hide text in your prompt.\n{{c1::text}} creates the first blank.\nUse {{c2::text}} for a different blank, or reuse {{c1::text}} to reveal together.\nShortcuts: Cmd/Ctrl+Shift+C (new blank), Cmd/Ctrl+Shift+Alt/Option+C (same blank number).";
const MCQ_TOOLTIP = "Check the box next to each correct answer. At least one correct and one incorrect option required.";
const OQ_TOOLTIP =
  "Write the steps in the correct order.\nYou must have at least 2 steps.\nDrag the grip handles to reorder steps.\nSteps are shuffled during review.";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (private to this module)
// ──────────────────────────────────────────────────────────────────────────────

/** Convert a groups value (string | string[] | null) to a display string. */
function groupsToInputString(groups: string[]): string {
  if (!groups || !groups.length) return "";
  return groups.join(" / ");
}

/** Coerce an arbitrary groups value into a string array. */
function coerceGroups(g: unknown): string[] {
  if (!g) return [];
  if (Array.isArray(g)) return g.map((x: unknown) => String(x)).filter(Boolean);
  if (typeof g === "string") {
    return g
      .split(/,/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof g === "number" || typeof g === "boolean") {
    return String(g)
      .split(/,/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────────────────
// openBulkEditModalForCards
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Opens a bulk edit modal for a single card (or multiple cards) in review mode.
 * Focuses on basic, cloze, and MCQ cards. IO cards are excluded.
 */
export function openBulkEditModalForCards(
  plugin: SproutPlugin,
  cards: CardRecord[],
  onSave: (updatedCards: CardRecord[]) => Promise<void>,
) {
  if (!cards.length) return;

  // Filter out IO cards and their children
  cards = cards.filter((c) => !["io", "io-child"].includes(String(c.type || "")));
  if (!cards.length) return;

  // Container — matches Obsidian's native Modal DOM structure:
  //   div.modal-container  >  div.modal-bg  +  div.modal
  const container = document.createElement("div");
  container.className = "modal-container sprout-modal-container sprout-modal-dim sprout mod-dim";
  setCssProps(container, "z-index", "2147483000");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-bg";
  container.appendChild(backdrop);

  // ── Panel container ─────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "modal bc sprout-modals sprout-bulk-edit-panel";
  setCssProps(panel, "z-index", "2147483001");
  container.appendChild(panel);

  // ── Close button (matches Obsidian modal-close-button) ──────────────────
  const close = document.createElement("div");
  close.className = "modal-close-button mod-raised clickable-icon";
  close.setAttribute("data-tooltip", "Close");
  close.setAttribute("data-tooltip-position", "top");
  setIcon(close, "x");
  panel.appendChild(close);

  // ── Header (matches Obsidian modal-header) ──────────────────────────────
  const header = document.createElement("div");
  header.className = "modal-header";
  const heading = document.createElement("div");
  heading.className = "modal-title";
  heading.textContent = "Edit flashcard";
  header.appendChild(heading);
  panel.appendChild(header);

  // ── Content wrapper (matches Obsidian modal-content) ────────────────────
  const contentWrap = document.createElement("div");
  contentWrap.className = "modal-content bc sprout-bulk-edit-content";
  panel.appendChild(contentWrap);

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
  let wrongContainer: HTMLElement | null = null;

  /**
   * Determines the shared value for a field across all selected cards.
   * If all cards have the same value it's returned; otherwise returns "".
   */
  const sharedValue = (field: "title" | "question" | "answer" | "info" | "groups") => {
    const filtered = cards.filter((c) => {
      if (field === "answer") return String(c.type ?? "").toLowerCase() !== "cloze";
      return true;
    });
    if (!filtered.length) return "";

    const vals = filtered.map((card) => {
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
      if (field === "groups") return groupsToInputString(coerceGroups(card.groups));
      return "";
    });

    const first = vals[0];
    return vals.every((v) => v === first) ? first : "";
  };

  /** Creates a label + textarea pair for an editable field. */
  const createFieldWrapper = (label: string, field: "title" | "question" | "answer" | "info") => {
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
    textarea.value = sharedValue(field);
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
  form.appendChild(createFieldWrapper("Title", "title"));
  form.appendChild(createFieldWrapper("Question", "question"));

  // Answer field (only for non-cloze, skip for MCQ/OQ which have their own editors)
  if (hasNonCloze && !isSingleMcq && !isSingleOq) {
    form.appendChild(createFieldWrapper("Answer", "answer"));
  }

  // ── MCQ-specific editor ─────────────────────────────────────────────────
  let mcqSection: HTMLElement | null = null;
  if (isSingleMcq) {
    const mcqCard = cards[0];
    const options = Array.isArray(mcqCard.options) ? [...mcqCard.options] : [];
    const correctIndex = Number.isFinite(mcqCard.correctIndex) ? (mcqCard.correctIndex as number) : 0;
    const correctValue = options[correctIndex] ?? "";
    const wrongValues = options.filter((_, idx) => idx !== correctIndex);

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

    // Correct answer input
    const correctWrapper = document.createElement("div");
    correctWrapper.className = "bc flex flex-col gap-1";
    const correctLabelDiv = document.createElement("div");
    correctLabelDiv.className = "bc text-xs text-muted-foreground";
    correctLabelDiv.textContent = "Correct answer";
    correctWrapper.appendChild(correctLabelDiv);
    const correctInput = document.createElement("input");
    correctInput.type = "text";
    correctInput.className = "bc input w-full";
    correctInput.value = correctValue;
    correctWrapper.appendChild(correctInput);
    mcqSection.appendChild(correctWrapper);
    inputEls["mcq_correct"] = correctInput;

    // Wrong options list
    const wrongLabel = document.createElement("div");
    wrongLabel.className = "bc text-xs text-muted-foreground";
    wrongLabel.textContent = "Wrong options";
    mcqSection.appendChild(wrongLabel);

    wrongContainer = document.createElement("div");
    wrongContainer.className = "bc flex flex-col gap-2";
    mcqSection.appendChild(wrongContainer);

    const wrongRows: Array<{ input: HTMLInputElement }> = [];

    /** Disable remove buttons when only one wrong option remains. */
    const updateRemoveButtons = () => {
      const disable = wrongRows.length <= 1;
      wrongContainer!.querySelectorAll("button").forEach((btn) => {
        btn.disabled = disable;
        btn.setAttribute("aria-disabled", disable ? "true" : "false");
        btn.classList.toggle("is-disabled", disable);
      });
    };

    /** Append a new wrong-option row. */
    const addWrongRow = (value = "") => {
      const row = document.createElement("div");
      row.className = "bc flex items-center gap-2";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "bc input flex-1 text-sm sprout-input-fixed";
      input.placeholder = "Wrong option";
      input.value = value;
      row.appendChild(input);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "bc inline-flex items-center justify-center p-0 sprout-remove-btn-ghost";
      removeBtn.setAttribute("data-tooltip", "Remove option");
      removeBtn.setAttribute("data-tooltip-position", "top");
      const xIcon = document.createElement("span");
      xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-[0.8rem]";
      setIcon(xIcon, "x");
      removeBtn.appendChild(xIcon);

      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (wrongRows.length <= 1) return;
        const idx = wrongRows.findIndex((r) => r.input === input);
        if (idx === -1) return;
        wrongRows[idx].input.parentElement?.remove();
        wrongRows.splice(idx, 1);
        updateRemoveButtons();
      });
      row.appendChild(removeBtn);

      wrongContainer!.appendChild(row);
      wrongRows.push({ input });
      updateRemoveButtons();
    };

    const initialWrongs = wrongValues.length ? wrongValues : [""];
    for (const value of initialWrongs) addWrongRow(value);

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
  form.appendChild(createFieldWrapper("Extra information", "info"));

  // ── Groups field (Basecoat tag picker) ────────────────────────────────────
  const groupsWrapper = document.createElement("div");
  groupsWrapper.className = "bc flex flex-col gap-1";

  const groupsLabel = document.createElement("label");
  groupsLabel.className = "bc text-sm font-medium";
  groupsLabel.textContent = "Groups";
  groupsWrapper.appendChild(groupsLabel);

  const groupField = createGroupPickerFieldImpl(sharedValue("groups"), cards.length, plugin);
  groupsWrapper.appendChild(groupField.element);
  groupsWrapper.appendChild(groupField.hiddenInput);
  inputEls["groups"] = groupField.hiddenInput;

  form.appendChild(groupsWrapper);

  // Location (read-only)
  form.appendChild(createReadonlyField("Location", fmtLocation(card0.sourceNotePath)));

  contentWrap.appendChild(form);

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
  contentWrap.appendChild(footer);

  /** Remove the container from the DOM and clean up the Escape listener. */
  function removeOverlay() {
    document.removeEventListener("keydown", onKeyDown, true);
    try {
      container.remove();
    } catch (e) { log.swallow("remove overlay", e); }
  }

  cancel.addEventListener("click", removeOverlay);
  close.addEventListener("click", removeOverlay);

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
      const correctEl = inputEls["mcq_correct"] as HTMLInputElement;
      const correct = (correctEl?.value ?? "").trim();
      if (!correct) {
        new Notice("Correct multiple-choice answer cannot be empty.");
        return;
      }

      const wrongEls = wrongContainer?.querySelectorAll("input[type=text]") as NodeListOf<HTMLInputElement>;
      const wrongs = Array.from(wrongEls || [])
        .map((el) => el.value.trim())
        .filter((v) => v.length > 0);

      if (wrongs.length < 1) {
        new Notice("Multiple-choice cards require at least one wrong option.");
        return;
      }

      // Reconstruct legacy pipe-format answer string
      const optionsList = [correct, ...wrongs];
      const rendered = optionsList.map((opt, idx) => (idx === 0 ? `**${escapePipes(opt)}**` : escapePipes(opt)));
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
      removeOverlay();
    } catch (err: unknown) {
      new Notice(`${err instanceof Error ? err.message : String(err)}`);
    }
  })(); });

  // Click backdrop = close
  backdrop.addEventListener("click", () => removeOverlay());

  // Escape key = close
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    removeOverlay();
  };
  document.addEventListener("keydown", onKeyDown, true);

  // Scope modal to the active leaf in the main (root) workspace so the overlay
  // appears in the centre pane even when triggered from a sidebar widget.
  const rootLeaf = document.querySelector(
    ".mod-root .workspace-leaf.mod-active",
  );
  const leafContent = rootLeaf?.querySelector(".workspace-leaf-content");
  const target = leafContent || document.body;
  target.appendChild(container);
}
