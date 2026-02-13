# Groups

Last updated: 13/02/2026

## Overview

Groups are how you organise flashcards into decks and categories in Sprout. Every card can belong to one or more groups, and groups can be nested to create a hierarchy.

## Assigning groups

Add a `G` field to any card block:

```
Q | What is the capital of France? |
A | Paris |
G | Geography |
```

### Multiple groups

Separate group names with commas to assign a card to multiple groups:

```
G | Anatomy, Cardiology |
```

### Nested groups

Use `/` within a group name to create a hierarchy:

```
G | Medicine/Cardiology/Valves |
```

This creates a nested deck structure: **Medicine → Cardiology → Valves**.

## Using groups

### In the deck tree

Groups appear as decks in the study page's deck tree. Nested groups create a collapsible tree structure. Selecting a parent group includes all cards in its child groups.

### In the widget

The sidebar widget uses groups as the deck structure for quick-start sessions.

### In the Card Browser

You can filter cards by group in the [[Card Browser]]. The **Groups** column shows each card's assigned groups in `Group / Subgroup` format.

### As study scopes

When starting a study session, you can choose **Group** as the scope to study only cards tagged with a specific group or group prefix.

## Tips

- Keep group names consistent — `Anatomy` and `anatomy` are treated as the same group (case-insensitive matching).
- Use groups for both subject organisation (e.g. `Biology/Cell`) and study goals (e.g. `Exam Prep`).
- Cards without a `G` field are still part of your vault and can be studied via folder or note scopes.
