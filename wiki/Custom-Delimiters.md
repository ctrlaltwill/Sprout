# Custom Delimiters

Last modified: 13/02/2026

## What this setting does

Sprout uses `|` as the default card-field delimiter. If that conflicts with your note content (for example, heavy LaTeX), you can choose another delimiter.

## Available delimiters

| Option | Character |
|---|---|
| Pipe (default) | `\|` |
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

## Important limit

> [!WARNING]
> Changing the delimiter does not migrate existing cards. Cards written with the old delimiter stop parsing. On the next sync, those cards can lose scheduling linkage/progress.

Only change this on a fresh vault, or after manually converting all existing cards.

## When to change

Most users should keep `|`. Consider changing only when needed:

- Your notes use many `|` characters in content (for example LaTeX).
- Another workflow or plugin conflicts with pipe-delimited fields.

> [!TIP]
> Before changing globally, try the multi-line pattern in [[Card Formatting]]. That often avoids delimiter conflicts without breaking existing cards.
