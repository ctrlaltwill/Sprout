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
import type SproutPlugin from "../main";
import type { CardRecord } from "../types/card";
import type { StoredIORect } from "./image-occlusion-types";
import { resolveImageFile } from "./io-helpers";
import type * as IoModule from "./image-occlusion-index";
import { queryFirst, setCssProps } from "../core/ui";
import { scopeModalToWorkspace } from "../modals/modal-utils";

export function isIoParentCard(card: CardRecord): boolean {
  return card && card.type === "io";
}

export function isIoRevealableType(card: CardRecord): boolean {
  return card && (card.type === "io" || card.type === "io-child");
}

export function renderImageOcclusionReviewInto(args: {
  app: App;
  plugin: SproutPlugin;
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
  containerEl.classList.add("sprout-io-container");
  if (widgetMode) {
    containerEl.classList.add("sprout-io-container--clip");
  }

  // Get image reference
  const imageRef = String(card.imageRef || "").trim();
  if (!imageRef) {
    const msg = document.createElement("div");
    msg.className = "bc text-muted-foreground text-sm";
    msg.textContent = "Image occlusion card missing image reference.";
    containerEl.appendChild(msg);
    return;
  }

  // Resolve image file
  const imageFile = resolveImageFile(app, sourcePath, imageRef);
  if (!imageFile) {
    const msg = document.createElement("div");
    msg.className = "bc text-muted-foreground text-sm";
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
    host.className = "bc sprout-io-host-card";
  }

  const img = document.createElement("img");
  img.src = imageSrc;
  img.alt = card.title || "Image occlusion";
  img.classList.add("sprout-io-image");
  // Modal mode: larger image, zoom-out cursor, fit modal
  if (args.enableWidgetModal) {
    img.classList.add("sprout-io-image-zoomed");
  } else {
    img.classList.add("sprout-io-image-inline");
  }
  if (widgetMode) {
    img.classList.add("sprout-io-image-widget");
  }
  host.appendChild(img);

  // Add masks if not revealed
  // Add zoom modal for RenderSession (not widgetMode)
  if (!widgetMode) {
    img.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Open modal with expanded image and masks, as in widget.ts
      const modal = new (class extends Modal {
        onOpen() {
          scopeModalToWorkspace(this);
          this.containerEl.addClass("sprout");
          this.contentEl.classList.add("sprout-zoom-content", "sprout-io-zoom-out");
          const zoomHost = this.contentEl.createDiv({ cls: "bc sprout-zoom-host sprout-io-zoom-out" });
          zoomHost.dataset.sproutIoWidget = "1";
          // Render with modal-specific sizing
          void renderImageOcclusionReviewInto({
            app,
            plugin,
            containerEl: zoomHost,
            card,
            sourcePath,
            reveal,
            ioModule,
            renderMarkdownInto: args.renderMarkdownInto,
            enableWidgetModal: true, // signal modal mode
          });
          // Close modal on click anywhere in modal
          this.contentEl.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.close();
          });
        }
        onClose() {
          this.contentEl.empty();
        }
      })(app);
      modal.open();
    });
  }
  const maskMode = ioDef && typeof ioDef.maskMode === "string" ? String(ioDef.maskMode) : "";
  const showAllMasks = widgetMode && maskMode === "all";
  let targetIds: Set<string> | null = null;
  let targetGroup: string | null = null;
  if (card.type === "io-child") {
    const rectIds = Array.isArray(card.rectIds) ? card.rectIds.map((v) => String(v)) : [];
    if (rectIds.length > 0) targetIds = new Set(rectIds);
    else if (card.groupKey) targetGroup = String(card.groupKey || "");
  }
  const renderMasks = showAllMasks && card.type === "io-child" ? occlusions : masksToShow;

  // Get custom colors and icon from settings
  const maskTargetColor = plugin.settings?.imageOcclusion?.maskTargetColor || "";
  const maskOtherColor = plugin.settings?.imageOcclusion?.maskOtherColor || "";
  const maskIcon = plugin.settings?.imageOcclusion?.maskIcon ?? "?";

  if (!reveal && renderMasks.length > 0) {
    const overlay = document.createElement("div");
    overlay.classList.add("sprout-io-overlay");
    const hintSizeUpdaters: Array<() => void> = [];

    // Apply custom mask colors to the overlay container (only if set)
    if (maskTargetColor) {
      setCssProps(overlay, "--sprout-io-mask-target-color", maskTargetColor);
    }
    if (maskOtherColor) {
      setCssProps(overlay, "--sprout-io-mask-other-color", maskOtherColor);
    }


    function updateOverlay() {
      // Use getBoundingClientRect to get the actual rendered size and position
      const imgRect = img.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      // Calculate position relative to host
      const left = imgRect.left - hostRect.left;
      const top = imgRect.top - hostRect.top;
      const imgStyles = getComputedStyle(img);
      setCssProps(overlay, "--sprout-io-left", `${left}px`);
      setCssProps(overlay, "--sprout-io-top", `${top}px`);
      setCssProps(overlay, "--sprout-io-width", `${imgRect.width}px`);
      setCssProps(overlay, "--sprout-io-height", `${imgRect.height}px`);
      setCssProps(overlay, "--sprout-io-max-width", imgStyles.maxWidth);
      setCssProps(overlay, "--sprout-io-max-height", imgStyles.maxHeight);
      setCssProps(overlay, "--sprout-io-radius", imgStyles.borderRadius);
    }

    // Add masks
    for (const rect of renderMasks) {
      const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
      const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
      const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
      const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;
      const rectId = String(rect.rectId || "");
      const rectGroup = String(rect.groupKey || "");
      const isTarget =
        card.type !== "io-child"
          ? true
          : !targetIds && !targetGroup
            ? true
            : targetIds
              ? targetIds.has(rectId)
              : rectGroup === targetGroup;

      const mask = document.createElement("div");
      mask.classList.add("sprout-io-mask");
      setCssProps(mask, "--sprout-io-x", `${Math.max(0, Math.min(1, x)) * 100}%`);
      setCssProps(mask, "--sprout-io-y", `${Math.max(0, Math.min(1, y)) * 100}%`);
      setCssProps(mask, "--sprout-io-w", `${Math.max(0, Math.min(1, w)) * 100}%`);
      setCssProps(mask, "--sprout-io-h", `${Math.max(0, Math.min(1, h)) * 100}%`);
      if (widgetMode) {
        if (isTarget) {
          mask.classList.add("sprout-io-mask-target");
          // Only show icon if maskIcon is not empty
          if (maskIcon && maskIcon.trim()) {
            const hint = document.createElement("span");
            hint.classList.add("sprout-io-mask-hint");
            const KNOWN_ICONS = ["circle-help", "eye-off"];
            if (KNOWN_ICONS.includes(maskIcon.trim())) {
              setIcon(hint, maskIcon.trim());
            } else {
              hint.textContent = maskIcon.trim();
            }
            mask.appendChild(hint);
            hintSizeUpdaters.push(() => {
              const rect = mask.getBoundingClientRect();
              if (!rect.height) return;
              const size = Math.max(12, rect.height * 0.35);
              setCssProps(hint, "--sprout-io-hint-size", `${size}px`);
            });
          }
        } else {
          mask.classList.add("sprout-io-mask-other");
        }
      } else {
        mask.classList.add("sprout-io-mask-hidden");
      }
      // Render true ovals for ellipse/circle masks
      if (rect.shape === "circle") {
        mask.classList.add("sprout-io-mask-circle");
      } else {
        mask.classList.add("sprout-io-mask-rect");
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
    window.addEventListener("resize", syncOverlay);

    // Insert overlay after image in host
    host.appendChild(overlay);
  }

  if (widgetMode && enableWidgetModal) {
    host.classList.add("sprout-io-zoom-in");
    img.classList.add("sprout-io-zoom-in");
    host.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const modal = new (class extends Modal {
        onOpen() {
          scopeModalToWorkspace(this);
          this.containerEl.addClass("sprout-modal-container", "sprout-modal-dim", "sprout");
          this.modalEl.addClass("bc", "sprout-modals", "sprout-zoom-overlay");
          queryFirst(this.modalEl, ".modal-header")?.remove();
          queryFirst(this.modalEl, ".modal-close-button")?.remove();

          this.contentEl.empty();
          this.contentEl.classList.add("sprout-zoom-content");

          const zoomHost = this.contentEl.createDiv({ cls: "bc sprout-zoom-host" });
          zoomHost.dataset.sproutIoWidget = "1";

          renderImageOcclusionReviewInto({
            app,
            plugin,
            containerEl: zoomHost,
            card,
            sourcePath,
            reveal,
            ioModule,
            renderMarkdownInto: args.renderMarkdownInto,
            enableWidgetModal: false,
          });
          {
            const zoomImg = queryFirst(zoomHost, "img");
            if (zoomImg) {
              zoomImg.classList.add("sprout-zoom-img", "sprout-io-image-zoomed");
            }

            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.setAttribute("data-tooltip", "Close");
            closeBtn.classList.add("sprout-zoom-close");
            setIcon(closeBtn, "x");
            closeBtn.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.close();
            });
            zoomHost.appendChild(closeBtn);
          }
        }

        onClose() {
          this.contentEl.empty();
          this.modalEl.removeClass("sprout-modals");
          this.containerEl.removeClass("sprout-modal-container", "sprout-modal-dim", "sprout");
        }
      })(app);

      modal.open();
    };
  }

  if (!widgetMode) containerEl.appendChild(host);
}
