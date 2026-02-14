# Image Occlusion

Last modified: 13/02/2026

## What it does

Image Occlusion (IO) hides parts of an image so you recall the hidden label or structure during review.

## Creating an IO card

### Using the modal (recommended)

1. Right-click in a note → **Add flashcard → Image Occlusion Card**.
2. Choose an image from your vault or drag one into the modal.
3. The **IO Editor** opens with the image on a canvas.
4. Use the toolbar to draw mask regions over the areas you want to test.
5. Choose a save mode (Solo or All) and click **Save**.

### Writing in Markdown

Add a card block with an `IO` field pointing to an image:

```
T | Anatomy — Bones of the hand |
IO | ![[hand_diagram.png]] |
G | Anatomy |
```

After sync, open the IO Editor from review or the Card Browser to add masks.

> [!NOTE]
> The IO Editor is desktop-only. On mobile, a notice is shown.

## IO Editor

The editor opens in a modal canvas.

### Toolbar

| Tool | Description |
|---|---|
| **Occlusion** | Draw new mask rectangles/circles over the image |
| **Transform** | Move or resize existing masks |
| **Delete** | Remove the selected mask |
| **Reset** | Revert all masks to their saved state |

### Shapes

Masks can be rectangles or circles.

### Zoom & pan

Use **Zoom In**, **Zoom Out**, and **Fit** to navigate large images. Hold **Spacebar** and drag to pan across the image.

## Groups (mask groups)

Each mask has a **group key**. Masks with the same group key are revealed together during review.

- Type a key in the **group input** to assign the selected mask to a group.
- Masks without a group key are treated as individual items.
- During review, grouped masks are hidden/revealed as a unit.

### Hide all / Hide one / Group mode

When creating IO cards in the modal, you can choose how masks behave:

| Mode | Behaviour |
|---|---|
| **Hide All** | All masks are hidden at once — you recall everything |
| **Hide One** | Only one mask (or group) is hidden per card — others remain visible |
| **Group** | Masks are grouped — each group becomes one review card |

## Save modes

When saving from the editor, choose one of two modes:

| Mode | Button | Behaviour |
|---|---|---|
| **Solo** | Save Solo | Each mask (or group) becomes its own review card — only that region is hidden |
| **All** | Save All | All masks are hidden at once and revealed together |

## Reveal settings

In **Settings → Cards**, you can configure how IO cards are revealed during review:

| Setting | Options | Description |
|---|---|---|
| **Reveal mode** | Reveal All / Reveal Group / Reveal One | Controls how many masks are shown when you reveal the answer |

- **Reveal All** — All masks are removed at once.
- **Reveal Group** — Only masks in the same group are revealed.
- **Reveal One** — Only the target mask is revealed.

## How cards are generated

- The original `IO` card block becomes a **parent** card (not reviewable itself).
- Sprout generates one **child** card per mask or group (depending on save mode).
- Children inherit the parent's title and info fields.

## Review

During review the image is displayed with coloured mask overlays. After revealing, the masks are removed so you can check your recall.

- Click the image to **zoom** into a full-screen overlay.
- If the source image is missing, an error is shown and the card cannot render correctly.

## Settings

| Setting | Default | Description |
|---|---|---|
| Default IO attachment folder | `Attachments/Image Occlusion/` | Where IO images are stored |
| Delete orphaned IO images | On | Auto-delete images when their IO cards are removed |

Configure these in **Settings → Storage → Image Occlusion**.
