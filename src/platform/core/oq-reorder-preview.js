/**
 * @file src/platform/core/oq-reorder-preview.ts
 * @summary Module for oq reorder preview.
 *
 * @exports
 *  - createOqReorderPreviewController
 *  - createListReorderPreviewController
 */
import { setCssProps } from "./ui";
function queryRows(listWrap, rowSelector) {
    return Array.from(listWrap.querySelectorAll(rowSelector));
}
function clearSlotMarkers(rows, options) {
    rows.forEach((row) => {
        row.classList.remove(options.slotBeforeClass, options.slotAfterClass);
    });
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function computeSlotIndex(rows, fromIdx, clientY) {
    for (let i = 0; i < rows.length; i++) {
        if (i === fromIdx)
            continue;
        const rect = rows[i].getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY < midpoint)
            return i;
    }
    return rows.length;
}
function toTargetIndex(slotIdx, fromIdx, total) {
    const raw = slotIdx > fromIdx ? slotIdx - 1 : slotIdx;
    return clamp(raw, 0, Math.max(0, total - 1));
}
export function createOqReorderPreviewController(listWrap) {
    return createListReorderPreviewController(listWrap, {
        rowSelector: ".learnkit-oq-step-row",
        translateVar: "--learnkit-oq-translate",
        listActiveClass: "learnkit-oq-drag-active",
        rowAnimatingClass: "learnkit-oq-row-anim",
        rowDraggingClass: "learnkit-oq-row-dragging",
        rowDraggingNativeClass: "learnkit-oq-row-dragging-native",
        slotBeforeClass: "learnkit-oq-slot-before",
        slotAfterClass: "learnkit-oq-slot-after",
    });
}
export function createListReorderPreviewController(listWrap, options) {
    let fromIdx = -1;
    let toIdx = -1;
    let slotIdx = -1;
    let dragOffset = 0;
    let active = false;
    const refreshDragOffset = (rows) => {
        const first = rows[0];
        if (!first) {
            dragOffset = 0;
            return;
        }
        const gap = parseFloat(getComputedStyle(listWrap).rowGap || "0");
        dragOffset = Math.round(first.getBoundingClientRect().height + gap);
    };
    const clearPreview = () => {
        const rows = queryRows(listWrap, options.rowSelector);
        clearSlotMarkers(rows, options);
        rows.forEach((row) => {
            setCssProps(row, options.translateVar, "0px");
            row.classList.remove(options.rowAnimatingClass, options.rowDraggingClass, options.rowDraggingNativeClass);
        });
    };
    const applyPreview = () => {
        var _a, _b;
        const rows = queryRows(listWrap, options.rowSelector);
        if (!rows.length || fromIdx < 0 || toIdx < 0 || fromIdx >= rows.length)
            return;
        clearSlotMarkers(rows, options);
        rows.forEach((row, idx) => {
            row.classList.add(options.rowAnimatingClass);
            let offset = 0;
            if (idx === fromIdx) {
                offset = (toIdx - fromIdx) * dragOffset;
            }
            else if (toIdx > fromIdx) {
                if (idx > fromIdx && idx <= toIdx)
                    offset = -dragOffset;
            }
            else if (toIdx < fromIdx) {
                if (idx >= toIdx && idx < fromIdx)
                    offset = dragOffset;
            }
            setCssProps(row, options.translateVar, `${offset}px`);
        });
        if (slotIdx >= 0) {
            if (slotIdx >= rows.length) {
                (_a = rows[rows.length - 1]) === null || _a === void 0 ? void 0 : _a.classList.add(options.slotAfterClass);
            }
            else {
                (_b = rows[slotIdx]) === null || _b === void 0 ? void 0 : _b.classList.add(options.slotBeforeClass);
            }
        }
    };
    return {
        beginDrag({ fromIdx: nextFromIdx, row, dataTransfer, setDragImage }) {
            const rows = queryRows(listWrap, options.rowSelector);
            if (!rows.length)
                return;
            fromIdx = clamp(nextFromIdx, 0, rows.length - 1);
            toIdx = fromIdx;
            slotIdx = fromIdx;
            active = true;
            listWrap.classList.add(options.listActiveClass);
            refreshDragOffset(rows);
            rows.forEach((r) => {
                r.classList.add(options.rowAnimatingClass);
                setCssProps(r, options.translateVar, "0px");
            });
            if (dataTransfer) {
                dataTransfer.effectAllowed = "move";
                dataTransfer.setData("text/plain", String(fromIdx));
                if (setDragImage)
                    dataTransfer.setDragImage(row, 24, 24);
            }
            row.classList.add(options.rowDraggingClass);
            if (dataTransfer) {
                row.classList.add(options.rowDraggingNativeClass);
            }
        },
        updatePointer(clientY) {
            if (!active || fromIdx < 0)
                return;
            const rows = queryRows(listWrap, options.rowSelector);
            if (!rows.length || fromIdx >= rows.length)
                return;
            const nextSlot = computeSlotIndex(rows, fromIdx, clientY);
            const nextTo = toTargetIndex(nextSlot, fromIdx, rows.length);
            if (nextSlot === slotIdx && nextTo === toIdx)
                return;
            slotIdx = nextSlot;
            toIdx = nextTo;
            applyPreview();
        },
        getPendingMove() {
            if (!active || fromIdx < 0 || toIdx < 0 || fromIdx === toIdx)
                return null;
            return { fromIdx, toIdx };
        },
        endDrag() {
            if (!active && fromIdx < 0)
                return;
            active = false;
            fromIdx = -1;
            toIdx = -1;
            slotIdx = -1;
            listWrap.classList.remove(options.listActiveClass);
            clearPreview();
        },
    };
}
