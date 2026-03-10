# Assistant Configuration

Last modified: 10/03/2026

## Overview

Sprig settings are grouped by mode so you can control privacy, prompts, and output behavior.

## Core settings

| Setting | What it controls |
|---------|------------------|
| Enable Sprig | Turns assistant features on/off globally |
| Modal widget - button visibility | Controls whether the bottom-right note trigger is hidden, shown on hover, or always visible |
| AI provider | Which backend receives requests |
| OpenRouter model access | For OpenRouter only: filters model catalog to Free or Paid options |
| Model | Model name used for requests |
| Endpoint override | Custom provider base URL (custom provider only) |
| API key | Provider credential stored locally |
| Save chat history | Restores prior Ask/Review chats per note |
| Sync delete/reset to provider | When supported, requests remote conversation deletion when you clear/reset chats |

## Ask mode settings

| Setting | What it controls |
|---------|------------------|
| Custom instructions | Prompt rules for Ask responses |
| Include images from note in messages | Sends embedded images with Ask requests |

## Review mode settings

| Setting | What it controls |
|---------|------------------|
| Custom instructions | Prompt rules for Review responses |
| Include images from note in messages | Sends embedded images with Review requests |

## Flashcard mode settings

| Setting | What it controls |
|---------|------------------|
| Custom instructions | Prompt rules for flashcard generation |
| Include images from note in messages | Sends embedded images for flashcard generation (vision-capable models required) |
| Approximate number of cards | Target count (1-10) |
| What flashcard types to generate | Enable/disable Basic, Reversed, Cloze, MCQ, Ordered, IO |
| Generated fields | Include/exclude `T`, `I`, and `G` output rows |

### Model image capability notes

- Some models cannot analyse image content.
- More advanced models can identify text in images and convert it into question cards.
- The most advanced models may attempt to generate image occlusion (IO) cards.
- IO mask positioning can still be imperfect, so open generated IO cards in the flashcard editor and verify mask placement before studying.

## Suggested starting profile

- Keep card count low (3-5) while tuning prompts.
- Start with text card types (Basic/Cloze) before enabling all types.
- Keep image input disabled unless you are intentionally using a vision-capable model.
- Keep custom instructions concise and test in one note first.

## Safety and policy

All generated content should be reviewed before use. See [AI Usage Policy](./AI-Usage-Policy.md).
