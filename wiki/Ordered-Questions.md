# Ordered Questions

Last updated: 13/02/2026

## Overview

Ordered Question cards test your ability to arrange items in the correct sequence. During review, you're presented with a list of items in a scrambled order and must drag or select them into the right position. This is ideal for learning steps in a process, rankings, timelines, or any ordered list.

## Writing an ordered question card

Use `OQ` for the question stem, followed by the items in **correct order**. Sprout will scramble them during review:

```
T | Cardiac cycle |
OQ | Arrange the phases of the cardiac cycle in order |
O | Atrial systole |
O | Isovolumetric contraction |
O | Ventricular ejection |
O | Isovolumetric relaxation |
O | Ventricular filling |
I | The cycle repeats with each heartbeat |
G | Cardiology |
```

- **`OQ`** — The question stem (required).
- **`O`** — Each item in the correct sequence (at least two required, listed in correct order).

## Using the modal

1. Right-click in a note → **Add flashcard → Ordered Question Card**.
2. Enter the question stem.
3. Add items in the correct order (click **Add item** for more).
4. Optionally add title, info, and groups.
5. Click **Save**.

The modal makes it easy to reorder items before saving — drag items up or down to adjust the sequence.

## How ordered questions are reviewed

During review, the items are displayed in a **scrambled order**. You arrange them into what you believe is the correct sequence by dragging or selecting items.

Once you confirm your order:

- **All correct** — Items turn green and the card is graded as **Good**.
- **Any incorrect** — Incorrectly placed items are highlighted, the correct order is shown, and the card is graded as **Again**.

## Grading behaviour

Ordered questions are **auto-graded** based on whether your sequence matches the correct order:

| Your arrangement | Grade applied |
|------------------|--------------|
| Fully correct order | **Good** |
| Any items out of order | **Again** |

The FSRS scheduler updates the card based on the grade. See [[Grading]] for more details.

## Tips

- Keep lists to a reasonable length (3–7 items) — very long sequences are hard to memorise and frustrating to arrange.
- Use clear, distinct item text so items aren't easily confused.
- Combine with the `I` field to provide context or a mnemonic for the sequence.
