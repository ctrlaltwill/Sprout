---
title: "Text to Speech"
---


LearnKit can read flashcard content aloud using your device's built-in speech engine or a cloud TTS provider.

Configure it in `Settings -> Audio`.

## Main controls

The current Audio tab includes:

| Setting | What it does |
|---------|--------------|
| Text to speech | Turns TTS on for study |
| Limit to group | Reads aloud only cards in one group, if set |
| Autoplay | Reads the question automatically, then the answer when revealed |
| Widget read-aloud | Enables replay buttons and speech in the study widget |
| Gatekeeper read-aloud | Enables replay buttons and speech in Gatekeeper |
| Cloze read mode | Reads either just the answer or the full sentence |
| Default voice | Chooses the accent and dialect for Latin-script text |
| Advanced options | Chooses fallback languages for Arabic, Chinese, Cyrillic, and Devanagari scripts |
| Speech rate / Speech pitch | Tunes playback |
| Preview voice | Plays a test sample |

## Cloud TTS providers

When `Use external TTS provider` is enabled, LearnKit sends text to a cloud API instead of the device speech engine. This produces higher-quality, more natural audio.

### Supported providers

| Provider | Model(s) | Flag-based language | Notes |
|----------|----------|:---:|-------|
| **OpenAI** | GPT-4o Mini TTS | ✓ | Steerable, expressive voice with silent accent control. |
| **ElevenLabs** | Multilingual v2, Turbo v2.5 | ✓ | 29–32 languages supported. |
| **Google Cloud** | Default (voice-native) | ✓ | Language set from flag code or voice selection. |
| **Custom** | User-defined | — | Any HTTP endpoint that returns audio. Fully user-configured. |

### How language detection works

When `Use flags for language and accent` is enabled, inline flag codes such as `{{es}}` or `{{fr-ca}}` are detected automatically. The detected language is then:

- **OpenAI**: Sent as an instruction telling the model to speak with native pronunciation (not spoken aloud).
- **ElevenLabs**: Sent as a `language_code` parameter so the multilingual model pronounces text correctly.
- **Google Cloud**: Sent as the `languageCode` in the voice configuration.

This means a card with `{{es}} Sensible` on the question and `{{en}} Sensible` on the answer will be read with a Spanish accent and an English accent respectively — even though the word is identical.

### Provider settings

Each provider shows:

| Setting | Description |
|---------|-------------|
| API key | Your provider API key. Stored locally, never synced. |
| Voice | Provider-specific voice. Known providers show a searchable list; custom uses a text field. |
| Model | Provider-specific model. Only multilingual models are offered. |
| Endpoint URL | Shown only for the Custom provider. |

### Caching

`Cache generated audio` saves MP3 files locally in the plugin folder so repeated reviews do not make duplicate API calls.

#### How caching works

Each card side (question and answer) gets its own cached audio file. The cache key is based on the card ID and field side, not the text content — so a cached file is reused as long as the card exists and has not been edited.

For **cloze cards**, cloze read mode (`Just the answer` vs `Full sentence`) also factors into the cache key. Switching mode triggers a new API request.

For **MCQ cards**, the shuffled display order is encoded into the cache key. If the option order changes between reviews (e.g. because randomisation is enabled), a new API call is made for that ordering.

#### When cached audio is deleted

All cached audio files for a card are deleted whenever any field on that card is edited — regardless of which field changed. This covers the question, answer, cloze text, options, title, and info fields. Editing a single field clears every cached side (question, answer, options, etc.) so that stale audio is never replayed.

Cache files are also cleaned up automatically when cards are deleted or updated during sync.

You can manually clear the entire cache from `Settings -> Audio -> Clear TTS cache`.

#### Cross-device sync

Cached audio files are stored inside the plugin data folder (`.obsidian/plugins/learnkit/tts-cache/`). This folder is not synced by Obsidian Sync or most cloud sync tools, so each device builds its own cache independently. The first playback of a card on a new device will make a fresh API call.

## What TTS can read

TTS is designed for text-based flashcards such as:

- Basic and reversed flashcards
- Cloze flashcards
- Multiple choice questions
- Ordered questions

Image occlusion is a visual format, so it should not be treated as a full TTS-first workflow.

## Cloze read mode

`Cloze read mode` has two options:

- `Just the answer` reads only the missing term.
- `Full sentence` reads the sentence with the answer filled back in.

## Flag-aware routing

The `Flag-aware routing` section lets inline flags control language and accent during playback.

- `Use flags for language and accent` lets tokens like `{{es}}` or `{{es-mx}}` change voice selection.
- `Announce language name` speaks the language name before each flag-switched segment.

See [Flags](../Flags) and [Flag-Codes](../Flag-Codes) for the token system.

## Voice availability

LearnKit uses system voices loaded through the Web Speech API. Voice quality depends on your platform and installed voices.

- macOS and iOS usually have the best built-in voice selection.
- Windows quality depends on which Microsoft voices are installed.
- Linux depends heavily on local speech packages.

If the Audio tab shows no available system voices yet, reopen the tab and let the voice list load again.

## Practical tips

- Set the default voice to the language you review most often.
- Use advanced script options when the same script could map to multiple languages.
- Combine TTS with flags when a single card mixes languages or accents.
- Keep group-limited TTS for language subsets if you do not want every card read aloud.

Last modified: 30/03/2026
