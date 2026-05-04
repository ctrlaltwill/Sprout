/**
 * @file src/views/study-assistant/popup/assistant-popup-suggestion-rows.ts
 * @summary Module for assistant popup suggestion rows.
 *
 * @exports
 *  - GeneratorOutputOptions
 *  - ParsedSuggestionRows
 *  - parseSuggestionRows
 *  - normalizeOptionalGeneratorRows
 *  - buildSuggestionMarkdownLines
 *  - rewriteIoNoteRows
 */

import { pushDelimitedField } from "../../../platform/core/delimiter";
import type { StudyAssistantSuggestion } from "../../../platform/integrations/ai/study-assistant-types";
import { normalizeGroups } from "../../../engine/indexing/group-format";
import { trimLine, trimList } from "./assistant-popup-text";

export type GeneratorOutputOptions = {
  includeTitle: boolean;
  includeInfo: boolean;
  includeGroups: boolean;
};

export type ParsedSuggestionRows = {
  question: string;
  answer: string;
  clozeText: string;
  options: string[];
  correctOptionIndexes: number[];
  steps: string[];
  ioSrc: string;
};

export function parseSuggestionRows(suggestion: StudyAssistantSuggestion): ParsedSuggestionRows {
  const out: ParsedSuggestionRows = {
    question: trimLine(suggestion.question),
    answer: trimLine(suggestion.answer),
    clozeText: trimLine(suggestion.clozeText),
    options: trimList(Array.isArray(suggestion.options) ? suggestion.options : []),
    correctOptionIndexes: Array.isArray(suggestion.correctOptionIndexes)
      ? suggestion.correctOptionIndexes.filter((n) => Number.isFinite(n)).map((n) => Math.max(0, Math.floor(n)))
      : [],
    steps: trimList(Array.isArray(suggestion.steps) ? suggestion.steps : []),
    ioSrc: trimLine(suggestion.ioSrc),
  };
  const noteRows = Array.isArray(suggestion.noteRows) ? suggestion.noteRows : [];
  if (!noteRows.length) return out;

  if (suggestion.type === "mcq") {
    out.options = [];
    out.correctOptionIndexes = [];
  }
  if (suggestion.type === "oq") {
    out.steps = [];
  }

  for (const row of noteRows) {
    const m = String(row ?? "").match(/^\s*([^|]+?)\s*\|\s*(.*?)\s*(?:\|\s*)?$/);
    if (!m) continue;
    const key = String(m[1] || "").trim().toUpperCase();
    const value = trimLine(m[2]);
    if (!value) continue;
    if (suggestion.type === "basic" || suggestion.type === "reversed") {
      if ((key === "Q" || key === "RQ") && !out.question) out.question = value;
      if (key === "A" && !out.answer) out.answer = value;
    } else if (suggestion.type === "cloze") {
      if (key === "CQ" && !out.clozeText) out.clozeText = value;
    } else if (suggestion.type === "mcq") {
      if (key === "MCQ" && !out.question) {
        out.question = value;
        continue;
      }
      if (key === "O" || key === "A") {
        out.options.push(value);
        if (key === "A") out.correctOptionIndexes.push(out.options.length - 1);
      }
    } else if (suggestion.type === "oq") {
      if (key === "OQ" && !out.question) {
        out.question = value;
        continue;
      }
      if (/^\d{1,2}$/.test(key)) {
        const idx = Math.max(0, Number(key) - 1);
        while (out.steps.length <= idx) out.steps.push("");
        out.steps[idx] = value;
      }
    } else if (suggestion.type === "io") {
      if (key === "IO" && !out.ioSrc) out.ioSrc = value;
    }
  }

  out.steps = out.steps.map((step) => trimLine(step)).filter(Boolean);
  return out;
}

export function normalizeOptionalGeneratorRows(
  suggestion: StudyAssistantSuggestion,
  explicitRows: string[],
  options: GeneratorOutputOptions,
): string[] {
  const coreRows: string[] = [];
  let titleFromRows = "";
  let infoFromRows = "";
  let groupsFromRows: string[] = [];

  for (const row of explicitRows) {
    const m = String(row || "").match(/^\s*([^|]+?)\s*\|\s*(.*?)\s*(?:\|\s*)?$/);
    if (!m) {
      coreRows.push(row);
      continue;
    }
    const key = String(m[1] || "").trim().toUpperCase();
    const value = trimLine(m[2]);
    if (!value) {
      if (key !== "T" && key !== "I" && key !== "G") coreRows.push(row);
      continue;
    }
    if (key === "T") {
      if (!titleFromRows) titleFromRows = value;
      continue;
    }
    if (key === "I") {
      if (!infoFromRows) infoFromRows = value;
      continue;
    }
    if (key === "G") {
      if (!groupsFromRows.length) {
        groupsFromRows = value.split(",").map((item) => trimLine(item)).filter(Boolean);
      }
      continue;
    }
    coreRows.push(row);
  }

  const title = trimLine(suggestion.title || titleFromRows);
  const info = trimLine(suggestion.info || infoFromRows);
  const groups = normalizeGroups(trimList(
    (Array.isArray(suggestion.groups) && suggestion.groups.length ? suggestion.groups : groupsFromRows)
      .map((item) => trimLine(item)),
  ));

  const out: string[] = [];
  if (options.includeTitle && title) pushDelimitedField(out, "T", title);
  out.push(...coreRows);
  if (options.includeInfo && info) pushDelimitedField(out, "I", info);
  if (options.includeGroups && groups.length) pushDelimitedField(out, "G", groups.join(", "));
  return out;
}

export function buildSuggestionMarkdownLines(
  suggestion: StudyAssistantSuggestion,
  options: GeneratorOutputOptions,
): string[] {
  const explicitRows = Array.isArray(suggestion.noteRows)
    ? suggestion.noteRows.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  if (explicitRows.length) return [...normalizeOptionalGeneratorRows(suggestion, explicitRows, options), ""];

  const lines: string[] = [];
  const title = String(suggestion.title || "").trim();
  if (title && options.includeTitle) {
    pushDelimitedField(lines, "T", title);
  }
  if (suggestion.type === "basic") {
    pushDelimitedField(lines, "Q", String(suggestion.question || "").trim());
    pushDelimitedField(lines, "A", String(suggestion.answer || "").trim());
  } else if (suggestion.type === "reversed") {
    pushDelimitedField(lines, "RQ", String(suggestion.question || "").trim());
    pushDelimitedField(lines, "A", String(suggestion.answer || "").trim());
  } else if (suggestion.type === "cloze") {
    pushDelimitedField(lines, "CQ", String(suggestion.clozeText || "").trim());
  } else if (suggestion.type === "mcq") {
    pushDelimitedField(lines, "MCQ", String(suggestion.question || "").trim());
    const optionValues = Array.isArray(suggestion.options) ? suggestion.options : [];
    const correct = new Set(Array.isArray(suggestion.correctOptionIndexes) ? suggestion.correctOptionIndexes : []);
    optionValues.forEach((opt, idx) => {
      const clean = String(opt || "").trim();
      if (!clean) return;
      pushDelimitedField(lines, correct.has(idx) ? "A" : "O", clean);
    });
  } else if (suggestion.type === "oq") {
    pushDelimitedField(lines, "OQ", String(suggestion.question || "").trim());
    const steps = Array.isArray(suggestion.steps) ? suggestion.steps : [];
    steps.forEach((step, idx) => {
      const clean = String(step || "").trim();
      if (!clean) return;
      pushDelimitedField(lines, String(idx + 1), clean);
    });
  } else if (suggestion.type === "io") {
    const ioSrc = String(suggestion.ioSrc || "").trim();
    if (ioSrc) pushDelimitedField(lines, "IO", ioSrc);
    const ioOcclusions = Array.isArray(suggestion.ioOcclusions) ? suggestion.ioOcclusions : [];
    if (ioOcclusions.length) {
      pushDelimitedField(lines, "O", JSON.stringify(ioOcclusions));
    }
    const ioMaskMode = suggestion.ioMaskMode === "solo" || suggestion.ioMaskMode === "all"
      ? suggestion.ioMaskMode
      : null;
    if (ioMaskMode) pushDelimitedField(lines, "C", ioMaskMode);
  } else if (suggestion.type === "combo") {
    const qVariants: string[] = Array.isArray(suggestion.qVariants) ? suggestion.qVariants : [];
    const aVariants: string[] = Array.isArray(suggestion.aVariants) ? suggestion.aVariants : [];
    const comboMode = suggestion.comboMode === "zip" ? "zip" : "product";
    const sep = comboMode === "zip" ? " ::: " : " :: ";
    const qRaw = String(suggestion.question || "").trim();
    const aRaw = String(suggestion.answer || "").trim();
    // Prefer qVariants/aVariants arrays; fall back to question/answer fields
    const qParts = qVariants.length > 0 ? qVariants : (qRaw ? qRaw.split(/\s*:{2,3}\s*/).filter(Boolean) : []);
    const aParts = aVariants.length > 0 ? aVariants : (aRaw ? aRaw.split(/\s*:{2,3}\s*/).filter(Boolean) : []);
    if (qParts.length > 0 && aParts.length > 0) {
      pushDelimitedField(lines, "Q", qParts.join(sep));
      pushDelimitedField(lines, "A", aParts.join(sep));
    }
  }
  const info = String(suggestion.info || "").trim();
  if (info && options.includeInfo) {
    pushDelimitedField(lines, "I", info);
  }
  if (options.includeGroups) {
    const groups = normalizeGroups(suggestion.groups);
    if (groups.length) pushDelimitedField(lines, "G", groups.join(", "));
  }
  lines.push("");
  return lines;
}

export function rewriteIoNoteRows(noteRows: string[], ioSrc: string): string[] {
  return noteRows.map((row) => {
    const raw = String(row ?? "");
    const m = raw.match(/^(\s*([^|]+?)\s*\|\s*)(.*?)(\s*(?:\|\s*)?)$/);
    if (!m) return raw;
    const key = trimLine(m[2]).toUpperCase();
    if (key !== "IO") return raw;
    return `${m[1]}${ioSrc}${m[4]}`;
  });
}
