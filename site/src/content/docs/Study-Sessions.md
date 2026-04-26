---
title: "Study Sessions"
---


Study Sessions is the main review flow in LearnKit.

This is where due cards appear, answers are revealed, grades are recorded, and future review timing is updated.

## What Happens In A Study Session

1. LearnKit builds a queue for the scope you selected.
2. You review cards one by one.
3. You reveal the answer.
4. You grade your recall.
5. FSRS updates the next review timing.

## Where You Can Start A Session

You can start from:

- the study interface
- the home dashboard
- the deck widget or context-aware study entry points

If you mostly review from the note you are currently writing in, use the [Study Widget](../Widget) for a smaller sidebar workflow.

## Study Scope

The session scope controls which cards are eligible.

Common scopes include:

- folder
- note
- group

Start narrow when debugging or testing. Start broader when doing normal daily review.

## Queue Behavior

LearnKit normally queues cards in this order:

**learning → relearning → review → new**

Sibling handling depends on your **Sibling card management** setting:

- **Standard** leaves siblings in the natural queue order.
- **Disperse** keeps eligible siblings in the queue but spreads them apart.
- **Bury** keeps one sibling active at a time and unlocks the next sibling only after the current one is no longer due soon.

This is separate from the manual **Bury** action during review, which hides the current card for 24 hours.

## Daily Limits

Daily new and review limits are applied per scope.

That means the number of cards you see depends not just on what exists, but also on what is due and what your limits allow.

## Grading

After revealing the answer, grade honestly.

If you are unsure how to judge your answer, read [Grading](../Grading).

## Practice Mode

Practice mode lets you see cards that are not yet due.

This is useful for extra drilling, but it does not change scheduling the same way normal due review does.

## Study Widget

The [Study Widget](../Widget) is the lightweight way to start a session from the note you are already in.

Use it when you want a quick local review burst or a practice run without opening a larger study surface.

## Extra Session Controls

Study Sessions also supports features such as:

- skip - moves the current card further back in the queue without changing its scheduling
- bury - hides the current card for 24 hours so it does not keep interrupting the current session
- suspend - removes the card from future review until you manually unsuspend it
- undo - reverts the previous action if you graded or acted on the last card by mistake
- edit - opens the card editor so you can fix the prompt, answer, or formatting without leaving the workflow
- open source note - jumps to the original note so you can inspect or fix the source material directly

These controls are useful, but the main thing to understand first is the normal reveal-and-grade loop.

## Related

- [Grading](../Grading)
- [Scheduling](../Scheduling)
- [Reminders](../Reminders)
- [Gatekeeper](../Gatekeeper)

---

Last modified: 26/04/2026
