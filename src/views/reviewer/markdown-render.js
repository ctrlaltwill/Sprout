/**
 * @file src/reviewer/markdown-render.ts
 * @summary Wraps Obsidian's MarkdownRenderer to handle image resolution (both Obsidian embeds and shorthand links), stale-render prevention, and clickable image zoom decoration for card content displayed in the reviewer.
 *
 * @exports
 *   - SproutMarkdownHelper — Class that renders Markdown into DOM containers with image expansion, zoom affordance, and stale-render guards
 */
import { MarkdownRenderer, TFile } from "obsidian";
import { setCssProps } from "../../platform/core/ui";
export class SproutMarkdownHelper {
    constructor(opts) {
        var _a;
        this._serial = 0;
        this.app = opts.app;
        this.owner = opts.owner;
        this.onZoom = opts.onZoom;
        this.maxHeightPx = Number((_a = opts.maxHeightPx) !== null && _a !== void 0 ? _a : 200);
    }
    isImageExtension(ext) {
        switch (String(ext || "").toLowerCase()) {
            case "png":
            case "jpg":
            case "jpeg":
            case "gif":
            case "webp":
            case "svg":
            case "bmp":
            case "tif":
            case "tiff":
            case "avif":
                return true;
            default:
                return false;
        }
    }
    resolveImageToResourceUrl(link, sourcePath) {
        const cleaned = String(link !== null && link !== void 0 ? link : "").trim().split("|")[0].trim();
        if (!cleaned)
            return null;
        const dest = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
        if (!dest || !(dest instanceof TFile))
            return null;
        if (!this.isImageExtension(dest.extension))
            return null;
        return this.app.vault.getResourcePath(dest);
    }
    /**
     * Convert BOTH:
     *  - Obsidian embeds: ![[file.png]] or ![[file.png|200]]
     *  - Shorthand: ![file.png] (NOT markdown image syntax)
     *
     * into standard markdown images pointing at app:// resource URLs.
     * Also force images onto their own line by surrounding with blank lines.
     */
    expandImagesToRealMarkdown(md, sourcePath) {
        let s = String(md !== null && md !== void 0 ? md : "");
        // 1) Obsidian embeds: ![[file.png]] or ![[file.png|200]]
        s = s.replace(/!\[\[([^\]\r\n|]+)(?:\|[^\]\r\n]+)?\]\]/g, (m, inner) => {
            const url = this.resolveImageToResourceUrl(String(inner !== null && inner !== void 0 ? inner : ""), sourcePath);
            if (!url)
                return m;
            return `\n\n![](<${url}>)\n\n`;
        });
        // 2) Shorthand: ![file.png]  (do NOT touch valid markdown images ![alt](...))
        s = s.replace(/!\[([^\]\r\n]+?)\](?!\s*\()/g, (m, inner) => {
            const url = this.resolveImageToResourceUrl(String(inner !== null && inner !== void 0 ? inner : ""), sourcePath);
            if (!url)
                return m;
            return `\n\n![](<${url}>)\n\n`;
        });
        // Avoid runaway blank lines
        s = s.replace(/\n{3,}/g, "\n\n");
        return s;
    }
    /**
     * Cursor-only zoom affordance; no overlay icon.
     * Also enforce block/left-aligned layout.
     */
    decorateRenderedImages(containerEl) {
        var _a;
        const imgs = Array.from(containerEl.querySelectorAll("img"));
        for (const img of imgs) {
            if (img.hasAttribute("data-learnkit-flag-code")) {
                img.classList.remove("learnkit-zoomable", "learnkit-zoomable");
                if (img.dataset)
                    delete img.dataset.bcZoomBound;
                continue;
            }
            if (((_a = img.dataset) === null || _a === void 0 ? void 0 : _a.bcZoomBound) === "1")
                continue;
            img.dataset.bcZoomBound = "1";
            img.classList.add("learnkit-zoomable", "learnkit-zoomable");
            setCssProps(img, "--learnkit-md-image-max-h", `${this.maxHeightPx}px`);
            try {
                img.loading = "lazy";
            }
            catch (_b) {
                // ignore
            }
            img.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const src = img.currentSrc || img.src;
                if (!src)
                    return;
                this.onZoom(src, img.alt || "Image");
            });
        }
    }
    normalizeInlineFlagImages(containerEl) {
        var _a;
        const figures = Array.from(containerEl.querySelectorAll("figure"));
        for (const figure of figures) {
            const img = figure.querySelector("img[data-learnkit-flag-code]");
            if (!img)
                continue;
            (_a = figure.querySelector("figcaption")) === null || _a === void 0 ? void 0 : _a.remove();
            figure.replaceWith(img);
        }
        const flags = Array.from(containerEl.querySelectorAll("img[data-learnkit-flag-code]"));
        for (const img of flags) {
            img.classList.remove("learnkit-zoomable", "learnkit-zoomable");
            img.removeAttribute("data-bc-zoom-bound");
            img.style.removeProperty("--learnkit-md-image-max-h");
        }
    }
    /**
     * IMPORTANT:
     * Stale-render prevention is PER-CONTAINER (dataset rid), not global.
     * This makes images render reliably in Q/A/I (and any other rendered field).
     */
    async renderInto(containerEl, md, sourcePath) {
        var _a, _b;
        const rid = String(++this._serial);
        containerEl.dataset.bcMdRid = rid;
        // Obsidian convenience method
        (_b = (_a = containerEl).empty) === null || _b === void 0 ? void 0 : _b.call(_a);
        const srcPath = String(sourcePath || "");
        const expanded = this.expandImagesToRealMarkdown(md !== null && md !== void 0 ? md : "", srcPath);
        await MarkdownRenderer.render(this.app, expanded, containerEl, srcPath, this.owner);
        if ((containerEl.dataset.bcMdRid || "") !== rid)
            return;
        this.normalizeInlineFlagImages(containerEl);
        this.decorateRenderedImages(containerEl);
        this.normalizeInlineFlagImages(containerEl);
    }
}
