/**
 * @file src/core/popover.ts
 * @summary Shared body-portal popover lifecycle.
 *
 * Consolidates the open/close/position/cleanup pattern used by
 * header.ts (×2 popovers) and sprout-settings-tab.ts (×2 popovers).
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

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

export interface BodyPortalPopoverOpts {
  /** The button / element that opens the popover. */
  trigger: HTMLElement;

  /**
   * Called once per open to build the popover content.
   * Receives the inner panel element and a `close` callback.
   */
  buildContent: (panel: HTMLElement, close: () => void) => void;

  /** Horizontal alignment relative to the trigger (default `"right"`). */
  align?: "left" | "right";

  /**
   * Explicit popover width in px, or a function that returns one.
   * Falls back to `placePopover`'s default (max of panel/trigger width).
   */
  width?: number | ((trigger: HTMLElement) => number);

  /** Gap between trigger and popover edge in px (default `4`). */
  gap?: number;

  /** Whether to set `--sprout-popover-width` on the overlay (default `true`). */
  setWidth?: boolean;

  /** Extra CSS classes on the overlay root (e.g. `"sprout-ss-popover"`). */
  overlayClasses?: string[];

  /** Extra CSS classes on the inner panel (e.g. `"sprout-ss-panel"`). */
  panelClasses?: string[];

  /**
   * Observe `window.visualViewport` resize and `document.body` mutations
   * for repositioning.  Useful for the top-level header but not needed for
   * settings selects.  Default `false`.
   */
  observeViewport?: boolean;

  /**
   * Register a document-level `keydown` listener for Escape to close.
   * Default `true`.
   */
  escapeKey?: boolean;

  /** Set `aria-hidden` on the popover element. Default `true`. */
  ariaHidden?: boolean;

  /** Called after positioning, for focus management. */
  onOpened?: (panel: HTMLElement) => void;

  /** Called after close, for focus restoration or state cleanup. */
  onClosed?: () => void;
}

export interface BodyPortalPopoverHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Create a body-portal popover attached to a trigger element.
 *
 * The popover follows an 8-step lifecycle:
 *   1. Close any existing instance (idempotent).
 *   2. Create DOM: `.sprout` wrapper → overlay root → inner panel.
 *   3. Build content into the panel.
 *   4. Append wrapper to `document.body`.
 *   5. Mark open state (classes + ARIA).
 *   6. Position via `placePopover()` in a `requestAnimationFrame`.
 *   7. Register dismiss listeners (resize, scroll, outside click, Escape).
 *   8. On close: remove listeners, remove DOM, restore ARIA.
 */
export function createBodyPortalPopover(
  opts: BodyPortalPopoverOpts,
): BodyPortalPopoverHandle {
  const {
    trigger,
    buildContent,
    align = "right",
    gap = 4,
    setWidth = true,
    overlayClasses = [],
    panelClasses = [],
    observeViewport = false,
    escapeKey = true,
    ariaHidden = true,
  } = opts;

  let sproutWrapper: HTMLDivElement | null = null;
  let cleanup: (() => void) | null = null;

  // ── Close ──

  const close = () => {
    trigger.setAttribute("aria-expanded", "false");

    if (sproutWrapper) {
      const overlay = sproutWrapper.querySelector<HTMLElement>(".sprout-popover-overlay");
      if (overlay) {
        overlay.classList.remove("is-open");
        if (ariaHidden) overlay.setAttribute("aria-hidden", "true");
      }
    }

    cleanup?.();
    cleanup = null;

    if (sproutWrapper?.parentNode === document.body) {
      document.body.removeChild(sproutWrapper);
    }
    sproutWrapper = null;

    opts.onClosed?.();
  };

  // ── Open ──

  const open = () => {
    // Step 1: close existing
    close();

    // Step 2: create DOM
    sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";

    const overlay = document.createElement("div");
    overlay.classList.add("sprout-popover-overlay", ...overlayClasses);
    if (ariaHidden) overlay.setAttribute("aria-hidden", "true");
    sproutWrapper.appendChild(overlay);

    const panel = document.createElement("div");
    if (panelClasses.length) panel.classList.add(...panelClasses);
    overlay.appendChild(panel);

    // Step 3: build content
    buildContent(panel, close);

    // Step 4: body-portal
    document.body.appendChild(sproutWrapper);

    // Step 5: mark open
    overlay.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    if (ariaHidden) overlay.setAttribute("aria-hidden", "false");

    // Step 6: position
    const place = () => {
      const w =
        typeof opts.width === "function"
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
      place();
      opts.onOpened?.(panel);
    });

    // Step 7: dismiss listeners
    const onResizeOrScroll = () => place();

    window.addEventListener("resize", onResizeOrScroll, true);
    window.addEventListener("scroll", onResizeOrScroll, true);

    let bodyObserver: MutationObserver | null = null;
    if (observeViewport) {
      window.visualViewport?.addEventListener("resize", onResizeOrScroll);
      bodyObserver = new MutationObserver(() =>
        requestAnimationFrame(() => place()),
      );
      bodyObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (overlay.contains(t) || trigger.contains(t)) return;
      close();
    };

    const onDocKeydown = escapeKey
      ? (ev: KeyboardEvent) => {
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
      window.clearTimeout(tid);
      window.removeEventListener("resize", onResizeOrScroll, true);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      if (observeViewport) {
        window.visualViewport?.removeEventListener("resize", onResizeOrScroll);
        bodyObserver?.disconnect();
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
      if (sproutWrapper) close();
      else open();
    },
    isOpen() {
      return sproutWrapper !== null;
    },
  };
}
