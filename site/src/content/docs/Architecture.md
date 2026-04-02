---
title: "Architecture"
description: "High-level architecture of LearnKit plugin runtime, modules, and data flow."
---

This page describes how LearnKit is organized so contributors can quickly locate responsibility boundaries and extension points.

## Runtime Layers

1. Entry and lifecycle
- src/main.ts is the plugin entrypoint.

2. Platform and integrations
- src/platform/plugin/* wires startup, command registration, navigation hooks, and teardown.
- src/platform/core/* contains shared platform services (storage, UI primitives, migrations, release notes).
- src/platform/integrations/* contains external-system boundaries (AI, sync, TTS).
- src/platform/modals/* contains modal-level UI workflows.

3. Domain engine
- src/engine/* contains pure domain logic for parsing, scheduling, note review, and card transformations.

4. Views and feature surfaces
- src/views/* contains user-facing feature modules (reviewer, settings, analytics, reading, widget, companion, tests).

## Major Feature Areas

- Reviewer: review session runtime, grading, answer flow, and hotkeys.
- Reading: reading-view card rendering and extraction in Obsidian notes.
- Widget: compact side-panel review interface.
- Study Assistant (Companion): AI-powered generation and assistance workflows.
- Analytics: study history and charting surfaces.
- Image Occlusion: geometry editing and IO card authoring.

## Data and Sync Flow

1. Notes are parsed into structured card candidates in src/engine/parser/*.
2. Sync integration reconciles parsed cards with persisted state in src/platform/integrations/sync/*.
3. Persistent state is stored through platform store abstractions in src/platform/core/*.
4. Scheduling and review outcomes feed back into store records and analytics pipelines.

## Module Boundary Rules

- Keep UI rendering and event wiring in src/views/* and src/platform/*.
- Keep deterministic domain logic in src/engine/*.
- Keep network or provider adapters inside src/platform/integrations/*.
- Prefer explicit helper modules over circular imports across feature folders.

## Documentation Standard

All TypeScript source files use a top-level JSDoc header:

- @file: repo-relative path.
- @summary: concise module responsibility.
- @exports: named exports in the module API.

Last modified: 02/04/2026
