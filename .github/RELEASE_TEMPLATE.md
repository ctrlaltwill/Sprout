# Release Notes Template

Use this template when creating new releases. Replace placeholders with actual content.

---

### Release Date

[Month Day, Year]

### Summary

Version [X.Y.Z] is a [describe type: e.g., "quality-of-life release focused on...", "major update featuring...", "maintenance release with..."]

## What's Changed

### [Section Title - e.g., "New Features", "Settings Overhaul", "Bug Fixes"]

• [Change description]
• [Change description]
• [Change description]

### [Another Section Title]

• [Change description]
• [Change description]

### [Optional: Dependency Updates]

• Merged #[PR number]: [PR title]
• Merged #[PR number]: [PR title]

### [Optional: Minor Fixes]

• [Fix description]
• [Fix description]

---

## Example Release Notes (v1.0.3)

### Release Date

February 8, 2026

### Summary

Version 1.0.3 is a quality-of-life release focused on settings reorganization, backup improvements, and modal consistency.

## What's Changed

### Settings Overhaul

• Reorganized settings into clearer sections: General, Study, Scheduling, and Storage
• Improved labels and descriptions for all settings
• Automatic migration of existing settings on first load

### Backup System

• Scheduling-data-only backups (smaller file sizes)
• Automatic backup interval (15 minutes)
• Automatic retention limit (keeps 5 most recent backups)

### Modal Styling

• Consistent overlay across all modals (Add Card, Edit Flashcard, Bulk Edit, Quick Edit)
• Unified layout, header, and button styling
• Proper DOM cleanup when closing modals

### Bug Fixes

• Fixed type issues in forgetting-curve chart and review-calendar heatmap
• Fixed import statements in browser-helpers and title-markdown
• Removed unused variables and dead CSS classes
