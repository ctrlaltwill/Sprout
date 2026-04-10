# Contributing to LearnKit

Thanks for helping to improve LearnKit.

This document covers the workflow for translating the plugin into new languages.

## How translation works

UI strings are wrapped with `t(locale, "token.key", "English fallback")`. At build time, JSON locale files from `src/platform/translations/locales/` are bundled into the plugin. If a token is missing from a locale file the English fallback is used automatically, so partial translations work fine.

## Contributor workflow

### Step 1 — You create the locale JSON

1. Copy `src/platform/translations/locales/en-gb.json` to a new file named with the [IETF language tag](https://en.wikipedia.org/wiki/IETF_language_tag), for example `zh-cn.json`.
2. Translate **values only**. Do not rename or remove token keys.
3. Keep placeholders exactly as-is (e.g. `{count}`, `{language}`).
4. Open a pull request with:
   - the new JSON file only (do **not** edit `locale-registry.ts` or `translator.ts`)
   - target language and region (e.g. `zh-CN` vs `zh-TW`)
   - whether this is a new translation or an improvement to an existing one
   - any terms that need glossary discussion
5. A reviewer (a second native or proficient speaker) comments on the PR with feedback. Address any suggestions and push updates until approved.

### Step 2 — Reviewer approves

The reviewer checks for:

- natural, concise wording (not overly literal)
- consistent punctuation and capitalisation with other locales
- correct preservation of placeholder tokens
- faithful meaning for flashcard, scheduling, and review terminology

### Step 3 — Maintainer merges and wires in

After review approval the maintainer:

1. Adds the locale entry to the registry in `src/platform/translations/locale-registry.ts`.
2. Imports the new JSON file in `src/platform/translations/translator.ts` and adds it to the `MESSAGE_BUNDLES` map.
3. Runs lint, tests, and build to verify.
4. Merges the PR.

## Translation quality guidelines

- Prefer natural, concise wording over literal translation.
- Keep punctuation and capitalisation consistent with other locales.
- Avoid product-specific slang unless present in the source English.
- Preserve the semantic meaning of flashcard, review, and scheduling terms.

## PR guidelines

- One locale per PR when possible.
- Use follow-up PRs for terminology refinements.
- For minor corrections to an existing locale, open a focused PR with just the changed keys.

## Reporting translation issues

Open an issue and include:

- locale code
- token key(s)
- current text vs proposed text
- context or screenshot (if useful)
