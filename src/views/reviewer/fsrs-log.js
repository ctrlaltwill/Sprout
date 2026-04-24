/**
 * @file src/reviewer/fsrs-log.ts
 * @summary Structured logging utilities for FSRS review events and undo operations. Formats and emits detailed log lines covering rating, state transitions, retrievability, stability, difficulty, MCQ metadata, and UI context for debugging and analytics.
 *
 * @exports
 *   - logFsrsIfNeeded — Logs a structured FSRS review or skip event with metrics, state, and UI context
 *   - logUndoIfNeeded — Logs a structured undo event showing the before/after state reversion details
 */
import { log } from "../../platform/core/logger";
function fsrsStateName(s) {
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
function safePrimitiveString(x, fallback = "") {
    if (typeof x === "string")
        return x;
    if (typeof x === "number" || typeof x === "boolean" || typeof x === "bigint")
        return String(x);
    return fallback;
}
function normLower(x) {
    return safePrimitiveString(x).trim().toLowerCase();
}
function safeDueString(ms) {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0)
        return "—";
    try {
        return new Date(t).toLocaleString();
    }
    catch (_a) {
        return "—";
    }
}
function numOrDash(x, digits = 2) {
    const n = Number(x);
    if (!Number.isFinite(n))
        return "—";
    return n.toFixed(digits);
}
function intOrDash(x) {
    const n = Number(x);
    if (!Number.isFinite(n))
        return "—";
    return String(Math.floor(n));
}
function titleCaseWords(s) {
    return s
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}
function formatCardId(id) {
    const raw = String(id || "").trim();
    const clozeChild = raw.match(/^(.*?)::cloze::c(\d+)$/i);
    if (clozeChild) {
        const base = String(clozeChild[1] || "").trim();
        const idx = String(clozeChild[2] || "").trim();
        return base && idx ? `${base}-C${idx}` : raw;
    }
    return raw || "Unknown";
}
function formatCardType(type) {
    const t = normLower(type);
    const map = {
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
function formatRating(rating) {
    const r = normLower(rating);
    if (!r)
        return "Unknown";
    if (r === "skip")
        return "Skip";
    return titleCaseWords(r);
}
function formatUiContext(args) {
    if (args.auto)
        return "Automatic grading";
    if (args.uiButtons === 4)
        return "Four button";
    if (args.uiButtons === 2)
        return "Two button";
    return "Not provided";
}
export function logFsrsIfNeeded(args) {
    var _a, _b, _c, _d;
    const { id, cardType } = args;
    const metrics = args.metrics;
    const nextDue = (_a = args.nextDue) !== null && _a !== void 0 ? _a : 0;
    const meta = (_b = args.meta) !== null && _b !== void 0 ? _b : {};
    // Normalise defensively (prevents missing logs due to case/enum/string drift)
    const ct = normLower(cardType);
    const r = normLower(args.rating);
    const action = normLower(meta === null || meta === void 0 ? void 0 : meta.action);
    const isSkip = r === "skip" || action === "skip" || action.startsWith("skip");
    // Determine UI mode if provided; otherwise infer from rating when possible.
    const uiButtonsRaw = Number((_d = (_c = meta === null || meta === void 0 ? void 0 : meta.uiButtons) !== null && _c !== void 0 ? _c : meta === null || meta === void 0 ? void 0 : meta.gradingButtons) !== null && _d !== void 0 ? _d : NaN);
    const uiButtons = Number.isFinite(uiButtonsRaw) && (uiButtonsRaw === 2 || uiButtonsRaw === 4)
        ? uiButtonsRaw
        : r === "hard" || r === "easy"
            ? 4
            : 0;
    const uiKey = Number.isFinite(Number(meta === null || meta === void 0 ? void 0 : meta.uiKey)) ? Number(meta === null || meta === void 0 ? void 0 : meta.uiKey) : 0;
    const uiSource = typeof (meta === null || meta === void 0 ? void 0 : meta.uiSource) === "string" ? String(meta.uiSource) : "";
    const via = typeof (meta === null || meta === void 0 ? void 0 : meta.via) === "string" ? String(meta.via) : "";
    const auto = !!(meta === null || meta === void 0 ? void 0 : meta.auto);
    // Logging policy:
    // - Always log skips
    // - Always log MCQs (your most complex path).
    // - Always log Again/Good (common baseline).
    // - ALSO log Hard/Easy (required for 4-button accuracy).
    const shouldLog = isSkip || ct === "mcq" || r === "again" || r === "good" || r === "hard" || r === "easy";
    if (!shouldLog)
        return;
    const dueStr = safeDueString(nextDue);
    const mcqChoice = safePrimitiveString(meta === null || meta === void 0 ? void 0 : meta.mcqChoice);
    const mcqCorrect = safePrimitiveString(meta === null || meta === void 0 ? void 0 : meta.mcqCorrect);
    const mcqPass = safePrimitiveString(meta === null || meta === void 0 ? void 0 : meta.mcqPass);
    const rNow = typeof (metrics === null || metrics === void 0 ? void 0 : metrics.retrievabilityNow) === "number" ? metrics.retrievabilityNow : null;
    const rTarget = typeof (metrics === null || metrics === void 0 ? void 0 : metrics.retrievabilityTarget) === "number"
        ? metrics.retrievabilityTarget
        : null;
    const elapsedDays = Number.isFinite(metrics === null || metrics === void 0 ? void 0 : metrics.elapsedDays) ? Number(metrics.elapsedDays) : 0;
    const sDays = Number.isFinite(metrics === null || metrics === void 0 ? void 0 : metrics.stabilityDays) ? Number(metrics.stabilityDays) : 0;
    const dVal = Number.isFinite(metrics === null || metrics === void 0 ? void 0 : metrics.difficulty) ? Number(metrics.difficulty) : 0;
    const stateBefore = metrics === null || metrics === void 0 ? void 0 : metrics.stateBefore;
    const stateAfter = metrics === null || metrics === void 0 ? void 0 : metrics.stateAfter;
    const rNowStr = rNow === null ? "—" : rNow.toFixed(4);
    const rTargetStr = rTarget === null ? "—" : rTarget.toFixed(4);
    const stateBits = isSkip || (stateBefore === undefined && stateAfter === undefined)
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
        done: meta === null || meta === void 0 ? void 0 : meta.done,
        total: meta === null || meta === void 0 ? void 0 : meta.total,
        skipMode: meta === null || meta === void 0 ? void 0 : meta.skipMode,
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
    const concise = `${shortHeading} | ` +
        `Card ${friendlyCardId} | ` +
        `Rating ${friendlyRating} | ` +
        `Next due ${dueStr}`;
    log.info(concise);
    log.debug(lines.join("\n"));
}
export function logUndoIfNeeded(args) {
    var _a, _b, _c, _d, _e;
    const ct = normLower(args.cardType);
    const id = String((_a = args.id) !== null && _a !== void 0 ? _a : "");
    const rating = String((_b = args.ratingUndone) !== null && _b !== void 0 ? _b : "");
    const from = args.fromState || {};
    const to = args.toState || {};
    const fromDue = safeDueString(from === null || from === void 0 ? void 0 : from.due);
    const toDue = safeDueString(to === null || to === void 0 ? void 0 : to.due);
    const fromFsrs = from === null || from === void 0 ? void 0 : from.fsrsState;
    const toFsrs = to === null || to === void 0 ? void 0 : to.fsrsState;
    const bits = args.storeReverted
        ? `fsrs=${fsrsStateName(fromFsrs)}→${fsrsStateName(toFsrs)} | due=${fromDue}→${toDue} | ` +
            `S=${numOrDash(from === null || from === void 0 ? void 0 : from.stabilityDays)}→${numOrDash(to === null || to === void 0 ? void 0 : to.stabilityDays)} | ` +
            `D=${numOrDash(from === null || from === void 0 ? void 0 : from.difficulty)}→${numOrDash(to === null || to === void 0 ? void 0 : to.difficulty)} | ` +
            `scheduledDays=${intOrDash(from === null || from === void 0 ? void 0 : from.scheduledDays)}→${intOrDash(to === null || to === void 0 ? void 0 : to.scheduledDays)}`
        : `note=session_only (practice); scheduling_unchanged`;
    const undoMcqChoice = safePrimitiveString((_c = args.meta) === null || _c === void 0 ? void 0 : _c.mcqChoice);
    const undoMcqCorrect = safePrimitiveString((_d = args.meta) === null || _d === void 0 ? void 0 : _d.mcqCorrect);
    const undoMcqPass = safePrimitiveString((_e = args.meta) === null || _e === void 0 ? void 0 : _e.mcqPass);
    const mcqBits = ct === "mcq"
        ? ` | mcqChoice=${undoMcqChoice} | mcqCorrect=${undoMcqCorrect} | mcqPass=${undoMcqPass}`
        : "";
    log.info(`UNDO: card ${id} | type=${ct || "unknown"} | reverted=1 | undoneRating=${rating} | ${bits}${mcqBits}`);
}
