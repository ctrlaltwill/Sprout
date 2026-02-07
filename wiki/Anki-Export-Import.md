# Anki Export & Import

Sprout can exchange cards with Anki using .apkg packages. Use the command palette and run **Import from Anki (.apkg)** or **Export to Anki (.apkg)**.

## Export to Anki (.apkg)

1. Open the command palette and run **Export to Anki (.apkg)**.
2. Choose the export scope:
   - **All cards**
   - **Cards in group…** (group name or prefix)
   - **Current note**
3. Configure export options:
   - **MCQ handling**: convert to Basic or skip MCQ cards.
   - **Include scheduling data**: exports FSRS state so cards arrive in Anki with progress intact.
   - **Include review history**: exports review log entries for Anki statistics.
   - **Include media files**: bundles referenced images in the .apkg.
   - **Default deck name**: used for cards without a Sprout group.
4. Export and either **Save to vault** or **Download** the .apkg file.

### Notes

- Image Occlusion and cloze child cards are not exported.
- If you skip MCQ cards, they will be omitted from the package.

### Enabling FSRS in Anki after import

Sprout exports your FSRS parameters, desired retention, and per-card memory state (stability & difficulty) into the .apkg file. However, the FSRS toggle in Anki is a **global collection setting** that .apkg imports cannot set automatically.

After importing the .apkg into Anki:

1. Open **Deck Options** (click the gear icon next to any deck).
2. Scroll to the **FSRS** section at the bottom.
3. Toggle **FSRS** on.

Your desired retention and FSRS parameters from Sprout will already be pre-configured in the deck preset — you just need to flip the switch. All card scheduling data (intervals, stability, difficulty) will be preserved.

## Import from Anki (.apkg)

1. Open the command palette and run **Import from Anki (.apkg)**.
2. Choose an .apkg file and review the import preview.
3. Configure import options:
   - **Target folder**: where Sprout will create deck folders and files.
   - **Scheduling**: import as new cards or preserve Anki scheduling data.
   - **Groups**: map Anki decks and/or tags to Sprout groups.
   - **Duplicates**: skip duplicates or import anyway.
4. Run the import and review the results summary.

### Notes

- Image Occlusion cards are skipped during import.
- Anki note types that are not Basic or Cloze are imported as Basic.

## Tips

- If you plan to continue studying in Anki, keep **Include scheduling data** enabled on export.
- When importing into Sprout, consider **Preserve scheduling** if you want to keep review history intact.
