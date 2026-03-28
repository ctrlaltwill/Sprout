# LearnKit — Flashcards, Spaced Repetition & Study Tools

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/LearnKit)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/LearnKit)](https://github.com/ctrlaltwill/LearnKit/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/LearnKit/total)
[![CI](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-vitepress-blue)](https://ctrlaltwill.github.io/LearnKit/)

![LearnKit Banner One - Welcome](site/branding/Banner%20One%20-%20Welcome.png)

> [!IMPORTANT]
> **1.2.5 is the current release.** If you are updating from a version before 1.2.3, review the [1.2.3 migration notes](release/1.2.3/RELEASE_NOTES.md#important-plugin-id-migration) first because the plugin ID changed in that release.

LearnKit helps you remember what you write. It brings flashcards, note review, test generation, and AI-assisted study workflows directly into Obsidian, so your vault becomes a place to learn, not just store information.

Flashcards are where LearnKit started, but the goal is bigger: to become the memory layer for your vault, connecting note-taking, review, and long-term retention in one system.

## Why LearnKit

Most note apps help you capture information. LearnKit helps you keep it.

Instead of splitting your workflow across notes, flashcards, AI tools, and external apps, LearnKit brings study and retention into the same place you already think and write.

LearnKit replaces a fragmented workflow with one connected system. Your notes, flashcards, review history, tests, and AI study tools live in the same environment, which means less setup, less duplication, and less friction when it is time to study.

## Built for learners who revisit their notes

If you study from your notes, LearnKit is designed for you. It is a strong fit for exam prep, technical subjects, language study, and any workflow where long-term retention matters.

It works especially well if you already take structured notes in Obsidian and want review built into the same vault.

## From install to first review

LearnKit is designed to be usable immediately. Add it to your vault, make one card, review one note, and generate one test session to see the full workflow in action.

## Start learning from your vault

LearnKit is easiest to understand once you use it. Install it, study one note, and see how the workflow fits your vault.

- [Install with BRAT](https://github.com/TfTHacker/obsidian42-brat)
- [Explore documentation](https://ctrlaltwill.github.io/LearnKit/)
- [Download the latest release](https://github.com/ctrlaltwill/LearnKit/releases)

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
- **Study Coach** — personalised study plans and coaching for your exams.
- **Test mode** — auto-generated quizzes straight from your notes.

### Companion — AI learning assistant

Companion is LearnKit's built-in AI study assistant, designed to help you work directly with the notes you already have.

- **Answer questions** about the note you are reading or the topic you are studying.
- **Generate flashcards** from note content in seconds.
- **Generate tests** and practice prompts from your notes.
- **Review note content** and surface clear, actionable feedback.

Understand faster, tighten your notes, and create study-ready material without leaving Obsidian.

Custom skills and note editing are planned for future Companion updates.

You **bring your own API key** — zero subscriptions, zero markups. Companion works with free-tier providers such as Google and OpenRouter, as well as premium platforms including Anthropic, OpenAI, and Perplexity.

Free models are a good way to get started, but not every model supports every Companion workflow, and premium models generally perform better for more demanding tasks such as working with attachments. To start for free, we recommend Free Model Router or Auto Router via OpenRouter.

## Built to work without AI

AI can speed up study workflows, but LearnKit is useful without it. Companion is an optional layer for question answering, feedback, and generation tasks. The core learning system stands on its own.

## Feature highlights

![LearnKit Banner Two - Rich Card Types](site/branding/Banner%20Two%20-%20Rich%20Card%20Types.png)
![LearnKit Banner Three - FSRS Algorithm](site/branding/Banner%20Three%20-%20FSRS%20Algorithm.png)
![LearnKit Banner Four - Meet Companion](site/branding/Banner%20Four%20-%20Meet%20Companion.png)
![LearnKit Banner Six - Reminders & Gatekeeper](site/branding/Banner%20Six%20-%20Reminders%20%26%20Gatekeeper.png)
![LearnKit Banner Seven - Card Creation](site/branding/Banner%20Seven%20-%20Card%20Creation.png)
![LearnKit Banner Five - Audio Functionality](site/branding/Banner%20Five%20-%20Audio%20Functionality.png)
![LearnKit Banner Eight - Data Analysis](site/branding/Banner%20Eight%20-%20Data%20Analysis.png)
![LearnKit Banner Nine - Anki Compatibility](site/branding/Banner%20Nine%20-%20Anki%20Compatibility.png)

## FAQ

If you are deciding whether LearnKit fits your workflow, start here.

- **Do I need AI to use LearnKit?** No. AI is an optional layer in LearnKit, not a requirement. You can use the main study workflow without connecting any model provider.
- **Is LearnKit free?** Yes. LearnKit itself is free and open source. Companion does not add a subscription layer, but external model providers may charge depending on the API you use.
- **Can I use LearnKit with my existing notes?** Yes. LearnKit is designed to work with the notes you already have in Obsidian, so you can turn existing material into cards, reviews, and tests instead of starting from scratch.
- **Does it work with Anki?** Yes. LearnKit supports Anki import and export for decks, media, and scheduling-related data where supported. Image Occlusion cards are currently skipped on import and are not exported.
- **Does it work on mobile?** Yes. LearnKit is not desktop-only, though some workflows may feel better on larger screens. Check the docs for current platform notes and limitations.

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
