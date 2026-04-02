/**
 * @file src/platform/core/targeted-card-persist.ts
 * @summary Module for targeted card persist.
 *
 * @exports
 *  - persistEditedCardAndSiblings
 */

import type LearnKitPlugin from "../../main";
import type { CardRecord } from "./store";
import { normaliseGroupKey, stableIoChildId } from "../image-occlusion/mask-tool";

type PersistEditedCardOptions = {
  persist?: boolean;
};

function hasState(plugin: LearnKitPlugin, id: string): boolean {
  return !!plugin.store.data.states?.[id];
}

function ensureStateIfMissing(plugin: LearnKitPlugin, id: string, now: number): void {
  if (!hasState(plugin, id)) plugin.store.ensureState(id, now, 2.5);
}

function deleteChildrenByType(plugin: LearnKitPlugin, parentId: string, childType: string): void {
  for (const id of Object.keys(plugin.store.data.cards || {})) {
    const rec = plugin.store.data.cards[id];
    if (!rec) continue;
    if (String(rec.type) !== childType) continue;
    if (String(rec.parentId || "") !== parentId) continue;
    delete plugin.store.data.cards[id];
    if (plugin.store.data.states) delete plugin.store.data.states[id];
  }
}

function collectChildrenByType(plugin: LearnKitPlugin, parentId: string, childType: string): CardRecord[] {
  const out: CardRecord[] = [];
  for (const rec of Object.values(plugin.store.data.cards || {})) {
    if (!rec) continue;
    if (String(rec.type) !== childType) continue;
    if (String(rec.parentId || "") !== parentId) continue;
    out.push(rec);
  }
  return out;
}

function extractClozeIndices(text: string): number[] {
  const re = /\{\{c(\d+)::/gi;
  const out = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function stableClozeChildId(parentId: string, idx: number): string {
  return `${parentId}::cloze::c${idx}`;
}

function stableReversedChildId(parentId: string, dir: "forward" | "back"): string {
  return `${parentId}::reversed::${dir}`;
}

function resolveChildCreatedAt(prev: CardRecord | undefined, parent: CardRecord, now: number): number {
  if (prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0) return Number(prev.createdAt);
  if (Number.isFinite(parent.createdAt) && Number(parent.createdAt) > 0) return Number(parent.createdAt);
  return now;
}

function syncClozeChildren(plugin: LearnKitPlugin, parent: CardRecord, now: number): void {
  const parentId = String(parent.id || "");
  if (!parentId) return;

  const indices = extractClozeIndices(String(parent.clozeText || ""));
  const keep = new Set<string>();
  const existing = collectChildrenByType(plugin, parentId, "cloze-child");
  const titleBase = String(parent.title || "").trim();

  for (const idx of indices) {
    const childId = stableClozeChildId(parentId, idx);
    keep.add(childId);

    const prev = plugin.store.data.cards?.[childId];
    const rec: CardRecord = {
      id: childId,
      type: "cloze-child",
      title: titleBase ? `${titleBase} • c${idx}` : null,
      parentId,
      clozeIndex: idx,
      clozeText: parent.clozeText ?? null,
      info: parent.info ?? null,
      groups: parent.groups ?? null,
      sourceNotePath: String(parent.sourceNotePath || ""),
      sourceStartLine: Number(parent.sourceStartLine ?? 0) || 0,
      createdAt: resolveChildCreatedAt(prev, parent, now),
      updatedAt: now,
      lastSeenAt: now,
    };

    plugin.store.upsertCard(prev && typeof prev === "object" ? { ...prev, ...rec } : rec);
    ensureStateIfMissing(plugin, childId, now);
  }

  for (const ch of existing) {
    const cid = String(ch.id || "");
    if (!cid || keep.has(cid)) continue;
    delete plugin.store.data.cards[cid];
    if (plugin.store.data.states) delete plugin.store.data.states[cid];
  }
}

function syncReversedChildren(plugin: LearnKitPlugin, parent: CardRecord, now: number): void {
  const parentId = String(parent.id || "");
  if (!parentId) return;

  const existing = collectChildrenByType(plugin, parentId, "reversed-child");
  const keep = new Set<string>();
  const titleBase = String(parent.title || "").trim();

  for (const dir of ["forward", "back"] as const) {
    const childId = stableReversedChildId(parentId, dir);
    keep.add(childId);

    const prev = plugin.store.data.cards?.[childId];
    const rec: CardRecord = {
      id: childId,
      type: "reversed-child",
      title: titleBase ? `${titleBase} • ${dir === "forward" ? "Q→A" : "A→Q"}` : null,
      parentId,
      reversedDirection: dir,
      q: parent.q ?? null,
      a: parent.a ?? null,
      info: parent.info ?? null,
      groups: parent.groups ?? null,
      sourceNotePath: String(parent.sourceNotePath || ""),
      sourceStartLine: Number(parent.sourceStartLine ?? 0) || 0,
      createdAt: resolveChildCreatedAt(prev, parent, now),
      updatedAt: now,
      lastSeenAt: now,
    };

    plugin.store.upsertCard(prev && typeof prev === "object" ? { ...prev, ...rec } : rec);

    if (!hasState(plugin, childId)) {
      if (dir === "forward" && hasState(plugin, parentId)) {
        const st = plugin.store.data.states?.[parentId];
        if (st && typeof st === "object") {
          plugin.store.upsertState({ ...st, id: childId });
          if (plugin.store.data.states) delete plugin.store.data.states[parentId];
        }
      } else {
        ensureStateIfMissing(plugin, childId, now);
      }
    }
  }

  for (const ch of existing) {
    const cid = String(ch.id || "");
    if (!cid || keep.has(cid)) continue;
    delete plugin.store.data.cards[cid];
    if (plugin.store.data.states) delete plugin.store.data.states[cid];
  }
}

function syncIoChildren(plugin: LearnKitPlugin, parent: CardRecord, now: number): void {
  const parentId = String(parent.id || "");
  if (!parentId) return;
  const ioMap = plugin.store.data.io || {};
  const ioDef = ioMap[parentId];
  if (!ioDef || !Array.isArray(ioDef.rects) || ioDef.rects.length === 0) return;

  const groupToRectIds = new Map<string, string[]>();
  for (const r of ioDef.rects) {
    const g = normaliseGroupKey(r.groupKey);
    const arr = groupToRectIds.get(g) ?? [];
    arr.push(String(r.rectId));
    groupToRectIds.set(g, arr);
  }

  const existing = collectChildrenByType(plugin, parentId, "io-child");
  const keep = new Set<string>();
  const titleBase = String(parent.title || "").trim();

  for (const [groupKey, rectIds] of groupToRectIds.entries()) {
    const childId = stableIoChildId(parentId, groupKey);
    keep.add(childId);

    const prev = plugin.store.data.cards?.[childId];
    const rec: CardRecord = {
      id: childId,
      type: "io-child",
      title: titleBase || null,
      parentId,
      groupKey,
      rectIds: rectIds.slice(),
      retired: false,
      prompt: parent.prompt ?? null,
      info: parent.info ?? null,
      groups: parent.groups ?? null,
      sourceNotePath: String(parent.sourceNotePath || ""),
      sourceStartLine: Number(parent.sourceStartLine ?? 0) || 0,
      imageRef: ioDef.imageRef || null,
      maskMode: ioDef.maskMode || null,
      createdAt: resolveChildCreatedAt(prev, parent, now),
      updatedAt: now,
      lastSeenAt: now,
    };

    plugin.store.upsertCard(prev && typeof prev === "object" ? { ...prev, ...rec } : rec);
    ensureStateIfMissing(plugin, childId, now);
  }

  for (const ch of existing) {
    const cid = String(ch.id || "");
    if (!cid || keep.has(cid)) continue;
    delete plugin.store.data.cards[cid];
    if (plugin.store.data.states) delete plugin.store.data.states[cid];
  }
}

export async function persistEditedCardAndSiblings(
  plugin: LearnKitPlugin,
  card: CardRecord,
  options: PersistEditedCardOptions = {},
): Promise<void> {
  const now = Date.now();
  const id = String(card.id || "");
  if (!id) return;

  const prevParent = plugin.store.data.cards?.[id];
  const next: CardRecord = {
    ...card,
    id,
    sourceStartLine: Number(card.sourceStartLine ?? 0) || 0,
    createdAt:
      Number.isFinite(Number(card.createdAt)) && Number(card.createdAt) > 0
        ? Number(card.createdAt)
        : Number.isFinite(Number(prevParent?.createdAt)) && Number(prevParent?.createdAt) > 0
          ? Number(prevParent?.createdAt)
          : now,
    updatedAt: now,
    lastSeenAt: now,
  };

  plugin.store.upsertCard(next);

  if (next.type === "reversed") {
    syncReversedChildren(plugin, next, now);
    deleteChildrenByType(plugin, id, "cloze-child");
  } else if (next.type === "cloze") {
    syncClozeChildren(plugin, next, now);
    deleteChildrenByType(plugin, id, "reversed-child");
    ensureStateIfMissing(plugin, id, now);
  } else if (next.type === "io") {
    syncIoChildren(plugin, next, now);
    ensureStateIfMissing(plugin, id, now);
  } else {
    if (!hasState(plugin, id)) {
      const fwdChildId = `${id}::reversed::forward`;
      const fwdState = plugin.store.data.states?.[fwdChildId];
      if (fwdState && typeof fwdState === "object") {
          plugin.store.upsertState({ ...fwdState, id });
      } else {
        ensureStateIfMissing(plugin, id, now);
      }
    }
    deleteChildrenByType(plugin, id, "reversed-child");
    deleteChildrenByType(plugin, id, "cloze-child");
  }

  if (options.persist !== false) {
    await plugin.store.persist();
  }
}
