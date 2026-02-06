/**
 * @file src/core/header.ts
 * @summary Shared header bar component used by all top-level Sprout views (Home, Study,
 * Flashcards, Analytics). Renders a dropdown navigation switcher, expand/collapse width
 * toggle, sync button, and a "More" popover with split-pane and settings actions. Manages
 * popover lifecycle, keyboard navigation, Obsidian theme synchronisation, and
 * ResizeObserver-based responsive visibility of the width toggle.
 *
 * @exports
 *   - SproutHeaderPage — type alias for the four navigation page identifiers
 *   - SproutHeaderMenuItem — type for items rendered in the More popover menu
 *   - SproutHeader — class that installs and manages the header bar DOM
 *   - createViewHeader — factory function that wires a SproutHeader to any ItemView
 */

import { setIcon, Notice, type App, type WorkspaceLeaf, type ItemView } from "obsidian";
import { MAX_CONTENT_WIDTH, VIEW_TYPE_ANALYTICS, VIEW_TYPE_BROWSER, VIEW_TYPE_REVIEWER, VIEW_TYPE_HOME } from "./constants";
import { log } from "./logger";
import { setCssProps } from "./ui";

export type SproutHeaderPage = "home" | "study" | "flashcards" | "analytics";

export type SproutHeaderMenuItem = {
  label: string;
  icon?: string; // lucide name used by setIcon
  onActivate: () => void;
  destructive?: boolean;
};

type Deps = {
  app: App;
  leaf: WorkspaceLeaf;

  // the view container (ItemView.containerEl)
  containerEl: HTMLElement;

  // current “wide” state + toggle
  getIsWide: () => boolean;
  toggleWide: () => void;

  // sync action
  runSync: () => void;

  // optional: called after nav
  afterNavigate?: () => void;
};

function clearNode(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function clearChildren(node: HTMLElement | null) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export class SproutHeader {
  private deps: Deps;

  private headerNavId: string;
  private topNavPopoverEl: HTMLElement | null = null;
  private topNavCleanup: (() => void) | null = null;

  private moreId: string;
  private moreTriggerEl: HTMLButtonElement | null = null;
  private morePopoverEl: HTMLElement | null = null;
  private moreCleanup: (() => void) | null = null;

  private widthBtnEl: HTMLButtonElement | null = null;
  private widthBtnIconEl: HTMLElement | null = null;
  private widthResizeCleanup: (() => void) | null = null;
  private widthResizeObserver: ResizeObserver | null = null;

  private syncBtnIconEl: HTMLElement | null = null;
  private themeObserver: MutationObserver | null = null;
  // Theme button and mode removed; now syncs with Obsidian

  constructor(deps: Deps) {
    this.deps = deps;
    this.headerNavId = `sprout-topnav-${Math.random().toString(36).slice(2, 9)}`;
    this.moreId = `sprout-more-${Math.random().toString(36).slice(2, 9)}`;
  }

  dispose() {
    this.closeTopNavPopover();
    this.closeMorePopover();
    try {
      this.widthResizeCleanup?.();
    } catch (e) { log.swallow("dispose: widthResizeCleanup", e); }
    this.widthResizeCleanup = null;
    try {
      this.widthResizeObserver?.disconnect();
    } catch (e) { log.swallow("dispose: widthResizeObserver disconnect", e); }
    this.widthResizeObserver = null;
    try {
      this.themeObserver?.disconnect();
    } catch (e) { log.swallow("dispose: themeObserver disconnect", e); }
    this.themeObserver = null;
  }

  install(active: SproutHeaderPage) {
    const viewHeader =
      (this.deps.containerEl.querySelector(":scope > .view-header")) ??
      (this.deps.containerEl.querySelector(".view-header"));
    if (viewHeader) viewHeader.classList.add("bc", "sprout-header");

    this.installHeaderDropdownNav(active);
    this.installHeaderActionsButtonGroup(active);

    this.updateWidthButtonLabel();
    this.updateSyncButtonIcon();
    this.syncThemeWithObsidian();

    // Ensure More is CLOSED on install
    this.closeMorePopover();
  }

  updateWidthButtonLabel() {
    if (!this.widthBtnEl) return;

    const isWide = this.deps.getIsWide();
    // Only hide if the available header space is too narrow, not based on the button group width
    const header =
      (this.deps.containerEl?.querySelector(":scope > .view-header")) ??
      (this.deps.containerEl?.querySelector(".view-header"));
    const availableWidth = header?.clientWidth ?? this.deps.containerEl?.clientWidth ?? 0;
    const hide =
      availableWidth > 0 ? availableWidth <= MAX_CONTENT_WIDTH : typeof window !== "undefined" && window.innerWidth <= MAX_CONTENT_WIDTH;
    this.widthBtnEl.classList.toggle("sprout-is-hidden", hide);
    this.widthBtnEl.setAttribute("data-tooltip", isWide ? "Collapse table" : "Expand table");

    const text = isWide ? "Collapse" : "Expand";
    const textNode = this.widthBtnEl.querySelector("[data-sprout-label]");
    if (textNode) textNode.textContent = text;

    if (this.widthBtnIconEl) {
      clearChildren(this.widthBtnIconEl);
      setIcon(this.widthBtnIconEl, isWide ? "minimize-2" : "maximize-2");
    }
  }

  updateSyncButtonIcon() {
    if (!this.syncBtnIconEl) return;
    clearChildren(this.syncBtnIconEl);
    setIcon(this.syncBtnIconEl, "refresh-cw");
  }


  // Sync theme with Obsidian and append .theme-dark to .sprout wrapper
  private syncThemeWithObsidian() {
    const updateTheme = () => {
      const isDark = document.body.classList.contains("theme-dark");
      const sprout = this.deps.containerEl?.closest('.sprout');
      if (sprout) {
        sprout.classList.toggle("theme-dark", isDark);
        sprout.classList.toggle("theme-light", !isDark);
      }
    };
    updateTheme();
    // Listen for Obsidian theme changes
    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(updateTheme);
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  // ---------------------------
  // Navigation
  // ---------------------------

  private async navigate(page: SproutHeaderPage) {
    const type =
      page === "home"
        ? VIEW_TYPE_HOME
        : page === "study"
          ? VIEW_TYPE_REVIEWER
          : page === "analytics"
            ? VIEW_TYPE_ANALYTICS
            : VIEW_TYPE_BROWSER;

    await this.deps.leaf.setViewState?.({ type, active: true });
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- fire-and-forget; navigation completes asynchronously and errors are non-critical
    this.deps.app.workspace.revealLeaf(this.deps.leaf);
    this.deps.afterNavigate?.();
  }

  // ---------------------------
  // Top Nav popover (radio)
  // ---------------------------

  private closeTopNavPopover() {
    try {
      this.topNavCleanup?.();
    } catch (e) { log.swallow("closeTopNavPopover: topNavCleanup", e); }
    this.topNavCleanup = null;

    if (this.topNavPopoverEl) {
      try {
        this.topNavPopoverEl.classList.remove("is-open");
        this.topNavPopoverEl.remove();
      } catch (e) { log.swallow("closeTopNavPopover: remove popover element", e); }
    }
    this.topNavPopoverEl = null;

    const trigger = this.deps.containerEl.querySelector(`#${this.headerNavId}-trigger`);
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  private openTopNavPopover(trigger: HTMLElement, active: SproutHeaderPage) {
    this.closeTopNavPopover();
    trigger.setAttribute("aria-expanded", "true");

    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const root = document.createElement("div");
    root.className = "dropdown-menu";
    root.classList.add("sprout-popover-overlay");
    sproutWrapper.appendChild(root);

    const panel = document.createElement("div");
    panel.className = "min-w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto";
    root.appendChild(panel);

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.className = "flex flex-col";
    panel.appendChild(menu);

    const mkRadio = (label: string, page: SproutHeaderPage, checked: boolean, icon?: string) => {
      const item = document.createElement("div");
      item.className =
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", checked ? "true" : "false");
      item.tabIndex = 0;

      const dotWrap = document.createElement("div");
      dotWrap.className = "size-4 flex items-center justify-center";
      item.appendChild(dotWrap);

      const dot = document.createElement("div");
      dot.className = "size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
      dot.setAttribute("aria-hidden", "true");
      dotWrap.appendChild(dot);

      const txt = document.createElement("span");
      txt.textContent = label;
      item.appendChild(txt);

      if (icon) {
        const spacer = document.createElement("span");
        spacer.className = "ml-auto";
        item.appendChild(spacer);

        const ic = document.createElement("span");
        ic.className =
          "inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground group-hover:text-inherit";
        ic.setAttribute("aria-hidden", "true");
        setIcon(ic, icon);
        item.appendChild(ic);
      }

      const activate = () => {
        this.closeTopNavPopover();
        void this.navigate(page);
      };

      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        activate();
      });

      item.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          this.closeTopNavPopover();
          (trigger).focus();
        }
      });

      menu.appendChild(item);
    };

    mkRadio("Home", "home", active === "home");
    const sep = document.createElement("div");
    sep.className = "my-1 h-px bg-border";
    sep.setAttribute("role", "separator");
    menu.appendChild(sep);
    mkRadio("Analytics", "analytics", active === "analytics");
    mkRadio("Flashcards", "flashcards", active === "flashcards");
    mkRadio("Study", "study", active === "study");

    document.body.appendChild(sproutWrapper);
    this.topNavPopoverEl = root;
    root.classList.add("is-open");

    const place = () => {
      const r = trigger.getBoundingClientRect();
      const margin = 8;
      const width = 260;
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      const top = Math.max(margin, Math.min(r.bottom + 6, window.innerHeight - margin));
      setCssProps(root, "--sprout-popover-left", `${left}px`);
      setCssProps(root, "--sprout-popover-top", `${top}px`);
    };

    place();

    const onResizeOrScroll = () => place();

    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (root.contains(t) || trigger.contains(t)) return;
      this.closeTopNavPopover();
    };

    window.addEventListener("resize", onResizeOrScroll, true);
    window.addEventListener("scroll", onResizeOrScroll, true);

    const tid = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
    }, 0);

    this.topNavCleanup = () => {
      window.clearTimeout(tid);
      window.removeEventListener("resize", onResizeOrScroll, true);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }

  private installHeaderDropdownNav(active: SproutHeaderPage) {
    const navHost =
      (this.deps.containerEl.querySelector<HTMLElement>(
        ":scope > .view-header .view-header-left .view-header-nav-buttons",
      )) ??
      (this.deps.containerEl.querySelector<HTMLElement>(".view-header .view-header-left .view-header-nav-buttons"));

    if (!navHost) return;

    clearNode(navHost);

    navHost.classList.add("sprout-nav-host");

    const root = document.createElement("div");
    root.id = this.headerNavId;
    root.className = "dropdown-menu";
    root.classList.add("sprout-dropdown-root");
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    sproutWrapper.appendChild(root);
    navHost.appendChild(root);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = `${this.headerNavId}-trigger`;
    trigger.className = "btn-outline h-7 px-2 text-xs inline-flex items-center gap-2";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    // Removed tooltip per user request
    root.appendChild(trigger);

    const trigText = document.createElement("span");
    trigText.className = "truncate";
    trigText.textContent =
      active === "home" ? "Home" : active === "analytics" ? "Analytics" : active === "study" ? "Study" : "Flashcards";
    trigger.appendChild(trigText);

    const trigIcon = document.createElement("span");
    trigIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
    trigIcon.setAttribute("aria-hidden", "true");
    setIcon(trigIcon, "chevron-down");
    trigger.appendChild(trigIcon);

    trigger.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.topNavPopoverEl) this.closeTopNavPopover();
      else this.openTopNavPopover(trigger, active);
    });

    this.closeTopNavPopover();
  }

  // ---------------------------
  // “More” popover (custom)
  // ---------------------------

  private closeMorePopover() {
    try {
      this.moreCleanup?.();
    } catch (e) { log.swallow("closeMorePopover: moreCleanup", e); }
    this.moreCleanup = null;

    if (this.morePopoverEl) {
      try {
        this.morePopoverEl.classList.remove("is-open");
        this.morePopoverEl.remove();
      } catch (e) { log.swallow("closeMorePopover: remove popover element", e); }
    }
    this.morePopoverEl = null;

    if (this.moreTriggerEl) this.moreTriggerEl.setAttribute("aria-expanded", "false");
  }

  private openMorePopover(trigger: HTMLElement, items: SproutHeaderMenuItem[]) {
    this.closeMorePopover();
    trigger.setAttribute("aria-expanded", "true");

    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const root = document.createElement("div");
    root.className = "dropdown-menu";
    root.classList.add("sprout-popover-overlay");
    sproutWrapper.appendChild(root);

    const panel = document.createElement("div");
    panel.className = "min-w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 sprout-pointer-auto";
    root.appendChild(panel);

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.className = "flex flex-col";
    panel.appendChild(menu);

    for (const it of items) {
      const row = document.createElement("div");
      row.setAttribute("role", "menuitem");
      row.tabIndex = 0;

      row.className =
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

      if (it.icon) {
        const ic = document.createElement("span");
        ic.className =
          "inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground group-hover:text-inherit";
        ic.setAttribute("aria-hidden", "true");
        setIcon(ic, it.icon);
        row.appendChild(ic);
      }

      const txt = document.createElement("span");
      txt.textContent = it.label;
      row.appendChild(txt);

      const activate = () => {
        this.closeMorePopover();
        it.onActivate();
      };

      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        activate();
      });

      row.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          this.closeMorePopover();
          (trigger).focus();
        }
      });

      menu.appendChild(row);
    }

    document.body.appendChild(sproutWrapper);
    this.morePopoverEl = root;
    root.classList.add("is-open");

    const place = () => {
      const r = trigger.getBoundingClientRect();
      const margin = 8;

      // measure actual panel width so right edges align perfectly
      const panelRect = panel.getBoundingClientRect();
      const popW = Math.max(200, panelRect.width || 260);

      const left = Math.max(margin, Math.min(r.right - popW, window.innerWidth - popW - margin));
      const top = Math.max(margin, Math.min(r.bottom + 6, window.innerHeight - margin));

      setCssProps(root, "--sprout-popover-left", `${left}px`);
      setCssProps(root, "--sprout-popover-top", `${top}px`);
    };

    // Place after layout to ensure correct width measurement
    requestAnimationFrame(() => place());

    const onResizeOrScroll = () => place();

    const onDocPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (root.contains(t) || trigger.contains(t)) return;
      this.closeMorePopover();
    };

    const onDocKeydown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      this.closeMorePopover();
      (trigger).focus();
    };

    window.addEventListener("resize", onResizeOrScroll, true);
    window.addEventListener("scroll", onResizeOrScroll, true);

    const tid = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
      document.addEventListener("keydown", onDocKeydown, true);
    }, 0);

    this.moreCleanup = () => {
      window.clearTimeout(tid);
      window.removeEventListener("resize", onResizeOrScroll, true);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };
  }

  private installHeaderActionsButtonGroup(_active: SproutHeaderPage) {
    const actionsHost =
      (this.deps.containerEl.querySelector<HTMLElement>(":scope > .view-header .view-actions")) ??
      (this.deps.containerEl.querySelector<HTMLElement>(".view-header .view-actions"));

    if (!actionsHost) return;

    clearNode(actionsHost);

    actionsHost.classList.add("bc", "sprout-view-actions");
    actionsHost.classList.add("sprout-actions-host");

    // Collapse/Expand
    const widthBtn = document.createElement("button");
    widthBtn.type = "button";
    widthBtn.className = "btn-outline inline-flex items-center gap-2";
    widthBtn.setAttribute("data-sprout-expand-collapse", "true");
    widthBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.toggleWide();
      this.updateWidthButtonLabel();
    });

    const widthIcon = document.createElement("span");
    widthIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
    widthIcon.setAttribute("aria-hidden", "true");
    widthBtn.appendChild(widthIcon);

    const widthLabel = document.createElement("span");
    widthLabel.setAttribute("data-sprout-label", "true");
    widthBtn.appendChild(widthLabel);

    actionsHost.appendChild(widthBtn);

    this.widthBtnEl = widthBtn;
    this.widthBtnIconEl = widthIcon;

    const onResize = () => this.updateWidthButtonLabel();
    window.addEventListener("resize", onResize, true);
    this.widthResizeCleanup = () => window.removeEventListener("resize", onResize, true);
    // Observe header/container size changes (e.g., pane resize) to re-show button when width grows
    if (typeof ResizeObserver !== "undefined") {
      try {
        const header =
          (this.deps.containerEl?.querySelector(":scope > .view-header")) ??
          (this.deps.containerEl?.querySelector(".view-header"));
        const ro = new ResizeObserver(() => this.updateWidthButtonLabel());
        if (header) ro.observe(header);
        if (this.deps.containerEl) ro.observe(this.deps.containerEl);
        this.widthResizeObserver = ro;
      } catch (e) { log.swallow("install: ResizeObserver setup", e); }
    }

    // Sync
    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "bc btn-outline inline-flex items-center gap-2";
    syncBtn.setAttribute("data-tooltip", "Sync flashcards");
    syncBtn.setAttribute("data-sprout-sync", "true");
    syncBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.runSync();
    });

    const syncIcon = document.createElement("span");
    syncIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
    syncIcon.setAttribute("aria-hidden", "true");
    syncBtn.appendChild(syncIcon);

    const syncTxt = document.createElement("span");
    syncTxt.textContent = "Sync";
    syncBtn.appendChild(syncTxt);

    actionsHost.appendChild(syncBtn);
    this.syncBtnIconEl = syncIcon;

    // Theme toggle removed; now handled by Obsidian

    // More
    const moreWrap = document.createElement("div");
    moreWrap.id = this.moreId;
    moreWrap.className = "dropdown-menu";
    moreWrap.classList.add("sprout-more-wrap");
    actionsHost.appendChild(moreWrap);

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.id = `${this.moreId}-trigger`;
    moreBtn.className = "bc btn-icon-outline";
    moreBtn.setAttribute("aria-haspopup", "menu");
    moreBtn.setAttribute("aria-expanded", "false");
    moreBtn.setAttribute("data-tooltip", "Pane options");
    moreWrap.appendChild(moreBtn);

    const moreIcon = document.createElement("span");
    moreIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
    moreIcon.setAttribute("aria-hidden", "true");
    setIcon(moreIcon, "more-vertical");
    moreBtn.appendChild(moreIcon);

    this.moreTriggerEl = moreBtn;

    const splitRight = () => {
      const newLeaf = this.deps.app.workspace.getLeaf("split", "vertical");
      void this.deps.app.workspace.revealLeaf(newLeaf);
    };

    const splitLeft = () => {
      const newLeaf = this.deps.app.workspace.getLeaf("split", "vertical");
      void this.deps.app.workspace.revealLeaf(newLeaf);
    };

    const splitDown = () => {
      const newLeaf = this.deps.app.workspace.getLeaf("split", "horizontal");
      void this.deps.app.workspace.revealLeaf(newLeaf);
    };

    const closeTab = () => {
      try {
        this.deps.leaf.detach();
      } catch (e) { log.swallow("closeTab: leaf detach", e); }
    };

    const openSettings = () => {
      // Open the Sprout settings section in Obsidian
      if (typeof this.deps.app.setting?.open === "function") {
        // Open settings
        this.deps.app.setting.open();
        // Select the Sprout section by data-setting-id
        setTimeout(() => {
          const sproutTab = document.querySelector('.vertical-tab-nav-item[data-setting-id="sprout"]');
          if (sproutTab) (sproutTab as HTMLElement).click();
        }, 100);
      } else {
        // fallback: open settings modal
        this.deps.app.commands?.executeCommandById?.("app:open-settings");
        setTimeout(() => {
          const sproutTab = document.querySelector('.vertical-tab-nav-item[data-setting-id="sprout"]');
          if (sproutTab) (sproutTab as HTMLElement).click();
        }, 300);
      }
    };

    const menuItems: SproutHeaderMenuItem[] = [
      { label: "Split left pane", icon: "panel-left", onActivate: splitLeft },
      { label: "Split right pane", icon: "panel-right", onActivate: splitRight },
      { label: "Split down pane", icon: "panel-bottom", onActivate: splitDown },
      { label: "Open settings", icon: "settings", onActivate: openSettings },
      { label: "Close tab", icon: "x", onActivate: closeTab },
    ];

    moreBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.morePopoverEl) this.closeMorePopover();
      else this.openMorePopover(moreBtn, menuItems);
    });
  }
}

// ─── Factory ────────────────────────────────────────────────────────
/**
 * Creates a {@link SproutHeader} with the common wiring shared by all
 * four top-level views (Home, Study, Flashcards, Analytics).
 *
 * Each view only needs to supply:
 *  - `view`          – the ItemView instance (`this`)
 *  - `plugin`        – the SproutPlugin (needs `.isWideMode`)
 *  - `onToggleWide`  – callback to run *after* isWideMode is flipped
 *  - `beforeSync?`   – optional hook that runs before sync (e.g. save scroll position)
 */
export function createViewHeader(opts: {
  view: ItemView;
  plugin: { isWideMode: boolean };
  onToggleWide: () => void;
  beforeSync?: () => void;
}): SproutHeader {
  const leaf = opts.view.leaf ?? opts.view.app.workspace.getLeaf(false);
  return new SproutHeader({
    app: opts.view.app,
    leaf,
    containerEl: opts.view.containerEl,
    getIsWide: () => opts.plugin.isWideMode,
    toggleWide: () => {
      opts.plugin.isWideMode = !opts.plugin.isWideMode;
      opts.onToggleWide();
    },
    runSync: () => {
      opts.beforeSync?.();
      const p = opts.plugin as { _runSync?(): void; syncBank?(): void };
      if (typeof p._runSync === "function") void p._runSync();
      else if (typeof p.syncBank === "function") void p.syncBank();
      else new Notice("Sync not available (no sync method found).");
    },
  });
}
