// src/reviewer/fsrsLog.ts
import { BRAND } from "../core/constants";
import type { Rating } from "./image-occlusion-types";

type RatingOrSkip = Rating | "skip";

function fsrsStateName(s: any): string {
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

function normLower(x: any): string {
  return String(x ?? "").trim().toLowerCase();
}

function safeDueString(ms: any): string {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return "—";
  try {
    return new Date(t).toLocaleString();
  } catch {
    return "—";
  }
}

function numOrDash(x: any, digits = 2): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function intOrDash(x: any): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return String(Math.floor(n));
}

export function logFsrsIfNeeded(args: {
  id: string;
  cardType: string;

  // Rating is still the normal FSRS rating, but we also allow "skip"
  rating: RatingOrSkip;

  // For grade events, these will exist; for skip, they can be omitted.
  metrics?: any;
  nextDue?: number;

  meta?: any;
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

  const mcqBits =
    ct === "mcq"
      ? ` | mcqChoice=${meta?.mcqChoice} | mcqCorrect=${meta?.mcqCorrect} | mcqPass=${meta?.mcqPass}`
      : "";

  const rNow =
    typeof metrics?.retrievabilityNow === "number" ? metrics.retrievabilityNow : null;
  const rTarget =
    typeof metrics?.retrievabilityTarget === "number"
      ? metrics.retrievabilityTarget
      : null;

  const elapsedDays = Number.isFinite(metrics?.elapsedDays) ? Number(metrics.elapsedDays) : 0;
  const sDays = Number.isFinite(metrics?.stabilityDays) ? Number(metrics.stabilityDays) : 0;
  const dVal = Number.isFinite(metrics?.difficulty) ? Number(metrics.difficulty) : 0;

  const stateBefore = metrics?.stateBefore;
  const stateAfter = metrics?.stateAfter;

  const rNowStr = rNow === null ? "—" : rNow.toFixed(4);
  const rTargetStr = rTarget === null ? "—" : rTarget.toFixed(4);

  const stateBits =
    isSkip || (stateBefore === undefined && stateAfter === undefined)
      ? ""
      : stateBefore === stateAfter || stateBefore === undefined
        ? `state=${fsrsStateName(stateAfter)}`
        : `state=${fsrsStateName(stateBefore)}→${fsrsStateName(stateAfter)}`;

  const tBits = isSkip || rNow === null ? "" : ` | t=${elapsedDays}d`;

  const uiBits = (() => {
    const parts: string[] = [];
    if (uiButtons === 2 || uiButtons === 4) parts.push(`ui=${uiButtons}btn`);
    if (uiKey > 0) parts.push(`key=${uiKey}`);
    if (uiSource) parts.push(`src=${uiSource}`);
    if (via) parts.push(`via=${via}`);
    if (auto) parts.push("auto=1");
    if (isSkip) parts.push("skip=1");

    if (Number.isFinite(Number(meta?.done)) && Number.isFinite(Number(meta?.total))) {
      parts.push(`q=${Number(meta.done)}/${Number(meta.total)}`);
    }
    if (typeof meta?.skipMode === "string" && meta.skipMode.trim()) {
      parts.push(`skipMode=${String(meta.skipMode).trim()}`);
    }
    return parts.length ? ` | ${parts.join(" ")}` : "";
  })();

  const prefix = isSkip ? `${BRAND} SKIP:` : `${BRAND} FSRS:`;

  // eslint-disable-next-line no-console
  console.log(
    `${prefix} card ${id} | type=${ct || "unknown"} | rating=${String(args.rating)}${uiBits} | ` +
      `${stateBits}${tBits} | ` +
      `R_now=${rNowStr} | R_target=${rTargetStr} | ` +
      `S=${sDays.toFixed(2)}d | ` +
      `D=${dVal.toFixed(2)} | ` +
      `nextDue=${dueStr}${mcqBits}` +
      (isSkip ? " | note=scheduling_unchanged" : ""),
  );
}

export function logUndoIfNeeded(args: {
  id: string;
  cardType: string;
  ratingUndone: RatingOrSkip | string;
  meta?: any;

  // Whether JSON store state was actually reverted (practice sessions are session-only)
  storeReverted: boolean;

  // Post-grade state before undo (if available)
  fromState: any | null;

  // Restored state after undo (if available)
  toState: any | null;
}) {
  const ct = normLower(args.cardType);
  const id = String(args.id ?? "");
  const rating = String(args.ratingUndone ?? "");

  const from = args.fromState || {};
  const to = args.toState || {};

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

  const mcqBits =
    ct === "mcq"
      ? ` | mcqChoice=${args.meta?.mcqChoice} | mcqCorrect=${args.meta?.mcqCorrect} | mcqPass=${args.meta?.mcqPass}`
      : "";

  // eslint-disable-next-line no-console
  console.log(
    `${BRAND} UNDO: card ${id} | type=${ct || "unknown"} | reverted=1 | undoneRating=${rating} | ${bits}${mcqBits}`,
  );
}
