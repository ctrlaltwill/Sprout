## Overview

## Option 1 — Download a release

1. Go to [Releases](https://github.com/ctrlaltwill/Sprout/releases) and download the latest release
2. Copy `main.js`, `styles.css`, and `manifest.json` into:
   ```
   <Your Vault>/.obsidian/plugins/sprout/
   ```
3. Restart Obsidian → Settings → Community Plugins → Enable **Sprout**

## Option 2 — Build from source

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

### Development scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Watch mode — rebuilds JS + CSS on every file change |
| `npm run build` | Production build (minified JS + CSS), copies manifest into `dist/` |

## Option 3 — BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian community plugins
2. In BRAT settings, add `ctrlaltwill/Sprout` as a community plugin
3. BRAT will install and keep the plugin updated automatically
