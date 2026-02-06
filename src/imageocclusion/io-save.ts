/**
 * @file src/imageocclusion/io-save.ts
 * @summary IO-card save logic for both creating new and editing existing Image Occlusion cards. Handles image writing to the vault, parent and child card upserts in the store, group-to-child mapping, stale child retirement, markdown block generation and insertion/update in the source note, and cursor-based or append-based text insertion.
 *
 * @exports
 *   - insertTextAtCursorOrAppend — inserts text at the editor cursor or appends to the file
 *   - IoSaveParams — interface describing all parameters needed to save an IO card
 *   - saveIoCard — persists an IO card (new or edit) to the store, writes the image, and updates markdown
 */

import { Notice, MarkdownView, TFile, type App } from "obsidian";
import type SproutPlugin from "../main";
import { BRAND } from "../core/constants";
import { log } from "../core/logger";
import type { CardRecord } from "../core/store";
import { normaliseGroupKey, stableIoChildId } from "./mask-tool";
import { findCardBlockRangeById } from "../reviewer/markdown-block";
import {
  normaliseVaultPath,
  reserveNewBcId,
  buildIoMarkdownWithAnchor,
} from "./io-helpers";
import {
  extFromMime,
  bestEffortAttachmentPath,
  writeBinaryToVault,
  type ClipboardImage,
} from "../modals/modal-utils";
import type { IORect } from "./io-types";

// ── Insert-at-cursor helper ─────────────────────────────────────────────────

export async function insertTextAtCursorOrAppend(
  app: App,
  active: TFile,
  textToInsert: string,
  forcePersist = false,
): Promise<void> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (view?.file?.path === active.path && view.editor) {
    const ed = view.editor;
    const cur = ed.getCursor();
    ed.replaceRange(textToInsert, cur);

    if (forcePersist) {
      try {
        if (typeof (view as { save?: () => Promise<void> }).save === "function") await (view as { save: () => Promise<void> }).save();
      } catch {
        // ignore
      }
      try {
        if (typeof ed.getValue === "function") {
          await app.vault.modify(active, ed.getValue());
        }
      } catch {
        // ignore
      }
    }
  } else {
    const txt = await app.vault.read(active);
    const out = (txt.endsWith("\n") ? txt : txt + "\n") + textToInsert;
    await app.vault.modify(active, out);
  }
}

// ── Save IO card ────────────────────────────────────────────────────────────

export interface IoSaveParams {
  plugin: SproutPlugin;
  app: App;
  editParentId: string | null;
  editImageRef: string | null;
  titleVal: string;
  groupsVal: string;
  infoVal: string;
  /** Getter so we always read the latest data (burnTextBoxes mutates it). */
  getImageData: () => ClipboardImage | null;
  rects: IORect[];
  hasTextBoxes: boolean;
  burnTextBoxes: () => Promise<void>;
}

/**
 * Persist an IO card to the store and write the markdown block.
 * Returns `true` when the modal should close (success), `false` otherwise.
 */
export async function saveIoCard(params: IoSaveParams, maskMode: "all" | "solo"): Promise<boolean> {
  const {
    plugin,
    app,
    editParentId,
    editImageRef,
    titleVal,
    groupsVal,
    infoVal,
    getImageData,
    rects,
    hasTextBoxes,
    burnTextBoxes,
  } = params;

  const isEdit = !!editParentId;

  const groupsArr = groupsVal
    ? groupsVal
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : null;

  // ── Edit existing IO card ─────────────────────────────────────────────────

  if (isEdit) {
    const parentId = String(editParentId || "");
    const cardsMap = (plugin.store?.data?.cards || {}) as Record<string, CardRecord>;
    const parent = cardsMap[parentId];
    if (!parent || String(parent.type) !== "io") {
      new Notice(`${BRAND}: could not find IO parent to edit.`);
      return false;
    }

    // Burn text boxes into the image before saving
    if (hasTextBoxes) {
      await burnTextBoxes();
    }

    const ioMap = plugin.store.data.io || {};
    plugin.store.data.io = ioMap;

    const currentImageRef = String(parent.imageRef || ioMap[parentId]?.imageRef || editImageRef || "").trim();
    let imagePath = currentImageRef;

    const ioImageData = getImageData();
    if (ioImageData) {
      const ext = extFromMime(ioImageData.mime);
      if (!imagePath) {
        const baseName = `sprout-io-${parentId}.${ext}`;
        const srcFile = app.vault.getAbstractFileByPath(String(parent.sourceNotePath || ""));
        if (srcFile instanceof TFile) imagePath = bestEffortAttachmentPath(plugin, srcFile, baseName);
        else {
          const activeFile = app.workspace.getActiveFile();
          if (activeFile instanceof TFile) imagePath = bestEffortAttachmentPath(plugin, activeFile, baseName);
        }
      }
      try {
        await writeBinaryToVault(app, imagePath, ioImageData.data);
      } catch (e: unknown) {
        new Notice(`${BRAND}: failed to save image (${e instanceof Error ? e.message : String(e)})`);
        return false;
      }
    }

    if (!imagePath) {
      new Notice(`${BRAND}: IO card is missing an image.`);
      return false;
    }

    const now = Date.now();
    const mask = rects.length > 0 ? maskMode : null;

    const parentRec: CardRecord = {
      ...parent,
      id: parentId,
      type: "io",
      title: titleVal || parent.title || "Image Occlusion",
      prompt: parent.prompt ?? null,
      info: infoVal || null,
      groups: groupsArr && groupsArr.length ? groupsArr : null,
      imageRef: normaliseVaultPath(imagePath),
      maskMode: mask,
      updatedAt: now,
      lastSeenAt: now,
    };

    plugin.store.upsertCard(parentRec);

    const normRects = rects.map((r) => ({
      rectId: String(r.rectId),
      x: Math.max(0, Math.min(1, r.normX)),
      y: Math.max(0, Math.min(1, r.normY)),
      w: Math.max(0, Math.min(1, r.normW)),
      h: Math.max(0, Math.min(1, r.normH)),
      groupKey: normaliseGroupKey(r.groupKey),
      shape: r.shape || "rect",
    }));

    ioMap[parentId] = {
      imageRef: normaliseVaultPath(imagePath),
      maskMode: mask,
      rects: normRects,
    };

    // Create/update child IO cards per group
    const groupToRectIds = new Map<string, string[]>();
    for (const r of normRects) {
      const g = normaliseGroupKey(r.groupKey);
      const arr = groupToRectIds.get(g) ?? [];
      arr.push(String(r.rectId));
      groupToRectIds.set(g, arr);
    }

    const cards = (plugin.store.data.cards || {});
    const keepChildIds = new Set<string>();
    const titleBase = parentRec.title || "Image Occlusion";

    for (const [groupKey, rectIds] of groupToRectIds.entries()) {
      const childId = stableIoChildId(parentId, groupKey);
      keepChildIds.add(childId);

      const rec: CardRecord = {
        id: childId,
        type: "io-child",
        title: titleBase,
        parentId,
        groupKey,
        rectIds: rectIds.slice(),
        retired: false,
        prompt: null,
        info: parentRec.info,
        groups: parentRec.groups || null,
        sourceNotePath: String(parentRec.sourceNotePath || ""),
        sourceStartLine: Number(parentRec.sourceStartLine ?? 0) || 0,
        imageRef: normaliseVaultPath(imagePath),
        maskMode: mask,
        createdAt: Number((cards[childId])?.createdAt ?? now),
        updatedAt: now,
        lastSeenAt: now,
      };

      const prev = cards[childId];
      if (prev && typeof prev === "object") {
        cards[childId] = { ...prev, ...rec };
        plugin.store.upsertCard(cards[childId]);
      } else {
        cards[childId] = rec;
        plugin.store.upsertCard(rec);
      }

      plugin.store.ensureState(childId, now, 2.5);
    }

    // Retire stale children that no longer have a matching group
    for (const c of Object.values(cards)) {
      if (!c || c.type !== "io-child") continue;
      if (String(c.parentId) !== parentId) continue;
      if (keepChildIds.has(String(c.id))) continue;
      c.retired = true;
      c.updatedAt = now;
      c.lastSeenAt = now;
      plugin.store.upsertCard(c);
    }

    await plugin.store.persist();

    // Update the markdown block in the note
    try {
      const srcPath = String(parentRec.sourceNotePath || "");
      const file = app.vault.getAbstractFileByPath(srcPath);
      if (file instanceof TFile) {
        const text = await app.vault.read(file);
        const lines = text.split(/\r?\n/);
        const { start, end } = findCardBlockRangeById(lines, parentId);
        const embed = `![[${normaliseVaultPath(imagePath)}]]`;
        const ioBlock = [
          `^sprout-${parentId}`,
          ...buildIoMarkdownWithAnchor({
            id: parentId,
            title: titleVal || parentRec.title || undefined,
            groups: groupsVal || undefined,
            ioEmbed: embed,
            info: infoVal || undefined,
          }),
        ];
        lines.splice(start, end - start, ...ioBlock);
        await app.vault.modify(file, lines.join("\n"));
      }
    } catch (e: unknown) {
      log.warn("Failed to update IO markdown", e);
    }

    new Notice(`${BRAND}: IO updated.`);
    return true;
  }

  // ── New IO card (not editing) ─────────────────────────────────────────────

  const active = app.workspace.getActiveFile();
  if (!(active instanceof TFile)) {
    new Notice(`${BRAND}: open a markdown note first`);
    return false;
  }

  if (!getImageData()) {
    new Notice(`${BRAND}: paste an image to create an IO card`);
    return false;
  }

  if (hasTextBoxes) {
    await burnTextBoxes();
  }

  const ioImageData = getImageData();
  if (!ioImageData) {
    new Notice(`${BRAND}: paste an image to create an IO card`);
    return false;
  }

  // Save image to vault
  const id = await reserveNewBcId(plugin, active);
  const ext = extFromMime(ioImageData.mime);
  const baseName = `sprout-io-${id}.${ext}`;
  const vaultPath = bestEffortAttachmentPath(plugin, active, baseName);

  try {
    await writeBinaryToVault(app, vaultPath, ioImageData.data);
  } catch (e: unknown) {
    new Notice(`${BRAND}: failed to save image (${e instanceof Error ? e.message : String(e)})`);
    return false;
  }

  const imagePath = normaliseVaultPath(vaultPath);
  const now = Date.now();
  const mask = rects.length > 0 ? maskMode : null;

  // Persist parent IO card in store
  const parentRec: CardRecord = {
    id,
    type: "io",
    title: titleVal || "Image Occlusion",
    prompt: null,
    info: infoVal || null,
    groups: groupsArr && groupsArr.length ? groupsArr : null,
    imageRef: imagePath,
    maskMode: mask,
    sourceNotePath: active.path,
    sourceStartLine: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };

  plugin.store.upsertCard(parentRec);

  // Persist IO definition in store.io
  const ioMap = plugin.store.data.io || {};
  plugin.store.data.io = ioMap;

  const normRects = rects.map((r) => ({
    rectId: String(r.rectId),
    x: Math.max(0, Math.min(1, r.normX)),
    y: Math.max(0, Math.min(1, r.normY)),
    w: Math.max(0, Math.min(1, r.normW)),
    h: Math.max(0, Math.min(1, r.normH)),
    groupKey: normaliseGroupKey(r.groupKey),
    shape: r.shape || "rect",
  }));

  ioMap[id] = {
    imageRef: imagePath,
    maskMode: mask,
    rects: normRects,
  };

  // Create child IO cards per group
  const groupToRectIds = new Map<string, string[]>();
  for (const r of normRects) {
    const g = normaliseGroupKey(r.groupKey);
    const arr = groupToRectIds.get(g) ?? [];
    arr.push(String(r.rectId));
    groupToRectIds.set(g, arr);
  }

  const cards = (plugin.store.data.cards || {});
  const keepChildIds = new Set<string>();
  const titleBase = parentRec.title || "Image Occlusion";

  for (const [groupKey, rectIds] of groupToRectIds.entries()) {
    const childId = stableIoChildId(id, groupKey);
    keepChildIds.add(childId);

    const rec: CardRecord = {
      id: childId,
      type: "io-child",
      title: titleBase,
      parentId: id,
      groupKey,
      rectIds: rectIds.slice(),
      retired: false,
      prompt: null,
      info: parentRec.info,
      groups: parentRec.groups || null,
      sourceNotePath: active.path,
      sourceStartLine: 0,
      imageRef: imagePath,
      maskMode: mask,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };

    const prev = cards[childId];
    if (prev && typeof prev === "object") {
      cards[childId] = { ...prev, ...rec };
      plugin.store.upsertCard(cards[childId]);
    } else {
      cards[childId] = rec;
      plugin.store.upsertCard(rec);
    }

    plugin.store.ensureState(childId, now, 2.5);
  }

  // Retire stale children
  for (const c of Object.values(cards)) {
    if (!c || c.type !== "io-child") continue;
    if (String(c.parentId) !== id) continue;
    if (keepChildIds.has(String(c.id))) continue;
    c.retired = true;
    c.updatedAt = now;
    c.lastSeenAt = now;
    plugin.store.upsertCard(c);
  }

  await plugin.store.persist();

  // Write markdown block to the note
  const embed = `![[${imagePath}]]`;
  const occlusionsJson =
    normRects.length > 0
      ? JSON.stringify(
          normRects.map((r) => ({
            rectId: r.rectId,
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
            groupKey: r.groupKey,
            shape: r.shape || "rect",
          })),
        )
      : null;

  const ioBlock = buildIoMarkdownWithAnchor({
    id,
    title: titleVal || undefined,
    groups: groupsVal || undefined,
    ioEmbed: embed,
    occlusionsJson,
    maskMode: mask,
    info: infoVal || undefined,
  });

  try {
    await insertTextAtCursorOrAppend(app, active, ioBlock.join("\n"), true);
  } catch (e: unknown) {
    log.warn("Failed to insert IO markdown, but card saved to store", e);
  }

  new Notice(`${BRAND}: IO saved.`);
  return true;
}
