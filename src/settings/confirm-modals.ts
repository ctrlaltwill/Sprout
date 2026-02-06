/**
 * src/settings/confirm-modals.ts
 * ──────────────────────────────
 * Confirmation-dialog modals used exclusively by `SproutSettingsTab`.
 *
 * Seven modals live here, all extending Obsidian's `Modal`:
 *  1. ConfirmResetSchedulingModal  – wipes card scheduling (sets all to New)
 *  2. ConfirmResetAnalyticsModal   – clears review history / heatmap data
 *  3. ConfirmDeleteAllFlashcardsModal – removes every card from notes + DB
 *  4. ConfirmResetDefaultsModal    – restores plugin settings to factory defaults
 *  5. BackupCompareModal           – read-only diff of current DB vs. a backup
 *  6. ConfirmRestoreBackupModal    – overwrites DB from a chosen backup file
 *  7. ConfirmDeleteBackupModal     – permanently deletes a backup file on disk
 */

import { App, Modal, Notice } from "obsidian";
import type SproutPlugin from "../main";
import type { DataJsonBackupStats } from "../sync/backup";
import { restoreFromDataJsonBackup } from "../sync/backup";

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
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Reset scheduling for all cards?" });
    contentEl.createEl("p", {
      text: "This resets all cards to New and clears scheduling fields. This cannot be undone. Consider creating a backup first.",
    });

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "12px";

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: "Reset scheduling (no undo)" });
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllCardScheduling();
        new Notice("Sprout – Settings Updated\nScheduling reset for all cards");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
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
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Reset all analytics data?" });
    contentEl.createEl("p", {
      text: "This clears all review history, heatmaps, statistics, and analytics events. Scheduling data (due dates, intervals) will be preserved. This cannot be undone. Consider creating a backup first.",
    });

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "12px";

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: "Reset analytics (no undo)" });
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.plugin.resetAllAnalyticsData();
        new Notice("Sprout – Settings Updated\nAnalytics data cleared");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
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
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Delete ALL Sprout flashcards in this vault?" });

    const p = contentEl.createEl("p");
    p.setText(
      [
        "This will permanently delete Sprout flashcards from your notes and database.",
        "",
        "It removes all Q/MCQ/CQ blocks (and their T/A/O/I lines), removes all ^sprout-######### anchors, and clears Sprout data.",
        "",
        "This cannot be undone.",
      ].join("\n"),
    );

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "12px";

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const deleteBtn = row.createEl("button", { text: "Delete all flashcards" });
    deleteBtn.style.background = "var(--background-modifier-error)";
    deleteBtn.style.color = "var(--text-on-accent)";
    deleteBtn.onclick = async () => {
      this.close();
      try {
        await this.onConfirm();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
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
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Reset Sprout settings to defaults?" });
    contentEl.createEl("p", {
      text: "This resets Sprout settings back to their defaults. It does not delete cards or change scheduling. This cannot be undone.",
    });

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "12px";

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const resetBtn = row.createEl("button", { text: "Reset settings" });
    resetBtn.style.background = "var(--background-modifier-error)";
    resetBtn.style.color = "var(--text-on-accent)";
    resetBtn.onclick = async () => {
      this.close();
      try {
        await this.onConfirm();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
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
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Backup comparison" });

    contentEl.createEl("p", {
      text: `File: ${this.backup.name}`,
    });

    /* ── comparison table ── */
    const box = contentEl.createDiv();
    box.style.marginTop = "10px";

    const tbl = box.createEl("table");
    tbl.style.width = "100%";
    tbl.style.borderCollapse = "collapse";

    const header = tbl.createEl("tr");
    ["Metric", "Current", "Backup", "Δ"].forEach((h) => {
      const th = header.createEl("th", { text: h });
      th.style.textAlign = "left";
      th.style.padding = "6px 8px";
      th.style.borderBottom = "1px solid var(--background-modifier-border)";
      th.style.fontWeight = "600";
    });

    const addRow = (label: string, cur: number, bak: number) => {
      const tr = tbl.createEl("tr");
      const td1 = tr.createEl("td", { text: label });
      const td2 = tr.createEl("td", { text: String(cur) });
      const td3 = tr.createEl("td", { text: String(bak) });
      const td4 = tr.createEl("td", { text: this.fmtDelta(bak - cur) });
      [td1, td2, td3, td4].forEach((td) => {
        td.style.padding = "6px 8px";
        td.style.borderBottom = "1px solid var(--background-modifier-border)";
      });
    };

    addRow("Cards", this.current.cards, this.backup.cards);
    addRow("States", this.current.states, this.backup.states);
    addRow("Review log", this.current.reviewLog, this.backup.reviewLog);
    addRow("Quarantine", this.current.quarantine, this.backup.quarantine);
    addRow("IO map entries", this.current.io, this.backup.io);

    /* ── metadata ── */
    const meta = contentEl.createDiv();
    meta.style.marginTop = "10px";
    meta.createDiv({
      text: `Modified: ${this.backup.mtime ? new Date(this.backup.mtime).toLocaleString() : "—"}`,
    });
    meta.createDiv({
      text: `Size: ${this.backup.size ? `${Math.round(this.backup.size / 1024)} KB` : "—"}`,
    });

    const note = contentEl.createEl("p", {
      text: "Restore will overwrite the current Sprout database in-memory and persist it. It does not edit your markdown notes; run a sync afterward if you want to reconcile notes and DB.",
    });
    note.style.marginTop = "10px";
    note.style.color = "var(--text-muted)";

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "14px";

    const closeBtn = row.createEl("button", { text: "Close" });
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

    contentEl.createEl("h3", { text: "Restore from backup?" });

    contentEl.createEl("p", {
      text: `This will overwrite your current Sprout database with: ${this.backup.name}`,
    });

    /* ── change summary ── */
    const summary = contentEl.createDiv();
    summary.style.marginTop = "10px";
    summary.style.padding = "10px";
    summary.style.border = "1px solid var(--background-modifier-border)";
    summary.style.borderRadius = "8px";

    const add = (label: string, cur: number, bak: number) => {
      summary.createDiv({
        text: `${label}: current ${cur} → backup ${bak} (Δ ${this.fmtDelta(bak - cur)})`,
      });
    };

    add("Cards", this.current.cards, this.backup.cards);
    add("States", this.current.states, this.backup.states);
    add("Review log", this.current.reviewLog, this.backup.reviewLog);
    add("Quarantine", this.current.quarantine, this.backup.quarantine);

    const warning = contentEl.createEl("p", {
      text: "Note: restore does not edit markdown notes. After restoring, you can run Sync to reconcile notes and database.",
    });
    warning.style.marginTop = "10px";
    warning.style.color = "var(--text-muted)";

    /* ── safety-backup checkbox ── */
    let makeSafetyBackup = true;

    const checkRow = contentEl.createDiv();
    checkRow.style.display = "flex";
    checkRow.style.alignItems = "center";
    checkRow.style.gap = "8px";
    checkRow.style.marginTop = "10px";

    const cb = checkRow.createEl("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.onchange = () => {
      makeSafetyBackup = !!cb.checked;
    };

    checkRow.createEl("label", { text: "Create a safety backup before restoring" });

    /* ── action buttons ── */
    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "14px";

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const restoreBtn = row.createEl("button", { text: "Restore backup" });
    restoreBtn.style.background = "var(--background-modifier-error)";
    restoreBtn.style.color = "var(--text-on-accent)";

    restoreBtn.onclick = async () => {
      restoreBtn.setAttr("disabled", "true");
      try {
        const res = await restoreFromDataJsonBackup(this.plugin, this.backup.path, { makeSafetyBackup });
        if (!res.ok) {
          new Notice(`Sprout: ${res.message}`);
          restoreBtn.removeAttr("disabled");
          return;
        }
        new Notice("Sprout – Settings Updated\nBackup restored");
        this.close();
        this.onRestored();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        new Notice("Sprout: restore failed (see console).");
        restoreBtn.removeAttr("disabled");
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

    contentEl.createEl("h3", { text: "Delete backup?" });
    contentEl.createEl("p", { text: `This will permanently delete: ${this.backup.name}` });

    const row = contentEl.createDiv();
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "12px";

    const cancelBtn = row.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    const deleteBtn = row.createEl("button", { text: "Delete backup" });
    deleteBtn.style.background = "var(--background-modifier-error)";
    deleteBtn.style.color = "var(--text-on-accent)";
    deleteBtn.onclick = async () => {
      this.close();
      try {
        const adapter: any = (this.app.vault as any)?.adapter;
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
        new Notice("Sprout – Settings Updated\nBackup deleted");
        this.onDone?.();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        new Notice("Sprout: failed to delete backup (see console).");
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
