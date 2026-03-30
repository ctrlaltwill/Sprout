---
title: "Custom Reading Styles"
---


Custom Reading View styling is not a live user-facing option in the current settings UI.

Right now, `Settings -> General -> Reading view` only lets you choose `Flashcards` or `Clean markdown`.

## What is already in the engine

The reading renderer still contains a `custom` macro and scoped hook classes. That means LearnKit is already structured for future custom styling, but the setting to switch into that mode is not currently exposed.

## Expected scope

When Custom becomes selectable, custom CSS should be scoped to:

`.sprout-pretty-card.sprout-macro-custom`

That scope keeps custom rules from leaking into the Flashcards or Clean markdown styles.

## Hook classes already defined

- `.sprout-custom-root`
- `.sprout-custom-header`
- `.sprout-custom-title`
- `.sprout-custom-body`
- `.sprout-custom-section`
- `.sprout-custom-section-question`
- `.sprout-custom-section-options`
- `.sprout-custom-section-answer`
- `.sprout-custom-section-info`
- `.sprout-custom-section-groups`
- `.sprout-custom-label`
- `.sprout-custom-content`
- `.sprout-custom-groups`

## Starter example for the future custom mode

When Custom becomes available, a scoped starter style like this will fit the current hook structure:

```css
.sprout-pretty-card.sprout-macro-custom .sprout-custom-body {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-md);
  padding: 14px;
  background: var(--background-primary);
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-section {
  margin-bottom: 10px;
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-label {
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--sprout-font-2xs);
  color: var(--text-muted);
  font-weight: 600;
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-answer,
.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-info,
.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-groups {
  border-top: 1px dashed var(--background-modifier-border);
  padding-top: 8px;
}
```

## For now

If you want a supported Reading View setup today, use [Reading-View-Styles](../Reading-View-Styles) and choose between Flashcards and Clean markdown.

Last modified: 30/03/2026
