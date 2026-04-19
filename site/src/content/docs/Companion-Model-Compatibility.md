---
title: "Companion Model Compatibility"
---


This table tracks which Companion features work with each provider and model. Only models with reported test data are listed.

Some results were generated from automated tests, so individual experiences may vary. If you believe something is inaccurate, please submit a pull request to update the table.

Linked notes are not tracked as a separate compatibility column because they are sent as plain text context.

## Feature key

- **Chat** — Conversational responses about your note (Ask, Review, and general chat all happen in one unified chat)
- **Edit** — Agentic editing that proposes changes you can accept into your document
- **Generate Flashcards** — AI flashcard drafting
- **Generate Tests** — AI test generation
- **File Attachments** — Sending embedded or linked files (PDFs, images, etc.)

## DeepSeek

| Model | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `deepseek-chat` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `deepseek-reasoner` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |

## OpenAI

| Model | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `gpt-5` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `gpt-5-mini` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `gpt-5-nano` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `gpt-4.1` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `gpt-4.1-mini` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |

## OpenRouter

The following models were all tested via [OpenRouter](https://openrouter.ai). They are grouped by provider for readability.

### Amazon Nova (via OpenRouter)

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `amazon/nova-lite-v1` | Paid | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | Test generation unreliable; everything else works including images. |
| `amazon/nova-micro-v1` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `amazon/nova-premier-v1` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `amazon/nova-pro-v1` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PPTX occasionally unreliable in fallback mode. |

### Meta Llama (via OpenRouter)

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `meta-llama/llama-3.1-70b-instruct` | Paid | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | Core features work; most attachments fail. PPTX fallback sometimes passes. |
| `meta-llama/llama-3.2-11b-vision-instruct` | Paid | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | Only PPTX attachments work; DOCX, PDF, and images fail. |
| `meta-llama/llama-3.3-70b-instruct` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | PDF output unreliable; no image support. |
| `meta-llama/llama-4-maverick` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `meta-llama/llama-4-scout` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |

### Mistral (via OpenRouter)

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `mistralai/mistral-large` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `mistralai/mistral-medium-3.1` | Paid | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Edit proposals not generated correctly; everything else works. |
| `mistralai/mistral-nemo` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `mistralai/mistral-small-3.2-24b-instruct` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `mistralai/pixtral-large-2411` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |

### Nvidia (via OpenRouter)

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `nvidia/nemotron-3-super-120b-a12b` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |

### Qwen (via OpenRouter)

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `qwen/qwen3-235b-a22b` | Paid | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | Test generation unreliable; no image support. |
| `qwen/qwen3-32b` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `qwen/qwen3-max` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `qwen/qwen-plus` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `qwen/qwq-32b` | Paid | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Edit proposals not generated correctly; no image support. |

### Other Providers (via OpenRouter)

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `baidu/ernie-4.5-300b-a47b` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `bytedance-seed/seed-1.6` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `cohere/command-a` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `inception/mercury-2` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `inflection/inflection-3-productivity` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PPTX not supported; no image support. |
| `liquid/lfm-2-24b-a2b` | Paid | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | Flashcard generation unreliable; no image support. |
| `microsoft/phi-4` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | PPTX and PDF fallback can be unreliable; no image support. |
| `minimax/minimax-m2.7` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `moonshotai/kimi-k2` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `moonshotai/kimi-k2.5` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. |
| `nousresearch/hermes-4-405b` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `nousresearch/hermes-4-70b` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `stepfun/step-3.5-flash` | Paid | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | Edit and flashcard generation fail; no image support. |
| `tencent/hunyuan-a13b-instruct` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `writer/palmyra-x5` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `xiaomi/mimo-v2-pro` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `z-ai/glm-4.6` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `z-ai/glm-4.7` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `z-ai/glm-5` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |
| `arcee-ai/trinity-large-preview:free` | Free | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full support except images. |

### OpenRouter Routers

These are meta-models that route your request to another model at runtime. Results vary depending on which underlying model is selected.

| Model | Tier | Chat | Edit | Flashcards | Tests | DOCX | PPTX | PDF | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:----:|:----:|:---:|:-----:|----------|
| `openrouter/auto` | Paid | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full support including images. Routes to best available model. |
| `openrouter/free` | Free | Varies | Varies | Varies | Varies | Varies | Varies | Varies | Varies | Results depend on whichever free model is chosen at runtime. |

### OpenRouter Models Not Supported

| Model | Notes |
|-------|-------|
| `arcee-ai/maestro-reasoning` | All features failed. |
| `arcee-ai/virtuoso-large` | All features failed. |
| `minimax/minimax-m1` | All features failed. |
| `rekaai/reka-flash-3` | All core features failed. |

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
