---
title: "Companion Usage"
---


Companion is an AI chat feature. It is content-aware, so in the same conversation, you can switch between four core features: `Ask`, `Review`, `Edit`, and `Generate`.

## Ask

Use Ask for note-aware questions and follow-up discussion.

Good uses:

- explain a hard section in simpler words
- turn a paragraph into recall prompts
- compare two ideas already mentioned in the note
- ask for a missing prerequisite or definition

Ask works best when your note is already reasonably structured. If you have enabled linked notes or attachments in settings, those can also be included.

## Review

Use Review when you want criticism rather than answers.

Typical workflow:

1. Review a note once it is mostly complete.
2. Fix the factual, structural, or wording problems it finds.
3. Run another review with a narrower follow-up request.

This feature is useful for tightening definitions, spotting gaps, and making notes more studyable before you generate flashcards.

## Edit

Use Edit when you want Companion to improve existing markdown content instead of starting from scratch.

Good uses:

- rewrite a section for clarity while keeping the original meaning
- tighten wording and remove duplication
- restructure headings or bullet flow for easier revision
- clean up generated flashcards before inserting them

Edit works best when you point to a specific section and give concrete constraints, then review the proposed changes before applying them.

## Generate

Use Generate to draft flashcards from the current note.

Recommended workflow:

1. Choose a narrow topic or section.
2. Ask for a small batch.
3. Review each suggestion.
4. Insert only the cards worth keeping.
5. Edit anything vague, duplicated, or badly scoped.

Generate can produce Basic, Reversed, Cloze, Multiple choice, Ordered question, and, with suitable models, Image occlusion cards.

## Prompting tips

- Ask for smaller batches instead of large mixed dumps.
- Name the topic, card type, and difficulty you want.
- Keep each request focused on one part of the note.
- Switch features in the same chat when the task changes, instead of restarting from scratch.
- If quality drops, switch back to Ask or Review instead of forcing Generate to guess.

## Limitations

- Generated content is draft content, not verified truth.
- Attachment workflows depend on the model and may fail on free tiers.
- Image occlusion output can still need manual mask cleanup.
- Saved chat history is per note, not one global thread for the whole vault.

For setup details, see [Companion Configuration](../Companion-Configuration). For policy and privacy expectations, see [AI Usage Policy](../AI-Usage-Policy).

Last modified: 13/04/2026
