/**
 * @file src/indexes/scope-match.ts
 * @summary Path normalisation and scope-matching utilities used to determine whether a vault file path falls within a given review scope (vault-wide, folder, note, or deck).
 *
 * @exports
 *  - normPath     — normalises a vault-relative path (forward slashes, strips leading ./)
 *  - matchesScope — returns true if a raw file path matches the given Scope object
 */

import type { Scope } from "../reviewer/types";

export function normPath(s: string | null | undefined): string {
  return String(s ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesScope(scope: Scope, rawPath: string): boolean {
  const p = normPath(rawPath);

  if (scope.type === "vault") return true;

  if (scope.type === "note") {
    return p === normPath(scope.key);
  }

  if (scope.type === "folder") {
    const folder = normPath(scope.key).replace(/\/+$/, "");
    if (!folder) return true;
    return p.startsWith(folder + "/");
  }

  // group scope is resolved separately; path-based match N/A
  if (scope.type === "group") return false;

  // Unknown scope type — fail closed
  return false;
}
