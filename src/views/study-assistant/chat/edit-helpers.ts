/**
 * @file src/views/study-assistant/chat/edit-helpers.ts
 * @summary Validation and safety helpers for AI-proposed note edits.
 *
 * @exports
 *  - validateEditProposal
 *  - mentionsFrontmatter
 */

import type { StudyAssistantEditChange } from "../../../platform/integrations/ai/study-assistant-types";

export type EditValidationResult = {
  validEdits: StudyAssistantEditChange[];
  rejectedEdits: StudyAssistantEditChange[];
  rejectionReasons: string[];
};

const FRONTMATTER_KEYWORDS = /\b(frontmatter|metadata|properties|tags|yaml)\b/i;

/** Returns true when the user's message explicitly mentions frontmatter concepts. */
export function mentionsFrontmatter(userMessage: string): boolean {
  return FRONTMATTER_KEYWORDS.test(userMessage);
}

/**
 * Extract the YAML frontmatter range (start/end character indices) from note content.
 * Returns null if no frontmatter is present.
 */
function getFrontmatterRange(content: string): { start: number; end: number } | null {
  if (!content.startsWith("---")) return null;
  const closingIndex = content.indexOf("\n---", 3);
  if (closingIndex < 0) return null;
  // End is after the closing "---" and its newline
  const endIndex = closingIndex + 4;
  return { start: 0, end: endIndex };
}

/**
 * Check whether a substring starting at `matchIndex` with length `len`
 * overlaps the frontmatter region.
 */
function overlapsFrontmatter(
  matchIndex: number,
  matchLength: number,
  fmRange: { start: number; end: number } | null,
): boolean {
  if (!fmRange) return false;
  const matchEnd = matchIndex + matchLength;
  return matchIndex < fmRange.end && matchEnd > fmRange.start;
}

/**
 * Validate an AI-proposed edit proposal against the current note content.
 *
 * Rules enforced:
 *  - Each `original` must be an exact substring of `noteContent`
 *  - `original` and `replacement` must differ (no-ops rejected)
 *  - Frontmatter edits are blocked unless `allowFrontmatter` is true
 */
export function validateEditProposal(
  edits: StudyAssistantEditChange[],
  noteContent: string,
  allowFrontmatter: boolean,
): EditValidationResult {
  const validEdits: StudyAssistantEditChange[] = [];
  const rejectedEdits: StudyAssistantEditChange[] = [];
  const rejectionReasons: string[] = [];
  const fmRange = getFrontmatterRange(noteContent);

  for (const edit of edits) {
    const { original, replacement } = edit;

    // No-op check
    if (original === replacement) {
      rejectedEdits.push(edit);
      rejectionReasons.push(`No-op edit skipped (original equals replacement).`);
      continue;
    }

    // Exact substring match
    const matchIndex = noteContent.indexOf(original);
    if (matchIndex < 0) {
      rejectedEdits.push(edit);
      rejectionReasons.push(`Original text not found in note: "${original.slice(0, 60)}…"`);
      continue;
    }

    // Frontmatter guard
    if (!allowFrontmatter && overlapsFrontmatter(matchIndex, original.length, fmRange)) {
      rejectedEdits.push(edit);
      rejectionReasons.push(`Edit touches frontmatter but user did not request frontmatter changes.`);
      continue;
    }

    validEdits.push(edit);
  }

  return { validEdits, rejectedEdits, rejectionReasons };
}
