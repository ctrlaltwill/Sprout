/**
 * @file src/views/study-assistant/view/study-assistant-view.ts
 * @summary Module for study assistant view.
 *
 * @exports
 *  - SproutStudyAssistantView
 */

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type LearnKitPlugin from "../../../main";
import { VIEW_TYPE_STUDY_ASSISTANT } from "../../../platform/core/constants";
import { SproutAssistantPopup } from "../popup/assistant-popup";

export class SproutStudyAssistantView extends ItemView {
  plugin: LearnKitPlugin;
  private popup: SproutAssistantPopup;

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.popup = new SproutAssistantPopup(plugin);
  }

  getViewType(): string {
    return VIEW_TYPE_STUDY_ASSISTANT;
  }

  getDisplayText(): string {
    return "Open companion widget";
  }

  getIcon(): string {
    return "learnkit-widget-assistant";
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("sprout", "learnkit-study-assistant-root");
    this.popup.mountEmbedded(this.contentEl);
    this.popup.onFileOpen(this.app.workspace.getActiveFile());
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.popup.unmountEmbedded();
    return Promise.resolve();
  }

  onRefresh(): void {
    this.popup.refresh();
  }

  onFileOpen(file: TFile | null): void {
    this.popup.onFileOpen(file);
  }
}
