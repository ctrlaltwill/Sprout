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
  type DropdownComponent,
} from "obsidian";
import type SproutPlugin from "../main";
import type { CardState } from "../types/scheduler";
import { log } from "../core/logger";
import { queryFirst } from "../core/ui";
import { VIEW_TYPE_WIDGET } from "../core/constants";
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

  /** Debounce timers for settings-change notices (keyed by setting path). */
  private _noticeTimers = new Map<string, number>();

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
    new Setting(wrapper).setName("Scheduling data backup").setHeading();

    {
      const createItem = wrapper.createDiv({ cls: "setting-item" });
      const createInfo = createItem.createDiv({ cls: "setting-item-info" });
      createInfo.createDiv({ cls: "setting-item-name", text: "Create backup" });
      createInfo.createDiv({
        cls: "setting-item-description",
        text: "Save a snapshot of your scheduling data (due dates, intervals, review history). Use this to recover if scheduling data is corrupted or lost during an update. Backups are created automatically every 15 minutes.",
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
              this.display();
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

    // Create a wrapper for all settings (everything should render inside this)
    const wrapper = containerEl.createDiv({ cls: "sprout-settings-wrapper sprout-settings" });

    // Sprout title above user details
    new Setting(wrapper).setName("Sprout").setHeading();

    // ----------------------------
    // General
    // ----------------------------
    new Setting(wrapper).setName("General").setHeading();

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

    // Hide Sprout info (About/Changelog/Roadmap) toggle
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
    // General (continued) — appearance & reset
    // ----------------------------

    new Setting(wrapper)
      .setName("Reset to defaults")
      .setDesc("Resets all settings back to their defaults. Does not delete cards or change scheduling.")
      .addButton((b) =>
        b.setButtonText("Reset…").onClick(() => {
          new ConfirmResetDefaultsModal(this.app, async () => {
            const before = clonePlain(this.plugin.settings);
            try {
              await this.resetSettingsToDefaults();

              this.refreshReviewerViewsIfPossible();
              this.refreshAllWidgetViews();

              this.display();
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

    new Setting(wrapper)
      .setName("Prettify cards")
      .setDesc("Choose how cards are coloured: accent (uses the app accent colour) or theme (uses theme colouring).")
      .addDropdown((d) => {
        d.addOption("accent", "Accent");
        d.addOption("theme", "Theme");
        const cur = (this.plugin.settings.general?.prettifyCards ?? "accent");
        d.setValue(cur);
        d.onChange(async (v) => {
          this.plugin.settings.general.prettifyCards = v;
          await this.plugin.saveAll();
          // Refresh all Sprout views
          this.plugin.refreshAllViews();

          // Show alert when setting is changed
          new Notice("Prettify cards changed to " + v);

          // Force reload of all markdown reading views (note tabs)
          const ws = this.plugin.app.workspace;
          const leaves = ws.getLeavesOfType("markdown");
          for (const leaf of leaves) {
            // Find the markdown content area inside the leaf
            const content = leaf.view?.containerEl
              ? queryFirst(
                  leaf.view.containerEl,
                  ".markdown-reading-view, .markdown-preview-view, .markdown-rendered, .markdown-preview-sizer, .markdown-preview-section",
                )
              : null;
            if (content) {
              log.debug("Dispatching sprout:prettify-cards-refresh to", content);
              try {
                content.dispatchEvent(new CustomEvent("sprout:prettify-cards-refresh", { bubbles: true }));
              } catch (e) { log.swallow("dispatch prettify-cards-refresh", e); }
              if (content instanceof HTMLElement) {
                content.classList.add("sprout-settings-opacity-flicker");
                setTimeout(() => { content.classList.remove("sprout-settings-opacity-flicker"); }, 50);
              }
            }

            const view = leaf.view;
            if (view instanceof MarkdownView) {
              try {
                view.previewMode?.rerender?.();
              } catch (e) { log.swallow("rerender preview", e); }
              try {
                (view.previewMode as unknown as { onLoadFile?: (f: unknown) => void })?.onLoadFile?.(view.file!);
              } catch (e) { log.swallow("reload preview file", e); }
            }
          }
        });
      });


    // Study
    // ----------------------------
    new Setting(wrapper).setName("Study").setHeading();

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
      .addDropdown((d) => {
        d.addOption("two", "Two buttons");
        d.addOption("four", "Four buttons");

        const curFour = !!this.plugin.settings.study.fourButtonMode;
        d.setValue(curFour ? "four" : "two");

        d.onChange(async (key) => {
          const prevFour = !!this.plugin.settings.study.fourButtonMode;
          const nextFour = key === "four";

          this.plugin.settings.study.fourButtonMode = nextFour;

          await this.plugin.saveAll();
          this.refreshReviewerViewsIfPossible();
          this.refreshAllWidgetViews();

          if (prevFour !== nextFour) {
            this.queueSettingsNotice("study.gradingSystem", `Grading buttons: ${nextFour ? "Four" : "Two"}`);
          }
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
      .setName("Randomise multiple-choice options")
      .setDesc("Shuffles multiple-choice options per card (stable during the session). Hotkeys follow the displayed order.")
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

    let presetDropdown: DropdownComponent | null = null;
    let isSyncingPreset = false;

    /** Programmatically syncs the preset dropdown to match current values. */
    const syncPresetDropdown = () => {
      if (!presetDropdown) return;
      const desired = detectPresetKey();
      const current = presetDropdown.getValue();
      if (current === desired) return;

      isSyncingPreset = true;
      try {
        presetDropdown.setValue(desired);
      } finally {
        isSyncingPreset = false;
      }
    };

    new Setting(wrapper)
      .setName("Preset")
      .setDesc("Apply a recommended configuration, or choose custom to keep your current values.")
      .addDropdown((d) => {
        presetDropdown = d;
        for (const p of presets) d.addOption(p.key, p.label);
        d.setValue(detectPresetKey());

        d.onChange(async (key) => {
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

          this.display();
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

    new Setting(wrapper)
      .setName("Reset analytics")
      .setDesc("Clears all review history, heatmaps, and statistics. Scheduling data (due dates, intervals) is preserved. Back up your data first if you may want to restore.")
      .addButton((b) =>
        b.setButtonText("Reset…").onClick(() => {
          new ConfirmResetAnalyticsModal(this.app, this.plugin).open();
        }),
      );

    this.renderBackupsSection(wrapper);

    // ----------------------------
    // Storage
    // ----------------------------
    new Setting(wrapper).setName("Storage").setHeading();

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


    // ----------------------------
    // Indexing
    // ----------------------------
    new Setting(wrapper).setName("Indexing").setHeading();

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

    // ----------------------------
    // Danger zone
    // ----------------------------
    new Setting(wrapper).setName("Danger zone").setHeading();

    new Setting(wrapper)
      .setName("Delete all flashcards")
      .setDesc("Deletes flashcards from notes and clears all plugin data. Irreversible.")
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
  }
}
