/**
 * @file src/analytics/forgetting-curve-chart.tsx
 * @summary Interactive forgetting-curve chart that lets users search for and select
 * up to three cards, then plots each card's FSRS retrievability over time as a line
 * chart. It replays each card's review history through the scheduler to reconstruct
 * a stability timeline and uses the FSRS forgetting curve formula to project future
 * memory retention.
 *
 * @exports
 *   - ForgettingCurveChart — React component rendering a multi-card forgetting-curve line chart with card search and selection
 */

import * as React from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { generatorParameters, forgetting_curve } from "ts-fsrs";
import type { CardRecord, CardState, ReviewLogEntry } from "../core/store";
import type { ReviewResult } from "../types/review";
import { gradeFromPassFail, gradeFromRating, resetCardScheduling, type SchedulerSettings } from "../scheduler/scheduler";
import { useAnalyticsPopoverZIndex } from "./filter-styles";
import { cssClassForProps } from "../core/ui";

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

const MS_DAY = 24 * 60 * 60 * 1000;
const MAX_SELECTIONS = 3;
const DEFAULT_SCHEDULER: SchedulerSettings = {
  learningStepsMinutes: [10, 1440],
  relearningStepsMinutes: [10],
  requestRetention: 0.9,
};

const LINE_COLORS = [
  "var(--chart-accent-1)",
  "var(--chart-accent-2)",
  "var(--chart-accent-3)",
  "var(--chart-accent-4)",
  "var(--theme-accent)",
];

function createEmptySearch(): SearchState {
  return { query: "", error: null };
}

type CurveMeta = {
  id: string;
  label: string;
  color: string;
  stabilityDays: number;
  lastReviewAt: number;
  firstReviewAt: number;
  horizon: number;
  timeline: Array<{ at: number; stability: number }>;
  title?: string | null;
  currentRetrievability?: number | null;
  elapsedDays?: number | null;
};

type CurveIssue = {
  id: string;
  reason: string;
};

type DataRow = {
  day: number;
  [key: string]: number | null;
};

type SearchResult = {
  id: string;
  label: string;
  location: string;
  title: string;
  preview: string;
  score: number;
};

type SearchState = {
  query: string;
  error: string | null;
};

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function minutesToStepUnit(m: number): `${number}m` | `${number}h` | `${number}d` {
  const mm = Math.max(1, Math.round(m));
  if (mm % 1440 === 0) return `${mm / 1440}d`;
  if (mm % 60 === 0) return `${mm / 60}h`;
  return `${mm}m`;
}

function buildFsrsParams(cfg?: SchedulerSettings | null) {
  const safeCfg = cfg ?? DEFAULT_SCHEDULER;
  const learning = (safeCfg.learningStepsMinutes ?? []).map(minutesToStepUnit);

  const relearningRaw = Array.isArray(safeCfg.relearningStepsMinutes) ? safeCfg.relearningStepsMinutes : [];
  const relearning =
    relearningRaw.length > 0
      ? relearningRaw.map(minutesToStepUnit)
      : [(learning.length ? learning[0] : "10m")];

  const requestRetention = clamp(Number(safeCfg.requestRetention) || 0.9, 0.8, 0.97);

  return generatorParameters({
    request_retention: requestRetention,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: learning.length ? learning : ["10m"],
    relearning_steps: relearning,
  });
}

function extractNineDigitId(raw: string): string | null {
  const match = raw.match(/\d{9}/);
  return match ? match[0] : null;
}

function formatCardLabel(id: string) {
  const digits = extractNineDigitId(id);
  return digits ?? id;
}

function normalizeSearchText(raw: string) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatLocation(path: string | null | undefined) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/\.md$/i, "").replace(/\s*\/\s*/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  if (!parts.length) return "";
  const tail = parts.slice(-2).join("/");
  return parts.length > 2 ? `.../${tail}` : tail;
}

function getQuestionPreview(card: CardRecord, maxChars = 48) {
  const raw =
    card.q ??
    card.stem ??
    card.clozeText ??
    card.prompt ??
    "";
  const cleaned = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1)}…`;
}

function getCardStability(state?: CardState | null) {
  if (!state) return 0;
  if (state.stage === "new") return 0;
  const stabilityDays = Number(state.stabilityDays ?? 0);
  if (Number.isFinite(stabilityDays) && stabilityDays > 0) return Math.max(0.1, stabilityDays);
  const scheduledDays = Number(state.scheduledDays ?? 0);
  if (state.stage === "review" && Number.isFinite(scheduledDays) && scheduledDays > 0) return Math.max(0.1, scheduledDays);
  return 0;
}

function normalizeReviewResult(result: ReviewResult | null | undefined): Exclude<ReviewResult, "skip"> | null {
  const r = String(result ?? "").toLowerCase();
  if (r === "pass" || r === "fail") return r;
  if (r === "again" || r === "hard" || r === "good" || r === "easy") return r;
  if (r === "skip") return null;
  return null;
}

function buildStabilityTimeline(
  cardId: string,
  entries: ReviewLogEntry[],
  scheduler: SchedulerSettings,
): Array<{ at: number; stability: number }> {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  let state: CardState = resetCardScheduling(
    {
      id: cardId,
      stage: "new",
      due: sorted[0].at,
      reps: 0,
      lapses: 0,
      learningStepIndex: 0,
      scheduledDays: 0,
    },
    sorted[0].at,
  );

  const timeline: Array<{ at: number; stability: number }> = [];
  for (const entry of sorted) {
    const rating = normalizeReviewResult(entry.result);
    if (!rating) continue;
    const now = Number(entry.at);
    const graded =
      rating === "pass" || rating === "fail"
        ? gradeFromPassFail(state, rating, now, { scheduling: scheduler })
        : gradeFromRating(state, rating, now, { scheduling: scheduler });
    state = graded.nextState;
    const stability = getCardStability(state);
    timeline.push({ at: now, stability });
  }
  return timeline;
}

function CardCurveTooltip(props: { active?: boolean; payload?: Array<{ value?: number; name?: string; dataKey?: string; color?: string }>; label?: number; baseStart: number }) {
  if (!props.active || !props.payload?.length) return null;
  const dayIndex = typeof props.label === "number" ? props.label : 0;
  const date = new Date(props.baseStart + dayIndex * MS_DAY).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="bc sprout-data-tooltip-surface">
      <div className="bc text-sm font-medium text-background">{date}</div>
      {props.payload.map((entry) => {
        const value = Number(entry?.value ?? 0);
        const idLabel = String(entry?.name ?? entry?.dataKey ?? "");
        return (
          <div key={entry.dataKey} className="bc flex items-center gap-2">
            <span
              className={`bc inline-block size-2 rounded-full sprout-ana-legend-dot ${cssClassForProps({ "--sprout-legend-color": entry.color })}`}
            />
            <span className="bc text-background">{idLabel}</span>
            <span className="bc text-background">{Math.round(value * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

export function ForgettingCurveChart(props: {
  cards: CardRecord[];
  states: Record<string, CardState>;
  reviewLog?: ReviewLogEntry[];
  scheduler?: SchedulerSettings | null;
  nowMs: number;
  enableAnimations?: boolean;
}) {
  const [search, setSearch] = React.useState<SearchState>(() => createEmptySearch());
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const seededRef = React.useRef(false);
  const [open, setOpen] = React.useState(false);

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const popover = popoverRef.current;
    if (!popover) return undefined;
    popover.classList.add("sprout-ana-popover", "sprout-ana-popover-right", "sprout-ana-popover-md");
    return undefined;
  }, [open]);


  const cardById = React.useMemo(() => {
    const map = new Map<string, CardRecord>();
    for (const card of props.cards ?? []) {
      if (!card) continue;
      map.set(String(card.id), card);
    }
    return map;
  }, [props.cards]);

  const reviewLog = React.useMemo(() => props.reviewLog ?? [], [props.reviewLog]);

  React.useEffect(() => {
    if (seededRef.current) return;
    if (!reviewLog.length) return;
    if (selectedIds.length) return;

    const lastById = new Map<string, number>();
    for (const entry of reviewLog) {
      if (!entry || !entry.at) continue;
      const id = String(entry.id ?? "");
      if (!id) continue;
      const at = Number(entry.at);
      if (!Number.isFinite(at)) continue;
      const prev = lastById.get(id) ?? 0;
      if (at > prev) lastById.set(id, at);
    }

    const top = Array.from(lastById.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SELECTIONS)
      .map(([id]) => id)
      .filter((id) => cardById.has(id));

    if (top.length) {
      setSelectedIds(top);
      seededRef.current = true;
    }
  }, [reviewLog, selectedIds.length, cardById]);

  const searchIndex = React.useMemo(() => {
    const PARENT_TYPES = new Set(["cloze", "reversed", "io", "io-parent", "io_parent", "ioparent"]);
    return (props.cards ?? [])
      .filter((card) => !PARENT_TYPES.has(String(card?.type ?? "").toLowerCase()))
      .map((card) => {
      const id = String(card.id);
      const label = formatCardLabel(id);
      const idDigits = extractNineDigitId(id) ?? "";
      const title = String(card.title ?? "").trim();
      const location = formatLocation(card.sourceNotePath);
      const preview = getQuestionPreview(card);
      const combined = normalizeSearchText([id, idDigits, title, location, preview].join(" "));
      return { card, id, label, idDigits, title, location, preview, combined };
    });
  }, [props.cards]);

  const getSearchResults = React.useCallback(
    (query: string) => {
      const q = normalizeSearchText(query);
      if (!q) return [] as SearchResult[];

      const results: SearchResult[] = [];
      for (const entry of searchIndex) {
        let score = 99;
        const idMatch = entry.idDigits && entry.idDigits === q;
        const idIncludes = entry.idDigits && entry.idDigits.includes(q);
        const titleNorm = normalizeSearchText(entry.title);
        const previewNorm = normalizeSearchText(entry.preview);
        const locationNorm = normalizeSearchText(entry.location);

        if (entry.id === q || idMatch) score = 0;
        else if (idIncludes || entry.id.includes(q)) score = 1;
        else if (titleNorm.startsWith(q)) score = 2;
        else if (titleNorm.includes(q)) score = 3;
        else if (previewNorm.includes(q)) score = 4;
        else if (locationNorm.includes(q)) score = 5;
        else if (entry.combined.includes(q)) score = 6;
        else continue;

        results.push({
          id: entry.id,
          label: entry.label,
          location: entry.location,
          title: entry.title,
          preview: entry.preview,
          score,
        });
      }

      return results
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.label.localeCompare(b.label);
        })
        .slice(0, 5);
    },
    [searchIndex],
  );

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= MAX_SELECTIONS) {
        setSearch((cur) => ({ ...cur, error: `Select up to ${MAX_SELECTIONS} cards.` }));
        return prev;
      }
      return [...prev, id];
    });
  };

  const searchIndexById = React.useMemo(() => {
    const map = new Map<string, (typeof searchIndex)[number]>();
    searchIndex.forEach((entry) => map.set(entry.id, entry));
    return map;
  }, [searchIndex]);

  const selectedResults = React.useMemo(() => {
    const uniq = Array.from(new Set(selectedIds));
    return uniq.map((id) => {
      const entry = searchIndexById.get(id);
      return {
        id,
        label: formatCardLabel(id),
        location: entry?.location ?? "Unknown location",
        preview: entry?.preview ?? "No question text.",
      };
    });
  }, [selectedIds, searchIndexById]);

  const resetFilters = () => {
    setSearch(createEmptySearch());
    setSelectedIds([]);
  };

  const params = React.useMemo(() => buildFsrsParams(props.scheduler), [props.scheduler]);
  const schedulerCfg = React.useMemo(() => props.scheduler ?? DEFAULT_SCHEDULER, [props.scheduler]);

  const { curves, issues, baseStart } = React.useMemo(() => {
    const curveList: CurveMeta[] = [];
    const issueList: CurveIssue[] = [];
    let minFirstReview = Number.POSITIVE_INFINITY;

    selectedIds.forEach((id, index) => {
      const card = cardById.get(id);
      const cardReviews = reviewLog.filter((entry) => String(entry.id) === id);
      const pastReviews = cardReviews.filter((entry) => Number(entry.at) <= props.nowMs);
      const timeline = buildStabilityTimeline(id, pastReviews, schedulerCfg);

      if (!card) {
        issueList.push({ id, reason: "Card not found" });
        return;
      }

      if (!timeline.length) {
        issueList.push({ id, reason: "Not studied yet" });
        return;
      }

      const firstReviewAt = timeline[0]?.at ?? 0;
      const lastReviewAt = timeline[timeline.length - 1]?.at ?? firstReviewAt;
      const elapsedSinceFirst = Math.max(0, (props.nowMs - firstReviewAt) / MS_DAY);
      const horizon = Math.max(1, Math.ceil(elapsedSinceFirst * 2));
      if (Number.isFinite(firstReviewAt) && firstReviewAt > 0) {
        minFirstReview = Math.min(minFirstReview, firstReviewAt);
      }

      const stability = timeline[timeline.length - 1]?.stability ?? 0;
      if (!Number.isFinite(stability) || stability <= 0) {
        issueList.push({ id, reason: "Not studied yet" });
        return;
      }

      const elapsedSinceLast = Math.max(0, (props.nowMs - lastReviewAt) / MS_DAY);
      const currentRetrievability = forgetting_curve(params.w, elapsedSinceLast, stability);

      curveList.push({
        id,
        label: formatCardLabel(id),
        color: LINE_COLORS[index % LINE_COLORS.length],
        stabilityDays: stability,
        lastReviewAt,
        firstReviewAt,
        horizon,
        timeline,
        title: card.title ?? null,
        elapsedDays: elapsedSinceLast,
        currentRetrievability,
      });
    });

    const base = Number.isFinite(minFirstReview) && minFirstReview > 0 ? minFirstReview : props.nowMs;
    return { curves: curveList, issues: issueList, baseStart: base };
  }, [selectedIds, cardById, reviewLog, schedulerCfg, props.nowMs, params.w]);

  const elapsedDays = React.useMemo(
    () => Math.max(14, Math.ceil((props.nowMs - baseStart) / MS_DAY)),
    [props.nowMs, baseStart],
  );
  const maxDays = React.useMemo(() => elapsedDays * 2, [elapsedDays]);

  const data = React.useMemo(() => {
    if (!curves.length) return [] as DataRow[];
    const rows: DataRow[] = [];
    for (let day = 0; day <= maxDays; day += 1) {
      const row: DataRow = { day } as DataRow;
      for (const curve of curves) {
        const { firstReviewAt, timeline } = curve;
        if (!Number.isFinite(firstReviewAt) || !timeline.length) {
          row[curve.id] = 0;
          continue;
        }
        const absoluteTs = baseStart + day * MS_DAY;
        if (absoluteTs < firstReviewAt) {
          row[curve.id] = null;
          continue;
        }
        let active = timeline[0];
        for (let i = 0; i < timeline.length; i += 1) {
          if (timeline[i].at <= absoluteTs) active = timeline[i];
          else break;
        }
        const elapsed = Math.max(0, (absoluteTs - active.at) / MS_DAY);
        row[curve.id] = forgetting_curve(params.w, elapsed, active.stability);
      }
      rows.push(row);
    }
    return rows;
  }, [curves, params.w, baseStart, maxDays]);

  const tickFormatter = (value: number) => {
    const ts = baseStart + Number(value) * MS_DAY;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const yTickFormatter = (value: number) => `${Math.round(Number(value) * 100)}%`;

  const legendItems = React.useMemo(() => {
    const items: Array<{ id: string; label: string; color: string; tooltip?: string; status?: string }> = [];
    const curveIds = new Set<string>();
    for (const curve of curves) {
      curveIds.add(curve.id);
      const card = cardById.get(curve.id);
      const title = curve.title ? String(curve.title) : "";
      const question = card ? getQuestionPreview(card, 80) : "";
      const tooltip = [title, question].filter(Boolean).join(" — ");
      items.push({
        id: curve.id,
        label: curve.label,
        color: curve.color,
        tooltip,
      });
    }
    for (const issue of issues) {
      if (curveIds.has(issue.id)) continue;
      const card = cardById.get(issue.id);
      const title = card ? String(card.title ?? "") : "";
      const question = card ? getQuestionPreview(card, 80) : "";
      const tooltip = [title, question].filter(Boolean).join(" — ");
      items.push({
        id: issue.id,
        label: formatCardLabel(issue.id),
        color: "var(--destructive)",
        tooltip,
        status: issue.reason,
      });
    }
    return items;
  }, [curves, issues, cardById]);

  const legendContent = () => {
    if (!legendItems.length) return null;
    return (
      <div className="bc flex flex-wrap gap-3 text-xs text-muted-foreground sprout-ana-chart-legend">
        {legendItems.map((item) => (
          <div key={item.id} className="bc inline-flex items-center gap-2">
            <span
              className={`bc inline-block sprout-ana-legend-dot sprout-ana-legend-dot-square ${cssClassForProps({ "--sprout-legend-color": item.color })}`}
            />
            <span data-tooltip={item.tooltip || undefined}>{item.label}</span>
            {item.status ? <span className="bc text-muted-foreground">({item.status})</span> : null}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      className="card sprout-ana-card sprout-forgetting-curve-card sprout-ana-overflow-visible p-4 flex flex-col gap-3 h-full"
    >
      <div className="bc flex items-start justify-between gap-2">
        <div>
          <div className="bc flex items-center gap-1">
            <div className="bc font-semibold">Forgetting curve</div>
            <InfoIcon text="Estimated recall probability over time for the selected cards based on review history." />
          </div>
          <div className="bc text-xs text-muted-foreground">Recall probability over time</div>
        </div>

        <div ref={wrapRef} className="bc relative inline-flex">
          <button
            type="button"
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
              aria-hidden="false"
              ref={popoverRef}
              className="bc rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col sprout-ana-popover sprout-ana-popover-right sprout-ana-popover-md"
            >
              <div className="bc p-1">
                <div className="bc text-sm text-muted-foreground px-2 py-1">Search cards</div>
                <div className="bc px-2 pb-2">
                  <input
                    className="bc input w-full text-sm"
                    type="text"
                    placeholder="Search by ID, title, question"
                    value={search.query}
                    onChange={(event) => {
                      setSearch({ query: event.currentTarget.value, error: null });
                    }}
                  />
                </div>

                {search.error ? <div className="bc text-xs text-muted-foreground px-2 pb-2">{search.error}</div> : null}

                {selectedResults.length ? (
                  <div className="bc px-2 pb-2">
                    <div className="bc text-xs text-muted-foreground px-2 pb-1">Selected cards</div>
                    <div className="bc flex flex-col">
                      {selectedResults.map((result) => (
                        <div
                          key={`selected-${result.id}`}
                          role="menuitemradio"
                          aria-checked="true"
                          tabIndex={0}
                          className="bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                          onClick={() => toggleSelection(result.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSelection(result.id);
                            }
                          }}
                        >
                          <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                            <span className="bc size-1.5 rounded-full bg-foreground" />
                          </span>
                          <div className="bc flex flex-col min-w-0">
                            <div className="bc flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span
                                className="bc truncate sprout-ana-truncate-row"
                              >
                                {result.location}
                              </span>
                              <span className="bc shrink-0">{result.label}</span>
                            </div>
                            <div
                              className="bc truncate sprout-ana-truncate"
                            >
                              {result.preview}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {search.query.trim().length ? (
                  <div className="bc px-2 pb-2">
                    {(() => {
                      const selectedSet = new Set(selectedIds);
                      const results = getSearchResults(search.query).filter((result) => !selectedSet.has(result.id));
                      return results.length ? (
                        <div className="bc flex flex-col">
                          {results.map((result) => {
                            const disabled = selectedIds.length >= MAX_SELECTIONS;
                            return (
                              <div
                                key={result.id}
                                role="menuitemradio"
                                aria-checked="false"
                                tabIndex={0}
                                className={
                                  `bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0${disabled ? " is-disabled" : ""}`
                                }
                                onClick={() => {
                                  if (disabled) return;
                                  toggleSelection(result.id);
                                }}
                                onKeyDown={(event) => {
                                  if (disabled) return;
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    toggleSelection(result.id);
                                  }
                                }}
                              >
                                <span className="bc size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center" />
                                <div className="bc flex flex-col min-w-0">
                                  <div className="bc flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                    <span
                                      className="bc truncate sprout-ana-truncate-row"
                                    >
                                      {result.location || "Unknown location"}
                                    </span>
                                    <span className="bc shrink-0">{result.label}</span>
                                  </div>
                                  <div
                                    className="bc truncate sprout-ana-truncate"
                                  >
                                    {result.preview || "No question text."}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="bc text-xs text-muted-foreground">No matches.</div>
                      );
                    })()}
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

      {curves.length ? (
        <div className="bc sprout-analytics-chart">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data} margin={{ top: 28, right: 12, left: 16, bottom: 0 }}>
              <XAxis
                dataKey="day"
                ticks={[0, maxDays / 2, maxDays]}
                tickFormatter={tickFormatter}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={{ stroke: "var(--border)" }}
                label={{ value: "", position: "insideBottomRight", offset: -6 }}
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.5, 1]}
                tickFormatter={yTickFormatter}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={{ stroke: "var(--border)" }}
              />
              <Tooltip content={<CardCurveTooltip baseStart={baseStart} />} />
              {curves.map((curve) => (
                <Line
                  key={curve.id}
                  type="monotone"
                  dataKey={curve.id}
                  name={curve.label}
                  stroke={curve.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={props.enableAnimations ?? true}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bc flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {selectedIds.length ? "Selected cards have not been studied yet." : "Search for cards to plot forgetting curves."}
        </div>
      )}

      <div className="bc sprout-ana-scroll-48">
        {legendContent()}
      </div>

    </div>
  );
}
