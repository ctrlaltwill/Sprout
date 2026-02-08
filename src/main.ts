/**
 * @file src/main.ts
 * @summary Entry point for the Sprout Obsidian plugin. Extends the Obsidian Plugin class
 * to register views (Reviewer, Widget, Browser, Analytics, Home), commands, ribbon icons,
 * editor context-menu items, settings, and the Basecoat UI runtime. Handles plugin lifecycle
 * (load/unload), settings normalisation, data persistence, sync orchestration, GitHub star
 * fetching, and scheduling/analytics reset utilities.
 *
 * @exports
 *   - SproutPlugin (default) — main plugin class extending Obsidian's Plugin
 */

import "basecoat-css/all";

import {
  Plugin,
  Notice,
  TFile,
  type ItemView,
  type MenuItem,
  type Editor,
  MarkdownView,
  type Menu,
  type WorkspaceLeaf,
  Platform,
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
import { registerReadingViewPrettyCards, teardownReadingView } from "./reading/reading-view";
import { removeAosErrorHandler } from "./core/aos-loader";

import { JsonStore } from "./core/store";
import { queryFirst } from "./core/ui";
import { SproutReviewerView } from "./reviewer/review-view";
import { SproutWidgetView } from "./widget/sprout-widget-view";
import { SproutCardBrowserView } from "./browser/sprout-card-browser-view";
import { SproutAnalyticsView } from "./analytics/analytics-view";
import { SproutHomeView } from "./home/sprout-home-view";
import { SproutSettingsTab } from "./settings/sprout-settings-tab";
import { formatSyncNotice, syncQuestionBank } from "./sync/sync-engine";
import { joinPath, safeStatMtime } from "./sync/backup";
import { CardCreatorModal } from "./modals/card-creator-modal";
import { ImageOcclusionCreatorModal } from "./modals/image-occlusion-creator-modal";
import { ParseErrorModal } from "./modals/parse-error-modal";
// Anki modals are lazy-loaded to defer sql.js WASM parsing until needed
// import { AnkiImportModal } from "./modals/anki-import-modal";
// import { AnkiExportModal } from "./modals/anki-export-modal";
import { resetCardScheduling, type CardState } from "./scheduler/scheduler";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function cleanPositiveNumberArray(v: unknown, fallback: number[]): number[] {
  const arr = Array.isArray(v) ? v : [];
  const out = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  return out.length ? out : fallback;
}

function clonePlain<T>(x: T): T {
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x)) as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
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
  _bc: unknown;

  private _basecoatStarted = false;

  // Save mutex to prevent concurrent read-modify-write races
  private _saving: Promise<void> | null = null;

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

  private _isActiveHiddenViewType(): boolean {
    const ws = this.app.workspace;
    const activeLeaf = ws?.getMostRecentLeaf?.() ?? null;
    const viewType = activeLeaf?.view?.getViewType?.();
    return viewType ? this._hideStatusBarViewTypes.has(viewType) : false;
  }

  private _updateStatusBarVisibility(leaf: WorkspaceLeaf | null) {
    const viewType = leaf?.view?.getViewType?.();
    const hide = viewType
      ? this._hideStatusBarViewTypes.has(viewType)
      : this._isActiveHiddenViewType();
    document.body.classList.toggle("sprout-hide-status-bar", hide);
  }

  /**
   * Migrate legacy settings keys from pre-1.1 structure to current layout.
   * Runs once on load; safe to call multiple times (no-ops if already migrated).
   */
  private _migrateSettingsInPlace() {
    const s = this.settings as Record<string, unknown>;

    const move = (oldKey: string, newKey: string) => {
      if (s[oldKey] != null && s[newKey] == null) {
        s[newKey] = s[oldKey];
      }
      if (s[oldKey] != null) delete s[oldKey];
    };

    // Rename top-level groups
    move("home", "general");
    move("appearance", "general");
    move("reviewer", "study");
    move("widget", "study");
    move("scheduler", "scheduling");

    // Merge imageOcclusion + cardAttachments → storage
    const io = s.imageOcclusion as Record<string, unknown> | undefined;
    const ca = s.cardAttachments as Record<string, unknown> | undefined;
    if (io || ca) {
      const storage = (s.storage ?? {}) as Record<string, unknown>;
      if (io?.attachmentFolderPath != null && storage.imageOcclusionFolderPath == null) {
        storage.imageOcclusionFolderPath = io.attachmentFolderPath;
      }
      if (ca?.attachmentFolderPath != null && storage.cardAttachmentFolderPath == null) {
        storage.cardAttachmentFolderPath = ca.attachmentFolderPath;
      }
      s.storage = storage;
      delete s.imageOcclusion;
      delete s.cardAttachments;
    }
  }

  private _normaliseSettingsInPlace() {
    const s = this.settings;
    s.scheduling ??= {} as SproutSettings["scheduling"];
    s.general ??= {} as SproutSettings["general"];
    s.general.pinnedDecks ??= [];
    s.general.githubStars ??= { count: null, fetchedAt: null };

    s.scheduling.learningStepsMinutes = cleanPositiveNumberArray(
      s.scheduling.learningStepsMinutes,
      DEFAULT_SETTINGS.scheduling.learningStepsMinutes,
    );

    s.scheduling.relearningStepsMinutes = cleanPositiveNumberArray(
      s.scheduling.relearningStepsMinutes,
      DEFAULT_SETTINGS.scheduling.relearningStepsMinutes,
    );

    s.scheduling.requestRetention = clamp(
      Number(s.scheduling.requestRetention ?? DEFAULT_SETTINGS.scheduling.requestRetention),
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
      if (k in s.scheduling) delete (s.scheduling as Record<string, unknown>)[k];
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

      const root = (await this.loadData()) as unknown;
      const rootObj = isPlainObject(root) ? root : {};
      const rootSettings = isPlainObject(rootObj.settings)
        ? (rootObj.settings as Partial<SproutSettings>)
        : {};
      this.settings = deepMerge(DEFAULT_SETTINGS, rootSettings);
      this._migrateSettingsInPlace();
      this._normaliseSettingsInPlace();

      this.store = new JsonStore(this);
      this.store.load(rootObj);

      registerReadingViewPrettyCards(this);

      this.registerView(VIEW_TYPE_REVIEWER, (leaf) => new SproutReviewerView(leaf, this));
      this.registerView(VIEW_TYPE_WIDGET, (leaf) => new SproutWidgetView(leaf, this));
      this.registerView(VIEW_TYPE_BROWSER, (leaf) => new SproutCardBrowserView(leaf, this));
      this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new SproutAnalyticsView(leaf, this));
      this.registerView(VIEW_TYPE_HOME, (leaf) => new SproutHomeView(leaf, this));

      this.addSettingTab(new SproutSettingsTab(this.app, this));

      // Commands (hotkeys default to none; users can bind in Settings → Hotkeys)
      this.addCommand({
        id: "sync-flashcards",
        name: "Sync flashcards",
        callback: async () => this._runSync(),
      });

      this.addCommand({
        id: "open",
        name: "Sprout",
        callback: async () => this.openHomeTab(),
      });

      this.addCommand({
        id: "add-flashcard",
        name: "Add flashcard to note",
        callback: () => this.openAddFlashcardModal(),
      });

      this.addCommand({
        id: "import-anki",
        name: "Import from Anki (.apkg)",
        callback: async () => {
          const { AnkiImportModal } = await import("./modals/anki-import-modal");
          new AnkiImportModal(this).open();
        },
      });

      this.addCommand({
        id: "export-anki",
        name: "Export to Anki (.apkg)",
        callback: async () => {
          const { AnkiExportModal } = await import("./modals/anki-export-modal");
          new AnkiExportModal(this).open();
        },
      });

      // Replace dropdown with separate ribbon icons (desktop + mobile)
      this._registerRibbonIcons();
      this._registerEditorContextMenu();
      this._registerMarkdownSourceClozeShortcuts();

      // Hide status bar when Sprout views are active
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
        // Ensure status bar class matches the active view after layout settles
        this._updateStatusBarVisibility(null);
      });

      await this.saveAll();
      void this.refreshGithubStars();
      log.info(`loaded`);
    } catch (e) {
      log.error(`failed to load`, e);
      new Notice(`Failed to load. See console for details.`);
    }
  }

  onunload() {
    // Best-effort save: await pending save, then fire one last save.
    // Obsidian calls onunload synchronously so we can't truly await,
    // but we kick it off so the microtask completes before the process exits.
    const pending = this._saving ?? Promise.resolve();
    void pending
      .then(() => this._doSave())
      .catch((e) => log.swallow("save all on unload", e));

    this._bc = null;
    this._destroyRibbonIcons();
    document.body.classList.remove("sprout-hide-status-bar");

    // Tear down reading-view observers + window listeners
    teardownReadingView();

    // Remove global AOS error suppression handler
    removeAosErrorHandler();

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

  private _applyClozeShortcutToEditor(editor: Editor, clozeIndex = 1) {
    const selection = String(editor.getSelection?.() ?? "");
    const tokenStart = `{{c${clozeIndex}::`;

    if (selection.length > 0) {
      editor.replaceSelection(`${tokenStart}${selection}}}`);
      return;
    }

    const cursor = editor.getCursor();
    editor.replaceSelection(`{{c${clozeIndex}::}}`);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + tokenStart.length });
  }

  private _registerMarkdownSourceClozeShortcuts() {
    this.registerDomEvent(
      document,
      "keydown",
      (ev: KeyboardEvent) => {
        const key = String(ev.key || "").toLowerCase();
        if (key !== "c" && ev.code !== "KeyC") return;

        const primary = Platform.isMacOS ? ev.metaKey : ev.ctrlKey;
        if (!primary || !ev.shiftKey) return;

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "source" || !view.editor) return;

        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (!view.contentEl?.contains(target)) return;
        if (!target.closest(".cm-editor")) return;

        ev.preventDefault();
        ev.stopPropagation();
        this._applyClozeShortcutToEditor(view.editor, 1);
      },
      { capture: true },
    );
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
      this.app.workspace.on("editor-menu", (menu: Menu, _editor, view) => {
        if (!(view instanceof MarkdownView)) return;

        const mode = view.getMode();
        if (mode !== "source") return;

        if (!(view.file instanceof TFile)) return;

        // Add the item with submenu
        let itemDom: HTMLElement | null = null;

        menu.addItem((item) => {
          item.setTitle("Add flashcard").setIcon("plus");

          // Create submenu
          const submenu = item.setSubmenu?.();
          if (submenu) {
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Basic").setIcon("file-text").onClick(() => this.openAddFlashcardModal("basic"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Cloze").setIcon("file-minus").onClick(() => this.openAddFlashcardModal("cloze"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Multiple choice").setIcon("list").onClick(() => this.openAddFlashcardModal("mcq"));
            });
            submenu.addItem((subItem: MenuItem) => {
              subItem.setTitle("Image occlusion").setIcon("image").onClick(() => this.openAddFlashcardModal("io"));
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
              const titleEl = queryFirst(item, ".menu-item-title");
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

    const tagsDeleted = Number((res as { tagsDeleted?: number }).tagsDeleted ?? 0);
    if (tagsDeleted > 0) {
      new Notice(`Deleted ${tagsDeleted}, unused tag${tagsDeleted === 1 ? "" : "s"}`);
    }

    if (res.quarantinedCount > 0) {
      new ParseErrorModal(this.app, this, res.quarantinedIds).open();
    }
    // Do not refresh or update views; sync runs in background and only shows notice when done.
  }

  async saveAll() {
    // Queue through mutex to prevent concurrent read-modify-write races
    while (this._saving) await this._saving;
    this._saving = this._doSave();
    try { await this._saving; } finally { this._saving = null; }
  }

  private _getDataJsonPath(): string | null {
    const configDir = this.app?.vault?.configDir;
    const pluginId = this.manifest?.id;
    if (!configDir || !pluginId) return null;
    return joinPath(configDir, "plugins", pluginId, "data.json");
  }

  private async _doSave() {
    const adapter = this.app?.vault?.adapter ?? null;
    const dataPath = this._getDataJsonPath();
    const canStat = !!(adapter && dataPath);
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const mtimeBefore = canStat ? await safeStatMtime(adapter, dataPath) : 0;
      const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;
      root.settings = this.settings;
      root.store = this.store.data;

      if (canStat) {
        const mtimeBeforeWrite = await safeStatMtime(adapter, dataPath);
        if (mtimeBefore && mtimeBeforeWrite && mtimeBeforeWrite !== mtimeBefore) {
          // data.json changed during our read; retry with latest snapshot
          continue;
        }
      }

      await this.saveData(root);
      return;
    }

    // Last resort: write latest snapshot even if the file is churny.
    const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;
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
    s.general ??= {} as SproutSettings["general"];
    s.general.githubStars ??= { count: null, fetchedAt: null };

    const lastAt = Number(s.general.githubStars.fetchedAt || 0);
    const staleMs = 6 * 60 * 60 * 1000;
    if (!force && lastAt && Date.now() - lastAt < staleMs) return;

    try {
      const res = await requestUrl({
        url: "https://api.github.com/repos/ctrlaltwill/sprout",
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
      });
      const json: unknown = res?.json;
      const jsonObj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      const countRaw = jsonObj?.stargazers_count;
      const count = Number(countRaw);
      if (Number.isFinite(count)) {
        s.general.githubStars.count = count;
        s.general.githubStars.fetchedAt = Date.now();
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

  private _isCardStateLike(v: unknown): v is CardState {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;

    const stageOk =
      o.stage === "new" ||
      o.stage === "learning" ||
      o.stage === "review" ||
      o.stage === "relearning" ||
      o.stage === "suspended";

    if (!stageOk) return false;

    const numsOk =
      typeof o.due === "number" &&
      typeof o.scheduledDays === "number" &&
      typeof o.reps === "number" &&
      typeof o.lapses === "number" &&
      typeof o.learningStepIndex === "number";

    return numsOk;
  }

  private _resetCardStateMapInPlace(map: Record<string, unknown>, now: number): number {
    let count = 0;

    for (const [id, raw] of Object.entries(map)) {
      if (!this._isCardStateLike(raw)) continue;

      const prev: CardState = { id, ...(raw as Record<string, unknown>) } as CardState;
      map[id] = resetCardScheduling(prev, now, this.settings);
      count++;
    }

    return count;
  }

  private _looksLikeCardStateMap(node: unknown): node is Record<string, unknown> {
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

    const visited = new Set<object>();
    const walk = (node: unknown) => {
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

    new Notice(`Reset scheduling for ${total} cards.`);
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

    new Notice("Analytics data cleared.");
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
    const activeLeaf = ws.getLeaf(false);
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
      new Notice(`Failed to open widget. See console for details.`);
    }
  }

  async openWidget() {
    const existing = this._ensureSingleLeafOfType(VIEW_TYPE_WIDGET);
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }

    // Always create a new leaf in the right sidebar to avoid hijacking another plugin's leaf
    let leaf = this.app.workspace.getRightLeaf(true);
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_WIDGET, active: true, state: {} });
    void this.app.workspace.revealLeaf(leaf);
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
