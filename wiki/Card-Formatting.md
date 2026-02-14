# Card Formatting

Last modified: 13/02/2026

## Overview

Card fields support common formatting so cards are easier to read.
Formatting appears in review and reading views, and is exported to Anki as HTML.

## Supported formatting

- Markdown inline styles (bold, italic, strike, highlight)
- LaTeX math (`$...$` and `$$...$$`)
- wikilinks and image embeds
- simple HTML tags like `<u>`, `<sub>`, `<sup>`

## LaTeX rule you must follow

If a field contains LaTeX with `|` characters, keep delimiters on separate lines.

Correct:

```
Q
|
What is $\frac{a}{b}$?
|
```

Incorrect:

```
Q | What is $\frac{a}{b}$? |
```

If delimiters are not separated, parsing can fail.

## Links and images

You can use:

- `[[note]]` and `[[note|label]]`
- `![[image.png]]` and `![[image.png|400]]`
- `![alt](https://...)`

## Important limit: tables

Markdown tables are not supported in card fields.
They use `|`, which conflicts with Sprout field delimiters and can break card parsing.

If you need tabular content, use an image or code block instead.

## Delimiter conflicts

If your content often needs `|`, switch delimiter style.
See [[Custom Delimiters]].
