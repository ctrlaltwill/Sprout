# Cloze Cards

Last modified: 13/02/2026

## Overview

Cloze cards hide words inside a sentence so you recall missing parts in context.

## Basic cloze format

Use `CQ` with markers like `{{c1::...}}`:

```
T | French Geography |
CQ | The capital of France is {{c1::Paris}} |
I | Located on the River Seine |
G | Geography |
```

## Numbering rules

- Different numbers (`c1`, `c2`) create separate cards.
- Same number hides multiple parts on the same card.

Example with two cards:

```
CQ | {{c1::Paris}} is the capital of {{c2::France}} |
```

Example with one card hiding two words:

```
CQ | The {{c1::heart}} pumps {{c1::blood}} through the body |
```

## Create with the modal

1. Right-click in a note → **Add flashcard → Cloze Card**.
2. Enter text.
3. Mark text as new cloze or same-number cloze.
4. Save.

## Grading

Cloze cards use the same manual grading flow as other cards.
See [[Grading]].

## Edge cases and limits

- Invalid cloze syntax can stop a card from rendering correctly.
- Overlapping or inconsistent numbering can create unexpected card counts.
- Very large numbers of deletions in one sentence can hurt readability and recall quality.
