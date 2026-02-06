// src/reviewer/moreMenu.ts
import { POPOVER_Z_INDEX } from "../core/constants";
import { log } from "../core/logger";
import type { SproutReviewerView } from "./review-view";

export function closeMoreMenu(view: SproutReviewerView) {
  view._moreOpen = false;
  if (view._moreBtnEl) {
    view._moreBtnEl.setAttribute("aria-expanded", "false");
  }

  const popover = view._moreMenuEl;
  if (popover) {
    popover.setAttribute("aria-hidden", "true");
    popover.style.setProperty("display", "none", "important");
    try {
      popover.remove();
    } catch (e) { log.swallow("moreMenu popover.remove", e); }
  }

  const cleanup = (view as any)._moreCleanup as (() => void) | null;
  if (cleanup) {
    try {
      cleanup();
    } catch (e) { log.swallow("moreMenu cleanup", e); }
    (view as any)._moreCleanup = null;
  }
}

export function toggleMoreMenu(view: SproutReviewerView, force?: boolean) {
  const next = typeof force === "boolean" ? force : !view._moreOpen;
  view._moreOpen = next;

  if (view._moreBtnEl) {
    view._moreBtnEl.setAttribute("aria-expanded", next ? "true" : "false");
  }

  const popover = view._moreMenuEl;
  if (!popover) return;

  if (!next) {
    closeMoreMenu(view);
    return;
  }

  const panel = popover.querySelector(".sprout-more-panel");

  const place = () => {
    const btn = view._moreBtnEl as HTMLElement | null;
    if (!btn || !panel) return;
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(200, Math.round(panel.getBoundingClientRect().width || 0));

    let left = r.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    if (left < margin) left = margin;

    const panelRect = panel.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, r.top - panelRect.height - 6);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.width = `${width}px`;
  };

  popover.setAttribute("aria-hidden", "false");
  popover.style.setProperty("display", "block", "important");

  document.body.appendChild(popover);

  requestAnimationFrame(() => place());

  const onResizeOrScroll = () => place();
  const onDocPointerDown = (ev: PointerEvent) => {
    const t = ev.target as Node | null;
    if (!t) return;
    if (view._moreWrap?.contains(t) || popover.contains(t)) return;
    closeMoreMenu(view);
  };
  const onDocKeydown = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMoreMenu(view);
    view._moreBtnEl?.focus?.();
  };

  window.addEventListener("resize", onResizeOrScroll, true);
  window.addEventListener("scroll", onResizeOrScroll, true);
  const tid = window.setTimeout(() => {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }, 0);

  (view as any)._moreCleanup = () => {
    window.clearTimeout(tid);
    window.removeEventListener("resize", onResizeOrScroll, true);
    window.removeEventListener("scroll", onResizeOrScroll, true);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
  };

  const firstItem = popover.querySelector("[role='menuitem']");
  firstItem?.focus?.();
}

export function injectMoreMenu(view: SproutReviewerView) {
  if (view.mode !== "session" || !view.session) return;

  const card = view.currentCard();
  if (!card) return;

  const id = String((card as any).id);
  const graded = !!view.session.graded[id];

  const root = view.contentEl;

  root
    .querySelectorAll(
      [
        'button[data-sprout-action="undo-grade"]',
        'button[data-sprout-action="bury-card"]',
        'button[data-sprout-action="suspend-card"]',
        'button[data-sprout-action="open-note"]',
        'button[data-sprout-action="edit-card"]',
        '[data-sprout-action="more-wrap"]',
        '[data-sprout-popover-id*="more-"]',
        'button[data-sprout-action="more-toggle"]',
      ].join(","),
    )
    .forEach((n) => n.remove());

  const flash = (root.querySelector(".sprout-flashcard")) ?? root;
  const rows = Array.from(flash.querySelectorAll(".sprout-row"));
  if (!rows.length) return;

  const rowHasBtn = (row: HTMLElement, label: string) => {
    const btnLefts = Array.from(row.querySelectorAll(".sprout-btn-left"));
    return btnLefts.some((x) => (x.textContent || "").trim().toLowerCase() === label.toLowerCase());
  };

  const rowHasAnyBtn = (row: HTMLElement, labels: string[]) => labels.some((l) => rowHasBtn(row, l));

  const gradeLabels = ["Again", "Hard", "Good", "Easy"];
  const gradeRow = rows.find((r) => rowHasAnyBtn(r, gradeLabels)) ?? null;
  const revealRow = rows.find((r) => rowHasBtn(r, "Reveal")) ?? null;

  const targetRow = gradeRow ?? revealRow ?? rows[rows.length - 1];
  if (!targetRow) return;

  const disp = getComputedStyle(targetRow).display;
  if (disp !== "flex") {
    targetRow.style.display = "flex";
    targetRow.style.alignItems = "center";
  }

  view._moreWrap = null;
  view._moreMenuEl = null;
  view._moreBtnEl = null;
  view._moreOpen = false;

  const popoverId = `sprout-menu-${Math.random().toString(36).slice(2, 8)}`;
  const triggerId = `${popoverId}-trigger`;
  const menuId = `${popoverId}-menu`;

  // Instead of rendering the menu inside the card row, render the popover at the document body root for correct positioning
  const wrap = document.createElement("div");
  wrap.className = "sprout bc relative inline-flex";
  wrap.dataset.bcAction = "more-wrap";
  wrap.style.setProperty("overflow", "visible", "important");

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.id = triggerId;
  moreBtn.className = "bc btn-outline";
  moreBtn.dataset.bcAction = "more-toggle";
  moreBtn.setAttribute("aria-haspopup", "menu");
  moreBtn.setAttribute("aria-controls", menuId);
  moreBtn.setAttribute("aria-expanded", "false");
  moreBtn.setAttribute("popovertarget", popoverId);
  moreBtn.setAttribute("title", "More actions");
  moreBtn.setAttribute("data-tooltip", "More actions");
  moreBtn.textContent = "More";

  const kbd = document.createElement("kbd");
  kbd.className = "bc kbd ml-2";
  kbd.textContent = "M";
  moreBtn.appendChild(kbd);

  moreBtn.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    toggleMoreMenu(view);
  });
  moreBtn.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      toggleMoreMenu(view);
    }
  });

  // Create the popover and append to document.body for global positioning
  const popover = document.createElement("div");
  popover.id = popoverId;
  popover.className = "bc";
  popover.setAttribute("aria-hidden", "true");
  popover.style.setProperty("position", "fixed", "important");
  popover.style.setProperty("z-index", POPOVER_Z_INDEX, "important");
  popover.style.setProperty("display", "none", "important");
  popover.style.setProperty("pointer-events", "auto", "important");
  document.body.appendChild(popover);

  const panel = document.createElement("div");
  panel.className =
    "bc sprout-more-panel rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1";
  panel.style.setProperty("pointer-events", "auto", "important");
  popover.appendChild(panel);

  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.id = menuId;
  
  menu.className = "bc flex flex-col";
  panel.appendChild(menu);

  const createMenuItem = (
    label: string,
    hotkey: string,
    onClick: () => void,
    disabled?: boolean,
  ) => {
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    item.tabIndex = disabled ? -1 : 0;

    item.className = disabled
      ? "bc group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm select-none opacity-50 cursor-not-allowed"
      : "bc group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

    if (disabled) {
      item.style.setProperty("pointer-events", "none", "important");
    }

    const label_span = document.createElement("span");
    label_span.className = "bc";
    label_span.textContent = label;
    item.appendChild(label_span);

    const spacer = document.createElement("kbd");
    spacer.className = "bc kbd ml-auto text-xs text-muted-foreground tracking-widest";
    spacer.textContent = hotkey;
    item.appendChild(spacer);

    if (!disabled) {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMoreMenu(view);
        onClick();
      });

      item.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          closeMoreMenu(view);
          onClick();
        }
      });
    }

    return item;
  };

  // --- Undo (only show on the *following* card)
  const undoFrame: any = (view as any)._undo ?? null;
  const canUndoNow = typeof (view as any).canUndo === "function" ? (view as any).canUndo() : false;

  const showUndoHere = !!canUndoNow && !!undoFrame && String(undoFrame.id ?? "") !== String(id);

  const buryItem = createMenuItem("Bury", "B", () => void view.buryCurrentCard(), graded);
  buryItem.dataset.bcAction = "bury-card";
  menu.appendChild(buryItem);

  const suspendItem = createMenuItem("Suspend", "S", () => void view.suspendCurrentCard(), graded);
  suspendItem.dataset.bcAction = "suspend-card";
  menu.appendChild(suspendItem);

  if (showUndoHere) {
    const sep = document.createElement("hr");
    sep.setAttribute("role", "separator");
    sep.className = "bc h-px bg-border my-2";
    menu.appendChild(sep);

    const undoItem = createMenuItem("Undo", "U", () => {
      void (view as any).undoLastGrade?.();
    });
    undoItem.dataset.bcAction = "undo-grade";
    menu.appendChild(undoItem);
  }

  const openItem = createMenuItem("Open Note", "O", () => void view.openCurrentCardInNote());
  openItem.dataset.bcAction = "open-note";
  menu.appendChild(openItem);

  const editItem = createMenuItem("Edit", "E", () => view.openEditModalForCurrentCard());
  editItem.dataset.bcAction = "edit-card";
  menu.appendChild(editItem);

  menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());

  wrap.appendChild(moreBtn);
  // Do NOT append popover to wrap/card; it's now in document.body
  targetRow.appendChild(wrap);

  for (const r of rows) {
    const hasButtons = r.querySelector("button") != null;
    const hasMeaningfulContent = (r.textContent || "").trim().length > 0;
    if (!hasButtons && !hasMeaningfulContent) r.remove();
  }

  view._moreWrap = wrap;
  view._moreMenuEl = popover;
  view._moreBtnEl = moreBtn;
}
