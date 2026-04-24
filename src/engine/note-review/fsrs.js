/**
 * @file src/engine/note-review/fsrs.ts
 * @summary Module for fsrs.
 *
 * @exports
 *  - defaultFsrsNoteRow
 *  - gradeNoteFsrs
 *  - gradeNoteFsrsPass
 */
import { State } from "ts-fsrs";
import { gradeFromPassFail } from "../scheduler/scheduler";
function coerceFsrsState(value) {
    if (value === State.New || value === State.Learning || value === State.Review || value === State.Relearning) {
        return value;
    }
    return State.New;
}
export function defaultFsrsNoteRow(noteId, now) {
    return {
        note_id: noteId,
        step_index: 0,
        last_review_time: null,
        next_review_time: now,
        weight: 1,
        buried_until: null,
        reps: 0,
        lapses: 0,
        learning_step_index: 0,
        scheduled_days: 0,
        stability_days: null,
        difficulty: null,
        fsrs_state: State.New,
        suspended_due: null,
    };
}
export function gradeNoteFsrs(row, now, config, outcome) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const current = {
        id: row.note_id,
        stage: "suspended",
        due: row.next_review_time,
        reps: Math.max(0, Math.floor(Number((_a = row.reps) !== null && _a !== void 0 ? _a : 0))),
        lapses: Math.max(0, Math.floor(Number((_b = row.lapses) !== null && _b !== void 0 ? _b : 0))),
        learningStepIndex: Math.max(0, Math.floor(Number((_c = row.learning_step_index) !== null && _c !== void 0 ? _c : 0))),
        scheduledDays: Math.max(0, Math.floor(Number((_d = row.scheduled_days) !== null && _d !== void 0 ? _d : 0))),
        fsrsState: coerceFsrsState(row.fsrs_state),
        stabilityDays: row.stability_days == null ? undefined : Number(row.stability_days),
        difficulty: row.difficulty == null ? undefined : Number(row.difficulty),
        lastReviewed: row.last_review_time == null ? undefined : Number(row.last_review_time),
        suspendedDue: row.suspended_due == null ? undefined : Number(row.suspended_due),
    };
    if (current.fsrsState !== State.New && current.stage === "suspended") {
        current.stage =
            current.fsrsState === State.Review
                ? "review"
                : current.fsrsState === State.Relearning
                    ? "relearning"
                    : "learning";
    }
    else {
        current.stage = "new";
    }
    const graded = gradeFromPassFail(current, outcome, now, config, "good").nextState;
    return {
        ...row,
        step_index: Math.max(0, Math.floor(Number((_e = row.step_index) !== null && _e !== void 0 ? _e : 0))),
        last_review_time: (_f = graded.lastReviewed) !== null && _f !== void 0 ? _f : now,
        next_review_time: graded.due,
        reps: graded.reps,
        lapses: graded.lapses,
        learning_step_index: graded.learningStepIndex,
        scheduled_days: graded.scheduledDays,
        stability_days: (_g = graded.stabilityDays) !== null && _g !== void 0 ? _g : null,
        difficulty: (_h = graded.difficulty) !== null && _h !== void 0 ? _h : null,
        fsrs_state: (_j = graded.fsrsState) !== null && _j !== void 0 ? _j : State.New,
        suspended_due: (_k = graded.suspendedDue) !== null && _k !== void 0 ? _k : null,
        buried_until: null,
    };
}
export function gradeNoteFsrsPass(row, now, config) {
    return gradeNoteFsrs(row, now, config, "pass");
}
