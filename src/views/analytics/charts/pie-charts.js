import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @file src/analytics/pie-charts.tsx
 * @summary Donut-style pie chart components for the analytics dashboard. Includes
 * a stage-distribution pie showing card counts by learning stage (New, Learning,
 * Review, Relearning, Suspended) and an answer-buttons pie showing the proportion
 * of Again/Hard/Good/Easy responses over a configurable time window. Both charts
 * support filtering by card type, deck, and group tags via popover controls.
 *
 * @exports
 *   - StagePieCard — React component rendering a donut chart of card stage distribution with filter controls
 *   - AnswerButtonsPieCard — React component rendering a donut chart of answer button usage over time
 */
import * as React from "react";
import { Label, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { startTruncateClass, useAnalyticsPopoverZIndex } from "../filter-styles";
import { cssClassForProps } from "../../../platform/core/ui";
// Use CSS variables for chart accent colors
const palette = [
    "var(--chart-accent-1)",
    "var(--chart-accent-2)",
    "var(--chart-accent-3)",
    "var(--chart-accent-4)",
    "var(--theme-accent)",
    "var(--accent)",
    "var(--primary)"
];
const typeLabels = {
    all: "All cards",
    basic: "Basic",
    "reversed-child": "Basic (Reversed)",
    mcq: "Multiple choice",
    "cloze-child": "Cloze",
    "io-child": "Image occlusion",
};
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
function normalizeEventType(raw) {
    const t = String(raw !== null && raw !== void 0 ? raw : "").toLowerCase();
    if (t === "cloze")
        return "cloze-child";
    if (t === "io")
        return "io-child";
    if (t === "reversed")
        return "reversed-child";
    return t;
}
function PieTooltip(props) {
    var _a;
    if (!props.active || !props.payload || !props.payload.length)
        return null;
    const item = props.payload[0];
    if (!item)
        return null;
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: item.name }), _jsxs("div", { className: "text-background", children: ["Count: ", (_a = item.value) !== null && _a !== void 0 ? _a : 0] })] }));
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
function buildData(entries) {
    return entries
        .filter(([, value]) => Number.isFinite(value) && value > 0)
        .sort((a, b) => { var _a, _b; return ((_a = b[1]) !== null && _a !== void 0 ? _a : 0) - ((_b = a[1]) !== null && _b !== void 0 ? _b : 0); })
        .map(([name, value]) => ({ name, value }));
}
function PieCard(props) {
    var _a;
    const total = props.data.reduce((sum, item) => sum + item.value, 0);
    const highlightLabel = (_a = props.highlightLabel) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    // Add colors to data for recharts v3
    const dataWithColors = React.useMemo(() => props.data.map((item, index) => ({
        ...item,
        fill: palette[index % palette.length]
    })), [props.data]);
    return (_jsxs("div", { className: "card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: props.title }), props.infoText ? _jsx(InfoIcon, { text: props.infoText }) : null] }), props.subtitle ? _jsx("div", { className: "text-xs text-muted-foreground", children: props.subtitle }) : null] }), props.headerSlot] }), _jsxs("div", { className: "w-full flex-1 learnkit-ana-pie-wrap", children: [total <= 0 ? (_jsx("div", { className: "text-sm text-muted-foreground learnkit-ana-empty-center", children: "No cards selected." })) : null, total > 0 ? (_jsx("div", { className: "learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 200, children: _jsxs(PieChart, { children: [_jsx(Tooltip, { content: _jsx(PieTooltip, {}) }), _jsx(Pie, { data: dataWithColors, dataKey: "value", nameKey: "name", innerRadius: 55, outerRadius: 85, paddingAngle: 2, stroke: "var(--background)", className: highlightLabel ? "learnkit-pie-highlightable" : undefined, children: _jsx(Label, { content: ({ viewBox }) => {
                                                var _a, _b;
                                                if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox))
                                                    return null;
                                                const cx = viewBox.cx;
                                                const cy = viewBox.cy;
                                                const value = (_a = props.centerValue) !== null && _a !== void 0 ? _a : total.toLocaleString();
                                                const label = (_b = props.centerLabel) !== null && _b !== void 0 ? _b : "";
                                                return (_jsxs("text", { x: cx, y: cy, textAnchor: "middle", dominantBaseline: "middle", children: [_jsx("tspan", { x: cx, y: cy, className: "fill-foreground text-2xl font-semibold", children: value }), label ? (_jsx("tspan", { x: cx, y: cy + 22, className: "fill-muted-foreground text-xs", children: label })) : null] }));
                                            } }) })] }) }) })) : null] }), _jsx("div", { className: "flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-min-20 learnkit-ana-chart-legend", children: total > 0
                    ? props.data.map((entry, index) => (_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": palette[index % palette.length] })}` }), _jsx("span", { className: "", children: entry.name }), _jsx("span", { className: "text-foreground", children: entry.value })] }, `legend-${entry.name}`)))
                    : null })] }));
}
export function StagePieCard(props) {
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
        return ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"];
    }, [props.cards]);
    const typeCounts = React.useMemo(() => {
        var _a, _b, _c;
        const counts = new Map();
        for (const type of availableTypes)
            counts.set(type, 0);
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            const t = String((_b = card === null || card === void 0 ? void 0 : card.type) !== null && _b !== void 0 ? _b : "");
            if (!t || t === "cloze" || t === "reversed" || t === "io" || t === "io-parent" || t === "io_parent" || t === "ioparent")
                continue;
            counts.set(t, ((_c = counts.get(t)) !== null && _c !== void 0 ? _c : 0) + 1);
        }
        if (counts.has("all")) {
            const total = Array.from(counts.entries())
                .filter(([key]) => key !== "all")
                .reduce((sum, [, value]) => sum + (value !== null && value !== void 0 ? value : 0), 0);
            counts.set("all", total);
        }
        return counts;
    }, [availableTypes, props.cards]);
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
    const stageCounts = React.useMemo(() => {
        var _a, _b, _c;
        const counts = {
            New: 0,
            Learning: 0,
            Review: 0,
            Relearning: 0,
            Suspended: 0,
        };
        for (const card of filteredCards) {
            const stage = String((_c = (_b = (_a = props.states) === null || _a === void 0 ? void 0 : _a[String(card.id)]) === null || _b === void 0 ? void 0 : _b.stage) !== null && _c !== void 0 ? _c : "new");
            if (stage === "review")
                counts.Review += 1;
            else if (stage === "relearning")
                counts.Relearning += 1;
            else if (stage === "suspended")
                counts.Suspended += 1;
            else if (stage === "new")
                counts.New += 1;
            else
                counts.Learning += 1;
        }
        return counts;
    }, [filteredCards, props.states]);
    const data = React.useMemo(() => buildData(Object.entries(stageCounts)), [stageCounts]);
    const toggleType = (type) => {
        setSelectedType(type);
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
    const toggleDeck = (deck) => {
        setSelectedDecks((prev) => {
            if (prev.includes(deck))
                return prev.filter((item) => item !== deck);
            if (prev.length >= 3)
                return prev;
            return [...prev, deck];
        });
    };
    const toggleCardTypesOpen = () => setCardTypesOpen((prev) => !prev);
    const onCardTypesKey = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggleCardTypesOpen();
        }
    };
    const resetFilters = () => {
        setSelectedType("all");
        setSelectedGroups([]);
        setSelectedDecks([]);
        setTagQuery("");
        setDeckQuery("");
        setCardTypesOpen(true);
    };
    const headerSlot = (_jsxs("div", { ref: wrapRef, className: "relative inline-flex", children: [_jsxs("button", { type: "button", id: "learnkit-stage-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", "aria-controls": "learnkit-stage-filter-listbox", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { id: "learnkit-stage-filter-popover", "aria-hidden": "false", ref: popoverRef, className: "rounded-md w-72 border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm learnkit-ana-popover-left", children: _jsxs("div", { className: "p-1", children: [_jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": cardTypesOpen ? "true" : "false", onClick: toggleCardTypesOpen, onKeyDown: onCardTypesKey, children: [_jsx("span", { children: "Card type" }), _jsx(ChevronIcon, { open: cardTypesOpen })] }), cardTypesOpen ? (_jsx("div", { role: "menu", id: "learnkit-stage-filter-listbox", "aria-orientation": "vertical", "data-tooltip": "Stage filter", className: "flex flex-col", children: availableTypes.map((type) => {
                                var _a, _b;
                                const label = (_a = typeLabels[type]) !== null && _a !== void 0 ? _a : type;
                                const selected = selectedType === type;
                                const count = (_b = typeCounts.get(type)) !== null && _b !== void 0 ? _b : 0;
                                return (_jsxs("div", { role: "menuitemradio", "aria-checked": selected ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => toggleType(type), children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsxs("span", { className: "flex items-center gap-2", children: [_jsx("span", { children: label }), _jsx("span", { className: "text-muted-foreground", children: `(${count})` })] })] }, type));
                            }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Decks" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search decks", className: "input w-full text-sm learnkit-filter-search-input", value: deckQuery, onChange: (event) => {
                                    const next = event.currentTarget.value;
                                    setDeckQuery(next);
                                    if (!next.trim())
                                        setSelectedDecks([]);
                                } }) }), deckQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedDecks.length ? (matchedDecks.map((deck) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleDeck(deck), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedDecks.includes(deck) ? _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) : null }), _jsx("span", { className: `truncate ${startTruncateClass}`, children: formatFilterPath(deck) })] }, deck)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No decks found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Groups" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search groups", className: "input w-full text-sm learnkit-filter-search-input", value: tagQuery, onChange: (event) => {
                                    const next = event.currentTarget.value;
                                    setTagQuery(next);
                                    if (!next.trim())
                                        setSelectedGroups([]);
                                } }) }), tagQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedGroups.length ? (matchedGroups.map((group) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleGroup(group), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedGroups.includes(group) ? _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) : null }), _jsx("span", { className: `truncate ${startTruncateClass}`, children: formatFilterPath(group) })] }, group)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No groups found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null, _jsx("input", { type: "hidden", name: "learnkit-stage-filter-value", value: "" })] }));
    const totalCards = data.reduce((sum, item) => sum + item.value, 0);
    return (_jsx(PieCard, { title: "Cards by stage", subtitle: "All decks", infoText: "Breakdown of your cards by learning stage using current scheduler state.", data: data, headerSlot: headerSlot, highlightLabel: "New", centerValue: totalCards.toLocaleString(), centerLabel: "Flashcards" }));
}
export function AnswerButtonsPieCard(props) {
    var _a, _b, _c, _d;
    const [open, setOpen] = React.useState(false);
    const [selectedType, setSelectedType] = React.useState("all");
    const [deckQuery, setDeckQuery] = React.useState("");
    const [groupQuery, setGroupQuery] = React.useState("");
    const [selectedDecks, setSelectedDecks] = React.useState([]);
    const [selectedGroups, setSelectedGroups] = React.useState([]);
    const wrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, wrapRef);
    const availableTypes = React.useMemo(() => ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"], []);
    const getEventDeck = React.useCallback((ev) => {
        var _a, _b;
        const raw = (_b = (_a = ev === null || ev === void 0 ? void 0 : ev.sourceNotePath) !== null && _a !== void 0 ? _a : ev === null || ev === void 0 ? void 0 : ev.deckPath) !== null && _b !== void 0 ? _b : ev === null || ev === void 0 ? void 0 : ev.deck;
        const deck = typeof raw === "string"
            ? raw
            : typeof raw === "number"
                ? String(raw)
                : "";
        return deck.trim();
    }, []);
    const getEventGroups = React.useCallback((ev) => {
        if (Array.isArray(ev === null || ev === void 0 ? void 0 : ev.groups))
            return ev.groups.filter(Boolean);
        if (Array.isArray(ev === null || ev === void 0 ? void 0 : ev.tags))
            return ev.tags.filter(Boolean);
        return [];
    }, []);
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
    const cutoff = props.nowMs - 30 * 24 * 60 * 60 * 1000;
    const recentEvents = React.useMemo(() => {
        var _a;
        return ((_a = props.events) !== null && _a !== void 0 ? _a : []).filter((ev) => {
            if (!ev || ev.kind !== "review")
                return false;
            const at = Number(ev.at);
            if (!Number.isFinite(at) || at < cutoff)
                return false;
            return true;
        });
    }, [props.events, cutoff]);
    const allDecks = React.useMemo(() => {
        const decks = new Set();
        for (const ev of recentEvents) {
            const deck = getEventDeck(ev);
            if (deck)
                decks.add(deck);
        }
        return Array.from(decks).sort((a, b) => a.localeCompare(b));
    }, [recentEvents, getEventDeck]);
    const allGroups = React.useMemo(() => {
        const groups = new Set();
        for (const ev of recentEvents) {
            const eventGroups = getEventGroups(ev);
            for (const group of eventGroups) {
                if (!group || typeof group !== "string")
                    continue;
                const trimmed = group.trim();
                if (trimmed)
                    groups.add(trimmed);
            }
        }
        return Array.from(groups).sort((a, b) => a.localeCompare(b));
    }, [recentEvents, getEventGroups]);
    const matchedDecks = React.useMemo(() => {
        const query = deckQuery.trim().toLowerCase();
        if (!query)
            return [];
        return allDecks.filter((deck) => deck.toLowerCase().includes(query)).slice(0, 3);
    }, [allDecks, deckQuery]);
    const matchedGroups = React.useMemo(() => {
        const query = groupQuery.trim().toLowerCase();
        if (!query)
            return [];
        return allGroups.filter((group) => group.toLowerCase().includes(query)).slice(0, 3);
    }, [allGroups, groupQuery]);
    const typeCounts = React.useMemo(() => {
        var _a;
        const counts = new Map();
        for (const type of availableTypes)
            counts.set(type, 0);
        for (const ev of recentEvents) {
            const rawType = ev.cardType;
            const t = normalizeEventType(typeof rawType === "string"
                ? rawType
                : typeof rawType === "number"
                    ? String(rawType)
                    : "unknown");
            if (!t)
                continue;
            counts.set(t, ((_a = counts.get(t)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
        if (counts.has("all")) {
            const total = Array.from(counts.entries())
                .filter(([key]) => key !== "all")
                .reduce((sum, [, value]) => sum + (value !== null && value !== void 0 ? value : 0), 0);
            counts.set("all", total);
        }
        return counts;
    }, [availableTypes, recentEvents]);
    const counts = React.useMemo(() => {
        const out = { again: 0, hard: 0, good: 0, easy: 0 };
        for (const ev of recentEvents) {
            const rawType = ev.cardType;
            const t = normalizeEventType(typeof rawType === "string"
                ? rawType
                : typeof rawType === "number"
                    ? String(rawType)
                    : "");
            if (selectedType !== "all" && t !== selectedType)
                continue;
            if (selectedDecks.length) {
                const deck = getEventDeck(ev);
                if (!deck || !selectedDecks.includes(deck))
                    continue;
            }
            if (selectedGroups.length) {
                const groups = getEventGroups(ev);
                const hasGroup = selectedGroups.some((group) => groups.includes(group));
                if (!hasGroup)
                    continue;
            }
            const rawResult = ev.result;
            const result = typeof rawResult === "string"
                ? rawResult
                : typeof rawResult === "number"
                    ? String(rawResult)
                    : "";
            if (result in out)
                out[result] += 1;
        }
        return out;
    }, [recentEvents, selectedType, selectedDecks, selectedGroups, getEventDeck, getEventGroups]);
    const rows = [
        ["Again", (_a = counts.again) !== null && _a !== void 0 ? _a : 0],
        ["Hard", (_b = counts.hard) !== null && _b !== void 0 ? _b : 0],
        ["Good", (_c = counts.good) !== null && _c !== void 0 ? _c : 0],
        ["Easy", (_d = counts.easy) !== null && _d !== void 0 ? _d : 0],
    ];
    const data = React.useMemo(() => buildData(rows), [counts]);
    const totalAnswered = counts.again + counts.hard + counts.good + counts.easy;
    const headerSlot = (_jsxs("div", { ref: wrapRef, className: "relative", children: [_jsxs("button", { type: "button", id: "learnkit-answer-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", "aria-controls": "learnkit-answer-filter-listbox", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { id: "learnkit-answer-filter-popover", "aria-hidden": "false", ref: popoverRef, "data-popover": "true", className: "learnkit dropdown-menu w-72 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-left", children: _jsxs("div", { className: "p-1", children: [_jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Card type" }), _jsx("div", { role: "menu", id: "learnkit-answer-filter-listbox", "aria-orientation": "vertical", "data-tooltip": "Answer filter", className: "flex flex-col", children: availableTypes.map((type) => {
                                var _a, _b;
                                const label = (_a = typeLabels[type]) !== null && _a !== void 0 ? _a : type;
                                const selected = selectedType === type;
                                const count = (_b = typeCounts.get(type)) !== null && _b !== void 0 ? _b : 0;
                                return (_jsxs("div", { role: "menuitemradio", "aria-checked": selected ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setSelectedType(type), children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsxs("span", { className: "flex items-center gap-2", children: [_jsx("span", { children: label }), _jsx("span", { className: "text-muted-foreground", children: `(${count})` })] })] }, type));
                            }) }), _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Decks" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search decks", className: "input w-full text-sm learnkit-filter-search-input", value: deckQuery, onChange: (event) => {
                                    const next = event.currentTarget.value;
                                    setDeckQuery(next);
                                    if (!next.trim())
                                        setSelectedDecks([]);
                                } }) }), deckQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedDecks.length ? (matchedDecks.map((deck) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => setSelectedDecks((prev) => {
                                        if (prev.includes(deck))
                                            return prev.filter((d) => d !== deck);
                                        if (prev.length >= 3)
                                            return prev;
                                        return [...prev, deck];
                                    }), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedDecks.includes(deck) ? _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) : null }), _jsx("span", { className: `truncate ${startTruncateClass}`, children: formatFilterPath(deck) })] }, deck)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No decks found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Groups" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search groups", className: "input w-full text-sm learnkit-filter-search-input", value: groupQuery, onChange: (event) => {
                                    const next = event.currentTarget.value;
                                    setGroupQuery(next);
                                    if (!next.trim())
                                        setSelectedGroups([]);
                                } }) }), groupQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedGroups.length ? (matchedGroups.map((group) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => setSelectedGroups((prev) => {
                                        if (prev.includes(group))
                                            return prev.filter((g) => g !== group);
                                        if (prev.length >= 3)
                                            return prev;
                                        return [...prev, group];
                                    }), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedGroups.includes(group) ? _jsx("span", { className: "size-1.5 rounded-full bg-foreground" }) : null }), _jsx("span", { className: `truncate ${startTruncateClass}`, children: formatFilterPath(group) })] }, group)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No groups found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: () => {
                                setSelectedType("all");
                                setSelectedDecks([]);
                                setSelectedGroups([]);
                                setDeckQuery("");
                                setGroupQuery("");
                            }, children: "Reset filters" })] }) })) : null] }));
    return (_jsx(PieCard, { title: "Answer buttons", subtitle: "Last 30 days", infoText: "Summary of review outcomes (Again/Hard/Good/Easy) over the recent window.", data: data, highlightLabel: "Again", headerSlot: headerSlot, centerValue: totalAnswered.toLocaleString(), centerLabel: "Flashcards answered" }));
}
