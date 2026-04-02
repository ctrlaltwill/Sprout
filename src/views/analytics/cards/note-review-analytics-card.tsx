/**
 * @file src/views/analytics/cards/note-review-analytics-card.tsx
 * @summary Module for note review analytics card.
 *
 * @exports
 *  - NoteReviewAnalyticsCard
 */

import * as React from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "../chart-axis-utils";
import { useAnalyticsPopoverZIndex } from "../filter-styles";
import { MS_DAY } from "../../../platform/core/constants";

type NoteReviewEventLike = {
  kind?: string;
  at?: number;
  mode?: "scheduled" | "practice";
  action?: "pass" | "fail" | "read" | "bury" | "suspend" | "skip";
};

type DayRow = {
  dayIndex: number;
  label: string;
  date: string;
  scheduled: number;
  reviewed: number;
  scheduledRemaining: number;
};

function makeDatePartsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function localDayIndex(ts: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(new Date(ts));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}

function formatDayLabel(dayIdx: number, timeZone: string): string {
  const date = new Date(dayIdx * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
}

function formatDayTitle(dayIdx: number, timeZone: string): string {
  const date = new Date(dayIdx * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" });
}

function InfoIcon(props: { text: string }) {
  return (
    <span className="inline-flex items-center text-muted-foreground" data-tooltip={props.text} data-tooltip-position="right">
      <svg className="svg-icon lucide-info" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}

function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      className={`svg-icon learnkit-ana-chevron${props.open ? " is-open" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 4 14 12 6 20" />
    </svg>
  );
}

function TooltipContent(props: { active?: boolean; payload?: Array<{ payload?: unknown }> }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const datum = props.payload[0]?.payload as DayRow | undefined;
  if (!datum) return null;
  return (
    <div className="learnkit-data-tooltip-surface">
      <div className="text-sm font-medium text-background">{datum.date}</div>
      <div className="text-background">Scheduled: {datum.scheduled}</div>
      <div className="text-background">Reviewed: {datum.reviewed}</div>
    </div>
  );
}

function roundUpToNearest10(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 10) * 10;
}

function buildYAxisTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0];
  const mid = Math.round(maxValue / 2);
  const ticks = [0, mid, maxValue];
  return ticks.filter((v, i, a) => i === 0 || v !== a[i - 1]);
}

function summarize(
  events: NoteReviewEventLike[],
  durationDays: number,
  includePractice: boolean,
  formatter: Intl.DateTimeFormat,
  tz: string,
  todayIdx: number,
): DayRow[] {
  const startIdx = todayIdx - (durationDays - 1);
  const map = new Map<number, DayRow>();

  for (let i = 0; i < durationDays; i += 1) {
    const idx = startIdx + i;
    map.set(idx, {
      dayIndex: idx,
      label: formatDayLabel(idx, tz),
      date: formatDayTitle(idx, tz),
      scheduled: 0,
      reviewed: 0,
      scheduledRemaining: 0,
    });
  }

  for (const ev of events) {
    if (!ev || ev.kind !== "note-review" || !Number.isFinite(ev.at)) continue;
    const mode = ev.mode === "practice" ? "practice" : "scheduled";
    if (!includePractice && mode === "practice") continue;
    const idx = localDayIndex(Number(ev.at), formatter);
    const bucket = map.get(idx);
    if (!bucket) continue;
    if (mode === "scheduled") bucket.scheduled += 1;
    const action = String(ev.action || "");
    if (action === "pass" || action === "read") bucket.reviewed += 1;
  }

  const rows = Array.from(map.values());
  for (const row of rows) {
    row.scheduledRemaining = Math.max(0, row.scheduled - row.reviewed);
  }
  return rows;
}

export function NoteReviewAnalyticsCard(props: {
  events: NoteReviewEventLike[];
  includePracticeDefault: boolean;
  timezone?: string;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const [durationDays, setDurationDays] = React.useState(30);
  const [includePractice, setIncludePractice] = React.useState<boolean>(props.includePracticeDefault);
  const [open, setOpen] = React.useState(false);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  const todayIdx = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
  const startIdx = todayIdx - (durationDays - 1);

  React.useEffect(() => {
    setIncludePractice(props.includePracticeDefault);
  }, [props.includePracticeDefault]);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target || !wrapRef.current) return;
      if (!wrapRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [open]);

  const toggleDurationOpen = React.useCallback(() => {
    setDurationOpen((value) => !value);
  }, []);

  const onDurationKey = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setDurationOpen((value) => !value);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const placePopover = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
      popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const data = React.useMemo(
    () => summarize(props.events, durationDays, includePractice, formatter, tz, todayIdx),
    [props.events, durationDays, includePractice, formatter, tz, todayIdx],
  );

  const xTicks = React.useMemo(() => {
    const endIdx = startIdx + durationDays - 1;
    return createXAxisTicks(startIdx, endIdx, todayIdx);
  }, [startIdx, durationDays, todayIdx]);

  const xTickFormatter = (value: number) =>
    formatAxisLabel(value, todayIdx, (idx) => formatDayLabel(idx, tz));

  const yMax = React.useMemo(() => {
    const maxValue = data.reduce(
      (max, row) => Math.max(max, row.reviewed + row.scheduledRemaining),
      0,
    );
    return roundUpToNearest10(maxValue);
  }, [data]);
  const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);

  const durationOptions = React.useMemo(() => [7, 30, 90], []);

  return (
    <div className="card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="font-semibold lk-home-section-title">Note review activity</div>
            <InfoIcon text="Reviewed progress vs scheduled reviews over time." />
          </div>
          <div className="text-xs text-muted-foreground">Daily review progress</div>
        </div>
        <div ref={wrapRef} className="relative inline-flex">
          <button
            type="button"
            id="learnkit-note-review-filter-trigger"
            className="learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-label="Filter"
            data-tooltip-position="top"
            onClick={() => setOpen((v) => !v)}
          >
            <svg className="svg-icon lucide-filter text-foreground" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
            </svg>
            <span>Filter</span>
          </button>
          {open ? (
            <div
              ref={popoverRef}
              className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm"
              role="listbox"
              aria-label="Note review filters"
            >
              <div className="p-1">
                <div
                  className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  role="button"
                  tabIndex={0}
                  aria-expanded={durationOpen ? "true" : "false"}
                  aria-label="Duration"
                  data-tooltip-position="top"
                  onClick={toggleDurationOpen}
                  onKeyDown={onDurationKey}
                >
                  <span>Duration</span>
                  <ChevronIcon open={durationOpen} />
                </div>
                {durationOpen ? (
                  <div role="menu" aria-orientation="vertical" className="flex flex-col">
                    {durationOptions.map((value) => (
                      <div
                        key={value}
                        role="menuitemradio"
                        aria-checked={durationDays === value ? "true" : "false"}
                        tabIndex={0}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                        onClick={() => setDurationDays(value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setDurationDays(value);
                          }
                        }}
                      >
                        <div className="size-4 flex items-center justify-center">
                          <div
                            className="size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                            aria-hidden="true"
                          />
                        </div>
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="h-px bg-border my-1" role="separator" />
                <label className="px-2 py-1.5 inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={includePractice} onChange={(event) => setIncludePractice(event.currentTarget.checked)} />
                  <span>Include practice</span>
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground">No note review analytics events yet.</div>
      ) : (
        <>
          <div className="w-full flex-1 learnkit-analytics-chart">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
                <XAxis
                  dataKey="dayIndex"
                  type="number"
                  domain={[startIdx, todayIdx]}
                  ticks={xTicks}
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  domain={[0, yMax || "auto"]}
                  ticks={yTicks}
                  tick={{ fontSize: 11 }}
                  width={30}
                  allowDecimals={false}
                />
                <Tooltip content={<TooltipContent />} cursor={{ fill: "var(--background-modifier-hover)", opacity: 0.5 }} />
                <Bar dataKey="reviewed" stackId="a" name="Reviewed" fill="var(--chart-accent-2)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="scheduledRemaining" stackId="a" name="Scheduled" fill="var(--chart-accent-4)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-chart-legend">
            <div className="inline-flex items-center gap-2"><span className="inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square" style={{ ["--learnkit-legend-color" as string]: "var(--chart-accent-2)" }} />Reviewed</div>
            <div className="inline-flex items-center gap-2"><span className="inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square" style={{ ["--learnkit-legend-color" as string]: "var(--chart-accent-4)" }} />Scheduled</div>
          </div>
        </>
      )}
    </div>
  );
}
