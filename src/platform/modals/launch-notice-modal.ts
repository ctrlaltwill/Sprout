/**
 * @file src/platform/modals/launch-notice-modal.ts
 * @summary Module for launch notice modal.
 *
 * @exports
 *  - LaunchNoticeModal
 */

import { Modal, setIcon, type App } from "obsidian";
import type LearnKitPlugin from "../../main";
import { t } from "../translations/translator";
import { scopeModalToWorkspace, setModalTitle } from "./modal-utils";
import { setCssProps } from "../core/ui";

export class LaunchNoticeModal extends Modal {
  private readonly plugin: LearnKitPlugin;
  private doNotShowAgain = false;
  private persisted = false;

  constructor(app: App, plugin: LearnKitPlugin) {
    super(app);
    this.plugin = plugin;
  }

  override onOpen(): void {
    const tx = (token: string, fallback: string) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);

    setModalTitle(this, tx("ui.launchNotice.title", "LearnKit 1.1.0"));
    this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "sprout");
    setCssProps(this.containerEl, "z-index", "2147483000");
    this.modalEl.addClass("lk-modals", "learnkit-bulk-edit-panel");
    setCssProps(this.modalEl, "z-index", "2147483001");
    scopeModalToWorkspace(this);
    this.contentEl.addClass("learnkit-bulk-edit-content");

    this.contentEl.empty();

    const contentInner = this.contentEl.createDiv({
      cls: "learnkit-guide-content-inner learnkit-guide-content-inner learnkit-guide-content-inner--snap learnkit-guide-content-inner--snap",
    });
    const body = contentInner.createDiv({ cls: "learnkit-guide-body learnkit-guide-body markdown-rendered" });

    const title = body.createEl("h1", { text: "A message from the developer" });
    title.addClass("learnkit-guide-snap-heading");

    const introHeading = body.createEl("h2", { text: "Thank you" });
    introHeading.addClass("learnkit-guide-snap-heading");
    body.createEl("p", {
      text: tx(
        "ui.launchNotice.body",
        "Thank you for using Sprout. I have thoroughly enjoyed building this over the last few months, and I am excited to release version 1.1.0.",
      ),
    });
    body.createEl("p", {
      text: "Version 1.1.0 is our biggest update so far. It introduces companion, our AI learning companion, with a bring-your-own-key model. This model allows it to be included for all users and not locked behind subscriptions or paywalls.",
    });

    const setupHeading = body.createEl("h2", { text: "Getting started with companion" });
    setupHeading.addClass("learnkit-guide-snap-heading");
    const setupIntro = body.createEl("p");
    setupIntro.setText("Companion is not ready out of the box. You will need to connect an AI provider first.");

    const setupList = body.createEl("ol", { cls: "" });
    setupList.createEl("li", { text: "Open sprout settings and go to companion." });
    setupList.createEl("li", { text: "Choose your provider. It works with free providers (for example, google and openrouter) and premium providers (for example, anthropic and openai)." });
    setupList.createEl("li", { text: "Choose the AI model from the provider that you want to use. This updates dynamically, and some models may return errors. If this happens, try a different model or raise an issue on GitHub." });
    setupList.createEl("li", { text: "Paste your API key." });
    setupList.createEl("li", { text: "Open companion from the command palette using 'open study companion widget', or from the companion modal button in the bottom-right of your notes. You can adjust this button's visibility in settings." });

    const freeSetupHeading = body.createEl("h2", { text: "Free setup recommendation" });
    freeSetupHeading.addClass("learnkit-guide-snap-heading");
    const freeSetupList = body.createEl("ol", { cls: "" });
    freeSetupList.createEl("li", { text: "Create an account at openrouter.ai. A free plan is available." });
    freeSetupList.createEl("li", { text: "Generate an API key in your openrouter dashboard." });
    freeSetupList.createEl("li", { text: "In sprout settings, set provider to openrouter." });
    freeSetupList.createEl("li", { text: "We recommend setting the model to auto router." });
    freeSetupList.createEl("li", { text: "Paste your API key." });
    freeSetupList.createEl("li", { text: "You are ready to start using companion!" });

    const securityHeading = body.createEl("h2", { text: "API key security" });
    const configPath = `${this.app.vault.configDir}/plugins/sprout/data.json`;
    securityHeading.addClass("learnkit-guide-snap-heading");
    body.createEl("p", {
      text: `Your API keys are stored in local plugin data files (${configPath}). If you use Git in your vault, make sure plugin data files are ignored in .gitignore before pushing to GitHub. If you do not sync that folder with Git, this is not an issue.`,
    });

    const changesHeading = body.createEl("h2", { text: "Other changes" });
    changesHeading.addClass("learnkit-guide-snap-heading");
    const changesList = body.createEl("ul", { cls: "" });
    changesList.createEl("li", { text: "Improved reading view rendering and consistency." });
    changesList.createEl("li", { text: "Grading duration visibility – can be turned on in settings, allowing you to see the duration between reviews." });
    changesList.createEl("li", { text: "Improved image occlusion editing, including ocr-powered auto-masking." });
    changesList.createEl("li", { text: "General quality-of-life improvements." });

    const closingHeading = body.createEl("h2", { text: "From" });
    closingHeading.addClass("learnkit-guide-snap-heading");
    body.createEl("p", {
      text: "There may be teething issues as 1.1.0 rolls out. Please report bugs and feedback on GitHub so we can improve quickly.",
    });
    body.createEl("p", {
      text: "We remain committed to keeping sprout open source and accessible.",
    });
    body.createEl("p", {
      text: "If sprout is helping you, please share it with friends who might benefit too. Thank you again for being here.",
    });

    const signoff = body.createEl("p", {
      text: "Will (ctrlaltwill) \ndeveloper, sprout",
    });
    setCssProps(signoff, "white-space", "pre-line");

    const footer = body.createDiv({ cls: "flex items-center justify-end gap-4 lk-modal-footer" });

    const checkboxRow = footer.createEl("label", { cls: "flex items-center gap-2" });
    setCssProps(checkboxRow, {
      "margin-right": "auto",
      color: "var(--text-muted)",
    });
    const checkbox = checkboxRow.createEl("input", { attr: { type: "checkbox" } });
    setCssProps(checkbox, {
      "accent-color": "var(--text-muted)",
      "background-color": "var(--background-modifier-form-field)",
      "border-color": "var(--background-modifier-border)",
      color: "var(--text-normal)",
    });
    checkbox.addEventListener("change", () => {
      this.doNotShowAgain = checkbox.checked;
    });
    checkboxRow.createSpan({
      text: tx("ui.launchNotice.checkbox", "Do not show again"),
    });

    const releaseNotesBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": "Open release notes" },
    });
    const releaseIcon = releaseNotesBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(releaseIcon, "file-text");
    releaseNotesBtn.createSpan({ text: "Release notes" });
    releaseNotesBtn.addEventListener("click", () => {
      window.open("https://github.com/ctrlaltwill/Sprout/releases", "_blank", "noopener,noreferrer");
    });

    const settingsBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": "Open sprout settings" },
    });
    const settingsIcon = settingsBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(settingsIcon, "settings");
    settingsBtn.createSpan({ text: "Settings" });
    settingsBtn.addEventListener("click", () => {
      void this.plugin.openSettingsTab(false, "settings");
      this.close();
    });

    const closeBtn = footer.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar inline-flex items-center gap-2 h-9 px-3 text-sm",
      attr: { type: "button", "aria-label": tx("ui.launchNotice.close", "Close") },
    });
    const closeIcon = closeBtn.createEl("span", { cls: "inline-flex items-center justify-center [&_svg]:size-4" });
    setIcon(closeIcon, "x");
    closeBtn.createSpan({ text: tx("ui.launchNotice.close", "Close") });
    closeBtn.addEventListener("click", () => this.close());
  }

  override onClose(): void {
    this.containerEl.removeClass("lk-modal-container", "lk-modal-dim", "sprout");
    this.modalEl.removeClass("lk-modals", "learnkit-bulk-edit-panel");
    this.contentEl.removeClass("learnkit-bulk-edit-content");
    this.contentEl.empty();
    void this.persistPreference();
  }

  private async persistPreference(): Promise<void> {
    if (this.persisted || !this.doNotShowAgain) return;
    this.persisted = true;
    this.plugin.settings.general.showLaunchNoticeModal = false;
    await this.plugin.saveAll();
  }
}
