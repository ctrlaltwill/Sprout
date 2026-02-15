# Custom Reading Styles

Last modified: 15/02/2026

## Overview

Sprout includes a **Custom** macro style for Reading View.

Use **Settings → Reading → Macro styles → Custom**.

Then use **Custom style CSS** to paste your CSS.

## Scope and safety

Custom CSS is injected only when the Custom macro is active and should be scoped to:

`.sprout-pretty-card.sprout-macro-custom`

This prevents your custom rules from changing Flashcards, Classic, Guidebook, or Clean markdown.

## Clean hook classes

These hooks are provided for easy targeting:

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
