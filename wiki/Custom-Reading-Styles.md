# Custom Reading Styles

Last modified: 16/02/2026

## Overview

Custom classes and custom styling for Reading View are planned for a future release.

Currently, the available Reading macro styles are **Disabled**, **Flashcards**, and **Clean markdown**.

The **Custom** style is not active yet. When released, this page will document how to use **Settings → Reading → Macro styles → Custom** and apply **Custom style CSS**.

## Scope and safety

When released, Custom CSS will be injected only when the Custom macro is active and should be scoped to:

`.sprout-pretty-card.sprout-macro-custom`

This will prevent your custom rules from changing Disabled, Flashcards, Clean markdown, or future macro styles.

## Clean hook classes

These hook classes are planned for easy targeting in a future release:

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

## Classic-like starter example

Paste this into **Custom style CSS**:

```css
.sprout-pretty-card.sprout-macro-custom .sprout-custom-body {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
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

## Tips

- Start with small rules and iterate.
- Prefer hook classes over generic selectors.
- Keep selectors scoped to `.sprout-macro-custom`.
