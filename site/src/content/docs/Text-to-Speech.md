---
title: "Text to Speech"
---


LearnKit can read flashcard content aloud using your device's built-in speech engine.

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
