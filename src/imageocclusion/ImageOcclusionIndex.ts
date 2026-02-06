/**
 * ImageOcclusionIndex.ts
 *
 * Re-exports ImageOcclusionEditorModal from ImageMaskRenderer so that
 * `import * as IO from "./ImageOcclusionIndex"` keeps working in
 * ReviewView.ts and SproutWidgetView.ts.
 */

export { ImageOcclusionEditorModal } from "./ImageMaskRenderer";
