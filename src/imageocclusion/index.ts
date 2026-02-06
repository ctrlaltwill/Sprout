/**
 * imageocclusion/index.ts — barrel
 *
 * Re-exports the public API of the image-occlusion module.
 */

export * from "./image-occlusion-types";
export * from "./image-geometry";
export * from "./image-transform";
export * from "./mask-tool";
export { ImageOcclusionEditorModal } from "./image-mask-renderer";
export { ImageOcclusionEditor } from "./image-occlusion-editor";
export {
  isIoParentCard,
  isIoRevealableType,
  renderImageOcclusionReviewInto,
} from "./image-occlusion-review-render";
export * from "./io-helpers";
