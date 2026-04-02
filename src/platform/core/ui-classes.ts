/**
 * @file src/platform/core/ui-classes.ts
 * @summary Module for ui classes.
 *
 * @exports
 *  - SPROUT_TITLE_TEXT_CLASS
 *  - SPROUT_TITLE_STRIP_LABEL_CLASS
 *  - SPROUT_HOME_CONTENT_SHELL_CLASS
 */

/* ============================================================================
   Shared UI class tokens for TS renderers.
   Keeps utility-first class usage consistent across views.
   ========================================================================== */

export const SPROUT_TITLE_TEXT_CLASS = "text-xl font-semibold tracking-tight";

export const SPROUT_TITLE_STRIP_LABEL_CLASS =
  `learnkit-view-title-strip-label ${SPROUT_TITLE_TEXT_CLASS}`;

export const SPROUT_HOME_CONTENT_SHELL_CLASS =
  "learnkit-view-content-shell lk-home-content-shell";
