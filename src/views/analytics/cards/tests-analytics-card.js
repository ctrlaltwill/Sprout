import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * @file src/views/analytics/cards/tests-analytics-card.tsx
 * @summary Module for tests analytics card.
 *
 * @exports
 *  - TestsAnalyticsCard
 */
import * as React from "react";
import { ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "../chart-axis-utils";
import { useAnalyticsPopoverZIndex } from "../filter-styles";
import { MS_DAY } from "../../../platform/core/constants";
function makeDatePartsFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}
function localDayIndex(ts, formatter) {
    const parts = formatter.formatToParts(new Date(ts));
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const year = Number(map.get("year"));
    const month = Number(map.get("month"));
    const day = Number(map.get("day"));
    return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}
function formatDayLabel(dayIdx, timeZone) {
    const date = new Date(dayIdx * MS_DAY);
    return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
}
function formatDayTitle(dayIdx, timeZone) {
    const date = new Date(dayIdx * MS_DAY);
    return date.toLocaleDateString(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" });
}
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
function ChevronIcon(props) {
    return (_jsx("svg", { className: `svg-icon learnkit-ana-chevron${props.open ? " is-open" : ""}`, xmlns: "http://www.w3.org/2000/svg", width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("polyline", { points: "6 4 14 12 6 20" }) }));
}
function parseCountsFromResultsJson(raw) {
    try {
        const parsed = JSON.parse(String(raw || "{}"));
        const rows = Array.isArray(parsed.results) ? parsed.results : [];
        const mcqCount = rows.filter((row) => String((row === null || row === void 0 ? void 0 : row.questionType) || "") === "mcq").length;
        const saqCount = rows.filter((row) => String((row === null || row === void 0 ? void 0 : row.questionType) || "") === "saq").length;
        const attemptedCount = rows.filter((row) => String((row === null || row === void 0 ? void 0 : row.userAnswer) || "").trim().length > 0).length;
        const elapsedSec = Number.isFinite(parsed.elapsedSec) ? Number(parsed.elapsedSec) : null;
        return { mcqCount, saqCount, elapsedSec, attemptedCount };
    }
    catch (_a) {
        return { mcqCount: 0, saqCount: 0, elapsedSec: null, attemptedCount: null };
    }
}
function shouldExcludeNoStudyAttempt(row) {
    return row.score === 0 && row.attemptedCount === 0;
}
function toRows(events, dbAttempts) {
    const out = [];
    for (const ev of events) {
        if (!ev || ev.kind !== "exam-attempt")
            continue;
        const at = Number(ev.at);
        const score = Number(ev.finalPercent);
        if (!Number.isFinite(at) || !Number.isFinite(score))
            continue;
        out.push({
            id: String(ev.attemptId || `${ev.testId || "test"}-${at}-${score.toFixed(2)}`),
            at,
            score: Math.max(0, Math.min(100, score)),
            autoSubmitted: Boolean(ev.autoSubmitted),
            mcqCount: Number.isFinite(ev.mcqCount) ? Number(ev.mcqCount) : 0,
            saqCount: Number.isFinite(ev.saqCount) ? Number(ev.saqCount) : 0,
            elapsedSec: Number.isFinite(ev.elapsedSec) ? Number(ev.elapsedSec) : null,
            attemptedCount: null,
        });
    }
    for (const row of dbAttempts) {
        const at = Number(row.createdAt);
        const score = Number(row.finalPercent);
        if (!Number.isFinite(at) || !Number.isFinite(score))
            continue;
        const parsed = parseCountsFromResultsJson(row.resultsJson);
        out.push({
            id: String(row.attemptId || `${row.testId}-${at}-${score.toFixed(2)}`),
            at,
            score: Math.max(0, Math.min(100, score)),
            autoSubmitted: Boolean(row.autoSubmitted),
            mcqCount: parsed.mcqCount,
            saqCount: parsed.saqCount,
            elapsedSec: parsed.elapsedSec,
            attemptedCount: parsed.attemptedCount,
        });
    }
    const deduped = new Map();
    for (const row of out) {
        const existing = deduped.get(row.id);
        if (!existing) {
            deduped.set(row.id, row);
            continue;
        }
        const existingHasAttempted = existing.attemptedCount != null;
        const incomingHasAttempted = row.attemptedCount != null;
        if (!existingHasAttempted && incomingHasAttempted) {
            deduped.set(row.id, row);
        }
    }
    return Array.from(deduped.values()).sort((a, b) => a.at - b.at);
}
function TestsTooltipContent(props) {
    if (!props.active)
        return null;
    const hoveredDayIndex = typeof props.label === "number"
        ? props.label
        : Number(props.label);
    if (!Number.isFinite(hoveredDayIndex))
        return null;
    const dailyDatum = props.averagesByDay.get(hoveredDayIndex);
    if (!dailyDatum || dailyDatum.averageScore == null)
        return null;
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsxs("div", { className: "text-background", children: ["Date: ", dailyDatum.date] }), _jsxs("div", { className: "text-background", children: ["Tests completed: ", dailyDatum.attempts] }), _jsxs("div", { className: "text-background", children: ["Average result: ", dailyDatum.averageScore.toFixed(1), "%"] })] }));
}
function buildScatterData(rows, durationDays, formatter, tz, todayIdx) {
    const startIdx = todayIdx - (durationDays - 1);
    const out = [];
    for (const row of rows) {
        const idx = localDayIndex(row.at, formatter);
        if (idx < startIdx || idx > todayIdx)
            continue;
        if (shouldExcludeNoStudyAttempt(row))
            continue;
        out.push({
            dayIndex: idx,
            score: row.score,
            date: formatDayTitle(idx, tz),
            autoSubmitted: row.autoSubmitted,
        });
    }
    return out;
}
function buildDailyAverageSeries(rows, durationDays, formatter, tz, todayIdx) {
    var _a, _b;
    const startIdx = todayIdx - (durationDays - 1);
    const sums = new Map();
    for (const row of rows) {
        const idx = localDayIndex(row.at, formatter);
        if (idx < startIdx || idx > todayIdx)
            continue;
        if (shouldExcludeNoStudyAttempt(row))
            continue;
        const existing = (_a = sums.get(idx)) !== null && _a !== void 0 ? _a : { total: 0, count: 0 };
        existing.total += row.score;
        existing.count += 1;
        sums.set(idx, existing);
    }
    const out = [];
    for (let idx = startIdx; idx <= todayIdx; idx += 1) {
        const bucket = sums.get(idx);
        const attempts = (_b = bucket === null || bucket === void 0 ? void 0 : bucket.count) !== null && _b !== void 0 ? _b : 0;
        out.push({
            dayIndex: idx,
            averageScore: attempts > 0 ? bucket.total / attempts : null,
            attempts,
            date: formatDayTitle(idx, tz),
        });
    }
    return out;
}
export function TestsAnalyticsCard(props) {
    var _a;
    const tz = (_a = props.timezone) !== null && _a !== void 0 ? _a : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
    const [durationDays, setDurationDays] = React.useState(30);
    const [open, setOpen] = React.useState(false);
    const [durationOpen, setDurationOpen] = React.useState(false);
    const wrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, wrapRef);
    const todayIdx = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
    const startIdx = todayIdx - (durationDays - 1);
    React.useEffect(() => {
        if (!open)
            return;
        const onDocClick = (ev) => {
            const target = ev.target;
            if (!target || !wrapRef.current)
                return;
            if (!wrapRef.current.contains(target))
                setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick, true);
        return () => document.removeEventListener("mousedown", onDocClick, true);
    }, [open]);
    const toggleDurationOpen = React.useCallback(() => {
        setDurationOpen((value) => !value);
    }, []);
    const onDurationKey = React.useCallback((event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setDurationOpen((value) => !value);
        }
    }, []);
    React.useEffect(() => {
        if (!open)
            return;
        const placePopover = () => {
            const popover = popoverRef.current;
            if (!popover)
                return;
            popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
            popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
        };
        placePopover();
        window.addEventListener("resize", placePopover, true);
        return () => window.removeEventListener("resize", placePopover, true);
    }, [open]);
    const allRows = React.useMemo(() => toRows(props.events, props.dbAttempts), [props.events, props.dbAttempts]);
    const scatterData = React.useMemo(() => buildScatterData(allRows, durationDays, formatter, tz, todayIdx), [allRows, durationDays, formatter, tz, todayIdx]);
    const dailyAverageSeries = React.useMemo(() => buildDailyAverageSeries(allRows, durationDays, formatter, tz, todayIdx), [allRows, durationDays, formatter, tz, todayIdx]);
    const averagesByDay = React.useMemo(() => {
        const grouped = new Map();
        for (const point of dailyAverageSeries) {
            grouped.set(point.dayIndex, point);
        }
        return grouped;
    }, [dailyAverageSeries]);
    const xTicks = React.useMemo(() => {
        const endIdx = startIdx + durationDays - 1;
        return createXAxisTicks(startIdx, endIdx, todayIdx);
    }, [startIdx, durationDays, todayIdx]);
    const xTickFormatter = (value) => formatAxisLabel(value, todayIdx, (idx) => formatDayLabel(idx, tz));
    const durationOptions = React.useMemo(() => [7, 30, 90], []);
    const resetFilters = React.useCallback(() => {
        setDurationDays(30);
        setDurationOpen(false);
    }, []);
    return (_jsxs("div", { className: "card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: "Tests performance" }), _jsx(InfoIcon, { text: "Individual test scores with daily average over time." })] }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Score distribution over time" })] }), _jsxs("div", { ref: wrapRef, className: "relative inline-flex", children: [_jsxs("button", { type: "button", id: "learnkit-tests-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", "aria-label": "Filter", "data-tooltip-position": "top", onClick: () => setOpen((v) => !v), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { ref: popoverRef, className: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm", role: "listbox", "aria-label": "Tests filters", children: _jsxs("div", { className: "p-1", children: [_jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": durationOpen ? "true" : "false", "aria-label": "Duration", "data-tooltip-position": "top", onClick: toggleDurationOpen, onKeyDown: onDurationKey, children: [_jsx("span", { children: "Duration" }), _jsx(ChevronIcon, { open: durationOpen })] }), durationOpen ? (_jsx("div", { role: "menu", "aria-orientation": "vertical", className: "flex flex-col", children: durationOptions.map((value) => (_jsxs("div", { role: "menuitemradio", "aria-checked": durationDays === value ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setDurationDays(value), onKeyDown: (event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        setDurationDays(value);
                                                    }
                                                }, children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsx("span", { children: value })] }, value))) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null] })] }), scatterData.length === 0 ? (_jsx("div", { className: "text-sm text-muted-foreground", children: "No test attempts yet." })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-full flex-1 learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(ComposedChart, { margin: { left: 8, right: 8, top: 12, bottom: 12 }, children: [_jsx(XAxis, { dataKey: "dayIndex", type: "number", domain: [startIdx, todayIdx], ticks: xTicks, tickFormatter: xTickFormatter, tick: { fontSize: 11 } }), _jsx(YAxis, { domain: [0, 100], tick: { fontSize: 11 }, width: 30, tickFormatter: (v) => `${v}%` }), _jsx(Tooltip, { content: (_jsx(TestsTooltipContent, { averagesByDay: averagesByDay })), isAnimationActive: false, animationDuration: 0, wrapperStyle: { transition: "none" }, cursor: { stroke: "var(--border)", strokeDasharray: "3 3", strokeWidth: 1 } }), _jsx(Scatter, { data: scatterData, dataKey: "score", name: "Score", fill: "var(--chart-accent-2)", fillOpacity: 0.8 }), _jsx(Line, { data: dailyAverageSeries, dataKey: "averageScore", name: "Daily average", type: "monotoneX", stroke: "var(--chart-accent-3)", strokeWidth: 2, connectNulls: true, dot: false, activeDot: false })] }) }) }), _jsxs("div", { className: "flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-chart-legend", children: [_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: "inline-block learnkit-ana-legend-dot", style: { ["--learnkit-legend-color"]: "var(--chart-accent-2)" } }), "Score"] }), _jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: "inline-block learnkit-ana-legend-line", style: { ["--learnkit-legend-color"]: "var(--chart-accent-3)" } }), "Daily average"] })] })] }))] }));
}
