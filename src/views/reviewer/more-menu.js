/**
 * @file src/reviewer/more-menu.ts
 * @summary Implements the "More" dropdown menu for the reviewer, providing actions such as bury, suspend, undo, open note, and edit. Handles menu creation, positioning, toggling, keyboard/pointer interactions, and cleanup.
 *
 * @exports
 *   - closeMoreMenu — Closes the "More" popover menu and cleans up event listeners
 *   - toggleMoreMenu — Toggles the "More" popover menu open or closed with positioning logic
 *   - injectMoreMenu — Injects the "More" button and its popover menu into the current card's action row
 */
import { log } from "../../platform/core/logger";
import { placePopover, queryFirst } from "../../platform/core/ui";
import { t } from "../../platform/translations/translator";
export function closeMoreMenu(view) {
    var _a;
    view._moreOpen = false;
    if (view._moreBtnEl) {
        view._moreBtnEl.setAttribute("aria-expanded", "false");
    }
    const popover = view._moreMenuEl;
    if (popover) {
        popover.setAttribute("aria-hidden", "true");
        popover.classList.remove("is-open");
        try {
            popover.remove();
        }
        catch (e) {
            log.swallow("moreMenu popover.remove", e);
        }
    }
    const cleanup = (_a = view._moreCleanup) !== null && _a !== void 0 ? _a : null;
    if (cleanup) {
        try {
            cleanup();
        }
        catch (e) {
            log.swallow("moreMenu cleanup", e);
        }
        view._moreCleanup = null;
    }
}
export function toggleMoreMenu(view, force) {
    const next = typeof force === "boolean" ? force : !view._moreOpen;
    view._moreOpen = next;
    if (view._moreBtnEl) {
        view._moreBtnEl.setAttribute("aria-expanded", next ? "true" : "false");
    }
    const popover = view._moreMenuEl;
    if (!popover)
        return;
    if (!next) {
        closeMoreMenu(view);
        return;
    }
    const panel = queryFirst(popover, ".lk-more-panel");
    const place = () => {
        const btn = view._moreBtnEl;
        if (!btn || !panel)
            return;
        placePopover({ trigger: btn, panel, popoverEl: popover, dropUp: true });
    };
    popover.setAttribute("aria-hidden", "false");
    popover.classList.add("is-open");
    document.body.appendChild(popover);
    requestAnimationFrame(() => place());
    const onResizeOrScroll = () => place();
    const onDocPointerDown = (ev) => {
        var _a;
        const t = ev.target;
        if (!t)
            return;
        if (((_a = view._moreWrap) === null || _a === void 0 ? void 0 : _a.contains(t)) || popover.contains(t))
            return;
        closeMoreMenu(view);
    };
    const onDocKeydown = (ev) => {
        var _a, _b;
        if (ev.key !== "Escape")
            return;
        ev.preventDefault();
        ev.stopPropagation();
        closeMoreMenu(view);
        (_b = (_a = view._moreBtnEl) === null || _a === void 0 ? void 0 : _a.focus) === null || _b === void 0 ? void 0 : _b.call(_a);
    };
    window.addEventListener("resize", onResizeOrScroll, true);
    window.addEventListener("scroll", onResizeOrScroll, true);
    const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
    }, 0);
    view._moreCleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
    };
    const firstItem = popover.querySelector("[role='menuitem']");
    firstItem === null || firstItem === void 0 ? void 0 : firstItem.focus();
}
export function injectMoreMenu(view) {
    var _a, _b, _c, _d, _e;
    if (view.mode !== "session" || !view.session)
        return;
    const tx = (token, fallback, vars) => { var _a, _b; return t((_b = (_a = view.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars); };
    const card = view.currentCard();
    if (!card)
        return;
    const id = String(card.id);
    const graded = !!view.session.graded[id];
    const root = view.contentEl;
    root
        .querySelectorAll([
        'button[data-learnkit-action="undo-grade"]',
        'button[data-learnkit-action="bury-card"]',
        'button[data-learnkit-action="suspend-card"]',
        'button[data-learnkit-action="open-note"]',
        'button[data-learnkit-action="edit-card"]',
        '[data-learnkit-action="more-wrap"]',
        '[data-learnkit-popover-id*="more-"]',
        'button[data-learnkit-action="more-toggle"]',
    ].join(","))
        .forEach((n) => n.remove());
    const flash = (_a = queryFirst(root, ".learnkit-flashcard")) !== null && _a !== void 0 ? _a : root;
    const rows = Array.from(flash.querySelectorAll(".learnkit-row"));
    if (!rows.length)
        return;
    const rowHasBtn = (row, label) => {
        const btnLefts = Array.from(row.querySelectorAll(".learnkit-btn-left"));
        return btnLefts.some((x) => (x.textContent || "").trim().toLowerCase() === label.toLowerCase());
    };
    const rowHasAnyBtn = (row, labels) => labels.some((l) => rowHasBtn(row, l));
    const gradeLabels = ["Again", "Hard", "Good", "Easy"];
    const gradeRow = (_b = rows.find((r) => rowHasAnyBtn(r, gradeLabels))) !== null && _b !== void 0 ? _b : null;
    const revealRow = (_c = rows.find((r) => rowHasBtn(r, "Reveal"))) !== null && _c !== void 0 ? _c : null;
    const targetRow = (_d = gradeRow !== null && gradeRow !== void 0 ? gradeRow : revealRow) !== null && _d !== void 0 ? _d : rows[rows.length - 1];
    if (!targetRow)
        return;
    const disp = getComputedStyle(targetRow).display;
    if (disp !== "flex") {
        targetRow.classList.add("flex", "items-center");
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
    wrap.className = "learnkit relative inline-flex overflow-visible";
    wrap.dataset.sproutAction = "more-wrap";
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.id = triggerId;
    moreBtn.className = "learnkit-btn-toolbar learnkit-btn-filter";
    moreBtn.dataset.sproutAction = "reviewer-more-trigger";
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.setAttribute("aria-controls", menuId);
    moreBtn.setAttribute("aria-expanded", "false");
    moreBtn.setAttribute("popovertarget", popoverId);
    moreBtn.setAttribute("title", tx("ui.reviewer.more.tooltip", "More actions"));
    moreBtn.setAttribute("aria-label", tx("ui.reviewer.more.tooltip", "More actions"));
    moreBtn.textContent = tx("ui.reviewer.more.label", "More");
    const kbd = document.createElement("kbd");
    kbd.className = "kbd ml-2";
    kbd.textContent = "M";
    moreBtn.appendChild(kbd);
    moreBtn.addEventListener("pointerdown", (e) => {
        if (e.button !== 0)
            return;
        e.preventDefault();
        e.stopPropagation();
        toggleMoreMenu(view);
    });
    moreBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            toggleMoreMenu(view);
        }
    });
    // Create the popover and append to document.body for global positioning
    const popover = document.createElement("div");
    popover.id = popoverId;
    popover.className = "learnkit";
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay");
    document.body.appendChild(popover);
    const panel = document.createElement("div");
    panel.className =
        "lk-more-panel rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto";
    popover.appendChild(panel);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.id = menuId;
    menu.className = "flex flex-col";
    panel.appendChild(menu);
    const createMenuItem = (label, hotkey, onClick, disabled) => {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitem");
        item.tabIndex = disabled ? -1 : 0;
        item.className = disabled
            ? "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm select-none opacity-50 cursor-not-allowed pointer-events-none"
            : "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
        const label_span = document.createElement("span");
        label_span.className = "";
        label_span.textContent = label;
        item.appendChild(label_span);
        const spacer = document.createElement("kbd");
        spacer.className = "kbd ml-auto text-xs text-muted-foreground tracking-widest";
        spacer.textContent = hotkey;
        item.appendChild(spacer);
        if (!disabled) {
            item.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeMoreMenu(view);
                onClick();
            });
            item.addEventListener("keydown", (e) => {
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
    const undoStack = view._undoStack;
    const undoFrame = (undoStack === null || undoStack === void 0 ? void 0 : undoStack.length) ? undoStack[undoStack.length - 1] : null;
    const canUndoNow = typeof view.canUndo === "function" ? view.canUndo() : false;
    const showUndoHere = !!canUndoNow && !!undoFrame && String((_e = undoFrame.id) !== null && _e !== void 0 ? _e : "") !== String(id);
    const buryItem = createMenuItem(tx("ui.reviewer.more.bury", "Bury"), "B", () => void view.buryCurrentCard(), graded);
    buryItem.dataset.sproutAction = "bury-card";
    menu.appendChild(buryItem);
    const suspendItem = createMenuItem(tx("ui.reviewer.more.suspend", "Suspend"), "S", () => void view.suspendCurrentCard(), graded);
    suspendItem.dataset.sproutAction = "suspend-card";
    menu.appendChild(suspendItem);
    if (showUndoHere) {
        const sep = document.createElement("hr");
        sep.setAttribute("role", "separator");
        sep.className = "h-px bg-border my-2";
        menu.appendChild(sep);
        const undoItem = createMenuItem(tx("ui.reviewer.more.undo", "Undo"), "U", () => {
            var _a;
            void ((_a = view.undoLastGrade) === null || _a === void 0 ? void 0 : _a.call(view));
        });
        undoItem.dataset.sproutAction = "undo-grade";
        menu.appendChild(undoItem);
    }
    const openItem = createMenuItem(tx("ui.reviewer.more.openInNote", "Open in Note"), "O", () => void view.openCurrentCardInNote());
    openItem.dataset.sproutAction = "open-note";
    menu.appendChild(openItem);
    const editItem = createMenuItem(tx("ui.reviewer.more.edit", "Edit"), "E", () => view.openEditModalForCurrentCard());
    editItem.dataset.sproutAction = "edit-card";
    menu.appendChild(editItem);
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    wrap.appendChild(moreBtn);
    // Do NOT append popover to wrap/card; it's now in document.body
    targetRow.appendChild(wrap);
    for (const r of rows) {
        const hasButtons = queryFirst(r, "button") != null;
        const hasMeaningfulContent = (r.textContent || "").trim().length > 0;
        if (!hasButtons && !hasMeaningfulContent)
            r.remove();
    }
    view._moreWrap = wrap;
    view._moreMenuEl = popover;
    view._moreBtnEl = moreBtn;
}
