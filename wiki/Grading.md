# Grading

Last updated: 13/02/2026

## Overview

After revealing the answer to a card, you grade how well you recalled it. Your grade determines how the FSRS scheduler adjusts that card's next review interval.

## Grading modes

Sprout offers two grading modes, configurable in **Settings → Study → Grading buttons**:

### Two-button mode (default, recommended)

| Button | Shortcut | Meaning |
|--------|----------|---------|
| Again | `1` | Forgot — card re-enters the learning queue |
| Good | `2` | Remembered |

Two-button mode is simpler and faster. Research suggests that the extra granularity of four buttons doesn't significantly improve scheduling, so **two buttons is recommended** for most users.

### Four-button mode

| Button | Shortcut | Meaning |
|--------|----------|---------|
| Again | `1` | Forgot |
| Hard | `2` | Recalled with difficulty |
| Good | `3` | Comfortable recall |
| Easy | `4` | Effortless |

Four-button mode gives more nuanced feedback to the scheduler but is slower to use and can lead to overthinking.

> [!TIP]
> Enable four-button mode in **Settings → Study → Grading buttons** if you want finer control over scheduling. Otherwise, stick with two buttons.

## Auto-graded card types

Some card types are graded automatically based on your interaction — you don't press a separate grade button:

| Card type | How it's graded |
|-----------|----------------|
| **Multiple Choice** | Correct option → Good. Incorrect → Again. |
| **Ordered Questions** | Correct sequence → Good. Any item wrong → Again. |

For auto-graded types, your selection or arrangement determines the grade directly. The FSRS scheduler then processes the grade the same way as for manually-graded cards.

## How grading affects scheduling

Each grade feeds into the FSRS algorithm, which updates three values for the card:

| Value | Updated how |
|-------|-------------|
| **Stability** | Increases with Good/Easy grades, decreases with Again |
| **Difficulty** | Increases when you press Again, decreases with Easy |
| **Next interval** | Calculated so your recall probability equals your target retention on the due date |

See [[Scheduling]] for a deeper explanation of FSRS.

## Keyboard shortcuts summary

| Key | Action |
|-----|--------|
| `Space` / `Enter` | Reveal answer |
| `1` – `2` (two-button) | Again / Good |
| `1` – `4` (four-button) | Again / Hard / Good / Easy |
