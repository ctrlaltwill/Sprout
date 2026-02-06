/**
 * @file src/indexes/group-index.ts
 * @summary Maintains a cached index of card groups (decks/tags) with per-group card counts and scheduling-state breakdowns. Provides group-path normalisation, prefix expansion for nested groups, and a singleton GroupIndex class that rebuilds on demand when the store changes.
 *
 * @exports
 *  - normaliseGroupPath   — normalises a raw group path string (trims, collapses slashes, lowercases)
 *  - expandGroupPrefixes  — expands a list of group paths to include all ancestor prefixes
 *  - GroupCounts           — type describing per-state card counts for a group
 *  - GroupIndex            — class that caches group-to-card mappings and count aggregations
 *  - getGroupIndex         — returns the singleton GroupIndex instance, rebuilding if invalidated
 *  - invalidateGroupIndex  — marks the cached GroupIndex as stale so it rebuilds on next access
 */

import type { CardRecord, CardState } from "../core/store";
import type SproutPlugin from "../main";

/** Normalise a group path like " /a//b/ c / " -> "a/b/c" */
export function normaliseGroupPath(raw: string): string | null {
  let t = String(raw ?? "").trim();
  if (!t) return null;

  // Convert backslashes to slashes (helps if pasted from Windows-y paths)
  t = t.replace(/\\/g, "/");

  // Trim outer slashes
  t = t.replace(/^\/+/, "").replace(/\/+$/, "");

  // Collapse repeated slashes
  t = t.replace(/\/{2,}/g, "/");

  // Split/trim segments and drop empties
  const parts = t
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return null;
  return parts.join("/");
}

/** Expand "a/b/c" -> ["a", "a/b", "a/b/c"] */
export function expandGroupPrefixes(path: string): string[] {
  const p = normaliseGroupPath(path);
  if (!p) return [];
  const segs = p.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    out.push(segs.slice(0, i + 1).join("/"));
  }
  return out;
}

function isAvailableNowState(st: CardState | undefined, now: number): boolean {
  if (!st) return false;

  if (st.stage === "suspended") return false;
  if (st.stage === "new") return true;

  if (st.stage === "learning" || st.stage === "relearning" || st.stage === "review") {
    if (typeof st.due !== "number" || !Number.isFinite(st.due)) return true;
    return st.due <= now;
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

    for (const c of cards) {
      const id = String(c?.id ?? "");
      if (!id) continue;

      const groups = Array.isArray(c?.groups) ? c.groups : [];
      for (const gRaw of groups) {
        const g = normaliseGroupPath(gRaw);
        if (!g) continue;

        const prefixes = expandGroupPrefixes(g);
        for (const k of prefixes) {
          let set = this.groupToIds.get(k);
          if (!set) {
            set = new Set<string>();
            this.groupToIds.set(k, set);
          }
          set.add(id);
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
    const g = normaliseGroupPath(group);
    if (!g) return new Set<string>();
    return this.groupToIds.get(g) ?? new Set<string>();
  }

  getCounts(group: string, states: Record<string, CardState>, now: number): GroupCounts {
    const ids = this.getIds(group);
    const total = ids.size;

    let due = 0;
    for (const id of ids) {
      const st = states[id];
      if (isAvailableNowState(st, now)) due += 1;
    }

    return { due, total };
  }

  search(query: string, limit = 80): string[] {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return this.keys.slice(0, limit);

    const out: string[] = [];
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keysLower[i].includes(q)) out.push(this.keys[i]);
      if (out.length >= limit) break;
    }
    return out;
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

export function invalidateGroupIndex(plugin: SproutPlugin) {
  _cache.delete(plugin);
}
