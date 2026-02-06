export function renderReviewForecastGraph(parent: HTMLElement, plugin: any, dueForecast: any) {
  const c = parent.createDiv({ cls: "bc card sprout-ana-card" });
  const body = c.createEl("section", { cls: "bc sprout-ana-card-body space-y-3" });

  body.createDiv({ cls: "bc font-semibold", text: "Review forecast" });

  const rows: Record<string, number> = {
    "Next 1 day": dueForecast.byDays[1] ?? 0,
    "Next 7 days": dueForecast.byDays[7] ?? 0,
    "Next 30 days": dueForecast.byDays[30] ?? 0,
    "Next 90 days": dueForecast.byDays[90] ?? 0,
  };

  const wrap = document.createElement("div");
  wrap.className = "bc grid gap-2 text-sm";

  // Assign a color to each forecast row using chart accent variables
  const rowColors = [
    "var(--chart-accent-1)",
    "var(--chart-accent-2)",
    "var(--chart-accent-3)",
    "var(--chart-accent-4)"
  ];
  let i = 0;
  for (const [k, v] of Object.entries(rows)) {
    const row = document.createElement("div");
    row.className = "bc flex items-center justify-between gap-3";
    const color = rowColors[i % rowColors.length] || "var(--theme-accent)";
    row.style.setProperty("--row-accent", color);

    const label = document.createElement("div");
    label.textContent = k;
    label.style.color = "var(--row-accent)";

    const value = document.createElement("div");
    value.textContent = String(v);
    value.style.color = "var(--row-accent)";

    row.appendChild(label);
    row.appendChild(value);
    wrap.appendChild(row);
    i++;
  }

  body.appendChild(wrap);

  body.createDiv({
    cls: "bc text-sm text-muted-foreground",
    text: "Chart (bars) scaffolded; render later.",
  });
}
