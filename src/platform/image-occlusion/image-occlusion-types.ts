/**
 * @file src/imageocclusion/image-occlusion-types.ts
 * @summary Type definitions for the Image Occlusion system's persisted data model. Defines the stored/serialised shapes for occlusion rectangles, parent IO definitions (image reference, mask mode, rect list), and the top-level IO map keyed by parent card ID.
 *
 * @exports
 *   - IOMaskMode — union type for mask display modes ("solo" | "all")
 *   - StoredIORect — type for a persisted occlusion rectangle with normalised coordinates and group key
 *   - IOParentDef — type for a parent IO card definition (imageRef, maskMode, rects)
 *   - IOMap — type alias for Record<string, IOParentDef>
 */

export type IOMaskMode = "solo" | "all";
export type HQInteractionMode = "click" | "drag-drop";

export type StoredIORect = {
  rectId: string;
  x: number;  // normalized 0-1
  y: number;  // normalized 0-1
  w: number;  // normalized 0-1
  h: number;  // normalized 0-1
  groupKey: string;
  label?: string;
  shape?: "rect" | "circle" | "polygon";
  points?: Array<{ x: number; y: number }>;
};

export type IOParentDef = {
  imageRef: string;
  maskMode: IOMaskMode | null;
  rects: StoredIORect[];
};

export type IOMap = Record<string, IOParentDef>;

export type HQParentDef = {
  imageRef: string;
  interactionMode: HQInteractionMode | null;
  prompt: string | null;
  rects: StoredIORect[];
};

export type HQMap = Record<string, HQParentDef>;
