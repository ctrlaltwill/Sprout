/**
 * @file src/settings/sprout-settings-view.ts
 * @summary Custom Obsidian ItemView that renders Sprout settings inside the
 * workspace leaf (like Home, Analytics, Browser) rather than in the native
 * Obsidian settings modal. Uses the shared Sprout header, tab navigation,
 * and delegates individual tab rendering to the existing SproutSettingsTab
 * methods via a thin adapter layer.
 *
 * @exports
 *   - SproutSettingsView — ItemView subclass implementing the in-workspace settings view
 */

import { ItemView, setIcon, type WorkspaceLeaf, MarkdownRenderer, Component, requestUrl, TFile, normalizePath } from "obsidian";
import { type SproutHeader, createViewHeader } from "../core/header";
import { log } from "../core/logger";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_SETTINGS } from "../core/constants";
import { setCssProps } from "../core/ui";
import { initAOS, refreshAOS, cascadeAOSOnLoad } from "../core/aos-loader";
import type SproutPlugin from "../main";
import { SproutSettingsTab } from "./sprout-settings-tab";
import { RELEASE_NOTES } from "../modals/whats-new-modal/release-notes";

interface GithubReleaseApiItem {
  tag_name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

interface ReleaseNotesPage {
  key: string;
  label: string;
  version?: string;
  modifiedDate?: string;
  markdown: string;
}

interface GuidePage {
  key: string;
  label: string;
  markdown: string;
  sourcePath: string;
}

interface GuideCategory {
  key: string;
  label: string;
  icon: string;
  sections: Array<{ title?: string; pageKeys: string[] }>;
}

export class SproutSettingsView extends ItemView {
  plugin: SproutPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;

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

  /**
   * Lazily-created SettingsTab adapter used to call the existing render methods.
   * We create a real SproutSettingsTab instance but never register it with
   * Obsidian — it is purely used as a rendering helper.
   */
  private _settingsTabAdapter: SproutSettingsTab | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SETTINGS;
  }

  getDisplayText() {
    return "Settings";
  }

  getIcon() {
    return "settings";
  }

  async onOpen() {
    this.render();
    await Promise.resolve();
  }

  async onClose() {
    try {
      this._header?.dispose?.();
      this._releaseComponent?.unload?.();
    } catch (e) { log.swallow("dispose settings header", e); }
    this._clearWindowListeners();
    this._header = null;
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
    if (!this._windowListenerCleanups.length) return;
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
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    const root = this._rootEl;
    if (!root) return;

    const maxWidth = this.plugin.isWideMode ? "none" : MAX_CONTENT_WIDTH_PX;
    setCssProps(root, "--sprout-settings-view-max-width", maxWidth);
  }

  // ── Settings tab adapter ────────────────────────────────────

  /**
   * Returns (or creates) a SproutSettingsTab instance that we use purely
   * as a container for render methods. Its `containerEl` is pointed at our
   * own content element so the Obsidian `Setting` helper works correctly.
   */
  private _getAdapter(): SproutSettingsTab {
    if (!this._settingsTabAdapter) {
      this._settingsTabAdapter = new SproutSettingsTab(this.app, this.plugin);
      this._settingsTabAdapter.onRequestRerender = () => this._renderActiveTabContent();
    }
    return this._settingsTabAdapter;
  }

  // ── Main render ─────────────────────────────────────────────

  render() {
    const root = this.contentEl;
    root.empty();

    this._tabBtnEls.clear();

    this._rootEl = root;

    root.classList.add(
      "bc",
      "sprout-view-content",
      "sprout-settings-view-root",
      "flex",
      "flex-col",
    );

    this.containerEl.addClass("sprout");
    this.setTitle?.("Settings");

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    root.classList.toggle("sprout-no-animate", !animationsEnabled);

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

    // ── Title ──
    const title = document.createElement("div");
    title.className = "text-xl font-semibold tracking-tight";
    title.textContent = "Settings";
    root.appendChild(title);

    // ── Tab navigation ──
    const tabRow = document.createElement("div");
    tabRow.className = "sprout-settings-view-tab-row";
    root.appendChild(tabRow);

    const topNav = document.createElement("div");
    topNav.className = "sprout-settings-tab-nav";
    tabRow.appendChild(topNav);

    const topTabs = [
      { id: "guide", label: "Guide", icon: "book-open" },
      { id: "about", label: "Release Notes", icon: "sprout" },
      { id: "settings", label: "Settings", icon: "settings" },
    ];

    for (const tab of topTabs) {
      const btn = document.createElement("button");
      btn.className = "sprout-settings-tab-btn";

      const tooltipMap: Record<string, string> = {
        guide: "Open guide",
        about: "Open release notes",
        settings: "Open settings",
      };
      const tooltip = tooltipMap[tab.id] ?? tab.label;
      btn.setAttribute("data-tooltip", tooltip);
      btn.setAttribute("data-tooltip-position", "top");

      if (tab.icon) {
        const iconSpan = document.createElement("span");
        iconSpan.className = "sprout-settings-tab-btn-icon";
        setIcon(iconSpan, tab.icon);
        btn.appendChild(iconSpan);
      }

      const label = document.createTextNode(tab.label);
      btn.appendChild(label);

      if (tab.id === this._activeTab) btn.classList.add("is-active");

      btn.addEventListener("click", () => {
        this._activeTab = tab.id;
        this._refreshActiveTab();
      });

      topNav.appendChild(btn);
      this._tabBtnEls.set(tab.id, btn);
    }

    // ── Tab content ──
    const tabContentWrapper = document.createElement("div");
    tabContentWrapper.className = "sprout-settings-tab-content-wrapper";

    const tabContent = document.createElement("div");
    tabContent.className = "sprout-settings-tab-content";
    tabContentWrapper.appendChild(tabContent);
    root.appendChild(tabContentWrapper);
    this._tabContentEl = tabContent;

    if (animationsEnabled) {
      const applyAos = (el: HTMLElement, delay: number) => {
        el.setAttribute("data-aos", "fade-up");
        el.setAttribute("data-aos-anchor-placement", "top-top");
        el.setAttribute("data-aos-duration", String(AOS_DURATION));
        el.setAttribute("data-aos-delay", String(delay));
      };
      applyAos(title, 0);
      applyAos(tabRow, 40);
      applyAos(tabContentWrapper, 80);
      initAOS({
        duration: AOS_DURATION,
        easing: "ease-out",
        once: true,
        offset: 50,
      });
    }

    this._renderActiveTabContent();

    if (animationsEnabled) {
      requestAnimationFrame(() => {
        refreshAOS();
        cascadeAOSOnLoad(root, {
          stepMs: 40,
          baseDelayMs: 0,
          durationMs: AOS_DURATION,
          overwriteDelays: false,
        });
      });
    }
  }

  // ── Tab switching ───────────────────────────────────────────

  private _refreshActiveTab() {
    // Update button highlights
    for (const [id, btn] of this._tabBtnEls) {
      btn.classList.toggle("is-active", id === this._activeTab);
    }

    // Re-render content
    this._renderActiveTabContent();
  }

  private _renderActiveTabContent() {
    const container = this._tabContentEl;
    if (!container) return;

    this._clearWindowListeners();

    // Save scroll position
    const prevScroll = container.scrollTop;

    // Clear
    while (container.firstChild) container.removeChild(container.firstChild);

    // Get adapter and render
    const adapter = this._getAdapter();

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
      heading.className = "sprout-settings-pane-title";
      heading.textContent = paneTitle;
      container.appendChild(heading);
    }

    // We call the tab render methods directly using the adapter.
    // These are private on SproutSettingsTab but accessible at runtime via
    // a type-erased reference. This avoids changing the SettingsTab API.
    try {
      type RenderMethodName =
        | "renderAboutTab"
        | "renderGeneralTab"
        | "renderCardsTab"
        | "renderReadingViewTab"
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
        { id: "general", label: "General", method: "renderGeneralTab" },
        { id: "audio", label: "Audio", method: "renderAudioTab" },
        { id: "cards", label: "Cards", method: "renderCardsTab" },
        { id: "reading", label: "Reading", method: "renderReadingViewTab" },
        { id: "storage", label: "Storage & Sync", paneTitle: "Storage and Sync", method: "renderStorageTab" },
        { id: "study", label: "Study", method: "renderStudyTab" },
        { id: "reset", label: "Reset", method: "renderResetTab" },
      ];

      const methodMap: Record<string, RenderMethodName> = {
        about: "renderAboutTab",
        guide: "renderGuideTab",
      };

      let renderTarget = container;
      let selectedSettingsSubTab: { id: string; label: string; paneTitle: string } | null = null;

      if (tab === "settings") {
        const settingsLayout = document.createElement("div");
        settingsLayout.className = "sprout-settings-layout";
        container.appendChild(settingsLayout);

        const settingsHeader = document.createElement("div");
        settingsHeader.className = "sprout-settings-layout-header";
        settingsLayout.appendChild(settingsHeader);

        const subNav = document.createElement("nav");
        subNav.className = "sprout-guide-nav sprout-settings-subtab-nav";
        settingsHeader.appendChild(subNav);

        const settingsContentFrame = document.createElement("div");
        settingsContentFrame.className = "sprout-settings-layout-content-frame sprout-guide-content";
        settingsLayout.appendChild(settingsContentFrame);

        const settingsInner = document.createElement("div");
        settingsInner.className = "sprout-guide-content-inner sprout-guide-content-inner--snap";
        settingsContentFrame.appendChild(settingsInner);

        const settingsBody = document.createElement("div");
        settingsBody.className = "sprout-guide-body markdown-rendered sprout-settings-layout-content";
        settingsInner.appendChild(settingsBody);

        const settingsFooter = document.createElement("div");
        settingsFooter.className = "sprout-guide-footer";
        settingsLayout.appendChild(settingsFooter);

        settingsSubTabs.forEach((sub) => {
          const group = document.createElement("div");
          group.className = "sprout-guide-nav-group";

          const btn = document.createElement("button");
          btn.className = "sprout-guide-nav-btn";
          btn.setAttribute("data-tooltip", `Open ${sub.label.toLowerCase()} options`);
          btn.setAttribute("data-tooltip-position", "bottom");
          const label = document.createElement("span");
          label.textContent = sub.label;
          btn.appendChild(label);
          btn.classList.toggle("is-active", this._activeSettingsSubTab === sub.id);
          btn.addEventListener("click", () => {
            this._activeSettingsSubTab = sub.id;
            this._renderActiveTabContent();
          });
          group.appendChild(btn);
          subNav.appendChild(group);
        });

        const selected = settingsSubTabs.find((s) => s.id === this._activeSettingsSubTab) ?? settingsSubTabs[0];
        methodMap.settings = selected.method;
        selectedSettingsSubTab = { id: selected.id, label: selected.label, paneTitle: selected.paneTitle ?? selected.label };

        const selectedIdx = settingsSubTabs.findIndex((s) => s.id === selected.id);
        const prevSubTab = selectedIdx > 0 ? settingsSubTabs[selectedIdx - 1] : null;
        const nextSubTab = selectedIdx >= 0 && selectedIdx < settingsSubTabs.length - 1 ? settingsSubTabs[selectedIdx + 1] : null;

        if (prevSubTab || nextSubTab) {
          const navBar = document.createElement("div");
          navBar.className = "sprout-guide-prev-next";
          settingsFooter.appendChild(navBar);

          if (prevSubTab) {
            const prevBtn = document.createElement("div");
            prevBtn.className = "sprout-guide-prev-next-btn sprout-guide-prev-btn";
            const label = document.createElement("div");
            label.className = "sprout-guide-prev-next-label";
            label.textContent = "Previous";
            prevBtn.appendChild(label);
            const link = document.createElement("a");
            link.className = "sprout-guide-prev-next-link";
            link.textContent = `← ${prevSubTab.label}`;
            link.addEventListener("click", (ev) => {
              ev.preventDefault();
              this._activeSettingsSubTab = prevSubTab.id;
              this._renderActiveTabContent();
            });
            prevBtn.appendChild(link);
            navBar.appendChild(prevBtn);
          } else {
            const spacer = document.createElement("div");
            spacer.className = "sprout-guide-prev-next-spacer";
            navBar.appendChild(spacer);
          }

          if (nextSubTab) {
            const nextBtn = document.createElement("div");
            nextBtn.className = "sprout-guide-prev-next-btn sprout-guide-next-btn";
            const label = document.createElement("div");
            label.className = "sprout-guide-prev-next-label";
            label.textContent = "Next";
            nextBtn.appendChild(label);
            const link = document.createElement("a");
            link.className = "sprout-guide-prev-next-link";
            link.textContent = `${nextSubTab.label} →`;
            link.addEventListener("click", (ev) => {
              ev.preventDefault();
              this._activeSettingsSubTab = nextSubTab.id;
              this._renderActiveTabContent();
            });
            nextBtn.appendChild(link);
            navBar.appendChild(nextBtn);
          } else {
            const spacer = document.createElement("div");
            spacer.className = "sprout-guide-prev-next-spacer";
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
        msg.className = "sprout-settings-text-muted";
        msg.textContent = `Unknown tab: ${tab}`;
        renderTarget.appendChild(msg);
      }
    } catch (e) {
      log.error("Failed to render settings tab", e);
      const msg = document.createElement("div");
      msg.className = "sprout-settings-text-muted";
      msg.textContent = "Failed to render settings. See console for details.";
      container.appendChild(msg);
    }

    // Restore scroll position (or reset to top for fresh tab switch)
    requestAnimationFrame(() => {
      container.scrollTop = prevScroll;
      this._clearInnerAOS(container);
    });
  }

  private async _getGuidePages(): Promise<GuidePage[]> {
    const pluginDir = (this.plugin.manifest as { dir?: string }).dir;
    const preferredFiles = [
      "Home.md",
      "Installation.md",
      "Creating-Cards.md",
      "Cards.md",
      "Basic-&-Reversed-Cards.md",
      "Cloze-Cards.md",
      "Image-Occlusion.md",
      "Multiple-Choice-Questions.md",
      "Ordered-Questions.md",
      "Card-Browser.md",
      "Reading-View.md",
      "Reading-View-Styles.md",
      "Custom-Reading-Styles.md",
      "Study-Sessions.md",
      "Grading.md",
      "Scheduling.md",
      "Burying-Cards.md",
      "Suspending-Cards.md",
      "Widget.md",
      "Analytics.md",
      "Charts.md",
      "Text-to-Speech.md",
      "Language-Settings.md",
      "Settings.md",
      "Keyboard-Shortcuts.md",
      "Custom-Delimiters.md",
      "Anki-Export-&-Import.md",
      "Backups.md",
      "Syncing.md",
      "Support-Sprout.md",
    ];

    const pagesFromPluginDir: GuidePage[] = [];
    if (pluginDir) {
      for (const fileName of preferredFiles) {
        const relPath = `wiki/${fileName}`;
        try {
          const markdown = await this.app.vault.adapter.read(`${pluginDir}/${relPath}`);
          const key = fileName.replace(/\.md$/i, "");
          pagesFromPluginDir.push({
            key,
            label: key.replace(/-/g, " "),
            markdown,
            sourcePath: `${pluginDir}/${relPath}`,
          });
        } catch {
          // File might not exist in this build; ignore and continue.
        }
      }
    }

    if (pagesFromPluginDir.length) return pagesFromPluginDir;

    const pagesFromRepoRaw: GuidePage[] = [];
    for (const fileName of preferredFiles) {
      try {
        const res = await requestUrl({
          url: `https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/${encodeURIComponent(fileName)}`,
          method: "GET",
        });
        if (res.status !== 200 || !res.text) continue;
        const key = fileName.replace(/\.md$/i, "");
        pagesFromRepoRaw.push({
          key,
          label: key.replace(/-/g, " "),
          markdown: res.text,
          sourcePath: "",
        });
      } catch {
        // Ignore and continue to next fallback source
      }
    }

    if (pagesFromRepoRaw.length) return pagesFromRepoRaw;

    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("wiki/"));
    if (!files.length) {
      return [{
        key: "guide-unavailable",
        label: "Guide",
        markdown: "# Guide\n\nGuide pages were not found.",
        sourcePath: "",
      }];
    }

    const order = [
      "Home",
      "Installation",
      "Creating Cards",
      "Cards",
      "Study Sessions",
      "Scheduling",
      "Settings",
      "Syncing",
      "Support-Sprout",
    ];
    const rank = new Map(order.map((name, index) => [name.toLowerCase(), index]));

    const pages: GuidePage[] = [];
    for (const file of files) {
      const key = file.basename;
      const label = key.replace(/-/g, " ");
      const markdown = await this.app.vault.read(file);
      pages.push({ key, label, markdown, sourcePath: file.path });
    }

    pages.sort((a, b) => {
      const ra = rank.get(a.key.toLowerCase());
      const rb = rank.get(b.key.toLowerCase());
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.label.localeCompare(b.label);
    });

    return pages;
  }

  private _getGuideCategories(): GuideCategory[] {
    return [
      { key: "home", label: "Home", icon: "house", sections: [{ pageKeys: ["Home"] }] },
      {
        key: "getting-started",
        label: "Getting Started",
        icon: "play-circle",
        sections: [{ pageKeys: ["Installation", "Syncing"] }],
      },
      {
        key: "cards",
        label: "Cards",
        icon: "square-stack",
        sections: [
          { pageKeys: ["Cards", "Card-Browser", "Creating-Cards"] },
          { title: "Reading view", pageKeys: ["Reading-View", "Reading-View-Styles", "Custom-Reading-Styles"] },
          {
            title: "Card Types",
            pageKeys: ["Basic-&-Reversed-Cards", "Cloze-Cards", "Image-Occlusion", "Multiple-Choice-Questions", "Ordered-Questions"],
          },
        ],
      },
      {
        key: "analytics",
        label: "Analytics",
        icon: "chart-column",
        sections: [{ pageKeys: ["Analytics", "Charts"] }],
      },
      {
        key: "audio",
        label: "Audio",
        icon: "volume-2",
        sections: [{ pageKeys: ["Text-to-Speech", "Language-Settings"] }],
      },
      {
        key: "study",
        label: "Study",
        icon: "graduation-cap",
        sections: [
          { title: "Review Flow", pageKeys: ["Study-Sessions", "Grading", "Scheduling"] },
          { title: "Card State", pageKeys: ["Burying-Cards", "Suspending-Cards"] },
          { title: "Scope", pageKeys: ["Groups", "Widget"] },
        ],
      },
      {
        key: "maintenance",
        label: "Maintenance",
        icon: "shield-check",
        sections: [
          { pageKeys: ["Anki-Export-&-Import", "Backups", "Custom-Delimiters", "Keyboard-Shortcuts", "Settings"] },
        ],
      },
    ];
  }

  private _orderGuidePagesByNavigation(pages: GuidePage[]): GuidePage[] {
    if (!pages.length) return [];

    const byKey = new Map(pages.map((page) => [page.key, page]));
    const ordered: GuidePage[] = [];
    const seen = new Set<string>();

    for (const category of this._getGuideCategories()) {
      for (const section of category.sections) {
        for (const key of section.pageKeys) {
          const page = byKey.get(key);
          if (!page || seen.has(page.key)) continue;
          ordered.push(page);
          seen.add(page.key);
        }
      }
    }

    for (const page of pages) {
      if (seen.has(page.key)) continue;
      ordered.push(page);
      seen.add(page.key);
    }

    return ordered;
  }

  private _getGuidePageDisplayLabel(pageKey: string): string {
    const labelMap: Record<string, string> = {
      Cards: "Cards Overview",
      "Language-Settings": "Language Options",
      Backups: "Back Up",
      "Support-Sprout": "About Sprout",
      "Reading-View-Styles": "Reading View Styles",
      "Custom-Reading-Styles": "Custom Reading Styles",
    };
    return labelMap[pageKey] ?? pageKey.replace(/-/g, " ");
  }

  private _getGuideTooltipLabel(pageKey: string): string {
    if (pageKey === "Home") return "Home";
    return this._getGuidePageDisplayLabel(pageKey);
  }

  private _getGuidePageIcon(pageKey: string): string {
    const iconMap: Record<string, string> = {
      Home: "house",
      Installation: "download",
      "Creating-Cards": "plus-circle",
      Cards: "square-stack",
      "Card-Formatting": "type",
      "Custom-Delimiters": "separator-vertical",
      "Keyboard-Shortcuts": "keyboard",
      "Basic-&-Reversed-Cards": "repeat",
      "Cloze-Cards": "text-cursor-input",
      "Multiple-Choice-Questions": "list-checks",
      "Ordered-Questions": "list-ordered",
      "Image-Occlusion": "image",
      "Study-Sessions": "graduation-cap",
      Grading: "check-check",
      Scheduling: "calendar-clock",
      "Burying-Cards": "archive",
      "Suspending-Cards": "pause-circle",
      Groups: "folders",
      Widget: "panel-right",
      "Card-Browser": "table",
      "Reading-View": "book-open",
      "Reading-View-Styles": "palette",
      "Custom-Reading-Styles": "paintbrush",
      Analytics: "chart-column",
      Charts: "line-chart",
      "Text-to-Speech": "volume-2",
      "Language-Settings": "languages",
      "Anki-Export-&-Import": "arrow-right-left",
      Settings: "settings",
      Syncing: "refresh-cw",
      Backups: "database-backup",
      "Support-Sprout": "sprout",
    };
    return iconMap[pageKey] ?? "file-text";
  }

  private _ensureReleaseComponent(): Component {
    if (!this._releaseComponent) this._releaseComponent = new Component();
    return this._releaseComponent;
  }

  private _createLoadingIndicator(): HTMLElement {
    const loading = document.createElement("div");
    loading.className = "sprout-guide-loading";

    const spinner = document.createElement("div");
    spinner.className = "three-body";
    spinner.setAttribute("aria-hidden", "true");

    spinner.createDiv({ cls: "three-body__dot" });
    spinner.createDiv({ cls: "three-body__dot" });
    spinner.createDiv({ cls: "three-body__dot" });

    const label = document.createElement("div");
    label.className = "sprout-guide-loading-label";
    label.textContent = "Loading…";

    loading.appendChild(spinner);
    loading.appendChild(label);
    return loading;
  }

  private _renderGuideTab(container: HTMLElement) {
    const layout = document.createElement("div");
    layout.className = "sprout-guide-layout";
    layout.classList.add("is-loading");
    container.appendChild(layout);

    const content = document.createElement("div");
    content.className = "sprout-guide-content";
    layout.appendChild(content);

    const inner = document.createElement("div");
    inner.className = "sprout-guide-content-inner sprout-guide-content-inner--snap";
    content.appendChild(inner);

    const loading = this._createLoadingIndicator();
    inner.classList.add("is-loading");
    loading.setAttribute("aria-live", "polite");
    const loadingLabel = loading.querySelector<HTMLElement>(".sprout-guide-loading-label");
    if (loadingLabel) loadingLabel.textContent = "Downloading guide content…";
    inner.appendChild(loading);

    const renderBody = async () => {
      try {
        const pages = this._orderGuidePagesByNavigation(await this._getGuidePages());
        if (!pages.length) {
          loading.empty();
          loading.createDiv({ cls: "sprout-guide-loading-label", text: "No guide content available." });
          return;
        }

        if (!pages.some((p) => p.key === this._activeGuidePage)) {
          this._activeGuidePage = pages[0].key;
        }

        const nav = document.createElement("nav");
        nav.className = "sprout-guide-nav";
        layout.insertBefore(nav, content);

        const dotsRail = document.createElement("div");
        dotsRail.className = "sprout-guide-dots-rail";
        dotsRail.hidden = true;
        content.appendChild(dotsRail);

        const body = document.createElement("div");
        body.className = "sprout-guide-body markdown-rendered";
        inner.appendChild(body);

        const footer = document.createElement("div");
        footer.className = "sprout-guide-footer";
        layout.appendChild(footer);
        const pageByKey = new Map(pages.map((page) => [page.key, page]));
        const categories = this._getGuideCategories();

        for (const category of categories) {
          const categoryPages = category.sections
            .flatMap((section) => section.pageKeys)
            .map((k) => pageByKey.get(k))
            .filter((p): p is GuidePage => !!p);
          if (!categoryPages.length) continue;

        const group = document.createElement("div");
        group.className = "sprout-guide-nav-group";

        const btn = document.createElement("button");
        btn.className = "sprout-guide-nav-btn";
        const isCategoryActive = categoryPages.some((p) => p.key === this._activeGuidePage);
        btn.classList.toggle("is-active", isCategoryActive);

        const span = document.createElement("span");
        span.textContent = category.label;
        btn.appendChild(span);

        if (categoryPages.length === 1) {
          const single = categoryPages[0];
          btn.setAttribute("data-tooltip", `Open ${this._getGuideTooltipLabel(single.key).toLowerCase()} page`);
          btn.setAttribute("data-tooltip-position", "bottom");
          btn.addEventListener("click", () => {
            this._activeGuidePage = single.key;
            this._renderActiveTabContent();
          });
        } else {
          const chevron = document.createElement("span");
          chevron.className = "sprout-guide-nav-chevron";
          setIcon(chevron, "chevron-down");
          btn.appendChild(chevron);

          const dropdown = document.createElement("div");
          dropdown.className = "sprout-guide-dropdown";
          const menu = document.createElement("div");
          menu.className = "sprout-guide-dropdown-menu";
          dropdown.appendChild(menu);

          let firstSection = true;
          for (const section of category.sections) {
            const sectionPages = section.pageKeys.map((k) => pageByKey.get(k)).filter((p): p is GuidePage => !!p);
            if (!sectionPages.length) continue;

            if (!firstSection) {
              const divider = document.createElement("div");
              divider.className = "sprout-guide-dropdown-divider";
              menu.appendChild(divider);
            }

            if (section.title) {
              const labelEl = document.createElement("div");
              labelEl.className = "sprout-guide-dropdown-label";
              labelEl.textContent = section.title;
              menu.appendChild(labelEl);
            }

            for (const page of sectionPages) {
              const item = document.createElement("button");
              item.type = "button";
              item.className = "sprout-guide-dropdown-item";
              item.classList.toggle("is-active", page.key === this._activeGuidePage);
              item.setAttribute("data-tooltip", `Open ${this._getGuideTooltipLabel(page.key).toLowerCase()} page`);
              item.setAttribute("data-tooltip-position", "bottom");

              const iconWrap = document.createElement("span");
              iconWrap.className = "sprout-guide-dropdown-icon";
              setIcon(iconWrap, this._getGuidePageIcon(page.key));
              item.appendChild(iconWrap);

              const label = document.createElement("span");
              label.textContent = this._getGuidePageDisplayLabel(page.key);
              item.appendChild(label);

              item.addEventListener("click", () => {
                this._activeGuidePage = page.key;
                this._renderActiveTabContent();
              });

              menu.appendChild(item);
            }

            firstSection = false;
          }

          const show = () => dropdown.classList.add("is-visible");
          const hide = () => dropdown.classList.remove("is-visible");
          group.addEventListener("mouseenter", show);
          group.addEventListener("mouseleave", hide);
          group.addEventListener("focusin", show);
          group.addEventListener("focusout", (ev) => {
            const next = ev.relatedTarget as Node | null;
            if (!next || !group.contains(next)) hide();
          });

          group.appendChild(dropdown);
        }

          group.appendChild(btn);
          nav.appendChild(group);
        }

        const selected = pages.find((p) => p.key === this._activeGuidePage) ?? pages[0];
        await MarkdownRenderer.render(
          this.app,
          selected.markdown,
          body,
          selected.sourcePath,
          this._ensureReleaseComponent(),
        );

        /* Enhance About page when shown in the Guide tab */
        if (selected.key === "Support-Sprout") {
          this._enhanceAboutPage(body);
        }

        const headingEls = Array.from(body.querySelectorAll<HTMLElement>("h1, h2"));
        headingEls.forEach((heading) => heading.classList.add("sprout-guide-snap-heading"));

        dotsRail.empty();
        dotsRail.hidden = headingEls.length < 2;

        if (headingEls.length >= 2) {
          const headingTopOffset = 16;
          const edgeEpsilon = 1;

          const getMaxScrollTop = () => Math.max(0, inner.scrollHeight - inner.clientHeight);

          const getTargetScrollTop = (heading: HTMLElement) => {
            const maxScrollTop = getMaxScrollTop();
            return Math.min(maxScrollTop, Math.max(0, heading.offsetTop - headingTopOffset));
          };

          const dotBtns = headingEls.map((heading, index) => {
            const dot = document.createElement("span");
            dot.className = "sprout-guide-dot";
            dot.setAttribute("role", "button");
            dot.tabIndex = 0;

            const jumpToHeading = () => {
              const top = getTargetScrollTop(heading);
              inner.scrollTo({ top, behavior: "smooth" });
            };

            dot.addEventListener("click", jumpToHeading);
            dot.addEventListener("keydown", (ev) => {
              if (ev.key !== "Enter" && ev.key !== " ") return;
              ev.preventDefault();
              jumpToHeading();
            });

            dotsRail.appendChild(dot);
            return dot;
          });

          let renderedActiveIdx = -1;
          let pendingActiveIdx = 0;
          let stepTimer: number | null = null;

          const setRenderedActiveIdx = (idx: number) => {
            renderedActiveIdx = idx;
            dotBtns.forEach((dot, dotIdx) => dot.classList.toggle("is-active", dotIdx === idx));
          };

          const clearStepTimer = () => {
            if (stepTimer !== null) {
              window.clearTimeout(stepTimer);
              stepTimer = null;
            }
          };

          const setActiveDotWithSteps = (nextIdx: number) => {
            pendingActiveIdx = nextIdx;

            if (renderedActiveIdx < 0) {
              setRenderedActiveIdx(nextIdx);
              return;
            }

            const distance = Math.abs(pendingActiveIdx - renderedActiveIdx);
            if (distance <= 1) {
              clearStepTimer();
              setRenderedActiveIdx(pendingActiveIdx);
              return;
            }

            if (stepTimer !== null) return;

            const stepOnce = () => {
              if (renderedActiveIdx === pendingActiveIdx) {
                stepTimer = null;
                return;
              }

              const step = pendingActiveIdx > renderedActiveIdx ? 1 : -1;
              setRenderedActiveIdx(renderedActiveIdx + step);

              if (renderedActiveIdx === pendingActiveIdx) {
                stepTimer = null;
                return;
              }

              stepTimer = window.setTimeout(stepOnce, 55);
            };

            stepTimer = window.setTimeout(stepOnce, 55);
          };

          const updateActiveDot = () => {
            const max = getMaxScrollTop();
            dotsRail.hidden = max <= 0;
            const scrollTop = inner.scrollTop;
            let activeIdx = 0;
            const bottomBlendWindow = Math.max(140, headingTopOffset * 2);

            if (scrollTop <= edgeEpsilon) {
              activeIdx = 0;
            } else {
              const markerTop = scrollTop + headingTopOffset;
              const markerBottom = scrollTop + inner.clientHeight - headingTopOffset;
              const distanceFromBottom = max - scrollTop;
              const bottomBlend =
                max > 0
                  ? Math.max(0, Math.min(1, (bottomBlendWindow - distanceFromBottom) / bottomBlendWindow))
                  : 0;
              const marker = markerTop + (markerBottom - markerTop) * bottomBlend;

              for (let i = 0; i < headingEls.length; i++) {
                const headingTop = headingEls[i].offsetTop;
                if (headingTop <= marker) activeIdx = i;
                else break;
              }
            }

            setActiveDotWithSteps(activeIdx);

            const progress = max > 0 ? inner.scrollTop / max : 0;
            setCssProps(content, "--sprout-guide-scroll-progress", progress.toFixed(4));
          };

          inner.addEventListener("scroll", updateActiveDot, { passive: true });
          const onResize = () => updateActiveDot();
          this._trackWindowListener("resize", onResize, { passive: true });
          window.requestAnimationFrame(updateActiveDot);
        }

        footer.empty();
        const idx = pages.findIndex((p) => p.key === selected.key);
        const prevPage = idx > 0 ? pages[idx - 1] : null;
        const nextPage = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;

        if (prevPage || nextPage) {
          const navBar = document.createElement("div");
          navBar.className = "sprout-guide-prev-next";
          footer.appendChild(navBar);

        if (prevPage) {
          const prevBtn = document.createElement("div");
          prevBtn.className = "sprout-guide-prev-next-btn sprout-guide-prev-btn";
          const label = document.createElement("div");
          label.className = "sprout-guide-prev-next-label";
          label.textContent = "Previous";
          prevBtn.appendChild(label);
          const link = document.createElement("a");
          link.className = "sprout-guide-prev-next-link";
          link.textContent = `← ${prevPage.label}`;
          link.addEventListener("click", (ev) => {
            ev.preventDefault();
            this._activeGuidePage = prevPage.key;
            this._renderActiveTabContent();
          });
          prevBtn.appendChild(link);
          navBar.appendChild(prevBtn);
        } else {
          const spacer = document.createElement("div");
          spacer.className = "sprout-guide-prev-next-spacer";
          navBar.appendChild(spacer);
        }

        if (nextPage) {
          const nextBtn = document.createElement("div");
          nextBtn.className = "sprout-guide-prev-next-btn sprout-guide-next-btn";
          const label = document.createElement("div");
          label.className = "sprout-guide-prev-next-label";
          label.textContent = "Next";
          nextBtn.appendChild(label);
          const link = document.createElement("a");
          link.className = "sprout-guide-prev-next-link";
          link.textContent = `${nextPage.label} →`;
          link.addEventListener("click", (ev) => {
            ev.preventDefault();
            this._activeGuidePage = nextPage.key;
            this._renderActiveTabContent();
          });
          nextBtn.appendChild(link);
          navBar.appendChild(nextBtn);
        } else {
          const spacer = document.createElement("div");
          spacer.className = "sprout-guide-prev-next-spacer";
          navBar.appendChild(spacer);
        }
      }

        inner.classList.remove("is-loading");
        layout.classList.remove("is-loading");
        loading.remove();
      } catch {
        loading.empty();
        loading.createDiv({ cls: "sprout-guide-loading-label", text: "Could not load guide." });
      }
    };

    void renderBody();
  }

  private _renderReleaseNotesTab(container: HTMLElement) {
    const layout = document.createElement("div");
    layout.className = "sprout-guide-layout sprout-release-layout";
    layout.classList.add("is-loading");
    container.appendChild(layout);

    const navFrame = document.createElement("div");
    navFrame.className = "sprout-release-nav-frame is-at-start";
    navFrame.hidden = true;
    layout.appendChild(navFrame);

    const nav = document.createElement("nav");
    nav.className = "sprout-release-nav";
    navFrame.appendChild(nav);

    const content = document.createElement("div");
    content.className = "sprout-guide-content";
    layout.appendChild(content);

    const contentInner = document.createElement("div");
    contentInner.className = "sprout-guide-content-inner sprout-guide-content-inner--snap";
    contentInner.classList.add("is-loading");
    content.appendChild(contentInner);

    const dotsRail = document.createElement("div");
    dotsRail.className = "sprout-guide-dots-rail";
    dotsRail.hidden = true;
    content.appendChild(dotsRail);

    const footer = document.createElement("div");
    footer.className = "sprout-guide-footer";
    footer.hidden = true;
    layout.appendChild(footer);

    const loading = this._createLoadingIndicator();
    contentInner.appendChild(loading);

    void (async () => {
      try {
        const pages = await this._getReleaseNotesPages();
        if (!pages.length) {
          loading.empty();
          loading.createDiv({ cls: "sprout-guide-loading-label", text: "No release notes available." });
          return;
        }

        const active = pages.find((p) => p.key === this._activeReleasePage) ?? pages[0];
        this._activeReleasePage = active.key;

        this._renderReleaseNotesNav(nav, pages);
        await this._renderReleaseNotesContent(content, contentInner, dotsRail, footer, pages, active);

        layout.classList.remove("is-loading");
        contentInner.classList.remove("is-loading");
        loading.remove();
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
        loading.empty();
        loading.createDiv({ cls: "sprout-guide-loading-label", text: "Could not load release notes." });
      }
    })();
  }

  private _renderReleaseNotesNav(nav: HTMLElement, pages: ReleaseNotesPage[]) {
    nav.empty();
    for (const page of pages) {
      const btn = document.createElement("button");
      btn.className = `sprout-guide-nav-btn sprout-release-nav-btn${page.key === this._activeReleasePage ? " is-active" : ""}`;
      btn.type = "button";
      btn.textContent = page.label;
      const tooltip = page.version
        ? `Open ${page.version} release notes`
        : `Open ${page.label.toLowerCase()}`;
      btn.setAttribute("data-tooltip", tooltip);
      btn.setAttribute("data-tooltip-position", "bottom");
      btn.addEventListener("click", () => {
        this._activeReleasePage = page.key;
        this._renderActiveTabContent();
      });
      nav.appendChild(btn);
    }
  }

  private async _renderReleaseNotesContent(
    content: HTMLElement,
    contentInner: HTMLElement,
    dotsRail: HTMLElement,
    footer: HTMLElement,
    pages: ReleaseNotesPage[],
    active: ReleaseNotesPage,
  ) {
    contentInner.empty();
    footer.empty();
    dotsRail.empty();
    dotsRail.hidden = true;

    const body = document.createElement("div");
    body.className = "sprout-guide-body markdown-rendered";
    contentInner.appendChild(body);

    if (active.version) {
      const h1 = document.createElement("h1");
      h1.textContent = `Release Notes – ${active.version}`;
      body.appendChild(h1);

      const badge = document.createElement("span");
      badge.className = "sprout-guide-updated-badge";
      const iconSpan = document.createElement("span");
      iconSpan.className = "sprout-guide-updated-badge-icon";
      setIcon(iconSpan, "calendar");
      const textSpan = document.createElement("span");
      textSpan.textContent = `Date released: ${active.modifiedDate ?? this._formatDate(undefined)}`;
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

    const headingEls = Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3"));
    headingEls.forEach((heading) => heading.classList.add("sprout-guide-snap-heading"));

    dotsRail.empty();
    dotsRail.hidden = headingEls.length < 2;

    if (headingEls.length >= 2) {
      const headingTopOffset = 16;
      const edgeEpsilon = 1;

      const getMaxScrollTop = () => Math.max(0, contentInner.scrollHeight - contentInner.clientHeight);

      const getTargetScrollTop = (heading: HTMLElement) => {
        const maxScrollTop = getMaxScrollTop();
        return Math.min(maxScrollTop, Math.max(0, heading.offsetTop - headingTopOffset));
      };

      const dotBtns = headingEls.map((heading) => {
        const dot = document.createElement("span");
        dot.className = "sprout-guide-dot";
        dot.setAttribute("role", "button");
        dot.tabIndex = 0;

        const jumpToHeading = () => {
          const top = getTargetScrollTop(heading);
          contentInner.scrollTo({ top, behavior: "smooth" });
        };

        dot.addEventListener("click", jumpToHeading);
        dot.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          jumpToHeading();
        });

        dotsRail.appendChild(dot);
        return dot;
      });

      let renderedActiveIdx = -1;
      let pendingActiveIdx = 0;
      let stepTimer: number | null = null;

      const setRenderedActiveIdx = (idx: number) => {
        renderedActiveIdx = idx;
        dotBtns.forEach((dot, dotIdx) => dot.classList.toggle("is-active", dotIdx === idx));
      };

      const clearStepTimer = () => {
        if (stepTimer !== null) {
          window.clearTimeout(stepTimer);
          stepTimer = null;
        }
      };

      const setActiveDotWithSteps = (nextIdx: number) => {
        pendingActiveIdx = nextIdx;

        if (renderedActiveIdx < 0) {
          setRenderedActiveIdx(nextIdx);
          return;
        }

        const distance = Math.abs(pendingActiveIdx - renderedActiveIdx);
        if (distance <= 1) {
          clearStepTimer();
          setRenderedActiveIdx(pendingActiveIdx);
          return;
        }

        if (stepTimer !== null) return;

        const stepOnce = () => {
          if (renderedActiveIdx === pendingActiveIdx) {
            stepTimer = null;
            return;
          }

          const step = pendingActiveIdx > renderedActiveIdx ? 1 : -1;
          setRenderedActiveIdx(renderedActiveIdx + step);

          if (renderedActiveIdx === pendingActiveIdx) {
            stepTimer = null;
            return;
          }

          stepTimer = window.setTimeout(stepOnce, 55);
        };

        stepTimer = window.setTimeout(stepOnce, 55);
      };

      const updateActiveDot = () => {
        const max = getMaxScrollTop();
        dotsRail.hidden = max <= 0;
        const scrollTop = contentInner.scrollTop;
        let activeIdx = 0;
        const bottomBlendWindow = Math.max(140, headingTopOffset * 2);

        if (scrollTop <= edgeEpsilon) {
          activeIdx = 0;
        } else {
          const markerTop = scrollTop + headingTopOffset;
          const markerBottom = scrollTop + contentInner.clientHeight - headingTopOffset;
          const distanceFromBottom = max - scrollTop;
          const bottomBlend =
            max > 0
              ? Math.max(0, Math.min(1, (bottomBlendWindow - distanceFromBottom) / bottomBlendWindow))
              : 0;
          const marker = markerTop + (markerBottom - markerTop) * bottomBlend;

          for (let i = 0; i < headingEls.length; i++) {
            const headingTop = headingEls[i].offsetTop;
            if (headingTop <= marker) activeIdx = i;
            else break;
          }
        }

        setActiveDotWithSteps(activeIdx);

        const progress = max > 0 ? contentInner.scrollTop / max : 0;
        setCssProps(content, "--sprout-guide-scroll-progress", progress.toFixed(4));
      };

      contentInner.addEventListener("scroll", updateActiveDot, { passive: true });
      const onResize = () => updateActiveDot();
      this._trackWindowListener("resize", onResize, { passive: true });
      window.requestAnimationFrame(updateActiveDot);
    }

    const idx = pages.findIndex((p) => p.key === active.key);
    const prevPage = idx > 0 ? pages[idx - 1] : null;
    const nextPage = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;

    if (prevPage || nextPage) {
      const navBar = document.createElement("div");
      navBar.className = "sprout-guide-prev-next";
      footer.appendChild(navBar);

      if (prevPage) {
        const prevBtn = document.createElement("div");
        prevBtn.className = "sprout-guide-prev-next-btn sprout-guide-prev-btn";
        const label = document.createElement("div");
        label.className = "sprout-guide-prev-next-label";
        label.textContent = "Previous";
        prevBtn.appendChild(label);
        const link = document.createElement("a");
        link.className = "sprout-guide-prev-next-link";
        link.textContent = `← ${prevPage.label}`;
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          this._activeReleasePage = prevPage.key;
          this._renderActiveTabContent();
        });
        prevBtn.appendChild(link);
        navBar.appendChild(prevBtn);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "sprout-guide-prev-next-spacer";
        navBar.appendChild(spacer);
      }

      if (nextPage) {
        const nextBtn = document.createElement("div");
        nextBtn.className = "sprout-guide-prev-next-btn sprout-guide-next-btn";
        const label = document.createElement("div");
        label.className = "sprout-guide-prev-next-label";
        label.textContent = "Next";
        nextBtn.appendChild(label);
        const link = document.createElement("a");
        link.className = "sprout-guide-prev-next-link";
        link.textContent = `${nextPage.label} →`;
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          this._activeReleasePage = nextPage.key;
          this._renderActiveTabContent();
        });
        nextBtn.appendChild(link);
        navBar.appendChild(nextBtn);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "sprout-guide-prev-next-spacer";
        navBar.appendChild(spacer);
      }
    }
  }

  private async _getReleaseNotesPages(): Promise<ReleaseNotesPage[]> {
    const ttlMs = 10 * 60 * 1000;
    if (this._releasePagesCache && Date.now() - this._releasePagesCache.ts < ttlMs) {
      return this._releasePagesCache.pages;
    }

    const supportMarkdown = await this._readSupportMarkdown();
    const releasePages = await this._fetchGithubReleasePages();

    const pages: ReleaseNotesPage[] = [
      { key: "about-sprout", label: "About Sprout", markdown: supportMarkdown },
      ...releasePages,
    ];
    this._releasePagesCache = { pages, ts: Date.now() };
    return pages;
  }

  private async _fetchGithubReleasePages(): Promise<ReleaseNotesPage[]> {
    try {
      const res = await requestUrl({
        url: "https://api.github.com/repos/ctrlaltwill/Sprout/releases?per_page=100",
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.status !== 200 || !res.text) return this._getBundledReleasePages();

      const parsed = JSON.parse(res.text) as unknown;
      if (!Array.isArray(parsed)) return this._getBundledReleasePages();

      const releases = (parsed as GithubReleaseApiItem[])
        .filter((r) => !r.draft && !r.prerelease && !!r.tag_name)
        .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime());

      if (!releases.length) return this._getBundledReleasePages();

      return releases.map((r) => {
        const version = String(r.tag_name ?? "").replace(/^v/i, "").trim();
        const fallback = RELEASE_NOTES[version]?.content ?? "No release notes available.";
        const body = this._normaliseReleaseBodyMarkdown(String(r.body ?? "").trim() || fallback);
        const updated = this._formatDate(r.published_at);
        const source = r.html_url ? `\n\n---\n\n[View on GitHub](${r.html_url})` : "";
        return {
          key: `release-${version.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()}`,
          label: version,
          version,
          modifiedDate: updated,
          markdown: `${body}${source}`,
        };
      });
    } catch {
      return this._getBundledReleasePages();
    }
  }

  private _getBundledReleasePages(): ReleaseNotesPage[] {
    const versions = Object.keys(RELEASE_NOTES).sort((a, b) => this._compareSemverDesc(a, b));
    return versions.map((version) => ({
      key: `release-${version.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()}`,
      label: version,
      version,
      modifiedDate: RELEASE_NOTES[version].releaseDate ?? this._formatDate(undefined),
      markdown: this._normaliseReleaseBodyMarkdown(RELEASE_NOTES[version].content),
    }));
  }

  private _normaliseReleaseBodyMarkdown(markdown: string): string {
    const lines = String(markdown ?? "").split(/\r?\n/);
    const out: string[] = [];
    let skipNextReleaseDateLine = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^#\s+/i.test(trimmed) && /release|changelog|what'?s changed|what'?s new/i.test(trimmed)) continue;
      if (/^##\s+/i.test(trimmed) && /v?\d+\.\d+\.\d+/i.test(trimmed)) continue;
      if (/^last (updated|modified)\s*:/i.test(trimmed)) continue;

      if (/^###\s+release date\s*$/i.test(trimmed)) {
        skipNextReleaseDateLine = true;
        continue;
      }
      if (skipNextReleaseDateLine) {
        if (trimmed.length === 0) continue;
        skipNextReleaseDateLine = false;
        continue;
      }

      out.push(line);
    }

    return out.join("\n").replace(/^\s+|\s+$/g, "");
  }

  private _compareSemverDesc(a: string, b: string): number {
    const pa = a.replace(/^v/i, "").split(".").map((n) => Number(n));
    const pb = b.replace(/^v/i, "").split(".").map((n) => Number(n));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = Number.isFinite(pa[i]) ? pa[i] : 0;
      const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
      if (na !== nb) return nb - na;
    }
    return 0;
  }

  private _formatDate(input?: string): string {
    const d = input ? new Date(input) : new Date();
    if (Number.isNaN(d.getTime())) return "Unknown";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
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
  ): HTMLAnchorElement | HTMLButtonElement {
    const btn = document.createElement(tagName);
    btn.className = `sprout-about-btn ${cls}`;
    btn.setAttribute("data-tooltip", tooltipLabel);
    btn.setAttribute("data-tooltip-position", "top");

    const icon = document.createElement("span");
    icon.className = `sprout-about-btn-icon ${iconCls}`;
    setIcon(icon, iconName);

    const label = document.createElement("span");
    label.className = "sprout-about-btn-label";
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
    const pluginId = this.plugin.manifest.id || "sprout";
    const configDir = this.app.vault.configDir;
    const relPluginDir = `${configDir}/plugins/${pluginId}`;
    const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();

    const candidateBases: string[] = [
      `${relPluginDir}/wiki`,
      `${configDir}/plugins/sprout/wiki`,
    ];

    if (pluginDir) {
      const normalizedPluginDir = normalizePath(pluginDir);
      if (basePath && normalizedPluginDir.startsWith(normalizePath(basePath))) {
        const relFromVault = normalizePath(normalizedPluginDir.slice(normalizePath(basePath).length)).replace(/^\/+/, "");
        if (relFromVault) candidateBases.unshift(`${relFromVault}/wiki`);
      }
    }

    const avatarCandidates = ["avatar.png", "avatar.jpg", "avatar.jpeg", "avatar.webp"];
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
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.jpg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.jpeg",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.png",
      "https://raw.githubusercontent.com/ctrlaltwill/Sprout/main/wiki/avatar.webp",
      "https://cdn.jsdelivr.net/gh/ctrlaltwill/Sprout@main/wiki/avatar.jpg",
    ];
    return remoteCandidates[0] ?? null;
  }

  private _enhanceAboutPage(body: HTMLElement) {
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
        storyCard.className = "sprout-about-story-card";

        const avatar = document.createElement("div");
        avatar.className = "sprout-about-avatar";
        const avatarSrc = this._getAboutAvatarSrc();
        if (avatarSrc) {
          const avatarImg = document.createElement("img");
          avatarImg.className = "sprout-about-avatar-img";
          avatarImg.alt = "William Guy";
          avatarImg.src = avatarSrc;
          avatarImg.addEventListener("error", () => {
            while (avatar.firstChild) avatar.removeChild(avatar.firstChild);
            avatar.textContent = "WG";
          }, { once: true });
          avatar.appendChild(avatarImg);
        } else {
          avatar.textContent = "WG";
        }

        const info = document.createElement("div");
        info.className = "sprout-about-info";

        const name = document.createElement("div");
        name.className = "sprout-about-name";
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        name.textContent = "William Guy";

        const role = document.createElement("div");
        role.className = "sprout-about-role";
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        role.textContent = "Creator and maintainer of Sprout.";

        const linksRow = document.createElement("div");
        linksRow.className = "sprout-about-links-row";

        const githubBtn = document.createElement("a");
        githubBtn.className = "sprout-about-linkedin";
        githubBtn.href = "https://github.com/ctrlaltwill";
        githubBtn.target = "_blank";
        githubBtn.rel = "noopener nofollow";
        githubBtn.textContent = "GitHub →";

        const linkedinBtn = document.createElement("a");
        linkedinBtn.className = "sprout-about-linkedin";
        linkedinBtn.href = "https://www.linkedin.com/in/williamguy/";
        linkedinBtn.target = "_blank";
        linkedinBtn.rel = "noopener nofollow";
        linkedinBtn.textContent = "Linkedin →";

        info.appendChild(name);
        info.appendChild(role);
        linksRow.appendChild(githubBtn);
        linksRow.appendChild(linkedinBtn);
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
      wrapper.className = "sprout-about-buttons";

      if (bugLink) {
        const btn = this._createAboutBtn("sprout-about-btn--bug", "bug", "", "Report a Bug", "Report a bug on GitHub");
        (btn as HTMLAnchorElement).href = bugLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      if (featureLink) {
        const btn = this._createAboutBtn("sprout-about-btn--feature", "lightbulb", "", "Request a Feature", "Request a feature on GitHub");
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
      wrapper.className = "sprout-about-buttons";

      if (githubStarLink) {
        const btn = this._createAboutBtn("sprout-about-btn--star", "star", "sprout-about-star-spin", "Star on GitHub", "Star on GitHub");
        (btn as HTMLAnchorElement).href = githubStarLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      if (shareLink) {
        const shareBtn = this._createAboutBtn(
          "sprout-about-btn--share",
          "share-2",
          "",
          "Share Sprout",
          "Share Sprout",
        ) as HTMLAnchorElement;
        shareBtn.href = "#";
        shareBtn.target = "";
        shareBtn.rel = "";

        const shareIcon = shareBtn.querySelector<HTMLElement>(".sprout-about-btn-icon");
        const shareLabel = shareBtn.querySelector<HTMLElement>(".sprout-about-btn-label");
        if (shareIcon && shareLabel) {
          shareBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const text = `Check out Sprout — a spaced-repetition flashcard plugin for Obsidian! 🌱\nhttps://github.com/ctrlaltwill/Sprout`;
            void navigator.clipboard.writeText(text).then(() => {
              const origLabel = shareLabel.textContent ?? "Share Sprout";
              shareLabel.textContent = "Copied!";
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

      if (coffeeLink) {
        const btn = this._createAboutBtn("sprout-about-btn--coffee", "coffee", "", "Buy me a Coffee", "Buy me a coffee");
        (btn as HTMLAnchorElement).href = coffeeLink.href;
        (btn as HTMLAnchorElement).target = "_blank";
        (btn as HTMLAnchorElement).rel = "noopener nofollow";
        wrapper.appendChild(btn);
      }

      supportUl.replaceWith(wrapper);
    }
  }

  private async _readSupportMarkdown(): Promise<string> {
    try {
      const pluginDir = (this.plugin.manifest as { dir?: string }).dir;
      const configDir = this.app.vault.configDir;
      return await this.app.vault.adapter.read(`${pluginDir ?? `${configDir}/plugins/sprout`}/wiki/Support-Sprout.md`);
    } catch {
      return `# About Sprout

## Our Story

Sprout was built by William Guy, a final-year medical student in New Zealand. Designed to bring modern spaced-repetition directly into your Obsidian vault — so your flashcards, notes, and study sessions all live in one place.

- [Find out more about Will](https://www.linkedin.com/in/williamguy/)

## Feedback & Issues

Found a bug? Have an idea for a feature? We'd love to hear from you. Sprout uses GitHub issue templates to keep things organised — just pick the right one and fill it in.

- [Report a bug](https://github.com/ctrlaltwill/Sprout/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/ctrlaltwill/Sprout/issues/new?template=feature_request.yml)
- [Browse open issues](https://github.com/ctrlaltwill/Sprout/issues)

## Support the Project

You can support Sprout by starring the repo, sharing it with friends, or caffeinating the dev!

- [⭐ Star on GitHub](https://github.com/ctrlaltwill/Sprout)
- [📋 Share Sprout](https://github.com/ctrlaltwill/Sprout)
- [☕ Buy me a coffee](https://buymeacoffee.com/williamguy)
`;
    }
  }

  /** Ensure tab content has no inner AOS hooks (guide, release notes, settings). */
  private _clearInnerAOS(container: HTMLElement) {
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-aos]"))) {
      el.removeAttribute("data-aos");
      el.removeAttribute("data-aos-delay");
      el.removeAttribute("data-aos-duration");
      el.removeAttribute("data-aos-anchor-placement");
      el.classList.remove("aos-init", "aos-animate", "sprout-aos-fallback");
      el.style.removeProperty("transform");
      el.style.removeProperty("opacity");
    }
  }

  /**
   * Promote `Setting#setHeading()` rows to semantic `<h2>` elements,
   * then unwrap the `.sprout-settings-wrapper` so that headings and
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
      h2.classList.add("sprout-guide-snap-heading");
      h2.textContent = headingText;
      heading.replaceWith(h2);
    }

    // 2. Unwrap the .sprout-settings-wrapper so h2s and setting-items
    //    are direct children of the container (guide body).
    const wrapper = container.querySelector<HTMLElement>(":scope > .sprout-settings-wrapper");
    if (wrapper) {
      // Move the sprout-settings class to the container so
      // .sprout-settings .setting-item rules still apply.
      container.classList.add("sprout-settings");
      while (wrapper.firstChild) container.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    }
  }

  private _insertSettingsPaneTitle(container: HTMLElement, title: string) {
    const existing = container.querySelector<HTMLElement>(":scope > .sprout-settings-pane-title");
    if (existing) existing.remove();

    const h1 = document.createElement("h1");
    h1.className = "sprout-settings-pane-title sprout-guide-snap-heading";
    h1.textContent = title;
    container.prepend(h1);
  }

  private _partitionSettingsContentBySubTab(container: HTMLElement, subTabId: string) {
    const wrapper = container.querySelector<HTMLElement>(":scope > .sprout-settings-wrapper.sprout-settings");
    if (!wrapper) return;

    const sections = new Map<string, HTMLElement[]>();
    const allChildren = Array.from(wrapper.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

    let activeSection = "";
    for (const child of allChildren) {
      if (child.classList.contains("setting-item-heading")) {
        activeSection = child.querySelector<HTMLElement>(".setting-item-name")?.textContent?.trim() ?? "";
      }
      if (!activeSection) continue;
      const bucket = sections.get(activeSection) ?? [];
      bucket.push(child);
      sections.set(activeSection, bucket);
    }

    const sectionMap: Record<string, string[]> = {
      general: ["Appearance"],
      audio: ["Text to speech", "Voice and accent", "Voice tuning"],
      cards: ["Basic cards", "Cloze", "Image occlusion", "Multiple choice", "Ordered questions"],
      reading: ["Reading view styles", "Macro styles", "Reading view fields", "Reading view colours", "Custom style CSS"],
      storage: ["Attachment storage", "Data backup", "Syncing"],
      study: ["Study sessions", "Scheduling"],
      reset: ["Reset", "Danger zone", "Quarantined cards"],
    };

    const includeSections = sectionMap[subTabId] ?? sectionMap.general;
    wrapper.empty();

    for (const name of includeSections) {
      for (const node of sections.get(name) ?? []) {
        wrapper.appendChild(node);
      }
    }

    if (!wrapper.children.length) {
      const empty = document.createElement("div");
      empty.className = "sprout-settings-text-muted";
      empty.textContent = "No settings in this section yet.";
      wrapper.appendChild(empty);
    }
  }

  /**
   * Navigate to a specific settings tab programmatically.
   * Called externally when opening the view with a target tab.
   */
  public navigateToTab(tabId: string) {
    const topTabs = new Set(["guide", "about", "settings"]);
    const settingsSubTabs = new Set(["general", "audio", "cards", "reading", "storage", "study", "reset"]);

    if (topTabs.has(tabId)) {
      this._activeTab = tabId;
    } else if (settingsSubTabs.has(tabId)) {
      this._activeTab = "settings";
      this._activeSettingsSubTab = tabId;
    } else {
      this._activeTab = "settings";
    }

    if (this._tabContentEl) {
      this._refreshActiveTab();
    }
  }
}
