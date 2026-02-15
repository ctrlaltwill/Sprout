# Reading View

Last modified: 15/02/2026

## Overview

Reading View controls how Sprout card blocks look in Obsidian reading mode.

It does not change card data. It only changes how cards are displayed while reading notes.

## What's shown in reading view

In reading mode, Sprout can show:

- Card type badge (Basic, Cloze, MCQ, IO, Ordered).
- Formatted card fields.
- Edit button for quick edits.
- Group tags.

## Appearance settings

Change these in **Settings → Reading**:

| Setting | Description |
|---------|-------------|
| **Enable card styling** | When off, cards use native Obsidian reading view with no Sprout styling |
| **Macro styles** | Choose one of Flashcards, Classic, Guidebook, Clean markdown, or Custom |
| **Reading view fields** | Configure visible fields per macro style |
| **Reading view colours** | Customise card colours for macros that support colour settings |
| **Custom style CSS** | Add CSS that applies only to the Custom macro |

## Macro styles

- **Flashcards**: Front/back flip cards (question on front, answer on back).
- **Classic**: Collapsible sections with chevrons for progressive reveal.
- **Guidebook**: Walkthrough-style sections with guide navigation controls.
- **Clean markdown**: Minimal, tidied markdown-style card rendering.
- **Custom**: User-defined CSS with clean custom hooks for full styling control.

For details, see [[Reading View Styles]] and [[Custom Reading Styles]].

## Interaction

- **Edit button** opens the card editor for that card.
- Cloze cards can show hints or blanks, based on your settings.
- Embedded images render inline.
- Math uses Obsidian LaTeX rendering.

## Tips

- Use Reading View to spot formatting problems before studying.
- If a card looks wrong, use Edit directly from the card block.
- If a card block does not render as expected, check card syntax and run a sync.
