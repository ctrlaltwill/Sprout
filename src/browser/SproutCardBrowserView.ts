/**
 * browser/SproutCardBrowserView.ts
 * ─────────────────────────────────
 * The Flashcard Browser view — a spreadsheet-style table for searching,
 * filtering, editing, and bulk-managing all cards in the vault.
 *
 * Renamed from BootCampCardBrowserView → SproutCardBrowserView as part
 * of the "no Boot Camp naming" refactor.
 *
 * Standalone helper functions, types, and constants have been extracted
 * to ./browser-helpers.ts.
 */

// src/browser.ts
import { ItemView, Notice, TFile, type WorkspaceLeaf, setIcon } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND, VIEW_TYPE_ANALYTICS, VIEW_TYPE_BROWSER, VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../core/constants";
import type { CardRecord, CardState } from "../core/store";
import { syncOneFile } from "../sync/sync-engine";
import { unsuspendCard, suspendCard } from "../scheduler/scheduler";
import { getGroupIndex, normaliseGroupPath } from "../indexes/groupIndex";
import { ImageOcclusionCreatorModal } from "../modals/ImageOcclusionCreatorModal";
import { refreshAOS } from "../core/aos-loader";

// ✅ shared header (you placed it at src/header.ts)
import { SproutHeader, type SproutHeaderPage } from "../components/header";

// ✅ moved helpers
import { fmtGroups, coerceGroups } from "../indexes/groupFormat";
import {
  buildAnswerOrOptionsFor,
  buildQuestionFor,
  escapePipes,
  parseMcqOptionsFromCell,
  validateClozeText,
} from "../reviewer/Fields";
import { stageLabel } from "../reviewer/Labels";
import { findCardBlockRangeById } from "../reviewer/MarkdownBlock";

import {
  type TypeFilter,
  type StageFilter,
  type DueFilter,
  type ColKey,
  type SortKey,
  type ParsedSearch,
  type DropdownOption,
  type DropdownMenuController,
  DEFAULT_COL_WIDTHS,
  PLACEHOLDER_TITLE,
  PLACEHOLDER_CLOZE,
  PLACEHOLDER_QUESTION,
  PLACEHOLDER_ANSWER,
  PLACEHOLDER_INFO,
  CLOZE_ANSWER_HELP,
  clearNode,
  forceWrapStyles,
  forceCellClip,
  applyStickyThStyles,
  fmtDue,
  fmtLocation,
  titleCaseGroupPath,
  normalizeGroupPathInput,
  formatGroupDisplay,
  expandGroupAncestors,
  parseGroupsInput,
  groupsToInput,
  escapePipeText,
  pushPipeField,
  buildCardBlockPipeMarkdown,
  startOfTodayMs,
  endOfTodayMs,
  typeLabelBrowser,
  escapeHtml,
  stripWikiImageSyntax,
  tryResolveToResourceSrc,
  getIoResolvedImage,
  extractOcclusionLabels,
  renderOcclusionBadgesHtml,
  buildIoImgHtml,
  buildIoOccludedHtml,
  searchText,
  parseSearchQuery,
} from "./browser-helpers";

export class SproutCardBrowserView extends ItemView {
  plugin: SproutPlugin;

  query = "";
  typeFilter: TypeFilter = "all";
  stageFilter: StageFilter = "all";
  dueFilter: DueFilter = "all";

  sortKey: SortKey = "title";
  sortAsc = true;

  pageSize = 25;
  pageIndex = 0;

  private _rowHeightPx = 150;
  private _editorHeightPx = 126;

  private _cellTextClass = "text-sm leading-snug";
  private _readonlyTextClass = "text-sm leading-snug";

  // kept (class-based), but wrapping is enforced via inline !important styles
  private _cellWrapClass = "whitespace-normal break-words overflow-hidden";

  colWidths: Record<ColKey, number> = { ...DEFAULT_COL_WIDTHS };

  private _colMin: Record<ColKey, number> = {
    id: 100,
    type: 110,
    stage: 80,
    due: 90,

    title: 140,
    question: 140,
    answer: 140,

    info: 150,
    location: 150,
    groups: 200,
  };

  private _colMax: Record<ColKey, number> = {
    id: 500,
    type: 500,
    stage: 500,
    due: 500,
      options: [
        { v: "all", label: "All due dates" },
        { v: "due", label: "Due now" },
        { v: "today", label: "Due today" },
        { v: "later", label: "Later" },
      ],
    location: 500,
    groups: 500,
  };

  private _tableBody: HTMLTableSectionElement | null = null;
  private _headerEls: Partial<Record<SortKey, HTMLTableCellElement>> = {};
  private _headerSortIcons: Partial<Record<SortKey, SVGSVGElement>> = {};
  private _colEls: Partial<Record<ColKey, HTMLTableColElement>> = {};
  private _colCount = 10;
  private _allCols: ColKey[] = ["id", "type", "stage", "due", "title", "question", "answer", "info", "location", "groups"];
  private _visibleCols = new Set<ColKey>(this._allCols);

  private _saving = new Set<string>();
  private _suppressHeaderClickUntil = 0;

  private _summaryEl: HTMLElement | null = null;
  private _selectionCountEl: HTMLElement | null = null;
  private _selectedIds = new Set<string>();
  private _lastShiftSelectionIndex: number | null = null;
  private _currentPageRowIds: string[] = [];
  private _selectAllCheckboxEl: HTMLInputElement | null = null;
  private _editButton: HTMLButtonElement | null = null;
  private _suspendButton: HTMLButtonElement | null = null;
  private _clearSelectionEl: HTMLElement | null = null;
  private _clearSelectionPlaceholderEl: HTMLElement | null = null;
  private _searchInputEl: HTMLInputElement | null = null;
  private _unsuspending = new Set<string>();
  private _resetFiltersButton: HTMLButtonElement | null = null;
  private _filtersDirty = false;
  private _typeFilterMenu: DropdownMenuController<TypeFilter> | null = null;
  private _stageFilterMenu: DropdownMenuController<StageFilter> | null = null;
  private _dueFilterMenu: DropdownMenuController<DueFilter> | null = null;

  private _pagerHostEl: HTMLElement | null = null;
  private _tableWrapEl: HTMLElement | null = null;
  private _lastScrollLeft = 0;
  private _lastScrollTop = 0;
  private _emptyStateCleanup: (() => void) | null = null;

  // Removed: private _isWideTable = false; (now using plugin.isWideMode)
  private _rootEl: HTMLElement | null = null;
  private _shouldShowAos = true;

  private _constrainedMaxWidth = "900px";
  private _constrainedWidth = "90%";

  // ✅ shared view header renderer
  private _header: SproutHeader | null = null;

  // ✅ popover cleanup for all filter dropdowns + page-size dropdown
  private _uiCleanups: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_BROWSER;
  }

  getDisplayText() {
    return "Flashcards";
  }

  getIcon() {
    return "table-2";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    try {
      this._header?.dispose?.();
    } catch {}
    this._header = null;

    this._disposeUiPopovers();
  }

  onRefresh() {
    if (this._tableBody) {
      this._captureScrollPosition();
      this.refreshTable();
      return;
    }
    this.render();
  }

  private _disposeUiPopovers() {
    const fns = this._uiCleanups.splice(0, this._uiCleanups.length);
    for (const fn of fns) {
      try {
        fn();
      } catch {}
    }
    this._typeFilterMenu = null;
    this._stageFilterMenu = null;
    this._dueFilterMenu = null;
  }

  private _wideLabel(): string {
    return this.plugin.isWideMode ? "Collapse table" : "Expand table";
  }

  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    const root = this._rootEl;
    if (root) {
      if (this.plugin.isWideMode) {
        root.style.setProperty("max-width", "none", "important");
        root.style.setProperty("width", "100%", "important");
      } else {
        root.style.setProperty("max-width", "1080px", "important");
        root.style.setProperty("width", "100%", "important");
      }
      root.style.setProperty("margin-left", "auto", "important");
      root.style.setProperty("margin-right", "auto", "important");
    }

    // keep header button label in sync
    try {
      this._header?.updateWidthButtonLabel?.();
    } catch {}
  }

  private _setSelection(id: string, selected: boolean): boolean {
    const had = this._selectedIds.has(id);
    if (selected) {
      if (had) return false;
      this._selectedIds.add(id);
      return true;
    } else {
      if (!had) return false;
      this._selectedIds.delete(id);
      return true;
    }
  }

  private _clearSelection() {
    if (this._selectedIds.size === 0) return;
    const ids = Array.from(this._selectedIds);
    for (const id of ids) {
      this._setSelection(id, false);
    }
    this._syncRowCheckboxes();
    this._updateSelectionIndicator();
    this._updateSelectAllCheckboxState();
  }

  private _updateSelectionIndicator() {
    if (this._selectionCountEl) {
      const count = this._selectedIds.size;
      this._selectionCountEl.textContent = count === 0 ? "No cards selected" : `${count.toLocaleString()} selected`;
      if (this._clearSelectionEl) {
        const active = count > 0;
        this._clearSelectionEl.style.setProperty("display", active ? "" : "none", "important");
        this._clearSelectionEl.style.setProperty("pointer-events", active ? "auto" : "none", "important");
      }
      if (this._clearSelectionPlaceholderEl) {
        const active = count === 0;
        this._clearSelectionPlaceholderEl.style.setProperty(
          "visibility",
          active ? "visible" : "hidden",
          "important",
        );
      }
    }
    this._updateEditButtonState();
    this._updateSuspendButtonState();
  }

  private _updateEditButtonState() {
    if (!this._editButton) return;
    const enabled = this._selectedIds.size > 0;
    this._editButton.disabled = !enabled;
    this._editButton.style.setProperty("opacity", enabled ? "1" : "0.6", "important");
  }

  private _updateSuspendButtonState() {
    if (!this._suspendButton) return;
    const ids = Array.from(this._selectedIds);
    const actionable = ids.filter((id) => !this.plugin.store.isQuarantined(id));
    const enabled = actionable.length > 0;
    this._suspendButton.disabled = !enabled;
    this._suspendButton.style.setProperty("opacity", enabled ? "1" : "0.6", "important");
    clearNode(this._suspendButton);
    const allSuspended = enabled && actionable.every((id) => {
      const s = this.plugin.store.getState(id);
      return !!s && (s as any).stage === "suspended";
    });
    const mode = allSuspended ? "unsuspend" : "suspend";
    this._suspendButton.setAttribute("data-mode", mode);
    const icon = document.createElement("span");
    icon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(icon, mode === "unsuspend" ? "circle-play" : "circle-pause");
    icon.style.setProperty("transform", "scale(0.85)");
    this._suspendButton.appendChild(icon);
    const text = document.createElement("span");
    text.textContent = mode === "unsuspend" ? "Unsuspend" : "Suspend";
    this._suspendButton.appendChild(text);
  }

  private _updateSelectAllCheckboxState() {
    const checkbox = this._selectAllCheckboxEl;
    if (!checkbox) return;
    const total = this._currentPageRowIds.length;
    if (total === 0) {
      checkbox.checked = false;
      checkbox.indeterminate = false;
      return;
    }
    const selectedOnPage = this._currentPageRowIds.filter((id) => this._selectedIds.has(id)).length;
    checkbox.checked = selectedOnPage > 0 && selectedOnPage === total;
    checkbox.indeterminate = selectedOnPage > 0 && selectedOnPage < total;
  }

  private _markFiltersDirty() {
    const dirty =
      Boolean(this.query) ||
      this.typeFilter !== "all" ||
      this.stageFilter !== "all" ||
      this.dueFilter !== "all";
    if (dirty === this._filtersDirty) return;
    this._filtersDirty = dirty;
    this._updateResetFiltersButtonState();
  }

  private _updateResetFiltersButtonState() {
    if (!this._resetFiltersButton) return;
    const active = this._filtersDirty;
    this._resetFiltersButton.disabled = !active;
    this._resetFiltersButton.style.setProperty("opacity", active ? "1" : "0.6", "important");
  }

  private _resetFilters(refreshTable = true) {
    this.query = "";
    this.typeFilter = "all";
    this.stageFilter = "all";
    this.dueFilter = "all";
    this.pageIndex = 0;
    this.colWidths = { ...DEFAULT_COL_WIDTHS };
    if (this._searchInputEl) this._searchInputEl.value = "";
    this._typeFilterMenu?.setValue("all");
    this._stageFilterMenu?.setValue("all");
    this._dueFilterMenu?.setValue("all");
    this._filtersDirty = false;
    this._updateResetFiltersButtonState();
    if (refreshTable) this.refreshTable();
  }

  private _syncRowCheckboxes() {
    if (!this._tableBody) return;
    this._tableBody.querySelectorAll<HTMLInputElement>("input[data-card-id]").forEach((checkbox) => {
      const id = checkbox.getAttribute("data-card-id");
      if (!id) return;
      checkbox.checked = this._selectedIds.has(id);
    });
  }

  private _captureScrollPosition() {
    if (!this._tableWrapEl) return;
    this._lastScrollLeft = this._tableWrapEl.scrollLeft;
    this._lastScrollTop = this._tableWrapEl.scrollTop;
  }

  // ------------------------------------------------------------

  // Basecoat-styled dropdown (body-portal) — replaces <select>
  //
  // IMPORTANT FIX:
  // - Do NOT use class "dropdown-menu" or data-popover semantics here.
  //   Basecoat dropdown-menu.js may attach and interfere with custom toggling.
  // ------------------------------------------------------------

  private _makeDropdownMenu<T extends string>(args: {
    label: string; // used for tooltip
    value: T;
    options: Array<DropdownOption<T>>;
    onChange: (v: T) => void;
    widthPx?: number;
    dropUp?: boolean; // <-- added for dropUp support
  }): { root: HTMLElement; setValue: (v: T) => void; dispose: () => void } {
    const id = `sprout-dd-${Math.random().toString(36).slice(2, 9)}`;

    const root = document.createElement("div");
    root.id = id;
    root.className = "relative inline-flex";
    root.style.setProperty("overflow", "visible", "important");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `${id}-trigger`;
    trigger.className = "btn-outline h-9 px-3 text-sm inline-flex items-center gap-2";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-tooltip", args.label);
    trigger.style.setProperty("pointer-events", "auto", "important");
    root.appendChild(trigger);

    const trigText = document.createElement("span");
    trigText.className = "truncate";
    trigger.appendChild(trigText);

    const chevron = document.createElement("span");
    chevron.className = "inline-flex items-center justify-center [&_svg]:size-4";
    chevron.setAttribute("aria-hidden", "true");
    setIcon(chevron, "chevron-down");
    trigger.appendChild(chevron);

    let current = args.value;

    const labelFor = (v: T) => args.options.find((o) => o.v === v)?.label ?? String(v);

    // Body-portal popover (fixed) avoids clipping/z-index issues in Obsidian panes.
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.setAttribute("aria-hidden", "true");

    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "999999", "important");
    popover.style.setProperty("display", "none", "important");
    popover.style.setProperty("pointer-events", "auto", "important");

    const panel = document.createElement("div");
    panel.className = "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1";
    panel.style.setProperty("pointer-events", "auto", "important");
    popover.appendChild(panel);
    sproutWrapper.appendChild(popover);

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.id = `${id}-menu`;
    
    menu.className = "flex flex-col";
    panel.appendChild(menu);

    const items: Array<{ v: T; el: HTMLElement }> = [];

    const setChecked = (item: HTMLElement, checked: boolean) => {
      item.setAttribute("aria-checked", checked ? "true" : "false");
    };

    const buildItems = () => {
      clearNode(menu);
      items.length = 0;

      for (const opt of args.options) {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", opt.v === current ? "true" : "false");
        item.tabIndex = 0;

        item.className = (
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        );

        const dotWrap = document.createElement("div");
        dotWrap.className = "size-4 flex items-center justify-center";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
        dot.setAttribute("aria-hidden", "true");
        dotWrap.appendChild(dot);

        const txt = document.createElement("span");
        txt.textContent = opt.label;
        item.appendChild(txt);

        if (opt.hint) {
          const hint = document.createElement("span");
          hint.className = "text-muted-foreground ml-auto text-sm tracking-wide";
          hint.textContent = opt.hint;
          item.appendChild(hint);
        }

        const activate = () => {
          current = opt.v;
          trigText.textContent = labelFor(current);

          for (const it of items) setChecked(it.el, it.v === current);

          // keep existing behaviour: filter changes reset to page 1
          this.pageIndex = 0;
          args.onChange(current);
          close();
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
            close();
            trigger.focus();
          }
        });

        menu.appendChild(item);
        items.push({ v: opt.v, el: item });
      }
    };

    const place = () => {
      const r = trigger.getBoundingClientRect();
      const margin = 8;
      const width = Math.max(220, args.widthPx ?? 240);

      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));

      // measure panel height after attached so we can optionally place above (dropUp)
      const panelRect = panel.getBoundingClientRect();
      let top: number;
      if (args.dropUp) {
        top = Math.max(margin, r.top - panelRect.height - 6);
      } else {
        top = Math.max(margin, Math.min(r.bottom + 6, window.innerHeight - margin));
      }

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.width = `${width}px`;
    };

    let cleanup: (() => void) | null = null;

    const close = () => {
      trigger.setAttribute("aria-expanded", "false");
      popover.setAttribute("aria-hidden", "true");
      popover.style.setProperty("display", "none", "important");

      try {
        cleanup?.();
      } catch {}
      cleanup = null;

      // Instead of removing popover, detach sproutWrapper from body if present
      if (sproutWrapper.parentNode === document.body) {
        document.body.removeChild(sproutWrapper);
      }
    };

    const open = () => {
      buildItems();

      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.style.setProperty("display", "block", "important");

      document.body.appendChild(sproutWrapper);

      // place after attach (more reliable)
      requestAnimationFrame(() => place());

      const onResizeOrScroll = () => place();

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (root.contains(t) || popover.contains(t)) return;
        close();
      };

      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        trigger.focus();
      };

      window.addEventListener("resize", onResizeOrScroll, true);
      window.addEventListener("scroll", onResizeOrScroll, true);

      // attach outside listeners next tick (avoid self-close on opening event)
      const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
      }, 0);

      cleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    // ✅ pointerdown is more robust in Obsidian panes than click
    trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      const isOpen = trigger.getAttribute("aria-expanded") === "true";
      if (isOpen) close();
      else open();
    });

    const setValue = (v: T) => {
      current = v;
      trigText.textContent = labelFor(current);
    };

    // initial label
    trigText.textContent = labelFor(current);

    const dispose = () => close();

    return { root, setValue, dispose };
  }

  private _applyColumnVisibility() {
    if (!this._rootEl) return;
    const table = this._rootEl.querySelector("table");
    if (!table) return;

    for (const col of this._allCols) {
      const show = this._visibleCols.has(col);
      const display = show ? "" : "none";

      const colEl = this._colEls[col];
      if (colEl) colEl.style.display = display;

      table.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
        (el as HTMLElement).style.display = display;
      });
    }
  }

  private _makeColumnsDropdown(args: {
    label: string;
    options: Array<{ v: ColKey; label: string }>;
    widthPx?: number;
    autoCloseMs?: number;
  }): { root: HTMLElement; dispose: () => void } {
    const id = `sprout-cols-${Math.random().toString(36).slice(2, 9)}`;
    const autoCloseMs = Math.max(0, Math.floor(args.autoCloseMs ?? 10000));

    const root = document.createElement("div");
    root.id = id;
    root.className = "relative inline-flex";
    root.style.setProperty("overflow", "visible", "important");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `${id}-trigger`;
    trigger.className = "btn-outline h-9 px-3 text-sm inline-flex items-center gap-2";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-tooltip", args.label);
    root.appendChild(trigger);

    const trigIcon = document.createElement("span");
    trigIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    trigIcon.setAttribute("aria-hidden", "true");
    setIcon(trigIcon, "columns-2");
    trigger.appendChild(trigIcon);

    const trigText = document.createElement("span");
    trigText.className = "truncate";
    trigText.textContent = args.label;
    trigger.appendChild(trigText);


    // Create a single .sprout wrapper around the popover menu
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";

    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.className = "";
    popover.setAttribute("aria-hidden", "true");
    popover.style.setProperty("position", "fixed", "important");
    popover.style.setProperty("z-index", "999999", "important");
    popover.style.setProperty("display", "none", "important");
    popover.style.setProperty("pointer-events", "auto", "important");

    const panel = document.createElement("div");
    panel.className = "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0";
    panel.style.setProperty("pointer-events", "auto", "important");
    panel.style.setProperty("padding", "6px", "important");
    popover.appendChild(panel);

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.id = `${id}-menu`;
    menu.setAttribute("data-tooltip", trigger.id);
    menu.className = "flex flex-col";
    panel.appendChild(menu);

    sproutWrapper.appendChild(popover);

    const items: Array<{ v: ColKey; el: HTMLElement }> = [];

    const setChecked = (item: HTMLElement, checked: boolean) => {
      item.setAttribute("aria-checked", checked ? "true" : "false");
    };

    const buildItems = () => {
      clearNode(menu);
      items.length = 0;

      for (const opt of args.options) {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemcheckbox");
        item.setAttribute("aria-checked", this._visibleCols.has(opt.v) ? "true" : "false");
        item.tabIndex = 0;
        item.className = (
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        );

        const tickWrap = document.createElement("div");
        tickWrap.className = "size-4 flex items-center justify-center";
        item.appendChild(tickWrap);

        const tick = document.createElement("div");
        tick.className = "inline-flex items-center justify-center invisible group-aria-checked:visible";
        tick.setAttribute("aria-hidden", "true");
        setIcon(tick, "check");
        tickWrap.appendChild(tick);

        const txt = document.createElement("span");
        txt.textContent = opt.label;
        item.appendChild(txt);

        const toggle = () => {
          const next = new Set(this._visibleCols);
          if (next.has(opt.v)) next.delete(opt.v);
          else next.add(opt.v);

          if (next.size === 0) return;
          this._visibleCols = next;
          setChecked(item, next.has(opt.v));
          this._applyColumnVisibility();
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggle();
          armAutoClose();
        });

        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            toggle();
            armAutoClose();
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
          }
        });

        menu.appendChild(item);
        items.push({ v: opt.v, el: item });
      }
    };

    const place = () => {
      const r = trigger.getBoundingClientRect();
      const margin = 8;
      const width = Math.max(220, args.widthPx ?? 260);
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      const panelRect = panel.getBoundingClientRect();
      const top = Math.max(margin, Math.min(r.bottom + 6, window.innerHeight - panelRect.height - margin));

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.width = `${width}px`;
    };

    let cleanup: (() => void) | null = null;
    let autoCloseTimer: number | null = null;

    const armAutoClose = () => {
      if (!autoCloseMs) return;
      if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
      autoCloseTimer = window.setTimeout(() => close(), autoCloseMs);
    };

    const close = () => {
      trigger.setAttribute("aria-expanded", "false");
      popover.setAttribute("aria-hidden", "true");
      popover.style.setProperty("display", "none", "important");

      try {
        cleanup?.();
      } catch {}
      cleanup = null;

      if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
      autoCloseTimer = null;

      try {
        sproutWrapper.remove();
      } catch {}
    };

    const open = () => {
      buildItems();

      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.style.setProperty("display", "block", "important");

      document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => place());
      armAutoClose();

      const onResizeOrScroll = () => place();
      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (root.contains(t) || popover.contains(t)) return;
        close();
      };
      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        trigger.focus();
      };

      window.addEventListener("resize", onResizeOrScroll, true);
      window.addEventListener("scroll", onResizeOrScroll, true);

      const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
      }, 0);

      cleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      const isOpen = trigger.getAttribute("aria-expanded") === "true";
      if (isOpen) close();
      else open();
    });

    const dispose = () => close();
    return { root, dispose };
  }

  private getStateFor(id: string): CardState | null {
    return this.plugin.store.getState(id);
  }

  private async unsuspendById(id: string) {
    if (this._unsuspending.has(id)) return;

    const st = this.plugin.store.getState(id);
    if (!st || (st as any).stage !== "suspended") return;

    this._unsuspending.add(id);

    try {
      const now = Date.now();
      const next = unsuspendCard(st as any, now);
      this.plugin.store.upsertState(next as any);
      await this.plugin.store.persist();

      new Notice("Unsuspended card");
      this.refreshTable();
    } catch (err: any) {
      new Notice(`${BRAND}: ${err?.message || String(err)}`);
    } finally {
      this._unsuspending.delete(id);
    }
  }

  private computeRows(): Array<{ card: CardRecord; state: CardState | null; dueMs: number | null }> {
    const parsed = parseSearchQuery(this.query || "");
    const textQ = (parsed.text || "").trim().toLowerCase();
    const groupFilters = parsed.groups || [];
    const typeFiltersFromQuery = (parsed.types || []).map((t) => t.toLowerCase()).filter(Boolean);

    const now = Date.now();
    const sToday = startOfTodayMs();
    const eToday = endOfTodayMs();
    const quarantine = (this.plugin.store.data.quarantine || {}) as Record<string, any>;
    const includeQuarantined = true;

    let baseCards: CardRecord[] = [];

    if (groupFilters.length) {
      const cardsObj = (this.plugin.store.data.cards || {}) as Record<string, CardRecord>;

      if (includeQuarantined) {
        const matchesGroups = (card: CardRecord) => {
          const groups = coerceGroups((card as any).groups)
            .map((g) => normaliseGroupPath(g) || null)
            .filter((x): x is string => !!x);
          if (!groups.length) return false;
          return groupFilters.every((g) => groups.some((cg) => cg === g || cg.startsWith(`${g}/`)));
        };

        baseCards = Object.values(cardsObj).filter((c) => matchesGroups(c));
      } else {
        const gx = getGroupIndex(this.plugin as any);

        let idSet: Set<string> | null = null;
        for (const g of groupFilters) {
          const ids = gx.getIds(g);
          if (!idSet) idSet = new Set<string>(ids);
          else {
            const next = new Set<string>();
            for (const id of idSet) if (ids.has(id)) next.add(id);
            idSet = next;
          }
        }

        for (const id of idSet || []) {
          if (quarantine[String(id)]) continue;
          const c = cardsObj[String(id)];
          if (c) baseCards.push(c);
        }
      }
    } else {
      if (includeQuarantined) baseCards = Object.values(this.plugin.store.data.cards || {});
      else baseCards = this.plugin.store.getAllCards();
    }

    baseCards = baseCards.filter(
      (c) => !["io-child", "cloze-child"].includes(String((c as any)?.type || "")),
    );

    if (includeQuarantined && groupFilters.length === 0) {
      const seenIds = new Set(baseCards.map((c) => String(c.id)));
      for (const id of Object.keys(quarantine)) {
        if (seenIds.has(String(id))) continue;
        const entry = quarantine[String(id)];
        baseCards.push({
          id: String(id),
          type: "basic",
          title: null,
          q: null,
          a: null,
          info: entry?.reason ? `Quarantine: ${entry.reason}` : "Quarantined card",
          groups: null,
          sourceNotePath: entry?.notePath || "",
          sourceStartLine: Number(entry?.sourceStartLine) || 0,
        });
      }
    }

    let rows = baseCards.map((c) => {
      const st = this.getStateFor(String(c.id));
      const quarantined = !!quarantine[String(c.id)];
      const stage = quarantined ? "quarantined" : String((st as any)?.stage || "new");
      const dueMs = quarantined || stage === "suspended" ? null : (st?.due ?? null);
      return { card: c, state: st, dueMs };
    });

    if (!includeQuarantined) rows = rows.filter((r) => !quarantine[String(r.card.id)]);

    if (this.typeFilter !== "all") rows = rows.filter((r) => String(r.card.type) === this.typeFilter);

    if (typeFiltersFromQuery.length) {
      rows = rows.filter((r) => typeFiltersFromQuery.includes(String(r.card.type || "").toLowerCase()));
    }

    if (this.stageFilter !== "all") {
      if (this.stageFilter === "quarantined") {
        rows = rows.filter((r) => !!quarantine[String(r.card.id)]);
      } else {
        rows = rows.filter((r) => ((r.state?.stage || "new") as any) === this.stageFilter);
      }
    }

    if (this.dueFilter !== "all") {
      rows = rows.filter((r) => {
        const due = r.dueMs;
        if (quarantine[String(r.card.id)]) return false;
        if (due == null || !Number.isFinite(due)) return this.dueFilter === "later";
        if (this.dueFilter === "due") return due <= now;
        if (this.dueFilter === "today") return due >= sToday && due <= eToday;
        return due > eToday;
      });
    }

    if (textQ) rows = rows.filter((r) => searchText(r.card).includes(textQ));

    const dir = this.sortAsc ? 1 : -1;
    const key = this.sortKey;

    rows.sort((a, b) => {
      const av = this.sortValueFor(a.card, a.state, a.dueMs, key);
      const bv = this.sortValueFor(b.card, b.state, b.dueMs, key);

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    return rows;
  }

  private sortValueFor(
    card: CardRecord,
    state: CardState | null,
    dueMs: number | null,
    key: SortKey,
  ): string | number {
    if (key === "due") return dueMs ?? Number.POSITIVE_INFINITY;
    if (key === "id") return card.id;
    if (key === "type") return typeLabelBrowser(card.type);
    if (key === "stage") {
      if (this.plugin.store.isQuarantined(card.id)) return "Quarantined";
      return stageLabel(String((state as any)?.stage || "new"));
    }
    if (key === "location") return card.sourceNotePath || "";
    if (key === "groups") return fmtGroups((card as any).groups);
    if (key === "title") return (card.title || "").split(/\r?\n/)[0] || "";
    if (key === "question" ) return buildQuestionFor(card);
    if (key === "answer" ) return card.type === "cloze" ? "" : buildAnswerOrOptionsFor(card);
    if (key === "info" ) return card.info || "";
    return "";
  }

  private _refreshHeaderSortStyles() {
    for (const k of Object.keys(this._headerEls) as SortKey[]) {
      const th = this._headerEls[k];
      if (!th) continue;

      const isSorted = k === this.sortKey;
      th.classList.toggle("text-foreground", isSorted);
      th.classList.toggle("text-muted-foreground", !isSorted);
      th.classList.toggle("font-semibold", isSorted);
      th.classList.toggle("sprout-browser-header-active", isSorted);

      th.setAttribute("aria-sort", isSorted ? (this.sortAsc ? "ascending" : "descending") : "none");

      const icon = this._headerSortIcons[k];
      if (icon) {
        icon.style.display = isSorted ? "inline-flex" : "none";
        icon.style.opacity = isSorted ? "1" : "0";
        const rotation = isSorted && !this.sortAsc ? "rotate(180deg)" : "rotate(0deg)";
        icon.style.transform = `${rotation}`;
      }
    }
  }

  private toggleSort(key: SortKey) {
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else {
      this.sortKey = key;
      this.sortAsc = true;
    }
    this._refreshHeaderSortStyles();
    this.refreshTable();
  }

  private applyValueToCard(card: CardRecord, col: ColKey, value: string): CardRecord {
    const draft: CardRecord = JSON.parse(JSON.stringify(card));
    const v = value ?? "";

    if (col === "title") {
      draft.title = v;
      return draft;
    }

    if (col === "question") {
      if (draft.type === "io") return draft;
      if (draft.type === "basic") draft.q = v;
      else if (draft.type === "mcq") draft.stem = v;
      else if (draft.type === "cloze") draft.clozeText = v;
      else if (draft.type === "io") (draft as any).prompt = v;
      return draft;
    }

    if (col === "answer") {
      if (draft.type === "io") return draft;

      if (draft.type === "basic") {
        draft.a = v;
        return draft;
      }
      if (draft.type === "mcq") {
        const parsed = parseMcqOptionsFromCell(v);
        draft.options = parsed.options;
        draft.correctIndex = parsed.correctIndex;
        return draft;
      }
      return draft;
    }

    if (col === "info") {
      draft.info = v;
      return draft;
    }

    if (col === "groups") {
      const groups = parseGroupsInput(v);
      draft.groups = groups.length ? groups : null;
      return draft;
    }

    return draft;
  }

  private async openSource(card: CardRecord) {
    const link = `${card.sourceNotePath}#^sprout-${card.id}`;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.app.workspace.openLinkText(link, card.sourceNotePath, true);
  }

  private async writeCardToMarkdown(card: CardRecord) {
    this._captureScrollPosition();
    const file = this.app.vault.getAbstractFileByPath(card.sourceNotePath);
    if (!(file instanceof TFile)) throw new Error(`Source note not found: ${card.sourceNotePath}`);

    if (card.type === "basic") {
      if (!(card.q || "").trim()) throw new Error("Q: is required.");
      if (!(card.a || "").trim()) throw new Error("A: is required.");
    } else if (card.type === "cloze") {
      validateClozeText(card.clozeText || "");
    } else if (card.type === "mcq") {
      if (!(card.stem || "").trim()) throw new Error("MCQ: is required.");
      const opts = Array.isArray(card.options)
        ? card.options.map((x) => (x || "").trim()).filter(Boolean)
        : [];
      if (opts.length < 2) throw new Error("MCQ requires at least 2 options.");
      if (
        !(
          Number.isFinite(card.correctIndex) &&
          (card.correctIndex as number) >= 0 &&
          (card.correctIndex as number) < opts.length
        )
      ) {
        throw new Error("MCQ requires exactly one correct option.");
      }
      card.options = opts;
    }

    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);

    const { start, end } = findCardBlockRangeById(lines, card.id);

    const block = buildCardBlockPipeMarkdown(card.id, card);
    lines.splice(start, end - start, ...block);

    await this.app.vault.modify(file, lines.join("\n"));

    const res = await syncOneFile(this.plugin, file);

    if (res.quarantinedCount > 0) {
      new Notice(`Saved changes to flashcards (but ${res.quarantinedCount} card(s) quarantined).`);
    } else {
      new Notice("Saved changes to flashcards");
    }

    this.refreshTable();

    const refreshLeaves = (leaves: WorkspaceLeaf[], skipLeaf?: WorkspaceLeaf) => {
      for (const leaf of leaves) {
        if (skipLeaf && leaf === skipLeaf) continue;
        (leaf.view as any)?.onRefresh?.();
      }
    };

    const ws = this.app.workspace;
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_REVIEWER));
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_WIDGET));
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_ANALYTICS));
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_BROWSER), this.leaf);
  }

  private _readCardField(card: CardRecord, col: ColKey): string {
    if (col === "id") return String(card.id);
    if (col === "type") return typeLabelBrowser(card.type);
    if (col === "stage") {
      if (this.plugin.store.isQuarantined(card.id)) return "Quarantined";
      const st = this.plugin.store.getState(card.id);
      const stage = (st as any)?.stage || "new";
      return stageLabel(String(stage));
    }
    if (col === "due") {
      const st = this.plugin.store.getState(card.id);
      if (this.plugin.store.isQuarantined(card.id)) return "Quarantined";
      if (st && Number.isFinite((st as any).due)) {
        return fmtDue((st as any).due);
      }
      return "—";
    }
    if (col === "title") return (card.title || "").split(/\r?\n/)[0] || "";
    if (col === "question") return buildQuestionFor(card);
    if (col === "answer") return card.type === "cloze" ? "" : buildAnswerOrOptionsFor(card);
    if (col === "info") return card.info || "";
    if (col === "location") return fmtLocation(card.sourceNotePath);
    if (col === "groups") return fmtGroups((card as any).groups);
    return "";
  }

  private _openIoEditor(cardId: string) {
    try {
      const cards = (this.plugin.store.data.cards || {}) as Record<string, CardRecord>;
      const raw = cards[String(cardId)] as any;
      const parentId = raw && String(raw.type) === "io-child" ? String(raw.parentId || "") : String(cardId);
      ImageOcclusionCreatorModal.openForParent(this.plugin, parentId, {
        onClose: () => {
          // Refresh the table after IO editor closes to show any changes
          this._refresh();
        },
      });
    } catch (e: any) {
      new Notice(`${BRAND}: Failed to open IO editor (${String(e?.message || e)})`);
    }
  }

  private _openBulkEditModal() {
    if (this._selectedIds.size === 0) return;

    const cardsMap = (this.plugin.store.data.cards || {}) as Record<string, CardRecord>;
    const cards = Array.from(this._selectedIds)
      .map((id) => cardsMap[id])
      .filter((card): card is CardRecord => !!card);
    if (!cards.length) return;

    // If single IO card selected, open IO editor instead
    if (cards.length === 1 && (cards[0].type === "io" || cards[0].type === "io-child")) {
      this._openIoEditor(cards[0].id);
      return;
    }

    // Create a .sprout wrapper for the overlay
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout sprout-modal-container sprout-modal-dim";

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 flex items-center justify-center";
    overlay.style.setProperty("position", "fixed", "important");
    overlay.style.setProperty("inset", "0", "important");
    overlay.style.setProperty("z-index", "1000000", "important");

    const backdrop = document.createElement("div");
    backdrop.className = "modal-bg";
    backdrop.style.setProperty("position", "absolute", "important");
    backdrop.style.setProperty("inset", "0", "important");
    overlay.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.className = "sprout-modal rounded-lg border border-border bg-popover text-popover-foreground";
    panel.style.padding = "20px";
    // Only z-index is allowed inline, all other styles removed
    overlay.appendChild(panel);
    sproutWrapper.appendChild(overlay);

    const header = document.createElement("div");
    header.className = "flex items-center justify-between gap-3 mb-6";
    const heading = document.createElement("div");
    heading.className = "text-lg font-semibold";
    heading.textContent = `Edit ${cards.length} selected card${cards.length === 1 ? "" : "s"}`;
    header.appendChild(heading);
    const close = document.createElement("button");
    close.type = "button";
        close.className = "inline-flex items-center justify-center h-9 w-9 text-muted-foreground hover:text-foreground focus-visible:text-foreground";
    close.style.setProperty("border", "none", "important");
    close.style.setProperty("background", "transparent", "important");
    close.style.setProperty("box-shadow", "none", "important");
    close.style.setProperty("padding", "0", "important");
    close.style.setProperty("cursor", "pointer", "important");
    close.setAttribute("data-tooltip", "Close");
    const closeIcon = document.createElement("span");
    closeIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(closeIcon, "x");
    close.appendChild(closeIcon);
    close.addEventListener("click", () => {
      removeOverlay();
    });
    header.appendChild(close);
    panel.appendChild(header);

    const form = document.createElement("div");
    form.className = "flex flex-col gap-3";

    const normalizedTypes = cards.map((card) => String(card?.type ?? "").toLowerCase());
    const hasNonCloze = normalizedTypes.some((type) => type !== "cloze");
    const hasMcq = normalizedTypes.some((type) => type === "mcq");
    const answerLabel = hasMcq ? "Answer / Options" : "Answer";
    const isClozeOnly = normalizedTypes.length > 0 && normalizedTypes.every((type) => type === "cloze");

    const isMacLike = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");
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
      const start = Number.isFinite(textarea.selectionStart) ? (textarea.selectionStart as number) : value.length;
      const end = Number.isFinite(textarea.selectionEnd) ? (textarea.selectionEnd as number) : value.length;
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
        textarea.className = "textarea w-full";
        textarea.rows = 3;
        textarea.value = value;
        textarea.style.resize = "none";
        textarea.style.minHeight = "80px";
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
        overwriteNotice.style.display = "none";
        wrapper.appendChild(overwriteNotice);

        const updateOverwriteNotice = () => {
          const value = String(input.value ?? "").trim();
          overwriteNotice.style.display = value.length ? "" : "none";
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

    const createMcqEditor = () => {
      if (!isSingleMcq) {
        buildMcqValue = null;
        return null;
      }
      const card = cards[0];
      mcqOriginalString = buildAnswerOrOptionsFor(card);
      const options = Array.isArray(card.options) ? [...card.options] : [];
      const correctIndex = Number.isFinite(card.correctIndex) ? card.correctIndex : 0;
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
      correctInput.className = "input w-full";
      correctInput.placeholder = "Correct option";
      correctInput.value = correctValue;
      correctInput.style.minHeight = "38px";
      correctInput.style.maxHeight = "38px";
      correctInput.style.height = "38px";
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
      addInput.className = "input flex-1 text-sm";
      addInput.style.minHeight = "38px";
      addInput.style.maxHeight = "38px";
      addInput.style.height = "38px";
      const updateAddPlaceholder = () => {
        const label = wrongRows.length ? "Add another wrong option" : "Add wrong option";
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
          entry.removeBtn.style.setProperty("opacity", disable ? "0.35" : "1", "important");
          entry.removeBtn.style.cursor = disable ? "default" : "pointer";
        }
      };

      const addWrongRow = (value = "") => {
        const row = document.createElement("div");
        row.className = "flex items-center gap-2";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input flex-1 text-sm";
        input.placeholder = "Wrong option";
        input.value = value;
        input.style.minHeight = "38px";
        input.style.maxHeight = "38px";
        input.style.height = "38px";
        row.appendChild(input);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "inline-flex items-center justify-center";
        removeBtn.style.setProperty("border", "none", "important");
        removeBtn.style.setProperty("background", "transparent", "important");
        removeBtn.style.setProperty("padding", "0", "important");
        removeBtn.style.setProperty("box-shadow", "none", "important");
        removeBtn.style.setProperty("outline", "none", "important");
        removeBtn.style.setProperty("color", "var(--muted-foreground)", "important");
        const xIcon = document.createElement("span");
        xIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
        setIcon(xIcon, "x");
        removeBtn.appendChild(xIcon);
        removeBtn.addEventListener("mouseenter", () => {
          if (removeBtn.disabled) return;
          removeBtn.style.setProperty("color", "var(--foreground)", "important");
        });
        removeBtn.addEventListener("mouseleave", () => {
          removeBtn.style.setProperty("color", "var(--muted-foreground)", "important");
        });
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
          new Notice("Correct MCQ answer cannot be empty.");
          return null;
        }
        const wrongs = wrongRows.map((entry) => entry.input.value.trim()).filter((opt) => opt.length > 0);
        if (wrongs.length < 1) {
          new Notice("MCQ requires at least one wrong option.");
          return null;
        }
        const optionsList = [correct, ...wrongs];
        const rendered = optionsList.map((opt, idx) =>
          idx === 0 ? `**${escapePipes(opt)}**` : escapePipes(opt),
        );
        return rendered.join(" | ");
      };
      buildMcqValue = () => buildValue();

      return container;
    };

    const mcqSection = isSingleMcq ? createMcqEditor() : null;

    const createGroupPickerField = (initialValue: string, cardsCount: number) => {
      const hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.value = initialValue;

      const container = document.createElement("div");
      container.className = "relative";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "4px";

      const tagBox = document.createElement("div");
      tagBox.className = `textarea w-full ${this._cellTextClass}`;
      tagBox.style.height = `38px`;
      tagBox.style.minHeight = `38px`;
      tagBox.style.maxHeight = `38px`;
      tagBox.style.overflow = "auto";
      tagBox.style.padding = "6px 8px";
      tagBox.style.boxSizing = "border-box";
      tagBox.style.display = "flex";
      tagBox.style.flexWrap = "wrap";
      tagBox.style.columnGap = "6px";
      tagBox.style.rowGap = "2px";
      tagBox.style.alignContent = "flex-start";
      container.appendChild(tagBox);

      let overwriteNotice: HTMLDivElement | null = null;
      if (cardsCount > 1) {
        overwriteNotice = document.createElement("div");
        overwriteNotice.className = "text-xs text-muted-foreground";
        overwriteNotice.textContent =
          "Typing here will overwrite this field for every selected card; leave it blank to keep existing values.";
        overwriteNotice.style.display = "none";
        container.appendChild(overwriteNotice);
      }

      let selected = parseGroupsInput(initialValue);
      if (!selected) selected = [];

      const optionSet = new Set<string>();
      for (const g of (this.plugin.store.getAllCards() || [])
        .flatMap((c: any) => (Array.isArray(c?.groups) ? c.groups : []))
        .map((g: any) => titleCaseGroupPath(String(g).trim()))
        .filter(Boolean)) {
        for (const tag of expandGroupAncestors(g)) optionSet.add(tag);
      }
      let allOptions = Array.from(optionSet).sort((a, b) =>
        formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
      );

      const list = document.createElement("div");
      list.className = "flex flex-col max-h-60 overflow-auto p-1";

      const searchWrap = document.createElement("div");
      searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0";
      searchWrap.style.width = "100%";

      const searchIcon = document.createElement("span");
      searchIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
      searchIcon.setAttribute("aria-hidden", "true");
      setIcon(searchIcon, "search");
      searchWrap.appendChild(searchIcon);

      const search = document.createElement("input");
      search.type = "text";
      search.className = "bg-transparent text-sm flex-1 h-9";
      search.style.minWidth = "0";
      search.style.width = "100%";
      search.style.border = "none";
      search.style.boxShadow = "none";
      search.style.outline = "none";
      search.placeholder = "Search or add group";
      searchWrap.appendChild(search);

      const panel = document.createElement("div");
      panel.className = "rounded-lg border border-border bg-popover text-popover-foreground p-0 flex flex-col";
      panel.style.pointerEvents = "auto";
      panel.appendChild(searchWrap);
      panel.appendChild(list);

      const popover = document.createElement("div");
      popover.style.position = "absolute";
      popover.style.bottom = "calc(100% + 6px)";
      popover.style.left = "0";
      popover.style.right = "auto";
      popover.style.zIndex = "10000";
      popover.style.width = "100%";
      popover.style.display = "none";
      popover.style.pointerEvents = "auto";
      popover.setAttribute("aria-hidden", "true");
      popover.appendChild(panel);
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
        if (overwriteNotice) overwriteNotice.style.display = cardsCount > 1 && value ? "" : "none";
      };

      const commit = () => {
        hiddenInput.value = groupsToInput(selected);
        updateOverwriteNotice();
      };

        const renderBadges = () => {
          clearNode(tagBox);
          if (selected.length === 0) {
            const empty = document.createElement("span");
            empty.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6";
            empty.textContent = "No groups";
            empty.style.display = "inline-flex";
            empty.style.color = "#fff";
            tagBox.appendChild(empty);
            return;
          }
        for (const tag of selected) {
          const badge = document.createElement("span");
            badge.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6";
          badge.style.display = "inline-flex";

          const txt = document.createElement("span");
          txt.textContent = formatGroupDisplay(tag);
          badge.appendChild(txt);

          const removeBtn = document.createElement("span");
            removeBtn.className = "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white";
            removeBtn.style.transform = "scale(0.85)";
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

        if (raw && !exact) addRow(`Add “${rawDisplay || rawTitle}”`, rawTitle || raw, true);
        if (allOptions.length === 0 && !raw && selected.length === 0) {
          list.style.maxHeight = "none";
          list.style.overflow = "visible";
          const empty = document.createElement("div");
          empty.className = "px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
          empty.textContent = "Type a keyword above to save this flashcard to a group.";
          list.appendChild(empty);
          return;
        }

        for (const opt of options) addRow(formatGroupDisplay(opt), opt);
      };

      let cleanup: (() => void) | null = null;
      const closePopover = () => {
        popover.setAttribute("aria-hidden", "true");
        popover.style.display = "none";
        if (cleanup) {
          try {
            cleanup();
          } catch {}
          cleanup = null;
        }
      };

      const openPopover = () => {
        popover.setAttribute("aria-hidden", "false");
        popover.style.display = "block";
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
        if ((ev as PointerEvent).button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (popover.style.display === "block") {
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

    const sharedValue = (col: ColKey, predicate: (card: CardRecord) => boolean = () => true) => {
      const filtered = cards.filter(predicate);
      if (!filtered.length) return "";
      const vals = filtered.map((card) => this._readCardField(card, col));
      const first = vals[0];
      return vals.every((value) => value === first) ? first : "";
    };

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

    panel.appendChild(form);

    const footer = document.createElement("div");
    footer.className = "flex items-center justify-end gap-4";
    footer.style.marginTop = "20px";
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
    save.style.setProperty("background", "var(--foreground)", "important");
    save.style.setProperty("color", "var(--background)", "important");
    save.style.setProperty("border-color", "var(--foreground)", "important");
    const saveIcon = document.createElement("span");
    saveIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(saveIcon, "save");
    const saveText = document.createElement("span");
    saveText.textContent = "Save";
    save.appendChild(saveIcon);
    save.appendChild(saveText);
    save.addEventListener("click", async () => {
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
            updated = this.applyValueToCard(updated, key as ColKey, value);
          }
          await this.writeCardToMarkdown(updated);
        }
        overlay.remove();
      } catch (err: any) {
        new Notice(`${BRAND}: ${err?.message || String(err)}`);
      }
    });
    footer.appendChild(cancel);
    footer.appendChild(save);
    panel.appendChild(footer);

    function cleanupOverlay() {
      document.removeEventListener("keydown", onKeyDown, true);
    }

    function removeOverlay() {
      cleanupOverlay();
      overlay.remove();
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      removeOverlay();
    };
    document.addEventListener("keydown", onKeyDown, true);

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) removeOverlay();
    });

    // Wrap removeOverlay to also clean up the keydown listener
    const originalRemoveOverlay = removeOverlay;
    removeOverlay = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      originalRemoveOverlay();
    };

    document.body.appendChild(sproutWrapper);
  }

  private makeResizableTh(th: HTMLTableCellElement, col: ColKey) {
    th.style.position = "relative";

    const RESIZE_ZONE_PX = 14;

    const handle = document.createElement("div");
    handle.className = "sprout-col-resize";
    handle.setAttribute("data-tooltip", "Drag to resize");

    handle.style.position = "absolute";
    handle.style.top = "0";
    handle.style.right = "0";
    handle.style.height = "100%";
    handle.style.width = `${RESIZE_ZONE_PX}px`;
    handle.style.cursor = "col-resize";
    handle.style.userSelect = "none";
    handle.style.touchAction = "none";
    handle.style.zIndex = "20"; // ensure above header content

    // Make sure pointer events only on the handle
    handle.style.pointerEvents = "auto";
    th.style.pointerEvents = "auto";

    th.appendChild(handle);

    const onMouseDown = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();

      const startX = ev.clientX;
      const startW = this.colWidths[col] || 120;

      const minW = this._colMin[col] ?? 70;
      const maxW = this._colMax[col] ?? 500;

      let moved = false;
      this._suppressHeaderClickUntil = Date.now() + 400;

      const onMove = (e: MouseEvent) => {
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) > 1) moved = true;

        const next = Math.min(maxW, Math.max(minW, startW + dx));
        this.colWidths[col] = next;

        const colEl = this._colEls[col];
        if (colEl) colEl.style.width = `${next}px`;
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        this._suppressHeaderClickUntil = Date.now() + (moved ? 500 : 250);
      };

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    };

    handle.addEventListener("mousedown", onMouseDown);

    handle.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  // ✅ pagination as individual buttons
  private _renderPagination(totalRows: number) {
    const host = this._pagerHostEl;
    if (!host) return;

    clearNode(host);

    const size = Math.max(1, Math.floor(Number(this.pageSize) || 25));
    const totalPages = Math.max(1, Math.ceil(totalRows / size));

    if (!Number.isFinite(this.pageIndex) || this.pageIndex < 0) this.pageIndex = 0;
    if (this.pageIndex > totalPages - 1) this.pageIndex = totalPages - 1;

    if (totalRows <= size) {
      const small = document.createElement("div");
      small.className = "text-sm text-muted-foreground";
      small.textContent = totalRows === 0 ? "Page 0 / 0" : `Page 1 / 1`;
      host.appendChild(small);
      return;
    }

    const nav = document.createElement("nav");
    nav.setAttribute("role", "navigation");
    nav.setAttribute("data-tooltip", "Pagination");
    nav.className = "flex items-center gap-2";
    host.appendChild(nav);

    const mkBtn = (label: string, tooltip: string, disabled: boolean, active: boolean, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = active ? "btn" : "btn-outline";
      b.classList.add(..."h-8 px-2".split(" "));
      b.textContent = label;
      b.setAttribute("data-tooltip", tooltip);
      b.disabled = disabled;
      if (active) b.setAttribute("aria-current", "page");
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (b.disabled) return;
        onClick();
      });
      return b;
    };

    // --- New: ellipsis as a button ---
    const mkEllipsisBtn = (targetPage: number) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-outline h-8 px-2";
      b.textContent = "…";
      b.setAttribute("data-tooltip", `Page ${targetPage}`);
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.pageIndex = targetPage - 1;
        this.refreshTable();
      });
      return b;
    };

    const current = this.pageIndex + 1;
    const totalPagesLocal = totalPages;
    const maxBtns = 5;
    let start = Math.max(1, current - Math.floor(maxBtns / 2));
    let end = start + maxBtns - 1;
    if (end > totalPagesLocal) {
      end = totalPagesLocal;
      start = Math.max(1, end - maxBtns + 1);
    }

    // Prev
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "btn-outline";
    prev.classList.add(..."h-8 px-2".split(" "));
    prev.setAttribute("data-tooltip", "Previous page");
    prev.disabled = this.pageIndex <= 0;
    prev.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (prev.disabled) return;
      this.pageIndex = Math.max(0, this.pageIndex - 1);
      this.refreshTable();
    });
    const prevIcon = document.createElement("span");
    prevIcon.setAttribute("aria-hidden", "true");
    prevIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(prevIcon, "chevron-left");
    prev.appendChild(prevIcon);
    const prevTxt = document.createElement("span");
    prevTxt.className = "ml-1";
    prevTxt.textContent = "Prev";
    prev.appendChild(prevTxt);
    nav.appendChild(prev);

    // First page
    if (start > 1) {
      nav.appendChild(
        mkBtn("1", "Page 1", false, current === 1, () => {
          this.pageIndex = 0;
          this.refreshTable();
        }),
      );
    }

    // Main page numbers
    for (let p = start; p <= end; p++) {
      nav.appendChild(
        mkBtn(String(p), `Page ${p}`, false, p === current, () => {
          this.pageIndex = p - 1;
          this.refreshTable();
        }),
      );
    }

    // Ellipsis as a button before last page if needed
    if (end < totalPagesLocal - 1) {
      // Jump to the page right after the last visible one
      nav.appendChild(mkEllipsisBtn(end + 1));
    }

    // Last page
    if (end < totalPagesLocal) {
      nav.appendChild(
        mkBtn(String(totalPagesLocal), `Page ${totalPagesLocal}`, false, current === totalPagesLocal, () => {
          this.pageIndex = totalPagesLocal - 1;
          this.refreshTable();
        }),
      );
    }

    // Next
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn-outline";
    next.classList.add(..."h-8 px-2".split(" "));
    next.setAttribute("data-tooltip", "Next page");
    next.disabled = this.pageIndex >= totalPagesLocal - 1;
    next.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (next.disabled) return;
      this.pageIndex = Math.min(totalPagesLocal - 1, this.pageIndex + 1);
      this.refreshTable();
    });
    const nextTxt = document.createElement("span");
    nextTxt.className = "mr-1";
    nextTxt.textContent = "Next";
    next.appendChild(nextTxt);
    const nextIcon = document.createElement("span");
    nextIcon.setAttribute("aria-hidden", "true");
    nextIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(nextIcon, "chevron-right");
    next.appendChild(nextIcon);
    nav.appendChild(next);
  }

  private refreshTable() {
    const oldTbody = this._tableBody;
    if (!oldTbody) return;
    const wrap = this._tableWrapEl;
    const prevScrollLeft = wrap ? wrap.scrollLeft : 0;
    const prevScrollTop = wrap ? wrap.scrollTop : 0;

    const rows = this.computeRows();
    const total = rows.length;

    const size = Math.max(1, Math.floor(Number(this.pageSize) || 25));
    const totalPages = Math.max(1, Math.ceil(total / size));
    if (this.pageIndex > totalPages - 1) this.pageIndex = Math.max(0, totalPages - 1);
    if (this.pageIndex < 0) this.pageIndex = 0;

    const startIdx = total === 0 ? 0 : this.pageIndex * size;
    const endIdx = total === 0 ? 0 : Math.min(total, startIdx + size);
    const pageRows = total === 0 ? [] : rows.slice(startIdx, endIdx);
    this._currentPageRowIds = pageRows.map(({ card }) => String(card.id));
    this._lastShiftSelectionIndex = null;

    const newTbody = document.createElement("tbody");
    newTbody.className = "";

    const fixedTextareaHeight = (ta: HTMLTextAreaElement) => {
      const h = `${this._editorHeightPx}px`;
      ta.style.height = h;
      ta.style.minHeight = h;
      ta.style.maxHeight = h;
      ta.style.resize = "none";
    };

    const setColAttr = (td: HTMLTableCellElement, col: ColKey) => {
      td.setAttribute("data-col", col);
      return td;
    };

    const makeReadOnlyFieldCell = (value: string, col: ColKey, title?: string) => {
      // Special-case: Due field should render as muted plain text when read-only
      if (col === "due") {
        const td = document.createElement("td");
        td.className = `align-top ${this._readonlyTextClass} ${this._cellWrapClass} text-muted-foreground`;
        td.textContent = value;
        if (title) td.setAttribute("data-tooltip", title);

        td.style.height = `${this._rowHeightPx}px`;
        td.style.verticalAlign = "top";
        forceWrapStyles(td);
        forceCellClip(td);
        setColAttr(td, col);
        return td;
      }

      const td = document.createElement("td");
      td.className = `align-top ${this._cellWrapClass}`;
      td.style.height = `${this._rowHeightPx}px`;
      td.style.verticalAlign = "top";
      forceCellClip(td);
      forceWrapStyles(td);
      setColAttr(td, col);

      const ta = document.createElement("textarea");
      ta.className = `textarea w-full ${this._readonlyTextClass}`;
      ta.value = value;
      ta.readOnly = true;
      if (title) ta.setAttribute("data-tooltip", title);

      fixedTextareaHeight(ta);

      ta.style.setProperty("overflow", "hidden", "important");
      ta.style.setProperty("white-space", "pre-wrap", "important");
      ta.style.setProperty("overflow-wrap", "anywhere", "important");
      ta.style.setProperty("word-break", "break-word", "important");

      td.appendChild(ta);
      return td;
    };

    if (pageRows.length === 0) {
      // --- Special error row OUTSIDE the table, centered in the parent div ---
      // Remove the table body and instead show a centered error message below the header
      oldTbody.replaceWith(newTbody);
      this._tableBody = newTbody;
      this._applyColumnVisibility();

      // Remove any previous error message
      const prevError = this._rootEl?.querySelector(".sprout-browser-empty-message");
      if (prevError) prevError.remove();

      // Insert error message after the table (but inside the scroll container)
      const wrap = this._rootEl?.querySelector(".bc.rounded-lg.border.border-border.overflow-auto");
      if (wrap) {
        wrap.style.setProperty("overflow", "auto", "important");

        const msg = document.createElement("div");
        msg.className = "sprout-browser-empty-message flex items-center justify-center text-center text-muted-foreground text-base py-8 px-4 w-full";
        msg.style.width = "100%";
        msg.style.boxSizing = "border-box";
        msg.style.position = "absolute";
        msg.style.left = "0";
        msg.style.top = "0";
        msg.style.background = "var(--background)";
        msg.style.zIndex = "2";
        msg.style.pointerEvents = "none";
        msg.textContent = total === 0 ? "No cards match your filters." : "No rows on this page.";
        wrap.appendChild(msg);

        if (this._emptyStateCleanup) {
          this._emptyStateCleanup();
          this._emptyStateCleanup = null;
        }

        const headerHeight = 44;
        const place = () => {
          const msgRect = msg.getBoundingClientRect();
          const availableHeight = Math.max(0, wrap.clientHeight - headerHeight);
          const top =
            wrap.scrollTop + headerHeight + Math.max(0, (availableHeight - msgRect.height) / 2);
          msg.style.left = `${wrap.scrollLeft}px`;
          msg.style.top = `${Math.round(top)}px`;
          msg.style.width = `${wrap.clientWidth}px`;
        };

        const onScroll = () => place();
        wrap.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, true);
        requestAnimationFrame(place);

        this._emptyStateCleanup = () => {
          wrap.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll, true);
        };
      }

      if (this._summaryEl) {
        this._summaryEl.textContent = total === 0 ? "Showing 0 of 0" : `Showing 0 of ${total}`;
      }
      this._renderPagination(total);
      return;
    } else {
      // Remove any previous error message if present
      const prevError = this._rootEl?.querySelector(".sprout-browser-empty-message");
      if (prevError) prevError.remove();

      const wrap = this._rootEl?.querySelector(".bc.rounded-lg.border.border-border.overflow-auto");
      if (wrap) {
        wrap.style.setProperty("overflow", "auto", "important");
      }
      if (this._emptyStateCleanup) {
        this._emptyStateCleanup();
        this._emptyStateCleanup = null;
      }
    }

    const quarantine = (this.plugin.store.data.quarantine || {}) as Record<string, any>;

    const pageRowCount = pageRows.length;
    for (const [rowIndex, { card, state, dueMs }] of pageRows.entries()) {
      const isQuarantined = !!quarantine[String(card.id)];
      const tr = document.createElement("tr");
      tr.className = "";
      tr.style.height = `${this._rowHeightPx}px`;

      const selTd = document.createElement("td");
      selTd.className = `text-center ${this._cellWrapClass}`;
      selTd.style.height = `${this._rowHeightPx}px`;
      selTd.style.verticalAlign = "middle";
      selTd.style.display = "flex";
      selTd.style.alignItems = "center";
      selTd.style.justifyContent = "center";
      forceCellClip(selTd);
      forceWrapStyles(selTd);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("data-card-id", String(card.id));
      checkbox.className = "cursor-pointer";
      checkbox.style.accentColor = "var(--text-normal)";
      checkbox.checked = this._selectedIds.has(String(card.id));
      checkbox.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const checked = checkbox.checked;
        const shift = (ev as MouseEvent).shiftKey;
        if (shift && this._lastShiftSelectionIndex !== null) {
          const start = Math.min(this._lastShiftSelectionIndex, rowIndex);
          const end = Math.max(this._lastShiftSelectionIndex, rowIndex);
          let changed = false;
          for (let idx = start; idx <= end; idx += 1) {
            const id = String(pageRows[idx].card.id);
            if (checked) {
              if (!this._selectedIds.has(id)) {
                this._selectedIds.add(id);
                changed = true;
              }
            } else {
              if (this._selectedIds.has(id)) {
                this._selectedIds.delete(id);
                changed = true;
              }
            }
          }
          if (changed) {
            this._syncRowCheckboxes();
            this._updateSelectionIndicator();
            this._updateSelectAllCheckboxState();
          }
        } else if (this._setSelection(String(card.id), checked)) {
          this._updateSelectionIndicator();
          this._updateSelectAllCheckboxState();
        }
        this._lastShiftSelectionIndex = rowIndex;
      });

      selTd.appendChild(checkbox);
      tr.appendChild(selTd);

      const tdMuted = (txt: string, col: ColKey, title?: string) => {
        const td = document.createElement("td");
        td.className = `align-top ${this._readonlyTextClass} ${this._cellWrapClass} text-muted-foreground`;
        td.textContent = txt;
        if (title) td.setAttribute("data-tooltip", title);

        td.style.height = `${this._rowHeightPx}px`;
        td.style.verticalAlign = "top";

        forceWrapStyles(td);
        forceCellClip(td);
        setColAttr(td, col);

        return td;
      };

      // ID cell
      const idTd = document.createElement("td");
      idTd.className = `align-top ${this._cellWrapClass}`;
      idTd.style.height = `${this._rowHeightPx}px`;
      idTd.style.verticalAlign = "top";
      forceCellClip(idTd);
      forceWrapStyles(idTd);
      setColAttr(idTd, "id");

      // Check if card is suspended
      const isSuspended = String((state as any)?.stage || "") === "suspended";

      const idBtn = document.createElement("button");
      idBtn.type = "button";
      let buttonClass = "btn";
      if (isQuarantined) {
        buttonClass = "btn-destructive";
      } else if (isSuspended) {
        buttonClass = "btn-destructive";
      }
      idBtn.className = buttonClass + " h-6 px-2 py-0.5 rounded-full inline-flex items-center gap-1 leading-none text-sm";

      // Custom styling for suspended (red) vs normal (blue)
      if (isSuspended) {
        idBtn.style.setProperty("background-color", "rgb(239, 68, 68)", "important");
        idBtn.style.setProperty("color", "white", "important");
      }

      idBtn.setAttribute("data-tooltip", `Open card ^sprout-${card.id}`);

      idBtn.style.setProperty("font-size", "10px", "important");
      idBtn.style.setProperty("padding", "2px 8px", "important");
      idBtn.style.setProperty("height", "24px", "important");
      idBtn.style.setProperty("line-height", "1", "important");

      const idValue = document.createElement("span");
      idValue.className = "";
      idValue.textContent = String(card.id);
      idBtn.appendChild(idValue);

      const linkIcon = document.createElement("span");
      linkIcon.setAttribute("aria-hidden", "true");
      linkIcon.className = "inline-flex items-center justify-center";
      
      // Determine icon: circle-pause for suspended, alert-triangle for quarantined, link for normal
      let iconName = "link";
      if (isSuspended) {
        iconName = "circle-pause";
      } else if (isQuarantined) {
        iconName = "alert-triangle";
      }
      setIcon(linkIcon, iconName);

      // Scale down the icon: 70% for suspended/warning, 70% for broken link, 75% for normal link
      try {
        const scale = isSuspended || isQuarantined ? 0.7 : 0.75;
        linkIcon.style.transform = `scale(${scale})`;
        linkIcon.style.transformOrigin = "center";
        // Keep inline-flex to preserve layout
        linkIcon.style.display = "inline-flex";
      } catch {}

      idBtn.appendChild(linkIcon);

      idBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void this.openSource(card);
      });

      idTd.appendChild(idBtn);
      tr.appendChild(idTd);

      tr.appendChild(tdMuted(isQuarantined ? "Quarantined" : typeLabelBrowser(card.type), "type"));

      const stage = isQuarantined ? "quarantined" : String((state as any)?.stage || "new");
      if (stage === "suspended") {
        const td = document.createElement("td");
        td.className = `align-top ${this._readonlyTextClass} ${this._cellWrapClass} text-muted-foreground`;
        td.style.height = `${this._rowHeightPx}px`;
        td.style.verticalAlign = "top";
        forceWrapStyles(td);
        forceCellClip(td);
        setColAttr(td, "stage");

        const label = document.createElement("div");
        label.className = "";
        label.textContent = stageLabel(stage);
        td.appendChild(label);

        tr.appendChild(td);
      } else if (stage === "quarantined") {
        tr.appendChild(tdMuted("Quarantined", "stage"));
      } else {
        tr.appendChild(tdMuted(stageLabel(stage), "stage"));
      }

      if (stage === "suspended") {
        tr.appendChild(makeReadOnlyFieldCell("Card currently suspended (no due data).", "due"));
      } else if (stage === "quarantined") {
        tr.appendChild(makeReadOnlyFieldCell("Card currently quarantined (no due data).", "due"));
      } else {
        tr.appendChild(tdMuted(fmtDue(dueMs), "due"));
      }

      const makeEditorCell = (col: ColKey) => {
        if (isQuarantined) {
          const initial =
            col === "title"
              ? (card.title || "")
              : col === "question"
                ? buildQuestionFor(card)
                : col === "answer"
                  ? buildAnswerOrOptionsFor(card)
                  : col === "info"
                    ? (card.info || "")
                    : "";
          return makeReadOnlyFieldCell(initial || "—", col);
        }

        if (col === "answer" && card.type === "cloze") {
          const td = document.createElement("td");
          td.className = (
            `align-top ${this._readonlyTextClass} ${this._cellWrapClass} text-muted-foreground`,
          );
          td.textContent = CLOZE_ANSWER_HELP;
          td.style.height = `${this._rowHeightPx}px`;
          td.style.verticalAlign = "top";
          forceWrapStyles(td);
          forceCellClip(td);
          setColAttr(td, col);
          return td;
        }

        if ((card.type === "io" || card.type === "io-child") && (col === "question" || col === "answer")) {
          const td = document.createElement("td");
          td.className = `align-top ${this._cellWrapClass}`;
          td.style.height = `${this._rowHeightPx}px`;
          td.style.verticalAlign = "top";
          td.style.cursor = "pointer";
          forceWrapStyles(td);
          forceCellClip(td);
          setColAttr(td, col);

          const io = getIoResolvedImage(this.app, card as any);
          if (!io.src || !io.displayRef) {
            return makeReadOnlyFieldCell("— (IO image not resolved)", col);
          }

          if (col === "question") {
            const ioMap: any = (this.plugin.store.data as any)?.io || {};
            const parentId = card.type === "io" ? String(card.id) : String((card as any).parentId || "");
            const def = parentId ? ioMap[parentId] : null;
            const rects = Array.isArray(def?.rects) ? def.rects : ((card as any).occlusions ?? (card as any).rects ?? null);
            let maskedRects = rects;
            if (card.type === "io-child" && Array.isArray(rects)) {
              const rectIds = Array.isArray((card as any).rectIds)
                ? (card as any).rectIds.map((r: any) => String(r))
                : [];
              maskedRects = rectIds.length
                ? rects.filter((r: any) => rectIds.includes(String((r as any).rectId)))
                : rects;
            }
            const labelsCard = Array.isArray(maskedRects) ? { rects: maskedRects } : card;
            td.innerHTML = buildIoOccludedHtml(
              io.src,
              io.displayRef,
              maskedRects,
              `IO (occluded) — ^sprout-${card.id}`,
              labelsCard,
            );
          } else {
            td.innerHTML = buildIoImgHtml(io.src, io.displayRef, `IO (original) — ^sprout-${card.id}`);
          }

          // Add double-click handler to open IO editor
          td.addEventListener("dblclick", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this._openIoEditor(card.id);
          });

          return td;
        }

        const td = document.createElement("td");
        td.className = "align-top";
        td.style.height = `${this._rowHeightPx}px`;
        td.style.verticalAlign = "top";
        forceCellClip(td);
        setColAttr(td, col);

        const initial =
          col === "title"
            ? (card.title || "")
            : col === "question"
              ? buildQuestionFor(card)
              : col === "answer"
                ? buildAnswerOrOptionsFor(card)
                : col === "info"
                  ? (card.info || "")
                  : "";

        const ta = document.createElement("textarea");
        ta.className = `textarea w-full ${this._cellTextClass}`;
        ta.value = initial;

        const h = `${this._editorHeightPx}px`;
        ta.style.height = h;
        ta.style.minHeight = h;
        ta.style.maxHeight = h;
        ta.style.resize = "none";
        ta.style.overflow = "auto";

        const key = `${card.id}:${col}`;
        let baseline = initial;

        ta.addEventListener("focus", () => {
          baseline = ta.value;
        });

        ta.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            ta.value = baseline;
          }
        });

        ta.addEventListener("blur", async () => {
          const nextVal = ta.value;
          if (nextVal === baseline) return;
          if (this._saving.has(key)) return;

          this._saving.add(key);

          try {
            const updated = this.applyValueToCard(card, col, nextVal);
            await this.writeCardToMarkdown(updated);
            baseline = nextVal;
          } catch (err: any) {
            new Notice(`${BRAND}: ${err?.message || String(err)}`);
            ta.value = baseline;
          } finally {
            this._saving.delete(key);
          }
        });

        td.appendChild(ta);
        return td;
      };

      const makeGroupsEditorCell = () => {
        if (isQuarantined) {
          return makeReadOnlyFieldCell("—", "groups");
        }

        const td = document.createElement("td");
        td.className = "align-top";
        td.style.height = `${this._rowHeightPx}px`;
        td.style.verticalAlign = "top";
        forceCellClip(td);
        td.style.setProperty("overflow", "visible", "important");
        td.style.position = "relative";
        setColAttr(td, "groups");

        const key = `${card.id}:groups`;
        let baseline = groupsToInput((card as any).groups);
        let selected = coerceGroups((card as any).groups)
          .map((g) => titleCaseGroupPath(String(g).trim()))
          .filter(Boolean);

        const tagBox = document.createElement("div");
        tagBox.className = `textarea w-full ${this._cellTextClass}`;
        tagBox.style.height = `${this._editorHeightPx}px`;
        tagBox.style.minHeight = `${this._editorHeightPx}px`;
        tagBox.style.maxHeight = `${this._editorHeightPx}px`;
        tagBox.style.overflow = "auto";
        tagBox.style.padding = "6px 8px";
        tagBox.style.boxSizing = "border-box";
        tagBox.style.display = "flex";
        tagBox.style.flexWrap = "wrap";
        tagBox.style.columnGap = "6px";
        tagBox.style.rowGap = "2px";
        tagBox.style.alignContent = "flex-start";
        td.appendChild(tagBox);

        const renderBadges = () => {
          clearNode(tagBox);
          if (selected.length === 0) {
            const empty = document.createElement("span");
            empty.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6";
            empty.textContent = "No groups";
            empty.style.display = "inline-flex";
            empty.style.color = "#fff";
            tagBox.appendChild(empty);
            return;
          }
          for (const tag of selected) {
            const badge = document.createElement("span");
            badge.className = "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6";
            badge.style.display = "inline-flex";

            const txt = document.createElement("span");
            txt.textContent = formatGroupDisplay(tag);
            badge.appendChild(txt);

            const removeBtn = document.createElement("span");
            removeBtn.className = "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white";
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
        };

        const commit = async () => {
          const nextVal = groupsToInput(selected);
          if (nextVal === baseline) return;
          if (this._saving.has(key)) return;

          this._saving.add(key);

          try {
            const updated = this.applyValueToCard(card, "groups", nextVal);
            await this.writeCardToMarkdown(updated);
            this.plugin.store.upsertCard(updated);
            baseline = nextVal;
          } catch (err: any) {
            new Notice(`${BRAND}: ${err?.message || String(err)}`);
            selected = parseGroupsInput(baseline);
            renderBadges();
          } finally {
            this._saving.delete(key);
          }
        };

        const popover = document.createElement("div");
        popover.className = "sprout";
        popover.setAttribute("aria-hidden", "true");
        popover.style.setProperty("position", "fixed", "important");
        popover.style.setProperty("z-index", "999999", "important");
        popover.style.setProperty("display", "none", "important");
        popover.style.setProperty("pointer-events", "auto", "important");

        const panel = document.createElement("div");
        panel.className = "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0";
        panel.style.setProperty("pointer-events", "auto", "important");
        popover.appendChild(panel);

        const searchWrap = document.createElement("div");
        searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0";
        searchWrap.style.width = "100%";
        panel.appendChild(searchWrap);

        const searchIcon = document.createElement("span");
        searchIcon.className = "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
        searchIcon.setAttribute("aria-hidden", "true");
        setIcon(searchIcon, "search");
        searchWrap.appendChild(searchIcon);

        const search = document.createElement("input");
        search.type = "text";
        search.className = "bg-transparent text-sm flex-1 h-9";
        search.style.minWidth = "0";
        search.style.width = "100%";
        search.style.border = "none";
        search.style.boxShadow = "none";
        search.style.outline = "none";
        search.placeholder = "Search or add group";
        searchWrap.appendChild(search);

        const list = document.createElement("div");
        list.className = "flex flex-col max-h-60 overflow-auto p-1";
        panel.appendChild(list);

        let cleanup: (() => void) | null = null;

        const optionSet = new Set<string>();
        for (const g of (this.plugin.store.getAllCards() || [])
          .flatMap((c: any) => (Array.isArray(c?.groups) ? c.groups : []))
          .map((g: any) => titleCaseGroupPath(String(g).trim()))
          .filter(Boolean)) {
          for (const tag of expandGroupAncestors(g)) optionSet.add(tag);
        }
        let allOptions = Array.from(optionSet).sort((a, b) =>
          formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
        );

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

        const toggleTag = (tag: string) => {
          const next = titleCaseGroupPath(tag);
          if (!next) return;
          if (selected.includes(next)) selected = selected.filter((t) => t !== next);
          else selected = [...selected, next];
          renderBadges();
          renderList();
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

          if (raw && !exact) addRow(`Add “${rawDisplay || rawTitle}”`, rawTitle || raw, true);

          if (allOptions.length === 0 && !raw && selected.length === 0) {
            list.style.maxHeight = "none";
            list.style.overflow = "visible";
            const empty = document.createElement("div");
            empty.className = "px-2 py-2 text-sm text-muted-foreground whitespace-normal break-words";
            empty.textContent = "Type a keyword above to save this flashcard to a group.";
            list.appendChild(empty);
            return;
          }

          for (const opt of options) addRow(formatGroupDisplay(opt), opt);

          if (shouldDropUp) {
            requestAnimationFrame(() => place());
            requestAnimationFrame(() => place());
          }
        };

        const shouldDropUp = rowIndex >= Math.max(0, pageRowCount - 2);
        const place = () => {
          const tagRect = tagBox.getBoundingClientRect();
          const width = Math.round(tagRect.width || tagBox.clientWidth || 240);
          const gap = 6;
          const popHeight = Math.max(
            panel.getBoundingClientRect().height || 0,
            popover.scrollHeight || 0,
            panel.scrollHeight || 0,
          );

          const left = Math.max(8, Math.min(tagRect.left, window.innerWidth - width - 8));
          const downTop = tagRect.bottom + gap;
          const upTop = tagRect.top - popHeight - gap;
          const dropUp = shouldDropUp;
          popover.style.left = `${left}px`;
          popover.style.width = `${width}px`;
          popover.style.bottom = "auto";
          popover.style.top = `${dropUp ? upTop : downTop}px`;
        };

        const close = () => {
          popover.setAttribute("aria-hidden", "true");
          popover.style.display = "none";
          try {
            cleanup?.();
          } catch {}
          cleanup = null;
          try {
            popover.remove();
          } catch {}
          void commit();
          renderBadges();
        };

        const open = () => {
          popover.setAttribute("aria-hidden", "false");
          popover.style.display = "block";
          document.body.appendChild(popover);
          requestAnimationFrame(() => place());
          requestAnimationFrame(() => place());
          renderList();
          search.focus();

          const onResizeOrScroll = () => place();
          const onDocPointerDown = (ev: PointerEvent) => {
            const t = ev.target as Node | null;
            if (!t) return;
            if (tagBox.contains(t) || popover.contains(t)) return;
            close();
          };
          const onDocKeydown = (ev: KeyboardEvent) => {
            if (ev.key !== "Escape") return;
            ev.preventDefault();
            ev.stopPropagation();
            close();
          };

          window.addEventListener("resize", onResizeOrScroll, true);
          window.addEventListener("scroll", onResizeOrScroll, true);
          wrap?.addEventListener("scroll", onResizeOrScroll, { passive: true });

          const tid = window.setTimeout(() => {
            document.addEventListener("pointerdown", onDocPointerDown, true);
            document.addEventListener("keydown", onDocKeydown, true);
          }, 0);

          cleanup = () => {
            window.clearTimeout(tid);
            window.removeEventListener("resize", onResizeOrScroll, true);
            window.removeEventListener("scroll", onResizeOrScroll, true);
            wrap?.removeEventListener("scroll", onResizeOrScroll);
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            document.removeEventListener("keydown", onDocKeydown, true);
          };
        };

        tagBox.addEventListener("pointerdown", (ev) => {
          if ((ev as PointerEvent).button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          open();
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

        return td;
      };

      tr.appendChild(makeEditorCell("title"));
      tr.appendChild(makeEditorCell("question"));
      tr.appendChild(makeEditorCell("answer"));
      tr.appendChild(makeEditorCell("info"));

      tr.appendChild(tdMuted(fmtLocation(card.sourceNotePath), "location", card.sourceNotePath));

      tr.appendChild(makeGroupsEditorCell());

      // Add row click handler for checkbox toggling (skip text selection and input clicks)
      tr.addEventListener("pointerdown", (ev: PointerEvent) => {
        const target = ev.target as Node | null;
        if (!target) return;

        // Don't toggle if clicking on checkbox, button, or input
        if (target instanceof HTMLInputElement) return;
        if (target instanceof HTMLButtonElement) return;
        if (target instanceof HTMLTextAreaElement) return;
        if (target instanceof HTMLSelectElement) return;

        // Don't toggle if clicking on elements inside interactive elements
        const interactive = (target as any)?.closest?.('input, button, textarea, select, [role="button"], [data-interactive]');
        if (interactive) return;

        // Check if user is selecting text
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;

        // Only react to primary button (left click)
        if (ev.button !== 0) return;

        // Toggle checkbox
        const wasChecked = checkbox.checked;
        const shift = ev.shiftKey;

        if (shift && this._lastShiftSelectionIndex !== null) {
          const start = Math.min(this._lastShiftSelectionIndex, rowIndex);
          const end = Math.max(this._lastShiftSelectionIndex, rowIndex);
          let changed = false;
          for (let idx = start; idx <= end; idx += 1) {
            const id = String(pageRows[idx].card.id);
            if (!wasChecked) {
              if (!this._selectedIds.has(id)) {
                this._selectedIds.add(id);
                changed = true;
              }
            } else {
              if (this._selectedIds.has(id)) {
                this._selectedIds.delete(id);
                changed = true;
              }
            }
          }
          if (changed) {
            this._syncRowCheckboxes();
            this._updateSelectionIndicator();
            this._updateSelectAllCheckboxState();
          }
        } else {
          checkbox.checked = !wasChecked;
          if (this._setSelection(String(card.id), !wasChecked)) {
            this._updateSelectionIndicator();
            this._updateSelectAllCheckboxState();
          }
        }
        this._lastShiftSelectionIndex = rowIndex;
      });

      newTbody.appendChild(tr);
    }

    oldTbody.replaceWith(newTbody);
    this._tableBody = newTbody;
    this._applyColumnVisibility();

    if (this._summaryEl) {
  const from = total === 0 ? 0 : startIdx + 1;
  const to = total === 0 ? 0 : endIdx;
  this._summaryEl.textContent = total === 0 ? "Showing 0 of 0" : `Showing ${from} to ${to} of ${total}`;
}

    this._renderPagination(total);
    if (wrap) {
      wrap.scrollLeft = prevScrollLeft;
      wrap.scrollTop = prevScrollTop;
    }
    this._updateSelectionIndicator();
    this._updateSelectAllCheckboxState();
  }

  render() {
    this._disposeUiPopovers();

    if (this._tableWrapEl) {
      this._lastScrollLeft = this._tableWrapEl.scrollLeft;
      this._lastScrollTop = this._tableWrapEl.scrollTop;
    }

    const root = this.contentEl;
    root.empty();

    this._rootEl = root;

    root.classList.add("bc", "sprout-view-content", "sprout-browser-view", "flex", "flex-col");
    root.setAttribute("data-sprout-browser-root", "1");
    root.style.minHeight = "0";
    root.style.gap = "10px";

    this.containerEl.addClass("sprout");
    this.setTitle?.("Flashcards");

    // ✅ Universal shared header: ensure instance exists, then install for this page
    if (!this._header) {
      const leaf = this.leaf ?? this.app.workspace.getLeaf(false);

      this._header = new SproutHeader({
        app: this.app,
        leaf,
        containerEl: this.containerEl,

        getIsWide: () => this.plugin.isWideMode,
        toggleWide: () => {
          this.plugin.isWideMode = !this.plugin.isWideMode;
          this._applyWidthMode();
        },

        runSync: () => {
          this._captureScrollPosition();
          const anyPlugin = this.plugin as any;
          if (typeof anyPlugin._runSync === "function") void anyPlugin._runSync();
          else if (typeof anyPlugin.syncBank === "function") void anyPlugin.syncBank();
          else new Notice("Sync not available (no sync method found).");
        },

        moreItems: [
          {
            label: "Reset filters",
            icon: "rotate-ccw",
            onActivate: () => {
              this._resetFilters(false);
              this.render();
            },
          },
        ],
      } as any);
    }

    // Tell header we are on the Flashcards page
    (this._header as any).install?.("flashcards" as SproutHeaderPage);

    // keep content width mode in sync
    this._applyWidthMode();

    const animationsEnabled = this.plugin.settings?.appearance?.enableAnimations ?? true;
    const applyAos = (el: HTMLElement, delay?: number, animation = "fade-up") => {
      if (!animationsEnabled) return;
      el.setAttribute("data-aos", animation);
      el.setAttribute("data-aos-anchor", '[data-sprout-browser-root="1"]');
      el.setAttribute("data-aos-anchor-placement", "top-bottom");
      el.setAttribute("data-aos-duration", "450");
      el.setAttribute("data-aos-offset", "0");
      if (Number.isFinite(delay)) el.setAttribute("data-aos-delay", String(delay));
    };

    // Cascading AOS delays (top → bottom)
    const cascadeStep = 120;
    let cascadeDelay = 0;
    const nextDelay = () => {
      cascadeDelay += cascadeStep;
      return cascadeDelay;
    };

    const title = document.createElement("div");
    title.className = "bc text-xl font-semibold tracking-tight";
    // Title appears immediately after header, no extra delay
    applyAos(title, cascadeDelay);
    title.textContent = "Flashcard Browser";
    root.appendChild(title);


    // --- Toolbar/filters section ---
    const top = document.createElement("div");
    top.className = "flex flex-col gap-2 w-full";
    root.appendChild(top);

    const toolbarRow = document.createElement("div");
    toolbarRow.className = "flex flex-row flex-wrap items-start gap-2 w-full";
    top.appendChild(toolbarRow);

    const searchGroup = document.createElement("div");
    searchGroup.className = "flex flex-row items-stretch gap-2 flex-1 min-w-[300px]";
    applyAos(searchGroup, nextDelay());
    toolbarRow.appendChild(searchGroup);

    const q = document.createElement("input");
    q.type = "text";
    q.placeholder = "Search flashcards";
    q.value = this.query;
    q.className = "input h-9 px-3 text-sm";
    q.style.flex = "1 1 300px";
    q.style.minWidth = "300px";
    q.style.width = "100%";
    q.style.height = "36px";
    q.style.boxSizing = "border-box";
    q.style.alignSelf = "stretch";
    searchGroup.appendChild(q);
    this._searchInputEl = q;

    q.addEventListener("input", () => {
      this.query = q.value;
      this.pageIndex = 0;
      this.refreshTable();
      this._markFiltersDirty();
    });
    const colsDd = this._makeColumnsDropdown({
      label: "Columns",
      options: [
        { v: "id", label: "ID" },
        { v: "type", label: "Type" },
        { v: "stage", label: "Stage" },
        { v: "due", label: "Due" },
        { v: "title", label: "Title" },
        { v: "question", label: "Question" },
        { v: "answer", label: "Answer" },
        { v: "info", label: "Info" },
        { v: "location", label: "Location" },
        { v: "groups", label: "Groups" },
      ],
      widthPx: 260,
      autoCloseMs: 10000,
    });

    const controlsRow = document.createElement("div");
    controlsRow.className = "flex flex-row flex-wrap items-center gap-2";
    applyAos(controlsRow, nextDelay());
    toolbarRow.appendChild(controlsRow);

    this._uiCleanups.push(colsDd.dispose);

    const typeDd = this._makeDropdownMenu<TypeFilter>({
      label: "Filter by type",
      value: this.typeFilter,
      options: [
        { v: "all", label: "All types" },
        { v: "basic", label: "Basic" },
        { v: "cloze", label: "Cloze" },
        { v: "io", label: "Image Occlusion" },
        { v: "mcq", label: "Multiple Choice" },
      ],
      onChange: (v) => {
        this.typeFilter = v;
        this.refreshTable();
        this._markFiltersDirty();
      },
      widthPx: 260,
    });
    controlsRow.appendChild(typeDd.root);
    this._typeFilterMenu = typeDd;
    this._uiCleanups.push(typeDd.dispose);

    const stageDd = this._makeDropdownMenu<StageFilter>({
      label: "Filter by stage",
      value: this.stageFilter,
      options: [
        { v: "all", label: "All stages" },
        { v: "new", label: "New" },
        { v: "learning", label: "Learning" },
        { v: "relearning", label: "Relearning" },
        { v: "review", label: "Review" },
        { v: "suspended", label: "Suspended" },
        { v: "quarantined", label: "Quarantined" },
      ],
      onChange: (v) => {
        this.stageFilter = v;
        this.refreshTable();
        this._markFiltersDirty();
      },
      widthPx: 240,
    });
    controlsRow.appendChild(stageDd.root);
    this._stageFilterMenu = stageDd;
    this._uiCleanups.push(stageDd.dispose);

    const dueDd = this._makeDropdownMenu<DueFilter>({
      label: "Filter by due dates",
      value: this.dueFilter,
      options: [
        { v: "all", label: "All due dates" },
        { v: "due", label: "Due now" },
        { v: "today", label: "Due today" },
        { v: "later", label: "Later" },
      ],
      onChange: (v) => {
        this.dueFilter = v;
        this.refreshTable();
        this._markFiltersDirty();
      },
      widthPx: 220,
    });
    controlsRow.appendChild(dueDd.root);
    this._dueFilterMenu = dueDd;

    const columnsWrap = document.createElement("div");
    columnsWrap.className = "flex flex-row flex-wrap items-center gap-2";
    controlsRow.appendChild(columnsWrap);
    columnsWrap.appendChild(colsDd.root);

    // Suspend / Unsuspend button (after Columns, before Edit)
    const suspendBtn = document.createElement("button");
    suspendBtn.type = "button";
    suspendBtn.className = "btn-outline h-9 px-3 text-sm inline-flex items-center gap-2";
    suspendBtn.disabled = true;
    suspendBtn.setAttribute("data-tooltip", "Suspend or Unsuspend selected cards");
    suspendBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const mode = suspendBtn.getAttribute("data-mode") === "unsuspend" ? "unsuspend" : "suspend";
      const now = Date.now();
      const ids = Array.from(this._selectedIds).filter((id) => !this.plugin.store.isQuarantined(id));
      if (ids.length === 0) return;
      try {
        let count = 0;
        for (const id of ids) {
          const prev = this.plugin.store.ensureState(id, now);
          if (mode === "unsuspend") {
            if ((prev as any).stage === "suspended") {
              const next = unsuspendCard(prev as any, now);
              this.plugin.store.upsertState(next as any);
              count += 1;
            }
          } else {
            const next = suspendCard(prev as any, now);
            this.plugin.store.upsertState(next as any);
            count += 1;
          }
        }
        await this.plugin.store.persist();
        new Notice(`${mode === "unsuspend" ? "Unsuspended" : "Suspended"} ${count} card${count === 1 ? "" : "s"}`);
        this.refreshTable();
      } catch (err: any) {
        new Notice(`${BRAND}: ${err?.message || String(err)}`);
      }
    });
    controlsRow.appendChild(suspendBtn);
    this._suspendButton = suspendBtn;
    this._updateSuspendButtonState();

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-outline h-9 px-3 text-sm inline-flex items-center gap-2";
    editBtn.disabled = true;
    editBtn.setAttribute("data-tooltip", "Edit selected cards");
    editBtn.setAttribute("aria-live", "polite");
    const editIcon = document.createElement("span");
    editIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(editIcon, "edit-3");
    editIcon.style.setProperty("transform", "scale(0.8)");
    editBtn.appendChild(editIcon);
    const editText = document.createElement("span");
    editText.textContent = "Edit";
    editBtn.appendChild(editText);
    editBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._openBulkEditModal();
    });
    controlsRow.appendChild(editBtn);
    this._editButton = editBtn;
    const resetFiltersBtn = document.createElement("button");
    resetFiltersBtn.type = "button";
    resetFiltersBtn.className = "btn-outline h-9 px-3 text-sm inline-flex items-center gap-2";
    resetFiltersBtn.disabled = true;
    resetFiltersBtn.setAttribute("data-tooltip", "Reset filters");
    const resetIcon = document.createElement("span");
    resetIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(resetIcon, "funnel-x");
    resetFiltersBtn.appendChild(resetIcon);
    const resetText = document.createElement("span");
    resetText.textContent = "Reset";
    resetFiltersBtn.appendChild(resetText);
    resetFiltersBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._resetFilters();
    });
    controlsRow.appendChild(resetFiltersBtn);
    this._resetFiltersButton = resetFiltersBtn;
    this._updateResetFiltersButtonState();
    this._uiCleanups.push(dueDd.dispose);

    // Table and controls section
    const tableWrap = document.createElement("div");
    tableWrap.className = "bc rounded-lg border border-border overflow-auto flex-1 min-h-0 sprout-browser-table-wrap";
    tableWrap.style.flex = "1 1 0%";
    tableWrap.style.minHeight = "0";
    tableWrap.style.overflow = "auto";
    tableWrap.style.maxWidth = "100%";
    tableWrap.style.boxSizing = "border-box";
    applyAos(tableWrap, nextDelay());
    root.appendChild(tableWrap);
    this._tableWrapEl = tableWrap;

    const table = document.createElement("table");
    table.className = `table w-full ${this._cellTextClass}`;
    table.style.tableLayout = "fixed";
    table.style.position = "relative";
    table.style.maxWidth = "100%";
    table.style.boxSizing = "border-box";
    tableWrap.appendChild(table);

    const colgroup = document.createElement("colgroup");
    colgroup.className = "";
    table.appendChild(colgroup);

    const selectCol = document.createElement("col");
    selectCol.className = "";
    selectCol.setAttribute("data-col", "select");
    selectCol.style.width = "42px";
    colgroup.appendChild(selectCol);

    this._colEls = {};

    const cols: ColKey[] = ["id", "type", "stage", "due", "title", "question", "answer", "info", "location", "groups"];
    this._colCount = cols.length;
    this._allCols = cols;
    for (const c of cols) this._visibleCols.add(c);
    for (const c of Array.from(this._visibleCols)) {
      if (!cols.includes(c)) this._visibleCols.delete(c);
    }

    cols.forEach((k) => {
      const c = document.createElement("col");
      c.className = "";
      c.setAttribute("data-col", k);
      c.style.width = `${this.colWidths[k] || 120}px`;
      colgroup.appendChild(c);
      this._colEls[k] = c;
    });

    const thead = document.createElement("thead");
    thead.className = "";
    table.appendChild(thead);

    const hr = document.createElement("tr");
    hr.className = "";
    hr.style.verticalAlign = "middle";
    hr.style.width = "100%";
    thead.appendChild(hr);

    const selectTh = document.createElement("th");
    selectTh.className = "text-sm font-medium text-muted-foreground select-none";
    selectTh.style.verticalAlign = "middle";
    selectTh.style.width = "42px";
    selectTh.style.position = "relative";
    selectTh.style.display = "flex";
    selectTh.style.alignItems = "center";
    selectTh.style.justifyContent = "center";
    applyStickyThStyles(selectTh, 0);
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.className = "cursor-pointer";
    selectAll.style.margin = "0";
    selectAll.style.accentColor = "var(--text-normal)";
    selectAll.addEventListener("change", (ev: Event) => {
      if (!(ev instanceof Event)) return;
      if (!ev.isTrusted) return;
      const enabled = selectAll.checked;
      for (const id of this._currentPageRowIds) this._setSelection(id, enabled);
      this._syncRowCheckboxes();
      this._updateSelectAllCheckboxState();
      this._updateSelectionIndicator();
    });
    selectTh.appendChild(selectAll);
    hr.appendChild(selectTh);
    this._selectAllCheckboxEl = selectAll;

    this._headerEls = {};

    const headCell = (label: string, key: SortKey) => {
      const th = document.createElement("th");
      th.className = `text-sm font-medium text-muted-foreground select-none cursor-pointer ${this._cellWrapClass} sprout-browser-header-cell`;
      th.setAttribute("data-col", key);
      th.style.verticalAlign = "middle";
      th.style.maxWidth = "100%";
      th.style.overflow = "visible";
      th.style.textOverflow = "clip";
      th.style.whiteSpace = "normal";
      th.style.boxSizing = "border-box";
      th.style.position = "relative"; // Ensure relative for absolute inner

      applyStickyThStyles(th, 0);

      const RESIZE_ZONE_PX = 4;
      // --- Inner header content is absolutely positioned and centered ---
      const inner = document.createElement("div");
      inner.className = "items-center h-full";
      inner.style.position = "absolute";
      inner.style.left = "0";
      inner.style.top = "0";
      inner.style.right = "0";
      inner.style.bottom = "0";
      inner.style.minHeight = "44px";
      inner.style.alignItems = "center";
      inner.style.display = "flex";
      inner.style.justifyContent = "space-between";
      inner.style.height = "100%";
      inner.style.pointerEvents = "none"; // Let resize handle get pointer events

      const lbl = document.createElement("span");
      lbl.className = "";
      lbl.textContent = label;
      lbl.style.verticalAlign = "middle";
      lbl.style.display = "inline-block";
      lbl.style.alignSelf = "center";
      lbl.style.justifyContent = "center";
      lbl.style.width = "auto";
      lbl.style.flex = "0 1 auto";
      lbl.style.minWidth = "0";
      lbl.style.whiteSpace = "normal";
      lbl.style.overflowWrap = "anywhere";
      lbl.style.wordBreak = "keep-all";
      lbl.style.pointerEvents = "auto";

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "svg-icon lucide-chevron-down sprout-browser-header-icon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.style.pointerEvents = "none";
      icon.style.opacity = "0";
      icon.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      icon.style.flexShrink = "0";
      icon.style.marginLeft = "10px";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "m6 9 6 6 6-6");
      icon.appendChild(path);

      inner.appendChild(lbl);
      inner.appendChild(icon);
      th.appendChild(inner);
      this._headerSortIcons[key] = icon;

      this._headerEls[key] = th;

      if (this.sortKey === key) {
        th.classList.add("text-foreground", "font-semibold");
        th.setAttribute("aria-sort", this.sortAsc ? "ascending" : "descending");
      } else {
        th.setAttribute("aria-sort", "none");
      }

      th.addEventListener("click", (ev) => {
        if (Date.now() < this._suppressHeaderClickUntil) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        const target = ev.target as HTMLElement | null;
        if (target?.closest?.(".sprout-col-resize")) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        this.toggleSort(key);
      });

      this.makeResizableTh(th, key as ColKey);
      // Ensure the resizer is 4px wide and has a high z-index for clickability
      // This is handled in makeResizableTh, but if not, ensure the style is set:
      // .sprout-col-resize { width: 4px !important; z-index: 50 !important; }
      return th;
    };

    hr.appendChild(headCell("Unique ID", "id"));
    hr.appendChild(headCell("Type", "type"));
    hr.appendChild(headCell("Stage", "stage"));
    hr.appendChild(headCell("Due", "due"));
    hr.appendChild(headCell("Title", "title"));
    hr.appendChild(headCell("Question", "question"));
    hr.appendChild(headCell("Answer / Options", "answer"));
    hr.appendChild(headCell("Extra Information", "info"));
    hr.appendChild(headCell("Location", "location"));
    hr.appendChild(headCell("Groups", "groups"));

    this._refreshHeaderSortStyles();


    const tbody = document.createElement("tbody");
    tbody.className = "";
    // Make tbody scrollable and table header sticky
    // The tableWrap already has flex-1 and overflow-auto, so tbody will fill available space
    // Set display block to tbody and thead for independent scrolling
    thead.style.display = "table-row-group";
    tbody.style.display = "block";
    tbody.style.overflowY = "auto";
    tbody.style.maxHeight = "none";
    tbody.style.width = "100%";
    table.appendChild(tbody);
    this._tableBody = tbody;
    this._applyColumnVisibility();

    // Make all table rows (tr) in tbody display as table-row and width 100%
    // This is handled in row rendering, but ensure CSS is correct

    // --- Bottom controls (summary, clear selection, pagination) ---
    const bottom = document.createElement("div");
    bottom.className = "flex flex-row flex-wrap items-center justify-between gap-2 mt-4";
    applyAos(bottom, nextDelay());
    root.appendChild(bottom);

    const summaryWrap = document.createElement("div");
    summaryWrap.className = "flex flex-col gap-1";
    const summary = document.createElement("div");
    summary.className = "text-sm text-muted-foreground";
    const selectionRow = document.createElement("div");
    selectionRow.className = "flex items-center gap-2";
    const selectionCount = document.createElement("div");
    selectionCount.className = "text-sm text-muted-foreground";
    selectionCount.textContent = "No cards selected";
    summaryWrap.appendChild(summary);
    selectionRow.appendChild(selectionCount);
    const clearSelection = document.createElement("div");
    clearSelection.className = "inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground cursor-pointer";
    const clearIcon = document.createElement("span");
    clearIcon.className = "inline-flex items-center justify-center [&_svg]:size-3";
    setIcon(clearIcon, "x");
    clearIcon.style.setProperty("transform", "scale(0.8)", "important");
    clearSelection.appendChild(clearIcon);
    const clearText = document.createElement("span");
    clearText.textContent = "Clear selection";
    clearSelection.appendChild(clearText);
    clearSelection.style.setProperty("display", "none", "important");
    clearSelection.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._clearSelection();
    });
    selectionRow.appendChild(clearSelection);
    summaryWrap.appendChild(selectionRow);
    bottom.appendChild(summaryWrap);
    this._summaryEl = summary;
    this._selectionCountEl = selectionCount;
    this._clearSelectionEl = clearSelection;
    const right = document.createElement("div");
    right.className = "flex flex-row flex-wrap items-center gap-2 ml-auto";
    bottom.appendChild(right);

    const rowsLbl = document.createElement("div");
    rowsLbl.className = "text-sm text-muted-foreground";
    rowsLbl.textContent = "Rows";
    right.appendChild(rowsLbl);

    const pageSizeDd = this._makeDropdownMenu<string>({
      label: "Rows per page",
      value: String(this.pageSize),
      options: ["100", "50", "25", "10", "5"].map((v) => ({ v, label: v })),
      onChange: (v) => {
        const next = Math.max(1, Math.floor(Number(v) || 25));
        this.pageSize = next;
        this.pageIndex = 0;
        this.refreshTable();
      },
      widthPx: 140,
      dropUp: true,
    });
    right.appendChild(pageSizeDd.root);
    this._uiCleanups.push(pageSizeDd.dispose);

    const pagerHost = document.createElement("div");
    pagerHost.className = "flex items-center";
    right.appendChild(pagerHost);
    this._pagerHostEl = pagerHost;

    this._refreshHeaderSortStyles();
    this.refreshTable();

    // Refresh AOS for animated elements
    if (animationsEnabled) {
      window.requestAnimationFrame(() => {
        refreshAOS();
      });
    }

    this._shouldShowAos = false;
  }
}
