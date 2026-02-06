// answerbuttons graph

export function renderAnswerButtonsGraph(parent: HTMLElement, plugin: any, byResult: Record<string, number>) {
  const c = parent.createDiv({ cls: "bc card sprout-ana-card" });
  const body = c.createEl("section", { cls: "bc sprout-ana-card-body space-y-3" });

  body.createDiv({ cls: "bc font-semibold", text: "Answer buttons" });

  const wrap = document.createElement("div");
  wrap.className = "bc grid gap-2 text-sm";

  const rows: Record<string, number> = {
    Again: byResult.again ?? 0,
    Hard: byResult.hard ?? 0,
    Good: byResult.good ?? 0,
    Easy: byResult.easy ?? 0,
  };

  for (const [k, v] of Object.entries(rows)) {
    const row = document.createElement("div");
    row.className = "bc flex items-center justify-between gap-3";
    row.appendChild(Object.assign(document.createElement("div"), { textContent: k }));
    row.appendChild(Object.assign(document.createElement("div"), { textContent: String(v) }));
    wrap.appendChild(row);
  }

  body.appendChild(wrap);

  body.createDiv({
    cls: "bc text-sm text-muted-foreground",
    text: "From stored analytics events (recent range).",
  });
}
