/**
 * @file src/platform/plugin/data-sync-methods.ts
 * @summary Module for data sync methods.
 *
 * @exports
 *  - WithDataSyncMethods
 */

import { Notice, TFile, requestUrl } from "obsidian";
import { LearnKitPluginBase, type Constructor } from "./plugin-base";
import { DEFAULT_SETTINGS } from "../core/constants";
import { log } from "../core/logger";
import { clonePlain, isPlainObject } from "../core/utils";
import {
  normaliseApiKeys,
  hasAnyApiKey,
  persistApiKeysToDedicatedFile,
} from "../core/settings-storage";
import { SqliteStore } from "../core/sqlite-store";
import { NoteReviewSqlite } from "../core/note-review-sqlite";
import { resetCardScheduling, type CardState } from "../../engine/scheduler/scheduler";
import { joinPath, safeStatMtime, createDataJsonBackupNow } from "../integrations/sync/backup";
import { formatSyncNotice, syncOneFile, syncQuestionBank } from "../integrations/sync/sync-engine";
import { ParseErrorModal } from "../modals/parse-error-modal";
import { formatCurrentNoteSyncNotice } from "../integrations/sync/sync-notices";

export function WithDataSyncMethods<T extends Constructor<LearnKitPluginBase>>(Base: T) {
  return class WithDataSyncMethods extends Base {
    async _runSync(): Promise<void> {
      const res = await syncQuestionBank(this);

      const notice = formatSyncNotice("Sync complete", res, { includeDeleted: true });
      new Notice(notice);

      const tagsDeleted = Number((res as { tagsDeleted?: number }).tagsDeleted ?? 0);
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
    }

    _formatCurrentNoteSyncNotice(
      pageTitle: string,
      res: { newCount?: number; updatedCount?: number; removed?: number },
    ): string {
      return formatCurrentNoteSyncNotice(pageTitle, res);
    }

    async _runSyncCurrentNote(): Promise<void> {
      const file = this._getActiveMarkdownFile();
      if (!(file instanceof TFile)) {
        new Notice("No note is open");
        return;
      }

      const res = await syncOneFile(this, file, { pruneGlobalOrphans: false });
      new Notice(this._formatCurrentNoteSyncNotice(file.basename, res));

      if (res.quarantinedCount > 0) {
        new ParseErrorModal(this.app, this, res.quarantinedIds).open();
      }

      this.notifyWidgetCardsSynced();
    }

    async saveAll(): Promise<void> {
      this._applySproutThemePreset();
      this._applySproutThemeAccentOverride();
      while (this._saving) await this._saving;
      this._saving = this._doSave();
      try {
        await this._saving;
      } finally {
        this._saving = null;
      }
    }

    _getDataJsonPath(): string | null {
      const configDir = this.app?.vault?.configDir;
      const pluginId = this.manifest?.id;
      if (!configDir || !pluginId) return null;
      return joinPath(configDir, "plugins", pluginId, "data.json");
    }

    _getConfigDirPath(): string | null {
      const configDir = this.app?.vault?.configDir;
      const pluginId = this.manifest?.id;
      if (!configDir || !pluginId) return null;
      return joinPath(configDir, "plugins", pluginId, "configuration");
    }

    _getConfigFilePath(filename: string): string | null {
      const dir = this._getConfigDirPath();
      return dir ? joinPath(dir, filename) : null;
    }

    _getApiKeysFilePath(): string | null {
      return this._getConfigFilePath("api-keys.json");
    }

    async _doSave(): Promise<void> {
      if (this.store instanceof SqliteStore) {
        const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;

        this.settings.studyAssistant.apiKeys = normaliseApiKeys(this.settings.studyAssistant.apiKeys);
        const apiKeyWriteOk = await persistApiKeysToDedicatedFile({
          adapter: this.app?.vault?.adapter,
          dirPath: this._getConfigDirPath(),
          filePath: this._getApiKeysFilePath(),
          apiKeys: this.settings.studyAssistant.apiKeys,
        });

        const syncSettings = clonePlain(this.settings) as Record<string, unknown>;
        if (isPlainObject(syncSettings.studyAssistant)) {
          syncSettings.studyAssistant.apiKeys =
            { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
        }

        if (!apiKeyWriteOk && hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
          log.error("Api key dedicated file write failed; keys were not persisted this save.");
          new Notice("Could not save keys securely. Check file permissions", 8000);
        }

        root.settings = syncSettings;
        delete root.store;
  delete root.versionTracking;

        await this.saveData(root);
        await this.store.persist();
        return;
      }

      const adapter = this.app?.vault?.adapter ?? null;
      const dataPath = this._getDataJsonPath();
      const canStat = !!(adapter && dataPath);
      const maxAttempts = 3;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const mtimeBefore = canStat ? await safeStatMtime(adapter, dataPath) : 0;
        const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;

        const diskStore = root?.store as Record<string, unknown> | undefined;
        const safety = this.store.assessPersistSafety(diskStore ?? null);

        if (!safety.allow) {
          log.warn(`_doSave: aborting - ${safety.reason}`);
          try {
            await createDataJsonBackupNow(this, "safety-before-empty-write");
          } catch {
            // best effort
          }
          return;
        }

        if (safety.backupFirst) {
          log.warn(`_doSave: ${safety.reason} Creating safety backup before writing.`);
          try {
            await createDataJsonBackupNow(this, "safety-regression");
          } catch {
            // best effort
          }
        }

        this.settings.studyAssistant.apiKeys = normaliseApiKeys(this.settings.studyAssistant.apiKeys);
        const apiKeyWriteOk = await persistApiKeysToDedicatedFile({
          adapter: this.app?.vault?.adapter,
          dirPath: this._getConfigDirPath(),
          filePath: this._getApiKeysFilePath(),
          apiKeys: this.settings.studyAssistant.apiKeys,
        });

        const syncSettings = clonePlain(this.settings) as Record<string, unknown>;
        if (isPlainObject(syncSettings.studyAssistant)) {
          syncSettings.studyAssistant.apiKeys =
            { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
        }
        if (!apiKeyWriteOk && hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
          log.error("Api key dedicated file write failed; keys were not persisted this save.");
          new Notice("Could not save keys securely. Check file permissions", 8000);
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

      const root: Record<string, unknown> = ((await this.loadData()) || {}) as Record<string, unknown>;
      this.settings.studyAssistant.apiKeys = normaliseApiKeys(this.settings.studyAssistant.apiKeys);
      const apiKeyWriteOk = await persistApiKeysToDedicatedFile({
        adapter: this.app?.vault?.adapter,
        dirPath: this._getConfigDirPath(),
        filePath: this._getApiKeysFilePath(),
        apiKeys: this.settings.studyAssistant.apiKeys,
      });
      const syncSettings = clonePlain(this.settings) as Record<string, unknown>;
      if (isPlainObject(syncSettings.studyAssistant)) {
        syncSettings.studyAssistant.apiKeys =
          { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
      }
      if (!apiKeyWriteOk && hasAnyApiKey(this.settings.studyAssistant.apiKeys)) {
        log.error("Api key dedicated file write failed; keys were not persisted this save.");
        new Notice("Could not save keys securely. Check file permissions", 8000);
      }
      root.settings = syncSettings;
      root.store = this.store.data;
      delete root.versionTracking;
      await this.saveData(root);
    }

    async refreshGithubStars(force = false): Promise<void> {
      const s = this.settings;
      s.general ??= { ...DEFAULT_SETTINGS.general };
      s.general.githubStars ??= { count: null, fetchedAt: null };

      const lastAt = Number(s.general.githubStars.fetchedAt || 0);
      const staleMs = 6 * 60 * 60 * 1000;
      if (!force && lastAt && Date.now() - lastAt < staleMs) return;

      try {
        const res = await requestUrl({
          url: "https://api.github.com/repos/ctrlaltwill/sprout",
          method: "GET",
          headers: { Accept: "application/vnd.github+json" },
        });
        const json: unknown = res?.json;
        const jsonObj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const countRaw = jsonObj?.stargazers_count;
        const count = Number(countRaw);
        if (Number.isFinite(count)) {
          s.general.githubStars.count = count;
          s.general.githubStars.fetchedAt = Date.now();
          await this.saveAll();
          this._refreshOpenViews();
        }
      } catch {
        // offline or rate-limited; keep last known value
      }
    }

    async resetSettingsToDefaults(): Promise<void> {
      this.settings = clonePlain(DEFAULT_SETTINGS);
      this._normaliseSettingsInPlace();
      await this.saveAll();
      this._refreshOpenViews();
    }

    _isCardStateLike(v: unknown): v is CardState {
      if (!v || typeof v !== "object") return false;
      const o = v as Record<string, unknown>;

      const stageOk =
        o.stage === "new" ||
        o.stage === "learning" ||
        o.stage === "review" ||
        o.stage === "relearning" ||
        o.stage === "suspended";

      if (!stageOk) return false;

      const numsOk =
        typeof o.due === "number" &&
        typeof o.scheduledDays === "number" &&
        typeof o.reps === "number" &&
        typeof o.lapses === "number" &&
        typeof o.learningStepIndex === "number";

      return numsOk;
    }

    async resetAllCardScheduling(): Promise<void> {
      const now = Date.now();
      let cardTotal = 0;

      const states = this.store?.data?.states;
      if (states && typeof states === "object" && !Array.isArray(states)) {
        for (const [id, raw] of Object.entries(states as Record<string, unknown>)) {
          if (!this._isCardStateLike(raw)) continue;
          const prev: CardState = { id, ...(raw as Record<string, unknown>) } as CardState;
          (states as Record<string, unknown>)[id] = resetCardScheduling(prev, now);
          cardTotal++;
        }
      }

      await this.saveAll();
      const noteTotal = await this._clearAllNoteSchedulingState();
      this._refreshOpenViews();

      new Notice(
        this._tx("ui.main.notice.resetScheduling", "Reset scheduling for {cardCount} cards and {noteCount} notes.", {
          cardCount: cardTotal,
          noteCount: noteTotal,
        }),
      );
    }

    async _clearAllNoteSchedulingState(): Promise<number> {
      const db = new NoteReviewSqlite(this);
      let total = 0;

      try {
        await db.open();
        total = db.clearAllNoteState();
        await db.persist();
      } finally {
        await db.close().catch((e) => log.swallow("close note review sqlite after reset", e));
      }

      return total;
    }

    async resetAllNoteScheduling(): Promise<void> {
      const total = await this._clearAllNoteSchedulingState();

      this._refreshOpenViews();
      new Notice(this._tx("ui.main.notice.resetNoteScheduling", "Reset scheduling for {count} notes.", { count: total }));
    }

    async resetAllAnalyticsData(): Promise<void> {
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
    }
  };
}
