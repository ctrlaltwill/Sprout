# Contributing to Sprout

Thanks for helping to improve Sprout

This document focuses on the workflow for translating the plugin to improve localisation.

## Translation policy

- UI translations are stored as JSON files in the repository under `src/platform/translations/locales/`.
- Locale files are build assets: they are bundled into `main.js` at build time. Because of this languages are added 

## Add or update a language

1. Copy `src/platform/translations/locales/en-gb.json` to a new locale file, for example `src/platform/translations/locales/es.json`.
2. Translate values only. Do not rename token keys.
3. Keep placeholders unchanged (example: `{language}`, `{count}`).
4. Add the locale to the registry in `src/platform/translations/locale-registry.ts`.
5. Run checks:
   - `npm run translations:check`
   - `npm run test`
6. Open a pull request with:
   - target language and region (for example `es-ES` vs `es-419`)
   - whether it is new translation or improvements
   - any terms that need glossary discussion

## Translation quality guidelines

- Prefer natural, concise wording over literal translation.
- Keep punctuation/capitalisation consistent with other locales.
- Avoid product-specific slang unless present in source English.
- Preserve semantic meaning of flashcard/review/scheduling terms.

## Review process

- A second native/proficient speaker per language must review the file before merge.
- Keep changes focused: one locale per PR when possible.
- Use follow-up PRs for terminology refinements.

## Token design rules

- Tokens are stable identifiers (for example `settings.general.interfaceLanguage.name`).
- Do not derive tokens from raw English text.
- New UI copy must add a token in English first, then optional locale overlays.

## Reporting translation issues

Open an issue and include:

- locale code
- token key(s)
- current text vs proposed text
- context or screenshot (if useful)
