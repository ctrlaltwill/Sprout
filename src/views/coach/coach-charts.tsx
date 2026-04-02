/**
 * @file src/views/coach/coach-charts.tsx
 * @summary Module for coach charts.
 *
 * @exports
 *  - ExamReadinessPoint
 *  - CoachHealthPanelProps
 *  - CoachHealthPanel
 *  - CoachReadinessPanelProps
 *  - CoachReadinessPanel
 */

import * as React from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ExamReadinessPoint = {
  dayIndex: number;
  label: string;
  readiness: number | null;
  projected: number | null;
};

function SizedChartContainer(props: { className: string; children: React.ReactNode }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateReady = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      setIsReady(width > 0 && height > 0);
    };

    updateReady();

    const observer = new ResizeObserver(updateReady);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className={props.className}>
      {isReady ? props.children : null}
    </div>
  );
}

function scoreColor(label: string): string {
  if (label === "ready" || label === "on-track") return "var(--chart-accent-3)";
  if (label === "at-risk") return "var(--chart-accent-2)";
  return "var(--chart-accent-1)";
}

function scoreName(label: string): string {
  return label.replace("-", " ");
}

function HealthIndicatorRow(props: { title: string; score: number; label: string }) {
  const barColor = scoreColor(props.label);
  const clampedScore = Math.max(0, Math.min(100, props.score));
  const tip = `${props.title}: ${props.score}% — ${scoreName(props.label)}`;
  return (
    <div className="learnkit-coach-health-bar-row" data-tooltip={tip} data-tooltip-position="top">
      <div className="learnkit-coach-health-bar-meta">
        <div className="learnkit-coach-health-bar-title">{props.title}</div>
        <div className="learnkit-coach-health-bar-status" style={{ color: barColor }}>
          {scoreName(props.label)}
        </div>
      </div>
      <div className="learnkit-coach-health-bar-track">
        <div className="learnkit-coach-health-bar-fill learnkit-coach-health-bar-fill-animated" style={{ "--learnkit-health-bar-width": `${clampedScore}%`, backgroundColor: barColor } as React.CSSProperties} />
      </div>
      <div className="learnkit-coach-health-bar-score" style={{ color: barColor }}>
        {props.score}%
      </div>
    </div>
  );
}

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

function TodayLabel(props: { viewBox?: { x?: number; y?: number } }) {
  const x = (props.viewBox?.x ?? 0) + 5;
  return (
    <text x={x} y={14} fill="var(--text-muted)" fontSize={11} fontWeight={500} textAnchor="start">
      Today
    </text>
  );
}

function ReadinessTooltip(props: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string }) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  const actual = payload.find((p: { dataKey?: string }) => p.dataKey === "readiness");
  const proj = payload.find((p: { dataKey?: string }) => p.dataKey === "projected");
  return (
    <div className="learnkit-data-tooltip-surface">
      <div className="text-sm font-medium text-background">{label}</div>
      {actual?.value != null && (
        <div className="text-background">Readiness: {Math.round(actual.value)}</div>
      )}
      {proj?.value != null && (
        <div className="text-background">Projected: {Math.round(proj.value)}</div>
      )}
    </div>
  );
}

export type CoachHealthPanelProps = {
  flash: { score: number; label: string };
  note: { score: number; label: string };
  exam: { score: number; label: string };
};

export function CoachHealthPanel(props: CoachHealthPanelProps) {
  return (
    <div className="card learnkit-coach-health-summary-card">
      <div className="learnkit-coach-progress-header">
        <div>
          <div className="learnkit-coach-health-heading-row">
            <div className="learnkit-coach-health-title">Study Plan Health</div>
            <InfoIcon text="Flashcard health blends FSRS retrievability for studied cards with time feasibility for unstudied cards. Note health uses the same model for reviewed vs unreviewed notes. Exam health is a weighted composite of both." />
          </div>
          <div className="learnkit-coach-step-copy">At-a-glance breakdown of your study health</div>
        </div>
      </div>
      <div className="learnkit-coach-health-bars">
        <HealthIndicatorRow title="Flashcards" score={props.flash.score} label={props.flash.label} />
        <HealthIndicatorRow title="Notes" score={props.note.score} label={props.note.label} />
        <HealthIndicatorRow title="Exam" score={props.exam.score} label={props.exam.label} />
      </div>
    </div>
  );
}

export type CoachReadinessPanelProps = {
  readiness: ExamReadinessPoint[];
  todayIndex: number;
  startLabel: string;
  endLabel: string;
  totalDays: number;
};

export function CoachReadinessPanel(props: CoachReadinessPanelProps) {
  const { readiness, todayIndex, startLabel, endLabel, totalDays } = props;

  return (
    <div className="card learnkit-coach-timeline-rechart-card">
      <div className="learnkit-coach-progress-header">
        <div>
          <div className="flex items-center gap-1">
            <div className="learnkit-coach-health-title">Exam Readiness</div>
            <InfoIcon text="Blends card mastery (FSRS retrievability) with time feasibility for remaining material into a 0–100 score. The dashed line projects readiness assuming you follow your daily targets." />
          </div>
          <div className="learnkit-coach-step-copy">Track how ready you are — from now until exam day</div>
        </div>
      </div>

      <SizedChartContainer className="learnkit-coach-timeline-rechart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={readiness} margin={{ top: 24, right: 12, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="coachReadinessGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-accent-3)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--chart-accent-3)" stopOpacity={0.03} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="dayIndex"
              type="number"
              domain={[0, totalDays]}
              ticks={[0, totalDays]}
              tickFormatter={(val: number) => val === 0 ? startLabel : endLabel}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              width={30}
            />

            <Tooltip content={<ReadinessTooltip />} />

            <ReferenceLine
              x={todayIndex}
              stroke="var(--text-muted)"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={<TodayLabel />}
            />

            <Area
              type="monotone"
              dataKey="readiness"
              name="Readiness"
              stroke="var(--chart-accent-3)"
              strokeWidth={2}
              fill="url(#coachReadinessGrad)"
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="projected"
              name="Projected"
              stroke="var(--chart-accent-2)"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </SizedChartContainer>

      <div className="learnkit-coach-chart-legend">
        <div className="learnkit-coach-legend-item">
          <span className="learnkit-coach-legend-swatch" style={{ backgroundColor: "var(--chart-accent-3)" }} />
          <span>Readiness</span>
        </div>
        <div className="learnkit-coach-legend-item">
          <span className="learnkit-coach-legend-line learnkit-coach-legend-dashed" style={{ borderColor: "var(--chart-accent-2)" }} />
          <span>Projected</span>
        </div>
        <div className="learnkit-coach-legend-item">
          <span className="learnkit-coach-legend-line learnkit-coach-legend-dashed" style={{ borderColor: "var(--text-muted)" }} />
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
