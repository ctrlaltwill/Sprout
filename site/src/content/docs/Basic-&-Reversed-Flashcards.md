---
title: "Basic & Reversed Flashcards"
---

## Purpose

Basic flashcards show a question first, then an answer.
Reversed flashcards add a second flashcard automatically so you study both directions.

Combo cards can be used as an extension of basic cards, they are explained further below:
- Use Cross Combo when every combination produces a valid card.
- Use Sequential Combo when cross-pairings would be factually wrong.

## Basic Format

```
T | Title |
Q | What is the capital of France? |
A | Paris |
I | Extra context |
G | Geography |
```

- Required fields: `Q` and `A`
- Optional fields: `T`, `I`, `G`

## Modal Steps

1. Right-click in a note.
2. Choose **Add flashcard -> Basic Card**.
3. Fill in fields and save.

## Reverse Mode

With reverse enabled, LearnKit creates:

1. Question -> Answer
2. Answer -> Question

Use the reverse option in the modal to enable this.

## Demo

![Basic card demo](../../../branding/Demo/Basic%20Card.png)

_Basic card question and answer flow._

## Grading

After revealing the answer, grade your recall:

- two-button mode: Again / Good
- four-button mode: Again / Hard / Good / Easy

See [Grading](../Grading).

## Tips

- If `Q` or `A` is missing, the flashcard cannot work correctly.
- Keep one fact per flashcard for better retention.
- Use `I` for hints or references instead of making `A` too long.
- Use groups to organise by topic.

## Cross Combo Cards (`::`)

Cross Combo cards use ` :: ` (space-colon-colon-space) to separate multiple variants inside the `Q` and/or `A` fields. LearnKit generates the full [Cartesian product](https://en.wikipedia.org/wiki/Cartesian_product) — every possible combination of Q and A variants. **Q count × A count = total cards.**

This is useful when every combination produces a *valid* card. Common patterns:

- **1 × N**: one question, multiple correct answers — test every facet.
- **N × 1**: multiple questions, all sharing the same answer.
- **N × N**:  less likely to be used, multiple questions and answers that are interchangeable.

> **Credit:** Combo card support was contributed by [sevenRevy](https://github.com/sevenRevy).

### Example: One common question, many answers (1 × N)

```
T | Shock |
Q | Define shock |
A | Inadequate tissue perfusion to meet metabolic demands :: A state of circulatory failure resulting in cellular hypoxia :: MAP < 65 mmHg with evidence of end-organ hypoperfusion |
```

1 Q × 3 A = **3 cards**, all with the same question. Each card tests a different valid definition.

### Example: Many questions, one common answer (N × 1)

```
T | Beta Blockers – Classes |
Q | Atenolol :: Bisoprolol :: Metoprolol |
A | Cardioselective beta blocker |
```

3 Q × 1 A = **3 cards**. Different drugs, same shared answer.

### Cross Combo Tips
- Keep variant lists short. A 4 × 4 cross combo generates 16 cards.
- Only one side needs variants — a single A paired with multiple Qs, or vice versa.
- Combine with [Reverse Mode](#reverse-mode) to study each combination in both directions.
- Use Cross Combo when every combination produces a valid card.

## Sequential Combo Cards (`:::`)

Use ` ::: ` (space-colon-colon-colon-space) to separate variants. LearnKit pairs the *i*‑th Q variant with the *i*‑th A variant in strict one-to-one order. **No cross-combinations are generated.** Q and A must have the same number of variants, or LearnKit will flag a mismatch. This is a good way to create multiple flashcards in the same format without making multiple individual cards.

This is ideal for **1:1 paired lists** where cross-pairings are incorrect. 

```
T | Blood Cell Counts |
Q | Anaemia ::: Polycythaemia |
A | Abnormally low red cell count :: Abnormally high red cell count |
```

2 Q + 2 A = **2 cards**:

| Card | Question | Answer |
|------|----------|--------|
| 1 | Anaemia | Abnormally low red cell count |
| 2 | Polycythaemia | Abnormally high red cell count |

2 variants = **2 cards**, one per red cell disorder.

```
T | European Capitals |
Q | France ::: Spain ::: Germany |
A | Paris ::: Madrid ::: Berlin |
```

3 variants = **3 cards**, one per country.

### Sequential Combo Tips
- Q and A must have the same number of `:::` -separated variants.
- Combine with [Reverse Mode](#reverse-mode) to study each pair in both directions.
- Use Sequential Combo when cross-pairings would be factually wrong.

## Related

- [Creating Flashcards](../Creating-Flashcards)
- [Flashcards](../Flashcards)
- [Hotspot Cards](../Hotspot-Cards)

---

Last modified: 03/05/2026