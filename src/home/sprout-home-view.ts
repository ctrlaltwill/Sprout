/**
 * @file src/home/sprout-home-view.ts
 * @summary The Sprout Home tab — an Obsidian ItemView that renders the plugin's dashboard with study-streak tracking, due-card statistics, pinned and recent decks, a review calendar heatmap, and about/changelog information.
 *
 * @exports
 *  - SproutHomeView — Obsidian ItemView subclass implementing the Home dashboard tab
 */

import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { type SproutHeader, createViewHeader } from "../core/header";
import { log } from "../core/logger";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, VIEW_TYPE_HOME, VIEW_TYPE_REVIEWER } from "../core/constants";
import { queryFirst, setCssProps } from "../core/ui";
import type SproutPlugin from "../main";
import type { CardRecord } from "../core/store";
import type { Scope } from "../reviewer/types";
import { isParentCard } from "../core/card-utils";
import { ReviewCalendarHeatmap } from "../analytics/review-calendar-heatmap";
import { cascadeAOSOnLoad, initAOS, resetAOS } from "../core/aos-loader";

import {
  MS_DAY,
  localDayIndex,
  formatTimeAgo,
  scopeFromDeckPath,
  formatCountdownToMidnight,
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
  plugin: SproutPlugin;

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  // Removed: now uses plugin.isWideMode
  private _heatmapRoot: ReactRoot | null = null;
  private _streakTimer: number | null = null;
  private _liveTimer: number | null = null;
  private _typingTimer: number | null = null;
  private _nameObserver: ResizeObserver | null = null;
  private _themeObserver: MutationObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_HOME;
  }

  getDisplayText() {
    return "Sprout";
  }

  getIcon() {
    return "sprout";
  }

  async onOpen() {
    this.render();
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
    resetAOS();
    await Promise.resolve();
  }

  onRefresh() {
    this.render();
  }

  /** Apply or remove wide-mode layout constraints. */
  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-sprout-wide", "1");
    else this.containerEl.removeAttribute("data-sprout-wide");

    const root = this._rootEl;
    if (!root) return;

    if (this.plugin.isWideMode) {
      setCssProps(root, "--sprout-home-max-width", "none");
    } else {
      setCssProps(root, "--sprout-home-max-width", MAX_CONTENT_WIDTH_PX);
    }
  }

  // ─── Main render ─────────────────────────────────────────────────

  render() {
    const root = this.contentEl;
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
    root.classList.add("bc", "sprout-view-content", "flex", "flex-col", "sprout-home-root");

    this.containerEl.addClass("sprout");

    // Animation control
    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    root.classList.toggle("sprout-no-animate", !animationsEnabled);
    const applyAos = (el: HTMLElement, delay: number = 0) => {
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


    // Greeting logic: show greeting or just 'Home' based on settings
    const showGreeting = this.plugin.settings.general.showGreeting !== false;
    const nameSetting = this.plugin.settings.general.userName ?? "";
    const trimmedName = String(nameSetting || "").trim();
    const nowMs = Date.now();

    const title = document.createElement("div");
    title.className = "sprout-inline-sentence flex items-center gap-1 flex-wrap";
    applyAos(title, 0);
    root.appendChild(title);

    if (showGreeting) {
      const greetingIconEl = document.createElement("span");
      greetingIconEl.className = "sprout-greeting-icon";
      setIcon(greetingIconEl, "sprout");
      title.appendChild(greetingIconEl);

      const greetingPrefixEl = document.createElement("div");
      greetingPrefixEl.className = "text-xl font-semibold tracking-tight";
      title.appendChild(greetingPrefixEl);

      const nameInput = document.createElement("input");
      nameInput.className = "sprout-home-name-input text-xl font-semibold tracking-tight";
      nameInput.type = "text";
      nameInput.placeholder = "Your name";
      nameInput.value = trimmedName;

      const greetingSuffixEl = document.createElement("div");
      greetingSuffixEl.className = "sprout-greeting-suffix text-xl font-semibold tracking-tight";
      title.appendChild(nameInput);
      title.appendChild(greetingSuffixEl);

      const nameSizer = document.createElement("span");
      nameSizer.className = "sprout-name-sizer text-xl font-semibold tracking-tight";
      title.appendChild(nameSizer);

      const syncNameWidth = () => {
        const value = nameInput.value || nameInput.placeholder || "";
        const computed = window.getComputedStyle(nameInput);
        setCssProps(nameSizer, "--sprout-home-font-family", computed.fontFamily);
        setCssProps(nameSizer, "--sprout-home-font-size", computed.fontSize);
        setCssProps(nameSizer, "--sprout-home-font-weight", computed.fontWeight);
        setCssProps(nameSizer, "--sprout-home-letter-spacing", computed.letterSpacing);
        setCssProps(nameSizer, "--sprout-home-text-transform", computed.textTransform);
        setCssProps(nameSizer, "--sprout-home-font-style", computed.fontStyle);
        setCssProps(nameSizer, "--sprout-home-font-variant", computed.fontVariant);
        setCssProps(nameSizer, "--sprout-home-line-height", computed.lineHeight);
        nameSizer.textContent = value;
        const measured = Math.ceil(nameSizer.getBoundingClientRect().width);
        const paddingLeft = Number.parseFloat(computed.paddingLeft || "0") || 0;
        const paddingRight = Number.parseFloat(computed.paddingRight || "0") || 0;
        const borderLeft = Number.parseFloat(computed.borderLeftWidth || "0") || 0;
        const borderRight = Number.parseFloat(computed.borderRightWidth || "0") || 0;
        const chromeWidth = paddingLeft + paddingRight + borderLeft + borderRight;
        const next = Math.max(1, measured + chromeWidth + 2);
        setCssProps(nameInput, "--sprout-home-name-width", `${next}px`);
      };

      const setGreetingText = (_name: string, firstOpen: boolean) => {
        const hour = new Date(nowMs).getHours();
        const variants = firstOpen
          ? ["Welcome to Sprout, {name}"]
          : [
              "Welcome back to Sprout, {name}",
              "Kia ora {name}!",
              "G'day {name}!",
            ];
        if (hour >= 5 && hour < 12) variants.push("Good morning {name}");
        if (hour >= 5 && hour < 12) variants.push("Good morning {name}");
        else if (hour >= 12 && hour < 18) variants.push("Good afternoon {name}");
        else variants.push("Good evening {name}");

        const pick = variants[Math.floor(Math.random() * variants.length)];
        const [prefix, suffix] = pick.split("{name}");
        greetingPrefixEl.textContent = prefix ?? "";
        greetingSuffixEl.textContent = suffix ?? "";
        syncNameWidth();
      };

      const firstHomeOpen = !(this.plugin.settings.general.hasOpenedHome);
      setGreetingText(trimmedName, firstHomeOpen);
      if (firstHomeOpen) {
        this.plugin.settings.general.hasOpenedHome = true;
        try { void this.plugin.saveAll(); } catch (e) { log.swallow("save settings", e); }
      }

      // Typing placeholder effect for the name input when empty
      const typingText = "your name";
      let typingIdx = 0;
      let typingDir: 1 | -1 = 1;
      const typingStep = () => {
        try {
          nameInput.placeholder = typingText.slice(0, typingIdx);
          syncNameWidth();
          typingIdx += typingDir;
          if (typingIdx >= typingText.length) typingDir = -1;
          else if (typingIdx <= 0) typingDir = 1;
        } catch {
          // ignore
        }
        this._typingTimer = window.setTimeout(typingStep, typingDir === 1 ? 220 : 120);
      };

      const startTypingEffect = () => {
        if (this._typingTimer) return;
        typingIdx = 0;
        typingDir = 1 as const;
        typingStep();
      };

      const stopTypingEffect = () => {
        if (this._typingTimer) {
          window.clearTimeout(this._typingTimer);
          this._typingTimer = null;
        }
        nameInput.placeholder = typingText;
        syncNameWidth();
      };

      let saveTimer: number | null = null;
      const onNameResize = () => syncNameWidth();
      nameInput.addEventListener("input", onNameResize);
      nameInput.addEventListener("change", onNameResize);
      this._nameObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              syncNameWidth();
            })
          : null;
      if (this._nameObserver) this._nameObserver.observe(title);
      window.requestAnimationFrame(() => syncNameWidth());
      if (!trimmedName) startTypingEffect();

      nameInput.addEventListener("focus", stopTypingEffect);
      nameInput.addEventListener("input", () => {
        syncNameWidth();
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          void (async () => {
            const next = nameInput.value.trim();
            this.plugin.settings.general.userName = next;
            await this.plugin.saveAll();
          })();
        }, 300);
      });
      nameInput.addEventListener("blur", () => {
        if (!nameInput.value.trim()) startTypingEffect();
      });
    } else {
      // Greeting is off: just show 'Home' as the title
      title.className += " text-xl font-semibold tracking-tight";
      title.textContent = "Home"
    }

    // (greeting input logic is now only inside the showGreeting block)

    const body = document.createElement("div");
    body.className = "w-full flex flex-col gap-4";
    root.appendChild(body);

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

    const reviewEvents = events.filter((ev) => ev && ev.kind === "review");
    const sessionEvents = events.filter((ev) => ev && ev.kind === "session");
    reviewEvents.sort((a, b) => Number(b.at) - Number(a.at));
    sessionEvents.sort((a, b) => Number(b.at) - Number(a.at));

    const recentDecks: Array<{ scope: Scope; lastAt: number; label: string }> = [];
    const seenDecks = new Set<string>();
    for (const ev of sessionEvents) {
      const scope = ev?.scope;
      if (!scope || typeof scope !== "object") continue;
      const type = String(scope.type || "");
      const key = String(scope.key || "");
      const name = String(scope.name || "");
      if (!["vault", "folder", "note"].includes(type)) continue;
      const label = type === "vault" ? "All cards" : (key || name).trim();
      if (!label) continue;
      const dedupeKey = `${type}:${key || name}`;
      if (seenDecks.has(dedupeKey)) continue;
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
    let activeDays = 0;
    for (let i = 0; i < daysRange; i += 1) {
      const idx = todayIndex - i;
      const entry = dayMap.get(idx);
      if (entry) {
        reviews7d += entry.count;
        time7d += entry.totalMs;
        if (entry.count > 0) activeDays += 1;
      }
    }
    const avgCardsPerDay = reviews7d / daysRange;
    const avgTimePerDayMinutes = time7d / daysRange / 60000;

    let currentStreak = 0;
    let cursor = todayIndex;
    while (dayMap.get(cursor)?.count) {
      currentStreak += 1;
      cursor -= 1;
    }
    const atRisk = !dayMap.get(todayIndex)?.count && (dayMap.get(todayIndex - 1)?.count ?? 0) > 0;

    const openStudyForScope = async (scope: Scope) => {
      try {
        await this.plugin.openReviewerTab();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEWER)[0];
        const view = leaf?.view as { openSession?(scope: unknown): void } | undefined;
        if (view && typeof view.openSession === "function") {
          view.openSession(scope);
        } else {
          new Notice("Study view not ready yet. Try again.");
        }
      } catch {
        new Notice("Unable to open study.");
      }
    };

    const openStudyForDeckPath = async (path: string) => {
      await openStudyForScope(scopeFromDeckPath(path));
    };

    const makeDeckSection = (label: string, iconName?: string) => {
      const section = document.createElement("div");
      section.className = "flex flex-col gap-3 p-3 rounded-lg border border-border bg-background";
      const headingRow = section.createDiv({ cls: "sprout-section-heading-row flex items-center justify-between gap-2" });
      headingRow.createDiv({ cls: "font-semibold", text: label });
      if (iconName) {
        const iconWrapper = headingRow.createEl("span", { cls: "sprout-icon-20" });
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

    const pinnedSection = makeDeckSection("Pinned decks", "pin");
    const recentSection = makeDeckSection("Recent decks", "clock");

    const statsRow = document.createElement("div");
    statsRow.className = "sprout-ana-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4";
    applyAos(statsRow, 200);
    body.appendChild(statsRow);

    // Decks card wrapper
    const decksCard = document.createElement("div");
    decksCard.className = "card sprout-ana-card p-4 flex flex-col gap-4";
    applyAos(decksCard, 400);
    body.appendChild(decksCard);

    // Decks row: pinned (left) and recent (right)
    const decksRow = document.createElement("div");
    decksRow.className = "grid grid-cols-1 lg:grid-cols-2 gap-4";
    decksCard.appendChild(decksRow);
    decksRow.appendChild(pinnedSection.section);
    decksRow.appendChild(recentSection.section);

    const makeStatCard = (label: string, value: string, note?: string) => {
      const card = document.createElement("div");
      card.className = "card sprout-ana-card sprout-stat-card small-card flex flex-col gap-2 lg:flex-1";
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
      badge.className = "sprout-trend-badge sprout-rotate";
      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center";
      const iconName = trend.dir > 0 ? "trending-up" : trend.dir < 0 ? "trending-down" : "minus";
      setIcon(icon, iconName);
      badge.appendChild(icon);
      const valueEl = document.createElement("span");
      valueEl.textContent = trend.dir === 0 ? "0%" : `${trend.dir > 0 ? "+" : ""}0%`;
      badge.appendChild(valueEl);

      // Animate count-up with subtle spin
      const durationMs = 800;
      const start = performance.now();
      const target = trend.value;
      const startAngle = 0;
      const endAngle = trend.dir === 0 ? 0 : (trend.dir > 0 ? 180 : -180);
      const animate = (t: number) => {
        const elapsed = t - start;
        const p = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOut
        const currentVal = (trend.dir === 0 ? 0 : (eased * Math.abs(target))) * (trend.dir >= 0 ? 1 : -1);
        valueEl.textContent = `${currentVal >= 0 ? "+" : ""}${currentVal.toFixed(0)}%`;
        const angle = startAngle + (endAngle - startAngle) * eased;
        setCssProps(badge as HTMLElement, "--sprout-rotate", `${angle}deg`);
        if (p < 1) requestAnimationFrame(animate);
        else {
          setCssProps(badge as HTMLElement, "--sprout-rotate", "0deg");
          valueEl.textContent = trend.text;
        }
      };
      requestAnimationFrame(animate);
      return badge;
    };

    makeStatCard("Cards overdue", String(totalOverdue));
    makeStatCard("Cards due today", String(totalDueToday));

    // Avg time/day card with trend badge
    {
      const card = document.createElement("div");
      card.className = "card sprout-ana-card sprout-stat-card small-card p-4 flex flex-col gap-2 lg:flex-1";
      statsRow.appendChild(card);
      const header = card.createDiv({ cls: "flex items-center justify-between text-sm text-muted-foreground" });
      header.createDiv({ text: "Daily time", cls: "bc" });
      const timeTrend = formatTrend(avgTimePerDayMinutes, prevAvgTimePerDayMinutes, prevActiveDaysTime);
      header.appendChild(buildTrendBadge(timeTrend));
      card.createDiv({ cls: "text-2xl font-semibold", text: `${Math.ceil(avgTimePerDayMinutes)} min` });
      card.createDiv({ cls: "text-xs text-muted-foreground", text: "Last 7 days" });
    }

    // Avg cards/day card with trend badge
    {
      const card = document.createElement("div");
      card.className = "card sprout-ana-card sprout-stat-card small-card p-4 flex flex-col gap-2 lg:flex-1";
      statsRow.appendChild(card);
      const header = card.createDiv({ cls: "flex items-center justify-between text-sm text-muted-foreground" });
      header.createDiv({ text: "Daily cards", cls: "bc" });
      const cardsTrend = formatTrend(avgCardsPerDay, prevAvgCardsPerDay, prevActiveDaysReviews);
      header.appendChild(buildTrendBadge(cardsTrend));
      card.createDiv({ cls: "text-2xl font-semibold", text: `${Math.round(avgCardsPerDay)}` });
      card.createDiv({ cls: "text-xs text-muted-foreground", text: "Last 7 days" });
    }
    const includesToday = (dayMap.get(todayIndex)?.count ?? 0) > 0;
    const streakCard = document.createElement("div");
    streakCard.className = "card sprout-ana-card sprout-stat-card small-card p-4 flex flex-col gap-2 lg:flex-1";
    statsRow.appendChild(streakCard);
    const streakHeader = streakCard.createDiv({ cls: "flex items-center justify-between text-sm text-muted-foreground" });
    streakHeader.createDiv({ cls: "bc", text: "Streak" });
    if (includesToday) {
      const keepBadge = document.createElement("span");
      keepBadge.className = "sprout-trend-badge sprout-live-badge sprout-live-badge-dark";
      
      // Flashing circle
      const circle = document.createElement("span");
      circle.className = "sprout-live-indicator";
      keepBadge.appendChild(circle);
      
      keepBadge.appendChild(document.createTextNode("Live"));
      streakHeader.appendChild(keepBadge);
    }
    streakCard.createDiv({ cls: "text-2xl font-semibold", text: `${currentStreak} day${currentStreak === 1 ? "" : "s"}` });
    streakCard.createDiv({ cls: "text-xs text-muted-foreground", text: (activeDays === 0 ? "No reviews yet" : (atRisk ? `Ends in ${formatCountdownToMidnight(nowMs)} — study today.` : (includesToday ? "Keep it going!" : "Streak active."))) });

    if (atRisk) {
      this._streakTimer = window.setInterval(() => {
        if (!statsRow?.parentElement) return; // Element was removed from DOM
        const cards = Array.from(statsRow.querySelectorAll(".sprout-ana-card"));
        const last = cards[cards.length - 1] ?? undefined;
        const noteEl = last ? queryFirst<HTMLElement>(last, ".text-xs") : null;
        if (noteEl) noteEl.textContent = `Ends in ${formatCountdownToMidnight(Date.now())} — study today.`;
      }, 1000);
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
      await this.plugin.saveData(this.plugin.settings);
    };
    
    const renderPinnedDecks = () => {
      pinnedList.empty();
      
      // Render all 5 slots: pinned decks, then input (if space), then placeholders
      for (let i = 0; i < MAX_PINNED; i++) {
        if (i < currentPinned.length) {
          // Render pinned deck button
          const path = currentPinned[i];
          const row = pinnedList.createDiv({ 
            cls: "sprout-deck-row flex items-center justify-between gap-3 p-2 rounded-lg border border-border bg-background cursor-pointer hover:bg-accent/50"
          });
          const pinnedLeafName = getDeckLeafName(path);
          const pinnedTooltip = `Study ${pinnedLeafName || "deck"}`;
          row.setAttr("data-tooltip", pinnedTooltip);
          
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
            cls: "sprout-drag-handle inline-flex items-center justify-center",
            attr: { "data-action": "drag", "data-tooltip": "Drag to reorder" }
          });
          setIcon(hamburger, "grip-vertical");
          
          const name = left.createDiv({ cls: "sprout-text-truncate-rtl truncate font-medium min-w-0 flex-1" });
          const pinnedLabel = formatPinnedDeckLabel(path);
          name.textContent = pinnedLabel;
          
          const right = row.createDiv({ cls: "flex items-center gap-2 shrink-0" });
          
          const due = getDueForPrefix(path);
          right.createDiv({ cls: "text-xs text-muted-foreground", text: `${due} due` });
          
          const removeBtn = right.createEl("span", { 
            cls: "sprout-deck-remove-btn inline-flex items-center justify-center cursor-pointer",
            attr: { "data-action": "delete", "data-tooltip": "Remove from pinned decks" }
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
          let draggedOverIndex: number | null = null;
          let dragOffset = 50;
          
          row.addEventListener("dragstart", (e) => {
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", i.toString());
            }
            row.classList.add("sprout-deck-row-dragging");
            // Set all rows to relative for transform animation
            const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
            const firstRow = allRows[0];
            const gapValue = parseFloat(getComputedStyle(pinnedList).rowGap || "0");
            if (firstRow) {
              dragOffset = Math.round(firstRow.getBoundingClientRect().height + gapValue);
            }
            allRows.forEach(r => {
              r.classList.add("sprout-deck-row-anim");
              setCssProps(r, "--sprout-deck-row-translate", "0px");
            });
          });
          
          row.addEventListener("dragend", () => {
            row.classList.remove("sprout-deck-row-dragging");
            draggedOverIndex = null;
            // Clear any transforms and reset position
            const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
            allRows.forEach(r => {
              setCssProps(r, "--sprout-deck-row-translate", "0px");
              r.classList.remove("sprout-deck-row-anim");
            });
          });
          
          row.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

            const fromIndexStr = e.dataTransfer?.getData("text/plain");
            const fromIndex = fromIndexStr ? Number(fromIndexStr) : -1;
            if (fromIndex === -1 || fromIndex === i) return;

            // Animate other rows moving up or down (no re-render)
            if (draggedOverIndex !== i) {
              draggedOverIndex = i;
              const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
              allRows.forEach((r, idx) => {
                if (idx === fromIndex) {
                  // Dragged item: visually move to hovered slot
                  setCssProps(r, "--sprout-deck-row-translate", `${(i - fromIndex) * dragOffset}px`);
                } else {
                  // Calculate if this row should move up or down
                  let offset = 0;
                  if (fromIndex < i) {
                    // Dragging down: items between fromIndex and i move up
                    if (idx > fromIndex && idx <= i) {
                      offset = -dragOffset;
                    }
                  } else {
                    // Dragging up: items between i and fromIndex move down
                    if (idx >= i && idx < fromIndex) {
                      offset = dragOffset;
                    }
                  }
                  setCssProps(r, "--sprout-deck-row-translate", `${offset}px`);
                }
              });
            }
          });
          
          row.addEventListener("drop", (e) => {
            e.preventDefault();
            void (async () => {
              const fromIndex = Number(e.dataTransfer?.getData("text/plain") || "-1");
              if (fromIndex === -1 || fromIndex === i) return;
              // Clear transforms before re-rendering
              const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
              allRows.forEach(r => setCssProps(r, "--sprout-deck-row-translate", "0px"));
              const item = currentPinned[fromIndex];
              currentPinned.splice(fromIndex, 1);
              currentPinned.splice(i, 0, item);
              await savePinnedDecks(currentPinned);
              renderPinnedDecks();
            })();
          });
        } else if (i === currentPinned.length && currentPinned.length < MAX_PINNED) {
          // Render search input in the first empty slot
          const searchRow = pinnedList.createDiv({ cls: "relative" });
          searchInputEl = searchRow.createEl("input", { 
            cls: "sprout-deck-search-input w-full text-sm text-center text-muted-foreground", 
              attr: { type: "text", placeholder: "Search to add a pinned deck" }
          });
          searchInputEl.setAttr("data-tooltip", "Search for decks");
          searchInputEl.setAttr("title", "Search for decks");
          
          searchInputEl.addEventListener("focus", () => {
            searchInputEl!.classList.add("sprout-deck-search-input-focused");
          });
          
          searchInputEl.addEventListener("blur", () => {
            setTimeout(() => {
              if (searchInputEl!.value === "") {
                searchInputEl!.classList.remove("sprout-deck-search-input-focused");
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
            cls: "sprout-deck-search-dropdown sprout-dropdown-shadow hidden overflow-hidden"
          });
          
          renderSearchDropdown();
        } else {
          // Render placeholder - use absolute slot number (i + 1)
          const placeholder = pinnedList.createDiv({ 
            cls: "sprout-placeholder-slot"
          });
          placeholder.textContent = `Empty slot ${i + 1}`;
        }
      }
    };
    
    const renderSearchDropdown = () => {
      if (!dropdownEl) return;
      
      if (!searchDropdownOpen || !deckSearchQuery.trim()) {
        dropdownEl.classList.add("hidden");
        return;
      }
      
      dropdownEl.classList.remove("hidden");
      dropdownEl.empty();
      
      const query = deckSearchQuery.trim().toLowerCase();
      const filtered = allDecks
        .filter(deck => {
          if (currentPinned.includes(deck)) return false;
          const normalized = deck.toLowerCase().replace(/\.md$/i, "").replace(/\s*\/\s*/g, "/");
          return normalized.includes(query);
        })
        .slice(0, 10);
      
      if (filtered.length === 0) {
        const empty = dropdownEl.createDiv({ cls: "p-3 text-sm text-muted-foreground text-center" });
        empty.textContent = "No decks found";
        return;
      }
      
      filtered.forEach(deck => {
        const item = dropdownEl!.createDiv({ 
          cls: "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground" 
        });
        const deckLeafName = getDeckLeafName(deck);
        const addPinnedTooltip = `Add ${deckLeafName || "deck"} pinned decks`;
        item.setAttr("data-tooltip", addPinnedTooltip);
        item.setAttr("title", addPinnedTooltip);
        
        const label = item.createDiv({ cls: "sprout-text-truncate-rtl truncate flex-1" });
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
      });
    };
    
    renderPinnedDecks();

    const recentList = recentSection.list;
    const recentSlots = recentDecks.slice(0, 5);
    for (let i = 0; i < 5; i += 1) {
      const deck = recentSlots[i];
      if (deck) {
        const row = recentList.createDiv({ 
          cls: "sprout-deck-row flex items-center justify-between gap-3 cursor-pointer p-2 rounded-lg border border-border bg-background hover:bg-accent/30"
        });
        const recentLeafName = deck.scope.type === "vault" ? "All cards" : getDeckLeafName(deck.label);
        const recentTooltip = `Study ${recentLeafName || "deck"}`;
        row.setAttr("data-tooltip", recentTooltip);
        row.setAttr("data-tooltip-position", "bottom");
        row.addEventListener("click", () => void openStudyForScope(deck.scope));
        
        const left = row.createDiv({ cls: "flex flex-col min-w-0 flex-1" });
        const name = left.createDiv({ cls: "sprout-text-truncate-rtl truncate font-medium" });
        name.textContent = formatDeckLabel(deck.label, 60);
        const right = row.createDiv({ cls: "flex items-center gap-2 shrink-0" });
        const due = getDueForScope(deck.scope);
        right.createDiv({
          cls: "text-xs text-muted-foreground",
          text: `${formatTimeAgo(deck.lastAt)} • ${due} due`,
        });
      } else {
        const placeholder = recentList.createDiv({ 
          cls: "sprout-placeholder-slot"
        });
        placeholder.textContent = `Empty slot ${i + 1}`;
      }
    }

    const heatmapHost = document.createElement("div");
    heatmapHost.className = "sprout-heatmap-host";
    applyAos(heatmapHost, 600);
    body.appendChild(heatmapHost);
    this._heatmapRoot = createRoot(heatmapHost);
    this._heatmapRoot.render(
      React.createElement(ReviewCalendarHeatmap, {
        revlog: reviewEvents,
        timezone,
        rangeDays: 365,
        filters: {},
      }),
    );

    // Animate-on-load cascade (not scroll-triggered).
    // Obsidian view content scrolls inside a container, so window-scroll AOS can
    // fail to ever add `aos-animate`.
    if (animationsEnabled) {
      const maxDelay = cascadeAOSOnLoad(root, {
        // Home: use a larger gap so the load sequence feels intentionally staged.
        stepMs: 200,
        baseDelayMs: 0,
        durationMs: AOS_DURATION,
        overwriteDelays: true,
      });

      // Fallback: force elements visible only after the cascade *should* have finished.
      const fallbackAfterMs = Math.max(600, Math.floor(maxDelay + AOS_DURATION + 250));
      setTimeout(() => {
        const aosElements = root.querySelectorAll('[data-aos]');
        aosElements.forEach((el) => {
          if (!el.isConnected) return;
          const style = getComputedStyle(el);
          if (style.opacity === '0' || style.visibility === 'hidden') {
            el.classList.add('sprout-aos-fallback');
          }
        });
      }, fallbackAfterMs);
    } else {
      // If animations disabled, ensure all AOS elements are immediately visible
      const aosElements = root.querySelectorAll('[data-aos]');
      aosElements.forEach((el) => {
        el.classList.add('sprout-aos-fallback');
      });
    }
  }
}
