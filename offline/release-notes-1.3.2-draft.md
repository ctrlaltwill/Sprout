### Release Date
2026-04-24


### Summary
LearnKit 1.3.2 makes Companion feel smoother and introduces cloze hints to make recall prompts clearer without giving away the full answer.

## What's New
- **Cloze hints** — you can now write clozes with hints `{{c1::Psoriatic arthritis::diagnosis}}`. While the card is hidden, LearnKit shows `diagnosis` as the cue instead of a blank. In typed cloze mode, that same hint appears as the input placeholder. When you reveal the card, LearnKit will show the full answer: `Psoriatic arthritis`.
- **Better streaming controls in Companion** — if a reply is still streaming, you can stop it  instead of waiting for the full response.

## What's Changed
- Companion is better at understanding short follow-up requests, so messages like "do it" or "add it to my note" behave more predictably.
- Companion edit suggestions are easier to review, with clearer inline change previews and a smoother accept or reject flow.
- Quick Cards now supports cloze hints too, so shorthand like `cloze:::The capital of {{France::country}} is {{Paris::city}}` expands correctly.
- **Organising groups is now easier** – sync now keeps your flashcard group rows in alphabetical order, and saving an edited card now resyncs that note immediately so comma-separated `G | ... |` lists stay alphabetised without a manual sync.
- **Parent/child groups behave consistently** – LearnKit now treats `Parent/Child` and `Parent::Child` as the same hierarchy in edit fields and study scopes, so child groups stay nested correctly without collapsing separate groups into one path.