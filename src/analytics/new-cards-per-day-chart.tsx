/**
 * @file src/analytics/new-cards-per-day-chart.tsx
 * @summary Bar chart displaying the number of newly created cards per day over a
 * configurable window (7, 30, or 90 days). Uses card creation timestamps to bucket
 * counts by local day. Supports filtering by card type, deck, and group tags.
 *
 * @exports
 *   - NewCardsPerDayChart — React component rendering a daily new-cards bar chart with filter controls
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

const BAR_COLOR = "var(--chart-accent-2)";

const MAX_SELECTIONS = 3;

type CardLike = {
  createdAt?: number;
  type?: string;
  deckId?: string;
  deckPath?: string;
  sourceNotePath?: string;
  groups?: string[] | null;
  tags?: string[] | null;
  groupPath?: string | null;
};

type Datum = {
  label: string;
  date: string;
  created: number;
};

type AxisDatum = Datum & {
  dayIndex: number;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="bc svg-icon sprout-ana-chevron"
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

const TYPE_LABELS: Record<string, string> = {
  all: "All cards",
  basic: "Basic",
  "cloze-child": "Cloze",
  "io-child": "Image occlusion",
  mcq: "Multiple choice",
};

function normalizeCardType(raw: string) {
  const t = String(raw ?? "").toLowerCase();
  if (t === "cloze") return "cloze-child";
  if (t === "io") return "io-child";
  return t;
}

function getCardDeck(card: CardLike): string | null {
  const raw = card.deckPath ?? card.deckId ?? card.sourceNotePath;
  const deck = String(raw ?? "").trim();
  return deck ? deck : null;
}

function getCardGroups(card: CardLike): string[] {
  if (Array.isArray(card.groups)) return card.groups.filter(Boolean);
  if (Array.isArray(card.tags)) return card.tags.filter(Boolean);
  const single = String(card.groupPath ?? "").trim();
  return single ? [single] : [];
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

function TooltipContent(props: { active?: boolean; payload?: Array<{ payload?: unknown }> }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const datum = props.payload[0]?.payload as Datum | undefined;
  if (!datum) return null;
  return (
    <div className="bc rounded-lg bg-foreground text-background shadow-none border-0 px-3 py-2 text-xs">
      <div className="bc text-sm font-medium text-background">{datum.date}</div>
      <div className="bc text-background">Created: {datum.created}</div>
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

export function NewCardsPerDayChart(props: {
  cards: CardLike[];
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

  React.useEffect(() => {
    setDurationDays(props.days ?? 30);
  }, [props.days]);

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
      popover.classList.remove("sprout-ana-popover-left");
      popover.classList.add("sprout-ana-popover-right");
    };
    place();
    window.addEventListener("resize", place, true);
    return () => window.removeEventListener("resize", place, true);
  }, [open]);

  const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
  const startIndex = todayIndex - (durationDays - 1);

  const availableTypes = React.useMemo(() => ["all", "basic", "cloze-child", "io-child", "mcq"], []);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const card of props.cards ?? []) {
      const deck = getCardDeck(card);
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const allGroups = React.useMemo(() => {
    const groups = new Set<string>();
    for (const card of props.cards ?? []) {
      for (const group of getCardGroups(card)) groups.add(group);
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const matchedDecks = React.useMemo(() => rankFilterMatches(allDecks, deckQuery, 5), [allDecks, deckQuery]);
  const matchedGroups = React.useMemo(() => rankFilterMatches(allGroups, groupQuery, 5), [allGroups, groupQuery]);

  const typeCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of availableTypes) counts.set(type, 0);
    for (const card of props.cards ?? []) {
      const t = normalizeCardType(card?.type ?? "");
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
  }, [availableTypes, props.cards]);

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

  const data = React.useMemo<AxisDatum[]>(() => {
    const rows: AxisDatum[] = [];
    const map = new Map<number, AxisDatum>();

    for (let i = 0; i < durationDays; i += 1) {
      const dayIndex = startIndex + i;
      const base = {
        label: formatDayLabel(dayIndex, tz),
        date: formatDayTitle(dayIndex, tz),
        created: 0,
      };
      const datum: AxisDatum = { ...base, dayIndex };
      rows.push(datum);
      map.set(dayIndex, datum);
    }

    for (const card of props.cards ?? []) {
      const t = normalizeCardType(card?.type ?? "");
      if (selectedType !== "all" && t !== selectedType) continue;

      if (selectedDecks.length) {
        const deck = getCardDeck(card);
        if (!deck || !selectedDecks.includes(deck)) continue;
      }

      if (selectedGroups.length) {
        const groups = getCardGroups(card);
        const hasGroup = selectedGroups.some((group) => groups.includes(group));
        if (!hasGroup) continue;
      }

      const createdAt = Number(card?.createdAt);
      if (!Number.isFinite(createdAt)) continue;

      const dayIndex = localDayIndex(createdAt, formatter);
      if (dayIndex < startIndex || dayIndex > todayIndex) continue;

      const row = map.get(dayIndex);
      if (row) row.created += 1;
    }

    return rows;
  }, [props.cards, formatter, tz, durationDays, startIndex, todayIndex, selectedType, selectedDecks, selectedGroups]);

  const durationOptions = React.useMemo(() => [7, 30, 90], []);

  const xTicks = React.useMemo(() => createXAxisTicks(startIndex, todayIndex, todayIndex), [startIndex, todayIndex]);

  const xTickFormatter = (value: number) =>
    formatAxisLabel(value, todayIndex, (dayIndex) => formatDayLabel(dayIndex, tz));

  const yMax = React.useMemo(() => {
    const maxValue = data.reduce((max, row) => Math.max(max, row.created), 0);
    return roundUpToNearest10(maxValue);
  }, [data]);

  const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);

  return (
    <div className="card sprout-ana-card sprout-ana-overflow-visible p-4 flex flex-col gap-3 h-full">
      <div className="bc flex items-start justify-between gap-2">
        <div>
          <div className="bc flex items-center gap-1">
            <div className="bc font-semibold">New cards added</div>
            <InfoIcon text="Daily count of newly created cards in your vault." />
          </div>
          <div className="bc text-xs text-muted-foreground">Daily totals</div>
        </div>

        <div ref={wrapRef} className="bc relative inline-flex">
          <button
            type="button"
            id="sprout-newcards-filter-trigger"
            className="bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg
              className="bc svg-icon lucide-filter sprout-ana-icon"
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
              id="sprout-newcards-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className="bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col sprout-ana-popover sprout-ana-popover-sm sprout-ana-popover-left"
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
                      return (
                        <div
                          key={opt}
                          role="menuitemradio"
                          aria-checked={selected ? "true" : "false"}
                          tabIndex={0}
                          className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
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
                          <span>{`${opt} days`}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="bc h-px bg-border my-2" role="separator" />

                <div
                  className="bc flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
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
                    id="sprout-newcards-filter-listbox"
                    aria-orientation="vertical"
                    data-tooltip="New cards filter"
                    className="bc flex flex-col"
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
                          className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => setSelectedType(type)}
                        >
                          <div className="bc size-4 flex items-center justify-center">
                            <div
                              className="bc size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                              aria-hidden="true"
                            />
                          </div>
                          <span className="bc flex items-center gap-2">
                            <span>{label}</span>
                            <span className="bc text-muted-foreground">{`(${count})`}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="bc h-px bg-border my-2" role="separator" />

                <div className="bc text-sm text-muted-foreground px-2 py-1">Decks</div>
                <div className="bc px-2 pb-2">
                  <input
                    type="text"
                    placeholder="Search decks"
                    className="bc input w-full text-sm"
                    value={deckQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDeckQuery(next);
                      if (!next.trim()) setSelectedDecks([]);
                    }}
                  />
                </div>

                {deckQuery.trim().length ? (
                  <div className="bc px-2 pb-2">
                    <div className="bc flex flex-col">
                      {matchedDecks.length ? (
                        matchedDecks.map((deck) => (
                          <div
                            key={deck}
                            role="menuitem"
                            tabIndex={0}
                            className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleDeck(deck)}
                          >
                            <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                              {selectedDecks.includes(deck) ? (
                                <span className="bc size-1.5 rounded-full bg-foreground" />
                              ) : null}
                            </span>
                            <span className={`bc truncate ${endTruncateClass}`}>
                              {formatFilterPath(deck)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="bc px-2 py-1 text-sm text-muted-foreground">No decks found.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="bc h-px bg-border my-2" role="separator" />

                <div className="bc text-sm text-muted-foreground px-2 py-1">Groups</div>
                <div className="bc px-2 pb-2">
                  <input
                    type="text"
                    placeholder="Search groups"
                    className="bc input w-full text-sm"
                    value={groupQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setGroupQuery(next);
                      if (!next.trim()) setSelectedGroups([]);
                    }}
                  />
                </div>

                {groupQuery.trim().length ? (
                  <div className="bc px-2 pb-2">
                    <div className="bc flex flex-col">
                      {matchedGroups.length ? (
                        matchedGroups.map((group) => (
                          <div
                            key={group}
                            role="menuitem"
                            tabIndex={0}
                            className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleGroup(group)}
                          >
                            <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                              {selectedGroups.includes(group) ? (
                                <span className="bc size-1.5 rounded-full bg-foreground" />
                              ) : null}
                            </span>
                            <span className={`bc truncate ${endTruncateClass}`}>
                              {formatFilterPath(group)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="bc px-2 py-1 text-sm text-muted-foreground">No groups found.</div>
                      )}
                    </div>
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

      <div className="bc w-full flex-1 sprout-analytics-chart">
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
            <Bar dataKey="created" fill={BAR_COLOR} radius={[0, 0, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
