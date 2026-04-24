/**
 * @file src/views/settings/config/settings-db-stats.ts
 * @summary Module for settings db stats.
 *
 * @exports
 *  - computeSchedulingStats
 *  - getCurrentDbStatsFromStoreData
 */
import { isParentCard } from "../../../platform/core/card-utils";
export function computeSchedulingStats(states, now) {
    var _a, _b, _c, _d;
    const out = { due: 0, learning: 0, review: 0, mature: 0 };
    if (!states || typeof states !== "object")
        return out;
    for (const st of Object.values(states)) {
        if (!st || typeof st !== "object")
            continue;
        const stage = String((_a = st.stage) !== null && _a !== void 0 ? _a : "");
        if (stage === "learning" || stage === "relearning")
            out.learning += 1;
        if (stage === "review")
            out.review += 1;
        const stability = Number((_b = st.stabilityDays) !== null && _b !== void 0 ? _b : 0);
        if (stage === "review" && Number.isFinite(stability) && stability >= 30)
            out.mature += 1;
        const buriedUntil = Number((_c = st.buriedUntil) !== null && _c !== void 0 ? _c : 0);
        if (Number.isFinite(buriedUntil) && buriedUntil > now)
            continue;
        const due = Number((_d = st.due) !== null && _d !== void 0 ? _d : 0);
        const dueEligibleStage = stage === "learning" || stage === "relearning" || stage === "review";
        if (dueEligibleStage && Number.isFinite(due) && due > 0 && due <= now)
            out.due += 1;
    }
    return out;
}
export function getCurrentDbStatsFromStoreData(data, now = Date.now()) {
    const cardsObj = (data === null || data === void 0 ? void 0 : data.cards) && typeof data.cards === "object" ? data.cards : {};
    const quarantineObj = (data === null || data === void 0 ? void 0 : data.quarantine) && typeof data.quarantine === "object" ? data.quarantine : {};
    const reviewableIds = new Set();
    for (const [id, card] of Object.entries(cardsObj)) {
        if (!id)
            continue;
        if (Object.prototype.hasOwnProperty.call(quarantineObj, id))
            continue;
        if (!card || typeof card !== "object")
            continue;
        if (isParentCard(card))
            continue;
        reviewableIds.add(id);
    }
    const rawStates = (data === null || data === void 0 ? void 0 : data.states) && typeof data.states === "object" ? data.states : {};
    const liveStates = {};
    for (const [id, st] of Object.entries(rawStates)) {
        if (!reviewableIds.has(id))
            continue;
        liveStates[id] = st;
    }
    const cards = reviewableIds.size;
    const states = Object.keys(liveStates).length;
    const sched = computeSchedulingStats(liveStates, now);
    const reviewLog = Array.isArray(data === null || data === void 0 ? void 0 : data.reviewLog) ? data.reviewLog.length : 0;
    const quarantine = Object.keys(quarantineObj).length;
    const io = (data === null || data === void 0 ? void 0 : data.io) && typeof data.io === "object" ? Object.keys(data.io).length : 0;
    return { cards, states, due: sched.due, learning: sched.learning, review: sched.review, mature: sched.mature, reviewLog, quarantine, io };
}
