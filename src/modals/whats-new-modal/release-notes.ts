/**
 * @file src/modals/whats-new-modal/release-notes.ts
 * @summary Release notes content for each version of Sprout.
 * 
 * Add a new entry here for each release to display in the What's New modal.
 * Content supports markdown formatting.
 * 
 * @exports RELEASE_NOTES - Map of version strings to release note content
 */

export interface ReleaseNote {
  version: string;
  title: string;
  content: string;
  releaseDate?: string;
}

/**
 * Release notes for each version.
 * Format: version -> content (markdown supported)
 * 
 * To add a new release:
 * 1. Copy release notes from GitHub releases
 * 2. Add a new entry with the version number as the key
 * 3. The modal will automatically show for users upgrading to that version
 */
export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  "1.0.5-beta.1": {
    version: "1.0.5-beta.1",
    title: "1.0.5 Beta 1",
    releaseDate: "2026-02-16",
    content: `
# New card types
- Multi-select MCQ and ordered questions for memorising sequences

## Card customisation
- Typed cloze support
- Customisation of image occlusion masks

## Reading view
- Overhaul with two styles: Flashcards and Clean markdown
- Additional styles and full Custom support are planned for a future update

## Settings and guide
- New settings view with more control
- Updated guide, visible directly within Obsidian

## Fixes
- Modal background/overlay is now limited to the workspace to allow tab-switching

## Notes
- This is a pre-release build targeting final version 1.0.5
- If scheduling or analytics data is missing after update, restore from backup
    `.trim(),
  },

  "1.0.4": {
    version: "1.0.4",
    title: "1.0.4",
    releaseDate: "2025-05-20",
    content: `
## Improvements
- Enhanced stability and performance optimizations

## Bug Fixes
- Minor bug fixes and code refinements
    `.trim(),
  },

  "1.0.3": {
    version: "1.0.3",
    title: "1.0.3",
    releaseDate: "2025-05-10",
    content: `
## Improvements
- Updates to Sprout settings page
- General stability improvements

## Bug Fixes
- Minor fixes
    `.trim(),
  },

  "1.0.2": {
    version: "1.0.2",
    title: "1.0.2",
    releaseDate: "2025-05-01",
    content: `
## Improvements
- Code refinements for submission to Obsidian community plugins
- Code quality improvements
    `.trim(),
  },

  "1.0.1": {
    version: "1.0.1",
    title: "1.0.1",
    releaseDate: "2025-04-20",
    content: `
# New Features
- Anki import/export functionality (experimental)

## Improvements
- Stability hotfixes and performance optimizations
    `.trim(),
  },

  "1.0.0": {
    version: "1.0.0",
    title: "1.0.0",
    releaseDate: "2025-04-01",
    content: `
# New Features
- First stable release of Sprout
- Code refactored and source shared publicly on GitHub
- Production-ready for wider use
    `.trim(),
  },
};

/**
 * Get release notes for a specific version
 */
export function getReleaseNotes(version: string): ReleaseNote | null {
  return RELEASE_NOTES[version] || null;
}

/**
 * Check if release notes exist for a version
 */
export function hasReleaseNotes(version: string): boolean {
  return version in RELEASE_NOTES;
}
