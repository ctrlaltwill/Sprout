---
title: "Companion Model Compatibility"
---

<style>
  table { font-size: 0.7rem !important; }
</style>

This table tracks which Companion features work with each provider and model. Only models with reported test data are listed.

Some results were generated from automated tests, so individual experiences may vary. If you believe something is inaccurate, please submit a pull request to update the table.

Linked notes are not tracked as a separate compatibility column because they are sent as plain text context.

## Feature key

- 🟢 Fully functional — 🟡 Partially functional — 🔴 Non-functional
- **Chat** — Conversational responses about your note
- **Edit** — Proposes changes you can accept into your document
- **Flashcards** — AI flashcard drafting
- **Tests** — AI test generation
- **Attachments** — File attachments (DOCX, PPTX, PDF)
- **Image** — Image attachment support

## DeepSeek

| Model | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `deepseek-chat` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `deepseek-reasoner` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |

## OpenAI

| Model | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `gpt-5` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `gpt-5-mini` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `gpt-5-nano` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `gpt-4.1` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `gpt-4.1-mini` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |

## OpenRouter

The following models were all tested via [OpenRouter](https://openrouter.ai). They are grouped by provider for readability.

### Amazon Nova

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `amazon/nova-lite-v1` | Paid | 🟢 | 🟢 | 🟢 | 🔴 | 🟢 | 🟢 | Tests unreliable. |
| `amazon/nova-micro-v1` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `amazon/nova-premier-v1` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `amazon/nova-pro-v1` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |

### Meta Llama

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `meta-llama/llama-3.1-70b-instruct` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | 🔴 | No attachment or image support. |
| `meta-llama/llama-3.2-11b-vision-instruct` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟡 | 🔴 | Only PPTX works; no image support. |
| `meta-llama/llama-3.3-70b-instruct` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟡 | 🔴 | PDF not supported; no image support. |
| `meta-llama/llama-4-maverick` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `meta-llama/llama-4-scout` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |

### Mistral

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `mistralai/mistral-large` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `mistralai/mistral-medium-3.1` | Paid | 🟢 | 🔴 | 🟢 | 🟢 | 🟢 | 🟢 | Edit not supported. |
| `mistralai/mistral-nemo` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `mistralai/mistral-small-3.2-24b-instruct` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `mistralai/pixtral-large-2411` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |

### Nvidia

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `nvidia/nemotron-3-super-120b-a12b` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |

### Qwen

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `qwen/qwen3-235b-a22b` | Paid | 🟢 | 🟢 | 🟢 | 🔴 | 🟢 | 🔴 | Tests unreliable; no image support. |
| `qwen/qwen3-32b` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `qwen/qwen3-max` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `qwen/qwen-plus` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `qwen/qwq-32b` | Paid | 🟢 | 🔴 | 🟢 | 🟢 | 🟢 | 🔴 | Edit not supported; no image support. |

### Other Providers

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `baidu/ernie-4.5-300b-a47b` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `bytedance-seed/seed-1.6` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `cohere/command-a` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `inception/mercury-2` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `inflection/inflection-3-productivity` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟡 | 🔴 | PPTX not supported; no image support. |
| `liquid/lfm-2-24b-a2b` | Paid | 🟢 | 🟢 | 🔴 | 🟢 | 🟢 | 🔴 | Flashcards unreliable; no image support. |
| `microsoft/phi-4` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟡 | 🔴 | PPTX/PDF can be unreliable; no image support. |
| `minimax/minimax-m2.7` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `moonshotai/kimi-k2` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `moonshotai/kimi-k2.5` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | |
| `nousresearch/hermes-4-405b` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `nousresearch/hermes-4-70b` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `stepfun/step-3.5-flash` | Paid | 🟢 | 🔴 | 🔴 | 🟢 | 🟢 | 🔴 | Edit and flashcards not supported; no image support. |
| `tencent/hunyuan-a13b-instruct` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `writer/palmyra-x5` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `xiaomi/mimo-v2-pro` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `z-ai/glm-4.6` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `z-ai/glm-4.7` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `z-ai/glm-5` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |
| `arcee-ai/trinity-large-preview:free` | Free | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 | No image support. |

### Routers

These are meta-models that route your request to another model at runtime. Results vary depending on which underlying model is selected.

| Model | Tier | Chat | Edit | Flashcards | Tests | Attachments | Image | Comments |
|-------|------|:----:|:----:|:----------:|:-----:|:-----------:|:-----:|----------|
| `openrouter/auto` | Paid | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Routes to best available model. |
| `openrouter/free` | Free | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | Depends on which free model is chosen. |

### Models Not Supported

| Model | Notes |
|-------|-------|
| `arcee-ai/maestro-reasoning` | All features failed. |
| `arcee-ai/virtuoso-large` | All features failed. |
| `minimax/minimax-m1` | All corefeatures failed. |
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
2. Add a new row for the provider and model you tested, then mark each feature with 🟢 (fully-functional), 🟡 (partially functional), or 🔴 (non-functional).
3. Add a short comment if there are caveats.
4. Open a pull request with the provider, model, and a brief summary of what you tested.

Last modified: 19/04/2026
