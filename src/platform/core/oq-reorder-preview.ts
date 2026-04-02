/**
 * @file src/platform/core/oq-reorder-preview.ts
 * @summary Module for oq reorder preview.
 *
 * @exports
 *  - createOqReorderPreviewController
 *  - createListReorderPreviewController
 */

import { setCssProps } from "./ui";

type BeginDragArgs = {
  fromIdx: number;
  row: HTMLElement;
  dataTransfer?: DataTransfer | null;
  setDragImage?: boolean;
};

type PendingMove = {
  fromIdx: number;
  toIdx: number;
};

type OqReorderPreviewController = {
  beginDrag(args: BeginDragArgs): void;
  updatePointer(clientY: number): void;
  getPendingMove(): PendingMove | null;
  endDrag(): void;
};

type ReorderPreviewOptions = {
  rowSelector: string;
  translateVar: string;
  listActiveClass: string;
  rowAnimatingClass: string;
  rowDraggingClass: string;
  rowDraggingNativeClass: string;
  slotBeforeClass: string;
  slotAfterClass: string;
};

function queryRows(listWrap: HTMLElement, rowSelector: string): HTMLElement[] {
  return Array.from(listWrap.querySelectorAll<HTMLElement>(rowSelector));
}

function clearSlotMarkers(rows: HTMLElement[], options: ReorderPreviewOptions): void {
  rows.forEach((row) => {
    row.classList.remove(options.slotBeforeClass, options.slotAfterClass);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeSlotIndex(rows: HTMLElement[], fromIdx: number, clientY: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (i === fromIdx) continue;
    const rect = rows[i].getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    if (clientY < midpoint) return i;
  }
  return rows.length;
}

function toTargetIndex(slotIdx: number, fromIdx: number, total: number): number {
  const raw = slotIdx > fromIdx ? slotIdx - 1 : slotIdx;
  return clamp(raw, 0, Math.max(0, total - 1));
}

export function createOqReorderPreviewController(listWrap: HTMLElement): OqReorderPreviewController {
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

export function createListReorderPreviewController(
  listWrap: HTMLElement,
  options: ReorderPreviewOptions,
): OqReorderPreviewController {
  let fromIdx = -1;
  let toIdx = -1;
  let slotIdx = -1;
  let dragOffset = 0;
  let active = false;

  const refreshDragOffset = (rows: HTMLElement[]) => {
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
    const rows = queryRows(listWrap, options.rowSelector);
    if (!rows.length || fromIdx < 0 || toIdx < 0 || fromIdx >= rows.length) return;

    clearSlotMarkers(rows, options);

    rows.forEach((row, idx) => {
      row.classList.add(options.rowAnimatingClass);
      let offset = 0;
      if (idx === fromIdx) {
        offset = (toIdx - fromIdx) * dragOffset;
      } else if (toIdx > fromIdx) {
        if (idx > fromIdx && idx <= toIdx) offset = -dragOffset;
      } else if (toIdx < fromIdx) {
        if (idx >= toIdx && idx < fromIdx) offset = dragOffset;
      }
      setCssProps(row, options.translateVar, `${offset}px`);
    });

    if (slotIdx >= 0) {
      if (slotIdx >= rows.length) {
        rows[rows.length - 1]?.classList.add(options.slotAfterClass);
      } else {
        rows[slotIdx]?.classList.add(options.slotBeforeClass);
      }
    }
  };

  return {
    beginDrag({ fromIdx: nextFromIdx, row, dataTransfer, setDragImage }) {
      const rows = queryRows(listWrap, options.rowSelector);
      if (!rows.length) return;

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
        if (setDragImage) dataTransfer.setDragImage(row, 24, 24);
      }

      row.classList.add(options.rowDraggingClass);
      if (dataTransfer) {
        row.classList.add(options.rowDraggingNativeClass);
      }
    },

    updatePointer(clientY: number) {
      if (!active || fromIdx < 0) return;

      const rows = queryRows(listWrap, options.rowSelector);
      if (!rows.length || fromIdx >= rows.length) return;

      const nextSlot = computeSlotIndex(rows, fromIdx, clientY);
      const nextTo = toTargetIndex(nextSlot, fromIdx, rows.length);
      if (nextSlot === slotIdx && nextTo === toIdx) return;

      slotIdx = nextSlot;
      toIdx = nextTo;
      applyPreview();
    },

    getPendingMove() {
      if (!active || fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return null;
      return { fromIdx, toIdx };
    },

    endDrag() {
      if (!active && fromIdx < 0) return;
      active = false;
      fromIdx = -1;
      toIdx = -1;
      slotIdx = -1;
      listWrap.classList.remove(options.listActiveClass);
      clearPreview();
    },
  };
}
