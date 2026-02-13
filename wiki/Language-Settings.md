# Language Settings

Last updated: 13/02/2026

## Overview

Language settings control the voice and language used for text-to-speech (TTS) in Sprout. Configure these in **Settings → Audio**.

## Available settings

| Setting | Description |
|---------|-------------|
| **TTS Language** | The language/locale for the TTS voice (e.g. `en-US`, `en-GB`, `fr-FR`, `de-DE`). |
| **Voice** | The specific voice to use. Available voices depend on your operating system and installed voice packs. |
| **Speech rate** | How fast the text is read (0.5× to 2.0×). Default is 1.0×. |
| **Pitch** | Voice pitch adjustment. Default is 1.0. |

## Script-based voice selection

Sprout can assign different TTS voices to different writing scripts (alphabets). This acts as a pseudo language selection — for example, you can set one voice for Latin text, another for Cyrillic, another for CJK characters, and so on.

How it works:
- Sprout examines the script (alphabet) of the card text and selects the voice you have assigned to that script.
- This means cards written in Japanese, Arabic, or Cyrillic will each use the voice you configured for that script.
- However, Sprout **cannot** distinguish between languages that share the same script. A Latin-script word that is spelt the same in English and Italian (e.g. "pasta", "camera") will always use whichever voice you assigned to Latin text.
- Your configured default voice is used as a fallback when no script-specific voice is set.

## Adding voices

### macOS

1. Open **System Preferences → Accessibility → Spoken Content**.
2. Click **System Voice → Manage Voices**.
3. Download additional voices for your target languages.

### Windows

1. Open **Settings → Time & Language → Speech**.
2. Under **Manage voices**, click **Add voices**.
3. Choose the languages you need.

### Mobile

Voices are managed through your device's system settings under Accessibility or Language & Input.

## Tips

- For language learning, set the language to your **target** language rather than your native language to practise listening.
- Lower the speech rate when starting out with a new language, then increase it as you improve.
- Try different voices to find one you find clear and pleasant — this makes a difference for long study sessions.
