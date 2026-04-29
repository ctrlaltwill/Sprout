/**
 * @file src/views/settings/settings-view.ts
 * @summary Custom Obsidian ItemView that renders Sprout settings inside the
 * workspace leaf (like Home, Analytics, Browser) rather than in the native
 * Obsidian settings modal. Uses the shared Sprout header, tab navigation,
 * and delegates individual tab rendering to the existing LearnKitSettingsTab
 * methods via a thin adapter layer.
 *
 * @exports
 *   - LearnKitSettingsView — ItemView subclass implementing the in-workspace settings view
 */

import { ItemView, setIcon, type WorkspaceLeaf, MarkdownRenderer, Component, TFile, normalizePath } from "obsidian";
import { type SproutHeader, createViewHeader } from "../../platform/core/header";
import { log } from "../../platform/core/logger";
import { AOS_CASCADE_STEP, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_SETTINGS } from "../../platform/core/constants";
import { placePopover, setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { SPROUT_HOME_CONTENT_SHELL_CLASS } from "../../platform/core/ui-classes";
import type LearnKitPlugin from "../../main";
import { LearnKitSettingsTab } from "./settings-tab";
import {
  getGuideCategories,
  getGuidePageDisplayLabel,
  getGuidePageIcon,
  getGuideTooltipLabel,
  loadGuidePages,
  orderGuidePagesByNavigation,
} from "./subpages/guide-content";
import {
  fetchGithubReleasePages,
  formatReleaseDate,
  readSupportMarkdown,
} from "./subpages/release-content";
import type { GuideCategory, GuidePage, ReleaseNotesPage } from "./subpages/types";
import { t } from "../../platform/translations/translator";
import { txCommon } from "../../platform/translations/ui-common";
import { getPluginDirCandidates } from "../../platform/core/identity";

export class LearnKitSettingsView extends ItemView {
  /**
   * Set by `openSettingsTab()` before creating the view so the first
   * render uses the requested tab instead of defaulting to "settings".
   */
  static pendingInitialTab: string | null = null;

  plugin: LearnKitPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  private _titleStripEl: HTMLElement | null = null;
  private _pageTitleEl: HTMLElement | null = null;
  private _titleStripTitleEl: HTMLElement | null = null;
  private _titleStripSubtitleEl: HTMLElement | null = null;
  private _titleStripTabBtnEls: Map<string, HTMLButtonElement> = new Map();
  private _contentShellEl: HTMLElement | null = null;

  /** Current active top-level settings tab. */
  private _activeTab = "settings";

  /** Current active sub-tab within the top-level Settings tab. */
  private _activeSettingsSubTab = "general";

  /** Active page in Release Notes nav. */
  private _activeReleasePage = "about-sprout";

  /** Active page in Guide nav. */
  private _activeGuidePage = "Home";

  /** Markdown renderer owner for release notes content. */
  private _releaseComponent: Component | null = null;

  /** In-memory release-page cache. */
  private _releasePagesCache: { pages: ReleaseNotesPage[]; ts: number } | null = null;

  /** Tab navigation button elements (for re-highlighting on tab switch). */
  private _tabBtnEls: Map<string, HTMLButtonElement> = new Map();

  /** Tab content container. */
  private _tabContentEl: HTMLElement | null = null;

  /** Window-level listener cleanups registered by active tab content. */
  private _windowListenerCleanups: Array<() => void> = [];
  private _guideDropdownPortal: HTMLDivElement | null = null;

  /**
   * Lazily-created SettingsTab adapter used to call the existing render methods.
    * We create a real LearnKitSettingsTab instance but never register it with
   * Obsidian — it is purely used as a rendering helper.
   */
    private _settingsTabAdapter: LearnKitSettingsTab | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SETTINGS;
  }

  getDisplayText() {
    return t(this.plugin.settings?.general?.interfaceLanguage, "ui.view.settings.title", "Settings");
  }

  getIcon() {
    return "settings";
  }

  async onOpen() {
    const pending = LearnKitSettingsView.pendingInitialTab;
    if (pending) {
      LearnKitSettingsView.pendingInitialTab = null;
      this._activeTab = pending;
    }
    this.render();
    await Promise.resolve();
  }

  async onClose() {
    try {
      this._header?.dispose?.();
      this._releaseComponent?.unload?.();
    } catch (e) { log.swallow("dispose settings header", e); }
    this._clearWindowListeners();
    this._guideDropdownPortal?.remove();
    this._guideDropdownPortal = null;
    this._header = null;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    this._contentShellEl = null;
    this._releaseComponent = null;
    this._settingsTabAdapter = null;
    await Promise.resolve();
  }

  private _trackWindowListener(
    event: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    window.addEventListener(event, handler, options);
    this._windowListenerCleanups.push(() => {
      window.removeEventListener(event, handler, options as boolean | EventListenerOptions | undefined);
    });
  }

  private _clearWindowListeners() {
    this._pageTitleEl = null;
    const cleanups = this._windowListenerCleanups.splice(0, this._windowListenerCleanups.length);
    for (const dispose of cleanups) {
      try {
        dispose();
      } catch {
        // no-op
      }
    }
  }

  onRefresh() {
    // Intentionally empty. The settings view manages its own re-renders
    // via _softRerender() and _renderActiveTabContent(). Calling render()
    // here would tear down the entire DOM whenever any setting onChange
    // triggers refreshAllViews(), causing a jarring full-page refresh.
  }

  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-learnkit-wide", "1");
    else this.containerEl.removeAttribute("data-learnkit-wide");

    const root = this._rootEl;
    const strip = this._titleStripEl;
    if (!root && !strip) return;

    const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
    if (root) {
      setCssProps(root, "--lk-home-max-width", maxWidth);
      setCssProps(root, "--learnkit-settings-view-max-width", maxWidth);
    }
    if (strip) setCssProps(strip, "--lk-home-max-width", maxWidth);
  }

  private _ensureTitleStrip(root: HTMLElement): void {
    this._titleStripEl?.remove();
    this._titleStripTitleEl = null;
    this._titleStripSubtitleEl = null;
    this._titleStripTabBtnEls.clear();
    const frame = createTitleStripFrame({
      root,
      stripClassName: "lk-home-title-strip sprout-settings-title-strip",
    });
    const { strip, right, title, subtitle } = frame;

    const tx = (token: string, fallback: string) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);
    const tabs = [
      { id: "guide", label: tx("ui.topTabs.guide", "Guide"), icon: "book-open" },
      { id: "about", label: tx("ui.topTabs.about.releases", "Releases"), icon: "package" },
      { id: "settings", label: tx("ui.topTabs.settings", "Settings"), icon: "settings" },
    ];

    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "learnkit-btn-toolbar learnkit-settings-title-tab-btn learnkit-btn-outline-muted inline-flex items-center gap-2";
      btn.setAttribute("aria-label", tab.label);
      btn.setAttribute("aria-pressed", tab.id === this._activeTab ? "true" : "false");
      btn.setAttribute("data-tooltip-position", "bottom");

      const iconWrap = document.createElement("span");
      iconWrap.className = "learnkit-settings-title-tab-btn-icon inline-flex items-center justify-center";
      setIcon(iconWrap, tab.icon);
      btn.appendChild(iconWrap);

      const label = document.createElement("span");
      label.className = "learnkit-settings-title-tab-btn-label";
      label.textContent = tab.label;
      btn.appendChild(label);

      btn.addEventListener("click", () => {
        if (this._activeTab === tab.id) return;
        this._activeTab = tab.id;
        this._refreshActiveTab(false);
      });
      right.appendChild(btn);
      this._titleStripTabBtnEls.set(tab.id, btn);
    }

    this._titleStripEl = strip;
    this._titleStripTitleEl = title;
    this._titleStripSubtitleEl = subtitle;
    this._refreshTitleStrip();
  }

  private _settingsTitleText(): string {
    const tx = (token: string, fallback: string) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);
    if (this._activeTab === "guide") return tx("ui.topTabs.guide", "Guide");
    if (this._activeTab === "about") return tx("ui.topTabs.about.releases", "Releases");
    return tx("ui.view.settings.title", "Settings");
  }

  private _settingsSubtitleText(): string {
    const tx = (token: string, fallback: string) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);
    if (this._activeTab === "guide") {
      return tx("ui.view.settings.subtitle.guide", "Learn how to use LearnKit effectively");
    }
    if (this._activeTab === "about") {
      return tx("ui.view.settings.subtitle.releaseNotes", "See what is new and recently improved");
    }
    return tx("ui.view.settings.subtitle.settings", "Customize your workflow and defaults");
  }

  private _refreshTitleStrip() {
    if (this._titleStripTitleEl) this._titleStripTitleEl.textContent = this._settingsTitleText();
    if (this._titleStripSubtitleEl) this._titleStripSubtitleEl.textContent = this._settingsSubtitleText();
    if (this._pageTitleEl) this._pageTitleEl.textContent = this._settingsTitleText();
    for (const [id, btn] of this._titleStripTabBtnEls) {
      const active = id === this._activeTab;
      btn.classList.toggle("is-active", active);
      btn.classList.toggle("learnkit-btn-outline-muted", !active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  // ── Settings tab adapter ────────────────────────────────────

  /**
   * Returns (or creates) a LearnKitSettingsTab instance that we use purely
   * as a container for render methods. Its `containerEl` is pointed at our
   * own content element so the Obsidian `Setting` helper works correctly.
   */
  private _getAdapter(): LearnKitSettingsTab {
    if (!this._settingsTabAdapter) {
      this._settingsTabAdapter = new LearnKitSettingsTab(this.app, this.plugin);
      this._settingsTabAdapter.onRequestRerender = () => this._renderActiveTabContent();
    }
    return this._settingsTabAdapter;
  }

  // ── Main render ─────────────────────────────────────────────

  private _animateTopLevelEntrance(): void {
    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    if (!animationsEnabled) return;

    const stages: Array<{ el: HTMLElement; delay: number }> = [];
    if (this._titleStripEl) stages.push({ el: this._titleStripEl, delay: 0 });
    if (this._contentShellEl) stages.push({ el: this._contentShellEl, delay: AOS_CASCADE_STEP });
    if (!stages.length) return;

    for (const { el } of stages) {
      el.classList.remove("learnkit-settings-top-enter", "learnkit-settings-top-enter");
      el.style.removeProperty("--learnkit-settings-enter-delay");
      // Remove AOS hooks on top stages so AOS cannot short-circuit title-strip motion.
      el.removeAttribute("data-aos");
      el.removeAttribute("data-aos-delay");
      el.removeAttribute("data-aos-duration");
      el.removeAttribute("data-aos-anchor-placement");
      el.classList.remove("aos-init", "aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
    }

    requestAnimationFrame(() => {
      for (const { el, delay } of stages) {
        if (!el.isConnected) continue;
        el.style.setProperty("--learnkit-settings-enter-delay", `${Math.max(0, delay)}ms`);
        // Force reflow so class re-add always restarts the keyframe.
        void el.offsetHeight;
        el.classList.add("learnkit-settings-top-enter", "learnkit-settings-top-enter");
      }
    });
  }

  render() {
    const root = this.contentEl;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    root.empty();

    this._tabBtnEls.clear();

    this._rootEl = root;
    const tx = (token: string, fallback: string) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);

    root.classList.add("learnkit-view-content", "learnkit-view-content",
      "learnkit-settings-view-root", "learnkit-settings-view-root",
    );

    this.containerEl.addClass("learnkit");
    this.setTitle?.(tx("ui.view.settings.title", "Settings"));
    this._ensureTitleStrip(root);

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    root.classList.toggle("learnkit-no-animate", !animationsEnabled);

    // ── Header ──
    if (!this._header) {
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyWidthMode(),
      });
    }

    this._header.install("settings");
    this._applyWidthMode();

    const contentShell = document.createElement("div");
    contentShell.className = `${SPROUT_HOME_CONTENT_SHELL_CLASS} learnkit-settings-content-shell`;
    root.appendChild(contentShell);
    this._contentShellEl = contentShell;
    this._pageTitleEl = null;

    // ── Tab content ──
    const tabContentWrapper = document.createElement("div");
    tabContentWrapper.className = "learnkit-settings-tab-content-wrapper";

    const tabContent = document.createElement("div");
    tabContent.className = "learnkit-settings-tab-content";
    tabContentWrapper.appendChild(tabContent);
    contentShell.appendChild(tabContentWrapper);
    this._tabContentEl = tabContent;

    if (animationsEnabled) this._animateTopLevelEntrance();

    this._renderActiveTabContent();
  }

  // ── Tab switching ───────────────────────────────────────────

  private _refreshActiveTab(reanimateTopLevel = false) {
    // Update button highlights
    for (const [id, btn] of this._tabBtnEls) {
      btn.classList.toggle("is-active", id === this._activeTab);
    }

    this._refreshTitleStrip();

    // Re-render content
    this._renderActiveTabContent();

    if (reanimateTopLevel) this._animateTopLevelEntrance();
  }

  private _renderActiveTabContent() {
    const container = this._tabContentEl;
    if (!container) return;

    this._clearWindowListeners();

    // Save scroll position
    const prevScroll = container.scrollTop;
    const previousInnerScroller = container.querySelector<HTMLElement>(".learnkit-guide-content-inner--snap");
    const prevInnerScroll = previousInnerScroller?.scrollTop ?? 0;

    // Clear
    while (container.firstChild) container.removeChild(container.firstChild);

    // Get adapter and render
    const adapter = this._getAdapter();
    const tx = (token: string, fallback: string) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);

    // Point the adapter's container at our container so Setting() calls work
    // The adapter uses its containerEl for notices/refresh — we need to
    // call the private render methods. We access them via the prototype.
    const tab = this._activeTab;

    if (tab === "about") {
      this._renderReleaseNotesTab(container);
      requestAnimationFrame(() => {
        container.scrollTop = prevScroll;
        this._clearInnerAOS(container);
      });
      return;
    }

    if (tab === "guide") {
      this._renderGuideTab(container);
      requestAnimationFrame(() => {
        container.scrollTop = prevScroll;
        this._clearInnerAOS(container);
      });
      return;
    }

    const paneTitleMap: Record<string, string> = {};

    const paneTitle = paneTitleMap[tab];
    if (paneTitle) {
      const heading = document.createElement("h1");
      heading.className = "learnkit-settings-pane-title";
      heading.textContent = paneTitle;
      container.appendChild(heading);
    }

    // We call the tab render methods directly using the adapter.
    // These are private on LearnKitSettingsTab but accessible at runtime via
    // a type-erased reference. This avoids changing the SettingsTab API.
    try {
      type RenderMethodName =
        | "renderAboutTab"
        | "renderGeneralTab"
        | "renderCardsTab"
        | "renderStudyTab"
        | "renderAudioTab"
        | "renderStorageTab"
        | "renderResetTab"
        | "renderGuideTab";
      type RenderableSettingsAdapter = Partial<Record<RenderMethodName, (container: HTMLElement) => void>>;

      const a = adapter as unknown as RenderableSettingsAdapter;
      type DisplayableSettingsAdapter = { containerEl: HTMLElement; display?: () => void };
      const displayableAdapter = adapter as unknown as DisplayableSettingsAdapter;
      const settingsSubTabs: Array<{ id: string; label: string; paneTitle?: string; method: Exclude<RenderMethodName, "renderAboutTab" | "renderGuideTab"> }> = [
        { id: "general", label: tx("ui.settings.subTabs.general", "General"), method: "renderGeneralTab" },
        { id: "audio", label: tx("ui.settings.subTabs.audio", "Audio"), method: "renderAudioTab" },
        {
          id: "assistant",
          label: tx("ui.settings.subTabs.assistant", "Companion"),
          paneTitle: tx("ui.settings.subTabs.assistantPane", "Companion"),
          method: "renderStudyTab",
        },
        {
          id: "data",
          label: tx("ui.settings.subTabs.data", "Data & Maintenance"),
          paneTitle: tx("ui.settings.subTabs.dataPane", "Data and Maintenance"),
          method: "renderStorageTab",
        },
        { id: "cards", label: tx("ui.settings.subTabs.cards", "Flashcards"), method: "renderCardsTab" },
        { id: "notes", label: tx("ui.settings.subTabs.notes", "Notes"), paneTitle: tx("ui.settings.subTabs.notesPane", "Notes"), method: "renderStudyTab" },
        { id: "reminders", label: tx("ui.settings.subTabs.reminders", "Reminders"), method: "renderStudyTab" },
        { id: "studying", label: tx("ui.settings.subTabs.studying", "Studying"), paneTitle: tx("ui.settings.subTabs.studyingPane", "Studying"), method: "renderStudyTab" },
        { id: "reset", label: tx("ui.settings.subTabs.reset", "Reset"), method: "renderResetTab" },
      ];

      const methodMap: Record<string, RenderMethodName> = {
        about: "renderAboutTab",
        guide: "renderGuideTab",
      };

      let renderTarget = container;
      let selectedSettingsSubTab: { id: string; label: string; paneTitle: string } | null = null;

      if (tab === "settings") {
        const settingsLayout = document.createElement("div");
        settingsLayout.className = "learnkit-settings-layout";
        container.appendChild(settingsLayout);

        const settingsHeader = document.createElement("div");
        settingsHeader.className = "learnkit-settings-layout-header";
        settingsLayout.appendChild(settingsHeader);

        const subNav = document.createElement("nav");
        subNav.className = "learnkit-settings-subtab-nav";
        settingsHeader.appendChild(subNav);

        const settingsContentFrame = document.createElement("div");
        settingsContentFrame.className = "learnkit-settings-layout-content-frame learnkit-guide-content";
        settingsLayout.appendChild(settingsContentFrame);

        const settingsInner = document.createElement("div");
        settingsInner.className = "learnkit-guide-content-inner learnkit-guide-content-inner--snap";
        settingsContentFrame.appendChild(settingsInner);
        const settingsBody = document.createElement("div");
        settingsBody.className = "learnkit-guide-body markdown-rendered learnkit-settings-layout-content";
        settingsInner.appendChild(settingsBody);

        const settingsFooter = document.createElement("div");
        settingsFooter.className = "learnkit-guide-footer";
        settingsLayout.appendChild(settingsFooter);

        settingsSubTabs.forEach((sub) => {
          const group = document.createElement("div");
          group.className = "learnkit-guide-nav-group";

          const btn = document.createElement("button");
          btn.className = "inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-settings-subtab-btn learnkit-settings-action-btn";
          btn.type = "button";
          const tooltipMap: Record<string, string> = {
            general: tx("ui.settings.subTabs.tooltip.general", "Open general options"),
            cards: tx("ui.settings.subTabs.tooltip.cards", "Open flashcards options"),
            studying: tx("ui.settings.subTabs.tooltip.studying", "Open studying options"),
            notes: tx("ui.settings.subTabs.tooltip.notes", "Open notes options"),
            assistant: tx("ui.settings.subTabs.tooltip.assistant", "Open companion options"),
            audio: tx("ui.settings.subTabs.tooltip.audio", "Open audio options"),
            reminders: tx("ui.settings.subTabs.tooltip.reminders", "Open reminders options"),
            data: tx("ui.settings.subTabs.tooltip.data", "Open data and maintenance options"),
            reset: tx("ui.settings.subTabs.tooltip.reset", "Open reset options"),
          };
          btn.setAttribute("aria-label", tooltipMap[sub.id] ?? tx("ui.settings.subTabs.tooltip.openOptions", "Open options"));
          btn.setAttribute("data-tooltip-position", "bottom");
          const label = document.createElement("span");
          label.textContent = sub.label;
          btn.appendChild(label);
          const isActive = this._activeSettingsSubTab === sub.id;
          btn.classList.toggle("is-active", isActive);
          btn.addEventListener("click", (evt) => {
            evt.preventDefault();
            this._activeSettingsSubTab = sub.id;
            this._renderActiveTabContent();
          });
          group.appendChild(btn);
          subNav.appendChild(group);
        });

        // Scroll the active subtab button into view so off-screen tabs are visible
        requestAnimationFrame(() => {
          const activeBtn = subNav.querySelector<HTMLElement>(".is-active");
          activeBtn?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        });

        const updateSettingsHeaderClearance = () => {
          setCssProps(settingsLayout, "--learnkit-guide-topbar-clearance", "55px");
        };

        requestAnimationFrame(() => updateSettingsHeaderClearance());
        this._trackWindowListener("resize", updateSettingsHeaderClearance, { passive: true });
        if (typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => updateSettingsHeaderClearance());
          ro.observe(settingsHeader);
          this._windowListenerCleanups.push(() => {
            try {
              ro.disconnect();
            } catch {
              // no-op
            }
          });
        }

        const selected = settingsSubTabs.find((s) => s.id === this._activeSettingsSubTab) ?? settingsSubTabs[0];
        methodMap.settings = selected.method;
        selectedSettingsSubTab = { id: selected.id, label: selected.label, paneTitle: selected.paneTitle ?? selected.label };

        const selectedIdx = settingsSubTabs.findIndex((s) => s.id === selected.id);
        const prevSubTab = selectedIdx > 0 ? settingsSubTabs[selectedIdx - 1] : null;
        const nextSubTab = selectedIdx >= 0 && selectedIdx < settingsSubTabs.length - 1 ? settingsSubTabs[selectedIdx + 1] : null;

        if (prevSubTab || nextSubTab) {
          const navBar = document.createElement("div");
          navBar.className = "learnkit-guide-prev-next";
          settingsFooter.appendChild(navBar);

          if (prevSubTab) {
            const prevBtn = document.createElement("div");
            prevBtn.className = "learnkit-guide-prev-next-btn learnkit-guide-prev-btn";
            const label = document.createElement("div");
            label.className = "learnkit-guide-prev-next-label";
            label.textContent = tx("ui.settings.nav.previous", "Previous");
            prevBtn.appendChild(label);
            const link = document.createElement("a");
            link.className = "learnkit-guide-prev-next-link";
            link.textContent = "← " + t(
              this.plugin.settings?.general?.interfaceLanguage,
              "ui.settings.nav.prevWithLabel",
              "{label}",
              { label: prevSubTab.label },
            );
            link.addEventListener("click", (ev) => {
              ev.preventDefault();
              this._activeSettingsSubTab = prevSubTab.id;
              this._renderActiveTabContent();
            });
            prevBtn.appendChild(link);
            navBar.appendChild(prevBtn);
          } else {
            const spacer = document.createElement("div");
            spacer.className = "learnkit-guide-prev-next-spacer";
            navBar.appendChild(spacer);
          }

          if (nextSubTab) {
            const nextBtn = document.createElement("div");
            nextBtn.className = "learnkit-guide-prev-next-btn learnkit-guide-next-btn";
            const label = document.createElement("div");
            label.className = "learnkit-guide-prev-next-label";
            label.textContent = tx("ui.settings.nav.next", "Next");
            nextBtn.appendChild(label);
            const link = document.createElement("a");
            link.className = "learnkit-guide-prev-next-link";
            link.textContent = t(
              this.plugin.settings?.general?.interfaceLanguage,
              "ui.settings.nav.nextWithLabel",
              "{label}",
              { label: nextSubTab.label },
            ) + " →";
            link.addEventListener("click", (ev) => {
              ev.preventDefault();
              this._activeSettingsSubTab = nextSubTab.id;
              this._renderActiveTabContent();
            });
            nextBtn.appendChild(link);
            navBar.appendChild(nextBtn);
          } else {
            const spacer = document.createElement("div");
            spacer.className = "learnkit-guide-prev-next-spacer";
            navBar.appendChild(spacer);
          }
        }

        renderTarget = settingsBody;
      }

      const methodName = methodMap[tab];
      const renderMethod = methodName ? a[methodName] : undefined;
      if (typeof renderMethod === "function") {
        renderMethod.call(adapter, renderTarget);
        if (tab === "settings") {
          this._insertSettingsPaneTitle(renderTarget, selectedSettingsSubTab?.paneTitle ?? "Settings");
          this._promoteSettingsHeadingsToH2(renderTarget);
        }
      } else if (tab === "settings" && typeof displayableAdapter.display === "function") {
        const previousContainer = displayableAdapter.containerEl;
        try {
          displayableAdapter.containerEl = renderTarget;
          displayableAdapter.display.call(adapter);
          this._partitionSettingsContentBySubTab(renderTarget, selectedSettingsSubTab?.id ?? "general");
          this._insertSettingsPaneTitle(renderTarget, selectedSettingsSubTab?.paneTitle ?? "Settings");
          this._promoteSettingsHeadingsToH2(renderTarget);
        } finally {
          displayableAdapter.containerEl = previousContainer;
        }
      } else {
        // Fallback: show a message
        const msg = document.createElement("div");
        msg.className = "learnkit-settings-text-muted";
        msg.textContent = t(
          this.plugin.settings?.general?.interfaceLanguage,
          "ui.settings.error.unknownTab",
          "Unknown tab: {tab}",
          { tab },
        );
        renderTarget.appendChild(msg);
      }


    } catch (e) {
      log.error("Failed to render settings tab", e);
      const msg = document.createElement("div");
      msg.className = "learnkit-settings-text-muted";
      msg.textContent = tx("ui.settings.error.renderFailed", "Failed to render settings. See console for details.");
      container.appendChild(msg);
    }

    // Restore scroll position (or reset to top for fresh tab switch)
    requestAnimationFrame(() => {
      const nextInnerScroller = container.querySelector<HTMLElement>(".learnkit-guide-content-inner--snap");
      if (nextInnerScroller) {
        // Temporarily disable smooth scrolling so the position restores instantly
        setCssProps(nextInnerScroller, "scroll-behavior", "auto");
        nextInnerScroller.scrollTop = prevInnerScroll;
      }
      container.scrollTop = prevScroll;
      this._clearInnerAOS(container);
      // Re-apply after a frame so future user scrolls are smooth again
      requestAnimationFrame(() => {
        if (nextInnerScroller) setCssProps(nextInnerScroller, "scroll-behavior", null);
      });
    });
  }

  private async _getGuidePages(): Promise<GuidePage[]> {
    const pluginDir = (this.plugin.manifest as { dir?: string }).dir;
    return loadGuidePages(this.app, pluginDir);
  }

  private _getGuideCategories(): GuideCategory[] {
    return getGuideCategories();
  }

  private _orderGuidePagesByNavigation(pages: GuidePage[]): GuidePage[] {
    return orderGuidePagesByNavigation(pages);
  }

  private _getGuidePageDisplayLabel(pageKey: string): string {
    return getGuidePageDisplayLabel(pageKey);
  }

  private _getGuideTooltipLabel(pageKey: string): string {
    return getGuideTooltipLabel(pageKey);
  }

  private _getGuidePageIcon(pageKey: string): string {
    return getGuidePageIcon(pageKey);
  }

  private _normalizeGuideLinkTarget(raw: string): string {
    if (!raw) return "";
    let value = raw.trim();
    if (!value) return "";

    value = value.replace(/^obsidian:\/\/open\?[^#]*file=/i, "");
    value = value.replace(/^[./]+/, "");
    value = value.split("#")[0]?.split("?")[0] ?? "";
    if (!value) return "";

    try {
      value = decodeURIComponent(value);
    } catch {
      // keep raw value
    }

    value = value.replace(/\\/g, "/");
    const pieces = value.split("/").filter(Boolean);
    value = pieces.length ? pieces[pieces.length - 1] : value;
    value = value.replace(/\.md$/i, "").trim();

    return value
      .toLowerCase()
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private _wireGuideContentLinks(
    body: HTMLElement,
    pages: GuidePage[],
    sourcePath: string,
    onNavigate?: (pageKey: string) => void,
  ) {
    const keyByNormalized = new Map<string, string>();

    const addAlias = (alias: string, pageKey: string) => {
      const normalized = this._normalizeGuideLinkTarget(alias);
      if (!normalized) return;
      if (!keyByNormalized.has(normalized)) keyByNormalized.set(normalized, pageKey);
    };

    for (const page of pages) {
      addAlias(page.key, page.key);
      addAlias(page.label, page.key);
      addAlias(this._getGuidePageDisplayLabel(page.key), page.key);
      addAlias(`${page.key}.md`, page.key);
    }

    body.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      const link = target?.closest("a") as HTMLAnchorElement | null;
      if (!link) return;

      const dataHref = link.getAttribute("data-href") ?? "";
      const hrefAttr = link.getAttribute("href") ?? "";
      const rawTarget = dataHref || hrefAttr;
      if (!rawTarget) return;

      if (/^(https?:|mailto:|tel:)/i.test(rawTarget)) return;

      const normalized = this._normalizeGuideLinkTarget(rawTarget);
      if (!normalized) return;

      const matchedKey = keyByNormalized.get(normalized);
      if (matchedKey) {
        ev.preventDefault();
        ev.stopPropagation();
        if (onNavigate) {
          onNavigate(matchedKey);
        } else {
          this._activeGuidePage = matchedKey;
          this._renderActiveTabContent();
        }
        return;
      }

      const fallbackTarget = rawTarget.replace(/^\[\[|\]\]$/g, "");
      if (!fallbackTarget || fallbackTarget.startsWith("#")) return;

      ev.preventDefault();
      ev.stopPropagation();
      void this.app.workspace.openLinkText(fallbackTarget, sourcePath || "", false);
    });
  }

  private _ensureReleaseComponent(): Component {
    if (!this._releaseComponent) this._releaseComponent = new Component();
    return this._releaseComponent;
  }

  private _renderGuideTab(container: HTMLElement) {
    const layout = document.createElement("div");
    layout.className = "learnkit-guide-layout";
    layout.classList.add("is-loading");
    container.appendChild(layout);

    const content = document.createElement("div");
    content.className = "learnkit-guide-content";
    layout.appendChild(content);

    let inner = document.createElement("div");
    inner.className = "learnkit-guide-content-inner learnkit-guide-content-inner--snap";
    content.appendChild(inner);

    const renderBody = async () => {
      try {
        const pages = this._orderGuidePagesByNavigation(await this._getGuidePages());
        if (!pages.length) {
          layout.classList.remove("is-loading");
          inner.createDiv({
            cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
            text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.settings.guide.empty", "No guide content available."),
          });
          return;
        }

        if (!pages.some((p) => p.key === this._activeGuidePage)) {
          this._activeGuidePage = pages[0].key;
        }

        const nav = document.createElement("nav");
        nav.className = "learnkit-guide-nav";
        layout.insertBefore(nav, content);

        const footer = document.createElement("div");
        footer.className = "learnkit-guide-footer";
        layout.appendChild(footer);
        const pageByKey = new Map(pages.map((page) => [page.key, page]));
        const categories = this._getGuideCategories();
        const navCategoryBtns: Array<{ btn: HTMLButtonElement; pageKeys: Set<string> }> = [];
        const navPageItems: Array<{ item: HTMLButtonElement; pageKey: string }> = [];
        let openDropdownGroup: HTMLDivElement | null = null;
        let openDropdownEl: HTMLDivElement | null = null;

        const dropdownPortal = document.createElement("div");
        dropdownPortal.className = "learnkit";
        document.body.appendChild(dropdownPortal);
        this._guideDropdownPortal = dropdownPortal;

        for (const category of categories) {
          const categoryPages = category.sections
            .flatMap((section) => section.pageKeys)
            .map((k) => pageByKey.get(k))
            .filter((p): p is GuidePage => !!p);
          if (!categoryPages.length) continue;

        const group = document.createElement("div");
        group.className = "learnkit-guide-nav-group";
        const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
          t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);

        const btn = document.createElement("button");
        btn.className = "inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-guide-nav-btn learnkit-settings-action-btn";
        const isCategoryActive = categoryPages.some((p) => p.key === this._activeGuidePage);
        btn.classList.toggle("is-active", isCategoryActive);
        navCategoryBtns.push({ btn, pageKeys: new Set(categoryPages.map((p) => p.key)) });

        const categoryIcon = document.createElement("span");
        categoryIcon.className =
          "learnkit-guide-nav-icon inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground";
        setIcon(categoryIcon, category.icon);
        btn.appendChild(categoryIcon);

        const span = document.createElement("span");
        span.textContent = category.label;
        btn.appendChild(span);

        if (categoryPages.length === 1) {
          const single = categoryPages[0];
          btn.setAttribute(
            "aria-label",
            tx("ui.settings.guide.openPage", "Open {page} page", { page: this._getGuideTooltipLabel(single.key) }),
          );
          btn.setAttribute("data-tooltip-position", "bottom");
          navPageItems.push({ item: btn, pageKey: single.key });
        } else {
          btn.type = "button";
          btn.setAttribute("aria-label", category.label);
          btn.setAttribute("data-tooltip-position", "top");
          btn.setAttribute("aria-haspopup", "menu");
          btn.setAttribute("aria-expanded", "false");

          const chevron = document.createElement("span");
          chevron.className = "learnkit-guide-nav-chevron";
          setIcon(chevron, "chevron-down");
          btn.appendChild(chevron);

          const dropdown = document.createElement("div");
          dropdown.className = "learnkit-guide-dropdown";
          const menu = document.createElement("div");
          menu.className =
            "learnkit-guide-dropdown-menu min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-header-menu-panel flex flex-col";
          menu.setAttribute("role", "menu");
          dropdown.appendChild(menu);

          let firstSection = true;
          for (const section of category.sections) {
            const sectionPages = section.pageKeys.map((k) => pageByKey.get(k)).filter((p): p is GuidePage => !!p);
            if (!sectionPages.length) continue;

            if (!firstSection) {
              const divider = document.createElement("div");
              divider.className = "learnkit-guide-dropdown-divider my-1 h-px bg-border";
              menu.appendChild(divider);
            }

            if (section.title) {
              const labelEl = document.createElement("div");
              labelEl.className = "learnkit-guide-dropdown-label px-2 py-1.5 text-sm text-muted-foreground";
              labelEl.textContent = section.title;
              menu.appendChild(labelEl);
            }

            for (const page of sectionPages) {
              const item = document.createElement("button");
              item.type = "button";
              item.className =
                "learnkit-guide-dropdown-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
              item.classList.toggle("is-active", page.key === this._activeGuidePage);
              item.setAttribute("role", "menuitem");
              item.tabIndex = 0;
              item.setAttribute(
                "aria-label",
                tx("ui.settings.guide.openPage", "Open {page} page", { page: this._getGuideTooltipLabel(page.key) }),
              );
              item.setAttribute("data-tooltip-position", "bottom");

              const iconWrap = document.createElement("span");
              iconWrap.className =
                "learnkit-guide-dropdown-icon inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground group-hover:text-inherit group-focus:text-inherit";
              setIcon(iconWrap, this._getGuidePageIcon(page.key));
              item.appendChild(iconWrap);

              const label = document.createElement("span");
              label.textContent = this._getGuidePageDisplayLabel(page.key);
              item.appendChild(label);
              navPageItems.push({ item, pageKey: page.key });

              menu.appendChild(item);
            }

            firstSection = false;
          }

          const SAFE_MARGIN = 10;

          const show = () => {
            const navRect = nav.getBoundingClientRect();
            const triggerRect = btn.getBoundingClientRect();
            const dropdownW = Math.max(224, dropdown.scrollWidth);
            const align: "left" | "right" = triggerRect.left + dropdownW > (navRect.right - SAFE_MARGIN) ? "right" : "left";

            placePopover({
              trigger: btn,
              panel: dropdown,
              popoverEl: dropdown,
              setWidth: false,
              align,
              dropUp: false,
              gap: 6,
            });
            dropdown.classList.add("is-visible");
            btn.setAttribute("aria-expanded", "true");
            openDropdownGroup = group;
            openDropdownEl = dropdown;
          };

          const hide = () => {
            dropdown.classList.remove("is-visible");
            btn.setAttribute("aria-expanded", "false");
            if (openDropdownGroup === group) openDropdownGroup = null;
            if (openDropdownEl === dropdown) openDropdownEl = null;
          };

          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (dropdown.classList.contains("is-visible")) {
              hide();
              return;
            }
            if (openDropdownGroup && openDropdownGroup !== group) {
              const openDropdown = openDropdownEl;
              const openBtn = openDropdownGroup.querySelector<HTMLButtonElement>(".learnkit-guide-nav-btn");
              if (openDropdown) openDropdown.classList.remove("is-visible");
              if (openBtn) openBtn.setAttribute("aria-expanded", "false");
              openDropdownGroup = null;
              openDropdownEl = null;
            }
            show();
          });

          group.addEventListener("keydown", (ev) => {
            if (ev.key === "Escape") {
              hide();
              btn.focus();
            }
          });

          group.addEventListener("focusout", (ev) => {
            const next = ev.relatedTarget as Node | null;
            if (!next || (!group.contains(next) && !dropdown.contains(next))) {
              hide();
            }
          });

          dropdownPortal.appendChild(dropdown);
        }

          group.appendChild(btn);
          nav.appendChild(group);
        }

        const setActiveGuideNav = () => {
          for (const { btn, pageKeys } of navCategoryBtns) {
            const isActive = pageKeys.has(this._activeGuidePage);
            btn.classList.toggle("is-active", isActive);
          }
          for (const { item, pageKey } of navPageItems) {
            item.classList.toggle("is-active", pageKey === this._activeGuidePage);
          }
        };

        let activeRenderToken = 0;

        const renderSelectedPage = async (showInlineLoading: boolean) => {
          activeRenderToken += 1;
          const token = activeRenderToken;

          this._clearWindowListeners();
          setActiveGuideNav();

          const nextInner = document.createElement("div");
          nextInner.className = "learnkit-guide-content-inner learnkit-guide-content-inner--snap";
          if (showInlineLoading) nextInner.classList.add("is-loading-inline");
          inner.replaceWith(nextInner);
          inner = nextInner;

          const body = document.createElement("div");
          body.className = "learnkit-guide-body markdown-rendered";
          inner.appendChild(body);

          const selected = pages.find((p) => p.key === this._activeGuidePage) ?? pages[0];
          const guidePageClass = `sprout-guide-page-${selected.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          body.classList.add(guidePageClass);

          const pageTitle = document.createElement("h1");
          pageTitle.className = "learnkit-guide-page-title";
          pageTitle.textContent = selected.label;
          body.appendChild(pageTitle);

          await MarkdownRenderer.render(
            this.app,
            selected.markdown,
            body,
            selected.sourcePath,
            this._ensureReleaseComponent(),
          );

          if (token !== activeRenderToken) return;

          this._wireGuideContentLinks(body, pages, selected.sourcePath, (matchedKey) => {
            if (matchedKey === this._activeGuidePage) return;
            this._activeGuidePage = matchedKey;
            void renderSelectedPage(true);
          });

          if (selected.key === "Support-Sprout") {
            this._enhanceAboutPage(body);
          }

          footer.empty();
          const idx = pages.findIndex((p) => p.key === selected.key);
          const prevPage = idx > 0 ? pages[idx - 1] : null;
          const nextPage = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;

          if (prevPage || nextPage) {
            const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
            const navBar = document.createElement("div");
            navBar.className = "learnkit-guide-prev-next";
            footer.appendChild(navBar);

            if (prevPage) {
              const prevBtn = document.createElement("div");
              prevBtn.className = "learnkit-guide-prev-next-btn learnkit-guide-prev-btn";
              const label = document.createElement("div");
              label.className = "learnkit-guide-prev-next-label";
              label.textContent = common.previous;
              prevBtn.appendChild(label);
              const link = document.createElement("a");
              link.className = "learnkit-guide-prev-next-link";
              link.textContent = "← " + t(
                this.plugin.settings?.general?.interfaceLanguage,
                "ui.settings.nav.prevWithLabel",
                "{label}",
                { label: prevPage.label },
              );
              link.addEventListener("click", (ev) => {
                ev.preventDefault();
                this._activeGuidePage = prevPage.key;
                void renderSelectedPage(true);
              });
              prevBtn.appendChild(link);
              navBar.appendChild(prevBtn);
            } else {
              const spacer = document.createElement("div");
              spacer.className = "learnkit-guide-prev-next-spacer";
              navBar.appendChild(spacer);
            }

            if (nextPage) {
              const nextBtn = document.createElement("div");
              nextBtn.className = "learnkit-guide-prev-next-btn learnkit-guide-next-btn";
              const label = document.createElement("div");
              label.className = "learnkit-guide-prev-next-label";
              label.textContent = common.next;
              nextBtn.appendChild(label);
              const link = document.createElement("a");
              link.className = "learnkit-guide-prev-next-link";
              link.textContent = t(
                this.plugin.settings?.general?.interfaceLanguage,
                "ui.settings.nav.nextWithLabel",
                "{label}",
                { label: nextPage.label },
              ) + " →";
              link.addEventListener("click", (ev) => {
                ev.preventDefault();
                this._activeGuidePage = nextPage.key;
                void renderSelectedPage(true);
              });
              nextBtn.appendChild(link);
              navBar.appendChild(nextBtn);
            } else {
              const spacer = document.createElement("div");
              spacer.className = "learnkit-guide-prev-next-spacer";
              navBar.appendChild(spacer);
            }
          }

          if (showInlineLoading) {
            inner.classList.remove("is-loading-inline");
          }
        };

        layout.addEventListener("click", (ev) => {
          const target = ev.target as Node | null;
          if (!target || !openDropdownGroup || openDropdownGroup.contains(target) || openDropdownEl?.contains(target)) return;
          const openDropdown = openDropdownEl;
          const openBtn = openDropdownGroup.querySelector<HTMLButtonElement>(".learnkit-guide-nav-btn");
          if (openDropdown) openDropdown.classList.remove("is-visible");
          if (openBtn) openBtn.setAttribute("aria-expanded", "false");
          openDropdownGroup = null;
          openDropdownEl = null;
        });

        for (const { item, pageKey } of navPageItems) {
          item.addEventListener("click", () => {
            if (pageKey === this._activeGuidePage) return;
            if (openDropdownGroup) {
              const openDropdown = openDropdownEl;
              const openBtn = openDropdownGroup.querySelector<HTMLButtonElement>(".learnkit-guide-nav-btn");
              if (openDropdown) openDropdown.classList.remove("is-visible");
              if (openBtn) openBtn.setAttribute("aria-expanded", "false");
              openDropdownGroup = null;
              openDropdownEl = null;
            }
            this._activeGuidePage = pageKey;
            void renderSelectedPage(true);
          });
        }

        await renderSelectedPage(false);

        layout.classList.remove("is-loading");
      } catch {
        layout.classList.remove("is-loading");
        inner.createDiv({
          cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
          text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.settings.guide.loadFailed", "Could not load guide."),
        });
      }
    };

    void renderBody();
  }

  private _renderReleaseNotesTab(container: HTMLElement) {
    const layout = document.createElement("div");
    layout.className = "learnkit-guide-layout learnkit-release-layout";
    layout.classList.add("is-loading");
    container.appendChild(layout);

    const navFrame = document.createElement("div");
    navFrame.className = "learnkit-release-nav-frame is-at-start";
    navFrame.hidden = true;
    layout.appendChild(navFrame);

    const nav = document.createElement("nav");
    nav.className = "learnkit-release-nav";
    navFrame.appendChild(nav);

    const content = document.createElement("div");
    content.className = "learnkit-guide-content";
    layout.appendChild(content);

    const contentInner = document.createElement("div");
    contentInner.className = "learnkit-guide-content-inner learnkit-guide-content-inner--snap";
    content.appendChild(contentInner);

    const footer = document.createElement("div");
    footer.className = "learnkit-guide-footer";
    footer.hidden = true;
    layout.appendChild(footer);

    void (async () => {
      try {
        const pages = await this._getReleaseNotesPages();
        if (!pages.length) {
          layout.classList.remove("is-loading");
          contentInner.createDiv({
            cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
            text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.settings.releaseNotes.empty", "No release notes available."),
          });
          return;
        }

        const active = pages.find((p) => p.key === this._activeReleasePage) ?? pages[0];
        this._activeReleasePage = active.key;

        this._renderReleaseNotesNav(nav, pages);
        await this._renderReleaseNotesContent(contentInner, footer, pages, active);

        layout.classList.remove("is-loading");
        navFrame.hidden = false;
        footer.hidden = false;

        const syncFade = () => {
          const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
          navFrame.classList.toggle("is-at-start", nav.scrollLeft <= 1);
          navFrame.classList.toggle("is-at-end", nav.scrollLeft >= max - 1);
        };

        nav.addEventListener("scroll", syncFade, { passive: true });
        this._trackWindowListener("resize", syncFade, { passive: true });
        syncFade();
      } catch {
        layout.classList.remove("is-loading");
        contentInner.createDiv({
          cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
          text: t(this.plugin.settings?.general?.interfaceLanguage, "ui.settings.releaseNotes.loadFailed", "Could not load release notes."),
        });
      }
    })();
  }

  private _renderReleaseNotesNav(nav: HTMLElement, pages: ReleaseNotesPage[]) {
    nav.empty();
    for (const page of pages) {
      const group = document.createElement("div");
      group.className = "learnkit-guide-nav-group";

      const btn = document.createElement("button");
      const isActive = page.key === this._activeReleasePage;
      btn.className = "inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-settings-subtab-btn learnkit-settings-action-btn learnkit-release-nav-btn";
      btn.classList.toggle("is-active", isActive);
      btn.type = "button";
      const label = document.createElement("span");
      label.textContent = page.label;
      btn.appendChild(label);
      const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
        t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
      const tooltip = page.version
        ? tx("ui.settings.releaseNotes.openVersion", "Open {version} release notes", { version: page.version })
        : tx("ui.settings.releaseNotes.openPage", "Open {page}", { page: page.label });
      btn.setAttribute("aria-label", tooltip);
      btn.setAttribute("data-tooltip-position", "bottom");
      btn.addEventListener("click", () => {
        this._activeReleasePage = page.key;
        this._renderActiveTabContent();
      });
      group.appendChild(btn);
      nav.appendChild(group);
    }
  }

  private async _renderReleaseNotesContent(
    contentInner: HTMLElement,
    footer: HTMLElement,
    pages: ReleaseNotesPage[],
    active: ReleaseNotesPage,
  ) {
    contentInner.empty();
    footer.empty();

    const body = document.createElement("div");
    body.className = "learnkit-guide-body markdown-rendered";
    contentInner.appendChild(body);

    if (active.version) {
      const h1 = document.createElement("h1");
      h1.textContent = t(
        this.plugin.settings?.general?.interfaceLanguage,
        "ui.settings.releaseNotes.titleVersion",
        "Release Notes – {version}",
        { version: active.version },
      );
      body.appendChild(h1);

      const badge = document.createElement("span");
      badge.className = "learnkit-guide-updated-badge";
      const iconSpan = document.createElement("span");
      iconSpan.className = "learnkit-guide-updated-badge-icon";
      setIcon(iconSpan, "calendar");
      const textSpan = document.createElement("span");
      textSpan.textContent = t(
        this.plugin.settings?.general?.interfaceLanguage,
        "ui.settings.releaseNotes.dateReleased",
        "Date released: {date}",
        { date: active.modifiedDate ?? this._formatDate(undefined) },
      );
      badge.appendChild(iconSpan);
      badge.appendChild(textSpan);
      body.appendChild(badge);
    }

    this._releaseComponent?.unload?.();
    this._releaseComponent = new Component();
    this._releaseComponent.load();
    await MarkdownRenderer.render(this.app, active.markdown, body, "", this._releaseComponent);

    /* ── About page: enhance with rich layout ── */
    if (active.key === "about-sprout") {
      this._enhanceAboutPage(body);
    }

    const idx = pages.findIndex((p) => p.key === active.key);
    const prevPage = idx > 0 ? pages[idx - 1] : null;
    const nextPage = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;

    if (prevPage || nextPage) {
      const common = txCommon(this.plugin.settings?.general?.interfaceLanguage);
      const navBar = document.createElement("div");
      navBar.className = "learnkit-guide-prev-next";
      footer.appendChild(navBar);

      if (prevPage) {
        const prevBtn = document.createElement("div");
        prevBtn.className = "learnkit-guide-prev-next-btn learnkit-guide-prev-btn";
        const label = document.createElement("div");
        label.className = "learnkit-guide-prev-next-label";
        label.textContent = common.previous;
        prevBtn.appendChild(label);
        const link = document.createElement("a");
        link.className = "learnkit-guide-prev-next-link";
        link.textContent = "← " + t(
          this.plugin.settings?.general?.interfaceLanguage,
          "ui.settings.nav.prevWithLabel",
          "{label}",
          { label: prevPage.label },
        );
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          this._activeReleasePage = prevPage.key;
          this._renderActiveTabContent();
        });
        prevBtn.appendChild(link);
        navBar.appendChild(prevBtn);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "learnkit-guide-prev-next-spacer";
        navBar.appendChild(spacer);
      }

      if (nextPage) {
        const nextBtn = document.createElement("div");
        nextBtn.className = "learnkit-guide-prev-next-btn learnkit-guide-next-btn";
        const label = document.createElement("div");
        label.className = "learnkit-guide-prev-next-label";
        label.textContent = common.next;
        nextBtn.appendChild(label);
        const link = document.createElement("a");
        link.className = "learnkit-guide-prev-next-link";
        link.textContent = t(
          this.plugin.settings?.general?.interfaceLanguage,
          "ui.settings.nav.nextWithLabel",
          "{label}",
          { label: nextPage.label },
        ) + " →";
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          this._activeReleasePage = nextPage.key;
          this._renderActiveTabContent();
        });
        nextBtn.appendChild(link);
        navBar.appendChild(nextBtn);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "learnkit-guide-prev-next-spacer";
        navBar.appendChild(spacer);
      }
    }
  }

  private async _getReleaseNotesPages(): Promise<ReleaseNotesPage[]> {
    const ttlMs = 10 * 60 * 1000;
    if (this._releasePagesCache && Date.now() - this._releasePagesCache.ts < ttlMs) {
      return this._releasePagesCache.pages;
    }

    const pluginDir = (this.plugin.manifest as { dir?: string }).dir;
    const supportMarkdown = await readSupportMarkdown(this.app, pluginDir);
    const releasePages = await fetchGithubReleasePages();

    const pages: ReleaseNotesPage[] = [
      { key: "about-sprout", label: "About LearnKit", markdown: supportMarkdown },
      ...releasePages,
    ];
    this._releasePagesCache = { pages, ts: Date.now() };
    return pages;
  }

  private _formatDate(input?: string): string {
    return formatReleaseDate(input);
  }

  /**
   * Build a helper button element for the about page.
   */
  private _createAboutBtn(
    cls: string,
    iconName: string,
    iconCls: string,
    labelText: string,
    tooltipLabel: string,
    tagName: "a" | "button" = "a",
    styleVariant: "muted" | "active" | "accent" = "muted",
  ): HTMLAnchorElement | HTMLButtonElement {
    const btn = document.createElement(tagName);
    const variantClass = styleVariant === "active"
      ? "is-active"
      : styleVariant === "accent"
        ? "learnkit-btn-accent"
        : "learnkit-btn-outline-muted";
    btn.className = `bc learnkit-btn-toolbar learnkit-settings-title-tab-btn inline-flex items-center gap-2 learnkit-about-btn ${variantClass} ${cls}`;
    btn.setAttribute("aria-label", tooltipLabel);
    btn.setAttribute("data-tooltip-position", "top");
    btn.setAttribute("aria-pressed", styleVariant === "active" ? "true" : "false");

    const icon = document.createElement("span");
    icon.className = `bc learnkit-settings-title-tab-btn-icon inline-flex items-center justify-center [&_svg]:size-4 learnkit-about-btn-icon ${iconCls}`;
    setIcon(icon, iconName);

    const label = document.createElement("span");
    label.className = "learnkit-about-btn-label learnkit-settings-title-tab-btn-label";
    label.textContent = labelText;

    btn.appendChild(icon);
    btn.appendChild(label);
    return btn;
  }

  /**
   * Enhance the About page with rich, interactive sections.
   * Replaces plain markdown lists with styled button groups and cards.
   */
  private _getAboutAvatarSrc(): string | null {
    const pluginDir = (this.plugin.manifest as { dir?: string }).dir;
    const configDir = this.app.vault.configDir;
    const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
    const pluginDirs = getPluginDirCandidates(configDir, this.plugin.manifest.id || "");

    const candidateBases: string[] = [
      ...pluginDirs.map((p) => `${p}/site/branding`),
      ...pluginDirs.map((p) => `${p}/wiki`),
      ...pluginDirs.map((p) => `${p}/site/docs`),
    ];

    if (pluginDir) {
      const normalizedPluginDir = normalizePath(pluginDir);
      if (basePath && normalizedPluginDir.startsWith(normalizePath(basePath))) {
        const relFromVault = normalizePath(normalizedPluginDir.slice(normalizePath(basePath).length)).replace(/^\/+/, "");
        if (relFromVault) {
          candidateBases.unshift(`${relFromVault}/site/branding`);
          candidateBases.unshift(`${relFromVault}/site/docs`);
          candidateBases.unshift(`${relFromVault}/wiki`);
        }
      }
    }

    const avatarCandidates = [
      "Founder.jpg",
      "founder.jpg",
      "avatar.png",
      "avatar.jpg",
      "avatar.jpeg",
      "avatar.webp",
    ];
    for (const base of candidateBases) {
      for (const fileName of avatarCandidates) {
        const avatarPath = normalizePath(`${base}/${fileName}`);
        const avatarFile = this.app.vault.getAbstractFileByPath(avatarPath);
        if (avatarFile instanceof TFile) {
          return this.app.vault.getResourcePath(avatarFile);
        }
      }
    }

    const remoteCandidates = [
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/site/branding/Founder.jpg",
      "https://cdn.jsdelivr.net/gh/ctrlaltwill/Sprout@main/site/branding/Founder.jpg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.png",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.jpg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.jpeg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.webp",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/site/docs/avatar.png",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/site/docs/avatar.jpg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/site/docs/avatar.jpeg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/site/docs/avatar.webp",
      "https://cdn.jsdelivr.net/gh/ctrlaltwill/Sprout@main/wiki/avatar.png",
      "https://cdn.jsdelivr.net/gh/ctrlaltwill/Sprout@main/wiki/avatar.jpg",
      "https://cdn.jsdelivr.net/gh/ctrlaltwill/Sprout@main/site/docs/avatar.png",
      "https://cdn.jsdelivr.net/gh/ctrlaltwill/Sprout@main/site/docs/avatar.jpg",
    ];
    return remoteCandidates[0] ?? null;
  }

  private _enhanceAboutPage(body: HTMLElement) {
    const tx = (token: string, fallback: string): string =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback);

    const storyCodeBlock = body.querySelector<HTMLElement>("pre > code");
    if (storyCodeBlock?.textContent?.includes("Sprout was built by William Guy")) {
      const paragraph = document.createElement("p");
      paragraph.textContent = storyCodeBlock.textContent.trim();
      const pre = storyCodeBlock.closest("pre");
      if (pre) pre.replaceWith(paragraph);
    }

    const allLinks = Array.from(body.querySelectorAll<HTMLAnchorElement>("a.external-link"));

    /* ── Section 1: Our Story ── */
    const linkedinLink = allLinks.find((a) => a.href.includes("linkedin.com"));
    if (linkedinLink) {
      const storyUl = linkedinLink.closest("ul");
      if (storyUl) {
        const storyCard = document.createElement("div");
        storyCard.className = "learnkit-about-story-card";

        const avatar = document.createElement("div");
        avatar.className = "learnkit-about-avatar";
        const avatarSrc = this._getAboutAvatarSrc();
        if (avatarSrc) {
          const image = document.createElement("img");
          image.className = "learnkit-about-avatar-img";
          image.alt = "William Guy";
          image.src = avatarSrc;
          image.addEventListener(
            "error",
            () => {
              while (avatar.firstChild) avatar.firstChild.remove();
              avatar.textContent = tx("ui.settings.about.avatarInitials", "WG");
            },
            { once: true },
          );
          avatar.appendChild(image);
        } else {
          avatar.textContent = tx("ui.settings.about.avatarInitials", "WG");
        }

        const info = document.createElement("div");
        info.className = "learnkit-about-info";

        const founderName = document.createElement("div");
        founderName.className = "learnkit-about-name";
        founderName.textContent = tx("ui.settings.about.founderName", "William Guy");

        const founderRole = document.createElement("div");
        founderRole.className = "learnkit-about-role";
        founderRole.textContent = tx("ui.settings.about.founderRole", "Founder of LearnKit.");

        const linksRow = document.createElement("div");
        linksRow.className = "learnkit-about-links-row";

        const githubAnchor = document.createElement("a");
        githubAnchor.className = "learnkit-about-linkedin";
        githubAnchor.href = "https://github.com/ctrlaltwill";
        githubAnchor.target = "_blank";
        githubAnchor.rel = "noopener nofollow";
        githubAnchor.textContent = tx("ui.settings.about.link.githubProfile", "Github \u2192");

        const linkedinAnchor = document.createElement("a");
        linkedinAnchor.className = "learnkit-about-linkedin";
        linkedinAnchor.href = "https://www.linkedin.com/in/williamguy/";
        linkedinAnchor.target = "_blank";
        linkedinAnchor.rel = "noopener nofollow";
        linkedinAnchor.textContent = tx("ui.settings.about.link.linkedin", "LinkedIn") + " \u2192";

        info.appendChild(founderName);
        info.appendChild(founderRole);
        linksRow.appendChild(githubAnchor);
        linksRow.appendChild(linkedinAnchor);
        info.appendChild(linksRow);

        storyCard.appendChild(avatar);
        storyCard.appendChild(info);
        storyUl.replaceWith(storyCard);
      }
    }

    /* ── Section 2: Feedback & Issues ── */
    const bugLink = allLinks.find((a) => a.href.includes("bug_report"));
    const featureLink = allLinks.find((a) => a.href.includes("feature_request"));
    const browseLink = allLinks.find((a) => a.href.includes("/issues") && !a.href.includes("new"));

    const feedbackUl = (bugLink ?? featureLink ?? browseLink)?.closest("ul");
    if (feedbackUl) {
      const wrapper = document.createElement("div");
      wrapper.className = "learnkit-about-buttons";

      if (bugLink) {
        const btn = this._createAboutBtn("sprout-about-btn--bug", "bug", "", "Report a Bug", "Report a bug on GitHub");
        (btn as HTMLAnchorElement).href = bugLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      if (featureLink) {
        const btn = this._createAboutBtn("sprout-about-btn--feature", "lightbulb", "", "Request a Feature", "Request a feature on GitHub", "a", "accent");
        (btn as HTMLAnchorElement).href = featureLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      if (browseLink) {
        const btn = this._createAboutBtn("sprout-about-btn--browse", "list", "", "Browse Issues", "Browse open issues on GitHub");
        (btn as HTMLAnchorElement).href = browseLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      feedbackUl.replaceWith(wrapper);
    }

    /* ── Section 3: Support the Project ── */
    const githubStarLink = allLinks.find(
      (a) => a.href.includes("github.com/ctrlaltwill/Sprout") && !a.href.includes("/issues") && !a.href.includes("/discussions") && !a.href.includes("new") && a.textContent?.includes("Star"),
    );
    const shareLink = allLinks.find((a) => a.textContent?.includes("Share"));
    const coffeeLink = allLinks.find((a) => a.href.includes("buymeacoffee.com"));

    const supportUl = (githubStarLink ?? shareLink ?? coffeeLink)?.closest("ul");
    if (supportUl) {
      const wrapper = document.createElement("div");
      wrapper.className = "learnkit-about-buttons";

      if (githubStarLink) {
        const btn = this._createAboutBtn("sprout-about-btn--star", "star", "sprout-about-star-spin", "Star on GitHub", "Star on GitHub");
        const starLabel = btn.querySelector<HTMLElement>(".learnkit-about-btn-label");
        if (starLabel) {
          const githubIcon = document.createElement("span");
          githubIcon.className = "inline-flex items-center justify-center [&_svg]:size-4 learnkit-about-btn-icon learnkit-about-btn-icon--after";
          setIcon(githubIcon, "github");
          starLabel.insertAdjacentElement("afterend", githubIcon);
        }
        (btn as HTMLAnchorElement).href = githubStarLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      if (coffeeLink) {
        const btn = this._createAboutBtn("sprout-about-btn--coffee", "coffee", "sprout-about-coffee-spin", "Buy me a Coffee", "Buy me a coffee", "a", "accent");
        (btn as HTMLAnchorElement).href = coffeeLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      if (shareLink) {
        const shareProductName = "Learn" + "Kit";
        const shareCta = "Share " + shareProductName;
        const shareBtn = this._createAboutBtn(
          "sprout-about-btn--share",
          "share-2",
          "",
          shareCta,
          shareCta,
        ) as HTMLAnchorElement;
        shareBtn.href = "#";
        shareBtn.target = "";
        shareBtn.rel = "";

        const shareIcon = shareBtn.querySelector<HTMLElement>(".learnkit-about-btn-icon");
        const shareLabel = shareBtn.querySelector<HTMLElement>(".learnkit-about-btn-label");
        if (shareIcon && shareLabel) {
          shareBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const text = `Check out ${shareProductName} - a spaced-repetition flashcard plugin for Obsidian!\nhttps://github.com/ctrlaltwill/Sprout`;
            if (typeof navigator.clipboard?.writeText !== "function") return;
            void navigator.clipboard.writeText(text).then(() => {
              const origLabel = shareLabel.textContent ?? shareCta;
              shareLabel.textContent = tx("ui.settings.about.share.copied", "Copied!");
              setIcon(shareIcon, "check");
              shareBtn.classList.add("is-copied");
              setTimeout(() => {
                shareLabel.textContent = origLabel;
                setIcon(shareIcon, "share-2");
                shareBtn.classList.remove("is-copied");
              }, 2000);
            }).catch(() => undefined);
          });
        }

        wrapper.appendChild(shareBtn);
      }

      supportUl.replaceWith(wrapper);
    }
  }

  /** Ensure tab content has no inner AOS hooks (guide, release notes, settings). */
  private _clearInnerAOS(container: HTMLElement) {
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-aos]"))) {
      el.removeAttribute("data-aos");
      el.removeAttribute("data-aos-delay");
      el.removeAttribute("data-aos-duration");
      el.removeAttribute("data-aos-anchor-placement");
      el.classList.remove("aos-init", "aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
      el.style.removeProperty("transform");
      el.style.removeProperty("opacity");
    }
  }

  /**
   * Promote `Setting#setHeading()` rows to semantic `<h2>` elements,
   * then unwrap the `.learnkit-settings-wrapper` so that headings and
   * setting-items become direct children of the guide body — matching
   * the same flat h1 / h2 / content structure used by the guide tab.
   */
  private _promoteSettingsHeadingsToH2(container: HTMLElement) {
    // 1. Convert .setting-item-heading divs → <h2>
    const headings = Array.from(container.querySelectorAll<HTMLElement>(".setting-item-heading"));
    for (const heading of headings) {
      const headingText = heading.querySelector<HTMLElement>(".setting-item-name")?.textContent?.trim() ?? "";
      if (!headingText) {
        heading.remove();
        continue;
      }

      const h2 = document.createElement("h2");
      h2.classList.add("learnkit-guide-snap-heading", "learnkit-guide-snap-heading");
      if (heading.classList.contains("learnkit-settings-conditional-hidden")) {
        h2.classList.add("learnkit-settings-conditional-hidden", "learnkit-settings-conditional-hidden");
      }
      if (heading.classList.contains("is-disabled")) {
        h2.classList.add("is-disabled");
      }
      h2.textContent = headingText;
      heading.replaceWith(h2);
    }

    // 2. Unwrap the .learnkit-settings-wrapper so h2s and setting-items
    //    are direct children of the container (guide body).
    const wrapper = container.querySelector<HTMLElement>(":scope > .learnkit-settings-wrapper");
    if (wrapper) {
      // Move the sprout-settings class to the container so
      // .learnkit-settings .setting-item rules still apply.
      container.classList.add("learnkit-settings", "learnkit-settings");
      while (wrapper.firstChild) container.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    }
  }

  private _insertSettingsPaneTitle(container: HTMLElement, title: string) {
    const existing = container.querySelector<HTMLElement>(":scope > .learnkit-settings-pane-title");
    if (existing) existing.remove();

    const h1 = document.createElement("h1");
    h1.className = "learnkit-settings-pane-title learnkit-guide-snap-heading";
    h1.textContent = title;
    container.prepend(h1);

    // Keep a subheading under the pane title, but avoid exact duplicates like
    // "Appearance" -> "Appearance" by converting the first matching h2.
    const firstH2 = container.querySelector<HTMLElement>(":scope > h2.learnkit-guide-snap-heading");
    const normalizedTitle = (title || "").trim().toLowerCase();
    const normalizedH2 = (firstH2?.textContent || "").trim().toLowerCase();
    if (firstH2 && normalizedTitle && normalizedTitle === normalizedH2) {
      firstH2.textContent = t(
        this.plugin.settings?.general?.interfaceLanguage,
        "ui.settings.sectionTitle.withSettings",
        "{title} settings",
        { title },
      );
    }
  }

  private _partitionSettingsContentBySubTab(container: HTMLElement, subTabId: string) {
    const wrapper = container.querySelector<HTMLElement>(":scope > .learnkit-settings-wrapper.learnkit-settings");
    if (!wrapper) return;

    const normalizeHeading = (value: string): string =>
      value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const sections = new Map<string, HTMLElement[]>();
    const allChildren = Array.from(wrapper.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

    let activeSection = "";
    for (const child of allChildren) {
      if (child.classList.contains("setting-item-heading")) {
        const heading = child.querySelector<HTMLElement>(".setting-item-name")?.textContent ?? "";
        activeSection = normalizeHeading(heading);
      }
      if (!activeSection) continue;
      const bucket = sections.get(activeSection) ?? [];
      bucket.push(child);
      sections.set(activeSection, bucket);
    }

    const sectionMap: Record<string, string[]> = {
      general: [
        "User details",
        "Language",
        "General",
        t(locale, "ui.settings.sections.theme", "Theme"),
        "Theme",
        t(locale, "ui.settings.sections.readingView", "Reading view"),
        t(locale, "ui.settings.sections.readingViewStyles", "Reading view styles"),
        t(locale, "ui.settings.sections.macroStyles", "Reading style preset"),
        "Reading view",
        "Reading style preset",
        "Reading styles preset",
        "Reading style",
        "Macro styles",
        "Macro style",
        "Sub macro settings",
        "Sub-macro settings",
        "Custom style CSS",
      ],
      cards: [
        "Basic cards",
        "Cloze",
        "Image occlusion",
        t(locale, "ui.settings.sections.hotspot", "Hotspot"),
        "Hotspot",
        "Multiple choice",
        "Ordered questions",
        "Syncing",
      ],
      studying: [
        t(locale, "ui.settings.sections.studySessions", "Card study sessions"),
        "Study sessions",
        "Card study sessions",
        t(locale, "ui.settings.sections.scheduling", "Flashcard scheduling"),
        "Flashcard scheduling",
        "Scheduling",
        t(locale, "ui.settings.sections.optimisation", "Optimisation"),
        "Optimisation",
      ],
      notes: [
        t(locale, "ui.settings.noteReview.selection.heading", "Note selection"),
        t(locale, "ui.settings.noteReview.scheduling.heading", "Note scheduling"),
        t(locale, "ui.settings.subTabs.notesPane", "Notes"),
        "Notes",
        "Note selection",
        "Note scheduling",
        "Note review scheduling",
      ],
      assistant: [
        "Companion",
        "Study companion",
        "Info",
        "Enable Companion",
        "AI Provider",
        "Context sources",
        "Companion sources",
        "Test sources",
        "Flashcard generation",
        "Flashcard types to generate",
        "What flashcard types to generate",
        "Optional flashcard fields",
        "Generated fields",
      ],
      audio: ["Text to speech", "Flag-aware routing", "Voice and accent", "Voice tuning"],
      reminders: [
        "Launch reminders",
        "Routine reminders",
        "Gatekeeper popups",
        "Gatekeeper behaviour",
        "Gatekeeper bypass",
      ],
      data: [
        "Attachment storage",
        t(locale, "ui.settings.sections.vaultSync", "Obsidian Sync database storage"),
        "Obsidian Sync database storage",
        "Obsidian sync database storage",
        "Data backup",
      ],
      reset: ["Reset", "Danger zone"],
    };

    const includeSections = (sectionMap[subTabId] ?? sectionMap.general).map((name) => normalizeHeading(name));
    wrapper.empty();

    for (const name of includeSections) {
      for (const node of sections.get(name) ?? []) {
        wrapper.appendChild(node);
      }
    }

    if (!wrapper.children.length) {
      const empty = document.createElement("div");
      empty.className = "learnkit-settings-text-muted";
      empty.textContent = t(this.plugin.settings?.general?.interfaceLanguage, "ui.settings.empty.section", "No settings in this section yet.");
      wrapper.appendChild(empty);
    }
  }

  /**
   * Navigate to a specific settings tab programmatically.
   * Called externally when opening the view with a target tab.
   */
  public navigateToTab(tabId: string, options?: { reanimateEntrance?: boolean }) {
    const topTabs = new Set(["guide", "about", "settings"]);
    const settingsSubTabs = new Set(["general", "audio", "cards", "data", "studying", "notes", "assistant", "reminders", "reset"]);
    const normalizedTabId = tabId === "reading" || tabId === "appearance" ? "general"
      : tabId === "storage" ? "data"
      : tabId === "study" ? "studying"
      : tabId === "note-review" ? "notes"
      : tabId;

    if (topTabs.has(normalizedTabId)) {
      this._activeTab = normalizedTabId;
      if (normalizedTabId === "settings") {
        this._activeSettingsSubTab = "general";
      }
    } else if (settingsSubTabs.has(normalizedTabId)) {
      this._activeTab = "settings";
      this._activeSettingsSubTab = normalizedTabId;
    } else {
      this._activeTab = "settings";
    }

    if (this._tabContentEl) {
      this._refreshActiveTab(options?.reanimateEntrance === true);
    }
  }
}
