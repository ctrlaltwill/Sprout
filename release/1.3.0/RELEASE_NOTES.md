### Release Date
2026-04-19

### Summary
LearnKit 1.3.0 is now released as a stable build. This release introduces agentic Companion workflows, external TTS providers, Quick Cards shorthand, streaming AI replies, and stronger release validation for AI-heavy features.

## What's New
- **Agentic Companion** — Companion can now edit, create, and refactor cards directly in your notes with inline diff previews and accept/reject controls. All edits require user approval before being added to your notes.
- **External TTS providers** — use OpenAI, ElevenLabs, Google Cloud, or a custom HTTP endpoint for text-to-speech instead of the built-in system voice. Includes voice and model selection, per-provider API key storage, and a local audio cache to avoid repeat API calls. Configure and clear the cache from settings.
- **MCQ TTS** — TTS now reads MCQ cards with numbered options on the front and announces the correct answer on the back. Separate replay buttons for stem, options, and answer.
- **Quick Cards** — write `Question:::Answer` anywhere in a note and LearnKit expands it to the full card format on sync. Also supports cloze shorthand: `cloze:::The capital of {{France}} is {{Paris}}` which auto-numbers tokens and expands to `CQ | ... |` format.
- **Streaming Companion replies** — AI chat and review replies now stream token-by-token for a more responsive feel.
- **Inline test generation and grading** — Companion can generate a practice test in chat and grade your answers inline, with per-question feedback and scoring.
- **Per-file data storage** — new `CardFileStore` format stores cards as individual files. Existing SQLite and legacy JSON stores are automatically migrated on load. SQLite remains as a fallback if migration fails.
- Reintroduced rotating greeting messages on the home view.
- Updated deck and hierarchy organisation documentation and in-app guides. Frontmatter tagging for decks is on the roadmap for a future release.

## What's Changed
- Grading, undo, bury, and suspend actions are now handled by dedicated service modules, ensuring consistent behaviour across the reviewer, widget, and gatekeeper surfaces.
- Companion test generation now renders questions inline in the chat instead of saving to a separate tests database.
- Settings tab navigation no longer re-triggers the entrance animation when opening to the default tab.
- Settings scroll position restores instantly on tab switch instead of smooth-scrolling back.
- I18n strings are ready for community translation.

## AI Compatibility
- Added a dedicated Companion model compatibility matrix and contribution workflow to document provider/model behaviour and keep status current.
- Initial verified results show DeepSeek (`deepseek-chat`, `deepseek-reasoner`) supports Chat, Edit, Generate Flashcards, Generate Tests, and Linked Notes.
- OpenRouter entries are listed with router-level caveats because effective behaviour depends on the routed model.
- OpenAI, Anthropic, Google, xAI, and Perplexity model rows are included as structured "untested" baselines so the community can quickly submit validation updates.

## Testing and Validation
- Release validation completed with full unit suite pass: 47 test files, 732 tests passed.
- Confirmed production bundle generation for JavaScript and CSS assets, then refreshed release package artifacts.
- Companion model testing guidance now documents reproducible steps for validating Chat, Edit, Generate Flashcards, Generate Tests, File Attachments, and Linked Notes.

## Bug Fixes
- Fixed image occlusion children not updating when group assignments are changed on edit.
- Fixed settings view header background not being fully opaque.
- Fixed TTS audio cache not being deleted when editing a flashcard, causing stale audio to replay after edits.

## Known Issues and Caveats
- DeepSeek models can intermittently return HTTP 400 errors during Companion requests; retrying usually succeeds.
- DeepSeek currently does not support file attachment processing in Companion (`Include embedded attachments`).
- OpenRouter outcomes may vary between sessions because routed back-end models can change.
