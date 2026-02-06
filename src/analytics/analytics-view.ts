// src/analytics/AnalyticsView.ts
import { ItemView, Notice, type WorkspaceLeaf, setIcon } from "obsidian";
import * as React from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { initAOS, refreshAOS, resetAOS } from "../core/aos-loader";
import { SproutHeader, type SproutHeaderPage } from "../components/header";
import { BRAND, VIEW_TYPE_ANALYTICS } from "../core/constants";
import type SproutPlugin from "../main";
import { StagePieCard } from "./pie-charts";
import { FutureDueChart } from "./future-due-chart";
import { NewCardsPerDayChart } from "./new-cards-per-day-chart";
import { StackedReviewButtonsChart } from "./stacked-review-buttons-chart";
import { ReviewCalendarHeatmap } from "./review-calendar-heatmap";
import { StabilityDistributionChart } from "./stability-distribution-chart";
import { ForgettingCurveChart } from "./forgetting-curve-chart";

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * IMPORTANT:
 * - Add `bc` to every element you want Basecoat (and scoped utilities) to style.
 * - Your PostCSS scoper produces selectors like `.btn-outline.bc`, `.flex.bc`, `table.bc`, etc.
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

function computeDueForecast(states: Record<string, any>, now: number) {
  const byDays: Record<number, number> = { 1: 0, 7: 0, 30: 0, 90: 0 };
  const thresholds = [1, 7, 30, 90];

  for (const st of Object.values(states || {})) {
    if (!st || typeof st !== "object") continue;
    if ((st as any).stage === "suspended") continue;

    const due = Number((st as any).due);
    if (!Number.isFinite(due) || due <= 0) continue;

    for (const d of thresholds) {
      if (due <= now + d * MS_DAY) byDays[d] += 1;
    }
  }

  return { byDays };
}

function computeAnswerButtonCounts(events: any[], now: number) {
  const cutoff = now - 30 * MS_DAY;
  const counts: Record<string, number> = { again: 0, hard: 0, good: 0, easy: 0 };

  for (const ev of events || []) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.kind !== "review") continue;

    const at = Number(ev.at);
    if (!Number.isFinite(at) || at < cutoff) continue;

    const result = String(ev.result || "");
    if (result in counts) counts[result] += 1;
  }

  return counts;
}

type HeatmapDatum = { date: string; value: number };

function toDateKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function buildHeatmapData(events: any[], states: Record<string, any>, now: number, days: number): HeatmapDatum[] {
  const map = new Map<string, number>();
  const hasStudy = (events || []).some((e) => e && e.kind === "review");

  if (hasStudy) {
    for (const ev of events || []) {
      if (!ev || ev.kind !== "review") continue;
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const key = toDateKey(at);
      map.set(key, (map.get(key) || 0) + 1);
    }
  } else {
    for (const st of Object.values(states || {})) {
      if (!st || typeof st !== "object") continue;
      if ((st as any).stage === "suspended") continue;
      const due = Number((st as any).due);
      if (!Number.isFinite(due)) continue;
      const key = toDateKey(due);
      map.set(key, (map.get(key) || 0) + 1);
    }
  }

  const out: HeatmapDatum[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const ts = now - i * MS_DAY;
    const key = toDateKey(ts);
    out.push({ date: key, value: map.get(key) || 0 });
  }
  return out;
}

function buildHeatmapGrid(data: HeatmapDatum[], weekStartsOn: number) {
  const parsed = data.map((d) => ({ ...d, dateObj: new Date(`${d.date}T00:00:00`) }));
  const start = parsed[0]?.dateObj ? new Date(parsed[0].dateObj) : new Date();
  const end = parsed[parsed.length - 1]?.dateObj ? new Date(parsed[parsed.length - 1].dateObj) : new Date();

  const startDay = start.getDay();
  const padStart = (startDay - weekStartsOn + 7) % 7;
  const first = new Date(start);
  first.setDate(first.getDate() - padStart);

  const totalDays = Math.ceil((end.getTime() - first.getTime()) / MS_DAY) + 1;
  const weeks = Math.ceil(totalDays / 7);

  const valueMap = new Map(parsed.map((d) => [d.date, d.value]));
  const cells: Array<{ date: Date; value: number; isPadding: boolean }> = [];

  for (let i = 0; i < weeks * 7; i += 1) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const key = toDateKey(d.getTime());
    const value = valueMap.get(key) ?? 0;
    const isPadding = d < start || d > end;
    cells.push({ date: d, value, isPadding });
  }

  return { cells, weeks };
}

function heatColor(value: number, max: number) {
  if (value <= 0) return "var(--background-modifier-border)";
  const pct = Math.max(20, Math.min(85, Math.round((value / Math.max(1, max)) * 85)));
  return `color-mix(in srgb, var(--interactive-accent) ${pct}%, transparent)`;
}

function HeatmapCalendar(props: { title: string; data: HeatmapDatum[]; weekStartsOn?: number; axisLabels?: boolean }) {
  const weekStartsOn = Number.isFinite(props.weekStartsOn) ? Number(props.weekStartsOn) : 1;
  const max = Math.max(1, ...props.data.map((d) => d.value));
  const grid = buildHeatmapGrid(props.data, weekStartsOn);

  const monthLabels: React.ReactNode[] = [];
  if (props.axisLabels) {
    const seen = new Set<string>();
    for (const cell of grid.cells) {
      if (cell.isPadding) continue;
      const label = cell.date.toLocaleString(undefined, { month: "short" });
      const key = `${label}-${cell.date.getMonth()}-${cell.date.getFullYear()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      monthLabels.push(
        React.createElement(
          "div",
          { key, className: "bc text-xs text-muted-foreground", style: { gridColumn: "span 4" } },
          label,
        ),
      );
    }
  }

  const cells = grid.cells.map((cell, i) =>
    React.createElement("div", {
      key: `${cell.date.toISOString()}-${i}`,
      className: "bc",
      title: `${cell.date.toLocaleDateString()}: ${cell.value}`,
      style: {
        width: "12px",
        height: "12px",
        borderRadius: "3px",
        opacity: cell.isPadding ? "0.25" : "1",
        backgroundColor: heatColor(cell.value, max),
      },
    }),
  );

  return React.createElement(
    "div",
    { className: "bc card sprout-ana-card p-4" },
    React.createElement(
      "div",
      { className: "bc flex items-center justify-between" },
      React.createElement("div", { className: "bc font-semibold" }, props.title),
      React.createElement("div", { className: "bc text-xs text-muted-foreground" }, `Last ${props.data.length} days`),
    ),
    props.axisLabels
      ? React.createElement(
          "div",
          { className: "bc mt-3 grid gap-2", style: { gridTemplateColumns: "repeat(12, minmax(0, 1fr))" } },
          monthLabels,
        )
      : null,
    React.createElement(
      "div",
      {
        className: "bc mt-3",
        style: {
          display: "grid",
          gridAutoFlow: "column",
          gridTemplateRows: "repeat(7, 1fr)",
          gap: "4px",
        },
      },
      cells,
    ),
  );
}

export class SproutAnalyticsView extends ItemView {
  plugin: SproutPlugin;

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

  private _constrainedMaxWidth = "1100px";
  private _constrainedWidth = "94%";

  constructor(leaf: WorkspaceLeaf, plugin: SproutPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_ANALYTICS;
  }

  getDisplayText() {
    return "Analytics";
  }

  getIcon() {
    return "chart-spline";
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
    try {
      this._heatmapRoot?.unmount();
    } catch {}
    this._heatmapRoot = null;
    try {
      this._stagePieRoot?.unmount();
    } catch {}
    this._stagePieRoot = null;
    try {
      this._answerPieRoot?.unmount();
    } catch {}
    this._answerPieRoot = null;
    try {
      this._futureDueRoot?.unmount();
    } catch {}
    this._futureDueRoot = null;
    try {
      this._newCardsRoot?.unmount();
    } catch {}
    this._newCardsRoot = null;
    try {
      this._stackedButtonsRoot?.unmount();
    } catch {}
    this._stackedButtonsRoot = null;
    try {
      this._stabilityDistributionRoot?.unmount();
    } catch {}
    this._stabilityDistributionRoot = null;
    try {
      this._forgettingCurveRoot?.unmount();
    } catch {}
    this._forgettingCurveRoot = null;
    resetAOS();
  }

  onRefresh() {
    this.render();
  }

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

  render() {
    const root = this.contentEl;
    root.empty();

    if (this._heatmapRoot) {
      try {
        this._heatmapRoot.unmount();
      } catch {}
      this._heatmapRoot = null;
    }
    if (this._stagePieRoot) {
      try {
        this._stagePieRoot.unmount();
      } catch {}
      this._stagePieRoot = null;
    }
    if (this._answerPieRoot) {
      try {
        this._answerPieRoot.unmount();
      } catch {}
      this._answerPieRoot = null;
    }
    if (this._futureDueRoot) {
      try {
        this._futureDueRoot.unmount();
      } catch {}
      this._futureDueRoot = null;
    }
    if (this._newCardsRoot) {
      try {
        this._newCardsRoot.unmount();
      } catch {}
      this._newCardsRoot = null;
    }
    if (this._stackedButtonsRoot) {
      try {
        this._stackedButtonsRoot.unmount();
      } catch {}
      this._stackedButtonsRoot = null;
    }
    if (this._stabilityDistributionRoot) {
      try {
        this._stabilityDistributionRoot.unmount();
      } catch {}
      this._stabilityDistributionRoot = null;
    }
    if (this._forgettingCurveRoot) {
      try {
        this._forgettingCurveRoot.unmount();
      } catch {}
      this._forgettingCurveRoot = null;
    }

    this._rootEl = root;

    root.classList.add("bc", "sprout-view-content", "sprout-analytics-root", "flex", "flex-col");
    root.style.minHeight = "0";
    root.style.gap = "12px";

    this.containerEl.addClass("sprout");
    this.setTitle?.("Analytics");

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

    (this._header as any).install?.("analytics" as SproutHeaderPage);
    this._applyWidthMode();

    const animationsEnabled = this.plugin.settings?.appearance?.enableAnimations ?? true;
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

    const applyAos = (el: HTMLElement, delay?: number, animation = "fade-up") => {
      if (!animationsEnabled) return;
      el.setAttribute("data-aos", animation);
      if (Number.isFinite(delay)) el.setAttribute("data-aos-delay", String(delay));
    };

    const title = document.createElement("div");
    title.className = "text-xl font-semibold tracking-tight";
    applyAos(title, titleDelay);
    title.textContent = "Analytics";
    root.appendChild(title);

    const body = document.createElement("div");
    body.className = "w-full space-y-4";
    root.appendChild(body);

    const now = Date.now();
    const events = this.plugin.store.getAnalyticsEvents?.() ?? [];
    const cards = this.plugin.store.getAllCards?.() ?? [];
    const states = (this.plugin.store as any)?.data?.states ?? {};
    const reviewLog = (this.plugin.store as any)?.data?.reviewLog ?? [];

    const dueForecast = computeDueForecast(states, now);
    void dueForecast; // reserved for future use

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

    for (const st of Object.values(states || {})) {
      if (!st || typeof st !== "object") continue;
      if ((st as any).stage === "suspended") continue;
      const due = Number((st as any).due);
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
    const streakMessages = ["One for the record books!", "Keep the streak rollin!", "Don't break the chain!", "You're on fire!"];
    const streakNote = streakMatches ? streakMessages[Math.floor(Math.random() * streakMessages.length)] : "All time";

    const kpiRow = document.createElement("div");
    kpiRow.className = "sprout-ana-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4";
    body.appendChild(kpiRow);

    const makeBadge = (opts: { text: string; bg?: string; color?: string; border?: string; live?: boolean; className?: string }) => {
      const badge = document.createElement("span");
      badge.className = `sprout-badge inline-flex items-center gap-1${opts.className ? ` ${opts.className}` : ""}`;
      if (opts.bg) badge.style.backgroundColor = opts.bg;
      else if (!opts.className) badge.style.backgroundColor = "var(--theme-accent)";
      if (opts.color) badge.style.color = opts.color;
      if (opts.border) badge.style.border = opts.border;
      if (opts.live) {
        const circle = document.createElement("span");
        circle.className = "inline-block w-1.5 h-1.5 rounded-full bg-white";
        circle.style.animation = "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite";
        badge.appendChild(circle);
      }
      badge.appendChild(document.createTextNode(opts.text));
      return badge;
    };

    const formatTrend = (current: number, previous: number, previousDaysWithData: number) => {
      if (previousDaysWithData <= 0 || previous <= 0) return { value: 0, text: "0.0%", dir: 0 };
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
      const svg = icon.querySelector("svg");
      if (svg) {
        (svg as SVGElement).setAttribute("stroke", "currentColor");
      }
      badge.appendChild(icon);

      const valueEl = document.createElement("span");
      valueEl.textContent = trend.dir === 0 ? "0.0%" : `${trend.dir > 0 ? "+" : ""}0.0%`;
      badge.appendChild(valueEl);

      // Animate count-up with subtle spin
      const durationMs = 800;
      const start = performance.now();
      const target = trend.value;
      const startAngle = 0;
      const endAngle = trend.dir === 0 ? 0 : trend.dir > 0 ? 180 : -180;

      const animate = (t: number) => {
        const elapsed = t - start;
        const p = Math.min(Math.max(elapsed / durationMs, 0), 1);
        const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // easeInOut
        const currentVal = (trend.dir === 0 ? 0 : eased * Math.abs(target)) * (trend.dir >= 0 ? 1 : -1);
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

    const makeCard = (title: string, value: string, badge: HTMLElement | null, note: string) => {
      const card = document.createElement("div");
      card.className = "card sprout-ana-card small-card flex flex-col gap-2";
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
      ? makeBadge({ text: "Live", live: true, className: "sprout-live-badge sprout-live-badge-orange" })
      : (() => {
          const badge = document.createElement("span");
          badge.className = "sprout-trend-badge inline-flex items-center gap-1";
          badge.style.padding = "0rem 0.5rem";
          badge.textContent = "All time";
          return badge;
        })();

    makeCard("Longest streak", `${longestStreak} day${longestStreak === 1 ? "" : "s"}`, longestBadge, streakNote);

    const includesToday = (dayMap.get(todayIndex)?.count ?? 0) > 0;
    const currentBadge = includesToday
      ? makeBadge({ text: "Live", live: true, className: "sprout-live-badge sprout-live-badge-black" })
      : null;
    const currentNote =
      currentStreak > 0 ? (streakMatches ? "Longest streak active" : includesToday ? "Keep it going!" : "Streak active.") : "No reviews yet";

    makeCard("Current streak", `${currentStreak} day${currentStreak === 1 ? "" : "s"}`, currentBadge, currentNote);

    const timeBadge = buildTrendBadge(formatTrend(avgTimePerDayMinutes, prevAvgTimePerDayMinutes, prevActiveDaysTime));
    makeCard("Daily time", `${Math.ceil(avgTimePerDayMinutes)} min`, timeBadge, "Last 7 days");

    const cardsBadge = buildTrendBadge(formatTrend(avgCardsPerDay, prevAvgCardsPerDay, prevActiveDaysReviews));
    // FIX: closed template string correctly (this was causing esbuild to desync and later choke on `Showing ...`)
    makeCard("Daily cards", `${Math.round(avgCardsPerDay)}`, cardsBadge, "Last 7 days");

    const heroRow = document.createElement("div");
    heroRow.className = "grid grid-cols-1 xl:grid-cols-2 gap-4";
    body.appendChild(heroRow);

    const heatmapHost = document.createElement("div");
    heatmapHost.className = "xl:col-span-2";
    heatmapHost.style.minHeight = "200px";
    applyAos(heatmapHost, heatmapDelay);
    heroRow.appendChild(heatmapHost);

    this._heatmapRoot = createRoot(heatmapHost);
    const reviewEvents = events.filter((ev: any) => ev && ev.kind === "review");
    this._heatmapRoot.render(
      React.createElement(ReviewCalendarHeatmap, {
        revlog: reviewEvents,
        timezone,
        rangeDays: 365,
        filters: {},
      }),
    );

    // 2x2 graphs grid
    const graphsGrid = document.createElement("div");
    graphsGrid.className = "grid grid-cols-1 lg:grid-cols-2 gap-4";
    graphsGrid.style.gridAutoRows = "1fr";
    applyAos(graphsGrid, graphsGridDelay);
    body.appendChild(graphsGrid);

    // Top-left: Stage pie
    const stagePieHost = document.createElement("div");
    stagePieHost.className = "h-full";
    graphsGrid.appendChild(stagePieHost);
    this._stagePieRoot = createRoot(stagePieHost);
    this._stagePieRoot.render(React.createElement(StagePieCard, { cards, states, enableAnimations: animationsEnabled }));

    // Top-right: Study forecast
    const futureDueHost = document.createElement("div");
    futureDueHost.className = "h-full";
    graphsGrid.appendChild(futureDueHost);
    this._futureDueRoot = createRoot(futureDueHost);

    const futureCards = cards.map((c: any) => {
      const st = states?.[String(c.id)] ?? {};
      return {
        id: String(c.id),
        due: Number(st?.due ?? 0) || null,
        suspended: String(st?.stage ?? "") === "suspended",
        stage: String(st?.stage ?? "new"),
        type: String(c?.type ?? ""),
        sourceNotePath: String(c?.sourceNotePath ?? ""),
        groups: Array.isArray(c?.groups) ? c.groups : [],
      };
    });

    this._futureDueRoot.render(
      React.createElement(FutureDueChart, {
        cards: futureCards,
        nowMs: now,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        horizonDays: 30,
        enableAnimations: animationsEnabled,
      }),
    );

    // Bottom-left: Answer buttons histogram
    const stackedButtonsHost = document.createElement("div");
    stackedButtonsHost.className = "h-full";
    graphsGrid.appendChild(stackedButtonsHost);
    this._stackedButtonsRoot = createRoot(stackedButtonsHost);
    this._stackedButtonsRoot.render(
      React.createElement(StackedReviewButtonsChart, {
        events,
        cards,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        days: 30,
        enableAnimations: animationsEnabled,
      }),
    );

    // Bottom-right: New cards per day
    const newCardsHost = document.createElement("div");
    newCardsHost.className = "h-full";
    graphsGrid.appendChild(newCardsHost);
    this._newCardsRoot = createRoot(newCardsHost);
    this._newCardsRoot.render(
      React.createElement(NewCardsPerDayChart, {
        cards,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        days: 30,
        enableAnimations: animationsEnabled,
      }),
    );

    // Stability Distribution + Placeholder
    const stabilityRow = document.createElement("div");
    stabilityRow.className = "grid grid-cols-1 lg:grid-cols-2 gap-4";
    stabilityRow.style.gridAutoRows = "1fr";
    applyAos(stabilityRow, stabilityRowDelay);
    body.appendChild(stabilityRow);

    const stabilityDistributionHost = document.createElement("div");
    stabilityDistributionHost.className = "h-full";
    stabilityRow.appendChild(stabilityDistributionHost);
    this._stabilityDistributionRoot = createRoot(stabilityDistributionHost);
    this._stabilityDistributionRoot.render(
      React.createElement(StabilityDistributionChart, {
        cards: cards as any,
        states,
        enableAnimations: animationsEnabled,
      }),
    );

    const forgettingCurveHost = document.createElement("div");
    forgettingCurveHost.className = "h-full";
    stabilityRow.appendChild(forgettingCurveHost);
    this._forgettingCurveRoot = createRoot(forgettingCurveHost);
    this._forgettingCurveRoot.render(
      React.createElement(ForgettingCurveChart, {
        cards,
        states,
        reviewLog,
        scheduler: this.plugin.settings?.scheduler,
        nowMs: now,
        enableAnimations: animationsEnabled,
      }),
    );

    // Daily stats table card
    const statsCard = document.createElement("div");
    statsCard.className = "card sprout-ana-card p-4 flex flex-col gap-3";
    applyAos(statsCard, statsCardDelay);
    statsCard.style.marginTop = "10px";
    body.appendChild(statsCard);

    const statsTitle = document.createElement("div");
    statsTitle.className = "bc text-xl font-semibold tracking-tight";
    statsTitle.textContent = "Daily stats";
    statsCard.appendChild(statsTitle);

    // IMPORTANT: ensure `.bc` is present on all scoped utility targets.
    const statsBody = statsCard.createDiv({ cls: "bc text-sm sprout-analytics-table-wrap" });
    const table = statsBody.createEl("table", { cls: "bc table w-full text-sm sprout-changelog-table" });
    const thead = table.createEl("thead", { cls: "bc" });
    const headRow = thead.createEl("tr", { cls: "bc text-left border-b border-border" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Date" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Cards due" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Cards studied" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Study time" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Time per card" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Passed (%)" });
    headRow.createEl("th", { cls: "bc font-medium sprout-changelog-cell", text: "Failed (%)" });
    const tbody = table.createEl("tbody", { cls: "bc" });

    // Build per-day rating counts
    const ratingsByDay = new Map<number, { again: number; hard: number; good: number; easy: number }>();
    for (const ev of reviewEvents) {
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const idx = localDayIndex(at, timezone);
      const row = ratingsByDay.get(idx) ?? { again: 0, hard: 0, good: 0, easy: 0 };
      const r = String((ev as any).result || "");
      if (r === "again" || r === "hard" || r === "good" || r === "easy") {
        (row as any)[r] += 1;
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

    let pageSize = 25;
    let currentPage = 0;

    // Bottom controls need summary declared before first renderTable() call.
    const bottom = document.createElement("div");
    bottom.className = "bc flex flex-row flex-wrap items-center gap-2";
    bottom.style.marginTop = "10px";
    statsCard.appendChild(bottom);

    const summaryWrap = document.createElement("div");
    summaryWrap.className = "bc flex flex-col gap-1";
    const summary = document.createElement("div");
    summary.className = "bc text-sm text-muted-foreground";
    summary.textContent = "";
    summaryWrap.appendChild(summary);
    bottom.appendChild(summaryWrap);

    const center = document.createElement("div");
    center.className = "bc flex items-center justify-center";
    center.style.marginLeft = "auto";
    center.style.marginRight = "auto";
    bottom.appendChild(center);

    const right = document.createElement("div");
    right.className = "bc flex flex-row flex-wrap items-center gap-2";
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
      const headers = ["Date", "Cards due", "Cards done", "Study time", "Time per card", "Passed (%)", "Failed (%)"];
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
    exportBtn.className = "bc inline-flex items-center gap-1 font-semibold text-muted-foreground cursor-pointer";
    exportBtn.style.setProperty("background", "transparent", "important");
    exportBtn.style.setProperty("border", "none", "important");
    exportBtn.style.setProperty("box-shadow", "none", "important");
    exportBtn.style.setProperty("padding", "0", "important");
    exportBtn.style.setProperty("color", "var(--text-muted)", "important");
    exportBtn.style.setProperty("font-size", "12.25px", "important");
    const exportIcon = document.createElement("span");
    exportIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-3";
    setIcon(exportIcon, "download");
    exportIcon.style.setProperty("transform", "scale(0.9)", "important");
    const exportText = document.createElement("span");
    exportText.textContent = "Export as CSV";
    exportBtn.appendChild(exportIcon);
    exportBtn.appendChild(exportText);
    exportBtn.addEventListener("mouseenter", () => {
      exportBtn.style.setProperty("color", "var(--foreground)", "important");
    });
    exportBtn.addEventListener("mouseleave", () => {
      exportBtn.style.setProperty("color", "var(--text-muted)", "important");
    });
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
        summary.textContent = "No daily stats available";
      } else {
        summary.textContent = `Showing ${start + 1}-${end} of ${allRows.length} day${allRows.length === 1 ? "" : "s"}`;
      }

      for (let i = start; i < end; i += 1) {
        const row = allRows[i];

        const tr = tbody.createEl("tr", { cls: "bc align-top border-b border-border/50 last:border-0" });
        // Cascade AOS delay row by row (force visible after re-render)
        applyAos(tr, rowBaseDelay + rowStep * (i - start + 2));
        if (animationsEnabled) {
          tr.classList.add("aos-init", "aos-animate");
          // Fallback: if AOS doesn't initialize, force the row visible
          window.setTimeout(() => {
            if (!tr.isConnected) return;
            const style = getComputedStyle(tr);
            if (style.opacity === "0") {
              tr.style.opacity = "1";
              tr.style.transform = "none";
              tr.style.transition = "none";
            }
          }, 350);
        }
        tr.createEl("td", { cls: "bc sprout-changelog-cell whitespace-nowrap", text: row.dateStr });
        tr.createEl("td", { cls: "bc sprout-changelog-cell", text: String(row.due) });
        tr.createEl("td", { cls: "bc sprout-changelog-cell", text: String(row.reviews) });

        // Study time (hh:mm)
        tr.createEl("td", { cls: "bc sprout-changelog-cell", text: formatStudyTime(row.minutes) });

        // Time per card (mm:ss)
        tr.createEl("td", { cls: "bc sprout-changelog-cell", text: formatTimePerCard(row.secondsPerCard) });

        tr.createEl("td", {
          cls: "bc sprout-changelog-cell",
          text: `${row.passed} (${row.reviews > 0 ? row.passedPct.toFixed(0) : "0"}%)`,
        });
        tr.createEl("td", {
          cls: "bc sprout-changelog-cell",
          text: `${row.failed} (${row.reviews > 0 ? row.failedPct.toFixed(0) : "0"}%)`,
        });
      }

      if (animationsEnabled) refreshAOS();
    };

    const rowsLbl = right.createDiv({ cls: "bc text-sm text-muted-foreground" });
    rowsLbl.textContent = "Rows";

    const rowsWrap = right.createDiv({ cls: "bc sprout relative inline-flex" });
    const rowsBtn = rowsWrap.createEl("button", { cls: "bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2" });
    rowsBtn.setAttribute("aria-haspopup", "menu");
    rowsBtn.setAttribute("aria-expanded", "false");

    const rowsBtnText = document.createElement("span");
    rowsBtnText.className = "bc truncate";
    rowsBtnText.textContent = String(pageSize);
    rowsBtn.appendChild(rowsBtnText);

    const rowsPopover = document.createElement("div");
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    rowsPopover.className = "bc";
    rowsPopover.setAttribute("aria-hidden", "true");
    rowsPopover.style.setProperty("position", "fixed", "important");
    rowsPopover.style.setProperty("z-index", "999999", "important");
    rowsPopover.style.setProperty("display", "none", "important");
    rowsPopover.style.setProperty("pointer-events", "auto", "important");
    sproutWrapper.appendChild(rowsPopover);

    const rowsPanel = document.createElement("div");
    rowsPanel.className = "bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1";
    rowsPanel.style.setProperty("pointer-events", "auto", "important");
    rowsPopover.appendChild(rowsPanel);

    const rowsMenu = document.createElement("div");
    rowsMenu.setAttribute("role", "menu");
    rowsMenu.className = "bc flex flex-col";
    rowsPanel.appendChild(rowsMenu);

    let rowsOpen = false;
    const pageSizeOptions = ["100", "50", "25", "10", "5"];

    const closeRowsMenu = () => {
      rowsBtn.setAttribute("aria-expanded", "false");
      rowsPopover.setAttribute("aria-hidden", "true");
      rowsPopover.style.setProperty("display", "none", "important");
      try {
        sproutWrapper.remove();
      } catch {}
      rowsOpen = false;
    };

    const placeRowsMenu = () => {
      const r = rowsBtn.getBoundingClientRect();
      const margin = 8;
      const width = 140;
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      const panelRect = rowsPanel.getBoundingClientRect();
      const top = Math.max(margin, r.top - panelRect.height - 6);
      rowsPopover.style.left = `${left}px`;
      rowsPopover.style.top = `${top}px`;
      rowsPopover.style.width = `${width}px`;
    };

    const buildRowsOptions = () => {
      while (rowsMenu.firstChild) rowsMenu.removeChild(rowsMenu.firstChild);

      for (const opt of pageSizeOptions) {
        const item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", opt === String(pageSize) ? "true" : "false");
        item.tabIndex = 0;
        item.className =
          "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

        const dotWrap = document.createElement("div");
        dotWrap.className = "bc size-4 flex items-center justify-center";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible";
        dot.setAttribute("aria-hidden", "true");
        dotWrap.appendChild(dot);

        const txt = document.createElement("span");
        txt.className = "bc";
        txt.textContent = opt;
        item.appendChild(txt);

        const activate = () => {
          pageSize = Math.max(1, Math.floor(Number(opt) || 25));
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
      rowsPopover.setAttribute("aria-hidden", "false");
      rowsPopover.style.setProperty("display", "block", "important");
      if (!sproutWrapper.parentElement) document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => placeRowsMenu());

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (rowsWrap.contains(t) || rowsPopover.contains(t)) return;
        closeRowsMenu();
      };

      window.setTimeout(() => {
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

    const pagerHost = right.createDiv({ cls: "bc flex items-center" });

    const renderPager = () => {
      while (pagerHost.firstChild) pagerHost.removeChild(pagerHost.firstChild);

      const totalRows = allRows.length;
      const size = Math.max(1, Math.floor(Number(pageSize) || 25));
      const totalPages = Math.max(1, Math.ceil(totalRows / size));

      if (!Number.isFinite(currentPage) || currentPage < 0) currentPage = 0;
      if (currentPage > totalPages - 1) currentPage = totalPages - 1;

      if (totalRows <= size) {
        const small = document.createElement("div");
        small.className = "bc text-sm text-muted-foreground";
        small.textContent = totalRows === 0 ? "Page 0 / 0" : `Page 1 / 1`;
        pagerHost.appendChild(small);
        return;
      }

      const nav = document.createElement("nav");
      nav.setAttribute("role", "navigation");
      nav.setAttribute("data-tooltip", "Pagination");
      nav.className = "bc flex items-center gap-2";
      pagerHost.appendChild(nav);

      const mkBtn = (label: string, tooltip: string, disabled: boolean, active: boolean, onClick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `bc ${active ? "btn" : "btn-outline"} h-8 px-2`;
        b.textContent = label;
        b.setAttribute("data-tooltip", tooltip);
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
        b.className = "bc btn-outline h-8 px-2";
        b.textContent = "…";
        b.setAttribute("data-tooltip", `Page ${targetPage}`);
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
      prev.className = "bc btn-outline h-8 px-2";
      prev.setAttribute("data-tooltip", "Previous page");
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
      prevIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(prevIcon, "chevron-left");
      prev.appendChild(prevIcon);

      const prevTxt = document.createElement("span");
      prevTxt.className = "bc ml-1";
      prevTxt.textContent = "Prev";
      prev.appendChild(prevTxt);
      nav.appendChild(prev);

      if (start > 1) {
        nav.appendChild(
          mkBtn("1", "Page 1", false, current === 1, () => {
            currentPage = 0;
            renderTable();
            renderPager();
          }),
        );
      }

      for (let p = start; p <= end; p++) {
        nav.appendChild(
          mkBtn(String(p), `Page ${p}`, false, p === current, () => {
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
          mkBtn(String(totalPagesLocal), `Page ${totalPagesLocal}`, false, current === totalPagesLocal, () => {
            currentPage = totalPagesLocal - 1;
            renderTable();
            renderPager();
          }),
        );
      }

      const next = document.createElement("button");
      next.type = "button";
      next.className = "bc btn-outline h-8 px-2";
      next.setAttribute("data-tooltip", "Next page");
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
      nextTxt.className = "bc mr-1";
      nextTxt.textContent = "Next";
      next.appendChild(nextTxt);

      const nextIcon = document.createElement("span");
      nextIcon.setAttribute("aria-hidden", "true");
      nextIcon.className = "bc inline-flex items-center justify-center [&_svg]:size-4";
      setIcon(nextIcon, "chevron-right");
      next.appendChild(nextIcon);

      nav.appendChild(next);
    };

    // Initial render
    renderTable();
    renderPager();

    if (animationsEnabled) refreshAOS();
  }
}
