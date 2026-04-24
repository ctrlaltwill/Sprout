import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * @file src/analytics/review-calendar-heatmap.tsx
 * @summary GitHub-style calendar heatmap that visualises daily review activity.
 * Each cell represents a day coloured by quantile-based intensity. Supports
 * configurable durations (7, 30, 90, 365 days, or year-to-date), timezone-aware
 * day bucketing, hover tooltips with review count and time spent, and a filter
 * popover for duration selection.
 *
 * @exports
 *   - ReviewCalendarHeatmap — React component rendering an SVG calendar heatmap of daily review counts
 */
import { Platform } from "obsidian";
import * as React from "react";
import { useAnalyticsPopoverZIndex } from "../filter-styles";
import { cssClassForProps } from "../../../platform/core/ui";
const MS_DAY = 24 * 60 * 60 * 1000;
function ChevronIcon({ open }) {
    return (_jsx("svg", { className: `svg-icon learnkit-ana-chevron${open ? " is-open" : ""}`, xmlns: "http://www.w3.org/2000/svg", width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("polyline", { points: "6 4 14 12 6 20" }) }));
}
function useCloseOnOutsideClick(open, wrapRef, popoverRef, onClose) {
    React.useEffect(() => {
        if (!open)
            return undefined;
        let skipNext = true;
        const onDocClick = (ev) => {
            var _a, _b;
            if (skipNext) {
                skipNext = false;
                return;
            }
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
function usePopoverPlacement(open, wrapRef, popoverRef, align = "left") {
    React.useEffect(() => {
        if (!open)
            return undefined;
        const place = () => {
            const popover = popoverRef.current;
            if (!popover)
                return;
            popover.classList.add("learnkit-ana-popover", "learnkit-ana-popover", "learnkit-ana-popover-sm", "learnkit-ana-popover-sm");
            popover.classList.toggle("learnkit-ana-popover-right", align === "right");
            popover.classList.toggle("learnkit-ana-popover-left", align !== "right");
        };
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [open, wrapRef, popoverRef, align]);
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
function formatDateTitle(dayIndex, timeZone) {
    const date = new Date(dayIndex * MS_DAY);
    return date.toLocaleDateString(undefined, {
        timeZone,
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}
function buildQuantiles(values) {
    if (!values.length)
        return [0, 0, 0, 0];
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
    return [q(0.2), q(0.4), q(0.6), q(0.8)];
}
function valueToLevel(value, quantiles) {
    if (value <= 0)
        return 0;
    if (value <= quantiles[0])
        return 1;
    if (value <= quantiles[1])
        return 2;
    if (value <= quantiles[2])
        return 3;
    if (value <= quantiles[3])
        return 4;
    return 5;
}
// Use CSS variables for chart accent colors
// Palette: 0 = border (empty), 1 = lightest, 2 = lighter, 3 = mid, 4 = dark, 5 = darkest (accent)
const palette = [
    "var(--background-modifier-border)", // 0: no activity
    "var(--chart-accent-4)", // 1: lowest (lightest)
    "var(--chart-accent-3)", // 2: light
    "var(--chart-accent-2)", // 3: mid
    "var(--chart-accent-1)", // 4: dark
    "var(--theme-accent)" // 5: most (darkest)
];
export function ReviewCalendarHeatmap(props) {
    var _a, _b;
    const tz = (_a = props.timezone) !== null && _a !== void 0 ? _a : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
    const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
    const [durationDays, setDurationDays] = React.useState((_b = props.rangeDays) !== null && _b !== void 0 ? _b : 365);
    const [open, setOpen] = React.useState(false);
    const [durationOpen, setDurationOpen] = React.useState(false);
    const [hovered, setHovered] = React.useState(null);
    const chartWrapRef = React.useRef(null);
    const dropdownWrapRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnalyticsPopoverZIndex(open, dropdownWrapRef);
    const toggleDurationOpen = () => setDurationOpen((prev) => !prev);
    const onDurationKey = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggleDurationOpen();
        }
    };
    const durationOptions = React.useMemo(() => [7, 30, 90, 365, 0], []);
    const isTouchInput = React.useMemo(() => {
        return Platform.isMobile;
    }, []);
    const resetFilters = () => {
        var _a;
        setDurationDays((_a = props.rangeDays) !== null && _a !== void 0 ? _a : 365);
        setDurationOpen(false);
        setOpen(false);
    };
    React.useEffect(() => {
        var _a;
        setDurationDays((_a = props.rangeDays) !== null && _a !== void 0 ? _a : 365);
    }, [props.rangeDays]);
    const filteredEvents = React.useMemo(() => {
        var _a;
        return ((_a = props.revlog) !== null && _a !== void 0 ? _a : []).filter((ev) => {
            var _a, _b, _c, _d, _e, _f;
            if (!ev || ev.kind !== "review")
                return false;
            if (((_a = props.filters) === null || _a === void 0 ? void 0 : _a.deckId) || ((_b = props.filters) === null || _b === void 0 ? void 0 : _b.groupPath)) {
                const key = String((_d = (_c = ev.scope) === null || _c === void 0 ? void 0 : _c.key) !== null && _d !== void 0 ? _d : "");
                const name = String((_f = (_e = ev.scope) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "");
                if (props.filters.deckId && props.filters.deckId !== key && props.filters.deckId !== name)
                    return false;
                if (props.filters.groupPath && props.filters.groupPath !== key && props.filters.groupPath !== name)
                    return false;
            }
            return true;
        });
    }, [props.revlog, props.filters]);
    useCloseOnOutsideClick(open, dropdownWrapRef, popoverRef, () => setOpen(false));
    usePopoverPlacement(open, dropdownWrapRef, popoverRef, "right");
    const rangeStartIndex = React.useMemo(() => {
        if (durationDays === 0) {
            const nowParts = getDateParts(Date.now(), formatter);
            const jan1 = Date.UTC(nowParts.year, 0, 1);
            return Math.floor(jan1 / MS_DAY);
        }
        return todayIndex - Math.max(1, durationDays) + 1;
    }, [durationDays, todayIndex, formatter]);
    const cells = React.useMemo(() => {
        var _a, _b, _c, _d;
        const endIndex = todayIndex;
        const totalDays = Math.max(1, endIndex - rangeStartIndex + 1);
        const dayMap = new Map();
        for (const ev of filteredEvents) {
            const at = Number(ev.at);
            if (!Number.isFinite(at))
                continue;
            const dayIndex = localDayIndex(at, formatter);
            if (dayIndex < rangeStartIndex || dayIndex > endIndex)
                continue;
            const entry = (_a = dayMap.get(dayIndex)) !== null && _a !== void 0 ? _a : { count: 0, totalMs: 0 };
            entry.count += 1;
            const ms = Number(ev.msToAnswer);
            if (Number.isFinite(ms) && ms > 0)
                entry.totalMs += ms;
            dayMap.set(dayIndex, entry);
        }
        // Special layouts for 7 and 30 days
        if (durationDays === 7) {
            // 7 days: horizontal row, no padding
            const out = [];
            for (let i = 0; i < 7; i++) {
                const dayIndex = endIndex - 6 + i;
                const entry = (_b = dayMap.get(dayIndex)) !== null && _b !== void 0 ? _b : { count: 0, totalMs: 0 };
                out.push({
                    dayIndex,
                    count: entry.count,
                    totalMs: entry.totalMs,
                    isPadding: false,
                    dateLabel: formatDateTitle(dayIndex, tz),
                });
            }
            return out;
        }
        else if (durationDays === 30) {
            // 30 days: calendar grid (7 columns, 5 rows), align most recent day to correct weekday
            const cols = 7;
            const rows = Math.ceil(30 / 7);
            // Find the weekday (0=Sunday, 1=Monday, ...) of the most recent day
            const lastDate = new Date((endIndex) * MS_DAY);
            let lastWeekday = lastDate.getDay();
            // Adjust so Monday=0, Sunday=6 for column index (Monday first)
            lastWeekday = (lastWeekday + 6) % 7;
            // The last cell in the grid should be at col=lastWeekday, row=rows-1
            // Fill backwards from there
            const grid = new Array(rows * cols).fill(null);
            for (let i = 0; i < 30; i++) {
                // Position from the end
                const gridPos = rows * cols - 1 - ((30 - 1 - i) + (cols - 1 - lastWeekday));
                if (gridPos < 0)
                    continue;
                const dayIndex = endIndex - 29 + i;
                const entry = (_c = dayMap.get(dayIndex)) !== null && _c !== void 0 ? _c : { count: 0, totalMs: 0 };
                grid[gridPos] = {
                    dayIndex,
                    count: entry.count,
                    totalMs: entry.totalMs,
                    isPadding: false,
                    dateLabel: formatDateTitle(dayIndex, tz),
                };
            }
            // Fill any empty cells as padding
            for (let i = 0; i < grid.length; i++) {
                if (!grid[i]) {
                    grid[i] = {
                        dayIndex: -1,
                        count: 0,
                        totalMs: 0,
                        isPadding: true,
                        dateLabel: "",
                    };
                }
            }
            return grid;
        }
        else {
            // Default: calendar grid with padding
            const startDate = new Date(rangeStartIndex * MS_DAY);
            const startWeekday = startDate.getUTCDay();
            const weekStartsOn = 1;
            const padStart = (startWeekday - weekStartsOn + 7) % 7;
            const firstIndex = rangeStartIndex - padStart;
            const totalCells = Math.ceil((totalDays + padStart) / 7) * 7;
            const out = [];
            for (let i = 0; i < totalCells; i += 1) {
                const dayIndex = firstIndex + i;
                const entry = (_d = dayMap.get(dayIndex)) !== null && _d !== void 0 ? _d : { count: 0, totalMs: 0 };
                const isPadding = dayIndex < rangeStartIndex || dayIndex > endIndex;
                out.push({
                    dayIndex,
                    count: entry.count,
                    totalMs: entry.totalMs,
                    isPadding,
                    dateLabel: formatDateTitle(dayIndex, tz),
                });
            }
            return out;
        }
    }, [filteredEvents, formatter, rangeStartIndex, todayIndex, tz, durationDays]);
    const quantiles = React.useMemo(() => {
        const values = cells
            .filter((c) => !c.isPadding)
            .map((c) => c.count)
            .filter((v) => v > 0);
        return buildQuantiles(values);
    }, [cells]);
    let gridWidth = Math.ceil(cells.length / 7) * 16;
    let gridHeight = 7 * 16;
    if (durationDays === 7) {
        gridWidth = 7 * 16;
        gridHeight = 16;
    }
    else if (durationDays === 30) {
        gridWidth = 7 * 16;
        gridHeight = Math.ceil(30 / 7) * 16;
    }
    const setHoveredFromRect = React.useCallback((cell, rect) => {
        var _a, _b, _c;
        const wrapRect = (_a = chartWrapRef.current) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect();
        const x = rect.left - ((_b = wrapRect === null || wrapRect === void 0 ? void 0 : wrapRect.left) !== null && _b !== void 0 ? _b : 0) + rect.width / 2;
        const y = rect.top - ((_c = wrapRect === null || wrapRect === void 0 ? void 0 : wrapRect.top) !== null && _c !== void 0 ? _c : 0) - 8;
        setHovered({ cell, x, y });
    }, []);
    const clearHovered = React.useCallback(() => {
        setHovered(null);
    }, []);
    return (_jsxs("div", { className: "card learnkit-ana-card learnkit-ana-min-320 p-4 flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "", children: [_jsx("div", { className: "flex items-center gap-1", children: _jsx("div", { className: "font-semibold lk-home-section-title", children: "Study heatmap" }) }), _jsx("div", { className: "text-xs text-muted-foreground", children: "Reviews per day" })] }), _jsxs("div", { ref: dropdownWrapRef, className: "relative inline-flex", children: [_jsxs("button", { id: "learnkit-heatmap-filter-trigger", type: "button", className: "learnkit-btn-toolbar learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2", "aria-haspopup": "listbox", "aria-expanded": open ? "true" : "false", "aria-controls": "learnkit-heatmap-filter-listbox", onClick: () => setOpen((prev) => !prev), children: [_jsx("svg", { className: "svg-icon lucide-filter", xmlns: "http://www.w3.org/2000/svg", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polygon", { points: "22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" }) }), _jsx("span", { className: "", children: "Filter" })] }), open ? (_jsx("div", { id: "learnkit-heatmap-filter-popover", "aria-hidden": "false", ref: popoverRef, className: "rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm", children: _jsxs("div", { className: "p-1", children: [_jsxs("div", { className: "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline", role: "button", tabIndex: 0, "aria-expanded": durationOpen ? "true" : "false", onClick: toggleDurationOpen, onKeyDown: onDurationKey, children: [_jsx("span", { className: "", children: "Duration" }), _jsx(ChevronIcon, { open: durationOpen })] }), durationOpen ? (_jsx("div", { role: "menu", "aria-orientation": "vertical", className: "flex flex-col", children: durationOptions.map((opt) => {
                                                const selected = durationDays === opt;
                                                const label = opt === 0 ? "Year to date" : `${opt} days`;
                                                return (_jsxs("div", { role: "menuitemradio", "aria-checked": selected ? "true" : "false", tabIndex: 0, className: "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", onClick: () => setDurationDays(opt), onKeyDown: (event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setDurationDays(opt);
                                                        }
                                                    }, children: [_jsx("div", { className: "size-4 flex items-center justify-center", children: _jsx("div", { className: "size-2 rounded-full bg-foreground invisible group-aria-checked:visible", "aria-hidden": "true" }) }), _jsx("span", { className: "", children: label })] }, opt));
                                            }) })) : null, _jsx("div", { className: "h-px bg-border my-1", role: "separator" }), _jsx("div", { className: "text-sm text-muted-foreground cursor-pointer px-2", onClick: resetFilters, children: "Reset filters" })] }) })) : null] })] }), _jsxs("div", { ref: chartWrapRef, className: "relative flex flex-1 items-center learnkit-ana-min-120", children: [_jsx("div", { className: "w-full overflow-x-auto overflow-y-hidden", children: _jsx("svg", { className: "block mx-auto", width: gridWidth, height: gridHeight, viewBox: `0 0 ${gridWidth} ${gridHeight}`, children: cells.map((cell, idx) => {
                                let col = Math.floor(idx / 7);
                                let row = idx % 7;
                                if (durationDays === 7) {
                                    col = idx;
                                    row = 0;
                                }
                                else if (durationDays === 30) {
                                    col = idx % 7;
                                    row = Math.floor(idx / 7);
                                }
                                const level = cell.isPadding ? 0 : valueToLevel(cell.count, quantiles);
                                const fill = cell.isPadding ? "transparent" : palette[level];
                                return (_jsx("rect", { x: col * 16, y: row * 16, width: 12, height: 12, rx: 3, ry: 3, fill: fill, onMouseEnter: (event) => {
                                        if (isTouchInput || cell.isPadding)
                                            return;
                                        setHoveredFromRect(cell, event.currentTarget.getBoundingClientRect());
                                    }, onMouseLeave: () => {
                                        if (isTouchInput)
                                            return;
                                        clearHovered();
                                    }, onTouchStart: (event) => {
                                        if (cell.isPadding)
                                            return;
                                        setHoveredFromRect(cell, event.currentTarget.getBoundingClientRect());
                                    }, onClick: (event) => {
                                        if (cell.isPadding || !isTouchInput)
                                            return;
                                        const nextCell = hovered === null || hovered === void 0 ? void 0 : hovered.cell;
                                        if (nextCell && nextCell.dayIndex === cell.dayIndex) {
                                            clearHovered();
                                            return;
                                        }
                                        setHoveredFromRect(cell, event.currentTarget.getBoundingClientRect());
                                    } }, `${cell.dayIndex}-${idx}`));
                            }) }) }), hovered ? (_jsxs("div", { className: "learnkit-data-tooltip-surface learnkit-ana-heatmap-tooltip", style: {
                            "--learnkit-ana-x": `${hovered.x}px`,
                            "--learnkit-ana-y": `${hovered.y}px`,
                        }, children: [_jsx("div", { className: "text-sm font-medium text-background", children: hovered.cell.dateLabel }), _jsxs("div", { className: "text-background", children: ["Reviews: ", hovered.cell.count] }), _jsxs("div", { className: "text-background", children: ["Time: ", Math.max(1, Math.ceil(hovered.cell.totalMs / 60000)), " min"] })] })) : null] }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { className: "", children: "Less" }), _jsx("div", { className: "inline-flex items-center gap-1", children: palette.slice(1).map((color, idx) => (_jsx("span", { className: `inline-block learnkit-ana-legend-dot learnkit-ana-legend-dot-square ${cssClassForProps({ "--learnkit-legend-color": color })}` }, `${color}-${idx}`))) }), _jsx("span", { className: "", children: "More" })] })] }));
}
