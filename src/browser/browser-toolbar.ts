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
import type SproutPlugin from "../main";
import {
  AOS_CASCADE_STEP,
} from "../core/constants";
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
import { makeDropdownMenu, makeColumnsDropdown } from "./browser-dropdowns";
import { makeResizableTh } from "./browser-resize";

// ── Context / result interfaces ───────────────────────────

export interface ToolbarContext {
  plugin: SproutPlugin;
  animationsEnabled: boolean;

  query: string;
  typeFilter: TypeFilter;
  stageFilter: StageFilter;
  dueFilter: DueFilter;
  pageSize: number;
  pageIndex: number;

  sortKey: SortKey;
  sortAsc: boolean;
  colWidths: Record<ColKey, number>;
  visibleCols: Set<ColKey>;
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
    el.setAttribute("data-aos-anchor", '[data-sprout-browser-root="1"]');
    el.setAttribute("data-aos-anchor-placement", "top-bottom");
    el.setAttribute("data-aos-duration", "450");
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
  const { applyAos, nextDelay, getCascadeDelay } = makeAosFn(ctx.animationsEnabled);

  const uiCleanups: Array<() => void> = [];

  // ── Title ──
  const title = document.createElement("div");
  title.className = "bc text-xl font-semibold tracking-tight";
  applyAos(title, getCascadeDelay());
  title.textContent = "Flashcard Browser";
  root.appendChild(title);

  // ── Toolbar / filters ──
  const top = document.createElement("div");
  top.className = "flex flex-col gap-2 w-full";
  root.appendChild(top);

  const toolbarRow = document.createElement("div");
  toolbarRow.className = "flex flex-row flex-wrap items-start gap-2 w-full";
  top.appendChild(toolbarRow);

  // Search input
  const searchGroup = document.createElement("div");
  searchGroup.className = "flex flex-row items-stretch gap-2 flex-1 min-w-[300px]";
  applyAos(searchGroup, nextDelay());
  toolbarRow.appendChild(searchGroup);

  const q = document.createElement("input");
  q.type = "text";
  q.placeholder = "Search flashcards";
  q.value = ctx.query;
  q.className = "input h-9 px-3 text-sm";
  q.style.flex = "1 1 300px";
  q.style.minWidth = "300px";
  q.style.width = "100%";
  q.style.height = "36px";
  q.style.boxSizing = "border-box";
  q.style.alignSelf = "stretch";
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
    },
    {
      getVisibleCols: () => ctx.visibleCols,
      setVisibleCols: (cols) => ctx.setVisibleCols(cols),
      applyColumnVisibility: () => ctx.applyColumnVisibility(),
    },
  );
  uiCleanups.push(colsDd.dispose);

  // Controls row
  const controlsRow = document.createElement("div");
  controlsRow.className = "flex flex-row flex-wrap items-center gap-2";
  applyAos(controlsRow, nextDelay());
  toolbarRow.appendChild(controlsRow);

  // Type filter
  const typeDd = makeDropdownMenu<TypeFilter>({
    label: "Filter by type",
    value: ctx.typeFilter,
    options: [
      { v: "all", label: "All types" },
      { v: "basic", label: "Basic" },
      { v: "cloze", label: "Cloze" },
      { v: "io", label: "Image Occlusion" },
      { v: "mcq", label: "Multiple Choice" },
    ],
    onChange: (v) => { ctx.setTypeFilter(v); ctx.refreshTable(); ctx.markFiltersDirty(); },
    onBeforeChange: () => ctx.setPageIndex(0),
    widthPx: 260,
  });
  controlsRow.appendChild(typeDd.root);
  uiCleanups.push(typeDd.dispose);

  // Stage filter
  const stageDd = makeDropdownMenu<StageFilter>({
    label: "Filter by stage",
    value: ctx.stageFilter,
    options: [
      { v: "all", label: "All stages" },
      { v: "new", label: "New" },
      { v: "learning", label: "Learning" },
      { v: "relearning", label: "Relearning" },
      { v: "review", label: "Review" },
      { v: "suspended", label: "Suspended" },
      { v: "quarantined", label: "Quarantined" },
    ],
    onChange: (v) => { ctx.setStageFilter(v); ctx.refreshTable(); ctx.markFiltersDirty(); },
    onBeforeChange: () => ctx.setPageIndex(0),
    widthPx: 240,
  });
  controlsRow.appendChild(stageDd.root);
  uiCleanups.push(stageDd.dispose);

  // Due filter
  const dueDd = makeDropdownMenu<DueFilter>({
    label: "Filter by due dates",
    value: ctx.dueFilter,
    options: [
      { v: "all", label: "All due dates" },
      { v: "due", label: "Due now" },
      { v: "today", label: "Due today" },
      { v: "later", label: "Later" },
    ],
    onChange: (v) => { ctx.setDueFilter(v); ctx.refreshTable(); ctx.markFiltersDirty(); },
    onBeforeChange: () => ctx.setPageIndex(0),
    widthPx: 220,
  });
  controlsRow.appendChild(dueDd.root);
  uiCleanups.push(dueDd.dispose);

  // Columns button
  const columnsWrap = document.createElement("div");
  columnsWrap.className = "flex flex-row flex-wrap items-center gap-2";
  controlsRow.appendChild(columnsWrap);
  columnsWrap.appendChild(colsDd.root);

  // Suspend button
  const suspendBtn = document.createElement("button");
  suspendBtn.type = "button";
  suspendBtn.className = "btn-outline h-9 px-3 text-sm inline-flex items-center gap-2";
  suspendBtn.disabled = true;
  suspendBtn.setAttribute("data-tooltip", "Suspend or Unsuspend selected cards");
  suspendBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ctx.suspendSelected();
  });
  controlsRow.appendChild(suspendBtn);

  // Edit button
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
    ctx.openBulkEditModal();
  });
  controlsRow.appendChild(editBtn);

  // Reset filters button
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
    ctx.resetFilters();
  });
  controlsRow.appendChild(resetFiltersBtn);

  // ── Table ──
  const tableWrap = document.createElement("div");
  tableWrap.className =
    "bc rounded-lg border border-border overflow-auto flex-1 min-h-0 sprout-browser-table-wrap";
  tableWrap.style.flex = "1 1 0%";
  tableWrap.style.minHeight = "0";
  tableWrap.style.overflow = "auto";
  tableWrap.style.maxWidth = "100%";
  tableWrap.style.boxSizing = "border-box";
  applyAos(tableWrap, nextDelay());
  root.appendChild(tableWrap);

  const table = document.createElement("table");
  table.className = `table w-full text-sm leading-snug`;
  table.style.tableLayout = "fixed";
  table.style.position = "relative";
  table.style.maxWidth = "100%";
  table.style.boxSizing = "border-box";
  tableWrap.appendChild(table);

  // Colgroup
  const colgroup = document.createElement("colgroup");
  table.appendChild(colgroup);

  const selectCol = document.createElement("col");
  selectCol.setAttribute("data-col", "select");
  selectCol.style.width = "42px";
  colgroup.appendChild(selectCol);

  const colEls: Partial<Record<ColKey, HTMLTableColElement>> = {};
  const cols = ctx.allCols;

  cols.forEach((k) => {
    const c = document.createElement("col");
    c.setAttribute("data-col", k);
    c.style.width = `${ctx.colWidths[k] || 120}px`;
    colgroup.appendChild(c);
    colEls[k] = c;
  });

  // Thead
  const thead = document.createElement("thead");
  table.appendChild(thead);

  const hr = document.createElement("tr");
  hr.style.verticalAlign = "middle";
  hr.style.width = "100%";
  thead.appendChild(hr);

  // Select-all checkbox
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
  selectTh.appendChild(selectAll);
  hr.appendChild(selectTh);

  // Header cells
  const headerEls: Partial<Record<SortKey, HTMLTableCellElement>> = {};
  const headerSortIcons: Partial<Record<SortKey, SVGSVGElement>> = {};

  const headCell = (label: string, key: SortKey) => {
    const th = document.createElement("th");
    th.className = `text-sm font-medium text-muted-foreground select-none cursor-pointer ${ctx.cellWrapClass} sprout-browser-header-cell`;
    th.setAttribute("data-col", key);
    th.style.verticalAlign = "middle";
    th.style.maxWidth = "100%";
    th.style.overflow = "visible";
    th.style.textOverflow = "clip";
    th.style.whiteSpace = "normal";
    th.style.boxSizing = "border-box";
    th.style.position = "relative";

    applyStickyThStyles(th, 0);

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
    inner.style.pointerEvents = "none";

    const lbl = document.createElement("span");
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
      if (target?.closest?.(".sprout-col-resize")) {
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

  // Tbody (empty — refreshTable fills it)
  const tbody = document.createElement("tbody");
  thead.style.display = "table-row-group";
  tbody.style.display = "block";
  tbody.style.overflowY = "auto";
  tbody.style.maxHeight = "none";
  tbody.style.width = "100%";
  table.appendChild(tbody);

  // ── Bottom controls ──
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
  clearSelection.className =
    "inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground cursor-pointer";
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
    ctx.clearSelection();
  });
  selectionRow.appendChild(clearSelection);
  summaryWrap.appendChild(selectionRow);
  bottom.appendChild(summaryWrap);

  const right = document.createElement("div");
  right.className = "flex flex-row flex-wrap items-center gap-2 ml-auto";
  bottom.appendChild(right);

  const rowsLbl = document.createElement("div");
  rowsLbl.className = "text-sm text-muted-foreground";
  rowsLbl.textContent = "Rows";
  right.appendChild(rowsLbl);

  const pageSizeDd = makeDropdownMenu<string>({
    label: "Rows per page",
    value: String(ctx.pageSize),
    options: ["100", "50", "25", "10", "5"].map((v) => ({ v, label: v })),
    onChange: (v) => {
      const next = Math.max(1, Math.floor(Number(v) || 25));
      ctx.setPageSize(next);
      ctx.setPageIndex(0);
      ctx.refreshTable();
    },
    widthPx: 140,
    dropUp: true,
  });
  right.appendChild(pageSizeDd.root);
  uiCleanups.push(pageSizeDd.dispose);

  const pagerHost = document.createElement("div");
  pagerHost.className = "flex items-center";
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
