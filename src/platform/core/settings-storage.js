/**
 * @file src/platform/core/settings-storage.ts
 * @summary Module for settings storage.
 *
 * @exports
 *  - normaliseApiKeys
 *  - hasAnyApiKey
 *  - loadApiKeysFromDedicatedFile
 *  - persistApiKeysToDedicatedFile
 *  - initialiseDedicatedApiKeyStorage
 *  - migrateLegacyConfigFiles
 */
import { deepMerge } from "./constants";
import { isPlainObject } from "./utils";
import { log } from "./logger";
/**
 * Legacy configuration files that were previously used for partitioned
 * settings storage. Kept only so we can migrate them back into data.json
 * on first load after the update, then delete them.
 * `api-keys.json` is intentionally excluded — it stays separate.
 */
const LEGACY_CONFIG_FILES = [
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
export function normaliseApiKeys(raw) {
    var _a;
    const obj = isPlainObject(raw) ? raw : {};
    const asApiKey = (value) => {
        if (typeof value === "string")
            return value.trim();
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
            return String(value).trim();
        }
        return "";
    };
    return {
        openai: asApiKey(obj.openai),
        anthropic: asApiKey(obj.anthropic),
        deepseek: asApiKey(obj.deepseek),
        xai: asApiKey((_a = obj.xai) !== null && _a !== void 0 ? _a : obj.groq),
        google: asApiKey(obj.google),
        perplexity: asApiKey(obj.perplexity),
        openrouter: asApiKey(obj.openrouter),
        custom: asApiKey(obj.custom),
    };
}
export function hasAnyApiKey(apiKeys) {
    return Object.values(apiKeys).some((value) => String(value || "").trim().length > 0);
}
export async function loadApiKeysFromDedicatedFile(params) {
    const { adapter, filePath, settings } = params;
    if (!adapter || !filePath)
        return false;
    try {
        if (!(await adapter.exists(filePath)))
            return false;
        const raw = await adapter.read(filePath);
        const parsed = JSON.parse(raw);
        settings.studyAssistant.apiKeys = normaliseApiKeys(parsed);
        return true;
    }
    catch (e) {
        log.warn("Failed to read dedicated API key file; continuing with settings payload.", e);
        return false;
    }
}
export async function persistApiKeysToDedicatedFile(params) {
    var _a, _b;
    const { adapter, dirPath, filePath, apiKeys } = params;
    if (!adapter || !dirPath || !filePath)
        return false;
    try {
        const hasAny = hasAnyApiKey(apiKeys);
        if (!hasAny) {
            if (await adapter.exists(filePath)) {
                await ((_a = adapter.remove) === null || _a === void 0 ? void 0 : _a.call(adapter, filePath));
            }
            return true;
        }
        if (!(await adapter.exists(dirPath))) {
            await ((_b = adapter.mkdir) === null || _b === void 0 ? void 0 : _b.call(adapter, dirPath));
        }
        await adapter.write(filePath, `${JSON.stringify(apiKeys, null, 2)}\n`);
        return true;
    }
    catch (e) {
        log.warn("Failed to write dedicated API key file.", e);
        return false;
    }
}
export async function initialiseDedicatedApiKeyStorage(params) {
    const { adapter, dirPath, filePath, settings } = params;
    settings.studyAssistant.apiKeys = normaliseApiKeys(settings.studyAssistant.apiKeys);
    const loadedFromDedicatedFile = await loadApiKeysFromDedicatedFile({
        adapter,
        filePath,
        settings,
    });
    if (loadedFromDedicatedFile)
        return;
    if (!hasAnyApiKey(settings.studyAssistant.apiKeys))
        return;
    const migrated = await persistApiKeysToDedicatedFile({
        adapter,
        dirPath,
        filePath,
        apiKeys: settings.studyAssistant.apiKeys,
    });
    if (migrated)
        log.info("Migrated study assistant API keys to configuration/api-keys.json");
}
// ── TTS API keys ────────────────────────────────────────────────
export function normaliseTtsApiKeys(raw) {
    const obj = isPlainObject(raw) ? raw : {};
    const asKey = (value) => {
        if (typeof value === "string")
            return value.trim();
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
            return String(value).trim();
        }
        return "";
    };
    return {
        elevenlabs: asKey(obj.elevenlabs),
        openai: asKey(obj.openai),
        "google-cloud": asKey(obj["google-cloud"]),
        custom: asKey(obj.custom),
    };
}
export function hasAnyTtsApiKey(apiKeys) {
    return Object.values(apiKeys).some((v) => String(v || "").trim().length > 0);
}
export async function loadTtsApiKeysFromDedicatedFile(params) {
    const { adapter, filePath, settings } = params;
    if (!adapter || !filePath)
        return false;
    try {
        if (!(await adapter.exists(filePath)))
            return false;
        const raw = await adapter.read(filePath);
        const parsed = JSON.parse(raw);
        settings.audio.ttsApiKeys = normaliseTtsApiKeys(parsed);
        return true;
    }
    catch (e) {
        log.warn("Failed to read dedicated TTS API key file; continuing with settings payload.", e);
        return false;
    }
}
export async function persistTtsApiKeysToDedicatedFile(params) {
    var _a, _b;
    const { adapter, dirPath, filePath, apiKeys } = params;
    if (!adapter || !dirPath || !filePath)
        return false;
    try {
        const hasAny = hasAnyTtsApiKey(apiKeys);
        if (!hasAny) {
            if (await adapter.exists(filePath)) {
                await ((_a = adapter.remove) === null || _a === void 0 ? void 0 : _a.call(adapter, filePath));
            }
            return true;
        }
        if (!(await adapter.exists(dirPath))) {
            await ((_b = adapter.mkdir) === null || _b === void 0 ? void 0 : _b.call(adapter, dirPath));
        }
        await adapter.write(filePath, `${JSON.stringify(apiKeys, null, 2)}\n`);
        return true;
    }
    catch (e) {
        log.warn("Failed to write dedicated TTS API key file.", e);
        return false;
    }
}
export async function initialiseDedicatedTtsApiKeyStorage(params) {
    const { adapter, dirPath, filePath, settings } = params;
    settings.audio.ttsApiKeys = normaliseTtsApiKeys(settings.audio.ttsApiKeys);
    const loadedFromDedicatedFile = await loadTtsApiKeysFromDedicatedFile({
        adapter,
        filePath,
        settings,
    });
    if (loadedFromDedicatedFile)
        return;
    if (!hasAnyTtsApiKey(settings.audio.ttsApiKeys))
        return;
    const migrated = await persistTtsApiKeysToDedicatedFile({
        adapter,
        dirPath,
        filePath,
        apiKeys: settings.audio.ttsApiKeys,
    });
    if (migrated)
        log.info("Migrated TTS API keys to configuration/tts-api-keys.json");
}
export async function migrateLegacyConfigFiles(params) {
    var _a, _b;
    const { adapter, getConfigFilePath, settings } = params;
    if (!adapter)
        return;
    const remove = adapter.remove;
    for (const entry of LEGACY_CONFIG_FILES) {
        const filePath = getConfigFilePath(entry.file);
        if (!filePath)
            continue;
        try {
            if (!(await adapter.exists(filePath)))
                continue;
            const raw = await adapter.read(filePath);
            const parsed = JSON.parse(raw);
            if (!isPlainObject(parsed))
                continue;
            const parsedObj = parsed;
            const s = settings;
            if (entry.keys.length === 1) {
                const key = entry.keys[0];
                s[key] = deepMerge((_a = s[key]) !== null && _a !== void 0 ? _a : {}, parsedObj);
            }
            else {
                for (const key of entry.keys) {
                    if (isPlainObject(parsedObj[key])) {
                        s[key] = deepMerge((_b = s[key]) !== null && _b !== void 0 ? _b : {}, parsedObj[key]);
                    }
                }
            }
            if (remove) {
                try {
                    await remove(filePath);
                }
                catch (_c) {
                    // best effort
                }
            }
        }
        catch (e) {
            log.warn(`Failed to migrate legacy config file ${entry.file}.`, e);
        }
    }
}
