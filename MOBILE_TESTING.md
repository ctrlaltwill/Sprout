# Mobile Testing Guide — Sprout Plugin

## Quick Deploy

```bash
npm run deploy
```

This builds the plugin and copies `main.js`, `main.js.map`, `manifest.json`, and `styles.css` directly into:

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Medicine/.obsidian/plugins/sprout/
```

iCloud syncs these files to your iPhone automatically (usually within 1–2 minutes).

---

## Step-by-Step: Testing on iPhone

### 1. Deploy from Mac

```bash
cd ~/Desktop/Sprout\ Development
npm run deploy
```

### 2. Wait for iCloud Sync

- Open **Files** app on iPhone → iCloud Drive → Obsidian → Medicine
- Navigate to `.obsidian/plugins/sprout/` and verify `manifest.json` is updated
- If files show a cloud icon (not downloaded), tap them to force download

### 3. Reload Plugin on iPhone

- Open Obsidian on iPhone
- Go to **Settings → Community Plugins**
- Toggle **Sprout** off, then back on
- Or: close Obsidian completely (swipe up from app switcher), reopen

### 4. If Plugin Fails to Load

Check the **developer console** on mobile:

1. In Obsidian mobile, open **Settings → Community Plugins**
2. Scroll to bottom → **Debug startup time** (shows which plugins loaded/failed)
3. For full console output: **Settings → About → Toggle "Debug mode"**
4. Reproduce the error, then **Settings → About → "Copy debug info"**

---

## Debugging Techniques

### Remote Safari Web Inspector (Best Method)

This gives you a full desktop-like debugger for iPhone Obsidian:

1. **On iPhone**: Settings → Safari → Advanced → **Web Inspector** = ON
2. **On Mac**: Safari → Settings → Advanced → **Show Develop menu** = ON
3. Connect iPhone to Mac via **USB cable**
4. Open Obsidian on iPhone
5. On Mac: Safari → **Develop** → \[Your iPhone\] → pick the Obsidian WebView
6. You now have Console, Network, Elements, Sources — full DevTools

This is the most powerful debugging option. You can see all `console.log` / `console.error` output, set breakpoints, inspect the DOM, etc.

### Debug Logging via Notice

For quick debugging without Safari Inspector, add temporary `Notice` calls:

```typescript
import { Notice, Platform } from "obsidian";

// In onload() or wherever you're debugging:
if (Platform.isMobileApp) {
  new Notice(`[Debug] onload() reached`, 10000);
}
```

The `10000` keeps the notice visible for 10 seconds.

### Write Debug Log to Vault File

For persistent logging on mobile (survives app restarts):

```typescript
async function mobileLog(app: App, msg: string) {
  if (!Platform.isMobileApp) return;
  const path = "debug-log.md";
  const ts = new Date().toISOString();
  const line = `- ${ts}: ${msg}\n`;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.append(existing, line);
  } else {
    await app.vault.create(path, `# Sprout Debug Log\n${line}`);
  }
}
```

---

## Known Mobile Compatibility Issues

The codebase audit found these items to watch for:

| Priority | Issue | Files | Impact |
|----------|-------|-------|--------|
| **High** | `<a download>.click()` download pattern | analytics-view.ts, anki-export-modal.ts | CSV/APKG direct download won't work on iOS WebView. The "Save to vault" alternative works fine. |
| **Medium** | `localStorage` usage | version-manager.ts | Already wrapped in try/catch — should be safe, but "What's New" modal state may not persist on mobile. |
| **Medium** | sql.js WASM compilation | anki-sql.ts | Lazy-loaded (only on Anki import/export), so won't block startup. May be slow on older iPhones. |
| **Low** | `window.open()` | render-session.ts, sprout-home-view.ts | Behavior varies but generally works. |
| **None** | Image Occlusion editor | image-mask-renderer.ts | Already gated with `Platform.isMobileApp` check — shows "desktop-only" notice. |

### Features That Should Work Fine on Mobile
- Card reviewing (the core loop)
- Flashcard sync
- Widget sidebar
- Card browser
- Analytics charts
- Settings
- Card creation
- Reading view pretty cards

---

## Debugging the "Failed to Load" Error

If the plugin shows "Failed to load" on iPhone, the crash is in `onload()`. The existing code wraps `onload()` in a try/catch that logs to console and shows a Notice. To narrow it down:

### Strategy: Binary Search with Notices

1. Add early Notices in `onload()` to find where it crashes:

```typescript
async onload() {
  try {
    new Notice("[Sprout] Step 1: starting onload", 5000);
    
    this._initBasecoatRuntime();
    new Notice("[Sprout] Step 2: basecoat done", 5000);
    
    initTooltipPositioner();
    new Notice("[Sprout] Step 3: tooltip done", 5000);
    
    // ... etc
```

2. Deploy, reload on iPhone, note which Notice is the last one that appears
3. The crash is between the last visible Notice and the next one
4. Narrow down further within that section

### Most Likely Causes of "Failed to Load" on Mobile

1. **Basecoat runtime** — `window.basecoat` may not exist on mobile
   - Already guarded with null check ✅
2. **React/ReactDOM** — should work fine in mobile WebView ✅
3. **`structuredClone`** — available since iOS 15.4, Obsidian requires iOS 16+ ✅
4. **Import side-effects** — a static import might do something mobile-incompatible at module evaluation time (before `onload()` even runs)
   - This is the hardest to debug; use Safari Web Inspector to see the actual error

### Checking for Import-Time Errors

If no Notices appear at all (crash before `onload()`), the issue is at **import/module evaluation time**. Check:

```typescript
// Add at the very top of main.ts, before any imports:
console.error("[Sprout] main.ts module evaluation starting");
```

If even this doesn't appear, the bundled `main.js` itself has a parse error — check the build output.

---

## Release Checklist

When ready to release, remember to set `isDesktopOnly` back to `true` in the **production** manifest if mobile isn't ready yet:

```json
{
  "isDesktopOnly": true
}
```

The dev manifest at `Sprout Development/manifest.json` is currently set to `false` for mobile testing.
