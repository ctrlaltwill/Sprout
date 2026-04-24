/**
 * @file src/browser/browser-dropdowns.ts
 * @summary Factory functions for body-portal dropdown menus used in the Flashcard
 * Browser toolbar. Provides a generic radio-style dropdown (used for type, stage,
 * due, and page-size filters) and a checkbox-style columns-visibility dropdown.
 * Both use fixed-position popovers to avoid clipping issues in Obsidian panes.
 *
 * @exports
 *   - DropdownMenuArgs — interface for configuring a generic radio dropdown menu
 *   - makeDropdownMenu — creates a radio-style dropdown with trigger button, popover, and keyboard support
 *   - ColumnsDropdownArgs — interface for configuring the columns-visibility dropdown
 *   - ColumnsDropdownContext — interface providing get/set callbacks for column visibility state
 *   - makeColumnsDropdown — creates a checkbox-style dropdown for toggling table column visibility
 */
import { setIcon } from "obsidian";
import { log } from "../../../platform/core/logger";
import { clearNode } from "../browser-helpers";
import { placePopover } from "../../../platform/core/ui";
export function makeDropdownMenu(args) {
    const id = `sprout-dd-${Math.random().toString(36).slice(2, 9)}`;
    const root = document.createElement("div");
    root.id = id;
    root.className = "relative inline-flex learnkit-overflow-visible";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `${id}-trigger`;
    trigger.className = `learnkit-btn-toolbar h-9 px-3 text-sm inline-flex items-center gap-2${args.triggerClassName ? ` ${args.triggerClassName}` : ""}`;
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", args.label);
    trigger.setAttribute("data-tooltip-position", "top");
    trigger.classList.add("learnkit-pointer-auto", "learnkit-pointer-auto");
    root.appendChild(trigger);
    const trigText = document.createElement("span");
    trigText.className = "truncate";
    trigger.appendChild(trigText);
    const chevron = document.createElement("span");
    chevron.className = "inline-flex items-center justify-center [&_svg]:size-4 transition-transform duration-150 ease-out";
    chevron.setAttribute("aria-hidden", "true");
    setIcon(chevron, "chevron-down");
    trigger.appendChild(chevron);
    let current = args.value;
    const labelFor = (v) => { var _a, _b; return (_b = (_a = args.options.find((o) => o.v === v)) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : String(v); };
    // Body-portal popover (fixed) avoids clipping/z-index issues in Obsidian panes.
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "learnkit";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay", "learnkit-dd-popover", "learnkit-dd-popover");
    const panel = document.createElement("div");
    panel.className = "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-dd-panel";
    popover.appendChild(panel);
    sproutWrapper.appendChild(popover);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.id = `${id}-menu`;
    menu.className = "flex flex-col";
    panel.appendChild(menu);
    const items = [];
    const setChecked = (item, checked) => {
        item.setAttribute("aria-checked", checked ? "true" : "false");
    };
    const buildItems = () => {
        clearNode(menu);
        items.length = 0;
        for (const opt of args.options) {
            const item = document.createElement("div");
            item.setAttribute("role", "menuitemradio");
            item.setAttribute("aria-checked", opt.v === current ? "true" : "false");
            item.tabIndex = 0;
            item.className = ("group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground");
            const dotWrap = document.createElement("div");
            dotWrap.className = "size-4 flex items-center justify-center";
            item.appendChild(dotWrap);
            const dot = document.createElement("div");
            dot.className = "size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
            dot.setAttribute("aria-hidden", "true");
            dotWrap.appendChild(dot);
            const txt = document.createElement("span");
            txt.textContent = opt.label;
            item.appendChild(txt);
            if (opt.hint) {
                const hint = document.createElement("span");
                hint.className = "text-muted-foreground ml-auto text-sm tracking-wide";
                hint.textContent = opt.hint;
                item.appendChild(hint);
            }
            const activate = () => {
                var _a;
                current = opt.v;
                trigText.textContent = labelFor(current);
                for (const it of items)
                    setChecked(it.el, it.v === current);
                // keep existing behaviour: filter changes reset to page 1
                (_a = args.onBeforeChange) === null || _a === void 0 ? void 0 : _a.call(args);
                args.onChange(current);
                close();
            };
            item.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                activate();
            });
            item.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    activate();
                }
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    close();
                    trigger.focus();
                }
            });
            menu.appendChild(item);
            items.push({ v: opt.v, el: item });
        }
    };
    const place = () => {
        var _a;
        return placePopover({
            trigger, panel, popoverEl: popover,
            width: document.body.classList.contains("is-mobile")
                ? Math.max(0, Math.round(trigger.getBoundingClientRect().width))
                : Math.max(220, (_a = args.widthPx) !== null && _a !== void 0 ? _a : 240),
            dropUp: args.dropUp,
        });
    };
    let cleanup = null;
    const close = () => {
        trigger.setAttribute("aria-expanded", "false");
        chevron.classList.remove("rotate-180");
        popover.setAttribute("aria-hidden", "true");
        popover.classList.remove("is-open");
        try {
            cleanup === null || cleanup === void 0 ? void 0 : cleanup();
        }
        catch (e) {
            log.swallow("dropdown menu cleanup", e);
        }
        cleanup = null;
        // Instead of removing popover, detach sproutWrapper from body if present
        if (sproutWrapper.parentNode === document.body) {
            document.body.removeChild(sproutWrapper);
        }
    };
    const open = () => {
        buildItems();
        trigger.setAttribute("aria-expanded", "true");
        chevron.classList.add("rotate-180");
        popover.setAttribute("aria-hidden", "false");
        popover.classList.add("is-open");
        document.body.appendChild(sproutWrapper);
        // place after attach (more reliable)
        requestAnimationFrame(() => place());
        const onResizeOrScroll = () => place();
        const onDocPointerDown = (ev) => {
            const t = ev.target;
            if (!t)
                return;
            if (root.contains(t) || popover.contains(t))
                return;
            close();
        };
        const onDocKeydown = (ev) => {
            if (ev.key !== "Escape")
                return;
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
        };
        window.addEventListener("resize", onResizeOrScroll, true);
        window.addEventListener("scroll", onResizeOrScroll, true);
        // attach outside listeners next tick (avoid self-close on opening event)
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
    // ✅ pointerdown is more robust in Obsidian panes than click
    trigger.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0)
            return;
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = trigger.getAttribute("aria-expanded") === "true";
        if (isOpen)
            close();
        else
            open();
    });
    const setValue = (v) => {
        current = v;
        trigText.textContent = labelFor(current);
    };
    // initial label
    trigText.textContent = labelFor(current);
    const dispose = () => close();
    return { root, setValue, dispose };
}
export function makeColumnsDropdown(args, ctx) {
    var _a;
    const id = `sprout-cols-${Math.random().toString(36).slice(2, 9)}`;
    const autoCloseMs = Math.max(0, Math.floor((_a = args.autoCloseMs) !== null && _a !== void 0 ? _a : 10000));
    const root = document.createElement("div");
    root.id = id;
    root.className = "relative inline-flex learnkit-overflow-visible";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `${id}-trigger`;
    trigger.className = "learnkit-btn-toolbar h-9 px-3 text-sm inline-flex items-center gap-2";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", args.label);
    trigger.setAttribute("data-tooltip-position", "top");
    root.appendChild(trigger);
    const trigIcon = document.createElement("span");
    trigIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    trigIcon.setAttribute("aria-hidden", "true");
    setIcon(trigIcon, "columns-2");
    trigger.appendChild(trigIcon);
    const trigText = document.createElement("span");
    trigText.className = "truncate";
    trigText.textContent = args.label;
    trigger.appendChild(trigText);
    // Create a single .learnkit wrapper around the popover menu
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "learnkit";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.className = "";
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay");
    const panel = document.createElement("div");
    panel.className = "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 learnkit-pointer-auto learnkit-columns-panel";
    popover.appendChild(panel);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.id = `${id}-menu`;
    menu.setAttribute("aria-label", trigger.id);
    menu.className = "flex flex-col";
    panel.appendChild(menu);
    sproutWrapper.appendChild(popover);
    const items = [];
    const setChecked = (item, checked) => {
        item.setAttribute("aria-checked", checked ? "true" : "false");
        const d = item.querySelector(".learnkit-ss-dot");
        if (d)
            d.classList.toggle("is-selected", checked);
    };
    const buildItems = () => {
        clearNode(menu);
        items.length = 0;
        for (const opt of args.options) {
            const checked = ctx.getVisibleCols().has(opt.v);
            const item = document.createElement("div");
            item.setAttribute("role", "menuitemcheckbox");
            item.setAttribute("aria-checked", checked ? "true" : "false");
            item.tabIndex = 0;
            item.className = "learnkit-cols-item";
            const dotWrap = document.createElement("div");
            dotWrap.className = "learnkit-ss-dot-wrap";
            item.appendChild(dotWrap);
            const dot = document.createElement("div");
            dot.className = "learnkit-ss-dot";
            if (checked)
                dot.classList.add("is-selected");
            dotWrap.appendChild(dot);
            const txt = document.createElement("span");
            txt.className = "learnkit-cols-item-label";
            txt.textContent = opt.label;
            item.appendChild(txt);
            const toggle = () => {
                const next = new Set(ctx.getVisibleCols());
                if (next.has(opt.v))
                    next.delete(opt.v);
                else
                    next.add(opt.v);
                if (next.size === 0)
                    return;
                ctx.setVisibleCols(next);
                setChecked(item, next.has(opt.v));
                ctx.applyColumnVisibility();
            };
            item.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                toggle();
                armAutoClose();
            });
            item.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    toggle();
                    armAutoClose();
                }
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    close();
                    trigger.focus();
                }
            });
            menu.appendChild(item);
            items.push({ v: opt.v, el: item });
        }
    };
    const place = () => {
        var _a;
        return placePopover({
            trigger, panel, popoverEl: popover,
            width: document.body.classList.contains("is-mobile")
                ? Math.max(0, Math.round(trigger.getBoundingClientRect().width))
                : Math.max(220, (_a = args.widthPx) !== null && _a !== void 0 ? _a : 260),
        });
    };
    let cleanup = null;
    let autoCloseTimer = null;
    const armAutoClose = () => {
        if (!autoCloseMs)
            return;
        if (autoCloseTimer)
            window.clearTimeout(autoCloseTimer);
        autoCloseTimer = window.setTimeout(() => close(), autoCloseMs);
    };
    const close = () => {
        trigger.setAttribute("aria-expanded", "false");
        popover.setAttribute("aria-hidden", "true");
        popover.classList.remove("is-open");
        try {
            cleanup === null || cleanup === void 0 ? void 0 : cleanup();
        }
        catch (e) {
            log.swallow("columns dropdown cleanup", e);
        }
        cleanup = null;
        if (autoCloseTimer)
            window.clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        try {
            sproutWrapper.remove();
        }
        catch (e) {
            log.swallow("remove columns dropdown wrapper", e);
        }
    };
    const open = () => {
        buildItems();
        trigger.setAttribute("aria-expanded", "true");
        popover.setAttribute("aria-hidden", "false");
        popover.classList.add("is-open");
        document.body.appendChild(sproutWrapper);
        requestAnimationFrame(() => place());
        armAutoClose();
        const onResizeOrScroll = () => place();
        const onDocPointerDown = (ev) => {
            const t = ev.target;
            if (!t)
                return;
            if (root.contains(t) || popover.contains(t))
                return;
            close();
        };
        const onDocKeydown = (ev) => {
            if (ev.key !== "Escape")
                return;
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
    trigger.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0)
            return;
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = trigger.getAttribute("aria-expanded") === "true";
        if (isOpen)
            close();
        else
            open();
    });
    const dispose = () => close();
    return { root, dispose };
}
