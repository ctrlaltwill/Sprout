// src/scheduler/scheduler.ts
// ---------------------------------------------------------------------------
// FSRS spaced-repetition scheduler — wraps ts-fsrs to provide grading,
// card-state transitions (bury / suspend / unsuspend / reset), and
// queue-shuffling utilities that prevent sibling cards appearing back-to-back.
//
// Type definitions (CardState, SchedulerSettings, etc.) live in
// src/types/scheduler.ts; this file re-exports them for convenience.
// ---------------------------------------------------------------------------

// Re-export types so existing `from "./scheduler"` imports still resolve
export type { CardState, SchedulerSettings, ReviewRating, GradeResult } from "../types/scheduler";
import type { CardState } from "../types/scheduler";
import type { SchedulerSettings, GradeResult } from "../types/scheduler";

import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  dateDiffInDays,
  forgetting_curve,
  type Card as FsrsCard,
} from "ts-fsrs";

// --------------------
// Small utilities
// --------------------
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function daysToMs(d: number) {
  return d * 24 * 60 * 60 * 1000;
}

function startOfTomorrowMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Push suspended cards far into the future as a belt-and-suspenders safety net
// (so they don't accidentally appear in any due-based queues).
const SUSPEND_FAR_DAYS = 36500; // ~100 years
function farFutureMs(now: number): number {
  return now + daysToMs(SUSPEND_FAR_DAYS);
}

// --------------------
// New: Card grouping and randomization utilities
// --------------------

/**
 * Groups cards that are due within the same time window to prevent sequential presentation
 * of child cards. Returns a shuffled array within each time bucket.
 * 
 * @param cards Array of cards with due times and optional parentId for child cards
 * @param windowSizeMs Size of the time window in milliseconds (default: 30 minutes)
 * @returns Cards grouped and shuffled within time windows
 */
export function shuffleCardsWithinTimeWindow<T extends { due: number; parentId?: string }>(
  cards: T[],
  windowSizeMs: number = 30 * 60 * 1000 // 30 minutes default
): T[] {
  if (cards.length <= 1) return cards;

  // Sort cards by due time first
  const sortedCards = [...cards].sort((a, b) => a.due - b.due);
  
  // Group cards into time windows
  const windows: T[][] = [];
  let currentWindow: T[] = [];
  let windowStart: number | null = null;

  for (const card of sortedCards) {
    if (windowStart === null) {
      // First card starts the first window
      windowStart = card.due;
      currentWindow = [card];
    } else if (card.due - windowStart <= windowSizeMs) {
      // Card is within current window
      currentWindow.push(card);
    } else {
      // Card starts a new window
      if (currentWindow.length > 0) {
        windows.push(currentWindow);
      }
      windowStart = card.due;
      currentWindow = [card];
    }
  }

  // Add the last window if it has cards
  if (currentWindow.length > 0) {
    windows.push(currentWindow);
  }

  // Shuffle cards within each window
  const shuffledWindows = windows.map(window => {
    if (window.length <= 1) return window;
    
    // Fisher-Yates shuffle
    const shuffled = [...window];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  });

  // Flatten windows back to single array
  return shuffledWindows.flat();
}

/**
 * Enhanced version that specifically targets breaking up sequences of child cards
 * from the same parent while maintaining time-based grouping.
 */
export function shuffleCardsWithParentAwareness<T extends { due: number; parentId?: string; id: string }>(
  cards: T[],
  windowSizeMs: number = 30 * 60 * 1000
): T[] {
  if (cards.length <= 1) return cards;

  // First, group by time window
  const sortedCards = [...cards].sort((a, b) => a.due - b.due);
  const windows: T[][] = [];
  let currentWindow: T[] = [];
  let windowStart: number | null = null;

  for (const card of sortedCards) {
    if (windowStart === null) {
      windowStart = card.due;
      currentWindow = [card];
    } else if (card.due - windowStart <= windowSizeMs) {
      currentWindow.push(card);
    } else {
      if (currentWindow.length > 0) {
        windows.push(currentWindow);
      }
      windowStart = card.due;
      currentWindow = [card];
    }
  }
  
  if (currentWindow.length > 0) {
    windows.push(currentWindow);
  }

  // For each window, shuffle with special attention to parent sequences
  const processedWindows = windows.map(window => {
    if (window.length <= 1) return window;
    
    // Group cards by parent to identify potential sequences
    const parentGroups = new Map<string, T[]>();
    const nonChildCards: T[] = [];
    
    for (const card of window) {
      if (card.parentId) {
        if (!parentGroups.has(card.parentId)) {
          parentGroups.set(card.parentId, []);
        }
        parentGroups.get(card.parentId)!.push(card);
      } else {
        nonChildCards.push(card);
      }
    }
    
    // If no child cards or only one parent group, do simple shuffle
    if (parentGroups.size <= 1 && nonChildCards.length === 0) {
      const shuffled = [...window];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
    
    // Interleave children from different parents with non-child cards
    const result: T[] = [];
    const allGroups = [
      ...Array.from(parentGroups.values()),
      ...(nonChildCards.length > 0 ? [nonChildCards] : [])
    ];
    
    // Shuffle each group internally first
    allGroups.forEach(group => {
      for (let i = group.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [group[i], group[j]] = [group[j], group[i]];
      }
    });
    
    // Interleave groups (round-robin)
    let maxLength = Math.max(...allGroups.map(g => g.length));
    for (let i = 0; i < maxLength; i++) {
      for (const group of allGroups) {
        if (i < group.length) {
          result.push(group[i]);
        }
      }
    }
    
    return result;
  });

  return processedWindows.flat();
}

// --------------------
// FSRS parameter mapping
// --------------------

type FsrsParams = ReturnType<typeof generatorParameters>;

function minutesToStepUnit(m: number): `${number}m` | `${number}h` | `${number}d` {
  const mm = Math.max(1, Math.round(m));
  if (mm % 1440 === 0) return `${mm / 1440}d`;
  if (mm % 60 === 0) return `${mm / 60}h`;
  return `${mm}m`;
}

function buildFsrsParams(cfg: SchedulerSettings): FsrsParams {
  const learning = (cfg.learningStepsMinutes ?? []).map(minutesToStepUnit);

  const relearningRaw = Array.isArray(cfg.relearningStepsMinutes)
    ? cfg.relearningStepsMinutes
    : [];
  const relearning =
    relearningRaw.length > 0
      ? relearningRaw.map(minutesToStepUnit)
      : [(learning.length ? learning[0] : "10m")];

  const requestRetention = clamp(Number(cfg.requestRetention) || 0.9, 0.8, 0.97);

  return generatorParameters({
    request_retention: requestRetention,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: learning.length ? learning : ["10m"],
    relearning_steps: relearning,
  });
}

// --------------------
// Mapping between your CardState and ts-fsrs Card
// --------------------

function inferFsrsState(s: CardState): State {
  if (s.fsrsState !== undefined) return s.fsrsState;

  if ((s as any).stage === "suspended") return State.New;
  if (s.stage === "new") return State.New;
  if (s.stage === "review") return State.Review;

  return (s.lapses ?? 0) > 0 ? State.Relearning : State.Learning;
}

function toFsrsCard(s: CardState, nowMs: number): FsrsCard {
  const nowDate = new Date(nowMs);

  let state = inferFsrsState(s);

  const dueMs = Number.isFinite(s.due) ? Number(s.due) : nowMs;

  const scheduled_days =
    state === State.New
      ? 0
      : Number.isFinite(s.scheduledDays)
        ? Math.max(0, Math.floor(Number(s.scheduledDays)))
        : 0;

  // FSRS last_review is authoritative only from lastReviewed.
  let last_review: Date | undefined =
    Number.isFinite(s.lastReviewed) && (s.lastReviewed ?? 0) > 0
      ? new Date(s.lastReviewed!)
      : undefined;

  // Hardening: never allow last_review in the future.
  if (last_review && last_review.getTime() > nowMs) {
    last_review = undefined;
  }

  // FSRS invariants: New cards should not carry review history.
  if (state === State.New) {
    last_review = undefined;
  }

  // If we can't establish review history, don't pretend we have one.
  if (!last_review && state !== State.New) {
    state = State.New;
    last_review = undefined;
  }

  const difficulty =
    Number.isFinite(s.difficulty) ? clamp(Number(s.difficulty), 1, 10) : 5;

  const stability =
    state === State.New
      ? 0
      : Number.isFinite(s.stabilityDays) && Number(s.stabilityDays) > 0
        ? Math.max(0.1, Number(s.stabilityDays))
        : state === State.Review && scheduled_days > 0
          ? Math.max(0.1, scheduled_days)
          : 0;

  const elapsed_days =
    last_review && state !== State.New
      ? Math.max(0, dateDiffInDays(last_review, nowDate))
      : 0;

  return {
    due: new Date(dueMs),
    stability,
    difficulty,
    elapsed_days,
    scheduled_days,
    reps: Math.max(0, s.reps || 0),
    lapses: Math.max(0, s.lapses || 0),
    learning_steps: Math.max(0, s.learningStepIndex || 0),
    state,
    last_review,
  };
}

function fromFsrsCard(prev: CardState, card: FsrsCard): CardState {
  // Preserve suspended if something ever tries to pass through FSRS unexpectedly.
  if ((prev as any).stage === "suspended") {
    return { ...prev, due: prev.due };
  }

  const stage: CardState["stage"] =
    card.state === State.New
      ? "new"
      : card.state === State.Review
        ? "review"
        : card.state === State.Relearning
          ? ("relearning" as any)
          : "learning";

  const schedDays = Number.isFinite(card.scheduled_days)
    ? Math.max(0, Math.floor(Number(card.scheduled_days)))
    : 0;

  return {
    ...prev,
    stage,
    fsrsState: card.state,

    due: card.due.getTime(),

    scheduledDays: schedDays,

    reps: Math.max(0, card.reps || 0),
    lapses: Math.max(0, card.lapses || 0),
    learningStepIndex: Math.max(0, card.learning_steps || 0),

    stabilityDays: Number.isFinite(card.stability) ? card.stability : prev.stabilityDays,
    difficulty: Number.isFinite(card.difficulty) ? card.difficulty : prev.difficulty,
    lastReviewed: card.last_review ? card.last_review.getTime() : prev.lastReviewed,
  };
}

// --------------------
// Public API
// --------------------

function mapRating(r: ReviewRating): Rating {
  switch (r) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
    default: {
      // Should be unreachable, but keeps runtime safe if any string drift occurs.
      return Rating.Good;
    }
  }
}

function gradeCardFsrs(
  state: CardState,
  rating: ReviewRating,
  now: number,
  settings: { scheduler: SchedulerSettings },
): GradeResult {
  const prevDue = state.due;

  if ((state as any).stage === "suspended") {
    const fs = inferFsrsState(state);
    return {
      nextState: state,
      prevDue,
      nextDue: state.due,
      metrics: {
        retrievabilityNow: null,
        retrievabilityTarget: null,
        elapsedDays: 0,
        stabilityDays: Number(state.stabilityDays ?? 0),
        difficulty: Number(state.difficulty ?? 0),
        stateBefore: fs,
        stateAfter: fs,
      },
    };
  }

  const cfg = settings.scheduler;

  const params = buildFsrsParams(cfg);
  const engine = fsrs(params);

  const nowDate = new Date(now);
  const prevCard = toFsrsCard(state, now);

  const elapsedDays =
    prevCard.last_review && prevCard.state !== State.New
      ? Math.max(0, dateDiffInDays(prevCard.last_review, nowDate))
      : 0;

  const retrievabilityNow =
    prevCard.last_review && prevCard.state !== State.New && prevCard.stability > 0
      ? forgetting_curve(params.w, elapsedDays, prevCard.stability)
      : null;

  const result = engine.next(prevCard, nowDate, mapRating(rating));
  const next = fromFsrsCard(state, result.card);

  const msToDue = result.card.due.getTime() - nowDate.getTime();
  const daysToDue = Math.max(0, msToDue / (24 * 60 * 60 * 1000));

  const retrievabilityTarget =
    result.card.stability > 0
      ? forgetting_curve(params.w, daysToDue, result.card.stability)
      : null;

  return {
    nextState: next,
    prevDue,
    nextDue: next.due,
    metrics: {
      retrievabilityNow,
      retrievabilityTarget,
      elapsedDays,
      stabilityDays: next.stabilityDays ?? 0,
      difficulty: next.difficulty ?? 0,
      stateBefore: prevCard.state,
      stateAfter: result.card.state,
    },
  };
}

export function gradeFromRating(
  state: CardState,
  rating: ReviewRating,
  now: number,
  settings: { scheduler: SchedulerSettings },
) {
  return gradeCardFsrs(state, rating, now, settings);
}

/**
 * Convenience wrapper for binary outcomes. Default is pass->good (2-button).
 * If you ever want pass->easy (4-button-like), call gradeFromPassFail(..., "easy").
 */
export function gradeFromPassFail(
  state: CardState,
  result: "pass" | "fail",
  now: number,
  settings: { scheduler: SchedulerSettings },
  passRating: "good" | "easy" = "good",
) {
  const rating: ReviewRating =
    result === "pass" ? (passRating === "easy" ? "easy" : "good") : "again";
  return gradeCardFsrs(state, rating, now, settings);
}

export function buryCard(prev: CardState, now: number): CardState {
  const tomorrow = startOfTomorrowMs(now);
  const nextDue = Math.max(Number(prev.due ?? 0), tomorrow);

  return {
    ...prev,
    due: nextDue,
  };
}

export function suspendCard(prev: CardState, now: number): CardState {
  const priorDue = Number.isFinite(prev.due) ? prev.due : now;
  return {
    ...prev,
    stage: "suspended" as any,
    suspendedDue: priorDue,
    due: farFutureMs(now),
  };
}

export function unsuspendCard(prev: CardState, now: number): CardState {
  if ((prev as any).stage !== "suspended") return prev;

  const due = Number.isFinite(prev.suspendedDue) ? (prev.suspendedDue as number) : now;

  const fs = prev.fsrsState;
  const stage: CardState["stage"] =
    fs === State.Review
      ? "review"
      : fs === State.Relearning
        ? ("relearning" as any)
        : fs === State.Learning
          ? "learning"
          : "new";

  return {
    ...prev,
    stage: stage as any,
    due,
    suspendedDue: undefined,
  };
}

export function resetCardScheduling(
  prev: CardState,
  now: number,
  settings: { scheduler: SchedulerSettings },
): CardState {
  void settings;

  const empty = createEmptyCard(new Date(now));

  return {
    id: prev.id,
    stage: "new",
    fsrsState: State.New,
    due: empty.due.getTime(),

    reps: 0,
    lapses: 0,
    learningStepIndex: 0,

    scheduledDays: 0,

    stabilityDays: undefined,
    difficulty: undefined,
    lastReviewed: undefined,

    suspendedDue: undefined,
  };
}