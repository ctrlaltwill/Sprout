export function renderStageGraph(
  parent: HTMLElement,
  plugin: any,
  stageCounts: Record<string, number>
) {
  const c = parent.createDiv({ cls: "bc card sprout-ana-card" });

  const body = c.createEl("section", { cls: "bc sprout-ana-card-body space-y-3" });

  body.createDiv({ cls: "bc font-semibold", text: "Cards by stage" });

  const wrap = document.createElement("div");
  wrap.className = "bc grid gap-2 text-sm";

  const entries = Object.entries(stageCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  for (const [k, v] of entries) {
    const row = document.createElement("div");
    
    row.className = "bc flex items-center justify-between gap-3";

    row.appendChild(Object.assign(document.createElement("div"), { textContent: k }));
    row.appendChild(Object.assign(document.createElement("div"), { textContent: String(v) }));
    wrap.appendChild(row);
  }

  body.appendChild(wrap);

  body.createDiv({
    cls: "bc text-sm text-muted-foreground",
    text: "Chart (donut) scaffolded; render later.",
  });
}
