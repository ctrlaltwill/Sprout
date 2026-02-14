# Scheduling

Last modified: 13/02/2026

## Overview

Sprout uses **FSRS** (Free Spaced Repetition Scheduler).

FSRS chooses future review dates per card, based on your past answers and elapsed time.

## How FSRS works

Each card tracks 3 values:

| Value | Meaning |
|-------|---------|
| **Stability** | How long memory lasts before dropping to target retention |
| **Difficulty** | How hard the card is for you (0–10) |
| **Retrievability** | Estimated chance (0–1) you can recall it right now |

When you rate a card, FSRS:

1. Updates difficulty and stability.
2. Calculates a next interval to meet your requested retention.
3. Schedules the due date.

In practice, easy cards get longer intervals; forgotten cards get shorter intervals.

## Card stages

| Stage | Description |
|-------|-------------|
| **New** | Never reviewed |
| **Learning** | Early short-interval steps |
| **Review** | Main long-interval stage |
| **Relearning** | Short steps after a failed review |

## Presets

Choose a preset in **Settings → Study → Scheduling** or set values manually:

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

- **Learning steps**: short intervals for new cards before they move to Review.
- **Relearning steps**: short intervals after an Again on a Review card.
- **Requested retention**: target recall when card is due.

Higher retention increases workload (more frequent reviews). Lower retention reduces workload but increases forgetting.

> [!TIP]
> **0.90** is a strong default for most users.

## FSRS console / log

You can inspect a card's FSRS history:

1. Open the [[Card-Browser|Card Browser]].
2. Select a card.
3. Open card details to see ratings, stability, difficulty, and interval calculations.

Use this if a due date looks unexpected.

## Reset options

| Button | Effect |
|--------|--------|
| Reset scheduling | Reset all cards to **New** (clears intervals, stability, difficulty) |
| Reset analytics | Clear review history and heatmap data |

Both options are in **Settings → Reset** and cannot be undone.
