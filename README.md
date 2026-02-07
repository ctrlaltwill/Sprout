# Sprout - Flashcards & Spaced Repetition

[![Release](https://img.shields.io/github/v/release/ctrlaltwill/Sprout?display_name=tag)](https://github.com/ctrlaltwill/Sprout/releases)
[![License](https://img.shields.io/github/license/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/Sprout/blob/main/LICENSE)
[![CI](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml)

Sprout is an Obsidian plugin for writing flashcards directly inside Markdown notes and reviewing them with an FSRS-based scheduler.

> **Release 1.0.1** — Anki import/export, plus hotfixes from the original release.

📖 **[Full Documentation & Guides →](https://github.com/ctrlaltwill/Sprout/wiki)**

## Key features

- FSRS-based scheduler for optimised spaced repitition 
- Card types: cloze, basic, multiple choice, and image occlusion
- Anki import/export (.apkg) with scheduling data and media support
- Analytics dashboard with charts and heatmaps
- Inline editor, card browser, and bulk edit tools
- Markdown-first workflow with note-linked cards
- Reading view cards for excerpts and highlights to keep your notes clean

## Installation

We are waiting on approval to be listed in Obsidian community plugins – watch this space!

### Option 1 — BRAT (Beta Reviewers Auto-Update Tester – Recommended)

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


## Screenshots
<img width="3476" height="1069" alt="Row 1" src="https://github.com/user-attachments/assets/3d1bd95d-a14f-4dec-915b-2d11a475fa94" />
<img width="3476" height="1069" alt="Row 2" src="https://github.com/user-attachments/assets/c6ca005e-547a-4b03-9641-5404494839ba" />

## License

Sprout is released under the **MIT License**.   

See the [full license](LICENSE) for complete details.  
