/**
 * @file src/browser/browser-toolbar.ts
 * @summary Builds the complete Flashcard Browser layout: the toolbar (search
 * input, filter dropdowns, action buttons), the table structure (colgroup,
 * thead with sortable/resizable headers, empty tbody), and the bottom controls
 * (summary text, selection indicator, page-size picker, pagination host).
 * Extracted from SproutCardBrowserView.render() to keep the view class focused
 * on lifecycle and orchestration.
 *
 * @exports
 *   - ToolbarContext — interface describing all state and callbacks the layout builder needs from the view
 *   - ToolbarRefs — interface containing DOM element references returned to the view after layout creation
 *   - buildBrowserLayout — builds the full Browser UI into a root element and returns ToolbarRefs
 */

import { setIcon } from "obsidian";
import type LearnKitPlugin from "../../main";
import {
  AOS_CASCADE_STEP,
} from "../../platform/core/constants";
import { setCssProps } from "../../platform/core/ui";
import type {
  ColKey,
  SortKey,
  TypeFilter,
  StageFilter,
  DueFilter,
  DropdownMenuController,
} from "./browser-helpers";
import {
  applyStickyThStyles,
} from "./browser-helpers";
import { makeDropdownMenu, makeColumnsDropdown } from "./shared/browser-dropdowns";
import { makeResizableTh } from "./shared/browser-resize";
import { t } from "../../platform/translations/translator";

// ── Context / result interfaces ───────────────────────────

export interface ToolbarContext {
  plugin: LearnKitPlugin;
  animationsEnabled: boolean;
  internalAosEnabled?: boolean;

  query: string;
  typeFilter: TypeFilter;
  stageFilter: StageFilter;
  dueFilter: DueFilter;
  pageSize: number;
  pageIndex: number;

  sortKey: SortKey;
  sortAsc: boolean;
  colWidths: Record<ColKey, number>;
  getVisibleCols: () => Set<ColKey>;
  allCols: ColKey[];

  cellWrapClass: string;

  colMin: Record<ColKey, number>;
  colMax: Record<ColKey, number>;

  setQuery(v: string): void;
  setTypeFilter(v: TypeFilter): void;
  setStageFilter(v: StageFilter): void;
  setDueFilter(v: DueFilter): void;
  setPageSize(v: number): void;
  setPageIndex(v: number): void;
  setSuppressHeaderClickUntil(ts: number): void;

  refreshTable(): void;
  toggleSort(key: SortKey): void;
  markFiltersDirty(): void;
  resetFilters(): void;
  openBulkEditModal(): void;
  suspendSelected(): void;
  clearSelection(): void;

  setVisibleCols(cols: Set<ColKey>): void;
  applyColumnVisibility(): void;
}

export interface ToolbarRefs {
  searchInputEl: HTMLInputElement;
  editButton: HTMLButtonElement;
  suspendButton: HTMLButtonElement;
  resetFiltersButton: HTMLButtonElement;
  typeFilterMenu: DropdownMenuController<TypeFilter>;
  stageFilterMenu: DropdownMenuController<StageFilter>;
  dueFilterMenu: DropdownMenuController<DueFilter>;
  summaryEl: HTMLElement;
  selectionCountEl: HTMLElement;
  clearSelectionEl: HTMLElement;
  selectAllCheckboxEl: HTMLInputElement;
  pagerHostEl: HTMLElement;
  tableWrapEl: HTMLElement;
  tableBody: HTMLTableSectionElement;
  headerEls: Partial<Record<SortKey, HTMLTableCellElement>>;
  headerSortIcons: Partial<Record<SortKey, SVGSVGElement>>;
  colEls: Partial<Record<ColKey, HTMLTableColElement>>;
  uiCleanups: Array<() => void>;
}

// ── applyAos helper ───────────────────────────────────────

function makeAosFn(animationsEnabled: boolean) {
  let cascadeDelay = 0;
  const applyAos = (el: HTMLElement, delay?: number, animation = "fade-up") => {
    if (!animationsEnabled) return;
    el.setAttribute("data-aos", animation);
    el.setAttribute("data-aos-anchor", '[data-lk-browser-root="1"]');
    el.setAttribute("data-aos-anchor-placement", "top-bottom");
    el.setAttribute("data-aos-duration", "600");
    el.setAttribute("data-aos-offset", "0");
    if (Number.isFinite(delay)) el.setAttribute("data-aos-delay", String(delay));
  };
  const nextDelay = () => { cascadeDelay += AOS_CASCADE_STEP; return cascadeDelay; };
  return { applyAos, nextDelay, getCascadeDelay: () => cascadeDelay };
}

// ── Main entry point ──────────────────────────────────────

/**
 * Build the complete Browser UI into `root`:
 *   title → toolbar → table (colgroup + thead + empty tbody) → bottom controls.
 *
 * Returns references to DOM elements that the view class needs to keep.
 */
export function buildBrowserLayout(
  root: HTMLElement,
  ctx: ToolbarContext,
): ToolbarRefs {
  const { applyAos } = makeAosFn(ctx.animationsEnabled && (ctx.internalAosEnabled ?? true));
  const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
    t(ctx.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);

  const uiCleanups: Array<() => void> = [];

  // ── Toolbar / filters ──
  const top = document.createElement("div");
  top.className = "flex flex-col gap-4 w-full lk-browser-cards-stack";
  root.appendChild(top);

  const searchCard = document.createElement("div");
  searchCard.className = "card lk-browser-card lk-browser-search-card";
  applyAos(searchCard, 0);
  top.appendChild(searchCard);

  const searchRow = document.createElement("div");
  searchRow.className = "flex flex-row flex-wrap items-start gap-3 w-full lk-browser-toolbar-row";
  searchCard.appendChild(searchRow);

  // Search input
  const searchGroup = document.createElement("div");
  searchGroup.className = "flex flex-row items-stretch gap-2 flex-1 min-w-[200px] lk-browser-search-group";
  searchRow.appendChild(searchGroup);

  const q = document.createElement("input");
  q.type = "text";
  q.placeholder = tx("ui.browser.search.placeholder", "Search flashcards");
  q.value = ctx.query;
  q.className = "input h-9 px-3 text-sm lk-browser-search-input";
  searchGroup.appendChild(q);

  q.addEventListener("input", () => {
    ctx.setQuery(q.value);
    ctx.setPageIndex(0);
    ctx.refreshTable();
    ctx.markFiltersDirty();
  });

  // Columns dropdown
  const colsDd = makeColumnsDropdown(
    {
      label: tx("ui.browser.columns.label", "Columns"),
      options: [
        { v: "id", label: tx("ui.browser.column.cardId", "Card ID") },
        { v: "type", label: tx("ui.browser.column.type", "Type") },
        { v: "stage", label: tx("ui.browser.column.stage", "Stage") },
        { v: "due", label: tx("ui.browser.column.due", "Due") },
        { v: "title", label: tx("ui.browser.column.title", "Title") },
        { v: "question", label: tx("ui.browser.column.question", "Question") },
        { v: "answer", label: tx("ui.browser.column.answer", "Answer") },
        { v: "info", label: tx("ui.browser.column.info", "Extra information") },
        { v: "location", label: tx("ui.browser.column.location", "Location") },
        { v: "groups", label: tx("ui.browser.column.groups", "Groups") },
      ],
      widthPx: 260,
      autoCloseMs: 10000,
    },
    {
      getVisibleCols: () => ctx.getVisibleCols(),
      setVisibleCols: (cols) => ctx.setVisibleCols(cols),
      applyColumnVisibility: () => ctx.applyColumnVisibility(),
    },
  );
  uiCleanups.push(colsDd.dispose);

  // Controls row
  const controlsRow = document.createElement("div");
  const controlsCard = document.createElement("div");
  controlsCard.className = "card lk-browser-card lk-browser-controls-card";
  applyAos(controlsCard, 120);
  top.appendChild(controlsCard);

  controlsRow.className = "flex flex-row flex-wrap items-center gap-1.5 lk-browser-controls-row";
  controlsCard.appendChild(controlsRow);

  // Type filter
  const typeDd = makeDropdownMenu<TypeFilter>({
    label: tx("ui.browser.filter.type", "Filter by type"),
    value: ctx.typeFilter,
    options: [
      { v: "all", label: tx("ui.browser.filter.type.all", "All types") },
      { v: "basic", label: tx("ui.browser.filter.type.basic", "Basic") },
      { v: "reversed", label: tx("ui.browser.filter.type.reversed", "Basic (reversed)") },
      { v: "cloze", label: tx("ui.browser.filter.type.cloze", "Cloze") },
      { v: "io", label: tx("ui.browser.filter.type.io", "Image occlusion") },
      { v: "mcq", label: tx("ui.browser.filter.type.mcq", "Multiple choice") },
      { v: "oq", label: tx("ui.browser.filter.type.oq", "Ordered question") },
    ],
    onChange: (v) => { ctx.setTypeFilter(v); ctx.refreshTable(); ctx.markFiltersDirty(); },
    onBeforeChange: () => ctx.setPageIndex(0),
    widthPx: 260,
  });
  typeDd.root.classList.add("lk-browser-filter", "lk-browser-filter-type");
  controlsRow.appendChild(typeDd.root);
  uiCleanups.push(typeDd.dispose);

  // Stage filter
  const stageDd = makeDropdownMenu<StageFilter>({
    label: tx("ui.browser.filter.stage", "Filter by stage"),
    value: ctx.stageFilter,
    options: [
      { v: "all", label: tx("ui.browser.filter.stage.all", "All stages") },
      { v: "new", label: tx("ui.browser.filter.stage.new", "New") },
      { v: "learning", label: tx("ui.browser.filter.stage.learning", "Learning") },
      { v: "relearning", label: tx("ui.browser.filter.stage.relearning", "Relearning") },
      { v: "review", label: tx("ui.browser.filter.stage.review", "Review") },
      { v: "suspended", label: tx("ui.browser.filter.stage.suspended", "Suspended") },
      { v: "quarantined", label: tx("ui.browser.filter.stage.quarantined", "Quarantined") },
    ],
    onChange: (v) => { ctx.setStageFilter(v); ctx.refreshTable(); ctx.markFiltersDirty(); },
    onBeforeChange: () => ctx.setPageIndex(0),
    widthPx: 240,
  });
  stageDd.root.classList.add("lk-browser-filter", "lk-browser-filter-stage");
  controlsRow.appendChild(stageDd.root);
  uiCleanups.push(stageDd.dispose);

  // Due filter
  const dueDd = makeDropdownMenu<DueFilter>({
    label: tx("ui.browser.filter.due", "Filter by due dates"),
    value: ctx.dueFilter,
    options: [
      { v: "all", label: tx("ui.browser.filter.due.all", "All due dates") },
      { v: "due", label: tx("ui.browser.filter.due.now", "Due now") },
      { v: "today", label: tx("ui.browser.filter.due.today", "Due today") },
      { v: "later", label: tx("ui.browser.filter.due.later", "Later") },
    ],
    onChange: (v) => { ctx.setDueFilter(v); ctx.refreshTable(); ctx.markFiltersDirty(); },
    onBeforeChange: () => ctx.setPageIndex(0),
    widthPx: 220,
  });
  dueDd.root.classList.add("lk-browser-filter", "lk-browser-filter-due");
  controlsRow.appendChild(dueDd.root);
  uiCleanups.push(dueDd.dispose);

  // Columns button
  const columnsWrap = document.createElement("div");
  columnsWrap.className = "flex flex-row flex-wrap items-center gap-2 lk-browser-filter-columns-wrap";
  controlsRow.appendChild(columnsWrap);
  colsDd.root.classList.add("lk-browser-filter", "lk-browser-filter-columns");
  columnsWrap.appendChild(colsDd.root);

  // Suspend button
  const suspendBtn = document.createElement("button");
  suspendBtn.type = "button";
  suspendBtn.className = "learnkit-btn-toolbar h-9 px-3 text-sm inline-flex items-center gap-2 lk-browser-action-btn lk-browser-action-btn-suspend";
  suspendBtn.disabled = true;
  suspendBtn.setAttribute("aria-label", tx("ui.browser.action.suspend.tooltip", "Suspend or Unsuspend selected cards"));
  suspendBtn.setAttribute("data-tooltip-position", "top");
  suspendBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ctx.suspendSelected();
  });
  controlsRow.appendChild(suspendBtn);

  // Edit button
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "learnkit-btn-toolbar h-9 px-3 text-sm inline-flex items-center gap-2 lk-browser-action-btn lk-browser-action-btn-edit";
  editBtn.disabled = true;
  editBtn.setAttribute("aria-label", tx("ui.browser.action.edit.tooltip", "Edit selected cards"));
  editBtn.setAttribute("data-tooltip-position", "top");
  editBtn.setAttribute("aria-live", "polite");
  const editIcon = document.createElement("span");
  editIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(editIcon, "edit-3");
  editIcon.classList.add("learnkit-icon-scale-80", "learnkit-icon-scale-80");
  editBtn.appendChild(editIcon);
  const editText = document.createElement("span");
  editText.textContent = tx("ui.browser.action.edit.label", "Edit");
  editBtn.appendChild(editText);
  editBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ctx.openBulkEditModal();
  });
  controlsRow.appendChild(editBtn);

  // Reset filters button
  const resetFiltersBtn = document.createElement("button");
  resetFiltersBtn.type = "button";
  resetFiltersBtn.className = "learnkit-btn-toolbar h-9 px-3 text-sm inline-flex items-center gap-2 lk-browser-action-btn lk-browser-action-btn-reset";
  resetFiltersBtn.disabled = true;
  resetFiltersBtn.setAttribute("aria-label", tx("ui.browser.action.reset.tooltip", "Reset filters"));
  resetFiltersBtn.setAttribute("data-tooltip-position", "top");
  const resetIcon = document.createElement("span");
  resetIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(resetIcon, "funnel-x");
  resetFiltersBtn.appendChild(resetIcon);
  const resetText = document.createElement("span");
  resetText.textContent = tx("ui.browser.action.reset.label", "Reset");
  resetFiltersBtn.appendChild(resetText);
  resetFiltersBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ctx.resetFilters();
  });
  controlsRow.appendChild(resetFiltersBtn);

  // ── Table ──
  const tableCard = document.createElement("div");
  tableCard.className = "card lk-browser-card lk-browser-table-card";
  applyAos(tableCard, 240);
  top.appendChild(tableCard);

  const tableWrap = document.createElement("div");
  tableWrap.className =
    "overflow-auto flex-1 min-h-0 lk-browser-table-wrap";
  tableCard.appendChild(tableWrap);

  const table = document.createElement("table");
  table.className = "table w-full text-sm leading-snug lk-browser-table";
  tableWrap.appendChild(table);

  // Colgroup
  const colgroup = document.createElement("colgroup");
  table.appendChild(colgroup);

  const selectCol = document.createElement("col");
  selectCol.setAttribute("data-col", "select");
  selectCol.className = "lk-browser-select-col";
  colgroup.appendChild(selectCol);

  const colEls: Partial<Record<ColKey, HTMLTableColElement>> = {};
  const cols = ctx.allCols;

  cols.forEach((k) => {
    const c = document.createElement("col");
    c.setAttribute("data-col", k);
    c.className = "lk-browser-col";
    setCssProps(c, "--learnkit-col-width", `${ctx.colWidths[k] || 120}px`);
    colgroup.appendChild(c);
    colEls[k] = c;
  });

  // Thead
  const thead = document.createElement("thead");
  table.appendChild(thead);

  const hr = document.createElement("tr");
  hr.classList.add("lk-browser-header-row");
  thead.appendChild(hr);

  // Select-all checkbox
  const selectTh = document.createElement("th");
  selectTh.className = "text-sm font-medium text-muted-foreground select-none lk-browser-select-th";
  applyStickyThStyles(selectTh, 0);

  const selectAll = document.createElement("input");
  selectAll.type = "checkbox";
  selectAll.className = "cursor-pointer lk-browser-select-all";
  selectTh.appendChild(selectAll);
  hr.appendChild(selectTh);

  // Header cells
  const headerEls: Partial<Record<SortKey, HTMLTableCellElement>> = {};
  const headerSortIcons: Partial<Record<SortKey, SVGSVGElement>> = {};

  const headCell = (label: string, key: SortKey) => {
    const th = document.createElement("th");
    th.className = `text-sm font-medium text-muted-foreground select-none cursor-pointer ${ctx.cellWrapClass} lk-browser-header-cell lk-browser-th`;
    th.setAttribute("data-col", key);

    applyStickyThStyles(th, 0);

    const inner = document.createElement("div");
    inner.className = "items-center h-full lk-browser-th-inner";

    const lbl = document.createElement("span");
    lbl.textContent = label;
    lbl.className = "lk-browser-th-label";

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "svg-icon lucide-chevron-down lk-browser-header-icon lk-browser-th-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m6 9 6 6 6-6");
    icon.appendChild(path);

    inner.appendChild(lbl);
    inner.appendChild(icon);
    th.appendChild(inner);
    headerSortIcons[key] = icon;
    headerEls[key] = th;

    if (ctx.sortKey === key) {
      th.classList.add("text-foreground", "font-semibold");
      th.setAttribute("aria-sort", ctx.sortAsc ? "ascending" : "descending");
    } else {
      th.setAttribute("aria-sort", "none");
    }

    th.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest?.(".learnkit-col-resize")) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      ctx.toggleSort(key);
    });

    makeResizableTh(th, key, {
      colWidths: ctx.colWidths,
      colEls,
      colMin: ctx.colMin,
      colMax: ctx.colMax,
      setSuppressHeaderClickUntil: (ts) => ctx.setSuppressHeaderClickUntil(ts),
    });

    return th;
  };

  hr.appendChild(headCell(tx("ui.browser.column.cardId", "Card ID"), "id"));
  hr.appendChild(headCell(tx("ui.browser.column.type", "Type"), "type"));
  hr.appendChild(headCell(tx("ui.browser.column.stage", "Stage"), "stage"));
  hr.appendChild(headCell(tx("ui.browser.column.due", "Due"), "due"));
  hr.appendChild(headCell(tx("ui.browser.column.title", "Title"), "title"));
  hr.appendChild(headCell(tx("ui.browser.column.question", "Question"), "question"));
  hr.appendChild(headCell(tx("ui.browser.column.answerOptions", "Answer / Options"), "answer"));
  hr.appendChild(headCell(tx("ui.browser.column.info", "Extra information"), "info"));
  hr.appendChild(headCell(tx("ui.browser.column.location", "Location"), "location"));
  hr.appendChild(headCell(tx("ui.browser.column.groups", "Groups"), "groups"));

  // Tbody (empty — refreshTable fills it)
  const tbody = document.createElement("tbody");
  thead.classList.add("lk-browser-thead");
  tbody.classList.add("lk-browser-tbody");
  table.appendChild(tbody);

  // ── Bottom controls ──
  const bottomCard = document.createElement("div");
  bottomCard.className = "card lk-browser-card lk-browser-bottom-card";
  applyAos(bottomCard, 360);
  top.appendChild(bottomCard);

  const bottom = document.createElement("div");
  bottom.className = "flex flex-row flex-wrap items-center justify-between gap-2 lk-browser-bottom-bar";
  bottomCard.appendChild(bottom);

  const summaryWrap = document.createElement("div");
  summaryWrap.className = "flex flex-col gap-0.5 lk-browser-summary-wrap";
  const summary = document.createElement("div");
  summary.className = "text-sm text-muted-foreground lk-browser-summary";
  const selectionRow = document.createElement("div");
  selectionRow.className = "flex items-center gap-2 lk-browser-selection-row";
  const selectionCount = document.createElement("div");
  selectionCount.className = "text-sm text-muted-foreground lk-browser-selection-count";
  selectionCount.textContent = tx("ui.browser.selection.none", "No cards selected");
  summaryWrap.appendChild(summary);
  selectionRow.appendChild(selectionCount);

  const clearSelection = document.createElement("div");
  clearSelection.className =
    "inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground cursor-pointer lk-browser-clear-selection";
  const clearIcon = document.createElement("span");
  clearIcon.className = "inline-flex items-center justify-center [&_svg]:size-3";
  setIcon(clearIcon, "x");
  clearIcon.classList.add("learnkit-icon-scale-80", "learnkit-icon-scale-80");
  clearSelection.appendChild(clearIcon);
  const clearText = document.createElement("span");
  clearText.textContent = tx("ui.browser.selection.clear", "Clear selection");
  clearSelection.appendChild(clearText);
  clearSelection.classList.add("learnkit-is-hidden", "learnkit-is-hidden");
  clearSelection.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ctx.clearSelection();
  });
  selectionRow.appendChild(clearSelection);
  summaryWrap.appendChild(selectionRow);
  bottom.appendChild(summaryWrap);

  const right = document.createElement("div");
  right.className = "flex flex-row flex-wrap items-center gap-2 ml-auto lk-browser-bottom-right";
  bottom.appendChild(right);

  const rowsControl = document.createElement("div");
  rowsControl.className = "flex flex-row items-center gap-2 lk-browser-rows-control";
  right.appendChild(rowsControl);

  const rowsLbl = document.createElement("div");
  rowsLbl.className = "text-sm text-muted-foreground lk-browser-rows-label";
  rowsLbl.textContent = tx("ui.browser.rows.label", "Rows");
  rowsControl.appendChild(rowsLbl);

  const pageSizeDd = makeDropdownMenu<string>({
    label: tx("ui.browser.rows.perPage", "Rows per page"),
    value: String(ctx.pageSize),
    options: ["100", "50", "25", "10", "5"].map((v) => ({ v, label: v })),
    triggerClassName: "learnkit-btn-filter h-7 px-3 text-sm",
    onChange: (v) => {
      const next = Math.max(1, Math.floor(Number(v) || 5));
      ctx.setPageSize(next);
      ctx.setPageIndex(0);
      ctx.refreshTable();
    },
    widthPx: 140,
    dropUp: true,
  });
  rowsControl.appendChild(pageSizeDd.root);
  uiCleanups.push(pageSizeDd.dispose);

  const pagerHost = document.createElement("div");
  pagerHost.className = "flex items-center lk-browser-pager-host";
  right.appendChild(pagerHost);

  return {
    searchInputEl: q,
    editButton: editBtn,
    suspendButton: suspendBtn,
    resetFiltersButton: resetFiltersBtn,
    typeFilterMenu: typeDd,
    stageFilterMenu: stageDd,
    dueFilterMenu: dueDd,
    summaryEl: summary,
    selectionCountEl: selectionCount,
    clearSelectionEl: clearSelection,
    selectAllCheckboxEl: selectAll,
    pagerHostEl: pagerHost,
    tableWrapEl: tableWrap,
    tableBody: tbody,
    headerEls,
    headerSortIcons,
    colEls,
    uiCleanups,
  };
}
