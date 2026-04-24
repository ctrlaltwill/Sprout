/**
 * @file src/indexes/scope-match.ts
 * @summary Path normalisation and scope-matching utilities used to determine whether a vault file path falls within a given review scope (vault-wide, folder, note, or deck).
 *
 * @exports
 *  - normPath     — normalises a vault-relative path (forward slashes, strips leading ./)
 *  - matchesScope — returns true if a raw file path matches the given Scope object
 */
function normalizeScopePath(pathValue) {
    return String(pathValue !== null && pathValue !== void 0 ? pathValue : "").replace(/\\/g, "/").replace(/^\.\//, "");
}
export function normPath(pathValue) {
    return normalizeScopePath(pathValue);
}
export function matchesScope(scope, rawPath) {
    const normalizedPath = normalizeScopePath(rawPath);
    if (scope.type === "vault")
        return true;
    if (scope.type === "note") {
        return normalizedPath === normalizeScopePath(scope.key);
    }
    if (scope.type === "folder") {
        const folder = normalizeScopePath(scope.key).replace(/\/+$/, "");
        if (!folder)
            return true;
        return normalizedPath.startsWith(folder + "/");
    }
    // group scope is resolved separately; path-based match N/A
    if (scope.type === "group")
        return false;
    // Unknown scope type — fail closed
    return false;
}
