# Editing Cards

Last updated: 13/02/2026

## Overview

Cards can be edited at any time and from several different places in Sprout. Changes are picked up on the next sync.

## Editing in the source note

The most direct method. Open the Markdown note containing your card and edit the pipe-delimited block directly.

- In **source/editing view**, edit the raw Markdown text.
- In **reading view**, click the **edit button** that appears on the card block to switch to editing for that card.

After editing, save the file and Sprout will detect the changes on the next sync.

## Editing while studying

You can edit the card you're currently reviewing without leaving the study session:

1. Press **`E`** on your keyboard, or
2. Open the **More menu** (press **`M`** or tap the **⋮** button) and choose **Edit**.

This opens the inline card editor where you can modify any field. Changes are saved immediately and the card is updated in the session.

> [!TIP]
> This is useful for fixing typos, improving answers, or adding extra info as you study — you'll notice what needs fixing most when you're actively reviewing.

## Editing from the Card Browser

1. Open the [[Card Browser]].
2. Select a card (or multiple cards for bulk editing).
3. Click **Edit** to open the card editor.

The Card Browser supports **live updating** — changes you make to card fields in the editor are reflected immediately in the browser table.

## What can be edited

All card fields can be changed:

| Field | Editable |
|-------|----------|
| Title | ✅ |
| Question / Cloze text | ✅ |
| Answer | ✅ |
| Options (MCQ) | ✅ |
| Extra info | ✅ |
| Groups | ✅ |

> [!WARNING]
> Do not edit or delete the `^sprout-#########` anchor line. This links the card to its scheduling data. If the anchor is removed, the card will be treated as new on the next sync and all learning progress will be lost.

## Editing Image Occlusion cards

Image Occlusion cards have a special editor — the **IO Editor** — which opens as a modal with the image canvas. You can add, move, resize, and delete mask regions. See [[Image Occlusion]] for details.

> [!NOTE]
> The IO editor is desktop-only. On mobile, a notice will appear.
