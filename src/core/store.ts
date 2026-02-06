// src/core/store.ts
// ---------------------------------------------------------------------------
// Persistent data store — wraps all card/state/analytics data and exposes
// mutation methods used by sync, the reviewer, and the widget.
//
// Type definitions have been extracted to src/types/ for reuse across the
// codebase. This file re-exports them so existing imports keep working.
// ---------------------------------------------------------------------------

import type SproutPlugin from "../main";
import { State } from "ts-fsrs";
import { TFile, Notice } from "obsidian";

// ── Re-export shared types (backward-compatible) ────────────────────────────
export type { CardRecord } from "../types/card";
export type { ReviewResult, ReviewLogEntry } from "../types/review";
export type {
  AnalyticsMode,
  AnalyticsReviewEvent,
  AnalyticsSessionEvent,
  AnalyticsEvent,
  AnalyticsData,
} from "../types/analytics";
export type { CardStage, CardState } from "../types/scheduler";
export type { QuarantineEntry, StoreData } from "../types/store";

// ── Local imports of the types we actually use in this file ─────────────────
import type { CardRecord } from "../types/card";
import type { ReviewLogEntry } from "../types/review";
import type {
  AnalyticsReviewEvent,
  AnalyticsSessionEvent,
  AnalyticsEvent,
  AnalyticsData,
} from "../types/analytics";
import type { CardState } from "../types/scheduler";
import type { StoreData } from "../types/store";

const ANALYTICS_VERSION = 1;
const ANALYTICS_MAX_EVENTS = 50_000;

function clampInt(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export function defaultStore(): StoreData {
  return {
    version: 10, // + analytics + createdAt
    cards: {},
    states: {},
    reviewLog: [],
    quarantine: {},
    io: {},

    analytics: {
      version: ANALYTICS_VERSION,
      seq: 0,
      events: [],
    },
  };
}

// --------------------
// JsonStore
// --------------------

export class JsonStore {
  plugin: SproutPlugin;
  data: StoreData;

  // ✅ In-memory mutation revision (NOT persisted). Used for cheap index invalidation.
  private _rev = 0;

  constructor(plugin: SproutPlugin) {
    this.plugin = plugin;
    this.data = defaultStore();
  }

  getRevision(): number {
    return this._rev;
  }

  private bumpRevision() {
    this._rev = (this._rev + 1) >>> 0;
  }

  private _ensureAnalyticsShape(now: number) {
    const anyD: any = this.data as any;

    if (!anyD.analytics || typeof anyD.analytics !== "object") {
      anyD.analytics = { version: ANALYTICS_VERSION, seq: 0, events: [] };
    }

    const a: any = anyD.analytics;

    if (!Number.isFinite(a.version)) a.version = ANALYTICS_VERSION;
    if (!Number.isFinite(a.seq) || a.seq < 0) a.seq = 0;
    if (!Array.isArray(a.events)) a.events = [];

    // Basic hygiene: drop non-objects; keep size bounded.
    a.events = a.events.filter((e: any) => e && typeof e === "object" && typeof e.kind === "string");

    if (a.events.length > ANALYTICS_MAX_EVENTS) {
      a.events = a.events.slice(a.events.length - ANALYTICS_MAX_EVENTS);
    }

    // Conservative: ensure seq at least length-based (doesn't need to match eventId)
    a.seq = Math.max(a.seq, a.events.length);

    // Ensure createdAt exists on cards (best-effort, one-time).
    for (const c of Object.values(this.data.cards || {})) {
      const anyC: any = c as any;
      if (!Number.isFinite(anyC.createdAt) || anyC.createdAt <= 0) {
        const guess = Number(anyC.updatedAt) || Number(anyC.lastSeenAt) || 0;
        if (Number.isFinite(guess) && guess > 0) anyC.createdAt = guess;
        else anyC.createdAt = now; // last resort
      }
    }
  }

  private _nextAnalyticsId(): string {
    const a = (this.data as any).analytics as AnalyticsData;
    a.seq = clampInt(Number(a.seq || 0) + 1, 0, Number.MAX_SAFE_INTEGER);
    return String(a.seq);
  }

  getAnalyticsEvents(): AnalyticsEvent[] {
    const a: any = (this.data as any).analytics;
    return Array.isArray(a?.events) ? (a.events as AnalyticsEvent[]) : [];
  }

  appendAnalyticsReview(args: Omit<AnalyticsReviewEvent, "kind" | "eventId">): AnalyticsReviewEvent {
    const now = Date.now();
    this._ensureAnalyticsShape(now);

    const ev: AnalyticsReviewEvent = {
      kind: "review",
      eventId: this._nextAnalyticsId(),

      at: Number(args.at) || now,

      cardId: String(args.cardId || ""),
      cardType: String(args.cardType || "unknown"),

      result: args.result as any,
      mode: (args.mode === "practice" ? "practice" : "scheduled") as any,

      msToAnswer: Number.isFinite(args.msToAnswer as any) ? Number(args.msToAnswer) : undefined,

      prevDue: Number.isFinite(args.prevDue as any) ? Number(args.prevDue) : undefined,
      nextDue: Number.isFinite(args.nextDue as any) ? Number(args.nextDue) : undefined,

      scope: args.scope ?? undefined,
      meta: args.meta ?? undefined,
    };

    const a: any = (this.data as any).analytics;
    a.events.push(ev);

    if (a.events.length > ANALYTICS_MAX_EVENTS) {
      a.events.splice(0, a.events.length - ANALYTICS_MAX_EVENTS);
    }

    this.bumpRevision();
    return ev;
  }

  appendAnalyticsSession(args: Omit<AnalyticsSessionEvent, "kind" | "eventId">): AnalyticsSessionEvent {
    const now = Date.now();
    this._ensureAnalyticsShape(now);

    const ev: AnalyticsSessionEvent = {
      kind: "session",
      eventId: this._nextAnalyticsId(),
      at: Number(args.at) || now,
      scope: args.scope ?? undefined,
      startedAt: Number.isFinite(args.startedAt as any) ? Number(args.startedAt) : undefined,
      endedAt: Number.isFinite(args.endedAt as any) ? Number(args.endedAt) : undefined,
      durationMs: Number.isFinite(args.durationMs as any) ? Number(args.durationMs) : undefined,
    };
    if (!Number.isFinite(ev.startedAt)) ev.startedAt = ev.at;
    if (Number.isFinite(ev.durationMs) && !Number.isFinite(ev.endedAt) && Number.isFinite(ev.startedAt)) {
      ev.endedAt = Number(ev.startedAt) + Number(ev.durationMs);
    }

    const a: any = (this.data as any).analytics;
    a.events.push(ev);

    if (a.events.length > ANALYTICS_MAX_EVENTS) {
      a.events.splice(0, a.events.length - ANALYTICS_MAX_EVENTS);
    }

    this.bumpRevision();
    return ev;
  }

  truncateAnalyticsEvents(toLength: number) {
    this._ensureAnalyticsShape(Date.now());

    const raw = Number(toLength);
    if (!Number.isFinite(raw)) return;
    const n = Math.max(0, Math.floor(raw));

    const a: any = (this.data as any).analytics;
    if (!Array.isArray(a.events)) a.events = [];
    if (a.events.length > n) a.events.length = n;

    this.bumpRevision();
  }

  load(rootData: any) {
    if (rootData && rootData.store) this.data = rootData.store;
    else this.data = defaultStore();

    // Backwards-compatible defaults
    if (!this.data || typeof this.data !== "object") this.data = defaultStore();
    if (!this.data.cards) this.data.cards = {};
    if (!this.data.states) this.data.states = {};
    if (!this.data.reviewLog) this.data.reviewLog = [];
    if (!this.data.quarantine) this.data.quarantine = {};
    if (!this.data.io || typeof this.data.io !== "object") (this.data as any).io = {};
    if (!Number.isFinite(this.data.version)) this.data.version = 0;

    // Analytics defaults + card createdAt best-effort fill
    this._ensureAnalyticsShape(Date.now());

    // Migration: ensure fsrsState exists, ensure scheduledDays exists, and strip legacy fields.
    for (const s of Object.values(this.data.states)) {
      if (!s || typeof s !== "object") continue;

      const anyS: any = s;

      if (!Number.isFinite(anyS.due)) anyS.due = 0;
      if (!Number.isFinite(anyS.reps)) anyS.reps = 0;
      if (!Number.isFinite(anyS.lapses)) anyS.lapses = 0;
      if (!Number.isFinite(anyS.learningStepIndex)) anyS.learningStepIndex = 0;

      const st = (anyS.stage ?? "new");
      const isValidStage =
        st === "new" ||
        st === "learning" ||
        st === "review" ||
        st === "relearning" ||
        st === "suspended";
      if (!isValidStage) anyS.stage = "new";

      if (anyS.stage === "suspended") {
        if (anyS.fsrsState === undefined) anyS.fsrsState = State.New;
        if (!Number.isFinite(anyS.scheduledDays) || anyS.scheduledDays < 0) anyS.scheduledDays = 0;

        delete anyS.intervalDays;
        delete anyS.ease;
        continue;
      }

      if (anyS.fsrsState === undefined) {
        if (anyS.stage === "new") anyS.fsrsState = State.New;
        else if (anyS.stage === "review") anyS.fsrsState = State.Review;
        else if (anyS.stage === "relearning") anyS.fsrsState = State.Relearning;
        else anyS.fsrsState = (anyS.lapses ?? 0) > 0 ? State.Relearning : State.Learning;
      }

      if (anyS.fsrsState === State.New) {
        anyS.stage = "new";
        anyS.lastReviewed = undefined;
        anyS.stabilityDays = undefined;
        anyS.scheduledDays = 0;
      } else if (anyS.fsrsState === State.Review) {
        anyS.stage = "review";
      } else if (anyS.fsrsState === State.Relearning) {
        anyS.stage = "relearning";
      } else if (anyS.fsrsState === State.Learning) {
        anyS.stage = "learning";
      }

      if (!Number.isFinite(anyS.scheduledDays) || anyS.scheduledDays < 0) {
        const legacyInterval = anyS.intervalDays;
        if (Number.isFinite(legacyInterval) && legacyInterval >= 0) {
          anyS.scheduledDays = Math.max(0, Math.floor(Number(legacyInterval)));
        } else {
          anyS.scheduledDays = 0;
        }
      } else {
        anyS.scheduledDays = Math.max(0, Math.floor(Number(anyS.scheduledDays)));
      }

      delete anyS.intervalDays;
      delete anyS.ease;
    }

    // IO schema hygiene
    const ioAny: any = (this.data as any).io;
    if (ioAny && typeof ioAny === "object") {
      for (const [pid, def] of Object.entries(ioAny)) {
        const d: any = def;
        if (!d || typeof d !== "object") {
          delete ioAny[pid];
          continue;
        }
        if (typeof d.imageRef !== "string") d.imageRef = "";
        if (d.maskMode !== "solo" && d.maskMode !== "all") d.maskMode = "solo";
        if (!Array.isArray(d.rects)) d.rects = [];
        d.rects = d.rects
          .filter((r: any) => r && typeof r === "object")
          .map((r: any) => ({
            rectId: String(r.rectId ?? ""),
            x: Number(r.x) || 0,
            y: Number(r.y) || 0,
            w: Number(r.w) || 0,
            h: Number(r.h) || 0,
            groupKey: String(r.groupKey ?? "1"),
          }))
          .filter((r: any) => !!r.rectId);
      }
    } else {
      (this.data as any).io = {};
    }

    if (this.data.version < 10) this.data.version = 10;

    this.bumpRevision();
  }

  async persist() {
    const root = (await this.plugin.loadData()) || {};
    root.settings = this.plugin.settings;
    root.store = this.data;
    await this.plugin.saveData(root);

    this.bumpRevision();
  }

  getAllCards() {
    const q = this.data.quarantine || {};
    return Object.values(this.data.cards || {}).filter((c) => !q[String(c.id)]);
  }

  getCardsByNote(notePath: string) {
    return this.getAllCards().filter((c) => c.sourceNotePath === notePath);
  }

  getQuarantine() {
    return this.data.quarantine || {};
  }

  isQuarantined(id: string) {
    return !!(this.data.quarantine && this.data.quarantine[String(id)]);
  }

  getState(id: string): CardState | null {
    return this.data.states[id] || null;
  }

  upsertCard(card: CardRecord) {
    this.data.cards[card.id] = card;
    this.bumpRevision();
  }

  upsertState(state: CardState) {
    this.data.states[state.id] = state;
    this.bumpRevision();
  }

  appendReviewLog(entry: ReviewLogEntry) {
    this.data.reviewLog.push(entry);
    this.bumpRevision();
  }

  truncateReviewLog(toLength: number) {
    if (!Array.isArray(this.data.reviewLog)) this.data.reviewLog = [];
    const raw = Number(toLength);
    if (!Number.isFinite(raw)) return;
    const n = Math.max(0, Math.floor(raw));
    if (this.data.reviewLog.length > n) this.data.reviewLog.length = n;
    this.bumpRevision();
  }

  ensureState(id: string, now: number, defaultEase = 2.5): CardState {
    void defaultEase;

    let created = false;

    if (!this.data.states[id]) {
      this.data.states[id] = {
        id,
        stage: "new",
        due: now,
        reps: 0,
        lapses: 0,
        learningStepIndex: 0,
        fsrsState: State.New,
        scheduledDays: 0,
      };
      created = true;
    }

    const s: any = this.data.states[id];

    const legacyInterval = s.intervalDays;

    if (!s.stage || s.stage === "") s.stage = "new";

    if (s.fsrsState === undefined) {
      if (s.stage === "new") s.fsrsState = State.New;
      else if (s.stage === "review") s.fsrsState = State.Review;
      else if (s.stage === "relearning") s.fsrsState = State.Relearning;
      else s.fsrsState = (s.lapses ?? 0) > 0 ? State.Relearning : State.Learning;
    }

    delete s.intervalDays;
    delete s.ease;

    if (s.stage === "new" || s.fsrsState === State.New) {
      s.stage = "new";
      s.fsrsState = State.New;
      s.lastReviewed = undefined;
      s.stabilityDays = undefined;
      s.scheduledDays = 0;
    } else if (s.stage !== "suspended") {
      if (!Number.isFinite(s.scheduledDays) || s.scheduledDays < 0) {
        if (Number.isFinite(legacyInterval) && legacyInterval >= 0) {
          s.scheduledDays = Math.max(0, Math.floor(Number(legacyInterval)));
        } else {
          s.scheduledDays = 0;
        }
      } else {
        s.scheduledDays = Math.max(0, Math.floor(Number(s.scheduledDays)));
      }
    } else {
      if (!Number.isFinite(s.scheduledDays) || s.scheduledDays < 0) s.scheduledDays = 0;
    }

    if (!Number.isFinite(s.due)) s.due = now;
    if (!Number.isFinite(s.reps)) s.reps = 0;
    if (!Number.isFinite(s.lapses)) s.lapses = 0;
    if (!Number.isFinite(s.learningStepIndex)) s.learningStepIndex = 0;

    if (created) this.bumpRevision();
    return s as CardState;
  }

  // Helper: get backup directory (relative to vault root)
  getBackupDir(plugin: SproutPlugin): string {
    return ".sprout-backups";
  }

  // Helper: get backup file path for a timestamp
  getBackupFilePath(plugin: SproutPlugin, ts: number): string {
    const dir = this.getBackupDir(plugin);
    const stamp = new Date(ts).toISOString().replace(/[-:T]/g, "").slice(0, 15);
    return `${dir}/data-${stamp}.json`;
  }

  // Helper: list backup files (sorted newest first)
  listBackups(plugin: SproutPlugin): TFile[] {
    const dir = this.getBackupDir(plugin);
    const folder = plugin.app.vault.getAbstractFileByPath(dir);
    if (!folder || !(folder as any).children) return [];
    return (folder as any).children
      .filter((f: TFile) => f instanceof TFile && f.name.endsWith(".json"))
      .sort((a: TFile, b: TFile) => b.name.localeCompare(a.name));
  }

}


// Helper: load scheduling data from the plugin's persistent store (data.json)
import { log } from "./logger";

export async function loadSchedulingFromDataJson(plugin: SproutPlugin): Promise<Record<string, any> | null> {
  try {
    const root = await plugin.loadData();
    if (root && root.store && root.store.states && typeof root.store.states === "object") {
      return root.store.states;
    }
  } catch (e) { log.swallow("load scheduling from data.json", e); }
  return null;
}

// Helper: restore scheduling data from the latest backup
export async function restoreSchedulingFromBackup(plugin: SproutPlugin): Promise<boolean> {
  // Restore from backup.json in the plugin folder, vault-relative path
  const filePath = `plugins/${plugin.manifest.id}/backup.json`;
  let data: any = {};
  try {
    const raw = await plugin.app.vault.adapter.read(filePath);
    data = JSON.parse(raw);
  } catch (e) { log.swallow("read backup.json", e); }
  if (!data.states || typeof data.states !== "object") return false;
  plugin.store.data.states = data.states;
  await plugin.store.persist();
  new Notice("Sprout: Scheduling restored from backup.");
  return true;
}
