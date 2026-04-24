/**
 * @file src/views/study-assistant/popup/assistant-popup-io.ts
 * @summary Module for assistant popup io.
 *
 * @exports
 *  - toIoPreviewRects
 */
export function toIoPreviewRects(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => item && typeof item === "object")
        .map((item) => item)
        .filter((r) => Number.isFinite(Number(r.x))
        && Number.isFinite(Number(r.y))
        && Number.isFinite(Number(r.w))
        && Number.isFinite(Number(r.h))
        && Number(r.w) > 0
        && Number(r.h) > 0);
}
