/**
 * @file src/views/shared/scope-metadata.ts
 * @summary Module for scope metadata.
 *
 * @exports
 *  - PropertyPair
 *  - ScopedTag
 *  - ScopedProperty
 *  - extractFileTags
 *  - extractFilePropertyPairs
 *  - encodePropertyPair
 */
function titleCaseWords(input) {
    return String(input || "")
        .split(/\s+/g)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
function toNormalizedPrimitive(raw) {
    if (typeof raw === "string")
        return raw;
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint")
        return String(raw);
    return "";
}
function normalizeTagToken(raw) {
    return toNormalizedPrimitive(raw).trim().toLowerCase().replace(/^#+/, "");
}
function normalizePropertyKey(raw) {
    return toNormalizedPrimitive(raw).trim().toLowerCase();
}
function normalizePropertyValue(raw) {
    return toNormalizedPrimitive(raw).trim().toLowerCase();
}
function addTag(tags, raw) {
    const normalized = normalizeTagToken(raw);
    if (normalized)
        tags.add(normalized);
}
export function extractFileTags(app, file) {
    var _a;
    const tags = new Set();
    const cache = app.metadataCache.getFileCache(file);
    for (const tagRef of (_a = cache === null || cache === void 0 ? void 0 : cache.tags) !== null && _a !== void 0 ? _a : []) {
        addTag(tags, tagRef.tag);
    }
    const frontmatter = cache === null || cache === void 0 ? void 0 : cache.frontmatter;
    if (frontmatter && typeof frontmatter === "object") {
        const entries = Object.entries(frontmatter);
        for (const [key, value] of entries) {
            const normalizedKey = String(key || "").trim().toLowerCase();
            if (normalizedKey !== "tag" && normalizedKey !== "tags")
                continue;
            if (typeof value === "string") {
                const split = value.split(/[\s,]+/g).filter(Boolean);
                if (split.length > 1) {
                    for (const token of split)
                        addTag(tags, token);
                }
                else {
                    addTag(tags, value);
                }
            }
            else if (Array.isArray(value)) {
                for (const tag of value)
                    addTag(tags, tag);
            }
        }
    }
    return tags;
}
function pushPropertyPair(out, rawKey, rawValue) {
    const key = normalizePropertyKey(rawKey);
    const value = normalizePropertyValue(rawValue);
    if (!key || !value)
        return;
    out.push({ key, value });
}
export function extractFilePropertyPairs(app, file) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache === null || cache === void 0 ? void 0 : cache.frontmatter;
    if (!frontmatter || typeof frontmatter !== "object")
        return [];
    const out = [];
    const entries = Object.entries(frontmatter);
    for (const [rawKey, rawValue] of entries) {
        const key = normalizePropertyKey(rawKey);
        if (!key || key === "position" || key === "tags")
            continue;
        if (Array.isArray(rawValue)) {
            for (const item of rawValue) {
                if (item == null)
                    continue;
                if (typeof item === "object")
                    continue;
                pushPropertyPair(out, key, item);
            }
            continue;
        }
        if (rawValue == null)
            continue;
        if (typeof rawValue === "object")
            continue;
        pushPropertyPair(out, key, rawValue);
    }
    return out;
}
export function encodePropertyPair(pair) {
    return `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`;
}
export function decodePropertyPair(raw) {
    const source = String(raw || "");
    const eq = source.indexOf("=");
    if (eq <= 0 || eq >= source.length - 1)
        return null;
    const key = normalizePropertyKey(decodeURIComponent(source.slice(0, eq)));
    const value = normalizePropertyValue(decodeURIComponent(source.slice(eq + 1)));
    if (!key || !value)
        return null;
    return { key, value };
}
export function collectVaultTagAndPropertyPairs(app, files) {
    var _a;
    const tagCount = new Map();
    const propMap = new Map();
    for (const file of files) {
        for (const tag of extractFileTags(app, file)) {
            tagCount.set(tag, ((_a = tagCount.get(tag)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
        for (const pair of extractFilePropertyPairs(app, file)) {
            const id = `${pair.key}\u0000${pair.value}`;
            if (!propMap.has(id)) {
                propMap.set(id, {
                    key: pair.key,
                    value: pair.value,
                    displayKey: titleCaseWords(pair.key.replace(/[_-]+/g, " ")),
                    displayValue: titleCaseWords(pair.value.replace(/[_-]+/g, " ")),
                    count: 1,
                });
            }
            else {
                const existing = propMap.get(id);
                if (existing)
                    existing.count += 1;
            }
        }
    }
    const tags = Array.from(tagCount.entries())
        .map(([token, count]) => ({
        token,
        display: titleCaseWords(token.replace(/[_-]+/g, " ")),
        count,
    }))
        .sort((a, b) => a.token.localeCompare(b.token));
    const properties = Array.from(propMap.values()).sort((a, b) => {
        const keyCmp = a.key.localeCompare(b.key);
        if (keyCmp !== 0)
            return keyCmp;
        return a.value.localeCompare(b.value);
    });
    return { tags, properties };
}
