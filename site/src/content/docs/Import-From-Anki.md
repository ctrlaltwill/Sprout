---
title: "Import From Anki"
---


LearnKit can import from and export to Anki using `.apkg` files.

Use the command palette for:

- **Import from Anki (.apkg)**
- **Export to Anki (.apkg)**

> [!WARNING]
> Anki import and export are still experimental. Make a backup before large operations.

## Import From Anki

Use import when you want to bring an existing Anki deck into LearnKit.

1. Run **Import from Anki (.apkg)**.
2. Select the `.apkg` file.
3. Review the preview and chosen mappings.
4. Choose options such as target folder, scheduling behavior, and duplicate handling.
5. Start the import and review the summary.

## What To Check After Import

After importing, verify that:

- flashcards landed in the expected location
- deck or tag mappings look correct
- duplicate handling behaved as expected
- the imported content appears correctly in [Flashcard Library](../Flashcard-Library)

## Important Import Limits

- Image Occlusion cards are skipped on import.
- Note types other than Basic and Cloze are imported as Basic.
- Damaged or invalid `.apkg` files can fail to import.

## Export To Anki

LearnKit can also export flashcards to Anki.

1. Run **Export to Anki (.apkg)**.
2. Choose the export scope.
3. Set export options such as media, scheduling data, and MCQ handling.
4. Save the generated package.

## Important Export Limits

- Image Occlusion cards are not exported.
- Cloze child cards are not exported.
- MCQ cards may be converted or skipped depending on your export settings.

## FSRS After Export

LearnKit can include FSRS-related data in an export, but Anki still requires FSRS to be enabled on the Anki side.

After importing into Anki:

1. Open deck options.
2. Find **FSRS**.
3. Turn FSRS on.

## Before Large Imports Or Exports

Create a backup first in [Backups](../Backups) so you can roll back if needed.

## Related

- [Backups](../Backups)
- [Syncing](../Syncing)
- [Flashcard Library](../Flashcard-Library)

---

Last modified: 30/03/2026