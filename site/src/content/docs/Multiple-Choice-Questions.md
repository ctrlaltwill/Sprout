---
title: "Multiple Choice Questions"
---


Multiple choice flashcards test recognition and discrimination.

They work best when you need to choose between similar options, not just recall a single isolated fact.

## Basic format

Use `MCQ` for the prompt, `A` for correct answers, and `O` for incorrect options.

```text
T | French capitals |
MCQ | What is the capital of France? |
A | Paris |
O | London |
O | Berlin |
O | Madrid |
I | Remember: it is on the Seine |
G | Geography |
```

## Single-answer and multi-answer MCQ

LearnKit supports both:

- single-answer MCQ with one `A` row
- multi-answer MCQ with more than one `A` row

If you add multiple correct answers, LearnKit treats the card as a multi-select question.

## Creating one in the modal

Use `Add flashcard`, choose `Multiple Choice`, then enter:

- the question stem
- at least one correct answer
- at least one wrong option

LearnKit will not save the card unless both the correct and wrong sides are present.

## Review flow

For single-answer cards:

- tap one option
- LearnKit grades the card immediately

For multi-answer cards:

- select all answers you think are correct
- click `Submit`

After grading, LearnKit highlights correct and incorrect selections.

## Grading

Multiple choice cards are auto-graded.

In normal use, the result is effectively:

- fully correct answer -> `Good`
- wrong answer -> `Again`

That grade is then passed into the scheduler like any other flashcard.

## Shuffle setting

Option order can be randomized in:

`Settings -> Flashcards -> Multiple choice -> Shuffle order`

When enabled, LearnKit keeps one shuffled order for that card during the current session so the answers do not keep moving mid-review.

## Demo

![Multiple choice demo](../../../branding/Demo/Multiple%20Choice.png)

_Multiple choice review with selectable options._

## Good MCQ design

- make wrong options plausible
- avoid trick wording
- test discrimination, not trivia noise
- use the `I` field if the explanation matters after grading

If order matters more than selection, use [Ordered Questions](../Ordered-Questions) instead.

If location on an image matters more than option selection, use [Hotspot Cards](../Hotspot-Cards).

Last modified: 28/04/2026
