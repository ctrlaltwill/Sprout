# Writing Cards

Cards are written as pipe-delimited lines (or multiple lines) in any Markdown note. Each line starts and ends with a pipe `|`.

## Fields

| Field | Purpose | Required |
|-------|---------|----------|
| `T` | Title | Optional |
| `Q` | Question | Required for basic |
| `A` | Answer | Required for basic & MCQ |
| `CQ` | Cloze question | Required for cloze |
| `MCQ` | MCQ question stem | Required for MCQ |
| `O` | MCQ option | Required for MCQ (repeat for each option) |
| `I` | Extra info | Optional |
| `G` | Groups/tags | Optional |

## Basic card

```
T | Title |
Q | What is the capital of France? |
A | Paris |
I | Located on the River Seine |
G | Geography |
```

## Cloze card

Use cloze markers like `{{c1::...}}`.

```
T | Title |
CQ | The capital of France is {{c1::Paris}} |
I | Extra info |
G | Geography |
```

## MCQ card

List options on separate `O` lines. Mark the correct answer on the `A` line.

```
T | Title |
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
O | Madrid |
I | Remember: it's on the Seine |
G | Geography |
```

## Multi-line cards

Fields can span multiple lines — the pipe `|` at the end marks the end of the field. Images can be included as Obsidian attachments.

```
T | Example — Multi-line Answer with Image |
Q | List three key features of Example Condition X and include a diagram. |
A | Line one

Line two

![[Image.png]] |
I | Keep answers short and structured. |
```

## LaTeX

LaTeX is supported in multi-line cards. Leave a blank line between the last line of LaTeX and the closing pipe for best rendering.

## Links

Use standard Obsidian link syntax inside fields: `[[note name]]`.

## Card identity

After syncing, each card block gets an anchor line:

```
^sprout-#########
```

This is the only stable identifier for that card. **Do not edit or delete it** — it links the card to its scheduling data. If you accidentally delete it, you can copy the ID from the Card Browser, otherwise a new anchor will be assigned on next sync and learning progress will be lost.
