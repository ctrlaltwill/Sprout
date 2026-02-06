/**
 * widget/widget-buttons.ts
 * ────────────────────────
 * Standalone UI factory functions for the Sprout sidebar widget.
 *
 * Exports:
 *  - makeIconButton      – icon-only button with tooltip
 *  - makeTextButton      – text button with optional kbd hint
 *  - applyWidgetActionButtonStyles – adds the standard action class
 *  - applyWidgetHoverDarken        – adds hover colour transitions
 *  - attachWidgetMoreMenu          – creates the "More" dropdown menu
 */

import { setIcon } from "obsidian";
import { POPOVER_Z_INDEX } from "../core/constants";
import { log } from "../core/logger";

/* ------------------------------------------------------------------ */
/*  Hover colour helper                                                */
/* ------------------------------------------------------------------ */

/**
 * Applies CSS variable-based hover/focus darkening to a button.
 * Sets background and border colours on mouseenter/focus and reverts
 * on mouseleave/blur.
 */
export function applyWidgetHoverDarken(btn: HTMLButtonElement) {
  const baseBg = "var(--background)";
  const baseBorder = "var(--border)";
  const hoverBg = "var(--color-base-25)";
  const hoverBorder = "var(--color-base-30)";

  const setBase = () => {
    btn.style.setProperty("background-color", baseBg, "important");
    btn.style.setProperty("border-color", baseBorder, "important");
  };

  const setHover = () => {
    btn.style.setProperty("background-color", hoverBg, "important");
    btn.style.setProperty("border-color", hoverBorder, "important");
  };

  btn.addEventListener("mouseenter", setHover);
  btn.addEventListener("mouseleave", setBase);
  btn.addEventListener("focus", setHover);
  btn.addEventListener("blur", setBase);
}

/* ------------------------------------------------------------------ */
/*  Icon button factory                                                */
/* ------------------------------------------------------------------ */

/**
 * Creates a square icon button with a tooltip label.
 *
 * @param opts.icon   – Lucide icon name (passed to Obsidian `setIcon`)
 * @param opts.label  – Tooltip text (via `data-tooltip`)
 * @param opts.title  – Optional native `title` attribute
 * @param opts.className – CSS classes
 * @param opts.onClick   – Click handler
 */
export function makeIconButton(opts: {
  icon: string;
  label: string;
  title?: string;
  className: string;
  onClick: () => void;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className;
  btn.setAttribute("data-tooltip", opts.label);
  if (opts.title) btn.title = opts.title;
  setIcon(btn, opts.icon);
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });
  applyWidgetHoverDarken(btn);
  return btn;
}

/* ------------------------------------------------------------------ */
/*  Text button factory                                                */
/* ------------------------------------------------------------------ */

/**
 * Creates a text button with an optional keyboard-shortcut badge.
 *
 * @param opts.label     – Button label text
 * @param opts.title     – Optional native `title` attribute
 * @param opts.className – CSS classes
 * @param opts.onClick   – Click handler
 * @param opts.kbd       – Optional keyboard shortcut string shown as a `<kbd>` badge
 */
export function makeTextButton(opts: {
  label: string;
  title?: string;
  className: string;
  onClick: () => void;
  kbd?: string;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className;
  if (opts.title) btn.title = opts.title;

  const content = document.createElement("span");
  content.textContent = opts.label;
  btn.appendChild(content);

  if (opts.kbd) {
    const kbd = document.createElement("kbd");
    kbd.className = "bc kbd ml-2 text-xs";
    kbd.textContent = opts.kbd;
    btn.appendChild(kbd);
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });
  applyWidgetHoverDarken(btn);
  return btn;
}

/* ------------------------------------------------------------------ */
/*  Action button styling                                              */
/* ------------------------------------------------------------------ */

/** Adds the shared `sprout-widget-action-btn` class to a button. */
export function applyWidgetActionButtonStyles(btn: HTMLButtonElement) {
  btn.classList.add("sprout-widget-action-btn");
}

/* ------------------------------------------------------------------ */
/*  "More" dropdown menu                                               */
/* ------------------------------------------------------------------ */

/**
 * Attaches a dropdown menu to a trigger button with options for
 * Open, Bury, Suspend, and Undo.  The menu is positioned relative
 * to the trigger and auto-closes on outside click or Escape.
 *
 * @returns `{ toggle, close, isOpen }` control handles
 */
export function attachWidgetMoreMenu(opts: {
  trigger: HTMLButtonElement;
  canUndo: boolean;
  onUndo: () => void;
  canBurySuspend: boolean;
  onBury: () => void;
  onSuspend: () => void;
  openNote?: () => void;
}): { toggle: () => void; close: () => void; isOpen: () => boolean } {
  const id = `bc-widget-menu-${Math.random().toString(36).slice(2, 8)}`;
  const trigger = opts.trigger;
  trigger.id = `${id}-trigger`;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", `${id}-menu`);
  trigger.setAttribute("aria-expanded", "false");

  const popover = document.createElement("div");
  popover.id = `${id}-popover`;
  popover.className = "bc sprout";
  popover.setAttribute("aria-hidden", "true");
  popover.style.setProperty("position", "fixed", "important");
  popover.style.setProperty("z-index", POPOVER_Z_INDEX, "important");
  popover.style.setProperty("display", "none", "important");
  popover.style.setProperty("pointer-events", "auto", "important");

  const panel = document.createElement("div");
  panel.className = "bc sprout rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1";
  panel.style.setProperty("pointer-events", "auto", "important");
  popover.appendChild(panel);

  const menu = document.createElement("div");
  menu.className = "bc sprout flex flex-col";
  menu.setAttribute("role", "menu");
  menu.id = `${id}-menu`;
  panel.appendChild(menu);

  const addItem = (label: string, hotkey: string | null, onClick: () => void, disabled = false) => {
    const item = document.createElement("div");
    item.className =
      "bc group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
    item.setAttribute("role", "menuitem");
    item.tabIndex = disabled ? -1 : 0;
    if (disabled) {
      item.style.opacity = "0.5";
      item.style.cursor = "not-allowed";
      item.setAttribute("aria-disabled", "true");
    }

    const labelSpan = document.createElement("span");
    labelSpan.className = "bc";
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    if (hotkey) {
      const key = document.createElement("kbd");
      key.className = "bc kbd ml-auto text-xs text-muted-foreground tracking-widest";
      key.textContent = hotkey;
      item.appendChild(key);
    }

    const activate = () => {
      if (disabled) return;
      onClick();
      close();
    };

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activate();
    });

    item.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        activate();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        trigger.focus();
      }
    });

    menu.appendChild(item);
  };

  if (typeof opts.openNote === "function") {
    addItem("Open", "O", opts.openNote, false);
  }
  addItem("Bury", "B", opts.onBury, !opts.canBurySuspend);
  addItem("Suspend", "S", opts.onSuspend, !opts.canBurySuspend);
  addItem("Undo last grade", "U", opts.onUndo, !opts.canUndo);

  let cleanup: (() => void) | null = null;

  const place = () => {
    const r = trigger.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(200, Math.round(panel.getBoundingClientRect().width || 0));

    let left = r.right - width;
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

  const close = () => {
    trigger.setAttribute("aria-expanded", "false");
    popover.setAttribute("aria-hidden", "true");
    popover.style.setProperty("display", "none", "important");

    try {
      cleanup?.();
    } catch (e) { log.swallow("popover cleanup", e); }
    cleanup = null;

    try {
      popover.remove();
    } catch (e) { log.swallow("remove popover", e); }
  };

  const open = () => {
    trigger.setAttribute("aria-expanded", "true");
    popover.setAttribute("aria-hidden", "false");
    popover.style.setProperty("display", "block", "important");

    document.body.appendChild(popover);
    requestAnimationFrame(() => place());

    const onResizeOrScroll = () => place();
    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (trigger.contains(t) || popover.contains(t)) return;
      close();
    };
    const onDocKeydown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
      trigger.focus();
    };

    window.addEventListener("resize", onResizeOrScroll, true);
    window.addEventListener("scroll", onResizeOrScroll, true);

    const tid = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
      document.addEventListener("keydown", onDocKeydown, true);
    }, 0);

    cleanup = () => {
      window.clearTimeout(tid);
      window.removeEventListener("resize", onResizeOrScroll, true);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };
  };

  const toggle = () => {
    const isOpen = trigger.getAttribute("aria-expanded") === "true";
    if (isOpen) close();
    else open();
  };

  trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggle();
  });

  return { toggle, close, isOpen: () => trigger.getAttribute("aria-expanded") === "true" };
}
