/**
 * @file src/analytics/stacked-review-buttons-chart.tsx
 * @summary Stacked bar chart showing daily counts of Again, Hard, Good, and Easy
 * answer-button presses over a configurable window (7, 30, or 90 days). Each day
 * is a stacked bar coloured by response type. Supports filtering by card type,
 * deck, and group tags, with timezone-aware day bucketing.
 *
 * @exports
 *   - StackedReviewButtonsChart — React component rendering a stacked bar chart of daily answer button counts with filter controls
 */

import * as React from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "./chart-axis-utils";
import { endTruncateClass, useAnalyticsPopoverZIndex } from "./filter-styles";
import { MS_DAY } from "../core/constants";

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

const COLORS = {
  again: "var(--chart-accent-1)",
  hard: "var(--chart-accent-2)",
  good: "var(--chart-accent-3)",
  easy: "var(--chart-accent-4)",
};

const MAX_SELECTIONS = 3;

type ReviewEvent = {
  kind?: string;
  at?: number;
  result?: string;
  cardType?: string;
  cardId?: string;
  deckId?: string;
  deckPath?: string;
  sourceNotePath?: string;
  groups?: string[] | null;
  tags?: string[] | null;
  groupPath?: string | null;
};

type CardLike = {
  id: string;
  sourceNotePath?: string;
  groups?: string[] | null;
};

type Datum = {
  label: string;
  date: string;
  again: number;
  hard: number;
  good: number;
  easy: number;
};

type AxisDatum = Datum & {
  dayIndex: number;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="svg-icon sprout-ana-chevron"
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ "--sprout-rotate": open ? "90deg" : "0deg" } as React.CSSProperties}
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
      popover.classList.remove("sprout-ana-popover-left");
      popover.classList.add("sprout-ana-popover", "sprout-ana-popover-right");
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

const TYPE_LABELS: Record<string, string> = {
  all: "All cards",
  basic: "Basic",
  "cloze-child": "Cloze",
  "io-child": "Image Occlusion",
  mcq: "Multiple Choice",
};

function normalizeEventType(raw: string) {
  const t = String(raw ?? "").toLowerCase();
  if (t === "cloze") return "cloze-child";
  if (t === "io") return "io-child";
  return t;
}

function getEventDeck(ev: ReviewEvent, cardById?: Map<string, CardLike>): string | null {
  const raw = ev.deckPath ?? ev.deckId ?? ev.sourceNotePath;
  const deck = String(raw ?? "").trim();
  if (deck) return deck;
  const cardId = String(ev.cardId ?? "").trim();
  if (!cardId || !cardById) return null;
  const card = cardById.get(cardId);
  const fallback = String(card?.sourceNotePath ?? "").trim();
  return fallback ? fallback : null;
}

function getEventGroups(ev: ReviewEvent, cardById?: Map<string, CardLike>): string[] {
  if (Array.isArray(ev.groups)) return ev.groups.filter(Boolean);
  if (Array.isArray(ev.tags)) return ev.tags.filter(Boolean);
  const single = String(ev.groupPath ?? "").trim();
  if (single) return [single];
  const cardId = String(ev.cardId ?? "").trim();
  if (!cardId || !cardById) return [];
  const card = cardById.get(cardId);
  if (!card || !Array.isArray(card.groups)) return [];
  return card.groups.filter(Boolean);
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

function TooltipContent(props: { active?: boolean; payload?: Array<{ payload?: unknown }> }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const datum = props.payload[0]?.payload as Datum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg bg-foreground text-background shadow-none border-0 px-3 py-2 text-xs">
      <div className="text-sm font-medium text-background">{datum.date}</div>
      <div className="text-background">Again: {datum.again}</div>
      <div className="text-background">Hard: {datum.hard}</div>
      <div className="text-background">Good: {datum.good}</div>
      <div className="text-background">Easy: {datum.easy}</div>
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

export function StackedReviewButtonsChart(props: {
  events: ReviewEvent[];
  cards?: CardLike[];
  timezone?: string;
  days?: number;
  enableAnimations?: boolean;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const [durationDays, setDurationDays] = React.useState(props.days ?? 30);
  const [open, setOpen] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState<string>("all");
  const [deckQuery, setDeckQuery] = React.useState("");
  const [groupQuery, setGroupQuery] = React.useState("");
  const [selectedDecks, setSelectedDecks] = React.useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const [cardTypeOpen, setCardTypeOpen] = React.useState(false);
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
  const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
  const startIndex = todayIndex - (durationDays - 1);

  const availableTypes = React.useMemo(() => ["all", "basic", "cloze-child", "io-child", "mcq"], []);

  const cardById = React.useMemo(() => {
    const map = new Map<string, CardLike>();
    for (const card of props.cards ?? []) {
      if (!card?.id) continue;
      map.set(String(card.id), card);
    }
    return map;
  }, [props.cards]);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const ev of props.events ?? []) {
      const deck = getEventDeck(ev, cardById);
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [props.events, cardById]);

  const allGroups = React.useMemo(() => {
    const groups = new Set<string>();
    for (const ev of props.events ?? []) {
      for (const group of getEventGroups(ev, cardById)) groups.add(group);
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [props.events, cardById]);

  const matchedDecks = React.useMemo(() => rankFilterMatches(allDecks, deckQuery, 5), [allDecks, deckQuery]);
  const matchedGroups = React.useMemo(() => rankFilterMatches(allGroups, groupQuery, 5), [allGroups, groupQuery]);

  const typeCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of availableTypes) counts.set(type, 0);
    for (const ev of props.events ?? []) {
      if (!ev || ev.kind !== "review") continue;
      const t = normalizeEventType(ev.cardType ?? "");
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (counts.has("all")) {
      const total = Array.from(counts.entries())
        .filter(([key]) => key !== "all")
        .reduce((sum, [, value]) => sum + (value ?? 0), 0);
      counts.set("all", total);
    }
    return counts;
  }, [availableTypes, props.events]);

  const resetFilters = () => {
    setSelectedType("all");
    setSelectedDecks([]);
    setSelectedGroups([]);
    setDeckQuery("");
    setGroupQuery("");
    setDurationDays(props.days ?? 30);
    setDurationOpen(false);
    setCardTypeOpen(false);
    setOpen(false);
  };

  const toggleDeck = (deck: string) => {
    setSelectedDecks((prev) => {
      if (prev.includes(deck)) return prev.filter((item) => item !== deck);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, deck];
    });
  };

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) return prev.filter((item) => item !== group);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, group];
    });
  };

  React.useEffect(() => {
    setDurationDays(props.days ?? 30);
  }, [props.days]);

  useCloseOnOutsideClick(open, wrapRef, popoverRef, () => setOpen(false));
  usePopoverPlacement(open, wrapRef, popoverRef);

  const data = React.useMemo<AxisDatum[]>(() => {
    const rows: AxisDatum[] = [];
    const map = new Map<number, AxisDatum>();
    for (let i = 0; i < durationDays; i += 1) {
      const dayIndex = startIndex + i;
      const base: AxisDatum = {
        label: formatDayLabel(dayIndex, tz),
        date: formatDayTitle(dayIndex, tz),
        again: 0,
        hard: 0,
        good: 0,
        easy: 0,
        dayIndex,
      };
      rows.push(base);
      map.set(dayIndex, base);
    }

    for (const ev of props.events ?? []) {
      if (!ev || ev.kind !== "review") continue;
      const at = Number(ev.at);
      if (!Number.isFinite(at)) continue;
      const dayIndex = localDayIndex(at, formatter);
      if (dayIndex < startIndex || dayIndex > todayIndex) continue;
      const t = normalizeEventType(ev.cardType ?? "");
      if (selectedType !== "all" && t !== selectedType) continue;
      if (selectedDecks.length) {
        const deck = getEventDeck(ev, cardById);
        if (!deck || !selectedDecks.includes(deck)) continue;
      }
      if (selectedGroups.length) {
        const groups = getEventGroups(ev, cardById);
        const hasGroup = selectedGroups.some((group) => groups.includes(group));
        if (!hasGroup) continue;
      }
      const row = map.get(dayIndex);
      if (!row) continue;
      const result = String(ev.result ?? "");
      if (result === "again") row.again += 1;
      else if (result === "hard") row.hard += 1;
      else if (result === "good") row.good += 1;
      else if (result === "easy") row.easy += 1;
    }

    return rows;
  }, [
    props.events,
    formatter,
    tz,
    durationDays,
    startIndex,
    todayIndex,
    selectedType,
    selectedDecks,
    selectedGroups,
    cardById,
  ]);

  const durationOptions = React.useMemo(() => [7, 30, 90], []);

  const xTicks = React.useMemo(() => {
    const endIndex = startIndex + durationDays - 1;
    return createXAxisTicks(startIndex, endIndex, todayIndex);
  }, [startIndex, durationDays, todayIndex]);

  const xTickFormatter = (value: number) =>
    formatAxisLabel(value, todayIndex, (dayIndex) => formatDayLabel(dayIndex, tz));

  const yMax = React.useMemo(() => {
    const maxValue = data.reduce((max, row) => Math.max(max, row.again + row.hard + row.good + row.easy), 0);
    return roundUpToNearest10(maxValue);
  }, [data]);
  const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);

  return (
    <div className="card sprout-ana-card sprout-ana-overflow-visible p-4 flex flex-col gap-3 h-full">
      <div className="flex items-start justify-between gap-2">
        <div>
        <div className="flex items-center gap-1">
          <div className="font-semibold">Answer buttons</div>
          <InfoIcon text="Daily counts of Again/Hard/Good/Easy ratings." />
        </div>
          <div className="text-xs text-muted-foreground">Stacked daily totals</div>
        </div>
        <div ref={wrapRef} className="relative inline-flex">
          <button
            type="button"
            id="sprout-answer-buttons-filter-trigger"
            className="btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-controls="sprout-answer-buttons-filter-listbox"
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg
              className="svg-icon lucide-filter sprout-ana-icon"
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
            <span>Filter</span>
          </button>
          {open ? (
            <div
              id="sprout-answer-buttons-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className="rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col sprout-ana-popover sprout-ana-popover-sm"
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
                    id="sprout-answer-buttons-filter-listbox"
                    aria-orientation="vertical"
                    data-tooltip="Answer buttons filter"
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
                              {selectedDecks.includes(deck) ? (
                                <span className="size-1.5 rounded-full bg-foreground" />
                              ) : null}
                            </span>
                            <span className={`truncate ${endTruncateClass}`}>
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
                              {selectedGroups.includes(group) ? (
                                <span className="size-1.5 rounded-full bg-foreground" />
                              ) : null}
                            </span>
                            <span className={`truncate ${endTruncateClass}`}>
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
          <BarChart data={data} margin={{ top: 12, right: 12, bottom: 12, left: 8 }}>
            <XAxis
              dataKey="dayIndex"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval={0}
              ticks={xTicks}
              tick={{ fontSize: 12 }}
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
            <Bar
              dataKey="again"
              stackId="a"
              fill={COLORS.again}
              radius={[0, 0, 0, 0]}
              isAnimationActive={props.enableAnimations ?? true}
            />
            <Bar
              dataKey="hard"
              stackId="a"
              fill={COLORS.hard}
              radius={[0, 0, 0, 0]}
              isAnimationActive={props.enableAnimations ?? true}
            />
            <Bar
              dataKey="good"
              stackId="a"
              fill={COLORS.good}
              radius={[0, 0, 0, 0]}
              isAnimationActive={props.enableAnimations ?? true}
            />
            <Bar
              dataKey="easy"
              stackId="a"
              fill={COLORS.easy}
              radius={[0, 0, 0, 0]}
              isAnimationActive={props.enableAnimations ?? true}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bc flex flex-wrap gap-3 text-xs text-muted-foreground">
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block sprout-ana-legend-dot sprout-ana-legend-dot-square"
            style={{ "--sprout-legend-color": COLORS.again } as React.CSSProperties}
          />
          <span className="bc">Again</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block sprout-ana-legend-dot sprout-ana-legend-dot-square"
            style={{ "--sprout-legend-color": COLORS.hard } as React.CSSProperties}
          />
          <span className="bc">Hard</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block sprout-ana-legend-dot sprout-ana-legend-dot-square"
            style={{ "--sprout-legend-color": COLORS.good } as React.CSSProperties}
          />
          <span className="bc">Good</span>
        </div>
        <div className="bc inline-flex items-center gap-2">
          <span
            className="bc inline-block sprout-ana-legend-dot sprout-ana-legend-dot-square"
            style={{ "--sprout-legend-color": COLORS.easy } as React.CSSProperties}
          />
          <span className="bc">Easy</span>
        </div>
      </div>
    </div>
  );
}
