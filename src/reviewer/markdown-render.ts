/**
 * @file src/reviewer/markdown-render.ts
 * @summary Wraps Obsidian's MarkdownRenderer to handle image resolution (both Obsidian embeds and shorthand links), stale-render prevention, and clickable image zoom decoration for card content displayed in the reviewer.
 *
 * @exports
 *   - SproutMarkdownHelper — Class that renders Markdown into DOM containers with image expansion, zoom affordance, and stale-render guards
 */

import { MarkdownRenderer, TFile, type App, type Component } from "obsidian";
import { setCssProps } from "../core/ui";

type Opts = {
  app: App;
  owner: Component; // the ItemView/Component used as MarkdownRenderer "source component"
  onZoom: (src: string, alt: string) => void;
  maxHeightPx?: number;
};

export class SproutMarkdownHelper {
  private app: App;
  private owner: Component;
  private onZoom: (src: string, alt: string) => void;
  private maxHeightPx: number;

  private _serial = 0;

  constructor(opts: Opts) {
    this.app = opts.app;
    this.owner = opts.owner;
    this.onZoom = opts.onZoom;
    this.maxHeightPx = Number(opts.maxHeightPx ?? 200);
  }

  private isImageExtension(ext: string): boolean {
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

  private resolveImageToResourceUrl(link: string, sourcePath: string): string | null {
    const cleaned = String(link ?? "").trim().split("|")[0].trim();
    if (!cleaned) return null;

    const dest = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
    if (!dest || !(dest instanceof TFile)) return null;
    if (!this.isImageExtension(dest.extension)) return null;

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
  private expandImagesToRealMarkdown(md: string, sourcePath: string): string {
    let s = String(md ?? "");

    // 1) Obsidian embeds: ![[file.png]] or ![[file.png|200]]
    s = s.replace(/!\[\[([^\]\r\n|]+)(?:\|[^\]\r\n]+)?\]\]/g, (m, inner) => {
      const url = this.resolveImageToResourceUrl(String(inner ?? ""), sourcePath);
      if (!url) return m;
      return `\n\n![](<${url}>)\n\n`;
    });

    // 2) Shorthand: ![file.png]  (do NOT touch valid markdown images ![alt](...))
    s = s.replace(/!\[([^\]\r\n]+?)\](?!\s*\()/g, (m, inner) => {
      const url = this.resolveImageToResourceUrl(String(inner ?? ""), sourcePath);
      if (!url) return m;
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
  private decorateRenderedImages(containerEl: HTMLElement) {
    const imgs = Array.from(containerEl.querySelectorAll("img"));

    for (const img of imgs) {
      if (img.dataset?.bcZoomBound === "1") continue;
      img.dataset.bcZoomBound = "1";

      img.classList.add("sprout-zoomable");
      setCssProps(img, "--sprout-md-image-max-h", `${this.maxHeightPx}px`);

      try {
        img.loading = "lazy";
      } catch {
        // ignore
      }

      img.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const src = img.currentSrc || img.src;
        if (!src) return;
        this.onZoom(src, img.alt || "Image");
      });
    }
  }

  /**
   * IMPORTANT:
   * Stale-render prevention is PER-CONTAINER (dataset rid), not global.
   * This makes images render reliably in Q/A/I (and any other rendered field).
   */
  async renderInto(containerEl: HTMLElement, md: string, sourcePath: string) {
    const rid = String(++this._serial);
    containerEl.dataset.bcMdRid = rid;

    // Obsidian convenience method
    (containerEl as HTMLElement & { empty?(): void }).empty?.();

    const srcPath = String(sourcePath || "");
    const expanded = this.expandImagesToRealMarkdown(md ?? "", srcPath);

    await MarkdownRenderer.render(this.owner, expanded, containerEl, srcPath);

    if ((containerEl.dataset.bcMdRid || "") !== rid) return;

    this.decorateRenderedImages(containerEl);
  }
}
