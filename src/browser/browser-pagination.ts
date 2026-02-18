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
import { clearNode } from "./browser-helpers";

export interface PaginationContext {
  pageIndex: number;
  pageSize: number;
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
  clearNode(host);

  const size = Math.max(1, Math.floor(Number(ctx.pageSize) || 25));
  const totalPages = Math.max(1, Math.ceil(totalRows / size));

  let pageIndex = ctx.pageIndex;
  if (!Number.isFinite(pageIndex) || pageIndex < 0) pageIndex = 0;
  if (pageIndex > totalPages - 1) pageIndex = totalPages - 1;
  ctx.setPageIndex(pageIndex);

  if (totalRows <= size) {
    const small = document.createElement("div");
    small.className = "text-sm text-muted-foreground";
    small.textContent = totalRows === 0 ? "Page 0 / 0" : "Page 1 / 1";
    host.appendChild(small);
    return;
  }

  const nav = document.createElement("nav");
  nav.setAttribute("role", "navigation");
  nav.className = "flex items-center gap-2 sprout-browser-pagination";
  host.appendChild(nav);

  const mkBtn = (label: string, tooltip: string, disabled: boolean, active: boolean, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = active ? "btn" : "btn-outline";
    b.classList.add(..."h-8 px-2".split(" "));
    b.textContent = label;
    b.setAttribute("data-tooltip", tooltip);
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
    b.className = "btn-outline h-8 px-2";
    b.textContent = "…";
    b.setAttribute("data-tooltip", `Page ${targetPage}`);
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
  prev.className = "btn-outline";
  prev.classList.add(..."h-8 px-2".split(" "));
  prev.setAttribute("data-tooltip", "Previous page");
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
  prevTxt.textContent = "Prev";
  prev.appendChild(prevTxt);
  nav.appendChild(prev);

  // First page
  if (start > 1) {
    nav.appendChild(
      mkBtn("1", "Page 1", false, current === 1, () => {
        ctx.setPageIndex(0);
        ctx.refreshTable();
      }),
    );
  }

  // Main page numbers
  for (let p = start; p <= end; p++) {
    nav.appendChild(
      mkBtn(String(p), `Page ${p}`, false, p === current, () => {
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
      mkBtn(String(totalPagesLocal), `Page ${totalPagesLocal}`, false, current === totalPagesLocal, () => {
        ctx.setPageIndex(totalPagesLocal - 1);
        ctx.refreshTable();
      }),
    );
  }

  // Next
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn-outline";
  next.classList.add(..."h-8 px-2".split(" "));
  next.setAttribute("data-tooltip", "Next page");
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
  nextTxt.textContent = "Next";
  next.appendChild(nextTxt);
  const nextIcon = document.createElement("span");
  nextIcon.setAttribute("aria-hidden", "true");
  nextIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
  setIcon(nextIcon, "chevron-right");
  next.appendChild(nextIcon);
  nav.appendChild(next);
}
