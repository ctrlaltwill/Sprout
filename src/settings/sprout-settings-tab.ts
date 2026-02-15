/**
 * @file src/settings/sprout-settings-tab.ts
 * @summary The Obsidian PluginSettingTab for Sprout. Renders the entire Settings panel including user details, general options, image-occlusion settings, card attachments, study/reviewer tweaks, widget options, FSRS scheduling presets, indexing, backups, quarantine list, and the danger zone (delete-all / reset). Confirmation dialogs are in confirm-modals.ts and pure helpers in settings-utils.ts.
 *
 * @exports
 *  - SproutSettingsTab — Obsidian PluginSettingTab subclass that renders and manages all Sprout plugin settings
 */

import {
  PluginSettingTab,
  Setting,
  TFile,
  type App,
  Notice,
  setIcon,
  MarkdownView,
} from "obsidian";
import type SproutPlugin from "../main";
import type { CardState } from "../types/scheduler";
import { log } from "../core/logger";
import { placePopover, queryFirst, replaceChildrenWithHTML, setCssProps } from "../core/ui";
import { DEFAULT_SETTINGS, VIEW_TYPE_WIDGET } from "../core/constants";
import { DELIMITER_OPTIONS, setDelimiter, type DelimiterChar } from "../core/delimiter";
import { syncReadingViewStyles } from "../reading/reading-view";
import { getLanguageOptions, getScriptLanguageGroups, getAvailableVoices, getTtsService } from "../tts/tts-service";
import {
  listDataJsonBackups,
  getDataJsonBackupStats,
  createDataJsonBackupNow,
  type DataJsonBackupStats,
} from "../sync/backup";

import {
  ConfirmResetSchedulingModal,
  ConfirmResetAnalyticsModal,
  ConfirmDeleteAllFlashcardsModal,
  ConfirmResetDefaultsModal,
  ConfirmRestoreBackupModal,
  ConfirmDeleteBackupModal,
} from "./confirm-modals";

import {
  parsePositiveNumberListCsv,
  clamp,
  toNonNegInt,
  fmtSettingValue,
  isAnchorLine,
  isCardStartLine,
  isFieldLine,
  looksLikeCardBlock,
  clonePlain,
  normaliseFolderPath,
  listVaultFolders,
  fuzzyFolderMatches,
} from "./settings-utils";

// ────────────────────────────────────────────
// SproutSettingsTab
// ────────────────────────────────────────────

export class SproutSettingsTab extends PluginSettingTab {
  plugin: SproutPlugin;
  private _audioAdvancedOptionsExpanded = false;
  private _readingCustomCssSaveTimer: number | null = null;

  /** Debounce timers for settings-change notices (keyed by setting path). */
  private _noticeTimers = new Map<string, number>();

  /**
   * External callback to re-render the current tab content without a full
   * page reload.  The workspace view sets this so that structural changes
   * (presets, toggles, resets) re-render only the active sub-tab while
   * preserving scroll position and skipping AOS animations.
   */
  onRequestRerender?: () => void;

  /**
   * Re-render the current tab content.  Uses the external callback when
   * available (workspace view), otherwise falls back to the built-in
   * `display()` which re-renders the entire native settings modal.
   */
  private _softRerender() {
    if (this.onRequestRerender) {
      this.onRequestRerender();
    } else {
      this.display();
    }
  }

  /**
   * Macro style definitions for Preview card appearance.
   * Each preset maps to a set of readingView setting values.
   */
  private static readonly PREVIEW_MACRO_PRESETS: Record<string, {
    label: string;
    desc: string;
    layout: "masonry" | "vertical";
    cardMode: "full" | "flip";
    visibleFields: {
      title: boolean;
      question: boolean;
      options: boolean;
      answer: boolean;
      info: boolean;
      groups: boolean;
      edit: boolean;
    };
    displayLabels: boolean;
  }> = {
    "flashcards": {
      label: "Flashcards",
      desc: "Simple front/back cards with flip interaction. Question on front, answer on back.",
      layout: "masonry",
      cardMode: "flip",
      visibleFields: { title: false, question: true, options: false, answer: true, info: false, groups: false, edit: false },
      displayLabels: false,
    },
    "classic": {
      label: "Classic",
      desc: "Classic cards with chevrons and collapsible sections for progressive reveal.",
      layout: "masonry",
      cardMode: "flip",
      visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true },
      displayLabels: true,
    },
    "guidebook": {
      label: "Guidebook",
      desc: "Walkthrough-style cards with guided sections and navigation dots.",
      layout: "vertical",
      cardMode: "full",
      visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true },
      displayLabels: true,
    },
    "markdown": {
      label: "Clean markdown",
      desc: "Tidied markdown-style output with minimal card chrome.",
      layout: "vertical",
      cardMode: "full",
      visibleFields: { title: false, question: true, options: true, answer: true, info: true, groups: true, edit: false },
      displayLabels: true,
    },
    "custom": {
      label: "Custom",
      desc: "User-authored CSS with clean hooks for full visual control.",
      layout: "vertical",
      cardMode: "full",
      visibleFields: { title: true, question: true, options: true, answer: true, info: true, groups: true, edit: true },
      displayLabels: true,
    },
  };

  private static readonly CUSTOM_CLASSIC_STARTER_CSS = `.sprout-pretty-card.sprout-macro-custom .sprout-custom-body {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  padding: 14px;
  background: var(--background-primary);
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-section {
  margin-bottom: 10px;
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-label {
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--sprout-font-2xs);
  color: var(--text-muted);
  font-weight: 600;
}

.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-answer,
.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-info,
.sprout-pretty-card.sprout-macro-custom .sprout-custom-section-groups {
  border-top: 1px dashed var(--background-modifier-border);
  padding-top: 8px;
}`;

  constructor(app: App, plugin: SproutPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ── Notice helpers ────────────────────────

  /**
   * Debounced notice: queues a "Settings updated" notice so that rapid
   * slider / text changes don't spam the user.
   */
  private queueSettingsNotice(key: string, line: string, delayMs = 200) {
    const prev = this._noticeTimers.get(key);
    if (prev) window.clearTimeout(prev);

    const handle = window.setTimeout(() => {
      this._noticeTimers.delete(key);
      new Notice(`Sprout: ${line}`);
    }, Math.max(0, delayMs));

    this._noticeTimers.set(key, handle);
  }

  // ── View-refresh helpers ──────────────────

  /** Refreshes all open sidebar widget views (summary + counts). */
  private refreshAllWidgetViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET);
    for (const leaf of leaves) {
      const v = leaf.view as unknown as { resetToSummaryAndRender?: () => void; onRefresh?: () => void; render?: () => void };
      try {
        if (typeof v?.resetToSummaryAndRender === "function") v.resetToSummaryAndRender();
        else if (typeof v?.onRefresh === "function") v.onRefresh();
        else if (typeof v?.render === "function") v.render();
      } catch (e) {
        log.error("failed to refresh widget view", e);
      }
    }
  }

  /** Calls the plugin's global view-refresh function if available. */
  private refreshReviewerViewsIfPossible() {
    try {
      this.plugin.refreshAllViews();
    } catch (e) {
      log.warn("failed to refresh open views", e);
    }
  }

  // ── DB statistics helpers ─────────────────

  /**
   * Reads live statistics from the plugin store: card count, state count,
   * how many are due / learning / review / mature, review-log length,
   * quarantine size, and IO map size.
   */
  private getCurrentDbStats(): {
    cards: number;
    states: number;
    due: number;
    learning: number;
    review: number;
    mature: number;
    reviewLog: number;
    quarantine: number;
    io: number;
  } {
    const data = this.plugin.store.data;
    const cards = data?.cards && typeof data.cards === "object" ? Object.keys(data.cards).length : 0;
    const states = data?.states && typeof data.states === "object" ? Object.keys(data.states).length : 0;
    const sched = this.computeSchedulingStats(data?.states ?? {}, Date.now());
    const reviewLog = Array.isArray(data?.reviewLog) ? data.reviewLog.length : 0;
    const quarantine = data?.quarantine && typeof data.quarantine === "object" ? Object.keys(data.quarantine).length : 0;
    const io = data?.io && typeof data.io === "object" ? Object.keys(data.io).length : 0;
    return { cards, states, due: sched.due, learning: sched.learning, review: sched.review, mature: sched.mature, reviewLog, quarantine, io };
  }

  /**
   * Scans all card states to compute scheduling counts:
   *  - `due`:      cards whose due date ≤ now (excluding suspended)
   *  - `learning`: cards in "learning" or "relearning" stage
   *  - `review`:   cards in "review" stage
   *  - `mature`:   review cards with stability ≥ 30 days
   */
  private computeSchedulingStats(states: Record<string, CardState>, now: number) {
    const out = { due: 0, learning: 0, review: 0, mature: 0 };
    if (!states || typeof states !== "object") return out;
    for (const st of Object.values(states)) {
      if (!st || typeof st !== "object") continue;
      const stage = String(st.stage ?? "");
      if (stage === "learning" || stage === "relearning") out.learning += 1;
      if (stage === "review") out.review += 1;
      const stability = Number(st.stabilityDays ?? 0);
      if (stage === "review" && Number.isFinite(stability) && stability >= 30) out.mature += 1;
      const due = Number(st.due ?? 0);
      if (stage !== "suspended" && Number.isFinite(due) && due > 0 && due <= now) out.due += 1;
    }
    return out;
  }

  // ── Backups section ───────────────────────

  /**
   * Renders the "Backups" section of the settings panel.
   * Shows a table of existing backups with restore / delete actions,
   * plus a "Create backup now" button.
   */
  private renderBackupsSection(wrapper: HTMLElement) {
    new Setting(wrapper).setName("Data backup").setHeading();

    {
      const createItem = wrapper.createDiv({ cls: "setting-item" });
      const createInfo = createItem.createDiv({ cls: "setting-item-info" });
      createInfo.createDiv({ cls: "setting-item-name", text: "Create backup" });
      createInfo.createDiv({
        cls: "setting-item-description",
        text: "Save a snapshot of your data (scheduling + analytics, including review history). Use this to recover if data is corrupted or lost during an update. Backups are created automatically every 15 minutes and capped at 5 to save disk space.",
      });
      const createControl = createItem.createDiv({ cls: "setting-item-control" });
      const btnCreate = createControl.createEl("button", { text: "Create backup now" });

      const tableItem = wrapper.createDiv({ cls: "setting-item" });
      const tableControl = tableItem.createDiv({ cls: "setting-item-control sprout-settings-backup-control" });

      const tableWrap = tableControl.createDiv({ cls: "sprout-settings-table-wrap" });

      /** Show a placeholder message inside the table wrapper. */
      const renderEmpty = (msg: string) => {
        tableWrap.empty();
        tableWrap.createDiv({ text: msg, cls: "sprout-settings-text-muted" });
      };

      const current = this.getCurrentDbStats();

      const formatCount = (n: number) => Number(n).toLocaleString();

      /** Formats a backup mtime as DD/MM/YYYY (HH:MM). */
      const formatBackupDate = (mtime: number | null | undefined) => {
        if (!mtime) return "—";
        const d = new Date(mtime);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, "0");
        const minutes = String(d.getMinutes()).padStart(2, "0");
        return `${day}/${month}/${year} (${hours}:${minutes})`;
      };

      /**
       * Derives a human-readable label from a backup filename.
       * E.g. "data.json.bak-2024-01-15T12:00:00Z-auto" → "Automatic backup".
       */
      const describeBackup = (name: string) => {
        const raw = String(name ?? "");
        const zMatch = /^data\\.json\\.bak-([0-9T-]+Z)(?:-(.+))?$/.exec(raw);
        const labelRaw = zMatch?.[2] ? String(zMatch[2]) : "";
        const label = labelRaw.replace(/[-_]+/g, " ").trim();
        const lower = label.toLowerCase();
        if (lower.includes("auto")) return "Automatic backup";
        if (lower.includes("manual")) return "Manual backup";
        if (lower.includes("before restore")) return "Manual backup";
        if (label) return "Manual backup";
        return raw === "data.json" ? "Current data.json" : "Manual backup";
      };

      /** One-line summary of scheduling data for a backup row. */
      const summaryLabel = (stats: { states: number; due: number; learning: number; review: number; mature: number }) => {
        if (!stats.states) return "No scheduling data";
        return `${formatCount(stats.states)} states · ${formatCount(stats.due)} due · ${formatCount(stats.learning)} learning · ${formatCount(
          stats.review,
        )} review · ${formatCount(stats.mature)} mature`;
      };

      /**
       * Renders the backup table rows. Shows all backups (max 5 kept on disk).
       */
      const renderTable = (rows: Array<{ stats: DataJsonBackupStats; ok: boolean }>) => {
        tableWrap.empty();

        const filtered = rows.filter((r) => r.stats?.name !== "data.json");
        if (!filtered.length) {
          renderEmpty("No scheduling data backups found. Click \u201CCreate backup now\u201D to create one.");
          return;
        }

        const table = tableWrap.createEl("table", {
          cls: "table w-full text-sm sprout-backup-table",
        });

        /* ── header ── */
        const thead = table.createEl("thead");
        const headRow = thead.createEl("tr", { cls: "text-left border-b border-border" });
        for (const label of ["Backup", "Date", "Scheduling data", "Actions"]) {
          headRow.createEl("th", { cls: "font-medium sprout-backup-cell", text: label });
        }

        const tbody = table.createEl("tbody");

        /* ── "current data" row ── */
        const currentTr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 sprout-backup-row--current" });
        currentTr.createEl("td", { cls: "sprout-backup-cell sprout-backup-cell--label", text: "Current data" });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: "Now" });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: summaryLabel(current) });
        currentTr.createEl("td", { cls: "sprout-backup-cell", text: "—" });

        /* ── backup rows (show all — max 5 kept on disk) ── */
        for (const r of filtered) {
          const s = r.stats;
          const tr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 last:border-0 sprout-backup-row--list" });

          tr.createEl("td", { cls: "sprout-backup-cell sprout-backup-cell--label", text: describeBackup(s.name) });
          tr.createEl("td", { cls: "sprout-backup-cell", text: formatBackupDate(s.mtime) });

          tr.createEl("td", {
            cls: `sprout-backup-cell${s.states > 0 ? " sprout-backup-cell--active" : ""}`,
            text: summaryLabel(s),
          });

          const actionsTd = tr.createEl("td", { cls: "sprout-backup-cell sprout-backup-actions" });

          /* Restore button */
          const btnRestore = actionsTd.createEl("button", { cls: "sprout-settings-icon-btn" });
          btnRestore.setAttribute("data-tooltip", "Restore this backup and replace current scheduling data.");
          setIcon(btnRestore, "archive-restore");
          btnRestore.onclick = () => {
            new ConfirmRestoreBackupModal(this.app, this.plugin, s, current, () => {
              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();
              this.plugin.refreshAllViews();
              this._softRerender();
            }).open();
          };

          /* Delete button */
          const btnDelete = actionsTd.createEl("button", { cls: "sprout-settings-icon-btn sprout-settings-icon-btn--danger" });
          btnDelete.setAttribute("data-tooltip", "Delete this scheduling data backup.");
          setIcon(btnDelete, "trash-2");
          btnDelete.onclick = () => {
            new ConfirmDeleteBackupModal(this.app, this.plugin, s, () => {
              void scan();
            }).open();
          };
        }
      };

      /** Scans the vault for backup files and populates the table. */
      const scan = async () => {
        renderEmpty("Scanning backups…");
        try {
          const entries = await listDataJsonBackups(this.plugin);

          const rows: Array<{ stats: DataJsonBackupStats; ok: boolean }> = [];
          for (const e of entries) {
            const st = await getDataJsonBackupStats(this.plugin, e.path);
            if (st) rows.push({ stats: st, ok: true });
          }
          renderTable(rows);
        } catch (e) {
          log.error(e);
          renderEmpty("Failed to scan backups (see console).");
        }
      };

      btnCreate.onclick = async () => {
        try {
          const p = await createDataJsonBackupNow(this.plugin, "manual");
          if (!p) {
            new Notice("Sprout: could not create backup (no scheduling data or adapter cannot write).");
            return;
          }
          new Notice("Scheduling data backup created");
          await scan();
        } catch (e) {
          log.error(e);
          new Notice("Sprout: failed to create scheduling data backup (see console).");
        }
      };

      renderEmpty("Loading backups…");
      void scan();
    }
  }

  // ── Vault-wide card deletion ──────────────

  /**
   * Walks every markdown file in the vault and removes:
   *  - Sprout anchor lines (`^sprout-NNNNNNNNN`)
   *  - Card blocks (Q/MCQ/CQ start lines + following field lines)
   *
   * Returns counts of files modified and lines/anchors/cards removed.
   */
  private async deleteAllSproutDataFromVault(): Promise<{
    filesTouched: number;
    anchorsRemoved: number;
    cardsRemoved: number;
    linesRemoved: number;
  }> {
    const mdFiles = this.app.vault.getMarkdownFiles();
    let filesTouched = 0;
    let anchorsRemoved = 0;
    let cardsRemoved = 0;
    let linesRemoved = 0;

    for (const f of mdFiles) {
      const text = await this.app.vault.read(f);
      const lines = text.split(/\r?\n/);

      const out: string[] = [];
      let changed = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();

        /* Remove standalone anchor lines */
        if (isAnchorLine(t)) {
          anchorsRemoved++;
          linesRemoved++;
          changed = true;
          continue;
        }

        /* Remove card blocks (start line + trailing field/anchor/blank lines) */
        if (isCardStartLine(t) && looksLikeCardBlock(lines, i)) {
          cardsRemoved++;
          linesRemoved++;
          changed = true;

          let j = i + 1;
          for (; j < lines.length; j++) {
            const tj = lines[j].trim();

            if (isCardStartLine(tj) && looksLikeCardBlock(lines, j)) break;

            if (!tj || isAnchorLine(tj) || isFieldLine(tj)) {
              if (isAnchorLine(tj)) anchorsRemoved++;
              linesRemoved++;
              continue;
            }

            break;
          }

          i = j - 1;
          continue;
        }

        out.push(line);
      }

      if (changed) {
        filesTouched++;
        await this.app.vault.modify(f, out.join("\n"));
      }
    }

    return { filesTouched, anchorsRemoved, cardsRemoved, linesRemoved };
  }

  // ── Store clearing ────────────────────────

  /** Clears all card data from the plugin store (cards, states, review log, quarantine). */
  private async clearSproutStore(): Promise<void> {
    const data = this.plugin.store.data;
    if (!data || typeof data !== "object") return;

    data.cards = {};
    data.states = {};
    data.reviewLog = [];
    data.quarantine = {};
    data.version = Math.max(Number(data.version) || 0, 5);

    await this.plugin.store.persist();
  }

  // ── Settings reset ────────────────────────

  /**
   * Attempts to reset plugin settings to defaults by trying several
   * well-known method/property names on the plugin instance.
   */
  private async resetSettingsToDefaults(): Promise<void> {
    await this.plugin.resetSettingsToDefaults();
  }

  // ── Quarantine list ───────────────────────

  /**
   * Renders the list of quarantined (un-parseable) cards at the bottom
   * of the settings panel, each with an "Open note" button.
   */
  private renderQuarantineList(containerEl: HTMLElement) {
    const q = this.plugin.store.data.quarantine || {};
    const ids = Object.keys(q);

    if (!ids.length) {
      const item = containerEl.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({ cls: "setting-item-description", text: "No quarantined cards." });
      return;
    }

    ids
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200)
      .forEach((id) => {
        const entry = q[id];

        const item = containerEl.createDiv({ cls: "setting-item" });

        const info = item.createDiv({ cls: "setting-item-info" });
        info.createDiv({ cls: "setting-item-name", text: `ID ${id}` });
        info.createDiv({
          cls: "setting-item-description",
          text: entry?.reason || "Parse error",
        });

        const control = item.createDiv({ cls: "setting-item-control" });
        const btn = control.createEl("button", { text: "Open note" });
        btn.onclick = async () => {
          const notePath = entry?.notePath;
          if (!notePath) return;

          const anchor = `^sprout-${id}`;
          try {
            void this.app.workspace.openLinkText(`${notePath}#${anchor}`, notePath, false);
            return;
          } catch (e) { log.swallow("open link text", e); }

          const f = this.app.vault.getAbstractFileByPath(notePath);
          if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
        };
      });
  }

  // ────────────────────────────────────────────
  // Main display() method
  // ────────────────────────────────────────────

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // When opened from the native Obsidian settings modal (not embedded in
    // the Sprout workspace view), show a redirect message instead of the
    // full settings UI.
    if (!this.onRequestRerender) {
      const wrapper = containerEl.createDiv({ cls: "sprout-settings-wrapper sprout-settings" });
      new Setting(wrapper).setName("Sprout").setHeading();
      const desc = wrapper.createDiv({ cls: "setting-item" });
      const info = desc.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: "Sprout settings live inside the plugin. Click the button below to open them.",
      });
      new Setting(wrapper)
        .addButton((b) =>
          b.setButtonText("Open settings").setCta().onClick(() => {
            // Close the Obsidian settings modal
            (this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
            // Open the in-plugin settings view
            void (this.plugin as unknown as { openSettingsTab?: (forceNew?: boolean, targetTab?: string) => Promise<void> })
              .openSettingsTab?.(false, "settings");
          }),
        );
      return;
    }

    // Create a wrapper for all settings (everything should render inside this)
    const wrapper = containerEl.createDiv({ cls: "sprout-settings-wrapper sprout-settings" });

    // Appearance title above user details
    new Setting(wrapper).setName("Appearance").setHeading();

    // ----------------------------
    // General
    // ----------------------------

    new Setting(wrapper)
      .setName("User name")
      .setDesc("Your name for greetings and personalisation.")
      .addText((t) => {
        t.setPlaceholder("Your name");
        t.setValue(String(this.plugin.settings.general.userName ?? ""));
        t.onChange(async (v) => {
          this.plugin.settings.general.userName = v.trim();
          await this.plugin.saveAll();
          this.plugin.refreshAllViews();
        });
      });

    new Setting(wrapper)
      .setName("Show plugin information on homepage")
      .setDesc("Show information about development and features on the homepage.")
      .addToggle((t) => {
        // ON by default
        const showSproutInfo = this.plugin.settings.general.hideSproutInfo !== true;
        t.setValue(showSproutInfo);
        t.onChange(async (v) => {
          this.plugin.settings.general.hideSproutInfo = !v;
          await this.plugin.saveAll();
          this.plugin.refreshAllViews();
        });
      });

    new Setting(wrapper)
      .setName("Show greeting text")
      .setDesc("Turn off to show only 'home' as the title on the home page.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.general.showGreeting !== false);
        t.onChange(async (v) => {
          this.plugin.settings.general.showGreeting = !!v;
          await this.plugin.saveAll();
          this.plugin.refreshAllViews();
        });
      });

    // ----------------------------
    // General (continued) — appearance
    // ----------------------------

    new Setting(wrapper)
      .setName("Enable animations")
      .setDesc("Enable fade-up animations when pages load. Disable for a more immediate interface.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings?.general?.enableAnimations ?? true).onChange(async (v) => {
          if (!this.plugin.settings.general) this.plugin.settings.general = {} as typeof this.plugin.settings.general;
          this.plugin.settings.general.enableAnimations = v;
          await this.plugin.saveAll();
          this.plugin.refreshAllViews();
        }),
      );

    // ----------------------------
    // Audio
    // ----------------------------
    new Setting(wrapper).setName("Text to speech").setHeading();

    {
      const descItem = wrapper.createDiv({ cls: "setting-item" });
      const descInfo = descItem.createDiv({ cls: "setting-item-info" });
      descInfo.createDiv({
        cls: "setting-item-description",
        text: "Read flashcard content aloud using your system's built-in text-to-speech. " +
          "Non-Latin scripts (Chinese, Arabic, Cyrillic, etc.) are automatically detected " +
          "and matched to the best available system voice. Latin-script text uses your chosen default voice.",
      });
    }

    const audio = this.plugin.settings.audio;

    new Setting(wrapper)
      .setName("Enable text to speech")
      .setDesc(
        "Turn text to speech on or off globally. When disabled, no cards will be read aloud regardless of the settings below.",
      )
      .addToggle((t) => {
        t.setValue(audio.enabled);
        t.onChange(async (v) => {
          this.plugin.settings.audio.enabled = v;
          await this.plugin.saveAll();
          this._softRerender();
        });
      });

    if (audio.enabled) {
      audio.scriptLanguages ??= {
        cyrillic: "ru-RU",
        arabic: "ar-SA",
        cjk: "zh-CN",
        devanagari: "hi-IN",
      };

      new Setting(wrapper)
        .setName("Limit to group")
        .setDesc(
          "Only read aloud cards that belong to a specific group (set via the G| field). " +
          "Leave empty to read all cards.",
        )
        .addText((t) => {
          t.setPlaceholder("Example: tts");
          t.setValue(audio.limitToGroup || "");
          t.onChange(async (v) => {
            this.plugin.settings.audio.limitToGroup = v.trim();
            await this.plugin.saveAll();
          });
        });

      new Setting(wrapper)
        .setName("Autoplay audio")
        .setDesc(
          "Automatically read the question aloud when a card is shown, and the answer when it is revealed.",
        )
        .addToggle((t) => {
          t.setValue(audio.autoplay ?? true);
          t.onChange(async (v) => {
            this.plugin.settings.audio.autoplay = v;
            await this.plugin.saveAll();
          });
        });

      this._addSearchablePopover(wrapper, {
        name: "Cloze answer read mode",
        description:
          "\"Just the answer\" reads only the cloze deletion (e.g. \"mitochondria\"). " +
          "\"Full sentence\" reads the whole sentence with the blank filled in.",
        options: [
          { value: "cloze-only", label: "Just the answer" },
          { value: "full-sentence", label: "Full sentence" },
        ],
        value: audio.clozeAnswerMode || "cloze-only",
        onChange: (v) => {
          void (async () => {
            this.plugin.settings.audio.clozeAnswerMode = v as "cloze-only" | "full-sentence";
            await this.plugin.saveAll();
          })();
        },
      });

      new Setting(wrapper).setName("Voice and accent").setHeading();

      const langOptions = getLanguageOptions();
      this._addSearchablePopover(wrapper, {
        name: "Default voice",
        description:
          "Accent and dialect for Latin-script text (English, Spanish, French, etc.). " +
          "Also sets the word used for \"blank\" in cloze fronts.",
        options: langOptions.map((o) => ({ value: o.value, label: o.label })),
        value: audio.defaultLanguage || "en-US",
        onChange: (v) => {
          void (async () => {
            this.plugin.settings.audio.defaultLanguage = v;
            await this.plugin.saveAll();
          })();
        },
      });

      {
        const advancedItem = wrapper.createDiv({ cls: "setting-item sprout-settings-advanced-row" });
        const advancedInfo = advancedItem.createDiv({ cls: "setting-item-info" });
        advancedInfo.createDiv({
          cls: "setting-item-name",
          text: this._audioAdvancedOptionsExpanded ? "Hide advanced options" : "Show advanced options",
        });
        advancedInfo.createDiv({
          cls: "setting-item-description",
          text:
            "Choose languages for non-Latin scripts that map to multiple languages. " +
            "These preferences are used when script detection is ambiguous.",
        });

        const advancedControl = advancedItem.createDiv({ cls: "setting-item-control" });
        const advancedToggle = advancedControl.createEl("button", {
          cls: "bc btn-outline inline-flex items-center gap-2 h-9 px-3 text-sm sprout-settings-action-btn sprout-settings-advanced-toggle",
        });
        advancedToggle.type = "button";
        advancedToggle.setAttribute(
          "data-tooltip",
          this._audioAdvancedOptionsExpanded ? "Hide advanced voice options" : "Show advanced voice options",
        );
        advancedToggle.setAttribute("data-tooltip-position", "top");
        advancedToggle.setAttribute("aria-expanded", this._audioAdvancedOptionsExpanded ? "true" : "false");

        const advancedToggleLabel = advancedToggle.createSpan({
          text: this._audioAdvancedOptionsExpanded ? "Hide advanced options" : "Show advanced options",
        });
        const advancedChevron = advancedToggle.createSpan({ cls: "sprout-settings-advanced-chevron" });
        setIcon(advancedChevron, "chevron-down");
        advancedChevron.classList.toggle("is-expanded", this._audioAdvancedOptionsExpanded);

        const advancedContent = wrapper.createDiv({ cls: "sprout-settings-advanced-content" });
        advancedContent.hidden = !this._audioAdvancedOptionsExpanded;

        for (const group of getScriptLanguageGroups()) {
          this._addSearchablePopover(advancedContent, {
            name: group.label,
            description: group.description,
            options: group.languages.map((o) => ({ value: o.value, label: o.label })),
            value: audio.scriptLanguages[group.key],
            onChange: (v) => {
              void (async () => {
                this.plugin.settings.audio.scriptLanguages[group.key] = v;
                await this.plugin.saveAll();
              })();
            },
          });
        }

        advancedToggle.onclick = () => {
          this._audioAdvancedOptionsExpanded = !this._audioAdvancedOptionsExpanded;
          const expanded = this._audioAdvancedOptionsExpanded;
          advancedContent.hidden = !expanded;
          advancedInfo.querySelector<HTMLElement>(".setting-item-name")!.textContent =
            expanded ? "Hide advanced options" : "Show advanced options";
          advancedToggleLabel.textContent = expanded ? "Hide advanced options" : "Show advanced options";
          advancedToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          advancedToggle.setAttribute(
            "data-tooltip",
            expanded ? "Hide advanced voice options" : "Show advanced voice options",
          );
          advancedChevron.classList.toggle("is-expanded", expanded);
        };
      }

      new Setting(wrapper).setName("Voice tuning").setHeading();

      new Setting(wrapper)
        .setName("Speech rate")
        .setDesc("Speed of speech (0.5 = slow, 1.0 = normal, 2.0 = fast).")
        .addSlider((s) => {
          s.setLimits(0.5, 2.0, 0.1);
          s.setValue(audio.rate ?? 1.0);
          s.setDynamicTooltip();
          s.onChange(async (v) => {
            this.plugin.settings.audio.rate = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(wrapper)
        .setName("Speech pitch")
        .setDesc("Pitch of speech (0.5 = low, 1.0 = normal, 2.0 = high).")
        .addSlider((s) => {
          s.setLimits(0.5, 2.0, 0.1);
          s.setValue(audio.pitch ?? 1.0);
          s.setDynamicTooltip();
          s.onChange(async (v) => {
            this.plugin.settings.audio.pitch = v;
            await this.plugin.saveAll();
          });
        });

      new Setting(wrapper)
        .setName("Test voice")
        .setDesc("Play a sample to hear the current voice settings.")
        .addButton((btn) => {
          btn.setButtonText("Play sample");
          btn.onClick(() => {
            const tts = getTtsService();
            if (!tts.isSupported) {
              new Notice("Text-to-speech is not supported in this environment.");
              return;
            }
            const sampleLang = audio.defaultLanguage || "en-US";
            const primary = sampleLang.split("-")[0];
            const samples: Record<string, string> = {
              en: "This is a sample of the text-to-speech voice.",
              es: "Esta es una muestra de la voz de texto a voz.",
              fr: "Ceci est un échantillon de la voix de synthèse vocale.",
              de: "Dies ist ein Beispiel für die Text-to-Speech-Stimme.",
              it: "Questo è un campione della voce text-to-speech.",
              pt: "Esta é uma amostra da voz de texto para fala.",
              ja: "これはテキスト読み上げ音声のサンプルです。",
              zh: "这是文字转语音的示例。",
              ko: "텍스트 음성 변환의 샘플입니다.",
              ar: "هذه عينة من صوت تحويل النص إلى كلام.",
              ru: "Это пример голоса синтеза речи.",
              hi: "यह टेक्स्ट-टू-स्पीच आवाज़ का एक नमूना है।",
            };
            const sample = samples[primary] ?? samples["en"] ?? "This is a sample of the text-to-speech voice.";
            tts.speak(sample, sampleLang, audio, false, true);
          });
        });

      const voices = getAvailableVoices();
      if (voices.length === 0) {
        new Setting(wrapper)
          .setName("Available system voices")
          .setDesc(
            "No TTS voices detected yet. Voices load asynchronously — try reopening this tab. " +
            "If still empty, check your operating system's speech/accessibility settings.",
          );
      }
    }

    // ----------------------------
    // Cards
    // ----------------------------
    new Setting(wrapper).setName("Basic cards").setHeading();

    // Basic section
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({ cls: "setting-item-description", text: "No settings available yet." });
    }

    // ── Cloze section ──
    new Setting(wrapper).setName("Cloze").setHeading();

    const cardsSettings = this.plugin.settings.cards ??
      { clozeMode: "standard" as const, clozeBgColor: "", clozeTextColor: "" };

    if (!this.plugin.settings.cards) {
      (this.plugin.settings as Record<string, unknown>).cards = cardsSettings;
    }

    const colourSettingEls: HTMLElement[] = [];

    const updateColourSettingsState = () => {
      const isTyped = cardsSettings.clozeMode === "typed";
      for (const el of colourSettingEls) {
        el.classList.toggle("sprout-disabled-opacity", isTyped);
        el.querySelectorAll<HTMLInputElement>("input").forEach(inp => {
          inp.disabled = isTyped;
        });
      }
    };

    new Setting(wrapper)
      .setName("Cloze mode")
      .setDesc("Standard shows normal cloze blanks. Typed replaces blanks with a text input for active recall.")
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            { value: "standard", label: "Standard" },
            { value: "typed", label: "Typed" },
          ],
          value: cardsSettings.clozeMode ?? "standard",
          onChange: (v) => {
            void (async () => {
              const prev = cardsSettings.clozeMode;
              cardsSettings.clozeMode = v as "standard" | "typed";
              await this.plugin.saveAll();
              this.refreshReviewerViewsIfPossible();
              updateColourSettingsState();

              if (prev !== v) {
                this.queueSettingsNotice("cards.clozeMode", `Cloze mode: ${v === "typed" ? "Typed" : "Standard"}`);
              }
            })();
          },
        });
      });

    // Cloze background colour
    const bgColourSetting = new Setting(wrapper)
      .setName("Cloze background colour")
      .setDesc("Custom background colour for revealed cloze pills. Leave default to use the theme accent. Standard mode only.");

    const bgRestoreEl = bgColourSetting.controlEl.createDiv({
      cls: "clickable-icon extra-setting-button sprout-colour-restore",
    });
    bgRestoreEl.setAttribute("data-tooltip", "Restore default");
    bgRestoreEl.setAttribute("data-tooltip-position", "top");
    bgRestoreEl.setAttribute("aria-disabled", cardsSettings.clozeBgColor ? "false" : "true");
    setIcon(bgRestoreEl, "rotate-ccw");
    bgRestoreEl.addEventListener("click", () => {
      void (async () => {
        if (bgRestoreEl.getAttribute("aria-disabled") === "true") return;
        cardsSettings.clozeBgColor = "";
        await this.plugin.saveAll();
        this.refreshReviewerViewsIfPossible();
        bgRestoreEl.setAttribute("aria-disabled", "true");
        const picker = bgColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
        if (picker) picker.value = "#7c3aed";
        this.queueSettingsNotice("cards.clozeBgColor", "Cloze background colour reset to default", 0);
      })();
    });

    bgColourSetting.controlEl.createEl("input", {
      type: "color",
      value: cardsSettings.clozeBgColor || "#7c3aed",
      cls: "sprout-colour-picker",
    }, (inp) => {
      inp.addEventListener("input", () => {
        cardsSettings.clozeBgColor = inp.value;
        void this.plugin.saveAll().then(() => this.refreshReviewerViewsIfPossible());
        bgRestoreEl.setAttribute("aria-disabled", "false");
      });
    });

    colourSettingEls.push(bgColourSetting.settingEl);

    // Cloze text colour
    const textColourSetting = new Setting(wrapper)
      .setName("Cloze text colour")
      .setDesc("Custom text colour for revealed cloze pills. Leave default for automatic contrast. Standard mode only.");

    const textRestoreEl = textColourSetting.controlEl.createDiv({
      cls: "clickable-icon extra-setting-button sprout-colour-restore",
    });
    textRestoreEl.setAttribute("data-tooltip", "Restore default");
    textRestoreEl.setAttribute("data-tooltip-position", "top");
    textRestoreEl.setAttribute("aria-disabled", cardsSettings.clozeTextColor ? "false" : "true");
    setIcon(textRestoreEl, "rotate-ccw");
    textRestoreEl.addEventListener("click", () => {
      void (async () => {
        if (textRestoreEl.getAttribute("aria-disabled") === "true") return;
        cardsSettings.clozeTextColor = "";
        await this.plugin.saveAll();
        this.refreshReviewerViewsIfPossible();
        textRestoreEl.setAttribute("aria-disabled", "true");
        const picker = textColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
        if (picker) picker.value = "#ffffff";
        this.queueSettingsNotice("cards.clozeTextColor", "Cloze text colour reset to default", 0);
      })();
    });

    textColourSetting.controlEl.createEl("input", {
      type: "color",
      value: cardsSettings.clozeTextColor || "#ffffff",
      cls: "sprout-colour-picker",
    }, (inp) => {
      inp.addEventListener("input", () => {
        cardsSettings.clozeTextColor = inp.value;
        void this.plugin.saveAll().then(() => this.refreshReviewerViewsIfPossible());
        textRestoreEl.setAttribute("aria-disabled", "false");
      });
    });

    colourSettingEls.push(textColourSetting.settingEl);

    updateColourSettingsState();

    // ── Image occlusion section ──
    new Setting(wrapper).setName("Image occlusion").setHeading();

    new Setting(wrapper)
      .setName("Default mask mode")
      .setDesc("Choose which masks are hidden on the front of new image occlusion cards.")
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            { value: "solo", label: "Hide one" },
            { value: "all", label: "Hide all" },
          ],
          value: this.plugin.settings.imageOcclusion?.defaultMaskMode || "solo",
          onChange: (val) => {
            void (async () => {
              if (val === "solo" || val === "all") {
                this.plugin.settings.imageOcclusion.defaultMaskMode = val;
                await this.plugin.saveAll();
                this.queueSettingsNotice("io-default-mode", "Default reveal mode updated");
              }
            })();
          },
        });
      });

    const targetColourSetting = new Setting(wrapper)
      .setName("Target mask colour")
      .setDesc("Background colour for the active/target mask (the mask being studied). Leave empty to use the theme accent colour.")
      .addText((t) => {
        t.inputEl.type = "color";
        const currentColor = this.plugin.settings.imageOcclusion?.maskTargetColor || "";
        if (currentColor) {
          t.setValue(currentColor);
        }
        t.onChange(async (val) => {
          this.plugin.settings.imageOcclusion.maskTargetColor = val;
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-target-color", "Target mask color updated");
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("reset");
        btn.extraSettingsEl.setAttribute("data-tooltip", "Reset to theme accent");
        btn.extraSettingsEl.setAttribute("data-tooltip-position", "top");
        btn.onClick(async () => {
          this.plugin.settings.imageOcclusion.maskTargetColor = "";
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-target-color", "Reset to theme accent");
          const picker = targetColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
          if (picker) picker.value = "";
        });
      });

    const otherColourSetting = new Setting(wrapper)
      .setName("Other mask colour")
      .setDesc("Background colour for context masks (masks that provide context clues). Leave empty to use the theme foreground colour.")
      .addText((t) => {
        t.inputEl.type = "color";
        const currentColor = this.plugin.settings.imageOcclusion?.maskOtherColor || "";
        if (currentColor) {
          t.setValue(currentColor);
        }
        t.onChange(async (val) => {
          this.plugin.settings.imageOcclusion.maskOtherColor = val;
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-other-color", "Other mask color updated");
        });
      })
      .addExtraButton((btn) => {
        btn.setIcon("reset");
        btn.extraSettingsEl.setAttribute("data-tooltip", "Reset to theme foreground");
        btn.extraSettingsEl.setAttribute("data-tooltip-position", "top");
        btn.onClick(async () => {
          this.plugin.settings.imageOcclusion.maskOtherColor = "";
          await this.plugin.saveAll();
          this.queueSettingsNotice("io-other-color", "Reset to theme foreground");
          const picker = otherColourSetting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
          if (picker) picker.value = "";
        });
      });

    // Mask icon
    {
      const maskSetting = new Setting(wrapper)
        .setName("Mask icon")
        .setDesc("Icon shown on the target mask during review.");

      const currentIcon = this.plugin.settings.imageOcclusion?.maskIcon ?? "circle-help";
      type IconChoice = "circle-help" | "eye-off" | "custom" | "none";
      let activeChoice: IconChoice =
        currentIcon === "" ? "none"
        : currentIcon === "circle-help" ? "circle-help"
        : currentIcon === "eye-off" ? "eye-off"
        : "custom";
      let customText = activeChoice === "custom" ? currentIcon : "";

      const controlEl = maskSetting.controlEl;
      controlEl.empty();
      controlEl.classList.add("sprout-io-icon-picker");

      const choices: { key: IconChoice; icon?: string; label: string }[] = [
        { key: "circle-help", icon: "circle-help", label: "" },
        { key: "eye-off", icon: "eye-off", label: "" },
        { key: "none", label: "None" },
        { key: "custom", label: "Custom" },
      ];

      const chips: HTMLElement[] = [];
      let customInput: HTMLInputElement | null = null;

      const saveIcon = async () => {
        let val = "";
        if (activeChoice === "circle-help" || activeChoice === "eye-off") val = activeChoice;
        else if (activeChoice === "custom") val = customText;
        this.plugin.settings.imageOcclusion.maskIcon = val;
        await this.plugin.saveAll();
      };

      const updateState = () => {
        chips.forEach((c) => {
          const key = c.dataset.key as IconChoice;
          c.classList.toggle("is-active", key === activeChoice);
        });
        if (customInput) {
          customInput.hidden = activeChoice !== "custom";
        }
      };

      for (const ch of choices) {
        const chip = controlEl.createEl("button", { cls: "sprout-io-icon-chip" });
        chip.dataset.key = ch.key;
        if (ch.icon) {
          setIcon(chip, ch.icon);
        } else {
          chip.textContent = ch.label;
        }
        chip.addEventListener("click", () => {
          void (async () => {
            activeChoice = ch.key;
            updateState();
            await saveIcon();
          })();
        });
        chips.push(chip);
      }

      customInput = controlEl.createEl("input", {
        type: "text",
        cls: "sprout-io-icon-custom-input",
        placeholder: "?",
        value: customText,
      });
      customInput.addEventListener("input", () => {
        void (async () => {
          if (!customInput) return;
          customText = customInput.value;
          await saveIcon();
        })();
      });

      updateState();
    }

    // Multiple choice section
    new Setting(wrapper).setName("Multiple choice").setHeading();
    new Setting(wrapper)
      .setName("Shuffle order")
      .setDesc("Shuffles the order of answers in multiple choice questions and multi-select questions")
      .addToggle((t) => {
        const cur = !!this.plugin.settings.study.randomizeMcqOptions;
        t.setValue(cur);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.study.randomizeMcqOptions;
          this.plugin.settings.study.randomizeMcqOptions = v;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.randomizeMcqOptions", `Randomise multiple-choice options: ${v ? "On" : "Off"}`);
          }
        });
      });

    // Ordered questions section
    new Setting(wrapper).setName("Ordered questions").setHeading();
    new Setting(wrapper)
      .setName("Shuffle order")
      .setDesc("Shuffles the order of steps every time the question appears")
      .addToggle((t) => {
        const cur = this.plugin.settings.study.randomizeOqOrder ?? true;
        t.setValue(cur);
        t.onChange(async (v) => {
          const prev = this.plugin.settings.study.randomizeOqOrder ?? true;
          this.plugin.settings.study.randomizeOqOrder = v;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.randomizeOqOrder", `Ordered question shuffle: ${v ? "On" : "Off"}`);
          }
        });
      });

    // ----------------------------
    // Reading
    // ----------------------------
    new Setting(wrapper).setName("Reading view styles").setHeading();

    const rv = this.plugin.settings.readingView ?? clonePlain(DEFAULT_SETTINGS.readingView);
    if (!this.plugin.settings.readingView) {
      (this.plugin.settings as Record<string, unknown>).readingView = rv;
    }

    const normaliseMacro = (raw: unknown): "flashcards" | "classic" | "guidebook" | "markdown" | "custom" => {
      const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (key === "minimal-flip") return "flashcards";
      if (key === "full-card") return "classic";
      if (key === "compact") return "markdown";
      if (key === "flashcards" || key === "classic" || key === "guidebook" || key === "markdown" || key === "custom") return key;
      return "flashcards";
    };

    rv.activeMacro = normaliseMacro(rv.activeMacro ?? rv.preset);
    rv.preset = rv.activeMacro;
    rv.macroConfigs ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs);
    rv.macroConfigs.flashcards ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.flashcards);
    rv.macroConfigs.classic ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.classic);
    rv.macroConfigs.guidebook ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.guidebook);
    rv.macroConfigs.markdown ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.markdown);
    rv.macroConfigs.custom ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.custom);

    const normaliseFields = (
      fields: Partial<typeof DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields> | undefined,
      fallback: typeof DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields,
    ) => ({
      title: fields?.title ?? fallback.title,
      question: fields?.question ?? fallback.question,
      options: fields?.options ?? fallback.options,
      answer: fields?.answer ?? fallback.answer,
      info: fields?.info ?? fallback.info,
      groups: fields?.groups ?? fallback.groups,
      edit: fields?.edit ?? fallback.edit,
      labels: fields?.labels ?? fallback.labels,
    });

    rv.macroConfigs.flashcards.fields = normaliseFields(
      rv.macroConfigs.flashcards.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.flashcards.fields,
    );
    rv.macroConfigs.classic.fields = normaliseFields(
      rv.macroConfigs.classic.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields,
    );
    rv.macroConfigs.guidebook.fields = normaliseFields(
      rv.macroConfigs.guidebook.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.fields,
    );
    rv.macroConfigs.markdown.fields = normaliseFields(
      rv.macroConfigs.markdown.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.markdown.fields,
    );
    rv.macroConfigs.custom.fields = normaliseFields(
      rv.macroConfigs.custom.fields,
      DEFAULT_SETTINGS.readingView.macroConfigs.custom.fields,
    );

    rv.macroConfigs.classic.colours ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.classic.colours);
    rv.macroConfigs.guidebook.colours ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.colours);
    rv.macroConfigs.markdown.colours ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.markdown.colours);
    rv.macroConfigs.custom.colours ??= clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.custom.colours);
    rv.macroConfigs.custom.customCss ??= DEFAULT_SETTINGS.readingView.macroConfigs.custom.customCss;

    this.plugin.settings.general.enableReadingStyles ??= this.plugin.settings.general.prettifyCards !== "off";

    const syncStyles = () => {
      try { syncReadingViewStyles(); } catch (e) { log.swallow("syncReadingViewStyles", e); }
    };

    const refreshReadingViews = () => {
      syncStyles();
      const ws = this.plugin.app.workspace;
      const leaves = ws.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const content = leaf.view?.containerEl
          ? queryFirst(leaf.view.containerEl, ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section")
          : null;
        if (content) {
          try {
            content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", { bubbles: true }));
          } catch (e) { log.swallow("dispatch reading view refresh", e); }
        }
      }
    };

    const fullRerenderRV = () => {
      syncStyles();
      this.plugin.refreshAllViews();
      const ws = this.plugin.app.workspace;
      const leaves = ws.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const content = leaf.view?.containerEl
          ? queryFirst(leaf.view.containerEl, ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section")
          : null;
        if (content) {
          try {
            content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", { bubbles: true }));
          } catch (e) { log.swallow("dispatch reading view refresh", e); }
        }
        const view = leaf.view;
        if (view instanceof MarkdownView) {
          try { view.previewMode?.rerender?.(); } catch (e) { log.swallow("rerender preview", e); }
          try { (view.previewMode as unknown as { onLoadFile?: (f: unknown) => void })?.onLoadFile?.(view.file!); } catch (e) { log.swallow("reload preview file", e); }
        }
      }
    };

    const syncLegacyMirror = () => {
      const cfg = rv.macroConfigs[rv.activeMacro];
      rv.visibleFields = {
        title: cfg.fields.title,
        question: cfg.fields.question,
        options: cfg.fields.options,
        answer: cfg.fields.answer,
        info: cfg.fields.info,
        groups: cfg.fields.groups,
        edit: cfg.fields.edit,
      };
      rv.displayLabels = cfg.fields.labels;
      const p = SproutSettingsTab.PREVIEW_MACRO_PRESETS[rv.activeMacro];
      rv.layout = p.layout;
      rv.cardMode = p.cardMode;
      rv.preset = rv.activeMacro;
      if ("colours" in cfg && cfg.colours) {
        rv.cardBgLight = cfg.colours.cardBgLight || "";
        rv.cardBgDark = cfg.colours.cardBgDark || "";
        rv.cardBorderLight = cfg.colours.cardBorderLight || "";
        rv.cardBorderDark = cfg.colours.cardBorderDark || "";
        rv.cardAccentLight = cfg.colours.cardAccentLight || "";
        rv.cardAccentDark = cfg.colours.cardAccentDark || "";
      } else {
        rv.cardBgLight = "";
        rv.cardBgDark = "";
        rv.cardBorderLight = "";
        rv.cardBorderDark = "";
        rv.cardAccentLight = "";
        rv.cardAccentDark = "";
      }
    };

    const applyPreset = async (key: "flashcards" | "classic" | "guidebook" | "markdown" | "custom") => {
      const p = SproutSettingsTab.PREVIEW_MACRO_PRESETS[key];
      rv.activeMacro = key;
      rv.preset = key;
      rv.layout = p.layout;
      rv.cardMode = p.cardMode;
      rv.macroConfigs[key].fields = {
        title: p.visibleFields.title,
        question: p.visibleFields.question,
        options: p.visibleFields.options,
        answer: p.visibleFields.answer,
        info: p.visibleFields.info,
        groups: p.visibleFields.groups,
        edit: p.visibleFields.edit,
        labels: p.displayLabels,
      };
      syncLegacyMirror();
      await this.plugin.saveAll();
      fullRerenderRV();
      this._softRerender();
    };

    new Setting(wrapper)
      .setName("Enable card styling")
      .setDesc("When off, cards use native reading view with no plugin card styling.")
      .addToggle((t) => {
        t.setValue(!!this.plugin.settings.general.enableReadingStyles);
        t.onChange(async (enabled) => {
          this.plugin.settings.general.enableReadingStyles = !!enabled;
          this.plugin.settings.general.prettifyCards = enabled ? "accent" : "off";
          if (enabled && !rv.activeMacro) rv.activeMacro = "flashcards";
          syncLegacyMirror();
          await this.plugin.saveAll();
          fullRerenderRV();
          this._softRerender();
        });
      });

    const readingSettingsStartIndex = wrapper.children.length;
    const isReadingStylesEnabled = !!this.plugin.settings.general.enableReadingStyles;

    new Setting(wrapper).setName("Macro styles").setHeading();
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({ cls: "setting-item-description", text: "Choose a style preset. Flashcards is the only style with flip interaction." });
    }

    const presetGridRV = wrapper.createDiv({ cls: "sprout-rv-preset-grid" });
    const rvPresets = SproutSettingsTab.PREVIEW_MACRO_PRESETS;
    for (const [key, p] of Object.entries(rvPresets) as Array<["flashcards" | "classic" | "guidebook" | "markdown" | "custom", typeof rvPresets.flashcards]>) {
      const card = presetGridRV.createDiv({
        cls: `sprout-rv-preset-card${rv.activeMacro === key ? " is-active" : ""}`,
      });
      card.createDiv({ cls: "sprout-rv-preset-label", text: p.label });
      card.createDiv({ cls: "sprout-rv-preset-desc", text: p.desc });
      card.addEventListener("click", () => void applyPreset(key));
    }

    const activeCfg = rv.macroConfigs[rv.activeMacro];
    const demoExpandedByDefault = rv.activeMacro === "guidebook" || rv.activeMacro === "markdown" || rv.activeMacro === "custom";
    const previewWrap = wrapper.createDiv({ cls: "sprout-rv-live-preview" });
    previewWrap.createDiv({ cls: "sprout-rv-live-preview-title", text: "Live preview" });
    previewWrap.createDiv({ cls: "sprout-rv-live-preview-note", text: "Demo card updates live as you change options below." });

    const demoCard = previewWrap.createDiv({
      cls: `el-p sprout-pretty-card sprout-reading-card sprout-reading-view-wrapper accent sprout-macro-${rv.activeMacro} sprout-single-card sprout-rv-demo-card${rv.activeMacro === "custom" ? " sprout-custom-root" : ""}`,
    });
    demoCard.setAttribute("data-sprout-processed", "true");
    if (!activeCfg.fields.title) demoCard.setAttribute("data-hide-title", "true");
    if (!activeCfg.fields.question) demoCard.setAttribute("data-hide-question", "true");
    if (!activeCfg.fields.options) demoCard.setAttribute("data-hide-options", "true");
    if (!activeCfg.fields.answer) demoCard.setAttribute("data-hide-answer", "true");
    if (!activeCfg.fields.info) demoCard.setAttribute("data-hide-info", "true");
    if (!activeCfg.fields.groups) demoCard.setAttribute("data-hide-groups", "true");
    if (!activeCfg.fields.edit) demoCard.setAttribute("data-hide-edit", "true");
    if (!activeCfg.fields.labels) demoCard.setAttribute("data-hide-labels", "true");

    replaceChildrenWithHTML(demoCard, `
      <div class="sprout-card-header sprout-reading-card-header ${rv.activeMacro === "custom" ? "sprout-custom-header" : ""}">
        <div class="sprout-card-title sprout-reading-card-title ${rv.activeMacro === "custom" ? "sprout-custom-title" : ""}">Demo \u00b7 ABG Interpretation</div>
        <span class="sprout-card-edit-btn" role="button" tabindex="0" aria-hidden="true"></span>
      </div>
      <div class="sprout-card-content sprout-reading-card-content ${rv.activeMacro === "custom" ? "sprout-custom-body" : ""}">
        <div class="sprout-card-section sprout-section-question ${rv.activeMacro === "custom" ? "sprout-custom-section sprout-custom-section-question" : ""}">
          <div class="sprout-section-label ${rv.activeMacro === "custom" ? "sprout-custom-label" : ""}">Question</div>
          <div class="sprout-section-content sprout-text-muted sprout-p-spacing-none ${rv.activeMacro === "custom" ? "sprout-custom-content" : ""}">A patient has pH 7.30 and HCO\u2083\u207b 18. What primary disorder is most likely?</div>
        </div>
        <div class="sprout-card-section sprout-section-options ${rv.activeMacro === "custom" ? "sprout-custom-section sprout-custom-section-options" : ""}">
          <div class="sprout-section-label ${rv.activeMacro === "custom" ? "sprout-custom-label" : ""}">Options</div>
          <div class="sprout-options-list">
            <div class="sprout-option"><span class="sprout-option-bullet">A.</span><span class="sprout-option-text">Respiratory alkalosis</span></div>
            <div class="sprout-option"><span class="sprout-option-bullet">B.</span><span class="sprout-option-text">Metabolic acidosis</span></div>
            <div class="sprout-option"><span class="sprout-option-bullet">C.</span><span class="sprout-option-text">Metabolic alkalosis</span></div>
          </div>
        </div>
        <div class="sprout-card-section sprout-section-answer ${rv.activeMacro === "custom" ? "sprout-custom-section sprout-custom-section-answer" : ""}">
          <div class="sprout-section-label ${rv.activeMacro === "custom" ? "sprout-custom-label" : ""}">
            <span>Answer</span>
            <button class="sprout-toggle-btn sprout-toggle-btn-compact sprout-rv-demo-toggle" type="button" aria-expanded="${demoExpandedByDefault ? "true" : "false"}">
              <svg class="sprout-toggle-chevron sprout-toggle-chevron-icon${demoExpandedByDefault ? "" : " sprout-reading-chevron-collapsed"}" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
            </button>
          </div>
          <div class="sprout-collapsible ${demoExpandedByDefault ? "expanded" : "collapsed"} sprout-rv-demo-answer">
            <div class="sprout-answer sprout-p-spacing-none">Metabolic acidosis</div>
          </div>
        </div>
        <div class="sprout-card-section sprout-section-info ${rv.activeMacro === "custom" ? "sprout-custom-section sprout-custom-section-info" : ""}">
          <div class="sprout-section-label ${rv.activeMacro === "custom" ? "sprout-custom-label" : ""}">Extra Information</div>
          <div class="sprout-info sprout-p-spacing-none">Low pH + low bicarbonate indicates primary metabolic acidosis.</div>
        </div>
      </div>
      <div class="sprout-groups-list ${rv.activeMacro === "custom" ? "sprout-custom-groups" : ""}"><span class="sprout-group-tag">Medicine/Physiology</span></div>
    `);

    const demoToggle = previewWrap.querySelector<HTMLButtonElement>(".sprout-rv-demo-toggle");
    const demoAnswer = previewWrap.querySelector<HTMLElement>(".sprout-rv-demo-answer");
    const demoChevron = previewWrap.querySelector<HTMLElement>(".sprout-rv-demo-toggle .sprout-toggle-chevron");
    if (demoToggle && demoAnswer && demoChevron && rv.activeMacro !== "flashcards") {
      demoToggle.addEventListener("click", () => {
        const expanded = demoToggle.getAttribute("aria-expanded") === "true";
        if (expanded) {
          demoToggle.setAttribute("aria-expanded", "false");
          demoAnswer.classList.remove("expanded");
          demoAnswer.classList.add("collapsed");
          demoChevron.classList.add("sprout-reading-chevron-collapsed");
        } else {
          demoToggle.setAttribute("aria-expanded", "true");
          demoAnswer.classList.remove("collapsed");
          demoAnswer.classList.add("expanded");
          demoChevron.classList.remove("sprout-reading-chevron-collapsed");
        }
      });
    }

    new Setting(wrapper).setName("Custom style CSS").setHeading();
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: rv.activeMacro === "custom"
          ? "Write CSS scoped to .sprout-pretty-card.sprout-macro-custom. Use the clean hooks below for easy targeting."
          : "Switch macro style to Custom to edit custom CSS.",
      });

      if (rv.activeMacro === "custom") {
        const hooks = item.createDiv({ cls: "sprout-rv-custom-hooks" });
        hooks.createDiv({ cls: "sprout-rv-custom-hooks-title", text: "Available hooks" });
        hooks.createEl("code", {
          cls: "sprout-rv-custom-hooks-code",
          text: ".sprout-custom-root .sprout-custom-header .sprout-custom-title .sprout-custom-body .sprout-custom-section .sprout-custom-section-question .sprout-custom-section-options .sprout-custom-section-answer .sprout-custom-section-info .sprout-custom-section-groups .sprout-custom-label .sprout-custom-content .sprout-custom-groups",
        });

        const control = item.createDiv({ cls: "setting-item-control sprout-rv-custom-css-control" });
        const textarea = control.createEl("textarea", {
          cls: "sprout-rv-custom-css-input",
          attr: {
            rows: "12",
            spellcheck: "false",
          },
        });
        textarea.placeholder = ".sprout-pretty-card.sprout-macro-custom .sprout-custom-body {\n  border: 1px solid var(--background-modifier-border);\n}";
        textarea.value = rv.macroConfigs.custom.customCss ?? "";

        const buttonRow = control.createDiv({ cls: "sprout-rv-custom-css-buttons" });
        const insertStarter = buttonRow.createEl("button", { text: "Insert classic starter" });
        const clearCss = buttonRow.createEl("button", { text: "Clear CSS" });

        const scheduleCustomCssSave = () => {
          if (this._readingCustomCssSaveTimer != null) window.clearTimeout(this._readingCustomCssSaveTimer);
          this._readingCustomCssSaveTimer = window.setTimeout(() => {
            this._readingCustomCssSaveTimer = null;
            void this.plugin.saveAll();
          }, 300);
        };

        textarea.addEventListener("input", () => {
          rv.macroConfigs.custom.customCss = textarea.value;
          syncStyles();
          scheduleCustomCssSave();
        });

        insertStarter.addEventListener("click", () => {
          rv.macroConfigs.custom.customCss = SproutSettingsTab.CUSTOM_CLASSIC_STARTER_CSS;
          textarea.value = SproutSettingsTab.CUSTOM_CLASSIC_STARTER_CSS;
          syncStyles();
          scheduleCustomCssSave();
        });

        clearCss.addEventListener("click", () => {
          rv.macroConfigs.custom.customCss = "";
          textarea.value = "";
          syncStyles();
          scheduleCustomCssSave();
        });
      }
    }

    new Setting(wrapper).setName("Reading view fields").setHeading();
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({ cls: "setting-item-description", text: "Choose which fields appear for the selected macro style." });
    }

    const includeFields: Array<{ key: keyof typeof activeCfg.fields; label: string }> = [
      { key: "title", label: "Title" },
      { key: "question", label: "Question" },
      { key: "options", label: "Options" },
      { key: "answer", label: "Answer" },
      { key: "info", label: "Extra information" },
      { key: "groups", label: "Groups" },
      { key: "edit", label: "Edit control" },
      { key: "labels", label: "Display labels" },
    ];

    for (const f of includeFields) {
      new Setting(wrapper)
        .setName(f.label)
        .addToggle((t) => {
          t.setValue(!!activeCfg.fields[f.key]);
          t.onChange(async (v) => {
            activeCfg.fields[f.key] = v;
            syncLegacyMirror();
            await this.plugin.saveAll();
            refreshReadingViews();
          });
        });
    }

    new Setting(wrapper).setName("Reading view colours").setHeading();
    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      const supportsColours = rv.activeMacro !== "flashcards";
      info.createDiv({
        cls: "setting-item-description",
        text: supportsColours
          ? "Customise card colours for this macro style. Colours auto-adjust for dark theme."
          : "Colour customisation is unavailable for Flashcards.",
      });
    }

    const activeColours = rv.activeMacro === "flashcards" ? null : rv.macroConfigs[rv.activeMacro].colours;
    const rvColourRow = (
      label: string,
      desc: string,
      getValue: () => string,
      getDefault: string,
      setValue: (v: string) => void,
    ) => {
      const setting = new Setting(wrapper).setName(label).setDesc(desc);

      const restoreEl = setting.controlEl.createDiv({
        cls: "clickable-icon extra-setting-button sprout-colour-restore",
      });
      restoreEl.setAttribute("data-tooltip", "Restore default");
      restoreEl.setAttribute("data-tooltip-position", "top");
      restoreEl.setAttribute("aria-disabled", getValue() ? "false" : "true");
      setIcon(restoreEl, "rotate-ccw");
      restoreEl.addEventListener("click", () => {
        void (async () => {
          if (restoreEl.getAttribute("aria-disabled") === "true") return;
          setValue("");
          syncLegacyMirror();
          await this.plugin.saveAll();
          syncStyles();
          restoreEl.setAttribute("aria-disabled", "true");
          const picker = setting.controlEl.querySelector<HTMLInputElement>("input[type=color]");
          if (picker) picker.value = getDefault;
        })();
      });

      setting.controlEl.createEl("input", {
        type: "color",
        value: getValue() || getDefault,
        cls: "sprout-colour-picker",
      }, (inp) => {
        inp.addEventListener("input", () => {
          setValue(inp.value);
          syncLegacyMirror();
          void this.plugin.saveAll().then(() => syncStyles());
          restoreEl.setAttribute("aria-disabled", "false");
        });
      });
    };

    if (activeColours) {
      rvColourRow(
        "Card background",
        "Background colour for cards. Automatically adjusted for dark theme.",
        () => activeColours.cardBgLight,
        "#f8f8f8",
        (v) => { activeColours.cardBgLight = v; activeColours.cardBgDark = ""; },
      );

      rvColourRow(
        "Card border",
        "Border colour for cards. Automatically adjusted for dark theme.",
        () => activeColours.cardBorderLight,
        "#e0e0e0",
        (v) => { activeColours.cardBorderLight = v; activeColours.cardBorderDark = ""; },
      );

      rvColourRow(
        "Accent colour",
        "Title and highlight colour. Automatically adjusted for dark theme.",
        () => activeColours.cardAccentLight,
        "#7c3aed",
        (v) => { activeColours.cardAccentLight = v; activeColours.cardAccentDark = ""; },
      );
    }

    syncLegacyMirror();

    if (!isReadingStylesEnabled) {
      const allChildren = Array.from(wrapper.children);
      for (let i = readingSettingsStartIndex; i < allChildren.length; i++) {
        const child = allChildren[i] as HTMLElement;
        if (child) setCssProps(child, "display", "none");
      }
    }

    // Study
    // ----------------------------
    new Setting(wrapper).setName("Study sessions").setHeading();

    new Setting(wrapper)
      .setName("Daily new limit")
      .setDesc("Maximum new cards introduced per day (per deck). 0 disables new cards.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.study.dailyNewLimit)).onChange(async (v) => {
          const prev = this.plugin.settings.study.dailyNewLimit;
          const next = toNonNegInt(v, 20);
          this.plugin.settings.study.dailyNewLimit = next;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== next) {
            this.queueSettingsNotice("study.dailyNewLimit", `Daily new limit: ${fmtSettingValue(next)}`);
          }
        }),
      );

    new Setting(wrapper)
      .setName("Daily review limit")
      .setDesc("Maximum due cards studied per day (per deck). 0 disables reviews.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.study.dailyReviewLimit)).onChange(async (v) => {
          const prev = this.plugin.settings.study.dailyReviewLimit;
          const next = toNonNegInt(v, 200);
          this.plugin.settings.study.dailyReviewLimit = next;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== next) {
            this.queueSettingsNotice("study.dailyReviewLimit", `Daily review limit: ${fmtSettingValue(next)}`);
          }
        }),
      );

    let autoAdvanceSecondsSetting: Setting | null = null;

    new Setting(wrapper)
      .setName("Auto-advance")
      .setDesc("Automatically fails unanswered cards and advances after the timer.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.study.autoAdvanceEnabled).onChange(async (v) => {
          const prev = this.plugin.settings.study.autoAdvanceEnabled;
          this.plugin.settings.study.autoAdvanceEnabled = v;
          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          autoAdvanceSecondsSetting?.setDisabled(!v);

          if (prev !== v) {
            this.queueSettingsNotice("study.autoAdvanceEnabled", `Auto-advance: ${v ? "On" : "Off"}`);
          }
        }),
      );

    autoAdvanceSecondsSetting = new Setting(wrapper)
      .setName("Auto-advance after")
      .setDesc("Seconds (applies to the reviewer and widget).")
      .addSlider((s) =>
        s
          .setLimits(3, 60, 1)
          .setValue(Number(this.plugin.settings.study.autoAdvanceSeconds) || 10)
          .setDynamicTooltip()
          .onChange(async (v) => {
            const prev = this.plugin.settings.study.autoAdvanceSeconds;
            const next = Number(v) || 10;
            this.plugin.settings.study.autoAdvanceSeconds = next;
            await this.plugin.saveAll();
            this.refreshReviewerViewsIfPossible();

            if (prev !== next) {
              this.queueSettingsNotice("study.autoAdvanceSeconds", `Auto-advance: ${fmtSettingValue(next)}s`);
            }
          }),
      );

    autoAdvanceSecondsSetting.setDisabled(!this.plugin.settings.study.autoAdvanceEnabled);

    new Setting(wrapper)
      .setName("Grading buttons")
      .setDesc("Choose two buttons (again, good) or four buttons (again, hard, good, easy).")
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            { value: "two", label: "Two buttons" },
            { value: "four", label: "Four buttons" },
          ],
          value: this.plugin.settings.study.fourButtonMode ? "four" : "two",
          onChange: (key) => {
            void (async () => {
              const prevFour = !!this.plugin.settings.study.fourButtonMode;
              const nextFour = key === "four";

              this.plugin.settings.study.fourButtonMode = nextFour;

              await this.plugin.saveAll();
              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();

              if (prevFour !== nextFour) {
                this.queueSettingsNotice("study.gradingSystem", `Grading buttons: ${nextFour ? "Four" : "Two"}`);
              }
            })();
          },
        });
      });

    new Setting(wrapper)
      .setName("Skip button")
      .setDesc("Shows a skip button (enter). Skip postpones within the session and does not affect scheduling.")
      .addToggle((t) => {
        const cur = !!this.plugin.settings.study.enableSkipButton;
        t.setValue(cur);
        t.onChange(async (v) => {
          const prev = !!this.plugin.settings.study.enableSkipButton;
          this.plugin.settings.study.enableSkipButton = v;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.enableSkipButton", `Skip button: ${v ? "On" : "Off"}`);
          }
        });
      });

    new Setting(wrapper)
      .setName("Treat folder notes as decks")
      .setDesc("When enabled, a folder note studies cards from all notes in that folder and its subfolders.")
      .addToggle((t) => {
        const current = this.plugin.settings.study.treatFolderNotesAsDecks;
        t.setValue(current !== false);
        t.onChange(async (v) => {
          const prev = this.plugin.settings.study.treatFolderNotesAsDecks;
          this.plugin.settings.study.treatFolderNotesAsDecks = v;

          await this.plugin.saveAll();
          this.refreshAllWidgetViews();
          this.refreshReviewerViewsIfPossible();

          if (prev !== v) {
            this.queueSettingsNotice("study.treatFolderNotesAsDecks", `Folder notes: ${v ? "On" : "Off"}`);
          }
        });
      });

    // ── Sibling card management ──
    new Setting(wrapper)
      .setName("Sibling card management")
      .setDesc("Choose how sibling cards from the same note are managed during study sessions.")
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: [
            {
              value: "standard",
              label: "Standard queueing",
              description: "Uses normal FSRS ordering. Siblings can appear close together, especially early in a queue.",
            },
            {
              value: "disperse",
              label: "Disperse siblings",
              description: "Spreads sibling cards out across the queue so they are less likely to appear back-to-back.",
            },
            {
              value: "bury",
              label: "Bury siblings",
              description: "Shows one sibling card today and buries the rest until the next day.",
            },
          ],
          separatorAfterIndex: 0,
          value: this.plugin.settings.study.siblingMode ?? "standard",
          onChange: (v) => {
            void (async () => {
              const prev = this.plugin.settings.study.siblingMode ?? "standard";
              const next = v as "standard" | "disperse" | "bury";
              this.plugin.settings.study.siblingMode = next;
              await this.plugin.saveAll();
              this.refreshReviewerViewsIfPossible();

              if (prev !== next) {
                const labels: Record<string, string> = {
                  standard: "Standard queueing",
                  disperse: "Disperse siblings",
                  bury: "Bury siblings",
                };
                this.queueSettingsNotice("study.siblingMode", `Sibling card management: ${labels[next]}`);
              }
            })();
          },
        });
      });

    // ----------------------------
    // Scheduling
    // ----------------------------
    new Setting(wrapper).setName("Scheduling").setHeading();

    const sched = this.plugin.settings.scheduling;

    /** Rounds a number to 2 decimal places. */
    const round2 = (n: unknown) => {
      const x = Number(n);
      if (!Number.isFinite(x)) return NaN;
      return Number(x.toFixed(2));
    };

    /** Compares two numeric arrays for equality. */
    const arraysEqualNumbers = (a: unknown, b: unknown) => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (Number(a[i]) !== Number(b[i])) return false;
      }
      return true;
    };

    /* ── FSRS scheduling presets ── */
    const presets: Array<{
      key: string;
      label: string;
      desc: string;
      learning: number[];
      relearning: number[];
      retention: number;
    }> = [
      { key: "custom", label: "Custom", desc: "Keep your current values.", learning: [], relearning: [], retention: 0.9 },
      { key: "relaxed", label: "Relaxed", desc: "Learning: 20m | Relearning: 20m | Retention: 0.88", learning: [20], relearning: [20], retention: 0.88 },
      { key: "balanced", label: "Balanced", desc: "Learning: 10m, 1d | Relearning: 10m | Retention: 0.90", learning: [10, 1440], relearning: [10], retention: 0.9 },
      { key: "aggressive", label: "Aggressive", desc: "Learning: 5m, 30m, 1d | Relearning: 10m | Retention: 0.92", learning: [5, 30, 1440], relearning: [10], retention: 0.92 },
    ];

    /** Detects which preset matches the current scheduling parameters. */
    const detectPresetKey = (): string => {
      const curLearning = sched.learningStepsMinutes ?? [];
      const curRelearning = sched.relearningStepsMinutes ?? [];
      const curRetention = round2(sched.requestRetention);

      for (const p of presets) {
        if (p.key === "custom") continue;
        if (
          arraysEqualNumbers(curLearning, p.learning) &&
          arraysEqualNumbers(curRelearning, p.relearning ?? []) &&
          round2(p.retention) === curRetention
        ) {
          return p.key;
        }
      }
      return "custom";
    };

    let presetHandle: { getValue: () => string; setValue: (v: string) => void } | null = null;
    let isSyncingPreset = false;

    /** Programmatically syncs the preset dropdown to match current values. */
    const syncPresetDropdown = () => {
      if (!presetHandle) return;
      const desired = detectPresetKey();
      const current = presetHandle.getValue();
      if (current === desired) return;

      isSyncingPreset = true;
      try {
        presetHandle.setValue(desired);
      } finally {
        isSyncingPreset = false;
      }
    };

    new Setting(wrapper)
      .setName("Preset")
      .setDesc("Apply a recommended configuration, or choose custom to keep your current values.")
      .then((s) => {
        presetHandle = this._addSimpleSelect(s.controlEl, {
          options: presets.map((p) => ({ value: p.key, label: p.label })),
          separatorAfterIndex: 0,
          value: detectPresetKey(),

          onChange: (key) => {
            void (async () => {
              if (isSyncingPreset) return;

              const p = presets.find((x) => x.key === key);
              if (!p) return;

              if (p.key === "custom") {
                this.queueSettingsNotice("scheduling.preset", "FSRS preset: custom");
                return;
              }

              const prevLearning = (sched.learningStepsMinutes ?? []).slice();
              const prevRelearning = (sched.relearningStepsMinutes ?? []).slice();
              const prevRetention = sched.requestRetention;

              sched.learningStepsMinutes = p.learning.slice();
              sched.relearningStepsMinutes = (p.relearning ?? []).slice();
              sched.requestRetention = p.retention;

              await this.plugin.saveAll();

              this.queueSettingsNotice("scheduling.preset", `FSRS preset: ${p.label}`, 0);

              if (!arraysEqualNumbers(prevLearning, sched.learningStepsMinutes)) {
                this.queueSettingsNotice(
                  "scheduler.learningStepsMinutes",
                  `Learning steps: ${fmtSettingValue(sched.learningStepsMinutes)}`,
                );
              }
              if (!arraysEqualNumbers(prevRelearning, sched.relearningStepsMinutes)) {
                this.queueSettingsNotice(
                  "scheduler.relearningStepsMinutes",
                  `Relearning steps: ${fmtSettingValue(sched.relearningStepsMinutes)}`,
                );
              }
              if (round2(prevRetention) !== round2(sched.requestRetention)) {
                this.queueSettingsNotice(
                  "scheduler.requestRetention",
                  `Requested retention: ${fmtSettingValue(sched.requestRetention)}`,
                );
              }

              this._softRerender();
            })();
          },
        });
      });

    new Setting(wrapper)
      .setName("Learning steps")
      .setDesc("Minutes, comma-separated. Examples: 10  |  10,1440")
      .addText((t) =>
        t.setValue(String((sched.learningStepsMinutes ?? []).join(","))).onChange(async (v) => {
          const prev = (sched.learningStepsMinutes ?? []).slice();
          const arr = parsePositiveNumberListCsv(v);
          if (arr.length) sched.learningStepsMinutes = arr;
          await this.plugin.saveAll();
          syncPresetDropdown();

          if (!arraysEqualNumbers(prev, sched.learningStepsMinutes ?? [])) {
            this.queueSettingsNotice(
              "scheduler.learningStepsMinutes",
              `Learning steps: ${fmtSettingValue(sched.learningStepsMinutes)}`,
            );
          }
        }),
      );

    new Setting(wrapper)
      .setName("Relearning steps")
      .setDesc("Minutes, comma-separated. Used after lapses.")
      .addText((t) =>
        t.setValue(String((sched.relearningStepsMinutes ?? []).join(","))).onChange(async (v) => {
          const prev = (sched.relearningStepsMinutes ?? []).slice();
          const arr = parsePositiveNumberListCsv(v);
          if (arr.length) sched.relearningStepsMinutes = arr;
          await this.plugin.saveAll();
          syncPresetDropdown();

          if (!arraysEqualNumbers(prev, sched.relearningStepsMinutes ?? [])) {
            this.queueSettingsNotice(
              "scheduler.relearningStepsMinutes",
              `Relearning steps: ${fmtSettingValue(sched.relearningStepsMinutes)}`,
            );
          }
        }),
      );

    new Setting(wrapper)
      .setName("Requested retention")
      .setDesc("Target recall probability at review time. Typical: 0.85–0.95.")
      .addSlider((s) =>
        s
          .setLimits(0.8, 0.97, 0.01)
          .setValue(clamp(Number(sched.requestRetention) || 0.9, 0.8, 0.97))
          .setDynamicTooltip()
          .onChange(async (v) => {
            const prev = round2(sched.requestRetention);
            sched.requestRetention = Number(Number(v).toFixed(2));
            await this.plugin.saveAll();
            syncPresetDropdown();

            if (prev !== round2(sched.requestRetention)) {
              this.queueSettingsNotice(
                "scheduler.requestRetention",
                `Requested retention: ${fmtSettingValue(sched.requestRetention)}`,
              );
            }
          }),
      );

    new Setting(wrapper)
      .setName("Reset scheduling")
      .setDesc("Resets all cards to new and clears scheduling fields. Back up your data first if you may want to restore.")
      .addButton((b) =>
        b.setButtonText("Reset…").onClick(() => {
          new ConfirmResetSchedulingModal(this.app, this.plugin).open();
        }),
      );

    // ----------------------------
    // Storage
    // ----------------------------
    new Setting(wrapper).setName("Attachment storage").setHeading();

    new Setting(wrapper)
      .setName("Image occlusion folder")
      .setDesc("Where image occlusion mask images are saved within your vault.")
      .addText((t) => {
        const allFolders = listVaultFolders(this.app);

        const cur =
          this.plugin.settings.storage.imageOcclusionFolderPath ?? "Attachments/Image Occlusion/";
        t.setPlaceholder("Attachments/image occlusion/");
        t.setValue(String(cur));

        const inputEl = t.inputEl;

        const suggestWrap = inputEl.parentElement?.createDiv({ cls: "sprout-folder-suggest" }) ?? null;

        // Lazy list element: only exists when shown
        let listEl: HTMLDivElement | null = null;

        let activeIdx = -1;
        let lastCommitted = normaliseFolderPath(String(cur));
        let suppressBlurCommit = false;

        const ensureListEl = () => {
          if (!suggestWrap) return null;
          if (!listEl) {
            listEl = suggestWrap.createDiv({ cls: "sprout-folder-suggest-list" });
          }
          return listEl;
        };

        const hideList = () => {
          if (!listEl) return;
          listEl.remove();
          listEl = null;
          activeIdx = -1;
        };

        /** Commits the chosen folder path to settings. */
        const commit = async (rawValue: string, fromPick: boolean) => {
          const prev = String(this.plugin.settings.storage.imageOcclusionFolderPath ?? "");
          const next = normaliseFolderPath(rawValue || "Attachments/Image Occlusion/");

          inputEl.value = next;

          if (next === lastCommitted && next === normaliseFolderPath(prev)) {
            hideList();
            return;
          }

          this.plugin.settings.storage.imageOcclusionFolderPath = next;

          await this.plugin.saveAll();

          lastCommitted = next;
          hideList();

          if (prev !== next) {
            this.queueSettingsNotice(
              "io.attachmentFolderPath",
              `IO attachment folder: ${fmtSettingValue(next)}`,
              fromPick ? 0 : 150,
            );
          }
        };

        /** Renders the folder-suggestion dropdown list. */
        const renderList = (items: string[]) => {
          if (!items.length) {
            hideList();
            return;
          }

          const el = ensureListEl();
          if (!el) return;

          el.empty();
          activeIdx = -1;

          for (let i = 0; i < items.length; i++) {
            const p = items[i];

            const btn = el.createEl("button", { cls: "sprout-folder-suggest-item", text: p });
            btn.type = "button";

            // mousedown => selection before blur
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              suppressBlurCommit = true;
              void commit(p, true);
            });
          }
        };

        const updateSuggestions = () => {
          const raw = inputEl.value || "";
          const matches = fuzzyFolderMatches(allFolders, raw, 12);
          renderList(matches);
        };

        inputEl.addEventListener("input", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("focus", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (!listEl) return;

          const items = Array.from(listEl.querySelectorAll<HTMLButtonElement>(".sprout-folder-suggest-item"));
          if (!items.length) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIdx = Math.min(items.length - 1, activeIdx + 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIdx = Math.max(0, activeIdx - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();

            if (activeIdx >= 0 && activeIdx < items.length) {
              const picked = items[activeIdx].textContent || "";
              suppressBlurCommit = true;
              void commit(picked, true);
              return;
            }

            suppressBlurCommit = true;
            void commit(inputEl.value || "", false);
            return;
          } else if (e.key === "Escape") {
            e.preventDefault();
            hideList();
            return;
          } else {
            return;
          }

          items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
          const active = items[activeIdx];
          active?.scrollIntoView?.({ block: "nearest" });
        });

        // Commit on blur (typed value), no per-letter saves
        inputEl.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (suppressBlurCommit) {
              suppressBlurCommit = false;
              return;
            }
            void commit(inputEl.value || "", false);
          }, 120);
        });
      });

    new Setting(wrapper)
      .setName("Delete orphaned image occlusion images")
      .setDesc("Automatically remove image occlusion files during sync when their corresponding cards in your notes have been deleted.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.storage?.deleteOrphanedImages ?? true).onChange(async (v) => {
          const prev = this.plugin.settings.storage?.deleteOrphanedImages ?? true;
          this.plugin.settings.storage.deleteOrphanedImages = v;
          await this.plugin.saveAll();

          if (prev !== v) {
            this.queueSettingsNotice("io.deleteOrphanedImages", `Delete orphaned images: ${v ? "On" : "Off"}`);
          }
        }),
      );

    new Setting(wrapper)
      .setName("Card attachment folder")
      .setDesc("Where images and media in flashcards are saved within your vault.")
      .addText((t) => {
        const allFolders = listVaultFolders(this.app);

        const cur = this.plugin.settings.storage.cardAttachmentFolderPath ?? "Attachments/Cards/";
        t.setPlaceholder("Attachments/card attachments/");
        t.setValue(String(cur));

        const inputEl = t.inputEl;

        const suggestWrap = inputEl.parentElement?.createDiv({ cls: "sprout-folder-suggest" }) ?? null;

        // Lazy list element: only exists when shown
        let listEl: HTMLDivElement | null = null;

        let activeIdx = -1;
        let lastCommitted = normaliseFolderPath(String(cur));
        let suppressBlurCommit = false;

        const ensureListEl = () => {
          if (!suggestWrap) return null;
          if (!listEl) {
            listEl = suggestWrap.createDiv({ cls: "sprout-folder-suggest-list" });
          }
          return listEl;
        };

        const hideList = () => {
          if (!listEl) return;
          listEl.remove();
          listEl = null;
          activeIdx = -1;
        };

        /** Commits the chosen folder path to settings. */
        const commit = async (rawValue: string, fromPick: boolean) => {
          const prev = String(this.plugin.settings.storage.cardAttachmentFolderPath ?? "");
          const next = normaliseFolderPath(rawValue || "Attachments/Cards/");

          inputEl.value = next;

          if (next === lastCommitted && next === normaliseFolderPath(prev)) {
            hideList();
            return;
          }

          this.plugin.settings.storage.cardAttachmentFolderPath = next;

          await this.plugin.saveAll();

          lastCommitted = next;
          hideList();

          if (prev !== next) {
            this.queueSettingsNotice(
              "card.attachmentFolderPath",
              `Card attachment folder: ${fmtSettingValue(next)}`,
              fromPick ? 0 : 150,
            );
          }
        };

        /** Renders the folder-suggestion dropdown list. */
        const renderList = (items: string[]) => {
          if (!items.length) {
            hideList();
            return;
          }

          const el = ensureListEl();
          if (!el) return;

          el.empty();
          activeIdx = -1;

          for (let i = 0; i < items.length; i++) {
            const p = items[i];

            const btn = el.createEl("button", { cls: "sprout-folder-suggest-item", text: p });
            btn.type = "button";

            // mousedown => selection before blur
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              suppressBlurCommit = true;
              void commit(p, true);
            });
          }
        };

        const updateSuggestions = () => {
          const raw = inputEl.value || "";
          const matches = fuzzyFolderMatches(allFolders, raw, 12);
          renderList(matches);
        };

        inputEl.addEventListener("input", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("focus", () => {
          updateSuggestions();
        });

        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (!listEl) return;

          const items = Array.from(listEl.querySelectorAll<HTMLButtonElement>(".sprout-folder-suggest-item"));
          if (!items.length) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIdx = Math.min(items.length - 1, activeIdx + 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIdx = Math.max(0, activeIdx - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();

            if (activeIdx >= 0 && activeIdx < items.length) {
              const picked = items[activeIdx].textContent || "";
              suppressBlurCommit = true;
              void commit(picked, true);
              return;
            }

            suppressBlurCommit = true;
            void commit(inputEl.value || "", false);
            return;
          } else if (e.key === "Escape") {
            e.preventDefault();
            hideList();
            return;
          } else {
            return;
          }

          items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
          const active = items[activeIdx];
          active?.scrollIntoView?.({ block: "nearest" });
        });

        // Commit on blur (typed value), no per-letter saves
        inputEl.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (suppressBlurCommit) {
              suppressBlurCommit = false;
              return;
            }
            void commit(inputEl.value || "", false);
          }, 120);
        });
      });


    this.renderBackupsSection(wrapper);

    // ----------------------------
    // Syncing
    // ----------------------------
    new Setting(wrapper).setName("Syncing").setHeading();

    new Setting(wrapper)
      .setName("Ignore fenced code blocks")
      .setDesc("Prevents indexing of cards inside ``` fenced code blocks.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.indexing.ignoreInCodeFences).onChange(async (v) => {
          const prev = this.plugin.settings.indexing.ignoreInCodeFences;
          this.plugin.settings.indexing.ignoreInCodeFences = v;
          await this.plugin.saveAll();

          if (prev !== v) {
            this.queueSettingsNotice("indexing.ignoreInCodeFences", `Ignore code blocks: ${v ? "On" : "Off"}`);
          }
        }),
      );

    new Setting(wrapper)
      .setName("Card delimiter")
      .setDesc(
        "The character used to separate fields in card markup.",
      )
      .then((s) => {
        this._appendSettingWarning(
          s,
          "Changing this will NOT migrate existing cards. Cards written with a previous delimiter will stop parsing and their scheduling data will be lost on the next sync.",
        );
      })
      .then((s) => {
        this._addSimpleSelect(s.controlEl, {
          options: Object.entries(DELIMITER_OPTIONS).map(([value, label]) => ({ value, label })),
          separatorAfterIndex: 0,
          value: this.plugin.settings.indexing.delimiter ?? "|",
          onChange: (v) => {
            void (async () => {
              const prev = this.plugin.settings.indexing.delimiter ?? "|";
              const next = v as DelimiterChar;
              this.plugin.settings.indexing.delimiter = next;
              setDelimiter(next);
              await this.plugin.saveAll();

              if (prev !== next) {
                this.queueSettingsNotice("indexing.delimiter", `Card delimiter: ${DELIMITER_OPTIONS[next]}`);
              }
            })();
          },
        });
      });

    // ----------------------------
    // Reset options
    // ----------------------------
    new Setting(wrapper).setName("Reset").setHeading();

    new Setting(wrapper)
      .setName("Reset to defaults")
      .setDesc("Resets all settings back to their defaults. Does not delete cards or change scheduling.")
      .then((s) => {
        this._appendSettingWarning(
          s,
          "This action cannot be undone.",
        );
      })
      .addButton((b) =>
        b.setButtonText("Reset…").onClick(() => {
          new ConfirmResetDefaultsModal(this.app, async () => {
            const before = clonePlain(this.plugin.settings);
            try {
              await this.resetSettingsToDefaults();

              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();

              this._softRerender();
              this.queueSettingsNotice("settings.resetDefaults", "Settings reset to defaults", 0);
            } catch (e) {
              this.plugin.settings = before;
              log.error(e);
              new Notice(
                "Sprout: could not reset settings (see console).",
              );
            }
          }).open();
        }),
      );

    new Setting(wrapper)
      .setName("Reset analytics")
      .setDesc("Clears all review history, heatmaps, and statistics. Scheduling data (due dates, intervals) is preserved.")
      .then((s) => {
        this._appendSettingWarning(
          s,
          "This permanently deletes your analytics history. It can be restored from a backup.",
        );
      })
      .addButton((b) =>
        b.setButtonText("Reset…").onClick(() => {
          new ConfirmResetAnalyticsModal(this.app, this.plugin).open();
        }),
      );

    new Setting(wrapper)
      .setName("Reset scheduling")
      .setDesc("Resets all cards to new and clears scheduling fields.")
      .then((s) => {
        this._appendSettingWarning(
          s,
          "This resets scheduling for every card. It can be restored from a backup.",
        );
      })
      .addButton((b) =>
        b.setButtonText("Reset…").onClick(() => {
          new ConfirmResetSchedulingModal(this.app, this.plugin).open();
        }),
      );

    // ----------------------------
    // Danger zone
    // ----------------------------
    new Setting(wrapper).setName("Danger zone").setHeading();

    new Setting(wrapper)
      .setName("Delete all flashcards")
      .setDesc("Deletes flashcards from notes and clears all plugin data. Irreversible.")
      .then((s) => {
        this._appendSettingWarning(
          s,
          "This permanently removes flashcards from your notes and clears plugin data. Ensure you have a vault backup before continuing.",
        );
      })
      .addButton((b) =>
        b.setButtonText("Delete…").onClick(() => {
          new ConfirmDeleteAllFlashcardsModal(this.app, this.plugin, async () => {
            const before = Date.now();

            const { filesTouched, anchorsRemoved, cardsRemoved } = await this.deleteAllSproutDataFromVault();
            await this.clearSproutStore();

            this.refreshAllWidgetViews();
            this.refreshReviewerViewsIfPossible();

            const secs = Math.max(0, Math.round((Date.now() - before) / 100) / 10);
            new Notice(
              `Sprout: Deleted ${cardsRemoved} cards and ${anchorsRemoved} anchors in ${filesTouched} files (${secs}s)`,
            );
          }).open();
        }),
      );

    // ----------------------------
    // Quarantine
    // ----------------------------
    new Setting(wrapper).setName("Quarantined cards").setHeading();

    {
      const item = wrapper.createDiv({ cls: "setting-item" });
      const info = item.createDiv({ cls: "setting-item-info" });
      info.createDiv({
        cls: "setting-item-description",
        text: "Cards that could not be parsed. Open the source note to fix them.",
      });
    }

    this.renderQuarantineList(wrapper);

    this._styleSettingsButtons(wrapper);
  }

  private _styleSettingsButtons(root: HTMLElement) {
    const buttonEls = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
    for (const button of buttonEls) {
      if (
        button.classList.contains("sprout-settings-icon-btn") ||
        button.classList.contains("sprout-ss-trigger") ||
        button.classList.contains("sprout-folder-suggest-item") ||
        button.classList.contains("sprout-settings-advanced-toggle")
      ) {
        continue;
      }
      if (button.classList.contains("clickable-icon")) continue;

      button.type = "button";
      button.classList.remove("mod-cta", "mod-warning");
      button.classList.add("bc", "btn-outline", "inline-flex", "items-center", "gap-2", "h-9", "px-3", "text-sm", "sprout-settings-action-btn");
    }
  }

  private _appendSettingWarning(setting: Setting, text: string) {
    const warn = setting.descEl.createDiv({ cls: "sprout-ss-warning" });
    const warnIcon = warn.createSpan({ cls: "sprout-ss-warning-icon" });
    setIcon(warnIcon, "alert-triangle");
    warn.createSpan({ text });
  }

  // ── Helper: simple select popover ──
  private _addSimpleSelect(
    controlEl: HTMLElement,
    args: {
      options: { value: string; label: string; description?: string }[];
      value: string;
      separatorAfterIndex?: number;
      onChange: (value: string) => void;
    },
  ): { getValue: () => string; setValue: (v: string) => void } {
    const id = `sprout-ss-${Math.random().toString(36).slice(2, 9)}`;

    // ── Trigger button ──
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "sprout-ss-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const trigLabel = document.createElement("span");
    trigLabel.className = "sprout-ss-trigger-label";
    trigger.appendChild(trigLabel);

    const chevron = document.createElement("span");
    chevron.className = "sprout-ss-trigger-chevron";
    setIcon(chevron, "chevron-down");
    trigger.appendChild(chevron);

    let current = args.value;
    const labelFor = (v: string) => args.options.find((o) => o.value === v)?.label ?? v;
    trigLabel.textContent = labelFor(current);

    controlEl.appendChild(trigger);

    // ── Body-portal popover ──
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("sprout-popover-overlay");

    const panel = document.createElement("div");
    panel.className = "sprout-ss-panel";
    popover.appendChild(panel);
    sproutWrapper.appendChild(popover);

    // ── Options list ──
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.className = "sprout-ss-listbox";
    panel.appendChild(listbox);

    type ItemEntry = { value: string; el: HTMLElement };
    const items: ItemEntry[] = [];

    const buildItems = () => {
      listbox.replaceChildren();
      items.length = 0;

      for (const opt of args.options) {
        const item = document.createElement("div");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", opt.value === current ? "true" : "false");
        item.tabIndex = 0;
        item.className = "sprout-ss-item";

        const dotWrap = document.createElement("div");
        dotWrap.className = "sprout-ss-dot-wrap";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "sprout-ss-dot";
        if (opt.value === current) dot.classList.add("is-selected");
        dotWrap.appendChild(dot);

        const textWrap = document.createElement("div");
        textWrap.className = "sprout-ss-item-text";

        const txt = document.createElement("span");
        txt.className = "sprout-ss-item-label";
        txt.textContent = opt.label;
        textWrap.appendChild(txt);

        if (opt.description) {
          const desc = document.createElement("span");
          desc.className = "sprout-ss-item-desc";
          desc.textContent = opt.description;
          textWrap.appendChild(desc);
        }

        item.appendChild(textWrap);

        const activate = () => {
          current = opt.value;
          trigLabel.textContent = labelFor(current);
          for (const it of items) {
            it.el.setAttribute("aria-selected", it.value === current ? "true" : "false");
            const d = it.el.querySelector(".sprout-ss-dot");
            if (d) d.classList.toggle("is-selected", it.value === current);
          }
          args.onChange(current);
          close();
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        });

        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            activate();
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
          }
        });

        listbox.appendChild(item);
        items.push({ value: opt.value, el: item });

        // Insert separator after the specified index
        if (args.separatorAfterIndex != null && items.length - 1 === args.separatorAfterIndex) {
          const sep = document.createElement("div");
          sep.className = "sprout-ss-separator";
          sep.setAttribute("role", "separator");
          listbox.appendChild(sep);
        }
      }
    };

    // ── Positioning ──
    const place = () => placePopover({
      trigger, panel, popoverEl: popover,
      width: Math.max(220, trigger.getBoundingClientRect().width),
      align: "right",
      gap: 4,
    });

    // ── Open / Close ──
    let cleanup: (() => void) | null = null;

    const close = () => {
      trigger.setAttribute("aria-expanded", "false");
      popover.setAttribute("aria-hidden", "true");
      popover.classList.remove("is-open");
      cleanup?.();
      cleanup = null;
      if (sproutWrapper.parentNode === document.body) {
        document.body.removeChild(sproutWrapper);
      }
    };

    const open = () => {
      buildItems();

      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.classList.add("is-open");

      document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => {
        place();
        const sel = listbox.querySelector<HTMLElement>('[aria-selected="true"]');
        sel?.focus();
      });

      const onResizeOrScroll = () => place();

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (trigger.contains(t) || popover.contains(t)) return;
        close();
      };

      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        trigger.focus();
      };

      window.addEventListener("resize", onResizeOrScroll, true);
      window.addEventListener("scroll", onResizeOrScroll, true);

      const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
      }, 0);

      cleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const isOpen = trigger.getAttribute("aria-expanded") === "true";
      if (isOpen) close();
      else open();
    });

    return {
      getValue: () => current,
      setValue: (v: string) => {
        current = v;
        trigLabel.textContent = labelFor(current);
      },
    };
  }

  // ── Helper: searchable popover dropdown ──
  private _addSearchablePopover(
    container: HTMLElement,
    args: {
      name: string;
      description: string;
      options: { value: string; label: string; description?: string }[];
      value: string;
      onChange: (value: string) => void;
    },
  ): void {
    const id = `sprout-ss-${Math.random().toString(36).slice(2, 9)}`;

    const setting = new Setting(container).setName(args.name).setDesc(args.description);

    // ── Trigger button ──
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "sprout-ss-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const trigLabel = document.createElement("span");
    trigLabel.className = "sprout-ss-trigger-label";
    trigger.appendChild(trigLabel);

    const chevron = document.createElement("span");
    chevron.className = "sprout-ss-trigger-chevron";
    setIcon(chevron, "chevron-down");
    trigger.appendChild(chevron);

    let current = args.value;
    const labelFor = (v: string) => args.options.find((o) => o.value === v)?.label ?? v;
    trigLabel.textContent = labelFor(current);

    setting.controlEl.appendChild(trigger);

    // ── Body-portal popover ──
    const sproutWrapper = document.createElement("div");
    sproutWrapper.className = "sprout";
    const popover = document.createElement("div");
    popover.id = `${id}-popover`;
    popover.setAttribute("aria-hidden", "true");
    popover.classList.add("sprout-popover-overlay");

    const panel = document.createElement("div");
    panel.className = "sprout-ss-panel";
    popover.appendChild(panel);
    sproutWrapper.appendChild(popover);

    // ── Search input (only for >7 options) ──
    const showSearch = args.options.length > 7;
    let searchInput: HTMLInputElement | null = null;

    if (showSearch) {
      const searchWrap = document.createElement("div");
      searchWrap.className = "sprout-ss-search-wrap";
      panel.appendChild(searchWrap);

      const searchIcon = document.createElement("span");
      searchIcon.className = "sprout-ss-search-icon";
      setIcon(searchIcon, "search");
      searchWrap.appendChild(searchIcon);

      searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "sprout-ss-search-input";
      searchInput.placeholder = "Search\u2026";
      searchInput.setAttribute("autocomplete", "off");
      searchInput.setAttribute("spellcheck", "false");
      searchWrap.appendChild(searchInput);
    }

    // ── Options list ──
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.className = "sprout-ss-listbox";
    panel.appendChild(listbox);

    // ── Empty state ──
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "sprout-ss-empty";
    emptyMsg.textContent = "No results";
    emptyMsg.hidden = true;
    panel.appendChild(emptyMsg);

    type ItemEntry = { value: string; label: string; el: HTMLElement; lower: string };
    const items: ItemEntry[] = [];

    const buildItems = () => {
      listbox.replaceChildren();
      items.length = 0;

      for (const opt of args.options) {
        const item = document.createElement("div");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", opt.value === current ? "true" : "false");
        item.tabIndex = 0;
        item.className = "sprout-ss-item";

        const dotWrap = document.createElement("div");
        dotWrap.className = "sprout-ss-dot-wrap";
        item.appendChild(dotWrap);

        const dot = document.createElement("div");
        dot.className = "sprout-ss-dot";
        if (opt.value === current) dot.classList.add("is-selected");
        dotWrap.appendChild(dot);

        const textWrap = document.createElement("div");
        textWrap.className = "sprout-ss-item-text";

        const txt = document.createElement("span");
        txt.className = "sprout-ss-item-label";
        txt.textContent = opt.label;
        textWrap.appendChild(txt);

        if (opt.description) {
          const desc = document.createElement("span");
          desc.className = "sprout-ss-item-desc";
          desc.textContent = opt.description;
          textWrap.appendChild(desc);
        }

        item.appendChild(textWrap);

        const activate = () => {
          current = opt.value;
          trigLabel.textContent = labelFor(current);
          for (const it of items) {
            it.el.setAttribute("aria-selected", it.value === current ? "true" : "false");
            const d = it.el.querySelector(".sprout-ss-dot");
            if (d) d.classList.toggle("is-selected", it.value === current);
          }
          args.onChange(current);
          close();
        };

        item.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          activate();
        });

        item.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            activate();
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            close();
            trigger.focus();
          }
        });

        listbox.appendChild(item);
        items.push({
          value: opt.value,
          label: opt.label,
          el: item,
          lower: `${opt.label} ${opt.description ?? ""}`.toLowerCase(),
        });
      }
    };

    // ── Filter logic ──
    const applyFilter = () => {
      const q = searchInput?.value.toLowerCase().trim() ?? "";
      let visible = 0;
      for (const it of items) {
        const show = !q || it.lower.includes(q);
        it.el.hidden = !show;
        if (show) visible++;
      }
      emptyMsg.hidden = visible !== 0;
    };

    if (searchInput) {
      searchInput.addEventListener("input", applyFilter);

      searchInput.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Escape") return;
        ev.stopPropagation();
      });

      searchInput.addEventListener("mousedown", (ev) => ev.stopPropagation());
      searchInput.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    }

    // ── Positioning ──
    const place = () => placePopover({
      trigger, panel, popoverEl: popover,
      width: Math.max(220, trigger.getBoundingClientRect().width),
      align: "right",
      gap: 4,
    });

    // ── Open / Close ──
    let cleanup: (() => void) | null = null;

    const close = () => {
      trigger.setAttribute("aria-expanded", "false");
      popover.setAttribute("aria-hidden", "true");
      popover.classList.remove("is-open");
      cleanup?.();
      cleanup = null;
      if (sproutWrapper.parentNode === document.body) {
        document.body.removeChild(sproutWrapper);
      }
    };

    const open = () => {
      buildItems();
      if (searchInput) searchInput.value = "";
      applyFilter();

      trigger.setAttribute("aria-expanded", "true");
      popover.setAttribute("aria-hidden", "false");
      popover.classList.add("is-open");

      document.body.appendChild(sproutWrapper);
      requestAnimationFrame(() => {
        place();
        if (searchInput) {
          searchInput.focus();
        } else {
          const first = listbox.querySelector<HTMLElement>('[role="option"]');
          first?.focus();
        }
      });

      const onResizeOrScroll = () => place();

      const onDocPointerDown = (ev: PointerEvent) => {
        const t = ev.target as Node | null;
        if (!t) return;
        if (trigger.contains(t) || popover.contains(t)) return;
        close();
      };

      const onDocKeydown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        trigger.focus();
      };

      window.addEventListener("resize", onResizeOrScroll, true);
      window.addEventListener("scroll", onResizeOrScroll, true);

      const tid = window.setTimeout(() => {
        document.addEventListener("pointerdown", onDocPointerDown, true);
        document.addEventListener("keydown", onDocKeydown, true);
      }, 0);

      cleanup = () => {
        window.clearTimeout(tid);
        window.removeEventListener("resize", onResizeOrScroll, true);
        window.removeEventListener("scroll", onResizeOrScroll, true);
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        document.removeEventListener("keydown", onDocKeydown, true);
      };
    };

    trigger.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const isOpen = trigger.getAttribute("aria-expanded") === "true";
      if (isOpen) close();
      else open();
    });
  }
}
