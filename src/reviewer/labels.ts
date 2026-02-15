/**
 * @file src/reviewer/labels.ts
 * @summary Provides human-readable display labels for card types and learning stages used throughout the reviewer UI.
 *
 * @exports
 *   - typeLabel — Returns a display-friendly label for a card type string (e.g. "basic" → "Basic", "mcq" → "MCQ")
 *   - stageLabel — Returns a display-friendly label for a card stage string (e.g. "new" → "New", "relearning" → "Relearning")
 */

export function typeLabel(t: string): string {
  if (t === "basic") return "Basic";
  if (t === "reversed" || t === "reversed-child") return "Basic (Reversed)";
  if (t === "mcq") return "Multiple choice";
  if (t === "cloze" || t === "cloze-child") return "Cloze";
  if (t === "io-child") return "Image occlusion";
  if (t === "oq") return "Ordered question";
  return t;
}

export function stageLabel(s: string): string {
  if (s === "new") return "New";
  if (s === "learning") return "Learning";
  if (s === "relearning") return "Relearning";
  if (s === "review") return "Review";
  if (s === "suspended") return "Suspended";
  return s;
}
