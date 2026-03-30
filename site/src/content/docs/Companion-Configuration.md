---
title: "Companion Configuration"
---

# Companion Configuration

Use `Settings -> Companion` to control provider access, privacy, note context, and generation behaviour.

## Provider and access

These settings decide how Companion connects:

| Setting | What it does |
|---------|--------------|
| Enable Companion | Turns Companion on or off globally |
| Button visibility | Hides the note button, shows it on hover, or keeps it always visible |
| Sidebar widget | Reminds you that the sidebar version is opened from the command palette |
| AI provider | Chooses the backend provider |
| OpenRouter model catalog | Shows the Free or Paid OpenRouter model list |
| Model | Picks the active model for the chosen provider |
| Endpoint override | Required only when using the Custom provider |
| API key | Saves the credential for the current provider |

Companion uses your own API key. LearnKit does not add a separate subscription or markup on top of the provider cost.

## Privacy and history

These settings control what Companion remembers and what context it can send:

| Setting | What it does |
|---------|--------------|
| Save chat history | Restores prior Ask, Review, and Generate conversations for each note |
| Delete chats on provider too | Requests remote deletion when you clear or reset chats, if the provider supports it |
| Linked notes context limit | Limits how much linked-note text is sent |
| Text attachment context limit | Limits how much text extracted from attached files is sent |

The context limits use four presets: Conservative, Standard, Extended, and No limit.

## Companion sources

The `Companion sources` section controls what extra material Ask and Review can use from the current note:

| Setting | What it does |
|---------|--------------|
| Include embedded attachments | Sends files embedded in the open note, such as PDFs or images |
| Include linked notes as text | Sends linked markdown notes as plain text |
| Include linked attachments | Sends linked non-markdown files |
| Custom instructions | Adds your own persistent prompt rules for Companion |

Attachment-heavy workflows depend on the selected model. Some cheaper or free models may reject attachments entirely.

## Flashcard generation

The `Flashcard generation` section controls Generate mode:

| Setting | What it does |
|---------|--------------|
| Target number of cards | Sets a target from 1 to 10 |
| Flashcard types to generate | Enables Basic, Basic (reversed), Cloze, Multiple choice, Ordered question, and Image occlusion |
| Include titles | Adds `T` rows to generated flashcards |
| Include extra information | Adds `I` rows |
| Include groups | Adds `G` rows |

Image occlusion only appears when the current model looks vision-capable. Even then, generated masks can still need manual cleanup in the flashcard editor.

## Test settings in the same tab

The Companion tab also includes `Test sources` and test-specific `Custom instructions`. Those settings affect AI test generation rather than Ask, Review, or Generate mode.

## Sensible defaults

- Start with a reliable text model before experimenting with attachment-heavy prompts.
- Keep context limits on `Standard` until you know you need more.
- Keep generation targets small so you can review output quality before inserting it.
- Enable only the flashcard types you actually want to study.

See [Companion Setting Up](./Companion-Setting-Up), [Companion Usage](./Companion-Usage), and [AI Usage Policy](./AI-Usage-Policy).

Last modified: 30/03/2026
