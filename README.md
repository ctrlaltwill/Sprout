# Sprout - Flashcards & Spaced Repetition

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/sprout)
[![License](https://img.shields.io/github/license/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/Sprout/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/Sprout/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/sprout/total)
[![CI](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml)
[![Wiki - 30 pages](https://img.shields.io/badge/wiki-30%20pages-blue)](https://github.com/ctrlaltwill/Sprout/wiki)


> [!Important]
> Thank you for all of your support following Sprout’s stable release and subsequent updates. I am actively working through early teething issues. Please raise bugs or feature requests via GitHub Issues.

Sprout is an Obsidian plugin for writing flashcards directly inside Markdown notes and reviewing them with an FSRS-based scheduler.

![Sprout – Demo Image](https://github.com/user-attachments/assets/57fdf7ac-4c89-44c4-b70b-ec09c9b6fa40)

📖 **[Full Documentation & Guides →](https://github.com/ctrlaltwill/Sprout/wiki)**

## Key features

- FSRS-based scheduler for optimised spaced repetition 
- Card types: cloze, basic, multiple choice, image occlusion and more
- Built-in text-to-speech for language learning and audio playback of cards
- Anki import/export _(experimental)_ with scheduling data and media support
- Analytics dashboard with charts and heatmaps
- Inline editor, card browser, and bulk edit tools
- Markdown-first workflow with note-linked cards
- Reading view customisation to keep your notes clean

## Installation

We are waiting on approval to be listed in Obsidian community plugins – watch this space!

### Option 1 — BRAT (Recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is a community plugin for Obsidian that lets you install community plugins and receive updates automatically. Install BRAT, then add `ctrlaltwill/Sprout` as a community plugin.

### Option 2 — Download a release

1. Go to [Releases](https://github.com/ctrlaltwill/Sprout/releases) and download the latest release
2. Copy `main.js`, `styles.css`, and `manifest.json` into:

   ```
   <Your Vault>/.obsidian/plugins/sprout/
   ```
3. Restart Obsidian → Settings → Community Plugins → Enable **Sprout**

### Option 3 — Build from source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/ctrlaltwill/Sprout.git
cd Sprout
npm install
npm run build
```

The built plugin files are output to `dist/`. Copy or symlink that folder into your vault:

```bash
ln -s "$(pwd)/dist" "<Your Vault>/.obsidian/plugins/sprout"
```

Restart Obsidian → Settings → Community Plugins → Enable **Sprout**.

## License

Sprout is released under the **MIT License**.   

See the [full license](LICENSE) for complete details.  
