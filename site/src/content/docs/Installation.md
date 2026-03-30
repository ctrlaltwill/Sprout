---
title: "Installation"
---


LearnKit is currently waiting for official Obsidian Community Plugins approval.

For now, install it manually from Releases or use BRAT.

## Recommended Method: Manual Install From Releases

1. Open [Releases](https://github.com/ctrlaltwill/LearnKit/releases).
2. Download the latest `main.js`, `styles.css`, and `manifest.json`.
3. Copy them into:

   ```
   <Your Vault>/.obsidian/plugins/learnkit/
   ```

4. Restart Obsidian.
5. Open Settings, then Community Plugins, then enable LearnKit.

## Alternative Method: BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Obsidian Community Plugins.
2. Open BRAT settings.
3. Add `ctrlaltwill/LearnKit` as a custom plugin source.
4. Let BRAT install LearnKit.
5. Enable LearnKit in Obsidian Community Plugins if it does not enable automatically.

Use BRAT if you want easier updates before official Community Plugins approval lands.

## Install From Source

This is mainly for development or local testing.

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/ctrlaltwill/LearnKit.git
cd LearnKit
npm install
npm run build
```

Then link or copy the built output into your vault:

```bash
ln -s "$(pwd)/dist" "<Your Vault>/.obsidian/plugins/learnkit"
```

Restart Obsidian and enable LearnKit.

## Check That Installation Worked

You should be able to:

- enable LearnKit in Community Plugins
- open LearnKit settings
- see LearnKit commands in the command palette

If installation succeeds but no cards appear later, the next page you want is [Syncing](../Syncing), not a reinstall.

## Development Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Rebuilds JS and CSS on file change |
| `npm run build` | Produces a production build in `dist/` |

## Next Step

- [Getting Started](../Getting-Started)
- [Syncing](../Syncing)

---

Last modified: 30/03/2026