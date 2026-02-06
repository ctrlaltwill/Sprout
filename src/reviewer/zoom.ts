// src/reviewer/imageZoom.ts
import { Modal } from "obsidian";

export class SproutImageZoomModal extends Modal {
  private src: string;
  private alt: string;

  constructor(app: any, src: string, alt: string) {
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
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.width = "100%";
    wrap.style.height = "100%";

    const img = document.createElement("img");
    img.className = "sprout-img-zoom-full";
    img.src = this.src;
    img.alt = this.alt;

    // Safe defaults (CSS will enhance)
    img.style.maxWidth = "92vw";
    img.style.maxHeight = "86vh";
    img.style.width = "auto";
    img.style.height = "auto";
    img.style.objectFit = "contain";

    wrap.appendChild(img);
    this.contentEl.appendChild(wrap);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function openSproutImageZoom(app: any, src: string, alt: string) {
  if (!src) return;
  new SproutImageZoomModal(app, src, alt || "Image").open();
}
