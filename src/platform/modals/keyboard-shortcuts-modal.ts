/**
 * @file src/platform/modals/keyboard-shortcuts-modal.ts
 * @summary Modal that displays keyboard shortcuts for Sprout study sessions
 * (reviewer and sidebar widget). Opened from the header shortcuts button.
 *
 * @exports
 *  - KeyboardShortcutsModal — Obsidian Modal subclass
 *  - SHORTCUT_GROUPS        — structured shortcut data for tooltip reuse
 */

import { Modal, setIcon, type App } from "obsidian";
import { scopeModalToWorkspace, setModalTitle } from "./modal-utils";
import { setCssProps } from "../core/ui";
import type LearnKitPlugin from "../../main";
import { t } from "../translations/translator";

/* ------------------------------------------------------------------ */
/*  Shortcut data                                                      */
/* ------------------------------------------------------------------ */

export type ShortcutEntry = {
  keys: string[];
  label: string;
};

export type ShortcutGroup = {
  title: string;
  shortcuts: ShortcutEntry[];
};

export function getShortcutGroups(
  locale: string | undefined,
): ShortcutGroup[] {
  const tx = (token: string, fallback: string) =>
    t(locale, token, fallback);

  return [
    {
      title: tx("ui.shortcuts.group.navigation", "Navigation"),
      shortcuts: [
        { keys: ["Enter", "Space", "→"], label: tx("ui.shortcuts.revealOrNext", "Reveal or next") },
        { keys: ["←"], label: tx("ui.shortcuts.hideAnswer", "Back to question") },
        { keys: ["Q"], label: tx("ui.shortcuts.quit", "End session") },
        { keys: ["T"], label: tx("ui.shortcuts.openStudyView", "Switch to full study page") },
        { keys: ["1–4"], label: tx("ui.shortcuts.selectOrGrade", "Select or grade") },
      ],
    },
    {
      title: tx("ui.shortcuts.group.actions", "Actions"),
      shortcuts: [
        { keys: ["E"], label: tx("ui.shortcuts.editCard", "Edit card") },
        { keys: ["B"], label: tx("ui.shortcuts.buryCard", "Bury card") },
        { keys: ["S"], label: tx("ui.shortcuts.suspendCard", "Suspend card") },
        { keys: ["U"], label: tx("ui.shortcuts.undo", "Undo last review") },
        { keys: ["M"], label: tx("ui.shortcuts.moreMenu", "More actions") },
        { keys: ["O"], label: tx("ui.shortcuts.openInNote", "Jump to note") },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

export class KeyboardShortcutsModal extends Modal {
  private readonly plugin: LearnKitPlugin;

  constructor(app: App, plugin: LearnKitPlugin) {
    super(app);
    this.plugin = plugin;
  }

  override onOpen(): void {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const tx = (token: string, fallback: string) =>
      t(locale, token, fallback);

    // ── Modal chrome (matches bulk-edit pattern) ──────────────────────────
    setModalTitle(this, tx("ui.shortcuts.title", "Keyboard Shortcuts"));
    this.containerEl.addClass("lk-modal-container", "lk-modal-dim", "learnkit");
    setCssProps(this.containerEl, "z-index", "2147483000");
    this.modalEl.addClass("lk-modals", "learnkit-bulk-edit-panel", "learnkit-shortcuts-modal");
    setCssProps(this.modalEl, "z-index", "2147483001");
    scopeModalToWorkspace(this);
    this.contentEl.addClass("learnkit-bulk-edit-content");

    // Escape key closes modal
    this.scope.register([], "Escape", () => { this.close(); return false; });

    const { contentEl } = this;
    contentEl.empty();

    // ── Custom close button in header ─────────────────────────────────────
    const headerEl = this.modalEl.querySelector<HTMLElement>(":scope > .modal-header");
    const defaultClose = this.modalEl.querySelector<HTMLElement>(":scope > .modal-close-button");
    if (defaultClose) defaultClose.remove();

    if (headerEl) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "learnkit-btn-toolbar learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2 learnkit-scope-clear-btn learnkit-card-creator-close-btn learnkit-bulk-edit-close-btn";
      close.setAttribute("aria-label", t(this.plugin.settings?.general?.interfaceLanguage, "ui.common.close", "Close"));
      close.setAttribute("data-tooltip-position", "top");

      const closeIcon = document.createElement("span");
      closeIcon.className = "inline-flex items-center justify-center";
      setIcon(closeIcon, "x");

      close.appendChild(closeIcon);
      close.addEventListener("click", () => this.close());
      headerEl.appendChild(close);
      if (headerEl.parentElement !== this.modalEl) {
        this.modalEl.insertBefore(headerEl, contentEl);
      }
    }

    // ── Two-column shortcut tables (GitHub-style) ───────────────────────
    const groups = getShortcutGroups(locale);

    // Split into two columns: Study (Navigation + Grading + MCQ) | Actions
    const studyGroups = groups.filter((g) => g.title !== tx("ui.shortcuts.group.actions", "Actions"));
    const actionGroup = groups.find((g) => g.title === tx("ui.shortcuts.group.actions", "Actions"));

    const columns = contentEl.createDiv({
      cls: "learnkit-shortcuts-columns",
    });

    // ── Helper: build a table for one column ──────────────────────────────
    const buildColumn = (
      heading: string,
      sections: ShortcutGroup[],
      host: HTMLElement,
    ) => {
      const col = host.createDiv({ cls: "learnkit-shortcuts-col" });
      col.createDiv({
        text: heading,
        cls: "font-semibold lk-home-section-title mb-2",
      });

      const wrap = col.createDiv({
        cls: "text-sm learnkit-analytics-table-wrap",
      });
      const table = wrap.createEl("table", {
        cls: "table w-full text-sm learnkit-changelog-table",
      });
      const thead = table.createEl("thead");
      const headRow = thead.createEl("tr", {
        cls: "text-left border-b border-border",
      });
      headRow.createEl("th", {
        text: tx("ui.shortcuts.colKey", "Key"),
        cls: "font-medium learnkit-changelog-cell",
      });
      headRow.createEl("th", {
        text: tx("ui.shortcuts.colAction", "Action"),
        cls: "font-medium learnkit-changelog-cell",
      });

      const tbody = table.createEl("tbody");

      for (const section of sections) {
        for (const shortcut of section.shortcuts) {
          const row = tbody.createEl("tr", {
            cls: "align-top border-b border-border/50 last:border-0",
          });

          const keyCell = row.createEl("td", {
            cls: "learnkit-changelog-cell whitespace-nowrap",
          });
          const keysWrap = keyCell.createDiv({ cls: "flex items-center gap-1" });
          for (const key of shortcut.keys) {
            const kbd = keysWrap.createEl("kbd", {
              text: key,
              cls: "learnkit-kbd learnkit-kbd-sm",
            });
            kbd.setAttribute("aria-label", key);
          }

          row.createEl("td", {
            text: shortcut.label,
            cls: "learnkit-changelog-cell",
          });
        }
      }
    };

    buildColumn(
      tx("ui.shortcuts.colStudy", "Study"),
      studyGroups,
      columns,
    );

    if (actionGroup) {
      buildColumn(
        tx("ui.shortcuts.colActions", "Actions"),
        [actionGroup],
        columns,
      );
    }

    // ── Footer (appended to modalEl, matching bulk-edit pattern) ──────────
    const footer = document.createElement("div");
    footer.className = "flex items-center justify-end gap-4 lk-modal-footer learnkit-card-creator-footer";

    const closeFooterBtn = document.createElement("button");
    closeFooterBtn.type = "button";
    closeFooterBtn.className = "learnkit-btn-toolbar learnkit-btn-filter h-7 px-3 text-sm inline-flex items-center gap-2";
    closeFooterBtn.textContent = tx("ui.shortcuts.close", "Close");
    closeFooterBtn.addEventListener("click", () => this.close());
    footer.appendChild(closeFooterBtn);

    this.modalEl.appendChild(footer);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
