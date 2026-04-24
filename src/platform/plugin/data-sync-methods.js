/**
 * @file src/platform/plugin/data-sync-methods.ts
 * @summary Module for data sync methods.
 *
 * @exports
 *  - WithDataSyncMethods
 */
import { Notice, TFile, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS } from "../core/constants";
import { log } from "../core/logger";
import { clonePlain, isPlainObject } from "../core/utils";
import { normaliseApiKeys, normaliseTtsApiKeys, hasAnyApiKey, hasAnyTtsApiKey, persistApiKeysToDedicatedFile, persistTtsApiKeysToDedicatedFile, } from "../core/settings-storage";
import { SqliteStore } from "../core/sqlite-store";
import { NoteReviewSqlite } from "../core/note-review-sqlite";
import { resetCardScheduling } from "../../engine/scheduler/scheduler";
import { joinPath, safeStatMtime, createDataJsonBackupNow } from "../integrations/sync/backup";
import { formatSyncNotice, syncOneFile, syncQuestionBank } from "../integrations/sync/sync-engine";
import { ParseErrorModal } from "../modals/parse-error-modal";
import { formatCurrentNoteSyncNotice } from "../integrations/sync/sync-notices";
export function WithDataSyncMethods(Base) {
    return class WithDataSyncMethods extends Base {
        constructor() {
            super(...arguments);
            this._runSync = async () => {
                var _a;
                const res = await syncQuestionBank(this);
                const notice = formatSyncNotice("Sync complete", res, { includeDeleted: true });
                new Notice(notice);
                const tagsDeleted = Number((_a = res.tagsDeleted) !== null && _a !== void 0 ? _a : 0);
                if (tagsDeleted > 0) {
                    new Notice(this._tx("ui.main.notice.deletedUnusedTags", "Deleted {count}, unused tag{suffix}", {
                        count: tagsDeleted,
                        suffix: tagsDeleted === 1 ? "" : "s",
                    }));
                }
                if (res.quarantinedCount > 0) {
                    new ParseErrorModal(this.app, this, res.quarantinedIds).open();
                }
                this.notifyWidgetCardsSynced();
            };
            this._formatCurrentNoteSyncNotice = (pageTitle, res) => {
                return formatCurrentNoteSyncNotice(pageTitle, res);
            };
            this._runSyncCurrentNote = async () => {
                const file = this._getActiveMarkdownFile();
                if (!(file instanceof TFile)) {
                    new Notice(this._tx("ui.sync.notice.noNoteOpen", "No note is open"));
                    return;
                }
                const res = await syncOneFile(this, file, { pruneGlobalOrphans: false });
                new Notice(this._formatCurrentNoteSyncNotice(file.basename, res));
                if (res.quarantinedCount > 0) {
                    new ParseErrorModal(this.app, this, res.quarantinedIds).open();
                }
                this.notifyWidgetCardsSynced();
            };
            this.saveAll = async () => {
                this._applySproutThemePreset();
                this._applySproutThemeAccentOverride();
                while (this._saving)
                    await this._saving;
                this._saving = this._doSave();
                try {
                    await this._saving;
                }
                finally {
                    this._saving = null;
                }
            };
            this._getDataJsonPath = () => {
                var _a, _b, _c;
                const configDir = (_b = (_a = this.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.configDir;
                const pluginId = (_c = this.manifest) === null || _c === void 0 ? void 0 : _c.id;
                if (!configDir || !pluginId)
                    return null;
                return joinPath(configDir, "plugins", pluginId, "data.json");
            };
            this._getConfigDirPath = () => {
                var _a, _b, _c;
                const configDir = (_b = (_a = this.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.configDir;
                const pluginId = (_c = this.manifest) === null || _c === void 0 ? void 0 : _c.id;
                if (!configDir || !pluginId)
                    return null;
                return joinPath(configDir, "plugins", pluginId, "configuration");
            };
            this._getConfigFilePath = (filename) => {
                const dir = this._getConfigDirPath();
                return dir ? joinPath(dir, filename) : null;
            };
            this._getApiKeysFilePath = () => {
                return this._getConfigFilePath("api-keys.json");
            };
            this._getTtsApiKeysFilePath = () => {
                return this._getConfigFilePath("tts-api-keys.json");
            };
            this._doSave = async () => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                if (this.store instanceof SqliteStore) {
                    const root = ((await this.loadData()) || {});
                    this.settings.studyAssistant.apiKeys = normaliseApiKeys(this.settings.studyAssistant.apiKeys);
                    const apiKeyWriteOk = await persistApiKeysToDedicatedFile({
                        adapter: (_b = (_a = this.app) === null || _a === void 0 ? void 0 : _a.vault) === null || _b === void 0 ? void 0 : _b.adapter,
                        dirPath: this._getConfigDirPath(),
                        filePath: this._getApiKeysFilePath(),
                        apiKeys: this.settings.studyAssistant.apiKeys,
                    });
                    this.settings.audio.ttsApiKeys = normaliseTtsApiKeys(this.settings.audio.ttsApiKeys);
                    const ttsKeyWriteOk = await persistTtsApiKeysToDedicatedFile({
                        adapter: (_d = (_c = this.app) === null || _c === void 0 ? void 0 : _c.vault) === null || _d === void 0 ? void 0 : _d.adapter,
                        dirPath: this._getConfigDirPath(),
                        filePath: this._getTtsApiKeysFilePath(),
                        apiKeys: this.settings.audio.ttsApiKeys,
                    });
                    const syncSettings = clonePlain(this.settings);
                    if (isPlainObject(syncSettings.studyAssistant)) {
                        syncSettings.studyAssistant.apiKeys =
                            { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
                    }
                    if (isPlainObject(syncSettings.audio)) {
                        syncSettings.audio.ttsApiKeys = { ...DEFAULT_SETTINGS.audio.ttsApiKeys };
                    }
                    if (!apiKeyWriteOk && hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
                        log.error("Api key dedicated file write failed; keys were not persisted this save.");
                        new Notice(this._tx("ui.sync.notice.keysSaveFailed", "Could not save keys securely. Check file permissions"), 8000);
                    }
                    if (!ttsKeyWriteOk && hasAnyTtsApiKey(this.settings.audio.ttsApiKeys)) {
                        log.error("TTS api key dedicated file write failed; keys were not persisted this save.");
                    }
                    root.settings = syncSettings;
                    delete root.store;
                    delete root.versionTracking;
                    await this.saveData(root);
                    await this.store.persist();
                    return;
                }
                const adapter = (_g = (_f = (_e = this.app) === null || _e === void 0 ? void 0 : _e.vault) === null || _f === void 0 ? void 0 : _f.adapter) !== null && _g !== void 0 ? _g : null;
                const dataPath = this._getDataJsonPath();
                const canStat = !!(adapter && dataPath);
                const maxAttempts = 3;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    const mtimeBefore = canStat ? await safeStatMtime(adapter, dataPath) : 0;
                    const root = ((await this.loadData()) || {});
                    const diskStore = root === null || root === void 0 ? void 0 : root.store;
                    const safety = this.store.assessPersistSafety(diskStore !== null && diskStore !== void 0 ? diskStore : null);
                    if (!safety.allow) {
                        log.warn(`_doSave: aborting - ${safety.reason}`);
                        try {
                            await createDataJsonBackupNow(this, "safety-before-empty-write");
                        }
                        catch (_m) {
                            // best effort
                        }
                        return;
                    }
                    if (safety.backupFirst) {
                        log.warn(`_doSave: ${safety.reason} Creating safety backup before writing.`);
                        try {
                            await createDataJsonBackupNow(this, "safety-regression");
                        }
                        catch (_o) {
                            // best effort
                        }
                    }
                    this.settings.studyAssistant.apiKeys = normaliseApiKeys(this.settings.studyAssistant.apiKeys);
                    const apiKeyWriteOk = await persistApiKeysToDedicatedFile({
                        adapter: (_j = (_h = this.app) === null || _h === void 0 ? void 0 : _h.vault) === null || _j === void 0 ? void 0 : _j.adapter,
                        dirPath: this._getConfigDirPath(),
                        filePath: this._getApiKeysFilePath(),
                        apiKeys: this.settings.studyAssistant.apiKeys,
                    });
                    const syncSettings = clonePlain(this.settings);
                    if (isPlainObject(syncSettings.studyAssistant)) {
                        syncSettings.studyAssistant.apiKeys =
                            { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
                    }
                    if (!apiKeyWriteOk && hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
                        log.error("Api key dedicated file write failed; keys were not persisted this save.");
                        new Notice(this._tx("ui.sync.notice.keysSaveFailed", "Could not save keys securely. Check file permissions"), 8000);
                    }
                    root.settings = syncSettings;
                    root.store = this.store.data;
                    delete root.versionTracking;
                    if (canStat) {
                        const mtimeBeforeWrite = await safeStatMtime(adapter, dataPath);
                        if (mtimeBefore && mtimeBeforeWrite && mtimeBeforeWrite !== mtimeBefore) {
                            continue;
                        }
                    }
                    await this.saveData(root);
                    return;
                }
                const root = ((await this.loadData()) || {});
                this.settings.studyAssistant.apiKeys = normaliseApiKeys(this.settings.studyAssistant.apiKeys);
                const apiKeyWriteOk = await persistApiKeysToDedicatedFile({
                    adapter: (_l = (_k = this.app) === null || _k === void 0 ? void 0 : _k.vault) === null || _l === void 0 ? void 0 : _l.adapter,
                    dirPath: this._getConfigDirPath(),
                    filePath: this._getApiKeysFilePath(),
                    apiKeys: this.settings.studyAssistant.apiKeys,
                });
                const syncSettings = clonePlain(this.settings);
                if (isPlainObject(syncSettings.studyAssistant)) {
                    syncSettings.studyAssistant.apiKeys =
                        { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
                }
                if (!apiKeyWriteOk && hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
                    log.error("Api key dedicated file write failed; keys were not persisted this save.");
                    new Notice(this._tx("ui.sync.notice.keysSaveFailed", "Could not save keys securely. Check file permissions"), 8000);
                }
                root.settings = syncSettings;
                root.store = this.store.data;
                delete root.versionTracking;
                await this.saveData(root);
            };
            this.refreshGithubStars = async (force = false) => {
                var _a, _b;
                var _c;
                const s = this.settings;
                (_a = s.general) !== null && _a !== void 0 ? _a : (s.general = { ...DEFAULT_SETTINGS.general });
                (_b = (_c = s.general).githubStars) !== null && _b !== void 0 ? _b : (_c.githubStars = { count: null, fetchedAt: null });
                const lastAt = Number(s.general.githubStars.fetchedAt || 0);
                const staleMs = 6 * 60 * 60 * 1000;
                if (!force && lastAt && Date.now() - lastAt < staleMs)
                    return;
                try {
                    const res = await requestUrl({
                        url: "https://api.github.com/repos/ctrlaltwill/sprout",
                        method: "GET",
                        headers: { Accept: "application/vnd.github+json" },
                    });
                    const json = res === null || res === void 0 ? void 0 : res.json;
                    const jsonObj = json && typeof json === "object" ? json : null;
                    const countRaw = jsonObj === null || jsonObj === void 0 ? void 0 : jsonObj.stargazers_count;
                    const count = Number(countRaw);
                    if (Number.isFinite(count)) {
                        s.general.githubStars.count = count;
                        s.general.githubStars.fetchedAt = Date.now();
                        await this.saveAll();
                        this._refreshOpenViews();
                    }
                }
                catch (_d) {
                    // offline or rate-limited; keep last known value
                }
            };
            this.resetSettingsToDefaults = async () => {
                this.settings = clonePlain(DEFAULT_SETTINGS);
                this._normaliseSettingsInPlace();
                await this.saveAll();
                this._refreshOpenViews();
            };
            this._isCardStateLike = (v) => {
                if (!v || typeof v !== "object")
                    return false;
                const o = v;
                const stageOk = o.stage === "new" ||
                    o.stage === "learning" ||
                    o.stage === "review" ||
                    o.stage === "relearning" ||
                    o.stage === "suspended";
                if (!stageOk)
                    return false;
                const numsOk = typeof o.due === "number" &&
                    typeof o.scheduledDays === "number" &&
                    typeof o.reps === "number" &&
                    typeof o.lapses === "number" &&
                    typeof o.learningStepIndex === "number";
                return numsOk;
            };
            this.resetAllCardScheduling = async () => {
                var _a, _b;
                const now = Date.now();
                let cardTotal = 0;
                const states = (_b = (_a = this.store) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.states;
                if (states && typeof states === "object" && !Array.isArray(states)) {
                    for (const [id, raw] of Object.entries(states)) {
                        if (!this._isCardStateLike(raw))
                            continue;
                        const prev = { id, ...raw };
                        states[id] = resetCardScheduling(prev, now);
                        cardTotal++;
                    }
                }
                await this.saveAll();
                const noteTotal = await this._clearAllNoteSchedulingState();
                this._refreshOpenViews();
                new Notice(this._tx("ui.main.notice.resetScheduling", "Reset scheduling for {cardCount} cards and {noteCount} notes.", {
                    cardCount: cardTotal,
                    noteCount: noteTotal,
                }));
            };
            this._clearAllNoteSchedulingState = async () => {
                const db = new NoteReviewSqlite(this);
                let total = 0;
                try {
                    await db.open();
                    total = db.clearAllNoteState();
                    await db.persist();
                }
                finally {
                    await db.close().catch((e) => log.swallow("close note review sqlite after reset", e));
                }
                return total;
            };
            this.resetAllNoteScheduling = async () => {
                const total = await this._clearAllNoteSchedulingState();
                this._refreshOpenViews();
                new Notice(this._tx("ui.main.notice.resetNoteScheduling", "Reset scheduling for {count} notes.", { count: total }));
            };
            this.resetAllAnalyticsData = async () => {
                if (this.store.data.analytics) {
                    this.store.data.analytics.events = [];
                    this.store.data.analytics.seq = 0;
                }
                if (Array.isArray(this.store.data.reviewLog)) {
                    this.store.data.reviewLog = [];
                }
                await this.saveAll();
                this._refreshOpenViews();
                new Notice(this._tx("ui.main.notice.analyticsCleared", "Analytics data cleared."));
            };
        }
    };
}
