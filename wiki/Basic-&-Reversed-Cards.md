# Basic & Reversed Cards

Last updated: 13/02/2026

## Overview

Basic cards are the simplest card type — a question on the front and an answer on the back. Reversed cards automatically create a second card with the question and answer swapped.

## Writing a basic card

```
T | Title |
Q | What is the capital of France? |
A | Paris |
I | Located on the River Seine |
G | Geography |
```

Only `Q` (question) and `A` (answer) are required. Title (`T`), info (`I`), and groups (`G`) are optional.

## Using the modal

1. Right-click in a note → **Add flashcard → Basic Card**.
2. Fill in the question and answer fields.
3. Optionally add a title, extra info, and groups.
4. Click **Save** to insert the card block.

## Reversed cards

A reversed card generates two review cards from one block:

1. **Forward**: Question → Answer
2. **Reverse**: Answer → Question

To create a reversed card, use the `QA` field type or toggle the **Reversed** option in the creation modal:

```
T | Capital of France |
Q | What is the capital of France? |
A | Paris |
```

When the reversed option is enabled in the modal, Sprout will generate both directions automatically.

## Grading

Basic cards use manual grading — after revealing the answer, you rate your recall:

- **Two-button mode** (default): Again / Good
- **Four-button mode**: Again / Hard / Good / Easy

See [[Grading]] for details on grading modes and recommendations.

## Tips

- Keep questions specific and atomic — one fact per card.
- Use the `I` (info) field for context, mnemonics, or source references rather than putting everything into the answer.
- Add [[Groups|groups]] to organise cards into decks.
