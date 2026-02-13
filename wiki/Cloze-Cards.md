# Cloze Cards

Last updated: 13/02/2026

## Overview

Cloze cards test recall by hiding parts of a sentence. During review you see the text with blanks — fill in the missing words, then reveal the hidden content to check.

## Writing a cloze card

Use `CQ` (cloze question) with cloze markers `{{c1::...}}`:

```
T | French Geography |
CQ | The capital of France is {{c1::Paris}} |
I | Located on the River Seine |
G | Geography |
```

### Multiple deletions

Use different cloze numbers to create separate cards from one block:

```
CQ | {{c1::Paris}} is the capital of {{c2::France}} |
```

This generates two review cards:
- Card 1: hides "Paris", shows "France"
- Card 2: shows "Paris", hides "France"

### Same-number deletions

Use the same cloze number to hide multiple parts on the same card:

```
CQ | The {{c1::heart}} pumps {{c1::blood}} through the body |
```

Both "heart" and "blood" are hidden together on one card.

## Using the modal

1. Right-click in a note → **Add flashcard → Cloze Card**.
2. Type your text in the cloze question field.
3. Select the text you want to hide and press:
   - **New cloze (next number)**: `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Windows/Linux)
   - **Same cloze number**: `Cmd+Shift+Option+C` (Mac) / `Ctrl+Shift+Alt+C` (Windows/Linux)
4. Click **Save**.

## Appearance settings

You can customise how cloze deletions look during review in **Settings → Cards**:

- **Cloze style** — Choose how hidden text appears (e.g. blank line, hint text, typed input).
- **Show context** — Whether surrounding text is dimmed or fully visible.

## Grading

Cloze cards use manual grading — rate your recall after revealing the hidden text. See [[Grading]] for details.

## Tips

- Cloze cards work best for facts embedded in context — e.g. definitions, sequences, fill-in-the-blank.
- Use `c1` for single-deletion cards unless you specifically want multiple cards from one block.
- Combine with the `I` field to add hints or references.
