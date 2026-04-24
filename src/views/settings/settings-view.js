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
import { ItemView, setIcon, MarkdownRenderer, Component, TFile, normalizePath } from "obsidian";
import { createViewHeader } from "../../platform/core/header";
import { log } from "../../platform/core/logger";
import { AOS_CASCADE_STEP, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_SETTINGS } from "../../platform/core/constants";
import { placePopover, setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { SPROUT_HOME_CONTENT_SHELL_CLASS } from "../../platform/core/ui-classes";
import { LearnKitSettingsTab } from "./settings-tab";
import { getGuideCategories, getGuidePageDisplayLabel, getGuidePageIcon, getGuideTooltipLabel, loadGuidePages, orderGuidePagesByNavigation, } from "./subpages/guide-content";
import { fetchGithubReleasePages, formatReleaseDate, readSupportMarkdown, } from "./subpages/release-content";
import { t } from "../../platform/translations/translator";
import { txCommon } from "../../platform/translations/ui-common";
import { getPluginDirCandidates } from "../../platform/core/identity";
export class LearnKitSettingsView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this._header = null;
        this._rootEl = null;
        this._titleStripEl = null;
        this._pageTitleEl = null;
        this._titleStripTitleEl = null;
        this._titleStripSubtitleEl = null;
        this._titleStripTabBtnEls = new Map();
        this._contentShellEl = null;
        /** Current active top-level settings tab. */
        this._activeTab = "settings";
        /** Current active sub-tab within the top-level Settings tab. */
        this._activeSettingsSubTab = "general";
        /** Active page in Release Notes nav. */
        this._activeReleasePage = "about-sprout";
        /** Active page in Guide nav. */
        this._activeGuidePage = "Home";
        /** Markdown renderer owner for release notes content. */
        this._releaseComponent = null;
        /** In-memory release-page cache. */
        this._releasePagesCache = null;
        /** Tab navigation button elements (for re-highlighting on tab switch). */
        this._tabBtnEls = new Map();
        /** Tab content container. */
        this._tabContentEl = null;
        /** Window-level listener cleanups registered by active tab content. */
        this._windowListenerCleanups = [];
        this._guideDropdownPortal = null;
        /**
         * Lazily-created SettingsTab adapter used to call the existing render methods.
          * We create a real LearnKitSettingsTab instance but never register it with
         * Obsidian — it is purely used as a rendering helper.
         */
        this._settingsTabAdapter = null;
        this.plugin = plugin;
    }
    getViewType() {
        return VIEW_TYPE_SETTINGS;
    }
    getDisplayText() {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.view.settings.title", "Settings");
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
        var _a, _b, _c, _d, _e, _f;
        try {
            (_b = (_a = this._header) === null || _a === void 0 ? void 0 : _a.dispose) === null || _b === void 0 ? void 0 : _b.call(_a);
            (_d = (_c = this._releaseComponent) === null || _c === void 0 ? void 0 : _c.unload) === null || _d === void 0 ? void 0 : _d.call(_c);
        }
        catch (e) {
            log.swallow("dispose settings header", e);
        }
        this._clearWindowListeners();
        (_e = this._guideDropdownPortal) === null || _e === void 0 ? void 0 : _e.remove();
        this._guideDropdownPortal = null;
        this._header = null;
        (_f = this._titleStripEl) === null || _f === void 0 ? void 0 : _f.remove();
        this._titleStripEl = null;
        this._contentShellEl = null;
        this._releaseComponent = null;
        this._settingsTabAdapter = null;
        await Promise.resolve();
    }
    _trackWindowListener(event, handler, options) {
        window.addEventListener(event, handler, options);
        this._windowListenerCleanups.push(() => {
            window.removeEventListener(event, handler, options);
        });
    }
    _clearWindowListeners() {
        this._pageTitleEl = null;
        const cleanups = this._windowListenerCleanups.splice(0, this._windowListenerCleanups.length);
        for (const dispose of cleanups) {
            try {
                dispose();
            }
            catch (_a) {
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
    _applyWidthMode() {
        if (this.plugin.isWideMode)
            this.containerEl.setAttribute("data-learnkit-wide", "1");
        else
            this.containerEl.removeAttribute("data-learnkit-wide");
        const root = this._rootEl;
        const strip = this._titleStripEl;
        if (!root && !strip)
            return;
        const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
        if (root) {
            setCssProps(root, "--lk-home-max-width", maxWidth);
            setCssProps(root, "--learnkit-settings-view-max-width", maxWidth);
        }
        if (strip)
            setCssProps(strip, "--lk-home-max-width", maxWidth);
    }
    _ensureTitleStrip(root) {
        var _a;
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleStripTitleEl = null;
        this._titleStripSubtitleEl = null;
        this._titleStripTabBtnEls.clear();
        const frame = createTitleStripFrame({
            root,
            stripClassName: "lk-home-title-strip sprout-settings-title-strip",
        });
        const { strip, right, title, subtitle } = frame;
        const tx = (token, fallback) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback); };
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
                if (this._activeTab === tab.id)
                    return;
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
    _settingsTitleText() {
        const tx = (token, fallback) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback); };
        if (this._activeTab === "guide")
            return tx("ui.topTabs.guide", "Guide");
        if (this._activeTab === "about")
            return tx("ui.topTabs.about.releases", "Releases");
        return tx("ui.view.settings.title", "Settings");
    }
    _settingsSubtitleText() {
        const tx = (token, fallback) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback); };
        if (this._activeTab === "guide") {
            return tx("ui.view.settings.subtitle.guide", "Learn how to use LearnKit effectively");
        }
        if (this._activeTab === "about") {
            return tx("ui.view.settings.subtitle.releaseNotes", "See what is new and recently improved");
        }
        return tx("ui.view.settings.subtitle.settings", "Customize your workflow and defaults");
    }
    _refreshTitleStrip() {
        if (this._titleStripTitleEl)
            this._titleStripTitleEl.textContent = this._settingsTitleText();
        if (this._titleStripSubtitleEl)
            this._titleStripSubtitleEl.textContent = this._settingsSubtitleText();
        if (this._pageTitleEl)
            this._pageTitleEl.textContent = this._settingsTitleText();
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
    _getAdapter() {
        if (!this._settingsTabAdapter) {
            this._settingsTabAdapter = new LearnKitSettingsTab(this.app, this.plugin);
            this._settingsTabAdapter.onRequestRerender = () => this._renderActiveTabContent();
        }
        return this._settingsTabAdapter;
    }
    // ── Main render ─────────────────────────────────────────────
    _animateTopLevelEntrance() {
        var _a, _b, _c;
        const animationsEnabled = (_c = (_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.enableAnimations) !== null && _c !== void 0 ? _c : true;
        if (!animationsEnabled)
            return;
        const stages = [];
        if (this._titleStripEl)
            stages.push({ el: this._titleStripEl, delay: 0 });
        if (this._contentShellEl)
            stages.push({ el: this._contentShellEl, delay: AOS_CASCADE_STEP });
        if (!stages.length)
            return;
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
                if (!el.isConnected)
                    continue;
                el.style.setProperty("--learnkit-settings-enter-delay", `${Math.max(0, delay)}ms`);
                // Force reflow so class re-add always restarts the keyframe.
                void el.offsetHeight;
                el.classList.add("learnkit-settings-top-enter", "learnkit-settings-top-enter");
            }
        });
    }
    render() {
        var _a, _b, _c, _d, _e;
        const root = this.contentEl;
        (_a = this._titleStripEl) === null || _a === void 0 ? void 0 : _a.remove();
        this._titleStripEl = null;
        root.empty();
        this._tabBtnEls.clear();
        this._rootEl = root;
        const tx = (token, fallback) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback); };
        root.classList.add("learnkit-view-content", "learnkit-view-content", "learnkit-settings-view-root", "learnkit-settings-view-root");
        this.containerEl.addClass("learnkit");
        (_b = this.setTitle) === null || _b === void 0 ? void 0 : _b.call(this, tx("ui.view.settings.title", "Settings"));
        this._ensureTitleStrip(root);
        const animationsEnabled = (_e = (_d = (_c = this.plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.enableAnimations) !== null && _e !== void 0 ? _e : true;
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
        if (animationsEnabled)
            this._animateTopLevelEntrance();
        this._renderActiveTabContent();
    }
    // ── Tab switching ───────────────────────────────────────────
    _refreshActiveTab(reanimateTopLevel = false) {
        // Update button highlights
        for (const [id, btn] of this._tabBtnEls) {
            btn.classList.toggle("is-active", id === this._activeTab);
        }
        this._refreshTitleStrip();
        // Re-render content
        this._renderActiveTabContent();
        if (reanimateTopLevel)
            this._animateTopLevelEntrance();
    }
    _renderActiveTabContent() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const container = this._tabContentEl;
        if (!container)
            return;
        this._clearWindowListeners();
        // Save scroll position
        const prevScroll = container.scrollTop;
        const previousInnerScroller = container.querySelector(".learnkit-guide-content-inner--snap");
        const prevInnerScroll = (_a = previousInnerScroller === null || previousInnerScroller === void 0 ? void 0 : previousInnerScroller.scrollTop) !== null && _a !== void 0 ? _a : 0;
        // Clear
        while (container.firstChild)
            container.removeChild(container.firstChild);
        // Get adapter and render
        const adapter = this._getAdapter();
        const tx = (token, fallback) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback); };
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
        const paneTitleMap = {};
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
            const a = adapter;
            const displayableAdapter = adapter;
            const settingsSubTabs = [
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
            const methodMap = {
                about: "renderAboutTab",
                guide: "renderGuideTab",
            };
            let renderTarget = container;
            let selectedSettingsSubTab = null;
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
                    var _a;
                    const group = document.createElement("div");
                    group.className = "learnkit-guide-nav-group";
                    const btn = document.createElement("button");
                    btn.className = "inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-settings-subtab-btn learnkit-settings-action-btn";
                    btn.type = "button";
                    const tooltipMap = {
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
                    btn.setAttribute("aria-label", (_a = tooltipMap[sub.id]) !== null && _a !== void 0 ? _a : tx("ui.settings.subTabs.tooltip.openOptions", "Open options"));
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
                    const activeBtn = subNav.querySelector(".is-active");
                    activeBtn === null || activeBtn === void 0 ? void 0 : activeBtn.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
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
                        }
                        catch (_a) {
                            // no-op
                        }
                    });
                }
                const selected = (_b = settingsSubTabs.find((s) => s.id === this._activeSettingsSubTab)) !== null && _b !== void 0 ? _b : settingsSubTabs[0];
                methodMap.settings = selected.method;
                selectedSettingsSubTab = { id: selected.id, label: selected.label, paneTitle: (_c = selected.paneTitle) !== null && _c !== void 0 ? _c : selected.label };
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
                        link.textContent = "← " + t((_e = (_d = this.plugin.settings) === null || _d === void 0 ? void 0 : _d.general) === null || _e === void 0 ? void 0 : _e.interfaceLanguage, "ui.settings.nav.prevWithLabel", "{label}", { label: prevSubTab.label });
                        link.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            this._activeSettingsSubTab = prevSubTab.id;
                            this._renderActiveTabContent();
                        });
                        prevBtn.appendChild(link);
                        navBar.appendChild(prevBtn);
                    }
                    else {
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
                        link.textContent = t((_g = (_f = this.plugin.settings) === null || _f === void 0 ? void 0 : _f.general) === null || _g === void 0 ? void 0 : _g.interfaceLanguage, "ui.settings.nav.nextWithLabel", "{label}", { label: nextSubTab.label }) + " →";
                        link.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            this._activeSettingsSubTab = nextSubTab.id;
                            this._renderActiveTabContent();
                        });
                        nextBtn.appendChild(link);
                        navBar.appendChild(nextBtn);
                    }
                    else {
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
                    this._insertSettingsPaneTitle(renderTarget, (_h = selectedSettingsSubTab === null || selectedSettingsSubTab === void 0 ? void 0 : selectedSettingsSubTab.paneTitle) !== null && _h !== void 0 ? _h : "Settings");
                    this._promoteSettingsHeadingsToH2(renderTarget);
                }
            }
            else if (tab === "settings" && typeof displayableAdapter.display === "function") {
                const previousContainer = displayableAdapter.containerEl;
                try {
                    displayableAdapter.containerEl = renderTarget;
                    displayableAdapter.display.call(adapter);
                    this._partitionSettingsContentBySubTab(renderTarget, (_j = selectedSettingsSubTab === null || selectedSettingsSubTab === void 0 ? void 0 : selectedSettingsSubTab.id) !== null && _j !== void 0 ? _j : "general");
                    this._insertSettingsPaneTitle(renderTarget, (_k = selectedSettingsSubTab === null || selectedSettingsSubTab === void 0 ? void 0 : selectedSettingsSubTab.paneTitle) !== null && _k !== void 0 ? _k : "Settings");
                    this._promoteSettingsHeadingsToH2(renderTarget);
                }
                finally {
                    displayableAdapter.containerEl = previousContainer;
                }
            }
            else {
                // Fallback: show a message
                const msg = document.createElement("div");
                msg.className = "learnkit-settings-text-muted";
                msg.textContent = t((_m = (_l = this.plugin.settings) === null || _l === void 0 ? void 0 : _l.general) === null || _m === void 0 ? void 0 : _m.interfaceLanguage, "ui.settings.error.unknownTab", "Unknown tab: {tab}", { tab });
                renderTarget.appendChild(msg);
            }
        }
        catch (e) {
            log.error("Failed to render settings tab", e);
            const msg = document.createElement("div");
            msg.className = "learnkit-settings-text-muted";
            msg.textContent = tx("ui.settings.error.renderFailed", "Failed to render settings. See console for details.");
            container.appendChild(msg);
        }
        // Restore scroll position (or reset to top for fresh tab switch)
        requestAnimationFrame(() => {
            const nextInnerScroller = container.querySelector(".learnkit-guide-content-inner--snap");
            if (nextInnerScroller) {
                // Temporarily disable smooth scrolling so the position restores instantly
                setCssProps(nextInnerScroller, "scroll-behavior", "auto");
                nextInnerScroller.scrollTop = prevInnerScroll;
            }
            container.scrollTop = prevScroll;
            this._clearInnerAOS(container);
            // Re-apply after a frame so future user scrolls are smooth again
            requestAnimationFrame(() => {
                if (nextInnerScroller)
                    setCssProps(nextInnerScroller, "scroll-behavior", null);
            });
        });
    }
    async _getGuidePages() {
        const pluginDir = this.plugin.manifest.dir;
        return loadGuidePages(this.app, pluginDir);
    }
    _getGuideCategories() {
        return getGuideCategories();
    }
    _orderGuidePagesByNavigation(pages) {
        return orderGuidePagesByNavigation(pages);
    }
    _getGuidePageDisplayLabel(pageKey) {
        return getGuidePageDisplayLabel(pageKey);
    }
    _getGuideTooltipLabel(pageKey) {
        return getGuideTooltipLabel(pageKey);
    }
    _getGuidePageIcon(pageKey) {
        return getGuidePageIcon(pageKey);
    }
    _normalizeGuideLinkTarget(raw) {
        var _a, _b;
        if (!raw)
            return "";
        let value = raw.trim();
        if (!value)
            return "";
        value = value.replace(/^obsidian:\/\/open\?[^#]*file=/i, "");
        value = value.replace(/^[./]+/, "");
        value = (_b = (_a = value.split("#")[0]) === null || _a === void 0 ? void 0 : _a.split("?")[0]) !== null && _b !== void 0 ? _b : "";
        if (!value)
            return "";
        try {
            value = decodeURIComponent(value);
        }
        catch (_c) {
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
    _wireGuideContentLinks(body, pages, sourcePath, onNavigate) {
        const keyByNormalized = new Map();
        const addAlias = (alias, pageKey) => {
            const normalized = this._normalizeGuideLinkTarget(alias);
            if (!normalized)
                return;
            if (!keyByNormalized.has(normalized))
                keyByNormalized.set(normalized, pageKey);
        };
        for (const page of pages) {
            addAlias(page.key, page.key);
            addAlias(page.label, page.key);
            addAlias(this._getGuidePageDisplayLabel(page.key), page.key);
            addAlias(`${page.key}.md`, page.key);
        }
        body.addEventListener("click", (ev) => {
            var _a, _b;
            const target = ev.target;
            const link = target === null || target === void 0 ? void 0 : target.closest("a");
            if (!link)
                return;
            const dataHref = (_a = link.getAttribute("data-href")) !== null && _a !== void 0 ? _a : "";
            const hrefAttr = (_b = link.getAttribute("href")) !== null && _b !== void 0 ? _b : "";
            const rawTarget = dataHref || hrefAttr;
            if (!rawTarget)
                return;
            if (/^(https?:|mailto:|tel:)/i.test(rawTarget))
                return;
            const normalized = this._normalizeGuideLinkTarget(rawTarget);
            if (!normalized)
                return;
            const matchedKey = keyByNormalized.get(normalized);
            if (matchedKey) {
                ev.preventDefault();
                ev.stopPropagation();
                if (onNavigate) {
                    onNavigate(matchedKey);
                }
                else {
                    this._activeGuidePage = matchedKey;
                    this._renderActiveTabContent();
                }
                return;
            }
            const fallbackTarget = rawTarget.replace(/^\[\[|\]\]$/g, "");
            if (!fallbackTarget || fallbackTarget.startsWith("#"))
                return;
            ev.preventDefault();
            ev.stopPropagation();
            void this.app.workspace.openLinkText(fallbackTarget, sourcePath || "", false);
        });
    }
    _ensureReleaseComponent() {
        if (!this._releaseComponent)
            this._releaseComponent = new Component();
        return this._releaseComponent;
    }
    _renderGuideTab(container) {
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
            var _a, _b, _c, _d;
            try {
                const pages = this._orderGuidePagesByNavigation(await this._getGuidePages());
                if (!pages.length) {
                    layout.classList.remove("is-loading");
                    inner.createDiv({
                        cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
                        text: t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.settings.guide.empty", "No guide content available."),
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
                const navCategoryBtns = [];
                const navPageItems = [];
                let openDropdownGroup = null;
                let openDropdownEl = null;
                const dropdownPortal = document.createElement("div");
                dropdownPortal.className = "learnkit";
                document.body.appendChild(dropdownPortal);
                this._guideDropdownPortal = dropdownPortal;
                for (const category of categories) {
                    const categoryPages = category.sections
                        .flatMap((section) => section.pageKeys)
                        .map((k) => pageByKey.get(k))
                        .filter((p) => !!p);
                    if (!categoryPages.length)
                        continue;
                    const group = document.createElement("div");
                    group.className = "learnkit-guide-nav-group";
                    const tx = (token, fallback, vars) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars); };
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
                        btn.setAttribute("aria-label", tx("ui.settings.guide.openPage", "Open {page} page", { page: this._getGuideTooltipLabel(single.key) }));
                        btn.setAttribute("data-tooltip-position", "bottom");
                        navPageItems.push({ item: btn, pageKey: single.key });
                    }
                    else {
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
                            const sectionPages = section.pageKeys.map((k) => pageByKey.get(k)).filter((p) => !!p);
                            if (!sectionPages.length)
                                continue;
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
                                item.setAttribute("aria-label", tx("ui.settings.guide.openPage", "Open {page} page", { page: this._getGuideTooltipLabel(page.key) }));
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
                            const align = triggerRect.left + dropdownW > (navRect.right - SAFE_MARGIN) ? "right" : "left";
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
                            if (openDropdownGroup === group)
                                openDropdownGroup = null;
                            if (openDropdownEl === dropdown)
                                openDropdownEl = null;
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
                                const openBtn = openDropdownGroup.querySelector(".learnkit-guide-nav-btn");
                                if (openDropdown)
                                    openDropdown.classList.remove("is-visible");
                                if (openBtn)
                                    openBtn.setAttribute("aria-expanded", "false");
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
                            const next = ev.relatedTarget;
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
                const renderSelectedPage = async (showInlineLoading) => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    activeRenderToken += 1;
                    const token = activeRenderToken;
                    this._clearWindowListeners();
                    setActiveGuideNav();
                    const nextInner = document.createElement("div");
                    nextInner.className = "learnkit-guide-content-inner learnkit-guide-content-inner--snap";
                    if (showInlineLoading)
                        nextInner.classList.add("is-loading-inline");
                    inner.replaceWith(nextInner);
                    inner = nextInner;
                    const body = document.createElement("div");
                    body.className = "learnkit-guide-body markdown-rendered";
                    inner.appendChild(body);
                    const selected = (_a = pages.find((p) => p.key === this._activeGuidePage)) !== null && _a !== void 0 ? _a : pages[0];
                    const guidePageClass = `sprout-guide-page-${selected.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                    body.classList.add(guidePageClass);
                    const pageTitle = document.createElement("h1");
                    pageTitle.className = "learnkit-guide-page-title";
                    pageTitle.textContent = selected.label;
                    body.appendChild(pageTitle);
                    await MarkdownRenderer.render(this.app, selected.markdown, body, selected.sourcePath, this._ensureReleaseComponent());
                    if (token !== activeRenderToken)
                        return;
                    this._wireGuideContentLinks(body, pages, selected.sourcePath, (matchedKey) => {
                        if (matchedKey === this._activeGuidePage)
                            return;
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
                        const common = txCommon((_c = (_b = this.plugin.settings) === null || _b === void 0 ? void 0 : _b.general) === null || _c === void 0 ? void 0 : _c.interfaceLanguage);
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
                            link.textContent = "← " + t((_e = (_d = this.plugin.settings) === null || _d === void 0 ? void 0 : _d.general) === null || _e === void 0 ? void 0 : _e.interfaceLanguage, "ui.settings.nav.prevWithLabel", "{label}", { label: prevPage.label });
                            link.addEventListener("click", (ev) => {
                                ev.preventDefault();
                                this._activeGuidePage = prevPage.key;
                                void renderSelectedPage(true);
                            });
                            prevBtn.appendChild(link);
                            navBar.appendChild(prevBtn);
                        }
                        else {
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
                            link.textContent = t((_g = (_f = this.plugin.settings) === null || _f === void 0 ? void 0 : _f.general) === null || _g === void 0 ? void 0 : _g.interfaceLanguage, "ui.settings.nav.nextWithLabel", "{label}", { label: nextPage.label }) + " →";
                            link.addEventListener("click", (ev) => {
                                ev.preventDefault();
                                this._activeGuidePage = nextPage.key;
                                void renderSelectedPage(true);
                            });
                            nextBtn.appendChild(link);
                            navBar.appendChild(nextBtn);
                        }
                        else {
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
                    const target = ev.target;
                    if (!target || !openDropdownGroup || openDropdownGroup.contains(target) || (openDropdownEl === null || openDropdownEl === void 0 ? void 0 : openDropdownEl.contains(target)))
                        return;
                    const openDropdown = openDropdownEl;
                    const openBtn = openDropdownGroup.querySelector(".learnkit-guide-nav-btn");
                    if (openDropdown)
                        openDropdown.classList.remove("is-visible");
                    if (openBtn)
                        openBtn.setAttribute("aria-expanded", "false");
                    openDropdownGroup = null;
                    openDropdownEl = null;
                });
                for (const { item, pageKey } of navPageItems) {
                    item.addEventListener("click", () => {
                        if (pageKey === this._activeGuidePage)
                            return;
                        if (openDropdownGroup) {
                            const openDropdown = openDropdownEl;
                            const openBtn = openDropdownGroup.querySelector(".learnkit-guide-nav-btn");
                            if (openDropdown)
                                openDropdown.classList.remove("is-visible");
                            if (openBtn)
                                openBtn.setAttribute("aria-expanded", "false");
                            openDropdownGroup = null;
                            openDropdownEl = null;
                        }
                        this._activeGuidePage = pageKey;
                        void renderSelectedPage(true);
                    });
                }
                await renderSelectedPage(false);
                layout.classList.remove("is-loading");
            }
            catch (_e) {
                layout.classList.remove("is-loading");
                inner.createDiv({
                    cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
                    text: t((_d = (_c = this.plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.interfaceLanguage, "ui.settings.guide.loadFailed", "Could not load guide."),
                });
            }
        };
        void renderBody();
    }
    _renderReleaseNotesTab(container) {
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
            var _a, _b, _c, _d, _e;
            try {
                const pages = await this._getReleaseNotesPages();
                if (!pages.length) {
                    layout.classList.remove("is-loading");
                    contentInner.createDiv({
                        cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
                        text: t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.settings.releaseNotes.empty", "No release notes available."),
                    });
                    return;
                }
                const active = (_c = pages.find((p) => p.key === this._activeReleasePage)) !== null && _c !== void 0 ? _c : pages[0];
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
            }
            catch (_f) {
                layout.classList.remove("is-loading");
                contentInner.createDiv({
                    cls: "learnkit-guide-loading-label learnkit-guide-loading-label",
                    text: t((_e = (_d = this.plugin.settings) === null || _d === void 0 ? void 0 : _d.general) === null || _e === void 0 ? void 0 : _e.interfaceLanguage, "ui.settings.releaseNotes.loadFailed", "Could not load release notes."),
                });
            }
        })();
    }
    _renderReleaseNotesNav(nav, pages) {
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
            const tx = (token, fallback, vars) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars); };
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
    async _renderReleaseNotesContent(contentInner, footer, pages, active) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        contentInner.empty();
        footer.empty();
        const body = document.createElement("div");
        body.className = "learnkit-guide-body markdown-rendered";
        contentInner.appendChild(body);
        if (active.version) {
            const h1 = document.createElement("h1");
            h1.textContent = t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.settings.releaseNotes.titleVersion", "Release Notes – {version}", { version: active.version });
            body.appendChild(h1);
            const badge = document.createElement("span");
            badge.className = "learnkit-guide-updated-badge";
            const iconSpan = document.createElement("span");
            iconSpan.className = "learnkit-guide-updated-badge-icon";
            setIcon(iconSpan, "calendar");
            const textSpan = document.createElement("span");
            textSpan.textContent = t((_d = (_c = this.plugin.settings) === null || _c === void 0 ? void 0 : _c.general) === null || _d === void 0 ? void 0 : _d.interfaceLanguage, "ui.settings.releaseNotes.dateReleased", "Date released: {date}", { date: (_e = active.modifiedDate) !== null && _e !== void 0 ? _e : this._formatDate(undefined) });
            badge.appendChild(iconSpan);
            badge.appendChild(textSpan);
            body.appendChild(badge);
        }
        (_g = (_f = this._releaseComponent) === null || _f === void 0 ? void 0 : _f.unload) === null || _g === void 0 ? void 0 : _g.call(_f);
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
            const common = txCommon((_j = (_h = this.plugin.settings) === null || _h === void 0 ? void 0 : _h.general) === null || _j === void 0 ? void 0 : _j.interfaceLanguage);
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
                link.textContent = "← " + t((_l = (_k = this.plugin.settings) === null || _k === void 0 ? void 0 : _k.general) === null || _l === void 0 ? void 0 : _l.interfaceLanguage, "ui.settings.nav.prevWithLabel", "{label}", { label: prevPage.label });
                link.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this._activeReleasePage = prevPage.key;
                    this._renderActiveTabContent();
                });
                prevBtn.appendChild(link);
                navBar.appendChild(prevBtn);
            }
            else {
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
                link.textContent = t((_o = (_m = this.plugin.settings) === null || _m === void 0 ? void 0 : _m.general) === null || _o === void 0 ? void 0 : _o.interfaceLanguage, "ui.settings.nav.nextWithLabel", "{label}", { label: nextPage.label }) + " →";
                link.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this._activeReleasePage = nextPage.key;
                    this._renderActiveTabContent();
                });
                nextBtn.appendChild(link);
                navBar.appendChild(nextBtn);
            }
            else {
                const spacer = document.createElement("div");
                spacer.className = "learnkit-guide-prev-next-spacer";
                navBar.appendChild(spacer);
            }
        }
    }
    async _getReleaseNotesPages() {
        const ttlMs = 10 * 60 * 1000;
        if (this._releasePagesCache && Date.now() - this._releasePagesCache.ts < ttlMs) {
            return this._releasePagesCache.pages;
        }
        const pluginDir = this.plugin.manifest.dir;
        const supportMarkdown = await readSupportMarkdown(this.app, pluginDir);
        const releasePages = await fetchGithubReleasePages();
        const pages = [
            { key: "about-sprout", label: "About LearnKit", markdown: supportMarkdown },
            ...releasePages,
        ];
        this._releasePagesCache = { pages, ts: Date.now() };
        return pages;
    }
    _formatDate(input) {
        return formatReleaseDate(input);
    }
    /**
     * Build a helper button element for the about page.
     */
    _createAboutBtn(cls, iconName, iconCls, labelText, tooltipLabel, tagName = "a", styleVariant = "muted") {
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
    _getAboutAvatarSrc() {
        var _a, _b, _c;
        const pluginDir = this.plugin.manifest.dir;
        const configDir = this.app.vault.configDir;
        const basePath = (_b = (_a = this.app.vault.adapter).getBasePath) === null || _b === void 0 ? void 0 : _b.call(_a);
        const pluginDirs = getPluginDirCandidates(configDir, this.plugin.manifest.id || "");
        const candidateBases = [
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
        return (_c = remoteCandidates[0]) !== null && _c !== void 0 ? _c : null;
    }
    _enhanceAboutPage(body) {
        var _a, _b, _c, _d, _e;
        const tx = (token, fallback) => { var _a, _b; return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback); };
        const storyCodeBlock = body.querySelector("pre > code");
        if ((_a = storyCodeBlock === null || storyCodeBlock === void 0 ? void 0 : storyCodeBlock.textContent) === null || _a === void 0 ? void 0 : _a.includes("Sprout was built by William Guy")) {
            const paragraph = document.createElement("p");
            paragraph.textContent = storyCodeBlock.textContent.trim();
            const pre = storyCodeBlock.closest("pre");
            if (pre)
                pre.replaceWith(paragraph);
        }
        const allLinks = Array.from(body.querySelectorAll("a.external-link"));
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
                    image.addEventListener("error", () => {
                        while (avatar.firstChild)
                            avatar.firstChild.remove();
                        avatar.textContent = tx("ui.settings.about.avatarInitials", "WG");
                    }, { once: true });
                    avatar.appendChild(image);
                }
                else {
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
        const feedbackUl = (_c = ((_b = bugLink !== null && bugLink !== void 0 ? bugLink : featureLink) !== null && _b !== void 0 ? _b : browseLink)) === null || _c === void 0 ? void 0 : _c.closest("ul");
        if (feedbackUl) {
            const wrapper = document.createElement("div");
            wrapper.className = "learnkit-about-buttons";
            if (bugLink) {
                const btn = this._createAboutBtn("sprout-about-btn--bug", "bug", "", "Report a Bug", "Report a bug on GitHub");
                btn.href = bugLink.href;
                btn.target = "_blank";
                btn.rel = "noopener nofollow";
                wrapper.appendChild(btn);
            }
            if (featureLink) {
                const btn = this._createAboutBtn("sprout-about-btn--feature", "lightbulb", "", "Request a Feature", "Request a feature on GitHub", "a", "accent");
                btn.href = featureLink.href;
                btn.target = "_blank";
                btn.rel = "noopener nofollow";
                wrapper.appendChild(btn);
            }
            if (browseLink) {
                const btn = this._createAboutBtn("sprout-about-btn--browse", "list", "", "Browse Issues", "Browse open issues on GitHub");
                btn.href = browseLink.href;
                btn.target = "_blank";
                btn.rel = "noopener nofollow";
                wrapper.appendChild(btn);
            }
            feedbackUl.replaceWith(wrapper);
        }
        /* ── Section 3: Support the Project ── */
        const githubStarLink = allLinks.find((a) => { var _a; return a.href.includes("github.com/ctrlaltwill/Sprout") && !a.href.includes("/issues") && !a.href.includes("/discussions") && !a.href.includes("new") && ((_a = a.textContent) === null || _a === void 0 ? void 0 : _a.includes("Star")); });
        const shareLink = allLinks.find((a) => { var _a; return (_a = a.textContent) === null || _a === void 0 ? void 0 : _a.includes("Share"); });
        const coffeeLink = allLinks.find((a) => a.href.includes("buymeacoffee.com"));
        const supportUl = (_e = ((_d = githubStarLink !== null && githubStarLink !== void 0 ? githubStarLink : shareLink) !== null && _d !== void 0 ? _d : coffeeLink)) === null || _e === void 0 ? void 0 : _e.closest("ul");
        if (supportUl) {
            const wrapper = document.createElement("div");
            wrapper.className = "learnkit-about-buttons";
            if (githubStarLink) {
                const btn = this._createAboutBtn("sprout-about-btn--star", "star", "sprout-about-star-spin", "Star on GitHub", "Star on GitHub");
                const starLabel = btn.querySelector(".learnkit-about-btn-label");
                if (starLabel) {
                    const githubIcon = document.createElement("span");
                    githubIcon.className = "inline-flex items-center justify-center [&_svg]:size-4 learnkit-about-btn-icon learnkit-about-btn-icon--after";
                    setIcon(githubIcon, "github");
                    starLabel.insertAdjacentElement("afterend", githubIcon);
                }
                btn.href = githubStarLink.href;
                btn.target = "_blank";
                btn.rel = "noopener nofollow";
                wrapper.appendChild(btn);
            }
            if (coffeeLink) {
                const btn = this._createAboutBtn("sprout-about-btn--coffee", "coffee", "sprout-about-coffee-spin", "Buy me a Coffee", "Buy me a coffee", "a", "accent");
                btn.href = coffeeLink.href;
                btn.target = "_blank";
                btn.rel = "noopener nofollow";
                wrapper.appendChild(btn);
            }
            if (shareLink) {
                const shareProductName = "Learn" + "Kit";
                const shareCta = "Share " + shareProductName;
                const shareBtn = this._createAboutBtn("sprout-about-btn--share", "share-2", "", shareCta, shareCta);
                shareBtn.href = "#";
                shareBtn.target = "";
                shareBtn.rel = "";
                const shareIcon = shareBtn.querySelector(".learnkit-about-btn-icon");
                const shareLabel = shareBtn.querySelector(".learnkit-about-btn-label");
                if (shareIcon && shareLabel) {
                    shareBtn.addEventListener("click", (ev) => {
                        var _a;
                        ev.preventDefault();
                        ev.stopPropagation();
                        const text = `Check out ${shareProductName} - a spaced-repetition flashcard plugin for Obsidian!\nhttps://github.com/ctrlaltwill/Sprout`;
                        if (typeof ((_a = navigator.clipboard) === null || _a === void 0 ? void 0 : _a.writeText) !== "function")
                            return;
                        void navigator.clipboard.writeText(text).then(() => {
                            var _a;
                            const origLabel = (_a = shareLabel.textContent) !== null && _a !== void 0 ? _a : shareCta;
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
    _clearInnerAOS(container) {
        for (const el of Array.from(container.querySelectorAll("[data-aos]"))) {
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
    _promoteSettingsHeadingsToH2(container) {
        var _a, _b, _c;
        // 1. Convert .setting-item-heading divs → <h2>
        const headings = Array.from(container.querySelectorAll(".setting-item-heading"));
        for (const heading of headings) {
            const headingText = (_c = (_b = (_a = heading.querySelector(".setting-item-name")) === null || _a === void 0 ? void 0 : _a.textContent) === null || _b === void 0 ? void 0 : _b.trim()) !== null && _c !== void 0 ? _c : "";
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
        const wrapper = container.querySelector(":scope > .learnkit-settings-wrapper");
        if (wrapper) {
            // Move the sprout-settings class to the container so
            // .learnkit-settings .setting-item rules still apply.
            container.classList.add("learnkit-settings", "learnkit-settings");
            while (wrapper.firstChild)
                container.insertBefore(wrapper.firstChild, wrapper);
            wrapper.remove();
        }
    }
    _insertSettingsPaneTitle(container, title) {
        var _a, _b;
        const existing = container.querySelector(":scope > .learnkit-settings-pane-title");
        if (existing)
            existing.remove();
        const h1 = document.createElement("h1");
        h1.className = "learnkit-settings-pane-title learnkit-guide-snap-heading";
        h1.textContent = title;
        container.prepend(h1);
        // Keep a subheading under the pane title, but avoid exact duplicates like
        // "Appearance" -> "Appearance" by converting the first matching h2.
        const firstH2 = container.querySelector(":scope > h2.learnkit-guide-snap-heading");
        const normalizedTitle = (title || "").trim().toLowerCase();
        const normalizedH2 = ((firstH2 === null || firstH2 === void 0 ? void 0 : firstH2.textContent) || "").trim().toLowerCase();
        if (firstH2 && normalizedTitle && normalizedTitle === normalizedH2) {
            firstH2.textContent = t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, "ui.settings.sectionTitle.withSettings", "{title} settings", { title });
        }
    }
    _partitionSettingsContentBySubTab(container, subTabId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const wrapper = container.querySelector(":scope > .learnkit-settings-wrapper.learnkit-settings");
        if (!wrapper)
            return;
        const normalizeHeading = (value) => value
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
        const locale = (_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage;
        const sections = new Map();
        const allChildren = Array.from(wrapper.children).filter((child) => child instanceof HTMLElement);
        let activeSection = "";
        for (const child of allChildren) {
            if (child.classList.contains("setting-item-heading")) {
                const heading = (_d = (_c = child.querySelector(".setting-item-name")) === null || _c === void 0 ? void 0 : _c.textContent) !== null && _d !== void 0 ? _d : "";
                activeSection = normalizeHeading(heading);
            }
            if (!activeSection)
                continue;
            const bucket = (_e = sections.get(activeSection)) !== null && _e !== void 0 ? _e : [];
            bucket.push(child);
            sections.set(activeSection, bucket);
        }
        const sectionMap = {
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
        const includeSections = ((_f = sectionMap[subTabId]) !== null && _f !== void 0 ? _f : sectionMap.general).map((name) => normalizeHeading(name));
        wrapper.empty();
        for (const name of includeSections) {
            for (const node of (_g = sections.get(name)) !== null && _g !== void 0 ? _g : []) {
                wrapper.appendChild(node);
            }
        }
        if (!wrapper.children.length) {
            const empty = document.createElement("div");
            empty.className = "learnkit-settings-text-muted";
            empty.textContent = t((_j = (_h = this.plugin.settings) === null || _h === void 0 ? void 0 : _h.general) === null || _j === void 0 ? void 0 : _j.interfaceLanguage, "ui.settings.empty.section", "No settings in this section yet.");
            wrapper.appendChild(empty);
        }
    }
    /**
     * Navigate to a specific settings tab programmatically.
     * Called externally when opening the view with a target tab.
     */
    navigateToTab(tabId, options) {
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
        }
        else if (settingsSubTabs.has(normalizedTabId)) {
            this._activeTab = "settings";
            this._activeSettingsSubTab = normalizedTabId;
        }
        else {
            this._activeTab = "settings";
        }
        if (this._tabContentEl) {
            this._refreshActiveTab((options === null || options === void 0 ? void 0 : options.reanimateEntrance) === true);
        }
    }
}
/**
 * Set by `openSettingsTab()` before creating the view so the first
 * render uses the requested tab instead of defaulting to "settings".
 */
LearnKitSettingsView.pendingInitialTab = null;
