/**
 * @file src/browser/browser-bulk-edit-modal.ts
 * @summary Full-screen bulk-edit overlay for the Flashcard Browser. Displays a
 * modal form allowing the user to edit one or more selected cards at once,
 * including title, question, answer/options (with MCQ support), extra info, and
 * a group tag-picker with search, add, and remove capabilities. Supports cloze
 * keyboard shortcuts and writes changes back to source markdown files.
 *
 * @exports
 *   - BulkEditContext — interface providing callbacks and state the modal needs from its host
 *   - openBulkEditModal — creates and displays the bulk-edit overlay for a set of selected cards
 */

import { Notice, Platform, setIcon } from "obsidian";
import type { CardRecord } from "../core/store";
import { normalizeCardOptions } from "../core/store";
import { log } from "../core/logger";
import { setCssProps } from "../core/ui";
import { buildAnswerOrOptionsFor, escapePipes } from "../reviewer/fields";
import { getDelimiter } from "../core/delimiter";
import type { ColKey } from "./browser-helpers";
import {
  clearNode,
  titleCaseGroupPath,
  formatGroupDisplay,
  expandGroupAncestors,
  parseGroupsInput,
  groupsToInput,
} from "./browser-helpers";

// ── Context interface ──────────────────────────────────────

export interface BulkEditContext {
  cellTextClass: string;
  readCardField(card: CardRecord, col: ColKey): string;
  applyValueToCard(card: CardRecord, col: ColKey, value: string): CardRecord;
  writeCardToMarkdown(card: CardRecord): Promise<void>;
  getAllCards(): CardRecord[];
}

// ── Constants ──────────────────────────────────────────────

const PLACEHOLDER_TITLE = "Enter a descriptive title for this flashcard";
const PLACEHOLDER_CLOZE = "Type your text and wrap parts to hide with {{c1::text}}. Use {{c2::text}} for separate deletions, or {{c1::text}} again to hide together.";
const PLACEHOLDER_QUESTION = "Enter the question you want to answer";
const PLACEHOLDER_ANSWER = "Enter the answer to your question";
const PLACEHOLDER_INFO = "Optional: Add extra context or explanation shown on the back of the card";

// ── Main function ──────────────────────────────────────────

export function openBulkEditModal(cards: CardRecord[], ctx: BulkEditContext): void {
  // Container — matches Obsidian's native Modal DOM structure:
  //   div.modal-container  >  div.modal-bg  +  div.modal
  const container = document.createElement("div");
  container.className = "modal-container sprout-modal-container sprout-modal-dim sprout mod-dim";
  setCssProps(container, "z-index", "2147483000");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-bg";
  container.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "modal bc sprout-modals sprout-bulk-edit-panel";
  setCssProps(panel, "z-index", "2147483001");
  container.appendChild(panel);

  // Close button — direct child of panel, before header (matches Obsidian Modal layout)
  const close = document.createElement("div");
  close.className = "modal-close-button mod-raised clickable-icon";
  close.setAttribute("data-tooltip", "Close");
  close.setAttribute("data-tooltip-position", "top");
  setIcon(close, "x");
  close.addEventListener("click", () => {
    removeOverlay();
  });
  panel.appendChild(close);

  const header = document.createElement("div");
  header.className = "modal-header";
  const heading = document.createElement("div");
  heading.className = "modal-title";
  heading.textContent = cards.length === 1 ? "Edit flashcard" : `Edit ${cards.length} selected cards`;
  header.appendChild(heading);
  panel.appendChild(header);

  const contentWrap = document.createElement("div");
  contentWrap.className = "modal-content bc sprout-bulk-edit-content";
  panel.appendChild(contentWrap);

  const form = document.createElement("div");
  form.className = "flex flex-col gap-4";

  const normalizedTypes = cards.map((card) => String(card?.type ?? "").toLowerCase());
  const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
  const hasMcq = normalizedTypes.some((type) => type === "mcq");
  const answerLabel = hasMcq ? "Answer / Options" : "Answer";
  const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");

  const isMacLike = () => Platform.isMacOS;
  type ClozeShortcut = "new" | "same";
  const getClozeShortcut = (ev: KeyboardEvent): ClozeShortcut | null => {
    const key = String(ev.key || "").toLowerCase();
    if (key !== "c" && ev.code !== "KeyC") return null;
    const primary = isMacLike() ? ev.metaKey : ev.ctrlKey;
    if (!primary || !ev.shiftKey) return null;
    return ev.altKey ? "same" : "new";
  };
  const getClozeIndices = (text: string): number[] => {
    const out: number[] = [];
    const re = /\{\{c(\d+)::/gi;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(text))) {
      const idx = Number(match[1]);
      if (Number.isFinite(idx)) out.push(idx);
    }
    return out;
  };
  const applyClozeShortcut = (textarea: HTMLTextAreaElement, mode: ClozeShortcut) => {
    const value = String(textarea.value ?? "");
    const start = Number.isFinite(textarea.selectionStart) ? (textarea.selectionStart) : value.length;
    const end = Number.isFinite(textarea.selectionEnd) ? (textarea.selectionEnd) : value.length;
    const indices = getClozeIndices(value);
    const maxIdx = indices.length ? Math.max(...indices) : 0;
    const lastIdx = indices.length ? indices[indices.length - 1] : maxIdx;
    const clozeIdx = mode === "same" ? (lastIdx || 1) : maxIdx + 1;

    const before = value.slice(0, start);
    const after = value.slice(end);
    const selected = value.slice(start, end);

    if (selected.length > 0) {
      const wrapped = `{{c${clozeIdx}::${selected}}}`;
      textarea.value = before + wrapped + after;
      const pos = before.length + wrapped.length;
      textarea.setSelectionRange(pos, pos);
    } else {
      const token = `{{c${clozeIdx}::}}`;
      textarea.value = before + token + after;
      const pos = before.length + `{{c${clozeIdx}::`.length;
      textarea.setSelectionRange(pos, pos);
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const attachClozeShortcuts = (textarea: HTMLTextAreaElement) => {
    textarea.addEventListener("keydown", (ev: KeyboardEvent) => {
      const shortcut = getClozeShortcut(ev);
      if (!shortcut) return;
      ev.preventDefault();
      ev.stopPropagation();
      applyClozeShortcut(textarea, shortcut);
    });
  };

  let fields: Array<{ key: ColKey; label: string; editable: boolean }> = [
    { key: "id", label: "ID", editable: false },
    { key: "type", label: "Type", editable: false },
    { key: "stage", label: "Stage", editable: false },
    { key: "due", label: "Due", editable: false },
    { key: "title", label: "Title", editable: true },
    { key: "question", label: "Question", editable: true },
    { key: "info", label: "Extra information", editable: true },
    { key: "location", label: "Location", editable: false },
    { key: "groups", label: "Groups", editable: true },
  ];
  if (hasNonCloze) {
    fields.splice(
      fields.findIndex((f) => f.key === "info"),
      0,
      { key: "answer", label: answerLabel, editable: true },
    );
  }
  const isSingleMcq = cards.length === 1 && normalizedTypes[0] === "mcq";
  if (isSingleMcq) {
    fields = fields.filter((f) => f.key !== "answer");
  }

  const inputEls: Partial<Record<ColKey, HTMLInputElement | HTMLTextAreaElement>> = {};

  const topKeys: ColKey[] = ["id", "type", "stage", "due"];

  const answerPredicate = (card: CardRecord) => String(card.type ?? "").toLowerCase() !== "cloze";
  let mcqOriginalString = "";
  let buildMcqValue: (() => string | null) | null = null;

  // ── Group picker field builder ────────────────────────────

  const createGroupPickerField = (initialValue: string, cardsCount: number) => {
    const hiddenInput = document.createElement("input");
    hiddenInput.type = "hidden";
    hiddenInput.value = initialValue;

    const container = document.createElement("div");
    container.className = "relative sprout-group-picker";

    const tagBox = document.createElement("div");
    tagBox.className = `textarea w-full ${ctx.cellTextClass} sprout-bulk-tag-box`;
    container.appendChild(tagBox);

    let overwriteNotice: HTMLDivElement | null = null;
    if (cardsCount > 1) {
      overwriteNotice = document.createElement("div");
      overwriteNotice.className = "text-xs text-muted-foreground";
      overwriteNotice.textContent =
        "Typing here will overwrite this field for every selected card; leave it blank to keep existing values.";
      overwriteNotice.classList.add("sprout-is-hidden");
      container.appendChild(overwriteNotice);
    }

    let selected = parseGroupsInput(initialValue);
    if (!selected) selected = [];

    const optionSet = new Set<string>();
    for (const g of (ctx.getAllCards() || [])
      .flatMap((c) => (Array.isArray(c?.groups) ? c.groups : []))
      .map((g) => titleCaseGroupPath(String(g).trim()))
      .filter(Boolean)) {
      for (const tag of expandGroupAncestors(g)) optionSet.add(tag);
    }
    let allOptions = Array.from(optionSet).sort((a, b) =>
      formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
    );

    const list = document.createElement("div");
    list.className = "flex flex-col max-h-60 overflow-auto p-1";

    const searchWrap = document.createElement("div");
    searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0 sprout-browser-search-wrap min-h-[38px]";

    const searchIconEl = document.createElement("span");
    searchIconEl.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground sprout-search-icon";
    searchIconEl.setAttribute("aria-hidden", "true");
    setIcon(searchIconEl, "search");
    searchWrap.appendChild(searchIconEl);

    const search = document.createElement("input");
    search.type = "text";
    search.className = "bg-transparent text-sm flex-1 h-9 min-w-0 w-full sprout-search-naked";
    search.placeholder = "Search or add group";
    searchWrap.appendChild(search);

    const panelEl = document.createElement("div");
    panelEl.className = "rounded-lg border border-border bg-popover text-popover-foreground p-0 flex flex-col sprout-pointer-auto";
    panelEl.appendChild(searchWrap);
    panelEl.appendChild(list);

    const popover = document.createElement("div");
    popover.className = "sprout-bulk-popover";
    popover.setAttribute("aria-hidden", "true");
    popover.appendChild(panelEl);
    container.appendChild(popover);

    const addOption = (tag: string) => {
      let changed = false;
      for (const t of expandGroupAncestors(tag)) {
        if (!optionSet.has(t)) {
          optionSet.add(t);
          changed = true;
        }
      }
      if (changed) {
        allOptions = Array.from(optionSet).sort((a, b) =>
          formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
        );
      }
    };

    const updateOverwriteNotice = () => {
      const value = groupsToInput(selected).trim();
      if (overwriteNotice) overwriteNotice.classList.toggle("sprout-is-hidden", !(cardsCount > 1 && value));
    };

    const commit = () => {
      hiddenInput.value = groupsToInput(selected);
      updateOverwriteNotice();
    };

    const renderBadges = () => {
      clearNode(tagBox);
      if (selected.length === 0) {
        const empty = document.createElement("span");
        empty.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 sprout-badge-placeholder sprout-badge-inline";
        empty.textContent = "No groups";
        tagBox.appendChild(empty);
        return;
      }
      for (const tag of selected) {
        const badge = document.createElement("span");
        badge.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 sprout-badge-inline";

        const txt = document.createElement("span");
        txt.textContent = formatGroupDisplay(tag);
        badge.appendChild(txt);

        const removeBtn = document.createElement("span");
        removeBtn.className = "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white sprout-icon-scale-85";
        setIcon(removeBtn, "x");
        removeBtn.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        });
        removeBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selected = selected.filter((t) => t !== tag);
          renderBadges();
          renderList();
          commit();
        });
        badge.appendChild(removeBtn);

        tagBox.appendChild(badge);
      }
      updateOverwriteNotice();
    };

    const toggleTag = (tag: string) => {
      const next = titleCaseGroupPath(tag);
      if (!next) return;
      if (selected.includes(next)) selected = selected.filter((t) => t !== next);
      else selected = [...selected, next];
      renderBadges();
      renderList();
      commit();
    };

    const renderList = () => {
      clearNode(list);
      const raw = search.value.trim();
      const rawTitle = titleCaseGroupPath(raw);
      const rawDisplay = formatGroupDisplay(rawTitle);
      const q = raw.toLowerCase();
      const options = allOptions.filter((t) => formatGroupDisplay(t).toLowerCase().includes(q));
      const exact =
        raw && allOptions.some((t) => formatGroupDisplay(t).toLowerCase() === rawDisplay.toLowerCase());

      const addRow = (label: string, value: string, isAdd = false) => {
        const row = document.createElement("div");
        row.setAttribute("role", "menuitem");
        row.setAttribute("aria-checked", selected.includes(value) ? "true" : "false");
        row.tabIndex = 0;
        row.className = "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";

        const text = document.createElement("span");
        text.textContent = label;
        row.appendChild(text);

        if (selected.includes(value) && !isAdd) {
          const check = document.createElement("span");
          check.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
          setIcon(check, "check");
          row.appendChild(check);
        } else {
          const spacer = document.createElement("span");
          spacer.className = "inline-flex items-center justify-center [&_svg]:size-3 opacity-0";
          setIcon(spacer, "check");
          row.appendChild(spacer);
        }

        row.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (isAdd) {
            const next = titleCaseGroupPath(value);
            toggleTag(next);
            if (next) addOption(next);
            search.value = "";
            renderList();
            return;
          }
          toggleTag(value);
        });

        row.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            if (isAdd) {
              const next = titleCaseGroupPath(value);
              toggleTag(next);
              if (next) addOption(next);
              search.value = "";
              renderList();
              return;
            }
            toggleTag(value);
          }
        });

        list.appendChild(row);
      };

      if (raw && !exact) addRow(`Add "${rawDisplay || rawTitle}"`, rawTitle || raw, true);
      if (allOptions.length === 0 && !raw && selected.length === 0) {
        list.classList.add("sprout-list-unbounded");
        const empty = document.createElement("div");
        empty.className = "px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
        empty.textContent = "Type a keyword above to save this flashcard to a group.";
        list.appendChild(empty);
        return;
      }

      list.classList.remove("sprout-list-unbounded");

      for (const opt of options) addRow(formatGroupDisplay(opt), opt);
    };

    let cleanup: (() => void) | null = null;
    const closePopover = () => {
      popover.setAttribute("aria-hidden", "true");
      popover.classList.remove("is-open");
      if (cleanup) {
        try {
          cleanup();
        } catch (e) { log.swallow("bulk edit popover cleanup", e); }
        cleanup = null;
      }
    };

    const openPopover = () => {
      popover.setAttribute("aria-hidden", "false");
      popover.classList.add("is-open");
      renderList();
      search.focus();

      const onDocPointerDown = (ev: PointerEvent) => {
        const target = ev.target as Node | null;
        if (!target || container.contains(target)) return;
        closePopover();
      };
      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        closePopover();
      };

      document.addEventListener("pointerdown", onDocPointerDown, true);
      document.addEventListener("keydown", onDocKeydown, true);
      cleanup = () => {
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    tagBox.addEventListener("pointerdown", (ev) => {
      if ((ev).button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (popover.classList.contains("is-open")) {
        closePopover();
      } else {
        openPopover();
      }
    });

    search.addEventListener("input", () => renderList());
    search.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === ",") {
        ev.preventDefault();
        ev.stopPropagation();
        const raw = search.value.replace(/,$/, "").trim();
        if (raw) {
          const next = titleCaseGroupPath(raw);
          toggleTag(next);
          if (next) addOption(next);
          search.value = "";
          renderList();
        }
      }
    });

    renderBadges();
    updateOverwriteNotice();
    commit();

    return { element: container, hiddenInput };
  };

  // ── Shared-value helper ───────────────────────────────────

  const sharedValue = (col: ColKey, predicate: (card: CardRecord) => boolean = () => true) => {
    const filtered = cards.filter(predicate);
    if (!filtered.length) return "";
    const vals = filtered.map((card) => ctx.readCardField(card, col));
    const first = vals[0];
    return vals.every((value) => value === first) ? first : "";
  };

  // ── Field wrapper builder ─────────────────────────────────

  const createFieldWrapper = (field: { key: ColKey; label: string; editable: boolean }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "flex flex-col gap-1";

    const label = document.createElement("label");
    label.className = "text-sm font-medium";
    label.textContent = field.label;
    wrapper.appendChild(label);

    if (field.key === "groups") {
      const groupField = createGroupPickerField(sharedValue(field.key), cards.length);
      wrapper.appendChild(groupField.element);
      wrapper.appendChild(groupField.hiddenInput);
      inputEls[field.key] = groupField.hiddenInput;
      return wrapper;
    }

    let input: HTMLInputElement | HTMLTextAreaElement;
    const predicate = field.key === "answer" ? answerPredicate : undefined;
    const value = sharedValue(field.key, predicate);
    if (field.editable && (field.key === "title" || field.key === "question" || field.key === "answer" || field.key === "info")) {
      const textarea = document.createElement("textarea");
      textarea.className = "textarea w-full sprout-textarea-fixed";
      textarea.rows = 3;
      textarea.value = value;
      if (field.key === "title") textarea.placeholder = PLACEHOLDER_TITLE;
      if (field.key === "question") textarea.placeholder = isClozeOnly ? PLACEHOLDER_CLOZE : PLACEHOLDER_QUESTION;
      if (field.key === "answer") textarea.placeholder = PLACEHOLDER_ANSWER;
      if (field.key === "info") textarea.placeholder = PLACEHOLDER_INFO;
      input = textarea;
    } else {
      const txt = document.createElement("input");
      txt.type = "text";
      txt.className = "input w-full";
      txt.value = value;
      txt.disabled = !field.editable;
      input = txt;
    }

    if (cards.length > 1 && field.editable) {
      const overwriteNotice = document.createElement("div");
      overwriteNotice.className = "text-xs text-muted-foreground";
      const cardCount = cards.length;
      const cardLabel = cardCount === 1 ? "card" : "cards";
      overwriteNotice.textContent = `You have selected ${cardCount} ${cardLabel}. Any input in this field will overwrite all ${cardCount} ${cardLabel}. To leave all cards in their current form, leave this field blank.`;
      overwriteNotice.classList.add("sprout-is-hidden");
      wrapper.appendChild(overwriteNotice);

      const updateOverwriteNotice = () => {
        const value = String(input.value ?? "").trim();
        overwriteNotice.classList.toggle("sprout-is-hidden", !value.length);
      };
      input.addEventListener("input", updateOverwriteNotice);
      updateOverwriteNotice();
    }

    wrapper.appendChild(input);
    inputEls[field.key] = input;
    if (field.key === "question" && input instanceof HTMLTextAreaElement && isClozeOnly) {
      attachClozeShortcuts(input);
    }
    return wrapper;
  };

  // ── MCQ editor builder ────────────────────────────────────

  const createMcqEditor = () => {
    if (!isSingleMcq) {
      buildMcqValue = null;
      return null;
    }
    const card = cards[0];
    mcqOriginalString = buildAnswerOrOptionsFor(card);
    const options = normalizeCardOptions(card.options);
    const correctIndex = Number.isFinite(card.correctIndex) ? card.correctIndex! : 0;
    const correctValue = options[correctIndex] ?? "";
    const wrongValues = options.filter((_, idx) => idx !== correctIndex);

    const container = document.createElement("div");
    container.className = "flex flex-col gap-1";

    const label = document.createElement("label");
    label.className = "text-sm font-medium";
    label.textContent = "Answer";
    container.appendChild(label);

    const correctWrapper = document.createElement("div");
    correctWrapper.className = "flex flex-col gap-1";
    const correctLabel = document.createElement("div");
    correctLabel.className = "text-xs text-muted-foreground inline-flex items-center gap-1";
    correctLabel.textContent = "Correct answer";
    correctLabel.appendChild(Object.assign(document.createElement("span"), { className: "text-destructive", textContent: "*" }));
    correctWrapper.appendChild(correctLabel);
    const correctInput = document.createElement("input");
    correctInput.type = "text";
    correctInput.className = "input w-full sprout-input-fixed";
    correctInput.placeholder = "Enter the correct answer choice";
    correctInput.value = correctValue;
    correctWrapper.appendChild(correctInput);
    container.appendChild(correctWrapper);

    const wrongLabel = document.createElement("div");
    wrongLabel.className = "text-xs text-muted-foreground inline-flex items-center gap-1";
    wrongLabel.textContent = "Wrong options";
    wrongLabel.appendChild(Object.assign(document.createElement("span"), { className: "text-destructive", textContent: "*" }));
    container.appendChild(wrongLabel);

    const wrongContainer = document.createElement("div");
    wrongContainer.className = "flex flex-col gap-2";
    container.appendChild(wrongContainer);

    const wrongRows: Array<{ row: HTMLElement; input: HTMLInputElement; removeBtn: HTMLButtonElement }> = [];
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "input flex-1 text-sm sprout-input-fixed";
    const updateAddPlaceholder = () => {
      const label = wrongRows.length ? "Add another incorrect answer choice" : "Enter an incorrect answer choice";
      addInput.placeholder = label;
    };

    const addInputWrap = document.createElement("div");
    addInputWrap.className = "flex items-center gap-2";
    addInputWrap.appendChild(addInput);
    container.appendChild(addInputWrap);

    const updateRemoveButtons = () => {
      const disable = wrongRows.length <= 1;
      for (const entry of wrongRows) {
        entry.removeBtn.disabled = disable;
        entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
        entry.removeBtn.classList.toggle("is-disabled", disable);
      }
    };

    const addWrongRow = (value = "") => {
      const row = document.createElement("div");
      row.className = "flex items-center gap-2";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "input flex-1 text-sm sprout-input-fixed";
      input.placeholder = "Enter an incorrect answer choice";
      input.value = value;
      row.appendChild(input);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "inline-flex items-center justify-center sprout-remove-btn-ghost";
      removeBtn.setAttribute("data-tooltip", "Remove option");
      removeBtn.setAttribute("data-tooltip-position", "top");
      const xIcon = document.createElement("span");
      xIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(xIcon, "x");
      removeBtn.appendChild(xIcon);
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (wrongRows.length <= 1) return;
        const idx = wrongRows.findIndex((entry) => entry.input === input);
        if (idx === -1) return;
        wrongRows[idx].row.remove();
        wrongRows.splice(idx, 1);
        updateRemoveButtons();
      });
      row.appendChild(removeBtn);
      wrongContainer.appendChild(row);
      wrongRows.push({ row, input, removeBtn });
      updateRemoveButtons();
      updateAddPlaceholder();
    };

    const commitAddInput = () => {
      const value = addInput.value.trim();
      if (!value) return;
      addWrongRow(value);
      addInput.value = "";
      addInput.focus();
    };
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        commitAddInput();
      }
    });
    addInput.addEventListener("blur", () => {
      commitAddInput();
    });

    const initialWrongs = wrongValues.length ? wrongValues : [""];
    for (const value of initialWrongs) addWrongRow(value);
    updateAddPlaceholder();

    const buildValue = () => {
      const correct = correctInput.value.trim();
      if (!correct) {
        new Notice("Correct multiple-choice answer cannot be empty.");
        return null;
      }
      const wrongs = wrongRows.map((entry) => entry.input.value.trim()).filter((opt) => opt.length > 0);
      if (wrongs.length < 1) {
        new Notice("Multiple-choice cards require at least one wrong option.");
        return null;
      }
      const optionsList = [correct, ...wrongs];
      const rendered = optionsList.map((opt, idx) =>
        idx === 0 ? `**${escapePipes(opt)}**` : escapePipes(opt),
      );
      return rendered.join(` ${getDelimiter()} `);
    };
    buildMcqValue = () => buildValue();

    return container;
  };

  const mcqSection = isSingleMcq ? createMcqEditor() : null;

  // ── Assemble the form ─────────────────────────────────────

  const topGrid = document.createElement("div");
  topGrid.className = "grid grid-cols-1 gap-3 md:grid-cols-2";
  for (const key of topKeys) {
    const field = fields.find((f) => f.key === key);
    if (!field) continue;
    topGrid.appendChild(createFieldWrapper(field));
  }
  form.appendChild(topGrid);

  let mcqInserted = false;
  for (const field of fields.filter((f) => !topKeys.includes(f.key))) {
    if (field.key === "info" && mcqSection && !mcqInserted) {
      form.appendChild(mcqSection);
      mcqInserted = true;
    }
    form.appendChild(createFieldWrapper(field));
  }
  if (mcqSection && !mcqInserted) {
    form.appendChild(mcqSection);
  }

  contentWrap.appendChild(form);

  // ── Footer (Cancel / Save) ────────────────────────────────

  const footer = document.createElement("div");
  footer.className = "flex items-center justify-end gap-4 sprout-modal-footer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm";
  const cancelIcon = document.createElement("span");
  cancelIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(cancelIcon, "x");
  const cancelText = document.createElement("span");
  cancelText.textContent = "Cancel";
  cancel.appendChild(cancelIcon);
  cancel.appendChild(cancelText);
  cancel.addEventListener("click", () => removeOverlay());
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm";
  const saveIcon = document.createElement("span");
  saveIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(saveIcon, "save");
  const saveText = document.createElement("span");
  saveText.textContent = "Save";
  save.appendChild(saveIcon);
  save.appendChild(saveText);
  save.addEventListener("click", () => { void (async () => {
    const updates: Partial<Record<ColKey, string>> = {};
    for (const field of fields) {
      if (!field.editable) continue;
      const el = inputEls[field.key];
      if (!el) continue;
      const val = String(el.value ?? "").trim();
      if (!val) continue;
      updates[field.key] = val;
    }
    if (!Object.keys(updates).length) {
      new Notice("Enter a value for at least one editable field.");
      return;
    }
    if (isSingleMcq && buildMcqValue) {
      const mcqValue = buildMcqValue();
      if (mcqValue === null) return;
      if (mcqValue && mcqValue !== mcqOriginalString) {
        updates.answer = mcqValue;
      }
    }
    try {
      for (const card of cards) {
        let updated = card;
        for (const [key, value] of Object.entries(updates)) {
          updated = ctx.applyValueToCard(updated, key as ColKey, value);
        }
        await ctx.writeCardToMarkdown(updated);
      }
      container.remove();
    } catch (err: unknown) {
      new Notice(`${err instanceof Error ? err.message : String(err)}`);
    }
  })(); });
  footer.appendChild(cancel);
  footer.appendChild(save);
  contentWrap.appendChild(footer);

  // ── Overlay lifecycle ─────────────────────────────────────

  const removeOverlay = () => {
    document.removeEventListener("keydown", onKeyDown, true);
    container.remove();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    removeOverlay();
  };
  document.addEventListener("keydown", onKeyDown, true);

  backdrop.addEventListener("click", () => removeOverlay());

  // Scope modal to active workspace leaf content (allows tab switching while modal is open)
  const activeLeaf = document.querySelector(".workspace-leaf.mod-active");
  const leafContent = activeLeaf?.querySelector(".workspace-leaf-content");
  const target = leafContent || document.body;
  target.appendChild(container);
}
