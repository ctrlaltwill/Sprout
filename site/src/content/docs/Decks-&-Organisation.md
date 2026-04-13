---
title: "Decks & Organisation"
---


LearnKit uses your vault's folder structure and a group system to organise flashcards into decks.

You do not need to create separate deck files or manage a deck database. Your folders and groups are your decks.

## What Is a Deck?

A deck is any collection of flashcards scoped by location or group.

In LearnKit, decks are derived from:

- **Folders**: each folder in your vault is a natural deck boundary
- **Folder notes**: when enabled, a folder note acts as the deck entry point for everything in that folder
- **Groups**: tags you assign to individual flashcards to create cross-folder collections

## Folder-Based Organisation

The simplest way to organise flashcards is by folder.

```
Vault/
├── Biology/
│   ├── Cell Division.md       ← cards here belong to the "Biology" deck
│   └── Genetics.md
├── History/
│   ├── Ancient Rome.md        ← cards here belong to the "History" deck
│   └── Medieval Europe.md
└── Languages/
    └── Spanish/
        └── Vocabulary.md      ← cards here belong to "Languages/Spanish"
```

Every flashcard inherits its deck from the folder it lives in. Subfolders create a natural hierarchy.

## Folder Notes as Decks

If your vault uses folder notes (a note with the same name as its parent folder), you can enable **Treat folder notes as decks** in [Settings](../Settings).

When this is on:

- opening a folder note scopes the [Study Widget](../Widget) to that entire folder
- subfolder cards are included in the scope
- the folder note becomes the deck's entry point for quick review

This is useful when you have a folder like `Biology/Biology.md` and want to study all Biology cards from one place.

## Groups

Groups let you organise flashcards across folder boundaries.

A group is a label you assign to a flashcard using the `G` field:

```
Q | What is mitosis? |
A | Cell division producing two identical daughter cells |
G | Biology/Cell Division |
```

### Group Hierarchy

Groups support a path-like hierarchy using `/` as a separator:

```
G | Science/Biology/Genetics |
```

This creates a tree:

- Science
  - Biology
    - Genetics

You can filter and scope by any level of the hierarchy in the [Flashcard Library](../Flashcard-Library).

### Multiple Groups

A flashcard can belong to multiple groups. Separate them with commas:

```
G | Biology/Genetics, Exam Prep/Final |
```

### When to Use Groups vs Folders

| Use case | Recommended approach |
|---|---|
| Cards naturally live in one topic | Folders |
| Cards span multiple topics | Groups |
| You want deck-scoped widget review | Folder notes |
| You want cross-folder collections | Groups |
| You want both | Combine folders with groups |

## Scoping and Filtering

Once your flashcards are organised, you can scope study and review by:

- **Folder scope**: the [Study Widget](../Widget) uses the current note's folder
- **Group filters**: the [Flashcard Library](../Flashcard-Library) lets you filter by group hierarchy
- **Study Sessions**: [Study Sessions](../Study-Sessions) can be scoped to specific folders or groups

## Tips

- Keep your group hierarchy shallow (2–3 levels) for easy navigation
- Use folder structure for primary organisation and groups for cross-cutting concerns like "Exam Prep" or "Weak Topics"
- Sync after adding or changing groups so LearnKit detects the updates

## Related

- [Creating Flashcards](../Creating-Flashcards)
- [Flashcard Library](../Flashcard-Library)
- [Study Widget](../Widget)
- [Study Sessions](../Study-Sessions)
- [Syncing](../Syncing)

---

Last modified: 13/04/2026
