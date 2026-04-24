import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @file src/analytics/stacked-review-buttons-chart.tsx
 * @summary Stacked bar chart showing daily counts of Again, Hard, Good, and Easy
 * answer-button presses over a configurable window (7, 30, or 90 days). Each day
 * is a stacked bar coloured by response type. Supports filtering by card type,
 * deck, and group tags, with timezone-aware day bucketing.
 *
 * @exports
 *   - StackedReviewButtonsChart — React component rendering a stacked bar chart of daily answer button counts with filter controls
 */
import * as React from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "../chart-axis-utils";
import { endTruncateClass, useAnalyticsPopoverZIndex } from "../filter-styles";
import { MS_DAY } from "../../../platform/core/constants";
import { cssClassForProps } from "../../../platform/core/ui";
function InfoIcon(props) {
    return (_jsx("span", { className: "inline-flex items-center text-muted-foreground", "data-tooltip": props.text, "data-tooltip-position": "right", children: _jsxs("svg", { className: "svg-icon lucide-info", xmlns: "http://www.w3.org/2000/svg", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("path", { d: "M12 16v-4" }), _jsx("path", { d: "M12 8h.01" })] }) }));
}
const COLORS = {
    again: "var(--chart-accent-1)",
    hard: "var(--chart-accent-2)",
    good: "var(--chart-accent-3)",
    easy: "var(--chart-accent-4)",
};
const MAX_SELECTIONS = 3;
function ChevronIcon({ open }) {
    return (_jsx("svg", { className: `svg-icon learnkit-ana-chevron${open ? " is-open" : ""}`, xmlns: "http://www.w3.org/2000/svg", width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("polyline", { points: "6 4 14 12 6 20" }) }));
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
function useCloseOnOutsideClick(open, wrapRef, popoverRef, onClose) {
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
            onClose();
        };
        document.addEventListener("mousedown", onDocClick, true);
        return () => document.removeEventListener("mousedown", onDocClick, true);
    }, [open, wrapRef, popoverRef, onClose]);
}
function usePopoverPlacement(open, wrapRef, popoverRef) {
    React.useEffect(() => {
        if (!open)
            return undefined;
        const place = () => {
            const popover = popoverRef.current;
            if (!popover)
                return;
            popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
            popover.classList.add("learnkit-ana-popover", "learnkit-ana-popover", "learnkit-ana-popover-right", "learnkit-ana-popover-right");
        };
        place();
        window.addEventListener("resize", place, true);
        window.addEventListener("scroll", place, true);
        return () => {
            window.removeEventListener("resize", place, true);
            window.removeEventListener("scroll", place, true);
        };
    }, [open, wrapRef, popoverRef]);
}
const TYPE_LABELS = {
    all: "All cards",
    basic: "Basic",
    "reversed-child": "Basic (Reversed)",
    "cloze-child": "Cloze",
    "io-child": "Image occlusion",
    mcq: "Multiple choice",
};
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
function getEventDeck(ev, cardById) {
    var _a, _b, _c, _d;
    const raw = (_b = (_a = ev.deckPath) !== null && _a !== void 0 ? _a : ev.deckId) !== null && _b !== void 0 ? _b : ev.sourceNotePath;
    const deck = String(raw !== null && raw !== void 0 ? raw : "").trim();
    if (deck)
        return deck;
    const cardId = String((_c = ev.cardId) !== null && _c !== void 0 ? _c : "").trim();
    if (!cardId || !cardById)
        return null;
    const card = cardById.get(cardId);
    const fallback = String((_d = card === null || card === void 0 ? void 0 : card.sourceNotePath) !== null && _d !== void 0 ? _d : "").trim();
    return fallback ? fallback : null;
}
function getEventGroups(ev, cardById) {
    var _a, _b;
    if (Array.isArray(ev.groups))
        return ev.groups.filter(Boolean);
    if (Array.isArray(ev.tags))
        return ev.tags.filter(Boolean);
    const single = String((_a = ev.groupPath) !== null && _a !== void 0 ? _a : "").trim();
    if (single)
        return [single];
    const cardId = String((_b = ev.cardId) !== null && _b !== void 0 ? _b : "").trim();
    if (!cardId || !cardById)
        return [];
    const card = cardById.get(cardId);
    if (!card || !Array.isArray(card.groups))
        return [];
    return card.groups.filter(Boolean);
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
function TooltipContent(props) {
    var _a;
    if (!props.active || !props.payload || !props.payload.length)
        return null;
    const datum = (_a = props.payload[0]) === null || _a === void 0 ? void 0 : _a.payload;
    if (!datum)
        return null;
    return (_jsxs("div", { className: "learnkit-data-tooltip-surface", children: [_jsx("div", { className: "text-sm font-medium text-background", children: datum.date }), _jsxs("div", { className: "text-background", children: ["Again: ", datum.again] }), _jsxs("div", { className: "text-background", children: ["Hard: ", datum.hard] }), _jsxs("div", { className: "text-background", children: ["Good: ", datum.good] }), _jsxs("div", { className: "text-background", children: ["Easy: ", datum.easy] })] }));
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
export function StackedReviewButtonsChart(props) {
    var _a, _b, _c, _d, _e, _f;
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
    const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
    const startIndex = todayIndex - (durationDays - 1);
    const availableTypes = React.useMemo(() => ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"], []);
    const cardById = React.useMemo(() => {
        var _a;
        const map = new Map();
        for (const card of (_a = props.cards) !== null && _a !== void 0 ? _a : []) {
            if (!(card === null || card === void 0 ? void 0 : card.id))
                continue;
            map.set(String(card.id), card);
        }
        return map;
    }, [props.cards]);
    const allDecks = React.useMemo(() => {
        var _a;
        const decks = new Set();
        for (const ev of (_a = props.events) !== null && _a !== void 0 ? _a : []) {
            const deck = getEventDeck(ev, cardById);
            if (deck)
                decks.add(deck);
        }
        return Array.from(decks).sort((a, b) => a.localeCompare(b));
    }, [props.events, cardById]);
    const allGroups = React.useMemo(() => {
        var _a;
        const groups = new Set();
        for (const ev of (_a = props.events) !== null && _a !== void 0 ? _a : []) {
            for (const group of getEventGroups(ev, cardById))
                groups.add(group);
        }
        return Array.from(groups).sort((a, b) => a.localeCompare(b));
    }, [props.events, cardById]);
    const matchedDecks = React.useMemo(() => rankFilterMatches(allDecks, deckQuery, 5), [allDecks, deckQuery]);
    const matchedGroups = React.useMemo(() => rankFilterMatches(allGroups, groupQuery, 5), [allGroups, groupQuery]);
    const typeCounts = React.useMemo(() => {
        var _a, _b, _c;
        const counts = new Map();
        for (const type of availableTypes)
            counts.set(type, 0);
        for (const ev of (_a = props.events) !== null && _a !== void 0 ? _a : []) {
            if (!ev || ev.kind !== "review")
                continue;
            const t = normalizeEventType((_b = ev.cardType) !== null && _b !== void 0 ? _b : "");
            if (!t)
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
    }, [availableTypes, props.events]);
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
    React.useEffect(() => {
        var _a;
        setDurationDays((_a = props.days) !== null && _a !== void 0 ? _a : 30);
    }, [props.days]);
    useCloseOnOutsideClick(open, wrapRef, popoverRef, () => setOpen(false));
    usePopoverPlacement(open, wrapRef, popoverRef);
    const data = React.useMemo(() => {
        var _a, _b, _c;
        const rows = [];
        const map = new Map();
        for (let i = 0; i < durationDays; i += 1) {
            const dayIndex = startIndex + i;
            const base = {
                label: formatDayLabel(dayIndex, tz),
                date: formatDayTitle(dayIndex, tz),
                again: 0,
                hard: 0,
                good: 0,
                easy: 0,
                dayIndex,
            };
            rows.push(base);
            map.set(dayIndex, base);
        }
        for (const ev of (_a = props.events) !== null && _a !== void 0 ? _a : []) {
            if (!ev || ev.kind !== "review")
                continue;
            const at = Number(ev.at);
            if (!Number.isFinite(at))
                continue;
            const dayIndex = localDayIndex(at, formatter);
            if (dayIndex < startIndex || dayIndex > todayIndex)
                continue;
            const t = normalizeEventType((_b = ev.cardType) !== null && _b !== void 0 ? _b : "");
            if (selectedType !== "all" && t !== selectedType)
                continue;
            if (selectedDecks.length) {
                const deck = getEventDeck(ev, cardById);
                if (!deck || !selectedDecks.includes(deck))
                    continue;
            }
            if (selectedGroups.length) {
                const groups = getEventGroups(ev, cardById);
                const hasGroup = selectedGroups.some((group) => groups.includes(group));
                if (!hasGroup)
                    continue;
            }
            const row = map.get(dayIndex);
            if (!row)
                continue;
            const result = String((_c = ev.result) !== null && _c !== void 0 ? _c : "");
            if (result === "again")
                row.again += 1;
            else if (result === "hard")
                row.hard += 1;
            else if (result === "good")
                row.good += 1;
            else if (result === "easy")
                row.easy += 1;
        }
        return rows;
    }, [
        props.events,
        formatter,
        tz,
        durationDays,
        startIndex,
        todayIndex,
        selectedType,
        selectedDecks,
        selectedGroups,
        cardById,
    ]);
    const durationOptions = React.useMemo(() => [7, 30, 90], []);
    const xTicks = React.useMemo(() => {
        const endIndex = startIndex + durationDays - 1;
        return createXAxisTicks(startIndex, endIndex, todayIndex);
    }, [startIndex, durationDays, todayIndex]);
    const xTickFormatter = (value) => formatAxisLabel(value, todayIndex, (dayIndex) => formatDayLabel(dayIndex, tz));
    const yMax = React.useMemo(() => {
        const maxValue = data.reduce((max, row) => Math.max(max, row.again + row.hard + row.good + row.easy), 0);
        return roundUpToNearest10(maxValue);
    }, [data]);
    const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);
    return (_jsxs("div", { className: "card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("div", { className: "font-semibold lk-home-section-title", children: "Answer buttons" }), _jsx(InfoIcon, { text: "Daily counts of Again/Hard/Good/Easy ratings." })] }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Stacked daily totals" })] }), _jsxs("div", { ref: wrapRef, className: "relative inline-flex", children: [_jsxs("button", { type: "button", id: "learnkit-answer-buttons-filter-trigger", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", "aria-controls": "learnkit-answer-buttons-filter-listbox", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter text-foreground", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { children: "Filter" })] }), open ? (_jsx("div", { id: "learnkit-answer-buttons-filter-popover", "aria-hidden": "false", ref: popoverRef, className: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm", children: _jsxs("div", { className: "p-1", children: [_jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": durationOpen ? "true" : "false", onClick: toggleDurationOpen, onKeyDown: onDurationKey, children: [_jsx("span", { children: "Duration" }), _jsx(ChevronIcon, { open: durationOpen })] }), durationOpen ? (_jsx("div", { role: "menu", "aria-orientation": "vertical", className: "flex flex-col", children: durationOptions.map((opt) => {
                                                const selected = durationDays === opt;
                                                return (_jsxs("div", { role: "menuitemradio", "aria-checked": selected ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setDurationDays(opt), onKeyDown: (event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setDurationDays(opt);
                                                        }
                                                    }, children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsx("span", { children: `${opt} days` })] }, opt));
                                            }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": cardTypeOpen ? "true" : "false", onClick: toggleCardTypeOpen, onKeyDown: onCardTypeKey, children: [_jsx("span", { children: "Card type" }), _jsx(ChevronIcon, { open: cardTypeOpen })] }), cardTypeOpen ? (_jsx("div", { role: "menu", id: "learnkit-answer-buttons-filter-listbox", "aria-orientation": "vertical", "data-tooltip": "Answer buttons filter", className: "flex flex-col", children: availableTypes.map((type) => {
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
                                                } }) }), deckQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedDecks.length ? (matchedDecks.map((deck) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleDeck(deck), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedDecks.includes(deck) ? (_jsx("span", { className: "size-1.5 rounded-full bg-foreground" })) : null }), _jsx("span", { className: `truncate ${endTruncateClass}`, children: formatFilterPath(deck) })] }, deck)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No decks found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground px-2 py-1", children: "Groups" }), _jsx("div", { className: "px-2 pb-2", children: _jsx("input", { type: "text", placeholder: "Search groups", className: "input w-full text-sm learnkit-filter-search-input", value: groupQuery, onChange: (event) => {
                                                    const next = event.currentTarget.value;
                                                    setGroupQuery(next);
                                                    if (!next.trim())
                                                        setSelectedGroups([]);
                                                } }) }), groupQuery.trim().length ? (_jsx("div", { className: "px-2 pb-2", children: _jsx("div", { className: "flex flex-col", children: matchedGroups.length ? (matchedGroups.map((group) => (_jsxs("div", { role: "menuitem", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0", onClick: () => toggleGroup(group), children: [_jsx("span", { className: "size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center", children: selectedGroups.includes(group) ? (_jsx("span", { className: "size-1.5 rounded-full bg-foreground" })) : null }), _jsx("span", { className: `truncate ${endTruncateClass}`, children: formatFilterPath(group) })] }, group)))) : (_jsx("div", { className: "px-2 py-1 text-sm text-muted-foreground", children: "No groups found." })) }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null] })] }), _jsx("div", { className: "w-full flex-1 learnkit-analytics-chart", children: _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(BarChart, { data: data, margin: { top: 12, right: 12, bottom: 12, left: 8 }, children: [_jsx(XAxis, { dataKey: "dayIndex", tickLine: false, axisLine: { stroke: "var(--border)" }, interval: 0, ticks: xTicks, tick: { fontSize: 12 }, tickFormatter: xTickFormatter }), _jsx(YAxis, { tickLine: false, axisLine: { stroke: "var(--border)" }, width: 32, tick: { fontSize: 12 }, ticks: yTicks, domain: [0, yMax] }), _jsx(Tooltip, { content: _jsx(TooltipContent, {}) }), _jsx(Bar, { dataKey: "again", stackId: "a", fill: COLORS.again, radius: [0, 0, 0, 0], isAnimationActive: (_c = props.enableAnimations) !== null && _c !== void 0 ? _c : true }), _jsx(Bar, { dataKey: "hard", stackId: "a", fill: COLORS.hard, radius: [0, 0, 0, 0], isAnimationActive: (_d = props.enableAnimations) !== null && _d !== void 0 ? _d : true }), _jsx(Bar, { dataKey: "good", stackId: "a", fill: COLORS.good, radius: [0, 0, 0, 0], isAnimationActive: (_e = props.enableAnimations) !== null && _e !== void 0 ? _e : true }), _jsx(Bar, { dataKey: "easy", stackId: "a", fill: COLORS.easy, radius: [0, 0, 0, 0], isAnimationActive: (_f = props.enableAnimations) !== null && _f !== void 0 ? _f : true })] }) }) }), _jsxs("div", { className: "flex flex-wrap gap-3 text-xs text-muted-foreground learnkit-ana-chart-legend", children: [_jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": COLORS.again })}` }), _jsx("span", { className: "", children: "Again" })] }), _jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": COLORS.hard })}` }), _jsx("span", { className: "", children: "Hard" })] }), _jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": COLORS.good })}` }), _jsx("span", { className: "", children: "Good" })] }), _jsxs("div", { className: "inline-flex items-center gap-2", children: [_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": COLORS.easy })}` }), _jsx("span", { className: "", children: "Easy" })] })] })] }));
}
