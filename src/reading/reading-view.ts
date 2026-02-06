/**
 * @file src/reading/reading-view.ts
 * @summary Stateful, side-effectful code for Sprout's reading-view pretty-card rendering and masonry layout. Owns all mutable module-level state (sproutPluginRef, masonry timers, MutationObserver) and the Obsidian registerMarkdownPostProcessor hook that transforms card blocks into styled, interactive card elements in the editor.
 *
 * @exports
 *  - registerReadingViewPrettyCards — registers the markdown post-processor that renders pretty cards in reading view
 */

import type { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { Component, MarkdownRenderer, Notice, setIcon, TFile } from "obsidian";
import { log } from "../core/logger";
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import { buildCardBlockMarkdown, findCardBlockRangeById } from "../reviewer/markdown-block";
import type { CardRecord } from "../core/store";
import type SproutPlugin from "../main";

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
  checkForNonCardContent,
  parseMarkdownToElements,
  createMarkdownElement,
  type SproutCard,
} from "./reading-helpers";

/* -----------------------
   Module-level mutable state
   ----------------------- */

let sproutPluginRef: Plugin | null = null;

/** Shape of a Sprout plugin instance for appearance-setting lookups. */
type SproutPluginLike = Plugin & {
  store?: { data?: { cards?: Record<string, CardRecord> } };
  settings?: { appearance?: { prettifyCards?: string } };
  syncBank?(): Promise<void>;
  refreshAllViews?(): void;
};

function getSproutPlugin(): SproutPluginLike | null {
  if (sproutPluginRef) return sproutPluginRef as SproutPluginLike;
  try {
    const plugin = Object.values(window?.app?.plugins?.plugins ?? {}).find(
      (p): p is SproutPluginLike => {
        const sp = p as SproutPluginLike;
        return !!sp?.store && !!sp?.settings?.appearance;
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
   Public registration
   ========================= */

export function registerReadingViewPrettyCards(plugin: Plugin) {
  debugLog("[Sprout] Registering reading view prettifier");

  sproutPluginRef = plugin;

  injectStylesOnce();

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
          const sourcePath = ctx.sourcePath;
          if (sourcePath && plugin.app.vault) {
            const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
            if (file && 'extension' in file && file.extension === 'md') {
              // It's a TFile
              const content = await plugin.app.vault.read(file as TFile);
              sourceContent = content;
            }
          }
        } catch (e) {
          debugLog("[Sprout] Could not read source file:", e);
        }

        // Parse and enhance any new .el-p nodes in this root
        await processCardElements(rootEl, ctx, sourceContent);

        // Masonry layout pass shortly after
        scheduleMasonryLayout();
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
    // Get current prettify style from plugin instance
    let prettifyStyle: string = "accent";
    try {
      const activePlugin = getSproutPlugin();
      if (activePlugin?.settings?.appearance?.prettifyCards) {
        prettifyStyle = activePlugin.settings.appearance.prettifyCards;
      }
    } catch (e) { log.swallow("read prettify plugin setting", e); }
    // Update all .sprout-pretty-card classes inside the event target
    const root = (e.currentTarget instanceof HTMLElement)
      ? e.currentTarget
      : (e.target instanceof HTMLElement ? e.target : null);
    if (root) {
      const cards = Array.from(root.querySelectorAll<HTMLElement>(".sprout-pretty-card"));
      for (const card of cards) {
        card.classList.remove("theme", "accent");
        card.classList.add(prettifyStyle === "theme" ? "theme" : "accent");
      }
      scheduleMasonryLayout();
    } else {
      void processCardElements(document.documentElement, undefined, '');
      scheduleMasonryLayout();
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

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.type = "text/css";
  s.textContent = `
  .sprout-card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}
  .sprout-section-label{display:flex;align-items:center;gap:10px;}
  .sprout-toggle-btn{background:none;border:none;padding:0 !important;padding:0;margin:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}
  .sprout-toggle-btn:focus{outline:none;box-shadow:none}
  .sprout-toggle-chevron{display:inline-block;transition:transform 0.18s ease;will-change:transform;width:1em;height:1em;color:inherit;vertical-align:middle;}
  .sprout-collapsible{overflow:hidden;transition:max-height 0.22s ease,padding 0.22s ease;}
  .sprout-collapsible.collapsed{max-height:0;padding-top:0}
  .sprout-collapsible.expanded{max-height:2000px}
  .sprout-options-list { position: relative; }
  .sprout-option {
    position: relative;
    padding-left: 1.7em;
    color: var(--text-color);
    opacity: .9;
    font-size: .9rem;
    line-height: 1.9;
    margin-bottom: 6px;
  }
  .sprout-option-bullet {
    position: absolute;
    left: 0;
    top: 0;
    width: 1.7em;
    display: inline-block;
  }
  /* masonry container styles */
  .sprout-masonry-grid-wrapper{width:100%;}
  .sprout-masonry-grid{display:flex;gap:16px;align-items:flex-start}
  .sprout-masonry-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px}
  .sprout-masonry-col > .sprout-pretty-card{width:100%;flex-shrink:0;box-sizing:border-box;}
  mjx-container[jax="CHTML"][display="true"]{display:block;text-align:left;margin:0.5em 1em;}
  `;
  document.head.appendChild(s);
}

/* =========================
   Manual trigger + event hook
   ========================= */

function setupManualTrigger() {
  window.sproutApplyMasonryGrid = () => {
    debugLog('[Sprout] Manual sproutApplyMasonryGrid() called');
    requestAnimationFrame(() => {
      setTimeout(() => {
        void processCardElements(document.documentElement, undefined, '');
        scheduleMasonryLayout();
      }, 40);
    });
  };

  addTrackedWindowListener('sprout-cards-inserted', () => {
    debugLog('[Sprout] Received sprout-cards-inserted event — applying masonry');
    window.sproutApplyMasonryGrid?.();
  });

  // Re-layout on window resize (smooth + throttled)
  addTrackedWindowListener('resize', () => {
    if (masonryResizeRaf) return;
    masonryResizeRaf = window.requestAnimationFrame(() => {
      masonryResizeRaf = null;
      scheduleMasonryLayout();
    });

    if (masonryResizeTimer) window.clearTimeout(masonryResizeTimer);
    masonryResizeTimer = window.setTimeout(() => {
      scheduleMasonryLayout();
    }, 180);
  });

  // Avoid relayout thrash while scrolling
  let st: number | null = null;
  addTrackedWindowListener(
    'scroll',
    () => {
      masonryIsScrolling = true;
      if (st) window.clearTimeout(st);
      st = window.setTimeout(() => {
        masonryIsScrolling = false;
        if (pendingScrollWork) {
          pendingScrollWork = false;
          void processCardElements(document.documentElement, undefined, '');
        }
        scheduleMasonryLayout();
      }, 250);
    },
    true,
  );

  debugLog('[Sprout] Manual trigger and event hook installed');
}

/* =========================
   Debounced MutationObserver
   ========================= */

let mutationObserver: MutationObserver | null = null;
let debounceTimer: number | null = null;
const DEBOUNCE_MS = 120;
let pendingScrollWork = false;

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
}

function setupDebouncedMutationObserver() {
  if (mutationObserver) {
    debugLog('[Sprout] MutationObserver already running');
    return;
  }

  mutationObserver = new MutationObserver((mutations) => {
    let sawRelevant = false;
    for (const m of mutations) {
      // Only watch for added nodes (new content), ignore removals and repositioning
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        for (const n of Array.from(m.addedNodes)) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element;
            // Only trigger if we see actual NEW .el-p or sprout cards
            // Skip if the added node is just being moved (check if it already has sprout-processed)
            if (el.matches && (
              (el.matches('.el-p') && !el.hasAttribute('data-sprout-processed')) || 
              (el.querySelector && el.querySelector('.el-p:not([data-sprout-processed])'))
            )) {
              sawRelevant = true;
              break;
            }
          }
        }
      }
      if (sawRelevant) break;
    }

    if (!sawRelevant) return;

    if (masonryIsScrolling) {
      pendingScrollWork = true;
      return;
    }

    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      try {
        debugLog('[Sprout] MutationObserver triggered — processing new nodes');
        void processCardElements(document.documentElement, undefined, '');
        scheduleMasonryLayout();
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

  await Promise.resolve();
}

/* =========================
   True Masonry layout
   ========================= */

let masonryLayoutTimer: number | null = null;
let masonryLayoutRaf: number | null = null;
let masonryLayoutRunning = false;
let masonryIsScrolling = false;
let masonryResizeRaf: number | null = null;
let masonryResizeTimer: number | null = null;

// Track last known widths to avoid unnecessary relayouts
let lastKnownViewportWidth = 0;

function scheduleMasonryLayout(forceRebalance = false) {
  if (masonryIsScrolling) {
    if (masonryLayoutTimer) window.clearTimeout(masonryLayoutTimer);
    masonryLayoutTimer = window.setTimeout(() => scheduleMasonryLayout(forceRebalance), 120);
    return;
  }

  if (masonryLayoutTimer) window.clearTimeout(masonryLayoutTimer);
  masonryLayoutTimer = window.setTimeout(() => {
    if (masonryLayoutRaf) window.cancelAnimationFrame(masonryLayoutRaf);
    masonryLayoutRaf = window.requestAnimationFrame(() => {
      masonryLayoutTimer = null;
      if (masonryLayoutRunning) return;
      masonryLayoutRunning = true;
      try {
        layoutAllMasonryGrids(forceRebalance);
      } finally {
        masonryLayoutRunning = false;
      }
    });
  }, 60);
}

/**
 * Check if existing masonry grids need column rebalancing based on new width
 */
function shouldRebalanceGrids(): boolean {
  const currentWidth = window.innerWidth;
  const minColWidth = 280;
  
  const oldCols = Math.max(1, Math.min(2, Math.floor(lastKnownViewportWidth / minColWidth)));
  const newCols = Math.max(1, Math.min(2, Math.floor(currentWidth / minColWidth)));
  
  if (oldCols !== newCols) {
    debugLog(`[Masonry] Column count changed: ${oldCols} -> ${newCols}`);
    lastKnownViewportWidth = currentWidth;
    return true;
  }
  
  return false;
}

/**
 * Rebalance an existing masonry grid's columns without rebuilding
 */
function rebalanceExistingGrid(wrapper: HTMLElement) {
  const grid = wrapper.querySelector('.sprout-masonry-grid') as HTMLElement;
  if (!grid) return;
  
  // Get all cards from all columns
  const allCards = Array.from(grid.querySelectorAll<HTMLElement>('.sprout-pretty-card'));
  if (allCards.length === 0) return;
  
  // Calculate new column count
  const parent = wrapper.parentElement;
  const parentWidth = parent?.getBoundingClientRect().width || wrapper.getBoundingClientRect().width || 800;
  const minColWidth = 280;
  const newColCount = Math.max(1, Math.min(2, Math.floor(parentWidth / minColWidth)));
  
  // Get current column count
  const currentCols = grid.querySelectorAll('.sprout-masonry-col').length;
  
  // If column count hasn't changed, no need to rebalance
  if (currentCols === newColCount) return;
  
  debugLog(`[Masonry] Rebalancing grid: ${currentCols} -> ${newColCount} columns`);
  
  // Remove old columns
  grid.innerHTML = '';
  
  // Create new columns
  const columns: HTMLElement[] = [];
  for (let i = 0; i < newColCount; i++) {
    const col = document.createElement('div');
    col.className = 'sprout-masonry-col';
    grid.appendChild(col);
    columns.push(col);
  }
  
  // Redistribute cards into shortest column
  for (const card of allCards) {
    let minCol = columns[0];
    let minH = minCol.scrollHeight;
    for (const c of columns) {
      const h = c.scrollHeight;
      if (h < minH) { minH = h; minCol = c; }
    }
    minCol.appendChild(card);
    card.style.removeProperty('break-inside');
    card.style.removeProperty('page-break-inside');
  }
  
  // Add bottom margin to last card in each column
  for (const col of columns) {
    const lastCard = col.lastElementChild as HTMLElement;
    if (lastCard) {
      lastCard.style.setProperty('margin-bottom', '20px', 'important');
    }
  }
}

function layoutAllMasonryGrids(forceRebalance = false) {
  // First, check if existing grids need rebalancing (e.g., after resize)
  if (forceRebalance || shouldRebalanceGrids()) {
    const existingWrappers = Array.from(document.querySelectorAll<HTMLElement>('.sprout-masonry-grid-wrapper[data-sprout-masonry="true"]'));
    for (const wrapper of existingWrappers) {
      rebalanceExistingGrid(wrapper);
    }
  }
  
  // Gather only unwrapped cards to avoid double-wrapping
  const allCards = Array.from(document.querySelectorAll<HTMLElement>('.sprout-pretty-card'));
  const cards = allCards.filter(c => !c.closest('.sprout-masonry-grid-wrapper'));
  if (cards.length === 0) {
    // Even if no new cards, hide siblings for existing grids
    hideAllMasonryGridSiblings();
    return;
  }

  // Group by parent and consecutive nodes
  const parents = new Map<HTMLElement, HTMLElement[]>();

  for (const card of cards) {
    const parent = card.parentElement;
    if (!parent) continue;
    if (!parents.has(parent)) parents.set(parent, []);
    parents.get(parent)!.push(card);
  }

  for (const [parent, _group] of parents.entries()) {
    // iterate parent's children and collect consecutive .sprout-pretty-card nodes into subgroups
    const children = Array.from(parent.children);
    let current: HTMLElement[] = [];
    for (const child of children) {
      if ((child as HTMLElement).classList && (child as HTMLElement).classList.contains('sprout-pretty-card')) {
        current.push(child as HTMLElement);
      } else {
        if (current.length > 0) {
          buildOrUpdateMasonryForGroup(parent, current);
          current = [];
        }
      }
    }
    if (current.length > 0) buildOrUpdateMasonryForGroup(parent, current);
  }
  
  // After all grids are built/updated, hide duplicate siblings
  // Run immediately and again after a short delay to catch everything
  hideAllMasonryGridSiblings();
  window.setTimeout(() => hideAllMasonryGridSiblings(), 0);
  window.setTimeout(() => hideAllMasonryGridSiblings(), 50);
}

function buildOrUpdateMasonryForGroup(parent: HTMLElement, group: HTMLElement[]) {
  if (group.length === 0) return;

  // If these cards are already inside our masonry wrapper (or an ancestor wrapper), skip
  const first = group[0];
  if (first.closest('.sprout-masonry-grid-wrapper')) return;

  // Create wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'sprout-masonry-grid-wrapper';
  wrapper.setAttribute('data-sprout-masonry', 'true');

  const grid = document.createElement('div');
  grid.className = 'sprout-masonry-grid';
  wrapper.appendChild(grid);

  // Insert wrapper before the first card
  parent.insertBefore(wrapper, first);

  // Decide columns based on available width
  const parentRect = parent.getBoundingClientRect();
  const parentWidth = parentRect.width || parent.clientWidth || 800;
  const minColWidth = 280; // tweak as needed
  const cols = Math.max(1, Math.min(2, Math.floor(parentWidth / minColWidth)));

  const columns: HTMLElement[] = [];
  for (let i = 0; i < cols; i++) {
    const col = document.createElement('div');
    col.className = 'sprout-masonry-col';
    grid.appendChild(col);
    columns.push(col);
  }

  // Append cards into shortest column
  for (const card of group) {
    let minCol = columns[0];
    let minH = minCol.scrollHeight;
    for (const c of columns) {
      const h = c.scrollHeight;
      if (h < minH) { minH = h; minCol = c; }
    }
    minCol.appendChild(card);
    // ensure card doesn't have leftover break styles
    card.style.removeProperty('break-inside');
    card.style.removeProperty('page-break-inside');
  }

  // Add bottom margin to last card in each column to push down content after
  for (const col of columns) {
    const lastCard = col.lastElementChild as HTMLElement;
    if (lastCard) {
      lastCard.style.setProperty('margin-bottom', '20px', 'important');
    }
  }
}

/* =========================
   Sibling hiding
   ========================= */

/**
 * Hide duplicate siblings after all masonry grid wrappers
 * Called after layout completes to ensure DOM is settled
 * Strategy: Hide el-div and el-p elements that are duplicates, but NOT content after cards
 */
function hideAllMasonryGridSiblings() {
  const wrappers = Array.from(document.querySelectorAll<HTMLElement>('.sprout-masonry-grid-wrapper[data-sprout-masonry="true"]'));
  
  debugLog('[Hide Siblings] Found', wrappers.length, 'masonry grids');
  
  for (const wrapper of wrappers) {
    let next = wrapper.nextElementSibling;
    const toHide: Element[] = [];
    let extractedContent: { element: Element; content: string } | null = null;
    
    // Hide el-div and el-p elements that are card duplicates, until we hit non-card content
    while (next) {
      const classes = next.className || '';
      
      // STOP if we hit a header - this is new content after flashcards
      if (classes.match(/\bel-h[1-6]\b/)) {
        debugLog('[Hide Siblings] Stopped at header:', (next.textContent || '').substring(0, 50));
        break;
      }
      
      // STOP if we hit major structural elements (new content)
      if (classes.includes('el-ul') ||
          classes.includes('el-ol') ||
          classes.includes('el-blockquote') ||
          classes.includes('el-table')) {
        debugLog('[Hide Siblings] Stopped at structural element');
        break;
      }
      
      // Check if this el-div or el-p contains content that should NOT be hidden
      if (classes.includes('el-div') || classes.includes('el-p')) {
        // Check if this element contains non-card content (like a header merged with card content)
        const check = checkForNonCardContent(next);
        if (check.hasNonCardContent) {
          if (check.contentAfterPipe) {
            // This element has BOTH card content AND non-card content
            // We'll hide it but need to extract and render the non-card content
            debugLog('[Hide Siblings] Element has mixed content, extracting:', check.contentAfterPipe);
            extractedContent = { element: next, content: check.contentAfterPipe };
            toHide.push(next);
          } else {
            debugLog('[Hide Siblings] Stopped - element contains non-card content');
          }
          break;
        }
        toHide.push(next);
        next = next.nextElementSibling;
        continue;
      }
      
      // Unknown element - stop to be safe
      break;
    }
    
    debugLog('[Hide Siblings] Hiding', toHide.length, 'duplicate elements after masonry grid');
    
    // Hide all collected duplicates
    for (const el of toHide) {
      (el as HTMLElement).style.setProperty('display', 'none', 'important');
      (el as HTMLElement).setAttribute('data-sprout-hidden', 'true');
    }
    
    // If we extracted content that should be visible, create new elements for it
    if (extractedContent) {
      const { element, content } = extractedContent;
      
      // Check if we already created replacements for this content
      const existingReplacement = element.nextElementSibling;
      if (existingReplacement?.hasAttribute('data-sprout-extracted')) {
        debugLog('[Hide Siblings] Replacement already exists, skipping');
        continue;
      }
      
      // Parse the content into separate markdown elements
      // Split on common patterns: headers, numbered lists, bullet lists
      const elements = parseMarkdownToElements(content);
      
      // Insert all parsed elements after the hidden element
      let insertAfter: Element = element;
      for (const elemData of elements) {
        const newEl = createMarkdownElement(elemData);
        if (newEl) {
          insertAfter.parentNode?.insertBefore(newEl, insertAfter.nextSibling);
          insertAfter = newEl;
          debugLog('[Hide Siblings] Created replacement element:', elemData.type);
        }
      }
    }
  }
  
  // Force a reflow to ensure hidden elements are painted correctly
  // This prevents the "only shows after inspect element" issue
  if (wrappers.length > 0) {
    void document.body.offsetHeight;
    
    // Force repaint of the first visible element after each wrapper
    for (const wrapper of wrappers) {
      let next = wrapper.nextElementSibling;
      while (next) {
        const classes = next.className || '';
        
        // Skip hidden elements
        if ((next as HTMLElement).style.display === 'none' || 
            (next as HTMLElement).hasAttribute('data-sprout-hidden')) {
          next = next.nextElementSibling;
          continue;
        }
        
        // Found first visible element - force it to repaint
        if (classes.match(/\bel-h[1-6]\b/) || classes.includes('el-')) {
          const el = next as HTMLElement;
          const originalDisplay = el.style.display;
          el.style.display = 'none';
          void el.offsetHeight; // Force reflow
          el.style.display = originalDisplay || '';
          void el.offsetHeight; // Force another reflow
          break;
        }
        next = next.nextElementSibling;
      }
    }
  }
}

/**
 * Hide duplicate siblings after individual cards
 */
function hideCardSiblingElements(cardEl: HTMLElement, cardRawText?: string) {
  const cardTextNorm = cardRawText ? clean(cardRawText).replace(/\s+/g, " ").trim() : "";
  const cardMathSig = cardTextNorm ? normalizeMathSignature(cardTextNorm) : "";
  
  // Get the actual position in DOM to find siblings
  // If card is in masonry, we need to check its wrapper's siblings
  let searchRoot: Element = cardEl;
  const masonryWrapper = cardEl.closest('.sprout-masonry-grid-wrapper');
  if (masonryWrapper) {
    searchRoot = masonryWrapper;
  }
  
  let next = searchRoot.nextElementSibling;
  const toHide: Element[] = [];
  
  // Collect consecutive el-div and el-p elements until we hit significant content
  while (next) {
    const classes = next.className || '';
    
    // Stop if we hit another sprout card
    if (classes.includes('sprout-pretty-card')) {
      break;
    }
    
    // Stop if we hit a header
    if (classes.match(/\bel-h[1-6]\b/)) {
      break;
    }
    
    // Stop if we hit major structural elements
    if (classes.includes('el-ul') ||
        classes.includes('el-ol') ||
        classes.includes('el-blockquote') ||
        classes.includes('el-pre') ||
        classes.includes('el-table')) {
      break;
    }
    
    // Hide math blocks and paragraphs that are part of this card's source block
    if (classes.includes('el-div') || classes.includes('el-p')) {
      let raw = "";
      if (classes.includes('el-p')) raw = extractRawTextFromParagraph(next as HTMLElement);
      else raw = extractTextWithLaTeX(next as HTMLElement);

      const rawNorm = clean(raw).replace(/\s+/g, " ").trim();
      const hasMath = !!(next as HTMLElement).querySelector('.math, mjx-container, mjx-math');
      const rawMathSig = rawNorm ? normalizeMathSignature(rawNorm) : "";

      if (cardTextNorm && rawNorm && cardTextNorm.includes(rawNorm)) {
        toHide.push(next);
        next = next.nextElementSibling;
        continue;
      }

      if (hasMath && cardMathSig && rawMathSig && cardMathSig.includes(rawMathSig)) {
        toHide.push(next);
        next = next.nextElementSibling;
        continue;
      }

      // If we don't have a match, stop hiding so normal content can render
      break;
    }
    
    // Unknown element type - stop
    break;
  }
  
  // Hide collected elements with increased specificity
  for (const el of toHide) {
    (el as HTMLElement).style.setProperty('display', 'none', 'important');
    (el as HTMLElement).setAttribute('data-sprout-hidden', 'true');
  }
}

/* =========================
   Card enhancement
   ========================= */

function enhanceCardElement(
  el: HTMLElement,
  card: SproutCard,
  originalContentOverride?: string,
  cardRawText?: string,
) {
  const originalContent = originalContentOverride ?? el.innerHTML;
  el.innerHTML = '';
  // Determine prettify style from plugin instance (Obsidian context)
  let prettifyStyle: string = 'accent';
  try {
    // Try to get the plugin instance from Obsidian global registry
    const activePlugin = getSproutPlugin();
    if (activePlugin?.settings?.appearance?.prettifyCards) {
      prettifyStyle = activePlugin.settings.appearance.prettifyCards;
    }
  } catch (e) { log.swallow("read prettify plugin setting", e); }
  el.classList.add('sprout-pretty-card', 'sprout-reading-card', 'sprout-reading-view-wrapper', prettifyStyle === 'theme' ? 'theme' : 'accent');

  el.dataset.sproutId = card.anchorId;
  el.dataset.sproutType = card.type;
  
  // Store raw text for masonry grid sibling hiding
  if (cardRawText) {
    el.setAttribute('data-sprout-raw-text', cardRawText);
  }

    const innerHTML = `
      <div class="sprout-card-header" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5em;">
        <div class="sprout-card-title" style="margin: 0; padding: 0; font-weight: 500; line-height: 1.15;">
          ${processMarkdownFeatures(card.title || '')}
        </div>
        <span class="sprout-card-edit-btn" role="button" aria-label="Edit card" data-tooltip="Edit card" tabindex="0"></span>
      </div>

      <div class="sprout-card-content">
        ${buildCardContentHTML(card)}
      </div>

      <div class="sprout-original-content" aria-hidden="true">${originalContent}</div>
    `;

  el.innerHTML = innerHTML;
  el.classList.add('sprout-single-card');

  // Hide any sibling elements that were part of this card's content
  // (Obsidian renders block math as separate <div class="el-div"> siblings)
  hideCardSiblingElements(el, cardRawText);

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
  const editBtn = el.querySelector<HTMLElement>(".sprout-card-edit-btn");
  if (editBtn) {
    setIcon(editBtn, "pencil");
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
            scheduleMasonryLayout();
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

  // Hook up toggles inside this card
  const toggles = el.querySelectorAll<HTMLButtonElement>('.sprout-toggle-btn');
  toggles.forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (!target) return;
    const content = el.querySelector<HTMLElement>(target);
    if (!content) return;
    // initial collapsed
    content.classList.add('sprout-collapsible','collapsed');
    btn.setAttribute('aria-expanded', 'false');
    const chevron = btn.querySelector<HTMLElement>('.sprout-toggle-chevron');
    // set initial chevron rotation to point right (collapsed)
    if (chevron) chevron.style.transform = 'rotate(-90deg)';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        content.classList.remove('expanded');
        content.classList.add('collapsed');
        btn.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.style.transform = 'rotate(-90deg)';
      } else {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
        // after expanding, reflow masonry because heights changed
        scheduleMasonryLayout();
      }
    });
  });

  // Render MathJax if present
  void renderMarkdownInElements(el, card);
}

/* =========================
   Markdown rendering in card elements
   ========================= */

async function renderMarkdownInElements(el: HTMLElement, card: SproutCard) {
  const app = window.app;
  if (!app) return;
  
  // Get the plugin instance to use as component parent
  const plugin = getSproutPlugin();
  if (!plugin) return;
  
  // Create a temporary component for rendering to avoid memory leaks
  const component = plugin.addChild(new Component());
  
  try {
    // Render markdown for Basic card Q/A fields using the card data directly
    if (card.type === 'basic') {
      const qText = Array.isArray(card.fields.Q) ? card.fields.Q.join('\n') : card.fields.Q;
      const aText = Array.isArray(card.fields.A) ? card.fields.A.join('\n') : card.fields.A;
      
      // Find Q/A elements by ID pattern
      const qEl = el.querySelector('[id^="sprout-q-"]');
      const aEl = el.querySelector('[id^="sprout-a-"]');
      
      if (qEl && qText) {
        try {
          await MarkdownRenderer.renderMarkdown(
            qText,
            qEl as HTMLElement,
            '',  // sourcePath
            component
          );
        } catch {
          qEl.textContent = qText;
        }
      }
      
      if (aEl && aText) {
        try {
          await MarkdownRenderer.renderMarkdown(
            aText,
            aEl as HTMLElement,
            '',  // sourcePath
            component
          );
        } catch {
          aEl.textContent = aText;
        }
      }
    }
    
    // Render markdown for Info fields (all card types)
    const iText = Array.isArray(card.fields.I) ? card.fields.I.join('\n') : card.fields.I;
    if (iText) {
      const iEl = el.querySelector('[id^="sprout-i-"]');
      if (iEl) {
        try {
          await MarkdownRenderer.renderMarkdown(
            iText,
            iEl as HTMLElement,
            '',  // sourcePath
            component
          );
        } catch {
          iEl.textContent = iText;
        }
      }
    }
  } finally {
    // Remove the component to clean up any registered event handlers
    plugin.removeChild(component);
  }
  
  // Render MathJax after markdown is processed
  renderMathInElement(el);
}

/* =========================
   Expose manual trigger on window
   ========================= */

declare global { interface Window { sproutApplyMasonryGrid?: () => void; } }

window.sproutApplyMasonryGrid = window.sproutApplyMasonryGrid || (() => {
  debugLog('[Sprout] sproutApplyMasonryGrid placeholder invoked');
  void processCardElements(document.documentElement, undefined, '');
  scheduleMasonryLayout();
});
