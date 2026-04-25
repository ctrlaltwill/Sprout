import { parseClozeTokens, processClozeForMath, resolveNestedClozeAnswers } from "../../platform/core/shared-utils";
import { escapeHtml, processMarkdownFeatures } from "./reading-helpers";

function stripInlineMarkdownMarkers(text: string): string {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function computeReadingViewClozeWidthPx(content: string): number {
  const plainContent = stripInlineMarkdownMarkers(content || "");
  const widthUnits = Math.max(4, Math.min(40, plainContent.length || 6));
  return Math.max(30, (widthUnits * 8) - 20);
}

function buildReadingViewHintHtml(answer: string, hint: string): string {
  const widthPx = computeReadingViewClozeWidthPx(answer || hint);
  return `<span class="learnkit-cloze-hint" style="width:${widthPx}px">${escapeHtml(stripInlineMarkdownMarkers(hint))}</span>`;
}

function renderMarkdownTextWithExplicitBreaks(value: string): string {
  return String(value ?? "")
    .split("\n")
    .map((segment) => processMarkdownFeatures(segment))
    .join("<br>");
}

function renderNestedReadingViewClozeHtml(answer: string): string {
  const source = String(answer ?? "").trim();
  if (!source) return "";

  const clozeMatches = parseClozeTokens(source).tokens;
  if (!clozeMatches.length) {
    return renderMarkdownTextWithExplicitBreaks(source);
  }

  let out = "";
  let last = 0;

  for (const match of clozeMatches) {
    if (match.start > last) {
      out += renderMarkdownTextWithExplicitBreaks(source.slice(last, match.start));
    }

    const nestedHtml = renderNestedReadingViewClozeHtml(match.answer);
    out += nestedHtml
      ? `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${nestedHtml}</span></span>`
      : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    last = match.end;
  }

  if (last < source.length) {
    out += renderMarkdownTextWithExplicitBreaks(source.slice(last));
  }

  return out;
}

export function buildReadingFlashcardCloze(text: string, mode: "front" | "back"): string {
  const source = String(text || "");
  if (source.includes("$") || source.includes("\\(") || source.includes("\\[")) {
    const reveal = mode === "back";
    return processMarkdownFeatures(
      processClozeForMath(source, reveal, null, { blankClassName: "learnkit-flashcard-blank" }),
    );
  }

  const clozeMatches = parseClozeTokens(source).tokens;
  let out = "";
  let last = 0;

  for (const match of clozeMatches) {
    if (match.start > last) {
      out += renderMarkdownTextWithExplicitBreaks(source.slice(last, match.start));
    }

    const resolvedAnswer = resolveNestedClozeAnswers(match.answer).trim();
    const hint = match.hint;

    if (mode === "front") {
      out += hint
        ? buildReadingViewHintHtml(resolvedAnswer, hint)
        : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    } else {
      const nestedHtml = renderNestedReadingViewClozeHtml(match.answer);
      out += nestedHtml
        ? `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${nestedHtml}</span></span>`
        : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    }

    last = match.end;
  }

  if (last < source.length) {
    out += renderMarkdownTextWithExplicitBreaks(source.slice(last));
  }

  return out;
}