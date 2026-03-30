---
title: "Localization Debt"
---

# Localization Debt

This page is a contributor-facing tracker for parts of LearnKit that still need better translation coverage.

If you are just using LearnKit, you can ignore this page.

## What "localization debt" means here

Localization debt is user-facing text that still exists as hardcoded English instead of going through LearnKit's translation system.

That usually affects:

- settings labels
- modal copy
- notices and toasts
- command names
- reviewer controls

## Current priority order

These areas were identified as the highest-value places to keep translating next:

1. `src/views/settings/settings-tab.ts`
2. `src/platform/modals/anki-import-modal.ts`
3. `src/platform/modals/anki-export-modal.ts`
4. `src/views/settings/confirm-modals.ts`
5. `src/views/reviewer/render-session.ts`
6. `src/views/reminders/gatekeeper-modal.ts`
7. `src/platform/card-editor/card-editor.ts`
8. `src/main.ts`

## Translation namespaces

The current naming conventions are:

- `ui.common.*` for shared actions such as save, close, next, and back
- `ui.notice.*` for toasts and runtime feedback
- `ui.modal.*` for modal-specific copy
- `ui.settings.*` for settings pages
- `ui.command.*` for command palette and menu names

## Recommended workflow

When localizing a new area:

1. add keys to the locale files
2. replace hardcoded literals with the translation helper used in that module
3. mirror the keys across the English locale files
4. run the translation checks

## Validation commands

Use these checks after localization work:

- `npm run translations:check`
- `npm run i18n:literals:check`

The baseline-aware literal checker lives in `tooling/check-i18n-literals.mjs` and uses `tooling/i18n-literal-baseline.json`.

Last modified: 30/03/2026
