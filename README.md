# Sprout - Flashcards & Spaced Repetition

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/sprout)
[![GitHub License](https://img.shields.io/github/license/ctrlaltwill/sprout)](https://github.com/ctrlaltwill/sprout/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/Sprout/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/sprout/total)
[![CI](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-vitepress-blue)](https://ctrlaltwill.github.io/Sprout/)

![Sprout Banner One - Welcome](site/branding/Banner%20One%20-%20Welcome.png)

Sprout is a full-featured flashcard and spaced-repetition system built natively for Obsidian, with AI-powered study workflows that help you learn faster from your own notes.

Flashcards are at the heart of Sprout, but the goal is bigger: to be the memory layer for your vault - connecting note-taking, review, and long-term retention in one low-friction workflow.

With rich card types, FSRS scheduling, Anki import/export, study analytics, and built-in AI assistance for understanding and card creation, Sprout helps you spend less time managing and more time remembering.

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

- FSRS scheduler for optimised spaced repetition and fewer unnecessary reviews.
- Flexible card types: cloze, basic, multiple choice, image occlusion, and more.
- Built-in text-to-speech and audio playback for language and listening practice.
- Anki import/export _(experimental)_ with scheduling data and media support.
- Analytics dashboard with charts and heatmaps for study and retention trends.
- Inline editor, card browser, and bulk edits for faster card management.
- Markdown-first workflow with note-linked cards in your Obsidian vault.
- Reading view customisation to keep notes clean and distraction-free.
- AI learning companion (currently in _beta_) for understanding and quick flashcard generation.
- Study reminders + Gatekeeper (an optional lock on your Vault that blocks distractions until you review) nudges you to keep study habits consistent.

### Sprig

Sprig is your AI learning companion within Sprout. It can:
- Answer questions about your current note
- Review your notes and suggest improvements
- Generate flashcards from your note content

Sprig is currently in _beta_. It helps you understand notes faster, improve them with clear feedback, and turn them into ready-to-study flashcards in one workflow.

To try Sprig, download the latest release (1.1.0) from [Releases](https://github.com/ctrlaltwill/Sprout/releases) and install it manually.

🎥 Watch Sprig in action: **[Sprig Demo →](https://youtu.be/fe1htR7hjvY)**

You **bring your own API key**, so cost depends on the provider and model you choose. Sprig supports providers with free tiers (e.g., Google, OpenRouter) as well as premium platforms (e.g., Anthropic, OpenAI, Perplexity). Sprout adds no subscription fees or API markups. If you want to try it for free, we recommend using Auto Router via OpenRouter.

## Feature highlights

![Sprout Banner Two - Rich Card Types](site/branding/Banner%20Two%20-%20Rich%20Card%20Types.png)
![Sprout Banner Three - Meet Sprig](site/branding/Banner%20Three%20-%20Meet%20Sprig.png)
![Sprout Banner Four - FSRS Algorithm](site/branding/Banner%20Four%20-%20FSRS%20Algorithm.png)
![Sprout Banner Five - Audio Functionality](site/branding/Banner%20Five%20-%20Audio%20Functionality.png)
![Sprout Banner Six - Reminders & Gatekeeper](site/branding/Banner%20Six%20-%20Reminders%20%26%20Gatekeeper.png)
![Sprout Banner Seven - Card Creation](site/branding/Banner%20Seven%20-%20Card%20Creation.png)
![Sprout Banner Eight - Anki Compatibility](site/branding/Banner%20Eight%20-%20Anki%20Compatibility.png)
![Sprout Banner Nine - Data Analysis](site/branding/Banner%20Nine%20-%20Data%20Analysis.png)

## License & Credits

### License
Sprout is released under the **MIT License**.

See the [full license](LICENSE.md) for more details.

### Credits
FSRS scheduling in Sprout is powered by FSRS-6 via [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

This project also uses Circle Flags assets from [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags), licensed under MIT.

See [here](NOTICES.md) for additional third-party attributions and license notices.

### Our Commitment 

Sprout is proudly open source and will always remain free. We firmly believe learning tools shouldn’t lock your knowledge behind subscriptions. That’s why your notes and your data will always remain entirely under your control.
