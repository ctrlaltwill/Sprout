import * as React from "react";
import { Area, Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "./chartAxisUtils";
import { endTruncateStyle, useAnalyticsPopoverZIndex } from "./filterStyles";

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
// Use CSS variables for accent colors
const GREEN_LINE = "var(--chart-accent-3)";
const STAGE_COLORS: Record<string, string> = {
  new: "var(--chart-accent-1)",
  learning: "var(--chart-accent-2)",
  relearning: "var(--chart-accent-3)",
  review: "var(--chart-accent-4)",
};
const TYPE_LABELS: Record<string, string> = {
  all: "All cards",
  basic: "Basic",
  "cloze-child": "Cloze",
  "io-child": "Image Occlusion",
  mcq: "Multiple Choice",
};

type Filters = {
  deckId?: string | null;
  groupPath?: string | null;
};

type FutureDueCard = {
  id: string;
  due?: number | null;
  suspended?: boolean | null;
  stage?: string | null;
  type?: string | null;
  sourceNotePath?: string | null;
  groups?: string[] | null;
};

type Datum = {
  label: string;
  due: number;
  backlog: number;
  backlogSmooth: number;
  date: string;
  new: number;
  learning: number;
  relearning: number;
  review: number;
};

type AxisDatum = Datum & {
  dayIndex: number;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="svg-icon"
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

function formatFilterPath(raw: string, maxChars = 30) {
  let text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  if (lower.endsWith(".md")) text = text.slice(0, -3);
  text = text.replace(/\s*\/\s*/g, " / ");
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars).trimStart();
  return `...${tail}`;
}

function normalizeMatchText(raw: string) {
  return String(raw ?? "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function rankFilterMatches(items: string[], query: string, limit = 5) {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored = items
    .map((item) => {
      const norm = normalizeMatchText(item);
      const segments = norm
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
      let bestScore: number | null = null;
      for (const seg of segments) {
        if (seg === q) bestScore = bestScore === null ? 0 : Math.min(bestScore, 0);
        else if (seg.startsWith(q)) bestScore = bestScore === null ? 1 : Math.min(bestScore, 1);
        else if (seg.includes(q)) bestScore = bestScore === null ? 2 : Math.min(bestScore, 2);
      }
      if (bestScore === null && norm.includes(q)) bestScore = 3;
      if (bestScore === null) return null;
      const index = Math.max(0, norm.indexOf(q));
      return { item, score: bestScore, depth: segments.length, index, len: norm.length };
    })
    .filter(Boolean) as Array<{ item: string; score: number; depth: number; index: number; len: number }>;

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.index !== b.index) return a.index - b.index;
      if (a.len !== b.len) return a.len - b.len;
      return a.item.localeCompare(b.item);
    })
    .map((entry) => entry.item)
    .slice(0, limit);
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

function formatDayLabel(dayIndex: number, timeZone: string) {
  const date = new Date(dayIndex * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
}

function formatDayTitle(dayIndex: number, timeZone: string) {
  const date = new Date(dayIndex * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" });
}

function smoothSeries(values: number[], window: number) {
  if (!values.length || window <= 1) return values;
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    let total = 0;
    let count = 0;
    for (let i = index - half; i <= index + half; i += 1) {
      if (i < 0 || i >= values.length) continue;
      total += values[i] ?? 0;
      count += 1;
    }
    return count ? total / count : 0;
  });
}

function TooltipContent(props: { active?: boolean; payload?: any[]; label?: string }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const datum = props.payload[0]?.payload as Datum | undefined;
  if (!datum) return null;
  const total = datum.new + datum.learning + datum.relearning + datum.review;
  return (
    <div className="rounded-lg bg-foreground text-background shadow-none border-0 px-3 py-2 text-xs">
      <div className="text-sm font-medium text-background">{datum.date}</div>
      <div className="text-background">Due: {total}</div>
      <div className="text-background">New: {datum.new}</div>
      <div className="text-background">Learning: {datum.learning}</div>
      <div className="text-background">Relearning: {datum.relearning}</div>
      <div className="text-background">Review: {datum.review}</div>
      <div className="text-background">Backlog: {datum.backlog}</div>
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
  return ticks.filter((value, index, array) => index === 0 || value !== array[index - 1]);
}

export function FutureDueChart(props: {
  cards: FutureDueCard[];
  nowMs: number;
  timezone?: string;
  horizonDays?: number;
  filters?: Filters;
  enableAnimations?: boolean;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const [durationDays, setDurationDays] = React.useState(props.horizonDays ?? 30);
  const [deckQuery, setDeckQuery] = React.useState("");
  const [groupQuery, setGroupQuery] = React.useState("");
  const [selectedDecks, setSelectedDecks] = React.useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const [selectedType, setSelectedType] = React.useState<string>("all");
  const [durationOpen, setDurationOpen] = React.useState(false);
  const [cardTypeOpen, setCardTypeOpen] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);
  const toggleDurationOpen = () => setDurationOpen((prev) => !prev);
  const toggleCardTypeOpen = () => setCardTypeOpen((prev) => !prev);
  const onDurationKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleDurationOpen();
    }
  };
  const onCardTypeKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleCardTypeOpen();
    }
  };

  React.useEffect(() => {
    setDurationDays(props.horizonDays ?? 30);
  }, [props.horizonDays]);

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

  React.useEffect(() => {
    if (!open) return;
    const place = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.style.left = "auto";
      popover.style.right = "0px";
    };
    place();
    window.addEventListener("resize", place, true);
    return () => window.removeEventListener("resize", place, true);
  }, [open]);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const card of props.cards ?? []) {
      const deck = String(card?.sourceNotePath ?? "").trim();
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const allGroups = React.useMemo(() => {
    const groups = new Set<string>();
    for (const card of props.cards ?? []) {
      const cardGroups = Array.isArray(card?.groups) ? card.groups : [];
      for (const group of cardGroups) {
        if (!group || typeof group !== "string") continue;
        const trimmed = group.trim();
        if (trimmed) groups.add(trimmed);
      }
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const matchedDecks = React.useMemo(() => {
    return rankFilterMatches(allDecks, deckQuery, 5);
  }, [allDecks, deckQuery]);

  const matchedGroups = React.useMemo(() => {
    return rankFilterMatches(allGroups, groupQuery, 5);
  }, [allGroups, groupQuery]);

  const todayIndex = React.useMemo(() => localDayIndex(props.nowMs, formatter), [props.nowMs, formatter]);
  const horizonDays = durationDays;
  const startIndex = todayIndex - 14;
  const endIndex = todayIndex + horizonDays;

  const availableTypes = React.useMemo(() => ["all", "basic", "cloze-child", "io-child", "mcq"], []);
  const durationOptions = React.useMemo(() => [7, 30, 90], []);
  React.useEffect(() => {
    setSelectedType("all");
  }, [availableTypes]);

  const typeCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of availableTypes) counts.set(type, 0);
    for (const card of props.cards ?? []) {
      const t = String(card?.type ?? "");
      if (!t || t === "io") continue;
      if (t === "cloze" && Array.isArray((card as any).clozeChildren) && (card as any).clozeChildren.length) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (counts.has("all")) {
      const total = Array.from(counts.entries())
        .filter(([key]) => key !== "all")
        .reduce((sum, [, value]) => sum + (value ?? 0), 0);
      counts.set("all", total);
    }
    return counts;
  }, [availableTypes, props.cards]);

  const data = React.useMemo<AxisDatum[]>(() => {
    const totalDays = endIndex - startIndex + 1;
    const dueCounts = Array.from({ length: totalDays }, () => 0);
    const stageCounts = Array.from({ length: totalDays }, () => ({
      new: 0,
      learning: 0,
      relearning: 0,
      review: 0,
    }));
    const todayOffset = todayIndex - startIndex;
    let overdueTotal = 0;

    for (const card of props.cards ?? []) {
      if (!card) continue;
      if (card.suspended || String(card.stage || "") === "suspended") continue;
      if (selectedType && selectedType !== "all" && String(card.type ?? "") !== selectedType) continue;
      if (selectedDecks.length) {
        const deck = String(card.sourceNotePath ?? "");
        if (!selectedDecks.includes(deck)) continue;
      }
      if (selectedGroups.length) {
        if (!Array.isArray(card.groups)) continue;
        const hasGroup = selectedGroups.some((group) => card.groups?.includes(group));
        if (!hasGroup) continue;
      }

      const due = Number(card.due);
      if (!Number.isFinite(due) || due <= 0) continue;
      const dayIndex = localDayIndex(due, formatter);
      if (dayIndex < todayIndex) {
        overdueTotal += 1;
        continue;
      }
      if (dayIndex < startIndex || dayIndex > endIndex) continue;
      const offset = dayIndex - startIndex;
      dueCounts[offset] += 1;
      const stageKey = String(card.stage ?? "").toLowerCase();
      if (stageKey in stageCounts[offset]) {
        (stageCounts[offset] as Record<string, number>)[stageKey] += 1;
      }
    }

    const rows: AxisDatum[] = [];
    let backlog = 0;
    const backlogValues = Array.from({ length: totalDays }, () => 0);
    for (let i = 0; i < totalDays; i += 1) {
      const dayIndex = startIndex + i;
      if (i >= todayOffset) {
        if (i === todayOffset) backlog += overdueTotal;
        backlog += dueCounts[i] ?? 0;
      }
      backlogValues[i] = i >= todayOffset ? backlog : 0;
      rows.push({
        label: formatDayLabel(dayIndex, tz),
        date: formatDayTitle(dayIndex, tz),
        due: dueCounts[i] ?? 0,
        backlog: backlogValues[i] ?? 0,
        backlogSmooth: 0,
        new: stageCounts[i]?.new ?? 0,
        learning: stageCounts[i]?.learning ?? 0,
        relearning: stageCounts[i]?.relearning ?? 0,
        review: stageCounts[i]?.review ?? 0,
        dayIndex,
      });
    }
    const smoothed = smoothSeries(backlogValues, 15);
    for (let i = 0; i < rows.length; i += 1) {
      rows[i].backlogSmooth = smoothed[i] ?? 0;
    }
    return rows;
  }, [props.cards, startIndex, endIndex, todayIndex, formatter, tz, selectedDecks, selectedGroups, selectedType]);

  const xTicks = React.useMemo(() => createXAxisTicks(startIndex, endIndex, todayIndex), [startIndex, endIndex, todayIndex]);
  const xTickFormatter = (value: number) => formatAxisLabel(value, todayIndex, (dayIndex) => formatDayLabel(dayIndex, tz));
  const yMax = React.useMemo(() => {
    const maxValue = data.reduce((max, row) => Math.max(max, row.new + row.learning + row.relearning + row.review), 0);
    return roundUpToNearest10(maxValue);
  }, [data]);
  const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);

  const avgDaily = React.useMemo(() => {
    if (!data.length) return 0;
    const todayOffset = todayIndex - startIndex;
    const window = data.slice(Math.max(0, todayOffset));
    if (!window.length) return 0;
    const total = window.reduce((sum, row) => sum + row.due, 0);
    return Math.round((total / window.length) * 10) / 10;
  }, [data, todayIndex, startIndex]);

  const toggleDeck = (deck: string) => {
    setSelectedDecks((prev) => {
      if (prev.includes(deck)) return prev.filter((item) => item !== deck);
      if (prev.length >= 3) return prev;
      return [...prev, deck];
    });
  };

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) return prev.filter((item) => item !== group);
      if (prev.length >= 3) return prev;
      return [...prev, group];
    });
  };

  const resetFilters = () => {
    setSelectedType("all");
    setSelectedDecks([]);
    setSelectedGroups([]);
    setDeckQuery("");
    setGroupQuery("");
    setDurationDays(props.horizonDays ?? 30);
    setDurationOpen(false);
    setCardTypeOpen(false);
    setOpen(false);
  };

  return (
    <div className="card sprout-ana-card p-4 flex flex-col gap-3 h-full" style={{ overflow: "visible" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="font-semibold">Study forecast</div>
            <InfoIcon text="Projected due load by day. Backlog line includes all overdue cards." />
          </div>
          <div className="text-xs text-muted-foreground">Avg daily: {avgDaily}</div>
        </div>
        <div ref={wrapRef} className="relative inline-flex">
          <button
            type="button"
            id="sprout-forecast-filter-trigger"
            className="btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-controls="sprout-forecast-filter-listbox"
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg
              className="svg-icon lucide-filter"
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
              id="sprout-forecast-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className="rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col"
              style={{ position: "absolute", top: "calc(100% + 6px)", zIndex: 1000, minWidth: "250px" }}
            >
              <div className="p-1">
                <div
                  className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
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
                  <div role="menu" aria-orientation="vertical" className="flex flex-col">
                    {durationOptions.map((opt) => {
                      const selected = durationDays === opt;
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
                          <div className="size-4 flex items-center justify-center">
                            <div
                              className="size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                              aria-hidden="true"
                            />
                          </div>
                          <span>{`${opt} days`}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="h-px bg-border my-2" role="separator" />
                <div
                  className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  role="button"
                  tabIndex={0}
                  aria-expanded={cardTypeOpen ? "true" : "false"}
                  onClick={toggleCardTypeOpen}
                  onKeyDown={onCardTypeKey}
                >
                  <span>Card type</span>
                  <ChevronIcon open={cardTypeOpen} />
                </div>
                {cardTypeOpen ? (
                  <div
                    role="menu"
                    id="sprout-forecast-filter-listbox"
                    aria-orientation="vertical"
                    data-tooltip="Forecast filter"
                    className="flex flex-col"
                  >
                    {availableTypes.map((type) => {
                      const label = TYPE_LABELS[type] ?? type;
                      const selected = selectedType === type;
                      const count = typeCounts.get(type) ?? 0;
                      return (
                        <div
                          key={type}
                          role="menuitemradio"
                          aria-checked={selected ? "true" : "false"}
                          tabIndex={0}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => setSelectedType(type)}
                        >
                          <div className="size-4 flex items-center justify-center">
                            <div
                              className="size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                              aria-hidden="true"
                            />
                          </div>
                          <span className="flex items-center gap-2">
                            <span>{label}</span>
                            <span className="text-muted-foreground">{`(${count})`}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="h-px bg-border my-2" role="separator" />
                <div className="text-sm text-muted-foreground px-2 py-1">Decks</div>
                <div className="px-2 pb-2">
                  <input
                    type="text"
                    placeholder="Search decks"
                    className="input w-full text-sm"
                    value={deckQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDeckQuery(next);
                      if (!next.trim()) setSelectedDecks([]);
                    }}
                  />
                </div>
                {deckQuery.trim().length ? (
                  <div className="px-2 pb-2">
                    <div className="flex flex-col">
                      {matchedDecks.length ? (
                        matchedDecks.map((deck) => (
                          <div
                            key={deck}
                            role="menuitem"
                            tabIndex={0}
                            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleDeck(deck)}
                          >
                            <span className="size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                              {selectedDecks.includes(deck) ? <span className="size-1.5 rounded-full bg-foreground" /> : null}
                            </span>
                            <span className="truncate" style={endTruncateStyle}>
                              {formatFilterPath(deck)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-2 py-1 text-sm text-muted-foreground">No decks found.</div>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="h-px bg-border my-2" role="separator" />
                <div className="text-sm text-muted-foreground px-2 py-1">Groups</div>
                <div className="px-2 pb-2">
                  <input
                    type="text"
                    placeholder="Search groups"
                    className="input w-full text-sm"
                    value={groupQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setGroupQuery(next);
                      if (!next.trim()) setSelectedGroups([]);
                    }}
                  />
                </div>
                {groupQuery.trim().length ? (
                  <div className="px-2 pb-2">
                    <div className="flex flex-col">
                      {matchedGroups.length ? (
                        matchedGroups.map((group) => (
                          <div
                            key={group}
                            role="menuitem"
                            tabIndex={0}
                            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleGroup(group)}
                          >
                            <span className="size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                              {selectedGroups.includes(group) ? <span className="size-1.5 rounded-full bg-foreground" /> : null}
                            </span>
                            <span className="truncate" style={endTruncateStyle}>
                              {formatFilterPath(group)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-2 py-1 text-sm text-muted-foreground">No groups found.</div>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="h-px bg-border my-2" role="separator" />
                <div className="px-2 pb-2">
                  <div className="text-sm text-muted-foreground cursor-pointer px-2" onClick={resetFilters}>
                    Reset filters
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="w-full flex-1 sprout-analytics-chart">
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 12, left: 8 }}>
            <defs>
              <linearGradient id="sprout-forecast-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--theme-accent)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--theme-accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dayIndex"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fontSize: 12 }}
              ticks={xTicks}
              interval={0}
              tickFormatter={xTickFormatter}
            />
            <YAxis
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              width={32}
              tick={{ fontSize: 12 }}
              ticks={yTicks}
              domain={[0, yMax]}
            />
            <Tooltip content={<TooltipContent />} />
            <Bar dataKey="new" stackId="due" fill={STAGE_COLORS.new} radius={[0, 0, 0, 0]} />
            <Bar dataKey="learning" stackId="due" fill={STAGE_COLORS.learning} radius={[0, 0, 0, 0]} />
            <Bar dataKey="relearning" stackId="due" fill={STAGE_COLORS.relearning} radius={[0, 0, 0, 0]} />
            <Bar dataKey="review" stackId="due" fill={STAGE_COLORS.review} radius={[0, 0, 0, 0]} />
            <Area
              dataKey="backlogSmooth"
              type="natural"
              stroke={GREEN_LINE}
              fill="url(#sprout-forecast-area)"
              strokeWidth={3}
              dot={false}
              isAnimationActive={props.enableAnimations ?? true}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bc flex flex-wrap gap-3 text-xs text-muted-foreground">
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block"
            style={{ width: "10px", height: "10px", borderRadius: "3px", backgroundColor: "var(--chart-accent-1)" }}
          />
          <span className="bc">New</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block"
            style={{ width: "10px", height: "10px", borderRadius: "3px", backgroundColor: "var(--chart-accent-2)" }}
          />
          <span className="bc">Learning</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block"
            style={{ width: "10px", height: "10px", borderRadius: "3px", backgroundColor: "var(--chart-accent-3)" }}
          />
          <span className="bc">Relearning</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block"
            style={{ width: "10px", height: "10px", borderRadius: "3px", backgroundColor: "var(--chart-accent-4)" }}
          />
          <span className="bc">Review</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block"
            style={{ width: "14px", height: "2px", borderRadius: "3px", backgroundColor: "var(--chart-accent-3)" }}
          />
          <span className="bc">Backlog</span>
        </div>
      </div>
    </div>
  );
}
