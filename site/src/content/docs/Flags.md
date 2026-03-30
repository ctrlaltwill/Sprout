---
title: "Flags"
---


LearnKit supports inline flag tokens inside flashcard text.

Use them like this:

- `{{es}}`
- `{{gb}}`
- `{{us-ca}}`
- `{{es-mx}}`

These tokens render as circular flags and can also steer text-to-speech when flag-aware routing is enabled.

## Where flags work

Flags work in text content fields such as:

- title rows
- question rows
- answer rows
- multiple-choice options
- ordered-question steps
- extra information rows

Flags do not belong in group rows.

## Editing behaviour

In editors and input fields:

- focused fields show the raw token
- unfocused previews render the flag image

That makes flags editable without hiding the actual code you typed.

## Where they render

Flags render in:

- study sessions
- the study widget
- Gatekeeper
- Reading View

They are also read by the TTS system when `Use flags for language and accent` is enabled in `Settings -> Audio`.

## Examples

```text
Q | {{es}} Hola |
A | {{gb}} Hello |
```

```text
Q | {{us-ca}} California |
A | {{gb}} West Coast, United States |
```

## Syntax rules

- Valid tokens use two lowercase code parts, optionally joined by one hyphen.
- Invalid tokens are left as plain text.
- Cloze syntax such as `{{c1::...}}` is not treated as a flag.

## Offline behaviour

Flag images are downloaded on demand and then cached locally.

- the first time a code appears, network access may be needed
- after that, cached SVG data can be reused offline
- the local cache is size-limited so it does not grow forever

## Flags and TTS

When flag-aware routing is on:

- one flag can set the voice choice for the whole spoken segment
- multiple flags in one field can switch voices inline
- `Announce language name` can speak the language before each switched segment

For the full code reference, see [Flag-Codes](../Flag-Codes). For audio behaviour, see [Text-to-Speech](../Text-to-Speech).

Last modified: 30/03/2026
