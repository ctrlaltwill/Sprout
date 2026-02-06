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
  ioModule: typeof import("./image-occlusion-index");
  renderMarkdownInto: (el: HTMLElement, md: string, sp: string) => Promise<void>;
  enableWidgetModal?: boolean;
}) {
  const { app, plugin, containerEl, card, sourcePath, reveal, ioModule } = args;
  const widgetMode = containerEl?.dataset?.sproutIoWidget === "1";
  const enableWidgetModal = args.enableWidgetModal !== false;

  // Clear container
  containerEl.innerHTML = "";
  containerEl.style.position = "relative";
  containerEl.style.display = "inline-block";
  containerEl.style.maxWidth = "100%";
  if (widgetMode) {
    containerEl.style.overflow = "hidden";
  }

  // Get image reference
  const imageRef = String(card.imageRef || card.ioSrc || card.src || card.image || "").trim();
  if (!imageRef) {
    containerEl.innerHTML = '<div class="bc text-muted-foreground text-sm">IO card missing image reference.</div>';
    return;
  }

  // Resolve image file
  const imageFile = resolveImageFile(app, sourcePath, imageRef);
  if (!imageFile) {
    containerEl.innerHTML = `<div class="bc text-muted-foreground text-sm">Image not found: ${imageRef}</div>`;
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
    host.className = "bc";
    host.style.position = "relative";
    host.style.display = "inline-block";
    host.style.borderRadius = "3px";
    host.style.overflow = "hidden";
    host.style.border = "1px solid var(--background-modifier-border)";
    host.style.background = "var(--background-secondary)";
    host.style.maxWidth = "100%";
  }

  const img = document.createElement("img");
  img.src = imageSrc;
  img.alt = card.title || "Image Occlusion";
  img.style.display = "block";
  img.style.maxWidth = "100%";
  img.style.height = "auto";
  // Modal mode: larger image, zoom-out cursor, fit modal
  if (args.enableWidgetModal) {
    img.style.maxWidth = "95vw";
    img.style.maxHeight = "90vh";
    img.style.cursor = "zoom-out";
    img.style.display = "block";
    img.style.margin = "0 auto";
    img.style.objectFit = "contain";
    img.style.width = "auto";
    img.style.height = "auto";
  } else {
    img.style.maxHeight = "350px";
    img.style.cursor = "zoom-in";
  }
  if (widgetMode) {
    img.style.setProperty("border", "none", "important");
    img.style.setProperty("outline", "none", "important");
    img.style.setProperty("box-shadow", "none", "important");
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
          this.contentEl.style.padding = "16px";
          this.contentEl.style.display = "flex";
          this.contentEl.style.justifyContent = "center";
          this.contentEl.style.alignItems = "center";
          this.contentEl.style.cursor = "zoom-out";
          this.contentEl.style.width = "100%";
          this.contentEl.style.height = "100%";
          const zoomHost = this.contentEl.createDiv({ cls: "bc" });
          zoomHost.dataset.sproutIoWidget = "1";
          zoomHost.style.position = "relative";
          zoomHost.style.display = "flex";
          zoomHost.style.alignItems = "center";
          zoomHost.style.justifyContent = "center";
          zoomHost.style.maxWidth = "95vw";
          zoomHost.style.maxHeight = "90vh";
          zoomHost.style.overflow = "visible";
          zoomHost.style.cursor = "zoom-out";
          zoomHost.style.boxSizing = "border-box";
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
  if (!reveal && renderMasks.length > 0) {
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2";
    const hintSizeUpdaters: Array<() => void> = [];



    function updateOverlay() {
      // Use getBoundingClientRect to get the actual rendered size and position
      const imgRect = img.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      // Calculate position relative to host
      const left = imgRect.left - hostRect.left;
      const top = imgRect.top - hostRect.top;
      overlay.style.position = "absolute";
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${imgRect.width}px`;
      overlay.style.height = `${imgRect.height}px`;
      overlay.style.maxWidth = img.style.maxWidth;
      overlay.style.maxHeight = img.style.maxHeight;
      overlay.style.display = img.style.display;
      overlay.style.margin = img.style.margin;
      overlay.style.borderRadius = img.style.borderRadius;
      overlay.style.overflow = "hidden";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2";
      overlay.style.right = "auto";
      overlay.style.bottom = "auto";
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
      mask.style.position = "absolute";
      mask.style.left = `${Math.max(0, Math.min(1, x)) * 100}%`;
      mask.style.top = `${Math.max(0, Math.min(1, y)) * 100}%`;
      mask.style.width = `${Math.max(0, Math.min(1, w)) * 100}%`;
      mask.style.height = `${Math.max(0, Math.min(1, h)) * 100}%`;
      if (widgetMode) {
        if (isTarget) {
          mask.style.background = "var(--theme-accent)";
          mask.style.border = "2px solid var(--foreground)";
          mask.style.display = "flex";
          mask.style.alignItems = "center";
          mask.style.justifyContent = "center";
          const hint = document.createElement("span");
          hint.textContent = "?";
          hint.style.color = "#fff";
          hint.style.fontWeight = "600";
          hint.style.lineHeight = "1";
          mask.appendChild(hint);
          hintSizeUpdaters.push(() => {
            const rect = mask.getBoundingClientRect();
            if (!rect.height) return;
            const size = Math.max(12, rect.height * 0.35);
            hint.style.fontSize = `${size}px`;
          });
        } else {
          mask.style.background = "var(--foreground)";
          mask.style.border = "2px solid var(--foreground)";
        }
      } else {
        mask.style.background = "var(--background)00";
        mask.style.border = "none";
      }
      // Render true ovals for ellipse/circle masks
      if (rect.shape === "circle") {
        mask.style.borderRadius = "50%";
      } else {
        mask.style.borderRadius = "3px";
      }
      mask.style.pointerEvents = "none";
      mask.style.zIndex = "1";

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
    host.style.cursor = "zoom-in";
    img.style.cursor = "zoom-in";
    host.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const modal = new (class extends Modal {
        onOpen() {
          this.containerEl.addClass("sprout-modal-container", "sprout-modal-dim", "sprout");
          this.modalEl.addClass("bc", "sprout-modals");
          this.modalEl.style.setProperty("background", "transparent", "important");
          this.modalEl.style.setProperty("backdrop-filter", "none", "important");
          this.modalEl.style.setProperty("border", "none", "important");
          this.modalEl.style.setProperty("box-shadow", "none", "important");
          this.modalEl.style.setProperty("padding", "0", "important");
          this.modalEl.style.setProperty("max-width", "none", "important");
          this.modalEl.style.setProperty("width", "auto", "important");
          this.modalEl.querySelector(".modal-header")?.remove();
          this.modalEl.querySelector(".modal-close-button")?.remove();

          this.contentEl.empty();
          this.contentEl.style.setProperty("padding", "0", "important");
          this.contentEl.style.setProperty("display", "flex", "important");
          this.contentEl.style.setProperty("align-items", "center", "important");
          this.contentEl.style.setProperty("justify-content", "center", "important");
          this.contentEl.style.setProperty("width", "100%", "important");
          this.contentEl.style.setProperty("height", "100%", "important");

          const zoomHost = this.contentEl.createDiv({ cls: "bc" });
          zoomHost.dataset.sproutIoWidget = "1";
          zoomHost.style.setProperty("position", "relative", "important");
          zoomHost.style.setProperty("display", "flex", "important");
          zoomHost.style.setProperty("align-items", "center", "important");
          zoomHost.style.setProperty("justify-content", "center", "important");
          zoomHost.style.setProperty("max-width", "95vw", "important");
          zoomHost.style.setProperty("max-height", "90vh", "important");
          zoomHost.style.setProperty("overflow", "visible", "important");

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
            const zoomImg = zoomHost.querySelector("img");
            if (zoomImg) {
              zoomImg.style.setProperty("max-width", "95vw", "important");
              zoomImg.style.setProperty("max-height", "90vh", "important");
              zoomImg.style.setProperty("width", "auto", "important");
              zoomImg.style.setProperty("height", "auto", "important");
              zoomImg.style.setProperty("object-fit", "contain", "important");
              zoomImg.style.setProperty("display", "block", "important");
            }

            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.setAttribute("data-tooltip", "Close");
            closeBtn.style.position = "absolute";
            closeBtn.style.top = "8px";
            closeBtn.style.right = "8px";
            closeBtn.style.zIndex = "5";
            closeBtn.style.width = "24px";
            closeBtn.style.height = "24px";
            closeBtn.style.display = "flex";
            closeBtn.style.alignItems = "center";
            closeBtn.style.justifyContent = "center";
            closeBtn.style.border = "none";
            closeBtn.style.background = "transparent";
            closeBtn.style.boxShadow = "none";
            closeBtn.style.outline = "none";
            closeBtn.style.padding = "0";
            closeBtn.style.color = "var(--foreground)";
            closeBtn.style.opacity = "0.8";
            closeBtn.style.cursor = "pointer";
            setIcon(closeBtn, "x");
            closeBtn.addEventListener("mouseenter", () => {
              closeBtn.style.opacity = "1";
            });
            closeBtn.addEventListener("mouseleave", () => {
              closeBtn.style.opacity = "0.8";
            });
            closeBtn.addEventListener("mousedown", () => {
              closeBtn.style.opacity = "1";
            });
            closeBtn.addEventListener("mouseup", () => {
              closeBtn.style.opacity = "1";
            });
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
