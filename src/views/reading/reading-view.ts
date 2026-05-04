/**
 * @file src/reading/reading-view.ts
 * @summary Stateful, side-effectful code for Sprout's reading-view pretty-card rendering and masonry layout. Owns all mutable module-level state (sproutPluginRef, masonry timers, MutationObserver) and the Obsidian registerMarkdownPostProcessor hook that transforms card blocks into styled, interactive card elements in the editor.
 *
 * @exports
 *  - registerReadingViewPrettyCards — registers the markdown post-processor that renders pretty cards in reading view
 */

import type { App, Plugin, MarkdownPostProcessorContext } from "obsidian";
import { Component, MarkdownRenderer, MarkdownView, Notice, setIcon, TFile, renderMath, finishRenderMath } from "obsidian";
import { log } from "../../platform/core/logger";
import { t } from "../../platform/translations/translator";
import { escapeDelimiterRe } from "../../platform/core/delimiter";
import { openBulkEditModalForCards } from "../../platform/modals/bulk-edit";
import { ImageOcclusionCreatorModal } from "../../platform/modals/image-occlusion-creator-modal";
import { buildCardBlockMarkdown, findCardBlockRangeById } from "../reviewer/markdown-block";
import { syncOneFile } from "../../platform/integrations/sync/sync-engine";
import type { CardRecord } from "../../platform/core/store";
import type LearnKitPlugin from "../../main";
import { queryFirst, replaceChildrenWithHTML, setCssProps } from "../../platform/core/ui";
import { DEFAULT_SETTINGS } from "../../platform/core/default-settings";
import { resolveImageFile } from "../../platform/image-occlusion/io-helpers";
import type { StoredIORect } from "../../platform/image-occlusion/image-occlusion-types";
import { polygonClipPath } from "../../platform/image-occlusion/image-geometry";
import { resolveAnchoredLabelCollisions } from "../../platform/image-occlusion/overlay-label-layout";

import {
  ANCHOR_RE,
  clean,
  escapeHtml,
  extractRawTextFromParagraph,
  extractTextWithLaTeX,
  extractCardFromSource,
  parseLearnKitCard,
  normalizeMathSignature,
  processMarkdownFeatures,
  buildCardContentHTML,
  type LearnKitCard,
} from "./reading-helpers";
import { getTtsService } from "../../platform/integrations/tts/tts-service";
import { hasCardAnchorForId } from "../../platform/core/identity";
import { buildReadingFlashcardCloze } from "./reading-flashcard-cloze";

/* -----------------------
   Module-level mutable state
   ----------------------- */

let sproutPluginRef: Plugin | null = null;

/** Shape of a Sprout plugin instance for general-setting lookups. */
type SproutPluginLike = Plugin & {
  store?: { data?: { cards?: Record<string, CardRecord> } };
  settings?: {
    general?: { prettifyCards?: string; enableReadingStyles?: boolean; interfaceLanguage?: string };
    cards?: {
      clozeMode?: "standard" | "typed";
      clozeBgColor?: string;
      clozeTextColor?: string;
    };
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
      useFlagsForVoiceSelection?: boolean;
      speakFlagLanguageLabel?: boolean;
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
            displayAudioButton?: boolean;
            displayEditButton?: boolean;
          };
          colours?: {
            autoDarkAdjust?: boolean;
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
            cardTextLight?: string;
            cardTextDark?: string;
            cardMutedLight?: string;
            cardMutedDark?: string;
            clozeBgLight?: string;
            clozeTextLight?: string;
            clozeBgDark?: string;
            clozeTextDark?: string;
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
            displayAudioButton?: boolean;
            displayEditButton?: boolean;
          };
          colours?: {
            autoDarkAdjust?: boolean;
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
            cardTextLight?: string;
            cardTextDark?: string;
            cardMutedLight?: string;
            cardMutedDark?: string;
            clozeBgLight?: string;
            clozeTextLight?: string;
            clozeBgDark?: string;
            clozeTextDark?: string;
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
            displayAudioButton?: boolean;
            displayEditButton?: boolean;
          };
          colours?: {
            autoDarkAdjust?: boolean;
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
            cardTextLight?: string;
            cardTextDark?: string;
            cardMutedLight?: string;
            cardMutedDark?: string;
            clozeBgLight?: string;
            clozeTextLight?: string;
            clozeBgDark?: string;
            clozeTextDark?: string;
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
            displayAudioButton?: boolean;
            displayEditButton?: boolean;
          };
          colours?: {
            autoDarkAdjust?: boolean;
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
            cardTextLight?: string;
            cardTextDark?: string;
            cardMutedLight?: string;
            cardMutedDark?: string;
            clozeBgLight?: string;
            clozeTextLight?: string;
            clozeBgDark?: string;
            clozeTextDark?: string;
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
            displayAudioButton?: boolean;
            displayEditButton?: boolean;
          };
          colours?: {
            autoDarkAdjust?: boolean;
            cardBgLight?: string;
            cardBgDark?: string;
            cardBorderLight?: string;
            cardBorderDark?: string;
            cardAccentLight?: string;
            cardAccentDark?: string;
            cardTextLight?: string;
            cardTextDark?: string;
            cardMutedLight?: string;
            cardMutedDark?: string;
            clozeBgLight?: string;
            clozeTextLight?: string;
            clozeBgDark?: string;
            clozeTextDark?: string;
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
 * Derive readable body text for dark backgrounds from a light-theme text colour.
 */
function deriveTextForDark(lightHex: string): string {
  const { h, s, l } = hexToHsl(lightHex);
  const darkL = Math.max(72, Math.min(92, l + 42));
  const darkS = Math.max(0, s - 12);
  return hslToHex(h, darkS, darkL);
}

/* =========================
   Dynamic style injection
   ========================= */

type AdoptedStyleSheetsDocument = Document & { adoptedStyleSheets?: CSSStyleSheet[] };

let readingDynamicStyleSheet: CSSStyleSheet | null = null;

function getReadingDynamicStyleSheet(): CSSStyleSheet | null {
  if (typeof document === 'undefined' || typeof CSSStyleSheet === 'undefined') return null;

  if (readingDynamicStyleSheet) return readingDynamicStyleSheet;

  const doc = document as AdoptedStyleSheetsDocument;
  const existing = doc.adoptedStyleSheets;
  if (!Array.isArray(existing)) return null;

  const sheet = new CSSStyleSheet();
  doc.adoptedStyleSheets = [...existing, sheet];
  readingDynamicStyleSheet = sheet;
  return readingDynamicStyleSheet;
}

function normaliseMacroPreset(raw: string | undefined): 'classic' | 'guidebook' | 'flashcards' | 'markdown' | 'custom' {
  const key = String(raw || '').trim().toLowerCase();
  if (key === 'minimal-flip') return 'flashcards';
  if (key === 'full-card') return 'classic';
  if (key === 'compact') return 'markdown';
  if (key === 'classic' || key === 'guidebook' || key === 'flashcards' || key === 'markdown' || key === 'custom') return key;
  return 'flashcards';
}

function resolveReadingLayout(
  rawLayout: 'masonry' | 'vertical' | undefined,
  macroPreset: 'classic' | 'guidebook' | 'flashcards' | 'markdown' | 'custom',
): 'masonry' | 'vertical' {
  if (macroPreset === 'classic' || macroPreset === 'flashcards') return 'masonry';
  return rawLayout === 'vertical' ? 'vertical' : 'masonry';
}

/**
 * Injects or updates a dynamic stylesheet that writes the current reading-view
 * settings as CSS rules. This makes colour, font, layout, and mode changes
 * instant — no per-card DOM manipulation or full re-render needed.
 *
 * Called once on init and again whenever a reading-view setting changes.
 */
export function syncReadingViewStyles(): void {
  const plugin = getSproutPlugin();
  const enabled = !!plugin?.settings?.general?.enableReadingStyles;
  const rv = plugin?.settings?.readingView;
  const macroPreset = normaliseMacroPreset((rv?.activeMacro as string | undefined) ?? rv?.preset);
  const effectiveLayout = resolveReadingLayout(rv?.layout, macroPreset);
  const macroSelector = `.learnkit-pretty-card.learnkit-macro-${macroPreset}`;

  const styleSheet = getReadingDynamicStyleSheet();
  if (!styleSheet) return;

  if (!enabled) {
    styleSheet.replaceSync("");
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

  // ── Font size ──
  const fontSize = Number(rv?.fontSize);
  const effectiveFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 0.9;
  css += `.learnkit-pretty-card .learnkit-section-content,\n`;
  css += `.learnkit-pretty-card .learnkit-answer,\n`;
  css += `.learnkit-pretty-card .learnkit-info,\n`;
  css += `.learnkit-pretty-card .learnkit-section-label,\n`;
  css += `.learnkit-pretty-card .learnkit-text-muted,\n`;
  css += `.learnkit-pretty-card .learnkit-option,\n`;
  css += `.learnkit-pretty-card.learnkit-macro-flashcards .learnkit-flashcard-question,\n`;
  css += `.learnkit-pretty-card.learnkit-macro-flashcards .learnkit-flashcard-answer,\n`;
  css += `.learnkit-pretty-card.learnkit-macro-flashcards .learnkit-flashcard-options,\n`;
  css += `.learnkit-pretty-card.learnkit-macro-flashcards .learnkit-flashcard-info {\n`;
  css += `  font-size: ${effectiveFontSize}rem !important;\n`;
  css += `}\n`;

  // Ensure hidden source fragments never leak below prettified cards,
  // even when scoped stylesheet transforms miss plain markdown leaves.
  css += `.markdown-preview-section > :not(.el-ul):not(.el-ol)[data-learnkit-hidden="true"] {\n`;
  css += `  display: none !important;\n`;
  css += `  max-height: 0 !important;\n`;
  css += `  overflow: hidden !important;\n`;
  css += `  margin: 0 !important;\n`;
  css += `  padding: 0 !important;\n`;
  css += `  border: none !important;\n`;
  css += `}\n`;
  // In vertical layout, keep hidden list spillover in normal flow so
  // Obsidian's virtualizer retains correct section height.
  css += `.markdown-preview-section.learnkit-layout-vertical > .el-ul[data-learnkit-hidden="true"],\n`;
  css += `.markdown-preview-section.learnkit-layout-vertical > .el-ol[data-learnkit-hidden="true"],\n`;
  css += `.markdown-preview-section.learnkit-layout-vertical > .el-ul.learnkit-hidden-important,\n`;
  css += `.markdown-preview-section.learnkit-layout-vertical > .el-ol.learnkit-hidden-important {\n`;
  css += `  position: absolute !important;\n`;
  css += `  left: -99999px !important;\n`;
  css += `  top: auto !important;\n`;
  css += `  width: 1px !important;\n`;
  css += `  height: 1px !important;\n`;
  css += `  overflow: hidden !important;\n`;
  css += `  margin: 0 !important;\n`;
  css += `  padding: 0 !important;\n`;
  css += `  border: none !important;\n`;
  css += `  opacity: 0 !important;\n`;
  css += `  user-select: none !important;\n`;
  css += `  pointer-events: none !important;\n`;
  css += `}\n`;
  css += `.markdown-preview-section > .el-p[data-learnkit-processed] {\n`;
  css += `  opacity: 1;\n`;
  css += `  max-height: none;\n`;
  css += `}\n`;

  // ── Layout ──
  if (effectiveLayout === 'vertical') {
    css += `.markdown-preview-section.learnkit-layout-vertical > .learnkit-reading-card-run {\n`;
    css += `  column-width: unset !important;\n  column-gap: unset !important;\n  column-count: 1 !important;\n`;
    css += `  display: flex;\n  flex-direction: column;\n  gap: 12px;\n`;
    css += `}\n`;
    css += `.markdown-preview-section.learnkit-layout-vertical > .learnkit-reading-card-run > .learnkit-pretty-card {\n`;
    css += `  margin-top: 0 !important;\n  margin-bottom: 0 !important;\n`;
    css += `}\n`;
  }

  if (macroPreset === 'flashcards') {
    css += `.markdown-preview-section.learnkit-layout-masonry > .learnkit-reading-card-run:has(.learnkit-pretty-card.learnkit-macro-flashcards) {\n`;
    css += `  column-width: 280px !important;\n`;
    css += `  column-gap: 16px !important;\n`;
    css += `  display: block !important;\n`;
    css += `}\n`;
    css += `.markdown-preview-section.learnkit-layout-masonry > .learnkit-reading-card-run:has(.learnkit-pretty-card.learnkit-macro-flashcards) > .learnkit-pretty-card.learnkit-macro-flashcards {\n`;
    css += `  margin-top: 0 !important;\n`;
    css += `  padding-top: 0 !important;\n`;
    css += `  margin-bottom: 16px !important;\n`;
    css += `}\n`;
  }

  // ── Card mode: full (expand collapsibles, hide toggle buttons) ──
  if (rv?.cardMode === 'full') {
    css += `.learnkit-pretty-card .learnkit-collapsible { max-height: none !important; overflow: visible !important; }\n`;
    css += `.learnkit-pretty-card .learnkit-toggle-btn { display: none !important; }\n`;
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
      displayAudioButton?: boolean;
      displayEditButton?: boolean;
    };
  } | undefined)?.fields;
  const activeFields = macroFields ?? rv?.visibleFields;
  if (activeFields) {
    const vf = activeFields;
    if (!vf.title) css += `${macroSelector} .learnkit-card-header { display: none !important; }\n`;
    if (!vf.question) css += `${macroSelector} .learnkit-section-question { display: none !important; }\n`;
    if (!vf.options) css += `${macroSelector} .learnkit-section-options { display: none !important; }\n`;
    if (!vf.answer) css += `${macroSelector} .learnkit-section-answer { display: none !important; }\n`;
    if (!vf.info) css += `${macroSelector} .learnkit-section-info { display: none !important; }\n`;
    if (!vf.groups) css += `${macroSelector} .learnkit-groups-list, ${macroSelector} .learnkit-section-groups { display: none !important; }\n`;
    if (!vf.edit && macroPreset !== 'flashcards') css += `${macroSelector} .learnkit-card-edit-btn { display: none !important; }\n`;
  }

  if (macroPreset === 'flashcards') {
    const showAudioButton = macroFields?.displayAudioButton !== false;
    const showEditButton = macroFields?.displayEditButton !== false;
    if (!showAudioButton) css += `${macroSelector} .learnkit-flashcard-speak-btn { display: none !important; }\n`;
    if (!showEditButton) css += `${macroSelector} .learnkit-card-edit-btn { display: none !important; }\n`;
  }
  const showLabels = (macroConfig as { fields?: { labels?: boolean } } | undefined)?.fields?.labels ?? rv?.displayLabels;
  if (showLabels === false) {
    css += `${macroSelector} .learnkit-section-label { display: none !important; }\n`;
  }
  if (macroPreset === 'classic') {
    css += `.learnkit-pretty-card.learnkit-macro-classic .learnkit-section-label { display: flex !important; }\n`;
  }

  if (macroPreset === 'custom') {
    const rawCustomCss = rv?.macroConfigs?.custom?.customCss ?? '';
    const safeCustomCss = String(rawCustomCss).replace(/<\/?style[^>]*>/gi, '').trim();
    if (safeCustomCss) {
      css += `\n/* user custom reading css */\n${safeCustomCss}\n`;
    }
  }

  // Macro-specific styling is handled in pretty-cards.css.

  // ── Update dynamic stylesheet ──
  // For static CSS, use the main styles.css file.
  styleSheet.replaceSync(css);
}

/* =========================
   Public registration
   ========================= */

export function registerReadingViewPrettyCards(plugin: Plugin) {
  debugLog("[LearnKit] Registering reading view prettifier");

  sproutPluginRef = plugin;

  // Inject dynamic styles from current reading-view settings
  syncReadingViewStyles();

  plugin.registerMarkdownPostProcessor(
    async (rootEl: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      try {
        // Skip if inside editor live preview
        if (rootEl.closest(".cm-content")) {
          debugLog("[LearnKit] Skipping - in editor content");
          return;
        }

        // Only run in reading/preview contexts
        const isInReadingView =
          rootEl.closest(
            ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section"
          ) !== null ||
          (ctx.containerEl && (ctx.containerEl.classList.contains("markdown-reading-view") || ctx.containerEl.classList.contains("markdown-preview-view") || ctx.containerEl.closest(".markdown-reading-view, .markdown-preview-view") !== null));

        if (!isInReadingView) {
          debugLog("[LearnKit] Skipping - not in reading/preview view");
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
          debugLog("[LearnKit] Could not read source file:", e);
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

  // NOTE: Scroll and resize listeners for scheduleViewportReflow() were removed
  // to fix issue #56 — the masonry column layout flickered (1-col → 2-col) because
  // Obsidian's lazy section rendering caused scroll-triggered reflows to unwrap and
  // re-wrap card runs. CSS `column-width` handles responsive column count natively.
  // The MutationObserver now detects re-added sections from Obsidian's virtualiser
  // and applies layout to them. Layout also recalculates on mode-switch (edit →
  // reading) via the sprout:prettify-cards-refresh event / scheduleViewportReflow.

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

    const pluginState = getSproutPlugin();
    const stylesEnabled = pluginState
      ? !!pluginState.settings?.general?.enableReadingStyles
      : true;

    const root = (e.currentTarget instanceof HTMLElement)
      ? e.currentTarget
      : (e.target instanceof HTMLElement ? e.target : null);
    const refreshDetail = (e as CustomEvent<{ sourceContent?: string; sourcePath?: string }>).detail;
    const sourceFromEvent = typeof refreshDetail?.sourceContent === 'string'
      ? refreshDetail.sourceContent
      : '';

    // When reading styles are disabled, remove all Sprout DOM adjustments
    if (!stylesEnabled) {
      if (root) resetCardsToNativeReading(root);
      else resetCardsToNativeReading(document.documentElement);
      return;
    }

    const refreshRoot = root ?? document.documentElement;
    resetCardsToNativeReading(refreshRoot);
    clearStaleReadingViewState(refreshRoot);
    void processCardElements(refreshRoot, undefined, sourceFromEvent)
      .then(() => {
        runPostRefreshSpilloverCleanup(refreshRoot);
      })
      .catch((err) => {
        log.swallow("post refresh processCardElements", err);
      });

  }

  // Attach listeners on load and after mutation observer runs
  attachRefreshListenerToMarkdownViews();
  // Re-attach listeners after mutation observer triggers DOM changes
  // (handled inline in the mutation observer callback via attachRefreshListenerToMarkdownViews)
}

/* =========================
   Manual trigger + event hook
   ========================= */

function setupManualTrigger() {
  window.sproutApplyMasonryGrid = () => {
    debugLog('[LearnKit] Manual sproutApplyMasonryGrid() called');
    requestAnimationFrame(() => {
      void processCardElements(document.documentElement, undefined, '');
    });
  };

  addTrackedWindowListener('sprout-cards-inserted', () => {
    debugLog('[LearnKit] Received sprout-cards-inserted event — re-processing cards');
    window.sproutApplyMasonryGrid?.();
  });
}

async function getLiveMarkdownSourceContent(): Promise<string> {
  try {
    const plugin = getSproutPlugin();
    if (!plugin) return '';

    const activeMarkdownView = plugin.app.workspace?.getActiveViewOfType?.(MarkdownView);
    if (activeMarkdownView?.getMode?.() === 'source') {
      const liveViewData =
        typeof (activeMarkdownView as unknown as { getViewData?: () => string }).getViewData === 'function'
          ? String((activeMarkdownView as unknown as { getViewData: () => string }).getViewData() ?? '')
          : '';

      if (liveViewData.trim()) return liveViewData;
    }

    const activeFile = plugin.app.workspace?.getActiveFile?.();
    if (activeFile instanceof TFile && activeFile.extension === 'md') {
      return await plugin.app.vault.read(activeFile);
    }
  } catch (e) {
    debugLog('[LearnKit] Could not read live markdown source content:', e);
  }
  return '';
}

async function forceReadingViewRefreshAfterModalSave(
  plugin: SproutPluginLike,
  sourcePath: string,
  sourceContent: string,
): Promise<void> {
  const refreshLeaves = (plugin as unknown as {
    refreshReadingViewMarkdownLeaves?: () => Promise<void> | void;
  }).refreshReadingViewMarkdownLeaves;

  if (typeof refreshLeaves === "function") {
    try {
      await Promise.resolve(refreshLeaves.call(plugin));
    } catch (e) {
      log.swallow("refresh reading view markdown leaves (modal save)", e);
    }
  }

  const dispatchPayload = { sourceContent, sourcePath };
  const leaves = plugin.app.workspace
    .getLeavesOfType("markdown")
    .filter((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return false;
      if (!(view.file instanceof TFile)) return true;
      return !sourcePath || view.file.path === sourcePath;
    });

  for (const leaf of leaves) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) continue;

    const content = queryFirst(
      view.containerEl,
      ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
    );
    if (!(content instanceof HTMLElement)) continue;

    const dispatchRefresh = () => {
      try {
        content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
          bubbles: true,
          detail: dispatchPayload,
        }));
      } catch (e) {
        log.swallow("dispatch reading view refresh (modal save)", e);
      }
    };

    dispatchRefresh();

    if (view.getMode?.() === "preview") {
      try {
        view.previewMode?.rerender?.();
      } catch (e) {
        log.swallow("rerender markdown preview (modal save)", e);
      }
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          dispatchRefresh();
          void refreshProcessedCards(content, sourceContent);
          runPostRefreshSpilloverCleanup(content);
          resolve();
        });
      });
    });

    // Obsidian may append structural list blocks shortly after rerender.
    // A delayed pass keeps card-owned residue hidden in the same page visit.
    window.setTimeout(() => {
      try {
        void refreshProcessedCards(content, sourceContent);
        runPostRefreshSpilloverCleanup(content);
      } catch {
        // Best-effort cleanup only.
      }
    }, 120);
  }
}

function runPostRefreshSpilloverCleanup(scope: ParentNode): void {
  const cards = Array.from((scope as Element).querySelectorAll?.<HTMLElement>(
    ".learnkit-pretty-card[data-learnkit-processed], .learnkit-pretty-card[data-sprout-processed]",
  ) ?? []);

  for (const cardEl of cards) {
    const raw = String(cardEl.getAttribute("data-learnkit-raw-text") || "");
    hideCardSiblingElements(cardEl, raw || undefined);
  }

  hideSectionLevelOrphanDelimitedParagraphs(scope);
}

export function __testRunPostRefreshSpilloverCleanup(scope: ParentNode): void {
  runPostRefreshSpilloverCleanup(scope);
}

/* =========================
   Debounced MutationObserver
   ========================= */

let mutationObserver: MutationObserver | null = null;
let pendingRafId: number | null = null;
let viewportReflowTimer: number | null = null;
let flashcardsBootstrapTimer: number | null = null;
const FLASHCARDS_BOOTSTRAP_ATTR = 'data-learnkit-flashcards-bootstrap';

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
  if (pendingRafId) {
    window.cancelAnimationFrame(pendingRafId);
    pendingRafId = null;
  }
  if (viewportReflowTimer) {
    window.cancelAnimationFrame(viewportReflowTimer);
    viewportReflowTimer = null;
  }
  // Remove all tracked window listeners
  for (const { event, handler, options } of registeredWindowListeners) {
    window.removeEventListener(event, handler, options as boolean | EventListenerOptions | undefined);
  }
  registeredWindowListeners = [];
  // Clear global references
  sproutPluginRef = null;
  delete (window as unknown as Record<string, unknown>).sproutApplyMasonryGrid;
  // Detach dynamic reading stylesheet
  if (readingDynamicStyleSheet) {
    const doc = document as AdoptedStyleSheetsDocument;
    if (Array.isArray(doc.adoptedStyleSheets)) {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== readingDynamicStyleSheet);
    }
  }
  readingDynamicStyleSheet = null;
}

function setupDebouncedMutationObserver() {
  if (mutationObserver) {
    debugLog('[LearnKit] MutationObserver already running');
    return;
  }

  mutationObserver = new MutationObserver((mutations) => {
    // Collect specific containers that have new unprocessed .el-p elements
    const dirtyContainers = new Set<HTMLElement>();
    // Sections re-entering the DOM (Obsidian's virtualiser) with
    // already-processed cards that need their card-run wrappers restored.
    const sectionsNeedingLayout = new Set<HTMLElement>();

    for (const m of mutations) {
      // Only watch for added nodes (new content), ignore removals and repositioning
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        // Skip mutations inside the editor
        if (m.target instanceof Element && m.target.closest('.cm-content')) continue;
        // Skip mutations inside our own card-run wrappers (from wrapping/unwrapping)
        if (m.target instanceof Element && m.target.closest('.learnkit-reading-card-run')) continue;
        // Skip mutations outside reading view contexts
        if (m.target instanceof Element && !m.target.closest('.markdown-reading-view, .markdown-preview-view, .markdown-rendered')) continue;

        for (const n of Array.from(m.addedNodes)) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element;

            // Skip our own wrapper nodes being added
            if (el instanceof HTMLElement && el.classList.contains('learnkit-reading-card-run')) continue;

            // Only trigger if we see actual NEW .el-p or sprout cards
            // Skip if the added node is just being moved (check if it already has sprout-processed)
            if (el.matches && el.matches('.el-p') && !el.hasAttribute('data-learnkit-processed')) {
              // Find the closest section or reading view container
              const section = el.closest('.markdown-preview-section') as HTMLElement;
              if (section) dirtyContainers.add(section);
              else dirtyContainers.add(el as HTMLElement);
            } else if (queryFirst(el as ParentNode, '.el-p:not([data-learnkit-processed])')) {
              dirtyContainers.add(el as HTMLElement);
            }

            // Detect sections re-entering the DOM with already-processed
            // cards that aren't wrapped in .learnkit-reading-card-run yet.
            // This handles Obsidian's virtualised scroll (#56) — sections
            // removed from the DOM and re-added lose their card-run wrappers.
            if (el instanceof HTMLElement) {
              const isSection = el.classList.contains('markdown-preview-section');
              if (isSection && el.querySelector('.learnkit-pretty-card') && !el.querySelector('.learnkit-reading-card-run')) {
                sectionsNeedingLayout.add(el);
              } else if (el.classList.contains('learnkit-pretty-card') && !el.closest('.learnkit-reading-card-run')) {
                // A processed card was added outside a card-run wrapper
                // (e.g. post-processor ran while element was detached).
                const section = el.closest<HTMLElement>('.markdown-preview-section');
                if (section) sectionsNeedingLayout.add(section);
              } else if (!isSection) {
                // The added node might contain sections (e.g. a container node)
                el.querySelectorAll?.('.markdown-preview-section')?.forEach((sec) => {
                  if (sec instanceof HTMLElement && sec.querySelector('.learnkit-pretty-card') && !sec.querySelector('.learnkit-reading-card-run')) {
                    sectionsNeedingLayout.add(sec);
                  }
                });
              }
            }
          }
        }
      }
    }

    // Apply layout to sections that re-entered the DOM immediately
    // (no debounce needed — wrapContiguousCardRuns fast-path prevents
    // flicker when cards are already wrapped, and these sections have
    // unwrapped cards that need wrapping exactly once).
    if (sectionsNeedingLayout.size > 0) {
      const pluginState = getSproutPlugin();
      const stylesEnabled = pluginState
        ? !!pluginState.settings?.general?.enableReadingStyles
        : true;
      if (stylesEnabled) {
        const rvSettings = pluginState?.settings?.readingView;
        applyLayoutToSections(sectionsNeedingLayout, rvSettings);
      }
    }

    if (dirtyContainers.size === 0) return;

    // Coalesce mutations within a single animation frame so the
    // first paint of new content happens with cards already
    // processed (eliminates the "load lag" on tab/leaf open).
    const containers = Array.from(dirtyContainers);

    const processBatch = () => {
      pendingRafId = null;
      try {
        debugLog('[LearnKit] MutationObserver triggered — processing', containers.length, 'dirty containers');
        for (const container of containers) {
          if (container.isConnected) {
            void processCardElements(container, undefined, '');
          }
        }
      } catch (err) {
        log.error('MutationObserver handler error', err);
      }
    };

    // Cancel already-scheduled rAF so multiple mutations arriving
    // in the same microtask flush coalesce into one frame callback.
    if (pendingRafId) {
      window.cancelAnimationFrame(pendingRafId);
    }
    pendingRafId = window.requestAnimationFrame(processBatch);
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
    debugLog('[LearnKit] MutationObserver attached to document.body');
  } else {
    debugLog('[LearnKit] document.body not available for MutationObserver');
  }
}

function isFlashcardsReadingPresetActive(): boolean {
  try {
    const rv = getSproutPlugin()?.settings?.readingView;
    const macroPreset = normaliseMacroPreset((rv?.activeMacro as string | undefined) ?? rv?.preset);
    return macroPreset === 'flashcards';
  } catch {
    return false;
  }
}

function scheduleFlashcardsBootstrapReflow(): void {
  // Flashcards masonry can require one viewport recalculation pass after
  // initial reading-view attach (same effect as manual window resize).
  if (flashcardsBootstrapTimer) {
    window.clearTimeout(flashcardsBootstrapTimer);
  }
  flashcardsBootstrapTimer = window.setTimeout(() => {
    flashcardsBootstrapTimer = null;
    const nudgeFlashcardsSections = () => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>('.markdown-preview-section.learnkit-layout-masonry'));
      const flashSections = sections.filter((section) => !!section.querySelector('.learnkit-pretty-card.learnkit-macro-flashcards'));
      for (const section of flashSections) {
        const previousWidth = section.style.width;
        setCssProps(section, 'width', 'calc(100% - 1px)');
        window.requestAnimationFrame(() => {
          setCssProps(section, 'width', previousWidth || null);
        });
      }
      try {
        window.dispatchEvent(new Event('resize'));
      } catch {
        // Best-effort trigger only.
      }
    };

    scheduleViewportReflow();
    nudgeFlashcardsSections();

    // Obsidian may append additional virtualized chunks shortly after first paint.
    // A second one-shot nudge (still startup-only) helps complete initial hydration.
    window.setTimeout(() => {
      scheduleViewportReflow();
      nudgeFlashcardsSections();
    }, 180);
  }, 90);
}

function maybeScheduleFlashcardsBootstrap(scope: ParentNode, allowBootstrap: boolean): void {
  if (!allowBootstrap) return;
  if (!isFlashcardsReadingPresetActive()) return;

  const sections = collectSectionsWithPrettyCards(scope);
  let shouldSchedule = false;

  for (const section of sections) {
    const hasFlashcards = !!section.querySelector('.learnkit-pretty-card.learnkit-macro-flashcards');
    if (!hasFlashcards) continue;
    if (section.hasAttribute(FLASHCARDS_BOOTSTRAP_ATTR)) continue;
    section.setAttribute(FLASHCARDS_BOOTSTRAP_ATTR, 'true');
    shouldSchedule = true;
  }

  if (shouldSchedule) {
    scheduleFlashcardsBootstrapReflow();
  }
}

/* =========================
   Card processing
   ========================= */

async function processCardElements(container: HTMLElement, _ctx?: MarkdownPostProcessorContext, sourceContent?: string) {
  // Skip card prettification entirely when prettify is off
  try {
    const pluginCheck = getSproutPlugin();
    // If plugin state is transiently unavailable during startup/refresh,
    // avoid destructive resets that can cause flash-then-disappear behavior.
    const stylesEnabled = pluginCheck
      ? !!pluginCheck.settings?.general?.enableReadingStyles
      : true;
    if (pluginCheck && !stylesEnabled) {
      debugLog('[LearnKit] Prettify cards is off — skipping card processing');
      resetCardsToNativeReading(container);
      return;
    }
  } catch { /* proceed if we can't read settings */ }

  // If no source content provided, prefer the live markdown view buffer
  // (includes unsaved source edits during source -> reading transitions),
  // then fall back to reading from the vault file.
  if (!sourceContent) {
    sourceContent = await getLiveMarkdownSourceContent();
  }

  const found: HTMLElement[] = [];

  const applyLayoutForContainer = () => {
    try {
      reflowPrettyCardLayouts(container);
    } catch (e) {
      log.swallow('apply reading view settings', e);
    }
  };

  try {
    if (container.matches && container.matches('.el-p')) found.push(container);
  } catch {
    // ignore
  }

  container.querySelectorAll<HTMLElement>('.el-p:not([data-learnkit-processed])').forEach(el => found.push(el));

  const allowFlashcardsBootstrap = !!_ctx || container === document.documentElement;

  if (found.length === 0) {
    debugLog('[LearnKit] No unprocessed .el-p elements found in container');
    // Field-only edits can change card bodies without creating new anchor
    // paragraphs. Rebuild existing processed cards from latest source text.
    void refreshProcessedCards(container, sourceContent);
    applyLayoutForContainer();
    maybeScheduleFlashcardsBootstrap(container, allowFlashcardsBootstrap);
    hideSectionLevelOrphanDelimitedParagraphs(container);
    return;
  }

  debugLog(`[LearnKit] Found ${found.length} potential card elements to parse`);

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

      const card = parseLearnKitCard(rawText);
      if (!card) continue;

      el.dataset.sproutProcessed = 'true';
      el.setAttribute('data-learnkit-processed', 'true');

      enhanceCardElement(el, card, undefined, rawText);
    } catch (err) {
      log.error('Error processing element', err);
    }
  }

  // ── Apply reading view layout settings to sections containing cards ──
  applyLayoutForContainer();

  // Schedule a deferred global reflow as a safety net.
  // Individual post-processor calls may race or run before elements
  // are attached to the DOM; this final pass ensures card-run wrappers
  // are created after all pending rendering settles.
  scheduleViewportReflow();
  maybeScheduleFlashcardsBootstrap(container, allowFlashcardsBootstrap);
  hideSectionLevelOrphanDelimitedParagraphs(container);

  await Promise.resolve();

}

async function refreshProcessedCards(container: HTMLElement, sourceContent?: string) {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.learnkit-pretty-card[data-learnkit-raw-text], .el-p[data-learnkit-processed][data-learnkit-raw-text]'));
  if (!cards.length) return;

  const latestSource = sourceContent?.trim() ? sourceContent : await getLiveMarkdownSourceContent();

  const touchedSections = new Set<HTMLElement>();

  for (const el of cards) {
    try {
      if (el.closest('.cm-content')) continue;

      let rawText = String(el.getAttribute('data-learnkit-raw-text') || '');
      const anchorFromAttr = String(el.getAttribute('data-learnkit-id') || '').trim();
      const anchorFromRaw = rawText.match(ANCHOR_RE)?.[1] ?? '';
      const anchorId = anchorFromAttr || anchorFromRaw;

      if (latestSource && anchorId) {
        const extracted = extractCardFromSource(latestSource, anchorId);
        if (extracted) {
          rawText = extracted;
          el.setAttribute('data-learnkit-raw-text', extracted);
        }
      }

      if (!rawText.trim()) continue;
      const card = parseLearnKitCard(rawText);
      if (!card) continue;
      enhanceCardElement(el, card, undefined, rawText);
      const section = el.closest<HTMLElement>('.markdown-preview-section');
      if (section) touchedSections.add(section);
    } catch (err) {
      log.error('Error refreshing processed card', err);
    }
  }

  if (container.classList.contains('markdown-preview-section')) {
    touchedSections.add(container);
  }

  if (!touchedSections.size) return;
  const rvSettings = getSproutPlugin()?.settings?.readingView;
  applyLayoutToSections(touchedSections, rvSettings);
  touchedSections.forEach((section) => hideSectionLevelOrphanDelimitedParagraphs(section));
}

export async function __testRefreshProcessedCards(container: HTMLElement, sourceContent?: string): Promise<void> {
  await refreshProcessedCards(container, sourceContent);
}

function resetCardsToNativeReading(container: HTMLElement) {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.learnkit-pretty-card'));
  for (const card of cards) {
    try {
      const originalHtml = card.querySelector<HTMLElement>('.learnkit-original-content')?.innerHTML ?? '';
      if (originalHtml) replaceChildrenWithHTML(card, originalHtml);

      card.classList.remove(
        'learnkit-pretty-card', 'learnkit-pretty-card',
        'learnkit-reading-card', 'learnkit-reading-card',
        'learnkit-reading-view-wrapper', 'learnkit-reading-view-wrapper',
        'learnkit-single-card', 'learnkit-single-card',
        'learnkit-custom-root', 'learnkit-custom-root',
        'learnkit-flashcard-flipped', 'learnkit-flashcard-flipped',
        'learnkit-flashcard-animating', 'learnkit-flashcard-animating',
        'accent',
        'theme',
        'learnkit-macro-classic', 'learnkit-macro-classic',
        'learnkit-macro-guidebook', 'learnkit-macro-guidebook',
        'learnkit-macro-flashcards', 'learnkit-macro-flashcards',
        'learnkit-macro-markdown', 'learnkit-macro-markdown',
        'learnkit-macro-custom', 'learnkit-macro-custom',
      );

      card.removeAttribute('data-learnkit-processed');
      card.removeAttribute('data-learnkit-id');
      card.removeAttribute('data-learnkit-type');
      card.removeAttribute('data-learnkit-raw-text');
      card.removeAttribute('data-hide-title');
      card.removeAttribute('data-hide-question');
      card.removeAttribute('data-hide-options');
      card.removeAttribute('data-hide-answer');
      card.removeAttribute('data-hide-info');
      card.removeAttribute('data-hide-groups');
      card.removeAttribute('data-hide-edit');
      card.removeAttribute('data-hide-labels');
    } catch (err) {
      log.error('Error resetting pretty card to native reading', err);
    }
  }

  const sections = new Set<HTMLElement>();
  cards.forEach((card) => {
    const section = card.closest<HTMLElement>('.markdown-preview-section');
    if (section) sections.add(section);
  });
  if (container.classList.contains('markdown-preview-section')) {
    sections.add(container);
  }

  sections.forEach((section) => {
    applySectionCardRunLayout(section, 'vertical');
    section.classList.remove('learnkit-layout-vertical', 'learnkit-layout-vertical', 'learnkit-layout-masonry', 'learnkit-layout-masonry');
    section.removeAttribute(FLASHCARDS_BOOTSTRAP_ATTR);
  });
}

function clearStaleReadingViewState(container: HTMLElement) {
  // Reveal any source fragments hidden by prior pretty-card passes.
  container
    .querySelectorAll<HTMLElement>('[data-learnkit-hidden="true"], .learnkit-hidden-important')
    .forEach((el) => {
      el.classList.remove('learnkit-hidden-important', 'learnkit-hidden-important');
      el.removeAttribute('data-learnkit-hidden');
    });

  // Drop stale processed markers so updated markdown paragraphs are reparsed.
  container.querySelectorAll<HTMLElement>('.el-p[data-learnkit-processed]').forEach((el) => {
    el.removeAttribute('data-learnkit-processed');
    el.removeAttribute('data-learnkit-raw-text');
    el.removeAttribute('data-learnkit-id');
    el.removeAttribute('data-learnkit-type');
  });

  const sections = new Set<HTMLElement>();
  if (container.classList.contains('markdown-preview-section')) {
    sections.add(container);
  }
  container.querySelectorAll<HTMLElement>('.markdown-preview-section').forEach((section) => sections.add(section));

  // Ensure any stale wrappers/layout classes are rebuilt from a clean DOM.
  sections.forEach((section) => {
    unwrapCardRuns(section);
    section.classList.remove('learnkit-layout-vertical', 'learnkit-layout-vertical', 'learnkit-layout-masonry', 'learnkit-layout-masonry');
    section.removeAttribute(FLASHCARDS_BOOTSTRAP_ATTR);
  });
}

/* =========================
   FLIP animation for masonry reflow
   ========================= */

const FLIP_DURATION = 280; // ms

/**
 * Snapshot the bounding rect of every visible `.learnkit-pretty-card` inside
 * the closest masonry section.  Returns a Map keyed by element.
 */
function snapshotCardPositions(cardEl: HTMLElement): Map<HTMLElement, DOMRect> {
  const section = cardEl.closest('.markdown-preview-section');
  if (!section) return new Map();
  const positions = new Map<HTMLElement, DOMRect>();
  section.querySelectorAll<HTMLElement>('.learnkit-pretty-card').forEach(card => {
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
 * @param lockedCard — Card to keep visually anchored while siblings animate
 */
function flipAnimateCards(before: Map<HTMLElement, DOMRect>, lockedCard?: HTMLElement) {
  if (before.size === 0) return;

  const lockedCards = new Set<HTMLElement>();
  if (lockedCard) {
    lockedCards.add(lockedCard);
    const oldLockedRect = before.get(lockedCard);
    if (oldLockedRect) {
      for (const [card, rect] of before) {
        if (card === lockedCard) continue;
        const overlapsX = rect.right > oldLockedRect.left + 1 && rect.left < oldLockedRect.right - 1;
        const isAbove = rect.bottom <= oldLockedRect.top + 2;
        if (overlapsX && isAbove) lockedCards.add(card);
      }
    }
  }

  // Keep the interacted card fixed in the viewport while masonry reflows.
  // We do this with scroll compensation so the chosen card appears stable,
  // and sibling cards animate around it.
  if (lockedCard) {
    const oldLockedRect = before.get(lockedCard);
    if (oldLockedRect) {
      const newLockedRect = lockedCard.getBoundingClientRect();
      const scrollDx = newLockedRect.left - oldLockedRect.left;
      const scrollDy = newLockedRect.top - oldLockedRect.top;
      if (Math.abs(scrollDx) >= 1 || Math.abs(scrollDy) >= 1) {
        window.scrollBy(scrollDx, scrollDy);
      }
    }
  }

  // "Last" — read the new positions
  for (const [card, oldRect] of before) {
    if (lockedCards.has(card)) continue;
    const newRect = card.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;

    // Skip cards that haven't moved
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    // "Invert" — move card back to where it was
    card.classList.add('learnkit-flip-animating', 'learnkit-flip-animating', 'learnkit-flip-no-transition', 'learnkit-flip-no-transition');
    setCssProps(card, {
      '--learnkit-flip-x': `${dx}px`,
      '--learnkit-flip-y': `${dy}px`,
      '--learnkit-flip-duration': `${FLIP_DURATION}ms`,
    });

    // Force reflow so the inverted position is painted
    void card.offsetHeight;

    // "Play" — animate from inverted position to final (transform: none)
    card.classList.remove('learnkit-flip-no-transition', 'learnkit-flip-no-transition');
    setCssProps(card, {
      '--learnkit-flip-x': '0px',
      '--learnkit-flip-y': '0px',
    });
  }

  // Clean up transition style after animation ends
  const cleanup = () => {
    for (const [card] of before) {
      if (lockedCards.has(card)) continue;
      card.classList.remove('learnkit-flip-animating', 'learnkit-flip-animating', 'learnkit-flip-no-transition', 'learnkit-flip-no-transition');
      setCssProps(card, {
        '--learnkit-flip-x': null,
        '--learnkit-flip-y': null,
        '--learnkit-flip-duration': null,
      });
    }
  };
  setTimeout(cleanup, FLIP_DURATION + 20);
}

function unwrapCardRuns(section: HTMLElement) {
  const wrappers = Array.from(section.querySelectorAll<HTMLElement>(':scope > .learnkit-reading-card-run'));
  for (const wrapper of wrappers) {
    const children = Array.from(wrapper.children);
    for (const child of children) {
      section.insertBefore(child, wrapper);
    }
    wrapper.remove();
  }
  // Flush queued MutationObserver records from unwrapping
  if (mutationObserver) {
    mutationObserver.takeRecords();
  }
}

function wrapContiguousCardRuns(section: HTMLElement) {
  // Fast-path: skip destructive teardown + rebuild when every visible
  // card is already inside a .learnkit-reading-card-run wrapper.
  // This prevents the column→single-column→column flicker (#56)
  // that occurs when scroll / resize debounce triggers a full reflow.
  const hasUnwrappedVisibleCards = Array.from(section.children).some(child => {
    if (!(child instanceof HTMLElement)) return false;
    return child.classList.contains('learnkit-pretty-card') &&
           !child.classList.contains('learnkit-hidden-important') &&
           child.getAttribute('data-learnkit-hidden') !== 'true';
  });
  if (!hasUnwrappedVisibleCards) return;

  unwrapCardRuns(section);

  const children = Array.from(section.children) as HTMLElement[];
  let currentRun: HTMLDivElement | null = null;

  for (const child of children) {
    const isCard = child.classList.contains('learnkit-pretty-card');
    const isHidden = child.classList.contains('learnkit-hidden-important') || child.getAttribute('data-learnkit-hidden') === 'true';
    // Raw cloze list blocks that contain {{c…}} syntax are never meant to
    // be visible — treat them as hidden residue and fold into the current
    // card-run so they don't break the masonry column layout.
    const isRawClozeList = !isCard && !isHidden && currentRun !== null &&
      (child.classList.contains('el-ul') || child.classList.contains('el-ol')) &&
      /\{\{c\d+::/.test((child).innerText || (child).textContent || '');

    if (isCard && !isHidden) {
      if (!currentRun) {
        currentRun = section.ownerDocument.createElement('div');
        currentRun.className = 'learnkit-reading-card-run';
        section.insertBefore(currentRun, child);
      }
      currentRun.appendChild(child);
      continue;
    }

    // Hidden elements (duplicate siblings from multi-line card blocks)
    // should stay inside the current card-run so they don't break the
    // masonry column layout between consecutive visible cards.
    // CSS already hides them via display:none inside the card-run.
    if ((isHidden || isRawClozeList) && currentRun) {
      if (isRawClozeList) {
        child.classList.add('learnkit-hidden-important', 'learnkit-hidden-important');
        child.setAttribute('data-learnkit-hidden', 'true');
      }
      currentRun.appendChild(child);
      continue;
    }

    currentRun = null;
  }

  // Flush any queued MutationObserver records caused by wrapping so the
  // observer doesn't re-process our own DOM rearrangement.
  if (mutationObserver) {
    mutationObserver.takeRecords();
  }
}

function applySectionCardRunLayout(section: HTMLElement, layout: 'masonry' | 'vertical') {
  if (layout === 'masonry') {
    wrapContiguousCardRuns(section);
    return;
  }

  unwrapCardRuns(section);
}

function resolveSectionLayoutFromDomAndSettings(
  section: HTMLElement,
  rvSettings: ReadingViewSettings | undefined,
): 'masonry' | 'vertical' {
  if (section.querySelector('.learnkit-pretty-card.learnkit-macro-flashcards, .learnkit-pretty-card.learnkit-macro-classic')) {
    return 'masonry';
  }

  if (rvSettings) {
    const macroPreset = normaliseMacroPreset((rvSettings.activeMacro as string | undefined) ?? rvSettings.preset);
    return resolveReadingLayout(rvSettings.layout, macroPreset);
  }

  return 'masonry';
}

function applyLayoutToSections(sections: Iterable<HTMLElement>, rvSettings: ReadingViewSettings | undefined) {
  for (const section of sections) {
    const effectiveLayout = resolveSectionLayoutFromDomAndSettings(section, rvSettings);
    if (effectiveLayout === 'vertical') {
      section.classList.add('learnkit-layout-vertical', 'learnkit-layout-vertical');
      section.classList.remove('learnkit-layout-masonry', 'learnkit-layout-masonry');
      applySectionCardRunLayout(section, 'vertical');
    } else {
      section.classList.remove('learnkit-layout-vertical', 'learnkit-layout-vertical');
      section.classList.add('learnkit-layout-masonry', 'learnkit-layout-masonry');
      applySectionCardRunLayout(section, 'masonry');
    }
  }
}

function collectSectionsWithPrettyCards(scope: ParentNode): Set<HTMLElement> {
  const sections = new Set<HTMLElement>();

  if (scope instanceof HTMLElement) {
    // If scope itself is a .markdown-preview-section containing cards
    if (scope.classList.contains('markdown-preview-section') && scope.querySelector('.learnkit-pretty-card')) {
      sections.add(scope);
    }
    // If scope itself is (or has become) a pretty card, find its parent section
    if (scope.classList.contains('learnkit-pretty-card')) {
      const section = scope.closest<HTMLElement>('.markdown-preview-section');
      if (section) sections.add(section);
    }
  }

  scope.querySelectorAll<HTMLElement>('.learnkit-pretty-card').forEach((card) => {
    const section = card.closest<HTMLElement>('.markdown-preview-section');
    if (section) sections.add(section);
  });

  return sections;
}

function reflowPrettyCardLayouts(scope: ParentNode = document): void {
  const sections = collectSectionsWithPrettyCards(scope);
  if (!sections.size) return;
  const rvSettings = getSproutPlugin()?.settings?.readingView;
  applyLayoutToSections(sections, rvSettings);
}

function scheduleViewportReflow(): void {
  if (viewportReflowTimer) {
    window.cancelAnimationFrame(viewportReflowTimer);
  }
  viewportReflowTimer = window.requestAnimationFrame(() => {
    viewportReflowTimer = null;
    reflowPrettyCardLayouts(document);
  });
}

/* =========================
   Sibling hiding
   ========================= */

/**
 * Strip markdown formatting characters so that raw source text and
 * Obsidian-rendered DOM text can be compared reliably.
 * Removes: inline code (`…`), LaTeX delimiters ($…$ / $$…$$),
 *          bold (**), italic (*), cloze delimiters ({{c1:: … }}),
 *          wiki-link brackets ([[…]]), image embeds (![[…]]),
 *          and normalises whitespace.
 */
function stripMarkdownFormatting(s: string): string {
  let out = s;
  // Remove list markers at line starts so DOM list text can match raw markdown.
  out = out.replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "");
  // Remove inline code backticks (`…`) so DOM-rendered text without <code>
  // formatting can match the raw source.
  out = out.replace(/`+/g, "");
  // Remove LaTeX $ / $$ delimiters so text rendered by MathJax (which
  // drops $ signs from `innerText`) still matches the card source.
  out = out.replace(/\$\$?/g, "");
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
  cardTextRaw: string,
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

  // Extra guard for rendered list blocks that may include formatting artifacts.
  // If each list line can be mapped back to the raw card source (with or without
  // markdown list marker), treat it as belonging to the same card.
  if (siblingEl.classList.contains('el-ul') || siblingEl.classList.contains('el-ol')) {
    const listLines = String(siblingText ?? '')
      .split(/\r?\n/g)
      .map((line) => clean(line).trim())
      .filter(Boolean);

    if (listLines.length > 0 && cardTextRaw) {
      const allLinesFound = listLines.every((line) =>
        cardTextRaw.includes(line) ||
        cardTextRaw.includes(`- ${line}`) ||
        cardTextRaw.includes(`* ${line}`) ||
        cardTextRaw.includes(`+ ${line}`) ||
        (cardTextStripped && (cardTextStripped.includes(line) || cardTextStripped.includes(stripMarkdownFormatting(line)))),
      );
      if (allLinesFound) return true;
    }
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

function isLikelyDanglingCardResidue(siblingText: string, siblingEl: Element): boolean {
  // Apply this heuristic to paragraph/list-like spillover blocks.
  if (!(
    siblingEl.classList.contains('el-p') ||
    siblingEl.classList.contains('el-div') ||
    siblingEl.classList.contains('el-ul') ||
    siblingEl.classList.contains('el-ol')
  )) {
    return false;
  }

  const lines = String(siblingText ?? '')
    .split(/\r?\n/g)
    .map((line) => clean(line).trim())
    .filter(Boolean);

  if (!lines.length) return false;
  if (lines.some((line) => ANCHOR_RE.test(line) || /^#{1,6}\s/.test(line))) return false;

  const delimEsc = escapeDelimiterRe();
  const fieldStartRe = new RegExp(`^([A-Za-z]+|\\d{1,2})\\s*${delimEsc}\\s*`);
  const trailingDelimRe = new RegExp(`${delimEsc}\\s*$`);
  const isListBlock =
    siblingEl.classList.contains('el-ul') ||
    siblingEl.classList.contains('el-ol');

  // If this already looks like a valid card field start, leave it visible.
  // List spillover can contain field-start remnants (e.g. "I | ...") and
  // should still be considered for hiding.
  if (!isListBlock && lines.some((line) => fieldStartRe.test(line))) return false;

  // Typical orphan residue from malformed/unfinished multiline card fields
  // contains a dangling trailing delimiter line (e.g. "What |", "Lol |").
  if (!lines.some((line) => trailingDelimRe.test(line))) return false;

  // Restrict to flashcard section context so ordinary prose elsewhere is untouched.
  const section = siblingEl.closest<HTMLElement>('.markdown-preview-section');
  if (section) {
    // Vertical clean-markdown layout can render cards directly under the
    // section without a .learnkit-reading-card-run wrapper.
    const hasReadingCards = !!section.querySelector('.learnkit-pretty-card[data-learnkit-processed], .learnkit-pretty-card[data-sprout-processed]');
    if (!hasReadingCards) return false;
  }

  return true;
}

export function __testIsLikelyDanglingCardResidue(siblingText: string, siblingEl: Element): boolean {
  return isLikelyDanglingCardResidue(siblingText, siblingEl);
}

/**
 * Hide duplicate siblings after individual cards.
 * Obsidian's reading-view renderer splits card blocks at blank lines,
 * creating sibling `.el-p` / `.el-ol` / `.el-ul` elements that duplicate
 * content already rendered inside the pretty-card.
 */
function hideCardSiblingElements(cardEl: HTMLElement, cardRawText?: string) {
  const cardTextRaw = cardRawText ? clean(cardRawText) : "";
  const cardTextNorm = cardTextRaw ? cardTextRaw.replace(/\s+/g, " ").trim() : "";
  // Strip markdown from the raw multiline source (before whitespace collapse)
  // so list markers at line starts are removed correctly.
  const cardTextStripped = cardTextRaw ? stripMarkdownFormatting(cardTextRaw) : "";
  const cardMathSig = cardTextNorm ? normalizeMathSignature(cardTextNorm) : "";

  const toHide: Element[] = [];

  // ── Forward scan (next siblings) ──
  // Prefer card-local siblings first. If this is the last card in a run,
  // fall back to the run's next sibling to catch trailing spillover nodes.
  let next = cardEl.nextElementSibling;
  if (!next) {
    const run = cardEl.closest('.learnkit-reading-card-run');
    if (run && cardEl.parentElement === run) {
      // Only scan beyond the card-run wrapper when the next element is
      // already hidden residue or a list block (card I| spillover is
      // routinely rendered as .el-ol/.el-ul by Obsidian's parser).
      // Never scan into arbitrary prose paragraphs that happen to
      // follow the card-run — those are guarded by collectSiblingsToHide
      // checking siblingTextBelongsToCard before hiding anything.
      const candidate = run.nextElementSibling;
      if (candidate instanceof HTMLElement) {
        const isHiddenResidue =
          candidate.classList.contains('learnkit-hidden-important') ||
          candidate.getAttribute('data-learnkit-hidden') === 'true';
        const isListSpillover =
          candidate.classList.contains('el-ul') ||
          candidate.classList.contains('el-ol');
        if (isHiddenResidue || isListSpillover) {
          next = candidate;
        }
      }
    }
  }
  collectSiblingsToHide(next, 'next', toHide, cardEl, cardTextStripped, cardTextNorm, cardTextRaw, cardMathSig);

  // ── Backward scan (previous siblings) ──
  // Raw list blocks can sometimes appear before the card in the DOM (e.g. when
  // Obsidian's renderer injects the <ul> before the anchor paragraph).
  let prev = cardEl.previousElementSibling;
  if (!prev) {
    const run = cardEl.closest('.learnkit-reading-card-run');
    if (run && cardEl.parentElement === run) {
      const candidate = run.previousElementSibling;
      if (candidate instanceof HTMLElement) {
        const isHiddenResidue =
          candidate.classList.contains('learnkit-hidden-important') ||
          candidate.getAttribute('data-learnkit-hidden') === 'true';
        const isListSpillover =
          candidate.classList.contains('el-ul') ||
          candidate.classList.contains('el-ol');
        if (isHiddenResidue || isListSpillover) {
          prev = candidate;
        }
      }
    }
  }
  collectSiblingsToHide(prev, 'prev', toHide, cardEl, cardTextStripped, cardTextNorm, cardTextRaw, cardMathSig);

  // Hide collected elements with increased specificity
  for (const el of toHide) {
    (el as HTMLElement).classList.add('learnkit-hidden-important', 'learnkit-hidden-important');
    (el as HTMLElement).setAttribute('data-learnkit-hidden', 'true');
  }
}

function collectSiblingsToHide(
  start: Element | null,
  direction: 'next' | 'prev',
  toHide: Element[],
  cardEl: HTMLElement,
  cardTextStripped: string,
  cardTextNorm: string,
  cardTextRaw: string,
  cardMathSig: string,
): void {
  let sibling = start;
  while (sibling) {
    const classes = sibling.className || '';

    // Skip siblings already hidden by a previous run
    if (sibling.hasAttribute('data-learnkit-hidden')) {
      sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
      continue;
    }

    // Stop if we hit another sprout card (already processed)
    if (classes.includes('learnkit-pretty-card') || classes.includes('learnkit-reading-card-run') || sibling.hasAttribute('data-learnkit-processed')) {
      break;
    }

    // Stop if we hit an anchor for another card (unprocessed .el-p with card anchor)
    if (classes.includes('el-p') && !classes.includes('learnkit-pretty-card')) {
      const txt = extractRawTextFromParagraph(sibling as HTMLElement);
      const cleanTxt = clean(txt);
      if (ANCHOR_RE.test(cleanTxt) && !hasCardAnchorForId(cleanTxt, String(cardEl.dataset.sproutId || ""))) {
        break;
      }
    }

    // Never hide Obsidian's scroll-spacer (markdown-preview-pusher)
    if (classes.includes('markdown-preview-pusher')) {
      break;
    }

    // Never hide footnote paragraphs ([^1]: … rendered by Obsidian)
    const rawText = (sibling as HTMLElement).innerText || (sibling as HTMLElement).textContent || '';
    if (/^\[\^.+?\]:/.test(rawText.trim())) {
      break;
    }

    // Never hide section headings (.el-h1 through .el-h6) or horizontal rules
    if (/\bel-h[1-6]\b/.test(classes) || classes.includes('el-hr')) {
      break;
    }

    // Extract text from the sibling, regardless of its element type
    let raw = "";
    if (classes.includes('el-p')) {
      raw = extractRawTextFromParagraph(sibling as HTMLElement);
    } else if (classes.includes('el-div')) {
      raw = extractTextWithLaTeX(sibling as HTMLElement);
    } else if (
      classes.includes('el-ol') ||
      classes.includes('el-ul') ||
      classes.includes('el-blockquote') ||
      classes.includes('el-table')
    ) {
      // For structural elements, check if their text belongs to the card
      raw = (sibling as HTMLElement).innerText || (sibling as HTMLElement).textContent || '';
    } else if (classes.includes('el-pre')) {
      // Code blocks — stop unless text is part of card
      raw = (sibling as HTMLElement).textContent || '';
    } else {
      // Unknown element type — try text content before giving up
      raw = (sibling as HTMLElement).textContent || '';
      if (!raw.trim()) {
        // Empty unknown elements — safe to hide
        toHide.push(sibling);
        sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
        continue;
      }
    }

    if (siblingTextBelongsToCard(raw, cardTextStripped, cardTextNorm, cardTextRaw, cardMathSig, sibling)) {
      toHide.push(sibling);
      sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
      continue;
    }

    if (isLikelyDanglingCardResidue(raw, sibling)) {
      toHide.push(sibling);
      sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
      continue;
    }

    // No match — stop hiding in this direction so normal content can render
    break;
  }
}

function scheduleDeferredSiblingHide(cardEl: HTMLElement, cardRawText?: string) {
  // Schedule a single deferred pass for structural blocks (lists, tables)
  // that Obsidian injects after the initial markdown render.  Multiple
  // staggered passes caused race conditions where stale DOM state led to
  // hiding legitimate non-card prose (footnotes, headings, etc.) that
  // happened to follow a card-run wrapper.
  window.requestAnimationFrame(() => {
    try {
      hideCardSiblingElements(cardEl, cardRawText);
    } catch {
      // Best-effort cleanup only.
    }
  });
}

function hideSectionLevelOrphanDelimitedParagraphs(scope: ParentNode): void {
  const sections: HTMLElement[] = [];
  if (scope instanceof HTMLElement) {
    if (scope.classList.contains('markdown-preview-section')) {
      sections.push(scope);
    }
    scope.querySelectorAll<HTMLElement>('.markdown-preview-section').forEach((sec) => sections.push(sec));
  }

  const delimEsc = escapeDelimiterRe();
  const trailingDelimRe = new RegExp(`${delimEsc}\\s*$`);

  for (const section of sections) {
    const hasReadingCards = !!section.querySelector('.learnkit-pretty-card[data-learnkit-processed], .learnkit-pretty-card[data-sprout-processed]');
    if (!hasReadingCards) continue;

    const children = Array.from(section.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      const isParagraph = el.classList.contains('el-p');
      const isListBlock = el.classList.contains('el-ul') || el.classList.contains('el-ol');
      if (!isParagraph && !isListBlock) continue;
      if (isParagraph && el.hasAttribute('data-learnkit-processed')) continue;

      const raw = isParagraph
        ? extractRawTextFromParagraph(el)
        : (el.innerText || el.textContent || '');
      const lines = String(raw ?? '')
        .split(/\r?\n/g)
        .map((line) => clean(line).trim())
        .filter(Boolean);
      if (!lines.length) continue;
      if (lines.some((line) => ANCHOR_RE.test(line) || /^#{1,6}\s/.test(line))) continue;
      if (!lines.some((line) => trailingDelimRe.test(line))) continue;

      const prev = children[i - 1] ?? null;
      const next = children[i + 1] ?? null;
      const nearCardRun =
        !!prev?.classList.contains('learnkit-reading-card-run') ||
        !!next?.classList.contains('learnkit-reading-card-run');

      const nearProcessedCard =
        !!prev?.classList.contains('learnkit-pretty-card') ||
        !!next?.classList.contains('learnkit-pretty-card') ||
        !!prev?.hasAttribute('data-learnkit-processed') ||
        !!next?.hasAttribute('data-learnkit-processed');

      if (!nearCardRun && !nearProcessedCard) continue;

      // For list blocks, require residue-like content to avoid touching
      // legitimate author lists near cards.
      if (isListBlock && !isLikelyDanglingCardResidue(raw, el)) continue;

      el.classList.add('learnkit-hidden-important', 'learnkit-hidden-important');
      el.setAttribute('data-learnkit-hidden', 'true');
    }
  }
}

/* =========================
   Card enhancement
   ========================= */

function toTextField(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('\n').trim();
  return String(value ?? '').trim();
}

function splitLegacyListField(value: string): string[] {
  const source = String(value ?? '');
  if (!source.trim()) return [];

  const lines = source.split('\n');
  const entries: string[] = [];
  let current = '';
  let inDisplayMath = false;

  const countUnescapedDisplayDelims = (line: string): number => {
    let count = 0;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === '$' && line[i + 1] === '$' && (i === 0 || line[i - 1] !== '\\')) {
        count++;
        i++;
      }
    }
    return count;
  };

  for (const rawLine of lines) {
    const line = String(rawLine ?? '');
    const shouldContinueFromPrev =
      current.length > 0 && (inDisplayMath || current.trimEnd().endsWith('\\'));

    if (!current) {
      current = line;
    } else if (shouldContinueFromPrev) {
      current += `\n${line}`;
    } else {
      const trimmedPrev = current.trim();
      if (trimmedPrev) entries.push(trimmedPrev);
      current = line;
    }

    const delimCount = countUnescapedDisplayDelims(line);
    if (delimCount % 2 === 1) inDisplayMath = !inDisplayMath;
  }

  const trimmedCurrent = current.trim();
  if (trimmedCurrent) entries.push(trimmedCurrent);
  return entries;
}

function toListField(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }
  return splitLegacyListField(String(value ?? ''));
}

type CleanMarkdownClozeStyle = {
  bgColor?: string;
  textColor?: string;
  renderAsTokenText?: boolean;
};

function sanitizeHexColor(value: string | undefined): string {
  const v = String(value ?? '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : '';
}

function buildCleanMarkdownClozeSpanStyle(style?: CleanMarkdownClozeStyle): string {
  const bg = sanitizeHexColor(style?.bgColor);
  const text = sanitizeHexColor(style?.textColor);
  if (!bg && !text) return '';
  const rules: string[] = [];
  if (bg) rules.push(`--learnkit-clean-md-cloze-bg: ${bg}`);
  if (text) {
    rules.push(`--learnkit-clean-md-cloze-text: ${text}`);
    rules.push(`--learnkit-cloze-color: ${text}`);
  }
  return ` style="${rules.join('; ')}"`;
}

function resolveCleanMarkdownClozeStyle(plugin: SproutPluginLike | null): CleanMarkdownClozeStyle | undefined {
  if (!plugin) return undefined;

  const cards = plugin.settings?.cards;
  const markdownColours = plugin.settings?.readingView?.macroConfigs?.markdown?.colours;
  const autoDarkAdjust = markdownColours?.autoDarkAdjust !== false;

  const lightBg = sanitizeHexColor(markdownColours?.clozeBgLight) || sanitizeHexColor(cards?.clozeBgColor);
  const lightText = sanitizeHexColor(markdownColours?.clozeTextLight) || sanitizeHexColor(cards?.clozeTextColor);

  const isDark = document.body.classList.contains('theme-dark');
  let bg = isDark ? sanitizeHexColor(markdownColours?.clozeBgDark) : lightBg;
  let text = isDark ? sanitizeHexColor(markdownColours?.clozeTextDark) : lightText;

  if (isDark && autoDarkAdjust) {
    if (!bg && lightBg) bg = deriveColourForDark(lightBg);
    if (!text && lightText) text = deriveTextForDark(lightText);
  }

  if (!bg && !text) return { renderAsTokenText: true };
  return { bgColor: bg, textColor: text, renderAsTokenText: true };
}

/* =========================
   Brace-aware cloze token matching
   ========================= */

interface ClozeMatch {
  /** Start index of `{{cN::` in the source string */
  index: number;
  /** Full matched string `{{cN::...}}` */
  fullMatch: string;
  /** Content between `{{cN::` and `}}` */
  content: string;
}

/**
 * Brace-aware cloze token matcher.
 *
 * Unlike the simple regex `/\{\{c\d+::([\s\S]*?)\}\}/g`, this correctly
 * handles LaTeX content with nested braces (e.g. `\frac{a}{b}`) by
 * tracking brace depth. The cloze `}}` closer is only matched when the
 * brace depth returns to zero.
 *
 * Example:
 *   `{{c1::\( x = \frac{-b}{2a} \)}}`
 *                     ^depth 1  ^depth 0 → these }} are LaTeX, not cloze
 *                                          actual cloze close is the final }}
 */
function matchClozeTokensBraceAware(source: string): ClozeMatch[] {
  const results: ClozeMatch[] = [];
  const opener = /\{\{c\d+::/g;
  let m: RegExpExecArray | null;

  while ((m = opener.exec(source)) !== null) {
    const startIdx = m.index;
    const contentStart = startIdx + m[0].length;
    let depth = 0;
    let i = contentStart;
    let found = false;

    while (i < source.length) {
      if (source[i] === '{') {
        depth++;
      } else if (source[i] === '}') {
        if (depth > 0) {
          depth--;
        } else {
          // depth === 0, check for closing }}
          if (i + 1 < source.length && source[i + 1] === '}') {
            const content = source.slice(contentStart, i);
            const fullMatch = source.slice(startIdx, i + 2);
            results.push({ index: startIdx, fullMatch, content });
            opener.lastIndex = i + 2;
            found = true;
            break;
          }
          // Single } at depth 0 — skip (shouldn't happen in valid cloze)
        }
      }
      i++;
    }

    if (!found) {
      // Malformed cloze — no balanced closing }} found, skip
    }
  }

  return results;
}

/* =========================
   LaTeX rendering via Obsidian API
   ========================= */

/**
 * Regex matching LaTeX delimiters in text.
 *   \( ... \)   — inline math
 *   \[ ... \]   — display math
 *   $$ ... $$   — display math
 *   $ ... $     — inline math (no leading/trailing space)
 */
const LATEX_INLINE_RE = /\\\((.+?)\\\)/g;
const LATEX_DISPLAY_PARENS_RE = /\\\[([\s\S]+?)\\\]/g;
const LATEX_DISPLAY_DOLLAR_RE = /\$\$([\s\S]+?)\$\$/g;
const LATEX_INLINE_DOLLAR_RE = /(?<!\$)\$(?!\$)([^\s$](?:[^$]*[^\s$])?)\$(?!\$)/g;
const LATEX_MATH_BLOCK_RE = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;

function buildLatexMathRangeChecker(text: string): (pos: number) => boolean {
  const ranges: Array<[number, number]> = [];
  LATEX_MATH_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LATEX_MATH_BLOCK_RE.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  if (!ranges.length) return () => false;
  return (pos: number) => ranges.some(([start, end]) => pos >= start && pos < end);
}

/**
 * Walk descendant text nodes of `container` and replace LaTeX delimiters
 * with rendered math elements using Obsidian's `renderMath` API.
 *
 * This is more reliable than MathJax.typesetPromise because it uses the
 * same rendering pipeline Obsidian's MarkdownRenderer uses internally.
 */
function renderLatexInContainer(container: HTMLElement): void {
  // Collect text nodes containing LaTeX markers.
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (!(node instanceof Text)) continue;

    const parent = node.parentElement;
    if (!parent) continue;

    // Skip text nodes inside the hidden original content store.
    if (parent.closest('.learnkit-original-content')) continue;

    // Skip nodes already rendered by Obsidian/MathJax.
    if (parent.closest('.MathJax, mjx-container, .math')) continue;

    const text = node.nodeValue ?? '';
    if (!/\\\(|\\\[|\$\$|\$/.test(text)) continue;

    textNodes.push(node);
  }

  if (textNodes.length === 0) return;

  let rendered = false;

  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? '';
    const parent = textNode.parentNode;
    if (!parent) continue;

    // Build a list of math segments with their positions
    const segments: Array<{ start: number; end: number; source: string; display: boolean }> = [];

    const collectMatches = (re: RegExp, display: boolean) => {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const full = match[0] ?? '';
        const source = match[1] ?? '';
        if (!full || !source.trim()) continue;

        segments.push({
          start: match.index,
          end: match.index + full.length,
          source,
          display,
        });

        if (re.lastIndex === match.index) re.lastIndex += 1;
      }
    };

    // Collect in order of priority (display before inline, $$ before $)
    collectMatches(LATEX_DISPLAY_DOLLAR_RE, true);
    collectMatches(LATEX_DISPLAY_PARENS_RE, true);
    collectMatches(LATEX_INLINE_RE, false);
    collectMatches(LATEX_INLINE_DOLLAR_RE, false);

    if (segments.length === 0) continue;

    // Sort by position and remove overlapping matches (first match wins)
    segments.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      // Prefer wider match when two regexes start at the same location.
      return (b.end - b.start) - (a.end - a.start);
    });
    const filtered: typeof segments = [];
    let lastEnd = 0;
    for (const seg of segments) {
      if (seg.start >= lastEnd) {
        filtered.push(seg);
        lastEnd = seg.end;
      }
    }

    if (filtered.length === 0) continue;

    // Build a document fragment with text + math interleaved
    const frag = document.createDocumentFragment();
    let cursor = 0;

    for (const seg of filtered) {
      // Text before this math segment
      if (seg.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, seg.start)));
      }

      try {
        const normalizedSource = String(seg.source ?? "")
          // Support field style where a trailing backslash escapes the source newline.
          // Preserve command continuations like \frac{...}\n{...}, but keep visual
          // line breaks for normal multiline equations.
          .replace(/\\\r?\n\s*/g, (full: string, offset: number, all: string) => {
            const nextChar = String(all ?? "").slice(offset + full.length, offset + full.length + 1);
            return nextChar === "{" ? "" : "\\\\\n";
          });

        const mathEl = renderMath(normalizedSource.trim(), seg.display);
        frag.appendChild(mathEl);
        rendered = true;
      } catch {
        // Fallback: keep original text
        frag.appendChild(document.createTextNode(text.slice(seg.start, seg.end)));
      }

      cursor = seg.end;
    }

    // Remaining text after last math segment
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    parent.replaceChild(frag, textNode);
  }

  // Finalize MathJax rendering for all newly created math elements
  if (rendered) {
    void finishRenderMath();
  }
}

function renderMarkdownLineWithClozeSpans(value: string, style?: CleanMarkdownClozeStyle): string {
  const source = String(value ?? '');
  if (!source) return '';

  const clozeMatches = matchClozeTokensBraceAware(source);
  const isInsideMath = buildLatexMathRangeChecker(source);
  const spanStyle = buildCleanMarkdownClozeSpanStyle(style);
  let last = 0;
  let out = '';

  for (const cm of clozeMatches) {
    if (cm.index > last) {
      out += processMarkdownFeatures(source.slice(last, cm.index));
    }
    const answer = cm.content.trim();
    if (answer) {
      if (style?.renderAsTokenText) {
        const clozeIdMatch = cm.fullMatch.match(/^\{\{c(\d+)::/i);
        const clozeId = clozeIdMatch?.[1] ?? '1';
        const tokenText = `{{c${clozeId}::${answer}}}`;
        out += `<span class="learnkit-cloze-revealed learnkit-clean-markdown-cloze"${spanStyle}>${escapeHtml(tokenText)}</span>`;
      } else if (isInsideMath(cm.index)) {
        out += `\\boxed{${answer}}`;
      } else {
        out += `<span class="learnkit-cloze-revealed learnkit-clean-markdown-cloze"${spanStyle}>${processMarkdownFeatures(answer)}</span>`;
      }
    }
    last = cm.index + cm.fullMatch.length;
  }

  if (last < source.length) {
    out += processMarkdownFeatures(source.slice(last));
  }

  return out || processMarkdownFeatures(source);
}

function renderMarkdownTextWithExplicitBreaks(value: string, style?: CleanMarkdownClozeStyle): string {
  const source = String(value ?? '');
  if (!source) return '';

  const isInsideMath = buildLatexMathRangeChecker(source);
  let out = '';
  let chunkStart = 0;

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\n') continue;

    const chunk = source.slice(chunkStart, i);
    out += renderMarkdownLineWithClozeSpans(chunk, style);
    out += isInsideMath(i) ? '\n' : '<br>';
    chunkStart = i + 1;
  }

  out += renderMarkdownLineWithClozeSpans(source.slice(chunkStart), style);
  return out;
}

function renderSanitizedPlainTextWithCloze(value: string, style?: CleanMarkdownClozeStyle): string {
  const source = String(value ?? '');
  if (!source) return '';

  const clozeMatches = matchClozeTokensBraceAware(source);
  const spanStyle = buildCleanMarkdownClozeSpanStyle(style);
  let last = 0;
  let out = '';

  for (const cm of clozeMatches) {
    if (cm.index > last) {
      out += escapeHtml(source.slice(last, cm.index));
    }
    const answer = cm.content.trim();
    if (answer) {
      if (style?.renderAsTokenText) {
        const clozeIdMatch = cm.fullMatch.match(/^\{\{c(\d+)::/i);
        const clozeId = clozeIdMatch?.[1] ?? '1';
        const tokenText = `{{c${clozeId}::${answer}}}`;
        out += `<span class="learnkit-cloze-revealed learnkit-clean-markdown-cloze"${spanStyle}>${escapeHtml(tokenText)}</span>`;
      } else {
        out += `<span class="learnkit-cloze-revealed learnkit-clean-markdown-cloze"${spanStyle}>${escapeHtml(answer)}</span>`;
      }
    }
    last = cm.index + cm.fullMatch.length;
  }

  if (last < source.length) {
    out += escapeHtml(source.slice(last));
  }

  return out;
}

function renderSanitizedPlainTextWithBreaks(value: string, style?: CleanMarkdownClozeStyle): string {
  const source = String(value ?? '');
  if (!source) return '';
  return renderSanitizedPlainTextWithCloze(source, style).replace(/\r?\n/g, '<br>');
}

type ParsedListLine = {
  indent: number;
  ordered: boolean;
  content: string;
};

function parseListLines(value: string): ParsedListLine[] | null {
  const source = String(value ?? '').replace(/\r/g, '');
  if (!source.trim()) return null;

  const lines = source.split('\n');
  const parsed: ParsedListLine[] = [];
  const listLineRe = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;

  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(listLineRe);
    if (!m) return null;
    // Normalize indentation depth so one tab or two spaces == one list level.
    const indentRaw = String(m[1] ?? '').replace(/\t/g, '  ');
    const indent = Math.floor(indentRaw.length / 2);
    const marker = String(m[2] ?? '');
    parsed.push({
      indent,
      ordered: /^\d/.test(marker),
      content: String(m[3] ?? ''),
    });
  }

  return parsed.length ? parsed : null;
}

function renderListLinesHtml(
  lines: ParsedListLine[],
  renderItem: (value: string) => string,
  className: string,
): string {
  if (!lines.length) return '';
  const ordered = lines.every((line) => line.ordered);
  const tag = ordered ? 'ol' : 'ul';
  const items = lines
    .map((line) => `<li class="${className}-item" style="--learnkit-list-indent:${line.indent}">${renderItem(line.content)}</li>`)
    .join('');
  return `<${tag} class="${className}">${items}</${tag}>`;
}

function renderSanitizedPlainFieldValue(
  value: string,
  style?: CleanMarkdownClozeStyle,
): { html: string; isBlock: boolean } {
  const parsedList = parseListLines(value);
  if (parsedList) {
    return {
      html: renderListLinesHtml(parsedList, (item) => renderSanitizedPlainTextWithCloze(item, style), 'learnkit-markdown-plain-list'),
      isBlock: true,
    };
  }

  // Mixed content support: render contiguous list blocks as lists and
  // markdown heading lines as real heading tags.
  const source = String(value ?? '').replace(/\r/g, '');
  const lines = source.split('\n');
  const listLineRe = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
  const headingLineRe = /^\s*(#{1,6})\s+(.+)$/;
  if (lines.some((line) => listLineRe.test(line) || headingLineRe.test(line))) {
    const parts: string[] = [];

    const flushListBlock = (blockLines: string[]) => {
      if (!blockLines.length) return;
      const parsed = parseListLines(blockLines.join('\n'));
      if (parsed) {
        parts.push(
          renderListLinesHtml(
            parsed,
            (item) => renderSanitizedPlainTextWithCloze(item, style),
            'learnkit-markdown-plain-list',
          ),
        );
        return;
      }
      for (let k = 0; k < blockLines.length; k++) {
        parts.push(renderSanitizedPlainTextWithCloze(blockLines[k], style));
        if (k < blockLines.length - 1) parts.push('<br>');
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (listLineRe.test(line)) {
        const block: string[] = [line];
        let j = i + 1;
        while (j < lines.length && listLineRe.test(lines[j])) {
          block.push(lines[j]);
          j++;
        }
        flushListBlock(block);
        i = j - 1;
        if (i < lines.length - 1 && lines[i + 1].trim() !== '') parts.push('<br>');
        continue;
      }

      if (line === '') {
        parts.push('<br>');
        continue;
      }

      const headingMatch = line.match(headingLineRe);
      if (headingMatch) {
        const level = Math.max(1, Math.min(6, headingMatch[1].length));
        const headingText = String(headingMatch[2] ?? '').trim();
        parts.push(`<h${level}>${renderSanitizedPlainTextWithCloze(headingText, style)}</h${level}>`);
        continue;
      }

      parts.push(renderSanitizedPlainTextWithCloze(line, style));
      if (i < lines.length - 1 && lines[i + 1].trim() !== '' && !listLineRe.test(lines[i + 1])) {
        parts.push('<br>');
      }
    }

    return {
      html: parts.join(''),
      isBlock: true,
    };
  }

  const hasLineBreaks = /\r?\n/.test(value);
  if (hasLineBreaks) {
    return {
      html: renderSanitizedPlainTextWithBreaks(value, style),
      isBlock: true,
    };
  }

  return {
    html: renderSanitizedPlainTextWithCloze(value, style),
    isBlock: false,
  };
}

function renderFlashcardTextWithListSupport(value: string): string {
  const source = String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n');
  if (!source) return '';

  const parsedList = parseListLines(source);
  if (parsedList) {
    return renderListLinesHtml(parsedList, (item) => renderMarkdownLineWithClozeSpans(item), 'learnkit-flashcard-list');
  }

  // Support mixed markdown blocks (headings + lists + paragraphs) in flashcard
  // reading view so list markers don't render as literal text.
  const lines = source.replace(/\r/g, '').split('\n');
  const parts: string[] = [];
  const listLineRe = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;

  const flushListBlock = (blockLines: string[]) => {
    if (!blockLines.length) return;
    const parsed = parseListLines(blockLines.join('\n'));
    if (parsed) {
      parts.push(renderListLinesHtml(parsed, (item) => renderMarkdownLineWithClozeSpans(item), 'learnkit-flashcard-list'));
    } else {
      // Defensive fallback: render raw lines with breaks if parsing fails.
      for (let k = 0; k < blockLines.length; k++) {
        parts.push(renderMarkdownLineWithClozeSpans(blockLines[k]));
        if (k < blockLines.length - 1) parts.push('<br>');
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (listLineRe.test(line)) {
      const listBlock: string[] = [line];
      let j = i + 1;
      while (j < lines.length && listLineRe.test(lines[j])) {
        listBlock.push(lines[j]);
        j++;
      }
      flushListBlock(listBlock);
      i = j - 1;
      if (i < lines.length - 1 && lines[i + 1].trim() !== '') parts.push('<br>');
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.max(1, Math.min(6, headingMatch[1].length));
      const content = renderMarkdownLineWithClozeSpans(String(headingMatch[2] ?? '').trim());
      parts.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    if (line === '') {
      parts.push('<br>');
      continue;
    }

    parts.push(renderMarkdownLineWithClozeSpans(line));
    if (i < lines.length - 1 && lines[i + 1].trim() !== '' && !listLineRe.test(lines[i + 1])) {
      parts.push('<br>');
    }
  }

  return parts.join('');
}

function buildMarkdownModeContent(card: LearnKitCard, showLabels: boolean, clozeStyle?: CleanMarkdownClozeStyle): string {
  const lines: string[] = [];
  const encodeMdSourceAttr = (text: string): string => escapeHtml(encodeURIComponent(String(text ?? '')));
  const shouldRenderMdSource = (text: string): boolean => {
    const value = String(text ?? '');
    if (!value) return false;
    if (/\{\{c\d+::/i.test(value)) return false;
    return /\\\(|\\\[|\$\$|(^|[^\\])\$(?!\$)/.test(value);
  };
  type MarkdownQuestionLabelType = LearnKitCard['type'] | 'reversed-child' | 'cloze-child' | 'io-child' | 'hq-child' | 'combo-child';
  const questionLabelByType: Partial<Record<MarkdownQuestionLabelType, string>> = {
    basic: 'Basic Question',
    reversed: 'Reversed Question',
    'reversed-child': 'Reversed Question',
    mcq: 'Multiple Choice Question',
    oq: 'Ordered Question',
    cloze: 'Cloze Question',
    'cloze-child': 'Cloze Question',
    io: 'Image Occlusion Question',
    'io-child': 'Image Occlusion Question',
    hq: 'Hotspot Question',
    'hq-child': 'Hotspot Question',
    'combo-child': 'Combo Question',
  };
  const comboLabels: Record<string, string> = {
    product: 'Cross Combo Question',
    zip: 'Sequential Combo Question',
  };
  const questionLabel = card.type === 'combo'
    ? (comboLabels[String(card.comboMode ?? '')] ?? 'Combo Question')
    : (questionLabelByType[card.type] ?? 'Question');

  const addPlainField = (label: string, value: string) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    const renderedField = renderSanitizedPlainFieldValue(v, clozeStyle);
    const sourceAttr = shouldRenderMdSource(v) ? ` data-learnkit-md-source="${encodeMdSourceAttr(v)}"` : '';
    if (renderedField.isBlock) {
      if (showLabels) {
        lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block"><div class="learnkit-markdown-label">${escapeHtml(label)}:</div><div class="learnkit-markdown-plain-block"${sourceAttr}>${renderedField.html}</div></div>`);
      } else {
        lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block"><div class="learnkit-markdown-plain-block"${sourceAttr}>${renderedField.html}</div></div>`);
      }
      return;
    }
    if (showLabels) {
      lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-label">${escapeHtml(label)}:</span> <span class="learnkit-markdown-plain-inline"${sourceAttr}>${renderedField.html}</span></div>`);
    } else {
      lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-plain-inline"${sourceAttr}>${renderedField.html}</span></div>`);
    }
  };

  const addLine = (label: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    const rendered = renderMarkdownLineWithClozeSpans(v, clozeStyle);
    const isBlock = /^\s*<(?:ul|ol|table|blockquote|pre)\b/i.test(rendered);
    if (showLabels && isBlock) {
      lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block"><div class="learnkit-markdown-label">${label}:</div>${rendered}</div>`);
      return;
    }
    lines.push(`<div class="learnkit-markdown-line">${showLabels ? `<span class="learnkit-markdown-label">${label}:</span> ` : ''}${rendered}</div>`);
  };

  const getOqSteps = (): string[] => {
    const fieldsAny = card.fields as Record<string, string | string[] | undefined>;
    const numbered: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const step = toTextField(fieldsAny[String(i)]);
      if (!step) continue;
      numbered.push(step);
    }
    if (numbered.length) return numbered;
    return toListField(card.fields.A);
  };

  const renderList = (items: string[], ordered = false): string => {
    if (!items.length) return '';
    const tag = ordered ? 'ol' : 'ul';
    const listItems = items.map((item) => `<li>${renderMarkdownLineWithClozeSpans(item, clozeStyle)}</li>`).join('');
    return `<${tag}>${listItems}</${tag}>`;
  };

  const addListSection = (label: string, items: string[], ordered = false) => {
    if (!items.length) return;
    const listHtml = renderList(items, ordered);
    lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block">${showLabels ? `<div class="learnkit-markdown-label">${label}:</div>` : ''}${listHtml}</div>`);
  };

  const addGroupsLine = (groups: string[]) => {
    if (!groups.length) return;
    const safeGroups = groups.map((g) => escapeHtml(String(g))).join(', ');
    if (showLabels) {
      lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-label">Groups:</span> <span class="learnkit-markdown-plain-inline">${safeGroups}</span></div>`);
    } else {
      lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-plain-inline">${safeGroups}</span></div>`);
    }
  };

  if (showLabels) {
    addPlainField('Title', String(card.title ?? ''));
  }

  if (card.type === 'mcq') {
    const question = toTextField(card.fields.MCQ);
    const answers = toListField(card.fields.A);
    const optionsRaw = toListField(card.fields.O);
    if (showLabels) {
      addPlainField(questionLabel, question);
    } else {
      addLine(questionLabel, question);
    }

    const seen = new Set<string>();
    const options = [...answers, ...optionsRaw].filter((option) => {
      const key = option.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (showLabels) {
      addPlainField('Options', options.join('\n'));
      addPlainField('Answer', answers.join('\n'));
    } else {
      addListSection('Options', options, false);
      addListSection('Answer', answers, false);
    }
  } else if (card.type === 'oq') {
    if (showLabels) {
      addPlainField(questionLabel, toTextField(card.fields.OQ));
    } else {
      addLine(questionLabel, toTextField(card.fields.OQ));
    }
    const steps = getOqSteps();
    if (showLabels) {
      addPlainField('Answer', steps.join('\n'));
    } else {
      addListSection('Answer', steps, true);
    }
  } else if (card.type === 'cloze') {
    addPlainField(questionLabel, toTextField(card.fields.CQ));
    addPlainField('Extra Information', toTextField(card.fields.I));
  } else if (card.type === 'io' || card.type === 'hq' || card.type === 'io-child' || card.type === 'hq-child') {
    const ioField = card.type === 'hq' || card.type === 'hq-child'
      ? (card.fields.HQ ?? card.fields.IO)
      : card.fields.IO;
    addPlainField(questionLabel, toTextField(ioField));
    const answerLabel = card.type === 'hq' || card.type === 'hq-child' ? 'Hotspot Answer' : 'Answer';
    addPlainField(answerLabel, toTextField(card.fields.A));
    addPlainField('Extra Information', toTextField(card.fields.I));
  } else if (card.type === 'basic' || card.type === 'reversed') {
    const questionField = card.type === 'reversed' ? card.fields.RQ : card.fields.Q;
    addPlainField(questionLabel, toTextField(questionField));
    addPlainField('Answer', toTextField(card.fields.A));
    addPlainField('Extra Information', toTextField(card.fields.I));
  } else if (card.type === 'combo') {
    addPlainField(questionLabel, toTextField(card.fields.Q));
    addPlainField('Answer', toTextField(card.fields.A));
    addPlainField('Extra Information', toTextField(card.fields.I));
  }

  const groups = normalizeGroupsForDisplay(card.fields.G);
  addGroupsLine(groups);

  return `<div class="learnkit-markdown-lines">${lines.join('')}</div>`;
}

export function __testBuildMarkdownModeContent(card: LearnKitCard, showLabels: boolean, clozeStyle?: CleanMarkdownClozeStyle): string {
  return buildMarkdownModeContent(card, showLabels, clozeStyle);
}

function normalizeGroupsForDisplay(groupsField: string | string[] | undefined): string[] {
  if (!groupsField) return [];
  const base = Array.isArray(groupsField) ? groupsField : [String(groupsField)];
  const splitGroups = base.flatMap((group) =>
    String(group)
      .split(/[\n,]/g)
      .map((part) => part.trim())
      .filter(Boolean),
  );
  return splitGroups;
}

function buildFlashcardCloze(text: string, mode: 'front' | 'back'): string {
  return buildReadingFlashcardCloze(text, mode);
}

export function __testBuildFlashcardCloze(text: string, mode: 'front' | 'back'): string {
  return buildFlashcardCloze(text, mode);
}

function buildFlashcardContentHTML(card: LearnKitCard, options: { includeSpeakerButton: boolean; includeEditButton: boolean }): string {
  const idSeed = Math.random().toString(36).slice(2, 8);
  const encodeMdSourceAttr = (text: string): string => escapeHtml(encodeURIComponent(String(text ?? '')));
  const mdSourceAttr = (text: string): string => {
    const value = String(text ?? '');
    if (!value) return '';
    if (!/\\\(|\\\[|\$\$|(^|[^\\])\$(?!\$)/.test(value)) return '';
    return ` data-learnkit-md-source="${encodeMdSourceAttr(value)}"`;
  };
  let front = '';
  let back = '';
  const allowSpeakerForCardType = card.type === 'basic' || card.type === 'reversed' || card.type === 'cloze' || card.type === 'mcq';

  const getOqSteps = (): string[] => {
    const fieldsAny = card.fields as Record<string, string | string[] | undefined>;
    const numbered: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const step = toTextField(fieldsAny[String(i)]);
      if (!step) continue;
      numbered.push(step);
    }
    if (numbered.length) return numbered;
    return toListField(card.fields.A);
  };

  const actionsFor = (side: 'front' | 'back') => {
    const speaker = options.includeSpeakerButton && allowSpeakerForCardType
      ? `<button class="learnkit-flashcard-action-btn learnkit-flashcard-speak-btn" type="button" data-learnkit-tts-side="${side}" aria-label="Read aloud" data-tooltip-position="top"></button>`
      : '';
    const edit = options.includeEditButton
      ? `<button class="learnkit-flashcard-action-btn learnkit-card-edit-btn" type="button" aria-label="Edit card" data-tooltip-position="top"></button>`
      : '';
    if (!edit && !speaker) return '';
    return `<div class="learnkit-flashcard-actions">${edit}${speaker}</div>`;
  };

  if (card.type === 'cloze') {
    const cq = toTextField(card.fields.CQ);
    front = buildFlashcardCloze(cq, 'front');
    back = buildFlashcardCloze(cq, 'back');
  } else if (card.type === 'io' || card.type === 'hq' || card.type === 'io-child' || card.type === 'hq-child') {
    front = `<div class="learnkit-flashcard-io" id="learnkit-io-question-${idSeed}"></div>`;
    back = `<div class="learnkit-flashcard-io" id="learnkit-io-answer-${idSeed}"></div>`;
  } else if (card.type === 'mcq') {
    const q = toTextField(card.fields.MCQ);
    const answers = toListField(card.fields.A)
      .map((s) => String(s).trim())
      .filter(Boolean);
    const wrongOptions = toListField(card.fields.O)
      .map((s) => s.trim())
      .filter(Boolean);

    const answersLower = new Set(answers.map((a) => a.toLowerCase()));
    const seen = new Set<string>();
    const allOptions = [...answers, ...wrongOptions]
      .map((s) => String(s).trim())
      .filter(Boolean)
      .filter((opt) => {
        const key = opt.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    for (let i = allOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]];
    }

    const questionHtml = `<div class="learnkit-flashcard-question-text"${mdSourceAttr(q)}>${renderMarkdownTextWithExplicitBreaks(q)}</div>`;
    const optionsListHtml = allOptions.length
      ? `<ul class="learnkit-flashcard-options learnkit-flashcard-options-list">${allOptions.map((opt) => `<li><span${mdSourceAttr(opt)}>${renderMarkdownLineWithClozeSpans(String(opt))}</span></li>`).join('')}</ul>`
      : '';
    const backOptionsListHtml = allOptions.length
      ? `<ul class="learnkit-flashcard-options learnkit-flashcard-options-list">${allOptions.map((opt) => {
          const rendered = renderMarkdownLineWithClozeSpans(String(opt));
          const isCorrect = answersLower.has(opt.toLowerCase());
          return isCorrect
            ? `<li><span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text"${mdSourceAttr(opt)}>${rendered}</span></span></li>`
            : `<li><span${mdSourceAttr(opt)}>${rendered}</span></li>`;
        }).join('')}</ul>`
      : '';

    front = `${questionHtml}${optionsListHtml}`;
    back = `${questionHtml}${backOptionsListHtml}`;
  } else if (card.type === 'oq') {
    const q = toTextField(card.fields.OQ);
    const steps = getOqSteps();
    const shuffledSteps = [...steps];
    for (let i = shuffledSteps.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledSteps[i], shuffledSteps[j]] = [shuffledSteps[j], shuffledSteps[i]];
    }
    const oqQuestionHtml = `<div class="learnkit-flashcard-question-text"${mdSourceAttr(q)}>${renderMarkdownTextWithExplicitBreaks(q)}</div>`;
    front = `${oqQuestionHtml}${shuffledSteps.length ? `<ul class="learnkit-flashcard-options learnkit-flashcard-options-list">${shuffledSteps.map((s) => `<li><span${mdSourceAttr(s)}>${renderMarkdownLineWithClozeSpans(s)}</span></li>`).join('')}</ul>` : ''}`;
    back = `${oqQuestionHtml}<ol class="learnkit-flashcard-sequence-list">${steps.map((s) => `<li><span${mdSourceAttr(s)}>${renderMarkdownLineWithClozeSpans(s)}</span></li>`).join('')}</ol>`;
  } else if (card.type === 'combo') {
    const qText = toTextField(card.fields.Q);
    const aText = toTextField(card.fields.A);
    front = `<div${mdSourceAttr(qText)}>${renderFlashcardTextWithListSupport(qText)}</div>`;
    back = `<div${mdSourceAttr(aText)}>${renderFlashcardTextWithListSupport(aText)}</div>`;
  } else {
    const q = card.type === 'reversed' ? toTextField(card.fields.RQ) : toTextField(card.fields.Q);
    const a = toTextField(card.fields.A);
    front = `<div${mdSourceAttr(q)}>${renderFlashcardTextWithListSupport(q)}</div>`;
    back = `<div${mdSourceAttr(a)}>${renderFlashcardTextWithListSupport(a)}</div>`;
  }

  const frontBodyClass = card.type === 'cloze'
    ? 'learnkit-flashcard-body learnkit-flashcard-body-cloze'
    : 'learnkit-flashcard-body';
  const backBodyClass = card.type === 'cloze'
    ? 'learnkit-flashcard-body learnkit-flashcard-body-cloze'
    : 'learnkit-flashcard-body';

  return `
    <div class="learnkit-flashcard-question">${actionsFor('front')}<div class="${frontBodyClass}">${front}</div></div>
    <div class="learnkit-flashcard-answer" hidden>${actionsFor('back')}<div class="${backBodyClass}">${back}</div></div>
  `;
}

function buildGroupsSectionHTML(groups: string[]): string {
  if (!groups.length) return '';
  const contentId = `sprout-groups-${Math.random().toString(36).slice(2, 8)}`;
  return `
    <div class="learnkit-card-section learnkit-section-groups">
      <div class="learnkit-section-label">
        <span>Groups</span>
        <button class="learnkit-toggle-btn learnkit-toggle-btn-compact" data-target=".${contentId}" aria-expanded="false" aria-label="Toggle Groups" data-tooltip-position="top">
          <svg class="learnkit-toggle-chevron learnkit-toggle-chevron-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
        </button>
      </div>
      <div class="${contentId} learnkit-collapsible collapsed learnkit-p-spacing-none">
        <div class="learnkit-groups-list">${groups.map(g => `<span class="learnkit-group-tag">${renderMarkdownLineWithClozeSpans(String(g))}</span>`).join('')}</div>
      </div>
    </div>
  `;
}

function applyCustomHookClasses(el: HTMLElement): void {
  if (!el.classList.contains('learnkit-macro-custom')) return;

  el.classList.add('learnkit-custom-root', 'learnkit-custom-root');
  const header = el.querySelector<HTMLElement>('.learnkit-card-header');
  const title = el.querySelector<HTMLElement>('.learnkit-card-title');
  const body = el.querySelector<HTMLElement>('.learnkit-card-content');
  const groups = el.querySelector<HTMLElement>('.learnkit-groups-list');

  header?.classList.add('learnkit-custom-header', 'learnkit-custom-header');
  title?.classList.add('learnkit-custom-title', 'learnkit-custom-title');
  body?.classList.add('learnkit-custom-body', 'learnkit-custom-body');
  groups?.classList.add('learnkit-custom-groups', 'learnkit-custom-groups');

  el.querySelectorAll<HTMLElement>('.learnkit-card-section').forEach((section) => {
    section.classList.add('learnkit-custom-section', 'learnkit-custom-section');
    if (section.classList.contains('learnkit-section-question')) section.classList.add('learnkit-custom-section-question', 'learnkit-custom-section-question');
    if (section.classList.contains('learnkit-section-options')) section.classList.add('learnkit-custom-section-options', 'learnkit-custom-section-options');
    if (section.classList.contains('learnkit-section-answer')) section.classList.add('learnkit-custom-section-answer', 'learnkit-custom-section-answer');
    if (section.classList.contains('learnkit-section-info')) section.classList.add('learnkit-custom-section-info', 'learnkit-custom-section-info');
    if (section.classList.contains('learnkit-section-groups')) section.classList.add('learnkit-custom-section-groups', 'learnkit-custom-section-groups');
  });

  el.querySelectorAll<HTMLElement>('.learnkit-section-label').forEach((label) => {
    label.classList.add('learnkit-custom-label', 'learnkit-custom-label');
  });

  el.querySelectorAll<HTMLElement>('.learnkit-section-content').forEach((content) => {
    content.classList.add('learnkit-custom-content', 'learnkit-custom-content');
  });
}

function setupGuidebookCarousel(el: HTMLElement) {
  if (!el.classList.contains('learnkit-macro-guidebook')) return;
  const content = el.querySelector<HTMLElement>('.learnkit-card-content');
  if (!content) return;

  const slides = Array.from(content.querySelectorAll<HTMLElement>('.learnkit-card-section'));
  if (slides.length <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'learnkit-guidebook-nav learnkit-guidebook-nav-prev';
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Previous section');
  prevBtn.textContent = '‹';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'learnkit-guidebook-nav learnkit-guidebook-nav-next';
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Next section');
  nextBtn.textContent = '›';

  const dots = document.createElement('div');
  dots.className = 'learnkit-guidebook-dots';
  const dotEls = slides.map((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'learnkit-guidebook-dot';
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
  wrap.className = 'learnkit-guidebook-controls';
  wrap.appendChild(prevBtn);
  wrap.appendChild(dots);
  wrap.appendChild(nextBtn);
  el.appendChild(wrap);
}

function setupFlashcardFlip(el: HTMLElement) {
  if (!el.classList.contains('learnkit-macro-flashcards')) return;
  type FlashcardFlipElement = HTMLElement & { __sproutFlipAC?: AbortController };
  const flipEl = el as FlashcardFlipElement;
  const content = el.querySelector<HTMLElement>('.learnkit-card-content');
  if (!content) return;
  const question = content.querySelector<HTMLElement>('.learnkit-flashcard-question');
  const answer = content.querySelector<HTMLElement>('.learnkit-flashcard-answer');
  if (!question || !answer) return;

  // Abort any previous flip handler so stale listeners referencing
  // detached Q/A elements don't block the current handler.
  const prev = flipEl.__sproutFlipAC;
  if (prev) prev.abort();
  const ac = new AbortController();
  flipEl.__sproutFlipAC = ac;

  let showingAnswer = false;

  const applyFaceState = () => {
    question.hidden = showingAnswer;
    answer.hidden = !showingAnswer;
    el.classList.toggle('learnkit-flashcard-flipped', showingAnswer);
  };

  const recalcHeight = () => {
    const prevQHidden = question.hidden;
    const prevAHidden = answer.hidden;
    question.hidden = false;
    answer.hidden = false;

    const maxH = Math.max(question.scrollHeight, answer.scrollHeight, 120);

    question.hidden = prevQHidden;
    answer.hidden = prevAHidden;

    setCssProps(el, { '--learnkit-flashcard-height': `${Math.ceil(maxH)}px` });
  };

  el.addEventListener('click', (ev: Event) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest('.learnkit-card-edit-btn, .learnkit-flashcard-speak-btn')) return;
    if (el.classList.contains('learnkit-flashcard-animating')) return;

    const before = snapshotCardPositions(el);

    el.classList.add('learnkit-flashcard-animating', 'learnkit-flashcard-animating');
    window.setTimeout(() => {
      showingAnswer = !showingAnswer;
      applyFaceState();

      requestAnimationFrame(() => {
        flipAnimateCards(before, el);
      });
    }, 180);
    window.setTimeout(() => {
      el.classList.remove('learnkit-flashcard-animating', 'learnkit-flashcard-animating');
    }, 360);
  }, { signal: ac.signal });

  applyFaceState();
  window.setTimeout(recalcHeight, 0);
  window.setTimeout(recalcHeight, 120);
}

function enhanceCardElement(
  el: HTMLElement,
  card: LearnKitCard,
  originalContentOverride?: string,
  cardRawText?: string,
  skipSiblingHiding = false,
) {
  const originalContent = originalContentOverride
    ?? el.querySelector<HTMLElement>('.learnkit-original-content')?.innerHTML
    ?? el.innerHTML;
  el.replaceChildren();

  // Determine reading style from plugin instance (Obsidian context)
  let macroPreset: ReturnType<typeof normaliseMacroPreset> = 'flashcards';
  let visibleFields: NonNullable<ReadingViewSettings>["visibleFields"] | undefined;
  let displayLabels = true;
  let ttsEnabled = false;
  let showFlashcardAudioButton = true;
  let showFlashcardEditButton = true;
  let audioSettings: AudioSettings | null = null;
  let markdownClozeStyle: CleanMarkdownClozeStyle | undefined;
  try {
    const activePlugin = getSproutPlugin();
    const stylesEnabled = activePlugin
      ? !!activePlugin.settings?.general?.enableReadingStyles
      : true;
    if (activePlugin && !stylesEnabled) {
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
    showFlashcardAudioButton = macroConfig?.fields?.displayAudioButton !== false;
    showFlashcardEditButton = macroConfig?.fields?.displayEditButton !== false;
    audioSettings = activePlugin?.settings?.audio ?? null;
    markdownClozeStyle = resolveCleanMarkdownClozeStyle(activePlugin);
  } catch (e) { log.swallow("read prettify plugin setting", e); }

  el.classList.add(
    'learnkit-pretty-card', 'learnkit-pretty-card',
    'learnkit-reading-card', 'learnkit-reading-card',
    'learnkit-reading-view-wrapper', 'learnkit-reading-view-wrapper',
    'accent',
    `learnkit-macro-${macroPreset}`,
  );

  el.dataset.sproutId = card.anchorId;
  el.dataset.sproutType = card.type;
  
  // Store raw text for masonry grid sibling hiding
  if (cardRawText) {
    el.setAttribute('data-learnkit-raw-text', cardRawText);
  }

  // ── Build groups HTML (always rendered; visibility controlled by dynamic CSS) ──
  let groupsHtml = '';
  const groups = card.fields.G;
  if (groups) {
    const groupArr = normalizeGroupsForDisplay(groups);
    if (groupArr.length > 0) {
      groupsHtml = macroPreset === 'markdown'
        ? ''
        : macroPreset === 'classic'
        ? buildGroupsSectionHTML(groupArr)
        : `<div class="learnkit-groups-list">${groupArr.map(g => `<span class="learnkit-group-tag">${renderMarkdownLineWithClozeSpans(String(g))}</span>`).join('')}</div>`;
    }
  }

  const cardContentHTML = macroPreset === 'markdown'
    ? buildMarkdownModeContent(card, displayLabels, markdownClozeStyle)
    : macroPreset === 'flashcards'
      ? buildFlashcardContentHTML(card, {
        includeSpeakerButton: ttsEnabled && showFlashcardAudioButton,
        includeEditButton: showFlashcardEditButton,
      })
      : buildCardContentHTML(card);

    const headerHTML = macroPreset === 'flashcards'
      ? ``
      : macroPreset === 'markdown'
        ? ``
        : `<div class="learnkit-card-header learnkit-reading-card-header"><div class="learnkit-card-title learnkit-reading-card-title">${processMarkdownFeatures(card.title || '')}</div><span class="learnkit-card-edit-btn" role="button" aria-label="Edit card" data-tooltip-position="top" tabindex="0"></span></div>`;

    const innerHTML = `
      ${headerHTML}

      <div class="learnkit-card-content learnkit-reading-card-content">
        ${cardContentHTML}
      </div>

      ${groupsHtml}

      <div class="learnkit-original-content" aria-hidden="true">${originalContent}</div>
    `;

  replaceChildrenWithHTML(el, innerHTML);
  el.classList.add('learnkit-single-card', 'learnkit-single-card');
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
    el.toggleAttribute('data-hide-edit', !isFlashcardsMacro && visibleFields.edit === false);
  }
  el.toggleAttribute('data-hide-labels', !displayLabels);

  // Hide any sibling elements that were part of this card's content
  // (Obsidian renders block math as separate <div class="el-div"> siblings)
  if (!skipSiblingHiding) {
    hideCardSiblingElements(el, cardRawText);
    scheduleDeferredSiblingHide(el, cardRawText);
  }

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
  const editBtns = Array.from(el.querySelectorAll<HTMLElement>(".learnkit-card-edit-btn"));
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
      if (targetCard.type === "io" || targetCard.type === "hq" || targetCard.type === "io-child" || targetCard.type === "hq-child") {
        const parentId = targetCard.type.endsWith("-child")
          ? String(targetCard.parentId || "")
          : String(targetCard.id);
        if (!parentId) {
          new Notice(t(plugin?.settings?.general?.interfaceLanguage, "ui.reading.notice.cardParentNotFound", "Card parent not found."));
          return;
        }
        ImageOcclusionCreatorModal.openForParent(plugin as unknown as LearnKitPlugin, parentId, {
          onClose: () => {
            if (typeof plugin.refreshAllViews === "function") {
              plugin.refreshAllViews();
            }
          },
        });
        return;
      }

      void openBulkEditModalForCards(plugin as unknown as LearnKitPlugin, [targetCard], async (updatedCards) => {
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
          const updatedSource = lines.join("\n");

          await plugin.app.vault.modify(file, updatedSource);
          await syncOneFile(plugin as unknown as LearnKitPlugin, file, {
            pruneGlobalOrphans: false,
            sourceTextOverride: updatedSource,
          });

          // Force a deterministic in-place reading refresh after modal saves so
          // spillover list blocks are rehidded without leaving/reopening the note.
          await forceReadingViewRefreshAfterModalSave(plugin, file.path, updatedSource);
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
  }

  const speakBtns = Array.from(el.querySelectorAll<HTMLElement>(".learnkit-flashcard-speak-btn"));
  for (const speakBtn of speakBtns) {
    setIcon(speakBtn, "volume-2");
    speakBtn.tabIndex = 0;
    speakBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!ttsEnabled || !audioSettings?.enabled) return;

      const tts = getTtsService();
      if (!tts.isSupported) return;
      if (tts.isSpeaking) {
        tts.stop();
        return;
      }

      const side = ((e.currentTarget as HTMLElement).getAttribute("data-learnkit-tts-side") === "back") ? "back" : "front";
      const panelSelector = side === "back" ? ".learnkit-flashcard-answer" : ".learnkit-flashcard-question";
      const cardContent = el.querySelector<HTMLElement>('.learnkit-card-content');
      const panel = (cardContent ?? el).querySelector<HTMLElement>(panelSelector);
      if (!panel) return;

      const isClozeLike = el.dataset.sproutType === "cloze" || el.dataset.sproutType === "cloze-child";

      const rawQuestion = card.type === "reversed"
        ? toTextField(card.fields.RQ)
        : toTextField(card.fields.Q);
      const rawAnswer = toTextField(card.fields.A);
      const rawCloze = toTextField(card.fields.CQ);

      const panelText = (panel.innerText || panel.textContent || "").replace(/\s+/g, " ").trim();
      const imageAlt = Array.from(panel.querySelectorAll<HTMLImageElement>("img[alt]"))
        .filter((img) => !img.classList.contains("learnkit-inline-flag") && !img.hasAttribute("data-learnkit-flag-code"))
        .map((img) => (img.alt || "").trim())
        .filter(Boolean)
        .join(" ");
      const domFallback = [panelText, imageAlt].filter(Boolean).join(" ").trim();

      const readingCacheId = card.anchorId ? `${card.anchorId}-${side === "back" ? "answer" : "question"}` : undefined;

      if (isClozeLike) {
        const clozeSource = rawCloze || String(card.fields.CQ ?? "");
        if (!clozeSource && !domFallback) return;
        if (clozeSource) {
          tts.speakClozeCard(clozeSource, side === "back", null, {
            ...DEFAULT_SETTINGS.audio,
            ...(audioSettings ?? {}),
            scriptLanguages: {
              ...DEFAULT_SETTINGS.audio.scriptLanguages,
              ...(audioSettings?.scriptLanguages ?? {}),
            },
          }, readingCacheId);
          return;
        }
      }

      const fieldText = side === "back" ? rawAnswer : rawQuestion;
      const text = (fieldText || domFallback || "").trim();
      if (!text) return;
      const mergedAudio = {
        ...DEFAULT_SETTINGS.audio,
        ...(audioSettings ?? {}),
        scriptLanguages: {
          ...DEFAULT_SETTINGS.audio.scriptLanguages,
          ...(audioSettings?.scriptLanguages ?? {}),
        },
      };
      tts.speakBasicCard(text, mergedAudio, readingCacheId);
    });

    speakBtn.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      (ev.currentTarget as HTMLElement)?.click();
    });
  }

  // Hook up toggles inside this card
  const toggles = el.querySelectorAll<HTMLButtonElement>('.learnkit-toggle-btn');
  toggles.forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (!target) return;
    const content = el.querySelector<HTMLElement>(target);
    if (!content) return;
    const section = btn.closest('.learnkit-card-section');
    const isAnswer = !!section?.classList.contains('learnkit-section-answer');
    const isGroups = !!section?.classList.contains('learnkit-section-groups');
    const isInfo = !!section?.classList.contains('learnkit-section-info');
    const defaultExpanded =
      macroPreset === 'guidebook' || macroPreset === 'markdown'
        ? true
        : macroPreset === 'classic'
          ? !(isAnswer || isGroups || isInfo)
          : false;

    content.classList.add('learnkit-collapsible', 'learnkit-collapsible');
    content.classList.toggle('collapsed', !defaultExpanded);
    content.classList.toggle('expanded', defaultExpanded);
    btn.setAttribute('aria-expanded', defaultExpanded ? 'true' : 'false');
    const chevron = btn.querySelector<HTMLElement>('.learnkit-toggle-chevron');
    if (chevron) {
      chevron.classList.toggle('learnkit-reading-chevron-collapsed', !defaultExpanded);
    }
    const isFlashcards = el.classList.contains('learnkit-macro-flashcards');
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
        if (chevron) chevron.classList.add('learnkit-reading-chevron-collapsed', 'learnkit-reading-chevron-collapsed');
      } else {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.classList.remove('learnkit-reading-chevron-collapsed', 'learnkit-reading-chevron-collapsed');
      }

      // FLIP step 2: after the browser reflows, animate cards
      // from their old positions to their new ones
      requestAnimationFrame(() => {
        flipAnimateCards(before, el);
      });
    });
  });

  // Render LaTeX synchronously so math displays immediately.
  // The async renderMdInElements may bail early if the plugin/app
  // reference is not yet available, so this serves as a reliable
  // primary path for flashcard-mode cards whose Q/A fields don't
  // go through MarkdownRenderer.render().
  renderLatexInContainer(el);

  // Async rendering for MarkdownRenderer-based fields (basic Q/A, Info)
  // and image embed resolution. Also re-runs renderLatexInContainer
  // for any LaTeX produced by MarkdownRenderer.render().
  void renderMdInElements(el, card);
}

export function renderReadingViewPreviewCard(el: HTMLElement, card: LearnKitCard): void {
  el.classList.add("el-p");
  el.setAttribute("data-learnkit-processed", "true");
  enhanceCardElement(el, card, "", undefined, true);

  const editButtons = el.querySelectorAll<HTMLElement>(".learnkit-card-edit-btn");
  editButtons.forEach((button) => {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("tabindex", "-1");
  });

  const audioButtons = el.querySelectorAll<HTMLButtonElement>(".learnkit-flashcard-speak-btn");
  audioButtons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.tabIndex = -1;
  });
}

/* =========================
   Markdown rendering in card elements
   ========================= */

async function renderMdInElements(el: HTMLElement, card: LearnKitCard) {
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
    if (card.type === 'io' || card.type === 'hq' || card.type === 'io-child' || card.type === 'hq-child') {
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

    // Render any pre-marked markdown containers used by reading-view
    // flashcard and markdown macros (including inline math delimiters).
    const mdTargets = Array.from(el.querySelectorAll<HTMLElement>('[data-learnkit-md-source]'));
    for (const target of mdTargets) {
      if (target.closest('[id^="sprout-q-"]') || target.closest('[id^="sprout-a-"]') || target.closest('[id^="sprout-i-"]')) {
        continue;
      }

      const encodedSource = target.getAttribute('data-learnkit-md-source');
      if (!encodedSource) continue;

      let markdownSource = '';
      try {
        markdownSource = decodeURIComponent(encodedSource);
      } catch {
        markdownSource = encodedSource;
      }
      if (!markdownSource) continue;

      // Snapshot fallback nodes before clearing; MarkdownRenderer
      // *appends* children so leaving old content would double the output.
      const fallbackNodes = Array.from(target.childNodes).map((node) => node.cloneNode(true));
      try {
        target.replaceChildren();
        await MarkdownRenderer.render(app, markdownSource, target, sourcePath, component);
        resolveUnloadedEmbeds(target, app, sourcePath);
      } catch {
        // Restore pre-rendered fallback content on markdown render failures.
        target.replaceChildren(...fallbackNodes);
      }
    }
  } finally {
    // Remove the component to clean up any registered event handlers
    plugin.removeChild(component);
  }

  // Resolve any ![[image]] embed placeholders produced by processMarkdownFeatures
  // These appear in cloze, MCQ, and title fields as <img data-embed-path="...">
  resolveEmbeddedImages(el, app, sourcePath);
  
  // Render LaTeX using Obsidian's native renderMath API
  renderLatexInContainer(el);
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
        img.className = 'learnkit-reading-embed-img';
        embed.replaceChildren(img);
        embed.classList.add('media-embed', 'image-embed', 'is-loaded');
      } else {
        // Image not found — show a comment-like placeholder
        embed.textContent = `⚠️ Image not found: ${embedSrc}`;
        embed.classList.add('learnkit-missing-image', 'learnkit-missing-image');
      }
    } catch (err) {
      log.warn('Failed to resolve internal embed:', embedSrc, err);
      embed.textContent = `⚠️ Image not found: ${embedSrc}`;
      embed.classList.add('learnkit-missing-image', 'learnkit-missing-image');
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
  card: LearnKitCard,
  plugin: SproutPluginLike,
  sourcePath: string,
) {
  const toFieldText = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? value.join('\n') : String(value || '');

  const extractImageRefFromField = (value: string | string[] | undefined): string => {
    const raw = toFieldText(value).trim();
    if (!raw) return '';

    const embedMatch = raw.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/i);
    if (embedMatch?.[1]) return String(embedMatch[1]).trim();

    const internalEmbedMatch = raw.match(/<span[^>]*\b(?:src|alt)=['"]([^'"]+\.(?:png|jpe?g|gif|bmp|svg|webp|avif|tiff))['"][^>]*>/i);
    if (internalEmbedMatch?.[1]) return String(internalEmbedMatch[1]).trim();

    if (/\.(png|jpe?g|gif|bmp|svg|webp|avif|tiff)(?:\?.*)?$/i.test(raw)) {
      return raw;
    }
    return '';
  };

  const normalizeImageRefKey = (value: string): string => {
    const cleaned = String(value || '')
      .trim()
      .replace(/^!\[\[/, '')
      .replace(/\]\]$/, '')
      .replace(/[#?].*$/, '')
      .replace(/^\/+/, '')
      .replace(/\\/g, '/');
    try {
      return decodeURIComponent(cleaned).toLowerCase();
    } catch {
      return cleaned.toLowerCase();
    }
  };

  const imageRefBaseName = (value: string): string => {
    const key = normalizeImageRefKey(value);
    const parts = key.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : key;
  };

  const imageRefsMatch = (left: string, right: string): boolean => {
    const leftKey = normalizeImageRefKey(left);
    const rightKey = normalizeImageRefKey(right);
    if (!leftKey || !rightKey) return false;
    if (leftKey === rightKey) return true;
    const leftBase = imageRefBaseName(leftKey);
    const rightBase = imageRefBaseName(rightKey);
    return !!leftBase && leftBase === rightBase;
  };

  const mapRawOcclusionsToRects = (rawOcclusions: unknown[]): StoredIORect[] => {
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

      const shape = rect.shape === 'circle' ? 'circle' : rect.shape === 'polygon' ? 'polygon' : 'rect';
      const points = shape === 'polygon' && Array.isArray(rect.points)
        ? rect.points
            .map((p) => {
              if (!p || typeof p !== 'object') return null;
              const point = p as Record<string, unknown>;
              const x = Number(point.x ?? 0);
              const y = Number(point.y ?? 0);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              return { x, y };
            })
            .filter((p): p is { x: number; y: number } => !!p)
        : [];

      rects.push({
        rectId,
        x: Number(rect.x ?? 0),
        y: Number(rect.y ?? 0),
        w: Number(rect.w ?? rect.width ?? 0),
        h: Number(rect.h ?? rect.height ?? 0),
        groupKey,
        shape,
        points: points.length >= 3 ? points : undefined,
      });
    }
    return rects;
  };

  const hashString = (value: string): number => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  const getMaskToneShift = (rect: StoredIORect, fallbackIndex: number): number => {
    const rectId = String(rect.rectId || "");
    const groupKey = String(rect.groupKey || "");
    const labelValue = (rect as Record<string, unknown>).label;
    let label: string;
    if (typeof labelValue === 'string') {
      label = labelValue;
    } else if (typeof labelValue === 'number' || typeof labelValue === 'boolean') {
      label = String(labelValue);
    } else {
      label = "";
    }
    const fallback = String(fallbackIndex + 1);
    const key = rectId || groupKey || label || fallback;
    const shifts = [-8, -4, 0, 4, 8];
    return shifts[hashString(key) % shifts.length] || 0;
  };

  const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MASK_STROKE_VIEWBOX = '-1 -1 102 102';

  const normalizePolygonPointsForMask = (rect: StoredIORect): Array<{ x: number; y: number }> | null => {
    if (!Array.isArray(rect.points) || rect.points.length < 3) return null;

    const width = Number.isFinite(rect.w) ? Number(rect.w) : 0;
    const height = Number.isFinite(rect.h) ? Number(rect.h) : 0;
    const originX = Number.isFinite(rect.x) ? Number(rect.x) : 0;
    const originY = Number.isFinite(rect.y) ? Number(rect.y) : 0;
    if (width <= 0 || height <= 0) return null;

    const points = rect.points
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 3) return null;

    const looksLocal = points.every((point) => point.x >= -0.001 && point.x <= 1.001 && point.y >= -0.001 && point.y <= 1.001);

    return points.map((point) => {
      if (looksLocal) {
        return {
          x: clampUnit(point.x),
          y: clampUnit(point.y),
        };
      }
      return {
        x: clampUnit((point.x - originX) / width),
        y: clampUnit((point.y - originY) / height),
      };
    });
  };

  const appendHotspotMaskStroke = (
    overlay: HTMLElement,
    rect: StoredIORect,
    fallbackIndex: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void => {
    const stroke = document.createElementNS(SVG_NS, 'svg');
    stroke.classList.add('learnkit-io-reading-mask-stroke');
    stroke.setAttribute('viewBox', MASK_STROKE_VIEWBOX);
    stroke.setAttribute('preserveAspectRatio', 'none');
    stroke.style.left = `${clampUnit(x) * 100}%`;
    stroke.style.top = `${clampUnit(y) * 100}%`;
    stroke.style.width = `${clampUnit(w) * 100}%`;
    stroke.style.height = `${clampUnit(h) * 100}%`;

    const fillDelta = getMaskToneShift(rect, fallbackIndex);
    const fillExpr = fillDelta >= 0
      ? `calc(var(--accent-l) + ${fillDelta}%)`
      : `calc(var(--accent-l) - ${Math.abs(fillDelta)}%)`;
    const fillColor = `hsl(var(--accent-h) var(--accent-s) ${fillExpr} / 0.22)`;

    const strokeDelta = fillDelta - 6;
    const lExpr = strokeDelta >= 0
      ? `calc(var(--accent-l) + ${strokeDelta}%)`
      : `calc(var(--accent-l) - ${Math.abs(strokeDelta)}%)`;
    const strokeColor = `hsl(var(--accent-h) var(--accent-s) ${lExpr} / 0.55)`;

    if (rect.shape === 'circle') {
      const ellipse = document.createElementNS(SVG_NS, 'ellipse');
      ellipse.setAttribute('cx', '50');
      ellipse.setAttribute('cy', '50');
      ellipse.setAttribute('rx', '50');
      ellipse.setAttribute('ry', '50');
      ellipse.setAttribute('fill', fillColor);
      ellipse.setAttribute('stroke', strokeColor);
      stroke.appendChild(ellipse);
    } else if (rect.shape === 'polygon') {
      const points = normalizePolygonPointsForMask(rect);
      if (!points || points.length < 3) return;
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('points', points.map((point) => `${point.x * 100},${point.y * 100}`).join(' '));
      polygon.setAttribute('fill', fillColor);
      polygon.setAttribute('stroke', strokeColor);
      stroke.appendChild(polygon);
    } else {
      const rectEl = document.createElementNS(SVG_NS, 'rect');
      rectEl.setAttribute('x', '0');
      rectEl.setAttribute('y', '0');
      rectEl.setAttribute('width', '100');
      rectEl.setAttribute('height', '100');
      rectEl.setAttribute('rx', '3');
      rectEl.setAttribute('ry', '3');
      rectEl.setAttribute('fill', fillColor);
      rectEl.setAttribute('stroke', strokeColor);
      stroke.appendChild(rectEl);
    }

    overlay.appendChild(stroke as unknown as HTMLElement);
  };

  const getPolygonLabelAnchor = (
    rect: StoredIORect,
  ): { xNorm: number; yNorm: number } | null => {
    if (rect.shape !== 'polygon' || !Array.isArray(rect.points) || rect.points.length < 3) return null;

    const width = Number.isFinite(rect.w) ? Number(rect.w) : 0;
    const height = Number.isFinite(rect.h) ? Number(rect.h) : 0;
    const originX = Number.isFinite(rect.x) ? Number(rect.x) : 0;
    const originY = Number.isFinite(rect.y) ? Number(rect.y) : 0;
    if (width <= 0 || height <= 0) return null;

    const points = rect.points
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 3) return null;

    const looksLocal = points.every((point) => point.x >= -0.001 && point.x <= 1.001 && point.y >= -0.001 && point.y <= 1.001);

    const localPoints = points.map((point) => {
      if (looksLocal) {
        return {
          x: Math.max(0, Math.min(1, point.x)),
          y: Math.max(0, Math.min(1, point.y)),
        };
      }
      return {
        x: Math.max(0, Math.min(1, (point.x - originX) / width)),
        y: Math.max(0, Math.min(1, (point.y - originY) / height)),
      };
    });

    const yLocal = 0.5;
    const intersections: number[] = [];
    for (let i = 0; i < localPoints.length; i += 1) {
      const a = localPoints[i];
      const b = localPoints[(i + 1) % localPoints.length];
      if (!a || !b) continue;

      // Horizontal edges do not define a stable crossing for scanline anchoring.
      if (Math.abs(a.y - b.y) < 1e-6) continue;

      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (!(yLocal >= minY && yLocal < maxY)) continue;

      const t = (yLocal - a.y) / (b.y - a.y);
      const x = a.x + t * (b.x - a.x);
      if (Number.isFinite(x)) intersections.push(Math.max(0, Math.min(1, x)));
    }

    if (intersections.length < 2) return null;
    intersections.sort((left, right) => left - right);

    let bestCenter = intersections[0];
    let bestWidth = -1;
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const left = intersections[i];
      const right = intersections[i + 1];
      const segmentWidth = right - left;
      if (segmentWidth > bestWidth) {
        bestWidth = segmentWidth;
        bestCenter = (left + right) / 2;
      }
    }
    if (bestWidth <= 0) return null;

    return {
      xNorm: originX + bestCenter * width,
      yNorm: originY + yLocal * height,
    };
  };

  const app = plugin.app;
  const anchorId = String(
    card.anchorId ||
      (card.type === 'io-child' || card.type === 'hq-child' ? card.parentId || '' : card.id || ''),
  ).trim();
  if (!anchorId) return;

  const cardsById = plugin.store?.data?.cards ?? {};
  const anchorCard = cardsById[anchorId] as Record<string, unknown> | undefined;
  const anchorTypeValue = anchorCard?.type;
  let anchorType: string;
  if (typeof anchorTypeValue === 'string') {
    anchorType = anchorTypeValue;
  } else if (typeof anchorTypeValue === 'number' || typeof anchorTypeValue === 'boolean') {
    anchorType = String(anchorTypeValue);
  } else {
    anchorType = "";
  }
  anchorType = anchorType.toLowerCase();
  const isHotspot =
    card.type === 'hq' ||
    card.type === 'hq-child' ||
    anchorType === 'hq' ||
    anchorType === 'hq-child' ||
    Array.isArray(anchorCard?.hqRegions);

  // Resolve IO data from store
  type HQDef = { imageRef: string; rects: StoredIORect[]; interactionMode?: "click" | "drag-drop"; prompt?: string };
  type IODef = { imageRef: string; rects: StoredIORect[]; maskMode?: string };
  
  const ioMap: Record<string, HQDef | IODef> = isHotspot
    ? ((plugin.store?.data as unknown as { hq?: Record<string, HQDef> })?.hq ?? {})
    : ((plugin.store?.data as unknown as { io?: Record<string, IODef> })?.io ?? {});
  let ioDef: HQDef | IODef | undefined = ioMap[anchorId];
  const fieldImageRef = isHotspot
    ? extractImageRefFromField(card.fields.HQ ?? card.fields.IO)
    : extractImageRefFromField(card.fields.IO);

  if (!ioDef && fieldImageRef) {
    const matched = Object.values(ioMap).find((def) => imageRefsMatch(String(def?.imageRef || ''), fieldImageRef));
    if (matched) ioDef = matched;
  }

  // Fallback: if IO map entry is missing, rebuild from the card record's occlusions
  if (!ioDef) {
    const cardRec = anchorCard;
    if (cardRec) {
      const rawImageRefVal = cardRec.imageRef;
      let rawImageRef = '';
      if (typeof rawImageRefVal === 'string') {
        rawImageRef = rawImageRefVal.trim();
      } else if (typeof rawImageRefVal === 'number' || typeof rawImageRefVal === 'boolean') {
        rawImageRef = String(rawImageRefVal).trim();
      }
      const rawOcclusions = isHotspot
        ? (cardRec.hqRegions ?? cardRec.regions ?? cardRec.occlusions)
        : cardRec.occlusions;
      if (rawImageRef && Array.isArray(rawOcclusions) && rawOcclusions.length > 0) {
        const rects = mapRawOcclusionsToRects(rawOcclusions);
        if (rects.length > 0) {
          if (isHotspot) {
            const interactionMode = cardRec.interactionMode === 'drag-drop' ? 'drag-drop' : 'click';
            const prompt = typeof cardRec.prompt === 'string' ? cardRec.prompt : '';
            ioDef = { imageRef: rawImageRef, rects, interactionMode, prompt };
          } else {
            let maskMode = '';
            const maskModeRaw = cardRec.maskMode;
            if (typeof maskModeRaw === 'string') {
              maskMode = maskModeRaw;
            } else if (typeof maskModeRaw === 'number' || typeof maskModeRaw === 'boolean') {
              maskMode = String(maskModeRaw);
            }
            ioDef = { imageRef: rawImageRef, rects, maskMode };
          }
          // Also populate the IO map for future lookups
          if (plugin.store?.data) {
            const mapKey = isHotspot ? 'hq' : 'io';
            if (!(plugin.store.data as unknown as Record<string, unknown>)[mapKey]) {
              (plugin.store.data as unknown as Record<string, unknown>)[mapKey] = {};
            }
            ((plugin.store.data as unknown as Record<string, unknown>)[mapKey] as Record<string, unknown>)[anchorId] = ioDef;
          }
        }
      }
    }
  }

  if ((!ioDef || !Array.isArray(ioDef.rects) || ioDef.rects.length === 0) && fieldImageRef) {
    const fieldKey = normalizeImageRefKey(fieldImageRef);
    for (const candidate of Object.values(cardsById)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const rec = candidate as Record<string, unknown>;
      const imageRefVal = rec.imageRef;
      let imageRefStr: string;
      if (typeof imageRefVal === 'string') {
        imageRefStr = imageRefVal;
      } else if (typeof imageRefVal === 'number' || typeof imageRefVal === 'boolean') {
        imageRefStr = String(imageRefVal);
      } else {
        imageRefStr = "";
      }
      const recImageRef = normalizeImageRefKey(imageRefStr);
      if (!recImageRef || !imageRefsMatch(recImageRef, fieldKey)) continue;

      const rawOcclusions = isHotspot
        ? (rec.hqRegions ?? rec.regions ?? rec.occlusions)
        : rec.occlusions;
      if (!Array.isArray(rawOcclusions) || rawOcclusions.length === 0) continue;

      const rects = mapRawOcclusionsToRects(rawOcclusions);
      if (rects.length === 0) continue;

      if (isHotspot) {
        const interactionMode = rec.interactionMode === 'drag-drop' ? 'drag-drop' : 'click';
        const prompt = typeof rec.prompt === 'string' ? rec.prompt : '';
        ioDef = { imageRef: fieldImageRef, rects, interactionMode, prompt };
      } else {
        let maskMode = '';
        const maskModeRaw = rec.maskMode;
        if (typeof maskModeRaw === 'string') {
          maskMode = maskModeRaw;
        } else if (typeof maskModeRaw === 'number' || typeof maskModeRaw === 'boolean') {
          maskMode = String(maskModeRaw);
        }
        ioDef = { imageRef: fieldImageRef, rects, maskMode };
      }
      break;
    }
  }
  if (!ioDef && fieldImageRef) {
    ioDef = {
      imageRef: fieldImageRef,
      rects: [],
      ...(isHotspot ? { interactionMode: 'click' as const, prompt: '' } : { maskMode: '' }),
    };
  }
  if (!ioDef) return;

  const imageRef = String(ioDef.imageRef || fieldImageRef || '').trim();
  if (!imageRef) return;

  const resolvedSourcePath = String((anchorCard?.sourceNotePath as string | undefined) || sourcePath || '').trim();

  // Resolve image file to get a vault resource URL
  const imageFile = resolveImageFile(app, resolvedSourcePath || sourcePath, imageRef);
  if (!imageFile) return;
  const imageSrc = app.vault.getResourcePath(imageFile);

  const occlusions: StoredIORect[] = Array.isArray(ioDef.rects) ? ioDef.rects : [];

  // ---- Question container: image with mask overlays ----
  const questionEl = queryFirst<HTMLElement>(el, '[id^="sprout-io-question-"], [id^="learnkit-io-question-"]');
  if (questionEl) {
    questionEl.replaceChildren();
    const container = document.createElement('div');
    container.className = 'learnkit-io-reading-container';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = card.title || 'Image Occlusion';
    img.className = 'learnkit-io-reading-img';
    container.appendChild(img);

    if (occlusions.length > 0) {
      const overlay = document.createElement('div');
      overlay.className = 'learnkit-io-reading-overlay';

      // Sync overlay to the actual rendered image layout bounds using inline
      // styles. Uses offset* properties instead of getBoundingClientRect so
      // CSS transforms (rotateY during flip animation) never distort the values.
      const syncOverlay = () => {
        const w = img.offsetWidth;
        const h = img.offsetHeight;
        // Skip if the image has no layout size (hidden via display:none)
        if (w === 0 && h === 0) return;
        overlay.style.left = `${img.offsetLeft}px`;
        overlay.style.top = `${img.offsetTop}px`;
        overlay.style.width = `${w}px`;
        overlay.style.height = `${h}px`;
        resolveAnchoredLabelCollisions(overlay, {
          selector: '.learnkit-io-reading-mask-label-floating',
          anchorXDataKey: 'labelAnchorX',
          anchorYDataKey: 'labelAnchorY',
          edgeMarginPx: 2,
          marginPx: 1,
          maxShiftPx: 28,
          maxIterations: 10,
        });
      };

      const scheduleSync = () => requestAnimationFrame(syncOverlay);

      if (img.complete && img.naturalWidth > 0) {
        scheduleSync();
      } else {
        img.addEventListener('load', scheduleSync, { once: true });
      }

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncOverlay).observe(img);
      }

      occlusions.forEach((rect, index) => {
        const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
        const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
        const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
        const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;

        const mask = document.createElement('div');
        mask.className = 'learnkit-io-reading-mask learnkit-io-reading-mask-filled learnkit-io-reading-mask-hotspot-answer';
        mask.classList.add('learnkit-io-reading-mask-no-border');
        if (rect.shape === 'circle') {
          mask.classList.add('learnkit-io-reading-mask-circle');
          setCssProps(mask, { 'clip-path': '', '-webkit-clip-path': '' });
        } else if (rect.shape === 'polygon' && Array.isArray(rect.points)) {
          mask.classList.add('learnkit-io-reading-mask-rect', 'learnkit-io-reading-mask-polygon');
          const clipPath = polygonClipPath(rect.points);
          setCssProps(mask, { 'clip-path': clipPath, '-webkit-clip-path': clipPath });
        } else {
          mask.classList.add('learnkit-io-reading-mask-rect');
          setCssProps(mask, { 'clip-path': '', '-webkit-clip-path': '' });
        }

        setCssProps(mask, 'left', `${Math.max(0, Math.min(1, x)) * 100}%`);
        setCssProps(mask, 'top', `${Math.max(0, Math.min(1, y)) * 100}%`);
        setCssProps(mask, 'width', `${Math.max(0, Math.min(1, w)) * 100}%`);
        setCssProps(mask, 'height', `${Math.max(0, Math.min(1, h)) * 100}%`);
        setCssProps(mask, 'background', 'none');
        setCssProps(mask, 'border', 'none');

        const rectLabel = (rect as Record<string, unknown>).label;
        let labelStr: string;
        if (typeof rectLabel === 'string') {
          labelStr = rectLabel;
        } else if (typeof rectLabel === 'number' || typeof rectLabel === 'boolean') {
          labelStr = String(rectLabel);
        } else {
          labelStr = rect.groupKey ? String(rect.groupKey) : String(index + 1);
        }
        const label = labelStr.trim() || String(index + 1);
        const labelEl = document.createElement('span');
        labelEl.className = 'learnkit-io-reading-mask-label learnkit-io-reading-mask-label-floating';
        labelEl.textContent = label;
        const polygonAnchor = getPolygonLabelAnchor(rect);
        const labelX = Math.max(0, Math.min(1, polygonAnchor ? polygonAnchor.xNorm : x + w / 2));
        const labelY = Math.max(0, Math.min(1, polygonAnchor ? polygonAnchor.yNorm : y + h / 2));
        labelEl.dataset.labelAnchorX = String(labelX);
        labelEl.dataset.labelAnchorY = String(labelY);
        setCssProps(labelEl, 'left', `${labelX * 100}%`);
        setCssProps(labelEl, 'top', `${labelY * 100}%`);

        overlay.appendChild(mask);
        appendHotspotMaskStroke(overlay, rect, index, x, y, w, h);
        overlay.appendChild(labelEl);
      });

      container.appendChild(overlay);
    }

    questionEl.appendChild(container);
  }

  // ---- Answer container: clean image (no masks) ----
  const answerEl = queryFirst<HTMLElement>(el, '[id^="sprout-io-answer-"], [id^="learnkit-io-answer-"]');
  if (answerEl) {
    answerEl.replaceChildren();
    const container = document.createElement('div');
    container.className = 'learnkit-io-reading-container';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = card.title || 'Image Occlusion — Answer';
    img.className = 'learnkit-io-reading-img';
    container.appendChild(img);

    if (isHotspot && occlusions.length > 0) {
      const overlay = document.createElement('div');
      overlay.className = 'learnkit-io-reading-overlay';

      const syncOverlay = () => {
        const w = img.offsetWidth;
        const h = img.offsetHeight;
        if (w === 0 && h === 0) return;
        overlay.style.left = `${img.offsetLeft}px`;
        overlay.style.top = `${img.offsetTop}px`;
        overlay.style.width = `${w}px`;
        overlay.style.height = `${h}px`;
        resolveAnchoredLabelCollisions(overlay, {
          selector: '.learnkit-io-reading-mask-label-floating',
          anchorXDataKey: 'labelAnchorX',
          anchorYDataKey: 'labelAnchorY',
          edgeMarginPx: 2,
          marginPx: 1,
          maxShiftPx: 28,
          maxIterations: 10,
        });
      };

      const scheduleSync = () => requestAnimationFrame(syncOverlay);

      if (img.complete && img.naturalWidth > 0) {
        scheduleSync();
      } else {
        img.addEventListener('load', scheduleSync, { once: true });
      }

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncOverlay).observe(img);
      }

      occlusions.forEach((rect, index) => {
        const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
        const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
        const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
        const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;

        const mask = document.createElement('div');
        mask.className = 'learnkit-io-reading-mask learnkit-io-reading-mask-filled learnkit-io-reading-mask-hotspot-answer';
        mask.classList.add('learnkit-io-reading-mask-no-border');
        if (rect.shape === 'circle') {
          mask.classList.add('learnkit-io-reading-mask-circle');
          setCssProps(mask, { 'clip-path': '', '-webkit-clip-path': '' });
        } else if (rect.shape === 'polygon' && Array.isArray(rect.points)) {
          mask.classList.add('learnkit-io-reading-mask-rect', 'learnkit-io-reading-mask-polygon');
          const clipPath = polygonClipPath(rect.points);
          setCssProps(mask, { 'clip-path': clipPath, '-webkit-clip-path': clipPath });
        } else {
          mask.classList.add('learnkit-io-reading-mask-rect');
          setCssProps(mask, { 'clip-path': '', '-webkit-clip-path': '' });
        }

        setCssProps(mask, 'left', `${Math.max(0, Math.min(1, x)) * 100}%`);
        setCssProps(mask, 'top', `${Math.max(0, Math.min(1, y)) * 100}%`);
        setCssProps(mask, 'width', `${Math.max(0, Math.min(1, w)) * 100}%`);
        setCssProps(mask, 'height', `${Math.max(0, Math.min(1, h)) * 100}%`);
        setCssProps(mask, 'background', 'none');
        setCssProps(mask, 'border', 'none');

        const rectLabel = (rect as Record<string, unknown>).label;
        let labelStr: string;
        if (typeof rectLabel === 'string') {
          labelStr = rectLabel;
        } else if (typeof rectLabel === 'number' || typeof rectLabel === 'boolean') {
          labelStr = String(rectLabel);
        } else {
          labelStr = rect.groupKey ? String(rect.groupKey) : String(index + 1);
        }
        const label = labelStr.trim() || String(index + 1);
        const labelEl = document.createElement('span');
        labelEl.className = 'learnkit-io-reading-mask-label learnkit-io-reading-mask-label-floating';
        labelEl.textContent = label;
        const polygonAnchor = getPolygonLabelAnchor(rect);
        const labelX = Math.max(0, Math.min(1, polygonAnchor ? polygonAnchor.xNorm : x + w / 2));
        const labelY = Math.max(0, Math.min(1, polygonAnchor ? polygonAnchor.yNorm : y + h / 2));
        labelEl.dataset.labelAnchorX = String(labelX);
        labelEl.dataset.labelAnchorY = String(labelY);
        setCssProps(labelEl, 'left', `${labelX * 100}%`);
        setCssProps(labelEl, 'top', `${labelY * 100}%`);

        overlay.appendChild(mask);
        appendHotspotMaskStroke(overlay, rect, index, x, y, w, h);
        overlay.appendChild(labelEl);
      });

      container.appendChild(overlay);
    }

    answerEl.appendChild(container);
  }
}

/* =========================
   Expose manual trigger on window
   ========================= */

declare global { interface Window { sproutApplyMasonryGrid?: () => void; } }

window.sproutApplyMasonryGrid = window.sproutApplyMasonryGrid || (() => {
  debugLog('[LearnKit] sproutApplyMasonryGrid placeholder invoked');
  void processCardElements(document.documentElement, undefined, '');
});
