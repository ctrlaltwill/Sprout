---
title: "Decks & Organisation"
---


LearnKit organises flashcards into decks using your vault's folder structure. Each note is its own deck, and folders act as parent decks that combine the flashcards from all notes inside them.

You do not need to create separate deck files or manage a deck database. Your existing notes and folders are your decks.

## What Is a Deck?

A deck is a collection of flashcards defined entirely by your vault's file and folder hierarchy.

- **A note is a deck.** Every note containing flashcards is the smallest deck unit. For example, `Vocabulary.md` is the Vocabulary deck.
- **A folder is a parent deck.** A folder combines the flashcards from all of its child notes and subfolders into one larger deck. For example, a `Biology/` folder containing `Cell Division.md` and `Genetics.md` forms the Biology deck, which includes all flashcards from both notes.

Decks are derived purely from your folder structure. There is no other mechanism for creating decks.

## Deck Hierarchy

Your vault's folder tree directly maps to a deck hierarchy:

```
Vault/
├── Biology/                        ← "Biology" deck (all cards from both notes below)
│   ├── Cell Division.md            ← "Cell Division" deck (its own cards only)
│   └── Genetics.md                 ← "Genetics" deck (its own cards only)
├── History/                        ← "History" deck (all cards from both notes below)
│   ├── Ancient Rome.md             ← "Ancient Rome" deck
│   └── Medieval Europe.md          ← "Medieval Europe" deck
└── Languages/
    └── Spanish/                    ← "Languages/Spanish" deck
        └── Vocabulary.md           ← "Vocabulary" deck
```

- Opening `Cell Division.md` scopes you to just its flashcards.
- Scoping to the `Biology/` folder gives you all flashcards from both `Cell Division.md` and `Genetics.md` together.
- Nesting folders deeper creates deeper deck hierarchies automatically.

## Folder Notes and Widget Scoping

The [Study Widget](../Widget) normally shows flashcards from the note you are currently viewing. If you use folder notes (where a note shares the same name as its parent folder, e.g. `Biology/Biology.md`), there is an optional setting to expand the widget's scope.

Enable **Treat folder notes as decks** in [Settings](../Settings) to make the widget include flashcards from all child notes and subfolders when you are viewing a folder note.

This is a niche setting primarily useful if you use a folder-note plugin and want the widget to act as a parent-deck review surface without opening the [Flashcard Library](../Flashcard-Library).

## Groups

Groups are a separate organisational layer on top of the folder-based deck system. They let you tag and filter flashcards across folder boundaries, but they do not create decks.

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

This creates a tree you can filter by in the [Flashcard Library](../Flashcard-Library):

- Science
  - Biology
    - Genetics

### Multiple Groups

A flashcard can belong to multiple groups. Separate them with commas:

```
G | Biology/Genetics, Exam Prep/Final |
```

### When to Use Groups vs Folders

| Use case | Recommended approach |
|---|---|
| Cards naturally live in one topic | Folders (each note is a deck) |
| Cards span multiple topics | Groups (cross-folder tagging) |
| You want cross-folder collections | Groups |
| You want widget review of a whole folder | Folder notes setting |

## Scoping and Filtering

Once your flashcards are organised, you can scope study and review by:

- **Note scope**: the [Study Widget](../Widget) uses the current note's flashcards
- **Folder scope**: the [Flashcard Library](../Flashcard-Library) and [Study Sessions](../Study-Sessions) can scope to a folder, combining all child note-decks
- **Group filters**: the [Flashcard Library](../Flashcard-Library) lets you filter by group hierarchy

## Tips

- Keep your group hierarchy shallow (2–3 levels) for easy navigation
- Use folder structure for primary organisation and groups for cross-cutting concerns like "Exam Prep" or "Weak Topics"

## Related

- [Creating Flashcards](../Creating-Flashcards)
- [Flashcard Library](../Flashcard-Library)
- [Study Widget](../Widget)
- [Study Sessions](../Study-Sessions)

---

Last modified: 13/04/2026
