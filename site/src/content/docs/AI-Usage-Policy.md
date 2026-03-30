---
title: "AI Usage Policy"
---


LearnKit's AI features are designed to help you study faster, not to replace your judgement.

This page applies to Companion features such as Ask, Review, Generate, and other provider-backed AI actions in the app.

## What AI is for

LearnKit uses AI to create drafts and suggestions, including:

- flashcard suggestions
- rewritten explanations
- note-based study prompts
- study assistance in Companion conversations

AI output should be treated as a starting point for review, not as final truth.

## Human review is required

AI can be wrong, incomplete, biased, outdated, or badly phrased.

Before you save or study AI-generated content, you should:

- verify factual accuracy
- rewrite unclear wording
- remove low-quality or irrelevant suggestions
- check that the flashcard type actually fits the material

If a generated card would be unsafe to study without checking first, do not use it.

## What may be sent to a provider

When you use Companion, LearnKit sends content to the provider you selected in `Settings -> Companion`.

Depending on your settings and workflow, that can include:

- your prompt
- current note text
- linked-note context
- linked or embedded attachment content
- image content when a vision-capable workflow is enabled
- custom instructions

The exact data sent depends on the settings you enabled and the action you are running.

## API keys and local storage

Provider API keys are stored locally in:

`.obsidian/plugins/learnkit/configuration/api-keys.json`

If your vault is tracked in Git, do not commit that file.

## Sensitive or restricted material

Do not send highly sensitive, regulated, or confidential content unless you understand the provider's privacy terms and accept that risk.

Examples include:

- personal health information
- passwords, secrets, and API keys
- confidential client or workplace material
- exam-restricted content you are not allowed to upload

## Copyright and usage rights

Only send material you have the right to use.

You are responsible for making sure your prompts, source material, and generated flashcards do not violate copyright, licences, or access restrictions.

## Educational scope

LearnKit AI is for learning support.

It is not a substitute for professional advice in medical, legal, financial, safety-critical, or other high-risk contexts.

## Availability, quality, and cost

Companion depends on third-party providers. Output quality and availability can change because of:

- provider outages
- model changes
- rate limits
- quota limits
- provider pricing

LearnKit does not guarantee uninterrupted AI access or consistently accurate output.

See [Companion Configuration](../Companion-Configuration) and [Guide for Free Usage](../Guide-for-Free-Usage) for practical setup guidance.

Last modified: 30/03/2026
