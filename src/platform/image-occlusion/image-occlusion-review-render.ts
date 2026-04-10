/**
 * @file src/imageocclusion/image-occlusion-review-render.ts
 * @summary Renders the Image Occlusion review overlay shown during study sessions and in the home widget. Produces a masked image with coloured occlusion rectangles, handles reveal state, supports zoom-in modals for both the review session and widget contexts, and manages overlay sizing synchronisation with the underlying image element.
 *
 * @exports
 *   - isIoParentCard — checks whether a CardRecord is an IO parent card
 *   - isIoRevealableType — checks whether a CardRecord is an IO or IO-child card eligible for reveal
 *   - renderImageOcclusionReviewInto — renders the masked IO image into a container element
 */

import { type App, Modal, setIcon } from "obsidian";
import type LearnKitPlugin from "../../main";
import type { CardRecord } from "../../platform/types/card";
import type { StoredIORect } from "./image-occlusion-types";
import { resolveImageFile } from "./io-helpers";
import type * as IoModule from "./image-occlusion-index";
import { queryFirst, setCssProps } from "../../platform/core/ui";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import { t } from "../../platform/translations/translator";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function installSmoothZoomInteractions(host: HTMLElement, zoomLayer: HTMLElement) {
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let isDragging = false;
  let pointerId: number | null = null;
  let startClientX = 0;
  let startClientY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  const minScale = 1;
  const absoluteMaxScale = 4;
  let movedSincePointerDown = false;

  const applyTransform = () => {
    const baseWidth = Math.max(1, zoomLayer.offsetWidth);
    const baseHeight = Math.max(1, zoomLayer.offsetHeight);
    const maxViewportWidth = window.innerWidth * 0.95;
    const maxViewportHeight = window.innerHeight * 0.95;
    const maxScaleByViewport = Math.max(
      1,
      Math.min(maxViewportWidth / baseWidth, maxViewportHeight / baseHeight),
    );
    const maxScale = Math.min(absoluteMaxScale, maxScaleByViewport);

    scale = clampNumber(scale, minScale, maxScale);

    if (scale <= 1) {
      offsetX = 0;
      offsetY = 0;
    } else {
      const maxX = Math.max(0, (baseWidth * scale - host.clientWidth) / 2);
      const maxY = Math.max(0, (baseHeight * scale - host.clientHeight) / 2);
      offsetX = clampNumber(offsetX, -maxX, maxX);
      offsetY = clampNumber(offsetY, -maxY, maxY);
    }

    setCssProps(zoomLayer, "--learnkit-zoom-scale", String(scale));
    setCssProps(zoomLayer, "--learnkit-zoom-x", `${offsetX}px`);
    setCssProps(zoomLayer, "--learnkit-zoom-y", `${offsetY}px`);
    host.classList.toggle("is-zoomed", scale > 1);
  };

  host.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const next = Math.max(minScale, scale * factor);
      if (next === scale) return;
      scale = next;
      applyTransform();
    },
    { passive: false },
  );

  zoomLayer.addEventListener("click", (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest(".learnkit-zoom-close")) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (movedSincePointerDown) return;
    const prev = scale;
    const next = scale * 1.5;
    // Apply clamping in applyTransform (includes 95vw/95vh cap).
    scale = next <= 1.001 ? 1.5 : next;
    applyTransform();
    if (scale <= prev + 0.001) {
      // Already at cap -> reset to default on subsequent click.
      scale = 1;
      applyTransform();
    }
  });

  host.addEventListener("pointerdown", (ev: PointerEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest(".learnkit-zoom-close")) return;
    if (ev.button !== 0 || scale <= 1) return;
    movedSincePointerDown = false;
    isDragging = true;
    pointerId = ev.pointerId;
    startClientX = ev.clientX;
    startClientY = ev.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    host.classList.add("is-dragging");
    host.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  host.addEventListener("pointermove", (ev: PointerEvent) => {
    if (!isDragging || pointerId !== ev.pointerId) return;
    movedSincePointerDown = true;
    offsetX = startOffsetX + (ev.clientX - startClientX);
    offsetY = startOffsetY + (ev.clientY - startClientY);
    applyTransform();
    ev.preventDefault();
  });

  const endDrag = (ev: PointerEvent) => {
    if (!isDragging || pointerId !== ev.pointerId) return;
    isDragging = false;
    pointerId = null;
    host.classList.remove("is-dragging");
    if (host.hasPointerCapture(ev.pointerId)) {
      host.releasePointerCapture(ev.pointerId);
    }
  };

  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);

  applyTransform();
}

export function isIoParentCard(card: CardRecord): boolean {
  return card && card.type === "io";
}

export function isIoRevealableType(card: CardRecord): boolean {
  return card && (card.type === "io" || card.type === "io-child");
}

export function renderImageOcclusionReviewInto(args: {
  app: App;
  plugin: LearnKitPlugin;
  containerEl: HTMLElement;
  card: CardRecord;
  sourcePath: string;
  reveal: boolean;
  ioModule: typeof IoModule;
  renderMarkdownInto: (el: HTMLElement, md: string, sp: string) => Promise<void>;
  enableWidgetModal?: boolean;
}) {
  const { app, plugin, containerEl, card, sourcePath, reveal, ioModule } = args;
  const widgetMode = containerEl?.dataset?.sproutIoWidget === "1";
  const enableWidgetModal = args.enableWidgetModal !== false;

  // Clear container
  containerEl.replaceChildren();
  containerEl.classList.add("learnkit-io-container", "learnkit-io-container");
  if (widgetMode) {
    containerEl.classList.add("learnkit-io-container--clip", "learnkit-io-container--clip");
  }

  // Get image reference
  const imageRef = String(card.imageRef || "").trim();
  if (!imageRef) {
    const msg = document.createElement("div");
    msg.className = "text-muted-foreground text-sm";
    msg.textContent = "Image occlusion card missing image reference.";
    containerEl.appendChild(msg);
    return;
  }

  // Resolve image file
  const imageFile = resolveImageFile(app, sourcePath, imageRef);
  if (!imageFile) {
    const msg = document.createElement("div");
    msg.className = "text-muted-foreground text-sm";
    msg.textContent = `Image not found: ${imageRef}`;
    containerEl.appendChild(msg);
    return;
  }

  const imageSrc = app.vault.getResourcePath(imageFile);

  // Load IO definition from store
  let occlusions: StoredIORect[] = [];
  const ioMap = plugin.store.data.io || {};
  const parentId = card.type === "io-child" ? String(card.parentId || "") : String(card.id || "");
  const ioDef = parentId ? ioMap[parentId] : null;

  if (ioDef && Array.isArray(ioDef.rects)) {
    occlusions = ioDef.rects;
  } else if (Array.isArray((card as unknown as Record<string, unknown>).occlusions)) {
    occlusions = (card as unknown as Record<string, unknown>).occlusions as StoredIORect[];
  } else if (Array.isArray((card as unknown as Record<string, unknown>).rects)) {
    occlusions = (card as unknown as Record<string, unknown>).rects as StoredIORect[];
  }

  // For io-child cards, filter to only show the relevant masks
  let masksToShow = occlusions;
  if (card.type === "io-child") {
    const groupKey = String(card.groupKey || "");
    const rectIds = Array.isArray(card.rectIds) ? card.rectIds : [];
    
    if (rectIds.length > 0) {
      // Filter by rectIds
      masksToShow = occlusions.filter((r) => rectIds.includes(String(r.rectId || "")));
    } else if (groupKey) {
      // Filter by groupKey
      masksToShow = occlusions.filter((r) => String(r.groupKey || "") === groupKey);
    }
  }

  const host = widgetMode ? containerEl : document.createElement("div");
  if (!widgetMode) {
    host.className = "learnkit-io-host-card";
  }

  const img = document.createElement("img");
  img.src = imageSrc;
  img.alt = card.title || "Card image";
  img.classList.add("learnkit-io-image", "learnkit-io-image");
  // Modal mode: larger image, zoom-out cursor, fit modal
  if (args.enableWidgetModal) {
    img.classList.add("learnkit-io-image-zoomed", "learnkit-io-image-zoomed");
  } else {
    img.classList.add("learnkit-io-image-inline", "learnkit-io-image-inline");
  }
  if (widgetMode) {
    img.classList.add("learnkit-io-image-widget", "learnkit-io-image-widget");
  }
  host.appendChild(img);

  // Add masks if not revealed
  const openZoomModal = () => {
    const modal = new (class extends Modal {
      onOpen() {
        scopeModalToWorkspace(this);
        this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "learnkit");
        this.modalEl.addClass("lk-modals", "learnkit-zoom-overlay");
        queryFirst(this.modalEl, ".modal-header")?.remove();
        queryFirst(this.modalEl, ".modal-close-button")?.remove();

        // Clicking overlay chrome (outside content/image) should close.
        this.modalEl.addEventListener("click", (ev) => {
          if (ev.target !== this.modalEl) return;
          this.close();
        });

        // Backdrop click should dismiss zoom modal.
        const modalBg = queryFirst(this.containerEl, ".modal-bg");
        if (modalBg) {
          modalBg.addEventListener("click", () => this.close(), { once: true });
        }

        this.contentEl.empty();
        this.contentEl.classList.add("learnkit-zoom-content", "learnkit-zoom-content");
        this.contentEl.addEventListener("click", (ev) => {
          if (ev.target !== this.contentEl) return;
          this.close();
        });

        const zoomHost = this.contentEl.createDiv({ cls: "learnkit-zoom-host learnkit-zoom-host" });
        const zoomCanvas = zoomHost.createDiv({ cls: "learnkit-zoom-canvas learnkit-zoom-canvas" });
        const zoomSurface = zoomCanvas.createDiv({ cls: "learnkit-zoom-surface learnkit-zoom-surface" });
        zoomSurface.dataset.sproutIoWidget = "1";

        const closeIfOutsideSurface = (ev: MouseEvent) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target.closest(".learnkit-zoom-surface")) return;
          if (target.closest(".learnkit-zoom-close")) return;
          this.close();
        };
        zoomHost.addEventListener("click", closeIfOutsideSurface);
        zoomCanvas.addEventListener("click", closeIfOutsideSurface);

        renderImageOcclusionReviewInto({
          app,
          plugin,
          containerEl: zoomSurface,
          card,
          sourcePath,
          reveal,
          ioModule,
          renderMarkdownInto: args.renderMarkdownInto,
          enableWidgetModal: false,
        });

        const zoomImg = queryFirst(zoomSurface, "img");
        if (zoomImg instanceof HTMLImageElement) {
          zoomImg.classList.add("learnkit-zoom-img", "learnkit-zoom-img", "learnkit-io-image-zoomed", "learnkit-io-image-zoomed");
          installSmoothZoomInteractions(zoomHost, zoomSurface);
        }

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", t(plugin.settings?.general?.interfaceLanguage, "ui.common.close", "Close"));
        closeBtn.setAttribute("data-learnkit-expand-collapse", "true");
        closeBtn.classList.add("learnkit-btn-toolbar", "learnkit-btn-toolbar",
          "learnkit-btn-filter", "learnkit-btn-filter",
          "h-7",
          "px-3",
          "text-sm",
          "inline-flex",
          "items-center",
          "gap-2",
          "learnkit-zoom-close", "learnkit-zoom-close",
        );

        const closeIcon = document.createElement("span");
        closeIcon.className = "inline-flex items-center justify-center";
        setIcon(closeIcon, "x");
        closeBtn.appendChild(closeIcon);

        closeBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        });
        zoomSurface.appendChild(closeBtn);
      }

      onClose() {
        this.contentEl.empty();
        this.modalEl.removeClass("lk-modals", "learnkit-zoom-overlay");
        this.containerEl.removeClass("lk-modal-container", "lk-modal-dim", "learnkit");
      }
    })(app);

    modal.open();
  };

  // Add zoom modal for RenderSession (not widgetMode)
  if (!widgetMode) {
    img.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openZoomModal();
    });
  }
  const maskMode = ioDef && typeof ioDef.maskMode === "string" ? String(ioDef.maskMode) : "";
  const showAllMasks = maskMode === "all";
  const revealMode = plugin.settings?.imageOcclusion?.revealMode === "all" ? "all" : "group";
  let targetIds: Set<string> | null = null;
  let targetGroup: string | null = null;
  if (card.type === "io-child") {
    const rectIds = Array.isArray(card.rectIds) ? card.rectIds.map((v) => String(v)) : [];
    if (rectIds.length > 0) targetIds = new Set(rectIds);
    else if (card.groupKey) targetGroup = String(card.groupKey || "");
  }
  const renderMasks = showAllMasks && card.type === "io-child" ? occlusions : masksToShow;
  const isTargetRect = (rect: StoredIORect): boolean => {
    const rectId = String(rect.rectId || "");
    const rectGroup = String(rect.groupKey || "");
    if (card.type !== "io-child") return true;
    if (!targetIds && !targetGroup) return true;
    if (targetIds) return targetIds.has(rectId);
    return rectGroup === targetGroup;
  };

  const revealGroupOnly =
    reveal &&
    card.type === "io-child" &&
    maskMode === "all" &&
    revealMode === "group";

  const masksForOverlay = !reveal
    ? renderMasks
    : revealGroupOnly
      ? occlusions.filter((rect) => !isTargetRect(rect))
      : [];

  if (masksForOverlay.length > 0) {
    const overlay = document.createElement("div");
    overlay.classList.add("learnkit-io-overlay", "learnkit-io-overlay");
    const hintSizeUpdaters: Array<() => void> = [];


    function updateOverlay() {
      // Use getBoundingClientRect to get the actual rendered size and position
      const imgRect = img.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      // Calculate position relative to host
      const left = imgRect.left - hostRect.left;
      const top = imgRect.top - hostRect.top;
      const imgStyles = getComputedStyle(img);
      setCssProps(overlay, "--learnkit-io-left", `${left}px`);
      setCssProps(overlay, "--learnkit-io-top", `${top}px`);
      setCssProps(overlay, "--learnkit-io-width", `${imgRect.width}px`);
      setCssProps(overlay, "--learnkit-io-height", `${imgRect.height}px`);
      setCssProps(overlay, "--learnkit-io-max-width", imgStyles.maxWidth);
      setCssProps(overlay, "--learnkit-io-max-height", imgStyles.maxHeight);
      setCssProps(overlay, "--learnkit-io-radius", imgStyles.borderRadius);
    }

    // Add masks
    for (const rect of masksForOverlay) {
      const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
      const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
      const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
      const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;
      const isTarget = isTargetRect(rect);

      const mask = document.createElement("div");
      mask.classList.add("learnkit-io-mask", "learnkit-io-mask");
      setCssProps(mask, "--learnkit-io-x", `${Math.max(0, Math.min(1, x)) * 100}%`);
      setCssProps(mask, "--learnkit-io-y", `${Math.max(0, Math.min(1, y)) * 100}%`);
      setCssProps(mask, "--learnkit-io-w", `${Math.max(0, Math.min(1, w)) * 100}%`);
      setCssProps(mask, "--learnkit-io-h", `${Math.max(0, Math.min(1, h)) * 100}%`);
      if (reveal) {
        mask.classList.add("learnkit-io-mask-other", "learnkit-io-mask-other");
      } else if (isTarget) {
        mask.classList.add("learnkit-io-mask-target", "learnkit-io-mask-target");
      } else {
        mask.classList.add("learnkit-io-mask-other", "learnkit-io-mask-other");
      }
      // Render true ovals for ellipse/circle masks
      if (rect.shape === "circle") {
        mask.classList.add("learnkit-io-mask-circle", "learnkit-io-mask-circle");
      } else {
        mask.classList.add("learnkit-io-mask-rect", "learnkit-io-mask-rect");
      }

      overlay.appendChild(mask);
    }

    // Wait for image to load and then size overlay
    function syncOverlay() {
      updateOverlay();
      if (hintSizeUpdaters.length > 0) {
        hintSizeUpdaters.forEach((fn) => fn());
      }
    }

    function syncOverlayAfterLayout() {
      // Run after layout to ensure image is at final size
      requestAnimationFrame(() => {
        syncOverlay();
        // Also run again after a short delay in case of late layout
        setTimeout(syncOverlay, 50);
      });
    }

    if (img.complete) {
      syncOverlayAfterLayout();
    } else {
      img.addEventListener("load", syncOverlayAfterLayout, { once: true });
    }
    // Also update overlay on window resize
    const onResize = () => syncOverlay();
    window.addEventListener("resize", onResize);

    let detachedObserver: MutationObserver | null = null;
    const cleanupOverlayListeners = () => {
      window.removeEventListener("resize", onResize);
      detachedObserver?.disconnect();
      detachedObserver = null;
    };

    if (document.body) {
      detachedObserver = new MutationObserver(() => {
        if (!host.isConnected) cleanupOverlayListeners();
      });
      detachedObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Insert overlay after image in host
    host.appendChild(overlay);
  }

  if (widgetMode && enableWidgetModal) {
    host.classList.add("learnkit-io-zoom-in", "learnkit-io-zoom-in");
    img.classList.add("learnkit-io-zoom-in", "learnkit-io-zoom-in");
    host.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openZoomModal();
    };
  }

  if (!widgetMode) containerEl.appendChild(host);
}
