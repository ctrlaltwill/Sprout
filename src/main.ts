// src/main.ts
// Basecoat CSS + JS bundle (registers components and exposes window.basecoat)
import "basecoat-css/all";

import {
  Plugin,
  Notice,
  TFile,
  type ItemView,
  MarkdownView,
  type Menu,
  type WorkspaceLeaf,
  requestUrl,
} from "obsidian";

import {
  VIEW_TYPE_REVIEWER,
  VIEW_TYPE_WIDGET,
  VIEW_TYPE_BROWSER,
  VIEW_TYPE_ANALYTICS,
  VIEW_TYPE_HOME,
  BRAND,
  DEFAULT_SETTINGS,
  deepMerge,
  type SproutSettings,
} from "./core/constants";

import { log } from "./core/logger";
import { registerReadingViewPrettyCards } from "./reading/reading-view";

import { JsonStore } from "./core/store";
import { SproutReviewerView } from "./reviewer/review-view";
import { SproutWidgetView } from "./widget/sprout-widget-view";
import { SproutCardBrowserView } from "./browser/sprout-card-browser-view";
import { SproutAnalyticsView } from "./analytics/analytics-view";
import { SproutHomeView } from "./home/sprout-home-view";
import { SproutSettingsTab } from "./settings/sprout-settings-tab";
import { formatSyncNotice, syncQuestionBank } from "./sync/sync-engine";
import { CardCreatorModal } from "./modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "./modals/image-occlusion-creator-modal";
import { ParseErrorModal } from "./modals/parse-error-modal";
import { resetCardScheduling, type CardState } from "./scheduler/scheduler";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function cleanPositiveNumberArray(v: any, fallback: number[]): number[] {
  const arr = Array.isArray(v) ? v : [];
  const out = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  return out.length ? out : fallback;
}

function clonePlain<T>(x: T): T {
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x)) as T;
}

type BasecoatApi = {
  init?: (group: string) => void;
  initAll?: () => void;
  start?: () => void;
  stop?: () => void;
};

function getBasecoatApi(): BasecoatApi | null {
  const bc = window?.basecoat as BasecoatApi | undefined;
  if (!bc) return null;
  const hasInit = typeof bc.initAll === "function" || typeof bc.init === "function";
  const hasStart = typeof bc.start === "function";
  if (!hasInit || !hasStart) return null;
  return bc;
}

export default class SproutPlugin extends Plugin {
  settings!: SproutSettings;
  store!: JsonStore;
  _bc: any;

  private _basecoatStarted = false;

  // Shared wide mode state across all views
  isWideMode = false;

  readonly DEFAULT_SETTINGS: SproutSettings = DEFAULT_SETTINGS;
  readonly defaultSettings: SproutSettings = DEFAULT_SETTINGS;
  readonly defaults: SproutSettings = DEFAULT_SETTINGS;

  // Ribbon icons (desktop + mobile)
  private _ribbonEls: HTMLElement[] = [];

  // Hide Obsidian global status bar when these views are active
  private readonly _hideStatusBarViewTypes = new Set<string>([
    VIEW_TYPE_REVIEWER,
    VIEW_TYPE_BROWSER,
    VIEW_TYPE_ANALYTICS,
    VIEW_TYPE_HOME,
    // If you also want it hidden in the sidebar widget, uncomment:
    // VIEW_TYPE_WIDGET,
  ]);

  private _initBasecoatRuntime() {
    const bc = getBasecoatApi();
    if (!bc) {
      log.warn(`Basecoat API not found on window.basecoat (dropdowns may not work).`);
      return;
    }

    try {
      // If hot-reloading or reloading the plugin, avoid multiple observers.
      bc.stop?.();

      // Initialize any already-rendered components (Obsidian loads long after DOMContentLoaded).
      bc.initAll?.();

      // Start observing future DOM changes (for views created later).
      bc.start?.();

      this._basecoatStarted = true;
      (this as unknown as { _basecoatApi: unknown })._basecoatApi = bc;
      log.info(`Basecoat initAll + start OK`);
    } catch (e) {
      log.warn(`Basecoat init failed`, e);
    }
  }

  private _stopBasecoatRuntime() {
    if (!this._basecoatStarted) return;
    try {
      const bc = getBasecoatApi();
      bc?.stop?.();
    } catch (e) { log.swallow("stop basecoat runtime", e); }
    this._basecoatStarted = false;
  }

  private _getActiveLeafSafe(): WorkspaceLeaf | null {
    const ws = this.app.workspace;
    if (typeof ws?.getActiveLeaf === "function") return ws.getActiveLeaf() ?? null;
    return ws?.activeLeaf ?? null;
  }

  private _updateStatusBarVisibility(leaf: WorkspaceLeaf | null) {
    const viewType = leaf?.view?.getViewType?.();
    const hide = !!viewType && this._hideStatusBarViewTypes.has(viewType);
    document.body.classList.toggle("sprout-hide-status-bar", hide);
  }

  private _normaliseSettingsInPlace() {
    const s = this.settings;
    s.scheduler ??= {} as SproutSettings["scheduler"];
    s.home ??= {} as SproutSettings["home"];
    s.home.pinnedDecks ??= [];
    s.home.githubStars ??= { count: null, fetchedAt: null };

    s.scheduler.learningStepsMinutes = cleanPositiveNumberArray(
      s.scheduler.learningStepsMinutes,
      DEFAULT_SETTINGS.scheduler.learningStepsMinutes,
    );

    s.scheduler.relearningStepsMinutes = cleanPositiveNumberArray(
      s.scheduler.relearningStepsMinutes,
      DEFAULT_SETTINGS.scheduler.relearningStepsMinutes,
    );

    s.scheduler.requestRetention = clamp(
      Number(s.scheduler.requestRetention ?? DEFAULT_SETTINGS.scheduler.requestRetention),
      0.8,
      0.97,
    );

    const legacyKeys = [
      "graduatingIntervalDays",
      "easyBonus",
      "hardFactor",
      "minEase",
      "maxEase",
      "easeDeltaAgain",
      "easeDeltaHard",
      "easeDeltaEasy",
    ];
    for (const k of legacyKeys) {
      if (k in s.scheduler) delete (s.scheduler as Record<string, unknown>)[k];
    }
  }

  /**
   * Ensures exactly one leaf exists for a given view type.
   * If multiple exist, detaches the extras and returns the kept leaf.
   */
  private _ensureSingleLeafOfType(viewType: string): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (!leaves.length) return null;

    const [keep, ...extras] = leaves;

    for (const l of extras) {
      try {
        l.detach();
      } catch (e) { log.swallow("detach extra leaf", e); }
    }

    return keep;
  }

  async onload() {
    try {
      // ✅ IMPORTANT: Basecoat runtime init for Obsidian (DOMContentLoaded already happened)
      this._initBasecoatRuntime();

      this._bc = {
        VIEW_TYPE_REVIEWER,
        VIEW_TYPE_WIDGET,
        VIEW_TYPE_BROWSER,
        VIEW_TYPE_ANALYTICS,
        VIEW_TYPE_HOME,
        BRAND,
        DEFAULT_SETTINGS,
        deepMerge,
        SproutReviewerView,
        SproutWidgetView,
        SproutCardBrowserView,
        SproutAnalyticsView,
        SproutHomeView,
        SproutSettingsTab,
        syncQuestionBank,
        CardCreatorModal,
        ParseErrorModal,
      };

      const root = (await this.loadData()) || {};
      this.settings = deepMerge(DEFAULT_SETTINGS, (root).settings || {});
      this._normaliseSettingsInPlace();

      this.store = new JsonStore(this);
      this.store.load(root);

      registerReadingViewPrettyCards(this);

      this.registerView(VIEW_TYPE_REVIEWER, (leaf) => new SproutReviewerView(leaf, this));
      this.registerView(VIEW_TYPE_WIDGET, (leaf) => new SproutWidgetView(leaf, this));
      this.registerView(VIEW_TYPE_BROWSER, (leaf) => new SproutCardBrowserView(leaf, this));
      this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new SproutAnalyticsView(leaf, this));
      this.registerView(VIEW_TYPE_HOME, (leaf) => new SproutHomeView(leaf, this));

      this.addSettingTab(new SproutSettingsTab(this.app, this));

      // Commands (hotkeys default to none; users can bind in Settings → Hotkeys)
      this.addCommand({
        id: "sprout-sync-flashcards",
        name: "Sync Flashcards",
        hotkeys: [],
        callback: async () => this._runSync(),
      });

      this.addCommand({
        id: "sprout-open",
        name: "Open Sprout",
        hotkeys: [],
        callback: async () => this.openHomeTab(),
      });

      this.addCommand({
        id: "sprout-add-flashcard",
        name: "Add flashcard to note",
        hotkeys: [],
        callback: () => this.openAddFlashcardModal(),
      });

      // Replace dropdown with separate ribbon icons (desktop + mobile)
      this._registerRibbonIcons();
      this._registerEditorContextMenu();

      // Hide status bar when Boot Camp views are active
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          this._updateStatusBarVisibility(leaf ?? null);
        }),
      );

      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          const f = file instanceof TFile ? file : null;
          this.app.workspace
            .getLeavesOfType(VIEW_TYPE_WIDGET)
            .forEach((leaf) => (leaf.view as { onFileOpen?(f: TFile | null): void })?.onFileOpen?.(f));
        }),
      );

      this.app.workspace.onLayoutReady(() => {
        if (this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET).length === 0) {
          void this.openWidgetSafe();
        }
        // Ensure status bar class matches the active leaf after layout settles
        this._updateStatusBarVisibility(this._getActiveLeafSafe());
      });

      await this.saveAll();
      void this.refreshGithubStars();
      log.info(`loaded`);
    } catch (e) {
      log.error(`failed to load`, e);
      new Notice(`${BRAND}: failed to load. See console for details.`);
    }
  }

  onunload() {
    try {
      void this.saveAll();
    } catch (e) { log.swallow("save all on unload", e); }
    this._destroyRibbonIcons();
    document.body.classList.remove("sprout-hide-status-bar");

    // ✅ stop Basecoat observer on unload (helps plugin reload / dev)
    this._stopBasecoatRuntime();
  }

  private _destroyRibbonIcons() {
    for (const el of this._ribbonEls) {
      try {
        el.remove();
      } catch (e) { log.swallow("remove ribbon icon", e); }
    }
    this._ribbonEls = [];
  }

  _getActiveMarkdownFile(): TFile | null {
    const f = this.app.workspace.getActiveFile();
    return f instanceof TFile ? f : null;
  }

  private _ensureEditingNoteEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    if (view.getMode() !== "source") return null;
    const editor = view.editor;
    if (!editor) return null;
    return { view, editor };
  }

  openAddFlashcardModal(forcedType?: "basic" | "cloze" | "mcq" | "io") {
    const ok = this._ensureEditingNoteEditor();
    if (!ok) {
      new Notice("Must be editing a note to add a flashcard");
      return;
    }

    if (forcedType === "io") {
      new ImageOcclusionCreatorModal(this.app, this).open();
    } else {
      new CardCreatorModal(this.app, this, forcedType).open();
    }
  }

  // -----------------------
  // Editor right-click menu
  // -----------------------

  private _registerEditorContextMenu() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, _editor: any, view: any) => {
        if (!(view instanceof MarkdownView)) return;

        const mode = view.getMode();
        if (mode !== "source") return;

        if (!(view.file instanceof TFile)) return;

        // Add the item with submenu
        let itemDom: HTMLElement | null = null;

        menu.addItem((item) => {
          item.setTitle("Add Flashcard").setIcon("plus");

          // Create submenu
          const submenu = item.setSubmenu?.();
          if (submenu) {
            submenu.addItem((subItem: any) => {
              subItem.setTitle("Basic").setIcon("file-text").onClick(() => this.openAddFlashcardModal("basic"));
            });
            submenu.addItem((subItem: any) => {
              subItem.setTitle("Cloze").setIcon("file-minus").onClick(() => this.openAddFlashcardModal("cloze"));
            });
            submenu.addItem((subItem: any) => {
              subItem.setTitle("Multiple Choice").setIcon("list").onClick(() => this.openAddFlashcardModal("mcq"));
            });
            submenu.addItem((subItem: any) => {
              subItem.setTitle("Image Occlusion").setIcon("image").onClick(() => this.openAddFlashcardModal("io"));
            });
          }

          itemDom = item?.dom ?? null;
        });

        const positionAfterExternalLink = () => {
          try {
            const menuDom: HTMLElement | null = menu?.dom ?? null;
            if (!menuDom || !itemDom) return;

            let node: HTMLElement | null = itemDom;
            while (node && node.parentElement && node.parentElement !== menuDom) {
              node = node.parentElement;
            }
            if (!node || node.parentElement !== menuDom) return;

            // Find "Add external link" menu item
            const menuItems = Array.from(menuDom.children);
            let externalLinkItem: Element | null = null;

            for (const item of menuItems) {
              const titleEl = item.querySelector(".menu-item-title");
              if (titleEl && titleEl.textContent?.includes("Add external link")) {
                externalLinkItem = item;
                break;
              }
            }

            // Position after external link, or at top if not found
            if (externalLinkItem && externalLinkItem.nextSibling) {
              menuDom.insertBefore(node, externalLinkItem.nextSibling);
            } else if (externalLinkItem) {
              menuDom.appendChild(node);
            } else {
              // Fallback: insert after first item (likely "Add link")
              if (menuDom.children.length > 1 && menuDom.children[1]) {
                menuDom.insertBefore(node, menuDom.children[1]);
              }
            }
          } catch (e) { log.swallow("reposition menu item", e); }
        };

        positionAfterExternalLink();
        setTimeout(positionAfterExternalLink, 0);
      }),
    );
  }

  public async syncBank(): Promise<void> {
    await this._runSync();
  }

  public refreshAllViews(): void {
    this._refreshOpenViews();
  }

  async _runSync() {
    const res = await syncQuestionBank(this);

    const notice = formatSyncNotice("Sync complete", res, { includeDeleted: true });
    new Notice(notice);

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }
    // Do not refresh or update views; sync runs in background and only shows notice when done.
  }

  async saveAll() {
    const root: any = (await this.loadData()) || {};
    root.settings = this.settings;
    root.store = this.store.data;
    await this.saveData(root);
  }

  private _refreshOpenViews() {
    const refresh = (type: string) =>
      this.app.workspace.getLeavesOfType(type).forEach((l) => {
        const v = l.view as ItemView & { onRefresh?(): void };
        v.onRefresh?.();
      });
    refresh(VIEW_TYPE_REVIEWER);
    refresh(VIEW_TYPE_WIDGET);
    refresh(VIEW_TYPE_BROWSER);
    refresh(VIEW_TYPE_ANALYTICS);
    refresh(VIEW_TYPE_HOME);
  }

  async refreshGithubStars(force = false) {
    const s = this.settings;
    s.home ??= {} as SproutSettings["home"];
    s.home.githubStars ??= { count: null, fetchedAt: null };

    const lastAt = Number(s.home.githubStars.fetchedAt || 0);
    const staleMs = 6 * 60 * 60 * 1000;
    if (!force && lastAt && Date.now() - lastAt < staleMs) return;

    try {
      const res = await requestUrl({
        url: "https://api.github.com/repos/ctrlaltwill/sprout",
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      });
      const count = Number(res?.json?.stargazers_count);
      if (Number.isFinite(count)) {
        s.home.githubStars.count = count;
        s.home.githubStars.fetchedAt = Date.now();
        await this.saveAll();
        this._refreshOpenViews();
      }
    } catch {
      // offline or rate-limited; keep last known value
    }
  }

  public async resetSettingsToDefaults(): Promise<void> {
    this.settings = clonePlain(DEFAULT_SETTINGS);
    this._normaliseSettingsInPlace();
    await this.saveAll();
    this._refreshOpenViews();
  }

  public async resetToDefaultSettings(): Promise<void> {
    return this.resetSettingsToDefaults();
  }
  public async resetDefaultSettings(): Promise<void> {
    return this.resetSettingsToDefaults();
  }
  public async loadDefaultSettings(): Promise<void> {
    return this.resetSettingsToDefaults();
  }

  private _isCardStateLike(v: any): v is CardState {
    if (!v || typeof v !== "object") return false;

    const stageOk =
      v.stage === "new" ||
      v.stage === "learning" ||
      v.stage === "review" ||
      v.stage === "relearning" ||
      v.stage === "suspended";

    if (!stageOk) return false;

    const numsOk =
      typeof v.due === "number" &&
      typeof v.scheduledDays === "number" &&
      typeof v.reps === "number" &&
      typeof v.lapses === "number" &&
      typeof v.learningStepIndex === "number";

    return numsOk;
  }

  private _resetCardStateMapInPlace(map: Record<string, any>, now: number): number {
    let count = 0;

    for (const [id, raw] of Object.entries(map)) {
      if (!this._isCardStateLike(raw)) continue;

      const prev: CardState = { id, ...(raw as Record<string, unknown>) } as CardState;
      map[id] = resetCardScheduling(prev, now, this.settings);
      count++;
    }

    return count;
  }

  private _looksLikeCardStateMap(node: any): node is Record<string, any> {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return false;

    for (const v of Object.values(node)) {
      if (this._isCardStateLike(v)) return true;
    }
    return false;
  }

  async resetAllCardScheduling(): Promise<void> {
    const now = Date.now();
    let total = 0;

    const visited = new Set<any>();
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      if (this._looksLikeCardStateMap(node)) {
        total += this._resetCardStateMapInPlace(node, now);
      }

      for (const v of Object.values(node)) walk(v);
    };

    walk(this.store.data);

    await this.saveAll();
    this._refreshOpenViews();

    new Notice(`${BRAND}: reset scheduling for ${total} cards.`);
  }

  async resetAllAnalyticsData(): Promise<void> {
    // Clear analytics events and review log
    if (this.store.data.analytics) {
      this.store.data.analytics.events = [];
      this.store.data.analytics.seq = 0;
    }

    if (Array.isArray(this.store.data.reviewLog)) {
      this.store.data.reviewLog = [];
    }

    await this.saveAll();
    this._refreshOpenViews();

    new Notice(`${BRAND}: analytics data cleared.`);
  }

  async openReviewerTab(forceNew: boolean = false) {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_REVIEWER);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_REVIEWER, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  async openHomeTab(forceNew: boolean = false) {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_HOME);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return;
      }
    }

    // Fix: Open new tab after current active tab, then select it
    const ws = this.app.workspace;
    const activeLeaf = ws.getActiveLeaf?.() ?? ws.activeLeaf;
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_HOME, active: true });
    // If possible, move the new tab after the active tab
    try {
      if (activeLeaf && activeLeaf !== leaf && typeof ws.moveLeaf === "function") {
        ws.moveLeaf(leaf, ws.getGroup(activeLeaf), (ws.getGroup(activeLeaf)?.index ?? 0) + 1);
      }
    } catch (e) { log.swallow("move leaf after active tab", e); }
    void ws.revealLeaf(leaf);
  }

  async openBrowserTab(forceNew: boolean = false) {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_BROWSER);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_BROWSER, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  async openAnalyticsTab(forceNew: boolean = false) {
    if (!forceNew) {
      const existing = this._ensureSingleLeafOfType(VIEW_TYPE_ANALYTICS);
      if (existing) {
        void this.app.workspace.revealLeaf(existing);
        return;
      }
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_ANALYTICS, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  private async openWidgetSafe(): Promise<void> {
    try {
      await this.openWidget();
    } catch (e) {
      log.error(`failed to open widget`, e);
      new Notice(`${BRAND}: failed to open widget. See console for details.`);
    }
  }

  async openWidget() {
    const existing = this._ensureSingleLeafOfType(VIEW_TYPE_WIDGET);
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }

    let leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_WIDGET, active: true, state: {} });
    void this.app.workspace.revealLeaf(leaf);
  }

  private _openSproutSettings() {
    try {
      if (this.app.setting) {
        if (typeof this.app.setting.open === "function") this.app.setting.open();
      } else if (this.app.commands?.executeCommandById) {
        try {
          this.app.commands.executeCommandById("app:open-settings");
        } catch (e) { log.swallow("execute open-settings command", e); }
      }

      const setting = this.app.setting;
      const id = this.manifest?.id;

      if (setting && id) {
        if (typeof setting.openTabById === "function") {
          setting.openTabById(id);
          return;
        }
        if (typeof setting.openTab === "function") {
          try {
            setting.openTab(id);
            return;
          } catch (e) { log.swallow("open settings tab by id", e); }
        }
      }
    } catch (e) {
      log.error(`failed to open settings`, e);
      new Notice(`${BRAND}: Unable to open settings automatically. Open Settings → Community plugins → ${BRAND}.`);
    }
  }

  // --------------------------------
  // Ribbon icons (desktop + mobile)
  // --------------------------------

  private _registerRibbonIcons() {
    // Always use separate icons now (desktop and mobile).
    // Also: keep the editor context-menu for "Insert Flashcard".

    this._destroyRibbonIcons();

    const add = (icon: string, title: string, onClick: (ev: MouseEvent) => void) => {
      const el = this.addRibbonIcon(icon, title, onClick);
      el.addClass("sprout-ribbon-action");
      el.addClass("bc");
      this._ribbonEls.push(el);
      return el;
    };

    // 1) Home - single instance by default, multiple with Cmd/Ctrl+Click
    add("sprout", BRAND, (ev: MouseEvent) => {
      const forceNew = ev.metaKey || ev.ctrlKey;
      void this.openHomeTab(forceNew);
    });
  }
}
