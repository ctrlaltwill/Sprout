/**
 * @file src/reviewer/fsrs-log.ts
 * @summary Structured logging utilities for FSRS review events and undo operations. Formats and emits detailed log lines covering rating, state transitions, retrievability, stability, difficulty, MCQ metadata, and UI context for debugging and analytics.
 *
 * @exports
 *   - logFsrsIfNeeded — Logs a structured FSRS review or skip event with metrics, state, and UI context
 *   - logUndoIfNeeded — Logs a structured undo event showing the before/after state reversion details
 */

import { log } from "../../platform/core/logger";
import type { Rating } from "./types";
import type { GradeResult, CardState } from "../../platform/types/scheduler";

type ReviewMeta = Record<string, unknown>;

type RatingOrSkip = Rating | "skip";

function fsrsStateName(s: number | undefined): string {
  switch (Number(s)) {
    case 0:
      return "New";
    case 1:
      return "Learning";
    case 2:
      return "Review";
    case 3:
      return "Relearning";
    default:
      return String(s);
  }
}

function safePrimitiveString(x: unknown, fallback = ""): string {
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean" || typeof x === "bigint") return String(x);
  return fallback;
}

function normLower(x: unknown): string {
  return safePrimitiveString(x).trim().toLowerCase();
}

function safeDueString(ms: unknown): string {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return "—";
  try {
    return new Date(t).toLocaleString();
  } catch {
    return "—";
  }
}

function numOrDash(x: unknown, digits = 2): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function intOrDash(x: unknown): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return String(Math.floor(n));
}

function titleCaseWords(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatCardId(id: string): string {
  const raw = String(id || "").trim();
  const clozeChild = raw.match(/^(.*?)::cloze::c(\d+)$/i);
  if (clozeChild) {
    const base = String(clozeChild[1] || "").trim();
    const idx = String(clozeChild[2] || "").trim();
    return base && idx ? `${base}-C${idx}` : raw;
  }
  return raw || "Unknown";
}

function formatCardType(type: string): string {
  const t = normLower(type);
  const map: Record<string, string> = {
    basic: "Basic",
    reversed: "Reversed",
    "reversed-child": "Reversed child",
    cloze: "Cloze",
    "cloze-child": "Cloze child",
    mcq: "Multiple choice",
    oq: "Ordered question",
    io: "Image occlusion",
    "io-child": "Image occlusion child",
  };
  return map[t] || titleCaseWords(t || "unknown");
}

function formatRating(rating: string): string {
  const r = normLower(rating);
  if (!r) return "Unknown";
  if (r === "skip") return "Skip";
  return titleCaseWords(r);
}

function formatUiContext(args: {
  uiButtons: number;
  uiKey: number;
  uiSource: string;
  via: string;
  auto: boolean;
  isSkip: boolean;
  done: unknown;
  total: unknown;
  skipMode: unknown;
}): string {
  if (args.auto) return "Automatic grading";
  if (args.uiButtons === 4) return "Four button";
  if (args.uiButtons === 2) return "Two button";
  return "Not provided";
}

export function logFsrsIfNeeded(args: {
  id: string;
  cardType: string;

  // Rating is still the normal FSRS rating, but we also allow "skip"
  rating: RatingOrSkip;

  // For grade events, these will exist; for skip, they can be omitted.
  metrics?: GradeResult["metrics"];
  nextDue?: number;

  meta?: ReviewMeta;
}) {
  const { id, cardType } = args;
  const metrics = args.metrics;
  const nextDue = args.nextDue ?? 0;
  const meta = args.meta ?? {};

  // Normalise defensively (prevents missing logs due to case/enum/string drift)
  const ct = normLower(cardType);
  const r = normLower(args.rating);

  const action = normLower(meta?.action);
  const isSkip = r === "skip" || action === "skip" || action.startsWith("skip");

  // Determine UI mode if provided; otherwise infer from rating when possible.
  const uiButtonsRaw = Number(meta?.uiButtons ?? meta?.gradingButtons ?? NaN);
  const uiButtons =
    Number.isFinite(uiButtonsRaw) && (uiButtonsRaw === 2 || uiButtonsRaw === 4)
      ? uiButtonsRaw
      : r === "hard" || r === "easy"
        ? 4
        : 0;

  const uiKey = Number.isFinite(Number(meta?.uiKey)) ? Number(meta?.uiKey) : 0;
  const uiSource = typeof meta?.uiSource === "string" ? String(meta.uiSource) : "";
  const via = typeof meta?.via === "string" ? String(meta.via) : "";
  const auto = !!meta?.auto;

  // Logging policy:
  // - Always log skips
  // - Always log MCQs (your most complex path).
  // - Always log Again/Good (common baseline).
  // - ALSO log Hard/Easy (required for 4-button accuracy).
  const shouldLog =
    isSkip || ct === "mcq" || r === "again" || r === "good" || r === "hard" || r === "easy";

  if (!shouldLog) return;

  const dueStr = safeDueString(nextDue);

  const mcqChoice = safePrimitiveString(meta?.mcqChoice);
  const mcqCorrect = safePrimitiveString(meta?.mcqCorrect);
  const mcqPass = safePrimitiveString(meta?.mcqPass);
  const rNow =
    typeof metrics?.retrievabilityNow === "number" ? metrics.retrievabilityNow : null;
  const rTarget =
    typeof metrics?.retrievabilityTarget === "number"
      ? metrics.retrievabilityTarget
      : null;

  const elapsedDays = Number.isFinite(metrics?.elapsedDays) ? Number(metrics!.elapsedDays) : 0;
  const sDays = Number.isFinite(metrics?.stabilityDays) ? Number(metrics!.stabilityDays) : 0;
  const dVal = Number.isFinite(metrics?.difficulty) ? Number(metrics!.difficulty) : 0;

  const stateBefore = metrics?.stateBefore;
  const stateAfter = metrics?.stateAfter;

  const rNowStr = rNow === null ? "—" : rNow.toFixed(4);
  const rTargetStr = rTarget === null ? "—" : rTarget.toFixed(4);

  const stateBits =
    isSkip || (stateBefore === undefined && stateAfter === undefined)
      ? ""
      : stateBefore === stateAfter || stateBefore === undefined
        ? fsrsStateName(stateAfter)
        : `${fsrsStateName(stateBefore)}→${fsrsStateName(stateAfter)}`;

  const elapsedBit = isSkip || rNow === null ? "—" : `${elapsedDays}d`;
  const uiContext = formatUiContext({
    uiButtons,
    uiKey,
    uiSource,
    via,
    auto,
    isSkip,
    done: meta?.done,
    total: meta?.total,
    skipMode: meta?.skipMode,
  });

  const heading = isSkip ? "SKIP Review" : "FSRS Review";
  const shortHeading = isSkip ? "SKIP" : "FSRS";
  const stateLabel = stateBits || "Unknown";
  const friendlyCardId = formatCardId(id);
  const friendlyCardType = formatCardType(ct || "unknown");
  const friendlyRating = formatRating(safePrimitiveString(args.rating, ""));
  const lines = [
    `- ${heading}`,
    `Card: ${friendlyCardId}`,
    `Type: ${friendlyCardType}`,
    `Rating: ${friendlyRating}`,
    `State: ${stateLabel}`,
    `Elapsed: ${elapsedBit}`,
    `Retrievability: now ${rNowStr}, target ${rTargetStr}`,
    `Stability: ${sDays.toFixed(2)}d`,
    `Difficulty: ${dVal.toFixed(2)}`,
    `Next due: ${dueStr}`,
    `UI: ${uiContext}`,
  ];

  if (ct === "mcq") {
    lines.push(`MCQ: choice=${mcqChoice}, correct=${mcqCorrect}, pass=${mcqPass}`);
  }
  if (isSkip) {
    lines.push("Note: scheduling unchanged");
  }

  const concise =
    `${shortHeading} | ` +
    `Card ${friendlyCardId} | ` +
    `Rating ${friendlyRating} | ` +
    `Next due ${dueStr}`;

  log.info(concise);
  log.debug(lines.join("\n"));
}

export function logUndoIfNeeded(args: {
  id: string;
  cardType: string;
  ratingUndone: RatingOrSkip | null;
  meta?: ReviewMeta;

  // Whether JSON store state was actually reverted (practice sessions are session-only)
  storeReverted: boolean;

  // Post-grade state before undo (if available)
  fromState: CardState | null;

  // Restored state after undo (if available)
  toState: CardState | null;
}) {
  const ct = normLower(args.cardType);
  const id = String(args.id ?? "");
  const rating = String(args.ratingUndone ?? "");

  const from: Partial<CardState> = args.fromState || {};
  const to: Partial<CardState> = args.toState || {};

  const fromDue = safeDueString(from?.due);
  const toDue = safeDueString(to?.due);

  const fromFsrs = from?.fsrsState;
  const toFsrs = to?.fsrsState;

  const bits = args.storeReverted
    ? `fsrs=${fsrsStateName(fromFsrs)}→${fsrsStateName(toFsrs)} | due=${fromDue}→${toDue} | ` +
      `S=${numOrDash(from?.stabilityDays)}→${numOrDash(to?.stabilityDays)} | ` +
      `D=${numOrDash(from?.difficulty)}→${numOrDash(to?.difficulty)} | ` +
      `scheduledDays=${intOrDash(from?.scheduledDays)}→${intOrDash(to?.scheduledDays)}`
    : `note=session_only (practice); scheduling_unchanged`;

  const undoMcqChoice = safePrimitiveString(args.meta?.mcqChoice);
  const undoMcqCorrect = safePrimitiveString(args.meta?.mcqCorrect);
  const undoMcqPass = safePrimitiveString(args.meta?.mcqPass);
  const mcqBits =
    ct === "mcq"
      ? ` | mcqChoice=${undoMcqChoice} | mcqCorrect=${undoMcqCorrect} | mcqPass=${undoMcqPass}`
      : "";

  log.info(
    `UNDO: card ${id} | type=${ct || "unknown"} | reverted=1 | undoneRating=${rating} | ${bits}${mcqBits}`,
  );
}
