# Study Sessions

Last modified: 13/02/2026

## Overview

Study sessions are where you review cards.

Sprout uses FSRS to decide when cards are due.

## Starting a session

You can start from:

- **Study page** — open the deck tree, pick a scope, and start.
- **Home page** — start from recent or pinned decks.
- **Deck widget (sidebar)** — starts from the currently open file context:
	- If the open file is a regular note, the session scope is that single note only.
	- If the open file is a folder note (a note which has the same name as its parent folder — for example if you are using the [Folder Notes](https://github.com/LostPaul/obsidian-folder-notes) plugin), the scope is all notes in that folder and includes any subfolders and their notes.

## Study scopes

Choose a scope (the set of cards to study):

| Scope | Covers |
|-------|--------|
| **Vault** | Every card in the vault |
| **Folder** | Cards in notes under a folder |
| **Note** | Cards in a single note |
| **Group** | Cards tagged with one or more groups |

## Card order

Sprout queues cards in this order: **learning → relearning → review → new**.

Related siblings (for example cloze siblings and IO children) are spaced apart so they do not appear back-to-back.

## Daily limits

| Setting | Default | Effect |
|---------|---------|--------|
| Daily new limit | 20 | Max new cards introduced per scope per day |
| Daily review limit | 200 | Max due cards shown per scope per day |

Limits reset at midnight and are tracked separately per scope.

## Answering cards

Press **Space** or **Enter** to reveal the answer, then grade recall. See [[Grading]].

## Practice mode

Practice mode shows cards that are **not due yet**.

Cards are sorted by closest due date first.

Grades in Practice mode do **not** change scheduling.

## Timer

A session timer in the header shows elapsed time. Use play/pause controls to manage it.

## Auto-advance

If enabled in Settings, unanswered cards are auto-graded **Again** and advanced after a delay.

Allowed delay is 3 to 60 seconds (default 60). A countdown is shown.

## Skip

Enable **Skip** in Settings → Study.

Skipping pushes the card back in the queue and does **not** change scheduling.

| Skip count | Behaviour |
|------------|-----------|
| 1st | Card moves back in queue |
| 2nd | Card moves further back |
| 3rd | A **"Bury for today?"** prompt appears |

At that prompt: press `B` to bury, or `Escape` to dismiss.

## More menu

Press `M` or tap the **⋮** button to open the More menu:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Bury | `B` | Postpone card until tomorrow (see [[Burying-Cards|Burying Cards]]) |
| Suspend | `S` | Remove card from future reviews (see [[Suspending-Cards|Suspending Cards]]) |
| Undo | `U` | Revert the previous rating (only available on the next card) |
| Open note | `O` | Jump to the source note |
| Edit | `E` | Open the inline card editor |

## Zoom

Click any image during a review to open it in a full-screen overlay. Click again or press `Escape` to close.

## Time tracking

Sprout records time spent per card (capped at 5 minutes) for analytics.
