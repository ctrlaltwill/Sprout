# Grading

Last modified: 13/02/2026

## How grading works

After you reveal a card, you grade recall quality. That grade is passed to FSRS, which updates difficulty and next review timing.

## Grading modes

Sprout offers two grading modes, configurable in **Settings → Study → Grading buttons**:

### Two-button mode (default, recommended)

Two-button mode works as a simple pass / fail system:

| Button | Shortcut | When to use |
|---|---|---|
| Again (Fail) | `1` | Your answer is incorrect, or you couldn't recall it. If your answer is only partially correct, be strict with yourself — if it would count as wrong in a real-life context, press Again. |
| Good (Pass) | `2` | Your answer is correct. |

This mode is simpler and faster, and is recommended for most users.

### Four-button mode

| Button | Shortcut | When to use |
|---|---|---|
| Again | `1` | Your answer is incorrect or you couldn't recall it. If your answer is partially correct, be strict with yourself — if it would count as a fail in a real-life context, press Again. You'll typically use this button about 5–20% of the time. |
| Hard | `2` | Your answer is correct, but you had doubts about it or it took a long time to recall. |
| Good | `3` | Your answer is correct, but it took some mental effort to recall. When used properly, this should be the most commonly used button — roughly 80–95% of the time. |
| Easy | `4` | Your answer is correct and it took no mental effort to recall. |

This mode gives finer control, but it is slower and easier to overthink.

> [!TIP]
> Use four buttons only if you want extra grading granularity. Otherwise, keep two-button mode.

## Auto-graded card types

Some card types are graded automatically based on your interaction — you don't press a separate grade button:

| Card type | How it's graded |
|---|---|
| **Multiple Choice** | Correct option → Good. Incorrect → Again. |
| **Ordered Questions** | Correct sequence → Good. Any item wrong → Again. |

For these types, your response applies the grade directly.

## How grading affects scheduling

Each grade feeds into the FSRS algorithm, which updates three values for the card:

| Value | Updated how |
|---|---|
| **Stability** | Increases with Good/Easy grades, decreases with Again |
| **Difficulty** | Increases when you press Again, decreases with Easy |
| **Next interval** | Calculated so your recall probability equals your target retention on the due date |

See [[Scheduling]] for a deeper explanation of FSRS.

## Keyboard shortcuts summary

| Key | Action |
|---|---|
| `Space` / `Enter` | Reveal answer |
| `1` – `2` (two-button) | Again / Good |
| `1` – `4` (four-button) | Again / Hard / Good / Easy |
