// src/reviewer/labels.ts
export function typeLabel(t: string): string {
  if (t === "basic") return "Basic";
  if (t === "mcq") return "MCQ";
  if (t === "cloze" || t === "cloze-child") return "Cloze";
  if (t === "io-child") return "Image Occlusion";
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
