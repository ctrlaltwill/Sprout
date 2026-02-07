# Release Notes - Sprout 1.0.3

**Release Date:** February 8, 2026

## Overview

Version 1.0.3 is a quality-of-life release focused on settings reorganisation, backup improvements, and modal consistency across the plugin.

## What's Changed

### Settings overhaul
- **Reorganised settings into clearer sections**: General, Study, Scheduling, and Storage replace the previous flat layout
- **Improved labels and descriptions**: Every setting now has a concise description explaining what it controls
- **Automatic migration**: Existing settings are migrated seamlessly on first load — no manual changes needed

### Backup system improvements
- **Scheduling-data-only backups**: Backups now store only FSRS scheduling state (not full card content), making them much smaller
- **Configurable interval**: Backup frequency is now a setting (default 15 minutes)
- **Retention limit**: Keeps the most recent 5 backups and prunes older ones automatically

### Modal styling fixes
- **Consistent overlay**: All modals (Add Card, Edit Flashcard, Bulk Edit, Quick Edit) now use the same single-layer backdrop — fixes the double-overlay issue that made some modals abnormally dark
- **Unified layout**: Edit and Bulk Edit modals now match the Add Card modal's header, close button, content padding, and footer button styling
- **Removed black save button**: The Bulk Edit save button now uses the same outlined style as all other modal buttons
- **Proper DOM cleanup**: Closing a custom overlay modal no longer leaves zombie wrapper elements on the page

### Bug fixes
- Fixed narrowed return type in forgetting-curve chart
- Fixed generic type parameter in review-calendar heatmap
- Fixed split import/type import in browser-helpers
- Fixed generic `queryFirst<HTMLElement>` call in title-markdown
- Fixed release type cast in sync-engine
- Removed unused `cachedRows` variable from settings tab
- Removed unused `replaceObjectContents` function from backup module
- Cleaned up dead CSS classes (`sprout-edit-input-full`, `sprout-edit-textarea-full`, `sprout-edit-btn-row`, `sprout-bulk-edit-save`, etc.)

## Installation

### Download the Plugin

Download these three files from the release:
- `main.js`
- `styles.css`
- `manifest.json`

Copy them to: `<Your Vault>/.obsidian/plugins/sprout/`

Then restart Obsidian and enable Sprout in Settings → Community Plugins.

### Build from Source

Download `sprout-1.0.3-source.zip`, extract, and run:

```bash
npm install
npm run build
```

The built files will be in the `dist/` folder.
