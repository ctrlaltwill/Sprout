/**
 * imageocclusion/index.ts — barrel
 *
 * Re-exports the public API of the image-occlusion module.
 */

export * from "./ImageOcclusionTypes";
export * from "./ImageGeometry";
export * from "./ImageTransform";
export * from "./MaskTool";
export { ImageOcclusionEditorModal } from "./ImageMaskRenderer";
export { ImageOcclusionEditor } from "./ImageOcclusionEditor";
export {
  isIoParentCard,
  isIoRevealableType,
  renderImageOcclusionReviewInto,
} from "./ImageOcclusionReviewRender";
export * from "./io-helpers";
