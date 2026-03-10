# Guide for Free Usage

Last modified: 10/03/2026

## Overview

Sprig is bring-your-own-key. That means there is no Sprout subscription requirement for Assistant features.

You can run Sprig with free-tier models if your provider account has free usage available.

## Recommended free setup

1. Open **Settings → Assistant**.
2. Turn on **Enable Sprig**.
3. Set **AI provider** to **OpenRouter**.
4. In OpenRouter, create an API key and paste it into **API key**.
5. Choose a free-capable model.

If one model is unavailable or rate-limited, switch to another free-capable model.

## Cost-control checklist

Use these settings to reduce token usage and avoid accidental spend:

- Keep **Approximate number of cards** low while testing (for example, 3-5).
- Turn off **Include images from note in messages** unless you need vision.
- Keep prompts short and specific to reduce output size.
- Disable card types you do not currently need in **What flashcard types to generate**.

## Free usage caveats

- Free model availability can change at any time by provider.
- Response quality and speed can vary between free models.
- Some free models do not support image understanding.
- If a model fails, try another model first before troubleshooting other settings.

## Security notes

- API keys are stored locally in your vault plugin data.
- Do not commit plugin data files containing keys to public repositories.

For privacy and safety details, see [AI Usage Policy](./AI-Usage-Policy.md).
