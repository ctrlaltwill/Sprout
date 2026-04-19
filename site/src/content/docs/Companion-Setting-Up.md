---
title: "Companion Setting Up"
---


Use this page for the shortest safe path from `disabled` to `usable`.

## 1. Turn it on

Open `Settings -> Companion` and enable `Companion`.

Until this is on, the note button and sidebar widget will not do anything useful.

## 2. Pick a provider and model

In the same tab:

- Choose an `AI provider`.
- Choose a `Model` for that provider.
- If you use OpenRouter, choose the `Free` or `Paid` catalog first.
- If you use a custom backend, fill in `Endpoint override`.

For a low-friction start, use a reliable text model first and add image-capable models later only if you need attachment or image workflows.

See [Companion Model Compatibility](../Companion-Model-Compatibility) for a community-maintained table of what works on each model.

## 3. Save your API key

Companion stores provider keys locally in:

```text
.obsidian/plugins/learnkit/configuration/api-keys.json
```

## 4. Protect the key if your vault uses Git

If your vault or `.obsidian` folder is version-controlled, ignore that file only:

```gitignore
.obsidian/plugins/learnkit/configuration/api-keys.json
```

## 5. Choose safe defaults

These defaults are sensible for first use:

- Leave context limits on `Standard`.
- Keep attachment sending off until you know your model supports it.
- Leave `Save chat history` on if you want note-specific conversations to reopen later.
- Keep generation targets small when testing flashcard quality.

## 6. Open Companion

You can launch it in two ways:

- Use the note button, if your `Button visibility` setting allows it.
- Run the command palette action that opens the companion widget in the sidebar.

## Before you trust it

Companion can still hallucinate, over-compress, or miss important context. Treat every answer, critique, and generated flashcard as a draft.

Review the policy here: [AI Usage Policy](../AI-Usage-Policy)

Last modified: 30/03/2026
