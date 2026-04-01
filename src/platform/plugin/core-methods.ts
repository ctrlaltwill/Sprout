import {
  Notice,
  TFile,
  MarkdownView,
  Platform,
  type Editor,
  type ItemView,
  type WorkspaceLeaf,
} from "obsidian";
import { createRoot } from "react-dom/client";
import React from "react";

import { LearnKitPluginBase } from "./plugin-base";
import type { FlashcardType } from "../core/utils";
import { clamp } from "../core/utils";
import { log } from "../core/logger";
import { getBasecoatApi, patchBasecoatNullGuards } from "../core/basecoat";
import { migrateSettingsInPlace } from "../../views/settings/config/settings-migration";
import { normaliseSettingsInPlace } from "../../views/settings/config/settings-normalisation";
import {
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_STUDY_ASSISTANT,
} from "../core/constants";
import { initButtonTooltipDefaults } from "../core/tooltip-defaults";
import {
  applyClozeShortcutToEditor,
  registerEditorContextMenu,
  registerMarkdownSourceClozeShortcuts,
} from "../editor/flashcard-editor";
import { CardCreatorModal } from "../modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "../modals/image-occlusion-creator-modal";
import { t } from "../translations/translator";
import {
  computeContentSignature,
  getMarkdownLeafSource,
  isMainWorkspaceMarkdownLeaf,
  refreshReadingViewMarkdownLeaves,
  scheduleReadingViewRefresh,
  startMarkdownModeWatcher,
  type ReadingRefreshState,
} from "../../views/reading/reading-refresh-runtime";
import { checkForVersionUpgrade } from "../core/version-manager";
import { WhatsNewModal } from "../modals/whats-new-modal";

export function installCorePluginMethods(pluginClass: typeof LearnKitPluginBase): void {
  Object.assign(pluginClass.prototype, {
    _addCommand(this: LearnKitPluginBase, id: string, name: string, callback: () => void | Promise<void>) {
      this.addCommand({ id, name, callback });
    },

    _tx(this: LearnKitPluginBase, token: string, fallback: string, vars?: Record<string, string | number>) {
      return t(this.settings?.general?.interfaceLanguage, token, fallback, vars);
    },

    refreshAssistantPopupFromSettings(this: LearnKitPluginBase): void {
      const activeFile = this.app.workspace.getActiveFile();
      if (this.settings?.studyAssistant?.enabled) {
        this._assistantPopup?.mount();
      }
      this._assistantPopup?.onActiveLeafChange();
      this._assistantPopup?.onFileOpen(activeFile);
      if (!this.settings?.studyAssistant?.enabled) {
        this._closeAllAssistantWidgetInstances();
      }
    },

    _closeAllAssistantWidgetInstances(this: LearnKitPluginBase): void {
      this.app.workspace
        .getLeavesOfType(VIEW_TYPE_STUDY_ASSISTANT)
        .forEach((leaf: WorkspaceLeaf) => {
          try {
            leaf.detach();
          } catch (e) {
            log.swallow("close assistant widget leaf", e);
          }
        });
    },

    async _openSingleTabView(this: LearnKitPluginBase, viewType: string, forceNew = false): Promise<WorkspaceLeaf> {
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
    },

    _initBasecoatRuntime(this: LearnKitPluginBase): void {
      const bc = getBasecoatApi();
      if (!bc) {
        log.warn("Basecoat API not found on window.basecoat (dropdowns may not work).");
        return;
      }

      try {
        patchBasecoatNullGuards(bc);
        bc.stop?.();
        bc.initAll?.();

        if (!Platform.isMobileApp) {
          bc.start?.();
          this._basecoatStarted = true;
        } else {
          this._basecoatStarted = false;
        }

        this._basecoatApi = bc;
        log.info(`Basecoat initAll OK${Platform.isMobileApp ? " (observer disabled on mobile)" : " + start OK"}`);
      } catch (e) {
        log.warn("Basecoat init failed", e);
      }
    },

    _stopBasecoatRuntime(this: LearnKitPluginBase): void {
      if (!this._basecoatStarted) return;
      try {
        const bc = getBasecoatApi();
        bc?.stop?.();
      } catch (e) {
        log.swallow("stop basecoat runtime", e);
      }
      this._basecoatStarted = false;
    },

    _isActiveHiddenViewType(this: LearnKitPluginBase): boolean {
      const ws = this.app.workspace;
      const activeLeaf = ws?.getMostRecentLeaf?.() ?? null;
      const viewType = activeLeaf?.view?.getViewType?.();
      return viewType ? this._hideStatusBarViewTypes.has(viewType) : false;
    },

    _updateStatusBarVisibility(this: LearnKitPluginBase, leaf: WorkspaceLeaf | null): void {
      const viewType = leaf?.view?.getViewType?.();
      const hide = viewType
        ? this._hideStatusBarViewTypes.has(viewType)
        : this._isActiveHiddenViewType();
      document.body.classList.toggle("sprout-hide-status-bar", hide);
    },

    _migrateSettingsInPlace(this: LearnKitPluginBase): void {
      migrateSettingsInPlace(this.settings as Record<string, unknown>);
    },

    _normaliseSettingsInPlace(this: LearnKitPluginBase): void {
      normaliseSettingsInPlace(this.settings);
    },

    _applySproutThemeAccentOverride(this: LearnKitPluginBase): void {
      const raw = String(this.settings?.general?.themeAccentOverride ?? "").trim();
      const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw);
      if (isHex) {
        document.body.style.setProperty("--sprout-theme-accent-override", raw);
        return;
      }
      document.body.style.removeProperty("--sprout-theme-accent-override");
    },

    _applySproutThemePreset(this: LearnKitPluginBase): void {
      const preset = String(this.settings?.general?.themePreset ?? "glass").trim() || "glass";
      document.body.setAttribute("data-sprout-theme-preset", preset);
    },

    _applySproutZoom(this: LearnKitPluginBase, value: number): void {
      const next = clamp(Number(value || 1), 0.8, 1.8);
      this._sproutZoomValue = next;
      document.body.style.setProperty("--sprout-leaf-zoom", next.toFixed(3));
    },

    _queueSproutZoomSave(this: LearnKitPluginBase): void {
      if (this._sproutZoomSaveTimer != null) window.clearTimeout(this._sproutZoomSaveTimer);
      this._sproutZoomSaveTimer = window.setTimeout(() => {
        this._sproutZoomSaveTimer = null;
        void this.saveAll();
      }, 250);
    },

    _registerSproutPinchZoom(this: LearnKitPluginBase): void {
      this._applySproutZoom(this.settings.general.workspaceContentZoom ?? 1);

      this.registerDomEvent(
        document,
        "wheel",
        (ev: WheelEvent) => {
          if (!ev.ctrlKey) return;

          const target = ev.target as HTMLElement | null;
          if (!target) return;

          if (target.closest(".modal-container, .menu, .popover, .suggestion-container")) return;

          const sproutEl = target.closest<HTMLElement>(
            ".workspace-leaf-content.sprout, .sprout-widget.sprout",
          );
          if (!sproutEl) return;

          ev.preventDefault();
          ev.stopPropagation();

          const factor = Math.exp(-ev.deltaY * 0.006);
          const next = clamp(this._sproutZoomValue * factor, 0.8, 1.8);
          if (Math.abs(next - this._sproutZoomValue) < 0.001) return;

          this._applySproutZoom(next);
          this.settings.general.workspaceContentZoom = Number(next.toFixed(3));
          this._queueSproutZoomSave();
        },
        { capture: true, passive: false },
      );
    },

    _ensureSingleLeafOfType(this: LearnKitPluginBase, viewType: string): WorkspaceLeaf | null {
      const leaves = this.app.workspace.getLeavesOfType(viewType);
      if (!leaves.length) return null;

      const [keep, ...extras] = leaves;
      for (const l of extras) {
        try {
          l.detach();
        } catch (e) {
          log.swallow("detach extra leaf", e);
        }
      }

      return keep;
    },

    _destroyRibbonIcons(this: LearnKitPluginBase): void {
      for (const el of this._ribbonEls) {
        try {
          el.remove();
        } catch (e) {
          log.swallow("remove ribbon icon", e);
        }
      }
      this._ribbonEls = [];
    },

    _checkAndShowWhatsNewModal(this: LearnKitPluginBase): void {
      try {
        const currentVersion = this.manifest.version;
        const { shouldShow, version } = checkForVersionUpgrade(currentVersion);

        if (shouldShow && version) {
          this._showWhatsNewModal(version);
        }
      } catch (e) {
        log.swallow("check version upgrade", e);
      }
    },

    _showWhatsNewModal(this: LearnKitPluginBase, version: string): void {
      this._closeWhatsNewModal();

      const container = document.body.createDiv();
      this._whatsNewModalContainer = container;

      const root = createRoot(container);
      this._whatsNewModalRoot = root;

      const modalElement = React.createElement(WhatsNewModal, {
        version,
        onClose: () => this._closeWhatsNewModal(),
      });

      root.render(modalElement);
    },

    _closeWhatsNewModal(this: LearnKitPluginBase): void {
      if (this._whatsNewModalRoot) {
        this._whatsNewModalRoot.unmount();
        this._whatsNewModalRoot = null;
      }
      if (this._whatsNewModalContainer) {
        this._whatsNewModalContainer.remove();
        this._whatsNewModalContainer = null;
      }
    },

    _getActiveMarkdownFile(this: LearnKitPluginBase): TFile | null {
      const f = this.app.workspace.getActiveFile();
      return f instanceof TFile ? f : null;
    },

    _ensureEditingNoteEditor(this: LearnKitPluginBase): { view: MarkdownView; editor: Editor } | null {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return null;
      if (view.getMode() !== "source") return null;
      const editor = view.editor;
      if (!editor) return null;
      return { view, editor };
    },

    _applyClozeShortcutToEditor(this: LearnKitPluginBase, editor: Editor, clozeIndex = 1): void {
      applyClozeShortcutToEditor(editor, clozeIndex);
    },

    _registerMarkdownSourceClozeShortcuts(this: LearnKitPluginBase): void {
      registerMarkdownSourceClozeShortcuts({
        app: this.app,
        registerDomEvent: (type, callback, options) => {
          this.registerDomEvent(document, type, callback as (this: HTMLElement, ev: KeyboardEvent) => void, options);
        },
        applyClozeShortcut: (editor: Editor, clozeIndex: number) => {
          this._applyClozeShortcutToEditor(editor, clozeIndex);
        },
      });
    },

    openAddFlashcardModal(this: LearnKitPluginBase, forcedType?: FlashcardType): void {
      const ok = this._ensureEditingNoteEditor();
      if (!ok) {
        new Notice(this._tx("ui.main.notice.mustEditNote", "Must be editing a note to add a flashcard"));
        return;
      }

      if (forcedType === "io") {
        new ImageOcclusionCreatorModal(this.app, this).open();
      } else {
        new CardCreatorModal(this.app, this, forcedType).open();
      }
    },

    _registerEditorContextMenu(this: LearnKitPluginBase): void {
      registerEditorContextMenu({
        app: this.app,
        registerEvent: this.registerEvent.bind(this),
        tx: this._tx.bind(this),
        openAddFlashcardModal: (forcedType?: FlashcardType) => {
          this.openAddFlashcardModal(forcedType);
        },
      });
    },

    async syncBank(this: LearnKitPluginBase): Promise<void> {
      await this._runSync();
    },

    refreshAllViews(this: LearnKitPluginBase): void {
      this._refreshOpenViews();
    },

    notifyWidgetCardsSynced(this: LearnKitPluginBase): void {
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET).forEach((leaf: WorkspaceLeaf) => {
        const view = leaf.view as ItemView & { onCardsSynced?(): void; onRefresh?(): void };
        if (typeof view.onCardsSynced === "function") {
          view.onCardsSynced();
          return;
        }
        view.onRefresh?.();
      });
    },

    async refreshReadingViewMarkdownLeaves(this: LearnKitPluginBase): Promise<void> {
      await refreshReadingViewMarkdownLeaves(this.app);
    },

    _scheduleReadingViewRefresh(this: LearnKitPluginBase, delayMs = 90): void {
      const state: ReadingRefreshState = {
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
    },

    _isMainWorkspaceMarkdownLeaf(this: LearnKitPluginBase, leaf: WorkspaceLeaf): boolean {
      return isMainWorkspaceMarkdownLeaf(leaf);
    },

    _computeContentSignature(this: LearnKitPluginBase, text: string): string {
      return computeContentSignature(text);
    },

    async _getMarkdownLeafSource(
      this: LearnKitPluginBase,
      leaf: WorkspaceLeaf,
    ): Promise<{ sourceContent: string; sourcePath: string }> {
      return getMarkdownLeafSource(this.app, leaf);
    },

    _startMarkdownModeWatcher(this: LearnKitPluginBase): void {
      const state: ReadingRefreshState = {
        readingViewRefreshTimer: this._readingViewRefreshTimer,
        readingModeWatcherInterval: this._readingModeWatcherInterval,
        markdownLeafModeSnapshot: this._markdownLeafModeSnapshot,
        markdownLeafContentSnapshot: this._markdownLeafContentSnapshot,
      };
      startMarkdownModeWatcher({
        app: this.app,
        state,
        registerInterval: this.registerInterval.bind(this),
        scheduleRefresh: (delayMs?: number) => {
          this._scheduleReadingViewRefresh(delayMs);
        },
      });
      this._readingModeWatcherInterval = state.readingModeWatcherInterval;
    },

    _refreshOpenViews(this: LearnKitPluginBase): void {
      for (const type of this._refreshableViewTypes) {
        this.app.workspace.getLeavesOfType(type).forEach((leaf: WorkspaceLeaf) => {
          const view = leaf.view as ItemView & { onRefresh?(): void };
          view.onRefresh?.();
        });
      }
    },

    _initButtonTooltipDefaults(this: LearnKitPluginBase): void {
      this.register(initButtonTooltipDefaults());
    },
  });
}
