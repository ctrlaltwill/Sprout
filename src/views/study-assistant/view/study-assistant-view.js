/**
 * @file src/views/study-assistant/view/study-assistant-view.ts
 * @summary Module for study assistant view.
 *
 * @exports
 *  - SproutStudyAssistantView
 */
import { ItemView } from "obsidian";
import { VIEW_TYPE_STUDY_ASSISTANT } from "../../../platform/core/constants";
import { SproutAssistantPopup } from "../popup/assistant-popup";
export class SproutStudyAssistantView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.popup = new SproutAssistantPopup(plugin);
    }
    getViewType() {
        return VIEW_TYPE_STUDY_ASSISTANT;
    }
    getDisplayText() {
        return "Open companion widget";
    }
    getIcon() {
        return "learnkit-widget-assistant";
    }
    onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("sprout", "learnkit-study-assistant-root");
        this.popup.mountEmbedded(this.contentEl);
        this.popup.onFileOpen(this.app.workspace.getActiveFile());
        return Promise.resolve();
    }
    onClose() {
        this.popup.unmountEmbedded();
        return Promise.resolve();
    }
    onRefresh() {
        this.popup.refresh();
    }
    onFileOpen(file) {
        this.popup.onFileOpen(file);
    }
}
