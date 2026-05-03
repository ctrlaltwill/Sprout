# Contributing to LearnKit

Thanks for helping to improve LearnKit. Shout-out to [sevenRevy](https://github.com/sevenRevy) for their contributions to this project.

This document covers two common contribution paths:

- translating the plugin into new languages
- updating the Companion model compatibility table with tested provider and model results

## Companion compatibility table

The Companion compatibility page is community-maintained and should reflect confirmed behavior in real LearnKit use.

Edit `site/src/content/docs/Companion-Model-Compatibility.md` when:

- you test a provider or model that is not listed yet
- a listed model changes behavior after a LearnKit update or provider-side change
- you confirm an important caveat that should help users choose a model, especially around attachments or intermittent failures

If the result looks like a product bug rather than a simple compatibility note, also file the [Companion AI issue report](https://github.com/ctrlaltwill/LearnKit/issues/new?template=ai_issue.yml) so it can be tracked separately.

### AI table workflow

1. Edit `site/src/content/docs/Companion-Model-Compatibility.md`.
2. Add a new row or update an existing row for the exact provider and model ID you tested.
3. Mark each feature with `✅`, `❌`, or `Varies` if the provider route is not stable.
4. Keep the comment short but specific. Note the main caveat, such as attachment limits, image support, or repeatable API errors.
5. Open a pull request that includes the LearnKit version, provider, exact model ID, tested features, and any attachment types you tried.

### Suggested AI test pass

1. **Chat** — ask Companion to review or explain the active note and confirm it returns a normal chat response.
2. **Edit** — ask Companion to make a concrete change and confirm the proposed edit can be applied back into the note.
3. **Generate Flashcards** — generate flashcards from a note and confirm the drafted cards appear and can be inserted.
4. **Generate Tests** — generate a short test, complete it, and confirm grading works as expected.
5. **File Attachments** — if supported by your setup, test a note with embedded or linked attachments and record what file types worked.

## Translation contributions

### How translation works

UI strings are wrapped with `t(locale, "token.key", "English fallback")`. At build time, JSON locale files from `src/platform/translations/locales/` are bundled into the plugin. If a token is missing from a locale file the English fallback is used automatically, so partial translations work fine.

### Locale file structure

- **`en-base.json`** — the canonical English source containing every translatable key. This is the file you copy when starting a new translation.
- **`en-gb.json`** / **`en-us.json`** — small override files that only contain keys that differ from the base (e.g. colour → color). New locales follow the same pattern: a full translation file is loaded on top of the base.
- **`ui.common.*`** keys are reusable microcopy tokens for high-frequency labels (Answer, Question, Next, Reset, etc.). Translate these once; they are shared across the UI.

## Contributor workflow

### Step 1 — You create the locale JSON

1. Copy `src/platform/translations/locales/en-base.json` to a new file named with the [IETF language tag](https://en.wikipedia.org/wiki/IETF_language_tag), for example `zh-cn.json`.
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
