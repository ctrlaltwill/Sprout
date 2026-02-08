# Changelog

All notable changes to Sprout will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-02-08

### Added
- Scheduling-data-only backups (smaller file sizes)
- Automatic backup interval (15 minutes)
- Automatic retention limit (keeps 5 most recent backups)

### Changed
- Reorganized settings into clearer sections: General, Study, Scheduling, and Storage
- Improved labels and descriptions for all settings
- Automatic migration of existing settings on first load
- Consistent overlay across all modals (Add Card, Edit Flashcard, Bulk Edit, Quick Edit)
- Unified layout, header, and button styling

### Fixed
- Proper DOM cleanup when closing modals
- Fixed type issues in forgetting-curve chart and review-calendar heatmap
- Fixed import statements in browser-helpers and title-markdown
- Removed unused variables and dead CSS classes

## [1.0.2] - 2026-02-07

### Changed
- Improved grouping and section titles for better settings clarity
- Enhanced documentation for each setting
- Code refinements for Obsidian community plugin standards
- Better TypeScript organization and type system improvements

## [1.0.1] - 2026-02-06

### Added
- Anki import (.apkg): Import cards with scheduling data, deck/tag mapping, and duplicate handling
- Anki export (.apkg): Export cards with FSRS state, review history, and media files

### Fixed
- Reading view rendering fixes
- Various stability improvements

## [1.0.0] - 2026-02-05

### Added
- First stable release - code refactored and source shared publicly on Github
- FSRS-based spaced repetition scheduler
- Multiple card types: basic, cloze, multiple choice, and image occlusion
- Analytics dashboard with charts and heatmaps
- Card browser with search, filter, and bulk edit tools
- Inline editor for creating and editing cards directly in notes
- Reading view cards for excerpts and highlights
- Markdown-first workflow with note-linked cards

## [0.04] - 2024-01-26

### Added
- Scheduling data backups

### Changed
- Improved CSS styling (dark mode and reading-view)

## [0.03] - 2024-01-19

### Added
- Rebranded as Sprout
- Image occlusion cards
- Analytics dashboard

## [0.02] - 2024-01-12

### Fixed
- Fixes focused on deck and session stability

## [0.01] - 2024-01-05

### Added
- First beta release (named Boot Camp)
- Core flashcard functionality
- FSRS-based spaced repetition
- Basic card types (cloze, basic, multiple choice)

[1.0.3]: https://github.com/ctrlaltwill/Sprout/releases/tag/1.0.3
[1.0.2]: https://github.com/ctrlaltwill/Sprout/releases/tag/1.0.2
[1.0.1]: https://github.com/ctrlaltwill/Sprout/releases/tag/1.0.1
[1.0.0]: https://github.com/ctrlaltwill/Sprout/releases/tag/1.0.0
