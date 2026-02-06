/**
 * @file src/reviewer/zoom.ts
 * @summary Provides a full-screen image zoom modal for the reviewer. When a user clicks a zoomable image during review, this modal displays it at near-viewport size with proper aspect ratio.
 *
 * @exports
 *   - SproutImageZoomModal — Modal class that displays a single image at full viewport size
 *   - openSproutImageZoom — Convenience function that opens the zoom modal for a given image source URL
 */

import { Modal, type App } from "obsidian";

export class SproutImageZoomModal extends Modal {
  private src: string;
  private alt: string;

  constructor(app: App, src: string, alt: string) {
    super(app);
    this.src = src;
    this.alt = alt || "Image";
  }

  onOpen() {
    this.contentEl.empty();

    // CSS hooks (you'll add CSS below)
    this.containerEl.addClass("sprout-img-zoom-container");
    this.modalEl.addClass("sprout-img-zoom-modal");
    this.contentEl.addClass("sprout-img-zoom-content");

    const wrap = document.createElement("div");
    wrap.className = "sprout-img-zoom-wrap";

    const img = document.createElement("img");
    img.className = "sprout-img-zoom-full";
    img.src = this.src;
    img.alt = this.alt;

    wrap.appendChild(img);
    this.contentEl.appendChild(wrap);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function openSproutImageZoom(app: App, src: string, alt: string) {
  if (!src) return;
  new SproutImageZoomModal(app, src, alt || "Image").open();
}
