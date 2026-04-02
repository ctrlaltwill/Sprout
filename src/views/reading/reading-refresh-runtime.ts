/**
 * @file src/views/reading/reading-refresh-runtime.ts
 * @summary Module for reading refresh runtime.
 *
 * @exports
 *  - ReadingRefreshState
 *  - isMainWorkspaceMarkdownLeaf
 *  - computeContentSignature
 *  - getMarkdownLeafSource
 *  - refreshReadingViewMarkdownLeaves
 *  - scheduleReadingViewRefresh
 */

import { type App, MarkdownView, TFile, type WorkspaceLeaf } from "obsidian";

import { log } from "../../platform/core/logger";
import { queryFirst } from "../../platform/core/ui";

export type ReadingRefreshState = {
  readingViewRefreshTimer: number | null;
  readingModeWatcherInterval: number | null;
  markdownLeafModeSnapshot: WeakMap<WorkspaceLeaf, "source" | "preview">;
  markdownLeafContentSnapshot: WeakMap<WorkspaceLeaf, string>;
};

export function isMainWorkspaceMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return false;

  const container = view.containerEl;
  if (!(container instanceof HTMLElement)) return false;

  const inSidebar = !!container.closest(
    ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
  );

  return !inSidebar;
}

export function computeContentSignature(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

export async function getMarkdownLeafSource(app: App, leaf: WorkspaceLeaf): Promise<{ sourceContent: string; sourcePath: string }> {
  try {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return { sourceContent: "", sourcePath: "" };

    const sourcePath = view.file instanceof TFile ? view.file.path : "";
    const mode = view.getMode?.();
    if (mode === "source") {
      const liveViewData =
        typeof (view as unknown as { getViewData?: () => string }).getViewData === "function"
          ? String((view as unknown as { getViewData: () => string }).getViewData() ?? "")
          : "";

      if (liveViewData.trim()) {
        return { sourceContent: liveViewData, sourcePath };
      }
    }

    if (view.file instanceof TFile && view.file.extension === "md") {
      const fileContent = await app.vault.read(view.file);
      return { sourceContent: String(fileContent ?? ""), sourcePath };
    }
  } catch (e) {
    log.swallow("get markdown leaf source", e);
  }

  return { sourceContent: "", sourcePath: "" };
}

export async function refreshReadingViewMarkdownLeaves(app: App): Promise<void> {
  const leaves = app.workspace
    .getLeavesOfType("markdown")
    .filter((leaf) => isMainWorkspaceMarkdownLeaf(leaf));

  await Promise.all(leaves.map(async (leaf) => {
    const container = leaf.view?.containerEl ?? null;
    if (!(container instanceof HTMLElement)) return;

    const content = queryFirst(
      container,
      ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
    );
    if (!(content instanceof HTMLElement)) return;

    const scrollHost =
      content.closest(".markdown-reading-view, .markdown-preview-view, .markdown-rendered") ??
      content;
    const prevTop = Number(scrollHost.scrollTop || 0);
    const prevLeft = Number(scrollHost.scrollLeft || 0);
    const sourcePayload = await getMarkdownLeafSource(app, leaf);

    try {
      content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
        bubbles: true,
        detail: sourcePayload,
      }));
    } catch (e) {
      log.swallow("dispatch reading view refresh", e);
    }

    const view = leaf.view;
    if (view instanceof MarkdownView && view.getMode?.() === "preview") {
      try {
        view.previewMode?.rerender?.();
      } catch (e) {
        log.swallow("rerender markdown preview", e);
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          scrollHost.scrollTo({ top: prevTop, left: prevLeft });
        } catch {
          scrollHost.scrollTop = prevTop;
          scrollHost.scrollLeft = prevLeft;
        }

        try {
          content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
            bubbles: true,
            detail: sourcePayload,
          }));
        } catch (e) {
          log.swallow("dispatch reading view refresh (post-rerender)", e);
        }
      });
    });
  }));
}

export function scheduleReadingViewRefresh(params: {
  state: ReadingRefreshState;
  refresh: () => void;
  delayMs?: number;
}): void {
  const { state, refresh, delayMs = 90 } = params;

  if (state.readingViewRefreshTimer != null) {
    window.clearTimeout(state.readingViewRefreshTimer);
    state.readingViewRefreshTimer = null;
  }

  state.readingViewRefreshTimer = window.setTimeout(() => {
    state.readingViewRefreshTimer = null;
    try {
      refresh();
    } catch (e) {
      log.swallow("schedule reading view refresh", e);
    }
  }, Math.max(0, Number(delayMs) || 0));
}

export function startMarkdownModeWatcher(params: {
  app: App;
  state: ReadingRefreshState;
  registerInterval: (id: number) => void;
  scheduleRefresh: (delayMs?: number) => void;
}): void {
  const { app, state, registerInterval, scheduleRefresh } = params;
  if (state.readingModeWatcherInterval != null) return;

  const scanModes = () => {
    try {
      const leaves = app.workspace
        .getLeavesOfType("markdown")
        .filter((leaf) => isMainWorkspaceMarkdownLeaf(leaf));
      let sawModeChange = false;

      for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;

        const mode = view.getMode?.();
        if (mode !== "source" && mode !== "preview") continue;

        const prev = state.markdownLeafModeSnapshot.get(leaf);
        if (prev !== mode) {
          state.markdownLeafModeSnapshot.set(leaf, mode);
          if (prev) sawModeChange = true;
        }

        const sourcePath = view.file instanceof TFile ? view.file.path : "";
        const liveViewData =
          typeof (view as unknown as { getViewData?: () => string }).getViewData === "function"
            ? String((view as unknown as { getViewData: () => string }).getViewData() ?? "")
            : "";
        const signature = `${sourcePath}|${computeContentSignature(liveViewData)}`;
        const prevSignature = state.markdownLeafContentSnapshot.get(leaf);
        if (prevSignature !== signature) {
          state.markdownLeafContentSnapshot.set(leaf, signature);
          if (prevSignature) sawModeChange = true;
        }
      }

      if (sawModeChange) {
        scheduleRefresh(40);
      }
    } catch (e) {
      log.swallow("scan markdown mode changes", e);
    }
  };

  scanModes();
  state.readingModeWatcherInterval = window.setInterval(scanModes, 180);
  registerInterval(state.readingModeWatcherInterval);
}
