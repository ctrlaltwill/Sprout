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

let readingDynamicStyleSheet: CSSStyleSheet | null = null;

function getReadingDynamicStyleSheet(): CSSStyleSheet | null {
  if (typeof document === 'undefined' || typeof CSSStyleSheet === 'undefined') return null;
  const doc = document as Document & { adoptedStyleSheets?: CSSStyleSheet[] };
  if (!Array.isArray(doc.adoptedStyleSheets)) return null;
  if (!readingDynamicStyleSheet) readingDynamicStyleSheet = new CSSStyleSheet();
  if (!doc.adoptedStyleSheets.includes(readingDynamicStyleSheet)) {
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, readingDynamicStyleSheet];
  }
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
 * Injects or updates a <style> element that writes the current reading-view
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
  const macroSelector = `.sprout-pretty-card.sprout-macro-${macroPreset}`;

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

  // ── Custom colours (body-level variables so all cards inherit) ──
  const colours = (macroConfig as {
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
  } | undefined)?.colours;

  const autoDarkAdjust = colours?.autoDarkAdjust !== false;
  const bgLight = colours?.cardBgLight ?? rv?.cardBgLight;
  const textLight = colours?.cardTextLight ?? "";

  if (macroPreset === 'flashcards') {
    const bgDark = colours?.cardBgDark ?? "";
    const textDark = colours?.cardTextDark ?? "";
    const clozeBgLight = colours?.clozeBgLight ?? "";
    const clozeTextLight = colours?.clozeTextLight ?? "";
    const clozeBgDark = colours?.clozeBgDark ?? "";
    const clozeTextDark = colours?.clozeTextDark ?? "";

    const lightBgHex = sanitizeHexColor(bgLight);
    const lightTextHex = sanitizeHexColor(textLight);
    const lightClozeBgHex = sanitizeHexColor(clozeBgLight);
    const lightClozeTextHex = sanitizeHexColor(clozeTextLight);

    const derivedBgDark = autoDarkAdjust && lightBgHex ? deriveColourForDark(lightBgHex) : "";
    const derivedTextDark = autoDarkAdjust && lightTextHex ? deriveTextForDark(lightTextHex) : "";
    const derivedClozeBgDark = autoDarkAdjust && lightClozeBgHex ? deriveColourForDark(lightClozeBgHex) : "";
    const clozeTextDeriveSource = lightClozeTextHex || "#ffffff";
    const derivedClozeTextDark = autoDarkAdjust ? deriveTextForDark(clozeTextDeriveSource) : "";

    const lightBgValue = bgLight || 'var(--color-base-05)';
    const darkBgValue = autoDarkAdjust ? (derivedBgDark || 'var(--color-base-05)') : (bgDark || 'var(--color-base-05)');
    const lightTextValue = textLight || 'var(--text-colour, var(--text-color, var(--text-normal)))';
    const darkTextValue = autoDarkAdjust
      ? (derivedTextDark || 'var(--text-colour, var(--text-color, var(--text-normal)))')
      : (textDark || 'var(--text-colour, var(--text-color, var(--text-normal)))');
    const lightClozeBgValue = clozeBgLight || 'color-mix(in srgb, var(--interactive-accent) 16%, transparent)';
    const darkClozeBgValue = autoDarkAdjust
      ? (derivedClozeBgDark || 'color-mix(in srgb, var(--interactive-accent) 24%, transparent)')
      : (clozeBgDark || 'color-mix(in srgb, var(--interactive-accent) 24%, transparent)');
    const lightClozeTextValue = clozeTextLight || 'var(--sprout-rv-flash-text)';
    const darkClozeTextValue = autoDarkAdjust
      ? (derivedClozeTextDark || 'var(--sprout-rv-flash-text)')
      : (clozeTextDark || 'var(--sprout-rv-flash-text)');

    css += `body.theme-light {\n`;
    css += `  --sprout-rv-flash-bg: ${lightBgValue};\n`;
    css += `  --sprout-rv-flash-text: ${lightTextValue};\n`;
    css += `  --sprout-rv-flash-cloze-bg: ${lightClozeBgValue};\n`;
    css += `  --sprout-rv-flash-cloze-text: ${lightClozeTextValue};\n`;
    css += `}\n`;

    css += `body.theme-dark {\n`;
    css += `  --sprout-rv-flash-bg: ${darkBgValue};\n`;
    css += `  --sprout-rv-flash-text: ${darkTextValue};\n`;
    css += `  --sprout-rv-flash-cloze-bg: ${darkClozeBgValue};\n`;
    css += `  --sprout-rv-flash-cloze-text: ${darkClozeTextValue};\n`;
    css += `}\n`;

    css += `${macroSelector} { background: var(--sprout-rv-flash-bg) !important; color: var(--sprout-rv-flash-text) !important; }\n`;
    css += `${macroSelector}.sprout-flashcard-flipped { background: var(--sprout-rv-flash-bg) !important; }\n`;
    css += `${macroSelector} .sprout-flashcard-question, ${macroSelector} .sprout-flashcard-answer { background: var(--sprout-rv-flash-bg) !important; color: var(--sprout-rv-flash-text) !important; }\n`;
    css += `${macroSelector} .sprout-card-content, ${macroSelector} .sprout-flashcard-options, ${macroSelector} .sprout-flashcard-info, ${macroSelector} .sprout-flashcard-body { color: var(--sprout-rv-flash-text) !important; }\n`;
    css += `${macroSelector} .sprout-reading-view-cloze { background-color: var(--sprout-rv-flash-cloze-bg) !important; }\n`;
    css += `${macroSelector} .sprout-cloze-text { color: var(--sprout-rv-flash-cloze-text) !important; }\n`;
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
  if (effectiveLayout === 'vertical') {
    css += `.markdown-preview-section.sprout-layout-vertical > .sprout-reading-card-run {\n`;
    css += `  column-width: unset !important;\n  column-gap: unset !important;\n  column-count: 1 !important;\n`;
    css += `  display: flex;\n  flex-direction: column;\n  gap: 12px;\n`;
    css += `}\n`;
    css += `.markdown-preview-section.sprout-layout-vertical > .sprout-reading-card-run > .sprout-pretty-card {\n`;
    css += `  margin-top: 0 !important;\n  margin-bottom: 0 !important;\n`;
    css += `}\n`;
  }

  if (macroPreset === 'flashcards') {
    css += `.markdown-preview-section.sprout-layout-masonry > .sprout-reading-card-run:has(.sprout-pretty-card.sprout-macro-flashcards) {\n`;
    css += `  column-width: 280px !important;\n`;
    css += `  column-gap: 16px !important;\n`;
    css += `  display: block !important;\n`;
    css += `}\n`;
    css += `.markdown-preview-section.sprout-layout-masonry > .sprout-reading-card-run:has(.sprout-pretty-card.sprout-macro-flashcards) > .sprout-pretty-card.sprout-macro-flashcards {\n`;
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
      displayAudioButton?: boolean;
      displayEditButton?: boolean;
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
    if (!vf.edit && macroPreset !== 'flashcards') css += `${macroSelector} .sprout-card-edit-btn { display: none !important; }\n`;
  }

  if (macroPreset === 'flashcards') {
    const showAudioButton = macroFields?.displayAudioButton !== false;
    const showEditButton = macroFields?.displayEditButton !== false;
    if (!showAudioButton) css += `${macroSelector} .sprout-flashcard-speak-btn { display: none !important; }\n`;
    if (!showEditButton) css += `${macroSelector} .sprout-card-edit-btn { display: none !important; }\n`;
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
  styleSheet.replaceSync(css);
}

/* =========================
   Public registration
   ========================= */

export function registerReadingViewPrettyCards(plugin: Plugin) {
  debugLog("[Sprout] Registering reading view prettifier");

  sproutPluginRef = plugin;

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

  const handleViewportChange = () => {
    const stylesEnabled = !!getSproutPlugin()?.settings?.general?.enableReadingStyles;
    if (!stylesEnabled) return;
    scheduleViewportReflow();
  };
  addTrackedWindowListener('resize', handleViewportChange, { passive: true });
  addTrackedWindowListener('scroll', handleViewportChange, { passive: true, capture: true });

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

    const stylesEnabled = !!getSproutPlugin()?.settings?.general?.enableReadingStyles;

    const root = (e.currentTarget instanceof HTMLElement)
      ? e.currentTarget
      : (e.target instanceof HTMLElement ? e.target : null);

    // When reading styles are disabled, remove all Sprout DOM adjustments
    if (!stylesEnabled) {
      if (root) resetCardsToNativeReading(root);
      else resetCardsToNativeReading(document.documentElement);
      return;
    }

    if (!root) {
      void processCardElements(document.documentElement, undefined, '');
      return;
    }

    refreshProcessedCards(root);
    scheduleViewportReflow();

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
let viewportReflowTimer: number | null = null;
const VIEWPORT_REFLOW_DEBOUNCE_MS = 90;

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
  if (viewportReflowTimer) {
    window.clearTimeout(viewportReflowTimer);
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
  const doc = document as Document & { adoptedStyleSheets?: CSSStyleSheet[] };
  if (readingDynamicStyleSheet && Array.isArray(doc.adoptedStyleSheets)) {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== readingDynamicStyleSheet);
  }
  readingDynamicStyleSheet = null;
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
    const stylesEnabled = !!pluginCheck?.settings?.general?.enableReadingStyles;
    if (!stylesEnabled) {
      debugLog('[Sprout] Prettify cards is off — skipping card processing');
      resetCardsToNativeReading(container);
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

  container.querySelectorAll<HTMLElement>('.el-p:not([data-sprout-processed])').forEach(el => found.push(el));

  if (found.length === 0) {
    debugLog('[Sprout] No unprocessed .el-p elements found in container');
    applyLayoutForContainer();
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
  applyLayoutForContainer();

  await Promise.resolve();

}

function refreshProcessedCards(container: HTMLElement) {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.sprout-pretty-card[data-sprout-raw-text], .el-p[data-sprout-processed][data-sprout-raw-text]'));
  if (!cards.length) return;

  const touchedSections = new Set<HTMLElement>();

  for (const el of cards) {
    try {
      if (el.closest('.cm-content')) continue;
      const rawText = String(el.getAttribute('data-sprout-raw-text') || '');
      if (!rawText.trim()) continue;
      const card = parseSproutCard(rawText);
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
}

function resetCardsToNativeReading(container: HTMLElement) {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.sprout-pretty-card'));
  for (const card of cards) {
    try {
      const originalHtml = card.querySelector<HTMLElement>('.sprout-original-content')?.innerHTML ?? '';
      if (originalHtml) replaceChildrenWithHTML(card, originalHtml);

      card.classList.remove(
        'sprout-pretty-card',
        'sprout-reading-card',
        'sprout-reading-view-wrapper',
        'sprout-single-card',
        'sprout-custom-root',
        'sprout-flashcard-flipped',
        'sprout-flashcard-animating',
        'accent',
        'theme',
        'sprout-macro-classic',
        'sprout-macro-guidebook',
        'sprout-macro-flashcards',
        'sprout-macro-markdown',
        'sprout-macro-custom',
      );

      card.removeAttribute('data-sprout-processed');
      card.removeAttribute('data-sprout-id');
      card.removeAttribute('data-sprout-type');
      card.removeAttribute('data-sprout-raw-text');
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
    section.classList.remove('sprout-layout-vertical', 'sprout-layout-masonry');
  });
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
      if (lockedCards.has(card)) continue;
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

function unwrapCardRuns(section: HTMLElement) {
  const wrappers = Array.from(section.querySelectorAll<HTMLElement>(':scope > .sprout-reading-card-run'));
  for (const wrapper of wrappers) {
    const children = Array.from(wrapper.children);
    for (const child of children) {
      section.insertBefore(child, wrapper);
    }
    wrapper.remove();
  }
}

function wrapContiguousCardRuns(section: HTMLElement) {
  unwrapCardRuns(section);

  const children = Array.from(section.children) as HTMLElement[];
  let currentRun: HTMLDivElement | null = null;

  for (const child of children) {
    const isCard = child.classList.contains('sprout-pretty-card');
    const isHidden = child.classList.contains('sprout-hidden-important') || child.getAttribute('data-sprout-hidden') === 'true';

    if (isCard && !isHidden) {
      if (!currentRun) {
        currentRun = section.ownerDocument.createElement('div');
        currentRun.className = 'sprout-reading-card-run';
        section.insertBefore(currentRun, child);
      }
      currentRun.appendChild(child);
      continue;
    }

    currentRun = null;
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
  if (section.querySelector('.sprout-pretty-card.sprout-macro-flashcards, .sprout-pretty-card.sprout-macro-classic')) {
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
      section.classList.add('sprout-layout-vertical');
      section.classList.remove('sprout-layout-masonry');
      applySectionCardRunLayout(section, 'vertical');
    } else {
      section.classList.remove('sprout-layout-vertical');
      section.classList.add('sprout-layout-masonry');
      applySectionCardRunLayout(section, 'masonry');
    }
  }
}

function collectSectionsWithPrettyCards(scope: ParentNode): Set<HTMLElement> {
  const sections = new Set<HTMLElement>();

  if (scope instanceof HTMLElement && scope.classList.contains('markdown-preview-section') && scope.querySelector('.sprout-pretty-card')) {
    sections.add(scope);
  }

  scope.querySelectorAll<HTMLElement>('.sprout-pretty-card').forEach((card) => {
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
    window.clearTimeout(viewportReflowTimer);
  }
  viewportReflowTimer = window.setTimeout(() => {
    viewportReflowTimer = null;
    reflowPrettyCardLayouts(document);
  }, VIEWPORT_REFLOW_DEBOUNCE_MS);
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

function toListField(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : [String(value ?? '')];
  return raw
    .flatMap((entry) => String(entry).split('\n'))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type CleanMarkdownClozeStyle = {
  bgColor?: string;
  textColor?: string;
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
  if (bg) rules.push(`--sprout-clean-md-cloze-bg: ${bg}`);
  if (text) {
    rules.push(`--sprout-clean-md-cloze-text: ${text}`);
    rules.push(`--sprout-cloze-color: ${text}`);
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

  if (!bg && !text) return undefined;
  return { bgColor: bg, textColor: text };
}

function renderMarkdownLineWithClozeSpans(value: string, style?: CleanMarkdownClozeStyle): string {
  const source = String(value ?? '');
  if (!source) return '';

  const clozeRegex = /\{\{c\d+::([\s\S]*?)\}\}/g;
  const spanStyle = buildCleanMarkdownClozeSpanStyle(style);
  let last = 0;
  let out = '';
  let match: RegExpExecArray | null;

  while ((match = clozeRegex.exec(source)) !== null) {
    if (match.index > last) {
      out += processMarkdownFeatures(source.slice(last, match.index));
    }
    const answer = String(match[1] ?? '').trim();
    if (answer) {
      out += `<span class="sprout-cloze-revealed sprout-clean-markdown-cloze"${spanStyle}>${processMarkdownFeatures(answer)}</span>`;
    }
    last = match.index + match[0].length;
  }

  if (last < source.length) {
    out += processMarkdownFeatures(source.slice(last));
  }

  return out || processMarkdownFeatures(source);
}

function buildMarkdownModeContent(card: SproutCard, showLabels: boolean, clozeStyle?: CleanMarkdownClozeStyle): string {
  const lines: string[] = [];
  const addLine = (label: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    const rendered = renderMarkdownLineWithClozeSpans(v, clozeStyle);
    lines.push(showLabels ? `${label}: ${rendered}` : rendered);
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
    return toTextField(card.fields.A)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
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
    lines.push(showLabels ? `${label}: ${listHtml}` : listHtml);
  };

  if (card.type === 'mcq') {
    const question = toTextField(card.fields.MCQ);
    const answers = toListField(card.fields.A);
    const optionsRaw = toListField(card.fields.O);
    addLine('Question', question);

    const seen = new Set<string>();
    const options = [...answers, ...optionsRaw].filter((option) => {
      const key = option.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    addListSection('Options', options, false);
    addListSection('Answer', answers, false);
  } else if (card.type === 'oq') {
    addLine('Question', toTextField(card.fields.OQ));
    const steps = getOqSteps();
    addListSection('Answer', steps, true);
  } else if (card.type === 'cloze') {
    addLine('Question', toTextField(card.fields.CQ));
    addLine('Extra information', toTextField(card.fields.I));
  } else if (card.type === 'io') {
    const ioQuestionId = `sprout-io-question-${Math.random().toString(36).slice(2, 8)}`;
    const ioAnswerId = `sprout-io-answer-${Math.random().toString(36).slice(2, 8)}`;
    lines.push(
      `<div class="sprout-markdown-io-entry">${showLabels ? 'Image occlusion: ' : ''}<div class="sprout-markdown-io-slot" id="${ioQuestionId}"></div></div>`,
    );
    lines.push(
      `<div class="sprout-markdown-io-entry">${showLabels ? 'Answer: ' : ''}<div class="sprout-markdown-io-slot" id="${ioAnswerId}"></div></div>`,
    );
    addLine('Extra information', toTextField(card.fields.I));
  } else {
    const question = card.type === 'reversed' ? toTextField(card.fields.RQ) : toTextField(card.fields.Q);
    addLine('Question', question);
    addLine('Answer', toTextField(card.fields.A));
    addLine('Extra information', toTextField(card.fields.I));
  }

  const groups = normalizeGroupsForDisplay(card.fields.G);
  if (groups.length) {
    const gText = groups.map((g) => renderMarkdownLineWithClozeSpans(String(g), clozeStyle)).join(', ');
    lines.push(showLabels ? `Groups: ${gText}` : gText);
  }

  return `<div class="sprout-markdown-lines">${lines.map((line) => `<div class="sprout-markdown-line">${line}</div>`).join('')}</div>`;
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
  const source = String(text || '');
  const regex = /\{\{c\d+::([\s\S]*?)\}\}/g;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (match.index > last) out += renderMarkdownLineWithClozeSpans(source.slice(last, match.index));
    const ans = String(match[1] || '').trim();
    if (mode === 'front') out += `<span class="sprout-flashcard-blank">&nbsp;</span>`;
    else out += `<span class="sprout-reading-view-cloze"><span class="sprout-cloze-text">${renderMarkdownLineWithClozeSpans(ans)}</span></span>`;
    last = match.index + match[0].length;
  }
  if (last < source.length) out += renderMarkdownLineWithClozeSpans(source.slice(last));
  return out;
}

function buildFlashcardContentHTML(card: SproutCard, options: { includeSpeakerButton: boolean; includeEditButton: boolean }): string {
  const idSeed = Math.random().toString(36).slice(2, 8);
  let front = '';
  let back = '';
  const allowSpeakerForCardType = card.type === 'basic' || card.type === 'reversed' || card.type === 'cloze';

  const getOqSteps = (): string[] => {
    const fieldsAny = card.fields as Record<string, string | string[] | undefined>;
    const numbered: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const step = toTextField(fieldsAny[String(i)]);
      if (!step) continue;
      numbered.push(step);
    }
    if (numbered.length) return numbered;
    return toTextField(card.fields.A)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const actionsFor = (side: 'front' | 'back') => {
    const speaker = options.includeSpeakerButton && allowSpeakerForCardType
      ? `<button class="sprout-flashcard-action-btn sprout-flashcard-speak-btn" type="button" data-sprout-tts-side="${side}" data-tooltip="Read aloud" data-tooltip-position="top" aria-label="Read aloud"></button>`
      : '';
    const edit = options.includeEditButton
      ? `<button class="sprout-flashcard-action-btn sprout-card-edit-btn" type="button" data-tooltip="Edit card" data-tooltip-position="top" aria-label="Edit card"></button>`
      : '';
    if (!edit && !speaker) return '';
    return `<div class="sprout-flashcard-actions">${edit}${speaker}</div>`;
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
    const answers = (Array.isArray(card.fields.A)
      ? card.fields.A
      : toTextField(card.fields.A).split('\n'))
      .map((s) => String(s).trim())
      .filter(Boolean);
    const wrongOptions = Array.isArray(card.fields.O)
      ? card.fields.O
      : toTextField(card.fields.O).split('\n').map((s) => s.trim()).filter(Boolean);

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

    front = `<div class="sprout-flashcard-question-text">${renderMarkdownLineWithClozeSpans(q)}</div>${allOptions.length ? `<ul class="sprout-flashcard-options sprout-flashcard-options-list">${allOptions.map((opt) => `<li>${renderMarkdownLineWithClozeSpans(String(opt))}</li>`).join('')}</ul>` : ''}`;
    back = answers.length > 1
      ? `<ul class="sprout-flashcard-answer-list">${answers.map((ans) => `<li><strong>${renderMarkdownLineWithClozeSpans(ans)}</strong></li>`).join('')}</ul>`
      : `<div><strong>${renderMarkdownLineWithClozeSpans(answers[0] || '')}</strong></div>`;
  } else if (card.type === 'oq') {
    const q = toTextField(card.fields.OQ);
    const steps = getOqSteps();
    front = `<div>${renderMarkdownLineWithClozeSpans(q)}</div>`;
    back = `<ol class="sprout-flashcard-sequence-list">${steps.map((s) => `<li>${renderMarkdownLineWithClozeSpans(s)}</li>`).join('')}</ol>`;
  } else {
    const q = card.type === 'reversed' ? toTextField(card.fields.RQ) : toTextField(card.fields.Q);
    const a = toTextField(card.fields.A);
    front = `<div>${renderMarkdownLineWithClozeSpans(q)}</div>`;
    back = `<div>${renderMarkdownLineWithClozeSpans(a)}</div>`;
  }

  const frontBodyClass = card.type === 'cloze'
    ? 'sprout-flashcard-body sprout-flashcard-body-cloze'
    : 'sprout-flashcard-body';
  const backBodyClass = card.type === 'cloze'
    ? 'sprout-flashcard-body sprout-flashcard-body-cloze'
    : 'sprout-flashcard-body';

  return `
    <div class="sprout-flashcard-question">${actionsFor('front')}<div class="${frontBodyClass}">${front}</div></div>
    <div class="sprout-flashcard-answer" hidden>${actionsFor('back')}<div class="${backBodyClass}">${back}</div></div>
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
        <div class="sprout-groups-list">${groups.map(g => `<span class="sprout-group-tag">${renderMarkdownLineWithClozeSpans(String(g))}</span>`).join('')}</div>
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

    const before = snapshotCardPositions(el);

    el.classList.add('sprout-flashcard-animating');
    window.setTimeout(() => {
      showingAnswer = !showingAnswer;
      applyFaceState();

      requestAnimationFrame(() => {
        flipAnimateCards(before, el);
      });
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
  skipSiblingHiding = false,
) {
  const originalContent = originalContentOverride ?? el.innerHTML;
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
    const stylesEnabled = !!activePlugin?.settings?.general?.enableReadingStyles;
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
    showFlashcardAudioButton = macroConfig?.fields?.displayAudioButton !== false;
    showFlashcardEditButton = macroConfig?.fields?.displayEditButton !== false;
    audioSettings = activePlugin?.settings?.audio ?? null;
    markdownClozeStyle = resolveCleanMarkdownClozeStyle(activePlugin);
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
    const groupArr = normalizeGroupsForDisplay(groups);
    if (groupArr.length > 0) {
      groupsHtml = macroPreset === 'markdown'
        ? ''
        : macroPreset === 'classic'
        ? buildGroupsSectionHTML(groupArr)
        : `<div class="sprout-groups-list">${groupArr.map(g => `<span class="sprout-group-tag">${renderMarkdownLineWithClozeSpans(String(g))}</span>`).join('')}</div>`;
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
        ? `<div class="sprout-card-header sprout-reading-card-header"><div class="sprout-card-title sprout-reading-card-title">${processMarkdownFeatures(card.title || '')}</div></div>`
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
  if (!skipSiblingHiding) {
    hideCardSiblingElements(el, cardRawText);
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
                OQ: rec.q || "",
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
            } else if (sproutCard.type === "oq") {
              const oqSteps = Array.isArray(rec.oqSteps)
                ? rec.oqSteps.map((s) => String(s || "").trim()).filter(Boolean)
                : [];
              sproutCard.fields.A = oqSteps;
              const fieldsAny = sproutCard.fields as Record<string, string | string[] | undefined>;
              oqSteps.forEach((step, idx) => {
                fieldsAny[String(idx + 1)] = step;
              });
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
  }

  const speakBtns = Array.from(el.querySelectorAll<HTMLElement>(".sprout-flashcard-speak-btn"));
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

      const side = ((e.currentTarget as HTMLElement).getAttribute("data-sprout-tts-side") === "back") ? "back" : "front";
      const panelSelector = side === "back" ? ".sprout-flashcard-answer" : ".sprout-flashcard-question";
      const panel = el.querySelector<HTMLElement>(panelSelector);
      if (!panel) return;

      const panelText = (panel.innerText || panel.textContent || "").replace(/\s+/g, " ").trim();
      const imageAlt = Array.from(panel.querySelectorAll<HTMLImageElement>("img[alt]")).map((img) => (img.alt || "").trim()).filter(Boolean).join(" ");
      const raw = [panelText, imageAlt].filter(Boolean).join(" ").trim();
      const isClozeLike = el.dataset.sproutType === "cloze" || el.dataset.sproutType === "cloze-child";
      const clozeFrontText = raw.replace(/_+/g, " blank ").replace(/\s+/g, " ").trim();
      const clozeFallback = String(card.fields.CQ ?? "")
        .replace(/\{\{c\d+::([\s\S]*?)\}\}/g, " blank ")
        .replace(/\s+/g, " ")
        .trim();
      const text = (isClozeLike && side === "front")
        ? (clozeFrontText || clozeFallback)
        : raw;
      if (!text) return;
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
        flipAnimateCards(before, el);
      });
    });
  });

  // Render MathJax if present
  void renderMdInElements(el, card);
}

export function renderReadingViewPreviewCard(el: HTMLElement, card: SproutCard): void {
  el.classList.add("el-p");
  el.setAttribute("data-sprout-processed", "true");
  enhanceCardElement(el, card, "", undefined, true);

  const editButtons = el.querySelectorAll<HTMLElement>(".sprout-card-edit-btn");
  editButtons.forEach((button) => {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("tabindex", "-1");
  });

  const audioButtons = el.querySelectorAll<HTMLButtonElement>(".sprout-flashcard-speak-btn");
  audioButtons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.tabIndex = -1;
  });
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
