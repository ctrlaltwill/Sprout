/**
 * @file src/views/settings/settings-tab.ts
 * @summary The Obsidian PluginSettingTab for Sprout. Renders the entire Settings panel including user details, general options, image-occlusion settings, card attachments, study/reviewer tweaks, widget options, FSRS scheduling presets, indexing, backups, quarantine list, and the danger zone (delete-all / reset). Confirmation dialogs are in confirm-modals.ts and pure helpers in settings-utils.ts.
 *
 * @exports
 *  - LearnKitSettingsTab — Obsidian PluginSettingTab subclass that renders and manages all LearnKit plugin settings
 */
import { PluginSettingTab, Setting, Notice, setIcon, requestUrl, } from "obsidian";
import { log } from "../../platform/core/logger";
import { placePopover, setCssProps } from "../../platform/core/ui";
import { DEFAULT_SETTINGS, VIEW_TYPE_WIDGET } from "../../platform/core/constants";
import { DELIMITER_OPTIONS, setDelimiter } from "../../platform/core/delimiter";
import { syncReadingViewStyles } from "../reading/reading-view";
import { getInterfaceLocaleLabel, getSupportedInterfaceLocales, resolveInterfaceLocale, } from "../../platform/translations/locale-registry";
import { getCircleFlagFallbackUrl, getCircleFlagUrl } from "../../platform/flags/flag-tokens";
import { t } from "../../platform/translations/translator";
import { getLanguageOptions, getScriptLanguageGroups, getAvailableVoices, getTtsService } from "../../platform/integrations/tts/tts-service";
import { clearTtsCache } from "../../platform/integrations/tts/tts-cache";
import { listDataJsonBackups, getDataJsonBackupStats, createDataJsonBackupNow, verifyDataJsonBackupIntegrity, } from "../../platform/integrations/sync/backup";
import { ConfirmResetSchedulingModal, ConfirmResetAnalyticsModal, ConfirmDeleteAllFlashcardsModal, ConfirmResetDefaultsModal, ConfirmRestoreBackupModal, ConfirmDeleteBackupModal, } from "./confirm-modals";
import { parsePositiveNumberListCsv, clamp, toNonNegInt, isAnchorLine, isCardStartLine, isFieldLine, looksLikeCardBlock, clonePlain, normaliseFolderPath, listVaultFolders, fuzzyFolderMatches, } from "./settings-utils";
import { getCurrentDbStatsFromStoreData } from "./config/settings-db-stats";
import { PREVIEW_MACRO_PRESETS, } from "./config/reading-presets";
import { BACKUP_ROWS_PER_PAGE_OPTIONS } from "./config/backup-constants";
import { createSettingsNoticeLines } from "./config/notice-lines";
import { mountSearchPopoverList } from "../shared/search-popover-list";
import { collectVaultTagAndPropertyPairs, decodePropertyPair, encodePropertyPair, extractFilePropertyPairs, extractFileTags, } from "../shared/scope-metadata";
import { copyAllDbsToVaultSyncFolder } from "../../platform/core/sqlite-store";
// ────────────────────────────────────────────
// LearnKitSettingsTab
// ────────────────────────────────────────────
export class LearnKitSettingsTab extends PluginSettingTab {
    _tx(token, fallback, vars) {
        var _a, _b;
        return t((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage, token, fallback, vars);
    }
    _getSettingsScrollContainer() {
        const local = this.containerEl;
        const localStyle = window.getComputedStyle(local);
        const localScrollable = /(auto|scroll)/.test(localStyle.overflowY) && local.scrollHeight > local.clientHeight;
        if (localScrollable)
            return local;
        const nativeSettings = local.closest(".vertical-tab-content-container");
        if (nativeSettings instanceof HTMLElement)
            return nativeSettings;
        let node = local.parentElement;
        while (node) {
            const style = window.getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
                return node;
            node = node.parentElement;
        }
        return null;
    }
    _restoreScrollPosition(container, top) {
        if (!container)
            return;
        requestAnimationFrame(() => {
            container.scrollTop = top;
            // Some host layouts settle after one frame; apply once more to avoid jumps.
            requestAnimationFrame(() => {
                container.scrollTop = top;
            });
        });
    }
    /**
     * Re-render the current tab content.  Uses the external callback when
     * available (workspace view), otherwise falls back to the built-in
     * `display()` which re-renders the entire native settings modal.
     */
    _softRerender() {
        var _a;
        const scrollContainer = this._getSettingsScrollContainer();
        const previousTop = (_a = scrollContainer === null || scrollContainer === void 0 ? void 0 : scrollContainer.scrollTop) !== null && _a !== void 0 ? _a : 0;
        if (this.onRequestRerender) {
            this.onRequestRerender();
        }
        else {
            this.display();
        }
        this._restoreScrollPosition(scrollContainer, previousTop);
    }
    constructor(app, plugin) {
        super(app, plugin);
        this._audioAdvancedOptionsExpanded = false;
        this._readingCustomCssSaveTimer = null;
        this._openRouterModelsCache = null;
        this._openRouterModelsLoading = false;
        this._openRouterModelsError = null;
        /** Debounce timers for settings-change notices (keyed by setting path). */
        this._noticeTimers = new Map();
        this.plugin = plugin;
        this._noticeLines = createSettingsNoticeLines((token, fallback, vars) => this._tx(token, fallback, vars));
    }
    // ── Notice helpers ────────────────────────
    /**
     * Debounced notice: queues a "Settings updated" notice so that rapid
     * slider / text changes don't spam the user.
     */
    queueSettingsNotice(key, line, delayMs = 200) {
        const prev = this._noticeTimers.get(key);
        if (prev)
            window.clearTimeout(prev);
        const handle = window.setTimeout(() => {
            this._noticeTimers.delete(key);
            new Notice(this._tx("ui.settings.notice.prefix", "LearnKit – {line}", { line }));
        }, Math.max(0, delayMs));
        this._noticeTimers.set(key, handle);
    }
    // ── View-refresh helpers ──────────────────
    /** Refreshes all open sidebar widget views (summary + counts). */
    refreshAllWidgetViews() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIDGET);
        for (const leaf of leaves) {
            const v = leaf.view;
            try {
                if (typeof (v === null || v === void 0 ? void 0 : v.resetToSummaryAndRender) === "function")
                    v.resetToSummaryAndRender();
                else if (typeof (v === null || v === void 0 ? void 0 : v.onRefresh) === "function")
                    v.onRefresh();
                else if (typeof (v === null || v === void 0 ? void 0 : v.render) === "function")
                    v.render();
            }
            catch (e) {
                log.error("failed to refresh widget view", e);
            }
        }
    }
    /** Calls the plugin's global view-refresh function if available. */
    refreshReviewerViewsIfPossible() {
        try {
            this.plugin.refreshAllViews();
        }
        catch (e) {
            log.warn("failed to refresh open views", e);
        }
    }
    // ── Backups section ───────────────────────
    /**
     * Renders the "Backups" section of the settings panel.
     * Shows a table of existing backups with restore / delete actions,
     * plus a "Create backup now" button.
     */
    renderBackupsSection(wrapper) {
        var _a, _b;
        var _c, _d;
        new Setting(wrapper).setName(this._tx("ui.settings.sections.dataBackup", "Data backup")).setHeading();
        (_a = (_c = this.plugin.settings).storage) !== null && _a !== void 0 ? _a : (_c.storage = clonePlain(DEFAULT_SETTINGS.storage));
        (_b = (_d = this.plugin.settings.storage).backups) !== null && _b !== void 0 ? _b : (_d.backups = clonePlain(DEFAULT_SETTINGS.storage.backups));
        const backupCfg = this.plugin.settings.storage.backups;
        if (typeof backupCfg.rollingDailyEnabled !== "boolean") {
            backupCfg.rollingDailyEnabled = true;
        }
        new Setting(wrapper)
            .setName(this._tx("ui.settings.backups.rollingDaily.name", "Rolling daily backup"))
            .setDesc(this._tx("ui.settings.backups.rollingDaily.desc", "Keep one automatic daily backup. Manual backups are never auto-deleted."))
            .addToggle((t) => t.setValue(backupCfg.rollingDailyEnabled).onChange(async (v) => {
            backupCfg.rollingDailyEnabled = v;
            await this.plugin.saveAll();
            this.queueSettingsNotice("storage.backups.rollingDailyEnabled", this._tx("ui.settings.backups.rollingDaily.notice", "Rolling daily backup: {state}", {
                state: v ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
            }));
        }));
        {
            const createItem = wrapper.createDiv({ cls: "setting-item" });
            const createInfo = createItem.createDiv({ cls: "setting-item-info" });
            createInfo.createDiv({ cls: "setting-item-name", text: this._tx("ui.settings.backups.createBackup.name", "Create backup") });
            createInfo.createDiv({
                cls: "setting-item-description",
                text: this._tx("ui.settings.backups.createBackup.desc", "Save a snapshot of scheduling and analytics data. Use before risky edits or migrations."),
            });
            const createControl = createItem.createDiv({ cls: "setting-item-control" });
            const btnCreate = createControl.createEl("button", { text: this._tx("ui.settings.backups.createBackup.button", "Create manual backup") });
            const tableItem = wrapper.createDiv({ cls: "setting-item" });
            const tableControl = tableItem.createDiv({ cls: "setting-item-control learnkit-settings-backup-control learnkit-settings-backup-control" });
            const tableWrap = tableControl.createDiv({ cls: "learnkit-settings-table-wrap learnkit-settings-table-wrap" });
            let backupPageIndex = 0;
            let backupRowsPerPage = 10;
            const backupRowsPerPageOptions = BACKUP_ROWS_PER_PAGE_OPTIONS;
            /** Show a placeholder message inside the table wrapper. */
            const renderEmpty = (msg) => {
                tableWrap.empty();
                tableWrap.createDiv({ text: msg, cls: "learnkit-settings-text-muted learnkit-settings-text-muted" });
            };
            const current = getCurrentDbStatsFromStoreData(this.plugin.store.data, Date.now());
            const formatCount = (n) => Number(n).toLocaleString();
            /** Formats a backup mtime as DD/MM/YYYY (HH:MM). */
            const formatBackupDate = (mtime) => {
                if (!mtime)
                    return "—";
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
            const describeBackup = (name) => {
                const raw = String(name !== null && name !== void 0 ? name : "");
                if (raw === "daily-backup.db") {
                    return this._tx("ui.settings.backups.label.dailyRolling", "Daily rolling backup");
                }
                if (/^manual-backup-\d{4}-\d{8}\.db$/i.test(raw)) {
                    return this._tx("ui.settings.backups.label.manual", "Manual backup");
                }
                const zMatch = /^data\\.json\\.bak-([0-9T-]+Z)(?:-(.+))?$/.exec(raw);
                const labelRaw = (zMatch === null || zMatch === void 0 ? void 0 : zMatch[2]) ? String(zMatch[2]) : "";
                const label = labelRaw.replace(/[-_]+/g, " ").trim();
                const lower = label.toLowerCase();
                if (lower.includes("auto"))
                    return this._tx("ui.settings.backups.label.automatic", "Automatic backup");
                if (lower.includes("manual"))
                    return this._tx("ui.settings.backups.label.manual", "Manual backup");
                if (lower.includes("before restore"))
                    return this._tx("ui.settings.backups.label.manual", "Manual backup");
                if (label)
                    return this._tx("ui.settings.backups.label.manual", "Manual backup");
                return raw === "data.json"
                    ? this._tx("ui.settings.backups.label.currentDataJson", "Current data.json")
                    : this._tx("ui.settings.backups.label.manual", "Manual backup");
            };
            /** One-line summary of scheduling data for a backup row. */
            const summaryLabel = (stats) => {
                if (!stats.states)
                    return this._tx("ui.settings.backups.summary.noSchedulingData", "No scheduling data");
                return this._tx("ui.settings.backups.summary.withData", "{states} states · {due} due · {learning} learning · {review} review · {mature} mature", {
                    states: formatCount(stats.states),
                    due: formatCount(stats.due),
                    learning: formatCount(stats.learning),
                    review: formatCount(stats.review),
                    mature: formatCount(stats.mature),
                });
            };
            /** Renders the backup table rows. */
            const renderTable = (rows) => {
                tableWrap.empty();
                const filtered = rows.filter((r) => { var _a; return ((_a = r.stats) === null || _a === void 0 ? void 0 : _a.name) !== "data.json"; });
                if (!filtered.length) {
                    renderEmpty(this._tx("ui.settings.backups.empty.noBackups", "No backups found. Click \u201CCreate manual backup\u201D to create one."));
                    return;
                }
                const totalRows = filtered.length;
                const totalPages = Math.max(1, Math.ceil(totalRows / backupRowsPerPage));
                backupPageIndex = Math.max(0, Math.min(backupPageIndex, totalPages - 1));
                const startRow = backupPageIndex * backupRowsPerPage;
                const endRow = Math.min(totalRows, startRow + backupRowsPerPage);
                const pageRows = filtered.slice(startRow, endRow);
                const table = tableWrap.createEl("table", {
                    cls: "table w-full text-sm learnkit-backup-table learnkit-backup-table",
                });
                /* ── header ── */
                const thead = table.createEl("thead");
                const headRow = thead.createEl("tr", { cls: "text-left border-b border-border" });
                for (const label of [
                    this._tx("ui.settings.backups.table.header.backup", "Backup"),
                    this._tx("ui.settings.backups.table.header.date", "Date"),
                    this._tx("ui.settings.backups.table.header.schedulingData", "Scheduling data"),
                    this._tx("ui.settings.backups.table.header.integrity", "Integrity"),
                    this._tx("ui.settings.backups.table.header.actions", "Actions"),
                ]) {
                    headRow.createEl("th", { cls: "font-medium learnkit-backup-cell learnkit-backup-cell", text: label });
                }
                const tbody = table.createEl("tbody");
                /* ── "current data" row ── */
                const currentTr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 learnkit-backup-row--current learnkit-backup-row--current" });
                currentTr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell learnkit-backup-cell--label learnkit-backup-cell--label", text: this._tx("ui.settings.backups.table.currentData", "Current data") });
                currentTr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell", text: this._tx("ui.settings.backups.table.now", "Now") });
                currentTr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell", text: summaryLabel(current) });
                currentTr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell", text: this._tx("ui.settings.backups.table.na", "—") });
                currentTr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell", text: this._tx("ui.settings.backups.table.na", "—") });
                /* ── backup rows ── */
                for (const r of pageRows) {
                    const s = r.stats;
                    const tr = tbody.createEl("tr", { cls: "align-top border-b border-border/50 last:border-0 learnkit-backup-row--list learnkit-backup-row--list" });
                    tr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell learnkit-backup-cell--label learnkit-backup-cell--label", text: describeBackup(s.name) });
                    tr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell", text: formatBackupDate(s.mtime) });
                    tr.createEl("td", {
                        cls: `learnkit-backup-cell${s.states > 0 ? " learnkit-backup-cell--active" : ""}`,
                        text: summaryLabel(s),
                    });
                    const integrityLabel = r.integrity === "verified"
                        ? this._tx("ui.settings.backups.integrity.verified", "Verified")
                        : r.integrity === "legacy"
                            ? this._tx("ui.settings.backups.integrity.legacy", "Legacy")
                            : this._tx("ui.settings.backups.integrity.invalid", "Invalid");
                    tr.createEl("td", {
                        cls: `learnkit-backup-cell${r.integrity === "invalid" ? " learnkit-settings-text-muted" : ""}`,
                        text: integrityLabel,
                    });
                    const actionsTd = tr.createEl("td", { cls: "learnkit-backup-cell learnkit-backup-cell learnkit-backup-actions learnkit-backup-actions" });
                    /* Restore button */
                    const btnRestore = actionsTd.createEl("button", { cls: "learnkit-settings-icon-btn learnkit-settings-icon-btn" });
                    btnRestore.setAttribute("aria-label", r.integrity === "invalid"
                        ? this._tx("ui.settings.backups.actions.restore.disabledTooltip", "This backup failed integrity checks and cannot be restored.")
                        : this._tx("ui.settings.backups.actions.restore.tooltip", "Restore this backup and replace current scheduling data."));
                    setIcon(btnRestore, "archive-restore");
                    if (r.integrity === "invalid")
                        btnRestore.setAttribute("disabled", "true");
                    btnRestore.onclick = () => {
                        if (r.integrity === "invalid")
                            return;
                        new ConfirmRestoreBackupModal(this.app, this.plugin, s, current, () => {
                            this.refreshReviewerViewsIfPossible();
                            this.refreshAllWidgetViews();
                            this.plugin.refreshAllViews();
                            this._softRerender();
                        }).open();
                    };
                    /* Delete button */
                    const btnDelete = actionsTd.createEl("button", { cls: "learnkit-settings-icon-btn learnkit-settings-icon-btn learnkit-settings-icon-btn--danger learnkit-settings-icon-btn--danger" });
                    btnDelete.setAttribute("aria-label", this._tx("ui.settings.backups.actions.delete.tooltip", "Delete this scheduling data backup."));
                    setIcon(btnDelete, "trash-2");
                    btnDelete.onclick = () => {
                        new ConfirmDeleteBackupModal(this.app, this.plugin, s, () => {
                            void scan();
                        }).open();
                    };
                }
                const pager = tableWrap.createDiv({ cls: "setting-item-control" });
                pager.classList.add("learnkit-backup-actions", "learnkit-backup-actions");
                const summary = pager.createEl("span", { cls: "learnkit-settings-text-muted learnkit-settings-text-muted" });
                summary.textContent = this._tx("ui.settings.backups.pager.showingRange", "Showing {start}-{end} of {total} backups", {
                    start: startRow + 1,
                    end: endRow,
                    total: totalRows,
                });
                const rowsLabel = pager.createEl("span", { cls: "learnkit-settings-text-muted learnkit-settings-text-muted" });
                rowsLabel.textContent = this._tx("ui.settings.backups.pager.rowsPerPage", "Rows per page");
                const rowsSelect = pager.createEl("select", { cls: "dropdown" });
                for (const size of backupRowsPerPageOptions) {
                    const opt = rowsSelect.createEl("option", { text: String(size) });
                    opt.value = String(size);
                    if (size === backupRowsPerPage)
                        opt.selected = true;
                }
                rowsSelect.onchange = () => {
                    const next = Number(rowsSelect.value);
                    if (!Number.isFinite(next) || next <= 0)
                        return;
                    backupRowsPerPage = next;
                    backupPageIndex = 0;
                    renderTable(rows);
                };
                const btnPrev = pager.createEl("button", { text: this._tx("ui.settings.backups.pager.prev", "Prev"), cls: "learnkit-settings-icon-btn learnkit-settings-icon-btn" });
                btnPrev.setAttribute("aria-label", this._tx("ui.settings.backups.pager.prevTooltip", "Previous backup page"));
                btnPrev.setAttribute("data-tooltip-position", "top");
                if (backupPageIndex <= 0)
                    btnPrev.setAttribute("disabled", "true");
                btnPrev.onclick = () => {
                    if (backupPageIndex <= 0)
                        return;
                    backupPageIndex -= 1;
                    renderTable(rows);
                };
                const pageLabel = pager.createEl("span", { cls: "learnkit-settings-text-muted learnkit-settings-text-muted" });
                pageLabel.textContent = this._tx("ui.settings.backups.pager.pageXofY", "Page {page} / {total}", {
                    page: backupPageIndex + 1,
                    total: totalPages,
                });
                const btnNext = pager.createEl("button", { text: this._tx("ui.settings.backups.pager.next", "Next"), cls: "learnkit-settings-icon-btn learnkit-settings-icon-btn" });
                btnNext.setAttribute("aria-label", this._tx("ui.settings.backups.pager.nextTooltip", "Next backup page"));
                btnNext.setAttribute("data-tooltip-position", "top");
                if (backupPageIndex >= totalPages - 1)
                    btnNext.setAttribute("disabled", "true");
                btnNext.onclick = () => {
                    if (backupPageIndex >= totalPages - 1)
                        return;
                    backupPageIndex += 1;
                    renderTable(rows);
                };
            };
            /** Scans the vault for backup files and populates the table. */
            const scan = async () => {
                renderEmpty(this._tx("ui.settings.backups.scan.scanning", "Scanning backups") + "\u2026");
                try {
                    const entries = await listDataJsonBackups(this.plugin);
                    const rows = [];
                    for (const e of entries) {
                        const st = await getDataJsonBackupStats(this.plugin, e.path);
                        if (!st)
                            continue;
                        const integrity = await verifyDataJsonBackupIntegrity(this.plugin, e.path);
                        const integrityState = !integrity.ok
                            ? "invalid"
                            : integrity.verified
                                ? "verified"
                                : "legacy";
                        rows.push({ stats: st, ok: integrity.ok, integrity: integrityState });
                    }
                    renderTable(rows);
                }
                catch (e) {
                    log.error(e);
                    renderEmpty(this._tx("ui.settings.backups.scan.failed", "Failed to scan backups (see console)."));
                }
            };
            btnCreate.onclick = async () => {
                try {
                    const p = await createDataJsonBackupNow(this.plugin, "manual");
                    if (!p) {
                        new Notice(this._tx("ui.settings.backups.notice.createUnavailable", "LearnKit – could not create backup (no scheduling data or adapter cannot write)"));
                        return;
                    }
                    new Notice(this._tx("ui.settings.backups.notice.createSuccess", "LearnKit – scheduling data backup created"));
                    await scan();
                }
                catch (e) {
                    log.error(e);
                    new Notice(this._tx("ui.settings.backups.notice.createFailed", "LearnKit – failed to create scheduling data backup"));
                }
            };
            renderEmpty(this._tx("ui.settings.backups.scan.loading", "Loading backups") + "\u2026");
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
    async deleteAllSproutDataFromVault() {
        const mdFiles = this.app.vault.getMarkdownFiles();
        let filesTouched = 0;
        let anchorsRemoved = 0;
        let cardsRemoved = 0;
        let linesRemoved = 0;
        for (const f of mdFiles) {
            const text = await this.app.vault.read(f);
            const lines = text.split(/\r?\n/);
            const out = [];
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
                        if (isCardStartLine(tj) && looksLikeCardBlock(lines, j))
                            break;
                        if (!tj || isAnchorLine(tj) || isFieldLine(tj)) {
                            if (isAnchorLine(tj))
                                anchorsRemoved++;
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
    async clearSproutStore() {
        const data = this.plugin.store.data;
        if (!data || typeof data !== "object")
            return;
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
    async resetSettingsToDefaults() {
        await this.plugin.resetSettingsToDefaults();
    }
    // ────────────────────────────────────────────
    // Teardown
    // ────────────────────────────────────────────
    /**
     * Called by Obsidian when the settings tab is navigated away from.
     * Clears pending timers and removes any body-appended popovers so they
     * don't leak into other views.
     */
    hide() {
        // Cancel all debounced notice timers.
        for (const handle of this._noticeTimers.values()) {
            window.clearTimeout(handle);
        }
        this._noticeTimers.clear();
        // Cancel the debounced custom-CSS save timer.
        if (this._readingCustomCssSaveTimer != null) {
            window.clearTimeout(this._readingCustomCssSaveTimer);
            this._readingCustomCssSaveTimer = null;
        }
        // Remove any orphaned body-portal popovers created by
        // _addSimpleSelect / _addSearchablePopover.
        document.body
            .querySelectorAll(":scope > .learnkit > .learnkit-popover-overlay")
            .forEach((el) => { var _a; return (_a = el.parentElement) === null || _a === void 0 ? void 0 : _a.remove(); });
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
            const wrapper = containerEl.createDiv({ cls: "learnkit-settings-wrapper learnkit-settings-wrapper learnkit-settings learnkit-settings" });
            new Setting(wrapper).setName(this._tx("ui.settings.sections.learnkit", "Learn" + "Kit")).setHeading();
            const desc = wrapper.createDiv({ cls: "setting-item" });
            const info = desc.createDiv({ cls: "setting-item-info" });
            info.createDiv({
                cls: "setting-item-description",
                text: this._tx("ui.settings.redirect.description", "Learn" + "Kit settings live inside the plugin. Click the button below to open them."),
            });
            new Setting(wrapper)
                .addButton((b) => b.setButtonText(this._tx("ui.settings.redirect.openButton", "Open settings")).setCta().onClick(() => {
                var _a, _b, _c, _d;
                // Close the Obsidian settings modal
                (_b = (_a = this.app.setting) === null || _a === void 0 ? void 0 : _a.close) === null || _b === void 0 ? void 0 : _b.call(_a);
                // Open the in-plugin settings view
                void ((_d = (_c = this.plugin).openSettingsTab) === null || _d === void 0 ? void 0 : _d.call(_c, false, "settings"));
            }));
            return;
        }
        // Create a wrapper for all settings (everything should render inside this)
        const wrapper = containerEl.createDiv({ cls: "learnkit-settings-wrapper learnkit-settings-wrapper learnkit-settings learnkit-settings" });
        // ── General ──
        this.renderAppearanceSection(wrapper);
        this.renderReadingViewSection(wrapper);
        // ── Audio ──
        this.renderAudioSection(wrapper);
        // ── Companion ──
        this.renderStudyAssistantSection(wrapper);
        // ── Data & Maintenance ──
        this.renderStorageSection(wrapper);
        // ── Flashcards ──
        this.renderCardsSection(wrapper);
        this.renderSyncSection(wrapper);
        // ── Notes ──
        this.renderNoteReviewSection(wrapper);
        // ── Reminders (rendered inside renderStudySection) ──
        // ── Studying ──
        this.renderStudySection(wrapper);
        this.renderSchedulingSection(wrapper);
        // ── Reset ──
        this.renderResetSection(wrapper);
        this._styleSettingsButtons(wrapper);
    }
    renderAppearanceSection(wrapper) {
        var _a, _b;
        // Theme title above user details
        new Setting(wrapper).setName(this._tx("ui.settings.sections.theme", "Theme")).setHeading();
        const resolveThemeAccentHex = () => {
            var _a, _b, _c;
            const toHexFromRgb = (input) => {
                const channels = input.match(/\d+(?:\.\d+)?/g);
                if (!channels || channels.length < 3)
                    return null;
                const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
                const r = Number(channels[0]);
                const g = Number(channels[1]);
                const b = Number(channels[2]);
                if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b))
                    return null;
                return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            };
            const normaliseCssColorToHex = (input) => {
                const val = String(input !== null && input !== void 0 ? input : "").trim();
                if (!val)
                    return null;
                if (/^#[0-9a-f]{6}$/i.test(val))
                    return val;
                if (/^#[0-9a-f]{3}$/i.test(val)) {
                    const hex = val.slice(1);
                    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
                }
                const probe = document.createElement("span");
                setCssProps(probe, "color", "");
                setCssProps(probe, "color", val);
                if (!probe.style.color)
                    return null;
                setCssProps(probe, "position", "absolute");
                setCssProps(probe, "left", "-9999px");
                document.body.appendChild(probe);
                const resolved = getComputedStyle(probe).color.trim();
                probe.remove();
                return toHexFromRgb(resolved);
            };
            const override = String((_c = (_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.themeAccentOverride) !== null && _c !== void 0 ? _c : "").trim();
            const bodyStyle = getComputedStyle(document.body);
            const raw = override ||
                bodyStyle.getPropertyValue("--theme-accent").trim() ||
                bodyStyle.getPropertyValue("--interactive-accent").trim() ||
                bodyStyle.getPropertyValue("--color-accent").trim();
            const resolved = normaliseCssColorToHex(raw);
            if (resolved)
                return resolved;
            return "#7f8c8d";
        };
        new Setting(wrapper)
            .setName(this._tx("ui.settings.appearance.theme.name", "Theme preset"))
            .setDesc(this._tx("ui.settings.appearance.theme.desc", "Choose the visual theme preset."))
            .then((s) => {
            var _a;
            const preset = (_a = this.plugin.settings.general.themePreset) !== null && _a !== void 0 ? _a : "glass";
            this._addSimpleSelect(s.controlEl, {
                options: [
                    {
                        value: "glass",
                        label: this._tx("ui.settings.appearance.theme.option.glass", "Glass"),
                    },
                ],
                value: preset,
                onChange: (value) => {
                    void (async () => {
                        this.plugin.settings.general.themePreset = value === "glass" ? "glass" : "glass";
                        await this.plugin.saveAll();
                    })();
                },
            });
        });
        const currentAccent = resolveThemeAccentHex();
        let setAccentPickerValue = null;
        new Setting(wrapper)
            .setName(this._tx("ui.settings.appearance.themeAccent.name", "Accent colour"))
            .setDesc(this._tx("ui.settings.appearance.themeAccent.desc", "Choose a custom accent colour. Reset to inherit from your active " + "Obsidian" + " theme."))
            .addColorPicker((picker) => {
            picker.setValue(currentAccent);
            setAccentPickerValue = (hex) => {
                picker.setValue(hex);
            };
            picker.onChange(async (value) => {
                const next = String(value !== null && value !== void 0 ? value : "").trim();
                this.plugin.settings.general.themeAccentOverride = next;
                document.body.style.setProperty("--learnkit-theme-accent-override", next);
                await this.plugin.saveAll();
            });
        })
            .addExtraButton((btn) => {
            btn
                .setIcon("reset")
                .setTooltip(this._tx("ui.settings.appearance.themeAccent.reset", "Reset to inherited theme accent"))
                .onClick(async () => {
                this.plugin.settings.general.themeAccentOverride = "";
                document.body.style.removeProperty("--learnkit-theme-accent-override");
                setAccentPickerValue === null || setAccentPickerValue === void 0 ? void 0 : setAccentPickerValue(resolveThemeAccentHex());
                await this.plugin.saveAll();
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.appearance.enableAnimations.name", "Animations"))
            .setDesc(this._tx("ui.settings.appearance.enableAnimations.desc", "Enable transitions and animations across the interface."))
            .addToggle((t) => {
            var _a, _b, _c;
            return t.setValue((_c = (_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.enableAnimations) !== null && _c !== void 0 ? _c : true).onChange(async (v) => {
                if (!this.plugin.settings.general)
                    this.plugin.settings.general = {};
                this.plugin.settings.general.enableAnimations = v;
                await this.plugin.saveAll();
                this.queueSettingsNotice("general.enableAnimations", this._noticeLines.animations(v));
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.appearance.showGreeting.name", "Home greeting"))
            .setDesc(this._tx("ui.settings.appearance.showGreeting.desc", "Display a personalised greeting on the home page."))
            .addToggle((t) => {
            t.setValue(this.plugin.settings.general.showGreeting !== false);
            t.onChange(async (v) => {
                this.plugin.settings.general.showGreeting = !!v;
                await this.plugin.saveAll();
                this.queueSettingsNotice("general.showGreeting", this._noticeLines.greetingText(v));
            });
        });
        new Setting(wrapper).setName(this._tx("ui.settings.sections.userDetails", "User Details")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.appearance.userName.name", "Name"))
            .setDesc(this._tx("ui.settings.appearance.userName.desc", "Set your display name."))
            .addText((t) => {
            var _a;
            t.setPlaceholder(this._tx("ui.settings.appearance.userName.placeholder", "Your name"));
            t.setValue(String((_a = this.plugin.settings.general.userName) !== null && _a !== void 0 ? _a : ""));
            t.onChange(async (v) => {
                const next = v.trim();
                this.plugin.settings.general.userName = next;
                await this.plugin.saveAll();
                this.queueSettingsNotice("general.userName", this._noticeLines.userName(next));
            });
        });
        new Setting(wrapper).setName(this._tx("ui.settings.sections.language", "Language")).setHeading();
        const localeOptions = getSupportedInterfaceLocales().map((locale) => ({
            value: locale.code,
            label: locale.label,
            description: locale.nativeLabel,
            flagCode: locale.flagCode,
        }));
        const currentLocale = resolveInterfaceLocale((_b = (_a = this.plugin.settings) === null || _a === void 0 ? void 0 : _a.general) === null || _b === void 0 ? void 0 : _b.interfaceLanguage);
        this._addSearchablePopover(wrapper, {
            name: t(currentLocale, "settings.general.interfaceLanguage.name", "Language"),
            description: t(currentLocale, "settings.general.interfaceLanguage.desc", "Set the language used across the interface."),
            options: localeOptions,
            value: currentLocale,
            onChange: (value) => {
                void (async () => {
                    const next = resolveInterfaceLocale(value);
                    if (!this.plugin.settings.general)
                        this.plugin.settings.general = {};
                    this.plugin.settings.general.interfaceLanguage = next;
                    await this.plugin.saveAll();
                    const selectedLabel = getInterfaceLocaleLabel(next);
                    this.queueSettingsNotice("general.interfaceLanguage", this._noticeLines.interfaceLanguage(selectedLabel));
                })();
            },
        });
        new Setting(wrapper)
            .setName(t(currentLocale, "settings.general.translationHelp.name", "Help translate"))
            .setDesc(t(currentLocale, "settings.general.translationHelp.desc", "Translations are community-contributed. Help add a language or improve existing wording."))
            .addButton((b) => b
            .setButtonText(t(currentLocale, "settings.general.translationHelp.cta", "Contribute translations"))
            .setCta()
            .onClick(() => {
            window.open(LearnKitSettingsTab.TRANSLATIONS_GUIDE_URL, "_blank", "noopener,noreferrer");
        }));
    }
    renderAudioSection(wrapper) {
        var _a, _b, _c, _d;
        // ----------------------------
        // Audio
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.textToSpeech", "Text to speech")).setHeading();
        {
            const descItem = wrapper.createDiv({ cls: "setting-item" });
            const descInfo = descItem.createDiv({ cls: "setting-item-info" });
            descInfo.createDiv({
                cls: "setting-item-description",
                text: this._tx("ui.settings.audio.description", "Read flashcard content aloud using built-in text-to-speech. " +
                    "Non-Latin scripts are auto-detected and matched to the best available voice. " +
                    "Latin-script text uses your default voice."),
            });
        }
        const audio = this.plugin.settings.audio;
        new Setting(wrapper)
            .setName(this._tx("ui.settings.audio.enabled.name", "Text to speech"))
            .setDesc(this._tx("ui.settings.audio.enabled.desc", "Read flashcard content aloud during study. Respects the group filter when set."))
            .addToggle((t) => {
            t.setValue(audio.enabled);
            t.onChange(async (v) => {
                this.plugin.settings.audio.enabled = v;
                await this.plugin.saveAll();
                audioDetailsContainer.hidden = !v;
                this.queueSettingsNotice("audio.enabled", this._noticeLines.ttsEnabled(v));
            });
        });
        const audioDetailsContainer = wrapper.createDiv({ cls: "learnkit-audio-details learnkit-audio-details" });
        audioDetailsContainer.hidden = !audio.enabled;
        {
            const detailsWrapper = audioDetailsContainer;
            (_a = audio.scriptLanguages) !== null && _a !== void 0 ? _a : (audio.scriptLanguages = {
                cyrillic: "ru-RU",
                arabic: "ar-SA",
                cjk: "zh-CN",
                devanagari: "hi-IN",
            });
            if (typeof audio.useFlagsForVoiceSelection !== "boolean") {
                audio.useFlagsForVoiceSelection = true;
            }
            if (typeof audio.speakFlagLanguageLabel !== "boolean") {
                audio.speakFlagLanguageLabel = false;
            }
            new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.audioOptions", "Audio options")).setHeading();
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.limitToGroup.name", "Limit to group"))
                .setDesc(this._tx("ui.settings.audio.limitToGroup.desc", "Limit read-aloud to one group. Leave blank to include every card."))
                .addText((t) => {
                t.setPlaceholder(this._tx("ui.settings.audio.limitToGroup.placeholder", "Example: tts"));
                t.setValue(audio.limitToGroup || "");
                t.onChange(async (v) => {
                    this.plugin.settings.audio.limitToGroup = v.trim();
                    await this.plugin.saveAll();
                });
            });
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.autoplay.name", "Autoplay"))
                .setDesc(this._tx("ui.settings.audio.autoplay.desc", "Read the question when a card appears, then the answer when revealed."))
                .addToggle((t) => {
                var _a;
                t.setValue((_a = audio.autoplay) !== null && _a !== void 0 ? _a : true);
                t.onChange(async (v) => {
                    this.plugin.settings.audio.autoplay = v;
                    await this.plugin.saveAll();
                });
            });
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.widgetReplay.name", "Widget read-aloud"))
                .setDesc(this._tx("ui.settings.audio.widgetReplay.desc", "Read card content aloud in the sidebar widget and show replay buttons."))
                .addToggle((t) => {
                t.setValue(audio.widgetReplay !== false);
                t.onChange(async (v) => {
                    this.plugin.settings.audio.widgetReplay = v;
                    await this.plugin.saveAll();
                });
            });
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.gatekeeperReplay.name", "Gatekeeper read-aloud"))
                .setDesc(this._tx("ui.settings.audio.gatekeeperReplay.desc", "Read gatekeeper content aloud and show replay buttons."))
                .addToggle((t) => {
                t.setValue(audio.gatekeeperReplay === true);
                t.onChange(async (v) => {
                    this.plugin.settings.audio.gatekeeperReplay = v;
                    await this.plugin.saveAll();
                });
            });
            this._addSearchablePopover(detailsWrapper, {
                name: this._tx("ui.settings.audio.clozeAnswerMode.name", "Cloze read mode"),
                description: this._tx("ui.settings.audio.clozeAnswerMode.desc", "Just the answer reads the cloze deletion only. " +
                    "Full sentence reads the complete sentence with the answer filled in."),
                options: [
                    { value: "cloze-only", label: this._tx("ui.settings.audio.clozeAnswerMode.option.clozeOnly", "Just the answer") },
                    { value: "full-sentence", label: this._tx("ui.settings.audio.clozeAnswerMode.option.fullSentence", "Full sentence") },
                ],
                value: audio.clozeAnswerMode || "cloze-only",
                onChange: (v) => {
                    void (async () => {
                        this.plugin.settings.audio.clozeAnswerMode = v;
                        await this.plugin.saveAll();
                    })();
                },
            });
            new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.flagAwareRouting", "Flag-aware routing")).setHeading();
            const flagsRoutingSetting = new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.flagRouting.useFlags.name", "Use flags for language and accent"))
                .setDesc(this._tx("ui.settings.audio.flagRouting.useFlags.desc", "Let flags control language/accent during playback."))
                .addToggle((t) => {
                t.setValue(Boolean(audio.useFlagsForVoiceSelection));
                t.onChange(async (v) => {
                    this.plugin.settings.audio.useFlagsForVoiceSelection = v;
                    await this.plugin.saveAll();
                });
            });
            flagsRoutingSetting.descEl.appendText(" ");
            const flagsGuideLink = flagsRoutingSetting.descEl.createEl("a", {
                text: this._tx("ui.settings.audio.flagRouting.guide.link", "Click here"),
                href: "#",
            });
            flagsGuideLink.onclick = (evt) => {
                evt.preventDefault();
                void this.app.workspace.openLinkText("Flags", "", false);
            };
            flagsRoutingSetting.descEl.appendText(" " + this._tx("ui.settings.audio.flagRouting.guide.trailing", "for a guide on using flags."));
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.flagRouting.speakLabel.name", "Announce language name"))
                .setDesc(this._tx("ui.settings.audio.flagRouting.speakLabel.desc", "Say the language name before each flag-switched segment."))
                .addToggle((t) => {
                t.setValue(Boolean(audio.speakFlagLanguageLabel));
                t.onChange(async (v) => {
                    this.plugin.settings.audio.speakFlagLanguageLabel = v;
                    await this.plugin.saveAll();
                });
            });
            new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.voiceAndAccent", "Voice and accent")).setHeading();
            const langOptions = getLanguageOptions();
            this._addSearchablePopover(detailsWrapper, {
                name: this._tx("ui.settings.audio.defaultVoice.name", "Default voice"),
                description: this._tx("ui.settings.audio.defaultVoice.desc", "Set the accent and dialect for Latin-script text. " +
                    "Also determines the word for blank on cloze fronts."),
                options: langOptions.map((o) => ({ value: o.value, label: o.label, flagCode: o.flagCode })),
                value: audio.defaultLanguage || "en-US",
                onChange: (v) => {
                    void (async () => {
                        this.plugin.settings.audio.defaultLanguage = v;
                        await this.plugin.saveAll();
                    })();
                },
            });
            {
                const advancedItem = detailsWrapper.createDiv({ cls: "setting-item learnkit-settings-advanced-row learnkit-settings-advanced-row" });
                const advancedInfo = advancedItem.createDiv({ cls: "setting-item-info" });
                advancedInfo.createDiv({
                    cls: "setting-item-name",
                    text: this._audioAdvancedOptionsExpanded
                        ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
                        : this._tx("ui.settings.audio.advanced.show", "Show advanced options"),
                });
                advancedInfo.createDiv({
                    cls: "setting-item-description",
                    text: this._tx("ui.settings.audio.advanced.description", "Choose language defaults for non-Latin scripts when script detection is ambiguous."),
                });
                const advancedControl = advancedItem.createDiv({ cls: "setting-item-control" });
                const advancedToggle = advancedControl.createEl("button", {
                    cls: "inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-settings-action-btn learnkit-settings-action-btn learnkit-settings-advanced-toggle learnkit-settings-advanced-toggle",
                });
                advancedToggle.type = "button";
                advancedToggle.setAttribute("aria-label", this._audioAdvancedOptionsExpanded
                    ? this._tx("ui.settings.audio.advanced.tooltipHide", "Hide advanced voice options")
                    : this._tx("ui.settings.audio.advanced.tooltipShow", "Show advanced voice options"));
                advancedToggle.setAttribute("data-tooltip-position", "top");
                advancedToggle.setAttribute("aria-expanded", this._audioAdvancedOptionsExpanded ? "true" : "false");
                const advancedToggleLabel = advancedToggle.createSpan({
                    text: this._audioAdvancedOptionsExpanded
                        ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
                        : this._tx("ui.settings.audio.advanced.show", "Show advanced options"),
                });
                const advancedChevron = advancedToggle.createSpan({ cls: "learnkit-settings-advanced-chevron learnkit-settings-advanced-chevron" });
                setIcon(advancedChevron, "chevron-down");
                advancedChevron.classList.toggle("is-expanded", this._audioAdvancedOptionsExpanded);
                const advancedContent = detailsWrapper.createDiv({ cls: "learnkit-settings-advanced-content learnkit-settings-advanced-content" });
                advancedContent.hidden = !this._audioAdvancedOptionsExpanded;
                for (const group of getScriptLanguageGroups()) {
                    this._addSearchablePopover(advancedContent, {
                        name: group.label,
                        description: group.description,
                        options: group.languages.map((o) => ({ value: o.value, label: o.label, flagCode: o.flagCode })),
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
                    advancedInfo.querySelector(".setting-item-name").textContent =
                        expanded
                            ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
                            : this._tx("ui.settings.audio.advanced.show", "Show advanced options");
                    advancedToggleLabel.textContent = expanded
                        ? this._tx("ui.settings.audio.advanced.hide", "Hide advanced options")
                        : this._tx("ui.settings.audio.advanced.show", "Show advanced options");
                    advancedToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
                    advancedToggle.setAttribute("aria-label", expanded
                        ? this._tx("ui.settings.audio.advanced.tooltipHide", "Hide advanced voice options")
                        : this._tx("ui.settings.audio.advanced.tooltipShow", "Show advanced voice options"));
                    advancedChevron.classList.toggle("is-expanded", expanded);
                };
            }
            new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.voiceTuning", "Voice tuning")).setHeading();
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.rate.name", "Speech rate"))
                .setDesc(this._tx("ui.settings.audio.rate.desc", "Adjust how fast the voice speaks."))
                .addSlider((s) => {
                var _a;
                s.setLimits(0.5, 2.0, 0.1);
                s.setValue((_a = audio.rate) !== null && _a !== void 0 ? _a : 1.0);
                s.setDynamicTooltip();
                s.onChange(async (v) => {
                    this.plugin.settings.audio.rate = v;
                    await this.plugin.saveAll();
                });
            });
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.pitch.name", "Speech pitch"))
                .setDesc(this._tx("ui.settings.audio.pitch.desc", "Adjust voice pitch."))
                .addSlider((s) => {
                var _a;
                s.setLimits(0.5, 2.0, 0.1);
                s.setValue((_a = audio.pitch) !== null && _a !== void 0 ? _a : 1.0);
                s.setDynamicTooltip();
                s.onChange(async (v) => {
                    this.plugin.settings.audio.pitch = v;
                    await this.plugin.saveAll();
                });
            });
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.testVoice.name", "Preview voice"))
                .setDesc(this._tx("ui.settings.audio.testVoice.desc", "Play a sample to hear the current voice settings."))
                .addButton((btn) => {
                btn.setButtonText(this._tx("ui.settings.audio.testVoice.playButton", "Play sample"));
                btn.onClick(() => {
                    var _a, _b;
                    const tts = getTtsService();
                    if (!tts.isSupported) {
                        new Notice(this._noticeLines.ttsNotSupported);
                        return;
                    }
                    const sampleLang = audio.defaultLanguage || "en-US";
                    const primary = sampleLang.split("-")[0];
                    const samples = {
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
                    const sample = (_b = (_a = samples[primary]) !== null && _a !== void 0 ? _a : samples["en"]) !== null && _b !== void 0 ? _b : "This is a sample of the text-to-speech voice.";
                    tts.speak(sample, sampleLang, audio, false, true);
                });
            });
            const voices = getAvailableVoices();
            if (voices.length === 0) {
                new Setting(detailsWrapper)
                    .setName(this._tx("ui.settings.audio.availableVoices.name", "Available system voices"))
                    .setDesc(this._tx("ui.settings.audio.availableVoices.desc", "No system voices detected yet. Voices load asynchronously, so try reopening this tab. " +
                    "If it is still empty, check your operating system's speech settings."));
            }
            // ── External TTS ──
            new Setting(detailsWrapper).setName(this._tx("ui.settings.sections.ttsProvider", "External TTS")).setHeading();
            const isExternalTts = ((_b = audio.ttsProvider) !== null && _b !== void 0 ? _b : "browser") !== "browser";
            const ttsExternalContainer = detailsWrapper.createDiv({ cls: "learnkit-tts-external-settings" });
            ttsExternalContainer.hidden = !isExternalTts;
            new Setting(detailsWrapper)
                .setName(this._tx("ui.settings.audio.ttsExternal.name", "Enable external TTS"))
                .setDesc(this._tx("ui.settings.audio.ttsExternal.desc", "Use a cloud TTS provider (ElevenLabs, OpenAI, Google Cloud, or a custom endpoint) instead of the built-in system voice."))
                .addToggle((t) => {
                t.setValue(isExternalTts);
                t.onChange(async (v) => {
                    if (!v) {
                        this.plugin.settings.audio.ttsProvider = "browser";
                    }
                    else {
                        const last = this.plugin.settings.audio.ttsProvider;
                        if (!last || last === "browser") {
                            this.plugin.settings.audio.ttsProvider = "openai";
                        }
                    }
                    await this.plugin.saveAll();
                    this._softRerender();
                });
            });
            // Move external container after the toggle
            detailsWrapper.appendChild(ttsExternalContainer);
            if (isExternalTts) {
                const ttsProviderStandard = [
                    { value: "elevenlabs", label: this._tx("ui.settings.audio.ttsProvider.elevenlabs", "ElevenLabs") },
                    { value: "google-cloud", label: this._tx("ui.settings.audio.ttsProvider.googleCloud", "Google Cloud") },
                    { value: "openai", label: this._tx("ui.settings.audio.ttsProvider.openai", "OpenAI") },
                ];
                const ttsProviderOptions = [
                    ...ttsProviderStandard,
                    { value: "custom", label: this._tx("ui.settings.audio.ttsProvider.custom", "Custom") },
                ];
                new Setting(ttsExternalContainer)
                    .setName(this._tx("ui.settings.audio.ttsProvider.name", "Provider"))
                    .setDesc(this._tx("ui.settings.audio.ttsProvider.desc", "Choose which cloud TTS provider to use."))
                    .then((setting) => {
                    var _a;
                    this._addSimpleSelect(setting.controlEl, {
                        options: ttsProviderOptions,
                        value: (_a = audio.ttsProvider) !== null && _a !== void 0 ? _a : "openai",
                        separatorAfterIndex: ttsProviderStandard.length - 1,
                        onChange: (v) => {
                            void (async () => {
                                this.plugin.settings.audio.ttsProvider = v;
                                await this.plugin.saveAll();
                                this._softRerender();
                            })();
                        },
                    });
                });
                const providerLabel = audio.ttsProvider === "elevenlabs" ? "ElevenLabs"
                    : audio.ttsProvider === "openai" ? "OpenAI"
                        : audio.ttsProvider === "google-cloud" ? "Google Cloud"
                            : "Custom";
                new Setting(ttsExternalContainer)
                    .setName(this._tx("ui.settings.audio.ttsApiKey.name", `${providerLabel} API key`))
                    .setDesc(this._tx("ui.settings.audio.ttsApiKey.desc", "API key for the selected TTS provider. Stored locally in a dedicated file, never synced."))
                    .addText((t) => {
                    var _a, _b, _c;
                    t.inputEl.type = "password";
                    t.inputEl.autocomplete = "off";
                    const currentProvider = (_a = audio.ttsProvider) !== null && _a !== void 0 ? _a : "browser";
                    const currentKey = currentProvider !== "browser"
                        ? ((_c = (_b = audio.ttsApiKeys) === null || _b === void 0 ? void 0 : _b[currentProvider]) !== null && _c !== void 0 ? _c : "")
                        : "";
                    t.setValue(currentKey);
                    t.setPlaceholder(audio.ttsProvider === "openai" ? "sk-..."
                        : audio.ttsProvider === "elevenlabs" ? "xi-..."
                            : "");
                    t.onChange(async (v) => {
                        var _a;
                        var _b;
                        const p = this.plugin.settings.audio.ttsProvider;
                        if (p && p !== "browser") {
                            (_a = (_b = this.plugin.settings.audio).ttsApiKeys) !== null && _a !== void 0 ? _a : (_b.ttsApiKeys = { elevenlabs: "", openai: "", "google-cloud": "", custom: "" });
                            this.plugin.settings.audio.ttsApiKeys[p] = v.trim();
                        }
                        await this.plugin.saveAll();
                    });
                });
                new Setting(ttsExternalContainer)
                    .setName(this._tx("ui.settings.audio.ttsVoiceId.name", "Voice"))
                    .setDesc(this._tx("ui.settings.audio.ttsVoiceId.desc", "Provider-specific voice identifier."))
                    .addText((t) => {
                    var _a;
                    t.setValue((_a = audio.ttsVoiceId) !== null && _a !== void 0 ? _a : "");
                    const placeholder = audio.ttsProvider === "elevenlabs" ? "21m00Tcm4TlvDq8ikWAM"
                        : audio.ttsProvider === "openai" ? "alloy"
                            : "";
                    t.setPlaceholder(placeholder);
                    t.onChange(async (v) => {
                        this.plugin.settings.audio.ttsVoiceId = v.trim();
                        await this.plugin.saveAll();
                    });
                });
                // Replace the Setting element with a searchable popover when the
                // provider has known voices; keep the text input for custom.
                if (audio.ttsProvider !== "custom") {
                    const ttsVoiceOptions = audio.ttsProvider === "openai" ? [
                        { value: "alloy", label: "Alloy" },
                        { value: "ash", label: "Ash" },
                        { value: "ballad", label: "Ballad" },
                        { value: "coral", label: "Coral" },
                        { value: "echo", label: "Echo" },
                        { value: "fable", label: "Fable" },
                        { value: "nova", label: "Nova" },
                        { value: "onyx", label: "Onyx" },
                        { value: "sage", label: "Sage" },
                        { value: "shimmer", label: "Shimmer" },
                    ]
                        : audio.ttsProvider === "elevenlabs" ? [
                            { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel", description: "Calm, narration" },
                            { value: "AZnzlk1XvdvUeBnXmlld", label: "Domi", description: "Confident, authoritative" },
                            { value: "EXAVITQu4vr4xnSDxMaL", label: "Bella", description: "Soft, warm" },
                            { value: "ErXwobaYiN019PkySvjV", label: "Antoni", description: "Well-rounded, expressive" },
                            { value: "MF3mGyEYCl7XYWbV9V6O", label: "Elli", description: "Young, friendly" },
                            { value: "TxGEqnHWrfWFTfGW9XjX", label: "Josh", description: "Deep, narrative" },
                            { value: "VR6AewLTigWG4xSOukaG", label: "Arnold", description: "Strong, authoritative" },
                            { value: "pNInz6obpgDQGcFmaJgB", label: "Adam", description: "Deep, clear" },
                            { value: "yoZ06aMxZJJ28mfd3POQ", label: "Sam", description: "Raspy, engaging" },
                            { value: "jBpfuIE2acCO8z3wKNLl", label: "Gigi", description: "Childlike, animated" },
                            { value: "onwK4e9ZLuTAKqWW03F9", label: "Daniel", description: "Authoritative, British" },
                            { value: "XB0fDUnXU5powFXDhCwa", label: "Charlotte", description: "Natural, warm" },
                        ]
                            : audio.ttsProvider === "google-cloud" ? [
                                { value: "en-US-Neural2-A", label: "Neural2-A", description: "Female (US English)" },
                                { value: "en-US-Neural2-C", label: "Neural2-C", description: "Female (US English)" },
                                { value: "en-US-Neural2-D", label: "Neural2-D", description: "Male (US English)" },
                                { value: "en-US-Neural2-F", label: "Neural2-F", description: "Female (US English)" },
                                { value: "en-US-Neural2-I", label: "Neural2-I", description: "Male (US English)" },
                                { value: "en-US-Neural2-J", label: "Neural2-J", description: "Male (US English)" },
                                { value: "en-US-Studio-O", label: "Studio-O", description: "Female (US English)" },
                                { value: "en-US-Studio-Q", label: "Studio-Q", description: "Male (US English)" },
                                { value: "en-US-Wavenet-A", label: "Wavenet-A", description: "Male (US English)" },
                                { value: "en-US-Wavenet-C", label: "Wavenet-C", description: "Female (US English)" },
                                { value: "en-US-Wavenet-D", label: "Wavenet-D", description: "Male (US English)" },
                                { value: "en-US-Wavenet-F", label: "Wavenet-F", description: "Female (US English)" },
                            ]
                                : [];
                    if (ttsVoiceOptions.length > 0) {
                        const currentVoice = String(audio.ttsVoiceId || "").trim();
                        const voiceOptions = [...ttsVoiceOptions];
                        if (currentVoice && !ttsVoiceOptions.some((o) => o.value === currentVoice)) {
                            voiceOptions.push({ value: currentVoice, label: `${currentVoice} (custom)` });
                        }
                        // Remove the text-input Setting we just created and replace with popover
                        const voiceAnchor = ttsExternalContainer.lastElementChild;
                        this._addSearchablePopover(ttsExternalContainer, {
                            name: this._tx("ui.settings.audio.ttsVoiceId.name", "Voice"),
                            description: this._tx("ui.settings.audio.ttsVoiceId.desc", "Provider-specific voice identifier."),
                            options: voiceOptions,
                            value: currentVoice || ((_c = voiceOptions[0]) === null || _c === void 0 ? void 0 : _c.value) || "",
                            onChange: (v) => {
                                void (async () => {
                                    this.plugin.settings.audio.ttsVoiceId = v.trim();
                                    await this.plugin.saveAll();
                                })();
                            },
                        });
                        const insertedVoice = ttsExternalContainer.lastElementChild;
                        if (voiceAnchor && insertedVoice && insertedVoice !== voiceAnchor) {
                            ttsExternalContainer.insertBefore(insertedVoice, voiceAnchor.nextSibling);
                        }
                        voiceAnchor === null || voiceAnchor === void 0 ? void 0 : voiceAnchor.remove();
                    }
                }
                new Setting(ttsExternalContainer)
                    .setName(this._tx("ui.settings.audio.ttsModel.name", "Model"))
                    .setDesc(this._tx("ui.settings.audio.ttsModel.desc", "Provider-specific model identifier."))
                    .addText((t) => {
                    var _a;
                    t.setValue((_a = audio.ttsModel) !== null && _a !== void 0 ? _a : "");
                    const placeholder = audio.ttsProvider === "elevenlabs" ? "eleven_multilingual_v2"
                        : audio.ttsProvider === "openai" ? "gpt-4o-mini-tts"
                            : "";
                    t.setPlaceholder(placeholder);
                    t.onChange(async (v) => {
                        this.plugin.settings.audio.ttsModel = v.trim();
                        await this.plugin.saveAll();
                    });
                });
                // Replace the Setting element with a searchable popover when the
                // provider has known models; keep the text input for custom.
                if (audio.ttsProvider !== "custom") {
                    const ttsModelOptions = audio.ttsProvider === "openai" ? [
                        { value: "gpt-4o-mini-tts", label: "GPT-4o Mini TTS", description: "Expressive, steerable, multilingual" },
                    ]
                        : audio.ttsProvider === "elevenlabs" ? [
                            { value: "eleven_multilingual_v2", label: "Multilingual v2", description: "29 languages" },
                            { value: "eleven_turbo_v2_5", label: "Turbo v2.5", description: "Low-latency, 32 languages" },
                        ]
                            : audio.ttsProvider === "google-cloud" ? [
                                { value: "default", label: "Default", description: "Uses the voice's native model" },
                            ]
                                : [];
                    if (ttsModelOptions.length > 0) {
                        const currentModel = String(audio.ttsModel || "").trim();
                        const modelOptions = [...ttsModelOptions];
                        if (currentModel && !ttsModelOptions.some((o) => o.value === currentModel)) {
                            modelOptions.push({ value: currentModel, label: `${currentModel} (custom)` });
                        }
                        // Remove the text-input Setting we just created and replace with popover
                        const modelAnchor = ttsExternalContainer.lastElementChild;
                        this._addSearchablePopover(ttsExternalContainer, {
                            name: this._tx("ui.settings.audio.ttsModel.name", "Model"),
                            description: this._tx("ui.settings.audio.ttsModel.desc", "Provider-specific model identifier."),
                            options: modelOptions,
                            value: currentModel || ((_d = modelOptions[0]) === null || _d === void 0 ? void 0 : _d.value) || "",
                            onChange: (v) => {
                                void (async () => {
                                    this.plugin.settings.audio.ttsModel = v.trim();
                                    await this.plugin.saveAll();
                                })();
                            },
                        });
                        const insertedModel = ttsExternalContainer.lastElementChild;
                        if (modelAnchor && insertedModel && insertedModel !== modelAnchor) {
                            ttsExternalContainer.insertBefore(insertedModel, modelAnchor.nextSibling);
                        }
                        modelAnchor === null || modelAnchor === void 0 ? void 0 : modelAnchor.remove();
                    }
                }
                if (audio.ttsProvider === "custom") {
                    new Setting(ttsExternalContainer)
                        .setName(this._tx("ui.settings.audio.ttsEndpoint.name", "Endpoint URL"))
                        .setDesc(this._tx("ui.settings.audio.ttsEndpoint.desc", "Base URL for the custom TTS endpoint."))
                        .addText((t) => {
                        var _a;
                        t.setValue((_a = audio.ttsEndpointOverride) !== null && _a !== void 0 ? _a : "");
                        t.setPlaceholder("");
                        t.onChange(async (v) => {
                            this.plugin.settings.audio.ttsEndpointOverride = v.trim();
                            await this.plugin.saveAll();
                        });
                    });
                }
                new Setting(ttsExternalContainer)
                    .setName(this._tx("ui.settings.audio.ttsCache.name", "Cache generated audio"))
                    .setDesc(this._tx("ui.settings.audio.ttsCache.desc", "Save generated audio files locally to avoid repeat API calls and reduce costs."))
                    .addToggle((t) => {
                    t.setValue(audio.ttsCacheEnabled !== false);
                    t.onChange(async (v) => {
                        this.plugin.settings.audio.ttsCacheEnabled = v;
                        await this.plugin.saveAll();
                    });
                });
                new Setting(ttsExternalContainer)
                    .setName(this._tx("ui.settings.audio.ttsClearCache.name", "Clear audio cache"))
                    .setDesc(this._tx("ui.settings.audio.ttsClearCache.desc", "Remove all cached TTS audio files."))
                    .addButton((btn) => {
                    btn.setButtonText(this._tx("ui.settings.audio.ttsClearCache.button", "Clear cache"));
                    btn.onClick(async () => {
                        const tts = getTtsService();
                        if (!tts.vaultAdapter || !tts.ttsCacheDirPath) {
                            new Notice(this._tx("ui.settings.audio.ttsClearCache.noCache", "No cache directory configured."));
                            return;
                        }
                        const removed = await clearTtsCache(tts.vaultAdapter, tts.ttsCacheDirPath);
                        if (removed >= 0) {
                            new Notice(this._tx("ui.settings.audio.ttsClearCache.done", `Cleared ${removed} cached audio file(s).`));
                        }
                        else {
                            new Notice(this._tx("ui.settings.audio.ttsClearCache.error", "Failed to clear cache."));
                        }
                    });
                });
            }
        }
    }
    renderCardsSection(wrapper) {
        var _a;
        // ----------------------------
        // Cards
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.basicCards", "Basic cards")).setHeading();
        // Basic section
        {
            const item = wrapper.createDiv({ cls: "setting-item" });
            const info = item.createDiv({ cls: "setting-item-info" });
            info.createDiv({
                cls: "setting-item-description",
                text: this._tx("ui.settings.cards.basic.empty", "No settings available yet."),
            });
        }
        // ── Cloze section ──
        new Setting(wrapper).setName(this._tx("ui.settings.sections.cloze", "Cloze")).setHeading();
        const cardsSettings = (_a = this.plugin.settings.cards) !== null && _a !== void 0 ? _a : { clozeMode: "standard", clozeBgColor: "", clozeTextColor: "" };
        if (!this.plugin.settings.cards) {
            this.plugin.settings.cards = cardsSettings;
        }
        new Setting(wrapper)
            .setName(this._tx("ui.settings.cards.cloze.mode.name", "Cloze mode"))
            .setDesc(this._tx("ui.settings.cards.cloze.mode.desc", "Set the answer mode for cloze deletions."))
            .then((s) => {
            var _a;
            this._addSimpleSelect(s.controlEl, {
                options: [
                    {
                        value: "standard",
                        label: this._tx("ui.settings.cards.cloze.mode.option.standard", "Standard"),
                    },
                    {
                        value: "typed",
                        label: this._tx("ui.settings.cards.cloze.mode.option.typed", "Typed"),
                    },
                ],
                value: (_a = cardsSettings.clozeMode) !== null && _a !== void 0 ? _a : "standard",
                onChange: (v) => {
                    void (async () => {
                        const prev = cardsSettings.clozeMode;
                        cardsSettings.clozeMode = v;
                        await this.plugin.saveAll();
                        this.refreshReviewerViewsIfPossible();
                        if (prev !== v) {
                            this.queueSettingsNotice("cards.clozeMode", this._noticeLines.clozeMode(v === "typed"));
                        }
                    })();
                },
            });
        });
        // ── Image occlusion section ──
        new Setting(wrapper).setName(this._tx("ui.settings.sections.imageOcclusion", "Image occlusion")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.cards.imageOcclusion.revealMode.name", "Reveal mode"))
            .setDesc(this._tx("ui.settings.cards.imageOcclusion.revealMode.desc", "On hide-all cards, show the target group only or all groups at once."))
            .then((s) => {
            var _a;
            this._addSimpleSelect(s.controlEl, {
                options: [
                    {
                        value: "group",
                        label: this._tx("ui.settings.cards.imageOcclusion.revealMode.option.group", "Reveal group"),
                    },
                    {
                        value: "all",
                        label: this._tx("ui.settings.cards.imageOcclusion.revealMode.option.all", "Reveal all"),
                    },
                ],
                value: ((_a = this.plugin.settings.imageOcclusion) === null || _a === void 0 ? void 0 : _a.revealMode) || "group",
                onChange: (val) => {
                    void (async () => {
                        if (val === "group" || val === "all") {
                            this.plugin.settings.imageOcclusion.revealMode = val;
                            await this.plugin.saveAll();
                            this.refreshReviewerViewsIfPossible();
                            this.refreshAllWidgetViews();
                            this.queueSettingsNotice("io-reveal-mode", this._noticeLines.ioRevealMode(val === "group"));
                        }
                    })();
                },
            });
        });
        // Multiple choice section
        new Setting(wrapper).setName(this._tx("ui.settings.sections.multipleChoice", "Multiple choice")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.cards.multipleChoice.shuffle.name", "Shuffle order"))
            .setDesc(this._tx("ui.settings.cards.multipleChoice.shuffle.desc", "Shuffle answer order in multiple-choice and multi-select questions."))
            .addToggle((t) => {
            const cur = !!this.plugin.settings.study.randomizeMcqOptions;
            t.setValue(cur);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.study.randomizeMcqOptions;
                this.plugin.settings.study.randomizeMcqOptions = v;
                await this.plugin.saveAll();
                this.refreshReviewerViewsIfPossible();
                if (prev !== v) {
                    this.queueSettingsNotice("study.randomizeMcqOptions", this._noticeLines.randomizeMcqOptions(v));
                }
            });
        });
        // Ordered questions section
        new Setting(wrapper).setName(this._tx("ui.settings.sections.orderedQuestions", "Ordered questions")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.cards.orderedQuestions.shuffle.name", "Shuffle order"))
            .setDesc(this._tx("ui.settings.cards.orderedQuestions.shuffle.desc", "Shuffle step order each time the question appears."))
            .addToggle((t) => {
            var _a;
            const cur = (_a = this.plugin.settings.study.randomizeOqOrder) !== null && _a !== void 0 ? _a : true;
            t.setValue(cur);
            t.onChange(async (v) => {
                var _a;
                const prev = (_a = this.plugin.settings.study.randomizeOqOrder) !== null && _a !== void 0 ? _a : true;
                this.plugin.settings.study.randomizeOqOrder = v;
                await this.plugin.saveAll();
                this.refreshReviewerViewsIfPossible();
                if (prev !== v) {
                    this.queueSettingsNotice("study.randomizeOqOrder", this._noticeLines.randomizeOqOrder(v));
                }
            });
        });
    }
    renderReadingViewSection(wrapper) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        var _l, _m, _o, _p, _q, _r, _s;
        // ----------------------------
        // Reading
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.readingView", "Reading view")).setHeading();
        const rv = (_a = this.plugin.settings.readingView) !== null && _a !== void 0 ? _a : clonePlain(DEFAULT_SETTINGS.readingView);
        if (!this.plugin.settings.readingView) {
            this.plugin.settings.readingView = rv;
        }
        const normaliseMacro = (raw) => {
            const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
            if (key === "minimal-flip")
                return "flashcards";
            if (key === "full-card")
                return "classic";
            if (key === "compact")
                return "markdown";
            if (key === "guidebook")
                return "classic";
            if (key === "flashcards" || key === "classic" || key === "markdown" || key === "custom")
                return key;
            return "flashcards";
        };
        const isMacroComingSoon = (key) => key === "classic" || key === "custom";
        rv.activeMacro = normaliseMacro((_b = rv.activeMacro) !== null && _b !== void 0 ? _b : rv.preset);
        if (isMacroComingSoon(rv.activeMacro))
            rv.activeMacro = "flashcards";
        rv.preset = rv.activeMacro;
        (_c = rv.macroConfigs) !== null && _c !== void 0 ? _c : (rv.macroConfigs = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs));
        (_d = (_l = rv.macroConfigs).flashcards) !== null && _d !== void 0 ? _d : (_l.flashcards = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.flashcards));
        (_e = (_m = rv.macroConfigs).classic) !== null && _e !== void 0 ? _e : (_m.classic = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.classic));
        (_f = (_o = rv.macroConfigs).guidebook) !== null && _f !== void 0 ? _f : (_o.guidebook = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.guidebook));
        (_g = (_p = rv.macroConfigs).markdown) !== null && _g !== void 0 ? _g : (_p.markdown = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.markdown));
        (_h = (_q = rv.macroConfigs).custom) !== null && _h !== void 0 ? _h : (_q.custom = clonePlain(DEFAULT_SETTINGS.readingView.macroConfigs.custom));
        const normaliseFields = (fields, fallback) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            return ({
                title: (_a = fields === null || fields === void 0 ? void 0 : fields.title) !== null && _a !== void 0 ? _a : fallback.title,
                question: (_b = fields === null || fields === void 0 ? void 0 : fields.question) !== null && _b !== void 0 ? _b : fallback.question,
                options: (_c = fields === null || fields === void 0 ? void 0 : fields.options) !== null && _c !== void 0 ? _c : fallback.options,
                answer: (_d = fields === null || fields === void 0 ? void 0 : fields.answer) !== null && _d !== void 0 ? _d : fallback.answer,
                info: (_e = fields === null || fields === void 0 ? void 0 : fields.info) !== null && _e !== void 0 ? _e : fallback.info,
                groups: (_f = fields === null || fields === void 0 ? void 0 : fields.groups) !== null && _f !== void 0 ? _f : fallback.groups,
                edit: (_g = fields === null || fields === void 0 ? void 0 : fields.edit) !== null && _g !== void 0 ? _g : fallback.edit,
                labels: (_h = fields === null || fields === void 0 ? void 0 : fields.labels) !== null && _h !== void 0 ? _h : fallback.labels,
                displayAudioButton: (_j = fields === null || fields === void 0 ? void 0 : fields.displayAudioButton) !== null && _j !== void 0 ? _j : fallback.displayAudioButton,
                displayEditButton: (_k = fields === null || fields === void 0 ? void 0 : fields.displayEditButton) !== null && _k !== void 0 ? _k : fallback.displayEditButton,
            });
        };
        rv.macroConfigs.flashcards.fields = normaliseFields(rv.macroConfigs.flashcards.fields, DEFAULT_SETTINGS.readingView.macroConfigs.flashcards.fields);
        rv.macroConfigs.classic.fields = normaliseFields(rv.macroConfigs.classic.fields, DEFAULT_SETTINGS.readingView.macroConfigs.classic.fields);
        rv.macroConfigs.guidebook.fields = normaliseFields(rv.macroConfigs.guidebook.fields, DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.fields);
        rv.macroConfigs.markdown.fields = normaliseFields(rv.macroConfigs.markdown.fields, DEFAULT_SETTINGS.readingView.macroConfigs.markdown.fields);
        rv.macroConfigs.markdown.fields.edit = false;
        rv.macroConfigs.markdown.fields.displayEditButton = false;
        rv.macroConfigs.custom.fields = normaliseFields(rv.macroConfigs.custom.fields, DEFAULT_SETTINGS.readingView.macroConfigs.custom.fields);
        const normaliseColours = (colours, fallback) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
            return ({
                autoDarkAdjust: (_a = colours === null || colours === void 0 ? void 0 : colours.autoDarkAdjust) !== null && _a !== void 0 ? _a : fallback.autoDarkAdjust,
                cardBgLight: (_b = colours === null || colours === void 0 ? void 0 : colours.cardBgLight) !== null && _b !== void 0 ? _b : fallback.cardBgLight,
                cardBgDark: (_c = colours === null || colours === void 0 ? void 0 : colours.cardBgDark) !== null && _c !== void 0 ? _c : fallback.cardBgDark,
                cardBorderLight: (_d = colours === null || colours === void 0 ? void 0 : colours.cardBorderLight) !== null && _d !== void 0 ? _d : fallback.cardBorderLight,
                cardBorderDark: (_e = colours === null || colours === void 0 ? void 0 : colours.cardBorderDark) !== null && _e !== void 0 ? _e : fallback.cardBorderDark,
                cardAccentLight: (_f = colours === null || colours === void 0 ? void 0 : colours.cardAccentLight) !== null && _f !== void 0 ? _f : fallback.cardAccentLight,
                cardAccentDark: (_g = colours === null || colours === void 0 ? void 0 : colours.cardAccentDark) !== null && _g !== void 0 ? _g : fallback.cardAccentDark,
                cardTextLight: (_h = colours === null || colours === void 0 ? void 0 : colours.cardTextLight) !== null && _h !== void 0 ? _h : fallback.cardTextLight,
                cardTextDark: (_j = colours === null || colours === void 0 ? void 0 : colours.cardTextDark) !== null && _j !== void 0 ? _j : fallback.cardTextDark,
                cardMutedLight: (_k = colours === null || colours === void 0 ? void 0 : colours.cardMutedLight) !== null && _k !== void 0 ? _k : fallback.cardMutedLight,
                cardMutedDark: (_l = colours === null || colours === void 0 ? void 0 : colours.cardMutedDark) !== null && _l !== void 0 ? _l : fallback.cardMutedDark,
                clozeBgLight: (_m = colours === null || colours === void 0 ? void 0 : colours.clozeBgLight) !== null && _m !== void 0 ? _m : fallback.clozeBgLight,
                clozeTextLight: (_o = colours === null || colours === void 0 ? void 0 : colours.clozeTextLight) !== null && _o !== void 0 ? _o : fallback.clozeTextLight,
                clozeBgDark: (_p = colours === null || colours === void 0 ? void 0 : colours.clozeBgDark) !== null && _p !== void 0 ? _p : fallback.clozeBgDark,
                clozeTextDark: (_q = colours === null || colours === void 0 ? void 0 : colours.clozeTextDark) !== null && _q !== void 0 ? _q : fallback.clozeTextDark,
            });
        };
        rv.macroConfigs.flashcards.colours = normaliseColours(rv.macroConfigs.flashcards.colours, DEFAULT_SETTINGS.readingView.macroConfigs.flashcards.colours);
        rv.macroConfigs.classic.colours = normaliseColours(rv.macroConfigs.classic.colours, DEFAULT_SETTINGS.readingView.macroConfigs.classic.colours);
        rv.macroConfigs.guidebook.colours = normaliseColours(rv.macroConfigs.guidebook.colours, DEFAULT_SETTINGS.readingView.macroConfigs.guidebook.colours);
        rv.macroConfigs.markdown.colours = normaliseColours(rv.macroConfigs.markdown.colours, DEFAULT_SETTINGS.readingView.macroConfigs.markdown.colours);
        rv.macroConfigs.custom.colours = normaliseColours(rv.macroConfigs.custom.colours, DEFAULT_SETTINGS.readingView.macroConfigs.custom.colours);
        (_j = (_r = rv.macroConfigs.custom).customCss) !== null && _j !== void 0 ? _j : (_r.customCss = DEFAULT_SETTINGS.readingView.macroConfigs.custom.customCss);
        (_k = (_s = this.plugin.settings.general).enableReadingStyles) !== null && _k !== void 0 ? _k : (_s.enableReadingStyles = this.plugin.settings.general.prettifyCards !== "off");
        const syncStyles = () => {
            try {
                syncReadingViewStyles();
            }
            catch (e) {
                log.swallow("syncReadingViewStyles", e);
            }
        };
        const fullRerenderRV = () => {
            syncStyles();
            void this.plugin.refreshReadingViewMarkdownLeaves();
            void this.plugin.refreshAllViews();
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
            const presetKey = rv.activeMacro === "guidebook" ? "classic" : rv.activeMacro;
            const p = PREVIEW_MACRO_PRESETS[presetKey];
            rv.layout = p.layout;
            rv.cardMode = p.cardMode;
            rv.preset = presetKey;
            if ("colours" in cfg && cfg.colours) {
                rv.cardBgLight = cfg.colours.cardBgLight || "";
                rv.cardBgDark = cfg.colours.cardBgDark || "";
                rv.cardBorderLight = cfg.colours.cardBorderLight || "";
                rv.cardBorderDark = cfg.colours.cardBorderDark || "";
                rv.cardAccentLight = cfg.colours.cardAccentLight || "";
                rv.cardAccentDark = cfg.colours.cardAccentDark || "";
            }
            else {
                rv.cardBgLight = "";
                rv.cardBgDark = "";
                rv.cardBorderLight = "";
                rv.cardBorderDark = "";
                rv.cardAccentLight = "";
                rv.cardAccentDark = "";
            }
        };
        const applyPreset = async (key) => {
            const p = PREVIEW_MACRO_PRESETS[key];
            const presetLabel = this._tx(p.labelKey, key);
            if (isMacroComingSoon(key)) {
                new Notice(this._tx("ui.settings.reading.presets.comingSoon", "{label} is coming in a future release.", { label: presetLabel }));
                return;
            }
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
                displayAudioButton: p.visibleFields.displayAudioButton,
                displayEditButton: p.visibleFields.displayEditButton,
            };
            syncLegacyMirror();
            await this.plugin.saveAll();
            fullRerenderRV();
            this.queueSettingsNotice("readingView.activeMacro", this._noticeLines.readingMacro(presetLabel));
            this._softRerender();
        };
        new Setting(wrapper)
            .setName(this._tx("ui.settings.reading.enableCardStyling.name", "Card styling"))
            .setDesc(this._tx("ui.settings.reading.enableCardStyling.desc", "Render flashcards with custom styling in reading view. Turn off to use default " + "Obsidian" + " rendering."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.general.enableReadingStyles);
            t.onChange(async (enabled) => {
                this.plugin.settings.general.enableReadingStyles = !!enabled;
                this.plugin.settings.general.prettifyCards = enabled ? "accent" : "off";
                if (enabled && !rv.activeMacro)
                    rv.activeMacro = "flashcards";
                syncLegacyMirror();
                await this.plugin.saveAll();
                fullRerenderRV();
                this._softRerender();
                this.queueSettingsNotice("general.enableReadingStyles", this._noticeLines.cardStyling(enabled));
            });
        });
        const readingSettingsStartIndex = wrapper.children.length;
        const isReadingStylesEnabled = !!this.plugin.settings.general.enableReadingStyles;
        const presetOrder = ["flashcards", "markdown"];
        const readingThemeSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.reading.theme.name", "Card style"))
            .setDesc(this._tx("ui.settings.reading.theme.desc", "Set the visual style used for flashcards in reading view."));
        const options = presetOrder.map((key) => {
            if (key === "flashcards") {
                return {
                    value: key,
                    label: this._tx("ui.settings.reading.theme.option.flashcards", "Flashcards"),
                    description: this._tx("ui.settings.reading.theme.option.flashcards.desc", "Flip-style reading cards with optional inline actions."),
                };
            }
            return {
                value: key,
                label: this._tx("ui.settings.reading.theme.option.cleanMarkdown", "Clean markdown"),
                description: this._tx("ui.settings.reading.theme.option.cleanMarkdown.desc", "Minimal reading style with field visibility controls."),
            };
        });
        this._addSimpleSelect(readingThemeSetting.controlEl, {
            options,
            value: rv.activeMacro === "flashcards" || rv.activeMacro === "markdown" ? rv.activeMacro : "flashcards",
            onChange: (value) => {
                void applyPreset(value);
            },
        });
        const activeCfg = rv.macroConfigs[rv.activeMacro];
        const persistActiveMacroConfig = async () => {
            syncLegacyMirror();
            await this.plugin.saveAll();
            fullRerenderRV();
        };
        if (rv.activeMacro === "flashcards") {
            new Setting(wrapper)
                .setName(this._tx("ui.settings.reading.flashcards.displayEditButton.name", "Show edit button"))
                .setDesc(this._tx("ui.settings.reading.flashcards.displayEditButton.desc", "Display an edit button when hovering over a flashcard in reading view."))
                .addToggle((t) => {
                t.setValue(!!activeCfg.fields.displayEditButton);
                t.onChange(async (v) => {
                    activeCfg.fields.displayEditButton = !!v;
                    await persistActiveMacroConfig();
                });
            });
            new Setting(wrapper)
                .setName(this._tx("ui.settings.reading.flashcards.displayAudioButton.name", "Show audio button"))
                .setDesc(this._tx("ui.settings.reading.flashcards.displayAudioButton.desc", "Display a text-to-speech button on flashcards in reading view."))
                .addToggle((t) => {
                t.setValue(!!activeCfg.fields.displayAudioButton);
                t.onChange(async (v) => {
                    activeCfg.fields.displayAudioButton = !!v;
                    await persistActiveMacroConfig();
                });
            });
        }
        if (rv.activeMacro === "markdown") {
            const addMarkdownFieldToggle = (name, desc, key) => {
                new Setting(wrapper)
                    .setName(name)
                    .setDesc(desc)
                    .addToggle((t) => {
                    t.setValue(!!activeCfg.fields[key]);
                    t.onChange(async (v) => {
                        activeCfg.fields[key] = !!v;
                        await persistActiveMacroConfig();
                    });
                });
            };
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.title.name", "Show title"), this._tx("ui.settings.reading.markdown.fields.title.desc", "Display the card title field."), "title");
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.question.name", "Show question"), this._tx("ui.settings.reading.markdown.fields.question.desc", "Display the question field."), "question");
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.options.name", "Show options"), this._tx("ui.settings.reading.markdown.fields.options.desc", "Display multiple-choice options when available."), "options");
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.answer.name", "Show answer"), this._tx("ui.settings.reading.markdown.fields.answer.desc", "Display the answer field."), "answer");
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.info.name", "Show info"), this._tx("ui.settings.reading.markdown.fields.info.desc", "Display the info and context field."), "info");
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.groups.name", "Show groups"), this._tx("ui.settings.reading.markdown.fields.groups.desc", "Display group tags."), "groups");
            addMarkdownFieldToggle(this._tx("ui.settings.reading.markdown.fields.labels.name", "Show field labels"), this._tx("ui.settings.reading.markdown.fields.labels.desc", "Display labels above each field, like Question, Answer, and Info."), "labels");
        }
        syncLegacyMirror();
        if (!isReadingStylesEnabled) {
            const allChildren = Array.from(wrapper.children);
            for (let i = readingSettingsStartIndex; i < allChildren.length; i++) {
                const child = allChildren[i];
                if (child)
                    setCssProps(child, "display", "none");
            }
        }
    }
    renderStudySection(wrapper) {
        new Setting(wrapper).setName(this._tx("ui.settings.sections.studySessions", "Card study sessions")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.dailyNewLimit.name", "Daily new limit"))
            .setDesc(this._tx("ui.settings.study.dailyNewLimit.desc", "Maximum new cards per day (per deck). Set 0 to disable new cards."))
            .addText((t) => t.setValue(String(this.plugin.settings.study.dailyNewLimit)).onChange(async (v) => {
            const prev = this.plugin.settings.study.dailyNewLimit;
            const next = toNonNegInt(v, 20);
            this.plugin.settings.study.dailyNewLimit = next;
            await this.plugin.saveAll();
            this.refreshReviewerViewsIfPossible();
            if (prev !== next) {
                this.queueSettingsNotice("study.dailyNewLimit", this._noticeLines.dailyNewLimit(next));
            }
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.dailyReviewLimit.name", "Daily review limit"))
            .setDesc(this._tx("ui.settings.study.dailyReviewLimit.desc", "Maximum due cards per day (per deck). Set 0 to disable reviews."))
            .addText((t) => t.setValue(String(this.plugin.settings.study.dailyReviewLimit)).onChange(async (v) => {
            const prev = this.plugin.settings.study.dailyReviewLimit;
            const next = toNonNegInt(v, 200);
            this.plugin.settings.study.dailyReviewLimit = next;
            await this.plugin.saveAll();
            this.refreshReviewerViewsIfPossible();
            if (prev !== next) {
                this.queueSettingsNotice("study.dailyReviewLimit", this._noticeLines.dailyReviewLimit(next));
            }
        }));
        let autoAdvanceSecondsSetting = null;
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.autoAdvance.name", "Auto-advance"))
            .setDesc(this._tx("ui.settings.study.autoAdvance.desc", "Mark unanswered cards as failed and advance after the timer expires."))
            .addToggle((t) => t.setValue(this.plugin.settings.study.autoAdvanceEnabled).onChange(async (v) => {
            const prev = this.plugin.settings.study.autoAdvanceEnabled;
            this.plugin.settings.study.autoAdvanceEnabled = v;
            await this.plugin.saveAll();
            this.refreshReviewerViewsIfPossible();
            autoAdvanceSecondsSetting === null || autoAdvanceSecondsSetting === void 0 ? void 0 : autoAdvanceSecondsSetting.setDisabled(!v);
            if (prev !== v) {
                this.queueSettingsNotice("study.autoAdvanceEnabled", this._noticeLines.autoAdvanceEnabled(v));
            }
        }));
        autoAdvanceSecondsSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.autoAdvanceAfter.name", "Auto-advance after"))
            .setDesc(this._tx("ui.settings.study.autoAdvanceAfter.desc", "Seconds before auto-advance triggers. Applies to reviewer and widget."))
            .addSlider((s) => s
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
                this.queueSettingsNotice("study.autoAdvanceSeconds", this._noticeLines.autoAdvanceSeconds(next));
            }
        }));
        autoAdvanceSecondsSetting.setDisabled(!this.plugin.settings.study.autoAdvanceEnabled);
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gradingButtons.name", "Grading buttons"))
            .setDesc(this._tx("ui.settings.study.gradingButtons.desc", "Number of grading buttons shown during review."))
            .then((s) => {
            this._addSimpleSelect(s.controlEl, {
                options: [
                    {
                        value: "two",
                        label: this._tx("ui.settings.study.gradingButtons.option.two", "Two buttons"),
                    },
                    {
                        value: "four",
                        label: this._tx("ui.settings.study.gradingButtons.option.four", "Four buttons"),
                    },
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
                            this.queueSettingsNotice("study.gradingSystem", this._noticeLines.gradingButtons(nextFour));
                        }
                    })();
                },
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gradeIntervals.name", "Show grade intervals"))
            .setDesc(this._tx("ui.settings.study.gradeIntervals.desc", "Show next review times under grade buttons in reviewer and widget."))
            .addToggle((t) => t.setValue(!!this.plugin.settings.study.showGradeIntervals).onChange(async (v) => {
            const prev = !!this.plugin.settings.study.showGradeIntervals;
            this.plugin.settings.study.showGradeIntervals = v;
            await this.plugin.saveAll();
            this.refreshReviewerViewsIfPossible();
            this.refreshAllWidgetViews();
            if (prev !== v) {
                this.queueSettingsNotice("study.showGradeIntervals", v
                    ? "Showing grade intervals under grading buttons."
                    : "Hiding grade intervals under grading buttons.");
            }
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.skipButton.name", "Skip button"))
            .setDesc(this._tx("ui.settings.study.skipButton.desc", "Show a skip button (enter). Skipped cards stay in the current session and do not change scheduling."))
            .addToggle((t) => {
            const cur = !!this.plugin.settings.study.enableSkipButton;
            t.setValue(cur);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.study.enableSkipButton;
                this.plugin.settings.study.enableSkipButton = v;
                await this.plugin.saveAll();
                this.refreshReviewerViewsIfPossible();
                if (prev !== v) {
                    this.queueSettingsNotice("study.enableSkipButton", this._noticeLines.skipButton(v));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.folderNotesAsDecks.name", "Treat folder notes as decks"))
            .setDesc(this._tx("ui.settings.study.folderNotesAsDecks.desc", "A folder note studies cards from notes in that folder and its subfolders."))
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
                    this.queueSettingsNotice("study.treatFolderNotesAsDecks", this._noticeLines.folderNotes(v));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.hideSessionTopbar.name", "Hide card title bar"))
            .setDesc(this._tx("ui.settings.study.hideSessionTopbar.desc", "Hide the card-title header shown at the top of each flashcard during study sessions."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.study.hideSessionTopbar);
            t.onChange(async (v) => {
                this.plugin.settings.study.hideSessionTopbar = v;
                await this.plugin.saveAll();
                this.refreshReviewerViewsIfPossible();
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.siblingManagement.name", "Sibling card management"))
            .setDesc(this._tx("ui.settings.study.siblingManagement.desc", "Standard leaves siblings alone. Disperse spreads them out. Bury keeps one sibling active until it is no longer due soon."))
            .then((s) => {
            var _a;
            this._addSimpleSelect(s.controlEl, {
                options: [
                    {
                        value: "standard",
                        label: this._tx("ui.settings.study.siblingManagement.option.standard", "Standard queueing"),
                    },
                    {
                        value: "disperse",
                        label: this._tx("ui.settings.study.siblingManagement.option.disperse", "Disperse siblings"),
                    },
                    {
                        value: "bury",
                        label: this._tx("ui.settings.study.siblingManagement.option.bury", "Bury siblings"),
                    },
                ],
                separatorAfterIndex: 0,
                value: (_a = this.plugin.settings.study.siblingMode) !== null && _a !== void 0 ? _a : "standard",
                onChange: (v) => {
                    void (async () => {
                        var _a;
                        const prev = (_a = this.plugin.settings.study.siblingMode) !== null && _a !== void 0 ? _a : "standard";
                        const next = v;
                        this.plugin.settings.study.siblingMode = next;
                        await this.plugin.saveAll();
                        this.refreshReviewerViewsIfPossible();
                        if (prev !== next) {
                            const labels = {
                                standard: this._tx("ui.settings.study.siblingManagement.option.standard", "Standard queueing"),
                                disperse: this._tx("ui.settings.study.siblingManagement.option.disperse", "Disperse siblings"),
                                bury: this._tx("ui.settings.study.siblingManagement.option.bury", "Bury siblings"),
                            };
                            this.queueSettingsNotice("study.siblingMode", this._noticeLines.siblingMode(labels[next]));
                        }
                    })();
                },
            });
        });
        let startupDelaySetting = null;
        let repeatIntervalSetting = null;
        let gatekeeperBehaviourHeading = null;
        let gatekeeperFrequencySetting = null;
        let gatekeeperDueQuestionsSetting = null;
        let gatekeeperScopeSetting = null;
        let gatekeeperPauseSetting = null;
        let gatekeeperBypassHeading = null;
        let gatekeeperBypassSetting = null;
        let gatekeeperBypassWarningSetting = null;
        const setSettingVisible = (setting, visible) => {
            if (!setting)
                return;
            setting.settingEl.toggleClass("learnkit-settings-conditional-hidden", !visible);
        };
        const refreshRemindersVisibility = () => {
            const launchEnabled = !!this.plugin.settings.reminders.showOnStartup;
            const routineEnabled = !!this.plugin.settings.reminders.repeatEnabled;
            const gatekeeperEnabled = !!this.plugin.settings.reminders.gatekeeperEnabled;
            const gatekeeperAllowSkip = !!this.plugin.settings.reminders.gatekeeperAllowSkip;
            setSettingVisible(startupDelaySetting, launchEnabled);
            setSettingVisible(repeatIntervalSetting, routineEnabled);
            setSettingVisible(gatekeeperBehaviourHeading, gatekeeperEnabled);
            setSettingVisible(gatekeeperFrequencySetting, gatekeeperEnabled);
            setSettingVisible(gatekeeperDueQuestionsSetting, gatekeeperEnabled);
            setSettingVisible(gatekeeperScopeSetting, gatekeeperEnabled);
            setSettingVisible(gatekeeperPauseSetting, gatekeeperEnabled);
            setSettingVisible(gatekeeperBypassHeading, gatekeeperEnabled);
            setSettingVisible(gatekeeperBypassSetting, gatekeeperEnabled);
            setSettingVisible(gatekeeperBypassWarningSetting, gatekeeperEnabled && gatekeeperAllowSkip);
            startupDelaySetting === null || startupDelaySetting === void 0 ? void 0 : startupDelaySetting.setDisabled(!launchEnabled);
            repeatIntervalSetting === null || repeatIntervalSetting === void 0 ? void 0 : repeatIntervalSetting.setDisabled(!routineEnabled);
            gatekeeperFrequencySetting === null || gatekeeperFrequencySetting === void 0 ? void 0 : gatekeeperFrequencySetting.setDisabled(!gatekeeperEnabled);
            gatekeeperDueQuestionsSetting === null || gatekeeperDueQuestionsSetting === void 0 ? void 0 : gatekeeperDueQuestionsSetting.setDisabled(!gatekeeperEnabled);
            gatekeeperScopeSetting === null || gatekeeperScopeSetting === void 0 ? void 0 : gatekeeperScopeSetting.setDisabled(!gatekeeperEnabled);
            gatekeeperPauseSetting === null || gatekeeperPauseSetting === void 0 ? void 0 : gatekeeperPauseSetting.setDisabled(!gatekeeperEnabled);
            gatekeeperBypassSetting === null || gatekeeperBypassSetting === void 0 ? void 0 : gatekeeperBypassSetting.setDisabled(!gatekeeperEnabled);
            gatekeeperBypassWarningSetting === null || gatekeeperBypassWarningSetting === void 0 ? void 0 : gatekeeperBypassWarningSetting.setDisabled(!gatekeeperEnabled || !gatekeeperAllowSkip);
        };
        new Setting(wrapper).setName(this._tx("ui.settings.sections.launchReminders", "Launch reminders")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.launchReminders.enabled.name", "Show launch reminder"))
            .setDesc(this._tx("ui.settings.study.launchReminders.enabled.desc", "Show one reminder shortly after " + "Obsidian" + " starts."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.reminders.showOnStartup);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.reminders.showOnStartup;
                this.plugin.settings.reminders.showOnStartup = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                refreshRemindersVisibility();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.showOnStartup", this._noticeLines.remindersLaunch(v));
                }
            });
        });
        startupDelaySetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.launchReminders.delay.name", "Launch reminder delay"))
            .setDesc(this._tx("ui.settings.study.launchReminders.delay.desc", "Seconds to wait before showing the launch reminder."))
            .addText((t) => t
            .setPlaceholder(this._tx("ui.settings.study.launchReminders.delay.placeholder", "1"))
            .setValue(String(Math.round((Number(this.plugin.settings.reminders.startupDelayMs) || 0) / 1000) || 1))
            .onChange(async (v) => {
            const prevSeconds = Math.round((Number(this.plugin.settings.reminders.startupDelayMs) || 0) / 1000) || 1;
            const nextSeconds = clamp(toNonNegInt(v, 1), 0, 600);
            this.plugin.settings.reminders.startupDelayMs = nextSeconds * 1000;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();
            if (prevSeconds !== nextSeconds) {
                this.queueSettingsNotice("reminders.startupDelayMs", this._noticeLines.remindersLaunchDelay(nextSeconds));
            }
        }));
        new Setting(wrapper).setName(this._tx("ui.settings.sections.routineReminders", "Routine reminders")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.routineReminders.enabled.name", "Show routine reminders"))
            .setDesc(this._tx("ui.settings.study.routineReminders.enabled.desc", "Show recurring reminders while " + "Obsidian" + " stays open."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.reminders.repeatEnabled);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.reminders.repeatEnabled;
                this.plugin.settings.reminders.repeatEnabled = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                refreshRemindersVisibility();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.repeatEnabled", this._noticeLines.remindersRoutine(v));
                }
            });
        });
        repeatIntervalSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.routineReminders.frequency.name", "Routine reminder interval"))
            .setDesc(this._tx("ui.settings.study.routineReminders.frequency.desc", "Minutes between routine reminders."))
            .addText((t) => t
            .setPlaceholder(this._tx("ui.settings.study.routineReminders.frequency.placeholder", "30"))
            .setValue(String(Math.max(1, Number(this.plugin.settings.reminders.repeatIntervalMinutes) || 30)))
            .onChange(async (v) => {
            const prev = Math.max(1, Number(this.plugin.settings.reminders.repeatIntervalMinutes) || 30);
            const next = clamp(toNonNegInt(v, 30), 1, 1440);
            this.plugin.settings.reminders.repeatIntervalMinutes = next;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();
            if (prev !== next) {
                this.queueSettingsNotice("reminders.repeatIntervalMinutes", this._noticeLines.remindersRoutineFrequency(next));
            }
        }));
        new Setting(wrapper).setName(this._tx("ui.settings.sections.gatekeeperPopups", "Gatekeeper popups")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperPopups.enabled.name", "Enable recurring gatekeeper popups"))
            .setDesc(this._tx("ui.settings.study.gatekeeperPopups.enabled.desc", "Show recurring gatekeeper popups with due questions."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.reminders.gatekeeperEnabled);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.reminders.gatekeeperEnabled;
                this.plugin.settings.reminders.gatekeeperEnabled = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                refreshRemindersVisibility();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.gatekeeperEnabled", this._noticeLines.gatekeeperEnabled(v));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperPopups.onLaunch.name", "Show gatekeeper on launch"))
            .setDesc(this._tx("ui.settings.study.gatekeeperPopups.onLaunch.desc", "Show gatekeeper once shortly after " + "Obsidian" + " starts."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.reminders.gatekeeperOnStartup);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.reminders.gatekeeperOnStartup;
                this.plugin.settings.reminders.gatekeeperOnStartup = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.gatekeeperOnStartup", this._noticeLines.gatekeeperOnStartup(v));
                }
            });
        });
        gatekeeperBehaviourHeading = new Setting(wrapper).setName(this._tx("ui.settings.sections.gatekeeperBehaviour", "Gatekeeper behaviour")).setHeading();
        gatekeeperFrequencySetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperBehaviour.frequency.name", "Gatekeeper interval"))
            .setDesc(this._tx("ui.settings.study.gatekeeperBehaviour.frequency.desc", "Minutes between gatekeeper popups."))
            .addText((t) => t
            .setPlaceholder(this._tx("ui.settings.study.gatekeeperBehaviour.frequency.placeholder", "30"))
            .setValue(String(Math.max(1, Number(this.plugin.settings.reminders.gatekeeperIntervalMinutes) || 30)))
            .onChange(async (v) => {
            const prev = Math.max(1, Number(this.plugin.settings.reminders.gatekeeperIntervalMinutes) || 30);
            const next = clamp(toNonNegInt(v, 30), 1, 1440);
            this.plugin.settings.reminders.gatekeeperIntervalMinutes = next;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();
            if (prev !== next) {
                this.queueSettingsNotice("reminders.gatekeeperIntervalMinutes", this._noticeLines.gatekeeperFrequency(next));
            }
        }));
        gatekeeperDueQuestionsSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperBehaviour.dueQuestions.name", "Questions per popup"))
            .setDesc(this._tx("ui.settings.study.gatekeeperBehaviour.dueQuestions.desc", "Due questions included in each popup. If fewer are due, all are shown. If none are due, the popup is skipped."))
            .addText((t) => t
            .setPlaceholder(this._tx("ui.settings.study.gatekeeperBehaviour.dueQuestions.placeholder", "3"))
            .setValue(String(Math.max(1, Number(this.plugin.settings.reminders.gatekeeperDueQuestionCount) || 3)))
            .onChange(async (v) => {
            const prev = Math.max(1, Number(this.plugin.settings.reminders.gatekeeperDueQuestionCount) || 3);
            const next = clamp(toNonNegInt(v, 3), 1, 200);
            this.plugin.settings.reminders.gatekeeperDueQuestionCount = next;
            await this.plugin.saveAll();
            this.plugin.refreshReminderEngine();
            if (prev !== next) {
                this.queueSettingsNotice("reminders.gatekeeperDueQuestionCount", this._noticeLines.gatekeeperDueQuestions(next));
            }
        }));
        gatekeeperScopeSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperBehaviour.scope.name", "Gatekeeper scope"))
            .setDesc(this._tx("ui.settings.study.gatekeeperBehaviour.scope.desc", "Set whether gatekeeper blocks the full workspace or only the current tab."))
            .then((s) => {
            var _a;
            this._addSimpleSelect(s.controlEl, {
                options: [
                    {
                        value: "workspace",
                        label: this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.workspace", "Full workspace"),
                    },
                    {
                        value: "current-tab",
                        label: this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.currentTab", "Current tab"),
                    },
                ],
                value: (_a = this.plugin.settings.reminders.gatekeeperScope) !== null && _a !== void 0 ? _a : "workspace",
                onChange: (v) => {
                    void (async () => {
                        var _a;
                        const prev = (_a = this.plugin.settings.reminders.gatekeeperScope) !== null && _a !== void 0 ? _a : "workspace";
                        const next = v === "current-tab" ? "current-tab" : "workspace";
                        this.plugin.settings.reminders.gatekeeperScope = next;
                        await this.plugin.saveAll();
                        this.plugin.refreshReminderEngine();
                        if (prev !== next) {
                            const labels = {
                                workspace: this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.workspace", "Full workspace"),
                                "current-tab": this._tx("ui.settings.study.gatekeeperBehaviour.scope.option.currentTab", "Current tab"),
                            };
                            this.queueSettingsNotice("reminders.gatekeeperScope", this._noticeLines.gatekeeperScope(labels[next]));
                        }
                    })();
                },
            });
        });
        gatekeeperPauseSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperBehaviour.pauseWhileStudying.name", "Pause gatekeeper while studying"))
            .setDesc(this._tx("ui.settings.study.gatekeeperBehaviour.pauseWhileStudying.desc", "Pause the gatekeeper timer while in study tabs. It resumes when you leave."))
            .addToggle((t) => {
            var _a;
            t.setValue((_a = this.plugin.settings.reminders.gatekeeperPauseWhenStudying) !== null && _a !== void 0 ? _a : true);
            t.onChange(async (v) => {
                var _a;
                const prev = (_a = this.plugin.settings.reminders.gatekeeperPauseWhenStudying) !== null && _a !== void 0 ? _a : true;
                this.plugin.settings.reminders.gatekeeperPauseWhenStudying = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.gatekeeperPauseWhenStudying", this._noticeLines.gatekeeperPauseWhenStudying(v));
                }
            });
        });
        gatekeeperBypassHeading = new Setting(wrapper).setName(this._tx("ui.settings.sections.gatekeeperBypass", "Gatekeeper bypass")).setHeading();
        gatekeeperBypassSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperBypass.enabled.name", "Enable gatekeeper bypass"))
            .setDesc(this._tx("ui.settings.study.gatekeeperBypass.enabled.desc", "Allow closing gatekeeper before finishing all shown questions."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.reminders.gatekeeperAllowSkip);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.reminders.gatekeeperAllowSkip;
                this.plugin.settings.reminders.gatekeeperAllowSkip = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                refreshRemindersVisibility();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.gatekeeperAllowSkip", this._noticeLines.gatekeeperBypass(v));
                }
            });
        });
        gatekeeperBypassWarningSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.study.gatekeeperBypass.warning.name", "Warn before bypassing gatekeeper"))
            .setDesc(this._tx("ui.settings.study.gatekeeperBypass.warning.desc", "Show a confirmation before closing gatekeeper early."))
            .addToggle((t) => {
            t.setValue(!!this.plugin.settings.reminders.gatekeeperBypassWarning);
            t.onChange(async (v) => {
                const prev = !!this.plugin.settings.reminders.gatekeeperBypassWarning;
                this.plugin.settings.reminders.gatekeeperBypassWarning = v;
                await this.plugin.saveAll();
                this.plugin.refreshReminderEngine();
                if (prev !== v) {
                    this.queueSettingsNotice("reminders.gatekeeperBypassWarning", this._noticeLines.gatekeeperBypassWarning(v));
                }
            });
        });
        refreshRemindersVisibility();
    }
    renderNoteReviewSection(wrapper) {
        var _a;
        var _b;
        (_a = (_b = this.plugin.settings).noteReview) !== null && _a !== void 0 ? _a : (_b.noteReview = {
            algorithm: "fsrs",
            enableSessionAnimations: true,
            avoidFolderNotes: true,
            filterQuery: "",
            reviewsPerDay: 10,
            reviewStepsDays: [1, 7, 30, 365],
            fillFromFutureWhenUnderLimit: true,
            fsrsRetention: 0.9,
            fsrsLearningStepsMinutes: [10, 1440],
            fsrsRelearningStepsMinutes: [10],
            fsrsEnableFuzz: true,
        });
        const noteCfg = this.plugin.settings.noteReview;
        let refreshScopeBlocks = null;
        let avoidFolderNotesToggle = null;
        new Setting(wrapper)
            .setName(this._tx("ui.settings.noteReview.selection.heading", "Note selection"))
            .setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.noteReview.avoidFolderNotes.name", "Skip folder notes"))
            .setDesc(this._tx("ui.settings.noteReview.avoidFolderNotes.desc", "Exclude notes whose filename matches their parent folder name."))
            .addToggle((t) => {
            avoidFolderNotesToggle = t;
            t.setValue(noteCfg.avoidFolderNotes !== false).onChange(async (v) => {
                noteCfg.avoidFolderNotes = !!v;
                await this.plugin.saveAll();
                refreshScopeBlocks === null || refreshScopeBlocks === void 0 ? void 0 : refreshScopeBlocks();
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.noteReview.filter.name", "Include or exclude notes"))
            .setDesc(this._tx("ui.settings.noteReview.filter.desc", "Filter by folders, notes, tags, or properties. Include adds matching notes; Exclude removes them."))
            .then((setting) => {
            var _a;
            const files = this.app.vault.getMarkdownFiles();
            const isFolderNote = (file) => {
                const path = String(file.path || "").trim();
                if (!path.includes("/"))
                    return false;
                const parts = path.split("/").filter(Boolean);
                if (parts.length < 2)
                    return false;
                const fileBase = String(file.basename || "").trim().toLowerCase();
                const parentFolder = String(parts[parts.length - 2] || "").trim().toLowerCase();
                if (!fileBase || !parentFolder)
                    return false;
                return fileBase === parentFolder;
            };
            const folderNoteCount = files.filter((file) => isFolderNote(file)).length;
            const notePathSet = new Set(files.map((file) => file.path));
            const folderSet = new Set();
            for (const file of files) {
                const slash = file.path.lastIndexOf("/");
                if (slash >= 0)
                    folderSet.add(file.path.slice(0, slash));
            }
            const metadata = collectVaultTagAndPropertyPairs(this.app, files);
            const baseOptions = [
                {
                    type: "vault",
                    id: "vault::",
                    label: `Vault: ${this.app.vault.getName()} (${files.length})`,
                    selected: false,
                    searchTexts: [this.app.vault.getName(), "vault", "all notes", "all content"],
                },
                ...Array.from(folderSet)
                    .sort((a, b) => a.localeCompare(b))
                    .map((folder) => {
                    var _a;
                    const folderName = (_a = folder.split("/").filter(Boolean).pop()) !== null && _a !== void 0 ? _a : folder;
                    return {
                        type: "folder",
                        id: `folder::${folder}`,
                        label: `Folder: ${folderName} (${files.filter((file) => file.path.startsWith(`${folder}/`)).length})`,
                        selected: false,
                        searchTexts: [folderName, folder],
                    };
                }),
                ...files
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((file) => ({
                    type: "note",
                    id: `note::${file.path}`,
                    label: `Note: ${file.basename}`,
                    selected: false,
                    searchTexts: [file.basename, file.path],
                })),
                ...metadata.tags.map((tag) => ({
                    type: "tag",
                    id: `tag::${tag.token}`,
                    label: `Tag: ${tag.display} (${tag.count})`,
                    selected: false,
                    searchTexts: [`#${tag.token}`, `tag:${tag.token}`, tag.display],
                })),
                ...metadata.properties.map((pair) => ({
                    type: "property",
                    id: `prop::${encodePropertyPair({ key: pair.key, value: pair.value })}`,
                    label: `${pair.displayKey}: ${pair.displayValue} (${pair.count})`,
                    selected: false,
                    propertyKey: pair.displayKey,
                    propertyValue: pair.displayValue,
                    searchTexts: [
                        `${pair.key}:${pair.value}`,
                        `${pair.key}=${pair.value}`,
                        `${pair.displayKey}:${pair.displayValue}`,
                        `prop:${pair.key}=${pair.value}`,
                    ],
                })),
            ];
            const safeDecodeURI = (v) => {
                try {
                    return decodeURIComponent(v);
                }
                catch (_a) {
                    return v;
                }
            };
            const parseStoredQuery = (query) => {
                const include = new Set();
                const exclude = new Set();
                const passthrough = [];
                const parts = String(query || "")
                    .split(/\s+/)
                    .map((part) => part.trim())
                    .filter(Boolean);
                for (const part of parts) {
                    const lowered = part.toLowerCase();
                    if (lowered === "scope:vault" || lowered === "vault") {
                        include.add("vault::");
                        continue;
                    }
                    if (lowered === "-scope:vault" || lowered === "-vault") {
                        exclude.add("vault::");
                        continue;
                    }
                    if (lowered.startsWith("path:")) {
                        const path = safeDecodeURI(String(part.slice(5)).trim());
                        if (!path)
                            continue;
                        include.add(notePathSet.has(path) ? `note::${path}` : `folder::${path}`);
                        continue;
                    }
                    if (lowered.startsWith("-path:")) {
                        const path = safeDecodeURI(String(part.slice(6)).trim());
                        if (!path)
                            continue;
                        exclude.add(notePathSet.has(path) ? `note::${path}` : `folder::${path}`);
                        continue;
                    }
                    if (lowered.startsWith("note:")) {
                        const path = safeDecodeURI(String(part.slice(5)).trim());
                        if (!path)
                            continue;
                        include.add(`note::${path}`);
                        continue;
                    }
                    if (lowered.startsWith("-note:")) {
                        const path = safeDecodeURI(String(part.slice(6)).trim());
                        if (!path)
                            continue;
                        exclude.add(`note::${path}`);
                        continue;
                    }
                    if (lowered.startsWith("tag:")) {
                        const token = safeDecodeURI(String(part.slice(4)).trim()).toLowerCase().replace(/^#+/, "");
                        if (!token)
                            continue;
                        include.add(`tag::${token}`);
                        continue;
                    }
                    if (lowered.startsWith("-tag:")) {
                        const token = safeDecodeURI(String(part.slice(5)).trim()).toLowerCase().replace(/^#+/, "");
                        if (!token)
                            continue;
                        exclude.add(`tag::${token}`);
                        continue;
                    }
                    if (lowered.startsWith("prop:")) {
                        const token = safeDecodeURI(String(part.slice(5)).trim()).toLowerCase();
                        if (!token)
                            continue;
                        include.add(`prop::${token}`);
                        continue;
                    }
                    if (lowered.startsWith("-prop:")) {
                        const token = safeDecodeURI(String(part.slice(6)).trim()).toLowerCase();
                        if (!token)
                            continue;
                        exclude.add(`prop::${token}`);
                        continue;
                    }
                    passthrough.push(part);
                }
                return { include, exclude, passthrough };
            };
            const encodeTokenValue = (v) => {
                try {
                    return encodeURIComponent(v);
                }
                catch (_a) {
                    return v;
                }
            };
            const toToken = (id, negate) => {
                const prefix = negate ? "-" : "";
                if (id === "vault::")
                    return `${prefix}scope:vault`;
                if (id.startsWith("folder::"))
                    return `${prefix}path:${encodeTokenValue(id.slice("folder::".length))}`;
                if (id.startsWith("note::"))
                    return `${prefix}note:${encodeTokenValue(id.slice("note::".length))}`;
                if (id.startsWith("tag::"))
                    return `${prefix}tag:${encodeTokenValue(id.slice("tag::".length))}`;
                if (id.startsWith("prop::")) {
                    const raw = id.slice("prop::".length);
                    const pair = decodePropertyPair(raw);
                    if (!pair)
                        return null;
                    return `${prefix}prop:${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`;
                }
                return null;
            };
            const parsed = parseStoredQuery(String((_a = noteCfg.filterQuery) !== null && _a !== void 0 ? _a : ""));
            const includeSet = parsed.include;
            const excludeSet = parsed.exclude;
            const passthroughTokens = parsed.passthrough;
            const validOptionIds = new Set(baseOptions.map((option) => option.id));
            for (const id of Array.from(includeSet)) {
                if (!validOptionIds.has(id))
                    includeSet.delete(id);
            }
            for (const id of Array.from(excludeSet)) {
                if (!validOptionIds.has(id))
                    excludeSet.delete(id);
            }
            setting.controlEl.addClass("learnkit-note-review-scope-control");
            const controlHost = setting.controlEl.createDiv({ cls: "learnkit-note-review-scope-editor learnkit-note-review-scope-editor" });
            const includeHost = controlHost.createDiv({ cls: "learnkit-note-review-scope-block learnkit-note-review-scope-block" });
            const excludeHost = controlHost.createDiv({ cls: "learnkit-note-review-scope-block learnkit-note-review-scope-block" });
            const summaryEl = controlHost.createDiv({ cls: "learnkit-note-review-scope-summary learnkit-note-review-scope-summary text-xs text-muted-foreground" });
            const persistScopeQuery = async () => {
                const includeTokens = Array.from(includeSet)
                    .map((id) => toToken(id, false))
                    .filter((token) => !!token)
                    .sort((a, b) => a.localeCompare(b));
                const excludeTokens = Array.from(excludeSet)
                    .map((id) => toToken(id, true))
                    .filter((token) => !!token)
                    .sort((a, b) => a.localeCompare(b));
                noteCfg.filterQuery = [...includeTokens, ...excludeTokens, ...passthroughTokens]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                await this.plugin.saveAll();
            };
            let renderInclude = null;
            let renderExclude = null;
            const isOptionMatch = (id, file) => {
                if (id === "vault::")
                    return true;
                if (id.startsWith("folder::")) {
                    const folder = id.slice("folder::".length);
                    return file.path.startsWith(`${folder}/`);
                }
                if (id.startsWith("note::"))
                    return file.path === id.slice("note::".length);
                if (id.startsWith("tag::")) {
                    const token = id.slice("tag::".length).toLowerCase();
                    if (!token)
                        return false;
                    const tags = new Set(extractFileTags(this.app, file));
                    return tags.has(token);
                }
                if (id.startsWith("prop::")) {
                    const pair = decodePropertyPair(id.slice("prop::".length));
                    if (!pair)
                        return false;
                    const props = extractFilePropertyPairs(this.app, file);
                    return props.some((p) => p.key === pair.key && p.value === pair.value);
                }
                return false;
            };
            const renderIncludedNotesSummary = () => {
                const includeIds = Array.from(includeSet);
                const excludeIds = Array.from(excludeSet);
                const included = files.filter((file) => {
                    const includeMatch = !includeIds.length || includeIds.some((id) => isOptionMatch(id, file));
                    if (!includeMatch)
                        return false;
                    const excludedByScope = excludeIds.some((id) => isOptionMatch(id, file));
                    if (excludedByScope)
                        return false;
                    if (noteCfg.avoidFolderNotes !== false && isFolderNote(file))
                        return false;
                    return true;
                }).length;
                summaryEl.setText(`${included} ${included === 1 ? "note" : "notes"} included for note review`);
            };
            const getMatchedNoteCount = (ids, includeFolderNotes) => {
                if (!ids.length && !includeFolderNotes)
                    return 0;
                const matched = new Set();
                for (const file of files) {
                    if (ids.length && ids.some((id) => isOptionMatch(id, file)))
                        matched.add(file.path);
                    if (includeFolderNotes && noteCfg.avoidFolderNotes !== false && isFolderNote(file))
                        matched.add(file.path);
                }
                return matched.size;
            };
            const mountScopeBlock = (host, title, activeSet, oppositeSet, emptyText, includeFolderNotesChip) => {
                host.empty();
                const titleEl = host.createDiv({ cls: "learnkit-coach-field-label learnkit-coach-field-label", text: title });
                const searchWrap = host.createDiv({ cls: "learnkit-coach-search-wrap learnkit-coach-search-wrap" });
                const searchIcon = searchWrap.createSpan({ cls: "learnkit-coach-search-icon learnkit-coach-search-icon" });
                setIcon(searchIcon, "search");
                const search = searchWrap.createEl("input", {
                    cls: "input h-9",
                    attr: { type: "search", placeholder: "Search..." },
                });
                const popover = searchWrap.createDiv({ cls: "learnkit-coach-scope-popover learnkit-coach-scope-popover dropdown-menu hidden" });
                const list = popover.createDiv({ cls: "learnkit-coach-scope-list learnkit-coach-scope-list min-w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 learnkit-pointer-auto learnkit-pointer-auto learnkit-header-menu-panel learnkit-header-menu-panel" });
                list.setAttr("role", "menu");
                list.setAttr("aria-label", `${title} matches`);
                const selectedWrap = host.createDiv({ cls: "learnkit-coach-selected-wrap learnkit-coach-selected-wrap" });
                const chips = selectedWrap.createDiv({ cls: "learnkit-coach-selected-chips learnkit-coach-selected-chips" });
                let query = "";
                const renderSelected = () => {
                    const sorted = Array.from(activeSet).sort((a, b) => a.localeCompare(b));
                    const optionById = new Map(baseOptions.map((option) => [option.id, option]));
                    const resolvedIds = sorted.filter((id) => optionById.has(id));
                    const uniqueResolvedIds = [];
                    const seenLabels = new Set();
                    for (const id of resolvedIds) {
                        const option = optionById.get(id);
                        if (!option)
                            continue;
                        const label = String(option.label || "").trim().toLowerCase();
                        if (label && seenLabels.has(label))
                            continue;
                        if (label)
                            seenLabels.add(label);
                        uniqueResolvedIds.push(id);
                    }
                    const matchedCount = getMatchedNoteCount(uniqueResolvedIds, includeFolderNotesChip);
                    titleEl.setText(`${title} (${matchedCount})`);
                    chips.empty();
                    if (!uniqueResolvedIds.length && !(includeFolderNotesChip && noteCfg.avoidFolderNotes !== false)) {
                        chips.createDiv({ cls: "text-xs text-muted-foreground", text: emptyText });
                        return;
                    }
                    for (const id of uniqueResolvedIds) {
                        const option = optionById.get(id);
                        if (!option)
                            continue;
                        const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
                        chip.createSpan({ text: option.label });
                        const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
                        remove.type = "button";
                        remove.setAttr("aria-label", "Remove");
                        setIcon(remove, "x");
                        remove.addEventListener("click", () => {
                            activeSet.delete(id);
                            scopePicker.render();
                            renderSelected();
                            renderIncludedNotesSummary();
                            void persistScopeQuery();
                        });
                    }
                    if (includeFolderNotesChip && noteCfg.avoidFolderNotes !== false) {
                        const chip = chips.createDiv({ cls: "learnkit-coach-chip learnkit-coach-chip" });
                        chip.createSpan({ text: this._tx("ui.settings.scope.folderNotes", "Folder Notes ({count})", { count: folderNoteCount }) });
                        const remove = chip.createEl("button", { cls: "learnkit-coach-chip-remove learnkit-coach-chip-remove" });
                        remove.type = "button";
                        remove.setAttr("aria-label", this._tx("ui.common.remove", "Remove"));
                        setIcon(remove, "x");
                        remove.addEventListener("click", () => {
                            noteCfg.avoidFolderNotes = false;
                            void this.plugin.saveAll();
                            avoidFolderNotesToggle === null || avoidFolderNotesToggle === void 0 ? void 0 : avoidFolderNotesToggle.setValue(false);
                            refreshScopeBlocks === null || refreshScopeBlocks === void 0 ? void 0 : refreshScopeBlocks();
                            renderSelected();
                            renderIncludedNotesSummary();
                        });
                    }
                };
                const scopePicker = mountSearchPopoverList({
                    searchInput: search,
                    popoverEl: popover,
                    listEl: list,
                    getQuery: () => query,
                    setQuery: (next) => {
                        query = next;
                    },
                    getOptions: () => baseOptions.map((option) => ({
                        ...option,
                        selected: activeSet.has(option.id),
                    })),
                    onToggle: (id) => {
                        if (activeSet.has(id))
                            activeSet.delete(id);
                        else {
                            activeSet.add(id);
                            oppositeSet.delete(id);
                        }
                        renderSelected();
                        renderInclude === null || renderInclude === void 0 ? void 0 : renderInclude();
                        renderExclude === null || renderExclude === void 0 ? void 0 : renderExclude();
                        renderIncludedNotesSummary();
                        void persistScopeQuery();
                    },
                    emptyTextWhenQuery: "No matching scope items.",
                    emptyTextWhenIdle: "Type to search scope items.",
                    typeFilters: [
                        { type: "folder", label: "Folders" },
                        { type: "note", label: "Notes" },
                        { type: "tag", label: "Tags" },
                        { type: "property", label: "Properties" },
                    ],
                });
                const render = () => {
                    renderSelected();
                    scopePicker.render();
                };
                render();
                return { render };
            };
            const includeBlock = mountScopeBlock(includeHost, this._tx("ui.settings.noteReview.filter.include.name", "Include"), includeSet, excludeSet, this._tx("ui.settings.noteReview.filter.include.empty", "No include filters selected."), false);
            const excludeBlock = mountScopeBlock(excludeHost, this._tx("ui.settings.noteReview.filter.exclude.name", "Exclude"), excludeSet, includeSet, this._tx("ui.settings.noteReview.filter.exclude.empty", "No exclude filters selected."), true);
            renderInclude = includeBlock.render;
            renderExclude = excludeBlock.render;
            refreshScopeBlocks = () => {
                renderInclude === null || renderInclude === void 0 ? void 0 : renderInclude();
                renderExclude === null || renderExclude === void 0 ? void 0 : renderExclude();
                renderIncludedNotesSummary();
            };
            renderIncludedNotesSummary();
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.noteReview.scheduling.heading", "Note scheduling"))
            .setHeading();
        new Setting(wrapper).setDesc(this._tx("ui.settings.noteReview.schedulerInfo.desc", "FSRS adapts review intervals to your recall. LKRS uses fixed day steps and a daily review target."));
        const algoSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.noteReview.algorithm.name", "Scheduling algorithm"))
            .setDesc(this._tx("ui.settings.noteReview.algorithm.desc", "Algorithm used to schedule note reviews."));
        let rerenderAlgorithmFields = null;
        algoSetting.then((s) => {
            this._addSimpleSelect(s.controlEl, {
                options: [
                    { value: "fsrs", label: this._tx("ui.settings.noteReview.algorithm.option.fsrs", "FSRS") },
                    { value: "lkrs", label: this._tx("ui.settings.noteReview.algorithm.option.lkrs", "LKRS") },
                ],
                value: noteCfg.algorithm === "lkrs" ? "lkrs" : "fsrs",
                onChange: (v) => {
                    void (async () => {
                        noteCfg.algorithm = v === "lkrs" ? "lkrs" : "fsrs";
                        await this.plugin.saveAll();
                        rerenderAlgorithmFields === null || rerenderAlgorithmFields === void 0 ? void 0 : rerenderAlgorithmFields();
                    })();
                },
            });
        });
        const dynamicHost = wrapper.createDiv({ cls: "learnkit-note-review-settings-host learnkit-note-review-settings-host" });
        const renderAlgorithmFields = () => {
            dynamicHost.empty();
            if (noteCfg.algorithm === "fsrs") {
                new Setting(dynamicHost)
                    .setName(this._tx("ui.settings.noteReview.fsrs.retention.name", "Retention target"))
                    .setDesc(this._tx("ui.settings.noteReview.fsrs.retention.desc", "Target recall probability between 0.80 and 0.97."))
                    .addSlider((s) => s
                    .setLimits(0.8, 0.97, 0.01)
                    .setValue(clamp(Number(noteCfg.fsrsRetention) || 0.9, 0.8, 0.97))
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                    noteCfg.fsrsRetention = Number(Number(v).toFixed(2));
                    await this.plugin.saveAll();
                }));
                new Setting(dynamicHost)
                    .setName(this._tx("ui.settings.noteReview.fsrs.learningSteps.name", "Learning steps (minutes)"))
                    .setDesc(this._tx("ui.settings.noteReview.fsrs.learningSteps.desc", "Comma-separated intervals in minutes. Example: 10,1440"))
                    .addText((t) => {
                    var _a;
                    return t
                        .setValue(((_a = noteCfg.fsrsLearningStepsMinutes) !== null && _a !== void 0 ? _a : [10, 1440]).join(","))
                        .onChange(async (v) => {
                        const vals = parsePositiveNumberListCsv(v);
                        noteCfg.fsrsLearningStepsMinutes = vals.length ? vals : [10, 1440];
                        await this.plugin.saveAll();
                    });
                });
                new Setting(dynamicHost)
                    .setName(this._tx("ui.settings.noteReview.fsrs.relearningSteps.name", "Relearning steps (minutes)"))
                    .setDesc(this._tx("ui.settings.noteReview.fsrs.relearningSteps.desc", "Comma-separated intervals in minutes after a lapse. Example: 10"))
                    .addText((t) => {
                    var _a;
                    return t
                        .setValue(((_a = noteCfg.fsrsRelearningStepsMinutes) !== null && _a !== void 0 ? _a : [10]).join(","))
                        .onChange(async (v) => {
                        const vals = parsePositiveNumberListCsv(v);
                        noteCfg.fsrsRelearningStepsMinutes = vals.length ? vals : [10];
                        await this.plugin.saveAll();
                    });
                });
                new Setting(dynamicHost)
                    .setName(this._tx("ui.settings.noteReview.fsrs.enableFuzz.name", "Fuzz intervals"))
                    .setDesc(this._tx("ui.settings.noteReview.fsrs.enableFuzz.desc", "Add slight randomness to note review intervals so notes due on the same day spread out."))
                    .addToggle((t) => {
                    var _a;
                    return t.setValue((_a = noteCfg.fsrsEnableFuzz) !== null && _a !== void 0 ? _a : true).onChange(async (v) => {
                        noteCfg.fsrsEnableFuzz = v;
                        await this.plugin.saveAll();
                    });
                });
                return;
            }
            new Setting(dynamicHost)
                .setName(this._tx("ui.settings.noteReview.lkrs.reviewsPerDay.name", "Reviews per day"))
                .setDesc(this._tx("ui.settings.noteReview.lkrs.reviewsPerDay.desc", "Daily target for notes reviewed in one day."))
                .addText((t) => {
                var _a;
                return t.setValue(String((_a = noteCfg.reviewsPerDay) !== null && _a !== void 0 ? _a : 10)).onChange(async (v) => {
                    const n = Math.max(1, toNonNegInt(v, 10));
                    noteCfg.reviewsPerDay = n;
                    await this.plugin.saveAll();
                });
            });
            new Setting(dynamicHost)
                .setName(this._tx("ui.settings.noteReview.lkrs.steps.name", "Review steps (days)"))
                .setDesc(this._tx("ui.settings.noteReview.lkrs.steps.desc", "Comma-separated intervals in days. Example: 1,7,30,365"))
                .addText((t) => {
                var _a;
                return t.setValue(((_a = noteCfg.reviewStepsDays) !== null && _a !== void 0 ? _a : [1, 7, 30, 365]).join(",")).onChange(async (v) => {
                    const vals = parsePositiveNumberListCsv(v);
                    noteCfg.reviewStepsDays = vals.length ? vals : [1, 7, 30, 365];
                    await this.plugin.saveAll();
                });
            });
            new Setting(dynamicHost)
                .setName(this._tx("ui.settings.noteReview.lkrs.fill.name", "Fill session when under daily limit"))
                .setDesc(this._tx("ui.settings.noteReview.lkrs.fill.desc", "If due notes are fewer than the daily target, pull slightly future notes."))
                .addToggle((t) => t.setValue(noteCfg.fillFromFutureWhenUnderLimit !== false).onChange(async (v) => {
                noteCfg.fillFromFutureWhenUnderLimit = !!v;
                await this.plugin.saveAll();
            }));
        };
        rerenderAlgorithmFields = renderAlgorithmFields;
        renderAlgorithmFields();
    }
    renderStudyAssistantSection(wrapper) {
        var _a;
        const dependentSettings = [];
        const provider = this.plugin.settings.studyAssistant.provider;
        const getOpenRouterTier = () => this._normaliseOpenRouterTier(this.plugin.settings.studyAssistant.openRouterTier);
        const modelLikelySupportsVision = (rawModel) => {
            const model = String(rawModel || "").toLowerCase();
            if (!model)
                return false;
            return [
                "vision",
                "vl",
                "gpt-4o",
                "gpt-4.1",
                "gpt-5",
                "o1",
                "o3",
                "o4",
                "claude",
                "sonnet",
                "opus",
                "haiku",
                "gemini",
                "pixtral",
                "llava",
            ].some((token) => model.includes(token));
        };
        const staticModelOptions = {
            openai: [
                { value: "gpt-5", label: "GPT-5" },
                { value: "gpt-5-mini", label: "GPT-5 Mini" },
                { value: "gpt-5-nano", label: "GPT-5 Nano" },
                { value: "gpt-4.1", label: "GPT-4.1" },
                { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
            ],
            deepseek: [
                { value: "deepseek-chat", label: "DeepSeek Chat" },
                { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
            ],
            anthropic: [
                { value: "claude-opus-4-1", label: "Claude Opus 4.1" },
                { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
                { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
            ],
            xai: [
                { value: "grok-4", label: "Grok 4" },
                { value: "grok-3", label: "Grok 3" },
                { value: "grok-3-mini", label: "Grok 3 Mini" },
            ],
            google: [
                { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
                { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
                { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
            ],
            perplexity: [
                { value: "sonar", label: "Sonar" },
                { value: "sonar-pro", label: "Sonar Pro" },
                { value: "sonar-reasoning", label: "Sonar Reasoning" },
                { value: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
            ],
        };
        const getProviderModelOptions = (selectedProvider) => {
            if (selectedProvider === "custom")
                return [];
            if (selectedProvider === "openrouter") {
                return this._getOpenRouterModelOptions(getOpenRouterTier());
            }
            return staticModelOptions[selectedProvider];
        };
        const withDependentSetting = (setting) => {
            dependentSettings.push(setting);
            return setting;
        };
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.info.name", "API Keys"))
            .setDesc(this._tx("ui.settings.studyAssistant.info.desc", "Companion uses a bring-your-own API key model. Cost depends on the provider and model. " +
            "Free and paid providers are supported — Google, OpenRouter, Anthropic, OpenAI, Perplexity, and more. " +
            "No subscription fees or API markups. For a free start, try Auto Router on OpenRouter."));
        new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.enableSprig", "Enable Companion")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.enabled.name", "Companion"))
            .setDesc(this._tx("ui.settings.studyAssistant.enabled.desc", "Toggle Companion on or off. Requires an API key."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.enabled).onChange(async (value) => {
            var _a;
            this.plugin.settings.studyAssistant.enabled = !!value;
            await this.plugin.saveAll();
            this.plugin.refreshAssistantPopupFromSettings();
            this.queueSettingsNotice("studyAssistant.enabled", this._tx("ui.settings.studyAssistant.notice.enabled", "Companion: {state}", {
                state: value ? this._tx("ui.common.on", "On") : this._tx("ui.common.off", "Off"),
            }));
            (_a = this.onRequestRerender) === null || _a === void 0 ? void 0 : _a.call(this);
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.modalButtonVisibility.name", "Button visibility"))
            .setDesc(this._tx("ui.settings.studyAssistant.modalButtonVisibility.desc", "Control when the Companion button appears in note workspaces."))
            .then((setting) => {
            this._addSimpleSelect(setting.controlEl, {
                options: [
                    { value: "hidden", label: this._tx("ui.settings.studyAssistant.modalButtonVisibility.hidden", "Always hidden") },
                    { value: "hover", label: this._tx("ui.settings.studyAssistant.modalButtonVisibility.hover", "On hover") },
                    { value: "always", label: this._tx("ui.settings.studyAssistant.modalButtonVisibility.always", "Always visible") },
                ],
                value: this.plugin.settings.studyAssistant.modalButtonVisibility,
                onChange: (value) => {
                    this.plugin.settings.studyAssistant.modalButtonVisibility = value === "hidden" || value === "hover" ? value : "always";
                    void this.plugin.saveAll().then(() => this.plugin.refreshAssistantPopupFromSettings());
                },
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.sidebarWidgetInfo.name", "Sidebar widget"))
            .setDesc(this._tx("ui.settings.studyAssistant.widgetLaunchInfo.desc", "Open the Companion widget from the command palette to use it in the sidebar."));
        new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.provider", "AI Provider")).setHeading();
        const standardProviderOptionsUnsorted = [
            { value: "anthropic", label: "Anthropic" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "google", label: "Google" },
            { value: "xai", label: "xAI" },
            { value: "openrouter", label: "OpenRouter" },
            { value: "openai", label: "OpenAI" },
            { value: "perplexity", label: "Perplexity" },
        ];
        const standardProviderOptions = [...standardProviderOptionsUnsorted]
            .sort((a, b) => a.label.localeCompare(b.label));
        const providerOptions = [
            ...standardProviderOptions,
            { value: "custom", label: "Custom" },
        ];
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.provider.name", "AI provider"))
            .setDesc(this._tx("ui.settings.studyAssistant.provider.desc", "Set the AI provider for Companion."))
            .then((setting) => {
            this._addSimpleSelect(setting.controlEl, {
                options: providerOptions,
                value: this.plugin.settings.studyAssistant.provider,
                separatorAfterIndex: standardProviderOptions.length - 1,
                onChange: (value) => {
                    const next = value === "openai" || value === "deepseek" || value === "anthropic" || value === "xai" || value === "google" || value === "perplexity" || value === "openrouter" || value === "custom"
                        ? value
                        : "openai";
                    const previousProvider = this.plugin.settings.studyAssistant.provider;
                    const previousModel = String(this.plugin.settings.studyAssistant.model || "").trim();
                    this.plugin.settings.studyAssistant.provider = next;
                    if (next !== "custom") {
                        const nextProviderModels = getProviderModelOptions(next);
                        const nextValues = nextProviderModels.map((m) => m.value);
                        if (!previousModel || previousProvider !== next) {
                            this.plugin.settings.studyAssistant.model = nextValues[0] || "";
                        }
                        if (this.plugin.settings.studyAssistant.model && !nextValues.includes(this.plugin.settings.studyAssistant.model)) {
                            this.plugin.settings.studyAssistant.model = nextValues[0] || this.plugin.settings.studyAssistant.model;
                        }
                    }
                    void this.plugin.saveAll();
                    this._softRerender();
                },
            });
        }));
        if (provider === "openrouter") {
            withDependentSetting(new Setting(wrapper)
                .setName(this._tx("ui.settings.studyAssistant.openrouter.tier.name", "OpenRouter model catalog"))
                .setDesc(this._tx("ui.settings.studyAssistant.openrouter.tier.desc", "Show Free or Paid models. Router models stay pinned at the top."))
                .then((setting) => {
                this._addSimpleSelect(setting.controlEl, {
                    options: [
                        { value: "free", label: "Free" },
                        { value: "paid", label: "Paid" },
                    ],
                    value: getOpenRouterTier(),
                    onChange: (value) => {
                        var _a;
                        this.plugin.settings.studyAssistant.openRouterTier = value === "paid" ? "paid" : "free";
                        const available = this._getOpenRouterModelOptions(getOpenRouterTier());
                        if (!available.some((model) => model.value === this.plugin.settings.studyAssistant.model)) {
                            this.plugin.settings.studyAssistant.model = ((_a = available[0]) === null || _a === void 0 ? void 0 : _a.value) || "";
                        }
                        void this.plugin.saveAll();
                        this._softRerender();
                    },
                });
            }));
            if (!this._openRouterModelsCache && !this._openRouterModelsLoading) {
                void this._loadOpenRouterModels();
            }
        }
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.model.name", "Model"))
            .setDesc(this._tx("ui.settings.studyAssistant.model.desc", "Set the model for the selected provider."))
            .then((setting) => {
            var _a, _b;
            if (provider === "custom") {
                setting.controlEl.empty();
                setting.addText((text) => {
                    text.setValue(this.plugin.settings.studyAssistant.model || "");
                    text.onChange(async (value) => {
                        this.plugin.settings.studyAssistant.model = String(value || "").trim();
                        await this.plugin.saveAll();
                    });
                });
                return;
            }
            const models = getProviderModelOptions(provider);
            const sortedModels = provider === "openrouter"
                ? [...models]
                : [...models].sort((a, b) => a.label.localeCompare(b.label));
            const currentModel = String(this.plugin.settings.studyAssistant.model || "").trim();
            const modelOptions = [...sortedModels];
            if (currentModel && !sortedModels.some((model) => model.value === currentModel)) {
                modelOptions.push({
                    value: currentModel,
                    label: `${this._formatModelLabel(currentModel)} (custom)`,
                });
                modelOptions.sort((a, b) => a.label.localeCompare(b.label));
            }
            if (provider === "openrouter") {
                if (!modelOptions.length) {
                    setting.setDesc(this._openRouterModelsLoading
                        ? this._tx("ui.settings.studyAssistant.openrouter.loading", "Loading OpenRouter models. You can still enter a model ID manually.")
                        : this._openRouterModelsError
                            ? this._tx("ui.settings.studyAssistant.openrouter.loadError", "Could not load OpenRouter models right now. Enter a model ID manually.")
                            : this._tx("ui.settings.studyAssistant.openrouter.model.desc", "Pick an OpenRouter model. Display names are readable, IDs stay API-correct."));
                    setting.controlEl.empty();
                    setting.addText((text) => {
                        text.setValue(currentModel);
                        text.setPlaceholder(this._tx("ui.settings.studyAssistant.openrouter.placeholder", "OpenRouter model ID (e.g., openai/gpt-4o-mini)"));
                        text.onChange(async (value) => {
                            this.plugin.settings.studyAssistant.model = String(value || "").trim();
                            await this.plugin.saveAll();
                        });
                    });
                    return;
                }
                const modelAnchor = setting.settingEl;
                this._addSearchablePopover(wrapper, {
                    name: this._tx("ui.settings.studyAssistant.model.name", "Model"),
                    description: this._tx("ui.settings.studyAssistant.openrouter.model.desc", "Pick an OpenRouter model. Display names are readable, IDs stay API-correct."),
                    options: modelOptions,
                    value: currentModel || ((_a = modelOptions[0]) === null || _a === void 0 ? void 0 : _a.value) || "",
                    onChange: (value) => {
                        this.plugin.settings.studyAssistant.model = String(value || "").trim();
                        void this.plugin.saveAll();
                    },
                });
                const inserted = wrapper.lastElementChild;
                if (inserted && inserted !== modelAnchor) {
                    wrapper.insertBefore(inserted, modelAnchor.nextSibling);
                }
                modelAnchor.remove();
                return;
            }
            this._addSimpleSelect(setting.controlEl, {
                options: modelOptions,
                value: currentModel || ((_b = modelOptions[0]) === null || _b === void 0 ? void 0 : _b.value) || "",
                onChange: (value) => {
                    this.plugin.settings.studyAssistant.model = String(value || "").trim();
                    void this.plugin.saveAll();
                },
            });
        }));
        if (provider === "custom") {
            withDependentSetting(new Setting(wrapper)
                .setName(this._tx("ui.settings.studyAssistant.endpointOverride.name", "Endpoint override"))
                .setDesc(this._tx("ui.settings.studyAssistant.endpointOverride.custom.desc", "Required custom base URL for your endpoint."))
                .addText((text) => {
                text.setValue(this.plugin.settings.studyAssistant.endpointOverride || "");
                text.onChange(async (value) => {
                    this.plugin.settings.studyAssistant.endpointOverride = String(value || "").trim();
                    await this.plugin.saveAll();
                });
            }));
        }
        const providerKeyField = {
            openai: { key: "openai", label: "OpenAI API key", placeholder: "sk-..." },
            deepseek: { key: "deepseek", label: "DeepSeek API key", placeholder: "sk-..." },
            anthropic: { key: "anthropic", label: "Anthropic API key", placeholder: "sk-ant-..." },
            xai: { key: "xai", label: "xAI API key", placeholder: "xai-..." },
            google: { key: "google", label: "Google API key", placeholder: "AIza..." },
            perplexity: { key: "perplexity", label: "Perplexity API key", placeholder: "pplx-..." },
            openrouter: { key: "openrouter", label: "OpenRouter API key", placeholder: "sk-or-..." },
            custom: { key: "custom", label: "Custom API key", placeholder: "sk-..." },
        };
        const currentKeyField = providerKeyField[provider];
        const currentKeyToken = String(currentKeyField.key);
        const pluginId = ((_a = this.plugin.manifest) === null || _a === void 0 ? void 0 : _a.id) || "sprout";
        const apiKeysPath = `.obsidian/plugins/${pluginId}/configuration/api-keys.json`;
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx(`ui.settings.studyAssistant.keys.${currentKeyToken}.name`, currentKeyField.label))
            .setDesc(this._tx(`ui.settings.studyAssistant.keys.${currentKeyToken}.desc`, "Stored at {path}. Add this file to .gitignore if syncing with Git.", { path: apiKeysPath }))
            .addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "off";
            text.setPlaceholder(currentKeyField.placeholder);
            text.setValue(this.plugin.settings.studyAssistant.apiKeys[currentKeyField.key] || "");
            text.onChange(async (value) => {
                this.plugin.settings.studyAssistant.apiKeys[currentKeyField.key] = String(value || "").trim();
                await this.plugin.saveAll();
            });
        }));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.saveChatHistory.name", "Save chat history"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.saveChatHistory.desc", "Save chats per note so they reopen in future sessions."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.saveChatHistory).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.saveChatHistory = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.syncDeletesToProvider.name", "Delete chats on provider too"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.syncDeletesToProvider.desc", "When supported, deleting or resetting chats also requests deletion from the provider."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.syncDeletesToProvider).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.syncDeletesToProvider = !!value;
            await this.plugin.saveAll();
        })));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.sections.contextFiles", "Context sources"))
            .setHeading();
        const contextLimitOptions = [
            { value: "conservative", label: this._tx("ui.settings.studyAssistant.privacy.contextLimit.conservative", "Conservative") },
            { value: "standard", label: this._tx("ui.settings.studyAssistant.privacy.contextLimit.standard", "Standard") },
            { value: "extended", label: this._tx("ui.settings.studyAssistant.privacy.contextLimit.extended", "Extended") },
            { value: "none", label: this._tx("ui.settings.studyAssistant.privacy.contextLimit.none", "No limit") },
        ];
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.linkedContextLimit.name", "Linked notes context limit"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.linkedContextLimit.desc", "Set how much linked note text to include. Conservative: 3 notes / 12k chars. Standard: 6 / 30k. Extended: 12 / 60k. No limit: all."))
            .then((s) => {
            this._addSimpleSelect(s.controlEl, {
                options: contextLimitOptions,
                value: this.plugin.settings.studyAssistant.privacy.linkedContextLimit || "standard",
                onChange: (value) => {
                    void (async () => {
                        this.plugin.settings.studyAssistant.privacy.linkedContextLimit = value;
                        await this.plugin.saveAll();
                    })();
                },
            });
        }));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.textAttachmentContextLimit.name", "Text attachment context limit"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.textAttachmentContextLimit.desc", "Set how much attached file text to include. Conservative: 3 files / 18k chars. Standard: 6 / 48k. Extended: 12 / 96k. No limit: all."))
            .then((s) => {
            this._addSimpleSelect(s.controlEl, {
                options: contextLimitOptions,
                value: this.plugin.settings.studyAssistant.privacy.textAttachmentContextLimit || "standard",
                onChange: (value) => {
                    void (async () => {
                        this.plugin.settings.studyAssistant.privacy.textAttachmentContextLimit = value;
                        await this.plugin.saveAll();
                    })();
                },
            });
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.sections.companionContextFiles", "Companion sources"))
            .setHeading();
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.includeAttachmentsInCompanion.name", "Include embedded attachments"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.includeAttachmentsInCompanion.desc", "Send embedded files from the current note such as PDFs or images. Not all models support attachments."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeAttachmentsInCompanion).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeAttachmentsInCompanion = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.includeLinkedNotesInCompanion.name", "Include linked notes as text"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.includeLinkedNotesInCompanion.desc", "Send linked notes from the current note as plain text. Nested links are excluded. Works with all models."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeLinkedNotesInCompanion).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeLinkedNotesInCompanion = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.includeLinkedAttachmentsInCompanion.name", "Include linked attachments"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.includeLinkedAttachmentsInCompanion.desc", "Send non-markdown files linked from the current note. Not all models support attachments."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeLinkedAttachmentsInCompanion).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeLinkedAttachmentsInCompanion = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.prompts.companion.name", "Custom instructions"))
            .setDesc(this._tx("ui.settings.studyAssistant.prompts.companion.desc", "Extra instructions sent to Companion as plain text."))
            .addTextArea((text) => {
            text.inputEl.placeholder = this._tx("ui.settings.studyAssistant.prompts.placeholder", "Enter custom instructions here");
            text.setValue(this.plugin.settings.studyAssistant.prompts.assistant || "");
            text.onChange(async (value) => {
                this.plugin.settings.studyAssistant.prompts.assistant = String(value || "");
                await this.plugin.saveAll();
            });
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.sections.testsContextFiles", "Test sources"))
            .setHeading();
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.includeAttachmentsInExam.name", "Include embedded attachments"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.includeAttachmentsInExam.desc", "Send embedded files from test source notes such as PDFs or images. Not all models support attachments."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeAttachmentsInExam).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeAttachmentsInExam = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.includeLinkedNotesInExam.name", "Include linked notes as text"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.includeLinkedNotesInExam.desc", "Send linked notes from test source notes as plain text. Nested links are excluded. Works with all models."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeLinkedNotesInExam).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeLinkedNotesInExam = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.privacy.includeLinkedAttachmentsInExam.name", "Include linked attachments"))
            .setDesc(this._tx("ui.settings.studyAssistant.privacy.includeLinkedAttachmentsInExam.desc", "Send non-markdown files linked from test source notes. Not all models support attachments."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.privacy.includeLinkedAttachmentsInExam).onChange(async (value) => {
            this.plugin.settings.studyAssistant.privacy.includeLinkedAttachmentsInExam = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.prompts.tests.name", "Custom instructions"))
            .setDesc(this._tx("ui.settings.studyAssistant.prompts.tests.desc", "Extra instructions for test generation. Sent as plain text."))
            .addTextArea((text) => {
            text.inputEl.placeholder = this._tx("ui.settings.studyAssistant.prompts.placeholder", "Enter custom instructions here");
            text.setValue(this.plugin.settings.studyAssistant.prompts.tests || "");
            text.onChange(async (value) => {
                this.plugin.settings.studyAssistant.prompts.tests = String(value || "");
                await this.plugin.saveAll();
            });
        }));
        const flashcardModelIsVisionCapable = modelLikelySupportsVision(this.plugin.settings.studyAssistant.model);
        withDependentSetting(new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.flashcardGeneration", "Flashcard generation")).setHeading());
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.generatorTargetCount.name", "Target number of cards"))
            .setDesc(this._tx("ui.settings.studyAssistant.generatorTargetCount.desc", "Set a target between 1 and 10 cards. Results may vary slightly."))
            .addSlider((s) => s
            .setLimits(1, 10, 1)
            .setValue(Math.max(1, Math.min(10, Math.round(Number(this.plugin.settings.studyAssistant.generatorTargetCount) || 5))))
            .setDynamicTooltip()
            .onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorTargetCount = Math.max(1, Math.min(10, Math.round(Number(value) || 5)));
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.generatorTypes", "Flashcard types to generate")).setHeading());
        const cardTypes = [
            { key: "basic", label: "Basic" },
            { key: "reversed", label: "Basic (reversed)" },
            { key: "cloze", label: "Cloze" },
            { key: "mcq", label: "Multiple choice" },
            { key: "oq", label: "Ordered question" },
            { key: "io", label: "Image occlusion" },
        ];
        for (const type of cardTypes) {
            if (type.key === "io" && !flashcardModelIsVisionCapable)
                continue;
            const typeToken = String(type.key);
            const typeDesc = type.key === "io"
                ? this._tx("ui.settings.studyAssistant.generatorTypes.io.desc", "Turn off to skip this card type. Image occlusion needs a vision-capable model, and generated masks may still need manual adjustment in the flashcard editor.")
                : this._tx(`ui.settings.studyAssistant.generatorTypes.${typeToken}.desc`, "Turn off to skip this card type.");
            withDependentSetting(new Setting(wrapper)
                .setName(this._tx(`ui.settings.studyAssistant.generatorTypes.${typeToken}.name`, type.label))
                .setDesc(typeDesc)
                .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.generatorTypes[type.key]).onChange(async (value) => {
                this.plugin.settings.studyAssistant.generatorTypes[type.key] = !!value;
                await this.plugin.saveAll();
            })));
        }
        withDependentSetting(new Setting(wrapper).setName(this._tx("ui.settings.studyAssistant.sections.generatorOutput", "Optional flashcard fields")).setHeading());
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.generatorOutput.title.name", "Include titles"))
            .setDesc(this._tx("ui.settings.studyAssistant.generatorOutput.title.desc", "Add title rows to generated flashcards."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.generatorOutput.includeTitle).onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorOutput.includeTitle = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.generatorOutput.info.name", "Include extra information"))
            .setDesc(this._tx("ui.settings.studyAssistant.generatorOutput.info.desc", "Add extra information rows to generated flashcards."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.generatorOutput.includeInfo).onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorOutput.includeInfo = !!value;
            await this.plugin.saveAll();
        })));
        withDependentSetting(new Setting(wrapper)
            .setName(this._tx("ui.settings.studyAssistant.generatorOutput.groups.name", "Include groups"))
            .setDesc(this._tx("ui.settings.studyAssistant.generatorOutput.groups.desc", "Add group rows to generated flashcards."))
            .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.studyAssistant.generatorOutput.includeGroups).onChange(async (value) => {
            this.plugin.settings.studyAssistant.generatorOutput.includeGroups = !!value;
            await this.plugin.saveAll();
        })));
        const enabled = !!this.plugin.settings.studyAssistant.enabled;
        for (const setting of dependentSettings)
            setting.setDisabled(!enabled);
    }
    _formatModelLabel(rawModel) {
        const input = String(rawModel || "").trim();
        if (!input)
            return "";
        const base = input.includes("/") ? input.split("/").slice(1).join("/") : input;
        const clean = base.replace(/:free$/i, "");
        const parts = clean.split(/[\s._:/-]+/g).filter(Boolean);
        const acronyms = new Map([
            ["gpt", "GPT"],
            ["ai", "AI"],
            ["api", "API"],
            ["r1", "R1"],
            ["vl", "VL"],
            ["llama", "Llama"],
            ["qwen", "Qwen"],
            ["sonnet", "Sonnet"],
            ["opus", "Opus"],
            ["haiku", "Haiku"],
            ["gemini", "Gemini"],
            ["deepseek", "DeepSeek"],
        ]);
        return parts
            .map((part) => {
            const lower = part.toLowerCase();
            const mapped = acronyms.get(lower);
            if (mapped)
                return mapped;
            if (/^[0-9]+[a-z]?$/i.test(part))
                return part.toUpperCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
            .join(" ");
    }
    _normaliseOpenRouterProviderLabel(rawProvider) {
        const value = String(rawProvider || "").trim().toLowerCase();
        if (value === "openai")
            return "OpenAI";
        if (value === "anthropic")
            return "Anthropic";
        if (value === "meta-llama" || value === "meta")
            return "Meta";
        if (value === "google")
            return "Google";
        if (value === "deepseek")
            return "DeepSeek";
        if (value === "mistralai" || value === "mistral")
            return "Mistral";
        if (value === "qwen")
            return "Qwen";
        if (value === "x-ai" || value === "xai")
            return "xAI";
        return this._formatModelLabel(value);
    }
    _normaliseOpenRouterTier(rawTier) {
        return rawTier === "paid" ? "paid" : "free";
    }
    _getOpenRouterModelOptions(tier) {
        var _a;
        const models = (_a = this._openRouterModelsCache) !== null && _a !== void 0 ? _a : [];
        if (!models.length)
            return [];
        const ROUTER_FREE_ID = "openrouter/free";
        const ROUTER_AUTO_ID = "openrouter/auto";
        const ROUTER_SWITCHPOINT_ID = "switchpoint/router";
        const ROUTER_BODYBUILDER_ID = "openrouter/bodybuilder";
        const byId = new Map(models.map((model) => [model.id, model]));
        const routerIds = tier === "free"
            ? [ROUTER_FREE_ID, ROUTER_AUTO_ID, ROUTER_BODYBUILDER_ID]
            : [ROUTER_AUTO_ID, ROUTER_SWITCHPOINT_ID, ROUTER_BODYBUILDER_ID];
        const routerOptions = [];
        if (routerIds.includes(ROUTER_FREE_ID) && byId.has(ROUTER_FREE_ID)) {
            routerOptions.push({
                value: ROUTER_FREE_ID,
                label: "Free Models Router",
                description: "Routes across currently available free models",
                section: "Router",
            });
        }
        if (routerIds.includes(ROUTER_AUTO_ID) && byId.has(ROUTER_AUTO_ID)) {
            routerOptions.push({
                value: ROUTER_AUTO_ID,
                label: "Auto Router",
                description: "Automated model selection",
                section: "Router",
            });
        }
        if (routerIds.includes(ROUTER_SWITCHPOINT_ID) && byId.has(ROUTER_SWITCHPOINT_ID)) {
            routerOptions.push({
                value: ROUTER_SWITCHPOINT_ID,
                label: "Switchpoint Router",
                description: "Flat-rate external routing engine",
                section: "Router",
            });
        }
        if (routerIds.includes(ROUTER_BODYBUILDER_ID) && byId.has(ROUTER_BODYBUILDER_ID)) {
            routerOptions.push({
                value: ROUTER_BODYBUILDER_ID,
                label: "Body Builder (beta)",
                description: "Natural language to OpenRouter request builder",
                section: "Router",
            });
        }
        const filtered = models
            .filter((model) => (tier === "free" ? model.isFree : !model.isFree))
            .filter((model) => !routerIds.includes(model.id))
            .sort((a, b) => (a.provider === b.provider ? a.name.localeCompare(b.name) : a.provider.localeCompare(b.provider)));
        const dynamicOptions = filtered.map((model) => ({
            value: model.id,
            label: this._cleanOpenRouterModelDisplayName(model.name || this._formatModelLabel(model.id)),
            description: model.id,
            section: this._normaliseOpenRouterProviderLabel(model.provider),
        }));
        return [...routerOptions, ...dynamicOptions];
    }
    _cleanOpenRouterModelDisplayName(name) {
        return String(name || "")
            .replace(/\s*\(free\)\s*$/i, "")
            .replace(/:free\s*$/i, "")
            .trim();
    }
    async _loadOpenRouterModels() {
        if (this._openRouterModelsLoading)
            return;
        this._openRouterModelsLoading = true;
        this._openRouterModelsError = null;
        try {
            const res = await requestUrl({
                url: "https://openrouter.ai/api/v1/models",
                method: "GET",
                headers: { Accept: "application/json" },
            });
            if (res.status < 200 || res.status >= 300) {
                throw new Error(`HTTP ${res.status}`);
            }
            const rawJson = res.json && typeof res.json === "object" ? res.json : {};
            const root = rawJson;
            const rawModels = Array.isArray(root === null || root === void 0 ? void 0 : root.data) ? root.data : [];
            const parsed = [];
            for (const entry of rawModels) {
                if (!entry || typeof entry !== "object")
                    continue;
                const model = entry;
                const idRaw = model.id;
                const id = typeof idRaw === "string"
                    ? idRaw.trim()
                    : typeof idRaw === "number"
                        ? String(idRaw)
                        : "";
                if (!id)
                    continue;
                const pricing = model.pricing && typeof model.pricing === "object"
                    ? model.pricing
                    : {};
                const promptRaw = pricing.prompt;
                const completionRaw = pricing.completion;
                const promptPrice = Number.parseFloat(typeof promptRaw === "string" || typeof promptRaw === "number" ? String(promptRaw) : "0");
                const completionPrice = Number.parseFloat(typeof completionRaw === "string" || typeof completionRaw === "number" ? String(completionRaw) : "0");
                const isFreeByPrice = Number.isFinite(promptPrice) && Number.isFinite(completionPrice) && promptPrice <= 0 && completionPrice <= 0;
                const isFree = isFreeByPrice || /:free$/i.test(id);
                const provider = id.includes("/") ? id.split("/")[0] : "openrouter";
                const nameRaw = model.name;
                const displayNameSource = typeof nameRaw === "string" && nameRaw.trim().length > 0
                    ? nameRaw
                    : this._formatModelLabel(id);
                const displayName = this._cleanOpenRouterModelDisplayName(displayNameSource.trim());
                parsed.push({
                    id,
                    name: displayName,
                    provider,
                    isFree,
                });
            }
            const deduped = Array.from(new Map(parsed.map((model) => [model.id, model])).values());
            this._openRouterModelsCache = deduped;
            if (this.plugin.settings.studyAssistant.provider === "openrouter") {
                const options = this._getOpenRouterModelOptions(this._normaliseOpenRouterTier(this.plugin.settings.studyAssistant.openRouterTier));
                if (options.length && !options.some((opt) => opt.value === this.plugin.settings.studyAssistant.model)) {
                    this.plugin.settings.studyAssistant.model = options[0].value;
                    await this.plugin.saveAll();
                }
            }
        }
        catch (error) {
            this._openRouterModelsError = error instanceof Error
                ? error.message
                : typeof error === "string"
                    ? error
                    : "Unknown error";
        }
        finally {
            this._openRouterModelsLoading = false;
            this._softRerender();
        }
    }
    renderSchedulingSection(wrapper) {
        // ----------------------------
        // Scheduling
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.scheduling", "Flashcard scheduling")).setHeading();
        const sched = this.plugin.settings.scheduling;
        /** Rounds a number to 2 decimal places. */
        const round2 = (n) => {
            const x = Number(n);
            if (!Number.isFinite(x))
                return NaN;
            return Number(x.toFixed(2));
        };
        /** Compares two numeric arrays for equality. */
        const arraysEqualNumbers = (a, b) => {
            if (!Array.isArray(a) || !Array.isArray(b))
                return false;
            if (a.length !== b.length)
                return false;
            for (let i = 0; i < a.length; i++) {
                if (Number(a[i]) !== Number(b[i]))
                    return false;
            }
            return true;
        };
        /* ── FSRS scheduling presets ── */
        const presets = [
            {
                key: "custom",
                label: this._tx("ui.settings.scheduling.preset.option.custom", "Custom"),
                desc: this._tx("ui.settings.scheduling.preset.option.customDesc", "Keep your current values."),
                learning: [],
                relearning: [],
                retention: 0.9,
            },
            {
                key: "relaxed",
                label: this._tx("ui.settings.scheduling.preset.option.relaxed", "Relaxed"),
                desc: this._tx("ui.settings.scheduling.preset.option.relaxedDesc", "Learning: 20m | Relearning: 20m | Retention: 0.88"),
                learning: [20],
                relearning: [20],
                retention: 0.88,
            },
            {
                key: "balanced",
                label: this._tx("ui.settings.scheduling.preset.option.balanced", "Balanced"),
                desc: this._tx("ui.settings.scheduling.preset.option.balancedDesc", "Learning: 10m, 1d | Relearning: 10m | Retention: 0.90"),
                learning: [10, 1440],
                relearning: [10],
                retention: 0.9,
            },
            {
                key: "aggressive",
                label: this._tx("ui.settings.scheduling.preset.option.aggressive", "Aggressive"),
                desc: this._tx("ui.settings.scheduling.preset.option.aggressiveDesc", "Learning: 5m, 30m, 1d | Relearning: 10m | Retention: 0.92"),
                learning: [5, 30, 1440],
                relearning: [10],
                retention: 0.92,
            },
        ];
        const selectOptions = presets.map((p) => ({ value: p.key, label: p.label }));
        /** Detects which preset matches the current scheduling parameters. */
        const detectPresetKey = () => {
            var _a, _b, _c;
            const curLearning = (_a = sched.learningStepsMinutes) !== null && _a !== void 0 ? _a : [];
            const curRelearning = (_b = sched.relearningStepsMinutes) !== null && _b !== void 0 ? _b : [];
            const curRetention = round2(sched.requestRetention);
            for (const p of presets) {
                if (p.key === "custom")
                    continue;
                if (arraysEqualNumbers(curLearning, p.learning) &&
                    arraysEqualNumbers(curRelearning, (_c = p.relearning) !== null && _c !== void 0 ? _c : []) &&
                    round2(p.retention) === curRetention) {
                    return p.key;
                }
            }
            return "custom";
        };
        let presetHandle = null;
        let isSyncingPreset = false;
        // Handles for programmatic UI sync when a preset is applied
        let learningStepsInput = null;
        let relearningStepsInput = null;
        let retentionSlider = null;
        /** Push current sched values into the input controls. */
        const syncInputs = () => {
            var _a, _b;
            learningStepsInput === null || learningStepsInput === void 0 ? void 0 : learningStepsInput.setValue(String(((_a = sched.learningStepsMinutes) !== null && _a !== void 0 ? _a : []).join(",")));
            relearningStepsInput === null || relearningStepsInput === void 0 ? void 0 : relearningStepsInput.setValue(String(((_b = sched.relearningStepsMinutes) !== null && _b !== void 0 ? _b : []).join(",")));
            retentionSlider === null || retentionSlider === void 0 ? void 0 : retentionSlider.setValue(clamp(Number(sched.requestRetention) || 0.9, 0.8, 0.97));
        };
        /** Programmatically syncs the preset dropdown to match current values. */
        const syncPresetDropdown = () => {
            if (!presetHandle)
                return;
            const desired = detectPresetKey();
            const current = presetHandle.getValue();
            if (current === desired)
                return;
            isSyncingPreset = true;
            try {
                presetHandle.setValue(desired);
            }
            finally {
                isSyncingPreset = false;
            }
        };
        new Setting(wrapper)
            .setName(this._tx("ui.settings.scheduling.preset.name", "Preset"))
            .setDesc(this._tx("ui.settings.scheduling.preset.desc", "Apply a preset to learning steps, relearning steps, and retention. Choose Custom to keep current values."))
            .then((s) => {
            presetHandle = this._addSimpleSelect(s.controlEl, {
                options: selectOptions,
                separatorAfterIndex: 0,
                value: detectPresetKey(),
                onChange: (key) => {
                    void (async () => {
                        var _a, _b, _c;
                        if (isSyncingPreset)
                            return;
                        const p = presets.find((x) => x.key === key);
                        if (!p)
                            return;
                        if (p.key === "custom") {
                            this.queueSettingsNotice("scheduling.preset", this._noticeLines.fsrsPresetCustom);
                            await this.plugin.saveAll();
                            return;
                        }
                        const prevLearning = ((_a = sched.learningStepsMinutes) !== null && _a !== void 0 ? _a : []).slice();
                        const prevRelearning = ((_b = sched.relearningStepsMinutes) !== null && _b !== void 0 ? _b : []).slice();
                        const prevRetention = sched.requestRetention;
                        sched.learningStepsMinutes = p.learning.slice();
                        sched.relearningStepsMinutes = ((_c = p.relearning) !== null && _c !== void 0 ? _c : []).slice();
                        sched.requestRetention = p.retention;
                        syncInputs();
                        await this.plugin.saveAll();
                        this.queueSettingsNotice("scheduling.preset", this._noticeLines.fsrsPreset(p.label), 0);
                        if (!arraysEqualNumbers(prevLearning, sched.learningStepsMinutes)) {
                            this.queueSettingsNotice("scheduler.learningStepsMinutes", this._noticeLines.learningSteps(sched.learningStepsMinutes));
                        }
                        if (!arraysEqualNumbers(prevRelearning, sched.relearningStepsMinutes)) {
                            this.queueSettingsNotice("scheduler.relearningStepsMinutes", this._noticeLines.relearningSteps(sched.relearningStepsMinutes));
                        }
                        if (round2(prevRetention) !== round2(sched.requestRetention)) {
                            this.queueSettingsNotice("scheduler.requestRetention", this._noticeLines.requestRetention(sched.requestRetention));
                        }
                    })();
                },
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.scheduling.learningSteps.name", "Learning steps"))
            .setDesc(this._tx("ui.settings.scheduling.learningSteps.desc", "Comma-separated learning intervals in minutes."))
            .addText((t) => {
            var _a;
            learningStepsInput = t;
            t.setValue(String(((_a = sched.learningStepsMinutes) !== null && _a !== void 0 ? _a : []).join(","))).onChange(async (v) => {
                var _a, _b;
                const prev = ((_a = sched.learningStepsMinutes) !== null && _a !== void 0 ? _a : []).slice();
                const arr = parsePositiveNumberListCsv(v);
                if (arr.length)
                    sched.learningStepsMinutes = arr;
                await this.plugin.saveAll();
                syncPresetDropdown();
                if (!arraysEqualNumbers(prev, (_b = sched.learningStepsMinutes) !== null && _b !== void 0 ? _b : [])) {
                    this.queueSettingsNotice("scheduler.learningStepsMinutes", this._noticeLines.learningSteps(sched.learningStepsMinutes));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.scheduling.relearningSteps.name", "Relearning steps"))
            .setDesc(this._tx("ui.settings.scheduling.relearningSteps.desc", "Comma-separated minutes used after lapses."))
            .addText((t) => {
            var _a;
            relearningStepsInput = t;
            t.setValue(String(((_a = sched.relearningStepsMinutes) !== null && _a !== void 0 ? _a : []).join(","))).onChange(async (v) => {
                var _a, _b;
                const prev = ((_a = sched.relearningStepsMinutes) !== null && _a !== void 0 ? _a : []).slice();
                const arr = parsePositiveNumberListCsv(v);
                if (arr.length)
                    sched.relearningStepsMinutes = arr;
                await this.plugin.saveAll();
                syncPresetDropdown();
                if (!arraysEqualNumbers(prev, (_b = sched.relearningStepsMinutes) !== null && _b !== void 0 ? _b : [])) {
                    this.queueSettingsNotice("scheduler.relearningStepsMinutes", this._noticeLines.relearningSteps(sched.relearningStepsMinutes));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.scheduling.requestedRetention.name", "Requested retention"))
            .setDesc(this._tx("ui.settings.scheduling.requestedRetention.desc", "Target recall probability at review time. Typical range: 0.85-0.95."))
            .addSlider((s) => {
            retentionSlider = s;
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
                    this.queueSettingsNotice("scheduler.requestRetention", this._noticeLines.requestRetention(sched.requestRetention));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.scheduling.enableFuzz.name", "Fuzz intervals"))
            .setDesc(this._tx("ui.settings.scheduling.enableFuzz.desc", "Add slight randomness to review intervals so cards due on the same day spread out."))
            .addToggle((t) => {
            var _a;
            return t.setValue((_a = sched.enableFuzz) !== null && _a !== void 0 ? _a : true).onChange(async (v) => {
                sched.enableFuzz = v;
                await this.plugin.saveAll();
            });
        });
        // ----------------------------
        // Optimisation
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.optimisation", "Optimisation")).setHeading();
        const hasWeights = () => {
            const weights = sched.fsrsWeights;
            if (!Array.isArray(weights))
                return false;
            return weights.length > 0;
        };
        const optimiseDesc = () => hasWeights()
            ? this._tx("ui.settings.optimisation.optimise.descActive", "Personalised FSRS parameters are active. The algorithm uses weights trained on your review history to predict your forgetting curve. This works alongside any preset above.")
            : this._tx("ui.settings.optimisation.optimise.desc", "Train FSRS parameters on your review history to personalise how intervals are calculated. This improves scheduling accuracy without changing your learning steps, retention, or preset. 250+ graded reviews recommended for best results.");
        const optimiseSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.optimisation.optimise.name", "Optimise FSRS parameters"))
            .setDesc(optimiseDesc());
        // "Optimise…" button
        let optimiseBtn = null;
        optimiseSetting.addButton((b) => {
            optimiseBtn = b.buttonEl;
            b.setButtonText(hasWeights()
                ? this._tx("ui.settings.optimisation.optimise.buttonRerun", "Re-optimise…")
                : this._tx("ui.settings.optimisation.optimise.button", "Optimise…")).onClick(() => {
                void (async () => {
                    var _a;
                    const { optimizeFsrsWeights } = await import("../../engine/scheduler/fsrs-optimizer");
                    const reviewLog = (_a = this.plugin.store.data.reviewLog) !== null && _a !== void 0 ? _a : [];
                    b.setButtonText(this._tx("ui.settings.optimisation.optimise.running", "Optimising…"));
                    b.setDisabled(true);
                    if (clearBtn)
                        clearBtn.disabled = true;
                    // Yield to the UI before running the CPU-intensive optimizer
                    await new Promise((r) => setTimeout(r, 50));
                    try {
                        const result = optimizeFsrsWeights(reviewLog, (pct) => {
                            b.setButtonText(`${pct}%`);
                        });
                        if (!result) {
                            new Notice(this._tx("ui.settings.optimisation.optimise.insufficient", "LearnKit – No graded reviews found. Review some cards first, then try again."));
                            return;
                        }
                        sched.fsrsWeights = result.weights;
                        await this.plugin.saveAll();
                        // Update UI to reflect active state
                        optimiseSetting.setDesc(optimiseDesc());
                        b.setButtonText(this._tx("ui.settings.optimisation.optimise.buttonRerun", "Re-optimise…"));
                        if (clearBtn)
                            clearBtn.classList.remove("learnkit-settings-conditional-hidden", "learnkit-settings-conditional-hidden");
                        new Notice(this._tx("ui.settings.optimisation.optimise.success", "LearnKit – Parameters optimised from {count} reviews.", { count: String(result.reviewCount) }));
                    }
                    finally {
                        b.setDisabled(false);
                        if (clearBtn)
                            clearBtn.disabled = false;
                    }
                })();
            });
        });
        // "Clear" button — only visible when weights are active
        let clearBtn = null;
        optimiseSetting.addButton((b) => {
            clearBtn = b.buttonEl;
            b.setButtonText(this._tx("ui.settings.optimisation.optimise.clear", "Clear"))
                .setWarning()
                .onClick(async () => {
                delete sched.fsrsWeights;
                await this.plugin.saveAll();
                // Update UI to reflect cleared state
                optimiseSetting.setDesc(optimiseDesc());
                if (optimiseBtn)
                    optimiseBtn.textContent = this._tx("ui.settings.optimisation.optimise.button", "Optimise…");
                clearBtn.classList.add("learnkit-settings-conditional-hidden", "learnkit-settings-conditional-hidden");
                new Notice(this._tx("ui.settings.optimisation.optimise.cleared", "LearnKit – Optimised parameters cleared. Using default FSRS weights."));
            });
            // Hide if no weights are active
            clearBtn.classList.toggle("learnkit-settings-conditional-hidden", !hasWeights());
        });
    }
    renderStorageSection(wrapper) {
        var _a;
        var _b;
        // ----------------------------
        // Storage
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.attachmentStorage", "Attachment storage")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.storage.imageOcclusionFolder.name", "Image occlusion folder"))
            .setDesc(this._tx("ui.settings.storage.imageOcclusionFolder.desc", "Folder where image occlusion mask images are saved."))
            .addText((t) => {
            var _a, _b, _c;
            const allFolders = listVaultFolders(this.app);
            const cur = (_a = this.plugin.settings.storage.imageOcclusionFolderPath) !== null && _a !== void 0 ? _a : "Attachments/Image Occlusion/";
            t.setPlaceholder(this._tx("ui.settings.storage.imageOcclusionFolder.placeholder", "Attachments/image occlusion/"));
            t.setValue(String(cur));
            const inputEl = t.inputEl;
            const suggestWrap = (_c = (_b = inputEl.parentElement) === null || _b === void 0 ? void 0 : _b.createDiv({ cls: "learnkit-folder-suggest learnkit-folder-suggest" })) !== null && _c !== void 0 ? _c : null;
            // Lazy list element: only exists when shown
            let listEl = null;
            let activeIdx = -1;
            let lastCommitted = normaliseFolderPath(String(cur));
            let suppressBlurCommit = false;
            const ensureListEl = () => {
                if (!suggestWrap)
                    return null;
                if (!listEl) {
                    listEl = suggestWrap.createDiv({ cls: "learnkit-folder-suggest-list learnkit-folder-suggest-list" });
                }
                return listEl;
            };
            const hideList = () => {
                if (!listEl)
                    return;
                listEl.remove();
                listEl = null;
                activeIdx = -1;
            };
            /** Commits the chosen folder path to settings. */
            const commit = async (rawValue, fromPick) => {
                var _a;
                const prev = String((_a = this.plugin.settings.storage.imageOcclusionFolderPath) !== null && _a !== void 0 ? _a : "");
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
                    this.queueSettingsNotice("io.attachmentFolderPath", this._noticeLines.ioAttachmentFolder(next), fromPick ? 0 : 150);
                }
            };
            /** Renders the folder-suggestion dropdown list. */
            const renderList = (items) => {
                if (!items.length) {
                    hideList();
                    return;
                }
                const el = ensureListEl();
                if (!el)
                    return;
                el.empty();
                activeIdx = -1;
                for (let i = 0; i < items.length; i++) {
                    const p = items[i];
                    const btn = el.createEl("button", { cls: "learnkit-folder-suggest-item learnkit-folder-suggest-item", text: p });
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
            inputEl.addEventListener("keydown", (e) => {
                var _a;
                if (!listEl)
                    return;
                const items = Array.from(listEl.querySelectorAll(".learnkit-folder-suggest-item"));
                if (!items.length)
                    return;
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    activeIdx = Math.min(items.length - 1, activeIdx + 1);
                }
                else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    activeIdx = Math.max(0, activeIdx - 1);
                }
                else if (e.key === "Enter") {
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
                }
                else if (e.key === "Escape") {
                    e.preventDefault();
                    hideList();
                    return;
                }
                else {
                    return;
                }
                items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
                const active = items[activeIdx];
                (_a = active === null || active === void 0 ? void 0 : active.scrollIntoView) === null || _a === void 0 ? void 0 : _a.call(active, { block: "nearest" });
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
            .setName(this._tx("ui.settings.storage.deleteOrphanedImages.name", "Delete orphaned masks"))
            .setDesc(this._tx("ui.settings.storage.deleteOrphanedImages.desc", "Automatically remove image occlusion files during sync when their cards no longer exist."))
            .addToggle((t) => {
            var _a, _b;
            return t.setValue((_b = (_a = this.plugin.settings.storage) === null || _a === void 0 ? void 0 : _a.deleteOrphanedImages) !== null && _b !== void 0 ? _b : true).onChange(async (v) => {
                var _a, _b;
                const prev = (_b = (_a = this.plugin.settings.storage) === null || _a === void 0 ? void 0 : _a.deleteOrphanedImages) !== null && _b !== void 0 ? _b : true;
                this.plugin.settings.storage.deleteOrphanedImages = v;
                await this.plugin.saveAll();
                if (prev !== v) {
                    this.queueSettingsNotice("io.deleteOrphanedImages", this._noticeLines.deleteOrphanedImages(v));
                }
            });
        });
        new Setting(wrapper)
            .setName(this._tx("ui.settings.storage.cardAttachmentFolder.name", "Card attachment folder"))
            .setDesc(this._tx("ui.settings.storage.cardAttachmentFolder.desc", "Folder for flashcard images and media."))
            .addText((t) => {
            var _a, _b, _c;
            const allFolders = listVaultFolders(this.app);
            const cur = (_a = this.plugin.settings.storage.cardAttachmentFolderPath) !== null && _a !== void 0 ? _a : "Attachments/Cards/";
            t.setPlaceholder(this._tx("ui.settings.storage.cardAttachmentFolder.placeholder", "Attachments/card attachments/"));
            t.setValue(String(cur));
            const inputEl = t.inputEl;
            const suggestWrap = (_c = (_b = inputEl.parentElement) === null || _b === void 0 ? void 0 : _b.createDiv({ cls: "learnkit-folder-suggest learnkit-folder-suggest" })) !== null && _c !== void 0 ? _c : null;
            // Lazy list element: only exists when shown
            let listEl = null;
            let activeIdx = -1;
            let lastCommitted = normaliseFolderPath(String(cur));
            let suppressBlurCommit = false;
            const ensureListEl = () => {
                if (!suggestWrap)
                    return null;
                if (!listEl) {
                    listEl = suggestWrap.createDiv({ cls: "learnkit-folder-suggest-list learnkit-folder-suggest-list" });
                }
                return listEl;
            };
            const hideList = () => {
                if (!listEl)
                    return;
                listEl.remove();
                listEl = null;
                activeIdx = -1;
            };
            /** Commits the chosen folder path to settings. */
            const commit = async (rawValue, fromPick) => {
                var _a;
                const prev = String((_a = this.plugin.settings.storage.cardAttachmentFolderPath) !== null && _a !== void 0 ? _a : "");
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
                    this.queueSettingsNotice("card.attachmentFolderPath", this._noticeLines.cardAttachmentFolder(next), fromPick ? 0 : 150);
                }
            };
            /** Renders the folder-suggestion dropdown list. */
            const renderList = (items) => {
                if (!items.length) {
                    hideList();
                    return;
                }
                const el = ensureListEl();
                if (!el)
                    return;
                el.empty();
                activeIdx = -1;
                for (let i = 0; i < items.length; i++) {
                    const p = items[i];
                    const btn = el.createEl("button", { cls: "learnkit-folder-suggest-item learnkit-folder-suggest-item", text: p });
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
            inputEl.addEventListener("keydown", (e) => {
                var _a;
                if (!listEl)
                    return;
                const items = Array.from(listEl.querySelectorAll(".learnkit-folder-suggest-item"));
                if (!items.length)
                    return;
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    activeIdx = Math.min(items.length - 1, activeIdx + 1);
                }
                else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    activeIdx = Math.max(0, activeIdx - 1);
                }
                else if (e.key === "Enter") {
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
                }
                else if (e.key === "Escape") {
                    e.preventDefault();
                    hideList();
                    return;
                }
                else {
                    return;
                }
                items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
                const active = items[activeIdx];
                (_a = active === null || active === void 0 ? void 0 : active.scrollIntoView) === null || _a === void 0 ? void 0 : _a.call(active, { block: "nearest" });
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
        // Vault sync-friendly database storage
        // ----------------------------
        new Setting(wrapper)
            .setName(this._tx("ui.settings.sections.vaultSync", "Obsidian Sync database storage"))
            .setHeading();
        (_a = (_b = this.plugin.settings.storage).vaultSync) !== null && _a !== void 0 ? _a : (_b.vaultSync = clonePlain(DEFAULT_SETTINGS.storage.vaultSync));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.storage.vaultSync.enabled.name", "Store databases in vault"))
            .setDesc(this._tx("ui.settings.storage.vaultSync.enabled.desc", "Copy scheduling databases to a vault folder so " + "Obsidian" + " Sync can transfer them between devices."))
            .addToggle((t) => {
            const vaultSync = this.plugin.settings.storage.vaultSync;
            t.setValue(vaultSync.enabled).onChange(async (v) => {
                vaultSync.enabled = v;
                await this.plugin.saveAll();
                if (v)
                    await copyAllDbsToVaultSyncFolder(this.plugin);
                // Show/hide the folder picker
                vaultSyncFolderSetting.settingEl.toggle(v);
            });
        });
        const vaultSyncFolderSetting = new Setting(wrapper)
            .setName(this._tx("ui.settings.storage.vaultSync.folder.name", "Vault sync folder"))
            .setDesc(this._tx("ui.settings.storage.vaultSync.folder.desc", "Vault folder where .db copies are stored for syncing."))
            .addText((t) => {
            var _a, _b, _c;
            const allFolders = listVaultFolders(this.app);
            const vaultSync = this.plugin.settings.storage.vaultSync;
            const cur = (_a = vaultSync.folderPath) !== null && _a !== void 0 ? _a : "LearnKit/";
            t.setPlaceholder(this._tx("ui.settings.storage.folderPath", "Folder path"));
            t.setValue(String(cur));
            const inputEl = t.inputEl;
            const suggestWrap = (_c = (_b = inputEl.parentElement) === null || _b === void 0 ? void 0 : _b.createDiv({ cls: "learnkit-folder-suggest learnkit-folder-suggest" })) !== null && _c !== void 0 ? _c : null;
            let listEl = null;
            let activeIdx = -1;
            let lastCommitted = normaliseFolderPath(String(cur));
            let suppressBlurCommit = false;
            const ensureListEl = () => {
                if (!suggestWrap)
                    return null;
                if (!listEl) {
                    listEl = suggestWrap.createDiv({ cls: "learnkit-folder-suggest-list learnkit-folder-suggest-list" });
                }
                return listEl;
            };
            const hideList = () => {
                if (!listEl)
                    return;
                listEl.remove();
                listEl = null;
                activeIdx = -1;
            };
            const commitVaultSyncFolder = async (rawValue, fromPick) => {
                var _a;
                const prev = String((_a = vaultSync.folderPath) !== null && _a !== void 0 ? _a : "");
                const next = normaliseFolderPath(rawValue || "LearnKit/");
                inputEl.value = next;
                if (next === lastCommitted && next === normaliseFolderPath(prev)) {
                    hideList();
                    return;
                }
                vaultSync.folderPath = next;
                await this.plugin.saveAll();
                if (vaultSync.enabled)
                    await copyAllDbsToVaultSyncFolder(this.plugin);
                lastCommitted = next;
                hideList();
            };
            const renderList = (items) => {
                if (!items.length) {
                    hideList();
                    return;
                }
                const el = ensureListEl();
                if (!el)
                    return;
                el.empty();
                activeIdx = -1;
                for (let i = 0; i < items.length; i++) {
                    const p = items[i];
                    const btn = el.createEl("button", { cls: "learnkit-folder-suggest-item learnkit-folder-suggest-item", text: p });
                    btn.type = "button";
                    btn.addEventListener("mousedown", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        suppressBlurCommit = true;
                        void commitVaultSyncFolder(p, true);
                    });
                }
            };
            const updateSuggestions = () => {
                const raw = inputEl.value || "";
                const matches = fuzzyFolderMatches(allFolders, raw, 12);
                renderList(matches);
            };
            inputEl.addEventListener("input", () => updateSuggestions());
            inputEl.addEventListener("focus", () => updateSuggestions());
            inputEl.addEventListener("keydown", (e) => {
                var _a;
                if (!listEl)
                    return;
                const items = Array.from(listEl.querySelectorAll(".learnkit-folder-suggest-item"));
                if (!items.length)
                    return;
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    activeIdx = Math.min(items.length - 1, activeIdx + 1);
                }
                else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    activeIdx = Math.max(0, activeIdx - 1);
                }
                else if (e.key === "Enter") {
                    e.preventDefault();
                    if (activeIdx >= 0 && activeIdx < items.length) {
                        const picked = items[activeIdx].textContent || "";
                        suppressBlurCommit = true;
                        void commitVaultSyncFolder(picked, true);
                        return;
                    }
                    suppressBlurCommit = true;
                    void commitVaultSyncFolder(inputEl.value || "", false);
                    return;
                }
                else if (e.key === "Escape") {
                    e.preventDefault();
                    hideList();
                    return;
                }
                else {
                    return;
                }
                items.forEach((b, i) => b.classList.toggle("is-active", i === activeIdx));
                const active = items[activeIdx];
                (_a = active === null || active === void 0 ? void 0 : active.scrollIntoView) === null || _a === void 0 ? void 0 : _a.call(active, { block: "nearest" });
            });
            inputEl.addEventListener("blur", () => {
                window.setTimeout(() => {
                    if (suppressBlurCommit) {
                        suppressBlurCommit = false;
                        return;
                    }
                    void commitVaultSyncFolder(inputEl.value || "", false);
                }, 120);
            });
        });
        // Hide the folder picker when vault sync is off
        vaultSyncFolderSetting.settingEl.toggle(this.plugin.settings.storage.vaultSync.enabled);
        this.renderBackupsSection(wrapper);
    }
    renderSyncSection(wrapper) {
        // ----------------------------
        // Syncing
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.syncing", "Syncing")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.sync.ignoreCodeFences.name", "Ignore fenced code blocks"))
            .setDesc(this._tx("ui.settings.sync.ignoreCodeFences.desc", "Ignore cards inside fenced code blocks (``` ... ```)."))
            .addToggle((t) => t.setValue(this.plugin.settings.indexing.ignoreInCodeFences).onChange(async (v) => {
            const prev = this.plugin.settings.indexing.ignoreInCodeFences;
            this.plugin.settings.indexing.ignoreInCodeFences = v;
            await this.plugin.saveAll();
            if (prev !== v) {
                this.queueSettingsNotice("indexing.ignoreInCodeFences", this._noticeLines.ignoreCodeBlocks(v));
            }
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.sync.cardDelimiter.name", "Card delimiter"))
            .setDesc(this._tx("ui.settings.sync.cardDelimiter.desc", "Character used to separate fields in card markup."))
            .then((s) => {
            this._appendSettingWarning(s, this._tx("ui.settings.sync.cardDelimiter.warning", "Changing this will NOT migrate existing cards. Cards written with a previous delimiter will stop parsing and their scheduling data will be lost on the next sync."));
        })
            .then((s) => {
            var _a;
            this._addSimpleSelect(s.controlEl, {
                options: Object.entries(DELIMITER_OPTIONS).map(([value, label]) => ({ value, label })),
                separatorAfterIndex: 0,
                value: (_a = this.plugin.settings.indexing.delimiter) !== null && _a !== void 0 ? _a : "|",
                onChange: (v) => {
                    void (async () => {
                        var _a;
                        const prev = (_a = this.plugin.settings.indexing.delimiter) !== null && _a !== void 0 ? _a : "|";
                        const next = v;
                        this.plugin.settings.indexing.delimiter = next;
                        setDelimiter(next);
                        await this.plugin.saveAll();
                        if (prev !== next) {
                            this.queueSettingsNotice("indexing.delimiter", this._noticeLines.cardDelimiter(DELIMITER_OPTIONS[next]));
                        }
                    })();
                },
            });
        });
    }
    renderResetSection(wrapper) {
        // ----------------------------
        // Reset options
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.reset", "Reset")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.reset.defaults.name", "Reset to defaults"))
            .setDesc(this._tx("ui.settings.reset.defaults.desc", "Reset all settings to defaults. Does not delete cards or change scheduling."))
            .then((s) => {
            this._appendSettingWarning(s, this._tx("ui.settings.reset.defaults.warning", "This action cannot be undone."));
        })
            .addButton((b) => b
            .setButtonText(this._tx("ui.settings.reset.defaults.button", "Reset"))
            .setClass("sprout-btn-danger")
            .onClick(() => {
            new ConfirmResetDefaultsModal(this.app, this.plugin, async () => {
                const before = clonePlain(this.plugin.settings);
                try {
                    await this.resetSettingsToDefaults();
                    this.refreshReviewerViewsIfPossible();
                    this.refreshAllWidgetViews();
                    this.queueSettingsNotice("settings.resetDefaults", this._noticeLines.settingsResetDefaults, 0);
                }
                catch (e) {
                    this.plugin.settings = before;
                    log.error(e);
                    new Notice(this._noticeLines.settingsResetFailed);
                }
            }).open();
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.reset.analytics.name", "Reset analytics"))
            .setDesc(this._tx("ui.settings.reset.analytics.desc", "Clear review history, heatmaps, and statistics. Scheduling data is preserved."))
            .then((s) => {
            this._appendSettingWarning(s, this._tx("ui.settings.reset.analytics.warning", "This permanently deletes analytics history. Restore from a backup in Settings. Create one before resetting."));
        })
            .addButton((b) => b
            .setButtonText(this._tx("ui.settings.reset.analytics.button", "Reset"))
            .setClass("sprout-btn-danger")
            .onClick(() => {
            new ConfirmResetAnalyticsModal(this.app, this.plugin).open();
        }));
        new Setting(wrapper)
            .setName(this._tx("ui.settings.reset.scheduling.name", "Reset scheduling"))
            .setDesc(this._tx("ui.settings.reset.scheduling.desc", "Reset all cards to new and clear card and note scheduling data."))
            .then((s) => {
            this._appendSettingWarning(s, this._tx("ui.settings.reset.scheduling.warning", "This resets scheduling for every card. Restore from a backup in Settings. Create one before resetting."));
        })
            .addButton((b) => b
            .setButtonText(this._tx("ui.settings.reset.scheduling.button", "Reset"))
            .setClass("sprout-btn-danger")
            .onClick(() => {
            new ConfirmResetSchedulingModal(this.app, this.plugin).open();
        }));
        // ----------------------------
        // Danger zone
        // ----------------------------
        new Setting(wrapper).setName(this._tx("ui.settings.sections.dangerZone", "Danger zone")).setHeading();
        new Setting(wrapper)
            .setName(this._tx("ui.settings.reset.deleteAllFlashcards.name", "Delete all flashcards"))
            .setDesc(this._tx("ui.settings.reset.deleteAllFlashcards.desc", "Delete flashcards from notes and clear all plugin data. This cannot be undone."))
            .then((s) => {
            this._appendSettingWarning(s, this._tx("ui.settings.reset.deleteAllFlashcards.warning", "This permanently removes flashcards from notes and clears plugin data. It cannot be restored from " + "Learn" + "Kit settings. Ensure you have a full vault backup before continuing."));
        })
            .addButton((b) => b
            .setButtonText(this._tx("ui.settings.reset.deleteAllFlashcards.button", "Delete"))
            .setClass("sprout-btn-danger")
            .onClick(() => {
            new ConfirmDeleteAllFlashcardsModal(this.app, this.plugin, async () => {
                const before = Date.now();
                const { filesTouched, anchorsRemoved, cardsRemoved } = await this.deleteAllSproutDataFromVault();
                await this.clearSproutStore();
                this.refreshAllWidgetViews();
                this.refreshReviewerViewsIfPossible();
                const secs = Math.max(0, Math.round((Date.now() - before) / 100) / 10);
                new Notice(this._noticeLines.deleteAllSummary(cardsRemoved, anchorsRemoved, filesTouched, secs));
            }).open();
        }));
    }
    _styleSettingsButtons(root) {
        const buttonEls = Array.from(root.querySelectorAll("button"));
        for (const button of buttonEls) {
            if (button.classList.contains("learnkit-settings-icon-btn") ||
                button.classList.contains("learnkit-ss-trigger") ||
                button.classList.contains("learnkit-folder-suggest-item") ||
                button.classList.contains("learnkit-settings-advanced-toggle") ||
                button.classList.contains("learnkit-coach-chip-remove")) {
                continue;
            }
            if (button.classList.contains("clickable-icon"))
                continue;
            button.type = "button";
            button.classList.remove("mod-cta", "mod-warning");
            button.classList.add("inline-flex", "items-center", "gap-2", "h-9", "px-3", "text-sm", "learnkit-settings-action-btn", "learnkit-settings-action-btn");
        }
    }
    _appendSettingWarning(setting, text) {
        const warn = setting.descEl.createDiv({ cls: "learnkit-ss-warning learnkit-ss-warning" });
        const warnIcon = warn.createSpan({ cls: "learnkit-ss-warning-icon learnkit-ss-warning-icon" });
        setIcon(warnIcon, "alert-triangle");
        warn.createSpan({ text });
    }
    // ── Helper: simple select popover ──
    _addSimpleSelect(controlEl, args) {
        const id = `sprout-ss-${Math.random().toString(36).slice(2, 9)}`;
        // ── Trigger button ──
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "learnkit-ss-trigger inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-settings-action-btn";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        const trigLabel = document.createElement("span");
        trigLabel.className = "learnkit-ss-trigger-label";
        trigger.appendChild(trigLabel);
        const chevron = document.createElement("span");
        chevron.className = "learnkit-ss-trigger-chevron";
        setIcon(chevron, "chevron-down");
        trigger.appendChild(chevron);
        let current = args.value;
        const labelFor = (v) => { var _a, _b; return (_b = (_a = args.options.find((o) => o.value === v)) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : v; };
        trigLabel.textContent = labelFor(current);
        controlEl.appendChild(trigger);
        // ── Body-portal popover ──
        const sproutWrapper = document.createElement("div");
        sproutWrapper.className = "learnkit";
        const popover = document.createElement("div");
        popover.id = `${id}-popover`;
        popover.setAttribute("aria-hidden", "true");
        popover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay", "learnkit-ss-popover", "learnkit-ss-popover");
        const panel = document.createElement("div");
        panel.className = "learnkit-ss-panel learnkit-header-menu-panel";
        popover.appendChild(panel);
        sproutWrapper.appendChild(popover);
        // ── Options list ──
        const listbox = document.createElement("div");
        listbox.setAttribute("role", "listbox");
        listbox.className = "learnkit-ss-listbox";
        setCssProps(listbox, "scrollbar-gutter", "stable");
        panel.appendChild(listbox);
        const items = [];
        const buildItems = () => {
            listbox.replaceChildren();
            items.length = 0;
            const selected = args.options.find((opt) => opt.value === current);
            const orderedOptions = selected
                ? [selected, ...args.options.filter((opt) => opt.value !== selected.value)]
                : args.options;
            for (const opt of orderedOptions) {
                const item = document.createElement("div");
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", opt.value === current ? "true" : "false");
                item.tabIndex = 0;
                item.className = "learnkit-ss-item";
                const dotWrap = document.createElement("div");
                dotWrap.className = "learnkit-ss-dot-wrap";
                item.appendChild(dotWrap);
                const dot = document.createElement("div");
                dot.className = "learnkit-ss-dot";
                if (opt.value === current)
                    dot.classList.add("is-selected");
                dotWrap.appendChild(dot);
                const textWrap = document.createElement("div");
                textWrap.className = "learnkit-ss-item-text";
                const txt = document.createElement("span");
                txt.className = "learnkit-ss-item-label";
                txt.textContent = opt.label;
                textWrap.appendChild(txt);
                item.appendChild(textWrap);
                const activate = () => {
                    current = opt.value;
                    trigLabel.textContent = labelFor(current);
                    for (const it of items) {
                        it.el.setAttribute("aria-selected", it.value === current ? "true" : "false");
                        const d = it.el.querySelector(".learnkit-ss-dot");
                        if (d)
                            d.classList.toggle("is-selected", it.value === current);
                    }
                    args.onChange(current);
                    close();
                };
                item.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    activate();
                });
                item.addEventListener("keydown", (ev) => {
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
                    sep.className = "learnkit-ss-separator";
                    sep.setAttribute("role", "separator");
                    listbox.appendChild(sep);
                }
            }
        };
        // ── Positioning ──
        const place = () => {
            const isPhone = document.body.classList.contains("is-mobile") && window.innerWidth < 768;
            placePopover({
                trigger, panel, popoverEl: popover,
                width: isPhone ? undefined : Math.max(220, trigger.getBoundingClientRect().width),
                align: "right",
                gap: 4,
            });
        };
        // ── Open / Close ──
        let cleanup = null;
        const close = () => {
            trigger.setAttribute("aria-expanded", "false");
            popover.setAttribute("aria-hidden", "true");
            popover.classList.remove("is-open");
            cleanup === null || cleanup === void 0 ? void 0 : cleanup();
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
                const sel = listbox.querySelector('[aria-selected="true"]');
                sel === null || sel === void 0 ? void 0 : sel.focus();
            });
            const onResizeOrScroll = () => place();
            const onDocPointerDown = (ev) => {
                const t = ev.target;
                if (!t)
                    return;
                if (trigger.contains(t) || popover.contains(t))
                    return;
                close();
            };
            const onDocKeydown = (ev) => {
                if (ev.key !== "Escape")
                    return;
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
        trigger.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0)
                return;
            ev.preventDefault();
            ev.stopPropagation();
            const isOpen = trigger.getAttribute("aria-expanded") === "true";
            if (isOpen)
                close();
            else
                open();
        });
        return {
            getValue: () => current,
            setValue: (v) => {
                current = v;
                trigLabel.textContent = labelFor(current);
            },
        };
    }
    // ── Helper: searchable popover dropdown ──
    _addSearchablePopover(container, args) {
        var _a;
        const id = `sprout-ss-${Math.random().toString(36).slice(2, 9)}`;
        const setting = new Setting(container).setName(args.name).setDesc(args.description);
        // ── Trigger button ──
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "learnkit-ss-trigger inline-flex items-center gap-2 h-9 px-3 text-sm learnkit-settings-action-btn";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        const trigLabel = document.createElement("span");
        trigLabel.className = "learnkit-ss-trigger-label";
        trigger.appendChild(trigLabel);
        const chevron = document.createElement("span");
        chevron.className = "learnkit-ss-trigger-chevron";
        setIcon(chevron, "chevron-down");
        trigger.appendChild(chevron);
        let current = args.value;
        const optionFor = (v) => args.options.find((o) => o.value === v);
        const renderLabel = (target, label, flagCode) => {
            target.replaceChildren();
            if (flagCode) {
                const img = document.createElement("img");
                img.className = "learnkit-inline-flag";
                img.alt = flagCode;
                img.src = getCircleFlagUrl(flagCode);
                img.addEventListener("error", () => {
                    const fallback = getCircleFlagFallbackUrl(flagCode);
                    if (img.src !== fallback)
                        img.src = fallback;
                }, { once: true });
                img.loading = "lazy";
                img.decoding = "async";
                img.referrerPolicy = "no-referrer";
                target.appendChild(img);
            }
            target.appendChild(document.createTextNode(label));
        };
        {
            const selected = optionFor(current);
            renderLabel(trigLabel, (_a = selected === null || selected === void 0 ? void 0 : selected.label) !== null && _a !== void 0 ? _a : current, selected === null || selected === void 0 ? void 0 : selected.flagCode);
        }
        setting.controlEl.appendChild(trigger);
        // ── Body-portal popover ──
        const sproutWrapper = document.createElement("div");
        sproutWrapper.className = "learnkit";
        const popover = document.createElement("div");
        popover.id = `${id}-popover`;
        popover.setAttribute("aria-hidden", "true");
        popover.classList.add("learnkit-popover-overlay", "learnkit-popover-overlay", "learnkit-ss-popover", "learnkit-ss-popover");
        const panel = document.createElement("div");
        panel.className = "learnkit-ss-panel learnkit-header-menu-panel";
        popover.appendChild(panel);
        sproutWrapper.appendChild(popover);
        // ── Search input (only for >7 options) ──
        const showSearch = args.options.length > 7;
        let searchInput = null;
        if (showSearch) {
            const searchWrap = document.createElement("div");
            searchWrap.className = "learnkit-ss-search-wrap";
            panel.appendChild(searchWrap);
            const searchIcon = document.createElement("span");
            searchIcon.className = "learnkit-ss-search-icon";
            setIcon(searchIcon, "search");
            searchWrap.appendChild(searchIcon);
            searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.className = "learnkit-ss-search-input";
            searchInput.placeholder = this._tx("ui.settings.searchableSelect.searchPlaceholder", "Search...");
            searchInput.setAttribute("autocomplete", "off");
            searchInput.setAttribute("spellcheck", "false");
            searchWrap.appendChild(searchInput);
        }
        // ── Options list ──
        const listbox = document.createElement("div");
        listbox.setAttribute("role", "listbox");
        listbox.className = "learnkit-ss-listbox";
        panel.appendChild(listbox);
        // ── Empty state ──
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "learnkit-ss-empty";
        emptyMsg.textContent = this._tx("ui.settings.searchableSelect.empty", "No results");
        emptyMsg.hidden = true;
        panel.appendChild(emptyMsg);
        const items = [];
        const sections = new Map();
        let baseContentWidth = 0;
        const buildItems = () => {
            var _a;
            listbox.replaceChildren();
            items.length = 0;
            sections.clear();
            const selected = args.options.find((opt) => opt.value === current);
            const orderedOptions = selected
                ? [selected, ...args.options.filter((opt) => opt.value !== selected.value)]
                : args.options;
            let previousSection = "";
            for (const opt of orderedOptions) {
                const sectionKey = String(opt.section || "").trim();
                if (sectionKey && sectionKey !== previousSection) {
                    const separatorEl = listbox.children.length
                        ? listbox.createDiv({ cls: "learnkit-ss-separator learnkit-ss-separator" })
                        : null;
                    if (separatorEl)
                        separatorEl.setAttribute("role", "separator");
                    const titleEl = listbox.createDiv({ cls: "learnkit-ss-section-title learnkit-ss-section-title", text: sectionKey });
                    sections.set(sectionKey, { titleEl, separatorEl, visibleCount: 0 });
                    previousSection = sectionKey;
                }
                const item = document.createElement("div");
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", opt.value === current ? "true" : "false");
                item.tabIndex = 0;
                item.className = "learnkit-ss-item";
                const dotWrap = document.createElement("div");
                dotWrap.className = "learnkit-ss-dot-wrap";
                item.appendChild(dotWrap);
                const dot = document.createElement("div");
                dot.className = "learnkit-ss-dot";
                if (opt.value === current)
                    dot.classList.add("is-selected");
                dotWrap.appendChild(dot);
                const textWrap = document.createElement("div");
                textWrap.className = "learnkit-ss-item-text";
                const txt = document.createElement("span");
                txt.className = "learnkit-ss-item-label";
                renderLabel(txt, opt.label, opt.flagCode);
                textWrap.appendChild(txt);
                item.appendChild(textWrap);
                const activate = () => {
                    current = opt.value;
                    renderLabel(trigLabel, opt.label, opt.flagCode);
                    for (const it of items) {
                        it.el.setAttribute("aria-selected", it.value === current ? "true" : "false");
                        const d = it.el.querySelector(".learnkit-ss-dot");
                        if (d)
                            d.classList.toggle("is-selected", it.value === current);
                    }
                    args.onChange(current);
                    close();
                };
                item.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    activate();
                });
                item.addEventListener("keydown", (ev) => {
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
                    sectionKey,
                    lower: `${opt.label} ${(_a = opt.description) !== null && _a !== void 0 ? _a : ""} ${opt.value} ${sectionKey}`.toLowerCase(),
                });
            }
        };
        // ── Filter logic ──
        const applyFilter = () => {
            var _a;
            const q = (_a = searchInput === null || searchInput === void 0 ? void 0 : searchInput.value.toLowerCase().trim()) !== null && _a !== void 0 ? _a : "";
            let visible = 0;
            for (const section of sections.values()) {
                section.visibleCount = 0;
            }
            for (const it of items) {
                const show = !q || it.lower.includes(q);
                it.el.hidden = !show;
                it.el.style.display = show ? "" : "none";
                if (show) {
                    visible++;
                    if (it.sectionKey) {
                        const section = sections.get(it.sectionKey);
                        if (section)
                            section.visibleCount += 1;
                    }
                }
            }
            for (const section of sections.values()) {
                const hasMatches = section.visibleCount > 0;
                section.titleEl.hidden = !hasMatches;
                section.titleEl.style.display = hasMatches ? "" : "none";
                if (section.separatorEl) {
                    section.separatorEl.hidden = !hasMatches;
                    section.separatorEl.style.display = hasMatches ? "" : "none";
                }
            }
            emptyMsg.hidden = visible !== 0;
            emptyMsg.style.display = visible === 0 ? "" : "none";
        };
        if (searchInput) {
            searchInput.addEventListener("input", applyFilter);
            searchInput.addEventListener("keydown", (ev) => {
                if (ev.key === "Escape")
                    return;
                ev.stopPropagation();
            });
            searchInput.addEventListener("mousedown", (ev) => ev.stopPropagation());
            searchInput.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        }
        // ── Positioning ──
        const measureBaseContentWidth = () => {
            const triggerWidth = Math.ceil(trigger.getBoundingClientRect().width);
            const searchWrap = (searchInput === null || searchInput === void 0 ? void 0 : searchInput.parentElement) instanceof HTMLElement ? searchInput.parentElement : null;
            const optionWidth = items.reduce((max, item) => Math.max(max, Math.ceil(item.el.scrollWidth)), 0);
            const sectionWidth = Array.from(sections.values()).reduce((max, section) => Math.max(max, Math.ceil(section.titleEl.scrollWidth)), 0);
            return Math.max(triggerWidth, optionWidth, sectionWidth, searchWrap ? Math.ceil(searchWrap.scrollWidth) : 0);
        };
        const measurePopoverWidth = () => {
            const isPhone = document.body.classList.contains("is-mobile") && window.innerWidth < 768;
            if (isPhone)
                return undefined;
            const viewportMaxWidth = Math.max(280, window.innerWidth - 32);
            const contentWidth = Math.max(baseContentWidth, Math.ceil(trigger.getBoundingClientRect().width));
            return Math.min(viewportMaxWidth, Math.max(280, contentWidth + 20));
        };
        const place = () => {
            placePopover({
                trigger, panel, popoverEl: popover,
                width: measurePopoverWidth(),
                align: "right",
                gap: 4,
            });
        };
        // ── Open / Close ──
        let cleanup = null;
        const close = () => {
            trigger.setAttribute("aria-expanded", "false");
            popover.setAttribute("aria-hidden", "true");
            popover.classList.remove("is-open");
            baseContentWidth = 0;
            cleanup === null || cleanup === void 0 ? void 0 : cleanup();
            cleanup = null;
            if (sproutWrapper.parentNode === document.body) {
                document.body.removeChild(sproutWrapper);
            }
        };
        const open = () => {
            buildItems();
            if (searchInput)
                searchInput.value = "";
            baseContentWidth = 0;
            trigger.setAttribute("aria-expanded", "true");
            popover.setAttribute("aria-hidden", "false");
            popover.classList.add("is-open");
            document.body.appendChild(sproutWrapper);
            requestAnimationFrame(() => {
                baseContentWidth = measureBaseContentWidth();
                applyFilter();
                place();
                if (searchInput) {
                    searchInput.focus();
                }
                else {
                    const first = listbox.querySelector('[role="option"]');
                    first === null || first === void 0 ? void 0 : first.focus();
                }
            });
            const onResizeOrScroll = () => place();
            const onDocPointerDown = (ev) => {
                const t = ev.target;
                if (!t)
                    return;
                if (trigger.contains(t) || popover.contains(t))
                    return;
                close();
            };
            const onDocKeydown = (ev) => {
                if (ev.key !== "Escape")
                    return;
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
        trigger.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0)
                return;
            ev.preventDefault();
            ev.stopPropagation();
            const isOpen = trigger.getAttribute("aria-expanded") === "true";
            if (isOpen)
                close();
            else
                open();
        });
    }
}
LearnKitSettingsTab.TRANSLATIONS_GUIDE_URL = "https://github.com/ctrlaltwill/Sprout/blob/main/CONTRIBUTING.md#translation-policy";
