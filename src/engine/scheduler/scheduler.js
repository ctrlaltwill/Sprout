/**
 * @file src/scheduler/scheduler.ts
 * @summary FSRS spaced-repetition scheduler that wraps ts-fsrs to provide grading, card-state transitions (bury, suspend, unsuspend, reset), and queue-shuffling utilities that prevent sibling cards from appearing back-to-back. Re-exports core scheduling types from src/types/scheduler.ts for convenience.
 *
 * @exports
 *  - CardState                       — re-exported type representing a card's scheduling state
 *  - SchedulerSettings               — re-exported type for FSRS scheduler configuration
 *  - ReviewRating                    — re-exported type for review rating values
 *  - GradeResult                     — re-exported type for the result of a grade operation
 *  - shuffleCardsWithinTimeWindow    — shuffles cards whose due times fall within the same window
 *  - shuffleCardsWithParentAwareness — shuffles cards while keeping siblings separated
 *  - gradeFromRating                 — grades a card with a specific FSRS rating (Again/Hard/Good/Easy)
 *  - gradeFromPassFail               — grades a card with a binary pass/fail result
 *  - buryCard                        — buries a card for 24 hours
 *  - suspendCard                     — suspends a card indefinitely
 *  - unsuspendCard                   — restores a suspended card to its previous state
 *  - resetCardScheduling             — resets a card's scheduling state back to New
 */
import { fsrs, generatorParameters, createEmptyCard, Rating, State, dateDiffInDays, forgetting_curve, } from "ts-fsrs";
import { MS_DAY } from "../../platform/core/constants";
import { log } from "../../platform/core/logger";
// --------------------
// Small utilities
// --------------------
function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}
function daysToMs(d) {
    return d * MS_DAY;
}
// Push suspended cards far into the future as a belt-and-suspenders safety net
// (so they don't accidentally appear in any due-based queues).
const SUSPEND_FAR_DAYS = 36500; // ~100 years
function farFutureMs(now) {
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
 * @param rng Random number generator function (0-1). Defaults to Math.random. Injectable for deterministic testing.
 * @returns Cards grouped and shuffled within time windows
 */
export function shuffleCardsWithinTimeWindow(cards, windowSizeMs = 30 * 60 * 1000, // 30 minutes default
rng = Math.random) {
    if (cards.length <= 1)
        return cards;
    // Sort cards by due time first
    const sortedCards = [...cards].sort((a, b) => a.due - b.due);
    // Group cards into time windows
    const windows = [];
    let currentWindow = [];
    let windowStart = null;
    for (const card of sortedCards) {
        if (windowStart === null) {
            // First card starts the first window
            windowStart = card.due;
            currentWindow = [card];
        }
        else if (card.due - windowStart <= windowSizeMs) {
            // Card is within current window
            currentWindow.push(card);
        }
        else {
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
        if (window.length <= 1)
            return window;
        // Fisher-Yates shuffle with injectable RNG
        const shuffled = [...window];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
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
 *
 * @param cards Array of cards with due times, ids, and optional parentId for child cards
 * @param windowSizeMs Size of the time window in milliseconds (default: 30 minutes)
 * @param rng Random number generator function (0-1). Defaults to Math.random. Injectable for deterministic testing.
 * @returns Cards grouped and shuffled with parent-aware interleaving
 */
export function shuffleCardsWithParentAwareness(cards, windowSizeMs = 30 * 60 * 1000, rng = Math.random) {
    if (cards.length <= 1)
        return cards;
    // First, group by time window
    const sortedCards = [...cards].sort((a, b) => a.due - b.due);
    const windows = [];
    let currentWindow = [];
    let windowStart = null;
    for (const card of sortedCards) {
        if (windowStart === null) {
            windowStart = card.due;
            currentWindow = [card];
        }
        else if (card.due - windowStart <= windowSizeMs) {
            currentWindow.push(card);
        }
        else {
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
        if (window.length <= 1)
            return window;
        // Group cards by parent to identify potential sequences
        const parentGroups = new Map();
        const nonChildCards = [];
        for (const card of window) {
            if (card.parentId) {
                if (!parentGroups.has(card.parentId)) {
                    parentGroups.set(card.parentId, []);
                }
                parentGroups.get(card.parentId).push(card);
            }
            else {
                nonChildCards.push(card);
            }
        }
        // If no child cards or only one parent group, do simple shuffle
        if (parentGroups.size <= 1 && nonChildCards.length === 0) {
            const shuffled = [...window];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        }
        // Interleave children from different parents with non-child cards
        const result = [];
        const allGroups = [
            ...Array.from(parentGroups.values()),
            ...(nonChildCards.length > 0 ? [nonChildCards] : [])
        ];
        // Shuffle each group internally first
        allGroups.forEach(group => {
            for (let i = group.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [group[i], group[j]] = [group[j], group[i]];
            }
        });
        // Interleave groups (round-robin)
        const maxLength = Math.max(...allGroups.map(g => g.length));
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
function minutesToStepUnit(m) {
    const mm = Math.max(1, Math.round(m));
    if (mm % 1440 === 0)
        return `${mm / 1440}d`;
    if (mm % 60 === 0)
        return `${mm / 60}h`;
    return `${mm}m`;
}
function buildFsrsParams(cfg) {
    var _a, _b, _c;
    const learning = ((_a = cfg.learningStepsMinutes) !== null && _a !== void 0 ? _a : []).map(minutesToStepUnit);
    const relearningRaw = Array.isArray(cfg.relearningStepsMinutes)
        ? cfg.relearningStepsMinutes
        : [];
    const relearning = relearningRaw.length > 0
        ? relearningRaw.map(minutesToStepUnit)
        : [(learning.length ? learning[0] : "10m")];
    const requestRetention = clamp(Number(cfg.requestRetention) || 0.9, 0.8, 0.97);
    return generatorParameters({
        request_retention: requestRetention,
        maximum_interval: 36500,
        enable_fuzz: (_b = cfg.enableFuzz) !== null && _b !== void 0 ? _b : true,
        enable_short_term: true,
        learning_steps: learning.length ? learning : ["10m"],
        relearning_steps: relearning,
        ...(((_c = cfg.fsrsWeights) === null || _c === void 0 ? void 0 : _c.length) ? { w: cfg.fsrsWeights } : {}),
    });
}
// --------------------
// Mapping between your CardState and ts-fsrs Card
// --------------------
function inferFsrsState(s) {
    var _a, _b, _c, _d, _e;
    if (s.fsrsState !== undefined)
        return s.fsrsState;
    if (s.stage === "suspended") {
        // Suspended cards without fsrsState lose their scheduling history.
        // Log a warning when there is evidence of prior reviews.
        if (((_a = s.reps) !== null && _a !== void 0 ? _a : 0) > 0 || ((_b = s.lapses) !== null && _b !== void 0 ? _b : 0) > 0) {
            log.warn(`inferFsrsState: suspended card (reps=${s.reps}, lapses=${s.lapses}) fell back to State.New — scheduling history may be lost`);
        }
        return State.New;
    }
    if (s.stage === "new")
        return State.New;
    if (s.stage === "review")
        return State.Review;
    // Infer learning vs relearning based on lapses
    const inferred = ((_c = s.lapses) !== null && _c !== void 0 ? _c : 0) > 0 ? State.Relearning : State.Learning;
    if (((_d = s.reps) !== null && _d !== void 0 ? _d : 0) > 0 || ((_e = s.lapses) !== null && _e !== void 0 ? _e : 0) > 0) {
        log.warn(`inferFsrsState: missing fsrsState for card with history ` +
            `(stage=${s.stage}, reps=${s.reps}, lapses=${s.lapses}), inferred as ${inferred}`);
    }
    return inferred;
}
function toFsrsCard(s, nowMs) {
    var _a;
    const nowDate = new Date(nowMs);
    let state = inferFsrsState(s);
    const dueMs = Number.isFinite(s.due) ? Number(s.due) : nowMs;
    const scheduled_days = state === State.New
        ? 0
        : Number.isFinite(s.scheduledDays)
            ? Math.max(0, Math.floor(Number(s.scheduledDays)))
            : 0;
    // FSRS last_review is authoritative only from lastReviewed.
    let last_review = Number.isFinite(s.lastReviewed) && ((_a = s.lastReviewed) !== null && _a !== void 0 ? _a : 0) > 0
        ? new Date(s.lastReviewed)
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
        log.warn(`toFsrsCard: coercing card to State.New due to missing last_review ` +
            `(state=${state}, reps=${s.reps}, lapses=${s.lapses})`);
        state = State.New;
        last_review = undefined;
    }
    let difficulty = 5;
    if (state === State.New) {
        // ts-fsrs 5.3+ uses {d:0, s:0} as the new-card sentinel.
        difficulty = 0;
    }
    else if (Number.isFinite(s.difficulty)) {
        const original = Number(s.difficulty);
        difficulty = clamp(original, 1, 10);
        if (original !== difficulty) {
            log.warn(`toFsrsCard: clamped difficulty from ${original} to ${difficulty}`);
        }
    }
    const stability = state === State.New
        ? 0
        : Number.isFinite(s.stabilityDays) && Number(s.stabilityDays) > 0
            ? Math.max(0.1, Number(s.stabilityDays))
            : state === State.Review && scheduled_days > 0
                ? Math.max(0.1, scheduled_days)
                : 0.1;
    const elapsed_days = last_review && state !== State.New
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
function fromFsrsCard(prev, card) {
    // Preserve suspended if something ever tries to pass through FSRS unexpectedly.
    if (prev.stage === "suspended") {
        return { ...prev, due: prev.due };
    }
    const stage = card.state === State.New
        ? "new"
        : card.state === State.Review
            ? "review"
            : card.state === State.Relearning
                ? "relearning"
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
function mapRating(r) {
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
function gradeCardFsrs(state, rating, now, settings) {
    var _a, _b, _c, _d;
    const prevDue = state.due;
    if (state.stage === "suspended") {
        const fs = inferFsrsState(state);
        return {
            nextState: state,
            prevDue,
            nextDue: state.due,
            metrics: {
                retrievabilityNow: null,
                retrievabilityTarget: null,
                elapsedDays: 0,
                stabilityDays: Number((_a = state.stabilityDays) !== null && _a !== void 0 ? _a : 0),
                difficulty: Number((_b = state.difficulty) !== null && _b !== void 0 ? _b : 0),
                stateBefore: fs,
                stateAfter: fs,
            },
        };
    }
    const cfg = settings.scheduling;
    const params = buildFsrsParams(cfg);
    const engine = fsrs(params);
    const nowDate = new Date(now);
    const prevCard = toFsrsCard(state, now);
    const elapsedDays = prevCard.last_review && prevCard.state !== State.New
        ? Math.max(0, dateDiffInDays(prevCard.last_review, nowDate))
        : 0;
    const retrievabilityNow = prevCard.last_review && prevCard.state !== State.New && prevCard.stability > 0
        ? forgetting_curve(params.w, elapsedDays, prevCard.stability)
        : null;
    const result = engine.next(prevCard, nowDate, mapRating(rating));
    const next = fromFsrsCard(state, result.card);
    const msToDue = result.card.due.getTime() - nowDate.getTime();
    const daysToDue = Math.max(0, msToDue / MS_DAY);
    const retrievabilityTarget = result.card.stability > 0
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
            stabilityDays: (_c = next.stabilityDays) !== null && _c !== void 0 ? _c : 0,
            difficulty: (_d = next.difficulty) !== null && _d !== void 0 ? _d : 0,
            stateBefore: prevCard.state,
            stateAfter: result.card.state,
        },
    };
}
export function gradeFromRating(state, rating, now, settings) {
    return gradeCardFsrs(state, rating, now, settings);
}
/**
 * Convenience wrapper for binary outcomes. Default is pass->good (2-button).
 * If you ever want pass->easy (4-button-like), call gradeFromPassFail(..., "easy").
 */
export function gradeFromPassFail(state, result, now, settings, passRating = "good") {
    const rating = result === "pass" ? (passRating === "easy" ? "easy" : "good") : "again";
    return gradeCardFsrs(state, rating, now, settings);
}
/**
 * Buries a card for 24 hours.
 * The card will be due exactly 24 h from now, regardless of timezone.
 * Does not alter any scheduling state (interval, stability, difficulty).
 */
export function buryCard(prev, now) {
    var _a;
    const in24h = now + MS_DAY;
    const nextDue = Math.max(Number((_a = prev.due) !== null && _a !== void 0 ? _a : 0), in24h);
    return {
        ...prev,
        due: nextDue,
    };
}
export function suspendCard(prev, now) {
    const priorDue = Number.isFinite(prev.due) ? prev.due : now;
    return {
        ...prev,
        stage: "suspended",
        suspendedDue: priorDue,
        due: farFutureMs(now),
    };
}
export function unsuspendCard(prev, now) {
    if (prev.stage !== "suspended")
        return prev;
    const due = Number.isFinite(prev.suspendedDue) ? prev.suspendedDue : now;
    const fs = prev.fsrsState;
    const stage = fs === State.Review
        ? "review"
        : fs === State.Relearning
            ? "relearning"
            : fs === State.Learning
                ? "learning"
                : "new";
    return {
        ...prev,
        stage,
        due,
        suspendedDue: undefined,
    };
}
/**
 * Resets a card's scheduling state back to New, clearing all review history.
 * This is equivalent to starting the card from scratch.
 */
export function resetCardScheduling(prev, now) {
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
