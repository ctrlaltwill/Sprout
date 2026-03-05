/**
 * @file src/imageocclusion/io-types.ts
 * @summary Shared types for the Image Occlusion creator modal and its helper modules. Defines the runtime data shapes for clipboard images, occlusion rectangles, stage transforms, text boxes, and undo history entries used throughout the IO editor.
 *
 * @exports
 *   - ClipboardImage — type for image data from the clipboard (mime + ArrayBuffer)
 *   - IORect — type for a runtime occlusion rectangle with normalised coordinates
 *   - StageTransform — type for the canvas stage's scale and translation state
 *   - IOTextBox — type for a text annotation box with position, styling, and content
 *   - IOHistoryEntry — type for an undo/redo history snapshot (rects, texts, image)
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
