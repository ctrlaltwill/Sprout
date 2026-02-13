# Scheduling

Last updated: 13/02/2026

## Overview

Sprout uses **FSRS** (Free Spaced Repetition Scheduler), a modern algorithm that models how your memory decays over time. It replaces fixed multipliers with a mathematical model that adapts to each card individually.

## How FSRS works

Every card tracks three key values:

| Value | Meaning |
|-------|---------|
| **Stability** | How many days until your recall probability drops to the requested retention. Higher = longer intervals. |
| **Difficulty** | How inherently hard the card is for you (0–10). Updated with each review. |
| **Retrievability** | Your estimated probability of recalling the card right now (0–1). Decays over time. |

When you rate a card:

1. FSRS updates **difficulty** and **stability** based on your rating and the time elapsed since the last review.
2. It calculates the next interval so that your **retrievability** will equal your **requested retention** on the due date.
3. The card is scheduled for that many days in the future.

In short: cards you find easy get longer intervals; cards you forget get shorter ones.

## Card stages

| Stage | Description |
|-------|-------------|
| **New** | Never reviewed — enters the learning queue when first seen |
| **Learning** | In initial learning steps (short intervals) |
| **Review** | Graduated to the review queue (longer intervals) |
| **Relearning** | Failed a review — back in short-interval learning steps |

## Presets

Choose a preset in **Settings → Study → Scheduling** or fine-tune manually:

| Preset | Learning steps | Relearning steps | Retention |
|--------|----------------|------------------|-----------|
| Relaxed | 20 min | 20 min | 0.88 |
| Balanced | 10 min, 1 day | 10 min | 0.90 |
| Aggressive | 5 min, 30 min, 1 day | 10 min | 0.92 |
| Custom | *(user-defined)* | *(user-defined)* | *(user-defined)* |

### Manual options

| Setting | Default | Description |
|---------|---------|-------------|
| Learning steps | `10, 1440` | Minutes between learning steps (comma-separated) |
| Relearning steps | `10` | Minutes between relearning steps |
| Requested retention | 0.90 | Target recall probability (0.80–0.97) |

### What the settings mean

- **Learning steps** — When a new card is first seen, it goes through these short-interval steps before graduating to the review queue. `10, 1440` means: first see again after 10 minutes, then after 1 day (1440 minutes).
- **Relearning steps** — When you forget a card (press Again), it re-enters these steps before returning to the review queue.
- **Requested retention** — Your target probability of remembering a card when it's due. Higher values (e.g. 0.95) mean shorter intervals but more reviews per day. Lower values (e.g. 0.85) mean longer intervals but more forgetting.

> [!TIP]
> **0.90** (90% retention) is a good default. Only adjust if you have a specific reason — e.g. raise it before exams, lower it for low-stakes material.

## FSRS console / log

You can view the internal FSRS scheduling log for any card to understand how its parameters were calculated:

1. Open the [[Card Browser]].
2. Select a card.
3. Open the card's detail view — the FSRS log shows the full history of ratings, stability changes, difficulty updates, and interval calculations.

This is useful for debugging why a card has a particular interval or for understanding the algorithm's behaviour.

## Reset options

| Button | Effect |
|--------|--------|
| Reset scheduling | Reset all cards back to **New** (clears all intervals, stability, difficulty) |
| Reset analytics | Clear review history and heatmap data |

These are found in **Settings → Reset**. Use with caution — both are irreversible.
