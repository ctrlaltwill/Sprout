// src/reviewer/cardFields.ts
import type { CardRecord } from "../core/store";

export function escapePipes(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Split on implied option delimiter: unescaped pipes.
 * A literal pipe inside an option can be written as \|
 * A literal backslash can be written as \\ (standard escape behaviour).
 */
export function splitUnescapedPipes(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === "|") {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

export function parseMcqOptionsFromCell(raw: string): { options: string[]; correctIndex: number } {
  const cleaned = (raw || "").replace(/\r?\n/g, " ").trim();
  if (!cleaned) throw new Error("MCQ options cannot be empty.");

  const parts = cleaned.includes("|")
    ? splitUnescapedPipes(cleaned)
        .map((x) => x.trim())
        .filter(Boolean)
    : cleaned
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  if (parts.length < 2) throw new Error("MCQ requires at least 2 options (separate with |).");

  let correctIndex = -1;

  const options = parts.map((p, idx) => {
    const m = p.match(/^\*\*(.+)\*\*$/);
    if (m) {
      if (correctIndex !== -1) throw new Error("MCQ has more than one bold (correct) option.");
      correctIndex = idx;
      return m[1].trim();
    }
    return p;
  });

  if (correctIndex === -1)
    throw new Error("MCQ requires exactly one correct option wrapped in ** **.");

  return { options, correctIndex };
}

export function validateClozeText(text: string) {
  const t = (text || "").trim();
  if (!t) throw new Error("Cloze question (CQ) is required.");
  if (!/\{\{c\d+::.*?\}\}/.test(t))
    throw new Error("Cloze must include at least one {{cN::...}} token.");
}

export function buildQuestionFor(card: CardRecord): string {
  if (card.type === "basic") return card.q || "";
  if (card.type === "mcq") return card.stem || "";
  return card.clozeText || "";
}

export function buildAnswerOrOptionsFor(card: CardRecord): string {
  if (card.type === "basic") return card.a || "";

  if (card.type === "mcq") {
    const options = Array.isArray(card.options) ? card.options : [];
    const correct = Number.isFinite(card.correctIndex) ? (card.correctIndex as number) : -1;

    const rendered = options.map((opt, idx) => {
      const t = escapePipes((opt || "").trim());
      return idx === correct ? `**${t}**` : t;
    });

    return rendered.join(" | ");
  }

  return ""; // cloze: blank
}
