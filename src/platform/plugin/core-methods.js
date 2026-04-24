/**
 * @file src/platform/plugin/core-methods.ts
 * @summary Module for core methods.
 *
 * @exports
 *  - WithCoreMethods
 */
import { Notice, TFile, MarkdownView, Platform, } from "obsidian";
import { clamp } from "../core/utils";
import { log } from "../core/logger";
import { getBasecoatApi, patchBasecoatNullGuards } from "../core/basecoat";
import { migrateSettingsInPlace } from "../../views/settings/config/settings-migration";
import { normaliseSettingsInPlace } from "../../views/settings/config/settings-normalisation";
import { VIEW_TYPE_WIDGET, VIEW_TYPE_STUDY_ASSISTANT, } from "../core/constants";
import { initButtonTooltipDefaults } from "../core/tooltip-defaults";
import { applyClozeShortcutToEditor, registerEditorContextMenu, registerMarkdownSourceClozeShortcuts, } from "../editor/flashcard-editor";
import { CardCreatorModal } from "../modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "../modals/image-occlusion-creator-modal";
import { t } from "../translations/translator";
import { computeContentSignature, getMarkdownLeafSource, isMainWorkspaceMarkdownLeaf, refreshReadingViewMarkdownLeaves, scheduleReadingViewRefresh, startMarkdownModeWatcher, } from "../../views/reading/reading-refresh-runtime";
export function WithCoreMethods(Base) {
    return class WithCoreMethods extends Base {
        _addCommand(id, name, callback) {
            this.addCommand({ id, name, callback });
        }
        _tx(token, fallback, vars) {
            var _a, _b;
            return t((_b = (_a = this.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
        }
        refreshAssistantPopupFromSettings() {
            var _a, _b, _c, _d, _e, _f, _g;
            const activeFile = this.app.workspace.getActiveFile();
            if ((_b = (_a = this.settings) === null || _a === void 0 ? void 0 : _a.studyAssistant) === null || _b === void 0 ? void 0 : _b.enabled) {
                (_c = this._assistantPopup) === null || _c === void 0 ? void 0 : _c.mount();
            }
            (_d = this._assistantPopup) === null || _d === void 0 ? void 0 : _d.onActiveLeafChange();
            (_e = this._assistantPopup) === null || _e === void 0 ? void 0 : _e.onFileOpen(activeFile);
            if (!((_g = (_f = this.settings) === null || _f === void 0 ? void 0 : _f.studyAssistant) === null || _g === void 0 ? void 0 : _g.enabled)) {
                this._closeAllAssistantWidgetInstances();
            }
        }
        _closeAllAssistantWidgetInstances() {
            this.app.workspace
                .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
                .forEach((leaf) => {
                try {
                    leaf.detach();
                }
                catch (e) {
                    log.swallow("close assistant widget leaf", e);
                }
            });
        }
        async _openSingleTabView(viewType, forceNew = false) {
            if (!forceNew) {
                const existing = this._ensureSingleLeafOfType(viewType);
                if (existing) {
                    void this.app.workspace.revealLeaf(existing);
                    return existing;
                }
            }
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({ type: viewType, active: true });
            void this.app.workspace.revealLeaf(leaf);
            return leaf;
        }
        _initBasecoatRuntime() {
            var _a, _b, _c;
            const bc = getBasecoatApi();
            if (!bc) {
                log.warn("Basecoat API not found on window.basecoat (dropdowns may not work).");
                return;
            }
            try {
                patchBasecoatNullGuards(bc);
                (_a = bc.stop) === null || _a === void 0 ? void 0 : _a.call(bc);
                (_b = bc.initAll) === null || _b === void 0 ? void 0 : _b.call(bc);
                if (!Platform.isMobileApp) {
                    (_c = bc.start) === null || _c === void 0 ? void 0 : _c.call(bc);
                    this._basecoatStarted = true;
                }
                else {
                    this._basecoatStarted = false;
                }
                this._basecoatApi = bc;
                log.info(`Basecoat initAll OK${Platform.isMobileApp ? " (observer disabled on mobile)" : " + start OK"}`);
            }
            catch (e) {
                log.warn("Basecoat init failed", e);
            }
        }
        _stopBasecoatRuntime() {
            var _a;
            if (!this._basecoatStarted)
                return;
            try {
                const bc = getBasecoatApi();
                (_a = bc === null || bc === void 0 ? void 0 : bc.stop) === null || _a === void 0 ? void 0 : _a.call(bc);
            }
            catch (e) {
                log.swallow("stop basecoat runtime", e);
            }
            this._basecoatStarted = false;
        }
        _isActiveHiddenViewType() {
            var _a, _b, _c, _d;
            const ws = this.app.workspace;
            const activeLeaf = (_b = (_a = ws === null || ws === void 0 ? void 0 : ws.getMostRecentLeaf) === null || _a === void 0 ? void 0 : _a.call(ws)) !== null && _b !== void 0 ? _b : null;
            const viewType = (_d = (_c = activeLeaf === null || activeLeaf === void 0 ? void 0 : activeLeaf.view) === null || _c === void 0 ? void 0 : _c.getViewType) === null || _d === void 0 ? void 0 : _d.call(_c);
            return viewType ? this._hideStatusBarViewTypes.has(viewType) : false;
        }
        _updateStatusBarVisibility(leaf) {
            var _a, _b;
            const viewType = (_b = (_a = leaf === null || leaf === void 0 ? void 0 : leaf.view) === null || _a === void 0 ? void 0 : _a.getViewType) === null || _b === void 0 ? void 0 : _b.call(_a);
            const hide = viewType
                ? this._hideStatusBarViewTypes.has(viewType)
                : this._isActiveHiddenViewType();
            document.body.classList.toggle("learnkit-hide-status-bar", hide);
        }
        _migrateSettingsInPlace() {
            migrateSettingsInPlace(this.settings);
        }
        _normaliseSettingsInPlace() {
            normaliseSettingsInPlace(this.settings);
        }
        _applySproutThemeAccentOverride() {
            var _a, _b, _c;
            const raw = String((_c = (_b = (_a = this.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.themeAccentOverride) !== null && _c !== void 0 ? _c : "").trim();
            const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw);
            if (isHex) {
                document.body.style.setProperty("--learnkit-theme-accent-override", raw);
                return;
            }
            document.body.style.removeProperty("--learnkit-theme-accent-override");
        }
        _applySproutThemePreset() {
            var _a, _b, _c;
            const preset = String((_c = (_b = (_a = this.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.themePreset) !== null && _c !== void 0 ? _c : "glass").trim() || "glass";
            document.body.setAttribute("data-learnkit-theme-preset", preset);
        }
        _applySproutZoom(value) {
            const next = clamp(Number(value || 1), 0.8, 1.8);
            this._sproutZoomValue = next;
            document.body.style.setProperty("--learnkit-leaf-zoom", next.toFixed(3));
        }
        _queueSproutZoomSave() {
            if (this._sproutZoomSaveTimer != null)
                window.clearTimeout(this._sproutZoomSaveTimer);
            this._sproutZoomSaveTimer = window.setTimeout(() => {
                this._sproutZoomSaveTimer = null;
                void this.saveAll();
            }, 250);
        }
        _registerSproutPinchZoom() {
            var _a;
            this._applySproutZoom((_a = this.settings.general.workspaceContentZoom) !== null && _a !== void 0 ? _a : 1);
            this.registerDomEvent(document, "wheel", (ev) => {
                if (!ev.ctrlKey)
                    return;
                const target = ev.target;
                if (!target)
                    return;
                if (target.closest(".modal-container, .menu, .popover, .suggestion-container"))
                    return;
                const sproutEl = target.closest(".workspace-leaf-content.learnkit, .learnkit-widget.learnkit");
                if (!sproutEl)
                    return;
                ev.preventDefault();
                ev.stopPropagation();
                const factor = Math.exp(-ev.deltaY * 0.006);
                const next = clamp(this._sproutZoomValue * factor, 0.8, 1.8);
                if (Math.abs(next - this._sproutZoomValue) < 0.001)
                    return;
                this._applySproutZoom(next);
                this.settings.general.workspaceContentZoom = Number(next.toFixed(3));
                this._queueSproutZoomSave();
            }, { capture: true, passive: false });
        }
        _ensureSingleLeafOfType(viewType) {
            const leaves = this.app.workspace.getLeavesOfType(viewType);
            if (!leaves.length)
                return null;
            const [keep, ...extras] = leaves;
            for (const l of extras) {
                try {
                    l.detach();
                }
                catch (e) {
                    log.swallow("detach extra leaf", e);
                }
            }
            return keep;
        }
        _destroyRibbonIcons() {
            for (const el of this._ribbonEls) {
                try {
                    el.remove();
                }
                catch (e) {
                    log.swallow("remove ribbon icon", e);
                }
            }
            this._ribbonEls = [];
        }
        _getActiveMarkdownFile() {
            const f = this.app.workspace.getActiveFile();
            return f instanceof TFile ? f : null;
        }
        _ensureEditingNoteEditor() {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view)
                return null;
            if (view.getMode() !== "source")
                return null;
            const editor = view.editor;
            if (!editor)
                return null;
            return { view, editor };
        }
        _applyClozeShortcutToEditor(editor, clozeIndex = 1) {
            applyClozeShortcutToEditor(editor, clozeIndex);
        }
        _registerMarkdownSourceClozeShortcuts() {
            registerMarkdownSourceClozeShortcuts({
                app: this.app,
                registerDomEvent: (type, callback, options) => {
                    this.registerDomEvent(document, type, callback, options);
                },
                applyClozeShortcut: (editor, clozeIndex) => {
                    this._applyClozeShortcutToEditor(editor, clozeIndex);
                },
            });
        }
        openAddFlashcardModal(forcedType) {
            const ok = this._ensureEditingNoteEditor();
            if (!ok) {
                new Notice(this._tx("ui.main.notice.mustEditNote", "Must be editing a note to add a flashcard"));
                return;
            }
            if (forcedType === "io") {
                new ImageOcclusionCreatorModal(this.app, this).open();
            }
            else {
                new CardCreatorModal(this.app, this, forcedType).open();
            }
        }
        _registerEditorContextMenu() {
            registerEditorContextMenu({
                app: this.app,
                registerEvent: this.registerEvent.bind(this),
                tx: this._tx.bind(this),
                openAddFlashcardModal: (forcedType) => {
                    this.openAddFlashcardModal(forcedType);
                },
            });
        }
        async syncBank() {
            await this._runSync();
        }
        refreshAllViews() {
            this._refreshOpenViews();
        }
        notifyWidgetCardsSynced() {
            this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET).forEach((leaf) => {
                var _a;
                const view = leaf.view;
                if (typeof view.onCardsSynced === "function") {
                    view.onCardsSynced();
                    return;
                }
                (_a = view.onRefresh) === null || _a === void 0 ? void 0 : _a.call(view);
            });
        }
        async refreshReadingViewMarkdownLeaves() {
            await refreshReadingViewMarkdownLeaves(this.app);
        }
        _scheduleReadingViewRefresh(delayMs = 90) {
            const state = {
                readingViewRefreshTimer: this._readingViewRefreshTimer,
                readingModeWatcherInterval: this._readingModeWatcherInterval,
                markdownLeafModeSnapshot: this._markdownLeafModeSnapshot,
                markdownLeafContentSnapshot: this._markdownLeafContentSnapshot,
            };
            scheduleReadingViewRefresh({
                state,
                delayMs,
                refresh: () => {
                    void this.refreshReadingViewMarkdownLeaves();
                },
            });
            this._readingViewRefreshTimer = state.readingViewRefreshTimer;
        }
        _isMainWorkspaceMarkdownLeaf(leaf) {
            return isMainWorkspaceMarkdownLeaf(leaf);
        }
        _computeContentSignature(text) {
            return computeContentSignature(text);
        }
        async _getMarkdownLeafSource(leaf) {
            return getMarkdownLeafSource(this.app, leaf);
        }
        _startMarkdownModeWatcher() {
            const state = {
                readingViewRefreshTimer: this._readingViewRefreshTimer,
                readingModeWatcherInterval: this._readingModeWatcherInterval,
                markdownLeafModeSnapshot: this._markdownLeafModeSnapshot,
                markdownLeafContentSnapshot: this._markdownLeafContentSnapshot,
            };
            startMarkdownModeWatcher({
                app: this.app,
                state,
                registerInterval: this.registerInterval.bind(this),
                scheduleRefresh: (delayMs) => {
                    this._scheduleReadingViewRefresh(delayMs);
                },
            });
            this._readingModeWatcherInterval = state.readingModeWatcherInterval;
        }
        _refreshOpenViews() {
            for (const type of this._refreshableViewTypes) {
                this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
                    var _a;
                    const view = leaf.view;
                    (_a = view.onRefresh) === null || _a === void 0 ? void 0 : _a.call(view);
                });
            }
        }
        _initButtonTooltipDefaults() {
            this.register(initButtonTooltipDefaults());
        }
    };
}
