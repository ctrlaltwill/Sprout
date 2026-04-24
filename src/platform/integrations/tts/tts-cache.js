/**
 * @file src/platform/integrations/tts/tts-cache.ts
 * @summary Audio cache for external TTS providers. Stores generated mp3 files
 * in the plugin data folder (`{pluginDir}/tts-cache/`) to avoid re-generating
 * the same text on subsequent plays.
 *
 * @exports
 *  - ttsCacheKey      — deterministic hash key from text + provider config
 *  - getCachedAudio   — retrieve cached audio ArrayBuffer if present
 *  - cacheAudio       — write audio ArrayBuffer to cache
 *  - clearTtsCache    — remove all cached audio files
 *  - getTtsCacheDirPath — resolve the tts-cache folder path for the plugin
 */
import { log } from "../../core/logger";
const TTS_CACHE_DIR = "tts-cache";
// ── Path helpers ────────────────────────────────────────────────
function joinPath(...parts) {
    return parts
        .filter((p) => typeof p === "string" && p.length)
        .join("/")
        .replace(/\/+/g, "/");
}
/**
 * Returns the tts-cache directory path for the plugin.
 * E.g. `.obsidian/plugins/learnkit/tts-cache`
 */
export function getTtsCacheDirPath(configDir, pluginId) {
    return joinPath(configDir, "plugins", pluginId, TTS_CACHE_DIR);
}
// ── Cache key ───────────────────────────────────────────────────
/**
 * Generate a deterministic cache key from the TTS input parameters.
 *
 * When a `cacheId` is provided (e.g. `"abc123-question"`), the filename
 * is `{cacheId}-{configHash}` so cached files are human-readable and
 * scoped to the card.  Falls back to a full content hash when no
 * `cacheId` is given (e.g. for study assistant replies or previews).
 */
export function ttsCacheKey(text, provider, voiceId, model, cacheId, languageTag = "") {
    if (cacheId) {
        const configHash = simpleHash(`${provider}|${voiceId}|${model}|${languageTag}`).slice(0, 6);
        const safeCacheId = cacheId.replace(/::/g, "-");
        return `${safeCacheId}-${configHash}`;
    }
    const input = `${provider}|${voiceId}|${model}|${languageTag}|${text}`;
    return simpleHash(input);
}
/**
 * FNV-1a-inspired 53-bit hash producing a 13-char hex string.
 * Not cryptographic — just fast and well-distributed for cache keys.
 */
function simpleHash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return combined.toString(16).padStart(13, "0");
}
// ── Folder management ───────────────────────────────────────────
async function ensureCacheDir(adapter, dirPath) {
    try {
        if (await adapter.exists(dirPath))
            return true;
        if (!adapter.mkdir)
            return false;
        await adapter.mkdir(dirPath);
        return true;
    }
    catch (_a) {
        return false;
    }
}
// ── Cache read / write ──────────────────────────────────────────
/**
 * Retrieve cached audio from the tts-cache folder.
 * @returns ArrayBuffer of mp3 data, or null if not cached.
 */
export async function getCachedAudio(adapter, cacheDirPath, key) {
    if (!adapter.readBinary)
        return null;
    const filePath = joinPath(cacheDirPath, `${key}.mp3`);
    try {
        if (!(await adapter.exists(filePath)))
            return null;
        return await adapter.readBinary(filePath);
    }
    catch (e) {
        log.warn("[TTS Cache] Failed to read cached audio", e);
        return null;
    }
}
/**
 * Write generated audio to the tts-cache folder.
 */
export async function cacheAudio(adapter, cacheDirPath, key, data) {
    if (!adapter.writeBinary)
        return;
    try {
        const dirOk = await ensureCacheDir(adapter, cacheDirPath);
        if (!dirOk)
            return;
        const filePath = joinPath(cacheDirPath, `${key}.mp3`);
        await adapter.writeBinary(filePath, data);
    }
    catch (e) {
        log.warn("[TTS Cache] Failed to write cached audio", e);
    }
}
/**
 * Remove all files from the tts-cache folder.
 * @returns Number of files removed, or -1 on error.
 */
export async function clearTtsCache(adapter, cacheDirPath) {
    if (!adapter.list || !adapter.remove)
        return -1;
    try {
        if (!(await adapter.exists(cacheDirPath)))
            return 0;
        const listing = await adapter.list(cacheDirPath);
        let removed = 0;
        for (const file of listing.files) {
            try {
                await adapter.remove(file);
                removed++;
            }
            catch (_a) {
                // best effort
            }
        }
        return removed;
    }
    catch (e) {
        log.warn("[TTS Cache] Failed to clear cache", e);
        return -1;
    }
}
/**
 * Remove cached TTS files whose filename begins with one of the provided card IDs.
 * Card IDs are normalized the same way as `ttsCacheKey` ("::" → "-").
 *
 * @returns Number of files removed, or -1 if unsupported/error.
 */
export async function deleteTtsCacheForCardIds(adapter, cacheDirPath, cardIds) {
    var _a;
    if (!adapter.list || !adapter.remove)
        return -1;
    const prefixes = [...new Set(cardIds
            .map((id) => String(id !== null && id !== void 0 ? id : "").trim())
            .filter(Boolean)
            .map((id) => id.replace(/::/g, "-")))];
    if (!prefixes.length)
        return 0;
    try {
        if (!(await adapter.exists(cacheDirPath)))
            return 0;
        const listing = await adapter.list(cacheDirPath);
        let removed = 0;
        for (const file of listing.files) {
            const fileName = (_a = file.split("/").pop()) !== null && _a !== void 0 ? _a : file;
            const matchesPrefix = prefixes.some((prefix) => fileName.startsWith(`${prefix}-`));
            if (!matchesPrefix)
                continue;
            try {
                await adapter.remove(file);
                removed += 1;
            }
            catch (_b) {
                // best effort
            }
        }
        return removed;
    }
    catch (e) {
        log.warn("[TTS Cache] Failed to delete card-scoped cache files", e);
        return -1;
    }
}
