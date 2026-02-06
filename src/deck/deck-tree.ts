// src/deck/deck-tree.ts
import type { CardRecord, CardState } from "../core/store";
import { State } from "ts-fsrs";

export type DeckCounts = {
  total: number;
  new: number;
  learning: number;
  review: number;
  relearning: number;
};

export type DeckNode = {
  type: "folder" | "note";
  key: string;
  name: string;
  children: Map<string, DeckNode>;
  counts: DeckCounts;
};

function emptyCounts(): DeckCounts {
  return { total: 0, new: 0, learning: 0, review: 0, relearning: 0 };
}

function filenameNoExt(path: string): string {
  const base = path.split("/").pop() || path;
  return base.replace(/\.md$/i, "");
}

function folderName(path: string): string {
  const p = path.split("/").filter(Boolean);
  return p.length ? p[p.length - 1] : path;
}

/**
 * Best-effort FSRS state inference for legacy data:
 * - Prefer fsrsState when present
 * - Else infer from stage + lapses
 */
function inferFsrsState(st: CardState | undefined | null): State {
  if (!st) return State.New;
  if (st.fsrsState !== undefined) return st.fsrsState;

  // Legacy fallback
  const stage = st.stage ?? "new";
  if (stage === "new") return State.New;
  if (stage === "review") return State.Review;
  if (stage === "relearning") return State.Relearning;

  // stage === "learning" or unknown: use lapses heuristic
  return (st.lapses ?? 0) > 0 ? State.Relearning : State.Learning;
}

function addOne(counts: DeckCounts, fs: State) {
  counts.total += 1;

  if (fs === State.New) counts.new += 1;
  else if (fs === State.Review) counts.review += 1;
  else if (fs === State.Relearning) counts.relearning += 1;
  else counts.learning += 1; // Learning or any other/unknown -> learning bucket
}

function ensureChildFolder(parent: DeckNode, folderKey: string): DeckNode {
  const existing = parent.children.get(folderKey);
  if (existing) return existing;

  const node: DeckNode = {
    type: "folder",
    key: folderKey,
    name: folderName(folderKey),
    children: new Map(),
    counts: emptyCounts(),
  };
  parent.children.set(folderKey, node);
  return node;
}

function ensureChildNote(parent: DeckNode, notePath: string): DeckNode {
  const existing = parent.children.get(notePath);
  if (existing) return existing;

  const node: DeckNode = {
    type: "note",
    key: notePath,
    name: filenameNoExt(notePath),
    children: new Map(),
    counts: emptyCounts(),
  };
  parent.children.set(notePath, node);
  return node;
}

/**
 * Build a tree:
 * - root is a synthetic folder with key "" and name vaultName
 * - folder keys are folder paths (no trailing slash), e.g. "Psychiatry", "Psychiatry/Anxiety"
 * - note keys are full note paths, e.g. "Psychiatry/Anxiety.md"
 *
 * Signature preserved for compatibility with your caller.
 */
export function buildDeckTree(
  cards: CardRecord[],
  states: Record<string, CardState>,
  _nowMs: number,
  vaultName: string
): DeckNode {
  const root: DeckNode = {
    type: "folder",
    key: "",
    name: vaultName,
    children: new Map(),
    counts: emptyCounts(),
  };

  for (const c of cards) {
    const notePath = String(c.sourceNotePath || "");
    if (!notePath) continue;

    const st = states[String(c.id)] || null;
    const fs = inferFsrsState(st);

    // Walk folders
    const parts = notePath.split("/").filter(Boolean);
    const folderParts = parts.slice(0, Math.max(0, parts.length - 1));

    let cur = root;
    let runningKey = "";

    // root counts
    addOne(cur.counts, fs);

    for (const fp of folderParts) {
      runningKey = runningKey ? `${runningKey}/${fp}` : fp;
      cur = ensureChildFolder(cur, runningKey);

      // aggregate into folder
      addOne(cur.counts, fs);
    }

    // Note node
    const noteNode = ensureChildNote(cur, notePath);
    addOne(noteNode.counts, fs);
  }

  return root;
}
