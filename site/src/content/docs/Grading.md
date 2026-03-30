---
title: "Grading"
---

# Grading

Grading is how you tell LearnKit how well you recalled a flashcard.

After you reveal the answer, your grade is sent to FSRS and used to update the next interval.

Open **Settings -> Studying** to change grading-related options.

## Grade Modes

LearnKit supports two grading layouts.

### Two Buttons

Use **Settings -> Studying -> Grading buttons** to switch to the simpler layout.

| Button | Shortcut | Use it when... |
|---|---|---|
| **Again** | `1` | You got it wrong or could not recall it cleanly |
| **Good** | `2` | You recalled it correctly |

This is the faster mode and usually the best default.

### Four Buttons

| Button | Shortcut | Use it when... |
|---|---|---|
| **Again** | `1` | You got it wrong |
| **Hard** | `2` | You got it right, but it felt shaky or slow |
| **Good** | `3` | You got it right with normal effort |
| **Easy** | `4` | You got it right immediately and comfortably |

This mode gives FSRS more signal, but it also makes grading slower.

## What The Grades Change

Each grade can affect:

- the card's difficulty
- the card's stability
- the next review interval

In general:

- **Again** pulls the card closer
- **Hard** keeps the card conservative
- **Good** is the normal successful review
- **Easy** pushes the card further out than Good

See [Scheduling](./Scheduling) for the deeper scheduler model.

## Auto-Graded Cards

Some flashcard types do not show separate grading buttons.

| Card type | What LearnKit does |
|---|---|
| **Multiple Choice** | Correct answer maps to **Good** and an incorrect answer maps to **Again** |
| **Ordered Questions** | A correct sequence maps to **Good** and any mistake maps to **Again** |

## Related Settings

These settings sit in the same Studying tab and usually matter alongside grading:

- **Grading buttons**
- **Show grade intervals**
- **Skip button**
- **Auto-advance**

## Good Rule Of Thumb

Use **two buttons** unless you already know you want finer grading.

If you do use four buttons, make **Good** your normal successful answer and reserve **Easy** for cards that felt genuinely effortless.

## Related

- [Scheduling](./Scheduling)
- [Study Sessions](./Study-Sessions)
- [Keyboard Shortcuts](./Keyboard-Shortcuts)

---

Last modified: 30/03/2026
