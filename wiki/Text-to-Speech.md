# Text to Speech

Last modified: 13/02/2026

## Overview

Text to Speech (TTS) can read card content aloud.

This helps with language study, listening practice, and accessibility.

## Supported card types

| Card type | TTS support | What's read |
|-----------|-------------|-------------|
| **Basic** | ✅ | Question and/or answer fields |
| **Cloze** | ✅ | Full sentence or just the cloze deletion (configurable) |
| **MCQ** | ✅ | Question stem and options |
| **Ordered** | ✅ | Question stem and items |
| **Image Occlusion** | ❌ | Not supported (visual cards) |

If a card type is unsupported, no TTS audio is generated for that card.

## Cloze TTS options

For cloze cards, choose what is read on the answer side:

| Option | Behaviour |
|--------|-----------|
| **Deletion only** | Reads only the hidden/deleted text (e.g. "Paris") |
| **Full sentence** | Reads the complete sentence with the deletion filled in (e.g. "The capital of France is Paris") |

Configure this in **Settings → Audio → Cloze TTS mode**.

## Enabling TTS

1. Go to **Settings → Audio**.
2. Toggle **Enable text-to-speech** on.
3. Choose voice and language (see [[Language-Settings|Language Settings]]).
4. TTS controls will appear in the study session interface.

## During a session

When TTS is enabled:

- A **speaker icon** appears on cards during review.
- Click it to hear the current side read aloud.
- Auto-play can be configured to read automatically when a card is shown or when the answer is revealed.

## Audio quality

TTS uses your device's built-in speech engine. Voice quality and available voices depend on your OS:

- **macOS** — High-quality voices available via System Preferences → Accessibility → Spoken Content.
- **Windows** — Voices available via Settings → Time & Language → Speech.
- **Linux** — Depends on the installed speech synthesis packages.
- **Mobile** — Uses the device's built-in TTS engine.

If no suitable voice is installed for your chosen language, pronunciation quality may be poor.

## Tips

- For language learning, set the voice language to match your target language.
- Use **deletion only** mode for cloze cards when you want to practise pronunciation of specific terms.
- Use **full sentence** mode when context and sentence flow matter.
