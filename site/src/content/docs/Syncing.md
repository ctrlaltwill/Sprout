---
title: "Syncing"
---

# Syncing

Syncing is how LearnKit turns supported content in your notes into up-to-date study material.

If you create, edit, move, or delete flashcards in Markdown, run sync so LearnKit can update its internal database.

## When To Sync

Run sync after you:

- add new cards to notes
- edit existing flashcard content
- delete card blocks
- import large amounts of content

If you do not sync, LearnKit may still show old flashcard data or fail to show new flashcards.

## How To Start A Sync

- Click the LearnKit sync button when available in the app UI.
- Run **LearnKit: Sync cards** from the command palette.
- Some edit flows, such as flashcard editing tools, may trigger sync-related updates automatically.

## What Sync Actually Does

1. Scans supported Markdown files for LearnKit flashcard content.
2. Parses fields using your current delimiter rules.
3. Matches existing card blocks to stored flashcard data.
4. Creates new flashcards for new blocks.
5. Updates changed flashcards.
6. Removes flashcards whose source blocks no longer exist.
7. Maintains card anchors that connect note content to review data.

## Card Anchors

After sync, LearnKit assigns an anchor like this to each tracked card block:

```
^learnkit-#########
```

This anchor links the note block to its stored scheduling state.

Do not remove or edit it unless you know exactly why. If the anchor changes, LearnKit may treat the block as a different card and previous progress may no longer attach to it.

## Why Cards Sometimes Do Not Appear

The most common causes are:

- sync has not been run yet
- the card syntax is invalid
- the content is inside an ignored area such as fenced code blocks
- the card was quarantined because parsing failed

If a card has invalid syntax, LearnKit quarantines it instead of silently deleting it. Fix the note, then sync again.

## What Sync Ignores

- fenced code blocks by default
- non-Markdown files

Some indexing behavior can be changed in settings.

## Good Habit

The normal workflow is:

1. write or edit notes
2. run sync
3. verify flashcards in [Flashcard Library](./Flashcard-Library) if needed
4. start [Study Sessions](./Study-Sessions)

## Related

- [Creating Flashcards](./Creating-Flashcards)
- [Flashcard Library](./Flashcard-Library)
- [Backups](./Backups)

---

Last modified: 30/03/2026
