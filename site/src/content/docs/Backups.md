---
title: "Backups"
---

# Backups

LearnKit backups are there to recover your study state if something goes wrong.

They are focused on recovery of scheduling and analytics data, not on backing up your notes.

## Where to find them

Open `Settings -> Data & Maintenance -> Data backup`.

The current backup section includes:

- `Rolling daily backup`
- `Create manual backup`
- a backup table with restore and delete actions

## What is included

Backups preserve LearnKit's study-state data, including:

- scheduling states
- review history
- analytics events used for streaks, heatmaps, and answer-button history

## What is not included

Backups do not replace normal vault backups. They do not include:

- markdown note content
- media files
- general plugin settings

## Rolling daily backup

`Rolling daily backup` keeps one automatic daily backup.

Manual backups are separate and are not auto-deleted by that daily rolling setting.

## Create a manual backup

Use `Create manual backup` before risky changes such as:

- large imports
- restore operations
- reset actions
- major flashcard cleanup or migrations

Manual backups are created immediately.

## Restore a backup

In the backup table, LearnKit shows each backup's:

- label
- date
- scheduling-data summary
- integrity state

If a backup passes integrity checks, you can restore it.

Restoring a backup replaces your current scheduling data with the snapshot from that backup.

> [!WARNING]
> Restoring a backup can remove newer review progress made after that backup was created.

## Integrity states

The backup table can show states such as:

- `Verified` for backups that pass integrity checks
- `Legacy` for older backups created before the current manifest/checksum system
- `Invalid` for backups that fail validation

Invalid backups cannot be restored.

## Good practice

- create a manual backup before major changes
- keep rolling daily backup enabled unless you have another recovery workflow
- use the most recent verified backup when recovering

See [Import From Anki](./Import-From-Anki) if you want a backup before a big import.

Last modified: 30/03/2026
