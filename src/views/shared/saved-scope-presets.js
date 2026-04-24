/**
 * @file src/views/shared/saved-scope-presets.ts
 * @summary Module for saved scope presets.
 *
 * @exports
 *  - SavedScopePreset
 *  - toScopeId
 *  - parseScopesJson
 *  - serializeScopes
 *  - normalizeScopeIdSet
 *  - scopeIdKeyFromIds
 */
export function toScopeId(scope) {
    return `${scope.type}::${scope.key}`;
}
export function parseScopesJson(scopesJson) {
    try {
        const parsed = JSON.parse(scopesJson);
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .map((entry) => {
            const type = String((entry === null || entry === void 0 ? void 0 : entry.type) || "").trim();
            const key = String((entry === null || entry === void 0 ? void 0 : entry.key) || "");
            const name = String((entry === null || entry === void 0 ? void 0 : entry.name) || "");
            if (type !== "vault" && type !== "folder" && type !== "note" && type !== "group" && type !== "tag" && type !== "property") {
                return null;
            }
            return { type, key, name };
        })
            .filter((scope) => !!scope);
    }
    catch (_a) {
        return [];
    }
}
export function serializeScopes(scopes) {
    return JSON.stringify(scopes.map((scope) => ({ type: scope.type, key: scope.key, name: scope.name })));
}
export function normalizeScopeIdSet(scopeIds) {
    return Array.from(scopeIds)
        .map((id) => String(id || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}
export function scopeIdKeyFromIds(scopeIds) {
    return normalizeScopeIdSet(scopeIds).join("||");
}
export function scopeIdKeyFromScopes(scopes) {
    return scopeIdKeyFromIds(scopes.map(toScopeId));
}
export function rowToSavedScopePreset(row) {
    return {
        id: String(row.preset_id || ""),
        name: String(row.name || "").trim(),
        scopes: parseScopesJson(row.scopes_json),
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
    };
}
export function selectionMatchesPreset(scopeIds, preset) {
    if (!preset.scopes.length)
        return false;
    return scopeIdKeyFromIds(scopeIds) === scopeIdKeyFromScopes(preset.scopes);
}
