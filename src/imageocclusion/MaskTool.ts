// src/imageocclusion/MaskTool.ts
// Helper utilities for Image Occlusion mask/child ID generation

/**
 * Normalises a group key to a stable string identifier.
 * Trims whitespace; defaults to "1" if empty.
 */
export function normaliseGroupKey(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  return s || "1";
}

/**
 * Generates a stable, deterministic child ID for an IO parent + group.
 * Format: `{parentId}::io::{groupKey}`
 */
export function stableIoChildId(parentId: string, groupKey: string): string {
  const pid = String(parentId ?? "").trim();
  const g = normaliseGroupKey(groupKey);
  return `${pid}::io::${g}`;
}

/**
 * Returns the next auto-incremented group key given existing rects.
 * Used for creating new masks with unique group identifiers.
 */
export function nextAutoGroupKey(rects: any[]): string {
  if (!Array.isArray(rects) || rects.length === 0) return "1";
  
  const nums = rects
    .map((r: any) => {
      const k = normaliseGroupKey(r?.groupKey);
      const n = parseInt(k, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })
    .filter((n) => n > 0);
  
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return String(max + 1);
}

/**
 * Generates a unique rect ID.
 */
export function makeRectId(): string {
  return `r-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

/**
 * Type guard for IOMaskMode.
 */
export function isMaskMode(val: any): val is "solo" | "all" {
  return val === "solo" || val === "all";
}
