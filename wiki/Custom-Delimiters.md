# Custom Delimiters

Last updated: 13/02/2026

## Overview

By default, Sprout uses the pipe `|` character to delimit card fields. If pipe conflicts with your note content (e.g. heavy use of LaTeX or tables outside of card blocks), you can switch to an alternative delimiter.

## Available delimiters

| Option | Character |
|--------|-----------|
| Pipe *(default)* | `\|` |
| At sign | `@` |
| Tilde | `~` |
| Semicolon | `;` |

## Changing the delimiter

1. Go to **Settings → Storage → Card delimiter**.
2. Select your preferred delimiter from the dropdown.

## Example

With the `@` delimiter:

```
T @ Title @
Q @ What is the capital of France? @
A @ Paris @
I @ Located on the River Seine @
G @ Geography @
```

With the `~` delimiter:

```
T ~ Title ~
Q ~ What is the capital of France? ~
A ~ Paris ~
```

## Important warning

> [!WARNING]
> Changing the delimiter does **not** migrate existing cards. Cards written with the previous delimiter will stop parsing and their scheduling data will be lost on the next sync.

Only change this setting on a **fresh vault** or after **manually converting all your cards** to the new delimiter.

## When to change

You rarely need to change the delimiter. The most common reasons:

- Your notes contain heavy **LaTeX** with `|` characters (see [[Card Formatting]] for the multi-line workaround first).
- You have other Obsidian plugins or content that conflicts with pipes.

> [!TIP]
> Before changing the delimiter, try the multi-line syntax for LaTeX fields (pipe on its own line). This avoids the `|` conflict without needing to change the delimiter globally.
