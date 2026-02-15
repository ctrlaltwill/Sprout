/**
 * @file src/reading/reading-view.ts
 * @summary Stateful, side-effectful code for Sprout's reading-view pretty-card rendering and masonry layout. Owns all mutable module-level state (sproutPluginRef, masonry timers, MutationObserver) and the Obsidian registerMarkdownPostProcessor hook that transforms card blocks into styled, interactive card elements in the editor.
 *
 * @exports
 *  - registerReadingViewPrettyCards — registers the markdown post-processor that renders pretty cards in reading view
 */

import type { App, Plugin, MarkdownPostProcessorContext } from "obsidian";
import { Component, MarkdownRenderer, Notice, setIcon, TFile } from "obsidian";
import { log } from "../core/logger";
import { escapeDelimiterRe } from "../core/delimiter";
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import { ImageOcclusionCreatorModal } from "../modals/image-occlusion-creator-modal";
import { buildCardBlockMarkdown, findCardBlockRangeById } from "../reviewer/markdown-block";
import type { CardRecord } from "../core/store";
import type SproutPlugin from "../main";
import { queryFirst, replaceChildrenWithHTML, setCssProps } from "../core/ui";
import { DEFAULT_SETTINGS } from "../core/default-settings";
import { resolveImageFile } from "../imageocclusion/io-helpers";
import type { StoredIORect } from "../imageocclusion/image-occlusion-types";

import {
  ANCHOR_RE,
  clean,
  extractRawTextFromParagraph,
  extractTextWithLaTeX,
  extractCardFromSource,
  parseSproutCard,
  normalizeMathSignature,
  processMarkdownFeatures,
  buildCardContentHTML,
  renderMathInElement,
  type SproutCard,
} from "./reading-helpers";
import { getTtsService } from "../tts/tts-service";

/* -----------------------
   Module-level mutable state
   ----------------------- */

let sproutPluginRef: Plugin | null = null;

/** Shape of a Sprout plugin instance for general-setting lookups. */
type SproutPluginLike = Plugin & {
  store?: { data?: { cards?: Record<string, CardRecord> } };
  settings?: {
    general?: { prettifyCards?: string; enableReadingStyles?: boolean };
    audio?: {
      enabled?: boolean;
      autoplay?: boolean;
      limitToGroup?: string;
      basicFront?: boolean;
      basicBack?: boolean;
      clozeFront?: boolean;
      clozeRevealed?: boolean;
      clozeAnswerMode?: "cloze-only" | "full-sentence";
      defaultLanguage?: string;
      autoDetectLanguage?: boolean;
      scriptLanguages?: {
        cyrillic?: string;
        arabic?: string;
        cjk?: string;
        devanagari?: string;
      };
      rate?: number;
      pitch?: number;
      preferredVoiceURI?: string;
    };
    readingView?: {
      preset?: string;
      advancedEnabled?: boolean;
      layout?: "masonry" | "vertical";
      cardMode?: "full" | "flip";
      visibleFields?: {
        title?: boolean;
        question?: boolean;
        options?: boolean;
        answer?: boolean;
        info?: boolean;
        groups?: boolean;
        edit?: boolean;
      };
      displayLabels?: boolean;
      cardBgLight?: string;
      cardBgDark?: string;
      cardBorderLight?: string;
      cardBorderDark?: string;
      cardAccentLight?: string;
      cardAccentDark?: string;
      fontSize?: number;
      activeMacro?: "flashcards" | "classic" | "guidebook" | "markdown" | "custom";
      macroConfigs?: {
        flashcards?: {
          fields?: {
            title?: boolean;
            question?: boolean;
            options?: boolean;
            answer?: boolean;
            info?: boolean;
            groups?: boolean;
            edit?: boolean;
            labels?: boolean;
          };
        };
        classic?: {
          fields?: {
            title?: boolean;
            question?: boolean;
            options?: boolean;
            answer?: boolean;
            info?: boolean;
            groups?: boolean;
            edit?: boolean;
            labels?: boolean;
          };
          colours?: {
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
          };
        };
        guidebook?: {
          fields?: {
            title?: boolean;
            question?: boolean;
            options?: boolean;
            answer?: boolean;
            info?: boolean;
            groups?: boolean;
            edit?: boolean;
            labels?: boolean;
          };
          colours?: {
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
          };
        };
        markdown?: {
          fields?: {
            title?: boolean;
            question?: boolean;
            options?: boolean;
            answer?: boolean;
            info?: boolean;
            groups?: boolean;
            edit?: boolean;
            labels?: boolean;
          };
          colours?: {
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
          };
        };
        custom?: {
          fields?: {
            title?: boolean;
            question?: boolean;
            options?: boolean;
            answer?: boolean;
            info?: boolean;
            groups?: boolean;
            edit?: boolean;
            labels?: boolean;
          };
          colours?: {
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
          };
          customCss?: string;
        };
      };
    };
  };
  syncBank?(): Promise<void>;
  refreshAllViews?(): void;
};

/** Shorthand for reading view settings shape. */
type ReadingViewSettings = NonNullable<SproutPluginLike["settings"]>["readingView"];
type AudioSettings = NonNullable<NonNullable<SproutPluginLike["settings"]>["audio"]>;

function getSproutPlugin(): SproutPluginLike | null {
  if (sproutPluginRef) return sproutPluginRef as SproutPluginLike;
  try {
    const plugin = Object.values(window?.app?.plugins?.plugins ?? {}).find(
      (p): p is SproutPluginLike => {
        const sp = p as SproutPluginLike;
        return !!sp?.store && !!sp?.settings?.general;
      },
    );
    return plugin ?? null;
  } catch {
    return null;
  }
}

function debugLog(...args: unknown[]) {
  log.debug(...args);
}

/* =========================
   Colour derivation helpers
   ========================= */

/**
 * Parse a hex colour string to HSL components.
 * Returns { h: 0-360, s: 0-100, l: 0-100 }.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 50 };
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Convert HSL to a hex colour string.
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const colour = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * colour).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Derive a dark-theme background variant from a light colour.
 * Darkens the lightness significantly and slightly desaturates.
 */
function deriveColourForDark(lightHex: string): string {
  const { h, s, l } = hexToHsl(lightHex);
  // Map light background (high L) to dark background (low L)
  const darkL = Math.max(8, Math.min(25, 100 - l));
  const darkS = Math.max(0, s - 10);
  return hslToHex(h, darkS, darkL);
}

/**
 * Derive a dark-theme accent variant from a light accent colour.
 * Bumps lightness to ensure visibility on dark backgrounds.
 */
function deriveAccentForDark(lightHex: string): string {
  const { h, s, l } = hexToHsl(lightHex);
  // Ensure accent is bright enough on dark backgrounds
  const darkL = Math.max(55, Math.min(80, l + 20));
  return hslToHex(h, s, darkL);
}

/* =========================
   Dynamic style injection
   ========================= */

const DYNAMIC_STYLE_ID = 'sprout-rv-dynamic-styles';

function normaliseMacroPreset(raw: string | undefined): 'classic' | 'guidebook' | 'flashcards' | 'markdown' | 'custom' {
  const key = String(raw || '').trim().toLowerCase();
  if (key === 'minimal-flip') return 'flashcards';
  if (key === 'full-card') return 'classic';
  if (key === 'compact') return 'markdown';
  if (key === 'classic' || key === 'guidebook' || key === 'flashcards' || key === 'markdown' || key === 'custom') return key;
  return 'flashcards';
}

/**
 * Injects or updates a <style> element that writes the current reading-view
 * settings as CSS rules. This makes colour, font, layout, and mode changes
 * instant — no per-card DOM manipulation or full re-render needed.
 *
 * Called once on init and again whenever a reading-view setting changes.
 */
export function syncReadingViewStyles(): void {
  const plugin = getSproutPlugin();
  const enabled = plugin?.settings?.general?.enableReadingStyles ?? plugin?.settings?.general?.prettifyCards !== "off";
  const rv = plugin?.settings?.readingView;
  const macroPreset = normaliseMacroPreset((rv?.activeMacro as string | undefined) ?? rv?.preset);
  const macroSelector = `.sprout-pretty-card.sprout-macro-${macroPreset}`;

  let styleEl = document.getElementById(DYNAMIC_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    // eslint-disable-next-line obsidianmd/no-forbidden-elements -- dynamic reading-view styles require runtime updates
    styleEl = document.head.createEl('style', { attr: { id: DYNAMIC_STYLE_ID } });
  }

  if (!enabled) {
    styleEl.textContent = "";
    return;
  }

  const macroConfig =
    macroPreset === 'classic'
      ? rv?.macroConfigs?.classic
      : macroPreset === 'guidebook'
        ? rv?.macroConfigs?.guidebook
        : macroPreset === 'markdown'
          ? rv?.macroConfigs?.markdown
          : macroPreset === 'custom'
            ? rv?.macroConfigs?.custom
            : rv?.macroConfigs?.flashcards;

  let css = '';

  // ── Custom colours (body-level variables so all cards inherit) ──
  const bgLight = (macroConfig as { colours?: { cardBgLight?: string } } | undefined)?.colours?.cardBgLight ?? rv?.cardBgLight;
  const borderLight = (macroConfig as { colours?: { cardBorderLight?: string } } | undefined)?.colours?.cardBorderLight ?? rv?.cardBorderLight;
  const accentLight = (macroConfig as { colours?: { cardAccentLight?: string } } | undefined)?.colours?.cardAccentLight ?? rv?.cardAccentLight;

  if (bgLight || borderLight || accentLight) {
    let lightVars = '';
    let darkVars = '';
    if (bgLight) {
      lightVars += `  --sprout-rv-bg: ${bgLight};\n`;
      darkVars += `  --sprout-rv-bg: ${deriveColourForDark(bgLight)};\n`;
    }
    if (borderLight) {
      lightVars += `  --sprout-rv-border: ${borderLight};\n`;
      darkVars += `  --sprout-rv-border: ${deriveColourForDark(borderLight)};\n`;
    }
    if (accentLight) {
      lightVars += `  --sprout-rv-accent: ${accentLight};\n`;
      darkVars += `  --sprout-rv-accent: ${deriveAccentForDark(accentLight)};\n`;
    }
    css += `body.theme-light {\n${lightVars}}\n`;
    css += `body.theme-dark {\n${darkVars}}\n`;

    // Apply custom colours to the active macro only (except flashcards).
    css += `${macroSelector} {\n`;
    if (bgLight) css += `  background-color: var(--sprout-rv-bg) !important;\n`;
    if (borderLight) css += `  border-color: var(--sprout-rv-border) !important;\n`;
    css += `}\n`;
    if (accentLight && macroPreset !== 'flashcards') {
      css += `${macroSelector} .sprout-card-title { color: var(--sprout-rv-accent) !important; }\n`;
      css += `${macroSelector} .sprout-card-id { color: var(--sprout-rv-accent) !important; }\n`;
      css += `${macroSelector} .sprout-reading-view-cloze { background-color: color-mix(in srgb, var(--sprout-rv-accent) 12%, transparent) !important; }\n`;
      css += `${macroSelector} .sprout-cloze-text { color: var(--sprout-rv-accent) !important; }\n`;
      css += `${macroSelector} .sprout-cloze { background-color: color-mix(in srgb, var(--sprout-rv-accent) 12%, transparent) !important; }\n`;
    }
  }

  // ── Font size ──
  const fontSize = Number(rv?.fontSize);
  const effectiveFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 0.9;
  css += `.sprout-pretty-card .sprout-section-content,\n`;
  css += `.sprout-pretty-card .sprout-answer,\n`;
  css += `.sprout-pretty-card .sprout-info,\n`;
  css += `.sprout-pretty-card .sprout-section-label,\n`;
  css += `.sprout-pretty-card .sprout-text-muted,\n`;
  css += `.sprout-pretty-card .sprout-option,\n`;
  css += `.sprout-pretty-card.sprout-macro-flashcards .sprout-flashcard-question,\n`;
  css += `.sprout-pretty-card.sprout-macro-flashcards .sprout-flashcard-answer,\n`;
  css += `.sprout-pretty-card.sprout-macro-flashcards .sprout-flashcard-options,\n`;
  css += `.sprout-pretty-card.sprout-macro-flashcards .sprout-flashcard-info {\n`;
  css += `  font-size: ${effectiveFontSize}rem !important;\n`;
  css += `}\n`;

  // ── Layout ──
  if (rv?.layout === 'vertical') {
    css += `.markdown-preview-section:has(.sprout-pretty-card) {\n`;
    css += `  column-width: unset !important;\n  column-gap: unset !important;\n  column-count: 1 !important;\n`;
    css += `  display: flex;\n  flex-direction: column;\n  gap: 12px;\n`;
    css += `}\n`;
    css += `.markdown-preview-section:has(.sprout-pretty-card) > .sprout-pretty-card {\n`;
    css += `  margin-top: 0 !important;\n  margin-bottom: 0 !important;\n`;
    css += `}\n`;
  }

  if (macroPreset === 'flashcards') {
    css += `.markdown-preview-section:has(.sprout-pretty-card.sprout-macro-flashcards) {\n`;
    css += `  column-width: 280px !important;\n`;
    css += `  column-gap: 16px !important;\n`;
    css += `  display: block !important;\n`;
    css += `}\n`;
    css += `.markdown-preview-section:has(.sprout-pretty-card.sprout-macro-flashcards) > .sprout-pretty-card.sprout-macro-flashcards {\n`;
    css += `  margin-top: 0 !important;\n`;
    css += `  margin-bottom: 16px !important;\n`;
    css += `}\n`;
  }

  // ── Card mode: full (expand collapsibles, hide toggle buttons) ──
  if (rv?.cardMode === 'full') {
    css += `.sprout-pretty-card .sprout-collapsible { max-height: none !important; overflow: visible !important; }\n`;
    css += `.sprout-pretty-card .sprout-toggle-btn { display: none !important; }\n`;
  }

  // ── Field visibility / included data ──
  const macroFields = (macroConfig as {
    fields?: {
      title?: boolean;
      question?: boolean;
      options?: boolean;
      answer?: boolean;
      info?: boolean;
      groups?: boolean;
      edit?: boolean;
      labels?: boolean;
    };
  } | undefined)?.fields;
  const activeFields = macroFields ?? rv?.visibleFields;
  if (activeFields) {
    const vf = activeFields;
    if (!vf.title) css += `${macroSelector} .sprout-card-header { display: none !important; }\n`;
    if (!vf.question) css += `${macroSelector} .sprout-section-question { display: none !important; }\n`;
    if (!vf.options) css += `${macroSelector} .sprout-section-options { display: none !important; }\n`;
    if (!vf.answer) css += `${macroSelector} .sprout-section-answer { display: none !important; }\n`;
    if (!vf.info) css += `${macroSelector} .sprout-section-info { display: none !important; }\n`;
    if (!vf.groups) css += `${macroSelector} .sprout-groups-list, ${macroSelector} .sprout-section-groups { display: none !important; }\n`;
    if (!vf.edit) css += `${macroSelector} .sprout-card-edit-btn { display: none !important; }\n`;
  }
  const showLabels = (macroConfig as { fields?: { labels?: boolean } } | undefined)?.fields?.labels ?? rv?.displayLabels;
  if (showLabels === false) {
    css += `${macroSelector} .sprout-section-label { display: none !important; }\n`;
  }
  if (macroPreset === 'classic') {
    css += `.sprout-pretty-card.sprout-macro-classic .sprout-section-label { display: flex !important; }\n`;
  }

  if (macroPreset === 'custom') {
    const rawCustomCss = rv?.macroConfigs?.custom?.customCss ?? '';
    const safeCustomCss = String(rawCustomCss).replace(/<\/?style[^>]*>/gi, '').trim();
    if (safeCustomCss) {
      css += `\n/* user custom reading css */\n${safeCustomCss}\n`;
    }
  }

  // Macro-specific styling is handled in pretty-cards.css.

  // ── Upsert the <style> element ──
  // Note: Using document.head.createEl (Obsidian API) for reading-view dynamic settings
  // For static CSS, use the main styles.css file
  styleEl.textContent = css;
}

/* =========================
   Public registration
   ========================= */

export function registerReadingViewPrettyCards(plugin: Plugin) {
  debugLog("[Sprout] Registering reading view prettifier");

  sproutPluginRef = plugin;

  injectStylesOnce();

  // Inject dynamic styles from current reading-view settings
  syncReadingViewStyles();

  plugin.registerMarkdownPostProcessor(
    async (rootEl: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      try {
        // Skip if inside editor live preview
        if (rootEl.closest(".cm-content")) {
          debugLog("[Sprout] Skipping - in editor content");
          return;
        }

        // Only run in reading/preview contexts
        const isInReadingView =
          rootEl.closest(
            ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section"
          ) !== null ||
          (ctx.containerEl && (ctx.containerEl.classList.contains("markdown-reading-view") || ctx.containerEl.classList.contains("markdown-preview-view") || ctx.containerEl.closest(".markdown-reading-view, .markdown-preview-view") !== null));

        if (!isInReadingView) {
          debugLog("[Sprout] Skipping - not in reading/preview view");
          return;
        }

        // Try to get source file content
        let sourceContent = '';
        try {
          const ctxPaths = ctx as { sourceNotePath?: string; sourcePath?: string };
          const sourcePath = ctxPaths.sourceNotePath ?? ctxPaths.sourcePath;
          if (typeof sourcePath === "string" && sourcePath && plugin.app.vault) {
            const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
            if (file instanceof TFile && file.extension === "md") {
              const content = await plugin.app.vault.read(file);
              sourceContent = content;
            }
          }
        } catch (e) {
          debugLog("[Sprout] Could not read source file:", e);
        }

        // Parse and enhance any new .el-p nodes in this root
        await processCardElements(rootEl, ctx, sourceContent);
      } catch (err) {
        log.error("readingView prettifier error", err);
      }
    },
    1000,
  );

  // Start the global debounced MutationObserver to handle re-renders
  setupDebouncedMutationObserver();

  // Expose manual trigger and event hook
  setupManualTrigger();

  // Listen for prettify-cards-refresh event on each markdown view's containerEl
  function attachRefreshListenerToMarkdownViews() {
    // Attach to the actual markdown content container, not just workspace-leaf-content
    const leafContents = Array.from(document.querySelectorAll<HTMLElement>(
      ".workspace-leaf-content[data-type='markdown']"
    ));
    for (const leaf of leafContents) {
      // Find the markdown content area inside the leaf
      const content = leaf.querySelector<HTMLElement>(
        ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section"
      );
      if (content) {
        content.removeEventListener("sprout:prettify-cards-refresh", handleRefreshEvent);
        content.addEventListener("sprout:prettify-cards-refresh", handleRefreshEvent);
        log.debug("Attached sprout:prettify-cards-refresh listener to", content);
      }
    }
  }

  function handleRefreshEvent(e: Event) {
    log.debug("sprout:prettify-cards-refresh event received", e);

    // Re-sync the dynamic <style> element (colours, fonts, layout, card mode)
    syncReadingViewStyles();

    // Get current prettify style
    let prettifyStyle: string = "accent";
    try {
      const activePlugin = getSproutPlugin();
      if (activePlugin?.settings?.general?.prettifyCards) {
        prettifyStyle = activePlugin.settings.general.prettifyCards;
      }
    } catch (e) { log.swallow("read prettify plugin setting", e); }

    const root = (e.currentTarget instanceof HTMLElement)
      ? e.currentTarget
      : (e.target instanceof HTMLElement ? e.target : null);

    // When prettify is off, remove all pretty-card styling so raw markdown shows
    if (prettifyStyle === "off") {
      if (root) {
        const cards = Array.from(root.querySelectorAll<HTMLElement>(".sprout-pretty-card"));
        for (const card of cards) {
          card.classList.remove("sprout-pretty-card", "sprout-reading-card", "sprout-reading-view-wrapper", "theme", "accent");
        }
      }
      return;
    }

    if (!root) {
      void processCardElements(document.documentElement, undefined, '');
      return;
    }

    // Update prettify style class on all cards (accent ↔ theme)
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".sprout-pretty-card"));
    for (const card of cards) {
      card.classList.remove("theme", "accent");
      card.classList.add(prettifyStyle === "theme" ? "theme" : "accent");
    }

  }

  // Attach listeners on load and after mutation observer runs
  attachRefreshListenerToMarkdownViews();
  // Re-attach listeners after mutation observer triggers DOM changes
  // (handled inline in the mutation observer callback via attachRefreshListenerToMarkdownViews)
}

/* =========================
   Styles + helpers
   ========================= */

// Styles are loaded from styles.css (see src/styles/pretty-cards.css)
function injectStylesOnce() {
  // no-op: CSS is now in styles.css via the Tailwind/PostCSS pipeline
}

/* =========================
   Manual trigger + event hook
   ========================= */

function setupManualTrigger() {
  window.sproutApplyMasonryGrid = () => {
    debugLog('[Sprout] Manual sproutApplyMasonryGrid() called');
    requestAnimationFrame(() => {
      void processCardElements(document.documentElement, undefined, '');
    });
  };

  addTrackedWindowListener('sprout-cards-inserted', () => {
    debugLog('[Sprout] Received sprout-cards-inserted event — re-processing cards');
    window.sproutApplyMasonryGrid?.();
  });

  debugLog('[Sprout] Manual trigger and event hook installed');
}

/* =========================
   Debounced MutationObserver
   ========================= */

let mutationObserver: MutationObserver | null = null;
let debounceTimer: number | null = null;
const DEBOUNCE_MS = 120;

// Registered window listeners (stored for cleanup)
let registeredWindowListeners: Array<{ event: string; handler: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }> = [];

function addTrackedWindowListener(
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  window.addEventListener(event, handler, options);
  registeredWindowListeners.push({ event, handler, options });
}

/** Tear down all module-level state. Called from plugin.onunload(). */
export function teardownReadingView(): void {
  // Disconnect MutationObserver
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // Remove all tracked window listeners
  for (const { event, handler, options } of registeredWindowListeners) {
    window.removeEventListener(event, handler, options as boolean | EventListenerOptions | undefined);
  }
  registeredWindowListeners = [];
  // Clear global references
  sproutPluginRef = null;
  delete (window as unknown as Record<string, unknown>).sproutApplyMasonryGrid;
  // Remove dynamic style element
  document.getElementById(DYNAMIC_STYLE_ID)?.remove();
}

function setupDebouncedMutationObserver() {
  if (mutationObserver) {
    debugLog('[Sprout] MutationObserver already running');
    return;
  }

  mutationObserver = new MutationObserver((mutations) => {
    // Collect specific containers that have new unprocessed .el-p elements
    const dirtyContainers = new Set<HTMLElement>();
    for (const m of mutations) {
      // Only watch for added nodes (new content), ignore removals and repositioning
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        for (const n of Array.from(m.addedNodes)) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element;
            // Only trigger if we see actual NEW .el-p or sprout cards
            // Skip if the added node is just being moved (check if it already has sprout-processed)
            if (el.matches && el.matches('.el-p') && !el.hasAttribute('data-sprout-processed')) {
              // Find the closest section or reading view container
              const section = el.closest('.markdown-preview-section') as HTMLElement;
              if (section) dirtyContainers.add(section);
              else dirtyContainers.add(el as HTMLElement);
            } else if (queryFirst(el as ParentNode, '.el-p:not([data-sprout-processed])')) {
              dirtyContainers.add(el as HTMLElement);
            }
          }
        }
      }
    }

    if (dirtyContainers.size === 0) return;

    if (debounceTimer) window.clearTimeout(debounceTimer);
    // Capture the containers before the timeout (they're DOM nodes, so references stay valid)
    const containers = Array.from(dirtyContainers);
    debounceTimer = window.setTimeout(() => {
      try {
        debugLog('[Sprout] MutationObserver triggered — processing', containers.length, 'dirty containers');
        for (const container of containers) {
          // Only process if the container is still in the DOM
          if (container.isConnected) {
            void processCardElements(container, undefined, '');
          }
        }
      } catch (err) {
        log.error('MutationObserver handler error', err);
      } finally {
        debounceTimer = null;
      }
    }, DEBOUNCE_MS);
  });

  const body = document.body;
  if (body) {
    // Only observe childList (DOM structure) changes, not attributes (styles, sizes)
    mutationObserver.observe(body, { 
      childList: true, 
      subtree: true, 
      attributes: false,
      characterData: false // Also ignore text content changes
    });
    debugLog('[Sprout] MutationObserver attached to document.body');
  } else {
    debugLog('[Sprout] document.body not available for MutationObserver');
  }
}

/* =========================
   Card processing
   ========================= */

async function processCardElements(container: HTMLElement, _ctx?: MarkdownPostProcessorContext, sourceContent?: string) {
  // Skip card prettification entirely when prettify is off
  try {
    const pluginCheck = getSproutPlugin();
    const stylesEnabled = pluginCheck?.settings?.general?.enableReadingStyles ?? pluginCheck?.settings?.general?.prettifyCards !== "off";
    if (!stylesEnabled) {
      debugLog('[Sprout] Prettify cards is off — skipping card processing');
      return;
    }
  } catch { /* proceed if we can't read settings */ }

  // If no source content provided, try to read it from the active file
  if (!sourceContent) {
    try {
      const plugin = getSproutPlugin();
      if (plugin) {
        const activeFile = plugin.app.workspace?.getActiveFile?.();
        if (activeFile instanceof TFile && activeFile.extension === 'md') {
          sourceContent = await plugin.app.vault.read(activeFile);
        }
      }
    } catch (e) {
      debugLog('[Sprout] Could not read source file in processCardElements:', e);
    }
  }

  const found: HTMLElement[] = [];

  try {
    if (container.matches && container.matches('.el-p')) found.push(container);
  } catch {
    // ignore
  }

  container.querySelectorAll<HTMLElement>('.el-p:not([data-sprout-processed])').forEach(el => found.push(el));

  if (found.length === 0) {
    debugLog('[Sprout] No unprocessed .el-p elements found in container');
    return;
  }

  debugLog(`[Sprout] Found ${found.length} potential card elements to parse`);

  for (const el of found) {
    try {
      // skip editor content
      if (el.closest('.cm-content')) continue;

      // Extract anchor ID first to find the card in source
      let rawText = extractRawTextFromParagraph(el);
      const rawClean = clean(rawText);
      const anchorMatch = rawClean.match(ANCHOR_RE);
      if (!anchorMatch) continue;
      
      const anchorId = anchorMatch[1];
      
      // If we have source content, try to extract the card from it
      if (sourceContent) {
        const cardFromSource = extractCardFromSource(sourceContent, anchorId);
        if (cardFromSource) {
          rawText = cardFromSource;
        }
      }

      const card = parseSproutCard(rawText);
      if (!card) continue;

      el.dataset.sproutProcessed = 'true';

      enhanceCardElement(el, card, undefined, rawText);
    } catch (err) {
      log.error('Error processing element', err);
    }
  }

  // ── Apply reading view layout settings to sections containing cards ──
  try {
    const plugin = getSproutPlugin();
    const rvSettings = plugin?.settings?.readingView;
    if (rvSettings) {
      // Find all sections that contain pretty cards and apply layout
      const sections = new Set<HTMLElement>();
      container.querySelectorAll<HTMLElement>('.sprout-pretty-card').forEach(card => {
        const section = card.closest('.markdown-preview-section') as HTMLElement;
        if (section) sections.add(section);
      });
      // Also check if container itself is a section
      if (container.classList.contains('markdown-preview-section') && container.querySelector('.sprout-pretty-card')) {
        sections.add(container);
      }

      for (const section of sections) {
        // Layout: vertical vs masonry
        if (rvSettings.layout === 'vertical') {
          section.classList.add('sprout-layout-vertical');
          section.classList.remove('sprout-layout-masonry');
        } else {
          section.classList.remove('sprout-layout-vertical');
          section.classList.add('sprout-layout-masonry');
        }

      }
    }
  } catch (e) {
    log.swallow('apply reading view settings', e);
  }

  await Promise.resolve();

}

/* =========================
   FLIP animation for masonry reflow
   ========================= */

const FLIP_DURATION = 280; // ms

/**
 * Snapshot the bounding rect of every visible `.sprout-pretty-card` inside
 * the closest masonry section.  Returns a Map keyed by element.
 */
function snapshotCardPositions(cardEl: HTMLElement): Map<HTMLElement, DOMRect> {
  const section = cardEl.closest('.markdown-preview-section');
  if (!section) return new Map();
  const positions = new Map<HTMLElement, DOMRect>();
  section.querySelectorAll<HTMLElement>('.sprout-pretty-card').forEach(card => {
    if (card.offsetParent !== null) { // visible
      positions.set(card, card.getBoundingClientRect());
    }
  });
  return positions;
}

/**
 * FLIP animate cards from their old positions to their new positions.
 * Call this AFTER the DOM change has been made and the browser has reflowed.
 *
 * @param before — Map returned by `snapshotCardPositions()` before the change
 */
function flipAnimateCards(before: Map<HTMLElement, DOMRect>) {
  if (before.size === 0) return;

  // "Last" — read the new positions
  for (const [card, oldRect] of before) {
    const newRect = card.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;

    // Skip cards that haven't moved
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    // "Invert" — move card back to where it was
    card.classList.add('sprout-flip-animating', 'sprout-flip-no-transition');
    setCssProps(card, {
      '--sprout-flip-x': `${dx}px`,
      '--sprout-flip-y': `${dy}px`,
      '--sprout-flip-duration': `${FLIP_DURATION}ms`,
    });

    // Force reflow so the inverted position is painted
    void card.offsetHeight;

    // "Play" — animate from inverted position to final (transform: none)
    card.classList.remove('sprout-flip-no-transition');
    setCssProps(card, {
      '--sprout-flip-x': '0px',
      '--sprout-flip-y': '0px',
    });
  }

  // Clean up transition style after animation ends
  const cleanup = () => {
    for (const [card] of before) {
      card.classList.remove('sprout-flip-animating', 'sprout-flip-no-transition');
      setCssProps(card, {
        '--sprout-flip-x': null,
        '--sprout-flip-y': null,
        '--sprout-flip-duration': null,
      });
    }
  };
  setTimeout(cleanup, FLIP_DURATION + 20);
}

/* =========================
   Sibling hiding
   ========================= */

/**
 * Strip markdown formatting characters so that raw source text and
 * Obsidian-rendered DOM text can be compared reliably.
 * Removes: bold (**), italic (*), cloze delimiters ({{c1:: … }}),
 *          wiki-link brackets ([[…]]), image embeds (![[…]]),
 *          and normalises whitespace.
 */
function stripMarkdownFormatting(s: string): string {
  let out = s;
  // Remove cloze wrappers: {{c1:: … }} → content
  out = out.replace(/\{\{c\d+::/g, "");
  out = out.replace(/\}\}/g, "");
  // Remove image embeds ![[...]]
  out = out.replace(/!\[\[[^\]]*\]\]/g, "");
  // Remove wiki-link brackets [[target|display]] → display, [[target]] → target
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  out = out.replace(/\[\[([^\]]+)\]\]/g, "$1");
  // Remove bold / italic markers (must strip ** before * to avoid leftovers)
  out = out.replace(/\*{2,}/g, "");
  out = out.replace(/\*/g, "");
  // Remove underscore italic markers (word-boundary only to avoid variable_names)
  out = out.replace(/(?<!\w)_|_(?!\w)/g, "");
  // Remove strikethrough ~~, highlight ==
  out = out.replace(/~~/g, "");
  out = out.replace(/==/g, "");
  // Remove delimiter field terminators and field keys like "I<d>" at the start
  out = out.replace(new RegExp(escapeDelimiterRe(), "g"), "");
  // Collapse whitespace
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/**
 * Check if a sibling's text is part of the card's raw source.
 * Compares stripped-markdown versions of both to account for Obsidian
 * rendering bold/italic/cloze markers into styled HTML.
 */
function siblingTextBelongsToCard(
  siblingText: string,
  cardTextStripped: string,
  cardTextNorm: string,
  cardMathSig: string,
  siblingEl: Element,
): boolean {
  const rawNorm = clean(siblingText).replace(/\s+/g, " ").trim();
  if (!rawNorm) return true; // Empty siblings between card paragraphs — safe to hide

  // Direct substring match (handles cases without formatting)
  if (cardTextNorm && cardTextNorm.includes(rawNorm)) {
    return true;
  }

  // Stripped-markdown comparison: strip formatting from both sides
  const sibStripped = stripMarkdownFormatting(rawNorm);
  if (cardTextStripped && sibStripped && cardTextStripped.includes(sibStripped)) {
    return true;
  }

  // MathJax comparison
  const hasMath = !!queryFirst(siblingEl, '.math, mjx-container, mjx-math');
  if (hasMath && cardMathSig) {
    const rawMathSig = normalizeMathSignature(rawNorm);
    if (rawMathSig && cardMathSig.includes(rawMathSig)) {
      return true;
    }
  }

  // Heuristic: if the sibling text looks like card field remnants
  // (contains delimited fields, cloze syntax, or field keys),
  // it's almost certainly leftover from the card being split.
  const delimEsc = escapeDelimiterRe();
  const looksLikeCardContent =
    /\{\{c\d+::/.test(siblingText) ||
    new RegExp(`^\\s*[A-Z]{1,3}\\s*${delimEsc}`).test(siblingText) ||
    new RegExp(`\\}\\}\\s*${delimEsc}`).test(siblingText);
  if (looksLikeCardContent) {
    return true;
  }

  return false;
}

/**
 * Hide duplicate siblings after individual cards.
 * Obsidian's reading-view renderer splits card blocks at blank lines,
 * creating sibling `.el-p` / `.el-ol` / `.el-ul` elements that duplicate
 * content already rendered inside the pretty-card.
 */
function hideCardSiblingElements(cardEl: HTMLElement, cardRawText?: string) {
  const cardTextNorm = cardRawText ? clean(cardRawText).replace(/\s+/g, " ").trim() : "";
  const cardTextStripped = cardTextNorm ? stripMarkdownFormatting(cardTextNorm) : "";
  const cardMathSig = cardTextNorm ? normalizeMathSignature(cardTextNorm) : "";
  
  let next = cardEl.nextElementSibling;
  const toHide: Element[] = [];
  
  while (next) {
    const classes = next.className || '';
    
    // Skip siblings already hidden by a previous run
    if (next.hasAttribute('data-sprout-hidden')) {
      next = next.nextElementSibling;
      continue;
    }
    
    // Stop if we hit another sprout card (already processed)
    if (classes.includes('sprout-pretty-card') || next.hasAttribute('data-sprout-processed')) {
      break;
    }
    
    // Stop if we hit a header
    if (classes.match(/\bel-h[1-6]\b/)) {
      break;
    }
    
    // Stop if we hit an anchor for the NEXT card (unprocessed .el-p with ^sprout-)
    if (classes.includes('el-p') && !classes.includes('sprout-pretty-card')) {
      const txt = extractRawTextFromParagraph(next as HTMLElement);
      const cleanTxt = clean(txt);
      if (ANCHOR_RE.test(cleanTxt) && !cleanTxt.includes(`^sprout-${cardEl.dataset.sproutId}`)) {
        break;
      }
    }

    // Extract text from the sibling, regardless of its element type
    let raw = "";
    if (classes.includes('el-p')) {
      raw = extractRawTextFromParagraph(next as HTMLElement);
    } else if (classes.includes('el-div')) {
      raw = extractTextWithLaTeX(next as HTMLElement);
    } else if (
      classes.includes('el-ol') ||
      classes.includes('el-ul') ||
      classes.includes('el-blockquote') ||
      classes.includes('el-table')
    ) {
      // For structural elements, check if their text belongs to the card
      raw = (next as HTMLElement).innerText || (next as HTMLElement).textContent || '';
    } else if (classes.includes('el-pre')) {
      // Code blocks — stop unless text is part of card
      raw = (next as HTMLElement).textContent || '';
    } else {
      // Unknown element type — try text content before giving up
      raw = (next as HTMLElement).textContent || '';
      if (!raw.trim()) {
        // Empty unknown elements — safe to hide
        toHide.push(next);
        next = next.nextElementSibling;
        continue;
      }
    }

    if (siblingTextBelongsToCard(raw, cardTextStripped, cardTextNorm, cardMathSig, next)) {
      toHide.push(next);
      next = next.nextElementSibling;
      continue;
    }

    // No match — stop hiding so normal content can render
    break;
  }
  
  // Hide collected elements with increased specificity
  for (const el of toHide) {
    (el as HTMLElement).classList.add('sprout-hidden-important');
    (el as HTMLElement).setAttribute('data-sprout-hidden', 'true');
  }
}

/* =========================
   Card enhancement
   ========================= */

function toTextField(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('\n').trim();
  return String(value ?? '').trim();
}

function buildMarkdownModeContent(card: SproutCard, showLabels: boolean): string {
  const lines: string[] = [];
  const addLine = (label: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    lines.push(showLabels ? `${label}: ${processMarkdownFeatures(v)}` : processMarkdownFeatures(v));
  };

  if (card.type === 'mcq') {
    const question = toTextField(card.fields.MCQ);
    const answer = toTextField(card.fields.A);
    const optionsRaw = Array.isArray(card.fields.O)
      ? card.fields.O
      : toTextField(card.fields.O).split('\n').map((s) => s.trim()).filter(Boolean);
    addLine('Question', question);

    const options = answer
      ? [answer, ...optionsRaw.filter((opt) => opt.trim() && opt.trim() !== answer.trim())]
      : optionsRaw;

    options.forEach((opt, idx) => {
      const safe = processMarkdownFeatures(opt);
      const line = idx === 0 && answer ? `${idx + 1}. <strong>${safe}</strong>` : `${idx + 1}. ${safe}`;
      lines.push(line);
    });
  } else if (card.type === 'oq') {
    addLine('Question', toTextField(card.fields.OQ));
    const fieldsAny = card.fields as Record<string, string | string[] | undefined>;
    for (let i = 1; i <= 20; i++) {
      const step = toTextField(fieldsAny[String(i)]);
      if (!step) continue;
      lines.push(`${i}. ${processMarkdownFeatures(step)}`);
    }
  } else if (card.type === 'cloze') {
    addLine('Question', toTextField(card.fields.CQ));
    addLine('Extra information', toTextField(card.fields.I));
  } else if (card.type === 'io') {
    addLine('Image occlusion', toTextField(card.fields.IO));
    addLine('Answer', toTextField(card.fields.A));
    addLine('Extra information', toTextField(card.fields.I));
  } else {
    const question = card.type === 'reversed' ? toTextField(card.fields.RQ) : toTextField(card.fields.Q);
    addLine('Question', question);
    addLine('Answer', toTextField(card.fields.A));
    addLine('Extra information', toTextField(card.fields.I));
  }

  const groups = Array.isArray(card.fields.G) ? card.fields.G : (card.fields.G ? [String(card.fields.G)] : []);
  if (groups.length) {
    const gText = groups.map((g) => processMarkdownFeatures(String(g))).join(', ');
    lines.push(showLabels ? `Groups: ${gText}` : gText);
  }

  return `<div class="sprout-markdown-lines">${lines.map((line) => `<div class="sprout-markdown-line">${line}</div>`).join('')}</div>`;
}

function buildFlashcardCloze(text: string, mode: 'front' | 'back'): string {
  const toInlineHtml = (value: string): string => {
    const html = processMarkdownFeatures(value);
    return html
      .replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/i, "$1")
      .replace(/<\/p>\s*<p>/gi, " ");
  };

  const source = String(text || '');
  const regex = /\{\{c\d+::([\s\S]*?)\}\}/g;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (match.index > last) out += toInlineHtml(source.slice(last, match.index));
    const ans = String(match[1] || '').trim();
    if (mode === 'front') out += `<span class="sprout-flashcard-blank">_____</span>`;
    else out += `<strong>${toInlineHtml(ans)}</strong>`;
    last = match.index + match[0].length;
  }
  if (last < source.length) out += toInlineHtml(source.slice(last));
  return out;
}

function buildFlashcardContentHTML(card: SproutCard, includeSpeakerButton: boolean): string {
  const idSeed = Math.random().toString(36).slice(2, 8);
  let front = '';
  let back = '';

  const actionsFor = (side: 'front' | 'back') => {
    const speaker = includeSpeakerButton
      ? `<button class="sprout-flashcard-action-btn sprout-flashcard-speak-btn" type="button" data-sprout-tts-side="${side}" data-tooltip="Read aloud" data-tooltip-position="top" aria-label="Read aloud"></button>`
      : '';
    return `<div class="sprout-flashcard-actions"><button class="sprout-flashcard-action-btn sprout-card-edit-btn" type="button" data-tooltip="Edit card" data-tooltip-position="top" aria-label="Edit card"></button>${speaker}</div>`;
  };

  const faceWrap = (side: 'front' | 'back', bodyHtml: string) => {
    const label = side === 'front' ? 'Question' : 'Answer';
    return `<div class="sprout-flashcard-face sprout-flashcard-face-${side}">
      <div class="sprout-flashcard-face-label">${label}</div>
      ${actionsFor(side)}
      <div class="sprout-flashcard-face-content">${bodyHtml}</div>
    </div>`;
  };

  if (card.type === 'cloze') {
    const cq = toTextField(card.fields.CQ);
    front = buildFlashcardCloze(cq, 'front');
    back = buildFlashcardCloze(cq, 'back');
  } else if (card.type === 'io') {
    front = `<div class="sprout-flashcard-io" id="sprout-io-question-${idSeed}"></div>`;
    back = `<div class="sprout-flashcard-io" id="sprout-io-answer-${idSeed}"></div>`;
  } else if (card.type === 'mcq') {
    const q = toTextField(card.fields.MCQ);
    const answer = toTextField(card.fields.A);
    const options = Array.isArray(card.fields.O)
      ? card.fields.O
      : toTextField(card.fields.O).split('\n').map((s) => s.trim()).filter(Boolean);
    front = `<div>${processMarkdownFeatures(q)}</div>${options.length ? `<div class="sprout-flashcard-options">${options.map((opt, i) => `<div>${String.fromCharCode(65 + i)}. ${processMarkdownFeatures(opt)}</div>`).join('')}</div>` : ''}`;
    back = `<div><strong>${processMarkdownFeatures(answer)}</strong></div>`;
  } else if (card.type === 'oq') {
    const q = toTextField(card.fields.OQ);
    const fieldsAny = card.fields as Record<string, string | string[] | undefined>;
    const steps: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const step = toTextField(fieldsAny[String(i)]);
      if (!step) continue;
      steps.push(step);
    }
    front = `<div>${processMarkdownFeatures(q)}</div>`;
    back = `<div class="sprout-flashcard-options">${steps.map((s, i) => `<div>${i + 1}. ${processMarkdownFeatures(s)}</div>`).join('')}</div>`;
  } else {
    const q = card.type === 'reversed' ? toTextField(card.fields.RQ) : toTextField(card.fields.Q);
    const a = toTextField(card.fields.A);
    front = `<div>${processMarkdownFeatures(q)}</div>`;
    back = `<div>${processMarkdownFeatures(a)}</div>`;
  }

  const info = toTextField(card.fields.I);
  if (info && card.type !== 'cloze') {
    back += `<div class="sprout-flashcard-info">${processMarkdownFeatures(info)}</div>`;
  }

  const frontBodyClass = card.type === 'cloze'
    ? 'sprout-flashcard-body sprout-flashcard-body-cloze'
    : 'sprout-flashcard-body';
  const backBodyClass = card.type === 'cloze'
    ? 'sprout-flashcard-body sprout-flashcard-body-cloze'
    : 'sprout-flashcard-body';

  return `
    <div class="sprout-flashcard-question">${faceWrap('front', `<div class="${frontBodyClass}">${front}</div>`)}</div>
    <div class="sprout-flashcard-answer" hidden>${faceWrap('back', `<div class="${backBodyClass}">${back}</div>`)}</div>
  `;
}

function buildGroupsSectionHTML(groups: string[]): string {
  if (!groups.length) return '';
  const contentId = `sprout-groups-${Math.random().toString(36).slice(2, 8)}`;
  return `
    <div class="sprout-card-section sprout-section-groups">
      <div class="sprout-section-label">
        <span>Groups</span>
        <button class="sprout-toggle-btn sprout-toggle-btn-compact" data-target=".${contentId}" aria-expanded="false" data-tooltip="Toggle Groups" data-tooltip-position="top">
          <svg class="sprout-toggle-chevron sprout-toggle-chevron-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
        </button>
      </div>
      <div class="${contentId} sprout-collapsible collapsed sprout-p-spacing-none">
        <div class="sprout-groups-list">${groups.map(g => `<span class="sprout-group-tag">${processMarkdownFeatures(String(g))}</span>`).join('')}</div>
      </div>
    </div>
  `;
}

function applyCustomHookClasses(el: HTMLElement): void {
  if (!el.classList.contains('sprout-macro-custom')) return;

  el.classList.add('sprout-custom-root');
  const header = el.querySelector<HTMLElement>('.sprout-card-header');
  const title = el.querySelector<HTMLElement>('.sprout-card-title');
  const body = el.querySelector<HTMLElement>('.sprout-card-content');
  const groups = el.querySelector<HTMLElement>('.sprout-groups-list');

  header?.classList.add('sprout-custom-header');
  title?.classList.add('sprout-custom-title');
  body?.classList.add('sprout-custom-body');
  groups?.classList.add('sprout-custom-groups');

  el.querySelectorAll<HTMLElement>('.sprout-card-section').forEach((section) => {
    section.classList.add('sprout-custom-section');
    if (section.classList.contains('sprout-section-question')) section.classList.add('sprout-custom-section-question');
    if (section.classList.contains('sprout-section-options')) section.classList.add('sprout-custom-section-options');
    if (section.classList.contains('sprout-section-answer')) section.classList.add('sprout-custom-section-answer');
    if (section.classList.contains('sprout-section-info')) section.classList.add('sprout-custom-section-info');
    if (section.classList.contains('sprout-section-groups')) section.classList.add('sprout-custom-section-groups');
  });

  el.querySelectorAll<HTMLElement>('.sprout-section-label').forEach((label) => {
    label.classList.add('sprout-custom-label');
  });

  el.querySelectorAll<HTMLElement>('.sprout-section-content').forEach((content) => {
    content.classList.add('sprout-custom-content');
  });
}

function setupGuidebookCarousel(el: HTMLElement) {
  if (!el.classList.contains('sprout-macro-guidebook')) return;
  const content = el.querySelector<HTMLElement>('.sprout-card-content');
  if (!content) return;

  const slides = Array.from(content.querySelectorAll<HTMLElement>('.sprout-card-section'));
  if (slides.length <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'sprout-guidebook-nav sprout-guidebook-nav-prev';
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Previous section');
  prevBtn.textContent = '‹';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'sprout-guidebook-nav sprout-guidebook-nav-next';
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Next section');
  nextBtn.textContent = '›';

  const dots = document.createElement('div');
  dots.className = 'sprout-guidebook-dots';
  const dotEls = slides.map((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'sprout-guidebook-dot';
    dot.type = 'button';
    dot.setAttribute('aria-label', `Go to section ${i + 1}`);
    dots.appendChild(dot);
    return dot;
  });

  const updateDots = () => {
    const center = content.scrollLeft + content.clientWidth / 2;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    slides.forEach((slide, idx) => {
      const slideCenter = slide.offsetLeft + slide.clientWidth / 2;
      const dist = Math.abs(slideCenter - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    });
    dotEls.forEach((d, idx) => d.classList.toggle('is-active', idx === best));
  };

  const scrollToIndex = (idx: number) => {
    const slide = slides[Math.max(0, Math.min(slides.length - 1, idx))];
    if (!slide) return;
    content.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });
  };

  prevBtn.addEventListener('click', () => {
    const current = dotEls.findIndex((d) => d.classList.contains('is-active'));
    scrollToIndex(Math.max(0, current - 1));
  });
  nextBtn.addEventListener('click', () => {
    const current = dotEls.findIndex((d) => d.classList.contains('is-active'));
    scrollToIndex(Math.min(slides.length - 1, Math.max(0, current) + 1));
  });

  dotEls.forEach((dot, idx) => {
    dot.addEventListener('click', () => scrollToIndex(idx));
  });

  content.addEventListener('scroll', updateDots, { passive: true });
  updateDots();

  const wrap = document.createElement('div');
  wrap.className = 'sprout-guidebook-controls';
  wrap.appendChild(prevBtn);
  wrap.appendChild(dots);
  wrap.appendChild(nextBtn);
  el.appendChild(wrap);
}

function setupFlashcardFlip(el: HTMLElement) {
  if (!el.classList.contains('sprout-macro-flashcards')) return;
  const question = el.querySelector<HTMLElement>('.sprout-flashcard-question');
  const answer = el.querySelector<HTMLElement>('.sprout-flashcard-answer');
  if (!question || !answer) return;

  let showingAnswer = false;

  const applyFaceState = () => {
    question.hidden = showingAnswer;
    answer.hidden = !showingAnswer;
    el.classList.toggle('sprout-flashcard-flipped', showingAnswer);
  };

  const recalcHeight = () => {
    const prevQHidden = question.hidden;
    const prevAHidden = answer.hidden;
    question.hidden = false;
    answer.hidden = false;

    const maxH = Math.max(question.scrollHeight, answer.scrollHeight, 120);

    question.hidden = prevQHidden;
    answer.hidden = prevAHidden;

    setCssProps(el, { '--sprout-flashcard-height': `${Math.ceil(maxH)}px` });
  };

  el.addEventListener('click', (ev: Event) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest('.sprout-card-edit-btn, .sprout-flashcard-speak-btn')) return;
    if (el.classList.contains('sprout-flashcard-animating')) return;

    el.classList.add('sprout-flashcard-animating');
    window.setTimeout(() => {
      showingAnswer = !showingAnswer;
      applyFaceState();
    }, 180);
    window.setTimeout(() => {
      el.classList.remove('sprout-flashcard-animating');
    }, 360);
  });

  applyFaceState();
  window.setTimeout(recalcHeight, 0);
  window.setTimeout(recalcHeight, 120);
}

function enhanceCardElement(
  el: HTMLElement,
  card: SproutCard,
  originalContentOverride?: string,
  cardRawText?: string,
) {
  const originalContent = originalContentOverride ?? el.innerHTML;
  el.replaceChildren();

  // Determine reading style from plugin instance (Obsidian context)
  let macroPreset: ReturnType<typeof normaliseMacroPreset> = 'flashcards';
  let visibleFields: NonNullable<ReadingViewSettings>["visibleFields"] | undefined;
  let displayLabels = true;
  let ttsEnabled = false;
  let audioSettings: AudioSettings | null = null;
  try {
    const activePlugin = getSproutPlugin();
    const stylesEnabled = activePlugin?.settings?.general?.enableReadingStyles ?? activePlugin?.settings?.general?.prettifyCards !== "off";
    if (!stylesEnabled) {
      replaceChildrenWithHTML(el, originalContent);
      return;
    }
    macroPreset = normaliseMacroPreset((activePlugin?.settings?.readingView?.activeMacro as string | undefined) ?? activePlugin?.settings?.readingView?.preset);
    const macroConfig =
      macroPreset === 'classic'
        ? activePlugin?.settings?.readingView?.macroConfigs?.classic
        : macroPreset === 'guidebook'
          ? activePlugin?.settings?.readingView?.macroConfigs?.guidebook
          : macroPreset === 'markdown'
            ? activePlugin?.settings?.readingView?.macroConfigs?.markdown
            : macroPreset === 'custom'
              ? activePlugin?.settings?.readingView?.macroConfigs?.custom
              : activePlugin?.settings?.readingView?.macroConfigs?.flashcards;

    visibleFields = macroConfig?.fields ?? activePlugin?.settings?.readingView?.visibleFields;
    displayLabels = macroConfig?.fields?.labels ?? activePlugin?.settings?.readingView?.displayLabels !== false;
    ttsEnabled = !!activePlugin?.settings?.audio?.enabled;
    audioSettings = activePlugin?.settings?.audio ?? null;
  } catch (e) { log.swallow("read prettify plugin setting", e); }

  el.classList.add(
    'sprout-pretty-card',
    'sprout-reading-card',
    'sprout-reading-view-wrapper',
    'accent',
    `sprout-macro-${macroPreset}`,
  );

  el.dataset.sproutId = card.anchorId;
  el.dataset.sproutType = card.type;
  
  // Store raw text for masonry grid sibling hiding
  if (cardRawText) {
    el.setAttribute('data-sprout-raw-text', cardRawText);
  }

  // ── Build groups HTML (always rendered; visibility controlled by dynamic CSS) ──
  let groupsHtml = '';
  const groups = card.fields.G;
  if (groups) {
    const groupArr = Array.isArray(groups) ? groups : [groups];
    if (groupArr.length > 0) {
      groupsHtml = macroPreset === 'classic'
        ? buildGroupsSectionHTML(groupArr)
        : `<div class="sprout-groups-list">${groupArr.map(g => `<span class="sprout-group-tag">${processMarkdownFeatures(String(g))}</span>`).join('')}</div>`;
    }
  }

  const cardContentHTML = macroPreset === 'markdown'
    ? buildMarkdownModeContent(card, displayLabels)
    : macroPreset === 'flashcards'
      ? buildFlashcardContentHTML(card, ttsEnabled)
      : buildCardContentHTML(card);

    const headerHTML = macroPreset === 'flashcards'
      ? ``
      : `<div class="sprout-card-header sprout-reading-card-header"><div class="sprout-card-title sprout-reading-card-title">${processMarkdownFeatures(card.title || '')}</div><span class="sprout-card-edit-btn" role="button" data-tooltip="Edit card" data-tooltip-position="top" tabindex="0"></span></div>`;

    const innerHTML = `
      ${headerHTML}

      <div class="sprout-card-content sprout-reading-card-content">
        ${cardContentHTML}
      </div>

      ${groupsHtml}

      <div class="sprout-original-content" aria-hidden="true">${originalContent}</div>
    `;

  replaceChildrenWithHTML(el, innerHTML);
  el.classList.add('sprout-single-card');
  applyCustomHookClasses(el);

  // Included-data toggles are applied as data attributes for CSS hooks
  const isFlashcardsMacro = macroPreset === 'flashcards';
  el.toggleAttribute('data-hide-title', isFlashcardsMacro || visibleFields?.title === false);
  if (visibleFields) {
    el.toggleAttribute('data-hide-question', visibleFields.question === false);
    el.toggleAttribute('data-hide-options', visibleFields.options === false);
    el.toggleAttribute('data-hide-answer', visibleFields.answer === false);
    el.toggleAttribute('data-hide-info', visibleFields.info === false);
    el.toggleAttribute('data-hide-groups', visibleFields.groups === false);
    el.toggleAttribute('data-hide-edit', visibleFields.edit === false);
  }
  el.toggleAttribute('data-hide-labels', !displayLabels);

  // Hide any sibling elements that were part of this card's content
  // (Obsidian renders block math as separate <div class="el-div"> siblings)
  hideCardSiblingElements(el, cardRawText);

  if (macroPreset === 'guidebook') setupGuidebookCarousel(el);
  if (macroPreset === 'flashcards') setupFlashcardFlip(el);

  // Hook up internal links
  const internalLinks = el.querySelectorAll<HTMLAnchorElement>('a.internal-link');
  internalLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('data-href');
      if (href) {
        // Use Obsidian's app to open the link
        const app = window.app;
        if (app?.workspace?.openLinkText) {
          const sourcePath = app.workspace?.getActiveFile?.()?.path ?? '';
          void app.workspace.openLinkText(href, sourcePath, true);
        }
      }
    });
  });

  // Hook up edit button in card header
  const editBtns = Array.from(el.querySelectorAll<HTMLElement>(".sprout-card-edit-btn"));
  for (const editBtn of editBtns) {
    setIcon(editBtn, "pencil");
    editBtn.tabIndex = 0;
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const plugin = getSproutPlugin();
      if (!plugin) {
        new Notice("Sprout plugin not found.");
        return;
      }

      const cardsMap = plugin.store?.data?.cards ?? {};
      const cardId = String(card.anchorId || "");
      let targetCard = cardsMap[cardId];

      if (!targetCard) {
        new Notice("Card not found.");
        return;
      }

      // If this is a cloze child, edit the parent cloze instead
      if (targetCard.type === "cloze-child") {
        const parentId = String(targetCard.parentId || "");
        if (!parentId) {
          new Notice("Cannot edit cloze child: missing parent card.");
          return;
        }
        const parentCard = cardsMap[parentId];
        if (!parentCard) {
          new Notice("Cannot edit cloze child: parent card not found.");
          return;
        }
        targetCard = parentCard;
      }

      // IO cards open the image occlusion editor instead of the generic editor
      if (targetCard.type === "io") {
        ImageOcclusionCreatorModal.openForParent(plugin as unknown as SproutPlugin, String(targetCard.id), {
          onClose: () => {
            if (typeof plugin.refreshAllViews === "function") {
              plugin.refreshAllViews();
            }
          },
        });
        return;
      }

      void openBulkEditModalForCards(plugin as unknown as SproutPlugin, [targetCard], async (updatedCards) => {
        if (!updatedCards.length) return;

        try {
          const updatedCard = updatedCards[0];
          const file = plugin.app.vault.getAbstractFileByPath(updatedCard.sourceNotePath);
          if (!(file instanceof TFile)) {
            throw new Error(`Source note not found: ${updatedCard.sourceNotePath}`);
          }

          const text = await plugin.app.vault.read(file);
          const lines = text.split(/\r?\n/);

          const { start, end } = findCardBlockRangeById(lines, updatedCard.id);
          const block = buildCardBlockMarkdown(updatedCard.id, updatedCard);
          lines.splice(start, end - start, ...block);

          await plugin.app.vault.modify(file, lines.join("\n"));

          // Resync database + refresh views
          if (typeof plugin.syncBank === "function") {
            await plugin.syncBank();
          }
          if (typeof plugin.refreshAllViews === "function") {
            plugin.refreshAllViews();
          }

          // Update the pretty-card content in-place
          try {
            const original = el.querySelector<HTMLElement>(".sprout-original-content")?.innerHTML ?? "";
            const rec = updatedCard;
            const sproutCard: SproutCard = {
              anchorId: String(rec.id || cardId),
              type: (String(rec.type || "basic").toLowerCase() as SproutCard["type"]),
              title: String(rec.title || ""),
              fields: {
                T: rec.title || "",
                Q: rec.q || "",
                A: rec.a || "",
                CQ: rec.clozeText || "",
                MCQ: rec.stem || "",
                O: Array.isArray(rec.options) ? rec.options : [],
                I: rec.info || "",
              },
            };
            if (sproutCard.type === "mcq") {
              const options = Array.isArray(rec.options) ? rec.options : [];
              const correctIndex = Number.isFinite(rec.correctIndex)
                ? Number(rec.correctIndex)
                : -1;
              sproutCard.fields.A = correctIndex >= 0 && options[correctIndex] ? options[correctIndex] : "";
              sproutCard.fields.O = options;
            }
            enhanceCardElement(el, sproutCard, original);
          } catch (e) {
            log.warn("Failed to refresh pretty-card DOM after edit", e);
          }

          // Nudge current markdown view to refresh pretty cards
          try {
            plugin.app.workspace.trigger("file-open", file);
          } catch (e) { log.swallow("trigger file-open after edit", e); }

          setTimeout(() => {
            document
              .querySelectorAll<HTMLElement>(
                ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
              )
              .forEach((node) => node.dispatchEvent(new Event("sprout:prettify-cards-refresh")));
          }, 50);
        } catch (err: unknown) {
          log.error("Failed to update card from reading view", err);
          new Notice(`Failed to update card: ${err instanceof Error ? err.message : String(err)}`);  
        }
      });
    });

    editBtn.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      editBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    editBtn.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      (ev.currentTarget as HTMLElement)?.click();
    });
  }

  const speakBtns = Array.from(el.querySelectorAll<HTMLElement>(".sprout-flashcard-speak-btn"));
  for (const speakBtn of speakBtns) {
    setIcon(speakBtn, "volume-2");
    speakBtn.tabIndex = 0;
    speakBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!ttsEnabled || !audioSettings?.enabled) return;

      const side = ((e.currentTarget as HTMLElement).getAttribute("data-sprout-tts-side") === "back") ? "back" : "front";
      const panelSelector = side === "back" ? ".sprout-flashcard-answer" : ".sprout-flashcard-question";
      const panel = el.querySelector<HTMLElement>(panelSelector);
      if (!panel) return;

      const panelText = (panel.innerText || panel.textContent || "").replace(/\s+/g, " ").trim();
      const imageAlt = Array.from(panel.querySelectorAll<HTMLImageElement>("img[alt]")).map((img) => (img.alt || "").trim()).filter(Boolean).join(" ");
      const raw = [panelText, imageAlt].filter(Boolean).join(" ").trim();
      const text = (el.dataset.sproutType === "cloze" && side === "front")
        ? raw.replace(/_+/g, " blank ").replace(/\s+/g, " ").trim()
        : raw;
      if (!text) return;

      const tts = getTtsService();
      if (!tts.isSupported) return;
      const mergedAudio = {
        ...DEFAULT_SETTINGS.audio,
        ...(audioSettings ?? {}),
        scriptLanguages: {
          ...DEFAULT_SETTINGS.audio.scriptLanguages,
          ...(audioSettings?.scriptLanguages ?? {}),
        },
      };
      tts.speakBasicCard(text, mergedAudio);
    });

    speakBtn.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      (ev.currentTarget as HTMLElement)?.click();
    });
  }

  // Hook up toggles inside this card
  const toggles = el.querySelectorAll<HTMLButtonElement>('.sprout-toggle-btn');
  toggles.forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (!target) return;
    const content = el.querySelector<HTMLElement>(target);
    if (!content) return;
    const section = btn.closest('.sprout-card-section');
    const isAnswer = !!section?.classList.contains('sprout-section-answer');
    const isGroups = !!section?.classList.contains('sprout-section-groups');
    const isInfo = !!section?.classList.contains('sprout-section-info');
    const defaultExpanded =
      macroPreset === 'guidebook' || macroPreset === 'markdown'
        ? true
        : macroPreset === 'classic'
          ? !(isAnswer || isGroups || isInfo)
          : false;

    content.classList.add('sprout-collapsible');
    content.classList.toggle('collapsed', !defaultExpanded);
    content.classList.toggle('expanded', defaultExpanded);
    btn.setAttribute('aria-expanded', defaultExpanded ? 'true' : 'false');
    const chevron = btn.querySelector<HTMLElement>('.sprout-toggle-chevron');
    if (chevron) {
      chevron.classList.toggle('sprout-reading-chevron-collapsed', !defaultExpanded);
    }
    const isFlashcards = el.classList.contains('sprout-macro-flashcards');
    if (isFlashcards) {
      setCssProps(btn, 'display', 'none');
      return;
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const expanded = btn.getAttribute('aria-expanded') === 'true';

      // FLIP step 1: snapshot all sibling card positions before the change
      const before = snapshotCardPositions(el);

      if (expanded) {
        content.classList.remove('expanded');
        content.classList.add('collapsed');
        btn.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.classList.add('sprout-reading-chevron-collapsed');
      } else {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.classList.remove('sprout-reading-chevron-collapsed');
      }

      // FLIP step 2: after the browser reflows, animate cards
      // from their old positions to their new ones
      requestAnimationFrame(() => {
        flipAnimateCards(before);
      });
    });
  });

  // Render MathJax if present
  void renderMdInElements(el, card);
}

/* =========================
   Markdown rendering in card elements
   ========================= */

async function renderMdInElements(el: HTMLElement, card: SproutCard) {
  const app = window.app;
  if (!app) return;
  
  // Get the plugin instance to use as component parent
  const plugin = getSproutPlugin();
  if (!plugin) return;
  
  // Source path for resolving images/links
  const sourcePath = app.workspace?.getActiveFile?.()?.path ?? '';

  // Create a temporary component for rendering to avoid memory leaks
  const component = plugin.addChild(new Component());
  
  try {
    // Render markdown for Basic card Q/A fields using the card data directly
    if (card.type === 'basic' || card.type === 'reversed') {
      const qField = card.type === 'reversed' ? card.fields.RQ : card.fields.Q;
      const qText = Array.isArray(qField) ? qField.join('\n') : qField;
      const aText = Array.isArray(card.fields.A) ? card.fields.A.join('\n') : card.fields.A;
      
      // Find Q/A elements by ID pattern
      const qEl = queryFirst(el, '[id^="sprout-q-"]');
      const aEl = queryFirst(el, '[id^="sprout-a-"]');
      
      if (qEl && qText) {
        try {
          await MarkdownRenderer.render(app, qText, qEl as HTMLElement, sourcePath, component);
          resolveUnloadedEmbeds(qEl as HTMLElement, app, sourcePath);
        } catch {
          qEl.textContent = qText;
        }
      }
      
      if (aEl && aText) {
        try {
          await MarkdownRenderer.render(app, aText, aEl as HTMLElement, sourcePath, component);
          resolveUnloadedEmbeds(aEl as HTMLElement, app, sourcePath);
        } catch {
          aEl.textContent = aText;
        }
      }
    }

    // Render IO cards: masked image (question) + full image (answer)
    if (card.type === 'io') {
      renderIoInReadingCard(el, card, plugin, sourcePath);
    }
    
    // Render markdown for Info fields (all card types)
    const iText = Array.isArray(card.fields.I) ? card.fields.I.join('\n') : card.fields.I;
    if (iText) {
      const iEl = queryFirst(el, '[id^="sprout-i-"]');
      if (iEl) {
        try {
          await MarkdownRenderer.render(app, iText, iEl as HTMLElement, sourcePath, component);
          // Resolve any unloaded internal-embed spans that MarkdownRenderer
          // created but didn't fully load (common for images in detached components)
          resolveUnloadedEmbeds(iEl as HTMLElement, app, sourcePath);
        } catch {
          iEl.textContent = iText;
        }
      }
    }
  } finally {
    // Remove the component to clean up any registered event handlers
    plugin.removeChild(component);
  }

  // Resolve any ![[image]] embed placeholders produced by processMarkdownFeatures
  // These appear in cloze, MCQ, and title fields as <img data-embed-path="...">
  resolveEmbeddedImages(el, app, sourcePath);
  
  // Render MathJax after markdown is processed
  renderMathInElement(el);
}

/**
 * Resolve unloaded internal-embed spans created by MarkdownRenderer.
 * When MarkdownRenderer.render runs in a detached component,
 * image embeds are created as <span class="internal-embed"> with src/alt
 * attributes but never get the `is-loaded` class or an actual <img> child.
 * This function finds those orphaned spans and converts them to real images.
 */
function resolveUnloadedEmbeds(
  container: HTMLElement,
  app: App,
  sourcePath: string,
) {
  const embeds = container.querySelectorAll<HTMLElement>('span.internal-embed:not(.is-loaded)');
  for (const embed of Array.from(embeds)) {
    const embedSrc = embed.getAttribute('src') || embed.getAttribute('alt') || '';
    if (!embedSrc) continue;

    // Check if this looks like an image path
    const ext = embedSrc.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif', 'tiff'];
    if (!imageExts.includes(ext)) continue;

    try {
      const imageFile = resolveImageFile(app, sourcePath, embedSrc);
      if (imageFile) {
        const img = document.createElement('img');
        img.src = app.vault.getResourcePath(imageFile);
        img.alt = embedSrc.split('/').pop() || embedSrc;
        img.className = 'sprout-reading-embed-img';
        embed.replaceChildren(img);
        embed.classList.add('media-embed', 'image-embed', 'is-loaded');
      } else {
        // Image not found — show a comment-like placeholder
        embed.textContent = `⚠️ Image not found: ${embedSrc}`;
        embed.classList.add('sprout-missing-image');
      }
    } catch (err) {
      log.warn('Failed to resolve internal embed:', embedSrc, err);
      embed.textContent = `⚠️ Image not found: ${embedSrc}`;
      embed.classList.add('sprout-missing-image');
    }
  }
}

/**
 * Find all `<img data-embed-path="...">` placeholders inside an element
 * and resolve them to actual vault resource URLs.
 */
function resolveEmbeddedImages(el: HTMLElement, app: App, sourcePath: string) {
  const imgs = el.querySelectorAll<HTMLImageElement>('img[data-embed-path]');
  for (const img of Array.from(imgs)) {
    const embedPath = img.getAttribute('data-embed-path');
    if (!embedPath) continue;

    try {
      const imageFile = resolveImageFile(app, sourcePath, embedPath);
      if (imageFile) {
        img.src = app.vault.getResourcePath(imageFile);
        img.removeAttribute('data-embed-path');
      } else {
        // Fallback: show the path as alt text
        img.alt = embedPath;
        img.title = `Image not found: ${embedPath}`;
      }
    } catch (err) {
      log.warn('Failed to resolve embedded image:', embedPath, err);
    }
  }
}

/* =========================
   IO image rendering for reading-view cards
   ========================= */

/**
 * Render an IO parent card's masked image (question) and full image (answer)
 * directly inside the reading-view pretty card.
 * Shows ALL masks (parent view) so the user can see every occlusion zone.
 */
function renderIoInReadingCard(
  el: HTMLElement,
  card: SproutCard,
  plugin: SproutPluginLike,
  sourcePath: string,
) {
  const app = plugin.app;
  const anchorId = card.anchorId;

  // Resolve IO data from store
  const ioMap = (plugin.store?.data as unknown as { io?: Record<string, { imageRef: string; rects: StoredIORect[]; maskMode?: string }> })?.io ?? {};
  let ioDef = ioMap[anchorId];

  // Fallback: if IO map entry is missing, rebuild from the card record's occlusions
  if (!ioDef) {
    const cardRec = (plugin.store?.data?.cards ?? {})[anchorId] as Record<string, unknown> | undefined;
    if (cardRec) {
      const rawImageRefVal = cardRec.imageRef;
      let rawImageRef = '';
      if (typeof rawImageRefVal === 'string') {
        rawImageRef = rawImageRefVal.trim();
      } else if (typeof rawImageRefVal === 'number' || typeof rawImageRefVal === 'boolean') {
        rawImageRef = String(rawImageRefVal).trim();
      }
      const rawOcclusions = cardRec.occlusions;
      if (rawImageRef && Array.isArray(rawOcclusions) && rawOcclusions.length > 0) {
        const rects: StoredIORect[] = [];
        for (const r of rawOcclusions) {
          if (!r || typeof r !== 'object') continue;
          const rect = r as Record<string, unknown>;
          
          let rectId = '';
          const rectIdRaw = rect.rectId ?? rect.id;
          if (typeof rectIdRaw === 'string') {
            rectId = rectIdRaw;
          } else if (typeof rectIdRaw === 'number' || typeof rectIdRaw === 'boolean') {
            rectId = String(rectIdRaw);
          }
          
          let groupKey = '1';
          const groupKeyRaw = rect.groupKey;
          if (typeof groupKeyRaw === 'string') {
            groupKey = groupKeyRaw;
          } else if (typeof groupKeyRaw === 'number' || typeof groupKeyRaw === 'boolean') {
            groupKey = String(groupKeyRaw);
          }
          
          rects.push({
            rectId,
            x: Number(rect.x ?? 0),
            y: Number(rect.y ?? 0),
            w: Number(rect.w ?? rect.width ?? 0),
            h: Number(rect.h ?? rect.height ?? 0),
            groupKey,
            shape: (rect.shape === 'circle' ? 'circle' : 'rect'),
          });
        }
        if (rects.length > 0) {
          let maskMode = '';
          const maskModeRaw = cardRec.maskMode;
          if (typeof maskModeRaw === 'string') {
            maskMode = maskModeRaw;
          } else if (typeof maskModeRaw === 'number' || typeof maskModeRaw === 'boolean') {
            maskMode = String(maskModeRaw);
          }
          ioDef = { imageRef: rawImageRef, rects, maskMode };
          // Also populate the IO map for future lookups
          if (plugin.store?.data) {
            if (!(plugin.store.data as unknown as Record<string, unknown>).io) {
              (plugin.store.data as unknown as Record<string, unknown>).io = {};
            }
            ((plugin.store.data as unknown as Record<string, unknown>).io as Record<string, unknown>)[anchorId] = ioDef;
          }
        }
      }
    }
  }
  if (!ioDef) return;

  const imageRef = String(ioDef.imageRef || '').trim();
  if (!imageRef) return;

  // Resolve image file to get a vault resource URL
  const imageFile = resolveImageFile(app, sourcePath, imageRef);
  if (!imageFile) return;
  const imageSrc = app.vault.getResourcePath(imageFile);

  const occlusions: StoredIORect[] = Array.isArray(ioDef.rects) ? ioDef.rects : [];

  // ---- Question container: image with mask overlays ----
  const questionEl = queryFirst<HTMLElement>(el, '[id^="sprout-io-question-"]');
  if (questionEl) {
    questionEl.replaceChildren();
    const container = document.createElement('div');
    container.className = 'sprout-io-reading-container';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = card.title || 'Image Occlusion';
    img.className = 'sprout-io-reading-img';
    container.appendChild(img);

    if (occlusions.length > 0) {
      const overlay = document.createElement('div');
      overlay.className = 'sprout-io-reading-overlay';

      for (const rect of occlusions) {
        const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
        const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
        const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
        const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;

        const mask = document.createElement('div');
        mask.className = 'sprout-io-reading-mask sprout-io-reading-mask-filled';
        mask.classList.add(rect.shape === 'circle' ? 'sprout-io-reading-mask-circle' : 'sprout-io-reading-mask-rect');

        setCssProps(mask, 'left', `${Math.max(0, Math.min(1, x)) * 100}%`);
        setCssProps(mask, 'top', `${Math.max(0, Math.min(1, y)) * 100}%`);
        setCssProps(mask, 'width', `${Math.max(0, Math.min(1, w)) * 100}%`);
        setCssProps(mask, 'height', `${Math.max(0, Math.min(1, h)) * 100}%`);

        const hint = document.createElement('span');
        hint.textContent = '?';
        hint.className = 'sprout-io-reading-mask-hint';
        mask.appendChild(hint);

        overlay.appendChild(mask);
      }

      container.appendChild(overlay);
    }

    questionEl.appendChild(container);
  }

  // ---- Answer container: clean image (no masks) ----
  const answerEl = queryFirst<HTMLElement>(el, '[id^="sprout-io-answer-"]');
  if (answerEl) {
    answerEl.replaceChildren();
    const container = document.createElement('div');
    container.className = 'sprout-io-reading-container';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = card.title || 'Image Occlusion — Answer';
    img.className = 'sprout-io-reading-img';
    container.appendChild(img);

    answerEl.appendChild(container);
  }
}

/* =========================
   Expose manual trigger on window
   ========================= */

declare global { interface Window { sproutApplyMasonryGrid?: () => void; } }

window.sproutApplyMasonryGrid = window.sproutApplyMasonryGrid || (() => {
  debugLog('[Sprout] sproutApplyMasonryGrid placeholder invoked');
  void processCardElements(document.documentElement, undefined, '');
});
