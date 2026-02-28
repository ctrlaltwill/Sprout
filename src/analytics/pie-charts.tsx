/**
 * @file src/analytics/pie-charts.tsx
 * @summary Donut-style pie chart components for the analytics dashboard. Includes
 * a stage-distribution pie showing card counts by learning stage (New, Learning,
 * Review, Relearning, Suspended) and an answer-buttons pie showing the proportion
 * of Again/Hard/Good/Easy responses over a configurable time window. Both charts
 * support filtering by card type, deck, and group tags via popover controls.
 *
 * @exports
 *   - StagePieCard — React component rendering a donut chart of card stage distribution with filter controls
 *   - AnswerButtonsPieCard — React component rendering a donut chart of answer button usage over time
 */

import * as React from "react";
import { Label, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { startTruncateClass, useAnalyticsPopoverZIndex } from "./filter-styles";
import { cssClassForProps } from "../core/ui";

type PieDatum = { name: string; value: number };

// Use CSS variables for chart accent colors
const palette = [
  "var(--chart-accent-1)",
  "var(--chart-accent-2)",
  "var(--chart-accent-3)",
  "var(--chart-accent-4)",
  "var(--theme-accent)",
  "var(--accent)",
  "var(--primary)"
];
const typeLabels: Record<string, string> = {
  all: "All cards",
  basic: "Basic",
  "reversed-child": "Basic (Reversed)",
  mcq: "Multiple choice",
  "cloze-child": "Cloze",
  "io-child": "Image occlusion",
};

function InfoIcon(props: { text: string }) {
  return (
    <span
      className="inline-flex items-center text-muted-foreground"
      data-tooltip={props.text}
      data-tooltip-position="right"
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

function normalizeEventType(raw: string) {
  const t = String(raw ?? "").toLowerCase();
  if (t === "cloze") return "cloze-child";
  if (t === "io") return "io-child";
  if (t === "reversed") return "reversed-child";
  return t;
}

function PieTooltip(props: { active?: boolean; payload?: Array<{ name?: string; value?: number }> }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const item = props.payload[0] as { name?: string; value?: number } | undefined;
  if (!item) return null;
  return (
    <div className="sprout-data-tooltip-surface">
      <div className="text-sm font-medium text-background">{item.name}</div>
      <div className="text-background">Count: {item.value ?? 0}</div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`svg-icon sprout-ana-chevron${open ? " is-open" : ""}`}
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

function formatFilterPath(raw: string, maxChars = 40) {
  let text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  if (lower.endsWith(".md")) text = text.slice(0, -3);
  text = text.replace(/\s*\/\s*/g, " / ");
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars).trimStart();
  return `...${tail}`;
}

function buildData(entries: Array<[string, number]>) {
  return entries
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([name, value]) => ({ name, value }));
}

function PieCard(props: {
  title: string;
  subtitle?: string;
  data: PieDatum[];
  headerSlot?: React.ReactNode;
  highlightLabel?: string;
  centerValue?: string;
  centerLabel?: string;
  infoText?: string;
}) {
  const total = props.data.reduce((sum, item) => sum + item.value, 0);
  const highlightIndex = props.highlightLabel
    ? props.data.findIndex((item) => item.name.toLowerCase() === props.highlightLabel?.toLowerCase())
    : -1;
  const activeIndex = highlightIndex >= 0 ? highlightIndex : undefined;

  // Add colors to data for recharts v3
  const dataWithColors = React.useMemo(() => 
    props.data.map((item, index) => ({
      ...item,
      fill: palette[index % palette.length]
    })),
    [props.data]
  );

  return (
    <div className="card sprout-ana-card sprout-ana-overflow-visible p-4 flex flex-col gap-3 h-full">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="font-semibold">{props.title}</div>
            {props.infoText ? <InfoIcon text={props.infoText} /> : null}
          </div>
          {props.subtitle ? <div className="text-xs text-muted-foreground">{props.subtitle}</div> : null}
        </div>
        {props.headerSlot}
      </div>

      <div className="w-full flex-1 sprout-ana-pie-wrap">
        {total <= 0 ? (
          <div className="text-sm text-muted-foreground sprout-ana-empty-center">
            No cards selected.
          </div>
        ) : null}

        {total > 0 ? (
          <div className="sprout-analytics-chart">
            <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Tooltip content={<PieTooltip />} />
              <Pie
                data={dataWithColors}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
                stroke="var(--background)"
                activeIndex={activeIndex}
                shape={(sectorProps: PieSectorDataItem & { isActive?: boolean }) => {
                  const { outerRadius = 0, isActive, ...restProps } = sectorProps;
                  return <Sector {...restProps} outerRadius={isActive ? outerRadius + 10 : outerRadius} />;
                }}
              >
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                    const cx = viewBox.cx;
                    const cy = viewBox.cy;
                    const value = props.centerValue ?? total.toLocaleString();
                    const label = props.centerLabel ?? "";
                    return (
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={cx} y={cy} className="fill-foreground text-2xl font-semibold">
                          {value}
                        </tspan>
                        {label ? (
                          <tspan x={cx} y={cy + 22} className="fill-muted-foreground text-xs">
                            {label}
                          </tspan>
                        ) : null}
                      </text>
                    );
                  }}
                />
              </Pie>
            </PieChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>

      <div className="bc flex flex-wrap gap-3 text-xs text-muted-foreground sprout-ana-min-20 sprout-ana-chart-legend">
        {total > 0
          ? props.data.map((entry, index) => (
              <div key={`legend-${entry.name}`} className="bc inline-flex items-center gap-2">
                <span
                  className={`bc inline-block sprout-ana-legend-dot sprout-ana-legend-dot-square ${cssClassForProps({ "--sprout-legend-color": palette[index % palette.length] })}`}
                />
                <span className="bc">{entry.name}</span>
                <span className="bc text-foreground">{entry.value}</span>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}

export function StagePieCard(props: {
  cards: Array<{ id: string; type?: string; sourceNotePath?: string; groups?: string[] | null; clozeChildren?: number[] | null }>;
  states: Record<string, { stage?: string }>;
  enableAnimations?: boolean;
}) {
  const [selectedType, setSelectedType] = React.useState<string | null>(null);
  const [tagQuery, setTagQuery] = React.useState("");
  const [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const [deckQuery, setDeckQuery] = React.useState("");
  const [selectedDecks, setSelectedDecks] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const [cardTypesOpen, setCardTypesOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  const availableTypes = React.useMemo(() => {
    return ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"];
  }, [props.cards]);

  const typeCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of availableTypes) counts.set(type, 0);
    for (const card of props.cards ?? []) {
      const t = String(card?.type ?? "");
      if (!t || t === "cloze" || t === "reversed" || t === "io" || t === "io-parent" || t === "io_parent" || t === "ioparent") continue;
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

  const matchedGroups = React.useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    if (!query) return [];
    return allGroups.filter((group) => group.toLowerCase().includes(query)).slice(0, 3);
  }, [allGroups, tagQuery]);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const card of props.cards ?? []) {
      const deck = String(card?.sourceNotePath ?? "").trim();
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const matchedDecks = React.useMemo(() => {
    const query = deckQuery.trim().toLowerCase();
    if (!query) return [];
    return allDecks.filter((deck) => deck.toLowerCase().includes(query)).slice(0, 3);
  }, [allDecks, deckQuery]);

  React.useEffect(() => {
    setSelectedType("all");
  }, [availableTypes]);

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
    const placePopover = () => {
      const wrap = wrapRef.current;
      const popover = popoverRef.current;
      if (!wrap || !popover) return;
      popover.classList.remove("sprout-ana-popover-left");
      popover.classList.add("sprout-ana-popover-right");
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const filteredCards = React.useMemo(() => {
    return (props.cards ?? []).filter((card) => {
      if (!card) return false;
      const _t = String(card.type ?? "");
      if (_t === "cloze" || _t === "reversed" || _t === "io" || _t === "io-parent" || _t === "io_parent" || _t === "ioparent") return false;
      if (selectedType && selectedType !== "all" && card.type !== selectedType) return false;
      if (selectedGroups.length) {
        if (!Array.isArray(card.groups)) return false;
        const hasGroup = selectedGroups.some((group) => card.groups?.includes(group));
        if (!hasGroup) return false;
      }
      if (selectedDecks.length) {
        const deck = String(card.sourceNotePath ?? "");
        if (!selectedDecks.includes(deck)) return false;
      }
      return true;
    });
  }, [props.cards, selectedType, selectedGroups, selectedDecks]);

  const stageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {
      New: 0,
      Learning: 0,
      Review: 0,
      Relearning: 0,
      Suspended: 0,
    };
    for (const card of filteredCards) {
      const stage = String(props.states?.[String(card.id)]?.stage ?? "new");
      if (stage === "review") counts.Review += 1;
      else if (stage === "relearning") counts.Relearning += 1;
      else if (stage === "suspended") counts.Suspended += 1;
      else if (stage === "new") counts.New += 1;
      else counts.Learning += 1;
    }
    return counts;
  }, [filteredCards, props.states]);

  const data = React.useMemo(() => buildData(Object.entries(stageCounts)), [stageCounts]);

  const toggleType = (type: string) => {
    setSelectedType(type);
  };

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) return prev.filter((item) => item !== group);
      if (prev.length >= 3) return prev;
      return [...prev, group];
    });
  };

  const toggleDeck = (deck: string) => {
    setSelectedDecks((prev) => {
      if (prev.includes(deck)) return prev.filter((item) => item !== deck);
      if (prev.length >= 3) return prev;
      return [...prev, deck];
    });
  };

  const toggleCardTypesOpen = () => setCardTypesOpen((prev) => !prev);
  const onCardTypesKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleCardTypesOpen();
    }
  };

  const resetFilters = () => {
    setSelectedType("all");
    setSelectedGroups([]);
    setSelectedDecks([]);
    setTagQuery("");
    setDeckQuery("");
    setCardTypesOpen(true);
  };

  const headerSlot = (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        id="sprout-stage-filter-trigger"
        className="btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls="sprout-stage-filter-listbox"
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
          id="sprout-stage-filter-popover"
          aria-hidden="false"
          ref={popoverRef}
          className="rounded-lg w-72 border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col sprout-ana-popover sprout-ana-popover-sm sprout-ana-popover-left"
        >
          <div className="p-1">
            <div
              className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
              role="button"
              tabIndex={0}
              aria-expanded={cardTypesOpen ? "true" : "false"}
              onClick={toggleCardTypesOpen}
              onKeyDown={onCardTypesKey}
            >
              <span>Card type</span>
              <ChevronIcon open={cardTypesOpen} />
            </div>

            {cardTypesOpen ? (
              <div
                role="menu"
                id="sprout-stage-filter-listbox"
                aria-orientation="vertical"
                data-tooltip="Stage filter"
                className="flex flex-col"
              >
                {availableTypes.map((type) => {
                  const label = typeLabels[type] ?? type;
                  const selected = selectedType === type;
                  const count = typeCounts.get(type) ?? 0;
                  return (
                    <div
                      key={type}
                      role="menuitemradio"
                      aria-checked={selected ? "true" : "false"}
                      tabIndex={0}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                      onClick={() => toggleType(type)}
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

            <div className="h-px bg-border my-1" role="separator" />
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
                        <span className={`truncate ${startTruncateClass}`}>
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

            <div className="h-px bg-border my-1" role="separator" />
            <div className="text-sm text-muted-foreground px-2 py-1">Groups</div>
            <div className="px-2 pb-2">
              <input
                type="text"
                placeholder="Search groups"
                className="input w-full text-sm"
                value={tagQuery}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setTagQuery(next);
                  if (!next.trim()) setSelectedGroups([]);
                }}
              />
            </div>

            {tagQuery.trim().length ? (
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
                        <span className={`truncate ${startTruncateClass}`}>
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

            <div className="h-px bg-border my-1" role="separator" />
            <div className="px-2">
              <div className="text-sm text-muted-foreground cursor-pointer px-2" onClick={resetFilters}>
                Reset filters
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <input type="hidden" name="sprout-stage-filter-value" value="" />
    </div>
  );

  const totalCards = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <PieCard
      title="Cards by stage"
      subtitle="All decks"
      infoText="Breakdown of your cards by learning stage using current scheduler state."
      data={data}
      headerSlot={headerSlot}
      highlightLabel="New"
      centerValue={totalCards.toLocaleString()}
      centerLabel="Flashcards"
    />
  );
}

export function AnswerButtonsPieCard(props: { events: Record<string, unknown>[]; nowMs: number }) {
  const [open, setOpen] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState<string>("all");
  const [deckQuery, setDeckQuery] = React.useState("");
  const [groupQuery, setGroupQuery] = React.useState("");
  const [selectedDecks, setSelectedDecks] = React.useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  const availableTypes = React.useMemo(() => ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"], []);

  const getEventDeck = React.useCallback((ev: Record<string, unknown>) => {
    const raw = ev?.sourceNotePath ?? ev?.deckPath ?? ev?.deck;
    const deck =
      typeof raw === "string"
        ? raw
        : typeof raw === "number"
          ? String(raw)
          : "";
    return deck.trim();
  }, []);

  const getEventGroups = React.useCallback((ev: Record<string, unknown>) => {
    if (Array.isArray(ev?.groups)) return (ev.groups as unknown[]).filter(Boolean);
    if (Array.isArray(ev?.tags)) return (ev.tags as unknown[]).filter(Boolean);
    return [];
  }, []);

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
    const placePopover = () => {
      const wrap = wrapRef.current;
      const popover = popoverRef.current;
      if (!wrap || !popover) return;
      popover.classList.remove("sprout-ana-popover-left");
      popover.classList.add("sprout-ana-popover-right");
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const cutoff = props.nowMs - 30 * 24 * 60 * 60 * 1000;
  const recentEvents = React.useMemo(() => {
    return (props.events ?? []).filter((ev) => {
      if (!ev || ev.kind !== "review") return false;
      const at = Number(ev.at);
      if (!Number.isFinite(at) || at < cutoff) return false;
      return true;
    });
  }, [props.events, cutoff]);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const ev of recentEvents) {
      const deck = getEventDeck(ev);
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [recentEvents, getEventDeck]);

  const allGroups = React.useMemo(() => {
    const groups = new Set<string>();
    for (const ev of recentEvents) {
      const eventGroups = getEventGroups(ev);
      for (const group of eventGroups) {
        if (!group || typeof group !== "string") continue;
        const trimmed = group.trim();
        if (trimmed) groups.add(trimmed);
      }
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [recentEvents, getEventGroups]);

  const matchedDecks = React.useMemo(() => {
    const query = deckQuery.trim().toLowerCase();
    if (!query) return [];
    return allDecks.filter((deck) => deck.toLowerCase().includes(query)).slice(0, 3);
  }, [allDecks, deckQuery]);

  const matchedGroups = React.useMemo(() => {
    const query = groupQuery.trim().toLowerCase();
    if (!query) return [];
    return allGroups.filter((group) => group.toLowerCase().includes(query)).slice(0, 3);
  }, [allGroups, groupQuery]);

  const typeCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of availableTypes) counts.set(type, 0);
    for (const ev of recentEvents) {
      const rawType = ev.cardType;
      const t = normalizeEventType(
        typeof rawType === "string"
          ? rawType
          : typeof rawType === "number"
            ? String(rawType)
            : "unknown",
      );
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
  }, [availableTypes, recentEvents]);

  const counts = React.useMemo(() => {
    const out: Record<string, number> = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const ev of recentEvents) {
      const rawType = ev.cardType;
      const t = normalizeEventType(
        typeof rawType === "string"
          ? rawType
          : typeof rawType === "number"
            ? String(rawType)
            : "",
      );
      if (selectedType !== "all" && t !== selectedType) continue;
      if (selectedDecks.length) {
        const deck = getEventDeck(ev);
        if (!deck || !selectedDecks.includes(deck)) continue;
      }
      if (selectedGroups.length) {
        const groups = getEventGroups(ev);
        const hasGroup = selectedGroups.some((group) => groups.includes(group));
        if (!hasGroup) continue;
      }
      const rawResult = ev.result;
      const result =
        typeof rawResult === "string"
          ? rawResult
          : typeof rawResult === "number"
            ? String(rawResult)
            : "";
      if (result in out) out[result] += 1;
    }
    return out;
  }, [recentEvents, selectedType, selectedDecks, selectedGroups, getEventDeck, getEventGroups]);

  const rows: Array<[string, number]> = [
    ["Again", counts.again ?? 0],
    ["Hard", counts.hard ?? 0],
    ["Good", counts.good ?? 0],
    ["Easy", counts.easy ?? 0],
  ];

  const data = React.useMemo(() => buildData(rows), [counts]);
  const totalAnswered = counts.again + counts.hard + counts.good + counts.easy;

  const headerSlot = (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        id="sprout-answer-filter-trigger"
        className="btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls="sprout-answer-filter-listbox"
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
          id="sprout-answer-filter-popover"
          aria-hidden="false"
          ref={popoverRef}
          data-popover="true"
          className="sprout dropdown-menu w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col sprout-ana-popover sprout-ana-popover-left"
        >
          <div className="p-1">
            <div className="text-sm text-muted-foreground px-2 py-1">Card type</div>
            <div
              role="menu"
              id="sprout-answer-filter-listbox"
              aria-orientation="vertical"
              data-tooltip="Answer filter"
              className="flex flex-col"
            >
              {availableTypes.map((type) => {
                const label = typeLabels[type] ?? type;
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

            <div className="h-px bg-border my-1" role="separator" />
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
                        onClick={() =>
                          setSelectedDecks((prev) => {
                            if (prev.includes(deck)) return prev.filter((d) => d !== deck);
                            if (prev.length >= 3) return prev;
                            return [...prev, deck];
                          })
                        }
                      >
                        <span className="size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                          {selectedDecks.includes(deck) ? <span className="size-1.5 rounded-full bg-foreground" /> : null}
                        </span>
                        <span className={`truncate ${startTruncateClass}`}>
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

            <div className="h-px bg-border my-1" role="separator" />
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
                        onClick={() =>
                          setSelectedGroups((prev) => {
                            if (prev.includes(group)) return prev.filter((g) => g !== group);
                            if (prev.length >= 3) return prev;
                            return [...prev, group];
                          })
                        }
                      >
                        <span className="size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                          {selectedGroups.includes(group) ? <span className="size-1.5 rounded-full bg-foreground" /> : null}
                        </span>
                        <span className={`truncate ${startTruncateClass}`}>
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

            <div className="h-px bg-border my-1" role="separator" />
            <div className="px-2">
              <div
                className="text-sm text-muted-foreground cursor-pointer px-2"
                onClick={() => {
                  setSelectedType("all");
                  setSelectedDecks([]);
                  setSelectedGroups([]);
                  setDeckQuery("");
                  setGroupQuery("");
                }}
              >
                Reset filters
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <PieCard
      title="Answer buttons"
      subtitle="Last 30 days"
      infoText="Summary of review outcomes (Again/Hard/Good/Easy) over the recent window."
      data={data}
      highlightLabel="Again"
      headerSlot={headerSlot}
      centerValue={totalAnswered.toLocaleString()}
      centerLabel="Flashcards answered"
    />
  );
}
