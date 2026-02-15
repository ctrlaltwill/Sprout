/**
 * @file src/settings/confirm-modals.ts
 * @summary Confirmation-dialog modals used exclusively by SproutSettingsTab. Contains seven Modal subclasses for destructive or irreversible settings actions: scheduling reset, analytics reset, card deletion, defaults restoration, backup comparison, backup restoration, and backup deletion.
 *
 * @exports
 *  - ConfirmResetSchedulingModal     — modal confirming a wipe of all card scheduling data (reset to New)
 *  - ConfirmResetAnalyticsModal      — modal confirming clearance of review history and heatmap data
 *  - ConfirmDeleteAllFlashcardsModal — modal confirming removal of every card from notes and the DB
 *  - ConfirmResetDefaultsModal       — modal confirming restoration of plugin settings to factory defaults
 *  - BackupCompareModal              — read-only modal showing a diff of the current DB vs. a backup snapshot
 *  - CurrentDbSnapshot               — type describing the shape of a current-DB snapshot for comparison
 *  - ConfirmRestoreBackupModal       — modal confirming overwrite of the DB from a chosen backup file
 *  - ConfirmDeleteBackupModal        — modal confirming permanent deletion of a backup file on disk
 */

import { type App, Modal, Notice, Setting } from "obsidian";
import type SproutPlugin from "../main";
import { log } from "../core/logger";
import type { DataJsonBackupStats } from "../sync/backup";
import { restoreFromDataJsonBackup } from "../sync/backup";
import { scopeModalToWorkspace } from "../modals/modal-utils";

type ConfirmButtonKind = "default" | "danger";

function styleConfirmActionButton(button: HTMLButtonElement, kind: ConfirmButtonKind = "default") {
  button.type = "button";
  button.classList.add("bc", "btn-outline", "inline-flex", "items-center", "gap-2", "h-9", "px-3", "text-sm", "sprout-settings-action-btn");
  if (kind === "danger") button.classList.add("sprout-btn-danger");
}

// ────────────────────────────────────────────
// 1) ConfirmResetSchedulingModal
// ────────────────────────────────────────────

/**
 * Prompts the user to confirm resetting all card scheduling data.
 * On confirm, calls `plugin.resetAllCardScheduling()` which sets every
 * card back to "New" and clears FSRS scheduling fields.
 */
export class ConfirmResetSchedulingModal extends Modal {
  plugin: SproutPlugin;

  constructor(app: App, plugin: SproutPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.containerEl.addClass("sprout-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Reset scheduling?").setHeading();
    contentEl.createEl("p", {
      text: "All cards will be reset to new. This can be restored from a backup.",
    });

    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row");

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: "Reset" });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllCardScheduling();
        new Notice("Scheduling reset for all cards");
      } catch (e) {
        log.error(e);
        new Notice("Sprout: failed to reset scheduling (see console).");
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
  plugin: SproutPlugin;

  constructor(app: App, plugin: SproutPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.containerEl.addClass("sprout-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Reset analytics?").setHeading();
    contentEl.createEl("p", {
      text: "All review history and statistics will be cleared. Scheduling is preserved. This can be restored from a backup.",
    });

    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row");

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: "Reset" });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllAnalyticsData();
        new Notice("Analytics data cleared");
      } catch (e) {
        log.error(e);
        new Notice("Sprout: failed to reset analytics (see console).");
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
 * callback so the caller (SproutSettingsTab) can orchestrate vault-wide
 * deletion and store clearing.
 */
export class ConfirmDeleteAllFlashcardsModal extends Modal {
  plugin: SproutPlugin;
  onConfirm: () => Promise<void>;

  constructor(app: App, plugin: SproutPlugin, onConfirm: () => Promise<void>) {
    super(app);
    this.plugin = plugin;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.containerEl.addClass("sprout-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Delete all flashcards?").setHeading();

    contentEl.createEl("p", {
      text: "All flashcards will be permanently removed from your notes and database. Restore is only possible from a vault backup.",
    });

    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row");

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const deleteBtn = row.createEl("button", { text: "Delete all" });
    styleConfirmActionButton(deleteBtn, "danger");
    deleteBtn.onclick = async () => {
      this.close();
      try {
        await this.onConfirm();
      } catch (e) {
        log.error(e);
        new Notice("Sprout: failed to delete flashcards (see console).");
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
  onConfirm: () => Promise<void>;

  constructor(app: App, onConfirm: () => Promise<void>) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.containerEl.addClass("sprout-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Reset settings?").setHeading();
    contentEl.createEl("p", {
      text: "All settings will be restored to defaults. Cards and scheduling are not affected.",
    });

    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row");

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: "Reset" });
    styleConfirmActionButton(resetBtn, "danger");
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.onConfirm();
      } catch (e) {
        log.error(e);
        new Notice("Sprout: failed to reset settings (see console).");
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
  current: CurrentDbSnapshot;
  backup: DataJsonBackupStats;

  constructor(app: App, backup: DataJsonBackupStats, current: CurrentDbSnapshot) {
    super(app);
    this.backup = backup;
    this.current = current;
  }

  /** Format a signed delta string (e.g. "+3" or "−2"). */
  private fmtDelta(n: number): string {
    if (n === 0) return "0";
    return n > 0 ? `+${n}` : String(n);
  }

  onOpen() {
    scopeModalToWorkspace(this);
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Backup comparison").setHeading();

    contentEl.createEl("p", {
      text: `File: ${this.backup.name}`,
    });

    /* ── comparison table ── */
    const box = contentEl.createDiv();
    box.classList.add("sprout-confirm-box");

    const tbl = box.createEl("table");
    tbl.classList.add("sprout-compare-table");

    const header = tbl.createEl("tr");
    ["Metric", "Current", "Backup", "Δ"].forEach((h) => {
      const th = header.createEl("th", { text: h });
      th.classList.add("sprout-compare-th");
    });

    const addRow = (label: string, cur: number, bak: number) => {
      const tr = tbl.createEl("tr");
      const td1 = tr.createEl("td", { text: label });
      const td2 = tr.createEl("td", { text: String(cur) });
      const td3 = tr.createEl("td", { text: String(bak) });
      const td4 = tr.createEl("td", { text: this.fmtDelta(bak - cur) });
      [td1, td2, td3, td4].forEach((td) => {
        td.classList.add("sprout-compare-td");
      });
    };

    addRow("Cards", this.current.cards, this.backup.cards);
    addRow("States", this.current.states, this.backup.states);
    addRow("Review log", this.current.reviewLog, this.backup.reviewLog);
    addRow("Quarantine", this.current.quarantine, this.backup.quarantine);
    addRow("Io map entries", this.current.io, this.backup.io);

    /* ── metadata ── */
    const meta = contentEl.createDiv();
    meta.classList.add("sprout-confirm-meta");
    meta.createDiv({
      text: `Modified: ${this.backup.mtime ? new Date(this.backup.mtime).toLocaleString() : "—"}`,
    });
    meta.createDiv({
      text: `Size: ${this.backup.size ? `${Math.round(this.backup.size / 1024)} KB` : "—"}`,
    });

    const note = contentEl.createEl("p", {
      text: "Restoring will overwrite the current database scheduling by card anchor. It will not affect question wording or Markdown.",
    });
    note.classList.add("sprout-confirm-muted");

    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row-lg");

    const closeBtn = row.createEl("button", { text: "Close" });
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
  plugin: SproutPlugin;
  backup: DataJsonBackupStats;
  current: CurrentDbSnapshot;
  onRestored: () => void;

  constructor(
    app: App,
    plugin: SproutPlugin,
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
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Restore from backup?").setHeading();

    contentEl.createEl("p", {
      text: `This will restore scheduling data from: ${this.backup.name}`,
    });

    /* ── change summary ── */
    const summary = contentEl.createDiv();
    summary.classList.add("sprout-confirm-summary");

    const add = (label: string, cur: number, bak: number) => {
      summary.createDiv({
        text: `${label}: current ${cur} → backup ${bak} (Δ ${this.fmtDelta(bak - cur)})`,
      });
    };

    add("States", this.current.states, this.backup.states);
    add("Review log", this.current.reviewLog, this.backup.reviewLog);
    add("Analytics events", this.current.analyticsEvents ?? 0, this.backup.analyticsEvents ?? 0);
    const hint = contentEl.createDiv({ cls: "sprout-confirm-hint" });
    hint.createDiv({
      cls: "sprout-confirm-hint-title",
      text: "Note",
    });
    hint.createDiv({
      cls: "sprout-confirm-hint-body",
      text: `Card content (${this.current.cards} cards) is unchanged. Restore does not edit markdown notes; it only restores scheduling and analytics data.`,
    });

    /* ── safety-backup checkbox ── */
    let makeSafetyBackup = true;

    const checkRow = contentEl.createDiv();
    checkRow.classList.add("sprout-confirm-check-row");

    const cb = checkRow.createEl("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.onchange = () => {
      makeSafetyBackup = !!cb.checked;
    };

    checkRow.createEl("label", { text: "Create a safety backup before restoring" });

    /* ── action buttons ── */
    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row-lg");

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const restoreBtn = row.createEl("button", { text: "Restore backup" });
    styleConfirmActionButton(restoreBtn, "danger");

    restoreBtn.onclick = async () => {
      restoreBtn.setAttr("disabled", "true");
      try {
        const res = await restoreFromDataJsonBackup(this.plugin, this.backup.path, { makeSafetyBackup });
        if (!res.ok) {
          new Notice(`Sprout: ${res.message}`);
          restoreBtn.removeAttribute("disabled");
          return;
        }
        new Notice("Scheduling data restored from backup");
        this.close();
        this.onRestored();
      } catch (e) {
        log.error(e);
        new Notice("Sprout: restore failed (see console).");
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
  plugin: SproutPlugin;
  backup: DataJsonBackupStats;
  onDone?: () => void;

  constructor(app: App, plugin: SproutPlugin, backup: DataJsonBackupStats, onDone?: () => void) {
    super(app);
    this.plugin = plugin;
    this.backup = backup;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Delete backup?").setHeading();
    contentEl.createEl("p", { text: `This will permanently delete: ${this.backup.name}` });

    const row = contentEl.createDiv();
    row.classList.add("sprout-confirm-row");

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    styleConfirmActionButton(cancelBtn, "default");
    cancelBtn.onclick = () => this.close();

    const deleteBtn = row.createEl("button", { text: "Delete backup" });
    styleConfirmActionButton(deleteBtn, "danger");
    deleteBtn.onclick = async () => {
      this.close();
      try {
        const adapter = this.app.vault?.adapter;
        if (!adapter) {
          new Notice("Sprout: cannot delete backup (no adapter).");
          return;
        }
        if (typeof adapter.trash === "function") await adapter.trash(this.backup.path);
        else if (typeof adapter.remove === "function") await adapter.remove(this.backup.path);
        else {
          new Notice("Sprout: cannot delete backup (adapter does not support delete).");
          return;
        }
        new Notice("Scheduling data backup deleted");
        this.onDone?.();
      } catch (e) {
        log.error(e);
        new Notice("Sprout: failed to delete backup (see console).");
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
