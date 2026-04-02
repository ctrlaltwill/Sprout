/**
 * @file src/views/analytics/cards/topic-mastery-card.tsx
 * @summary Module for topic mastery card.
 *
 * @exports
 *  - TopicMasteryCard
 */

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAnalyticsPopoverZIndex } from "../filter-styles";

type CardLike = {
  id: string;
  sourceNotePath?: string;
  groups?: string[] | null;
};

type StateLike = {
  due?: number;
};

type ReviewEventLike = {
  kind?: string;
  cardId?: string;
  result?: string;
  at?: number;
};

type NoteReviewEventLike = {
  kind?: string;
  sourceNotePath?: string;
  action?: string;
  at?: number;
  mode?: "scheduled" | "practice";
};

type TopicRow = {
  key: string;
  folder: string;
  group: string;
  topic: string;
  score: number;
  confidence: number;
  reviews: number;
  dueSoon: number;
};

type ChartRow = {
  key: string;
  score: number;
  confidence: number;
  dueSoon: number;
};

function splitPath(path: string): { folder: string; topic: string } {
  const clean = String(path || "").trim();
  if (!clean) return { folder: "(No folder)", topic: "(Unknown topic)" };
  const parts = clean.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  const topic = last.replace(/\.md$/i, "") || "(Unknown topic)";
  const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(Vault root)";
  return { folder, topic };
}

function bucketKey(folder: string, group: string, topic: string, hierarchy: "folder-group-topic" | "group-topic" | "topic"): string {
  if (hierarchy === "topic") return topic;
  if (hierarchy === "group-topic") return `${group} / ${topic}`;
  return `${folder} / ${group} / ${topic}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function computeRows(input: {
  cards: CardLike[];
  states: Record<string, StateLike>;
  reviewEvents: ReviewEventLike[];
  noteEvents: NoteReviewEventLike[];
  hierarchy: "folder-group-topic" | "group-topic" | "topic";
  includePractice: boolean;
}): TopicRow[] {
  const cardById = new Map<string, CardLike>();
  for (const card of input.cards) cardById.set(String(card.id), card);

  const perKey = new Map<string, {
    folder: string;
    group: string;
    topic: string;
    reviewTotal: number;
    reviewPass: number;
    noteTotal: number;
    notePass: number;
    lastAt: number;
    dueSoon: number;
  }>();

  const getOrCreate = (folder: string, group: string, topic: string) => {
    const key = bucketKey(folder, group, topic, input.hierarchy);
    let row = perKey.get(key);
    if (!row) {
      row = {
        folder,
        group,
        topic,
        reviewTotal: 0,
        reviewPass: 0,
        noteTotal: 0,
        notePass: 0,
        lastAt: 0,
        dueSoon: 0,
      };
      perKey.set(key, row);
    }
    return { key, row };
  };

  for (const card of input.cards) {
    const { folder, topic } = splitPath(String(card.sourceNotePath || ""));
    const firstGroup = Array.isArray(card.groups) && card.groups.length > 0 ? String(card.groups[0]) : "(No group)";
    const { row } = getOrCreate(folder, firstGroup, topic);
    const due = Number(input.states?.[String(card.id)]?.due);
    if (Number.isFinite(due) && due > 0 && due <= Date.now() + (2 * 24 * 60 * 60 * 1000)) {
      row.dueSoon += 1;
    }
  }

  for (const ev of input.reviewEvents) {
    if (!ev || ev.kind !== "review") continue;
    const card = cardById.get(String(ev.cardId || ""));
    if (!card) continue;
    const { folder, topic } = splitPath(String(card.sourceNotePath || ""));
    const firstGroup = Array.isArray(card.groups) && card.groups.length > 0 ? String(card.groups[0]) : "(No group)";
    const { row } = getOrCreate(folder, firstGroup, topic);
    row.reviewTotal += 1;
    const result = String(ev.result || "").toLowerCase();
    if (result === "hard" || result === "good" || result === "easy") row.reviewPass += 1;
    row.lastAt = Math.max(row.lastAt, Number(ev.at) || 0);
  }

  for (const ev of input.noteEvents) {
    if (!ev || ev.kind !== "note-review") continue;
    if (!input.includePractice && ev.mode === "practice") continue;
    const { folder, topic } = splitPath(String(ev.sourceNotePath || ""));
    const { row } = getOrCreate(folder, "(No group)", topic);
    row.noteTotal += 1;
    const action = String(ev.action || "");
    if (action === "pass" || action === "read") row.notePass += 1;
    row.lastAt = Math.max(row.lastAt, Number(ev.at) || 0);
  }

  const now = Date.now();
  const rows: TopicRow[] = [];
  for (const [key, row] of perKey.entries()) {
    const reviewAcc = row.reviewTotal > 0 ? row.reviewPass / row.reviewTotal : 0.5;
    const noteAcc = row.noteTotal > 0 ? row.notePass / row.noteTotal : 0.5;
    const daysSince = row.lastAt > 0 ? (now - row.lastAt) / (24 * 60 * 60 * 1000) : 365;
    const recency = clamp(1 - (daysSince / 60), 0, 1);

    const rawScore = (reviewAcc * 0.6 + noteAcc * 0.25 + recency * 0.15) * 100;
    const sample = row.reviewTotal + row.noteTotal;
    const confidence = clamp(sample / 8, 0, 1);
    const score = Math.round((rawScore * (0.55 + confidence * 0.45)) * 10) / 10;

    rows.push({
      key,
      folder: row.folder,
      group: row.group,
      topic: row.topic,
      score,
      confidence: Math.round(confidence * 100),
      reviews: sample,
      dueSoon: row.dueSoon,
    });
  }

  return rows.sort((a, b) => a.score - b.score);
}

export function TopicMasteryCard(props: {
  cards: CardLike[];
  states: Record<string, StateLike>;
  reviewEvents: ReviewEventLike[];
  noteReviewEvents: NoteReviewEventLike[];
  hierarchy: "folder-group-topic" | "group-topic" | "topic";
  includePractice: boolean;
  focusCount: number;
  thresholds: { redMax: number; yellowMax: number };
}) {
  const [open, setOpen] = React.useState(false);
  const [focusCount, setFocusCount] = React.useState<number>(Math.max(1, Number(props.focusCount || 7)));
  const [includePractice, setIncludePractice] = React.useState<boolean>(props.includePractice);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  React.useEffect(() => {
    setIncludePractice(props.includePractice);
  }, [props.includePractice]);

  React.useEffect(() => {
    setFocusCount(Math.max(1, Number(props.focusCount || 7)));
  }, [props.focusCount]);

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
      const popover = popoverRef.current;
      if (!popover) return;
      popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
      popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const rows = React.useMemo(() => computeRows({
    cards: props.cards,
    states: props.states,
    reviewEvents: props.reviewEvents,
    noteEvents: props.noteReviewEvents,
    hierarchy: props.hierarchy,
    includePractice,
  }), [props.cards, props.states, props.reviewEvents, props.noteReviewEvents, props.hierarchy, includePractice]);

  const weak = rows.slice(0, Math.max(1, Math.min(rows.length, focusCount)));

  const chartData = React.useMemo<ChartRow[]>(() => {
    return weak.map((row) => ({
      key: row.key,
      score: Number(row.score.toFixed(1)),
      confidence: row.confidence,
      dueSoon: row.dueSoon,
    }));
  }, [weak]);

  const scoreDomainMax = React.useMemo(() => {
    const maxScore = chartData.reduce((max, row) => Math.max(max, row.score), 0);
    return Math.max(60, Math.ceil(maxScore / 10) * 10);
  }, [chartData]);

  const tooltip = React.useCallback((ctx: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    if (!ctx.active || !ctx.payload || !ctx.payload.length) return null;
    const row = ctx.payload[0]?.payload as ChartRow | undefined;
    if (!row) return null;
    return (
      <div className="learnkit-data-tooltip-surface">
        <div className="text-sm font-medium text-background">{row.key}</div>
        <div className="text-background">Mastery: {row.score.toFixed(1)}</div>
        <div className="text-background">Confidence: {row.confidence}%</div>
        <div className="text-background">Due soon: {row.dueSoon}</div>
      </div>
    );
  }, []);

  return (
    <div className="card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3" ref={wrapRef}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="font-semibold lk-home-section-title">Topic mastery</div>
            <span
              className="inline-flex items-center text-muted-foreground"
              data-tooltip="Weak-area surfacing and next-review focus based on combined card and note-review performance."
              data-tooltip-position="right"
            >
              <svg className="svg-icon lucide-info" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </span>
          </div>
          <div className="text-xs text-muted-foreground">Weak-area surfacing and next-review focus</div>
        </div>
        <div className="relative inline-flex">
          <button
            type="button"
            id="learnkit-topic-mastery-filter-trigger"
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
            <div ref={popoverRef} className="learnkit-ana-popover learnkit-ana-popover-right learnkit-ana-popover-sm rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1" role="listbox" aria-label="Topic mastery filters">
              <div className="flex flex-col gap-1">
                <div className="px-2 py-1 text-xs text-muted-foreground">Suggested focus topics</div>
                <div className="px-2 pb-2">
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, Math.min(20, rows.length || 1))}
                    value={Math.min(focusCount, Math.max(1, rows.length || 1))}
                    onChange={(ev) => setFocusCount(Math.max(1, Number(ev.currentTarget.value || 1)))}
                    className="w-full"
                  />
                  <div className="text-xs text-muted-foreground mt-1">{Math.min(focusCount, Math.max(1, rows.length || 1))} topics</div>
                </div>
                <div className="h-px bg-border my-1" role="separator" />
                <label className="px-2 py-1.5 inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePractice}
                    onChange={(ev) => setIncludePractice(ev.currentTarget.checked)}
                  />
                  <span>Include practice events</span>
                </label>
                <div className="h-px bg-border my-1" role="separator" />
                <div className="px-2 pb-1 text-xs text-muted-foreground">
                    Hierarchy is set in settings ({props.hierarchy.replace(/-/g, " / ")}).
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">Not enough data to compute topic mastery yet.</div>
      ) : (
        <>
          <div className="w-full flex-1 learnkit-analytics-chart">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 12, left: 12 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis type="number" domain={[0, scoreDomainMax]} tick={{ fontSize: 12 }} />
                <YAxis dataKey="key" type="category" hide />
                <Tooltip content={tooltip} />
                <Bar dataKey="score" fill="var(--chart-accent-1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-chart-legend">
            <div className="inline-flex items-center gap-2"><span className="inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square" style={{ ["--learnkit-legend-color" as string]: "var(--chart-accent-1)" }} />Low mastery focus</div>
            <div className="inline-flex items-center gap-2"><span className="inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square" style={{ ["--learnkit-legend-color" as string]: "var(--chart-accent-3)" }} />Higher score</div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Suggested next-review focus</div>
            {weak.map((row, idx) => (
              <div key={`${row.key}-${idx}`} className="rounded-md border border-border p-2">
                <div className="text-sm font-medium truncate">{row.key}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Score {row.score.toFixed(1)} · Confidence {row.confidence}% · Samples {row.reviews} · Due soon {row.dueSoon}
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-muted-foreground">
            Health bands: Red ≤ {props.thresholds.redMax}, Yellow ≤ {props.thresholds.yellowMax}, Green &gt; {props.thresholds.yellowMax}
          </div>
        </>
      )}
    </div>
  );
}
