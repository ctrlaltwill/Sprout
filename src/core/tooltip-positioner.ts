/**
 * Tooltip Positioner
 *
 * Tooltips are primarily positioned with CSS (pseudo-elements).
 *
 * However, header tooltips can be long and would otherwise overflow outside the
 * current workspace leaf when the trigger is near an edge (e.g. split panes).
 *
 * This module adds a small runtime clamp for header tooltips only:
 * - Keeps tooltips inside Sprout workspace leaf-content bounds
 *   (`.workspace-leaf-content.sprout.theme-dark` preferred).
 * - Enforces a 60px horizontal safety margin.
 *
 * Implementation detail:
 * - We measure tooltip text using an offscreen element that matches tooltip CSS.
 * - We then set CSS variables on the target element that shift the tooltip
 *   pseudo-element horizontally (`--sprout-tooltip-shift-x`) and cap its
 *   effective max width (`--sprout-tooltip-max-width`).
 */

export function initTooltipPositioner(): void {
  if (typeof document === "undefined") return;
  if (typeof window === "undefined") return;

  const WORKSPACE_DARK_SPROUT_SELECTOR = ".workspace-leaf-content.sprout.theme-dark";
  const WORKSPACE_SPROUT_SELECTOR = ".workspace-leaf-content.sprout";
  const WORKSPACE_SELECTOR = ".workspace-leaf-content";
  const TOOLTIP_SELECTOR = "[data-tooltip]";
  const MARGIN_PX = 60;
  const GAP_PX = 6;
  const FADE_OUT_CLEAR_DELAY_MS = 220;

  let measureEl: HTMLDivElement | null = null;
  let activeTarget: HTMLElement | null = null;
  const clearTimers = new WeakMap<HTMLElement, number>();

  const getMeasureEl = (): HTMLDivElement => {
    if (measureEl && measureEl.isConnected) return measureEl;
    const el = document.createElement("div");
    el.className = "sprout-tooltip-measure";
    document.body.appendChild(el);
    measureEl = el;
    return el;
  };

  const clearVars = (el: HTMLElement) => {
    el.style.removeProperty("--sprout-tooltip-shift-x");
    el.style.removeProperty("--sprout-tooltip-max-width");
  };

  const cancelScheduledClear = (el: HTMLElement) => {
    const tid = clearTimers.get(el);
    if (typeof tid === "number") window.clearTimeout(tid);
    clearTimers.delete(el);
  };

  const restoreOriginalPosition = (el: HTMLElement) => {
    const orig = el.dataset.sproutTooltipOrigPos;
    if (orig === undefined) return;

    // Restore original value (or remove attribute if it was missing)
    if (orig === "") el.removeAttribute("data-tooltip-position");
    else el.setAttribute("data-tooltip-position", orig);

    delete el.dataset.sproutTooltipOrigPos;
  };

  const setEffectivePosition = (el: HTMLElement, pos: string) => {
    // Capture the original position only once per hover/focus lifecycle
    if (el.dataset.sproutTooltipOrigPos === undefined) {
      el.dataset.sproutTooltipOrigPos = el.getAttribute("data-tooltip-position") ?? "";
    }
    el.setAttribute("data-tooltip-position", pos);
  };

  const scheduleClear = (el: HTMLElement) => {
    cancelScheduledClear(el);
    const tid = window.setTimeout(() => {
      clearVars(el);
      restoreOriginalPosition(el);
      clearTimers.delete(el);
    }, FADE_OUT_CLEAR_DELAY_MS);
    clearTimers.set(el, tid);
  };

  const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

  const update = (el: HTMLElement) => {
    cancelScheduledClear(el);

    const tooltip = (el.getAttribute("data-tooltip") ?? "").trim();
    if (!tooltip) {
      clearVars(el);
      restoreOriginalPosition(el);
      return;
    }

    const boundsEl =
      el.closest(WORKSPACE_DARK_SPROUT_SELECTOR)
      ?? el.closest(WORKSPACE_SPROUT_SELECTOR)
      ?? el.closest(WORKSPACE_SELECTOR);
    const boundsRect = (boundsEl ?? document.documentElement).getBoundingClientRect();
    const boundsWidth = boundsRect.width;
    if (!Number.isFinite(boundsWidth) || boundsWidth <= 0) {
      clearVars(el);
      restoreOriginalPosition(el);
      return;
    }

    const maxWidthAllowed = Math.max(0, boundsWidth - MARGIN_PX * 2);
    // If we have no space to work with, don't try to position.
    if (maxWidthAllowed <= 0) {
      clearVars(el);
      restoreOriginalPosition(el);
      return;
    }

    const capPx = Math.min(300, maxWidthAllowed);
    el.style.setProperty("--sprout-tooltip-max-width", `${capPx}px`);

    // Measure tooltip size at the capped width.
    const measurer = getMeasureEl();
    measurer.textContent = tooltip;
    measurer.style.maxWidth = `${capPx}px`;
    measurer.style.minWidth = `${Math.min(160, capPx)}px`;
    const tooltipRect = measurer.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width;
    if (!Number.isFinite(tooltipWidth) || tooltipWidth <= 0) {
      clearVars(el);
      restoreOriginalPosition(el);
      return;
    }

    const triggerRect = el.getBoundingClientRect();
    const centerX = triggerRect.left + triggerRect.width / 2;
    const minX = boundsRect.left + MARGIN_PX;
    const maxX = boundsRect.right - MARGIN_PX;

    const requestedPos = (el.getAttribute("data-tooltip-position") ?? "bottom").toLowerCase();

    // If a left/right tooltip would violate the horizontal margin, force it to bottom.
    let effectivePos = requestedPos;
    if (requestedPos === "right") {
      const tooltipLeft = triggerRect.right + GAP_PX;
      const tooltipRight = tooltipLeft + tooltipWidth;
      if (tooltipRight > maxX) effectivePos = "bottom";
    } else if (requestedPos === "left") {
      const tooltipRight = triggerRect.left - GAP_PX;
      const tooltipLeft = tooltipRight - tooltipWidth;
      if (tooltipLeft < minX) effectivePos = "bottom";
    }

    // Apply effective position (temporarily), while preserving the original for restore.
    // We only override when needed or when we need stable measurements/clamping.
    if (effectivePos !== requestedPos) setEffectivePosition(el, effectivePos);

    // Horizontal clamp for top/bottom tooltips (including forced-bottom from left/right).
    if (effectivePos === "bottom" || effectivePos === "top") {
      const defaultLeft = centerX - tooltipWidth / 2;
      const minLeft = boundsRect.left + MARGIN_PX;
      const maxLeft = boundsRect.right - MARGIN_PX - tooltipWidth;

      const clampedLeft = maxLeft < minLeft ? minLeft : clamp(defaultLeft, minLeft, maxLeft);
      const shiftX = clampedLeft - defaultLeft;
      el.style.setProperty("--sprout-tooltip-shift-x", `${Math.round(shiftX)}px`);
    } else {
      // Left/right tooltips: ensure we don't carry over a stale X shift.
      el.style.removeProperty("--sprout-tooltip-shift-x");
    }
  };

  const setActive = (el: HTMLElement | null) => {
    if (activeTarget && activeTarget !== el) scheduleClear(activeTarget);
    activeTarget = el;
    if (activeTarget) update(activeTarget);
  };

  const findTooltipTarget = (start: EventTarget | null): HTMLElement | null => {
    const node = start instanceof Element ? start : null;
    if (!node) return null;
    const el = node.closest(TOOLTIP_SELECTOR);
    return el instanceof HTMLElement ? el : null;
  };

  const onPointerOver = (ev: PointerEvent) => {
    const el = findTooltipTarget(ev.target);
    if (!el) return;
    setActive(el);
  };

  const onPointerOut = (ev: PointerEvent) => {
    const leavingCandidate = ev.target instanceof Element ? ev.target.closest(TOOLTIP_SELECTOR) : null;
    const leaving = leavingCandidate instanceof HTMLElement ? leavingCandidate : null;
    if (!leaving) return;

    const next = ev.relatedTarget instanceof Node ? ev.relatedTarget : null;
    if (next && leaving.contains(next)) return;

    // If this is the currently active tooltip, clear it after fade-out.
    if (activeTarget && leaving === activeTarget) {
      activeTarget = null;
    }

    scheduleClear(leaving);
  };

  const onFocusIn = (ev: FocusEvent) => {
    const el = findTooltipTarget(ev.target);
    if (!el) return;
    setActive(el);
  };

  const onFocusOut = (ev: FocusEvent) => {
    const leavingCandidate = ev.target instanceof Element ? ev.target.closest(TOOLTIP_SELECTOR) : null;
    const leaving = leavingCandidate instanceof HTMLElement ? leavingCandidate : null;
    if (!leaving) return;
    const next = ev.relatedTarget instanceof Node ? ev.relatedTarget : null;
    if (next && leaving.contains(next)) return;

    if (activeTarget && leaving === activeTarget) {
      activeTarget = null;
    }
    scheduleClear(leaving);
  };

  const onScrollOrResize = () => {
    if (!activeTarget) return;
    update(activeTarget);
  };

  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("pointerout", onPointerOut, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize, true);
}
