/**
 * @file src/settings/confirm-modals.ts
 * @summary Confirmation-dialog modals used exclusively by LearnKitSettingsTab. Contains Modal subclasses for destructive or irreversible settings actions: card scheduling reset, note scheduling reset, analytics reset, card deletion, defaults restoration, backup comparison, backup restoration, and backup deletion.
 *
 * @exports
 *  - ConfirmResetSchedulingModal     — modal confirming a wipe of all card scheduling data (reset to New)
 *  - ConfirmResetNoteSchedulingModal — modal confirming a wipe of all note scheduling data (reset notes.db states)
 *  - ConfirmResetAnalyticsModal      — modal confirming clearance of review history and heatmap data
 *  - ConfirmDeleteAllFlashcardsModal — modal confirming removal of every card from notes and the DB
 *  - ConfirmResetDefaultsModal       — modal confirming restoration of plugin settings to factory defaults
 *  - BackupCompareModal              — read-only modal showing a diff of the current DB vs. a backup snapshot
 *  - CurrentDbSnapshot               — type describing the shape of a current-DB snapshot for comparison
 *  - ConfirmRestoreBackupModal       — modal confirming overwrite of the DB from a chosen backup file
 *  - ConfirmDeleteBackupModal        — modal confirming permanent deletion of a backup file on disk
 */

import { type App, Modal, Notice, Setting } from "obsidian";
import type LearnKitPlugin from "../../main";
import { log } from "../../platform/core/logger";
import type { DataJsonBackupStats } from "../../platform/integrations/sync/backup";
import { restoreFromDataJsonBackup, deleteDataJsonBackup } from "../../platform/integrations/sync/backup";
import { scopeModalToWorkspace } from "../../platform/modals/modal-utils";
import { t } from "../../platform/translations/translator";
import { txCommon } from "../../platform/translations/ui-common";

type ConfirmButtonKind = "default" | "danger";

function tx(locale: unknown, token: string, fallback: string, vars?: Record<string, string | number>): string {
  return t(locale, token, fallback, vars);
}

function styleConfirmActionButton(button: HTMLButtonElement, kind: ConfirmButtonKind = "default") {
  button.type = "button";
  button.classList.add("inline-flex", "items-center", "gap-2", "h-9", "px-3", "text-sm", "learnkit-settings-action-btn", "learnkit-settings-action-btn");
  if (kind === "danger") button.classList.add("learnkit-btn-danger", "learnkit-btn-danger");
}

function initConfirmModal(modal: Modal, title: string): HTMLElement {
  scopeModalToWorkspace(modal);
  modal.containerEl.addClass("learnkit-confirm-modal");
  modal.titleEl.setText(title);
  modal.contentEl.empty();
  modal.contentEl.addClass("learnkit-confirm-modal-content");
  return modal.contentEl;
}

// ────────────────────────────────────────────
// 1) ConfirmResetSchedulingModal
// ────────────────────────────────────────────

/**
 * Prompts the user to confirm resetting all card scheduling data.
 * On confirm, calls `plugin.resetAllCardScheduling()` which sets every
 * card back to "New", clears FSRS scheduling fields, and clears note-review
 * scheduling state.
 */
export class ConfirmResetSchedulingModal extends Modal {
  plugin: LearnKitPlugin;

  constructor(app: App, plugin: LearnKitPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const contentEl = initConfirmModal(this, tx(locale, "ui.settings.modals.confirmResetScheduling", "Reset scheduling?"));
    contentEl.createEl("p", {
      cls: "learnkit-confirm-modal-copy learnkit-confirm-modal-copy",
      text: tx(locale, "ui.settings.modals.resetScheduling.body", "All card and note scheduling states will be reset. This can be restored from a backup."),
    });

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row", "learnkit-confirm-row");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: tx(locale, "ui.common.reset", "Reset") });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllCardScheduling();
        new Notice(tx(locale, "ui.settings.modals.resetScheduling.success", "LearnKit – scheduling reset for all cards and notes"));
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.resetScheduling.error", "LearnKit – failed to reset scheduling"));
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Prompts the user to confirm resetting all note scheduling data.
 * On confirm, calls `plugin.resetAllNoteScheduling()` which clears the
 * note-review scheduling state table (notes.db).
 */
export class ConfirmResetNoteSchedulingModal extends Modal {
  plugin: LearnKitPlugin;

  constructor(app: App, plugin: LearnKitPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const contentEl = initConfirmModal(this, tx(locale, "ui.settings.modals.confirmResetNoteScheduling", "Reset note scheduling?"));
    contentEl.createEl("p", {
      cls: "learnkit-confirm-modal-copy learnkit-confirm-modal-copy",
      text: tx(locale, "ui.settings.modals.resetNoteScheduling.body", "All note scheduling states will be cleared. This can be restored from a backup."),
    });

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row", "learnkit-confirm-row");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: tx(locale, "ui.common.reset", "Reset") });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllNoteScheduling();
        new Notice(tx(locale, "ui.settings.modals.resetNoteScheduling.success", "LearnKit – scheduling reset for all notes"));
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.resetNoteScheduling.error", "LearnKit – failed to reset note scheduling"));
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ────────────────────────────────────────────
// 2) ConfirmResetAnalyticsModal
// ────────────────────────────────────────────

/**
 * Confirms clearing all analytics / review-history data.
 * Scheduling (due dates, intervals) is preserved — only the review log,
 * heatmaps, and statistics are wiped.
 */
export class ConfirmResetAnalyticsModal extends Modal {
  plugin: LearnKitPlugin;

  constructor(app: App, plugin: LearnKitPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const contentEl = initConfirmModal(this, tx(locale, "ui.settings.modals.confirmResetAnalytics", "Reset analytics?"));
    contentEl.createEl("p", {
      cls: "learnkit-confirm-modal-copy learnkit-confirm-modal-copy",
      text: tx(locale, "ui.settings.modals.resetAnalytics.body", "All review history and statistics will be cleared. Scheduling is preserved. This can be restored from a backup."),
    });

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row", "learnkit-confirm-row");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: tx(locale, "ui.common.reset", "Reset") });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllAnalyticsData();
        new Notice(tx(locale, "ui.settings.modals.resetAnalytics.success", "LearnKit – analytics data cleared"));
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.resetAnalytics.error", "LearnKit – failed to reset analytics"));
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ────────────────────────────────────────────
// 3) ConfirmDeleteAllFlashcardsModal
// ────────────────────────────────────────────

/**
 * Destructive action: deletes every Sprout flashcard from every markdown
 * note in the vault and clears the plugin database.  Accepts an `onConfirm`
 * callback so the caller (LearnKitSettingsTab) can orchestrate vault-wide
 * deletion and store clearing.
 */
export class ConfirmDeleteAllFlashcardsModal extends Modal {
  plugin: LearnKitPlugin;
  onConfirm: () => Promise<void>;

  constructor(app: App, plugin: LearnKitPlugin, onConfirm: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const contentEl = initConfirmModal(this, tx(locale, "ui.settings.modals.confirmDeleteAllFlashcards", "Delete all flashcards?"));

    contentEl.createEl("p", {
      cls: "learnkit-confirm-modal-copy learnkit-confirm-modal-copy",
      text: tx(locale, "ui.settings.modals.deleteAllFlashcards.body", "All flashcards will be permanently removed from your notes and database. Restore is only possible from a vault backup."),
    });

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row", "learnkit-confirm-row");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const deleteBtn = row.createEl("button", { text: tx(locale, "ui.common.deleteAll", "Delete all") });
    styleConfirmActionButton(deleteBtn, "danger");
    deleteBtn.onclick = async () => {
      this.close();
      try {
        await this.onConfirm();
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.deleteAllFlashcards.error", "LearnKit – failed to delete flashcards"));
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ────────────────────────────────────────────
// 4) ConfirmResetDefaultsModal
// ────────────────────────────────────────────

/**
 * Confirms resetting all plugin settings back to their factory defaults.
 * Card data and scheduling are not affected — only settings like daily
 * limits, toggles, folder paths, etc.
 */
export class ConfirmResetDefaultsModal extends Modal {
  plugin: LearnKitPlugin;
  onConfirm: () => Promise<void>;

  constructor(app: App, plugin: LearnKitPlugin, onConfirm: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const contentEl = initConfirmModal(this, tx(locale, "ui.settings.modals.confirmResetSettings", "Reset settings?"));
    contentEl.createEl("p", {
      cls: "learnkit-confirm-modal-copy learnkit-confirm-modal-copy",
      text: tx(locale, "ui.settings.modals.resetSettings.body", "All settings will be restored to defaults. Cards and scheduling are not affected."),
    });

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row", "learnkit-confirm-row");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: tx(locale, "ui.common.reset", "Reset") });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.onConfirm();
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.resetSettings.error", "LearnKit – failed to reset settings"));
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ────────────────────────────────────────────
// 5) BackupCompareModal
// ────────────────────────────────────────────

/** Compact type for the live DB stats passed into comparison modals. */
export type CurrentDbSnapshot = {
  cards: number;
  states: number;
  reviewLog: number;
  quarantine: number;
  io: number;
  analyticsEvents?: number;
};

/**
 * Read-only modal that shows a side-by-side comparison table of the
 * current database versus a selected backup file.  Used when the user
 * clicks a backup row's "compare" action.
 */
export class BackupCompareModal extends Modal {
  locale: unknown;
  current: CurrentDbSnapshot;
  backup: DataJsonBackupStats;

  constructor(app: App, backup: DataJsonBackupStats, current: CurrentDbSnapshot, locale?: unknown) {
    super(app);
    this.backup = backup;
    this.current = current;
    this.locale = locale;
  }

  /** Format a signed delta string (e.g. "+3" or "−2"). */
  private fmtDelta(n: number): string {
    if (n === 0) return "0";
    return n > 0 ? `+${n}` : String(n);
  }

  onOpen() {
    const common = txCommon(this.locale);
    scopeModalToWorkspace(this);
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName(tx(this.locale, "ui.settings.modals.backupComparison", "Backup comparison")).setHeading();

    contentEl.createEl("p", {
      text: tx(this.locale, "ui.settings.modals.backupComparison.file", "File: {name}", { name: this.backup.name }),
    });

    /* ── comparison table ── */
    const box = contentEl.createDiv();
    box.classList.add("learnkit-confirm-box", "learnkit-confirm-box");

    const tbl = box.createEl("table");
    tbl.classList.add("learnkit-compare-table", "learnkit-compare-table");

    const header = tbl.createEl("tr");
    [
      tx(this.locale, "ui.settings.modals.backupComparison.table.metric", "Metric"),
      tx(this.locale, "ui.settings.modals.backupComparison.table.current", "Current"),
      tx(this.locale, "ui.settings.modals.backupComparison.table.backup", "Backup"),
      tx(this.locale, "ui.settings.modals.backupComparison.table.delta", "Δ"),
    ].forEach((h) => {
      const th = header.createEl("th", { text: h });
      th.classList.add("learnkit-compare-th", "learnkit-compare-th");
    });

    const addRow = (label: string, cur: number, bak: number) => {
      const tr = tbl.createEl("tr");
      const td1 = tr.createEl("td", { text: label });
      const td2 = tr.createEl("td", { text: String(cur) });
      const td3 = tr.createEl("td", { text: String(bak) });
      const td4 = tr.createEl("td", { text: this.fmtDelta(bak - cur) });
      [td1, td2, td3, td4].forEach((td) => {
        td.classList.add("learnkit-compare-td", "learnkit-compare-td");
      });
    };

    addRow(tx(this.locale, "ui.settings.modals.backupComparison.row.cards", "Flashcards"), this.current.cards, this.backup.cards);
    addRow(tx(this.locale, "ui.settings.modals.backupComparison.row.states", "States"), this.current.states, this.backup.states);
    addRow(tx(this.locale, "ui.settings.modals.backupComparison.row.reviewLog", "Review log"), this.current.reviewLog, this.backup.reviewLog);
    addRow(tx(this.locale, "ui.settings.modals.backupComparison.row.quarantine", "Quarantine"), this.current.quarantine, this.backup.quarantine);
    addRow(tx(this.locale, "ui.settings.modals.backupComparison.row.ioMap", "Io map entries"), this.current.io, this.backup.io);

    /* ── metadata ── */
    const meta = contentEl.createDiv();
    meta.classList.add("learnkit-confirm-meta", "learnkit-confirm-meta");
    meta.createDiv({
      text: tx(this.locale, "ui.settings.modals.backupComparison.meta.modified", "Modified: {value}", {
        value: this.backup.mtime ? new Date(this.backup.mtime).toLocaleString() : "—",
      }),
    });
    meta.createDiv({
      text: tx(this.locale, "ui.settings.modals.backupComparison.meta.size", "Size: {value}", {
        value: this.backup.size ? `${Math.round(this.backup.size / 1024)} KB` : "—",
      }),
    });

    const note = contentEl.createEl("p", {
      text: tx(this.locale, "ui.settings.modals.backupComparison.note", "Restoring will overwrite the current database scheduling by card anchor. It will not affect question wording or Markdown."),
    });
    note.classList.add("learnkit-confirm-muted", "learnkit-confirm-muted");

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row-lg", "learnkit-confirm-row-lg");

    const closeBtn = row.createEl("button", { text: common.close });
    styleConfirmActionButton(closeBtn, "default");
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ────────────────────────────────────────────
// 6) ConfirmRestoreBackupModal
// ────────────────────────────────────────────

/**
 * Confirms restoring the Sprout database from a backup file.
 * Shows a summary of what will change (cards, states, review log, etc.)
 * and optionally creates a safety backup before proceeding.
 */
export class ConfirmRestoreBackupModal extends Modal {
  plugin: LearnKitPlugin;
  backup: DataJsonBackupStats;
  current: CurrentDbSnapshot;
  onRestored: () => void;

  constructor(
    app: App,
    plugin: LearnKitPlugin,
    backup: DataJsonBackupStats,
    current: CurrentDbSnapshot,
    onRestored: () => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.backup = backup;
    this.current = current;
    this.onRestored = onRestored;
  }

  /** Format a signed delta string (e.g. "+3" or "−2"). */
  private fmtDelta(n: number): string {
    if (n === 0) return "0";
    return n > 0 ? `+${n}` : String(n);
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName(tx(locale, "ui.settings.modals.confirmRestoreBackup", "Restore from backup?")).setHeading();

    contentEl.createEl("p", {
      text: tx(locale, "ui.settings.modals.restoreBackup.body", "This will restore scheduling data from: {name}", { name: this.backup.name }),
    });

    /* ── change summary ── */
    const summary = contentEl.createDiv();
    summary.classList.add("learnkit-confirm-summary", "learnkit-confirm-summary");

    const add = (label: string, cur: number, bak: number) => {
      summary.createDiv({
        text: tx(locale, "ui.settings.modals.restoreBackup.summary", "{label}: current {current} {arrow} backup {backup} ({delta_symbol} {delta})", {
          label,
          current: cur,
          arrow: "\u2192",
          backup: bak,
          delta_symbol: "\u0394",
          delta: this.fmtDelta(bak - cur),
        }),
      });
    };

    add(tx(locale, "ui.settings.modals.restoreBackup.row.states", "States"), this.current.states, this.backup.states);
    add(tx(locale, "ui.settings.modals.restoreBackup.row.reviewLog", "Review log"), this.current.reviewLog, this.backup.reviewLog);
    add(tx(locale, "ui.settings.modals.restoreBackup.row.analytics", "Analytics events"), this.current.analyticsEvents ?? 0, this.backup.analyticsEvents ?? 0);
    const hint = contentEl.createDiv({ cls: "learnkit-confirm-hint learnkit-confirm-hint" });
    hint.createDiv({
      cls: "learnkit-confirm-hint-title learnkit-confirm-hint-title",
      text: tx(locale, "ui.settings.modals.restoreBackup.noteTitle", "Note"),
    });
    hint.createDiv({
      cls: "learnkit-confirm-hint-body learnkit-confirm-hint-body",
      text: tx(locale, "ui.settings.modals.restoreBackup.noteBody", "Card content ({count} cards) is unchanged. Restore does not edit markdown notes; it only restores scheduling and analytics data.", {
        count: this.current.cards,
      }),
    });

    /* ── safety-backup checkbox ── */
    let makeSafetyBackup = true;

    const checkRow = contentEl.createDiv();
    checkRow.classList.add("learnkit-confirm-check-row", "learnkit-confirm-check-row");

    const cb = checkRow.createEl("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.onchange = () => {
      makeSafetyBackup = !!cb.checked;
    };

    checkRow.createEl("label", { text: tx(locale, "ui.settings.modals.restoreBackup.safety", "Create a safety backup before restoring") });

    /* ── action buttons ── */
    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row-lg", "learnkit-confirm-row-lg");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const restoreBtn = row.createEl("button", { text: tx(locale, "ui.settings.modals.restoreBackup.cta", "Restore backup") });
    styleConfirmActionButton(restoreBtn, "danger");

    restoreBtn.onclick = async () => {
      restoreBtn.setAttr("disabled", "true");
      try {
        const res = await restoreFromDataJsonBackup(this.plugin, this.backup.path, { makeSafetyBackup });
        if (!res.ok) {
          new Notice(tx(locale, "ui.settings.modals.restoreBackup.errorMessage", "LearnKit – {message}", { message: res.message }));
          restoreBtn.removeAttribute("disabled");
          return;
        }
        new Notice(tx(locale, "ui.settings.modals.restoreBackup.success", "LearnKit – scheduling data restored from backup"));
        this.close();
        this.onRestored();
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.restoreBackup.error", "LearnKit – restore failed"));
        restoreBtn.removeAttribute("disabled");
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ────────────────────────────────────────────
// 7) ConfirmDeleteBackupModal
// ────────────────────────────────────────────

/**
 * Confirms permanent deletion of a single backup file from disk.
 * Uses the vault adapter's `trash()` or `remove()` method.
 */
export class ConfirmDeleteBackupModal extends Modal {
  plugin: LearnKitPlugin;
  backup: DataJsonBackupStats;
  onDone?: () => void;

  constructor(app: App, plugin: LearnKitPlugin, backup: DataJsonBackupStats, onDone?: () => void) {
    super(app);
    this.plugin = plugin;
    this.backup = backup;
    this.onDone = onDone;
  }

  onOpen() {
    const locale = this.plugin.settings?.general?.interfaceLanguage;
    const common = txCommon(locale);
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName(tx(locale, "ui.settings.modals.confirmDeleteBackup", "Delete backup?")).setHeading();
    contentEl.createEl("p", { text: tx(locale, "ui.settings.modals.deleteBackup.body", "This will permanently delete: {name}", { name: this.backup.name }) });

    const row = contentEl.createDiv();
    row.classList.add("learnkit-confirm-row", "learnkit-confirm-row");

    const cancelBtn = row.createEl("button", { text: common.cancel });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const deleteBtn = row.createEl("button", { text: tx(locale, "ui.settings.modals.deleteBackup.cta", "Delete backup") });
    styleConfirmActionButton(deleteBtn, "danger");
    deleteBtn.onclick = async () => {
      this.close();
      try {
        const ok = await deleteDataJsonBackup(this.plugin, this.backup.path);
        if (!ok) {
          new Notice(tx(locale, "ui.settings.modals.deleteBackup.unavailable", "LearnKit – cannot delete backup"));
          return;
        }
        new Notice(tx(locale, "ui.settings.modals.deleteBackup.success", "LearnKit – scheduling data backup deleted"));
        this.onDone?.();
      } catch (e) {
        log.error(e);
        new Notice(tx(locale, "ui.settings.modals.deleteBackup.error", "LearnKit – failed to delete backup"));
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
