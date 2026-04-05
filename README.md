# LearnKit — Flashcards, Spaced Repetition & Study Tools

![GitHub Release](https://img.shields.io/github/v/release/ctrlaltwill/LearnKit)
[![GitHub issues](https://img.shields.io/github/issues/ctrlaltwill/LearnKit)](https://github.com/ctrlaltwill/LearnKit/issues)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/ctrlaltwill/LearnKit/total)
[![CI](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml/badge.svg)](https://github.com/ctrlaltwill/LearnKit/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-astro%2Fstarlight-blue)](https://ctrlaltwill.github.io/LearnKit/)

![LearnKit Banner One - Welcome](site/branding/Banner%20One%20-%20Welcome.png)

> [!IMPORTANT]
> **1.2.8 is the current release.** If you are updating from a version before 1.2.3, review the [1.2.3 migration notes](release/1.2.3/RELEASE_NOTES.md#important-plugin-id-migration) first because the plugin ID changed in that release.

LearnKit helps you remember what you write. It brings flashcards, note review, tests, and AI-assisted study tools into Obsidian, so your vault becomes a place to learn, not just store information.

Flashcards are where LearnKit started, but the goal was always bigger: to turn your vault into a memory layer that connects notes, review, and long-term retention.

## Why LearnKit

Most note apps help you capture information. LearnKit helps you study it. Instead of splitting your workflow across notes, flashcards, and different applications, LearnKit keeps review in the same vault you already use.

## Start learning from your vault

LearnKit is easiest to understand once you use it. Install it, create a flashcard, run a review, or generate a test to see how it fits your study workflow.

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
- **Rich flashcard types** — cloze, basic, reversed, multiple choice, image occlusion, and more.
- **Text-to-speech & audio** — built-in playback for language learning and listening practice.
- **Study analytics** — charts, heatmaps, and retention trends at a glance.
- **Markdown-first** — flashcards live inside your notes, linked to the knowledge they came from.
- **Reading view customisation** — keep notes clean and distraction-free while studying.
- **Note review mode** — spaced repetition for your notes, not just flashcards.
- **Study coach** — personalised study plans and coaching for your exams.
- **Test mode** — AI-generated quizzes straight from your notes.

### Companion — AI learning assistant

Companion is LearnKit's built-in AI study assistant for working directly with the notes you already have.

- **Answer questions** about what you are reading.
- **Generate flashcards and tests** from note content.
- **Review notes** and surface actionable feedback.

Turn notes into study-ready material without leaving Obsidian.

## Feature highlights

![LearnKit Banner Two - Rich Flashcard Types](site/branding/Banner%20Two%20-%20Rich%20Card%20Types.png)
![LearnKit Banner Three - FSRS Algorithm](site/branding/Banner%20Three%20-%20FSRS%20Algorithm.png)
![LearnKit Banner Four - Meet Companion](site/branding/Banner%20Four%20-%20Meet%20Companion.png)
![LearnKit Banner Six - Reminders & Gatekeeper](site/branding/Banner%20Six%20-%20Reminders%20%26%20Gatekeeper.png)
![LearnKit Banner Seven - Card Creation](site/branding/Banner%20Seven%20-%20Card%20Creation.png)
![LearnKit Banner Five - Audio Functionality](site/branding/Banner%20Five%20-%20Audio%20Functionality.png)
![LearnKit Banner Eight - Data Analysis](site/branding/Banner%20Eight%20-%20Data%20Analysis.png)
![LearnKit Banner Nine - Anki Compatibility](site/branding/Banner%20Nine%20-%20Anki%20Compatibility.png)

## FAQ

If you are deciding whether LearnKit fits your workflow, start here.

- **Can I use LearnKit with my existing notes?** Yes. LearnKit is designed to work with the notes you already have in Obsidian, so you can turn existing material into flashcards, reviews, and tests instead of starting from scratch.
- **Does it work with Anki?** Yes. LearnKit supports Anki import and export for decks, media, and scheduling-related data where supported. Image Occlusion flashcards are currently skipped on import and are not exported.
- **Does it work on mobile?** Yes. LearnKit is not desktop-only, though some workflows may feel better on larger screens. Check the docs for current platform notes and limitations.
- **What is planned for Companion?** Custom skills and note editing are planned for future updates.
- **Do I need AI to use LearnKit?** No. AI is an optional layer in LearnKit, not a requirement. You can use the main study workflow without connecting any model provider.
- **Is LearnKit free?** Yes. LearnKit itself is free and open source. Companion does not add a subscription layer, but external model providers may charge depending on the API you use.
- **How does Companion work?** Companion uses your own API key, so there are no subscriptions or markups from LearnKit. It works with providers including Google, OpenRouter, Anthropic, OpenAI, and Perplexity.
- **Can Companion access my whole vault by default?** No. Companion only receives the note content you send in a given workflow, such as asking about a note, generating flashcards, or generating a test. Depending on the feature and your settings, that can also include extra context such as note attachments or linked notes for context.
- **Do all AI models support every Companion feature?** No. Free models are a good way to get started, but capability varies by model. Premium models generally perform better for more demanding tasks such as working with attachments.

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
