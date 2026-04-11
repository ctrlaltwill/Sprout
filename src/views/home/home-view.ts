/**
 * @file src/views/home/home-view.ts
 * @summary The Home tab — an Obsidian ItemView that renders the plugin's dashboard with study-streak tracking, due-card statistics, pinned and recent decks, a review calendar heatmap, and about/changelog information.
 *
 * @exports
 *  - SproutHomeView — Obsidian ItemView subclass implementing the Home dashboard tab
 */

import { ItemView, Notice, setIcon, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { type SproutHeader, createViewHeader } from "../../platform/core/header";
import { log } from "../../platform/core/logger";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_BROWSER, VIEW_TYPE_HOME, VIEW_TYPE_REVIEWER } from "../../platform/core/constants";
import { setCssProps } from "../../platform/core/ui";
import type LearnKitPlugin from "../../main";
import type { CardRecord } from "../../platform/core/store";
import type { Scope } from "../reviewer/types";
import { isParentCard } from "../../platform/core/card-utils";
import { ReviewCalendarHeatmap } from "../analytics/charts/review-calendar-heatmap";
import { cascadeAOSOnLoad, initAOS, resetAOS } from "../../platform/core/aos-loader";
import { createListReorderPreviewController } from "../../platform/core/oq-reorder-preview";
import { t } from "../../platform/translations/translator";
import { createTitleStripFrame, type TitleStripFrame } from "../../platform/core/view-primitives";
import { matchesScope } from "../../engine/indexing/scope-match";

import {
  MS_DAY,
  localDayIndex,
  formatTimeAgo,
  scopeFromDeckPath,
  formatDeckLabel,
  formatPinnedDeckLabel,
  getDeckLeafName,
} from "./home-helpers";

/**
 * The main Home / dashboard view for the Sprout plugin.
 *
 * Displays:
 * - A personalised greeting with editable user name
 * - Stat cards (overdue, due today, daily time, daily cards, streak)
 * - Pinned decks (drag-to-reorder, search-to-add)
 * - Recent decks (last 5 studied)
 * - Review calendar heatmap (React component)
 * - About Sprout + changelog info cards
 */
export class SproutHomeView extends ItemView {
  plugin: LearnKitPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  private _titleStripEl: HTMLElement | null = null;
  // Removed: now uses plugin.isWideMode
  private _heatmapRoot: ReactRoot | null = null;
  private _streakTimer: number | null = null;
  private _liveTimer: number | null = null;
  private _typingTimer: number | null = null;
  private _nameObserver: ResizeObserver | null = null;
  private _themeObserver: MutationObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_HOME;
  }

  getDisplayText() {
    return "Learn" + "Kit";
  }

  getIcon() {
    return "learnkit-brand";
  }

  async onOpen() {
    this.render();
    // Patch tab header with two spans to avoid sentence-case CSS rule
    const tabTitleEl = (this.leaf as unknown as Record<string, HTMLElement>).tabHeaderInnerTitleEl;
    if (tabTitleEl) {
      tabTitleEl.empty();
      const lang = this.plugin.settings?.general?.interfaceLanguage;
      tabTitleEl.createSpan({ text: t(lang, "ui.view.home.mobileBrand.learn", "Learn") });
      tabTitleEl.createSpan({ text: t(lang, "ui.view.home.mobileBrand.kit", "Kit") });
    }
    // Init AOS after render completes (DOM ready)
    if (this.plugin.settings?.general?.enableAnimations ?? true) {
      // Delay init to ensure DOM is fully rendered
      setTimeout(() => {
        initAOS({
          duration: AOS_DURATION,
          easing: "ease-out",
          once: true,
          offset: 50,
        });
      }, 100);
    }
    await Promise.resolve();
  }

  async onClose() {
    try {
      this._header?.dispose?.();
    } catch (e) { log.swallow("dispose header", e); }
    this._header = null;
    if (this._streakTimer) {
      window.clearInterval(this._streakTimer);
      this._streakTimer = null;
    }
    if (this._liveTimer) {
      window.clearInterval(this._liveTimer);
      this._liveTimer = null;
    }
    if (this._typingTimer) {
      window.clearTimeout(this._typingTimer);
      this._typingTimer = null;
    }
    if (this._nameObserver) {
      this._nameObserver.disconnect();
      this._nameObserver = null;
    }
    if (this._themeObserver) {
      this._themeObserver.disconnect();
      this._themeObserver = null;
    }
    try {
      this._heatmapRoot?.unmount();
    } catch (e) { log.swallow("unmount heatmap root", e); }
    this._heatmapRoot = null;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    resetAOS();
    await Promise.resolve();
  }

  onRefresh() {
    this.render();
  }

  /** Apply or remove wide-mode layout constraints. */
  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-learnkit-wide", "1");
    else this.containerEl.removeAttribute("data-learnkit-wide");

    const root = this._rootEl;
    const titleStrip = this._titleStripEl;
    if (!root && !titleStrip) return;

    // Keep a valid length/percentage token so CSS min(...) keeps side gutters in wide mode.
    const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;

    if (root) setCssProps(root, "--lk-home-max-width", maxWidth);
    if (titleStrip) setCssProps(titleStrip, "--lk-home-max-width", maxWidth);
  }

  private _ensureTitleStrip(root: HTMLElement): TitleStripFrame {
    this._titleStripEl?.remove();
    const frame = createTitleStripFrame({
      root,
      stripClassName: "lk-home-title-strip",
      rowClassName: "sprout-inline-sentence w-full flex items-center justify-between gap-[10px]",
      leftClassName: "min-w-0 flex-1 flex flex-col gap-[2px]",
      rightClassName: "flex items-center gap-2",
      prepend: true,
    });
    frame.title.className = "text-xl font-semibold tracking-tight";
    frame.subtitle.className = "flex items-center gap-1 min-w-0 text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";
    this._titleStripEl = frame.strip;
    return frame;
  }

  // ─── Main render ─────────────────────────────────────────────────

  render() {
    const root = this.contentEl;
    this._titleStripEl?.remove();
    this._titleStripEl = null;
    root.empty();
    if (this._streakTimer) {
      window.clearInterval(this._streakTimer);
      this._streakTimer = null;
    }
    if (this._heatmapRoot) {
      try {
        this._heatmapRoot.unmount();
      } catch (e) { log.swallow("unmount heatmap root", e); }
      this._heatmapRoot = null;
    }

    this._rootEl = root;
    root.classList.add("learnkit-view-content", "learnkit-view-content", "lk-home-root");

    this.containerEl.addClass("learnkit");

    // Animation control
    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    root.classList.toggle("learnkit-no-animate", !animationsEnabled);
    root.classList.remove("lk-home-root-enter");
    if (animationsEnabled) {
      // Retrigger root entrance animation each render.
      void root.offsetWidth;
      root.classList.add("lk-home-root-enter");
    }

    const HOME_AOS_FIRST_DELAY = 100;
    const HOME_AOS_STEP = 100;
    const applyAos = (_el: HTMLElement, _delay: number = 0) => {
      // Home view uses a strict two-step AOS sequence: title strip then content shell.
      // Keep this helper as a no-op to prevent nested section-level animations.
      return;
    };
    const applyRootAos = (el: HTMLElement, delay: number = 0) => {
      if (!animationsEnabled) return;
      el.setAttribute("data-aos", "fade-up");
      el.setAttribute("data-aos-anchor-placement", "top-top");
      if (delay > 0) el.setAttribute("data-aos-delay", delay.toString());
    };

    if (!this._header) {
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyWidthMode(),
      });
    }

    this._header.install("home");
    this._applyWidthMode();


    const nameSetting = this.plugin.settings.general.userName ?? "";
    const trimmedName = String(nameSetting || "").trim();
    const nowMs = Date.now();
    const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);

    const titleFrame = this._ensureTitleStrip(root);
    const titleHost = titleFrame.strip;
    const title = titleFrame.row;
    const headingEl = titleFrame.title;
    title.classList.add("lk-home-title-row");
    titleFrame.left.classList.add("lk-home-title-copy");
    titleFrame.right.classList.add("lk-home-title-actions");
    headingEl.classList.add("lk-home-title-label");
    const titleLearn = tx("ui.view.home.mobileBrand.learn", "Learn");
    const titleKit = tx("ui.view.home.mobileBrand.kit", "Kit");
    headingEl.empty();
    headingEl.createSpan({ text: titleLearn });
    headingEl.createSpan({ text: titleKit });
    const subtitleRow = titleFrame.subtitle;
    subtitleRow.classList.add("lk-home-title-subtitle");

    const quickStudyBtn = document.createElement("button");
    quickStudyBtn.className = "lk-home-quick-study-btn learnkit-btn-accent inline-flex items-center gap-2";
    quickStudyBtn.type = "button";
    quickStudyBtn.setAttribute("aria-label", tx("ui.home.quickAction.startStudying", "Start studying"));
    quickStudyBtn.setAttribute("data-tooltip-position", "bottom");
    quickStudyBtn.createSpan({ text: tx("ui.home.quickAction.startStudying", "Start studying") });
    const quickStudyIcon = quickStudyBtn.createSpan({ cls: "lk-home-quick-study-icon inline-flex items-center justify-center [&_svg]:size-3.5" });
    setIcon(quickStudyIcon, "arrow-right");

    const quickStartStudy = async () => {
      try {
        await this.plugin.openReviewerTab();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEWER)[0];
        const view = leaf?.view as { openSession?(scope: Scope): void } | undefined;
        if (view && typeof view.openSession === "function") {
          view.openSession({
            type: "vault",
            key: "__all__",
            name: tx("ui.home.deck.allCards", "All cards"),
          });
        } else {
          new Notice(tx("ui.home.notice.studyViewNotReady", "Study view not ready yet. Try again."));
        }
      } catch {
        new Notice(tx("ui.home.notice.unableToOpenStudy", "Unable to open study."));
      }
    };

    quickStudyBtn.addEventListener("click", () => {
      void quickStartStudy();
    });

    if (trimmedName) {
      subtitleRow.createSpan({ text: tx("ui.home.greeting.welcomeBackComma", "Welcome back,") + " " });

      const nameInput = document.createElement("input");
      nameInput.className = "lk-home-name-input min-w-[1ch] shrink-0 grow-0 basis-auto max-w-full border-0 p-0 m-0 shadow-none text-[0.95rem] font-normal leading-[1.3] text-muted-foreground bg-transparent";
      nameInput.type = "text";
      nameInput.placeholder = tx("ui.home.placeholder.yourName", "Your name");
      nameInput.value = trimmedName;
      subtitleRow.appendChild(nameInput);

      const greetingSuffixEl = document.createElement("div");
      greetingSuffixEl.className = "learnkit-greeting-suffix -ml-1 text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";
      greetingSuffixEl.textContent = tx("ui.home.greeting.punctuation.exclamation", "!");
      subtitleRow.appendChild(greetingSuffixEl);

      const nameSizer = document.createElement("span");
      nameSizer.className = "learnkit-name-sizer absolute invisible whitespace-pre pointer-events-none h-0 overflow-hidden text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";
      subtitleRow.appendChild(nameSizer);

      const syncNameWidth = () => {
        const value = nameInput.value || nameInput.placeholder || "";
        const computed = window.getComputedStyle(nameInput);
        setCssProps(nameSizer, "--lk-home-font-family", computed.fontFamily);
        setCssProps(nameSizer, "--lk-home-font-size", computed.fontSize);
        setCssProps(nameSizer, "--lk-home-font-weight", computed.fontWeight);
        setCssProps(nameSizer, "--lk-home-letter-spacing", computed.letterSpacing);
        setCssProps(nameSizer, "--lk-home-text-transform", computed.textTransform);
        setCssProps(nameSizer, "--lk-home-font-style", computed.fontStyle);
        setCssProps(nameSizer, "--lk-home-font-variant", computed.fontVariant);
        setCssProps(nameSizer, "--lk-home-line-height", computed.lineHeight);
        nameSizer.textContent = value;
        const measured = Math.ceil(nameSizer.getBoundingClientRect().width);
        const paddingLeft = Number.parseFloat(computed.paddingLeft || "0") || 0;
        const paddingRight = Number.parseFloat(computed.paddingRight || "0") || 0;
        const borderLeft = Number.parseFloat(computed.borderLeftWidth || "0") || 0;
        const borderRight = Number.parseFloat(computed.borderRightWidth || "0") || 0;
        const chromeWidth = paddingLeft + paddingRight + borderLeft + borderRight;
        const next = Math.max(1, measured + chromeWidth + 2);
        setCssProps(nameInput, "--lk-home-name-width", `${next}px`);
      };

      let saveTimer: number | null = null;
      const onNameResize = () => syncNameWidth();
      nameInput.addEventListener("input", onNameResize);
      nameInput.addEventListener("change", onNameResize);
      if (this._nameObserver) {
        this._nameObserver.disconnect();
        this._nameObserver = null;
      }
      this._nameObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              syncNameWidth();
            })
          : null;
      if (this._nameObserver) this._nameObserver.observe(title);
      window.requestAnimationFrame(() => syncNameWidth());

      nameInput.addEventListener("input", () => {
        syncNameWidth();
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          void (async () => {
            const next = nameInput.value.trim();
            this.plugin.settings.general.userName = next;
            await this.plugin.saveAll();
            if (!next) this.render();
          })();
        }, 300);
      });
    } else {
      subtitleRow.textContent = tx("ui.home.greeting.welcomeBackSimple", "Welcome back!");
    }

    titleFrame.right.appendChild(quickStudyBtn);

    // (greeting input logic is now only inside the showGreeting block)

    const contentShell = document.createElement("div");
    contentShell.className = "learnkit-view-content-shell lk-home-content-shell";
    root.appendChild(contentShell);

    const body = document.createElement("div");
    body.className = "w-full flex flex-col gap-4";
    contentShell.appendChild(body);

    applyRootAos(titleHost, 0);
    applyRootAos(contentShell, HOME_AOS_FIRST_DELAY);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const events = this.plugin.store.getAnalyticsEvents?.() ?? [];
    const cards = this.plugin.store.getAllCards?.() ?? [];
    const states = this.plugin.store.data.states ?? {};

    // Refresh GitHub stars (respects 6-hour cache unless forced)
    void this.plugin.refreshGithubStars(false);

    const cardsById = new Map<string, CardRecord>();
    for (const card of cards) {
      if (card?.id) cardsById.set(String(card.id), card);
    }

    const activeStudyCards = cards.filter((card) => {
      if (!card) return false;
      if (isParentCard(card)) return false;
      const source = String(card.sourceNotePath ?? "").trim();
      return source.length > 0;
    });

    const reviewEvents = events.filter((ev) => ev && ev.kind === "review");
    const sessionEvents = events.filter((ev) => ev && ev.kind === "session");
    reviewEvents.sort((a, b) => Number(b.at) - Number(a.at));
    sessionEvents.sort((a, b) => Number(b.at) - Number(a.at));

    const recentDecks: Array<{ scope: Scope; lastAt: number; label: string }> = [];
    const scopeExists = (scope: Scope): boolean => {
      if (!scope || typeof scope !== "object") return false;
      const type = String(scope.type || "");
      if (type === "vault") return true;
      const key = String(scope.key || "").trim();
      if (!key) return false;
      const af = this.plugin.app.vault.getAbstractFileByPath(key);
      if (!af) return false;
      if (type === "note") return af instanceof TFile;
      if (type === "folder") return af instanceof TFolder;
      return false;
    };
    const scopeHasCards = (scope: Scope): boolean => {
      if (!scope || typeof scope !== "object") return false;
      for (const card of activeStudyCards) {
        const path = String(card.sourceNotePath ?? "").trim();
        if (!path) continue;
        if (matchesScope(scope, path)) return true;
      }
      return false;
    };
    const seenDecks = new Set<string>();
    for (const ev of sessionEvents) {
      const scope = ev?.scope;
      if (!scope || typeof scope !== "object") continue;
      const type = String(scope.type || "");
      const key = String(scope.key || "");
      const name = String(scope.name || "");
      if (!["vault", "folder", "note"].includes(type)) continue;
      const label = type === "vault" ? tx("ui.home.deck.allCards", "All cards") : (key || name).trim();
      if (!label) continue;
      const dedupeKey = type === "vault"
        ? "vault"
        : `${type}:${String(key || name).trim().toLowerCase()}`;
      if (seenDecks.has(dedupeKey)) continue;
      if (!scopeExists(scope)) continue;
      if (!scopeHasCards(scope)) continue;
      seenDecks.add(dedupeKey);
      recentDecks.push({ scope, lastAt: Number(ev.at) || nowMs, label });
      if (recentDecks.length >= 5) break;
    }

    const pinnedDecks: string[] = this.plugin.settings.general.pinnedDecks ?? [];

    const dueCounts = new Map<string, number>();
    let totalOverdue = 0;
    let totalDueToday = 0;
    let totalDue = 0;
    const startOfTodayMs = new Date(nowMs).setHours(0, 0, 0, 0);
    const tomorrowMs = nowMs + MS_DAY;
    for (const card of cards) {
      const id = String(card?.id ?? "");
      if (!id) continue;

      // Skip parent cards — only children (the ones actually studied) should be counted
      if (isParentCard(card)) continue;

      const st = states?.[id];
      if (!st || String(st.stage ?? "") === "suspended") continue;
      const due = Number(st.due);
      if (!Number.isFinite(due)) continue;
      if (due <= nowMs) {
        if (due < startOfTodayMs) {
          // Overdue: due date is before today
          totalOverdue += 1;
        } else {
          // Due today: due date is today
          totalDueToday += 1;
        }
        totalDue += 1;
        const path = String(card?.sourceNotePath ?? "").trim();
        if (!path) continue;
        dueCounts.set(path, (dueCounts.get(path) ?? 0) + 1);
      } else if (due <= tomorrowMs) {
        // due tomorrow (currently unused)
      }
    }

    const getDueForPrefix = (prefix: string) => {
      const base = prefix.replace(/\/+$/, "");
      let sum = 0;
      for (const [path, count] of dueCounts.entries()) {
        if (path === base || path.startsWith(`${base}/`)) sum += count;
      }
      return sum;
    };

    const getDueForScope = (scope: Scope) => {
      if (!scope || typeof scope !== "object") return 0;
      const type = String(scope.type || "");
      if (type === "vault") return totalDue;
      const key = String(scope.key || "");
      if (!key) return 0;
      return getDueForPrefix(key);
    };

    const dayMap = new Map<number, { count: number; totalMs: number }>();
    for (const ev of reviewEvents) {
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      if (ev.kind !== "review") continue;
      const dayIndex = localDayIndex(at, timezone);
      const entry = dayMap.get(dayIndex) ?? { count: 0, totalMs: 0 };
      entry.count += 1;
      const ms = Number(ev.msToAnswer);
      if (Number.isFinite(ms) && ms > 0) entry.totalMs += ms;
      dayMap.set(dayIndex, entry);
    }

    const todayIndex = localDayIndex(nowMs, timezone);
    const daysRange = 7;
    let reviews7d = 0;
    let time7d = 0;
    for (let i = 0; i < daysRange; i += 1) {
      const idx = todayIndex - i;
      const entry = dayMap.get(idx);
      if (entry) {
        reviews7d += entry.count;
        time7d += entry.totalMs;
      }
    }
    const avgCardsPerDay = reviews7d / daysRange;
    const avgTimePerDayMinutes = time7d / daysRange / 60000;
    const avgMsPerReview = reviews7d > 0 ? time7d / reviews7d : 0;
    const fallbackMsPerReview = 30_000;
    const estimatedMsPerCard = avgMsPerReview > 0 ? avgMsPerReview : fallbackMsPerReview;

    const formatQueueTimeEstimate = (cardCount: number) => {
      if (cardCount <= 0) return "";
      const minutes = Math.max(0, Math.ceil((Math.max(0, cardCount) * estimatedMsPerCard) / 60000));
      if (minutes < 60) {
        return tx("ui.analytics.card.minutesSuffix", "{count} min", { count: minutes });
      }
      const hours = minutes / 60;
      const roundedHours = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
      const label = roundedHours === 1 ? "hour" : "hours";
      return `${roundedHours} ${label}`;
    };

    const openStudyForScope = async (scope: Scope) => {
      try {
        const leaf = this.leaf;
        await leaf.setViewState({ type: VIEW_TYPE_REVIEWER, active: true });
        void this.app.workspace.revealLeaf(leaf);
        const view = leaf.view as {
          openSession?(scope: Scope): void;
          openSessionFromScope?(scope: Scope): void;
        } | undefined;
        if (view && typeof view.openSession === "function") {
          view.openSession(scope);
        } else if (view && typeof view.openSessionFromScope === "function") {
          view.openSessionFromScope(scope);
        } else {
          new Notice(tx("ui.home.notice.studyViewNotReady", "Study view not ready yet. Try again."));
        }
      } catch {
        new Notice(tx("ui.home.notice.unableToOpenStudy", "Unable to open study."));
      }
    };

    const openStudyForDeckPath = async (path: string) => {
      await openStudyForScope(scopeFromDeckPath(path));
    };

    const openSettingsTab = async (tab: "settings" | "guide" | "about") => {
      try {
        await this.plugin.openSettingsTab(false, tab);
      } catch {
        new Notice(tx("ui.home.notice.unableToOpenSettings", "Unable to open settings right now"));
      }
    };

    const openLibrary = async () => {
      try {
        await this.leaf.setViewState({ type: VIEW_TYPE_BROWSER, active: true });
        void this.app.workspace.revealLeaf(this.leaf);
      } catch {
        new Notice(tx("ui.home.notice.unableToOpenLibrary", "Unable to open library right now"));
      }
    };

    const openGithubRepo = () => {
      window.open("https://github.com/ctrlaltwill/Sprout", "_blank", "noopener,noreferrer");
    };

    const openReleases = () => {
      window.open("https://github.com/ctrlaltwill/Sprout/releases", "_blank", "noopener,noreferrer");
    };

    const createChevronLinkButton = (
      parent: HTMLElement,
      options: {
        label: string;
        icon: string;
        ariaLabel?: string;
        onClick: () => void | Promise<void>;
      },
    ) => {
      const btn = parent.createEl("button", {
        cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-7 px-3 text-sm inline-flex items-center gap-2 lk-home-link-btn",
        attr: {
          type: "button",
          "aria-label": options.ariaLabel ?? options.label,
          "data-tooltip-position": "top",
        },
      });

      const leftIcon = btn.createSpan({ cls: "inline-flex items-center justify-center" });
      setIcon(leftIcon, options.icon);

      btn.createSpan({ cls: "", text: options.label });

      const rightIcon = btn.createSpan({ cls: "inline-flex items-center justify-center ml-auto" });
      setIcon(rightIcon, "chevron-right");

      btn.addEventListener("click", () => {
        void options.onClick();
      });

      return btn;
    };

    const makeDeckSection = (label: string, iconName?: string) => {
      const section = document.createElement("div");
      section.className = "card learnkit-ana-card lk-home-deck-section flex flex-col gap-3 p-3 rounded-lg border border-border bg-background";
      const headingRow = section.createDiv({ cls: "m-0 flex items-center justify-between gap-2" });
      headingRow.createDiv({ cls: "lk-home-section-title font-semibold", text: label });
      if (iconName) {
        const iconWrapper = headingRow.createEl("span", { cls: "w-5 h-5 text-muted-foreground shrink-0 inline-flex items-center justify-center [&_svg]:w-5 [&_svg]:h-5 [&_svg]:stroke-current" });
        if (iconName === "pin") {
          // Use lucide bookmark icon for pinned decks
          setIcon(iconWrapper, "bookmark");
        } else {
          setIcon(iconWrapper, iconName);
        }
      }
      const list = section.createDiv({ cls: "flex flex-col gap-2 text-sm" });
      return { section, list };
    };

    const pinnedSection = makeDeckSection(tx("ui.home.deck.pinned", "Pinned decks"), "pin");
    const recentSection = makeDeckSection(tx("ui.home.deck.recent", "Recent decks"), "clock");

    const statsRow = document.createElement("div");
    statsRow.className = "learnkit-ana-grid lk-home-stats-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4";
    applyAos(statsRow, HOME_AOS_FIRST_DELAY + HOME_AOS_STEP);
    body.appendChild(statsRow);

    // Decks row: pinned (left) and recent (right), no parent wrapper card.
    const decksRow = document.createElement("div");
    decksRow.className = "lk-home-decks-row grid grid-cols-1 lg:grid-cols-2 gap-4";
    applyAos(decksRow, HOME_AOS_FIRST_DELAY + HOME_AOS_STEP * 2);
    body.appendChild(decksRow);
    decksRow.appendChild(pinnedSection.section);
    decksRow.appendChild(recentSection.section);

    const makeStatCard = (label: string, value: string, note?: string) => {
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card learnkit-stat-card small-card flex flex-col gap-2 lg:flex-1";
      statsRow.appendChild(card);
      card.createDiv({ cls: "text-sm text-muted-foreground", text: label });
      card.createDiv({ cls: "text-2xl font-semibold", text: value });
      if (note) card.createDiv({ cls: "text-xs text-muted-foreground", text: note });
      return card;
    };

    // Compute previous 7 days for trend comparison
    let prevReviews7d = 0;
    let prevTime7d = 0;
    let prevActiveDaysReviews = 0;
    let prevActiveDaysTime = 0;
    for (let i = daysRange; i < daysRange * 2; i += 1) {
      const idx = todayIndex - i;
      const entry = dayMap.get(idx);
      if (entry) {
        prevReviews7d += entry.count;
        prevTime7d += entry.totalMs;
        if (entry.count > 0) {
          prevActiveDaysReviews += 1;
          prevActiveDaysTime += 1;
        }
      }
    }
    const prevAvgCardsPerDay = prevActiveDaysReviews > 0 ? prevReviews7d / prevActiveDaysReviews : 0;
    const prevAvgTimePerDayMinutes = prevActiveDaysTime > 0 ? prevTime7d / prevActiveDaysTime / 60000 : 0;

    const formatTrend = (current: number, previous: number, previousDaysWithData: number) => {
      if (previousDaysWithData <= 0 || previous <= 0) {
        return { value: 0, text: "0%", dir: 0 };
      }
      const raw = ((current - previous) / previous) * 100;
      const capped = Math.min(Math.max(raw, -1000), 1000);
      const dir = capped > 0 ? 1 : capped < 0 ? -1 : 0;
      return { value: capped, text: `${capped > 0 ? "+" : ""}${capped.toFixed(0)}%`, dir };
    };

    const buildTrendBadge = (trend: { value: number; text: string; dir: number }) => {
      const badge = document.createElement("span");
      badge.className = "learnkit-trend-badge";
      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center";
      const iconName = trend.dir > 0 ? "trending-up" : trend.dir < 0 ? "trending-down" : "minus";
      setIcon(icon, iconName);
      badge.appendChild(icon);
      const valueEl = document.createElement("span");
      valueEl.textContent = trend.dir === 0
        ? tx("ui.home.trend.zero", "0%")
        : tx("ui.home.trend.signedPercent", "{sign}{value}%", { sign: trend.dir > 0 ? "+" : "", value: 0 });
      badge.appendChild(valueEl);

      // Animate count-up value only (no badge rotation)
      const durationMs = 800;
      const start = performance.now();
      const target = trend.value;
      const animate = (t: number) => {
        const elapsed = t - start;
        const p = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOut
        const currentVal = (trend.dir === 0 ? 0 : (eased * Math.abs(target))) * (trend.dir >= 0 ? 1 : -1);
        valueEl.textContent = tx("ui.home.trend.signedPercent", "{sign}{value}%", {
          sign: currentVal >= 0 ? "+" : "",
          value: currentVal.toFixed(0),
        });
        if (p < 1) requestAnimationFrame(animate);
        else valueEl.textContent = trend.text;
      };
      requestAnimationFrame(animate);
      return badge;
    };

    makeStatCard(
      tx("ui.home.stat.cardsOverdue", "Cards overdue"),
      String(totalOverdue),
      formatQueueTimeEstimate(totalOverdue),
    );
    makeStatCard(
      tx("ui.home.stat.cardsDueToday", "Cards due today"),
      String(totalDueToday),
      formatQueueTimeEstimate(totalDueToday),
    );

    // Avg time/day card with trend badge
    {
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card learnkit-stat-card small-card p-4 flex flex-col gap-2 lg:flex-1";
      statsRow.appendChild(card);
      const header = card.createDiv({ cls: "flex items-center justify-between text-sm text-muted-foreground" });
      header.createDiv({ text: tx("ui.home.stat.dailyTime", "Daily time"), cls: "lk-home-stat-trend-label" });
      const timeTrend = formatTrend(avgTimePerDayMinutes, prevAvgTimePerDayMinutes, prevActiveDaysTime);
      header.appendChild(buildTrendBadge(timeTrend));
      card.createDiv({
        cls: "text-2xl font-semibold lk-home-stat-trend-value",
        text: tx("ui.analytics.card.minutesSuffix", "{count} min", { count: Math.ceil(avgTimePerDayMinutes) }),
      });
      card.createDiv({ cls: "text-xs text-muted-foreground", text: tx("ui.home.stat.last7Days", "Last 7 days") });
    }

    // Avg cards/day card with trend badge
    {
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card learnkit-stat-card small-card p-4 flex flex-col gap-2 lg:flex-1";
      statsRow.appendChild(card);
      const header = card.createDiv({ cls: "flex items-center justify-between text-sm text-muted-foreground" });
      header.createDiv({ text: tx("ui.home.stat.dailyCards", "Daily cards"), cls: "lk-home-stat-trend-label" });
      const cardsTrend = formatTrend(avgCardsPerDay, prevAvgCardsPerDay, prevActiveDaysReviews);
      header.appendChild(buildTrendBadge(cardsTrend));
      card.createDiv({
        cls: "text-2xl font-semibold lk-home-stat-trend-value",
        text: tx("ui.home.stat.countOnly", "{count}", { count: Math.round(avgCardsPerDay) }),
      });
      card.createDiv({ cls: "text-xs text-muted-foreground", text: tx("ui.home.stat.last7Days", "Last 7 days") });
    }
    const pinnedList = pinnedSection.list;
    
    // Get all available deck paths for search
    const allDeckPaths = new Set<string>();
    for (const card of Object.values(this.plugin.store.data.cards || {})) {
      if (!card || typeof card !== "object") continue;
      const path = String(card.sourceNotePath || "").trim();
      if (!path) continue;
      allDeckPaths.add(path);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        allDeckPaths.add(parts.slice(0, i).join("/"));
      }
    }
    const allDecks = Array.from(allDeckPaths).sort();
    
    let deckSearchQuery = "";
    let searchDropdownOpen = false;
    let searchInputEl: HTMLInputElement | null = null;
    let dropdownEl: HTMLElement | null = null;
    
    const MAX_PINNED = 5;
    const currentPinned = pinnedDecks.slice(0, MAX_PINNED);
    
    const savePinnedDecks = async (decks: string[]) => {
      this.plugin.settings.general.pinnedDecks = decks.slice(0, MAX_PINNED);
      await this.plugin.saveAll();
    };
    
    const renderPinnedDecks = () => {
      pinnedList.empty();

      const previewController = createListReorderPreviewController(pinnedList, {
        rowSelector: ".learnkit-deck-row",
        translateVar: "--learnkit-deck-row-translate",
        listActiveClass: "sprout-deck-drag-active",
        rowAnimatingClass: "sprout-deck-row-anim",
        rowDraggingClass: "sprout-deck-row-dragging",
        rowDraggingNativeClass: "sprout-deck-row-dragging-native",
        slotBeforeClass: "sprout-deck-slot-before",
        slotAfterClass: "sprout-deck-slot-after",
      });

      const commitPinnedReorder = async (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || fromIndex >= currentPinned.length) return;
        if (toIndex < 0 || toIndex >= currentPinned.length) return;
        const item = currentPinned[fromIndex];
        if (!item) return;
        currentPinned.splice(fromIndex, 1);
        currentPinned.splice(toIndex, 0, item);
        await savePinnedDecks(currentPinned);
        renderPinnedDecks();
      };
      
      // Render all 5 slots: pinned decks, then input (if space), then placeholders
      for (let i = 0; i < MAX_PINNED; i++) {
        if (i < currentPinned.length) {
          // Render pinned deck button
          const path = currentPinned[i];
          const row = pinnedList.createDiv({ 
            cls: "learnkit-deck-row learnkit-deck-row flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background cursor-pointer hover:bg-accent/50"
          });
          row.dataset.pinnedIdx = String(i);
          const pinnedLeafName = getDeckLeafName(path);
          const pinnedTooltip = tx("ui.home.deck.tooltip.study", "Study {deck}", { deck: pinnedLeafName || "deck" });
          row.setAttr("aria-label", pinnedTooltip);
          
          // Make row clickable to open deck
          row.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            // Don't open if clicking hamburger or X button
            if (target.closest('[data-action]')) return;
            void openStudyForDeckPath(path);
          });
          
          const left = row.createDiv({ cls: "flex items-center gap-2 min-w-0 flex-1" });
          
          // Hamburger menu for reordering
          const hamburger = left.createEl("span", { 
            cls: "learnkit-drag-handle learnkit-drag-handle inline-flex items-center justify-center",
            attr: { "data-action": "drag", "aria-label": tx("ui.home.deck.tooltip.drag", "Drag to reorder") }
          });
          setIcon(hamburger, "grip-vertical");
          
          const name = left.createDiv({ cls: "learnkit-text-truncate-rtl learnkit-text-truncate-rtl truncate font-medium min-w-0 flex-1" });
          const pinnedLabel = formatPinnedDeckLabel(path);
          name.textContent = pinnedLabel;
          
          const right = row.createDiv({ cls: "flex items-center gap-2 shrink-0" });
          
          const due = getDueForPrefix(path);
          right.createDiv({ cls: "text-xs text-muted-foreground", text: tx("ui.home.deck.dueCount", "{count} due", { count: due }) });
          
          const removeBtn = right.createEl("span", { 
            cls: "learnkit-deck-remove-btn learnkit-deck-remove-btn inline-flex items-center justify-center cursor-pointer",
            attr: { "data-action": "delete", "aria-label": tx("ui.home.deck.tooltip.removePinned", "Remove from pinned decks") }
          });
          setIcon(removeBtn, "x");
          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void (async () => {
              currentPinned.splice(i, 1);
              await savePinnedDecks(currentPinned);
              renderPinnedDecks();
            })();
          });
          
          // Drag and drop reordering with animation
          row.draggable = true;

          row.addEventListener("dragstart", (e) => {
            const fromIndex = Number(row.dataset.pinnedIdx || "-1");
            if (fromIndex < 0) return;
            previewController.beginDrag({
              fromIdx: fromIndex,
              row,
              dataTransfer: e.dataTransfer,
              setDragImage: true,
            });
          });
          
          row.addEventListener("dragend", () => {
            previewController.endDrag();
          });
        } else if (i === currentPinned.length && currentPinned.length < MAX_PINNED) {
          // Render search input in the first empty slot
          const searchRow = pinnedList.createDiv({ cls: "relative" });
          searchInputEl = searchRow.createEl("input", {
            cls: "learnkit-deck-search-input learnkit-deck-search-input w-full text-sm text-center text-muted-foreground", 
              attr: { type: "text", placeholder: tx("ui.home.deck.search.placeholder", "Search to add a pinned deck") }
          });
          searchInputEl.setAttr("aria-label", tx("ui.home.deck.tooltip.searchDecks", "Search for decks"));
          searchInputEl.setAttr("title", tx("ui.home.deck.tooltip.searchDecks", "Search for decks"));
          
          searchInputEl.addEventListener("focus", () => {
            searchInputEl!.classList.add("learnkit-deck-search-input-focused", "learnkit-deck-search-input-focused");
          });
          
          searchInputEl.addEventListener("blur", () => {
            setTimeout(() => {
              if (searchInputEl!.value === "") {
                searchInputEl!.classList.remove("learnkit-deck-search-input-focused", "learnkit-deck-search-input-focused");
              }
              searchDropdownOpen = false;
              renderSearchDropdown();
            }, 300);
          });
          
          searchInputEl.addEventListener("input", (e) => {
            deckSearchQuery = (e.target as HTMLInputElement).value;
            searchDropdownOpen = deckSearchQuery.trim().length > 0;
            renderSearchDropdown();
          });
          
          // Dropdown container
          dropdownEl = searchRow.createDiv({ 
            cls: "learnkit-deck-search-dropdown learnkit-deck-search-dropdown dropdown-menu min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto hidden"
          });
          
          renderSearchDropdown();
        } else {
          // Render placeholder - use absolute slot number (i + 1)
          const placeholder = pinnedList.createDiv({ 
            cls: "learnkit-placeholder-slot learnkit-placeholder-slot"
          });
          placeholder.textContent = tx("ui.home.deck.emptySlot", "Empty slot {index}", { index: i + 1 });
        }
      }

      pinnedList.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        previewController.updatePointer(e.clientY);
      });

      pinnedList.addEventListener("drop", (e) => {
        e.preventDefault();
        const pending = previewController.getPendingMove();
        previewController.endDrag();
        if (!pending) return;
        void commitPinnedReorder(pending.fromIdx, pending.toIdx);
      });
    };
    
    const renderSearchDropdown = () => {
      if (!dropdownEl) return;
      
      if (!searchDropdownOpen || !deckSearchQuery.trim()) {
        dropdownEl.classList.add("hidden");
        return;
      }
      
      dropdownEl.classList.remove("hidden");
      dropdownEl.empty();

      const menuEl = dropdownEl.createDiv({ cls: "flex flex-col" });
      menuEl.setAttr("role", "menu");
      
      const query = deckSearchQuery.trim().toLowerCase();
      const filtered = allDecks
        .map(deck => {
          if (currentPinned.includes(deck)) return false;
          const normalized = deck
            .toLowerCase()
            .replace(/\.md$/i, "")
            .replace(/\s*\/\s*/g, "/")
            .trim();
          const idx = normalized.indexOf(query);
          if (idx < 0) return false;
          const segmentIdx = normalized.lastIndexOf("/", idx);
          const segmentStart = segmentIdx < 0 ? 0 : segmentIdx + 1;
          const segment = normalized.slice(segmentStart);

          let rank = 4;
          if (normalized === query) {
            rank = 0;
          } else if (segment === query || segment.startsWith(query)) {
            rank = 1;
          } else if (normalized.startsWith(query)) {
            rank = 2;
          } else {
            rank = 3;
          }

          return { deck, rank, idx, length: normalized.length };
        })
        .filter((entry): entry is { deck: string; rank: number; idx: number; length: number } => Boolean(entry))
        .sort((a, b) => a.rank - b.rank || a.idx - b.idx || a.length - b.length || a.deck.localeCompare(b.deck))
        .map(entry => entry.deck)
        .slice(0, 10);
      
      if (filtered.length === 0) {
        const empty = menuEl.createDiv({ cls: "px-2 py-1.5 text-sm text-muted-foreground text-center" });
        empty.textContent = tx("ui.home.deck.search.empty", "No decks found");
        return;
      }
      
      filtered.forEach(deck => {
        const item = menuEl.createDiv({ 
          cls: "learnkit-deck-search-item learnkit-deck-search-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground" 
        });
        item.setAttr("role", "menuitem");
        item.setAttr("tabindex", "0");
        const deckLeafName = getDeckLeafName(deck);
        const addPinnedTooltip = tx("ui.home.deck.tooltip.addPinned", "Add {deck} to pinned decks", {
          deck: deckLeafName || "deck",
        });
        item.setAttr("aria-label", addPinnedTooltip);
        item.setAttr("title", addPinnedTooltip);
        
        const label = item.createDiv({ cls: "learnkit-text-truncate-rtl learnkit-text-truncate-rtl truncate flex-1" });
        const pinnedLabel = formatPinnedDeckLabel(deck);
        label.textContent = pinnedLabel;
        label.setAttr("title", addPinnedTooltip);
        
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void (async () => {
            currentPinned.push(deck);
            await savePinnedDecks(currentPinned);
            deckSearchQuery = "";
            if (searchInputEl) searchInputEl.value = "";
            searchDropdownOpen = false;
            renderPinnedDecks();
          })();
        });

        item.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          void (async () => {
            currentPinned.push(deck);
            await savePinnedDecks(currentPinned);
            deckSearchQuery = "";
            if (searchInputEl) searchInputEl.value = "";
            searchDropdownOpen = false;
            renderPinnedDecks();
          })();
        });
      });
    };
    
    renderPinnedDecks();

    const recentList = recentSection.list;
    const recentSlots = recentDecks.slice(0, 5);
    for (let i = 0; i < 5; i += 1) {
      const deck = recentSlots[i];
      if (deck) {
        const row = recentList.createDiv({ 
          cls: "learnkit-deck-row learnkit-deck-row flex items-center justify-between gap-3 cursor-pointer p-3 rounded-lg border border-border bg-background hover:bg-accent/30"
        });
        const recentLeafName = deck.scope.type === "vault"
          ? tx("ui.home.deck.allCards", "All cards")
          : getDeckLeafName(deck.label);
        const recentTooltip = tx("ui.home.deck.tooltip.study", "Study {deck}", { deck: recentLeafName || "deck" });
        row.setAttr("aria-label", recentTooltip);
        row.setAttr("data-tooltip-position", "bottom");
        row.addEventListener("click", () => void openStudyForScope(deck.scope));
        
        const left = row.createDiv({ cls: "flex flex-col min-w-0 flex-1" });
        const name = left.createDiv({ cls: "learnkit-text-truncate-rtl learnkit-text-truncate-rtl truncate font-medium" });
        name.textContent = formatDeckLabel(deck.label, 60);
        const right = row.createDiv({ cls: "flex items-center gap-2 shrink-0" });
        const due = getDueForScope(deck.scope);
        right.createDiv({
          cls: "text-xs text-muted-foreground",
          text: `${formatTimeAgo(deck.lastAt)} • ${due} due`,
        });
      } else {
        const placeholder = recentList.createDiv({ 
          cls: "learnkit-placeholder-slot learnkit-placeholder-slot"
        });
        placeholder.textContent = tx("ui.home.deck.emptySlot", "Empty slot {index}", { index: i + 1 });
      }
    }

    const heatmapHost = document.createElement("div");
    heatmapHost.className = "learnkit-heatmap-host";
    applyAos(heatmapHost, HOME_AOS_FIRST_DELAY + HOME_AOS_STEP * 3);
    body.appendChild(heatmapHost);
    this._heatmapRoot = createRoot(heatmapHost);
    this._heatmapRoot.render(
      React.createElement(ReviewCalendarHeatmap, {
        revlog: reviewEvents,
        timezone,
        rangeDays: 0,
        filters: {},
      }),
    );

    type TipItem = {
      title: string;
      body: string;
      demo: string;
      actionLabel: string;
      actionIcon: string;
      action: () => void | Promise<void>;
    };

    const tips: TipItem[] = [
      {
        title: "Voice + language flags",
        body: "Use language/region codes to pick specific voices and add flags in cards for quick context.",
        demo: "Demo: EN-GB 🇬🇧 | EN-US 🇺🇸 | JA-JP 🇯🇵",
        actionLabel: "Open audio settings",
        actionIcon: "languages",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Typed cloze mode",
        body: "Ready to level-up cloze cards? Turn on typed cloze in settings for active recall.",
        demo: "Demo: The capital of France is [____]",
        actionLabel: "Open card settings",
        actionIcon: "type",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Reverse cards for output",
        body: "When recognition is easy, add reversed cards to train production recall.",
        demo: "Demo: hola -> ?    back: hello",
        actionLabel: "Start a study session",
        actionIcon: "arrow-right",
        action: () => quickStartStudy(),
      },
      {
        title: "Auto-mask diagrams",
        body: "With auto-mask, labelling diagrams has never been quicker.",
        demo: "Demo: 3 quick masks detected on one image",
        actionLabel: "Open image occlusion settings",
        actionIcon: "scan-line",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Math cloze",
        body: "Cloze key parts of formulas to memorize structure, not just outcomes.",
        demo: "Demo: E = m c^[____]",
        actionLabel: "Open card settings",
        actionIcon: "calculator",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Bury siblings",
        body: "Bury siblings to avoid answer cueing from near-duplicate cards in one session.",
        demo: "Demo: Card A today, sibling tomorrow",
        actionLabel: "Open scheduling settings",
        actionIcon: "layers",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Atomic cards",
        body: "Keep cards to one fact each for easier recall and cleaner edits later.",
        demo: "Demo: One prompt -> one answer",
        actionLabel: "Open guide",
        actionIcon: "book-open",
        action: () => openSettingsTab("guide"),
      },
      {
        title: "Study by groups",
        body: "Use groups to run focused study sessions by topic, unit, or exam block.",
        demo: "Demo: Group chips: Unit 3, Verbs, Anatomy",
        actionLabel: "Open Library",
        actionIcon: "table-2",
        action: () => openLibrary(),
      },
      {
        title: "Bulk edit groups",
        body: "In Library, bulk edit selected cards to quickly add or remove groups.",
        demo: "Demo: Select many -> Add group / Remove group",
        actionLabel: "Open Library",
        actionIcon: "list-checks",
        action: () => openLibrary(),
      },
      {
        title: "AI Companion: improve notes",
        body: "Ask the AI Companion to review your notes and tighten them into one-fact statements.",
        demo: "Demo: Before (long note) -> After (atomic facts)",
        actionLabel: "Open Companion settings",
        actionIcon: "sparkles",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "AI Companion: ask questions",
        body: "Ask questions about your notes to find weak spots before you start reviewing.",
        demo: "Demo: “Summarize chapter 4 in 3 points”",
        actionLabel: "Open Companion settings",
        actionIcon: "message-square",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "AI Companion: generate flashcards",
        body: "Generate flashcards from notes when kicking off a new topic.",
        demo: "Demo: 8 cards generated -> review / edit",
        actionLabel: "Open Companion settings",
        actionIcon: "wand-sparkles",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Pin high-priority decks",
        body: "Pin your priority decks so they stay one-click from Home.",
        demo: "Demo: Pinned row + drag reorder",
        actionLabel: "Go to pinned decks",
        actionIcon: "bookmark",
        action: () => {
          pinnedSection.section.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      },
      {
        title: "Resume recent decks",
        body: "Continue from your most recent deck to remove startup friction.",
        demo: "Demo: Resume last deck in one click",
        actionLabel: "Start a study session",
        actionIcon: "history",
        action: () => quickStartStudy(),
      },
      {
        title: "FSRS for your goals",
        body: "Adjust learning steps and desired retention in settings, useful for cramming before a test or long-term retention.",
        demo: "Demo: Desired retention 0.85 vs 0.95",
        actionLabel: "Open scheduling settings",
        actionIcon: "sliders-horizontal",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Turn on reminders",
        body: "Enable reminders in settings and schedule nudges exactly when you want to study.",
        demo: "Demo: 08:00 • 13:00 • 19:30",
        actionLabel: "Open reminders settings",
        actionIcon: "bell",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Gatekeeper mode",
        body: "Set up Gatekeeper and LearnKit can lock notes until you clear a target number of cards.",
        demo: "Demo: Study 20 cards to unlock",
        actionLabel: "Open study settings",
        actionIcon: "lock",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Image occlusion for visuals",
        body: "Use image occlusion for maps, anatomy, and diagrams to train visual memory fast.",
        demo: "Demo: Hide labels, reveal one-by-one",
        actionLabel: "Open image occlusion settings",
        actionIcon: "image",
        action: () => openSettingsTab("settings"),
      },
      {
        title: "Queue triage",
        body: "Clear overdue first, then due today, then new cards to keep workload predictable.",
        demo: "Demo: Overdue -> Today -> New",
        actionLabel: "Start study now",
        actionIcon: "list-ordered",
        action: () => quickStartStudy(),
      },
      {
        title: "Guide shortcuts",
        body: "Use the in-app guide as your quick reference when learning new workflows.",
        demo: "Demo: Guide section links from Home",
        actionLabel: "Open guide",
        actionIcon: "book-open-check",
        action: () => openSettingsTab("guide"),
      },
    ];

    const infoRow = document.createElement("div");
    infoRow.className = "lk-home-info-row grid grid-cols-1 lg:grid-cols-2 gap-4";
    applyAos(infoRow, HOME_AOS_FIRST_DELAY + HOME_AOS_STEP * 4);
    body.appendChild(infoRow);

    const tipCard = document.createElement("div");
    tipCard.className = "card learnkit-ana-card lk-home-tip-card p-4 flex flex-col gap-3";
    infoRow.appendChild(tipCard);

    const tipHeader = tipCard.createDiv({ cls: "flex items-center justify-between gap-2" });
    tipHeader.createDiv({ cls: "text-sm font-semibold", text: tx("ui.home.tip.title", "Tip of the day") });
    const tipBadge = tipHeader.createDiv({ cls: "text-xs text-muted-foreground" });

    const tipTitle = tipCard.createDiv({ cls: "text-base font-semibold" });
    const tipBody = tipCard.createDiv({ cls: "text-sm text-muted-foreground" });
    const tipDemo = tipCard.createDiv({ cls: "lk-home-tip-demo text-xs" });

    const tipFooter = tipCard.createDiv({ cls: "flex items-center gap-2 mt-1" });
    const tipPrevBtn = tipFooter.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-7 px-2 text-xs inline-flex items-center justify-center",
      text: "Prev",
      attr: { type: "button", "aria-label": "Previous tip" },
    });
    const tipNextBtn = tipFooter.createEl("button", {
      cls: "learnkit-btn-toolbar learnkit-btn-toolbar h-7 px-2 text-xs inline-flex items-center justify-center",
      text: "Next",
      attr: { type: "button", "aria-label": "Next tip" },
    });
    const tipActionHost = tipFooter.createDiv({ cls: "ml-auto" });

    let tipIndex = ((localDayIndex(nowMs, timezone) % tips.length) + tips.length) % tips.length;
    let tipActionBtn: HTMLButtonElement | null = null;

    const renderTip = () => {
      const tip = tips[tipIndex];
      tipBadge.textContent = tx("ui.home.tip.counter", "Tip {current}/{total}", {
        current: tipIndex + 1,
        total: tips.length,
      });
      tipTitle.textContent = tip.title;
      tipBody.textContent = tip.body;
      tipDemo.textContent = tip.demo;

      tipActionBtn?.remove();
      tipActionBtn = createChevronLinkButton(tipActionHost, {
        label: tip.actionLabel,
        icon: tip.actionIcon,
        onClick: tip.action,
      });
    };

    tipPrevBtn.addEventListener("click", () => {
      tipIndex = (tipIndex - 1 + tips.length) % tips.length;
      renderTip();
    });
    tipNextBtn.addEventListener("click", () => {
      tipIndex = (tipIndex + 1) % tips.length;
      renderTip();
    });
    renderTip();

    const projectCard = document.createElement("div");
    projectCard.className = "card learnkit-ana-card lk-home-project-card p-4 flex flex-col gap-3";
    infoRow.appendChild(projectCard);

    projectCard.createDiv({ cls: "text-sm font-semibold", text: tx("ui.home.project.title", "LearnKit project") });
    projectCard.createDiv({
      cls: "text-sm text-muted-foreground",
      text: "Quick links for docs, release notes, and the public repository.",
    });

    const projectMeta = projectCard.createDiv({ cls: "text-xs text-muted-foreground" });
    projectMeta.textContent = tx("ui.home.project.version", "Version {version}", {
      version: this.plugin.manifest.version,
    });

    const projectActions = projectCard.createDiv({ cls: "flex flex-col gap-2 mt-1" });
    createChevronLinkButton(projectActions, {
      label: "Open guide",
      icon: "book-open",
      onClick: () => openSettingsTab("guide"),
    });
    createChevronLinkButton(projectActions, {
      label: "View GitHub",
      icon: "github",
      onClick: () => openGithubRepo(),
    });
    createChevronLinkButton(projectActions, {
      label: "Release notes",
      icon: "package",
      onClick: () => {
        void openSettingsTab("about");
        openReleases();
      },
    });

    // Animate-on-load cascade (not scroll-triggered).
    // Obsidian view content scrolls inside a container, so window-scroll AOS can
    // fail to ever add `aos-animate`.
    if (animationsEnabled) {
      const maxDelay = cascadeAOSOnLoad(root, {
        // Keep the explicit per-section delays set above.
        stepMs: 0,
        baseDelayMs: 0,
        durationMs: AOS_DURATION,
        overwriteDelays: false,
      });

      // Fallback: force elements visible only after the cascade *should* have finished.
      const fallbackAfterMs = Math.max(600, Math.floor(maxDelay + AOS_DURATION + 250));
      setTimeout(() => {
        const aosElements = root.querySelectorAll('[data-aos]');
        aosElements.forEach((el) => {
          if (!el.isConnected) return;
          const style = getComputedStyle(el);
          if (style.opacity === '0' || style.visibility === 'hidden') {
            el.classList.add('learnkit-aos-fallback', 'learnkit-aos-fallback');
          }
        });
      }, fallbackAfterMs);
    } else {
      // If animations disabled, ensure all AOS elements are immediately visible
      const aosElements = root.querySelectorAll('[data-aos]');
      aosElements.forEach((el) => {
        el.classList.add('learnkit-aos-fallback', 'learnkit-aos-fallback');
      });
    }
  }
}
