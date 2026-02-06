// src/indexes/groupIndex.ts
import type { CardRecord, CardState } from "../core/store";

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

function isAvailableNowState(st: any, now: number): boolean {
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
      const id = String((c as any)?.id ?? "");
      if (!id) continue;

      const groups = Array.isArray((c as any)?.groups) ? ((c as any).groups as string[]) : [];
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
      const st: any = (states as any)[id];
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

/**
 * Plugin-scoped cached index.
 * Rebuilds when store revision changes (store.ts implements getRevision()).
 */
export function getGroupIndex(plugin: any): GroupIndex {
  const store = plugin?.store;
  const rev = typeof store?.getRevision === "function" ? Number(store.getRevision()) : 0;

  const cache = plugin?._bcGroupIndexCache as { rev: number; index: GroupIndex } | undefined;
  if (cache && cache.index && cache.rev === rev) return cache.index;

  const index = new GroupIndex().build(store?.getAllCards?.() ? store.getAllCards() : []);
  plugin._bcGroupIndexCache = { rev, index };
  return index;
}

export function invalidateGroupIndex(plugin: any) {
  if (plugin && plugin._bcGroupIndexCache) delete plugin._bcGroupIndexCache;
}
