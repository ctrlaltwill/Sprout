import { processClozeForMath, splitClozeAnswerAndHint } from "../../platform/core/shared-utils";
import { escapeHtml, processMarkdownFeatures } from "./reading-helpers";

interface ClozeMatch {
  index: number;
  fullMatch: string;
  content: string;
}

function matchClozeTokensBraceAware(source: string): ClozeMatch[] {
  const results: ClozeMatch[] = [];
  const opener = /\{\{c\d+::/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source)) !== null) {
    const startIdx = match.index;
    const contentStart = startIdx + match[0].length;
    let depth = 0;
    let index = contentStart;

    while (index < source.length) {
      if (source[index] === "{") {
        depth++;
      } else if (source[index] === "}") {
        if (depth > 0) {
          depth--;
        } else if (index + 1 < source.length && source[index + 1] === "}") {
          results.push({
            index: startIdx,
            fullMatch: source.slice(startIdx, index + 2),
            content: source.slice(contentStart, index),
          });
          opener.lastIndex = index + 2;
          break;
        }
      }
      index++;
    }
  }

  return results;
}

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

export function buildReadingFlashcardCloze(text: string, mode: "front" | "back"): string {
  const source = String(text || "");
  if (source.includes("$") || source.includes("\\(") || source.includes("\\[")) {
    const reveal = mode === "back";
    return processMarkdownFeatures(
      processClozeForMath(source, reveal, null, { blankClassName: "learnkit-flashcard-blank" }),
    );
  }

  const clozeMatches = matchClozeTokensBraceAware(source);
  let out = "";
  let last = 0;

  for (const match of clozeMatches) {
    if (match.index > last) {
      out += renderMarkdownTextWithExplicitBreaks(source.slice(last, match.index));
    }

    const { answer, hint } = splitClozeAnswerAndHint(match.content.trim());
    const trimmedAnswer = answer.trim();

    if (mode === "front") {
      out += hint
        ? buildReadingViewHintHtml(trimmedAnswer, hint)
        : `<span class="learnkit-flashcard-blank">&nbsp;</span>`;
    } else {
      out += `<span class="learnkit-reading-view-cloze"><span class="learnkit-cloze-text">${renderMarkdownTextWithExplicitBreaks(trimmedAnswer)}</span></span>`;
    }

    last = match.index + match.fullMatch.length;
  }

  if (last < source.length) {
    out += renderMarkdownTextWithExplicitBreaks(source.slice(last));
  }

  return out;
}