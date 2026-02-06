/**
 * imageocclusion/io-types.ts
 * ---------------------------------------------------------------------------
 * Shared types for the Image Occlusion creator modal and its helpers.
 * ---------------------------------------------------------------------------
 */

export type ClipboardImage = { mime: string; data: ArrayBuffer };

export type IORect = {
  rectId: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  groupKey: string;
  shape?: "rect" | "circle";
};

export type StageTransform = { scale: number; tx: number; ty: number };

export type IOTextBox = {
  textId: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  text: string;
  fontSize: number;
  color: string;
  bgColor?: string | null;
  bgOpacity?: number;
};

export type IOHistoryEntry = { rects: IORect[]; texts: IOTextBox[]; image: ClipboardImage | null };

export type { ClipboardImage };
