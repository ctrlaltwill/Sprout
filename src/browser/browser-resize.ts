/**
 * @file src/browser/browser-resize.ts
 * @summary Column drag-to-resize handle logic for the Flashcard Browser table.
 * Adds an invisible drag handle on the right edge of each <th> that allows the
 * user to click-and-drag to resize columns, clamped between configurable min/max
 * widths. Temporarily suppresses header click events after a resize to prevent
 * accidental sort toggles.
 *
 * @exports
 *   - ResizeContext — interface providing column width state, DOM references, and min/max constraints
 *   - makeResizableTh — attaches a drag-to-resize handle to a table header cell
 */

import type { ColKey } from "./browser-helpers";

export interface ResizeContext {
  colWidths: Record<string, number>;
  colEls: Record<string, HTMLElement>;
  colMin: Record<string, number>;
  colMax: Record<string, number>;
  /** Set to Date.now() + delay after a resize to suppress accidental header clicks. */
  setSuppressHeaderClickUntil: (ts: number) => void;
}

/**
 * Adds a drag-to-resize handle on the right edge of a `<th>`.
 */
export function makeResizableTh(
  th: HTMLTableCellElement,
  col: ColKey,
  ctx: ResizeContext,
): void {
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
  handle.style.zIndex = "20";

  // Make sure pointer events only on the handle
  handle.style.pointerEvents = "auto";
  th.style.pointerEvents = "auto";

  th.appendChild(handle);

  const onMouseDown = (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();

    const startX = ev.clientX;
    const startW = ctx.colWidths[col] || 120;

    const minW = ctx.colMin[col] ?? 70;
    const maxW = ctx.colMax[col] ?? 500;

    let moved = false;
    ctx.setSuppressHeaderClickUntil(Date.now() + 400);

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 1) moved = true;

      const next = Math.min(maxW, Math.max(minW, startW + dx));
      ctx.colWidths[col] = next;

      const colEl = ctx.colEls[col];
      if (colEl) colEl.style.width = `${next}px`;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      ctx.setSuppressHeaderClickUntil(Date.now() + (moved ? 500 : 250));
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
