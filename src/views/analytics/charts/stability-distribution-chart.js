import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @file src/analytics/stability-distribution-chart.tsx
 * @summary Area chart showing the distribution of cards by their FSRS stability
 * value (expected retention interval in days). Cards are bucketed into non-linear
 * intervals and plotted on a square-root-scaled x-axis so that both short- and
 * long-stability cards are visible. Supports filtering by card type, deck, and
 * group tags.
 *
 * @exports
 *   - StabilityDistributionChart — React component rendering a stability distribution area chart with filter controls
 */
import * as React from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { endTruncateClass, useAnalyticsPopoverZIndex } from "../filter-styles";
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
function ChevronIcon({ open }) {
    return (_jsx("svg", { className: `svg-icon learnkit-ana-chevron${open ? " is-open" : ""}`, xmlns: "http://www.w3.org/2000/svg", width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("polyline", { points: "6 4 14 12 6 20" }) }));
}
function formatFilterPath(raw, maxChars = 40) {
    let text = String(raw !== null && raw !== void 0 ? raw : "").trim();
    const lower = text.toLowerCase();
    if (lower.endsWith(".md"))
        text = text.slice(0, -3);
    text = text.replace(/\s*\/\s*/g, " / ");
    if (text.length <= maxChars)
        return text;
    const tail = text.slice(-maxChars).trimStart();
    return `...${tail}`;
}
function formatStabilityLabel(value, data) {
    const point = data.find((d) => Math.abs(d.stabilityScaled - Number(value)) < 0.1);
    if (!point)
        return `${value}`;
    const stability = point.stability;
    if (stability < 1) {
        const hours = Math.round(stability * 24);
        if (hours < 1) {
            const minutes = Math.round(stability * 24 * 60);
            return `${minutes} minutes`;
        }
        return `${hours} hours`;
    }
    return `${Math.round(stability)} days`;
}
function StabilityTooltip(props) {
    var _a, _b;
    if (!props.active || !props.payload || !props.payload.length)
        return null;
    const datum = (_a = props.payload[0]) === null || _a === void 0 ? void 0 : _a.payload;
    if (!datum)
        return null;
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: formatStabilityLabel(Number((_b = props.label) !== null && _b !== void 0 ? _b : 0), [datum]) }), _jsxs("div", { className: "text-background", children: ["Cards: ", datum.count] })] }));
}
function createStabilityDistribution(cards, states) {
    var _a, _b, _c;
    // Find max stability to determine range
    let maxStability = 0;
    for (const card of cards) {
        const state = states[String(card.id)];
        if (!state)
            continue;
        const stability = Number((_a = state.stabilityDays) !== null && _a !== void 0 ? _a : 0);
        if (Number.isFinite(stability) && stability > maxStability) {
            maxStability = stability;
        }
    }
    // Generate custom bucket points
    const generateBuckets = (max) => {
        const buckets = [
            0,
            30 / 1440, // 30 min
            60 / 1440, // 60 min
            90 / 1440, // 90 min
            2 / 24, // 2 hours
            3 / 24, // 3 hours
            4 / 24, // 4 hours
            6 / 24, // 6 hours
            12 / 24, // 12 hours
            18 / 24, // 18 hours
            1, // 1 day
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10, // daily up to 10
        ];
        let current = 12;
        // 10-20: increment by 2
        while (current <= 20 && current <= max + 20) {
            buckets.push(current);
            current += 2;
        }
        // 20-40: increment by 4
        current = 24;
        while (current <= 40 && current <= max + 20) {
            buckets.push(current);
            current += 4;
        }
        // 40+: increment by 10
        current = 50;
        while (current <= max + 20) {
            buckets.push(current);
            current += 10;
        }
        return buckets.sort((a, b) => a - b);
    };
    const bucketPoints = generateBuckets(maxStability);
    const buckets = new Map();
    for (const point of bucketPoints) {
        buckets.set(point, 0);
    }
    for (const card of cards) {
        const state = states[String(card.id)];
        if (!state)
            continue;
        const stability = Number((_b = state.stabilityDays) !== null && _b !== void 0 ? _b : 0);
        if (!Number.isFinite(stability))
            continue;
        // Find closest bucket point
        let closestPoint = bucketPoints[0];
        let minDist = Math.abs(stability - closestPoint);
        for (const point of bucketPoints) {
            const dist = Math.abs(stability - point);
            if (dist < minDist) {
                minDist = dist;
                closestPoint = point;
            }
        }
        buckets.set(closestPoint, ((_c = buckets.get(closestPoint)) !== null && _c !== void 0 ? _c : 0) + 1);
    }
    return Array.from(buckets.entries()).map(([stability, count]) => ({
        stability,
        count,
        // Apply exponential (sqrt) scaling to spread out lower values
        stabilityScaled: Math.sqrt(stability),
    }));
}
const typeLabels = {
    all: "All",
    basic: "Basic",
    mcq: "Multiple choice",
    "cloze-child": "Cloze (child)",
    "io-child": "Image occlusion (child)",
};
export function StabilityDistributionChart(props) {
    const renderStabilityLabel = React.useCallback((labelProps) => {
        var _a;
        const viewBox = (_a = labelProps === null || labelProps === void 0 ? void 0 : labelProps.viewBox) !== null && _a !== void 0 ? _a : {};
        const x = typeof viewBox.x === "number" ? viewBox.x : 0;
        const y = typeof viewBox.y === "number" ? viewBox.y : 0;
        const width = typeof viewBox.width === "number" ? viewBox.width : 0;
        const height = typeof viewBox.height === "number" ? viewBox.height : 0;
        const cx = x + width / 2;
        const cy = y + height + 16;
        return (_jsxs("text", { x: cx, y: cy, textAnchor: "middle", fill: "var(--text-muted)", children: [_jsx("tspan", { fontSize: 11, children: "Stability" }), _jsx("title", { children: "Stability is the expected retention interval (days, exponential scale)" })] }));
    }, []);
    const [selectedType, setSelectedType] = React.useState(null);
    const [tagQuery, setTagQuery] = React.useState("");
    const [selectedGroups, setSelectedGroups] = React.useState([]);
    const [deckQuery, setDeckQuery] = React.useState("");
    const [selectedDecks, setSelectedDecks] = React.useState([]);
    const [open, setOpen] = React.useState(false);
    const [cardTypesOpen, setCardTypesOpen] = React.useState(false);
    const wrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, wrapRef);
    const availableTypes = React.useMemo(() => {
        return ["all", "basic", "cloze-child", "io-child", "mcq"];
    }, [props.cards]);
    const allGroups = React.useMemo(() => {
        var _a;
        const groups = new Set();
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            const cardGroups = Array.isArray(card === null || card === void 0 ? void 0 : card.groups) ? card.groups : [];
            for (const group of cardGroups) {
                if (!group || typeof group !== "string")
                    continue;
                const trimmed = group.trim();
                if (trimmed)
                    groups.add(trimmed);
            }
        }
        return Array.from(groups).sort((a, b) => a.localeCompare(b));
    }, [props.cards]);
    const matchedGroups = React.useMemo(() => {
        const query = tagQuery.trim().toLowerCase();
        if (!query)
            return [];
        return allGroups.filter((group) => group.toLowerCase().includes(query)).slice(0, 3);
    }, [allGroups, tagQuery]);
    const allDecks = React.useMemo(() => {
        var _a, _b;
        const decks = new Set();
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            const deck = String((_b = card === null || card === void 0 ? void 0 : card.sourceNotePath) !== null && _b !== void 0 ? _b : "").trim();
            if (deck)
                decks.add(deck);
        }
        return Array.from(decks).sort((a, b) => a.localeCompare(b));
    }, [props.cards]);
    const matchedDecks = React.useMemo(() => {
        const query = deckQuery.trim().toLowerCase();
        if (!query)
            return [];
        return allDecks.filter((deck) => deck.toLowerCase().includes(query)).slice(0, 3);
    }, [allDecks, deckQuery]);
    React.useEffect(() => {
        setSelectedType("all");
    }, [availableTypes]);
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
            const wrap = wrapRef.current;
            const popover = popoverRef.current;
            if (!wrap || !popover)
                return;
            popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
            popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
        };
        placePopover();
        window.addEventListener("resize", placePopover, true);
        return () => window.removeEventListener("resize", placePopover, true);
    }, [open]);
    const filteredCards = React.useMemo(() => {
        var _a;
        return ((_a = props.cards) !== null && _a !== void 0 ? _a : []).filter((card) => {
            var _a, _b;
            if (!card)
                return false;
            const _t = String((_a = card.type) !== null && _a !== void 0 ? _a : "");
            if (_t === "cloze" || _t === "reversed" || _t === "io" || _t === "io-parent" || _t === "io_parent" || _t === "ioparent")
                return false;
            if (selectedType && selectedType !== "all" && card.type !== selectedType)
                return false;
            if (selectedGroups.length) {
                if (!Array.isArray(card.groups))
                    return false;
                const hasGroup = selectedGroups.some((group) => { var _a; return (_a = card.groups) === null || _a === void 0 ? void 0 : _a.includes(group); });
                if (!hasGroup)
                    return false;
            }
            if (selectedDecks.length) {
                const deck = String((_b = card.sourceNotePath) !== null && _b !== void 0 ? _b : "");
                if (!selectedDecks.includes(deck))
                    return false;
            }
            return true;
        });
    }, [props.cards, selectedType, selectedGroups, selectedDecks]);
    const data = React.useMemo(() => createStabilityDistribution(filteredCards, props.states), [filteredCards, props.states]);
    const yAxisConfig = React.useMemo(() => {
        if (!data || data.length === 0) {
            return { max: 10, ticks: [0, 5, 10] };
        }
        const maxValue = Math.max(...data.map((d) => d.count));
        // If max < 100, round to nearest 10; otherwise round to nearest 100
        let roundedMax;
        if (maxValue < 100) {
            roundedMax = Math.ceil(maxValue / 10) * 10 || 10;
        }
        else {
            roundedMax = Math.ceil(maxValue / 100) * 100;
        }
        const halfMax = Math.round(roundedMax / 2);
        return { max: roundedMax, ticks: [0, halfMax, roundedMax] };
    }, [data]);
    const xAxisConfig = React.useMemo(() => {
        var _a, _b, _c, _d;
        if (!data || data.length === 0) {
            return { min: 0, max: Math.sqrt(10), minLabel: "0", maxLabel: "10" };
        }
        const minStability = (_b = (_a = data[0]) === null || _a === void 0 ? void 0 : _a.stability) !== null && _b !== void 0 ? _b : 0;
        const maxStability = (_d = (_c = data[data.length - 1]) === null || _c === void 0 ? void 0 : _c.stability) !== null && _d !== void 0 ? _d : 10;
        return {
            min: Math.sqrt(minStability),
            max: Math.sqrt(maxStability),
            minLabel: Math.round(minStability).toString(),
            maxLabel: Math.round(maxStability).toString(),
        };
    }, [data]);
    const toggleDeck = (deck) => {
        setSelectedDecks((prev) => {
            if (prev.includes(deck))
                return prev.filter((item) => item !== deck);
            if (prev.length >= 3)
                return prev;
            return [...prev, deck];
        });
    };
    const toggleGroup = (group) => {
        setSelectedGroups((prev) => {
            if (prev.includes(group))
                return prev.filter((item) => item !== group);
            if (prev.length >= 3)
                return prev;
            return [...prev, group];
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
    return (_jsxs("div", { className: "card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: "Stability distribution" }), _jsx(InfoIcon, { text: "Distribution of cards by stability (expected retention interval). Lower values mean faster forgetting." })] }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Cards by stability (days)" })] }), _jsxs("div", { ref: wrapRef, className: "relative inline-flex", children: [_jsxs("button", { type: "button", id: "learnkit-stability-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { id: "learnkit-stability-filter-popover", "aria-hidden": "false", ref: popoverRef, className: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm learnkit-ana-popover-left", children: _jsxs("div", { className: "p-1", children: [_jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", onClick: () => setCardTypesOpen((prev) => !prev), children: [_jsx("span", { children: "Card Types" }), _jsx(ChevronIcon, { open: cardTypesOpen })] }), cardTypesOpen ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: availableTypes.map((type) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setSelectedType(type), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedType === type ? _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) : null }), _jsx("span", { children: typeLabels[type] || type })] }, type))) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Decks" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search decks", className: "input w-full text-sm learnkit-filter-search-input", value: deckQuery, onChange: (event) => {
                                                    const next = event.currentTarget.value;
                                                    setDeckQuery(next);
                                                    if (!next.trim())
                                                        setSelectedDecks([]);
                                                } }) }), deckQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedDecks.length ? (matchedDecks.map((deck) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleDeck(deck), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedDecks.includes(deck) ? _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) : null }), _jsx("span", { className: `truncate ${endTruncateClass}`, children: formatFilterPath(deck) })] }, deck)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No decks found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Groups" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search groups", className: "input w-full text-sm learnkit-filter-search-input", value: tagQuery, onChange: (event) => {
                                                    const next = event.currentTarget.value;
                                                    setTagQuery(next);
                                                    if (!next.trim())
                                                        setSelectedGroups([]);
                                                } }) }), tagQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedGroups.length ? (matchedGroups.map((group) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleGroup(group), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedGroups.includes(group) ? (_jsx("span", { className: "size-1.5 rounded-full bg-foreground" })) : null }), _jsx("span", { className: `truncate ${endTruncateClass}`, children: formatFilterPath(group) })] }, group)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No groups found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null] })] }), _jsx("div", { className: "w-full flex-1 learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(AreaChart, { data: data, margin: { top: 12, right: 12, bottom: 28, left: 8 }, children: [_jsx("defs", { children: _jsxs("linearGradient", { id: "stabilityGradient", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "5%", stopColor: "var(--chart-accent-2)", stopOpacity: 0.8 }), _jsx("stop", { offset: "95%", stopColor: "var(--chart-accent-2)", stopOpacity: 0.1 })] }) }), _jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "var(--border)", vertical: true, horizontal: true }), _jsx(XAxis, { dataKey: "stabilityScaled", type: "number", tick: { fontSize: 11, textAnchor: "end" }, axisLine: { stroke: "var(--border)" }, ticks: [xAxisConfig.min, xAxisConfig.max], tickFormatter: (value) => {
                                    const num = Number(value);
                                    if (!Number.isFinite(num))
                                        return "";
                                    const absValue = Math.abs(num);
                                    if (Math.abs(absValue - xAxisConfig.min) < 0.01)
                                        return xAxisConfig.minLabel;
                                    if (Math.abs(absValue - xAxisConfig.max) < 0.01)
                                        return xAxisConfig.maxLabel;
                                    const original = num * num;
                                    if (original < 1) {
                                        // Show hours as integer
                                        const hours = Math.round(original * 24);
                                        return `${hours}h`;
                                    }
                                    // Show days as integer
                                    return `${Math.round(original)}d`;
                                }, label: { position: "bottom", offset: 12, content: renderStabilityLabel }, domain: [xAxisConfig.min, xAxisConfig.max] }), _jsx(YAxis, { tickLine: false, axisLine: { stroke: "var(--border)" }, width: 32, tick: { fontSize: 12 }, domain: [0, yAxisConfig.max], ticks: yAxisConfig.ticks }), _jsx(Tooltip, { content: _jsx(StabilityTooltip, {}) }), _jsx(Area, { type: "monotone", dataKey: "count", stroke: "var(--chart-accent-2)", strokeWidth: 3, fill: "url(#stabilityGradient)", isAnimationActive: true })] }) }) })] }));
}
