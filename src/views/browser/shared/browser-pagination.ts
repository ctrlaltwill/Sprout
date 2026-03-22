/**
 * @file src/browser/browser-pagination.ts
 * @summary Renders pagination controls (prev/next buttons, numbered page
 * buttons, and ellipsis jumps) for the Flashcard Browser table. Extracted
 * from SproutCardBrowserView to keep pagination logic self-contained.
 *
 * @exports
 *   - PaginationContext — interface describing the page state and callbacks the renderer needs
 *   - renderPagination — renders pagination buttons into a host element based on total row count
 */

import { setIcon } from "obsidian";
import { clearNode } from "../browser-helpers";
import { t } from "../../../platform/translations/translator";

export interface PaginationContext {
  pageIndex: number;
  pageSize: number;
  interfaceLanguage?: string;
  setPageIndex: (idx: number) => void;
  refreshTable: () => void;
}

/**
 * Renders pagination buttons into `host`.
 * Mutates ctx.pageIndex via ctx.setPageIndex when the user clicks a button.
 */
export function renderPagination(
  host: HTMLElement,
  totalRows: number,
  ctx: PaginationContext,
): void {
  const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
    t(ctx.interfaceLanguage, token, fallback, vars);

  clearNode(host);

  const size = Math.max(1, Math.floor(Number(ctx.pageSize) || 5));
  const totalPages = Math.max(1, Math.ceil(totalRows / size));

  let pageIndex = ctx.pageIndex;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) pageIndex = 0;
  if (pageIndex > totalPages - 1) pageIndex = totalPages - 1;
  ctx.setPageIndex(pageIndex);

  if (totalRows <= size) {
    const small = document.createElement("div");
    small.className = "text-sm text-muted-foreground";
    small.textContent = totalRows === 0
      ? tx("ui.browser.pagination.pageXofY", "Page {page} / {total}", { page: 0, total: 0 })
      : tx("ui.browser.pagination.pageXofY", "Page {page} / {total}", { page: 1, total: 1 });
    host.appendChild(small);
    return;
  }

  const nav = document.createElement("nav");
  nav.setAttribute("role", "navigation");
  nav.className = "flex items-center gap-2 lk-browser-pagination";
  host.appendChild(nav);

  const mkBtn = (label: string, tooltip: string, disabled: boolean, active: boolean, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `sprout-btn-toolbar${active ? " sprout-btn-control" : ""}`;
    b.classList.add(..."h-8 px-2".split(" "));
    b.textContent = label;
    b.setAttribute("aria-label", tooltip);
    b.setAttribute("data-tooltip-position", "top");
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

  const mkEllipsisBtn = (targetPage: number) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sprout-btn-toolbar h-8 px-2";
    b.textContent = "…";
    b.setAttribute("aria-label", tx("ui.browser.pagination.pageN", "Page {page}", { page: targetPage }));
    b.setAttribute("data-tooltip-position", "top");
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ctx.setPageIndex(targetPage - 1);
      ctx.refreshTable();
    });
    return b;
  };

  const current = pageIndex + 1;
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
  prev.className = "sprout-btn-toolbar";
  prev.classList.add(..."h-8 px-2".split(" "));
  prev.setAttribute("aria-label", tx("ui.browser.pagination.prevPage", "Previous page"));
  prev.setAttribute("data-tooltip-position", "top");
  prev.disabled = pageIndex <= 0;
  prev.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (prev.disabled) return;
    ctx.setPageIndex(Math.max(0, pageIndex - 1));
    ctx.refreshTable();
  });
  const prevIcon = document.createElement("span");
  prevIcon.setAttribute("aria-hidden", "true");
  prevIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(prevIcon, "chevron-left");
  prev.appendChild(prevIcon);
  const prevTxt = document.createElement("span");
  prevTxt.className = "ml-1";
  prevTxt.textContent = tx("ui.browser.pagination.prev", "Prev");
  prev.appendChild(prevTxt);
  nav.appendChild(prev);

  // First page
  if (start > 1) {
    nav.appendChild(
      mkBtn("1", tx("ui.browser.pagination.pageN", "Page {page}", { page: 1 }), false, current === 1, () => {
        ctx.setPageIndex(0);
        ctx.refreshTable();
      }),
    );
  }

  // Main page numbers
  for (let p = start; p <= end; p++) {
    nav.appendChild(
      mkBtn(String(p), tx("ui.browser.pagination.pageN", "Page {page}", { page: p }), false, p === current, () => {
        ctx.setPageIndex(p - 1);
        ctx.refreshTable();
      }),
    );
  }

  // Ellipsis as a button before last page if needed
  if (end < totalPagesLocal - 1) {
    nav.appendChild(mkEllipsisBtn(end + 1));
  }

  // Last page
  if (end < totalPagesLocal) {
    nav.appendChild(
      mkBtn(String(totalPagesLocal), tx("ui.browser.pagination.pageN", "Page {page}", { page: totalPagesLocal }), false, current === totalPagesLocal, () => {
        ctx.setPageIndex(totalPagesLocal - 1);
        ctx.refreshTable();
      }),
    );
  }

  // Next
  const next = document.createElement("button");
  next.type = "button";
  next.className = "sprout-btn-toolbar";
  next.classList.add(..."h-8 px-2".split(" "));
  next.setAttribute("aria-label", tx("ui.browser.pagination.nextPage", "Next page"));
  next.setAttribute("data-tooltip-position", "top");
  next.disabled = pageIndex >= totalPagesLocal - 1;
  next.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (next.disabled) return;
    ctx.setPageIndex(Math.min(totalPagesLocal - 1, pageIndex + 1));
    ctx.refreshTable();
  });
  const nextTxt = document.createElement("span");
  nextTxt.className = "mr-1";
  nextTxt.textContent = tx("ui.browser.pagination.next", "Next");
  next.appendChild(nextTxt);
  const nextIcon = document.createElement("span");
  nextIcon.setAttribute("aria-hidden", "true");
  nextIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(nextIcon, "chevron-right");
  next.appendChild(nextIcon);
  nav.appendChild(next);
}
