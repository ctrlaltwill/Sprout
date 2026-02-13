# Backups

Last updated: 13/02/2026

## Overview

Sprout can create backups of your scheduling data — card states, review history, and FSRS parameters. Use backups to protect against data loss or to roll back after experimenting with settings.

## Creating a backup

1. Go to **Settings → Reset**.
2. Click **Create backup now**.

A snapshot of your current scheduling data is saved immediately.

## Backup table

The backup section in Settings shows a table of all backups:

| Column | Description |
|--------|-------------|
| **Date** | When the backup was created |
| **Cards** | Summary of card states at the time (new, learning, review, etc.) |
| **Actions** | Restore or Delete buttons |

A **"Current data"** row always appears at the top for reference, showing your live card counts.

## Restoring a backup

1. Find the backup you want in the table.
2. Click **Restore**.
3. Confirm the action.

Restoring replaces your current scheduling data (intervals, stability, difficulty, review history) with the data from the backup. Your card content in Markdown notes is **not affected** — only the scheduling database is rolled back.

> [!WARNING]
> Restoring a backup overwrites your current scheduling data. Any reviews since the backup was created will be lost.

## Deleting a backup

Click **Delete** next to any backup to remove it permanently. This cannot be undone.

## When to back up

- **Before resetting scheduling** — If you're about to reset all cards to New, back up first in case you change your mind.
- **Before large imports** — Before importing a large Anki `.apkg`, create a backup so you can roll back if the import doesn't go as expected (see [[Anki Export & Import]]).
- **Periodically** — Consider making a backup every week or two for peace of mind.

## What's included

| Included | Not included |
|----------|-------------|
| Card scheduling states (stability, difficulty, interval, stage) | Card content (Markdown text) |
| Review history | Note files |
| FSRS parameters | Plugin settings |
| Card-to-note mappings | Image files |
