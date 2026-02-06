import * as React from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { endTruncateStyle, useAnalyticsPopoverZIndex } from "./filter-styles";

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

function formatFilterPath(raw: string, maxChars = 40) {
  let text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  if (lower.endsWith(".md")) text = text.slice(0, -3);
  text = text.replace(/\s*\/\s*/g, " / ");
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars).trimStart();
  return `...${tail}`;
}

type DifficultyRetrievabilityChartProps = {
  cards: Array<{ id: string; type?: string; sourceNotePath?: string; groups?: string[] }>;
  states: Record<string, any>;
};

type DataPoint = {
  x: number; // normalized difficulty 0-1
  difficultyRaw: number; // original 0-10 value
  retrievability: number; // 0-1 (displayed with exponential scale)
  retrievabilityRaw: number; // original 0-1 value (for tooltip)
  cardCount: number; // for aggregation
};

function createDistribution(
  cards: Array<{ id: string; type?: string; sourceNotePath?: string; groups?: string[] }>,
  states: Record<string, any>
): DataPoint[] {
  const pointsMap = new Map<string, DataPoint>();

  for (const card of cards) {
    const state = states[String(card.id)];
    if (!state || typeof state !== "object") continue;

    // FSRS difficulty is 0-10 scale
    const difficultyRaw = Number(state.difficulty ?? 0);
    if (!Number.isFinite(difficultyRaw)) continue;

    // Retrievability is already 0-1, default to 0 (no data) for new cards
    const retrievabilityRaw = Number(state.retrievability ?? 0);
    if (!Number.isFinite(retrievabilityRaw)) continue;

    // Normalize difficulty to 0-1
    const normalizedDifficulty = Math.max(0, Math.min(1, difficultyRaw / 10));

    // Apply exponential scale (sqrt) to retrievability to expand 0.9-1 range
    const retrievabilityScaled = Math.sqrt(Math.max(0, Math.min(1, retrievabilityRaw)));

    // Create key for aggregation (round to 0.02 precision to group similar cards)
    const key = `${normalizedDifficulty.toFixed(2)}_${retrievabilityRaw.toFixed(2)}`;

    const existing = pointsMap.get(key);
    if (existing) {
      existing.cardCount += 1;
    } else {
      pointsMap.set(key, {
        x: normalizedDifficulty,
        difficultyRaw,
        retrievability: retrievabilityScaled,
        retrievabilityRaw,
        cardCount: 1,
      });
    }
  }

  return Array.from(pointsMap.values()).sort((a, b) => a.x - b.x);
}

export function DifficultyRetrievabilityChart(props: DifficultyRetrievabilityChartProps) {
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
    return ["all", "basic", "cloze-child", "io-child", "mcq"];
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
      popover.style.left = "auto";
      popover.style.right = "0px";
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const filteredCards = React.useMemo(() => {
    return (props.cards ?? []).filter((card) => {
      if (!card) return false;
      if (card.type === "cloze" && Array.isArray((card as any).clozeChildren) && (card as any).clozeChildren.length)
        return false;
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

  const data = React.useMemo(() => createDistribution(filteredCards, props.states), [filteredCards, props.states]);

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

  const resetFilters = () => {
    setSelectedType("all");
    setSelectedDecks([]);
    setSelectedGroups([]);
    setDeckQuery("");
    setTagQuery("");
    setCardTypesOpen(false);
    setOpen(false);
  };

  return (
    <div className="bc card sprout-ana-card p-4 flex flex-col gap-3" style={{ minHeight: "360px", overflow: "visible" }}>
      <div className="bc flex items-start justify-between gap-2">
        <div>
          <div className="bc flex items-center gap-1">
            <div className="bc font-semibold">Difficulty & Retrievability</div>
            <InfoIcon text="Scatter of card difficulty vs current retrievability; larger bubbles mean more cards." />
          </div>
          <div className="bc text-xs text-muted-foreground">Distribution by metric</div>
        </div>

        <div ref={wrapRef} className="bc relative inline-flex">
          <button
            type="button"
            id="sprout-diff-ret-filter-trigger"
            className="bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
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
              id="sprout-diff-ret-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className="bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col"
              style={{ position: "absolute", top: "calc(100% + 6px)", zIndex: 1000, minWidth: "250px" }}
            >
              <div className="bc p-1">
                <div
                  className="bc flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  onClick={() => setCardTypesOpen((prev) => !prev)}
                >
                  <span>Card Types</span>
                  <ChevronIcon open={cardTypesOpen} />
                </div>

                {cardTypesOpen ? (
                  <div className="bc px-2 pb-2">
                    <div className="bc flex flex-col">
                      {availableTypes.map((type) => (
                        <div
                          key={type}
                          role="menuitem"
                          tabIndex={0}
                          className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => setSelectedType(type)}
                        >
                          <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                            {selectedType === type ? <span className="bc size-1.5 rounded-full bg-foreground" /> : null}
                          </span>
                          <span>{type === "all" ? "All cards" : type}</span>
                        </div>
                      ))}
                    </div>
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
                            <span className="bc truncate" style={endTruncateStyle}>
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
                    value={tagQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTagQuery(next);
                      if (!next.trim()) setSelectedGroups([]);
                    }}
                  />
                </div>

                {tagQuery.trim().length ? (
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
                            <span className="bc truncate" style={endTruncateStyle}>
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

      <div className="bc w-full" style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: "700px", height: "250px" }}>
          <ResponsiveContainer width="100%" height={250}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 50 }}>
              <CartesianGrid />

              {/* Zone background areas */}
              <ReferenceArea y1={0} y2={0.5} x1={0} x2={5} fill="#ff6b6b" fillOpacity={0.08} />
              <ReferenceArea y1={0.5} y2={1} x1={0} x2={5} fill="#4dabf7" fillOpacity={0.08} />
              <ReferenceArea y1={0} y2={0.5} x1={5} x2={10} fill="#ffa94d" fillOpacity={0.08} />
              <ReferenceArea y1={0.5} y2={1} x1={5} x2={10} fill="#51cf66" fillOpacity={0.08} />

              {/* Reference lines */}
              <ReferenceLine y={0.5} stroke="var(--border)" strokeDasharray="5 5" strokeWidth={1.5} />
              <ReferenceLine x={5} stroke="var(--border)" strokeDasharray="5 5" strokeWidth={1.5} />

              <XAxis
                dataKey="difficultyRaw"
                type="number"
                name="Difficulty"
                unit="/10"
                tick={{ fontSize: 11 }}
                ticks={[0, 5, 10]}
                label={{ value: "Difficulty (0-10)", position: "bottom", offset: 5, fontSize: 11 }}
                domain={[0, 10]}
              />
              <YAxis
                dataKey="retrievability"
                type="number"
                name="Retrievability"
                unit="%"
                tickLine={false}
                axisLine={false}
                width={50}
                tick={{ fontSize: 11 }}
                ticks={[0, 0.5, 1]}
                label={{ value: "Retrievability", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }}
                domain={[0, 1]}
              />

              {/* Quadrant labels */}
              <text
                x="2.5"
                y="0.25"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight="bold"
                fill="var(--text-muted)"
                opacity={0.7}
              >
                Failure Zone
              </text>
              <text
                x="2.5"
                y="0.75"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight="bold"
                fill="var(--text-muted)"
                opacity={0.7}
              >
                Leech Zone
              </text>
              <text
                x="7.5"
                y="0.25"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight="bold"
                fill="var(--text-muted)"
                opacity={0.7}
              >
                Struggling
              </text>
              <text
                x="7.5"
                y="0.75"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight="bold"
                fill="var(--text-muted)"
                opacity={0.7}
              >
                Comfort Zone
              </text>

              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{
                  backgroundColor: "#000",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  color: "#fff",
                  fontSize: 12,
                  maxWidth: 280,
                }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length > 0) {
                    const dataPoint = payload[0].payload as DataPoint;
                    return (
                      <div
                        style={{
                          backgroundColor: "#000",
                          border: "1px solid #333",
                          borderRadius: "6px",
                          padding: "10px 12px",
                          fontSize: 12,
                          color: "#fff",
                        }}
                      >
                        <p>
                          <strong>Difficulty:</strong> {dataPoint.difficultyRaw.toFixed(2)} / 10
                        </p>
                        <p>
                          <strong>Retrievability:</strong> {(dataPoint.retrievabilityRaw * 100).toFixed(1)}%
                        </p>
                        {dataPoint.retrievabilityRaw === 0 && (
                          <p style={{ fontSize: 10, color: "#999", marginTop: 4 }}>(No review data — needs 2+ reviews)</p>
                        )}
                        <p>
                          <strong>Cards:</strong> {dataPoint.cardCount}
                        </p>
                        <p
                          style={{
                            fontSize: 10,
                            color: "#999",
                            marginTop: 4,
                            borderTop: "1px solid #333",
                            paddingTop: 4,
                          }}
                        >
                          Larger bubbles = more cards at this difficulty/retrievability combination
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />

              <Scatter
                name="Cards"
                data={data}
                fill="#8884d8"
                activeShape={{ fill: "#ff6b6b" }}
                shape="circle"
                isAnimationActive={true}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bc flex flex-col gap-3 text-xs">
        <p className="bc font-semibold text-sm">Understanding Each Zone:</p>

        <div className="bc p-2 rounded border" style={{ backgroundColor: "rgba(255, 107, 107, 0.1)", borderColor: "#ff6b6b" }}>
          <p className="bc font-semibold text-red-600">🔴 Lower-Left: "Failure Zone"</p>
          <p className="bc text-xs text-muted-foreground">
            Easy cards (D&lt;5) seen too late (R&lt;0.5). Check card quality, cues, or scheduler parameters.
          </p>
        </div>

        <div className="bc p-2 rounded border" style={{ backgroundColor: "rgba(77, 171, 247, 0.1)", borderColor: "#4dabf7" }}>
          <p className="bc font-semibold text-blue-600">🔵 Upper-Left: "Leech Zone"</p>
          <p className="bc text-xs text-muted-foreground">
            Hard cards (D&lt;5) with low recall (R≥0.5). Rewrite, split, or suspend. Priority for improvement!
          </p>
        </div>

        <div className="bc p-2 rounded border" style={{ backgroundColor: "rgba(255, 165, 77, 0.1)", borderColor: "#ffa94d" }}>
          <p className="bc font-semibold text-orange-600">🟠 Upper-Right: "Struggling"</p>
          <p className="bc text-xs text-muted-foreground">
            Very hard cards (D≥5) with low recall (R&lt;0.5). Consider simplifying card design or add context cues.
          </p>
        </div>

        <div className="bc p-2 rounded border" style={{ backgroundColor: "rgba(81, 207, 102, 0.1)", borderColor: "#51cf66" }}>
          <p className="bc font-semibold text-green-600">🟢 Lower-Right: "Comfort Zone"</p>
          <p className="bc text-xs text-muted-foreground">Very hard cards (D≥5) seen on time (R≥0.5). Ideal state — keep going!</p>
        </div>

        <p className="bc text-xs text-muted-foreground mt-2 italic">
          💡 <strong>Tip:</strong> Larger bubbles = more cards clustered at that difficulty/retrievability combination. Focus on zones with large bubbles.
        </p>
      </div>
    </div>
  );
}
