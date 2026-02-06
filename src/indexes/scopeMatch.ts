// src/indexes/scopeMatch.ts
import type { Scope } from "../reviewer/Types";

export function normPath(s: any): string {
  return String(s ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesScope(scope: Scope, rawPath: any): boolean {
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

  return true;
}
