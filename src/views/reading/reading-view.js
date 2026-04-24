/**
 * @file src/reading/reading-view.ts
 * @summary Stateful, side-effectful code for Sprout's reading-view pretty-card rendering and masonry layout. Owns all mutable module-level state (sproutPluginRef, masonry timers, MutationObserver) and the Obsidian registerMarkdownPostProcessor hook that transforms card blocks into styled, interactive card elements in the editor.
 *
 * @exports
 *  - registerReadingViewPrettyCards — registers the markdown post-processor that renders pretty cards in reading view
 */
import { Component, MarkdownRenderer, MarkdownView, Notice, setIcon, TFile, renderMath, finishRenderMath } from "obsidian";
import { log } from "../../platform/core/logger";
import { escapeDelimiterRe } from "../../platform/core/delimiter";
import { openBulkEditModalForCards } from "../../platform/modals/bulk-edit";
import { ImageOcclusionCreatorModal } from "../../platform/modals/image-occlusion-creator-modal";
import { buildCardBlockMarkdown, findCardBlockRangeById } from "../reviewer/markdown-block";
import { syncOneFile } from "../../platform/integrations/sync/sync-engine";
import { queryFirst, replaceChildrenWithHTML, setCssProps } from "../../platform/core/ui";
import { DEFAULT_SETTINGS } from "../../platform/core/default-settings";
import { resolveImageFile } from "../../platform/image-occlusion/io-helpers";
import { ANCHOR_RE, clean, escapeHtml, extractRawTextFromParagraph, extractTextWithLaTeX, extractCardFromSource, parseSproutCard, normalizeMathSignature, processMarkdownFeatures, buildCardContentHTML, } from "./reading-helpers";
import { getTtsService } from "../../platform/integrations/tts/tts-service";
import { hasCardAnchorForId } from "../../platform/core/identity";
import { buildReadingFlashcardCloze } from "./reading-flashcard-cloze";
/* -----------------------
   Module-level mutable state
   ----------------------- */
let sproutPluginRef = null;
function getSproutPlugin() {
    var _a, _b, _c;
    if (sproutPluginRef)
        return sproutPluginRef;
    try {
        const plugin = Object.values((_c = (_b = (_a = window === null || window === void 0 ? void 0 : window.app) === null || _a === void 0 ? void 0 : _a.plugins) === null || _b === void 0 ? void 0 : _b.plugins) !== null && _c !== void 0 ? _c : {}).find((p) => {
            var _a;
            const sp = p;
            return !!(sp === null || sp === void 0 ? void 0 : sp.store) && !!((_a = sp === null || sp === void 0 ? void 0 : sp.settings) === null || _a === void 0 ? void 0 : _a.general);
        });
        return plugin !== null && plugin !== void 0 ? plugin : null;
    }
    catch (_d) {
        return null;
    }
}
function debugLog(...args) {
    log.debug(...args);
}
/* =========================
   Colour derivation helpers
   ========================= */
/**
 * Parse a hex colour string to HSL components.
 * Returns { h: 0-360, s: 0-100, l: 0-100 }.
 */
function hexToHsl(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result)
        return { h: 0, s: 0, l: 50 };
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
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
/**
 * Convert HSL to a hex colour string.
 */
function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
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
function deriveColourForDark(lightHex) {
    const { h, s, l } = hexToHsl(lightHex);
    // Map light background (high L) to dark background (low L)
    const darkL = Math.max(8, Math.min(25, 100 - l));
    const darkS = Math.max(0, s - 10);
    return hslToHex(h, darkS, darkL);
}
/**
 * Derive readable body text for dark backgrounds from a light-theme text colour.
 */
function deriveTextForDark(lightHex) {
    const { h, s, l } = hexToHsl(lightHex);
    const darkL = Math.max(72, Math.min(92, l + 42));
    const darkS = Math.max(0, s - 12);
    return hslToHex(h, darkS, darkL);
}
let readingDynamicStyleSheet = null;
function getReadingDynamicStyleSheet() {
    if (typeof document === 'undefined' || typeof CSSStyleSheet === 'undefined')
        return null;
    if (readingDynamicStyleSheet)
        return readingDynamicStyleSheet;
    const doc = document;
    const existing = doc.adoptedStyleSheets;
    if (!Array.isArray(existing))
        return null;
    const sheet = new CSSStyleSheet();
    doc.adoptedStyleSheets = [...existing, sheet];
    readingDynamicStyleSheet = sheet;
    return readingDynamicStyleSheet;
}
function normaliseMacroPreset(raw) {
    const key = String(raw || '').trim().toLowerCase();
    if (key === 'minimal-flip')
        return 'flashcards';
    if (key === 'full-card')
        return 'classic';
    if (key === 'compact')
        return 'markdown';
    if (key === 'classic' || key === 'guidebook' || key === 'flashcards' || key === 'markdown' || key === 'custom')
        return key;
    return 'flashcards';
}
function resolveReadingLayout(rawLayout, macroPreset) {
    if (macroPreset === 'classic' || macroPreset === 'flashcards')
        return 'masonry';
    return rawLayout === 'vertical' ? 'vertical' : 'masonry';
}
/**
 * Injects or updates a dynamic stylesheet that writes the current reading-view
 * settings as CSS rules. This makes colour, font, layout, and mode changes
 * instant — no per-card DOM manipulation or full re-render needed.
 *
 * Called once on init and again whenever a reading-view setting changes.
 */
export function syncReadingViewStyles() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const plugin = getSproutPlugin();
    const enabled = !!((_b = (_a = plugin === null || plugin === void 0 ? void 0 : plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.enableReadingStyles);
    const rv = (_c = plugin === null || plugin === void 0 ? void 0 : plugin.settings) === null || _c === void 0 ? void 0 : _c.readingView;
    const macroPreset = normaliseMacroPreset((_d = rv === null || rv === void 0 ? void 0 : rv.activeMacro) !== null && _d !== void 0 ? _d : rv === null || rv === void 0 ? void 0 : rv.preset);
    const effectiveLayout = resolveReadingLayout(rv === null || rv === void 0 ? void 0 : rv.layout, macroPreset);
    const macroSelector = `.learnkit-pretty-card.learnkit-macro-${macroPreset}`;
    const styleSheet = getReadingDynamicStyleSheet();
    if (!styleSheet)
        return;
    if (!enabled) {
        styleSheet.replaceSync("");
        return;
    }
    const macroConfig = macroPreset === 'classic'
        ? (_e = rv === null || rv === void 0 ? void 0 : rv.macroConfigs) === null || _e === void 0 ? void 0 : _e.classic
        : macroPreset === 'guidebook'
            ? (_f = rv === null || rv === void 0 ? void 0 : rv.macroConfigs) === null || _f === void 0 ? void 0 : _f.guidebook
            : macroPreset === 'markdown'
                ? (_g = rv === null || rv === void 0 ? void 0 : rv.macroConfigs) === null || _g === void 0 ? void 0 : _g.markdown
                : macroPreset === 'custom'
                    ? (_h = rv === null || rv === void 0 ? void 0 : rv.macroConfigs) === null || _h === void 0 ? void 0 : _h.custom
                    : (_j = rv === null || rv === void 0 ? void 0 : rv.macroConfigs) === null || _j === void 0 ? void 0 : _j.flashcards;
    let css = '';
    // ── Font size ──
    const fontSize = Number(rv === null || rv === void 0 ? void 0 : rv.fontSize);
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
    css += `.markdown-preview-section > [data-learnkit-hidden="true"] {\n`;
    css += `  display: none !important;\n`;
    css += `  max-height: 0 !important;\n`;
    css += `  overflow: hidden !important;\n`;
    css += `  margin: 0 !important;\n`;
    css += `  padding: 0 !important;\n`;
    css += `  border: none !important;\n`;
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
        css += `  margin-bottom: 16px !important;\n`;
        css += `}\n`;
    }
    // ── Card mode: full (expand collapsibles, hide toggle buttons) ──
    if ((rv === null || rv === void 0 ? void 0 : rv.cardMode) === 'full') {
        css += `.learnkit-pretty-card .learnkit-collapsible { max-height: none !important; overflow: visible !important; }\n`;
        css += `.learnkit-pretty-card .learnkit-toggle-btn { display: none !important; }\n`;
    }
    // ── Field visibility / included data ──
    const macroFields = macroConfig === null || macroConfig === void 0 ? void 0 : macroConfig.fields;
    const activeFields = macroFields !== null && macroFields !== void 0 ? macroFields : rv === null || rv === void 0 ? void 0 : rv.visibleFields;
    if (activeFields) {
        const vf = activeFields;
        if (!vf.title)
            css += `${macroSelector} .learnkit-card-header { display: none !important; }\n`;
        if (!vf.question)
            css += `${macroSelector} .learnkit-section-question { display: none !important; }\n`;
        if (!vf.options)
            css += `${macroSelector} .learnkit-section-options { display: none !important; }\n`;
        if (!vf.answer)
            css += `${macroSelector} .learnkit-section-answer { display: none !important; }\n`;
        if (!vf.info)
            css += `${macroSelector} .learnkit-section-info { display: none !important; }\n`;
        if (!vf.groups)
            css += `${macroSelector} .learnkit-groups-list, ${macroSelector} .learnkit-section-groups { display: none !important; }\n`;
        if (!vf.edit && macroPreset !== 'flashcards')
            css += `${macroSelector} .learnkit-card-edit-btn { display: none !important; }\n`;
    }
    if (macroPreset === 'flashcards') {
        const showAudioButton = (macroFields === null || macroFields === void 0 ? void 0 : macroFields.displayAudioButton) !== false;
        const showEditButton = (macroFields === null || macroFields === void 0 ? void 0 : macroFields.displayEditButton) !== false;
        if (!showAudioButton)
            css += `${macroSelector} .learnkit-flashcard-speak-btn { display: none !important; }\n`;
        if (!showEditButton)
            css += `${macroSelector} .learnkit-card-edit-btn { display: none !important; }\n`;
    }
    const showLabels = (_l = (_k = macroConfig === null || macroConfig === void 0 ? void 0 : macroConfig.fields) === null || _k === void 0 ? void 0 : _k.labels) !== null && _l !== void 0 ? _l : rv === null || rv === void 0 ? void 0 : rv.displayLabels;
    if (showLabels === false) {
        css += `${macroSelector} .learnkit-section-label { display: none !important; }\n`;
    }
    if (macroPreset === 'classic') {
        css += `.learnkit-pretty-card.learnkit-macro-classic .learnkit-section-label { display: flex !important; }\n`;
    }
    if (macroPreset === 'custom') {
        const rawCustomCss = (_p = (_o = (_m = rv === null || rv === void 0 ? void 0 : rv.macroConfigs) === null || _m === void 0 ? void 0 : _m.custom) === null || _o === void 0 ? void 0 : _o.customCss) !== null && _p !== void 0 ? _p : '';
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
export function registerReadingViewPrettyCards(plugin) {
    debugLog("[LearnKit] Registering reading view prettifier");
    sproutPluginRef = plugin;
    // Inject dynamic styles from current reading-view settings
    syncReadingViewStyles();
    plugin.registerMarkdownPostProcessor(async (rootEl, ctx) => {
        var _a;
        try {
            // Skip if inside editor live preview
            if (rootEl.closest(".cm-content")) {
                debugLog("[LearnKit] Skipping - in editor content");
                return;
            }
            // Only run in reading/preview contexts
            const isInReadingView = rootEl.closest(".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section") !== null ||
                (ctx.containerEl && (ctx.containerEl.classList.contains("markdown-reading-view") || ctx.containerEl.classList.contains("markdown-preview-view") || ctx.containerEl.closest(".markdown-reading-view, .markdown-preview-view") !== null));
            if (!isInReadingView) {
                debugLog("[LearnKit] Skipping - not in reading/preview view");
                return;
            }
            // Try to get source file content
            let sourceContent = '';
            try {
                const ctxPaths = ctx;
                const sourcePath = (_a = ctxPaths.sourceNotePath) !== null && _a !== void 0 ? _a : ctxPaths.sourcePath;
                if (typeof sourcePath === "string" && sourcePath && plugin.app.vault) {
                    const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
                    if (file instanceof TFile && file.extension === "md") {
                        const content = await plugin.app.vault.read(file);
                        sourceContent = content;
                    }
                }
            }
            catch (e) {
                debugLog("[LearnKit] Could not read source file:", e);
            }
            // Parse and enhance any new .el-p nodes in this root
            await processCardElements(rootEl, ctx, sourceContent);
        }
        catch (err) {
            log.error("readingView prettifier error", err);
        }
    }, 1000);
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
        const leafContents = Array.from(document.querySelectorAll(".workspace-leaf-content[data-type='markdown']"));
        for (const leaf of leafContents) {
            // Find the markdown content area inside the leaf
            const content = leaf.querySelector(".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section");
            if (content) {
                content.removeEventListener("sprout:prettify-cards-refresh", handleRefreshEvent);
                content.addEventListener("sprout:prettify-cards-refresh", handleRefreshEvent);
                log.debug("Attached sprout:prettify-cards-refresh listener to", content);
            }
        }
    }
    function handleRefreshEvent(e) {
        var _a, _b, _c;
        log.debug("sprout:prettify-cards-refresh event received", e);
        // Re-sync the dynamic <style> element (colours, fonts, layout, card mode)
        syncReadingViewStyles();
        const stylesEnabled = !!((_c = (_b = (_a = getSproutPlugin()) === null || _a === void 0 ? void 0 : _a.settings) === null || _b === void 0 ? void 0 : _b.general) === null || _c === void 0 ? void 0 : _c.enableReadingStyles);
        const root = (e.currentTarget instanceof HTMLElement)
            ? e.currentTarget
            : (e.target instanceof HTMLElement ? e.target : null);
        const refreshDetail = e.detail;
        const sourceFromEvent = typeof (refreshDetail === null || refreshDetail === void 0 ? void 0 : refreshDetail.sourceContent) === 'string'
            ? refreshDetail.sourceContent
            : '';
        // When reading styles are disabled, remove all Sprout DOM adjustments
        if (!stylesEnabled) {
            if (root)
                resetCardsToNativeReading(root);
            else
                resetCardsToNativeReading(document.documentElement);
            return;
        }
        const refreshRoot = root !== null && root !== void 0 ? root : document.documentElement;
        resetCardsToNativeReading(refreshRoot);
        clearStaleReadingViewState(refreshRoot);
        void processCardElements(refreshRoot, undefined, sourceFromEvent);
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
        var _a;
        debugLog('[LearnKit] Received sprout-cards-inserted event — re-processing cards');
        (_a = window.sproutApplyMasonryGrid) === null || _a === void 0 ? void 0 : _a.call(window);
    });
    debugLog('[LearnKit] Manual trigger and event hook installed');
}
async function getLiveMarkdownSourceContent() {
    var _a, _b, _c, _d, _e, _f;
    try {
        const plugin = getSproutPlugin();
        if (!plugin)
            return '';
        const activeMarkdownView = (_b = (_a = plugin.app.workspace) === null || _a === void 0 ? void 0 : _a.getActiveViewOfType) === null || _b === void 0 ? void 0 : _b.call(_a, MarkdownView);
        if (((_c = activeMarkdownView === null || activeMarkdownView === void 0 ? void 0 : activeMarkdownView.getMode) === null || _c === void 0 ? void 0 : _c.call(activeMarkdownView)) === 'source') {
            const liveViewData = typeof activeMarkdownView.getViewData === 'function'
                ? String((_d = activeMarkdownView.getViewData()) !== null && _d !== void 0 ? _d : '')
                : '';
            if (liveViewData.trim())
                return liveViewData;
        }
        const activeFile = (_f = (_e = plugin.app.workspace) === null || _e === void 0 ? void 0 : _e.getActiveFile) === null || _f === void 0 ? void 0 : _f.call(_e);
        if (activeFile instanceof TFile && activeFile.extension === 'md') {
            return await plugin.app.vault.read(activeFile);
        }
    }
    catch (e) {
        debugLog('[LearnKit] Could not read live markdown source content:', e);
    }
    return '';
}
/* =========================
   Debounced MutationObserver
   ========================= */
let mutationObserver = null;
let debounceTimer = null;
const DEBOUNCE_MS = 120;
let viewportReflowTimer = null;
const VIEWPORT_REFLOW_DEBOUNCE_MS = 90;
// Registered window listeners (stored for cleanup)
let registeredWindowListeners = [];
function addTrackedWindowListener(event, handler, options) {
    window.addEventListener(event, handler, options);
    registeredWindowListeners.push({ event, handler, options });
}
/** Tear down all module-level state. Called from plugin.onunload(). */
export function teardownReadingView() {
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
        window.removeEventListener(event, handler, options);
    }
    registeredWindowListeners = [];
    // Clear global references
    sproutPluginRef = null;
    delete window.sproutApplyMasonryGrid;
    // Detach dynamic reading stylesheet
    if (readingDynamicStyleSheet) {
        const doc = document;
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
        var _a, _b, _c, _d, _e, _f, _g;
        // Collect specific containers that have new unprocessed .el-p elements
        const dirtyContainers = new Set();
        // Sections re-entering the DOM (Obsidian's virtualiser) with
        // already-processed cards that need their card-run wrappers restored.
        const sectionsNeedingLayout = new Set();
        for (const m of mutations) {
            // Only watch for added nodes (new content), ignore removals and repositioning
            if (m.type === 'childList' && m.addedNodes.length > 0) {
                // Skip mutations inside the editor
                if (m.target instanceof Element && m.target.closest('.cm-content'))
                    continue;
                // Skip mutations inside our own card-run wrappers (from wrapping/unwrapping)
                if (m.target instanceof Element && m.target.closest('.learnkit-reading-card-run'))
                    continue;
                // Skip mutations outside reading view contexts
                if (m.target instanceof Element && !m.target.closest('.markdown-reading-view, .markdown-preview-view, .markdown-rendered'))
                    continue;
                for (const n of Array.from(m.addedNodes)) {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        const el = n;
                        // Skip our own wrapper nodes being added
                        if (el instanceof HTMLElement && el.classList.contains('learnkit-reading-card-run'))
                            continue;
                        // Only trigger if we see actual NEW .el-p or sprout cards
                        // Skip if the added node is just being moved (check if it already has sprout-processed)
                        if (el.matches && el.matches('.el-p') && !el.hasAttribute('data-learnkit-processed')) {
                            // Find the closest section or reading view container
                            const section = el.closest('.markdown-preview-section');
                            if (section)
                                dirtyContainers.add(section);
                            else
                                dirtyContainers.add(el);
                        }
                        else if (queryFirst(el, '.el-p:not([data-learnkit-processed])')) {
                            dirtyContainers.add(el);
                        }
                        // Detect sections re-entering the DOM with already-processed
                        // cards that aren't wrapped in .learnkit-reading-card-run yet.
                        // This handles Obsidian's virtualised scroll (#56) — sections
                        // removed from the DOM and re-added lose their card-run wrappers.
                        if (el instanceof HTMLElement) {
                            const isSection = el.classList.contains('markdown-preview-section');
                            if (isSection && el.querySelector('.learnkit-pretty-card') && !el.querySelector('.learnkit-reading-card-run')) {
                                sectionsNeedingLayout.add(el);
                            }
                            else if (el.classList.contains('learnkit-pretty-card') && !el.closest('.learnkit-reading-card-run')) {
                                // A processed card was added outside a card-run wrapper
                                // (e.g. post-processor ran while element was detached).
                                const section = el.closest('.markdown-preview-section');
                                if (section)
                                    sectionsNeedingLayout.add(section);
                            }
                            else if (!isSection) {
                                // The added node might contain sections (e.g. a container node)
                                (_b = (_a = el.querySelectorAll) === null || _a === void 0 ? void 0 : _a.call(el, '.markdown-preview-section')) === null || _b === void 0 ? void 0 : _b.forEach((sec) => {
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
            const stylesEnabled = !!((_e = (_d = (_c = getSproutPlugin()) === null || _c === void 0 ? void 0 : _c.settings) === null || _d === void 0 ? void 0 : _d.general) === null || _e === void 0 ? void 0 : _e.enableReadingStyles);
            if (stylesEnabled) {
                const rvSettings = (_g = (_f = getSproutPlugin()) === null || _f === void 0 ? void 0 : _f.settings) === null || _g === void 0 ? void 0 : _g.readingView;
                applyLayoutToSections(sectionsNeedingLayout, rvSettings);
            }
        }
        if (dirtyContainers.size === 0)
            return;
        if (debounceTimer)
            window.clearTimeout(debounceTimer);
        // Capture the containers before the timeout (they're DOM nodes, so references stay valid)
        const containers = Array.from(dirtyContainers);
        debounceTimer = window.setTimeout(() => {
            try {
                debugLog('[LearnKit] MutationObserver triggered — processing', containers.length, 'dirty containers');
                for (const container of containers) {
                    // Only process if the container is still in the DOM
                    if (container.isConnected) {
                        void processCardElements(container, undefined, '');
                    }
                }
            }
            catch (err) {
                log.error('MutationObserver handler error', err);
            }
            finally {
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
        debugLog('[LearnKit] MutationObserver attached to document.body');
    }
    else {
        debugLog('[LearnKit] document.body not available for MutationObserver');
    }
}
/* =========================
   Card processing
   ========================= */
async function processCardElements(container, _ctx, sourceContent) {
    var _a, _b;
    // Skip card prettification entirely when prettify is off
    try {
        const pluginCheck = getSproutPlugin();
        const stylesEnabled = !!((_b = (_a = pluginCheck === null || pluginCheck === void 0 ? void 0 : pluginCheck.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.enableReadingStyles);
        if (!stylesEnabled) {
            debugLog('[LearnKit] Prettify cards is off — skipping card processing');
            resetCardsToNativeReading(container);
            return;
        }
    }
    catch ( /* proceed if we can't read settings */_c) { /* proceed if we can't read settings */ }
    // If no source content provided, prefer the live markdown view buffer
    // (includes unsaved source edits during source -> reading transitions),
    // then fall back to reading from the vault file.
    if (!sourceContent) {
        sourceContent = await getLiveMarkdownSourceContent();
    }
    const found = [];
    const applyLayoutForContainer = () => {
        try {
            reflowPrettyCardLayouts(container);
        }
        catch (e) {
            log.swallow('apply reading view settings', e);
        }
    };
    try {
        if (container.matches && container.matches('.el-p'))
            found.push(container);
    }
    catch (_d) {
        // ignore
    }
    container.querySelectorAll('.el-p:not([data-learnkit-processed])').forEach(el => found.push(el));
    if (found.length === 0) {
        debugLog('[LearnKit] No unprocessed .el-p elements found in container');
        // Field-only edits can change card bodies without creating new anchor
        // paragraphs. Rebuild existing processed cards from latest source text.
        void refreshProcessedCards(container, sourceContent);
        applyLayoutForContainer();
        hideSectionLevelOrphanDelimitedParagraphs(container);
        return;
    }
    debugLog(`[LearnKit] Found ${found.length} potential card elements to parse`);
    for (const el of found) {
        try {
            // skip editor content
            if (el.closest('.cm-content'))
                continue;
            // Extract anchor ID first to find the card in source
            let rawText = extractRawTextFromParagraph(el);
            const rawClean = clean(rawText);
            const anchorMatch = rawClean.match(ANCHOR_RE);
            if (!anchorMatch)
                continue;
            const anchorId = anchorMatch[1];
            // If we have source content, try to extract the card from it
            if (sourceContent) {
                const cardFromSource = extractCardFromSource(sourceContent, anchorId);
                if (cardFromSource) {
                    rawText = cardFromSource;
                }
            }
            const card = parseSproutCard(rawText);
            if (!card)
                continue;
            el.dataset.sproutProcessed = 'true';
            enhanceCardElement(el, card, undefined, rawText);
        }
        catch (err) {
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
    hideSectionLevelOrphanDelimitedParagraphs(container);
    await Promise.resolve();
}
async function refreshProcessedCards(container, sourceContent) {
    var _a, _b, _c, _d;
    const cards = Array.from(container.querySelectorAll('.learnkit-pretty-card[data-learnkit-raw-text], .el-p[data-learnkit-processed][data-learnkit-raw-text]'));
    if (!cards.length)
        return;
    const latestSource = (sourceContent === null || sourceContent === void 0 ? void 0 : sourceContent.trim()) ? sourceContent : await getLiveMarkdownSourceContent();
    const touchedSections = new Set();
    for (const el of cards) {
        try {
            if (el.closest('.cm-content'))
                continue;
            let rawText = String(el.getAttribute('data-learnkit-raw-text') || '');
            const anchorFromAttr = String(el.getAttribute('data-learnkit-id') || '').trim();
            const anchorFromRaw = (_b = (_a = rawText.match(ANCHOR_RE)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : '';
            const anchorId = anchorFromAttr || anchorFromRaw;
            if (latestSource && anchorId) {
                const extracted = extractCardFromSource(latestSource, anchorId);
                if (extracted) {
                    rawText = extracted;
                    el.setAttribute('data-learnkit-raw-text', extracted);
                }
            }
            if (!rawText.trim())
                continue;
            const card = parseSproutCard(rawText);
            if (!card)
                continue;
            enhanceCardElement(el, card, undefined, rawText);
            const section = el.closest('.markdown-preview-section');
            if (section)
                touchedSections.add(section);
        }
        catch (err) {
            log.error('Error refreshing processed card', err);
        }
    }
    if (container.classList.contains('markdown-preview-section')) {
        touchedSections.add(container);
    }
    if (!touchedSections.size)
        return;
    const rvSettings = (_d = (_c = getSproutPlugin()) === null || _c === void 0 ? void 0 : _c.settings) === null || _d === void 0 ? void 0 : _d.readingView;
    applyLayoutToSections(touchedSections, rvSettings);
    touchedSections.forEach((section) => hideSectionLevelOrphanDelimitedParagraphs(section));
}
function resetCardsToNativeReading(container) {
    var _a, _b;
    const cards = Array.from(container.querySelectorAll('.learnkit-pretty-card'));
    for (const card of cards) {
        try {
            const originalHtml = (_b = (_a = card.querySelector('.learnkit-original-content')) === null || _a === void 0 ? void 0 : _a.innerHTML) !== null && _b !== void 0 ? _b : '';
            if (originalHtml)
                replaceChildrenWithHTML(card, originalHtml);
            card.classList.remove('learnkit-pretty-card', 'learnkit-pretty-card', 'learnkit-reading-card', 'learnkit-reading-card', 'learnkit-reading-view-wrapper', 'learnkit-reading-view-wrapper', 'learnkit-single-card', 'learnkit-single-card', 'learnkit-custom-root', 'learnkit-custom-root', 'learnkit-flashcard-flipped', 'learnkit-flashcard-flipped', 'learnkit-flashcard-animating', 'learnkit-flashcard-animating', 'accent', 'theme', 'learnkit-macro-classic', 'learnkit-macro-classic', 'learnkit-macro-guidebook', 'learnkit-macro-guidebook', 'learnkit-macro-flashcards', 'learnkit-macro-flashcards', 'learnkit-macro-markdown', 'learnkit-macro-markdown', 'learnkit-macro-custom', 'learnkit-macro-custom');
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
        }
        catch (err) {
            log.error('Error resetting pretty card to native reading', err);
        }
    }
    const sections = new Set();
    cards.forEach((card) => {
        const section = card.closest('.markdown-preview-section');
        if (section)
            sections.add(section);
    });
    if (container.classList.contains('markdown-preview-section')) {
        sections.add(container);
    }
    sections.forEach((section) => {
        applySectionCardRunLayout(section, 'vertical');
        section.classList.remove('learnkit-layout-vertical', 'learnkit-layout-vertical', 'learnkit-layout-masonry', 'learnkit-layout-masonry');
    });
}
function clearStaleReadingViewState(container) {
    // Reveal any source fragments hidden by prior pretty-card passes.
    container
        .querySelectorAll('[data-learnkit-hidden="true"], .learnkit-hidden-important')
        .forEach((el) => {
        el.classList.remove('learnkit-hidden-important', 'learnkit-hidden-important');
        el.removeAttribute('data-learnkit-hidden');
    });
    // Drop stale processed markers so updated markdown paragraphs are reparsed.
    container.querySelectorAll('.el-p[data-learnkit-processed]').forEach((el) => {
        el.removeAttribute('data-learnkit-processed');
        el.removeAttribute('data-learnkit-raw-text');
        el.removeAttribute('data-learnkit-id');
        el.removeAttribute('data-learnkit-type');
    });
    const sections = new Set();
    if (container.classList.contains('markdown-preview-section')) {
        sections.add(container);
    }
    container.querySelectorAll('.markdown-preview-section').forEach((section) => sections.add(section));
    // Ensure any stale wrappers/layout classes are rebuilt from a clean DOM.
    sections.forEach((section) => {
        unwrapCardRuns(section);
        section.classList.remove('learnkit-layout-vertical', 'learnkit-layout-vertical', 'learnkit-layout-masonry', 'learnkit-layout-masonry');
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
function snapshotCardPositions(cardEl) {
    const section = cardEl.closest('.markdown-preview-section');
    if (!section)
        return new Map();
    const positions = new Map();
    section.querySelectorAll('.learnkit-pretty-card').forEach(card => {
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
function flipAnimateCards(before, lockedCard) {
    if (before.size === 0)
        return;
    const lockedCards = new Set();
    if (lockedCard) {
        lockedCards.add(lockedCard);
        const oldLockedRect = before.get(lockedCard);
        if (oldLockedRect) {
            for (const [card, rect] of before) {
                if (card === lockedCard)
                    continue;
                const overlapsX = rect.right > oldLockedRect.left + 1 && rect.left < oldLockedRect.right - 1;
                const isAbove = rect.bottom <= oldLockedRect.top + 2;
                if (overlapsX && isAbove)
                    lockedCards.add(card);
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
        if (lockedCards.has(card))
            continue;
        const newRect = card.getBoundingClientRect();
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        // Skip cards that haven't moved
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1)
            continue;
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
            if (lockedCards.has(card))
                continue;
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
function unwrapCardRuns(section) {
    const wrappers = Array.from(section.querySelectorAll(':scope > .learnkit-reading-card-run'));
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
function wrapContiguousCardRuns(section) {
    // Fast-path: skip destructive teardown + rebuild when every visible
    // card is already inside a .learnkit-reading-card-run wrapper.
    // This prevents the column→single-column→column flicker (#56)
    // that occurs when scroll / resize debounce triggers a full reflow.
    const hasUnwrappedVisibleCards = Array.from(section.children).some(child => {
        if (!(child instanceof HTMLElement))
            return false;
        return child.classList.contains('learnkit-pretty-card') &&
            !child.classList.contains('learnkit-hidden-important') &&
            child.getAttribute('data-learnkit-hidden') !== 'true';
    });
    if (!hasUnwrappedVisibleCards)
        return;
    unwrapCardRuns(section);
    const children = Array.from(section.children);
    let currentRun = null;
    for (const child of children) {
        const isCard = child.classList.contains('learnkit-pretty-card');
        const isHidden = child.classList.contains('learnkit-hidden-important') || child.getAttribute('data-learnkit-hidden') === 'true';
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
        if (isHidden && currentRun) {
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
function applySectionCardRunLayout(section, layout) {
    if (layout === 'masonry') {
        wrapContiguousCardRuns(section);
        return;
    }
    unwrapCardRuns(section);
}
function resolveSectionLayoutFromDomAndSettings(section, rvSettings) {
    var _a;
    if (section.querySelector('.learnkit-pretty-card.learnkit-macro-flashcards, .learnkit-pretty-card.learnkit-macro-classic')) {
        return 'masonry';
    }
    if (rvSettings) {
        const macroPreset = normaliseMacroPreset((_a = rvSettings.activeMacro) !== null && _a !== void 0 ? _a : rvSettings.preset);
        return resolveReadingLayout(rvSettings.layout, macroPreset);
    }
    return 'masonry';
}
function applyLayoutToSections(sections, rvSettings) {
    for (const section of sections) {
        const effectiveLayout = resolveSectionLayoutFromDomAndSettings(section, rvSettings);
        if (effectiveLayout === 'vertical') {
            section.classList.add('learnkit-layout-vertical', 'learnkit-layout-vertical');
            section.classList.remove('learnkit-layout-masonry', 'learnkit-layout-masonry');
            applySectionCardRunLayout(section, 'vertical');
        }
        else {
            section.classList.remove('learnkit-layout-vertical', 'learnkit-layout-vertical');
            section.classList.add('learnkit-layout-masonry', 'learnkit-layout-masonry');
            applySectionCardRunLayout(section, 'masonry');
        }
    }
}
function collectSectionsWithPrettyCards(scope) {
    const sections = new Set();
    if (scope instanceof HTMLElement) {
        // If scope itself is a .markdown-preview-section containing cards
        if (scope.classList.contains('markdown-preview-section') && scope.querySelector('.learnkit-pretty-card')) {
            sections.add(scope);
        }
        // If scope itself is (or has become) a pretty card, find its parent section
        if (scope.classList.contains('learnkit-pretty-card')) {
            const section = scope.closest('.markdown-preview-section');
            if (section)
                sections.add(section);
        }
    }
    scope.querySelectorAll('.learnkit-pretty-card').forEach((card) => {
        const section = card.closest('.markdown-preview-section');
        if (section)
            sections.add(section);
    });
    return sections;
}
function reflowPrettyCardLayouts(scope = document) {
    var _a, _b;
    const sections = collectSectionsWithPrettyCards(scope);
    if (!sections.size)
        return;
    const rvSettings = (_b = (_a = getSproutPlugin()) === null || _a === void 0 ? void 0 : _a.settings) === null || _b === void 0 ? void 0 : _b.readingView;
    applyLayoutToSections(sections, rvSettings);
}
function scheduleViewportReflow() {
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
function stripMarkdownFormatting(s) {
    let out = s;
    // Remove list markers at line starts so DOM list text can match raw markdown.
    out = out.replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "");
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
function siblingTextBelongsToCard(siblingText, cardTextStripped, cardTextNorm, cardTextRaw, cardMathSig, siblingEl) {
    const rawNorm = clean(siblingText).replace(/\s+/g, " ").trim();
    if (!rawNorm)
        return true; // Empty siblings between card paragraphs — safe to hide
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
        const listLines = String(siblingText !== null && siblingText !== void 0 ? siblingText : '')
            .split(/\r?\n/g)
            .map((line) => clean(line).trim())
            .filter(Boolean);
        if (listLines.length > 0 && cardTextRaw) {
            const allLinesFound = listLines.every((line) => cardTextRaw.includes(line) ||
                cardTextRaw.includes(`- ${line}`) ||
                cardTextRaw.includes(`* ${line}`) ||
                cardTextRaw.includes(`+ ${line}`));
            if (allLinesFound)
                return true;
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
    const looksLikeCardContent = /\{\{c\d+::/.test(siblingText) ||
        new RegExp(`^\\s*[A-Z]{1,3}\\s*${delimEsc}`).test(siblingText) ||
        new RegExp(`\\}\\}\\s*${delimEsc}`).test(siblingText);
    if (looksLikeCardContent) {
        return true;
    }
    return false;
}
function isLikelyDanglingCardResidue(siblingText, siblingEl) {
    // Only apply this heuristic to paragraph-like spillover blocks.
    if (!(siblingEl.classList.contains('el-p') || siblingEl.classList.contains('el-div'))) {
        return false;
    }
    const lines = String(siblingText !== null && siblingText !== void 0 ? siblingText : '')
        .split(/\r?\n/g)
        .map((line) => clean(line).trim())
        .filter(Boolean);
    if (!lines.length)
        return false;
    if (lines.some((line) => ANCHOR_RE.test(line) || /^#{1,6}\s/.test(line)))
        return false;
    const delimEsc = escapeDelimiterRe();
    const fieldStartRe = new RegExp(`^([A-Za-z]+|\\d{1,2})\\s*${delimEsc}\\s*`);
    const trailingDelimRe = new RegExp(`${delimEsc}\\s*$`);
    // If this already looks like a valid card field start, leave it visible.
    if (lines.some((line) => fieldStartRe.test(line)))
        return false;
    // Typical orphan residue from malformed/unfinished multiline card fields
    // contains a dangling trailing delimiter line (e.g. "What |", "Lol |").
    if (!lines.some((line) => trailingDelimRe.test(line)))
        return false;
    // Restrict to flashcard section context so ordinary prose elsewhere is untouched.
    const section = siblingEl.closest('.markdown-preview-section');
    if (section) {
        const hasFlashcardRun = !!section.querySelector('.learnkit-reading-card-run .learnkit-pretty-card.learnkit-macro-flashcards');
        if (!hasFlashcardRun)
            return false;
    }
    return true;
}
/**
 * Hide duplicate siblings after individual cards.
 * Obsidian's reading-view renderer splits card blocks at blank lines,
 * creating sibling `.el-p` / `.el-ol` / `.el-ul` elements that duplicate
 * content already rendered inside the pretty-card.
 */
function hideCardSiblingElements(cardEl, cardRawText) {
    const cardTextRaw = cardRawText ? clean(cardRawText) : "";
    const cardTextNorm = cardTextRaw ? cardTextRaw.replace(/\s+/g, " ").trim() : "";
    // Strip markdown from the raw multiline source (before whitespace collapse)
    // so list markers at line starts are removed correctly.
    const cardTextStripped = cardTextRaw ? stripMarkdownFormatting(cardTextRaw) : "";
    const cardMathSig = cardTextNorm ? normalizeMathSignature(cardTextNorm) : "";
    // Prefer card-local siblings first. If this is the last card in a run,
    // fall back to the run's next sibling to catch trailing spillover nodes.
    let next = cardEl.nextElementSibling;
    if (!next) {
        const run = cardEl.closest('.learnkit-reading-card-run');
        if (run && cardEl.parentElement === run) {
            next = run.nextElementSibling;
        }
    }
    const toHide = [];
    while (next) {
        const classes = next.className || '';
        // Skip siblings already hidden by a previous run
        if (next.hasAttribute('data-learnkit-hidden')) {
            next = next.nextElementSibling;
            continue;
        }
        // Stop if we hit another sprout card (already processed)
        if (classes.includes('learnkit-pretty-card') || classes.includes('learnkit-reading-card-run') || next.hasAttribute('data-learnkit-processed')) {
            break;
        }
        // Stop if we hit an anchor for the NEXT card (unprocessed .el-p with card anchor)
        if (classes.includes('el-p') && !classes.includes('learnkit-pretty-card')) {
            const txt = extractRawTextFromParagraph(next);
            const cleanTxt = clean(txt);
            if (ANCHOR_RE.test(cleanTxt) && !hasCardAnchorForId(cleanTxt, String(cardEl.dataset.sproutId || ""))) {
                break;
            }
        }
        // Extract text from the sibling, regardless of its element type
        let raw = "";
        if (classes.includes('el-p')) {
            raw = extractRawTextFromParagraph(next);
        }
        else if (classes.includes('el-div')) {
            raw = extractTextWithLaTeX(next);
        }
        else if (classes.includes('el-ol') ||
            classes.includes('el-ul') ||
            classes.includes('el-blockquote') ||
            classes.includes('el-table')) {
            // For structural elements, check if their text belongs to the card
            raw = next.innerText || next.textContent || '';
        }
        else if (classes.includes('el-pre')) {
            // Code blocks — stop unless text is part of card
            raw = next.textContent || '';
        }
        else {
            // Unknown element type — try text content before giving up
            raw = next.textContent || '';
            if (!raw.trim()) {
                // Empty unknown elements — safe to hide
                toHide.push(next);
                next = next.nextElementSibling;
                continue;
            }
        }
        if (siblingTextBelongsToCard(raw, cardTextStripped, cardTextNorm, cardTextRaw, cardMathSig, next)) {
            toHide.push(next);
            next = next.nextElementSibling;
            continue;
        }
        if (isLikelyDanglingCardResidue(raw, next)) {
            toHide.push(next);
            next = next.nextElementSibling;
            continue;
        }
        // No match — stop hiding so normal content can render
        break;
    }
    // Hide collected elements with increased specificity
    for (const el of toHide) {
        el.classList.add('learnkit-hidden-important', 'learnkit-hidden-important');
        el.setAttribute('data-learnkit-hidden', 'true');
    }
}
function scheduleDeferredSiblingHide(cardEl, cardRawText) {
    const run = () => {
        try {
            hideCardSiblingElements(cardEl, cardRawText);
        }
        catch (_a) {
            // Best-effort cleanup only.
        }
    };
    // Some structural blocks (lists/tables) are injected after the first pass.
    window.requestAnimationFrame(run);
    window.setTimeout(run, 0);
    window.setTimeout(run, 50);
    window.setTimeout(run, 150);
}
function hideSectionLevelOrphanDelimitedParagraphs(scope) {
    var _a, _b;
    const sections = [];
    if (scope instanceof HTMLElement) {
        if (scope.classList.contains('markdown-preview-section')) {
            sections.push(scope);
        }
        scope.querySelectorAll('.markdown-preview-section').forEach((sec) => sections.push(sec));
    }
    const delimEsc = escapeDelimiterRe();
    const trailingDelimRe = new RegExp(`${delimEsc}\\s*$`);
    for (const section of sections) {
        const hasFlashcards = !!section.querySelector('.learnkit-reading-card-run .learnkit-pretty-card.learnkit-macro-flashcards');
        if (!hasFlashcards)
            continue;
        const children = Array.from(section.children).filter((c) => c instanceof HTMLElement);
        for (let i = 0; i < children.length; i++) {
            const el = children[i];
            if (!el.classList.contains('el-p'))
                continue;
            if (el.hasAttribute('data-learnkit-processed'))
                continue;
            const raw = extractRawTextFromParagraph(el);
            const lines = String(raw !== null && raw !== void 0 ? raw : '')
                .split(/\r?\n/g)
                .map((line) => clean(line).trim())
                .filter(Boolean);
            if (!lines.length)
                continue;
            if (lines.some((line) => ANCHOR_RE.test(line) || /^#{1,6}\s/.test(line)))
                continue;
            if (!lines.some((line) => trailingDelimRe.test(line)))
                continue;
            const prev = (_a = children[i - 1]) !== null && _a !== void 0 ? _a : null;
            const next = (_b = children[i + 1]) !== null && _b !== void 0 ? _b : null;
            const nearCardRun = !!(prev === null || prev === void 0 ? void 0 : prev.classList.contains('learnkit-reading-card-run')) ||
                !!(next === null || next === void 0 ? void 0 : next.classList.contains('learnkit-reading-card-run'));
            if (!nearCardRun)
                continue;
            el.classList.add('learnkit-hidden-important', 'learnkit-hidden-important');
            el.setAttribute('data-learnkit-hidden', 'true');
        }
    }
}
/* =========================
   Card enhancement
   ========================= */
function toTextField(value) {
    if (Array.isArray(value))
        return value.join('\n').trim();
    return String(value !== null && value !== void 0 ? value : '').trim();
}
function splitLegacyListField(value) {
    const source = String(value !== null && value !== void 0 ? value : '');
    if (!source.trim())
        return [];
    const lines = source.split('\n');
    const entries = [];
    let current = '';
    let inDisplayMath = false;
    const countUnescapedDisplayDelims = (line) => {
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
        const line = String(rawLine !== null && rawLine !== void 0 ? rawLine : '');
        const shouldContinueFromPrev = current.length > 0 && (inDisplayMath || current.trimEnd().endsWith('\\'));
        if (!current) {
            current = line;
        }
        else if (shouldContinueFromPrev) {
            current += `\n${line}`;
        }
        else {
            const trimmedPrev = current.trim();
            if (trimmedPrev)
                entries.push(trimmedPrev);
            current = line;
        }
        const delimCount = countUnescapedDisplayDelims(line);
        if (delimCount % 2 === 1)
            inDisplayMath = !inDisplayMath;
    }
    const trimmedCurrent = current.trim();
    if (trimmedCurrent)
        entries.push(trimmedCurrent);
    return entries;
}
function toListField(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry).trim())
            .filter(Boolean);
    }
    return splitLegacyListField(String(value !== null && value !== void 0 ? value : ''));
}
function sanitizeHexColor(value) {
    const v = String(value !== null && value !== void 0 ? value : '').trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : '';
}
function buildCleanMarkdownClozeSpanStyle(style) {
    const bg = sanitizeHexColor(style === null || style === void 0 ? void 0 : style.bgColor);
    const text = sanitizeHexColor(style === null || style === void 0 ? void 0 : style.textColor);
    if (!bg && !text)
        return '';
    const rules = [];
    if (bg)
        rules.push(`--learnkit-clean-md-cloze-bg: ${bg}`);
    if (text) {
        rules.push(`--learnkit-clean-md-cloze-text: ${text}`);
        rules.push(`--learnkit-cloze-color: ${text}`);
    }
    return ` style="${rules.join('; ')}"`;
}
function resolveCleanMarkdownClozeStyle(plugin) {
    var _a, _b, _c, _d, _e;
    if (!plugin)
        return undefined;
    const cards = (_a = plugin.settings) === null || _a === void 0 ? void 0 : _a.cards;
    const markdownColours = (_e = (_d = (_c = (_b = plugin.settings) === null || _b === void 0 ? void 0 : _b.readingView) === null || _c === void 0 ? void 0 : _c.macroConfigs) === null || _d === void 0 ? void 0 : _d.markdown) === null || _e === void 0 ? void 0 : _e.colours;
    const autoDarkAdjust = (markdownColours === null || markdownColours === void 0 ? void 0 : markdownColours.autoDarkAdjust) !== false;
    const lightBg = sanitizeHexColor(markdownColours === null || markdownColours === void 0 ? void 0 : markdownColours.clozeBgLight) || sanitizeHexColor(cards === null || cards === void 0 ? void 0 : cards.clozeBgColor);
    const lightText = sanitizeHexColor(markdownColours === null || markdownColours === void 0 ? void 0 : markdownColours.clozeTextLight) || sanitizeHexColor(cards === null || cards === void 0 ? void 0 : cards.clozeTextColor);
    const isDark = document.body.classList.contains('theme-dark');
    let bg = isDark ? sanitizeHexColor(markdownColours === null || markdownColours === void 0 ? void 0 : markdownColours.clozeBgDark) : lightBg;
    let text = isDark ? sanitizeHexColor(markdownColours === null || markdownColours === void 0 ? void 0 : markdownColours.clozeTextDark) : lightText;
    if (isDark && autoDarkAdjust) {
        if (!bg && lightBg)
            bg = deriveColourForDark(lightBg);
        if (!text && lightText)
            text = deriveTextForDark(lightText);
    }
    if (!bg && !text)
        return { renderAsTokenText: true };
    return { bgColor: bg, textColor: text, renderAsTokenText: true };
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
function matchClozeTokensBraceAware(source) {
    const results = [];
    const opener = /\{\{c\d+::/g;
    let m;
    while ((m = opener.exec(source)) !== null) {
        const startIdx = m.index;
        const contentStart = startIdx + m[0].length;
        let depth = 0;
        let i = contentStart;
        let found = false;
        while (i < source.length) {
            if (source[i] === '{') {
                depth++;
            }
            else if (source[i] === '}') {
                if (depth > 0) {
                    depth--;
                }
                else {
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
function buildLatexMathRangeChecker(text) {
    const ranges = [];
    LATEX_MATH_BLOCK_RE.lastIndex = 0;
    let m;
    while ((m = LATEX_MATH_BLOCK_RE.exec(text)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
    }
    if (!ranges.length)
        return () => false;
    return (pos) => ranges.some(([start, end]) => pos >= start && pos < end);
}
/**
 * Walk descendant text nodes of `container` and replace LaTeX delimiters
 * with rendered math elements using Obsidian's `renderMath` API.
 *
 * This is more reliable than MathJax.typesetPromise because it uses the
 * same rendering pipeline Obsidian's MarkdownRenderer uses internally.
 */
function renderLatexInContainer(container) {
    var _a, _b, _c;
    // Collect text nodes containing LaTeX markers.
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) {
        if (!(node instanceof Text))
            continue;
        const parent = node.parentElement;
        if (!parent)
            continue;
        // Skip text nodes inside the hidden original content store.
        if (parent.closest('.learnkit-original-content'))
            continue;
        // Skip nodes already rendered by Obsidian/MathJax.
        if (parent.closest('.MathJax, mjx-container, .math'))
            continue;
        const text = (_a = node.nodeValue) !== null && _a !== void 0 ? _a : '';
        if (!/\\\(|\\\[|\$\$|\$/.test(text))
            continue;
        textNodes.push(node);
    }
    if (textNodes.length === 0)
        return;
    let rendered = false;
    for (const textNode of textNodes) {
        const text = (_b = textNode.nodeValue) !== null && _b !== void 0 ? _b : '';
        const parent = textNode.parentNode;
        if (!parent)
            continue;
        // Build a list of math segments with their positions
        const segments = [];
        const collectMatches = (re, display) => {
            var _a, _b;
            re.lastIndex = 0;
            let match;
            while ((match = re.exec(text)) !== null) {
                const full = (_a = match[0]) !== null && _a !== void 0 ? _a : '';
                const source = (_b = match[1]) !== null && _b !== void 0 ? _b : '';
                if (!full || !source.trim())
                    continue;
                segments.push({
                    start: match.index,
                    end: match.index + full.length,
                    source,
                    display,
                });
                if (re.lastIndex === match.index)
                    re.lastIndex += 1;
            }
        };
        // Collect in order of priority (display before inline, $$ before $)
        collectMatches(LATEX_DISPLAY_DOLLAR_RE, true);
        collectMatches(LATEX_DISPLAY_PARENS_RE, true);
        collectMatches(LATEX_INLINE_RE, false);
        collectMatches(LATEX_INLINE_DOLLAR_RE, false);
        if (segments.length === 0)
            continue;
        // Sort by position and remove overlapping matches (first match wins)
        segments.sort((a, b) => {
            if (a.start !== b.start)
                return a.start - b.start;
            // Prefer wider match when two regexes start at the same location.
            return (b.end - b.start) - (a.end - a.start);
        });
        const filtered = [];
        let lastEnd = 0;
        for (const seg of segments) {
            if (seg.start >= lastEnd) {
                filtered.push(seg);
                lastEnd = seg.end;
            }
        }
        if (filtered.length === 0)
            continue;
        // Build a document fragment with text + math interleaved
        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const seg of filtered) {
            // Text before this math segment
            if (seg.start > cursor) {
                frag.appendChild(document.createTextNode(text.slice(cursor, seg.start)));
            }
            try {
                const normalizedSource = String((_c = seg.source) !== null && _c !== void 0 ? _c : "")
                    // Support field style where a trailing backslash escapes the source newline.
                    // Preserve command continuations like \frac{...}\n{...}, but keep visual
                    // line breaks for normal multiline equations.
                    .replace(/\\\r?\n\s*/g, (full, offset, all) => {
                    const nextChar = String(all !== null && all !== void 0 ? all : "").slice(offset + full.length, offset + full.length + 1);
                    return nextChar === "{" ? "" : "\\\\\n";
                });
                const mathEl = renderMath(normalizedSource.trim(), seg.display);
                frag.appendChild(mathEl);
                rendered = true;
            }
            catch (_d) {
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
function renderMarkdownLineWithClozeSpans(value, style) {
    var _a;
    const source = String(value !== null && value !== void 0 ? value : '');
    if (!source)
        return '';
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
            if (style === null || style === void 0 ? void 0 : style.renderAsTokenText) {
                const clozeIdMatch = cm.fullMatch.match(/^\{\{c(\d+)::/i);
                const clozeId = (_a = clozeIdMatch === null || clozeIdMatch === void 0 ? void 0 : clozeIdMatch[1]) !== null && _a !== void 0 ? _a : '1';
                const tokenText = `{{c${clozeId}::${answer}}}`;
                out += `<span class="learnkit-cloze-revealed learnkit-clean-markdown-cloze"${spanStyle}>${escapeHtml(tokenText)}</span>`;
            }
            else if (isInsideMath(cm.index)) {
                out += `\\boxed{${answer}}`;
            }
            else {
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
function renderMarkdownTextWithExplicitBreaks(value, style) {
    const source = String(value !== null && value !== void 0 ? value : '');
    if (!source)
        return '';
    const isInsideMath = buildLatexMathRangeChecker(source);
    let out = '';
    let chunkStart = 0;
    for (let i = 0; i < source.length; i++) {
        if (source[i] !== '\n')
            continue;
        const chunk = source.slice(chunkStart, i);
        out += renderMarkdownLineWithClozeSpans(chunk, style);
        out += isInsideMath(i) ? '\n' : '<br>';
        chunkStart = i + 1;
    }
    out += renderMarkdownLineWithClozeSpans(source.slice(chunkStart), style);
    return out;
}
function renderSanitizedPlainTextWithCloze(value, style) {
    var _a;
    const source = String(value !== null && value !== void 0 ? value : '');
    if (!source)
        return '';
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
            if (style === null || style === void 0 ? void 0 : style.renderAsTokenText) {
                const clozeIdMatch = cm.fullMatch.match(/^\{\{c(\d+)::/i);
                const clozeId = (_a = clozeIdMatch === null || clozeIdMatch === void 0 ? void 0 : clozeIdMatch[1]) !== null && _a !== void 0 ? _a : '1';
                const tokenText = `{{c${clozeId}::${answer}}}`;
                out += `<span class="learnkit-cloze-revealed learnkit-clean-markdown-cloze"${spanStyle}>${escapeHtml(tokenText)}</span>`;
            }
            else {
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
function renderSanitizedPlainTextWithBreaks(value, style) {
    const source = String(value !== null && value !== void 0 ? value : '');
    if (!source)
        return '';
    return renderSanitizedPlainTextWithCloze(source, style).replace(/\r?\n/g, '<br>');
}
function parseListLines(value) {
    var _a, _b, _c;
    const source = String(value !== null && value !== void 0 ? value : '').replace(/\r/g, '');
    if (!source.trim())
        return null;
    const lines = source.split('\n');
    const parsed = [];
    const listLineRe = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
    for (const line of lines) {
        if (!line.trim())
            continue;
        const m = line.match(listLineRe);
        if (!m)
            return null;
        // Normalize indentation depth so one tab or two spaces == one list level.
        const indentRaw = String((_a = m[1]) !== null && _a !== void 0 ? _a : '').replace(/\t/g, '  ');
        const indent = Math.floor(indentRaw.length / 2);
        const marker = String((_b = m[2]) !== null && _b !== void 0 ? _b : '');
        parsed.push({
            indent,
            ordered: /^\d/.test(marker),
            content: String((_c = m[3]) !== null && _c !== void 0 ? _c : ''),
        });
    }
    return parsed.length ? parsed : null;
}
function renderListLinesHtml(lines, renderItem, className) {
    if (!lines.length)
        return '';
    const ordered = lines.every((line) => line.ordered);
    const tag = ordered ? 'ol' : 'ul';
    const items = lines
        .map((line) => `<li class="${className}-item" style="--learnkit-list-indent:${line.indent}">${renderItem(line.content)}</li>`)
        .join('');
    return `<${tag} class="${className}">${items}</${tag}>`;
}
function renderSanitizedPlainFieldValue(value, style) {
    var _a;
    const parsedList = parseListLines(value);
    if (parsedList) {
        return {
            html: renderListLinesHtml(parsedList, (item) => renderSanitizedPlainTextWithCloze(item, style), 'learnkit-markdown-plain-list'),
            isBlock: true,
        };
    }
    // Mixed content support: render contiguous list blocks as lists and
    // markdown heading lines as real heading tags.
    const source = String(value !== null && value !== void 0 ? value : '').replace(/\r/g, '');
    const lines = source.split('\n');
    const listLineRe = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
    const headingLineRe = /^\s*(#{1,6})\s+(.+)$/;
    if (lines.some((line) => listLineRe.test(line) || headingLineRe.test(line))) {
        const parts = [];
        const flushListBlock = (blockLines) => {
            if (!blockLines.length)
                return;
            const parsed = parseListLines(blockLines.join('\n'));
            if (parsed) {
                parts.push(renderListLinesHtml(parsed, (item) => renderSanitizedPlainTextWithCloze(item, style), 'learnkit-markdown-plain-list'));
                return;
            }
            for (let k = 0; k < blockLines.length; k++) {
                parts.push(renderSanitizedPlainTextWithCloze(blockLines[k], style));
                if (k < blockLines.length - 1)
                    parts.push('<br>');
            }
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (listLineRe.test(line)) {
                const block = [line];
                let j = i + 1;
                while (j < lines.length && listLineRe.test(lines[j])) {
                    block.push(lines[j]);
                    j++;
                }
                flushListBlock(block);
                i = j - 1;
                if (i < lines.length - 1 && lines[i + 1].trim() !== '')
                    parts.push('<br>');
                continue;
            }
            if (line === '') {
                parts.push('<br>');
                continue;
            }
            const headingMatch = line.match(headingLineRe);
            if (headingMatch) {
                const level = Math.max(1, Math.min(6, headingMatch[1].length));
                const headingText = String((_a = headingMatch[2]) !== null && _a !== void 0 ? _a : '').trim();
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
function renderFlashcardTextWithListSupport(value) {
    var _a;
    const source = String(value !== null && value !== void 0 ? value : '').replace(/<br\s*\/?\s*>/gi, '\n');
    if (!source)
        return '';
    const parsedList = parseListLines(source);
    if (parsedList) {
        return renderListLinesHtml(parsedList, (item) => renderMarkdownLineWithClozeSpans(item), 'learnkit-flashcard-list');
    }
    // Support mixed markdown blocks (headings + lists + paragraphs) in flashcard
    // reading view so list markers don't render as literal text.
    const lines = source.replace(/\r/g, '').split('\n');
    const parts = [];
    const listLineRe = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
    const flushListBlock = (blockLines) => {
        if (!blockLines.length)
            return;
        const parsed = parseListLines(blockLines.join('\n'));
        if (parsed) {
            parts.push(renderListLinesHtml(parsed, (item) => renderMarkdownLineWithClozeSpans(item), 'learnkit-flashcard-list'));
        }
        else {
            // Defensive fallback: render raw lines with breaks if parsing fails.
            for (let k = 0; k < blockLines.length; k++) {
                parts.push(renderMarkdownLineWithClozeSpans(blockLines[k]));
                if (k < blockLines.length - 1)
                    parts.push('<br>');
            }
        }
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (listLineRe.test(line)) {
            const listBlock = [line];
            let j = i + 1;
            while (j < lines.length && listLineRe.test(lines[j])) {
                listBlock.push(lines[j]);
                j++;
            }
            flushListBlock(listBlock);
            i = j - 1;
            if (i < lines.length - 1 && lines[i + 1].trim() !== '')
                parts.push('<br>');
            continue;
        }
        const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = Math.max(1, Math.min(6, headingMatch[1].length));
            const content = renderMarkdownLineWithClozeSpans(String((_a = headingMatch[2]) !== null && _a !== void 0 ? _a : '').trim());
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
function buildMarkdownModeContent(card, showLabels, clozeStyle) {
    var _a, _b;
    const lines = [];
    const encodeMdSourceAttr = (text) => escapeHtml(encodeURIComponent(String(text !== null && text !== void 0 ? text : '')));
    const shouldRenderMdSource = (text) => {
        const value = String(text !== null && text !== void 0 ? text : '');
        if (!value)
            return false;
        if (/\{\{c\d+::/i.test(value))
            return false;
        return /\\\(|\\\[|\$\$|(^|[^\\])\$(?!\$)/.test(value);
    };
    const questionLabelByType = {
        basic: 'Basic Question',
        reversed: 'Reversed Question',
        'reversed-child': 'Reversed Question',
        mcq: 'Multiple Choice Question',
        oq: 'Ordered Question',
        cloze: 'Cloze Question',
        'cloze-child': 'Cloze Question',
        io: 'Image Occlusion Question',
        'io-child': 'Image Occlusion Question',
    };
    const questionLabel = (_a = questionLabelByType[card.type]) !== null && _a !== void 0 ? _a : 'Question';
    const addPlainField = (label, value) => {
        const v = String(value !== null && value !== void 0 ? value : '').trim();
        if (!v)
            return;
        const renderedField = renderSanitizedPlainFieldValue(v, clozeStyle);
        const sourceAttr = shouldRenderMdSource(v) ? ` data-learnkit-md-source="${encodeMdSourceAttr(v)}"` : '';
        if (renderedField.isBlock) {
            if (showLabels) {
                lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block"><div class="learnkit-markdown-label">${escapeHtml(label)}:</div><div class="learnkit-markdown-plain-block"${sourceAttr}>${renderedField.html}</div></div>`);
            }
            else {
                lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block"><div class="learnkit-markdown-plain-block"${sourceAttr}>${renderedField.html}</div></div>`);
            }
            return;
        }
        if (showLabels) {
            lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-label">${escapeHtml(label)}:</span> <span class="learnkit-markdown-plain-inline"${sourceAttr}>${renderedField.html}</span></div>`);
        }
        else {
            lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-plain-inline"${sourceAttr}>${renderedField.html}</span></div>`);
        }
    };
    const addLine = (label, value) => {
        const v = value.trim();
        if (!v)
            return;
        const rendered = renderMarkdownLineWithClozeSpans(v, clozeStyle);
        const isBlock = /^\s*<(?:ul|ol|table|blockquote|pre)\b/i.test(rendered);
        if (showLabels && isBlock) {
            lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block"><div class="learnkit-markdown-label">${label}:</div>${rendered}</div>`);
            return;
        }
        lines.push(`<div class="learnkit-markdown-line">${showLabels ? `<span class="learnkit-markdown-label">${label}:</span> ` : ''}${rendered}</div>`);
    };
    const getOqSteps = () => {
        const fieldsAny = card.fields;
        const numbered = [];
        for (let i = 1; i <= 20; i++) {
            const step = toTextField(fieldsAny[String(i)]);
            if (!step)
                continue;
            numbered.push(step);
        }
        if (numbered.length)
            return numbered;
        return toListField(card.fields.A);
    };
    const renderList = (items, ordered = false) => {
        if (!items.length)
            return '';
        const tag = ordered ? 'ol' : 'ul';
        const listItems = items.map((item) => `<li>${renderMarkdownLineWithClozeSpans(item, clozeStyle)}</li>`).join('');
        return `<${tag}>${listItems}</${tag}>`;
    };
    const addListSection = (label, items, ordered = false) => {
        if (!items.length)
            return;
        const listHtml = renderList(items, ordered);
        lines.push(`<div class="learnkit-markdown-line learnkit-markdown-line-block">${showLabels ? `<div class="learnkit-markdown-label">${label}:</div>` : ''}${listHtml}</div>`);
    };
    const addGroupsLine = (groups) => {
        if (!groups.length)
            return;
        const safeGroups = groups.map((g) => escapeHtml(String(g))).join(', ');
        if (showLabels) {
            lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-label">Groups:</span> <span class="learnkit-markdown-plain-inline">${safeGroups}</span></div>`);
        }
        else {
            lines.push(`<div class="learnkit-markdown-line"><span class="learnkit-markdown-plain-inline">${safeGroups}</span></div>`);
        }
    };
    if (showLabels) {
        addPlainField('Title', String((_b = card.title) !== null && _b !== void 0 ? _b : ''));
    }
    if (card.type === 'mcq') {
        const question = toTextField(card.fields.MCQ);
        const answers = toListField(card.fields.A);
        const optionsRaw = toListField(card.fields.O);
        if (showLabels) {
            addPlainField(questionLabel, question);
        }
        else {
            addLine(questionLabel, question);
        }
        const seen = new Set();
        const options = [...answers, ...optionsRaw].filter((option) => {
            const key = option.trim().toLowerCase();
            if (!key || seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        if (showLabels) {
            addPlainField('Options', options.join('\n'));
            addPlainField('Answer', answers.join('\n'));
        }
        else {
            addListSection('Options', options, false);
            addListSection('Answer', answers, false);
        }
    }
    else if (card.type === 'oq') {
        if (showLabels) {
            addPlainField(questionLabel, toTextField(card.fields.OQ));
        }
        else {
            addLine(questionLabel, toTextField(card.fields.OQ));
        }
        const steps = getOqSteps();
        if (showLabels) {
            addPlainField('Answer', steps.join('\n'));
        }
        else {
            addListSection('Answer', steps, true);
        }
    }
    else if (card.type === 'cloze') {
        addPlainField(questionLabel, toTextField(card.fields.CQ));
        addPlainField('Extra Information', toTextField(card.fields.I));
    }
    else if (card.type === 'io') {
        addPlainField(questionLabel, toTextField(card.fields.IO));
        addPlainField('Answer', toTextField(card.fields.A));
        addPlainField('Extra Information', toTextField(card.fields.I));
    }
    else {
        const question = card.type === 'reversed' ? toTextField(card.fields.RQ) : toTextField(card.fields.Q);
        addPlainField(questionLabel, question);
        addPlainField('Answer', toTextField(card.fields.A));
        addPlainField('Extra Information', toTextField(card.fields.I));
    }
    const groups = normalizeGroupsForDisplay(card.fields.G);
    addGroupsLine(groups);
    return `<div class="learnkit-markdown-lines">${lines.join('')}</div>`;
}
function normalizeGroupsForDisplay(groupsField) {
    if (!groupsField)
        return [];
    const base = Array.isArray(groupsField) ? groupsField : [String(groupsField)];
    const splitGroups = base.flatMap((group) => String(group)
        .split(/[\n,]/g)
        .map((part) => part.trim())
        .filter(Boolean));
    return splitGroups;
}
function buildFlashcardCloze(text, mode) {
    return buildReadingFlashcardCloze(text, mode);
}
function buildFlashcardContentHTML(card, options) {
    const idSeed = Math.random().toString(36).slice(2, 8);
    const encodeMdSourceAttr = (text) => escapeHtml(encodeURIComponent(String(text !== null && text !== void 0 ? text : '')));
    const mdSourceAttr = (text) => {
        const value = String(text !== null && text !== void 0 ? text : '');
        if (!value)
            return '';
        if (!/\\\(|\\\[|\$\$|(^|[^\\])\$(?!\$)/.test(value))
            return '';
        return ` data-learnkit-md-source="${encodeMdSourceAttr(value)}"`;
    };
    let front = '';
    let back = '';
    const allowSpeakerForCardType = card.type === 'basic' || card.type === 'reversed' || card.type === 'cloze' || card.type === 'mcq';
    const getOqSteps = () => {
        const fieldsAny = card.fields;
        const numbered = [];
        for (let i = 1; i <= 20; i++) {
            const step = toTextField(fieldsAny[String(i)]);
            if (!step)
                continue;
            numbered.push(step);
        }
        if (numbered.length)
            return numbered;
        return toListField(card.fields.A);
    };
    const actionsFor = (side) => {
        const speaker = options.includeSpeakerButton && allowSpeakerForCardType
            ? `<button class="learnkit-flashcard-action-btn learnkit-flashcard-speak-btn" type="button" data-learnkit-tts-side="${side}" aria-label="Read aloud" data-tooltip-position="top"></button>`
            : '';
        const edit = options.includeEditButton
            ? `<button class="learnkit-flashcard-action-btn learnkit-card-edit-btn" type="button" aria-label="Edit card" data-tooltip-position="top"></button>`
            : '';
        if (!edit && !speaker)
            return '';
        return `<div class="learnkit-flashcard-actions">${edit}${speaker}</div>`;
    };
    if (card.type === 'cloze') {
        const cq = toTextField(card.fields.CQ);
        front = buildFlashcardCloze(cq, 'front');
        back = buildFlashcardCloze(cq, 'back');
    }
    else if (card.type === 'io') {
        front = `<div class="learnkit-flashcard-io" id="learnkit-io-question-${idSeed}"></div>`;
        back = `<div class="learnkit-flashcard-io" id="learnkit-io-answer-${idSeed}"></div>`;
    }
    else if (card.type === 'mcq') {
        const q = toTextField(card.fields.MCQ);
        const answers = toListField(card.fields.A)
            .map((s) => String(s).trim())
            .filter(Boolean);
        const wrongOptions = toListField(card.fields.O)
            .map((s) => s.trim())
            .filter(Boolean);
        // Build a lowercase set of correct answers for fast lookup
        const answersLower = new Set(answers.map((a) => a.toLowerCase()));
        const seen = new Set();
        const allOptions = [...answers, ...wrongOptions]
            .map((s) => String(s).trim())
            .filter(Boolean)
            .filter((opt) => {
            const key = opt.toLowerCase();
            if (seen.has(key))
                return false;
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
        // Back: same question + same randomised list with correct answer(s) bolded.
        // Wrap the entire <li> content (including any LaTeX) in <strong> for correct answers.
        const backOptionsListHtml = allOptions.length
            ? `<ul class="learnkit-flashcard-options learnkit-flashcard-options-list">${allOptions.map((opt) => {
                const rendered = renderMarkdownLineWithClozeSpans(String(opt));
                const isCorrect = answersLower.has(opt.toLowerCase());
                return isCorrect
                    ? `<li><strong><span${mdSourceAttr(opt)}>${rendered}</span></strong></li>`
                    : `<li><span${mdSourceAttr(opt)}>${rendered}</span></li>`;
            }).join('')}</ul>`
            : '';
        front = `${questionHtml}${optionsListHtml}`;
        back = `${questionHtml}${backOptionsListHtml}`;
    }
    else if (card.type === 'oq') {
        const q = toTextField(card.fields.OQ);
        const steps = getOqSteps();
        // Front: question + shuffled unordered list of steps (no order hints)
        const shuffledSteps = [...steps];
        for (let i = shuffledSteps.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledSteps[i], shuffledSteps[j]] = [shuffledSteps[j], shuffledSteps[i]];
        }
        const oqQuestionHtml = `<div class="learnkit-flashcard-question-text"${mdSourceAttr(q)}>${renderMarkdownTextWithExplicitBreaks(q)}</div>`;
        front = `${oqQuestionHtml}${shuffledSteps.length ? `<ul class="learnkit-flashcard-options learnkit-flashcard-options-list">${shuffledSteps.map((s) => `<li><span${mdSourceAttr(s)}>${renderMarkdownLineWithClozeSpans(s)}</span></li>`).join('')}</ul>` : ''}`;
        back = `${oqQuestionHtml}<ol class="learnkit-flashcard-sequence-list">${steps.map((s) => `<li><span${mdSourceAttr(s)}>${renderMarkdownLineWithClozeSpans(s)}</span></li>`).join('')}</ol>`;
    }
    else {
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
function buildGroupsSectionHTML(groups) {
    if (!groups.length)
        return '';
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
function applyCustomHookClasses(el) {
    if (!el.classList.contains('learnkit-macro-custom'))
        return;
    el.classList.add('learnkit-custom-root', 'learnkit-custom-root');
    const header = el.querySelector('.learnkit-card-header');
    const title = el.querySelector('.learnkit-card-title');
    const body = el.querySelector('.learnkit-card-content');
    const groups = el.querySelector('.learnkit-groups-list');
    header === null || header === void 0 ? void 0 : header.classList.add('learnkit-custom-header', 'learnkit-custom-header');
    title === null || title === void 0 ? void 0 : title.classList.add('learnkit-custom-title', 'learnkit-custom-title');
    body === null || body === void 0 ? void 0 : body.classList.add('learnkit-custom-body', 'learnkit-custom-body');
    groups === null || groups === void 0 ? void 0 : groups.classList.add('learnkit-custom-groups', 'learnkit-custom-groups');
    el.querySelectorAll('.learnkit-card-section').forEach((section) => {
        section.classList.add('learnkit-custom-section', 'learnkit-custom-section');
        if (section.classList.contains('learnkit-section-question'))
            section.classList.add('learnkit-custom-section-question', 'learnkit-custom-section-question');
        if (section.classList.contains('learnkit-section-options'))
            section.classList.add('learnkit-custom-section-options', 'learnkit-custom-section-options');
        if (section.classList.contains('learnkit-section-answer'))
            section.classList.add('learnkit-custom-section-answer', 'learnkit-custom-section-answer');
        if (section.classList.contains('learnkit-section-info'))
            section.classList.add('learnkit-custom-section-info', 'learnkit-custom-section-info');
        if (section.classList.contains('learnkit-section-groups'))
            section.classList.add('learnkit-custom-section-groups', 'learnkit-custom-section-groups');
    });
    el.querySelectorAll('.learnkit-section-label').forEach((label) => {
        label.classList.add('learnkit-custom-label', 'learnkit-custom-label');
    });
    el.querySelectorAll('.learnkit-section-content').forEach((content) => {
        content.classList.add('learnkit-custom-content', 'learnkit-custom-content');
    });
}
function setupGuidebookCarousel(el) {
    if (!el.classList.contains('learnkit-macro-guidebook'))
        return;
    const content = el.querySelector('.learnkit-card-content');
    if (!content)
        return;
    const slides = Array.from(content.querySelectorAll('.learnkit-card-section'));
    if (slides.length <= 1)
        return;
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
    const scrollToIndex = (idx) => {
        const slide = slides[Math.max(0, Math.min(slides.length - 1, idx))];
        if (!slide)
            return;
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
function setupFlashcardFlip(el) {
    if (!el.classList.contains('learnkit-macro-flashcards'))
        return;
    const flipEl = el;
    const content = el.querySelector('.learnkit-card-content');
    if (!content)
        return;
    const question = content.querySelector('.learnkit-flashcard-question');
    const answer = content.querySelector('.learnkit-flashcard-answer');
    if (!question || !answer)
        return;
    // Abort any previous flip handler so stale listeners referencing
    // detached Q/A elements don't block the current handler.
    const prev = flipEl.__sproutFlipAC;
    if (prev)
        prev.abort();
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
    el.addEventListener('click', (ev) => {
        const target = ev.target instanceof Element ? ev.target : null;
        if (target === null || target === void 0 ? void 0 : target.closest('.learnkit-card-edit-btn, .learnkit-flashcard-speak-btn'))
            return;
        if (el.classList.contains('learnkit-flashcard-animating'))
            return;
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
function enhanceCardElement(el, card, originalContentOverride, cardRawText, skipSiblingHiding = false) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
    const originalContent = originalContentOverride !== null && originalContentOverride !== void 0 ? originalContentOverride : el.innerHTML;
    el.replaceChildren();
    // Determine reading style from plugin instance (Obsidian context)
    let macroPreset = 'flashcards';
    let visibleFields;
    let displayLabels = true;
    let ttsEnabled = false;
    let showFlashcardAudioButton = true;
    let showFlashcardEditButton = true;
    let audioSettings = null;
    let markdownClozeStyle;
    try {
        const activePlugin = getSproutPlugin();
        const stylesEnabled = !!((_b = (_a = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.enableReadingStyles);
        if (!stylesEnabled) {
            replaceChildrenWithHTML(el, originalContent);
            return;
        }
        macroPreset = normaliseMacroPreset((_e = (_d = (_c = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _c === void 0 ? void 0 : _c.readingView) === null || _d === void 0 ? void 0 : _d.activeMacro) !== null && _e !== void 0 ? _e : (_g = (_f = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _f === void 0 ? void 0 : _f.readingView) === null || _g === void 0 ? void 0 : _g.preset);
        const macroConfig = macroPreset === 'classic'
            ? (_k = (_j = (_h = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _h === void 0 ? void 0 : _h.readingView) === null || _j === void 0 ? void 0 : _j.macroConfigs) === null || _k === void 0 ? void 0 : _k.classic
            : macroPreset === 'guidebook'
                ? (_o = (_m = (_l = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _l === void 0 ? void 0 : _l.readingView) === null || _m === void 0 ? void 0 : _m.macroConfigs) === null || _o === void 0 ? void 0 : _o.guidebook
                : macroPreset === 'markdown'
                    ? (_r = (_q = (_p = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _p === void 0 ? void 0 : _p.readingView) === null || _q === void 0 ? void 0 : _q.macroConfigs) === null || _r === void 0 ? void 0 : _r.markdown
                    : macroPreset === 'custom'
                        ? (_u = (_t = (_s = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _s === void 0 ? void 0 : _s.readingView) === null || _t === void 0 ? void 0 : _t.macroConfigs) === null || _u === void 0 ? void 0 : _u.custom
                        : (_x = (_w = (_v = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _v === void 0 ? void 0 : _v.readingView) === null || _w === void 0 ? void 0 : _w.macroConfigs) === null || _x === void 0 ? void 0 : _x.flashcards;
        visibleFields = (_y = macroConfig === null || macroConfig === void 0 ? void 0 : macroConfig.fields) !== null && _y !== void 0 ? _y : (_0 = (_z = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _z === void 0 ? void 0 : _z.readingView) === null || _0 === void 0 ? void 0 : _0.visibleFields;
        displayLabels = (_2 = (_1 = macroConfig === null || macroConfig === void 0 ? void 0 : macroConfig.fields) === null || _1 === void 0 ? void 0 : _1.labels) !== null && _2 !== void 0 ? _2 : ((_4 = (_3 = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _3 === void 0 ? void 0 : _3.readingView) === null || _4 === void 0 ? void 0 : _4.displayLabels) !== false;
        ttsEnabled = !!((_6 = (_5 = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _5 === void 0 ? void 0 : _5.audio) === null || _6 === void 0 ? void 0 : _6.enabled);
        showFlashcardAudioButton = ((_7 = macroConfig === null || macroConfig === void 0 ? void 0 : macroConfig.fields) === null || _7 === void 0 ? void 0 : _7.displayAudioButton) !== false;
        showFlashcardEditButton = ((_8 = macroConfig === null || macroConfig === void 0 ? void 0 : macroConfig.fields) === null || _8 === void 0 ? void 0 : _8.displayEditButton) !== false;
        audioSettings = (_10 = (_9 = activePlugin === null || activePlugin === void 0 ? void 0 : activePlugin.settings) === null || _9 === void 0 ? void 0 : _9.audio) !== null && _10 !== void 0 ? _10 : null;
        markdownClozeStyle = resolveCleanMarkdownClozeStyle(activePlugin);
    }
    catch (e) {
        log.swallow("read prettify plugin setting", e);
    }
    el.classList.add('learnkit-pretty-card', 'learnkit-pretty-card', 'learnkit-reading-card', 'learnkit-reading-card', 'learnkit-reading-view-wrapper', 'learnkit-reading-view-wrapper', 'accent', `learnkit-macro-${macroPreset}`);
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
    el.toggleAttribute('data-hide-title', isFlashcardsMacro || (visibleFields === null || visibleFields === void 0 ? void 0 : visibleFields.title) === false);
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
    if (macroPreset === 'guidebook')
        setupGuidebookCarousel(el);
    if (macroPreset === 'flashcards')
        setupFlashcardFlip(el);
    // Hook up internal links
    const internalLinks = el.querySelectorAll('a.internal-link');
    internalLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            var _a, _b, _c, _d, _e;
            e.preventDefault();
            const href = link.getAttribute('data-href');
            if (href) {
                // Use Obsidian's app to open the link
                const app = window.app;
                if ((_a = app === null || app === void 0 ? void 0 : app.workspace) === null || _a === void 0 ? void 0 : _a.openLinkText) {
                    const sourcePath = (_e = (_d = (_c = (_b = app.workspace) === null || _b === void 0 ? void 0 : _b.getActiveFile) === null || _c === void 0 ? void 0 : _c.call(_b)) === null || _d === void 0 ? void 0 : _d.path) !== null && _e !== void 0 ? _e : '';
                    void app.workspace.openLinkText(href, sourcePath, true);
                }
            }
        });
    });
    // Hook up edit button in card header
    const editBtns = Array.from(el.querySelectorAll(".learnkit-card-edit-btn"));
    for (const editBtn of editBtns) {
        setIcon(editBtn, "pencil");
        editBtn.tabIndex = 0;
        editBtn.addEventListener("click", (e) => {
            var _a, _b, _c;
            e.preventDefault();
            e.stopPropagation();
            const plugin = getSproutPlugin();
            if (!plugin) {
                new Notice("Sprout plugin not found.");
                return;
            }
            const cardsMap = (_c = (_b = (_a = plugin.store) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.cards) !== null && _c !== void 0 ? _c : {};
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
                ImageOcclusionCreatorModal.openForParent(plugin, String(targetCard.id), {
                    onClose: () => {
                        if (typeof plugin.refreshAllViews === "function") {
                            plugin.refreshAllViews();
                        }
                    },
                });
                return;
            }
            void openBulkEditModalForCards(plugin, [targetCard], async (updatedCards) => {
                if (!updatedCards.length)
                    return;
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
                    await syncOneFile(plugin, file, { pruneGlobalOrphans: false });
                    if (typeof plugin.refreshAllViews === "function") {
                        plugin.refreshAllViews();
                    }
                    // Rebuild reading cards from the updated markdown source so both
                    // front/back faces and hidden spillover siblings stay in sync.
                    const refreshLeaves = plugin.refreshReadingViewMarkdownLeaves;
                    if (typeof refreshLeaves === "function") {
                        void Promise.resolve(refreshLeaves.call(plugin));
                    }
                    else {
                        setTimeout(() => {
                            document
                                .querySelectorAll(".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section")
                                .forEach((node) => {
                                node.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
                                    bubbles: true,
                                    detail: { sourceContent: updatedSource, sourcePath: file.path },
                                }));
                            });
                        }, 50);
                    }
                }
                catch (err) {
                    log.error("Failed to update card from reading view", err);
                    new Notice(`Failed to update card: ${err instanceof Error ? err.message : String(err)}`);
                }
            });
        });
        editBtn.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ")
                return;
            e.preventDefault();
            e.stopPropagation();
            editBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }
    const speakBtns = Array.from(el.querySelectorAll(".learnkit-flashcard-speak-btn"));
    for (const speakBtn of speakBtns) {
        setIcon(speakBtn, "volume-2");
        speakBtn.tabIndex = 0;
        speakBtn.addEventListener("click", (e) => {
            var _a, _b, _c;
            e.preventDefault();
            e.stopPropagation();
            if (!ttsEnabled || !(audioSettings === null || audioSettings === void 0 ? void 0 : audioSettings.enabled))
                return;
            const tts = getTtsService();
            if (!tts.isSupported)
                return;
            if (tts.isSpeaking) {
                tts.stop();
                return;
            }
            const side = (e.currentTarget.getAttribute("data-learnkit-tts-side") === "back") ? "back" : "front";
            const panelSelector = side === "back" ? ".learnkit-flashcard-answer" : ".learnkit-flashcard-question";
            const cardContent = el.querySelector('.learnkit-card-content');
            const panel = (cardContent !== null && cardContent !== void 0 ? cardContent : el).querySelector(panelSelector);
            if (!panel)
                return;
            const isClozeLike = el.dataset.sproutType === "cloze" || el.dataset.sproutType === "cloze-child";
            const rawQuestion = card.type === "reversed"
                ? toTextField(card.fields.RQ)
                : toTextField(card.fields.Q);
            const rawAnswer = toTextField(card.fields.A);
            const rawCloze = toTextField(card.fields.CQ);
            const panelText = (panel.innerText || panel.textContent || "").replace(/\s+/g, " ").trim();
            const imageAlt = Array.from(panel.querySelectorAll("img[alt]"))
                .filter((img) => !img.classList.contains("learnkit-inline-flag") && !img.hasAttribute("data-learnkit-flag-code"))
                .map((img) => (img.alt || "").trim())
                .filter(Boolean)
                .join(" ");
            const domFallback = [panelText, imageAlt].filter(Boolean).join(" ").trim();
            const readingCacheId = card.anchorId ? `${card.anchorId}-${side === "back" ? "answer" : "question"}` : undefined;
            if (isClozeLike) {
                const clozeSource = rawCloze || String((_a = card.fields.CQ) !== null && _a !== void 0 ? _a : "");
                if (!clozeSource && !domFallback)
                    return;
                if (clozeSource) {
                    tts.speakClozeCard(clozeSource, side === "back", null, {
                        ...DEFAULT_SETTINGS.audio,
                        ...(audioSettings !== null && audioSettings !== void 0 ? audioSettings : {}),
                        scriptLanguages: {
                            ...DEFAULT_SETTINGS.audio.scriptLanguages,
                            ...((_b = audioSettings === null || audioSettings === void 0 ? void 0 : audioSettings.scriptLanguages) !== null && _b !== void 0 ? _b : {}),
                        },
                    }, readingCacheId);
                    return;
                }
            }
            const fieldText = side === "back" ? rawAnswer : rawQuestion;
            const text = (fieldText || domFallback || "").trim();
            if (!text)
                return;
            const mergedAudio = {
                ...DEFAULT_SETTINGS.audio,
                ...(audioSettings !== null && audioSettings !== void 0 ? audioSettings : {}),
                scriptLanguages: {
                    ...DEFAULT_SETTINGS.audio.scriptLanguages,
                    ...((_c = audioSettings === null || audioSettings === void 0 ? void 0 : audioSettings.scriptLanguages) !== null && _c !== void 0 ? _c : {}),
                },
            };
            tts.speakBasicCard(text, mergedAudio, readingCacheId);
        });
        speakBtn.addEventListener("keydown", (ev) => {
            var _a;
            if (ev.key !== "Enter" && ev.key !== " ")
                return;
            ev.preventDefault();
            (_a = ev.currentTarget) === null || _a === void 0 ? void 0 : _a.click();
        });
    }
    // Hook up toggles inside this card
    const toggles = el.querySelectorAll('.learnkit-toggle-btn');
    toggles.forEach(btn => {
        const target = btn.getAttribute('data-target');
        if (!target)
            return;
        const content = el.querySelector(target);
        if (!content)
            return;
        const section = btn.closest('.learnkit-card-section');
        const isAnswer = !!(section === null || section === void 0 ? void 0 : section.classList.contains('learnkit-section-answer'));
        const isGroups = !!(section === null || section === void 0 ? void 0 : section.classList.contains('learnkit-section-groups'));
        const isInfo = !!(section === null || section === void 0 ? void 0 : section.classList.contains('learnkit-section-info'));
        const defaultExpanded = macroPreset === 'guidebook' || macroPreset === 'markdown'
            ? true
            : macroPreset === 'classic'
                ? !(isAnswer || isGroups || isInfo)
                : false;
        content.classList.add('learnkit-collapsible', 'learnkit-collapsible');
        content.classList.toggle('collapsed', !defaultExpanded);
        content.classList.toggle('expanded', defaultExpanded);
        btn.setAttribute('aria-expanded', defaultExpanded ? 'true' : 'false');
        const chevron = btn.querySelector('.learnkit-toggle-chevron');
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
                if (chevron)
                    chevron.classList.add('learnkit-reading-chevron-collapsed', 'learnkit-reading-chevron-collapsed');
            }
            else {
                content.classList.remove('collapsed');
                content.classList.add('expanded');
                btn.setAttribute('aria-expanded', 'true');
                if (chevron)
                    chevron.classList.remove('learnkit-reading-chevron-collapsed', 'learnkit-reading-chevron-collapsed');
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
export function renderReadingViewPreviewCard(el, card) {
    el.classList.add("el-p");
    el.setAttribute("data-learnkit-processed", "true");
    enhanceCardElement(el, card, "", undefined, true);
    const editButtons = el.querySelectorAll(".learnkit-card-edit-btn");
    editButtons.forEach((button) => {
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("tabindex", "-1");
    });
    const audioButtons = el.querySelectorAll(".learnkit-flashcard-speak-btn");
    audioButtons.forEach((button) => {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
        button.tabIndex = -1;
    });
}
/* =========================
   Markdown rendering in card elements
   ========================= */
async function renderMdInElements(el, card) {
    var _a, _b, _c, _d;
    const app = window.app;
    if (!app)
        return;
    // Get the plugin instance to use as component parent
    const plugin = getSproutPlugin();
    if (!plugin)
        return;
    // Source path for resolving images/links
    const sourcePath = (_d = (_c = (_b = (_a = app.workspace) === null || _a === void 0 ? void 0 : _a.getActiveFile) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.path) !== null && _d !== void 0 ? _d : '';
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
                    await MarkdownRenderer.render(app, qText, qEl, sourcePath, component);
                    resolveUnloadedEmbeds(qEl, app, sourcePath);
                }
                catch (_e) {
                    qEl.textContent = qText;
                }
            }
            if (aEl && aText) {
                try {
                    await MarkdownRenderer.render(app, aText, aEl, sourcePath, component);
                    resolveUnloadedEmbeds(aEl, app, sourcePath);
                }
                catch (_f) {
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
                    await MarkdownRenderer.render(app, iText, iEl, sourcePath, component);
                    // Resolve any unloaded internal-embed spans that MarkdownRenderer
                    // created but didn't fully load (common for images in detached components)
                    resolveUnloadedEmbeds(iEl, app, sourcePath);
                }
                catch (_g) {
                    iEl.textContent = iText;
                }
            }
        }
        // Render any pre-marked markdown containers used by reading-view
        // flashcard and markdown macros (including inline math delimiters).
        const mdTargets = Array.from(el.querySelectorAll('[data-learnkit-md-source]'));
        for (const target of mdTargets) {
            if (target.closest('[id^="sprout-q-"]') || target.closest('[id^="sprout-a-"]') || target.closest('[id^="sprout-i-"]')) {
                continue;
            }
            const encodedSource = target.getAttribute('data-learnkit-md-source');
            if (!encodedSource)
                continue;
            let markdownSource = '';
            try {
                markdownSource = decodeURIComponent(encodedSource);
            }
            catch (_h) {
                markdownSource = encodedSource;
            }
            if (!markdownSource)
                continue;
            // Snapshot fallback nodes before clearing; MarkdownRenderer
            // *appends* children so leaving old content would double the output.
            const fallbackNodes = Array.from(target.childNodes).map((node) => node.cloneNode(true));
            try {
                target.replaceChildren();
                await MarkdownRenderer.render(app, markdownSource, target, sourcePath, component);
                resolveUnloadedEmbeds(target, app, sourcePath);
            }
            catch (_j) {
                // Restore pre-rendered fallback content on markdown render failures.
                target.replaceChildren(...fallbackNodes);
            }
        }
    }
    finally {
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
function resolveUnloadedEmbeds(container, app, sourcePath) {
    var _a;
    const embeds = container.querySelectorAll('span.internal-embed:not(.is-loaded)');
    for (const embed of Array.from(embeds)) {
        const embedSrc = embed.getAttribute('src') || embed.getAttribute('alt') || '';
        if (!embedSrc)
            continue;
        // Check if this looks like an image path
        const ext = ((_a = embedSrc.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || '';
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif', 'tiff'];
        if (!imageExts.includes(ext))
            continue;
        try {
            const imageFile = resolveImageFile(app, sourcePath, embedSrc);
            if (imageFile) {
                const img = document.createElement('img');
                img.src = app.vault.getResourcePath(imageFile);
                img.alt = embedSrc.split('/').pop() || embedSrc;
                img.className = 'learnkit-reading-embed-img';
                embed.replaceChildren(img);
                embed.classList.add('media-embed', 'image-embed', 'is-loaded');
            }
            else {
                // Image not found — show a comment-like placeholder
                embed.textContent = `⚠️ Image not found: ${embedSrc}`;
                embed.classList.add('learnkit-missing-image', 'learnkit-missing-image');
            }
        }
        catch (err) {
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
function resolveEmbeddedImages(el, app, sourcePath) {
    const imgs = el.querySelectorAll('img[data-embed-path]');
    for (const img of Array.from(imgs)) {
        const embedPath = img.getAttribute('data-embed-path');
        if (!embedPath)
            continue;
        try {
            const imageFile = resolveImageFile(app, sourcePath, embedPath);
            if (imageFile) {
                img.src = app.vault.getResourcePath(imageFile);
                img.removeAttribute('data-embed-path');
            }
            else {
                // Fallback: show the path as alt text
                img.alt = embedPath;
                img.title = `Image not found: ${embedPath}`;
            }
        }
        catch (err) {
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
function renderIoInReadingCard(el, card, plugin, sourcePath) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const app = plugin.app;
    const anchorId = card.anchorId;
    // Resolve IO data from store
    const ioMap = (_c = (_b = (_a = plugin.store) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.io) !== null && _c !== void 0 ? _c : {};
    let ioDef = ioMap[anchorId];
    // Fallback: if IO map entry is missing, rebuild from the card record's occlusions
    if (!ioDef) {
        const cardRec = ((_f = (_e = (_d = plugin.store) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.cards) !== null && _f !== void 0 ? _f : {})[anchorId];
        if (cardRec) {
            const rawImageRefVal = cardRec.imageRef;
            let rawImageRef = '';
            if (typeof rawImageRefVal === 'string') {
                rawImageRef = rawImageRefVal.trim();
            }
            else if (typeof rawImageRefVal === 'number' || typeof rawImageRefVal === 'boolean') {
                rawImageRef = String(rawImageRefVal).trim();
            }
            const rawOcclusions = cardRec.occlusions;
            if (rawImageRef && Array.isArray(rawOcclusions) && rawOcclusions.length > 0) {
                const rects = [];
                for (const r of rawOcclusions) {
                    if (!r || typeof r !== 'object')
                        continue;
                    const rect = r;
                    let rectId = '';
                    const rectIdRaw = (_g = rect.rectId) !== null && _g !== void 0 ? _g : rect.id;
                    if (typeof rectIdRaw === 'string') {
                        rectId = rectIdRaw;
                    }
                    else if (typeof rectIdRaw === 'number' || typeof rectIdRaw === 'boolean') {
                        rectId = String(rectIdRaw);
                    }
                    let groupKey = '1';
                    const groupKeyRaw = rect.groupKey;
                    if (typeof groupKeyRaw === 'string') {
                        groupKey = groupKeyRaw;
                    }
                    else if (typeof groupKeyRaw === 'number' || typeof groupKeyRaw === 'boolean') {
                        groupKey = String(groupKeyRaw);
                    }
                    rects.push({
                        rectId,
                        x: Number((_h = rect.x) !== null && _h !== void 0 ? _h : 0),
                        y: Number((_j = rect.y) !== null && _j !== void 0 ? _j : 0),
                        w: Number((_l = (_k = rect.w) !== null && _k !== void 0 ? _k : rect.width) !== null && _l !== void 0 ? _l : 0),
                        h: Number((_o = (_m = rect.h) !== null && _m !== void 0 ? _m : rect.height) !== null && _o !== void 0 ? _o : 0),
                        groupKey,
                        shape: (rect.shape === 'circle' ? 'circle' : 'rect'),
                    });
                }
                if (rects.length > 0) {
                    let maskMode = '';
                    const maskModeRaw = cardRec.maskMode;
                    if (typeof maskModeRaw === 'string') {
                        maskMode = maskModeRaw;
                    }
                    else if (typeof maskModeRaw === 'number' || typeof maskModeRaw === 'boolean') {
                        maskMode = String(maskModeRaw);
                    }
                    ioDef = { imageRef: rawImageRef, rects, maskMode };
                    // Also populate the IO map for future lookups
                    if ((_p = plugin.store) === null || _p === void 0 ? void 0 : _p.data) {
                        if (!plugin.store.data.io) {
                            plugin.store.data.io = {};
                        }
                        plugin.store.data.io[anchorId] = ioDef;
                    }
                }
            }
        }
    }
    if (!ioDef)
        return;
    const imageRef = String(ioDef.imageRef || '').trim();
    if (!imageRef)
        return;
    // Resolve image file to get a vault resource URL
    const imageFile = resolveImageFile(app, sourcePath, imageRef);
    if (!imageFile)
        return;
    const imageSrc = app.vault.getResourcePath(imageFile);
    const occlusions = Array.isArray(ioDef.rects) ? ioDef.rects : [];
    // ---- Question container: image with mask overlays ----
    const questionEl = queryFirst(el, '[id^="sprout-io-question-"], [id^="learnkit-io-question-"]');
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
                if (w === 0 && h === 0)
                    return;
                overlay.style.left = `${img.offsetLeft}px`;
                overlay.style.top = `${img.offsetTop}px`;
                overlay.style.width = `${w}px`;
                overlay.style.height = `${h}px`;
            };
            const scheduleSync = () => requestAnimationFrame(syncOverlay);
            if (img.complete && img.naturalWidth > 0) {
                scheduleSync();
            }
            else {
                img.addEventListener('load', scheduleSync, { once: true });
            }
            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(syncOverlay).observe(img);
            }
            for (const rect of occlusions) {
                const x = Number.isFinite(rect.x) ? Number(rect.x) : 0;
                const y = Number.isFinite(rect.y) ? Number(rect.y) : 0;
                const w = Number.isFinite(rect.w) ? Number(rect.w) : 0;
                const h = Number.isFinite(rect.h) ? Number(rect.h) : 0;
                const mask = document.createElement('div');
                mask.className = 'learnkit-io-reading-mask learnkit-io-reading-mask-filled';
                mask.classList.add(rect.shape === 'circle' ? 'learnkit-io-reading-mask-circle' : 'learnkit-io-reading-mask-rect');
                setCssProps(mask, 'left', `${Math.max(0, Math.min(1, x)) * 100}%`);
                setCssProps(mask, 'top', `${Math.max(0, Math.min(1, y)) * 100}%`);
                setCssProps(mask, 'width', `${Math.max(0, Math.min(1, w)) * 100}%`);
                setCssProps(mask, 'height', `${Math.max(0, Math.min(1, h)) * 100}%`);
                const hint = document.createElement('span');
                hint.textContent = '?';
                hint.className = 'learnkit-io-reading-mask-hint';
                mask.appendChild(hint);
                overlay.appendChild(mask);
            }
            container.appendChild(overlay);
        }
        questionEl.appendChild(container);
    }
    // ---- Answer container: clean image (no masks) ----
    const answerEl = queryFirst(el, '[id^="sprout-io-answer-"], [id^="learnkit-io-answer-"]');
    if (answerEl) {
        answerEl.replaceChildren();
        const container = document.createElement('div');
        container.className = 'learnkit-io-reading-container';
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = card.title || 'Image Occlusion — Answer';
        img.className = 'learnkit-io-reading-img';
        container.appendChild(img);
        answerEl.appendChild(container);
    }
}
window.sproutApplyMasonryGrid = window.sproutApplyMasonryGrid || (() => {
    debugLog('[LearnKit] sproutApplyMasonryGrid placeholder invoked');
    void processCardElements(document.documentElement, undefined, '');
});
