---
title: "Reading View"
---

# Reading View

Reading View controls how LearnKit flashcards are rendered inside Obsidian's reading mode.

It changes presentation, not flashcard data.

## Where to configure it

Open `Settings -> General -> Reading view`.

The current live controls are:

- `Card styling` to turn LearnKit rendering on or off
- `Card style` to choose between `Flashcards` and `Clean markdown`
- style-specific display toggles

## Current styles

LearnKit currently exposes two reading styles:

| Style | What it looks like | Best for |
|------|---------------------|----------|
| Flashcards | Flip-style cards in a masonry layout | quick active recall while reading notes |
| Clean markdown | Vertical note-style blocks with readable field sections | reviewing structure and content in context |

Older preset names like Classic, Guidebook, and Custom still exist in the underlying reading engine, but they are not selectable in the current settings UI.

## What Flashcards style shows

Flashcards style focuses on the question and answer and supports optional inline actions:

- `Show edit button`
- `Show audio button`

This style is the most compact and study-oriented view.

## What Clean markdown shows

Clean markdown style gives you field-level control over what appears:

- title
- question
- options
- answer
- info
- groups
- field labels

It uses a vertical layout and does not show the inline edit button.

## What still works in reading mode

- math renders with Obsidian's normal math pipeline
- images stay inline
- cloze content is rendered with LearnKit's cloze styling
- text-to-speech buttons can appear when the chosen style allows them and TTS is enabled

## Why use it

- check formatting before a study session
- scan a note without opening the editor for every card
- catch bad cloze wording, broken options, or misplaced extra info early

For the style-by-style breakdown, see [Reading-View-Styles](./Reading-View-Styles).

Last modified: 30/03/2026
