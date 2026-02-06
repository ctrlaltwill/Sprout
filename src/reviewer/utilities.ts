// src/reviewer/utils.ts

export function deepClone<T>(v: T): T {
  const sc = (globalThis as any).structuredClone;
  if (typeof sc === "function") return sc(v);
  return JSON.parse(JSON.stringify(v));
}

export function clampInt(n: any, lo: number, hi: number): number {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}
