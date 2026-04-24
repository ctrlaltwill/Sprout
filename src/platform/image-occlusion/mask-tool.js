/**
 * @file src/imageocclusion/mask-tool.ts
 * @summary Utility functions for Image Occlusion mask and child-card ID generation. Handles group key normalisation, deterministic child ID construction from parent + group, auto-incrementing group keys for new masks, unique rect ID generation, and mask-mode type guarding.
 *
 * @exports
 *   - normaliseGroupKey — normalises a raw group key string, defaulting to "1"
 *   - stableIoChildId — generates a deterministic child ID from a parent ID and group key
 *   - nextAutoGroupKey — returns the next auto-incremented group key given existing rects
 *   - makeRectId — generates a unique random rect ID
 *   - isMaskMode — type guard checking if a value is a valid IOMaskMode ("solo" | "all")
 */
/**
 * Normalises a group key to a stable string identifier.
 * Trims whitespace; defaults to "1" if empty.
 */
export function normaliseGroupKey(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : "").trim();
    return s || "1";
}
/**
 * Generates a stable, deterministic child ID for an IO parent + group.
 * Format: `{parentId}::io::{groupKey}`
 */
export function stableIoChildId(parentId, groupKey) {
    const pid = String(parentId !== null && parentId !== void 0 ? parentId : "").trim();
    const g = normaliseGroupKey(groupKey);
    return `${pid}::io::${g}`;
}
/**
 * Returns the next auto-incremented group key given existing rects.
 * Used for creating new masks with unique group identifiers.
 */
export function nextAutoGroupKey(rects) {
    if (!Array.isArray(rects) || rects.length === 0)
        return "1";
    const nums = rects
        .map((r) => {
        const k = normaliseGroupKey(r === null || r === void 0 ? void 0 : r.groupKey);
        const n = parseInt(k, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    })
        .filter((n) => n > 0);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return String(max + 1);
}
/**
 * Generates a unique rect ID.
 */
export function makeRectId() {
    return `r-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}
/**
 * Type guard for IOMaskMode.
 */
export function isMaskMode(val) {
    return val === "solo" || val === "all";
}
