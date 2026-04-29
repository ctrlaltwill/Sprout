---
title: "Image Occlusion"
---


Image occlusion lets you hide labelled parts of an image and recall them during review.

It is useful for diagrams, anatomy, maps, pathways, and anything else where location matters.

## Creating an image occlusion flashcard

The normal workflow is:

1. Open `Add flashcard`.
2. Choose `Image occlusion`.
3. Paste an image or drag an image file into the modal.
4. Open the image occlusion editor.
5. Draw or generate masks.
6. Save the card.

LearnKit also supports a dedicated `Add image occlusion flashcard to note` command.

> [!NOTE]
> The full image occlusion editor is desktop-only.

## What the editor can do

The current editor supports:

- rectangle and ellipse masks
- moving and resizing masks
- undo and reset actions
- pan and zoom controls
- image crop and rotation tools
- text annotations
- OCR-powered auto-masking

## Auto-masking with OCR

`Auto-Mask` looks for text-like regions in the image and creates masks for them.

This is useful for labelled diagrams, but it is still a draft step. You should expect to clean up the result manually.

In practice:

- clear, high-contrast labels work best
- existing masks are kept
- generated masks can be moved, resized, regrouped, or deleted before saving

## Save modes

Image occlusion supports two save modes:

| Mode | What it does |
|------|---------------|
| `Solo` | Creates one review target at a time so each mask or group is tested separately |
| `All` | Hides all masks together on the same card |

## Groups

Each mask can have a group key.

Masks with the same group key behave as one unit. This is useful when several labels belong together and should be hidden or revealed together.

## Review behaviour

During review, LearnKit shows the image with occlusion overlays.

After you reveal the answer, the app can either:

- reveal the target group only
- reveal all groups at once

Configure that in `Settings -> Flashcards -> Image occlusion -> Reveal mode`.

## Demo

![Image occlusion question demo](../../../branding/Demo/Image%20Occlusion%20-%20Question.png)

_Question side with masks active._

![Image occlusion answer demo](../../../branding/Demo/Image%20Occlusion%20-%20Answer.png)

_Answer side after reveal._

## Storage settings

Image occlusion files are stored separately from the review setting above.

You can configure these in `Settings -> Data & Maintenance -> Attachment storage`:

- `Image occlusion folder`
- `Delete orphaned image occlusion images`

The default folder is `Attachments/Image Occlusion/`.

## Good use cases

- anatomy diagrams
- labelled maps
- flowcharts with named parts
- processes where a visual landmark matters

If the content is mostly text and order matters more than location, [Ordered Questions](../Ordered-Questions) or [Multiple Choice Questions](../Multiple-Choice-Questions) are usually a better fit.

If you want location-based interaction with click or drag behavior, use [Hotspot Cards](../Hotspot-Cards).

Last modified: 28/04/2026
