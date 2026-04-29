---
title: "Hotspot Cards"
---


Hotspot cards test location-based recall by asking you to identify the correct area on an image.

They are ideal when you want active placement or click targeting, not just text recall.

## What Hotspot Cards Are

Hotspot cards are image-based cards that share the same visual-editor workflow as [Image Occlusion](../Image-Occlusion), but with interaction-focused review modes.

Use hotspot cards when the learner should identify exact positions, labels, or regions on an image.

## Creating A Hotspot Card

The usual workflow is:

1. Open `Add flashcard`.
2. Choose `Hotspot`.
3. Add or paste an image.
4. Define hotspot regions.
5. Save the card.
6. [Sync](../Syncing) so LearnKit updates the review database.

## Interaction Modes

Hotspot cards support three study modes:

- `smart`: automatically chooses the interaction style per card (single-target cards use individual click; multi-target cards use all-at-once drag-drop)
- `individual`: click one hotspot target at a time
- `all`: drag and drop all labels/targets in one question

You can change the mode in `Settings -> Flashcards -> Hotspot`.

## Demo: Click Mode

![Hotspot click mode front demo](../../../branding/Demo/Hotspot%20-%20Click%20(Front).png)

_Question side in click mode._

![Hotspot click mode answer demo](../../../branding/Demo/Hotspot%20-%20Click%20(Back).png)

_Answer side after reveal in click mode._

## Demo: Drag-Drop Mode

![Hotspot drag-drop mode demo](../../../branding/Demo/Hotspot%20-%20Drag.png)

_Drag-drop interaction with hotspot targets._

## Grouping And Labels

Hotspot regions can be grouped and labeled.

Use clear labels to keep prompts specific and reduce ambiguity during review.

For larger diagrams, split regions into meaningful groups so each review target stays focused.

## Review Behaviour

Hotspot cards follow the normal study-session flow, with hotspot-specific correctness checks.

If hotspot auto-grading is enabled in settings:

- `all` mode passes only when all required hotspot groups/targets are correctly placed
- `individual` mode passes when the clicked location matches the requested target
- all other outcomes are graded as fail (`again`)

If hotspot auto-grading is disabled, you still perform the hotspot interaction first, then grade manually using the standard review buttons.

See [Study Sessions](../Study-Sessions) and [Grading](../Grading) for the shared review and scoring flow.

## Storage And Settings

Hotspot attachments are stored with image attachments.

Relevant settings include:

- `Settings -> Flashcards -> Hotspot`
- `Settings -> Data & Maintenance -> Attachment storage`

By default, hotspot images use the same storage root as image-occlusion images.

## HQ Markdown Fields (Advanced)

Hotspot cards use the `HQ` card type in markdown.

Core fields:

- `HQ` image embed (required)
- `Q` prompt (optional)
- `O` hotspot regions JSON (optional, typically editor-generated)
- `M` interaction mode: `click` or `drag-drop` (optional)
- `T`, `I`, `G` metadata fields (optional)

Minimal example:

```text
HQ | ![[anatomy-diagram.png]] |
Q | Click on the hippocampus. |
M | click |
I | Focus on medial temporal lobe landmarks. |
G | Neuroanatomy |
```

Advanced example with a drag-drop mode flag:

```text
HQ | ![[pathway-diagram.png]] |
Q | Place each label on the correct region. |
M | drag-drop |
```

For most users, creating hotspot cards through the modal/editor is safer than hand-authoring `O` region JSON.

## Related

- [Flashcards](../Flashcards)
- [Creating Flashcards](../Creating-Flashcards)
- [Image Occlusion](../Image-Occlusion)
- [Study Sessions](../Study-Sessions)

---

Last modified: 28/04/2026
