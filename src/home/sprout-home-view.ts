/**
 * home/SproutHomeView.ts
 * ──────────────────────
 * The Sprout Home tab — a dashboard showing study streak, due-card
 * stats, pinned & recent decks, a review heatmap, and about/changelog info.
 *
 * Renamed from BootCampHomeView → SproutHomeView as part of the
 * "no Boot Camp naming" refactor.
 */

import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { SproutHeader, type SproutHeaderPage } from "../components/header";
import { VIEW_TYPE_HOME, VIEW_TYPE_REVIEWER } from "../core/constants";
import type SproutPlugin from "../main";
import { ReviewCalendarHeatmap } from "../analytics/review-calendar-heatmap";
import { initAOS, refreshAOS, resetAOS } from "../core/aos-loader";

import {
  MS_DAY,
  localDayIndex,
  formatTimeAgo,
  scopeFromDeckPath,
  formatCountdownToMidnight,
  formatDeckLabel,
  formatPinnedDeckLabel,
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
    if (this.plugin.settings?.appearance?.enableAnimations ?? true) {
      // Delay init to ensure DOM is fully rendered
      setTimeout(() => {
        initAOS({
          duration: 600,
          easing: "ease-out",
          once: true,
          offset: 50,
        });
      }, 100);
    }
  }

  async onClose() {
    try {
      this._header?.dispose?.();
    } catch {}
    this._header = null;
    if (this._streakTimer) {
      window.clearInterval(this._streakTimer);
      this._streakTimer = null;
    }
    if (this._liveTimer) {
      window.clearInterval(this._liveTimer);
      this._liveTimer = null;
    }
    try {
      this._heatmapRoot?.unmount();
    } catch {}
    this._heatmapRoot = null;
    resetAOS();
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
      root.style.setProperty("max-width", "none", "important");
      root.style.setProperty("width", "100%", "important");
    } else {
      root.style.setProperty("max-width", "1080px", "important");
      root.style.setProperty("width", "100%", "important");
    }
    root.style.setProperty("margin-left", "auto", "important");
    root.style.setProperty("margin-right", "auto", "important");
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
      } catch {}
      this._heatmapRoot = null;
    }

    // --- Hide Sprout info logic ---
    const hideSproutInfo = (this.plugin.settings as any)?.home?.hideSproutInfo === true;

    this._rootEl = root;
    root.classList.add("bc", "sprout-view-content", "flex", "flex-col");

    this.containerEl.addClass("sprout");
    this.setTitle?.("Sprout");

    // Animation control
    const animationsEnabled = this.plugin.settings?.appearance?.enableAnimations ?? true;
    const applyAos = (el: HTMLElement, delay: number = 0) => {
      if (!animationsEnabled) return;
      el.setAttribute("data-aos", "fade-up");
      if (delay > 0) el.setAttribute("data-aos-delay", delay.toString());
    };

    if (!this._header) {
      const leaf = this.leaf ?? this.app.workspace.getLeaf(false);
      this._header = new SproutHeader({
        app: this.app,
        leaf,
        containerEl: this.containerEl,
        getIsWide: () => this.plugin.isWideMode,
        toggleWide: () => {
          this.plugin.isWideMode = !this.plugin.isWideMode;
          this._applyWidthMode();
        },
        runSync: () => {
          const anyPlugin = this.plugin as any;
          if (typeof anyPlugin._runSync === "function") void anyPlugin._runSync();
          else if (typeof anyPlugin.syncBank === "function") void anyPlugin.syncBank();
          else new Notice("Sync not available (no sync method found).");
        },
      } as any);
    }

    (this._header as any).install?.("home" as SproutHeaderPage);
    this._applyWidthMode();


    // Greeting logic: show greeting or just 'Home' based on settings
    const showGreeting = (this.plugin.settings as any)?.home?.showGreeting !== false;
    const nameSetting = (this.plugin.settings as any)?.home?.userName ?? "";
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
      nameInput.placeholder = "your name";
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
        const fontSizePx = Number.parseFloat(computed.fontSize || "16") || 16;
        const paddingBuffer = fontSizePx * 0.3;
        nameSizer.style.fontFamily = computed.fontFamily;
        nameSizer.style.fontSize = computed.fontSize;
        nameSizer.style.fontWeight = computed.fontWeight;
        nameSizer.style.letterSpacing = computed.letterSpacing;
        nameSizer.style.textTransform = computed.textTransform;
        nameSizer.style.fontStyle = computed.fontStyle;
        nameSizer.style.fontVariant = computed.fontVariant;
        nameSizer.style.lineHeight = computed.lineHeight;
        nameSizer.textContent = value;
        const measured = nameSizer.getBoundingClientRect().width;
        const next = Math.max(32, measured + paddingBuffer);
        nameInput.style.width = `${Math.min(next, 240)}px`;
      };

      const setGreetingText = (name: string, firstOpen: boolean) => {
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

      const firstHomeOpen = !((this.plugin.settings as any)?.home?.hasOpenedHome);
      setGreetingText(trimmedName, firstHomeOpen);
      if (firstHomeOpen) {
        (this.plugin.settings as any).home ??= {};
        (this.plugin.settings as any).home.hasOpenedHome = true;
        try { void (this.plugin as any).saveAll?.(); } catch {}
      }

      // Typing placeholder effect for the name input when empty
      const typingText = "your name";
      let typingIdx = 0;
      let typingDir: 1 | -1 = 1;
      let typingTimer: number | null = null;

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
        typingTimer = window.setTimeout(typingStep, typingDir === 1 ? 220 : 120);
      };

      const startTypingEffect = () => {
        if (typingTimer) return;
        typingIdx = 0;
        typingDir = 1 as 1;
        typingStep();
      };

      const stopTypingEffect = () => {
        if (typingTimer) {
          window.clearTimeout(typingTimer);
          typingTimer = null;
        }
        nameInput.placeholder = typingText;
        syncNameWidth();
      };

      let saveTimer: number | null = null;
      const onNameResize = () => syncNameWidth();
      nameInput.addEventListener("input", onNameResize);
      nameInput.addEventListener("change", onNameResize);
      const nameObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              syncNameWidth();
            })
          : null;
      if (nameObserver) nameObserver.observe(title);
      window.requestAnimationFrame(() => syncNameWidth());
      if (!trimmedName) startTypingEffect();

      nameInput.addEventListener("focus", stopTypingEffect);
      nameInput.addEventListener("input", () => {
        syncNameWidth();
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => {
          const next = nameInput.value.trim();
          (this.plugin.settings as any).home ??= {};
          (this.plugin.settings as any).home.userName = next;
          await this.plugin.saveAll();
        }, 300);
      });
      nameInput.addEventListener("blur", () => {
        if (!nameInput.value.trim()) startTypingEffect();
      });
    } else {
      // Greeting is off: just show 'Home' as the title
      const homeTitle = document.createElement("div");
      homeTitle.className = "text-xl font-semibold tracking-tight";
      homeTitle.textContent = "Home";
      title.appendChild(homeTitle);
    }

    // (greeting input logic is now only inside the showGreeting block)

    const body = document.createElement("div");
    body.className = "w-full flex flex-col gap-4";
    root.appendChild(body);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const events = this.plugin.store.getAnalyticsEvents?.() ?? [];
    const cards = this.plugin.store.getAllCards?.() ?? [];
    const states = (this.plugin.store as any)?.data?.states ?? {};
    const starData = (this.plugin.settings as any)?.home?.githubStars ?? {};
    const starCount = Number(starData?.count);

    // Refresh GitHub stars (respects 6-hour cache unless forced)
    if (typeof (this.plugin as any).refreshGithubStars === "function") {
      void (this.plugin as any).refreshGithubStars(false);
    }

    const cardsById = new Map<string, any>();
    for (const card of cards) {
      if (card?.id) cardsById.set(String(card.id), card);
    }

    const reviewEvents = events.filter((ev: any) => ev && ev.kind === "review");
    const sessionEvents = events.filter((ev: any) => ev && ev.kind === "session");
    reviewEvents.sort((a: any, b: any) => Number(b.at) - Number(a.at));
    sessionEvents.sort((a: any, b: any) => Number(b.at) - Number(a.at));

    const recentDecks: Array<{ scope: any; lastAt: number; label: string }> = [];
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

    const pinnedDecks: string[] = (this.plugin.settings as any)?.home?.pinnedDecks ?? [];

    const dueCounts = new Map<string, number>();
    let totalOverdue = 0;
    let totalDueToday = 0;
    let totalDue = 0;
    let dueTomorrow = 0;
    const startOfTodayMs = new Date(nowMs).setHours(0, 0, 0, 0);
    const endOfTodayMs = new Date(nowMs).setHours(23, 59, 59, 999);
    const tomorrowMs = nowMs + 24 * 60 * 60 * 1000;
    for (const card of cards) {
      const id = String(card?.id ?? "");
      if (!id) continue;
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
        dueTomorrow += 1;
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

    const getDueForScope = (scope: any) => {
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

    const openStudyForScope = async (scope: any) => {
      try {
        await this.plugin.openReviewerTab();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEWER)[0];
        const view = leaf?.view as any;
        if (view && typeof view.openSession === "function") {
          view.openSession(scope);
        } else {
          new Notice("Study view not ready yet. Try again.");
        }
      } catch (e) {
        new Notice("Unable to open Study.");
      }
    };

    const openStudyForDeckPath = async (path: string) => {
      await openStudyForScope(scopeFromDeckPath(path));
    };

    const openAnalytics = async () => {
      try {
        await this.plugin.openAnalyticsTab();
      } catch (e) {
        new Notice("Unable to open Analytics.");
      }
    };

    const makeDeckSection = (label: string, iconName?: string) => {
      const section = document.createElement("div");
      section.className = "flex flex-col gap-3 p-3 rounded-lg border border-border bg-background";
      const headingRow = section.createDiv({ cls: "sprout-section-heading-row flex items-center justify-between gap-2" });
      const heading = headingRow.createDiv({ cls: "font-semibold", text: label });
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
        return { value: 0, text: "0.0%", dir: 0 };
      }
      const raw = ((current - previous) / previous) * 100;
      const capped = Math.min(Math.max(raw, -1000), 1000);
      const dir = capped > 0 ? 1 : capped < 0 ? -1 : 0;
      return { value: capped, text: `${capped > 0 ? "+" : ""}${capped.toFixed(1)}%`, dir };
    };

    const buildTrendBadge = (trend: { value: number; text: string; dir: number }) => {
      const badge = document.createElement("span");
      badge.className = "sprout-trend-badge";
      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center";
      const iconName = trend.dir > 0 ? "trending-up" : trend.dir < 0 ? "trending-down" : "minus";
      setIcon(icon, iconName);
      badge.appendChild(icon);
      const valueEl = document.createElement("span");
      valueEl.textContent = trend.dir === 0 ? "0.0%" : `${trend.dir > 0 ? "+" : ""}0.0%`;
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
        valueEl.textContent = `${currentVal >= 0 ? "+" : ""}${currentVal.toFixed(1)}%`;
        const angle = startAngle + (endAngle - startAngle) * eased;
        (badge as HTMLElement).style.transform = `rotate(${angle}deg)`;
        if (p < 1) requestAnimationFrame(animate);
        else {
          (badge as HTMLElement).style.transform = "rotate(0deg)";
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
      keepBadge.className = "sprout-live-badge";
      
      // Flashing circle
      const circle = document.createElement("span");
      circle.className = "sprout-live-indicator";
      keepBadge.appendChild(circle);
      
      keepBadge.appendChild(document.createTextNode("Live"));
      streakHeader.appendChild(keepBadge);
    }
    streakCard.createDiv({ cls: "text-2xl font-semibold", text: `${currentStreak} day${currentStreak === 1 ? "" : "s"}` });
    const streakNoteEl = streakCard.createDiv({ cls: "text-xs text-muted-foreground", text: (activeDays === 0 ? "No reviews yet" : (atRisk ? `Ends in ${formatCountdownToMidnight(nowMs)} — study today.` : (includesToday ? "Keep it going!" : "Streak active."))) });

    if (atRisk) {
      this._streakTimer = window.setInterval(() => {
        if (!statsRow?.parentElement) return; // Element was removed from DOM
        const cards = Array.from(statsRow.querySelectorAll(".sprout-ana-card"));
        const last = cards[cards.length - 1] as HTMLElement | undefined;
        const noteEl = last?.querySelector(".text-xs") as HTMLElement | null;
        if (noteEl) noteEl.textContent = `Ends in ${formatCountdownToMidnight(Date.now())} — study today.`;
      }, 1000);
    }

    const pinnedList = pinnedSection.list;
    
    // Get all available deck paths for search
    const allDeckPaths = new Set<string>();
    for (const card of Object.values(this.plugin.store.data.cards || {})) {
      const c = card as any;
      if (!c || typeof c !== "object") continue;
      const path = String(c.sourceNotePath || "").trim();
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
      const settings = this.plugin.settings as any;
      if (!settings.home) settings.home = {};
      settings.home.pinnedDecks = decks.slice(0, MAX_PINNED);
      await this.plugin.saveData(settings);
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
            attr: { "data-action": "drag" }
          });
          setIcon(hamburger, "grip-vertical");
          
          const name = left.createDiv({ cls: "sprout-text-truncate-rtl truncate font-medium min-w-0 flex-1" });
          const pinnedLabel = formatPinnedDeckLabel(path);
          name.textContent = pinnedLabel;
          name.setAttr("title", pinnedLabel);
          
          const right = row.createDiv({ cls: "flex items-center gap-2 shrink-0" });
          
          const due = getDueForPrefix(path);
          right.createDiv({ cls: "text-xs text-muted-foreground", text: `${due} due` });
          
          const removeBtn = right.createEl("span", { 
            cls: "sprout-deck-remove-btn inline-flex items-center justify-center cursor-pointer",
            attr: { "data-action": "delete" }
          });
          setIcon(removeBtn, "x");
          removeBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            currentPinned.splice(i, 1);
            await savePinnedDecks(currentPinned);
            renderPinnedDecks();
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
            row.style.zIndex = "10";
            // Set all rows to relative for transform animation
            const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
            const firstRow = allRows[0];
            const gapValue = parseFloat(getComputedStyle(pinnedList).rowGap || "0");
            if (firstRow) {
              dragOffset = Math.round(firstRow.getBoundingClientRect().height + gapValue);
            }
            allRows.forEach(r => {
              r.style.position = "relative";
              r.style.transition = "transform 0.2s cubic-bezier(0.4,0,0.2,1)";
            });
          });
          
          row.addEventListener("dragend", () => {
            row.classList.remove("sprout-deck-row-dragging");
            row.style.zIndex = "";
            draggedOverIndex = null;
            // Clear any transforms and reset position
            const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
            allRows.forEach(r => {
              r.style.transform = "";
              r.style.position = "";
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
                  r.style.transform = `translateY(${(i - fromIndex) * dragOffset}px)`;
                  r.style.zIndex = "10";
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
                  r.style.transform = offset !== 0 ? `translateY(${offset}px)` : "";
                  r.style.zIndex = "";
                }
              });
            }
          });
          
          row.addEventListener("drop", async (e) => {
            e.preventDefault();
            const fromIndex = Number(e.dataTransfer?.getData("text/plain") || "-1");
            if (fromIndex === -1 || fromIndex === i) return;
            // Clear transforms before re-rendering
            const allRows = pinnedList.querySelectorAll<HTMLElement>(".sprout-deck-row");
            allRows.forEach(r => r.style.transform = "");
            const item = currentPinned[fromIndex];
            currentPinned.splice(fromIndex, 1);
            currentPinned.splice(i, 0, item);
            await savePinnedDecks(currentPinned);
            renderPinnedDecks();
          });
        } else if (i === currentPinned.length && currentPinned.length < MAX_PINNED) {
          // Render search input in the first empty slot
          const searchRow = pinnedList.createDiv({ cls: "relative" });
          searchInputEl = searchRow.createEl("input", { 
            cls: "sprout-deck-search-input w-full text-sm text-center text-muted-foreground", 
              attr: { type: "text", placeholder: "Search to add a pinned deck" }
          });
          
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
          dropdownEl.style.background = "var(--sprout-deck-dropdown-bg)";
          
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
        
        const label = item.createDiv({ cls: "sprout-text-truncate-rtl truncate flex-1" });
        const pinnedLabel = formatPinnedDeckLabel(deck);
        label.textContent = pinnedLabel;
        label.setAttr("title", pinnedLabel);
        
        item.addEventListener("mousedown", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          currentPinned.push(deck);
          await savePinnedDecks(currentPinned);
          deckSearchQuery = "";
          if (searchInputEl) searchInputEl.value = "";
          searchDropdownOpen = false;
          renderPinnedDecks();
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

    const bottomRow = document.createElement("div");
    bottomRow.className = "sprout-ana-grid grid grid-cols-1 lg:grid-cols-2 gap-4";
    body.appendChild(bottomRow);

    if (!hideSproutInfo) {
      const infoCard = document.createElement("div");
      infoCard.className = "card sprout-ana-card p-4 flex flex-col gap-6";
      bottomRow.appendChild(infoCard);
      const aboutHeader = infoCard.createDiv({ cls: "flex items-center justify-between gap-2" });
      aboutHeader.createDiv({ cls: "font-semibold", text: "About Sprout" });
      const aboutIcon = document.createElement("span");
      aboutIcon.className = "inline-flex items-center justify-center text-muted-foreground [&_svg]:size-4";
      setIcon(aboutIcon, "sprout");
      aboutHeader.appendChild(aboutIcon);
      const aboutText = infoCard.createDiv({ cls: "text-sm text-muted-foreground" });
      aboutText.createSpan({
        text:
          "Sprout minimises friction by keeping flashcards right next to your notes, so the path from learning content to revision is seamless. It keeps card writing human and organisation simple, so you spend less time creating and sorting, and more time studying.",
      });
      aboutText.createEl("br");
      aboutText.createEl("br");
      aboutText.createSpan({ text: "Developed by William Guy (@ctrlaltwill)." });
      const infoLinks = infoCard.createDiv({ cls: "flex flex-col gap-2 text-sm" });
      const infoButtons = infoLinks.createDiv({ cls: "flex flex-wrap items-center gap-2" });
      const starsLink = infoButtons.createEl("a", {
        href: "https://github.com/ctrlaltwill/sprout",
      });
      starsLink.className = "sprout-github-stars";
      starsLink.setAttr("target", "_blank");
      starsLink.setAttr("rel", "noopener");

      const githubIcon = document.createElement("span");
      githubIcon.className = "sprout-github-stars-icon";
      githubIcon.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 2C6.477 2 2 6.484 2 12.019c0 4.423 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.7-2.782.605-3.369-1.344-3.369-1.344-.454-1.158-1.109-1.467-1.109-1.467-.907-.62.069-.608.069-.608 1.003.07 1.53 1.035 1.53 1.035.892 1.53 2.341 1.088 2.91.833.091-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.094.39-1.989 1.029-2.69-.103-.254-.446-1.27.098-2.647 0 0 .84-.27 2.75 1.026A9.566 9.566 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.026 2.748-1.026.546 1.377.203 2.393.1 2.647.64.701 1.028 1.596 1.028 2.69 0 3.848-2.338 4.695-4.566 4.943.359.31.679.92.679 1.856 0 1.34-.012 2.419-.012 2.748 0 .268.18.58.688.481A10.019 10.019 0 0 0 22 12.02C22 6.484 17.523 2 12 2z"/></svg>';

      const starsLabel = document.createElement("span");
      starsLabel.textContent = "GitHub Stars";

      const starIcon = document.createElement("span");
      starIcon.className = "sprout-github-stars-star";
      // Set star color based on theme
      function setStarIconColor() {
        const isDark = document.body.classList.contains("theme-dark");
        const fill = isDark ? "#fff" : "#f4b400";
        starIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="${fill}" d="m12 3 2.84 5.75 6.35.92-4.6 4.48 1.08 6.33L12 17.77 6.33 20.48l1.08-6.33-4.6-4.48 6.35-.92L12 3z"/></svg>`;
      }
      setStarIconColor();
      // Listen for theme changes
      const observer = new MutationObserver(setStarIconColor);
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      // Add smooth transition for spin
      starIcon.style.transition = "transform 0.3s cubic-bezier(.4,2,.6,1)";
      let spinning = false;
      starsLink.addEventListener("click", (e) => {
        if (spinning) return;
        spinning = true;
        // Spin backwards (opposite direction), twice as fast
        starIcon.style.transition = "transform 0.15s cubic-bezier(.4,2,.6,1)";
        starIcon.style.transform = "rotate(-360deg)";
        setTimeout(() => {
          starIcon.style.transition = "transform 0.3s cubic-bezier(.4,2,.6,1)";
          starIcon.style.transform = "rotate(0deg)";
          spinning = false;
        }, 150);
      });

      starsLink.appendChild(githubIcon);
      starsLink.appendChild(starsLabel);
      starsLink.appendChild(starIcon);
      if (Number.isFinite(starCount)) {
        const starsValue = document.createElement("span");
        starsValue.className = "sprout-github-stars-value";
        starsValue.textContent = starCount.toLocaleString();
        starsLink.appendChild(starsValue);
      }
      const bmcLink = infoButtons.createEl("a", {
        href: "https://buymeacoffee.com/williamguy",
      });
      bmcLink.className = "sprout-bmc";
      bmcLink.setAttr("target", "_blank");
      bmcLink.setAttr("rel", "noopener");
      const bmcIcon = document.createElement("span");
      bmcIcon.className = "sprout-bmc-icon";
      setIcon(bmcIcon, "coffee");
      // Force the coffee SVG color to #111
      const coffeeSvg = bmcIcon.querySelector("svg");
      if (coffeeSvg) {
        coffeeSvg.setAttribute("fill", "#111");
        // Also set path fill if needed
        const coffeePath = coffeeSvg.querySelector("path");
        if (coffeePath) coffeePath.setAttribute("fill", "#111");
      }
      // Add smooth transition for rotation
      bmcIcon.style.transition = "transform 0.4s cubic-bezier(.4,2,.6,1)";
      let bmcTipped = false;
      bmcLink.addEventListener("click", (e) => {
        if (!bmcTipped) {
          bmcTipped = true;
          bmcIcon.style.transform = "rotate(-60deg)";
          setTimeout(() => {
            bmcIcon.style.transform = "rotate(-30deg)";
            setTimeout(() => {
              bmcIcon.style.transform = "rotate(0deg)";
              bmcTipped = false;
            }, 400);
          }, 400);
        }
      });
      const bmcText = document.createElement("span");
      bmcText.textContent = "Buy me a coffee";
      bmcLink.appendChild(bmcIcon);
      bmcLink.appendChild(bmcText);
      const credits = infoLinks.createDiv({ cls: "text-muted-foreground", text: "" });
      credits.classList.add("bc");
    }


   if (!hideSproutInfo) {
     const placeholderCard = document.createElement("div")
     placeholderCard.className = "card sprout-ana-card p-4 flex flex-col gap-6"
     bottomRow.appendChild(placeholderCard)

     const changelogHeader = placeholderCard.createDiv({ cls: "flex items-center justify-between gap-2" })
     changelogHeader.createDiv({ cls: "font-semibold", text: "Changelog" })

     const changelogIcon = document.createElement("span")
     changelogIcon.className = "inline-flex items-center justify-center text-muted-foreground [&_svg]:size-4"
     setIcon(changelogIcon, "code")
     changelogHeader.appendChild(changelogIcon)

     const changelogBody = placeholderCard.createDiv({
       cls: "sprout-changelog-scroll text-sm overflow-y-scroll overflow-x-hidden",
     })

     const changelogTable = changelogBody.createEl("table", {
       cls: "table w-full text-sm sprout-changelog-table",
     })

     const thead = changelogTable.createEl("thead")
     const headRow = thead.createEl("tr", { cls: "text-left border-b border-border" })
     headRow.createEl("th", {
       cls: "font-medium sprout-changelog-cell",
       text: "Version"
     })
     headRow.createEl("th", {
       cls: "font-medium sprout-changelog-cell",
       text: "Summary"
     })

     const tbody = changelogTable.createEl("tbody")

     const addRow = (version: string, summary: string) => {
       const tr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 last:border-0" })
       tr.createEl("td", {
         cls: "sprout-changelog-cell",
         text: version
       })
       tr.createEl("td", {
         cls: "sprout-changelog-cell",
         text: summary
       })
     }

    addRow("0.04", "Added dark theme, updated the widget, added the forgetting curve, and added backups for scheduling data.")
    addRow("0.03", "Rebranded as Sprout, with image occlusion, flashcard browser and analytics introduced.")
    addRow("0.02", "Rapid hotfix cycle focused on deck and session stability.")
    addRow("0.01", "Initial release as Boot Camp for public testing.")
   }

    // Refresh AOS for any animated elements
    // Use double requestAnimationFrame to ensure DOM is fully rendered
    if (animationsEnabled) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          refreshAOS();
        });
      });
    }
  }
}
