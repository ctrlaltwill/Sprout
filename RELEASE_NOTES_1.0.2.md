# Release Notes - Sprout 1.0.2

**Release Date:** February 7, 2026

## Overview

Version 1.0.2 is a maintenance release that includes settings reorganization and refinements for Obsidian community plugin approval. This release builds on the foundation of 1.0.0 and 1.0.1, consolidating all core features and improvements.

## What's Included

### Version 1.0.2 Changes
- **Settings reorganization**: Improved grouping and section titles for better clarity
- **Code refinements**: Various code quality improvements and refactoring for Obsidian community standards
- **Type system improvements**: Better TypeScript organization and structure

### Version 1.0.1 Features (included)
- **Anki import/export** _(experimental)_: Import and export decks with scheduling data and media support
- **Hotfixes**: Various bug fixes and stability improvements from initial release

### Version 1.0.0 Core Features (included)
- **FSRS-based scheduler**: Optimised spaced repetition algorithm
- **Card types**: Cloze, basic Q&A, multiple choice, and image occlusion
- **Analytics dashboard**: Charts, heatmaps, and statistics
- **Card browser**: Search, filter, and bulk edit tools
- **Inline editor**: Create and edit cards directly in notes
- **Reading view cards**: Keep your notes clean with excerpt-based cards
- **Markdown-first workflow**: Note-linked cards that stay in sync

## Installation

### Download the Plugin

Download these three files from the release:
- `main.js`
- `styles.css`
- `manifest.json`

Copy them to: `<Your Vault>/.obsidian/plugins/sprout/`

Then restart Obsidian and enable Sprout in Settings → Community Plugins.

### Build from Source

Download `sprout-1.0.2-source.zip`, extract, and run:

```bash
npm install
npm run build
```

The built files will be in the `dist/` folder.

## Documentation

📖 [Full documentation and guides](https://github.com/ctrlaltwill/Sprout/wiki)

## Support

- **Issues**: [GitHub Issues](https://github.com/ctrlaltwill/Sprout/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ctrlaltwill/Sprout/discussions)

## License

MIT License - see [LICENSE](https://github.com/ctrlaltwill/Sprout/blob/main/LICENSE) for details.
