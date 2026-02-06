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
import { AOS_CASCADE_STEP, BRAND, MAX_CONTENT_WIDTH_PX, POPOVER_Z_INDEX, VIEW_TYPE_ANALYTICS, VIEW_TYPE_BROWSER, VIEW_TYPE_REVIEWER, VIEW_TYPE_WIDGET } from "../core/constants";
import type { CardRecord, CardState } from "../core/store";
import { syncOneFile } from "../sync/sync-engine";
import { unsuspendCard, suspendCard } from "../scheduler/scheduler";
import { getGroupIndex, normaliseGroupPath } from "../indexes/group-index";
import { ImageOcclusionCreatorModal } from "../modals/image-occlusion-creator-modal";
import { refreshAOS } from "../core/aos-loader";
import { log } from "../core/logger";

// ✅ shared header (you placed it at src/header.ts)
import { type SproutHeader, createViewHeader } from "../core/header";

// ✅ moved helpers
import { fmtGroups, coerceGroups } from "../indexes/group-format";
import {
  buildAnswerOrOptionsFor,
  buildQuestionFor,
  parseMcqOptionsFromCell,
  validateClozeText,
} from "../reviewer/fields";
import { stageLabel } from "../reviewer/labels";
import { findCardBlockRangeById } from "../reviewer/markdown-block";

// ✅ extracted browser sub-modules
import { makeDropdownMenu, makeColumnsDropdown } from "./browser-dropdowns";
import { renderPagination } from "./browser-pagination";
import { makeResizableTh } from "./browser-resize";
import { openBulkEditModal } from "./browser-bulk-edit-modal";

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

  onOpen() {
    this.render();
  }

  onClose() {
    try {
      this._header?.dispose?.();
    } catch (e) { log.swallow("dispose browser header", e); }
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
      } catch (e) { log.swallow("dispose UI popover cleanup", e); }
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
        root.style.setProperty("max-width", MAX_CONTENT_WIDTH_PX, "important");
        root.style.setProperty("width", "100%", "important");
      }
      root.style.setProperty("margin-left", "auto", "important");
      root.style.setProperty("margin-right", "auto", "important");
    }

    // keep header button label in sync
    try {
      this._header?.updateWidthButtonLabel?.();
    } catch (e) { log.swallow("update width button label", e); }
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
    label: string;
    value: T;
    options: Array<DropdownOption<T>>;
    onChange: (v: T) => void;
    widthPx?: number;
    dropUp?: boolean;
  }): { root: HTMLElement; setValue: (v: T) => void; dispose: () => void } {
    return makeDropdownMenu({
      ...args,
      onBeforeChange: () => { this.pageIndex = 0; },
    });
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
    return makeColumnsDropdown(args, {
      getVisibleCols: () => this._visibleCols,
      setVisibleCols: (cols) => { this._visibleCols = cols; },
      applyColumnVisibility: () => this._applyColumnVisibility(),
    });
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
      const cardsObj = (this.plugin.store.data.cards || {});

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

  private openSource(card: CardRecord) {
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
      const cards = (this.plugin.store.data.cards || {});
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

    const cardsMap = (this.plugin.store.data.cards || {});
    const cards = Array.from(this._selectedIds)
      .map((id) => cardsMap[id])
      .filter((card): card is CardRecord => !!card);
    if (!cards.length) return;

    // If single IO card selected, open IO editor instead
    if (cards.length === 1 && (cards[0].type === "io" || cards[0].type === "io-child")) {
      this._openIoEditor(cards[0].id);
      return;
    }

    openBulkEditModal(cards, {
      cellTextClass: this._cellTextClass,
      readCardField: (card, col) => this._readCardField(card, col),
      applyValueToCard: (card, col, value) => this.applyValueToCard(card, col, value),
      writeCardToMarkdown: (card) => this.writeCardToMarkdown(card),
      getAllCards: () => this.plugin.store.getAllCards(),
    });
  }

  private makeResizableTh(th: HTMLTableCellElement, col: ColKey) {
    makeResizableTh(th, col, {
      colWidths: this.colWidths,
      colEls: this._colEls,
      colMin: this._colMin,
      colMax: this._colMax,
      setSuppressHeaderClickUntil: (ts) => { this._suppressHeaderClickUntil = ts; },
    });
  }

  // ✅ pagination — delegated to browser-pagination.ts
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
      } catch (e) { log.swallow("scale link icon", e); }

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
          td.className =
            `align-top ${this._readonlyTextClass} ${this._cellWrapClass} text-muted-foreground`;
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
                ? rects.filter((r: any) => rectIds.includes(String((r).rectId)))
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

        ta.addEventListener("blur", () => {
          void (async () => {
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
          })();
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
              void commit();
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
        popover.style.setProperty("z-index", POPOVER_Z_INDEX, "important");
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
          } catch (e) { log.swallow("popover cleanup", e); }
          cleanup = null;
          try {
            popover.remove();
          } catch (e) { log.swallow("remove popover", e); }
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
          if ((ev).button !== 0) return;
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
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyWidthMode(),
        beforeSync: () => this._captureScrollPosition(),
      });
    }

    this._header.install("flashcards");

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
    const cascadeStep = AOS_CASCADE_STEP;
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
    suspendBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void (async () => {
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
      })();
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

      this.makeResizableTh(th, key);
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
