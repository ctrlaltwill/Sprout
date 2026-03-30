---
title: "Custom Delimiters"
---

# Custom Delimiters

LearnKit uses `|` as the default field delimiter in flashcard markup.

If that clashes with your note content, you can change it in **Settings -> Flashcards -> Card delimiter**.

## Available Delimiters

| Option | Character |
|---|---|
| Pipe | `\|` |
| At sign | `@` |
| Tilde | `~` |
| Semicolon | `;` |

## When To Change It

Most users should keep the default pipe.

Consider changing only when:

- your notes already use `|` heavily
- your flashcard content includes lots of LaTeX or tables
- another writing pattern makes pipe-delimited cards awkward to maintain

## Example

With the `@` delimiter:

```text
T @ Title @
Q @ What is the capital of France? @
A @ Paris @
I @ Located on the River Seine @
G @ Geography @
```

With the `~` delimiter:

```text
T ~ Title ~
Q ~ What is the capital of France? ~
A ~ Paris ~
```

## Important Limitation

Changing the delimiter does **not** convert existing flashcards.

Cards written with the old delimiter stop parsing correctly, and the next sync can break their scheduling linkage.

That means you should only change the delimiter when:

- your vault is still new
- or you are ready to manually convert old flashcards first

## Safer Alternatives

Before changing the delimiter globally, try these first:

- use the multiline patterns from [Flashcard Formatting](./Flashcard-Formatting)
- keep `|` as the global default and only restructure the notes that need it

## Related

- [Flashcard Formatting](./Flashcard-Formatting)
- [Syncing](./Syncing)
- [Settings](./Settings)

---

Last modified: 30/03/2026
