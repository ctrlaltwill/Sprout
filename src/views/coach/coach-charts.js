import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, } from "recharts";
function SizedChartContainer(props) {
    const hostRef = React.useRef(null);
    const [isReady, setIsReady] = React.useState(false);
    React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host)
            return;
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
    return (_jsx("div", { ref: hostRef, className: props.className, children: isReady ? props.children : null }));
}
function scoreColor(label) {
    if (label === "ready" || label === "on-track")
        return "var(--chart-accent-3)";
    if (label === "at-risk")
        return "var(--chart-accent-2)";
    return "var(--chart-accent-1)";
}
function scoreName(label) {
    return label.replace("-", " ");
}
function HealthIndicatorRow(props) {
    const barColor = scoreColor(props.label);
    const clampedScore = Math.max(0, Math.min(100, props.score));
    const tip = `${props.title}: ${props.score}% — ${scoreName(props.label)}`;
    return (_jsxs("div", { className: "learnkit-coach-health-bar-row", "data-tooltip": tip, "data-tooltip-position": "top", children: [_jsxs("div", { className: "learnkit-coach-health-bar-meta", children: [_jsx("div", { className: "learnkit-coach-health-bar-title", children: props.title }), _jsx("div", { className: "learnkit-coach-health-bar-status", style: { color: barColor }, children: scoreName(props.label) })] }), _jsx("div", { className: "learnkit-coach-health-bar-track", children: _jsx("div", { className: "learnkit-coach-health-bar-fill learnkit-coach-health-bar-fill-animated", style: { "--learnkit-health-bar-width": `${clampedScore}%`, backgroundColor: barColor } }) }), _jsxs("div", { className: "learnkit-coach-health-bar-score", style: { color: barColor }, children: [props.score, "%"] })] }));
}
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
function TodayLabel(props) {
    var _a, _b;
    const x = ((_b = (_a = props.viewBox) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0) + 5;
    return (_jsx("text", { x: x, y: 14, fill: "var(--text-muted)", fontSize: 11, fontWeight: 500, textAnchor: "start", children: "Today" }));
}
function ReadinessTooltip(props) {
    const { active, payload, label } = props;
    if (!active || !(payload === null || payload === void 0 ? void 0 : payload.length))
        return null;
    const actual = payload.find((p) => p.dataKey === "readiness");
    const proj = payload.find((p) => p.dataKey === "projected");
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: label }), (actual === null || actual === void 0 ? void 0 : actual.value) != null && (_jsxs("div", { className: "text-background", children: ["Readiness: ", Math.round(actual.value)] })), (proj === null || proj === void 0 ? void 0 : proj.value) != null && (_jsxs("div", { className: "text-background", children: ["Projected: ", Math.round(proj.value)] }))] }));
}
export function CoachHealthPanel(props) {
    return (_jsxs("div", { className: "card learnkit-coach-health-summary-card", children: [_jsx("div", { className: "learnkit-coach-progress-header", children: _jsxs("div", { children: [_jsxs("div", { className: "learnkit-coach-health-heading-row", children: [_jsx("div", { className: "learnkit-coach-health-title", children: "Study Plan Health" }), _jsx(InfoIcon, { text: "Flashcard health blends FSRS retrievability for studied cards with time feasibility for unstudied cards. Note health uses the same model for reviewed vs unreviewed notes. Exam health is a weighted composite of both." })] }), _jsx("div", { className: "learnkit-coach-step-copy", children: "At-a-glance breakdown of your study health" })] }) }), _jsxs("div", { className: "learnkit-coach-health-bars", children: [_jsx(HealthIndicatorRow, { title: "Flashcards", score: props.flash.score, label: props.flash.label }), _jsx(HealthIndicatorRow, { title: "Notes", score: props.note.score, label: props.note.label }), _jsx(HealthIndicatorRow, { title: "Exam", score: props.exam.score, label: props.exam.label })] })] }));
}
export function CoachReadinessPanel(props) {
    const { readiness, todayIndex, startLabel, endLabel, totalDays } = props;
    return (_jsxs("div", { className: "card learnkit-coach-timeline-rechart-card", children: [_jsx("div", { className: "learnkit-coach-progress-header", children: _jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "learnkit-coach-health-title", children: "Exam Readiness" }), _jsx(InfoIcon, { text: "Blends card mastery (FSRS retrievability) with time feasibility for remaining material into a 0\u2013100 score. The dashed line projects readiness assuming you follow your daily targets." })] }), _jsx("div", { className: "learnkit-coach-step-copy", children: "Track how ready you are \u2014 from now until exam day" })] }) }), _jsx(SizedChartContainer, { className: "learnkit-coach-timeline-rechart", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(ComposedChart, { data: readiness, margin: { top: 24, right: 12, bottom: 4, left: 8 }, children: [_jsx("defs", { children: _jsxs("linearGradient", { id: "coachReadinessGrad", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "5%", stopColor: "var(--chart-accent-3)", stopOpacity: 0.35 }), _jsx("stop", { offset: "95%", stopColor: "var(--chart-accent-3)", stopOpacity: 0.03 })] }) }), _jsx(XAxis, { dataKey: "dayIndex", type: "number", domain: [0, totalDays], ticks: [0, totalDays], tickFormatter: (val) => val === 0 ? startLabel : endLabel, tick: { fontSize: 11, fill: "var(--text-muted)" }, axisLine: { stroke: "var(--border)" }, tickLine: false }), _jsx(YAxis, { domain: [0, 100], ticks: [0, 25, 50, 75, 100], tick: { fontSize: 11, fill: "var(--text-muted)" }, axisLine: { stroke: "var(--border)" }, tickLine: false, width: 30 }), _jsx(Tooltip, { content: _jsx(ReadinessTooltip, {}) }), _jsx(ReferenceLine, { x: todayIndex, stroke: "var(--text-muted)", strokeDasharray: "4 3", strokeWidth: 1, label: _jsx(TodayLabel, {}) }), _jsx(Area, { type: "monotone", dataKey: "readiness", name: "Readiness", stroke: "var(--chart-accent-3)", strokeWidth: 2, fill: "url(#coachReadinessGrad)", connectNulls: false, dot: false, isAnimationActive: false }), _jsx(Line, { type: "monotone", dataKey: "projected", name: "Projected", stroke: "var(--chart-accent-2)", strokeWidth: 2, strokeDasharray: "6 3", dot: false, connectNulls: true, isAnimationActive: false })] }) }) }), _jsxs("div", { className: "learnkit-coach-chart-legend", children: [_jsxs("div", { className: "learnkit-coach-legend-item", children: [_jsx("span", { className: "learnkit-coach-legend-swatch", style: { backgroundColor: "var(--chart-accent-3)" } }), _jsx("span", { children: "Readiness" })] }), _jsxs("div", { className: "learnkit-coach-legend-item", children: [_jsx("span", { className: "learnkit-coach-legend-line learnkit-coach-legend-dashed", style: { borderColor: "var(--chart-accent-2)" } }), _jsx("span", { children: "Projected" })] }), _jsxs("div", { className: "learnkit-coach-legend-item", children: [_jsx("span", { className: "learnkit-coach-legend-line learnkit-coach-legend-dashed", style: { borderColor: "var(--text-muted)" } }), _jsx("span", { children: "Today" })] })] })] }));
}
