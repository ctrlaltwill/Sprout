// chartfilter menu

import * as React from "react";
import { useAnalyticsPopoverZIndex } from "./filter-styles";

const MAX_SELECTIONS = 3;

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

function toggleSelection(
  value: string,
  selected: string[],
  setter: React.Dispatch<React.SetStateAction<string[]>>,
) {
  setter((prev) => {
    if (prev.includes(value)) return prev.filter((item) => item !== value);
    if (prev.length >= MAX_SELECTIONS) return prev;
    return [...prev, value];
  });
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
      const wrap = wrapRef.current;
      const popover = popoverRef.current;
      if (!wrap || !popover) return;
      const rect = wrap.getBoundingClientRect();
      const alignRight = rect.left > window.innerWidth / 2;
      popover.style.position = "absolute";
      popover.style.top = "calc(100% + 6px)";
      if (alignRight) {
        popover.style.right = "0px";
        popover.style.left = "auto";
      } else {
        popover.style.left = "0px";
        popover.style.right = "auto";
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, wrapRef, popoverRef]);
}

type DurationFilterProps = {
  durationOptions: number[];
  durationDays: number;
  onDurationChange: (days: number) => void;
  triggerId: string;
};

export function DurationFilter(props: DurationFilterProps) {
  const { durationOptions, durationDays, onDurationChange, triggerId } = props;
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  useCloseOnOutsideClick(open, wrapRef, popoverRef, () => setOpen(false));
  usePopoverPlacement(open, wrapRef, popoverRef);

  return (
    <div ref={wrapRef} className="bc relative">
      <button
        type="button"
        id={triggerId}
        className="bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={`${triggerId}-listbox`}
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
          ref={popoverRef}
          aria-hidden="false"
          data-popover="true"
          className="bc sprout dropdown-menu w-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col"
          style={{ zIndex: 1000 }}
        >
          <div className="bc p-1">
            <div className="bc text-sm text-muted-foreground px-2 py-1">Duration</div>
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
                    onClick={() => {
                      onDurationChange(opt);
                      setOpen(false);
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AdvancedChartFilterProps = {
  durationOptions: number[];
  durationDays: number;
  setDurationDays: React.Dispatch<React.SetStateAction<number>>;
  availableTypes: string[];
  selectedType: string;
  setSelectedType: React.Dispatch<React.SetStateAction<string>>;
  typeCounts: Map<string, number>;
  typeLabels: Record<string, string>;
  allDecks: string[];
  deckQuery: string;
  setDeckQuery: React.Dispatch<React.SetStateAction<string>>;
  selectedDecks: string[];
  setSelectedDecks: React.Dispatch<React.SetStateAction<string[]>>;
  allGroups: string[];
  groupQuery: string;
  setGroupQuery: React.Dispatch<React.SetStateAction<string>>;
  selectedGroups: string[];
  setSelectedGroups: React.Dispatch<React.SetStateAction<string[]>>;
  resetFilters: () => void;
  triggerId: string;
  defaultDurationDays: number;
};

export function AdvancedChartFilter(props: AdvancedChartFilterProps) {
  const {
    durationOptions,
    durationDays,
    setDurationDays,
    availableTypes,
    selectedType,
    setSelectedType,
    typeCounts,
    typeLabels,
    allDecks,
    deckQuery,
    setDeckQuery,
    selectedDecks,
    setSelectedDecks,
    allGroups,
    groupQuery,
    setGroupQuery,
    selectedGroups,
    setSelectedGroups,
    resetFilters,
    triggerId,
    defaultDurationDays,
  } = props;

  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  useCloseOnOutsideClick(open, wrapRef, popoverRef, () => setOpen(false));
  usePopoverPlacement(open, wrapRef, popoverRef);

  const filteredDecks = React.useMemo(() => rankFilterMatches(allDecks, deckQuery, 5), [allDecks, deckQuery]);
  const filteredGroups = React.useMemo(() => rankFilterMatches(allGroups, groupQuery, 5), [allGroups, groupQuery]);

  const toggleSelectionLocal = (
    value: string,
    selected: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter((prev) => {
      if (prev.includes(value)) return prev.filter((item) => item !== value);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, value];
    });
  };

  const hasActiveFilters =
    selectedType !== availableTypes[0] ||
    selectedDecks.length > 0 ||
    selectedGroups.length > 0 ||
    durationDays !== defaultDurationDays;

  const resetToneClass = hasActiveFilters ? "" : "text-muted-foreground";

  return (
    <div ref={wrapRef} className="bc relative flex items-center gap-2">
      <button
        type="button"
        id={triggerId}
        className="bc btn-outline h-7 px-2 text-sm inline-flex items-center gap-2"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={`${triggerId}-listbox`}
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

      <button
        type="button"
        className={`bc inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 focus-visible:shadow-outline ${resetToneClass}`}
        onClick={() => {
          setOpen(false);
          resetFilters();
        }}
      >
        <svg
          className="bc svg-icon lucide-funnel-x"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: hasActiveFilters ? "var(--text-normal)" : "var(--text-muted-foreground)",
          }}
        >
          <path d="M3 4h18l-7 8v5l-4 3v-8z" />
          <path d="M14 11l5 5" />
          <path d="M19 11l-5 5" />
        </svg>
        <span className={hasActiveFilters ? "bc" : "bc text-muted-foreground"}>Reset filters</span>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          aria-hidden="false"
          data-popover="true"
          className="bc sprout dropdown-menu w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col"
          style={{ zIndex: 1000 }}
        >
          <div className="bc p-1">
            <div className="bc text-sm text-muted-foreground px-2 py-1">Duration</div>
            <div role="menu" aria-orientation="vertical" data-tooltip="Chart filter" className="bc flex flex-col">
              {durationOptions.map((opt) => {
                const selected = durationDays === opt;
                return (
                  <div
                    key={`duration-${opt}`}
                    role="menuitemradio"
                    aria-checked={selected ? "true" : "false"}
                    tabIndex={0}
                    className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                    onClick={() => {
                      setDurationDays(opt);
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

            <div className="bc h-px bg-border my-2" role="separator" />

            <div className="bc text-sm text-muted-foreground px-2 py-1">Card type</div>
            <div role="menu" aria-orientation="vertical" className="bc flex flex-col">
              {availableTypes.map((type) => {
                const label = typeLabels[type] ?? type;
                const counts = typeCounts.get(type) ?? 0;
                const selected = selectedType === type;
                return (
                  <div
                    key={`type-${type}`}
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
                      <span className="bc text-muted-foreground">{`(${counts})`}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="bc h-px bg-border my-2" role="separator" />

            <div className="bc text-sm text-muted-foreground px-2 py-1">Decks</div>
            <div className="bc px-2 pb-2">
              <input
                className="bc input w-full text-sm"
                type="text"
                placeholder="Search decks"
                value={deckQuery}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setDeckQuery(next);
                }}
              />
            </div>

            {deckQuery.trim().length || selectedDecks.length ? (
              <div className="bc px-2 pb-2">
                <div className="bc flex flex-col">
                  {[...new Set(selectedDecks)].map((deck) => (
                    <div
                      key={`deck-selected-${deck}`}
                      role="menuitem"
                      tabIndex={0}
                      className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                      onClick={() => toggleSelectionLocal(deck, selectedDecks, setSelectedDecks)}
                    >
                      <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                        <span className="bc size-1.5 rounded-full bg-foreground" />
                      </span>
                      <span className="bc truncate" style={{ display: "block", overflow: "hidden" }}>
                        {formatFilterPath(deck)}
                      </span>
                    </div>
                  ))}
                  {deckQuery.trim().length ? (
                    filteredDecks.length ? (
                      filteredDecks
                        .filter((deck) => !selectedDecks.includes(deck))
                        .map((deck) => (
                          <div
                            key={`deck-${deck}`}
                            role="menuitem"
                            tabIndex={0}
                            className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleSelectionLocal(deck, selectedDecks, setSelectedDecks)}
                          >
                            <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center" />
                            <span className="bc truncate" style={{ display: "block", overflow: "hidden" }}>
                              {formatFilterPath(deck)}
                            </span>
                          </div>
                        ))
                    ) : (
                      <div className="bc px-2 py-1 text-sm text-muted-foreground">No decks found.</div>
                    )
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="bc h-px bg-border my-2" role="separator" />

            <div className="bc text-sm text-muted-foreground px-2 py-1">Groups</div>
            <div className="bc px-2 pb-2">
              <input
                className="bc input w-full text-sm"
                type="text"
                placeholder="Search groups"
                value={groupQuery}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setGroupQuery(next);
                }}
              />
            </div>

            {groupQuery.trim().length || selectedGroups.length ? (
              <div className="bc px-2 pb-2">
                <div className="bc flex flex-col">
                  {[...new Set(selectedGroups)].map((group) => (
                    <div
                      key={`group-selected-${group}`}
                      role="menuitem"
                      tabIndex={0}
                      className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                      onClick={() => toggleSelectionLocal(group, selectedGroups, setSelectedGroups)}
                    >
                      <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                        <span className="bc size-1.5 rounded-full bg-foreground" />
                      </span>
                      <span className="bc truncate" style={{ display: "block", overflow: "hidden" }}>
                        {formatFilterPath(group)}
                      </span>
                    </div>
                  ))}
                  {groupQuery.trim().length ? (
                    filteredGroups.length ? (
                      filteredGroups
                        .filter((group) => !selectedGroups.includes(group))
                        .map((group) => (
                          <div
                            key={`group-${group}`}
                            role="menuitem"
                            tabIndex={0}
                            className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleSelectionLocal(group, selectedGroups, setSelectedGroups)}
                          >
                            <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center" />
                            <span className="bc truncate" style={{ display: "block", overflow: "hidden" }}>
                              {formatFilterPath(group)}
                            </span>
                          </div>
                        ))
                    ) : (
                      <div className="bc px-2 py-1 text-sm text-muted-foreground">No groups found.</div>
                    )
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
