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
  "1.0.5": {
    version: "1.0.5",
    title: "1.0.5",
    releaseDate: "2025-06-15",
    content: `
# New Features
- Multi-select questions (subtype of multiple choice)
- Reversed and ordered question support
- In-app wiki/guide
- New settings view

## Improvements
- Plugin scaling support
- Text selection enabled for copying card content
- Text-to-speech and audio support for questions
- Custom delimiters
- Custom styling for reading view, clozes, and image occlusion masks
- Data security fixes

## Bug Fixes
- Fixed tooltips
- Modal background is now limited to the workspace to allow switching tabs
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
