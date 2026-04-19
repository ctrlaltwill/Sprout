---
title: "Companion Model Compatibility"
---


This table tracks which Companion features work with each provider and model.

Only models with reported test data are listed.

Linked notes are not tracked as a separate compatibility column because they are sent as plain text context.

If you find something has changed, please submit a pull request to update the table.

## Feature key

- **Chat** — Conversational responses about your note (Ask, Review, and general chat all happen in one unified chat)
- **Edit** — Agentic editing that proposes changes you can accept into your document
- **Generate Flashcards** — AI flashcard drafting
- **Generate Tests** — AI test generation
- **File Attachments** — Sending embedded or linked files (PDFs, images, etc.)

## Compatibility table

| Provider | Model | Chat | Edit | Generate Flashcards | Generate Tests | File Attachments | Comments |
|----------|-------|:----:|:----:|:-------------------:|:--------------:|:----------------:|----------|
| DeepSeek | `deepseek-chat` | ✅ | ✅ | ✅ | ✅ | ✅ | Images not supported as file attachments. PDF, DOCX, and PPTX file attachments tested. |
| DeepSeek | `deepseek-reasoner` | ✅ | ✅ | ✅ | ✅ | ✅ | Images not supported as file attachments. PDF, DOCX, and PPTX file attachments tested. |
| OpenAI | `gpt-5` | ✅ | ✅ | ✅ | ✅ | ✅ | Images are supported. |
| OpenAI | `gpt-5-mini` | ✅ | ✅ | ✅ | ✅ | ✅ | Images are supported. |
| OpenAI | `gpt-5-nano` | ✅ | ✅ | ✅ | ✅ | ✅ | Images are supported. |
| OpenAI | `gpt-4.1` | ✅ | ✅ | ✅ | ✅ | ✅ | Images are supported. |
| OpenAI | `gpt-4.1-mini` | ✅ | ✅ | ✅ | ✅ | ✅ | Images are supported. |
| OpenRouter | `openrouter/free` (Free Models Router) | Varies | Varies | Varies | Varies | Varies | Variable: support depends on the routed free model chosen at runtime. |

## How to test and contribute

If you test a provider/model that is not listed, you can submit a pull request to add it.

### What to test

1. **Chat** — Open Companion and ask it to review your note. This should provide a chat response.
2. **Edit** — Open Companion, after asking it to review your note, ask it to implement changes. If it generates changes that you can accept into your document then that is correct.
3. **Generate Flashcards** — Open Companion and ask it to generate flashcards from a note. Confirm cards appear and can be inserted into your note.
4. **Generate Tests** — Open the Tests feature and generate a short test from a note. Confirm questions appear and are answerable. Complete the test, and confirm that the test is appropriately graded.
5. **File Attachments** — Embed or link a PDF or image in a note, enable `Include embedded attachments` in settings. Confirm the model processes the attachment without errors.

### How to submit your results

1. Fork the repository and edit `site/src/content/docs/Companion-Model-Compatibility.md`.
2. Add a new row for the provider and model you tested, then mark each feature with ✅ (works) or ❌ (does not work).
3. Add a short comment if there are caveats (e.g. "Intermittent error 400 messages").
4. Open a pull request with the provider, model, and a brief summary of what you tested.

Last modified: 19/04/2026
