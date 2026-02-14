# Syncing

Last modified: 13/02/2026

## Overview

Syncing updates Sprout's card database from your Markdown notes.

After creating, editing, or deleting card blocks, sync so changes take effect in your card database.

## How to sync

- **Header button:** click the Sprout sync button in any view when Sprout is open.
- **Manual command:** run **Sprout: Sync cards** from the command palette.
- **Automatic sync:** runs when editing cards in [[Card-Browser|Card Browser]] or edit modals.


## What happens during sync

1. **Scan:** find card blocks in Markdown files.
2. **Parse:** read fields using the configured delimiter (default `|`).
3. **Match:** connect blocks with existing `^sprout-#########` anchors to stored scheduling data.
4. **Create:** add new blocks that do not yet have anchors.
5. **Update:** refresh stored data for changed blocks.
6. **Remove:** delete cards whose source blocks were removed.
7. **Anchor:** insert `^sprout-#########` above or below blocks (based on settings).

## Card anchors

After syncing, each card block gets an anchor line:

```
^sprout-#########
```

This anchor links note content to scheduling data.

Do not edit or delete it. If it is removed, next sync creates a new ID and previous progress is not linked to that block.

> [!TIP]
> If you remove an anchor by mistake, find the card ID in [[Card-Browser|Card Browser]] and re-add the line.

## Quarantined cards

If a card block has invalid syntax, Sprout quarantines it instead of deleting it.

See quarantined entries in Settings with error details, fix the note, then sync again.

## Excluded content

- **Fenced code blocks:** ignored by default (can be changed in Settings → Indexing).
- **Non-Markdown files:** not scanned.
