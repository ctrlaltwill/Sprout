// src/reviewer/skip.ts
import { Modal, setIcon } from "obsidian";
import type SproutPlugin from "../main";
import type { Session } from "./ImageOcclusionTypes";
import type { SproutReviewerView } from "./ReviewView";

export function isSkipEnabled(plugin: SproutPlugin): boolean {
  return !!(plugin.settings.reviewer as any)?.enableSkipButton;
}

export function initSkipState(session: Session) {
  const s: any = session as any;
  if (!s.skipCounts || typeof s.skipCounts !== "object") s.skipCounts = {};
}

function computeDefaultSkipDelay(remainingAfterThisCard: number): number {
  // N = max(8, min(20, round(queueRemaining * 0.2)))
  const r = Math.max(0, Number(remainingAfterThisCard) || 0);
  const n = Math.round(r * 0.2);
  return Math.max(8, Math.min(20, n));
}

class ConfirmBuryForTodayModal extends Modal {
  private _onBury: () => void;
  private _onIgnore: () => void;

  constructor(app: any, onBury: () => void, onIgnore: () => void) {
    super(app);
    this._onBury = onBury;
    this._onIgnore = onIgnore;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const head = contentEl.createDiv();
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.justifyContent = "space-between";
    head.style.gap = "10px";
    head.style.marginBottom = "10px";

    head.createEl("h3", { text: "Bury for today?" });

    const xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "clickable-icon";
    xBtn.setAttribute("data-tooltip", "Close");
    xBtn.title = "Close (Esc)";
    setIcon(xBtn, "x");
    xBtn.onclick = () => this.ignore();
    head.appendChild(xBtn);

    const p = contentEl.createEl("p");
    p.setText(
      "You have skipped this card multiple times in this session. Burying will postpone it until tomorrow. Skipping does not change scheduling unless you confirm bury.",
    );

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "12px";

    const ignoreBtn = row.createEl("button", { text: "Ignore" });
    ignoreBtn.onclick = () => this.ignore();

    const buryBtn = row.createEl("button", { text: "Bury for today" });
    buryBtn.style.background = "var(--background-modifier-error)";
    buryBtn.style.color = "var(--text-on-accent)";
    buryBtn.onclick = () => this.bury();

    this.scope.register([], "b", () => {
      this.bury();
      return false;
    });
    this.scope.register([], "i", () => {
      this.ignore();
      return false;
    });
    this.scope.register([], "Escape", () => {
      this.ignore();
      return false;
    });

    contentEl.addEventListener("keydown", (ev) => {
      const k = (ev.key || "").toLowerCase();
      if (k === "b") {
        ev.preventDefault();
        ev.stopPropagation();
        this.bury();
      } else if (k === "i" || k === "escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.ignore();
      }
    });
  }

  private bury() {
    try {
      this.close();
    } finally {
      this._onBury();
    }
  }

  private ignore() {
    try {
      this.close();
    } finally {
      this._onIgnore();
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export async function skipCurrentCard(view: SproutReviewerView) {
  if (view.mode !== "session" || !view.session) return;

  const card = view.currentCard();
  if (!card) return;

  const type = String((card as any).type || "");
  if (type !== "basic" && type !== "cloze" && type !== "cloze-child") return;

  const id = String((card as any).id || "");
  if (!id) return;

  if (view.session.graded[id]) return;

  const remaining = Math.max(0, view.session.queue.length - view.session.index - 1);
  const baseN = computeDefaultSkipDelay(remaining);

  const s: any = view.session as any;
  if (!s.skipCounts || typeof s.skipCounts !== "object") s.skipCounts = {};
  const skipCounts = s.skipCounts as Record<string, number>;

  const nextCount = (Number(skipCounts[id]) || 0) + 1;
  skipCounts[id] = nextCount;

  if (nextCount >= 3) {
    new ConfirmBuryForTodayModal(
      (view as any).app,
      () => {
        void view.buryCurrentCard();
      },
      () => {},
    ).open();
    return;
  }

  const delay = nextCount === 1 ? baseN : Math.min(40, baseN * 2);

  const q = view.session.queue;
  const idx = view.session.index;

  const [removed] = q.splice(idx, 1);
  if (!removed) return;

  const remainingAfterRemoval = Math.max(0, q.length - idx);
  const insertAt =
    remainingAfterRemoval < delay ? q.length : Math.min(q.length, idx + delay);

  q.splice(insertAt, 0, removed);

  view.clearTimer();
  view.clearCountdown();
  // closeMoreMenu is in moreMenu.ts; reviewer.ts already closes before calling skip

  view.showAnswer = false;
  view.render();
}
