import * as React from "react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { useAnalyticsPopoverZIndex } from "./filterStyles";

function InfoIcon(props: { text: string }) {
  return (
    <span
      className="inline-flex items-center text-muted-foreground"
      data-tooltip={props.text}
    >
      <svg
        className="svg-icon lucide-info"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}

const MS_DAY = 24 * 60 * 60 * 1000;
const GREEN_CURRENT = "#2f6f4e";

type ReviewEvent = {
  kind?: string;
  at?: number;
  cardId?: string;
  cardType?: string;
  result?: string;
  msToAnswer?: number;
  cardStateAtReview?: string;
  intervalDays?: number;
};

type ProfileCard = {
  id: string;
  type?: string | null;
  sourceNotePath?: string | null;
  groups?: string[] | null;
  due?: number | null;
  stage?: string | null;
  suspended?: boolean | null;
};

type Filters = {
  deckId?: string | null;
  groupPath?: string | null;
};

type CardState = {
  stage?: string;
  scheduledDays?: number;
};

type ProfileDatum = {
  metric: string;
  current: number;
  note?: string;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="bc svg-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        display: "inline-flex",
        transform: `${open ? "rotate(90deg)" : "rotate(0deg)"} scale(0.7)`,
      }}
      aria-hidden="true"
    >
      <polyline points="6 4 14 12 6 20" />
    </svg>
  );
}

function useCloseOnOutsideClick(
  open: boolean,
  wrapRef: React.RefObject<HTMLDivElement | null>,
  popoverRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [open, wrapRef, popoverRef, onClose]);
}

function usePopoverPlacement(
  open: boolean,
  wrapRef: React.RefObject<HTMLDivElement | null>,
  popoverRef: React.RefObject<HTMLDivElement | null>,
) {
  React.useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.style.position = "absolute";
      popover.style.top = "calc(100% + 6px)";
      popover.style.left = "0px";
      popover.style.right = "auto";
    };
    place();
    window.addEventListener("resize", place, true);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place, true);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, wrapRef, popoverRef]);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function std(values: number[]) {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (!sorted[base + 1]) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function makeDatePartsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getDateParts(ts: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(new Date(ts));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  return { year, month, day };
}

function localDayIndex(ts: number, formatter: Intl.DateTimeFormat) {
  const { year, month, day } = getDateParts(ts, formatter);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-4 * z));
}

function RadarTooltip(props: { active?: boolean; payload?: any[] }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const datum = props.payload[0]?.payload as ProfileDatum | undefined;
  if (!datum) return null;
  const description = getMetricDescription(datum.metric);
  if (!description) return null;
  return (
    <div className="bc rounded-lg bg-foreground text-background px-3 py-2 text-xs">
      <div className="bc text-background">{description}</div>
    </div>
  );
}

const getMetricDescription = (metric: string): string => {
  if (metric === "Volume") {
    return "Median daily reviews; higher totals keep your study habit steady.";
  }
  if (metric.startsWith("Efficiency")) {
    return "Speed per review: more good/easy clicks and snappy answers raise it.";
  }
  if (metric === "Retention") {
    return "Reliability of recall; higher values mean fewer weak or failed answers.";
  }
  if (metric === "Stability") {
    return "Captures interval swings and mature-card trends to show spacing steadiness.";
  }
  if (metric === "Backlog") {
    return "Pressure from due/overdue cards versus your throughput capacity.";
  }
  if (metric === "Consistency") {
    return "Portion of days studied plus how evenly those sessions are spread.";
  }
  return "";
};

export function StudyProfileChart(props: {
  events: ReviewEvent[];
  cards: ProfileCard[];
  states?: Record<string, CardState>;
  nowMs: number;
  timezone?: string;
  filters?: Filters;
  days?: number;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const defaultDuration = props.days ?? 30;

  const [durationDays, setDurationDays] = React.useState(defaultDuration);
  const [windowDays, setWindowDays] = React.useState(defaultDuration);
  const [open, setOpen] = React.useState(false);
  const [durationOpen, setDurationOpen] = React.useState(false);

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  const toggleDurationOpen = () => setDurationOpen((prev) => !prev);
  const onDurationKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleDurationOpen();
    }
  };

  React.useEffect(() => {
    setDurationDays(defaultDuration);
    setWindowDays(defaultDuration);
  }, [defaultDuration]);

  const durationOptions = React.useMemo(() => [1, 7, 30, 90, 0], []);
  const resetFilters = () => {
    setDurationDays(defaultDuration);
    setWindowDays(defaultDuration);
    setDurationOpen(false);
    setOpen(false);
  };

  const todayIndex = React.useMemo(() => localDayIndex(props.nowMs, formatter), [props.nowMs, formatter]);

  const filteredEvents = React.useMemo(() => {
    return (props.events ?? []).filter((ev) => {
      if (!ev || ev.kind !== "review") return false;
      return true;
    });
  }, [props.events]);

  const filteredCards = React.useMemo(() => {
    const cards = props.cards ?? [];
    const deckId = props.filters?.deckId ? String(props.filters.deckId).trim() : "";
    const groupPath = props.filters?.groupPath ? String(props.filters.groupPath).trim() : "";
    return cards.filter((card) => {
      if (!card) return false;

      if (deckId) {
        const notePath = String(card.sourceNotePath ?? "").trim();
        const normalizedDeckId = deckId.replace(/\/+$/, "");
        const matchesNote = notePath === normalizedDeckId;
        const matchesFolder = normalizedDeckId && notePath.startsWith(`${normalizedDeckId}/`);
        if (!notePath || (!matchesNote && !matchesFolder)) return false;
      }

      if (groupPath) {
        const groups = Array.isArray(card.groups) ? card.groups.map((g) => String(g ?? "").trim()) : [];
        if (!groups.some((g) => g && (g === groupPath || g.startsWith(`${groupPath}/`)))) return false;
      }

      return true;
    });
  }, [props.cards, props.filters]);

  useCloseOnOutsideClick(open, wrapRef, popoverRef, () => setOpen(false));
  usePopoverPlacement(open, wrapRef, popoverRef);

  const earliestEventDay = React.useMemo(() => {
    let min = todayIndex;
    for (const ev of filteredEvents) {
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const dayIndex = localDayIndex(at, formatter);
      if (dayIndex < min) min = dayIndex;
    }
    return min;
  }, [filteredEvents, formatter, todayIndex]);

  React.useEffect(() => {
    if (durationDays === 0) {
      const span = Math.max(1, todayIndex - earliestEventDay + 1);
      setWindowDays(span);
    } else {
      setWindowDays(durationDays);
    }
  }, [durationDays, todayIndex, earliestEventDay]);

  const currentStart = todayIndex - (windowDays - 1);

  const buildWindowStats = React.useCallback(
    (startIndex: number, endIndex: number) => {
      const days = endIndex - startIndex + 1;
      const dailyReviews = Array.from({ length: days }, () => 0);
      const dailyMs = Array.from({ length: days }, () => 0);
      const windowEvents: ReviewEvent[] = [];

      for (const ev of filteredEvents) {
        const at = Number(ev.at);
        if (!Number.isFinite(at)) continue;
        const dayIndex = localDayIndex(at, formatter);
        if (dayIndex < startIndex || dayIndex > endIndex) continue;
        const offset = dayIndex - startIndex;
        dailyReviews[offset] += 1;
        const ms = Number(ev.msToAnswer);
        if (Number.isFinite(ms) && ms > 0) dailyMs[offset] += ms;
        windowEvents.push(ev);
      }

      return { dailyReviews, dailyMs, windowEvents, days };
    },
    [filteredEvents, formatter],
  );

  const refValues = React.useMemo(() => {
    const refStart = todayIndex - 179;
    const refEnd = todayIndex;
    const dailyReviews = new Map<number, number>();
    const dailyMs = new Map<number, number>();

    for (const ev of filteredEvents) {
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const dayIndex = localDayIndex(at, formatter);
      if (dayIndex < refStart || dayIndex > refEnd) continue;
      dailyReviews.set(dayIndex, (dailyReviews.get(dayIndex) ?? 0) + 1);
      const ms = Number(ev.msToAnswer);
      if (Number.isFinite(ms) && ms > 0) dailyMs.set(dayIndex, (dailyMs.get(dayIndex) ?? 0) + ms);
    }

    const reviewCounts = Array.from(dailyReviews.values());
    const volRef = Math.max(quantile(reviewCounts, 0.9), 300);

    const effSamples: number[] = [];
    for (const [day, count] of dailyReviews.entries()) {
      const ms = dailyMs.get(day) ?? 0;
      if (ms <= 0) continue;
      effSamples.push(count / (ms / 60000));
    }
    const effRef = Math.max(quantile(effSamples, 0.9), 30);
    return { volRef, effRef, hasEffSamples: effSamples.length > 0 };
  }, [filteredEvents, formatter, todayIndex]);

  const computeMetrics = React.useCallback(
    (startIndex: number, endIndex: number) => {
      const { dailyReviews, dailyMs, windowEvents, days } = buildWindowStats(startIndex, endIndex);
      const totalReviews = dailyReviews.reduce((sum, v) => sum + v, 0);
      const totalMs = dailyMs.reduce((sum, v) => sum + v, 0);

      const volRaw = median(dailyReviews);
      const vol01 = Math.max(0.05, clamp01(Math.log1p(volRaw) / Math.log1p(refValues.volRef)));

      let effRaw = null as number | null;
      if (totalMs > 0) effRaw = totalReviews / (totalMs / 60000);
      const eff01 =
        effRaw && Number.isFinite(effRaw) ? clamp01(Math.log1p(effRaw) / Math.log1p(refValues.effRef)) : 0.5;
      const efficiencyNote = !effRaw ? "Using proxy (no time data)" : undefined;

      const again = windowEvents.filter((ev) => String(ev.result ?? "") === "again").length;
      const againRate = totalReviews > 0 ? again / totalReviews : 1;
      const ret01 = clamp01(1 - againRate);

      const intervals: number[] = [];
      let matureCount = 0;
      for (const ev of windowEvents) {
        const state = props.states?.[String(ev.cardId ?? "")];
        const stage = String(ev.cardStateAtReview ?? state?.stage ?? "");
        if (stage === "mature" || stage === "review") matureCount += 1;
        const interval = Number(ev.intervalDays) || Number(state?.scheduledDays) || 0;
        intervals.push(interval);
      }

      const matureFrac = totalReviews > 0 ? matureCount / totalReviews : 0;
      const medianInterval = median(intervals);
      const shortIntervalFrac = intervals.length ? intervals.filter((v) => v < 7).length / intervals.length : 1;
      const normInterval = clamp01(Math.log1p(medianInterval) / Math.log1p(180));
      const stab01 = clamp01(0.4 * matureFrac + 0.4 * normInterval + 0.2 * (1 - shortIntervalFrac));

      const activeDays = dailyReviews.filter((v) => v > 0).length;
      const activeDaysFrac = days > 0 ? activeDays / days : 0;
      const avg = mean(dailyReviews);
      const cv = avg > 0 ? std(dailyReviews) / avg : 0;
      const cvNorm = clamp01(cv / 2);
      const cons01 = clamp01(0.6 * activeDaysFrac + 0.4 * (1 - cvNorm));

      return {
        vol: vol01 * 100,
        eff: eff01 * 100,
        effNote: efficiencyNote,
        ret: ret01 * 100,
        stab: stab01 * 100,
        cons: cons01 * 100,
        totalReviews,
        medianDaily: volRaw,
      };
    },
    [buildWindowStats, refValues, props.states],
  );

  const backlogMetric = React.useMemo(() => {
    let dueToday = 0;
    let overdue = 0;
    let forecast7d = 0;

    for (const card of filteredCards) {
      if (!card) continue;
      if (card.suspended || String(card.stage ?? "") === "suspended") continue;

      const due = Number(card.due);
      if (!Number.isFinite(due) || due <= 0) continue;
      const dayIndex = localDayIndex(due, formatter);
      if (dayIndex < todayIndex) overdue += 1;
      if (dayIndex === todayIndex) dueToday += 1;
      if (dayIndex >= todayIndex && dayIndex <= todayIndex + 6) forecast7d += 1;
    }

    return { dueToday, overdue, forecast7d };
  }, [filteredCards, formatter, todayIndex]);

  const currentMetrics = React.useMemo(() => computeMetrics(currentStart, todayIndex), [
    computeMetrics,
    currentStart,
    todayIndex,
  ]);

  const backlogScore = React.useMemo(() => {
    const medianDaily = currentMetrics.medianDaily || 0;
    const pressure = backlogMetric.forecast7d / Math.max(7 * Math.max(medianDaily, 1), 1);
    const overdueFrac = backlogMetric.overdue / Math.max(backlogMetric.dueToday + backlogMetric.overdue, 1);
    const backRaw = 1 - clamp01(0.5 * overdueFrac + 0.5 * sigmoid(pressure - 1));
    return backRaw * 100;
  }, [backlogMetric, currentMetrics.medianDaily]);

  const efficiencyLabel = currentMetrics.effNote ? "Efficiency (proxy)" : "Efficiency";
  const windowLabel = windowDays === 1 ? "Last 1 day" : `Last ${windowDays} days`;

  const radarData: ProfileDatum[] = [
    { metric: "Volume", current: currentMetrics.vol },
    {
      metric: efficiencyLabel,
      current: currentMetrics.eff,
      note: currentMetrics.effNote,
    },
    { metric: "Retention", current: currentMetrics.ret },
    { metric: "Stability", current: currentMetrics.stab },
    { metric: "Backlog", current: backlogScore },
    { metric: "Consistency", current: currentMetrics.cons },
  ];

  const radarChartData = radarData.map((datum) => ({
    ...datum,
    current: Math.max(1, datum.current),
  }));

  const studyCard = (
    <div
      className="card sprout-ana-card p-4 flex flex-col gap-3"
      style={{ minHeight: "360px", overflow: "visible", flex: 1, width: "100%" }}
    >
      <div className="bc flex items-start justify-between gap-2">
        <div>
          <div className="bc flex items-center gap-1">
            <div className="bc font-semibold">Learner profile</div>
            <InfoIcon text="Radar summary of your study habits, workload, and backlog pressure." />
          </div>
          <div className="bc text-xs text-muted-foreground">{windowLabel}</div>
        </div>

        <div ref={wrapRef} className="bc relative inline-flex">
          <button
            type="button"
            id="sprout-profile-filter-trigger"
            className="btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-controls="sprout-profile-filter-listbox"
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg
              className="bc svg-icon lucide-filter"
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--text-normal)" }}
            >
              <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
            </svg>
            <span>Filter</span>
          </button>

          {open ? (
            <div
              id="sprout-profile-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className="rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col"
              style={{ position: "absolute", top: "calc(100% + 6px)", zIndex: 1000, minWidth: "250px" }}
            >
              <div className="bc p-1">
                <div
                  className="bc flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  role="button"
                  tabIndex={0}
                  aria-expanded={durationOpen ? "true" : "false"}
                  onClick={toggleDurationOpen}
                  onKeyDown={onDurationKey}
                >
                  <span>Duration</span>
                  <ChevronIcon open={durationOpen} />
                </div>

                {durationOpen ? (
                  <div role="menu" aria-orientation="vertical" className="bc flex flex-col">
                    {durationOptions.map((opt) => {
                      const selected = durationDays === opt;
                      const label = opt === 0 ? "All time" : `${opt} days`;
                      return (
                        <div
                          key={opt}
                          role="menuitemradio"
                          aria-checked={selected ? "true" : "false"}
                          tabIndex={0}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => setDurationDays(opt)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setDurationDays(opt);
                            }
                          }}
                        >
                          <div className="bc size-4 flex items-center justify-center">
                            <div
                              className="bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                              aria-hidden="true"
                            />
                          </div>
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="bc h-px bg-border my-2" role="separator" />

                <div className="bc px-2 pb-2">
                  <div className="bc text-sm text-muted-foreground cursor-pointer px-2" onClick={resetFilters}>
                    Reset filters
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="bc w-full sprout-analytics-chart">
        <ResponsiveContainer width="100%" height={250}>
          <RadarChart data={radarChartData}>
            <PolarGrid gridType="circle" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
            <Tooltip content={<RadarTooltip />} />
            <Radar
              dataKey="current"
              stroke={GREEN_CURRENT}
              fill={GREEN_CURRENT}
              fillOpacity={0.35}
              dot={{ r: 4, fillOpacity: 1 }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const placeholderCard = (
    <div className="card sprout-ana-card p-4 flex flex-col gap-4" style={{ minHeight: "360px", flex: 1, width: "100%" }}>
      <div className="bc flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <div className="bc text-center">Expect richer visualizations and analytics in future releases.</div>
      </div>
    </div>
  );

  return (
    <div className="bc grid gap-4 lg:grid-cols-2 w-full">
      {studyCard}
      {placeholderCard}
    </div>
  );
}
