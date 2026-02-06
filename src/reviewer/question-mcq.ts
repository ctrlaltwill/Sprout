// src/reviewer/mcq.ts
import type SproutPlugin from "../main";
import type { Session } from "./image-occlusion-types";

export function isMcqOptionRandomisationEnabled(plugin: SproutPlugin): boolean {
  return !!(plugin.settings.reviewer as any)?.randomizeMcqOptions;
}

export function initMcqOrderState(session: Session) {
  const s: any = session as any;
  if (!s.mcqOrderMap || typeof s.mcqOrderMap !== "object") s.mcqOrderMap = {};
}

function isPermutation(arr: number[], n: number): boolean {
  if (!Array.isArray(arr) || arr.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const x of arr) {
    if (!Number.isInteger(x) || x < 0 || x >= n) return false;
    if (seen[x]) return false;
    seen[x] = true;
  }
  return true;
}

function shuffleInPlace(a: number[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
}

export function getMcqOptionOrder(plugin: SproutPlugin, session: Session, card: any): number[] {
  const opts = (card as any)?.options || [];
  const n = Array.isArray(opts) ? opts.length : 0;
  const identity = Array.from({ length: n }, (_, i) => i);

  if ((card as any)?.type !== "mcq") return identity;
  if (!isMcqOptionRandomisationEnabled(plugin)) return identity;

  const id = String((card as any)?.id ?? "");
  if (!id) return identity;

  const s: any = session as any;
  if (!s.mcqOrderMap || typeof s.mcqOrderMap !== "object") s.mcqOrderMap = {};
  const map = s.mcqOrderMap as Record<string, number[]>;

  const existing = map[id];
  if (isPermutation(existing, n)) return existing;

  const next = identity.slice();
  shuffleInPlace(next);

  if (n >= 2) {
    let same = true;
    for (let i = 0; i < n; i++) {
      if (next[i] !== i) {
        same = false;
        break;
      }
    }
    if (same) {
      const tmp = next[0];
      next[0] = next[1];
      next[1] = tmp;
    }
  }

  map[id] = next;
  return next;
}
