/**
 * @file src/views/reminders/reminder-due-count.ts
 * @summary Module for reminder due count.
 *
 * @exports
 *  - getDueCardsNow
 *  - countDueCardsNow
 */
import { isParentCard } from "../../platform/core/card-utils";
export function getDueCardsNow(store, nowMs = Date.now()) {
    var _a, _b, _c, _d, _e;
    const cards = (_b = (_a = store.getAllCards) === null || _a === void 0 ? void 0 : _a.call(store)) !== null && _b !== void 0 ? _b : [];
    const states = (_d = (_c = store.data) === null || _c === void 0 ? void 0 : _c.states) !== null && _d !== void 0 ? _d : {};
    const dueCards = [];
    for (const card of cards) {
        if (!(card === null || card === void 0 ? void 0 : card.id))
            continue;
        if (isParentCard(card))
            continue;
        const state = states[String(card.id)];
        if (!state || String((_e = state.stage) !== null && _e !== void 0 ? _e : "") === "suspended")
            continue;
        const due = Number(state.due);
        if (!Number.isFinite(due) || due > nowMs)
            continue;
        dueCards.push({ card, due });
    }
    dueCards.sort((a, b) => {
        if (a.due !== b.due)
            return a.due - b.due;
        return String(a.card.id).localeCompare(String(b.card.id));
    });
    return dueCards.map((x) => x.card);
}
export function countDueCardsNow(store, nowMs = Date.now()) {
    return getDueCardsNow(store, nowMs).length;
}
