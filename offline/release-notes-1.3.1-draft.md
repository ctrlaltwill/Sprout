### Release Date
TBD (draft)

### Baseline
Tracked since initial 1.3.0 release commit: `104dc522` (`release: publish 1.3.0 stable`).

### Summary
LearnKit 1.3.1 focuses on post-1.3.0 hardening: AI compatibility workflows and docs reliability, issue-template cleanup, CI/lint polish, and a broader UI consistency pass across settings, browser density controls, analytics filters, home actions, reviewer controls, and exam-generator buttons.

## What's New
- Added AI compatibility matrix runner flow and supporting model docs workflow.
- Expanded and normalized companion compatibility documentation tables (including attachment capability presentation and row-level comments).
- Added additional guide pages and alphabetized guide navigation/sidebar entries for clearer documentation discovery.

## What's Changed
- Refined Companion and TTS issue-template routing, filenames, and `.yml` usage.
- Removed invalid issue-template labels and simplified AI issue forms.
- Refreshed CI/lint pipeline details tied to AI-related lint cleanup.
- Updated docs search theming and FSRS settings documentation surfaces.
- Consolidated release artifacts housekeeping after 1.3.0.

## UI and UX Polish (current branch changes)
- Settings tab switching now supports pending initial tab selection when opening settings from other views, reducing tab-switch stutter during first render.
- Header/settings navigation now preserves smoother tab-entry behavior when already on the settings leaf.
- Standardized active-state styling across filter/segmented buttons by removing mixed control classes and using shared outline-muted active rules.
- Updated button treatments in key surfaces:
  - Home quick study action
  - Reviewer deck "Study all" and group trigger controls
  - Exam generator "Saved tests" and "Back to tests" actions
- Improved disabled/active affordances for analytics filters, browser density toggles, and session timer controls (consistent non-interactive visual style).
- Adjusted settings guide layout with a floating footer dock on desktop and mobile fallback behavior.
- Improved settings popover alignment/width handling for long labels and no-wrap rows.
- Minor spacing and typography adjustments across note review, browser textareas, and settings/about content rows.

## Fixes
- Removed redundant tab reanimation calls and no-op AOS refresh in settings render flow.
- Corrected note-review strip class naming to align with updated style hooks.
- Resolved several duplicated class-name patterns in exam-generator action button definitions.

## Commit Highlights Since 1.3.0 Baseline
- `081a1c5a` chore: remove release/1.3.0 repo artifacts
- `5eadab33` docs: update 1.3.0 release callout
- `6d9eb3e8` chore: untrack offline notes directory content
- `0d6305f5` to `ab72c1fc`: companion/docs/issue-form/compatibility table refinements and additions
- `6231bb6d`: AI lint and CI workflow refresh
- `9e1326d6`: AI compatibility matrix runner + docs + lint fixes
- `7500fa9b`: release artifacts refresh and reviewer timer fix follow-up

## Testing and Validation Checklist
- [ ] `npm run lint`
- [ ] `npm run build:local`
- [ ] Smoke-check settings tab deep-linking from header and navigation methods
- [ ] Smoke-check guide footer behavior on desktop and mobile
- [ ] Smoke-check browser density active-state buttons and analytics filter active states

## Notes
This is a working draft for 1.3.1 and can be trimmed/rephrased into final release copy once QA pass and changelog cut are complete.
