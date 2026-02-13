# Creating Cards

Last updated: 13/02/2026

## Overview

There are two ways to create flashcards in Sprout: writing Markdown syntax directly in your notes, or using the built-in creation modals.

## Using the creation modals

The fastest way to get started. You don't need to memorise any syntax.

1. **Right-click** in any note to open the context menu, or use the **command palette** (`Cmd/Ctrl+P`).
2. Choose one of the **Add flashcard** options:
   - Add Basic Card
   - Add Cloze Card
   - Add MCQ Card
   - Add Image Occlusion Card
   - Add Ordered Question Card
3. Fill in the fields in the modal and click **Save**.
4. Sprout inserts the formatted card block into your note at the cursor position.

> [!TIP]
> Modals are particularly useful for complex card types like Image Occlusion and MCQ where the syntax is more involved.

## Writing cards in Markdown

Use pipe-delimited lines in any Markdown note. Each field starts and ends with a pipe `|` (or your configured [[Custom Delimiters|delimiter]]).

### Fields

| Field | Purpose | Required |
|-------|---------|----------|
| `T` | Title | Optional |
| `Q` | Question | Required for basic |
| `A` | Answer | Required for basic & MCQ (for the correct answer option) |
| `CQ` | Cloze question | Required for cloze |
| `MCQ` | MCQ question stem | Required for MCQ |
| `O` | MCQ option | One required for MCQ (repeat for each incorrect option) |
| `OQ` | Ordered question stem | Required for ordered |
| `I` | Extra info | Optional |
| `G` | Groups/tags (comma-separated) | Optional |

### Minimal examples

**Basic card:**
```
Q | What is the capital of France? |
A | Paris |
```

**Cloze card:**
```
CQ | The capital of France is {{c1::Paris}} |
```

**MCQ card:**
```
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
```

See the dedicated pages for each card type for full details:
- [[Basic & Reversed Cards]]
- [[Cloze Cards]]
- [[Image Occlusion]]
- [[Multiple Choice Questions]]
- [[Ordered Questions]]

## Multi-line fields

Fields can span multiple lines — the pipe `|` at the end marks the end of the field. This is useful for longer answers or including images.

```
Q | List three key features of X and include a diagram. |
A | Feature one

Feature two

![[diagram.png]] |
I | Keep answers structured. |
```

## Card identity & anchors

After syncing, each card block gets an anchor line:

```
^sprout-#########
```

This is the unique identifier for that card — **do not edit or delete it**. It links the card to its scheduling data. See [[Syncing]] for more details.
