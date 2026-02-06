/**
 * modals/bulk-edit.ts
 * ---------------------------------------------------------------------------
 * "Edit flashcard" overlay used in the Card Browser and Reviewer views.
 *
 * Unlike the other modals (which extend Obsidian's Modal class), this builds
 * a full-screen overlay manually and appends it to `document.body`.  This is
 * because it needs to sit above Obsidian's own modal z-index and is called
 * outside of the normal Obsidian modal lifecycle.
 *
 * Supports:
 *  - Single-card editing for basic / cloze / MCQ types
 *  - Read-only metadata fields (ID, type, stage, due, location)
 *  - Editable fields: title, question, answer, extra info, groups
 *  - MCQ-specific UI: correct answer + dynamic wrong-options list
 *  - Groups field uses the Basecoat tag-picker (createGroupPickerFieldImpl)
 * ---------------------------------------------------------------------------
 */

import { Notice, setIcon } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import type { CardRecord } from "../core/store";
import {
  buildAnswerOrOptionsFor,
  escapePipes,
  parseMcqOptionsFromCell,
} from "../reviewer/Fields";
import { stageLabel } from "../reviewer/Labels";
import { createGroupPickerField as createGroupPickerFieldImpl } from "../card-editor/card-editor";

import {
  typeLabelBrowser,
  fmtDue,
  fmtLocation,
  parseGroupsInput,
  setVisible,
} from "./modal-utils";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (private to this module)
// ──────────────────────────────────────────────────────────────────────────────

/** Convert a groups value (string | string[] | null) to a display string. */
function groupsToInputString(groups: string[]): string {
  if (!groups || !groups.length) return "";
  return groups.join(" / ");
}

/** Coerce an arbitrary groups value into a string array. */
function coerceGroups(g: any): string[] {
  if (!g) return [];
  if (Array.isArray(g)) return g.map((x) => String(x)).filter(Boolean);
  return String(g || "")
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────────────────
// openBulkEditModalForCards
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Opens a bulk edit modal for a single card (or multiple cards) in review mode.
 * Focuses on basic, cloze, and MCQ cards. IO cards are excluded.
 */
export async function openBulkEditModalForCards(
  plugin: SproutPlugin,
  cards: CardRecord[],
  onSave: (updatedCards: CardRecord[]) => Promise<void>,
) {
  if (!cards.length) return;

  // Filter out IO cards and their children
  cards = cards.filter((c) => !["io", "io-child"].includes(String(c.type || "")));
  if (!cards.length) return;

  // Always wrap overlay in a .sprout div for correct CSS scoping
  let sproutWrapper = document.createElement("div");
  sproutWrapper.className = "sprout";

  const overlay = document.createElement("div");
  overlay.className = "bc fixed inset-0 flex items-center justify-center";

  // Defensive: if overlay is ever created elsewhere, ensure only one .sprout wrapper
  if (overlay.parentElement && overlay.parentElement.classList.contains("sprout")) {
    sproutWrapper = overlay.parentElement;
  } else {
    sproutWrapper.appendChild(overlay);
  }
  overlay.style.setProperty("background", "rgba(0, 0, 0, 0.55)", "important");
  overlay.style.setProperty("padding", "24px", "important");
  overlay.style.setProperty("z-index", "1000000", "important");

  // ── Panel container ─────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground";
  panel.style.setProperty("width", "min(640px, 100%)", "important");
  panel.style.setProperty("max-height", "90vh", "important");
  panel.style.setProperty("overflow", "auto", "important");
  panel.style.setProperty("padding", "20px", "important");
  panel.style.setProperty("display", "flex", "important");
  panel.style.setProperty("flex-direction", "column", "important");
  panel.style.setProperty("gap", "16px", "important");
  overlay.appendChild(panel);

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "bc flex items-center justify-between";
  const heading = document.createElement("div");
  heading.className = "bc text-lg font-semibold";
  heading.textContent = "Edit flashcard";
  header.appendChild(heading);

  const close = document.createElement("button");
  close.type = "button";
  close.className =
    "bc inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground focus-visible:text-foreground";
  close.style.setProperty("border", "none", "important");
  close.style.setProperty("background", "transparent", "important");
  close.style.setProperty("box-shadow", "none", "important");
  close.style.setProperty("padding", "0", "important");
  close.style.setProperty("cursor", "pointer", "important");
  close.setAttribute("data-tooltip", "Close");
  const closeIcon = document.createElement("span");
  closeIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(closeIcon, "x");
  close.appendChild(closeIcon);
  header.appendChild(close);
  panel.appendChild(header);

  // ── Form body ─────────────────────────────────────────────────────────────
  const form = document.createElement("div");
  form.className = "bc flex flex-col gap-3";

  const normalizedTypes = cards.map((c) => String(c?.type ?? "").toLowerCase());
  const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
  const isSingleMcq = cards.length === 1 && normalizedTypes[0] === "mcq";

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
        if (card.type === "basic") return String(card.q || "");
        if (card.type === "mcq") return String(card.stem || "");
        if (card.type === "cloze") return String(card.clozeText || "");
      }
      if (field === "answer") {
        if (card.type === "basic") return String(card.a || "");
        if (card.type === "mcq") return buildAnswerOrOptionsFor(card);
      }
      if (field === "info") return String(card.info || "");
      if (field === "groups") return groupsToInputString(coerceGroups((card as any).groups));
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
    wrapper.appendChild(labelEl);

    const textarea = document.createElement("textarea");
    textarea.className = "bc textarea w-full";
    textarea.rows = 3;
    textarea.value = sharedValue(field);
    textarea.style.resize = "none";
    textarea.style.minHeight = "80px";
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
  topGrid.appendChild(createReadonlyField("Type", typeLabelBrowser(card0.type)));
  topGrid.appendChild(createReadonlyField("Stage", stageLabel(String((state0 as any)?.stage || "new"))));
  topGrid.appendChild(
    createReadonlyField("Due", state0 && Number.isFinite((state0 as any).due) ? fmtDue((state0 as any).due) : "—"),
  );

  form.appendChild(topGrid);

  // ── Editable fields ───────────────────────────────────────────────────────
  form.appendChild(createFieldWrapper("Title", "title"));
  form.appendChild(createFieldWrapper("Question", "question"));

  // Answer field (only for non-cloze, skip for MCQ which has its own editor)
  if (hasNonCloze && !isSingleMcq) {
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
    mcqLabel.className = "bc text-sm font-medium";
    mcqLabel.textContent = "Answer";
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
        btn.style.setProperty("opacity", disable ? "0.35" : "1", "important");
      });
    };

    /** Append a new wrong-option row. */
    const addWrongRow = (value = "") => {
      const row = document.createElement("div");
      row.className = "bc flex items-center gap-2";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "bc input flex-1 text-sm";
      input.placeholder = "Wrong option";
      input.value = value;
      row.appendChild(input);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "bc inline-flex items-center justify-center text-muted-foreground";
      removeBtn.style.setProperty("border", "none", "important");
      removeBtn.style.setProperty("background", "transparent", "important");
      removeBtn.style.setProperty("padding", "0", "important");
      const xIcon = document.createElement("span");
      xIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-[0.8rem]";
      setIcon(xIcon, "x");
      removeBtn.appendChild(xIcon);

      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (wrongRows.length <= 1) return;
        const idx = wrongRows.indexOf({ input } as any);
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
  inputEls["groups"] = groupField.hiddenInput as HTMLInputElement;

  form.appendChild(groupsWrapper);

  // Location (read-only)
  form.appendChild(createReadonlyField("Location", fmtLocation(card0.sourceNotePath)));

  panel.appendChild(form);

  // ── Footer buttons ────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "bc flex items-center justify-end gap-4";

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
  panel.appendChild(footer);

  /** Remove the overlay from the DOM and clean up the Escape listener. */
  function removeOverlay() {
    try {
      overlay.remove();
    } catch {}
  }

  cancel.addEventListener("click", removeOverlay);
  close.addEventListener("click", removeOverlay);

  // ── Save handler ──────────────────────────────────────────────────────────
  save.addEventListener("click", async () => {
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
        new Notice("Correct MCQ answer cannot be empty.");
        return;
      }

      const wrongEls = wrongContainer?.querySelectorAll("input[type=text]") as NodeListOf<HTMLInputElement>;
      const wrongs = Array.from(wrongEls || [])
        .map((el) => el.value.trim())
        .filter((v) => v.length > 0);

      if (wrongs.length < 1) {
        new Notice("MCQ requires at least one wrong option.");
        return;
      }

      // Reconstruct legacy pipe-format answer string
      const optionsList = [correct, ...wrongs];
      const rendered = optionsList.map((opt, idx) => (idx === 0 ? `**${escapePipes(opt)}**` : escapePipes(opt)));
      updates.answer = rendered.join(" | ");
    }

    if (!Object.keys(updates).length) {
      new Notice("Enter a value for at least one field.");
      return;
    }

    try {
      // Apply updates to card records
      const updatedCards: CardRecord[] = [];
      for (const card of cards) {
        let updated: CardRecord = JSON.parse(JSON.stringify(card));

        if (updates.title !== undefined) updated.title = updates.title;

        if (updates.question !== undefined) {
          if (updated.type === "basic") updated.q = updates.question;
          else if (updated.type === "mcq") updated.stem = updates.question;
          else if (updated.type === "cloze") updated.clozeText = updates.question;
        }

        if (updates.answer !== undefined) {
          if (updated.type === "basic") {
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
    } catch (err: any) {
      new Notice(`${BRAND}: ${err?.message || String(err)}`);
    }
  });

  // Click outside panel = close
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) removeOverlay();
  });

  // Escape key = close
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    removeOverlay();
  };
  document.addEventListener("keydown", onKeyDown, true);

  // Mount the overlay
  document.body.appendChild(sproutWrapper);
}
