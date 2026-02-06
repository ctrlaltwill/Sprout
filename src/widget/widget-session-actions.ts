/**
 * widget/widget-session-actions.ts
 * ─────────────────────────────────
 * Session-level actions for the Sprout sidebar widget: grading, undo,
 * bury, suspend, MCQ answering, next-card navigation, and inline editing.
 *
 * Every function receives the view instance as its first argument so the
 * module stays decoupled from the class definition (avoiding circular
 * imports).
 *
 * Exports:
 *  - gradeCurrentRating
 *  - canUndo / undoLastGrade
 *  - buryCurrentCard / suspendCurrentCard
 *  - answerMcq
 *  - nextCard
 *  - openEditModalForCurrentCard
 */

import { TFile, Notice } from "obsidian";
import { MS_DAY } from "../core/constants";
import { gradeFromRating } from "../scheduler/scheduler";
import { deepClone, clampInt } from "../reviewer/utilities";
import { openBulkEditModalForCards } from "../modals/bulk-edit";
import { findCardBlockRangeById, buildCardBlockMarkdown } from "../reviewer/markdown-block";
import { syncOneFile } from "../sync/sync-engine";

import type { UndoFrame } from "./widget-helpers";
import { isClozeLike } from "./widget-helpers";

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function currentCard(view: any): any | null {
  if (!view.session) return null;
  return view.session.queue[view.session.index] || null;
}

function computeMsToAnswer(view: any, now: number, id: string): number | undefined {
  if (!view._timing) return undefined;
  if (view._timing.cardId !== id) return undefined;
  if (!view._timing.startedAt) return undefined;

  const raw = now - view._timing.startedAt;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;

  // Hard cap: prevent pathological overcount if user walks away.
  return Math.max(0, Math.min(raw, 5 * 60 * 1000));
}

/* ------------------------------------------------------------------ */
/*  Grading                                                            */
/* ------------------------------------------------------------------ */

export async function gradeCurrentRating(
  view: any,
  rating: "again" | "hard" | "good" | "easy",
  meta: any,
): Promise<void> {
  const card = currentCard(view);
  if (!card || !view.session) return;
  if (view.session.mode === "practice") return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const now = Date.now();
  const store = view.plugin.store;
  const reviewLogLenBefore = Array.isArray(view.plugin.store.data?.reviewLog)
    ? view.plugin.store.data.reviewLog.length
    : 0;
  const analyticsLenBefore = Array.isArray(store?.data?.analytics?.events)
    ? store.data.analytics.events.length
    : 0;

  const st = view.plugin.store.getState(id);
  if (!st) return;

  // Compute time-to-answer before grading
  const msToAnswer = computeMsToAnswer(view, now, id);

  view._undo = {
    sessionStamp: view._sessionStamp,
    id,
    cardType: String(card.type || "unknown"),
    rating,
    at: now,
    meta: meta || null,
    sessionIndex: Number(view.session.index ?? 0),
    showAnswer: !!view.showAnswer,
    reviewLogLenBefore,
    analyticsLenBefore,
    prevState: deepClone(st),
  } as UndoFrame;

  const { nextState, prevDue, nextDue } = gradeFromRating(st, rating, now, view.plugin.settings);

  view.plugin.store.upsertState(nextState);
  view.plugin.store.appendReviewLog({ id, at: now, result: rating, prevDue, nextDue, meta: meta || null });

  // Append analytics review with timing
  if (typeof view.plugin.store.appendAnalyticsReview === "function") {
    view.plugin.store.appendAnalyticsReview({
      at: now,
      cardId: id,
      cardType: String(card.type || "unknown"),
      result: rating,
      mode: "scheduled",
      msToAnswer,
      prevDue,
      nextDue,
    });
  }

  await view.plugin.store.persist();

  view.session.graded[id] = { rating, at: now, meta: meta || null };
  view.session.stats.done = Object.keys(view.session.graded).length;
  view.showAnswer = true;
}

/* ------------------------------------------------------------------ */
/*  Undo                                                               */
/* ------------------------------------------------------------------ */

export function canUndo(view: any): boolean {
  if (view.mode !== "session" || !view.session) return false;
  if (view.session.mode === "practice") return false;
  const u = view._undo;
  if (!u) return false;
  if (u.sessionStamp !== view._sessionStamp) return false;
  return !!view.session.graded?.[u.id];
}

export async function undoLastGrade(view: any): Promise<void> {
  if (view.mode !== "session" || !view.session) return;
  const u = view._undo as UndoFrame | null;
  if (!u) return;
  if (u.sessionStamp !== view._sessionStamp) {
    view._undo = null;
    view.render();
    return;
  }
  if (!view.session.graded?.[u.id]) {
    view._undo = null;
    view.render();
    return;
  }

  view._undo = null;
  const store = view.plugin.store;

  try {
    if (u.prevState) store.upsertState(deepClone(u.prevState));

    if (typeof store.truncateReviewLog === "function") {
      store.truncateReviewLog(u.reviewLogLenBefore);
    } else if (Array.isArray(store.data?.reviewLog)) {
      store.data.reviewLog.length = Math.max(0, Math.floor(u.reviewLogLenBefore));
    }

    if (typeof store.truncateAnalyticsEvents === "function") {
      store.truncateAnalyticsEvents(u.analyticsLenBefore);
    } else {
      const a: any = store.data?.analytics;
      if (a && Array.isArray(a.events)) a.events.length = Math.max(0, Math.floor(u.analyticsLenBefore));
    }

    await store.persist();

    delete view.session.graded[u.id];
    view.session.stats.done = Object.keys(view.session.graded || {}).length;

    const maxIdx = Math.max(0, Number(view.session.queue?.length ?? 0));
    view.session.index = clampInt(u.sessionIndex, 0, maxIdx);
    view.showAnswer = false;

    view.render();
  } catch {
    new Notice("Undo failed.");
    view.render();
  }
}

/* ------------------------------------------------------------------ */
/*  Bury / Suspend                                                     */
/* ------------------------------------------------------------------ */

export async function buryCurrentCard(view: any): Promise<void> {
  if (view.mode !== "session" || !view.session) return;
  if (view.session.mode === "practice") return;
  const card = currentCard(view);
  if (!card) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const st = view.plugin.store.getState(id);
  if (!st) return;

  const now = Date.now();
  const nextState = { ...st, due: now + MS_DAY };
  view.plugin.store.upsertState(nextState);
  await view.plugin.store.persist();

  view.session.graded[id] = { rating: "again", at: now, meta: { action: "bury" } };
  view.session.stats.done = Object.keys(view.session.graded).length;
  view.showAnswer = false;
  await nextCard(view);
}

export async function suspendCurrentCard(view: any): Promise<void> {
  if (view.mode !== "session" || !view.session) return;
  if (view.session.mode === "practice") return;
  const card = currentCard(view);
  if (!card) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const st = view.plugin.store.getState(id);
  if (!st) return;

  const now = Date.now();
  const nextState = { ...st, stage: "suspended" as const };
  view.plugin.store.upsertState(nextState);
  await view.plugin.store.persist();

  view.session.graded[id] = { rating: "again", at: now, meta: { action: "suspend" } };
  view.session.stats.done = Object.keys(view.session.graded).length;
  view.showAnswer = false;
  await nextCard(view);
}

/* ------------------------------------------------------------------ */
/*  MCQ answering                                                      */
/* ------------------------------------------------------------------ */

export async function answerMcq(view: any, choiceIdx: number): Promise<void> {
  const card = currentCard(view);
  if (!card || card.type !== "mcq" || !view.session) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const pass = choiceIdx === card.correctIndex;

  if (view.session.mode === "practice") {
    view.session.graded[id] = {
      rating: pass ? "good" : "again",
      at: Date.now(),
      meta: { mcqChoice: choiceIdx, mcqCorrect: card.correctIndex, practice: true },
    };
    view.session.stats.done = Object.keys(view.session.graded).length;
    view.showAnswer = true;
    view.render();
    return;
  }

  // MCQ maps to Good / Again internally.
  await gradeCurrentRating(view, pass ? "good" : "again", {
    mcqChoice: choiceIdx,
    mcqCorrect: card.correctIndex,
  });
  view.render();
}

/* ------------------------------------------------------------------ */
/*  Next card                                                          */
/* ------------------------------------------------------------------ */

export async function nextCard(view: any): Promise<void> {
  if (!view.session) return;

  const card = currentCard(view);
  if (view.session.mode === "practice") {
    if (card) {
      const id = String(card.id);
      if (!view.session.graded[id]) {
        view.session.graded[id] = { rating: "good", at: Date.now(), meta: { practice: true, auto: true } };
        view.session.stats.done = Object.keys(view.session.graded).length;
      }
    }

    if (view.session.index < view.session.queue.length - 1) {
      view.session.index += 1;
      view.showAnswer = false;
      view.render();
      return;
    }

    view.session.index = view.session.queue.length;
    view.showAnswer = true;
    view.render();
    return;
  }

  if (card) {
    const id = String(card.id);
    if (!view.session.graded[id]) {
      // Auto-grade unanswered as AGAIN
      await gradeCurrentRating(view, "again", { auto: true, via: "next" });
    }
  }

  if (view.session.index < view.session.queue.length - 1) {
    view.session.index += 1;
    const next = currentCard(view);
    view.showAnswer = !!(next && view.session.graded[String(next.id)]);
    view.render();
    return;
  }

  view.session.index = view.session.queue.length;
  view.showAnswer = true;
  view.render();
}

/* ------------------------------------------------------------------ */
/*  Inline card editing                                                */
/* ------------------------------------------------------------------ */

export function openEditModalForCurrentCard(view: any): void {
  const card = currentCard(view);
  if (!card || !view.session) return;

  const cardType = String(card.type || "").toLowerCase();

  // Skip IO cards – they have their own editor
  if (["io", "io-child"].includes(cardType)) return;

  // If this is a cloze child, edit the parent cloze instead so changes persist
  let targetCard = card;
  if (cardType === "cloze-child") {
    const parentId = String((card).parentId || "");
    if (!parentId) {
      new Notice("Cannot edit cloze child: missing parent card.");
      return;
    }

    const parentCard = (view.plugin.store.data.cards || {})[parentId];
    if (!parentCard) {
      new Notice("Cannot edit cloze child: parent card not found.");
      return;
    }

    targetCard = parentCard;
  }

  void openBulkEditModalForCards(view.plugin, [targetCard], async (updatedCards: any[]) => {
    if (!updatedCards.length) return;

    try {
      const updatedCard = updatedCards[0];

      // Update the card in the session if it exists
      if (view.session) {
        if (cardType !== "cloze-child") {
          view.session.queue[view.session.index] = updatedCard;
        }
      }

      // Write the card back to markdown
      const file = view.app.vault.getAbstractFileByPath(updatedCard.sourceNotePath);
      if (!(file instanceof TFile)) throw new Error(`Source note not found: ${updatedCard.sourceNotePath}`);

      const text = await view.app.vault.read(file);
      const lines = text.split(/\r?\n/);

      const { start, end } = findCardBlockRangeById(lines, updatedCard.id);
      const block = buildCardBlockMarkdown(updatedCard.id, updatedCard);
      lines.splice(start, end - start, ...block);

      await view.app.vault.modify(file, lines.join("\n"));

      // Sync the file to update store
      const res = await syncOneFile(view.plugin, file);

      if (res.quarantinedCount > 0) {
        new Notice(`Saved changes to flashcard (but ${res.quarantinedCount} card(s) quarantined).`);
      } else {
        new Notice("Saved changes to flashcard");
      }

      // If we edited a cloze parent, refresh the current child from the store
      if (view.session && cardType === "cloze-child") {
        const refreshed = (view.plugin.store.data.cards || {})[String(card.id)];
        if (refreshed) view.session.queue[view.session.index] = refreshed;
      }

      view.render();
    } catch (e: any) {
      new Notice(`Error saving card: ${e.message || String(e)}`);
    }
  });
}
