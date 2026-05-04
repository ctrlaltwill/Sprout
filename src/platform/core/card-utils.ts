/**
 * @file src/core/card-utils.ts
 * @summary Centralised parent-card detection utilities. Parent cards (cloze,
 * reversed, IO parents, and combo) are container cards whose children are the ones
 * actually studied. These helpers are used throughout the codebase to exclude
 * parent cards from due counts, analytics, and review queues.
 *
 * @exports
 *   - ioChildKeyFromId     — extracts the IO child key from a card ID string
 *   - cardHasIoChildKey    — checks whether a card record has an IO child key
 *   - isIoParentCard       — detects IO parent cards
 *   - isClozeParentCard    — detects cloze parent cards
 *   - isComboParentCard    — detects combo parent cards
 *   - isComboChild         — detects combo child cards
 *   - comboChildKeyFromId  — extracts the combo child key from a card ID
 *   - isParentCard         — master check: returns true for any non-reviewable parent card
 */

import type { CardRecord } from "../types/card";
import { splitComboVariants } from "./delimiter";

/** Extract the IO child key from a card ID string (e.g. `"…::io::mask1"` → `"mask1"`). */
export function ioChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::io::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k || null;
}

export function hqChildKeyFromId(id: string): string | null {
  const m = String(id ?? "").match(/::hq::(.+)$/);
  if (!m) return null;
  const k = String(m[1] ?? "").trim();
  return k || null;
}

/** Returns `true` if the card has an IO child key (groupKey field or `::io::` suffix in ID). */
export function cardHasIoChildKey(card: CardRecord): boolean {
  if (!card) return false;
  if (typeof card.groupKey === "string" && card.groupKey.trim()) return true;
  return !!ioChildKeyFromId(String(card.id ?? ""));
}

export function cardHasHqChildKey(card: CardRecord): boolean {
  if (!card) return false;
  if (String(card.type ?? "") === "hq-child" && typeof card.groupKey === "string" && card.groupKey.trim()) return true;
  return !!hqChildKeyFromId(String(card.id ?? ""));
}

/** Returns `true` if the card is an IO *parent* (not a child). */
export function isIoParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "io-parent" || t === "io_parent" || t === "ioparent") return true;
  if (t === "io") return !cardHasIoChildKey(card);
  return false;
}

export function isHqParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "hq-parent" || t === "hq_parent" || t === "hqparent") return true;
  if (t === "hq") return !cardHasHqChildKey(card);
  return false;
}

/** Returns `true` if the card is a cloze parent with child deletions. */
export function isClozeParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t !== "cloze") return false;
  const children = card?.clozeChildren;
  return Array.isArray(children) && children.length > 0;
}

// ── Combo card helpers ──────────────────────────────────────────────────

/** Combo child-id prefix used in deterministic ID generation. */
const COMBO_CHILD_PREFIX = "::combo::";

/** Extract the combo child key from a card ID string (e.g. `"…::combo::q1::a1"`). */
export function comboChildKeyFromId(id: string): string | null {
  const idx = String(id ?? "").indexOf(COMBO_CHILD_PREFIX);
  if (idx < 0) return null;
  return String(id).slice(idx + COMBO_CHILD_PREFIX.length) || null;
}

/** Returns `true` if the card is a combo parent (container for Q×A children). */
export function isComboParentCard(card: CardRecord): boolean {
  const type = String(card?.type ?? "").toLowerCase();
  if (type === "combo") return true;
  if (type !== "basic") return false;
  // Basic card with extensionData containing qVariants/aVariants is a combo parent
  const ext = card?.extensionData;
  if (ext && typeof ext === "object" && !Array.isArray(ext)) {
    const ed = ext;
    const qv = ed.qVariants;
    const av = ed.aVariants;
    if ((Array.isArray(qv) && qv.length > 1) || (Array.isArray(av) && av.length > 1)) return true;
  }
  // Fallback: check raw Q/A fields for :: separator (handles cards synced before
  // the parser started auto-detecting :: and storing extensionData).
  const qRaw = String(card?.q ?? "").trim();
  const aRaw = String(card?.a ?? "").trim();
  return splitComboVariants(qRaw).length > 1 || splitComboVariants(aRaw).length > 1;
}

/** Returns `true` if the card is a combo child (generated from a combo parent). */
export function isComboChild(card: CardRecord): boolean {
  return String(card?.type ?? "").toLowerCase() === "combo-child";
}

/** Returns `true` if the card is a reversed child. */
export function isReversedChild(card: CardRecord): boolean {
  return String(card?.type ?? "").toLowerCase() === "reversed-child";
}

/** Returns `true` if the card is a cloze child. */
export function isClozeChild(card: CardRecord): boolean {
  return String(card?.type ?? "").toLowerCase() === "cloze-child";
}

/**
 * Returns `true` if the card is a text-based child type
 * (cloze-child, reversed-child, or combo-child).
 *
 * These child types share the same edit routing: editing a child
 * redirects to the parent so changes persist to the source note.
 * IO/HQ children have their own separate edit flows.
 */
export function isTextBasedChildCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "cloze-child" || t === "reversed-child" || t === "combo-child";
}

/**
 * Returns `true` if the card is any known child card type
 * (cloze-child, reversed-child, combo-child, io-child, hq-child).
 */
export function isAnyChildCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  return t === "cloze-child" || t === "reversed-child" || t === "combo-child" || t === "io-child" || t === "hq-child";
}

/**
 * Returns `true` if the card is any kind of parent card (cloze parent,
 * IO parent, reversed parent, or combo parent). Parent cards are not
 * studied directly — only their children are — so they should be excluded
 * from due counts, analytics, and review queues.
 */
export function isParentCard(card: CardRecord): boolean {
  const t = String(card?.type ?? "").toLowerCase();
  if (t === "cloze" || t === "reversed") return true;
  return isIoParentCard(card) || isHqParentCard(card) || isClozeParentCard(card) || isComboParentCard(card);
}
