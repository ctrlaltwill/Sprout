/**
 * @file src/platform/core/targeted-card-persist.ts
 * @summary Module for targeted card persist.
 *
 * @exports
 *  - persistEditedCardAndSiblings
 */
import { normaliseGroupKey, stableIoChildId } from "../image-occlusion/mask-tool";
import { deleteTtsCacheForCardIds, getTtsCacheDirPath } from "../integrations/tts/tts-cache";
function hasState(plugin, id) {
    var _a;
    return !!((_a = plugin.store.data.states) === null || _a === void 0 ? void 0 : _a[id]);
}
function ensureStateIfMissing(plugin, id, now) {
    if (!hasState(plugin, id))
        plugin.store.ensureState(id, now, 2.5);
}
function deleteChildrenByType(plugin, parentId, childType) {
    for (const id of Object.keys(plugin.store.data.cards || {})) {
        const rec = plugin.store.data.cards[id];
        if (!rec)
            continue;
        if (String(rec.type) !== childType)
            continue;
        if (String(rec.parentId || "") !== parentId)
            continue;
        delete plugin.store.data.cards[id];
        if (plugin.store.data.states)
            delete plugin.store.data.states[id];
    }
}
function collectChildrenByType(plugin, parentId, childType) {
    const out = [];
    for (const rec of Object.values(plugin.store.data.cards || {})) {
        if (!rec)
            continue;
        if (String(rec.type) !== childType)
            continue;
        if (String(rec.parentId || "") !== parentId)
            continue;
        out.push(rec);
    }
    return out;
}
function extractClozeIndices(text) {
    const re = /\{\{c(\d+)::/gi;
    const out = new Set();
    let m;
    while ((m = re.exec(String(text || "")))) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0)
            out.add(n);
    }
    return Array.from(out).sort((a, b) => a - b);
}
function stableClozeChildId(parentId, idx) {
    return `${parentId}::cloze::c${idx}`;
}
function stableReversedChildId(parentId, dir) {
    return `${parentId}::reversed::${dir}`;
}
function resolveChildCreatedAt(prev, parent, now) {
    if (prev && Number.isFinite(prev.createdAt) && Number(prev.createdAt) > 0)
        return Number(prev.createdAt);
    if (Number.isFinite(parent.createdAt) && Number(parent.createdAt) > 0)
        return Number(parent.createdAt);
    return now;
}
function syncClozeChildren(plugin, parent, now) {
    var _a, _b, _c, _d, _e;
    const parentId = String(parent.id || "");
    if (!parentId)
        return;
    const indices = extractClozeIndices(String(parent.clozeText || ""));
    const keep = new Set();
    const existing = collectChildrenByType(plugin, parentId, "cloze-child");
    const titleBase = String(parent.title || "").trim();
    for (const idx of indices) {
        const childId = stableClozeChildId(parentId, idx);
        keep.add(childId);
        const prev = (_a = plugin.store.data.cards) === null || _a === void 0 ? void 0 : _a[childId];
        const rec = {
            id: childId,
            type: "cloze-child",
            title: titleBase ? `${titleBase} • c${idx}` : null,
            parentId,
            clozeIndex: idx,
            clozeText: (_b = parent.clozeText) !== null && _b !== void 0 ? _b : null,
            info: (_c = parent.info) !== null && _c !== void 0 ? _c : null,
            groups: (_d = parent.groups) !== null && _d !== void 0 ? _d : null,
            sourceNotePath: String(parent.sourceNotePath || ""),
            sourceStartLine: Number((_e = parent.sourceStartLine) !== null && _e !== void 0 ? _e : 0) || 0,
            createdAt: resolveChildCreatedAt(prev, parent, now),
            updatedAt: now,
            lastSeenAt: now,
        };
        plugin.store.upsertCard(prev && typeof prev === "object" ? { ...prev, ...rec } : rec);
        ensureStateIfMissing(plugin, childId, now);
    }
    for (const ch of existing) {
        const cid = String(ch.id || "");
        if (!cid || keep.has(cid))
            continue;
        delete plugin.store.data.cards[cid];
        if (plugin.store.data.states)
            delete plugin.store.data.states[cid];
    }
}
function syncReversedChildren(plugin, parent, now) {
    var _a, _b, _c, _d, _e, _f, _g;
    const parentId = String(parent.id || "");
    if (!parentId)
        return;
    const existing = collectChildrenByType(plugin, parentId, "reversed-child");
    const keep = new Set();
    const titleBase = String(parent.title || "").trim();
    for (const dir of ["forward", "back"]) {
        const childId = stableReversedChildId(parentId, dir);
        keep.add(childId);
        const prev = (_a = plugin.store.data.cards) === null || _a === void 0 ? void 0 : _a[childId];
        const rec = {
            id: childId,
            type: "reversed-child",
            title: titleBase ? `${titleBase} • ${dir === "forward" ? "Q→A" : "A→Q"}` : null,
            parentId,
            reversedDirection: dir,
            q: (_b = parent.q) !== null && _b !== void 0 ? _b : null,
            a: (_c = parent.a) !== null && _c !== void 0 ? _c : null,
            info: (_d = parent.info) !== null && _d !== void 0 ? _d : null,
            groups: (_e = parent.groups) !== null && _e !== void 0 ? _e : null,
            sourceNotePath: String(parent.sourceNotePath || ""),
            sourceStartLine: Number((_f = parent.sourceStartLine) !== null && _f !== void 0 ? _f : 0) || 0,
            createdAt: resolveChildCreatedAt(prev, parent, now),
            updatedAt: now,
            lastSeenAt: now,
        };
        plugin.store.upsertCard(prev && typeof prev === "object" ? { ...prev, ...rec } : rec);
        if (!hasState(plugin, childId)) {
            if (dir === "forward" && hasState(plugin, parentId)) {
                const st = (_g = plugin.store.data.states) === null || _g === void 0 ? void 0 : _g[parentId];
                if (st && typeof st === "object") {
                    plugin.store.upsertState({ ...st, id: childId });
                    if (plugin.store.data.states)
                        delete plugin.store.data.states[parentId];
                }
            }
            else {
                ensureStateIfMissing(plugin, childId, now);
            }
        }
    }
    for (const ch of existing) {
        const cid = String(ch.id || "");
        if (!cid || keep.has(cid))
            continue;
        delete plugin.store.data.cards[cid];
        if (plugin.store.data.states)
            delete plugin.store.data.states[cid];
    }
}
function syncIoChildren(plugin, parent, now) {
    var _a, _b, _c, _d, _e, _f;
    const parentId = String(parent.id || "");
    if (!parentId)
        return;
    const ioMap = plugin.store.data.io || {};
    const ioDef = ioMap[parentId];
    if (!ioDef || !Array.isArray(ioDef.rects) || ioDef.rects.length === 0)
        return;
    const groupToRectIds = new Map();
    for (const r of ioDef.rects) {
        const g = normaliseGroupKey(r.groupKey);
        const arr = (_a = groupToRectIds.get(g)) !== null && _a !== void 0 ? _a : [];
        arr.push(String(r.rectId));
        groupToRectIds.set(g, arr);
    }
    const existing = collectChildrenByType(plugin, parentId, "io-child");
    const keep = new Set();
    const titleBase = String(parent.title || "").trim();
    for (const [groupKey, rectIds] of groupToRectIds.entries()) {
        const childId = stableIoChildId(parentId, groupKey);
        keep.add(childId);
        const prev = (_b = plugin.store.data.cards) === null || _b === void 0 ? void 0 : _b[childId];
        const rec = {
            id: childId,
            type: "io-child",
            title: titleBase || null,
            parentId,
            groupKey,
            rectIds: rectIds.slice(),
            retired: false,
            prompt: (_c = parent.prompt) !== null && _c !== void 0 ? _c : null,
            info: (_d = parent.info) !== null && _d !== void 0 ? _d : null,
            groups: (_e = parent.groups) !== null && _e !== void 0 ? _e : null,
            sourceNotePath: String(parent.sourceNotePath || ""),
            sourceStartLine: Number((_f = parent.sourceStartLine) !== null && _f !== void 0 ? _f : 0) || 0,
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
        if (!cid || keep.has(cid))
            continue;
        delete plugin.store.data.cards[cid];
        if (plugin.store.data.states)
            delete plugin.store.data.states[cid];
    }
}
export async function persistEditedCardAndSiblings(plugin, card, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const now = Date.now();
    const id = String(card.id || "");
    if (!id)
        return;
    const prevParent = (_a = plugin.store.data.cards) === null || _a === void 0 ? void 0 : _a[id];
    const next = {
        ...card,
        id,
        sourceStartLine: Number((_b = card.sourceStartLine) !== null && _b !== void 0 ? _b : 0) || 0,
        createdAt: Number.isFinite(Number(card.createdAt)) && Number(card.createdAt) > 0
            ? Number(card.createdAt)
            : Number.isFinite(Number(prevParent === null || prevParent === void 0 ? void 0 : prevParent.createdAt)) && Number(prevParent === null || prevParent === void 0 ? void 0 : prevParent.createdAt) > 0
                ? Number(prevParent === null || prevParent === void 0 ? void 0 : prevParent.createdAt)
                : now,
        updatedAt: now,
        lastSeenAt: now,
    };
    plugin.store.upsertCard(next);
    // Invalidate cached TTS audio so edited content gets re-synthesised
    const adapter = (_d = (_c = plugin.app) === null || _c === void 0 ? void 0 : _c.vault) === null || _d === void 0 ? void 0 : _d.adapter;
    const configDir = (_f = (_e = plugin.app) === null || _e === void 0 ? void 0 : _e.vault) === null || _f === void 0 ? void 0 : _f.configDir;
    const pluginId = (_g = plugin.manifest) === null || _g === void 0 ? void 0 : _g.id;
    if (adapter && configDir && pluginId) {
        const cacheDirPath = getTtsCacheDirPath(configDir, pluginId);
        await deleteTtsCacheForCardIds(adapter, cacheDirPath, [id]);
    }
    if (next.type === "reversed") {
        syncReversedChildren(plugin, next, now);
        deleteChildrenByType(plugin, id, "cloze-child");
    }
    else if (next.type === "cloze") {
        syncClozeChildren(plugin, next, now);
        deleteChildrenByType(plugin, id, "reversed-child");
        ensureStateIfMissing(plugin, id, now);
    }
    else if (next.type === "io") {
        syncIoChildren(plugin, next, now);
        ensureStateIfMissing(plugin, id, now);
    }
    else {
        if (!hasState(plugin, id)) {
            const fwdChildId = `${id}::reversed::forward`;
            const fwdState = (_h = plugin.store.data.states) === null || _h === void 0 ? void 0 : _h[fwdChildId];
            if (fwdState && typeof fwdState === "object") {
                plugin.store.upsertState({ ...fwdState, id });
            }
            else {
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
