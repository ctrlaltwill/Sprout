/**
 * @file src/core/popover.ts
 * @summary Shared body-portal popover lifecycle.
 *
 * Consolidates the open/close/position/cleanup pattern used by
 * header.ts (×2 popovers) and settings-tab.ts (×2 popovers).
 *
 * Usage:
 * ```ts
 * const pop = createBodyPortalPopover({
 *   trigger: myButton,
 *   buildContent(panel, close) { panel.createDiv({ text: "Hello" }); },
 * });
 * myButton.addEventListener("click", () => pop.toggle());
 * ```
 *
 * @exports createBodyPortalPopover
 */
import { placePopover } from "./ui";
/**
 * Create a body-portal popover attached to a trigger element.
 *
 * The popover follows an 8-step lifecycle:
 *   1. Close any existing instance (idempotent).
 *   2. Create DOM: `.learnkit` wrapper → overlay root → inner panel.
 *   3. Build content into the panel.
 *   4. Append wrapper to `document.body`.
 *   5. Mark open state (classes + ARIA).
 *   6. Position via `placePopover()` in a `requestAnimationFrame`.
 *   7. Register dismiss listeners (resize, scroll, outside click, Escape).
 *   8. On close: remove listeners, remove DOM, restore ARIA.
 */
export function createBodyPortalPopover(opts) {
    const { trigger, buildContent, align = "right", gap = 4, setWidth = true, overlayClasses = [], panelClasses = [], observeViewport = false, escapeKey = true, ariaHidden = true, } = opts;
    let sproutWrapper = null;
    let cleanup = null;
    // ── Close ──
    const close = () => {
        var _a;
        trigger.setAttribute("aria-expanded", "false");
        if (sproutWrapper) {
            const overlay = sproutWrapper.querySelector(".learnkit-popover-overlay");
            if (overlay) {
                overlay.classList.remove("is-open");
                if (ariaHidden)
                    overlay.setAttribute("aria-hidden", "true");
            }
        }
        cleanup === null || cleanup === void 0 ? void 0 : cleanup();
        cleanup = null;
        if ((sproutWrapper === null || sproutWrapper === void 0 ? void 0 : sproutWrapper.parentNode) === document.body) {
            document.body.removeChild(sproutWrapper);
        }
        sproutWrapper = null;
        (_a = opts.onClosed) === null || _a === void 0 ? void 0 : _a.call(opts);
    };
    // ── Open ──
    const open = () => {
        var _a;
        // Step 1: close existing
        close();
        // Step 2: create DOM
        sproutWrapper = document.createElement("div");
        sproutWrapper.className = "learnkit";
        const overlay = document.createElement("div");
        overlay.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay", ...overlayClasses);
        if (ariaHidden)
            overlay.setAttribute("aria-hidden", "true");
        sproutWrapper.appendChild(overlay);
        const panel = document.createElement("div");
        if (panelClasses.length)
            panel.classList.add(...panelClasses);
        overlay.appendChild(panel);
        // Step 3: build content
        buildContent(panel, close);
        // Step 4: body-portal
        document.body.appendChild(sproutWrapper);
        // Step 5: mark open
        overlay.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        if (ariaHidden)
            overlay.setAttribute("aria-hidden", "false");
        // Step 6: position
        const place = () => {
            const w = typeof opts.width === "function"
                ? opts.width(trigger)
                : opts.width;
            placePopover({
                trigger,
                panel,
                popoverEl: overlay,
                width: w,
                gap,
                setWidth,
                align,
            });
        };
        requestAnimationFrame(() => {
            var _a;
            place();
            (_a = opts.onOpened) === null || _a === void 0 ? void 0 : _a.call(opts, panel);
        });
        // Step 7: dismiss listeners
        const onResizeOrScroll = () => place();
        window.addEventListener("resize", onResizeOrScroll, true);
        window.addEventListener("scroll", onResizeOrScroll, true);
        let bodyObserver = null;
        if (observeViewport) {
            (_a = window.visualViewport) === null || _a === void 0 ? void 0 : _a.addEventListener("resize", onResizeOrScroll);
            bodyObserver = new MutationObserver(() => requestAnimationFrame(() => place()));
            bodyObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ["class", "style"],
            });
        }
        const onDocPointerDown = (ev) => {
            const t = ev.target;
            if (!t)
                return;
            if (overlay.contains(t) || trigger.contains(t))
                return;
            close();
        };
        const onDocKeydown = escapeKey
            ? (ev) => {
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    close();
                }
            }
            : null;
        // Defer outside-click so the opening click doesn't immediately close.
        const tid = window.setTimeout(() => {
            document.addEventListener("pointerdown", onDocPointerDown, true);
            if (onDocKeydown) {
                document.addEventListener("keydown", onDocKeydown, true);
            }
        }, 0);
        // Step 8: cleanup closure
        cleanup = () => {
            var _a;
            window.clearTimeout(tid);
            window.removeEventListener("resize", onResizeOrScroll, true);
            window.removeEventListener("scroll", onResizeOrScroll, true);
            if (observeViewport) {
                (_a = window.visualViewport) === null || _a === void 0 ? void 0 : _a.removeEventListener("resize", onResizeOrScroll);
                bodyObserver === null || bodyObserver === void 0 ? void 0 : bodyObserver.disconnect();
            }
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            if (onDocKeydown) {
                document.removeEventListener("keydown", onDocKeydown, true);
            }
        };
    };
    // ── Public handle ──
    return {
        open,
        close,
        toggle() {
            if (sproutWrapper)
                close();
            else
                open();
        },
        isOpen() {
            return sproutWrapper !== null;
        },
    };
}
