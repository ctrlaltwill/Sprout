# Sprout

Sprout is a plugin for writing flashcards directly inside Markdown notes and reviewing them within Obsidian with an FSRS-based scheduler. It is currently in open beta.

> **Beta 0.0.5** has just been released — this is a massive update to the plugin. A tutorial, better description and screenshots of the new user interface will be updated in the coming weeks.

## Features

- **Write cards in Markdown** — basic, cloze, MCQ, and image occlusion cards right inside your notes
- **FSRS-based scheduling** — spaced repetition powered by the FSRS algorithm
- **Study sessions** — review due cards by vault, folder, note, or group
- **Card browser** — search, filter, edit, suspend, and manage all cards
- **Analytics dashboard** — heatmaps, forgetting curves, stability charts, and more
- **Reading view** — pretty-card rendering with masonry layout
- **Image occlusion** — mask regions of images for visual learning

## Installation

### Option 1 — Download a release

1. Go to [Releases](https://github.com/ctrlaltwill/Sprout/releases) and download the latest `.zip`
2. Extract the contents (`main.js`, `styles.css`, `manifest.json`) into:
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

This outputs `main.js`, `styles.css`, and `manifest.json` into the `dist/` folder.

To install into your vault, either copy `dist/` or symlink it:

```bash
# Symlink (recommended for development)
ln -s "$(pwd)/dist" "<Your Vault>/.obsidian/plugins/sprout"
```

Then restart Obsidian → Settings → Community Plugins → Enable **Sprout**.

### Option 3 — BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add `ctrlaltwill/Sprout` as a beta plugin.

## Development

```bash
npm run dev       # Watch mode — rebuilds JS + CSS on file changes
npm run build     # Production build (minified)
```

| Script | What it does |
|--------|-------------|
| `npm run dev` | Watches `src/` and rebuilds `dist/main.js` + `dist/styles.css` on every change |
| `npm run dev:js` | Watch mode for JS/TS only (esbuild) |
| `npm run dev:css` | Watch mode for CSS only (Tailwind + PostCSS) |
| `npm run build` | Production build — minified JS + CSS, copies `manifest.json` into `dist/` |

## Writing cards

Cards are pipe-delimited lines in any Markdown note. Each line starts and ends with a pipe `|`.

**Fields:** `T` (title, optional), `Q` (question), `A` (answer), `CQ` (cloze question), `MCQ` (MCQ stem), `O` (option), `I` (info, optional), `G` (groups, optional)

### Basic

```
T | Title |
Q | What is the capital of France? |
A | Paris |
I | Located on the River Seine |
G | Geography |
```

### Cloze

```
T | Title |
CQ | The capital of France is {{c1::Paris}} |
```

### MCQ

```
T | Title |
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
O | Madrid |
I | Remember: it's on the Seine |
```

### Card identity

After syncing, each card gets an anchor: `^sprout-#########`. Do not edit or delete this anchor — it links the card to its scheduling data.

## Screenshots

| | |
|---|---|
| ![Deck Browser](screenshots/Deck%20Browser.png) | ![Basic](screenshots/Basic.png) |
| ![MCQ](screenshots/MCQ.png) | ![Flashcard Browser](screenshots/Flashcard%20Browser.png) |
| ![Settings](screenshots/Settings.png) | ![Basic + Menu](screenshots/Basic%20%2B%20Menu.png) |

## License

[MIT](LICENSE)
