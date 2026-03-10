# Assistant Usage

Last modified: 10/03/2026

## Overview

Sprig has three working modes:

- **Ask**: Q&A against the open note.
- **Review**: Structured note feedback and study-focused revision support.
- **Generate (Flashcard mode)**: Draft flashcards from the current note.

## Ask

Use Ask when you want quick explanation or clarification from the current note.

Good prompts:

- Explain this section in simpler language.
- Turn this paragraph into three memory checkpoints.
- What assumptions are being made here?

## Review

Use Review for higher-level note quality checks.

Suggested flow:

1. Run a review pass on a finished note.
2. Fix factual, structural, and clarity issues.
3. Re-run with a narrower prompt (for example: "focus on weak definitions").

## Generate flashcards

Use Generate to draft cards from the open note, then insert/edit them.

Recommended workflow:

1. Choose card types and target card count.
2. Generate suggestions.
3. Review each suggestion before inserting.
4. Sync and test cards in study.

## Current limitations

- Treat generated cards as drafts, not final truth.
- Image occlusion generation can still be imperfect and should be validated manually.
- Non-visual models are not suitable for image-based generation workflows.

## Quality guardrails

Before accepting generated cards:

- Confirm facts against source notes.
- Remove ambiguity.
- Keep one concept per card where possible.
- Reject low-signal or duplicate cards.

For data/privacy expectations, see [AI Usage Policy](./AI-Usage-Policy.md).
