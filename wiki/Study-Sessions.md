# Study Sessions

## Starting a session

There are several ways to start studying:

- **Study page** — open the deck tree, pick a scope, and start.
- **Home page** — open recent decks or pinned decks for quick access.
- **Deck-tree widget** — tap a deck in the sidebar widget.

Choose a scope for the session:

| Scope | Covers |
|-------|--------|
| **Vault** | Every card in the vault |
| **Folder** | Cards in notes under a folder |
| **Note** | Cards in a single note |
| **Group** | Cards tagged with one or more groups |

Sprout loads due cards first (learning → relearning → review), then new cards. Cloze siblings and IO children from the same parent are automatically spaced apart.

## Daily limits

| Setting | Default | Effect |
|---------|---------|--------|
| Daily new limit | 20 | Max new cards introduced per scope per day |
| Daily review limit | 200 | Max due cards shown per scope per day |

Limits are tracked independently for each scope and reset at midnight.

## Answering cards

Reveal the answer, then rate how well you recalled it.

**Two-button mode** (default):

| Button | Shortcut | Meaning |
|--------|----------|---------|
| Again | `1` | Forgot — card re-enters the learning queue |
| Good | `2` | Remembered |

**Four-button mode** (enable in Settings → Study):

| Button | Shortcut | Meaning |
|--------|----------|---------|
| Again | `1` | Forgot |
| Hard | `2` | Recalled with difficulty |
| Good | `3` | Comfortable recall |
| Easy | `4` | Effortless |

Press **Space** or **Enter** to reveal the answer.

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

At the bury prompt: press `B` to bury (postpone until tomorrow) or `Escape` to dismiss.

## More menu

Press `M` or tap the **⋮** button to open the More menu.

| Action | Shortcut | Description |
|--------|----------|-------------|
| Bury | `B` | Postpone card until tomorrow |
| Suspend | `S` | Suspend card (remove from future reviews) |
| Undo | `U` | Revert the previous rating (only available on the next card) |
| Open note | `O` | Jump to the source note |
| Edit | `E` | Open the inline card editor |

## Keyboard shortcuts summary

| Key | Action |
|-----|--------|
| `Space` / `Enter` | Reveal answer |
| `1` – `4` | Rate card |
| `M` | More menu |
| `B` | Bury |
| `S` | Suspend |
| `U` | Undo |
| `O` | Open note |
| `E` | Edit card |

## Zoom

Click any image during a review to open it in a full-screen overlay. Click again or press `Escape` to close.

## How scheduling works (FSRS)

Sprout uses **FSRS** (Free Spaced Repetition Scheduler), a modern algorithm that models how your memory decays over time.

Every card tracks three key values:

| Value | Meaning |
|-------|---------|
| **Stability** | How many days until your recall probability drops to the requested retention. Higher = longer intervals. |
| **Difficulty** | How inherently hard the card is for you (0–10). Updated with each review. |
| **Retrievability** | Your estimated probability of recalling the card right now (0–1). Decays over time. |

When you rate a card:

1. FSRS updates **difficulty** and **stability** based on your rating and the time elapsed since the last review.
2. It calculates the next interval so that your **retrievability** will equal your **requested retention** (default 0.90) on the due date.
3. The card is scheduled for that many days in the future.

In short: cards you find easy get longer intervals; cards you forget get shorter ones. The algorithm adapts to each card individually rather than using fixed multipliers.

You can tune the scheduler in [[Settings]] — choose a preset (Relaxed / Balanced / Aggressive) or set learning steps and retention manually.

## Time tracking

Sprout records how long you spend on each card (capped at 5 minutes) and uses it for analytics.
