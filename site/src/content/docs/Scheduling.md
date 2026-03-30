---
title: "Scheduling"
---

# Scheduling

Scheduling is the reference page for LearnKit's flashcard scheduler.

Open **Settings -> Studying** to change these controls.

## What Scheduling Changes

Scheduling decides:

- how long new cards stay in short learning steps
- how failed cards recover after lapses
- how often review cards come back
- how much workload you trade for higher retention

## FSRS Basics

LearnKit uses **FSRS** for flashcards.

FSRS uses your grades, the time since last review, and your settings to choose the next due date.

Each flashcard tracks three core values:

| Value | Meaning |
|-------|---------|
| **Stability** | How long the memory is expected to last |
| **Difficulty** | How hard the card is for you |
| **Retrievability** | How likely you are to remember it right now |

In practice:

- successful recalls usually push intervals out
- failed recalls shorten the next interval
- harder cards stay on shorter intervals than easier ones

## Card Stages

| Stage | What it means |
|-------|-------------|
| **New** | Never reviewed yet |
| **Learning** | Moving through short starter steps |
| **Review** | On the main long-interval schedule |
| **Relearning** | Back on short steps after a failed review |

## Presets

LearnKit includes preset bundles in **Settings -> Studying -> Preset**.

| Preset | Learning steps | Relearning steps | Retention |
|--------|----------------|------------------|-----------|
| Relaxed | 20 min | 20 min | 0.88 |
| Balanced | 10 min, 1 day | 10 min | 0.90 |
| Aggressive | 5 min, 30 min, 1 day | 10 min | 0.92 |
| Custom | Your own values | Your own values | Your own value |

## Main Controls

| Setting | What it does |
|---------|-------------|
| **Preset** | Apply a ready-made mix of steps and retention |
| **Learning steps** | Set the short intervals for new flashcards |
| **Relearning steps** | Set the short intervals after a failed review |
| **Requested retention** | Set the target recall probability at review time |
| **Fuzz intervals** | Add small randomness so due cards spread out instead of stacking on one day |

## What Retention Means

Requested retention is the biggest workload lever.

- higher retention means more frequent reviews and less forgetting
- lower retention means lighter workload and more forgetting between reviews

For most users, **0.90** is a strong default.

## FSRS Optimisation

The same Studying tab also includes **Optimise FSRS parameters**.

Use it when you already have a solid review history and want FSRS to fit your own recall pattern more closely.

The **Clear** button removes those personalised weights and goes back to the default FSRS model.

## When To Reset Scheduling

Use **Reset scheduling** only when you deliberately want to start over.

It clears scheduling progress and returns cards to a fresh state. If you might want to undo that later, create a manual backup first.

## Related

- [Grading](./Grading)
- [Study Sessions](./Study-Sessions)
- [Flashcard Library](./Flashcard-Library)
- [Backups](./Backups)

---

Last modified: 30/03/2026
