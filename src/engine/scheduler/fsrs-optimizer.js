/**
 * @file src/engine/scheduler/fsrs-optimizer.ts
 * @summary Pure-TypeScript FSRS parameter optimizer. Uses ts-fsrs FSRSAlgorithm
 * for the forward pass (computing stability/difficulty at each review step) and
 * numerical gradient descent (Adam) to find personalized weights that minimise
 * binary cross-entropy loss over a user's review history.
 *
 * @exports
 *  - optimizeFsrsWeights — main entry: takes review logs → returns optimised weight vector
 */
import { FSRSAlgorithm, generatorParameters, forgetting_curve, default_w, clipParameters, Rating, } from "ts-fsrs";
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
const MS_PER_DAY = 86400000;
// Adam hyper-parameters
const LEARNING_RATE = 0.02;
const BETA1 = 0.9;
const BETA2 = 0.999;
const EPSILON = 1e-8;
const MAX_EPOCHS = 80;
const GRAD_EPS = 1e-5; // finite-difference step size
// ────────────────────────────────────────────────────────────────────────────
// Pre-processing
// ────────────────────────────────────────────────────────────────────────────
/**
 * Converts flat review-log entries into per-card training items.
 *
 * Filters out skips, groups by card id, sorts chronologically, and computes
 * the delta-days between consecutive reviews.
 */
function preprocessReviewLogs(logs) {
    // Group by card id
    const byCard = new Map();
    for (const entry of logs) {
        // Map result string to numeric rating (skip entries that aren't gradeable)
        const rating = ratingToNumber(entry.result);
        if (rating === 0)
            continue;
        let arr = byCard.get(entry.id);
        if (!arr) {
            arr = [];
            byCard.set(entry.id, arr);
        }
        arr.push(entry);
    }
    const items = [];
    for (const [, entries] of byCard) {
        // Sort chronologically
        entries.sort((a, b) => a.at - b.at);
        // Need at least 2 reviews to form a training pair
        if (entries.length < 2)
            continue;
        const reviews = [];
        for (let i = 0; i < entries.length; i++) {
            const rating = ratingToNumber(entries[i].result);
            if (rating === 0)
                continue;
            const deltaDays = i === 0 ? 0 : Math.max(0, (entries[i].at - entries[i - 1].at) / MS_PER_DAY);
            reviews.push({ rating, deltaDays });
        }
        if (reviews.length >= 2) {
            items.push({ reviews });
        }
    }
    return items;
}
/** Maps a ReviewResult string to FSRS rating number (1-4), or 0 for skip/unmappable. */
function ratingToNumber(result) {
    switch (result) {
        case "again":
        case "fail":
            return Rating.Again; // 1
        case "hard":
            return Rating.Hard; // 2
        case "good":
        case "pass":
            return Rating.Good; // 3
        case "easy":
            return Rating.Easy; // 4
        default:
            return 0;
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Loss computation
// ────────────────────────────────────────────────────────────────────────────
/**
 * Computes binary cross-entropy loss for a candidate weight vector over all
 * training items. Uses ts-fsrs `FSRSAlgorithm` for the forward pass so the
 * model matches the scheduler exactly.
 */
function computeLoss(w, items) {
    const params = generatorParameters({ w });
    const alg = new FSRSAlgorithm(params);
    let totalLoss = 0;
    let n = 0;
    for (const item of items) {
        const firstRating = item.reviews[0].rating;
        let S = alg.init_stability(firstRating);
        let D = alg.init_difficulty(firstRating);
        // Process subsequent reviews (starting from index 1)
        for (let i = 1; i < item.reviews.length; i++) {
            const { rating, deltaDays } = item.reviews[i];
            const t = Math.max(deltaDays, 0.001); // avoid division issues
            // Predicted retrievability
            const R = Math.max(1e-10, Math.min(1 - 1e-10, forgetting_curve(w, t, S)));
            // Binary label: recalled if rating >= 2 (hard/good/easy), forgot if 1 (again)
            const recalled = rating >= 2 ? 1 : 0;
            // Binary cross-entropy
            totalLoss += -(recalled * Math.log(R) + (1 - recalled) * Math.log(1 - R));
            n++;
            // Update memory state for next step
            if (recalled) {
                S = alg.next_recall_stability(D, S, R, rating);
            }
            else {
                S = alg.next_forget_stability(D, S, R);
            }
            D = alg.next_difficulty(D, rating);
            // Clamp to sane ranges
            S = Math.max(0.01, S);
            D = Math.max(1, Math.min(10, D));
        }
    }
    return n > 0 ? totalLoss / n : Infinity;
}
// ────────────────────────────────────────────────────────────────────────────
// Optimisation (Adam with numerical gradients)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Optimises FSRS weights using Adam with finite-difference gradients.
 *
 * @param items - Pre-processed training items
 * @param onProgress - Optional progress callback (0-100)
 * @returns Optimised weight vector and final loss
 */
function runAdam(items, onProgress) {
    const numWeights = default_w.length;
    let w = Array.from(default_w);
    // Adam state
    const m = new Float64Array(numWeights); // first moment
    const v = new Float64Array(numWeights); // second moment
    let bestLoss = Infinity;
    let bestW = w.slice();
    let staleCount = 0;
    for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
        const loss = computeLoss(w, items);
        if (loss < bestLoss) {
            bestLoss = loss;
            bestW = w.slice();
            staleCount = 0;
        }
        else {
            staleCount++;
            if (staleCount > 12)
                break; // early stopping
        }
        // Compute numerical gradient
        const grad = new Float64Array(numWeights);
        for (let i = 0; i < numWeights; i++) {
            const eps = Math.max(GRAD_EPS, Math.abs(w[i]) * GRAD_EPS);
            const wPlus = w.slice();
            wPlus[i] += eps;
            const lPlus = computeLoss(wPlus, items);
            const wMinus = w.slice();
            wMinus[i] -= eps;
            const lMinus = computeLoss(wMinus, items);
            grad[i] = (lPlus - lMinus) / (2 * eps);
        }
        // Adam update
        const t = epoch + 1;
        for (let i = 0; i < numWeights; i++) {
            m[i] = BETA1 * m[i] + (1 - BETA1) * grad[i];
            v[i] = BETA2 * v[i] + (1 - BETA2) * grad[i] * grad[i];
            const mHat = m[i] / (1 - BETA1 ** t);
            const vHat = v[i] / (1 - BETA2 ** t);
            w[i] -= LEARNING_RATE * mHat / (Math.sqrt(vHat) + EPSILON);
        }
        // Clip parameters to valid ranges
        w = clipParameters(w, 1, true);
        onProgress === null || onProgress === void 0 ? void 0 : onProgress(Math.round(((epoch + 1) / MAX_EPOCHS) * 100));
    }
    return { weights: clipParameters(bestW, 1, true), loss: bestLoss };
}
// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────
/**
 * Optimises FSRS parameters from a user's review history.
 *
 * @param reviewLog - The full review log from StoreData
 * @param onProgress - Optional progress callback (0-100)
 * @returns The optimised result, or null if there are no usable reviews
 */
export function optimizeFsrsWeights(reviewLog, onProgress) {
    const items = preprocessReviewLogs(reviewLog);
    // Count total training reviews (excluding first review of each card)
    const reviewCount = items.reduce((sum, item) => sum + item.reviews.length - 1, 0);
    if (reviewCount === 0) {
        return null;
    }
    const { weights, loss } = runAdam(items, onProgress);
    return { weights, loss, reviewCount };
}
