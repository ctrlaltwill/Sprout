# LearnKit - Flashcards & Spaced Repetition

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/LearnKit)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/LearnKit)](https://github.com/ctrlaltwill/LearnKit/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/LearnKit/total)
[![CI](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-vitepress-blue)](https://ctrlaltwill.github.io/LearnKit/)

![LearnKit Banner One - Welcome](site/branding/Banner%20One%20-%20Welcome.png)

> [!NOTE]
> **1.2 update:** This release introduces major new features, but it is not fully polished yet.
> LearnKit is still a proof of concept. The immediate focus is on polishing the UI and fixing bugs; the longer-term focus is on improving stability and delivering a smooth mobile experience.

LearnKit brings flashcards, spaced repetition, and AI-powered study tools directly into Obsidian, so you can learn faster from the notes you already write.

Flashcards are where LearnKit started, but the goal has always been bigger: to become the memory layer for your vault, connecting note-taking, review, and long-term retention in one system.

Build your own study setup with the features that suit you: create and review flashcards, run note review sessions, generate tests from your notes, get AI-powered study guidance, and plan exams with built-in coaching.

## Getting started

### Option 1 — BRAT (Recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Add `ctrlaltwill/LearnKit` as a community plugin in BRAT
3. Start creating flashcards

### Option 2 — Manual install from Releases

1. Go to [Releases](https://github.com/ctrlaltwill/LearnKit/releases) and download the latest release
2. Copy `main.js`, `styles.css`, and `manifest.json` into:

   ```
   <Your Vault>/.obsidian/plugins/learnkit/
   ```
3. Restart Obsidian → Settings → Community Plugins → Enable **LearnKit**

### Guides & Support

💡 Need help in-app? Open the built-in LearnKit guide inside Obsidian.

📖 Prefer online docs? **[Full Documentation & Support →](https://ctrlaltwill.github.io/LearnKit/)**

🌐 Want to contribute or help translate LearnKit? See the **[Contributing Guide →](CONTRIBUTING.md)**

## Key features

- **FSRS scheduling** — adaptive spaced repetition so every review counts.
- **Rich card types** — cloze, basic, reversed, multiple choice, image occlusion, and more.
- **Text-to-speech & audio** — built-in playback for language learning and listening practice.
- **Anki import/export** — bring your decks, scheduling data, and media in or out.
- **Study analytics** — charts, heatmaps, and retention trends at a glance.
- **Card browser & bulk edits** — inline editor and fast search across large collections.
- **Markdown-first** — cards live inside your notes, linked to the knowledge they came from.
- **Reading view customisation** — keep notes clean and distraction-free while studying.
- **Note review mode** — spaced repetition for your notes, not just cards.
- **Study Coach** _(beta)_ — personalised study plans and coaching for your exams.
- **Test mode** — auto-generated quizzes straight from your notes.

### Companion — AI learning assistant

Companion is your AI study partner, built right into LearnKit:

- **Ask** — get answers about the note you’re reading.
- **Review** — receive clear, actionable feedback on your notes.
- **Generate** — turn note content into flashcards in seconds.

Understand faster, write better, and create study-ready cards without leaving Obsidian.

🎥 **[Watch Companion in action →](https://youtu.be/fe1htR7hjvY)**

You **bring your own API key** — zero subscriptions, zero markupsWorks with free-tier providers (Google, OpenRouter) and premium platforms (Anthropic, OpenAI, Perplexity). To start for free, try Auto Router via OpenRouter.

## Feature highlights

![LearnKit Banner Two - Rich Card Types](site/branding/Banner%20Two%20-%20Rich%20Card%20Types.png)
![LearnKit Banner Three - FSRS Algorithm](site/branding/Banner%20Three%20-%20FSRS%20Algorithm.png)
![LearnKit Banner Four - Meet Companion](site/branding/Banner%20Four%20-%20Meet%20Companion.png)
![LearnKit Banner Six - Reminders & Gatekeeper](site/branding/Banner%20Six%20-%20Reminders%20%26%20Gatekeeper.png)
![LearnKit Banner Seven - Card Creation](site/branding/Banner%20Seven%20-%20Card%20Creation.png)
![LearnKit Banner Five - Audio Functionality](site/branding/Banner%20Five%20-%20Audio%20Functionality.png)
![LearnKit Banner Eight - Data Analysis](site/branding/Banner%20Eight%20-%20Data%20Analysis.png)
![LearnKit Banner Nine - Anki Compatibility](site/branding/Banner%20Nine%20-%20Anki%20Compatibility.png)

## License & Credits

### License
LearnKit is released under the **MIT License**.

See the [full license](LICENSE.md) for more details.

### Credits
FSRS scheduling in LearnKit is powered by FSRS-6 via [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

This project also uses Circle Flags assets from [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags), licensed under MIT.

See [here](NOTICES.md) for additional third-party attributions and license notices.

### Our Commitment

LearnKit is open source and always free. Your notes, your data, your control — no paywalls, no lock-in.
