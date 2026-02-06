/* eslint-disable no-console -- This IS the logging abstraction layer */
/**
 * src/core/logger.ts
 * ──────────────────
 * Centralised logger for Sprout.  Every message is prefixed with
 * `[Sprout]` so it's easy to filter in DevTools.
 *
 * Usage:
 *   import { log } from "../core/logger";
 *
 *   log.debug("something happened", value);
 *   log.warn("unexpected state", ctx);
 *   log.error("failed to save", err);
 *
 * In production the `debug` channel is silenced by default.
 * Call `log.setLevel("debug")` at runtime (e.g. from the console)
 * to turn it on, or `log.setLevel("warn")` to only see warnings+errors.
 *
 * The `swallow` helper is designed for catch blocks that were previously
 * empty — it logs at debug level so errors aren't lost silently:
 *
 *   try { … } catch (e) { log.swallow("dispose header", e); }
 */

const PREFIX = "[Sprout]";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let currentLevel: LogLevel = "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export const log = {
  /** Set the minimum log level.  "silent" suppresses everything. */
  setLevel(level: LogLevel) {
    currentLevel = level;
  },

  getLevel(): LogLevel {
    return currentLevel;
  },

  /** Verbose detail — silenced unless level is "debug". */
  debug(...args: unknown[]) {
    if (shouldLog("debug")) console.debug(PREFIX, ...args);
  },

  /** General informational messages. */
  info(...args: unknown[]) {
    if (shouldLog("info")) console.log(PREFIX, ...args);
  },

  /** Unexpected-but-recoverable situations. */
  warn(...args: unknown[]) {
    if (shouldLog("warn")) console.warn(PREFIX, ...args);
  },

  /** Genuine errors that need attention. */
  error(...args: unknown[]) {
    if (shouldLog("error")) console.error(PREFIX, ...args);
  },

  /**
   * Intended for previously-empty `catch {}` blocks.
   * Logs at **debug** level so the error is no longer silently lost,
   * but doesn't spam the console in normal use.
   *
   * @param context  A short label describing what was attempted.
   * @param err      The caught error (or unknown value).
   *
   * ```ts
   * try { header.dispose(); } catch (e) { log.swallow("dispose header", e); }
   * ```
   */
  swallow(context: string, err?: unknown) {
    if (shouldLog("debug")) {
      console.debug(PREFIX, `[swallowed] ${context}:`, err);
    }
  },
};

// Expose on globalThis so devs can toggle from the console:
//   window.__sproutLog.setLevel("debug")
try {
  globalThis.__sproutLog = log;
} catch {
  // non-browser environment — harmless
}
