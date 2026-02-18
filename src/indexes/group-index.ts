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

import type { CardRecord, CardState } from "../core/store";
import type SproutPlugin from "../main";

/** Normalise a group path like " /a//b/ c / " -> "a/b/c" */
export function normalizeGroupPath(raw: string): string | null {
  let normalizedPath = String(raw ?? "").trim();
  if (!normalizedPath) return null;

  // Convert backslashes to slashes (helps if pasted from Windows-y paths)
  normalizedPath = normalizedPath.replace(/\\/g, "/");

  // Trim outer slashes
  normalizedPath = normalizedPath.replace(/^\/+/, "").replace(/\/+$/, "");

  // Collapse repeated slashes
  normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");

  // Split/trim segments and drop empties
  const segments = normalizedPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) return null;
  return segments.join("/");
}

export function normaliseGroupPath(raw: string): string | null {
  return normalizeGroupPath(raw);
}

/** Expand "a/b/c" -> ["a", "a/b", "a/b/c"] */
export function expandGroupPrefixes(path: string): string[] {
  const normalizedPath = normalizeGroupPath(path);
  if (!normalizedPath) return [];
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  const prefixes: string[] = [];
  for (let i = 0; i < pathSegments.length; i++) {
    prefixes.push(pathSegments.slice(0, i + 1).join("/"));
  }
  return prefixes;
}

function isAvailableNowState(cardState: CardState | undefined, now: number): boolean {
  if (!cardState) return false;

  if (cardState.stage === "suspended") return false;
  if (cardState.stage === "new") return true;

  if (cardState.stage === "learning" || cardState.stage === "relearning" || cardState.stage === "review") {
    if (typeof cardState.due !== "number" || !Number.isFinite(cardState.due)) return true;
    return cardState.due <= now;
  }

  return false;
}

export type GroupCounts = { due: number; total: number };

export class GroupIndex {
  private groupToIds = new Map<string, Set<string>>();
  private keys: string[] = [];
  private keysLower: string[] = [];

  build(cards: CardRecord[]): this {
    this.groupToIds.clear();

    for (const card of cards) {
      const id = String(card?.id ?? "");
      if (!id) continue;

      const groups = Array.isArray(card?.groups) ? card.groups : [];
      for (const rawGroup of groups) {
        const normalizedGroup = normalizeGroupPath(rawGroup);
        if (!normalizedGroup) continue;

        const prefixes = expandGroupPrefixes(normalizedGroup);
        for (const groupKey of prefixes) {
          let cardIds = this.groupToIds.get(groupKey);
          if (!cardIds) {
            cardIds = new Set<string>();
            this.groupToIds.set(groupKey, cardIds);
          }
          cardIds.add(id);
        }
      }
    }

    this.keys = Array.from(this.groupToIds.keys()).sort((a, b) => a.localeCompare(b));
    this.keysLower = this.keys.map((k) => k.toLowerCase());
    return this;
  }

  getAllGroups(): string[] {
    return this.keys.slice();
  }

  /** IDs for group subtree. Because we index prefixes, this already includes descendants. */
  getIds(group: string): Set<string> {
    const normalizedGroup = normalizeGroupPath(group);
    if (!normalizedGroup) return new Set<string>();
    return this.groupToIds.get(normalizedGroup) ?? new Set<string>();
  }

  getCounts(group: string, states: Record<string, CardState>, now: number): GroupCounts {
    const ids = this.getIds(group);
    const total = ids.size;

    let due = 0;
    for (const id of ids) {
      const cardState = states[id];
      if (isAvailableNowState(cardState, now)) due += 1;
    }

    return { due, total };
  }

  search(query: string, limit = 80): string[] {
    const normalizedQuery = String(query ?? "").trim().toLowerCase();
    if (!normalizedQuery) return this.keys.slice(0, limit);

    const matches: string[] = [];
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keysLower[i].includes(normalizedQuery)) matches.push(this.keys[i]);
      if (matches.length >= limit) break;
    }
    return matches;
  }
}

/** Module-level cache keyed by plugin instance — avoids polluting the plugin type. */
const _cache = new WeakMap<SproutPlugin, { rev: number; index: GroupIndex }>();

/**
 * Plugin-scoped cached index.
 * Rebuilds when store revision changes (store.ts implements getRevision()).
 */
export function getGroupIndex(plugin: SproutPlugin): GroupIndex {
  const store = plugin.store;
  const rev = store.getRevision();

  const cached = _cache.get(plugin);
  if (cached && cached.index && cached.rev === rev) return cached.index;

  const index = new GroupIndex().build(store.getAllCards());
  _cache.set(plugin, { rev, index });
  return index;
}

export function invalidateGroupIndex(plugin: SproutPlugin): void {
  _cache.delete(plugin);
}
