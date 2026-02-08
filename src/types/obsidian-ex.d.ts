/**
 * @file src/types/obsidian-ex.d.ts
 * @summary Ambient module augmentations for Obsidian's undocumented internal APIs that
 * Sprout relies on (App.setting, App.commands, Vault.adapter, MenuItem.setSubmenu,
 * WorkspaceLeaf.setViewState, MarkdownView.getMode, etc.).
 * Also declares global window augmentations for Basecoat, MathJax, and the Sprout
 * debug log handle. Only members actually used by the plugin are typed here.
 *
 * @exports None — ambient declarations only (module augmentation)
 */

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

    /** Internal plugin manager. */
    plugins: {
      plugins: Record<string, unknown>;
    };
  }

  interface Vault {
    /** Low-level filesystem adapter (NodeJS or mobile). */
    adapter: DataAdapter;
    /** Write binary data to an existing file. */
    modifyBinary?(file: TFile, data: ArrayBuffer): Promise<void>;
    /** Create a new file with binary content. */
    createBinary?(path: string, data: ArrayBuffer): Promise<TFile>;
    /** Read a file as an ArrayBuffer. */
    readBinary?(file: TFile): Promise<ArrayBuffer>;
  }

  interface DataAdapter {
    /** Read a file as text (UTF-8). */
    read(normalizedPath: string): Promise<string>;
    /** Write text to a file. */
    write(normalizedPath: string, data: string): Promise<void>;
    /** Check if a path exists. */
    exists(normalizedPath: string): Promise<boolean>;
    /** Create a directory (recursive). */
    mkdir(normalizedPath: string): Promise<void>;
    /** Remove a file or empty directory. */
    remove(normalizedPath: string): Promise<void>;
    /** Rename/move a path. */
    rename(normalizedPath: string, newPath: string): Promise<void>;
    /** List files and folders in a directory. */
    list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
    /** Get file modification time (epoch ms). Returns 0 if not found. */
    stat(normalizedPath: string): Promise<{ mtime: number; size: number } | null>;
    /** Base path of the vault on disk. */
    basePath?: string;
    /** Read a file as an ArrayBuffer. */
    readBinary?(normalizedPath: string): Promise<ArrayBuffer>;
    /** Write binary data to a file. */
    writeBinary?(normalizedPath: string, data: ArrayBuffer): Promise<void>;
  }

  interface MenuItem {
    /** Add a submenu to this item. Returns the submenu Menu instance. */
    setSubmenu(): Menu;
    /** The DOM element for this menu item. */
    dom: HTMLElement;
  }

  interface Menu {
    /** The DOM element for this menu. */
    dom: HTMLElement;
  }

  interface Workspace {
    /** Internal event trigger for file-open, etc. */
    trigger(name: string, ...data: unknown[]): void;

    /** Internal: move a leaf to a different group/position. */
    moveLeaf(leaf: WorkspaceLeaf, group: unknown, index?: number): void;

    /** Internal: get the tab group that contains the leaf. */
    getGroup(leaf: WorkspaceLeaf): { index: number; [key: string]: unknown } | null;
  }

  interface WorkspaceLeaf {
    /** Internal: change the leaf's view state programmatically. */
    setViewState(state: { type: string; active?: boolean; state?: unknown }): Promise<void>;
  }

  interface DataAdapter {
    /** Move a file to the system trash (Electron only). */
    trash?(normalizedPath: string): Promise<void>;
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

  interface MarkdownPostProcessorContext {
    /** Internal: the container element the post-processor runs within. */
    containerEl?: HTMLElement;
  }

  interface View {
    /** Internal: set the tab title (not in public typings for ItemView). */
    setTitle?(title: string): void;
  }
}

// ---------------------------------------------------------------------------
// Global window augmentations for Obsidian environment
// ---------------------------------------------------------------------------
import type { App } from "obsidian";

interface BasecoatApi {
  start?(): void;
  [key: string]: unknown;
}

interface SproutGlobals {
  /** Obsidian app instance, available globally at runtime. */
  app?: App;
  /** Basecoat UI framework (optional). */
  basecoat?: BasecoatApi;
  /** MathJax renderer (optional). */
  MathJax?: { typeset?(elements: Element[]): void; [key: string]: unknown };
  /** Masonry grid helper injected by reading view. */
  sproutApplyMasonryGrid?: () => void;
  /** Sprout widget view reference. */
  SproutWidgetView?: unknown;
  /** Sprout boot flag. */
  __sprout_started?: boolean;
}

declare global {
  interface Window extends SproutGlobals {
    /** Sprout debug globals merged via declaration merging. */
    readonly __sproutGlobals?: true;
  }

  /** Sprout debug log handle, attached at init. */
   
  var __sproutLog: unknown;

  /** structuredClone polyfill awareness — present in modern runtimes. */
  function structuredClone<T>(value: T): T;
}

