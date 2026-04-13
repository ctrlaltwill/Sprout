---
title: "Creating Flashcards"
---


You can create flashcards either with guided UI actions or by writing them directly in Markdown.

Use the guided method when you want speed. Use the Markdown method when you want full control.

## Method 1: Guided Flashcard Creation

1. Right-click in a note or open the command palette.
2. Choose an **Add flashcard** action.
3. Fill in the fields.
4. Save the flashcard.

This is usually the easiest path for:

- [Image Occlusion](../Image-Occlusion)
- [Multiple Choice Questions](../Multiple-Choice-Questions)
- other flashcard types where structure is easier to manage through a form

## Method 2: Write Flashcards In Markdown

You can also write flashcard blocks directly in the note.

By default, fields use the `|` delimiter unless you changed it in [Custom Delimiters](../Custom-Delimiters).

## Common Fields

| Field | Use | Required |
|---|---|---|
| `T` | Title | No |
| `Q` | Basic question | Yes for basic flashcards |
| `A` | Answer or correct option | Yes for basic flashcards and MCQs |
| `CQ` | Cloze text | Yes for cloze flashcards |
| `MCQ` | MCQ stem | Yes for MCQs |
| `O` | Incorrect MCQ option | At least one for MCQs |
| `OQ` | Ordered-question stem | Yes for ordered questions |
| `1`, `2`, `3`, ... | Ordered items | At least two for ordered questions |
| `I` | Extra info | No |
| `G` | Groups | No |

See [Decks & Organisation](../Decks-&-Organisation) for how to use groups effectively.

## Minimal Examples

**Basic**
```
Q | What is the capital of France? |
A | Paris |
```

**Cloze**
```
CQ | The capital of France is {{c1::Paris}} |
```

**MCQ**
```
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
```

## After You Create Flashcards

After writing or inserting new flashcards, [Sync](../Syncing) your database so LearnKit can detect them.

## Important Note About Anchors

After sync, LearnKit adds an anchor like this:

```
^learnkit-#########
```

Do not delete or edit that anchor. It links the source note block to the flashcard's stored review data.

## Related

- [Flashcards](../Flashcards)
- [Editing Flashcards](../Editing-Flashcards)
- [Flashcard Formatting](../Flashcard-Formatting)

---

Last modified: 30/03/2026