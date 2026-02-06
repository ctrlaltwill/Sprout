import { computeStudyHeatmapDays, computeDueHeatmapDays, renderHeatmap } from "./heatmap";

export function renderHeatmapGraph(
  parent: HTMLElement,
  plugin: any,
  opts: { events: any[]; states: Record<string, any>; now: number; heatRange: string }
) {
  const card = parent.createDiv({ cls: "bc card sprout-ana-card" });
  const header = card.createEl("header", { cls: "bc flex items-start justify-between gap-3" });
  header
    .createDiv({ cls: "bc space-y-1" })
    .createEl("h2", { text: "Daily study heatmap" });

  const body = card.createEl("section", { cls: "bc sprout-ana-card-body space-y-3" });
  const wrap = body.createDiv({ cls: "bc sprout-ana-heatmap-wrap" });

  let days: any[] = [];
  let layout: "calendar30" | "horizontal7" | undefined = undefined;
  const hasStudy = opts.events.some((e) => e && e.kind === "review");
  if (opts.heatRange === "7d") {
    // 7 days: horizontal row
    days = hasStudy
      ? computeStudyHeatmapDays({ events: opts.events, weeks: 1, nowMs: opts.now, useMinutes: true })
      : computeDueHeatmapDays({ states: opts.states, weeks: 1, nowMs: opts.now, includeSuspended: false });
    layout = "horizontal7";
  } else if (opts.heatRange === "30d") {
    // 30 days: calendar grid
    days = hasStudy
      ? computeStudyHeatmapDays({ events: opts.events, weeks: 5, nowMs: opts.now, useMinutes: true })
      : computeDueHeatmapDays({ states: opts.states, weeks: 5, nowMs: opts.now, includeSuspended: false });
    layout = "calendar30";
    days = days.slice(-30); // Only last 30 days
  } else if (opts.heatRange === "90d") {
    days = hasStudy
      ? computeStudyHeatmapDays({ events: opts.events, weeks: 13, nowMs: opts.now, useMinutes: true })
      : computeDueHeatmapDays({ states: opts.states, weeks: 13, nowMs: opts.now, includeSuspended: false });
  } else {
    days = hasStudy
      ? computeStudyHeatmapDays({ events: opts.events, weeks: 53, nowMs: opts.now, useMinutes: true })
      : computeDueHeatmapDays({ states: opts.states, weeks: 53, nowMs: opts.now, includeSuspended: false });
  }
  // @ts-ignore: allow extra arg for layout
  renderHeatmap(wrap, days, layout);
}
