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
import { setCssProps } from "../../../platform/core/ui";
/**
 * Adds a drag-to-resize handle on the right edge of a `<th>`.
 */
export function makeResizableTh(th, col, ctx) {
    th.classList.add("learnkit-col-resize-host", "learnkit-col-resize-host");
    const RESIZE_ZONE_PX = 14;
    const handle = document.createElement("div");
    handle.className = "learnkit-col-resize learnkit-col-resize-handle";
    handle.setAttribute("aria-label", "Drag to resize");
    setCssProps(handle, "--learnkit-resize-zone", `${RESIZE_ZONE_PX}px`);
    th.appendChild(handle);
    const onMouseDown = (ev) => {
        var _a, _b;
        ev.preventDefault();
        ev.stopPropagation();
        const startX = ev.clientX;
        const startW = ctx.colWidths[col] || 120;
        const minW = (_a = ctx.colMin[col]) !== null && _a !== void 0 ? _a : 70;
        const maxW = (_b = ctx.colMax[col]) !== null && _b !== void 0 ? _b : 500;
        let moved = false;
        ctx.setSuppressHeaderClickUntil(Date.now() + 400);
        const onMove = (e) => {
            const dx = e.clientX - startX;
            if (!moved && Math.abs(dx) > 1)
                moved = true;
            const next = Math.min(maxW, Math.max(minW, startW + dx));
            ctx.colWidths[col] = next;
            const colEl = ctx.colEls[col];
            if (colEl)
                setCssProps(colEl, "--learnkit-col-width", `${next}px`);
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
