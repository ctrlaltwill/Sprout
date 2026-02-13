# Syncing

Last updated: 13/02/2026

## Overview

Syncing is how Sprout detects new, changed, and deleted flashcard blocks in your notes and updates the internal card database. Whenever you add or edit cards in Markdown, you need to sync for the changes to take effect.

## How to sync

- **Automatic sync** — Sprout syncs automatically when Obsidian starts and when files are saved.
- **Manual sync** — Use the command palette and run **Sprout: Sync cards** to trigger a sync manually.
- **Ribbon icon** — Click the Sprout sync icon in the left ribbon bar.

## What happens during sync

1. **Scanning** — Sprout scans all Markdown files in your vault (respecting any excluded folders) for card blocks.
2. **Parsing** — Each card block is parsed according to the configured card delimiter (pipe `|` by default).
3. **Matching** — Cards with existing `^sprout-#########` anchors are matched to their stored scheduling data.
4. **Creating** — New card blocks without anchors are assigned a unique ID and added to the database as new cards.
5. **Updating** — Cards whose content has changed are updated in the database.
6. **Removing** — Cards whose blocks have been deleted from notes are removed from the database.
7. **Anchoring** — A `^sprout-#########` anchor line is inserted above or below each card block (configurable in Settings → Indexing → ID placement).

## Card anchors

After syncing, each card block gets an anchor line:

```
^sprout-#########
```

This is the unique identifier that links the card to its scheduling data. **Do not edit or delete it** — if the anchor is lost, a new one will be assigned on next sync and learning progress will be lost.

> [!TIP]
> If you accidentally delete an anchor, you can find the card's ID in the [[Card Browser]] and manually re-add the anchor line.

## Quarantined cards

If a card block has a syntax error and cannot be parsed, it is **quarantined** rather than deleted. Quarantined cards appear in **Settings → Storage → Quarantined cards** with their error messages. Open the source note to fix the syntax and re-sync.

## Excluded content

- **Fenced code blocks** — By default, card syntax inside `` ``` `` code blocks is ignored. Toggle this in Settings → Indexing → Ignore fenced code blocks.
- Cards are scoped to Markdown files only — other file types are not scanned.
