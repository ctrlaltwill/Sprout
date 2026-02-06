const MS_DAY = 24 * 60 * 60 * 1000;

type HeatmapDay = {
  dayStart: number;
  value: number;
};

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildDayRange(weeks: number, nowMs: number) {
  const totalDays = Math.max(1, Math.floor(weeks) * 7);
  const end = startOfDay(nowMs);
  const start = end - (totalDays - 1) * MS_DAY;
  const days: HeatmapDay[] = [];

  for (let i = 0; i < totalDays; i += 1) {
    days.push({ dayStart: start + i * MS_DAY, value: 0 });
  }

  return { days, start, end };
}

function getDayIndex(dayStart: number, rangeStart: number) {
  return Math.floor((dayStart - rangeStart) / MS_DAY);
}

export function computeStudyHeatmapDays(args: {
  events: any[];
  weeks: number;
  nowMs: number;
  useMinutes: boolean;
}): HeatmapDay[] {
  const { days, start } = buildDayRange(args.weeks, args.nowMs);

  for (const ev of args.events || []) {
    if (!ev || typeof ev !== "object" || ev.kind !== "review") continue;

    const at = Number(ev.at);
    if (!Number.isFinite(at)) continue;

    const dayStart = startOfDay(at);
    const idx = getDayIndex(dayStart, start);
    if (idx < 0 || idx >= days.length) continue;

    let inc = 1;
    if (args.useMinutes) {
      const ms = Number(ev.msToAnswer);
      inc = Number.isFinite(ms) && ms > 0 ? ms / 60000 : 1;
    }

    days[idx].value += inc;
  }

  return days;
}

export function computeDueHeatmapDays(args: {
  states: Record<string, any>;
  weeks: number;
  nowMs: number;
  includeSuspended: boolean;
}): HeatmapDay[] {
  const { days, start } = buildDayRange(args.weeks, args.nowMs);

  for (const st of Object.values(args.states || {})) {
    if (!st || typeof st !== "object") continue;
    if (!args.includeSuspended && (st as any).stage === "suspended") continue;

    const due = Number((st as any).due);
    if (!Number.isFinite(due)) continue;

    const dayStart = startOfDay(due);
    const idx = getDayIndex(dayStart, start);
    if (idx < 0 || idx >= days.length) continue;

    days[idx].value += 1;
  }

  return days;
}

export function renderHeatmap(parent: HTMLElement, days: HeatmapDay[]) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);

  const grid = document.createElement("div");
  grid.className = "bc";
  grid.style.display = "grid";
  grid.style.gap = "4px";

  // Determine layout based on number of days
  if (days.length === 7) {
    // 1 week: horizontal row
    grid.style.gridTemplateColumns = "repeat(7, 1fr)";
    grid.style.gridTemplateRows = "1fr";
  } else if (days.length === 30) {
    // 30 days: calendar grid (7 rows, ceil(30/7) columns)
    const cols = Math.ceil(30 / 7);
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = "repeat(7, 1fr)";
  } else if (days.length === 90) {
    // 90 days: 7 rows x 13 columns (calendar style, rotated)
    grid.style.gridTemplateColumns = "repeat(13, 1fr)";
    grid.style.gridTemplateRows = "repeat(7, 1fr)";
  } else {
    // Default: horizontal row for any other case
    grid.style.gridTemplateColumns = `repeat(${days.length}, 1fr)`;
    grid.style.gridTemplateRows = "1fr";
  }
  parent.appendChild(grid);

  const max = Math.max(1, ...days.map((d) => d.value));

  if (days.length === 90) {
    // 90 days: fill 7x13 grid, left-to-right, top-to-bottom (calendar style)
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 13; col++) {
        const idx = col * 7 + row;
        if (idx >= days.length) continue;
        const day = days[idx];
        const cell = document.createElement("div");
        cell.className = "bc";
        cell.style.width = "12px";
        cell.style.height = "12px";
        cell.style.borderRadius = "3px";
        cell.style.backgroundColor = "var(--background-modifier-border)";
        if (day.value > 0) {
          const pct = Math.max(0, Math.min(1, day.value / max));
          if (pct < 0.01) {
            cell.style.backgroundColor = "var(--background-modifier-border)";
          } else if (pct < 0.2) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 20%, white 80%)";
          } else if (pct < 0.4) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 40%, white 60%)";
          } else if (pct < 0.6) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 60%, white 40%)";
          } else if (pct < 0.8) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 80%, black 20%)";
          } else {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 60%, black 40%)";
          }
        }
        const label = new Date(day.dayStart).toLocaleDateString();
        cell.setAttribute("title", `${label}: ${day.value.toFixed(1)}`);
        grid.appendChild(cell);
      }
    }
  } else if (days.length === 30) {
    // 30 days: fill calendar grid, left-to-right, top-to-bottom (7 rows, ceil(30/7) columns)
    const cols = Math.ceil(30 / 7);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = col * 7 + row;
        if (idx >= days.length) continue;
        const day = days[idx];
        const cell = document.createElement("div");
        cell.className = "bc";
        cell.style.width = "12px";
        cell.style.height = "12px";
        cell.style.borderRadius = "3px";
        cell.style.backgroundColor = "var(--background-modifier-border)";
        if (day.value > 0) {
          const pct = Math.max(0, Math.min(1, day.value / max));
          if (pct < 0.01) {
            cell.style.backgroundColor = "var(--background-modifier-border)";
          } else if (pct < 0.2) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 20%, white 80%)";
          } else if (pct < 0.4) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 40%, white 60%)";
          } else if (pct < 0.6) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 60%, white 40%)";
          } else if (pct < 0.8) {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 80%, black 20%)";
          } else {
            cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 60%, black 40%)";
          }
        }
        const label = new Date(day.dayStart).toLocaleDateString();
        cell.setAttribute("title", `${label}: ${day.value.toFixed(1)}`);
        grid.appendChild(cell);
      }
    }
  } else {
    // 7 days or any other: just render in order (horizontal row)
    for (const day of days) {
      const cell = document.createElement("div");
      cell.className = "bc";
      cell.style.width = "12px";
      cell.style.height = "12px";
      cell.style.borderRadius = "3px";
      cell.style.backgroundColor = "var(--background-modifier-border)";
      if (day.value > 0) {
        const pct = Math.max(0, Math.min(1, day.value / max));
        if (pct < 0.01) {
          cell.style.backgroundColor = "var(--background-modifier-border)";
        } else if (pct < 0.2) {
          cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 20%, white 80%)";
        } else if (pct < 0.4) {
          cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 40%, white 60%)";
        } else if (pct < 0.6) {
          cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 60%, white 40%)";
        } else if (pct < 0.8) {
          cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 80%, black 20%)";
        } else {
          cell.style.backgroundColor = "color-mix(in oklab, var(--theme-accent) 60%, black 40%)";
        }
      }
      const label = new Date(day.dayStart).toLocaleDateString();
      cell.setAttribute("title", `${label}: ${day.value.toFixed(1)}`);
      grid.appendChild(cell);
    }
  }
}

