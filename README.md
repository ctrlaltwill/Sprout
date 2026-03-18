# LearnKit - Flashcards & Spaced Repetition

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/Sprout)
[![GitHub License](https://img.shields.io/github/license/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/LearnKit/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/Sprout)](https://github.com/ctrlaltwill/LearnKit/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/Sprout/total)
[![CI](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/Sprout/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-vitepress-blue)](https://ctrlaltwill.github.io/Sprout/)

![LearnKit Banner One - Welcome](site/branding/Banner%20One%20-%20Welcome.png)

LearnKit is a full-featured flashcard and spaced-repetition system built natively for Obsidian, with AI-powered study workflows that help you learn faster from your own notes.

Flashcards are at the heart of LearnKit, but the goal is bigger: to be the memory layer for your vault - connecting note-taking, review, and long-term retention in one low-friction workflow.

With rich card types, FSRS scheduling, Anki import/export, study analytics, and built-in AI assistance for understanding and card creation, LearnKit helps you spend less time managing and more time remembering.

## Getting started

### Option 1 — BRAT (Recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Add `ctrlaltwill/LearnKit` as a community plugin in BRAT
3. Start creating flashcards

### Option 2 — Manual install from Releases

1. Go to [Releases](https://github.com/ctrlaltwill/LearnKit/releases) and download the latest release
2. Copy `main.js`, `styles.css`, and `manifest.json` into:

   ```
   <Your Vault>/.obsidian/plugins/sprout/
   ```
3. Restart Obsidian → Settings → Community Plugins → Enable **LearnKit**

### Guides & Support

💡 Need help in-app? Open the built-in LearnKit guide inside Obsidian.

📖 Prefer online docs? **[Full Documentation & Support →](https://ctrlaltwill.github.io/LearnKit/)**

🌐 Want to contribute or help translate LearnKit? See the **[Contributing Guide →](CONTRIBUTING.md)**

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

### Companion (AI)

Companion is your AI learning assistant inside LearnKit. It can:
- Answer questions about your current note
- Review your notes and suggest improvements
- Generate flashcards from your note content

Companion is currently in _beta_. It helps you understand notes faster, improve them with clear feedback, and turn them into ready-to-study flashcards in one workflow.

To try Companion, download the latest release from [Releases](https://github.com/ctrlaltwill/LearnKit/releases) and install it manually.

🎥 Watch Companion in action: **[Companion Demo →](https://youtu.be/fe1htR7hjvY)**

You **bring your own API key**, so cost depends on the provider and model you choose. Companion supports providers with free tiers (e.g., Google, OpenRouter) as well as premium platforms (e.g., Anthropic, OpenAI, Perplexity). LearnKit adds no subscription fees or API markups. If you want to try it for free, we recommend using Auto Router via OpenRouter.

## Feature highlights

![LearnKit Banner Two - Rich Card Types](site/branding/Banner%20Two%20-%20Rich%20Card%20Types.png)
![LearnKit Banner Three - FSRS Algorithm](site/branding/Banner%20Three%20-%20FSRS%20Algorithm.png)
![LearnKit Banner Four - Meet Companion](site/branding/Banner%20Four%20-%20Meet%20Companion.png)
![LearnKit Banner Five - Audio Functionality](site/branding/Banner%20Five%20-%20Audio%20Functionality.png)
![LearnKit Banner Six - Reminders & Gatekeeper](site/branding/Banner%20Six%20-%20Reminders%20%26%20Gatekeeper.png)
![LearnKit Banner Seven - Card Creation](site/branding/Banner%20Seven%20-%20Card%20Creation.png)
![LearnKit Banner Eight - Anki Compatibility](site/branding/Banner%20Eight%20-%20Anki%20Compatibility.png)
![LearnKit Banner Nine - Data Analysis](site/branding/Banner%20Nine%20-%20Data%20Analysis.png)

## License & Credits

### License
LearnKit is released under the **MIT License**.

See the [full license](LICENSE.md) for more details.

### Credits
FSRS scheduling in LearnKit is powered by FSRS-6 via [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

This project also uses Circle Flags assets from [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags), licensed under MIT.

See [here](NOTICES.md) for additional third-party attributions and license notices.

### Our Commitment 

LearnKit is proudly open source and will always remain free. We firmly believe learning tools shouldn’t lock your knowledge behind subscriptions. That’s why your notes and your data will always remain entirely under your control.
