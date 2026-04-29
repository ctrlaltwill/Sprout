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
import type LearnKitPlugin from "../../main";
import { log } from "../../platform/core/logger";
import { t } from "../../platform/translations/translator";
import type { CardRecord } from "../../platform/core/store";
import { normaliseGroupKey, stableHqChildId, stableIoChildId } from "./mask-tool";
import { findCardBlockRangeById } from "../../views/reviewer/markdown-block";
import {
  normaliseVaultPath,
  reserveNewBcId,
  buildHqMarkdownWithAnchor,
  buildIoMarkdownWithAnchor,
} from "./io-helpers";
import {
  extFromMime,
  bestEffortAttachmentPath,
  writeBinaryToVault,
  type ClipboardImage,
} from "../../platform/modals/modal-utils";
import { buildPrimaryCardAnchor } from "../../platform/core/identity";
import type { IORect } from "./io-types";
import { syncOneFile } from "../../platform/integrations/sync/sync-engine";

function formatHotspotPrompt(label: string): string {
  const clean = String(label || "").trim();
  if (!clean) return "Click on the hotspot location.";
  const normalized = clean.replace(/\.+$/, "").trim();
  if (!normalized) return "Click on the hotspot location.";
  return `Click on ${normalized}.`;
}

// ── Insert-at-cursor helper ─────────────────────────────────────────────────

export async function insertTextAtCursorOrAppend(
  app: App,
  active: TFile,
  textToInsert: string,
  forcePersist = false,
  preferAppend = false,
): Promise<void> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!preferAppend && view?.file?.path === active.path && view.editor) {
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
    const existing = String(txt ?? "").replace(/\s+$/g, "");
    const incoming = String(textToInsert ?? "")
      .replace(/^\s+/g, "")
      .replace(/\s+$/g, "");
    const out = existing.length > 0
      ? `${existing}\n\n${incoming}\n`
      : `${incoming}\n`;
    await app.vault.modify(active, out);
  }
}

// ── Save IO card ────────────────────────────────────────────────────────────

export interface IoSaveParams {
  plugin: LearnKitPlugin;
  app: App;
  cardKind?: "io" | "hq";
  editParentId: string | null;
  editImageRef: string | null;
  titleVal: string;
  groupsVal: string;
  infoVal: string;
  promptVal?: string;
  interactionMode?: "click" | "drag-drop" | null;
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
    cardKind,
    editParentId,
    editImageRef,
    titleVal,
    groupsVal,
    infoVal,
    promptVal,
    interactionMode,
    getImageData,
    rects,
    hasTextBoxes,
    burnTextBoxes,
  } = params;

  const isHotspot = cardKind === "hq";
  const parentType = isHotspot ? "hq" : "io";
  const childType = isHotspot ? "hq-child" : "io-child";
  const childIdFactory = isHotspot ? stableHqChildId : stableIoChildId;
  const cardLabel = isHotspot ? t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.hotspot", "hotspot") : t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.io", "image occlusion");
  const noticeLabel = isHotspot ? t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.hotspotLabel", "Hotspot") : t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.ioLabel", "Image occlusion");
  const isEdit = !!editParentId;
  const groupsArr = groupsVal
    ? groupsVal
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : null;
  const legacyPrompt = isHotspot ? String(promptVal || "").trim() : "";
  const effectiveInteractionMode: "click" | "drag-drop" | null = isHotspot
    ? interactionMode === "drag-drop"
      ? "drag-drop"
      : "click"
    : null;

  if (isHotspot && rects.length === 0) {
    new Notice(t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.hotspotAtLeastOne", "Add at least one hotspot before saving."));
    return false;
  }

  if (hasTextBoxes) {
    await burnTextBoxes();
  }

  const normRects = rects.map((r) => ({
    rectId: String(r.rectId),
    x: Math.max(0, Math.min(1, r.normX)),
    y: Math.max(0, Math.min(1, r.normY)),
    w: Math.max(0, Math.min(1, r.normW)),
    h: Math.max(0, Math.min(1, r.normH)),
    groupKey: normaliseGroupKey(r.groupKey),
    label: String(r.label || r.groupKey || "").trim() || normaliseGroupKey(r.groupKey),
    shape: r.shape || "rect",
    points: Array.isArray(r.points)
      ? r.points.map((point) => ({
          x: Math.max(0, Math.min(1, Number(point?.x ?? 0))),
          y: Math.max(0, Math.min(1, Number(point?.y ?? 0))),
        }))
      : undefined,
  }));

  const occlusionsJson = JSON.stringify(
    normRects.map((r) => ({
      rectId: r.rectId,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      groupKey: r.groupKey,
      shape: r.shape || "rect",
      points: Array.isArray(r.points) ? r.points.map((point) => ({ ...point })) : undefined,
    })),
  );

  const hqRegionsJson = JSON.stringify(
    normRects.map((r) => ({
      rectId: r.rectId,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      groupKey: r.groupKey,
      label: r.label,
      shape: r.shape || "rect",
      points: Array.isArray(r.points) ? r.points.map((point) => ({ ...point })) : undefined,
    })),
  );

  const groupToRectIds = new Map<string, string[]>();
  const hotspotPromptByGroup = new Map<string, string>();
  for (const r of normRects) {
    const groupKey = normaliseGroupKey(r.groupKey);
    const arr = groupToRectIds.get(groupKey) ?? [];
    arr.push(String(r.rectId));
    groupToRectIds.set(groupKey, arr);
    if (isHotspot && !hotspotPromptByGroup.has(groupKey)) {
      const label = String(r.label || groupKey).trim() || groupKey;
      hotspotPromptByGroup.set(groupKey, formatHotspotPrompt(label));
    }
  }
  if (isHotspot && hotspotPromptByGroup.size === 0 && legacyPrompt) {
    hotspotPromptByGroup.set("1", legacyPrompt);
  }

  if (isEdit) {
    const parentId = String(editParentId || "");
    const cardsMap = (plugin.store?.data?.cards || {});
    const parent = cardsMap[parentId];
    if (!parent || String(parent.type) !== parentType) {
      new Notice(t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.parentNotFound", "Could not find {cardLabel} parent to edit.", { cardLabel }));
      return false;
    }

    const currentDefs = isHotspot
      ? (plugin.store.data.hq || {})
      : (plugin.store.data.io || {});
    const currentImageRef = String(parent.imageRef || currentDefs[parentId]?.imageRef || editImageRef || "").trim();
    let imagePath = currentImageRef;

    const imageData = getImageData();
    if (imageData) {
      const ext = extFromMime(imageData.mime);
      if (!imagePath) {
        const baseName = `sprout-${isHotspot ? "hq" : "io"}-${parentId}.${ext}`;
        const srcFile = app.vault.getAbstractFileByPath(String(parent.sourceNotePath || ""));
        if (srcFile instanceof TFile) imagePath = bestEffortAttachmentPath(plugin, srcFile, baseName, isHotspot ? "hq" : "io");
        else {
          const activeFile = app.workspace.getActiveFile();
          if (activeFile instanceof TFile) imagePath = bestEffortAttachmentPath(plugin, activeFile, baseName, isHotspot ? "hq" : "io");
        }
      }
      try {
        await writeBinaryToVault(app, imagePath, imageData.data);
      } catch (e: unknown) {
        new Notice(`Failed to save image (${e instanceof Error ? e.message : String(e)})`);
        return false;
      }
    }

    if (!imagePath) {
      new Notice(t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.missingImage", "{cardLabel} card is missing an image.", { cardLabel: noticeLabel }));
      return false;
    }

    const now = Date.now();
    const mask = normRects.length > 0 ? maskMode : null;
    const normalisedImagePath = normaliseVaultPath(imagePath);
    const parentRec: CardRecord = {
      ...parent,
      id: parentId,
      type: parentType,
      title: titleVal || parent.title || null,
      prompt: isHotspot ? null : parent.prompt ?? null,
      info: infoVal || null,
      groups: groupsArr && groupsArr.length ? groupsArr : null,
      imageRef: normalisedImagePath,
      updatedAt: now,
      lastSeenAt: now,
    };
    if (isHotspot) parentRec.interactionMode = effectiveInteractionMode;
    else parentRec.maskMode = mask;
    plugin.store.upsertCard(parentRec);

    if (isHotspot) {
      const hqMap = plugin.store.data.hq || {};
      plugin.store.data.hq = hqMap;
      hqMap[parentId] = {
        imageRef: normalisedImagePath,
        interactionMode: effectiveInteractionMode,
        prompt: null,
        rects: normRects,
      };
    } else {
      const ioMap = plugin.store.data.io || {};
      plugin.store.data.io = ioMap;
      ioMap[parentId] = {
        imageRef: normalisedImagePath,
        maskMode: mask,
        rects: normRects,
      };
    }

    const cards = (plugin.store.data.cards || {});
    const keepChildIds = new Set<string>();
    const titleBase = String(parentRec.title ?? "").trim();
    for (const [groupKey, rectIds] of groupToRectIds.entries()) {
      const childId = childIdFactory(parentId, groupKey);
      keepChildIds.add(childId);
      const rec: CardRecord = {
        id: childId,
        type: childType,
        title: titleBase || null,
        parentId,
        groupKey,
        rectIds: rectIds.slice(),
        retired: false,
        prompt: isHotspot
          ? hotspotPromptByGroup.get(groupKey) || formatHotspotPrompt(groupKey)
          : null,
        info: parentRec.info,
        groups: parentRec.groups || null,
        sourceNotePath: String(parentRec.sourceNotePath || ""),
        sourceStartLine: Number(parentRec.sourceStartLine ?? 0) || 0,
        imageRef: normalisedImagePath,
        createdAt: Number((cards[childId])?.createdAt ?? now),
        updatedAt: now,
        lastSeenAt: now,
      };
      if (isHotspot) rec.interactionMode = effectiveInteractionMode;
      else rec.maskMode = mask;

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

    for (const c of Object.values(cards)) {
      if (!c || c.type !== childType) continue;
      if (String(c.parentId) !== parentId) continue;
      const cid = String(c.id);
      if (keepChildIds.has(cid)) continue;
      delete cards[cid];
      if (plugin.store.data.states) delete plugin.store.data.states[cid];
    }

    await plugin.store.persist();

    try {
      const srcPath = String(parentRec.sourceNotePath || "");
      const file = app.vault.getAbstractFileByPath(srcPath);
      if (file instanceof TFile) {
        const text = await app.vault.read(file);
        const lines = text.split(/\r?\n/);
        const { start, end } = findCardBlockRangeById(lines, parentId);
        const embed = `![[${normalisedImagePath}]]`;
        const block = [
          buildPrimaryCardAnchor(parentId),
          ...(isHotspot
            ? buildHqMarkdownWithAnchor({
                id: parentId,
                title: titleVal || parentRec.title || undefined,
                groups: groupsVal || undefined,
                hqEmbed: embed,
                hqRegionsJson,
                interactionMode: effectiveInteractionMode,
                info: infoVal || undefined,
              })
            : buildIoMarkdownWithAnchor({
                id: parentId,
                title: titleVal || parentRec.title || undefined,
                groups: groupsVal || undefined,
                ioEmbed: embed,
                occlusionsJson,
                maskMode: mask,
                info: infoVal || undefined,
              })),
        ];
        lines.splice(start, end - start, ...block);
        await app.vault.modify(file, lines.join("\n"));
      }
    } catch (e: unknown) {
      log.warn("Failed to update occlusion markdown", e);
    }

    try {
      const srcPath = String(parentRec.sourceNotePath || "");
      const file = app.vault.getAbstractFileByPath(srcPath);
      if (file instanceof TFile) {
        await syncOneFile(plugin, file, { pruneGlobalOrphans: false });
      }
    } catch (e: unknown) {
      log.warn(`Failed to run localized sync after ${cardLabel} edit`, e);
    }

    new Notice(t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.updated", "{cardLabel} updated.", { cardLabel: noticeLabel }));
    return true;
  }

  const active = app.workspace.getActiveFile();
  if (!(active instanceof TFile)) {
    new Notice("Open a Markdown note first");
    return false;
  }

  const imageData = getImageData();
  if (!imageData) {
    new Notice(t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.pasteImage", "Paste an image to create a {cardLabel} card", { cardLabel }));
    return false;
  }

  const id = await reserveNewBcId(plugin, active);
  const ext = extFromMime(imageData.mime);
  const baseName = `sprout-${isHotspot ? "hq" : "io"}-${id}.${ext}`;
  const vaultPath = bestEffortAttachmentPath(plugin, active, baseName, isHotspot ? "hq" : "io");

  try {
    await writeBinaryToVault(app, vaultPath, imageData.data);
  } catch (e: unknown) {
    new Notice(`Failed to save image (${e instanceof Error ? e.message : String(e)})`);
    return false;
  }

  const imagePath = normaliseVaultPath(vaultPath);
  const now = Date.now();
  const mask = normRects.length > 0 ? maskMode : null;
  const parentRec: CardRecord = {
    id,
    type: parentType,
    title: titleVal || null,
    prompt: isHotspot ? null : null,
    info: infoVal || null,
    groups: groupsArr && groupsArr.length ? groupsArr : null,
    imageRef: imagePath,
    sourceNotePath: active.path,
    sourceStartLine: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
  if (isHotspot) parentRec.interactionMode = effectiveInteractionMode;
  else parentRec.maskMode = mask;
  plugin.store.upsertCard(parentRec);

  if (isHotspot) {
    const hqMap = plugin.store.data.hq || {};
    plugin.store.data.hq = hqMap;
    hqMap[id] = {
      imageRef: imagePath,
      interactionMode: effectiveInteractionMode,
      prompt: null,
      rects: normRects,
    };
  } else {
    const ioMap = plugin.store.data.io || {};
    plugin.store.data.io = ioMap;
    ioMap[id] = {
      imageRef: imagePath,
      maskMode: mask,
      rects: normRects,
    };
  }

  const cards = (plugin.store.data.cards || {});
  const keepChildIds = new Set<string>();
  const titleBase = String(parentRec.title ?? "").trim();
  for (const [groupKey, rectIds] of groupToRectIds.entries()) {
    const childId = childIdFactory(id, groupKey);
    keepChildIds.add(childId);
    const rec: CardRecord = {
      id: childId,
      type: childType,
      title: titleBase || null,
      parentId: id,
      groupKey,
      rectIds: rectIds.slice(),
      retired: false,
      prompt: isHotspot
        ? hotspotPromptByGroup.get(groupKey) || formatHotspotPrompt(groupKey)
        : null,
      info: parentRec.info,
      groups: parentRec.groups || null,
      sourceNotePath: active.path,
      sourceStartLine: 0,
      imageRef: imagePath,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    if (isHotspot) rec.interactionMode = effectiveInteractionMode;
    else rec.maskMode = mask;

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

  for (const c of Object.values(cards)) {
    if (!c || c.type !== childType) continue;
    if (String(c.parentId) !== id) continue;
    const cid = String(c.id);
    if (keepChildIds.has(cid)) continue;
    delete cards[cid];
    if (plugin.store.data.states) delete plugin.store.data.states[cid];
  }

  await plugin.store.persist();

  const embed = `![[${imagePath}]]`;
  const block = [
    buildPrimaryCardAnchor(id),
    ...(isHotspot
      ? buildHqMarkdownWithAnchor({
          id,
          title: titleVal || undefined,
          groups: groupsVal || undefined,
          hqEmbed: embed,
          hqRegionsJson,
          interactionMode: effectiveInteractionMode,
          info: infoVal || undefined,
        })
      : buildIoMarkdownWithAnchor({
          id,
          title: titleVal || undefined,
          groups: groupsVal || undefined,
          ioEmbed: embed,
          occlusionsJson,
          maskMode: mask,
          info: infoVal || undefined,
        })),
  ];

  try {
    await insertTextAtCursorOrAppend(app, active, block.join("\n"), true);
  } catch (e: unknown) {
    log.warn("Failed to insert occlusion markdown, but card saved to store", e);
  }

  try {
    await syncOneFile(plugin, active, { pruneGlobalOrphans: false });
  } catch (e: unknown) {
    log.warn(`Failed to run localized sync after ${cardLabel} create`, e);
  }

  new Notice(t(plugin.settings?.general?.interfaceLanguage, "ui.cardCreator.notice.saved", "{cardLabel} saved.", { cardLabel: noticeLabel }));
  return true;
}
