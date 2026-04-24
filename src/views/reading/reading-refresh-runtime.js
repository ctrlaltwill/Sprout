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
import { MarkdownView, TFile } from "obsidian";
import { log } from "../../platform/core/logger";
import { queryFirst } from "../../platform/core/ui";
export function isMainWorkspaceMarkdownLeaf(leaf) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView))
        return false;
    const container = view.containerEl;
    if (!(container instanceof HTMLElement))
        return false;
    const inSidebar = !!container.closest(".workspace-split.mod-left-split, .workspace-split.mod-right-split");
    return !inSidebar;
}
export function computeContentSignature(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export async function getMarkdownLeafSource(app, leaf) {
    var _a, _b;
    try {
        const view = leaf.view;
        if (!(view instanceof MarkdownView))
            return { sourceContent: "", sourcePath: "" };
        const sourcePath = view.file instanceof TFile ? view.file.path : "";
        const mode = (_a = view.getMode) === null || _a === void 0 ? void 0 : _a.call(view);
        if (mode === "source") {
            const liveViewData = typeof view.getViewData === "function"
                ? String((_b = view.getViewData()) !== null && _b !== void 0 ? _b : "")
                : "";
            if (liveViewData.trim()) {
                return { sourceContent: liveViewData, sourcePath };
            }
        }
        if (view.file instanceof TFile && view.file.extension === "md") {
            const fileContent = await app.vault.read(view.file);
            return { sourceContent: String(fileContent !== null && fileContent !== void 0 ? fileContent : ""), sourcePath };
        }
    }
    catch (e) {
        log.swallow("get markdown leaf source", e);
    }
    return { sourceContent: "", sourcePath: "" };
}
export async function refreshReadingViewMarkdownLeaves(app) {
    const leaves = app.workspace
        .getLeavesOfType("markdown")
        .filter((leaf) => isMainWorkspaceMarkdownLeaf(leaf));
    await Promise.all(leaves.map(async (leaf) => {
        var _a, _b, _c, _d, _e, _f;
        const container = (_b = (_a = leaf.view) === null || _a === void 0 ? void 0 : _a.containerEl) !== null && _b !== void 0 ? _b : null;
        if (!(container instanceof HTMLElement))
            return;
        const content = queryFirst(container, ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section");
        if (!(content instanceof HTMLElement))
            return;
        const scrollHost = (_c = content.closest(".markdown-reading-view, .markdown-preview-view, .markdown-rendered")) !== null && _c !== void 0 ? _c : content;
        const prevTop = Number(scrollHost.scrollTop || 0);
        const prevLeft = Number(scrollHost.scrollLeft || 0);
        const sourcePayload = await getMarkdownLeafSource(app, leaf);
        try {
            content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
                bubbles: true,
                detail: sourcePayload,
            }));
        }
        catch (e) {
            log.swallow("dispatch reading view refresh", e);
        }
        const view = leaf.view;
        if (view instanceof MarkdownView && ((_d = view.getMode) === null || _d === void 0 ? void 0 : _d.call(view)) === "preview") {
            try {
                (_f = (_e = view.previewMode) === null || _e === void 0 ? void 0 : _e.rerender) === null || _f === void 0 ? void 0 : _f.call(_e);
            }
            catch (e) {
                log.swallow("rerender markdown preview", e);
            }
        }
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                try {
                    scrollHost.scrollTo({ top: prevTop, left: prevLeft });
                }
                catch (_a) {
                    scrollHost.scrollTop = prevTop;
                    scrollHost.scrollLeft = prevLeft;
                }
                try {
                    content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", {
                        bubbles: true,
                        detail: sourcePayload,
                    }));
                }
                catch (e) {
                    log.swallow("dispatch reading view refresh (post-rerender)", e);
                }
            });
        });
    }));
}
export function scheduleReadingViewRefresh(params) {
    const { state, refresh, delayMs = 90 } = params;
    if (state.readingViewRefreshTimer != null) {
        window.clearTimeout(state.readingViewRefreshTimer);
        state.readingViewRefreshTimer = null;
    }
    state.readingViewRefreshTimer = window.setTimeout(() => {
        state.readingViewRefreshTimer = null;
        try {
            refresh();
        }
        catch (e) {
            log.swallow("schedule reading view refresh", e);
        }
    }, Math.max(0, Number(delayMs) || 0));
}
export function startMarkdownModeWatcher(params) {
    const { app, state, registerInterval, scheduleRefresh } = params;
    if (state.readingModeWatcherInterval != null)
        return;
    const scanModes = () => {
        var _a, _b;
        try {
            const leaves = app.workspace
                .getLeavesOfType("markdown")
                .filter((leaf) => isMainWorkspaceMarkdownLeaf(leaf));
            let sawModeChange = false;
            for (const leaf of leaves) {
                const view = leaf.view;
                if (!(view instanceof MarkdownView))
                    continue;
                const mode = (_a = view.getMode) === null || _a === void 0 ? void 0 : _a.call(view);
                if (mode !== "source" && mode !== "preview")
                    continue;
                const prev = state.markdownLeafModeSnapshot.get(leaf);
                if (prev !== mode) {
                    state.markdownLeafModeSnapshot.set(leaf, mode);
                    if (prev)
                        sawModeChange = true;
                }
                const sourcePath = view.file instanceof TFile ? view.file.path : "";
                const liveViewData = typeof view.getViewData === "function"
                    ? String((_b = view.getViewData()) !== null && _b !== void 0 ? _b : "")
                    : "";
                const signature = `${sourcePath}|${computeContentSignature(liveViewData)}`;
                const prevSignature = state.markdownLeafContentSnapshot.get(leaf);
                if (prevSignature !== signature) {
                    state.markdownLeafContentSnapshot.set(leaf, signature);
                    if (prevSignature)
                        sawModeChange = true;
                }
            }
            if (sawModeChange) {
                scheduleRefresh(40);
            }
        }
        catch (e) {
            log.swallow("scan markdown mode changes", e);
        }
    };
    scanModes();
    state.readingModeWatcherInterval = window.setInterval(scanModes, 180);
    registerInterval(state.readingModeWatcherInterval);
}
