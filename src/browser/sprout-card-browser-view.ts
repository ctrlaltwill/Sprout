/**
 * @file src/browser/sprout-card-browser-view.ts
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

// src/browser.ts
import { ItemView, Notice, TFile, type WorkspaceLeaf, setIcon } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_ANALYTICS, VIEW_TYPE_BROWSER, VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../core/constants";
import type { CardRecord } from "../core/store";
import { syncOneFile } from "../sync/sync-engine";
import { unsuspendCard, suspendCard } from "../scheduler/scheduler";
import { ImageOcclusionCreatorModal } from "../modals/image-occlusion-creator-modal";
import { refreshAOS } from "../core/aos-loader";
import { log } from "../core/logger";
import { queryFirst, setCssProps } from "../core/ui";
import { findCardBlockRangeById } from "../reviewer/markdown-block";

// ✅ shared header
import { type SproutHeader, createViewHeader } from "../core/header";

// ✅ extracted browser sub-modules
import { renderPagination } from "./browser-pagination";
import { openBulkEditModal } from "./browser-bulk-edit-modal";
import {
  computeBrowserRows,
  applyValueToCard,
  readCardField,
  validateCardBeforeWrite,
} from "./browser-card-data";

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
  private _cellWrapClass = "whitespace-normal break-words overflow-hidden";

  colWidths: Record<ColKey, number> = { ...DEFAULT_COL_WIDTHS };

  private _colMin: Record<ColKey, number> = {
    id: 100, type: 110, stage: 80, due: 90,
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
  private _resetFiltersButton: HTMLButtonElement | null = null;
  private _filtersDirty = false;
  private _typeFilterMenu: DropdownMenuController<TypeFilter> | null = null;
  private _stageFilterMenu: DropdownMenuController<StageFilter> | null = null;
  private _dueFilterMenu: DropdownMenuController<DueFilter> | null = null;

  private _pagerHostEl: HTMLElement | null = null;
  private _tableWrapEl: HTMLElement | null = null;
  private _emptyStateCleanup: (() => void) | null = null;

  private _rootEl: HTMLElement | null = null;
  // ✅ shared view header renderer
  private _header: SproutHeader | null = null;

  // ✅ popover cleanup for all filter dropdowns + page-size dropdown
  private _uiCleanups: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_BROWSER; }
  getDisplayText() { return "Flashcards"; }
  getIcon() { return "table-2"; }

  async onOpen() { this.render(); await Promise.resolve(); }

  async onClose() {
    try { this._header?.dispose?.(); } catch (e) { log.swallow("dispose browser header", e); }
    this._header = null;
    this._disposeUiPopovers();
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

  // ── Width mode ──────────────────────────────────────────

  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    const root = this._rootEl;
    if (root) {
      const maxWidth = this.plugin.isWideMode ? "none" : MAX_CONTENT_WIDTH_PX;
      setCssProps(root, "--sprout-browser-max-width", maxWidth);
    }

    try { this._header?.updateWidthButtonLabel?.(); } catch (e) { log.swallow("update width button label", e); }
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
        this._clearSelectionEl.classList.toggle("sprout-is-hidden", !active);
        this._clearSelectionEl.classList.toggle("sprout-pointer-auto", active);
        this._clearSelectionEl.classList.toggle("sprout-pointer-none", !active);
      }
      if (this._clearSelectionPlaceholderEl) {
        const active = count === 0;
        this._clearSelectionPlaceholderEl.classList.toggle("sprout-is-invisible", !active);
      }
    }
    this._updateEditButtonState();
    this._updateSuspendButtonState();
  }

  private _updateEditButtonState() {
    if (!this._editButton) return;
    const enabled = this._selectedIds.size > 0;
    this._editButton.disabled = !enabled;
    this._editButton.classList.toggle("sprout-opacity-60", !enabled);
  }

  private _updateSuspendButtonState() {
    if (!this._suspendButton) return;
    const ids = Array.from(this._selectedIds);
    const actionable = ids.filter((id) => !this.plugin.store.isQuarantined(id));
    const enabled = actionable.length > 0;
    this._suspendButton.disabled = !enabled;
    this._suspendButton.classList.toggle("sprout-opacity-60", !enabled);
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
    icon.classList.add("sprout-icon-scale-85");
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
    this._resetFiltersButton.classList.toggle("sprout-opacity-60", !active);
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
      const show = this._visibleCols.has(col);
      const colEl = this._colEls[col];
      if (colEl) colEl.classList.toggle("sprout-is-hidden", !show);
      table.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
        (el as HTMLElement).classList.toggle("sprout-is-hidden", !show);
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
      th.classList.toggle("sprout-browser-header-active", isSorted);
      th.setAttribute("aria-sort", isSorted ? (this.sortAsc ? "ascending" : "descending") : "none");

      const icon = this._headerSortIcons[k];
      if (icon) {
        icon.classList.add("sprout-browser-sort-icon");
        icon.classList.toggle("sprout-is-hidden", !isSorted);
        icon.classList.toggle("sprout-browser-sort-desc", isSorted && !this.sortAsc);
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
    const link = `${card.sourceNotePath}#^sprout-${card.id}`;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- fire-and-forget; Obsidian handles navigation errors internally
    this.app.workspace.openLinkText(link, card.sourceNotePath, true);
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
      new Notice(`${BRAND}: Failed to open IO editor (${e instanceof Error ? e.message : String(e)})`);
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

    openBulkEditModal(cards, {
      cellTextClass: this._cellTextClass,
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
      new Notice(`${mode === "unsuspend" ? "Unsuspended" : "Suspended"} ${count} card${count === 1 ? "" : "s"}`);
      this.refreshTable();
    } catch (err: unknown) {
      new Notice(`${BRAND}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Pagination ──────────────────────────────────────────

  private _renderPagination(totalRows: number) {
    const host = this._pagerHostEl;
    if (!host) return;
    renderPagination(host, totalRows, {
      pageIndex: this.pageIndex,
      pageSize: this.pageSize,
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

    const size = Math.max(1, Math.floor(Number(this.pageSize) || 25));
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
        this._summaryEl.textContent = total === 0 ? "Showing 0 of 0" : `Showing 0 of ${total}`;
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
      this._summaryEl.textContent = total === 0 ? "Showing 0 of 0" : `Showing ${from} to ${to} of ${total}`;
    }

    this._renderPagination(total);
    if (wrap) { wrap.scrollLeft = prevScrollLeft; wrap.scrollTop = prevScrollTop; }
    this._updateSelectionIndicator();
    this._updateSelectAllCheckboxState();
  }

  // ── render ──────────────────────────────────────────────

  render() {
    this._disposeUiPopovers();

    const root = this.contentEl;
    root.empty();
    this._rootEl = root;

    root.classList.add("bc", "sprout-view-content", "sprout-browser-view", "sprout-browser-width", "flex", "flex-col");
    root.setAttribute("data-sprout-browser-root", "1");

    this.containerEl.addClass("sprout");
    this.setTitle?.("Flashcards");

    // ✅ Universal shared header
    if (!this._header) {
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyWidthMode(),
      });
    }
    this._header.install("flashcards");
    this._applyWidthMode();

    const animationsEnabled = this.plugin.settings?.appearance?.enableAnimations ?? true;

    // Build the full layout via browser-toolbar.ts
    const refs: ToolbarRefs = buildBrowserLayout(root, {
      plugin: this.plugin,
      animationsEnabled,
      query: this.query,
      typeFilter: this.typeFilter,
      stageFilter: this.stageFilter,
      dueFilter: this.dueFilter,
      pageSize: this.pageSize,
      pageIndex: this.pageIndex,
      sortKey: this.sortKey,
      sortAsc: this.sortAsc,
      colWidths: this.colWidths,
      visibleCols: this._visibleCols,
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
      setVisibleCols: (cols) => { this._visibleCols = cols; },
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

    // Reset column tracking
    for (const c of this._allCols) this._visibleCols.add(c);
    for (const c of Array.from(this._visibleCols)) {
      if (!this._allCols.includes(c)) this._visibleCols.delete(c);
    }

    this._applyColumnVisibility();
    this._refreshHeaderSortStyles();
    this._updateResetFiltersButtonState();
    this._updateSuspendButtonState();
    this.refreshTable();

    // Refresh AOS for animated elements
    if (animationsEnabled) {
      window.requestAnimationFrame(() => { refreshAOS(); });
    }
  }
}
