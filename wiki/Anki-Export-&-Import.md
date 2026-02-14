# Anki Export & Import

Last modified: 13/02/2026

## Overview

Sprout can import from and export to Anki using `.apkg` files.
Use the command palette:

- **Export to Anki (.apkg)**
- **Import from Anki (.apkg)**

> [!WARNING]
> Anki import/export is experimental.

## Export to Anki (.apkg)

1. Run **Export to Anki (.apkg)**.
2. Choose what to export:
   - all cards
   - cards in a group
   - current note
3. Choose options:
   - MCQ handling (convert to Basic or skip)
   - include scheduling data
   - include review history
   - include media files
   - default deck name
4. Save or download the `.apkg`.

### Important limits

- Image Occlusion cards are not exported.
- Cloze child cards are not exported.
- If you skip MCQ cards, they are not included in the package.

## FSRS after export

Sprout includes FSRS parameters and card memory state in the export.
Anki still requires you to manually enable FSRS because that switch is global in Anki.

After import into Anki:

1. Open deck options.
2. Find **FSRS**.
3. Turn FSRS on.

## Import from Anki (.apkg)

1. Run **Import from Anki (.apkg)**.
2. Select the `.apkg` and review preview details.
3. Set options:
   - target folder
   - import as new vs preserve scheduling
   - deck/tag to group mapping
   - duplicate handling
4. Start import and check the summary.

### Important limits and conversions

- Image Occlusion cards are skipped on import.
- Note types other than Basic/Cloze are imported as Basic.

### Failure cases to watch

- Invalid or damaged `.apkg` files can fail to import.
- Duplicate handling can skip cards you expected to see.
- If deck/tag mapping is wrong, cards may end up in unexpected groups.

## Before large imports

Create a backup first in [[Backups]] so you can roll back if needed.
