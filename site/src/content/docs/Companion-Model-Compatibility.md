---
title: "Companion Model Compatibility"
---


This table tracks which Companion features work with each provider and model. Entries are based on community testing.

If you find something has changed, please submit a pull request to update the table.

## Feature key

- **Chat** — Conversational responses about your note (Ask, Review, and general chat all happen in one unified chat)
- **Edit** — Agentic editing that proposes changes you can accept into your document
- **Generate Flashcards** — AI flashcard drafting
- **Generate Tests** — AI test generation
- **File Attachments** — Sending embedded or linked files (PDFs, images, etc.)
- **Linked Notes** — Sending linked markdown notes as text context

## Compatibility table

| Provider | Model | Chat | Edit | Generate Flashcards | Generate Tests | File Attachments | Linked Notes | Comments |
|----------|-------|:----:|:----:|:-------------------:|:--------------:|:----------------:|:------------:|----------|
| OpenAI | `gpt-5` | | | | | | | Untested — submit a PR if you have results |
| OpenAI | `gpt-5-mini` | | | | | | | Untested — submit a PR if you have results |
| OpenAI | `gpt-5-nano` | | | | | | | Untested — submit a PR if you have results |
| OpenAI | `gpt-4.1` | | | | | | | Untested — submit a PR if you have results |
| OpenAI | `gpt-4.1-mini` | | | | | | | Untested — submit a PR if you have results |
| Anthropic | `claude-opus-4-1` | | | | | | | Untested — submit a PR if you have results |
| Anthropic | `claude-sonnet-4-5` | | | | | | | Untested — submit a PR if you have results |
| Anthropic | `claude-3-5-haiku-latest` | | | | | | | Untested — submit a PR if you have results |
| DeepSeek | `deepseek-chat` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | Intermittent error 400 messages |
| DeepSeek | `deepseek-reasoner` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | Intermittent error 400 messages |
| xAI | `grok-4` | | | | | | | Untested — submit a PR if you have results |
| xAI | `grok-3` | | | | | | | Untested — submit a PR if you have results |
| xAI | `grok-3-mini` | | | | | | | Untested — submit a PR if you have results |
| Google | `gemini-2.5-pro` | | | | | | | Untested — submit a PR if you have results |
| Google | `gemini-2.5-flash` | | | | | | | Untested — submit a PR if you have results |
| Google | `gemini-2.5-flash-lite` | | | | | | | Untested — submit a PR if you have results |
| Perplexity | `sonar` | | | | | | | Untested — submit a PR if you have results |
| Perplexity | `sonar-pro` | | | | | | | Untested — submit a PR if you have results |
| Perplexity | `sonar-reasoning` | | | | | | | Untested — submit a PR if you have results |
| Perplexity | `sonar-reasoning-pro` | | | | | | | Untested — submit a PR if you have results |
| OpenRouter | Free Models Router | Depends on model routed to | | | | | | Results vary by underlying model |
| OpenRouter | Auto Router | Depends on model routed to | | | | | | Results vary by underlying model |

## How to test and contribute

If you use a provider or model that is marked untested, you can help by testing it and submitting a pull request.

### What to test

1. **Chat** — Open Companion and ask it to review your note. This should provide a chat response.
2. **Edit** — Open Companion, after asking it to review your note, ask it to implement changes. If it generates changes that you can accept into your document then that is correct.
3. **Generate Flashcards** — Open Companion and ask it to generate flashcards from a note. Confirm cards appear and can be inserted into your note.
4. **Generate Tests** — Open the Tests feature and generate a short test from a note. Confirm questions appear and are answerable. Complete the test, and confirm that the test is appropriately graded.
5. **File Attachments** — Embed or link a PDF or image in a note, enable `Include embedded attachments` in settings. Confirm the model processes the attachment without errors.
6. **Linked Notes** — Link another markdown note, enable `Include linked notes as text`, then use chat. Confirm the linked content is referenced in the response.

### How to submit your results

1. Fork the repository and edit `site/src/content/docs/Companion-Model-Compatibility.md`.
2. Replace the blank cells for the model you tested with ✅ (works) or ❌ (does not work).
3. Add a short comment if there are caveats (e.g. "Intermittent error 400 messages").
4. Open a pull request with the provider, model, and a brief summary of what you tested.

Last modified: 19/04/2026
