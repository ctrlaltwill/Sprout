import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @file src/analytics/new-cards-per-day-chart.tsx
 * @summary Bar chart displaying the number of newly created cards per day over a
 * configurable window (7, 30, or 90 days). Uses card creation timestamps to bucket
 * counts by local day. Supports filtering by card type, deck, and group tags.
 *
 * @exports
 *   - NewCardsPerDayChart — React component rendering a daily new-cards bar chart with filter controls
 */
import * as React from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "../chart-axis-utils";
import { endTruncateClass, useAnalyticsPopoverZIndex } from "../filter-styles";
import { MS_DAY } from "../../../platform/core/constants";
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
const BAR_COLOR = "var(--chart-accent-2)";
const MAX_SELECTIONS = 3;
function ChevronIcon({ open }) {
    return (_jsx("svg", { className: `bc svg-icon learnkit-ana-chevron${open ? " is-open" : ""}`, xmlns: "http://www.w3.org/2000/svg", width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("polyline", { points: "6 4 14 12 6 20" }) }));
}
function formatFilterPath(raw, maxChars = 30) {
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
const TYPE_LABELS = {
    all: "All cards",
    basic: "Basic",
    "reversed-child": "Basic (Reversed)",
    "cloze-child": "Cloze",
    "io-child": "Image occlusion",
    mcq: "Multiple choice",
};
function normalizeCardType(raw) {
    const t = String(raw !== null && raw !== void 0 ? raw : "").toLowerCase();
    if (t === "cloze")
        return "cloze-child";
    if (t === "io")
        return "io-child";
    if (t === "reversed")
        return "reversed-child";
    return t;
}
function getCardDeck(card) {
    var _a, _b;
    const raw = (_b = (_a = card.deckPath) !== null && _a !== void 0 ? _a : card.deckId) !== null && _b !== void 0 ? _b : card.sourceNotePath;
    const deck = String(raw !== null && raw !== void 0 ? raw : "").trim();
    return deck ? deck : null;
}
function getCardGroups(card) {
    var _a;
    if (Array.isArray(card.groups))
        return card.groups.filter(Boolean);
    if (Array.isArray(card.tags))
        return card.tags.filter(Boolean);
    const single = String((_a = card.groupPath) !== null && _a !== void 0 ? _a : "").trim();
    return single ? [single] : [];
}
function makeDatePartsFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}
function getDateParts(ts, formatter) {
    const parts = formatter.formatToParts(new Date(ts));
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const year = Number(map.get("year"));
    const month = Number(map.get("month"));
    const day = Number(map.get("day"));
    return { year, month, day };
}
function localDayIndex(ts, formatter) {
    const { year, month, day } = getDateParts(ts, formatter);
    const utc = Date.UTC(year, month - 1, day);
    return Math.floor(utc / MS_DAY);
}
function formatDayLabel(dayIndex, timeZone) {
    const date = new Date(dayIndex * MS_DAY);
    return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
}
function formatDayTitle(dayIndex, timeZone) {
    const date = new Date(dayIndex * MS_DAY);
    return date.toLocaleDateString(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" });
}
function normalizeMatchText(raw) {
    return String(raw !== null && raw !== void 0 ? raw : "")
        .trim()
        .replace(/\.md$/i, "")
        .replace(/\s*\/\s*/g, "/")
        .replace(/\s+/g, " ")
        .toLowerCase();
}
function rankFilterMatches(items, query, limit = 5) {
    const q = query.trim().toLowerCase();
    if (!q)
        return items.slice(0, limit);
    const scored = items
        .map((item) => {
        const norm = normalizeMatchText(item);
        const segments = norm
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean);
        let bestScore = null;
        for (const seg of segments) {
            if (seg === q)
                bestScore = bestScore === null ? 0 : Math.min(bestScore, 0);
            else if (seg.startsWith(q))
                bestScore = bestScore === null ? 1 : Math.min(bestScore, 1);
            else if (seg.includes(q))
                bestScore = bestScore === null ? 2 : Math.min(bestScore, 2);
        }
        if (bestScore === null && norm.includes(q))
            bestScore = 3;
        if (bestScore === null)
            return null;
        const index = Math.max(0, norm.indexOf(q));
        return { item, score: bestScore, depth: segments.length, index, len: norm.length };
    })
        .filter(Boolean);
    return scored
        .sort((a, b) => {
        if (a.score !== b.score)
            return a.score - b.score;
        if (a.depth !== b.depth)
            return a.depth - b.depth;
        if (a.index !== b.index)
            return a.index - b.index;
        if (a.len !== b.len)
            return a.len - b.len;
        return a.item.localeCompare(b.item);
    })
        .map((entry) => entry.item)
        .slice(0, limit);
}
function TooltipContent(props) {
    var _a;
    if (!props.active || !props.payload || !props.payload.length)
        return null;
    const datum = (_a = props.payload[0]) === null || _a === void 0 ? void 0 : _a.payload;
    if (!datum)
        return null;
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: datum.date }), _jsxs("div", { className: "text-background", children: ["Created: ", datum.created] })] }));
}
function roundUpToNearest10(value) {
    if (!Number.isFinite(value) || value <= 0)
        return 0;
    return Math.ceil(value / 10) * 10;
}
function buildYAxisTicks(maxValue) {
    if (maxValue <= 0)
        return [0];
    const mid = Math.round(maxValue / 2);
    const ticks = [0, mid, maxValue];
    return ticks.filter((value, index, array) => index === 0 || value !== array[index - 1]);
}
export function NewCardsPerDayChart(props) {
    var _a, _b;
    const tz = (_a = props.timezone) !== null && _a !== void 0 ? _a : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
    const [durationDays, setDurationDays] = React.useState((_b = props.days) !== null && _b !== void 0 ? _b : 30);
    const [open, setOpen] = React.useState(false);
    const [selectedType, setSelectedType] = React.useState("all");
    const [deckQuery, setDeckQuery] = React.useState("");
    const [groupQuery, setGroupQuery] = React.useState("");
    const [selectedDecks, setSelectedDecks] = React.useState([]);
    const [selectedGroups, setSelectedGroups] = React.useState([]);
    const [durationOpen, setDurationOpen] = React.useState(false);
    const [cardTypeOpen, setCardTypeOpen] = React.useState(false);
    const wrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, wrapRef);
    const toggleDurationOpen = () => setDurationOpen((prev) => !prev);
    const toggleCardTypeOpen = () => setCardTypeOpen((prev) => !prev);
    const onDurationKey = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggleDurationOpen();
        }
    };
    const onCardTypeKey = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggleCardTypeOpen();
        }
    };
    React.useEffect(() => {
        var _a;
        setDurationDays((_a = props.days) !== null && _a !== void 0 ? _a : 30);
    }, [props.days]);
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
        const place = () => {
            const popover = popoverRef.current;
            if (!popover)
                return;
            popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
            popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
        };
        place();
        window.addEventListener("resize", place, true);
        return () => window.removeEventListener("resize", place, true);
    }, [open]);
    const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
    const startIndex = todayIndex - (durationDays - 1);
    const availableTypes = React.useMemo(() => ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"], []);
    const allDecks = React.useMemo(() => {
        var _a;
        const decks = new Set();
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            const deck = getCardDeck(card);
            if (deck)
                decks.add(deck);
        }
        return Array.from(decks).sort((a, b) => a.localeCompare(b));
    }, [props.cards]);
    const allGroups = React.useMemo(() => {
        var _a;
        const groups = new Set();
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            for (const group of getCardGroups(card))
                groups.add(group);
        }
        return Array.from(groups).sort((a, b) => a.localeCompare(b));
    }, [props.cards]);
    const matchedDecks = React.useMemo(() => rankFilterMatches(allDecks, deckQuery, 5), [allDecks, deckQuery]);
    const matchedGroups = React.useMemo(() => rankFilterMatches(allGroups, groupQuery, 5), [allGroups, groupQuery]);
    const typeCounts = React.useMemo(() => {
        var _a, _b, _c, _d;
        const PARENT_TYPES = new Set(["cloze", "reversed", "io", "io-parent", "io_parent", "ioparent"]);
        const counts = new Map();
        for (const type of availableTypes)
            counts.set(type, 0);
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            const raw = String((_b = card === null || card === void 0 ? void 0 : card.type) !== null && _b !== void 0 ? _b : "").toLowerCase();
            if (PARENT_TYPES.has(raw))
                continue;
            const t = normalizeCardType((_c = card === null || card === void 0 ? void 0 : card.type) !== null && _c !== void 0 ? _c : "");
            if (!t)
                continue;
            counts.set(t, ((_d = counts.get(t)) !== null && _d !== void 0 ? _d : 0) + 1);
        }
        if (counts.has("all")) {
            const total = Array.from(counts.entries())
                .filter(([key]) => key !== "all")
                .reduce((sum, [, value]) => sum + (value !== null && value !== void 0 ? value : 0), 0);
            counts.set("all", total);
        }
        return counts;
    }, [availableTypes, props.cards]);
    const resetFilters = () => {
        var _a;
        setSelectedType("all");
        setSelectedDecks([]);
        setSelectedGroups([]);
        setDeckQuery("");
        setGroupQuery("");
        setDurationDays((_a = props.days) !== null && _a !== void 0 ? _a : 30);
        setDurationOpen(false);
        setCardTypeOpen(false);
        setOpen(false);
    };
    const toggleDeck = (deck) => {
        setSelectedDecks((prev) => {
            if (prev.includes(deck))
                return prev.filter((item) => item !== deck);
            if (prev.length >= MAX_SELECTIONS)
                return prev;
            return [...prev, deck];
        });
    };
    const toggleGroup = (group) => {
        setSelectedGroups((prev) => {
            if (prev.includes(group))
                return prev.filter((item) => item !== group);
            if (prev.length >= MAX_SELECTIONS)
                return prev;
            return [...prev, group];
        });
    };
    const data = React.useMemo(() => {
        var _a, _b, _c;
        const rows = [];
        const map = new Map();
        for (let i = 0; i < durationDays; i += 1) {
            const dayIndex = startIndex + i;
            const base = {
                label: formatDayLabel(dayIndex, tz),
                date: formatDayTitle(dayIndex, tz),
                created: 0,
            };
            const datum = { ...base, dayIndex };
            rows.push(datum);
            map.set(dayIndex, datum);
        }
        const PARENT_TYPES = new Set(["cloze", "reversed", "io", "io-parent", "io_parent", "ioparent"]);
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            const raw = String((_b = card === null || card === void 0 ? void 0 : card.type) !== null && _b !== void 0 ? _b : "").toLowerCase();
            if (PARENT_TYPES.has(raw))
                continue;
            const t = normalizeCardType((_c = card === null || card === void 0 ? void 0 : card.type) !== null && _c !== void 0 ? _c : "");
            if (selectedType !== "all" && t !== selectedType)
                continue;
            if (selectedDecks.length) {
                const deck = getCardDeck(card);
                if (!deck || !selectedDecks.includes(deck))
                    continue;
            }
            if (selectedGroups.length) {
                const groups = getCardGroups(card);
                const hasGroup = selectedGroups.some((group) => groups.includes(group));
                if (!hasGroup)
                    continue;
            }
            const createdAt = Number(card === null || card === void 0 ? void 0 : card.createdAt);
            if (!Number.isFinite(createdAt))
                continue;
            const dayIndex = localDayIndex(createdAt, formatter);
            if (dayIndex < startIndex || dayIndex > todayIndex)
                continue;
            const row = map.get(dayIndex);
            if (row)
                row.created += 1;
        }
        return rows;
    }, [props.cards, formatter, tz, durationDays, startIndex, todayIndex, selectedType, selectedDecks, selectedGroups]);
    const durationOptions = React.useMemo(() => [7, 30, 90], []);
    const xTicks = React.useMemo(() => createXAxisTicks(startIndex, todayIndex, todayIndex), [startIndex, todayIndex]);
    const xTickFormatter = (value) => formatAxisLabel(value, todayIndex, (dayIndex) => formatDayLabel(dayIndex, tz));
    const yMax = React.useMemo(() => {
        const maxValue = data.reduce((max, row) => Math.max(max, row.created), 0);
        return roundUpToNearest10(maxValue);
    }, [data]);
    const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);
    return (_jsxs("div", { className: "card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: "New cards added" }), _jsx(InfoIcon, { text: "Daily count of newly created cards in your vault." })] }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Daily totals" })] }), _jsxs("div", { ref: wrapRef, className: "relative inline-flex", children: [_jsxs("button", { type: "button", id: "learnkit-newcards-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { id: "learnkit-newcards-filter-popover", "aria-hidden": "false", ref: popoverRef, className: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm learnkit-ana-popover-left", children: _jsxs("div", { className: "p-1", children: [_jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": durationOpen ? "true" : "false", onClick: toggleDurationOpen, onKeyDown: onDurationKey, children: [_jsx("span", { children: "Duration" }), _jsx(ChevronIcon, { open: durationOpen })] }), durationOpen ? (_jsx("div", { role: "menu", "aria-orientation": "vertical", className: "flex flex-col", children: durationOptions.map((opt) => {
                                                const selected = durationDays === opt;
                                                return (_jsxs("div", { role: "menuitemradio", "aria-checked": selected ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setDurationDays(opt), onKeyDown: (event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setDurationDays(opt);
                                                        }
                                                    }, children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsx("span", { children: `${opt} days` })] }, opt));
                                            }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": cardTypeOpen ? "true" : "false", onClick: toggleCardTypeOpen, onKeyDown: onCardTypeKey, children: [_jsx("span", { children: "Card type" }), _jsx(ChevronIcon, { open: cardTypeOpen })] }), cardTypeOpen ? (_jsx("div", { role: "menu", id: "learnkit-newcards-filter-listbox", "aria-orientation": "vertical", "data-tooltip": "New cards filter", className: "flex flex-col", children: availableTypes.map((type) => {
                                                var _a, _b;
                                                const label = (_a = TYPE_LABELS[type]) !== null && _a !== void 0 ? _a : type;
                                                const selected = selectedType === type;
                                                const count = (_b = typeCounts.get(type)) !== null && _b !== void 0 ? _b : 0;
                                                return (_jsxs("div", { role: "menuitemradio", "aria-checked": selected ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setSelectedType(type), children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsxs("span", { className: "flex items-center gap-2", children: [_jsx("span", { children: label }), _jsx("span", { className: "text-muted-foreground", children: `(${count})` })] })] }, type));
                                            }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Decks" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search decks", className: "input w-full text-sm learnkit-filter-search-input", value: deckQuery, onChange: (event) => {
                                                    const next = event.currentTarget.value;
                                                    setDeckQuery(next);
                                                    if (!next.trim())
                                                        setSelectedDecks([]);
                                                } }) }), deckQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedDecks.length ? (matchedDecks.map((deck) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleDeck(deck), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedDecks.includes(deck) ? (_jsx("span", { className: "size-1.5 rounded-full bg-foreground" })) : null }), _jsx("span", { className: `bc truncate ${endTruncateClass}`, children: formatFilterPath(deck) })] }, deck)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No decks found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Groups" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search groups", className: "input w-full text-sm learnkit-filter-search-input", value: groupQuery, onChange: (event) => {
                                                    const next = event.currentTarget.value;
                                                    setGroupQuery(next);
                                                    if (!next.trim())
                                                        setSelectedGroups([]);
                                                } }) }), groupQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedGroups.length ? (matchedGroups.map((group) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleGroup(group), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedGroups.includes(group) ? (_jsx("span", { className: "size-1.5 rounded-full bg-foreground" })) : null }), _jsx("span", { className: `bc truncate ${endTruncateClass}`, children: formatFilterPath(group) })] }, group)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No groups found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null] })] }), _jsx("div", { className: "w-full flex-1 learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(BarChart, { data: data, margin: { top: 12, right: 12, bottom: 12, left: 8 }, children: [_jsx(XAxis, { dataKey: "dayIndex", tickLine: false, axisLine: { stroke: "var(--border)" }, interval: 0, ticks: xTicks, tick: { fontSize: 12 }, tickFormatter: xTickFormatter }), _jsx(YAxis, { tickLine: false, axisLine: { stroke: "var(--border)" }, width: 32, tick: { fontSize: 12 }, ticks: yTicks, domain: [0, yMax] }), _jsx(Tooltip, { content: _jsx(TooltipContent, {}) }), _jsx(Bar, { dataKey: "created", fill: BAR_COLOR, radius: [0, 0, 0, 0] })] }) }) })] }));
}
