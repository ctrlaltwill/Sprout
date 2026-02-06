/**
 * ImageOcclusionIndex.ts
 *
 * Re-exports ImageOcclusionEditorModal from ImageMaskRenderer so that
 * `import * as IO from "./image-occlusion-index"` keeps working in
 * ReviewView.ts and SproutWidgetView.ts.
 */

export { ImageOcclusionEditorModal } from "./image-mask-renderer";
