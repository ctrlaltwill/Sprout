/**
 * @file src/anki/anki-utils.ts
 * @summary Shared utility functions for Anki import/export. Provides bidirectional
 * conversions between Sprout and Anki representations for deck paths, card stages,
 * review ratings, FSRS parameters, due dates, tags, checksums, and ID generation.
 *
 * @exports
 *  - ankiDeckToGroupPath / groupPathToAnkiDeck — deck ↔ group path conversion
 *  - deckToFolderAndFile — deck name → vault folder + .md file path
 *  - generateAnkiId / generateAnkiGuid — Anki-compatible ID generation
 *  - sproutRatingToAnkiEase / ankiEaseToSproutRating — rating mapping
 *  - sproutStageToAnkiTypeQueue / ankiTypeQueueToSproutStage — lifecycle stage mapping
 *  - fsrsDifficultyToAnkiFactor / ankiFactorToFsrsDifficulty — FSRS param conversion
 *  - sproutDueToAnki* / anki*ToSproutDue — due-date conversion
 *  - computeFieldChecksum — Anki csum for duplicate detection
 *  - sproutGroupsToAnkiTags / ankiTagsToSproutGroups — tag format conversion
 */

import type { CardStage, ReviewRating } from "../types/scheduler";
import {
  ANKI_CARD_TYPE_NEW,
  ANKI_CARD_TYPE_LEARNING,
  ANKI_CARD_TYPE_REVIEW,
  ANKI_CARD_TYPE_RELEARNING,
  ANKI_QUEUE_SUSPENDED,
  ANKI_QUEUE_NEW,
  ANKI_QUEUE_LEARNING,
  ANKI_QUEUE_REVIEW,
  ANKI_EASE_AGAIN,
  ANKI_EASE_HARD,
  ANKI_EASE_GOOD,
  ANKI_EASE_EASY,
} from "./anki-constants";

// ── Deck ↔ Group path conversion ──────────────────────────────────────────────

/** Convert Anki deck name to Sprout group path: `"A::B::C"` → `"A/B/C"`. */
export function ankiDeckToGroupPath(deck: string): string {
  return String(deck ?? "")
    .split("::")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

/** Convert Sprout group path to Anki deck name: `"A/B/C"` → `"A::B::C"`. */
export function groupPathToAnkiDeck(group: string): string {
  return String(group ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("::");
}

/**
 * Convert an Anki deck name to a vault folder path and markdown filename.
 *
 * Examples (with root `"Anki Import"`):
 * - `"Medicine::Paediatrics"` → folder `Anki Import/Medicine/Paediatrics`, file `…/Paediatrics.md`
 * - `"Medicine"` → folder `Anki Import/Medicine`, file `…/Medicine.md`
 * - `""` (empty/default) → folder `Anki Import`, file `Anki Import/Cards.md`
 */
export function deckToFolderAndFile(
  deck: string,
  root: string,
): { folder: string; file: string } {
  const r = root.replace(/\/+$/, "");
  const parts = String(deck ?? "")
    .split("::")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { folder: r, file: `${r}/Cards.md` };
  }

  const leafName = parts[parts.length - 1];
  const folderPath = [r, ...parts].join("/");
  return { folder: folderPath, file: `${folderPath}/${leafName}.md` };
}

// ── ID generation ─────────────────────────────────────────────────────────────

let _lastId = 0;

/** Generate a unique Anki-style ID (epoch milliseconds, monotonically increasing). */
export function generateAnkiId(): number {
  const now = Date.now();
  _lastId = now > _lastId ? now : _lastId + 1;
  return _lastId;
}

/** Reset the ID counter (for testing). */
export function _resetIdCounter(): void {
  _lastId = 0;
}

const BASE91_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  "!#$%&()*+,-./:;<=>?@[]^_`{|}~";

/** Generate an Anki-compatible GUID (10-char base91 random string). */
export function generateAnkiGuid(): string {
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += BASE91_CHARS[Math.floor(Math.random() * BASE91_CHARS.length)];
  }
  return result;
}

// ── Rating ↔ Ease conversion ──────────────────────────────────────────────────

/** Convert Sprout ReviewRating to Anki ease integer (1–4). */
export function sproutRatingToAnkiEase(rating: ReviewRating | "pass" | "fail" | "skip"): number {
  switch (rating) {
    case "again":
    case "fail":
      return ANKI_EASE_AGAIN;
    case "hard":
      return ANKI_EASE_HARD;
    case "good":
    case "pass":
    case "skip":
      return ANKI_EASE_GOOD;
    case "easy":
      return ANKI_EASE_EASY;
    default:
      return ANKI_EASE_GOOD;
  }
}

/** Convert Anki ease integer (1–4) to Sprout ReviewRating. */
export function ankiEaseToSproutRating(ease: number): ReviewRating {
  switch (ease) {
    case ANKI_EASE_AGAIN:
      return "again";
    case ANKI_EASE_HARD:
      return "hard";
    case ANKI_EASE_GOOD:
      return "good";
    case ANKI_EASE_EASY:
      return "easy";
    default:
      return "good";
  }
}

// ── Stage ↔ Type/Queue conversion ─────────────────────────────────────────────

/** Convert Sprout CardStage to Anki `cards.type` + `cards.queue`. */
export function sproutStageToAnkiTypeQueue(stage: CardStage): { type: number; queue: number } {
  switch (stage) {
    case "new":
      return { type: ANKI_CARD_TYPE_NEW, queue: ANKI_QUEUE_NEW };
    case "learning":
      return { type: ANKI_CARD_TYPE_LEARNING, queue: ANKI_QUEUE_LEARNING };
    case "review":
      return { type: ANKI_CARD_TYPE_REVIEW, queue: ANKI_QUEUE_REVIEW };
    case "relearning":
      return { type: ANKI_CARD_TYPE_RELEARNING, queue: ANKI_QUEUE_LEARNING };
    case "suspended":
      return { type: ANKI_CARD_TYPE_NEW, queue: ANKI_QUEUE_SUSPENDED };
    default:
      return { type: ANKI_CARD_TYPE_NEW, queue: ANKI_QUEUE_NEW };
  }
}

/** Convert Anki type + queue to Sprout CardStage. */
export function ankiTypeQueueToSproutStage(type: number, queue: number): CardStage {
  if (queue === ANKI_QUEUE_SUSPENDED) return "suspended";
  switch (type) {
    case ANKI_CARD_TYPE_NEW:
      return "new";
    case ANKI_CARD_TYPE_LEARNING:
      return "learning";
    case ANKI_CARD_TYPE_REVIEW:
      return "review";
    case ANKI_CARD_TYPE_RELEARNING:
      return "relearning";
    default:
      return "new";
  }
}

// ── FSRS difficulty ↔ Anki factor ─────────────────────────────────────────────

/**
 * Convert FSRS difficulty (0–10 float) to Anki factor (100–1100 permille).
 * When FSRS is enabled, Anki stores: `factor = round(difficulty × 100 + 100)`.
 */
export function fsrsDifficultyToAnkiFactor(difficulty: number | undefined): number {
  if (difficulty === undefined || !Number.isFinite(difficulty)) return 0;
  return Math.round(difficulty * 100 + 100);
}

/**
 * Convert Anki factor to FSRS difficulty.
 * Reverse of `factor = round(difficulty × 100 + 100)`.
 */
export function ankiFactorToFsrsDifficulty(factor: number): number {
  if (!factor || factor <= 0) return 5.0;
  return (factor - 100) / 100;
}

// ── Due date conversions ──────────────────────────────────────────────────────

/** Sprout due (epoch ms) → Anki review due (days since collection creation). */
export function sproutDueToAnkiReviewDue(dueMs: number, collectionCrtSec: number): number {
  const dueSec = Math.floor(dueMs / 1000);
  return Math.max(0, Math.floor((dueSec - collectionCrtSec) / 86400));
}

/** Sprout due (epoch ms) → Anki learning due (epoch seconds). */
export function sproutDueToAnkiLearningDue(dueMs: number): number {
  return Math.floor(dueMs / 1000);
}

/** Anki review due (days since collection creation) → Sprout due (epoch ms). */
export function ankiReviewDueToSproutDue(ankiDue: number, collectionCrtSec: number): number {
  return (collectionCrtSec + ankiDue * 86400) * 1000;
}

/** Anki learning due (epoch seconds) → Sprout due (epoch ms). */
export function ankiLearningDueToSproutDue(ankiDue: number): number {
  return ankiDue * 1000;
}

// ── Checksum ──────────────────────────────────────────────────────────────────

/**
 * Compute the Anki `csum` (FNV-1a 32-bit hash of the sort field).
 * Used for duplicate detection within Anki.
 */
export function computeFieldChecksum(field: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < field.length; i++) {
    hash ^= field.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ── Tag conversion ────────────────────────────────────────────────────────────

/** Convert Sprout groups to Anki tag string (space-separated, `::` hierarchy). */
export function sproutGroupsToAnkiTags(groups: string[] | null | undefined): string {
  if (!groups || !Array.isArray(groups) || groups.length === 0) return "";
  const tags = groups
    .map((g) => groupPathToAnkiDeck(g).replace(/ /g, "_"))
    .filter(Boolean);
  return tags.length ? ` ${tags.join(" ")} ` : "";
}

/** Convert Anki tag string to Sprout groups. */
export function ankiTagsToSproutGroups(tags: string): string[] {
  return String(tags ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ankiDeckToGroupPath(t.replace(/_/g, " ")));
}
