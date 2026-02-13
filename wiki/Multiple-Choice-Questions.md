# Multiple Choice Questions

Last updated: 13/02/2026

## Overview

Multiple Choice Question (MCQ) cards present a question with several options. You select the correct answer from the list. MCQs are useful for recognition-based learning and for topics where distinguishing between similar options is important.

## Writing an MCQ card

Use `MCQ` for the question stem, `A` for the correct answer, and `O` for each incorrect option:

```
T | French Capitals |
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
O | Madrid |
I | Remember: it's on the Seine |
G | Geography |
```

- **`MCQ`** — The question stem (required).
- **`A`** — The correct answer (required, exactly one).
- **`O`** — Incorrect options (at least one required, add as many as needed).

## Using the modal

1. Right-click in a note → **Add flashcard → MCQ Card**.
2. Enter the question stem.
3. Enter the correct answer.
4. Add incorrect options (click **Add option** for more).
5. Optionally add title, info, and groups.
6. Click **Save**.

## How MCQs are reviewed

During review, the question is shown with all options displayed as buttons. Tap or click the option you think is correct.

- **Correct answer** — The option turns green and the card is graded as **Good**.
- **Incorrect answer** — Your chosen option turns red, the correct answer is highlighted green, and the card is graded as **Again**.

> [!NOTE]
> MCQ grading is automatic — you don't need to press a separate grade button. Your choice determines the grade.

### Option randomisation

By default, options are displayed in the order you wrote them. Enable **Randomise MCQ options** in **Settings → Study** to shuffle the order each time the card appears. This prevents you from memorising option positions instead of content.

## Grading behaviour

MCQs are **auto-graded** based on your selection:

| Your choice | Grade applied |
|-------------|--------------|
| Correct option | **Good** |
| Incorrect option | **Again** |

The FSRS scheduler then updates the card's scheduling data based on the grade, just like any other card type. See [[Grading]] for more on how grading works.

## Tips

- Write plausible distractors (wrong options) — if options are obviously wrong, the card isn't testing real knowledge.
- Use MCQs for topics where distinguishing between similar items is the learning goal.
- Combine with the `I` field to explain why the correct answer is right.
