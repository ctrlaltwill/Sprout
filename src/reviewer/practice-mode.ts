// src/reviewer/practice.ts
import type SproutPlugin from "../main";
import type { Scope, Session } from "./image-occlusion-types";

function normPath(s: string): string {
  return String(s ?? "").replace(/\\/g, "/");
}

function matchesScope(scope: Scope, sourceNotePath: string): boolean {
  const p = normPath(sourceNotePath);

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

function isSuspended(plugin: SproutPlugin, id: string): boolean {
  const st: any = plugin.store.getState(id);
  return st?.stage === "suspended";
}

function isNotDue(plugin: SproutPlugin, id: string, now: number): boolean {
  const st: any = plugin.store.getState(id);
  const due = Number(st?.due ?? 0);
  // Treat unknown due as "not due" so practice still works for edge cases.
  if (!Number.isFinite(due) || due <= 0) return true;
  return due > now;
}

export function listPracticeCards(
  plugin: SproutPlugin,
  scope: Scope,
  excludeIds?: Set<string>,
): any[] {
  const now = Date.now();
  const all = plugin.store.getAllCards?.() ?? [];
  const out: any[] = [];

  for (const c of all) {
    const id = String((c as any)?.id ?? "");
    if (!id) continue;
    if (excludeIds?.has(id)) continue;

    const type = String((c as any)?.type ?? "").toLowerCase();
    if (type === "cloze" || type === "io" || type === "io-parent") continue;

    const path = String((c as any)?.sourceNotePath ?? "");
    if (!matchesScope(scope, path)) continue;
    if (isSuspended(plugin, id)) continue;

    // Practice = only not-due cards
    if (!isNotDue(plugin, id, now)) continue;

    out.push(c);
  }

  // Closest-to-due first (good default for practice)
  out.sort((a, b) => {
    const da = Number(plugin.store.getState(String(a.id))?.due ?? Infinity);
    const db = Number(plugin.store.getState(String(b.id))?.due ?? Infinity);
    if (da !== db) return da - db;

    const pa = String(a.sourceNotePath ?? "");
    const pb = String(b.sourceNotePath ?? "");
    if (pa !== pb) return pa.localeCompare(pb);

    return String(a.id).localeCompare(String(b.id));
  });

  return out;
}

export function countPracticeCards(
  plugin: SproutPlugin,
  scope: Scope,
  excludeIds?: Set<string>,
): number {
  return listPracticeCards(plugin, scope, excludeIds).length;
}

export function buildPracticeSession(
  plugin: SproutPlugin,
  scope: Scope,
  excludeIds?: Set<string>,
): Session {
  const queue = listPracticeCards(plugin, scope, excludeIds);

  return {
    scope,
    queue,
    index: 0,
    graded: {},
    stats: { total: queue.length, done: 0 },
    practice: true,
  };
}
