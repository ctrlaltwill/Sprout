/**
 * @file src/core/store.ts
 * @summary Persistent JSON data store for the Sprout plugin. Wraps all card records, scheduling
 * states, review logs, image-occlusion definitions, and analytics events. Provides mutation
 * methods used by sync, the reviewer, and the widget, along with data migration logic and
 * backup/restore utilities. Re-exports shared type definitions from src/types/ for
 * backward-compatible imports.
 *
 * @exports
 *   - CardRecord (re-exported type) — persistent record for a single flashcard
 *   - ReviewResult (re-exported type) — grading outcome union
 *   - ReviewLogEntry (re-exported type) — single review log entry
 *   - AnalyticsMode (re-exported type) — scheduled vs practice mode
 *   - AnalyticsReviewEvent (re-exported type) — per-card review analytics event
 *   - AnalyticsSessionEvent (re-exported type) — study session analytics event
 *   - AnalyticsEvent (re-exported type) — discriminated union of analytics events
 *   - AnalyticsData (re-exported type) — top-level analytics storage
 *   - CardStage (re-exported type) — card lifecycle stage
 *   - CardState (re-exported type) — mutable scheduling state for a card
 *   - QuarantineEntry (re-exported type) — quarantined card entry
 *   - StoreData (re-exported type) — root persisted data structure
 *   - defaultStore — factory function returning a fresh StoreData object
 *   - JsonStore — class that wraps StoreData with mutation, persistence, and analytics methods
 *   - loadSchedulingFromDataJson — helper to load scheduling states from data.json
 *   - restoreSchedulingFromBackup — helper to restore scheduling from backup.json
 */

import type SproutPlugin from "../main";
import { State } from "ts-fsrs";
import { TFile, TFolder, Notice } from "obsidian";

// ── Re-export shared types (backward-compatible) ────────────────────────────
export type { CardRecord } from "../types/card";
export { normalizeCardOptions } from "../types/card";
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
import { normalizeCardOptions } from "../types/card";
import type { ReviewLogEntry } from "../types/review";
import type {
  AnalyticsReviewEvent,
  AnalyticsSessionEvent,
  AnalyticsEvent,
} from "../types/analytics";
import type { CardState } from "../types/scheduler";
import type { StoreData } from "../types/store";

const ANALYTICS_VERSION = 1;
const ANALYTICS_MAX_EVENTS = 50_000;

function clampInt(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

// ── Persist-safety types & helpers ──────────────────────────────────────────

/** Result of comparing in-memory store against on-disk store before writing. */
export type PersistSafetyResult = {
  /** Whether the write should proceed. */
  allow: boolean;
  /** If true, a safety backup should be created before (or instead of) writing. */
  backupFirst: boolean;
  /** Human-readable explanation (for logging). */
  reason?: string;
};

/** Safely count own keys on an unknown value. */
function countKeys(v: unknown): number {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : 0;
}

/** Count analytics events from a raw (possibly untyped) analytics object. */
function countAnalyticsEvents(analytics: unknown): number {
  if (!analytics || typeof analytics !== "object") return 0;
  const events = (analytics as Record<string, unknown>).events;
  return Array.isArray(events) ? events.length : 0;
}

/**
 * Calculates a weight (total item count) for a store-shaped object.
 * Works on both the typed `StoreData` and a raw `Record<string, unknown>`
 * read from disk.
 */
function storeWeight(d: Record<string, unknown> | StoreData | null | undefined): number {
  if (!d) return 0;
  let w = 0;
  w += countKeys(d.cards);
  w += countKeys(d.states);
  if (Array.isArray(d.reviewLog)) w += d.reviewLog.length;
  w += countKeys(d.quarantine);
  w += countKeys(d.io);
  w += countAnalyticsEvents(d.analytics);
  return w;
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

  /**
   * Tracks whether the last `load()` call actually found persisted store data
   * on disk, or fell back to an empty `defaultStore()`.
   *
   * - `true`  → `data.json` had a `.store` object and we loaded it.
   * - `false` → `data.json` was missing, empty, corrupt, or had no `.store` key;
   *             the in-memory store is a blank default.
   *
   * Used by the persistence layer to avoid overwriting a rich data.json with an
   * empty store during plugin reload / update scenarios.
   */
  loadedFromDisk = false;

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
    if (!this.data.analytics || typeof this.data.analytics !== "object") {
      this.data.analytics = { version: ANALYTICS_VERSION, seq: 0, events: [] };
    }

    const a = this.data.analytics;

    if (!Number.isFinite(a.version)) a.version = ANALYTICS_VERSION;
    if (!Number.isFinite(a.seq) || a.seq < 0) a.seq = 0;
    if (!Array.isArray(a.events)) a.events = [];

    // Basic hygiene: drop non-objects; keep size bounded.
    a.events = a.events.filter((e) => e && typeof e === "object" && typeof e.kind === "string");

    if (a.events.length > ANALYTICS_MAX_EVENTS) {
      a.events = a.events.slice(a.events.length - ANALYTICS_MAX_EVENTS);
    }

    // Conservative: ensure seq at least length-based (doesn't need to match eventId)
    a.seq = Math.max(a.seq, a.events.length);

    // Ensure createdAt exists on cards (best-effort, one-time).
    for (const c of Object.values(this.data.cards || {})) {
      if (!Number.isFinite(c.createdAt) || (c.createdAt ?? 0) <= 0) {
        const guess = Number(c.updatedAt) || Number(c.lastSeenAt) || 0;
        if (Number.isFinite(guess) && guess > 0) c.createdAt = guess;
        else c.createdAt = now; // last resort
      }
    }
  }

  private _nextAnalyticsId(): string {
    const a = this.data.analytics;
    a.seq = clampInt(Number(a.seq || 0) + 1, 0, Number.MAX_SAFE_INTEGER);
    return String(a.seq);
  }

  getAnalyticsEvents(): AnalyticsEvent[] {
    const a = this.data.analytics;
    return Array.isArray(a?.events) ? a.events : [];
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

      result: args.result,
      mode: args.mode === "practice" ? "practice" : "scheduled",

      msToAnswer: Number.isFinite(args.msToAnswer) ? Number(args.msToAnswer) : undefined,

      prevDue: Number.isFinite(args.prevDue) ? Number(args.prevDue) : undefined,
      nextDue: Number.isFinite(args.nextDue) ? Number(args.nextDue) : undefined,

      scope: args.scope ?? undefined,
      meta: args.meta ?? undefined,
    };

    const a = this.data.analytics;
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
      startedAt: Number.isFinite(args.startedAt) ? Number(args.startedAt) : undefined,
      endedAt: Number.isFinite(args.endedAt) ? Number(args.endedAt) : undefined,
      durationMs: Number.isFinite(args.durationMs) ? Number(args.durationMs) : undefined,
    };
    if (!Number.isFinite(ev.startedAt)) ev.startedAt = ev.at;
    if (Number.isFinite(ev.durationMs) && !Number.isFinite(ev.endedAt) && Number.isFinite(ev.startedAt)) {
      ev.endedAt = Number(ev.startedAt) + Number(ev.durationMs);
    }

    const a = this.data.analytics;
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

    const a = this.data.analytics;
    if (!Array.isArray(a.events)) a.events = [];
    if (a.events.length > n) a.events.length = n;

    this.bumpRevision();
  }

  // ── Persist-safety helpers ─────────────────────────────────────────────────

  /**
   * Returns the total number of meaningful data items across cards, states,
   * review log, quarantine, IO definitions, and analytics events.
   * Used as a heuristic to detect whether the store contains real user data
   * vs. being an empty default.
   */
  dataWeight(): number {
    return storeWeight(this.data);
  }

  /**
   * Compares the in-memory store against an on-disk store object and decides
   * whether it's safe to persist.
   *
   * Returns:
   * - `allow: true` — safe to write.
   * - `allow: false` — writing would likely destroy data; caller should abort.
   * - `backupFirst: true` — write is allowed but we'd lose significant data;
   *    caller should create a safety backup before writing.
   */
  assessPersistSafety(diskStore: Record<string, unknown> | null | undefined): PersistSafetyResult {
    const inMem = this.dataWeight();
    const disk = diskStore ? storeWeight(diskStore) : 0;

    // Case 1: in-memory store is empty but disk has data → refuse to write
    if (inMem === 0 && disk > 0) {
      return {
        allow: false,
        backupFirst: true,
        reason:
          `In-memory store is empty (weight=0) but data.json has ${disk} items. ` +
          `Refusing to overwrite to prevent data loss.`,
      };
    }

    // Case 2: large regression — we'd lose >50% of states or analytics events
    if (inMem > 0 && diskStore && typeof diskStore === "object") {
      const diskStates = countKeys(diskStore.states);
      const inMemStates = countKeys(this.data.states);
      const diskEvents = countAnalyticsEvents(diskStore.analytics);
      const inMemEvents = Array.isArray(this.data.analytics?.events)
        ? this.data.analytics.events.length
        : 0;

      const statesDropped = diskStates > 10 && inMemStates < diskStates * 0.5;
      const eventsDropped = diskEvents > 10 && inMemEvents < diskEvents * 0.5;

      if (statesDropped || eventsDropped) {
        return {
          allow: true,
          backupFirst: true,
          reason:
            `Large data regression detected ` +
            `(states: ${diskStates}→${inMemStates}, events: ${diskEvents}→${inMemEvents}).`,
        };
      }
    }

    // Case 3: everything looks fine
    return { allow: true, backupFirst: false };
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  load(rootData: unknown) {
    const rootObj = rootData as Record<string, unknown> | null;
    const storeObj = rootObj?.store;

    if (storeObj && typeof storeObj === "object" && !Array.isArray(storeObj)) {
      this.data = storeObj as typeof this.data;
      this.loadedFromDisk = true;
    } else {
      this.data = defaultStore();
      this.loadedFromDisk = false;
    }

    // Backwards-compatible defaults
    if (!this.data || typeof this.data !== "object") this.data = defaultStore();
    if (!this.data.cards) this.data.cards = {};
    if (!this.data.states) this.data.states = {};
    if (!this.data.reviewLog) this.data.reviewLog = [];
    if (!this.data.quarantine) this.data.quarantine = {};
    if (!this.data.io || typeof this.data.io !== "object") this.data.io = {};
    if (!Number.isFinite(this.data.version)) this.data.version = 0;

    // Analytics defaults + card createdAt best-effort fill
    this._ensureAnalyticsShape(Date.now());

    // Migration: ensure fsrsState exists, ensure scheduledDays exists, and strip legacy fields.
    for (const s of Object.values(this.data.states)) {
      if (!s || typeof s !== "object") continue;

      const anyS = s as Record<string, unknown>;

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
      if (!Number.isFinite(anyS.scheduledDays) || Number(anyS.scheduledDays) < 0) anyS.scheduledDays = 0;

        delete anyS.intervalDays;
        delete anyS.ease;
        continue;
      }

      if (anyS.fsrsState === undefined) {
        if (anyS.stage === "new") anyS.fsrsState = State.New;
        else if (anyS.stage === "review") anyS.fsrsState = State.Review;
        else if (anyS.stage === "relearning") anyS.fsrsState = State.Relearning;
        else anyS.fsrsState = (Number(anyS.lapses) || 0) > 0 ? State.Relearning : State.Learning;
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

      if (!Number.isFinite(anyS.scheduledDays) || Number(anyS.scheduledDays) < 0) {
        const legacyInterval = anyS.intervalDays;
        if (Number.isFinite(legacyInterval) && Number(legacyInterval) >= 0) {
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

    // Card record hygiene: normalize legacy fields into current schema.
    const cardMap = this.data.cards;
    if (cardMap && typeof cardMap === "object") {
      const pickString = (v: unknown): string | null => {
        if (typeof v !== "string") return null;
        const s = v.trim();
        return s ? s : null;
      };

      const pickInfoFromFields = (fields: Record<string, unknown>): string | null =>
        pickString(fields.info) ??
        pickString(fields.information) ??
        pickString(fields.i) ??
        pickString(fields.I);

      for (const [cardKey, rawCard] of Object.entries(cardMap)) {
        if (!rawCard || typeof rawCard !== "object") {
          delete cardMap[cardKey];
          continue;
        }

        const card = rawCard as Record<string, unknown>;
        const cardId = pickString(card.id) ?? pickString(card.anchor) ?? pickString(card.blockId) ?? pickString(cardKey);
        if (cardId) card.id = cardId;

        if (!pickString(card.sourceNotePath)) {
          const legacyPath = pickString(card.location) ?? pickString(card.sourcePath);
          if (legacyPath) card.sourceNotePath = legacyPath;
        }

        if (!pickString(card.groupKey)) {
          const legacyGroup = pickString(card.ioGroupKey) ?? pickString(card.key);
          if (legacyGroup) card.groupKey = legacyGroup;
        }

        // MCQ options migration: coerce any leaked McqOption[] objects → string[]
        if (Array.isArray(card.options)) {
          card.options = normalizeCardOptions(card.options);
        }

        if (!pickString(card.info)) {
          const legacyInfo =
            pickString(card.information) ??
            pickString(card.i) ??
            pickString(card.I) ??
            (card.fields && typeof card.fields === "object"
              ? pickInfoFromFields(card.fields as Record<string, unknown>)
              : null);
          if (legacyInfo) card.info = legacyInfo;
        }
      }
    }

    // IO schema hygiene
    const ioMap = this.data.io;
    if (ioMap && typeof ioMap === "object") {
      for (const [pid, def] of Object.entries(ioMap)) {
        const d = def as Record<string, unknown>;
        if (!d || typeof d !== "object") {
          delete ioMap[pid];
          continue;
        }
        if (typeof d.imageRef !== "string") d.imageRef = "";
        if (d.maskMode !== "solo" && d.maskMode !== "all") d.maskMode = "solo";
        if (!Array.isArray(d.rects)) d.rects = [];
        d.rects = (d.rects as unknown[])
          .filter((r) => r && typeof r === "object")
          .map((r) => {
            const rec = r as Record<string, unknown>;
            const rectIdRaw = rec.rectId;
            const groupKeyRaw = rec.groupKey;
            return {
              rectId:
                typeof rectIdRaw === "string"
                  ? rectIdRaw
                  : typeof rectIdRaw === "number"
                    ? String(rectIdRaw)
                    : "",
              x: Number(rec.x) || 0,
              y: Number(rec.y) || 0,
              w: Number(rec.w) || 0,
              h: Number(rec.h) || 0,
              groupKey:
                typeof groupKeyRaw === "string"
                  ? groupKeyRaw
                  : typeof groupKeyRaw === "number"
                    ? String(groupKeyRaw)
                    : "1",
            };
          })
          .filter((r) => !!r.rectId);
      }
    } else {
      this.data.io = {};
    }

    if (this.data.version < 10) this.data.version = 10;

    this.bumpRevision();
  }

  async persist() {
    // Route through plugin.saveAll() which has a mutex to prevent concurrent read-modify-write races
    await this.plugin.saveAll();
    this.bumpRevision();
  }

  getAllCards() {
    const q = this.data.quarantine || {};
    return Object.values(this.data.cards || {}).filter((c) => !q[String(c.id)]);
  }

  getAllStates() {
    return this.data.states || {};
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

    const s = this.data.states[id] as Record<string, unknown>;

    const legacyInterval = s.intervalDays;

    if (!s.stage || s.stage === "") s.stage = "new";

    if (s.fsrsState === undefined) {
      if (s.stage === "new") s.fsrsState = State.New;
      else if (s.stage === "review") s.fsrsState = State.Review;
      else if (s.stage === "relearning") s.fsrsState = State.Relearning;
      else {
        const lapsesNum = Number(s.lapses);
        s.fsrsState = (Number.isFinite(lapsesNum) ? lapsesNum : 0) > 0 ? State.Relearning : State.Learning;
      }
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
      if (!Number.isFinite(s.scheduledDays) || Number(s.scheduledDays) < 0) {
        if (Number.isFinite(legacyInterval) && Number(legacyInterval) >= 0) {
          s.scheduledDays = Math.max(0, Math.floor(Number(legacyInterval)));
        } else {
          s.scheduledDays = 0;
        }
      } else {
        s.scheduledDays = Math.max(0, Math.floor(Number(s.scheduledDays)));
      }
    } else {
      if (!Number.isFinite(s.scheduledDays) || Number(s.scheduledDays) < 0) s.scheduledDays = 0;
    }

    if (!Number.isFinite(s.due)) s.due = now;
    if (!Number.isFinite(s.reps)) s.reps = 0;
    if (!Number.isFinite(s.lapses)) s.lapses = 0;
    if (!Number.isFinite(s.learningStepIndex)) s.learningStepIndex = 0;

    if (created) this.bumpRevision();
    return s as CardState;
  }

  // Helper: get backup directory (relative to vault root)
  getBackupDir(_plugin: SproutPlugin): string {
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
    if (!(folder instanceof TFolder)) return [];
    return folder.children
      .filter((f): f is TFile => f instanceof TFile && f.name.endsWith(".json"))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

}


// Helper: load scheduling data from the plugin's persistent store (data.json)
import { log } from "./logger";

export async function loadSchedulingFromDataJson(plugin: SproutPlugin): Promise<Record<string, unknown> | null> {
  try {
    const root = (await plugin.loadData()) as unknown;
    if (!root || typeof root !== "object") return null;
    const rootObj = root as Record<string, unknown>;
    const store = rootObj.store;
    if (!store || typeof store !== "object") return null;
    const storeObj = store as Record<string, unknown>;
    const states = storeObj.states;
    if (!states || typeof states !== "object") return null;
    return states as Record<string, unknown>;
  } catch (e) { log.swallow("load scheduling from data.json", e); }
  return null;
}

// Helper: restore scheduling data from the latest backup
export async function restoreSchedulingFromBackup(plugin: SproutPlugin): Promise<boolean> {
  // Restore from backup.json in the plugin folder, vault-relative path
  const filePath = `plugins/${plugin.manifest.id}/backup.json`;
  let data: unknown = {};
  try {
    const raw = await plugin.app.vault.adapter.read(filePath);
    data = JSON.parse(raw);
  } catch (e) { log.swallow("read backup.json", e); }
  const obj = data as Record<string, unknown>;
  if (!obj.states || typeof obj.states !== "object") return false;
  plugin.store.data.states = obj.states as typeof plugin.store.data.states;
  await plugin.store.persist();
  new Notice("Scheduling restored from backup.");
  return true;
}
