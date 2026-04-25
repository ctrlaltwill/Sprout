import { buildCanonicalGroupCaseMap, normalizeGroupPath, normaliseGroupPath } from "./group-normalization";
/**
 * @file src/indexes/group-index.ts
 * @summary Maintains a cached index of card groups (decks/tags) with per-group card counts and scheduling-state breakdowns. Provides group-path normalisation, prefix expansion for nested groups, and a singleton GroupIndex class that rebuilds on demand when the store changes.
 *
 * @exports
 *  - normalizeGroupPath   — normalizes a raw group path string (trims, collapses slashes)
 *  - normaliseGroupPath   — compatibility alias for normalizeGroupPath
 *  - expandGroupPrefixes  — expands a list of group paths to include all ancestor prefixes
 *  - GroupCounts           — type describing per-state card counts for a group
 *  - GroupIndex            — class that caches group-to-card mappings and count aggregations
 *  - getGroupIndex         — returns the singleton GroupIndex instance, rebuilding if invalidated
 *  - invalidateGroupIndex  — marks the cached GroupIndex as stale so it rebuilds on next access
 */
export { normalizeGroupPath, normaliseGroupPath };
/** Expand "a/b/c" -> ["a", "a/b", "a/b/c"] */
export function expandGroupPrefixes(path) {
    const normalizedPath = normalizeGroupPath(path);
    if (!normalizedPath)
        return [];
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    const prefixes = [];
    for (let i = 0; i < pathSegments.length; i++) {
        prefixes.push(pathSegments.slice(0, i + 1).join("/"));
    }
    return prefixes;
}
function isAvailableNowState(cardState, now) {
    if (!cardState)
        return false;
    if (cardState.stage === "suspended")
        return false;
    if (cardState.stage === "new")
        return true;
    if (cardState.stage === "learning" || cardState.stage === "relearning" || cardState.stage === "review") {
        if (typeof cardState.due !== "number" || !Number.isFinite(cardState.due))
            return true;
        return cardState.due <= now;
    }
    return false;
}
export class GroupIndex {
    constructor() {
        /** Lowercased key → card IDs (used for case-insensitive lookups) */
        this.groupToIds = new Map();
        /** Original-case keys for display */
        this.keys = [];
        this.keysLower = [];
    }
    build(cards) {
        var _a;
        this.groupToIds.clear();
        const observedGroupKeys = [];
        for (const card of cards) {
            const id = String((_a = card === null || card === void 0 ? void 0 : card.id) !== null && _a !== void 0 ? _a : "");
            if (!id)
                continue;
            const groups = Array.isArray(card === null || card === void 0 ? void 0 : card.groups) ? card.groups : [];
            for (const rawGroup of groups) {
                const normalizedGroup = normalizeGroupPath(rawGroup);
                if (!normalizedGroup)
                    continue;
                const prefixes = expandGroupPrefixes(normalizedGroup);
                for (const groupKey of prefixes) {
                    const lowerKey = groupKey.toLowerCase();
                    observedGroupKeys.push(groupKey);
                    let cardIds = this.groupToIds.get(lowerKey);
                    if (!cardIds) {
                        cardIds = new Set();
                        this.groupToIds.set(lowerKey, cardIds);
                    }
                    cardIds.add(id);
                }
            }
        }
        this.keys = Array.from(buildCanonicalGroupCaseMap(observedGroupKeys).values()).sort((a, b) => a.localeCompare(b));
        this.keysLower = this.keys.map((k) => k.toLowerCase());
        return this;
    }
    getAllGroups() {
        return this.keys.slice();
    }
    /** IDs for group subtree. Because we index prefixes, this already includes descendants. */
    getIds(group) {
        var _a;
        const normalizedGroup = normalizeGroupPath(group);
        if (!normalizedGroup)
            return new Set();
        return (_a = this.groupToIds.get(normalizedGroup.toLowerCase())) !== null && _a !== void 0 ? _a : new Set();
    }
    getCounts(group, states, now) {
        const ids = this.getIds(group);
        const total = ids.size;
        let due = 0;
        for (const id of ids) {
            const cardState = states[id];
            if (isAvailableNowState(cardState, now))
                due += 1;
        }
        return { due, total };
    }
    search(query, limit = 80) {
        const normalizedQuery = String(query !== null && query !== void 0 ? query : "").trim().toLowerCase();
        if (!normalizedQuery)
            return this.keys.slice(0, limit);
        const matches = [];
        for (let i = 0; i < this.keys.length; i++) {
            if (this.keysLower[i].includes(normalizedQuery))
                matches.push(this.keys[i]);
            if (matches.length >= limit)
                break;
        }
        return matches;
    }
}
/** Module-level cache keyed by plugin instance — avoids polluting the plugin type. */
const _cache = new WeakMap();
/**
 * Plugin-scoped cached index.
 * Rebuilds when store revision changes (store.ts implements getRevision()).
 */
export function getGroupIndex(plugin) {
    const store = plugin.store;
    const rev = store.getRevision();
    const cached = _cache.get(plugin);
    if (cached && cached.index && cached.rev === rev)
        return cached.index;
    const index = new GroupIndex().build(store.getAllCards());
    _cache.set(plugin, { rev, index });
    return index;
}
export function invalidateGroupIndex(plugin) {
    _cache.delete(plugin);
}
