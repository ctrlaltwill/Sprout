# Study Sessions

Last updated: 13/02/2026

## Overview

Study sessions are where you review your flashcards. Sprout uses FSRS (Free Spaced Repetition Scheduler) to present cards at optimal intervals for long-term retention.

## Starting a session

There are several ways to start studying:

- **Study page** — Open the deck tree, pick a scope, and start.
- **Home page** — Open recent decks or pinned decks for quick access.
- **Deck-tree widget** — Tap a deck in the sidebar widget.

## Study scopes

Choose what to study:

| Scope | Covers |
|-------|--------|
| **Vault** | Every card in the vault |
| **Folder** | Cards in notes under a folder |
| **Note** | Cards in a single note |
| **Group** | Cards tagged with one or more groups |

## Card order

Sprout loads cards in priority order: **learning → relearning → review → new**. Cloze siblings and IO children from the same parent are automatically spaced apart so you don't see related cards back-to-back.

## Daily limits

| Setting | Default | Effect |
|---------|---------|--------|
| Daily new limit | 20 | Max new cards introduced per scope per day |
| Daily review limit | 200 | Max due cards shown per scope per day |

Limits are tracked independently for each scope and reset at midnight.

## Answering cards

Press **Space** or **Enter** to reveal the answer, then grade your recall. See [[Grading]] for details on grading modes.

## Practice mode

Practice mode lets you review cards that are **not yet due** — useful for extra revision before an exam.

Cards are sorted closest-to-due first. **Ratings in practice mode do not update scheduling** — your intervals and stability are unaffected, so you can practise freely without consequences.

## Timer

A session timer runs in the header showing elapsed time as `MM:SS` (or `HH:MM:SS` after one hour). Use the play / pause buttons to control it.

## Auto-advance

When enabled (Settings → Study), unanswered cards are automatically marked **Again** and advanced after a configurable delay (3–60 seconds, default 60). A countdown appears on screen.

## Skip

Enable the **Skip** button in Settings → Study. Pressing **Enter** skips the current card and pushes it further back in the queue. Skipping does **not** affect scheduling.

| Skip count | Behaviour |
|------------|-----------|
| 1st | Card moves back in queue |
| 2nd | Card moves further back |
| 3rd | A **"Bury for today?"** prompt appears |

At the bury prompt: press `B` to bury or `Escape` to dismiss.

## More menu

Press `M` or tap the **⋮** button to open the More menu:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Bury | `B` | Postpone card until tomorrow (see [[Burying Cards]]) |
| Suspend | `S` | Remove card from future reviews (see [[Suspending Cards]]) |
| Undo | `U` | Revert the previous rating (only available on the next card) |
| Open note | `O` | Jump to the source note |
| Edit | `E` | Open the inline card editor (see [[Editing Cards]]) |

## Zoom

Click any image during a review to open it in a full-screen overlay. Click again or press `Escape` to close.

## Time tracking

Sprout records how long you spend on each card (capped at 5 minutes) and uses it for analytics.
