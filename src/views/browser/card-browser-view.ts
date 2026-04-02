/**
 * @file src/views/browser/card-browser-view.ts
 * @summary The Flashcard Browser view — an Obsidian ItemView providing a
 * spreadsheet-style table for searching, filtering, inline-editing, and
 * bulk-managing all flashcards in the vault. Orchestrates lifecycle, selection
 * management, sort state, pagination, column visibility, and delegates heavy
 * rendering to sibling modules (browser-card-data, browser-row-renderer,
 * browser-toolbar, browser-dropdowns, browser-pagination, browser-resize,
 * browser-bulk-edit-modal, browser-helpers).
 *
 * @exports
 *   - SproutCardBrowserView — ItemView subclass that renders and manages the Flashcard Browser
 */

// src/views/browser/card-browser-view.ts
import { ItemView, Notice, TFile, type WorkspaceLeaf, setIcon } from "obsidian";
import type LearnKitPlugin from "../../main";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_ANALYTICS, VIEW_TYPE_BROWSER, VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../../platform/core/constants";
import type { CardRecord } from "../../platform/core/store";
import { persistEditedCardAndSiblings } from "../../platform/core/targeted-card-persist";
import { unsuspendCard, suspendCard } from "../../engine/scheduler/scheduler";
import { ImageOcclusionCreatorModal } from "../../platform/modals/image-occlusion-creator-modal";
import { initAOS, resetAOS } from "../../platform/core/aos-loader";
import { log } from "../../platform/core/logger";
import { queryFirst, setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { SPROUT_HOME_CONTENT_SHELL_CLASS } from "../../platform/core/ui-classes";
import { findCardBlockRangeById } from "../reviewer/markdown-block";
import { openCardAnchorInNote } from "../../platform/core/open-card-anchor";
import { t } from "../../platform/translations/translator";

// ✅ shared header
import { type SproutHeader, createViewHeader } from "../../platform/core/header";

// ✅ extracted browser sub-modules
import { renderPagination } from "./shared/browser-pagination";
import { openBulkEditModal } from "./browser-bulk-edit-modal";
import { openBulkEditModalForCards } from "../../platform/modals/bulk-edit";
import {
  computeBrowserRows,
  applyValueToCard,
  readCardField,
  validateCardBeforeWrite,
} from "./data/browser-card-data";

import {
  buildPageTableBody,
  renderEmptyState,
  clearEmptyState,
} from "./browser-row-renderer";
import { buildBrowserLayout, type ToolbarRefs } from "./browser-toolbar";

import {
  type TypeFilter,
  type StageFilter,
  type DueFilter,
  type ColKey,
  type SortKey,
  type DropdownMenuController,
  DEFAULT_COL_WIDTHS,
  clearNode,
  buildCardBlockPipeMarkdown,
} from "./browser-helpers";

type BrowserDensityMode = "comfortable" | "compact";

const BROWSER_DENSITY_STORAGE_KEY = "sprout.browser.tableDensity.v1";
const BROWSER_COLS_STORAGE_KEY = "sprout.browser.colVisibility.v1";
const COMPACT_DEFAULT_HIDDEN_COLS: ColKey[] = ["id", "stage", "due", "location"];
const ALL_COLS: ColKey[] = ["id", "type", "stage", "due", "title", "question", "answer", "info", "location", "groups"];

export class SproutCardBrowserView extends ItemView {
  plugin: LearnKitPlugin;

  query = "";
  typeFilter: TypeFilter = "all";
  stageFilter: StageFilter = "all";
  dueFilter: DueFilter = "all";

  sortKey: SortKey = "title";
  sortAsc = true;

  pageSize = 5;
  pageIndex = 0;

  private _rowHeightPx = 150;
  private _editorHeightPx = 126;

  private _cellTextClass = "text-sm leading-snug";
  private _readonlyTextClass = "text-sm leading-snug";
  private _cellWrapClass = "whitespace-normal break-words overflow-hidden";

  private _densityMode: BrowserDensityMode = "comfortable";
  private _densityButtonEls: Partial<Record<BrowserDensityMode, HTMLButtonElement>> = {};

  colWidths: Record<ColKey, number> = { ...DEFAULT_COL_WIDTHS };

  private _colMin: Record<ColKey, number> = {
    id: 120, type: 110, stage: 80, due: 90,
    title: 140, question: 140, answer: 140,
    info: 150, location: 150, groups: 200,
  };

  private _colMax: Record<ColKey, number> = {
    id: 500, type: 500, stage: 500, due: 500,
    title: 500, question: 500, answer: 500,
    info: 500, location: 500, groups: 500,
  };

  private _tableBody: HTMLTableSectionElement | null = null;
  private _headerEls: Partial<Record<SortKey, HTMLTableCellElement>> = {};
  private _headerSortIcons: Partial<Record<SortKey, SVGSVGElement>> = {};
  private _colEls: Partial<Record<ColKey, HTMLTableColElement>> = {};
  private _allCols: ColKey[] = ALL_COLS;
  private _comfortableCols = new Set<ColKey>(ALL_COLS);
  private _compactCols = new Set<ColKey>(ALL_COLS.filter(c => !COMPACT_DEFAULT_HIDDEN_COLS.includes(c)));

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
  private _resetFiltersButton: HTMLButtonElement | null = null;
  private _filtersDirty = false;
  private _typeFilterMenu: DropdownMenuController<TypeFilter> | null = null;
  private _stageFilterMenu: DropdownMenuController<StageFilter> | null = null;
  private _dueFilterMenu: DropdownMenuController<DueFilter> | null = null;

  private _pagerHostEl: HTMLElement | null = null;
  private _tableWrapEl: HTMLElement | null = null;
  private _emptyStateCleanup: (() => void) | null = null;

  private _rootEl: HTMLElement | null = null;
  private _titleStripEl: HTMLElement | null = null;
  private _didEntranceAos = false;
  // ✅ shared view header renderer
  private _header: SproutHeader | null = null;

  // ✅ popover cleanup for all filter dropdowns + page-size dropdown
  private _uiCleanups: Array<() => void> = [];
  private _mobileKeyboardCleanup: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
    this._loadDensityMode();
    this._loadColumnPrefs();
    this._applyDensityPreset();
  }

  private _tx(token: string, fallback: string, vars?: Record<string, string | number>) {
    return t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
  }

  getViewType() { return VIEW_TYPE_BROWSER; }
  getDisplayText() { return "Library"; }
  getIcon() { return "table-2"; }

  async onOpen() {
    this.render();
    if (this.plugin.settings?.general?.enableAnimations ?? true) {
      setTimeout(() => {
        initAOS({ duration: AOS_DURATION, easing: "ease-out", once: true, offset: 50 });
      }, 100);
    }
    await Promise.resolve();
  }

  async onClose() {
    try { this._header?.dispose?.(); } catch (e) { log.swallow("dispose browser header", e); }
    this._header = null;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    this._didEntranceAos = false;
    this._disposeMobileKeyboardSync();
    this._disposeUiPopovers();
    resetAOS();
    await Promise.resolve();
  }

  onRefresh() {
    if (this._tableBody) {
      this.refreshTable();
      return;
    }
    this.render();
  }

  // ── UI cleanup ──────────────────────────────────────────

  private _disposeUiPopovers() {
    const fns = this._uiCleanups.splice(0, this._uiCleanups.length);
    for (const fn of fns) {
      try { fn(); } catch (e) { log.swallow("dispose UI popover cleanup", e); }
    }
    this._typeFilterMenu = null;
    this._stageFilterMenu = null;
    this._dueFilterMenu = null;
  }

  private _disposeMobileKeyboardSync() {
    try { this._mobileKeyboardCleanup?.(); } catch (e) { log.swallow("dispose browser mobile keyboard sync", e); }
    this._mobileKeyboardCleanup = null;
  }

  private _setupMobileKeyboardSync() {
    this._disposeMobileKeyboardSync();

    const root = this._rootEl;
    if (!root) return;

    const isPhoneMobile = () =>
      document.body.classList.contains("is-mobile") && window.matchMedia("(max-width: 767px)").matches;

    const setInset = (px: number) => {
      setCssProps(root, "--lk-browser-kb-inset", `${Math.max(0, px)}px`);
    };

    if (!isPhoneMobile()) {
      setInset(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) {
      setInset(0);
      return;
    }

    const updateInset = () => {
      if (!isPhoneMobile()) {
        setInset(0);
        return;
      }
      const rawInset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const keyboardInset = rawInset >= 80 ? rawInset : 0;
      setInset(keyboardInset);
    };

    const scrollFocusedIntoView = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return;
      const editable = target.closest<HTMLElement>(
        "input, textarea, [contenteditable]:not([contenteditable='false'])",
      );
      if (!editable) return;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          try {
            editable.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
          } catch {
            // no-op
          }
        });
      });
    };

    const onFocusIn = (ev: FocusEvent) => {
      if (!isPhoneMobile()) return;
      scrollFocusedIntoView(ev.target);
      updateInset();
    };

    const onResize = () => updateInset();
    const onOrientation = () => {
      window.requestAnimationFrame(updateInset);
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onOrientation);
    root.addEventListener("focusin", onFocusIn, true);

    updateInset();

    this._mobileKeyboardCleanup = () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
      root.removeEventListener("focusin", onFocusIn, true);
      setInset(0);
    };
  }

  private _isPhoneMobile(): boolean {
    return document.body.classList.contains("is-phone");
  }

  private _effectivePageSize(): number {
    if (this._isPhoneMobile()) return 10;
    return Math.max(1, Math.floor(Number(this.pageSize) || 5));
  }

  // ── Width mode ──────────────────────────────────────────

  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-learnkit-wide", "1");
    else this.containerEl.removeAttribute("data-learnkit-wide");

    const root = this._rootEl;
    const strip = this._titleStripEl;
    if (root) {
      const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
      setCssProps(root, "--lk-home-max-width", maxWidth);
      setCssProps(root, "--lk-browser-max-width", maxWidth);
      if (strip) setCssProps(strip, "--lk-home-max-width", maxWidth);
    }

    try { this._header?.updateWidthButtonLabel?.(); } catch (e) { log.swallow("update width button label", e); }
  }

  private _loadDensityMode() {
    try {
      const raw = window.localStorage.getItem(BROWSER_DENSITY_STORAGE_KEY);
      this._densityMode = raw === "compact" ? "compact" : "comfortable";
    } catch {
      this._densityMode = "comfortable";
    }
  }

  private _saveDensityMode() {
    try {
      window.localStorage.setItem(BROWSER_DENSITY_STORAGE_KEY, this._densityMode);
    } catch {
      // Ignore storage failures (private mode / quota)
    }
  }

  private _loadColumnPrefs() {
    try {
      const raw = window.localStorage.getItem(BROWSER_COLS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const valid = new Set<ColKey>(ALL_COLS);
      for (const mode of ["comfortable", "compact"] as const) {
        const arr = parsed[mode];
        if (!Array.isArray(arr)) continue;
        const filtered = arr.filter((c): c is ColKey => valid.has(c as ColKey));
        if (filtered.length === 0) continue;
        const target = mode === "compact" ? this._compactCols : this._comfortableCols;
        target.clear();
        for (const c of filtered) target.add(c);
      }
    } catch {
      // Ignore parse failures — keep defaults
    }
  }

  private _saveColumnPrefs() {
    try {
      const data: Record<string, string[]> = {
        comfortable: Array.from(this._comfortableCols),
        compact: Array.from(this._compactCols),
      };
      window.localStorage.setItem(BROWSER_COLS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage failures (private mode / quota)
    }
  }

  private _applyDensityPreset() {
    if (this._densityMode === "compact") {
      this._rowHeightPx = 80;
      this._editorHeightPx = 56;
      this._cellTextClass = "text-xs leading-tight";
      this._readonlyTextClass = "text-xs leading-tight";
      return;
    }
    this._rowHeightPx = 150;
    this._editorHeightPx = 126;
    this._cellTextClass = "text-sm leading-snug";
    this._readonlyTextClass = "text-sm leading-snug";
  }

  private _syncDensityDataset() {
    if (!this._rootEl) return;
    this._rootEl.setAttribute("data-lk-browser-density", this._densityMode);
  }

  private get _visibleCols(): Set<ColKey> {
    return this._densityMode === "compact" ? this._compactCols : this._comfortableCols;
  }

  private _isColumnShown(col: ColKey): boolean {
    return this._visibleCols.has(col);
  }

  private _updateDensityToggleUi() {
    const comfortableBtn = this._densityButtonEls.comfortable;
    const compactBtn = this._densityButtonEls.compact;
    if (!comfortableBtn || !compactBtn) return;

    const setActive = (btn: HTMLButtonElement, active: boolean) => {
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("learnkit-btn-control", active);
      btn.classList.toggle("learnkit-btn-outline-muted", !active);
      btn.classList.toggle("lk-browser-density-btn-active", active);
    };

    setActive(comfortableBtn, this._densityMode === "comfortable");
    setActive(compactBtn, this._densityMode === "compact");
  }

  private _setDensityMode(mode: BrowserDensityMode, refresh = true) {
    if (mode !== "comfortable" && mode !== "compact") return;
    if (this._densityMode === mode) return;
    const prevMode = this._densityMode;
    this._densityMode = mode;

    // Returning to comfortable should restore full column visibility.
    if (prevMode === "compact" && mode === "comfortable") {
      this._comfortableCols.clear();
      for (const col of this._allCols) this._comfortableCols.add(col);
      this._saveColumnPrefs();
    }

    this._applyDensityPreset();
    this._syncDensityDataset();
    this._saveDensityMode();
    this._updateDensityToggleUi();
    this._applyColumnVisibility();
    if (refresh) this.refreshTable();
  }

  private _ensureTitleStrip(root: HTMLElement): void {
    this._titleStripEl?.remove();
    const frame = createTitleStripFrame({
      root,
      stripClassName: "lk-home-title-strip lk-browser-title-strip",
      rightClassName: "flex items-center gap-2 shrink-0 lk-browser-density-toggle",
    });
    const { strip, right, title, subtitle } = frame;

    title.textContent = this._tx("ui.view.browser.title", "Library");
    subtitle.textContent = this._tx("ui.view.browser.subtitle", "Search, edit, and manage your cards");

    const mkDensityBtn = (mode: BrowserDensityMode, token: string, fallback: string) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "h-9 px-3 text-sm inline-flex items-center justify-center lk-browser-density-btn";
      btn.textContent = this._tx(token, fallback);
      btn.setAttribute("data-density-mode", mode);
      btn.setAttribute("aria-pressed", this._densityMode === mode ? "true" : "false");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._setDensityMode(mode);
      });
      this._densityButtonEls[mode] = btn;
      return btn;
    };

    right.appendChild(mkDensityBtn("comfortable", "ui.browser.viewMode.comfortable", "Comfortable"));
    right.appendChild(mkDensityBtn("compact", "ui.browser.viewMode.compact", "Compact"));

    this._titleStripEl = strip;
    this._updateDensityToggleUi();
  }

  // ── Selection management ────────────────────────────────

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
    for (const id of ids) this._setSelection(id, false);
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
        this._clearSelectionEl.classList.toggle("learnkit-is-hidden", !active);
        this._clearSelectionEl.classList.toggle("learnkit-pointer-auto", active);
        this._clearSelectionEl.classList.toggle("pointer-events-none", !active);
      }
      if (this._clearSelectionPlaceholderEl) {
        const active = count === 0;
        this._clearSelectionPlaceholderEl.classList.toggle("invisible", !active);
      }
    }
    this._updateEditButtonState();
    this._updateSuspendButtonState();
  }

  private _updateEditButtonState() {
    if (!this._editButton) return;
    const enabled = this._selectedIds.size > 0;
    this._editButton.disabled = !enabled;
    this._editButton.classList.toggle("opacity-60", !enabled);
  }

  private _updateSuspendButtonState() {
    if (!this._suspendButton) return;
    const ids = Array.from(this._selectedIds);
    const actionable = ids.filter((id) => !this.plugin.store.isQuarantined(id));
    const enabled = actionable.length > 0;
    this._suspendButton.disabled = !enabled;
    this._suspendButton.classList.toggle("opacity-60", !enabled);
    clearNode(this._suspendButton);
    const allSuspended = enabled && actionable.every((id) => {
      const s = this.plugin.store.getState(id);
      return !!s && s.stage === "suspended";
    });
    const mode = allSuspended ? "unsuspend" : "suspend";
    this._suspendButton.setAttribute("data-mode", mode);
    const icon = document.createElement("span");
    icon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    setIcon(icon, mode === "unsuspend" ? "circle-play" : "circle-pause");
    icon.classList.add("scale-[0.85]");
    this._suspendButton.appendChild(icon);
    const text = document.createElement("span");
    text.textContent = mode === "unsuspend" ? "Unsuspend" : "Suspend";
    this._suspendButton.appendChild(text);
  }

  private _updateSelectAllCheckboxState() {
    const checkbox = this._selectAllCheckboxEl;
    if (!checkbox) return;
    const total = this._currentPageRowIds.length;
    if (total === 0) { checkbox.checked = false; checkbox.indeterminate = false; return; }
    const selectedOnPage = this._currentPageRowIds.filter((id) => this._selectedIds.has(id)).length;
    checkbox.checked = selectedOnPage > 0 && selectedOnPage === total;
    checkbox.indeterminate = selectedOnPage > 0 && selectedOnPage < total;
  }

  private _syncRowCheckboxes() {
    if (!this._tableBody) return;
    this._tableBody.querySelectorAll<HTMLInputElement>("input[data-card-id]").forEach((checkbox) => {
      const id = checkbox.getAttribute("data-card-id");
      if (!id) return;
      checkbox.checked = this._selectedIds.has(id);
    });
  }

  // ── Filter state ────────────────────────────────────────

  private _markFiltersDirty() {
    const dirty = Boolean(this.query) || this.typeFilter !== "all" || this.stageFilter !== "all" || this.dueFilter !== "all";
    if (dirty === this._filtersDirty) return;
    this._filtersDirty = dirty;
    this._updateResetFiltersButtonState();
  }

  private _updateResetFiltersButtonState() {
    if (!this._resetFiltersButton) return;
    const active = this._filtersDirty;
    this._resetFiltersButton.disabled = !active;
    this._resetFiltersButton.classList.toggle("opacity-60", !active);
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

  // ── Column visibility ───────────────────────────────────

  private _applyColumnVisibility() {
    if (!this._rootEl) return;
    const table = queryFirst(this._rootEl, "table");
    if (!table) return;

    for (const col of this._allCols) {
      const show = this._isColumnShown(col);
      const colEl = this._colEls[col];
      if (colEl) colEl.classList.toggle("learnkit-is-hidden", !show);
      table.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
        (el as HTMLElement).classList.toggle("learnkit-is-hidden", !show);
      });
    }
  }

  // ── Sort ────────────────────────────────────────────────

  private _refreshHeaderSortStyles() {
    for (const k of Object.keys(this._headerEls) as SortKey[]) {
      const th = this._headerEls[k];
      if (!th) continue;
      const isSorted = k === this.sortKey;
      th.classList.toggle("text-foreground", isSorted);
      th.classList.toggle("text-muted-foreground", !isSorted);
      th.classList.toggle("font-semibold", isSorted);
      th.classList.toggle("lk-browser-header-active", isSorted);
      th.setAttribute("aria-sort", isSorted ? (this.sortAsc ? "ascending" : "descending") : "none");

      const icon = this._headerSortIcons[k];
      if (icon) {
        icon.classList.add("inline-flex", "opacity-100", "transition-all", "duration-200", "ease-in-out");
        icon.classList.toggle("learnkit-is-hidden", !isSorted);
        icon.classList.toggle("rotate-180", isSorted && !this.sortAsc);
      }
    }
  }

  private toggleSort(key: SortKey) {
    if (Date.now() < this._suppressHeaderClickUntil) return;
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else { this.sortKey = key; this.sortAsc = true; }
    this._refreshHeaderSortStyles();
    this.refreshTable();
  }

  // ── Card operations ─────────────────────────────────────

  private openSource(card: CardRecord) {
    void openCardAnchorInNote(this.app, String(card.sourceNotePath || ""), String(card.id || ""));
  }

  private async writeCardToMarkdown(card: CardRecord) {
    const file = this.app.vault.getAbstractFileByPath(card.sourceNotePath);
    if (!(file instanceof TFile)) throw new Error(`Source note not found: ${card.sourceNotePath}`);

    validateCardBeforeWrite(card);

    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);
    const { start, end } = findCardBlockRangeById(lines, card.id);
    const block = buildCardBlockPipeMarkdown(card.id, card);
    lines.splice(start, end - start, ...block);

    await this.app.vault.modify(file, lines.join("\n"));

    await persistEditedCardAndSiblings(this.plugin, card);
    new Notice(this._tx("ui.browser.notice.saved", "Saved changes to flashcards"));

    this.refreshTable();

    const refreshLeaves = (leaves: WorkspaceLeaf[], skipLeaf?: WorkspaceLeaf) => {
      for (const leaf of leaves) {
        if (skipLeaf && leaf === skipLeaf) continue;
        (leaf.view as { onRefresh?(): void })?.onRefresh?.();
      }
    };

    const ws = this.app.workspace;
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_REVIEWER));
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_WIDGET));
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_ANALYTICS));
    refreshLeaves(ws.getLeavesOfType(VIEW_TYPE_BROWSER), this.leaf);
  }

  private _openIoEditor(cardId: string) {
    try {
      const cards = this.plugin.store.data.cards || {};
      const raw = cards[String(cardId)];
      const parentId = raw && raw.type === "io-child" ? String(raw.parentId || "") : String(cardId);
      ImageOcclusionCreatorModal.openForParent(this.plugin, parentId, {
        onClose: () => { this.onRefresh(); },
      });
    } catch (e: unknown) {
      new Notice(this._tx("ui.browser.notice.ioEditorFailed", "Failed to open image occlusion editor ({error})", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private _openBulkEditModal() {
    if (this._selectedIds.size === 0) return;

    const cardsMap = this.plugin.store.data.cards || {};
    const cards = Array.from(this._selectedIds)
      .map((id) => cardsMap[id])
      .filter((card): card is CardRecord => !!card);
    if (!cards.length) return;

    if (cards.length === 1 && (cards[0].type === "io" || cards[0].type === "io-child")) {
      this._openIoEditor(cards[0].id);
      return;
    }

    if (cards.length === 1) {
      openBulkEditModalForCards(this.plugin, cards, async (updatedCards) => {
        for (const updatedCard of updatedCards) {
          await this.writeCardToMarkdown(updatedCard);
        }
      });
      return;
    }

    openBulkEditModal(this.app, cards, {
      cellTextClass: this._cellTextClass,
      interfaceLanguage: this.plugin.settings?.general?.interfaceLanguage,
      readCardField: (card, col) => readCardField(card, col, this.plugin),
      applyValueToCard: (card, col, value) => applyValueToCard(card, col, value),
      writeCardToMarkdown: (card) => this.writeCardToMarkdown(card),
      getAllCards: () => this.plugin.store.getAllCards(),
    });
  }

  private async _suspendSelected() {
    const mode = this._suspendButton?.getAttribute("data-mode") === "unsuspend" ? "unsuspend" : "suspend";
    const now = Date.now();
    const ids = Array.from(this._selectedIds).filter((id) => !this.plugin.store.isQuarantined(id));
    if (ids.length === 0) return;
    try {
      let count = 0;
      for (const id of ids) {
        const prev = this.plugin.store.ensureState(id, now);
        if (mode === "unsuspend") {
          if (prev.stage === "suspended") {
            const next = unsuspendCard(prev, now);
            this.plugin.store.upsertState(next);
            count += 1;
          }
        } else {
          const next = suspendCard(prev, now);
          this.plugin.store.upsertState(next);
          count += 1;
        }
      }
      await this.plugin.store.persist();
      new Notice(this._tx("ui.browser.notice.suspendResult", "{mode} {count} card{suffix}", {
        mode: mode === "unsuspend"
          ? this._tx("ui.browser.notice.mode.unsuspended", "Unsuspended")
          : this._tx("ui.browser.notice.mode.suspended", "Suspended"),
        count,
        suffix: count === 1 ? "" : "s",
      }));
      this.refreshTable();
    } catch (err: unknown) {
      new Notice(`${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Pagination ──────────────────────────────────────────

  private _renderPagination(totalRows: number) {
    const host = this._pagerHostEl;
    if (!host) return;
    renderPagination(host, totalRows, {
      pageIndex: this.pageIndex,
      pageSize: this._effectivePageSize(),
      interfaceLanguage: this.plugin.settings?.general?.interfaceLanguage,
      setPageIndex: (idx) => { this.pageIndex = idx; },
      refreshTable: () => this.refreshTable(),
    });
  }

  // ── refreshTable ────────────────────────────────────────

  refreshTable() {
    const oldTbody = this._tableBody;
    if (!oldTbody) return;
    const wrap = this._tableWrapEl;
    const prevScrollLeft = wrap ? wrap.scrollLeft : 0;
    const prevScrollTop = wrap ? wrap.scrollTop : 0;

    const rows = computeBrowserRows(
      this.plugin, this.query, this.typeFilter, this.stageFilter,
      this.dueFilter, this.sortKey, this.sortAsc,
    );
    const total = rows.length;

    const size = this._effectivePageSize();
    const totalPages = Math.max(1, Math.ceil(total / size));
    if (this.pageIndex > totalPages - 1) this.pageIndex = Math.max(0, totalPages - 1);
    if (this.pageIndex < 0) this.pageIndex = 0;

    const startIdx = total === 0 ? 0 : this.pageIndex * size;
    const endIdx = total === 0 ? 0 : Math.min(total, startIdx + size);
    const pageRows = total === 0 ? [] : rows.slice(startIdx, endIdx);
    this._currentPageRowIds = pageRows.map(({ card }) => String(card.id));
    this._lastShiftSelectionIndex = null;

    if (pageRows.length === 0) {
      // Empty page — show empty-state message
      const emptyTbody = document.createElement("tbody");
      emptyTbody.className = "";
      oldTbody.replaceWith(emptyTbody);
      this._tableBody = emptyTbody;
      this._applyColumnVisibility();

      if (this._emptyStateCleanup) { this._emptyStateCleanup(); this._emptyStateCleanup = null; }
      const { cleanup } = renderEmptyState(this._rootEl, total);
      this._emptyStateCleanup = cleanup;

      if (this._summaryEl) {
        this._summaryEl.textContent = total === 0
          ? this._tx("ui.browser.summary.showingZeroOfZero", "Showing 0 of 0")
          : this._tx("ui.browser.summary.showingZeroOfTotal", "Showing 0 of {total}", { total });
      }
      this._renderPagination(total);
      return;
    }

    // Clear previous empty state
    clearEmptyState(this._rootEl);
    if (this._emptyStateCleanup) { this._emptyStateCleanup(); this._emptyStateCleanup = null; }

    // Build the new table body via the row renderer
    const newTbody = buildPageTableBody(pageRows, {
      app: this.app,
      plugin: this.plugin,
      rowHeightPx: this._rowHeightPx,
      editorHeightPx: this._editorHeightPx,
      cellTextClass: this._cellTextClass,
      readonlyTextClass: this._readonlyTextClass,
      cellWrapClass: this._cellWrapClass,
      densityMode: this._densityMode,
      saving: this._saving,
      selectedIds: this._selectedIds,
      tableWrapEl: this._tableWrapEl,
      setSelection: (id, sel) => this._setSelection(id, sel),
      syncRowCheckboxes: () => this._syncRowCheckboxes(),
      updateSelectionIndicator: () => this._updateSelectionIndicator(),
      updateSelectAllCheckboxState: () => this._updateSelectAllCheckboxState(),
      getLastShiftSelectionIndex: () => this._lastShiftSelectionIndex,
      setLastShiftSelectionIndex: (idx) => { this._lastShiftSelectionIndex = idx; },
      applyValueToCard: (card, col, value) => applyValueToCard(card, col, value),
      writeCardToMarkdown: (card) => this.writeCardToMarkdown(card),
      openSource: (card) => this.openSource(card),
      openIoEditor: (cardId) => this._openIoEditor(cardId),
    });

    oldTbody.replaceWith(newTbody);
    this._tableBody = newTbody;
    this._applyColumnVisibility();

    if (this._summaryEl) {
      const from = total === 0 ? 0 : startIdx + 1;
      const to = total === 0 ? 0 : endIdx;
      const isPhoneMobile = this._isPhoneMobile();
      this._summaryEl.textContent = total === 0
        ? this._tx("ui.browser.summary.showingZeroOfZero", "Showing 0 of 0")
        : isPhoneMobile
          ? this._tx("ui.browser.summary.showingCountOfTotal", "Showing {count} of {total}", { count: to, total })
          : this._tx("ui.browser.summary.showingRange", "Showing {from} to {to} of {total}", { from, to, total });
    }

    this._renderPagination(total);
    if (wrap) { wrap.scrollLeft = prevScrollLeft; wrap.scrollTop = prevScrollTop; }
    this._updateSelectionIndicator();
    this._updateSelectAllCheckboxState();
  }

  // ── render ──────────────────────────────────────────────

  render() {
    this._disposeMobileKeyboardSync();
    this._disposeUiPopovers();

    const root = this.contentEl;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    root.empty();
    this._rootEl = root;

    root.classList.add("learnkit-view-content", "learnkit-view-content", "lk-browser-view", "lk-browser-width");
    root.setAttribute("data-lk-browser-root", "1");
    this._syncDensityDataset();

    this.containerEl.addClass("learnkit");
    this._ensureTitleStrip(root);

    // ✅ Universal shared header
    if (!this._header) {
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyWidthMode(),
      });
    }
    this._header.install("library");
    this._applyWidthMode();

    const contentShell = document.createElement("div");
    contentShell.className = `${SPROUT_HOME_CONTENT_SHELL_CLASS} lk-browser-content-shell`;
    root.appendChild(contentShell);

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    const titleStripEl =
      this._titleStripEl ?? root.querySelector<HTMLElement>(":scope > .lk-home-title-strip.lk-browser-title-strip");
    if (animationsEnabled && !this._didEntranceAos) {
      if (titleStripEl) {
        titleStripEl.removeAttribute("data-aos");
        titleStripEl.removeAttribute("data-aos-delay");
        titleStripEl.removeAttribute("data-aos-anchor-placement");
        titleStripEl.removeAttribute("data-aos-duration");
        titleStripEl.classList.remove("lk-browser-enter-title");
        // Force reflow so reopening the view can replay the entrance class.
        void titleStripEl.offsetWidth;
        titleStripEl.classList.add("lk-browser-enter-title");
      }
      contentShell.removeAttribute("data-aos");
      contentShell.removeAttribute("data-aos-delay");
      contentShell.removeAttribute("data-aos-anchor-placement");
      contentShell.removeAttribute("data-aos-duration");
      contentShell.classList.remove("lk-browser-enter-shell");
      void contentShell.offsetWidth;
      contentShell.classList.add("lk-browser-enter-shell");

      titleStripEl?.classList.remove("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
      contentShell.classList.remove("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
    } else {
      if (titleStripEl) {
        titleStripEl.removeAttribute("data-aos");
        titleStripEl.removeAttribute("data-aos-delay");
        titleStripEl.removeAttribute("data-aos-anchor-placement");
        titleStripEl.removeAttribute("data-aos-duration");
        titleStripEl.classList.remove("lk-browser-enter-title");
        titleStripEl.classList.add("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
      }
      contentShell.removeAttribute("data-aos");
      contentShell.removeAttribute("data-aos-delay");
      contentShell.removeAttribute("data-aos-anchor-placement");
      contentShell.removeAttribute("data-aos-duration");
      contentShell.classList.remove("lk-browser-enter-shell");
      contentShell.classList.add("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
    }

    // Build the full layout via browser-toolbar.ts
    const refs: ToolbarRefs = buildBrowserLayout(contentShell, {
      plugin: this.plugin,
      animationsEnabled,
      internalAosEnabled: false,
      query: this.query,
      typeFilter: this.typeFilter,
      stageFilter: this.stageFilter,
      dueFilter: this.dueFilter,
      pageSize: this._effectivePageSize(),
      pageIndex: this.pageIndex,
      sortKey: this.sortKey,
      sortAsc: this.sortAsc,
      colWidths: this.colWidths,
      getVisibleCols: () => this._visibleCols,
      allCols: this._allCols,
      cellWrapClass: this._cellWrapClass,
      colMin: this._colMin,
      colMax: this._colMax,
      setQuery: (v) => { this.query = v; },
      setTypeFilter: (v) => { this.typeFilter = v; },
      setStageFilter: (v) => { this.stageFilter = v; },
      setDueFilter: (v) => { this.dueFilter = v; },
      setPageSize: (v) => { this.pageSize = v; },
      setPageIndex: (v) => { this.pageIndex = v; },
      setSuppressHeaderClickUntil: (ts) => { this._suppressHeaderClickUntil = ts; },
      refreshTable: () => this.refreshTable(),
      toggleSort: (key) => this.toggleSort(key),
      markFiltersDirty: () => this._markFiltersDirty(),
      resetFilters: () => this._resetFilters(),
      openBulkEditModal: () => this._openBulkEditModal(),
      suspendSelected: () => { void this._suspendSelected(); },
      clearSelection: () => this._clearSelection(),
      setVisibleCols: (cols) => {
        const target = this._visibleCols;
        target.clear();
        for (const c of cols) target.add(c);
        this._saveColumnPrefs();
      },
      applyColumnVisibility: () => this._applyColumnVisibility(),
    });

    // Store element references
    this._searchInputEl = refs.searchInputEl;
    this._editButton = refs.editButton;
    this._suspendButton = refs.suspendButton;
    this._resetFiltersButton = refs.resetFiltersButton;
    this._typeFilterMenu = refs.typeFilterMenu;
    this._stageFilterMenu = refs.stageFilterMenu;
    this._dueFilterMenu = refs.dueFilterMenu;
    this._summaryEl = refs.summaryEl;
    this._selectionCountEl = refs.selectionCountEl;
    this._clearSelectionEl = refs.clearSelectionEl;
    this._selectAllCheckboxEl = refs.selectAllCheckboxEl;
    this._pagerHostEl = refs.pagerHostEl;
    this._tableWrapEl = refs.tableWrapEl;
    this._tableBody = refs.tableBody;
    this._headerEls = refs.headerEls;
    this._headerSortIcons = refs.headerSortIcons;
    this._colEls = refs.colEls;
    this._uiCleanups = refs.uiCleanups;

    // Wire select-all checkbox
    refs.selectAllCheckboxEl.addEventListener("change", (ev: Event) => {
      if (!(ev instanceof Event)) return;
      if (!ev.isTrusted) return;
      const enabled = refs.selectAllCheckboxEl.checked;
      for (const id of this._currentPageRowIds) this._setSelection(id, enabled);
      this._syncRowCheckboxes();
      this._updateSelectAllCheckboxState();
      this._updateSelectionIndicator();
    });

    // Prune any stale cols that no longer exist
    for (const s of [this._comfortableCols, this._compactCols]) {
      for (const c of Array.from(s)) {
        if (!this._allCols.includes(c)) s.delete(c);
      }
    }

    this._applyColumnVisibility();
    this._updateDensityToggleUi();
    this._refreshHeaderSortStyles();
    this._updateResetFiltersButtonState();
    this._updateSuspendButtonState();
    this.refreshTable();
    this._setupMobileKeyboardSync();

    if (animationsEnabled && !this._didEntranceAos) {
      this._didEntranceAos = true;
    }

  }
}
