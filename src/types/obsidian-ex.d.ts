// src/types/obsidian-ex.d.ts
// ---------------------------------------------------------------------------
// Ambient augmentations for Obsidian's *internal* (undocumented) APIs that
// the plugin relies on. Keeps the rest of the codebase free of `as any`.
//
// Only add members you actually use — this is NOT a full mirror of Obsidian
// internals.  When upstream typings gain a member, remove it from here.
// ---------------------------------------------------------------------------

import "obsidian";

declare module "obsidian" {
  interface App {
    /** Internal settings panel. */
    setting: {
      /** Open the settings modal. */
      open(): void;
      /** Open a specific settings tab by plugin ID. */
      openTabById(id: string): void;
      /** Older alias for openTabById (pre-1.0). */
      openTab(id: string): void;
    };

    /** Internal command palette registry. */
    commands: {
      /** Execute a registered command by its full ID. */
      executeCommandById(id: string): boolean;
      /** All registered commands, keyed by command ID. */
      commands: Record<string, Command>;
    };
  }

  interface MarkdownView {
    /** Returns the current editing mode: `"source"` or `"preview"`. */
    getMode(): "source" | "preview";

    /** The reading/preview pane (Live Preview or rendered Markdown). */
    previewMode: {
      /** Re-render the preview content. */
      rerender(): void;
      /** Reload the file into the preview pane. */
      onLoadFile(file: TFile): void;
    };
  }
}
