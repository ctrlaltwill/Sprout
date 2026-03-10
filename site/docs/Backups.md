# Backups

Last modified: 10/03/2026

## What backups are for

Backups save your **scheduling data** from Sprout's SQLite-backed store so you can recover from mistakes or bad imports.
They do not back up your note text.

## Backup settings

Configure backups in **Settings → Storage & Sync → Data backup**.

| Setting | Default | What it does |
|---|---|---|
| **Enable rolling daily backup** | On | Keeps one automatic daily backup (`daily-backup.db`) refreshed over time |

Manual backups are always user-created and are never removed by the rolling daily policy.

## Create a manual backup

1. Open **Settings → Storage & Sync → Data backup**.
2. Click **Create manual backup**.

The backup is saved immediately.

## Restore a backup

1. In the backup table, find the backup you want.
2. Click **Restore**.
3. Confirm.

Restoring replaces current scheduling data with older data.

> [!WARNING]
> Restore overwrites your current scheduling state and review history.
> Reviews done after that backup was made are lost.

## Delete a backup

Click **Delete** next to a backup to remove it permanently.
This action cannot be undone.

## What is included

- card stages, intervals, stability, difficulty
- review history
- FSRS parameters
- card-to-note mappings
- analytics review/session event history used by progress views

## What is not included

- Markdown note content
- media files
- plugin settings

## When to create backups

- before reset actions
- before large imports (see [Anki Export & Import](./Anki-Export-&-Import.md))
- regularly as a safety habit

## Notes

- Backups are local-first and intended for recovery.
- New backups include a sidecar integrity manifest (`.manifest.json`) with size + checksum.
- Older backups without a manifest are still supported and can still be restored.
- If backup files are missing or corrupted, use your most recent valid backup.
