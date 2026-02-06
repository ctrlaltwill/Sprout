# Obsidian Plugin Dev Environment (Single-file bundle)

This scaffold compiles **src/main.ts** into **plugin/main.js** using **esbuild**.
The **plugin/** folder is your deployable Obsidian plugin folder (contains `manifest.json` + `main.js`).

## Prerequisites
- Node.js 18+ recommended

## Install
```bash
npm install
```

## Development (watch)
```bash
npm run dev
```

## Production build (minified)
```bash
npm run build
```

## How to install into an Obsidian vault for testing

1. Build once (`npm run build`) or start watch (`npm run dev`).
2. Copy the **plugin/** folder into your vault:
   - `<Your Vault>/.obsidian/plugins/boot-camp-for-obsidian-dev/`
3. In Obsidian: Settings → Community plugins → enable the plugin.

Tip: When using `npm run dev`, you can keep a symlink from the vault plugin folder to this scaffold's **plugin/** folder.

## Notes
- The `obsidian` module is marked **external** so it is not bundled.
- Source maps are enabled in non-prod mode for easier debugging.
