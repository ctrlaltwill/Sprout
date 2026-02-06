// src/imageocclusion/ImageOcclusionTypes.ts
// Type definitions for Image Occlusion system

export type IOMaskMode = "solo" | "all";

export type IORect = {
  rectId: string;
  x: number;  // normalized 0-1
  y: number;  // normalized 0-1
  w: number;  // normalized 0-1
  h: number;  // normalized 0-1
  groupKey: string;
  shape?: "rect" | "circle";
};

export type IOParentDef = {
  imageRef: string;
  maskMode: IOMaskMode | null;
  rects: IORect[];
};

export type IOMap = Record<string, IOParentDef>;
