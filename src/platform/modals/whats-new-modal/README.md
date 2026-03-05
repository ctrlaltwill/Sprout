# What's New Modal System

A clean, well-structured module for displaying release notes after version upgrades.

## Features

✅ **Automatic version detection** - Shows modal only when upgrading to a new version  
✅ **Per-version dismissal** - "Don't show again" checkbox is version-specific  
✅ **Configurable content** - Easy-to-edit release notes in `release-notes.ts`  
✅ **Persistent backup hint** - Always shows tip about backup restoration  
✅ **Clean UI** - Beautiful, accessible modal with markdown support  

## File Structure

```
src/
├── core/
│   └── version-manager.ts          # Version upgrade detection logic
└── modals/
    └── whats-new-modal/
        ├── WhatsNewModal.tsx        # React modal component
        ├── release-notes.ts         # Release notes configuration
        ├── whats-new-modal.css     # Modal styles
        └── index.ts                # Module exports
```

## How It Works

### 1. Version Detection

The system uses Obsidian's plugin data store (`data.json`) to track:
- **Last seen version**: The last version for which the user opened the app
- **Dismissed versions**: Versions the user explicitly dismissed with "don't show again"

When the plugin loads:
1. Reads current version from `manifest.json`
2. Compares with last seen version
3. If upgraded AND user hasn't dismissed the new version → show modal
4. If first time user → silently save version (no modal)

### 2. Adding Release Notes

To add notes for a new release:

**Option 1: Copy from GitHub Releases**

1. Open [GitHub Releases](https://github.com/ctrlaltwill/Sprout/releases/)
2. Copy the release notes markdown
3. Add to `release-notes.ts`:

```typescript
export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  "1.0.5": {
    version: "1.0.5",
    title: "What's New in 1.0.5",
    content: `
### New Features
- Feature A: Description
- Feature B: Description

### Bug Fixes
- Fixed issue X
- Fixed issue Y

### Improvements
- Performance optimization
    `.trim(),
  },
  // ... existing versions
};
```

**Option 2: Write Custom Notes**

```typescript
"1.0.5": {
  version: "1.0.5",
  title: "Major Update 🎉",
  content: `
## Welcome to Version 1.0.5!

This release introduces several exciting improvements:

- **New analytics dashboard** with interactive charts
- **Improved card editor** with better markdown support
- **Bug fixes** for stability and performance

### Important
If scheduling data was wiped, restore from **Settings → Storage and Backup**.
  `.trim(),
},
```

### 3. Markdown Support

The modal supports common markdown:
- Headings: `#`, `##`, `###`
- Bold: `**text**` or `__text__`
- Italic: `*text*` or `_text_`
- Code: `` `code` ``
- Links: `[text](url)`

### 4. Integration

The modal is automatically shown on plugin load via `main.ts`:

```typescript
this.app.workspace.onLayoutReady(() => {
  // Other initialization...
  
  // Check for version upgrades and show What's New modal
  this._checkAndShowWhatsNewModal();
});
```

## API Reference

### `version-manager.ts`

```typescript
// Check if modal should be shown for current version
checkForVersionUpgrade(currentVersion: string): {
  shouldShow: boolean;
  version?: string;
}

// Mark version as seen/dismissed
markVersionSeen(version: string, dontShowAgain: boolean): void

// Compare version strings (semantic versioning)
compareVersions(v1: string, v2: string): number

// Get last seen version
getLastSeenVersion(): string | null

// Clear all tracking (for testing)
clearVersionTracking(): void
```

### `release-notes.ts`

```typescript
// Get release notes for a specific version
getReleaseNotes(version: string): ReleaseNote | null

// Check if notes exist for a version
hasReleaseNotes(version: string): boolean
```

## Testing

To test the modal locally:

```typescript
import { clearVersionTracking } from './core/version-manager';
clearVersionTracking();
// Then trigger a plugin save and reload
```

## Customization

### Change backup hint

Edit the hint in `WhatsNewModal.tsx`:

```tsx
<div className="whats-new-modal-hint-content">
  <strong>Tip:</strong> Your custom message here.
</div>
```

### Modify styles

Edit `whats-new-modal.css` to customize colors, spacing, animations, etc.

### Add version to release notes config

Edit `release-notes.ts` to add content for new versions. The modal will automatically show when users upgrade to versions with notes defined.

## Storage

The system uses Obsidian's plugin data store (`data.json`) under the `versionTracking` key:
- `lastSeenVersion` — Last seen version string
- `dismissedVersions` — Array of dismissed version strings

Version tracking data is loaded into memory at startup via `loadVersionTracking()` and
persisted alongside `settings` and `store` during the normal plugin save cycle.

## Notes

- Modal only shows ONCE per version upgrade
- First-time users don't see the modal
- "Don't show again" prevents modal for that specific version only
- New versions will still show the modal even if previous versions were dismissed
- Modal can be closed by clicking overlay, close button, or "Got it!" button
