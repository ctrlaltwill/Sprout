## Overview

Open **Settings → Community plugins → Sprout** to configure the plugin.

## User details

| Setting | Default | Description |
|---------|---------|-------------|
| User name | *(empty)* | Name shown in greetings on the home page |
| Show Sprout information on the homepage | On | Display developer info on the home view |
| Show greeting text | On | Personalised greeting vs plain "Home" title |

## General

| Setting | Default | Description |
|---------|---------|-------------|
| Enable animations | On | Page-load fade-up animations |
| Prettify cards | Accent | Card colour scheme — **Accent** (plugin colours) or **Theme** (inherit from Obsidian theme) |

## Image Occlusion

| Setting | Default | Description |
|---------|---------|-------------|
| Default IO attachment folder | `Attachments/Image Occlusion/` | Where IO images are saved |
| Delete orphaned IO images | On | Auto-delete IO images when their cards are removed |

## Card Attachments

| Setting | Default | Description |
|---------|---------|-------------|
| Card attachment folder | `Attachments/Cards/` | Where card media (images, audio) is saved |

## Study

| Setting | Default | Description |
|---------|---------|-------------|
| Daily new limit | 20 | Max new cards per scope per day |
| Daily review limit | 200 | Max due cards per scope per day |
| Auto-advance | Off | Auto-fail and advance unanswered cards |
| Auto-advance after | 60 s | Seconds before auto-advancing (3–60) |
| Grading buttons | Two buttons | **Two** (Again / Good) or **Four** (Again / Hard / Good / Easy) |
| Skip button | Off | Show a Skip button (Enter) in the reviewer |
| Randomise MCQ options | Off | Shuffle MCQ option order each time |
| Show info by default | Off | Expand the info field on the card back |

## Widget

| Setting | Default | Description |
|---------|---------|-------------|
| Treat folder notes as decks | On | Folder notes act as the deck root for their folder |

## Scheduling (FSRS)

Sprout uses the **FSRS** algorithm. Choose a preset or fine-tune manually.

### Presets

| Preset | Learning steps | Relearning steps | Retention |
|--------|----------------|------------------|-----------|
| Relaxed | 20 min | 20 min | 0.88 |
| Balanced | 10 min, 1 day | 10 min | 0.90 |
| Aggressive | 5 min, 30 min, 1 day | 10 min | 0.92 |
| Custom | *(user-defined)* | *(user-defined)* | *(user-defined)* |

### Manual options

| Setting | Default | Description |
|---------|---------|-------------|
| Learning steps | `10, 1440` | Minutes between learning steps (comma-separated) |
| Relearning steps | `10` | Minutes between relearning steps |
| Requested retention | 0.90 | Target recall probability (0.80–0.97) |

### Reset buttons

| Button | Effect |
|--------|--------|
| Reset scheduling | Reset all cards back to New |
| Reset analytics | Clear review history and heatmap data |

## Backups

- **Create backup now** — take a manual snapshot of your scheduling data.
- The backup table lists each backup with its date and card-state summary.
- **Restore** — roll back to a previous backup.
- **Delete** — remove a backup.

A "Current data" row always appears at the top for reference.

## Indexing

| Setting | Default | Description |
|---------|---------|-------------|
| Ignore fenced code blocks | On | Skip card syntax inside ``` blocks |
| ID placement | Above | Place card anchors above or below the card block |

## Danger zone

| Button | Effect |
|--------|--------|
| Delete all flashcards | Removes **all** Sprout data from every note and the plugin store. This cannot be undone. |

## Quarantined cards

If a card cannot be parsed (e.g. malformed syntax), it appears here with its ID and error message. Click **Open note** to jump to the problem card and fix it.
