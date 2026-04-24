import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { generatorParameters, forgetting_curve } from "ts-fsrs";
import { gradeFromPassFail, gradeFromRating, resetCardScheduling } from "../../../engine/scheduler/scheduler";
import { useAnalyticsPopoverZIndex } from "../filter-styles";
import { cssClassForProps } from "../../../platform/core/ui";
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
const MS_DAY = 24 * 60 * 60 * 1000;
const MAX_SELECTIONS = 3;
const DEFAULT_SCHEDULER = {
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
function createEmptySearch() {
    return { query: "", error: null };
}
function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}
function minutesToStepUnit(m) {
    const mm = Math.max(1, Math.round(m));
    if (mm % 1440 === 0)
        return `${mm / 1440}d`;
    if (mm % 60 === 0)
        return `${mm / 60}h`;
    return `${mm}m`;
}
function buildFsrsParams(cfg) {
    var _a;
    const safeCfg = cfg !== null && cfg !== void 0 ? cfg : DEFAULT_SCHEDULER;
    const learning = ((_a = safeCfg.learningStepsMinutes) !== null && _a !== void 0 ? _a : []).map(minutesToStepUnit);
    const relearningRaw = Array.isArray(safeCfg.relearningStepsMinutes) ? safeCfg.relearningStepsMinutes : [];
    const relearning = relearningRaw.length > 0
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
function extractNineDigitId(raw) {
    const match = raw.match(/\d{9}/);
    return match ? match[0] : null;
}
function formatCardLabel(id) {
    const digits = extractNineDigitId(id);
    return digits !== null && digits !== void 0 ? digits : id;
}
function normalizeSearchText(raw) {
    return String(raw !== null && raw !== void 0 ? raw : "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
function formatLocation(path) {
    const raw = String(path !== null && path !== void 0 ? path : "").trim();
    if (!raw)
        return "";
    const cleaned = raw.replace(/\.md$/i, "").replace(/\s*\/\s*/g, "/");
    const parts = cleaned.split("/").filter(Boolean);
    if (!parts.length)
        return "";
    const tail = parts.slice(-2).join("/");
    return parts.length > 2 ? `.../${tail}` : tail;
}
function getQuestionPreview(card, maxChars = 48) {
    var _a, _b, _c, _d;
    const raw = (_d = (_c = (_b = (_a = card.q) !== null && _a !== void 0 ? _a : card.stem) !== null && _b !== void 0 ? _b : card.clozeText) !== null && _c !== void 0 ? _c : card.prompt) !== null && _d !== void 0 ? _d : "";
    const cleaned = String(raw !== null && raw !== void 0 ? raw : "").replace(/\s+/g, " ").trim();
    if (cleaned.length <= maxChars)
        return cleaned;
    return `${cleaned.slice(0, maxChars - 1)}…`;
}
function getCardStability(state) {
    var _a, _b;
    if (!state)
        return 0;
    if (state.stage === "new")
        return 0;
    const stabilityDays = Number((_a = state.stabilityDays) !== null && _a !== void 0 ? _a : 0);
    if (Number.isFinite(stabilityDays) && stabilityDays > 0)
        return Math.max(0.1, stabilityDays);
    const scheduledDays = Number((_b = state.scheduledDays) !== null && _b !== void 0 ? _b : 0);
    if (state.stage === "review" && Number.isFinite(scheduledDays) && scheduledDays > 0)
        return Math.max(0.1, scheduledDays);
    return 0;
}
function normalizeReviewResult(result) {
    const r = String(result !== null && result !== void 0 ? result : "").toLowerCase();
    if (r === "pass" || r === "fail")
        return r;
    if (r === "again" || r === "hard" || r === "good" || r === "easy")
        return r;
    if (r === "skip")
        return null;
    return null;
}
function buildStabilityTimeline(cardId, entries, scheduler) {
    if (!entries.length)
        return [];
    const sorted = [...entries].sort((a, b) => a.at - b.at);
    let state = resetCardScheduling({
        id: cardId,
        stage: "new",
        due: sorted[0].at,
        reps: 0,
        lapses: 0,
        learningStepIndex: 0,
        scheduledDays: 0,
    }, sorted[0].at);
    const timeline = [];
    for (const entry of sorted) {
        const rating = normalizeReviewResult(entry.result);
        if (!rating)
            continue;
        const now = Number(entry.at);
        const graded = rating === "pass" || rating === "fail"
            ? gradeFromPassFail(state, rating, now, { scheduling: scheduler })
            : gradeFromRating(state, rating, now, { scheduling: scheduler });
        state = graded.nextState;
        const stability = getCardStability(state);
        timeline.push({ at: now, stability });
    }
    return timeline;
}
function CardCurveTooltip(props) {
    var _a;
    if (!props.active || !((_a = props.payload) === null || _a === void 0 ? void 0 : _a.length))
        return null;
    const dayIndex = typeof props.label === "number" ? props.label : 0;
    const date = new Date(props.baseStart + dayIndex * MS_DAY).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: date }), props.payload.map((entry) => {
                var _a, _b, _c;
                const value = Number((_a = entry === null || entry === void 0 ? void 0 : entry.value) !== null && _a !== void 0 ? _a : 0);
                const idLabel = String((_c = (_b = entry === null || entry === void 0 ? void 0 : entry.name) !== null && _b !== void 0 ? _b : entry === null || entry === void 0 ? void 0 : entry.dataKey) !== null && _c !== void 0 ? _c : "");
                return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `inline-block size-2 rounded-full learnkit-ana-legend-dot ${cssClassForProps({ "--learnkit-legend-color": entry.color })}` }), _jsx("span", { className: "text-background", children: idLabel }), _jsxs("span", { className: "text-background", children: [Math.round(value * 100), "%"] })] }, entry.dataKey));
            })] }));
}
export function ForgettingCurveChart(props) {
    const [search, setSearch] = React.useState(() => createEmptySearch());
    const [selectedIds, setSelectedIds] = React.useState([]);
    const seededRef = React.useRef(false);
    const [open, setOpen] = React.useState(false);
    const wrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, wrapRef);
    React.useEffect(() => {
        if (!open)
            return undefined;
        const onDocClick = (ev) => {
            var _a, _b;
            const target = ev.target;
            if (!target)
                return;
            if ((_a = wrapRef.current) === null || _a === void 0 ? void 0 : _a.contains(target))
                return;
            if ((_b = popoverRef.current) === null || _b === void 0 ? void 0 : _b.contains(target))
                return;
            setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick, true);
        return () => document.removeEventListener("mousedown", onDocClick, true);
    }, [open]);
    React.useEffect(() => {
        if (!open)
            return undefined;
        const popover = popoverRef.current;
        if (!popover)
            return undefined;
        popover.classList.add("learnkit-ana-popover", "learnkit-ana-popover", "learnkit-ana-popover-right", "learnkit-ana-popover-right", "learnkit-ana-popover-md", "learnkit-ana-popover-md");
        return undefined;
    }, [open]);
    const cardById = React.useMemo(() => {
        var _a;
        const map = new Map();
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            if (!card)
                continue;
            map.set(String(card.id), card);
        }
        return map;
    }, [props.cards]);
    const reviewLog = React.useMemo(() => { var _a; return (_a = props.reviewLog) !== null && _a !== void 0 ? _a : []; }, [props.reviewLog]);
    React.useEffect(() => {
        var _a, _b;
        if (seededRef.current)
            return;
        if (!reviewLog.length)
            return;
        if (selectedIds.length)
            return;
        const lastById = new Map();
        for (const entry of reviewLog) {
            if (!entry || !entry.at)
                continue;
            const id = String((_a = entry.id) !== null && _a !== void 0 ? _a : "");
            if (!id)
                continue;
            const at = Number(entry.at);
            if (!Number.isFinite(at))
                continue;
            const prev = (_b = lastById.get(id)) !== null && _b !== void 0 ? _b : 0;
            if (at > prev)
                lastById.set(id, at);
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
        var _a;
        const PARENT_TYPES = new Set(["cloze", "reversed", "io", "io-parent", "io_parent", "ioparent"]);
        return ((_a = props.cards) !== null && _a !== void 0 ? _a : [])
            .filter((card) => { var _a; return !PARENT_TYPES.has(String((_a = card === null || card === void 0 ? void 0 : card.type) !== null && _a !== void 0 ? _a : "").toLowerCase()); })
            .map((card) => {
            var _a, _b;
            const id = String(card.id);
            const label = formatCardLabel(id);
            const idDigits = (_a = extractNineDigitId(id)) !== null && _a !== void 0 ? _a : "";
            const title = String((_b = card.title) !== null && _b !== void 0 ? _b : "").trim();
            const location = formatLocation(card.sourceNotePath);
            const preview = getQuestionPreview(card);
            const combined = normalizeSearchText([id, idDigits, title, location, preview].join(" "));
            return { card, id, label, idDigits, title, location, preview, combined };
        });
    }, [props.cards]);
    const getSearchResults = React.useCallback((query) => {
        const q = normalizeSearchText(query);
        if (!q)
            return [];
        const results = [];
        for (const entry of searchIndex) {
            let score = 99;
            const idMatch = entry.idDigits && entry.idDigits === q;
            const idIncludes = entry.idDigits && entry.idDigits.includes(q);
            const titleNorm = normalizeSearchText(entry.title);
            const previewNorm = normalizeSearchText(entry.preview);
            const locationNorm = normalizeSearchText(entry.location);
            if (entry.id === q || idMatch)
                score = 0;
            else if (idIncludes || entry.id.includes(q))
                score = 1;
            else if (titleNorm.startsWith(q))
                score = 2;
            else if (titleNorm.includes(q))
                score = 3;
            else if (previewNorm.includes(q))
                score = 4;
            else if (locationNorm.includes(q))
                score = 5;
            else if (entry.combined.includes(q))
                score = 6;
            else
                continue;
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
            if (a.score !== b.score)
                return a.score - b.score;
            return a.label.localeCompare(b.label);
        })
            .slice(0, 5);
    }, [searchIndex]);
    const toggleSelection = (id) => {
        setSelectedIds((prev) => {
            if (prev.includes(id))
                return prev.filter((item) => item !== id);
            if (prev.length >= MAX_SELECTIONS) {
                setSearch((cur) => ({ ...cur, error: `Select up to ${MAX_SELECTIONS} cards.` }));
                return prev;
            }
            return [...prev, id];
        });
    };
    const searchIndexById = React.useMemo(() => {
        const map = new Map();
        searchIndex.forEach((entry) => map.set(entry.id, entry));
        return map;
    }, [searchIndex]);
    const selectedResults = React.useMemo(() => {
        const uniq = Array.from(new Set(selectedIds));
        return uniq.map((id) => {
            var _a, _b;
            const entry = searchIndexById.get(id);
            return {
                id,
                label: formatCardLabel(id),
                location: (_a = entry === null || entry === void 0 ? void 0 : entry.location) !== null && _a !== void 0 ? _a : "Unknown location",
                preview: (_b = entry === null || entry === void 0 ? void 0 : entry.preview) !== null && _b !== void 0 ? _b : "No question text.",
            };
        });
    }, [selectedIds, searchIndexById]);
    const resetFilters = () => {
        setSearch(createEmptySearch());
        setSelectedIds([]);
    };
    const params = React.useMemo(() => buildFsrsParams(props.scheduler), [props.scheduler]);
    const schedulerCfg = React.useMemo(() => { var _a; return (_a = props.scheduler) !== null && _a !== void 0 ? _a : DEFAULT_SCHEDULER; }, [props.scheduler]);
    const { curves, issues, baseStart } = React.useMemo(() => {
        const curveList = [];
        const issueList = [];
        let minFirstReview = Number.POSITIVE_INFINITY;
        selectedIds.forEach((id, index) => {
            var _a, _b, _c, _d, _e, _f, _g;
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
            const firstReviewAt = (_b = (_a = timeline[0]) === null || _a === void 0 ? void 0 : _a.at) !== null && _b !== void 0 ? _b : 0;
            const lastReviewAt = (_d = (_c = timeline[timeline.length - 1]) === null || _c === void 0 ? void 0 : _c.at) !== null && _d !== void 0 ? _d : firstReviewAt;
            const elapsedSinceFirst = Math.max(0, (props.nowMs - firstReviewAt) / MS_DAY);
            const horizon = Math.max(1, Math.ceil(elapsedSinceFirst * 2));
            if (Number.isFinite(firstReviewAt) && firstReviewAt > 0) {
                minFirstReview = Math.min(minFirstReview, firstReviewAt);
            }
            const stability = (_f = (_e = timeline[timeline.length - 1]) === null || _e === void 0 ? void 0 : _e.stability) !== null && _f !== void 0 ? _f : 0;
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
                title: (_g = card.title) !== null && _g !== void 0 ? _g : null,
                elapsedDays: elapsedSinceLast,
                currentRetrievability,
            });
        });
        const base = Number.isFinite(minFirstReview) && minFirstReview > 0 ? minFirstReview : props.nowMs;
        return { curves: curveList, issues: issueList, baseStart: base };
    }, [selectedIds, cardById, reviewLog, schedulerCfg, props.nowMs, params.w]);
    const elapsedDays = React.useMemo(() => Math.max(14, Math.ceil((props.nowMs - baseStart) / MS_DAY)), [props.nowMs, baseStart]);
    const maxDays = React.useMemo(() => elapsedDays * 2, [elapsedDays]);
    const todayDay = React.useMemo(() => Math.round((props.nowMs - baseStart) / MS_DAY), [props.nowMs, baseStart]);
    const data = React.useMemo(() => {
        if (!curves.length)
            return [];
        const rows = [];
        for (let day = 0; day <= maxDays; day += 1) {
            const row = { day };
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
                    if (timeline[i].at <= absoluteTs)
                        active = timeline[i];
                    else
                        break;
                }
                const elapsed = Math.max(0, (absoluteTs - active.at) / MS_DAY);
                row[curve.id] = forgetting_curve(params.w, elapsed, active.stability);
            }
            rows.push(row);
        }
        return rows;
    }, [curves, params.w, baseStart, maxDays]);
    const tickFormatter = (value) => {
        const ts = baseStart + Number(value) * MS_DAY;
        return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const yTickFormatter = (value) => `${Math.round(Number(value) * 100)}%`;
    const legendItems = React.useMemo(() => {
        var _a;
        const items = [];
        const curveIds = new Set();
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
            if (curveIds.has(issue.id))
                continue;
            const card = cardById.get(issue.id);
            const title = card ? String((_a = card.title) !== null && _a !== void 0 ? _a : "") : "";
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
        if (!legendItems.length)
            return null;
        return (_jsx("div", { className: "flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-chart-legend", children: legendItems.map((item) => (_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": item.color })}` }), _jsx("span", { "data-tooltip": item.tooltip || undefined, children: item.label }), item.status ? _jsxs("span", { className: "text-muted-foreground", children: ["(", item.status, ")"] }) : null] }, item.id))) }));
    };
    return (_jsxs("div", { className: "card learnkit-ana-card learnkit-forgetting-curve-card h-full overflow-visible p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: "Forgetting curve" }), _jsx(InfoIcon, { text: "Estimated recall probability over time for the selected cards based on review history." })] }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Recall probability over time" })] }), _jsxs("div", { ref: wrapRef, className: "relative inline-flex", children: [_jsxs("button", { type: "button", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { "aria-hidden": "false", ref: popoverRef, className: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-right learnkit-ana-popover-md", children: _jsxs("div", { className: "p-1", children: [_jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Search cards" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { className: "input w-full text-sm", type: "text", placeholder: "Search by ID, title, question", value: search.query, onChange: (event) => {
                                                    setSearch({ query: event.currentTarget.value, error: null });
                                                } }) }), search.error ? _jsx("div", { className: "text-xs text-muted-foreground px-2 pb-2", children: search.error }) : null, selectedResults.length ? (_jsxs("div", { className: "px-2 pb-2", children: [_jsx("div", { className: "text-xs text-muted-foreground px-2 pb-1", children: "Selected cards" }), _jsx("div", { className: "flex flex-col", children: selectedResults.map((result) => (_jsxs("div", { role: "menuitemradio", "aria-checked": "true", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleSelection(result.id), onKeyDown: (event) => {
                                                            if (event.key === "Enter" || event.key === " ") {
                                                                event.preventDefault();
                                                                toggleSelection(result.id);
                                                            }
                                                        }, children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) }), _jsxs("div", { className: "flex flex-col min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 text-xs text-muted-foreground", children: [_jsx("span", { className: "truncate learnkit-ana-truncate-row", children: result.location }), _jsx("span", { className: "shrink-0", children: result.label })] }), _jsx("div", { className: "truncate learnkit-ana-truncate", children: result.preview })] })] }, `selected-${result.id}`))) })] })) : null, search.query.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: (() => {
                                                const selectedSet = new Set(selectedIds);
                                                const results = getSearchResults(search.query).filter((result) => !selectedSet.has(result.id));
                                                return results.length ? (_jsx("div", { className: "flex flex-col", children: results.map((result) => {
                                                        const disabled = selectedIds.length >= MAX_SELECTIONS;
                                                        return (_jsxs("div", { role: "menuitemradio", "aria-checked": "false", tabIndex: 0, className: `bc group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0${disabled ? " is-disabled" : ""}`, onClick: () => {
                                                                if (disabled)
                                                                    return;
                                                                toggleSelection(result.id);
                                                            }, onKeyDown: (event) => {
                                                                if (disabled)
                                                                    return;
                                                                if (event.key === "Enter" || event.key === " ") {
                                                                    event.preventDefault();
                                                                    toggleSelection(result.id);
                                                                }
                                                            }, children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center" }), _jsxs("div", { className: "flex flex-col min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 text-xs text-muted-foreground", children: [_jsx("span", { className: "truncate learnkit-ana-truncate-row", children: result.location || "Unknown location" }), _jsx("span", { className: "shrink-0", children: result.label })] }), _jsx("div", { className: "truncate learnkit-ana-truncate", children: result.preview || "No question text." })] })] }, result.id));
                                                    }) })) : (_jsx("div", { className: "text-xs text-muted-foreground", children: "No matches." }));
                                            })() })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null] })] }), curves.length ? (_jsx("div", { className: "learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(LineChart, { data: data, margin: { top: 28, right: 12, left: 16, bottom: 0 }, children: [_jsx(XAxis, { dataKey: "day", ticks: [0, maxDays / 2, maxDays], tickFormatter: tickFormatter, tick: { fontSize: 11, fill: "var(--text-muted)" }, axisLine: { stroke: "var(--border)" }, tickLine: { stroke: "var(--border)" }, label: { value: "", position: "insideBottomRight", offset: -6 } }), _jsx(YAxis, { domain: [0, 1], ticks: [0, 0.5, 1], tickFormatter: yTickFormatter, tick: { fontSize: 11, fill: "var(--text-muted)" }, axisLine: { stroke: "var(--border)" }, tickLine: { stroke: "var(--border)" } }), _jsx(Tooltip, { content: _jsx(CardCurveTooltip, { baseStart: baseStart }) }), todayDay / maxDays > 0.1 && (_jsx(ReferenceLine, { x: todayDay, stroke: "var(--border)", strokeDasharray: "4 4", label: { value: "Today", position: "top", fill: "var(--text-muted)", fontSize: 11 } })), curves.map((curve) => {
                                var _a;
                                return (_jsx(Line, { type: "monotone", dataKey: curve.id, name: curve.label, stroke: curve.color, strokeWidth: 2, dot: false, isAnimationActive: (_a = props.enableAnimations) !== null && _a !== void 0 ? _a : true }, curve.id));
                            })] }) }) })) : (_jsx("div", { className: "flex-1 flex items-center justify-center text-sm text-muted-foreground", children: selectedIds.length ? "Selected cards have not been studied yet." : "Search for cards to plot forgetting curves." })), _jsx("div", { className: "learnkit-ana-scroll-48", children: legendContent() })] }));
}
