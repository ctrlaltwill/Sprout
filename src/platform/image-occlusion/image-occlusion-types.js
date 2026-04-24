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
export {};
