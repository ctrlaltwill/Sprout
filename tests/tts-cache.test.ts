/**
 * @file tests/tts-cache.test.ts
 * @summary Unit tests for TTS audio cache module.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ttsCacheKey,
  getCachedAudio,
  cacheAudio,
  clearTtsCache,
  deleteTtsCacheForCardIds,
  getTtsCacheDirPath,
} from "../src/platform/integrations/tts/tts-cache";

// ── Helpers ──────────────────────────────────────────────────────

function makeAdapter(files: Record<string, ArrayBuffer> = {}) {
  const store = new Map(Object.entries(files));
  return {
    exists: vi.fn(async (p: string) => {
      if (store.has(p)) return true;
      // Check if p is a directory prefix of any stored key
      const prefix = p.endsWith("/") ? p : p + "/";
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    }),
    readBinary: vi.fn(async (p: string) => {
      const v = store.get(p);
      if (!v) throw new Error("not found");
      return v;
    }),
    writeBinary: vi.fn(async (p: string, data: ArrayBuffer) => {
      store.set(p, data);
    }),
    remove: vi.fn(async (p: string) => {
      store.delete(p);
    }),
    mkdir: vi.fn(async () => {}),
    list: vi.fn(async (dir: string) => {
      const allFiles = [...store.keys()].filter((k) => k.startsWith(dir));
      return { files: allFiles, folders: [] };
    }),
    _store: store,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("getTtsCacheDirPath", () => {
  it("joins configDir, plugins, pluginId and tts-cache", () => {
    expect(getTtsCacheDirPath(".obsidian", "learnkit")).toBe(
      ".obsidian/plugins/learnkit/tts-cache",
    );
  });
});

describe("ttsCacheKey", () => {
  it("returns a 13-char hex string", () => {
    const key = ttsCacheKey("hello world", "openai", "alloy", "tts-1");
    expect(key).toMatch(/^[0-9a-f]{13}$/);
  });

  it("is deterministic", () => {
    const a = ttsCacheKey("same text", "elevenlabs", "voice1", "model1");
    const b = ttsCacheKey("same text", "elevenlabs", "voice1", "model1");
    expect(a).toBe(b);
  });

  it("differs when any input changes", () => {
    const base = ttsCacheKey("text", "openai", "alloy", "tts-1");
    expect(ttsCacheKey("text2", "openai", "alloy", "tts-1")).not.toBe(base);
    expect(ttsCacheKey("text", "elevenlabs", "alloy", "tts-1")).not.toBe(base);
    expect(ttsCacheKey("text", "openai", "nova", "tts-1")).not.toBe(base);
    expect(ttsCacheKey("text", "openai", "alloy", "tts-1-hd")).not.toBe(base);
  });

  it("uses card-based cacheId when provided", () => {
    const key = ttsCacheKey("some text", "openai", "alloy", "tts-1", "abc123-question");
    expect(key).toMatch(/^abc123-question-[0-9a-f]{6}$/);
  });

  it("cacheId keys are deterministic", () => {
    const a = ttsCacheKey("text", "openai", "alloy", "tts-1", "card42-answer");
    const b = ttsCacheKey("text", "openai", "alloy", "tts-1", "card42-answer");
    expect(a).toBe(b);
  });

  it("cacheId keys change when provider config changes", () => {
    const a = ttsCacheKey("text", "openai", "alloy", "tts-1", "card42-question");
    const b = ttsCacheKey("text", "openai", "nova", "tts-1", "card42-question");
    expect(a).not.toBe(b);
  });

  it("cacheId keys change when languageTag changes", () => {
    const a = ttsCacheKey("text", "openai", "alloy", "tts-1", "card42-question", "es-ES");
    const b = ttsCacheKey("text", "openai", "alloy", "tts-1", "card42-question", "en-GB");
    expect(a).not.toBe(b);
  });

  it("cacheId keys ignore text content (keyed by card ID)", () => {
    const a = ttsCacheKey("text A", "openai", "alloy", "tts-1", "card42-question");
    const b = ttsCacheKey("text B", "openai", "alloy", "tts-1", "card42-question");
    expect(a).toBe(b);
  });

  it("falls back to content hash when no cacheId is given", () => {
    const withoutId = ttsCacheKey("hello", "openai", "alloy", "tts-1");
    const withId = ttsCacheKey("hello", "openai", "alloy", "tts-1", "card1-question");
    // Without cacheId: hex hash; with cacheId: card-based key
    expect(withoutId).toMatch(/^[0-9a-f]{13,14}$/);
    expect(withId).toContain("card1-question");
    expect(withoutId).not.toBe(withId);
  });

  it("content-hash keys change when languageTag changes", () => {
    const a = ttsCacheKey("hola", "openai", "alloy", "tts-1", undefined, "es-ES");
    const b = ttsCacheKey("hola", "openai", "alloy", "tts-1", undefined, "en-GB");
    expect(a).not.toBe(b);
  });

  it("replaces :: separators with hyphens in cacheId", () => {
    const key = ttsCacheKey("text", "openai", "alloy", "tts-1", "114621912::cloze::c1-answer");
    expect(key).toMatch(/^114621912-cloze-c1-answer-[0-9a-f]{6}$/);
    expect(key).not.toContain("::");
  });
});

describe("getCachedAudio", () => {
  it("returns null when file does not exist", async () => {
    const adapter = makeAdapter();
    const result = await getCachedAudio(adapter, "cache", "abc");
    expect(result).toBeNull();
    expect(adapter.exists).toHaveBeenCalledWith("cache/abc.mp3");
  });

  it("returns ArrayBuffer when cached", async () => {
    const data = new ArrayBuffer(4);
    const adapter = makeAdapter({ "cache/abc.mp3": data });
    const result = await getCachedAudio(adapter, "cache", "abc");
    expect(result).toBe(data);
  });

  it("returns null when readBinary is not available", async () => {
    const adapter = makeAdapter();
    (adapter as Record<string, unknown>).readBinary = undefined;
    const result = await getCachedAudio(adapter, "cache", "abc");
    expect(result).toBeNull();
  });
});

describe("cacheAudio", () => {
  it("writes data to the correct path", async () => {
    const adapter = makeAdapter();
    const data = new ArrayBuffer(8);
    await cacheAudio(adapter, "cache", "key1", data);
    expect(adapter.writeBinary).toHaveBeenCalledWith("cache/key1.mp3", data);
    expect(adapter._store.has("cache/key1.mp3")).toBe(true);
  });

  it("creates the cache directory if needed", async () => {
    const adapter = makeAdapter();
    await cacheAudio(adapter, "cache", "key1", new ArrayBuffer(1));
    expect(adapter.mkdir).toHaveBeenCalledWith("cache");
  });

  it("does nothing when writeBinary is unavailable", async () => {
    const adapter = makeAdapter();
    (adapter as Record<string, unknown>).writeBinary = undefined;
    await cacheAudio(adapter, "cache", "key1", new ArrayBuffer(1));
    expect(adapter.mkdir).not.toHaveBeenCalled();
  });
});

describe("clearTtsCache", () => {
  it("removes all files and returns count", async () => {
    const adapter = makeAdapter({
      "cache/a.mp3": new ArrayBuffer(1),
      "cache/b.mp3": new ArrayBuffer(1),
    });
    const count = await clearTtsCache(adapter, "cache");
    expect(count).toBe(2);
    expect(adapter._store.size).toBe(0);
  });

  it("returns 0 when cache dir does not exist", async () => {
    const adapter = makeAdapter();
    const count = await clearTtsCache(adapter, "cache");
    expect(count).toBe(0);
  });

  it("returns -1 when list is unavailable", async () => {
    const adapter = makeAdapter();
    (adapter as Record<string, unknown>).list = undefined;
    const count = await clearTtsCache(adapter, "cache");
    expect(count).toBe(-1);
  });
});

describe("deleteTtsCacheForCardIds", () => {
  it("removes matching card-scoped cache files only", async () => {
    const adapter = makeAdapter({
      "cache/114621912-cloze-c1-question-aaaaaa.mp3": new ArrayBuffer(1),
      "cache/114621912-cloze-c1-answer-bbbbbb.mp3": new ArrayBuffer(1),
      "cache/999999999-basic-question-cccccc.mp3": new ArrayBuffer(1),
      "cache/random.mp3": new ArrayBuffer(1),
    });

    const removed = await deleteTtsCacheForCardIds(adapter, "cache", ["114621912::cloze::c1"]);
    expect(removed).toBe(2);
    expect(adapter._store.has("cache/114621912-cloze-c1-question-aaaaaa.mp3")).toBe(false);
    expect(adapter._store.has("cache/114621912-cloze-c1-answer-bbbbbb.mp3")).toBe(false);
    expect(adapter._store.has("cache/999999999-basic-question-cccccc.mp3")).toBe(true);
    expect(adapter._store.has("cache/random.mp3")).toBe(true);
  });

  it("returns 0 when no card ids are provided", async () => {
    const adapter = makeAdapter({ "cache/a.mp3": new ArrayBuffer(1) });
    const removed = await deleteTtsCacheForCardIds(adapter, "cache", []);
    expect(removed).toBe(0);
    expect(adapter._store.size).toBe(1);
  });
});
