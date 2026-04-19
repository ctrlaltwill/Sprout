/**
 * @file src/analytics/analytics-view.ts
 * @summary Obsidian ItemView subclass that powers the "Analytics" tab. It
 * aggregates card states, review logs, and analytics events from the plugin
 * store, computes KPI statistics (streaks, daily cards, daily time, trends),
 * and renders a full-page dashboard composed of React-based chart components
 * (heatmap, pie charts, future-due forecast, new-cards bar chart, stacked
 * answer-buttons chart, stability distribution, and forgetting curves). Also
 * manages AOS scroll animations and wide-mode layout toggling.
 *
 * @exports
 *   - SproutAnalyticsView — Obsidian ItemView class implementing the analytics dashboard
 */

import { ItemView, type WorkspaceLeaf, setIcon } from "obsidian";
import * as React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { initAOS, resetAOS } from "../../platform/core/aos-loader";
import { type SproutHeader, createViewHeader } from "../../platform/core/header";
import { log } from "../../platform/core/logger";
import type { CardState, ReviewLogEntry } from "../../platform/core/store";
import { AOS_DURATION, MAX_CONTENT_WIDTH_PX, MS_DAY, VIEW_TYPE_ANALYTICS } from "../../platform/core/constants";
import { placePopover, queryFirst, setCssProps } from "../../platform/core/ui";
import { createTitleStripFrame } from "../../platform/core/view-primitives";
import { SPROUT_HOME_CONTENT_SHELL_CLASS } from "../../platform/core/ui-classes";
import type LearnKitPlugin from "../../main";
import { isParentCard } from "../../platform/core/card-utils";
import { StagePieCard } from "./charts/pie-charts";
import { FutureDueChart } from "./charts/future-due-chart";
import { NewCardsPerDayChart } from "./charts/new-cards-per-day-chart";
import { StackedReviewButtonsChart } from "./charts/stacked-review-buttons-chart";
import { ReviewCalendarHeatmap } from "./charts/review-calendar-heatmap";
import { StabilityDistributionChart } from "./charts/stability-distribution-chart";
import { ForgettingCurveChart } from "./charts/forgetting-curve-chart";
import { ChartErrorBoundary } from "./error-boundary";
import { TestsAnalyticsCard } from "./cards/tests-analytics-card";
import { NoteReviewAnalyticsCard } from "./cards/note-review-analytics-card";
import { t } from "../../platform/translations/translator";
import { ExamTestsSqlite, type SavedExamAttemptRecord } from "../../platform/core/exam-tests-sqlite";
import { NoteReviewSqlite } from "../../platform/core/note-review-sqlite";

/**
 * IMPORTANT:
 * - Add `bc` to every element you want Basecoat (and scoped utilities) to style.
 * - Your PostCSS scoper produces selectors like `.learnkit-btn-toolbar.bc`, `.flex.bc`, `table.bc`, etc.
 */

function localDayIndex(ts: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}

export class SproutAnalyticsView extends ItemView {
  plugin: LearnKitPlugin;

  private _activeSection: "flashcards" | "notes" | "tests" = "flashcards";

  private _header: SproutHeader | null = null;
  private _rootEl: HTMLElement | null = null;
  // Removed: now uses plugin.isWideMode
  private _heatmapRoot: ReactRoot | null = null;
  private _stagePieRoot: ReactRoot | null = null;
  private _answerPieRoot: ReactRoot | null = null;
  private _futureDueRoot: ReactRoot | null = null;
  private _newCardsRoot: ReactRoot | null = null;
  private _stackedButtonsRoot: ReactRoot | null = null;
  private _stabilityDistributionRoot: ReactRoot | null = null;
  private _forgettingCurveRoot: ReactRoot | null = null;
  private _testsAnalyticsRoot: ReactRoot | null = null;
  private _noteReviewAnalyticsRoot: ReactRoot | null = null;
  private _examAttemptsCache: SavedExamAttemptRecord[] = [];
  private _examAttemptsHydrated = false;
  private _hasPlayedEntryAnimation = false;

  constructor(leaf: WorkspaceLeaf, plugin: LearnKitPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_ANALYTICS;
  }

  getDisplayText() {
    return t(this.plugin.settings?.general?.interfaceLanguage, "ui.view.analytics.title", "Analytics");
  }

  getIcon() {
    return "chart-spline";
  }

  async onOpen() {
    this.render();
    void this._hydrateExamAttempts();
    // Initialize AOS immediately; delayed init causes a visible snap when
    // classes/measurements are applied after first paint.
    if (this.plugin.settings?.general?.enableAnimations ?? true) {
      initAOS({
        duration: AOS_DURATION,
        easing: "ease-out",
        once: true,
        offset: 50,
      });
    }
    await Promise.resolve();
  }

  async onClose() {
    try {
      this._header?.dispose?.();
    } catch (e: unknown) { log.swallow("dispose header", e); }
    this._header = null;
    try {
      this._heatmapRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount heatmap root", e); }
    this._heatmapRoot = null;
    try {
      this._stagePieRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount stage pie root", e); }
    this._stagePieRoot = null;
    try {
      this._answerPieRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount answer pie root", e); }
    this._answerPieRoot = null;
    try {
      this._futureDueRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount future due root", e); }
    this._futureDueRoot = null;
    try {
      this._newCardsRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount new cards root", e); }
    this._newCardsRoot = null;
    try {
      this._stackedButtonsRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount stacked buttons root", e); }
    this._stackedButtonsRoot = null;
    try {
      this._stabilityDistributionRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount stability distribution root", e); }
    this._stabilityDistributionRoot = null;
    try {
      this._forgettingCurveRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount forgetting curve root", e); }
    this._forgettingCurveRoot = null;
    try {
      this._testsAnalyticsRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount tests analytics root", e); }
    this._testsAnalyticsRoot = null;
    try {
      this._noteReviewAnalyticsRoot?.unmount();
    } catch (e: unknown) { log.swallow("unmount note-review analytics root", e); }
    this._noteReviewAnalyticsRoot = null;
    this._hasPlayedEntryAnimation = false;
    resetAOS();
    await Promise.resolve();
  }

  onRefresh() {
    this.render();
    void this._hydrateExamAttempts();
  }

  private async _hydrateExamAttempts(): Promise<void> {
    try {
      const db = new ExamTestsSqlite(this.plugin);
      await db.open();
      const nextAttempts = db.listAttempts(2000);
      await db.close();
      const hadHydrated = this._examAttemptsHydrated;
      const prevCount = this._examAttemptsCache.length;
      this._examAttemptsCache = nextAttempts;
      this._examAttemptsHydrated = true;

      // Avoid re-rendering flashcards/notes immediately after open just because
      // test attempts finished loading; that second render can visually look
      // like an animation "snap" in KPI cards.
      const attemptsChanged = !hadHydrated || prevCount !== nextAttempts.length;
      if (attemptsChanged && this._activeSection === "tests") {
        this.render();
      }
    } catch (e: unknown) {
      log.swallow("hydrate exam attempts", e);
    }
  }

  private _applyWidthMode() {
    if (this.plugin.isWideMode) this.containerEl.setAttribute("data-learnkit-wide", "1");
    else this.containerEl.removeAttribute("data-learnkit-wide");

    const root = this._rootEl;
    if (!root) return;

    const maxWidth = this.plugin.isWideMode ? "100%" : MAX_CONTENT_WIDTH_PX;
    setCssProps(root, "--lk-home-max-width", maxWidth);
    setCssProps(root, "--learnkit-analytics-max-width", maxWidth);
  }

  private _setActiveSection(section: "flashcards" | "notes" | "tests") {
    if (this._activeSection === section) return;
    this._activeSection = section;
    this.render();
  }

  private _isSectionVisible(section: "flashcards" | "notes" | "tests") {
    return this._activeSection === section;
  }

  render() {
    const root = this.contentEl;
    root.empty();

    if (this._heatmapRoot) {
      try {
        this._heatmapRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount heatmap root", e); }
      this._heatmapRoot = null;
    }
    if (this._stagePieRoot) {
      try {
        this._stagePieRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount stage pie root", e); }
      this._stagePieRoot = null;
    }
    if (this._answerPieRoot) {
      try {
        this._answerPieRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount answer pie root", e); }
      this._answerPieRoot = null;
    }
    if (this._futureDueRoot) {
      try {
        this._futureDueRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount future due root", e); }
      this._futureDueRoot = null;
    }
    if (this._newCardsRoot) {
      try {
        this._newCardsRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount new cards root", e); }
      this._newCardsRoot = null;
    }
    if (this._stackedButtonsRoot) {
      try {
        this._stackedButtonsRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount stacked buttons root", e); }
      this._stackedButtonsRoot = null;
    }
    if (this._stabilityDistributionRoot) {
      try {
        this._stabilityDistributionRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount stability distribution root", e); }
      this._stabilityDistributionRoot = null;
    }
    if (this._forgettingCurveRoot) {
      try {
        this._forgettingCurveRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount forgetting curve root", e); }
      this._forgettingCurveRoot = null;
    }
    if (this._testsAnalyticsRoot) {
      try {
        this._testsAnalyticsRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount tests analytics root", e); }
      this._testsAnalyticsRoot = null;
    }
    if (this._noteReviewAnalyticsRoot) {
      try {
        this._noteReviewAnalyticsRoot.unmount();
      } catch (e: unknown) { log.swallow("unmount note-review analytics root", e); }
      this._noteReviewAnalyticsRoot = null;
    }
    this._rootEl = root;

    root.classList.add("learnkit-view-content", "learnkit-view-content",
      "learnkit-analytics-root", "learnkit-analytics-root",
      "w-full",
    );

    this.containerEl.addClass("learnkit");
    const tx = (token: string, fallback: string, vars?: Record<string, string | number>) =>
      t(this.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);
    this.setTitle?.(tx("ui.view.analytics.title", "Analytics"));

    if (!this._header) {
      this._header = createViewHeader({
        view: this,
        plugin: this.plugin,
        onToggleWide: () => this._applyWidthMode(),
      });
    }

    this._header.install("analytics");
    this._applyWidthMode();

    const animationsEnabled = this.plugin.settings?.general?.enableAnimations ?? true;
    const shouldAnimateEntry = animationsEnabled && !this._hasPlayedEntryAnimation;
    // AOS delay cascade: header.ts (external), then page title, then top 4 stat cards, then each row below that
    const headerDelay = 0; // header.ts is external, assumed to be 0
    const titleDelay = headerDelay + 100;
    const kpiBaseDelay = titleDelay + 100;
    const kpiStep = 100;
    const heatmapDelay = kpiBaseDelay + kpiStep * 4;
    const heroRowDelay = heatmapDelay + 100;
    const graphsGridDelay = heroRowDelay + 200;
    const stabilityRowDelay = graphsGridDelay + 200;
    const statsTitleDelay = stabilityRowDelay + 200;
    const statsCardDelay = statsTitleDelay + 50;
    const rowBaseDelay = statsCardDelay + 50;
    const rowStep = 50;

    const applyAos = (_el: HTMLElement, _delay?: number, _animation = "fade-up") => {
      // Analytics uses a strict two-step AOS sequence: title strip then content shell.
      // Keep this helper as a no-op to avoid nested section/row animations.
      return;
    };
    const applyRootAos = (el: HTMLElement, delay?: number, animation = "fade-up") => {
      if (!shouldAnimateEntry) return;
      // Pre-seed AOS init state before first paint so elements do not flash at
      // final position and then snap to their animated start state.
      el.classList.remove("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
      el.classList.add("aos-init");
      el.setAttribute("data-aos", animation);
      el.setAttribute("data-aos-anchor-placement", "top-top");
      el.setAttribute("data-aos-duration", String(AOS_DURATION));
      if (Number.isFinite(delay)) el.setAttribute("data-aos-delay", String(delay));
    };

    const titleFrame = createTitleStripFrame({
      root,
      stripClassName: "lk-home-title-strip learnkit-analytics-title-strip",
      rowClassName: "learnkit-analytics-title-row flex items-center justify-between gap-2.5 max-md:flex-col max-md:items-center",
      leftClassName: "learnkit-analytics-title-copy flex min-w-0 flex-col gap-1 max-md:items-center max-md:text-center",
      prepend: false,
    });
    const { strip: titleStrip, right: titleRight, title, subtitle } = titleFrame;
    title.textContent = tx("ui.view.analytics.title", "Analytics");
    subtitle.className = "text-[0.95rem] leading-[1.35] text-muted-foreground";
    subtitle.textContent = tx(
      "ui.analytics.header.subtitle",
      "See trends, forecast due cards, and tune your study plan.",
    );

    const filtersWrap = document.createElement("div");
    filtersWrap.className = "flex flex-wrap items-center gap-2 ml-auto max-md:ml-0 learnkit-analytics-filter-buttons";

    const mkFilterBtn = (
      section: "flashcards" | "notes" | "tests",
      label: string,
      iconName: string,
    ) => {
      const active = this._isSectionVisible(section);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "learnkit-btn-toolbar inline-flex items-center gap-2 h-8 px-3 text-sm learnkit-analytics-filter-btn";
      btn.classList.toggle("is-active", active);
      btn.classList.toggle("learnkit-btn-outline-muted", !active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.setAttribute("data-tooltip-position", "top");

      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center [&_svg]:size-3.5 learnkit-analytics-filter-icon";
      setIcon(icon, iconName);
      btn.appendChild(icon);

      const text = document.createElement("span");
      text.className = "learnkit-analytics-filter-text";
      text.textContent = label;
      btn.appendChild(text);

      btn.addEventListener("click", () => this._setActiveSection(section));
      return btn;
    };

    filtersWrap.appendChild(mkFilterBtn("flashcards", tx("ui.analytics.filter.flashcards", "Flashcards"), "star"));
    filtersWrap.appendChild(mkFilterBtn("notes", tx("ui.analytics.filter.notes", "Notes"), "notebook-text"));
    filtersWrap.appendChild(mkFilterBtn("tests", tx("ui.analytics.filter.tests", "Tests"), "clipboard-check"));
    titleRight.appendChild(filtersWrap);

    const contentShell = document.createElement("div");
    contentShell.className = `${SPROUT_HOME_CONTENT_SHELL_CLASS} learnkit-analytics-content-shell`;
    root.appendChild(contentShell);

    applyRootAos(titleStrip, 0);
    applyRootAos(contentShell, titleDelay);

    const body = document.createElement("div");
    body.className = "w-full space-y-4";
    contentShell.appendChild(body);

    const now = Date.now();
    const events = this.plugin.store.getAnalyticsEvents?.() ?? [];
    const allCards = this.plugin.store.getAllCards?.() ?? [];
    const cards = allCards.filter(c => !isParentCard(c));
    const parentIds = new Set(allCards.filter(c => isParentCard(c)).map(c => String(c.id)));
    const states = this.plugin.store.data.states ?? {};
    const reviewLog = this.plugin.store.data.reviewLog ?? [];

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const dayMap = new Map<number, { count: number; totalMs: number }>();
    const dueByDay = new Map<number, number>();

    for (const ev of events) {
      if (!ev || ev.kind !== "review") continue;
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const idx = localDayIndex(at, timezone);
      const entry = dayMap.get(idx) ?? { count: 0, totalMs: 0 };
      entry.count += 1;
      const ms = Number(ev.msToAnswer);
      if (Number.isFinite(ms) && ms > 0) entry.totalMs += ms;
      dayMap.set(idx, entry);
    }

    for (const [stId, st] of Object.entries(states || {})) {
      if (!st || typeof st !== "object") continue;
      if (parentIds.has(stId)) continue;
      if (st.stage === "suspended") continue;
      const due = Number(st.due);
      if (!Number.isFinite(due) || due <= 0) continue;
      const idx = localDayIndex(due, timezone);
      dueByDay.set(idx, (dueByDay.get(idx) ?? 0) + 1);
    }

    const todayIndex = localDayIndex(now, timezone);
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

    // Calculate previous 7 days for trend comparison
    let prevReviews7d = 0;
    let prevTime7d = 0;
    let prevActiveDaysReviews = 0;
    let prevActiveDaysTime = 0;

    for (let i = 0; i < daysRange; i += 1) {
      const idx = todayIndex - daysRange - i;
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

    let currentStreak = 0;
    let cursor = todayIndex;
    while (dayMap.get(cursor)?.count) {
      currentStreak += 1;
      cursor -= 1;
    }

    let longestStreak = 0;
    const sortedDays = Array.from(dayMap.keys())
      .filter((k) => (dayMap.get(k)?.count ?? 0) > 0)
      .sort((a, b) => a - b);
    let run = 0;
    let prev = Number.NaN;

    for (const d of sortedDays) {
      if (!Number.isFinite(prev) || d === prev + 1) run += 1;
      else run = 1;
      if (run > longestStreak) longestStreak = run;
      prev = d;
    }

    const streakMatches = currentStreak > 0 && currentStreak === longestStreak;
    const streakMessages = [
      tx("ui.analytics.note.streakRecordBooks", "One for the record books!"),
      tx("ui.analytics.note.streakRollin", "Keep the streak rollin!"),
      tx("ui.analytics.note.streakDontBreak", "Don't break the chain!"),
      tx("ui.analytics.note.streakOnFire", "You're on fire!"),
    ];
    const streakNote = streakMatches
      ? streakMessages[Math.floor(Math.random() * streakMessages.length)]
      : tx("ui.analytics.badge.allTime", "All time");

    const showFlashcards = this._isSectionVisible("flashcards");
    const showTests = this._isSectionVisible("tests");
    const showNotes = this._isSectionVisible("notes");

    if (showFlashcards) {
      this._renderKpiCards(body, applyAos, kpiBaseDelay, kpiStep,
        currentStreak, longestStreak,
        avgCardsPerDay, avgTimePerDayMinutes,
        prevAvgCardsPerDay, prevAvgTimePerDayMinutes,
        prevActiveDaysReviews, prevActiveDaysTime,
        streakMatches, streakNote, todayIndex, dayMap,
        tx,
      );
    }

    if (showTests) {
      this._renderTestKpiCards(body, events, timezone, todayIndex, tx);
    }

    if (showNotes) {
      void this._renderNoteKpiCards(body, events, timezone, todayIndex, tx);
    }

    this._renderCharts(body, applyAos, animationsEnabled,
      heatmapDelay, heroRowDelay, graphsGridDelay, stabilityRowDelay,
      events, cards, states, reviewLog, timezone, todayIndex, now, dayMap, dueByDay, parentIds,
      showFlashcards, showTests, showNotes,
      tx,
    );

    if (showFlashcards) {
      this._renderStatsTable(body, applyAos, animationsEnabled,
        statsCardDelay, rowBaseDelay, rowStep,
        events, reviewLog, timezone, todayIndex, dayMap, dueByDay, parentIds,
        tx,
      );
    }

    if (shouldAnimateEntry) {
      titleStrip.classList.remove("aos-animate");
      contentShell.classList.remove("aos-animate");
      window.requestAnimationFrame(() => {
        if (!titleStrip.isConnected || !contentShell.isConnected) return;
        titleStrip.classList.add("aos-animate");
        contentShell.classList.add("aos-animate");
      });
      this._hasPlayedEntryAnimation = true;
    } else {
      for (const el of [titleStrip, contentShell]) {
        el.removeAttribute("data-aos");
        el.removeAttribute("data-aos-anchor-placement");
        el.removeAttribute("data-aos-duration");
        el.removeAttribute("data-aos-delay");
        el.classList.add("aos-animate", "learnkit-aos-fallback", "learnkit-aos-fallback");
      }
    }
  }

  private _renderKpiCards(
    body: HTMLElement,
    applyAos: (el: HTMLElement, delay?: number, animation?: string) => void,
    kpiBaseDelay: number,
    kpiStep: number,
    currentStreak: number,
    longestStreak: number,
    avgCardsPerDay: number,
    avgTimePerDayMinutes: number,
    prevAvgCardsPerDay: number,
    prevAvgTimePerDayMinutes: number,
    prevActiveDaysReviews: number,
    prevActiveDaysTime: number,
    streakMatches: boolean,
    streakNote: string,
    todayIndex: number,
    dayMap: Map<number, { count: number; totalMs: number }>,
    tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string,
  ): void {
    const kpiRow = document.createElement("div");
    kpiRow.className = "learnkit-ana-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4";
    body.appendChild(kpiRow);

    const makeBadge = (opts: { text: string; bg?: string; color?: string; border?: string; live?: boolean; className?: string }) => {
      const badge = document.createElement("span");
      badge.className = `learnkit-badge learnkit-analytics-badge inline-flex items-center gap-1${opts.className ? ` ${opts.className}` : ""}`;
      if (opts.bg) setCssProps(badge, "--learnkit-badge-bg", opts.bg);
      else if (!opts.className) setCssProps(badge, "--learnkit-badge-bg", "var(--theme-accent)");
      if (opts.color) setCssProps(badge, "--learnkit-badge-color", opts.color);
      if (opts.border) setCssProps(badge, "--learnkit-badge-border", opts.border);
      if (opts.live) {
        const circle = document.createElement("span");
        circle.className = "inline-block w-1.5 h-1.5 rounded-full bg-white learnkit-analytics-live-pulse";
        badge.appendChild(circle);
      }
      badge.appendChild(document.createTextNode(opts.text));
      return badge;
    };

    const formatTrend = (current: number, previous: number, previousDaysWithData: number) => {
      if (previousDaysWithData <= 0 || previous <= 0) return { value: 0, text: "0%", dir: 0 };
      const raw = ((current - previous) / previous) * 100;
      const capped = Math.min(Math.max(raw, -1000), 1000);
      const dir = capped > 0 ? 1 : capped < 0 ? -1 : 0;
      return { value: capped, text: `${capped > 0 ? "+" : ""}${capped.toFixed(0)}%`, dir };
    };

    const buildTrendBadge = (trend: { value: number; text: string; dir: number }) => {
      const badge = document.createElement("span");
      badge.className = "learnkit-trend-badge learnkit-analytics-rotatable";

      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center";
      const iconName = trend.dir > 0 ? "trending-up" : trend.dir < 0 ? "trending-down" : "minus";
      setIcon(icon, iconName);
      const svg = queryFirst(icon, "svg");
      if (svg) {
        (svg as SVGElement).setAttribute("stroke", "currentColor");
      }
      badge.appendChild(icon);

      const valueEl = document.createElement("span");
      valueEl.textContent = trend.dir === 0 ? "0%" : `${trend.dir > 0 ? "+" : ""}0%`;
      badge.appendChild(valueEl);

      // Animate count-up value only (no badge rotation)
      const durationMs = 800;
      const start = performance.now();
      const target = trend.value;

      const animate = (t: number) => {
        const elapsed = t - start;
        const p = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOut
        const currentVal = (trend.dir === 0 ? 0 : eased * Math.abs(target)) * (trend.dir >= 0 ? 1 : -1);
        valueEl.textContent = `${currentVal >= 0 ? "+" : ""}${currentVal.toFixed(0)}%`;
        if (p < 1) requestAnimationFrame(animate);
        else valueEl.textContent = trend.text;
      };

      requestAnimationFrame(animate);
      return badge;
    };

    const makeCard = (title: string, value: string, badge: HTMLElement | null, note: string) => {
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card small-card flex flex-col gap-2";
      // Find which card this is (order: longest, current, daily time, daily cards)
      let cardIndex = kpiRow.childElementCount;
      if (cardIndex > 3) cardIndex = 3; // Only first 4 get delays
      applyAos(card, kpiBaseDelay + cardIndex * kpiStep);
      kpiRow.appendChild(card);

      const top = document.createElement("div");
      top.className = "flex items-center justify-between text-sm text-muted-foreground";
      card.appendChild(top);
      top.appendChild(Object.assign(document.createElement("div"), { textContent: title }));
      if (badge) top.appendChild(badge);

      const big = document.createElement("div");
      big.className = "mt-2 text-2xl font-semibold";
      big.textContent = value;
      card.appendChild(big);

      const sub = document.createElement("div");
      sub.className = "mt-2 text-xs text-muted-foreground text-right";
      sub.textContent = note;
      card.appendChild(sub);
    };

    const longestBadge = streakMatches
      ? makeBadge({ text: tx("ui.analytics.badge.live", "Live"), live: true, className: "learnkit-trend-badge learnkit-live-badge learnkit-live-badge-orange" })
      : (() => {
          const badge = document.createElement("span");
          badge.className = "learnkit-trend-badge inline-flex items-center gap-1 px-2 py-0";
          badge.textContent = tx("ui.analytics.badge.allTime", "All time");
          return badge;
        })();

    makeCard(
      tx("ui.analytics.card.longestStreak", "Longest streak"),
      tx("ui.analytics.card.daysSuffix", "{count} day{suffix}", { count: longestStreak, suffix: longestStreak === 1 ? "" : "s" }),
      longestBadge,
      streakNote,
    );

    const includesToday = (dayMap.get(todayIndex)?.count ?? 0) > 0;
    const currentBadge = includesToday
      ? makeBadge({ text: tx("ui.analytics.badge.live", "Live"), live: true, className: "learnkit-trend-badge learnkit-live-badge learnkit-live-badge-dark" })
      : null;
    const currentNote =
      currentStreak > 0
        ? (streakMatches
            ? tx("ui.analytics.note.longestActive", "Longest streak active")
            : includesToday
              ? tx("ui.analytics.note.keepGoing", "Keep it going!")
              : tx("ui.analytics.note.streakActive", "Streak active."))
        : tx("ui.analytics.note.noReviews", "No reviews yet");

    makeCard(
      tx("ui.analytics.card.currentStreak", "Current streak"),
      tx("ui.analytics.card.daysSuffix", "{count} day{suffix}", { count: currentStreak, suffix: currentStreak === 1 ? "" : "s" }),
      currentBadge,
      currentNote,
    );

    const timeBadge = buildTrendBadge(formatTrend(avgTimePerDayMinutes, prevAvgTimePerDayMinutes, prevActiveDaysTime));
    const dailyTimeValue = (() => {
      const minutes = Math.max(0, Math.ceil(avgTimePerDayMinutes));
      if (minutes < 60) return `${minutes} min`;
      const hours = minutes / 60;
      const roundedHours = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
      return `${roundedHours} ${roundedHours === 1 ? "hour" : "hours"}`;
    })();
    makeCard(
      tx("ui.analytics.card.dailyTime", "Daily time"),
      dailyTimeValue,
      timeBadge,
      tx("ui.analytics.note.last7Days", "Last 7 days"),
    );

    const cardsBadge = buildTrendBadge(formatTrend(avgCardsPerDay, prevAvgCardsPerDay, prevActiveDaysReviews));
    makeCard(
      tx("ui.analytics.card.dailyCards", "Daily cards"),
      `${Math.round(avgCardsPerDay)}`,
      cardsBadge,
      tx("ui.analytics.note.last7Days", "Last 7 days"),
    );
  }

  private _renderTestKpiCards(
    body: HTMLElement,
    events: ReturnType<NonNullable<typeof this.plugin.store.getAnalyticsEvents>>,
    timezone: string,
    todayIndex: number,
    tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string,
  ): void {
    const kpiRow = document.createElement("div");
    kpiRow.className = "learnkit-ana-grid grid grid-cols-1 md:grid-cols-3 gap-4";
    body.appendChild(kpiRow);

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const dayIdx = (ts: number): number => {
      const parts = formatter.formatToParts(new Date(ts));
      const m = new Map(parts.map(p => [p.type, p.value]));
      return Math.floor(Date.UTC(Number(m.get("year")), Number(m.get("month")) - 1, Number(m.get("day"))) / MS_DAY);
    };

    const seen = new Set<string>();
    const attempts: Array<{ at: number; score: number }> = [];
    for (const ev of events) {
      if (!ev || ev.kind !== "exam-attempt") continue;
      const at = Number(ev.at);
      const score = Number(ev.finalPercent);
      if (!Number.isFinite(at) || !Number.isFinite(score)) continue;
      const id = String(ev.attemptId || `${ev.testId || "test"}-${at}-${score.toFixed(2)}`);
      if (seen.has(id)) continue;
      seen.add(id);
      attempts.push({ at, score: Math.max(0, Math.min(100, score)) });
    }
    for (const row of (this._examAttemptsHydrated ? this._examAttemptsCache : [])) {
      const at = Number(row.createdAt);
      const score = Number(row.finalPercent);
      if (!Number.isFinite(at) || !Number.isFinite(score)) continue;
      const id = String(row.attemptId || `${row.testId}-${at}-${score.toFixed(2)}`);
      if (seen.has(id)) continue;
      seen.add(id);
      attempts.push({ at, score: Math.max(0, Math.min(100, score)) });
    }

    let attempts7d = 0, scoreSum7d = 0;
    let prevAttempts7d = 0, prevScoreSum7d = 0;
    let lastScore = 0, lastAt = 0;
    for (const a of attempts) {
      const idx = dayIdx(a.at);
      if (idx >= todayIndex - 6 && idx <= todayIndex) {
        attempts7d++;
        scoreSum7d += a.score;
      } else if (idx >= todayIndex - 13 && idx < todayIndex - 6) {
        prevAttempts7d++;
        prevScoreSum7d += a.score;
      }
      if (a.at > lastAt) { lastAt = a.at; lastScore = a.score; }
    }
    const avgScore7d = attempts7d > 0 ? scoreSum7d / attempts7d : 0;
    const prevAvgScore7d = prevAttempts7d > 0 ? prevScoreSum7d / prevAttempts7d : 0;

    const formatTrend = (cur: number, prev: number, hasData: boolean) => {
      if (!hasData || prev <= 0) return { value: 0, text: "0%", dir: 0 };
      const raw = ((cur - prev) / prev) * 100;
      const capped = Math.min(Math.max(raw, -1000), 1000);
      const dir = capped > 0 ? 1 : capped < 0 ? -1 : 0;
      return { value: capped, text: `${capped > 0 ? "+" : ""}${capped.toFixed(0)}%`, dir };
    };

    const buildTrendBadge = (trend: { value: number; text: string; dir: number }) => {
      const badge = document.createElement("span");
      badge.className = "learnkit-trend-badge learnkit-analytics-rotatable";
      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center";
      setIcon(icon, trend.dir > 0 ? "trending-up" : trend.dir < 0 ? "trending-down" : "minus");
      const svg = queryFirst(icon, "svg");
      if (svg) (svg as SVGElement).setAttribute("stroke", "currentColor");
      badge.appendChild(icon);
      const valueEl = document.createElement("span");
      valueEl.textContent = "0%";
      badge.appendChild(valueEl);
      const durationMs = 800;
      const startTime = performance.now();
      const target = trend.value;
      const animate = (t: number) => {
        const elapsed = t - startTime;
        const p = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
        const cur = (trend.dir === 0 ? 0 : eased * Math.abs(target)) * (trend.dir >= 0 ? 1 : -1);
        valueEl.textContent = `${cur >= 0 ? "+" : ""}${cur.toFixed(0)}%`;
        if (p < 1) requestAnimationFrame(animate);
        else valueEl.textContent = trend.text;
      };
      requestAnimationFrame(animate);
      return badge;
    };

    const makeCard = (title: string, value: string, badge: HTMLElement | null, note: string) => {
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card small-card flex flex-col gap-2";
      kpiRow.appendChild(card);
      const top = document.createElement("div");
      top.className = "flex items-center justify-between text-sm text-muted-foreground";
      card.appendChild(top);
      top.appendChild(Object.assign(document.createElement("div"), { textContent: title }));
      if (badge) top.appendChild(badge);
      const big = document.createElement("div");
      big.className = "mt-2 text-2xl font-semibold";
      big.textContent = value;
      card.appendChild(big);
      const sub = document.createElement("div");
      sub.className = "mt-2 text-xs text-muted-foreground text-right";
      sub.textContent = note;
      card.appendChild(sub);
    };

    makeCard(
      tx("ui.analytics.card.testAttempts", "Attempts"),
      `${attempts7d}`,
      buildTrendBadge(formatTrend(attempts7d, prevAttempts7d, prevAttempts7d > 0)),
      tx("ui.analytics.note.last7Days", "Last 7 days"),
    );
    makeCard(
      tx("ui.analytics.card.testAvgScore", "Avg score"),
      attempts7d > 0 ? `${avgScore7d.toFixed(1)}%` : "\u2014",
      buildTrendBadge(formatTrend(avgScore7d, prevAvgScore7d, prevAttempts7d > 0)),
      tx("ui.analytics.note.last7Days", "Last 7 days"),
    );
    makeCard(
      tx("ui.analytics.card.testRecentScore", "Most recent score"),
      lastAt > 0 ? `${lastScore.toFixed(1)}%` : "\u2014",
      null,
      lastAt > 0 ? tx("ui.analytics.note.latestAttempt", "Latest attempt") : tx("ui.analytics.note.noAttemptsYet", "No attempts yet"),
    );
  }

  private async _renderNoteKpiCards(
    body: HTMLElement,
    events: ReturnType<NonNullable<typeof this.plugin.store.getAnalyticsEvents>>,
    timezone: string,
    todayIndex: number,
    tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string,
  ): Promise<void> {
    const kpiRow = document.createElement("div");
    kpiRow.className = "learnkit-ana-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4";
    body.appendChild(kpiRow);

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const dayIdx = (ts: number): number => {
      const parts = formatter.formatToParts(new Date(ts));
      const m = new Map(parts.map(p => [p.type, p.value]));
      return Math.floor(Date.UTC(Number(m.get("year")), Number(m.get("month")) - 1, Number(m.get("day"))) / MS_DAY);
    };

    // Build per-day map of note review activity for streaks and counts
    const noteDayMap = new Map<number, { count: number }>();
    let reviewed7d = 0;
    let prevReviewed7d = 0;
    for (const ev of events) {
      if (!ev || ev.kind !== "note-review") continue;
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const idx = dayIdx(at);
      const action = String(ev.action || "");
      const entry = noteDayMap.get(idx) ?? { count: 0 };
      entry.count += 1;
      noteDayMap.set(idx, entry);
      if (action === "pass" || action === "read") {
        if (idx >= todayIndex - 6 && idx <= todayIndex) reviewed7d++;
        else if (idx >= todayIndex - 13 && idx < todayIndex - 6) prevReviewed7d++;
      }
    }

    // Compute current streak
    let currentStreak = 0;
    let cursor = todayIndex;
    while (noteDayMap.get(cursor)?.count) {
      currentStreak += 1;
      cursor -= 1;
    }

    // Compute longest streak
    let longestStreak = 0;
    const sortedDays = Array.from(noteDayMap.keys())
      .filter((k) => (noteDayMap.get(k)?.count ?? 0) > 0)
      .sort((a, b) => a - b);
    let run = 0;
    let prev = Number.NaN;
    for (const d of sortedDays) {
      if (!Number.isFinite(prev) || d === prev + 1) run += 1;
      else run = 1;
      if (run > longestStreak) longestStreak = run;
      prev = d;
    }

    const streakMatches = currentStreak > 0 && currentStreak === longestStreak;
    const streakMessages = [
      tx("ui.analytics.note.streakRecordBooks", "One for the record books!"),
      tx("ui.analytics.note.streakRollin", "Keep the streak rollin!"),
      tx("ui.analytics.note.streakDontBreak", "Don't break the chain!"),
      tx("ui.analytics.note.streakOnFire", "You're on fire!"),
    ];
    const streakNote = streakMatches
      ? streakMessages[Math.floor(Math.random() * streakMessages.length)]
      : tx("ui.analytics.badge.allTime", "All time");

    // Query note DB for scheduled next 7 days
    let scheduledNext7d = 0;
    try {
      const notesDb = new NoteReviewSqlite(this.plugin);
      await notesDb.open();
      const now = Date.now();
      const in7days = now + 7 * MS_DAY;
      scheduledNext7d = notesDb.countDueInRange(now, in7days);
      await notesDb.close();
    } catch { /* graceful fallback */ }

    const formatTrend = (cur: number, prev: number, hasData: boolean) => {
      if (!hasData || prev <= 0) return { value: 0, text: "0%", dir: 0 };
      const raw = ((cur - prev) / prev) * 100;
      const capped = Math.min(Math.max(raw, -1000), 1000);
      const dir = capped > 0 ? 1 : capped < 0 ? -1 : 0;
      return { value: capped, text: `${capped > 0 ? "+" : ""}${capped.toFixed(0)}%`, dir };
    };

    const buildTrendBadge = (trend: { value: number; text: string; dir: number }) => {
      const badge = document.createElement("span");
      badge.className = "learnkit-trend-badge learnkit-analytics-rotatable";
      const icon = document.createElement("span");
      icon.className = "inline-flex items-center justify-center";
      setIcon(icon, trend.dir > 0 ? "trending-up" : trend.dir < 0 ? "trending-down" : "minus");
      const svg = queryFirst(icon, "svg");
      if (svg) (svg as SVGElement).setAttribute("stroke", "currentColor");
      badge.appendChild(icon);
      const valueEl = document.createElement("span");
      valueEl.textContent = "0%";
      badge.appendChild(valueEl);
      const durationMs = 800;
      const startTime = performance.now();
      const target = trend.value;
      const animate = (t: number) => {
        const elapsed = t - startTime;
        const p = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
        const cur = (trend.dir === 0 ? 0 : eased * Math.abs(target)) * (trend.dir >= 0 ? 1 : -1);
        valueEl.textContent = `${cur >= 0 ? "+" : ""}${cur.toFixed(0)}%`;
        if (p < 1) requestAnimationFrame(animate);
        else valueEl.textContent = trend.text;
      };
      requestAnimationFrame(animate);
      return badge;
    };

    const makeBadge = (opts: { text: string; bg?: string; color?: string; border?: string; live?: boolean; className?: string }) => {
      const badge = document.createElement("span");
      badge.className = `learnkit-badge learnkit-analytics-badge inline-flex items-center gap-1${opts.className ? ` ${opts.className}` : ""}`;
      if (opts.bg) setCssProps(badge, "--learnkit-badge-bg", opts.bg);
      else if (!opts.className) setCssProps(badge, "--learnkit-badge-bg", "var(--theme-accent)");
      if (opts.color) setCssProps(badge, "--learnkit-badge-color", opts.color);
      if (opts.border) setCssProps(badge, "--learnkit-badge-border", opts.border);
      if (opts.live) {
        const circle = document.createElement("span");
        circle.className = "inline-block w-1.5 h-1.5 rounded-full bg-white learnkit-analytics-live-pulse";
        badge.appendChild(circle);
      }
      badge.appendChild(document.createTextNode(opts.text));
      return badge;
    };

    const makeCard = (title: string, value: string, badge: HTMLElement | null, note: string) => {
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card small-card flex flex-col gap-2";
      kpiRow.appendChild(card);
      const top = document.createElement("div");
      top.className = "flex items-center justify-between text-sm text-muted-foreground";
      card.appendChild(top);
      top.appendChild(Object.assign(document.createElement("div"), { textContent: title }));
      if (badge) top.appendChild(badge);
      const big = document.createElement("div");
      big.className = "mt-2 text-2xl font-semibold";
      big.textContent = value;
      card.appendChild(big);
      const sub = document.createElement("div");
      sub.className = "mt-2 text-xs text-muted-foreground text-right";
      sub.textContent = note;
      card.appendChild(sub);
    };

    // Card 1: Longest streak
    const longestBadge = streakMatches
      ? makeBadge({ text: tx("ui.analytics.badge.live", "Live"), live: true, className: "learnkit-trend-badge learnkit-live-badge learnkit-live-badge-orange" })
      : (() => {
          const badge = document.createElement("span");
          badge.className = "learnkit-trend-badge inline-flex items-center gap-1 px-2 py-0";
          badge.textContent = tx("ui.analytics.badge.allTime", "All time");
          return badge;
        })();
    makeCard(
      tx("ui.analytics.card.noteLongestStreak", "Longest streak"),
      tx("ui.analytics.card.daysSuffix", "{count} day{suffix}", { count: longestStreak, suffix: longestStreak === 1 ? "" : "s" }),
      longestBadge,
      streakNote,
    );

    // Card 2: Current streak
    const includesToday = (noteDayMap.get(todayIndex)?.count ?? 0) > 0;
    const currentBadge = includesToday
      ? makeBadge({ text: tx("ui.analytics.badge.live", "Live"), live: true, className: "learnkit-trend-badge learnkit-live-badge learnkit-live-badge-dark" })
      : null;
    const currentNote =
      currentStreak > 0
        ? (streakMatches
            ? tx("ui.analytics.note.longestActive", "Longest streak active")
            : includesToday
              ? tx("ui.analytics.note.keepGoing", "Keep it going!")
              : tx("ui.analytics.note.streakActive", "Streak active."))
        : tx("ui.analytics.note.noReviews", "No reviews yet");
    makeCard(
      tx("ui.analytics.card.noteCurrentStreak", "Current streak"),
      tx("ui.analytics.card.daysSuffix", "{count} day{suffix}", { count: currentStreak, suffix: currentStreak === 1 ? "" : "s" }),
      currentBadge,
      currentNote,
    );

    // Card 3: Notes reviewed
    makeCard(
      tx("ui.analytics.card.noteReviewed", "Notes reviewed"),
      `${reviewed7d}`,
      buildTrendBadge(formatTrend(reviewed7d, prevReviewed7d, prevReviewed7d > 0)),
      tx("ui.analytics.note.last7Days", "Last 7 days"),
    );

    // Card 4: Scheduled next 7 days
    makeCard(
      tx("ui.analytics.card.noteScheduledNext7", "Scheduled next 7 days"),
      `${scheduledNext7d}`,
      null,
      tx("ui.analytics.note.upcoming", "Upcoming"),
    );
  }


  private _renderCharts(
    body: HTMLElement,
    applyAos: (el: HTMLElement, delay?: number, animation?: string) => void,
    animationsEnabled: boolean,
    heatmapDelay: number,
    heroRowDelay: number,
    graphsGridDelay: number,
    stabilityRowDelay: number,
    events: ReturnType<NonNullable<typeof this.plugin.store.getAnalyticsEvents>>,
    cards: ReturnType<NonNullable<typeof this.plugin.store.getAllCards>>,
    states: Record<string, CardState>,
    reviewLog: ReviewLogEntry[],
    timezone: string,
    todayIndex: number,
    now: number,
    dayMap: Map<number, { count: number; totalMs: number }>,
    dueByDay: Map<number, number>,
    parentIds: Set<string>,
    showFlashcards: boolean,
    showTests: boolean,
    showNotes: boolean,
    tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string,
  ): void {
    const renderChartMountFallback = (host: HTMLElement, chartName: string, error: unknown) => {
      log.error(`failed to mount analytics chart (${chartName})`, error);
      host.replaceChildren();
      const card = document.createElement("div");
      card.className = "card learnkit-ana-card p-6 flex flex-col items-center justify-center gap-2 text-center";
      const titleEl = document.createElement("div");
      titleEl.className = "font-semibold lk-home-section-title text-foreground";
      titleEl.textContent = tx("ui.analytics.chart.unavailable", "{chart} unavailable", { chart: chartName });
      const hintEl = document.createElement("div");
      hintEl.className = "text-sm text-muted-foreground";
      hintEl.textContent = tx("ui.analytics.chart.unavailableHint", "Unable to render this chart in this environment.");
      card.appendChild(titleEl);
      card.appendChild(hintEl);
      host.appendChild(card);
    };

    const mountChartRoot = (host: HTMLElement, chartName: string, renderFn: (root: ReactRoot) => void): ReactRoot | null => {
      try {
        const rootNode = createRoot(host);
        renderFn(rootNode);
        return rootNode;
      } catch (error: unknown) {
        renderChartMountFallback(host, chartName, error);
        return null;
      }
    };

    if (showFlashcards) {
      const heroRow = document.createElement("div");
      heroRow.className = "grid grid-cols-1 xl:grid-cols-2 gap-4";
      body.appendChild(heroRow);

      const heatmapHost = document.createElement("div");
      heatmapHost.className = "xl:col-span-2 min-h-[200px]";
      applyAos(heatmapHost, heatmapDelay);
      heroRow.appendChild(heatmapHost);

      const reviewEvents = events.filter((ev) => ev && ev.kind === "review");
      this._heatmapRoot = mountChartRoot(heatmapHost, tx("ui.analytics.chart.reviewHeatmap", "Review Calendar Heatmap"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.reviewHeatmap", "Review Calendar Heatmap") },
            React.createElement(ReviewCalendarHeatmap, {
              revlog: reviewEvents,
              timezone,
              rangeDays: 365,
              filters: {},
            }),
          ),
        );
      });

      const graphsGrid = document.createElement("div");
      graphsGrid.className = "grid grid-cols-1 auto-rows-fr gap-4 lg:grid-cols-2";
      applyAos(graphsGrid, graphsGridDelay);
      body.appendChild(graphsGrid);

      const stagePieHost = document.createElement("div");
      stagePieHost.className = "h-full";
      graphsGrid.appendChild(stagePieHost);
      this._stagePieRoot = mountChartRoot(stagePieHost, tx("ui.analytics.chart.cardStageDistribution", "Card Stage Distribution"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.cardStageDistribution", "Card Stage Distribution") },
            React.createElement(StagePieCard, { cards, states, enableAnimations: animationsEnabled }),
          ),
        );
      });

      const futureDueHost = document.createElement("div");
      futureDueHost.className = "h-full";
      graphsGrid.appendChild(futureDueHost);

      const futureCards = cards.map((c) => {
        const stateData = (states[String(c.id)] as Record<string, unknown> | undefined) || {};
        const due = stateData.due as number | undefined;
        const stage = stateData.stage as string | undefined;
        return {
          id: String(c.id),
          due: Number(due ?? 0) || null,
          suspended: String(stage ?? "") === "suspended",
          stage: String(stage ?? "new"),
          type: String(c?.type ?? ""),
          sourceNotePath: String(c?.sourceNotePath ?? ""),
          groups: Array.isArray(c?.groups) ? c.groups : [],
        };
      });

      this._futureDueRoot = mountChartRoot(futureDueHost, tx("ui.analytics.chart.studyForecast", "Study Forecast"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.studyForecast", "Study Forecast") },
            React.createElement(FutureDueChart, {
              cards: futureCards,
              nowMs: now,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              horizonDays: 30,
              enableAnimations: animationsEnabled,
            }),
          ),
        );
      });

      const stackedButtonsHost = document.createElement("div");
      stackedButtonsHost.className = "h-full";
      graphsGrid.appendChild(stackedButtonsHost);
      this._stackedButtonsRoot = mountChartRoot(stackedButtonsHost, tx("ui.analytics.chart.answerButtons", "Answer Buttons"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.answerButtons", "Answer Buttons") },
            React.createElement(StackedReviewButtonsChart, {
              events,
              cards,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              days: 30,
              enableAnimations: animationsEnabled,
            }),
          ),
        );
      });

      const newCardsHost = document.createElement("div");
      newCardsHost.className = "h-full";
      graphsGrid.appendChild(newCardsHost);
      this._newCardsRoot = mountChartRoot(newCardsHost, tx("ui.analytics.chart.newCardsPerDay", "New Cards Per Day"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.newCardsPerDay", "New Cards Per Day") },
            React.createElement(NewCardsPerDayChart, {
              cards,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              days: 30,
              enableAnimations: animationsEnabled,
            }),
          ),
        );
      });

      const stabilityRow = document.createElement("div");
      stabilityRow.className = "grid grid-cols-1 auto-rows-fr gap-4 lg:grid-cols-2";
      applyAos(stabilityRow, stabilityRowDelay);
      body.appendChild(stabilityRow);

      const stabilityDistributionHost = document.createElement("div");
      stabilityDistributionHost.className = "h-full";
      stabilityRow.appendChild(stabilityDistributionHost);
      this._stabilityDistributionRoot = mountChartRoot(stabilityDistributionHost, tx("ui.analytics.chart.stabilityDistribution", "Stability Distribution"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.stabilityDistribution", "Stability Distribution") },
            React.createElement(StabilityDistributionChart, {
              cards: cards.map(c => ({ ...c, groups: c.groups ?? undefined })),
              states,
              enableAnimations: animationsEnabled,
            }),
          ),
        );
      });

      const forgettingCurveHost = document.createElement("div");
      forgettingCurveHost.className = "h-full";
      stabilityRow.appendChild(forgettingCurveHost);
      this._forgettingCurveRoot = mountChartRoot(forgettingCurveHost, tx("ui.analytics.chart.forgettingCurve", "Forgetting Curve"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.forgettingCurve", "Forgetting Curve") },
            React.createElement(ForgettingCurveChart, {
              cards,
              states,
              reviewLog,
              scheduler: this.plugin.settings?.scheduling,
              nowMs: now,
              enableAnimations: animationsEnabled,
            }),
          ),
        );
      });
    }

    if (showTests) {
      const testsRow = document.createElement("div");
      testsRow.className = "grid grid-cols-1 gap-4";
      body.appendChild(testsRow);

      const testsHost = document.createElement("div");
      testsHost.className = "h-full";
      testsRow.appendChild(testsHost);
      this._testsAnalyticsRoot = mountChartRoot(testsHost, tx("ui.analytics.chart.testsPerformance", "Tests Performance"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.testsPerformance", "Tests Performance") },
            React.createElement(TestsAnalyticsCard, {
              events: events.filter((ev) => ev && ev.kind === "exam-attempt") as Array<Record<string, unknown>>,
              dbAttempts: this._examAttemptsHydrated ? this._examAttemptsCache : [],
              timezone,
            }),
          ),
        );
      });
    }

    if (showNotes) {
      const noteReviewRow = document.createElement("div");
      noteReviewRow.className = "grid grid-cols-1 gap-4";
      body.appendChild(noteReviewRow);

      const noteReviewHost = document.createElement("div");
      noteReviewHost.className = "h-full";
      noteReviewRow.appendChild(noteReviewHost);
      this._noteReviewAnalyticsRoot = mountChartRoot(noteReviewHost, tx("ui.analytics.chart.noteReviewActivity", "Note Review Activity"), (rootNode) => {
        rootNode.render(
          React.createElement(ChartErrorBoundary, { chartName: tx("ui.analytics.chart.noteReviewActivity", "Note Review Activity") },
            React.createElement(NoteReviewAnalyticsCard, {
              events: events.filter((ev) => ev && ev.kind === "note-review") as Array<Record<string, unknown>>,
              includePracticeDefault: this.plugin.settings?.study?.analyticsIncludePracticeNoteReview !== false,
              timezone,
            }),
          ),
        );
      });
    }

  }


  private _renderStatsTable(
    body: HTMLElement,
    applyAos: (el: HTMLElement, delay?: number, animation?: string) => void,
    animationsEnabled: boolean,
    statsCardDelay: number,
    rowBaseDelay: number,
    rowStep: number,
    events: ReturnType<NonNullable<typeof this.plugin.store.getAnalyticsEvents>>,
    reviewLog: ReviewLogEntry[],
    timezone: string,
    todayIndex: number,
    dayMap: Map<number, { count: number; totalMs: number }>,
    dueByDay: Map<number, number>,
    parentIds: Set<string>,
    tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string,
  ): void {
    // Daily stats table card
    const statsCard = document.createElement("div");
    statsCard.className = "card learnkit-ana-card learnkit-analytics-stats-card mt-2.5 hidden flex-col gap-3 p-4 md:flex";
    applyAos(statsCard, statsCardDelay);
    body.appendChild(statsCard);

    const statsTitle = document.createElement("div");
    statsTitle.className = "font-semibold lk-home-section-title";
    statsTitle.textContent = tx("ui.analytics.table.dailyStats", "Daily stats");
    statsCard.appendChild(statsTitle);

    // IMPORTANT: ensure `.bc` is present on all scoped utility targets.
    const statsBody = statsCard.createDiv({ cls: "text-sm learnkit-analytics-table-wrap learnkit-analytics-table-wrap" });
    const table = statsBody.createEl("table", { cls: "table w-full text-sm learnkit-changelog-table learnkit-changelog-table" });
    const thead = table.createEl("thead", { cls: "" });
    const headRow = thead.createEl("tr", { cls: "text-left border-b border-border" });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.date", "Date") });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.cardsDue", "Cards due") });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.cardsStudied", "Cards studied") });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.studyTime", "Study time") });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.timePerCard", "Time per card") });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.passedPct", "Passed (%)") });
    headRow.createEl("th", { cls: "font-medium learnkit-changelog-cell learnkit-changelog-cell", text: tx("ui.analytics.table.failedPct", "Failed (%)") });
    const tbody = table.createEl("tbody", { cls: "" });

    // Build per-day rating counts
    const ratingsByDay = new Map<number, { again: number; hard: number; good: number; easy: number }>();
    for (const ev of events) {
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      if (ev.kind !== "review") continue;
      const idx = localDayIndex(at, timezone);
      const row = ratingsByDay.get(idx) ?? { again: 0, hard: 0, good: 0, easy: 0 };
      const r = String(ev.result || "");
      if (r === "again" || r === "hard" || r === "good" || r === "easy") {
        row[r] += 1;
      }
      ratingsByDay.set(idx, row);
    }

    type RowDatum = {
      idx: number;
      dateStr: string;
      due: number;
      reviews: number;
      minutes: number;
      secondsPerCard: number;
      passed: number;
      failed: number;
      passedPct: number;
      failedPct: number;
    };

    const allRows: RowDatum[] = [];
    const maxDays = 365;

    for (let i = 0; i < maxDays; i += 1) {
      const idx = todayIndex - i;
      const counts = dayMap.get(idx);
      const ratings = ratingsByDay.get(idx);
      const due = dueByDay.get(idx) ?? 0;
      const reviews = counts?.count ?? 0;
      const minutes = (counts?.totalMs ?? 0) / 60000;
      const secondsPerCard = reviews > 0 ? (counts?.totalMs ?? 0) / reviews / 1000 : 0;
      const passed = (ratings?.hard ?? 0) + (ratings?.good ?? 0) + (ratings?.easy ?? 0);
      const failed = ratings?.again ?? 0;
      const passedPct = reviews > 0 ? (passed / reviews) * 100 : 0;
      const failedPct = reviews > 0 ? (failed / reviews) * 100 : 0;

      if (due <= 0 && reviews <= 0 && passed <= 0 && failed <= 0) continue;

      const dateStr = new Date(idx * MS_DAY).toLocaleDateString(undefined, {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      });

      allRows.push({ idx, dateStr, due, reviews, minutes, secondsPerCard, passed, failed, passedPct, failedPct });
    }

    allRows.sort((a, b) => b.idx - a.idx);

    let pageSize = 5;
    let currentPage = 0;

    // Bottom controls need summary declared before first renderTable() call.
    const bottom = document.createElement("div");
    bottom.className = "learnkit-analytics-stats-bottom mt-2.5 flex flex-row items-center gap-2";
    statsCard.appendChild(bottom);

    const summaryWrap = document.createElement("div");
    summaryWrap.className = "learnkit-analytics-stats-summary flex flex-col gap-1 shrink-0";
    const summary = document.createElement("div");
    summary.className = "text-sm text-muted-foreground";
    summary.textContent = "";
    summaryWrap.appendChild(summary);
    bottom.appendChild(summaryWrap);

    const center = document.createElement("div");
    center.className = "learnkit-analytics-stats-center flex-1 min-w-0 flex items-center justify-center";
    bottom.appendChild(center);

    const right = document.createElement("div");
    right.className = "learnkit-analytics-stats-actions ml-auto shrink-0 flex flex-row flex-nowrap items-center gap-2";
    bottom.appendChild(right);

    const formatStudyTime = (minutes: number) => {
      const totalSeconds = Math.round(minutes * 60);
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      return `${hours}:${mins.toString().padStart(2, "0")}`;
    };

    const formatTimePerCard = (secondsPerCard: number) => {
      const cardSeconds = Math.round(secondsPerCard);
      const cardMins = Math.floor(cardSeconds / 60);
      const cardSecs = cardSeconds % 60;
      return `${cardMins}:${cardSecs.toString().padStart(2, "0")}`;
    };

    const escapeCsv = (value: string) => {
      const needsQuotes = /[",\n\r]/.test(value);
      const escaped = value.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    };

    const buildCsv = () => {
      const headers = [
        tx("ui.analytics.table.date", "Date"),
        tx("ui.analytics.table.cardsDue", "Cards due"),
        tx("ui.analytics.table.cardsStudied", "Cards studied"),
        tx("ui.analytics.table.studyTime", "Study time"),
        tx("ui.analytics.table.timePerCard", "Time per card"),
        tx("ui.analytics.table.passedPct", "Passed (%)"),
        tx("ui.analytics.table.failedPct", "Failed (%)"),
      ];
      const rows = allRows.map((row) => [
        row.dateStr,
        String(row.due),
        String(row.reviews),
        formatStudyTime(row.minutes),
        formatTimePerCard(row.secondsPerCard),
        `${row.passed} (${row.reviews > 0 ? row.passedPct.toFixed(0) : "0"}%)`,
        `${row.failed} (${row.reviews > 0 ? row.failedPct.toFixed(0) : "0"}%)`,
      ]);
      return [headers, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\n");
    };

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "learnkit-analytics-export-btn inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[var(--learnkit-font-2xs)] font-semibold text-muted-foreground shadow-none hover:text-foreground focus:text-foreground focus-visible:text-foreground";
    const exportIcon = document.createElement("span");
    exportIcon.className = "inline-flex items-center justify-center [&_svg]:size-3";
    setIcon(exportIcon, "download");
    exportIcon.classList.add("scale-[0.9]");
    const exportText = document.createElement("span");
    exportText.textContent = tx("ui.analytics.export.csv", "Export as CSV");
    exportBtn.appendChild(exportIcon);
    exportBtn.appendChild(exportText);
    exportBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const csv = buildCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `daily-stats-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
    center.appendChild(exportBtn);

    const renderTable = () => {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

      const start = currentPage * pageSize;
      const end = Math.min(allRows.length, start + pageSize);

      if (allRows.length === 0) {
        summary.textContent = tx("ui.analytics.table.empty", "No daily stats available");
      } else {
        summary.textContent = tx("ui.analytics.table.showingRange", "Showing {start}-{end} of {count} day{suffix}", {
          start: start + 1,
          end,
          count: allRows.length,
          suffix: allRows.length === 1 ? "" : "s",
        });
      }

      for (let i = start; i < end; i += 1) {
        const row = allRows[i];

        const tr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 last:border-0" });
        // Cascade AOS delay row by row (force visible after re-render)
        applyAos(tr, rowBaseDelay + rowStep * (i - start + 2));
        if (animationsEnabled) {
          tr.classList.add("aos-init", "aos-animate");
          // Fallback: if AOS doesn't initialize, force the row visible
          window.setTimeout(() => {
            if (!tr.isConnected) return;
            const style = getComputedStyle(tr);
            if (style.opacity === "0") {
              tr.classList.add("learnkit-aos-fallback", "learnkit-aos-fallback");
            }
          }, 350);
        }
        tr.createEl("td", { cls: "learnkit-changelog-cell learnkit-changelog-cell whitespace-nowrap", text: row.dateStr });
        tr.createEl("td", { cls: "learnkit-changelog-cell learnkit-changelog-cell", text: String(row.due) });
        tr.createEl("td", { cls: "learnkit-changelog-cell learnkit-changelog-cell", text: String(row.reviews) });

        // Study time (hh:mm)
        tr.createEl("td", { cls: "learnkit-changelog-cell learnkit-changelog-cell", text: formatStudyTime(row.minutes) });

        // Time per card (mm:ss)
        tr.createEl("td", { cls: "learnkit-changelog-cell learnkit-changelog-cell", text: formatTimePerCard(row.secondsPerCard) });

        tr.createEl("td", {
          cls: "learnkit-changelog-cell learnkit-changelog-cell",
          text: `${row.passed} (${row.reviews > 0 ? row.passedPct.toFixed(0) : "0"}%)`,
        });
        tr.createEl("td", {
          cls: "learnkit-changelog-cell learnkit-changelog-cell",
          text: `${row.failed} (${row.reviews > 0 ? row.failedPct.toFixed(0) : "0"}%)`,
        });
      }

    };

    const rowsLbl = right.createDiv({ cls: "learnkit-analytics-stats-rows-label learnkit-analytics-stats-rows-label text-sm text-muted-foreground" });
    rowsLbl.textContent = tx("ui.analytics.table.rows", "Rows");

    const rowsWrap = right.createDiv({ cls: "learnkit learnkit learnkit-analytics-stats-rows-wrap learnkit-analytics-stats-rows-wrap relative inline-flex" });
    const rowsBtn = rowsWrap.createEl("button", { cls: "learnkit-btn-toolbar learnkit-btn-toolbar learnkit-btn-filter learnkit-btn-filter inline-flex h-7 min-w-11 items-center justify-between gap-2 px-3 text-sm" });
    rowsBtn.setAttribute("aria-haspopup", "menu");
    rowsBtn.setAttribute("aria-expanded", "false");
    rowsBtn.setAttribute("aria-label", tx("ui.analytics.table.rowsPerPage", "Rows per page"));

    const rowsBtnText = document.createElement("span");
    rowsBtnText.className = "truncate";
    rowsBtnText.textContent = String(pageSize);
    rowsBtn.appendChild(rowsBtnText);

    const rowsChevron = document.createElement("span");
    rowsChevron.className = "inline-flex items-center justify-center [&_svg]:size-4 transition-transform duration-150 ease-out";
    rowsChevron.setAttribute("aria-hidden", "true");
    setIcon(rowsChevron, "chevron-down");
    rowsBtn.appendChild(rowsChevron);

    const rowsPopover = document.createElement("div");
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "learnkit";
    rowsPopover.className = "";
    rowsPopover.setAttribute("aria-hidden", "true");
    rowsPopover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay");
    sproutWrapper.appendChild(rowsPopover);

    const rowsPanel = document.createElement("div");
    rowsPanel.className = "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto";
    rowsPopover.appendChild(rowsPanel);

    const rowsMenu = document.createElement("div");
    rowsMenu.setAttribute("role", "menu");
    rowsMenu.className = "flex flex-col";
    rowsPanel.appendChild(rowsMenu);

    let rowsOpen = false;
    const pageSizeOptions = ["100", "50", "25", "10", "5"];
    let activePointerHandler: ((ev: PointerEvent) => void) | null = null;
    let pointerListenerTimer: number | null = null;

    const closeRowsMenu = () => {
      // Cancel any pending deferred listener registration
      if (pointerListenerTimer !== null) {
        clearTimeout(pointerListenerTimer);
        pointerListenerTimer = null;
      }
      // Remove the outside-click listener
      if (activePointerHandler) {
        document.removeEventListener("pointerdown", activePointerHandler, true);
        activePointerHandler = null;
      }
      rowsBtn.setAttribute("aria-expanded", "false");
      rowsChevron.classList.remove("rotate-180");
      rowsPopover.setAttribute("aria-hidden", "true");
      rowsPopover.classList.remove("is-open");
      try {
        sproutWrapper.remove();
      } catch (e: unknown) { log.swallow("remove rows menu wrapper", e); }
      rowsOpen = false;
    };

    const placeRowsMenu = () => placePopover({
      trigger: rowsBtn, panel: rowsPanel, popoverEl: rowsPopover,
      width: 96, dropUp: true,
    });

    const buildRowsOptions = () => {
      while (rowsMenu.firstChild) rowsMenu.removeChild(rowsMenu.firstChild);

      for (const opt of pageSizeOptions) {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", opt === String(pageSize) ? "true" : "false");
        item.tabIndex = 0;
        item.className =
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

        const dotWrap = document.createElement("div");
        dotWrap.className = "size-4 flex items-center justify-center";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
        dot.setAttribute("aria-hidden", "true");
        dotWrap.appendChild(dot);

        const txt = document.createElement("span");
        txt.className = "";
        txt.textContent = opt;
        item.appendChild(txt);

        const activate = () => {
          pageSize = Math.max(1, Math.floor(Number(opt) || 5));
          rowsBtnText.textContent = opt;
          currentPage = 0;
          renderTable();
          renderPager();
          closeRowsMenu();
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
            closeRowsMenu();
            rowsBtn.focus();
          }
        });

        rowsMenu.appendChild(item);
      }
    };

    const openRowsMenu = () => {
      buildRowsOptions();
      rowsBtn.setAttribute("aria-expanded", "true");
      rowsChevron.classList.add("rotate-180");
      rowsPopover.setAttribute("aria-hidden", "false");
      rowsPopover.classList.add("is-open");
      if (!sproutWrapper.parentElement) document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => placeRowsMenu());

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (rowsWrap.contains(t) || rowsPopover.contains(t)) return;
        closeRowsMenu();
      };

      // Store reference so closeRowsMenu can remove it
      activePointerHandler = onDocPointerDown;

      pointerListenerTimer = window.setTimeout(() => {
        pointerListenerTimer = null;
        document.addEventListener("pointerdown", onDocPointerDown, true);
      }, 0);

      rowsOpen = true;
    };

    rowsBtn.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (rowsOpen) closeRowsMenu();
      else openRowsMenu();
    });

    const pagerHost = right.createDiv({ cls: "learnkit-analytics-stats-pager learnkit-analytics-stats-pager flex items-center" });

    const renderPager = () => {
      while (pagerHost.firstChild) pagerHost.removeChild(pagerHost.firstChild);

      const totalRows = allRows.length;
      const size = Math.max(1, Math.floor(Number(pageSize) || 5));
      const totalPages = Math.max(1, Math.ceil(totalRows / size));

      if (!Number.isFinite(currentPage) || currentPage < 0) currentPage = 0;
      if (currentPage > totalPages - 1) currentPage = totalPages - 1;

      const isMobile = document.body.classList.contains("is-mobile");

      if (totalRows <= size) {
        const small = document.createElement("div");
        small.className = "text-sm text-muted-foreground";
        small.textContent = totalRows === 0
          ? tx("ui.analytics.table.pageXofY", "Page {page} / {total}", { page: 0, total: 0 })
          : tx("ui.analytics.table.pageXofY", "Page {page} / {total}", { page: 1, total: 1 });
        pagerHost.appendChild(small);
        return;
      }

      if (isMobile) {
        const nav = document.createElement("nav");
        nav.setAttribute("role", "navigation");
        nav.className = "learnkit-analytics-stats-pager-nav flex items-center gap-1";
        pagerHost.appendChild(nav);

        const current = currentPage + 1;
        const totalPagesLocal = totalPages;

        const prev = document.createElement("button");
        prev.type = "button";
        prev.className = "learnkit-btn-toolbar h-8 px-2";
        prev.setAttribute("aria-label", tx("ui.analytics.table.prevPage", "Previous page"));
        prev.disabled = currentPage <= 0;
        prev.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (prev.disabled) return;
          currentPage = Math.max(0, currentPage - 1);
          renderTable();
          renderPager();
        });
        const prevIcon = document.createElement("span");
        prevIcon.setAttribute("aria-hidden", "true");
        prevIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
        setIcon(prevIcon, "chevron-left");
        prev.appendChild(prevIcon);
        nav.appendChild(prev);

        const pageState = document.createElement("div");
        pageState.className = "text-sm text-muted-foreground px-1";
        pageState.textContent = tx("ui.analytics.table.pageXofY", "Page {page} / {total}", {
          page: current,
          total: totalPagesLocal,
        });
        nav.appendChild(pageState);

        const next = document.createElement("button");
        next.type = "button";
        next.className = "learnkit-btn-toolbar h-8 px-2";
        next.setAttribute("aria-label", tx("ui.analytics.table.nextPage", "Next page"));
        next.disabled = currentPage >= totalPagesLocal - 1;
        next.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (next.disabled) return;
          currentPage = Math.min(totalPagesLocal - 1, currentPage + 1);
          renderTable();
          renderPager();
        });
        const nextIcon = document.createElement("span");
        nextIcon.setAttribute("aria-hidden", "true");
        nextIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
        setIcon(nextIcon, "chevron-right");
        next.appendChild(nextIcon);
        nav.appendChild(next);
        return;
      }

      const nav = document.createElement("nav");
      nav.setAttribute("role", "navigation");
      nav.className = "learnkit-analytics-stats-pager-nav flex items-center gap-2";
      pagerHost.appendChild(nav);

      const mkBtn = (label: string, tooltip: string, disabled: boolean, active: boolean, onClick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `bc learnkit-btn-toolbar h-8 px-2${active ? " learnkit-btn-control" : ""}`;
        b.textContent = label;
        b.setAttribute("aria-label", tooltip);
        b.setAttribute("data-tooltip-position", "top");
        b.disabled = disabled;
        if (active) b.setAttribute("aria-current", "page");
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (b.disabled) return;
          onClick();
        });
        return b;
      };

      const mkEllipsisBtn = (targetPage: number) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "learnkit-btn-toolbar h-8 px-2";
        b.textContent = "…";
        b.setAttribute("aria-label", tx("ui.analytics.table.pageN", "Page {page}", { page: targetPage }));
        b.setAttribute("data-tooltip-position", "top");
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          currentPage = targetPage - 1;
          renderTable();
          renderPager();
        });
        return b;
      };

      const current = currentPage + 1;
      const totalPagesLocal = totalPages;
      const maxBtns = 5;
      let start = Math.max(1, current - Math.floor(maxBtns / 2));
      let end = start + maxBtns - 1;
      if (end > totalPagesLocal) {
        end = totalPagesLocal;
        start = Math.max(1, end - maxBtns + 1);
      }

      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "learnkit-btn-toolbar h-8 px-2";
      prev.setAttribute("aria-label", tx("ui.analytics.table.prevPage", "Previous page"));
      prev.setAttribute("data-tooltip-position", "top");
      prev.disabled = currentPage <= 0;
      prev.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (prev.disabled) return;
        currentPage = Math.max(0, currentPage - 1);
        renderTable();
        renderPager();
      });

      const prevIcon = document.createElement("span");
      prevIcon.setAttribute("aria-hidden", "true");
      prevIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(prevIcon, "chevron-left");
      prev.appendChild(prevIcon);

      const prevTxt = document.createElement("span");
      prevTxt.className = "ml-1";
      prevTxt.textContent = tx("ui.analytics.table.prev", "Prev");
      prev.appendChild(prevTxt);
      nav.appendChild(prev);

      if (start > 1) {
        nav.appendChild(
          mkBtn("1", tx("ui.analytics.table.pageN", "Page {page}", { page: 1 }), false, current === 1, () => {
            currentPage = 0;
            renderTable();
            renderPager();
          }),
        );
      }

      for (let p = start; p <= end; p++) {
        nav.appendChild(
          mkBtn(String(p), tx("ui.analytics.table.pageN", "Page {page}", { page: p }), false, p === current, () => {
            currentPage = p - 1;
            renderTable();
            renderPager();
          }),
        );
      }

      if (end < totalPagesLocal - 1) {
        nav.appendChild(mkEllipsisBtn(end + 1));
      }

      if (end < totalPagesLocal) {
        nav.appendChild(
          mkBtn(
            String(totalPagesLocal),
            tx("ui.analytics.table.pageN", "Page {page}", { page: totalPagesLocal }),
            false,
            current === totalPagesLocal,
            () => {
            currentPage = totalPagesLocal - 1;
            renderTable();
            renderPager();
            },
          ),
        );
      }

      const next = document.createElement("button");
      next.type = "button";
      next.className = "learnkit-btn-toolbar h-8 px-2";
      next.setAttribute("aria-label", tx("ui.analytics.table.nextPage", "Next page"));
      next.setAttribute("data-tooltip-position", "top");
      next.disabled = currentPage >= totalPagesLocal - 1;
      next.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (next.disabled) return;
        currentPage = Math.min(totalPagesLocal - 1, currentPage + 1);
        renderTable();
        renderPager();
      });

      const nextTxt = document.createElement("span");
      nextTxt.className = "mr-1";
      nextTxt.textContent = tx("ui.analytics.table.next", "Next");
      next.appendChild(nextTxt);

      const nextIcon = document.createElement("span");
      nextIcon.setAttribute("aria-hidden", "true");
      nextIcon.className = "inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(nextIcon, "chevron-right");
      next.appendChild(nextIcon);

      nav.appendChild(next);
    };

    // Initial render
    renderTable();
    renderPager();

  }

}
