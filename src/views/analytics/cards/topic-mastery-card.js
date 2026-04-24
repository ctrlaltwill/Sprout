import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
function splitPath(path) {
    const clean = String(path || "").trim();
    if (!clean)
        return { folder: "(No folder)", topic: "(Unknown topic)" };
    const parts = clean.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const topic = last.replace(/\.md$/i, "") || "(Unknown topic)";
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(Vault root)";
    return { folder, topic };
}
function bucketKey(folder, group, topic, hierarchy) {
    if (hierarchy === "topic")
        return topic;
    if (hierarchy === "group-topic")
        return `${group} / ${topic}`;
    return `${folder} / ${group} / ${topic}`;
}
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
function computeRows(input) {
    var _a, _b;
    const cardById = new Map();
    for (const card of input.cards)
        cardById.set(String(card.id), card);
    const perKey = new Map();
    const getOrCreate = (folder, group, topic) => {
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
        const due = Number((_b = (_a = input.states) === null || _a === void 0 ? void 0 : _a[String(card.id)]) === null || _b === void 0 ? void 0 : _b.due);
        if (Number.isFinite(due) && due > 0 && due <= Date.now() + (2 * 24 * 60 * 60 * 1000)) {
            row.dueSoon += 1;
        }
    }
    for (const ev of input.reviewEvents) {
        if (!ev || ev.kind !== "review")
            continue;
        const card = cardById.get(String(ev.cardId || ""));
        if (!card)
            continue;
        const { folder, topic } = splitPath(String(card.sourceNotePath || ""));
        const firstGroup = Array.isArray(card.groups) && card.groups.length > 0 ? String(card.groups[0]) : "(No group)";
        const { row } = getOrCreate(folder, firstGroup, topic);
        row.reviewTotal += 1;
        const result = String(ev.result || "").toLowerCase();
        if (result === "hard" || result === "good" || result === "easy")
            row.reviewPass += 1;
        row.lastAt = Math.max(row.lastAt, Number(ev.at) || 0);
    }
    for (const ev of input.noteEvents) {
        if (!ev || ev.kind !== "note-review")
            continue;
        if (!input.includePractice && ev.mode === "practice")
            continue;
        const { folder, topic } = splitPath(String(ev.sourceNotePath || ""));
        const { row } = getOrCreate(folder, "(No group)", topic);
        row.noteTotal += 1;
        const action = String(ev.action || "");
        if (action === "pass" || action === "read")
            row.notePass += 1;
        row.lastAt = Math.max(row.lastAt, Number(ev.at) || 0);
    }
    const now = Date.now();
    const rows = [];
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
export function TopicMasteryCard(props) {
    const [open, setOpen] = React.useState(false);
    const [focusCount, setFocusCount] = React.useState(Math.max(1, Number(props.focusCount || 7)));
    const [includePractice, setIncludePractice] = React.useState(props.includePractice);
    const wrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, wrapRef);
    React.useEffect(() => {
        setIncludePractice(props.includePractice);
    }, [props.includePractice]);
    React.useEffect(() => {
        setFocusCount(Math.max(1, Number(props.focusCount || 7)));
    }, [props.focusCount]);
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
    const rows = React.useMemo(() => computeRows({
        cards: props.cards,
        states: props.states,
        reviewEvents: props.reviewEvents,
        noteEvents: props.noteReviewEvents,
        hierarchy: props.hierarchy,
        includePractice,
    }), [props.cards, props.states, props.reviewEvents, props.noteReviewEvents, props.hierarchy, includePractice]);
    const weak = rows.slice(0, Math.max(1, Math.min(rows.length, focusCount)));
    const chartData = React.useMemo(() => {
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
    const tooltip = React.useCallback((ctx) => {
        var _a;
        if (!ctx.active || !ctx.payload || !ctx.payload.length)
            return null;
        const row = (_a = ctx.payload[0]) === null || _a === void 0 ? void 0 : _a.payload;
        if (!row)
            return null;
        return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: row.key }), _jsxs("div", { className: "text-background", children: ["Mastery: ", row.score.toFixed(1)] }), _jsxs("div", { className: "text-background", children: ["Confidence: ", row.confidence, "%"] }), _jsxs("div", { className: "text-background", children: ["Due soon: ", row.dueSoon] })] }));
    }, []);
    return (_jsxs("div", { className: "card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3", ref: wrapRef, children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: "Topic mastery" }), _jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": "Weak-area surfacing and next-review focus based on combined card and note-review performance.", "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) })] }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Weak-area surfacing and next-review focus" })] }), _jsxs("div", { className: "relative inline-flex", children: [_jsxs("button", { type: "button", id: "learnkit-topic-mastery-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", "aria-label": "Filter", "data-tooltip-position": "top", onClick: () => setOpen((v) => !v), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { ref: popoverRef, className: "learnkit-ana-popover learnkit-ana-popover-right learnkit-ana-popover-sm rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1", role: "listbox", "aria-label": "Topic mastery filters", children: _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("div", { className: "px-2 py-1 text-xs text-muted-foreground", children: "Suggested focus topics" }), _jsxs("div", { className: "px-2 pb-2", children: [_jsx("input", { type: "range", min: 1, max: Math.max(1, Math.min(20, rows.length || 1)), value: Math.min(focusCount, Math.max(1, rows.length || 1)), onChange: (ev) => setFocusCount(Math.max(1, Number(ev.currentTarget.value || 1))), className: "w-full" }), _jsxs("div", { className: "text-xs text-muted-foreground mt-1", children: [Math.min(focusCount, Math.max(1, rows.length || 1)), " topics"] })] }), _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsxs("label", { className: "px-2 py-1.5 inline-flex items-center gap-2 text-sm cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: includePractice, onChange: (ev) => setIncludePractice(ev.currentTarget.checked) }), _jsx("span", { children: "Include practice events" })] }), _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsxs("div", { className: "px-2 pb-1 text-xs text-muted-foreground", children: ["Hierarchy is set in settings (", props.hierarchy.replace(/-/g, " / "), ")."] })] }) })) : null] })] }), rows.length === 0 ? (_jsx("div", { className: "text-sm text-muted-foreground", children: "Not enough data to compute topic mastery yet." })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-full flex-1 learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(BarChart, { data: chartData, margin: { top: 12, right: 12, bottom: 12, left: 12 }, layout: "vertical", children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", opacity: 0.35 }), _jsx(XAxis, { type: "number", domain: [0, scoreDomainMax], tick: { fontSize: 12 } }), _jsx(YAxis, { dataKey: "key", type: "category", hide: true }), _jsx(Tooltip, { content: tooltip }), _jsx(Bar, { dataKey: "score", fill: "var(--chart-accent-1)", radius: [0, 4, 4, 0] })] }) }) }), _jsxs("div", { className: "flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-chart-legend", children: [_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: "inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square", style: { ["--learnkit-legend-color"]: "var(--chart-accent-1)" } }), "Low mastery focus"] }), _jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: "inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square", style: { ["--learnkit-legend-color"]: "var(--chart-accent-3)" } }), "Higher score"] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-medium", children: "Suggested next-review focus" }), weak.map((row, idx) => (_jsxs("div", { className: "rounded-md border border-border p-2", children: [_jsx("div", { className: "text-sm font-medium truncate", children: row.key }), _jsxs("div", { className: "mt-1 text-xs text-muted-foreground", children: ["Score ", row.score.toFixed(1), " \u00B7 Confidence ", row.confidence, "% \u00B7 Samples ", row.reviews, " \u00B7 Due soon ", row.dueSoon] })] }, `${row.key}-${idx}`)))] }), _jsxs("div", { className: "text-xs text-muted-foreground", children: ["Health bands: Red \u2264 ", props.thresholds.redMax, ", Yellow \u2264 ", props.thresholds.yellowMax, ", Green > ", props.thresholds.yellowMax] })] }))] }));
}
