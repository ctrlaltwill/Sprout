function countNewCardsInRange(cards: any[], start: number, end: number): number {
  let n = 0;
  for (const c of cards) {
    const t = Number((c as any)?.createdAt);
    if (!Number.isFinite(t)) continue;
    if (t >= start && t <= end) n += 1;
  }
  return n;
}

export function renderNewCardsGraph(parent: HTMLElement, plugin: any, cards: any[], now: number) {
  const c = parent.createDiv({ cls: "card sprout-ana-card" });
  const body = c.createEl("section", { cls: "sprout-ana-card-body space-y-3" });

  body.createDiv({ cls: "font-semibold", text: "New cards added" });

  const daysToMs = (d: number) => d * 24 * 60 * 60 * 1000;
  const horizonDays = 30;
  const n30 = countNewCardsInRange(cards, now - daysToMs(horizonDays), now);

  const rows: Record<string, number> = {
    "Last 7 days": countNewCardsInRange(cards, now - daysToMs(7), now),
    "Last 30 days": n30,
    "Last 90 days": countNewCardsInRange(cards, now - daysToMs(90), now),
  };

  const wrap = document.createElement("div");
  wrap.className = "grid gap-2 text-sm";
  for (const [k, v] of Object.entries(rows)) {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-3";
    row.appendChild(Object.assign(document.createElement("div"), { textContent: k }));
    row.appendChild(Object.assign(document.createElement("div"), { textContent: String(v) }));
    wrap.appendChild(row);
  }
  body.appendChild(wrap);

  body.createDiv({
    cls: "text-sm text-muted-foreground",
    text: "Uses card.createdAt (set on first sync after upgrade).",
  });
}
