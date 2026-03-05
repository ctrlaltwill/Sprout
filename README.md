# Sprout - Flashcards & Spaced Repetition

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/sprout)
[![License](https://img.shields.io/github/license/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/Sprout/blob/main/LICENSE.md)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/Sprout/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/sprout/total)
[![CI](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-vitepress-blue)](https://ctrlaltwill.github.io/Sprout/)

![Sprout Banner One - Welcome](site/branding/Banner%20One%20-%20Welcome.png)

Sprout is an Obsidian plugin that lets you create flashcards directly inside your Markdown notes and review them with an FSRS-based scheduler.

Rather than separating notes and flashcards, Sprout keeps everything in one place — turning Obsidian into a hub for learning.

## Getting started

### Option 1 — BRAT (Recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Add `ctrlaltwill/Sprout` as a community plugin in BRAT
3. Start creating flashcards

### Option 2 — Manual install from Releases

1. Go to [Releases](https://github.com/ctrlaltwill/Sprout/releases) and download the latest release
2. Copy `main.js`, `styles.css`, and `manifest.json` into:

   ```
   <Your Vault>/.obsidian/plugins/sprout/
   ```
3. Restart Obsidian → Settings → Community Plugins → Enable **Sprout**

### Guides & Support

💡 Need help in-app? Open the built-in Sprout guide inside Obsidian.

📖 Prefer online docs? **[Full Documentation & Support →](https://ctrlaltwill.github.io/Sprout/)**

🌐 Want to contribute or help translate Sprout? See the **[Contributing Guide →](CONTRIBUTING.md)**

## Key features

- FSRS-based scheduler for optimised spaced repetition 
- Card types: cloze, basic, multiple choice, image occlusion and more
- Built-in text-to-speech for language learning and audio playback of cards
- Anki import/export _(experimental)_ with scheduling data and media support
- Analytics dashboard with charts and heatmaps
- Inline editor, card browser, and bulk edit tools
- Markdown-first workflow with note-linked cards
- Reading view customisation to keep your notes clean

## Feature highlights

![Sprout Banner Two - Rich Card Types](site/branding/Banner%20Two%20-%20Rich%20Card%20Types.png)
![Sprout Banner Three - Audio Functionality](site/branding/Banner%20Three%20-%20Audio%20Functionality.png)
![Sprout Banner Four - FSRS Algorithm](site/branding/Banner%20Four%20-%20FSRS%20Algorithm.png)
![Sprout Banner Five - Data Analysis](site/branding/Banner%20Five%20-%20Data%20Analysis.png)
![Sprout Banner Six - Anki Compatibility](site/branding/Banner%20Six%20-%20Anki%20Compatibility.png)
![Sprout Banner Seven - Card Creation](site/branding/Banner%20Seven%20-%20Card%20Creation.png)
![Sprout Banner Eight - Reminders & Gatekeeper](site/branding/Banner%20Eight%20-%20Reminders%20%26%20Gatekeeper.png)

## License & Credits

### License
Sprout is released under the **MIT License**.

See the [full license](LICENSE.md) for more details.

### Credits
FSRS scheduling in Sprout is powered by FSRS-6 via [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

This project also uses Circle Flags assets from [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags), licensed under MIT.

See [here](NOTICES.md) for additional third-party attributions and license notices.

### Our Commitment 

Sprout is proudly open source and will always remain free. No hidden fees. No subscriptions. No AI-generated flashcards. No internet connection required. We firmly believe learning tools shouldn’t lock your knowledge behind subscriptions. That’s why your notes and your data will always remain entirely under your control.

If Sprout helps your learning, then it’s doing exactly what it was built for.