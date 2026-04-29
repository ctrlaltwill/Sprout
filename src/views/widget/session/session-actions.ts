/**
 * @file src/widget/widget-session-actions.ts
 * @summary Session-level actions for the Sprout sidebar widget: grading, undo, bury, suspend, MCQ answering, next-card navigation, and inline editing. Every function receives the view instance as its first argument so the module stays decoupled from the class definition, avoiding circular imports.
 *
 * @exports
 *  - gradeCurrentRating          — grades the current card with a specific FSRS rating
 *  - canUndo                     — returns whether the last grade can be undone
 *  - undoLastGrade               — reverts the most recent grade and restores the previous card state
 *  - buryCurrentCard             — buries the current card until the next day
 *  - suspendCurrentCard          — suspends the current card indefinitely
 *  - answerMcq                   — processes an MCQ option selection and auto-grades if correct/wrong
 *  - nextCard                    — advances to the next card in the review queue
 *  - openEditModalForCurrentCard — opens the bulk-edit modal pre-filled with the current card's data
 */

import { TFile, Notice } from "obsidian";
import { gradeCard } from "../../../platform/services/grading-service";
import { undoGrade } from "../../../platform/services/undo-service";
import { buryCardAction, suspendCardAction } from "../../../platform/services/card-action-service";
import { deepClone, clampInt } from "../../reviewer/utilities";
import { openBulkEditModalForCards } from "../../../platform/modals/bulk-edit";
import { ImageOcclusionCreatorModal } from "../../../platform/modals/image-occlusion-creator-modal";
import { findCardBlockRangeById, buildCardBlockMarkdown } from "../../reviewer/markdown-block";
import { syncOneFile } from "../../../platform/integrations/sync/sync-engine";

import type { UndoFrame, WidgetViewLike, ReviewMeta } from "../core/widget-helpers";
import type { CardRecord } from "../../../platform/types/card";
import { getCorrectIndices, isMultiAnswerMcq } from "../../../platform/types/card";
import type LearnKitPlugin from "../../../main";
import { t } from "../../../platform/translations/translator";

const tx = (view: WidgetViewLike, token: string, fallback: string, vars?: Record<string, string | number>) =>
  t(view.plugin.settings?.general?.interfaceLanguage, token, fallback, vars);

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function currentCard(view: WidgetViewLike): CardRecord | null {
  if (!view.session) return null;
  return view.session.queue[view.session.index] || null;
}

function computeMsToAnswer(view: WidgetViewLike, now: number, id: string): number | undefined {
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
  view: WidgetViewLike,
  rating: "again" | "hard" | "good" | "easy",
  meta: ReviewMeta | null,
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

  const UNDO_MAX = 3;
  view._undoStack.push({
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
  } as UndoFrame);
  if (view._undoStack.length > UNDO_MAX)
    view._undoStack.splice(0, view._undoStack.length - UNDO_MAX);

  await gradeCard({
    id,
    cardType: String(card.type || "unknown"),
    rating,
    now,
    prevState: st,
    settings: view.plugin.settings,
    store,
    msToAnswer,
    meta: meta || undefined,
  });

  view.session.graded[id] = { rating, at: now, meta: meta || null };
  view.session.stats.done = Object.keys(view.session.graded).length;
  view.showAnswer = true;
}

/* ------------------------------------------------------------------ */
/*  Undo                                                               */
/* ------------------------------------------------------------------ */

export function canUndo(view: WidgetViewLike): boolean {
  if (view.mode !== "session" || !view.session) return false;
  if (view.session.mode === "practice") return false;
  const u = view._undoStack[view._undoStack.length - 1];
  if (!u) return false;
  if (u.sessionStamp !== view._sessionStamp) return false;
  return !!view.session.graded?.[u.id];
}

export async function undoLastGrade(view: WidgetViewLike): Promise<void> {
  if (view.mode !== "session" || !view.session) return;
  const u = view._undoStack[view._undoStack.length - 1];
  if (!u) return;
  if (u.sessionStamp !== view._sessionStamp) {
    view._undoStack.length = 0;
    view.render();
    return;
  }
  if (!view.session.graded?.[u.id]) {
    view._undoStack.length = 0;
    view.render();
    return;
  }

  view._undoStack.pop();

  try {
    await undoGrade({
      id: u.id,
      prevState: u.prevState,
      reviewLogLenBefore: u.reviewLogLenBefore,
      analyticsLenBefore: u.analyticsLenBefore,
      storeMutated: true,
      analyticsMutated: true,
      store: view.plugin.store,
    });

    delete view.session.graded[u.id];
    view.session.stats.done = Object.keys(view.session.graded || {}).length;

    const maxIdx = Math.max(0, Number(view.session.queue?.length ?? 0));
    view.session.index = clampInt(u.sessionIndex, 0, maxIdx);
    view.showAnswer = false;

    view.render();
  } catch {
    new Notice(tx(view, "ui.widget.notice.undoFailed", "Undo failed."));
    view.render();
  }
}

/* ------------------------------------------------------------------ */
/*  Bury / Suspend                                                     */
/* ------------------------------------------------------------------ */

export async function buryCurrentCard(view: WidgetViewLike): Promise<void> {
  if (view.mode !== "session" || !view.session) return;
  if (view.session.mode === "practice") return;
  const card = currentCard(view);
  if (!card) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const st = view.plugin.store.getState(id);
  if (!st) return;

  const now = Date.now();
  await buryCardAction({ id, prevState: st, now, store: view.plugin.store });

  view.session.graded[id] = { rating: "again", at: now, meta: { action: "bury" } };
  view.session.stats.done = Object.keys(view.session.graded).length;
  view.showAnswer = false;
  await nextCard(view);
}

export async function suspendCurrentCard(view: WidgetViewLike): Promise<void> {
  if (view.mode !== "session" || !view.session) return;
  if (view.session.mode === "practice") return;
  const card = currentCard(view);
  if (!card) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const st = view.plugin.store.getState(id);
  if (!st) return;

  const now = Date.now();
  await suspendCardAction({ id, prevState: st, now, store: view.plugin.store });

  view.session.graded[id] = { rating: "again", at: now, meta: { action: "suspend" } };
  view.session.stats.done = Object.keys(view.session.graded).length;
  view.showAnswer = false;
  await nextCard(view);
}

/* ------------------------------------------------------------------ */
/*  MCQ answering                                                      */
/* ------------------------------------------------------------------ */

export async function answerMcq(view: WidgetViewLike, choiceIdx: number): Promise<void> {
  const card = currentCard(view);
  if (!card || card.type !== "mcq" || !view.session) return;
  // Multi-answer MCQs use answerMcqMulti instead
  if (isMultiAnswerMcq(card)) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const pass = choiceIdx === card.correctIndex;

  if (view.session.mode === "practice") {
    view.session.graded[id] = {
      rating: pass ? "good" : "again",
      at: Date.now(),
      meta: { mcqChoice: choiceIdx, mcqCorrect: card.correctIndex ?? undefined, practice: true },
    };
    view.session.stats.done = Object.keys(view.session.graded).length;
    view.showAnswer = true;
    view.render();
    return;
  }

  // MCQ maps to Good / Again internally.
  await gradeCurrentRating(view, pass ? "good" : "again", {
    mcqChoice: choiceIdx,
    mcqCorrect: card.correctIndex ?? undefined,
  });
  view.render();
}

/**
 * Grade a multi-answer MCQ: all-or-nothing set comparison.
 * All correct indices selected and no wrong ones → good, otherwise → again.
 */
export async function answerMcqMulti(view: WidgetViewLike, selectedIndices: number[]): Promise<void> {
  const card = currentCard(view);
  if (!card || card.type !== "mcq" || !view.session) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const correctSet = new Set(getCorrectIndices(card));
  const chosenSet = new Set(selectedIndices);
  const pass = correctSet.size === chosenSet.size && [...correctSet].every((i) => chosenSet.has(i));

  const meta: Record<string, unknown> = {
    mcqChoices: [...chosenSet].sort(),
    mcqCorrectIndices: [...correctSet].sort(),
    mcqPass: pass,
  };

  if (view.session.mode === "practice") {
    view.session.graded[id] = {
      rating: pass ? "good" : "again",
      at: Date.now(),
      meta: { ...meta, practice: true } as ReviewMeta,
    };
    view.session.stats.done = Object.keys(view.session.graded).length;
    view.showAnswer = true;
    view.render();
    return;
  }

  await gradeCurrentRating(view, pass ? "good" : "again", meta as ReviewMeta);
  view.render();
}

/* ------------------------------------------------------------------ */
/*  Answer OQ (Ordering Question)                                      */
/* ------------------------------------------------------------------ */

export async function answerOq(view: WidgetViewLike, userOrder: number[]): Promise<void> {
  const card = currentCard(view);
  if (!card || card.type !== "oq" || !view.session) return;

  const id = String(card.id);
  if (view.session.graded[id]) return;

  const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
  const correctOrder = Array.from({ length: steps.length }, (_, i) => i);
  const pass = userOrder.length === correctOrder.length &&
    userOrder.every((v, i) => v === correctOrder[i]);

  if (view.session.mode === "practice") {
    view.session.graded[id] = {
      rating: pass ? "good" : "again",
      at: Date.now(),
      meta: { oqUserOrder: userOrder, oqPass: pass, practice: true },
    };
    view.session.stats.done = Object.keys(view.session.graded).length;
    view.showAnswer = true;
    view.render();
    return;
  }

  await gradeCurrentRating(view, pass ? "good" : "again", {
    oqUserOrder: userOrder,
    oqPass: pass,
  });
  view.showAnswer = true;
  view.render();
}

/* ------------------------------------------------------------------ */
/*  Next card                                                          */
/* ------------------------------------------------------------------ */

export async function nextCard(view: WidgetViewLike): Promise<void> {
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

export function openEditModalForCurrentCard(view: WidgetViewLike): void {
  const card = currentCard(view);
  if (!card || !view.session) return;

  const cardType = String(card.type || "").toLowerCase();

  // IO cards use the same creator/editor modal as reading view.
  if (["io", "io-child", "hq", "hq-child"].includes(cardType)) {
    const parentId = cardType === "io" || cardType === "hq" ? String(card.id || "") : String(card.parentId || "");
    if (!parentId) {
      new Notice(tx(view, "ui.widget.notice.editMissingParent", "Cannot edit {cardType} - missing parent card", { cardType }));
      return;
    }

    ImageOcclusionCreatorModal.openForParent(view.plugin as unknown as LearnKitPlugin, parentId, {
      onClose: () => {
        view.render();
      },
    });
    return;
  }

  // If this is a cloze child or reversed child, edit the parent instead so changes persist
  let targetCard = card;
  if (cardType === "cloze-child" || cardType === "reversed-child") {
    const parentId = String((card).parentId || "");
    if (!parentId) {
      new Notice(tx(view, "ui.widget.notice.editMissingParent", "Cannot edit {cardType} - missing parent card", { cardType }));
      return;
    }

    const parentCard = (view.plugin.store.data.cards || {})[parentId];
    if (!parentCard) {
      new Notice(tx(view, "ui.widget.notice.editParentNotFound", "Cannot edit {cardType} - parent card not found", { cardType }));
      return;
    }

    targetCard = parentCard;
  }

  void openBulkEditModalForCards(view.plugin as unknown as LearnKitPlugin, [targetCard], async (updatedCards: CardRecord[]) => {
    if (!updatedCards.length) return;

    try {
      const updatedCard = updatedCards[0];

      // Update the card in the session if it exists
      if (view.session) {
        if (cardType !== "cloze-child" && cardType !== "reversed-child") {
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
      await syncOneFile(view.plugin as unknown as LearnKitPlugin, file, { pruneGlobalOrphans: false });
      new Notice(tx(view, "ui.widget.notice.saved", "Saved changes to flashcard"));

      if (view.session) {
        const refreshId = cardType === "cloze-child" || cardType === "reversed-child"
          ? String(card.id)
          : String(updatedCard.id);
        const refreshed = (view.plugin.store.data.cards || {})[refreshId];
        if (refreshed) view.session.queue[view.session.index] = refreshed;
      }

      view.render();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(tx(view, "ui.widget.notice.saveFailed", "Error saving card - {error}", { error: msg }));
    }
  });
}
