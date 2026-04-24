/**
 * @file src/reviewer/zoom.ts
 * @summary Provides a full-screen image zoom modal for the reviewer. When a user clicks a zoomable image during review, this modal displays it at near-viewport size with proper aspect ratio.
 *
 * @exports
 *   - SproutImageZoomModal — Modal class that displays a single image at full viewport size
 *   - openSproutImageZoom — Convenience function that opens the zoom modal for a given image source URL
 */
import { Modal } from "obsidian";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
export class SproutImageZoomModal extends Modal {
    constructor(app, src, alt) {
        super(app);
        this.src = src;
        this.alt = alt || "Image";
    }
    onOpen() {
        scopeModalToWorkspace(this);
        this.contentEl.empty();
        // CSS hooks (you'll add CSS below)
        this.containerEl.addClass("learnkit-img-zoom-container");
        this.modalEl.addClass("learnkit-img-zoom-modal");
        this.contentEl.addClass("learnkit-img-zoom-content");
        const wrap = document.createElement("div");
        wrap.className = "learnkit-img-zoom-wrap";
        const img = document.createElement("img");
        img.className = "learnkit-img-zoom-full";
        img.src = this.src;
        img.alt = this.alt;
        wrap.appendChild(img);
        this.contentEl.appendChild(wrap);
    }
    onClose() {
        this.contentEl.empty();
    }
}
export function openSproutImageZoom(app, src, alt) {
    if (!src)
        return;
    new SproutImageZoomModal(app, src, alt || "Image").open();
}
