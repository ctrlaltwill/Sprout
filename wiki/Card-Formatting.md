# Card Formatting

Last updated: 13/02/2026

## Overview

Sprout supports rich formatting inside card fields. Formatting is rendered in the reviewer, the widget, and reading view, and is converted to HTML when exporting to Anki.

## Inline Markdown

Standard Obsidian inline Markdown works in all card fields (question, answer, cloze text, extra info):

| Syntax | Result | Shortcut |
|--------|--------|----------|
| `**text**` | **Bold** | Cmd+B (Ctrl+B) |
| `*text*` | *Italic* | Cmd+I (Ctrl+I) |
| `_text_` | *Italic* | — |
| `~~text~~` | ~~Strikethrough~~ | Cmd+Shift+S (Ctrl+Shift+S) |
| `==text==` | Highlight | Cmd+Shift+H (Ctrl+Shift+H) |

> [!NOTE]
> `_text_` is italic in Obsidian — it does **not** produce underline. For underline, subscript, or superscript, use HTML tags (`<u>`, `<sub>`, `<sup>`) which Obsidian renders natively.

## LaTeX

LaTeX equations are supported in card fields. Use `$...$` for inline math and `$$...$$` for display math.

When a field ends with LaTeX, the opening and closing pipes **must** be on their own lines — otherwise the parser will break on the `|` characters inside LaTeX expressions.

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

> [!TIP]
> Leave a blank line between the last line of LaTeX and the closing pipe for best rendering.

## Links & images

Standard Obsidian syntax works inside any field:

- **Wikilinks**: `[[note name]]` or `[[note name|display text]]`
- **Images**: `![[image.png]]` or `![[image.png|400]]` for a sized embed
- **External images**: `![alt](https://...)`

## Tables

Tables are **not supported** inside card fields. Tables use `|` characters, which will be interpreted as field delimiters and break card parsing.

> [!TIP]
> If you need tabular data in a card, consider using a code block or an image instead.

## Custom delimiters

If pipe `|` conflicts with your note content, you can switch to an alternative delimiter. See [[Custom Delimiters]] for details.
