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

LaTeX is supported in multi-line cards. When a field ends with LaTeX, the opening and closing pipes **must** be on their own lines — otherwise the parser will break on the `|` characters inside LaTeX expressions.

✅ Correct:
```
Q
|
What is $\frac{a}{b}$?
|
```

❌ Incorrect:
```
Q | What is $\frac{a}{b}$? |
```

Leave a blank line between the last line of LaTeX and the closing pipe for best rendering.

## Links & images

Standard Obsidian syntax works inside any field:

- **Wikilinks**: `[[note name]]` or `[[note name|display text]]`
- **Images**: `![[image.png]]` or `![[image.png|400]]` for a sized embed
- **External images**: `![alt](https://...)`

## Inline formatting

Sprout supports standard Obsidian inline markdown in all card fields (question, answer, cloze text, extra info). Formatting is rendered in the reviewer, widget, and reading view, and is converted to HTML when exporting to Anki.

| Syntax | Result | Shortcut |
|--------|--------|----------|
| `**text**` | **Bold** | Cmd+B (Ctrl+B) |
| `*text*` | *Italic* | Cmd+I (Ctrl+I) |
| `_text_` | *Italic* | — |
| `~~text~~` | ~~Strikethrough~~ | Cmd+Shift+S (Ctrl+Shift+S) |
| `==text==` | Highlight | Cmd+Shift+H (Ctrl+Shift+H) |

> **Note:** `_text_` is italic in Obsidian — it does **not** produce underline. If you need underline, subscript, or superscript, use raw HTML tags (`<u>`, `<sub>`, `<sup>`) which Obsidian renders natively.

### Anki import/export

When **exporting** to Anki, markdown formatting is converted to the corresponding HTML tags (`<b>`, `<i>`, `<s>`, `<mark>`).

When **importing** from Anki, HTML formatting tags are converted to Obsidian markdown. Tags without a native Obsidian syntax (`<u>`, `<sub>`, `<sup>`) are kept as raw HTML so they still render correctly. If a field already contains raw markdown (e.g. `**bold**` without `<b>` tags), it is imported as-is.

## Creating cards from the context menu

You don't have to write the pipe syntax by hand. Right-click in any note (or use the command palette) and choose one of the **Add flashcard** options to open a modal where you can fill in the fields. Sprout will insert the formatted card block into your note automatically.

## Editing cards later

Cards can be edited at any time:

- **From the source note** — edit the pipe-delimited block directly in Markdown.
- **From the Card Browser** — select a card and click **Edit** to open the card editor.
- **During a study session** — press `E` or choose **Edit** from the More menu (`M`) to edit the current card inline.

Changes are picked up on the next sync.

## Card identity

After syncing, each card block gets an anchor line:

```
^sprout-#########
```

This is the only stable identifier for that card. **Do not edit or delete it** — it links the card to its scheduling data. If you accidentally delete it, you can copy the ID from the Card Browser, otherwise a new anchor will be assigned on next sync and learning progress will be lost.
