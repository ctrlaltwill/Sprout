import * as React from "react";
import { useAnalyticsPopoverZIndex } from "./filter-styles";

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

type ReviewLogEntry = {
  at?: number;
  kind?: string;
  msToAnswer?: number;
  cardType?: string;
  scope?: { key?: string; name?: string };
};

type Filters = {
  deckId?: string | null;
  groupPath?: string | null;
};

type HeatCell = {
  dayIndex: number;
  count: number;
  totalMs: number;
  isPadding: boolean;
  dateLabel: string;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={"svg-icon"}
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
    let skipNext = true;
    const onDocClick = (ev: MouseEvent) => {
      if (skipNext) {
        skipNext = false;
        return;
      }
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
  align: "left" | "right" = "left",
) {
  React.useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.style.position = "absolute";
      popover.style.top = "calc(100% + 6px)";
      if (align === "right") {
        popover.style.right = "0px";
        popover.style.left = "auto";
      } else {
        popover.style.left = "0px";
        popover.style.right = "auto";
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, wrapRef, popoverRef, align]);
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
  const utc = Date.UTC(year, month - 1, day);
  return Math.floor(utc / MS_DAY);
}

function formatDateLabel(dayIndex: number, timeZone: string) {
  const date = new Date(dayIndex * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
}

function formatDateTitle(dayIndex: number, timeZone: string) {
  const date = new Date(dayIndex * MS_DAY);
  return date.toLocaleDateString(undefined, {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildQuantiles(values: number[]) {
  if (!values.length) return [0, 0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}

function valueToLevel(value: number, quantiles: number[]) {
  if (value <= 0) return 0;
  if (value <= quantiles[0]) return 1;
  if (value <= quantiles[1]) return 2;
  if (value <= quantiles[2]) return 3;
  if (value <= quantiles[3]) return 4;
  return 5;
}

// Use CSS variables for chart accent colors
// Palette: 0 = border (empty), 1 = lightest, 2 = lighter, 3 = mid, 4 = dark, 5 = darkest (accent)
const palette = [
  "var(--background-modifier-border)", // 0: no activity
  "var(--chart-accent-4)",            // 1: lowest (lightest)
  "var(--chart-accent-3)",            // 2: light
  "var(--chart-accent-2)",            // 3: mid
  "var(--chart-accent-1)",            // 4: dark
  "var(--theme-accent)"               // 5: most (darkest)
];

export function ReviewCalendarHeatmap(props: {
  revlog: ReviewLogEntry[];
  timezone?: string;
  rangeDays?: number;
  filters?: Filters;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
  const [durationDays, setDurationDays] = React.useState(props.rangeDays ?? 365);
  const [open, setOpen] = React.useState(false);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState<{
    cell: HeatCell;
    x: number;
    y: number;
  } | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const chartWrapRef = React.useRef<HTMLDivElement | null>(null);
  const dropdownWrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, dropdownWrapRef);
  const toggleDurationOpen = () => setDurationOpen((prev) => !prev);
  const onDurationKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleDurationOpen();
    }
  };
  const durationOptions = React.useMemo(() => [7, 30, 90, 365, 0], []);
  const resetFilters = () => {
    setDurationDays(props.rangeDays ?? 365);
    setDurationOpen(false);
    setOpen(false);
  };
  React.useEffect(() => {
    setDurationDays(props.rangeDays ?? 365);
  }, [props.rangeDays]);

  const filteredEvents = React.useMemo(() => {
    return (props.revlog ?? []).filter((ev) => {
      if (!ev || ev.kind !== "review") return false;
      if (props.filters?.deckId || props.filters?.groupPath) {
        const key = String(ev.scope?.key ?? "");
        const name = String(ev.scope?.name ?? "");
        if (props.filters.deckId && props.filters.deckId !== key && props.filters.deckId !== name) return false;
        if (props.filters.groupPath && props.filters.groupPath !== key && props.filters.groupPath !== name) return false;
      }
      return true;
    });
  }, [props.revlog, props.filters]);

  useCloseOnOutsideClick(open, dropdownWrapRef, popoverRef, () => setOpen(false));
  usePopoverPlacement(open, dropdownWrapRef, popoverRef, "right");

  const rangeStartIndex = React.useMemo(() => {
    if (durationDays === 0) {
      const nowParts = getDateParts(Date.now(), formatter);
      const jan1 = Date.UTC(nowParts.year, 0, 1);
      return Math.floor(jan1 / MS_DAY);
    }
    return todayIndex - Math.max(1, durationDays) + 1;
  }, [durationDays, todayIndex, formatter]);

  const cells = React.useMemo(() => {
    const endIndex = todayIndex;
    const totalDays = Math.max(1, endIndex - rangeStartIndex + 1);
    const dayMap = new Map<number, { count: number; totalMs: number }>();

    for (const ev of filteredEvents) {
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const dayIndex = localDayIndex(at, formatter);
      if (dayIndex < rangeStartIndex || dayIndex > endIndex) continue;
      const entry = dayMap.get(dayIndex) ?? { count: 0, totalMs: 0 };
      entry.count += 1;
      const ms = Number(ev.msToAnswer);
      if (Number.isFinite(ms) && ms > 0) entry.totalMs += ms;
      dayMap.set(dayIndex, entry);
    }

    // Special layouts for 7 and 30 days
    if (durationDays === 7) {
      // 7 days: horizontal row, no padding
      const out: HeatCell[] = [];
      for (let i = 0; i < 7; i++) {
        const dayIndex = endIndex - 6 + i;
        const entry = dayMap.get(dayIndex) ?? { count: 0, totalMs: 0 };
        out.push({
          dayIndex,
          count: entry.count,
          totalMs: entry.totalMs,
          isPadding: false,
          dateLabel: formatDateTitle(dayIndex, tz),
        });
      }
      return out;
    } else if (durationDays === 30) {
      // 30 days: calendar grid (7 columns, 5 rows), align most recent day to correct weekday
      const out: HeatCell[] = [];
      const cols = 7;
      const rows = Math.ceil(30 / 7);
      // Find the weekday (0=Sunday, 1=Monday, ...) of the most recent day
      const lastDate = new Date((endIndex) * MS_DAY);
      let lastWeekday = lastDate.getDay();
      // Adjust so Monday=0, Sunday=6 for column index (Monday first)
      lastWeekday = (lastWeekday + 6) % 7;
      // The last cell in the grid should be at col=lastWeekday, row=rows-1
      // Fill backwards from there
      const grid = Array(rows * cols).fill(null);
      for (let i = 0; i < 30; i++) {
        // Position from the end
        const gridPos = rows * cols - 1 - ((30 - 1 - i) + (cols - 1 - lastWeekday));
        if (gridPos < 0) continue;
        const dayIndex = endIndex - 29 + i;
        const entry = dayMap.get(dayIndex) ?? { count: 0, totalMs: 0 };
        grid[gridPos] = {
          dayIndex,
          count: entry.count,
          totalMs: entry.totalMs,
          isPadding: false,
          dateLabel: formatDateTitle(dayIndex, tz),
        };
      }
      // Fill any empty cells as padding
      for (let i = 0; i < grid.length; i++) {
        if (!grid[i]) {
          grid[i] = {
            dayIndex: -1,
            count: 0,
            totalMs: 0,
            isPadding: true,
            dateLabel: "",
          };
        }
      }
      return grid;
    } else {
      // Default: calendar grid with padding
      const startDate = new Date(rangeStartIndex * MS_DAY);
      const startWeekday = startDate.getUTCDay();
      const weekStartsOn = 1;
      const padStart = (startWeekday - weekStartsOn + 7) % 7;
      const firstIndex = rangeStartIndex - padStart;
      const totalCells = Math.ceil((totalDays + padStart) / 7) * 7;

      const out: HeatCell[] = [];
      for (let i = 0; i < totalCells; i += 1) {
        const dayIndex = firstIndex + i;
        const entry = dayMap.get(dayIndex) ?? { count: 0, totalMs: 0 };
        const isPadding = dayIndex < rangeStartIndex || dayIndex > endIndex;
        out.push({
          dayIndex,
          count: entry.count,
          totalMs: entry.totalMs,
          isPadding,
          dateLabel: formatDateTitle(dayIndex, tz),
        });
      }
      return out;
    }
  }, [filteredEvents, formatter, rangeStartIndex, todayIndex, tz, durationDays]);

  const quantiles = React.useMemo(() => {
    const values = cells
      .filter((c) => !c.isPadding)
      .map((c) => c.count)
      .filter((v) => v > 0);
    return buildQuantiles(values);
  }, [cells]);

  let gridWidth = Math.ceil(cells.length / 7) * 16;
  let gridHeight = 7 * 16;
  if (durationDays === 7) {
    gridWidth = 7 * 16;
    gridHeight = 16;
  } else if (durationDays === 30) {
    gridWidth = 7 * 16;
    gridHeight = Math.ceil(30 / 7) * 16;
  }

  return (
    <div className={"bc card sprout-ana-card p-4 flex flex-col gap-3"} style={{ minHeight: "320px" }}>
      <div className={"bc flex items-start justify-between gap-2"}>
        <div className={"bc"}>
          <div className={"bc flex items-center gap-1"}>
            <div className={"bc font-semibold"}>Study heatmap</div>
            <InfoIcon text="Calendar view of daily review counts. Darker squares mean more reviews." />
          </div>
          <div className={"bc text-xs text-muted-foreground"}>Reviews per day</div>
        </div>
        <div ref={dropdownWrapRef} className={"bc relative inline-flex"}>
          <button
            id="sprout-heatmap-filter-trigger"
            type="button"
            className={"bc btn-outline h-7 px-3 text-sm inline-flex items-center gap-2"}
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-controls="sprout-heatmap-filter-listbox"
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg
              className={"bc svg-icon lucide-filter"}
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
            </svg>
            <span className={"bc"}>Filter</span>
          </button>

          {open ? (
            <div
              id="sprout-heatmap-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className={"bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col"}
              style={{ position: "absolute", top: "calc(100% + 6px)", zIndex: 1000, minWidth: "250px" }}
            >
              <div className={"bc p-1"}>
                <div
                  className={
                    "bc flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  }
                  role="button"
                  tabIndex={0}
                  aria-expanded={durationOpen ? "true" : "false"}
                  onClick={toggleDurationOpen}
                  onKeyDown={onDurationKey}
                >
                  <span className={"bc"}>Duration</span>
                  <ChevronIcon open={durationOpen} />
                </div>

                {durationOpen ? (
                  <div role="menu" aria-orientation="vertical" className={"bc flex flex-col"}>
                    {durationOptions.map((opt) => {
                      const selected = durationDays === opt;
                      const label = opt === 0 ? "Year to date" : `${opt} days`;
                      return (
                        <div
                          key={opt}
                          role="menuitemradio"
                          aria-checked={selected ? "true" : "false"}
                          tabIndex={0}
                          className={
                            "bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          }
                          onClick={() => setDurationDays(opt)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setDurationDays(opt);
                            }
                          }}
                        >
                          <div className={"bc size-4 flex items-center justify-center"}>
                            <div
                              className={"bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible"}
                              aria-hidden="true"
                            />
                          </div>
                          <span className={"bc"}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className={"bc h-px bg-border my-2"} role="separator" />

                <div className={"bc px-2 pb-2"}>
                  <div className={"bc text-sm text-muted-foreground cursor-pointer px-2"} onClick={resetFilters}>
                    Reset filters
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div ref={chartWrapRef} className={"bc relative flex flex-1 items-center"} style={{ minHeight: "120px" }}>
        <svg className={"bc"} width="100%" height={gridHeight} viewBox={`0 0 ${gridWidth} ${gridHeight}`}>
          {cells.map((cell, idx) => {
            let col = Math.floor(idx / 7);
            let row = idx % 7;
            if (durationDays === 7) {
              col = idx;
              row = 0;
            } else if (durationDays === 30) {
              col = idx % 7;
              row = Math.floor(idx / 7);
            }
            const level = cell.isPadding ? 0 : valueToLevel(cell.count, quantiles);
            const fill = cell.isPadding ? "transparent" : palette[level];
            return (
              <rect
                key={`${cell.dayIndex}-${idx}`}
                x={col * 16}
                y={row * 16}
                width={12}
                height={12}
                rx={3}
                ry={3}
                fill={fill}
                onMouseEnter={(event) => {
                  if (cell.isPadding) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const wrapRect = chartWrapRef.current?.getBoundingClientRect();
                  const x = rect.left - (wrapRect?.left ?? 0) + rect.width / 2;
                  const y = rect.top - (wrapRect?.top ?? 0) - 8;
                  setHovered({ cell, x, y });
                }}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>

        {hovered ? (
          <div
            className={"bc rounded-lg bg-foreground text-background shadow-none border-0 px-3 py-2 text-xs"}
            style={{
              position: "absolute",
              left: hovered.x,
              top: hovered.y,
              transform: "translate(-50%, -100%)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}
          >
            <div className={"bc text-sm font-medium text-background"}>{hovered.cell.dateLabel}</div>
            <div className={"bc text-background"}>Reviews: {hovered.cell.count}</div>
            <div className={"bc text-background"}>
              Time: {Math.max(1, Math.ceil(hovered.cell.totalMs / 60000))} min
            </div>
          </div>
        ) : null}
      </div>

      <div className={"bc flex items-center gap-2 text-xs text-muted-foreground"}>
        <span className={"bc"}>Less</span>
        <div className={"bc inline-flex items-center gap-1"}>
          {palette.slice(1).map((color, idx) => (
            <span
              key={`${color}-${idx}`}
              className={"bc inline-block"}
              style={{ width: "10px", height: "10px", borderRadius: "3px", backgroundColor: color }}
            />
          ))}
        </div>
        <span className={"bc"}>More</span>
      </div>
    </div>
  );
}
