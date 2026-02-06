# Sprout - Flashcards & Spaced Repetition in Obsidian

Sprout is a plugin for writing flashcards directly inside Markdown notes and reviewing them within Obsidian with an FSRS-based scheduler.

> **Beta 0.0.5** — major update with new UI, analytics dashboard, image occlusion, and reading view cards.

📖 **[Documentation & Guides →](https://github.com/ctrlaltwill/Sprout/wiki)**

## Installation

### Option 1 — Download a release

1. Go to [Releases](https://github.com/ctrlaltwill/Sprout/releases) and download the latest release
2. Copy `main.js`, `styles.css`, and `manifest.json` into:
   ```
   <Your Vault>/.obsidian/plugins/sprout/
   ```
3. Restart Obsidian → Settings → Community Plugins → Enable **Sprout**

### Option 2 — Build from source

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

### Option 3 — BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add `ctrlaltwill/Sprout` as a beta plugin.

## License

[MIT](LICENSE)
