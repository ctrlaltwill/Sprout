# Sprout Codebase Rationalisation Plan

## Current State: Audit Summary

**Total**: ~45,000 lines across 70+ TypeScript/TSX files

### Top 15 Largest Files (the pain points)

| File | Lines | Concern |
|------|------:|---------|
| `src/modals.ts` | 4,757 | **3 exported modals + 1 exported function**, massive monolith |
| `src/browser/core.ts` | 4,389 | Entire card browser in one file, 5 empty facade files re-exporting it |
| `src/settings.ts` | 2,073 | 1 exported settings tab class + 7 private modal classes mixed in |
| `src/readingView.ts` | 2,021 | 1 export, 2000 lines of rendering logic with no decomposition |
| `src/widget.ts` | 1,935 | Sidebar widget view — session logic, rendering, grading all fused |
| `src/sync.ts` | 1,741 | Sync engine + backup management + file-write logic + notice formatting |
| `src/reviewer/ReviewView.ts` | 1,672 | Top-level view orchestrating the reviewer |
| `src/imageocclusion/ImageOcclusionReviewRender.ts` | 1,576 | IO review rendering with embedded modal classes |
| `src/analytics/AnalyticsView.ts` | 1,351 | Analytics shell + tab routing |
| `src/reviewer/RenderSession.ts` | 1,237 | Session rendering (cards, answers, buttons) |
| `src/home.ts` | 1,214 | Home view — deck list, heatmap, pinned decks, all in one |
| `src/imageocclusion/ImageOcclusionEditor.ts` | 1,171 | IO editor modal |
| `src/imageocclusion/ImageOcclusionIndex.ts` | 1,169 | IO indexing + yet another `ImageOcclusionEditorModal` |
| `src/imageocclusion/ImageMaskRenderer.ts` | 1,163 | Mask rendering + yet another `ImageOcclusionEditorModal` |
| `src/imageocclusion/ImageOcclusionReview.ts` | 1,153 | IO review logic + yet another `ImageOcclusionEditorModal` |

### Key Structural Problems

1. **No naming convention** — files use a mix of `camelCase.ts`, `PascalCase.ts`, `kebab-case` patterns with no consistency.
2. **God files** — `modals.ts` (4,757 lines), `browser/core.ts` (4,389 lines), `settings.ts` (2,073 lines) do far too much.
3. **Duplicate class names** — `ImageOcclusionEditorModal` is defined in **4 separate files** (`ImageMaskRenderer.ts`, `ImageOcclusionIndex.ts`, `ImageOcclusionReview.ts`, `ImageOcclusionReviewRender.ts`).
4. **Scattered modal classes** — Modal classes live in `modals.ts`, `settings.ts`, `reviewer/CardEditor.ts`, `reviewer/Skip.ts`, `reviewer/Zoom.ts`, `imageocclusion/*` with no pattern.
5. **Empty facade files** — `browser/actions.ts`, `browser/data.ts`, `browser/filters.ts`, `browser/types.ts`, `browser/ui.ts` all just re-export `core.ts`. They're vestigial.
6. **Flat `src/` root is cluttered** — 20 files at the top level mixing views (`home.ts`, `widget.ts`), data (`store.ts`, `parser.ts`), infrastructure (`sync.ts`, `ids.ts`), and UI helpers (`ui.ts`, `cardeditor.ts`).
7. **Types scattered everywhere** — `store.ts` exports data types, domain types, analytics types, and the `JsonStore` class all in one file. `reviewer/Types.ts` has its own types. `scheduler.ts` re-exports from `store.ts`.
8. **View files have inconsistent homes** — `home.ts` and `widget.ts` are top-level, `ReviewView.ts` is in `reviewer/`, `AnalyticsView.ts` is in `analytics/`, `core.ts` (browser) is in `browser/`.

---

## Proposed Directory Structure

Every folder has a clear **single domain**. Files follow a consistent `kebab-case.ts` convention. The naming pattern tells you what a file does:

```
src/
├── main.ts                          # Plugin entry point (registration only)
├── constants.ts                     # View type IDs, brand string
│
├── types/                           # ✅ COMPLETE (Phase 1)
│   ├── card.ts                      # CardRecord, CardType, ParsedCard
│   ├── review.ts                    # ReviewResult, ReviewLogEntry, ReviewRating, GradeResult
│   ├── analytics.ts                 # AnalyticsEvent, AnalyticsReviewEvent, AnalyticsSessionEvent, etc.
│   ├── scheduler.ts                 # CardState, CardStage, SchedulerSettings
│   ├── store.ts                     # StoreData, QuarantineEntry
│   ├── settings.ts                  # BootCampSettings (type only — rename to SproutSettings in future pass)
│   └── index.ts                     # Barrel re-exports
│
├── core/                            # Plugin infrastructure (no UI)
│   ├── plugin.ts                    # BootCampPlugin class (extracted from main.ts)
│   ├── store.ts                     # JsonStore class + defaultStore()
│   ├── settings-defaults.ts         # DEFAULT_SETTINGS object
│   ├── deep-merge.ts                # deepMerge utility
│   ├── ids.ts                       # generateUniqueId
│   └── basecoat.ts                  # Basecoat API init/stop helpers (extracted from main.ts)
│
├── parser/                          # Markdown → card parsing
│   ├── parser.ts                    # parseCardsFromText (core parser)
│   ├── fence-mask.ts                # Code fence detection
│   └── prefix.ts                    # Markdown prefix stripping (lists, blockquotes)
│
├── scheduler/                       # FSRS scheduling engine
│   ├── grading.ts                   # gradeFromRating, gradeFromPassFail
│   ├── actions.ts                   # buryCard, suspendCard, unsuspendCard, resetCardScheduling
│   └── shuffle.ts                   # shuffleCardsWithinTimeWindow, shuffleCardsWithParentAwareness
│
├── sync/                            # ✅ COMPLETE (Phase 2c)
│   ├── sync-engine.ts              # syncQuestionBank, syncOneFile, formatSyncNotice + scheduling recovery helpers
│   └── backup.ts                    # listDataJsonBackups, createDataJsonBackupNow, restoreFromDataJsonBackup + shared helpers
│
├── deck/                            # Deck tree building
│   ├── deck-tree.ts                 # buildDeckTree, DeckNode, DeckCounts
│   └── scope-match.ts              # scopeMatch (moved from indexes/)
│
├── indexes/                         # Card grouping/indexing
│   ├── group-format.ts             # (renamed from groupFormat.ts)
│   └── group-index.ts              # (renamed from groupIndex.ts)
│
├── modals/                          # ✅ Phase 2a COMPLETE (core modals extracted)
│   ├── CardCreatorModal.ts          # CardCreatorModal
│   ├── ImageOcclusionCreatorModal.ts # ImageOcclusionCreatorModal
│   ├── ParseErrorModal.ts           # ParseErrorModal
│   ├── bulk-edit.ts                 # openBulkEditModalForCards
│   └── modal-utils.ts               # Shared modal utilities
│   # Note: 7 settings confirm modals are in settings/confirm-modals.ts (Phase 2b)
│   # Future: modals from reviewer/ (CardEditor, Zoom, Skip) may be extracted here in Phase 4
│
├── card-editor/                     # Inline card editing UI (shared by modals)
│   ├── card-editor.ts               # createCardEditor, createGroupPickerField (from cardeditor.ts)
│   ├── cloze-shortcuts.ts           # Cloze keyboard shortcut logic (extracted from cardeditor.ts)
│   └── fields.ts                    # buildAnswerOrOptionsFor, escapePipes (from reviewer/Fields.ts)
│
├── views/                           # Obsidian ItemView subclasses
│   ├── home/
│   │   ├── home.view.ts             # BootCampHomeView class
│   │   ├── deck-list.ts             # Deck list rendering logic
│   │   ├── pinned-decks.ts          # Pinned deck rendering
│   │   └── home-utils.ts            # formatCountdownToMidnight, formatDeckLabel, etc.
│   │
│   ├── reviewer/
│   │   ├── review.view.ts           # BootCampReviewerView class
│   │   ├── render-session.ts        # Session card rendering
│   │   ├── render-deck.ts           # Deck selection rendering
│   │   ├── session.ts               # Session state machine
│   │   ├── practice-mode.ts         # Practice mode logic
│   │   ├── study-session-header.ts  # Session header bar
│   │   ├── stats.ts                 # In-session statistics
│   │   ├── skip.ts                  # Skip logic (without modal — modal moved to modals/)
│   │   ├── more-menu.ts             # "More" dropdown menu
│   │   ├── timers.ts                # Auto-advance timers
│   │   ├── fsrs-log.ts              # FSRS log display
│   │   ├── labels.ts                # Stage labels
│   │   ├── title-markdown.ts        # Title markdown rendering
│   │   └── question/
│   │       ├── cloze.ts             # Cloze question rendering
│   │       └── mcq.ts               # MCQ question rendering
│   │
│   ├── browser/
│   │   ├── browser.view.ts          # BootCampCardBrowserView class
│   │   ├── browser-table.ts         # Table rendering (extracted from core.ts)
│   │   ├── browser-filters.ts       # Filter/search UI (extracted from core.ts)
│   │   ├── browser-actions.ts       # Bulk actions (extracted from core.ts)
│   │   └── browser-data.ts          # Data loading/sorting (extracted from core.ts)
│   │
│   ├── analytics/
│   │   ├── analytics.view.ts        # BootCampAnalyticsView class
│   │   ├── chart-filter-menu.tsx     # Shared filter menu component
│   │   ├── chart-utils.ts           # chartAxisUtils + chartLayout merged
│   │   ├── filter-styles.ts         # Filter CSS-in-JS
│   │   ├── heatmap.ts               # Heatmap core logic
│   │   └── charts/                  # One file per chart (these are well-sized already)
│   │       ├── difficulty-retrievability.chart.tsx
│   │       ├── forgetting-curve.chart.tsx
│   │       ├── future-due.chart.tsx
│   │       ├── new-cards-per-day.chart.tsx
│   │       ├── pie-charts.tsx
│   │       ├── review-calendar-heatmap.tsx
│   │       ├── stability-distribution.chart.tsx
│   │       ├── stacked-review-buttons.chart.tsx
│   │       └── study-profile.chart.tsx
│   │
│   ├── widget/                      # ✅ COMPLETE (Phase 2d)
│   │   ├── SproutWidgetView.ts      # SproutWidgetView class (renamed from BootCampWidgetView)
│   │   ├── widget-helpers.ts        # Session/UndoFrame types + card-filtering helpers
│   │   └── widget-buttons.ts        # Button/menu factory functions
│   │
│   └── reading/
│       ├── reading-view.ts          # registerReadingViewPrettyCards
│       ├── card-extraction.ts       # extractCardFromSource, field parsing
│       └── card-render.ts           # Card rendering in reading mode
│
├── image-occlusion/                 # Image occlusion feature (renamed from imageocclusion/)
│   ├── io-editor.ts                 # ImageOcclusionEditor (the ONE modal — deduplicated)
│   ├── io-review.ts                 # IO review logic
│   ├── io-review-render.ts          # IO review rendering
│   ├── io-index.ts                  # IO indexing
│   ├── io-mask-renderer.ts          # Mask rendering
│   ├── io-mask-tool.ts              # MaskTool utilities
│   ├── io-geometry.ts               # ImageGeometry
│   ├── io-transform.ts              # ImageTransform
│   ├── io-question.ts               # imageOcclusionQuestion
│   └── io-types.ts                  # ImageOcclusionTypes
│
├── settings/                        # ✅ COMPLETE (Phase 2b)
│   ├── SproutSettingsTab.ts         # SproutSettingsTab class (renamed from BootCampSettingsTab)
│   ├── confirm-modals.ts            # 7 confirmation dialog modals (extracted from settings.ts)
│   └── settings-utils.ts            # Pure utility functions + regex constants
│
├── shared/                          # Shared utilities
│   ├── ui.ts                        # el(), iconButton(), smallToggleButton()
│   ├── markdown-render.ts           # BootCampMarkdownHelper (from reviewer/MarkdownRender.ts)
│   ├── markdown-block.ts            # buildCardBlockMarkdown, findCardBlockRangeById
│   ├── aos-loader.ts                # AOS animation loader
│   └── utils.ts                     # lib/utils.ts (cn helper)
│
└── components/
    └── header.ts                    # BootCampHeader (already isolated)
```

---

## Naming Convention

| Pattern | Meaning | Example |
|---------|---------|---------|
| `*.view.ts` | Obsidian `ItemView` subclass | `home.view.ts`, `browser.view.ts` |
| `*.modal.ts` | Obsidian `Modal` subclass | `card-creator.modal.ts`, `confirm-bury.modal.ts` |
| `*.chart.tsx` | React chart component | `forgetting-curve.chart.tsx` |
| `io-*.ts` | Image occlusion domain file | `io-editor.ts`, `io-review.ts` |
| `kebab-case.ts` | Everything else | `deep-merge.ts`, `sync-engine.ts` |

**Rules:**
- All filenames are **kebab-case** (no `PascalCase.ts`, no `camelCase.ts`)
- Suffixes (`.view`, `.modal`, `.chart`) indicate the Obsidian/React class type
- Folder names match the **domain** (not the implementation detail)
- No file exceeds ~800 lines — if it does, it gets split further

### ⚠️ Naming: No "Boot Camp" References

The app is now called **Sprout**. All new or refactored code must follow these rules:

- **User-facing strings** (Notice messages, modal headings, descriptions) → use "Sprout", never "Boot Camp"
- **Class names** → prefer `Sprout*` (e.g. `SproutSettingsTab`, not `BootCampSettingsTab`)
- **Method names** → prefer `*Sprout*` (e.g. `deleteAllSproutDataFromVault`, not `deleteAllBootCampDataFromVault`)
- **Comments / JSDoc** → reference "Sprout", not "Boot Camp"
- **Known exception**: `BootCampPlugin` (defined in `main.ts`, used in 60+ files) is NOT being renamed yet — it will be addressed in a dedicated rename pass after all structural refactoring is complete
- **Known exception**: View-type class names (`BootCampReviewerView`, `BootCampCardBrowserView`, etc.) will be renamed when their respective modules are refactored

---

## Migration Plan (Phased)

### Phase 0: Preparation
- [ ] Create a full backup of `data.json` and the plugin folder
- [ ] Set up a test vault with known flashcards to verify nothing breaks after each phase
- [ ] Ensure `esbuild.config.js` supports the new paths (aliasing if needed)

### Phase 1: Types Extraction (Low Risk) ✅ COMPLETE
Extracted all shared types into `src/types/` with barrel re-export via `src/types/index.ts`.

**Files created:**
- `types/card.ts` — `CardRecord`, card-related types + `ParsedCard`, `McqOption`
- `types/review.ts` — `ReviewResult`, `ReviewLogEntry`
- `types/analytics.ts` — `AnalyticsMode`, `AnalyticsReviewEvent`, `AnalyticsSessionEvent`, `AnalyticsEvent`, `AnalyticsData`
- `types/scheduler.ts` — `CardStage`, `CardState`, `SchedulerSettings`, `ReviewRating`, `GradeResult`
- `types/store.ts` — `StoreData`, `QuarantineEntry`
- `types/settings.ts` — `BootCampSettings` (type only)
- `types/index.ts` — Barrel re-exports

**Build verified** ✅ — all consumer imports updated, no logic changes.

### Phase 2: Split the God Files (High Impact)
This is the biggest phase. Attack the largest files one at a time.

#### 2a: `modals.ts` (4,757 lines → 5 files + barrel) ✅ COMPLETE
Split into:
1. `modals/CardCreatorModal.ts` — `CardCreatorModal`
2. `modals/ImageOcclusionCreatorModal.ts` — `ImageOcclusionCreatorModal`
3. `modals/ParseErrorModal.ts` — `ParseErrorModal`
4. `modals/bulk-edit.ts` — `openBulkEditModalForCards`
5. `modals/modal-utils.ts` — Shared utilities

`src/modals.ts` is now a 21-line barrel re-exporting all public symbols. **Build verified** ✅

#### 2b: `settings.ts` (2,073 lines → 3 files + barrel) ✅ COMPLETE
Split into:
1. `settings/SproutSettingsTab.ts` — `SproutSettingsTab` class (renamed from `BootCampSettingsTab`)
2. `settings/confirm-modals.ts` — 7 confirmation dialog modals (extracted)
3. `settings/settings-utils.ts` — Pure utility functions + regex constants

**Boot Camp → Sprout rename applied**: all user-facing strings, class name, method names, comments.
`src/settings.ts` is now a barrel re-exporting `SproutSettingsTab`. `src/main.ts` updated. **Build verified** ✅

#### 2c: `sync.ts` (1,741 lines → 2 files + barrel) ✅ COMPLETE
Split into:
1. `sync/sync-engine.ts` — `syncQuestionBank`, `syncOneFile`, `formatSyncNotice` + all scheduling recovery helpers
2. `sync/backup.ts` — All backup CRUD functions + shared utility helpers

`src/sync.ts` is now a 29-line barrel re-exporting all public symbols. **Build verified** ✅

#### 2d: `widget.ts` (1,935 lines → 3 files + barrel) ✅ COMPLETE
Split into:
1. `widget/SproutWidgetView.ts` — `SproutWidgetView` class (renamed from `BootCampWidgetView`)
2. `widget/widget-helpers.ts` — `Session`, `UndoFrame` types + card-filtering helpers
3. `widget/widget-buttons.ts` — `makeIconButton`, `makeTextButton`, `applyWidgetActionButtonStyles`, `applyWidgetHoverDarken`, `attachWidgetMoreMenu`

`src/widget.ts` is now a barrel re-exporting `SproutWidgetView` (+ backward-compat alias `BootCampWidgetView`). `src/main.ts` updated. **Build verified** ✅

#### 2e: `home.ts` (1,214 lines → 2 files + barrel) ✅ COMPLETE
> ✅ Applied "no Boot Camp" naming rule — `BootCampHomeView` → `SproutHomeView`

Actual split:
```
src/home/
├── SproutHomeView.ts       # SproutHomeView class (renamed from BootCampHomeView)
└── home-helpers.ts          # Pure helpers: localDayIndex, formatTimeAgo,
                             #   scopeFromDeckPath, formatCountdownToMidnight,
                             #   formatDeckLabel, formatPinnedDeckLabel, MS_DAY
```

`src/home.ts` is now a barrel re-exporting `SproutHomeView` (+ backward-compat alias `BootCampHomeView`) and all helpers. `src/main.ts` updated. **Build verified** ✅

#### 2f: `browser/core.ts` (4,389 lines → 2 files + barrel) ✅ COMPLETE
> ✅ Applied "no Boot Camp" naming rule — `BootCampCardBrowserView` → `SproutCardBrowserView`

Actual split:
```
src/browser/
├── SproutCardBrowserView.ts  # SproutCardBrowserView class (~3,880 lines)
│                              #   (renamed from BootCampCardBrowserView)
└── browser-helpers.ts         # Types, constants, DOM utils, formatting,
                               #   IO rendering, search, card markdown building
                               #   (~490 lines)
```

Deleted 5 empty facade files: `actions.ts`, `data.ts`, `filters.ts`, `types.ts`, `ui.ts`.
Deleted original `core.ts`.
`src/browser.ts` is now a barrel re-exporting `SproutCardBrowserView` (+ backward-compat alias `BootCampCardBrowserView`). `src/main.ts` updated. **Build verified** ✅

#### 2g: `readingView.ts` (2,021 lines → 2 files + barrel) ✅ COMPLETE
Split into:
1. `reading/reading-helpers.ts` (817 lines) — All pure/stateless helpers: constants (`ANCHOR_RE`, `FIELD_START_RE`, `INVIS_RE`), types (`FieldKey`, `SproutCard`, `ParsedMarkdownElement`), text utilities (`clean`, `unescapePipeText`, `normalizeMathSignature`, `escapeHtml`, `processMarkdownFeatures`, `splitAtPipeTerminator`), text extraction (`extractLaTeXFromMathJax`, `extractRawTextFromParagraph`, `extractTextWithLaTeX`), card parsing (`extractCardFromSource`, `parseSproutCard`, `saveField`), card HTML builders (`renderMathInElement`, `buildCardContentHTML`, `buildClozeSectionHTML`, `buildMCQSectionHTML`, `buildBasicSectionHTML`, `buildIOSectionHTML`, `buildInfoSectionHTML`, `buildCollapsibleSectionHTML`), markdown parsing (`parseMarkdownToElements`, `createMarkdownElement`), content detection (`checkForNonCardContent`, `containsNonCardContent`).
2. `reading/reading-view.ts` (1,268 lines) — All stateful/side-effectful code: module-level mutable state (`sproutPluginRef`, `DEBUG`, masonry timers, MutationObserver), the sole export `registerReadingViewPrettyCards`, style injection, manual trigger setup, MutationObserver, `processCardElements`, all masonry layout functions, DOM visibility management (`hideAllMasonryGridSiblings`, `hideMasonryGridSiblings`, `hideCardSiblingElements`), `enhanceCardElement`, `renderMarkdownInElements`.
`src/readingView.ts` is now a barrel re-exporting `registerReadingViewPrettyCards` + all helpers/types. `src/main.ts` import unchanged (already points to barrel). **Build verified** ✅

### Phase 3: Deduplicate Image Occlusion (High Value) ✅ COMPLETE
> ⚠️ Apply "no Boot Camp" naming rule to all new/refactored IO files

**Investigation found:**
- `ImageOcclusionEditorModal` was defined in 4 files but only the copy in `ImageMaskRenderer.ts` was ever imported (by `CardCreatorModal.ts` and `modals.ts`).
- The copies in `ImageOcclusionIndex.ts`, `ImageOcclusionReview.ts`, and `ImageOcclusionReviewRender.ts` were dead code with broken imports.
- `ImageOcclusionReview.ts` was entirely dead (never imported by anyone).
- `imageOcclusionQuestion.ts` was also dead code (exported but never imported).
- `index.ts` barrel referenced non-existent files.
- 6 shared helper functions (`normaliseVaultPath`, `stripEmbedSyntax`, `resolveImageFile`, `isEditableTarget`, `emptyEl`, `uid`) were duplicated across all 4 files.

**Changes:**
1. **Created `io-helpers.ts`** (87 lines) — extracted shared IO helpers + `IoEditorOpenOpts` type
2. **`ImageMaskRenderer.ts`** — replaced local helper definitions with imports from `io-helpers.ts`
3. **`ImageOcclusionReviewRender.ts`** (1,577 → 432 lines) — stripped 1,145 lines of dead modal + helpers, kept only useful exports (`isIoParentCard`, `isIoRevealableType`, `renderImageOcclusionReviewInto`), added imports from `io-helpers.ts`
4. **`ImageOcclusionIndex.ts`** (1,170 → 9 lines) — replaced with re-export of `ImageOcclusionEditorModal` from `ImageMaskRenderer`
5. **Deleted `ImageOcclusionReview.ts`** (1,154 lines, entirely dead code)
6. **Deleted `imageOcclusionQuestion.ts`** (dead code, never imported)
7. **Replaced broken `index.ts`** barrel with proper re-exports of all IO module exports
**Build verified** ✅ — ~3,475 lines of dead/duplicate code removed

### Phase 4: Restructure Directories ✅ COMPLETE
> ⚠️ Apply "no Boot Camp" naming rule to all renamed/moved files

Moved files into subdirectories with barrel re-exports at original paths:
- `src/scheduler.ts` → `src/scheduler/scheduler.ts` (barrel at `src/scheduler.ts`)
- `src/cardeditor.ts` → `src/card-editor/card-editor.ts` (barrel at `src/cardeditor.ts`)
- `src/parser.ts` → `src/parser/parser.ts` (barrel at `src/parser.ts`)
- `src/store.ts` → `src/core/store.ts` (barrel at `src/store.ts`)
- `src/deckTree.ts` → `src/deck/deck-tree.ts` (barrel at `src/deckTree.ts`)
- `src/ui.ts` and `src/aos-loader.ts` left in place (49 and 53 lines — already small enough)
- Reviewer PascalCase rename deferred (cosmetic, high risk relative to value)
All relative imports updated in moved files. **Build verified** ✅

### Phase 5: Rename `BootCamp*` → `Sprout*` ✅ COMPLETE

Atomic rename of all `BootCamp*` identifiers across the entire codebase:

| Old Name | New Name | References Changed |
|----------|----------|-------------------|
| `BootCampPlugin` | `SproutPlugin` | 118 references in 28 files |
| `BootCampSettings` | `SproutSettings` | ~20 references |
| `BootCampHeader` / `BootCampHeaderPage` | `SproutHeader` / `SproutHeaderPage` | ~15 references |
| `BootCampAnalyticsView` | `SproutAnalyticsView` | ~10 references |
| `BootCampReviewerView` | `SproutReviewerView` | ~10 references |
| `BootCampMarkdownHelper` | `SproutMarkdownHelper` | ~5 references |
| `BootCampImageZoomModal` / `openBootCampImageZoom` | `SproutImageZoomModal` / `openSproutImageZoom` | ~6 references |

Total: ~199 references in 39 files renamed atomically via `sed`.
Backward-compat aliases in barrel files (`BootCampCardBrowserView`, `BootCampWidgetView`, `BootCampHomeView`) preserved.
Extracting plugin class out of main.ts deferred (main.ts is 752 lines — manageable as-is).
**Build verified** ✅

**Rename scope:** `BootCampPlugin` → `SproutPlugin` in all ~60 files that reference the type. This must be done atomically to avoid partial renames.

### Phase 6: Clean Up ✅ COMPLETE
- Deleted dead files: `ImageOcclusionReview.ts`, `imageOcclusionQuestion.ts` (Phase 3)
- Deleted 5 empty browser facade files (Phase 2f)
- Fixed broken `imageocclusion/index.ts` barrel
- No circular dependencies detected (esbuild bundling succeeds)
- `esbuild.config.js` unchanged (no changes needed)
- All 97 `.ts` files build cleanly
- Barrel files at original paths maintain backward-compatible imports

---

## Summary of Wins

| Metric | Before | After |
|--------|--------|-------|
| Largest file | 4,757 lines (`modals.ts`) | ~3,900 lines (`SproutCardBrowserView.ts`) |
| Duplicate `ImageOcclusionEditorModal` | 4 definitions | 1 (3 dead copies removed) |
| Dead code removed | — | ~3,475 lines (IO duplicates) |
| `BootCamp*` naming | ~200 references | 0 (all renamed to `Sprout*`) |
| Files with barrels | 0 | 8 (backward-compat) |
| Total .ts files | ~75 | 97 (better decomposition) |
| Modules with subdirectories | 4 | 13 |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking Obsidian workspace state | Keep `VIEW_TYPE_*` constants unchanged in `constants.ts` |
| Breaking `data.json` | No schema changes — this is purely a code structure refactor |
| Missing imports after moves | Use TypeScript compiler (`tsc --noEmit`) after each phase to catch errors |
| Regressions in card rendering | Test each view (Home, Reviewer, Browser, Analytics, Widget, Reading View) after each phase |
| Large PR / hard to review | Phase each change as a separate commit (or PR if using branches) |
