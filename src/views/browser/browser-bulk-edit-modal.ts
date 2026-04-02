/**
 * @file src/browser/browser-bulk-edit-modal.ts
 * @summary Full-screen bulk-edit modal for the Flashcard Browser. Extends
 * Obsidian's Modal class for consistent lifecycle, z-index, and paint
 * behaviour. Displays a form allowing the user to edit one or more selected
 * cards at once, including title, question, answer/options (with MCQ support),
 * extra info, and a group tag-picker with search, add, and remove capabilities.
 * Supports cloze keyboard shortcuts and writes changes back to source markdown
 * files.
 *
 * @exports
 *   - BulkEditContext — interface providing callbacks and state the modal needs from its host
 *   - BulkEditModal — Obsidian Modal subclass for bulk editing
 *   - openBulkEditModal — convenience wrapper that creates and opens BulkEditModal
 */

import { Modal, Notice, setIcon, type App } from "obsidian";
import type { CardRecord } from "../../platform/core/store";
import { normalizeCardOptions, getCorrectIndices } from "../../platform/core/store";
import {
  attachClozeShortcuts,
  createMobileClozeButtons,
  shouldShowMobileClozeButtons,
} from "../../platform/card-editor/card-editor";

import { buildAnswerOrOptionsFor, escapePipes } from "../reviewer/fields";
import { getDelimiter } from "../../platform/core/delimiter";
import type { ColKey } from "./browser-helpers";
import {
  clearNode,
  titleCaseGroupPath,
  formatGroupDisplay,
  expandGroupAncestors,
  parseGroupsInput,
  groupsToInput,
} from "./browser-helpers";
import { setModalTitle, scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import { renderMarkdownPreviewInElement, setCssProps } from "../../platform/core/ui";
import { handleTabInTextarea } from "../../platform/card-editor/card-editor";
import { t } from "../../platform/translations/translator";

// ── Context interface ──────────────────────────────────────

export interface BulkEditContext {
  cellTextClass: string;
  interfaceLanguage?: string;
  readCardField(card: CardRecord, col: ColKey): string;
  applyValueToCard(card: CardRecord, col: ColKey, value: string): CardRecord;
  writeCardToMarkdown(card: CardRecord): Promise<void>;
  getAllCards(): CardRecord[];
}

function fieldMinHeightPx(field: "title" | "question" | "answer" | "info"): number {
  if (field === "title" || field === "question" || field === "answer" || field === "info") {
    return 50;
  }
  return 50;
}

function fieldMaxHeightPx(field: "title" | "question" | "answer" | "info"): number {
  if (field === "title" || field === "question" || field === "answer" || field === "info") {
    return 150;
  }
  return 150;
}

// ── Modal class ────────────────────────────────────────────

export class BulkEditModal extends Modal {
  private cards: CardRecord[];
  private ctx: BulkEditContext;
  private closeCleanup: Array<() => void> = [];

  constructor(app: App, cards: CardRecord[], ctx: BulkEditContext) {
    super(app);
    this.cards = cards;
    this.ctx = ctx;
  }

  onOpen() {
    const { cards, ctx } = this;
    const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
      t(ctx.interfaceLanguage, token, fallback, vars);

    // ── Modal chrome ──────────────────────────────────────────────────────
    const title = cards.length === 1
      ? tx("ui.browser.bulkEdit.title.single", "Edit flashcard")
      : tx("ui.browser.bulkEdit.title.multi", "Edit {count} selected cards", { count: cards.length });
    setModalTitle(this, title);

    // Apply all CSS classes and z-index BEFORE scoping to workspace.
    // scopeModalToWorkspace forces a repaint, which only works if the
    // positioning CSS (position:absolute, z-index, etc.) is already active.
    this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "sprout");
    setCssProps(this.containerEl, "z-index", "2147483000");
    this.modalEl.addClass("lk-modals", "learnkit-bulk-edit-panel");
    setCssProps(this.modalEl, "z-index", "2147483001");
    scopeModalToWorkspace(this);
    this.contentEl.addClass("learnkit-bulk-edit-content");

    // Replace native close icon with card-creator style close button.
    const closeBtn = this.modalEl.querySelector<HTMLElement>(":scope > .modal-close-button");
    const headerEl = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header");
    if (closeBtn) closeBtn.remove();
    if (headerEl) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "learnkit-btn-toolbar learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-card-creator-close-btn learnkit-bulk-edit-close-btn";
      close.setAttribute("aria-label", tx("ui.common.close", "Close"));
      close.setAttribute("data-tooltip-position", "top");

      const closeIcon = document.createElement("span");
      closeIcon.className = "inline-flex items-center justify-center";
      setIcon(closeIcon, "x");

      const closeLabel = document.createElement("span");
      closeLabel.className = "";
      closeLabel.setAttribute("data-learnkit-label", "true");
      closeLabel.textContent = tx("ui.common.close", "Close");

      close.appendChild(closeIcon);
      close.appendChild(closeLabel);
      close.addEventListener("click", () => this.close());
      headerEl.appendChild(close);
    }

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

    // Reset cleanup handlers for this modal instance and collect teardown work
    // (document listeners, observers) created while building the form.
    this.closeCleanup = [];
    const registerCloseCleanup = (fn: () => void) => {
      this.closeCleanup.push(fn);
    };

    const handleModalPointerDownBlur = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
      if (!active.classList.contains("learnkit-flag-editor-control")) return;
      const activeWrap = active.closest<HTMLElement>(".learnkit-flag-editor-wrap");
      if (activeWrap?.contains(target)) return;
      active.blur();
    };
    document.addEventListener("pointerdown", handleModalPointerDownBlur, true);
    registerCloseCleanup(() => {
      document.removeEventListener("pointerdown", handleModalPointerDownBlur, true);
    });

  const form = document.createElement("div");
  form.className = `flex flex-col gap-4 learnkit-bulk-edit-form${cards.length > 1 ? " learnkit-bulk-edit-form--multi" : ""}`;

  const normalizedTypes = cards.map((card) => String(card?.type ?? "").toLowerCase());
  const canBulkToggleType =
    cards.length > 1 &&
    normalizedTypes.length > 0 &&
    normalizedTypes.every((type) => type === "basic" || type === "reversed");
  let selectedBulkType: "basic" | "reversed" = normalizedTypes[0] === "reversed" ? "reversed" : "basic";
  const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
  const hasMcq = normalizedTypes.some((type) => type === "mcq");
  const answerLabel = hasMcq
    ? tx("ui.browser.bulkEdit.field.answerOrOptions", "Answer / Options")
    : tx("ui.browser.bulkEdit.field.answer", "Answer");
  const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");

  let fields: Array<{ key: ColKey; label: string; editable: boolean }> = [
    { key: "id", label: tx("ui.browser.bulkEdit.field.id", "ID"), editable: false },
    { key: "type", label: tx("ui.browser.bulkEdit.field.type", "Type"), editable: false },
    { key: "stage", label: tx("ui.browser.bulkEdit.field.stage", "Stage"), editable: false },
    { key: "due", label: tx("ui.browser.bulkEdit.field.due", "Due"), editable: false },
    { key: "title", label: tx("ui.browser.bulkEdit.field.title", "Title"), editable: true },
    { key: "question", label: tx("ui.browser.bulkEdit.field.question", "Question"), editable: true },
    { key: "info", label: tx("ui.browser.bulkEdit.field.extraInfo", "Extra information"), editable: true },
    { key: "location", label: tx("ui.browser.bulkEdit.field.location", "Location"), editable: false },
    { key: "groups", label: tx("ui.browser.bulkEdit.field.groups", "Groups"), editable: true },
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

  const attachFlagPreviewOverlay = (
    control: HTMLInputElement | HTMLTextAreaElement,
    minControlHeight = 100,
    maxControlHeight = Number.POSITIVE_INFINITY,
  ): HTMLElement => {
    const wrap = document.createElement("div");
    wrap.className = `learnkit-flag-editor-wrap${control instanceof HTMLTextAreaElement ? " learnkit-flag-editor-wrap--multiline" : ""}`;

    const overlay = document.createElement("div");
    overlay.className = `learnkit-flag-editor-overlay${control instanceof HTMLTextAreaElement ? " learnkit-flag-editor-overlay--multiline" : ""}`;

    control.classList.add("learnkit-flag-editor-control", "learnkit-flag-editor-control");

    if (control instanceof HTMLTextAreaElement) {
      // Let actual content drive height instead of keeping a fixed multi-row baseline.
      control.rows = 1;
      setCssProps(control, {
        "min-height": `${minControlHeight}px`,
        height: `${minControlHeight}px`,
        "max-height": `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`,
        resize: "vertical",
        "overflow-y": "auto",
      });
    }

    const clampHeight = (height: number) => {
      const boundedMin = Math.max(minControlHeight, Math.ceil(height || 0));
      if (!Number.isFinite(maxControlHeight)) return boundedMin;
      return Math.min(Math.max(minControlHeight, Math.floor(maxControlHeight)), boundedMin);
    };

    const applyControlHeight = (height: number) => {
      setCssProps(control, "min-height", `${height}px`);
      setCssProps(control, "height", `${height}px`);
      if (Number.isFinite(maxControlHeight)) {
        setCssProps(control, "max-height", `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`);
      }
      if (control instanceof HTMLInputElement) {
        setCssProps(control, "max-height", `${height}px`);
      }
    };

    let pendingSyncRaf = 0;
    let lastPreviewHeight = clampHeight(minControlHeight);

    const syncPreviewHeight = () => {
      const nextHeight = clampHeight(lastPreviewHeight);
      if (nextHeight !== lastPreviewHeight) {
        lastPreviewHeight = nextHeight;
      }
      wrap.style.setProperty("--learnkit-flag-preview-height", `${lastPreviewHeight}px`);
      if (Number.isFinite(maxControlHeight)) {
        wrap.style.setProperty("--learnkit-flag-preview-max-height", `${Math.max(minControlHeight, Math.floor(maxControlHeight))}px`);
      }
      applyControlHeight(lastPreviewHeight);
    };

    const queueSyncPreviewHeight = () => {
      if (pendingSyncRaf) return;
      pendingSyncRaf = window.requestAnimationFrame(() => {
        pendingSyncRaf = 0;
        syncPreviewHeight();
      });
    };

    const renderOverlay = () => {
      renderMarkdownPreviewInElement(overlay, String(control.value ?? ""));
      syncPreviewHeight();
      window.requestAnimationFrame(syncPreviewHeight);
      window.setTimeout(syncPreviewHeight, 80);
    };

    const focusEditorFromPreview = () => {
      try {
        control.focus({ preventScroll: true });
      } catch {
        control.focus();
      }
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        const end = control.value.length;
        control.setSelectionRange(end, end);
      }
    };

    wrap.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      if (document.activeElement === control) return;
      ev.preventDefault();
      ev.stopPropagation();
      focusEditorFromPreview();
    });

    overlay.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      if (document.activeElement === control) return;
      ev.preventDefault();
      ev.stopPropagation();
      focusEditorFromPreview();
    }, true);

    wrap.addEventListener("mousedown", (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      if (document.activeElement === control) return;
      ev.preventDefault();
      ev.stopPropagation();
      focusEditorFromPreview();
    });

    overlay.addEventListener("mousedown", (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      if (document.activeElement === control) return;
      ev.preventDefault();
      ev.stopPropagation();
      focusEditorFromPreview();
    }, true);

    overlay.addEventListener("click", (ev: MouseEvent) => {
      if (document.activeElement === control) return;
      focusEditorFromPreview();
    });

    const handleDocumentPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (wrap.contains(target)) return;
      if (document.activeElement === control) {
        control.blur();
      }
    };
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);

    control.addEventListener("focus", () => {
      wrap.classList.add("learnkit-flag-editor--focused", "learnkit-flag-editor--focused");
      if (control instanceof HTMLTextAreaElement) {
        setCssProps(wrap, "overflow", "visible");
      }
      syncPreviewHeight();
    });
    control.addEventListener("blur", () => {
      wrap.classList.remove("learnkit-flag-editor--focused", "learnkit-flag-editor--focused");
      if (control instanceof HTMLTextAreaElement) {
        setCssProps(wrap, "overflow", "hidden");
      }
      renderOverlay();
    });
    control.addEventListener("input", () => {
      syncPreviewHeight();
      if (!wrap.classList.contains("learnkit-flag-editor--focused")) renderOverlay();
    });

    if (control instanceof HTMLTextAreaElement) {
      control.addEventListener("keydown", (ev: KeyboardEvent) => {
        if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && String(ev.key).toLowerCase() === "a") {
          ev.stopPropagation();
        }
      });
    }

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (control instanceof HTMLTextAreaElement && wrap.classList.contains("learnkit-flag-editor--focused")) {
          const renderedHeight = Math.ceil(control.getBoundingClientRect().height || 0);
          if (renderedHeight > 0) lastPreviewHeight = clampHeight(renderedHeight);
        }
        queueSyncPreviewHeight();
      });
      ro.observe(overlay);
      ro.observe(control);
      registerCloseCleanup(() => {
        if (pendingSyncRaf) {
          window.cancelAnimationFrame(pendingSyncRaf);
          pendingSyncRaf = 0;
        }
        document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
        ro.disconnect();
      });
    } else {
      registerCloseCleanup(() => {
        document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      });
    }

    renderOverlay();
    wrap.appendChild(control);
    wrap.appendChild(overlay);
    return wrap;
  };

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
    container.className = "relative learnkit-group-picker";

    const tagBox = document.createElement("div");
    tagBox.className = `textarea w-full ${ctx.cellTextClass} learnkit-tag-box`;
    container.appendChild(tagBox);

    let overwriteNotice: HTMLDivElement | null = null;
    if (cardsCount > 1) {
      overwriteNotice = document.createElement("div");
      overwriteNotice.className = "text-xs text-muted-foreground";
      overwriteNotice.textContent =
        tx(
          "ui.browser.bulkEdit.groups.overwriteHint",
          "Typing here will overwrite this field for every selected card; leave it blank to keep existing values.",
        );
      overwriteNotice.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
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
    searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0 lk-browser-search-wrap min-h-[38px]";

    const searchIconEl = document.createElement("span");
    searchIconEl.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-search-icon";
    searchIconEl.setAttribute("aria-hidden", "true");
    setIcon(searchIconEl, "search");
    searchWrap.appendChild(searchIconEl);

    const search = document.createElement("input");
    search.type = "text";
    search.className = "bg-transparent text-sm flex-1 h-9 min-w-0 w-full learnkit-search-naked";
    search.placeholder = tx("ui.browser.bulkEdit.groups.searchPlaceholder", "Search or add group");
    searchWrap.appendChild(search);

    const panelEl = document.createElement("div");
    panelEl.className = "rounded-md border border-border bg-popover text-popover-foreground p-0 flex flex-col learnkit-pointer-auto";
    panelEl.appendChild(searchWrap);
    panelEl.appendChild(list);

    const popover = document.createElement("div");
    popover.className = "learnkit-popover-dropdown";
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
      if (overwriteNotice) overwriteNotice.classList.toggle("learnkit-is-hidden", !(cardsCount > 1 && value));
    };

    const commit = () => {
      hiddenInput.value = groupsToInput(selected);
      updateOverwriteNotice();
    };

    const renderBadges = () => {
      clearNode(tagBox);
      if (selected.length === 0) {
        const empty = document.createElement("span");
        empty.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 learnkit-badge-placeholder learnkit-badge-inline";
        empty.textContent = tx("ui.browser.bulkEdit.groups.empty", "No groups");
        tagBox.appendChild(empty);
        return;
      }
      for (const tag of selected) {
        const badge = document.createElement("span");
        badge.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 learnkit-badge-inline";

        const txt = document.createElement("span");
        txt.textContent = formatGroupDisplay(tag);
        badge.appendChild(txt);

        const removeBtn = document.createElement("span");
        removeBtn.className = "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white scale-[0.85]";
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

      if (raw && !exact) addRow(tx("ui.browser.bulkEdit.groups.add", "Add \"{group}\"", { group: rawDisplay || rawTitle }), rawTitle || raw, true);
      if (allOptions.length === 0 && !raw && selected.length === 0) {
        list.classList.add("learnkit-list-unbounded", "learnkit-list-unbounded");
        const empty = document.createElement("div");
        empty.className = "px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
        empty.textContent = tx("ui.browser.bulkEdit.groups.emptyHint", "Type a keyword above to save this flashcard to a group.");
        list.appendChild(empty);
        return;
      }

      list.classList.remove("learnkit-list-unbounded", "learnkit-list-unbounded");

      for (const opt of options) addRow(formatGroupDisplay(opt), opt);
    };

    let cleanup: (() => void) | null = null;
    const closePopover = () => {
      popover.setAttribute("aria-hidden", "true");
      popover.classList.remove("is-open");
      if (cleanup) {
        try {
          cleanup();
        } catch { /* swallow */ }
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

    registerCloseCleanup(() => closePopover());

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
    wrapper.className = `flex flex-col gap-1${field.key === "type" ? " learnkit-card-meta-field" : ""}`;

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
    if (field.key === "type" && canBulkToggleType) {
      const typeRoot = document.createElement("div");
      typeRoot.className = "learnkit relative inline-flex";

      const typeButton = document.createElement("button");
      typeButton.type = "button";
      typeButton.className = "learnkit-btn-toolbar text-sm inline-flex items-center gap-2 h-7 px-2 cursor-pointer learnkit-card-meta-type-btn";
      typeButton.setAttribute("aria-label", tx("ui.browser.bulkEdit.field.type", "Type"));
      typeButton.setAttribute("data-tooltip-position", "top");
      typeButton.setAttribute("aria-haspopup", "menu");
      typeButton.setAttribute("aria-expanded", "false");

      const typeText = document.createElement("span");
      typeText.className = "truncate";
      const syncTypeText = () => {
        typeText.textContent = selectedBulkType === "reversed"
          ? tx("ui.browser.bulkEdit.type.reversed", "Basic (Reversed)")
          : tx("ui.browser.bulkEdit.type.basic", "Basic");
      };
      syncTypeText();

      const chevron = document.createElement("span");
      chevron.className = "inline-flex items-center justify-center [&_svg]:size-3";
      setIcon(chevron, "chevron-down");
      typeButton.appendChild(typeText);
      typeButton.appendChild(chevron);

      const menu = document.createElement("div");
      menu.className = "learnkit-popover-dropdown learnkit-popover-dropdown-below";
      menu.setAttribute("aria-hidden", "true");

      const panel = document.createElement("div");
      panel.className = "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto";
      const menuList = document.createElement("div");
      menuList.setAttribute("role", "menu");
      menuList.className = "flex flex-col";

      const makeTypeItem = (type: "basic" | "reversed", labelText: string) => {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("tabindex", "0");
        item.className =
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

        const radioWrap = document.createElement("div");
        radioWrap.className = "size-4 flex items-center justify-center";
        const dot = document.createElement("div");
        dot.className = "size-2 rounded-full bg-foreground";
        radioWrap.appendChild(dot);
        const text = document.createElement("span");
        text.textContent = labelText;
        item.appendChild(radioWrap);
        item.appendChild(text);

        const syncChecked = () => {
          const checked = selectedBulkType === type;
          item.setAttribute("aria-checked", checked ? "true" : "false");
          dot.classList.toggle("invisible", !checked);
        };

        const apply = () => {
          selectedBulkType = type;
          syncTypeText();
          for (const child of Array.from(menuList.children)) {
            if (child instanceof HTMLElement) {
              const isChecked = child === item;
              child.setAttribute("aria-checked", isChecked ? "true" : "false");
              const marker = child.querySelector<HTMLElement>(".size-2");
              marker?.classList.toggle("invisible", !isChecked);
            }
          }
          menu.setAttribute("aria-hidden", "true");
          menu.classList.remove("is-open");
          typeButton.setAttribute("aria-expanded", "false");
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          apply();
        });
        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          ev.stopPropagation();
          apply();
        });

        syncChecked();
        return item;
      };

      menuList.appendChild(makeTypeItem("basic", tx("ui.browser.bulkEdit.type.basic", "Basic")));
      menuList.appendChild(makeTypeItem("reversed", tx("ui.browser.bulkEdit.type.reversed", "Basic (Reversed)")));

      panel.appendChild(menuList);
      menu.appendChild(panel);

      let cleanupTypeMenu: (() => void) | null = null;
      const closeTypeMenu = () => {
        menu.setAttribute("aria-hidden", "true");
        menu.classList.remove("is-open");
        typeButton.setAttribute("aria-expanded", "false");
        if (cleanupTypeMenu) {
          cleanupTypeMenu();
          cleanupTypeMenu = null;
        }
      };

      const openTypeMenu = () => {
        menu.setAttribute("aria-hidden", "false");
        menu.classList.add("is-open");
        typeButton.setAttribute("aria-expanded", "true");
        const onDocPointerDown = (ev: PointerEvent) => {
          const target = ev.target;
          if (!(target instanceof Node)) return;
          if (typeRoot.contains(target)) return;
          closeTypeMenu();
        };
        const onDocKeyDown = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          closeTypeMenu();
        };
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeyDown, true);
        cleanupTypeMenu = () => {
          document.removeEventListener("pointerdown", onDocPointerDown, true);
          document.removeEventListener("keydown", onDocKeyDown, true);
        };
      };

      registerCloseCleanup(() => closeTypeMenu());

      typeButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (menu.classList.contains("is-open")) closeTypeMenu();
        else openTypeMenu();
      });

      typeRoot.appendChild(typeButton);
      typeRoot.appendChild(menu);
      wrapper.appendChild(typeRoot);
      return wrapper;
    }

    if (field.editable && (field.key === "title" || field.key === "question" || field.key === "answer" || field.key === "info")) {
      const textarea = document.createElement("textarea");
      textarea.className = "textarea w-full learnkit-textarea-fixed";
      textarea.rows = 3;
      textarea.value = value;
      if (field.key === "title") textarea.placeholder = tx("ui.browser.bulkEdit.placeholder.title", "Enter a descriptive title for this flashcard");
      if (field.key === "question") textarea.placeholder = isClozeOnly
        ? tx("ui.browser.bulkEdit.placeholder.cloze", "Type your text and wrap parts to hide with {{c1::text}}. Use {{c2::text}} for separate deletions, or {{c1::text}} again to hide together.")
        : tx("ui.browser.bulkEdit.placeholder.question", "Enter the question you want to answer");
      if (field.key === "answer") textarea.placeholder = tx("ui.browser.bulkEdit.placeholder.answer", "Enter the answer to your question");
      if (field.key === "info") textarea.placeholder = tx("ui.browser.bulkEdit.placeholder.info", "Optional: Add extra context or explanation shown on the back of the card");
      input = textarea;
    } else {
      const txt = document.createElement("input");
      txt.type = "text";
      txt.className = `input w-full${field.key === "location" ? " learnkit-location-input" : ""}`;
      txt.value = value;
      txt.disabled = !field.editable;
      input = txt;
    }

    if (cards.length > 1 && field.editable) {
      const overwriteNotice = document.createElement("div");
      overwriteNotice.className = "text-xs text-muted-foreground";
      const cardCount = cards.length;
      const cardLabel = cardCount === 1
        ? tx("ui.browser.bulkEdit.cardSingular", "card")
        : tx("ui.browser.bulkEdit.cardPlural", "cards");
      overwriteNotice.textContent = tx(
        "ui.browser.bulkEdit.overwriteHint",
        "You have selected {count} {label}. Any input in this field will overwrite this field for all cards. To leave all cards in their current form, leave this field blank.",
        { count: cardCount, label: cardLabel },
      );
      overwriteNotice.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
      wrapper.appendChild(overwriteNotice);

      const updateOverwriteNotice = () => {
        const value = String(input.value ?? "").trim();
        overwriteNotice.classList.toggle("learnkit-is-hidden", !value.length);
      };
      input.addEventListener("input", updateOverwriteNotice);
      updateOverwriteNotice();
    }

    const shouldPreviewFlags = field.editable && (field.key === "title" || field.key === "question" || field.key === "answer" || field.key === "info");
    const modalFieldMin =
      field.editable && (field.key === "title" || field.key === "question" || field.key === "answer" || field.key === "info")
        ? fieldMinHeightPx(field.key)
        : 38;
    const modalFieldMax =
      field.editable && (field.key === "title" || field.key === "question" || field.key === "answer" || field.key === "info")
        ? fieldMaxHeightPx(field.key)
        : Number.POSITIVE_INFINITY;

    wrapper.appendChild(shouldPreviewFlags ? attachFlagPreviewOverlay(input, modalFieldMin, modalFieldMax) : input);
    inputEls[field.key] = input;
    if (input instanceof HTMLTextAreaElement) {
      input.addEventListener("keydown", (ev: KeyboardEvent) => {
        handleTabInTextarea(input, ev);
      });
    }
    if (field.key === "question" && input instanceof HTMLTextAreaElement && isClozeOnly) {
      attachClozeShortcuts(input);
      if (shouldShowMobileClozeButtons()) {
        wrapper.appendChild(createMobileClozeButtons(input));
      }
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
    const correctIdxSet = new Set(getCorrectIndices(card));

    const container = document.createElement("div");
    container.className = "flex flex-col gap-1";

    const label = document.createElement("label");
    label.className = "text-sm font-medium inline-flex items-center gap-1";
    label.textContent = tx("ui.browser.bulkEdit.mcq.answersAndOptions", "Answers and options");
    const mcqInfoIcon = document.createElement("span");
    mcqInfoIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground learnkit-info-icon-elevated";
    mcqInfoIcon.setAttribute("aria-label", tx("ui.browser.bulkEdit.mcq.correctHint", "Check the box next to each correct answer. At least one correct and one incorrect option required."));
    mcqInfoIcon.setAttribute("data-tooltip-position", "top");
    setIcon(mcqInfoIcon, "info");
    label.appendChild(mcqInfoIcon);
    container.appendChild(label);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "flex flex-col gap-2";
    container.appendChild(optionsContainer);

    type OptionRowEntry = { row: HTMLElement; input: HTMLInputElement; checkbox: HTMLInputElement; removeBtn: HTMLButtonElement };
    const optionRows: OptionRowEntry[] = [];

    const updateRemoveButtons = () => {
      const disable = optionRows.length <= 2;
      for (const entry of optionRows) {
        entry.removeBtn.disabled = disable;
        entry.removeBtn.setAttribute("aria-disabled", disable ? "true" : "false");
        entry.removeBtn.classList.toggle("is-disabled", disable);
      }
    };

    const addOptionRow = (value: string, isCorrect: boolean) => {
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 learnkit-edit-mcq-option-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isCorrect;
      checkbox.className = "learnkit-mcq-correct-checkbox";
      checkbox.setAttribute("aria-label", tx("ui.browser.bulkEdit.mcq.markCorrect", "Mark as correct answer"));
      checkbox.setAttribute("data-tooltip-position", "top");
      row.appendChild(checkbox);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "input flex-1 text-sm learnkit-input-fixed";
      input.placeholder = tx("ui.browser.bulkEdit.mcq.optionPlaceholder", "Enter an answer option");
      input.value = value;
      row.appendChild(attachFlagPreviewOverlay(input, 36, 36));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "inline-flex items-center justify-center h-9 w-9 p-0 learnkit-remove-btn-ghost";
      removeBtn.setAttribute("aria-label", tx("ui.browser.bulkEdit.mcq.removeOption", "Remove option"));
      removeBtn.setAttribute("data-tooltip-position", "top");
      const xIcon = document.createElement("span");
      xIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(xIcon, "x");
      removeBtn.appendChild(xIcon);
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (optionRows.length <= 2) return;
        const idx = optionRows.findIndex((entry) => entry.input === input);
        if (idx === -1) return;
        optionRows[idx].row.remove();
        optionRows.splice(idx, 1);
        updateRemoveButtons();
      });
      row.appendChild(removeBtn);

      optionsContainer.appendChild(row);
      optionRows.push({ row, input, checkbox, removeBtn });
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
    addInput.className = "input flex-1 text-sm learnkit-input-fixed";
    addInput.placeholder = tx("ui.browser.bulkEdit.mcq.addOptionPlaceholder", "Add another option (press enter)");
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
    addInputWrap.className = "flex items-center gap-2 learnkit-mcq-add-row";
    addInputWrap.appendChild(attachFlagPreviewOverlay(addInput, 36, 36));
    container.appendChild(addInputWrap);

    const buildValue = () => {
      const allOpts = optionRows
        .map((entry) => ({ text: String(entry.input.value || "").trim(), isCorrect: entry.checkbox.checked }))
        .filter((opt) => opt.text.length > 0);
      const corrects = allOpts.filter((o) => o.isCorrect);
      const wrongs = allOpts.filter((o) => !o.isCorrect);
      if (corrects.length < 1) {
        new Notice(tx("ui.browser.bulkEdit.notice.needOneCorrect", "At least one correct answer is required."));
        return null;
      }
      if (wrongs.length < 1) {
        new Notice(tx("ui.browser.bulkEdit.notice.needOneWrong", "Multiple-choice cards require at least one wrong option."));
        return null;
      }
      const rendered = allOpts.map((opt) =>
        opt.isCorrect ? `**${escapePipes(opt.text)}**` : escapePipes(opt.text),
      );
      return rendered.join(` ${getDelimiter()} `);
    };
    buildMcqValue = () => buildValue();

    return container;
  };

  const mcqSection = isSingleMcq ? createMcqEditor() : null;

  // ── Assemble the form ─────────────────────────────────────

  const topGrid = document.createElement("div");
  topGrid.className = "grid grid-cols-1 gap-3 md:grid-cols-2 learnkit-card-meta-grid";
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

  contentEl.appendChild(form);

  // ── Footer (Cancel / Save) ────────────────────────────────

  this.modalEl.querySelectorAll<HTMLElement>(":scope > .lk-modal-footer.learnkit-bulk-edit-footer").forEach((node) => node.remove());
  const footer = document.createElement("div");
  footer.className = "flex items-center justify-end gap-4 lk-modal-footer learnkit-card-creator-footer learnkit-bulk-edit-footer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "learnkit-btn-toolbar learnkit-btn-filter inline-flex items-center gap-2 h-9 px-3 text-sm";
  cancel.setAttribute("aria-label", tx("ui.common.cancel", "Cancel"));
  cancel.setAttribute("data-tooltip-position", "top");
  const cancelText = document.createElement("span");
  cancelText.textContent = tx("ui.common.cancel", "Cancel");
  cancel.appendChild(cancelText);
  cancel.addEventListener("click", () => this.close());
  const save = document.createElement("button");
  save.type = "button";
  save.className = "learnkit-btn-toolbar learnkit-btn-accent learnkit-bulk-edit-save-btn h-9 inline-flex items-center gap-2";
  save.setAttribute("aria-label", tx("ui.common.save", "Save"));
  save.setAttribute("data-tooltip-position", "top");
  const saveText = document.createElement("span");
  saveText.textContent = tx("ui.common.save", "Save");
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
    const hasTypeChange = canBulkToggleType && cards.some((card) => String(card.type ?? "") !== selectedBulkType);
    if (!Object.keys(updates).length && !hasTypeChange) {
      new Notice(tx("ui.browser.bulkEdit.notice.enterOneField", "Enter a value for at least one editable field."));
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
        if (canBulkToggleType && String(updated.type ?? "") !== selectedBulkType) {
          updated = ctx.applyValueToCard(updated, "type", selectedBulkType);
        }
        for (const [key, value] of Object.entries(updates)) {
          updated = ctx.applyValueToCard(updated, key as ColKey, value);
        }
        await ctx.writeCardToMarkdown(updated);
      }
      this.close();
    } catch (err: unknown) {
      new Notice(`${err instanceof Error ? err.message : String(err)}`);
    }
  })(); });
  footer.appendChild(cancel);
  footer.appendChild(save);
  this.modalEl.appendChild(footer);
  }

  onClose() {
    for (const fn of this.closeCleanup.splice(0)) {
      try {
        fn();
      } catch {
        // Best-effort teardown; avoid blocking modal close.
      }
    }
    this.contentEl.empty();
  }
}

// ── Convenience wrapper ────────────────────────────────────

/**
 * Creates and opens a BulkEditModal for the given cards.
 * Drop-in replacement for the old function-based overlay.
 */
export function openBulkEditModal(app: App, cards: CardRecord[], ctx: BulkEditContext): void {
  new BulkEditModal(app, cards, ctx).open();
}
