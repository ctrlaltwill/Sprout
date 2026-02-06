/**
 * widget/widget-scope.ts
 * ──────────────────────
 * Folder-note / deck-scope helpers and card-data accessors for the
 * Sprout sidebar widget.
 *
 * All functions are pure (no class dependency) – they receive the
 * plugin, store, or file as explicit arguments.
 *
 * Exports:
 *  - folderNotesAsDecksEnabled
 *  - getFolderNoteInfo
 *  - isFolderNote
 *  - getCardsInActiveNoteOnly
 *  - getCardsInActiveScope
 *  - computeCounts
 */

import type { TFile } from "obsidian";
import { filterReviewableCards } from "./widget-helpers";

/* ------------------------------------------------------------------ */
/*  Folder-note / deck scope helpers                                   */
/* ------------------------------------------------------------------ */

/** Whether the "treat folder notes as decks" setting is enabled (defaults ON). */
export function folderNotesAsDecksEnabled(settings: any): boolean {
  const v = settings?.widget?.treatFolderNotesAsDecks;
  return v !== false; // default ON
}

/**
 * If `file` is a folder note (basename === parent folder name), return
 * its folder path and name.  Otherwise `null`.
 *
 * Example: `Psychiatry/Psychiatry.md` → `{ folderPath: "Psychiatry", folderName: "Psychiatry" }`
 */
export function getFolderNoteInfo(file: TFile): { folderPath: string; folderName: string } | null {
  const parent = file.parent ?? null;
  const folderName: string | null =
    parent && typeof parent.name === "string" ? (parent.name as string) : null;
  const folderPath: string | null =
    parent && typeof parent.path === "string" ? (parent.path as string) : null;

  if (!folderName || !folderPath) return null;

  // "Exact same name as the directory"
  if (file.basename !== folderName) return null;

  // Defensive: avoid odd cases where parent is the vault root with empty path.
  if (!folderPath || folderPath === "/") return null;

  return { folderPath, folderName };
}

/** Returns `true` when `file` is a folder note. */
export function isFolderNote(file: TFile | null): boolean {
  if (!file) return false;
  return getFolderNoteInfo(file) !== null;
}

/* ------------------------------------------------------------------ */
/*  Card data accessors                                                */
/* ------------------------------------------------------------------ */

/** Cards in *this note only* (always available, regardless of folder-deck setting). */
export function getCardsInActiveNoteOnly(store: any, file: TFile | null): any[] {
  if (!file) return [];
  return store.getAllCards().filter((c: any) => c.sourceNotePath === file.path);
}

/**
 * Returns cards in the active scope based on the setting:
 *  - Normal note → cards whose `sourceNotePath === file.path`
 *  - Folder note (setting enabled) → cards in all descendant notes
 *  - Folder note (setting disabled) → only cards in the folder note file
 */
export function getCardsInActiveScope(store: any, file: TFile | null, settings: any): any[] {
  if (!file) return [];

  const folder = getFolderNoteInfo(file);
  const all = store.getAllCards();

  if (!folder) {
    return filterReviewableCards(all.filter((c: any) => c.sourceNotePath === file.path));
  }

  // Folder note – but feature disabled
  if (!folderNotesAsDecksEnabled(settings)) {
    return filterReviewableCards(all.filter((c: any) => c.sourceNotePath === file.path));
  }

  const prefix = folder.folderPath.endsWith("/") ? folder.folderPath : folder.folderPath + "/";
  return filterReviewableCards(
    all.filter((c: any) => typeof c.sourceNotePath === "string" && c.sourceNotePath.startsWith(prefix)),
  );
}

/**
 * Computes summary counts (total, new, learning-due, review-due)
 * for an array of cards.
 */
export function computeCounts(cards: any[], store: any): { total: number; new: number; learn: number; due: number } {
  const now = Date.now();
  const states = store.data?.states || {};
  const total = cards.length;
  let nNew = 0,
    nLearn = 0,
    nDue = 0;

  for (const c of cards) {
    const st = states[c.id];
    if (!st) continue;
    if (st.stage === "new") nNew++;
    else if (st.stage === "learning" && st.due <= now) nLearn++;
    else if (st.stage === "review" && st.due <= now) nDue++;
  }
  return { total, new: nNew, learn: nLearn, due: nDue };
}
