/**
 * @file src/indexes/group-format.ts
 * @summary Coerces and formats group (deck/tag) values between their raw input representations and normalised string arrays. Handles comma-, semicolon-, and pipe-delimited strings as well as arrays.
 *
 * @exports
 *  - coerceGroups — accepts a raw groups value (string, string[], or unknown) and returns a normalised string array
 *  - formatGroups — formats an array of group paths into a human-readable display string
 *  - fmtGroups    — compatibility alias for formatGroups
 */
import { normaliseGroupPath } from "./group-index";
import { escapeDelimiterRe } from "../../platform/core/delimiter";
/**
 * Accept groups as:
 * - string[] (preferred)
 * - string (comma/delimiter delimited)
 */
export function coerceGroups(raw) {
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw.map((x) => String(x !== null && x !== void 0 ? x : ""));
    if (typeof raw === "string") {
        const delimRe = new RegExp(`[,${escapeDelimiterRe()}]+`, "g");
        return raw
            .split(delimRe)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}
export function normalizeGroups(raw) {
    const normalizedGroups = coerceGroups(raw)
        .map((g) => normaliseGroupPath(g) || null)
        .filter((x) => !!x);
    return Array.from(new Set(normalizedGroups)).sort((a, b) => a.localeCompare(b));
}
export function formatGroups(groups) {
    const normalizedGroups = normalizeGroups(groups);
    if (!normalizedGroups.length)
        return "—";
    return normalizedGroups.join(", ");
}
export function fmtGroups(groups) {
    return formatGroups(groups);
}
