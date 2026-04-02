/**
 * @file src/platform/core/release-notes.ts
 * @summary Module for release notes.
 *
 * @exports
 *  - ReleaseNote
 *  - RELEASE_NOTES
 *  - getReleaseNotes
 *  - hasReleaseNotes
 */

export interface ReleaseNote {
  version: string;
  title: string;
  content: string;
  releaseDate?: string;
}

export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  "1.2.5": {
    version: "1.2.5",
    title: "1.2.5",
    releaseDate: "2026-03-27",
    content: `
# LearnKit 1.2.5
LearnKit 1.2.5 is a quality update focused on mobile support, settings clarity, and AI-assisted workflow improvements.

## What's Changed

### Mobile support (WIP)
- Better support for mobile app usage across key study and settings surfaces.
- Continued responsive and interaction polish for smaller screens.

### Settings copy updates
- Updated settings labels and descriptions to improve clarity and reduce ambiguity.

### AI tools context and attachments
- Updated settings for attachments and context handling in AI-powered tools.
- Improved defaults and wording for study assistant context sources.

## What's New
- More consistent context-source behavior in study assistant generation.
- Better attachment flow coverage in AI-related study workflows.
- New context-limit presets for linked notes and text attachments (Conservative, Standard, Extended, No limit).
- New scheduling option to enable interval fuzzing for better due-date spread.
- Additional UI polish across review, modal, and settings experiences.
    `.trim(),
  },

  "1.2.0": {
    version: "1.2.0",
    title: "1.2.0",
    releaseDate: "2026-03-18",
    content: `
# LearnKit 1.2.0
LearnKit 1.2.0 is a major overhaul release focused on making study workflows more powerful inside Obsidian.

## What's New

### Tests
- Added Tests for auto-generating study tests from your notes and learning context.
- Use Tests to quickly build structured question rounds and identify weak areas.

### Coach
- Added Coach to help you turn note content into guided learning prompts and focused practice.
- Coach is designed to shorten the gap between reading and active recall.

### Note Review
- Added Note Review workflows to support pass/fail review loops on notes.
- Note Review helps bring your notes into the same spaced repetition loop as your cards.

## Project Direction
- LearnKit is still in its infancy, and this release is an early foundation for what comes next.
- There will be bugs and rough edges while we continue iterating quickly.
- We appreciate all of our early users and everyone sharing feedback.

## Open Source Mission
- We are building an open source study plugin for Obsidian that expands core functionality.
- The long-term goal is to bring LearnKit closer to the depth of premium subscription study platforms, while keeping your data local and under your control.
    `.trim(),
  },

  "1.1.0": {
    version: "1.1.0",
    title: "1.1.0",
    releaseDate: "2026-03-10",
    content: `
# LearnKit 1.1.0
Release 1.1.0 focused on introducing Companion, the built-in AI companion.

## What's New

### Companion - AI Companion
- Bring your own API key support so you can connect your preferred model provider.
- Ask questions about your notes and study material directly inside LearnKit.
- Review your notes with AI-assisted summaries and guided understanding prompts.
- Generate flashcards from your existing notes to speed up deck creation. These flashcards are context aware, and clicking on them in the chat will show what part of your note was used to inform their creation.
- Configure Companion settings for provider details, key management, and companion behavior.

## What's Updated

### Data Storage
- Transitioned storage from JSON to SQLite to improve reliability, scalability, and data consistency as LearnKit grows.

### Image Occlusion Editor
- Added **Auto-Mask** feature in the IO editor toolbar to detect text regions and create masks automatically.

### Reviewer
- Enabled grading-card interval duration hints by default so next-interval timing appears under grade buttons.

## Coming Next

### Sync Efficiency
- Future updates will focus on syncing data more efficiently so LearnKit can avoid full database updates every session.
    `.trim(),
  },

  "1.0.6": {
    version: "1.0.6",
    title: "1.0.6",
    releaseDate: "2026-02-18",
    content: `
# Sprout 1.0.6
Version 1.0.6 is a compatibility release focused on Obsidian Community Plugins linter compliance for plugin approval.

## What's Changed

### Compatibility
- Updated plugin code and metadata for compatibility with Obsidian Community Plugins linter requirements
- Applied targeted compatibility tidy-up to support the approval process

### Fixes
- Resolved linter-related compatibility findings that could block community plugin approval

## Notes
- This is a compatibility and approval-readiness release with no user-facing feature changes
    `.trim(),
  },

  "1.0.5": {
    version: "1.0.5",
    title: "1.0.5",
    releaseDate: "2026-02-18",
    content: `
# Sprout 1.0.5
Version 1.0.5 is a major feature release introducing new card types, reading view styles, and deeper card customisation, building on the 1.0.5-beta.1 pre-release.

## What's Changed

### Cards and customisation
- Multi-select MCQ: multiple correct answers selectable per question
- Ordered questions: memorise sequences by arranging items in the correct order
- Typed cloze: type the answer directly into cloze deletion cards
- Image occlusion mask customisation: adjust mask appearance and styling

### Reading view
- Overhaul with two distinct styles: Flashcards and Clean markdown
- Additional styles and full Custom Reading style support planned for a future update

### Settings and guide
- New settings view with expanded controls and clearer organisation
- Updated in-app guide surfaced directly within Obsidian

### Fixes
- Modal background/overlay scoped to workspace so tab-switching remains available

## In development
- Mobile functionality support
- Continued bug-fix and stability updates
- Reading view enhancements and additional style support
- Codebase tidy-up focused on extensibility

## Notes
- If scheduling or analytics data is missing after update, restore from backup
    `.trim(),
  },

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

export function getReleaseNotes(version: string): ReleaseNote | null {
  return RELEASE_NOTES[version] || null;
}

export function hasReleaseNotes(version: string): boolean {
  return version in RELEASE_NOTES;
}
