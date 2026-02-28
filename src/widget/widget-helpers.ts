/**
 * @file src/widget/widget-helpers.ts
 * @summary Shared types and pure helper functions for the Sprout sidebar widget. Defines the session and undo-frame data shapes, provides IO and cloze card-type detection utilities, filters out non-reviewable parent cards, and includes general string helpers.
 *
 * @exports
 *  - ReviewMeta           — type for freeform metadata attached to a grade or undo frame
 *  - Session              — type representing the widget review-session state
 *  - UndoFrame            — type for a snapshot used by undo-last-grade
 *  - ioChildKeyFromId     — extracts the IO child key from a card ID string
 *  - cardHasIoChildKey    — checks whether a card record has an IO child key
 *  - isIoParentCard       — detects IO parent cards
 *  - isClozeParentCard    — detects cloze parent cards
 *  - isClozeLike          — detects cloze or cloze-child cards
 *  - filterReviewableCards — filters out non-reviewable parent cards from an array
 *  - WidgetViewLike       — interface describing the minimal widget view surface for helper functions
 *  - toTitleCase          — converts a string to Title Case
 */

import type { CardRecord } from "../types/card";
import type { CardState } from "../types/scheduler";
import type { ReviewRating } from "../types/scheduler";
import { isParentCard, ioChildKeyFromId as _ioChildKeyFromId, cardHasIoChildKey as _cardHasIoChildKey, isIoParentCard as _isIoParentCard, isClozeParentCard as _isClozeParentCard } from "../core/card-utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Freeform metadata attached to a grade / undo frame. */
export type ReviewMeta = {
  mcqChoice?: number;
  mcqCorrect?: number;
  practice?: boolean;
  auto?: boolean;
  via?: string;
  action?: string;
  [key: string]: unknown;
};

/** State of a widget study session. */
export type Session = {
  scopeName: string;
  scopeType: "note" | "folder";
  scopeKey: string;
  queue: CardRecord[];
  index: number;
  graded: Record<string, { rating: ReviewRating; at: number; meta: ReviewMeta | null }>;
  stats: { total: number; done: number };
  mode: "scheduled" | "practice";
  mcqOrderMap?: Record<string, number[]>;
};

/** Snapshot saved before grading so the user can undo. */
export type UndoFrame = {
  sessionStamp: number;
  id: string;
  cardType: string;
  rating: ReviewRating;
  at: number;
  meta: ReviewMeta | null;
  sessionIndex: number;
  showAnswer: boolean;
  reviewLogLenBefore: number;
  analyticsLenBefore: number;
  prevState: CardState;
};

/* ------------------------------------------------------------------ */
/*  IO child key helpers (re-exported from core/card-utils)            */
/* ------------------------------------------------------------------ */

export const ioChildKeyFromId = _ioChildKeyFromId;
export const cardHasIoChildKey = _cardHasIoChildKey;

/* ------------------------------------------------------------------ */
/*  Card-type predicates (re-exported from core/card-utils)            */
/* ------------------------------------------------------------------ */

export const isIoParentCard = _isIoParentCard;
export const isClozeParentCard = _isClozeParentCard;

/** Returns `true` if the card's type is `"cloze"` or `"cloze-child"`. */
export function isClozeLike(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "cloze" || t === "cloze-child";
}

/* ------------------------------------------------------------------ */
/*  Filtering                                                          */
/* ------------------------------------------------------------------ */

/**
 * Filters out non-reviewable cards (parents that are represented by
 * their children during review: cloze parents, IO parents).
 */
export function filterReviewableCards(cards: CardRecord[]): CardRecord[] {
  return (cards || []).filter((c) => !isParentCard(c));
}

/* ------------------------------------------------------------------ */
/*  MCQ option order helpers                                          */
/* ------------------------------------------------------------------ */

function ensureMcqOrderMap(session: Session): Record<string, number[]> {
  if (!session.mcqOrderMap || typeof session.mcqOrderMap !== "object") session.mcqOrderMap = {};
  return session.mcqOrderMap;
}

function isPermutation(arr: unknown, n: number): boolean {
  if (!Array.isArray(arr) || arr.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const raw of arr) {
    const x = Number(raw);
    if (!Number.isInteger(x) || x < 0 || x >= n) return false;
    if (seen[x]) return false;
    seen[x] = true;
  }
  return true;
}

function shuffleInPlace(a: number[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
}

export function getWidgetMcqDisplayOrder(
  session: Session | null,
  card: CardRecord,
  enabled: boolean,
): number[] {
  const opts = card?.options || [];
  const n = Array.isArray(opts) ? opts.length : 0;
  const identity = Array.from({ length: n }, (_, i) => i);

  if (!enabled) return identity;
  if (!session) return identity;

  const id = String(card?.id ?? "");
  if (!id) return identity;

  const map = ensureMcqOrderMap(session);
  const existing = map[id];
  if (isPermutation(existing, n)) return existing;

  const next = identity.slice();
  shuffleInPlace(next);

  if (n >= 2) {
    let same = true;
    for (let i = 0; i < n; i++) {
      if (next[i] !== i) {
        same = false;
        break;
      }
    }
    if (same) {
      const tmp = next[0];
      next[0] = next[1];
      next[1] = tmp;
    }
  }

  map[id] = next;
  return next;
}

/* ------------------------------------------------------------------ */
/*  WidgetViewLike — structural interface for widget action modules     */
/* ------------------------------------------------------------------ */

import type { App, TFile } from "obsidian";
import type { JsonStore } from "../core/store";
import type { SproutSettings } from "../types/settings";

/**
 * Minimal structural interface describing what widget action helpers
 * need from the actual `SproutWidgetView`.  Avoids circular imports
 * while eliminating `view: any`.
 */
export interface WidgetViewLike {
  app: App;
  plugin: { store: JsonStore; settings: SproutSettings };
  containerEl: HTMLElement;
  activeFile: TFile | null;

  mode: "summary" | "session";
  session: Session | null;
  showAnswer: boolean;

  /** @internal */ _timer: number | null;
  /** @internal */ _timing: { cardId: string; startedAt: number } | null;
  /** @internal */ _undo: UndoFrame | null;
  /** @internal */ _sessionStamp: number;
  /** @internal */ _moreMenuToggle: (() => void) | null;
  _typedClozeAnswers: Map<number, string>;
  _typedClozeCardId: string;
  _mcqMultiSelected: Set<number>;
  _mcqMultiCardId: string;

  render(): void;
  currentCard(): CardRecord | null;
  backToSummary(): void;
  clearTimer(): void;
  armTimer(): void;

  gradeCurrentRating(rating: ReviewRating, meta: ReviewMeta | null): Promise<void>;
  canUndo(): boolean;
  undoLastGrade(): Promise<void>;
  buryCurrentCard(): Promise<void>;
  suspendCurrentCard(): Promise<void>;
  answerMcq(choiceIdx: number): Promise<void>;
  answerMcqMulti(selectedIndices: number[]): Promise<void>;
  answerOq(userOrder: number[]): Promise<void>;
  nextCard(): Promise<void>;
  openEditModalForCurrentCard(): void;
  openCurrentInStudyView(): Promise<void>;

  renderMarkdownInto(containerEl: HTMLElement, md: string, sourcePath: string): Promise<void>;
  renderImageOcclusionInto(containerEl: HTMLElement, card: CardRecord, sourcePath: string, reveal: boolean): Promise<void>;

  buildSessionForActiveNote(): Session | null;
  startSession(): void;
  startPracticeSession(): void;
}

/* ------------------------------------------------------------------ */
/*  Text helpers                                                       */
/* ------------------------------------------------------------------ */

/** Converts a string to Title Case (capitalises the first letter of each word). */
export function toTitleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
