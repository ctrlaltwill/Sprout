# Image Occlusion

Image Occlusion lets you create flashcards by masking regions of an image. During review you see the image with masks — recall what's hidden, then reveal.

## Creating an IO card

1. In any note, add a card block with an `IO` field pointing to an image:
   ```
   T | Anatomy — Bones of the hand |
   IO | ![[hand_diagram.png]] |
   ```
2. Sync your cards (Sprout will detect the IO block).
3. Open the **Image Occlusion Editor** from the card browser or reviewer (Edit → IO editor).

> **Note:** The IO editor is desktop-only. On mobile a notice will appear.

## Editor

The editor opens as a modal with the image centred on a canvas.

### Toolbar

| Tool | Description |
|------|-------------|
| **Occlusion** | Draw new mask rectangles over the image |
| **Transform** | Move or resize existing masks |
| **Delete** | Remove the selected mask |
| **Reset** | Revert all masks to their saved state |

### Group input

Each mask has a **group key**. Masks with the same group key are revealed together during review. Type a key in the group input to assign the selected mask to that group.

### Zoom controls

Use **Zoom In**, **Zoom Out**, and **Fit** to navigate large images. You can also hold **Spacebar** and drag to pan.

### Shapes

Masks can be **rectangles** or **circles**.

## Mask modes

When saving, choose one of two modes:

| Mode | Button | Behaviour |
|------|--------|-----------|
| **Solo** | Save Solo | Each mask (or group) becomes its own review card — only that region is hidden |
| **All** | Save All | All masks are hidden at once and revealed together |

## How cards are generated

- The original `IO` card block becomes a **parent** card (not reviewable).
- Sprout generates one **child** card per mask group (or per individual mask in solo mode).
- Children inherit the parent's title and info fields.

## Review

During review the image is displayed with coloured mask overlays. After you reveal the answer the masks are removed so you can check your recall.

- Click the image to **zoom** into a full-screen overlay.
- If the source image is missing you'll see an error message in place of the image.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Default IO attachment folder | `Attachments/Image Occlusion/` | Where IO images are stored |
| Delete orphaned IO images | On | Auto-delete images when their IO cards are removed |

Configure these in **Settings → Image Occlusion**.
