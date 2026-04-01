import { deepMerge, DEFAULT_SETTINGS, type SproutSettings } from "./constants";
import { isPlainObject } from "./utils";
import { log } from "./logger";

export type StudyAssistantApiKeys = SproutSettings["studyAssistant"]["apiKeys"];

type AdapterLike = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove?: (path: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
};

/**
 * Legacy configuration files that were previously used for partitioned
 * settings storage. Kept only so we can migrate them back into data.json
 * on first load after the update, then delete them.
 * `api-keys.json` is intentionally excluded — it stays separate.
 */
const LEGACY_CONFIG_FILES: ReadonlyArray<{
  readonly file: string;
  readonly keys: readonly (keyof SproutSettings)[];
}> = [
  { file: "general.json", keys: ["general"] },
  { file: "study.json", keys: ["study"] },
  { file: "assistant.json", keys: ["studyAssistant"] },
  { file: "reminders.json", keys: ["reminders"] },
  { file: "scheduling.json", keys: ["scheduling"] },
  { file: "indexing.json", keys: ["indexing"] },
  { file: "cards.json", keys: ["cards", "imageOcclusion"] },
  { file: "reading-view.json", keys: ["readingView"] },
  { file: "storage.json", keys: ["storage"] },
  { file: "audio.json", keys: ["audio"] },
];

export function normaliseApiKeys(raw: unknown): StudyAssistantApiKeys {
  const obj = isPlainObject(raw) ? raw : {};
  const asApiKey = (value: unknown): string => {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value).trim();
    }
    return "";
  };

  return {
    openai: asApiKey(obj.openai),
    anthropic: asApiKey(obj.anthropic),
    deepseek: asApiKey(obj.deepseek),
    xai: asApiKey(obj.xai ?? obj.groq),
    google: asApiKey(obj.google),
    perplexity: asApiKey(obj.perplexity),
    openrouter: asApiKey(obj.openrouter),
    custom: asApiKey(obj.custom),
  };
}

export function hasAnyApiKey(apiKeys: StudyAssistantApiKeys): boolean {
  return Object.values(apiKeys).some((value) => String(value || "").trim().length > 0);
}

export async function loadApiKeysFromDedicatedFile(params: {
  adapter: AdapterLike | null | undefined;
  filePath: string | null;
  settings: SproutSettings;
}): Promise<boolean> {
  const { adapter, filePath, settings } = params;
  if (!adapter || !filePath) return false;
  try {
    if (!(await adapter.exists(filePath))) return false;
    const raw = await adapter.read(filePath);
    const parsed = JSON.parse(raw) as unknown;
    settings.studyAssistant.apiKeys = normaliseApiKeys(parsed);
    return true;
  } catch (e) {
    log.warn("Failed to read dedicated API key file; continuing with settings payload.", e);
    return false;
  }
}

export async function persistApiKeysToDedicatedFile(params: {
  adapter: AdapterLike | null | undefined;
  dirPath: string | null;
  filePath: string | null;
  apiKeys: StudyAssistantApiKeys;
}): Promise<boolean> {
  const { adapter, dirPath, filePath, apiKeys } = params;
  if (!adapter || !dirPath || !filePath) return false;

  try {
    const hasAny = hasAnyApiKey(apiKeys);
    if (!hasAny) {
      if (await adapter.exists(filePath)) {
        await adapter.remove?.(filePath);
      }
      return true;
    }

    if (!(await adapter.exists(dirPath))) {
      await adapter.mkdir?.(dirPath);
    }

    await adapter.write(filePath, `${JSON.stringify(apiKeys, null, 2)}\n`);
    return true;
  } catch (e) {
    log.warn("Failed to write dedicated API key file.", e);
    return false;
  }
}

export async function initialiseDedicatedApiKeyStorage(params: {
  adapter: AdapterLike | null | undefined;
  dirPath: string | null;
  filePath: string | null;
  settings: SproutSettings;
}): Promise<void> {
  const { adapter, dirPath, filePath, settings } = params;

  settings.studyAssistant.apiKeys = normaliseApiKeys(settings.studyAssistant.apiKeys);
  const loadedFromDedicatedFile = await loadApiKeysFromDedicatedFile({
    adapter,
    filePath,
    settings,
  });
  if (loadedFromDedicatedFile) return;
  if (!hasAnyApiKey(settings.studyAssistant.apiKeys)) return;

  const migrated = await persistApiKeysToDedicatedFile({
    adapter,
    dirPath,
    filePath,
    apiKeys: settings.studyAssistant.apiKeys,
  });
  if (migrated) log.info("Migrated study assistant API keys to configuration/api-keys.json");
}

export async function migrateLegacyConfigFiles(params: {
  adapter: AdapterLike | null | undefined;
  getConfigFilePath: (filename: string) => string | null;
  settings: SproutSettings;
}): Promise<void> {
  const { adapter, getConfigFilePath, settings } = params;
  if (!adapter) return;

  const remove = adapter.remove;

  for (const entry of LEGACY_CONFIG_FILES) {
    const filePath = getConfigFilePath(entry.file);
    if (!filePath) continue;

    try {
      if (!(await adapter.exists(filePath))) continue;
      const raw = await adapter.read(filePath);
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainObject(parsed)) continue;

      const parsedObj = parsed;
      const s = settings as Record<string, unknown>;

      if (entry.keys.length === 1) {
        const key = entry.keys[0];
        s[key] = deepMerge(s[key] ?? {}, parsedObj);
      } else {
        for (const key of entry.keys) {
          if (isPlainObject(parsedObj[key])) {
            s[key] = deepMerge(s[key] ?? {}, parsedObj[key]);
          }
        }
      }

      if (remove) {
        try {
          await remove(filePath);
        } catch {
          // best effort
        }
      }
    } catch (e) {
      log.warn(`Failed to migrate legacy config file ${entry.file}.`, e);
    }
  }
}

export function settingsWithoutApiKeys(settings: SproutSettings): SproutSettings {
  const snapshot = structuredClone(settings);
  snapshot.studyAssistant.apiKeys = { ...DEFAULT_SETTINGS.studyAssistant.apiKeys };
  return snapshot;
}
