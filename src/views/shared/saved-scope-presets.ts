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

import type { SavedScopePresetRow, SavedScopePresetScope } from "../../platform/core/coach-plan-sqlite";
import type { Scope } from "../reviewer/types";

export type SavedScopePreset = {
  id: string;
  name: string;
  scopes: Scope[];
  createdAt: number;
  updatedAt: number;
};

export function toScopeId(scope: Scope): string {
  return `${scope.type}::${scope.key}`;
}

export function parseScopesJson(scopesJson: string): Scope[] {
  try {
    const parsed = JSON.parse(scopesJson) as SavedScopePresetScope[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const type = String(entry?.type || "").trim();
        const key = String(entry?.key || "");
        const name = String(entry?.name || "");
        if (type !== "vault" && type !== "folder" && type !== "note" && type !== "group" && type !== "tag" && type !== "property") {
          return null;
        }
        return { type, key, name } as Scope;
      })
      .filter((scope): scope is Scope => !!scope);
  } catch {
    return [];
  }
}

export function serializeScopes(scopes: Scope[]): string {
  return JSON.stringify(scopes.map((scope) => ({ type: scope.type, key: scope.key, name: scope.name })));
}

export function normalizeScopeIdSet(scopeIds: Iterable<string>): string[] {
  return Array.from(scopeIds)
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function scopeIdKeyFromIds(scopeIds: Iterable<string>): string {
  return normalizeScopeIdSet(scopeIds).join("||");
}

export function scopeIdKeyFromScopes(scopes: Scope[]): string {
  return scopeIdKeyFromIds(scopes.map(toScopeId));
}

export function rowToSavedScopePreset(row: SavedScopePresetRow): SavedScopePreset {
  return {
    id: String(row.preset_id || ""),
    name: String(row.name || "").trim(),
    scopes: parseScopesJson(row.scopes_json),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

export function selectionMatchesPreset(scopeIds: Iterable<string>, preset: SavedScopePreset): boolean {
  if (!preset.scopes.length) return false;
  return scopeIdKeyFromIds(scopeIds) === scopeIdKeyFromScopes(preset.scopes);
}
