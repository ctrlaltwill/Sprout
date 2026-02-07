/**
 * @file src/browser/browser-row-renderer.ts
 * @summary Builds the <tbody> for the Flashcard Browser table, constructing one
 * <tr> per card with read-only cells (type, stage, due, ID badge), editable
 * textarea cells (title, question, answer, info), a groups tag-editor popover,
 * checkbox/shift-select logic per row, and an empty-state overlay. Extracted
 * from SproutCardBrowserView to keep the view class focused on orchestration.
 *
 * @exports
 *   - RowRendererContext — interface describing the callbacks and state the row renderer needs from its host view
 *   - buildPageTableBody — builds a <tbody> element containing one <tr> per row for the current page
 *   - renderEmptyState — shows a centred "No cards match" overlay inside the table scroll container
 *   - clearEmptyState — removes any existing empty-state overlay from the root element
 */

import { Notice, setIcon, type App } from "obsidian";
import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import { BRAND } from "../core/constants";
import { log } from "../core/logger";
import { queryFirst, replaceChildrenWithHTML, setCssProps } from "../core/ui";
import { coerceGroups } from "../indexes/group-format";
import { buildAnswerOrOptionsFor, buildQuestionFor } from "../reviewer/fields";
import { stageLabel } from "../reviewer/labels";

import type { BrowserRow } from "./browser-card-data";
import {
  type ColKey,
  CLOZE_ANSWER_HELP,
  clearNode,
  forceWrapStyles,
  forceCellClip,
  fmtDue,
  fmtLocation,
  typeLabelBrowser,
  titleCaseGroupPath,
  formatGroupDisplay,
  expandGroupAncestors,
  parseGroupsInput,
  groupsToInput,
  buildIoImgHtml,
  buildIoOccludedHtml,
  getIoResolvedImage,
} from "./browser-helpers";

// ── Context interface ─────────────────────────────────────

export interface RowRendererContext {
  app: App;
  plugin: SproutPlugin;

  rowHeightPx: number;
  editorHeightPx: number;
  cellTextClass: string;
  readonlyTextClass: string;
  cellWrapClass: string;

  saving: Set<string>;
  selectedIds: Set<string>;
  tableWrapEl: HTMLElement | null;

  setSelection(id: string, selected: boolean): boolean;
  syncRowCheckboxes(): void;
  updateSelectionIndicator(): void;
  updateSelectAllCheckboxState(): void;

  getLastShiftSelectionIndex(): number | null;
  setLastShiftSelectionIndex(idx: number | null): void;

  applyValueToCard(card: CardRecord, col: ColKey, value: string): CardRecord;
  writeCardToMarkdown(card: CardRecord): Promise<void>;
  openSource(card: CardRecord): void;
  openIoEditor(cardId: string): void;
}

// ── Helpers (module-private) ──────────────────────────────

const setColAttr = (td: HTMLTableCellElement, col: ColKey) => {
  td.setAttribute("data-col", col);
  return td;
};

// ── Main entry point ──────────────────────────────────────

/**
 * Build a `<tbody>` containing one `<tr>` per row in `pageRows`.
 * Returns the element ready to be `.replaceWith()` into the table.
 */
export function buildPageTableBody(
  pageRows: BrowserRow[],
  ctx: RowRendererContext,
): HTMLTableSectionElement {
  const tbody = document.createElement("tbody");
  tbody.className = "";

  const quarantine = (ctx.plugin.store.data.quarantine || {});
  const pageRowCount = pageRows.length;

  for (const [rowIndex, { card, state, dueMs }] of pageRows.entries()) {
    const isQuarantined = !!quarantine[String(card.id)];
    const tr = document.createElement("tr");
    tr.className = "sprout-browser-row";
    setCssProps(tr, "--sprout-row-height", `${ctx.rowHeightPx}px`);

    // ── Checkbox cell ──
    const selTd = document.createElement("td");
    selTd.className = `text-center ${ctx.cellWrapClass} sprout-browser-cell sprout-browser-cell-middle sprout-browser-cell-center`;
    forceCellClip(selTd);
    forceWrapStyles(selTd);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("data-card-id", String(card.id));
    checkbox.className = "cursor-pointer sprout-browser-checkbox";
    checkbox.checked = ctx.selectedIds.has(String(card.id));
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const checked = checkbox.checked;
      const shift = (ev as MouseEvent).shiftKey;
      if (shift && ctx.getLastShiftSelectionIndex() !== null) {
        const start = Math.min(ctx.getLastShiftSelectionIndex()!, rowIndex);
        const end = Math.max(ctx.getLastShiftSelectionIndex()!, rowIndex);
        let changed = false;
        for (let idx = start; idx <= end; idx += 1) {
          const id = String(pageRows[idx].card.id);
          if (checked) {
            if (!ctx.selectedIds.has(id)) { ctx.selectedIds.add(id); changed = true; }
          } else {
            if (ctx.selectedIds.has(id)) { ctx.selectedIds.delete(id); changed = true; }
          }
        }
        if (changed) {
          ctx.syncRowCheckboxes();
          ctx.updateSelectionIndicator();
          ctx.updateSelectAllCheckboxState();
        }
      } else if (ctx.setSelection(String(card.id), checked)) {
        ctx.updateSelectionIndicator();
        ctx.updateSelectAllCheckboxState();
      }
      ctx.setLastShiftSelectionIndex(rowIndex);
    });

    selTd.appendChild(checkbox);
    tr.appendChild(selTd);

    // ── Muted text cell helper ──
    const tdMuted = (txt: string, col: ColKey, title?: string) => {
      const td = document.createElement("td");
      td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground sprout-browser-cell`;
      td.textContent = txt;
      if (title) td.setAttribute("data-tooltip", title);
      forceWrapStyles(td);
      forceCellClip(td);
      setColAttr(td, col);
      return td;
    };

    // ── ID cell ──
    const idTd = document.createElement("td");
    idTd.className = `align-top ${ctx.cellWrapClass} sprout-browser-cell`;
    forceCellClip(idTd);
    forceWrapStyles(idTd);
    setColAttr(idTd, "id");

    const isSuspended = String(state?.stage || "") === "suspended";
    const sourceLink = `${card.sourceNotePath}#^sprout-${card.id}`;

    const idLink = document.createElement("a");
    idLink.href = sourceLink;
    idLink.className = "sprout-browser-id-link";

    if (isSuspended) {
      idLink.classList.add("sprout-browser-id-link--suspended");
    }
    if (isQuarantined) {
      idLink.classList.add("sprout-browser-id-link--quarantined");
    }

    idLink.setAttribute("data-tooltip", `Open card ^sprout-${card.id}`);

    const idValue = document.createElement("span");
    idValue.textContent = String(card.id);
    idLink.appendChild(idValue);

    const linkIcon = document.createElement("span");
    linkIcon.setAttribute("aria-hidden", "true");
    linkIcon.className = "inline-flex items-center justify-center";
    let iconName = "link";
    if (isSuspended) iconName = "circle-pause";
    else if (isQuarantined) iconName = "alert-triangle";
    setIcon(linkIcon, iconName);
    try {
      const scale = isSuspended || isQuarantined ? 0.7 : 0.75;
      linkIcon.classList.add("sprout-scale");
      setCssProps(linkIcon, "--sprout-scale", String(scale));
    } catch (e) { log.swallow("scale link icon", e); }
    idLink.appendChild(linkIcon);

    idLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void ctx.openSource(card);
    });

    idTd.appendChild(idLink);
    tr.appendChild(idTd);

    // ── Type cell ──
    tr.appendChild(tdMuted(isQuarantined ? "Quarantined" : typeLabelBrowser(card.type), "type"));

    // ── Stage cell ──
    const stage = isQuarantined ? "quarantined" : String(state?.stage || "new");
    if (stage === "suspended") {
      const td = document.createElement("td");
      td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground sprout-browser-cell`;
      forceWrapStyles(td);
      forceCellClip(td);
      setColAttr(td, "stage");
      const label = document.createElement("div");
      label.textContent = stageLabel(stage);
      td.appendChild(label);
      tr.appendChild(td);
    } else if (stage === "quarantined") {
      tr.appendChild(tdMuted("Quarantined", "stage"));
    } else {
      tr.appendChild(tdMuted(stageLabel(stage), "stage"));
    }

    // ── Due cell ──
    if (stage === "suspended") {
      tr.appendChild(makeReadOnlyFieldCell("Card currently suspended (no due data).", "due", ctx));
    } else if (stage === "quarantined") {
      tr.appendChild(makeReadOnlyFieldCell("Card currently quarantined (no due data).", "due", ctx));
    } else {
      tr.appendChild(tdMuted(fmtDue(dueMs), "due"));
    }

    // ── Editable cells ──
    tr.appendChild(makeEditorCell("title", card, isQuarantined, ctx));
    tr.appendChild(makeEditorCell("question", card, isQuarantined, ctx));
    tr.appendChild(makeEditorCell("answer", card, isQuarantined, ctx));
    tr.appendChild(makeEditorCell("info", card, isQuarantined, ctx));

    // ── Location cell ──
    tr.appendChild(tdMuted(fmtLocation(card.sourceNotePath), "location", card.sourceNotePath));

    // ── Groups editor cell ──
    tr.appendChild(makeGroupsEditorCell(card, isQuarantined, rowIndex, pageRowCount, pageRows, ctx));

    // ── Row click → checkbox toggle ──
    tr.addEventListener("pointerdown", (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (target instanceof HTMLInputElement) return;
      if (target instanceof HTMLButtonElement) return;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLSelectElement) return;
      const interactive = target instanceof Element ? target.closest('input, button, textarea, select, [role="button"], [data-interactive]') : null;
      if (interactive) return;
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      if (ev.button !== 0) return;

      const wasChecked = checkbox.checked;
      const shift = ev.shiftKey;

      if (shift && ctx.getLastShiftSelectionIndex() !== null) {
        const start = Math.min(ctx.getLastShiftSelectionIndex()!, rowIndex);
        const end = Math.max(ctx.getLastShiftSelectionIndex()!, rowIndex);
        let changed = false;
        for (let idx = start; idx <= end; idx += 1) {
          const id = String(pageRows[idx].card.id);
          if (!wasChecked) {
            if (!ctx.selectedIds.has(id)) { ctx.selectedIds.add(id); changed = true; }
          } else {
            if (ctx.selectedIds.has(id)) { ctx.selectedIds.delete(id); changed = true; }
          }
        }
        if (changed) {
          ctx.syncRowCheckboxes();
          ctx.updateSelectionIndicator();
          ctx.updateSelectAllCheckboxState();
        }
      } else {
        checkbox.checked = !wasChecked;
        if (ctx.setSelection(String(card.id), !wasChecked)) {
          ctx.updateSelectionIndicator();
          ctx.updateSelectAllCheckboxState();
        }
      }
      ctx.setLastShiftSelectionIndex(rowIndex);
    });

    tbody.appendChild(tr);
  }

  return tbody;
}

// ── Empty state ───────────────────────────────────────────

/**
 * Show a centred "No cards match your filters" overlay inside the
 * table scroll container. Returns a cleanup function.
 */
export function renderEmptyState(
  rootEl: HTMLElement | null,
  total: number,
): { cleanup: (() => void) | null } {
  // Remove any previous error message
  const prevError = rootEl ? queryFirst(rootEl, ".sprout-browser-empty-message") : null;
  if (prevError) prevError.remove();

  const wrap = rootEl
    ? queryFirst<HTMLElement>(rootEl, ".bc.rounded-lg.border.border-border.overflow-auto")
    : null;

  if (!wrap) return { cleanup: null };

  const msg = document.createElement("div");
  msg.className =
    "sprout-browser-empty-message flex items-center justify-center text-center text-muted-foreground text-base py-8 px-4 w-full";
  msg.textContent = total === 0 ? "No cards match your filters." : "No rows on this page.";
  wrap.appendChild(msg);

  const headerHeight = 44;
  const place = () => {
    const msgRect = msg.getBoundingClientRect();
    const availableHeight = Math.max(0, wrap.clientHeight - headerHeight);
    const top =
      wrap.scrollTop + headerHeight + Math.max(0, (availableHeight - msgRect.height) / 2);
    setCssProps(msg, "--sprout-empty-left", `${wrap.scrollLeft}px`);
    setCssProps(msg, "--sprout-empty-top", `${Math.round(top)}px`);
    setCssProps(msg, "--sprout-empty-width", `${wrap.clientWidth}px`);
  };

  const onScroll = () => place();
  wrap.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, true);
  requestAnimationFrame(place);

  const cleanup = () => {
    wrap.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll, true);
  };

  return { cleanup };
}

/**
 * Remove any existing empty-state overlay from the root.
 */
export function clearEmptyState(rootEl: HTMLElement | null): void {
  const prev = rootEl ? queryFirst(rootEl, ".sprout-browser-empty-message") : null;
  if (prev) prev.remove();
}

// ── Private cell builders ─────────────────────────────────

function makeReadOnlyFieldCell(
  value: string,
  col: ColKey,
  ctx: RowRendererContext,
  title?: string,
): HTMLTableCellElement {
  if (col === "due") {
    const td = document.createElement("td");
    td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground sprout-browser-cell`;
    td.textContent = value;
    if (title) td.setAttribute("data-tooltip", title);
    forceWrapStyles(td);
    forceCellClip(td);
    setColAttr(td, col);
    return td;
  }

  const td = document.createElement("td");
  td.className = `align-top ${ctx.cellWrapClass} sprout-browser-cell`;
  forceCellClip(td);
  forceWrapStyles(td);
  setColAttr(td, col);

  const ta = document.createElement("textarea");
  ta.className = `textarea w-full ${ctx.readonlyTextClass} sprout-browser-textarea sprout-browser-textarea--readonly`;
  ta.value = value;
  ta.readOnly = true;
  if (title) ta.setAttribute("data-tooltip", title);

  const h = `${ctx.editorHeightPx}px`;
  setCssProps(ta, "--sprout-editor-height", h);

  td.appendChild(ta);
  return td;
}

function makeEditorCell(
  col: ColKey,
  card: CardRecord,
  isQuarantined: boolean,
  ctx: RowRendererContext,
): HTMLTableCellElement {
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
    return makeReadOnlyFieldCell(initial || "—", col, ctx);
  }

  if (col === "answer" && card.type === "cloze") {
    const td = document.createElement("td");
    td.className = `align-top ${ctx.readonlyTextClass} ${ctx.cellWrapClass} text-muted-foreground sprout-browser-cell`;
    td.textContent = CLOZE_ANSWER_HELP;
    forceWrapStyles(td);
    forceCellClip(td);
    setColAttr(td, col);
    return td;
  }

  if ((card.type === "io" || card.type === "io-child") && (col === "question" || col === "answer")) {
    return makeIoCell(col, card, ctx);
  }

  const td = document.createElement("td");
  td.className = `align-top ${ctx.cellWrapClass} sprout-browser-cell`;
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
  ta.className = `textarea w-full ${ctx.cellTextClass} sprout-browser-textarea sprout-browser-textarea--editable`;
  ta.value = initial;

  const h = `${ctx.editorHeightPx}px`;
  setCssProps(ta, "--sprout-editor-height", h);

  const key = `${card.id}:${col}`;
  let baseline = initial;

  ta.addEventListener("focus", () => { baseline = ta.value; });

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
      if (ctx.saving.has(key)) return;

      ctx.saving.add(key);
      try {
        const updated = ctx.applyValueToCard(card, col, nextVal);
        await ctx.writeCardToMarkdown(updated);
        baseline = nextVal;
      } catch (err: unknown) {
        new Notice(`${BRAND}: ${err instanceof Error ? err.message : String(err)}`);
        ta.value = baseline;
      } finally {
        ctx.saving.delete(key);
      }
    })();
  });

  td.appendChild(ta);
  return td;
}

function makeIoCell(
  col: ColKey,
  card: CardRecord,
  ctx: RowRendererContext,
): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = `align-top ${ctx.cellWrapClass} sprout-browser-cell sprout-browser-io-cell`;
  forceWrapStyles(td);
  forceCellClip(td);
  setColAttr(td, col);

  const io = getIoResolvedImage(ctx.app, card);
  if (!io.src || !io.displayRef) {
    return makeReadOnlyFieldCell("— (IO image not resolved)", col, ctx);
  }

  if (col === "question") {
    const ioMap = ctx.plugin.store.data?.io || {};
    const parentId = card.type === "io" ? String(card.id) : String(card.parentId || "");
    const def = parentId ? ioMap[parentId] : null;
    const cardRec = card as Record<string, unknown>;
    const rects = Array.isArray(def?.rects) ? def.rects : ((cardRec.occlusions ?? cardRec.rects ?? null) as unknown[] | null);
    let maskedRects = rects;
    if (card.type === "io-child" && Array.isArray(rects)) {
      const rectIds = Array.isArray(card.rectIds) ? card.rectIds.map((r: unknown) => String(r)) : [];
      maskedRects = rectIds.length
        ? rects.filter((r) => rectIds.includes(String((r as Record<string, unknown>).rectId)))
        : rects;
    }
    const labelsCard = Array.isArray(maskedRects) ? { rects: maskedRects } : card;
    replaceChildrenWithHTML(
      td,
      buildIoOccludedHtml(
      io.src,
      io.displayRef,
      maskedRects,
      `IO (occluded) — ^sprout-${card.id}`,
      labelsCard,
      ),
    );
  } else {
    replaceChildrenWithHTML(td, buildIoImgHtml(io.src, io.displayRef, `IO (original) — ^sprout-${card.id}`));
  }

  td.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ctx.openIoEditor(card.id);
  });

  return td;
}

// ── Groups editor cell (tag-picker with popover) ──────────

function makeGroupsEditorCell(
  card: CardRecord,
  isQuarantined: boolean,
  rowIndex: number,
  pageRowCount: number,
  _pageRows: BrowserRow[],
  ctx: RowRendererContext,
): HTMLTableCellElement {
  if (isQuarantined) {
    return makeReadOnlyFieldCell("—", "groups", ctx);
  }

  const wrap = ctx.tableWrapEl;
  const td = document.createElement("td");
  td.className = "align-top sprout-browser-cell sprout-browser-tag-cell";
  forceCellClip(td);
  setColAttr(td, "groups");

  const key = `${card.id}:groups`;
  let baseline = groupsToInput(card.groups);
  let selected = coerceGroups(card.groups)
    .map((g) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean);

  const tagBox = document.createElement("div");
  tagBox.className = `textarea w-full ${ctx.cellTextClass} sprout-browser-tag-box`;
  setCssProps(tagBox, "--sprout-editor-height", `${ctx.editorHeightPx}px`);
  td.appendChild(tagBox);

  const renderBadges = () => {
    clearNode(tagBox);
    if (selected.length === 0) {
      const empty = document.createElement("span");
      empty.className =
        "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 sprout-badge-placeholder sprout-badge-inline sprout-browser-tag-empty";
      empty.textContent = "No groups";
      tagBox.appendChild(empty);
      return;
    }
    for (const tag of selected) {
      const badge = document.createElement("span");
      badge.className =
        "badge inline-flex items-center gap-1 px-2 py-0.5 text-xs whitespace-nowrap group h-6 sprout-badge-inline sprout-browser-tag-badge";

      const txt = document.createElement("span");
      txt.textContent = formatGroupDisplay(tag);
      badge.appendChild(txt);

      const removeBtn = document.createElement("span");
      removeBtn.className =
        "ml-0 inline-flex items-center justify-center [&_svg]:size-[0.6rem] opacity-100 cursor-pointer text-white";
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
    if (ctx.saving.has(key)) return;

    ctx.saving.add(key);
    try {
      const updated = ctx.applyValueToCard(card, "groups", nextVal);
      await ctx.writeCardToMarkdown(updated);
      ctx.plugin.store.upsertCard(updated);
      baseline = nextVal;
    } catch (err: unknown) {
      new Notice(`${BRAND}: ${err instanceof Error ? err.message : String(err)}`);
      selected = parseGroupsInput(baseline);
      renderBadges();
    } finally {
      ctx.saving.delete(key);
    }
  };

  // ── Popover ──
  const popover = document.createElement("div");
  popover.className = "sprout sprout-popover-overlay";
  popover.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className =
    "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 sprout-pointer-auto";
  popover.appendChild(panel);

  const searchWrap = document.createElement("div");
  searchWrap.className = "flex items-center gap-1 border-b border-border pl-1 pr-0 sprout-browser-search-wrap";
  panel.appendChild(searchWrap);

  const searchIcon = document.createElement("span");
  searchIcon.className =
    "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
  searchIcon.setAttribute("aria-hidden", "true");
  setIcon(searchIcon, "search");
  searchWrap.appendChild(searchIcon);

  const search = document.createElement("input");
  search.type = "text";
  search.className = "bg-transparent text-sm flex-1 h-9 min-w-0 w-full sprout-search-naked";
  search.placeholder = "Search or add group";
  searchWrap.appendChild(search);

  const list = document.createElement("div");
  list.className = "flex flex-col max-h-60 overflow-auto p-1";
  panel.appendChild(list);

  let cleanup: (() => void) | null = null;

  const optionSet = new Set<string>();
  for (const g of (ctx.plugin.store.getAllCards() || [])
    .flatMap((c) => (Array.isArray(c?.groups) ? c.groups : []))
    .map((g) => titleCaseGroupPath(String(g).trim()))
    .filter(Boolean)) {
    for (const tag of expandGroupAncestors(g)) optionSet.add(tag);
  }
  let allOptions = Array.from(optionSet).sort((a, b) =>
    formatGroupDisplay(a).localeCompare(formatGroupDisplay(b)),
  );

  const addOption = (tag: string) => {
    let changed = false;
    for (const t of expandGroupAncestors(tag)) {
      if (!optionSet.has(t)) { optionSet.add(t); changed = true; }
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
    setCssProps(popover, "--sprout-popover-left", `${left}px`);
    setCssProps(popover, "--sprout-popover-width", `${width}px`);
    setCssProps(popover, "--sprout-popover-top", `${dropUp ? upTop : downTop}px`);
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
      row.className =
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground justify-between";

      const text = document.createElement("span");
      text.textContent = label;
      row.appendChild(text);

      if (selected.includes(value) && !isAdd) {
        const check = document.createElement("span");
        check.className =
          "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
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

    if (shouldDropUp) {
      requestAnimationFrame(() => place());
      requestAnimationFrame(() => place());
    }
  };

  const close = () => {
    popover.setAttribute("aria-hidden", "true");
    popover.classList.remove("is-open");
    try { cleanup?.(); } catch (e) { log.swallow("popover cleanup", e); }
    cleanup = null;
    try { popover.remove(); } catch (e) { log.swallow("remove popover", e); }
    void commit();
    renderBadges();
  };

  const open = () => {
    popover.setAttribute("aria-hidden", "false");
    popover.classList.add("is-open");
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
    if (ev.button !== 0) return;
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
}
