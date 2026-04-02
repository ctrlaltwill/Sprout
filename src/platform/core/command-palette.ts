/**
 * @file src/platform/core/command-palette.ts
 *
 * NOTE: This feature is planned for a future release and is NOT ready for
 * testing yet. The header trigger button is currently disabled.
 *
 * @summary Raycast-style command palette for LearnKit. Provides a layered
 * intent → entity → action flow. Top-level commands include Study, Review,
 * Review Due Now, Open View, Sync Now, Anki Import/Export, Resume Last Session,
 * and pinned decks.
 *
 * Renders as a popover beneath a header trigger button using the shared
 * body-portal pattern.
 *
 * @exports
 *   - LearnKitCommandPalette
 */

import { App, setIcon, type WorkspaceLeaf } from "obsidian";
import { createBodyPortalPopover, type BodyPortalPopoverHandle } from "./popover";
import type LearnKitPlugin from "../../main";
import type { Scope } from "../../views/reviewer/types";
import { log } from "./logger";

// ─── Types ──────────────────────────────────────────────────────────

type PaletteMode = "root" | "scope-search";

/** A top-level command shown in the root list. */
interface PaletteCommand {
  id: string;
  label: string;
  icon: string;
  group: string;
  /** If true, selecting this command transitions to scope-search mode. */
  needsScope?: boolean;
  /** Direct action when no scope selection is needed. */
  onActivate?: () => void;
}

type PaletteDeps = {
  app: App;
  leaf: WorkspaceLeaf;
  plugin: LearnKitPlugin;
  trigger: HTMLElement;
  navigate: (page: string) => Promise<void>;
  runSync: () => void;
};

// ─── Helpers ────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return true;
  return h.includes(n);
}

function iconForScopeType(type: string): string {
  if (type === "vault") return "database";
  if (type === "folder") return "folder";
  if (type === "note") return "sticky-note";
  if (type === "tag") return "tag";
  if (type === "property") return "braces";
  if (type === "group") return "layers";
  return "dot";
}

// ─── Class ──────────────────────────────────────────────────────────

export class LearnKitCommandPalette {
  private deps: PaletteDeps;
  private popover: BodyPortalPopoverHandle | null = null;

  constructor(deps: PaletteDeps) {
    this.deps = deps;
  }

  toggle(): void {
    if (this.popover?.isOpen()) {
      this.popover.close();
    } else {
      this.open();
    }
  }

  open(): void {
    this.popover?.close();
    this.popover = createBodyPortalPopover({
      trigger: this.deps.trigger,
      align: "left",
      setWidth: false,
      overlayClasses: ["learnkit-cmd-palette-overlay"],
      panelClasses: [
        "learnkit-cmd-palette",
        "rounded-lg",
        "border",
        "border-border",
        "bg-popover",
        "text-popover-foreground",
        "shadow-lg",
        "learnkit-pointer-auto",
      ],
      escapeKey: true,
      observeViewport: true,
      buildContent: (panel, close) => this.buildPalette(panel, close),
      onOpened: (panel) => {
        const input = panel.querySelector<HTMLInputElement>(".learnkit-cmd-input");
        input?.focus();
      },
      onClosed: () => {
        this.popover = null;
      },
    });
    this.popover.open();
  }

  close(): void {
    this.popover?.close();
  }

  dispose(): void {
    this.popover?.close();
    this.popover = null;
  }

  // ── Build ──

  private buildPalette(panel: HTMLElement, close: () => void): void {
    panel.style.width = "320px";
    panel.style.maxHeight = "420px";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.overflow = "hidden";

    let mode: PaletteMode = "root";
    let pendingCommandId: string | null = null;
    let query = "";
    let activeIndex = 0;

    // ── Input ──
    const inputWrap = document.createElement("div");
    inputWrap.className = "flex items-center gap-2 border-b border-border px-3";

    const searchIcon = document.createElement("span");
    searchIcon.className = "inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground shrink-0";
    searchIcon.setAttribute("aria-hidden", "true");
    setIcon(searchIcon, "search");
    inputWrap.appendChild(searchIcon);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "learnkit-cmd-input flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none border-none py-2.5 h-10";
    input.placeholder = "Type a command…";
    input.setAttribute("aria-label", "Command palette search");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    inputWrap.appendChild(input);

    panel.appendChild(inputWrap);

    // ── List ──
    const listWrap = document.createElement("div");
    listWrap.className = "learnkit-cmd-list overflow-y-auto flex-1 p-1";
    listWrap.setAttribute("role", "listbox");
    panel.appendChild(listWrap);

    // ── Empty ──
    const emptyEl = document.createElement("div");
    emptyEl.className = "learnkit-cmd-empty py-6 text-center text-sm text-muted-foreground hidden";
    emptyEl.textContent = "No results found.";
    panel.appendChild(emptyEl);

    // ── Data ──

    const commands = this.getCommands(close);
    const pinnedDecks = this.getPinnedDecks();

    // ── Render ──

    const render = () => {
      listWrap.innerHTML = "";
      emptyEl.classList.add("hidden");

      if (mode === "root") {
        renderRoot();
      } else if (mode === "scope-search") {
        renderScopeSearch();
      }
    };

    const renderRoot = () => {
      const q = query.trim();
      const matchingCommands = q
        ? commands.filter((c) => fuzzyMatch(c.label, q) || fuzzyMatch(c.group, q))
        : commands;

      const matchingPinned = q
        ? pinnedDecks.filter((d) => fuzzyMatch(d.name, q))
        : pinnedDecks;

      const totalItems: Array<{ type: "command"; cmd: PaletteCommand } | { type: "pinned"; scope: Scope }> = [];

      // Pinned decks section
      if (matchingPinned.length > 0) {
        for (const scope of matchingPinned) {
          totalItems.push({ type: "pinned", scope });
        }
      }

      // Command groups
      for (const cmd of matchingCommands) {
        totalItems.push({ type: "command", cmd });
      }

      if (!totalItems.length) {
        emptyEl.classList.remove("hidden");
        activeIndex = -1;
        return;
      }

      if (activeIndex >= totalItems.length) activeIndex = totalItems.length - 1;
      if (activeIndex < 0) activeIndex = 0;

      // Group rendering
      let lastGroup = "";

      // Pinned group
      if (matchingPinned.length > 0) {
        const heading = document.createElement("div");
        heading.className = "learnkit-cmd-group-heading px-2 py-1.5 text-xs font-medium text-muted-foreground";
        heading.textContent = "Pinned Decks";
        heading.setAttribute("role", "presentation");
        listWrap.appendChild(heading);
      }

      let itemIdx = 0;
      for (const entry of totalItems) {
        if (entry.type === "command") {
          const group = entry.cmd.group;
          if (group !== lastGroup) {
            if (itemIdx > 0) {
              const sep = document.createElement("div");
              sep.className = "my-1 h-px bg-border";
              sep.setAttribute("role", "separator");
              listWrap.appendChild(sep);
            }
            const heading = document.createElement("div");
            heading.className = "learnkit-cmd-group-heading px-2 py-1.5 text-xs font-medium text-muted-foreground";
            heading.textContent = group;
            heading.setAttribute("role", "presentation");
            listWrap.appendChild(heading);
            lastGroup = group;
          }
        }

        const idx = itemIdx;
        const item = document.createElement("div");
        item.className = "learnkit-cmd-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", idx === activeIndex ? "true" : "false");

        if (idx === activeIndex) item.classList.add("is-active");

        const ic = document.createElement("span");
        ic.className = "inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground";
        ic.setAttribute("aria-hidden", "true");

        if (entry.type === "pinned") {
          setIcon(ic, iconForScopeType(entry.scope.type));
          item.appendChild(ic);
          const txt = document.createElement("span");
          txt.className = "truncate";
          txt.textContent = entry.scope.name;
          item.appendChild(txt);

          const badge = document.createElement("span");
          badge.className = "ml-auto text-xs text-muted-foreground";
          badge.textContent = "Study";
          item.appendChild(badge);

          const scope = entry.scope;
          item.addEventListener("click", () => {
            close();
            this.studyScope(scope);
          });
        } else {
          const cmd = entry.cmd;
          setIcon(ic, cmd.icon);
          item.appendChild(ic);
          const txt = document.createElement("span");
          txt.className = "truncate";
          txt.textContent = cmd.label;
          item.appendChild(txt);

          if (cmd.needsScope) {
            const chevron = document.createElement("span");
            chevron.className = "ml-auto inline-flex items-center justify-center [&_svg]:size-3 text-muted-foreground";
            chevron.setAttribute("aria-hidden", "true");
            setIcon(chevron, "chevron-right");
            item.appendChild(chevron);
          }

          item.addEventListener("click", () => {
            if (cmd.needsScope) {
              pendingCommandId = cmd.id;
              mode = "scope-search";
              query = "";
              input.value = "";
              input.placeholder = "Search scopes…";
              activeIndex = 0;
              render();
              input.focus();
            } else {
              cmd.onActivate?.();
            }
          });
        }

        item.addEventListener("mouseenter", () => {
          const prev = listWrap.querySelector(".learnkit-cmd-item.is-active");
          if (prev) {
            prev.classList.remove("is-active");
            prev.setAttribute("aria-selected", "false");
          }
          activeIndex = idx;
          item.classList.add("is-active");
          item.setAttribute("aria-selected", "true");
        });

        listWrap.appendChild(item);
        itemIdx++;
      }
    };

    const getAllScopes = (): Scope[] => {
      try {
        const store = (this.deps.plugin as unknown as { store?: { getScopeOptions?(): Scope[] } }).store;
        if (store && typeof store.getScopeOptions === "function") {
          return store.getScopeOptions();
        }
      } catch (e) {
        log.swallow("command-palette: getScopeOptions", e);
      }

      // Fallback: build from vault folder structure
      const scopes: Scope[] = [];
      const vault = this.deps.app.vault;

      // Vault scope
      scopes.push({ type: "vault", key: "/", name: "Entire vault" });

      // Folders
      const seen = new Set<string>();
      vault.getAllLoadedFiles().forEach((f) => {
        if ("children" in f && !seen.has(f.path)) {
          seen.add(f.path);
          scopes.push({ type: "folder", key: f.path, name: f.path });
        }
      });

      return scopes;
    };

    const renderScopeSearch = () => {
      const q = query.trim();
      const allScopes = getAllScopes();
      const filtered = q
        ? allScopes.filter((s) => fuzzyMatch(s.name, q) || fuzzyMatch(s.key, q))
        : allScopes;

      // Back hint
      const backItem = document.createElement("div");
      backItem.className = "learnkit-cmd-item learnkit-cmd-back group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer select-none outline-none text-muted-foreground";
      backItem.setAttribute("role", "option");
      const backIcon = document.createElement("span");
      backIcon.className = "inline-flex items-center justify-center [&_svg]:size-3";
      backIcon.setAttribute("aria-hidden", "true");
      setIcon(backIcon, "arrow-left");
      backItem.appendChild(backIcon);
      const backTxt = document.createElement("span");
      backTxt.textContent = "Back to commands";
      backItem.appendChild(backTxt);
      backItem.addEventListener("click", () => {
        mode = "root";
        pendingCommandId = null;
        query = "";
        input.value = "";
        input.placeholder = "Type a command…";
        activeIndex = 0;
        render();
        input.focus();
      });
      listWrap.appendChild(backItem);

      if (!filtered.length) {
        emptyEl.textContent = q ? "No matching scopes." : "No scopes available.";
        emptyEl.classList.remove("hidden");
        activeIndex = -1;
        return;
      }

      emptyEl.classList.add("hidden");
      if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
      if (activeIndex < 0) activeIndex = 0;

      for (let idx = 0; idx < Math.min(filtered.length, 100); idx++) {
        const scope = filtered[idx];
        const item = document.createElement("div");
        item.className = "learnkit-cmd-item group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", idx === activeIndex ? "true" : "false");
        if (idx === activeIndex) item.classList.add("is-active");

        const ic = document.createElement("span");
        ic.className = "inline-flex items-center justify-center [&_svg]:size-4 text-muted-foreground";
        ic.setAttribute("aria-hidden", "true");
        setIcon(ic, iconForScopeType(scope.type));
        item.appendChild(ic);

        const txt = document.createElement("span");
        txt.className = "truncate";
        txt.textContent = scope.name;
        item.appendChild(txt);

        const typeBadge = document.createElement("span");
        typeBadge.className = "ml-auto text-xs text-muted-foreground capitalize";
        typeBadge.textContent = scope.type;
        item.appendChild(typeBadge);

        item.addEventListener("mouseenter", () => {
          const prev = listWrap.querySelector(".learnkit-cmd-item.is-active");
          if (prev) {
            prev.classList.remove("is-active");
            prev.setAttribute("aria-selected", "false");
          }
          activeIndex = idx;
          item.classList.add("is-active");
          item.setAttribute("aria-selected", "true");
        });

        item.addEventListener("click", () => {
          close();
          if (pendingCommandId === "study") {
            this.studyScope(scope);
          } else if (pendingCommandId === "review") {
            this.reviewScope(scope);
          }
        });

        listWrap.appendChild(item);
      }
    };

    // ── Input events ──

    input.addEventListener("input", () => {
      query = input.value;
      activeIndex = 0;
      render();
    });

    input.addEventListener("keydown", (ev) => {
      const items = listWrap.querySelectorAll<HTMLElement>(".learnkit-cmd-item:not(.learnkit-cmd-back)");
      const max = items.length;

      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (max) {
          activeIndex = (activeIndex + 1) % max;
          render();
        }
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (max) {
          activeIndex = (activeIndex - 1 + max) % max;
          render();
        }
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        const activeEl = listWrap.querySelector<HTMLElement>(".learnkit-cmd-item.is-active:not(.learnkit-cmd-back)");
        activeEl?.click();
        return;
      }
      if (ev.key === "Backspace" && !input.value && mode === "scope-search") {
        ev.preventDefault();
        mode = "root";
        pendingCommandId = null;
        input.placeholder = "Type a command…";
        activeIndex = 0;
        render();
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (mode === "scope-search") {
          mode = "root";
          pendingCommandId = null;
          query = "";
          input.value = "";
          input.placeholder = "Type a command…";
          activeIndex = 0;
          render();
          input.focus();
        } else {
          close();
        }
        return;
      }
    });

    // Initial render
    render();
  }

  // ── Commands ──

  private getCommands(close: () => void): PaletteCommand[] {
    const cmds: PaletteCommand[] = [];

    // Resume Last Session
    cmds.push({
      id: "resume-session",
      label: "Resume Last Session",
      icon: "play",
      group: "Quick Actions",
      onActivate: () => {
        close();
        this.resumeLastSession();
      },
    });

    // Study (needs scope)
    cmds.push({
      id: "study",
      label: "Study",
      icon: "star",
      group: "Study",
      needsScope: true,
    });

    // Review (needs scope)
    cmds.push({
      id: "review",
      label: "Review Notes",
      icon: "notebook-text",
      group: "Study",
      needsScope: true,
    });

    // Review Due Now
    cmds.push({
      id: "review-due",
      label: "Review Due Now",
      icon: "clock",
      group: "Study",
      onActivate: () => {
        close();
        this.reviewDueNow();
      },
    });

    // Open View
    const views: Array<{ label: string; page: string; icon: string }> = [
      { label: "Coach", page: "coach", icon: "target" },
      { label: "Flashcards", page: "cards", icon: "star" },
      { label: "Notes", page: "notes", icon: "notebook-text" },
      { label: "Tests", page: "exam", icon: "clipboard-check" },
      { label: "Analytics", page: "analytics", icon: "chart-spline" },
      { label: "Library", page: "library", icon: "table-2" },
      { label: "Settings", page: "settings", icon: "settings" },
    ];

    for (const v of views) {
      cmds.push({
        id: `view-${v.page}`,
        label: `Open ${v.label}`,
        icon: v.icon,
        group: "Views",
        onActivate: () => {
          close();
          void this.deps.navigate(v.page);
        },
      });
    }

    // Sync Now
    cmds.push({
      id: "sync",
      label: "Sync Now",
      icon: "refresh-cw",
      group: "Actions",
      onActivate: () => {
        close();
        this.deps.runSync();
      },
    });

    // Anki
    cmds.push({
      id: "anki-import",
      label: "Import from Anki",
      icon: "folder-down",
      group: "Anki",
      onActivate: () => {
        close();
        this.deps.app.commands?.executeCommandById?.("sprout:import-anki");
      },
    });

    cmds.push({
      id: "anki-export",
      label: "Export to Anki",
      icon: "folder-up",
      group: "Anki",
      onActivate: () => {
        close();
        this.deps.app.commands?.executeCommandById?.("sprout:export-anki");
      },
    });

    return cmds;
  }

  private getPinnedDecks(): Scope[] {
    try {
      const pins: string[] = this.deps.plugin?.settings?.general?.pinnedDecks ?? [];
      return pins
        .filter((p) => typeof p === "string" && p.trim())
        .map((path) => ({
          type: "folder" as const,
          key: path,
          name: path,
        }));
    } catch (e) {
      log.swallow("command-palette: getPinnedDecks", e);
      return [];
    }
  }

  // ── Actions ──

  private studyScope(scope: Scope): void {
    const leaf = this.deps.leaf;
    leaf.setViewState({ type: "learnkit-reviewer", active: true }).then(() => {
      this.deps.app.workspace.revealLeaf(leaf);
      const view = leaf.view as { setScope?: (s: Scope) => void } | undefined;
      if (view && typeof view.setScope === "function") {
        view.setScope(scope);
      }
    });
  }

  private reviewScope(scope: Scope): void {
    const leaf = this.deps.leaf;
    leaf.setViewState({ type: "learnkit-note-review", active: true }).then(() => {
      this.deps.app.workspace.revealLeaf(leaf);
      const view = leaf.view as {
        setCoachScope?: (s: Scope | null) => void;
        setReturnToCoach?: (enabled: boolean) => void;
      } | undefined;
      if (view) {
        view.setReturnToCoach?.(false);
        view.setCoachScope?.(scope);
      }
    });
  }

  private reviewDueNow(): void {
    const leaf = this.deps.leaf;
    leaf.setViewState({ type: "learnkit-reviewer", active: true }).then(() => {
      this.deps.app.workspace.revealLeaf(leaf);
    });
  }

  private resumeLastSession(): void {
    // Open the reviewer — it will auto-resume the last scope if available
    const leaf = this.deps.leaf;
    leaf.setViewState({ type: "learnkit-reviewer", active: true }).then(() => {
      this.deps.app.workspace.revealLeaf(leaf);
    });
  }
}
