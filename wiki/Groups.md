# Groups

Last modified: 13/02/2026

## What groups are

Groups organize cards into deck-like categories. A card can belong to one or more groups. Groups can be nested.

## Assigning groups

Add a `G` field to any card block:

```
Q | What is the capital of France? |
A | Paris |
G | Geography |
```

### Multiple groups

Separate names with commas:

```
G | Anatomy, Cardiology |
```

### Nested groups

Use `/` to create hierarchy levels:

```
G | Medicine/Cardiology/Valves |
```

This becomes a nested structure: Medicine → Cardiology → Valves.

## Using groups

### In the deck tree

Groups appear as decks in the study tree. Selecting a parent includes its child groups.

### In the widget

The widget uses groups as its deck structure.

### In the Card Browser

You can filter by group in the [[Card Browser]].

### As study scopes

You can start sessions scoped to a specific group or group prefix.

## Important details

- Matching is case-insensitive (`Anatomy` and `anatomy` are the same group).
- Cards without `G` are still studyable through folder or note scopes.
