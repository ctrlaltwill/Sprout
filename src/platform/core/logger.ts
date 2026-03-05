/**
 * @file src/core/logger.ts
 * @summary Centralised logging abstraction for Sprout. Every message is prefixed with
 * "[Sprout]" for easy DevTools filtering. Supports four severity levels (debug, info,
 * warn, error) plus a "silent" mode, and a `swallow` helper for previously-empty catch
 * blocks that logs at debug level. The log level can be changed at runtime via
 * `window.__sproutLog.setLevel("debug")`.
 *
 * @exports
 *   - LogLevel — type union of log severity levels
 *   - log — singleton logger object with debug/info/warn/error/swallow methods
 */

const PREFIX = "[Sprout]";

// Bind console methods once so call-sites don't trigger the no-console rule.
const _debug = globalThis.console.debug.bind(globalThis.console);
const _log = globalThis.console.log.bind(globalThis.console);
const _warn = globalThis.console.warn.bind(globalThis.console);
const _error = globalThis.console.error.bind(globalThis.console);

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
    if (shouldLog("debug")) _debug(PREFIX, ...args);
  },

  /** General informational messages. */
  info(...args: unknown[]) {
    if (shouldLog("info")) _log(PREFIX, ...args);
  },

  /** Unexpected-but-recoverable situations. */
  warn(...args: unknown[]) {
    if (shouldLog("warn")) _warn(PREFIX, ...args);
  },

  /** Genuine errors that need attention. */
  error(...args: unknown[]) {
    if (shouldLog("error")) _error(PREFIX, ...args);
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
      _debug(PREFIX, `[swallowed] ${context}:`, err);
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
