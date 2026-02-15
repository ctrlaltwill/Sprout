/**
 * @file src/reviewer/fields.ts
 * @summary Utilities for parsing, validating, and serialising card field content. Handles MCQ option parsing (with pipe and bold-correct conventions), cloze text validation, and building question/answer strings from card records.
 *
 * @exports
 *   - escapePipes — Escapes pipe and backslash characters in a string for safe pipe-delimited output
 *   - splitUnescapedPipes — Splits a string on unescaped pipe characters, respecting backslash escapes
 *   - parseMcqOptionsFromCell — Parses raw MCQ option text into an options array and correct-answer index
 *   - validateClozeText — Validates that cloze text is non-empty and contains at least one {{cN::...}} token
 *   - buildQuestionFor — Returns the question/stem/cloze text for a card based on its type
 *   - buildAnswerOrOptionsFor — Returns the answer or serialised MCQ options string for a card
 */

import type { CardRecord } from "../core/store";
import { normalizeCardOptions } from "../core/store";
import { getCorrectIndices } from "../types/card";
import {
  escapeDelimiterText,
  splitUnescapedDelimiters,
  getDelimiter,
} from "../core/delimiter";

export function escapePipes(s: string): string {
  return escapeDelimiterText(s);
}

/**
 * Split on implied option delimiter: unescaped delimiters.
 * A literal delimiter inside an option can be written as \<delim>
 * A literal backslash can be written as \\ (standard escape behaviour).
 */
export function splitUnescapedPipes(s: string): string[] {
  return splitUnescapedDelimiters(s);
}

export function parseMcqOptionsFromCell(raw: string): { options: string[]; correctIndex: number; correctIndices: number[] } {
  const cleaned = (raw || "").replace(/\r?\n/g, " ").trim();
  if (!cleaned) throw new Error("MCQ options cannot be empty.");

  const parts = cleaned.includes(getDelimiter())
    ? splitUnescapedPipes(cleaned)
        .map((x) => x.trim())
        .filter(Boolean)
    : cleaned
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  if (parts.length < 2) throw new Error(`MCQ requires at least 2 options (separate with ${getDelimiter()}).`);

  const correctIndices: number[] = [];

  const options = parts.map((p, idx) => {
    const m = p.match(/^\*\*(.+)\*\*$/);
    if (m) {
      correctIndices.push(idx);
      return m[1].trim();
    }
    return p;
  });

  if (correctIndices.length === 0)
    throw new Error("MCQ requires at least one correct option wrapped in ** **.");

  return { options, correctIndex: correctIndices[0], correctIndices };
}

export function validateClozeText(text: string) {
  const t = (text || "").trim();
  if (!t) throw new Error("Cloze question (CQ) is required.");
  if (!/\{\{c\d+::[\s\S]*?\}\}/.test(t))
    throw new Error("Cloze must include at least one {{cN::...}} token.");
}

export function buildQuestionFor(card: CardRecord): string {
  if (card.type === "basic") return card.q || "";
  if (card.type === "reversed") return card.a || "";
  if (card.type === "reversed-child") {
    return (card as unknown).reversedDirection === "back" ? (card.a || "") : (card.q || "");
  }
  if (card.type === "mcq") return card.stem || "";
  if (card.type === "oq") return card.q || "";
  return card.clozeText || "";
}

export function buildAnswerOrOptionsFor(card: CardRecord): string {
  if (card.type === "basic") return card.a || "";
  if (card.type === "reversed") return card.q || "";
  if (card.type === "reversed-child") {
    return (card as unknown).reversedDirection === "back" ? (card.q || "") : (card.a || "");
  }

  if (card.type === "mcq") {
    const options = normalizeCardOptions(card.options);
    const correctSet = new Set(getCorrectIndices(card));

    const rendered = options.map((opt, idx) => {
      const t = escapePipes((opt || "").trim());
      return correctSet.has(idx) ? `**${t}**` : t;
    });

    return rendered.join(` ${getDelimiter()} `);
  }

  if (card.type === "oq") {
    const steps = Array.isArray(card.oqSteps) ? card.oqSteps : [];
    return steps.map((s, i) => `${i + 1}. ${(s || "").trim()}`).join(` ${getDelimiter()} `);
  }

  return ""; // cloze: blank
}
