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
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import { buildCardBlockMarkdown, findCardBlockRangeById } from "../reviewer/markdown-block";
import type { CardRecord } from "../core/store";
import type SproutPlugin from "../main";
import { queryFirst, replaceChildrenWithHTML, setCssProps } from "../core/ui";
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
    } else {
      void processCardElements(document.documentElement, undefined, '');
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

  await Promise.resolve();

}

/* =========================
   FLIP animation for masonry reflow
   ========================= */

const FLIP_DURATION = 280; // ms

/**
 * scheduleMasonryLayout stub — CSS multi-column handles layout.
 */
function _scheduleMasonryLayout(_forceRebalance = false) {
  /* intentional no-op — CSS multi-column handles column layout */
}

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
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px)`;

    // Force reflow so the inverted position is painted
    void card.offsetHeight;

    // "Play" — animate from inverted position to final (transform: none)
    card.style.transition = `transform ${FLIP_DURATION}ms ease`;
    card.style.transform = '';
  }

  // Clean up transition style after animation ends
  const cleanup = () => {
    for (const [card] of before) {
      card.style.transition = '';
      card.style.transform = '';
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
  // Remove pipe field terminators and field keys like "I|" at the start
  out = out.replace(/\|/g, "");
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
  // (contains pipe-delimited fields, cloze syntax, or field keys),
  // it's almost certainly leftover from the card being split.
  const looksLikeCardContent =
    /\{\{c\d+::/.test(siblingText) ||
    /^\s*[A-Z]{1,3}\s*\|/.test(siblingText) ||
    /\}\}\s*\|/.test(siblingText);
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

function enhanceCardElement(
  el: HTMLElement,
  card: SproutCard,
  originalContentOverride?: string,
  cardRawText?: string,
) {
  const originalContent = originalContentOverride ?? el.innerHTML;
  el.replaceChildren();
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
      <div class="sprout-card-header sprout-reading-card-header">
        <div class="sprout-card-title sprout-reading-card-title">
          ${processMarkdownFeatures(card.title || '')}
        </div>
        <span class="sprout-card-edit-btn" role="button" aria-label="Edit card" data-tooltip="Edit card" tabindex="0"></span>
      </div>

      <div class="sprout-card-content">
        ${buildCardContentHTML(card)}
      </div>

      <div class="sprout-original-content" aria-hidden="true">${originalContent}</div>
    `;

  replaceChildrenWithHTML(el, innerHTML);
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
    if (chevron) chevron.classList.add('sprout-reading-chevron-collapsed');
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
  
  // Source path for resolving images/links
  const sourcePath = app.workspace?.getActiveFile?.()?.path ?? '';

  // Create a temporary component for rendering to avoid memory leaks
  const component = plugin.addChild(new Component());
  
  try {
    // Render markdown for Basic card Q/A fields using the card data directly
    if (card.type === 'basic') {
      const qText = Array.isArray(card.fields.Q) ? card.fields.Q.join('\n') : card.fields.Q;
      const aText = Array.isArray(card.fields.A) ? card.fields.A.join('\n') : card.fields.A;
      
      // Find Q/A elements by ID pattern
      const qEl = queryFirst(el, '[id^="sprout-q-"]');
      const aEl = queryFirst(el, '[id^="sprout-a-"]');
      
      if (qEl && qText) {
        try {
          await MarkdownRenderer.renderMarkdown(qText, qEl as HTMLElement, sourcePath, component);
          resolveUnloadedEmbeds(qEl as HTMLElement, app, sourcePath);
        } catch {
          qEl.textContent = qText;
        }
      }
      
      if (aEl && aText) {
        try {
          await MarkdownRenderer.renderMarkdown(aText, aEl as HTMLElement, sourcePath, component);
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
          await MarkdownRenderer.renderMarkdown(iText, iEl as HTMLElement, sourcePath, component);
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
 * When MarkdownRenderer.renderMarkdown runs in a detached component,
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
  const ioDef = ioMap[anchorId];
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
